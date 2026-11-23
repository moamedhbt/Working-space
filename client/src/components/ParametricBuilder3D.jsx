import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Box, Download, Upload, Sparkles, CheckCircle2, FileCode,
  Send, Trash2, ClipboardList, Layers, Eye, EyeOff, Plus, Copy,
  RotateCcw, Scissors, Grid3X3, Compass, AlertCircle, ChevronDown, ChevronRight, Save
} from 'lucide-react';
import { api } from '../api';
import {
  buildCsgSolidFromSpec,
  exportMeshToStlBuffer,
  exportMeshToStepText,
  exportSpecToCadQueryPython
} from '../utils/cadCsgEngine';

const OP_LABELS = {
  add_cylinder: { name: 'Cylindre / Brut', kind: 'add' },
  add_box: { name: 'Bloc / Parallélépipède', kind: 'add' },
  cut_bore: { name: 'Alésage', kind: 'cut' },
  cut_hole_pattern: { name: 'Perçages (Cercle PCD)', kind: 'cut' },
  cut_thread: { name: 'Filetage / Taraudage', kind: 'cut' },
  cut_flat: { name: 'Méplat', kind: 'cut' },
  cut_slot: { name: 'Rainure / Clavette', kind: 'cut' },
  cut_groove: { name: 'Gorge', kind: 'cut' }
};

const TOOL_LIBRARY = [
  {
    op: 'add_cylinder',
    short: '+ Cylindre',
    kind: 'add',
    factory: () => ({ label: 'Cylindre', op: 'add_cylinder', axis: 'x', diameter: 50, length: 100, x: 0, y: 0, z: 0, tolerance: '' })
  },
  {
    op: 'add_box',
    short: '+ Bloc',
    kind: 'add',
    factory: () => ({ label: 'Bloc', op: 'add_box', lx: 100, ly: 60, lz: 20, x: 0, y: 0, z: 0, tolerance: '' })
  },
  {
    op: 'cut_bore',
    short: '− Alésage',
    kind: 'cut',
    factory: () => ({ label: 'Alésage', op: 'cut_bore', axis: 'x', diameter: 20, length: 120, x: 0, y: 0, z: 0, tolerance: 'H7' })
  },
  {
    op: 'cut_hole_pattern',
    short: '− Perçages',
    kind: 'cut',
    factory: () => ({ label: 'Perçages', op: 'cut_hole_pattern', axis: 'x', count: 4, holeDiameter: 8, pcd: 36, depth: 120, startAngleDeg: 0, x: 0, y: 0, z: 0, tolerance: '' })
  },
  {
    op: 'cut_thread',
    short: '− Filetage',
    kind: 'cut',
    factory: () => ({ label: 'Taraudage / Filetage', op: 'cut_thread', threadType: 'M', nominalDiameter: 10, pitch: 1.5, starts: 1, length: 25, axis: 'x', internal: true, x: 0, y: 0, z: 0, pcd: 0, count: 1, startAngleDeg: 0, tolerance: '6H' })
  },
  {
    op: 'cut_flat',
    short: '− Méplat',
    kind: 'cut',
    factory: () => ({ label: 'Méplat', op: 'cut_flat', side: '+y', distanceFromCenter: 20, span: 120, tolerance: '' })
  },
  {
    op: 'cut_slot',
    short: '− Rainure',
    kind: 'cut',
    factory: () => ({ label: 'Rainure', op: 'cut_slot', lx: 20, ly: 60, lz: 8, x: 0, y: 0, z: 22, tolerance: '' })
  },
  {
    op: 'cut_groove',
    short: '− Gorge',
    kind: 'cut',
    factory: () => ({ label: 'Gorge', op: 'cut_groove', axis: 'x', outerDiameter: 30, innerDiameter: 24, width: 3, pitch: 6, count: 1, x: 0, y: 0, z: 0, tolerance: '' })
  }
];

function emptySpecForPiece(piece) {
  return {
    unit: 'mm',
    name: piece ? `${piece.id}_${(piece.nom || 'Piece').replace(/[^a-zA-Z0-9_-]/g, '_')}` : 'Piece_BE',
    features: []
  };
}

function fmtMm(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : '0.000';
}

function featureSummary(f) {
  if (!f) return '';
  if (f.op === 'add_cylinder') return `Ø${fmtMm(f.diameter)} × L${fmtMm(f.length)} (axe ${(f.axis || 'x').toUpperCase()})`;
  if (f.op === 'add_box') return `${fmtMm(f.lx)} × ${fmtMm(f.ly)} × ${fmtMm(f.lz)} mm`;
  if (f.op === 'cut_bore') return `Ø${fmtMm(f.diameter)} × L${fmtMm(f.length)} (axe ${(f.axis || 'x').toUpperCase()})`;
  if (f.op === 'cut_flat') return `Côté ${f.side || '+y'} · d=${fmtMm(f.distanceFromCenter)} mm`;
  if (f.op === 'cut_slot') return `${fmtMm(f.lx)} × ${fmtMm(f.ly)} × ${fmtMm(f.lz)} mm`;
  if (f.op === 'cut_hole_pattern') return `${f.count}× Ø${fmtMm(f.holeDiameter)} · PCD ${fmtMm(f.pcd)} · ${f.startAngleDeg || 0}°`;
  if (f.op === 'cut_groove') return `${f.count || 1}× Ø${fmtMm(f.outerDiameter)} · l=${fmtMm(f.width)} · pas ${fmtMm(f.pitch)}`;
  if (f.op === 'cut_thread') {
    const base = `${f.threadType || 'M'}${f.nominalDiameter}×${f.pitch}${Number(f.starts) > 1 ? ` (${f.starts} filets)` : ''}`;
    const where = Number(f.pcd) > 0 && Number(f.count) > 1 ? ` · ${f.count}× sur PCD ${fmtMm(f.pcd)}` : '';
    return `${base} · ${f.internal !== false ? 'Intérieur' : 'Extérieur'} · L${fmtMm(f.length)}${where}`;
  }
  return '';
}

