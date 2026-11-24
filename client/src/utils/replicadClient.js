// Singleton Web Worker client for OpenCASCADE B-Rep (Replicad) in browser

let worker = null;
let reqCounter = 0;
const pending = new Map();
const statusListeners = new Set();
let currentStatus = { status: 'idle', message: '' };

function notifyStatus(st) {
  currentStatus = st;
  for (const fn of statusListeners) {
    try { fn(st); } catch {}
  }
}

export function onReplicadStatus(fn) {
  statusListeners.add(fn);
  fn(currentStatus);
  return () => statusListeners.delete(fn);
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/replicadWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === 'status') {
      notifyStatus({ status: msg.status, message: msg.message || '' });
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'Erreur OpenCASCADE'));
  };
  worker.onerror = (err) => {
    const rawMsg = err?.message || '';
    const isStaleBundle = !rawMsg || /mime|text\/html|failed to fetch|import|module script/i.test(rawMsg);
    const message = isStaleBundle
      ? 'STALE_WORKER_BUNDLE: Une nouvelle version a été déployée sur le serveur. Cliquez sur « Recharger (F5) » pour activer le moteur 3D.'
      : rawMsg;
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    pending.clear();
    resetReplicadWorker();
  };
  return worker;
}

export function resetReplicadWorker() {
  if (worker) {
    try { worker.terminate(); } catch {}
    worker = null;
  }
  warmupPromise = null;
  notifyStatus({ status: 'idle', message: '' });
}

function callWorker(type, payload = {}, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = ++reqCounter;
    const timer = setTimeout(() => {
      pending.delete(id);
      resetReplicadWorker();
      reject(new Error('Calcul CAO OpenCASCADE trop long (délai dépassé). Simplifiez la géométrie ou réduisez les congés/filets.'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, type, payload });
  });
}

let warmupPromise = null;

export function warmupReplicad() {
  if (warmupPromise) return warmupPromise;
  warmupPromise = callWorker('warmup', {}, 150000).catch(err => {
    warmupPromise = null;
    throw err;
  });
  return warmupPromise;
}

export async function buildReplicadModel({ blueprint = null, code = '', paramsMap = {}, legacyFeatures = null, name = 'Piece_CAO', defaultColor = '#94a3b8' }) {
  // Always ensure OCCT WASM download finishes under the generous warmup timeout first!
  await warmupReplicad();
  return callWorker('build', { blueprint, code, paramsMap, legacyFeatures, name, defaultColor }, 60000);
}

export async function exportReplicadSTEPBlob() {
  const res = await callWorker('exportSTEP', {}, 45000);
  return new Blob([res.buffer], { type: 'application/step' });
}

export async function exportReplicadSTLBlob() {
  const res = await callWorker('exportSTL', {}, 45000);
  return new Blob([res.buffer], { type: 'application/octet-stream' });
}

export function materialColorAndDensity(materialStr = '') {
  const s = String(materialStr || '').toLowerCase();
  if (/bronze|cusn|ue12|cupro/.test(s)) return { color: '#b8894a', density: 8.8, label: 'Bronze' };
  if (/laiton|cuzn|brass/.test(s)) return { color: '#d4af37', density: 8.45, label: 'Laiton' };
  if (/cuivre|copper/.test(s)) return { color: '#c87544', density: 8.96, label: 'Cuivre' };
  if (/alu|6061|7075|2017|au4g|ag3/.test(s)) return { color: '#cbd5e1', density: 2.7, label: 'Aluminium' };
  if (/inox|304|316|310|stainless/.test(s)) return { color: '#b4becb', density: 7.95, label: 'Inox' };
  if (/titane|ti6al4v|ta6v/.test(s)) return { color: '#9ca3af', density: 4.43, label: 'Titane' };
  if (/fonte|fgl|fgs/.test(s)) return { color: '#64748b', density: 7.2, label: 'Fonte' };
  if (/teflon|ptfe/.test(s)) return { color: '#f1f5f9', density: 2.2, label: 'PTFE / Téflon' };
  if (/pom|delrin|nylon|pa6|plastique|peek/.test(s)) return { color: '#e2e8f0', density: 1.42, label: 'Polymère' };
  if (/acier|42crmo4|xc48|c45|s235|s355|35ncd16|steel/.test(s)) return { color: '#94a3b8', density: 7.85, label: 'Acier' };
  return { color: '#94a3b8', density: 7.85, label: 'Métal' };
}

export function paramsArrayToMap(params = []) {
  const map = {};
  if (Array.isArray(params)) {
    for (const p of params) {
      if (p && p.key) map[p.key] = Number(p.value);
    }
  }
  return map;
}
