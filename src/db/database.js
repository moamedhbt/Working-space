const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '../../atelier.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../../backups');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
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

function getSettings() {
  const rows = queryAll('SELECT key, value FROM atelier_settings');
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  let workDays = [0, 1, 2, 3, 4]; // Dimanche -> Jeudi (standard Algérie)
  try {
    if (map.workDays) workDays = JSON.parse(map.workDays);
  } catch {}
  return {
    workDays,
    shiftStart: map.shiftStart || '08:00',
    shiftEnd: map.shiftEnd || '17:00'
  };
}

function saveSettings({ workDays, shiftStart, shiftEnd }) {
  transaction(() => {
    if (Array.isArray(workDays)) {
      runSql('INSERT OR REPLACE INTO atelier_settings (key, value) VALUES (?, ?)', ['workDays', JSON.stringify(workDays)]);
    }
    if (shiftStart) {
      runSql('INSERT OR REPLACE INTO atelier_settings (key, value) VALUES (?, ?)', ['shiftStart', shiftStart]);
    }
    if (shiftEnd) {
      runSql('INSERT OR REPLACE INTO atelier_settings (key, value) VALUES (?, ?)', ['shiftEnd', shiftEnd]);
    }
  });
}

const AI_PROVIDERS_META = [
  { id: 'auto', label: 'Automatique (détection selon clé)', defaultModel: '', note: 'Choisit automatiquement le provider actif' },
  { id: 'gemini', label: 'Google Gemini (Recommandé — Gratuit/Éco + PDF & photos 2D)', defaultModel: 'gemini-3.8-flash', note: 'Lit directement images JPG/PNG et PDF nativement' },
  { id: 'openai', label: 'OpenAI (GPT-4o / GPT-4o-mini)', defaultModel: 'gpt-4o-mini', note: 'Très fiable sur plans mécaniques et JSON structuré' },
  { id: 'anthropic', label: 'Anthropic Claude (Sonnet 4)', defaultModel: 'claude-sonnet-4-20250514', note: 'Excellente compréhension technique & CAO' },
  { id: 'openrouter', label: 'OpenRouter (1 clé → tous les modèles)', defaultModel: 'google/gemini-3.8-flash', note: 'Permet de changer Gemini/Claude/GPT/Qwen sans changer de compte' },
  { id: 'groq', label: 'Groq (Vision ultra-rapide)', defaultModel: 'meta-llama/llama-4-scout-17b-16e-instruct', note: 'Rapide, quota gratuit généreux' },
  { id: 'custom', label: 'Endpoint personnalisé (Compatible OpenAI / Ollama)', defaultModel: 'llava', note: 'Serveur local Ollama, LM Studio, Mistral, DeepSeek, etc.' }
];

