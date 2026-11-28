import React, {useEffect,useState} from 'react';
import {api} from '../api';

export default function MaterialSummary({pieceId,revision,onOpen}) {
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;setError('');api(`/api/pieces/${pieceId}/material-estimate`).then(x=>{if(live)setData(x)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[pieceId,revision]);
  const v=data?.estimate;
  return <div className="rounded-lg border border-slate-700 bg-[#0B0F14] p-3 text-xs text-slate-300 space-y-1.5">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-white">Estimation matière associée</strong><button type="button" onClick={onOpen} className="text-cyan-300 underline">{v?'Voir ou modifier':'Calculer'}</button></div>
    {error?<p role="alert" className="text-red-300">Estimation indisponible : {error}</p>:v?<><p>{v.material.name} · {({rond:'Rond',plat:'Plat',tube:'Tube',carre:'Barre carrée',hexagonal:'Barre hexagonale',tube_rectangulaire:'Tube rectangulaire'})[v.inputs.shape]} · {v.inputs.quantity} pièces</p><p>Poids théorique : <strong>{v.totalKg.toFixed(2)} kg</strong> · Longueur avec pertes : <strong>{v.totalLengthM.toFixed(3)} m</strong></p><p className="text-slate-400">Estimation indicative, sans réservation ni achat. Elle ne remplace pas la matière saisie ci-dessus.</p>{v.inputs.quantity!==data.ofQuantity&&<p className="text-amber-300">Quantité de l’estimation différente de celle de l’OF ({data.ofQuantity}).</p>}</>:<p className="text-slate-400">{data?'Aucune estimation associée.':'Chargement…'}</p>}
  </div>;
}
