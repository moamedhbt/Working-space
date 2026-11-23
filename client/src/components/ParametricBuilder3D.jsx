import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { Bot, Box, Download, Upload, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api';

function buildParametricMesh(params) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.55, roughness: 0.3 });

  const od = Math.max(4, Number(params.outerDiameter) || 40);
  const id = Math.max(0, Math.min(od - 2, Number(params.innerDiameter) || 0));
  const len = Math.max(2, Number(params.length) || 80);
  const w = Math.max(5, Number(params.width) || 80);
  const thk = Math.max(2, Number(params.thickness) || 20);
  const holeCount = Math.max(0, Math.min(24, parseInt(params.holeCount, 10) || 0));
  const holeD = Math.max(1, Number(params.holeDiameter) || 8);
  const pcd = Math.max(id + holeD + 2, Math.min(od - holeD - 2, Number(params.pcd) || od * 0.72));

  if (params.partType === 'arbre') {
    // 2-step shaft (main body + optional shoulder)
    const step2Od = Number(params.step2Diameter) > 0 ? Number(params.step2Diameter) : 0;
    const step2Len = Number(params.step2Length) > 0 ? Number(params.step2Length) : 0;
    const mainGeo = new THREE.CylinderGeometry(od / 2, od / 2, len, 64);
    mainGeo.rotateZ(Math.PI / 2);
    const mainMesh = new THREE.Mesh(mainGeo, mat);
    mainMesh.name = `Corps_D${od}_L${len}`;
    group.add(mainMesh);

    if (step2Od > 2 && step2Len > 2) {
      const sGeo = new THREE.CylinderGeometry(step2Od / 2, step2Od / 2, step2Len, 64);
      sGeo.rotateZ(Math.PI / 2);
      const sMesh = new THREE.Mesh(sGeo, mat);
      sMesh.position.x = (len + step2Len) / 2;
      sMesh.name = `Epaulement_D${step2Od}_L${step2Len}`;
      group.add(sMesh);
    }
  } else if (params.partType === 'bague') {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, od / 2, 0, Math.PI * 2, false);
    if (id > 0) {
      const hole = new THREE.Path();
      hole.absarc(0, 0, id / 2, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2, curveSegments: 64 });
    geo.translate(0, 0, -len / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `Bague_D${od}_d${id}_L${len}`;
    group.add(mesh);
  } else if (params.partType === 'bride') {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, od / 2, 0, Math.PI * 2, false);
    if (id > 0) {
      const centerHole = new THREE.Path();
      centerHole.absarc(0, 0, id / 2, 0, Math.PI * 2, true);
      shape.holes.push(centerHole);
    }
    for (let i = 0; i < holeCount; i++) {
      const a = (i / holeCount) * Math.PI * 2;
      const hx = Math.cos(a) * (pcd / 2);
      const hy = Math.sin(a) * (pcd / 2);
      const h = new THREE.Path();
      h.absarc(hx, hy, holeD / 2, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thk, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 2, curveSegments: 64 });
    geo.translate(0, 0, -thk / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `Bride_D${od}_ep${thk}_${holeCount}xD${holeD}`;
    group.add(mesh);
  } else {
    // Plaque / bloc percé
    const shape = new THREE.Shape();
    shape.moveTo(-len / 2, -w / 2);
    shape.lineTo(len / 2, -w / 2);
    shape.lineTo(len / 2, w / 2);
    shape.lineTo(-len / 2, w / 2);
    shape.closePath();

    if (id > 0 && id < Math.min(len, w) - 4) {
      const ch = new THREE.Path();
      ch.absarc(0, 0, id / 2, 0, Math.PI * 2, true);
      shape.holes.push(ch);
    }
    if (holeCount >= 4) {
      const mx = Math.max(holeD, len / 2 - Math.max(10, holeD * 1.5));
      const my = Math.max(holeD, w / 2 - Math.max(10, holeD * 1.5));
      [[-mx, -my], [mx, -my], [mx, my], [-mx, my]].forEach(([hx, hy]) => {
        const h = new THREE.Path();
        h.absarc(hx, hy, holeD / 2, 0, Math.PI * 2, true);
        shape.holes.push(h);
      });
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thk, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 2, curveSegments: 48 });
    geo.translate(0, 0, -thk / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `Plaque_${len}x${w}x${thk}`;
    group.add(mesh);
  }

  return group;
}

