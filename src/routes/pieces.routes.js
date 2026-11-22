const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  queryAll,
  queryOne,
  runSql,
  transaction,
  logAudit,
  getNextOfId,
  syncPieceFromOperations,
  getEnrichedPieces,
  getEnrichedPannes
} = require('../db/database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.stl', '.step', '.stp', '.nc', '.txt']);

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

function runOperationAction(op, piece, action, body, reqUser) {
  const b = body || {};
  const canOperate = ['directeur', 'chef'].includes(reqUser.role) || op.operateurId === reqUser.id;
  if (!canOperate) {
    return { status: 403, error: 'Cette opération est affectée à un autre opérateur' };
  }

  const now = Date.now();
  const elapsedSegment = op.startedAt > 0 ? Math.max(1, Math.round((now - op.startedAt) / 60000)) : 0;

  if (action === 'start' || action === 'op-start') {
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
      syncPieceFromOperations(piece.id);
    });
    logAudit(reqUser, 'PAUSE', `${piece.id} · ${op.libelle} (cumul ${newTotal} min)`);
    return { status: 200, ok: true, tempsReelMin: newTotal };
  }

  if (action === 'panne') {
    const motif = (b.motif || '').trim() || 'Panne non précisée';
    const newTotal = (op.tempsReelMin || 0) + (op.statut === 'En cours' ? elapsedSegment : 0);
    const panneId = 'pan_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    transaction(() => {
      runSql(
        "UPDATE operations SET statut = 'Panne machine', tempsReelMin = ?, startedAt = 0 WHERE id = ?",
        [newTotal, op.id]
      );
      if (op.machineId) {
        runSql('UPDATE machines SET enPanne = 1 WHERE id = ?', [op.machineId]);
      }
      runSql(
        `INSERT INTO pannes (id, machineId, pieceId, operationId, declareParId, declarePar, motif, statut, createdAt)
         VALUES (?,?,?,?,?,?,?,'Ouverte',?)`,
        [panneId, op.machineId || null, piece.id, op.id, reqUser.id, reqUser.nom, motif, new Date().toLocaleString('fr-FR')]
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
    return { status: 200, ok: true };
  }

  if (action === 'finish' || action === 'op-finish') {
    const newTotal = (op.tempsReelMin || 0) + (op.statut === 'En cours' ? elapsedSegment : 0);
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
    return { status: 200, ok: true, tempsReelMin: finalMins };
  }

  return { status: 404, error: 'Action opération inconnue' };
}

router.get('/state', auth, (req, res) => {
  const users = queryAll('SELECT id, nom, username, role, actif FROM users ORDER BY role, nom');
  const machines = queryAll('SELECT * FROM machines ORDER BY nom');
  const pieces = getEnrichedPieces();
  const pannes = getEnrichedPannes();
  const auditLogs = ['directeur', 'chef'].includes(req.user.role)
    ? queryAll('SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT 100')
    : [];

  res.json({
    currentUser: req.user,
    users,
    machines,
    pieces,
    pannes,
    auditLogs
  });
});

