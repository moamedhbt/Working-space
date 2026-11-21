import React, { useState } from 'react';
import { Bot, CheckCircle, Plus, FolderCheck, UserPlus, ShoppingCart, FileText, FileSpreadsheet, Archive } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { api } from '../api';

export default function DirectionView({ state, reload }) {
  const [newUser, setNewUser] = useState({ nom: '', username: '', password: '', role: 'operateur' });
  const [sim, setSim] = useState({ nom: '', quantite: 20, delai: '2026-11-26', machine: 'Tour CNC 1', matiereDispo: true, delaiFournisseurJours: 0, tempsParPieceMin: 0 });
  const [simResult, setSimResult] = useState(null);
  const [prices, setPrices] = useState({});

  function proposePriceAI(p) {
    const hours = (p.tempsReelMin || p.tempsPrevuMin || 120) / 60;
    const machineCost = Math.round(hours * 2500);
    const matCost = p.chuteDispo ? 1500 : 6000;
    const suggested = Math.round((machineCost + matCost) * 1.3);
    setPrices(prev => ({ ...prev, [p.id]: suggested }));
  }

  async function runSimulation() {
    const res = await api('/api/planning/simulate', 'POST', sim);
    setSimResult(res);
  }

  async function validateSimulation() {
    if (!sim.nom.trim()) return alert('Entrez le nom de la pièce');
    await api('/api/pieces', 'POST', { nom: sim.nom, client: 'Commande Simulée', quantitePrevue: sim.quantite, delai: sim.delai, urgence: 'Urgent' });
    setSimResult(null);
    setSim({ nom: '', quantite: 20, delai: '2026-11-26', machine: 'Tour CNC 1', matiereDispo: true, delaiFournisseurJours: 0, tempsParPieceMin: 0 });
    alert('✅ Commande validée et ajoutée au planning !');
    reload();
  }

  const enCours = state.pieces.filter(p => p.statut === 'En cours').length;
  const aAcheter = state.pieces.filter(p => p.statut === 'À acheter').length;
  const clotures = state.pieces.filter(p => p.statut === 'Clôturé').length;
  const critiques = state.pieces.filter(p => p.urgence === 'Critique').length;

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
    alert('✅ Planning validé et publié sur la TV et les téléphones !');
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
    doc.setFontSize(16);
    doc.text('ATELIER MANAGER PRO — PLANNING & RAPPORT JOURNALIER', 14, 16);
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString('fr-FR')} | En cours: ${enCours} | Achats en attente: ${aAcheter} | Clotures: ${clotures}`, 14, 24);
    autoTable(doc, {
      startY: 30,
      head: [['Ordre', 'OF', 'Piece', 'Client', 'Machine', 'Operateur', 'Delai', 'Urgence', 'Statut', 'Qte']],
      body: state.pieces.map((p, i) => [
        `#${p.ordrePlanning || i + 1}`,
        p.id,
        p.nom,
        p.client,
        p.machine,
        p.operateur,
        p.delai,
        p.urgence,
        p.statut,
        `${p.quantiteRealisee}/${p.quantitePrevue}`
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [6, 182, 212] }
    });
    doc.save(`Planning_Atelier_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async function downloadPieceZip(p) {
    const doc = new jsPDF();
    doc.setFontSize(15);
    doc.text(`DOSSIER PIECE : ${p.id}`, 14, 18);
    doc.setFontSize(10);
    doc.text(`Piece : ${p.nom} | Client : ${p.client}`, 14, 26);
    autoTable(doc, {
      startY: 32,
      head: [['Champ', 'Detail']],
      body: [
        ['Statut', p.statut],
        ['Urgence / Delai', `${p.urgence} — ${p.delai}`],
        ['Machine / Operateur', `${p.machine} — ${p.operateur}`],
        ['Quantite (Realisee / Prevue)', `${p.quantiteRealisee} / ${p.quantitePrevue}`],
        ['Temps (Reel / Prevu)', `${p.tempsReelMin} min / ${p.tempsPrevuMin} min`],
        ['Matiere / Chute', `${p.matiere} (${p.chuteDispo ? 'Chute' : p.achatFait ? 'Achetee' : 'A acheter'})`],
        ['Outillage', p.outils || '—'],
        ['BE (Fichier / Prog / 3D)', `${p.be.nomFichier || '—'} / ${p.be.programme || '—'} / ${p.be.dessin3d || '—'}`],
        ['Photos Atelier', `Debut: ${p.photoDebut ? 'OK' : 'Non'} | Fin: ${p.photoFin ? 'OK' : 'Non'}`]
      ],
      headStyles: { fillColor: [6, 182, 212] }
    });
    const zip = new JSZip();
    zip.file(`Fiche_${p.id}.pdf`, doc.output('blob'));
    zip.file(`BE_${p.id}_infos.txt`, `Fichier: ${p.be.nomFichier}\nProgramme: ${p.be.programme}\nDessin 3D: ${p.be.dessin3d}\n`);
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `${p.id}_Dossier_Complet.zip`;
    a.click();
  }

  function exportExcel() {
    const headers = ['Ordre', 'OF', 'Piece', 'Client', 'Machine', 'Operateur', 'Delai', 'Urgence', 'Statut', 'Qte Realisee', 'Qte Prevue'];
    const rows = state.pieces.map((p, i) => [
      p.ordrePlanning || i + 1, p.id, p.nom, p.client, p.machine, p.operateur, p.delai, p.urgence, p.statut, p.quantiteRealisee, p.quantitePrevue
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Planning_Atelier_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-purple-900/30 to-cyan-900/20 border border-purple-500/40 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-bold flex items-center gap-2 text-purple-300">
            <Bot className="w-5 h-5" /> Assistant IA Direction — Rapport Journalier & Prédictions
          </h3>
          <p className="text-xs text-slate-300 mt-1">
            Bilan : <strong>{enCours}</strong> en cours | <strong>{aAcheter}</strong> bloquée(s) | <strong>{clotures}</strong> clôturée(s).{' '}
            {critiques > 0 ? '⚠️ Priorité absolue sur les pièces Critiques.' : '✅ Délais maîtrisés.'} Vitesse moyenne : <strong className="text-cyan-400">+10%</strong>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ['Total Dossiers', state.pieces.length, 'text-white'],
          ['En Fabrication', enCours, 'text-cyan-400'],
          ['Achats en attente', aAcheter, 'text-amber-400'],
          ['Clôturés', clotures, 'text-emerald-400']
        ].map(([lbl, val, cls]) => (
          <div key={lbl} className="bg-[#11192b] border border-cyan-500/20 rounded-xl p-4">
            <div className="text-xs text-slate-400 uppercase">{lbl}</div>
            <div className={`text-2xl font-extrabold mt-1 ${cls}`}>{val}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#11192b] border border-purple-500/30 rounded-2xl p-4 space-y-3">
        <h3 className="font-bold text-base text-purple-300">🔮 Simulateur de Décision IA (What-If) — Avant d'accepter une commande</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <input placeholder="Nom pièce" value={sim.nom} onChange={e => setSim({ ...sim, nom: e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700" />
          <input type="number" placeholder="Qté" value={sim.quantite} onChange={e => setSim({ ...sim, quantite: +e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700" />
          <select value={sim.machine} onChange={e => setSim({ ...sim, machine: e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700">
            {state.machines.map(m => <option key={m.id} value={m.nom}>{m.nom}</option>)}
          </select>
          <input type="number" placeholder="Min / pièce" value={sim.tempsParPieceMin || ''} onChange={e => setSim({ ...sim, tempsParPieceMin: +e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700" />
          <label className="flex items-center gap-1.5 px-2 cursor-pointer">
            <input type="checkbox" checked={sim.matiereDispo} onChange={e => setSim({ ...sim, matiereDispo: e.target.checked })} /> Matière dispo DZ
          </label>
          {!sim.matiereDispo && (
            <input type="number" placeholder="Délai fourn. (j)" value={sim.delaiFournisseurJours || ''} onChange={e => setSim({ ...sim, delaiFournisseurJours: +e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={runSimulation} className="px-3 py-2 rounded-lg bg-purple-600 text-xs font-semibold cursor-pointer">⚡ Simuler l'impact</button>
          {simResult && (
            <button onClick={validateSimulation} className="px-3 py-2 rounded-lg bg-emerald-600 text-xs font-semibold cursor-pointer">✅ Valider & Créer la Commande</button>
          )}
        </div>
        {simResult && (
          <div className="bg-[#060a14] border border-purple-500/30 rounded-xl p-3 text-xs space-y-1">
            {simResult.missing.length > 0 && (
              <div className="text-amber-400 font-bold">❓ Infos manquantes (corrigez ci-dessus) : {simResult.missing.join(' | ')}</div>
            )}
            <div>📊 Charge actuelle {sim.machine} : <strong>{simResult.currentLoadHours}h</strong> + Nouvelle : <strong>{simResult.newLoadHours}h</strong> = <strong>{simResult.totalHours}h</strong></div>
            <div className="font-bold text-cyan-300">{simResult.verdict}</div>
          </div>
        )}
      </div>

      <div className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4">
        <h3 className="font-bold text-base mb-3">📊 Diagramme de Gantt Visuel (Charge & Ordre par Machine)</h3>
        <div className="space-y-3 text-xs">
          {state.machines.map(m => {
            const mPieces = state.pieces.filter(p => p.machine === m.nom && p.statut !== 'Clôturé');
            return (
              <div key={m.id} className="bg-[#060a14] border border-slate-800 rounded-xl p-3">
                <div className="font-bold text-cyan-400 mb-2">🏭 {m.nom}</div>
                {mPieces.length === 0 ? (
                  <div className="text-slate-500 italic">Disponible</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {mPieces.map(p => {
                      const bg = p.urgence === 'Critique' ? 'bg-red-600/80 border-red-400' : p.urgence === 'Urgent' ? 'bg-amber-600/80 border-amber-400' : 'bg-blue-600/80 border-blue-400';
                      const widthPct = Math.min(100, Math.max(22, Math.round((p.tempsPrevuMin || 120) / 4)));
                      return (
                        <div key={p.id} style={{ minWidth: `${widthPct}%` }} className={`${bg} border rounded-lg px-3 py-2 text-white flex justify-between items-center gap-2`}>
                          <span className="font-bold truncate">#{p.ordrePlanning} {p.id} — {p.nom}</span>
                          <span className="text-[11px] opacity-90">{Math.round((p.tempsPrevuMin || 120) / 60 * 10) / 10}h</span>
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

      <div className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-bold text-base">📅 Tableau de Planning Général</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportPDF} className="px-3 py-2 rounded-lg bg-red-600/90 text-xs font-semibold flex items-center gap-1 cursor-pointer">
              <FileText className="w-4 h-4" /> Export PDF
            </button>
            <button onClick={exportExcel} className="px-3 py-2 rounded-lg bg-teal-600 text-xs font-semibold flex items-center gap-1 cursor-pointer">
              <FileSpreadsheet className="w-4 h-4" /> Export Excel
            </button>
            <button onClick={validateAll} className="px-3 py-2 rounded-lg bg-emerald-600 text-xs font-semibold flex items-center gap-1 cursor-pointer">
              <CheckCircle className="w-4 h-4" /> Valider & Publier TV
            </button>
            <button onClick={addPiece} className="px-3 py-2 rounded-lg bg-blue-600 text-xs font-semibold flex items-center gap-1 cursor-pointer">
              <Plus className="w-4 h-4" /> Nouvelle Pièce
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[750px]">
            <thead className="bg-[#060a14] text-cyan-400 uppercase">
              <tr>
                <th className="p-3">Ordre</th>
                <th className="p-3">OF / Pièce</th>
                <th className="p-3">Client</th>
                <th className="p-3">Machine</th>
                <th className="p-3">Opérateur</th>
                <th className="p-3">Délai</th>
                <th className="p-3">Urgence</th>
                <th className="p-3">Statut</th>
                <th className="p-3">Validation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {state.pieces.map((p, i) => (
                <tr key={p.id} className="hover:bg-cyan-500/5">
                  <td className="p-3 font-bold">#{p.ordrePlanning || i + 1}</td>
                  <td className="p-3"><strong>{p.id}</strong><div className="text-slate-400">{p.nom}</div></td>
                  <td className="p-3">{p.client}</td>
                  <td className="p-3">{p.machine}</td>
                  <td className="p-3">{p.operateur}</td>
                  <td className="p-3">{p.delai}</td>
                  <td className="p-3">{p.urgence}</td>
                  <td className="p-3">{p.statut}</td>
                  <td className="p-3">{p.planningValide ? '✅ Validé' : '⏳ À valider'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4 space-y-3">
          <h3 className="font-bold">📁 Dossiers Complets & Clôture</h3>
          {state.pieces.map(p => (
            <div key={p.id} className="bg-[#19243d] border border-slate-700 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between font-bold">
                <span>{p.id} — {p.nom}</span>
                <span className="text-cyan-400">{p.statut}</span>
              </div>
              <div className="text-slate-400">📐 BE: {p.be.nomFichier || '—'} | Prog: {p.be.programme || '—'} | 3D: {p.be.dessin3d || '—'}</div>
              <div className="text-slate-400">📸 Photos: Début {p.photoDebut ? '✅' : '❌'} / Fin {p.photoFin ? '✅' : '❌'} | Qté: {p.quantiteRealisee}/{p.quantitePrevue} | ⏱️ Temps: {p.tempsReelMin}m / {p.tempsPrevuMin}m</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => downloadPieceZip(p)} className="px-2.5 py-1.5 rounded bg-cyan-600 text-white font-semibold flex items-center gap-1 cursor-pointer">
                  <Archive className="w-3.5 h-3.5" /> Dossier .ZIP
                </button>
                {p.statut === 'À acheter' && (
                  <button onClick={async () => { await api(`/api/pieces/${p.id}/buy`, 'POST'); reload(); }} className="px-2.5 py-1.5 rounded bg-amber-500 text-black font-semibold flex items-center gap-1 cursor-pointer">
                    <ShoppingCart className="w-3.5 h-3.5" /> Valider Achat
                  </button>
                )}
                {p.statut === 'À clôturer' && (
                  <div className="w-full space-y-2 pt-2 border-t border-slate-700">
                    <div className="flex flex-wrap gap-2 items-center">
                      <button onClick={() => proposePriceAI(p)} className="px-2.5 py-1.5 rounded bg-purple-600 text-white font-semibold cursor-pointer">
                        🤖 Proposition Prix IA
                      </button>
                      <input
                        type="number"
                        placeholder="Prix final (DZD)"
                        value={prices[p.id] || ''}
                        onChange={e => setPrices(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-36 p-1.5 rounded bg-[#060a14] border border-slate-700 text-white"
                      />
                      <button onClick={async () => { await api(`/api/pieces/${p.id}/close`, 'POST', { prixFinal: prices[p.id] }); reload(); }} className="px-2.5 py-1.5 rounded bg-emerald-600 text-white font-semibold flex items-center gap-1 cursor-pointer">
                        <FolderCheck className="w-3.5 h-3.5" /> Valider & Clôturer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-cyan-400" /> Gestion des Comptes</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <input placeholder="Nom complet" value={newUser.nom} onChange={e => setNewUser({ ...newUser, nom: e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700" />
            <input placeholder="Identifiant" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700" />
            <input type="password" placeholder="Mot de passe" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700" />
            <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="p-2 rounded bg-[#060a14] border border-slate-700">
              <option value="operateur">Opérateur</option>
              <option value="chef">Chef d'Atelier</option>
              <option value="be">Bureau d'Études</option>
              <option value="directeur">Directeur</option>
            </select>
          </div>
          <button onClick={createUser} className="mt-2 px-3 py-2 rounded-lg bg-blue-600 text-xs font-semibold cursor-pointer">+ Créer le compte</button>
          <div className="mt-4 divide-y divide-slate-800 text-xs">
            {state.users.map(u => (
              <div key={u.id} className="py-2 flex justify-between">
                <span><strong>{u.nom}</strong> ({u.username})</span>
                <span className="text-cyan-400 uppercase">{u.role}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#11192b] border border-cyan-500/20 rounded-2xl p-4">
        <h3 className="font-bold mb-3">📜 Journal d'Audit (Sécurité — Qui a fait quoi)</h3>
        <div className="space-y-1.5 text-xs max-h-48 overflow-y-auto">
          {(state.auditLogs || []).length === 0 && <p className="text-slate-400">Aucune action enregistrée pour l'instant.</p>}
          {(state.auditLogs || []).map(l => (
            <div key={l.id} className="flex justify-between py-1.5 border-b border-slate-800">
              <span><strong className="text-cyan-400">{l.user}</strong> ({l.action}) — {l.details}</span>
              <span className="text-slate-500">{l.createdAt}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
