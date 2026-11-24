import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

let ocReadyPromise = null;
let lastBuiltParts = []; // [{ name, color, opacity, shape }]

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

// ============================================================
// INDUSTRIAL MECHANICAL HELPERS (exact OpenCASCADE B-Rep)
// ============================================================

function axisDir(axis = 'x') {
  const a = String(axis || 'x').toLowerCase();
  if (a === 'x' || a === '+x') return [1, 0, 0];
  if (a === '-x') return [-1, 0, 0];
  if (a === 'y' || a === '+y') return [0, 1, 0];
  if (a === '-y') return [0, -1, 0];
  if (a === '-z') return [0, 0, -1];
  return [0, 0, 1];
}

function centeredCylinder(diameter, length, axis = 'x', center = [0, 0, 0]) {
  const r = Math.max(0.05, Number(diameter) / 2);
  const h = Math.max(0.05, Number(length));
  const dir = axisDir(axis);
  const [cx, cy, cz] = center || [0, 0, 0];
  const loc = [cx - (dir[0] * h) / 2, cy - (dir[1] * h) / 2, cz - (dir[2] * h) / 2];
  return replicad.makeCylinder(r, h, loc, dir);
}

function centeredBox(lx, ly, lz, center = [0, 0, 0]) {
  const a = Math.max(0.05, Number(lx));
  const b = Math.max(0.05, Number(ly));
  const c = Math.max(0.05, Number(lz));
  const [cx, cy, cz] = center || [0, 0, 0];
  return replicad.makeBaseBox(a, b, c).translate([cx, cy, cz - c / 2]);
}

function revolveProfile(pointsRadiusPos = [], axis = 'x', center = [0, 0, 0]) {
  // pointsRadiusPos: [[r0, pos0], [r1, pos1], ...] where r >= 0, pos along revolution axis
  const pts = (Array.isArray(pointsRadiusPos) ? pointsRadiusPos : [])
    .map(p => [Math.max(0, Number(p?.[0]) || 0), Number(p?.[1]) || 0])
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) throw new Error('revolveProfile nécessite au moins 2 points [rayon, position]');

  const closed = [];
  if (pts[0][0] > 0.001) closed.push([0, pts[0][1]]);
  for (const pt of pts) closed.push(pt);
  const last = pts[pts.length - 1];
  if (last[0] > 0.001) closed.push([0, last[1]]);

  // Draw on XZ plane (x = radius, y = axial z), then revolve around Z
  let pen = replicad.draw(closed[0]);
  for (let i = 1; i < closed.length; i++) {
    const prev = closed[i - 1];
    const curr = closed[i];
    if (Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) > 1e-4) {
      pen = pen.lineTo(curr);
    }
  }
  let solid = pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]);
  const a = String(axis || 'x').toLowerCase();
  if (a === 'x') solid = solid.rotate(90, [0, 0, 0], [0, 1, 0]);
  else if (a === 'y') solid = solid.rotate(-90, [0, 0, 0], [1, 0, 0]);
  if (center && (center[0] || center[1] || center[2])) {
    solid = solid.translate(center);
  }
  return solid;
}

function centeredCone(d1, d2, length, axis = 'x', center = [0, 0, 0]) {
  const r1 = Math.max(0, Number(d1) / 2);
  const r2 = Math.max(0, Number(d2) / 2);
  const h = Math.max(0.05, Number(length));
  return revolveProfile([[r1, -h / 2], [r2, h / 2]], axis, center);
}

function extrudePolygon(points2D = [], depth = 20, axis = 'z', center = [0, 0, 0]) {
  const pts = (Array.isArray(points2D) ? points2D : [])
    .map(p => [Number(p?.[0]) || 0, Number(p?.[1]) || 0]);
  if (pts.length < 3) throw new Error('extrudePolygon nécessite au moins 3 points 2D');
  const d = Math.max(0.05, Number(depth));
  let pen = replicad.draw(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    if (Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) > 1e-4) {
      pen = pen.lineTo(curr);
    }
  }
  const a = String(axis || 'z').toLowerCase();
  const plane = a === 'x' ? 'YZ' : a === 'y' ? 'XZ' : 'XY';
  let solid = pen.close().sketchOnPlane(plane, -d / 2).extrude(d);
  if (center && (center[0] || center[1] || center[2])) {
    solid = solid.translate(center);
  }
  return solid;
}

