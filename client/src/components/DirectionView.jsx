import React, { useState } from 'react';
import {
  Bot, CheckCircle, Plus, FolderCheck, UserPlus, ShoppingCart,
  FileText, FileSpreadsheet, Archive, Download
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { api } from '../api';

function Sparkline({ color = '#22D3EE' }) {
  return (
    <svg width="64" height="22" viewBox="0 0 64 22" className="opacity-80">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points="2,18 14,14 26,16 38,9 50,11 62,4"
      />
    </svg>
  );
}

function statusBadge(statut, urgence) {
  if (urgence === 'Critique') return 'bg-red-500/10 text-red-400 border-red-500/30';
  if (statut === 'À acheter' || urgence === 'Urgent') return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
}

export default function DirectionView({ state, reload, activePanel = 'overview', search = '' }) {
  const [newUser, setNewUser] = useState({ nom: '', username: '', password: '', role: 'operateur' });
  const [sim, setSim] = useState({ nom: '', quantite: 20, delai: '2026-11-26', machine: 'Tour CNC 1', matiereDispo: true, delaiFournisseurJours: 0, tempsParPieceMin: 0 });
  const [simResult, setSimResult] = useState(null);
  const [prices, setPrices] = useState({});

  const filteredPieces = state.pieces.filter(p =>
    !search || p.id.toLowerCase().includes(search.toLowerCase()) || p.nom.toLowerCase().includes(search.toLowerCase())
  );

  const enCours = state.pieces.filter(p => p.statut === 'En cours').length;
  const aAcheter = state.pieces.filter(p => p.statut === 'À acheter').length;
  const clotures = state.pieces.filter(p => p.statut === 'Clôturé').length;
  const critiques = state.pieces.filter(p => p.urgence === 'Critique').length;

  function proposePriceAI(p) {
    const hours = (p.tempsReelMin || p.tempsPrevuMin || 120) / 60;
    const machineCost = Math.round(hours * 2500);
    const matCost = p.chuteDispo ? 1500 : 6000;
    setPrices(prev => ({ ...prev, [p.id]: Math.round((machineCost + matCost) * 1.3) }));
  }

  async function runSimulation() {
    setSimResult(await api('/api/planning/simulate', 'POST', sim));
  }

  async function validateSimulation() {
    if (!sim.nom.trim()) return alert('Entrez le nom de la pièce');
    await api('/api/pieces', 'POST', { nom: sim.nom, client: 'Commande Simulée', quantitePrevue: sim.quantite, delai: sim.delai, urgence: 'Urgent' });
    setSimResult(null);
    setSim({ nom: '', quantite: 20, delai: '2026-11-26', machine: 'Tour CNC 1', matiereDispo: true, delaiFournisseurJours: 0, tempsParPieceMin: 0 });
    reload();
  }

  async function addPiece() {
    const nom = prompt('Nom de la pièce :');
    if (!nom) return;
    const client = prompt('Client :', 'Client Standard');
    const quantitePrevue = prompt('Quantité :', '10');
    const urgence = prompt('Urgence (Critique / Urgent / Normal) :', 'Urgent');
    await api('/api/pieces', 'POST', { nom, client, quantitePrevue, urgence });
    reload();
  }

  async function validateAll() {
    await api('/api/planning/validate', 'POST');
    reload();
  }

  async function createUser() {
    try {
      await api('/api/users', 'POST', newUser);
      setNewUser({ nom: '', username: '', password: '', role: 'operateur' });
      reload();
    } catch (e) {
      alert(e.message);
    }
  }

  function exportPDF() {
    const doc = new jsPDF('landscape');
    doc.setFontSize(14);
    doc.text('ATELIER MANAGER — PLANNING & RAPPORT', 14, 16);
    autoTable(doc, {
      startY: 24,
      head: [['Ordre', 'OF', 'Piece', 'Client', 'Machine', 'Operateur', 'Delai', 'Urgence', 'Statut', 'Qte']],
      body: state.pieces.map((p, i) => [
        `#${p.ordrePlanning || i + 1}`, p.id, p.nom, p.client, p.machine, p.operateur, p.delai, p.urgence, p.statut, `${p.quantiteRealisee}/${p.quantitePrevue}`
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [34, 211, 238], textColor: [11, 15, 20] }
    });
    doc.save(`Planning_Atelier_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  function exportExcel() {
    const headers = ['Ordre', 'OF', 'Piece', 'Client', 'Machine', 'Operateur', 'Delai', 'Urgence', 'Statut', 'Qte Realisee', 'Qte Prevue'];
    const rows = state.pieces.map((p, i) => [
      p.ordrePlanning || i + 1, p.id, p.nom, p.client, p.machine, p.operateur, p.delai, p.urgence, p.statut, p.quantiteRealisee, p.quantitePrevue
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `Planning_Atelier_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function downloadPieceZip(p) {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`DOSSIER PIECE : ${p.id}`, 14, 18);
    autoTable(doc, {
      startY: 26,
      head: [['Champ', 'Detail']],
      body: [
        ['Piece / Client', `${p.nom} — ${p.client}`],
        ['Statut', p.statut],
        ['Urgence / Delai', `${p.urgence} — ${p.delai}`],
        ['Machine / Operateur', `${p.machine} — ${p.operateur}`],
        ['Quantite', `${p.quantiteRealisee} / ${p.quantitePrevue}`],
        ['Temps (Reel / Prevu)', `${p.tempsReelMin} min / ${p.tempsPrevuMin} min`],
        ['Matiere', p.matiere],
        ['Outillage', p.outils || '—'],
        ['BE (Fichier / Prog / 3D)', `${p.be.nomFichier || '—'} / ${p.be.programme || '—'} / ${p.be.dessin3d || '—'}`]
      ],
      headStyles: { fillColor: [34, 211, 238], textColor: [11, 15, 20] }
    });
    const zip = new JSZip();
    zip.file(`Fiche_${p.id}.pdf`, doc.output('blob'));
    zip.file(`BE_${p.id}_infos.txt`, `Fichier: ${p.be.nomFichier}\nProgramme: ${p.be.programme}\nDessin 3D: ${p.be.dessin3d}\n`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
    a.download = `${p.id}_Dossier_Complet.zip`;
    a.click();
  }

  const hoursAxis = ['08h', '09h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h'];

  return (
    <div className="space-y-5">
      {activePanel === 'overview' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-white">Vue d'ensemble de l'atelier</h1>
              <p className="text-xs text-slate-400">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {state.machines.length} machines actives</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportPDF} className="px-3 py-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] hover:border-slate-600 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer">
                <Download className="w-3.5 h-3.5" /> Exporter
              </button>
              <button onClick={addPiece} className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Nouvelle pièce
              </button>
            </div>
          </div>

          {/* 4 KPI CARDS */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['TOTAL DOSSIERS', state.pieces.length, '#22D3EE'],
              ['EN FABRICATION', enCours, '#22D3EE'],
              ['ACHATS EN ATTENTE', aAcheter, '#F59E0B'],
              ['CLÔTURÉS', clotures, '#10B981']
            ].map(([lbl, val, col]) => (
              <div key={lbl} className="cyber-card cyber-corners p-4 flex items-end justify-between">
                <div>
                  <div className="text-[10px] font-semibold tracking-wider text-slate-400">{lbl}</div>
                  <div className="text-2xl font-bold font-mono-num mt-1" style={{ color: col === '#22D3EE' && lbl === 'TOTAL DOSSIERS' ? '#F8FAFC' : col }}>{val}</div>
                </div>
                <Sparkline color={col} />
              </div>
            ))}
          </div>

          {/* GANTT + AI SYNTHESIS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 min-w-0 cyber-card p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Planning par machine</h2>
                <span className="flex items-center gap-1.5 text-[10px] font-mono-num text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
                </span>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[540px]">
                  <div className="grid grid-cols-10 text-[10px] font-mono-num text-slate-500 border-b border-[#1E2A38] pb-1.5 mb-2 pl-32">
                    {hoursAxis.map(h => <div key={h}>{h}</div>)}
                  </div>
                  <div className="space-y-2.5 relative">
                    <div className="absolute top-0 bottom-0 left-[72%] w-px bg-[#22D3EE]/60 shadow-[0_0_8px_#22D3EE] pointer-events-none"></div>
                    {state.machines.map(m => {
                      const p = state.pieces.find(x => x.machine === m.nom && x.statut !== 'Clôturé');
                      return (
                        <div key={m.id} className="flex items-center gap-3 text-xs">
                          <div className="w-28 shrink-0">
                            <div className="font-medium text-slate-200 truncate">{m.nom}</div>
                            <div className="text-[10px] text-slate-500 truncate">{p ? p.operateur : 'Disponible'}</div>
                          </div>
                          <div className="flex-1 h-7 bg-[#0B0F14] border border-[#1E2A38] rounded-[4px] relative flex items-center px-2">
                            {p && (
                              <div className={`px-2.5 py-0.5 rounded-[4px] border text-[11px] font-mono-num truncate ${statusBadge(p.statut, p.urgence)}`}>
                                {p.id} · {Math.round((p.tempsPrevuMin || 120) / 60 * 10) / 10}h
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-w-0 cyber-card cyber-corners p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#22D3EE]" /> Synthèse IA Direction
                  </h2>
                </div>
                <span className="inline-block px-2 py-0.5 rounded bg-[#22D3EE]/10 border border-[#22D3EE]/30 text-[#22D3EE] text-[10px] font-mono-num">
                  {enCours} en fabrication
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {aAcheter} ordre(s) bloqué(s) en attente d'approvisionnement matière. {clotures} dossier(s) clôturé(s).
                </p>
                {critiques > 0 && (
                  <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
                    {critiques} pièce(s) critique(s) : suivi prioritaire requis.
                  </div>
                )}
              </div>
              <button onClick={validateAll} className="w-full py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-xs font-medium text-slate-200 cursor-pointer">
                Valider & Publier Planning
              </button>
            </div>
          </div>

          {/* ORDERS TABLE */}
          <div className="cyber-card p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Ordres de fabrication</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[680px]">
                <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
                  <tr>
                    <th className="py-2 pr-3">OF</th>
                    <th className="py-2 pr-3">Pièce</th>
                    <th className="py-2 pr-3">Machine</th>
                    <th className="py-2 pr-3">Avancement</th>
                    <th className="py-2 pr-3">Temps</th>
                    <th className="py-2">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2A38]">
                  {filteredPieces.map(p => {
                    const pct = Math.min(100, Math.round(((p.quantiteRealisee || 0) / (p.quantitePrevue || 1)) * 100));
                    return (
                      <tr key={p.id} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 pr-3 font-mono-num text-slate-200">{p.id}</td>
                        <td className="py-2.5 pr-3 text-slate-200">{p.nom}</td>
                        <td className="py-2.5 pr-3 text-slate-400">{p.machine}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                              <div className="h-full bg-[#22D3EE]" style={{ width: `${pct}%` }}></div>
                            </div>
                            <span className="font-mono-num text-[11px] text-slate-400">{p.quantiteRealisee}/{p.quantitePrevue}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 font-mono-num text-slate-400">{p.tempsReelMin} / {p.tempsPrevuMin} min</td>
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 rounded-[4px] border text-[11px] font-medium ${statusBadge(p.statut, p.urgence)}`}>
                            {p.urgence} · {p.statut}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activePanel === 'planning' && (
        <div className="cyber-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Tableau de Planning Général</h2>
            <div className="flex flex-wrap gap-2">
              <button onClick={exportPDF} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-xs flex items-center gap-1.5 cursor-pointer"><FileText className="w-3.5 h-3.5" /> PDF</button>
              <button onClick={exportExcel} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-xs flex items-center gap-1.5 cursor-pointer"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
              <button onClick={validateAll} className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] font-semibold text-xs flex items-center gap-1.5 cursor-pointer"><CheckCircle className="w-3.5 h-3.5" /> Valider TV</button>
            </div>
          </div>
          <div className="md:hidden space-y-2.5">
            {filteredPieces.map((p, i) => (
              <div key={p.id} className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-num font-semibold text-white">#{p.ordrePlanning || i + 1} · {p.id}</span>
                  <span className={`px-2 py-0.5 rounded-[4px] border text-[11px] whitespace-nowrap ${statusBadge(p.statut, p.urgence)}`}>{p.statut}</span>
                </div>
                <div className="text-slate-200 font-medium">{p.nom}</div>
                <div className="text-slate-400">{p.machine} · {p.operateur} · {p.delai}</div>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
                <tr><th className="py-2">Ordre</th><th className="py-2">OF</th><th className="py-2">Pièce</th><th className="py-2">Machine</th><th className="py-2">Opérateur</th><th className="py-2">Délai</th><th className="py-2">Statut</th></tr>
              </thead>
              <tbody className="divide-y divide-[#1E2A38]">
                {filteredPieces.map((p, i) => (
                  <tr key={p.id}>
                    <td className="py-2.5 font-mono-num">#{p.ordrePlanning || i + 1}</td>
                    <td className="py-2.5 font-mono-num">{p.id}</td>
                    <td className="py-2.5">{p.nom}</td>
                    <td className="py-2.5 text-slate-400">{p.machine}</td>
                    <td className="py-2.5 text-slate-400">{p.operateur}</td>
                    <td className="py-2.5 font-mono-num">{p.delai}</td>
                    <td className="py-2.5"><span className={`px-2 py-0.5 rounded-[4px] border text-[11px] ${statusBadge(p.statut, p.urgence)}`}>{p.statut}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activePanel === 'simulator' && (
        <div className="cyber-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Simulateur de Décision (What-If)</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <input placeholder="Nom pièce" value={sim.nom} onChange={e => setSim({ ...sim, nom: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <input type="number" placeholder="Quantité" value={sim.quantite} onChange={e => setSim({ ...sim, quantite: +e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <select value={sim.machine} onChange={e => setSim({ ...sim, machine: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
              {state.machines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
            </select>
            <input type="number" placeholder="Minutes / pièce" value={sim.tempsParPieceMin || ''} onChange={e => setSim({ ...sim, tempsParPieceMin: +e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
            <label className="flex items-center gap-2 px-2 cursor-pointer"><input type="checkbox" checked={sim.matiereDispo} onChange={e => setSim({ ...sim, matiereDispo: e.target.checked })} /> Matière dispo DZ</label>
            {!sim.matiereDispo && <input type="number" placeholder="Délai fournisseur (j)" value={sim.delaiFournisseurJours || ''} onChange={e => setSim({ ...sim, delaiFournisseurJours: +e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />}
          </div>
          <div className="flex gap-2">
            <button onClick={runSimulation} className="px-4 py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold cursor-pointer">Simuler l'impact</button>
            {simResult && <button onClick={validateSimulation} className="px-4 py-2 rounded-[6px] bg-emerald-600 text-white text-xs font-medium cursor-pointer">Valider & Créer</button>}
          </div>
          {simResult && (
            <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 text-xs space-y-1">
              {simResult.missing.length > 0 && <div className="text-amber-400">Infos manquantes : {simResult.missing.join(' | ')}</div>}
              <div>Charge {sim.machine} : {simResult.currentLoadHours}h + {simResult.newLoadHours}h = <strong className="font-mono-num">{simResult.totalHours}h</strong></div>
              <div className="font-semibold text-[#22D3EE]">{simResult.verdict}</div>
            </div>
          )}
        </div>
      )}

      {activePanel === 'dossiers' && (
        <div className="space-y-3">
          {filteredPieces.map(p => (
            <div key={p.id} className="cyber-card p-4 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-sm">
                <span className="font-mono-num">{p.id} — <span className="font-sans">{p.nom}</span></span>
                <span className={`px-2 py-0.5 rounded-[4px] border text-[11px] whitespace-nowrap ${statusBadge(p.statut, p.urgence)}`}>{p.statut}</span>
              </div>
              <div className="text-slate-400">BE: {p.be.nomFichier || '—'} | Prog: {p.be.programme || '—'} | 3D: {p.be.dessin3d || '—'}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => downloadPieceZip(p)} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] flex items-center gap-1.5 cursor-pointer"><Archive className="w-3.5 h-3.5" /> Dossier .ZIP</button>
                {p.statut === 'À acheter' && <button onClick={async () => { await api(`/api/pieces/${p.id}/buy`, 'POST'); reload(); }} className="px-3 py-1.5 rounded-[6px] bg-amber-600 text-white flex items-center gap-1.5 cursor-pointer"><ShoppingCart className="w-3.5 h-3.5" /> Valider Achat</button>}
                {p.statut === 'À clôturer' && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <button onClick={() => proposePriceAI(p)} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] cursor-pointer">Calculer Prix IA</button>
                    <input type="number" placeholder="Prix final (DZD)" value={prices[p.id] || ''} onChange={e => setPrices(prev => ({ ...prev, [p.id]: e.target.value }))} className="w-32 p-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
                    <button onClick={async () => { await api(`/api/pieces/${p.id}/close`, 'POST', { prixFinal: prices[p.id] }); reload(); }} className="px-3 py-1.5 rounded-[6px] bg-emerald-600 text-white flex items-center gap-1.5 cursor-pointer"><FolderCheck className="w-3.5 h-3.5" /> Clôturer</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activePanel === 'admin' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="cyber-card p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-[#22D3EE]" /> Comptes Utilisateurs</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input placeholder="Nom complet" value={newUser.nom} onChange={e => setNewUser({ ...newUser, nom: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <input placeholder="Identifiant" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <input type="password" placeholder="Mot de passe" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
                <option value="operateur">Opérateur</option><option value="chef">Chef d'Atelier</option><option value="be">Bureau d'Études</option><option value="directeur">Directeur</option>
              </select>
            </div>
            <button onClick={createUser} className="mt-2 px-3 py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold cursor-pointer">Créer le compte</button>
            <div className="mt-4 divide-y divide-[#1E2A38] text-xs">
              {state.users.map(u => (
                <div key={u.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span><strong>{u.nom}</strong> ({u.username})</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[#22D3EE] uppercase">{u.role}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        const newRole = window.prompt('Nouveau rôle (directeur, chef, be, operateur, tv) :', u.role);
                        if (!newRole) return;
                        await api(`/api/users/${u.id}`, 'PUT', { role: newRole });
                        reload();
                      }}
                      className="px-2 py-0.5 rounded border border-[#1E2A38] text-slate-300 hover:border-[#22D3EE] text-[10px] cursor-pointer"
                    >
                      Rôle
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const pwd = window.prompt(`Nouveau mot de passe pour ${u.nom} :`);
                        if (!pwd) return;
                        await api(`/api/users/${u.id}`, 'PUT', { password: pwd });
                        alert('Mot de passe réinitialisé.');
                      }}
                      className="px-2 py-0.5 rounded border border-[#1E2A38] text-amber-300 hover:border-amber-400 text-[10px] cursor-pointer"
                    >
                      Réinit. MDP
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="cyber-card p-4">
            <h3 className="font-semibold text-sm mb-3">Journal d'Audit</h3>
            <div className="space-y-1.5 text-xs max-h-64 overflow-y-auto">
              {(state.auditLogs || []).map(l => (
                <div key={l.id} className="flex justify-between py-1.5 border-b border-[#1E2A38]">
                  <span><strong className="text-[#22D3EE]">{l.user}</strong> ({l.action}) — {l.details}</span>
                  <span className="text-slate-500 font-mono-num">{l.createdAt}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
