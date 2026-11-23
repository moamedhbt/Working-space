const express = require('express');
const {
  queryAll,
  queryOne,
  runSql,
  transaction,
  logAudit,
  getSettings,
  syncPieceFromOperations,
  getEnrichedPieces,
  getEnrichedPannes
} = require('../db/database');
const { PRIO_RANK, analyzeScheduleAndAI, estimateNewOfAI } = require('../services/scheduler');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

function parseMinutesDiff(debutStr, finStr) {
  if (!debutStr || !finStr || !debutStr.includes(':') || !finStr.includes(':')) return 0;
  const [h1, m1] = debutStr.split(':').map(Number);
  const [h2, m2] = finStr.split(':').map(Number);
  if ([h1, m1, h2, m2].some(n => !Number.isFinite(n))) return 0;
  const diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  return diff > 0 ? diff : 0;
}

function runAutoOptimize(reqUser) {
  const pieces = getEnrichedPieces("WHERE p.statut != 'Clôturé'");
  const machines = queryAll('SELECT * FROM machines');
  const users = queryAll('SELECT id, nom, username, role, actif FROM users');
  const pannes = getEnrichedPannes();
  const settings = getSettings();

  // Sort: ready first, then urgency, then deadline
  pieces.sort((a, b) => {
    const aBlocked = (!a.chuteDispo && !a.achatFait) ? 1 : 0;
    const bBlocked = (!b.chuteDispo && !b.achatFait) ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    return (PRIO_RANK[a.urgence] || 9) - (PRIO_RANK[b.urgence] || 9) || (a.delai || '').localeCompare(b.delai || '');
  });

  // Update order first, then run full constraint-aware multi-op calendar scheduler
  const orderedPieces = pieces.map((p, i) => ({ ...p, ordrePlanning: i + 1 }));
  const analysis = analyzeScheduleAndAI(orderedPieces, machines, users, pannes, settings);

  transaction(() => {
    orderedPieces.forEach(p => {
      runSql('UPDATE pieces SET ordrePlanning = ?, planningValide = 0 WHERE id = ?', [p.ordrePlanning, p.id]);
    });
    // Persist calculated precedence-safe dates & time slots on operations
    for (const s of analysis.scheduledOps) {
      runSql(
        'UPDATE operations SET datePlanifiee = ?, debutStr = ?, finStr = ? WHERE id = ?',
        [s.datePlanifiee || '', s.debutStr || '', s.finStr || '', s.opId]
      );
    }
    orderedPieces.forEach(p => syncPieceFromOperations(p.id));
  });

  logAudit(
    reqUser,
    'PLANNING OPTIMISÉ IA',
    `${orderedPieces.length} OF ordonnancés (gammes + calendrier) · ${analysis.conflicts.length} alerte(s)`
  );

  return {
    ok: true,
    alerts: analysis.conflicts.map(c => c.text),
    conflicts: analysis.conflicts,
    recommendations: analysis.aiRecommendations,
    machineLoads: analysis.machineLoads
  };
}

router.get('/tv', (req, res) => {
  const pieces = getEnrichedPieces("WHERE p.planningValide = 1 AND p.statut != 'Clôturé'");
  const machines = queryAll('SELECT * FROM machines WHERE actif = 1 ORDER BY nom');
  res.json({ pieces, machines });
});

router.post('/planning/estimate-of', auth, requireRole('directeur', 'chef', 'be'), (req, res) => {
  const pieces = getEnrichedPieces();
  const machines = queryAll('SELECT * FROM machines');
  const settings = getSettings();
  const result = estimateNewOfAI(req.body || {}, pieces, machines, settings);
  res.json(result);
});

router.post('/planning/optimize', auth, requireRole('directeur', 'chef'), (req, res) => {
  const result = runAutoOptimize(req.user);
  res.json(result);
});

