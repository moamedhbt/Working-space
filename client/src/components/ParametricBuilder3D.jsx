import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Box, Download, Upload, Sparkles, CheckCircle2, FileCode,
  Send, Trash2, ClipboardList, Layers, Eye, EyeOff, Copy,
  RotateCcw, RotateCw, Scissors, Grid3X3, Compass, AlertCircle, ChevronDown,
  ChevronRight, Save, Paperclip, X, FileText, Cpu, Wrench, Plus, Code2
} from 'lucide-react';
import { api } from '../api';
import {
  buildCsgSolidFromSpec,
  exportMeshToStlBuffer,
  exportMeshToStepText,
  exportSpecToCadQueryPython
} from '../utils/cadCsgEngine';
import {
  buildReplicadModel,
  exportReplicadSTEPBlob,
  exportReplicadSTLBlob,
  onReplicadStatus,
  materialColorAndDensity,
  paramsArrayToMap
} from '../utils/replicadClient';
import { prepareVisionAttachment, rotateAttachment90 } from '../utils/fileAttachmentHelper';

const OP_LABELS = {
  add_cylinder: { name: 'Cylindre / Brut', kind: 'add' },
  add_box: { name: 'Bloc / Parallélépipède', kind: 'add' },
  add_cone: { name: 'Cône / Tronc de cône', kind: 'add' },
  add_revolve: { name: 'Profil de révolution', kind: 'add' },
  add_extrude: { name: 'Contour 2D extrudé', kind: 'add' },
  cut_bore: { name: 'Alésage', kind: 'cut' },
  cut_cone: { name: 'Chanfrein / Cône intérieur', kind: 'cut' },
  cut_revolve: { name: 'Usinage de révolution', kind: 'cut' },
  cut_extrude: { name: 'Poche / Découpe 2D', kind: 'cut' },
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
    factory: () => ({ label: 'Cylindre', op: 'add_cylinder', axis: 'x', diameter: 50, length: 100, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, tolerance: '' })
  },
  {
    op: 'add_box',
    short: '+ Bloc',
    kind: 'add',
    factory: () => ({ label: 'Bloc', op: 'add_box', lx: 100, ly: 60, lz: 20, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, tolerance: '' })
  },
  {
    op: 'add_cone',
    short: '+ Cône',
    kind: 'add',
    factory: () => ({ label: 'Cône', op: 'add_cone', axis: 'x', d1: 50, d2: 30, length: 30, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, tolerance: '' })
  },
  {
    op: 'add_extrude',
    short: '+ Hexagone / 2D',
    kind: 'add',
    factory: () => {
      const r = 25;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3;
        return [Number((Math.cos(a) * r).toFixed(3)), Number((Math.sin(a) * r).toFixed(3))];
      });
      return { label: '6 pans / Contour 2D', op: 'add_extrude', axis: 'x', points: pts, depth: 20, bevel: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, tolerance: '' };
    }
  },
  {
    op: 'cut_bore',
    short: '− Alésage',
    kind: 'cut',
    factory: () => ({ label: 'Alésage', op: 'cut_bore', axis: 'x', diameter: 20, length: 120, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, tolerance: 'H7' })
  },
  {
    op: 'cut_cone',
    short: '− Chanfrein',
    kind: 'cut',
    factory: () => ({ label: 'Chanfrein / Fraisure', op: 'cut_cone', axis: 'x', d1: 24, d2: 18, length: 4, x: 50, y: 0, z: 0, rx: 0, ry: 0, rz: 0, tolerance: '' })
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
    factory: () => ({ label: 'Rainure', op: 'cut_slot', lx: 20, ly: 60, lz: 8, x: 0, y: 0, z: 22, rx: 0, ry: 0, rz: 0, tolerance: '' })
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
  if (f.op === 'add_cone' || f.op === 'cut_cone') return `Ø${fmtMm(f.d1)} → Ø${fmtMm(f.d2)} · L${fmtMm(f.length)} (axe ${(f.axis || 'x').toUpperCase()})`;
  if (f.op === 'add_revolve' || f.op === 'cut_revolve') return `Profil ${(f.points || []).length} pts (axe ${(f.axis || 'x').toUpperCase()})`;
  if (f.op === 'add_extrude' || f.op === 'cut_extrude') return `Contour ${(f.points || []).length} sommets · prof. ${fmtMm(f.depth)} mm`;
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
  const chatEndRef = useRef(null);

  const [cadSpec, setCadSpec] = useState(() => piece?.cadSpec || emptySpecForPiece(piece));
  const [fiche, setFiche] = useState(() => piece?.ficheTechnique || null);
  const [chatMessages, setChatMessages] = useState(() => (Array.isArray(piece?.beChat) ? piece.beChat : []));
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);

  const [dims, setDims] = useState({ x: 0, y: 0, z: 0 });
  const [displayMode, setDisplayMode] = useState('shaded_edges');
  const [showAxes, setShowAxes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [activeView, setActiveView] = useState('iso');

  const [uploadedPlan, setUploadedPlan] = useState(null);
  const [chatAttachments, setChatAttachments] = useState([]); // [{ filename, mimeType, base64, previewUrl, isFromPdf }]
  const [preparingFile, setPreparingFile] = useState(false);
  const [includePlanNext, setIncludePlanNext] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [refining, setRefining] = useState(false);
  const [chatError, setChatError] = useState('');
  const [openThinking, setOpenThinking] = useState({});

  // OpenCASCADE / Replicad B-Rep Worker state
  const [occtStatus, setOcctStatus] = useState({ status: 'idle', message: '' });
  const [buildingOcct, setBuildingOcct] = useState(false);
  const [occtError, setOcctError] = useState('');
  const [occtResult, setOcctResult] = useState(null); // { parts, bbox, volumeCm3, areaCm2, elapsedMs }
  const [hiddenParts, setHiddenParts] = useState({});
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [exportingFormat, setExportingFormat] = useState('');

  const [validatedByBe, setValidatedByBe] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [applyingFiche, setApplyingFiche] = useState(false);
  const [savingStudio, setSavingStudio] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isReplicad = Boolean(cadSpec && (cadSpec.engine === 'replicad' || (typeof cadSpec.code === 'string' && cadSpec.code.trim().length > 10)));
  const materialInfo = materialColorAndDensity(cadSpec?.material || fiche?.material || piece?.matiere || '');

  useEffect(() => onReplicadStatus(setOcctStatus), []);

  useEffect(() => {
    if (isReplicad) setCodeDraft(cadSpec?.code || '');
  }, [cadSpec?.code, isReplicad]);

  // Auto-scroll chat when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chatMessages.length, refining]);

  // Immediately switch & load per-OF 3D state when active OF changes
  useEffect(() => {
    skipNextSaveRef.current = true;
    setCadSpec(piece?.cadSpec || emptySpecForPiece(piece));
    setFiche(piece?.ficheTechnique || null);
    setChatMessages(Array.isArray(piece?.beChat) ? piece.beChat : []);
    setSelectedFeatureId(null);
    setUploadedPlan(null);
    setChatAttachments([]);
    setIncludePlanNext(false);
    setHiddenParts({});
    setOcctResult(null);
    setOcctError('');
    setValidatedByBe(false);
    setChatError('');
    setErrorMsg('');
    setStatusMsg('');
  }, [piece?.id]);

  // Auto-save per-OF studio state (strip heavy base64 previews from persisted chat history)
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
        const lightChat = chatMessages.map(m => ({
          role: m.role,
          text: m.text,
          thinking: m.thinking || null,
          modified: m.modified,
          model: m.model,
          ts: m.ts,
          attachmentNames: m.attachmentNames || (m.attachments ? m.attachments.map(a => a.filename) : undefined)
        }));
        await api(`/api/pieces/${piece.id}/be-studio`, 'PUT', {
          cadSpec,
          ficheTechnique: fiche,
          beChat: lightChat
        });
      } catch {
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
    const height = el.clientHeight || 400;

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
      const h = el.clientHeight || 400;
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

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showGrid, showAxes]);

  function setCameraView(viewName) {
    setActiveView(viewName);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    let center = new THREE.Vector3(0, 0, 0);
    let radius = 85;
    const grp = rootGroupRef.current;
    if (grp && grp.children.length > 0) {
      const box = new THREE.Box3().setFromObject(grp);
      if (!box.isEmpty()) {
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius > 0) {
          center.copy(sphere.center);
          radius = Math.max(15, sphere.radius);
        }
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

  function clearRootGroup() {
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
  }

  // 1) When in Replicad B-Rep mode: compute exact OpenCASCADE geometry in Web Worker (debounced)
  useEffect(() => {
    if (!isReplicad) {
      setBuildingOcct(false);
      setOcctError('');
      setOcctResult(null);
      return;
    }
    if (!cadSpec?.code?.trim()) {
      setOcctResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBuildingOcct(true);
      setOcctError('');
      try {
        const result = await buildReplicadModel({
          code: cadSpec.code,
          paramsMap: paramsArrayToMap(cadSpec.params),
          name: cadSpec.name || 'Piece_BE',
          defaultColor: materialInfo.color
        });
        if (cancelled) return;
        setOcctResult(result);
        setDims({ x: result.bbox.lx, y: result.bbox.ly, z: result.bbox.lz });
      } catch (err) {
        if (cancelled) return;
        setOcctError(err.message || 'Erreur noyau OpenCASCADE');
      } finally {
        if (!cancelled) setBuildingOcct(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isReplicad, cadSpec?.code, cadSpec?.params, cadSpec?.name, materialInfo.color]);

  // 2) Render either Replicad OpenCASCADE meshes OR legacy CSG into Three.js scene
  useEffect(() => {
    const group = rootGroupRef.current;
    if (!group) return;

    const isWire = displayMode === 'wireframe';
    const isTrans = displayMode === 'transparent';
    const isEdges = displayMode === 'shaded_edges' || displayMode === 'transparent' || displayMode === 'section';
    const isSection = displayMode === 'section';

    if (isReplicad) {
      if (!occtResult || !Array.isArray(occtResult.parts) || occtResult.parts.length === 0) {
        if (!occtError) {
          clearRootGroup();
          solidMeshRef.current = null;
        }
        return;
      }
      clearRootGroup();
      let firstMesh = null;
      for (const p of occtResult.parts) {
        if (hiddenParts[p.name]) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(p.vertices, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
        geo.setIndex(new THREE.BufferAttribute(p.triangles, 1));
        geo.computeBoundingBox();

        const baseOpacity = p.opacity !== undefined ? p.opacity : 1;
        const matOpacity = isTrans ? Math.min(0.38, baseOpacity) : baseOpacity;
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(p.color || materialInfo.color),
          metalness: /#f1f5f9|#e2e8f0|#ffffff/i.test(p.color || '') ? 0.08 : 0.62,
          roughness: /#f1f5f9|#e2e8f0|#ffffff/i.test(p.color || '') ? 0.52 : 0.32,
          side: THREE.DoubleSide,
          wireframe: isWire,
          transparent: isTrans || matOpacity < 0.99,
          opacity: matOpacity,
          depthWrite: !(isTrans || matOpacity < 0.99),
          clippingPlanes: isSection ? [clipPlaneRef.current] : []
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        if (!firstMesh) firstMesh = mesh;

        if (isEdges && !isWire && p.edgeLines && p.edgeLines.length > 0) {
          const edgeGeo = new THREE.BufferGeometry();
          edgeGeo.setAttribute('position', new THREE.BufferAttribute(p.edgeLines, 3));
          const edgeMat = new THREE.LineBasicMaterial({
            color: isTrans ? 0x7dd3fc : 0x0f172a,
            transparent: true,
            opacity: isTrans ? 0.85 : 0.72,
            clippingPlanes: isSection ? [clipPlaneRef.current] : []
          });
          group.add(new THREE.LineSegments(edgeGeo, edgeMat));
        }
      }
      solidMeshRef.current = firstMesh;
      if (gridRef.current && occtResult.bbox?.min) {
        gridRef.current.position.y = occtResult.bbox.min[1] - 5;
      }
      return;
    }

    // Legacy CSG path
    clearRootGroup();
    const { mesh, threadOverlays, dimensions } = buildCsgSolidFromSpec(cadSpec);
    setDims(dimensions);

    if (!mesh) {
      solidMeshRef.current = null;
      return;
    }

    mesh.material.color = new THREE.Color(materialInfo.color);
    mesh.material.wireframe = isWire;
    mesh.material.transparent = isTrans;
    mesh.material.opacity = isTrans ? 0.38 : 1;
    mesh.material.depthWrite = !isTrans;
    mesh.material.clippingPlanes = isSection ? [clipPlaneRef.current] : [];
    mesh.material.needsUpdate = true;

    group.add(mesh);
    solidMeshRef.current = mesh;

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

    for (const ov of (threadOverlays || [])) {
      ov.material.clippingPlanes = isSection ? [clipPlaneRef.current] : [];
      group.add(ov);
    }

    if (gridRef.current && mesh.geometry.boundingBox) {
      gridRef.current.position.y = mesh.geometry.boundingBox.min.y - 5;
    }
  }, [isReplicad, occtResult, occtError, hiddenParts, cadSpec, displayMode, materialInfo.color]);

  async function runPlanAnalysis({ fileId = null, filename = '', base64 = null, attachments = [] }) {
    setAnalyzing(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await api('/api/be/analyze-plan', 'POST', {
        fileId,
        filename,
        base64,
        attachments: attachments.map(a => ({ filename: a.filename, mimeType: a.mimeType, base64: a.base64 })),
        notes: piece ? `${piece.nom} ${piece.matiere || ''} ${piece.notesQualite || ''}` : ''
      });
      if (res.ficheTechnique) setFiche(res.ficheTechnique);
      if (res.cadSpec) {
        setCadSpec(res.cadSpec);
        setHiddenParts({});
        setValidatedByBe(false);
        setTimeout(() => setCameraView('iso'), 450);
      }
      if (res.thinking || res.ficheTechnique?.summary) {
        setChatMessages(prev => [
          ...prev,
          {
            role: 'ai',
            text: res.ficheTechnique?.summary || 'Analyse du plan 2D et modèle B-Rep générés.',
            thinking: res.thinking || null,
            modified: true,
            mode: res.mode,
            model: res.aiProvider || '',
            ts: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
      setStatusMsg(`Analyse terminée (${res.mode}) — modèle 3D B-Rep prêt à contrôler et exporter (.STEP / .STL).`);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handlePlanUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    setErrorMsg('');
    try {
      // Automatically render PDF pages to HD PNG so OpenRouter, OpenAI, Claude & Gemini all see them!
      const prepared = await prepareVisionAttachment(file, 2);
      setUploadedPlan({ filename: file.name, attachments: prepared, fileId: null });
      await runPlanAnalysis({ filename: file.name, attachments: prepared });
    } catch (err) {
      setErrorMsg('Lecture du fichier impossible : ' + err.message);
      setAnalyzing(false);
    } finally {
      e.target.value = '';
    }
  }

  async function analyzeExistingClientPlan() {
    const cf = piece?.be?.clientFile || piece?.be?.planFile;
    if (!cf) return;
    setAnalyzing(true);
    setErrorMsg('');
    try {
      // If the stored OF file is a PDF, fetch and render it to HD PNG client-side so OpenRouter/OpenAI also see it!
      if (/\.pdf$/i.test(cf.filename || '') && cf.url) {
        const resp = await fetch(cf.url);
        const blob = await resp.blob();
        const fileObj = new File([blob], cf.filename, { type: 'application/pdf' });
        const prepared = await prepareVisionAttachment(fileObj, 2);
        setUploadedPlan({ filename: cf.filename, attachments: prepared, fileId: cf.id });
        await runPlanAnalysis({ filename: cf.filename, attachments: prepared });
      } else {
        setUploadedPlan({ filename: cf.filename, attachments: [], fileId: cf.id });
        await runPlanAnalysis({ fileId: cf.id, filename: cf.filename });
      }
    } catch (err) {
      setErrorMsg(err.message);
      setAnalyzing(false);
    }
  }

  // Attach image or PDF directly inside the AI chat
  async function handleChatFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPreparingFile(true);
    setChatError('');
    try {
      const added = [];
      for (const file of files.slice(0, 2)) {
        const prepared = await prepareVisionAttachment(file, 2);
        added.push(...prepared);
      }
      setChatAttachments(prev => [...prev, ...added].slice(0, 4));
    } catch (err) {
      setChatError('Impossible de charger le fichier joint : ' + err.message);
    } finally {
      setPreparingFile(false);
      e.target.value = '';
    }
  }

  // Allow Ctrl+V screenshot paste directly into chat textarea!
  async function handleChatPaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find(i => i.type && i.type.startsWith('image/'));
    if (!imgItem) return;
    const file = imgItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    setPreparingFile(true);
    try {
      const named = new File([file], `capture_${Date.now()}.png`, { type: file.type || 'image/png' });
      const prepared = await prepareVisionAttachment(named, 1);
      setChatAttachments(prev => [...prev, ...prepared].slice(0, 4));
    } catch (err) {
      setChatError('Impossible de coller la capture : ' + err.message);
    } finally {
      setPreparingFile(false);
    }
  }

  async function handleRotateChatAttachment(idx) {
    const target = chatAttachments[idx];
    if (!target) return;
    try {
      const rotated = await rotateAttachment90(target);
      setChatAttachments(prev => prev.map((a, i) => (i === idx ? rotated : a)));
    } catch {}
  }

  async function handleAiChatSubmit(e) {
    e?.preventDefault();
    const text = aiPrompt.trim();
    if (!text && chatAttachments.length === 0) return;

    setRefining(true);
    setChatError('');

    const sentAttachments = [...chatAttachments];
    if (sentAttachments.length > 0) {
      setUploadedPlan({ filename: sentAttachments[0].originalFilename || sentAttachments[0].filename, attachments: sentAttachments, fileId: null });
    }
    const shouldIncludeOldPlan = sentAttachments.length === 0 && includePlanNext;
    const displayPrompt = text || `Document joint (${sentAttachments.map(a => a.originalFilename || a.filename).join(', ')})`;
    const nextUserMsg = {
      role: 'user',
      text: displayPrompt,
      attachments: sentAttachments.map(a => ({ filename: a.originalFilename || a.filename, previewUrl: a.previewUrl, isFromPdf: a.isFromPdf })),
      attachmentNames: sentAttachments.map(a => a.originalFilename || a.filename),
      ts: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    };
    const updatedHistory = [...chatMessages, nextUserMsg];
    setChatMessages(updatedHistory);
    setAiPrompt('');
    setChatAttachments([]);
    setIncludePlanNext(false); // Auto-reset so follow-up text edits never waste image tokens!

    try {
      const payloadAttachments = sentAttachments.length > 0
        ? sentAttachments.map(a => ({ filename: a.filename, mimeType: a.mimeType, base64: a.base64 }))
        : (shouldIncludeOldPlan ? (uploadedPlan?.attachments || []).map(a => ({ filename: a.filename, mimeType: a.mimeType, base64: a.base64 })) : []);

      const res = await api('/api/be/refine-3d', 'POST', {
        pieceId: piece?.id || null,
        includePlan: shouldIncludeOldPlan,
        fileId: shouldIncludeOldPlan ? (uploadedPlan?.fileId || null) : null,
        filename: sentAttachments[0]?.filename || uploadedPlan?.filename || piece?.be?.clientFile?.filename || 'plan.png',
        attachments: payloadAttachments,
        cadSpec,
        ficheTechnique: fiche,
        history: updatedHistory.map(m => ({ role: m.role, text: m.text })),
        prompt: text
      });

      if (res.ficheTechnique) setFiche(res.ficheTechnique);
      if (res.modified && res.cadSpec) {
        setCadSpec(res.cadSpec);
        setHiddenParts({});
        setValidatedByBe(false);
        setTimeout(() => setCameraView(activeView), 450);
      }
      setChatMessages(prev => [
        ...prev,
        {
          role: 'ai',
          text: res.reply || res.changesSummary || 'Bien reçu.',
          thinking: res.thinking || null,
          modified: Boolean(res.modified),
          mode: res.mode,
          model: res.model || '',
          usedVision: Boolean(res.usedVision),
          ts: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (err) {
      setChatError(err.message);
    } finally {
      setRefining(false);
    }
  }

  // 1-click zero-image-token repair when an AI-generated Replicad script hits an OpenCASCADE error
  async function handleAutoFixOcctError() {
    if (!occtError || refining) return;
    setRefining(true);
    setChatError('');
    try {
      const res = await api('/api/be/refine-3d', 'POST', {
        pieceId: piece?.id || null,
        includePlan: false,
        attachments: [],
        cadSpec,
        ficheTechnique: fiche,
        history: chatMessages.slice(-4).map(m => ({ role: m.role, text: m.text })),
        errorContext: occtError,
        prompt: `Corrige l'erreur OpenCASCADE suivante sans changer les cotes demandées : ${occtError}`
      });
      if (res.cadSpec) {
        setCadSpec(res.cadSpec);
        setOcctError('');
        setValidatedByBe(false);
      }
      setChatMessages(prev => [
        ...prev,
        {
          role: 'ai',
          text: res.reply || 'Erreur OpenCASCADE corrigée automatiquement.',
          thinking: res.thinking || null,
          modified: Boolean(res.modified),
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

  function updateReplicadParam(idx, patch) {
    setCadSpec(prev => ({
      ...prev,
      params: (prev.params || []).map((p, i) => (i === idx ? { ...p, ...patch } : p))
    }));
    setValidatedByBe(false);
  }

  function addReplicadParam() {
    const idx = (cadSpec?.params?.length || 0) + 1;
    setCadSpec(prev => ({
      ...prev,
      params: [...(prev.params || []), { key: `cote_${idx}`, label: `Cote ${idx}`, value: 10, unit: 'mm', tolerance: '' }]
    }));
  }

  function removeReplicadParam(idx) {
    setCadSpec(prev => ({
      ...prev,
      params: (prev.params || []).filter((_, i) => i !== idx)
    }));
    setValidatedByBe(false);
  }

  function applyManualCode() {
    setCadSpec(prev => ({
      ...prev,
      engine: 'replicad',
      code: codeDraft
    }));
    setValidatedByBe(false);
  }

  function addToolFeature(tool) {
    const id = `f_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const feat = { id, ...tool.factory(), hidden: false };
    setCadSpec(prev => ({
      ...prev,
      engine: 'csg',
      code: '',
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

  async function downloadFile(format) {
    if (!validatedByBe) {
      setErrorMsg("Cochez d'abord la case de validation ingénieur BE.");
      return;
    }
    const baseName = (piece?.id || cadSpec.name || 'Piece_BE').replace(/[^a-zA-Z0-9_-]/g, '_');
    setExportingFormat(format);
    setErrorMsg('');
    try {
      let blob;
      let ext;
      if (format === 'step') {
        if (isReplicad) {
          blob = await exportReplicadSTEPBlob();
        } else {
          // Convert legacy CSG feature tree through OpenCASCADE to emit a REAL B-Rep .STEP!
          await buildReplicadModel({ legacyFeatures: cadSpec.features || [], name: baseName, defaultColor: materialInfo.color });
          blob = await exportReplicadSTEPBlob();
        }
        ext = 'step';
      } else if (format === 'stl') {
        if (isReplicad) {
          blob = await exportReplicadSTLBlob();
        } else {
          if (!solidMeshRef.current) throw new Error('Le modèle 3D est vide.');
          blob = new Blob([exportMeshToStlBuffer(solidMeshRef.current)], { type: 'application/octet-stream' });
        }
        ext = 'stl';
      } else if (format === 'script') {
        if (isReplicad) {
          const header = `// Script CAO OpenCASCADE (Replicad) — ${baseName}\nconst P = ${JSON.stringify(paramsArrayToMap(cadSpec.params), null, 2)};\n\n`;
          blob = new Blob([header + (cadSpec.code || '')], { type: 'text/javascript' });
          ext = 'js';
        } else {
          blob = new Blob([exportSpecToCadQueryPython(cadSpec)], { type: 'text/x-python' });
          ext = 'py';
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${baseName}.${ext}`;
      a.click();
      setStatusMsg(`Export ${baseName}.${ext} prêt (${format === 'step' ? 'vrai B-Rep OpenCASCADE' : format.toUpperCase()}).`);
    } catch (err) {
      setErrorMsg(`Erreur export ${format.toUpperCase()} : ${err.message}`);
    } finally {
      setExportingFormat('');
    }
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function publishToOf(format = 'stl') {
    if (!piece || !onPublishToOf) return;
    if (!validatedByBe) {
      setErrorMsg("Validation ingénieur BE obligatoire avant publication sur l'OF.");
      return;
    }
    setPublishing(true);
    setErrorMsg('');
    try {
      let base64, filename;
      if (format === 'step') {
        let blob;
        if (isReplicad) blob = await exportReplicadSTEPBlob();
        else {
          await buildReplicadModel({ legacyFeatures: cadSpec.features || [], name: piece.id, defaultColor: materialInfo.color });
          blob = await exportReplicadSTEPBlob();
        }
        base64 = await blobToDataUrl(blob);
        filename = `${piece.id}_BE_valide.step`;
      } else {
        if (isReplicad) {
          const blob = await exportReplicadSTLBlob();
          base64 = await blobToDataUrl(blob);
        } else {
          if (!solidMeshRef.current) throw new Error('Le modèle 3D est vide.');
          const stlBuf = exportMeshToStlBuffer(solidMeshRef.current);
          const bytes = new Uint8Array(stlBuf);
          let bin = '';
          for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
          base64 = 'data:application/octet-stream;base64,' + btoa(bin);
        }
        filename = `${piece.id}_BE_valide.stl`;
      }
      await onPublishToOf(piece.id, filename, base64, `Modèle 3D B-Rep validé BE (${dims.x.toFixed(2)}×${dims.y.toFixed(2)}×${dims.z.toFixed(2)} mm)`);
      setStatusMsg(`${filename} publié dans l'OF ${piece.id}.`);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setPublishing(false);
    }
  }

  const hasFeatures = isReplicad ? Boolean(cadSpec?.code?.trim()) : (cadSpec?.features || []).length > 0;
  const estimatedMassKg = occtResult?.volumeCm3 > 0
    ? ((occtResult.volumeCm3 * materialInfo.density) / 1000).toFixed(2)
    : null;
  const existingPlanFile = piece?.be?.clientFile || piece?.be?.planFile || null;

  return (
    <div className="cyber-card p-3.5 sm:p-4 space-y-3.5">
      {/* HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#1E2A38]">
        <div>
          <h3 className="text-sm font-semibold text-white flex flex-wrap items-center gap-2">
            <Box className="w-4 h-4 text-[#22D3EE]" />
            Studio CAO 3D & Assistant IA BE
            {piece && (
              <span className="px-2 py-0.5 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] text-[11px] font-mono-num">
                {piece.id} · {piece.nom}
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-400">
            Noyau CAO B-Rep OpenCASCADE (Replicad) · Export .STEP & .STL natifs · Cotes manuelles au 0.001 mm · Chat IA économe en tokens
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
              className="px-2.5 py-1.5 rounded-[6px] bg-sky-600/20 border border-sky-500/40 hover:border-sky-400 text-sky-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {analyzing ? 'Analyse...' : `Analyser le plan de ${piece.id}`}
            </button>
          )}
          <label className="px-2.5 py-1.5 rounded-[6px] bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            {analyzing ? 'Analyse...' : 'Importer Plan 2D (Photo / PDF)'}
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
        <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-purple-500/40 space-y-2">
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
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {fiche.suggestedOperations.map((op, i) => (
                <span key={i} className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] text-[11px] text-slate-200">
                  <strong className="text-[#22D3EE]">Op {(i + 1) * 10}</strong> · {op.libelle} ({op.tempsReglageMin}m + {op.tempsUnitaireMin}m/pce)
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BALANCED 2-COLUMN WORKSPACE (NO WASTED EMPTY SPACE) */}
      <div className="grid lg:grid-cols-12 gap-3.5 items-start">
        {/* LEFT COLUMN (7 cols): PRO 3D VIEWPORT + MANUAL 0.001 mm INSPECTOR */}
        <div className="lg:col-span-7 space-y-3">
          {/* PRO CAD CAMERA & DISPLAY TOOLBAR */}
          <div className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-1.5">
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
            <div ref={mountRef} className="w-full h-[400px]" />

            {/* Multi-body / Multi-material toggle pills (e.g. Corps Bronze / Tiges Téflon) */}
            {isReplicad && occtResult?.parts?.length > 1 && (
              <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[85%]">
                {occtResult.parts.map(p => {
                  const isHidden = Boolean(hiddenParts[p.name]);
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setHiddenParts(prev => ({ ...prev, [p.name]: !prev[p.name] }))}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1.5 cursor-pointer transition ${
                        isHidden
                          ? 'bg-[#0B0F14]/85 border-[#1E2A38] text-slate-500 line-through'
                          : 'bg-[#0B0F14]/90 border-[#22D3EE]/40 text-slate-100'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color || '#94a3b8' }} />
                      {p.name}
                      {isHidden ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5 text-[#22D3EE]" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* OpenCASCADE Engine Badge */}
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-[#0B0F14]/90 border border-[#1E2A38] text-[10px] flex items-center gap-1.5">
              <Cpu className={`w-3 h-3 ${buildingOcct ? 'text-amber-400 animate-spin' : isReplicad ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className={isReplicad ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                {buildingOcct
                  ? (occtStatus.status === 'loading_occt' ? 'Chargement OpenCASCADE…' : 'Calcul B-Rep…')
                  : isReplicad
                    ? `OpenCASCADE B-Rep${occtResult?.elapsedMs ? ` (${occtResult.elapsedMs}ms)` : ''}`
                    : 'Mode CSG'}
              </span>
            </div>

            {!hasFeatures && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d14]/70 pointer-events-none text-center p-6">
                <Box className="w-8 h-8 text-slate-600 mb-2" />
                <div className="text-xs font-semibold text-slate-300">
                  Scène 3D vierge {piece ? `pour ${piece.id}` : ''}
                </div>
                <div className="text-[11px] text-slate-500 max-w-sm mt-1">
                  Joignez une photo/PDF dans la discussion IA à droite pour générer directement un vrai solide B-Rep (.STEP / .STL), ou utilisez les outils ci-dessous.
                </div>
              </div>
            )}

            <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-[#0B0F14]/90 border border-[#1E2A38] text-[10px] text-slate-300 font-mono-num flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <span>
                Encombrement : <strong className="text-[#22D3EE]">{dims.x.toFixed(2)}</strong> × <strong className="text-[#22D3EE]">{dims.y.toFixed(2)}</strong> × <strong className="text-[#22D3EE]">{dims.z.toFixed(2)} mm</strong>
              </span>
              {occtResult?.volumeCm3 > 0 && (
                <>
                  <span className="text-slate-600">|</span>
                  <span>Vol : <strong className="text-slate-100">{occtResult.volumeCm3} cm³</strong></span>
                  {estimatedMassKg && (
                    <span>≈ <strong className="text-amber-300">{estimatedMassKg} kg</strong> ({materialInfo.label})</span>
                  )}
                </>
              )}
            </div>
            <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-[#0B0F14]/90 border border-[#1E2A38] text-[10px] text-slate-400">
              0.001 mm
            </div>
          </div>

          {/* OPENCASCADE KERNEL ERROR BANNER WITH 1-CLICK ZERO-IMAGE-TOKEN AUTO-REPAIR */}
          {occtError && (
            <div className="p-2.5 rounded-[6px] bg-red-950/50 border border-red-500/45 text-red-200 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-semibold text-red-300">Erreur noyau OpenCASCADE</div>
                  <div className="text-[11px] font-mono-num break-words">{occtError}</div>
                </div>
              </div>
              <button
                type="button"
                disabled={refining}
                onClick={handleAutoFixOcctError}
                className="px-2.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-[#0B0F14] text-[11px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Wrench className="w-3.5 h-3.5" /> {refining ? 'Correction…' : 'Corriger auto avec l’IA'}
              </button>
            </div>
          )}

          {/* PARAMETRIC 0.001 mm INSPECTOR (REPLICAD PARAMS TABLE OR LEGACY CSG FEATURES) */}
          {isReplicad ? (
            <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#22D3EE]" />
                  Cotes paramétriques B-Rep ({cadSpec.params?.length || 0}) — 0 token
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={addReplicadParam}
                    className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-[10px] text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Cote
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCodeEditor(v => !v)}
                    className={`px-2 py-1 rounded border text-[10px] flex items-center gap-1 cursor-pointer ${
                      showCodeEditor
                        ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
                        : 'bg-[#111821] border-[#1E2A38] text-slate-300 hover:border-purple-400'
                    }`}
                  >
                    <Code2 className="w-3 h-3" /> {showCodeEditor ? 'Masquer Code' : 'Code B-Rep'}
                  </button>
                </div>
              </div>

              {(cadSpec.params || []).length === 0 ? (
                <div className="text-[11px] text-slate-400 py-2 text-center">
                  Aucun paramètre déclaré. Modifiez la pièce par chat IA ou cliquez sur « Code B-Rep ».
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
                  {(cadSpec.params || []).map((p, idx) => (
                    <div
                      key={`${p.key}_${idx}`}
                      className="flex items-center gap-2 p-2 rounded bg-[#111821] border border-[#1E2A38] hover:border-slate-600"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-slate-100 truncate flex items-center gap-1">
                          <span className="truncate">{p.label || p.key}</span>
                          {p.tolerance && (
                            <span className="px-1 py-0.2 rounded bg-amber-500/15 text-amber-300 text-[9px] font-mono-num shrink-0">
                              {p.tolerance}
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono-num truncate">P.{p.key}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          step={p.unit === 'u' ? '1' : '0.001'}
                          value={p.value ?? ''}
                          onChange={e => {
                            const raw = e.target.value;
                            if (raw === '' || raw === '-') updateReplicadParam(idx, { value: raw });
                            else {
                              const num = parseFloat(raw);
                              if (Number.isFinite(num)) updateReplicadParam(idx, { value: num });
                            }
                          }}
                          className="w-24 px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] focus:border-[#22D3EE] focus:outline-none text-white text-[11px] font-mono-num text-right"
                        />
                        <span className="text-[10px] text-slate-400 w-6">{p.unit || 'mm'}</span>
                        <button
                          type="button"
                          onClick={() => removeReplicadParam(idx)}
                          className="p-0.5 text-slate-500 hover:text-red-400 cursor-pointer"
                          title="Supprimer ce paramètre"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showCodeEditor && (
                <div className="pt-2 border-t border-[#1E2A38] space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Script JavaScript Replicad / OpenCASCADE (`function main(P)`)</span>
                    <button
                      type="button"
                      onClick={applyManualCode}
                      className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold cursor-pointer"
                    >
                      Recalculer 3D
                    </button>
                  </div>
                  <textarea
                    rows={10}
                    value={codeDraft}
                    onChange={e => setCodeDraft(e.target.value)}
                    spellCheck={false}
                    className="w-full p-2.5 rounded bg-[#070a0f] border border-[#1E2A38] focus:border-purple-400 focus:outline-none text-[11px] font-mono text-emerald-200 leading-relaxed"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#22D3EE]" />
                Éditeur manuel des cotes & opérations ({cadSpec.features?.length || 0})
              </div>
              <span className="text-[10px] text-slate-400">Cliquez une ligne pour éditer au 0.001 mm</span>
            </div>

            <div className="flex flex-wrap gap-1">
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

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {(cadSpec.features || []).length === 0 ? (
                <div className="text-[11px] text-slate-500 py-2.5 text-center">
                  Aucune opération CAO définie. Ajoutez un outil ci-dessus ou demandez à l'IA.
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
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]">
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
                        <button type="button" onClick={() => updateFeature(f.id, { hidden: !f.hidden })} className="p-1 text-slate-400 hover:text-white cursor-pointer" title={f.hidden ? 'Afficher' : 'Masquer'}>
                          {f.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button type="button" onClick={() => duplicateFeature(f)} className="p-1 text-slate-400 hover:text-[#22D3EE] cursor-pointer" title="Dupliquer">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => removeFeature(f.id)} className="p-1 text-slate-400 hover:text-red-400 cursor-pointer" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="px-2.5 pb-3 pt-2 border-t border-[#1E2A38] space-y-2 text-[11px]">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="col-span-2">
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
                            <NumField label="Pos X" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                            <NumField label="Pos Y" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                            <NumField label="Pos Z" value={f.z ?? 0} onChange={v => updateFeature(f.id, { z: v })} />
                          </div>
                        )}

                        {(f.op === 'add_cone' || f.op === 'cut_cone') && (
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            <NumField label="Ø début (mm)" value={f.d1} min={0} onChange={v => updateFeature(f.id, { d1: v })} />
                            <NumField label="Ø fin (mm)" value={f.d2} min={0} onChange={v => updateFeature(f.id, { d2: v })} />
                            <NumField label="Longueur (mm)" value={f.length} min={0.1} onChange={v => updateFeature(f.id, { length: v })} />
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Axe</label>
                              <select value={f.axis || 'x'} onChange={e => updateFeature(f.id, { axis: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
                              </select>
                            </div>
                            <NumField label="Pos X" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                            <NumField label="Pos Y" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                          </div>
                        )}

                        {(f.op === 'add_box' || f.op === 'cut_slot') && (
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            <NumField label="Long. X (mm)" value={f.lx} min={0.1} onChange={v => updateFeature(f.id, { lx: v })} />
                            <NumField label="Larg. Y (mm)" value={f.ly} min={0.1} onChange={v => updateFeature(f.id, { ly: v })} />
                            <NumField label="Haut. Z (mm)" value={f.lz} min={0.1} onChange={v => updateFeature(f.id, { lz: v })} />
                            <NumField label="Pos X" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                            <NumField label="Pos Y" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                            <NumField label="Pos Z" value={f.z ?? 0} onChange={v => updateFeature(f.id, { z: v })} />
                          </div>
                        )}

                        {(f.op === 'add_extrude' || f.op === 'cut_extrude') && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                              <NumField label="Profondeur (mm)" value={f.depth ?? 20} min={0.1} onChange={v => updateFeature(f.id, { depth: v })} />
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">Axe</label>
                                <select value={f.axis || 'z'} onChange={e => updateFeature(f.id, { axis: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                  <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
                                </select>
                              </div>
                              <NumField label="Pos X" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                              <NumField label="Pos Y" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                              <NumField label="Pos Z" value={f.z ?? 0} onChange={v => updateFeature(f.id, { z: v })} />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Points du contour 2D [[u, v], ...] (mm)</label>
                              <input
                                defaultValue={JSON.stringify(f.points || [])}
                                onBlur={e => {
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    if (Array.isArray(parsed) && parsed.length >= 3) updateFeature(f.id, { points: parsed });
                                  } catch {}
                                }}
                                className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-cyan-200 text-[10px] font-mono-num"
                              />
                            </div>
                          </div>
                        )}

                        {(f.op === 'add_revolve' || f.op === 'cut_revolve') && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">Axe</label>
                                <select value={f.axis || 'x'} onChange={e => updateFeature(f.id, { axis: e.target.value })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                  <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
                                </select>
                              </div>
                              <NumField label="Pos X" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                              <NumField label="Pos Y" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
                              <NumField label="Pos Z" value={f.z ?? 0} onChange={v => updateFeature(f.id, { z: v })} />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Profil de révolution [[rayon, posAxiale], ...] (mm)</label>
                              <input
                                defaultValue={JSON.stringify(f.points || [])}
                                onBlur={e => {
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    if (Array.isArray(parsed) && parsed.length >= 2) updateFeature(f.id, { points: parsed });
                                  } catch {}
                                }}
                                className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-cyan-200 text-[10px] font-mono-num"
                              />
                            </div>
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
                            <NumField label="Pos X" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
                            <NumField label="Pos Y" value={f.y ?? 0} onChange={v => updateFeature(f.id, { y: v })} />
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
                            <NumField label="Pos X" value={f.x ?? 0} onChange={v => updateFeature(f.id, { x: v })} />
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
                              <label className="text-[10px] text-slate-400 block mb-0.5">Type</label>
                              <select value={f.internal !== false ? 'int' : 'ext'} onChange={e => updateFeature(f.id, { internal: e.target.value === 'int' })} className="w-full px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-white text-[11px]">
                                <option value="int">Taraudage (Intérieur)</option>
                                <option value="ext">Filetage (Extérieur)</option>
                              </select>
                            </div>
                            <NumField label="Ø PCD (0=centre)" value={f.pcd ?? 0} min={0} onChange={v => updateFeature(f.id, { pcd: v })} />
                            <NumField label="Nb trous" value={f.count ?? 1} step="1" min={1} onChange={v => updateFeature(f.id, { count: v })} />
                          </div>
                        )}

                        {/* Optional 3D Rotation angles (for inclined holes / angled cuts) */}
                        {f.op !== 'cut_flat' && f.op !== 'cut_hole_pattern' && f.op !== 'cut_groove' && f.op !== 'cut_thread' && (
                          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#1E2A38]/60">
                            <NumField label="Rotation RX (°)" value={f.rx ?? 0} step="0.1" onChange={v => updateFeature(f.id, { rx: v })} />
                            <NumField label="Rotation RY (°)" value={f.ry ?? 0} step="0.1" onChange={v => updateFeature(f.id, { ry: v })} />
                            <NumField label="Rotation RZ (°)" value={f.rz ?? 0} step="0.1" onChange={v => updateFeature(f.id, { rz: v })} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}
        </div>

        {/* RIGHT COLUMN (5 cols): COMPACT, CLEAN AI BE CHAT (WITH IMAGE & PDF UPLOAD) + VALIDATION */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* CONVERSATIONAL AI PANEL */}
          <div className="rounded-[6px] bg-[#0B0F14] border border-sky-500/35 flex flex-col h-[560px] overflow-hidden">
            {/* Chat Header */}
            <div className="px-3.5 py-2.5 border-b border-[#1E2A38] bg-[#0E141D] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="text-xs font-semibold text-white">Discussion IA — Ingénieur BE & CAO B-Rep</div>
                  <div className="text-[10px] text-slate-400">1 seule requête = Analyse DFM + 3D .STEP/.STL direct · Éco tokens</div>
                </div>
              </div>
              {chatMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setChatMessages([]); setChatError(''); }}
                  className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] text-[10px] text-slate-400 hover:text-red-300 cursor-pointer"
                >
                  Effacer
                </button>
              )}
            </div>

            {/* Chat Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {chatMessages.length === 0 ? (
                <div className="rounded-[6px] bg-[#111821]/80 border border-[#1E2A38] p-3.5 text-xs text-slate-300 space-y-2">
                  <div className="font-semibold text-sky-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Ingénieur BE & Noyau OpenCASCADE prêts
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Joignez un plan photo/PDF avec <strong className="text-slate-200">📎</strong> (ou <kbd className="px-1 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[10px]">Ctrl+V</kbd>) et demandez directement la pièce : l’IA fait l’analyse DFM sur vos machines et génère le solide B-Rep paramétrique en <strong className="text-slate-200">1 seule requête</strong>. Les retouches texte suivantes ne renvoient plus la photo (économie de tokens).
                  </p>
                </div>
              ) : chatMessages.map((m, idx) => {
                const hasThinking = m.role === 'ai' && m.thinking && (
                  m.thinking.vues_et_fonction ||
                  m.thinking.cotes_cles?.length ||
                  m.thinking.alertes_dfm?.length ||
                  m.thinking.points_a_verifier?.length
                );
                const thinkingExpanded = Boolean(openThinking[idx]);
                return (
                <div
                  key={idx}
                  className={`p-2.5 rounded-[6px] text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#131C28] border border-[#243447] text-slate-100 ml-5'
                      : 'bg-sky-950/30 border border-sky-500/30 text-slate-200 mr-3'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1 text-[10px]">
                    <span className={m.role === 'user' ? 'text-slate-400 font-semibold' : 'text-sky-300 font-semibold'}>
                      {m.role === 'user' ? 'Ingénieur BE' : `Assistant IA${m.model ? ` · ${m.model}` : ''}`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {m.role === 'ai' && m.modified && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[9px] font-semibold">
                          3D B-Rep mis à jour
                        </span>
                      )}
                      <span className="text-slate-500 font-mono-num">{m.ts || ''}</span>
                    </div>
                  </div>

                  {/* Collapsible Engineering & DFM Thinking Accordion */}
                  {hasThinking && (
                    <div className="mb-2 rounded bg-[#0B0F14]/85 border border-[#1E2A38] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenThinking(prev => ({ ...prev, [idx]: !prev[idx] }))}
                        className="w-full px-2 py-1 text-[10px] text-amber-300 font-semibold flex items-center justify-between hover:bg-[#111821] cursor-pointer"
                      >
                        <span className="flex items-center gap-1">
                          {thinkingExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          Analyse Ingénieur & Points DFM
                        </span>
                        <span className="text-[9px] text-slate-500 font-normal">{thinkingExpanded ? 'Masquer' : 'Voir'}</span>
                      </button>
                      {thinkingExpanded && (
                        <div className="px-2.5 pb-2 pt-1 border-t border-[#1E2A38] space-y-1.5 text-[10px] text-slate-300">
                          {m.thinking.vues_et_fonction && (
                            <div><strong className="text-sky-300">Vues & Fonction :</strong> {m.thinking.vues_et_fonction}</div>
                          )}
                          {m.thinking.cotes_cles?.length > 0 && (
                            <div><strong className="text-slate-200">Cotes clés :</strong> {m.thinking.cotes_cles.join(' · ')}</div>
                          )}
                          {m.thinking.alertes_dfm?.length > 0 && (
                            <div className="text-amber-200/90">
                              <strong className="text-amber-300">DFM / Atelier :</strong>
                              <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                                {m.thinking.alertes_dfm.map((a, ai) => <li key={ai}>{a}</li>)}
                              </ul>
                            </div>
                          )}
                          {m.thinking.points_a_verifier?.length > 0 && (
                            <div className="text-purple-200/90">
                              <strong className="text-purple-300">À recouper sur plan :</strong> {m.thinking.points_a_verifier.join(' · ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inline thumbnails for user attachments */}
                  {Array.isArray(m.attachments) && m.attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {m.attachments.map((att, ai) => (
                        <div key={ai} className="relative rounded overflow-hidden border border-[#243447] bg-[#0B0F14]">
                          {att.previewUrl ? (
                            <img src={att.previewUrl} alt={att.filename} className="h-16 max-w-[120px] object-cover" />
                          ) : (
                            <div className="px-2 py-1 text-[10px] text-slate-300 flex items-center gap-1">
                              <FileText className="w-3 h-3" /> {att.filename}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : Array.isArray(m.attachmentNames) && m.attachmentNames.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {m.attachmentNames.map((nm, ai) => (
                        <span key={ai} className="px-1.5 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[10px] text-slate-400 flex items-center gap-1">
                          <Paperclip className="w-2.5 h-2.5" /> {nm}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="whitespace-pre-wrap">{m.text}</div>
                </div>
                );
              })}

              {refining && (
                <div className="p-2.5 rounded-[6px] bg-sky-950/20 border border-sky-500/20 text-sky-300 text-xs animate-pulse">
                  L’IA analyse et génère le modèle B-Rep…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {chatError && (
              <div className="mx-3 mb-2 p-2 rounded bg-red-950/50 border border-red-500/40 text-red-300 text-[11px] flex items-start gap-1.5 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{chatError}</span>
              </div>
            )}

            {/* Chat Input Bar with Attachment Preview + Paperclip (Image & PDF) + Token Saver */}
            <form onSubmit={handleAiChatSubmit} className="p-2.5 border-t border-[#1E2A38] bg-[#0E141D] space-y-2 shrink-0">
              {chatAttachments.length === 0 && (uploadedPlan || existingPlanFile) && (
                <label className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-[10px] text-slate-400 cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={includePlanNext}
                      onChange={e => setIncludePlanNext(e.target.checked)}
                      className="accent-sky-500"
                    />
                    Ré-envoyer l’image du plan ({uploadedPlan?.filename || existingPlanFile?.filename})
                  </span>
                  <span className={includePlanNext ? 'text-amber-300 font-medium' : 'text-emerald-400'}>
                    {includePlanNext ? 'Vision active' : 'Éco tokens (texte seul)'}
                  </span>
                </label>
              )}

              {chatAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {chatAttachments.map((att, idx) => (
                    <div key={idx} className="relative rounded border border-sky-500/40 bg-[#0B0F14] p-1.5 flex items-center gap-2 pr-7">
                      <img src={att.previewUrl} alt={att.filename} className="w-11 h-11 object-contain rounded bg-black/40" />
                      <div className="text-[10px] leading-tight max-w-[125px] space-y-1">
                        <div className="text-slate-200 truncate">{att.originalFilename || att.filename}</div>
                        <button
                          type="button"
                          onClick={() => handleRotateChatAttachment(idx)}
                          className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25 flex items-center gap-1 cursor-pointer"
                          title="Pivoter l'image de 90° pour la remettre droite"
                        >
                          <RotateCw className="w-2.5 h-2.5" /> Pivoter 90°
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setChatAttachments(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 p-0.5 rounded bg-slate-900/80 text-slate-400 hover:text-red-400 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-1.5">
                <label
                  className="p-2.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] hover:border-sky-400 text-slate-300 hover:text-sky-300 cursor-pointer shrink-0 transition"
                  title="Joindre une photo ou un plan PDF dans la discussion"
                >
                  <Paperclip className={`w-4 h-4 ${preparingFile ? 'animate-pulse text-sky-400' : ''}`} />
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    multiple
                    disabled={preparingFile}
                    onChange={handleChatFileSelect}
                    className="hidden"
                  />
                </label>

                <textarea
                  rows={2}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onPaste={handleChatPaste}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAiChatSubmit();
                    }
                  }}
                  placeholder={preparingFile ? 'Conversion PDF/image HD...' : 'Message à l’IA (Entrée = envoyer · Ctrl+V = coller une capture)...'}
                  className="flex-1 p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] focus:border-sky-400 focus:outline-none text-xs text-white resize-none"
                />

                <button
                  type="submit"
                  disabled={refining || preparingFile || (!aiPrompt.trim() && chatAttachments.length === 0)}
                  className="px-3 py-2.5 rounded-[6px] bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                  title="Envoyer à l'IA"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>

          {/* MANDATORY BE VALIDATION & EXPORTS (NATIVE OPENCASCADE .STEP & .STL) */}
          <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-emerald-500/35 space-y-2.5">
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
                disabled={!validatedByBe || !hasFeatures || Boolean(exportingFormat) || buildingOcct}
                onClick={() => downloadFile('step')}
                className="px-2.5 py-2 rounded-[6px] bg-[#22D3EE]/15 border border-[#22D3EE]/50 enabled:hover:bg-[#22D3EE]/25 disabled:opacity-40 text-[#22D3EE] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                title="Export .STEP B-Rep natif OpenCASCADE (ouvrable dans SolidWorks, Mastercam, Fusion 360, FreeCAD)"
              >
                <Download className="w-3.5 h-3.5" /> {exportingFormat === 'step' ? '.STEP…' : '.STEP (B-Rep)'}
              </button>
              <button
                type="button"
                disabled={!validatedByBe || !hasFeatures || Boolean(exportingFormat) || buildingOcct}
                onClick={() => downloadFile('stl')}
                className="px-2.5 py-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] enabled:hover:border-[#22D3EE] disabled:opacity-40 text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> {exportingFormat === 'stl' ? '.STL…' : '.STL'}
              </button>
              <button
                type="button"
                disabled={!validatedByBe || !hasFeatures || Boolean(exportingFormat)}
                onClick={() => downloadFile('script')}
                className="px-2.5 py-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] enabled:hover:border-purple-400 disabled:opacity-40 text-purple-300 text-xs flex items-center gap-1 cursor-pointer"
                title={isReplicad ? 'Script JavaScript Replicad / OpenCASCADE' : 'Script Python CadQuery'}
              >
                <FileCode className="w-3.5 h-3.5" /> {isReplicad ? 'Script .js' : 'CadQuery .py'}
              </button>
              {piece && (
                <button
                  type="button"
                  disabled={!validatedByBe || !hasFeatures || publishing || buildingOcct}
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
