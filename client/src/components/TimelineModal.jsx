import React from 'react';
import { X, Clock, CheckCircle2, FileText, AlertTriangle, Layers, Image } from 'lucide-react';

export default function TimelineModal({ piece, onClose }) {
  if (!piece) return null;

  const steps = [
    { label: 'Direction', ok: piece.validationDirection !== false, warn: piece.statut === 'À valider' },
    { label: 'BE', ok: piece.beValide || piece.beNonRequis, warn: false },
    { label: 'Matière', ok: piece.chuteDispo || piece.achatFait, warn: piece.statut === 'À acheter' },
    { label: 'Chef', ok: piece.chefValide || piece.planningValide, warn: false },
    { label: 'Atelier', ok: ['En cours', 'À clôturer', 'Clôturé'].includes(piece.statut), warn: piece.statut === 'Panne machine' },
    { label: 'Clôture', ok: piece.statut === 'Clôturé', warn: piece.statut === 'À clôturer' }
  ];

  const events = piece.events || [];
  const stops = piece.stops || [];
  const files = piece.beFiles || [];

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-2xl max-h-[90dvh] flex flex-col bg-[#111821] border-t sm:border border-[#1E2A38] rounded-t-2xl sm:rounded-lg shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2A38] shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white font-mono-num truncate">
              {piece.id} — <span className="font-sans">{piece.nom}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              {piece.client} · {piece.quantiteRealisee}/{piece.quantitePrevue} pcs · Délai {piece.delai || '—'} · Statut : <strong className="text-[#22D3EE]">{piece.statut}</strong>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* PIPELINE */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Avancement Dossier Unique</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {steps.map(s => (
                <div
                  key={s.label}
                  className={`px-2 py-1.5 rounded border text-center text-[11px] font-medium flex items-center justify-center gap-1 ${
                    s.ok
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : s.warn
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                        : 'bg-[#0B0F14] border-[#1E2A38] text-slate-500'
                  }`}
                >
                  {s.ok && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* LINKED FILES */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-[#22D3EE]" /> Fichiers liés au dossier ({files.length})
            </div>
            {files.length === 0 ? (
              <div className="text-slate-500 text-[11px]">Aucun fichier déposé sur cet OF.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {files.map(f => (
                  <a
                    key={f.id}
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`px-2 py-1 rounded border text-[11px] font-mono-num ${
                      f.isActive
                        ? 'bg-[#22D3EE]/10 border-[#22D3EE]/40 text-[#22D3EE]'
                        : 'bg-[#0B0F14] border-[#1E2A38] text-slate-400'
                    }`}
                  >
                    {f.categorie.toUpperCase()} · {f.revision} · {f.filename}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* OPERATIONS */}
          {(piece.operations || []).length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-[#22D3EE]" /> Gamme ({piece.opsTerminees}/{piece.opsTotal} op.)
              </div>
              <div className="space-y-1">
                {piece.operations.map((o, idx) => (
                  <div key={o.id} className="p-2 rounded bg-[#0B0F14] border border-[#1E2A38] flex flex-wrap justify-between gap-2 text-[11px]">
                    <span>
                      <strong className="font-mono-num text-[#22D3EE]">Op {(idx + 1) * 10}</strong> · {o.libelle} ({o.machine} · {o.operateur})
                    </span>
                    <span className="font-mono-num text-slate-300">
                      {o.tempsReelMin}/{o.tempsPrevuMin}m · {o.quantiteBonne} ok{o.quantiteRebut > 0 ? ` · ${o.quantiteRebut} NC` : ''} · <strong className="text-[#22D3EE]">{o.statut}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STOPS / BLOCKERS */}
          {stops.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Arrêts & Blocages signalés ({stops.length})
              </div>
              <div className="space-y-1">
                {stops.map(s => (
                  <div key={s.id} className="p-2 rounded bg-[#0B0F14] border border-[#1E2A38] flex flex-wrap justify-between gap-2 text-[11px]">
                    <span>
                      <strong className="uppercase text-amber-300">{s.categorie}</strong> — {s.motif} ({s.operateurNom})
                    </span>
                    <span className={`font-mono-num ${s.statut === 'Ouvert' ? 'text-red-400' : 'text-emerald-400'}`}>
                      {s.statut}{s.dureeMin > 0 ? ` · ${s.dureeMin}m` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PHOTOS */}
          {(piece.photoDebut?.startsWith('/uploads/') || piece.photoFin?.startsWith('/uploads/')) && (
            <div className="flex flex-wrap gap-2">
              {piece.photoDebut?.startsWith('/uploads/') && (
                <a href={piece.photoDebut} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-[#22D3EE] inline-flex items-center gap-1">
                  <Image className="w-3.5 h-3.5" /> Photo début
                </a>
              )}
              {piece.photoFin?.startsWith('/uploads/') && (
                <a href={piece.photoFin} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-[#22D3EE] inline-flex items-center gap-1">
                  <Image className="w-3.5 h-3.5" /> Photo fin
                </a>
              )}
            </div>
          )}

          {/* CHRONOLOGICAL TIMELINE */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-[#22D3EE]" /> Historique complet de la pièce ({events.length})
            </div>
            {events.length === 0 ? (
              <div className="text-slate-500 text-[11px]">Aucun événement enregistré pour cet OF (créé avant la mise à jour).</div>
            ) : (
              <div className="border-l-2 border-[#1E2A38] pl-3 space-y-2.5">
                {events.map(ev => (
                  <div key={ev.id} className="relative">
                    <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-[#22D3EE]"></span>
                    <div className="flex flex-wrap justify-between gap-1">
                      <span className="font-semibold text-white">{ev.title}</span>
                      <span className="font-mono-num text-[10px] text-slate-500">{ev.createdAt}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      <span className="text-[#22D3EE]">{ev.userNom}</span> ({ev.userRole}){ev.details ? ` — ${ev.details}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#1E2A38] bg-[#0B0F14]/80 flex justify-end shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded bg-[#22D3EE] text-[#0B0F14] font-semibold cursor-pointer">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
