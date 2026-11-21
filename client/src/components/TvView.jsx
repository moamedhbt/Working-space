import React from 'react';
import { Tv } from 'lucide-react';

export default function TvView({ state }) {
  const active = state.pieces.filter(p => p.planningValide && p.statut !== 'Clôturé');
  return (
    <div className="bg-[#020617] border-2 border-cyan-500/50 rounded-2xl p-5 shadow-2xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-extrabold flex items-center gap-2 text-cyan-400">
          <Tv className="w-6 h-6" /> TABLEAU ATELIER EN DIRECT
        </h2>
        <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold">
          {new Date().toLocaleTimeString('fr-FR')}
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {active.map(p => (
          <div key={p.id} className={`bg-[#11192b] rounded-xl p-4 border-l-4 ${p.urgence === 'Critique' ? 'border-red-500' : 'border-emerald-500'}`}>
            <div className="flex justify-between text-xs font-bold">
              <span>🏭 {p.machine}</span>
              <span className={p.urgence === 'Critique' ? 'text-red-400' : 'text-amber-400'}>{p.urgence}</span>
            </div>
            <div className="text-base font-bold mt-2">{p.id} — {p.nom}</div>
            <div className="text-xs text-slate-400 mt-1">👷 {p.operateur} | Statut: <strong>{p.statut}</strong> | Qté: {p.quantiteRealisee}/{p.quantitePrevue}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
