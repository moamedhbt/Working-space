const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  UPLOADS_DIR,
  queryAll,
  queryOne,
  runSql,
  transaction,
  logAudit,
  logPieceEvent,
  getSettings,
  getNextOfId,
  nextRevisionLabel,
  computeOpPlannedMin,
  syncPieceFromOperations,
  getEnrichedPieces,
  getEnrichedPannes,
  getEnrichedStops,
  getMaintenanceLogs
} = require('../db/database');
const { analyzeScheduleAndAI } = require('../services/scheduler');
const { createProposal } = require('../services/workshopPlanner');
const { analyzePlanDocument, refineCadSpecWithAI } = require('../services/planAnalyzer');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_UPLOAD_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp',
  '.pdf', '.dxf',
  '.stl', '.step', '.stp',
  '.nc', '.tap', '.gcode', '.txt'
]);

const TEXT_PREVIEW_EXTS = new Set(['.nc', '.tap', '.gcode', '.txt']);

function resolveMachineId(machineId, machineName) {
  if (machineId) {
    const m = queryOne('SELECT id FROM machines WHERE id = ?', [machineId]);
    if (m) return m.id;
  }
  if (machineName) {
    const m = queryOne('SELECT id FROM machines WHERE nom = ?', [machineName]);
    if (m) return m.id;
  }
  return null;
}

function resolveOperateurId(operateurId, operateurName) {
  if (operateurId) {
    const u = queryOne('SELECT id FROM users WHERE id = ?', [operateurId]);
    if (u) return u.id;
  }
  if (operateurName) {
    const u = queryOne('SELECT id FROM users WHERE nom = ?', [operateurName]);
    if (u) return u.id;
  }
  return null;
}

function parseMinutesDiff(debutStr, finStr) {
  if (!debutStr || !finStr || !debutStr.includes(':') || !finStr.includes(':')) return 0;
  const [h1, m1] = debutStr.split(':').map(Number);
  const [h2, m2] = finStr.split(':').map(Number);
  if ([h1, m1, h2, m2].some(n => !Number.isFinite(n))) return 0;
  const diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  return diff > 0 ? diff : 0;
}

function incrementMachineHours(machineId, minutes) {
  if (!machineId || !minutes || minutes <= 0) return;
  const deltaH = Number((minutes / 60).toFixed(3));
  runSql('UPDATE machines SET heuresCompteur = COALESCE(heuresCompteur, 0) + ? WHERE id = ?', [deltaH, machineId]);
}

function runOperationAction(op, piece, action, body, reqUser) {
  const b = body || {};
  const canOperate = ['directeur', 'chef'].includes(reqUser.role) || op.operateurId === reqUser.id;
  if (!canOperate) {
    return { status: 403, error: 'Cette opération est affectée à un autre opérateur' };
  }

  const now = Date.now();
  const elapsedSegment = op.startedAt > 0 ? Math.max(1, Math.round((now - op.startedAt) / 60000)) : 0;

  if (action === 'start' || action === 'op-start') {
    if (piece.statut === 'Clôturé' || piece.statut === 'Refusé') return { status: 400, error: 'OF clôturé ou refusé : démarrage impossible' };
    if (!piece.validationDirection) return { status: 400, error: 'Validation Direction manquante' };
    if (!piece.beValide && !piece.beNonRequis) return { status: 400, error: 'Validation BE manquante' };
    if (!piece.chefValide) return { status: 400, error: 'Validation du chef manquante' };
    if (!piece.planningValide) return { status: 400, error: 'Planning non publié par le chef ou la Direction' };
    if (op.estSousTraitance) return { status: 400, error: 'Opération sous-traitée : utilisez le suivi de sous-traitance' };
    if (op.statut === 'En cours') return { status: 400, error: 'Cette opération est déjà en cours' };
    if (!['En attente', 'En pause'].includes(op.statut)) return { status: 400, error: 'Cette opération ne peut pas être démarrée dans son état actuel' };
    const machine = op.machineId && queryOne('SELECT * FROM machines WHERE id = ?', [op.machineId]);
    if (!machine || !machine.actif) return { status: 400, error: 'Machine manquante ou inactive' };
    if (machine.enPanne) return { status: 400, error: 'Machine en panne : résolution nécessaire avant démarrage' };
    const localNow = new Intl.DateTimeFormat('sv-SE', {timeZone:'Africa/Algiers', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date());
    const unavailable = queryOne(`SELECT resourceType, reason FROM planning_unavailability
      WHERE ((resourceType = 'machine' AND resourceId = ?) OR (resourceType = 'operator' AND resourceId = ?))
      AND (startDate || ' ' || startTime) <= ? AND (endDate || ' ' || endTime) > ? LIMIT 1`,
      [op.machineId, op.operateurId, localNow, localNow]);
    if (unavailable) return {status:400,error:`${unavailable.resourceType === 'machine' ? 'Machine' : 'Opérateur'} indisponible${unavailable.reason ? ' : '+unavailable.reason : ''}`};
    const occupying = queryOne("SELECT id FROM operations WHERE machineId = ? AND statut = 'En cours' AND id != ? LIMIT 1", [machine.id, op.id]);
    if (occupying) return { status: 400, error: 'Machine déjà occupée par une autre opération en cours' };
    const stop = queryOne("SELECT categorie FROM operation_stops WHERE operationId = ? AND statut = 'Ouvert' LIMIT 1", [op.id]);
    if (stop) return { status: 400, error: `Blocage non résolu : ${stop.categorie}` };
    const previous = queryOne("SELECT libelle FROM operations WHERE pieceId = ? AND (ordre < ? OR (ordre = ? AND rowid < (SELECT rowid FROM operations WHERE id = ?))) AND statut != 'Terminée' ORDER BY ordre, rowid LIMIT 1", [piece.id, op.ordre, op.ordre, op.id]);
    if (previous) return { status: 400, error: `Opération précédente non terminée : ${previous.libelle}` };
    if (!piece.chuteDispo && !piece.achatFait) {
      return { status: 400, error: 'Matière non disponible : achat à valider avant démarrage' };
    }
    if (op.statut === 'Terminée') {
      return { status: 400, error: 'Cette opération est déjà terminée' };
    }
    const isResume = op.statut === 'En pause' || op.statut === 'Panne machine';
    const photoDebut = b.photoUrl || op.photoDebut || 'ok';
    transaction(() => {
      runSql(
        "UPDATE operations SET statut = 'En cours', photoDebut = ?, startedAt = ? WHERE id = ?",
        [photoDebut, now, op.id]
      );
      if (photoDebut && (!piece.photoDebut || piece.photoDebut === 'ok')) {
        runSql('UPDATE pieces SET photoDebut = ? WHERE id = ?', [photoDebut, piece.id]);
      }
      syncPieceFromOperations(piece.id);
    });
    logAudit(reqUser, isResume ? 'REPRISE' : 'DÉMARRAGE', `${piece.id} · ${op.libelle}`);
    logPieceEvent(piece.id, reqUser, isResume ? 'reprise' : 'demarrage', isResume ? `Reprise : ${op.libelle}` : `Démarrage : ${op.libelle}`, '');
    return { status: 200, ok: true };
  }

  if (action === 'pause') {
    if (op.statut !== 'En cours') {
      return { status: 400, error: "L'opération n'est pas en cours" };
    }
    const newTotal = (op.tempsReelMin || 0) + elapsedSegment;
    transaction(() => {
      runSql(
        "UPDATE operations SET statut = 'En pause', tempsReelMin = ?, startedAt = 0 WHERE id = ?",
        [newTotal, op.id]
      );
      incrementMachineHours(op.machineId, elapsedSegment);
      syncPieceFromOperations(piece.id);
    });
    logAudit(reqUser, 'PAUSE', `${piece.id} · ${op.libelle} (cumul ${newTotal} min)`);
    return { status: 200, ok: true, tempsReelMin: newTotal };
  }

  if (action === 'panne') {
    const motif = (b.motif || '').trim() || 'Panne non précisée';
    const addMin = op.statut === 'En cours' ? elapsedSegment : 0;
    const newTotal = (op.tempsReelMin || 0) + addMin;
    const panneId = 'pan_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    transaction(() => {
      runSql(
        "UPDATE operations SET statut = 'Panne machine', tempsReelMin = ?, startedAt = 0 WHERE id = ?",
        [newTotal, op.id]
      );
      incrementMachineHours(op.machineId, addMin);
      if (op.machineId) {
        runSql('UPDATE machines SET enPanne = 1 WHERE id = ?', [op.machineId]);
      }
      runSql(
        `INSERT INTO pannes (id, machineId, pieceId, operationId, declareParId, declarePar, motif, statut, dureeArretMin, createdAtMs, createdAt)
         VALUES (?,?,?,?,?,?,?,'Ouverte',0,?,?)`,
        [panneId, op.machineId || null, piece.id, op.id, reqUser.id, reqUser.nom, motif, now, new Date().toLocaleString('fr-FR')]
      );
      syncPieceFromOperations(piece.id);
    });
    logAudit(reqUser, 'PANNE SIGNALÉE', `${piece.id} · ${op.libelle} — ${motif}`);
    return { status: 200, ok: true, panneId };
  }

  if (action === 'progress') {
    const qBonne = Math.max(0, parseInt(b.quantiteBonne ?? op.quantiteBonne ?? 0, 10) || 0);
    const qRebut = Math.max(0, parseInt(b.quantiteRebut ?? op.quantiteRebut ?? 0, 10) || 0);
    const motifRebut = b.motifRebut !== undefined ? String(b.motifRebut).trim() : (op.motifRebut || '');
    transaction(() => {
      runSql(
        'UPDATE operations SET quantiteBonne = ?, quantiteRebut = ?, motifRebut = ? WHERE id = ?',
        [qBonne, qRebut, motifRebut, op.id]
      );
      syncPieceFromOperations(piece.id);
    });
    logAudit(reqUser, 'AVANCEMENT PARTIEL', `${piece.id} · ${op.libelle} (${qBonne} bonnes, ${qRebut} NC)`);
    return { status: 200, ok: true };
  }

  if (action === 'finish' || action === 'op-finish') {
    if (op.statut === 'Terminée') return { status: 400, error: 'Cette opération est déjà terminée' };
    if (['Clôturé', 'Refusé'].includes(piece.statut)) return { status: 400, error: 'OF clôturé ou refusé' };
    const previous = queryOne("SELECT libelle FROM operations WHERE pieceId = ? AND (ordre < ? OR (ordre = ? AND rowid < (SELECT rowid FROM operations WHERE id = ?))) AND statut != 'Terminée' ORDER BY ordre, rowid LIMIT 1", [piece.id, op.ordre, op.ordre, op.id]);
    if (previous) return { status: 400, error: `Opération précédente non terminée : ${previous.libelle}` };
    if (op.estSousTraitance && !['directeur','chef'].includes(reqUser.role)) return { status: 403, error: 'Retour de sous-traitance réservé au chef ou à la Direction' };
    if (op.estSousTraitance && (!piece.validationDirection || (!piece.beValide && !piece.beNonRequis) || !piece.chefValide)) return { status: 400, error: 'Validations Direction, BE et chef requises pour enregistrer le retour de sous-traitance' };
    if (!op.estSousTraitance && op.statut !== 'En cours') return { status: 400, error: 'Démarrez ou reprenez l’opération avant de la terminer' };
    const addMin = op.statut === 'En cours' ? elapsedSegment : 0;
    const newTotal = (op.tempsReelMin || 0) + addMin;
    const finalMins = newTotal > 0 ? newTotal : Math.max(1, op.tempsPrevuMin || 1);
    const qBonne = Math.max(
      0,
      parseInt(b.quantiteBonne ?? b.quantiteRealisee ?? piece.quantitePrevue, 10) || 0
    );
    const qRebut = Math.max(0, parseInt(b.quantiteRebut ?? 0, 10) || 0);
    const motifRebut = (b.motifRebut || '').trim();
    const photoFin = b.photoUrl || op.photoFin || 'ok';

    transaction(() => {
      runSql(
        `UPDATE operations
         SET statut = 'Terminée', tempsReelMin = ?, startedAt = 0,
             quantiteBonne = ?, quantiteRebut = ?, motifRebut = ?, photoFin = ?
         WHERE id = ?`,
        [finalMins, qBonne, qRebut, motifRebut, photoFin, op.id]
      );
      incrementMachineHours(op.machineId, addMin > 0 ? addMin : (op.tempsReelMin === 0 ? finalMins : 0));
      if (photoFin && photoFin !== 'ok') {
        runSql('UPDATE pieces SET photoFin = ? WHERE id = ?', [photoFin, piece.id]);
      }
      if (motifRebut) {
        const existingNotes = piece.notesQualite ? `${piece.notesQualite} | ` : '';
        runSql('UPDATE pieces SET notesQualite = ? WHERE id = ?', [`${existingNotes}${op.libelle}: ${qRebut} rebut(s) (${motifRebut})`, piece.id]);
      }
      syncPieceFromOperations(piece.id);
    });
    logAudit(
      reqUser,
      'OPÉRATION TERMINÉE',
      `${piece.id} · ${op.libelle} (${qBonne} bonnes${qRebut > 0 ? `, ${qRebut} rebuts` : ''} en ${finalMins} min)`
    );
    logPieceEvent(
      piece.id,
      reqUser,
      'op_terminee',
      `Opération terminée : ${op.libelle}`,
      `${qBonne} bonnes${qRebut > 0 ? `, ${qRebut} rebuts (${motifRebut || '—'})` : ''} · ${finalMins} min`
    );
    return { status: 200, ok: true, tempsReelMin: finalMins };
  }

  return { status: 404, error: 'Action opération inconnue' };
}

