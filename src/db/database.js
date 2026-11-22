const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '../../atelier.db');
const BACKUP_DIR = path.join(__dirname, '../../backups');
let db;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function getDB() {
  if (!db) throw new Error('Base de données non initialisée');
  return db;
}

function queryAll(sql, params = []) {
  return getDB().prepare(sql).all(...params);
}

function queryOne(sql, params = []) {
  return getDB().prepare(sql).get(...params) || null;
}

function runSql(sql, params = []) {
  return getDB().prepare(sql).run(...params);
}

function transaction(fn) {
  return getDB().transaction(fn)();
}

function hasColumn(table, column) {
  const cols = queryAll(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

function tableExists(table) {
  return !!queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
}

function getNextOfId() {
  const year = new Date().getFullYear();
  const key = `OF-${year}`;
  return transaction(() => {
    const row = queryOne('SELECT lastValue FROM sequences WHERE key = ?', [key]);
    let next = 1;
    if (row) {
      next = row.lastValue + 1;
      runSql('UPDATE sequences SET lastValue = ? WHERE key = ?', [next, key]);
    } else {
      // Check existing pieces with this year prefix to avoid any collision
      const existing = queryAll("SELECT id FROM pieces WHERE id LIKE ?", [`${key}-%`]);
      const maxNum = existing.reduce((max, r) => {
        const num = parseInt(r.id.split('-').pop(), 10);
        return Number.isFinite(num) && num > max ? num : max;
      }, 0);
      next = maxNum + 1;
      runSql('INSERT INTO sequences (key, lastValue) VALUES (?, ?)', [key, next]);
    }
    return `${key}-${String(next).padStart(4, '0')}`;
  });
}

function logAudit(user, action, details) {
  runSql(
    'INSERT INTO audit_logs (id, userId, user, role, action, details, createdAt) VALUES (?,?,?,?,?,?,?)',
    [
      'log_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      user?.id || null,
      user?.nom || 'Système',
      user?.role || 'system',
      action,
      details,
      new Date().toLocaleString('fr-FR')
    ]
  );
}

async function backupDB(tag = 'auto') {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(BACKUP_DIR, `atelier_${tag}_${stamp}.db`);
  await getDB().backup(target);
  // Keep only the 20 most recent backups to avoid filling disk
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .sort()
    .reverse();
  files.slice(20).forEach(f => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
  });
  return path.basename(target);
}

function syncPieceFromOperations(pieceId) {
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [pieceId]);
  if (!piece) return;
  const ops = queryAll('SELECT * FROM operations WHERE pieceId = ? ORDER BY ordre ASC, rowid ASC', [pieceId]);
  if (ops.length === 0) return;

  const totalPrevu = ops.reduce((s, o) => s + (o.tempsPrevuMin || 0), 0);
  const totalReel = ops.reduce((s, o) => s + (o.tempsReelMin || 0), 0);
  const totalRebut = ops.reduce((s, o) => s + (o.quantiteRebut || 0), 0);

  const runningOp = ops.find(o => o.statut === 'En cours');
  const panneOp = ops.find(o => o.statut === 'Panne machine');
  const pausedOp = ops.find(o => o.statut === 'En pause');
  const nextPendingOp = ops.find(o => o.statut !== 'Terminée');
  const lastOp = ops[ops.length - 1];
  const allDone = ops.every(o => o.statut === 'Terminée');
  const anyStarted = ops.some(o => o.statut !== 'En attente');

  const currentOp = runningOp || panneOp || pausedOp || nextPendingOp || lastOp;

  let statut = piece.statut;
  if (piece.statut !== 'Clôturé') {
    if (!piece.chuteDispo && !piece.achatFait && !anyStarted) {
      statut = 'À acheter';
    } else if (panneOp) {
      statut = 'Panne machine';
    } else if (runningOp) {
      statut = 'En cours';
    } else if (pausedOp) {
      statut = 'En pause';
    } else if (allDone) {
      statut = 'À clôturer';
    } else if (anyStarted) {
      statut = 'Prêt atelier';
    } else if (piece.statut === 'À acheter' && (piece.chuteDispo || piece.achatFait)) {
      statut = 'Prêt atelier';
    }
  }

  let quantiteRealisee = piece.quantiteRealisee;
  if (allDone) {
    quantiteRealisee = lastOp.quantiteBonne || 0;
  } else if (ops.length === 1) {
    quantiteRealisee = ops[0].quantiteBonne || 0;
  } else {
    // Show finished quantity of last op if started, else keep count of last finished op for visibility
    const lastDone = [...ops].reverse().find(o => o.statut === 'Terminée');
    quantiteRealisee = lastOp.quantiteBonne > 0 ? lastOp.quantiteBonne : (lastDone ? lastDone.quantiteBonne : (currentOp?.quantiteBonne || 0));
  }

  const startedAt = runningOp ? (runningOp.startedAt || 0) : 0;
  const firstStart = ops.find(o => o.debutStr)?.debutStr || piece.debutStr || '';
  const lastEnd = [...ops].reverse().find(o => o.finStr)?.finStr || piece.finStr || '';

  runSql(
    `UPDATE pieces
     SET machineId = ?, operateurId = ?, tempsPrevuMin = ?, tempsReelMin = ?,
         quantiteRealisee = ?, quantiteRebut = ?, statut = ?, startedAt = ?,
         debutStr = ?, finStr = ?
     WHERE id = ?`,
    [
      currentOp?.machineId ?? piece.machineId,
      currentOp?.operateurId ?? piece.operateurId,
      totalPrevu > 0 ? totalPrevu : piece.tempsPrevuMin,
      totalReel,
      quantiteRealisee,
      totalRebut,
      statut,
      startedAt,
      firstStart,
      lastEnd,
      pieceId
    ]
  );
}