router.post('/planning/ai-apply', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { actionType, payload = {} } = req.body || {};

  if (actionType === 'auto_optimize') {
    const result = runAutoOptimize(req.user);
    return res.json(result);
  }

  if (actionType === 'reassign_machine') {
    const { operationId, machineId } = payload;
    const op = queryOne('SELECT * FROM operations WHERE id = ?', [operationId]);
    const mach = queryOne('SELECT * FROM machines WHERE id = ? AND actif = 1', [machineId]);
    if (!op || !mach) return res.status(400).json({ error: 'Opération ou machine introuvable' });
    transaction(() => {
      runSql('UPDATE operations SET machineId = ? WHERE id = ?', [mach.id, op.id]);
      runSql('UPDATE pieces SET planningValide = 0 WHERE id = ?', [op.pieceId]);
      syncPieceFromOperations(op.pieceId);
    });
    logAudit(req.user, 'IA APPLIQUÉE', `${op.pieceId} · ${op.libelle} → ${mach.nom}`);
    return res.json({ ok: true });
  }

  if (actionType === 'reassign_operator') {
    const { operationId, operateurId } = payload;
    const op = queryOne('SELECT * FROM operations WHERE id = ?', [operationId]);
    const user = queryOne('SELECT * FROM users WHERE id = ? AND actif = 1', [operateurId]);
    if (!op || !user) return res.status(400).json({ error: 'Opération ou opérateur introuvable' });
    transaction(() => {
      runSql('UPDATE operations SET operateurId = ? WHERE id = ?', [user.id, op.id]);
      runSql('UPDATE pieces SET planningValide = 0 WHERE id = ?', [op.pieceId]);
      syncPieceFromOperations(op.pieceId);
    });
    logAudit(req.user, 'IA APPLIQUÉE', `${op.pieceId} · ${op.libelle} → opérateur ${user.nom}`);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Type de recommandation IA inconnu' });
});

router.post('/planning/save-batch', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.json({ ok: true, updated: 0 });
  }

  let updated = 0;
  transaction(() => {
    for (const item of items) {
      const p = queryOne('SELECT * FROM pieces WHERE id = ?', [item.id]);
      if (!p) continue;

      let machineId = p.machineId;
      if (item.machineId) {
        const m = queryOne('SELECT id FROM machines WHERE id = ?', [item.machineId]);
        if (m) machineId = m.id;
      } else if (item.machine) {
        const m = queryOne('SELECT id FROM machines WHERE nom = ?', [item.machine]);
        if (m) machineId = m.id;
      }

      let operateurId = p.operateurId;
      if (item.operateurId) {
        const u = queryOne('SELECT id FROM users WHERE id = ?', [item.operateurId]);
        if (u) operateurId = u.id;
      } else if (item.operateur) {
        const u = queryOne('SELECT id FROM users WHERE nom = ?', [item.operateur]);
        if (u) operateurId = u.id;
      }

      const debutStr = item.debutStr !== undefined ? item.debutStr : (p.debutStr || '');
      const finStr = item.finStr !== undefined ? item.finStr : (p.finStr || '');
      const diffMin = parseMinutesDiff(debutStr, finStr);
      const tempsPrevuMin = diffMin > 0 ? diffMin : p.tempsPrevuMin;

      runSql(
        `UPDATE pieces
         SET machineId = ?, operateurId = ?, urgence = ?, delai = ?,
             ordrePlanning = ?, debutStr = ?, finStr = ?, tempsPrevuMin = ?, planningValide = 0
         WHERE id = ?`,
        [
          machineId,
          operateurId,
          item.urgence || p.urgence,
          item.delai || p.delai,
          item.ordrePlanning !== undefined ? parseInt(item.ordrePlanning, 10) : p.ordrePlanning,
          debutStr,
          finStr,
          tempsPrevuMin,
          p.id
        ]
      );

      const ops = queryAll('SELECT * FROM operations WHERE pieceId = ? ORDER BY ordre ASC, rowid ASC', [p.id]);
      const targetOp = ops.find(o => o.statut !== 'Terminée' && !o.estSousTraitance) || ops[0];
      if (targetOp) {
        const nextOpTime = ops.length === 1 && diffMin > 0 && !(targetOp.tempsUnitaireMin > 0) ? diffMin : targetOp.tempsPrevuMin;
        runSql(
          'UPDATE operations SET machineId = ?, operateurId = ?, debutStr = ?, finStr = ?, tempsPrevuMin = ? WHERE id = ?',
          [machineId, operateurId, debutStr, finStr, nextOpTime, targetOp.id]
        );
      }
      syncPieceFromOperations(p.id);
      updated++;
    }
  });

  logAudit(req.user, 'PLANNING ENREGISTRÉ', `${updated} OF mis à jour (validation TV requise)`);
  res.json({ ok: true, updated });
});