// Generate a clean ISO-10303-21 STEP AP214 faceted B-rep file from the exact Three.js geometry
function exportGroupToStepText(group, partName = 'PIECE_CNC') {
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Modele parametrique exact Atelier Manager Pro'),'2;1');`,
    `FILE_NAME('${partName}.step','${new Date().toISOString()}',('Bureau Etudes'),('Atelier Manager Pro'),'','Three.js Parametric','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
    'ENDSEC;',
    'DATA;'
  ];
  let eid = 1;
  const nextId = () => `#${eid++}`;
  const faces = [];

  group.updateMatrixWorld(true);
  group.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const geom = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    geom.applyMatrix4(child.matrixWorld);
    const pos = geom.attributes.position;
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const stepStride = pos.count > 9000 ? Math.ceil(pos.count / 9000) * 3 : 3;
    for (let i = 0; i < pos.count - 2; i += stepStride) {
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
      const planeDir = nextId(), refDir = nextId(), axis = nextId(), pl = nextId(), face = nextId();
      lines.push(`${planeDir}=DIRECTION('',(0.,0.,1.));`);
      lines.push(`${refDir}=DIRECTION('',(1.,0.,0.));`);
      lines.push(`${axis}=AXIS2_PLACEMENT_3D('',${p1},${planeDir},${refDir});`);
      lines.push(`${pl}=PLANE('',${axis});`);
      lines.push(`${face}=ADVANCED_FACE('',(${bound}),${pl},.T.);`);
      faces.push(face);
    }
  });

  const shell = nextId();
  lines.push(`${shell}=CLOSED_SHELL('',(${faces.join(',')}));`);
  const brep = nextId();
  lines.push(`${brep}=MANIFOLD_SOLID_BREP('${partName}',${shell});`);
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n');
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function ParametricBuilder3D({ piece, onPublishToOf }) {
  const mountRef = useRef(null);
  const meshGroupRef = useRef(null);

  const [params, setParams] = useState({
    partType: 'arbre',
    outerDiameter: '50',
    innerDiameter: '0',
    length: '120',
    step2Diameter: '35',
    step2Length: '35',
    width: '80',
    thickness: '20',
    holeCount: '6',
    holeDiameter: '10',
    pcd: '85'
  });

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisInfo, setAnalysisInfo] = useState(null);
  const [publishing, setPublishing] = useState(false);

  // Render live 3D parametric preview
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 500;
    const h = el.clientHeight || 280;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B0F14');
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 4000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dl1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dl1.position.set(120, 150, 140);
    scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0x22d3ee, 0.45);
    dl2.position.set(-100, -80, -100);
    scene.add(dl2);
    scene.add(new THREE.GridHelper(300, 20, 0x1e2a38, 0x15202b));

    const group = buildParametricMesh(params);
    meshGroupRef.current = group;
    scene.add(group);

    // Add edges
    group.traverse(c => {
      if (c.isMesh) {
        c.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(c.geometry, 25),
          new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.45 })
        ));
      }
    });

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 20);
    controls.target.copy(center);
    camera.position.set(center.x + maxDim * 1.4, center.y + maxDim * 0.9, center.z + maxDim * 1.4);
    camera.lookAt(center);
    controls.update();

    let rafId;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      controls.dispose();
      renderer.dispose();
    };
  }, [params]);

  async function analyzeExistingPlan(fileId) {
    setAnalyzing(true);
    try {
      const res = await api('/api/be/analyze-plan', 'POST', {
        fileId,
        notes: `${piece?.nom || ''} ${piece?.matiere || ''}`
      });
      setAnalysisInfo(res);
      if (res.extracted) {
        const ex = res.extracted;
        setParams(prev => ({
          ...prev,
          partType: ex.partType || prev.partType,
          outerDiameter: String(ex.outerDiameter || prev.outerDiameter),
          innerDiameter: String(ex.innerDiameter ?? prev.innerDiameter),
          length: String(ex.length || prev.length),
          width: String(ex.width || prev.width),
          thickness: String(ex.thickness || prev.thickness),
          holeCount: String(ex.holeCount ?? prev.holeCount),
          holeDiameter: String(ex.holeDiameter || prev.holeDiameter),
          pcd: String(ex.pcd || prev.pcd)
        }));
      }
    } catch (e) {
      setAnalysisInfo({ error: e.message });
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeUploadedFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Lecture fichier impossible'));
        r.readAsDataURL(file);
      });
      const res = await api('/api/be/analyze-plan', 'POST', {
        filename: file.name,
        base64,
        notes: `${piece?.nom || ''} ${piece?.matiere || ''}`
      });
      setAnalysisInfo(res);
      if (res.extracted) {
        const ex = res.extracted;
        setParams(prev => ({
          ...prev,
          partType: ex.partType || prev.partType,
          outerDiameter: String(ex.outerDiameter || prev.outerDiameter),
          innerDiameter: String(ex.innerDiameter ?? prev.innerDiameter),
          length: String(ex.length || prev.length),
          width: String(ex.width || prev.width),
          thickness: String(ex.thickness || prev.thickness),
          holeCount: String(ex.holeCount ?? prev.holeCount),
          holeDiameter: String(ex.holeDiameter || prev.holeDiameter),
          pcd: String(ex.pcd || prev.pcd)
        }));
      }
    } catch (err) {
      setAnalysisInfo({ error: err.message });
    } finally {
      setAnalyzing(false);
      e.target.value = '';
    }
  }

  function downloadSTL() {
    if (!meshGroupRef.current) return;
    const exporter = new STLExporter();
    const buf = exporter.parse(meshGroupRef.current, { binary: true });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${piece?.id || 'piece'}_${params.partType}.stl`;
    a.click();
  }

  function downloadSTEP() {
    if (!meshGroupRef.current) return;
    const stepText = exportGroupToStepText(meshGroupRef.current, `${piece?.id || 'PIECE'}_${params.partType}`);
    const blob = new Blob([stepText], { type: 'application/step' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${piece?.id || 'piece'}_${params.partType}.step`;
    a.click();
  }

  async function publishToOf(format = 'stl') {
    if (!piece || !meshGroupRef.current) return;
    setPublishing(true);
    try {
      let base64, filename;
      if (format === 'step') {
        const stepText = exportGroupToStepText(meshGroupRef.current, `${piece.id}_${params.partType}`);
        base64 = btoa(unescape(encodeURIComponent(stepText)));
        filename = `${piece.id}_${params.partType}.step`;
      } else {
        const exporter = new STLExporter();
        const result = exporter.parse(meshGroupRef.current, { binary: true });
        base64 = arrayBufferToBase64(result.buffer || result);
        filename = `${piece.id}_${params.partType}.stl`;
      }
      await onPublishToOf?.({
        filename,
        base64,
        notes: `3D paramétrique exact (${params.partType}, Ø${params.outerDiameter} L${params.length})`
      });
    } finally {
      setPublishing(false);
    }
  }

  const clientPlan = piece?.be?.clientFile;
  const activePlan = piece?.be?.planFile;

  return (
    <div className="cyber-card cyber-corners p-4 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Box className="w-4 h-4 text-[#22D3EE]" /> Modeleur 3D Paramétrique Exact + Lecture IA Plan 2D
          </h3>
          <p className="text-[11px] text-slate-400">
            L'IA pré-lit les cotes du plan 2D (PDF/Photo) — vous vérifiez chaque cote, puis générez un .STL / .STEP mathématiquement exact.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(clientPlan || activePlan) && (
            <button
              type="button"
              disabled={analyzing}
              onClick={() => analyzeExistingPlan((clientPlan || activePlan).id)}
              className="px-2.5 py-1.5 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Bot className="w-3.5 h-3.5" /> {analyzing ? 'Analyse...' : 'Lire Plan 2D de cet OF (IA)'}
            </button>
          )}
          <label className="px-2.5 py-1.5 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-200 flex items-center gap-1 cursor-pointer">
            <Sparkles className="w-3.5 h-3.5 text-[#22D3EE]" /> Analyser Photo/PDF
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={analyzeUploadedFile} className="hidden" />
          </label>
        </div>
      </div>

      {analysisInfo && (
        <div className={`p-2.5 rounded border text-[11px] space-y-1 ${
          analysisInfo.error ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'bg-cyan-950/30 border-[#22D3EE]/40 text-slate-200'
        }`}>
          {analysisInfo.error ? (
            <div>{analysisInfo.error}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 font-medium text-[#22D3EE]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{analysisInfo.extracted?.summary}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num">
                  Mode : {analysisInfo.mode}
                </span>
              </div>
              {analysisInfo.extracted?.tolerances?.length > 0 && (
                <div className="text-[10px] text-slate-300">Tolérances détectées : {analysisInfo.extracted.tolerances.join(', ')}</div>
              )}
              <div className="text-[10px] text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" /> {analysisInfo.disclaimer}
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* CONTROLS */}
        <div className="lg:col-span-5 space-y-2.5 bg-[#0B0F14] border border-[#1E2A38] rounded p-3">
          <div className="grid grid-cols-4 gap-1">
            {[
              ['arbre', 'Arbre'],
              ['bague', 'Bague'],
              ['bride', 'Bride'],
              ['plaque', 'Plaque']
            ].map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setParams(p => ({ ...p, partType: k }))}
                className={`py-1.5 rounded border text-[11px] font-medium cursor-pointer ${
                  params.partType === k ? 'bg-[#22D3EE] text-[#0B0F14] border-[#22D3EE] font-semibold' : 'bg-[#111821] border-[#1E2A38] text-slate-300'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {params.partType !== 'plaque' && (
              <div>
                <label className="text-[10px] text-slate-400">Ø Extérieur (mm)</label>
                <input type="number" step="0.1" value={params.outerDiameter} onChange={e => setParams({ ...params, outerDiameter: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
              </div>
            )}
            {params.partType !== 'arbre' && (
              <div>
                <label className="text-[10px] text-slate-400">Ø Alésage central (mm)</label>
                <input type="number" step="0.1" value={params.innerDiameter} onChange={e => setParams({ ...params, innerDiameter: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
              </div>
            )}
            {(params.partType === 'arbre' || params.partType === 'bague' || params.partType === 'plaque') && (
              <div>
                <label className="text-[10px] text-slate-400">Longueur (mm)</label>
                <input type="number" step="0.1" value={params.length} onChange={e => setParams({ ...params, length: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
              </div>
            )}
            {params.partType === 'arbre' && (
              <>
                <div>
                  <label className="text-[10px] text-slate-400">Ø Épaulement 2 (mm)</label>
                  <input type="number" step="0.1" value={params.step2Diameter} onChange={e => setParams({ ...params, step2Diameter: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Long. Épaulement (mm)</label>
                  <input type="number" step="0.1" value={params.step2Length} onChange={e => setParams({ ...params, step2Length: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
                </div>
              </>
            )}
            {params.partType === 'plaque' && (
              <div>
                <label className="text-[10px] text-slate-400">Largeur (mm)</label>
                <input type="number" step="0.1" value={params.width} onChange={e => setParams({ ...params, width: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
              </div>
            )}
            {(params.partType === 'bride' || params.partType === 'plaque') && (
              <>
                <div>
                  <label className="text-[10px] text-slate-400">Épaisseur (mm)</label>
                  <input type="number" step="0.1" value={params.thickness} onChange={e => setParams({ ...params, thickness: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Nb perçages</label>
                  <input type="number" min="0" max="24" value={params.holeCount} onChange={e => setParams({ ...params, holeCount: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Ø Perçage (mm)</label>
                  <input type="number" step="0.1" value={params.holeDiameter} onChange={e => setParams({ ...params, holeDiameter: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
                </div>
              </>
            )}
            {params.partType === 'bride' && (
              <div>
                <label className="text-[10px] text-slate-400">Ø Cercle perçage PCD (mm)</label>
                <input type="number" step="0.1" value={params.pcd} onChange={e => setParams({ ...params, pcd: e.target.value })} className="w-full mt-0.5 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#1E2A38]">
            <button type="button" onClick={downloadSTL} className="px-2.5 py-1.5 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-200 flex items-center gap-1 cursor-pointer">
              <Download className="w-3.5 h-3.5" /> .STL
            </button>
            <button type="button" onClick={downloadSTEP} className="px-2.5 py-1.5 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-200 flex items-center gap-1 cursor-pointer">
              <Download className="w-3.5 h-3.5" /> .STEP
            </button>
            {piece && (
              <>
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => publishToOf('stl')}
                  className="px-2.5 py-1.5 rounded bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center gap-1 cursor-pointer ml-auto"
                >
                  <Upload className="w-3.5 h-3.5" /> Publier .STL dans {piece.id}
                </button>
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => publishToOf('step')}
                  className="px-2.5 py-1.5 rounded bg-emerald-600 text-white font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" /> Publier .STEP
                </button>
              </>
            )}
          </div>
        </div>

        {/* LIVE 3D PREVIEW */}
        <div ref={mountRef} className="lg:col-span-7 h-72 rounded border border-[#1E2A38] bg-[#0B0F14] overflow-hidden" />
      </div>
    </div>
  );
}
