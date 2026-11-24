import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';
import { createBrepEngine } from '../utils/blueprintEngine.js';

let ocReadyPromise = null;
let lastBuiltParts = []; // [{ name, color, opacity, shape }]
const engine = createBrepEngine(replicad);

const FALLBACK_CDN_WASM = 'https://cdn.jsdelivr.net/npm/replicad-opencascadejs@1.2.1/dist/replicad_single.wasm';

async function resolveWasmUrl() {
  const origin = self.location?.origin || '';
  const localUrl = `${origin}/occt/replicad_single.wasm`;
  try {
    const head = await fetch(localUrl, { method: 'HEAD' });
    if (head.ok) return localUrl;
  } catch {
    // ignore and fallback
  }
  return FALLBACK_CDN_WASM;
}

async function ensureOC() {
  if (ocReadyPromise) return ocReadyPromise;
  ocReadyPromise = (async () => {
    self.postMessage({ type: 'status', status: 'loading_occt', message: 'Chargement du noyau CAO OpenCASCADE…' });
    const wasmUrl = await resolveWasmUrl();
    const oc = await opencascade({
      locateFile: () => wasmUrl
    });
    replicad.setOC(oc);
    self.postMessage({ type: 'status', status: 'ready', message: 'Noyau OpenCASCADE B-Rep prêt.' });
    return oc;
  })().catch(err => {
    ocReadyPromise = null;
    throw err;
  });
  return ocReadyPromise;
}

function disposeLastParts() {
  for (const p of lastBuiltParts) {
    try { p.shape?.delete?.(); } catch {}
  }
  lastBuiltParts = [];
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    await ensureOC();

    if (type === 'warmup') {
      self.postMessage({ id, ok: true, result: { ready: true } });
      return;
    }

    if (type === 'build') {
      const t0 = performance.now();
      disposeLastParts();
      const { blueprint = null, code = '', paramsMap = {}, legacyFeatures = null, name = 'Piece_CAO', defaultColor = '#94a3b8' } = payload || {};
      let parts;
      let featureWarnings = [];
      let featureLog = [];
      if (blueprint && typeof blueprint === 'object' && blueprint.body) {
        const built = engine.buildFromBlueprint(blueprint, paramsMap, name, defaultColor);
        parts = built.parts;
        featureWarnings = built.featureWarnings || [];
        featureLog = built.featureLog || [];
      } else if (code && String(code).trim()) {
        parts = engine.executeReplicadCode(code, paramsMap, name, defaultColor);
      } else {
        parts = engine.buildLegacyFeaturesAsReplicad(legacyFeatures || [], name, defaultColor);
      }

      lastBuiltParts = parts;

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let totalVolumeMm3 = 0;
      let totalAreaMm2 = 0;

      const meshParts = [];
      const transferables = [];

      for (const p of parts) {
        const mesh = p.shape.mesh({ tolerance: 0.15, angularTolerance: 0.45 });
        const edges = p.shape.meshEdges({ tolerance: 0.15, angularTolerance: 0.45 });

        const vertices = new Float32Array(mesh.vertices);
        const normals = new Float32Array(mesh.normals);
        const triangles = new Uint32Array(mesh.triangles);
        const edgeLines = new Float32Array(edges.lines);

        for (let i = 0; i < vertices.length; i += 3) {
          const vx = vertices[i];
          const vy = vertices[i + 1];
          const vz = vertices[i + 2];
          if (vx < minX) minX = vx;
          if (vy < minY) minY = vy;
          if (vz < minZ) minZ = vz;
          if (vx > maxX) maxX = vx;
          if (vy > maxY) maxY = vy;
          if (vz > maxZ) maxZ = vz;
        }

        let vol = 0;
        let area = 0;
        try { vol = Math.abs(replicad.measureVolume(p.shape)) || 0; } catch {}
        try { area = Math.abs(replicad.measureArea(p.shape)) || 0; } catch {}
        totalVolumeMm3 += vol;
        totalAreaMm2 += area;

        transferables.push(vertices.buffer, normals.buffer, triangles.buffer, edgeLines.buffer);
        meshParts.push({
          name: p.name,
          color: p.color,
          opacity: p.opacity,
          volumeCm3: Number((vol / 1000).toFixed(2)),
          vertices,
          normals,
          triangles,
          edgeLines
        });
      }

      const bbox = Number.isFinite(minX)
        ? {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
            lx: Number((maxX - minX).toFixed(2)),
            ly: Number((maxY - minY).toFixed(2)),
            lz: Number((maxZ - minZ).toFixed(2))
          }
        : { min: [0, 0, 0], max: [0, 0, 0], lx: 0, ly: 0, lz: 0 };

      self.postMessage({
        id,
        ok: true,
        result: {
          parts: meshParts,
          bbox,
          volumeCm3: Number((totalVolumeMm3 / 1000).toFixed(2)),
          areaCm2: Number((totalAreaMm2 / 100).toFixed(2)),
          elapsedMs: Math.round(performance.now() - t0),
          featureWarnings,
          featureLog
        }
      }, transferables);
      return;
    }

    if (type === 'exportSTEP') {
      if (lastBuiltParts.length === 0) throw new Error('Aucun modèle B-Rep construit.');
      const configs = lastBuiltParts.map(p => ({
        shape: p.shape,
        name: p.name,
        color: p.color
      }));
      const blob = replicad.exportSTEP(configs);
      const ab = await blob.arrayBuffer();
      self.postMessage({ id, ok: true, result: { buffer: ab, size: ab.byteLength } }, [ab]);
      return;
    }

    if (type === 'exportSTL') {
      if (lastBuiltParts.length === 0) throw new Error('Aucun modèle B-Rep construit.');
      if (lastBuiltParts.length === 1) {
        const blob = lastBuiltParts[0].shape.blobSTL({ binary: true, tolerance: 0.12, angularTolerance: 0.35 });
        const ab = await blob.arrayBuffer();
        self.postMessage({ id, ok: true, result: { buffer: ab, size: ab.byteLength } }, [ab]);
      } else {
        const clones = lastBuiltParts.map(p => p.shape.clone());
        const combined = replicad.makeCompound(clones);
        try {
          const blob = combined.blobSTL({ binary: true, tolerance: 0.12, angularTolerance: 0.35 });
          const ab = await blob.arrayBuffer();
          self.postMessage({ id, ok: true, result: { buffer: ab, size: ab.byteLength } }, [ab]);
        } finally {
          try { combined.delete(); } catch {}
        }
      }
      return;
    }

    throw new Error(`Commande worker inconnue : ${type}`);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || String(err || 'Erreur noyau OpenCASCADE')
    });
  }
};
