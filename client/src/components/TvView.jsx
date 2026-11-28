import React,{useEffect,useRef,useState} from 'react';
import {Activity,AlertTriangle,ArrowDownRight,ChevronLeft,ChevronRight,Clock3,Expand,Factory,MonitorPlay,Pause,Play,RefreshCw,WifiOff,X} from 'lucide-react';
import {api} from '../api';
import './TvView.css';

const clockFormat=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers',hour:'2-digit',minute:'2-digit',hour12:false});
const dateFormat=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers',weekday:'long',day:'numeric',month:'long',year:'numeric'});
const slotDate=s=>{const [y,m,d]=s.split('-');return `${d}/${m}`};
function MachineCard({machine,index}) {
  const current=machine.running[0],next=machine.queue[0];
  const down=!!machine.enPanne || machine.running.some(x=>x.status==='Panne machine');
  const paused=!down && current?.status==='En pause';
  const status=down?'Panne':paused?'En pause':current?'En production':'En attente';
  const color=down?'danger':paused?'warning':current?'active':'idle';
  const recorded=current?Math.max(0,Number(current.quantity)||0):0,total=current?Math.max(0,Number(current.totalQuantity)||0):0;
  const progress=total>0?Math.min(100,Math.round(recorded/total*100)):0;
  return <article className={`tv-machine tv-machine--${color}`} style={{'--card-index':index}} aria-label={`${machine.nom} · ${status}`}>
    <div className="tv-machine-top"><div className="tv-machine-title"><div className="tv-machine-icon"><Factory size={22}/></div><div className="tv-machine-names"><div className="tv-machine-type">{machine.type||'MACHINE'}</div><h3>{machine.nom}</h3></div></div><span className={`tv-state tv-state--${color}`}><span className="tv-state-dot"/>{status}</span></div>
    {current?<div className="tv-current"><div className="tv-small-label"><span className="tv-label-line"/> TRAVAIL RÉEL · {current.status.toUpperCase()}</div><div className="tv-of-line"><strong>{current.ofId}</strong><span className="tv-of-name">{current.piece}</span></div><div className="tv-operation">{current.operation}</div><div className="tv-current-meta"><span>Opérateur <b>{current.operator}</b></span><span>Qté déclarée <b>{recorded} / {total || '—'}</b></span></div><div className="tv-progress" aria-label={`Quantité déclarée : ${recorded} sur ${total}`}><span style={{width:`${progress}%`}}/></div>{!current.published&&<div className="tv-unpublished">Travail en cours · planning non publié</div>}{machine.running.length>1&&<div className="tv-unpublished">{machine.running.length} opérations actives sur cette machine · à vérifier</div>}</div>:<div className="tv-current tv-current--empty"><div className="tv-small-label"><span className="tv-label-line"/> TRAVAIL RÉEL</div><div className="tv-empty-title">{down?'Machine en panne':'Aucune opération en cours'}</div><div className="tv-empty-description">{down?'Consultez le chef d’atelier pour la reprise.':'La prochaine opération publiée apparaît ci-dessous.'}</div></div>}
    <div className="tv-next"><div className="tv-next-icon"><ArrowDownRight size={18}/></div><div className="tv-next-body"><div className="tv-next-label">À SUIVRE · PLANNING PUBLIÉ</div>{next?<div className="tv-next-text"><strong>{next.ofId}</strong><span>{next.operation}</span></div>:<div className="tv-next-text tv-muted">Aucune étape planifiée</div>}</div>{next&&<div className={`tv-next-date ${next.plannedPast?'tv-next-date--late':''}`}><b>{next.plannedStart}</b><span>{slotDate(next.plannedDate)}{next.plannedPast?' · prévu dépassé':''}</span></div>}</div>
  </article>;
}
export default function TvView() {
  const root=useRef(null);const [board,setBoard]=useState(null),[updatedAt,setUpdatedAt]=useState(0),[failed,setFailed]=useState(false),[now,setNow]=useState(Date.now());
  const [full,setFull]=useState(false),[page,setPage]=useState(0),[playing,setPlaying]=useState(true),[small,setSmall]=useState(()=>window.matchMedia('(max-width: 700px)').matches),[fsError,setFsError]=useState('');
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pageSize=small?2:4, machines=board?.machines||[],pages=Math.max(1,Math.ceil(machines.length/pageSize));
  useEffect(()=>{let alive=true,inflight=false;async function refresh(){if(inflight)return;inflight=true;try{const b=await api('/api/tv/board');if(alive){setBoard(b);setUpdatedAt(Date.now());setFailed(false)}}catch{if(alive)setFailed(true)}finally{inflight=false}}refresh();const timer=setInterval(refresh,5000);return()=>{alive=false;clearInterval(timer)}},[]);
  useEffect(()=>{const tick=setInterval(()=>setNow(Date.now()),1000);const handle=()=>setFull(!!document.fullscreenElement);document.addEventListener('fullscreenchange',handle);return()=>{clearInterval(tick);document.removeEventListener('fullscreenchange',handle)}},[]);
  useEffect(()=>{const narrow=window.matchMedia('(max-width: 700px)'),motion=window.matchMedia('(prefers-reduced-motion: reduce)');const change=()=>{setSmall(narrow.matches);setReduced(motion.matches)};narrow.addEventListener('change',change);motion.addEventListener('change',change);return()=>{narrow.removeEventListener('change',change);motion.removeEventListener('change',change)}},[]);
  useEffect(()=>{setPage(p=>Math.min(p,pages-1))},[pages]);
  useEffect(()=>{if(!playing||reduced||pages<=1)return;const timer=setInterval(()=>setPage(p=>(p+1)%pages),12000);return()=>clearInterval(timer)},[playing,reduced,pages]);
  async function toggleFullscreen(){setFsError('');try{if(!document.fullscreenElement){if(!root.current?.requestFullscreen)throw Error('Le plein écran n’est pas pris en charge par ce navigateur.');await root.current.requestFullscreen()}else await document.exitFullscreen()}catch(e){setFsError(e.message||'Impossible d’ouvrir le plein écran sur cet appareil.')}}
  const live=!!updatedAt&&!failed&&(now-updatedAt)<16000;
  const active=machines.reduce((n,m)=>n+m.running.filter(o=>o.status==='En cours').length,0);
  const down=machines.filter(m=>m.enPanne||m.running.some(o=>o.status==='Panne machine')).length;
  const queued=machines.reduce((n,m)=>n+(m.queueTotal||0),0);
  const shown=machines.slice(page*pageSize,(page+1)*pageSize);
  return <div className="tv-dashboard" ref={root}>
    <div className="tv-aura tv-aura--one"/><div className="tv-aura tv-aura--two"/>
    <div className="tv-shell">
      <header className="tv-header"><div className="tv-brand"><div className="tv-brand-mark"><Activity size={24}/></div><div><div className="tv-eyebrow">PILOTAGE DE PRODUCTION <span> / </span> ATELIER</div><h1>Atelier <span>en direct</span></h1><p>Suivi des machines & opérations</p></div></div>
        <div className="tv-header-right"><div className={`tv-connection ${live?'is-live':'is-offline'}`}><span className="tv-connection-dot"/>{live?'SYNCHRONISÉ':updatedAt?'CONNEXION PERDUE':'CONNEXION…'}</div><div className="tv-clock"><strong>{clockFormat.format(now)}</strong><span>{dateFormat.format(now)}</span></div><button className="tv-icon-button" type="button" onClick={toggleFullscreen} aria-label={full?'Quitter le plein écran':'Plein écran'} title={full?'Quitter le plein écran':'Plein écran'}>{full?<X size={21}/>:<Expand size={21}/>}</button></div>
      </header>
      {(!live && updatedAt>0)&&<div className="tv-network" role="alert"><WifiOff size={18}/> Connexion interrompue : données affichées depuis {clockFormat.format(updatedAt)}. Reconnexion automatique en cours.</div>}
      {fsError&&<div className="tv-network" role="alert">{fsError}</div>}
      <section className="tv-metrics" aria-label="Vue d’ensemble de l’atelier"><div className="tv-metric"><div className="tv-metric-icon tv-metric-icon--cyan"><Factory size={20}/></div><div><span>MACHINES SUIVIES</span><strong>{board?machines.length:'—'}</strong></div></div><div className="tv-metric"><div className="tv-metric-icon tv-metric-icon--green"><Activity size={20}/></div><div><span>OPÉRATIONS EN COURS</span><strong>{board?active:'—'}</strong></div></div><div className="tv-metric"><div className="tv-metric-icon tv-metric-icon--orange"><Clock3 size={20}/></div><div><span>ÉTAPES PLANIFIÉES</span><strong>{board?queued:'—'}</strong></div></div><div className="tv-metric"><div className="tv-metric-icon tv-metric-icon--red"><AlertTriangle size={20}/></div><div><span>MACHINES EN PANNE</span><strong>{board?down:'—'}</strong></div></div></section>
      <div className="tv-section-heading"><div><div className="tv-eyebrow">VUE PAR MACHINE</div><h2>État de production <span className="tv-heading-dash">/</span> <small>maintenant & à suivre</small></h2></div><div className="tv-page-controls"><span className="tv-page-label">{machines.length ? `${page*pageSize+1}–${Math.min((page+1)*pageSize,machines.length)} / ${machines.length}`:'0 machine'}</span>{pages>1&&<><button className="tv-icon-button tv-icon-button--small" aria-label="Page précédente" onClick={()=>setPage(p=>(p-1+pages)%pages)}><ChevronLeft size={18}/></button><button className="tv-icon-button tv-icon-button--small" aria-label={playing?'Mettre le défilement en pause':'Reprendre le défilement'} onClick={()=>setPlaying(p=>!p)}>{playing?<Pause size={15}/>:<Play size={15}/>}</button><button className="tv-icon-button tv-icon-button--small" aria-label="Page suivante" onClick={()=>setPage(p=>(p+1)%pages)}><ChevronRight size={18}/></button></>}</div></div>
      {!board?<div className="tv-board-empty"><RefreshCw size={28}/><strong>{failed?'Impossible de charger les données atelier':'Connexion à l’atelier…'}</strong><span>{failed?'Nouvelle tentative automatique toutes les 5 secondes.':'Préparation du tableau de production.'}</span></div>:!machines.length?<div className="tv-board-empty"><MonitorPlay size={28}/><strong>Aucune machine active</strong><span>Les machines activées apparaîtront ici.</span></div>:<div key={`${page}-${pageSize}`} className="tv-grid">{shown.map((m,i)=><MachineCard key={m.id} machine={m} index={i}/>)}</div>}
      <footer className="tv-footer"><span><span className="tv-footer-dot"/> DONNÉES ATELIER · LECTURE SEULE</span><span>{updatedAt?`Dernière mise à jour ${clockFormat.format(updatedAt)}`:'En attente des données'} · actualisation toutes les 5 s</span><span>ATELIER MANAGER <b> / LIVE BOARD</b></span></footer>
    </div>
  </div>;
}
