import React, { useState, useEffect, useRef } from 'react';
import { Tv, Maximize2, X, AlertTriangle, Layers } from 'lucide-react';

export default function TvView({ state }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState(new Date().toLocaleTimeString('fr-FR'));
  const tvRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('fr-FR')), 1000);
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearInterval(t);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement && tvRef.current) {
      tvRef.current.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Match by machineId so renaming a machine never hides an OF from the TV!
  const activeMachineIds = new Set(state.machines.filter(m => m.actif).map(m => m.id));
  const active = state.pieces.filter(
    p => (p.planningValide || (p.operations || []).some(o => ['En cours','En pause','Panne machine'].includes(o.statut) && (o.startedAt > 0 || o.tempsReelMin > 0))) && !['Clôturé','Refusé'].includes(p.statut) && (!p.machineId || activeMachineIds.has(p.machineId))
  );
  const openPannes = (state.pannes || []).filter(pa => pa.statut === 'Ouverte');

  return (
    <div ref={tvRef} className={`cyber-card cyber-corners space-y-6 ${isFullscreen ? 'p-8 bg-[#0B0F14] min-h-screen' : 'p-6'}`}>
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-[#1E2A38] pb-4">
        <div className="flex items-center gap-3">
          <Tv className="w-7 h-7 text-[#22D3EE]" />
          <h2 className="text-2xl font-bold tracking-tight text-white">TABLEAU ATELIER EN DIRECT</h2>
        </div>
        <div className="flex items-center gap-3">
          {openPannes.length > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-[6px] bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4" /> {openPannes.length} PANNE(S)
            </span>
          )}
          <span className="flex items-center gap-2 px-3 py-1 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono-num">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
          </span>
          <span className="font-mono-num text-2xl font-bold text-white">{clock}</span>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 cursor-pointer"
            title={isFullscreen ? 'Quitter plein écran (Échap)' : 'Plein écran'}
          >
            {isFullscreen ? <X className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-500">Aucun ordre de fabrication actif sur l'écran TV.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {active.map(p => {
            const pct = p.progressPct ?? Math.min(100, Math.round(((p.quantiteRealisee || 0) / (p.quantitePrevue || 1)) * 100));
            const currentOp = (p.operations || []).find(o => o.statut !== 'Terminée') || (p.operations || [])[0];
            const isPanne = p.statut === 'Panne machine' || p.machineEnPanne;
            const borderCls = isPanne
              ? 'border-l-red-500'
              : p.urgence === 'Critique'
                ? 'border-l-red-500'
                : p.urgence === 'Urgent'
                  ? 'border-l-amber-500'
                  : 'border-l-emerald-500';

            return (
              <div key={p.id} className={`bg-[#0B0F14] border border-[#1E2A38] border-l-4 ${borderCls} rounded-[6px] p-5 space-y-3`}>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-lg font-semibold text-[#22D3EE] flex items-center gap-2">
                    {p.machine}
                    {isPanne && (
                      <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px]">PANNE</span>
                    )}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-[4px] border text-xs font-medium whitespace-nowrap ${
                    isPanne ? 'bg-red-500/15 text-red-300 border-red-500/40' :
                    p.urgence === 'Critique' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                    p.urgence === 'Urgent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}>{p.urgence} · {p.statut}</span>
                </div>

                <div className="text-xl font-bold text-white">
                  <span className="font-mono-num text-slate-300">{p.id}</span> — {p.nom}
                </div>

                {currentOp && (
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-[#22D3EE]" />
                    <span>Étape : <strong className="text-slate-200">{currentOp.libelle}</strong></span>
                    <span className="font-mono-num text-[#22D3EE]">({p.opsTerminees}/{p.opsTotal} op.)</span>
                  </div>
                )}

                <div className="w-full h-2.5 bg-[#111821] rounded-full overflow-hidden">
                  <div className={`h-full ${isPanne ? 'bg-red-500' : 'bg-[#22D3EE]'}`} style={{ width: `${pct}%` }}></div>
                </div>

                <div className="flex justify-between text-sm text-slate-300 font-mono-num">
                  <span>OPÉRATEUR : {p.operateur}</span>
                  <span>
                    QTÉ : {p.quantiteRealisee}/{p.quantitePrevue} ({pct}%)
                    {p.quantiteRebut > 0 ? ` · ${p.quantiteRebut} NC` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
