const express = require('express');
const { queryOne, runSql, hashPassword, logAudit } = require('../db/database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/users', auth, requireRole('directeur'), (req, res) => {
  const { nom, username, password, role } = req.body || {};
  if (!nom || !username || !password) return res.status(400).json({ error: 'Champs manquants' });
  try {
    runSql('INSERT INTO users VALUES (?,?,?,?,?)', ['u' + Date.now(), nom, username, hashPassword(password), role || 'operateur']);
    logAudit(req.user, 'UTILISATEUR CRÉÉ', `${nom} (${role || 'operateur'})`);
    res.status(201).json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Identifiant déjà utilisé' });
  }
});

router.put('/users/:id', auth, requireRole('directeur'), (req, res) => {
  const { id } = req.params;
  const u = queryOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const { nom, role, password } = req.body || {};
  const newNom = nom !== undefined ? nom : u.nom;
  const newRole = role !== undefined ? role : u.role;
  const newPass = password ? hashPassword(password) : u.password;
  runSql('UPDATE users SET nom = ?, role = ?, password = ? WHERE id = ?', [newNom, newRole, newPass, id]);
  logAudit(req.user, 'UTILISATEUR MODIFIÉ', `${newNom} (${newRole})${password ? ' · MDP réinitialisé' : ''}`);
  res.json({ ok: true });
});

router.post('/machines', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { nom, type } = req.body || {};
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  runSql('INSERT INTO machines VALUES (?,?,?,1)', ['m' + Date.now(), nom, type || 'Usinage']);
  logAudit(req.user, 'MACHINE AJOUTÉE', nom);
  res.status(201).json({ ok: true });
});

router.put('/machines/:id', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { id } = req.params;
  const m = queryOne('SELECT * FROM machines WHERE id = ?', [id]);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });
  const { nom, type, actif } = req.body || {};
  const newNom = nom !== undefined ? nom : m.nom;
  const newType = type !== undefined ? type : m.type;
  const newActif = actif !== undefined ? (actif ? 1 : 0) : m.actif;
  runSql('UPDATE machines SET nom = ?, type = ?, actif = ? WHERE id = ?', [newNom, newType, newActif, id]);
  if (!newActif) {
    runSql('UPDATE pieces SET planningValide = 0 WHERE machine = ?', [newNom]);
  }
  logAudit(req.user, 'MACHINE MODIFIÉE', `${newNom} (${newActif ? 'Active' : 'Désactivée'})`);
  res.json({ ok: true });
});

router.delete('/machines/:id', auth, requireRole('directeur'), (req, res) => {
  const { id } = req.params;
  const m = queryOne('SELECT * FROM machines WHERE id = ?', [id]);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });
  const linked = queryOne("SELECT id FROM pieces WHERE machine = ? AND statut != 'Clôturé'", [m.nom]);
  if (linked) return res.status(400).json({ error: `Impossible : des OF (${linked.id}) sont affectés à ${m.nom}` });
  runSql('DELETE FROM machines WHERE id = ?', [id]);
  logAudit(req.user, 'MACHINE SUPPRIMÉE', m.nom);
  res.json({ ok: true });
});

module.exports = router;
