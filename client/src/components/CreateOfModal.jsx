import React, { useState, useEffect } from 'react';
import { X, Bot, Upload, Sparkles, PlayCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../api';

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Lecture fichier échouée'));
    r.readAsDataURL(file);
  });
}

export default function CreateOfModal({ open, onClose, state, user, onCreated }) {
  const activeMachines = (state.machines || []).filter(m => m.actif);
  const operators = (state.users || []).filter(u => u.role === 'operateur' && u.actif !== 0);
  const machineTypes = [...new Set(activeMachines.map(m => m.type).filter(Boolean))];

  const [estReprise, setEstReprise] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [clientFile, setClientFile] = useState(null);
  const [aiEst, setAiEst] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [form, setForm] = useState({
    nom: '',
    client: '',
    quantitePrevue: '10',
    delai: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    urgence: 'Normal',
    typeMachine: '',
    machineId: '',
    operateurId: '',
    matiere: '',
    chuteDispo: true,
    beNonRequis: false,
    tempsReglageMin: '20',
    tempsUnitaireMin: '6',
    statutInitial: 'En cours',
    quantiteDejaRealisee: '0',
    tempsDejaPasseMin: '0'
  });

  useEffect(() => {
    if (!open) return;
    setEstReprise(false);
    setShowAdvanced(false);
    setErrMsg('');
    setClientFile(null);
    setAiEst(null);
    setForm({
      nom: '',
      client: '',
      quantitePrevue: '10',
      delai: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      urgence: 'Normal',
      typeMachine: machineTypes[0] || '',
      machineId: activeMachines[0]?.id || '',
      operateurId: operators[0]?.id || '',
      matiere: '',
      chuteDispo: true,
      beNonRequis: false,
      tempsReglageMin: '20',
      tempsUnitaireMin: '6',
      statutInitial: 'En cours',
      quantiteDejaRealisee: '0',
      tempsDejaPasseMin: '0'
    });
  }, [open]);

  async function runAiEstimate() {
    setAiLoading(true);
    try {
      const res = await api('/api/planning/estimate-of', 'POST', {
        nom: form.nom,
        typeMachine: form.typeMachine,
        machineId: '',
        quantitePrevue: Math.max(1, parseInt(form.quantitePrevue, 10) || 1),
        delai: form.delai,
        matiere: form.matiere
      });
      setAiEst(res);
    } catch (e) {
      setErrMsg(e.message);
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiEstimate() {
    if (!aiEst) return;
    setForm(prev => ({
      ...prev,
      machineId: aiEst.recommendedMachineId || prev.machineId,
      tempsReglageMin: String(aiEst.tempsReglageMin),
      tempsUnitaireMin: String(aiEst.tempsUnitaireMin)
    }));
  }

  async function handleClientFilePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await readFileAsBase64(file);
      setClientFile({ filename: file.name, base64 });
    } catch (err) {
      setErrMsg(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.nom.trim()) return setErrMsg('Le nom de la pièce est requis.');
    setSubmitting(true);
    setErrMsg('');
    const qty = Math.max(1, parseInt(form.quantitePrevue, 10) || 1);
    const reg = Math.max(0, parseInt(form.tempsReglageMin, 10) || 0);
    const unit = Math.max(0, parseFloat(form.tempsUnitaireMin) || 0);

    try {
      const res = await api('/api/pieces', 'POST', {
        nom: form.nom.trim(),
        client: form.client.trim() || 'Client Standard',
        quantitePrevue: qty,
        delai: form.delai,
        urgence: form.urgence,
        typeMachine: form.typeMachine,
        machineId: form.machineId,
        operateurId: form.operateurId,
        matiere: form.matiere.trim() || 'À définir',
        chuteDispo: estReprise ? true : form.chuteDispo,
        matiereDispo: estReprise ? true : form.chuteDispo,
        beNonRequis: form.beNonRequis,
        tempsReglageMin: reg,
        tempsUnitaireMin: unit,
        tempsPrevuMin: Math.max(5, Math.round(reg + unit * qty)),
        estRepriseEnCours: estReprise,
        statutInitial: form.statutInitial,
        quantiteDejaRealisee: estReprise ? Math.max(0, parseInt(form.quantiteDejaRealisee, 10) || 0) : 0,
        tempsDejaPasseMin: estReprise ? Math.max(0, parseInt(form.tempsDejaPasseMin, 10) || 0) : 0,
        clientFile
      });
      onCreated?.(res);
      onClose();
    } catch (err) {
      setErrMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const qtyNum = Math.max(1, parseInt(form.quantitePrevue, 10) || 1);
  const regNum = Math.max(0, parseInt(form.tempsReglageMin, 10) || 0);
  const unitNum = Math.max(0, parseFloat(form.tempsUnitaireMin) || 0);
  const totalMin = Math.round(regNum + unitNum * qtyNum);
  const needsValidation = user?.role !== 'directeur';

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col bg-[#111821] border-t sm:border border-[#1E2A38] rounded-t-2xl sm:rounded-lg shadow-2xl overflow-hidden"
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2A38] shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white">Créer un Ordre de Fabrication (OF)</h3>
            {needsValidation && (
              <p className="text-[10px] text-amber-300 mt-0.5">Sera envoyé au Directeur pour validation avant lancement</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {errMsg && (
            <div className="p-2 rounded bg-red-500/15 border border-red-500/40 text-red-300 text-xs">{errMsg}</div>
          )}

          {/* MODE SWITCH: NOUVEL OF vs REPRISE EN COURS */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#0B0F14] border border-[#1E2A38]">
            <button
              type="button"
              onClick={() => setEstReprise(false)}
              className={`py-2 px-2 rounded-md text-xs font-medium cursor-pointer transition ${
                !estReprise ? 'bg-[#22D3EE] text-[#0B0F14] font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Nouvel OF (circuit complet)
            </button>
            <button
              type="button"
              onClick={() => setEstReprise(true)}
              className={`py-2 px-2 rounded-md text-xs font-medium flex items-center justify-center gap-1 cursor-pointer transition ${
                estReprise ? 'bg-emerald-500 text-[#0B0F14] font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5" /> Pièce déjà en cours
            </button>
          </div>

          {estReprise && (
            <div className="p-2.5 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="text-[11px] font-medium text-emerald-300">
                Reprise d'une pièce déjà en cours dans l'atelier (pour travailler en parallèle immédiatement)
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-300 mb-1">Statut actuel</label>
                  <select value={form.statutInitial} onChange={e => setForm({ ...form, statutInitial: e.target.value })} className="w-full px-2 py-1.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-sm sm:text-xs text-white">
                    <option value="En cours">En cours</option>
                    <option value="Prêt atelier">Prêt atelier</option>
                    <option value="En pause">En pause</option>
                    <option value="À clôturer">À clôturer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-300 mb-1">Déjà faites</label>
                  <input type="number" inputMode="numeric" min="0" value={form.quantiteDejaRealisee} onChange={e => setForm({ ...form, quantiteDejaRealisee: e.target.value })} className="w-full px-2 py-1.5 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-sm sm:text-xs text-white" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-300 mb-1">Temps passé (m)</label>
                  <input type="number" inputMode="numeric" min="0" value={form.tempsDejaPasseMin} onChange={e => setForm({ ...form, tempsDejaPasseMin: e.target.value })} className="w-full px-2 py-1.5 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-sm sm:text-xs text-white" />
                </div>
              </div>
            </div>
          )}

          {/* PIECE + CLIENT + QTY */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Nom de la pièce *</label>
            <input
              required
              value={form.nom}
              onChange={e => setForm({ ...form, nom: e.target.value })}
              placeholder="Ex: Arbre de transmission Ø50"
              className="w-full px-3 py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] focus:border-[#22D3EE] focus:outline-none text-base sm:text-xs text-white"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 min-w-0">
              <label className="block text-[11px] text-slate-400 mb-1">Client</label>
              <input
                value={form.client}
                onChange={e => setForm({ ...form, client: e.target.value })}
                placeholder="SARL MécaSud"
                className="w-full px-3 py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] focus:border-[#22D3EE] focus:outline-none text-base sm:text-xs text-white"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] text-slate-400 mb-1">Qté *</label>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                required
                value={form.quantitePrevue}
                onChange={e => setForm({ ...form, quantitePrevue: e.target.value })}
                className="w-full px-2.5 py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] focus:border-[#22D3EE] focus:outline-none font-mono-num text-base sm:text-xs text-white"
              />
            </div>
          </div>

          {/* DELAI + TYPE MACHINE */}
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <label className="block text-[11px] text-slate-400 mb-1">Délai souhaité</label>
              <input
                type="date"
                value={form.delai}
                onChange={e => setForm({ ...form, delai: e.target.value })}
                className="w-full min-w-0 max-w-full px-2 py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] focus:border-[#22D3EE] focus:outline-none font-mono-num text-sm sm:text-xs text-white"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] text-slate-400 mb-1">Type de machine</label>
              <select
                value={form.typeMachine}
                onChange={e => {
                  const t = e.target.value;
                  const firstOfType = activeMachines.find(m => m.type === t);
                  setForm({ ...form, typeMachine: t, machineId: firstOfType?.id || form.machineId });
                }}
                className="w-full px-2 py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-base sm:text-xs text-white"
              >
                <option value="">Tous types</option>
                {machineTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* PLAN CLIENT (PHOTO / PDF) */}
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-200">Plan client (PDF ou Photo)</div>
              <div className="text-[10px] text-slate-400 truncate">
                {clientFile ? `📎 ${clientFile.filename}` : 'Optionnel — transmis directement au BE'}
              </div>
            </div>
            <label className="px-2.5 py-1.5 rounded bg-[#22D3EE]/15 border border-[#22D3EE]/40 text-[#22D3EE] text-[11px] font-semibold flex items-center gap-1 cursor-pointer shrink-0">
              <Upload className="w-3.5 h-3.5" /> {clientFile ? 'Changer' : 'Joindre'}
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleClientFilePick} className="hidden" />
            </label>
          </div>

          {/* IA ESTIMATION & PLANNING PROPOSAL */}
          <div className="p-2.5 rounded-[6px] bg-cyan-950/25 border border-[#22D3EE]/35 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#22D3EE] flex items-center gap-1.5">
                <Bot className="w-4 h-4" /> Estimation IA (historique + planning)
              </span>
              <button
                type="button"
                disabled={aiLoading}
                onClick={runAiEstimate}
                className="px-2.5 py-1 rounded bg-[#22D3EE] text-[#0B0F14] text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" /> {aiLoading ? 'Calcul...' : 'Estimer IA'}
              </button>
            </div>

            {aiEst && (
              <div className="space-y-1.5 text-[11px] pt-1 border-t border-[#1E2A38]">
                <div className="text-slate-200">{aiEst.message}</div>
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[#22D3EE] font-mono-num">
                    Confiance : {aiEst.confidence}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded border font-mono-num flex items-center gap-1 ${
                    aiEst.deadlineOk
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/15 border-red-500/40 text-red-300'
                  }`}>
                    {aiEst.deadlineOk ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    Fin estimée : {aiEst.projectedEndDate}
                  </span>
                  <button
                    type="button"
                    onClick={applyAiEstimate}
                    className="ml-auto px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold cursor-pointer"
                  >
                    Appliquer
                  </button>
                </div>
                {aiEst.similarPieces?.length > 0 && (
                  <div className="text-[10px] text-slate-400">
                    Références : {aiEst.similarPieces.map(s => `${s.id} (${s.nom})`).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* URGENCE + STOCK */}
          <div className="grid grid-cols-2 gap-2 items-center">
            <div className="grid grid-cols-3 gap-1">
              {[
                ['Normal', 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'],
                ['Urgent', 'border-amber-500/40 bg-amber-500/15 text-amber-300'],
                ['Critique', 'border-red-500/40 bg-red-500/15 text-red-300']
              ].map(([u, activeCls]) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setForm({ ...form, urgence: u })}
                  className={`py-2 rounded-[6px] border text-[11px] font-medium cursor-pointer ${
                    form.urgence === u ? activeCls : 'border-[#1E2A38] bg-[#0B0F14] text-slate-400'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
            {!estReprise ? (
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, chuteDispo: true })}
                  className={`py-2 rounded-[6px] border text-[11px] font-medium cursor-pointer ${
                    form.chuteDispo ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-[#1E2A38] bg-[#0B0F14] text-slate-400'
                  }`}
                >
                  En stock
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, chuteDispo: false })}
                  className={`py-2 rounded-[6px] border text-[11px] font-medium cursor-pointer ${
                    !form.chuteDispo ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-[#1E2A38] bg-[#0B0F14] text-slate-400'
                  }`}
                >
                  À acheter
                </button>
              </div>
            ) : (
              <div className="text-[11px] text-emerald-300 text-right font-medium">Matière & BE considérés prêts</div>
            )}
          </div>

          {/* COLLAPSIBLE MACHINE / OPERATEUR / TEMPS / MATIERE */}
          <div className="border border-[#1E2A38] rounded-[6px] bg-[#0B0F14]/60">
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs text-slate-300 cursor-pointer"
            >
              <span>Machine précise, Opérateur, Matière & Temps</span>
              <span className="text-[11px] font-mono-num text-[#22D3EE]">{totalMin}m {showAdvanced ? '▲' : '▼'}</span>
            </button>

            {showAdvanced && (
              <div className="px-3 pb-3 pt-2 space-y-2.5 border-t border-[#1E2A38]">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Machine</label>
                    <select value={form.machineId} onChange={e => setForm({ ...form, machineId: e.target.value })} className="w-full px-2 py-2 rounded bg-[#0B0F14] border border-[#1E2A38] text-base sm:text-xs text-white">
                      {activeMachines.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Opérateur</label>
                    <select value={form.operateurId} onChange={e => setForm({ ...form, operateurId: e.target.value })} className="w-full px-2 py-2 rounded bg-[#0B0F14] border border-[#1E2A38] text-base sm:text-xs text-white">
                      {operators.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Réglage (min)</label>
                    <input type="number" inputMode="numeric" min="0" value={form.tempsReglageMin} onChange={e => setForm({ ...form, tempsReglageMin: e.target.value })} className="w-full px-2.5 py-2 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-base sm:text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Par pièce (min)</label>
                    <input type="number" inputMode="decimal" min="0" step="0.5" value={form.tempsUnitaireMin} onChange={e => setForm({ ...form, tempsUnitaireMin: e.target.value })} className="w-full px-2.5 py-2 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-base sm:text-xs text-white" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Matière (ou laisser au Chef d'atelier)</label>
                  <input value={form.matiere} onChange={e => setForm({ ...form, matiere: e.target.value })} placeholder="Ex: Acier 42CrMo4 Ø50" className="w-full px-2.5 py-2 rounded bg-[#0B0F14] border border-[#1E2A38] text-base sm:text-xs text-white" />
                </div>
                {!estReprise && (
                  <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={form.beNonRequis} onChange={e => setForm({ ...form, beNonRequis: e.target.checked })} className="accent-[#22D3EE]" />
                    Pas d'étude BE requise (pièce simple / conventionnelle)
                  </label>
                )}
              </div>
            )}
          </div>
        </div>

        {/* STICKY FOOTER */}
        <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#1E2A38] bg-[#0B0F14]/80 shrink-0">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] text-xs text-slate-300 cursor-pointer">
            Annuler
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 sm:flex-none px-5 py-2 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Création...' : estReprise ? 'Enregistrer la reprise' : (needsValidation ? 'Soumettre au Directeur' : "Créer l'OF")}
          </button>
        </div>
      </form>
    </div>
  );
}
