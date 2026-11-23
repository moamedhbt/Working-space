const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  BACKUP_DIR,
  queryOne,
  queryAll,
  runSql,
  transaction,
  hashPassword,
  logAudit,
  logPieceEvent,
  backupDB,
  restoreDBFromBuffer,
  getSettings,
  saveSettings,
  getAiSettingsPublic,
  saveAiSettings,
  upsertAiProfile,
  setActiveAiProfile,
  toggleAiProfile,
  deleteAiProfile,
  syncPieceFromOperations,
  getEnrichedPieces,
  getEnrichedPannes,
  getEnrichedStops,
  getMaintenanceLogs
} = require('../db/database');
const { testAiConnection, listAvailableModels } = require('../services/planAnalyzer');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();
const ALLOWED_ROLES = ['directeur', 'chef', 'be', 'operateur', 'tv'];

router.get('/settings', auth, (req, res) => {
  res.json(getSettings());
});

router.put('/settings', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { workDays, shiftStart, shiftEnd } = req.body || {};
  if (workDays !== undefined && (!Array.isArray(workDays) || workDays.length === 0)) {
    return res.status(400).json({ error: 'Sélectionnez au moins un jour ouvré' });
  }
  saveSettings({ workDays, shiftStart, shiftEnd });
  logAudit(req.user, 'CALENDRIER ATELIER MODIFIÉ', `${shiftStart || '08:00'}–${shiftEnd || '17:00'}`);
  res.json({ ok: true, settings: getSettings() });
});

router.get('/admin/ai-settings', auth, requireRole('directeur'), (req, res) => {
  res.json(getAiSettingsPublic());
});

router.put('/admin/ai-settings', auth, requireRole('directeur'), (req, res) => {
  const { provider, apiKey, model, baseUrl, clearKey } = req.body || {};
  saveAiSettings({ provider, apiKey, model, baseUrl, clearKey: Boolean(clearKey) });
  const pub = getAiSettingsPublic();
  logAudit(
    req.user,
    'CONFIGURATION IA MODIFIÉE',
    `Provider: ${pub.provider} (${pub.resolvedProvider})${pub.model ? ' · Modèle: ' + pub.model : ''}${clearKey ? ' · Clé supprimée' : ''}`
  );
  res.json({ ok: true, aiSettings: pub });
});

router.post('/admin/ai-settings/test', auth, requireRole('directeur'), async (req, res) => {
  try {
    const { profileId, provider, apiKey, model, baseUrl } = req.body || {};
    const hasOverride = profileId || provider !== undefined || apiKey !== undefined || model !== undefined || baseUrl !== undefined;
    const result = await testAiConnection(hasOverride ? { profileId, provider, apiKey, model, baseUrl } : null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Échec du test IA' });
  }
});

router.post('/admin/ai-settings/models', auth, requireRole('directeur'), async (req, res) => {
  try {
    const { profileId, provider, apiKey, baseUrl } = req.body || {};
    const hasOverride = profileId || provider !== undefined || apiKey !== undefined || baseUrl !== undefined;
    const result = await listAvailableModels(hasOverride ? { profileId, provider, apiKey, baseUrl } : null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, models: [], error: err.message || 'Impossible de lister les modèles' });
  }
});

router.post('/admin/ai-profiles', auth, requireRole('directeur'), (req, res) => {
  const { id, label, provider, apiKey, model, baseUrl, enabled = true, setActive = true } = req.body || {};
  if (!id && !String(apiKey || '').trim() && provider !== 'custom') {
    return res.status(400).json({ error: 'Clé API requise pour enregistrer ce fournisseur.' });
  }
  const saved = upsertAiProfile({ id, label, provider, apiKey, model, baseUrl, enabled, setActive });
  logAudit(req.user, id ? 'PROFIL IA MODIFIÉ' : 'PROFIL IA AJOUTÉ', `${saved.label} (${saved.provider}${saved.model ? ' · ' + saved.model : ''})`);
  res.json({ ok: true, profileId: saved.id, aiSettings: getAiSettingsPublic() });
});

