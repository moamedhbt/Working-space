const assert = require('assert');
const {createProposal, allocate, makeCalendar, parseDate} = require('../src/services/workshopPlanner');
const settings = {workDays:[0,1,2,3,4],shiftStart:'08:00',shiftEnd:'17:00'};
const now = parseDate('2026-11-22') + 8*60;
const users=[{id:'u',nom:'Ali',role:'operateur',actif:1}];
const machines=[{id:'a',nom:'Tour',actif:1,enPanne:0,capaciteJourMin:540},{id:'b',nom:'Fraiseuse',actif:1,enPanne:0,capaciteJourMin:540}];
const op=(id,m,d,ordre=10)=>({id,machineId:m,operateurId:'u',libelle:id,tempsPrevuMin:d,tempsReelMin:0,statut:'En attente',ordre});
const piece=(id,ops)=>({id,nom:id,validationDirection:true,beValide:true,chefValide:true,chuteDispo:true,urgence:'Normal',operations:ops,stops:[]});
const long=allocate(now,540*40,makeCalendar(settings),540).segments;
assert.strictEqual(long.length,40); assert.strictEqual(long[5].date,'2026-11-29');
assert.strictEqual(long.at(-1).date,'2027-01-14');
const result=createProposal({pieces:[piece('p1',[op('a1','a',600),op('b1','b',60,20)]),piece('p2',[op('a2','a',60)]),piece('p3',[op('b2','b',60)])],machines,users,settings,now});
const get=id=>result.operations.find(o=>o.opId===id);
assert.strictEqual(get('a1').segments.length,2);
assert.strictEqual(get('b1').segments[0].date,'2026-11-23');
assert.strictEqual(get('b1').segments[0].start,'09:00');
assert.strictEqual(get('a2').segments[0].start,'09:00');
assert.strictEqual(get('b2').segments[0].start,'10:00'); // no overlap on machine B
assert.equal(result.blockers.length,0);
const blocked=createProposal({pieces:[{...piece('p',[op('o','a',60)]),beValide:false}],machines,users,settings,now});
assert.equal(blocked.operations.length,0); assert.equal(blocked.blockers.length,1);
const failed=createProposal({pieces:[piece('p',[op('ok','a',60),op('bad','missing',60,20)]),piece('q',[op('q1','a',60)])],machines,users,settings,now});
assert(!failed.operations.some(x=>x.pieceId==='p'));assert.equal(failed.operations.find(x=>x.opId==='q1').segments[0].start,'08:00');
const outsourced=piece('s',[op('first','a',60),{id:'sub',ordre:20,estSousTraitance:true,statut:'En attente',libelle:'Traitement',dateEnvoi:'2026-11-22',dateRetourPrevue:'2026-11-24'},op('last','a',60,30)]);
assert(createProposal({pieces:[outsourced],machines,users,settings,now}).blockers.length); // send date precedes first operation
const par=createProposal({pieces:[piece('x',[op('x','a',60)]),piece('y',[op('y','b',60)])],machines,users,settings,now});
assert.equal(par.operations[0].segments[0].start,par.operations[1].segments[0].start); // same operator on two machines allowed
console.log('✅ Tests du moteur de proposition atelier réussis');
const {findEarlierGap}=require('../src/services/workshopPlanner');
const gapPiece=piece('gap',[op('gap-op','b',30)]);
const gp={operations:[{opId:'other',machineId:'b',segments:[{date:'2026-11-22',start:'08:30',end:'09:00',minutes:30}]},{opId:'gap-op',machineId:'b',segments:[{date:'2026-11-22',start:'10:00',end:'10:30',minutes:30}]}]};
const gap=findEarlierGap({proposal:gp,piece:gapPiece,operationId:'gap-op',machines,settings,now});
assert.deepEqual(gap.segments,[{date:'2026-11-22',start:'08:00',end:'08:30',minutes:30}]);
gapPiece.operations.unshift({...op('prev','a',20,5),statut:'En attente'});
assert(findEarlierGap({proposal:gp,piece:gapPiece,operationId:'gap-op',machines,settings,now}).error);
console.log('✅ Recherche de créneau libre testée');
// A later operation may move into a gap, but never before its planned predecessor.
const dependent=piece('dep',[op('prev2','a',30,10),op('next2','b',30,20)]);
const depProposal={operations:[{opId:'prev2',machineId:'a',segments:[{date:'2026-11-22',start:'09:00',end:'09:30',minutes:30}]},{opId:'next2',machineId:'b',segments:[{date:'2026-11-22',start:'11:00',end:'11:30',minutes:30}]}]};
const depGap=findEarlierGap({proposal:depProposal,piece:dependent,operationId:'next2',machines,settings,now});
assert.equal(depGap.segments[0].start,'09:30');
// Multi-day work respects weekends and existing occupancy.
const multi=piece('multi',[op('multi-op','a',600)]);
const multiPlan={operations:[{opId:'multi-op',machineId:'a',segments:[{date:'2026-11-24',start:'08:00',end:'17:00',minutes:540},{date:'2026-11-25',start:'08:00',end:'09:00',minutes:60}]},{opId:'busy',machineId:'a',segments:[{date:'2026-11-22',start:'08:00',end:'09:00',minutes:60}]}]};
const mg=findEarlierGap({proposal:multiPlan,piece:multi,operationId:'multi-op',machines,settings,now});
assert.equal(mg.segments[0].start,'09:00'); assert.equal(mg.segments.length,2);
console.log('✅ Créneaux multi-jours et précédence vérifiés');
// Calendar unavailability is a hard constraint for the resource, not for every machine an operator runs.
const unav=[{resourceType:'machine',resourceId:'a',startDate:'2026-11-22',startTime:'08:00',endDate:'2026-11-22',endTime:'10:00'}, {resourceType:'operator',resourceId:'u',startDate:'2026-11-22',startTime:'10:30',endDate:'2026-11-22',endTime:'11:30'}];
const availability=createProposal({pieces:[piece('z',[op('z','a',60)])],machines,users,settings,now,unavailable:unav});
assert.equal(availability.operations[0].segments[0].start,'11:30');
console.log('✅ Maintenance et absence vérifiées');
// Automatic type assignment is opt-in and selects the earliest finishing matching machine.
const typedMachines=[{...machines[0],type:'CNC'}, {...machines[1],type:'CNC'}, {id:'c',nom:'Autre',type:'AUTRE',actif:1,enPanne:0,capaciteJourMin:540}];
const occupied=piece('occupied',[op('busy-a','a',240)]);
const typedOp={...op('auto','a',60),machineTypeRequis:'CNC'};
const autoPlan=createProposal({pieces:[occupied,piece('auto-p',[typedOp])],machines:typedMachines,users,settings,now});
assert.equal(autoPlan.operations.find(x=>x.opId==='auto').machineId,'b');
assert.equal(autoPlan.operations.find(x=>x.opId==='auto').segments[0].start,'08:00');
const broken=createProposal({pieces:[piece('auto-p',[typedOp])],machines:typedMachines.map(m=>m.id==='a'?{...m,enPanne:1}:m),users,settings,now});
assert.equal(broken.operations[0].machineId,'b');
const noType=createProposal({pieces:[piece('auto-p',[{...typedOp,machineTypeRequis:'INCONNU'}])],machines:typedMachines,users,settings,now});
assert.equal(noType.operations.length,0);assert(noType.blockedPieceIds.includes('auto-p'));
const locked=createProposal({pieces:[occupied,piece('auto-p',[op('fixed','a',60)])],machines:typedMachines,users,settings,now});
assert.equal(locked.operations.find(x=>x.opId==='fixed').machineId,'a');
console.log('✅ Choix par type, panne et machine imposée vérifiés');
// A disruption preserves unaffected published OFs, reallocates only invalidated OFs,
// and never overlaps their reserved intervals.
const keepPiece={...piece('keep',[op('keep-op','a',60)]),planningValide:true,delai:'2026-11-22'};
const movePiece={...piece('move',[op('move-op','b',60)]),planningValide:true,delai:'2026-11-22'};
const fixedSlots={'keep-op':[{date:'2026-11-22',start:'09:00',end:'10:00',minutes:60}],'move-op':[{date:'2026-11-22',start:'09:00',end:'10:00',minutes:60}]};
const adapted=createProposal({pieces:[keepPiece,movePiece],machines,users,settings,now,preservedSegments:fixedSlots,unavailable:[{resourceType:'machine',resourceId:'b',startDate:'2026-11-22',startTime:'08:00',endDate:'2026-11-22',endTime:'11:00'}]});
assert.deepEqual(adapted.preservedPieceIds,['keep']);
assert.equal(adapted.operations.find(o=>o.opId==='keep-op').segments[0].start,'09:00');
assert.equal(adapted.operations.find(o=>o.opId==='move-op').segments[0].start,'11:00');
// An urgent job on the same machine must not overlap the preserved OF.
const urgent=piece('urgent',[op('urgent-op','a',90)]);urgent.urgence='Critique';
const urgentPlan=createProposal({pieces:[keepPiece,urgent],machines,users,settings,now,preservedSegments:fixedSlots,priorityFirst:'urgent'});
assert.equal(urgentPlan.operations.find(o=>o.opId==='urgent-op').segments[0].start,'10:00');
assert.equal(urgentPlan.operations.find(o=>o.opId==='keep-op').segments[0].start,'09:00');
console.log('✅ Adaptation conservatrice et réservations vérifiées');
const {moveOperation}=require('../src/services/workshopPlanner');
const manualPiece=piece('manual',[op('ma','a',30,10),op('mb','a',30,20)]);
const manualPlan={operations:[{opId:'ma',machineId:'a',segments:[{date:'2026-11-22',start:'08:00',end:'08:30',minutes:30}]},{opId:'mb',machineId:'a',segments:[{date:'2026-11-22',start:'09:00',end:'09:30',minutes:30}]}]};
const moved=moveOperation({proposal:manualPlan,piece:manualPiece,operationId:'mb',machines,settings,now,startDate:'2026-11-22',startTime:'10:00'});
assert.equal(moved.segments[0].start,'10:00');
assert(moveOperation({proposal:manualPlan,piece:manualPiece,operationId:'mb',machines,settings,now,startDate:'2026-11-22',startTime:'08:15'}).error);
assert(moveOperation({proposal:manualPlan,piece:manualPiece,operationId:'ma',machines,settings,now,startDate:'2026-11-22',startTime:'09:00'}).error);
assert(moveOperation({proposal:manualPlan,piece:manualPiece,operationId:'mb',machines,settings,now,startDate:'2026-11-22',startTime:'18:00'}).error);
const neighbor=piece('neighbor',[op('neighbor-op','a',60)]);
manualPlan.operations.push({opId:'neighbor-op',machineId:'a',segments:[{date:'2026-11-22',start:'10:00',end:'11:00',minutes:60}]});
assert(moveOperation({proposal:manualPlan,piece:manualPiece,operationId:'mb',machines,settings,now,startDate:'2026-11-22',startTime:'10:00'}).error);
console.log('✅ Déplacement manuel : horaires, précédence et collisions vérifiés');
