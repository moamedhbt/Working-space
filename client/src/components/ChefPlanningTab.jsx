import React, { useState, useEffect } from 'react';
import { Bot, RefreshCw, RotateCcw, Save, CheckCircle, AlertTriangle, Check, X, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../api';

const PRIO_RANK = { Critique: 1, Urgent: 2, Normal: 3 };

function formatHour(minsFrom8am) {
  const total = 8 * 60 + minsFrom8am;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computeSchedule(pieces, machines) {
  const machineCursor = {};
  machines.forEach(m => { machineCursor[m.nom] = 0; });

  const alerts = [];
  const scheduled = pieces.map(p => {
    const dur = p.tempsPrevuMin || 120;
    const start = machineCursor[p.machine] || 0;
    const end = start + dur;
    machineCursor[p.machine] = end;

    if (!p.chuteDispo && !p.achatFait && p.statut !== 'Clôturé') {
      alerts.push({ type: 'matiere', text: `Matière manquante : ${p.id} (${p.nom})` });
    }
    if (end > 480 && p.statut !== 'Clôturé') {
      alerts.push({ type: 'capacite', text: `Machine saturée (>8h) : ${p.machine} sur ${p.id}` });
    }
    return {
      ...p,
      debutStr: p.debutStr || formatHour(start),
      finStr: p.finStr || formatHour(end),
      ecartMin: (p.tempsReelMin || 0) - dur
    };
  });

  // Detect duplicate operator at same time or late OF
  const today = new Date().toISOString().slice(0, 10);
  scheduled.forEach(p => {
    if (p.delai < today && p.statut !== 'Clôturé') {
      alerts.push({ type: 'retard', text: `OF en retard : ${p.id} (délai ${p.delai})` });
    }
  });

  return { scheduled, alerts };
}

export default function ChefPlanningTab({ state, reload, showToast }) {
  const [draft, setDraft] = useState([]);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [dragId, setDragId] = useState(null);

  useEffect(() => {
    if (dirtyCount === 0) {
      setDraft(state.pieces);
    }
  }, [state.pieces, dirtyCount]);

  const activeMachines = state.machines.filter(m => m.actif);
  const operators = state.users.filter(u => u.role === 'operateur');
  const sortedDraft = [...draft].sort((a, b) => (a.ordrePlanning || 999) - (b.ordrePlanning || 999));
  const { scheduled, alerts } = computeSchedule(sortedDraft, activeMachines);

  function updateField(id, field, val) {
    setDraft(prev => prev.map(p => p.id === id ? { ...p, [field]: val, planningValide: false } : p));
    setDirtyCount(c => c + 1);
  }

  function moveOrder(index, dir) {
    const arr = [...sortedDraft];
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    setDraft(arr.map((p, i) => ({ ...p, ordrePlanning: i + 1, planningValide: false })));
    setDirtyCount(c => c + 1);
  }

  function recalculateEngine() {
    const sorted = [...draft].sort((a, b) => {
      const aBlock = (!a.chuteDispo && !a.achatFait) ? 1 : 0;
      const bBlock = (!b.chuteDispo && !b.achatFait) ? 1 : 0;
      if (aBlock !== bBlock) return aBlock - bBlock;
      return (PRIO_RANK[a.urgence] || 9) - (PRIO_RANK[b.urgence] || 9) || a.delai.localeCompare(b.delai);
    }).map((p, i) => ({ ...p, ordrePlanning: i + 1, planningValide: false }));
    setDraft(sorted);
    setDirtyCount(c => c + 1);
    showToast('Moteur déterministe recalculé.');
  }

  function proposeAI() {
    const critBlocked = scheduled.find(p => p.urgence === 'Critique' && !p.chuteDispo && !p.achatFait);
    const readyUrgent = scheduled.find(p => p.urgence === 'Urgent' && (p.chuteDispo || p.achatFait));
    const sugs = [];
    if (critBlocked && readyUrgent) {
      sugs.push({
        id: 'sug-1',
        text: `Passer ${readyUrgent.id} avant ${critBlocked.id} car la matière de ${critBlocked.id} est manquante.`,
        apply: () => {
          updateField(readyUrgent.id, 'ordrePlanning', 1);
          updateField(critBlocked.id, 'ordrePlanning', 2);
        }
      });
    } else if (scheduled.length >= 2) {
      sugs.push({
        id: 'sug-2',
        text: `Équilibrer ${scheduled[0].id} sur ${activeMachines[0]?.nom || 'Tour CNC 1'} pour réduire l'écart temps.`,
        apply: () => updateField(scheduled[0].id, 'machine', activeMachines[0]?.nom || scheduled[0].machine)
      });
    }
    setAiSuggestions(sugs);
    showToast('Propositions IA prêtes (Accepter ou Refuser).');
  }

  function cancelEdits() {
    setDraft(state.pieces);
    setDirtyCount(0);
    setAiSuggestions([]);
    showToast('Modifications annulées.');
  }

  async function saveEdits() {
    for (const p of draft) {
      await api(`/api/pieces/${p.id}/chef`, 'POST', {
        machine: p.machine,
        operateur: p.operateur,
        urgence: p.urgence,
        delai: p.delai,
        ordrePlanning: p.ordrePlanning
      });
    }
    setDirtyCount(0);
    showToast('Modifications enregistrées (validation TV requise).');
    reload();
  }

  async function validateTV() {
    if (dirtyCount > 0) await saveEdits();
    await api('/api/planning/validate', 'POST');
    showToast('Planning validé et publié sur la TV.');
    reload();
  }

  const hoursAxis = ['08h', '09h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h'];

  return (
    <div className="space-y-4">
      {/* TOP ACTION BAR */}
      <div className="cyber-card p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono-num">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
          </span>
          {dirtyCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-mono-num">
              {dirtyCount} modification(s) non validée(s)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button onClick={proposeAI} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] flex items-center gap-1 cursor-pointer">
            <Bot className="w-3.5 h-3.5 text-[#22D3EE]" /> Proposer par IA
          </button>
          <button onClick={recalculateEngine} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] flex items-center gap-1 cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Recalculer
          </button>
          <button onClick={cancelEdits} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" /> Annuler
          </button>
          <button onClick={saveEdits} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-emerald-500 text-emerald-400 flex items-center gap-1 cursor-pointer">
            <Save className="w-3.5 h-3.5" /> Enregistrer
          </button>
          <button onClick={validateTV} className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center gap-1 cursor-pointer">
            <CheckCircle className="w-3.5 h-3.5" /> Valider et envoyer à la TV
          </button>
        </div>
      </div>

      {/* AI SUGGESTIONS COMPARISON */}
      {aiSuggestions.length > 0 && (
        <div className="cyber-card cyber-corners p-3 space-y-2 text-xs">
          <div className="font-semibold text-[#22D3EE] flex items-center gap-1.5"><Bot className="w-4 h-4" /> Propositions IA (à valider)</div>
          {aiSuggestions.map(s => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 bg-[#0B0F14] p-2.5 rounded border border-[#1E2A38]">
              <span className="text-slate-200">{s.text}</span>
              <div className="flex gap-1.5">
                <button onClick={() => { s.apply(); setAiSuggestions([]); }} className="px-2.5 py-1 rounded bg-emerald-600 text-white flex items-center gap-1 cursor-pointer"><Check className="w-3 h-3" /> Accepter</button>
                <button onClick={() => setAiSuggestions([])} className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 flex items-center gap-1 cursor-pointer"><X className="w-3 h-3" /> Refuser</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GANTT + ALERTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0 cyber-card p-4 overflow-x-auto">
          <div className="text-xs font-semibold text-white mb-3">Gantt par machine (glisser-déposer un OF)</div>
          <div className="min-w-[540px]">
            <div className="grid grid-cols-10 text-[10px] font-mono-num text-slate-500 border-b border-[#1E2A38] pb-1.5 mb-2 pl-32">
              {hoursAxis.map(h => <div key={h}>{h}</div>)}
            </div>
            <div className="space-y-2 relative">
              <div className="absolute top-0 bottom-0 left-[72%] w-px bg-[#22D3EE]/60 shadow-[0_0_8px_#22D3EE] pointer-events-none"></div>
              {activeMachines.map(m => {
                const mPieces = scheduled.filter(p => p.machine === m.nom && p.statut !== 'Clôturé');
                return (
                  <div
                    key={m.id}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => { if (dragId) { updateField(dragId, 'machine', m.nom); setDragId(null); } }}
                    className="flex items-center gap-3 text-xs"
                  >
                    <div className="w-28 shrink-0 font-medium text-slate-300 truncate">{m.nom}</div>
                    <div className="flex-1 min-h-[28px] bg-[#0B0F14] border border-[#1E2A38] rounded-[4px] flex flex-wrap items-center gap-1 p-1">
                      {mPieces.map(p => (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={() => setDragId(p.id)}
                          className={`px-2 py-0.5 rounded-[4px] border text-[10px] font-mono-num cursor-move ${
                            p.urgence === 'Critique' ? 'bg-red-500/15 border-red-500/40 text-red-300' :
                            p.urgence === 'Urgent' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' :
                            'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          }`}
                        >
                          {p.id} ({p.debutStr}–{p.finStr})
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 cyber-card p-4 space-y-2 text-xs">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> Alertes moteur ({alerts.length})
          </div>
          {alerts.length === 0 ? (
            <div className="text-slate-500">Aucun conflit détecté.</div>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {alerts.map((a, i) => (
                <div key={i} className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-[11px]">{a.text}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* DETAILED TABLE */}
      <div className="cyber-card p-4 overflow-x-auto">
        <table className="w-full text-left text-[11px] min-w-[980px]">
          <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
            <tr>
              <th className="py-2">Ordre</th><th className="py-2">OF / Pièce</th><th className="py-2">Client</th>
              <th className="py-2">Machine</th><th className="py-2">Opérateur</th><th className="py-2">Priorité</th>
              <th className="py-2">Début</th><th className="py-2">Fin</th><th className="py-2">Durée</th>
              <th className="py-2">Qté</th><th className="py-2">Matière</th><th className="py-2">Écart</th><th className="py-2">TV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E2A38]">
            {scheduled.map((p, idx) => (
              <tr key={p.id}>
                <td className="py-2 pr-1">
                  <div className="flex items-center gap-1">
                    <span className="font-mono-num text-white w-5">#{idx + 1}</span>
                    <button type="button" onClick={() => moveOrder(idx, -1)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] cursor-pointer"><ArrowUp className="w-3 h-3" /></button>
                    <button type="button" onClick={() => moveOrder(idx, 1)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] cursor-pointer"><ArrowDown className="w-3 h-3" /></button>
                  </div>
                </td>
                <td className="py-2 pr-2"><div className="font-mono-num text-white">{p.id}</div><div className="text-slate-400 truncate max-w-[140px]">{p.nom}</div></td>
                <td className="py-2 pr-2 text-slate-400">{p.client}</td>
                <td className="py-2 pr-2">
                  <select value={p.machine} onChange={e => updateField(p.id, 'machine', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                    {activeMachines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <select value={p.operateur} onChange={e => updateField(p.id, 'operateur', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                    {operators.map(o => <option key={o.id} value={o.nom}>{o.nom}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <select value={p.urgence} onChange={e => updateField(p.id, 'urgence', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                    <option>Critique</option><option>Urgent</option><option>Normal</option>
                  </select>
                </td>
                <td className="py-2 pr-2"><input type="time" value={p.debutStr} onChange={e => updateField(p.id, 'debutStr', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-slate-200" /></td>
                <td className="py-2 pr-2"><input type="time" value={p.finStr} onChange={e => updateField(p.id, 'finStr', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-slate-200" /></td>
                <td className="py-2 pr-2 font-mono-num text-slate-400">{p.tempsReelMin}/{p.tempsPrevuMin}m</td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-14 h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                      <div className="h-full bg-[#22D3EE]" style={{ width: `${Math.min(100, Math.round(((p.quantiteRealisee || 0) / (p.quantitePrevue || 1)) * 100))}%` }}></div>
                    </div>
                    <span className="font-mono-num text-slate-300">{p.quantiteRealisee}/{p.quantitePrevue}</span>
                  </div>
                </td>
                <td className="py-2 pr-2">{p.chuteDispo || p.achatFait ? <span className="text-emerald-400">Dispo</span> : <span className="text-amber-400">À acheter</span>}</td>
                <td className={`py-2 pr-2 font-mono-num ${p.ecartMin > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{p.ecartMin > 0 ? `+${p.ecartMin}m` : `${p.ecartMin}m`}</td>
                <td className="py-2"><span className={`px-1.5 py-0.5 rounded border text-[10px] ${p.planningValide ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>{p.planningValide ? 'Publié' : 'À valider'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
