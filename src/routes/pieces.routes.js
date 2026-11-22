const express = require('express');
const fs = require('fs');
const path = require('path');
const { queryAll, queryOne, runSql, logAudit } = require('../db/database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

router.get('/state', auth, (req, res) => {
  const users = queryAll('SELECT id, nom, username, role FROM users');
  const machines = queryAll('SELECT * FROM machines');
  const rawPieces = queryAll('SELECT * FROM pieces ORDER BY ordrePlanning ASC');
  const auditLogs = queryAll('SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT 30');
  const pieces = rawPieces.map(p => ({
    ...p,
    chuteDispo: !!p.chuteDispo,
    achatFait: !!p.achatFait,
    planningValide: !!p.planningValide,
    be: { nomFichier: p.beNomFichier, programme: p.beProgramme, dessin3d: p.beDessin3d }
  }));
  res.json({ users, machines, pieces, auditLogs });
});

router.post('/pieces', auth, requireRole('directeur', 'chef'), (req, res) => {
  const b = req.body || {};
  const id = 'OF-2026-' + Math.floor(104 + Math.random() * 890);
  const firstMach = queryOne('SELECT nom FROM machines LIMIT 1');
  runSql(
    'INSERT INTO pieces (id, nom, client, quantitePrevue, delai, urgence, statut, machine, operateur, matiere, fournisseur, outils, ordrePlanning) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, b.nom || 'Nouvelle pièce', b.client || 'Client', parseInt(b.quantitePrevue || 10, 10), b.delai || '2026-11-28', b.urgence || 'Normal', 'À planifier', firstMach?.nom || 'À affecter', 'Karim B.', 'À définir', 'À définir', 'À définir', 1]
  );
  res.status(201).json({ ok: true, id });
});

router.post('/upload', auth, (req, res) => {
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

router.post('/pieces/:id/:action', auth, (req, res) => {
  const { id, action } = req.params;
  const p = queryOne('SELECT * FROM pieces WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Pièce introuvable' });
  const b = req.body || {};

  if (action === 'be') {
    if (!['directeur', 'be'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    runSql('UPDATE pieces SET beNomFichier = ?, beProgramme = ?, beDessin3d = ? WHERE id = ?', [b.nomFichier || '', b.programme || '', b.dessin3d || '', id]);
  } else if (action === 'chef') {
    if (!['directeur', 'chef'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    const chute = b.chuteDispo !== undefined ? (b.chuteDispo ? 1 : 0) : p.chuteDispo;
    let statut = p.statut;
    if (!chute && !p.achatFait) statut = 'À acheter';
    else if (p.statut === 'À planifier' || p.statut === 'À acheter') statut = 'Prêt atelier';
    runSql(
      'UPDATE pieces SET machine = ?, operateur = ?, matiere = ?, outils = ?, chuteDispo = ?, statut = ?, urgence = ?, delai = ?, ordrePlanning = ?, planningValide = 0 WHERE id = ?',
      [
        b.machine || p.machine,
        b.operateur || p.operateur,
        b.matiere !== undefined ? b.matiere : p.matiere,
        b.outils !== undefined ? b.outils : p.outils,
        chute,
        statut,
        b.urgence || p.urgence,
        b.delai || p.delai,
        b.ordrePlanning !== undefined ? parseInt(b.ordrePlanning, 10) : p.ordrePlanning,
        id
      ]
    );
    logAudit(req.user, 'PLANIFICATION MODIFIÉE', `${id} modifié (validation TV requise)`);
  } else if (action === 'op-start') {
    runSql("UPDATE pieces SET statut = 'En cours', photoDebut = ?, startedAt = ? WHERE id = ?", [b.photoUrl || 'ok', Date.now(), id]);
    logAudit(req.user, 'DÉMARRAGE', `${id} démarré`);
  } else if (action === 'op-finish') {
    const mins = p.startedAt ? Math.max(1, Math.round((Date.now() - p.startedAt) / 60000)) : p.tempsPrevuMin;
    runSql("UPDATE pieces SET quantiteRealisee = ?, photoFin = ?, tempsReelMin = ?, statut = 'À clôturer' WHERE id = ?", [parseInt(b.quantiteRealisee || p.quantitePrevue, 10), b.photoUrl || 'ok', mins, id]);
    logAudit(req.user, 'FINITION', `${id} terminé (${b.quantiteRealisee || p.quantitePrevue} pcs en ${mins} min)`);
  } else if (action === 'pause') {
    runSql("UPDATE pieces SET statut = 'En pause' WHERE id = ?", [id]);
    logAudit(req.user, 'PAUSE', `${id} mis en pause`);
  } else if (action === 'panne') {
    const motif = b.motif ? ` (${b.motif})` : '';
    runSql("UPDATE pieces SET statut = 'Panne machine' WHERE id = ?", [id]);
    logAudit(req.user, 'PANNE SIGNALÉE', `${id}${motif}`);
  } else if (action === 'buy') {
    if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
    runSql("UPDATE pieces SET achatFait = 1, statut = 'Prêt atelier' WHERE id = ?", [id]);
    logAudit(req.user, 'ACHAT VALIDÉ', `Matière validée pour ${id}`);
  } else if (action === 'close') {
    if (req.user.role !== 'directeur') return res.status(403).json({ error: 'Réservé au Directeur' });
    runSql("UPDATE pieces SET statut = 'Clôturé' WHERE id = ?", [id]);
    logAudit(req.user, 'CLÔTURE', `Dossier ${id} clôturé`);
  } else {
    return res.status(404).json({ error: 'Action inconnue' });
  }
  res.json({ ok: true });
});

module.exports = router;
