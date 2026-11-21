import React from 'react';
import { Tv } from 'lucide-react';

export default function TvView({ state }) {
  const active = state.pieces.filter(p => p.planningValide && p.statut !== 'Clôturé');

  return (
    <div className="cyber-card cyber-corners p-6 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-[#1E2A38] pb-4">
        <div className="flex items-center gap-3">
          <Tv className="w-6 h-6 text-[#22D3EE]" />
          <h2 className="text-xl font-bold tracking-tight text-white">TABLEAU ATELIER EN DIRECT</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 px-3 py-1 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono-num">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
          </span>
          <span className="font-mono-num text-lg font-semibold text-slate-200">
            {new Date().toLocaleTimeString('fr-FR')}
          </span>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-500">Aucun ordre de fabrication actif sur l'écran TV.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {active.map(p => {
            const pct = Math.min(100, Math.round(((p.quantiteRealisee || 0) / (p.quantitePrevue || 1)) * 100));
            const borderCls = p.urgence === 'Critique' ? 'border-l-red-500' : p.urgence === 'Urgent' ? 'border-l-amber-500' : 'border-l-emerald-500';
            return (
              <div key={p.id} className={`bg-[#0B0F14] border border-[#1E2A38] border-l-4 ${borderCls} rounded-[6px] p-5 space-y-3`}>
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-[#22D3EE]">{p.machine}</span>
                  <span className={`px-2.5 py-0.5 rounded-[4px] border text-xs font-medium ${
                    p.urgence === 'Critique' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                    p.urgence === 'Urgent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}>{p.urgence} · {p.statut}</span>
                </div>

                <div className="text-lg font-bold text-white">
                  <span className="font-mono-num text-slate-300">{p.id}</span> — {p.nom}
                </div>

                <div className="w-full h-2 bg-[#111821] rounded-full overflow-hidden">
                  <div className="h-full bg-[#22D3EE]" style={{ width: `${pct}%` }}></div>
                </div>

                <div className="flex justify-between text-xs text-slate-400 font-mono-num">
                  <span>OPÉRATEUR : {p.operateur}</span>
                  <span>QTÉ : {p.quantiteRealisee}/{p.quantitePrevue} ({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
