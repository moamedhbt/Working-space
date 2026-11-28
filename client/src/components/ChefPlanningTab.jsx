import React, { useEffect, useRef, useState } from 'react';
import { Bot, CalendarDays, AlertTriangle, CheckCircle2, X, Send, Sparkles, MessageCircle } from 'lucide-react';
import { api } from '../api';
import WorkshopCalendar from './WorkshopCalendar';
import PlanningAvailability from './PlanningAvailability';
import {useWorkshopDialog} from './WorkshopDialog';

const DAYS = [[0,'Dim'],[1,'Lun'],[2,'Mar'],[3,'Mer'],[4,'Jeu'],[5,'Ven'],[6,'Sam']];
export default function ChefPlanningTab({state, reload, showToast, incomingProposal, ask, adaptRequest}) {
  const fallbackDialog=useWorkshopDialog();
  const confirmAction=ask || fallbackDialog.ask;
  const [proposal,setProposal]=useState(null), [busy,setBusy]=useState(false);
  const [question,setQuestion]=useState(''), [messages,setMessages]=useState([]), [copilotOpen,setCopilotOpen]=useState(false), [copilotError,setCopilotError]=useState(''), [chatBusy,setChatBusy]=useState(false);
  const proposalRef=useRef(null);
  useEffect(()=>{document.querySelectorAll('[aria-label="Conversation avec le copilote"]').forEach(el=>{el.scrollTop=el.scrollHeight})},[messages,chatBusy,copilotOpen]);
  useEffect(()=>{if(incomingProposal){setProposal(incomingProposal);setTimeout(()=>proposalRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),50)}},[incomingProposal]);
  useEffect(()=>{if(!copilotOpen)return;const onKey=e=>{if(e.key==='Escape')setCopilotOpen(false)};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[copilotOpen]);
  const [priority,setPriority]=useState(''), [showSettings,setShowSettings]=useState(false);
  const [calendar,setCalendar]=useState({workDays:[0,1,2,3,4],shiftStart:'08:00',shiftEnd:'17:00'});
  useEffect(()=>{if(state.settings && !showSettings)setCalendar(state.settings)},[state.settings, showSettings]);
  useEffect(()=>{if(!adaptRequest)return;let active=true;(async()=>{if(proposal && !await confirmAction('Une proposition est déjà ouverte. Calculer une adaptation remplacera cet aperçu, sans publier.',{title:'Adapter le planning',confirmLabel:'Calculer'}))return;if(active)await calculate(true)})();return()=>{active=false}},[adaptRequest]);
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
  async function proposeOperation(payload) {
    if (proposal && !await confirmAction('Une proposition est déjà affichée. En calculer une nouvelle remplacera cet aperçu ; le planning publié ne changera pas.',{title:'Calculer une nouvelle proposition',confirmLabel:'Calculer'})) return false;
    setBusy(true);
    try {
      const result=await api('/api/planning/drafts/operation','POST',payload);
      setProposal(result.proposal);
      showToast('Proposition calculée : consultez les changements avant de publier.');
      setTimeout(()=>proposalRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),50);
      return true;
    } catch(e) {showToast(e.message,'err');return false;} finally {setBusy(false);}
  }
  async function publish() {
    if(!proposal || !await confirmAction('Publier ce brouillon et ses changements pour les opérateurs et la TV ?', {title:'Publier le planning',confirmLabel:'Publier'}))return;
    setBusy(true);
    try {const r=await api(`/api/planning/drafts/${proposal.id}/publish`,'POST',{});setProposal(null);showToast(`${r.published} OF publiés · ${r.blocked?.length || 0} bloqués exclus.`);reload();}
    catch(e){showToast(e.message,'err')} finally{setBusy(false)}
  }
  async function askCopilot(e) {
    e.preventDefault();const text=question.trim();if(!text||chatBusy)return;
    const prior=messages.filter(m=>m.role==='user'||m.role==='assistant').map(({role,text})=>({role,text})).slice(-12);
    setMessages(prev=>[...prev,{role:'user',text}]);setQuestion('');setChatBusy(true);setCopilotError('');
    try{const r=await api('/api/planning/copilot','POST',{question:text,history:prior});setMessages(prev=>[...prev,{role:'assistant',text:r.answer,model:r.model,proposalId:r.proposal?.id}]);if(r.proposal)setProposal(r.proposal)}
    catch(err){setCopilotError(err.message)}finally{setChatBusy(false)}
  }
  async function saveSettings(){
    setBusy(true);try{await api('/api/settings','PUT',calendar);setShowSettings(false);showToast('Calendrier enregistré. Recalculez le brouillon.');reload()}
    catch(e){showToast(e.message,'err')}finally{setBusy(false)}
  }
  function showProposal(){setCopilotOpen(false);setTimeout(()=>proposalRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),50)}
  const copilot=(location)=><section className={`${location==='mobile'?'h-full border-0 rounded-none':'cyber-card min-h-[500px]'} bg-[#101a25] flex flex-col overflow-hidden`} aria-label="Copilote atelier">
    <div className="px-4 py-4 border-b border-slate-700/70 flex items-center justify-between gap-2 bg-[#142331]">
      <div className="flex items-center gap-3 min-w-0"><div className="w-10 h-10 rounded-xl bg-cyan-400/15 border border-cyan-400/30 flex items-center justify-center shrink-0"><Sparkles size={19} className="text-cyan-300"/></div><div><div className="text-sm font-semibold text-white">Copilote atelier</div><p className="text-[11px] text-slate-400 mt-0.5">Votre assistant pour le planning</p></div></div>
      <div className="flex items-center gap-3"><button type="button" disabled={chatBusy} onClick={()=>{setMessages([]);setCopilotError('')}} className="text-[11px] text-slate-300 underline disabled:opacity-40">Nouveau</button><button type="button" aria-label="Fermer le copilote" onClick={()=>setCopilotOpen(false)} className="p-2 rounded-lg bg-slate-800 text-slate-200"><X size={18}/></button></div>
    </div>
    <div role="log" aria-label="Conversation avec le copilote" aria-live="polite" className={`${location==='mobile'?'flex-1 min-h-0':'h-[360px]'} overflow-y-auto space-y-4 px-4 py-5 bg-[#0b141d]`}>
      {!messages.length&&<div className="space-y-4"><div className="flex gap-2 items-start"><div className="w-7 h-7 rounded-full bg-cyan-400/20 flex items-center justify-center shrink-0"><Bot size={15} className="text-cyan-300"/></div><div className="rounded-2xl rounded-tl-sm bg-[#1d3040] p-3 text-[13px] leading-relaxed text-slate-100">Bonjour ! Je suis là pour vous aider à organiser l’atelier. Posez-moi une question ou demandez-moi de préparer une proposition.</div></div><div className="pl-9 space-y-2"><p className="text-[11px] text-slate-400">Pour commencer :</p>{['Quelles sont les priorités aujourd’hui ?', 'Aide-moi à avancer un OF', 'Propose un opérateur et un temps selon l’historique'].map(text=><button type="button" key={text} onClick={()=>setQuestion(text)} className="block w-full text-left rounded-lg border border-slate-700 bg-[#12212c] px-3 py-2 text-xs text-cyan-200 hover:border-cyan-500">{text} <span className="float-right">↗</span></button>)}</div></div>}
      {messages.map((m,i)=><div key={i} className={`flex gap-2 ${m.role==='user'?'justify-end':'justify-start'}`}>{m.role==='assistant'&&<div className="w-7 h-7 rounded-full bg-cyan-400/20 flex items-center justify-center shrink-0"><Bot size={15} className="text-cyan-300"/></div>}<div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${m.role==='user'?'rounded-tr-sm bg-cyan-600 text-white':'rounded-tl-sm bg-[#1d3040] text-slate-100'}`}><p>{m.text}</p>{m.role==='assistant'&&<p className="mt-2 text-[10px] text-slate-400">{m.model||'Copilote'} · {m.proposalId?'Proposition préparée':'Aucune modification'}</p>}{m.proposalId&&proposal?.id===m.proposalId&&<button type="button" onClick={showProposal} className="block rounded-lg bg-cyan-400 text-slate-950 px-3 py-2 font-semibold mt-3 text-xs">Voir la proposition →</button>}</div></div>)}
      {chatBusy&&<div className="flex gap-2 items-center text-xs text-slate-400"><Bot size={15} className="text-cyan-400"/> Le copilote réfléchit…</div>}
      {copilotError&&<div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">{copilotError}</div>}
    </div>
    <div className="p-3 border-t border-slate-700 bg-[#14212c] space-y-2"><form onSubmit={askCopilot} className="flex gap-2 items-end"><label className="sr-only" htmlFor={`copilot-${location}`}>Votre demande au copilote</label><textarea id={`copilot-${location}`} rows="2" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} maxLength={2000} placeholder="Écrivez votre message…" className="min-w-0 flex-1 resize-none p-3 rounded-xl bg-[#09121b] border border-slate-600 text-sm text-white placeholder:text-slate-500"/><button aria-label="Demander" disabled={chatBusy||!question.trim()} className="w-11 h-11 flex items-center justify-center rounded-xl bg-cyan-400 text-slate-950 disabled:opacity-40"><Send size={18}/></button></form><p className="text-[10px] text-slate-500">Conversation conservée pendant cette session. Les échanges récents et un résumé atelier sont envoyés au fournisseur IA. Vous restez responsable de la publication.</p></div>
  </section>;
  return <div className="space-y-4">{fallbackDialog.dialog}
    <div className="flex flex-wrap justify-between items-center gap-2"><div><h2 className="text-lg font-semibold text-white">Planning atelier</h2><p className="text-xs text-slate-400 mt-1">Préparez, vérifiez puis publiez pour les opérateurs et la TV.</p></div><button type="button" onClick={()=>setShowSettings(!showSettings)} className="px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 flex items-center gap-2"><CalendarDays size={15}/>{DAYS.filter(([d])=>calendar.workDays.includes(d)).map(([,label])=>label).join(' · ')} | {calendar.shiftStart}–{calendar.shiftEnd}</button></div>
    <button type="button" onClick={()=>setCopilotOpen(true)} className="w-full flex items-center gap-3 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-500/15 to-[#142331] px-4 py-3 text-left"><span className="w-10 h-10 rounded-lg bg-cyan-400/15 flex items-center justify-center"><MessageCircle size={19} className="text-cyan-300"/></span><span className="flex-1"><strong className="block text-sm text-white">Discuter avec le copilote</strong><span className="text-[11px] text-slate-400">Questions et propositions pour le planning</span></span><span className="text-cyan-300 text-sm">Ouvrir →</span></button>
    {showSettings && <div className="cyber-card p-4 flex flex-wrap items-center gap-3 text-xs"><span className="text-slate-400">Jours ouvrés</span>{DAYS.map(([n,label])=><button type="button" key={n} onClick={()=>setCalendar(p=>({...p,workDays:p.workDays.includes(n)?p.workDays.filter(d=>d!==n):[...p.workDays,n].sort()}))} className={`px-2 py-1 rounded border ${calendar.workDays.includes(n)?'text-cyan-300 border-cyan-500':'text-slate-500 border-slate-700'}`}>{label}</button>)}<input type="time" value={calendar.shiftStart} onChange={e=>setCalendar({...calendar,shiftStart:e.target.value})} className="p-1 bg-slate-900 border border-slate-700 rounded"/><span>–</span><input type="time" value={calendar.shiftEnd} onChange={e=>setCalendar({...calendar,shiftEnd:e.target.value})} className="p-1 bg-slate-900 border border-slate-700 rounded"/><button type="button" disabled={busy} onClick={saveSettings} className="px-3 py-1 rounded bg-cyan-500 text-slate-950 font-semibold">Enregistrer</button></div>}
    <section className="cyber-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">Préparer un planning</h3><p className="text-xs text-slate-400 mt-1">Un brouillon ne change pas le planning publié.</p></div><div className="flex gap-2 flex-wrap"><select aria-label="OF à avancer" value={priority} onChange={e=>setPriority(e.target.value)} className="px-2 py-2 rounded bg-slate-900 border border-slate-700 text-xs"><option value="">Priorités habituelles</option>{openPieces.map(p=><option key={p.id} value={p.id}>Avancer {p.id} · {p.nom}</option>)}</select><button type="button" disabled={busy} onClick={()=>calculate(false)} className="px-3 py-2 rounded bg-cyan-400 text-slate-950 font-semibold text-xs disabled:opacity-50">Calculer un brouillon</button></div></div>
      {proposal && <div ref={proposalRef} className="border-t border-slate-800 pt-3 space-y-2"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-cyan-300">Proposition à vérifier · non publiée</span><span className="text-slate-300">{proposal.operations.length} opérations · {proposal.changes?.length||0} changements · {proposal.blockers.length} blocages</span></div>{proposal.blockers.map((v,i)=><div className="text-xs text-red-300 flex gap-1" key={i}><AlertTriangle size={13}/> {v}</div>)}{proposal.warnings.map((v,i)=><div className="text-xs text-amber-300" key={i}>• {v}</div>)}<p className="text-[11px] text-slate-400">Les OF bloqués sont exclus et retirés de la publication ; les opérations en cours restent visibles aux opérateurs.</p><details key={proposal.id} open className="text-xs text-slate-300"><summary className="cursor-pointer text-cyan-300">Voir les changements ({proposal.changes?.length||0})</summary><div className="max-h-48 overflow-auto space-y-2 pt-2">{(proposal.changes||[]).map(c=><div key={c.opId} className="p-2 bg-slate-900 rounded"><strong>{c.pieceId} · {c.libelle}</strong><br/>{c.before} → {c.after}<br/>Machine : {c.machineBefore} → {state.machines.find(m=>m.id===c.machineAfter)?.nom || c.machineAfter}{c.detailChanged && <><br/>Opérateur : {state.users.find(u=>u.id===c.operatorBefore)?.nom || c.operatorBefore} → {state.users.find(u=>u.id===c.operatorAfter)?.nom || c.operatorAfter}<br/>Temps prévu : {c.durationBefore} → {c.durationAfter} min{proposal.operationEdit?.operationId===c.opId && <> · réglage {proposal.operationEdit.tempsReglageMin} min · unitaire {proposal.operationEdit.tempsUnitaireMin} min/pièce</>}</>}{c.segmentsChanged && ((c.beforeSlots?.length||0)>1 || (c.afterSlots?.length||0)>1) && <details className="mt-1 text-slate-400"><summary className="cursor-pointer">Détail des journées</summary><p>Avant : {c.beforeSlots?.map(s=>`${s.date} ${s.start}–${s.end}`).join(' · ') || 'Non publié'}</p><p>Après : {c.afterSlots?.map(s=>`${s.date} ${s.start}–${s.end}`).join(' · ')}</p></details>}</div>)}</div></details><div className="flex gap-2 flex-wrap"><button type="button" disabled={busy||proposal.fatal?.length>0||!proposal.publishablePieceIds?.length} onClick={publish} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1"><CheckCircle2 size={14}/> Confirmer et publier</button><button type="button" onClick={()=>setProposal(null)} className="px-3 py-2 rounded border border-slate-700 text-xs">Fermer l’aperçu</button></div><p className="text-[11px] text-slate-500">Un changement de données ou un brouillon de plus de dix minutes nécessite un nouveau calcul. Vérifiez les capacités et outils.</p></div>}
    </section>
    <div className="text-xs text-slate-400">Après une panne, une urgence ou un retard, préparez une adaptation qui conserve les OF publiés encore valides : <button type="button" disabled={busy} onClick={()=>calculate(true)} className="text-cyan-300 underline">Préparer une adaptation</button>. Vérifiez les changements et les délais avant publication.</div>
    <div>
      <div className="min-w-0 space-y-4"><WorkshopCalendar state={state} draft={proposal} onFindGap={findGap} onReassign={reassign} onMove={move} onProposeOperation={proposeOperation}/><PlanningAvailability state={state} reload={reload} showToast={showToast} ask={confirmAction} onRecalculate={()=>calculate(true)}/></div>
    </div>
    {copilotOpen&&<div className="fixed inset-0 z-[80] flex justify-end bg-black/65" onClick={()=>setCopilotOpen(false)}><div role="dialog" aria-modal="true" aria-label="Copilote atelier" onClick={e=>e.stopPropagation()} className="w-full h-[100dvh] lg:w-[500px] bg-[#101a25] pb-[env(safe-area-inset-bottom)] shadow-2xl">{copilot('mobile')}</div></div>}

  </div>;
}
