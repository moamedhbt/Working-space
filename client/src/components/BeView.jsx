import React, { useState, useRef, useEffect } from 'react';
import { Save, Upload, Box, Download, CheckSquare, Sparkles } from 'lucide-react';
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
  const [dims, setDims] = useState({ longueur: 100, largeur: 50, hauteur: 30, tolerance: '±0.05 mm', matiere: 'Acier 42CrMo4' });
  const [verified, setVerified] = useState(false);
  const [stlReady, setStlReady] = useState(false);
  const [promptMod, setPromptMod] = useState('');
  const [angle, setAngle] = useState(0.6);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!stlReady || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    ctx.clearRect(0, 0, w, h);

    const { longueur: L, largeur: W, hauteur: H } = dims;
    const scale = Math.min(w, h) / (Math.max(L, W, H) * 2.2);
    const pts = [
      [-L/2,-W/2,-H/2], [L/2,-W/2,-H/2], [L/2,W/2,-H/2], [-L/2,W/2,-H/2],
      [-L/2,-W/2,H/2], [L/2,-W/2,H/2], [L/2,W/2,H/2], [-L/2,W/2,H/2]
    ].map(([x, y, z]) => {
      const rx = x * Math.cos(angle) - z * Math.sin(angle);
      const rz = x * Math.sin(angle) + z * Math.cos(angle);
      const ry = y * Math.cos(0.4) - rz * Math.sin(0.4);
      return [w / 2 + rx * scale, h / 2 + ry * scale];
    });

    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    edges.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
      ctx.stroke();
    });
  }, [stlReady, dims, angle]);

  function handlePhotoAnalyze(e) {
    if (!e.target.files[0]) return;
    setVerified(false);
    setStlReady(false);
    alert('🤖 IA 2D : Plan analysé ! Vérifiez et ajustez les cotes ci-dessous avant de générer le STL.');
  }

  function applyPrompt() {
    const m = promptMod.match(/(\d+)/g);
    if (m && m.length >= 1) {
      setDims(d => ({ ...d, longueur: parseInt(m[0], 10) || d.longueur }));
    }
    setPromptMod('');
  }

  function downloadSTL() {
    if (!verified) return alert('⚠️ Veuillez cocher "Cotes vérifiées par le BE" avant le téléchargement !');
    const stl = generateBoxSTL(dims.longueur, dims.largeur, dims.hauteur);
    const blob = new Blob([stl], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `piece_${dims.longueur}x${dims.largeur}x${dims.hauteur}.stl`;
    a.click();
  }

  async function saveBE(id, e) {
    e.preventDefault();
    const f = e.target;
    await api(`/api/pieces/${id}/be`, 'POST', {
      nomFichier: f.nomFichier.value,
      programme: f.programme.value,
      dessin3d: f.dessin3d.value
    });
    alert('✅ Dossier BE enregistré');
    reload();
  }

  return (
    <div className="space-y-5">
      <MaterialCalculator />
      {/* MODULE IA 2D -> STL 3D */}
      <div className="bg-[#11192b] border border-cyan-500/30 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h3 className="font-bold text-base flex items-center gap-2 text-cyan-300">
            <Box className="w-5 h-5" /> Studio IA 2D → Générateur & Visionneuse STL 3D
          </h3>
          <label className="px-3 py-2 rounded-lg bg-purple-600/80 text-xs font-semibold flex items-center gap-2 cursor-pointer">
            <Upload className="w-4 h-4" /> Envoyer Photo du Plan 2D
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoAnalyze} />
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <div><label className="text-slate-400">Longueur (mm)</label><input type="number" value={dims.longueur} onChange={e => setDims({ ...dims, longueur: +e.target.value })} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
          <div><label className="text-slate-400">Largeur (mm)</label><input type="number" value={dims.largeur} onChange={e => setDims({ ...dims, largeur: +e.target.value })} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
          <div><label className="text-slate-400">Hauteur (mm)</label><input type="number" value={dims.hauteur} onChange={e => setDims({ ...dims, hauteur: +e.target.value })} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
          <div><label className="text-slate-400">Tolérance</label><input value={dims.tolerance} onChange={e => setDims({ ...dims, tolerance: e.target.value })} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
          <div><label className="text-slate-400">Matière</label><input value={dims.matiere} onChange={e => setDims({ ...dims, matiere: e.target.value })} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-emerald-300 font-semibold">
            <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />
            <CheckSquare className="w-4 h-4" /> Cotes vérifiées par le BE (obligatoire)
          </label>
          <div className="flex gap-2">
            <button onClick={() => setStlReady(true)} className="px-3 py-2 rounded-lg bg-cyan-600 font-semibold cursor-pointer">
              ⚡ Générer & Voir 3D
            </button>
            <button onClick={downloadSTL} className={`px-3 py-2 rounded-lg font-semibold flex items-center gap-1 cursor-pointer ${verified ? 'bg-emerald-600' : 'bg-slate-700 opacity-60'}`}>
              <Download className="w-4 h-4" /> Télécharger .STL
            </button>
          </div>
        </div>

        {stlReady && (
          <div className="bg-[#060a14] border border-cyan-500/30 rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-cyan-400 font-bold">Aperçu 3D ({dims.longueur} × {dims.largeur} × {dims.hauteur} mm)</span>
              <button onClick={() => setAngle(a => a + 0.4)} className="px-2 py-1 rounded border border-slate-700 cursor-pointer">🔄 Tourner 3D</button>
            </div>
            <canvas ref={canvasRef} width={500} height={220} className="w-full max-w-lg mx-auto block" />
            <div className="flex gap-2 text-xs">
              <input value={promptMod} onChange={e => setPromptMod(e.target.value)} placeholder="Prompt modification (ex: longueur 120)" className="flex-1 p-2 rounded bg-[#11192b] border border-slate-700" />
              <button onClick={applyPrompt} className="px-3 py-2 rounded-lg bg-purple-600 font-semibold flex items-center gap-1 cursor-pointer">
                <Sparkles className="w-3.5 h-3.5" /> Modifier
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DOSSIERS PIECES BE */}
      <div className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4 space-y-4">
        <h3 className="font-bold text-base">📐 Dossiers Pièces — Plans, Programmes CNC & Dessins 3D</h3>
        {state.pieces.map(p => (
          <form key={p.id} onSubmit={e => saveBE(p.id, e)} className="bg-[#19243d] border border-slate-700 rounded-xl p-3 text-xs space-y-2">
            <div className="flex justify-between font-bold text-sm">
              <span>{p.id} — {p.nom}</span>
              <span className="text-cyan-400">{p.urgence}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input name="nomFichier" defaultValue={p.be.nomFichier} placeholder="Nom fichier" className="p-2 rounded bg-[#060a14] border border-slate-700" />
              <input name="programme" defaultValue={p.be.programme} placeholder="Programme CNC" className="p-2 rounded bg-[#060a14] border border-slate-700" />
              <input name="dessin3d" defaultValue={p.be.dessin3d} placeholder="Dessin 3D / Plan" className="p-2 rounded bg-[#060a14] border border-slate-700" />
              <button type="submit" className="px-3 py-2 rounded-lg bg-blue-600 font-semibold flex items-center justify-center gap-1 cursor-pointer">
                <Save className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
