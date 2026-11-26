// Deterministic atelier scenarios: independently verify schedule invariants.
const assert=require('assert');
const {createProposal,parseDate,parseTime}=require('../src/services/workshopPlanner');
const settings={workDays:[0,1,2,3,4],shiftStart:'08:00',shiftEnd:'17:00'};
const now=parseDate('2026-11-22')+8*60;
let seed=20261122; function rand(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;}
const machines=Array.from({length:5},(_,i)=>({id:`m${i}`,nom:`Machine ${i}`,type:i<3?'Tour CNC':'Fraiseuse CNC',actif:1,enPanne:0,capaciteJourMin:540}));
const users=Array.from({length:3},(_,i)=>({id:`u${i}`,role:'operateur',actif:1}));
const instant=(date,time)=>parseDate(date)+parseTime(time);
function validate(plan,pieces,unavailable){
 const slots=[];
 for(const p of pieces){
  let previous=now;
  for(const op of p.operations){
   const actual=plan.operations.find(o=>o.opId===op.id);assert(actual,`Missing ${op.id}`);
   const machine=machines.find(m=>m.id===actual.machineId);assert(machine&&machine.type===op.machineTypeRequis);
   assert.equal(actual.segments.reduce((sum,s)=>sum+instant(s.date,s.end)-instant(s.date,s.start),0),op.tempsPrevuMin);
   for(const segment of actual.segments){
    const a=instant(segment.date,segment.start), b=instant(segment.date,segment.end);
    assert(a>=previous && b>a);assert(settings.workDays.includes(new Date(segment.date+'T00:00:00Z').getUTCDay()));
    assert(segment.start>=settings.shiftStart && segment.end<=settings.shiftEnd);
    for(const absence of unavailable)if((absence.resourceType==='machine'&&absence.resourceId===actual.machineId)||(absence.resourceType==='operator'&&absence.resourceId===op.operateurId))assert(!(a<instant(absence.endDate,absence.endTime)&&instant(absence.startDate,absence.startTime)<b));
    slots.push({machine:actual.machineId,a,b,id:op.id});previous=b;
   }
  }
 }
 for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++)if(slots[i].machine===slots[j].machine)assert(!(slots[i].a<slots[j].b&&slots[j].a<slots[i].b),`${slots[i].id} overlaps ${slots[j].id}`);
}
for(let iteration=0;iteration<40;iteration++){
 const unavailable=[{resourceType:'machine',resourceId:'m0',startDate:'2026-11-22',startTime:'08:00',endDate:'2026-11-23',endTime:'12:00'},{resourceType:'operator',resourceId:'u2',startDate:'2026-11-24',startTime:'08:00',endDate:'2026-11-24',endTime:'17:00'}];
 const pieces=Array.from({length:15},(_,i)=>({id:`p${i}`,nom:`Pièce ${i}`,validationDirection:1,beValide:1,chefValide:1,chuteDispo:1,urgence:['Normal','Urgent','Critique'][rand(3)],delai:i%3?'2026-12-02':'2026-11-23',stops:[],operations:Array.from({length:1+rand(3)},(_,j)=>{const type=rand(2)?'Tour CNC':'Fraiseuse CNC';return {id:`p${i}o${j}`,libelle:'Usinage',ordre:10+j,machineTypeRequis:type,machineId:type==='Tour CNC'?'m0':'m3',operateurId:`u${rand(3)}`,tempsPrevuMin:30+rand(1300),tempsReelMin:0,statut:'En attente'};})}));
 const plan=createProposal({pieces,machines,users,settings,now,unavailable});assert.equal(plan.blockers.length,0);validate(plan,pieces,unavailable);
 assert(plan.warnings.some(w=>w.includes('délai')), 'Expected explicit deadline warnings');
}
console.log('✅ 40 scénarios atelier : types, 15 OF, gammes, délais, absences et absence de collisions');
// Build a published plan, then simulate a machine breakdown and an operator absence.
// Frozen OFs retain their exact slots; moved ones remain collision-free and ordered.
for(let iteration=0;iteration<20;iteration++) {
 const pieces=Array.from({length:10},(_,i)=>({id:`s${i}`,nom:`Série ${i}`,validationDirection:1,beValide:1,chefValide:1,chuteDispo:1,planningValide:1,urgence:'Normal',delai:'2026-12-05',stops:[],operations:Array.from({length:2},(_,j)=>({id:`s${i}o${j}`,libelle:'Usinage',ordre:j*10,machineTypeRequis:j?'Fraiseuse CNC':'Tour CNC',machineId:j?'m3':'m0',operateurId:`u${i%3}`,tempsPrevuMin:60+rand(900),tempsReelMin:0,statut:'En attente'}))}));
 const initial=createProposal({pieces,machines,users,settings,now});assert.equal(initial.blockers.length,0);
 const published={};for(const item of initial.operations){published[item.opId]=item.segments;pieces.find(p=>p.id===item.pieceId).operations.find(o=>o.id===item.opId).machineId=item.machineId;}
 const altered=machines.map(m=>m.id==='m0'?{...m,enPanne:1}:m);
 const unavailable=[{resourceType:'operator',resourceId:'u2',startDate:'2026-11-23',startTime:'08:00',endDate:'2026-11-24',endTime:'17:00'}];
 const after=createProposal({pieces,machines:altered,users,settings,now,unavailable,preservedSegments:published});
 assert.equal(after.blockers.length,0);validate(after,pieces,unavailable);
 assert(after.operations.every(o=>o.machineId!=='m0'));
 for(const id of after.preservedPieceIds)for(const op of pieces.find(p=>p.id===id).operations)assert.deepEqual(after.operations.find(o=>o.opId===op.id).segments,published[op.id]);
}
console.log('✅ 20 scénarios de panne et absence : réservations préservées et recalcul cohérent');