function dShapeBody(radius, totalWidth, length, axis = 'x', center = [0, 0, 0]) {
  // Creates a cylinder of radius R sliced flat on one side so total width = totalWidth (<= 2*R)
  const r = Math.max(1, Number(radius));
  const w = Math.max(r * 0.5, Math.min(2 * r, Number(totalWidth) || 2 * r));
  let solid = centeredCylinder(r * 2, length, axis, [0, 0, 0]);
  if (w < 2 * r - 0.01) {
    const flatDist = w - r; // distance from center to flat face
    const cutSize = r * 4;
    const span = Number(length) + 20;
    const a = String(axis || 'x').toLowerCase();
    let cutter;
    if (a === 'x') cutter = centeredBox(span, cutSize, cutSize, [0, flatDist + cutSize / 2, 0]);
    else if (a === 'y') cutter = centeredBox(cutSize, span, cutSize, [0, 0, flatDist + cutSize / 2]);
    else cutter = centeredBox(cutSize, cutSize, span, [flatDist + cutSize / 2, 0, 0]);
    solid = solid.cut(cutter);
  }
  if (center && (center[0] || center[1] || center[2])) {
    solid = solid.translate(center);
  }
  return solid;
}

function cutExternalGroove(shape, { grooveDiameter, outerDiameter, width, axis = 'x', center = [0, 0, 0] } = {}) {
  const gd = Math.max(0.5, Number(grooveDiameter) || 40);
  const od = Math.max(gd + 2, Number(outerDiameter) || gd + 40);
  const w = Math.max(0.2, Number(width) || 5);
  const outerCyl = centeredCylinder(od + 20, w, axis, center);
  const innerCyl = centeredCylinder(gd, w + 4, axis, center);
  const ring = outerCyl.cut(innerCyl);
  return shape.cut(ring);
}

function cutInternalGroove(shape, { grooveDiameter, width, axis = 'x', center = [0, 0, 0] } = {}) {
  const gd = Math.max(0.5, Number(grooveDiameter) || 40);
  const w = Math.max(0.2, Number(width) || 5);
  const cyl = centeredCylinder(gd, w, axis, center);
  return shape.cut(cyl);
}

function patternPositions({ count = 4, pcd = 60, axis = 'x', startAngleDeg = 0, center = [0, 0, 0] }) {
  const n = Math.max(1, Math.min(48, Math.round(Number(count) || 4)));
  const r = Math.max(0.5, Number(pcd) / 2);
  const startRad = ((Number(startAngleDeg) || 0) * Math.PI) / 180;
  const [cx, cy, cz] = center || [0, 0, 0];
  const a = String(axis || 'x').toLowerCase();
  const list = [];
  for (let i = 0; i < n; i++) {
    const ang = startRad + (i / n) * Math.PI * 2;
    const u = Math.cos(ang) * r;
    const v = Math.sin(ang) * r;
    if (a === 'x') list.push([cx, cy + u, cz + v]);
    else if (a === 'y') list.push([cx + u, cy, cz + v]);
    else list.push([cx + u, cy + v, cz]);
  }
  return list;
}

function cutHolePattern(shape, opts = {}) {
  const { count = 4, diameter = 8, pcd = 60, depth = 120, axis = 'x', startAngleDeg = 0, center = [0, 0, 0] } = opts;
  const pts = patternPositions({ count, pcd, axis, startAngleDeg, center });
  const cyls = pts.map(pt => centeredCylinder(diameter, depth, axis, pt));
  try {
    return shape.cut(cyls.length === 1 ? cyls[0] : replicad.makeCompound(cyls));
  } catch {
    let res = shape;
    for (const pt of pts) {
      res = res.cut(centeredCylinder(diameter, depth, axis, pt));
    }
    return res;
  }
}

function addPinPattern(opts = {}) {
  const { count = 4, diameter = 8, pcd = 60, length = 100, axis = 'x', startAngleDeg = 0, center = [0, 0, 0] } = opts;
  const pts = patternPositions({ count, pcd, axis, startAngleDeg, center });
  const pins = pts.map(pt => centeredCylinder(diameter, length, axis, pt));
  return pins.length === 1 ? pins[0] : replicad.makeCompound(pins);
}

