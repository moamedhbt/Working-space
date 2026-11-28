import React, { useState } from 'react';
import {
  Bot, CheckCircle, Cpu, Plus, AlertTriangle, ChevronDown, ChevronUp,
  Power, Trash2, Wrench, Layers, Edit3, Check, X, Truck, ShieldAlert, Clock
} from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';
import ChefPlanningTab from './ChefPlanningTab';
import CreateOfModal from './CreateOfModal';
import TimelineModal from './TimelineModal';
import OperationInstruction from './OperationInstruction';
import ChefToday from './ChefToday';
import {useWorkshopDialog} from './WorkshopDialog';
import MaterialSummary from './MaterialSummary';

export default function ChefView({ state, user, reload, search = '' }) {
  const [tab, setTab] = useState('dashboard');
  const {ask, dialog} = useWorkshopDialog();
  const [materialRevision,setMaterialRevision] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [timelinePiece, setTimelinePiece] = useState(null);
  const [mNom, setMNom] = useState('');
  const [mType, setMType] = useState('');
  const [mTaux, setMTaux] = useState(2500);
  const [mInter, setMInter] = useState(200);
  const [editingMachineId, setEditingMachineId] = useState(null);
  const [editMachineForm, setEditMachineForm] = useState({ nom: '', type: '', tauxHoraire: 2500, capaciteJourMin: 480, intervalleEntretienH: 200 });
  const [newOpByPiece, setNewOpByPiece] = useState({});
  const [materialRequest,setMaterialRequest] = useState(null);
  const [planningProposal,setPlanningProposal] = useState(null);
  const [machineProposals,setMachineProposals] = useState({});
  const [proposalBusy,setProposalBusy] = useState(false);
  const [toast, setToast] = useState({ type: 'ok', text: '' });

  function showToast(text, type = 'ok') {
    setToast({ type, text });
    setTimeout(() => setToast({ type: 'ok', text: '' }), 4000);
  }

  async function validateChefOf(pieceId) {
    try {
      await api(`/api/pieces/${pieceId}/chef-validate`, 'POST');
      showToast(`Matière, outillage & affectation validés pour ${pieceId}.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function resolveStop(stopId) {
    try {
      await api(`/api/stops/${stopId}/resolve`, 'POST');
      showToast('Blocage atelier marqué comme résolu.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function resolvePanne(panneId) {
    try {
      await api(`/api/pannes/${panneId}/resolve`, 'POST');
      showToast('Panne résolue : machine remise en service (l’opérateur peut reprendre).');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function validateMaintenance(m) {
    const desc = await ask(`Description de l'entretien préventif sur ${m.nom} :`, {title:'Entretien préventif',defaultValue:'Graissage, niveaux, contrôle géométrie',confirmLabel:'Enregistrer'});
    if (desc === null) return;
    try {
      await api(`/api/machines/${m.id}/maintenance`, 'POST', { description: desc });
      showToast(`Entretien préventif validé sur ${m.nom} (compteur remis à jour).`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function addMachine() {
    if (!mNom.trim()) return showToast('Entrez le nom de la machine.', 'err');
    try {
      await api('/api/machines', 'POST', {
        nom: mNom.trim(),
        type: mType.trim() || 'Usinage',
        tauxHoraire: Number(mTaux) || 2500,
        intervalleEntretienH: Number(mInter) || 200
      });
      setMNom('');
      setMType('');
      setMTaux(2500);
      setMInter(200);
      showToast('Machine ajoutée.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function toggleMachine(m) {
    try {
      await api(`/api/machines/${m.id}`, 'PUT', { actif: !m.actif });
      showToast(`${m.nom} ${!m.actif ? 'activée' : 'désactivée'}. Re-validation TV requise.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  function startEditMachine(m) {
    setEditingMachineId(m.id);
    setEditMachineForm({
      nom: m.nom,
      type: m.type || 'Usinage',
      tauxHoraire: m.tauxHoraire || 2500,
      capaciteJourMin: m.capaciteJourMin || 480,
      intervalleEntretienH: m.intervalleEntretienH || 200
    });
  }

  async function saveEditMachine(id) {
    try {
      await api(`/api/machines/${id}`, 'PUT', editMachineForm);
      setEditingMachineId(null);
      showToast('Machine mise à jour (tous les OF liés ont été actualisés automatiquement).');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function deleteMachine(m) {
    if (!await ask(`Supprimer définitivement la machine "${m.nom}" ?`)) return;
    try {
      await api(`/api/machines/${m.id}`, 'DELETE');
      showToast(`Machine ${m.nom} supprimée.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  function hasUnsavedPiece(form, piece) {
    if (!form || !piece) return false;
    return Number(form.quantitePrevue.value)!==Number(piece.quantitePrevue) || form.matiere.value!==(piece.matiere || '') || form.fournisseur.value!==(piece.fournisseur || '') || form.outils.value!==(piece.outils || '') || form.chuteDispo.checked!==!!piece.chuteDispo;
  }

  async function savePiece(id, e) {
    e.preventDefault();
    const f = e.target;
    if (!hasUnsavedPiece(f,state.pieces.find(p=>p.id===id))) {showToast('Aucune modification à enregistrer.');return;}
    if (!await ask('Enregistrer ces informations modifie directement l’OF. La validation du chef et le planning publié de cet OF seront retirés : il faudra revalider, recalculer puis publier le planning. Continuer ?')) return;
    try {
      await api(`/api/pieces/${id}/chef`, 'POST', {
        quantitePrevue: Number(f.quantitePrevue.value) || 1,
        matiere: f.matiere.value,
        fournisseur: f.fournisseur.value,
        outils: f.outils.value,
        chuteDispo: f.chuteDispo.checked
      });
      showToast(`Ordre ${id} enregistré (temps gamme recalculés si la quantité a changé).`);
      reload();
    } catch (err) {
      showToast(err.message, 'err');
    }
  }

  async function addOperation(pieceId, piece) {
    const form = newOpByPiece[pieceId] || {};
    if (!form.libelle?.trim()) return showToast("Saisissez le libellé de l'opération.", 'err');
    if (!await ask(`Ajouter « ${form.libelle.trim()} » modifie directement la gamme et retire la validation chef et le planning publié de cet OF. Il faudra revalider, recalculer et publier. Continuer ?`)) return;
    try {
      await api(`/api/pieces/${pieceId}/operations`, 'POST', {
        libelle: form.libelle.trim(),
        estSousTraitance: !!form.estSousTraitance,
        sousTraitant: form.sousTraitant || '',
        dateEnvoi: form.dateEnvoi || '',
        dateRetourPrevue: form.dateRetourPrevue || '',
        machineId: form.machineId || piece.machineId || activeMachines[0]?.id,
        machineTypeRequis: form.machineTypeRequis || '',
        operateurId: form.operateurId || piece.operateurId || operators[0]?.id,
        tempsReglageMin: Number(form.tempsReglageMin ?? 15),
        tempsUnitaireMin: Number(form.tempsUnitaireMin ?? 0),
        tempsPrevuMin: Number(form.tempsPrevuMin ?? 60)
      });
      setNewOpByPiece(prev => ({ ...prev, [pieceId]: { libelle: '', tempsReglageMin: 15, tempsUnitaireMin: 0, tempsPrevuMin: 60, estSousTraitance: false } }));
      showToast(`Opération ajoutée à la gamme de ${pieceId}.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function proposeMachine(piece, op) {
    const machineId = machineProposals[op.id];
    if (!machineId || proposalBusy) return;
    if (!await ask(`Préparer un nouveau brouillon pour ${piece.id} · ${op.libelle} ? Il remplacera l’aperçu actuellement ouvert dans Planning, sans modifier la gamme ni publier.`)) return;
    setProposalBusy(true);
    try {
      const result = await api('/api/planning/drafts/reassign', 'POST', {operationId:op.id, machineId});
      setPlanningProposal(result.proposal);
      setTab('planning');
      showToast('Brouillon préparé : vérifiez les changements et la compatibilité avant publication.');
    } catch (e) { showToast(e.message, 'err'); }
    finally { setProposalBusy(false); }
  }

  async function proposeOperation(e, piece, op) {
    e.preventDefault();
    if (proposalBusy) return;
    const data = new FormData(e.currentTarget);
    const payload = {operationId:op.id, operateurId:data.get('operateurId'), tempsReglageMin:Number(data.get('tempsReglageMin')), tempsUnitaireMin:Number(data.get('tempsUnitaireMin')), tempsPrevuMin:Number(data.get('tempsPrevuMin'))};
    if (!await ask(`Préparer un brouillon pour ${piece.id} · ${op.libelle} ? L’aperçu ouvert dans Planning sera remplacé. Rien ne sera publié.`)) return;
    setProposalBusy(true);
    try {
      const result=await api('/api/planning/drafts/operation','POST',payload);
      setPlanningProposal(result.proposal);setTab('planning');
      showToast('Brouillon préparé : vérifiez les changements avant publication.');
    } catch (err) {showToast(err.message,'err');} finally {setProposalBusy(false);}
  }

  async function updateOperationField(opId, payload, input) {
    const piece = state.pieces.find(p => (p.operations || []).some(o => o.id === opId));
    const op = piece?.operations.find(o => o.id === opId);
    const [field, value] = Object.entries(payload)[0];
    const label = {machineId:'Machine', operateurId:'Opérateur', machineTypeRequis:'Choix machine', tempsReglageMin:'Temps de réglage', tempsUnitaireMin:'Temps unitaire'}[field] || field;
    const describe = v => field === 'machineId' ? (state.machines.find(m => m.id === v)?.nom || v || '—') : field === 'operateurId' ? (state.users.find(u => u.id === v)?.nom || v || '—') : field === 'machineTypeRequis' ? (v ? `Auto · ${v}` : 'Machine imposée') : `${v ?? 0} min`;
    if (!await ask(`${piece?.id || 'OF'} · ${op?.libelle || 'Opération'}\n${label} : ${describe(op?.[field])} → ${describe(value)}\n\nCette modification est immédiate : elle retire la validation chef et le planning publié de cet OF. Revalidez, puis recalculez et publiez le planning pour voir les dates et les autres OF touchés. Continuer ?`)) { if (input) input.value = op?.[field] ?? 0; return; }
    try {
      await api(`/api/operations/${opId}`, 'PUT', payload);
      showToast('Opération mise à jour.');
      reload();
    } catch (e) {
      if (input) input.value = op?.[field] ?? 0;
      showToast(e.message, 'err');
    }
  }

  async function completeSubcontract(op, piece) {
    const raw = await ask(`Quantité bonne reçue pour ${op.libelle} ?`, {title:'Retour de sous-traitance',defaultValue:String(piece.quantitePrevue || 1),confirmLabel:'Enregistrer'});
    if (raw === null) return;
    if (!/^\d+$/.test(raw.trim())) return showToast('Saisissez une quantité entière positive.', 'err');
    try { await api(`/api/operations/${op.id}/finish`, 'POST', {quantiteBonne:Number(raw)}); showToast('Retour de sous-traitance enregistré.'); reload(); }
    catch(e) { showToast(e.message, 'err'); }
  }

  async function deleteOperation(opId) {
    const piece = state.pieces.find(p => (p.operations || []).some(o => o.id === opId));
    const op = piece?.operations.find(o => o.id === opId);
    if (!await ask(`Supprimer « ${op?.libelle || 'cette opération'} » ? La validation chef et le planning publié de cet OF seront retirés. Il faudra revalider, recalculer et publier.`)) return;
    try {
      await api(`/api/operations/${opId}`, 'DELETE');
      showToast('Opération supprimée de la gamme.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  const orderRank = { Critique: 1, Urgent: 2, Normal: 3 };
  const filteredPieces = state.pieces.filter(p =>
    !p.archived && (
      !search ||
      p.id.toLowerCase().includes(search.toLowerCase()) ||
      p.nom.toLowerCase().includes(search.toLowerCase()) ||
      (p.client || '').toLowerCase().includes(search.toLowerCase())
    )
  );
  const sortedPieces = [...filteredPieces].sort((a, b) => (orderRank[a.urgence] || 9) - (orderRank[b.urgence] || 9));
  const activeMachines = state.machines.filter(m => m.actif);
  const operators = state.users.filter(u => u.role === 'operateur' && u.actif !== 0);
  const openPannes = (state.pannes || []).filter(p => p.statut === 'Ouverte');
  const machineStatsById = new Map((state.analytics?.machineStats || []).map(ms => [ms.id, ms]));
  const isDir = user?.role === 'directeur';

  return (
    <div className="space-y-4">
      {dialog}
      {toast.text && (
        <div className={`p-3 rounded-[6px] border text-xs font-medium ${
          toast.type === 'err'
            ? 'bg-red-500/15 border-red-500/40 text-red-300'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        }`}>
          {toast.text}
        </div>
      )}

      <CreateOfModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        state={state}
        user={user}
        onCreated={res => {
          showToast(res.validationDirection ? `OF ${res.id} créé.` : `OF ${res.id} créé et envoyé au Directeur pour validation.`);
          reload();
        }}
      />
      <TimelineModal piece={timelinePiece} onClose={() => setTimelinePiece(null)} />

      {/* 5-TAB BAR */}
      <div className="grid grid-cols-5 gap-1 bg-[#111821] border border-[#1E2A38] rounded-[6px] p-1 text-[11px] font-medium">
        {[
          ['dashboard', 'Aujourd’hui'],
          ['planning', 'Planning & IA'],
          ['ordres', `Ordres & Gammes (${sortedPieces.length})`],
          ['machines', `Machines${openPannes.length ? ` (${openPannes.length}!)` : ''}`],
          ['matiere', 'Matière']
        ].map(([id, lbl]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`py-1.5 rounded-[4px] text-center truncate px-1 cursor-pointer ${
              tab === id ? 'bg-[#22D3EE]/15 text-[#22D3EE] border border-[#22D3EE]/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Dashboard uses live workshop state and explicit actions, not a second scheduler. */}
      {tab === 'dashboard' && <ChefToday state={state} onPlanning={()=>setTab('planning')} onNew={()=>setShowCreateModal(true)} onOrder={id=>{setExpanded(p=>({...p,[id]:true}));setTab('ordres')}} onResolveStop={resolveStop} onResolvePanne={resolvePanne}/>}

      {/* TAB 2: PLANNING & IA */}
      <div className={tab === 'planning' ? 'block' : 'hidden'}>
        <ChefPlanningTab state={state} reload={reload} showToast={showToast} incomingProposal={planningProposal} ask={ask} />
      </div>

      {/* TAB 3: ORDRES & GAMMES MULTI-OPERATIONS (REGLAGE vs USINAGE + SOUS-TRAITANCE) */}
      <div className={tab === 'ordres' ? 'block space-y-3' : 'hidden'}>
        {sortedPieces.map(p => {
          const isOpen = !!expanded[p.id];
          const newOp = newOpByPiece[p.id] || {
            libelle: '',
            estSousTraitance: false,
            sousTraitant: '',
            dateEnvoi: '',
            dateRetourPrevue: '',
            machineId: p.machineId || activeMachines[0]?.id || '',
            operateurId: p.operateurId || operators[0]?.id || '',
            tempsReglageMin: 15,
            tempsUnitaireMin: 0,
            tempsPrevuMin: 60
          };
          const previewMin = Number(newOp.tempsUnitaireMin) > 0
            ? Math.round((Number(newOp.tempsReglageMin) || 0) + Number(newOp.tempsUnitaireMin) * (p.quantitePrevue || 1))
            : Number(newOp.tempsPrevuMin || 60);

          return (
            <div key={p.id} className="cyber-card p-4 text-xs space-y-3">
              <button
                type="button"
                onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-white font-mono-num truncate">
                    {p.id} · <span className="font-sans">{p.nom}</span> <span className="text-xs font-normal text-slate-400">({p.quantitePrevue} pcs)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
                    <span>{p.machine} · {p.operateur}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[#22D3EE] font-mono-num text-[10px]">
                      {p.opsTerminees}/{p.opsTotal} op.
                    </span>
                    <span className="font-mono-num">Régl. {p.totalReglageMin || 0}m · Total {p.tempsReelMin}/{p.tempsPrevuMin}m</span>
                    {p.quantiteRebut > 0 && <span className="text-red-400 font-mono-num">{p.quantiteRebut} rebut(s)</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] whitespace-nowrap ${
                    p.urgence === 'Critique' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                    p.urgence === 'Urgent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}>{p.urgence} · {p.statut}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </div>
              </button>

              {isOpen && (
                <div className="space-y-4 pt-3 border-t border-[#1E2A38]">
                  <form key={`${p.id}-${p.machineId}-${p.operateurId}-${p.quantitePrevue}`} onSubmit={e => savePiece(p.id, e)} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500">Quantité prévue (recalcule la gamme)</label>
                        <input name="quantitePrevue" type="number" min="1" defaultValue={p.quantitePrevue} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">Fournisseur matière</label>
                        <input name="fournisseur" defaultValue={p.fournisseur} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-500">Matière</label>
                        <input name="matiere" defaultValue={p.matiere} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-500">Outillage</label>
                        <input name="outils" defaultValue={p.outils} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                        <input type="checkbox" name="chuteDispo" defaultChecked={p.chuteDispo} className="accent-[#22D3EE]" /> Chute disponible en stock (sinon achat)
                      </label>
                      <div className="flex flex-wrap gap-2 items-center">
                        <button type="button" onClick={()=>{setMaterialRequest({id:p.id});setTab('matiere')}} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300">Estimation matière</button>
                        <button type="button" onClick={() => setTimelinePiece(p)} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 flex items-center gap-1 cursor-pointer">
                          <Clock className="w-3.5 h-3.5 text-[#22D3EE]" /> Dossier
                        </button>
                        {!p.chefValide ? (
                          <button type="button" onClick={e => {if(hasUnsavedPiece(e.currentTarget.closest('form'),p)){showToast('Enregistrez d’abord les modifications de la fiche avant de valider.','err');return;}validateChefOf(p.id)}} className="px-3 py-1.5 rounded-[6px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer">
                            Valider Matière & Distribution
                          </button>
                        ) : (
                          <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium">
                            Chef validé ✓
                          </span>
                        )}
                        <button type="submit" className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] font-semibold cursor-pointer">
                          Enregistrer OF
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-[11px] text-slate-300">
                    1. Préparez matière et étapes ci-dessous. 2. Validez la préparation. 3. Dans Planning, calculez puis publiez le brouillon. En mode automatique, le moteur choisit la machine selon son type et ses disponibilités.
                    <span className="ml-1 font-medium">{p.planningValide ? 'Planning publié.' : 'Planning non publié ou à republier.'}</span>
                  </div>
                  <MaterialSummary pieceId={p.id} revision={materialRevision} onOpen={()=>{setMaterialRequest({id:p.id});setTab('matiere')}}/>
                                    {/* GAMME MULTI-OPERATIONS WITH SETUP + UNIT TIME + SUBCONTRACTING */}
                  <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[#22D3EE]" /> Gamme de fabrication ({(p.operations || []).length} opération(s))
                      </span>
                      <span className="text-[10px] text-slate-400">Temps = Réglage (setup) + Quantité × Temps unitaire</span>
                    </div>

                    <div className="space-y-1.5">
                      {(p.operations || []).map((op, idx) => (
                        <div key={op.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center p-2 rounded bg-[#111821] border border-[#1E2A38]">
                          <div className="md:col-span-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono-num text-[#22D3EE]">Op {(idx + 1) * 10}</span>
                              {op.estSousTraitance && <Truck className="w-3.5 h-3.5 text-purple-400" title="Sous-traitance" />}
                              <span className="font-medium text-white truncate">{op.libelle}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono-num mt-0.5">
                              {op.estSousTraitance
                                ? `Sous-traitant : ${op.sousTraitant || 'Externe'} (${op.dateEnvoi || '—'} → ${op.dateRetourPrevue || '—'})`
                                : `Régl. ${op.tempsReglageMin || 0}m + ${op.tempsUnitaireMin > 0 ? `${p.quantitePrevue}×${op.tempsUnitaireMin}m` : 'fixe'} = ${op.tempsPrevuMin}m`}
                            </div>
                          </div>

                          {!op.estSousTraitance ? (
                            <>
                              <div className="md:col-span-2">
                                <label className="block text-[10px] text-slate-400 mb-1">Choix de la machine</label>
                                <select aria-label={`Choix machine pour ${op.libelle}`} value={op.machineTypeRequis || ''}
                                  onChange={e => updateOperationField(op.id, {machineTypeRequis:e.target.value})}
                                  disabled={p.statut === 'Clôturé' || ['Terminée', 'En cours', 'Panne machine'].includes(op.statut)}
                                  className="w-full p-2 rounded bg-[#0B0F14] border border-[#1E2A38] text-[11px]">
                                  <option value="">Machine imposée</option>
                                  {[...new Set(activeMachines.map(m=>m.type).filter(Boolean))].sort().map(t=><option key={t} value={t}>Automatique · {t}</option>)}
                                </select>
                                {op.machineTypeRequis ? <p className="mt-1 text-[10px] text-cyan-200">Automatique : le moteur choisit une machine {op.machineTypeRequis}. Affectation actuelle : {state.machines.find(m=>m.id===op.machineId)?.nom || 'à calculer'}.</p> : <label className="block mt-2 text-[10px] text-slate-400">Machine imposée
                                  <select aria-label={`Machine actuelle pour ${op.libelle}`} value={op.machineId || ''} onChange={e => updateOperationField(op.id, { machineId:e.target.value })} disabled={p.statut === 'Clôturé' || ['Terminée','En cours','Panne machine'].includes(op.statut)} className="w-full mt-1 p-2 rounded bg-[#0B0F14] border border-[#1E2A38] text-[11px]">
                                    {!activeMachines.some(m=>m.id===op.machineId)&&<option value={op.machineId || ''}>{op.machine || 'Machine indisponible'}</option>}
                                    {activeMachines.map(m=><option key={m.id} value={m.id}>{m.nom}</option>)}
                                  </select></label>}
                                {op.machineTypeRequis && <p className="text-[10px] text-amber-300">Vérifiez capacités et outillage avant publication.</p>}
                                {op.statut === 'En attente' && p.statut !== 'Clôturé' && (() => {
                                  const current = state.machines.find(m => m.id === op.machineId);
                                  const alternatives = activeMachines.filter(m => m.id !== op.machineId && m.type && m.type === current?.type && !m.enPanne);
                                  return alternatives.length > 0 && <div className="mt-2 space-y-1">
                                    <select aria-label={`Machine à proposer pour ${op.libelle}`} value={machineProposals[op.id] || ''} onChange={e => setMachineProposals(prev => ({...prev, [op.id]:e.target.value}))} className="w-full p-1 rounded bg-[#0B0F14] border border-cyan-700 text-[11px]">
                                      <option value="">Autre machine de même type…</option>
                                      {alternatives.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                                    </select>
                                    <button type="button" disabled={!machineProposals[op.id] || proposalBusy} onClick={() => proposeMachine(p, op)} className="text-[10px] text-cyan-300 underline disabled:opacity-40">Voir l’impact dans un brouillon</button>
                                  </div>;
                                })()}
                              </div>
                              <div className="md:col-span-2">
                                <label className="block text-[10px] text-slate-400 mb-1">Opérateur</label>
                                <select aria-label={`Opérateur pour ${op.libelle}`}
                                  value={op.operateurId || ''}
                                  onChange={e => updateOperationField(op.id, { operateurId: e.target.value })}
                                  disabled={p.statut === 'Clôturé' || ['Terminée', 'En cours', 'Panne machine'].includes(op.statut)}
                                  className="w-full p-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-[11px]"
                                >
                                  {operators.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                                </select>
                              </div>
                              <div className="md:col-span-3 flex flex-wrap items-center gap-1 text-[10px]"><span className="w-full text-slate-400">Réglage + temps par pièce · réel/prévu</span>
                                <input
                                  type="number"
                                  min="0"
                                  defaultValue={op.tempsReglageMin || 0}
                                  onBlur={e => { if (Number(e.target.value) !== Number(op.tempsReglageMin || 0)) updateOperationField(op.id, { tempsReglageMin: Number(e.target.value) }, e.target); }}
                                  disabled={p.statut === 'Clôturé' || ['Terminée', 'En cours', 'Panne machine'].includes(op.statut)}
                                  className="w-12 p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-center"
                                  title="Temps réglage (min)"
                                />
                                <span className="text-slate-500">m +</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  defaultValue={op.tempsUnitaireMin || 0}
                                  onBlur={e => { if (Number(e.target.value) !== Number(op.tempsUnitaireMin || 0)) updateOperationField(op.id, { tempsUnitaireMin: Number(e.target.value) }, e.target); }}
                                  disabled={p.statut === 'Clôturé' || ['Terminée', 'En cours', 'Panne machine'].includes(op.statut)}
                                  className="w-12 p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-center"
                                  title="Temps unitaire (min/pièce)"
                                />
                                <span className="text-slate-500">m/pc</span>
                                <span className="font-mono-num text-slate-300 ml-1">({op.tempsReelMin}/{op.tempsPrevuMin}m)</span>
                              </div>
                            </>
                          ) : (
                            <div className="md:col-span-7 text-[11px] text-purple-300">
                              Étape externe (ne consomme pas de capacité machine interne)
                            </div>
                          )}

                          <div className="md:col-span-2 flex items-center justify-end gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
                              op.statut === 'Terminée' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                              op.statut === 'En cours' ? 'bg-[#22D3EE]/10 text-[#22D3EE] border-[#22D3EE]/30' :
                              op.statut === 'Panne machine' ? 'bg-red-500/15 text-red-400 border-red-500/40' :
                              'bg-slate-800 text-slate-300 border-slate-700'
                            }`}>{op.statut}</span>
                            {op.estSousTraitance && op.statut !== 'Terminée' && p.statut !== 'Clôturé' && <button type="button" onClick={() => completeSubcontract(op,p)} className="px-2 py-1 rounded border border-emerald-600 text-emerald-300 text-[10px]">Retour reçu</button>}
                            {p.statut !== 'Clôturé' && !['En cours', 'Panne machine', 'Terminée'].includes(op.statut) && (p.operations || []).length > 1 && (
                              <button type="button" onClick={() => deleteOperation(op.id)} className="p-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer" title="Supprimer">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {!op.estSousTraitance && op.statut === 'En attente' && p.statut !== 'Clôturé' && <details className="md:col-span-12 border-t border-slate-700 pt-2 text-[11px] text-slate-300">
                            <summary className="cursor-pointer text-cyan-300">Proposer opérateur ou temps dans le planning</summary>
                            <form onSubmit={e=>proposeOperation(e,p,op)} className="mt-2 flex flex-wrap items-end gap-2">
                              <label>Opérateur<select name="operateurId" defaultValue={op.operateurId || ''} required className="block p-1 bg-[#0B0F14] border border-slate-700 rounded">{operators.map(o=><option key={o.id} value={o.id}>{o.nom}</option>)}</select></label>
                              <label>Réglage (min)<input name="tempsReglageMin" type="number" min="0" max="100000" step="1" required defaultValue={op.tempsReglageMin || 0} className="block w-24 p-1 bg-[#0B0F14] border border-slate-700 rounded"/></label>
                              <label>Unitaire (min/pièce)<input name="tempsUnitaireMin" type="number" min="0" max="100000" step="any" required defaultValue={op.tempsUnitaireMin || 0} className="block w-24 p-1 bg-[#0B0F14] border border-slate-700 rounded"/></label>
                              <label>Temps fixe (min)<input name="tempsPrevuMin" type="number" min="5" max="1000000" step="1" required defaultValue={op.tempsPrevuMin || 60} className="block w-24 p-1 bg-[#0B0F14] border border-slate-700 rounded"/></label>
                              <button disabled={proposalBusy} className="px-2 py-1 rounded bg-cyan-500 text-slate-950 font-semibold disabled:opacity-50">Calculer l’impact</button>
                              <p className="w-full text-slate-400">Si le temps unitaire est supérieur à zéro, le moteur utilise réglage + quantité × temps unitaire ; sinon il utilise le temps fixe. Aucun changement avant publication.</p>
                            </form>
                          </details>}
                          {!op.estSousTraitance && op.statut !== 'Terminée' && p.statut !== 'Clôturé' && <OperationInstruction op={op} reload={reload} showToast={showToast}/>}
                        </div>
                      ))}
                    </div>

                    {/* ADD OPERATION FORM */}
                    {p.statut !== 'Clôturé' && (
                      <div className="space-y-2 pt-2 border-t border-[#1E2A38]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-slate-300">Ajouter une étape à la gamme</span>
                          <label className="flex items-center gap-1.5 text-[11px] text-purple-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!newOp.estSousTraitance}
                              onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, estSousTraitance: e.target.checked } }))}
                              className="accent-purple-400"
                            />
                            <Truck className="w-3.5 h-3.5" /> Étape de sous-traitance (traitement, rectification...)
                          </label>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <input
                            placeholder={newOp.estSousTraitance ? 'Ex: Traitement thermique / Zingage' : 'Ex: Fraisage rainure, Contrôle...'}
                            value={newOp.libelle || ''}
                            onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, libelle: e.target.value } }))}
                            className="sm:col-span-3 p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                          />

                          {!newOp.estSousTraitance ? (
                            <>
                              <label className="sm:col-span-2 text-[10px] text-slate-400">Machine : mode
                                <select aria-label="Mode machine nouvelle étape" value={newOp.machineTypeRequis || ''} onChange={e=>setNewOpByPiece(prev=>({...prev,[p.id]:{...newOp,machineTypeRequis:e.target.value}}))} className="w-full mt-1 p-1.5 rounded bg-[#111821] border border-[#1E2A38] text-slate-200">
                                  <option value="">Machine imposée</option>{[...new Set(activeMachines.map(m=>m.type).filter(Boolean))].sort().map(t=><option value={t} key={t}>Automatique · {t}</option>)}
                                </select>
                              </label>
                              {!newOp.machineTypeRequis && <select aria-label="Machine imposée nouvelle étape"
                                value={newOp.machineId || activeMachines[0]?.id || ''}
                                onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, machineId: e.target.value } }))}
                                className="sm:col-span-2 p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                              >
                                {activeMachines.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                              </select>}
                              <select aria-label="Opérateur nouvelle étape"
                                value={newOp.operateurId || operators[0]?.id || ''}
                                onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, operateurId: e.target.value } }))}
                                className="sm:col-span-2 p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                              >
                                {operators.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                              </select>
                              <input
                                type="number"
                                min="0"
                                aria-label="Réglage nouvelle étape (min)"
                                placeholder="Régl. (m)"
                                title="Temps réglage (min)"
                                value={newOp.tempsReglageMin ?? 15}
                                onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, tempsReglageMin: e.target.value } }))}
                                className="sm:col-span-1 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num"
                              />
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                aria-label="Temps unitaire nouvelle étape (min par pièce)"
                                placeholder="m/pc"
                                title="Temps unitaire par pièce (min)"
                                value={newOp.tempsUnitaireMin ?? 0}
                                onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, tempsUnitaireMin: e.target.value } }))}
                                className="sm:col-span-2 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num"
                              />
                            </>
                          ) : (
                            <>
                              <input
                                placeholder="Sous-traitant (ex: ThermiDZ)"
                                value={newOp.sousTraitant || ''}
                                onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, sousTraitant: e.target.value } }))}
                                className="sm:col-span-3 p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                              />
                              <input
                                type="date"
                                title="Date envoi"
                                value={newOp.dateEnvoi || ''}
                                onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, dateEnvoi: e.target.value } }))}
                                className="sm:col-span-2 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num"
                              />
                              <input
                                type="date"
                                title="Date retour prévue"
                                value={newOp.dateRetourPrevue || ''}
                                onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, dateRetourPrevue: e.target.value } }))}
                                className="sm:col-span-2 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num"
                              />
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => addOperation(p.id, p)}
                            className="sm:col-span-2 py-1.5 px-2 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] hover:bg-[#22D3EE] hover:text-[#0B0F14] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> {newOp.estSousTraitance ? 'Ajouter ST' : `Ajouter (${previewMin}m)`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* TAB 4: MACHINES + MAINTENANCE PREVENTIVE */}
      <div className={tab === 'machines' ? 'block space-y-4' : 'hidden'}>
        <div className="cyber-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Cpu className="w-4 h-4 text-[#22D3EE]" /> Ajouter une machine
          </div>
          <div className="grid sm:grid-cols-5 gap-2 text-xs">
            <input placeholder="Nom machine (ex: Tour CNC 3)" value={mNom} onChange={e => setMNom(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <input placeholder="Type (ex: Tournage CNC)" value={mType} onChange={e => setMType(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <input type="number" placeholder="Taux (DZD/h)" value={mTaux} onChange={e => setMTaux(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
            <input type="number" placeholder="Entretien (toutes les X h)" value={mInter} onChange={e => setMInter(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
            <button onClick={addMachine} className="py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Ajouter
            </button>
          </div>
        </div>

        <div className="cyber-card p-4 space-y-2.5 text-xs">
          <div className="font-semibold text-sm text-white mb-2">Parc Machines & Maintenance Préventive</div>
          {state.machines.map(m => {
            const ms = machineStatsById.get(m.id);
            const hSince = ms?.heuresDepuisEntretien ?? 0;
            const hInter = ms?.intervalleEntretienH ?? (m.intervalleEntretienH || 200);
            const maintPct = Math.min(100, Math.round((hSince / hInter) * 100));

            return (
              <div key={m.id} className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-2">
                {editingMachineId === m.id ? (
                  <div className="grid sm:grid-cols-6 gap-2 items-center">
                    <input value={editMachineForm.nom} onChange={e => setEditMachineForm({ ...editMachineForm, nom: e.target.value })} className="p-1.5 rounded bg-[#111821] border border-[#1E2A38]" placeholder="Nom" />
                    <input value={editMachineForm.type} onChange={e => setEditMachineForm({ ...editMachineForm, type: e.target.value })} className="p-1.5 rounded bg-[#111821] border border-[#1E2A38]" placeholder="Type" />
                    <input type="number" value={editMachineForm.tauxHoraire} onChange={e => setEditMachineForm({ ...editMachineForm, tauxHoraire: Number(e.target.value) })} className="p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num" placeholder="DZD/h" />
                    <input type="number" value={editMachineForm.capaciteJourMin} onChange={e => setEditMachineForm({ ...editMachineForm, capaciteJourMin: Number(e.target.value) })} className="p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num" placeholder="Min/jour" />
                    <input type="number" value={editMachineForm.intervalleEntretienH} onChange={e => setEditMachineForm({ ...editMachineForm, intervalleEntretienH: Number(e.target.value) })} className="p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num" placeholder="Entretien (h)" />
                    <div className="flex gap-1.5 justify-end">
                      <button onClick={() => saveEditMachine(m.id)} className="px-2.5 py-1.5 rounded bg-emerald-600 text-white flex items-center gap-1 cursor-pointer"><Check className="w-3.5 h-3.5" /> OK</button>
                      <button onClick={() => setEditingMachineId(null)} className="px-2.5 py-1.5 rounded bg-slate-800 text-slate-300 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-white">{m.nom}</span>
                        <span className="text-slate-400 ml-2">({m.type})</span>
                        <span className="text-slate-500 ml-2 font-mono-num">· {m.tauxHoraire || 2500} DZD/h · {((m.capaciteJourMin || 480) / 60).toFixed(0)}h/j</span>
                        {m.enPanne ? <span className="ml-2 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px]">EN PANNE</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => validateMaintenance(m)} className="px-2.5 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/15 flex items-center gap-1 cursor-pointer">
                          <Wrench className="w-3 h-3" /> Valider entretien
                        </button>
                        <button onClick={() => startEditMachine(m)} className="px-2.5 py-1 rounded border border-[#1E2A38] text-slate-300 hover:border-[#22D3EE] flex items-center gap-1 cursor-pointer">
                          <Edit3 className="w-3 h-3" /> Modifier
                        </button>
                        <button onClick={() => toggleMachine(m)} className={`px-2.5 py-1 rounded border flex items-center gap-1 cursor-pointer ${m.actif ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                          <Power className="w-3 h-3" /> {m.actif ? 'Active' : 'Désactivée'}
                        </button>
                        {isDir && (
                          <button onClick={() => deleteMachine(m)} className="px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer" title="Supprimer (Directeur)">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-slate-400 shrink-0">Compteur entretien :</span>
                      <div className="flex-1 h-1.5 bg-[#111821] rounded-full overflow-hidden">
                        <div className={`h-full ${ms?.maintenanceStatut === 'du' ? 'bg-red-500' : ms?.maintenanceStatut === 'proche' ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${maintPct}%` }}></div>
                      </div>
                      <span className={`font-mono-num shrink-0 ${ms?.maintenanceStatut === 'du' ? 'text-red-400 font-semibold' : ms?.maintenanceStatut === 'proche' ? 'text-amber-300' : 'text-slate-300'}`}>
                        {hSince}h / {hInter}h (dernier : {m.dernierEntretienDate || '—'})
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* TAB 5: MATIERE */}
      <div className={tab === 'matiere' ? 'block' : 'hidden'}>
        <MaterialCalculator state={state} reload={reload} showToast={showToast} materialRequest={materialRequest} ask={ask} onSaved={()=>setMaterialRevision(x=>x+1)} />
      </div>
    </div>
  );
}
