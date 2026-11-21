import React, { useState } from 'react';
import { Bot, CheckCircle, Cpu, Plus, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';

export default function ChefView({ state, reload }) {
  const [mNom, setMNom] = useState('');
  const [mType, setMType] = useState('');
  const [aiAlerts, setAiAlerts] = useState([]);

  async function optimizeAI() {
    const res = await api('/api/planning/optimize', 'POST');
    setAiAlerts(res.alerts || []);
    reload();
  }

  async function validatePlanning() {
    await api('/api/planning/validate', 'POST');
    reload();
  }

  async function addMachine() {
    if (!mNom.trim()) return;
    await api('/api/machines', 'POST', { nom: mNom, type: mType || 'Usinage' });
    setMNom('');
    setMType('');
    reload();
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
    reload();
  }

  return (
    <div className="space-y-5">
      {/* AI BANNER */}
      <div className="cyber-card cyber-corners p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Bot className="w-5 h-5 text-[#22D3EE] shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-white">Assistant IA chef d'atelier</h2>
            <p className="text-xs text-slate-400">Trie automatiquement les urgences et les délais, puis vous validez pour publier sur l'écran TV.</p>
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
          <div className="font-semibold text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Alertes de blocage détectées</div>
          {aiAlerts.map((a, i) => <div key={i} className="text-slate-300">{a}</div>)}
        </div>
      )}

      {/* MACHINE CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {state.machines.map(m => {
          const mPieces = state.pieces.filter(p => p.machine === m.nom && p.statut !== 'Clôturé');
          const hours = mPieces.reduce((s, p) => s + (p.tempsPrevuMin || 120), 0) / 60;
          const pct = Math.min(100, Math.round((hours / 8) * 100));
          const activeP = mPieces[0];
          return (
            <div key={m.id} className="cyber-card p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-white">{m.nom}</span>
                <span className="px-2 py-0.5 rounded-[4px] border border-[#1E2A38] bg-[#0B0F14] text-[10px] text-[#22D3EE]">
                  {activeP ? activeP.statut : 'Disponible'}
                </span>
              </div>
              <div className="text-xs text-slate-400">{m.type} · {activeP ? activeP.operateur : '—'}</div>
              <div className="w-full h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                <div className="h-full bg-[#22D3EE]" style={{ width: `${pct}%` }}></div>
              </div>
              <div className="text-[11px] font-mono-num text-slate-400">{hours.toFixed(1)} h / 8 h planifiées</div>
            </div>
          );
        })}
      </div>

      {/* MAIN GRID: ORDERS LEFT + CALCULATOR & ADD MACHINE RIGHT */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ordres de fabrication à planifier</div>
          {state.pieces.map(p => (
            <form key={p.id} onSubmit={e => savePiece(p.id, e)} className="cyber-card p-4 text-xs space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm text-white font-mono-num">{p.id} · <span className="font-sans">{p.nom}</span></span>
                <span className={`px-2 py-0.5 rounded-[4px] border text-[10px] ${
                  p.urgence === 'Critique' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                  p.urgence === 'Urgent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                  'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                }`}>{p.urgence}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500">Machine</label>
                  <select name="machine" defaultValue={p.machine} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
                    {state.machines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Opérateur</label>
                  <input name="operateur" defaultValue={p.operateur} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Matière</label>
                  <input name="matiere" defaultValue={p.matiere} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Outillage</label>
                  <input name="outils" defaultValue={p.outils} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                </div>
              </div>
              <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input type="checkbox" name="chuteDispo" defaultChecked={p.chuteDispo} className="accent-[#22D3EE]" /> Chute disponible en stock
                </label>
                <button type="submit" className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] font-semibold cursor-pointer">
                  Valider et planifier
                </button>
              </div>
            </form>
          ))}
        </div>

        <div className="space-y-4">
          <MaterialCalculator />

          <div className="cyber-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Cpu className="w-4 h-4 text-[#22D3EE]" /> Ajouter une machine
            </div>
            <div className="space-y-2 text-xs">
              <input placeholder="Nom machine (ex: Tour CNC 3)" value={mNom} onChange={e => setMNom(e.target.value)} className="w-full p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <input placeholder="Type (ex: Tournage CNC)" value={mType} onChange={e => setMType(e.target.value)} className="w-full p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <button onClick={addMachine} className="w-full py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Ajouter machine
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
