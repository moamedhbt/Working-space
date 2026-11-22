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

    // 1. Login Directeur + /api/me + malformed token check
    const loginDir = await req('/api/login', 'POST', { username: 'directeur', password: '1234' });
    assert.strictEqual(loginDir.status, 200, 'Directeur login failed');
    const dirToken = loginDir.data.token;

    const me = await req('/api/me', 'GET', null, dirToken);
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.data.user.role, 'directeur');

    const badTok = await req('/api/me', 'GET', null, 'abc.short');
    assert.strictEqual(badTok.status, 401, 'Malformed token must return 401 cleanly');

    // 2. Rename operator + reset password (PUT /api/users/:id)
    const editOp = await req('/api/users/u4', 'PUT', { nom: 'Karim Benali', password: 'newpass123' }, dirToken);
    assert.strictEqual(editOp.status, 200, `PUT /api/users failed: ${JSON.stringify(editOp.data)}`);

    const loginKarim = await req('/api/login', 'POST', { username: 'karim', password: 'newpass123' });
    assert.strictEqual(loginKarim.status, 200, 'Renamed operator login with new password failed');
    assert.strictEqual(loginKarim.data.user.nom, 'Karim Benali');
    const karimToken = loginKarim.data.token;

    // Verify all linked pieces/operations immediately show the new operator name!
    const stateAfterRename = await req('/api/state', 'GET', null, karimToken);
    const of101 = stateAfterRename.data.pieces.find(p => p.id === 'OF-2026-0101');
    assert.strictEqual(of101.operateurId, 'u4');
    assert.strictEqual(of101.operateur, 'Karim Benali');
    assert.strictEqual(of101.operations[0].operateur, 'Karim Benali');

    // 3. Rename machine & verify zero broken links
    const editMach = await req('/api/machines/m1', 'PUT', { nom: 'Tour CNC Mazak' }, dirToken);
    assert.strictEqual(editMach.status, 200);
    const stateAfterMach = await req('/api/state', 'GET', null, dirToken);
    const of101m = stateAfterMach.data.pieces.find(p => p.id === 'OF-2026-0101');
    assert.strictEqual(of101m.machineId, 'm1');
    assert.strictEqual(of101m.machine, 'Tour CNC Mazak');

    // 4. Sequential OF creation
    const c1 = await req('/api/pieces', 'POST', { nom: 'Pignon test', client: 'Client A', quantitePrevue: 10, machineId: 'm1', operateurId: 'u4', tempsPrevuMin: 60, chuteDispo: true }, dirToken);
    const c2 = await req('/api/pieces', 'POST', { nom: 'Axe test', client: 'Client B', quantitePrevue: 5, machineId: 'm2', operateurId: 'u5', tempsPrevuMin: 45, chuteDispo: true }, dirToken);
    assert.strictEqual(c1.status, 201);
    assert.strictEqual(c2.status, 201);
    const n1 = parseInt(c1.data.id.split('-').pop(), 10);
    const n2 = parseInt(c2.data.id.split('-').pop(), 10);
    assert.strictEqual(n2, n1 + 1, `Expected sequential OF IDs, got ${c1.data.id} and ${c2.data.id}`);

    // 5. Add second operation to gamme
    const addOp = await req(`/api/pieces/${c1.data.id}/operations`, 'POST', {
      libelle: 'Contrôle dimensionnel',
      machineId: 'm4',
      operateurId: 'u4',
      tempsPrevuMin: 30
    }, dirToken);
    assert.strictEqual(addOp.status, 201);

    await req('/api/planning/validate', 'POST', null, dirToken);

    const stOps = await req('/api/state', 'GET', null, dirToken);
    const newPiece = stOps.data.pieces.find(p => p.id === c1.data.id);
    assert.strictEqual(newPiece.operations.length, 2);
    assert.strictEqual(newPiece.tempsPrevuMin, 90);
    const [op1, op2] = newPiece.operations;

    // 6. Start -> Pause -> Resume -> Panne -> Resolve -> Finish Op1 -> Finish Op2
    assert.strictEqual((await req(`/api/operations/${op1.id}/start`, 'POST', {}, karimToken)).status, 200);
    const pauseRes = await req(`/api/operations/${op1.id}/pause`, 'POST', {}, karimToken);
    assert.strictEqual(pauseRes.status, 200);
    assert.ok(pauseRes.data.tempsReelMin >= 1, 'Pause must accumulate >= 1 min');

    assert.strictEqual((await req(`/api/operations/${op1.id}/start`, 'POST', {}, karimToken)).status, 200);
    const panneRes = await req(`/api/operations/${op1.id}/panne`, 'POST', { motif: 'Alarme broche' }, karimToken);
    assert.strictEqual(panneRes.status, 200);
    assert.ok(panneRes.data.panneId);

    const stPanne = await req('/api/state', 'GET', null, dirToken);
    assert.strictEqual(stPanne.data.machines.find(m => m.id === 'm1').enPanne, 1);

    const resPanne = await req(`/api/pannes/${panneRes.data.panneId}/resolve`, 'POST', {}, dirToken);
    assert.strictEqual(resPanne.status, 200);
    const stResolved = await req('/api/state', 'GET', null, dirToken);
    assert.strictEqual(stResolved.data.machines.find(m => m.id === 'm1').enPanne, 0);

    // Resume and finish Op 1 with 9 good + 1 scrap
    assert.strictEqual((await req(`/api/operations/${op1.id}/start`, 'POST', {}, karimToken)).status, 200);
    const fin1 = await req(`/api/operations/${op1.id}/finish`, 'POST', { quantiteBonne: 9, quantiteRebut: 1, motifRebut: 'Rayure surface' }, karimToken);
    assert.strictEqual(fin1.status, 200);
    assert.ok(fin1.data.tempsReelMin >= 2, 'Cumulative time across pause + panne + resume must be preserved');

    // Piece must still NOT be À clôturer until Op 2 finishes
    const midState = await req('/api/state', 'GET', null, dirToken);
    const midPiece = midState.data.pieces.find(p => p.id === c1.data.id);
    assert.strictEqual(midPiece.opsTerminees, 1);
    assert.notStrictEqual(midPiece.statut, 'À clôturer');

    // Finish Op 2 -> OF moves to À clôturer
    assert.strictEqual((await req(`/api/operations/${op2.id}/start`, 'POST', {}, karimToken)).status, 200);
    assert.strictEqual((await req(`/api/operations/${op2.id}/finish`, 'POST', { quantiteBonne: 9, quantiteRebut: 0 }, karimToken)).status, 200);

    const readyClose = await req('/api/state', 'GET', null, dirToken);
    const pieceToClose = readyClose.data.pieces.find(p => p.id === c1.data.id);
    assert.strictEqual(pieceToClose.statut, 'À clôturer');
    assert.strictEqual(pieceToClose.quantiteRealisee, 9);
    assert.strictEqual(pieceToClose.quantiteRebut, 1);

    // 7. Close with prixFinal persisted
    assert.strictEqual((await req(`/api/pieces/${c1.data.id}/close`, 'POST', { prixFinal: 42500 }, dirToken)).status, 200);
    const closedState = await req('/api/state', 'GET', null, dirToken);
    const closedPiece = closedState.data.pieces.find(p => p.id === c1.data.id);
    assert.strictEqual(closedPiece.statut, 'Clôturé');
    assert.strictEqual(closedPiece.prixFinal, 42500);

    // 8. Upload security check
    const badUp = await req('/api/upload', 'POST', { pieceId: c1.data.id, filename: 'evil.html', base64: 'PGgxPmhpPC9oMT4=' }, dirToken);
    assert.strictEqual(badUp.status, 400, 'HTML upload must be rejected');

    // 9. Hot backup check
    const bkp = await req('/api/admin/backup', 'POST', {}, dirToken);
    assert.strictEqual(bkp.status, 200);
    assert.ok(bkp.data.file.endsWith('.db'));

    console.log('✅ TOUS LES TESTS DE SMOKE ONT RÉUSSI (9/9) !');
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