router.get('/state', auth, (req, res) => {
  const users = queryAll('SELECT id, nom, username, role, actif FROM users ORDER BY role, nom');
  const machines = queryAll('SELECT * FROM machines ORDER BY nom');
  const pieces = getEnrichedPieces();
  const pannes = getEnrichedPannes();
  const stops = getEnrichedStops();
  const settings = getSettings();
  const maintenanceLogs = ['directeur', 'chef'].includes(req.user.role) ? getMaintenanceLogs() : [];
  const auditLogs = ['directeur', 'chef'].includes(req.user.role)
    ? queryAll('SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT 100')
    : [];

  const analysis = analyzeScheduleAndAI(pieces, machines, users, pannes, settings);

  // Planning alerts come from the same constraint engine as the chef's draft.
  // Analytics below remain historical workshop indicators, not a second planning source.
  let planningConflicts = [];
  try {
    const preview = createProposal({pieces,machines,users,settings,unavailable:queryAll('SELECT * FROM planning_unavailability')});
    planningConflicts = [
      ...preview.blockers.map(text=>({type:'blocage',severity:'high',text})),
      ...preview.warnings.map(text=>({type:'prevision',severity:'medium',text}))
    ];
  } catch(err) {
    planningConflicts = [{type:'planning',severity:'high',text:`Calcul du planning indisponible : ${err.message}`}];
  }

  // Add stop cause breakdown to analytics
  const stopsByCat = { panne: 0, outil: 0, matiere: 0, plan_be: 0, pause: 0 };
  for (const s of stops) {
    if (stopsByCat[s.categorie] !== undefined) {
      stopsByCat[s.categorie] += (s.dureeMin || 0);
    }
  }
  analysis.analytics.stopsByCategoryMin = stopsByCat;
  analysis.analytics.openStopsCount = stops.filter(s => s.statut === 'Ouvert').length;

  res.json({
    currentUser: req.user,
    users,
    machines,
    pieces,
    pannes,
    stops,
    settings,
    maintenanceLogs,
    auditLogs,
    conflicts: planningConflicts,
    aiRecommendations: [],
    analytics: analysis.analytics
  });
});