router.post('/pieces', auth, requireRole('directeur', 'chef'), (req, res) => {
  const b = req.body || {};
  if (!b.nom || !String(b.nom).trim()) {
    return res.status(400).json({ error: 'Le nom de la pièce est requis' });
  }

  const id = getNextOfId();
  const defaultMach = queryOne('SELECT id FROM machines WHERE actif = 1 ORDER BY id LIMIT 1');
  const defaultOp = queryOne("SELECT id FROM users WHERE role = 'operateur' AND actif = 1 ORDER BY id LIMIT 1");

  const machineId = resolveMachineId(b.machineId, b.machine) || defaultMach?.id || null;
  const operateurId = resolveOperateurId(b.operateurId, b.operateur) || defaultOp?.id || null;
  const quantitePrevue = Math.max(1, parseInt(b.quantitePrevue || 10, 10) || 10);
  const tempsPrevuMin = Math.max(5, parseInt(b.tempsPrevuMin || 120, 10) || 120);
  const chuteDispo = b.chuteDispo ? 1 : 0;
  const achatFait = b.matiereDispo ? 1 : 0;
  const urgence = ['Critique', 'Urgent', 'Normal'].includes(b.urgence) ? b.urgence : 'Normal';
  const delai = b.delai || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const statut = b.matiereDispo === false ? 'À acheter' : 'À planifier';
  const maxOrder = queryOne('SELECT COALESCE(MAX(ordrePlanning), 0) AS m FROM pieces').m;

  transaction(() => {
    runSql(
      `INSERT INTO pieces (
        id, nom, client, quantitePrevue, delai, urgence, statut,
        machineId, operateurId, matiere, chuteDispo, achatFait, fournisseur, outils,
        tempsPrevuMin, ordrePlanning, createdAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        String(b.nom).trim(),
        (b.client || 'Client Standard').trim(),
        quantitePrevue,
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
        maxOrder + 1,
        new Date().toLocaleString('fr-FR')
      ]
    );

    const opsInput = Array.isArray(b.operations) && b.operations.length > 0
      ? b.operations
      : [{ libelle: 'Usinage principal', machineId, operateurId, tempsPrevuMin }];

    opsInput.forEach((op, idx) => {
      const opMachId = resolveMachineId(op.machineId, op.machine) || machineId;
      const opUserId = resolveOperateurId(op.operateurId, op.operateur) || operateurId;
      runSql(
        `INSERT INTO operations (id, pieceId, ordre, libelle, machineId, operateurId, tempsPrevuMin, statut)
         VALUES (?,?,?,?,?,?,?,'En attente')`,
        [
          `op_${id}_${(idx + 1) * 10}_${Math.floor(Math.random() * 1000)}`,
          id,
          (idx + 1) * 10,
          (op.libelle || `Opération ${idx + 1}`).trim(),
          opMachId,
          opUserId,
          Math.max(5, parseInt(op.tempsPrevuMin || tempsPrevuMin, 10) || 60)
        ]
      );
    });

    syncPieceFromOperations(id);
  });

  logAudit(req.user, 'OF CRÉÉ', `${id} — ${String(b.nom).trim()} (${quantitePrevue} pcs)`);
  res.status(201).json({ ok: true, id });
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
  const dir = path.join(UPLOADS_DIR, safeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const raw = String(base64).includes(',') ? String(base64).split(',')[1] : String(base64);
  const stampedName = `${Date.now()}_${safeName}`;
  fs.writeFileSync(path.join(dir, stampedName), Buffer.from(raw, 'base64'));
  res.json({ ok: true, url: `/uploads/${safeId}/${stampedName}` });
});

// --- MULTI-OPERATION GAMME ROUTES ---

router.post('/pieces/:id/operations', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { id } = req.params;
  const piece = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!piece) return res.status(404).json({ error: 'OF introuvable' });
  if (piece.statut === 'Clôturé') return res.status(400).json({ error: 'OF déjà clôturé' });

  const b = req.body || {};
  const libelle = (b.libelle || '').trim();
  if (!libelle) return res.status(400).json({ error: "Libellé d'opération requis" });

  const machineId = resolveMachineId(b.machineId, b.machine) || piece.machineId;
  const operateurId = resolveOperateurId(b.operateurId, b.operateur) || piece.operateurId;
  const maxOrd = queryOne('SELECT COALESCE(MAX(ordre), 0) AS m FROM operations WHERE pieceId = ?', [id]).m;
  const ordre = b.ordre !== undefined ? parseInt(b.ordre, 10) : maxOrd + 10;
  const diffMin = parseMinutesDiff(b.debutStr, b.finStr);
  const tempsPrevuMin = diffMin > 0 ? diffMin : Math.max(5, parseInt(b.tempsPrevuMin || 60, 10) || 60);
  const opId = `op_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  transaction(() => {
    runSql(
      `INSERT INTO operations (id, pieceId, ordre, libelle, machineId, operateurId, tempsPrevuMin, statut, debutStr, finStr)
       VALUES (?,?,?,?,?,?,?,'En attente',?,?)`,
      [opId, id, ordre, libelle, machineId, operateurId, tempsPrevuMin, b.debutStr || '', b.finStr || '']
    );
    runSql('UPDATE pieces SET planningValide = 0 WHERE id = ?', [id]);
    syncPieceFromOperations(id);
  });

  logAudit(req.user, 'OPÉRATION AJOUTÉE', `${id} · Op ${ordre} ${libelle}`);
  res.status(201).json({ ok: true, id: opId });
});

router.put('/operations/:opId', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { opId } = req.params;
  const op = queryOne('SELECT * FROM operations WHERE id = ?', [opId]);
  if (!op) return res.status(404).json({ error: 'Opération introuvable' });

  const b = req.body || {};
  const libelle = b.libelle !== undefined && String(b.libelle).trim() ? String(b.libelle).trim() : op.libelle;
  const ordre = b.ordre !== undefined ? parseInt(b.ordre, 10) : op.ordre;
  const machineId = (b.machineId !== undefined || b.machine !== undefined)
    ? (resolveMachineId(b.machineId, b.machine) ?? op.machineId)
    : op.machineId;
  const operateurId = (b.operateurId !== undefined || b.operateur !== undefined)
    ? (resolveOperateurId(b.operateurId, b.operateur) ?? op.operateurId)
    : op.operateurId;
  const debutStr = b.debutStr !== undefined ? b.debutStr : (op.debutStr || '');
  const finStr = b.finStr !== undefined ? b.finStr : (op.finStr || '');
  const diffMin = parseMinutesDiff(debutStr, finStr);
  const tempsPrevuMin = b.tempsPrevuMin !== undefined
    ? Math.max(5, parseInt(b.tempsPrevuMin, 10) || op.tempsPrevuMin)
    : (diffMin > 0 ? diffMin : op.tempsPrevuMin);

  transaction(() => {
    runSql(
      `UPDATE operations
       SET libelle = ?, ordre = ?, machineId = ?, operateurId = ?, tempsPrevuMin = ?, debutStr = ?, finStr = ?
       WHERE id = ?`,
      [libelle, ordre, machineId, operateurId, tempsPrevuMin, debutStr, finStr, opId]
    );
    runSql('UPDATE pieces SET planningValide = 0 WHERE id = ?', [op.pieceId]);
    syncPieceFromOperations(op.pieceId);
  });

  logAudit(req.user, 'OPÉRATION MODIFIÉE', `${op.pieceId} · ${libelle}`);
  res.json({ ok: true });
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
    runSql('UPDATE pieces SET planningValide = 0 WHERE id = ?', [op.pieceId]);
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

    transaction(() => {
      runSql(
        `UPDATE pieces
         SET machineId = ?, operateurId = ?, matiere = ?, outils = ?, fournisseur = ?,
             chuteDispo = ?, statut = ?, urgence = ?, delai = ?, ordrePlanning = ?,
             tempsPrevuMin = ?, debutStr = ?, finStr = ?, planningValide = 0
         WHERE id = ?`,
        [
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

      // Keep the current active operation synchronized when edited at OF level
      const ops = queryAll('SELECT * FROM operations WHERE pieceId = ? ORDER BY ordre ASC, rowid ASC', [id]);
      const targetOp = ops.find(o => o.statut !== 'Terminée') || ops[0];
      if (targetOp) {
        const updateOpTime = ops.length === 1 ? tempsPrevuMin : targetOp.tempsPrevuMin;
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
    // Delegate seamlessly to the matching active operation
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
    return res.json({ ok: true });
  }

  return res.status(404).json({ error: 'Action inconnue' });
});

module.exports = router;
