import React, { useState, useEffect } from 'react';
import {
  Bot, RefreshCw, RotateCcw, Save, CheckCircle, AlertTriangle, Check, X,
  ArrowUp, ArrowDown, CalendarDays
} from 'lucide-react';
import { api } from '../api';

const PRIO_RANK = { Critique: 1, Urgent: 2, Normal: 3 };
const DAY_LABELS = [
  [0, 'Dim'], [1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam']
];

function formatHour(minsFrom8am) {
  const total = 8 * 60 + minsFrom8am;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nowLinePercent() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = 8 * 60;
  const end = 17 * 60;
  return Math.max(0, Math.min(100, ((mins - start) / (end - start)) * 100));
}

function computeLocalSchedule(pieces, machines) {
  const machineCursor = {};
  machines.forEach(m => { machineCursor[m.id] = 0; });

  return pieces.map(p => {
    const dur = p.tempsPrevuMin || 120;
    const key = p.machineId || p.machine;
    const start = machineCursor[key] || 0;
    const end = start + dur;
    machineCursor[key] = end;
    return {
      ...p,
      debutStr: p.debutStr || formatHour(start),
      finStr: p.finStr || formatHour(end),
      ecartMin: (p.tempsReelMin || 0) - dur
    };
  });
}

export default function ChefPlanningTab({ state, reload, showToast }) {
  const [draft, setDraft] = useState([]);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [dismissedAiIds, setDismissedAiIds] = useState(new Set());
  const [dragId, setDragId] = useState(null);
  const [ganttMode, setGanttMode] = useState('jour');
  const [showCalendarCfg, setShowCalendarCfg] = useState(false);
  const [calForm, setCalForm] = useState({
    workDays: [0, 1, 2, 3, 4],
    shiftStart: '08:00',
    shiftEnd: '17:00'
  });

  useEffect(() => {
    if (dirtyIds.size === 0) {
      setDraft(state.pieces.filter(p => !p.archived));
    }
  }, [state.pieces, dirtyIds.size]);

  useEffect(() => {
    if (state.settings) {
      setCalForm({
        workDays: state.settings.workDays || [0, 1, 2, 3, 4],
        shiftStart: state.settings.shiftStart || '08:00',
        shiftEnd: state.settings.shiftEnd || '17:00'
      });
    }
  }, [state.settings]);

  const activeMachines = state.machines.filter(m => m.actif);
  const operators = state.users.filter(u => u.role === 'operateur' && u.actif !== 0);
  const sortedDraft = [...draft].sort((a, b) => (a.ordrePlanning || 999) - (b.ordrePlanning || 999));
  const scheduled = computeLocalSchedule(sortedDraft, activeMachines);
  const serverConflicts = state.conflicts || [];
  const aiSuggestions = (state.aiRecommendations || []).filter(r => !dismissedAiIds.has(r.id));

  function markDirty(ids) {
    setDirtyIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
  }

  function updateField(id, field, val) {
    setDraft(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: val, planningValide: false };
      if (field === 'machineId') {
        const m = activeMachines.find(x => x.id === val);
        if (m) updated.machine = m.nom;
      }
      if (field === 'operateurId') {
        const o = operators.find(x => x.id === val);
        if (o) updated.operateur = o.nom;
      }
      return updated;
    }));
    markDirty([id]);
  }

  function moveOrder(index, dir) {
    const arr = [...sortedDraft];
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    const reordered = arr.map((p, i) => ({ ...p, ordrePlanning: i + 1, planningValide: false }));
    setDraft(reordered);
    markDirty(reordered.map(p => p.id));
  }

  async function runServerOptimizeAI() {
    try {
      const res = await api('/api/planning/optimize', 'POST');
      setDirtyIds(new Set());
      setDismissedAiIds(new Set());
      showToast(`Planning IA recalculé (gammes + jours ouvrés) · ${res.conflicts?.length || 0} alerte(s).`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function applyAiRecommendation(rec) {
    try {
      await api('/api/planning/ai-apply', 'POST', { actionType: rec.actionType, payload: rec.payload });
      setDirtyIds(new Set());
      showToast(`Recommandation IA appliquée : ${rec.title}`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  function recalculateLocal() {
    const sorted = [...draft].sort((a, b) => {
      const aBlock = (!a.chuteDispo && !a.achatFait) ? 1 : 0;
      const bBlock = (!b.chuteDispo && !b.achatFait) ? 1 : 0;
      if (aBlock !== bBlock) return aBlock - bBlock;
      return (PRIO_RANK[a.urgence] || 9) - (PRIO_RANK[b.urgence] || 9) || (a.delai || '').localeCompare(b.delai || '');
    }).map((p, i) => ({ ...p, ordrePlanning: i + 1, planningValide: false }));
    setDraft(sorted);
    markDirty(sorted.map(p => p.id));
    showToast('Ordre recalculé (cliquez sur Enregistrer ou Valider TV).');
  }

  function cancelEdits() {
    setDraft(state.pieces.filter(p => !p.archived));
    setDirtyIds(new Set());
    showToast('Modifications annulées.');
  }

  async function saveEdits() {
    if (dirtyIds.size === 0) {
      showToast('Aucune modification à enregistrer.');
      return true;
    }
    try {
      const items = scheduled
        .filter(p => dirtyIds.has(p.id))
        .map(p => ({
          id: p.id,
          machineId: p.machineId,
          operateurId: p.operateurId,
          urgence: p.urgence,
          delai: p.delai,
          ordrePlanning: p.ordrePlanning,
          debutStr: p.debutStr,
          finStr: p.finStr
        }));
      await api('/api/planning/save-batch', 'POST', { items });
      setDirtyIds(new Set());
      showToast(`${items.length} OF enregistré(s) (validation TV requise).`);
      reload();
      return true;
    } catch (e) {
      showToast(e.message, 'err');
      return false;
    }
  }

  async function validateTV() {
    try {
      if (dirtyIds.size > 0) {
        const ok = await saveEdits();
        if (!ok) return;
      }
      await api('/api/planning/validate', 'POST');
      showToast('Planning validé et publié sur la TV.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  function toggleWorkDay(dayNum) {
    setCalForm(prev => {
      const exists = prev.workDays.includes(dayNum);
      const next = exists ? prev.workDays.filter(d => d !== dayNum) : [...prev.workDays, dayNum].sort();
      return { ...prev, workDays: next };
    });
  }

  async function saveCalendarSettings() {
    try {
      await api('/api/settings', 'PUT', calForm);
      setShowCalendarCfg(false);
      showToast('Calendrier atelier sauvegardé.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  const hoursAxis = ['08h', '09h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h'];
  const nowPct = nowLinePercent();
  const workDaysSet = new Set(calForm.workDays);

  return (
    <div className="space-y-4">
      {/* TOP ACTION BAR */}
      <div className="cyber-card p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono-num">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
          </span>
          <button
            type="button"
            onClick={() => setShowCalendarCfg(!showCalendarCfg)}
            className="px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-[11px] text-slate-300 flex items-center gap-1 cursor-pointer"
          >
            <CalendarDays className="w-3.5 h-3.5 text-[#22D3EE]" />
            {DAY_LABELS.filter(([d]) => workDaysSet.has(d)).map(([, lbl]) => lbl).join('-')} · {calForm.shiftStart}–{calForm.shiftEnd}
          </button>
          {dirtyIds.size > 0 && (
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-mono-num">
              {dirtyIds.size} OF modifié(s)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button onClick={runServerOptimizeAI} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#22D3EE]/50 hover:border-[#22D3EE] text-[#22D3EE] flex items-center gap-1 cursor-pointer">
            <Bot className="w-3.5 h-3.5" /> Optimiser par IA
          </button>
          <button onClick={recalculateLocal} className="px-2.5 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] flex items-center gap-1 cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Trier
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

      {/* WORKSHOP CALENDAR CONFIG */}
      {showCalendarCfg && (
        <div className="cyber-card p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-medium">Jours ouvrés :</span>
            {DAY_LABELS.map(([num, lbl]) => (
              <button
                key={num}
                type="button"
                onClick={() => toggleWorkDay(num)}
                className={`px-2 py-1 rounded border text-[11px] cursor-pointer ${
                  workDaysSet.has(num) ? 'bg-[#22D3EE]/15 border-[#22D3EE] text-[#22D3EE]' : 'bg-[#0B0F14] border-[#1E2A38] text-slate-500'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Horaires :</span>
            <input type="time" value={calForm.shiftStart} onChange={e => setCalForm({ ...calForm, shiftStart: e.target.value })} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
            <span>→</span>
            <input type="time" value={calForm.shiftEnd} onChange={e => setCalForm({ ...calForm, shiftEnd: e.target.value })} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
            <button type="button" onClick={saveCalendarSettings} className="px-3 py-1.5 rounded bg-emerald-600 text-white font-semibold cursor-pointer">Enregistrer</button>
          </div>
        </div>
      )}

      {/* LIVE IA RECOMMENDATIONS */}
      {aiSuggestions.length > 0 && (
        <div className="cyber-card cyber-corners p-3 space-y-2 text-xs">
          <div className="font-semibold text-[#22D3EE] flex items-center gap-1.5">
            <Bot className="w-4 h-4" /> Recommandations IA d'ordonnancement ({aiSuggestions.length})
          </div>
          {aiSuggestions.map(s => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 bg-[#0B0F14] p-2.5 rounded border border-[#1E2A38]">
              <div>
                <div className={`font-semibold ${s.severity === 'high' ? 'text-red-300' : s.severity === 'medium' ? 'text-amber-300' : 'text-white'}`}>{s.title}</div>
                <div className="text-slate-400 text-[11px]">{s.reason}</div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => applyAiRecommendation(s)} className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1 cursor-pointer"><Check className="w-3 h-3" /> Accepter</button>
                <button onClick={() => setDismissedAiIds(prev => new Set(prev).add(s.id))} className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 flex items-center gap-1 cursor-pointer"><X className="w-3 h-3" /> Ignorer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GANTT + REAL CONSTRAINTS / CONFLICTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0 cyber-card p-4 overflow-x-auto">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-xs font-semibold text-white">Gantt par machine (glisser-déposer un OF)</div>
            <div className="flex bg-[#0B0F14] border border-[#1E2A38] rounded-[4px] p-0.5 text-[10px]">
              <button type="button" onClick={() => setGanttMode('jour')} className={`px-2 py-0.5 rounded cursor-pointer ${ganttMode === 'jour' ? 'bg-[#22D3EE] text-[#0B0F14] font-semibold' : 'text-slate-400'}`}>Jour</button>
              <button type="button" onClick={() => setGanttMode('semaines')} className={`px-2 py-0.5 rounded cursor-pointer ${ganttMode === 'semaines' ? 'bg-[#22D3EE] text-[#0B0F14] font-semibold' : 'text-slate-400'}`}>2 Semaines (Ouvrés)</button>
            </div>
          </div>

          {ganttMode === 'jour' ? (
            <div className="min-w-[540px]">
              <div className="grid grid-cols-10 text-[10px] font-mono-num text-slate-500 border-b border-[#1E2A38] pb-1.5 mb-2 pl-32">
                {hoursAxis.map(h => <div key={h}>{h}</div>)}
              </div>
              <div className="space-y-2 relative">
                {nowPct > 0 && nowPct < 100 && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-[#22D3EE]/70 shadow-[0_0_8px_#22D3EE] pointer-events-none"
                    style={{ left: `calc(8rem + (100% - 8rem) * ${nowPct / 100})` }}
                  ></div>
                )}
                {activeMachines.map(m => {
                  const mPieces = scheduled.filter(p => p.machineId === m.id && p.statut !== 'Clôturé');
                  return (
                    <div
                      key={m.id}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => { if (dragId) { updateField(dragId, 'machineId', m.id); setDragId(null); } }}
                      className="flex items-center gap-3 text-xs"
                    >
                      <div className="w-28 shrink-0 font-medium text-slate-300 truncate flex items-center gap-1">
                        <span className="truncate">{m.nom}</span>
                        {m.enPanne ? <span className="text-[9px] text-red-400 font-bold">PANNE</span> : null}
                      </div>
                      <div className={`flex-1 min-h-[30px] bg-[#0B0F14] border rounded-[4px] flex flex-wrap items-center gap-1 p-1 ${m.enPanne ? 'border-red-500/40' : 'border-[#1E2A38]'}`}>
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
          ) : (
            <div className="min-w-[700px] space-y-2">
              <div className="grid grid-cols-14 gap-1 text-[9px] font-mono-num text-slate-500 border-b border-[#1E2A38] pb-1 pl-28">
                {Array.from({ length: 14 }, (_, i) => {
                  const d = new Date(Date.now() + i * 86400000);
                  const isOff = !workDaysSet.has(d.getDay());
                  return (
                    <div key={i} className={`text-center ${isOff ? 'text-slate-600 line-through' : ''}`}>
                      {d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                    </div>
                  );
                })}
              </div>
              {activeMachines.map(m => {
                const mPieces = scheduled.filter(p => p.machineId === m.id && p.statut !== 'Clôturé');
                return (
                  <div key={m.id} className="flex items-center gap-2 text-xs">
                    <div className="w-28 shrink-0 font-medium text-slate-300 truncate">{m.nom}</div>
                    <div className="flex-1 grid grid-cols-14 gap-1">
                      {Array.from({ length: 14 }, (_, i) => {
                        const d = new Date(Date.now() + i * 86400000);
                        const dStr = d.toISOString().slice(0, 10);
                        const isOff = !workDaysSet.has(d.getDay());
                        const dayPieces = mPieces.filter(p => {
                          const plannedDate = p.operations?.find(o => o.machineId === m.id && o.datePlanifiee)?.datePlanifiee || p.delai;
                          return plannedDate === dStr || (i === 0 && plannedDate && plannedDate < dStr);
                        });
                        return (
                          <div key={i} className={`min-h-[26px] border rounded-[3px] p-0.5 flex flex-col gap-0.5 ${isOff ? 'bg-[#070A0E] border-[#151E29]' : 'bg-[#0B0F14] border-[#1E2A38]'}`}>
                            {dayPieces.map(p => (
                              <div key={p.id} title={`${p.id} (${p.debutStr}-${p.finStr})`} className={`text-[8px] font-mono-num px-1 rounded truncate ${
                                p.urgence === 'Critique' ? 'bg-red-500/20 text-red-300' :
                                p.urgence === 'Urgent' ? 'bg-amber-500/20 text-amber-300' :
                                'bg-emerald-500/20 text-emerald-300'
                              }`}>{p.id.slice(-4)}</div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 cyber-card p-4 space-y-2 text-xs">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> Contraintes & conflits ({serverConflicts.length})
          </div>
          {serverConflicts.length === 0 ? (
            <div className="text-emerald-400 text-[11px]">Aucun conflit opérateur, gamme ou machine détecté.</div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {serverConflicts.map((c, i) => (
                <div
                  key={i}
                  className={`p-2 rounded border text-[11px] ${
                    c.severity === 'high'
                      ? 'bg-red-500/10 border-red-500/30 text-red-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}
                >
                  {c.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* DETAILED TABLE */}
      <div className="cyber-card p-4 overflow-x-auto">
        <table className="w-full text-left text-[11px] min-w-[1060px]">
          <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
            <tr>
              <th className="py-2">Ordre</th><th className="py-2">OF / Pièce</th><th className="py-2">Client</th>
              <th className="py-2">Machine</th><th className="py-2">Opérateur</th><th className="py-2">Priorité</th>
              <th className="py-2">Début</th><th className="py-2">Fin</th><th className="py-2">Régl. / Durée</th>
              <th className="py-2">Qté / Ops</th><th className="py-2">Matière</th><th className="py-2">Écart</th><th className="py-2">TV</th>
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
                  <select value={p.machineId || ''} onChange={e => updateField(p.id, 'machineId', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                    {activeMachines.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <select value={p.operateurId || ''} onChange={e => updateField(p.id, 'operateurId', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                    {operators.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <select value={p.urgence} onChange={e => updateField(p.id, 'urgence', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38]">
                    <option>Critique</option><option>Urgent</option><option>Normal</option>
                  </select>
                </td>
                <td className="py-2 pr-2"><input type="time" value={p.debutStr} onChange={e => updateField(p.id, 'debutStr', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-slate-200" /></td>
                <td className="py-2 pr-2"><input type="time" value={p.finStr} onChange={e => updateField(p.id, 'finStr', e.target.value)} className="p-1 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-slate-200" /></td>
                <td className="py-2 pr-2 font-mono-num text-slate-400">
                  <div className="text-[10px] text-[#22D3EE]">Régl. {p.totalReglageMin || 0}m</div>
                  <div>{p.tempsReelMin}/{p.tempsPrevuMin}m</div>
                </td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                      <div className="h-full bg-[#22D3EE]" style={{ width: `${p.progressPct ?? 0}%` }}></div>
                    </div>
                    <span className="font-mono-num text-slate-300">{p.quantiteRealisee}/{p.quantitePrevue}</span>
                    <span className="text-[9px] text-[#22D3EE] font-mono-num">({p.opsTerminees}/{p.opsTotal})</span>
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