router.post('/pieces', auth, requireRole('directeur', 'chef', 'be'), (req, res) => {
  const b = req.body || {};
  if (!b.nom || !String(b.nom).trim()) {
    return res.status(400).json({ error: 'Le nom de la pièce est requis' });
  }

  const requestedType = b.typeMachine === undefined ? '' : typeof b.typeMachine === 'string' ? b.typeMachine.trim() : null;
  if (requestedType === null || requestedType.length > 150 || (requestedType && !queryOne('SELECT id FROM machines WHERE actif=1 AND type=?',[requestedType]))) return res.status(400).json({error:'Type de machine actif invalide.'});
  const id = getNextOfId();
  const defaultMach = requestedType ? queryOne('SELECT id FROM machines WHERE actif = 1 AND type = ? ORDER BY id LIMIT 1',[requestedType]) : queryOne('SELECT id FROM machines WHERE actif = 1 ORDER BY id LIMIT 1');
  const defaultOp = queryOne("SELECT id FROM users WHERE role = 'operateur' AND actif = 1 ORDER BY id LIMIT 1");

  const requestedMachine = resolveMachineId(b.machineId, b.machine);
  const matchingMachine = requestedMachine && (!requestedType || queryOne('SELECT id FROM machines WHERE id=? AND type=? AND actif=1',[requestedMachine,requestedType]));
  if (b.estRepriseEnCours && requestedType && !matchingMachine) return res.status(400).json({error:'Pour une reprise, choisissez la machine réelle du type indiqué.'});
  const machineId = (matchingMachine ? requestedMachine : null) || defaultMach?.id || null;
  const operateurId = resolveOperateurId(b.operateurId, b.operateur) || defaultOp?.id || null;
  const quantitePrevue = Math.max(1, parseInt(b.quantitePrevue || 10, 10) || 10);
  const tempsReglageMin = Math.max(0, parseInt(b.tempsReglageMin ?? 15, 10) || 0);
  const tempsUnitaireMin = Math.max(0, Number(b.tempsUnitaireMin ?? 0) || 0);
  const tempsPrevuMin = computeOpPlannedMin(tempsReglageMin, tempsUnitaireMin, quantitePrevue, b.tempsPrevuMin || 120);
  const estReprise = !!b.estRepriseEnCours;
  const chuteDispo = estReprise ? 1 : (b.chuteDispo ? 1 : 0);
  const achatFait = estReprise ? 1 : (b.matiereDispo ? 1 : 0);
  const urgence = ['Critique', 'Urgent', 'Normal'].includes(b.urgence) ? b.urgence : 'Normal';
  const delai = b.delai || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const validationDirection = req.user.role === 'directeur' ? 1 : 0;
  const beNonRequis = b.beNonRequis ? 1 : 0;
  const beValide = estReprise ? 1 : 0;
  const chefValide = estReprise ? 1 : 0;
  const planningValide = (estReprise && validationDirection === 1) ? 1 : 0;

  const qDeja = estReprise ? Math.min(quantitePrevue, Math.max(0, parseInt(b.quantiteDejaRealisee || 0, 10) || 0)) : 0;
  const tDeja = estReprise ? Math.max(0, parseInt(b.tempsDejaPasseMin || 0, 10) || 0) : 0;
  const repriseStatut = ['En cours', 'Prêt atelier', 'En pause', 'À clôturer'].includes(b.statutInitial) ? b.statutInitial : 'En cours';

  let statut = 'À planifier';
  if (validationDirection === 0) statut = 'À valider';
  else if (estReprise) statut = repriseStatut;
  else if (b.matiereDispo === false) statut = 'À acheter';

  const opInitialStatut =
    validationDirection === 0 ? 'En attente' :
    !estReprise ? 'En attente' :
    repriseStatut === 'À clôturer' ? 'Terminée' :
    repriseStatut === 'En cours' ? 'En cours' :
    repriseStatut === 'En pause' ? 'En pause' : 'En attente';

  const maxOrder = queryOne('SELECT COALESCE(MAX(ordrePlanning), 0) AS m FROM pieces').m;
  const nowStr = new Date().toLocaleString('fr-FR');

  transaction(() => {
    runSql(
      `INSERT INTO pieces (
        id, nom, client, quantitePrevue, quantiteRealisee, delai, urgence, statut,
        machineId, operateurId, matiere, chuteDispo, achatFait, fournisseur, outils,
        tempsPrevuMin, tempsReelMin, startedAt, planningValide, ordrePlanning,
        typeMachine, createdById, createdBy, createdByRole,
        validationDirection, beValide, beNonRequis, chefValide, estRepriseEnCours, createdAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        String(b.nom).trim(),
        (b.client || 'Client Standard').trim(),
        quantitePrevue,
        qDeja,
        delai,
        urgence,
        statut,
        machineId,
        operateurId,
        (b.matiere || 'À définir').trim(),
        chuteDispo,
        achatFait,
        (b.fournisseur || 'À définir').trim(),
        (b.outils || 'À définir').trim(),
        tempsPrevuMin,
        tDeja,
        opInitialStatut === 'En cours' ? Date.now() : 0,
        planningValide,
        maxOrder + 1,
        requestedType,
        req.user.id,
        req.user.nom,
        req.user.role,
        validationDirection,
        beValide,
        beNonRequis,
        chefValide,
        estReprise ? 1 : 0,
        nowStr
      ]
    );

    const opsInput = Array.isArray(b.operations) && b.operations.length > 0
      ? b.operations
      : [{ libelle: 'Usinage principal', machineId, operateurId, tempsReglageMin, tempsUnitaireMin, tempsPrevuMin, machineTypeRequis: b.estRepriseEnCours ? '' : requestedType }];

    opsInput.forEach((op, idx) => {
      const opMachId = resolveMachineId(op.machineId, op.machine) || machineId;
      const opUserId = resolveOperateurId(op.operateurId, op.operateur) || operateurId;
      const reg = Math.max(0, parseInt(op.tempsReglageMin ?? tempsReglageMin, 10) || 0);
      const unit = Math.max(0, Number(op.tempsUnitaireMin ?? tempsUnitaireMin) || 0);
      const planned = computeOpPlannedMin(reg, unit, quantitePrevue, op.tempsPrevuMin || tempsPrevuMin);
      const isFirst = idx === 0;
      runSql(
        `INSERT INTO operations (
          id, pieceId, ordre, libelle, machineId, operateurId, machineTypeRequis,
          tempsReglageMin, tempsUnitaireMin, tempsPrevuMin, tempsReelMin,
          startedAt, statut, quantiteBonne
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          `op_${id}_${(idx + 1) * 10}_${Math.floor(Math.random() * 1000)}`,
          id,
          (idx + 1) * 10,
          (op.libelle || `Opération ${idx + 1}`).trim(),
          opMachId,
          opUserId,
          typeof op.machineTypeRequis === 'string' && queryOne('SELECT id FROM machines WHERE type=? AND actif=1',[op.machineTypeRequis]) ? op.machineTypeRequis : '',
          reg,
          unit,
          planned,
          isFirst ? tDeja : 0,
          isFirst && opInitialStatut === 'En cours' ? Date.now() : 0,
          isFirst ? opInitialStatut : 'En attente',
          isFirst ? qDeja : 0
        ]
      );
    });

    // Save optional client drawing (photo or PDF) in /uploads/<OF-ID>/client/
    if (b.clientFile && b.clientFile.filename && b.clientFile.base64) {
      const safeName = path.basename(b.clientFile.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = path.extname(safeName).toLowerCase();
      if (ALLOWED_UPLOAD_EXTS.has(ext)) {
        const dir = path.join(UPLOADS_DIR, id, 'client');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const raw = String(b.clientFile.base64).includes(',') ? String(b.clientFile.base64).split(',')[1] : String(b.clientFile.base64);
        const buf = Buffer.from(raw, 'base64');
        const storedName = `${Date.now()}_Client_${safeName}`;
        fs.writeFileSync(path.join(dir, storedName), buf);
        const url = `/uploads/${id}/client/${storedName}`;
        runSql(
          `INSERT INTO be_files (id, pieceId, categorie, revision, filename, url, sizeBytes, notes, isActive, uploadedById, uploadedBy, createdAt)
           VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`,
          [`bef_${Date.now()}_cli`, id, 'client', 'Plan Client', safeName, url, buf.length, 'Fourni à la création', req.user.id, req.user.nom, nowStr]
        );
      }
    }

    syncPieceFromOperations(id);
  });

  logAudit(req.user, estReprise ? 'REPRISE OF EN COURS' : 'OF CRÉÉ', `${id} — ${String(b.nom).trim()} (${quantitePrevue} pcs)${validationDirection === 0 ? ' [en attente validation Direction]' : ''}`);
  logPieceEvent(
    id,
    req.user,
    estReprise ? 'reprise_of' : 'creation',
    estReprise ? `Reprise d'OF déjà en cours (${qDeja}/${quantitePrevue} pcs)` : `Création de l'OF (${quantitePrevue} pcs)`,
    validationDirection === 0
      ? `Créé par ${req.user.nom} (${req.user.role}) — en attente de validation Directeur`
      : `Validé Direction · Délai ${delai}`
  );
  res.status(201).json({ ok: true, id, validationDirection: !!validationDirection });
});

