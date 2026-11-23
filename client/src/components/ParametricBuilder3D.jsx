import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Bot, Box, Download, Upload, Sparkles, AlertTriangle, CheckCircle2,
  Send, Trash2, Code2, CheckSquare, Layers, FileText
} from 'lucide-react';
import { api } from '../api';
import {
  buildCsgSolidFromSpec,
  exportMeshToStlBuffer,
  exportMeshToStepText,
  exportSpecToCadQueryPython
} from '../utils/cadCsgEngine';

const PRESETS = {
  arbre: {
    unit: 'mm', name: 'Arbre_Etage',
    features: [
      { id: 'f1', label: 'Corps Ø50 L120', op: 'add_cylinder', axis: 'x', diameter: 50, length: 120, x: 0, y: 0, z: 0 },
      { id: 'f2', label: 'Épaulement Ø35 L40', op: 'add_cylinder', axis: 'x', diameter: 35, length: 40, x: 80, y: 0, z: 0 }
    ]
  },
  bague: {
    unit: 'mm', name: 'Bague_Centrage',
    features: [
      { id: 'f1', label: 'Cylindre ext. Ø60 L45', op: 'add_cylinder', axis: 'x', diameter: 60, length: 45, x: 0, y: 0, z: 0 },
      { id: 'f2', label: 'Alésage central Ø30', op: 'cut_bore', axis: 'x', diameter: 30, length: 55, x: 0, y: 0, z: 0 }
    ]
  },
  bride: {
    unit: 'mm', name: 'Bride_Percee',
    features: [
      { id: 'f1', label: 'Disque Ø120 ép.20', op: 'add_cylinder', axis: 'z', diameter: 120, length: 20, x: 0, y: 0, z: 0 },
      { id: 'f2', label: 'Alésage Ø42', op: 'cut_bore', axis: 'z', diameter: 42, length: 30, x: 0, y: 0, z: 0 },
      { id: 'f3', label: '6× Trous Ø10 sur PCD Ø85', op: 'cut_hole_pattern', axis: 'z', count: 6, holeDiameter: 10, pcd: 85, depth: 30, startAngleDeg: 0, x: 0, y: 0, z: 0 }
    ]
  },
  plaque: {
    unit: 'mm', name: 'Plaque_Support',
    features: [
      { id: 'f1', label: 'Bloc 140×90×20', op: 'add_box', lx: 140, ly: 90, lz: 20, x: 0, y: 0, z: 0 },
      { id: 'f2', label: 'Alésage central Ø32', op: 'cut_bore', axis: 'z', diameter: 32, length: 30, x: 0, y: 0, z: 0 },
      { id: 'f3', label: '4× Trous Ø10', op: 'cut_hole_pattern', axis: 'z', count: 4, holeDiameter: 10, pcd: 90, depth: 30, startAngleDeg: 45, x: 0, y: 0, z: 0 }
    ]
  },
  ecrou_complexe: {
    unit: 'mm', name: 'Ecrou_Manchon_Complexe',
    features: [
      { id: 'f1', label: 'Corps principal Ø120 L190', op: 'add_cylinder', axis: 'x', diameter: 120, length: 190, x: 0, y: 0, z: 0 },
      { id: 'f2', label: 'Manchons Ø95 L230', op: 'add_cylinder', axis: 'x', diameter: 95, length: 230, x: 0, y: 0, z: 0 },
      { id: 'f3', label: 'Méplat latéral (114.5 mm)', op: 'cut_flat', side: '+y', distanceFromCenter: 54.5, span: 240 },
      { id: 'f4', label: 'Alésage central Ø60', op: 'cut_bore', axis: 'x', diameter: 60, length: 240, x: 0, y: 0, z: 0 },
      { id: 'f5', label: '6× Inserts Téflon Ø10 sur PCD Ø70', op: 'cut_hole_pattern', axis: 'x', count: 6, holeDiameter: 10, pcd: 70, depth: 240, startAngleDeg: 38, x: 0, y: 0, z: 0 },
      { id: 'f6', label: 'Rainure centrale L25', op: 'cut_slot', lx: 25, ly: 130, lz: 12, x: 0, y: 0, z: 54 }
    ]
  }
};

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function ParametricBuilder3D({ piece, onPublishToOf, onReload }) {
  const mountRef = useRef(null);
  const solidMeshRef = useRef(null);

  const [cadSpec, setCadSpec] = useState(PRESETS.ecrou_complexe);
  const [bboxDims, setBboxDims] = useState({ x: 0, y: 0, z: 0 });
  const [wireframe, setWireframe] = useState(false);

  // Uploaded / active 2D plan context for AI analysis + refinement
  const [planSource, setPlanSource] = useState(null); // { fileId?, filename, base64? }
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMeta, setAnalysisMeta] = useState(null);
  const [fiche, setFiche] = useState(null);

  // Engineer refinement prompt loop
  const [refinePrompt, setRefinePrompt] = useState('');
  const [refining, setRefining] = useState(false);
  const [promptHistory, setPromptHistory] = useState([]);

  // Mandatory Engineer Validation before export/publish
  const [engineerValidated, setEngineerValidated] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [applyingFiche, setApplyingFiche] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Rebuild CSG solid whenever cadSpec or wireframe changes
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 520;
    const h = el.clientHeight || 320;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B0F14');
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const dl1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dl1.position.set(180, 220, 180);
    scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0x22d3ee, 0.45);
    dl2.position.set(-160, -100, -140);
    scene.add(dl2);
    scene.add(new THREE.GridHelper(400, 20, 0x1e2a38, 0x15202b));

    const { mesh, dimensions } = buildCsgSolidFromSpec(cadSpec);
    mesh.material.wireframe = wireframe;
    solidMeshRef.current = mesh;
    setBboxDims(dimensions);
    scene.add(mesh);

    if (!wireframe) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 28),
        new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.4 })
      );
      mesh.add(edges);
    }

    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 25);
    controls.target.copy(center);
    camera.position.set(center.x + maxDim * 1.35, center.y + maxDim * 0.85, center.z + maxDim * 1.35);
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
  }, [cadSpec, wireframe]);

  async function runPlanAnalysis(payload, srcInfo) {
    setAnalyzing(true);
    setStatusMsg('');
    setEngineerValidated(false);
    try {
      const res = await api('/api/be/analyze-plan', 'POST', {
        ...payload,
        notes: `${piece?.nom || ''} ${piece?.matiere || ''}`
      });
      setPlanSource(srcInfo);
      setAnalysisMeta({ mode: res.mode, visionConfigured: res.visionConfigured, disclaimer: res.disclaimer });
      if (res.ficheTechnique) setFiche(res.ficheTechnique);
      if (res.cadSpec && res.cadSpec.features?.length > 0) {
        setCadSpec(res.cadSpec);
      }
      setPromptHistory([]);
    } catch (e) {
      setStatusMsg(`Erreur : ${e.message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleUpload2DPlan(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Lecture fichier impossible'));
      r.readAsDataURL(file);
    });
    await runPlanAnalysis({ filename: file.name, base64 }, { filename: file.name, base64 });
    e.target.value = '';
  }

  async function handleRefine3D(customText = null) {
    const text = (customText ?? refinePrompt).trim();
    if (!text) return;
    setRefining(true);
    setEngineerValidated(false);
    setStatusMsg('');
    try {
      const res = await api('/api/be/refine-3d', 'POST', {
        ...(planSource || {}),
        cadSpec,
        ficheTechnique: fiche,
        prompt: text
      });
      if (res.cadSpec && res.cadSpec.features?.length > 0) {
        setCadSpec(res.cadSpec);
      }
      setPromptHistory(prev => [{ prompt: text, reply: res.changesSummary, mode: res.mode }, ...prev]);
      if (!customText) setRefinePrompt('');
    } catch (e) {
      setStatusMsg(`Erreur correction IA : ${e.message}`);
    } finally {
      setRefining(false);
    }
  }

  async function applyFicheToOf(replaceOperations = false) {
    if (!piece || !fiche) return;
    setApplyingFiche(true);
    try {
      await api(`/api/pieces/${piece.id}/apply-fiche-ia`, 'POST', { ficheTechnique: fiche, replaceOperations });
      setStatusMsg(replaceOperations
        ? `Fiche technique + gamme d'opérations appliquées à ${piece.id} !`
        : `Matière et tolérances critiques appliquées à ${piece.id} !`);
      onReload?.();
    } catch (e) {
      setStatusMsg(`Erreur : ${e.message}`);
    } finally {
      setApplyingFiche(false);
    }
  }

  function removeFeature(fid) {
    setEngineerValidated(false);
    setCadSpec(prev => ({
      ...prev,
      features: prev.features.filter(f => f.id !== fid)
    }));
  }

  function downloadSTL() {
    if (!engineerValidated) return setStatusMsg('Cochez la validation Ingénieur BE avant export.');
    if (!solidMeshRef.current) return;
    const buf = exportMeshToStlBuffer(solidMeshRef.current);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
    a.download = `${piece?.id || cadSpec.name || 'piece'}.stl`;
    a.click();
  }

  function downloadSTEP() {
    if (!engineerValidated) return setStatusMsg('Cochez la validation Ingénieur BE avant export.');
    if (!solidMeshRef.current) return;
    const stepText = exportMeshToStepText(solidMeshRef.current, piece?.id || cadSpec.name || 'PIECE_CNC');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([stepText], { type: 'application/step' }));
    a.download = `${piece?.id || cadSpec.name || 'piece'}.step`;
    a.click();
  }

  function downloadCadQueryPy() {
    const py = exportSpecToCadQueryPython(cadSpec);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([py], { type: 'text/x-python' }));
    a.download = `${piece?.id || cadSpec.name || 'piece'}_cadquery.py`;
    a.click();
  }

  async function publishToOf(format = 'stl') {
    if (!engineerValidated) return setStatusMsg('Validation Ingénieur BE obligatoire avant publication dans l’OF.');
    if (!piece || !solidMeshRef.current) return;
    setPublishing(true);
    try {
      let base64, filename;
      if (format === 'step') {
        const stepText = exportMeshToStepText(solidMeshRef.current, piece.id);
        base64 = btoa(unescape(encodeURIComponent(stepText)));
        filename = `${piece.id}_IA_valide.step`;
      } else {
        const buf = exportMeshToStlBuffer(solidMeshRef.current);
        base64 = arrayBufferToBase64(buf);
        filename = `${piece.id}_IA_valide.stl`;
      }
      await onPublishToOf?.({
        filename,
        base64,
        notes: `3D CSG validé BE (${bboxDims.x}×${bboxDims.y}×${bboxDims.z} mm · ${cadSpec.features.length} fonctions)`
      });
      setStatusMsg(`${filename} publié dans l'OF ${piece.id} !`);
    } finally {
      setPublishing(false);
    }
  }

  const clientPlan = piece?.be?.clientFile;
  const activePlan = piece?.be?.planFile;

  return (
    <div className="cyber-card cyber-corners p-4 space-y-4 text-xs">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2A38] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#22D3EE]" /> Studio IA Plan 2D → Fiche Technique & Modélisation 3D CSG / CadQuery
          </h3>
          <p className="text-[11px] text-slate-400">
            Importez la photo/PDF du plan 2D : l'IA extrait la fiche technique + génère le 3D, puis affinez par prompt ingénieur avant validation BE.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(clientPlan || activePlan) && (
            <button
              type="button"
              disabled={analyzing}
              onClick={() => runPlanAnalysis({ fileId: (clientPlan || activePlan).id }, { fileId: (clientPlan || activePlan).id, filename: (clientPlan || activePlan).filename })}
              className="px-2.5 py-1.5 rounded bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" /> {analyzing ? 'Analyse IA...' : 'Lire Plan 2D de cet OF'}
            </button>
          )}
          <label className="px-2.5 py-1.5 rounded bg-[#0B0F14] border border-[#22D3EE]/40 text-[#22D3EE] hover:bg-[#22D3EE]/10 font-semibold flex items-center gap-1 cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Photo / PDF Plan 2D
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleUpload2DPlan} className="hidden" />
          </label>
        </div>
      </div>

      {statusMsg && (
        <div className="p-2.5 rounded bg-[#22D3EE]/10 border border-[#22D3EE]/40 text-[#22D3EE] font-medium">
          {statusMsg}
        </div>
      )}

      {/* EXTRACTED FICHE TECHNIQUE 2D */}
      {fiche && (
        <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#22D3EE]/35 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-[#22D3EE] flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> Fiche Technique extraite du Plan 2D
              {analysisMeta?.mode && (
                <span className="px-1.5 py-0.5 rounded bg-[#111821] border border-[#1E2A38] text-[10px] font-mono-num text-slate-300">
                  {analysisMeta.mode}
                </span>
              )}
            </div>
            {piece && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={applyingFiche}
                  onClick={() => applyFicheToOf(false)}
                  className="px-2.5 py-1 rounded bg-[#111821] border border-[#22D3EE]/40 text-[#22D3EE] font-semibold cursor-pointer"
                >
                  Appliquer Matière & Tolérances
                </button>
                <button
                  type="button"
                  disabled={applyingFiche}
                  onClick={() => applyFicheToOf(true)}
                  className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold cursor-pointer"
                >
                  + Appliquer la Gamme IA à {piece.id}
                </button>
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-300">{fiche.summary}</div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2 rounded bg-[#111821] border border-[#1E2A38]">
              <div className="text-[10px] text-slate-500">Client / Réf.</div>
              <div className="text-white font-medium truncate">{[fiche.client, fiche.reference, fiche.revision].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            <div className="p-2 rounded bg-[#111821] border border-[#1E2A38]">
              <div className="text-[10px] text-slate-500">Matière détectée</div>
              <div className="text-emerald-300 font-medium truncate">{fiche.material || 'À confirmer'}</div>
            </div>
            <div className="p-2 rounded bg-[#111821] border border-[#1E2A38] col-span-2">
              <div className="text-[10px] text-slate-500">Débit brut conseillé</div>
              <div className="text-[#22D3EE] font-mono-num">{fiche.rawStock || '—'}</div>
            </div>
          </div>

          {(fiche.criticalTolerances?.length > 0 || fiche.specialNotes?.length > 0) && (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {(fiche.criticalTolerances || []).map((t, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono-num">{t}</span>
              ))}
              {(fiche.specialNotes || []).map((n, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-200">{n}</span>
              ))}
            </div>
          )}

          {fiche.suggestedOperations?.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-[#1E2A38]">
              <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
                <Layers className="w-3 h-3 text-[#22D3EE]" /> Gamme suggérée par l'IA
              </div>
              <div className="grid sm:grid-cols-3 gap-1.5">
                {fiche.suggestedOperations.map((op, i) => (
                  <div key={i} className="p-2 rounded bg-[#111821] border border-[#1E2A38] text-[11px]">
                    <span className="font-mono-num text-[#22D3EE] font-semibold">Op {(i + 1) * 10}</span> · <span className="text-white">{op.libelle}</span>
                    <div className="text-[10px] text-slate-400 mt-0.5">{op.typeMachine} · Régl. {op.tempsReglageMin}m · {op.tempsUnitaireMin}m/pc</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MAIN 3D CSG STUDIO + FEATURE TREE + ENGINEER PROMPT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* LEFT: 3D VIEWPORT + PROMPT REFINEMENT */}
        <div className="lg:col-span-7 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {[
                ['ecrou_complexe', 'Écrou/Manchon'],
                ['arbre', 'Arbre'],
                ['bague', 'Bague'],
                ['bride', 'Bride'],
                ['plaque', 'Plaque']
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setCadSpec(PRESETS[k]); setEngineerValidated(false); }}
                  className="px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-[10px] text-slate-300 cursor-pointer"
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono-num">
              <span className="text-[#22D3EE]">{bboxDims.x} × {bboxDims.y} × {bboxDims.z} mm</span>
              <button
                type="button"
                onClick={() => setWireframe(w => !w)}
                className="px-2 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-slate-300 cursor-pointer"
              >
                {wireframe ? 'Solide' : 'Filaire'}
              </button>
            </div>
          </div>

          <div ref={mountRef} className="h-72 sm:h-80 rounded border border-[#1E2A38] bg-[#0B0F14] overflow-hidden" />

          {/* ENGINEER PROMPT TO CORRECT / ADD MISSING FEATURES */}
          <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#22D3EE]/35 space-y-2">
            <div className="font-semibold text-[#22D3EE] flex items-center gap-1.5 text-[11px]">
              <Bot className="w-3.5 h-3.5" /> Prompt Ingénieur BE — Corriger ou ajouter ce qui manque par rapport au plan 2D
            </div>
            <div className="flex gap-1.5">
              <input
                value={refinePrompt}
                onChange={e => setRefinePrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleRefine3D(); } }}
                placeholder="Ex: Ajoute 6 trous Ø10 sur PCD 70 à 38°, ajoute méplat 114.5 mm, ajoute rainure 25x12..."
                className="flex-1 px-2.5 py-2 rounded bg-[#111821] border border-[#1E2A38] focus:border-[#22D3EE] focus:outline-none text-base sm:text-xs text-white"
              />
              <button
                type="button"
                disabled={refining || !refinePrompt.trim()}
                onClick={() => handleRefine3D()}
                className="px-3 py-2 rounded bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Send className="w-3.5 h-3.5" /> {refining ? '...' : 'Appliquer'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                'Ajoute 6 trous Ø10 sur PCD 70 à 38°',
                'Ajoute méplat à 114.5 mm',
                'Ajoute rainure 25x12 mm',
                'Ajoute alésage Ø60',
                'Ajoute filetage Tr 65x8'
              ].map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleRefine3D(chip)}
                  className="px-2 py-0.5 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-[10px] text-slate-300 cursor-pointer"
                >
                  + {chip}
                </button>
              ))}
            </div>
            {promptHistory.length > 0 && (
              <div className="space-y-1 max-h-24 overflow-y-auto pt-1 border-t border-[#1E2A38] text-[10px]">
                {promptHistory.map((h, i) => (
                  <div key={i} className="text-slate-300">
                    <strong className="text-white">BE :</strong> {h.prompt} → <span className="text-emerald-300">{h.reply}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: CAD FEATURE TREE + VALIDATION + EXPORTS */}
        <div className="lg:col-span-5 flex flex-col justify-between bg-[#0B0F14] border border-[#1E2A38] rounded p-3 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Box className="w-3.5 h-3.5 text-[#22D3EE]" /> Arbre des fonctions CAO ({cadSpec.features.length})
              </span>
              <span className="text-[10px] text-slate-500">CSG Booléen exact</span>
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {cadSpec.features.map((f, idx) => (
                <div key={f.id || idx} className="p-2 rounded bg-[#111821] border border-[#1E2A38] flex items-center justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1 rounded text-[9px] font-mono-num ${f.op.startsWith('add') ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                        {f.op.startsWith('add') ? '+' : '−'}
                      </span>
                      <span className="text-white font-medium truncate">{f.label}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono-num">
                      {f.op}
                      {f.diameter ? ` · Ø${f.diameter}` : ''}
                      {f.length ? ` · L${f.length}` : ''}
                      {f.pcd ? ` · PCD ${f.pcd}` : ''}
                      {f.distanceFromCenter ? ` · d=${f.distanceFromCenter}` : ''}
                    </div>
                  </div>
                  {cadSpec.features.length > 1 && (
                    <button type="button" onClick={() => removeFeature(f.id)} className="text-red-400 hover:text-red-300 cursor-pointer shrink-0" title="Supprimer fonction">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-[#1E2A38]">
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Contrôlez toutes les cotes et tolérances par rapport au plan 2D avant de valider et publier le fichier 3D.</span>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-slate-200 font-medium">
              <input
                type="checkbox"
                checked={engineerValidated}
                onChange={e => setEngineerValidated(e.target.checked)}
                className="accent-[#22D3EE]"
              />
              <CheckSquare className="w-4 h-4 text-[#22D3EE] shrink-0" />
              <span>Validation Ingénieur BE : 3D conforme au plan 2D</span>
            </label>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={downloadSTL}
                className={`py-1.5 rounded border flex items-center justify-center gap-1 cursor-pointer ${
                  engineerValidated ? 'bg-[#111821] border-[#22D3EE]/50 text-[#22D3EE]' : 'bg-[#111821] border-[#1E2A38] text-slate-500'
                }`}
              >
                <Download className="w-3.5 h-3.5" /> .STL
              </button>
              <button
                type="button"
                onClick={downloadSTEP}
                className={`py-1.5 rounded border flex items-center justify-center gap-1 cursor-pointer ${
                  engineerValidated ? 'bg-[#111821] border-[#22D3EE]/50 text-[#22D3EE]' : 'bg-[#111821] border-[#1E2A38] text-slate-500'
                }`}
              >
                <Download className="w-3.5 h-3.5" /> .STEP
              </button>
              <button
                type="button"
                onClick={downloadCadQueryPy}
                className="py-1.5 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 flex items-center justify-center gap-1 cursor-pointer"
                title="Exporter le script Python CadQuery (.py)"
              >
                <Code2 className="w-3.5 h-3.5" /> CadQuery
              </button>
            </div>

            {piece && (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={publishing || !engineerValidated}
                  onClick={() => publishToOf('stl')}
                  className={`py-2 rounded font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                    engineerValidated ? 'bg-[#22D3EE] text-[#0B0F14]' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Publier .STL ({piece.id})
                </button>
                <button
                  type="button"
                  disabled={publishing || !engineerValidated}
                  onClick={() => publishToOf('step')}
                  className={`py-2 rounded font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                    engineerValidated ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" /> Publier .STEP
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
