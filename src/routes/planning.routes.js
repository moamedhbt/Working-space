const express = require('express');
const { queryAll, runSql, saveDB } = require('../db/database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/tv', (req, res) => {
  const pieces = queryAll("SELECT * FROM pieces WHERE planningValide = 1 AND statut != 'Clôturé' ORDER BY ordrePlanning ASC");
  const machines = queryAll('SELECT * FROM machines WHERE actif = 1');
  res.json({ pieces, machines });
});

router.post('/planning/optimize', auth, requireRole('directeur', 'chef'), (req, res) => {
  const order = { 'Critique': 1, 'Urgent': 2, 'Normal': 3 };
  const pieces = queryAll("SELECT * FROM pieces WHERE statut != 'Clôturé'");
  const machines = queryAll('SELECT * FROM machines WHERE actif = 1');

  const alerts = [];
  const machineLoads = {};
  machines.forEach(m => { machineLoads[m.nom] = 0; });

  pieces.forEach(p => {
    if (!p.chuteDispo && !p.achatFait) {
      alerts.push(`🔴 Blocage Matière : ${p.id} (${p.nom}) — Achat requis chez ${p.fournisseur || 'fournisseur'}`);
    }
    if (!p.outils || p.outils === 'À définir') {
      alerts.push(`🟠 Blocage Outils : ${p.id} (${p.nom}) — Outillage non défini`);
    }
    machineLoads[p.machine] = (machineLoads[p.machine] || 0) + (p.tempsPrevuMin || 120);
  });

  // Sort: ready pieces first, then urgency, then deadline
  pieces.sort((a, b) => {
    const aBlocked = (!a.chuteDispo && !a.achatFait) ? 1 : 0;
    const bBlocked = (!b.chuteDispo && !b.achatFait) ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    return (order[a.urgence] || 9) - (order[b.urgence] || 9) || a.delai.localeCompare(b.delai);
  });

  pieces.forEach((p, i) => runSql('UPDATE pieces SET ordrePlanning = ? WHERE id = ?', [i + 1, p.id]));
  saveDB();

  res.json({ ok: true, alerts, machineLoads });
});

router.post('/planning/validate', auth, requireRole('directeur', 'chef'), (req, res) => {
  runSql('UPDATE pieces SET planningValide = 1');
  res.json({ ok: true });
});

router.post('/planning/simulate', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { nom, quantite = 10, delai, machine, matiereDispo = true, delaiFournisseurJours = 0, tempsParPieceMin = 0 } = req.body || {};
  const missing = [];
  if (!tempsParPieceMin || Number(tempsParPieceMin) <= 0) missing.push('Temps estimé par pièce (minutes)');
  if (!matiereDispo && (!delaiFournisseurJours || Number(delaiFournisseurJours) <= 0)) missing.push('Délai fournisseur matière en Algérie (jours)');

  const active = queryAll("SELECT id, nom, tempsPrevuMin, delai FROM pieces WHERE machine = ? AND statut != 'Clôturé'", [machine]);
  const currentLoadMin = active.reduce((s, p) => s + (p.tempsPrevuMin || 120), 0);
  const newLoadMin = (Number(quantite) || 1) * (Number(tempsParPieceMin) || 15);
  const totalHours = ((currentLoadMin + newLoadMin) / 60).toFixed(1);

  let verdict = '✅ Faisable sans retard';
  if (!matiereDispo && Number(delaiFournisseurJours) > 2) verdict = `⚠️ Attention : ${delaiFournisseurJours}j d'attente matière fournisseur`;
  if (currentLoadMin + newLoadMin > 480) verdict = `🔴 Surcharge sur ${machine} (${totalHours}h) — Conseillé : +15% urgence ou autre machine`;

  res.json({
    ok: true,
    missing,
    currentLoadHours: (currentLoadMin / 60).toFixed(1),
    newLoadHours: (newLoadMin / 60).toFixed(1),
    totalHours,
    verdict,
    impactedCount: active.length
  });
});

module.exports = router;
