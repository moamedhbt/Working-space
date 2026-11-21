import React, { useState } from 'react';
import { Bot, CheckCircle, Cpu } from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';

export default function ChefView({ state, reload }) {
  const [mNom, setMNom] = useState('');
  const [mType, setMType] = useState('');
  const [aiAlerts, setAiAlerts] = useState([]);
  const [machineLoads, setMachineLoads] = useState(null);

  async function optimizeAI() {
    const res = await api('/api/planning/optimize', 'POST');
    setAiAlerts(res.alerts || []);
    setMachineLoads(res.machineLoads || null);
    reload();
  }

  async function validatePlanning() {
    await api('/api/planning/validate', 'POST');
    alert('✅ Planning validé et publié sur la TV et les téléphones !');
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
      <div className="bg-gradient-to-r from-purple-900/30 to-cyan-900/20 border border-purple-500/40 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold flex items-center gap-2 text-purple-300"><Bot className="w-5 h-5" /> Assistant IA Chef d'Atelier</h3>
          <p className="text-xs text-slate-300 mt-1">Triez automatiquement les urgences et délais, puis validez pour publier.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={optimizeAI} className="px-3 py-2 rounded-lg bg-purple-600 text-xs font-semibold cursor-pointer">⚡ Proposer Planning IA</button>
          <button onClick={validatePlanning} className="px-3 py-2 rounded-lg bg-emerald-600 text-xs font-semibold flex items-center gap-1 cursor-pointer">
            <CheckCircle className="w-4 h-4" /> Valider & Envoyer TV
          </button>
        </div>
      </div>

      {aiAlerts.length > 0 && (
        <div className="bg-red-950/30 border border-red-500/40 rounded-xl p-3 text-xs space-y-1">
          <div className="font-bold text-red-300">⚠️ Alertes de blocage détectées par l'IA :</div>
          {aiAlerts.map((a, i) => <div key={i} className="text-slate-200">{a}</div>)}
        </div>
      )}

      {machineLoads && (
        <div className="bg-[#11192b] border border-cyan-500/20 rounded-xl p-3 text-xs">
          <div className="font-bold text-cyan-300 mb-2">📊 Charge des machines (rééquilibrage) :</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {Object.entries(machineLoads).map(([m, mins]) => (
              <div key={m} className="bg-[#060a14] p-2 rounded border border-slate-800 flex justify-between">
                <span>{m}</span>
                <strong className={mins > 300 ? 'text-amber-400' : 'text-emerald-400'}>{(mins / 60).toFixed(1)} h</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <MaterialCalculator />

      <div className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4">
        <h3 className="font-bold mb-3 flex items-center gap-2"><Cpu className="w-4 h-4 text-cyan-400" /> Panel Machines</h3>
        <div className="flex flex-wrap gap-2 mb-3 text-xs">
          <input placeholder="Nom machine" value={mNom} onChange={e => setMNom(e.target.value)} className="p-2 rounded bg-[#060a14] border border-slate-700" />
          <input placeholder="Type" value={mType} onChange={e => setMType(e.target.value)} className="p-2 rounded bg-[#060a14] border border-slate-700" />
          <button onClick={addMachine} className="px-3 py-2 rounded-lg bg-blue-600 font-semibold cursor-pointer">+ Ajouter</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {state.machines.map(m => (
            <span key={m.id} className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
              🏭 {m.nom} ({m.type})
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {state.pieces.map(p => (
          <form key={p.id} onSubmit={e => savePiece(p.id, e)} className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex justify-between font-bold text-sm">
              <span>{p.id} — {p.nom}</span>
              <span className="text-cyan-400">{p.urgence}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <select name="machine" defaultValue={p.machine} className="p-2 rounded bg-[#060a14] border border-slate-700">
                {state.machines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
              </select>
              <input name="operateur" defaultValue={p.operateur} placeholder="Opérateur" className="p-2 rounded bg-[#060a14] border border-slate-700" />
              <input name="matiere" defaultValue={p.matiere} placeholder="Matière 1ère" className="p-2 rounded bg-[#060a14] border border-slate-700" />
              <input name="outils" defaultValue={p.outils} placeholder="Outils" className="p-2 rounded bg-[#060a14] border border-slate-700" />
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" name="chuteDispo" defaultChecked={p.chuteDispo} /> ♻️ Chute disponible en stock
              </label>
              <button type="submit" className="px-3 py-2 rounded-lg bg-emerald-600 font-semibold cursor-pointer">✅ Valider & Planifier</button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