router.post('/upload', auth, (req, res) => {
  const { pieceId, filename, base64 } = req.body || {};
  if (!pieceId || !filename || !base64) return res.status(400).json({ error: 'Données manquantes' });

  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(safeName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
    return res.status(400).json({ error: `Type de fichier non autorisé (${ext || 'sans extension'})` });
  }

  const safeId = String(pieceId).replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(UPLOADS_DIR, safeId, 'photos');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const raw = String(base64).includes(',') ? String(base64).split(',')[1] : String(base64);
  const buf = Buffer.from(raw, 'base64');
  const stampedName = `${Date.now()}_${safeName}`;
  fs.writeFileSync(path.join(dir, stampedName), buf);
  res.json({ ok: true, url: `/uploads/${safeId}/photos/${stampedName}`, sizeBytes: buf.length });
});

// --- REAL BE & CLIENT FILES WITH REVISIONS ---

router.post('/pieces/:id/be-files', auth, requireRole('directeur', 'be', 'chef'), (req, res) => {
  const { id } = req.params;
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  const { categorie, filename, base64, notes = '' } = req.body || {};
  if (!['client', 'plan', 'cnc', '3d'].includes(categorie)) {
    return res.status(400).json({ error: 'Catégorie invalide (client, plan, cnc, 3d)' });
  }
  if (req.user.role === 'chef' && categorie !== 'client') {
    return res.status(403).json({ error: 'Seul le BE ou le Directeur peut déposer des fichiers BE' });
  }
  if (!filename || !base64) {
    return res.status(400).json({ error: 'Fichier requis' });
  }

  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(safeName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
    return res.status(400).json({ error: `Extension non autorisée : ${ext}` });
  }

  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  const subFolder = categorie === 'client' ? 'client' : 'be';
  const dir = path.join(UPLOADS_DIR, safeId, subFolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const raw = String(base64).includes(',') ? String(base64).split(',')[1] : String(base64);
  const buf = Buffer.from(raw, 'base64');
  const revision = nextRevisionLabel(id, categorie);
  const revSlug = revision.replace(/\s+/g, '');
  const storedName = `${Date.now()}_${revSlug}_${safeName}`;
  fs.writeFileSync(path.join(dir, storedName), buf);
  const url = `/uploads/${safeId}/${subFolder}/${storedName}`;
  const fileId = `bef_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  transaction(() => {
    runSql('UPDATE be_files SET isActive = 0 WHERE pieceId = ? AND categorie = ?', [id, categorie]);
    runSql(
      `INSERT INTO be_files (id, pieceId, categorie, revision, filename, url, sizeBytes, notes, isActive, uploadedById, uploadedBy, createdAt)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`,
      [fileId, id, categorie, revision, safeName, url, buf.length, String(notes).trim(), req.user.id, req.user.nom, new Date().toLocaleString('fr-FR')]
    );
    runSql('UPDATE pieces SET beValide = 0, beNonRequis = 0, planningValide = 0 WHERE id = ?', [id]);
    if (categorie === 'plan') runSql('UPDATE pieces SET beNomFichier = ? WHERE id = ?', [`${safeName} (${revision})`, id]);
    if (categorie === 'cnc') runSql('UPDATE pieces SET beProgramme = ? WHERE id = ?', [`${safeName} (${revision})`, id]);
    if (categorie === '3d') runSql('UPDATE pieces SET beDessin3d = ? WHERE id = ?', [`${safeName} (${revision})`, id]);
  });

  logAudit(req.user, 'FICHIER BE PUBLIÉ', `${id} · ${categorie.toUpperCase()} ${revision} — ${safeName}`);
  logPieceEvent(id, req.user, 'fichier', `Fichier ${categorie.toUpperCase()} déposé (${revision})`, `${safeName}${notes ? ` · ${notes}` : ''}`);
  res.status(201).json({ ok: true, id: fileId, revision, url, filename: safeName });
});

// --- VALIDATION WORKFLOW (DIRECTION -> BE + CHEF EN PARALLÈLE -> OPÉRATEUR) ---

router.post('/pieces/:id/validate-direction', auth, requireRole('directeur'), (req, res) => {
  const { id } = req.params;
  const { action = 'approve', motif = '' } = req.body || {};
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  if (action === 'reject') {
    runSql("UPDATE pieces SET validationDirection = 0, planningValide = 0, statut = 'Refusé' WHERE id = ?", [id]);
    logAudit(req.user, 'OF REFUSÉ', `${id} refusé${motif ? ` : ${motif}` : ''}`);
    logPieceEvent(id, req.user, 'refus_direction', 'OF refusé par la Direction', motif || '');
    return res.json({ ok: true, statut: 'Refusé' });
  }

  transaction(() => {
    const nextStatut = piece.estRepriseEnCours
      ? 'En cours'
      : (!piece.chuteDispo && !piece.achatFait ? 'À acheter' : 'À planifier');
    const planVal = piece.estRepriseEnCours ? 1 : piece.planningValide;
    runSql(
      'UPDATE pieces SET validationDirection = 1, statut = ?, planningValide = ? WHERE id = ?',
      [nextStatut, planVal, id]
    );
    syncPieceFromOperations(id);
  });

  logAudit(req.user, 'OF VALIDÉ DIRECTION', `${id} validé par le Directeur`);
  logPieceEvent(id, req.user, 'validation_direction', 'Validé par la Direction', 'OF autorisé pour BE & Atelier');
  res.json({ ok: true });
});

router.post('/pieces/:id/be-validate', auth, requireRole('be', 'directeur'), (req, res) => {
  const { id } = req.params;
  const { nonRequis = false } = req.body || {};
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  transaction(() => {
    runSql(
      'UPDATE pieces SET beValide = ?, beNonRequis = ? WHERE id = ?',
      [nonRequis ? 0 : 1, nonRequis ? 1 : 0, id]
    );
    const updated = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
    if (updated.validationDirection && updated.chefValide && (updated.chuteDispo || updated.achatFait)) {
      runSql("UPDATE pieces SET statut = 'Prêt atelier' WHERE id = ? AND statut IN ('À planifier', 'À acheter')", [id]);
    }
    syncPieceFromOperations(id);
  });

  const label = nonRequis ? 'Pas d’étude BE requise' : 'Dossier BE validé (Plans / 3D / CNC)';
  logAudit(req.user, 'BE VALIDÉ', `${id} — ${label}`);
  logPieceEvent(id, req.user, 'be_valide', label, '');
  res.json({ ok: true });
});

router.post('/pieces/:id/chef-validate', auth, requireRole('chef', 'directeur'), (req, res) => {
  const { id } = req.params;
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  transaction(() => {
    runSql('UPDATE pieces SET chefValide = 1 WHERE id = ?', [id]);
    const updated = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
    if (updated.validationDirection && (updated.beValide || updated.beNonRequis) && (updated.chuteDispo || updated.achatFait)) {
      runSql("UPDATE pieces SET statut = 'Prêt atelier' WHERE id = ? AND statut IN ('À planifier', 'À acheter')", [id]);
    }
    syncPieceFromOperations(id);
  });

  logAudit(req.user, 'CHEF VALIDÉ', `${id} — Matière, outillage & distribution validés`);
  logPieceEvent(id, req.user, 'chef_valide', 'Matière, outillage & affectation validés (Chef)', `Matière : ${piece.matiere || '—'} · Outillage : ${piece.outils || '—'}`);
  res.json({ ok: true });
});

// --- QUALIFIED OPERATOR STOPS WITH TARGETED ROLE ALERTS ---

router.post('/operations/:opId/stop', auth, (req, res) => {
  const { opId } = req.params;
  const { categorie = 'pause', motif = '' } = req.body || {};
  const op = queryOne('SELECT * FROM operations WHERE id = ?', [opId]);
  if (!op) return res.status(404).json({ error: 'Opération introuvable' });
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [op.pieceId]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  const canOperate = ['directeur', 'chef'].includes(req.user.role) || op.operateurId === req.user.id;
  if (!canOperate) return res.status(403).json({ error: 'Cette opération est affectée à un autre opérateur' });

  const ALLOWED_CATS = ['panne', 'outil', 'matiere', 'plan_be', 'pause'];
  const cat = ALLOWED_CATS.includes(categorie) ? categorie : 'pause';
  const cibleMap = {
    panne: 'chef',
    outil: 'chef',
    matiere: 'directeur',
    plan_be: 'be',
    pause: 'none'
  };
  const labelMap = {
    panne: 'Panne machine',
    outil: 'Manque outil / plaquette',
    matiere: 'Manque matière / brut',
    plan_be: 'Problème plan / programme BE',
    pause: 'Pause / Fin de poste'
  };
  const cibleRole = cibleMap[cat];
  const now = Date.now();
  const nowStr = new Date().toLocaleString('fr-FR');
  const elapsedSegment = op.startedAt > 0 ? Math.max(1, Math.round((now - op.startedAt) / 60000)) : 0;
  const newTotal = (op.tempsReelMin || 0) + (op.statut === 'En cours' ? elapsedSegment : 0);
  const stopId = `stp_${now}_${Math.floor(Math.random() * 1000)}`;
  const cleanMotif = String(motif || '').trim() || labelMap[cat];

  transaction(() => {
    const nextOpStatut = cat === 'panne' ? 'Panne machine' : 'En pause';
    runSql(
      'UPDATE operations SET statut = ?, tempsReelMin = ?, startedAt = 0 WHERE id = ?',
      [nextOpStatut, newTotal, op.id]
    );
    if (op.statut === 'En cours' && elapsedSegment > 0) {
      incrementMachineHours(op.machineId, elapsedSegment);
    }

    runSql(
      `INSERT INTO operation_stops (
        id, pieceId, operationId, machineId, operateurId, operateurNom,
        categorie, cibleRole, motif, statut, dureeMin, createdAtMs, createdAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        stopId, piece.id, op.id, op.machineId, req.user.id, req.user.nom,
        cat, cibleRole, cleanMotif, cat === 'pause' ? 'Résolu' : 'Ouvert', 0, now, nowStr
      ]
    );

    if (cat === 'panne') {
      const panneId = `pan_${now}_${Math.floor(Math.random() * 1000)}`;
      runSql(
        `INSERT INTO pannes (id, machineId, pieceId, operationId, declareParId, declarePar, motif, statut, dureeArretMin, createdAtMs, createdAt)
         VALUES (?,?,?,?,?,?,?,'Ouverte',0,?,?)`,
        [panneId, op.machineId, piece.id, op.id, req.user.id, req.user.nom, cleanMotif, now, nowStr]
      );
      if (op.machineId) runSql('UPDATE machines SET enPanne = 1 WHERE id = ?', [op.machineId]);
    }

    syncPieceFromOperations(piece.id);
  });

  logAudit(req.user, `ARRÊT (${labelMap[cat].toUpperCase()})`, `${piece.id} · ${op.libelle} — ${cleanMotif}`);
  logPieceEvent(piece.id, req.user, `arret_${cat}`, `${labelMap[cat]} (${op.libelle})`, cleanMotif);
  res.json({ ok: true, stopId, categorie: cat, cibleRole });
});

