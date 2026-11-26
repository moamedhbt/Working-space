import React, { useEffect, useState } from 'react';
import { Bot, CalendarDays, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import WorkshopCalendar from './WorkshopCalendar';
import PlanningAvailability from './PlanningAvailability';

const DAYS = [[0,'Dim'],[1,'Lun'],[2,'Mar'],[3,'Mer'],[4,'Jeu'],[5,'Ven'],[6,'Sam']];
export default function ChefPlanningTab({state, reload, showToast}) {
  const [proposal,setProposal]=useState(null), [busy,setBusy]=useState(false);
  const [question,setQuestion]=useState(''), [reply,setReply]=useState(null);
  const [priority,setPriority]=useState(''), [showSettings,setShowSettings]=useState(false);
  const [calendar,setCalendar]=useState({workDays:[0,1,2,3,4],shiftStart:'08:00',shiftEnd:'17:00'});
  useEffect(()=>{if(state.settings && !showSettings)setCalendar(state.settings)},[state.settings, showSettings]);
  const openPieces=state.pieces.filter(p=>!p.archived&&!['Clôturé','Refusé'].includes(p.statut));
  async function calculate(preservePublished = false) {
    setBusy(true);
    try {const r=await api('/api/planning/drafts','POST',{priorityFirst:priority||null,preservePublished});setProposal(r);showToast('Brouillon calculé, rien n’a été publié.');}
    catch(e){showToast(e.message,'err')} finally{setBusy(false)}
  }
  async function findGap(operationId) {
    setBusy(true);
    try {const r=await api('/api/planning/drafts/find-gap','POST',{operationId});setProposal(r.proposal);showToast('Créneau proposé dans un brouillon : vérifiez les changements.');}
    catch(e){showToast(e.message,'err')} finally{setBusy(false)}
  }
  async function move(operationId,startDate,startTime) {
    setBusy(true);
    try {const r=await api('/api/planning/drafts/move','POST',{operationId,startDate,startTime,...(proposal?.id?{draftId:proposal.id}:{})});setProposal(r.proposal);showToast('Déplacement préparé : vérifiez les délais et changements.');}
    catch(e){showToast(e.message,'err')} finally{setBusy(false)}
  }
  async function reassign(operationId,machineId) {
    setBusy(true);
    try {const r=await api('/api/planning/drafts/reassign','POST',{operationId,machineId});setProposal(r.proposal);showToast('Changement préparé : vérifiez les capacités et le brouillon.');}
    catch(e){showToast(e.message,'err')} finally{setBusy(false)}
  }
  async function publish() {
    if(!proposal || !window.confirm('Publier ce brouillon et ses changements pour les opérateurs et la TV ?'))return;
    setBusy(true);
    try {const r=await api(`/api/planning/drafts/${proposal.id}/publish`,'POST',{});setProposal(null);showToast(`${r.published} OF publiés · ${r.blocked?.length || 0} bloqués exclus.`);reload();}
    catch(e){showToast(e.message,'err')} finally{setBusy(false)}
  }
  async function ask(e) {
    e.preventDefault(); if(!question.trim())return;setBusy(true);
    try{const r=await api('/api/planning/copilot','POST',{question});setReply(r);if(r.proposal)setProposal(r.proposal)}
    catch(e){showToast(e.message,'err')}finally{setBusy(false)}
  }
  async function saveSettings(){
    setBusy(true);try{await api('/api/settings','PUT',calendar);setShowSettings(false);showToast('Calendrier enregistré. Recalculez le brouillon.');reload()}
    catch(e){showToast(e.message,'err')}finally{setBusy(false)}
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between items-center gap-2"><div><h2 className="text-lg font-semibold text-white">Planning atelier</h2><p className="text-xs text-slate-400 mt-1">Préparez, vérifiez puis publiez pour les opérateurs et la TV.</p></div><button type="button" onClick={()=>setShowSettings(!showSettings)} className="px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 flex items-center gap-2"><CalendarDays size={15}/>{DAYS.filter(([d])=>calendar.workDays.includes(d)).map(([,label])=>label).join(' · ')} | {calendar.shiftStart}–{calendar.shiftEnd}</button></div>
    {showSettings && <div className="cyber-card p-4 flex flex-wrap items-center gap-3 text-xs"><span className="text-slate-400">Jours ouvrés</span>{DAYS.map(([n,label])=><button type="button" key={n} onClick={()=>setCalendar(p=>({...p,workDays:p.workDays.includes(n)?p.workDays.filter(d=>d!==n):[...p.workDays,n].sort()}))} className={`px-2 py-1 rounded border ${calendar.workDays.includes(n)?'text-cyan-300 border-cyan-500':'text-slate-500 border-slate-700'}`}>{label}</button>)}<input type="time" value={calendar.shiftStart} onChange={e=>setCalendar({...calendar,shiftStart:e.target.value})} className="p-1 bg-slate-900 border border-slate-700 rounded"/><span>–</span><input type="time" value={calendar.shiftEnd} onChange={e=>setCalendar({...calendar,shiftEnd:e.target.value})} className="p-1 bg-slate-900 border border-slate-700 rounded"/><button type="button" disabled={busy} onClick={saveSettings} className="px-3 py-1 rounded bg-cyan-500 text-slate-950 font-semibold">Enregistrer</button></div>}
    <section className="cyber-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">Préparer un planning</h3><p className="text-xs text-slate-400 mt-1">Un brouillon ne change pas le planning publié.</p></div><div className="flex gap-2 flex-wrap"><select aria-label="OF à avancer" value={priority} onChange={e=>setPriority(e.target.value)} className="px-2 py-2 rounded bg-slate-900 border border-slate-700 text-xs"><option value="">Priorités habituelles</option>{openPieces.map(p=><option key={p.id} value={p.id}>Avancer {p.id} · {p.nom}</option>)}</select><button type="button" disabled={busy} onClick={()=>calculate(false)} className="px-3 py-2 rounded bg-cyan-400 text-slate-950 font-semibold text-xs disabled:opacity-50">Calculer un brouillon</button></div></div>
      {proposal && <div className="border-t border-slate-800 pt-3 space-y-2"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-cyan-300">Brouillon</span><span className="text-slate-300">{proposal.operations.length} opérations · {proposal.changes?.length||0} changements · {proposal.blockers.length} blocages</span></div>{proposal.blockers.map((v,i)=><div className="text-xs text-red-300 flex gap-1" key={i}><AlertTriangle size={13}/> {v}</div>)}{proposal.warnings.map((v,i)=><div className="text-xs text-amber-300" key={i}>• {v}</div>)}<p className="text-[11px] text-slate-400">Les OF bloqués sont exclus et retirés de la publication ; les opérations en cours restent visibles aux opérateurs.</p><details className="text-xs text-slate-300"><summary className="cursor-pointer text-cyan-300">Voir les changements ({proposal.changes?.length||0})</summary><div className="max-h-48 overflow-auto space-y-2 pt-2">{(proposal.changes||[]).map(c=><div key={c.opId} className="p-2 bg-slate-900 rounded"><strong>{c.pieceId} · {c.libelle}</strong><br/>{c.before} → {c.after}<br/>Machine : {c.machineBefore} → {state.machines.find(m=>m.id===c.machineAfter)?.nom || c.machineAfter}{c.segmentsChanged && ((c.beforeSlots?.length||0)>1 || (c.afterSlots?.length||0)>1) && <details className="mt-1 text-slate-400"><summary className="cursor-pointer">Détail des journées</summary><p>Avant : {c.beforeSlots?.map(s=>`${s.date} ${s.start}–${s.end}`).join(' · ') || 'Non publié'}</p><p>Après : {c.afterSlots?.map(s=>`${s.date} ${s.start}–${s.end}`).join(' · ')}</p></details>}</div>)}</div></details><div className="flex gap-2 flex-wrap"><button type="button" disabled={busy||proposal.fatal?.length>0||!proposal.publishablePieceIds?.length} onClick={publish} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1"><CheckCircle2 size={14}/> Confirmer et publier</button><button type="button" onClick={()=>setProposal(null)} className="px-3 py-2 rounded border border-slate-700 text-xs">Fermer l’aperçu</button></div><p className="text-[11px] text-slate-500">Un changement de données ou un brouillon de plus de dix minutes nécessite un nouveau calcul. Vérifiez les capacités et outils.</p></div>}
    </section>
    <div className="text-xs text-slate-400">Après une panne, une urgence ou un retard, préparez une adaptation qui conserve les OF publiés encore valides : <button type="button" disabled={busy} onClick={()=>calculate(true)} className="text-cyan-300 underline">Préparer une adaptation</button>. Vérifiez les changements et les délais avant publication.</div>
    <WorkshopCalendar state={state} draft={proposal} onFindGap={findGap} onReassign={reassign} onMove={move}/>
    <PlanningAvailability state={state} reload={reload} showToast={showToast} onRecalculate={()=>calculate(true)}/>
    <section className="cyber-card p-4 space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-white"><Bot size={17} className="text-cyan-400"/> Copilote atelier</div><p className="text-xs text-slate-400">Posez une question, demandez d’avancer un OF ou cherchez un créneau libre. Le copilote propose ; vous décidez.</p><form onSubmit={ask} className="flex flex-col sm:flex-row gap-2"><input value={question} onChange={e=>setQuestion(e.target.value)} maxLength={2000} placeholder="Ex. : avance l’OF-2026-0101" className="flex-1 p-2 rounded bg-[#0B0F14] border border-slate-700 text-sm"/><button disabled={busy||!question.trim()} className="px-4 py-2 rounded bg-cyan-500 text-slate-950 text-xs font-semibold disabled:opacity-40">Demander</button></form>{reply&&<div className="rounded bg-[#0B0F14] border border-slate-700 p-3 text-xs text-slate-200 whitespace-pre-wrap">{reply.answer}<div className="text-slate-500 mt-2">{reply.model||'Copilote'} · {reply.proposal?'Brouillon préparé ci-dessus':'Aucun changement préparé'}</div></div>}<p className="text-[10px] text-slate-500">La demande et un résumé des OF et machines sont envoyés au fournisseur IA configuré. Les capacités machines restent à vérifier par le chef.</p></section>
  </div>;
}