function cutThread(shape, opts = {}) {
  const {
    nominalDiameter = 20,
    pitch = 2,
    length = 40,
    internal = true,
    axis = 'x',
    center = [0, 0, 0],
    profile = 'metric' // 'metric' | 'trapezoidal'
  } = opts;
  const nomD = Math.max(1, Number(nominalDiameter) || 20);
  const p = Math.max(0.3, Number(pitch) || 2);
  const len = Math.max(1, Number(length) || 40);
  const depthFactor = profile === 'trapezoidal' ? 1.0 : 1.0825;
  const minorR = Math.max(0.25, (nomD - depthFactor * p) / 2);
  const majorR = nomD / 2;

  // Build ONE revolved trapezoidal/metric cutter solid → 1 single OCCT boolean (~0.5s instead of 30s!)
  const rawTurns = Math.floor(len / p);
  const turns = Math.max(4, Math.min(14, rawTurns));
  const step = len / turns;

  if (internal) {
    const pts = [[minorR, -len / 2 - 0.5]];
    for (let i = 0; i < turns; i++) {
      const a = -len / 2 + i * step;
      if (profile === 'trapezoidal') {
        pts.push([minorR, a + step * 0.16]);
        pts.push([majorR, a + step * 0.34]);
        pts.push([majorR, a + step * 0.66]);
        pts.push([minorR, a + step * 0.84]);
      } else {
        pts.push([minorR, a + step * 0.12]);
        pts.push([majorR, a + step * 0.50]);
        pts.push([minorR, a + step * 0.88]);
      }
    }
    pts.push([minorR, len / 2 + 0.5]);
    try {
      const cutter = revolveProfile(pts, axis, center);
      return shape.cut(cutter);
    } catch {
      return shape.cut(centeredCylinder(minorR * 2, len + 0.5, axis, center));
    }
  } else {
    // External thread: single revolved annular cutter (outerR = majorR + 5 down to minorR)
    const outerR = majorR + 6;
    const pts = [[outerR, -len / 2], [majorR + 0.2, -len / 2]];
    for (let i = 0; i < turns; i++) {
      const a = -len / 2 + i * step;
      pts.push([majorR + 0.2, a + step * 0.16]);
      pts.push([minorR, a + step * 0.36]);
      pts.push([minorR, a + step * 0.64]);
      pts.push([majorR + 0.2, a + step * 0.84]);
    }
    pts.push([majorR + 0.2, len / 2], [outerR, len / 2]);
    try {
      // Closed ring profile revolved around axis
      let pen = replicad.draw(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > 1e-4) {
          pen = pen.lineTo(pts[i]);
        }
      }
      let cutter = pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]);
      const a = String(axis || 'x').toLowerCase();
      if (a === 'x') cutter = cutter.rotate(90, [0, 0, 0], [0, 1, 0]);
      else if (a === 'y') cutter = cutter.rotate(-90, [0, 0, 0], [1, 0, 0]);
      if (center && (center[0] || center[1] || center[2])) cutter = cutter.translate(center);
      return shape.cut(cutter);
    } catch {
      return shape;
    }
  }
}

function safeFillet(shape, radius, finder) {
  const r = Number(radius);
  if (!shape || !Number.isFinite(r) || r <= 0) return shape;
  try {
    return finder ? shape.fillet(r, finder) : shape.fillet(r);
  } catch {
    return shape;
  }
}

function safeChamfer(shape, size, finder) {
  const s = Number(size);
  if (!shape || !Number.isFinite(s) || s <= 0) return shape;
  try {
    return finder ? shape.chamfer(s, finder) : shape.chamfer(s);
  } catch {
    return shape;
  }
}

function normalizePartsResult(raw, defaultName = 'Piece_CAO', defaultColor = '#94a3b8') {
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item) continue;
    if (typeof item.mesh === 'function') {
      out.push({ name: i === 0 ? defaultName : `${defaultName}_${i + 1}`, color: defaultColor, opacity: 1, shape: item });
    } else if (item.shape && typeof item.shape.mesh === 'function') {
      out.push({
        name: String(item.name || (i === 0 ? defaultName : `Element_${i + 1}`)),
        color: String(item.color || defaultColor),
        opacity: item.opacity !== undefined ? Math.max(0.15, Math.min(1, Number(item.opacity))) : 1,
        shape: item.shape
      });
    }
  }
  return out;
}