function getEnrichedPieces(whereClause = '', params = []) {
  const pieces = queryAll(
    `SELECT p.*,
            m.nom AS machine,
            m.type AS machineType,
            m.actif AS machineActif,
            m.enPanne AS machineEnPanne,
            m.tauxHoraire AS machineTauxHoraire,
            u.nom AS operateur,
            u.username AS operateurUsername
     FROM pieces p
     LEFT JOIN machines m ON m.id = p.machineId
     LEFT JOIN users u ON u.id = p.operateurId
     ${whereClause}
     ORDER BY p.ordrePlanning ASC, p.id ASC`,
    params
  );

  const allOps = queryAll(
    `SELECT o.*,
            m.nom AS machine,
            m.type AS machineType,
            m.actif AS machineActif,
            m.enPanne AS machineEnPanne,
            m.tauxHoraire AS machineTauxHoraire,
            u.nom AS operateur,
            u.username AS operateurUsername
     FROM operations o
     LEFT JOIN machines m ON m.id = o.machineId
     LEFT JOIN users u ON u.id = o.operateurId
     ORDER BY o.ordre ASC, o.rowid ASC`
  );

  const opsByPiece = new Map();
  for (const op of allOps) {
    if (!opsByPiece.has(op.pieceId)) opsByPiece.set(op.pieceId, []);
    opsByPiece.get(op.pieceId).push({
      ...op,
      machine: op.machine || 'Non affectée',
      operateur: op.operateur || 'Non affecté',
      machineActif: op.machineActif === null ? true : !!op.machineActif,
      machineEnPanne: !!op.machineEnPanne
    });
  }

  return pieces.map(p => {
    const operations = opsByPiece.get(p.id) || [];
    const opsTerminees = operations.filter(o => o.statut === 'Terminée').length;
    const opsTotal = operations.length;
    // Compute overall progress percentage across operations + quantity
    let progressPct = 0;
    if (p.statut === 'Clôturé' || (opsTotal > 0 && opsTerminees === opsTotal)) {
      progressPct = 100;
    } else if (opsTotal > 0) {
      const sumFrac = operations.reduce((acc, o) => {
        if (o.statut === 'Terminée') return acc + 1;
        if (o.quantiteBonne > 0 && p.quantitePrevue > 0) {
          return acc + Math.min(0.95, o.quantiteBonne / p.quantitePrevue);
        }
        return acc;
      }, 0);
      progressPct = Math.min(100, Math.round((sumFrac / opsTotal) * 100));
    } else {
      progressPct = Math.min(100, Math.round(((p.quantiteRealisee || 0) / (p.quantitePrevue || 1)) * 100));
    }

    return {
      ...p,
      machine: p.machine || 'Non affectée',
      operateur: p.operateur || 'Non affecté',
      machineActif: p.machineActif === null ? true : !!p.machineActif,
      machineEnPanne: !!p.machineEnPanne,
      chuteDispo: !!p.chuteDispo,
      achatFait: !!p.achatFait,
      planningValide: !!p.planningValide,
      be: {
        nomFichier: p.beNomFichier || '',
        programme: p.beProgramme || '',
        dessin3d: p.beDessin3d || ''
      },
      operations,
      opsTerminees,
      opsTotal,
      progressPct
    };
  });
}

