const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryOne } = require('../db/database');
const {inUser}=require('../services/aiUsage');

const SECRET_FILE = path.join(__dirname, '../../.app-secret');

function loadOrCreateSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const SECRET = loadOrCreateSecret();

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const keyBuf = Buffer.from(key, 'hex');
  const hashBuf = Buffer.from(hash, 'hex');
  if (keyBuf.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, hashBuf);
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const session = verifyToken(token);
  if (!session || !session.id || session.exp < Date.now()) {
    return res.status(401).json({ error: 'Session expirée ou non autorisée' });
  }
  // Always hydrate live user from DB so renames/role changes/deactivations take effect immediately
  const liveUser = queryOne('SELECT id, nom, username, role, actif FROM users WHERE id = ?', [session.id]);
  if (!liveUser || !liveUser.actif) {
    return res.status(401).json({ error: 'Compte introuvable ou désactivé' });
  }
  req.user = {
    id: liveUser.id,
    nom: liveUser.nom,
    username: liveUser.username,
    role: liveUser.role
  };
  inUser(req.user, next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

module.exports = { verifyPassword, signToken, verifyToken, auth, requireRole };
