import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react';
import { api } from '../api';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const from = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d,12); };
const move = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const mins = s => { const [h,m]=s.split(':').map(Number); return h*60+m; };

export default function WorkshopCalendar({ state, draft = null, onFindGap, onReassign, onMove }) {
  const [mode,setMode]=useState('jour');
  const [date,setDate]=useState(ymd(new Date()));
  const [data,setData]=useState({segments:[],unscheduled:0,settings:{}});
  const [error,setError]=useState('');
  const [selected,setSelected]=useState(null);
  const [targetMachine,setTargetMachine]=useState('');
  const [moveDate,setMoveDate]=useState(''), [moveTime,setMoveTime]=useState('08:00');
  useEffect(() => {
    let live=true;
    api('/api/planning/calendar').then(d => { if(live) {setData(d);setError('');} }).catch(e=>{if(live)setError(e.message)});
    return ()=>{live=false};
  }, [state]);
  const draftSegments = draft ? draft.operations.flatMap(op => op.segments.map(segment => ({ ...segment,
    opId: op.opId, pieceId: op.pieceId, nom: op.pieceNom, machineId: op.machineId,
    operateur: state.users.find(u => u.id === op.operateurId)?.nom || 'À affecter',
    libelle: op.libelle, statut: op.statut, publie: false }))) : null;
  const visibleSegments = draftSegments || data.segments;
  const current=from(date);
  const first=mode==='semaine' ? move(current,-current.getDay()) : mode==='mois' ? new Date(current.getFullYear(),current.getMonth(),1,12) : current;
  const count=mode==='jour'?1:mode==='semaine'?7:new Date(current.getFullYear(),current.getMonth()+1,0).getDate();
  const dates=Array.from({length:count},(_,i)=>ymd(move(first,i)));
  const machines=state.machines.filter(m=>m.actif);
  const settings=data.settings || {};
  const start=mins(settings.shiftStart||'08:00'), end=mins(settings.shiftEnd||'17:00');
  const hours=Array.from({length: Math.max(1,Math.ceil((end-start)/60))+1},(_,i)=>`${String(Math.floor((start+i*60)/60)).padStart(2,'0')}h`);
  function navigate(direction) {
    if(mode==='mois') { const d=new Date(current.getFullYear(),current.getMonth()+direction,1,12); setDate(ymd(d)); }
    else setDate(ymd(move(current,direction*(mode==='jour'?1:7))));
  }
  const label=mode==='mois'?current.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}):mode==='semaine'?`${from(dates[0]).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} – ${from(dates[6]).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}`:current.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const openDay=d=>{setDate(d);setMode('jour')};
  const color = s => s.statut==='En cours'?'bg-emerald-500/25 border-emerald-400/50 text-emerald-100':s.urgence==='Critique'?'bg-red-500/20 border-red-400/50 text-red-100':s.urgence==='Urgent'?'bg-amber-500/20 border-amber-400/50 text-amber-100':'bg-cyan-500/15 border-cyan-400/40 text-cyan-100';
  return <section className="cyber-card p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="text-white font-semibold flex items-center gap-2"><CalendarDays size={17} className="text-cyan-400"/> Planning des machines</div><div className="text-xs text-slate-400 mt-1">{draft ? 'Aperçu du brouillon · aucune modification publiée' : `Créneaux enregistrés · durée restante estimée · ${data.unscheduled} opération(s) sans créneau`}</div></div>
      <div className="flex rounded-lg border border-slate-700 p-1 gap-1">{[['jour','Jour'],['semaine','Semaine'],['mois','Mois']].map(([v,l])=><button type="button" key={v} onClick={()=>setMode(v)} className={`px-3 py-1.5 rounded-md text-xs ${mode===v?'bg-cyan-400 text-slate-950 font-semibold':'text-slate-300 hover:bg-slate-800'}`}>{l}</button>)}</div>
    </div>
    <div className="flex items-center gap-2"><button type="button" aria-label="Période précédente" onClick={()=>navigate(-1)} className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800"><ChevronLeft size={15}/></button><div className="min-w-0 text-sm font-medium text-white capitalize">{label}</div><button type="button" aria-label="Période suivante" onClick={()=>navigate(1)} className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800"><ChevronRight size={15}/></button><button type="button" onClick={()=>setDate(ymd(new Date()))} className="ml-auto text-xs text-cyan-300 hover:text-white">Aujourd’hui</button></div>
    {error && <div className="text-red-300 text-xs">Impossible de charger le planning : {error}</div>}
    <div className="md:hidden space-y-2">
      {mode === 'jour' ? machines.map(m => { const entries=visibleSegments.filter(s=>s.machineId===m.id && s.date===date); return <div key={m.id} className="rounded-lg border border-slate-800 bg-[#0d151e] p-3 space-y-2"><div className="text-xs font-semibold text-slate-200">{m.nom} {!!m.enPanne && <span className="text-red-400"> · En panne</span>}</div>{entries.length ? entries.map((s,i)=><button type="button" key={s.opId+i} onClick={()=>setSelected(s)} className={`w-full text-left px-2 py-2 rounded border text-xs ${color(s)}`}><strong>{s.start}–{s.end} · {s.pieceId}</strong><br/>{s.libelle} · {s.operateur || 'À affecter'}</button>) : <div className="text-xs text-slate-500">Aucune opération affichée</div>}</div>}) : dates.map(d=>{const entries=visibleSegments.filter(s=>s.date===d);return <button type="button" key={d} onClick={()=>openDay(d)} className="w-full text-left flex justify-between gap-2 px-3 py-3 rounded-lg bg-[#0d151e] border border-slate-800 text-xs"><span className="text-slate-200 capitalize">{from(d).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</span><span className="text-cyan-300">{entries.length} opération(s) →</span></button>})}
    </div>
    <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-800">
      <div style={{minWidth:mode==='jour'?720:mode==='semaine'?900:Math.max(1100,count*72+155)}}>
        <div className="flex bg-[#0b1119] border-b border-slate-800"><div className="w-36 shrink-0 p-3 text-xs text-slate-400">Machine</div><div className={`flex flex-1 ${mode==='jour'?'relative h-10':''}`}>{mode==='jour'?hours.map((h,i)=><div key={i} className="absolute top-3 text-[10px] text-slate-400" style={{left:`${i/(hours.length-1)*100}%`,transform:i===hours.length-1?'translateX(-100%)':'none'}}>{h}</div>):dates.map(d=><button type="button" key={d} onClick={()=>openDay(d)} className="flex-1 min-w-0 py-2 text-[10px] border-l border-slate-800 text-slate-300 hover:bg-slate-800" title="Ouvrir cette journée">{from(d).toLocaleDateString('fr-FR',{weekday:mode==='semaine'?'short':undefined,day:'2-digit'})}</button>)}</div></div>
        {machines.map(m=>{const all=visibleSegments.filter(s=>s.machineId===m.id && dates.includes(s.date));return <div key={m.id} className="flex border-b border-slate-800 last:border-0"><div className="w-36 shrink-0 p-3 text-xs text-slate-200 font-medium">{m.nom}{!!m.enPanne && <div className="text-red-400 mt-1">● En panne</div>}</div>{mode==='jour'?<div className="relative flex-1 min-h-[72px] bg-[#0d151e]">{hours.slice(0,-1).map((_,i)=><div key={i} className="absolute top-0 bottom-0 border-l border-slate-800" style={{left:`${i/(hours.length-1)*100}%`}}/>)}{all.map((s,i)=><button key={s.opId+i} type="button" onClick={()=>setSelected(s)} title={`${s.pieceId} · ${s.libelle} · ${s.start}–${s.end}`} className={`absolute top-2 h-12 overflow-hidden text-left rounded border px-1 text-[10px] ${color(s)}`} style={{left:`${Math.max(0,(mins(s.start)-start)/(end-start)*100)}%`,width:`${Math.max(1,(mins(s.end)-mins(s.start))/(end-start)*100)}%`}}>{(mins(s.end)-mins(s.start))/(end-start)>0.08 && <><b>{s.pieceId}</b><br/>{s.start}–{s.end}</>}</button>)}</div>:<div className="flex flex-1">{dates.map(d=>{const entries=all.filter(s=>s.date===d);return <div key={d} className="flex-1 min-w-0 border-l border-slate-800 p-1 min-h-[72px] bg-[#0d151e] space-y-1">{entries.map((s,i)=><button type="button" key={s.opId+i} onClick={()=>setSelected(s)} title={`${s.pieceId} ${s.start}–${s.end}`} className={`w-full truncate text-left text-[10px] px-1 py-1 rounded border ${color(s)}`}>{s.pieceId}</button>)}</div>})}</div>}</div>})}
        {!machines.length && <div className="p-4 text-xs text-slate-400">Aucune machine active.</div>}
      </div>
    </div>
    <p className="text-[11px] text-slate-500">Les durées et les dates restent des estimations à vérifier.</p>
    {selected && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={()=>setSelected(null)}><div className="w-full max-w-md bg-[#111b27] border border-slate-700 rounded-xl p-5 space-y-3" onClick={e=>e.stopPropagation()}><div className="flex justify-between items-center"><h3 className="font-semibold text-white">{selected.pieceId} · {selected.nom}</h3><button onClick={()=>setSelected(null)} aria-label="Fermer"><X size={18}/></button></div><p className="text-cyan-300 text-sm">{selected.libelle}</p><p className="text-sm text-slate-300">{from(selected.date).toLocaleDateString('fr-FR')} · {selected.start} – {selected.end}</p><p className="text-sm text-slate-400">Opérateur : {selected.operateur || 'À affecter'} · {selected.statut} · {selected.publie?'Publié':'Non publié'}</p>{selected.statut === 'En attente' && onFindGap && <button type="button" onClick={()=>{onFindGap(selected.opId);setSelected(null)}} className="px-3 py-2 rounded bg-cyan-400 text-slate-950 text-xs font-semibold">Chercher un créneau plus tôt</button>}{selected.statut === 'En attente' && onMove && <div className="space-y-2 pt-2 border-t border-slate-700"><p className="text-xs text-slate-300">Proposer un autre horaire sur cette machine</p><div className="flex gap-2 flex-wrap"><input aria-label="Date proposée" type="date" value={moveDate} onChange={e=>setMoveDate(e.target.value)} className="p-2 rounded bg-slate-900 border border-slate-700 text-xs"/><input aria-label="Heure proposée" type="time" value={moveTime} onChange={e=>setMoveTime(e.target.value)} className="p-2 rounded bg-slate-900 border border-slate-700 text-xs"/><button type="button" disabled={!moveDate||!moveTime} onClick={()=>{onMove(selected.opId,moveDate,moveTime);setSelected(null)}} className="px-3 py-2 rounded border border-cyan-500 text-cyan-300 text-xs disabled:opacity-40">Préparer le déplacement</button></div><p className="text-[10px] text-slate-500">Le système contrôle la disponibilité, l’ordre et les délais ; rien n’est publié sans confirmation.</p></div>}{selected.statut === 'En attente' && onReassign && <div className="space-y-2 pt-2 border-t border-slate-700"><label className="text-xs text-slate-400">Proposer une autre machine du même type</label><select value={targetMachine} onChange={e=>setTargetMachine(e.target.value)} className="w-full p-2 rounded bg-slate-900 border border-slate-700 text-xs"><option value="">Choisir une machine</option>{state.machines.filter(m=>m.actif&&!m.enPanne&&m.id!==selected.machineId&&m.type&&m.type===state.machines.find(x=>x.id===selected.machineId)?.type).map(m=><option key={m.id} value={m.id}>{m.nom}</option>)}</select><button type="button" disabled={!targetMachine} onClick={()=>{onReassign(selected.opId,targetMachine);setSelected(null);setTargetMachine('')}} className="px-3 py-2 rounded border border-cyan-500 text-cyan-300 text-xs disabled:opacity-40">Préparer le changement</button><p className="text-[10px] text-slate-500">Même type ne garantit pas la compatibilité : vérifiez capacité, programme, bridage et outillage.</p></div>}</div></div>}
  </section>;
}
