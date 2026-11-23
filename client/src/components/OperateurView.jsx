import React, { useState, useEffect } from 'react';
import {
  Camera, Play, CheckCircle, Pause, AlertTriangle, RotateCcw, Layers,
  FileText, Code2, Box, X, Save, Download, Clock
} from 'lucide-react';
import { api } from '../api';
import ModelViewer3D from './ModelViewer3D';
import TimelineModal from './TimelineModal';

const STOP_REASONS = [
  { id: 'panne', label: 'Panne machine', target: 'Alerte Chef + Direction', cls: 'bg-red-500/15 border-red-500/40 text-red-300' },
  { id: 'outil', label: 'Manque outil / plaquette', target: 'Alerte Chef d’atelier', cls: 'bg-amber-500/15 border-amber-500/40 text-amber-300' },
  { id: 'matiere', label: 'Manque matière / brut', target: 'Alerte Chef + Direction', cls: 'bg-orange-500/15 border-orange-500/40 text-orange-300' },
  { id: 'plan_be', label: 'Problème plan / prog. CNC', target: 'Alerte Bureau d’Études', cls: 'bg-purple-500/15 border-purple-500/40 text-purple-300' },
  { id: 'pause', label: 'Pause / Fin de poste', target: 'Pause simple', cls: 'bg-slate-800 border-slate-600 text-slate-200' }
];

