const express = require('express');
const { queryOne } = require('../db/database');
const { verifyPassword, signToken, auth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = queryOne('SELECT * FROM users WHERE username = ?', [(username || '').trim()]);
  if (!user || !user.actif || !verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  const token = signToken({
    id: user.id,
    nom: user.nom,
    username: user.username,
    role: user.role,
    exp: Date.now() + 7 * 86400000
  });
  res.json({
    token,
    user: { id: user.id, nom: user.nom, username: user.username, role: user.role }
  });
});

router.get('/me', auth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