router.post('/stops/:id/resolve', auth, requireRole('directeur', 'chef', 'be'), (req, res) => {
  const { id } = req.params;
  const stop = queryOne('SELECT * FROM operation_stops WHERE id = ?', [id]);
  if (!stop) return res.status(404).json({ error: 'Arrêt introuvable' });

  const dureeMin = stop.createdAtMs > 0 ? Math.max(1, Math.round((Date.now() - stop.createdAtMs) / 60000)) : 10;
  const nowStr = new Date().toLocaleString('fr-FR');

  transaction(() => {
    runSql(
      "UPDATE operation_stops SET statut = 'Résolu', dureeMin = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ?",
      [dureeMin, nowStr, req.user.nom, id]
    );

    if (stop.categorie === 'panne') {
      runSql(
        "UPDATE pannes SET statut = 'Résolue', dureeArretMin = ?, resolvedAt = ? WHERE pieceId = ? AND operationId = ? AND statut = 'Ouverte'",
        [dureeMin, nowStr, stop.pieceId, stop.operationId]
      );
      if (stop.machineId) {
        const remaining = queryOne("SELECT COUNT(*) AS c FROM pannes WHERE machineId = ? AND statut = 'Ouverte'", [stop.machineId]).c;
        if (remaining === 0) runSql('UPDATE machines SET enPanne = 0 WHERE id = ?', [stop.machineId]);
      }
      if (stop.operationId) {
        runSql("UPDATE operations SET statut = 'En pause' WHERE id = ? AND statut = 'Panne machine'", [stop.operationId]);
      }
      syncPieceFromOperations(stop.pieceId);
    }
  });

  logAudit(req.user, 'ARRÊT RÉSOLU', `${stop.pieceId} · ${stop.categorie} résolu (${dureeMin} min)`);
  logPieceEvent(stop.pieceId, req.user, 'arret_resolu', `Blocage résolu (${stop.categorie})`, `${stop.motif} · durée ${dureeMin} min`);
  res.json({ ok: true, dureeMin });
});

// --- AI 2D PLAN ANALYZER FOR BE ---