function NumField({ label, value, onChange, step = '0.001', min }) {
  return (
    <div>
      <label className="text-[10px] text-slate-400 block mb-0.5">{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        value={value ?? ''}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '' || raw === '-') onChange(raw);
          else {
            const num = parseFloat(raw);
            if (Number.isFinite(num)) onChange(num);
          }
        }}
        className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] focus:border-[#22D3EE] focus:outline-none text-white text-[11px] font-mono-num"
      />
    </div>
  );
}

export default function ParametricBuilder3D({ piece, onPublishToOf, onReload }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const rendererRef = useRef(null);
  const rootGroupRef = useRef(null);
  const solidMeshRef = useRef(null);
  const gridRef = useRef(null);
  const axesRef = useRef(null);
  const clipPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, -1), 0));
  const saveTimerRef = useRef(null);
  const skipNextSaveRef = useRef(true);

  const [cadSpec, setCadSpec] = useState(() => piece?.cadSpec || emptySpecForPiece(piece));
  const [fiche, setFiche] = useState(() => piece?.ficheTechnique || null);
  const [chatMessages, setChatMessages] = useState(() => (Array.isArray(piece?.beChat) ? piece.beChat : []));
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);

  const [dims, setDims] = useState({ x: 0, y: 0, z: 0 });
  const [displayMode, setDisplayMode] = useState('shaded_edges'); // shaded | shaded_edges | wireframe | transparent | section
  const [showAxes, setShowAxes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [activeView, setActiveView] = useState('iso');

  const [uploadedPlan, setUploadedPlan] = useState(null); // { filename, base64, fileId }
  const [analyzing, setAnalyzing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [refining, setRefining] = useState(false);
  const [chatError, setChatError] = useState('');

  const [validatedByBe, setValidatedByBe] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [applyingFiche, setApplyingFiche] = useState(false);
  const [savingStudio, setSavingStudio] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // POINT 5: Immediately switch & load per-OF 3D state when active OF changes!
  useEffect(() => {
    skipNextSaveRef.current = true;
    setCadSpec(piece?.cadSpec || emptySpecForPiece(piece));
    setFiche(piece?.ficheTechnique || null);
    setChatMessages(Array.isArray(piece?.beChat) ? piece.beChat : []);
    setSelectedFeatureId(null);
    setUploadedPlan(null);
    setValidatedByBe(false);
    setChatError('');
    setErrorMsg('');
    setStatusMsg('');
  }, [piece?.id]);

  // Auto-save per-OF studio state to SQLite (debounced)
  useEffect(() => {
    if (!piece?.id) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        setSavingStudio(true);
        await api(`/api/pieces/${piece.id}/be-studio`, 'PUT', {
          cadSpec,
          ficheTechnique: fiche,
          beChat: chatMessages
        });
      } catch {
        // Silent background save failure
      } finally {
        setSavingStudio(false);
      }
    }, 650);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [piece?.id, cadSpec, fiche, chatMessages]);

  // Initialize Three.js viewport once
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const width = el.clientWidth || 560;
    const height = el.clientHeight || 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d14');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 10000);
    camera.position.set(170, 125, 190);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    el.innerHTML = '';
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dl1 = new THREE.DirectionalLight(0xffffff, 0.95);
    dl1.position.set(160, 220, 140);
    scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0x38bdf8, 0.45);
    dl2.position.set(-160, -100, -140);
    scene.add(dl2);

    const grid = new THREE.GridHelper(320, 32, 0x1e293b, 0x0f172a);
    grid.position.y = -65;
    scene.add(grid);
    gridRef.current = grid;

    const axes = new THREE.AxesHelper(90);
    scene.add(axes);
    axesRef.current = axes;

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroupRef.current = rootGroup;

    let rafId;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!el) return;
      const w = el.clientWidth || 560;
      const h = el.clientHeight || 380;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Toggle grid / axes helpers
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showGrid, showAxes]);

  // Fit camera to current solid bounding sphere for any standard CAD view
  function setCameraView(viewName) {
    setActiveView(viewName);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    let center = new THREE.Vector3(0, 0, 0);
    let radius = 85;
    if (solidMeshRef.current?.geometry) {
      solidMeshRef.current.geometry.computeBoundingSphere();
      const bs = solidMeshRef.current.geometry.boundingSphere;
      if (bs && bs.radius > 0) {
        center.copy(bs.center);
        radius = Math.max(15, bs.radius);
      }
    }
    const dist = radius * 2.55;
    const dirs = {
      iso: new THREE.Vector3(1, 0.78, 1).normalize(),
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      top: new THREE.Vector3(0, 1, 0.001).normalize(),
      bottom: new THREE.Vector3(0, -1, 0.001).normalize(),
      right: new THREE.Vector3(1, 0, 0),
      left: new THREE.Vector3(-1, 0, 0)
    };
    const dir = dirs[viewName] || dirs.iso;
    camera.position.copy(center).addScaledVector(dir, dist);
    controls.target.copy(center);
    controls.update();
  }

  // Rebuild CSG solid & display mode whenever cadSpec or displayMode changes
  useEffect(() => {
    const group = rootGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const ch = group.children[0];
      group.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) {
        if (Array.isArray(ch.material)) ch.material.forEach(m => m.dispose());
        else ch.material.dispose();
      }
    }

    const { mesh, threadOverlays, dimensions } = buildCsgSolidFromSpec(cadSpec);
    setDims(dimensions);

    if (!mesh) {
      solidMeshRef.current = null;
      return;
    }

    const isWire = displayMode === 'wireframe';
    const isTrans = displayMode === 'transparent';
    const isEdges = displayMode === 'shaded_edges' || displayMode === 'transparent' || displayMode === 'section';
    const isSection = displayMode === 'section';

    mesh.material.wireframe = isWire;
    mesh.material.transparent = isTrans;
    mesh.material.opacity = isTrans ? 0.38 : 1;
    mesh.material.depthWrite = !isTrans;
    mesh.material.clippingPlanes = isSection ? [clipPlaneRef.current] : [];
    mesh.material.needsUpdate = true;

    group.add(mesh);
    solidMeshRef.current = mesh;

    // Crisp CAD crease edges overlay
    if (isEdges && !isWire) {
      const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 24);
      const edgesMat = new THREE.LineBasicMaterial({
        color: isTrans ? 0x7dd3fc : 0x0f172a,
        transparent: true,
        opacity: isTrans ? 0.85 : 0.65,
        clippingPlanes: isSection ? [clipPlaneRef.current] : []
      });
      group.add(new THREE.LineSegments(edgesGeo, edgesMat));
    }

    // Visual ISO thread sleeves
    for (const ov of (threadOverlays || [])) {
      ov.material.clippingPlanes = isSection ? [clipPlaneRef.current] : [];
      group.add(ov);
    }

    // Reposition grid neatly under part
    if (gridRef.current && mesh.geometry.boundingBox) {
      gridRef.current.position.y = mesh.geometry.boundingBox.min.y - 5;
    }
  }, [cadSpec, displayMode]);

  async function runPlanAnalysis({ fileId = null, filename = '', base64 = null }) {
    setAnalyzing(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await api('/api/be/analyze-plan', 'POST', {
        fileId,
        filename,
        base64,
        notes: piece ? `${piece.nom} ${piece.matiere || ''} ${piece.notesQualite || ''}` : ''
      });
      if (res.ficheTechnique) setFiche(res.ficheTechnique);
      if (res.cadSpec) {
        setCadSpec(res.cadSpec);
        setValidatedByBe(false);
        setTimeout(() => setCameraView('iso'), 80);
      }
      setStatusMsg(`Analyse terminée (${res.mode}) — vérifiez la Fiche Technique et le modèle 3D.`);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handlePlanUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setUploadedPlan({ filename: file.name, base64, fileId: null });
      await runPlanAnalysis({ filename: file.name, base64 });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      e.target.value = '';
    }
  }

  async function analyzeExistingClientPlan() {
    const cf = piece?.be?.clientFile || piece?.be?.planFile;
    if (!cf) return;
    setUploadedPlan({ filename: cf.filename, base64: null, fileId: cf.id });
    await runPlanAnalysis({ fileId: cf.id, filename: cf.filename });
  }

  async function handleAiChatSubmit(e) {
    e?.preventDefault();
    const text = aiPrompt.trim();
    if (!text) return;
    setRefining(true);
    setChatError('');
    const nextUserMsg = { role: 'user', text, ts: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) };
    const updatedHistory = [...chatMessages, nextUserMsg];
    setChatMessages(updatedHistory);
    setAiPrompt('');

    try {
      const res = await api('/api/be/refine-3d', 'POST', {
        pieceId: piece?.id || null,
        fileId: uploadedPlan?.fileId || null,
        filename: uploadedPlan?.filename || piece?.be?.clientFile?.filename || 'plan.png',
        base64: uploadedPlan?.base64 || null,
        cadSpec,
        ficheTechnique: fiche,
        history: updatedHistory,
        prompt: text
      });
      if (res.modified && res.cadSpec) {
        setCadSpec(res.cadSpec);
        setValidatedByBe(false);
      }
      setChatMessages(prev => [
        ...prev,
        {
          role: 'ai',
          text: res.reply || res.changesSummary || 'Bien reçu.',
          modified: Boolean(res.modified),
          mode: res.mode,
          model: res.model || '',
          ts: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (err) {
      setChatError(err.message);
    } finally {
      setRefining(false);
    }
  }

  // Manual CAD tool operations
  function addToolFeature(tool) {
    const id = `f_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const feat = { id, ...tool.factory(), hidden: false };
    setCadSpec(prev => ({
      ...prev,
      features: [...(prev.features || []), feat]
    }));
    setSelectedFeatureId(id);
    setValidatedByBe(false);
  }

  function updateFeature(id, patch) {
    setCadSpec(prev => ({
      ...prev,
      features: (prev.features || []).map(f => (f.id === id ? { ...f, ...patch } : f))
    }));
    setValidatedByBe(false);
  }

  function duplicateFeature(f) {
    const id = `f_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const copy = { ...f, id, label: `${f.label} (copie)` };
    setCadSpec(prev => ({
      ...prev,
      features: [...(prev.features || []), copy]
    }));
    setSelectedFeatureId(id);
    setValidatedByBe(false);
  }

  function removeFeature(id) {
    setCadSpec(prev => ({
      ...prev,
      features: (prev.features || []).filter(f => f.id !== id)
    }));
    if (selectedFeatureId === id) setSelectedFeatureId(null);
    setValidatedByBe(false);
  }

  async function applyFicheToOf(replaceOperations = false) {
    if (!piece || !fiche) return;
    setApplyingFiche(true);
    setErrorMsg('');
    try {
      await api(`/api/pieces/${piece.id}/apply-fiche-ia`, 'POST', { ficheTechnique: fiche, replaceOperations });
      setStatusMsg(replaceOperations
        ? `Fiche technique + gamme d'opérations appliquées à ${piece.id}.`
        : `Matière et tolérances appliquées à ${piece.id}.`);
      if (onReload) onReload();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setApplyingFiche(false);
    }
  }

  function downloadFile(format) {
    if (!validatedByBe) {
      setErrorMsg("Cochez d'abord la case de validation ingénieur BE.");
      return;
    }
    if (!solidMeshRef.current && format !== 'cadquery') {
      setErrorMsg('Le modèle 3D est vide. Ajoutez au moins un volume.');
      return;
    }
    const baseName = (piece?.id || cadSpec.name || 'Piece_BE').replace(/[^a-zA-Z0-9_-]/g, '_');
    let blob;
    let ext;
    if (format === 'stl') {
      blob = new Blob([exportMeshToStlBuffer(solidMeshRef.current)], { type: 'application/octet-stream' });
      ext = 'stl';
    } else if (format === 'step') {
      blob = new Blob([exportMeshToStepText(solidMeshRef.current, baseName)], { type: 'application/step' });
      ext = 'step';
    } else {
      blob = new Blob([exportSpecToCadQueryPython(cadSpec)], { type: 'text/x-python' });
      ext = 'py';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName}.${ext}`;
    a.click();
  }

  async function publishToOf(format = 'stl') {
    if (!piece || !onPublishToOf) return;
    if (!validatedByBe) {
      setErrorMsg("Validation ingénieur BE obligatoire avant publication sur l'OF.");
      return;
    }
    if (!solidMeshRef.current) {
      setErrorMsg('Le modèle 3D est vide.');
      return;
    }
    setPublishing(true);
    setErrorMsg('');
    try {
      let base64, filename;
      if (format === 'step') {
        const stepText = exportMeshToStepText(solidMeshRef.current, piece.id);
        base64 = 'data:application/step;base64,' + btoa(unescape(encodeURIComponent(stepText)));
        filename = `${piece.id}_BE_valide.step`;
      } else {
        const stlBuf = exportMeshToStlBuffer(solidMeshRef.current);
        const bytes = new Uint8Array(stlBuf);
        let bin = '';
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        base64 = 'data:application/octet-stream;base64,' + btoa(bin);
        filename = `${piece.id}_BE_valide.stl`;
      }
      await onPublishToOf(piece.id, filename, base64, `Modèle 3D validé BE (${dims.x.toFixed(3)}×${dims.y.toFixed(3)}×${dims.z.toFixed(3)} mm)`);
      setStatusMsg(`${filename} publié dans l'OF ${piece.id}.`);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setPublishing(false);
    }
  }

  const hasFeatures = (cadSpec?.features || []).length > 0;
  const existingPlanFile = piece?.be?.clientFile || piece?.be?.planFile || null;

  return (
    <div className="cyber-card p-4 space-y-4">
      {/* HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1E2A38]">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Box className="w-4 h-4 text-[#22D3EE]" />
            Studio CAO 3D & Assistant BE
            {piece && (
              <span className="px-2 py-0.5 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] text-[11px] font-mono-num">
                {piece.id} · {piece.nom}
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-400">
            Modélisation 3D liée à l'OF actif · Édition manuelle au 0.001 mm · Discussion IA BE · Exports .STL / .STEP / CadQuery .py
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {piece && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Save className="w-3 h-3 text-emerald-400" />
              {savingStudio ? 'Sauvegarde...' : `Lié à ${piece.id}`}
            </span>
          )}
          {existingPlanFile && (
            <button
              type="button"
              disabled={analyzing}
              onClick={analyzeExistingClientPlan}
              className="px-3 py-1.5 rounded-[6px] bg-sky-600/20 border border-sky-500/40 hover:border-sky-400 text-sky-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {analyzing ? 'Analyse...' : `Analyser le plan de ${piece.id}`}
            </button>
          )}
          <label className="px-3 py-1.5 rounded-[6px] bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            {analyzing ? 'Analyse en cours...' : 'Importer Plan 2D (Photo / PDF)'}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handlePlanUpload} className="hidden" />
          </label>
        </div>
      </div>

      {statusMsg && (
        <div className="p-2.5 rounded-[6px] bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-2.5 rounded-[6px] bg-red-500/10 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {errorMsg}
        </div>
      )}

      {/* FICHE TECHNIQUE EXTRAITE DU PLAN 2D */}
      {fiche && (
        <div className="p-3.5 rounded-[6px] bg-[#0B0F14] border border-purple-500/40 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" /> Fiche Technique extraite
            </div>
            {piece && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={applyingFiche}
                  onClick={() => applyFicheToOf(false)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] cursor-pointer"
                >
                  Appliquer Matière & Tolérances
                </button>
                <button
                  type="button"
                  disabled={applyingFiche}
                  onClick={() => applyFicheToOf(true)}
                  className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold cursor-pointer"
                >
                  + Appliquer la Gamme à {piece.id}
                </button>
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2 rounded bg-[#111821] border border-[#1E2A38]">
              <span className="text-slate-500 block">Pièce / Réf</span>
              <strong className="text-white">{fiche.partName || '—'}</strong>
              {fiche.reference && <div className="text-slate-400 font-mono-num">{fiche.reference} {fiche.revision}</div>}
            </div>
            <div className="p-2 rounded bg-[#111821] border border-[#1E2A38]">
              <span className="text-slate-500 block">Matière & Débit brut</span>
              <strong className="text-[#22D3EE]">{fiche.material || 'À préciser'}</strong>
              <div className="text-slate-400">{fiche.rawStock || ''}</div>
            </div>
            <div className="p-2 rounded bg-[#111821] border border-[#1E2A38]">
              <span className="text-slate-500 block">Tolérances critiques</span>
              <div className="text-amber-300 font-mono-num">
                {fiche.criticalTolerances?.length ? fiche.criticalTolerances.join(' · ') : 'Générales ISO 2768-m'}
              </div>
            </div>
            <div className="p-2 rounded bg-[#111821] border border-[#1E2A38]">
              <span className="text-slate-500 block">Notes & Spécifications</span>
              <div className="text-slate-300">
                {fiche.specialNotes?.length ? fiche.specialNotes.join(' · ') : fiche.summary}
              </div>
            </div>
          </div>

          {fiche.suggestedOperations?.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Gamme d'usinage suggérée :</div>
              <div className="flex flex-wrap gap-1.5">
                {fiche.suggestedOperations.map((op, i) => (
                  <span key={i} className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] text-[11px] text-slate-200">
                    <strong className="text-[#22D3EE]">Op {(i + 1) * 10}</strong> · {op.libelle} ({op.tempsReglageMin}m + {op.tempsUnitaireMin}m/pce)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MAIN STUDIO GRID: PRO 3D VIEWPORT (LEFT) + AI CHAT & MANUAL INSPECTOR (RIGHT) */}
      <div className="grid lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN (7 cols): PRO CAD VIEWPORT + CAMERA/DISPLAY CONTROLS */}
        <div className="lg:col-span-7 space-y-2.5">
          {/* POINT 4: PRO CAD CAMERA VIEWS & DISPLAY MODES TOOLBAR */}
          <div className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-2">
            {/* Row 1: Camera positions */}
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-1 flex items-center gap-1">
                <Compass className="w-3 h-3" /> Vue :
              </span>
              {[
                ['iso', 'Iso'],
                ['front', 'Face'],
                ['back', 'Arrière'],
                ['top', 'Dessus'],
                ['bottom', 'Dessous'],
                ['right', 'Droite'],
                ['left', 'Gauche']
              ].map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCameraView(id)}
                  className={`px-2 py-1 rounded transition cursor-pointer ${
                    activeView === id
                      ? 'bg-[#22D3EE]/15 text-[#22D3EE] border border-[#22D3EE]/40 font-semibold'
                      : 'bg-[#111821] text-slate-300 border border-[#1E2A38] hover:border-slate-500'
                  }`}
                >
                  {lbl}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCameraView(activeView)}
                className="ml-auto px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 flex items-center gap-1 cursor-pointer"
                title="Recadrer sur la pièce"
              >
                <RotateCcw className="w-3 h-3" /> Recadrer
              </button>
            </div>

            {/* Row 2: Render / Display modes & Helpers */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] pt-1 border-t border-[#1E2A38]/70">
              <div className="flex flex-wrap items-center gap-1">
                {[
                  ['shaded', 'Ombré'],
                  ['shaded_edges', 'Ombré + Arêtes'],
                  ['wireframe', 'Fil de fer'],
                  ['transparent', 'Transparent'],
                  ['section', 'Coupe']
                ].map(([modeId, lbl]) => (
                  <button
                    key={modeId}
                    type="button"
                    onClick={() => setDisplayMode(modeId)}
                    className={`px-2 py-1 rounded transition flex items-center gap-1 cursor-pointer ${
                      displayMode === modeId
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/50 font-semibold'
                        : 'bg-[#111821] text-slate-400 border border-[#1E2A38] hover:text-slate-200'
                    }`}
                  >
                    {modeId === 'section' && <Scissors className="w-3 h-3" />}
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowAxes(v => !v)}
                  className={`px-2 py-1 rounded border text-[10px] cursor-pointer ${showAxes ? 'bg-slate-800 border-slate-500 text-white' : 'bg-[#111821] border-[#1E2A38] text-slate-500'}`}
                >
                  Axes XYZ
                </button>
                <button
                  type="button"
                  onClick={() => setShowGrid(v => !v)}
                  className={`px-2 py-1 rounded border text-[10px] flex items-center gap-1 cursor-pointer ${showGrid ? 'bg-slate-800 border-slate-500 text-white' : 'bg-[#111821] border-[#1E2A38] text-slate-500'}`}
                >
                  <Grid3X3 className="w-3 h-3" /> Grille
                </button>
              </div>
            </div>
          </div>

          {/* 3D CANVAS */}
          <div className="relative rounded-[6px] overflow-hidden border border-[#1E2A38] bg-[#090d14]">
            <div ref={mountRef} className="w-full h-[380px]" />

            {!hasFeatures && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d14]/70 pointer-events-none text-center p-6">
                <Box className="w-8 h-8 text-slate-600 mb-2" />
                <div className="text-xs font-semibold text-slate-300">
                  Scène 3D vierge {piece ? `pour ${piece.id}` : ''}
                </div>
                <div className="text-[11px] text-slate-500 max-w-sm mt-1">
                  Importez un plan 2D, discutez avec l'IA à droite ou ajoutez un volume avec la bibliothèque d'outils CAO.
                </div>
              </div>
            )}

            <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-[#0B0F14]/90 border border-[#1E2A38] text-[10px] text-slate-300 font-mono-num">
              Encombrement : <strong className="text-[#22D3EE]">X {dims.x.toFixed(3)}</strong> × <strong className="text-[#22D3EE]">Y {dims.y.toFixed(3)}</strong> × <strong className="text-[#22D3EE]">Z {dims.z.toFixed(3)} mm</strong>
            </div>
            <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-[#0B0F14]/90 border border-[#1E2A38] text-[10px] text-slate-400">
              Précision : 0.001 mm
            </div>
          </div>

          {/* POINT 2: MANUAL CAD INSPECTOR & NEUTRAL TOOL LIBRARY (0.001 mm precision) */}
          <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#22D3EE]" />
                Éditeur manuel des cotes & opérations ({cadSpec.features?.length || 0})
              </div>
              <span className="text-[10px] text-slate-400">Cliquez une ligne pour modifier au 0.001 mm</span>
            </div>

            {/* Neutral CAD Tool Library Bar */}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {TOOL_LIBRARY.map(tool => (
                <button
                  key={tool.op}
                  type="button"
                  onClick={() => addToolFeature(tool)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition cursor-pointer ${
                    tool.kind === 'add'
                      ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/20'
                      : 'bg-amber-500/10 border-amber-500/35 text-amber-300 hover:bg-amber-500/20'
                  }`}
                >
                  {tool.short}
                </button>
              ))}
            </div>

            {/* Editable Feature List */}
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {(cadSpec.features || []).length === 0 ? (
                <div className="text-[11px] text-slate-500 py-3 text-center">
                  Aucune opération CAO définie. Ajoutez un volume ci-dessus ou demandez à l'IA.
                </div>
              ) : (cadSpec.features || []).map((f, idx) => {
                const meta = OP_LABELS[f.op] || { name: f.op, kind: 'cut' };
                const isSelected = selectedFeatureId === f.id;
                return (
                  <div
                    key={f.id || idx}
                    className={`rounded border transition ${
                      isSelected
                        ? 'bg-[#111821] border-[#22D3EE]/50'
                        : 'bg-[#111821]/60 border-[#1E2A38] hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setSelectedFeatureId(isSelected ? null : f.id)}
                        className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        {isSelected ? <ChevronDown className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                        <span className={`font-bold shrink-0 ${meta.kind === 'add' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {meta.kind === 'add' ? '+' : '−'}
                        </span>
                        <div className="min-w-0">
                          <div className={`font-medium truncate ${f.hidden ? 'line-through text-slate-500' : 'text-slate-100'}`}>
                            {f.label || meta.name}
                            <span className="ml-1.5 text-[10px] font-normal text-slate-400">({meta.name})</span>
                            {f.tolerance && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[9px] font-mono-num">
                                {f.tolerance}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono-num truncate">{featureSummary(f)}</div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateFeature(f.id, { hidden: !f.hidden })}
                          className="p-1 text-slate-400 hover:text-white cursor-pointer"
                          title={f.hidden ? 'Afficher' : 'Masquer'}
                        >
                          {f.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateFeature(f)}
                          className="p-1 text-slate-400 hover:text-[#22D3EE] cursor-pointer"
                          title="Dupliquer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFeature(f.id)}
                          className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* EXPANDED MANUAL DIMENSION EDITOR (0.001 mm step!) */}
                    {isSelected && (
                      <div className="px-2.5 pb-3 pt-2 border-t border-[#1E2A38] space-y-2 text-[11px]">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="col-span-2 sm:col-span-2">
                            <label className="text-[10px] text-slate-400 block mb-0.5">Désignation</label>
                            <input
                              value={f.label || ''}
                              onChange={e => updateFeature(f.id, { label: e.target.value })}
                              className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Tolérance (ex: ±0.003, H7)</label>
                            <input
                              value={f.tolerance || ''}
                              onChange={e => updateFeature(f.id, { tolerance: e.target.value })}
                              placeholder="±0.003 / H7"
                              className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-amber-300 text-[11px] font-mono-num"
                            />
                          </div>
                        </div>

                        {/* Specific fields per operation type */}
                        {(f.op === 'add_cylinder' || f.op === 'cut_bore') && (
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            <NumField label="Diamètre (mm)" value={f.diameter} min={0.1} onChange={v => updateFeature(f.id, { diameter: v })} />
                            <NumField label="Longueur (mm)" value={f.length} min={0.1} onChange={v => updateFeature(f.id, { length: v })} />
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Axe</label>
                              <select value={f.axis || 'x'} onChange={e => updateFeature(f.id, { axis: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
                              </select>
                            </div>
                            <NumField label="Pos X (mm)" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                            <NumField label="Pos Y (mm)" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                            <NumField label="Pos Z (mm)" value={f.z ?? 0} onChange={v => updateFeature(f.id, { z: v })} />
                          </div>
                        )}

                        {(f.op === 'add_box' || f.op === 'cut_slot') && (
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            <NumField label="Long. X (mm)" value={f.lx} min={0.1} onChange={v => updateFeature(f.id, { lx: v })} />
                            <NumField label="Larg. Y (mm)" value={f.ly} min={0.1} onChange={v => updateFeature(f.id, { ly: v })} />
                            <NumField label="Haut. Z (mm)" value={f.lz} min={0.1} onChange={v => updateFeature(f.id, { lz: v })} />
                            <NumField label="Pos X (mm)" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                            <NumField label="Pos Y (mm)" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                            <NumField label="Pos Z (mm)" value={f.z ?? 0} onChange={v => updateFeature(f.id, { z: v })} />
                          </div>
                        )}

                        {f.op === 'cut_flat' && (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Face coupée</label>
                              <select value={f.side || '+y'} onChange={e => updateFeature(f.id, { side: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="+y">+Y (Haut)</option><option value="-y">-Y (Bas)</option>
                                <option value="+z">+Z (Avant)</option><option value="-z">-Z (Arrière)</option>
                                <option value="+x">+X (Droite)</option><option value="-x">-X (Gauche)</option>
                              </select>
                            </div>
                            <NumField label="Distance centre (mm)" value={f.distanceFromCenter} min={0.1} onChange={v => updateFeature(f.id, { distanceFromCenter: v })} />
                            <NumField label="Portée (mm)" value={f.span} min={1} onChange={v => updateFeature(f.id, { span: v })} />
                          </div>
                        )}

                        {f.op === 'cut_hole_pattern' && (
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            <NumField label="Nb trous" value={f.count} step="1" min={1} onChange={v => updateFeature(f.id, { count: v })} />
                            <NumField label="Ø trou (mm)" value={f.holeDiameter} min={0.1} onChange={v => updateFeature(f.id, { holeDiameter: v })} />
                            <NumField label="Ø PCD (mm)" value={f.pcd} min={0.5} onChange={v => updateFeature(f.id, { pcd: v })} />
                            <NumField label="Profondeur (mm)" value={f.depth} min={0.5} onChange={v => updateFeature(f.id, { depth: v })} />
                            <NumField label="Angle départ (°)" value={f.startAngleDeg ?? 0} step="0.1" onChange={v => updateFeature(f.id, { startAngleDeg: v })} />
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Axe</label>
                              <select value={f.axis || 'x'} onChange={e => updateFeature(f.id, { axis: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
                              </select>
                            </div>
                            <NumField label="Pos X (mm)" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                            <NumField label="Pos Y (mm)" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                          </div>
                        )}

                        {f.op === 'cut_groove' && (
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            <NumField label="Ø ext. (mm)" value={f.outerDiameter} min={0.5} onChange={v => updateFeature(f.id, { outerDiameter: v })} />
                            <NumField label="Largeur (mm)" value={f.width} min={0.1} onChange={v => updateFeature(f.id, { width: v })} />
                            <NumField label="Pas (mm)" value={f.pitch} min={0.2} onChange={v => updateFeature(f.id, { pitch: v })} />
                            <NumField label="Nb gorges" value={f.count ?? 1} step="1" min={1} onChange={v => updateFeature(f.id, { count: v })} />
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Axe</label>
                              <select value={f.axis || 'x'} onChange={e => updateFeature(f.id, { axis: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
                              </select>
                            </div>
                            <NumField label="Pos X (mm)" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                          </div>
                        )}

                        {f.op === 'cut_thread' && (
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Type</label>
                              <select value={f.threadType || 'M'} onChange={e => updateFeature(f.id, { threadType: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="M">M (Métrique ISO)</option>
                                <option value="Tr">Tr (Trapézoïdal)</option>
                                <option value="G">G (Gaz BSP)</option>
                                <option value="UNC">UNC / UNF</option>
                              </select>
                            </div>
                            <NumField label="Ø nominal (mm)" value={f.nominalDiameter} min={1} onChange={v => updateFeature(f.id, { nominalDiameter: v })} />
                            <NumField label="Pas (mm)" value={f.pitch} min={0.2} onChange={v => updateFeature(f.id, { pitch: v })} />
                            <NumField label="Longueur (mm)" value={f.length} min={1} onChange={v => updateFeature(f.id, { length: v })} />
                            <NumField label="Nb filets" value={f.starts ?? 1} step="1" min={1} onChange={v => updateFeature(f.id, { starts: v })} />
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Sens / Type</label>
                              <select value={f.internal !== false ? 'int' : 'ext'} onChange={e => updateFeature(f.id, { internal: e.target.value === 'int' })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="int">Taraudage (Intérieur)</option>
                                <option value="ext">Filetage (Extérieur)</option>
                              </select>
                            </div>
                            <NumField label="Ø PCD (0=centre)" value={f.pcd ?? 0} min={0} onChange={v => updateFeature(f.id, { pcd: v })} />
                            <NumField label="Nb trous taraudés" value={f.count ?? 1} step="1" min={1} onChange={v => updateFeature(f.id, { count: v })} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols): CLEAN AI BE DISCUSSION + MANDATORY VALIDATION & EXPORTS */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* POINTS 1 & 3: PURE CONVERSATIONAL AI ENGINEER CHAT (ZERO FAKE SUGGESTIONS) */}
          <div className="p-3.5 rounded-[6px] bg-[#0B0F14] border border-sky-500/35 flex flex-col flex-1 min-h-[380px] space-y-2.5">
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#1E2A38]">
              <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> Discussion IA — Assistant BE
              </div>
              {chatMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setChatMessages([]); setChatError(''); }}
                  className="text-[10px] text-slate-400 hover:text-red-300 cursor-pointer"
                >
                  Effacer la discussion
                </button>
              )}
            </div>

            {/* Conversation history */}
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[340px] pr-1">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-8 px-3 text-[11px] text-slate-500">
                  <Sparkles className="w-5 h-5 text-sky-500/50 mb-2" />
                  Discutez librement avec votre assistant IA BE : posez une question technique, vérifiez une tolérance ou décrivez une modification à appliquer sur la pièce 3D.
                </div>
              ) : chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-[6px] text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#111821] border border-[#1E2A38] text-slate-100 ml-6'
                      : 'bg-sky-950/30 border border-sky-500/30 text-slate-200 mr-4'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1 text-[10px]">
                    <span className={m.role === 'user' ? 'text-slate-400 font-semibold' : 'text-sky-300 font-semibold'}>
                      {m.role === 'user' ? 'Ingénieur BE' : `Assistant IA${m.model ? ` (${m.model})` : ''}`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {m.role === 'ai' && m.modified && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[9px] font-semibold">
                          3D mis à jour
                        </span>
                      )}
                      <span className="text-slate-500 font-mono-num">{m.ts || ''}</span>
                    </div>
                  </div>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                </div>
              ))}
              {refining && (
                <div className="p-2.5 rounded-[6px] bg-sky-950/20 border border-sky-500/20 text-sky-300 text-xs animate-pulse">
                  L'IA analyse votre demande...
                </div>
              )}
            </div>

            {chatError && (
              <div className="p-2 rounded bg-red-950/50 border border-red-500/40 text-red-300 text-[11px] flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{chatError}</span>
              </div>
            )}

            <form onSubmit={handleAiChatSubmit} className="space-y-2 pt-1 border-t border-[#1E2A38]">
              <textarea
                rows={2}
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAiChatSubmit();
                  }
                }}
                placeholder="Écrivez votre question technique ou modification à l'IA (Entrée pour envoyer)..."
                className="w-full p-2 rounded bg-[#111821] border border-[#1E2A38] focus:border-sky-400 focus:outline-none text-xs text-white resize-none"
              />
              <button
                type="submit"
                disabled={refining || !aiPrompt.trim()}
                className="w-full py-2 rounded-[6px] bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" /> {refining ? 'Envoi en cours...' : 'Envoyer à l’IA'}
              </button>
            </form>
          </div>

          {/* MANDATORY BE VALIDATION & EXPORTS */}
          <div className="p-3.5 rounded-[6px] bg-[#0B0F14] border border-emerald-500/35 space-y-2.5">
            <label className="flex items-start gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={validatedByBe}
                onChange={e => { setValidatedByBe(e.target.checked); setErrorMsg(''); }}
                className="mt-0.5 accent-emerald-500"
              />
              <span>
                <strong className="text-emerald-300">Validation Ingénieur BE obligatoire :</strong> j'ai contrôlé les cotes 3D et tolérances par rapport au plan 2D client.
              </span>
            </label>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={!validatedByBe || !hasFeatures}
                onClick={() => downloadFile('stl')}
                className="px-2.5 py-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] enabled:hover:border-[#22D3EE] disabled:opacity-40 text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> .STL
              </button>
              <button
                type="button"
                disabled={!validatedByBe || !hasFeatures}
                onClick={() => downloadFile('step')}
                className="px-2.5 py-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] enabled:hover:border-[#22D3EE] disabled:opacity-40 text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> .STEP
              </button>
              <button
                type="button"
                disabled={!validatedByBe || !hasFeatures}
                onClick={() => downloadFile('cadquery')}
                className="px-2.5 py-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] enabled:hover:border-purple-400 disabled:opacity-40 text-purple-300 text-xs flex items-center gap-1 cursor-pointer"
                title="Script Python CadQuery exact ouvrable dans CQ-Editor / FreeCAD"
              >
                <FileCode className="w-3.5 h-3.5" /> CadQuery .py
              </button>
              {piece && (
                <button
                  type="button"
                  disabled={!validatedByBe || !hasFeatures || publishing}
                  onClick={() => publishToOf('stl')}
                  className="ml-auto px-3 py-2 rounded-[6px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> {publishing ? 'Publication...' : `Publier sur ${piece.id}`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
