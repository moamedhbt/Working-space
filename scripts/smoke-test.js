const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawn } = require('child_process');

const tmpDb = path.join(os.tmpdir(), `atelier_smoke_${Date.now()}.db`);
const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;

async function req(url, method = 'GET', body = null, token = '') {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/tv`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Server did not start in time');
}

async function run() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_FILE: tmpDb },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });

  try {
    await waitForServer();

    // 1. Login Directeur + /api/me + malformed token
    const loginDir = await req('/api/login', 'POST', { username: 'directeur', password: '1234' });
    assert.strictEqual(loginDir.status, 200);
    const dirToken = loginDir.data.token;
    assert.strictEqual((await req('/api/me', 'GET', null, dirToken)).status, 200);
    assert.strictEqual((await req('/api/me', 'GET', null, 'abc.short')).status, 401);

    // 2. Rename operator + reset password
    const editOp = await req('/api/users/u4', 'PUT', { nom: 'Karim Benali', password: 'newpass123' }, dirToken);
    assert.strictEqual(editOp.status, 200);
    const loginKarim = await req('/api/login', 'POST', { username: 'karim', password: 'newpass123' });
    assert.strictEqual(loginKarim.status, 200);
    assert.strictEqual(loginKarim.data.user.nom, 'Karim Benali');
    const karimToken = loginKarim.data.token;

    const stateAfterRename = await req('/api/state', 'GET', null, karimToken);
    const of101 = stateAfterRename.data.pieces.find(p => p.id === 'OF-2026-0101');
    assert.strictEqual(of101.operateur, 'Karim Benali');
    assert.strictEqual(of101.operations[0].operateur, 'Karim Benali');

    // 3. Rename machine
    assert.strictEqual((await req('/api/machines/m1', 'PUT', { nom: 'Tour CNC Mazak' }, dirToken)).status, 200);
    const stateAfterMach = await req('/api/state', 'GET', null, dirToken);
    assert.strictEqual(stateAfterMach.data.pieces.find(p => p.id === 'OF-2026-0101').machine, 'Tour CNC Mazak');

    // 4. Sequential OF creation with Setup + Unit time
    const c1 = await req('/api/pieces', 'POST', {
      nom: 'Pignon test', client: 'Client A', quantitePrevue: 10,
      machineId: 'm1', operateurId: 'u4', tempsReglageMin: 30, tempsUnitaireMin: 5, chuteDispo: true
    }, dirToken);
    const c2 = await req('/api/pieces', 'POST', {
      nom: 'Axe test', client: 'Client B', quantitePrevue: 5,
      machineId: 'm2', operateurId: 'u4', tempsReglageMin: 20, tempsUnitaireMin: 8, chuteDispo: true
    }, dirToken);
    assert.strictEqual(c1.status, 201);
    assert.strictEqual(c2.status, 201);
    const n1 = parseInt(c1.data.id.split('-').pop(), 10);
    const n2 = parseInt(c2.data.id.split('-').pop(), 10);
    assert.strictEqual(n2, n1 + 1);

    // Verify setup + qty*unit = 30 + 10*5 = 80 min, and auto-recalc on qty change to 20 -> 130 min
    let st = await req('/api/state', 'GET', null, dirToken);
    assert.strictEqual(st.data.pieces.find(p => p.id === c1.data.id).tempsPrevuMin, 80);
    await req(`/api/pieces/${c1.data.id}/chef`, 'POST', { quantitePrevue: 20 }, dirToken);
    st = await req('/api/state', 'GET', null, dirToken);
    assert.strictEqual(st.data.pieces.find(p => p.id === c1.data.id).tempsPrevuMin, 130);
    await req(`/api/pieces/${c1.data.id}/chef`, 'POST', { quantitePrevue: 10 }, dirToken);

    // 5. Real BE Files + Revisions + Operator CNC text preview
    const planA = await req(`/api/pieces/${c1.data.id}/be-files`, 'POST', {
      categorie: 'plan', filename: 'plan_pignon.pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64'), notes: 'Emission initiale'
    }, dirToken);
    assert.strictEqual(planA.status, 201);
    assert.strictEqual(planA.data.revision, 'Rev A');

    const planB = await req(`/api/pieces/${c1.data.id}/be-files`, 'POST', {
      categorie: 'plan', filename: 'plan_pignon_v2.pdf', base64: Buffer.from('%PDF-1.4 test v2').toString('base64'), notes: 'Tolerance H7'
    }, dirToken);
    assert.strictEqual(planB.status, 201);
    assert.strictEqual(planB.data.revision, 'Rev B');

    const cncFile = await req(`/api/pieces/${c1.data.id}/be-files`, 'POST', {
      categorie: 'cnc', filename: 'O1040.nc', base64: Buffer.from('G21 G90\nG00 X0 Z5\nM30\n').toString('base64'), notes: 'Fanuc 0i'
    }, dirToken);
    assert.strictEqual(cncFile.status, 201);

    const cncRead = await req(`/api/be-files/${cncFile.data.id}/text`, 'GET', null, karimToken);
    assert.strictEqual(cncRead.status, 200);
    assert.ok(cncRead.data.content.includes('G21 G90'), 'Operator must be able to read CNC code');

    st = await req('/api/state', 'GET', null, karimToken);
    const pWithBe = st.data.pieces.find(p => p.id === c1.data.id);
    assert.strictEqual(pWithBe.be.planFile.revision, 'Rev B');
    assert.strictEqual(pWithBe.beFiles.filter(f => f.categorie === 'plan' && f.isActive).length, 1);

    // 6. Add Subcontracting operation + Quality Control op
    const subOp = await req(`/api/pieces/${c1.data.id}/operations`, 'POST', {
      libelle: 'Traitement thermique', estSousTraitance: true, sousTraitant: 'ThermiDZ', dateEnvoi: '2026-11-23', dateRetourPrevue: '2026-11-25'
    }, dirToken);
    assert.strictEqual(subOp.status, 201);

    const ctrlOp = await req(`/api/pieces/${c1.data.id}/operations`, 'POST', {
      libelle: 'Contrôle dimensionnel', machineId: 'm4', operateurId: 'u4', tempsReglageMin: 5, tempsUnitaireMin: 2
    }, dirToken);
    assert.strictEqual(ctrlOp.status, 201);

    // 7. Calendar settings + IA Optimize + Operator Conflict detection & IA Apply
    assert.strictEqual((await req('/api/settings', 'PUT', { workDays: [0, 1, 2, 3, 4], shiftStart: '08:00', shiftEnd: '17:00' }, dirToken)).status, 200);
    const optRes = await req('/api/planning/optimize', 'POST', {}, dirToken);
    assert.strictEqual(optRes.status, 200);
    assert.ok(Array.isArray(optRes.data.recommendations));

    // Apply IA recommendation if any
    if (optRes.data.recommendations.length > 0) {
      const rec = optRes.data.recommendations[0];
      assert.strictEqual((await req('/api/planning/ai-apply', 'POST', { actionType: rec.actionType, payload: rec.payload }, dirToken)).status, 200);
    }

    await req('/api/planning/validate', 'POST', null, dirToken);

    // 8. Start -> Partial Progress -> Pause -> Panne -> Resolve -> Finish with Scrap
    st = await req('/api/state', 'GET', null, dirToken);
    const newPiece = st.data.pieces.find(p => p.id === c1.data.id);
    const op1 = newPiece.operations[0];
    const opSub = newPiece.operations[1];
    const opCtrl = newPiece.operations[2];

    // Ensure u4 owns op1 & opCtrl (in case IA reassigned u4)
    await req(`/api/operations/${op1.id}`, 'PUT', { operateurId: 'u4' }, dirToken);
    await req(`/api/operations/${opCtrl.id}`, 'PUT', { operateurId: 'u4' }, dirToken);
    await req('/api/planning/validate', 'POST', null, dirToken);

    assert.strictEqual((await req(`/api/operations/${op1.id}/start`, 'POST', {}, karimToken)).status, 200);
    assert.strictEqual((await req(`/api/operations/${op1.id}/progress`, 'POST', { quantiteBonne: 4, quantiteRebut: 0 }, karimToken)).status, 200);
    const pauseRes = await req(`/api/operations/${op1.id}/pause`, 'POST', {}, karimToken);
    assert.strictEqual(pauseRes.status, 200);
    assert.ok(pauseRes.data.tempsReelMin >= 1);

    assert.strictEqual((await req(`/api/operations/${op1.id}/start`, 'POST', {}, karimToken)).status, 200);
    const panneRes = await req(`/api/operations/${op1.id}/panne`, 'POST', { motif: 'Alarme broche' }, karimToken);
    assert.strictEqual(panneRes.status, 200);
    const resPanne = await req(`/api/pannes/${panneRes.data.panneId}/resolve`, 'POST', {}, dirToken);
    assert.strictEqual(resPanne.status, 200);
    assert.ok(resPanne.data.dureeArretMin >= 1);

    assert.strictEqual((await req(`/api/operations/${op1.id}/start`, 'POST', {}, karimToken)).status, 200);
    const fin1 = await req(`/api/operations/${op1.id}/finish`, 'POST', { quantiteBonne: 9, quantiteRebut: 1, motifRebut: 'Rayure surface' }, karimToken);
    assert.strictEqual(fin1.status, 200);
    assert.ok(fin1.data.tempsReelMin >= 2);

    // Finish subcontracting & control ops
    assert.strictEqual((await req(`/api/operations/${opSub.id}/finish`, 'POST', { quantiteBonne: 9, quantiteRebut: 0 }, dirToken)).status, 200);
    assert.strictEqual((await req(`/api/operations/${opCtrl.id}/start`, 'POST', {}, karimToken)).status, 200);
    assert.strictEqual((await req(`/api/operations/${opCtrl.id}/finish`, 'POST', { quantiteBonne: 9, quantiteRebut: 0 }, karimToken)).status, 200);

    // 9. Close with prixFinal + Archive
    assert.strictEqual((await req(`/api/pieces/${c1.data.id}/close`, 'POST', { prixFinal: 42500 }, dirToken)).status, 200);
    assert.strictEqual((await req(`/api/pieces/${c1.data.id}/archive`, 'POST', { archived: true }, dirToken)).status, 200);
    st = await req('/api/state', 'GET', null, dirToken);
    const closedPiece = st.data.pieces.find(p => p.id === c1.data.id);
    assert.strictEqual(closedPiece.statut, 'Clôturé');
    assert.strictEqual(closedPiece.prixFinal, 42500);
    assert.strictEqual(closedPiece.archived, true);

    // 10. TRS Analytics & Preventive Maintenance validation
    assert.ok(typeof st.data.analytics.trsPct === 'number');
    const m3Before = st.data.analytics.machineStats.find(m => m.id === 'm3');
    assert.strictEqual(m3Before.maintenanceStatut, 'du', 'Seed m3 should initially be due for preventive maintenance');
    assert.strictEqual((await req('/api/machines/m3/maintenance', 'POST', { description: 'Vidange + contrôle broche' }, dirToken)).status, 200);
    st = await req('/api/state', 'GET', null, dirToken);
    const m3After = st.data.analytics.machineStats.find(m => m.id === 'm3');
    assert.strictEqual(m3After.maintenanceStatut, 'ok', 'After validation m3 maintenance must be ok');
    assert.ok(st.data.maintenanceLogs.length >= 1);

    // 11. Upload security + Hot backup
    assert.strictEqual((await req('/api/upload', 'POST', { pieceId: c1.data.id, filename: 'evil.html', base64: 'PGgxPmhpPC9oMT4=' }, dirToken)).status, 400);
    assert.strictEqual((await req('/api/admin/backup', 'POST', {}, dirToken)).status, 200);

    // 12. Fix 3: Chef creates OF -> À valider -> Direction validates -> BE + Chef validate -> Prêt atelier
    const loginChef = await req('/api/login', 'POST', { username: 'chef', password: '1234' });
    const chefToken = loginChef.data.token;
    const loginBe = await req('/api/login', 'POST', { username: 'be', password: '1234' });
    const beToken = loginBe.data.token;

    const chefOf = await req('/api/pieces', 'POST', {
      nom: 'Arbre spécial Ø55', client: 'MécaOran', quantitePrevue: 8,
      typeMachine: 'Tournage CNC', chuteDispo: true, matiereDispo: true,
      clientFile: { filename: 'plan_client_D55_L140.pdf', base64: Buffer.from('%PDF-1.4 (D55 L140 42CrMo4)').toString('base64') }
    }, chefToken);
    assert.strictEqual(chefOf.status, 201);
    assert.strictEqual(chefOf.data.validationDirection, false);

    st = await req('/api/state', 'GET', null, dirToken);
    assert.strictEqual(st.data.pieces.find(p => p.id === chefOf.data.id).statut, 'À valider');

    assert.strictEqual((await req(`/api/pieces/${chefOf.data.id}/validate-direction`, 'POST', { action: 'approve' }, dirToken)).status, 200);
    assert.strictEqual((await req(`/api/pieces/${chefOf.data.id}/be-validate`, 'POST', { nonRequis: false }, beToken)).status, 200);
    assert.strictEqual((await req(`/api/pieces/${chefOf.data.id}/chef-validate`, 'POST', {}, chefToken)).status, 200);

    st = await req('/api/state', 'GET', null, dirToken);
    const readyOf = st.data.pieces.find(p => p.id === chefOf.data.id);
    assert.strictEqual(readyOf.statut, 'Prêt atelier');
    assert.strictEqual(readyOf.planningValide, true);
    assert.ok(readyOf.events.length >= 4, 'Full OF timeline must track every step');

    // 13. Fix 3: Reprise d'OF déjà en cours (travail en parallèle)
    const repriseOf = await req('/api/pieces', 'POST', {
      nom: 'Bride en cours atelier', client: 'Client Parallèle', quantitePrevue: 12,
      estRepriseEnCours: true, statutInitial: 'En cours', quantiteDejaRealisee: 5, tempsDejaPasseMin: 40,
      machineId: 'm2', operateurId: 'u4'
    }, dirToken);
    assert.strictEqual(repriseOf.status, 201);
    st = await req('/api/state', 'GET', null, dirToken);
    const repPiece = st.data.pieces.find(p => p.id === repriseOf.data.id);
    assert.strictEqual(repPiece.statut, 'En cours');
    assert.strictEqual(repPiece.quantiteRealisee, 5);
    assert.strictEqual(repPiece.planningValide, true);

    // 14. Fix 3: AI historical estimation + Qualified operator stop (plan_be) + BE resolve + AI 2D plan analyzer
    const aiEst = await req('/api/planning/estimate-of', 'POST', {
      nom: 'Arbre transmission Ø45', typeMachine: 'Tournage CNC', quantitePrevue: 10
    }, dirToken);
    assert.strictEqual(aiEst.status, 200);
    assert.ok(aiEst.data.totalMin > 0 && aiEst.data.recommendedMachineId);

    const repOp = repPiece.operations[0];
    const stopRes = await req(`/api/operations/${repOp.id}/stop`, 'POST', {
      categorie: 'plan_be', motif: 'Cote Ø45 manquante sur plan'
    }, karimToken);
    assert.strictEqual(stopRes.status, 200);
    assert.strictEqual(stopRes.data.cibleRole, 'be');
    assert.strictEqual((await req(`/api/stops/${stopRes.data.stopId}/resolve`, 'POST', {}, beToken)).status, 200);

    const planAna = await req('/api/be/analyze-plan', 'POST', {
      filename: 'Bride_D120_6xD10_42CrMo4.pdf', notes: 'L=25'
    }, beToken);
    assert.strictEqual(planAna.status, 200);
    assert.strictEqual(planAna.data.extracted.partType, 'bride');
    assert.ok(planAna.data.ficheTechnique && Array.isArray(planAna.data.cadSpec.features));

    // 15. Fix 3+: Engineer 3D Prompt Refinement + Apply AI Technical Sheet to OF
    const refRes = await req('/api/be/refine-3d', 'POST', {
      cadSpec: planAna.data.cadSpec,
      prompt: 'Ajoute 6 trous Ø10 sur PCD 70 à 38° et ajoute méplat à 114.5 mm'
    }, beToken);
    assert.strictEqual(refRes.status, 200);
    assert.ok(refRes.data.cadSpec.features.length > planAna.data.cadSpec.features.length);

    const applyFiche = await req(`/api/pieces/${chefOf.data.id}/apply-fiche-ia`, 'POST', {
      ficheTechnique: planAna.data.ficheTechnique,
      replaceOperations: true
    }, beToken);
    assert.strictEqual(applyFiche.status, 200);

    // 16. Fix 3: Full History Export & Raw DB download
    const exp = await req('/api/admin/export-history', 'GET', null, dirToken);
    assert.strictEqual(exp.status, 200);
    assert.ok(Array.isArray(exp.data.pieces) && Array.isArray(exp.data.stops));
    const dbDl = await fetch(`${BASE}/api/admin/download-db`, { headers: { Authorization: `Bearer ${dirToken}` } });
    assert.strictEqual(dbDl.status, 200);
    const dbBuf = Buffer.from(await dbDl.arrayBuffer());
    assert.ok(dbBuf.subarray(0, 15).toString('utf8').startsWith('SQLite format 3'));

    // 17. Directeur-only AI Provider Configuration (save, mask, RBAC, clear)
    const aiBeDenied = await req('/api/admin/ai-settings', 'GET', null, beToken);
    assert.strictEqual(aiBeDenied.status, 403);
    const aiGet1 = await req('/api/admin/ai-settings', 'GET', null, dirToken);
    assert.strictEqual(aiGet1.status, 200);
    assert.ok(Array.isArray(aiGet1.data.availableProviders));

    const aiPut = await req('/api/admin/ai-settings', 'PUT', {
      provider: 'gemini',
      apiKey: 'AIzaSyTestSecretKey1234567890',
      model: 'gemini-2.5-flash'
    }, dirToken);
    assert.strictEqual(aiPut.status, 200);
    assert.strictEqual(aiPut.data.aiSettings.hasApiKey, true);
    assert.strictEqual(aiPut.data.aiSettings.resolvedProvider, 'gemini');
    assert.ok(!JSON.stringify(aiPut.data).includes('AIzaSyTestSecretKey1234567890'), 'Raw API key must never be returned');

    const aiClear = await req('/api/admin/ai-settings', 'PUT', { clearKey: true }, dirToken);
    assert.strictEqual(aiClear.status, 200);
    assert.strictEqual(aiClear.data.aiSettings.hasApiKey, false);

    console.log('✅ TOUS LES TESTS DE SMOKE ONT RÉUSSI (17/17) !');
  } finally {
    proc.kill('SIGTERM');
    for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
    if (stderr) console.error('Server stderr:', stderr);
  }
}

run().catch(err => {
  console.error('❌ ÉCHEC SMOKE TEST:', err);
  process.exit(1);
});
