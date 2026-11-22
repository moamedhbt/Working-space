import React, { useState } from 'react';
import {
  Bot, CheckCircle, Cpu, Plus, AlertTriangle, ChevronDown, ChevronUp,
  Power, Trash2, Wrench, Layers, Edit3, Check, X
} from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';
import ChefPlanningTab from './ChefPlanningTab';

export default function ChefView({ state, user, reload, search = '' }) {
  const [tab, setTab] = useState('dashboard'); // dashboard | planning | ordres | machines | matiere
  const [expanded, setExpanded] = useState({});
  const [mNom, setMNom] = useState('');
  const [mType, setMType] = useState('');
  const [mTaux, setMTaux] = useState(2500);
  const [editingMachineId, setEditingMachineId] = useState(null);
  const [editMachineForm, setEditMachineForm] = useState({ nom: '', type: '', tauxHoraire: 2500, capaciteJourMin: 480 });
  const [newOpByPiece, setNewOpByPiece] = useState({});
  const [aiAlerts, setAiAlerts] = useState([]);
  const [toast, setToast] = useState({ type: 'ok', text: '' });

  function showToast(text, type = 'ok') {
    setToast({ type, text });
    setTimeout(() => setToast({ type: 'ok', text: '' }), 4000);
  }

  async function optimizeAI() {
    try {
      const res = await api('/api/planning/optimize', 'POST');
      setAiAlerts(res.alerts || []);
      showToast('Proposition IA générée. Vérifiez et cliquez sur Valider et envoyer à la TV.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function validatePlanning() {
    try {
      await api('/api/planning/validate', 'POST');
      showToast("Planning validé et publié sur l'écran TV.");
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

  async function addMachine() {
    if (!mNom.trim()) return showToast('Entrez le nom de la machine.', 'err');
    try {
      await api('/api/machines', 'POST', { nom: mNom.trim(), type: mType.trim() || 'Usinage', tauxHoraire: Number(mTaux) || 2500 });
      setMNom('');
      setMType('');
      setMTaux(2500);
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
      capaciteJourMin: m.capaciteJourMin || 480
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
    if (!window.confirm(`Supprimer définitivement la machine "${m.nom}" ?`)) return;
    try {
      await api(`/api/machines/${m.id}`, 'DELETE');
      showToast(`Machine ${m.nom} supprimée.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function savePiece(id, e) {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/pieces/${id}/chef`, 'POST', {
        machineId: f.machineId.value,
        operateurId: f.operateurId.value,
        matiere: f.matiere.value,
        fournisseur: f.fournisseur.value,
        outils: f.outils.value,
        chuteDispo: f.chuteDispo.checked
      });
      showToast(`Ordre ${id} enregistré. Cliquez sur "Valider et envoyer à la TV" pour publier.`);
      reload();
    } catch (err) {
      showToast(err.message, 'err');
    }
  }

  async function addOperation(pieceId, piece) {
    const form = newOpByPiece[pieceId] || {};
    if (!form.libelle?.trim()) return showToast("Saisissez le libellé de l'opération.", 'err');
    try {
      await api(`/api/pieces/${pieceId}/operations`, 'POST', {
        libelle: form.libelle.trim(),
        machineId: form.machineId || piece.machineId || activeMachines[0]?.id,
        operateurId: form.operateurId || piece.operateurId || operators[0]?.id,
        tempsPrevuMin: Number(form.tempsPrevuMin) || 60
      });
      setNewOpByPiece(prev => ({ ...prev, [pieceId]: { libelle: '', tempsPrevuMin: 60 } }));
      showToast(`Opération ajoutée à la gamme de ${pieceId}.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function updateOperationField(opId, payload) {
    try {
      await api(`/api/operations/${opId}`, 'PUT', payload);
      showToast('Opération mise à jour.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function deleteOperation(opId) {
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
    !search ||
    p.id.toLowerCase().includes(search.toLowerCase()) ||
    p.nom.toLowerCase().includes(search.toLowerCase()) ||
    (p.client || '').toLowerCase().includes(search.toLowerCase())
  );
  const sortedPieces = [...filteredPieces].sort((a, b) => (orderRank[a.urgence] || 9) - (orderRank[b.urgence] || 9));
  const activeMachines = state.machines.filter(m => m.actif);
  const operators = state.users.filter(u => u.role === 'operateur' && u.actif !== 0);
  const openPannes = (state.pannes || []).filter(p => p.statut === 'Ouverte');
  const isDir = user?.role === 'directeur';

  return (
    <div className="space-y-4">
      {toast.text && (
        <div className={`p-3 rounded-[6px] border text-xs font-medium ${
          toast.type === 'err'
            ? 'bg-red-500/15 border-red-500/40 text-red-300'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        }`}>
          {toast.text}
        </div>
      )}

      {/* 5-TAB BAR */}
      <div className="grid grid-cols-5 gap-1 bg-[#111821] border border-[#1E2A38] rounded-[6px] p-1 text-[11px] font-medium">
        {[
          ['dashboard', 'Dashboard'],
          ['planning', 'Planning'],
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

      {/* TAB 1: DASHBOARD */}
      <div className={tab === 'dashboard' ? 'block space-y-4' : 'hidden'}>
        <div className="cyber-card cyber-corners p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Bot className="w-5 h-5 text-[#22D3EE] shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-white">Assistant IA chef d'atelier</h2>
              <p className="text-xs text-slate-400">L'IA propose un tri par urgence et délai ; vous validez ou modifiez avant envoi à la TV.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={optimizeAI} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-xs font-medium text-slate-200 cursor-pointer">
              Proposer un planning
            </button>
            <button onClick={validatePlanning} className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <CheckCircle className="w-3.5 h-3.5" /> Valider et envoyer à la TV
            </button>
          </div>
        </div>

        {/* ACTIVE BREAKDOWNS PANEL */}
        {openPannes.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-[6px] p-4 space-y-2 text-xs">
            <div className="font-semibold text-red-400 flex items-center gap-1.5">
              <Wrench className="w-4 h-4" /> Pannes machines actives ({openPannes.length})
            </div>
            {openPannes.map(pa => (
              <div key={pa.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-[#0B0F14] border border-red-500/30">
                <div>
                  <span className="font-semibold text-white">{pa.machineNom}</span>
                  {pa.pieceId && <span className="font-mono-num text-[#22D3EE] ml-2">{pa.pieceId}</span>}
                  {pa.operationLibelle && <span className="text-slate-400 ml-1">({pa.operationLibelle})</span>}
                  <div className="text-red-300 mt-0.5">Motif : {pa.motif} · Déclarée par {pa.declarePar} ({pa.createdAt})</div>
                </div>
                <button
                  onClick={() => resolvePanne(pa.id)}
                  className="px-3 py-1.5 rounded-[6px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                >
                  Résoudre la panne
                </button>
              </div>
            ))}
          </div>
        )}

        {aiAlerts.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-[6px] p-3 text-xs space-y-1">
            <div className="font-semibold text-amber-400 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Alertes de blocage</div>
            {aiAlerts.map((a, i) => <div key={i} className="text-slate-300">{a}</div>)}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {activeMachines.map(m => {
            const machineOps = state.pieces
              .filter(p => p.statut !== 'Clôturé')
              .flatMap(p => (p.operations || []).filter(o => o.machineId === m.id && o.statut !== 'Terminée').map(o => ({ ...o, piece: p })));
            const hours = machineOps.reduce((s, o) => s + (o.tempsPrevuMin || 60), 0) / 60;
            const capHours = (m.capaciteJourMin || 480) / 60;
            const pct = Math.min(100, Math.round((hours / capHours) * 100));
            const activeOp = machineOps.find(o => o.statut === 'En cours') || machineOps[0];
            const waitingMat = activeOp && activeOp.piece.statut === 'À acheter';
            const statusText = m.enPanne ? 'En panne' : waitingMat ? 'En attente matière' : activeOp ? activeOp.statut : 'Disponible';
            return (
              <div key={m.id} className={`cyber-card p-4 space-y-2.5 ${m.enPanne ? 'border-red-500/50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-white truncate">{m.nom}</span>
                  <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] whitespace-nowrap ${
                    m.enPanne ? 'bg-red-500/15 text-red-400 border-red-500/40' :
                    waitingMat ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                    'bg-[#0B0F14] text-[#22D3EE] border-[#1E2A38]'
                  }`}>
                    {statusText}
                  </span>
                </div>
                <div className="text-xs text-slate-400">{m.type} · {activeOp ? activeOp.operateur : '—'}</div>
                <div className="w-full h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                  <div className={`h-full ${m.enPanne ? 'bg-red-500' : waitingMat ? 'bg-amber-400' : 'bg-[#22D3EE]'}`} style={{ width: `${pct}%` }}></div>
                </div>
                <div className="flex justify-between text-[11px] font-mono-num text-slate-400">
                  <span>{hours.toFixed(1)} h / {capHours.toFixed(0)} h</span>
                  <span>{machineOps.length} op.</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TAB 2: PLANNING MODIFIABLE */}
      <div className={tab === 'planning' ? 'block' : 'hidden'}>
        <ChefPlanningTab state={state} reload={reload} showToast={showToast} />
      </div>

      {/* TAB 3: ORDRES & GAMMES MULTI-OPERATIONS */}
      <div className={tab === 'ordres' ? 'block space-y-3' : 'hidden'}>
        {sortedPieces.map(p => {
          const isOpen = !!expanded[p.id];
          const newOp = newOpByPiece[p.id] || {
            libelle: '',
            machineId: p.machineId || activeMachines[0]?.id || '',
            operateurId: p.operateurId || operators[0]?.id || '',
            tempsPrevuMin: 60
          };

          return (
            <div key={p.id} className="cyber-card p-4 text-xs space-y-3">
              <button
                type="button"
                onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-white font-mono-num truncate">
                    {p.id} · <span className="font-sans">{p.nom}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
                    <span>{p.machine} · {p.operateur}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[#22D3EE] font-mono-num text-[10px]">
                      {p.opsTerminees}/{p.opsTotal} op.
                    </span>
                    <span className="font-mono-num">{p.tempsReelMin}/{p.tempsPrevuMin} min</span>
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
                  {/* PIECE GENERAL AFFECTATION */}
                  <form key={`${p.id}-${p.machineId}-${p.operateurId}`} onSubmit={e => savePiece(p.id, e)} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500">Machine principale</label>
                        <select name="machineId" defaultValue={p.machineId || ''} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
                          {activeMachines.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">Opérateur principal</label>
                        <select name="operateurId" defaultValue={p.operateurId || ''} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
                          {operators.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">Fournisseur matière</label>
                        <input name="fournisseur" defaultValue={p.fournisseur} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                      </div>
                      <div className="sm:col-span-2 md:col-span-3">
                        <label className="text-[10px] text-slate-500">Matière</label>
                        <input name="matiere" defaultValue={p.matiere} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                      </div>
                      <div className="sm:col-span-2 md:col-span-3">
                        <label className="text-[10px] text-slate-500">Outillage</label>
                        <textarea name="outils" rows={2} defaultValue={p.outils} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                        <input type="checkbox" name="chuteDispo" defaultChecked={p.chuteDispo} className="accent-[#22D3EE]" /> Chute disponible en stock (sinon achat)
                      </label>
                      <button type="submit" className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] font-semibold cursor-pointer">
                        Enregistrer OF
                      </button>
                    </div>
                  </form>

                  {/* GAMME MULTI-OPERATIONS */}
                  <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[#22D3EE]" /> Gamme de fabrication ({(p.operations || []).length} opération(s))
                      </span>
                      <span className="text-[10px] text-slate-400">Chaque opération a sa propre machine et son opérateur</span>
                    </div>

                    <div className="space-y-1.5">
                      {(p.operations || []).map((op, idx) => (
                        <div key={op.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center p-2 rounded bg-[#111821] border border-[#1E2A38]">
                          <div className="md:col-span-3">
                            <span className="font-mono-num text-[#22D3EE] mr-1.5">Op {(idx + 1) * 10}</span>
                            <span className="font-medium text-white">{op.libelle}</span>
                          </div>
                          <div className="md:col-span-3">
                            <select
                              value={op.machineId || ''}
                              onChange={e => updateOperationField(op.id, { machineId: e.target.value })}
                              disabled={p.statut === 'Clôturé' || op.statut === 'Terminée'}
                              className="w-full p-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-[11px]"
                            >
                              {activeMachines.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <select
                              value={op.operateurId || ''}
                              onChange={e => updateOperationField(op.id, { operateurId: e.target.value })}
                              disabled={p.statut === 'Clôturé' || op.statut === 'Terminée'}
                              className="w-full p-1 rounded bg-[#0B0F14] border border-[#1E2A38] text-[11px]"
                            >
                              {operators.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                            </select>
                          </div>
                          <div className="md:col-span-2 font-mono-num text-[11px] text-slate-300">
                            {op.tempsReelMin}/{op.tempsPrevuMin}m · {op.quantiteBonne} ok
                            {op.quantiteRebut > 0 && <span className="text-red-400"> ({op.quantiteRebut} NC)</span>}
                          </div>
                          <div className="md:col-span-2 flex items-center justify-end gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
                              op.statut === 'Terminée' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                              op.statut === 'En cours' ? 'bg-[#22D3EE]/10 text-[#22D3EE] border-[#22D3EE]/30' :
                              op.statut === 'Panne machine' ? 'bg-red-500/15 text-red-400 border-red-500/40' :
                              'bg-slate-800 text-slate-300 border-slate-700'
                            }`}>{op.statut}</span>
                            {p.statut !== 'Clôturé' && op.statut !== 'En cours' && (p.operations || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => deleteOperation(op.id)}
                                className="p-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer"
                                title="Supprimer cette opération"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {p.statut !== 'Clôturé' && (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-[#1E2A38]">
                        <input
                          placeholder="Nouvelle opération (ex: Fraisage rainure, Contrôle...)"
                          value={newOp.libelle || ''}
                          onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, libelle: e.target.value } }))}
                          className="sm:col-span-4 p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                        />
                        <select
                          value={newOp.machineId || activeMachines[0]?.id || ''}
                          onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, machineId: e.target.value } }))}
                          className="sm:col-span-3 p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                        >
                          {activeMachines.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                        </select>
                        <select
                          value={newOp.operateurId || operators[0]?.id || ''}
                          onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, operateurId: e.target.value } }))}
                          className="sm:col-span-2 p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                        >
                          {operators.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                        </select>
                        <input
                          type="number"
                          min="5"
                          placeholder="Min"
                          value={newOp.tempsPrevuMin || 60}
                          onChange={e => setNewOpByPiece(prev => ({ ...prev, [p.id]: { ...newOp, tempsPrevuMin: e.target.value } }))}
                          className="sm:col-span-1 p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num"
                        />
                        <button
                          type="button"
                          onClick={() => addOperation(p.id, p)}
                          className="sm:col-span-2 py-1.5 px-2 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] hover:bg-[#22D3EE] hover:text-[#0B0F14] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Ajouter Op
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* TAB 4: MACHINES */}
      <div className={tab === 'machines' ? 'block space-y-4' : 'hidden'}>
        <div className="cyber-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Cpu className="w-4 h-4 text-[#22D3EE]" /> Ajouter une machine
          </div>
          <div className="grid sm:grid-cols-4 gap-2 text-xs">
            <input placeholder="Nom machine (ex: Tour CNC 3)" value={mNom} onChange={e => setMNom(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <input placeholder="Type (ex: Tournage CNC)" value={mType} onChange={e => setMType(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <input type="number" placeholder="Taux horaire (DZD/h)" value={mTaux} onChange={e => setMTaux(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
            <button onClick={addMachine} className="py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Ajouter
            </button>
          </div>
        </div>

        <div className="cyber-card p-4 space-y-2.5 text-xs">
          <div className="font-semibold text-sm text-white mb-2">Parc Machines</div>
          {state.machines.map(m => (
            <div key={m.id} className="p-2.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-2">
              {editingMachineId === m.id ? (
                <div className="grid sm:grid-cols-5 gap-2 items-center">
                  <input
                    value={editMachineForm.nom}
                    onChange={e => setEditMachineForm({ ...editMachineForm, nom: e.target.value })}
                    className="p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                    placeholder="Nom"
                  />
                  <input
                    value={editMachineForm.type}
                    onChange={e => setEditMachineForm({ ...editMachineForm, type: e.target.value })}
                    className="p-1.5 rounded bg-[#111821] border border-[#1E2A38]"
                    placeholder="Type"
                  />
                  <input
                    type="number"
                    value={editMachineForm.tauxHoraire}
                    onChange={e => setEditMachineForm({ ...editMachineForm, tauxHoraire: Number(e.target.value) })}
                    className="p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num"
                    placeholder="DZD/h"
                  />
                  <input
                    type="number"
                    value={editMachineForm.capaciteJourMin}
                    onChange={e => setEditMachineForm({ ...editMachineForm, capaciteJourMin: Number(e.target.value) })}
                    className="p-1.5 rounded bg-[#111821] border border-[#1E2A38] font-mono-num"
                    placeholder="Min/jour"
                  />
                  <div className="flex gap-1.5 justify-end">
                    <button onClick={() => saveEditMachine(m.id)} className="px-2.5 py-1.5 rounded bg-emerald-600 text-white flex items-center gap-1 cursor-pointer">
                      <Check className="w-3.5 h-3.5" /> OK
                    </button>
                    <button onClick={() => setEditingMachineId(null)} className="px-2.5 py-1.5 rounded bg-slate-800 text-slate-300 flex items-center gap-1 cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-white">{m.nom}</span>
                    <span className="text-slate-400 ml-2">({m.type})</span>
                    <span className="text-slate-500 ml-2 font-mono-num">· {m.tauxHoraire || 2500} DZD/h · {((m.capaciteJourMin || 480) / 60).toFixed(0)}h/j</span>
                    {m.enPanne ? <span className="ml-2 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px]">EN PANNE</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
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
              )}
            </div>
          ))}
        </div>
      </div>

      {/* TAB 5: MATIERE */}
      <div className={tab === 'matiere' ? 'block' : 'hidden'}>
        <MaterialCalculator />
      </div>
    </div>
  );
}