function getEnrichedPannes() {
  return queryAll(
    `SELECT pa.*,
            m.nom AS machineNom,
            p.nom AS pieceNom,
            o.libelle AS operationLibelle,
            u.nom AS declareParNom
     FROM pannes pa
     LEFT JOIN machines m ON m.id = pa.machineId
     LEFT JOIN pieces p ON p.id = pa.pieceId
     LEFT JOIN operations o ON o.id = pa.operationId
     LEFT JOIN users u ON u.id = pa.declareParId
     ORDER BY CASE WHEN pa.statut = 'Ouverte' THEN 0 ELSE 1 END, pa.rowid DESC
     LIMIT 50`
  ).map(r => ({
    ...r,
    machineNom: r.machineNom || 'Machine inconnue',
    declarePar: r.declareParNom || r.declarePar || 'Opérateur'
  }));
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nom TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operateur',
      actif INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      nom TEXT NOT NULL,
      type TEXT DEFAULT 'Usinage',
      tauxHoraire REAL DEFAULT 2500,
      capaciteJourMin INTEGER DEFAULT 480,
      actif INTEGER DEFAULT 1,
      enPanne INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sequences (
      key TEXT PRIMARY KEY,
      lastValue INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      userId TEXT,
      user TEXT,
      role TEXT,
      action TEXT,
      details TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS pieces (
      id TEXT PRIMARY KEY,
      nom TEXT NOT NULL,
      client TEXT DEFAULT 'Client',
      quantitePrevue INTEGER NOT NULL DEFAULT 1,
      quantiteRealisee INTEGER DEFAULT 0,
      quantiteRebut INTEGER DEFAULT 0,
      delai TEXT,
      urgence TEXT DEFAULT 'Normal',
      statut TEXT DEFAULT 'À planifier',
      machineId TEXT REFERENCES machines(id) ON DELETE SET NULL,
      operateurId TEXT REFERENCES users(id) ON DELETE SET NULL,
      matiere TEXT DEFAULT 'À définir',
      chuteDispo INTEGER DEFAULT 0,
      achatFait INTEGER DEFAULT 0,
      fournisseur TEXT DEFAULT 'À définir',
      outils TEXT DEFAULT 'À définir',
      beNomFichier TEXT DEFAULT '',
      beProgramme TEXT DEFAULT '',
      beDessin3d TEXT DEFAULT '',
      photoDebut TEXT,
      photoFin TEXT,
      tempsPrevuMin INTEGER DEFAULT 120,
      tempsReelMin INTEGER DEFAULT 0,
      startedAt INTEGER DEFAULT 0,
      debutStr TEXT DEFAULT '',
      finStr TEXT DEFAULT '',
      planningValide INTEGER DEFAULT 0,
      ordrePlanning INTEGER DEFAULT 1,
      prixEstime REAL DEFAULT 0,
      prixFinal REAL DEFAULT 0,
      notesQualite TEXT DEFAULT '',
      createdAt TEXT,
      closedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      pieceId TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
      ordre INTEGER NOT NULL DEFAULT 10,
      libelle TEXT NOT NULL,
      machineId TEXT REFERENCES machines(id) ON DELETE SET NULL,
      operateurId TEXT REFERENCES users(id) ON DELETE SET NULL,
      tempsPrevuMin INTEGER DEFAULT 60,
      tempsReelMin INTEGER DEFAULT 0,
      startedAt INTEGER DEFAULT 0,
      statut TEXT DEFAULT 'En attente',
      quantiteBonne INTEGER DEFAULT 0,
      quantiteRebut INTEGER DEFAULT 0,
      motifRebut TEXT DEFAULT '',
      photoDebut TEXT,
      photoFin TEXT,
      debutStr TEXT DEFAULT '',
      finStr TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pannes (
      id TEXT PRIMARY KEY,
      machineId TEXT REFERENCES machines(id) ON DELETE SET NULL,
      pieceId TEXT REFERENCES pieces(id) ON DELETE SET NULL,
      operationId TEXT REFERENCES operations(id) ON DELETE SET NULL,
      declareParId TEXT REFERENCES users(id) ON DELETE SET NULL,
      declarePar TEXT,
      motif TEXT,
      statut TEXT DEFAULT 'Ouverte',
      createdAt TEXT,
      resolvedAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pieces_machine ON pieces(machineId);
    CREATE INDEX IF NOT EXISTS idx_pieces_operateur ON pieces(operateurId);
    CREATE INDEX IF NOT EXISTS idx_operations_piece ON operations(pieceId);
    CREATE INDEX IF NOT EXISTS idx_operations_operateur ON operations(operateurId);
    CREATE INDEX IF NOT EXISTS idx_operations_machine ON operations(machineId);
    CREATE INDEX IF NOT EXISTS idx_pannes_statut ON pannes(statut);
  `);
}

function migrateLegacySchemaIfNeeded() {
  // Add missing columns safely if upgrading from an older atelier.db
  if (tableExists('users') && !hasColumn('users', 'actif')) {
    db.exec('ALTER TABLE users ADD COLUMN actif INTEGER DEFAULT 1');
  }
  if (tableExists('machines')) {
    if (!hasColumn('machines', 'tauxHoraire')) db.exec('ALTER TABLE machines ADD COLUMN tauxHoraire REAL DEFAULT 2500');
    if (!hasColumn('machines', 'capaciteJourMin')) db.exec('ALTER TABLE machines ADD COLUMN capaciteJourMin INTEGER DEFAULT 480');
    if (!hasColumn('machines', 'enPanne')) db.exec('ALTER TABLE machines ADD COLUMN enPanne INTEGER DEFAULT 0');
  }
  if (tableExists('audit_logs') && !hasColumn('audit_logs', 'userId')) {
    db.exec('ALTER TABLE audit_logs ADD COLUMN userId TEXT');
  }
  if (tableExists('pieces')) {
    const additions = [
      ['quantiteRebut', 'INTEGER DEFAULT 0'],
      ['machineId', 'TEXT'],
      ['operateurId', 'TEXT'],
      ['debutStr', "TEXT DEFAULT ''"],
      ['finStr', "TEXT DEFAULT ''"],
      ['prixEstime', 'REAL DEFAULT 0'],
      ['prixFinal', 'REAL DEFAULT 0'],
      ['notesQualite', "TEXT DEFAULT ''"],
      ['createdAt', 'TEXT'],
      ['closedAt', 'TEXT']
    ];
    for (const [col, def] of additions) {
      if (!hasColumn('pieces', col)) {
        db.exec(`ALTER TABLE pieces ADD COLUMN ${col} ${def}`);
      }
    }

    // Backfill machineId / operateurId from legacy text columns if present
    if (hasColumn('pieces', 'machine')) {
      const legacy = queryAll('SELECT id, machine, operateur, tempsPrevuMin, tempsReelMin, startedAt, statut, quantiteRealisee, photoDebut, photoFin FROM pieces WHERE machineId IS NULL');
      for (const p of legacy) {
        const m = p.machine ? queryOne('SELECT id FROM machines WHERE nom = ?', [p.machine]) : null;
        const u = p.operateur ? queryOne('SELECT id FROM users WHERE nom = ?', [p.operateur]) : null;
        runSql('UPDATE pieces SET machineId = ?, operateurId = ? WHERE id = ?', [m?.id || null, u?.id || null, p.id]);
      }
    }

    // Ensure every existing piece has at least one operation in the operations table
    const piecesWithoutOps = queryAll('SELECT * FROM pieces WHERE id NOT IN (SELECT DISTINCT pieceId FROM operations)');
    for (const p of piecesWithoutOps) {
      const opStatut =
        p.statut === 'Clôturé' || p.statut === 'À clôturer' ? 'Terminée' :
        p.statut === 'En cours' ? 'En cours' :
        p.statut === 'En pause' ? 'En pause' :
        p.statut === 'Panne machine' ? 'Panne machine' :
        'En attente';
      runSql(
        `INSERT INTO operations (id, pieceId, ordre, libelle, machineId, operateurId, tempsPrevuMin, tempsReelMin, startedAt, statut, quantiteBonne, quantiteRebut, photoDebut, photoFin, debutStr, finStr)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          `op_${p.id}_10`, p.id, 10, 'Usinage principal', p.machineId, p.operateurId,
          p.tempsPrevuMin || 120, p.tempsReelMin || 0, p.startedAt || 0, opStatut,
          p.quantiteRealisee || 0, p.quantiteRebut || 0, p.photoDebut || null, p.photoFin || null,
          p.debutStr || '', p.finStr || ''
        ]
      );
    }
  }
}