router.post('/admin/ai-profiles/:id/activate', auth, requireRole('directeur'), (req, res) => {
  const p = setActiveAiProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profil IA introuvable' });
  logAudit(req.user, 'PROFIL IA ACTIVÉ', `${p.label} (${p.provider})`);
  res.json({ ok: true, aiSettings: getAiSettingsPublic() });
});

router.post('/admin/ai-profiles/:id/toggle', auth, requireRole('directeur'), (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const p = toggleAiProfile(req.params.id, enabled);
  if (!p) return res.status(404).json({ error: 'Profil IA introuvable' });
  logAudit(req.user, enabled ? 'PROFIL IA ACTIVÉ' : 'PROFIL IA DÉSACTIVÉ', `${p.label} (${p.provider})`);
  res.json({ ok: true, aiSettings: getAiSettingsPublic() });
});

router.delete('/admin/ai-profiles/:id', auth, requireRole('directeur'), (req, res) => {
  deleteAiProfile(req.params.id);
  logAudit(req.user, 'PROFIL IA SUPPRIMÉ', req.params.id);
  res.json({ ok: true, aiSettings: getAiSettingsPublic() });
});

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
  const { nom, type, tauxHoraire, capaciteJourMin, intervalleEntretienH } = req.body || {};
  if (!nom?.trim()) return res.status(400).json({ error: 'Nom de machine requis' });
  const id = 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const taux = Number(tauxHoraire) > 0 ? Number(tauxHoraire) : 2500;
  const cap = Number(capaciteJourMin) > 0 ? Math.round(Number(capaciteJourMin)) : 480;
  const inter = Number(intervalleEntretienH) > 0 ? Number(intervalleEntretienH) : 200;
  runSql(
    'INSERT INTO machines (id, nom, type, tauxHoraire, capaciteJourMin, actif, enPanne, heuresCompteur, intervalleEntretienH, dernierEntretienH, dernierEntretienDate) VALUES (?,?,?,?,?,1,0,0,?,0,?)',
    [id, nom.trim(), (type || 'Usinage').trim(), taux, cap, inter, new Date().toISOString().slice(0, 10)]
  );
  logAudit(req.user, 'MACHINE AJOUTÉE', `${nom.trim()} (${taux} DZD/h)`);
  res.status(201).json({ ok: true, id });
});

