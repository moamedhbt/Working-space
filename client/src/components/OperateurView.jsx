import React, { useState } from 'react';
import { Camera, Play, CheckCircle } from 'lucide-react';
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

  return (
    <div className="max-w-lg mx-auto bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-base">📱 Poste Opérateur</h3>
        <span className="px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold">{user.nom}</span>
      </div>
      {opPieces.length === 0 && <p className="text-xs text-slate-400">Aucune pièce validée pour votre poste.</p>}
      {opPieces.map(p => (
        <div key={p.id} className="bg-[#19243d] border border-slate-700 rounded-xl p-4 text-xs space-y-3">
          <div className="flex justify-between font-bold text-sm">
            <span>{p.id} — {p.nom}</span>
            <span className="text-amber-400">{p.urgence}</span>
          </div>
          <div className="text-slate-300">📐 Plan: <code>{p.be.dessin3d || '—'}</code> | Prog: <code>{p.be.programme || '—'}</code></div>
          <div className="text-slate-300">🔧 Outils: {p.outils} | 📦 Objectif: <strong>{p.quantitePrevue} pcs</strong></div>

          {p.statut !== 'En cours' && p.statut !== 'À clôturer' && (
            <label className="w-full py-2.5 rounded-lg bg-blue-600 font-semibold flex items-center justify-center gap-2 cursor-pointer">
              <Play className="w-4 h-4" /> <Camera className="w-4 h-4" />
              {uploading ? 'Envoi...' : 'Prendre Photo Début & Démarrer'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleStart(p.id, e.target.files[0])} />
            </label>
          )}

          {p.statut === 'En cours' && (
            <form onSubmit={e => handleFinish(p.id, e)} className="space-y-2 pt-1">
              <div className="flex gap-2 items-center">
                <span className="text-slate-400">Qté réalisée :</span>
                <input name="qte" type="number" defaultValue={p.quantitePrevue} className="w-24 p-2 rounded bg-[#060a14] border border-slate-700" />
              </div>
              <input name="photoFin" type="file" accept="image/*" capture="environment" className="w-full text-xs text-slate-400" />
              <button type="submit" disabled={uploading} className="w-full py-2.5 rounded-lg bg-emerald-600 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                <CheckCircle className="w-4 h-4" /> <Camera className="w-4 h-4" />
                {uploading ? 'Envoi...' : 'Terminer + Photo Fin'}
              </button>
            </form>
          )}

          {p.statut === 'À clôturer' && (
            <div className="text-emerald-400 font-bold">✅ Terminé ({p.quantiteRealisee} pcs) — En attente clôture</div>
          )}
        </div>
      ))}
    </div>
  );
}
