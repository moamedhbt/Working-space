const express = require('express');
const {
  queryOne,
  queryAll,
  runSql,
  transaction,
  hashPassword,
  logAudit,
  backupDB,
  syncPieceFromOperations
} = require('../db/database');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();
const ALLOWED_ROLES = ['directeur', 'chef', 'be', 'operateur', 'tv'];

router.post('/users', auth, requireRole('directeur'), (req, res) => {
  const { nom, username, password, role } = req.body || {};
  if (!nom?.trim() || !username?.trim() || !password) {
    return res.status(400).json({ error: 'Nom, identifiant et mot de passe requis' });
  }
  const cleanRole = ALLOWED_ROLES.includes(role) ? role : 'operateur';
  try {
    const id = 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    runSql(
      'INSERT INTO users (id, nom, username, passwordHash, role, actif) VALUES (?,?,?,?,?,1)',
      [id, nom.trim(), username.trim(), hashPassword(password), cleanRole]
    );
    logAudit(req.user, 'UTILISATEUR CRÉÉ', `${nom.trim()} (${cleanRole})`);
    res.status(201).json({ ok: true, id });
  } catch {
    res.status(400).json({ error: 'Identifiant déjà utilisé' });
  }
});

router.put('/users/:id', auth, requireRole('directeur'), (req, res) => {
  const { id } = req.params;
  const u = queryOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const { nom, role, password, actif } = req.body || {};
  const newNom = nom !== undefined && String(nom).trim() ? String(nom).trim() : u.nom;
  const newRole = role !== undefined ? String(role).trim() : u.role;
  const newActif = actif !== undefined ? (actif ? 1 : 0) : u.actif;

  if (!ALLOWED_ROLES.includes(newRole)) {
    return res.status(400).json({ error: `Rôle invalide (${ALLOWED_ROLES.join(', ')})` });
  }

  // Prevent locking out the last active director
  if (u.role === 'directeur' && (newRole !== 'directeur' || !newActif)) {
    const otherDirectors = queryOne(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'directeur' AND actif = 1 AND id != ?",
      [id]
    ).c;
    if (otherDirectors === 0) {
      return res.status(400).json({ error: 'Impossible de retirer ou désactiver le dernier Directeur actif' });
    }
  }

  const newPassHash = password && String(password).trim() ? hashPassword(String(password)) : u.passwordHash;

  runSql(
    'UPDATE users SET nom = ?, role = ?, passwordHash = ?, actif = ? WHERE id = ?',
    [newNom, newRole, newPassHash, newActif, id]
  );

  const changes = [];
  if (newNom !== u.nom) changes.push(`Nom: ${u.nom} → ${newNom}`);
  if (newRole !== u.role) changes.push(`Rôle: ${newRole}`);
  if (password && String(password).trim()) changes.push('MDP réinitialisé');
  if (newActif !== u.actif) changes.push(newActif ? 'Activé' : 'Désactivé');

  logAudit(req.user, 'UTILISATEUR MODIFIÉ', `${newNom}${changes.length ? ' · ' + changes.join(' · ') : ''}`);
  res.json({ ok: true });
});

router.post('/machines', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { nom, type, tauxHoraire, capaciteJourMin } = req.body || {};
  if (!nom?.trim()) return res.status(400).json({ error: 'Nom de machine requis' });
  const id = 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const taux = Number(tauxHoraire) > 0 ? Number(tauxHoraire) : 2500;
  const cap = Number(capaciteJourMin) > 0 ? Math.round(Number(capaciteJourMin)) : 480;
  runSql(
    'INSERT INTO machines (id, nom, type, tauxHoraire, capaciteJourMin, actif, enPanne) VALUES (?,?,?,?,?,1,0)',
    [id, nom.trim(), (type || 'Usinage').trim(), taux, cap]
  );
  logAudit(req.user, 'MACHINE AJOUTÉE', `${nom.trim()} (${taux} DZD/h)`);
  res.status(201).json({ ok: true, id });
});