function seedInitialData() {
  const userCount = queryOne('SELECT COUNT(*) AS c FROM users').c;
  if (userCount > 0) return;

  transaction(() => {
    const users = [
      ['u1', 'Directeur', 'directeur', hashPassword('1234'), 'directeur', 1],
      ['u2', 'Bureau Études', 'be', hashPassword('1234'), 'be', 1],
      ['u3', 'Chef Atelier', 'chef', hashPassword('1234'), 'chef', 1],
      ['u4', 'Karim B.', 'karim', hashPassword('1234'), 'operateur', 1],
      ['u5', 'Yacine M.', 'yacine', hashPassword('1234'), 'operateur', 1],
      ['u6', 'Sofiane K.', 'sofiane', hashPassword('1234'), 'operateur', 1]
    ];
    for (const u of users) {
      runSql('INSERT INTO users (id, nom, username, passwordHash, role, actif) VALUES (?,?,?,?,?,?)', u);
    }

    const machines = [
      ['m1', 'Tour CNC 1', 'Tournage CNC', 2800, 480, 1, 0],
      ['m2', 'Fraiseuse CNC 2', 'Fraisage CNC', 3000, 480, 1, 0],
      ['m3', 'Tour Conventionnel', 'Tournage Manuel', 1800, 480, 1, 0],
      ['m4', 'Poste Contrôle Qualité', 'Métrologie / Contrôle', 1500, 480, 1, 0]
    ];
    for (const m of machines) {
      runSql('INSERT INTO machines (id, nom, type, tauxHoraire, capaciteJourMin, actif, enPanne) VALUES (?,?,?,?,?,?,?)', m);
    }

    const nowStr = new Date().toLocaleString('fr-FR');
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const pieces = [
      [
        'OF-2026-0101', 'Arbre de transmission Ø45', 'SARL MécaSud', 10, 6, 0,
        today, 'Critique', 'En cours', 'm1', 'u4', 'Acier 42CrMo4 Ø50',
        1, 1, 'AcierPro DZ', 'Plaquette CNMG 120408, Foret Ø12',
        'ARB-101-REV2', 'O0101_ARB_CNC1.nc', 'ARB-101.step',
        'ok', null, 180, 115, Date.now() - 1800000, '08:00', '11:00',
        1, 1, 0, 0, '', nowStr, null
      ],
      [
        'OF-2026-0102', 'Bride de fixation hydraulique', 'HydroTech', 25, 0, 0,
        tomorrow, 'Urgent', 'À acheter', 'm2', 'u5', 'Alu 7075 Plat 80x20',
        0, 0, 'AluMag', 'Fraise Ø16 4 dents, Taraud M8',
        'BRI-102-V1', 'O0102_BRIDE.nc', 'BRI-102.step',
        null, null, 240, 0, 0, '08:00', '12:00',
        0, 2, 0, 0, '', nowStr, null
      ],
      [
        'OF-2026-0103', 'Bague de centrage', 'Industrie Nord', 50, 49, 1,
        yesterday, 'Normal', 'À clôturer', 'm3', 'u6', 'Bronze CuSn12 Ø35',
        1, 1, 'MétalPlus', 'Outil à aléser Ø20',
        'BAG-103-FINAL', 'Manuel', 'BAG-103.pdf',
        'ok', 'ok', 150, 135, 0, '08:00', '10:30',
        1, 3, 0, 0, '1 pièce hors tolérance alésage', nowStr, null
      ]
    ];

    for (const p of pieces) {
      runSql(
        `INSERT INTO pieces (
          id, nom, client, quantitePrevue, quantiteRealisee, quantiteRebut,
          delai, urgence, statut, machineId, operateurId, matiere,
          chuteDispo, achatFait, fournisseur, outils,
          beNomFichier, beProgramme, beDessin3d,
          photoDebut, photoFin, tempsPrevuMin, tempsReelMin, startedAt, debutStr, finStr,
          planningValide, ordrePlanning, prixEstime, prixFinal, notesQualite, createdAt, closedAt
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p
      );
    }

    // Realistic multi-operation gammes!
    const ops = [
      // OF-2026-0101: Op 10 Tournage CNC (En cours), Op 20 Fraisage rainure clavette (En attente)
      ['op_101_10', 'OF-2026-0101', 10, 'Tournage CNC (ébauche + finition)', 'm1', 'u4', 120, 85, Date.now() - 1800000, 'En cours', 6, 0, '', 'ok', null, '08:00', '10:00'],
      ['op_101_20', 'OF-2026-0101', 20, 'Fraisage rainure clavette', 'm2', 'u5', 60, 0, 0, 'En attente', 0, 0, '', null, null, '10:00', '11:00'],
      // OF-2026-0102: Op 10 Fraisage CNC, Op 20 Contrôle qualité
      ['op_102_10', 'OF-2026-0102', 10, 'Fraisage CNC + taraudage M8', 'm2', 'u5', 210, 0, 0, 'En attente', 0, 0, '', null, null, '08:00', '11:30'],
      ['op_102_20', 'OF-2026-0102', 20, 'Contrôle dimensionnel', 'm4', 'u6', 30, 0, 0, 'En attente', 0, 0, '', null, null, '11:30', '12:00'],
      // OF-2026-0103: Op 10 Tournage conventionnel (Terminée)
      ['op_103_10', 'OF-2026-0103', 10, 'Tournage + alésage Ø20', 'm3', 'u6', 150, 135, 0, 'Terminée', 49, 1, 'Côte alésage hors tolérance', 'ok', 'ok', '08:00', '10:30']
    ];
    for (const o of ops) {
      runSql(
        `INSERT INTO operations (
          id, pieceId, ordre, libelle, machineId, operateurId,
          tempsPrevuMin, tempsReelMin, startedAt, statut,
          quantiteBonne, quantiteRebut, motifRebut, photoDebut, photoFin, debutStr, finStr
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        o
      );
    }

    runSql('INSERT OR REPLACE INTO sequences (key, lastValue) VALUES (?, ?)', [`OF-${new Date().getFullYear()}`, 103]);
  });
}

async function initDB() {
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  createSchema();
  migrateLegacySchemaIfNeeded();
  seedInitialData();

  // Sync all pieces with their operations on startup
  const pieces = queryAll('SELECT id FROM pieces');
  for (const p of pieces) {
    syncPieceFromOperations(p.id);
  }

  // Create one daily automatic backup if not yet present today
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const todayPrefix = `atelier_auto_${new Date().toISOString().slice(0, 10)}`;
    const existsToday = fs.readdirSync(BACKUP_DIR).some(f => f.startsWith(todayPrefix));
    if (!existsToday) {
      await backupDB('auto');
    }
  } catch (err) {
    console.warn('Avertissement backup initial:', err.message);
  }

  return db;
}

module.exports = {
  initDB,
  getDB,
  queryAll,
  queryOne,
  runSql,
  transaction,
  hashPassword,
  logAudit,
  getNextOfId,
  backupDB,
  syncPieceFromOperations,
  getEnrichedPieces,
  getEnrichedPannes
};
