const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const DB_FILE = path.join(__dirname, '../../atelier.db');
let db;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

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
      CREATE TABLE users (id TEXT PRIMARY KEY, nom TEXT, username TEXT UNIQUE, passwordHash TEXT, role TEXT);
      CREATE TABLE machines (id TEXT PRIMARY KEY, nom TEXT, type TEXT, actif INTEGER DEFAULT 1);
      CREATE TABLE audit_logs (id TEXT PRIMARY KEY, user TEXT, role TEXT, action TEXT, details TEXT, createdAt TEXT);
      CREATE TABLE pieces (
        id TEXT PRIMARY KEY, nom TEXT, client TEXT, quantitePrevue INTEGER, quantiteRealisee INTEGER DEFAULT 0,
        delai TEXT, urgence TEXT, statut TEXT, machine TEXT, operateur TEXT, matiere TEXT,
        chuteDispo INTEGER DEFAULT 0, achatFait INTEGER DEFAULT 0, fournisseur TEXT, outils TEXT,
        beNomFichier TEXT DEFAULT '', beProgramme TEXT DEFAULT '', beDessin3d TEXT DEFAULT '',
        photoDebut TEXT, photoFin TEXT, tempsPrevuMin INTEGER DEFAULT 120, tempsReelMin INTEGER DEFAULT 0,
        startedAt INTEGER DEFAULT 0, planningValide INTEGER DEFAULT 0, ordrePlanning INTEGER DEFAULT 1
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
      ['OF-2026-101', 'Arbre de transmission Ø45', 'SARL MécaSud', 10, 6, '2026-11-22', 'Critique', 'En cours', 'Tour CNC 1', 'Karim B.', 'Acier 42CrMo4 Ø50', 1, 1, 'AcierPro DZ', 'Plaquette CNMG 120408, Foret Ø12', 'ARB-101-REV2', 'O0101_ARB_CNC1.nc', 'ARB-101.step', 'ok', null, 180, 115, Date.now() - 6900000, 1, 1],
      ['OF-2026-102', 'Bride de fixation hydraulique', 'HydroTech', 25, 0, '2026-11-23', 'Urgent', 'À acheter', 'Fraiseuse CNC 2', 'Yacine M.', 'Alu 7075 Plat 80x20', 0, 0, 'AluMag', 'Fraise Ø16 4 dents, Taraud M8', 'BRI-102-V1', 'O0102_BRIDE.nc', 'BRI-102.step', null, null, 240, 0, 0, 0, 2],
      ['OF-2026-103', 'Bague de centrage', 'Industrie Nord', 50, 50, '2026-11-21', 'Normal', 'À clôturer', 'Tour Conventionnel', 'Sofiane K.', 'Bronze CuSn12 Ø35', 1, 1, 'MétalPlus', 'Outil à aléser Ø20', 'BAG-103-FINAL', 'Manuel', 'BAG-103.pdf', 'ok', 'ok', 150, 135, 0, 1, 3]
    ];
    pieces.forEach(p => db.run('INSERT INTO pieces VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', p));
    saveDB();
  }
}

function logAudit(user, action, details) {
  runSql('INSERT INTO audit_logs VALUES (?,?,?,?,?,?)', [
    'log_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    user?.nom || 'Système',
    user?.role || 'system',
    action,
    details,
    new Date().toLocaleString('fr-FR')
  ]);
}

module.exports = { initDB, queryAll, queryOne, runSql, saveDB, hashPassword, logAudit };
