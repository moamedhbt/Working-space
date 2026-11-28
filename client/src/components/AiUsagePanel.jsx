import React,{useEffect,useState} from 'react';
import {api} from '../api';

function LimitRow({user,onSaved}) {
  const [limit,setLimit]=useState(String(user.dailyLimit)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>setLimit(String(user.dailyLimit)),[user.dailyLimit]);
  async function save(e){e.preventDefault();setError('');setBusy(true);try{await api(`/api/admin/ai-usage/${user.id}/limit`,'PUT',{dailyLimit:Number(limit)});await onSaved()}catch(err){setError(err.message)}finally{setBusy(false)}}
  return <form onSubmit={save} className="rounded-lg border border-slate-700 bg-[#0B0F14] p-3 space-y-2 text-xs">
    <div className="flex flex-wrap justify-between gap-2"><div><strong className="text-white">{user.nom}</strong><span className="text-slate-400"> · {user.role}{!user.actif?' · désactivé':''}</span></div><span className="text-cyan-300 font-semibold">{user.totalTokens.toLocaleString('fr-FR')} tokens déclarés aujourd’hui</span></div>
    <div className="text-slate-400">Entrée {user.inputTokens.toLocaleString('fr-FR')} · sortie {user.outputTokens.toLocaleString('fr-FR')} · {user.calls} appel(s){user.unknownCalls>0&&<span className="text-amber-300"> · {user.unknownCalls} consommation(s) non communiquée(s)</span>}</div>
    <div className="flex flex-wrap items-end gap-2"><label className="text-slate-300">Limite quotidienne · 0 = sans limite<input aria-label={`Limite quotidienne ${user.nom}`} type="number" min="0" max="1000000000" step="1" required value={limit} onChange={e=>setLimit(e.target.value)} className="block w-40 mt-1 rounded bg-slate-900 border border-slate-700 p-2 text-white"/></label><button disabled={busy} className="px-3 py-2 rounded bg-cyan-500 text-slate-950 font-semibold disabled:opacity-50">Enregistrer</button></div>{error&&<p role="alert" className="text-red-300">{error}</p>}
  </form>;
}
export default function AiUsagePanel(){
 const [data,setData]=useState(null),[error,setError]=useState('');
 async function load(){try{setData(await api('/api/admin/ai-usage'));setError('')}catch(e){setError(e.message)}}
 useEffect(()=>{load()},[]);
 return <section className="cyber-card p-4 space-y-3"><div className="flex flex-wrap justify-between items-center gap-2"><div><h3 className="text-sm font-semibold text-white">Tokens IA par utilisateur</h3><p className="text-xs text-slate-400">Compteur et seuil quotidien · fuseau Alger · {data?.day||'chargement…'}</p></div><button type="button" onClick={load} className="text-xs text-cyan-300 underline">Actualiser</button></div>
 <p className="text-xs text-slate-400">Concerne les appels IA de l’application. Le compteur utilise les données du fournisseur ; si elles manquent, l’appel est signalé comme inconnu. Une limite active bloque ensuite les nouveaux appels de cet utilisateur pour la journée.</p>
 <p className="text-xs text-amber-300">Le seuil est vérifié avant chaque appel : le dernier appel peut le dépasser. Ce n’est pas un plafond de facturation garanti ; configurez aussi une limite chez le fournisseur.</p>
 {error&&<p role="alert" className="text-red-300 text-xs">{error}</p>}{data?.users.map(u=><LimitRow key={u.id} user={u} onSaved={load}/>)}
 </section>;
}
