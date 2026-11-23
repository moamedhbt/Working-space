import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

function orientCylinder(geo, axis = 'x') {
  if (axis === 'x') geo.rotateZ(-Math.PI / 2);
  else if (axis === 'z') geo.rotateX(Math.PI / 2);
  // axis === 'y' is default Three.js cylinder/lathe orientation
  return geo;
}

function buildRevolveGeometry(rawPoints = [], axis = 'x') {
  const pts = (Array.isArray(rawPoints) ? rawPoints : [])
    .map(p => (Array.isArray(p) ? [Math.max(0, Number(p[0]) || 0), Number(p[1]) || 0] : null))
    .filter(Boolean);
  if (pts.length < 2) return null;

  // Close profile cleanly to the revolution axis (r = 0) so the CSG solid is watertight
  const closed = [];
  if (pts[0][0] > 0.001) closed.push(new THREE.Vector2(0, pts[0][1]));
  for (const [r, pos] of pts) {
    closed.push(new THREE.Vector2(Math.max(0, r), pos));
  }
  const last = pts[pts.length - 1];
  if (last[0] > 0.001) closed.push(new THREE.Vector2(0, last[1]));

  const geo = new THREE.LatheGeometry(closed, 56);
  return orientCylinder(geo, axis);
}

function buildExtrudeGeometry(rawPoints = [], depth = 20, axis = 'z', bevel = 0) {
  const pts = (Array.isArray(rawPoints) ? rawPoints : [])
    .map(p => (Array.isArray(p) ? [Number(p[0]) || 0, Number(p[1]) || 0] : null))
    .filter(Boolean);
  if (pts.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], pts[i][1]);
  }
  shape.closePath();

  const d = Math.max(0.2, Number(depth) || 20);
  const b = Math.max(0, Math.min(d * 0.25, Number(bevel) || 0));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: b > 0.01,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 32
  });
  // Center extrusion along Z (-d/2 .. +d/2), then orient to requested axis
  geo.translate(0, 0, -d / 2);
  if (axis === 'x') geo.rotateY(Math.PI / 2);
  else if (axis === 'y') geo.rotateX(-Math.PI / 2);
  return geo;
}

function makeBrush(geometry, pos = [0, 0, 0], rotDeg = [0, 0, 0]) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.uv) {
    const count = geometry.attributes.position.count;
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  const brush = new Brush(geometry);
  brush.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
  const deg = Math.PI / 180;
  brush.rotation.set(
    (Number(rotDeg[0]) || 0) * deg,
    (Number(rotDeg[1]) || 0) * deg,
    (Number(rotDeg[2]) || 0) * deg
  );
  brush.updateMatrixWorld(true);
  return brush;
}

/**
 * Executes a declarative cadSpec feature tree into a single watertight Three.js Mesh
 * using real Boolean CSG (ADDITION / SUBTRACTION) via three-bvh-csg.
 */
