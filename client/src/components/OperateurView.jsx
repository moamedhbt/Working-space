import React, { useState, useEffect } from 'react';
import { Camera, Play, CheckCircle, Pause, AlertTriangle, RotateCcw, Layers } from 'lucide-react';
import { api } from '../api';

export default function OperateurView({ state, user, reload }) {
  const [busyOpId, setBusyOpId] = useState(null);
  const [panneOpenId, setPanneOpenId] = useState(null);
  const [panneMotif, setPanneMotif] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  function notify(type, text) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback({ type: '', text: '' }), 4000);
  }

  // Match strictly by operateurId === user.id so renaming an operator NEVER breaks their assigned tasks!
  const myTasks = [];
  for (const piece of state.pieces) {
    if (!piece.planningValide || piece.statut === 'Clôturé') continue;
    const ops = piece.operations || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.operateurId === user.id) {
        const prevOp = i > 0 ? ops[i - 1] : null;
        myTasks.push({ piece, op, opIndex: i + 1, opsTotal: ops.length, prevOp });
      }
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function liveMinutes(op) {
    const base = op.tempsReelMin || 0;
    if (op.statut === 'En cours' && op.startedAt > 0) {
      return base + Math.max(0, Math.round((nowMs - op.startedAt) / 60000));
    }
    return base;
  }

  async function handleStart(pieceId, opId, file = null) {
    setBusyOpId(opId);
    try {
      let photoUrl = '';
      if (file) {
        const base64 = await fileToBase64(file);
        const up = await api('/api/upload', 'POST', { pieceId, filename: `debut_${file.name}`, base64 });
        photoUrl = up.url;
      }
      await api(`/api/operations/${opId}/start`, 'POST', { photoUrl });
      notify('ok', 'Opération démarrée / reprise.');
      reload();
    } catch (e) {
      notify('err', e.message);
    } finally {
      setBusyOpId(null);
    }
  }

  async function handlePause(opId) {
    setBusyOpId(opId);
    try {
      const res = await api(`/api/operations/${opId}/pause`, 'POST');
      notify('ok', `Opération mise en pause (temps cumulé : ${res.tempsReelMin} min).`);
      reload();
    } catch (e) {
      notify('err', e.message);
    } finally {
      setBusyOpId(null);
    }
  }

  async function handlePanne(opId) {
    setBusyOpId(opId);
    try {
      await api(`/api/operations/${opId}/panne`, 'POST', { motif: panneMotif.trim() || 'Panne machine signalée' });
      setPanneOpenId(null);
      setPanneMotif('');
      notify('ok', 'Panne signalée au Chef d’atelier (temps sauvegardé).');
      reload();
    } catch (e) {
      notify('err', e.message);
    } finally {
      setBusyOpId(null);
    }
  }

  async function handleFinish(pieceId, opId, e) {
    e.preventDefault();
    setBusyOpId(opId);
    try {
      const f = e.target;
      const quantiteBonne = parseInt(f.qteBonne.value || '0', 10);
      const quantiteRebut = parseInt(f.qteRebut.value || '0', 10);
      const motifRebut = f.motifRebut?.value || '';
      const file = f.photoFin?.files?.[0];
      let photoUrl = '';
      if (file) {
        const base64 = await fileToBase64(file);
        const up = await api('/api/upload', 'POST', { pieceId, filename: `fin_${file.name}`, base64 });
        photoUrl = up.url;
      }
      const res = await api(`/api/operations/${opId}/finish`, 'POST', {
        quantiteBonne,
        quantiteRebut,
        motifRebut,
        photoUrl
      });
      notify('ok', `Opération terminée (${quantiteBonne} bonnes, ${quantiteRebut} rebuts · ${res.tempsReelMin} min).`);
      reload();
    } catch (err) {
      notify('err', err.message);
    } finally {
      setBusyOpId(null);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">POSTE OPÉRATEUR</div>
          <div className="text-sm font-semibold text-white">{user.nom}</div>
        </div>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono-num">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> LIVE · {myTasks.length} tâche(s)
        </span>
      </div>

      {feedback.text && (
        <div className={`p-3 rounded-[6px] border text-xs font-medium ${
          feedback.type === 'err'
            ? 'bg-red-500/15 border-red-500/40 text-red-300'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        }`}>
          {feedback.text}
        </div>
      )}

      {myTasks.length === 0 && (
        <div className="cyber-card p-6 text-center text-xs text-slate-400">
          Aucune opération validée affectée à votre poste.
        </div>
      )}

      {myTasks.map(({ piece: p, op, opIndex, opsTotal, prevOp }) => {
        const isBusy = busyOpId === op.id;
        const elapsed = liveMinutes(op);
        const waitingPrev = prevOp && prevOp.statut !== 'Terminée';
        const matBlocked = !p.chuteDispo && !p.achatFait;

        return (
          <div key={op.id} className="cyber-card cyber-corners p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono-num text-xs text-[#22D3EE]">{p.id}</span>
                <span className="px-1.5 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[10px] font-mono-num text-slate-300 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-[#22D3EE]" /> Op {opIndex}/{opsTotal}
                </span>
              </div>
              <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] ${
                op.statut === 'Panne machine' ? 'bg-red-500/15 text-red-300 border-red-500/40' :
                op.statut === 'En pause' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' :
                op.statut === 'Terminée' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' :
                p.urgence === 'Critique' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                p.urgence === 'Urgent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}>
                {op.statut} · {p.urgence}
              </span>
            </div>

            <div>
              <div className="text-sm font-semibold text-white">{p.nom}</div>
              <div className="text-xs text-[#22D3EE] mt-0.5">
                {op.libelle} · <span className="text-slate-300">{op.machine}</span>
              </div>
            </div>

            {waitingPrev && op.statut === 'En attente' && (
              <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                Opération précédente en attente : « {prevOp.libelle} » ({prevOp.statut})
              </div>
            )}

            {matBlocked && (
              <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
                Matière non disponible — en attente validation achat Direction.
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="w-16 h-16 shrink-0 rounded-full border-4 border-[#1E2A38] flex flex-col items-center justify-center font-mono-num">
                <span className="text-xs font-bold text-[#22D3EE]">{op.quantiteBonne}/{p.quantitePrevue}</span>
                {op.quantiteRebut > 0 && (
                  <span className="text-[9px] text-red-400">{op.quantiteRebut} reb.</span>
                )}
              </div>
              <div className="text-xs space-y-1 text-slate-400">
                <div>
                  TEMPS : <span className={`font-mono-num ${elapsed > op.tempsPrevuMin ? 'text-red-400' : 'text-slate-200'}`}>{elapsed} / {op.tempsPrevuMin} min</span>
                </div>
                <div>MATIÈRE : <span className="text-slate-200">{p.matiere}</span></div>
                <div>OUTILS : <span className="text-slate-200">{p.outils}</span></div>
              </div>
            </div>

            <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-mono-num text-slate-200">{p.be.nomFichier || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Programme</span><span className="font-mono-num text-slate-200">{p.be.programme || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Modèle 3D</span><span className="font-mono-num text-slate-200">{p.be.dessin3d || '—'}</span></div>
            </div>

            {/* START OR RESUME */}
            {(op.statut === 'En attente' || op.statut === 'En pause') && !matBlocked && (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleStart(p.id, op.id, null)}
                  className="flex-1 py-2.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {op.statut === 'En pause' ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isBusy ? 'Traitement...' : (op.statut === 'En pause' ? 'Reprendre' : 'Démarrer')}
                </button>
                <label className="flex-1 py-2.5 rounded-[6px] bg-[#0B0F14] border border-[#22D3EE]/50 hover:border-[#22D3EE] text-[#22D3EE] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
                  <Camera className="w-4 h-4" /> Photo & {op.statut === 'En pause' ? 'Reprendre' : 'Démarrer'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={isBusy}
                    onChange={e => e.target.files[0] && handleStart(p.id, op.id, e.target.files[0])}
                  />
                </label>
              </div>
            )}

            {/* PANNE STATE */}
            {op.statut === 'Panne machine' && (
              <div className="p-2.5 rounded-[6px] bg-red-500/15 border border-red-500/40 text-red-300 text-xs text-center">
                Panne machine ouverte — En attente d’intervention / résolution par le Chef d’atelier.
              </div>
            )}

            {/* RUNNING CONTROLS: PAUSE / PANNE / FINISH */}
            {op.statut === 'En cours' && (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handlePause(op.id)}
                    className="flex-1 py-2 rounded-[6px] bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => { setPanneOpenId(panneOpenId === op.id ? null : op.id); setPanneMotif(''); }}
                    className="flex-1 py-2 rounded-[6px] bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Signaler Panne
                  </button>
                </div>

                {panneOpenId === op.id && (
                  <div className="p-3 rounded-[6px] bg-red-950/40 border border-red-500/40 space-y-2 text-xs">
                    <input
                      value={panneMotif}
                      onChange={e => setPanneMotif(e.target.value)}
                      placeholder="Motif de la panne (ex: Casse outil, alarme broche...)"
                      className="w-full p-2 rounded bg-[#0B0F14] border border-red-500/40 text-white"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handlePanne(op.id)}
                        className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
                      >
                        Confirmer la panne
                      </button>
                      <button
                        type="button"
                        onClick={() => setPanneOpenId(null)}
                        className="px-3 py-1.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-slate-300 cursor-pointer"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={e => handleFinish(p.id, op.id, e)} className="space-y-2.5 pt-2 border-t border-[#1E2A38]">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] text-slate-400">Qté bonne</label>
                      <input
                        name="qteBonne"
                        type="number"
                        min="0"
                        defaultValue={p.quantitePrevue}
                        className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-red-400">Qté rebut (NC)</label>
                      <input
                        name="qteRebut"
                        type="number"
                        min="0"
                        defaultValue={0}
                        className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white"
                      />
                    </div>
                  </div>
                  <input
                    name="motifRebut"
                    placeholder="Motif rebut / remarque qualité (si rebut > 0)"
                    className="w-full p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-xs text-slate-200"
                  />
                  <input name="photoFin" type="file" accept="image/*" capture="environment" className="w-full text-xs text-slate-400" />
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="w-full py-2.5 rounded-[6px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" /> <Camera className="w-4 h-4" />
                    {isBusy ? 'Envoi...' : "Terminer l'opération"}
                  </button>
                </form>
              </>
            )}

            {op.statut === 'Terminée' && (
              <div className="p-2.5 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium text-center">
                Terminée ({op.quantiteBonne} bonnes{op.quantiteRebut > 0 ? ` · ${op.quantiteRebut} rebuts` : ''} · {op.tempsReelMin} min)
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
