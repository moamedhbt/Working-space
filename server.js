const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'atelier.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); }
  catch { return null; }
}

let db;

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, nom TEXT, username TEXT UNIQUE, passwordHash TEXT, role TEXT
      );
      CREATE TABLE machines (
        id TEXT PRIMARY KEY, nom TEXT, type TEXT, actif INTEGER DEFAULT 1
      );
      CREATE TABLE pieces (
        id TEXT PRIMARY KEY, nom TEXT, client TEXT, quantitePrevue INTEGER, quantiteRealisee INTEGER DEFAULT 0,
        delai TEXT, urgence TEXT, statut TEXT, machine TEXT, operateur TEXT, matiere TEXT,
        chuteDispo INTEGER DEFAULT 0, achatFait INTEGER DEFAULT 0, fournisseur TEXT, outils TEXT,
        beNomFichier TEXT DEFAULT '', beProgramme TEXT DEFAULT '', beDessin3d TEXT DEFAULT '',
        photoDebut TEXT, photoFin TEXT, tempsPrevuMin INTEGER DEFAULT 120, tempsReelMin INTEGER DEFAULT 0,
        planningValide INTEGER DEFAULT 0, ordrePlanning INTEGER DEFAULT 1
      );
    `);

    const users = [
      ['u1', 'Directeur', 'directeur', hashPassword('1234'), 'directeur'],
      ['u2', 'Bureau Études', 'be', hashPassword('1234'), 'be'],
      ['u3', 'Chef Atelier', 'chef', hashPassword('1234'), 'chef'],
      ['u4', 'Karim B.', 'karim', hashPassword('1234'), 'operateur'],
      ['u5', 'Yacine M.', 'yacine', hashPassword('1234'), 'operateur'],
      ['u6', 'Sofiane K.', 'sofiane', hashPassword('1234'), 'operateur']
    ];
    users.forEach(u => db.run('INSERT INTO users VALUES (?,?,?,?,?)', u));

    const machines = [
      ['m1', 'Tour CNC 1', 'Tournage CNC', 1],
      ['m2', 'Fraiseuse CNC 2', 'Fraisage CNC', 1],
      ['m3', 'Tour Conventionnel', 'Tournage Manuel', 1]
    ];
    machines.forEach(m => db.run('INSERT INTO machines VALUES (?,?,?,?)', m));

    const pieces = [
      ['OF-2026-101', 'Arbre de transmission Ø45', 'SARL MécaSud', 10, 6, '2026-11-22', 'Critique', 'En cours', 'Tour CNC 1', 'Karim B.', 'Acier 42CrMo4 Ø50', 1, 1, 'AcierPro DZ', 'Plaquette CNMG 120408, Foret Ø12', 'ARB-101-REV2', 'O0101_ARB_CNC1.nc', 'ARB-101.step', 'ok', null, 180, 115, 1, 1],
      ['OF-2026-102', 'Bride de fixation hydraulique', 'HydroTech', 25, 0, '2026-11-23', 'Urgent', 'À acheter', 'Fraiseuse CNC 2', 'Yacine M.', 'Alu 7075 Plat 80x20', 0, 0, 'AluMag', 'Fraise Ø16 4 dents, Taraud M8', 'BRI-102-V1', 'O0102_BRIDE.nc', 'BRI-102.step', null, null, 240, 0, 0, 2],
      ['OF-2026-103', 'Bague de centrage', 'Industrie Nord', 50, 50, '2026-11-21', 'Normal', 'À clôturer', 'Tour Conventionnel', 'Sofiane K.', 'Bronze CuSn12 Ø35', 1, 1, 'MétalPlus', 'Outil à aléser Ø20', 'BAG-103-FINAL', 'Manuel', 'BAG-103.pdf', 'ok', 'ok', 150, 135, 1, 3]
    ];
    pieces.forEach(p => db.run('INSERT INTO pieces VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', p));
    saveDB();
  }
}

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const session = verifyToken(token);
  if (!session || session.exp < Date.now()) return res.status(401).json({ error: 'Non autorisé' });
  req.user = session;
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  const token = signToken({ id: user.id, nom: user.nom, username: user.username, role: user.role, exp: Date.now() + 86400000 });
  res.json({ token, user: { id: user.id, nom: user.nom, username: user.username, role: user.role } });
});

app.get('/api/tv', (req, res) => {
  const pieces = queryAll("SELECT * FROM pieces WHERE planningValide = 1 AND statut != 'Clôturé' ORDER BY ordrePlanning ASC");
  const machines = queryAll('SELECT * FROM machines WHERE actif = 1');
  res.json({ pieces, machines });
});

app.get('/api/state', auth, (req, res) => {
  const users = queryAll('SELECT id, nom, username, role FROM users');
  const machines = queryAll('SELECT * FROM machines');
  const rawPieces = queryAll('SELECT * FROM pieces ORDER BY ordrePlanning ASC');
  const pieces = rawPieces.map(p => ({
    ...p,
    chuteDispo: !!p.chuteDispo,
    achatFait: !!p.achatFait,
    planningValide: !!p.planningValide,
    be: { nomFichier: p.beNomFichier, programme: p.beProgramme, dessin3d: p.beDessin3d }
  }));
  res.json({ users, machines, pieces });
});

app.post('/api/pieces', auth, (req, res) => {
  if (!['directeur', 'chef'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
  const b = req.body || {};
  const id = 'OF-2026-' + Math.floor(104 + Math.random() * 890);
  const firstMach = queryOne('SELECT nom FROM machines LIMIT 1');
  runSql(
    'INSERT INTO pieces (id, nom, client, quantitePrevue, delai, urgence, statut, machine, operateur, matiere, fournisseur, outils, ordrePlanning) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, b.nom || 'Nouvelle pièce', b.client || 'Client', parseInt(b.quantitePrevue || 10, 10), b.delai || '2026-11-28', b.urgence || 'Normal', 'À planifier', firstMach?.nom || 'À affecter', 'Karim B.', 'À définir', 'À définir', 'À définir', 1]
  );
  res.status(201).json({ ok: true, id });
});

app.post('/api/planning/optimize', auth, (req, res) => {
  if (!['directeur', 'chef'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
  const order = { 'Critique': 1, 'Urgent': 2, 'Normal': 3 };
  const pieces = queryAll('SELECT id, urgence, delai FROM pieces');
  pieces.sort((a, b) => (order[a.urgence] || 9) - (order[b.urgence] || 9) || a.delai.localeCompare(b.delai));
  pieces.forEach((p, i) => db.run('UPDATE pieces SET ordrePlanning = ? WHERE id = ?', [i + 1, p.id]));
  saveDB();
  res.json({ ok: true });
});

app.post('/api/planning/validate', auth, (req, res) => {
  if (!['directeur', 'chef'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
  runSql('UPDATE pieces SET planningValide = 1');
  res.json({ ok: true });
});

app.post('/api/users', auth, (req, res) => {
  if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
  const { nom, username, password, role } = req.body || {};
  if (!nom || !username || !password) return res.status(400).json({ error: 'Champs manquants' });
  try {
    runSql('INSERT INTO users VALUES (?,?,?,?,?)', ['u' + Date.now(), nom, username, hashPassword(password), role || 'operateur']);
    res.status(201).json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Identifiant déjà utilisé' });
  }
});

app.post('/api/machines', auth, (req, res) => {
  if (!['directeur', 'chef'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
  const { nom, type } = req.body || {};
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  runSql('INSERT INTO machines VALUES (?,?,?,1)', ['m' + Date.now(), nom, type || 'Usinage']);
  res.status(201).json({ ok: true });
});

app.post('/api/upload', auth, (req, res) => {
  const { pieceId, filename, base64 } = req.body || {};
  if (!pieceId || !filename || !base64) return res.status(400).json({ error: 'Données manquantes' });
  const safeId = pieceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(UPLOADS_DIR, safeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  fs.writeFileSync(path.join(dir, safeName), Buffer.from(raw, 'base64'));
  res.json({ ok: true, url: `/uploads/${safeId}/${safeName}` });
});

app.post('/api/pieces/:id/:action', auth, (req, res) => {
  const { id, action } = req.params;
  const p = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Pièce introuvable' });
  const b = req.body || {};

  if (action === 'be') {
    if (!['directeur', 'be'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    runSql('UPDATE pieces SET beNomFichier = ?, beProgramme = ?, beDessin3d = ? WHERE id = ?', [b.nomFichier || '', b.programme || '', b.dessin3d || '', id]);
  } else if (action === 'chef') {
    if (!['directeur', 'chef'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    const chute = b.chuteDispo ? 1 : 0;
    let statut = p.statut;
    if (!chute && !p.achatFait) statut = 'À acheter';
    else if (p.statut === 'À planifier' || p.statut === 'À acheter') statut = 'Prêt atelier';
    runSql('UPDATE pieces SET machine = ?, operateur = ?, matiere = ?, outils = ?, chuteDispo = ?, statut = ? WHERE id = ?', [b.machine || p.machine, b.operateur || p.operateur, b.matiere || p.matiere, b.outils || p.outils, chute, statut, id]);
  } else if (action === 'op-start') {
    runSql("UPDATE pieces SET statut = 'En cours', photoDebut = ? WHERE id = ?", [b.photoUrl || 'ok', id]);
  } else if (action === 'op-finish') {
    runSql("UPDATE pieces SET quantiteRealisee = ?, photoFin = ?, statut = 'À clôturer' WHERE id = ?", [parseInt(b.quantiteRealisee || p.quantitePrevue, 10), b.photoUrl || 'ok', id]);
  } else if (action === 'buy') {
    if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
    runSql("UPDATE pieces SET achatFait = 1, statut = 'Prêt atelier' WHERE id = ?", [id]);
  } else if (action === 'close') {
    if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
    runSql("UPDATE pieces SET statut = 'Clôturé' WHERE id = ?", [id]);
  } else {
    return res.status(404).json({ error: 'Action inconnue' });
  }
  res.json({ ok: true });
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Atelier Manager Pro (Express + SQLite) running on http://0.0.0.0:${PORT}`);
  });
});
