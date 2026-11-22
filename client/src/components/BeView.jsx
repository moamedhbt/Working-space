import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Save, Upload, Box, Download, CheckSquare } from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';

function generateBoxSTL(L, W, H) {
  const x = L / 2, y = W / 2, z = H / 2;
  const tris = [
    [[-x,-y,z],[x,-y,z],[x,y,z]], [[-x,-y,z],[x,y,z],[-x,y,z]],
    [[-x,-y,-z],[x,y,-z],[x,-y,-z]], [[-x,-y,-z],[-x,y,-z],[x,y,-z]],
    [[-x,y,-z],[-x,y,z],[x,y,z]], [[-x,y,-z],[x,y,z],[x,y,-z]],
    [[-x,-y,-z],[x,-y,z],[-x,-y,z]], [[-x,-y,-z],[x,-y,-z],[x,-y,z]],
    [[x,-y,-z],[x,y,z],[x,-y,z]], [[x,-y,-z],[x,y,-z],[x,y,z]],
    [[-x,-y,-z],[-x,-y,z],[-x,y,z]], [[-x,-y,-z],[-x,y,z],[-x,y,-z]]
  ];
  let stl = 'solid piece\n';
  tris.forEach(t => {
    stl += '  facet normal 0 0 0\n    outer loop\n';
    t.forEach(v => { stl += `      vertex ${v[0]} ${v[1]} ${v[2]}\n`; });
    stl += '    endloop\n  endfacet\n';
  });
  stl += 'endsolid piece\n';
  return stl;
}