export default function OperateurView({ state, user, reload }) {
  const [busyOpId, setBusyOpId] = useState(null);
  const [stopModalOp, setStopModalOp] = useState(null); // { piece, op }
  const [stopCat, setStopCat] = useState('panne');
  const [stopMotif, setStopMotif] = useState('');
  const [timelinePiece, setTimelinePiece] = useState(null);
  const [partialByOp, setPartialByOp] = useState({});
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [nowMs, setNowMs] = useState(Date.now());

  // Technical consultation modals for the operator
  const [planModal, setPlanModal] = useState(null); // { filename, revision, url, notes }
  const [cncModal, setCncModal] = useState(null);   // { filename, revision, content, url }
  const [model3dModal, setModel3dModal] = useState(null); // { filename, revision, url }

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  function notify(type, text) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback({ type: '', text: '' }), 4000);
  }

  // Match strictly by operateurId === user.id so renaming an operator NEVER breaks their assigned tasks
  const myTasks = [];
  for (const piece of state.pieces) {
    if (!piece.planningValide || piece.statut === 'Clôturé') continue;
    const ops = piece.operations || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op.estSousTraitance && op.operateurId === user.id) {
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

  async function openCncFile(fileObj) {
    try {
      const res = await api(`/api/be-files/${fileObj.id}/text`);
      setCncModal({ filename: res.filename, revision: res.revision, content: res.content, url: fileObj.url });
    } catch (e) {
      notify('err', e.message);
    }
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

  async function handleSavePartial(op) {
    setBusyOpId(op.id);
    try {
      const vals = partialByOp[op.id] || { bonne: op.quantiteBonne || 0, rebut: op.quantiteRebut || 0 };
      await api(`/api/operations/${op.id}/progress`, 'POST', {
        quantiteBonne: Number(vals.bonne) || 0,
        quantiteRebut: Number(vals.rebut) || 0
      });
      notify('ok', `Avancement enregistré (${vals.bonne} bonnes, ${vals.rebut} NC).`);
      reload();
    } catch (e) {
      notify('err', e.message);
    } finally {
      setBusyOpId(null);
    }
  }

  async function submitQualifiedStop() {
    if (!stopModalOp) return;
    setBusyOpId(stopModalOp.op.id);
    try {
      await api(`/api/operations/${stopModalOp.op.id}/stop`, 'POST', {
        categorie: stopCat,
        motif: stopMotif.trim()
      });
      const reason = STOP_REASONS.find(r => r.id === stopCat);
      setStopModalOp(null);
      setStopMotif('');
      notify('ok', `${reason?.label || 'Arrêt'} enregistré — ${reason?.target || ''}`);
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
      {/* TIMELINE MODAL */}
      <TimelineModal piece={timelinePiece} onClose={() => setTimelinePiece(null)} />

      {/* QUALIFIED STOP SHEET (MOBILE-FIRST) */}
      {stopModalOp && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setStopModalOp(null); }}
        >
          <div className="w-full sm:max-w-md bg-[#111821] border-t sm:border border-[#1E2A38] rounded-t-2xl sm:rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#1E2A38] pb-2">
              <span className="text-sm font-semibold text-white">Arrêter / Signaler un blocage</span>
              <button type="button" onClick={() => setStopModalOp(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {STOP_REASONS.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setStopCat(r.id)}
                  className={`w-full px-3 py-2.5 rounded-[6px] border text-left flex items-center justify-between cursor-pointer ${
                    stopCat === r.id ? r.cls + ' ring-1 ring-white/30' : 'bg-[#0B0F14] border-[#1E2A38] text-slate-300'
                  }`}
                >
                  <span className="text-xs font-semibold">{r.label}</span>
                  <span className="text-[10px] opacity-80">{r.target}</span>
                </button>
              ))}
            </div>
            <input
              value={stopMotif}
              onChange={e => setStopMotif(e.target.value)}
              placeholder="Précision (ex: Plaquette CNMG cassée, cote Ø45 douteuse...)"
              className="w-full px-3 py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-base sm:text-xs text-white"
            />
            <div className="flex gap-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => setStopModalOp(null)} className="px-4 py-2.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-xs text-slate-300 cursor-pointer">
                Annuler
              </button>
              <button
                type="button"
                disabled={busyOpId === stopModalOp.op.id}
                onClick={submitQualifiedStop}
                className="flex-1 py-2.5 rounded-[6px] bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer"
              >
                Confirmer l'arrêt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PLAN PDF / IMAGE MODAL */}
      {planModal && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-3">
          <div className="w-full max-w-4xl h-[85vh] cyber-card cyber-corners p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-[#1E2A38] pb-2">
              <div className="text-xs font-semibold text-white">
                <span className="font-mono-num text-[#22D3EE]">{planModal.revision}</span> · {planModal.filename}
                {planModal.notes && <span className="ml-2 text-amber-300 font-normal">({planModal.notes})</span>}
              </div>
              <div className="flex items-center gap-2">
                <a href={planModal.url} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold">Plein écran</a>
                <button onClick={() => setPlanModal(null)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 bg-[#0B0F14] rounded overflow-hidden">
              {/\.(png|jpg|jpeg|webp)$/i.test(planModal.filename) ? (
                <img src={planModal.url} alt={planModal.filename} className="w-full h-full object-contain" />
              ) : (
                <iframe src={planModal.url} title={planModal.filename} className="w-full h-full border-0 bg-white" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* CNC PROGRAM MODAL */}
      {cncModal && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-3">
          <div className="w-full max-w-2xl cyber-card cyber-corners p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#1E2A38] pb-2">
              <div className="text-xs font-semibold text-white font-mono-num">
                <span className="text-[#22D3EE]">{cncModal.revision}</span> · {cncModal.filename}
              </div>
              <div className="flex items-center gap-2">
                <a href={cncModal.url} download={cncModal.filename} className="px-2.5 py-1 rounded bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold flex items-center gap-1">
                  <Download className="w-3.5 h-3.5" /> Télécharger
                </a>
                <button onClick={() => setCncModal(null)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <pre className="bg-[#0B0F14] border border-[#1E2A38] rounded p-3 text-xs font-mono-num text-cyan-200 max-h-[65vh] overflow-auto whitespace-pre-wrap">
              {cncModal.content}
            </pre>
          </div>
        </div>
      )}

      {/* 3D MODEL MODAL FOR OPERATOR */}
      {model3dModal && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-3">
          <div className="w-full max-w-4xl space-y-2">
            <div className="flex justify-end">
              <button onClick={() => setModel3dModal(null)} className="px-3 py-1.5 rounded bg-[#111821] border border-[#1E2A38] text-white text-xs flex items-center gap-1 cursor-pointer">
                <X className="w-4 h-4" /> Fermer la vue 3D
              </button>
            </div>
            <ModelViewer3D
              fileUrl={model3dModal.url}
              fileName={`${model3dModal.filename} (${model3dModal.revision})`}
              allowUpload={false}
              heightClass="h-[65vh]"
              title="Consultation 3D Opérateur"
            />
          </div>
        </div>
      )}

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
        const partial = partialByOp[op.id] || { bonne: op.quantiteBonne || 0, rebut: op.quantiteRebut || 0 };

        const planFile = p.be?.planFile;
        const cncFile = p.be?.cncFile;
        const model3dFile = p.be?.model3dFile;

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
              {(op.tempsReglageMin > 0 || op.tempsUnitaireMin > 0) && (
                <div className="text-[10px] font-mono-num text-slate-400 mt-0.5">
                  Réglage : {op.tempsReglageMin || 0} min · Usinage : {op.tempsUnitaireMin > 0 ? `${p.quantitePrevue} × ${op.tempsUnitaireMin} min` : `${Math.max(0, (op.tempsPrevuMin || 0) - (op.tempsReglageMin || 0))} min`}
                </div>
              )}
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

            {/* DOSSIER TECHNIQUE BE — CONSULTATION DIRECTE OPERATEUR */}
            <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 text-xs space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Dossier Technique BE (Révision active)</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-[#22D3EE]" /> Plan</span>
                  {planFile ? (
                    <button type="button" onClick={() => setPlanModal(planFile)} className="px-2 py-0.5 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] text-[11px] font-mono-num cursor-pointer">
                      {planFile.revision} · Ouvrir {planFile.filename}
                    </button>
                  ) : (
                    <span className="font-mono-num text-slate-400">{p.be.nomFichier || '—'}</span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400 flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5 text-[#22D3EE]" /> Prog. CNC</span>
                  {cncFile ? (
                    <button type="button" onClick={() => openCncFile(cncFile)} className="px-2 py-0.5 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] text-[11px] font-mono-num cursor-pointer">
                      {cncFile.revision} · Voir {cncFile.filename}
                    </button>
                  ) : (
                    <span className="font-mono-num text-slate-400">{p.be.programme || '—'}</span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400 flex items-center gap-1.5"><Box className="w-3.5 h-3.5 text-[#22D3EE]" /> Modèle 3D</span>
                  {model3dFile ? (
                    <button type="button" onClick={() => setModel3dModal(model3dFile)} className="px-2 py-0.5 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] text-[11px] font-mono-num cursor-pointer">
                      {model3dFile.revision} · Voir en 3D
                    </button>
                  ) : (
                    <span className="font-mono-num text-slate-400">{p.be.dessin3d || '—'}</span>
                  )}
                </div>
              </div>
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
                Panne machine ouverte — En attente de résolution par le Chef d’atelier.
              </div>
            )}

            {/* RUNNING CONTROLS */}
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
                    onClick={() => { setStopModalOp({ piece: p, op }); setStopCat('panne'); setStopMotif(''); }}
                    className="flex-1 py-2 rounded-[6px] bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Arrêt / Blocage
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimelinePiece(p)}
                    className="px-2.5 py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-slate-300 text-xs flex items-center gap-1 cursor-pointer"
                    title="Dossier & Historique complet"
                  >
                    <Clock className="w-3.5 h-3.5 text-[#22D3EE]" />
                  </button>
                </div>

                {/* PARTIAL PROGRESS IN-SHIFT */}
                <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[10px] text-slate-400">Pointage partiel :</span>
                  <input
                    type="number"
                    min="0"
                    value={partial.bonne}
                    onChange={e => setPartialByOp(prev => ({ ...prev, [op.id]: { ...partial, bonne: e.target.value } }))}
                    className="w-16 p-1 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-white text-center"
                    title="Qté bonne en cours"
                  />
                  <span className="text-[10px] text-slate-500">ok /</span>
                  <input
                    type="number"
                    min="0"
                    value={partial.rebut}
                    onChange={e => setPartialByOp(prev => ({ ...prev, [op.id]: { ...partial, rebut: e.target.value } }))}
                    className="w-14 p-1 rounded bg-[#111821] border border-[#1E2A38] font-mono-num text-red-300 text-center"
                    title="Rebuts en cours"
                  />
                  <span className="text-[10px] text-red-400">NC</span>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleSavePartial(op)}
                    className="ml-auto px-2.5 py-1 rounded bg-[#111821] border border-[#22D3EE]/40 text-[#22D3EE] hover:bg-[#22D3EE] hover:text-[#0B0F14] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Save className="w-3 h-3" /> Pointer
                  </button>
                </div>

                <form onSubmit={e => handleFinish(p.id, op.id, e)} className="space-y-2.5 pt-2 border-t border-[#1E2A38]">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] text-slate-400">Qté bonne finale</label>
                      <input name="qteBonne" type="number" min="0" defaultValue={p.quantitePrevue} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
                    </div>
                    <div>
                      <label className="text-[10px] text-red-400">Qté rebut (NC)</label>
                      <input name="qteRebut" type="number" min="0" defaultValue={op.quantiteRebut || 0} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
                    </div>
                  </div>
                  <input name="motifRebut" placeholder="Motif rebut / remarque qualité (si rebut > 0)" className="w-full p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-xs text-slate-200" />
                  <input name="photoFin" type="file" accept="image/*" capture="environment" className="w-full text-xs text-slate-400" />
                  <button type="submit" disabled={isBusy} className="w-full py-2.5 rounded-[6px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
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
