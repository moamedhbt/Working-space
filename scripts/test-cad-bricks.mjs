import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createBrepEngine } from '../client/src/utils/blueprintEngine.js';

import opencascade from '../client/node_modules/replicad-opencascadejs/dist/replicad_single.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const replicad = require('../client/node_modules/replicad');
const wasmPath = path.resolve(__dirname, '../client/node_modules/replicad-opencascadejs/dist/replicad_single.wasm');

function measureBbox(parts) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let totalVol = 0;
  for (const p of parts) {
    const mesh = p.shape.mesh({ tolerance: 0.2, angularTolerance: 0.5 });
    const v = mesh.vertices;
    for (let i = 0; i < v.length; i += 3) {
      if (v[i] < minX) minX = v[i];
      if (v[i + 1] < minY) minY = v[i + 1];
      if (v[i + 2] < minZ) minZ = v[i + 2];
      if (v[i] > maxX) maxX = v[i];
      if (v[i + 1] > maxY) maxY = v[i + 1];
      if (v[i + 2] > maxZ) maxZ = v[i + 2];
    }
    totalVol += Math.abs(replicad.measureVolume(p.shape)) || 0;
  }
  return {
    lx: Number((maxX - minX).toFixed(2)),
    ly: Number((maxY - minY).toFixed(2)),
    lz: Number((maxZ - minZ).toFixed(2)),
    volumeCm3: Number((totalVol / 1000).toFixed(2))
  };
}

