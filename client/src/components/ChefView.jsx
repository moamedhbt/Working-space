import React, { useState } from 'react';
import { Bot, CheckCircle, Cpu, Plus, AlertTriangle, ChevronDown, ChevronUp, Power, Trash2 } from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';

export default function ChefView({ state, reload }) {
  const [tab, setTab] = useState('dashboard'); // dashboard | planning | ordres | machines | matiere
  const [expanded, setExpanded] = useState({});
  const [mNom, setMNom] = useState('');
  const [mType, setMType] = useState('');
  const [aiAlerts, setAiAlerts] = useState([]);
  const [toast, setToast] = useState('');

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function optimizeAI() {
    const res = await api('/api/planning/optimize', 'POST');
    setAiAlerts(res.alerts || []);
    showToast("Proposition IA générée. Vérifiez et cliquez sur Valider et envoyer à la TV.");
    reload();
  }

  async function validatePlanning() {
    await api('/api/planning/validate', 'POST');
    showToast("Planning validé et publié sur l'écran TV.");
    reload();
  }

  async function addMachine() {
    if (!mNom.trim()) return;
    await api('/api/machines', 'POST', { nom: mNom, type: mType || 'Usinage' });
    setMNom('');
    setMType('');
    showToast('Machine ajoutée.');
    reload();
  }

  async function toggleMachine(m) {
    await api(`/api/machines/${m.id}`, 'PUT', { actif: !m.actif });
    showToast(`${m.nom} ${!m.actif ? 'activée' : 'désactivée'}. Re-validation TV requise.`);
    reload();
  }

  async function deleteMachine(m) {
    if (!window.confirm(`Supprimer définitivement la machine "${m.nom}" ?`)) return;
    try {
      await api(`/api/machines/${m.id}`, 'DELETE');
      showToast(`Machine ${m.nom} supprimée.`);
      reload();
    } catch (e) {
      alert(e.message);
    }
  }

  async function savePiece(id, e) {
    e.preventDefault();
    const f = e.target;
    await api(`/api/pieces/${id}/chef`, 'POST', {
      machine: f.machine.value,
      operateur: f.operateur.value,
      matiere: f.matiere.value,
      outils: f.outils.value,
      chuteDispo: f.chuteDispo.checked
    });
    showToast(`Ordre ${id} enregistré. Cliquez sur "Valider et envoyer à la TV" pour publier.`);
    reload();
  }

  async function updatePlanningRow(id, field, value) {
    await api(`/api/pieces/${id}/chef`, 'POST', { [field]: value });
    showToast(`Planning modifié (${id}). Re-validation TV requise.`);
    reload();
  }

  const orderRank = { Critique: 1, Urgent: 2, Normal: 3 };
  const sortedPieces = [...state.pieces].sort((a, b) => (orderRank[a.urgence] || 9) - (orderRank[b.urgence] || 9));
  const activeMachines = state.machines.filter(m => m.actif);
  const operators = state.users.filter(u => u.role === 'operateur');

  return (
    <div className="space-y-4">
      {toast && (
        <div className="p-3 rounded-[6px] bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium">
          {toast}
        </div>
      )}

      {/* 5-TAB BAR */}
      <div className="grid grid-cols-5 gap-1 bg-[#111821] border border-[#1E2A38] rounded-[6px] p-1 text-[11px] font-medium">
        {[
          ['dashboard', 'Dashboard'],
          ['planning', 'Planning'],
          ['ordres', `Ordres (${sortedPieces.length})`],
          ['machines', 'Machines'],
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

        {aiAlerts.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-[6px] p-3 text-xs space-y-1">
            <div className="font-semibold text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Alertes de blocage</div>
            {aiAlerts.map((a, i) => <div key={i} className="text-slate-300">{a}</div>)}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activeMachines.map(m => {
            const mPieces = state.pieces.filter(p => p.machine === m.nom && p.statut !== 'Clôturé');
            const hours = mPieces.reduce((s, p) => s + (p.tempsPrevuMin || 120), 0) / 60;
            const pct = Math.min(100, Math.round((hours / 8) * 100));
            const activeP = mPieces[0];
            const waitingMat = activeP && activeP.statut === 'À acheter';
            const statusText = waitingMat ? 'En attente matière' : activeP ? activeP.statut : 'Disponible';
            return (
              <div key={m.id} className="cyber-card p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-white">{m.nom}</span>
                  <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] whitespace-nowrap ${
                    waitingMat ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-[#0B0F14] text-[#22D3EE] border-[#1E2A38]'
                  }`}>
                    {statusText}
                  </span>
                </div>
                <div className="text-xs text-slate-400">{m.type} · {activeP ? activeP.operateur : '—'}</div>
                <div className="w-full h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                  <div className={`h-full ${waitingMat ? 'bg-amber-400' : 'bg-[#22D3EE]'}`} style={{ width: `${pct}%` }}></div>
                </div>
                <div className="text-[11px] font-mono-num text-slate-400">{hours.toFixed(1)} h / 8 h planifiées</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TAB 2: PLANNING MODIFIABLE */}
      <div className={tab === 'planning' ? 'block space-y-4' : 'hidden'}>
        <div className="cyber-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Planning modifiable (validation requise pour la TV)</h3>
            <button onClick={validatePlanning} className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <CheckCircle className="w-3.5 h-3.5" /> Valider et envoyer à la TV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[760px]">
              <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
                <tr><th className="py-2">Ordre</th><th className="py-2">OF</th><th className="py-2">Machine</th><th className="py-2">Opérateur</th><th className="py-2">Priorité</th><th className="py-2">Délai</th><th className="py-2">TV</th></tr>
              </thead>
              <tbody className="divide-y divide-[#1E2A38]">
                {sortedPieces.map(p => (
                  <tr key={p.id}>
                    <td className="py-2 pr-2">
                      <input type="number" defaultValue={p.ordrePlanning} onBlur={e => updatePlanningRow(p.id, 'ordrePlanning', e.target.value)} className="w-14 p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
                    </td>
                    <td className="py-2 pr-2 font-mono-num text-white">{p.id}</td>
                    <td className="py-2 pr-2">
                      <select defaultValue={p.machine} onChange={e => updatePlanningRow(p.id, 'machine', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                        {activeMachines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <select defaultValue={p.operateur} onChange={e => updatePlanningRow(p.id, 'operateur', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                        {operators.map(o => <option key={o.id} value={o.nom}>{o.nom}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <select defaultValue={p.urgence} onChange={e => updatePlanningRow(p.id, 'urgence', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                        <option>Critique</option><option>Urgent</option><option>Normal</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input type="date" defaultValue={p.delai} onBlur={e => updatePlanningRow(p.id, 'delai', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
                    </td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] ${p.planningValide ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
                        {p.planningValide ? 'Publié' : 'À valider'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* TAB 3: ORDRES */}
      <div className={tab === 'ordres' ? 'block space-y-3' : 'hidden'}>
        {sortedPieces.map(p => {
          const isOpen = !!expanded[p.id];
          return (
            <div key={p.id} className="cyber-card p-4 text-xs space-y-3">
              <button type="button" onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))} className="w-full flex items-center justify-between gap-2 text-left cursor-pointer">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-white font-mono-num truncate">{p.id} · <span className="font-sans">{p.nom}</span></div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{p.machine} · {p.operateur}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] whitespace-nowrap ${
                    p.urgence === 'Critique' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                    p.urgence === 'Urgent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}>{p.urgence}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </div>
              </button>

              <form onSubmit={e => savePiece(p.id, e)} className={`${isOpen ? 'block' : 'hidden'} space-y-3 pt-2 border-t border-[#1E2A38]`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500">Machine</label>
                    <select name="machine" defaultValue={p.machine} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
                      {activeMachines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">Opérateur</label>
                    <select name="operateur" defaultValue={p.operateur} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
                      {operators.map(o => <option key={o.id} value={o.nom}>{o.nom}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-slate-500">Matière</label>
                    <input name="matiere" defaultValue={p.matiere} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-slate-500">Outillage</label>
                    <textarea name="outils" rows={2} defaultValue={p.outils} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                  </div>
                </div>
                <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                    <input type="checkbox" name="chuteDispo" defaultChecked={p.chuteDispo} className="accent-[#22D3EE]" /> Chute disponible en stock (sinon achat)
                  </label>
                  <button type="submit" className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] font-semibold cursor-pointer">
                    Valider et planifier
                  </button>
                </div>
              </form>
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
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            <input placeholder="Nom machine (ex: Tour CNC 3)" value={mNom} onChange={e => setMNom(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <input placeholder="Type (ex: Tournage CNC)" value={mType} onChange={e => setMType(e.target.value)} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <button onClick={addMachine} className="py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Ajouter
            </button>
          </div>
        </div>

        <div className="cyber-card p-4 space-y-2.5 text-xs">
          <div className="font-semibold text-sm text-white mb-2">Parc Machines</div>
          {state.machines.map(m => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
              <div>
                <span className="font-semibold text-white">{m.nom}</span>
                <span className="text-slate-400 ml-2">({m.type})</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleMachine(m)} className={`px-2.5 py-1 rounded border flex items-center gap-1 cursor-pointer ${m.actif ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  <Power className="w-3 h-3" /> {m.actif ? 'Active' : 'Désactivée'}
                </button>
                <button onClick={() => deleteMachine(m)} className="px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer" title="Supprimer (Directeur)">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
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