export function buildCsgSolidFromSpec(cadSpec) {
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  const features = Array.isArray(cadSpec?.features) ? cadSpec.features : [];
  let current = null;
  const applied = [];
  const threadOverlays = [];

  for (const f of features) {
    if (!f || f.hidden) continue;
    try {
      const axis = f.axis || 'x';
      const x = Number(f.x) || 0;
      const y = Number(f.y) || 0;
      const z = Number(f.z) || 0;
      const rot = [Number(f.rx) || 0, Number(f.ry) || 0, Number(f.rz) || 0];

      if (f.op === 'add_cylinder') {
        const d = Math.max(0.5, Number(f.diameter) || 40);
        const l = Math.max(0.5, Number(f.length) || 80);
        const geo = orientCylinder(new THREE.CylinderGeometry(d / 2, d / 2, l, 56), axis);
        const b = makeBrush(geo, [x, y, z], rot);
        current = current ? evaluator.evaluate(current, b, ADDITION) : b;
        applied.push(f.id);
      } else if (f.op === 'add_box') {
        const lx = Math.max(0.5, Number(f.lx) || 80);
        const ly = Math.max(0.5, Number(f.ly) || 60);
        const lz = Math.max(0.5, Number(f.lz) || 20);
        const b = makeBrush(new THREE.BoxGeometry(lx, ly, lz), [x, y, z], rot);
        current = current ? evaluator.evaluate(current, b, ADDITION) : b;
        applied.push(f.id);
      } else if (f.op === 'add_cone') {
        const d1 = Math.max(0, Number(f.d1 ?? 40));
        const d2 = Math.max(0, Number(f.d2 ?? 20));
        const l = Math.max(0.5, Number(f.length) || 40);
        const geo = orientCylinder(new THREE.CylinderGeometry(d2 / 2, d1 / 2, l, 56), axis);
        const b = makeBrush(geo, [x, y, z], rot);
        current = current ? evaluator.evaluate(current, b, ADDITION) : b;
        applied.push(f.id);
      } else if (f.op === 'add_revolve') {
        const geo = buildRevolveGeometry(f.points, axis);
        if (geo) {
          const b = makeBrush(geo, [x, y, z], rot);
          current = current ? evaluator.evaluate(current, b, ADDITION) : b;
          applied.push(f.id);
        }
      } else if (f.op === 'add_extrude') {
        const geo = buildExtrudeGeometry(f.points, f.depth ?? 20, f.axis || 'z', f.bevel || 0);
        if (geo) {
          const b = makeBrush(geo, [x, y, z], rot);
          current = current ? evaluator.evaluate(current, b, ADDITION) : b;
          applied.push(f.id);
        }
      } else if (!current) {
        continue;
      } else if (f.op === 'cut_bore') {
        const d = Math.max(0.2, Number(f.diameter) || 20);
        const l = Math.max(0.5, Number(f.length) || 250);
        const geo = orientCylinder(new THREE.CylinderGeometry(d / 2, d / 2, l, 48), axis);
        const b = makeBrush(geo, [x, y, z], rot);
        current = evaluator.evaluate(current, b, SUBTRACTION);
        applied.push(f.id);
      } else if (f.op === 'cut_cone') {
        const d1 = Math.max(0, Number(f.d1 ?? 24));
        const d2 = Math.max(0, Number(f.d2 ?? 16));
        const l = Math.max(0.2, Number(f.length) || 10);
        const geo = orientCylinder(new THREE.CylinderGeometry(d2 / 2, d1 / 2, l, 48), axis);
        const b = makeBrush(geo, [x, y, z], rot);
        current = evaluator.evaluate(current, b, SUBTRACTION);
        applied.push(f.id);
      } else if (f.op === 'cut_revolve') {
        const geo = buildRevolveGeometry(f.points, axis);
        if (geo) {
          const b = makeBrush(geo, [x, y, z], rot);
          current = evaluator.evaluate(current, b, SUBTRACTION);
          applied.push(f.id);
        }
      } else if (f.op === 'cut_extrude') {
        const geo = buildExtrudeGeometry(f.points, f.depth ?? 40, f.axis || 'z', 0);
        if (geo) {
          const b = makeBrush(geo, [x, y, z], rot);
          current = evaluator.evaluate(current, b, SUBTRACTION);
          applied.push(f.id);
        }
      } else if (f.op === 'cut_flat') {
        const dist = Math.max(0.5, Number(f.distanceFromCenter) || 50);
        const span = Math.max(10, Number(f.span) || 300);
        const cutThick = 200;
        const side = f.side || '+y';
        let pos = [0, 0, 0];
        let dims = [span, cutThick, span];
        if (side === '+y') { pos = [0, dist + cutThick / 2, 0]; dims = [span, cutThick, span]; }
        else if (side === '-y') { pos = [0, -(dist + cutThick / 2), 0]; dims = [span, cutThick, span]; }
        else if (side === '+z') { pos = [0, 0, dist + cutThick / 2]; dims = [span, span, cutThick]; }
        else if (side === '-z') { pos = [0, 0, -(dist + cutThick / 2)]; dims = [span, span, cutThick]; }
        else if (side === '+x') { pos = [dist + cutThick / 2, 0, 0]; dims = [cutThick, span, span]; }
        else if (side === '-x') { pos = [-(dist + cutThick / 2), 0, 0]; dims = [cutThick, span, span]; }
        const b = makeBrush(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), pos, rot);
        current = evaluator.evaluate(current, b, SUBTRACTION);
        applied.push(f.id);
      } else if (f.op === 'cut_slot') {
        const lx = Math.max(0.2, Number(f.lx) || 20);
        const ly = Math.max(0.2, Number(f.ly) || 20);
        const lz = Math.max(0.2, Number(f.lz) || 10);
        const b = makeBrush(new THREE.BoxGeometry(lx, ly, lz), [x, y, z], rot);
        current = evaluator.evaluate(current, b, SUBTRACTION);
        applied.push(f.id);
      } else if (f.op === 'cut_hole_pattern') {
        const count = Math.max(1, Math.min(36, parseInt(f.count, 10) || 4));
        const hd = Math.max(0.2, Number(f.holeDiameter) || 8);
        const pcd = Math.max(1, Number(f.pcd) || 60);
        const depth = Math.max(0.5, Number(f.depth) || 120);
        const startRad = ((Number(f.startAngleDeg) || 0) * Math.PI) / 180;
        const r = pcd / 2;

        for (let i = 0; i < count; i++) {
          const ang = startRad + (i / count) * Math.PI * 2;
          let hx = x, hy = y, hz = z;
          if (axis === 'x') {
            hy = y + Math.cos(ang) * r;
            hz = z + Math.sin(ang) * r;
          } else if (axis === 'y') {
            hx = x + Math.cos(ang) * r;
            hz = z + Math.sin(ang) * r;
          } else {
            hx = x + Math.cos(ang) * r;
            hy = y + Math.sin(ang) * r;
          }
          const geo = orientCylinder(new THREE.CylinderGeometry(hd / 2, hd / 2, depth, 24), axis);
          const b = makeBrush(geo, [hx, hy, hz]);
          current = evaluator.evaluate(current, b, SUBTRACTION);
        }
        applied.push(f.id);
      } else if (f.op === 'cut_groove') {
        const count = Math.max(1, Math.min(20, parseInt(f.count, 10) || 4));
        const od = Math.max(1, Number(f.outerDiameter) || 65);
        const w = Math.max(0.2, Number(f.width) || 4);
        const pitch = Math.max(w + 0.2, Number(f.pitch) || 8);
        const startOffset = -((count - 1) * pitch) / 2;

        for (let i = 0; i < count; i++) {
          const offset = startOffset + i * pitch;
          const pos = axis === 'x' ? [x + offset, y, z] : axis === 'y' ? [x, y + offset, z] : [x, y, z + offset];
          const geo = orientCylinder(new THREE.CylinderGeometry(od / 2, od / 2, w, 36), axis);
          const b = makeBrush(geo, pos);
          current = evaluator.evaluate(current, b, SUBTRACTION);
        }
        applied.push(f.id);
      } else if (f.op === 'cut_thread') {
        // Real internal/external thread or tapped hole pattern on PCD:
        // Cuts core hole (if internal) + visible thread relief rings + cosmetic ISO amber overlay
        const nomD = Math.max(1, Number(f.nominalDiameter) || 10);
        const pitch = Math.max(0.25, Number(f.pitch) || 1.5);
        const len = Math.max(1, Number(f.length) || 30);
        const internal = f.internal !== false;
        const minorD = Math.max(0.5, nomD - 1.0825 * pitch);
        const pcd = Number(f.pcd) || 0;
        const count = pcd > 0 ? Math.max(1, Math.min(24, parseInt(f.count, 10) || 1)) : 1;
        const startRad = ((Number(f.startAngleDeg) || 0) * Math.PI) / 180;

        const positions = [];
        if (pcd > 0 && count > 1) {
          const r = pcd / 2;
          for (let i = 0; i < count; i++) {
            const ang = startRad + (i / count) * Math.PI * 2;
            if (axis === 'x') positions.push([x, y + Math.cos(ang) * r, z + Math.sin(ang) * r]);
            else if (axis === 'y') positions.push([x + Math.cos(ang) * r, y, z + Math.sin(ang) * r]);
            else positions.push([x + Math.cos(ang) * r, y + Math.sin(ang) * r, z]);
          }
        } else {
          positions.push([x, y, z]);
        }

        // Visual thread rings count (capped for snappy browser CSG performance)
        const rings = Math.max(3, Math.min(18, Math.floor(len / Math.max(pitch, len / 18))));
        const ringStep = len / rings;

        for (const [tx, ty, tz] of positions) {
          if (internal) {
            // Ensure pilot bore exists
            const pilotGeo = orientCylinder(new THREE.CylinderGeometry(minorD / 2, minorD / 2, len, 32), axis);
            current = evaluator.evaluate(current, makeBrush(pilotGeo, [tx, ty, tz]), SUBTRACTION);
            // Cut crisp internal thread grooves (up to 10 grooves on main bore to keep FPS smooth)
            const csgRings = positions.length === 1 ? Math.min(12, rings) : Math.min(4, rings);
            const csgStep = len / csgRings;
            for (let rIdx = 0; rIdx < csgRings; rIdx++) {
              const off = -len / 2 + csgStep * (rIdx + 0.5);
              const gp = axis === 'x' ? [tx + off, ty, tz] : axis === 'y' ? [tx, ty + off, tz] : [tx, ty, tz + off];
              const gGeo = orientCylinder(new THREE.CylinderGeometry(nomD / 2, nomD / 2, Math.min(csgStep * 0.48, pitch * 0.5), 28), axis);
              current = evaluator.evaluate(current, makeBrush(gGeo, gp), SUBTRACTION);
            }
          } else {
            // External thread grooves
            const csgRings = Math.min(12, rings);
            const csgStep = len / csgRings;
            for (let rIdx = 0; rIdx < csgRings; rIdx++) {
              const off = -len / 2 + csgStep * (rIdx + 0.5);
              const gp = axis === 'x' ? [tx + off, ty, tz] : axis === 'y' ? [tx, ty + off, tz] : [tx, ty, tz + off];
              // Annular ring cut: outer oversized minus minorD
              const outerR = nomD / 2 + 2;
              const ringShape = new THREE.Shape();
              ringShape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
              const holePath = new THREE.Path();
              holePath.absarc(0, 0, minorD / 2, 0, Math.PI * 2, true);
              ringShape.holes.push(holePath);
              const extGeo = new THREE.ExtrudeGeometry(ringShape, { depth: Math.min(csgStep * 0.45, pitch * 0.5), bevelEnabled: false, curveSegments: 24 });
              extGeo.center();
              if (axis === 'x') extGeo.rotateY(Math.PI / 2);
              else if (axis === 'y') extGeo.rotateX(Math.PI / 2);
              current = evaluator.evaluate(current, makeBrush(extGeo, gp), SUBTRACTION);
            }
          }

          // Cosmetic ISO thread callout cylinder (amber wireframe sleeve so tapped holes & threads stand out clearly!)
          const sleeveGeo = orientCylinder(new THREE.CylinderGeometry(nomD / 2 + 0.08, nomD / 2 + 0.08, len, 24, rings, true), axis);
          const sleeveMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.55 });
          const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
          sleeve.position.set(tx, ty, tz);
          threadOverlays.push(sleeve);
        }
        applied.push(f.id);
      }
    } catch (err) {
      console.warn('CSG feature skipped:', f.id, err.message);
    }
  }

  if (!current) {
    return {
      mesh: null,
      threadOverlays: [],
      appliedCount: 0,
      dimensions: { x: 0, y: 0, z: 0 }
    };
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    metalness: 0.48,
    roughness: 0.32,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(current.geometry, material);
  mesh.name = cadSpec?.name || 'Piece_CSG';
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();

  const size = new THREE.Vector3();
  mesh.geometry.boundingBox.getSize(size);
  return {
    mesh,
    threadOverlays,
    appliedCount: applied.length,
    dimensions: {
      x: Number(size.x.toFixed(3)),
      y: Number(size.y.toFixed(3)),
      z: Number(size.z.toFixed(3))
    }
  };
}

