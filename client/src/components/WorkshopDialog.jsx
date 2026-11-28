import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

// A single in-app confirmation/prompt for workshop actions.
export function useWorkshopDialog() {
  const [dialog,setDialog]=useState(null), resolve=useRef(null);
  const ask=(message,options={})=>new Promise(done=>{resolve.current=done;setDialog({message,...options});});
  function finish(value){const done=resolve.current;resolve.current=null;setDialog(null);done?.(value);}
  useEffect(()=>()=>{resolve.current?.(null);resolve.current=null},[]);
  return {ask, dialog:dialog && <WorkshopDialog {...dialog} onFinish={finish}/>};
}
function WorkshopDialog({message,title='Confirmer l’action',confirmLabel='Continuer',defaultValue,onFinish}) {
  const [value,setValue]=useState(defaultValue??'');
  const prompt=defaultValue!==undefined;
  const cancelRef=useRef(null);
  useEffect(()=>{cancelRef.current?.focus();const key=e=>{if(e.key==='Escape')onFinish(prompt?null:false)};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
  return createPortal(<div className="fixed inset-0 z-[200] bg-black/75 flex items-center justify-center p-4" onClick={()=>onFinish(prompt?null:false)}>
    <div role="dialog" aria-modal="true" aria-labelledby="workshop-dialog-title" aria-describedby="workshop-dialog-message" className="w-full max-w-md rounded-xl border border-slate-700 bg-[#111821] p-5 shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
      <h2 id="workshop-dialog-title" className="text-base font-semibold text-white">{title}</h2>
      <p id="workshop-dialog-message" className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">{message}</p>
      {prompt&&<input aria-label="Votre réponse" autoFocus value={value} onChange={e=>setValue(e.target.value)} className="w-full rounded border border-slate-600 bg-[#0B0F14] p-2 text-white"/>}
      <div className="flex justify-end gap-2"><button ref={cancelRef} type="button" onClick={()=>onFinish(prompt?null:false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Annuler</button><button type="button" onClick={()=>onFinish(prompt?value:true)} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">{confirmLabel}</button></div>
    </div>
  </div>,document.body);
}