router.put('/machines/:id', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { id } = req.params;
  const m = queryOne('SELECT * FROM machines WHERE id = ?', [id]);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });

  const { nom, type, actif, tauxHoraire, capaciteJourMin, enPanne } = req.body || {};
  const newNom = nom !== undefined && String(nom).trim() ? String(nom).trim() : m.nom;
  const newType = type !== undefined && String(type).trim() ? String(type).trim() : m.type;
  const newActif = actif !== undefined ? (actif ? 1 : 0) : m.actif;
  const newTaux = tauxHoraire !== undefined && Number(tauxHoraire) > 0 ? Number(tauxHoraire) : m.tauxHoraire;
  const newCap = capaciteJourMin !== undefined && Number(capaciteJourMin) > 0 ? Math.round(Number(capaciteJourMin)) : m.capaciteJourMin;
  const newPanne = enPanne !== undefined ? (enPanne ? 1 : 0) : m.enPanne;

  transaction(() => {
    runSql(
      'UPDATE machines SET nom = ?, type = ?, tauxHoraire = ?, capaciteJourMin = ?, actif = ?, enPanne = ? WHERE id = ?',
      [newNom, newType, newTaux, newCap, newActif, newPanne, id]
    );
    if (!newActif) {
      runSql(
        `UPDATE pieces SET planningValide = 0
         WHERE machineId = ? OR id IN (SELECT pieceId FROM operations WHERE machineId = ?)`,
        [id, id]
      );
    }
  });

  logAudit(req.user, 'MACHINE MODIFIÉE', `${newNom} (${newActif ? 'Active' : 'Désactivée'})`);
  res.json({ ok: true });
});

router.delete('/machines/:id', auth, requireRole('directeur'), (req, res) => {
  const { id } = req.params;
  const m = queryOne('SELECT * FROM machines WHERE id = ?', [id]);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });

  const linked = queryOne(
    `SELECT p.id FROM pieces p
     WHERE p.statut != 'Clôturé'
       AND (p.machineId = ? OR p.id IN (SELECT pieceId FROM operations WHERE machineId = ?))
     LIMIT 1`,
    [id, id]
  );
  if (linked) {
    return res.status(400).json({ error: `Impossible : des OF actifs (${linked.id}) utilisent ${m.nom}` });
  }

  runSql('DELETE FROM machines WHERE id = ?', [id]);
  logAudit(req.user, 'MACHINE SUPPRIMÉE', m.nom);
  res.json({ ok: true });
});

router.post('/pannes/:id/resolve', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { id } = req.params;
  const panne = queryOne('SELECT * FROM pannes WHERE id = ?', [id]);
  if (!panne) return res.status(404).json({ error: 'Panne introuvable' });

  transaction(() => {
    runSql("UPDATE pannes SET statut = 'Résolue', resolvedAt = ? WHERE id = ?", [new Date().toLocaleString('fr-FR'), id]);

    if (panne.machineId) {
      const remaining = queryOne(
        "SELECT COUNT(*) AS c FROM pannes WHERE machineId = ? AND statut = 'Ouverte'",
        [panne.machineId]
      ).c;
      if (remaining === 0) {
        runSql('UPDATE machines SET enPanne = 0 WHERE id = ?', [panne.machineId]);
      }
    }

    if (panne.operationId) {
      const op = queryOne('SELECT * FROM operations WHERE id = ?', [panne.operationId]);
      if (op && op.statut === 'Panne machine') {
        runSql("UPDATE operations SET statut = 'En pause' WHERE id = ?", [op.id]);
        syncPieceFromOperations(op.pieceId);
      }
    } else if (panne.pieceId) {
      const ops = queryAll("SELECT id FROM operations WHERE pieceId = ? AND statut = 'Panne machine'", [panne.pieceId]);
      for (const op of ops) {
        runSql("UPDATE operations SET statut = 'En pause' WHERE id = ?", [op.id]);
      }
      syncPieceFromOperations(panne.pieceId);
    }
  });

  logAudit(req.user, 'PANNE RÉSOLUE', `Ticket ${id} résolu${panne.pieceId ? ` (${panne.pieceId})` : ''}`);
  res.json({ ok: true });
});

router.post('/admin/backup', auth, requireRole('directeur'), async (req, res) => {
  try {
    const file = await backupDB('manual');
    logAudit(req.user, 'SAUVEGARDE DB', file);
    res.json({ ok: true, file });
  } catch (err) {
    res.status(500).json({ error: 'Erreur sauvegarde : ' + err.message });
  }
});

module.exports = router;
