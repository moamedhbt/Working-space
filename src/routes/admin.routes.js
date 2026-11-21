const express = require('express');
const { runSql, hashPassword } = require('../db/database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/users', auth, requireRole('directeur'), (req, res) => {
  const { nom, username, password, role } = req.body || {};
  if (!nom || !username || !password) return res.status(400).json({ error: 'Champs manquants' });
  try {
    runSql('INSERT INTO users VALUES (?,?,?,?,?)', ['u' + Date.now(), nom, username, hashPassword(password), role || 'operateur']);
    res.status(201).json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Identifiant déjà utilisé' });
  }
});

router.post('/machines', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { nom, type } = req.body || {};
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  runSql('INSERT INTO machines VALUES (?,?,?,1)', ['m' + Date.now(), nom, type || 'Usinage']);
  res.status(201).json({ ok: true });
});

module.exports = router;
