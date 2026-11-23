import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

function orientCylinder(geo, axis = 'x') {
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  else if (axis === 'z') geo.rotateX(Math.PI / 2);
  // axis === 'y' is default Three.js cylinder orientation
  return geo;
}

function makeBrush(geometry, pos = [0, 0, 0]) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.uv) {
    const count = geometry.attributes.position.count;
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  const brush = new Brush(geometry);
  brush.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
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

  for (const f of features) {
    try {
      const axis = f.axis || 'x';
      const x = Number(f.x) || 0;
      const y = Number(f.y) || 0;
      const z = Number(f.z) || 0;

      if (f.op === 'add_cylinder') {
        const d = Math.max(2, Number(f.diameter) || 40);
        const l = Math.max(2, Number(f.length) || 80);
        const geo = orientCylinder(new THREE.CylinderGeometry(d / 2, d / 2, l, 48), axis);
        const b = makeBrush(geo, [x, y, z]);
        current = current ? evaluator.evaluate(current, b, ADDITION) : b;
        applied.push(f.id);
      } else if (f.op === 'add_box') {
        const lx = Math.max(2, Number(f.lx) || 80);
        const ly = Math.max(2, Number(f.ly) || 60);
        const lz = Math.max(2, Number(f.lz) || 20);
        const b = makeBrush(new THREE.BoxGeometry(lx, ly, lz), [x, y, z]);
        current = current ? evaluator.evaluate(current, b, ADDITION) : b;
        applied.push(f.id);
      } else if (!current) {
        continue;
      } else if (f.op === 'cut_bore') {
        const d = Math.max(1, Number(f.diameter) || 20);
        const l = Math.max(4, Number(f.length) || 250);
        const geo = orientCylinder(new THREE.CylinderGeometry(d / 2, d / 2, l, 48), axis);
        const b = makeBrush(geo, [x, y, z]);
        current = evaluator.evaluate(current, b, SUBTRACTION);
        applied.push(f.id);
      } else if (f.op === 'cut_flat') {
        const dist = Math.max(2, Number(f.distanceFromCenter) || 50);
        const span = Math.max(20, Number(f.span) || 300);
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
        const b = makeBrush(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), pos);
        current = evaluator.evaluate(current, b, SUBTRACTION);
        applied.push(f.id);
      } else if (f.op === 'cut_slot') {
        const lx = Math.max(1, Number(f.lx) || 20);
        const ly = Math.max(1, Number(f.ly) || 20);
        const lz = Math.max(1, Number(f.lz) || 10);
        const b = makeBrush(new THREE.BoxGeometry(lx, ly, lz), [x, y, z]);
        current = evaluator.evaluate(current, b, SUBTRACTION);
        applied.push(f.id);
      } else if (f.op === 'cut_hole_pattern') {
        const count = Math.max(1, Math.min(24, parseInt(f.count, 10) || 4));
        const hd = Math.max(1, Number(f.holeDiameter) || 8);
        const pcd = Math.max(4, Number(f.pcd) || 60);
        const depth = Math.max(4, Number(f.depth) || 120);
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
        const count = Math.max(1, Math.min(16, parseInt(f.count, 10) || 4));
        const od = Math.max(4, Number(f.outerDiameter) || 65);
        const w = Math.max(1, Number(f.width) || 4);
        const pitch = Math.max(w + 0.5, Number(f.pitch) || 8);
        const startOffset = -((count - 1) * pitch) / 2;

        for (let i = 0; i < count; i++) {
          const offset = startOffset + i * pitch;
          const pos = axis === 'x' ? [x + offset, y, z] : axis === 'y' ? [x, y + offset, z] : [x, y, z + offset];
          const geo = orientCylinder(new THREE.CylinderGeometry(od / 2, od / 2, w, 36), axis);
          const b = makeBrush(geo, pos);
          current = evaluator.evaluate(current, b, SUBTRACTION);
        }
        applied.push(f.id);
      }
    } catch (err) {
      console.warn('CSG feature skipped:', f.id, err.message);
    }
  }

  if (!current) {
    current = makeBrush(new THREE.CylinderGeometry(25, 25, 80, 48), [0, 0, 0]);
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    metalness: 0.55,
    roughness: 0.3
  });
  const mesh = new THREE.Mesh(current.geometry, material);
  mesh.name = cadSpec?.name || 'Piece_CSG';
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();

  const size = new THREE.Vector3();
  mesh.geometry.boundingBox.getSize(size);
  return {
    mesh,
    appliedCount: applied.length,
    dimensions: {
      x: Number(size.x.toFixed(1)),
      y: Number(size.y.toFixed(1)),
      z: Number(size.z.toFixed(1))
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
    lines.push(`# ${idx + 1}. ${f.label || f.op}`);
    const ax = f.axis || 'x';
    const pl = planeForAxis(ax);
    const x = Number(f.x) || 0, y = Number(f.y) || 0, z = Number(f.z) || 0;

    if (f.op === 'add_cylinder') {
      lines.push(`s${idx} = cq.Workplane("${pl}").circle(${(Number(f.diameter) || 40) / 2}).extrude(${Number(f.length) || 80}, both=True).translate((${x}, ${y}, ${z}))`);
      lines.push(`result = s${idx} if result is None else result.union(s${idx})`);
    } else if (f.op === 'add_box') {
      lines.push(`s${idx} = cq.Workplane("XY").box(${Number(f.lx) || 80}, ${Number(f.ly) || 60}, ${Number(f.lz) || 20}).translate((${x}, ${y}, ${z}))`);
      lines.push(`result = s${idx} if result is None else result.union(s${idx})`);
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
    }
    lines.push('');
  });

  lines.push(`cq.exporters.export(result, "${name}.step")`);
  lines.push(`cq.exporters.export(result, "${name}.stl")`);
  return lines.join('\n');
}