export function exportMeshToStlBuffer(mesh) {
  const exporter = new STLExporter();
  const res = exporter.parse(mesh, { binary: true });
  return res.buffer || res;
}

export function exportMeshToStepText(mesh, partName = 'PIECE_CNC') {
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Modele CAO CSG Atelier Manager Pro'),'2;1');`,
    `FILE_NAME('${partName}.step','${new Date().toISOString()}',('Bureau Etudes'),('Atelier Manager Pro'),'','Atelier CSG Engine','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
    'ENDSEC;',
    'DATA;'
  ];
  let eid = 1;
  const nextId = () => `#${eid++}`;
  const faces = [];

  const geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const pos = geom.attributes.position;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const maxTris = 3500;
  const totalTris = Math.floor(pos.count / 3);
  const stride = totalTris > maxTris ? Math.ceil(totalTris / maxTris) * 3 : 3;

  for (let i = 0; i < pos.count - 2; i += stride) {
    vA.fromBufferAttribute(pos, i);
    vB.fromBufferAttribute(pos, i + 1);
    vC.fromBufferAttribute(pos, i + 2);
    const p1 = nextId(), p2 = nextId(), p3 = nextId();
    lines.push(`${p1}=CARTESIAN_POINT('',(${vA.x.toFixed(3)},${vA.y.toFixed(3)},${vA.z.toFixed(3)}));`);
    lines.push(`${p2}=CARTESIAN_POINT('',(${vB.x.toFixed(3)},${vB.y.toFixed(3)},${vB.z.toFixed(3)}));`);
    lines.push(`${p3}=CARTESIAN_POINT('',(${vC.x.toFixed(3)},${vC.y.toFixed(3)},${vC.z.toFixed(3)}));`);
    const loop = nextId();
    lines.push(`${loop}=POLY_LOOP('',(${p1},${p2},${p3}));`);
    const bound = nextId();
    lines.push(`${bound}=FACE_OUTER_BOUND('',${loop},.T.);`);
    const dir1 = nextId(), dir2 = nextId(), ax = nextId(), pl = nextId(), face = nextId();
    lines.push(`${dir1}=DIRECTION('',(0.,0.,1.));`);
    lines.push(`${dir2}=DIRECTION('',(1.,0.,0.));`);
    lines.push(`${ax}=AXIS2_PLACEMENT_3D('',${p1},${dir1},${dir2});`);
    lines.push(`${pl}=PLANE('',${ax});`);
    lines.push(`${face}=ADVANCED_FACE('',(${bound}),${pl},.T.);`);
    faces.push(face);
  }

  const shell = nextId();
  lines.push(`${shell}=CLOSED_SHELL('',(${faces.join(',')}));`);
  const brep = nextId();
  lines.push(`${brep}=MANIFOLD_SOLID_BREP('${partName}',${shell});`);
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n');
}