function executeReplicadCode(code, paramsMap = {}, defaultName = 'Piece_CAO', defaultColor = '#94a3b8') {
  const scopeKeys = [
    'replicad',
    'draw', 'drawCircle', 'drawRectangle', 'drawRoundedRectangle', 'drawPolysides', 'drawEllipse',
    'makeCylinder', 'makeBaseBox', 'makeBox', 'makeSphere', 'makeHelix', 'makePlane', 'makeCompound',
    'Sketcher', 'sketchCircle', 'sketchRectangle', 'sketchRoundedRectangle', 'sketchPolysides', 'sketchHelix',
    'loft', 'genericSweep', 'revolution', 'cut2D', 'fuse2D', 'intersect2D', 'EdgeFinder', 'FaceFinder',
    'centeredCylinder', 'centeredBox', 'centeredCone', 'revolveProfile', 'extrudePolygon', 'dShapeBody',
    'cutExternalGroove', 'cutInternalGroove', 'cutHolePattern', 'addPinPattern', 'cutThread',
    'safeFillet', 'safeChamfer',
    'P', 'PARAMS'
  ];

  const scopeVals = [
    replicad,
    replicad.draw, replicad.drawCircle, replicad.drawRectangle, replicad.drawRoundedRectangle, replicad.drawPolysides, replicad.drawEllipse,
    replicad.makeCylinder, replicad.makeBaseBox, replicad.makeBox, replicad.makeSphere, replicad.makeHelix, replicad.makePlane, replicad.makeCompound,
    replicad.Sketcher, replicad.sketchCircle, replicad.sketchRectangle, replicad.sketchRoundedRectangle, replicad.sketchPolysides, replicad.sketchHelix,
    replicad.loft, replicad.genericSweep, replicad.revolution, replicad.cut2D, replicad.fuse2D, replicad.intersect2D, replicad.EdgeFinder, replicad.FaceFinder,
    centeredCylinder, centeredBox, centeredCone, revolveProfile, extrudePolygon, dShapeBody,
    cutExternalGroove, cutInternalGroove, cutHolePattern, addPinPattern, cutThread,
    safeFillet, safeChamfer,
    paramsMap, paramsMap
  ];

  const wrapped = `
    "use strict";
    ${code}
    if (typeof main === 'function') {
      return main(P, replicad);
    }
    throw new Error("Le script Replicad doit définir une fonction main(P) qui retourne un solide ou un tableau d'éléments.");
  `;

  const fn = new Function(...scopeKeys, wrapped);
  const rawResult = fn(...scopeVals);
  const parts = normalizePartsResult(rawResult, defaultName, defaultColor);
  if (parts.length === 0) {
    throw new Error('La fonction main(P) n’a retourné aucun solide 3D valide.');
  }
  return parts;
}