function approx(actual, expected, tol, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label} : attendu ${expected} ± ${tol}, obtenu ${actual}`
  );
}

async function run() {
  const tStart = Date.now();
  const oc = await opencascade({ locateFile: () => wasmPath });
  replicad.setOC(oc);
  const engine = createBrepEngine(replicad);
  console.log(`🔧 OpenCASCADE WASM initialisé en ${Date.now() - tStart} ms\n`);

  let passed = 0;

  // TEST 1: Arbre étagé de révolution + gorge extérieure + filetage extérieur M24x3 + chanfrein
  {
    const t0 = Date.now();
    const P = { L: 200, D1: 50, D2: 36, D3: 24, d_gorge: 30 };
    const bp = {
      body: {
        type: 'revolve',
        axis: 'x',
        profile: [
          [12, -100], [12, -60],
          [18, -60], [18, 20],
          [25, 20], [25, 100]
        ]
      },
      features: [
        { id: 'g1', type: 'groove_ext', label: 'Gorge dégagement', grooveDiameter: 'd_gorge', outerDiameter: 'D2', width: 6, axis: 'x', center: [-20, 0, 0] },
        { id: 't1', type: 'thread', label: 'Filetage ext M24x3', nominalDiameter: 'D3', pitch: 3, length: 34, internal: false, profile: 'metric', axis: 'x', center: [-80, 0, 0] },
        { id: 'c1', type: 'chamfer', label: 'Chanfreins', size: 1 }
      ]
    };
    const res = engine.buildFromBlueprint(bp, P, 'Arbre_Etage');
    const m = measureBbox(res.parts);
    approx(m.lx, 200, 1.5, 'Arbre longueur X');
    approx(m.ly, 50, 1.5, 'Arbre Ø max Y');
    assert.ok(m.volumeCm3 > 100, `Arbre volume trop faible (${m.volumeCm3} cm³)`);
    assert.equal(res.featureWarnings.length, 0, `Alertes inattendues : ${res.featureWarnings.join(' | ')}`);
    const stepBlob = replicad.exportSTEP(res.parts.map(p => ({ shape: p.shape, name: p.name })));
    assert.ok(stepBlob.size > 5000, 'Export STEP arbre vide');
    console.log(`✅ [1/6] Arbre étagé + gorge + M24x3 ext + STEP (${m.lx}×${m.ly}×${m.lz} mm, ${m.volumeCm3} cm³, ${Date.now() - t0} ms)`);
    passed++;
  }

  // TEST 2: Bride / Moyeu + alésage + 6 trous PCD + rainure de clavette
  {
    const t0 = Date.now();
    const P = { d_bride: 140, ep_bride: 20, d_moyeu: 70, l_moyeu: 25, d_alesage: 35, pcd: 105 };
    const bp = {
      body: { type: 'flange', axis: 'z', flangeDiameter: 'd_bride', flangeThickness: 'ep_bride', hubDiameter: 'd_moyeu', hubLength: 'l_moyeu' },
      features: [
        { id: 'b1', type: 'bore', label: 'Alésage Ø35', diameter: 'd_alesage', through: true, axis: 'z' },
        { id: 'h1', type: 'hole_pattern', label: '6xØ10 PCD 105', count: 6, diameter: 10, pcd: 'pcd', through: true, axis: 'z' },
        { id: 'k1', type: 'slot', label: 'Rainure clavette', lx: 10, ly: 8, lz: 80, center: [0, 18, 10] }
      ]
    };
    const res = engine.buildFromBlueprint(bp, P, 'Bride_Moyeu');
    const m = measureBbox(res.parts);
    approx(m.lx, 140, 1.5, 'Bride Ø X');
    approx(m.lz, 45, 1.5, 'Bride hauteur Z');
    assert.equal(res.featureWarnings.length, 0, `Alertes inattendues : ${res.featureWarnings.join(' | ')}`);
    console.log(`✅ [2/6] Bride + moyeu + alésage + 6×PCD + clavette (${m.lx}×${m.ly}×${m.lz} mm, ${m.volumeCm3} cm³, ${Date.now() - t0} ms)`);
    passed++;
  }

  // TEST 3: Pièce profil en D + tenons symétriques + gorge centrale + filet Tr 65x8 + 8 inserts PTFE multi-corps
  {
    const t0 = Date.now();
    const P = { R: 60, H: 114.5, L_corps: 190, L_tenon: 20, d_gorge: 95, d_filet: 65, pas: 8, pcd: 70, d_insert: 10 };
    const bp = {
      body: { type: 'd_profile', axis: 'x', radius: 'R', flatWidth: 'H', length: 'L_corps', color: '#b8894a' },
      features: [
        { id: 'ten', type: 'boss', label: 'Manchons extrémité Ø95', shape: 'cylinder', diameter: 95, length: 'L_tenon + 4', bothEnds: true, endOffset: '(L_corps + L_tenon) / 2 - 2', axis: 'x' },
        { id: 'g', type: 'groove_ext', label: 'Gorge centrale Ø95', grooveDiameter: 'd_gorge', outerDiameter: 'R * 2', width: 25, axis: 'x' },
        { id: 'tr', type: 'thread', label: 'Taraudage Tr 65x8', nominalDiameter: 'd_filet', pitch: 'pas', length: 240, internal: true, profile: 'trapezoidal', axis: 'x' },
        { id: 'ins', type: 'pins', label: 'Inserts PTFE x8', name: 'Inserts Téflon', color: '#f1f5f9', count: 8, diameter: 'd_insert', pcd: 'pcd', length: 'L_corps', angles: [0, 38, 90, 142, 180, 218, 270, 322], cutHostHole: true, axis: 'x' }
      ]
    };
    const res = engine.buildFromBlueprint(bp, P, 'Ecrou_Profil_D');
    assert.equal(res.parts.length, 2, 'Doit produire 2 solides distincts (Corps + Inserts)');
    const m = measureBbox(res.parts);
    approx(m.lx, 230, 2.0, 'Longueur totale 230 mm');
    approx(m.ly, 114.5, 2.0, 'Hauteur méplat 114.5 mm');
    approx(m.lz, 120, 2.0, 'Largeur 2*R60 = 120 mm');
    assert.equal(res.featureWarnings.length, 0, `Alertes inattendues : ${res.featureWarnings.join(' | ')}`);
    const stepBlob = replicad.exportSTEP(res.parts.map(p => ({ shape: p.shape, name: p.name })));
    assert.ok(stepBlob.size > 10000, 'Export STEP multi-corps vide');
    console.log(`✅ [3/6] Profil en D + tenons + gorge + Tr65x8 + 8 inserts PTFE multi-corps (${m.lx}×${m.ly}×${m.lz} mm, ${m.volumeCm3} cm³, ${Date.now() - t0} ms)`);
    passed++;
  }

  // TEST 4: Bloc / Plaque prismatique + poche + 4 perçages explicites
  {
    const t0 = Date.now();
    const P = { L: 160, W: 100, E: 25 };
    const bp = {
      body: { type: 'box', axis: 'z', lx: 'L', ly: 'W', lz: 'E' },
      features: [
        { id: 'p1', type: 'pocket', label: 'Poche centrale', lx: 80, ly: 50, lz: 12, center: [0, 0, 8] },
        { id: 'h1', type: 'hole', label: '4 trous fixation', diameter: 10, through: true, axis: 'z', positions: [[-65, -35, 0], [65, -35, 0], [-65, 35, 0], [65, 35, 0]] }
      ]
    };
    const res = engine.buildFromBlueprint(bp, P, 'Plaque_CNC');
    const m = measureBbox(res.parts);
    approx(m.lx, 160, 1.0, 'Plaque L');
    approx(m.ly, 100, 1.0, 'Plaque W');
    approx(m.lz, 25, 1.0, 'Plaque E');
    assert.equal(res.featureWarnings.length, 0, `Alertes inattendues : ${res.featureWarnings.join(' | ')}`);
    console.log(`✅ [4/6] Plaque prismatique + poche + 4 perçages (${m.lx}×${m.ly}×${m.lz} mm, ${m.volumeCm3} cm³, ${Date.now() - t0} ms)`);
    passed++;
  }

  // TEST 5: Écrou 6 pans + taraudage M20x2.5 + AUTO-TEST CONTRÔLE DE VOLUME (usinage dans le vide détecté!)
  {
    const t0 = Date.now();
    const bp = {
      body: { type: 'polygon', sides: 6, acrossFlats: 30, length: 18, axis: 'z' },
      features: [
        { id: 'tr', type: 'thread', label: 'Taraudage M20x2.5', nominalDiameter: 20, pitch: 2.5, length: 24, internal: true, profile: 'metric', axis: 'z' },
        { id: 'bad_hole', type: 'hole', label: 'Trou hors matière', diameter: 8, depth: 30, axis: 'z', positions: [[500, 500, 0]] }
      ]
    };
    const res = engine.buildFromBlueprint(bp, {}, 'Ecrou_Hex');
    const m = measureBbox(res.parts);
    approx(m.lz, 18, 1.0, 'Écrou hauteur');
    assert.ok(
      res.featureWarnings.some(w => /dans le vide/i.test(w)),
      `Le contrôle de volume aurait dû détecter "usinage dans le vide", reçu : ${JSON.stringify(res.featureWarnings)}`
    );
    console.log(`✅ [5/6] Écrou 6 pans + M20x2.5 + détection automatique "usinage dans le vide" (${Date.now() - t0} ms)`);
    passed++;
  }

  // TEST 6: Protection safeDraw bulgeArcTo(..., 60) -> plus jamais de ballon de 1014 mm!
  {
    const t0 = Date.now();
    const code = `
      function main(P) {
        let prof = draw([-60, -57]).lineTo([60, -57]).lineTo([60, 2]).lineTo([15, 2]).lineTo([15, 57]).bulgeArcTo([-15, 57], 60).lineTo([-15, 2]).lineTo([-60, 2]).close();
        return prof.sketchOnPlane('XY').extrude(230);
      }
    `;
    const parts = engine.executeReplicadCode(code, {}, 'Test_SafeBulge');
    const m = measureBbox(parts);
    assert.ok(m.lx <= 125 && m.ly <= 125 && m.lz <= 235, `bulgeArcTo(60) a explosé l'encombrement : ${m.lx}×${m.ly}×${m.lz}`);
    console.log(`✅ [6/6] Protection safeDraw bulgeArcTo(pt, 60) validée (${m.lx}×${m.ly}×${m.lz} mm, aucun ballon 1014 mm!, ${Date.now() - t0} ms)`);
    passed++;
  }

  console.log(`\n🎉 TOUS LES TESTS CAO B-REP OPENCASCADE ONT RÉUSSI (${passed}/6) en ${Date.now() - tStart} ms !`);
}

run().catch(err => {
  console.error('❌ ÉCHEC TEST CAO :', err);
  process.exit(1);
});