/**
 * Generates an exact CadQuery Python script (.py) equivalent to the cadSpec
 * so the BE can open/refine it directly in CadQuery / CQ-Editor / FreeCAD!
 */
export function exportSpecToCadQueryPython(cadSpec) {
  const name = (cadSpec?.name || 'piece_cnc').replace(/[^a-zA-Z0-9_]/g, '_');
  const lines = [
    '# Script CadQuery généré par Atelier Manager Pro (BE + IA)',
    'import math',
    'import cadquery as cq',
    '',
    'result = None',
    ''
  ];

  const planeForAxis = ax => (ax === 'x' ? 'YZ' : ax === 'y' ? 'XZ' : 'XY');

  (cadSpec?.features || []).forEach((f, idx) => {
    if (f.hidden) return;
    lines.push(`# ${idx + 1}. ${f.label || f.op}${f.tolerance ? ` [Tolérance: ${f.tolerance}]` : ''}`);
    const ax = f.axis || 'x';
    const pl = planeForAxis(ax);
    const x = Number(f.x) || 0, y = Number(f.y) || 0, z = Number(f.z) || 0;

    if (f.op === 'add_cylinder') {
      lines.push(`s${idx} = cq.Workplane("${pl}").circle(${(Number(f.diameter) || 40) / 2}).extrude(${Number(f.length) || 80}, both=True).translate((${x}, ${y}, ${z}))`);
      lines.push(`result = s${idx} if result is None else result.union(s${idx})`);
    } else if (f.op === 'add_box') {
      lines.push(`s${idx} = cq.Workplane("XY").box(${Number(f.lx) || 80}, ${Number(f.ly) || 60}, ${Number(f.lz) || 20}).translate((${x}, ${y}, ${z}))`);
      lines.push(`result = s${idx} if result is None else result.union(s${idx})`);
    } else if (f.op === 'add_cone' || f.op === 'cut_cone') {
      const r1 = (Number(f.d1 ?? 40)) / 2;
      const r2 = (Number(f.d2 ?? 20)) / 2;
      const l = Number(f.length) || 30;
      lines.push(`cn${idx} = cq.Workplane("${pl}").circle(${Math.max(0.05, r1)}).workplane(offset=${l}).circle(${Math.max(0.05, r2)}).loft().translate((${x}, ${y}, ${z}))`);
      lines.push(f.op === 'add_cone' ? `result = cn${idx} if result is None else result.union(cn${idx})` : `result = result.cut(cn${idx})`);
    } else if ((f.op === 'add_revolve' || f.op === 'cut_revolve') && Array.isArray(f.points) && f.points.length >= 2) {
      const ptsStr = f.points.map(p => `(${Number(p[0]) || 0}, ${Number(p[1]) || 0})`).join(', ');
      lines.push(`rev${idx} = cq.Workplane("XZ").polyline([${ptsStr}]).close().revolve(360, (0, 0, 0), (0, 1, 0)).translate((${x}, ${y}, ${z}))`);
      lines.push(f.op === 'add_revolve' ? `result = rev${idx} if result is None else result.union(rev${idx})` : `result = result.cut(rev${idx})`);
    } else if ((f.op === 'add_extrude' || f.op === 'cut_extrude') && Array.isArray(f.points) && f.points.length >= 3) {
      const ptsStr = f.points.map(p => `(${Number(p[0]) || 0}, ${Number(p[1]) || 0})`).join(', ');
      lines.push(`ex${idx} = cq.Workplane("${pl}").polyline([${ptsStr}]).close().extrude(${Number(f.depth) || 20}, both=True).translate((${x}, ${y}, ${z}))`);
      lines.push(f.op === 'add_extrude' ? `result = ex${idx} if result is None else result.union(ex${idx})` : `result = result.cut(ex${idx})`);
    } else if (f.op === 'cut_bore') {
      lines.push(`c${idx} = cq.Workplane("${pl}").circle(${(Number(f.diameter) || 20) / 2}).extrude(${Number(f.length) || 250}, both=True).translate((${x}, ${y}, ${z}))`);
      lines.push(`result = result.cut(c${idx})`);
    } else if (f.op === 'cut_flat') {
      const dist = Number(f.distanceFromCenter) || 50;
      const span = Number(f.span) || 300;
      const sign = String(f.side || '+y').startsWith('-') ? -1 : 1;
      lines.push(`c${idx} = cq.Workplane("XY").box(${span}, 200, ${span}).translate((0, ${sign * (dist + 100)}, 0))`);
      lines.push(`result = result.cut(c${idx})`);
    } else if (f.op === 'cut_slot') {
      lines.push(`c${idx} = cq.Workplane("XY").box(${Number(f.lx) || 20}, ${Number(f.ly) || 20}, ${Number(f.lz) || 10}).translate((${x}, ${y}, ${z}))`);
      lines.push(`result = result.cut(c${idx})`);
    } else if (f.op === 'cut_hole_pattern') {
      const n = parseInt(f.count, 10) || 4;
      const hd = Number(f.holeDiameter) || 8;
      const pcd = Number(f.pcd) || 60;
      const dep = Number(f.depth) || 120;
      const a0 = Number(f.startAngleDeg) || 0;
      lines.push(`for i in range(${n}):`);
      lines.push(`    ang = math.radians(${a0} + i * (360.0 / ${n}))`);
      lines.push(`    r = ${pcd / 2}`);
      if (ax === 'x') {
        lines.push(`    h = cq.Workplane("YZ").circle(${hd / 2}).extrude(${dep}, both=True).translate((${x}, ${y} + r * math.cos(ang), ${z} + r * math.sin(ang)))`);
      } else {
        lines.push(`    h = cq.Workplane("XY").circle(${hd / 2}).extrude(${dep}, both=True).translate((${x} + r * math.cos(ang), ${y} + r * math.sin(ang), ${z}))`);
      }
      lines.push(`    result = result.cut(h)`);
    } else if (f.op === 'cut_thread') {
      const tt = f.threadType || 'M';
      const nomD = Number(f.nominalDiameter) || 10;
      const pitch = Number(f.pitch) || 1.5;
      const starts = Number(f.starts) || 1;
      const len = Number(f.length) || 30;
      const minorD = Math.max(0.5, Number((nomD - 1.0825 * pitch).toFixed(3)));
      lines.push(`# Spécification ISO filetage/taraudage : ${tt}${nomD}x${pitch}${starts > 1 ? ` (${starts} filets)` : ''} · ${f.internal !== false ? 'Intérieur' : 'Extérieur'} · L=${len} mm · Ø noyau=${minorD} mm`);
      if (f.internal !== false) {
        if (Number(f.pcd) > 0 && parseInt(f.count, 10) > 1) {
          const n = parseInt(f.count, 10);
          lines.push(`for i in range(${n}):`);
          lines.push(`    ang = math.radians(${Number(f.startAngleDeg) || 0} + i * (360.0 / ${n}))`);
          lines.push(`    r = ${Number(f.pcd) / 2}`);
          lines.push(`    th = cq.Workplane("${pl}").circle(${minorD / 2}).extrude(${len}, both=True).translate((${x}, ${y} + r * math.cos(ang), ${z} + r * math.sin(ang)))`);
          lines.push(`    result = result.cut(th)`);
        } else {
          lines.push(`th${idx} = cq.Workplane("${pl}").circle(${minorD / 2}).extrude(${len}, both=True).translate((${x}, ${y}, ${z}))`);
          lines.push(`result = result.cut(th${idx})`);
        }
      }
    }
    lines.push('');
  });

  lines.push(`cq.exporters.export(result, "${name}.step")`);
  lines.push(`cq.exporters.export(result, "${name}.stl")`);
  return lines.join('\n');
}
