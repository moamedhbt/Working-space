import React, { useState } from 'react';
import { Camera, Play, CheckCircle, Pause, AlertTriangle } from 'lucide-react';
import { api } from '../api';

export default function OperateurView({ state, user, reload }) {
  const [uploading, setUploading] = useState(false);
  const opPieces = state.pieces.filter(p => p.planningValide && p.operateur === user.nom && p.statut !== 'Clôturé');

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleStart(id, file) {
    setUploading(true);
    try {
      let photoUrl = 'photo_debut.jpg';
      if (file) {
        const base64 = await fileToBase64(file);
        const up = await api('/api/upload', 'POST', { pieceId: id, filename: `debut_${file.name}`, base64 });
        photoUrl = up.url;
      }
      await api(`/api/pieces/${id}/op-start`, 'POST', { photoUrl });
      reload();
    } finally {
      setUploading(false);
    }
  }

  async function handleFinish(id, e) {
    e.preventDefault();
    setUploading(true);
    try {
      const qte = e.target.qte.value;
      const file = e.target.photoFin.files[0];
      let photoUrl = 'photo_fin.jpg';
      if (file) {
        const base64 = await fileToBase64(file);
        const up = await api('/api/upload', 'POST', { pieceId: id, filename: `fin_${file.name}`, base64 });
        photoUrl = up.url;
      }
      await api(`/api/pieces/${id}/op-finish`, 'POST', { quantiteRealisee: qte, photoUrl });
      reload();
    } finally {
      setUploading(false);
    }
  }

  async function handlePause(id) {
    await api(`/api/pieces/${id}/pause`, 'POST');
    reload();
  }

  async function handlePanne(id) {
    const motif = window.prompt('Motif de la panne (optionnel) :') || '';
    await api(`/api/pieces/${id}/panne`, 'POST', { motif });
    reload();
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">POSTE OPÉRATEUR</div>
          <div className="text-sm font-semibold text-white">{user.nom}</div>
        </div>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono-num">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
        </span>
      </div>

      {opPieces.length === 0 && (
        <div className="cyber-card p-6 text-center text-xs text-slate-400">
          Aucune pièce validée affectée à votre poste.
        </div>
      )}

      {opPieces.map(p => {
        const pct = Math.min(100, Math.round(((p.quantiteRealisee || 0) / (p.quantitePrevue || 1)) * 100));
        return (
          <div key={p.id} className="cyber-card cyber-corners p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono-num text-xs text-[#22D3EE]">{p.id}</span>
              <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] ${
                p.urgence === 'Critique' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                p.urgence === 'Urgent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}>{p.urgence}</span>
            </div>

            <div className="text-sm font-semibold text-white">{p.nom}</div>

            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full border-4 border-[#1E2A38] flex items-center justify-center font-mono-num text-sm font-bold text-[#22D3EE]">
                {p.quantiteRealisee}/{p.quantitePrevue}
              </div>
              <div className="text-xs space-y-1 text-slate-400">
                <div>TEMPS : <span className="font-mono-num text-slate-200">{p.tempsReelMin} / {p.tempsPrevuMin} min</span></div>
                <div>MATIÈRE : <span className="text-slate-200">{p.matiere}</span></div>
                <div>OUTILS : <span className="text-slate-200">{p.outils}</span></div>
              </div>
            </div>

            <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 text-xs space-y-1.5">
              <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-mono-num text-slate-200">{p.be.nomFichier || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Programme</span><span className="font-mono-num text-slate-200">{p.be.programme || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Modèle 3D</span><span className="font-mono-num text-slate-200">{p.be.dessin3d || '—'}</span></div>
            </div>

            {p.statut !== 'En cours' && p.statut !== 'À clôturer' && (
              <label className="w-full py-3 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer">
                <Play className="w-4 h-4" /> <Camera className="w-4 h-4" />
                {uploading ? 'Envoi...' : 'Photo Début & Démarrer'}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleStart(p.id, e.target.files[0])} />
              </label>
            )}

            {p.statut === 'En cours' && (
              <div className="flex gap-2">
                <button type="button" onClick={() => handlePause(p.id)} className="flex-1 py-2 rounded-[6px] bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer">
                  <Pause className="w-3.5 h-3.5" /> Pause
                </button>
                <button type="button" onClick={() => handlePanne(p.id)} className="flex-1 py-2 rounded-[6px] bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer">
                  <AlertTriangle className="w-3.5 h-3.5" /> Panne
                </button>
              </div>
            )}

            {p.statut === 'En cours' && (
              <form onSubmit={e => handleFinish(p.id, e)} className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">Quantité réalisée :</span>
                  <input name="qte" type="number" defaultValue={p.quantitePrevue} className="w-24 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
                </div>
                <input name="photoFin" type="file" accept="image/*" capture="environment" className="w-full text-xs text-slate-400" />
                <button type="submit" disabled={uploading} className="w-full py-3 rounded-[6px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer">
                  <CheckCircle className="w-4 h-4" /> <Camera className="w-4 h-4" />
                  {uploading ? 'Envoi...' : 'Terminer + Photo Fin'}
                </button>
              </form>
            )}

            {p.statut === 'À clôturer' && (
              <div className="p-2.5 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium text-center">
                Terminé ({p.quantiteRealisee} pcs) — En attente clôture
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