router.put('/machines/:id', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { id } = req.params;
  const m = queryOne('SELECT * FROM machines WHERE id = ?', [id]);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });

  const { nom, type, actif, tauxHoraire, capaciteJourMin, enPanne, intervalleEntretienH, heuresCompteur } = req.body || {};
  const newNom = nom !== undefined && String(nom).trim() ? String(nom).trim() : m.nom;
  const newType = type !== undefined && String(type).trim() ? String(type).trim() : m.type;
  const newActif = actif !== undefined ? (actif ? 1 : 0) : m.actif;
  const newTaux = tauxHoraire !== undefined && Number(tauxHoraire) > 0 ? Number(tauxHoraire) : m.tauxHoraire;
  const newCap = capaciteJourMin !== undefined && Number(capaciteJourMin) > 0 ? Math.round(Number(capaciteJourMin)) : m.capaciteJourMin;
  const newPanne = enPanne !== undefined ? (enPanne ? 1 : 0) : m.enPanne;
  const newInter = intervalleEntretienH !== undefined && Number(intervalleEntretienH) > 0 ? Number(intervalleEntretienH) : (m.intervalleEntretienH || 200);
  const newHeures = heuresCompteur !== undefined && Number(heuresCompteur) >= 0 ? Number(heuresCompteur) : (m.heuresCompteur || 0);

  transaction(() => {
    runSql(
      'UPDATE machines SET nom = ?, type = ?, tauxHoraire = ?, capaciteJourMin = ?, actif = ?, enPanne = ?, intervalleEntretienH = ?, heuresCompteur = ? WHERE id = ?',
      [newNom, newType, newTaux, newCap, newActif, newPanne, newInter, newHeures, id]
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

router.post('/machines/:id/maintenance', auth, requireRole('directeur', 'chef'), (req, res) => {
  const { id } = req.params;
  const m = queryOne('SELECT * FROM machines WHERE id = ?', [id]);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });

  const { description, type = 'Préventive' } = req.body || {};
  const desc = (description || '').trim() || 'Entretien préventif (graissage, contrôle géométrie, niveaux)';
  const today = new Date().toISOString().slice(0, 10);
  const logId = 'mnt_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

  transaction(() => {
    runSql(
      'UPDATE machines SET dernierEntretienH = ?, dernierEntretienDate = ? WHERE id = ?',
      [m.heuresCompteur || 0, today, id]
    );
    runSql(
      'INSERT INTO maintenance_logs (id, machineId, type, description, heuresAuCompteur, effectuePar, createdAt) VALUES (?,?,?,?,?,?,?)',
      [logId, id, type, desc, m.heuresCompteur || 0, req.user.nom, new Date().toLocaleString('fr-FR')]
    );
  });

  logAudit(req.user, 'ENTRETIEN MACHINE', `${m.nom} (${Math.round(m.heuresCompteur || 0)}h) — ${desc}`);
  res.json({ ok: true, id: logId });
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

  const dureeArretMin = panne.createdAtMs > 0
    ? Math.max(1, Math.round((Date.now() - panne.createdAtMs) / 60000))
    : 30;

  transaction(() => {
    runSql(
      "UPDATE pannes SET statut = 'Résolue', dureeArretMin = ?, resolvedAt = ? WHERE id = ?",
      [dureeArretMin, new Date().toLocaleString('fr-FR'), id]
    );

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

  logAudit(req.user, 'PANNE RÉSOLUE', `Ticket ${id} résolu (${dureeArretMin} min d'arrêt)`);
  if (panne.pieceId) {
    logPieceEvent(panne.pieceId, req.user, 'panne_resolue', 'Panne machine résolue', `Durée d'arrêt : ${dureeArretMin} min`);
  }
  res.json({ ok: true, dureeArretMin });
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

router.get('/admin/download-db', auth, requireRole('directeur'), async (req, res) => {
  try {
    const filename = await backupDB('download');
    const fullPath = path.join(BACKUP_DIR, filename);
    logAudit(req.user, 'TÉLÉCHARGEMENT DB', filename);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Erreur téléchargement DB : ' + err.message });
  }
});

router.get('/admin/export-history', auth, requireRole('directeur', 'chef'), (req, res) => {
  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: req.user.nom,
    settings: getSettings(),
    users: queryAll('SELECT id, nom, username, role, actif FROM users ORDER BY role, nom'),
    machines: queryAll('SELECT * FROM machines ORDER BY nom'),
    pieces: getEnrichedPieces(),
    pannes: getEnrichedPannes(),
    stops: getEnrichedStops(),
    maintenanceLogs: getMaintenanceLogs(),
    auditLogs: queryAll('SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT 1000')
  };
  logAudit(req.user, 'EXPORT HISTORIQUE COMPLET', `${payload.pieces.length} OF(s) exporté(s)`);
  res.json(payload);
});

router.post('/admin/restore-db', auth, requireRole('directeur'), async (req, res) => {
  const { base64 } = req.body || {};
  if (!base64) return res.status(400).json({ error: 'Fichier .db manquant' });
  try {
    const clean = String(base64).includes(',') ? String(base64).split(',')[1] : String(base64);
    const buf = Buffer.from(clean, 'base64');
    if (buf.length > 25 * 1024 * 1024) {
      return res.status(400).json({ error: 'Sauvegarde trop volumineuse (max 25 Mo)' });
    }
    await restoreDBFromBuffer(buf);
    logAudit(req.user, 'RESTAURATION DB', `Base restaurée (${Math.round(buf.length / 1024)} Ko)`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