router.post('/be/analyze-plan', auth, requireRole('directeur', 'be', 'chef'), async (req, res) => {
  try {
    const { fileId, filename, base64, attachments = [], notes = '' } = req.body || {};
    let buf = null;
    let name = filename || 'plan.pdf';

    if (fileId) {
      const f = queryOne('SELECT * FROM be_files WHERE id = ?', [fileId]);
      if (!f) return res.status(404).json({ error: 'Fichier introuvable' });
      const rel = String(f.url || '').replace(/^\/uploads\//, '');
      const fullPath = path.join(UPLOADS_DIR, rel);
      if (fs.existsSync(fullPath)) buf = fs.readFileSync(fullPath);
      name = f.filename;
    } else if (base64) {
      const raw = String(base64).includes(',') ? String(base64).split(',')[1] : String(base64);
      buf = Buffer.from(raw, 'base64');
    }

    const result = await analyzePlanDocument({
      buffer: buf,
      filename: name,
      notes,
      attachments: Array.isArray(attachments) ? attachments : []
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erreur analyse plan : ' + err.message });
  }
});

router.post('/be/refine-3d', auth, requireRole('directeur', 'be', 'chef'), async (req, res) => {
  try {
    const {
      pieceId,
      fileId,
      filename,
      base64,
      attachments = [],
      cadSpec,
      prompt,
      history,
      ficheTechnique,
      includePlan = false,
      errorContext = '',
      visualAudit = false,
      workMode = 'standard',
      complexPhase = '',
      validatedBrief = null
    } = req.body || {};
    const cleanAttachments = Array.isArray(attachments) ? attachments.filter(a => a && a.base64).slice(0, 5) : [];
    const cleanPrompt = String(prompt || '').trim() || (
      errorContext
        ? 'Corrige cette erreur de compilation OpenCASCADE dans le code Replicad sans changer les cotes ni la géométrie voulue.'
        : visualAudit
          ? 'Compare ce rendu 3D (FACE / CÔTÉ / ISO) au plan 2D original, corrige immédiatement toute inversion de volume, proportion fausse ou forme manquante.'
          : (cleanAttachments.length > 0 ? 'Analyse ce document joint et génère/mets à jour la pièce 3D B-Rep complète.' : '')
    );
    if (!cleanPrompt) {
      return res.status(400).json({ error: 'Écrivez un message ou joignez une image/PDF pour l’IA.' });
    }
    let buf = null;
    let name = filename || 'plan.png';
    if (fileId) {
      const f = queryOne('SELECT * FROM be_files WHERE id = ?', [fileId]);
      if (f) {
        const rel = String(f.url || '').replace(/^\/uploads\//, '');
        const fullPath = path.join(UPLOADS_DIR, rel);
        if (fs.existsSync(fullPath)) buf = fs.readFileSync(fullPath);
        name = f.filename;
      }
    } else if (base64) {
      const raw = String(base64).includes(',') ? String(base64).split(',')[1] : String(base64);
      buf = Buffer.from(raw, 'base64');
    } else if (includePlan && pieceId && cleanAttachments.length === 0) {
      // Only attach the OF's 2D plan when explicitly requested (saves ~85% tokens on text-only edits!)
      const f = queryOne(
        "SELECT * FROM be_files WHERE pieceId = ? AND categorie IN ('client', 'plan') AND isActive = 1 ORDER BY CASE categorie WHEN 'client' THEN 0 ELSE 1 END LIMIT 1",
        [pieceId]
      );
      if (f) {
        const rel = String(f.url || '').replace(/^\/uploads\//, '');
        const fullPath = path.join(UPLOADS_DIR, rel);
        if (fs.existsSync(fullPath)) {
          buf = fs.readFileSync(fullPath);
          name = f.filename;
        }
      }
    }

    const result = await refineCadSpecWithAI({
      cadSpec,
      prompt: cleanPrompt,
      history: Array.isArray(history) ? history : [],
      planBuffer: buf,
      filename: name,
      attachments: cleanAttachments,
      ficheTechnique,
      errorContext: String(errorContext || ''),
      visualAudit: Boolean(visualAudit),
      workMode: workMode === 'complex' ? 'complex' : 'standard',
      complexPhase: ['read', 'build', 'compare'].includes(complexPhase) ? complexPhase : '',
      validatedBrief: validatedBrief && typeof validatedBrief === 'object' ? validatedBrief : null
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Erreur IA : ' + err.message });
  }
});

router.put('/pieces/:id/be-studio', auth, requireRole('directeur', 'be', 'chef'), (req, res) => {
  const { id } = req.params;
  const piece = queryOne('SELECT id FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  const { cadSpec, ficheTechnique, beChat } = req.body || {};
  transaction(() => {
    if (cadSpec !== undefined) {
      runSql('UPDATE pieces SET cadSpecJson = ? WHERE id = ?', [cadSpec ? JSON.stringify(cadSpec) : '', id]);
    }
    if (ficheTechnique !== undefined) {
      runSql('UPDATE pieces SET ficheTechniqueJson = ? WHERE id = ?', [ficheTechnique ? JSON.stringify(ficheTechnique) : '', id]);
    }
    if (beChat !== undefined) {
      const trimmed = Array.isArray(beChat) ? beChat.slice(-40) : [];
      runSql('UPDATE pieces SET beChatJson = ? WHERE id = ?', [JSON.stringify(trimmed), id]);
    }
  });
  res.json({ ok: true });
});

router.post('/pieces/:id/apply-fiche-ia', auth, requireRole('directeur', 'be', 'chef'), (req, res) => {
  const { id } = req.params;
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  const { ficheTechnique = {}, replaceOperations = false } = req.body || {};
  const machines = queryAll('SELECT * FROM machines WHERE actif = 1');

  const mat = [ficheTechnique.material, ficheTechnique.rawStock].filter(Boolean).join(' · ');
  const qualityParts = [
    ...(Array.isArray(ficheTechnique.criticalTolerances) && ficheTechnique.criticalTolerances.length
      ? [`Tolérances : ${ficheTechnique.criticalTolerances.join(', ')}`] : []),
    ...(Array.isArray(ficheTechnique.specialNotes) && ficheTechnique.specialNotes.length
      ? [`Notes : ${ficheTechnique.specialNotes.join(' | ')}`] : [])
  ];
  const notesQualite = qualityParts.join(' — ');

  transaction(() => {
    if (mat || notesQualite || replaceOperations) {
      runSql('UPDATE pieces SET planningValide = 0, chefValide = 0, beValide = 0, beNonRequis = 0 WHERE id = ?', [id]);
    }
    if (mat) {
      runSql('UPDATE pieces SET matiere = ? WHERE id = ?', [mat, id]);
    }
    if (notesQualite) {
      const merged = piece.notesQualite ? `${piece.notesQualite} | ${notesQualite}` : notesQualite;
      runSql('UPDATE pieces SET notesQualite = ? WHERE id = ?', [merged, id]);
    }
    if (replaceOperations && Array.isArray(ficheTechnique.suggestedOperations) && ficheTechnique.suggestedOperations.length > 0) {
      const hasStarted = queryOne("SELECT id FROM operations WHERE pieceId = ? AND statut != 'En attente'", [id]);
      if (!hasStarted) {
        runSql('DELETE FROM operations WHERE pieceId = ?', [id]);
        ficheTechnique.suggestedOperations.forEach((op, idx) => {
          const tLow = String(op.typeMachine || '').toLowerCase();
          const m = machines.find(x => (x.type || '').toLowerCase().includes(tLow)) || machines[0];
          const reg = Math.max(0, parseInt(op.tempsReglageMin ?? 20, 10) || 0);
          const unit = Math.max(0, Number(op.tempsUnitaireMin ?? 10) || 0);
          const planned = computeOpPlannedMin(reg, unit, piece.quantitePrevue, 60);
          runSql(
            `INSERT INTO operations (id, pieceId, ordre, libelle, machineId, operateurId, tempsReglageMin, tempsUnitaireMin, tempsPrevuMin, statut)
             VALUES (?,?,?,?,?,?,?,?,?,'En attente')`,
            [
              `op_${id}_${(idx + 1) * 10}_${Math.floor(Math.random() * 1000)}`,
              id,
              (idx + 1) * 10,
              String(op.libelle || `Opération ${idx + 1}`).trim(),
              m?.id || piece.machineId,
              piece.operateurId,
              reg,
              unit,
              planned
            ]
          );
        });
      }
    }
    syncPieceFromOperations(id);
  });

  logAudit(req.user, 'FICHE IA APPLIQUÉE', `${id} · Matière / Tolérances${replaceOperations ? ' + Gamme' : ''}`);
  logPieceEvent(id, req.user, 'fiche_ia', 'Fiche technique IA appliquée à l’OF', `${mat || ''}${notesQualite ? ` · ${notesQualite}` : ''}`);
  res.json({ ok: true });
});

router.get('/be-files/:fileId/text', auth, (req, res) => {
  const f = queryOne('SELECT * FROM be_files WHERE id = ?', [req.params.fileId]);
  if (!f) return res.status(404).json({ error: 'Fichier introuvable' });
  const ext = path.extname(f.filename).toLowerCase();
  if (!TEXT_PREVIEW_EXTS.has(ext)) {
    return res.status(400).json({ error: 'Aperçu texte réservé aux programmes CNC / fichiers texte' });
  }
  const absPath = path.join(__dirname, '../..', f.url.replace(/^\/+/, ''));
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Fichier physique introuvable' });
  const content = fs.readFileSync(absPath, 'utf8').slice(0, 100000);
  res.json({ ok: true, filename: f.filename, revision: f.revision, content });
});

router.delete('/be-files/:fileId', auth, requireRole('directeur', 'be'), (req, res) => {
  const f = queryOne('SELECT * FROM be_files WHERE id = ?', [req.params.fileId]);
  if (!f) return res.status(404).json({ error: 'Fichier introuvable' });

  transaction(() => {
    runSql('DELETE FROM be_files WHERE id = ?', [f.id]);
    if (f.isActive) {
      runSql('UPDATE pieces SET planningValide = 0, beValide = 0, beNonRequis = 0 WHERE id = ?', [f.pieceId]);
      const latest = queryOne(
        'SELECT * FROM be_files WHERE pieceId = ? AND categorie = ? ORDER BY rowid DESC LIMIT 1',
        [f.pieceId, f.categorie]
      );
      if (latest) {
        runSql('UPDATE be_files SET isActive = 1 WHERE id = ?', [latest.id]);
      }
      const columns = {plan:'beNomFichier',cnc:'beProgramme','3d':'beDessin3d'};
      const column = columns[f.categorie];
      if (column) runSql(`UPDATE pieces SET ${column} = ? WHERE id = ?`, [latest ? `${latest.filename} (${latest.revision})` : '', f.pieceId]);
    }
  });

  const absPath = path.join(__dirname, '../..', f.url.replace(/^\/+/, ''));
  try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch {}

  logAudit(req.user, 'FICHIER BE SUPPRIMÉ', `${f.pieceId} · ${f.revision} (${f.filename})`);
  res.json({ ok: true });
});

// --- MULTI-OPERATION GAMME ROUTES (WITH SETUP vs UNIT TIME & SUBCONTRACTING) ---

router.post('/pieces/:id/operations', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { id } = req.params;
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });
  if (piece.statut === 'Clôturé') return res.status(400).json({ error: 'OF déjà clôturé' });

  const b = req.body || {};
  const libelle = (b.libelle || '').trim();
  if (!libelle) return res.status(400).json({ error: "Libellé d'opération requis" });

  const estSousTraitance = b.estSousTraitance ? 1 : 0;
  const machineId = estSousTraitance ? null : (resolveMachineId(b.machineId, b.machine) || piece.machineId);
  const operateurId = estSousTraitance ? null : (resolveOperateurId(b.operateurId, b.operateur) || piece.operateurId);
  const maxOrd = queryOne('SELECT COALESCE(MAX(ordre), 0) AS m FROM operations WHERE pieceId = ?', [id]).m;
  const ordre = b.ordre !== undefined ? parseInt(b.ordre, 10) : maxOrd + 10;
  const tempsReglageMin = estSousTraitance ? 0 : Math.max(0, parseInt(b.tempsReglageMin ?? 15, 10) || 0);
  const tempsUnitaireMin = estSousTraitance ? 0 : Math.max(0, Number(b.tempsUnitaireMin ?? 0) || 0);
  const diffMin = parseMinutesDiff(b.debutStr, b.finStr);
  const tempsPrevuMin = tempsUnitaireMin > 0
    ? computeOpPlannedMin(tempsReglageMin, tempsUnitaireMin, piece.quantitePrevue)
    : (diffMin > 0 ? diffMin : Math.max(5, parseInt(b.tempsPrevuMin || 60, 10) || 60));

  const opId = `op_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  transaction(() => {
    runSql(
      `INSERT INTO operations (
        id, pieceId, ordre, libelle, machineId, operateurId,
        tempsReglageMin, tempsUnitaireMin, tempsPrevuMin, statut,
        debutStr, finStr, datePlanifiee, estSousTraitance, sousTraitant, dateEnvoi, dateRetourPrevue
      ) VALUES (?,?,?,?,?,?,?,?,?,'En attente',?,?,?,?,?,?,?)`,
      [
        opId, id, ordre, libelle, machineId, operateurId,
        tempsReglageMin, tempsUnitaireMin, tempsPrevuMin,
        b.debutStr || '', b.finStr || '', b.datePlanifiee || '',
        estSousTraitance, (b.sousTraitant || '').trim(), b.dateEnvoi || '', b.dateRetourPrevue || ''
      ]
    );
    runSql('UPDATE pieces SET planningValide = 0, chefValide = 0 WHERE id = ?', [id]);
    syncPieceFromOperations(id);
  });

  logAudit(req.user, 'OPÉRATION AJOUTÉE', `${id} · Op ${ordre} ${libelle}${estSousTraitance ? ` (Sous-traitance: ${b.sousTraitant || 'Externe'})` : ''}`);
  res.status(201).json({ ok: true, id: opId });
});

router.put('/operations/:opId', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { opId } = req.params;
  const op = queryOne('SELECT * FROM operations WHERE id = ?', [opId]);
  if (!op) return res.status(404).json({ error: 'Opération introuvable' });
  if (op.statut === 'En cours' || op.statut === 'Panne machine') return res.status(409).json({ error: 'Mettez l’opération en pause ou résolvez la panne avant de modifier son affectation ou ses temps.' });
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [op.pieceId]);

  const b = req.body || {};
  if (b.machineTypeRequis !== undefined && (typeof b.machineTypeRequis !== 'string' || b.machineTypeRequis.length > 150 || (b.machineTypeRequis && !queryOne('SELECT id FROM machines WHERE type = ? AND actif = 1', [b.machineTypeRequis])))) return res.status(400).json({error:'Type de machine actif invalide.'});
  const machineTypeRequis = b.machineTypeRequis !== undefined ? b.machineTypeRequis : (op.machineTypeRequis || '');
  const libelle = b.libelle !== undefined && String(b.libelle).trim() ? String(b.libelle).trim() : op.libelle;
  const ordre = b.ordre !== undefined ? parseInt(b.ordre, 10) : op.ordre;
  const estSousTraitance = b.estSousTraitance !== undefined ? (b.estSousTraitance ? 1 : 0) : op.estSousTraitance;
  const machineId = estSousTraitance
    ? null
    : ((b.machineId !== undefined || b.machine !== undefined) ? (resolveMachineId(b.machineId, b.machine) ?? op.machineId) : op.machineId);
  const operateurId = estSousTraitance
    ? null
    : ((b.operateurId !== undefined || b.operateur !== undefined) ? (resolveOperateurId(b.operateurId, b.operateur) ?? op.operateurId) : op.operateurId);

  const tempsReglageMin = b.tempsReglageMin !== undefined ? Math.max(0, parseInt(b.tempsReglageMin, 10) || 0) : (op.tempsReglageMin || 0);
  const tempsUnitaireMin = b.tempsUnitaireMin !== undefined ? Math.max(0, Number(b.tempsUnitaireMin) || 0) : (op.tempsUnitaireMin || 0);
  const debutStr = b.debutStr !== undefined ? b.debutStr : (op.debutStr || '');
  const finStr = b.finStr !== undefined ? b.finStr : (op.finStr || '');
  const datePlanifiee = b.datePlanifiee !== undefined ? b.datePlanifiee : (op.datePlanifiee || '');
  const diffMin = parseMinutesDiff(debutStr, finStr);

  let tempsPrevuMin = op.tempsPrevuMin;
  if (tempsUnitaireMin > 0) {
    tempsPrevuMin = computeOpPlannedMin(tempsReglageMin, tempsUnitaireMin, piece?.quantitePrevue || 1);
  } else if (b.tempsPrevuMin !== undefined) {
    tempsPrevuMin = Math.max(5, parseInt(b.tempsPrevuMin, 10) || op.tempsPrevuMin);
  } else if (diffMin > 0) {
    tempsPrevuMin = diffMin;
  }

  const sousTraitant = b.sousTraitant !== undefined ? String(b.sousTraitant).trim() : (op.sousTraitant || '');
  const dateEnvoi = b.dateEnvoi !== undefined ? b.dateEnvoi : (op.dateEnvoi || '');
  const dateRetourPrevue = b.dateRetourPrevue !== undefined ? b.dateRetourPrevue : (op.dateRetourPrevue || '');

  transaction(() => {
    runSql(
      `UPDATE operations
       SET libelle = ?, ordre = ?, machineId = ?, operateurId = ?, machineTypeRequis = ?,
           tempsReglageMin = ?, tempsUnitaireMin = ?, tempsPrevuMin = ?,
           debutStr = ?, finStr = ?, datePlanifiee = ?,
           estSousTraitance = ?, sousTraitant = ?, dateEnvoi = ?, dateRetourPrevue = ?
       WHERE id = ?`,
      [
        libelle, ordre, machineId, operateurId, machineTypeRequis,
        tempsReglageMin, tempsUnitaireMin, tempsPrevuMin,
        debutStr, finStr, datePlanifiee,
        estSousTraitance, sousTraitant, dateEnvoi, dateRetourPrevue, opId
      ]
    );
    runSql('UPDATE pieces SET planningValide = 0, chefValide = 0 WHERE id = ?', [op.pieceId]);
    syncPieceFromOperations(op.pieceId);
  });

  logAudit(req.user, 'OPÉRATION MODIFIÉE', `${op.pieceId} · ${libelle}`);
  res.json({ ok: true, tempsPrevuMin });
});

router.delete('/operations/:opId', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { opId } = req.params;
  const op = queryOne('SELECT * FROM operations WHERE id = ?', [opId]);
  if (!op) return res.status(404).json({ error: 'Opération introuvable' });
  if (op.statut === 'En cours') return res.status(400).json({ error: 'Impossible de supprimer une opération en cours' });

  const count = queryOne('SELECT COUNT(*) AS c FROM operations WHERE pieceId = ?', [op.pieceId]).c;
  if (count <= 1) {
    return res.status(400).json({ error: 'Un OF doit conserver au moins une opération' });
  }

  transaction(() => {
    runSql('DELETE FROM operations WHERE id = ?', [opId]);
    runSql('UPDATE pieces SET planningValide = 0, chefValide = 0 WHERE id = ?', [op.pieceId]);
    syncPieceFromOperations(op.pieceId);
  });

  logAudit(req.user, 'OPÉRATION SUPPRIMÉE', `${op.pieceId} · ${op.libelle}`);
  res.json({ ok: true });
});

router.post('/operations/:opId/:action', auth, (req, res) => {
  const { opId, action } = req.params;
  const op = queryOne('SELECT * FROM operations WHERE id = ?', [opId]);
  if (!op) return res.status(404).json({ error: 'Opération introuvable' });
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [op.pieceId]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });

  const result = runOperationAction(op, piece, action, req.body, req.user);
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// --- PIECE-LEVEL WORKFLOW ACTIONS ---

router.post('/pieces/:id/:action', auth, (req, res) => {
  const { id, action } = req.params;
  const p = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Pièce introuvable' });
  const b = req.body || {};

  if (action === 'be') {
    if (!['directeur', 'be'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    runSql(
      'UPDATE pieces SET beNomFichier = ?, beProgramme = ?, beDessin3d = ? WHERE id = ?',
      [b.nomFichier || '', b.programme || '', b.dessin3d || '', id]
    );
    logAudit(req.user, 'DOSSIER BE MIS À JOUR', `${id} (${b.nomFichier || '—'})`);
    return res.json({ ok: true });
  }

  if (action === 'chef') {
    if (!['directeur', 'chef'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    const chute = b.chuteDispo !== undefined ? (b.chuteDispo ? 1 : 0) : p.chuteDispo;
    let statut = p.statut;
    if (p.statut !== 'Clôturé') {
      if (!chute && !p.achatFait) statut = 'À acheter';
      else if (p.statut === 'À planifier' || p.statut === 'À acheter') statut = 'Prêt atelier';
    }

    const quantitePrevue = b.quantitePrevue !== undefined ? Math.max(1, parseInt(b.quantitePrevue, 10) || p.quantitePrevue) : p.quantitePrevue;
    const machineId = (b.machineId !== undefined || b.machine !== undefined)
      ? (resolveMachineId(b.machineId, b.machine) ?? p.machineId)
      : p.machineId;
    const operateurId = (b.operateurId !== undefined || b.operateur !== undefined)
      ? (resolveOperateurId(b.operateurId, b.operateur) ?? p.operateurId)
      : p.operateurId;

    const debutStr = b.debutStr !== undefined ? b.debutStr : (p.debutStr || '');
    const finStr = b.finStr !== undefined ? b.finStr : (p.finStr || '');
    const diffMin = parseMinutesDiff(debutStr, finStr);
    const tempsPrevuMin = b.tempsPrevuMin !== undefined
      ? Math.max(5, parseInt(b.tempsPrevuMin, 10) || p.tempsPrevuMin)
      : (diffMin > 0 ? diffMin : p.tempsPrevuMin);

    const currentOperation = queryOne("SELECT * FROM operations WHERE pieceId = ? AND statut IN ('En cours','Panne machine') LIMIT 1", [id]);
    if (currentOperation && (currentOperation.machineId !== machineId || currentOperation.operateurId !== operateurId)) {
      return res.status(409).json({error:'Mettez l’opération en pause ou résolvez la panne avant de changer son affectation.'});
    }
    transaction(() => {
      runSql(
        `UPDATE pieces
         SET quantitePrevue = ?, machineId = ?, operateurId = ?, matiere = ?, outils = ?, fournisseur = ?,
             chuteDispo = ?, statut = ?, urgence = ?, delai = ?, ordrePlanning = ?,
             tempsPrevuMin = ?, debutStr = ?, finStr = ?, planningValide = 0, chefValide = 0
         WHERE id = ?`,
        [
          quantitePrevue,
          machineId,
          operateurId,
          b.matiere !== undefined ? b.matiere : p.matiere,
          b.outils !== undefined ? b.outils : p.outils,
          b.fournisseur !== undefined ? b.fournisseur : p.fournisseur,
          chute,
          statut,
          b.urgence || p.urgence,
          b.delai || p.delai,
          b.ordrePlanning !== undefined ? parseInt(b.ordrePlanning, 10) : p.ordrePlanning,
          tempsPrevuMin,
          debutStr,
          finStr,
          id
        ]
      );

      const ops = queryAll('SELECT * FROM operations WHERE pieceId = ? ORDER BY ordre ASC, rowid ASC', [id]);
      const targetOp = ops.find(o => o.statut !== 'Terminée' && !o.estSousTraitance) || ops[0];
      if (targetOp) {
        const updateOpTime = ops.length === 1 && !(targetOp.tempsUnitaireMin > 0) ? tempsPrevuMin : targetOp.tempsPrevuMin;
        runSql(
          `UPDATE operations
           SET machineId = ?, operateurId = ?, debutStr = ?, finStr = ?, tempsPrevuMin = ?
           WHERE id = ?`,
          [machineId, operateurId, debutStr, finStr, updateOpTime, targetOp.id]
        );
      }
      syncPieceFromOperations(id);
    });

    logAudit(req.user, 'PLANIFICATION MODIFIÉE', `${id} modifié (validation TV requise)`);
    return res.json({ ok: true });
  }

  if (['op-start', 'op-finish', 'pause', 'panne'].includes(action)) {
    const ops = queryAll('SELECT * FROM operations WHERE pieceId = ? ORDER BY ordre ASC, rowid ASC', [id]);
    const targetOp =
      ops.find(o => o.statut === 'En cours') ||
      ops.find(o => o.statut !== 'Terminée' && o.operateurId === req.user.id) ||
      ops.find(o => o.statut !== 'Terminée') ||
      ops[0];
    if (!targetOp) return res.status(400).json({ error: 'Aucune opération sur cet OF' });
    const result = runOperationAction(targetOp, p, action, b, req.user);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'buy') {
    if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
    transaction(() => {
      runSql("UPDATE pieces SET achatFait = 1, statut = 'Prêt atelier' WHERE id = ?", [id]);
      syncPieceFromOperations(id);
    });
    logAudit(req.user, 'ACHAT VALIDÉ', `Matière validée pour ${id}`);
    logPieceEvent(id, req.user, 'achat_valide', 'Achat matière validé (Direction)', p.matiere || '');
    return res.json({ ok: true });
  }

  if (action === 'close') {
    if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
    const prixFinal = Number(b.prixFinal) >= 0 ? Number(b.prixFinal) : (p.prixFinal || 0);
    const prixEstime = Number(b.prixEstime) >= 0 ? Number(b.prixEstime) : (p.prixEstime || 0);
    const notesQualite = b.notesQualite !== undefined ? String(b.notesQualite).trim() : (p.notesQualite || '');
    runSql(
      "UPDATE pieces SET statut = 'Clôturé', prixFinal = ?, prixEstime = ?, notesQualite = ?, closedAt = ? WHERE id = ?",
      [prixFinal, prixEstime, notesQualite, new Date().toLocaleString('fr-FR'), id]
    );
    logAudit(req.user, 'CLÔTURE', `Dossier ${id} clôturé${prixFinal > 0 ? ` · Prix final : ${prixFinal.toLocaleString('fr-FR')} DZD` : ''}`);
    logPieceEvent(id, req.user, 'cloture', 'Dossier clôturé (Direction)', prixFinal > 0 ? `Prix final : ${prixFinal.toLocaleString('fr-FR')} DZD` : '');
    return res.json({ ok: true });
  }

  if (action === 'archive') {
    if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
    const archived = b.archived !== undefined ? (b.archived ? 1 : 0) : (p.archived ? 0 : 1);
    runSql('UPDATE pieces SET archived = ? WHERE id = ?', [archived, id]);
    logAudit(req.user, archived ? 'OF ARCHIVÉ' : 'OF DÉSARCHIVÉ', id);
    logPieceEvent(id, req.user, 'archive', archived ? 'OF archivé' : 'OF restauré des archives', '');
    return res.json({ ok: true, archived: !!archived });
  }

  return res.status(404).json({ error: 'Action inconnue' });
});

module.exports = router;
