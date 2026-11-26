import React, {useEffect,useState} from 'react';
import {api} from '../api';

export default function OperationInstruction({op,reload,showToast}) {
  const [open,setOpen]=useState(false),[text,setText]=useState(op.consigneChef||''),[busy,setBusy]=useState(false);
  useEffect(()=>setText(op.consigneChef||''),[op.id,op.consigneChef]);
  async function save(e) {
    e.preventDefault();setBusy(true);
    try {await api(`/api/operations/${op.id}/consigne`,'PUT',{consigne:text});showToast(text.trim()?'Consigne transmise à l’opérateur.':'Consigne supprimée.');setOpen(false);await reload();}
    catch(err){showToast(err.message,'err')}finally{setBusy(false)}
  }
  return <div className="md:col-span-12 text-xs border-t border-slate-800 pt-2">
    <button type="button" onClick={()=>setOpen(!open)} className="text-cyan-300 hover:text-white">{op.consigneChef?'Consigne opérateur · modifier':'Ajouter une consigne opérateur'}</button>
    {op.consigneChef&&!open&&<p className="text-amber-200 mt-1 whitespace-pre-wrap break-words">{op.consigneChef} <span className="text-slate-500">· {op.consigneAuteur}</span></p>}
    {open&&<form onSubmit={save} className="mt-2 space-y-2"><label className="block text-slate-400" htmlFor={`instruction-${op.id}`}>Consigne pour {op.operateur || 'l’opérateur'} · 500 caractères maximum</label><textarea id={`instruction-${op.id}`} value={text} onChange={e=>setText(e.target.value)} maxLength={500} rows={2} className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white" placeholder="Ex. : contrôler le bridage avant usinage"/><div className="flex gap-2"><button disabled={busy||text.trim()===(op.consigneChef||'')} className="px-3 py-1.5 rounded bg-cyan-400 text-slate-950 font-semibold disabled:opacity-40">Enregistrer</button><button type="button" onClick={()=>{setText(op.consigneChef||'');setOpen(false)}} className="text-slate-400">Annuler</button></div><p className="text-slate-500">Une consigne vide supprime la consigne existante. Le planning ne change pas.</p></form>}
  </div>;
}
