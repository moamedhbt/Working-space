// Deterministic planning proposal. Dates are wall-clock minutes in the workshop timezone.
// This module never writes production data; publishing must independently revalidate the snapshot.
const DAY = 1440;
function parseDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Date invalide');
  const ms = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10)!==date) throw new Error('Date invalide');
  return ms / 60000;
}
function parseTime(t) {
  if (!/^\d{2}:\d{2}$/.test(t || '')) throw new Error('Horaire invalide');
  const [h,m]=t.split(':').map(Number);
  if(h>23||m>59) throw new Error('Horaire invalide');
  return h*60+m;
}
function ymd(n) { return new Date(Math.floor(n/DAY)*DAY*60000).toISOString().slice(0,10); }
function hm(n) { n=((n%DAY)+DAY)%DAY; return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
function makeCalendar(settings) {
  const days = settings.workDays;
  if (!Array.isArray(days) || !days.length || days.some(d=>!Number.isInteger(d)||d<0||d>6)) throw new Error('Jours ouvrés invalides');
  const start=parseTime(settings.shiftStart), end=parseTime(settings.shiftEnd);
  if (end<=start) throw new Error('Horaires atelier invalides');
  return { days:new Set(days),start,end };
}
function nextOpening(t, cal) {
  let day=Math.floor(t/DAY)*DAY;
  for(let i=0;i<3700;i++,day+=DAY) {
    if (!cal.days.has(new Date(day*60000).getUTCDay())) continue;
    const point=Math.max(t,day+cal.start);
    if (point<day+cal.end) return point;
  }
  throw new Error('Aucun jour ouvré trouvé');
}
function allocate(t, duration, cal, dailyCapacity) {
  if(!Number.isFinite(duration)||duration<=0||duration>2000000) throw new Error('Durée invalide');
  let cursor=nextOpening(t,cal), remaining=Math.ceil(duration), segments=[];
  const dayLength=Math.min(cal.end-cal.start, Math.max(1,Number(dailyCapacity)||cal.end-cal.start));
  while(remaining>0) {
    if(segments.length>3700) throw new Error('Horizon de planning dépassé');
    let day=Math.floor(cursor/DAY)*DAY;
    const end=day+cal.start+dayLength;
    if(cursor>=end) { cursor=nextOpening(day+DAY,cal); continue; }
    const n=Math.min(remaining,end-cursor);
    segments.push({date:ymd(cursor),start:hm(cursor),end:hm(cursor+n),minutes:n});
    remaining-=n; cursor+=n;
    if(remaining>0) cursor=nextOpening(day+DAY,cal);
  }
  return {segments,end:cursor};
}
function unavailableIntervals(unavailable, machineId, operatorId) {
  return (unavailable||[]).filter(v=>(v.resourceType==='machine'&&v.resourceId===machineId)||(v.resourceType==='operator'&&v.resourceId===operatorId))
    .map(v=>({start:parseDate(v.startDate)+parseTime(v.startTime),end:parseDate(v.endDate)+parseTime(v.endTime)}))
    .sort((a,b)=>a.start-b.start);
}
function allocateAvailable(t,duration,cal,capacity,intervals) {
  let cursor=t;
  for(let i=0;i<5000;i++) {
    const allocation=allocate(cursor,duration,cal,capacity);
    let hit=null;
    for(const s of allocation.segments) {
      const a=parseDate(s.date)+parseTime(s.start),b=parseDate(s.date)+parseTime(s.end);
      hit=intervals.find(x=>a<x.end && x.start<b);
      if(hit)break;
    }
    if(!hit)return allocation;
    cursor=Math.max(cursor+1,hit.end);
  }
  throw new Error('Trop d’indisponibilités pour calculer un créneau');
}
function wallNow(date = new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Algiers',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return parseDate(`${parts.year}-${parts.month}-${parts.day}`)+Number(parts.hour)*60+Number(parts.minute);
}
function createProposal({pieces,machines,users,settings,now=wallNow(),priorityFirst=null,unavailable=[],preservedSegments=null}) {
  const cal=makeCalendar(settings), byMachine=new Map(machines.map(m=>[m.id,m])), byUser=new Map(users.map(u=>[u.id,u]));
  const busy=new Map(), blockers=[], warnings=[], operations=[], blockedPieceIds=new Set(), fatal=[], publishablePieceIds=[];
  const all=pieces.filter(p=>!p.archived&&!['Clôturé','Refusé'].includes(p.statut));
  // Reserve running machines from now until their conservatively estimated end.
  for(const p of all) for(const op of p.operations||[]) if(op.statut==='En cours' && op.machineId) {
    const m=byMachine.get(op.machineId);
    if(!m) { const message=`${p.id} : machine de l'opération en cours introuvable`; blockers.push(message); fatal.push(message); blockedPieceIds.add(p.id); continue; }
    const elapsed=op.startedAt>0?Math.max(0,Math.floor((Date.now()-op.startedAt)/60000)):0;
    const remaining=Math.max(5,(Number(op.tempsPrevuMin)||0)-(Number(op.tempsReelMin)||0)-elapsed);
    const reservation=allocate(now,remaining,cal,m.capaciteJourMin);
    const conflicts=unavailableIntervals(unavailable,m.id,op.operateurId);
    if(reservation.segments.some(s=>conflicts.some(v=>parseDate(s.date)+parseTime(s.start)<v.end && v.start<parseDate(s.date)+parseTime(s.end)))) {
      const message=`${p.id} : opération en cours chevauche une indisponibilité prévue`; blockers.push(message);fatal.push(message);
    }
    if(busy.has(op.machineId)) {const message=`${m.nom} : plusieurs opérations déjà en cours`;blockers.push(message);fatal.push(message);}
    busy.set(op.machineId,Math.max(busy.get(op.machineId)||now,reservation.end));
    operations.push({opId:op.id,pieceId:p.id,machineId:op.machineId,operateurId:op.operateurId,libelle:op.libelle,pieceNom:p.nom,statut:op.statut,segments:reservation.segments,running:true});
    warnings.push(`${p.id} : fin estimée de l'opération en cours, à surveiller`);
  }
  const rank={Critique:0,Urgent:1,Normal:2};
  all.sort((a,b)=>(a.id===priorityFirst?-1:b.id===priorityFirst?1:0)||(rank[a.urgence]??3)-(rank[b.urgence]??3)||(a.delai||'9999').localeCompare(b.delai||'9999')||(a.ordrePlanning||0)-(b.ordrePlanning||0));
  // Preserve complete, valid published OFs before scheduling affected work. A partial
  // OF is never frozen: its precedence might be broken after a disruption.
  const fixedPieces=new Map(), fixedByMachine=new Map();
  if (preservedSegments) {
    for (const p of all) {
      if (!p.planningValide || p.id===priorityFirst || !p.validationDirection || (!p.beValide&&!p.beNonRequis) || !p.chefValide || (!p.chuteDispo&&!p.achatFait)) continue;
      const pending=(p.operations||[]).filter(o=>o.statut!=='Terminée').sort((a,b)=>a.ordre-b.ordre);
      if (!pending.length || pending.some(o=>o.statut!=='En attente'||o.estSousTraitance||(p.stops||[]).some(s=>s.operationId===o.id&&s.statut==='Ouvert'))) continue;
      let prior=now, valid=true; const entries=[], local=[];
      for (const op of pending) {
        const m=byMachine.get(op.machineId), u=byUser.get(op.operateurId), seg=preservedSegments[op.id];
        if(!m?.actif || m.enPanne || !u?.actif || u.role!=='operateur' || (op.machineTypeRequis && op.machineTypeRequis!==m.type) || !Array.isArray(seg) || !seg.length) {valid=false;break;}
        let total=0, previousEnd=0;
        try {
          for(const s of seg) {
            const a=parseDate(s.date)+parseTime(s.start),b=parseDate(s.date)+parseTime(s.end), day=parseDate(s.date);
            if(b<=a || a<prior || a<previousEnd || !cal.days.has(new Date(day*60000).getUTCDay()) || a<day+cal.start || b>day+cal.start+Math.min(cal.end-cal.start,Number(m.capaciteJourMin)||cal.end-cal.start)) {valid=false;break;}
            const collisions=[...unavailableIntervals(unavailable,m.id,u.id),...(fixedByMachine.get(m.id)||[]),...local.filter(x=>x.machineId===m.id)];
            if ((busy.get(m.id)||0)>a || collisions.some(x=>a<x.end&&x.start<b)) {valid=false;break;}
            local.push({machineId:m.id,start:a,end:b}); total+=b-a;previousEnd=b;
          }
        } catch {valid=false;}
        if(!valid || total!==Math.max(5,(Number(op.tempsPrevuMin)||0)-(Number(op.tempsReelMin)||0))) {valid=false;break;}
        prior=previousEnd;
        entries.push({opId:op.id,pieceId:p.id,machineId:m.id,operateurId:u.id,libelle:op.libelle,pieceNom:p.nom,statut:op.statut,segments:seg,running:false,preserved:true});
      }
      if(valid) {
        fixedPieces.set(p.id,entries);
        for(const x of local) {if(!fixedByMachine.has(x.machineId))fixedByMachine.set(x.machineId,[]);fixedByMachine.get(x.machineId).push(x);}
      }
    }
  }
  for(const p of all) {
    if(fixedPieces.has(p.id)) {
      operations.push(...fixedPieces.get(p.id)); publishablePieceIds.push(p.id);
      const last=fixedPieces.get(p.id).at(-1)?.segments.at(-1);
      if(last && p.delai && last.date>p.delai) warnings.push(`${p.id} : fin estimée ${last.date}, délai ${p.delai}`);
      continue;
    }
    const reasons=[];
    if(!p.validationDirection) reasons.push('Direction');
    if(!p.beValide&&!p.beNonRequis) reasons.push('BE');
    if(!p.chefValide) reasons.push('chef');
    if(!p.chuteDispo&&!p.achatFait) reasons.push('matière');
    if(reasons.length) { blockers.push(`${p.id} : ${reasons.join(', ')}`);blockedPieceIds.add(p.id);continue; }
    let prev=now, failed=false;
    const beforeBusy = new Map(busy), beforeOps = operations.length;
    for(const op of [...(p.operations||[])].sort((a,b)=>a.ordre-b.ordre)) {
      if(op.statut==='Terminée') continue;
      if(op.statut==='En cours') { prev=Math.max(prev,busy.get(op.machineId)||now);continue; }
      if(op.statut==='Panne machine'||(p.stops||[]).some(s=>s.operationId===op.id&&s.statut==='Ouvert')) {
        blockers.push(`${p.id} · ${op.libelle} : arrêt non résolu`); failed=true;break;
      }
      if(op.estSousTraitance) {
        if(!op.dateEnvoi||!op.dateRetourPrevue) { blockers.push(`${p.id} · ${op.libelle} : dates de sous-traitance manquantes`); failed=true;break; }
        try {
          const send=parseDate(op.dateEnvoi)+cal.start, ret=parseDate(op.dateRetourPrevue)+cal.end;
          if(ret<send||send<prev) { blockers.push(`${p.id} · ${op.libelle} : dates sous-traitance incompatibles avec la gamme`);failed=true;break; }
          prev=ret;
        } catch { blockers.push(`${p.id} · ${op.libelle} : dates sous-traitance invalides`);failed=true;break; }
        continue;
      }
      const u=byUser.get(op.operateurId);
      const candidates=op.machineTypeRequis && op.statut === 'En attente'
        ? machines.filter(m=>m.actif&&!m.enPanne&&m.type===op.machineTypeRequis)
        : [byMachine.get(op.machineId)].filter(m=>m&&m.actif&&!m.enPanne);
      if(!candidates.length||!u||!u.actif||u.role!=='operateur') { blockers.push(`${p.id} · ${op.libelle} : aucune machine disponible du type demandé ou opérateur actif manquant`);failed=true;break; }
      const duration=Math.max(5,(Number(op.tempsPrevuMin)||0)-(Number(op.tempsReelMin)||0));
      const options=candidates.map(m=>({m,slot:allocateAvailable(Math.max(prev,busy.get(m.id)||now),duration,cal,m.capaciteJourMin,[...unavailableIntervals(unavailable,m.id,u.id),...(fixedByMachine.get(m.id)||[])])}));
      options.sort((a,b)=>a.slot.end-b.slot.end || (a.m.id===op.machineId?-1:b.m.id===op.machineId?1:0) || String(a.m.id).localeCompare(String(b.m.id)));
      const {m,slot}=options[0];
      if(op.machineTypeRequis) warnings.push(`${p.id} · ${op.libelle} : ${m.nom} choisie selon le type ${op.machineTypeRequis} et la fin la plus tôt ; capacités et outillage à vérifier.`);
      operations.push({opId:op.id,pieceId:p.id,machineId:m.id,operateurId:u.id,libelle:op.libelle,pieceNom:p.nom,statut:op.statut,segments:slot.segments,running:false});
      prev=slot.end; busy.set(m.id,slot.end);
    }
    if (failed) { blockedPieceIds.add(p.id); busy.clear(); for(const [k,v] of beforeBusy) busy.set(k,v); operations.splice(beforeOps); }
    if(!failed && (p.operations||[]).some(o=>o.statut!=='Terminée')) publishablePieceIds.push(p.id);
    if(!failed && p.delai && ymd(prev)>p.delai) warnings.push(`${p.id} : fin estimée ${ymd(prev)}, délai ${p.delai}`);
  }
  return {operations,blockers,warnings,preservedPieceIds:[...fixedPieces.keys()],blockedPieceIds:[...blockedPieceIds],publishablePieceIds,fatal,generatedAt:new Date().toISOString()};
}
module.exports={parseDate,parseTime,allocate,makeCalendar,wallNow,createProposal};

// Move a single ready-to-start operation into an existing free same-day gap.
// No other operation is moved and the machine assignment is never changed.
function findEarlierGap({proposal, piece, operationId, machines, settings, unavailable=[], now=wallNow()}) {
  const ops=[...(piece.operations||[])].sort((a,b)=>a.ordre-b.ordre);
  const index=ops.findIndex(o=>o.id===operationId), op=ops[index];
  if(!op || op.statut!=='En attente' || op.estSousTraitance) return {error:'Seule une opération interne en attente peut être placée dans un créneau libre.'};
  if((piece.stops||[]).some(s=>s.operationId===op.id&&s.statut==='Ouvert')) return {error:'Cette opération a un blocage non résolu.'};
  const target=proposal.operations.find(x=>x.opId===op.id && !x.running);
  const machine=machines.find(m=>m.id===target?.machineId&&m.actif&&!m.enPanne);
  if(!target||!machine) return {error:'Opération non planifiable ou machine indisponible.'};
  const cal=makeCalendar(settings);
  let earliest=now;
  for (const prev of ops.slice(0,index)) {
    if(prev.statut==='Terminée') continue;
    if(prev.estSousTraitance && prev.dateRetourPrevue) {
      try { earliest=Math.max(earliest,parseDate(prev.dateRetourPrevue)+cal.end); }
      catch { return {error:'Date de retour de sous-traitance invalide.'}; }
    } else {
      const scheduled=proposal.operations.find(x=>x.opId===prev.id);
      if(!scheduled?.segments?.length) return {error:'Opération précédente non planifiée : impossible de garantir la gamme.'};
      const last=scheduled.segments[scheduled.segments.length-1];
      earliest=Math.max(earliest,parseDate(last.date)+parseTime(last.end));
    }
  }
  const duration=target.segments.reduce((n,s)=>n+s.minutes,0);
  const original=parseDate(target.segments[0].date)+parseTime(target.segments[0].start);
  const lastOriginal=target.segments[target.segments.length-1];
  const originalEnd=parseDate(lastOriginal.date)+parseTime(lastOriginal.end);
  const intervals=proposal.operations.filter(x=>x.opId!==op.id&&x.machineId===machine.id).flatMap(x=>x.segments.map(s=>({start:parseDate(s.date)+parseTime(s.start),end:parseDate(s.date)+parseTime(s.end)}))).sort((a,b)=>a.start-b.start);
  let cursor=earliest;
  for(let i=0;i<5000 && cursor<original;i++) {
    const candidate=allocateAvailable(cursor,duration,cal,machine.capaciteJourMin,unavailableIntervals(unavailable,machine.id,op.operateurId));
    const first=candidate.segments[0], firstStart=parseDate(first.date)+parseTime(first.start);
    if(firstStart>=original || candidate.end>originalEnd) break;
    let collision=null;
    for (const segment of candidate.segments) {
      const a=parseDate(segment.date)+parseTime(segment.start), b=parseDate(segment.date)+parseTime(segment.end);
      collision=intervals.find(interval=>a<interval.end&&interval.start<b);
      if(collision) break;
    }
    if(!collision) return {segments:candidate.segments,oldSegments:target.segments};
    cursor=Math.max(cursor+1,collision.end);
  }
  return {error:'Aucun créneau plus tôt trouvé sans déplacer d’autres opérations.'};
}
module.exports.findEarlierGap=findEarlierGap;
module.exports.allocateAvailable=allocateAvailable;

// A manual proposal moves one waiting operation only. Nothing is persisted here.
function moveOperation({proposal,piece,operationId,machines,settings,unavailable=[],startDate,startTime,now=wallNow()}) {
  let requested; try {requested=parseDate(startDate)+parseTime(startTime)} catch {return {error:'Date ou heure invalide.'};}
  if(requested<now) return {error:'Le début demandé est dans le passé.'};
  const ops=[...(piece.operations||[])].sort((a,b)=>a.ordre-b.ordre);
  const index=ops.findIndex(o=>o.id===operationId), op=ops[index];
  if(!op || op.statut!=='En attente' || op.estSousTraitance || (piece.stops||[]).some(s=>s.operationId===op.id&&s.statut==='Ouvert')) return {error:'Seule une opération interne en attente et sans arrêt peut être déplacée.'};
  const target=proposal.operations.find(o=>o.opId===operationId&&!o.running);
  const machine=machines.find(m=>m.id===target?.machineId&&m.actif&&!m.enPanne);
  if(!target||!machine||!target.segments?.length)return {error:'Opération non planifiable dans le brouillon.'};
  const cal=makeCalendar(settings);
  let earliest=now, latest=Infinity;
  for(let i=0;i<ops.length;i++) {
    if(i===index || ops[i].statut==='Terminée') continue;
    const other=ops[i]; let start,end;
    if(other.estSousTraitance) {
      try {start=parseDate(other.dateEnvoi)+cal.start;end=parseDate(other.dateRetourPrevue)+cal.end;} catch {return {error:'Dates de sous-traitance invalides.'};}
    } else {
      const scheduled=proposal.operations.find(x=>x.opId===other.id);
      if(!scheduled?.segments?.length)return {error:'Les autres étapes doivent être planifiées pour respecter la gamme.'};
      const first=scheduled.segments[0], last=scheduled.segments.at(-1);
      start=parseDate(first.date)+parseTime(first.start);end=parseDate(last.date)+parseTime(last.end);
    }
    if(i<index)earliest=Math.max(earliest,end);else latest=Math.min(latest,start);
  }
  const duration=target.segments.reduce((sum,s)=>sum+(parseTime(s.end)-parseTime(s.start)),0);
  const candidate=allocateAvailable(requested,duration,cal,machine.capaciteJourMin,unavailableIntervals(unavailable,machine.id,target.operateurId || op.operateurId));
  const first=candidate.segments[0], actual=parseDate(first.date)+parseTime(first.start);
  if(actual!==requested) return {error:'Le début demandé est hors horaires ouvrés ou indisponible.'};
  if(actual<earliest || candidate.end>latest) return {error:'Ce déplacement ne respecte pas l’ordre des opérations.'};
  const occupied=proposal.operations.filter(x=>x.opId!==op.id&&x.machineId===machine.id).flatMap(x=>x.segments.map(s=>({start:parseDate(s.date)+parseTime(s.start),end:parseDate(s.date)+parseTime(s.end)})));
  if(candidate.segments.some(s=>{const a=parseDate(s.date)+parseTime(s.start),b=parseDate(s.date)+parseTime(s.end);return occupied.some(x=>a<x.end&&x.start<b)})) return {error:'Machine déjà occupée sur ce créneau : choisissez un autre horaire.'};
  return {segments:candidate.segments};
}
module.exports.moveOperation=moveOperation;