function buildLegacyFeaturesAsReplicad(features = [], defaultName = 'Piece_CAO', defaultColor = '#94a3b8') {
  let solid = null;
  for (const f of features) {
    if (!f || f.hidden) continue;
    const axis = f.axis || 'x';
    const center = [Number(f.x) || 0, Number(f.y) || 0, Number(f.z) || 0];
    try {
      let s = null;
      if (f.op === 'add_cylinder') {
        s = centeredCylinder(f.diameter || 40, f.length || 80, axis, center);
        solid = solid ? solid.fuse(s) : s;
      } else if (f.op === 'add_box') {
        s = centeredBox(f.lx || 80, f.ly || 60, f.lz || 20, center);
        solid = solid ? solid.fuse(s) : s;
      } else if (f.op === 'add_cone') {
        s = centeredCone(f.d1 ?? 40, f.d2 ?? 20, f.length || 40, axis, center);
        solid = solid ? solid.fuse(s) : s;
      } else if (f.op === 'add_revolve' && Array.isArray(f.points)) {
        s = revolveProfile(f.points, axis, center);
        solid = solid ? solid.fuse(s) : s;
      } else if (f.op === 'add_extrude' && Array.isArray(f.points)) {
        s = extrudePolygon(f.points, f.depth ?? 20, f.axis || 'z', center);
        solid = solid ? solid.fuse(s) : s;
      } else if (!solid) {
        continue;
      } else if (f.op === 'cut_bore') {
        solid = solid.cut(centeredCylinder(f.diameter || 20, f.length || 250, axis, center));
      } else if (f.op === 'cut_cone') {
        solid = solid.cut(centeredCone(f.d1 ?? 24, f.d2 ?? 16, f.length || 10, axis, center));
      } else if (f.op === 'cut_revolve' && Array.isArray(f.points)) {
        solid = solid.cut(revolveProfile(f.points, axis, center));
      } else if (f.op === 'cut_extrude' && Array.isArray(f.points)) {
        solid = solid.cut(extrudePolygon(f.points, f.depth ?? 40, f.axis || 'z', center));
      } else if (f.op === 'cut_flat') {
        const dist = Math.max(0.5, Number(f.distanceFromCenter) || 50);
        const span = Math.max(10, Number(f.span) || 300);
        const cutThick = 200;
        const side = f.side || '+y';
        let pos = [0, dist + cutThick / 2, 0];
        let dims = [span, cutThick, span];
        if (side === '-y') pos = [0, -(dist + cutThick / 2), 0];
        else if (side === '+z') { pos = [0, 0, dist + cutThick / 2]; dims = [span, span, cutThick]; }
        else if (side === '-z') { pos = [0, 0, -(dist + cutThick / 2)]; dims = [span, span, cutThick]; }
        else if (side === '+x') { pos = [dist + cutThick / 2, 0, 0]; dims = [cutThick, span, span]; }
        else if (side === '-x') { pos = [-(dist + cutThick / 2), 0, 0]; dims = [cutThick, span, span]; }
        solid = solid.cut(centeredBox(dims[0], dims[1], dims[2], pos));
      } else if (f.op === 'cut_slot') {
        solid = solid.cut(centeredBox(f.lx || 20, f.ly || 20, f.lz || 10, center));
      } else if (f.op === 'cut_hole_pattern') {
        solid = cutHolePattern(solid, {
          count: f.count || 4,
          diameter: f.holeDiameter || 8,
          pcd: f.pcd || 60,
          depth: f.depth || 120,
          axis,
          startAngleDeg: f.startAngleDeg || 0,
          center
        });
      } else if (f.op === 'cut_groove') {
        const count = Math.max(1, Math.min(20, parseInt(f.count, 10) || 1));
        const od = Number(f.outerDiameter) || 65;
        const w = Number(f.width) || 4;
        const pitch = Math.max(w + 0.2, Number(f.pitch) || 8);
        const dir = axisDir(axis);
        const startOff = -((count - 1) * pitch) / 2;
        for (let i = 0; i < count; i++) {
          const off = startOff + i * pitch;
          const pt = [center[0] + dir[0] * off, center[1] + dir[1] * off, center[2] + dir[2] * off];
          solid = cutInternalGroove(solid, { grooveDiameter: od, width: w, axis, center: pt });
        }
      } else if (f.op === 'cut_thread') {
        solid = cutThread(solid, {
          nominalDiameter: f.nominalDiameter || 10,
          pitch: f.pitch || 1.5,
          length: f.length || 30,
          internal: f.internal !== false,
          axis,
          center
        });
      }
    } catch (err) {
      console.warn('Legacy feature skipped in OCCT:', f.id, err?.message);
    }
  }
  if (!solid) throw new Error('Aucune géométrie valide à convertir en B-Rep.');
  return [{ name: defaultName, color: defaultColor, opacity: 1, shape: solid }];
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
      const { code, paramsMap = {}, legacyFeatures = null, name = 'Piece_CAO', defaultColor = '#94a3b8' } = payload || {};
      const parts = code && String(code).trim()
        ? executeReplicadCode(code, paramsMap, name, defaultColor)
        : buildLegacyFeaturesAsReplicad(legacyFeatures || [], name, defaultColor);

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
          const vx = vertices[i], vy = vertices[i + 1], vz = vertices[i + 2];
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
          elapsedMs: Math.round(performance.now() - t0)
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
