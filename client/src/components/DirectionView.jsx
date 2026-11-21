import React, { useState } from 'react';
import {
  Bot, CheckCircle, Plus, FolderCheck, UserPlus, ShoppingCart,
  FileText, FileSpreadsheet, Archive, BarChart3, Calendar, Sliders, FolderOpen, Shield
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { api } from '../api';

export default function DirectionView({ state, reload }) {
  const [panel, setPanel] = useState('overview');
  const [newUser, setNewUser] = useState({ nom: '', username: '', password: '', role: 'operateur' });
  const [sim, setSim] = useState({ nom: '', quantite: 20, delai: '2026-11-26', machine: 'Tour CNC 1', matiereDispo: true, delaiFournisseurJours: 0, tempsParPieceMin: 0 });
  const [simResult, setSimResult] = useState(null);
  const [prices, setPrices] = useState({});

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
    doc.setFontSize(15);
    doc.text('ATELIER MANAGER — PLANNING & RAPPORT', 14, 16);
    doc.setFontSize(9);
    doc.text(`Date: ${new Date().toLocaleDateString('fr-FR')} | En cours: ${enCours} | Achats: ${aAcheter} | Clotures: ${clotures}`, 14, 23);
    autoTable(doc, {
      startY: 28,
      head: [['Ordre', 'OF', 'Piece', 'Client', 'Machine', 'Operateur', 'Delai', 'Urgence', 'Statut', 'Qte']],
      body: state.pieces.map((p, i) => [
        `#${p.ordrePlanning || i + 1}`, p.id, p.nom, p.client, p.machine, p.operateur, p.delai, p.urgence, p.statut, `${p.quantiteRealisee}/${p.quantitePrevue}`
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [14, 165, 233] }
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
      headStyles: { fillColor: [14, 165, 233] }
    });
    const zip = new JSZip();
    zip.file(`Fiche_${p.id}.pdf`, doc.output('blob'));
    zip.file(`BE_${p.id}_infos.txt`, `Fichier: ${p.be.nomFichier}\nProgramme: ${p.be.programme}\nDessin 3D: ${p.be.dessin3d}\n`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
    a.download = `${p.id}_Dossier_Complet.zip`;
    a.click();
  }

  const menu = [
    ['overview', 'Vue d\'ensemble', BarChart3],
    ['planning', 'Planning & Gantt', Calendar],
    ['simulator', 'Simulateur (What-If)', Sliders],
    ['dossiers', 'Dossiers & Clôture', FolderOpen],
    ['admin', 'Comptes & Audit', Shield]
  ];

  return (
    <div className="flex flex-col md:flex-row gap-5">
      {/* SIDEBAR */}
      <aside className="md:w-56 shrink-0 bg-[#111827] border border-slate-800 rounded-xl p-3 h-fit space-y-1">
        {menu.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setPanel(id)}
            className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-2.5 transition cursor-pointer ${
              panel === id ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </aside>

      {/* CONTENT PANEL */}
      <div className="flex-1 min-w-0 space-y-5">
        {panel === 'overview' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                ['Total Dossiers', state.pieces.length, 'text-white'],
                ['En Fabrication', enCours, 'text-sky-400'],
                ['Achats en attente', aAcheter, 'text-amber-400'],
                ['Clôturés', clotures, 'text-emerald-400']
              ].map(([lbl, val, cls]) => (
                <div key={lbl} className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-400">{lbl}</div>
                  <div className={`text-2xl font-bold mt-1 ${cls}`}>{val}</div>
                </div>
              ))}
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-2">
              <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm">
                <Bot className="w-4 h-4" /> Synthèse IA Direction
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {enCours} ordre(s) en cours de fabrication, {aAcheter} bloqué(s) en attente d'approvisionnement matière, {clotures} dossier(s) clôturé(s).{' '}
                {critiques > 0 ? `${critiques} pièce(s) critique(s) nécessitent un suivi prioritaire.` : 'Aucune alerte critique détectée.'}
              </p>
            </div>
          </>
        )}

        {panel === 'planning' && (
          <div className="space-y-5">
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
              <h3 className="font-semibold text-sm mb-3">Diagramme de Gantt par Machine</h3>
              <div className="space-y-2.5 text-xs">
                {state.machines.map(m => {
                  const mPieces = state.pieces.filter(p => p.machine === m.nom && p.statut !== 'Clôturé');
                  return (
                    <div key={m.id} className="bg-[#090d16] border border-slate-800 rounded-lg p-3">
                      <div className="font-medium text-slate-300 mb-2">{m.nom}</div>
                      {mPieces.length === 0 ? (
                        <span className="text-slate-500">Disponible</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {mPieces.map(p => {
                            const cls = p.urgence === 'Critique' ? 'bg-red-950 border-red-700 text-red-200' : p.urgence === 'Urgent' ? 'bg-amber-950 border-amber-700 text-amber-200' : 'bg-sky-950 border-sky-700 text-sky-200';
                            return (
                              <div key={p.id} className={`${cls} border rounded px-3 py-1.5 flex items-center gap-3`}>
                                <span className="font-semibold">#{p.ordrePlanning} {p.id} — {p.nom}</span>
                                <span className="opacity-75">{Math.round((p.tempsPrevuMin || 120) / 60 * 10) / 10}h</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="font-semibold text-sm">Tableau de Planning Général</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={exportPDF} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                    <FileText className="w-3.5 h-3.5" /> PDF
                  </button>
                  <button onClick={exportExcel} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button onClick={validateAll} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                    <CheckCircle className="w-3.5 h-3.5" /> Valider TV
                  </button>
                  <button onClick={addPiece} className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                    <Plus className="w-3.5 h-3.5" /> Nouvelle Pièce
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[700px]">
                  <thead className="bg-[#090d16] text-slate-400 uppercase">
                    <tr>
                      <th className="p-2.5">Ordre</th><th className="p-2.5">OF / Pièce</th><th className="p-2.5">Client</th>
                      <th className="p-2.5">Machine</th><th className="p-2.5">Opérateur</th><th className="p-2.5">Délai</th>
                      <th className="p-2.5">Urgence</th><th className="p-2.5">Statut</th><th className="p-2.5">TV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {state.pieces.map((p, i) => (
                      <tr key={p.id} className="hover:bg-slate-800/40">
                        <td className="p-2.5 font-semibold">#{p.ordrePlanning || i + 1}</td>
                        <td className="p-2.5"><div className="font-medium text-white">{p.id}</div><div className="text-slate-400">{p.nom}</div></td>
                        <td className="p-2.5">{p.client}</td>
                        <td className="p-2.5">{p.machine}</td>
                        <td className="p-2.5">{p.operateur}</td>
                        <td className="p-2.5">{p.delai}</td>
                        <td className="p-2.5">{p.urgence}</td>
                        <td className="p-2.5">{p.statut}</td>
                        <td className="p-2.5">{p.planningValide ? 'Validé' : 'En attente'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {panel === 'simulator' && (
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-sm">Simulateur de Décision (What-If)</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <input placeholder="Nom pièce" value={sim.nom} onChange={e => setSim({ ...sim, nom: e.target.value })} className="p-2.5 rounded-lg bg-[#090d16] border border-slate-800" />
              <input type="number" placeholder="Quantité" value={sim.quantite} onChange={e => setSim({ ...sim, quantite: +e.target.value })} className="p-2.5 rounded-lg bg-[#090d16] border border-slate-800" />
              <select value={sim.machine} onChange={e => setSim({ ...sim, machine: e.target.value })} className="p-2.5 rounded-lg bg-[#090d16] border border-slate-800">
                {state.machines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
              </select>
              <input type="number" placeholder="Minutes / pièce" value={sim.tempsParPieceMin || ''} onChange={e => setSim({ ...sim, tempsParPieceMin: +e.target.value })} className="p-2.5 rounded-lg bg-[#090d16] border border-slate-800" />
              <label className="flex items-center gap-2 px-2 cursor-pointer">
                <input type="checkbox" checked={sim.matiereDispo} onChange={e => setSim({ ...sim, matiereDispo: e.target.checked })} /> Matière disponible DZ
              </label>
              {!sim.matiereDispo && (
                <input type="number" placeholder="Délai fournisseur (j)" value={sim.delaiFournisseurJours || ''} onChange={e => setSim({ ...sim, delaiFournisseurJours: +e.target.value })} className="p-2.5 rounded-lg bg-[#090d16] border border-slate-800" />
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={runSimulation} className="px-4 py-2 rounded-lg bg-sky-600 text-xs font-medium cursor-pointer">Simuler l'impact</button>
              {simResult && (
                <button onClick={validateSimulation} className="px-4 py-2 rounded-lg bg-emerald-600 text-xs font-medium cursor-pointer">Valider & Créer Commande</button>
              )}
            </div>
            {simResult && (
              <div className="bg-[#090d16] border border-slate-800 rounded-lg p-3 text-xs space-y-1">
                {simResult.missing.length > 0 && <div className="text-amber-400">Infos manquantes : {simResult.missing.join(' | ')}</div>}
                <div>Charge {sim.machine} : {simResult.currentLoadHours}h + {simResult.newLoadHours}h = <strong>{simResult.totalHours}h</strong></div>
                <div className="font-semibold text-sky-400">{simResult.verdict}</div>
              </div>
            )}
          </div>
        )}

        {panel === 'dossiers' && (
          <div className="space-y-3">
            {state.pieces.map(p => (
              <div key={p.id} className="bg-[#111827] border border-slate-800 rounded-xl p-4 text-xs space-y-2">
                <div className="flex justify-between font-semibold text-sm">
                  <span>{p.id} — {p.nom}</span>
                  <span className="text-sky-400">{p.statut}</span>
                </div>
                <div className="text-slate-400">BE: {p.be.nomFichier || '—'} | Prog: {p.be.programme || '—'} | 3D: {p.be.dessin3d || '—'}</div>
                <div className="text-slate-400">Qté: {p.quantiteRealisee}/{p.quantitePrevue} | Temps: {p.tempsReelMin}m / {p.tempsPrevuMin}m</div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={() => downloadPieceZip(p)} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 font-medium flex items-center gap-1.5 cursor-pointer">
                    <Archive className="w-3.5 h-3.5" /> Dossier .ZIP
                  </button>
                  {p.statut === 'À acheter' && (
                    <button onClick={async () => { await api(`/api/pieces/${p.id}/buy`, 'POST'); reload(); }} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium flex items-center gap-1.5 cursor-pointer">
                      <ShoppingCart className="w-3.5 h-3.5" /> Valider Achat
                    </button>
                  )}
                  {p.statut === 'À clôturer' && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <button onClick={() => proposePriceAI(p)} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 font-medium cursor-pointer">
                        Calculer Prix IA
                      </button>
                      <input type="number" placeholder="Prix final (DZD)" value={prices[p.id] || ''} onChange={e => setPrices(prev => ({ ...prev, [p.id]: e.target.value }))} className="w-32 p-1.5 rounded bg-[#090d16] border border-slate-800" />
                      <button onClick={async () => { await api(`/api/pieces/${p.id}/close`, 'POST', { prixFinal: prices[p.id] }); reload(); }} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-medium flex items-center gap-1.5 cursor-pointer">
                        <FolderCheck className="w-3.5 h-3.5" /> Clôturer
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {panel === 'admin' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-sky-400" /> Comptes Utilisateurs</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <input placeholder="Nom complet" value={newUser.nom} onChange={e => setNewUser({ ...newUser, nom: e.target.value })} className="p-2 rounded bg-[#090d16] border border-slate-800" />
                <input placeholder="Identifiant" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className="p-2 rounded bg-[#090d16] border border-slate-800" />
                <input type="password" placeholder="Mot de passe" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="p-2 rounded bg-[#090d16] border border-slate-800" />
                <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="p-2 rounded bg-[#090d16] border border-slate-800">
                  <option value="operateur">Opérateur</option>
                  <option value="chef">Chef d'Atelier</option>
                  <option value="be">Bureau d'Études</option>
                  <option value="directeur">Directeur</option>
                </select>
              </div>
              <button onClick={createUser} className="mt-2 px-3 py-2 rounded-lg bg-sky-600 text-xs font-medium cursor-pointer">Créer le compte</button>
              <div className="mt-4 divide-y divide-slate-800 text-xs">
                {state.users.map(u => (
                  <div key={u.id} className="py-2 flex justify-between">
                    <span><strong>{u.nom}</strong> ({u.username})</span>
                    <span className="text-sky-400 uppercase">{u.role}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
              <h3 className="font-semibold text-sm mb-3">Journal d'Audit</h3>
              <div className="space-y-1.5 text-xs max-h-64 overflow-y-auto">
                {(state.auditLogs || []).length === 0 && <p className="text-slate-500">Aucune action enregistrée.</p>}
                {(state.auditLogs || []).map(l => (
                  <div key={l.id} className="flex justify-between py-1.5 border-b border-slate-800">
                    <span><strong className="text-sky-400">{l.user}</strong> ({l.action}) — {l.details}</span>
                    <span className="text-slate-500">{l.createdAt}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
