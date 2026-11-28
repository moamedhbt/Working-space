import React, {useEffect,useState} from 'react';
import {Scale} from 'lucide-react';
import {api} from '../api';

function ShapeGuide({shape}) {
  if (!shape) return <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-400">Choisissez une forme pour voir son schéma et les dimensions à saisir.</div>;
  const name={rond:'Barre ronde',plat:'Plat rectangulaire',tube:'Tube creux'}[shape];
  return <div className="rounded-xl border border-cyan-800/50 bg-[#09141c] p-3 flex flex-col sm:flex-row items-center gap-3" aria-label={`Schéma ${name}`}>
    <svg viewBox="0 0 260 120" role="img" aria-label={`Schéma indicatif ${name}`} className="w-full max-w-[260px] h-28">
      <defs><linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#164e63"/><stop offset="0.5" stopColor="#22d3ee"/><stop offset="1" stopColor="#164e63"/></linearGradient></defs>
      {shape==='plat'?<><path d="M35 39 L170 39 L216 58 L81 58 Z" fill="#164e63" stroke="#67e8f9"/><path d="M81 58 L216 58 L216 81 L81 81 Z" fill="url(#steel)" stroke="#67e8f9"/><path d="M35 39 L81 58 L81 81 L35 62 Z" fill="#0e7490" stroke="#67e8f9"/><text x="205" y="100" fill="#cbd5e1" fontSize="10">épaisseur</text><text x="23" y="87" fill="#cbd5e1" fontSize="10">largeur</text></>:<><path d="M58 33 H192 V87 H58 Z" fill="url(#steel)" stroke="#67e8f9"/><ellipse cx="192" cy="60" rx="16" ry="27" fill="#0e7490" stroke="#67e8f9"/><ellipse cx="58" cy="60" rx="16" ry="27" fill="#155e75" stroke="#67e8f9"/>{shape==='tube'&&<ellipse cx="58" cy="60" rx="8" ry="14" fill="#09141c" stroke="#a5f3fc"/>}<text x="9" y="105" fill="#cbd5e1" fontSize="10">{shape==='tube'?'Ø ext. / Ø int.':'Ø extérieur'}</text></>}
      <path d="M75 108 H192 M75 104 V112 M192 104 V112" stroke="#94a3b8"/><text x="112" y="119" fill="#cbd5e1" fontSize="10">longueur</text>
    </svg><div className="text-xs text-slate-300"><strong className="text-white text-sm">{name}</strong><p className="mt-1">Schéma indicatif, non à l’échelle. Renseignez les dimensions du brut en millimètres.</p></div>
  </div>;
}
const blank=quantity=>({shape:'',materialId:'',quantity:String(quantity||''),lengthMm:'',lossMm:'3',diameterMm:'',innerDiameterMm:'',widthMm:'',heightMm:''});
export default function MaterialCalculator({state,reload,showToast,materialRequest,ask,onSaved,allowAssociation=true}) {
  const [ofId,setOfId]=useState(''),[form,setForm]=useState(()=>blank(''));
  const [materials,setMaterials]=useState([]),[estimate,setEstimate]=useState(null),[saved,setSaved]=useState(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const openPieces=(state?.pieces||[]).filter(p=>!p.archived&&!['Clôturé','Refusé'].includes(p.statut));
  const selected=openPieces.find(p=>p.id===ofId);
  useEffect(()=>{let active=true;api('/api/material/catalog').then(r=>{if(active)setMaterials(r.materials)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[]);
  useEffect(()=>{let active=true;setSaved(null);if(ofId)api(`/api/pieces/${ofId}/material-estimate`).then(r=>{if(active)setSaved(r)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[ofId]);
  function selectOf(id){setOfId(id);const p=openPieces.find(x=>x.id===id);setForm(blank(p?.quantitePrevue));setEstimate(null);setError('');}
  useEffect(()=>{if(materialRequest?.id)selectOf(materialRequest.id)},[materialRequest]);
  function change(field,value){setForm(f=>({...f,[field]:value}));setEstimate(null);setError('');}
  function inputs(){const n=key=>form[key]===''?null:Number(form[key]);return {shape:form.shape,materialId:form.materialId,quantity:n('quantity'),lengthMm:n('lengthMm'),lossMm:n('lossMm'),...(form.shape==='plat'?{widthMm:n('widthMm'),heightMm:n('heightMm')}:{diameterMm:n('diameterMm'),...(form.shape==='tube'?{innerDiameterMm:n('innerDiameterMm')}:{})})};}
  async function calculate(e){e.preventDefault();setLoading(true);setError('');try{setEstimate(await api('/api/material/estimate','POST',inputs()))}catch(err){setEstimate(null);setError(err.message)}finally{setLoading(false)}}
  async function save(){
    if(!selected||!estimate)return;
    const different=estimate.inputs.quantity!==selected.quantitePrevue;
    const msg=`Enregistrer cette estimation dans ${selected.id} ?${different?` Attention : quantité calculée ${estimate.inputs.quantity}, quantité de l’OF ${selected.quantitePrevue}.`:''}\nLe stock, les achats et le planning ne seront pas modifiés.`;
    if(!await ask(msg,{title:'Associer à l’OF',confirmLabel:'Associer'}))return;
    setLoading(true);setError('');try{const r=await api(`/api/pieces/${ofId}/material-estimate`,'PUT',estimate.inputs);setSaved(r);onSaved?.();showToast('Estimation associée à l’OF. Aucun stock n’a été réservé.');await reload()}catch(err){setError(err.message)}finally{setLoading(false)}
  }
  function loadSaved(){const inputs=saved?.estimate?.inputs;if(!inputs)return;setForm({...blank(inputs.quantity),...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,String(v)]))});setEstimate(saved.estimate);setError('');}
  const inputClass='w-full mt-1 p-2 rounded bg-[#0B0F14] border border-slate-700 text-white';
  const field=(label,key,props={})=><label className="block text-xs text-slate-300">{label}<input aria-label={label} type="number" required min={props.min??0} step={props.step??'any'} value={form[key]} onChange={e=>change(key,e.target.value)} className={inputClass}/></label>;
  return <section className="cyber-card p-4 space-y-4">
    <div><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Scale size={16} className="text-cyan-300"/> Estimation matière première</h2><p className="text-xs text-slate-400 mt-1">Estimez le poids du brut et la longueur à prévoir. Les résultats sont indicatifs : aucune réservation de stock ni commande.</p></div>
    {allowAssociation&&<label className="block text-xs text-slate-300">OF associé (facultatif)<select aria-label="OF associé" value={ofId} onChange={e=>selectOf(e.target.value)} className={inputClass}><option value="">Calcul libre, sans OF</option>{openPieces.map(p=><option key={p.id} value={p.id}>{p.id} · {p.nom}</option>)}</select></label>}
    {selected&&<div className="rounded border border-slate-700 p-3 text-xs text-slate-300"><strong>{selected.id} · {selected.nom}</strong><p className="mt-1">Quantité OF : {selected.quantitePrevue} · Matière renseignée : {selected.matiere||'Non renseignée'}</p><p className="text-slate-400 mt-1">Seule la quantité est reprise. Choisissez la matière et saisissez les dimensions réelles du brut.</p>{saved?.estimate&&<button type="button" onClick={loadSaved} className="text-cyan-300 underline mt-2">Charger l’estimation enregistrée{saved.updatedBy?` · ${saved.updatedBy}`:''}</button>}</div>}
    {saved?.estimate&&selected&&<div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">✓ Estimation enregistrée dans {selected.id}. Retrouvez son résumé sur la fiche OF. Aucun stock réservé, aucune matière ni commande modifiée.</div>}
    <form onSubmit={calculate} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs text-slate-300">Forme du brut<select required aria-label="Forme du brut" value={form.shape} onChange={e=>change('shape',e.target.value)} className={inputClass}><option value="">Choisir une forme</option><option value="rond">Rond (barre)</option><option value="plat">Plat rectangulaire</option><option value="tube">Tube creux</option></select></label>
        <label className="block text-xs text-slate-300">Matière et densité<select required aria-label="Matière et densité" value={form.materialId} onChange={e=>change('materialId',e.target.value)} className={inputClass}><option value="">Choisir une matière</option>{materials.map(m=><option key={m.id} value={m.id}>{m.name} · {m.density} g/cm³</option>)}</select></label>
        {field('Quantité (pièces)','quantity',{min:1,step:1})}{field('Longueur du brut par pièce (mm)','lengthMm',{min:0.001})}
        {(form.shape==='rond'||form.shape==='tube')&&field('Diamètre extérieur (mm)','diameterMm',{min:0.001})}
        {form.shape==='tube'&&field('Diamètre intérieur (mm)','innerDiameterMm')}
        {form.shape==='plat'&&<>{field('Largeur (mm)','widthMm',{min:0.001})}{field('Épaisseur (mm)','heightMm',{min:0.001})}</>}
        {field('Perte de coupe par pièce (mm)','lossMm')}
      </div>
      <ShapeGuide shape={form.shape}/>
      <p className="text-[11px] text-slate-500">La perte est ajoutée une fois par pièce à la longueur. Les poids indiqués excluent cette perte ; les densités sont approximatives. Le poids acheté peut donc être supérieur.</p>
      <button disabled={loading} className="px-4 py-2 rounded bg-cyan-400 text-slate-950 text-xs font-semibold disabled:opacity-50">Calculer l’estimation</button>
    </form>
    {error&&<div role="alert" className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{error}</div>}
    {estimate&&<div className="space-y-3"><div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs"><div className="p-3 rounded bg-slate-950 border border-slate-800">Poids théorique / pièce<br/><strong className="text-white text-sm">{estimate.unitKg.toFixed(2)} kg</strong></div><div className="p-3 rounded bg-slate-950 border border-slate-800">Poids théorique total<br/><strong className="text-emerald-300 text-sm">{estimate.totalKg.toFixed(2)} kg</strong></div><div className="p-3 rounded bg-slate-950 border border-slate-800">Longueur totale avec pertes<br/><strong className="text-cyan-300 text-sm">{estimate.totalLengthM.toFixed(3)} m</strong></div></div><p className="text-[11px] text-slate-400">Somme théorique des longueurs, sans optimisation des barres, chutes ou stock disponible.</p>{selected&&estimate.inputs.quantity!==selected.quantitePrevue&&<p className="text-xs text-amber-300">Attention : calcul pour {estimate.inputs.quantity} pièces, OF prévu pour {selected.quantitePrevue}.</p>}{selected&&<button type="button" disabled={loading} onClick={save} className="px-4 py-2 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50">Associer cette estimation à l’OF</button>}</div>}
  </section>;
}