export default function BeView({ state, reload }) {
  const [dims, setDims] = useState({ longueur: 120, largeur: 60, hauteur: 40, tolerance: '±0.05 mm', matiere: '42CrMo4' });
  const [verified, setVerified] = useState(false);
  const [viewMode, setViewMode] = useState('shaded'); // shaded | wireframe | transparent
  const [showEdges, setShowEdges] = useState(true);
  const [bboxText, setBboxText] = useState('120 × 60 × 40 mm');
  const [parts, setParts] = useState([]);
  const [explode, setExplode] = useState(0);
  const [loading3d, setLoading3d] = useState(false);
  const [beToast, setBeToast] = useState('');
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const meshRef = useRef(null);
  const edgesRef = useRef(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B0F14');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 2000);
    camera.position.set(160, 120, 160);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    // 3-point lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(150, 200, 150);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x22d3ee, 0.5);
    fill.position.set(-150, 80, -120);
    scene.add(fill);

    // Grid floor
    const grid = new THREE.GridHelper(300, 20, 0x1e2a38, 0x151e29);
    grid.position.y = -40;
    scene.add(grid);

    // Default geometry
    const geom = new THREE.BoxGeometry(dims.longueur, dims.hauteur, dims.largeur);
    const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.25 });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);
    meshRef.current = mesh;

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: 0x22d3ee }));
    mesh.add(edges);
    edgesRef.current = edges;

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!el) return;
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material;
    mat.wireframe = viewMode === 'wireframe';
    mat.transparent = viewMode === 'transparent';
    mat.opacity = viewMode === 'transparent' ? 0.45 : 1;
    mat.needsUpdate = true;
    if (edgesRef.current) edgesRef.current.visible = showEdges;
  }, [viewMode, showEdges]);

  function updateBoxGeometry() {
    if (!meshRef.current) return;
    const geom = new THREE.BoxGeometry(dims.longueur, dims.hauteur, dims.largeur);
    meshRef.current.geometry.dispose();
    meshRef.current.geometry = geom;
    if (edgesRef.current) {
      edgesRef.current.geometry.dispose();
      edgesRef.current.geometry = new THREE.EdgesGeometry(geom);
    }
    setBboxText(`${dims.longueur} × ${dims.largeur} × ${dims.hauteur} mm`);
  }

  function setCameraPreset(preset) {
    if (!cameraRef.current || !controlsRef.current) return;
    const c = cameraRef.current;
    if (preset === 'iso') c.position.set(160, 120, 160);
    if (preset === 'face') c.position.set(0, 0, 220);
    if (preset === 'dessus') c.position.set(0, 220, 0.1);
    if (preset === 'droite') c.position.set(220, 0, 0);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !sceneRef.current) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'stl') {
      const reader = new FileReader();
      reader.onload = ev => {
        const loader = new STLLoader();
        const geom = loader.parse(ev.target.result);
        geom.center();
        geom.computeBoundingBox();
        const size = new THREE.Vector3();
        geom.boundingBox.getSize(size);
        setBboxText(`${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`);
        meshRef.current.geometry.dispose();
        meshRef.current.geometry = geom;
        if (edgesRef.current) {
          edgesRef.current.geometry.dispose();
          edgesRef.current.geometry = new THREE.EdgesGeometry(geom);
        }
        setParts([{ id: 0, name: file.name, visible: true, color: '#94a3b8', opacity: 1 }]);
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === 'step' || ext === 'stp') {
      setLoading3d(true);
      try {
        if (!window.occtimportjs) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/occt-import-js.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const occt = await window.occtimportjs();
        const buf = new Uint8Array(await file.arrayBuffer());
        const res = occt.ReadStepFile(buf, null);
        const loadedParts = (res.meshes || []).map((m, idx) => ({
          id: idx,
          name: m.name || `Pièce ${idx + 1}`,
          visible: true,
          color: '#94a3b8',
          opacity: 1
        }));
        setParts(loadedParts.length ? loadedParts : [{ id: 0, name: file.name, visible: true, color: '#94a3b8', opacity: 1 }]);
      } catch (err) {
        alert('Erreur lecture STEP : ' + err.message);
      } finally {
        setLoading3d(false);
      }
    }
  }

  function downloadSTL() {
    if (!verified) return alert('Veuillez cocher "Cotes vérifiées par le BE" avant le téléchargement.');
    const stl = generateBoxSTL(dims.longueur, dims.largeur, dims.hauteur);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([stl], { type: 'application/octet-stream' }));
    a.download = `piece_${dims.longueur}x${dims.largeur}x${dims.hauteur}.stl`;
    a.click();
  }

  async function saveBE(id, e) {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/pieces/${id}/be`, 'POST', {
        nomFichier: f.nomFichier.value,
        programme: f.programme.value,
        dessin3d: f.dessin3d.value
      });
      setBeToast(`Dossier BE enregistré pour ${id}.`);
      setTimeout(() => setBeToast(''), 3500);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="space-y-5">
      {beToast && (
        <div className="p-3 rounded-[6px] bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium">
          {beToast}
        </div>
      )}
      {/* 3D VIEWER + PROPERTIES */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 cyber-card p-3 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1E2A38] text-xs">
            <div className="flex items-center gap-2 font-semibold text-white">
              <Box className="w-4 h-4 text-[#22D3EE]" /> Visualiseur 3D (Three.js)
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono-num text-[11px] text-[#22D3EE] px-2 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38]">{bboxText}</span>
              <label className="px-2.5 py-1 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] cursor-pointer flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" /> {loading3d ? 'Chargement...' : 'Importer STL / STEP'}
                <input type="file" accept=".stl,.step,.stp" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          </div>

          <div ref={mountRef} className="w-full h-[300px] sm:h-[380px] rounded-[6px] overflow-hidden my-2" />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1E2A38] text-[11px]">
            <div className="flex flex-wrap gap-1">
              {[['iso', 'Iso'], ['face', 'Face'], ['dessus', 'Dessus'], ['droite', 'Droite']].map(([id, lbl]) => (
                <button key={id} onClick={() => setCameraPreset(id)} className="px-2.5 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 cursor-pointer">
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {[['shaded', 'Ombré'], ['wireframe', 'Fil de fer'], ['transparent', 'Transparent']].map(([id, lbl]) => (
                <button key={id} onClick={() => setViewMode(id)} className={`px-2.5 py-1 rounded border cursor-pointer ${viewMode === id ? 'bg-[#22D3EE]/15 border-[#22D3EE] text-[#22D3EE]' : 'bg-[#0B0F14] border-[#1E2A38] text-slate-400'}`}>
                  {lbl}
                </button>
              ))}
              <button onClick={() => setShowEdges(!showEdges)} className={`px-2.5 py-1 rounded border cursor-pointer ${showEdges ? 'bg-[#22D3EE]/15 border-[#22D3EE] text-[#22D3EE]' : 'bg-[#0B0F14] border-[#1E2A38] text-slate-400'}`}>
                Arêtes
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: DIMENSIONS & VALIDATION */}
        <div className="lg:col-span-4 space-y-4">
          <div className="cyber-card p-4 space-y-3 text-xs">
            <div className="font-semibold text-sm text-white">Cotes & Validation BE</div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[10px] text-slate-400">L (mm)</label><input type="number" value={dims.longueur} onChange={e => setDims({ ...dims, longueur: +e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
              <div><label className="text-[10px] text-slate-400">l (mm)</label><input type="number" value={dims.largeur} onChange={e => setDims({ ...dims, largeur: +e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
              <div><label className="text-[10px] text-slate-400">H (mm)</label><input type="number" value={dims.hauteur} onChange={e => setDims({ ...dims, hauteur: +e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
            </div>
            <button onClick={updateBoxGeometry} className="w-full py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] font-medium cursor-pointer">
              Mettre à jour le modèle 3D
            </button>
            <label className="flex items-center gap-2 cursor-pointer text-slate-300 pt-1">
              <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} className="accent-[#22D3EE]" />
              <CheckSquare className="w-3.5 h-3.5 text-[#22D3EE]" /> Cotes vérifiées par le BE (obligatoire)
            </label>
            <button onClick={downloadSTL} className={`w-full py-2 rounded-[6px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${verified ? 'bg-[#22D3EE] text-[#0B0F14]' : 'bg-slate-800 text-slate-500'}`}>
              <Download className="w-3.5 h-3.5" /> Télécharger .STL
            </button>
          </div>

          <MaterialCalculator />
        </div>
      </div>

      {/* DOSSIERS PIECES BE */}
      <div className="cyber-card p-4 space-y-3">
        <div className="font-semibold text-sm text-white">Dossiers Pièces — Plans, Programmes CNC & Dessins 3D</div>
        {state.pieces.map(p => (
          <form key={p.id} onSubmit={e => saveBE(p.id, e)} className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 text-xs space-y-2">
            <div className="flex justify-between font-semibold">
              <span className="font-mono-num text-white">{p.id} · <span className="font-sans">{p.nom}</span></span>
              <span className="text-[#22D3EE]">{p.urgence}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              <input name="nomFichier" defaultValue={p.be.nomFichier} placeholder="Nom fichier" className="p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38]" />
              <input name="programme" defaultValue={p.be.programme} placeholder="Programme CNC" className="p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] font-mono-num" />
              <input name="dessin3d" defaultValue={p.be.dessin3d} placeholder="Dessin 3D / STEP" className="p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] font-mono-num" />
              <button type="submit" className="px-3 py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
                <Save className="w-3.5 h-3.5" /> Enregistrer
              </button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