router.post('/planning/validate', auth, requireRole('directeur', 'chef'), (req, res) => {
  runSql("UPDATE pieces SET planningValide = 1 WHERE statut != 'Clôturé'");
  logAudit(req.user, 'PLANNING VALIDÉ TV', 'Planning publié sur les postes et écran TV');
  res.json({ ok: true });
});

router.post('/planning/simulate', auth, requireRole('directeur', 'chef'), (req, res) => {
  const {
    quantite = 10,
    machineId,
    machine,
    matiereDispo = true,
    delaiFournisseurJours = 0,
    tempsReglageMin = 15,
    tempsParPieceMin = 0
  } = req.body || {};

  const missing = [];
  if (!tempsParPieceMin || Number(tempsParPieceMin) <= 0) missing.push('Temps estimé par pièce (minutes)');
  if (!matiereDispo && (!delaiFournisseurJours || Number(delaiFournisseurJours) <= 0)) {
    missing.push('Délai fournisseur matière en Algérie (jours)');
  }

  const m = machineId
    ? queryOne('SELECT * FROM machines WHERE id = ?', [machineId])
    : queryOne('SELECT * FROM machines WHERE nom = ?', [machine]);

  const capaciteMin = m?.capaciteJourMin || 480;
  const activeOps = m
    ? queryAll(
        `SELECT o.id, o.tempsPrevuMin, o.tempsReelMin
         FROM operations o
         JOIN pieces p ON p.id = o.pieceId
         WHERE o.machineId = ? AND o.statut != 'Terminée' AND p.statut != 'Clôturé'`,
        [m.id]
      )
    : [];

  const currentLoadMin = activeOps.reduce((s, o) => s + Math.max(0, (o.tempsPrevuMin || 60) - (o.tempsReelMin || 0)), 0);
  const setupMin = Math.max(0, Number(tempsReglageMin) || 0);
  const newLoadMin = setupMin + (Number(quantite) || 1) * (Number(tempsParPieceMin) || 15);
  const totalHours = ((currentLoadMin + newLoadMin) / 60).toFixed(1);

  let verdict = '✅ Faisable sans retard';
  if (m?.enPanne) {
    verdict = `🔧 Attention : ${m.nom} est actuellement signalée en panne`;
  } else if (!matiereDispo && Number(delaiFournisseurJours) > 2) {
    verdict = `⚠️ Attention : ${delaiFournisseurJours}j d'attente matière fournisseur`;
  }
  if (currentLoadMin + newLoadMin > capaciteMin) {
    verdict = `🔴 Surcharge sur ${m?.nom || machine} (${totalHours}h / ${(capaciteMin / 60).toFixed(1)}h) — Conseillé : autre machine ou délai ajusté`;
  }

  res.json({
    ok: true,
    missing,
    machineId: m?.id || null,
    machineNom: m?.nom || machine || 'Non définie',
    currentLoadHours: (currentLoadMin / 60).toFixed(1),
    newLoadHours: (newLoadMin / 60).toFixed(1),
    setupMin,
    newLoadMin,
    totalHours,
    verdict,
    impactedCount: activeOps.length
  });
});

module.exports = router;
