import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Box, Upload, Eye, EyeOff, Layers } from 'lucide-react';

async function loadOcctImport() {
  if (!window.occtimportjs) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/occt-import-js.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossible de charger le moteur STEP (vérifiez votre connexion internet).'));
      document.head.appendChild(s);
    });
  }
  return window.occtimportjs({
    locateFile: name => `https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/${name}`
  });
}

function fitCameraToGroup(group, camera, controls) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return { x: 0, y: 0, z: 0 };
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Center the group at origin
  group.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z, 10);
  const dist = maxDim * 1.85;
  camera.position.set(dist * 0.8, dist * 0.65, dist * 0.8);
  camera.near = Math.max(0.05, maxDim / 500);
  camera.far = Math.max(2000, maxDim * 25);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();

  return size;
}

export default function ModelViewer3D({
  dims = null,
  fileUrl = null,
  fileName = '',
  allowUpload = true,
  heightClass = 'h-[320px] sm:h-[380px]',
  title = 'Visualiseur 3D (STL & STEP)'
}) {
  const [viewMode, setViewMode] = useState('shaded');
  const [showEdges, setShowEdges] = useState(true);
  const [bboxText, setBboxText] = useState(dims ? `${dims.longueur} × ${dims.largeur} × ${dims.hauteur} mm` : '—');
  const [parts, setParts] = useState([]);
  const [explode, setExplode] = useState(0);
  const [loading3d, setLoading3d] = useState(false);
  const [error3d, setError3d] = useState('');
  const [activeFileLabel, setActiveFileLabel] = useState(fileName || '');

  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const rootGroupRef = useRef(null);
  const meshesRef = useRef([]); // [{ mesh, edges, basePos, dirVec }]
  const maxDimRef = useRef(150);

  function clearCurrentModel() {
    const group = rootGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
    group.position.set(0, 0, 0);
    meshesRef.current = [];
  }

  function applyMaterialSettings(mode = viewMode, edgesVisible = showEdges) {
    meshesRef.current.forEach(({ mesh, edges }) => {
      if (mesh.material) {
        mesh.material.wireframe = mode === 'wireframe';
        mesh.material.transparent = mode === 'transparent';
        mesh.material.opacity = mode === 'transparent' ? 0.45 : 1;
        mesh.material.needsUpdate = true;
      }
      if (edges) edges.visible = edgesVisible && mesh.visible;
    });
  }

  function buildBox(L, W, H) {
    if (!rootGroupRef.current || !cameraRef.current || !controlsRef.current) return;
    clearCurrentModel();
    const geom = new THREE.BoxGeometry(L, H, W);
    const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.75, roughness: 0.28 });
    const mesh = new THREE.Mesh(geom, mat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: 0x22d3ee }));
    mesh.add(edges);
    rootGroupRef.current.add(mesh);
    meshesRef.current = [{ mesh, edges, basePos: new THREE.Vector3(), dirVec: new THREE.Vector3() }];
    const size = fitCameraToGroup(rootGroupRef.current, cameraRef.current, controlsRef.current);
    maxDimRef.current = Math.max(size.x, size.y, size.z, 20);
    setBboxText(`${L} × ${W} × ${H} mm`);
    setParts([{ id: 0, name: `Bloc ${L}×${W}×${H}`, visible: true, color: '#94a3b8' }]);
    setExplode(0);
    applyMaterialSettings();
  }

  async function loadArrayBuffer(buffer, name) {
    if (!rootGroupRef.current || !cameraRef.current || !controlsRef.current) return;
    const ext = (name || '').split('.').pop().toLowerCase();
    setError3d('');
    setLoading3d(true);
    setActiveFileLabel(name);

    try {
      if (ext === 'stl') {
        const loader = new STLLoader();
        const geom = loader.parse(buffer);
        geom.computeVertexNormals();
        clearCurrentModel();
        const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.75, roughness: 0.28 });
        const mesh = new THREE.Mesh(geom, mat);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 24), new THREE.LineBasicMaterial({ color: 0x22d3ee }));
        mesh.add(edges);
        rootGroupRef.current.add(mesh);
        meshesRef.current = [{ mesh, edges, basePos: new THREE.Vector3(), dirVec: new THREE.Vector3() }];
        const size = fitCameraToGroup(rootGroupRef.current, cameraRef.current, controlsRef.current);
        maxDimRef.current = Math.max(size.x, size.y, size.z, 20);
        setBboxText(`${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`);
        setParts([{ id: 0, name, visible: true, color: '#94a3b8' }]);
        setExplode(0);
        applyMaterialSettings();
      } else if (ext === 'step' || ext === 'stp') {
        const occt = await loadOcctImport();
        const res = occt.ReadStepFile(new Uint8Array(buffer), null);
        if (!res || !res.success || !Array.isArray(res.meshes) || res.meshes.length === 0) {
          throw new Error('Fichier STEP vide ou non reconnu.');
        }

        clearCurrentModel();
        const palette = [0x94a3b8, 0x38bdf8, 0x34d399, 0xfbbf24, 0xa78bfa, 0xf87171];
        const loadedParts = [];
        const created = [];

        res.meshes.forEach((m, idx) => {
          const geom = new THREE.BufferGeometry();
          const posArr = m.attributes?.position?.array;
          if (!posArr || posArr.length === 0) return;
          geom.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
          if (m.attributes?.normal?.array) {
            geom.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
          }
          if (m.index?.array) {
            geom.setIndex(Array.from(m.index.array));
          }
          if (!m.attributes?.normal?.array) geom.computeVertexNormals();

          let colorHex = palette[idx % palette.length];
          if (Array.isArray(m.color) && m.color.length >= 3) {
            const c = new THREE.Color(m.color[0], m.color[1], m.color[2]);
            colorHex = c.getHex();
          }
          const mat = new THREE.MeshStandardMaterial({
            color: colorHex,
            metalness: 0.65,
            roughness: 0.32,
            side: THREE.DoubleSide
          });
          const mesh = new THREE.Mesh(geom, mat);
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geom, 28),
            new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6 })
          );
          mesh.add(edges);
          rootGroupRef.current.add(mesh);

          geom.computeBoundingBox();
          const partCenter = new THREE.Vector3();
          geom.boundingBox.getCenter(partCenter);

          created.push({ mesh, edges, basePos: new THREE.Vector3(), partCenter });
          loadedParts.push({
            id: created.length - 1,
            name: m.name || `Pièce ${idx + 1}`,
            visible: true,
            color: '#' + colorHex.toString(16).padStart(6, '0')
          });
        });

        const totalBox = new THREE.Box3().setFromObject(rootGroupRef.current);
        const totalCenter = new THREE.Vector3();
        totalBox.getCenter(totalCenter);
        created.forEach(item => {
          const dir = item.partCenter.clone().sub(totalCenter);
          if (dir.lengthSq() < 0.001) dir.set(0, 1, 0);
          else dir.normalize();
          item.dirVec = dir;
        });

        meshesRef.current = created;
        const size = fitCameraToGroup(rootGroupRef.current, cameraRef.current, controlsRef.current);
        maxDimRef.current = Math.max(size.x, size.y, size.z, 20);
        setBboxText(`${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`);
        setParts(loadedParts);
        setExplode(0);
        applyMaterialSettings();
      } else {
        throw new Error(`Format 3D non supporté (${ext}). Utilisez .STL ou .STEP/.STP.`);
      }
    } catch (err) {
      setError3d(err.message || 'Erreur de lecture 3D');
    } finally {
      setLoading3d(false);
    }
  }

  // Initialize Three.js scene
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B0F14');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / (el.clientHeight || 320), 0.1, 5000);
    camera.position.set(160, 120, 160);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(el.clientWidth, el.clientHeight || 320);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(200, 260, 180);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x22d3ee, 0.55);
    fill.position.set(-180, 90, -140);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(0, -180, -100);
    scene.add(rim);

    const grid = new THREE.GridHelper(300, 20, 0x1e2a38, 0x151e29);
    grid.position.y = -60;
    scene.add(grid);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroupRef.current = rootGroup;

    if (dims && !fileUrl) {
      buildBox(dims.longueur, dims.largeur, dims.hauteur);
    }

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!el) return;
      camera.aspect = el.clientWidth / (el.clientHeight || 320);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight || 320);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      clearCurrentModel();
      renderer.dispose();
    };
  }, []);

  // Update parametric box when dims change (only if no external file loaded)
  useEffect(() => {
    if (dims && !fileUrl && !activeFileLabel) {
      buildBox(dims.longueur, dims.largeur, dims.hauteur);
    }
  }, [dims?.longueur, dims?.largeur, dims?.hauteur]);

  // Auto-load external fileUrl (e.g. uploaded OF 3D file)
  useEffect(() => {
    if (!fileUrl) return;
    let cancelled = false;
    setLoading3d(true);
    setError3d('');
    fetch(fileUrl)
      .then(r => {
        if (!r.ok) throw new Error('Impossible de télécharger le fichier 3D');
        return r.arrayBuffer();
      })
      .then(buf => {
        if (!cancelled) loadArrayBuffer(buf, fileName || fileUrl.split('/').pop());
      })
      .catch(err => {
        if (!cancelled) {
          setError3d(err.message);
          setLoading3d(false);
        }
      });
    return () => { cancelled = true; };
  }, [fileUrl, fileName]);

  useEffect(() => {
    applyMaterialSettings(viewMode, showEdges);
  }, [viewMode, showEdges]);

  // Apply exploded view offset
  useEffect(() => {
    const scale = (explode / 100) * (maxDimRef.current * 0.45);
    meshesRef.current.forEach(item => {
      item.mesh.position.copy(item.basePos).addScaledVector(item.dirVec, scale);
    });
  }, [explode]);

  function setCameraPreset(preset) {
    if (!cameraRef.current || !controlsRef.current) return;
    const c = cameraRef.current;
    const d = maxDimRef.current * 1.9;
    if (preset === 'iso') c.position.set(d * 0.8, d * 0.65, d * 0.8);
    if (preset === 'face') c.position.set(0, 0, d);
    if (preset === 'dessus') c.position.set(0, d, 0.1);
    if (preset === 'droite') c.position.set(d, 0, 0);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }

  function togglePartVisibility(idx) {
    setParts(prev => prev.map(p => {
      if (p.id !== idx) return p;
      const nextVis = !p.visible;
      const entry = meshesRef.current[idx];
      if (entry) {
        entry.mesh.visible = nextVis;
        if (entry.edges) entry.edges.visible = nextVis && showEdges;
      }
      return { ...p, visible: nextVis };
    }));
  }

  async function handleLocalFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    loadArrayBuffer(buf, file.name);
  }

  return (
    <div className="cyber-card p-3 flex flex-col space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1E2A38] text-xs">
        <div className="flex items-center gap-2 font-semibold text-white min-w-0">
          <Box className="w-4 h-4 text-[#22D3EE] shrink-0" />
          <span className="truncate">{title}{activeFileLabel ? ` · ${activeFileLabel}` : ''}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono-num text-[11px] text-[#22D3EE] px-2 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38]">{bboxText}</span>
          {allowUpload && (
            <label className="px-2.5 py-1 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] cursor-pointer flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" /> {loading3d ? 'Chargement...' : 'Importer STL / STEP'}
              <input type="file" accept=".stl,.step,.stp" className="hidden" onChange={handleLocalFile} />
            </label>
          )}
        </div>
      </div>

      {error3d && (
        <div className="p-2 rounded bg-red-500/15 border border-red-500/40 text-red-300 text-xs">{error3d}</div>
      )}

      <div className="relative">
        <div ref={mountRef} className={`w-full ${heightClass} rounded-[6px] overflow-hidden`} />
        {loading3d && (
          <div className="absolute inset-0 bg-[#0B0F14]/80 flex items-center justify-center text-xs font-mono-num text-[#22D3EE]">
            Chargement du modèle 3D...
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1E2A38] text-[11px]">
        <div className="flex flex-wrap gap-1">
          {[['iso', 'Iso'], ['face', 'Face'], ['dessus', 'Dessus'], ['droite', 'Droite']].map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setCameraPreset(id)} className="px-2.5 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 cursor-pointer">
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {[['shaded', 'Ombré'], ['wireframe', 'Fil de fer'], ['transparent', 'Transparent']].map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setViewMode(id)} className={`px-2.5 py-1 rounded border cursor-pointer ${viewMode === id ? 'bg-[#22D3EE]/15 border-[#22D3EE] text-[#22D3EE]' : 'bg-[#0B0F14] border-[#1E2A38] text-slate-400'}`}>
              {lbl}
            </button>
          ))}
          <button type="button" onClick={() => setShowEdges(!showEdges)} className={`px-2.5 py-1 rounded border cursor-pointer ${showEdges ? 'bg-[#22D3EE]/15 border-[#22D3EE] text-[#22D3EE]' : 'bg-[#0B0F14] border-[#1E2A38] text-slate-400'}`}>
            Arêtes
          </button>
        </div>
      </div>

      {/* ASSEMBLY TREE + EXPLODED VIEW (for multi-part STEP assemblies) */}
      {parts.length > 1 && (
        <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-2.5 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#22D3EE]" /> Arbre d'assemblage ({parts.length} composants)
            </span>
            <label className="flex items-center gap-2 text-[11px] text-slate-300">
              Vue éclatée :
              <input type="range" min="0" max="100" value={explode} onChange={e => setExplode(Number(e.target.value))} className="w-24 accent-[#22D3EE]" />
              <span className="font-mono-num w-8">{explode}%</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {parts.map(pt => (
              <button
                key={pt.id}
                type="button"
                onClick={() => togglePartVisibility(pt.id)}
                className={`px-2 py-1 rounded border text-[10px] flex items-center gap-1.5 cursor-pointer ${
                  pt.visible ? 'bg-[#111821] border-[#1E2A38] text-slate-200' : 'bg-[#0B0F14] border-slate-800 text-slate-500 line-through'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pt.color }}></span>
                {pt.name}
                {pt.visible ? <Eye className="w-3 h-3 text-[#22D3EE]" /> : <EyeOff className="w-3 h-3" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
