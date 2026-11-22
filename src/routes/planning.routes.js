const express = require('express');
const {
  queryAll,
  queryOne,
  runSql,
  transaction,
  logAudit,
  syncPieceFromOperations,
  getEnrichedPieces
} = require('../db/database');
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

router.get('/tv', (req, res) => {
  const pieces = getEnrichedPieces("WHERE p.planningValide = 1 AND p.statut != 'Clôturé'");
  const machines = queryAll('SELECT * FROM machines WHERE actif = 1 ORDER BY nom');
  res.json({ pieces, machines });
});

router.post('/planning/optimize', auth, requireRole('directeur', 'chef'), (req, res) => {
  const order = { Critique: 1, Urgent: 2, Normal: 3 };
  const pieces = getEnrichedPieces("WHERE p.statut != 'Clôturé'");
  const machines = queryAll('SELECT * FROM machines WHERE actif = 1');

  const alerts = [];
  const machineLoads = {};
  const machineById = new Map();
  machines.forEach(m => {
    machineLoads[m.nom] = 0;
    machineById.set(m.id, m);
    if (m.enPanne) {
      alerts.push(`🔧 Machine en panne : ${m.nom} — Réaffectation recommandée`);
    }
  });

  pieces.forEach(p => {
    if (!p.chuteDispo && !p.achatFait) {
      alerts.push(`🔴 Blocage Matière : ${p.id} (${p.nom}) — Achat requis chez ${p.fournisseur || 'fournisseur'}`);
    }
    if (!p.outils || p.outils === 'À définir') {
      alerts.push(`🟠 Blocage Outils : ${p.id} (${p.nom}) — Outillage non défini`);
    }
    const pendingOps = (p.operations || []).filter(o => o.statut !== 'Terminée');
    if (pendingOps.length > 0) {
      pendingOps.forEach(op => {
        const m = machineById.get(op.machineId);
        const key = m ? m.nom : (op.machine || 'Non affectée');
        machineLoads[key] = (machineLoads[key] || 0) + (op.tempsPrevuMin || 60);
      });
    } else {
      machineLoads[p.machine] = (machineLoads[p.machine] || 0) + (p.tempsPrevuMin || 120);
    }
  });

  // Sort: ready pieces first, then urgency, then deadline
  pieces.sort((a, b) => {
    const aBlocked = (!a.chuteDispo && !a.achatFait) ? 1 : 0;
    const bBlocked = (!b.chuteDispo && !b.achatFait) ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    return (order[a.urgence] || 9) - (order[b.urgence] || 9) || (a.delai || '').localeCompare(b.delai || '');
  });

  transaction(() => {
    pieces.forEach((p, i) => {
      runSql('UPDATE pieces SET ordrePlanning = ?, planningValide = 0 WHERE id = ?', [i + 1, p.id]);
    });
  });

  logAudit(req.user, 'PLANNING OPTIMISÉ IA', `${pieces.length} OF réordonnés (${alerts.length} alertes)`);
  res.json({ ok: true, alerts, machineLoads });
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
      const targetOp = ops.find(o => o.statut !== 'Terminée') || ops[0];
      if (targetOp) {
        const nextOpTime = ops.length === 1 && diffMin > 0 ? diffMin : targetOp.tempsPrevuMin;
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
  const newLoadMin = (Number(quantite) || 1) * (Number(tempsParPieceMin) || 15);
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
    newLoadMin,
    totalHours,
    verdict,
    impactedCount: activeOps.length
  });
});

module.exports = router;