function maskSecretKey(k) {
  const s = String(k || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function getAiSettings() {
  const rows = queryAll("SELECT key, value FROM atelier_settings WHERE key LIKE 'ai_%'");
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  const dbProvider = (map.ai_provider || 'auto').trim();
  const dbApiKey = (map.ai_api_key || '').trim();
  const dbModel = (map.ai_model || '').trim();
  const dbBaseUrl = (map.ai_base_url || '').trim();

  if (dbApiKey || (dbProvider === 'custom' && dbBaseUrl)) {
    let resolvedProvider = dbProvider;
    if (resolvedProvider === 'auto') {
      if (dbApiKey.startsWith('AIza')) resolvedProvider = 'gemini';
      else if (dbApiKey.startsWith('sk-ant-')) resolvedProvider = 'anthropic';
      else if (dbApiKey.startsWith('sk-or-')) resolvedProvider = 'openrouter';
      else if (dbApiKey.startsWith('gsk_')) resolvedProvider = 'groq';
      else resolvedProvider = 'openai';
    }
    return {
      provider: dbProvider,
      resolvedProvider,
      apiKey: dbApiKey,
      model: dbModel,
      baseUrl: dbBaseUrl,
      source: 'database'
    };
  }

  // Fallback to environment variables if no DB key configured
  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', resolvedProvider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: dbModel || 'gemini-3.8-flash', baseUrl: '', source: 'env' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', resolvedProvider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: dbModel || 'gpt-4o-mini', baseUrl: '', source: 'env' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', resolvedProvider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: dbModel || 'claude-sonnet-4-20250514', baseUrl: '', source: 'env' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: 'openrouter', resolvedProvider: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY, model: dbModel || 'google/gemini-3.8-flash', baseUrl: '', source: 'env' };
  }
  if (process.env.GROQ_API_KEY) {
    return { provider: 'groq', resolvedProvider: 'groq', apiKey: process.env.GROQ_API_KEY, model: dbModel || 'meta-llama/llama-4-scout-17b-16e-instruct', baseUrl: '', source: 'env' };
  }

  return {
    provider: dbProvider || 'auto',
    resolvedProvider: 'offline',
    apiKey: '',
    model: dbModel,
    baseUrl: dbBaseUrl,
    source: 'offline'
  };
}

function getAiSettingsPublic() {
  const cfg = getAiSettings();
  return {
    provider: cfg.provider,
    resolvedProvider: cfg.resolvedProvider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    hasApiKey: !!cfg.apiKey,
    maskedKey: maskSecretKey(cfg.apiKey),
    source: cfg.source,
    availableProviders: AI_PROVIDERS_META
  };
}

function saveAiSettings({ provider, apiKey, model, baseUrl, clearKey }) {
  const allowed = new Set(AI_PROVIDERS_META.map(p => p.id));
  transaction(() => {
    if (provider !== undefined) {
      const clean = allowed.has(String(provider).trim()) ? String(provider).trim() : 'auto';
      runSql('INSERT OR REPLACE INTO atelier_settings (key, value) VALUES (?, ?)', ['ai_provider', clean]);
    }
    if (clearKey) {
      runSql("DELETE FROM atelier_settings WHERE key = 'ai_api_key'");
    } else if (apiKey !== undefined && String(apiKey).trim() !== '') {
      runSql('INSERT OR REPLACE INTO atelier_settings (key, value) VALUES (?, ?)', ['ai_api_key', String(apiKey).trim()]);
    }
    if (model !== undefined) {
      runSql('INSERT OR REPLACE INTO atelier_settings (key, value) VALUES (?, ?)', ['ai_model', String(model).trim()]);
    }
    if (baseUrl !== undefined) {
      runSql('INSERT OR REPLACE INTO atelier_settings (key, value) VALUES (?, ?)', ['ai_base_url', String(baseUrl).trim()]);
    }
  });
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
      const existing = queryAll('SELECT id FROM pieces WHERE id LIKE ?', [`${key}-%`]);
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

function nextRevisionLabel(pieceId, categorie) {
  const count = queryOne(
    'SELECT COUNT(*) AS c FROM be_files WHERE pieceId = ? AND categorie = ?',
    [pieceId, categorie]
  ).c;
  const letter = String.fromCharCode(65 + (count % 26));
  const cycle = count >= 26 ? Math.floor(count / 26) + 1 : '';
  return `Rev ${letter}${cycle}`;
}

function computeOpPlannedMin(tempsReglageMin, tempsUnitaireMin, quantitePrevue, fallbackMin = 60) {
  const reg = Math.max(0, Number(tempsReglageMin) || 0);
  const unit = Math.max(0, Number(tempsUnitaireMin) || 0);
  const qty = Math.max(1, Number(quantitePrevue) || 1);
  if (unit > 0) {
    return Math.max(5, Math.round(reg + unit * qty));
  }
  return Math.max(5, Math.round(Number(fallbackMin) || reg || 60));
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

function logPieceEvent(pieceId, user, eventType, title, details = '') {
  if (!pieceId) return;
  runSql(
    `INSERT INTO piece_events (id, pieceId, userId, userNom, userRole, eventType, title, details, createdAt, createdAtMs)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      'evt_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      pieceId,
      user?.id || null,
      user?.nom || 'Système',
      user?.role || 'system',
      eventType || 'info',
      title,
      details,
      new Date().toLocaleString('fr-FR'),
      Date.now()
    ]
  );
}

async function restoreDBFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    throw new Error('Fichier de sauvegarde invalide');
  }
  const header = buffer.subarray(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('Le fichier envoyé n’est pas une base SQLite (.db) valide');
  }

  const tmpPath = path.join(BACKUP_DIR, `restore_check_${Date.now()}.db`);
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(tmpPath, buffer);

  let testDb;
  try {
    testDb = new Database(tmpPath, { readonly: true });
    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    if (!tables.includes('users') || !tables.includes('pieces')) {
      throw new Error('Base SQLite incompatible (tables users/pieces manquantes)');
    }
  } finally {
    if (testDb) testDb.close();
  }

  // Backup current DB before swapping
  try { await backupDB('pre_restore'); } catch {}

  if (db) {
    db.close();
    db = null;
  }
  for (const suffix of ['-wal', '-shm']) {
    try { if (fs.existsSync(DB_FILE + suffix)) fs.unlinkSync(DB_FILE + suffix); } catch {}
  }
  fs.copyFileSync(tmpPath, DB_FILE);
  try { fs.unlinkSync(tmpPath); } catch {}

  await initDB();
}

async function backupDB(tag = 'auto') {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(BACKUP_DIR, `atelier_${tag}_${stamp}.db`);
  await getDB().backup(target);
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

  // Ensure each operation's tempsPrevuMin stays synced if tempsUnitaireMin > 0
  let totalPrevu = 0;
  for (const o of ops) {
    let planned = o.tempsPrevuMin || 60;
    if (Number(o.tempsUnitaireMin) > 0) {
      planned = computeOpPlannedMin(o.tempsReglageMin, o.tempsUnitaireMin, piece.quantitePrevue, planned);
      if (planned !== o.tempsPrevuMin) {
        runSql('UPDATE operations SET tempsPrevuMin = ? WHERE id = ?', [planned, o.id]);
        o.tempsPrevuMin = planned;
      }
    }
    totalPrevu += planned;
  }

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
  if (piece.statut !== 'Clôturé' && piece.statut !== 'Refusé') {
    if (piece.validationDirection === 0) {
      statut = 'À valider';
    } else if (!piece.chuteDispo && !piece.achatFait && !anyStarted) {
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
    } else if ((piece.beValide || piece.beNonRequis) && piece.chefValide && (piece.chuteDispo || piece.achatFait)) {
      statut = 'Prêt atelier';
    }
  }

  let quantiteRealisee = piece.quantiteRealisee;
  if (allDone) {
    quantiteRealisee = lastOp.quantiteBonne || 0;
  } else if (ops.length === 1) {
    quantiteRealisee = ops[0].quantiteBonne || 0;
  } else {
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

  const allBeFiles = queryAll(
    `SELECT f.*, u.nom AS uploaderNom
     FROM be_files f
     LEFT JOIN users u ON u.id = f.uploadedById
     ORDER BY f.isActive DESC, f.rowid DESC`
  );

  const allEvents = queryAll(
    `SELECT * FROM piece_events ORDER BY createdAtMs DESC, rowid DESC`
  );

  const allStops = queryAll(
    `SELECT s.*, m.nom AS machineNom, o.libelle AS operationLibelle
     FROM operation_stops s
     LEFT JOIN machines m ON m.id = s.machineId
     LEFT JOIN operations o ON o.id = s.operationId
     ORDER BY CASE WHEN s.statut = 'Ouvert' THEN 0 ELSE 1 END, s.createdAtMs DESC`
  );

  const opsByPiece = new Map();
  for (const op of allOps) {
    if (!opsByPiece.has(op.pieceId)) opsByPiece.set(op.pieceId, []);
    opsByPiece.get(op.pieceId).push({
      ...op,
      machine: op.estSousTraitance ? `Sous-traitance (${op.sousTraitant || 'Externe'})` : (op.machine || 'Non affectée'),
      operateur: op.estSousTraitance ? (op.sousTraitant || 'Sous-traitant') : (op.operateur || 'Non affecté'),
      machineActif: op.machineActif === null ? true : !!op.machineActif,
      machineEnPanne: !!op.machineEnPanne,
      estSousTraitance: !!op.estSousTraitance
    });
  }

  const filesByPiece = new Map();
  for (const f of allBeFiles) {
    if (!filesByPiece.has(f.pieceId)) filesByPiece.set(f.pieceId, []);
    filesByPiece.get(f.pieceId).push({
      ...f,
      isActive: !!f.isActive,
      uploadedBy: f.uploaderNom || f.uploadedBy || 'BE'
    });
  }

  const eventsByPiece = new Map();
  for (const ev of allEvents) {
    if (!eventsByPiece.has(ev.pieceId)) eventsByPiece.set(ev.pieceId, []);
    eventsByPiece.get(ev.pieceId).push(ev);
  }

  const stopsByPiece = new Map();
  for (const st of allStops) {
    if (!stopsByPiece.has(st.pieceId)) stopsByPiece.set(st.pieceId, []);
    stopsByPiece.get(st.pieceId).push(st);
  }

  return pieces.map(p => {
    const operations = opsByPiece.get(p.id) || [];
    const beFiles = filesByPiece.get(p.id) || [];
    const events = eventsByPiece.get(p.id) || [];
    const stops = stopsByPiece.get(p.id) || [];
    const opsTerminees = operations.filter(o => o.statut === 'Terminée').length;
    const opsTotal = operations.length;
    const totalReglageMin = operations.reduce((s, o) => s + (o.tempsReglageMin || 0), 0);

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

    const activeClient = beFiles.find(f => f.categorie === 'client' && f.isActive) || null;
    const activePlan = beFiles.find(f => f.categorie === 'plan' && f.isActive) || null;
    const activeCnc = beFiles.find(f => f.categorie === 'cnc' && f.isActive) || null;
    const active3d = beFiles.find(f => f.categorie === '3d' && f.isActive) || null;

    let cadSpec = null;
    let ficheTechnique = null;
    let beChat = [];
    try { if (p.cadSpecJson) cadSpec = JSON.parse(p.cadSpecJson); } catch {}
    try { if (p.ficheTechniqueJson) ficheTechnique = JSON.parse(p.ficheTechniqueJson); } catch {}
    try { if (p.beChatJson) beChat = JSON.parse(p.beChatJson); } catch {}

    return {
      ...p,
      cadSpec,
      ficheTechnique,
      beChat: Array.isArray(beChat) ? beChat : [],
      machine: p.machine || 'Non affectée',
      operateur: p.operateur || 'Non affecté',
      machineActif: p.machineActif === null ? true : !!p.machineActif,
      machineEnPanne: !!p.machineEnPanne,
      chuteDispo: !!p.chuteDispo,
      achatFait: !!p.achatFait,
      planningValide: !!p.planningValide,
      archived: !!p.archived,
      validationDirection: p.validationDirection !== 0,
      beValide: !!p.beValide,
      beNonRequis: !!p.beNonRequis,
      chefValide: !!p.chefValide,
      estRepriseEnCours: !!p.estRepriseEnCours,
      be: {
        nomFichier: activePlan?.filename || p.beNomFichier || '',
        programme: activeCnc?.filename || p.beProgramme || '',
        dessin3d: active3d?.filename || p.beDessin3d || '',
        clientFile: activeClient,
        planFile: activePlan,
        cncFile: activeCnc,
        model3dFile: active3d
      },
      beFiles,
      events,
      stops,
      openStopsCount: stops.filter(s => s.statut === 'Ouvert').length,
      operations,
      opsTerminees,
      opsTotal,
      totalReglageMin,
      progressPct
    };
  });
}

function getEnrichedStops() {
  return queryAll(
    `SELECT s.*, m.nom AS machineNom, p.nom AS pieceNom, o.libelle AS operationLibelle
     FROM operation_stops s
     LEFT JOIN machines m ON m.id = s.machineId
     LEFT JOIN pieces p ON p.id = s.pieceId
     LEFT JOIN operations o ON o.id = s.operationId
     ORDER BY CASE WHEN s.statut = 'Ouvert' THEN 0 ELSE 1 END, s.createdAtMs DESC
     LIMIT 150`
  );
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
     LIMIT 100`
  ).map(r => ({
    ...r,
    machineNom: r.machineNom || 'Machine inconnue',
    declarePar: r.declareParNom || r.declarePar || 'Opérateur'
  }));
}

function getMaintenanceLogs() {
  return queryAll(
    `SELECT ml.*, m.nom AS machineNom
     FROM maintenance_logs ml
     LEFT JOIN machines m ON m.id = ml.machineId
     ORDER BY ml.rowid DESC
     LIMIT 50`
  );
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS atelier_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

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
      enPanne INTEGER DEFAULT 0,
      heuresCompteur REAL DEFAULT 0,
      intervalleEntretienH REAL DEFAULT 200,
      dernierEntretienH REAL DEFAULT 0,
      dernierEntretienDate TEXT DEFAULT ''
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
      archived INTEGER DEFAULT 0,
      typeMachine TEXT DEFAULT '',
      createdById TEXT,
      createdBy TEXT DEFAULT '',
      createdByRole TEXT DEFAULT '',
      validationDirection INTEGER DEFAULT 1,
      beValide INTEGER DEFAULT 0,
      beNonRequis INTEGER DEFAULT 0,
      chefValide INTEGER DEFAULT 0,
      estRepriseEnCours INTEGER DEFAULT 0,
      cadSpecJson TEXT DEFAULT '',
      ficheTechniqueJson TEXT DEFAULT '',
      beChatJson TEXT DEFAULT '',
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
      tempsReglageMin INTEGER DEFAULT 15,
      tempsUnitaireMin REAL DEFAULT 0,
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
      finStr TEXT DEFAULT '',
      datePlanifiee TEXT DEFAULT '',
      estSousTraitance INTEGER DEFAULT 0,
      sousTraitant TEXT DEFAULT '',
      dateEnvoi TEXT DEFAULT '',
      dateRetourPrevue TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS be_files (
      id TEXT PRIMARY KEY,
      pieceId TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
      categorie TEXT NOT NULL,
      revision TEXT NOT NULL,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      sizeBytes INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      isActive INTEGER DEFAULT 1,
      uploadedById TEXT REFERENCES users(id) ON DELETE SET NULL,
      uploadedBy TEXT,
      createdAt TEXT
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
      dureeArretMin INTEGER DEFAULT 0,
      createdAtMs INTEGER DEFAULT 0,
      createdAt TEXT,
      resolvedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id TEXT PRIMARY KEY,
      machineId TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      type TEXT DEFAULT 'Préventive',
      description TEXT,
      heuresAuCompteur REAL DEFAULT 0,
      effectuePar TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS piece_events (
      id TEXT PRIMARY KEY,
      pieceId TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
      userId TEXT,
      userNom TEXT,
      userRole TEXT,
      eventType TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      details TEXT DEFAULT '',
      createdAt TEXT,
      createdAtMs INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS operation_stops (
      id TEXT PRIMARY KEY,
      pieceId TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
      operationId TEXT REFERENCES operations(id) ON DELETE CASCADE,
      machineId TEXT REFERENCES machines(id) ON DELETE SET NULL,
      operateurId TEXT REFERENCES users(id) ON DELETE SET NULL,
      operateurNom TEXT DEFAULT '',
      categorie TEXT NOT NULL,
      cibleRole TEXT DEFAULT 'chef',
      motif TEXT DEFAULT '',
      statut TEXT DEFAULT 'Ouvert',
      dureeMin INTEGER DEFAULT 0,
      createdAtMs INTEGER DEFAULT 0,
      createdAt TEXT,
      resolvedAt TEXT,
      resolvedBy TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pieces_machine ON pieces(machineId);
    CREATE INDEX IF NOT EXISTS idx_pieces_operateur ON pieces(operateurId);
    CREATE INDEX IF NOT EXISTS idx_operations_piece ON operations(pieceId);
    CREATE INDEX IF NOT EXISTS idx_operations_operateur ON operations(operateurId);
    CREATE INDEX IF NOT EXISTS idx_operations_machine ON operations(machineId);
    CREATE INDEX IF NOT EXISTS idx_be_files_piece ON be_files(pieceId);
    CREATE INDEX IF NOT EXISTS idx_pannes_statut ON pannes(statut);
    CREATE INDEX IF NOT EXISTS idx_piece_events_piece ON piece_events(pieceId);
    CREATE INDEX IF NOT EXISTS idx_operation_stops_piece ON operation_stops(pieceId);
    CREATE INDEX IF NOT EXISTS idx_operation_stops_statut ON operation_stops(statut);
  `);
}

function migrateLegacySchemaIfNeeded() {
  if (tableExists('users') && !hasColumn('users', 'actif')) {
    db.exec('ALTER TABLE users ADD COLUMN actif INTEGER DEFAULT 1');
  }
  if (tableExists('machines')) {
    const machCols = [
      ['tauxHoraire', 'REAL DEFAULT 2500'],
      ['capaciteJourMin', 'INTEGER DEFAULT 480'],
      ['enPanne', 'INTEGER DEFAULT 0'],
      ['heuresCompteur', 'REAL DEFAULT 0'],
      ['intervalleEntretienH', 'REAL DEFAULT 200'],
      ['dernierEntretienH', 'REAL DEFAULT 0'],
      ['dernierEntretienDate', "TEXT DEFAULT ''"]
    ];
    for (const [col, def] of machCols) {
      if (!hasColumn('machines', col)) db.exec(`ALTER TABLE machines ADD COLUMN ${col} ${def}`);
    }
  }
  if (tableExists('audit_logs') && !hasColumn('audit_logs', 'userId')) {
    db.exec('ALTER TABLE audit_logs ADD COLUMN userId TEXT');
  }
  if (tableExists('pannes')) {
    if (!hasColumn('pannes', 'dureeArretMin')) db.exec('ALTER TABLE pannes ADD COLUMN dureeArretMin INTEGER DEFAULT 0');
    if (!hasColumn('pannes', 'createdAtMs')) db.exec('ALTER TABLE pannes ADD COLUMN createdAtMs INTEGER DEFAULT 0');
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
      ['archived', 'INTEGER DEFAULT 0'],
      ['typeMachine', "TEXT DEFAULT ''"],
      ['createdById', 'TEXT'],
      ['createdBy', "TEXT DEFAULT ''"],
      ['cadSpecJson', "TEXT DEFAULT ''"],
      ['ficheTechniqueJson', "TEXT DEFAULT ''"],
      ['beChatJson', "TEXT DEFAULT ''"],
      ['createdByRole', "TEXT DEFAULT ''"],
      ['validationDirection', 'INTEGER DEFAULT 1'],
      ['beValide', 'INTEGER DEFAULT 0'],
      ['beNonRequis', 'INTEGER DEFAULT 0'],
      ['chefValide', 'INTEGER DEFAULT 0'],
      ['estRepriseEnCours', 'INTEGER DEFAULT 0'],
      ['createdAt', 'TEXT'],
      ['closedAt', 'TEXT']
    ];
    for (const [col, def] of additions) {
      if (!hasColumn('pieces', col)) db.exec(`ALTER TABLE pieces ADD COLUMN ${col} ${def}`);
    }
    if (hasColumn('pieces', 'machine')) {
      const legacy = queryAll('SELECT id, machine, operateur FROM pieces WHERE machineId IS NULL');
      for (const p of legacy) {
        const m = p.machine ? queryOne('SELECT id FROM machines WHERE nom = ?', [p.machine]) : null;
        const u = p.operateur ? queryOne('SELECT id FROM users WHERE nom = ?', [p.operateur]) : null;
        runSql('UPDATE pieces SET machineId = ?, operateurId = ? WHERE id = ?', [m?.id || null, u?.id || null, p.id]);
      }
    }
  }
  if (tableExists('operations')) {
    const opCols = [
      ['tempsReglageMin', 'INTEGER DEFAULT 15'],
      ['tempsUnitaireMin', 'REAL DEFAULT 0'],
      ['datePlanifiee', "TEXT DEFAULT ''"],
      ['estSousTraitance', 'INTEGER DEFAULT 0'],
      ['sousTraitant', "TEXT DEFAULT ''"],
      ['dateEnvoi', "TEXT DEFAULT ''"],
      ['dateRetourPrevue', "TEXT DEFAULT ''"]
    ];
    for (const [col, def] of opCols) {
      if (!hasColumn('operations', col)) db.exec(`ALTER TABLE operations ADD COLUMN ${col} ${def}`);
    }
  }

  // Ensure every piece has at least one operation
  if (tableExists('pieces')) {
    const piecesWithoutOps = queryAll('SELECT * FROM pieces WHERE id NOT IN (SELECT DISTINCT pieceId FROM operations)');
    for (const p of piecesWithoutOps) {
      const opStatut =
        p.statut === 'Clôturé' || p.statut === 'À clôturer' ? 'Terminée' :
        p.statut === 'En cours' ? 'En cours' :
        p.statut === 'En pause' ? 'En pause' :
        p.statut === 'Panne machine' ? 'Panne machine' :
        'En attente';
      runSql(
        `INSERT INTO operations (id, pieceId, ordre, libelle, machineId, operateurId, tempsReglageMin, tempsUnitaireMin, tempsPrevuMin, tempsReelMin, startedAt, statut, quantiteBonne, quantiteRebut, photoDebut, photoFin, debutStr, finStr)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          `op_${p.id}_10`, p.id, 10, 'Usinage principal', p.machineId, p.operateurId,
          15, 0, p.tempsPrevuMin || 120, p.tempsReelMin || 0, p.startedAt || 0, opStatut,
          p.quantiteRealisee || 0, p.quantiteRebut || 0, p.photoDebut || null, p.photoFin || null,
          p.debutStr || '', p.finStr || ''
        ]
      );
    }
  }

  // Default workshop calendar settings
  const hasWorkDays = queryOne("SELECT value FROM atelier_settings WHERE key = 'workDays'");
  if (!hasWorkDays) {
    saveSettings({ workDays: [0, 1, 2, 3, 4], shiftStart: '08:00', shiftEnd: '17:00' });
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
      ['m1', 'Tour CNC 1', 'Tournage CNC', 2800, 480, 1, 0, 188.5, 200, 0, '2026-09-01'],
      ['m2', 'Fraiseuse CNC 2', 'Fraisage CNC', 3000, 480, 1, 0, 112.0, 200, 0, '2026-10-05'],
      ['m3', 'Tour Conventionnel', 'Tournage Manuel', 1800, 480, 1, 0, 265.0, 250, 0, '2026-07-15'],
      ['m4', 'Poste Contrôle Qualité', 'Métrologie / Contrôle', 1500, 480, 1, 0, 45.0, 500, 0, '2026-10-20']
    ];
    for (const m of machines) {
      runSql(
        'INSERT INTO machines (id, nom, type, tauxHoraire, capaciteJourMin, actif, enPanne, heuresCompteur, intervalleEntretienH, dernierEntretienH, dernierEntretienDate) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        m
      );
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
        'ARB-101-REV2.pdf', 'O0101_ARB_CNC1.nc', 'ARB-101.step',
        'ok', null, 180, 85, Date.now() - 1800000, '08:00', '11:00',
        1, 1, 0, 0, '', 0, nowStr, null
      ],
      [
        'OF-2026-0102', 'Bride de fixation hydraulique', 'HydroTech', 25, 0, 0,
        tomorrow, 'Urgent', 'À acheter', 'm2', 'u5', 'Alu 7075 Plat 80x20',
        0, 0, 'AluMag', 'Fraise Ø16 4 dents, Taraud M8',
        'BRI-102-V1.pdf', 'O0102_BRIDE.nc', 'BRI-102.step',
        null, null, 255, 0, 0, '08:00', '12:15',
        0, 2, 0, 0, '', 0, nowStr, null
      ],
      [
        'OF-2026-0103', 'Bague de centrage', 'Industrie Nord', 50, 49, 1,
        yesterday, 'Normal', 'À clôturer', 'm3', 'u6', 'Bronze CuSn12 Ø35',
        1, 1, 'MétalPlus', 'Outil à aléser Ø20',
        'BAG-103-FINAL.pdf', 'Manuel', 'BAG-103.stl',
        'ok', 'ok', 170, 155, 0, '08:00', '10:50',
        1, 3, 0, 0, '1 pièce hors tolérance alésage', 0, nowStr, null
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
          planningValide, ordrePlanning, prixEstime, prixFinal, notesQualite, archived, createdAt, closedAt
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p
      );
    }

    // Realistic multi-op gammes with Setup (Réglage) + Unit machining times!
    const ops = [
      // OF-2026-0101 (10 pcs): Op 10 = 30m setup + 10*9m = 120m ; Op 20 = 20m setup + 10*4m = 60m
      ['op_101_10', 'OF-2026-0101', 10, 'Tournage CNC (ébauche + finition)', 'm1', 'u4', 30, 9, 120, 85, Date.now() - 1800000, 'En cours', 6, 0, '', 'ok', null, '08:00', '10:00', today, 0, '', '', ''],
      ['op_101_20', 'OF-2026-0101', 20, 'Fraisage rainure clavette', 'm2', 'u5', 20, 4, 60, 0, 0, 'En attente', 0, 0, '', null, null, '10:00', '11:00', today, 0, '', '', ''],
      // OF-2026-0102 (25 pcs): Op 10 = 45m setup + 25*7m = 220m ; Op 20 = 10m setup + 25*1m = 35m
      ['op_102_10', 'OF-2026-0102', 10, 'Fraisage CNC + taraudage M8', 'm2', 'u5', 45, 7, 220, 0, 0, 'En attente', 0, 0, '', null, null, '08:00', '11:40', tomorrow, 0, '', '', ''],
      ['op_102_20', 'OF-2026-0102', 20, 'Contrôle dimensionnel', 'm4', 'u6', 10, 1, 35, 0, 0, 'En attente', 0, 0, '', null, null, '11:40', '12:15', tomorrow, 0, '', '', ''],
      // OF-2026-0103 (50 pcs): Op 10 = 20m setup + 50*3m = 170m
      ['op_103_10', 'OF-2026-0103', 10, 'Tournage + alésage Ø20', 'm3', 'u6', 20, 3, 170, 155, 0, 'Terminée', 49, 1, 'Côte alésage hors tolérance', 'ok', 'ok', '08:00', '10:50', yesterday, 0, '', '', '']
    ];
    for (const o of ops) {
      runSql(
        `INSERT INTO operations (
          id, pieceId, ordre, libelle, machineId, operateurId,
          tempsReglageMin, tempsUnitaireMin, tempsPrevuMin, tempsReelMin, startedAt, statut,
          quantiteBonne, quantiteRebut, motifRebut, photoDebut, photoFin, debutStr, finStr,
          datePlanifiee, estSousTraitance, sousTraitant, dateEnvoi, dateRetourPrevue
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

  const pieces = queryAll('SELECT id FROM pieces');
  for (const p of pieces) {
    syncPieceFromOperations(p.id);
  }

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
  DB_FILE,
  BACKUP_DIR,
  UPLOADS_DIR,
  initDB,
  getDB,
  queryAll,
  queryOne,
  runSql,
  transaction,
  hashPassword,
  logAudit,
  logPieceEvent,
  getSettings,
  saveSettings,
  getAiSettings,
  getAiSettingsPublic,
  saveAiSettings,
  getNextOfId,
  nextRevisionLabel,
  computeOpPlannedMin,
  backupDB,
  restoreDBFromBuffer,
  syncPieceFromOperations,
  getEnrichedPieces,
  getEnrichedPannes,
  getEnrichedStops,
  getMaintenanceLogs
};
