// Shared OpenCASCADE B-Rep Engine (used by both browser replicadWorker.js and Node.js test:cad suite)

export function createBrepEngine(replicad) {
  function axisDir(axis = 'x') {
    if (Array.isArray(axis) && axis.length >= 3) {
      const x = Number(axis[0]) || 0;
      const y = Number(axis[1]) || 0;
      const z = Number(axis[2]) || 0;
      const len = Math.hypot(x, y, z);
      if (len > 1e-6) return [x / len, y / len, z / len];
      return [0, 0, 1];
    }
    const a = String(axis || 'x').toLowerCase();
    if (a === 'x' || a === '+x') return [1, 0, 0];
    if (a === '-x') return [-1, 0, 0];
    if (a === 'y' || a === '+y') return [0, 1, 0];
    if (a === '-y') return [0, -1, 0];
    if (a === '-z') return [0, 0, -1];
    return [0, 0, 1];
  }

  function safeMeasureVolume(shape) {
    if (!shape) return 0;
    try {
      const v = Math.abs(replicad.measureVolume(shape));
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
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
    const pts = (Array.isArray(pointsRadiusPos) ? pointsRadiusPos : [])
      .map(p => [Math.max(0, Number(p?.[0]) || 0), Number(p?.[1]) || 0])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) throw new Error('revolveProfile nécessite au moins 2 points [rayon, position]');

    const closed = [];
    if (pts[0][0] > 0.001) closed.push([0, pts[0][1]]);
    for (const pt of pts) closed.push(pt);
    const last = pts[pts.length - 1];
    if (last[0] > 0.001) closed.push([0, last[1]]);

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
    const r = Math.max(1, Number(radius));
    const w = Math.max(r * 0.5, Math.min(2 * r, Number(totalWidth) || 2 * r));
    let solid = centeredCylinder(r * 2, length, axis, [0, 0, 0]);
    if (w < 2 * r - 0.01) {
      const flatDist = w - r;
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

  function patternPositions({ count = 4, pcd = 60, axis = 'x', startAngleDeg = 0, angles = null, center = [0, 0, 0] }) {
    const r = Math.max(0.5, Number(pcd) / 2);
    const [cx, cy, cz] = center || [0, 0, 0];
    const a = String(axis || 'x').toLowerCase();
    const list = [];
    if (Array.isArray(angles) && angles.length > 0) {
      for (const deg of angles) {
        const ang = ((Number(deg) || 0) * Math.PI) / 180;
        const u = Math.cos(ang) * r;
        const v = Math.sin(ang) * r;
        if (a === 'x') list.push([cx, cy + u, cz + v]);
        else if (a === 'y') list.push([cx + u, cy, cz + v]);
        else list.push([cx + u, cy + v, cz]);
      }
      return list;
    }
    const n = Math.max(1, Math.min(48, Math.round(Number(count) || 4)));
    const startRad = ((Number(startAngleDeg) || 0) * Math.PI) / 180;
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
    const { count = 4, diameter = 8, pcd = 60, depth = 120, axis = 'x', startAngleDeg = 0, angles = null, center = [0, 0, 0] } = opts;
    const pts = patternPositions({ count, pcd, axis, startAngleDeg, angles, center });
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
    const { count = 4, diameter = 8, pcd = 60, length = 100, axis = 'x', startAngleDeg = 0, angles = null, center = [0, 0, 0] } = opts;
    const pts = patternPositions({ count, pcd, axis, startAngleDeg, angles, center });
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
      profile = 'metric'
    } = opts;
    const nomD = Math.max(1, Number(nominalDiameter) || 20);
    const p = Math.max(0.3, Number(pitch) || 2);
    const len = Math.max(1, Number(length) || 40);
    const depthFactor = profile === 'trapezoidal' ? 1.0 : 1.0825;
    const minorR = Math.max(0.25, (nomD - depthFactor * p) / 2);
    const majorR = nomD / 2;

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

  function safeDraw(initialPoint) {
    const pen = replicad.draw(initialPoint);
    const origBulgeArcTo = pen.bulgeArcTo?.bind(pen);
    if (origBulgeArcTo) {
      pen.bulgeArcTo = (endPoint, bulge, ...rest) => {
        const b = Number(bulge);
        if (Number.isFinite(b) && Math.abs(b) > 1.5 && Array.isArray(endPoint) && endPoint.length >= 2) {
          const cur = pen.pointer || [0, 0];
          const chord = Math.hypot((Number(endPoint[0]) || 0) - (Number(cur[0]) || 0), (Number(endPoint[1]) || 0) - (Number(cur[1]) || 0));
          if (chord > 1e-4) {
            const R = Math.max(chord / 2 + 0.001, Math.abs(b));
            const sagitta = R - Math.sqrt(Math.max(0, R * R - (chord / 2) * (chord / 2)));
            return pen.sagittaArcTo(endPoint, Math.sign(b) * sagitta);
          }
        }
        return origBulgeArcTo(endPoint, bulge, ...rest);
      };
    }
    return pen;
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

  function resolveNum(val, P = {}, fallback = 0) {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (val == null || val === '') return fallback;
    const raw = String(val).trim();
    if (!raw) return fallback;
    if (Object.prototype.hasOwnProperty.call(P, raw)) {
      const n = Number(P[raw]);
      return Number.isFinite(n) ? n : fallback;
    }
    const direct = Number(raw);
    if (Number.isFinite(direct)) return direct;
    const substituted = raw.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (tok) => {
      if (Object.prototype.hasOwnProperty.call(P, tok)) {
        const n = Number(P[tok]);
        return Number.isFinite(n) ? `(${n})` : '0';
      }
      return 'NaN';
    });
    if (!/^[0-9eE.+\-*/()\s]+$/.test(substituted)) return fallback;
    try {
      const out = Function(`"use strict"; return (${substituted});`)();
      return typeof out === 'number' && Number.isFinite(out) ? out : fallback;
    } catch {
      return fallback;
    }
  }

  function resolveVec3(vec, P = {}, fallback = [0, 0, 0]) {
    if (!Array.isArray(vec) || vec.length < 3) return fallback;
    return [
      resolveNum(vec[0], P, fallback[0]),
      resolveNum(vec[1], P, fallback[1]),
      resolveNum(vec[2], P, fallback[2])
    ];
  }

  function buildFromBlueprint(blueprint, paramsMap = {}, defaultName = 'Piece_CAO', defaultColor = '#94a3b8') {
    if (!blueprint || typeof blueprint !== 'object' || !blueprint.body) {
      throw new Error('Fiche géométrique invalide (corps principal manquant).');
    }
    const P = paramsMap || {};
    const b = blueprint.body || {};
    const mainAxis = String(b.axis || 'x').toLowerCase();
    const bodyColor = b.color || defaultColor;
    const bodyName = b.name || defaultName || 'Corps principal';

    let body = null;
    let bodySpan = 100;
    let bodyOuterD = 80;

    if (b.type === 'd_profile') {
      const r = b.radius != null ? resolveNum(b.radius, P, 50) : resolveNum(b.diameter, P, 100) / 2;
      const flatWidth = b.flatWidth != null
        ? resolveNum(b.flatWidth, P, r * 1.85)
        : (b.flatDistFromCenter != null ? r + resolveNum(b.flatDistFromCenter, P, r * 0.85) : r * 2);
      const len = resolveNum(b.length, P, 120);
      bodySpan = len;
      bodyOuterD = r * 2;
      body = dShapeBody(r, flatWidth, len, mainAxis, [0, 0, 0]);
    } else if (b.type === 'revolve' && Array.isArray(b.profile) && b.profile.length >= 2) {
      const pts = b.profile.map(pt => [resolveNum(pt?.[0], P, 10), resolveNum(pt?.[1], P, 0)]);
      const xs = pts.map(p => p[1]);
      bodySpan = Math.max(10, Math.max(...xs) - Math.min(...xs));
      bodyOuterD = Math.max(10, Math.max(...pts.map(p => p[0])) * 2);
      body = revolveProfile(pts, mainAxis, [0, 0, 0]);
    } else if (b.type === 'box') {
      const lx = Math.max(1, resolveNum(b.lx ?? b.length, P, 100));
      const ly = Math.max(1, resolveNum(b.ly ?? b.width, P, 80));
      const lz = Math.max(1, resolveNum(b.lz ?? b.thickness ?? b.height, P, 25));
      bodySpan = mainAxis === 'x' ? lx : mainAxis === 'y' ? ly : lz;
      bodyOuterD = Math.max(lx, ly, lz);
      body = centeredBox(lx, ly, lz, [0, 0, 0]);
      const cr = resolveNum(b.cornerRadius, P, 0);
      if (cr > 0.1) body = safeFillet(body, cr);
    } else if (b.type === 'flange') {
      const fd = Math.max(2, resolveNum(b.flangeDiameter ?? b.diameter, P, 120));
      const ft = Math.max(1, resolveNum(b.flangeThickness ?? b.thickness, P, 20));
      const hd = resolveNum(b.hubDiameter, P, 0);
      const hl = resolveNum(b.hubLength, P, 0);
      bodySpan = ft + (hl > 0 ? hl : 0);
      bodyOuterD = fd;
      const dir = axisDir(mainAxis);
      body = centeredCylinder(fd, ft, mainAxis, [0, 0, 0]);
      if (hd > 1 && hl > 0.5) {
        const off = ft / 2 + hl / 2 - 0.5;
        const hub = centeredCylinder(hd, hl + 1, mainAxis, [dir[0] * off, dir[1] * off, dir[2] * off]);
        body = body.fuse(hub);
      }
    } else if (b.type === 'polygon') {
      const sides = Math.max(3, Math.min(24, Math.round(resolveNum(b.sides, P, 6))));
      const af = resolveNum(b.acrossFlats, P, 0);
      const r = af > 0 ? (af / 2) / Math.cos(Math.PI / sides) : Math.max(1, resolveNum(b.radius, P, resolveNum(b.diameter, P, 60) / 2));
      const len = Math.max(1, resolveNum(b.length, P, 40));
      bodySpan = len;
      bodyOuterD = r * 2;
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      body = extrudePolygon(pts, len, mainAxis, [0, 0, 0]);
    } else {
      const d = Math.max(1, resolveNum(b.diameter, P, resolveNum(b.radius, P, 40) * 2));
      const len = Math.max(1, resolveNum(b.length, P, 100));
      bodySpan = len;
      bodyOuterD = d;
      body = centeredCylinder(d, len, mainAxis, [0, 0, 0]);
    }

    const extraParts = [];
    const featureWarnings = [];
    const featureLog = [];
    const features = Array.isArray(blueprint.features) ? blueprint.features : [];

    const SUBTRACTIVE_TYPES = new Set(['bore', 'groove_ext', 'groove_int', 'thread', 'hole_pattern', 'hole', 'slot', 'pocket', 'flat', 'keyway']);
    const ADDITIVE_TYPES = new Set(['boss', 'tenon', 'lug', 'collar']);

    for (const f of features) {
      if (!f || f.enabled === false || f.hidden === true) continue;
      const fAxis = String(f.axis || mainAxis).toLowerCase();
      const fDir = axisDir(fAxis);
      const center = resolveVec3(f.center, P, [0, 0, 0]);
      const volBefore = safeMeasureVolume(body);
      const featName = f.label || f.type;
      try {
        if (ADDITIVE_TYPES.has(f.type)) {
          const makeOne = (c) => {
            if (f.shape === 'cylinder' || (f.diameter != null && f.lx == null && f.width == null)) {
              const d = Math.max(1, resolveNum(f.diameter, P, 40));
              const l = Math.max(0.5, resolveNum(f.length, P, 20));
              return centeredCylinder(d, l, fAxis, c);
            }
            const lx = Math.max(0.5, resolveNum(f.lx ?? (fAxis === 'x' ? f.length : f.width), P, 25));
            const ly = Math.max(0.5, resolveNum(f.ly ?? (fAxis === 'y' ? f.length : f.height ?? f.width), P, 30));
            const lz = Math.max(0.5, resolveNum(f.lz ?? (fAxis === 'z' ? f.length : f.width), P, 30));
            return centeredBox(lx, ly, lz, c);
          };
          if (f.bothEnds) {
            const projLen = resolveNum(f.length ?? (fAxis === 'x' ? f.lx : fAxis === 'y' ? f.ly : f.lz), P, 20);
            const off = f.endOffset != null ? resolveNum(f.endOffset, P, bodySpan / 2 + projLen / 2 - 2) : (bodySpan / 2 + projLen / 2 - 2);
            for (const sgn of [-1, 1]) {
              const c = [center[0] + fDir[0] * sgn * off, center[1] + fDir[1] * sgn * off, center[2] + fDir[2] * sgn * off];
              body = body.fuse(makeOne(c));
            }
          } else {
            body = body.fuse(makeOne(center));
          }
        } else if (f.type === 'bore') {
          const d = Math.max(0.5, resolveNum(f.diameter, P, 20));
          const isThrough = f.through === true || f.length === 'through' || f.length == null;
          const len = isThrough ? (bodySpan + 80) : Math.max(0.5, resolveNum(f.length, P, bodySpan + 20));
          body = body.cut(centeredCylinder(d, len, fAxis, center));
        } else if (f.type === 'groove_ext') {
          const gd = Math.max(0.5, resolveNum(f.grooveDiameter ?? f.diameter, P, bodyOuterD * 0.8));
          const od = Math.max(gd + 4, resolveNum(f.outerDiameter, P, bodyOuterD + 20));
          const w = Math.max(0.5, resolveNum(f.width ?? f.length, P, 10));
          body = cutExternalGroove(body, { grooveDiameter: gd, outerDiameter: od, width: w, axis: fAxis, center });
        } else if (f.type === 'groove_int') {
          const gd = Math.max(0.5, resolveNum(f.grooveDiameter ?? f.diameter, P, 30));
          const w = Math.max(0.5, resolveNum(f.width ?? f.length, P, 5));
          body = cutInternalGroove(body, { grooveDiameter: gd, width: w, axis: fAxis, center });
        } else if (f.type === 'thread') {
          const nomD = Math.max(1, resolveNum(f.nominalDiameter ?? f.diameter, P, 20));
          const pitch = Math.max(0.3, resolveNum(f.pitch, P, 2));
          const len = Math.max(2, resolveNum(f.length, P, bodySpan + 6));
          const internal = f.internal !== false;
          const profile = f.profile === 'trapezoidal' || /^tr/i.test(String(f.norme || f.label || '')) ? 'trapezoidal' : 'metric';
          body = cutThread(body, { nominalDiameter: nomD, pitch, length: len, internal, axis: fAxis, center, profile });
        } else if (f.type === 'hole_pattern') {
          const count = Math.max(1, Math.round(resolveNum(f.count, P, 4)));
          const diameter = Math.max(0.5, resolveNum(f.diameter, P, 8));
          const pcd = Math.max(1, resolveNum(f.pcd, P, bodyOuterD * 0.65));
          const isThrough = f.through === true || f.depth === 'through' || f.depth == null;
          const depth = isThrough ? (bodySpan + 60) : Math.max(0.5, resolveNum(f.depth, P, bodySpan + 20));
          const startAngleDeg = resolveNum(f.startAngleDeg, P, 0);
          const angles = Array.isArray(f.angles) ? f.angles.map(a => resolveNum(a, P, 0)) : null;
          body = cutHolePattern(body, { count, diameter, pcd, depth, axis: fAxis, startAngleDeg, angles, center });
        } else if (f.type === 'hole') {
          const diameter = Math.max(0.5, resolveNum(f.diameter, P, 10));
          const isThrough = f.through === true || f.depth === 'through' || f.depth == null;
          const depth = isThrough ? (bodySpan + 60) : Math.max(0.5, resolveNum(f.depth, P, 30));
          const positions = Array.isArray(f.positions) && f.positions.length > 0
            ? f.positions.map(pt => resolveVec3(pt, P, [0, 0, 0]))
            : [center];
          const cyls = positions.map(pt => centeredCylinder(diameter, depth, fAxis, pt));
          body = body.cut(cyls.length === 1 ? cyls[0] : replicad.makeCompound(cyls));
        } else if (f.type === 'slot' || f.type === 'pocket' || f.type === 'flat' || f.type === 'keyway') {
          const lx = Math.max(0.5, resolveNum(f.lx ?? f.length, P, 20));
          const ly = Math.max(0.5, resolveNum(f.ly ?? f.width, P, 10));
          const lz = Math.max(0.5, resolveNum(f.lz ?? f.depth ?? f.height, P, 10));
          if (f.bothEnds) {
            const off = resolveNum(f.endOffset, P, bodySpan / 2);
            for (const sgn of [-1, 1]) {
              const c = [center[0] + fDir[0] * sgn * off, center[1] + fDir[1] * sgn * off, center[2] + fDir[2] * sgn * off];
              body = body.cut(centeredBox(lx, ly, lz, c));
            }
          } else {
            body = body.cut(centeredBox(lx, ly, lz, center));
          }
        } else if (f.type === 'pins' || f.type === 'inserts') {
          const count = Math.max(1, Math.round(resolveNum(f.count, P, 4)));
          const diameter = Math.max(0.5, resolveNum(f.diameter, P, 10));
          const pcd = Math.max(1, resolveNum(f.pcd, P, bodyOuterD * 0.65));
          const length = Math.max(1, resolveNum(f.length, P, bodySpan));
          const startAngleDeg = resolveNum(f.startAngleDeg, P, 0);
          const angles = Array.isArray(f.angles) ? f.angles.map(a => resolveNum(a, P, 0)) : null;
          if (f.cutHostHole !== false) {
            body = cutHolePattern(body, { count, diameter: diameter + 0.1, pcd, depth: length + 4, axis: fAxis, startAngleDeg, angles, center });
          }
          const pinSolid = addPinPattern({ count, diameter, pcd, length, axis: fAxis, startAngleDeg, angles, center });
          extraParts.push({
            name: f.name || f.label || 'Inserts / Goupilles',
            color: f.color || '#f1f5f9',
            opacity: 1,
            shape: pinSolid
          });
        } else if (f.type === 'chamfer') {
          const sz = Math.max(0.1, resolveNum(f.size ?? f.value, P, 1.5));
          body = safeChamfer(body, sz);
        } else if (f.type === 'fillet') {
          const rad = Math.max(0.1, resolveNum(f.radius ?? f.value, P, 2));
          body = safeFillet(body, rad);
        }

        // Before/After Volume Verification Guardrail (0 token!)
        const volAfter = safeMeasureVolume(body);
        const deltaMm3 = volAfter - volBefore;
        let status = 'ok';
        if (SUBTRACTIVE_TYPES.has(f.type)) {
          const removed = volBefore - volAfter;
          if (volBefore > 1 && removed < 0.5) {
            status = 'empty_cut';
            featureWarnings.push(`${featName} : usinage dans le vide (0 mm³ retiré — vérifiez position/diamètre)`);
          } else if (volBefore > 10 && removed > volBefore * 0.85) {
            status = 'excessive_cut';
            featureWarnings.push(`${featName} : découpe excessive (${Math.round((removed / volBefore) * 100)}% du solide retiré — risque de corps inversé)`);
          }
        } else if (ADDITIVE_TYPES.has(f.type)) {
          if (deltaMm3 < 0.5) {
            status = 'submerged_add';
            featureWarnings.push(`${featName} : ajout noyé dans la matière (0 mm³ ajouté — vérifiez position)`);
          }
        }
        featureLog.push({ id: f.id, label: featName, type: f.type, deltaCm3: Number((deltaMm3 / 1000).toFixed(3)), status });
      } catch (err) {
        featureWarnings.push(`${featName}: ${err?.message || 'ignoré'}`);
        featureLog.push({ id: f.id, label: featName, type: f.type, deltaCm3: 0, status: 'error' });
      }
    }

    return {
      parts: [{ name: bodyName, color: bodyColor, opacity: 1, shape: body }, ...extraParts],
      featureWarnings,
      featureLog
    };
  }

  function executeReplicadCode(code, paramsMap = {}, defaultName = 'Piece_CAO', defaultColor = '#94a3b8') {
    if (!code || !String(code).trim()) {
      throw new Error('Aucun code Replicad fourni.');
    }
    // Proxy replicad so BOTH `centeredCylinder(...)` AND `replicad.centeredCylinder(...)` work seamlessly!
    const customHelpers = {
      draw: safeDraw,
      centeredCylinder,
      centeredBox,
      centeredCone,
      revolveProfile,
      extrudePolygon,
      dShapeBody,
      cutExternalGroove,
      cutInternalGroove,
      cutHolePattern,
      addPinPattern,
      cutThread,
      safeFillet,
      safeChamfer
    };
    const replicadWithHelpers = new Proxy(replicad, {
      get(target, prop, receiver) {
        if (Object.prototype.hasOwnProperty.call(customHelpers, prop)) {
          return customHelpers[prop];
        }
        return Reflect.get(target, prop, receiver);
      },
      has(target, prop) {
        return Object.prototype.hasOwnProperty.call(customHelpers, prop) || prop in target;
      }
    });

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
      replicadWithHelpers,
      safeDraw, replicad.drawCircle, replicad.drawRectangle, replicad.drawRoundedRectangle, replicad.drawPolysides, replicad.drawEllipse,
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

  return {
    axisDir,
    safeMeasureVolume,
    centeredCylinder,
    centeredBox,
    centeredCone,
    revolveProfile,
    extrudePolygon,
    dShapeBody,
    cutExternalGroove,
    cutInternalGroove,
    cutHolePattern,
    addPinPattern,
    cutThread,
    safeFillet,
    safeChamfer,
    safeDraw,
    buildFromBlueprint,
    executeReplicadCode,
    buildLegacyFeaturesAsReplicad
  };
}
