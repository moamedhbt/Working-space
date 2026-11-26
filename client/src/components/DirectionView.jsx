import React, { useState, useEffect } from 'react';
import {
  Bot, CheckCircle, Plus, FolderCheck, UserPlus, ShoppingCart,
  FileText, FileSpreadsheet, Archive, Download, X, Database, Edit3, Check,
  AlertTriangle, Layers, Image, Activity, Wrench, Filter, ShieldAlert, ArchiveRestore,
  Clock, Upload, Sparkles, Eye, EyeOff, KeyRound, Trash2, RefreshCw
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { api, getAuthToken } from '../api';
import CreateOfModal from './CreateOfModal';
import TimelineModal from './TimelineModal';
import ChefPlanningTab from './ChefPlanningTab';

function statusBadge(statut, urgence) {
  if (statut === 'À valider') return 'bg-purple-500/15 text-purple-300 border-purple-500/40';
  if (statut === 'Refusé') return 'bg-slate-800 text-slate-400 border-slate-700';
  if (statut === 'Panne machine') return 'bg-red-500/15 text-red-300 border-red-500/40';
  if (statut === 'Clôturé') return 'bg-slate-700/40 text-slate-300 border-slate-600/50';
  if (urgence === 'Critique') return 'bg-red-500/10 text-red-400 border-red-500/30';
  if (statut === 'À acheter' || urgence === 'Urgent' || statut === 'En pause') return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
}

function nowLinePercent() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = 8 * 60;
  const end = 17 * 60;
  return Math.max(0, Math.min(100, ((mins - start) / (end - start)) * 100));
}

export default function DirectionView({ state, user, reload, activePanel = 'overview', search = '', onOpenPlanning }) {
  const activeMachines = state.machines.filter(m => m.actif);
  const operators = state.users.filter(u => u.role === 'operateur' && u.actif !== 0);

  const [toast, setToast] = useState({ type: 'ok', text: '' });
  const [showNewModal, setShowNewModal] = useState(false);
  const [timelinePiece, setTimelinePiece] = useState(null);
  const [exportingHistory, setExportingHistory] = useState(false);
  const [newPieceForm, setNewPieceForm] = useState({
    nom: '',
    client: '',
    quantitePrevue: '10',
    delai: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    urgence: 'Normal',
    machineId: '',
    operateurId: '',
    timeMode: 'detail',
    tempsReglageMin: '20',
    tempsUnitaireMin: '6',
    tempsTotalMin: '80',
    matiere: '',
    chuteDispo: true
  });

  // Filters & archiving
  const [filterStatut, setFilterStatut] = useState('all');
  const [filterMachine, setFilterMachine] = useState('all');
  const [filterUrgence, setFilterUrgence] = useState('all');
  const [showArchived, setShowArchived] = useState(false);

  const [newUser, setNewUser] = useState({ nom: '', username: '', password: '', role: 'operateur' });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editUserForm, setEditUserForm] = useState({ nom: '', role: 'operateur', password: '', actif: true });

  // Directeur Multi-Provider AI Vault Settings
  const [aiMeta, setAiMeta] = useState(null);
  const [editingProfileId, setEditingProfileId] = useState(null);
  const [aiForm, setAiForm] = useState({ label: '', provider: 'qwen', apiKey: '', model: 'qwen3.8-flash', baseUrl: '' });
  const [showAiKey, setShowAiKey] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState('');
  const [loadingAiModels, setLoadingAiModels] = useState(false);
  const [liveAiModels, setLiveAiModels] = useState([]);
  const [aiTestResult, setAiTestResult] = useState(null);

  async function loadAiSettings() {
    try {
      const data = await api('/api/admin/ai-settings');
      setAiMeta(data);
    } catch {}
  }

  useEffect(() => {
    if (activePanel === 'admin' && user?.role === 'directeur') {
      loadAiSettings();
    }
  }, [activePanel, user?.role]);

  function resetAiForm() {
    setEditingProfileId(null);
    setLiveAiModels([]);
    setAiForm({ label: '', provider: 'qwen', apiKey: '', model: 'qwen3.8-flash', baseUrl: '' });
  }

  function startEditAiProfile(p) {
    setEditingProfileId(p.id);
    setLiveAiModels([]);
    setAiTestResult(null);
    setAiForm({
      label: p.label || '',
      provider: p.provider || 'qwen',
      apiKey: '',
      model: p.model || '',
      baseUrl: p.baseUrl || ''
    });
  }

  async function saveAiProfile() {
    setSavingAi(true);
    setAiTestResult(null);
    try {
      const payload = {
        id: editingProfileId || undefined,
        label: aiForm.label.trim() || undefined,
        provider: aiForm.provider,
        model: aiForm.model.trim(),
        baseUrl: aiForm.baseUrl.trim(),
        enabled: true,
        setActive: true,
        ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {})
      };
      const res = await api('/api/admin/ai-profiles', 'POST', payload);
      setAiMeta(res.aiSettings);
      showToast(editingProfileId ? 'Fournisseur IA mis à jour !' : 'Nouveau fournisseur IA enregistré et activé !');
      resetAiForm();
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setSavingAi(false);
    }
  }

  async function activateAiProfile(id) {
    try {
      const res = await api(`/api/admin/ai-profiles/${id}/activate`, 'POST');
      setAiMeta(res.aiSettings);
      showToast('Fournisseur IA activé immédiatement pour le BE !');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function toggleAiProfileStatus(id, enabled) {
    try {
      const res = await api(`/api/admin/ai-profiles/${id}/toggle`, 'POST', { enabled });
      setAiMeta(res.aiSettings);
      showToast(enabled ? 'Fournisseur réactivé.' : 'Fournisseur désactivé.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function removeAiProfile(p) {
    if (!window.confirm(`Supprimer le fournisseur IA "${p.label}" ?`)) return;
    try {
      const res = await api(`/api/admin/ai-profiles/${p.id}`, 'DELETE');
      setAiMeta(res.aiSettings);
      if (editingProfileId === p.id) resetAiForm();
      showToast('Fournisseur IA supprimé.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function testAiConfig(profileId = null) {
    if (profileId) setTestingProfileId(profileId);
    else setTestingAi(true);
    setAiTestResult(null);
    try {
      const payload = profileId
        ? { profileId }
        : {
            profileId: editingProfileId || undefined,
            provider: aiForm.provider,
            model: aiForm.model,
            baseUrl: aiForm.baseUrl,
            ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {})
          };
      const res = await api('/api/admin/ai-settings/test', 'POST', payload);
      setAiTestResult(res);
      if (res.ok) showToast(`Connexion IA réussie (${res.provider} / ${res.model} en ${res.latencyMs} ms)`);
      else showToast(res.error || 'Test IA échoué', 'err');
    } catch (e) {
      setAiTestResult({ ok: false, error: e.message });
      showToast(e.message, 'err');
    } finally {
      setTestingAi(false);
      setTestingProfileId('');
    }
  }

  async function fetchLiveAiModels() {
    setLoadingAiModels(true);
    try {
      const payload = {
        profileId: editingProfileId || undefined,
        provider: aiForm.provider,
        baseUrl: aiForm.baseUrl,
        ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {})
      };
      const res = await api('/api/admin/ai-settings/models', 'POST', payload);
      if (res.ok && Array.isArray(res.models) && res.models.length > 0) {
        setLiveAiModels(res.models);
        showToast(`${res.models.length} modèles disponibles détectés pour ${res.provider}.`);
      } else {
        showToast(res.error || 'Aucun modèle retourné', 'err');
      }
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setLoadingAiModels(false);
    }
  }

  const [sim, setSim] = useState({
    nom: '',
    quantite: '20',
    delai: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    machineId: '',
    matiereDispo: true,
    delaiFournisseurJours: '',
    tempsReglageMin: '20',
    tempsParPieceMin: '10'
  });
  const [simResult, setSimResult] = useState(null);
  const [prices, setPrices] = useState({});

  useEffect(() => {
    if (!sim.machineId && activeMachines.length > 0) {
      setSim(prev => ({ ...prev, machineId: activeMachines[0].id }));
    }
  }, [activeMachines.length]);

  function showToast(text, type = 'ok') {
    setToast({ type, text });
    setTimeout(() => setToast({ type: 'ok', text: '' }), 4000);
  }

  const filteredPieces = state.pieces.filter(p => {
    if (!showArchived && p.archived) return false;
    if (filterStatut !== 'all' && p.statut !== filterStatut) return false;
    if (filterMachine !== 'all' && p.machineId !== filterMachine) return false;
    if (filterUrgence !== 'all' && p.urgence !== filterUrgence) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.id.toLowerCase().includes(q) ||
        p.nom.toLowerCase().includes(q) ||
        (p.client || '').toLowerCase().includes(q) ||
        (p.operateur || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const nonArchivedPieces = state.pieces.filter(p => !p.archived);
  const enCours = nonArchivedPieces.filter(p => p.statut === 'En cours').length;
  const aAcheter = nonArchivedPieces.filter(p => p.statut === 'À acheter').length;
  const clotures = state.pieces.filter(p => p.statut === 'Clôturé').length;
  const openPannes = (state.pannes || []).filter(p => p.statut === 'Ouverte');
  const analytics = state.analytics || {
    trsPct: 100, disponibilitePct: 100, performancePct: 100, qualitePct: 100,
    tauxRebutPct: 0, totalBonnes: 0, totalRebuts: 0, totalPrevuMin: 0, totalReelMin: 0,
    totalReglageMin: 0, totalUsinageMin: 0, setupRatioPct: 0, totalArretPanneMin: 0,
    machineStats: [], operatorStats: [], aiInsights: []
  };

  function proposePriceAI(p) {
    const ops = p.operations || [];
    let machineCost = 0;
    if (ops.length > 0) {
      machineCost = ops.reduce((sum, o) => {
        if (o.estSousTraitance) return sum + 4000;
        const hrs = (o.tempsReelMin || o.tempsPrevuMin || 60) / 60;
        const rate = o.machineTauxHoraire || 2500;
        return sum + hrs * rate;
      }, 0);
    } else {
      const hours = (p.tempsReelMin || p.tempsPrevuMin || 120) / 60;
      machineCost = hours * (p.machineTauxHoraire || 2500);
    }
    const matCost = p.chuteDispo ? 1500 : 6000;
    const estimated = Math.round((machineCost + matCost) * 1.3);
    setPrices(prev => ({ ...prev, [p.id]: estimated }));
  }

  async function validateMaintenance(m) {
    const desc = window.prompt(`Description de l'entretien préventif sur ${m.nom} :`, 'Graissage, contrôle niveaux et géométrie');
    if (desc === null) return;
    try {
      await api(`/api/machines/${m.id}/maintenance`, 'POST', { description: desc });
      showToast(`Entretien validé sur ${m.nom}.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function toggleArchive(p) {
    try {
      const res = await api(`/api/pieces/${p.id}/archive`, 'POST', { archived: !p.archived });
      showToast(res.archived ? `OF ${p.id} archivé.` : `OF ${p.id} restauré des archives.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function runSimulation() {
    try {
      const payload = {
        ...sim,
        quantite: Math.max(1, Number(sim.quantite) || 1),
        tempsReglageMin: Math.max(0, Number(sim.tempsReglageMin) || 0),
        tempsParPieceMin: Math.max(0, Number(sim.tempsParPieceMin) || 0),
        delaiFournisseurJours: Math.max(0, Number(sim.delaiFournisseurJours) || 0)
      };
      const res = await api('/api/planning/simulate', 'POST', payload);
      setSimResult(res);
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function validateSimulation() {
    if (!sim.nom.trim()) return showToast('Entrez le nom de la pièce.', 'err');
    const q = Math.max(1, Number(sim.quantite) || 1);
    const reg = Math.max(0, Number(sim.tempsReglageMin) || 0);
    const unit = Math.max(0, Number(sim.tempsParPieceMin) || 0);
    try {
      const res = await api('/api/pieces', 'POST', {
        nom: sim.nom.trim(),
        client: 'Commande Simulée',
        quantitePrevue: q,
        delai: sim.delai,
        urgence: 'Urgent',
        machineId: sim.machineId,
        tempsReglageMin: reg,
        tempsUnitaireMin: unit,
        tempsPrevuMin: simResult?.newLoadMin || (reg + q * (unit || 10)),
        matiereDispo: sim.matiereDispo,
        chuteDispo: sim.matiereDispo
      });
      setSimResult(null);
      setSim(prev => ({ ...prev, nom: '', quantite: '20', matiereDispo: true, delaiFournisseurJours: '' }));
      showToast(`OF ${res.id} créé depuis le simulateur.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  function openCreateModal() {
    setShowAdvancedNew(false);
    setNewPieceForm({
      nom: '',
      client: '',
      quantitePrevue: '10',
      delai: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      urgence: 'Normal',
      machineId: activeMachines[0]?.id || '',
      operateurId: operators[0]?.id || '',
      timeMode: 'detail',
      tempsReglageMin: '20',
      tempsUnitaireMin: '6',
      tempsTotalMin: '80',
      matiere: '',
      chuteDispo: true
    });
    setShowNewModal(true);
  }

  async function submitNewPiece(e) {
    e.preventDefault();
    if (!newPieceForm.nom.trim()) return showToast('Le nom de la pièce est requis.', 'err');
    const quantitePrevue = Math.max(1, parseInt(newPieceForm.quantitePrevue, 10) || 1);
    const isTotalMode = newPieceForm.timeMode === 'total';
    const tempsReglageMin = isTotalMode ? 0 : Math.max(0, parseInt(newPieceForm.tempsReglageMin, 10) || 0);
    const tempsUnitaireMin = isTotalMode ? 0 : Math.max(0, parseFloat(newPieceForm.tempsUnitaireMin) || 0);
    const tempsPrevuMin = isTotalMode
      ? Math.max(1, parseInt(newPieceForm.tempsTotalMin, 10) || 60)
      : Math.max(1, Math.round(tempsReglageMin + tempsUnitaireMin * quantitePrevue));
    try {
      const res = await api('/api/pieces', 'POST', {
        nom: newPieceForm.nom.trim(),
        client: newPieceForm.client.trim() || 'Client Standard',
        quantitePrevue,
        delai: newPieceForm.delai,
        urgence: newPieceForm.urgence,
        machineId: newPieceForm.machineId,
        operateurId: newPieceForm.operateurId,
        tempsReglageMin,
        tempsUnitaireMin,
        tempsPrevuMin,
        matiere: newPieceForm.matiere.trim() || 'À définir',
        chuteDispo: newPieceForm.chuteDispo,
        matiereDispo: newPieceForm.chuteDispo
      });
      setShowNewModal(false);
      showToast(`Ordre de fabrication ${res.id} créé.`);
      reload();
    } catch (err) {
      showToast(err.message, 'err');
    }
  }

  async function createUser() {
    try {
      await api('/api/users', 'POST', newUser);
      setNewUser({ nom: '', username: '', password: '', role: 'operateur' });
      showToast('Compte utilisateur créé.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  function startEditUser(u) {
    setEditingUserId(u.id);
    setEditUserForm({ nom: u.nom, role: u.role, password: '', actif: u.actif !== 0 });
  }

  async function saveEditUser(id) {
    try {
      await api(`/api/users/${id}`, 'PUT', {
        nom: editUserForm.nom,
        role: editUserForm.role,
        actif: editUserForm.actif,
        ...(editUserForm.password.trim() ? { password: editUserForm.password.trim() } : {})
      });
      setEditingUserId(null);
      showToast('Utilisateur mis à jour (tous les OF/opérations liés restent synchronisés).');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function validateDirection(pieceId, action = 'approve') {
    try {
      await api(`/api/pieces/${pieceId}/validate-direction`, 'POST', { action });
      showToast(action === 'approve' ? `OF ${pieceId} validé par la Direction.` : `OF ${pieceId} refusé.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function resolveStop(stopId) {
    try {
      await api(`/api/stops/${stopId}/resolve`, 'POST');
      showToast('Blocage marqué comme résolu.');
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function downloadRawDb() {
    try {
      const token = getAuthToken();
      const resp = await fetch('/api/admin/download-db', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error('Téléchargement impossible');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `atelier_backup_${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      showToast('Base de données atelier.db téléchargée.');
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function downloadFullHistoryZip() {
    setExportingHistory(true);
    try {
      const data = await api('/api/admin/export-history');
      const zip = new JSZip();
      const stamp = new Date().toISOString().slice(0, 10);

      zip.file('historique_complet.json', JSON.stringify(data, null, 2));

      // CSV of all OFs (including archived!)
      const ofHeaders = ['OF', 'Piece', 'Client', 'Statut', 'Urgence', 'Delai', 'Machine', 'Operateur', 'Qte Bonne', 'Qte Prevue', 'Rebuts', 'Temps Prevu (min)', 'Temps Reel (min)', 'Prix Final (DZD)', 'Archive', 'Cree le', 'Cloture le'];
      const ofRows = (data.pieces || []).map(p => [
        p.id, p.nom, p.client, p.statut, p.urgence, p.delai, p.machine, p.operateur,
        p.quantiteRealisee, p.quantitePrevue, p.quantiteRebut || 0,
        p.tempsPrevuMin, p.tempsReelMin, p.prixFinal || 0, p.archived ? 'Oui' : 'Non', p.createdAt || '', p.closedAt || ''
      ]);
      zip.file('historique_OFs.csv', '\uFEFF' + [ofHeaders, ...ofRows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n'));

      // CSV of stops & breakdowns
      const stHeaders = ['Date', 'OF', 'Categorie', 'Motif', 'Operateur', 'Machine', 'Statut', 'Duree (min)', 'Resolu par'];
      const stRows = (data.stops || []).map(s => [
        s.createdAt, s.pieceId, s.categorie, s.motif, s.operateurNom, s.machineNom || '', s.statut, s.dureeMin || 0, s.resolvedBy || ''
      ]);
      zip.file('arrets_et_blocages.csv', '\uFEFF' + [stHeaders, ...stRows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n'));

      // CSV of audit logs
      const auHeaders = ['Date', 'Utilisateur', 'Role', 'Action', 'Details'];
      const auRows = (data.auditLogs || []).map(l => [l.createdAt, l.user, l.role, l.action, l.details]);
      zip.file('journal_audit.csv', '\uFEFF' + [auHeaders, ...auRows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n'));

      // Include hot SQLite DB snapshot too!
      try {
        const token = getAuthToken();
        const dbResp = await fetch('/api/admin/download-db', { headers: { Authorization: `Bearer ${token}` } });
        if (dbResp.ok) {
          zip.file(`atelier_${stamp}.db`, await dbResp.blob());
        }
      } catch {}

      const a = document.createElement('a');
      a.href = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
      a.download = `Atelier_Historique_Complet_${stamp}.zip`;
      a.click();
      showToast('Archive complète (.ZIP + base .db + CSV + JSON) téléchargée !');
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setExportingHistory(false);
    }
  }

  async function handleRestoreDb(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm(`Restaurer la base de données depuis "${file.name}" ? (Une sauvegarde de sécurité sera faite avant.)`)) {
      e.target.value = '';
      return;
    }
    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Lecture fichier impossible'));
        r.readAsDataURL(file);
      });
      await api('/api/admin/restore-db', 'POST', { base64 });
      showToast('Base de données restaurée avec succès !');
      reload();
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      e.target.value = '';
    }
  }

  async function triggerBackup() {
    try {
      const res = await api('/api/admin/backup', 'POST');
      showToast(`Sauvegarde créée : ${res.file}`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function validateBuy(pieceId) {
    try {
      await api(`/api/pieces/${pieceId}/buy`, 'POST');
      showToast(`Achat matière validé pour ${pieceId}.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  async function closePiece(p) {
    try {
      const prixFinal = Number(prices[p.id] ?? p.prixFinal ?? 0);
      await api(`/api/pieces/${p.id}/close`, 'POST', { prixFinal });
      showToast(`Dossier ${p.id} clôturé${prixFinal > 0 ? ` (${prixFinal.toLocaleString('fr-FR')} DZD)` : ''}.`);
      reload();
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  function exportPDF() {
    const doc = new jsPDF('landscape');
    doc.setFontSize(14);
    doc.text('ATELIER MANAGER — PLANNING & RAPPORT PRODUCTION', 14, 16);
    autoTable(doc, {
      startY: 24,
      head: [['Ordre', 'OF', 'Piece', 'Client', 'Machine', 'Operateur', 'Ops', 'Delai', 'Urgence', 'Statut', 'Qte / Rebuts']],
      body: filteredPieces.map((p, i) => [
        `#${p.ordrePlanning || i + 1}`, p.id, p.nom, p.client, p.machine, p.operateur,
        `${p.opsTerminees}/${p.opsTotal}`, p.delai, p.urgence, p.statut,
        `${p.quantiteRealisee}/${p.quantitePrevue}${p.quantiteRebut > 0 ? ` (${p.quantiteRebut} NC)` : ''}`
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [34, 211, 238], textColor: [11, 15, 20] }
    });
    doc.save(`Planning_Atelier_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  function exportExcel() {
    const headers = ['Ordre', 'OF', 'Piece', 'Client', 'Machine', 'Operateur', 'Operations', 'Delai', 'Urgence', 'Statut', 'Qte Bonne', 'Qte Prevue', 'Qte Rebut', 'Reglage (min)', 'Temps Reel (min)', 'Temps Prevu (min)', 'Prix Final (DZD)'];
    const rows = filteredPieces.map((p, i) => [
      p.ordrePlanning || i + 1, p.id, p.nom, p.client, p.machine, p.operateur,
      `${p.opsTerminees}/${p.opsTotal}`, p.delai, p.urgence, p.statut,
      p.quantiteRealisee, p.quantitePrevue, p.quantiteRebut || 0,
      p.totalReglageMin || 0, p.tempsReelMin, p.tempsPrevuMin, p.prixFinal || 0
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `Planning_Atelier_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function downloadPieceZip(p) {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`DOSSIER DE FABRICATION : ${p.id}`, 14, 18);
    autoTable(doc, {
      startY: 26,
      head: [['Champ', 'Detail']],
      body: [
        ['Piece / Client', `${p.nom} — ${p.client}`],
        ['Statut', p.statut],
        ['Urgence / Delai', `${p.urgence} — ${p.delai}`],
        ['Machine / Operateur', `${p.machine} — ${p.operateur}`],
        ['Quantite (Bonne / Prevue / Rebuts)', `${p.quantiteRealisee} / ${p.quantitePrevue} (Rebuts: ${p.quantiteRebut || 0})`],
        ['Temps (Reglage / Reel / Prevu)', `${p.totalReglageMin || 0} min / ${p.tempsReelMin} min / ${p.tempsPrevuMin} min`],
        ['Matiere / Fournisseur', `${p.matiere} (${p.fournisseur || '—'})`],
        ['Outillage', p.outils || '—'],
        ['Prix final', p.prixFinal > 0 ? `${p.prixFinal.toLocaleString('fr-FR')} DZD` : '—'],
        ['BE (Plan / Prog / 3D)', `${p.be.nomFichier || '—'} / ${p.be.programme || '—'} / ${p.be.dessin3d || '—'}`]
      ],
      headStyles: { fillColor: [34, 211, 238], textColor: [11, 15, 20] }
    });

    if ((p.operations || []).length > 0) {
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 8,
        head: [['Op', 'Libelle', 'Machine', 'Operateur', 'Regl./Prevu/Reel', 'Qte / NC', 'Statut']],
        body: p.operations.map((o, idx) => [
          `Op ${(idx + 1) * 10}`, o.libelle, o.machine, o.operateur,
          `${o.tempsReglageMin || 0}m / ${o.tempsPrevuMin}m / ${o.tempsReelMin}m`,
          `${o.quantiteBonne} ok / ${o.quantiteRebut} NC`, o.statut
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [17, 24, 33], textColor: [248, 250, 252] }
      });
    }

    const zip = new JSZip();
    zip.file(`Fiche_${p.id}.pdf`, doc.output('blob'));
    zip.file(`BE_${p.id}_infos.txt`, `Fichier: ${p.be.nomFichier}\nProgramme: ${p.be.programme}\nDessin 3D: ${p.be.dessin3d}\nNotes qualite: ${p.notesQualite || '—'}\n`);
    const timelineLines = (p.events || []).map(ev => `[${ev.createdAt}] ${ev.userNom} (${ev.userRole}) — ${ev.title}${ev.details ? ` : ${ev.details}` : ''}`);
    zip.file(`Timeline_${p.id}.txt`, timelineLines.length ? timelineLines.join('\n') : 'Aucun événement enregistré.');

    // Bundle all active uploaded files (Plan Client + BE Plan/CNC/3D) & photos inside the ZIP!
    const activeFiles = (p.beFiles || []).filter(f => f.isActive);
    for (const f of activeFiles) {
      try {
        const resp = await fetch(f.url);
        if (resp.ok) {
          zip.file(`${f.categorie === 'client' ? 'Client' : 'BE'}/${f.categorie}_${f.revision.replace(/\s+/g, '')}_${f.filename}`, await resp.blob());
        }
      } catch {}
    }
    for (const [label, url] of [['photo_debut', p.photoDebut], ['photo_fin', p.photoFin]]) {
      if (url && String(url).startsWith('/uploads/')) {
        try {
          const resp = await fetch(url);
          if (resp.ok) zip.file(`Photos/${label}_${url.split('/').pop()}`, await resp.blob());
        } catch {}
      }
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
    a.download = `${p.id}_Dossier_Complet.zip`;
    a.click();
  }

  const hoursAxis = ['08h', '09h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h'];
  const nowPct = nowLinePercent();
  const modalQty = Math.max(1, parseInt(newPieceForm.quantitePrevue, 10) || 1);
  const modalReg = Math.max(0, parseInt(newPieceForm.tempsReglageMin, 10) || 0);
  const modalUnit = Math.max(0, parseFloat(newPieceForm.tempsUnitaireMin) || 0);
  const computedModalMin = newPieceForm.timeMode === 'total'
    ? Math.max(1, parseInt(newPieceForm.tempsTotalMin, 10) || 0)
    : Math.round(modalReg + modalUnit * modalQty);

  const filterBar = (
    <div className="cyber-card p-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-slate-400 flex items-center gap-1 mr-1"><Filter className="w-3.5 h-3.5 text-[#22D3EE]" /> Filtres :</span>
      <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)} className="p-1.5 rounded bg-[#0B0F14] border border-[#1E2A38]">
        <option value="all">Tous les statuts</option>
        <option value="À planifier">À planifier</option>
        <option value="À acheter">À acheter</option>
        <option value="Prêt atelier">Prêt atelier</option>
        <option value="En cours">En cours</option>
        <option value="En pause">En pause</option>
        <option value="Panne machine">Panne machine</option>
        <option value="À clôturer">À clôturer</option>
        <option value="Clôturé">Clôturé</option>
      </select>
      <select value={filterMachine} onChange={e => setFilterMachine(e.target.value)} className="p-1.5 rounded bg-[#0B0F14] border border-[#1E2A38]">
        <option value="all">Toutes machines</option>
        {state.machines.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
      </select>
      <select value={filterUrgence} onChange={e => setFilterUrgence(e.target.value)} className="p-1.5 rounded bg-[#0B0F14] border border-[#1E2A38]">
        <option value="all">Toutes urgences</option>
        <option value="Critique">Critique</option>
        <option value="Urgent">Urgent</option>
        <option value="Normal">Normal</option>
      </select>
      <label className="flex items-center gap-1.5 text-slate-300 ml-auto cursor-pointer">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="accent-[#22D3EE]" />
        Afficher archivés ({state.pieces.filter(p => p.archived).length})
      </label>
    </div>
  );

  return (
    <div className="space-y-5">
      {toast.text && (
        <div className={`p-3 rounded-[6px] border text-xs font-medium ${
          toast.type === 'err'
            ? 'bg-red-500/15 border-red-500/40 text-red-300'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        }`}>
          {toast.text}
        </div>
      )}

      {/* SHARED MOBILE-FIRST CREATE OF MODAL (WITH AI + REPRISE EN COURS) */}
      <CreateOfModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        state={state}
        user={user}
        onCreated={res => {
          showToast(`Ordre de fabrication ${res.id} créé.`);
          reload();
        }}
      />

      {/* UNIFIED OF DOSSIER & TIMELINE MODAL */}
      <TimelineModal piece={timelinePiece} onClose={() => setTimelinePiece(null)} />

      {/* PANEL 1: OVERVIEW */}
      {activePanel === 'overview' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-white">Vue d'ensemble de l'atelier</h1>
              <p className="text-xs text-slate-400">
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {activeMachines.length} machine(s) active(s) · TRS estimé <strong className="text-[#22D3EE] font-mono-num">{analytics.trsPct}%</strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={downloadFullHistoryZip}
                disabled={exportingHistory}
                className="px-3 py-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-xs font-medium text-[#22D3EE] flex items-center gap-1.5 cursor-pointer"
                title="Télécharger toute la base + CSV + JSON en .ZIP"
              >
                <Archive className="w-3.5 h-3.5" /> {exportingHistory ? 'Export...' : 'Historique .ZIP'}
              </button>
              <button onClick={exportPDF} className="px-3 py-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] hover:border-slate-600 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer">
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              <button onClick={() => setShowNewModal(true)} className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Nouvelle pièce
              </button>
            </div>
          </div>

          {/* OFS EN ATTENTE DE VALIDATION DIRECTION (CRÉÉS PAR CHEF OU BE) */}
          {state.pieces.filter(p => p.statut === 'À valider').length > 0 && (
            <div className="p-4 rounded-[6px] bg-purple-500/15 border border-purple-500/40 space-y-2.5 text-xs">
              <div className="font-semibold text-purple-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> OFs en attente de votre validation ({state.pieces.filter(p => p.statut === 'À valider').length})
              </div>
              {state.pieces.filter(p => p.statut === 'À valider').map(p => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-[#0B0F14] border border-purple-500/30">
                  <div>
                    <span className="font-mono-num text-[#22D3EE] font-semibold">{p.id}</span> · <strong className="text-white">{p.nom}</strong> ({p.quantitePrevue} pcs · {p.client})
                    <div className="text-[11px] text-slate-400">
                      Créé par {p.createdBy || 'Atelier'} ({p.createdByRole || '—'}) · Délai {p.delai}{p.estRepriseEnCours ? ' · Reprise en cours' : ''}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setTimelinePiece(p)} className="px-2.5 py-1 rounded bg-[#111821] border border-[#1E2A38] text-slate-300 cursor-pointer">
                      Voir
                    </button>
                    <button type="button" onClick={() => validateDirection(p.id, 'approve')} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer">
                      Valider
                    </button>
                    <button type="button" onClick={() => validateDirection(p.id, 'reject')} className="px-2.5 py-1 rounded bg-red-600/20 border border-red-500/40 text-red-300 cursor-pointer">
                      Refuser
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 4 KPI CARDS */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['TRS GLOBAL', `${analytics.trsPct}%`, '#22D3EE', `Disp. ${analytics.disponibilitePct}% · Qual. ${analytics.qualitePct}%`],
              ['EN FABRICATION', enCours, '#22D3EE', `${openPannes.length} panne(s) active(s)`],
              ['ACHATS EN ATTENTE', aAcheter, '#F59E0B', `${(state.conflicts || []).length} conflit(s) planning`],
              ['CLÔTURÉS', clotures, '#10B981', `Rebuts : ${analytics.tauxRebutPct}% (${analytics.totalRebuts} pcs)`]
            ].map(([lbl, val, col, sub]) => (
              <div key={lbl} className="cyber-card cyber-corners p-4 flex flex-col justify-between">
                <div className="text-[10px] font-semibold tracking-wider text-slate-400">{lbl}</div>
                <div className="text-2xl font-bold font-mono-num mt-1" style={{ color: col }}>{val}</div>
                <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
              </div>
            ))}
          </div>

          {/* GANTT + IA SYNTHESIS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 min-w-0 cyber-card p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Charge & opérations par machine</h2>
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
                    {nowPct > 0 && nowPct < 100 && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-[#22D3EE]/70 shadow-[0_0_8px_#22D3EE] pointer-events-none"
                        style={{ left: `calc(8rem + (100% - 8rem) * ${nowPct / 100})` }}
                      ></div>
                    )}
                    {activeMachines.map(m => {
                      const machineOps = state.pieces
                        .filter(p => p.statut !== 'Clôturé' && !p.archived)
                        .flatMap(p => (p.operations || []).filter(o => !o.estSousTraitance && o.machineId === m.id && o.statut !== 'Terminée').map(o => ({ ...o, piece: p })));
                      return (
                        <div key={m.id} className="flex items-center gap-3 text-xs">
                          <div className="w-28 shrink-0">
                            <div className="font-medium text-slate-200 truncate flex items-center gap-1">
                              <span className="truncate">{m.nom}</span>
                              {m.enPanne ? <span className="text-[9px] text-red-400 font-bold">PANNE</span> : null}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {machineOps[0] ? machineOps[0].operateur : 'Disponible'}
                            </div>
                          </div>
                          <div className={`flex-1 min-h-[30px] bg-[#0B0F14] border rounded-[4px] flex flex-wrap items-center gap-1 p-1 ${m.enPanne ? 'border-red-500/40' : 'border-[#1E2A38]'}`}>
                            {machineOps.map(op => (
                              <div
                                key={op.id}
                                title={`${op.piece.id} · ${op.libelle} (${op.operateur})`}
                                className={`px-2 py-0.5 rounded-[4px] border text-[10px] font-mono-num truncate max-w-[210px] ${statusBadge(op.statut === 'Panne machine' ? 'Panne machine' : op.piece.statut, op.piece.urgence)}`}
                              >
                                {op.piece.id} · {op.libelle} ({(op.tempsPrevuMin / 60).toFixed(1)}h)
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-w-0 cyber-card cyber-corners p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#22D3EE]" /> Synthèse atelier (indicateurs)
                </h2>
                <div className="space-y-1.5">
                  {(analytics.aiInsights || []).map((ins, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded border text-[11px] leading-snug ${
                        ins.level === 'danger' ? 'bg-red-500/15 border-red-500/40 text-red-300' :
                        ins.level === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                        ins.level === 'info' ? 'bg-[#22D3EE]/10 border-[#22D3EE]/30 text-cyan-200' :
                        'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      {ins.text}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={onOpenPlanning} className="w-full py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-xs font-medium text-slate-200 cursor-pointer">
                Ouvrir le planning
              </button>
            </div>
          </div>

          {filterBar}

          {/* ORDERS TABLE */}
          <div className="cyber-card p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Ordres de fabrication ({filteredPieces.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[760px]">
                <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
                  <tr>
                    <th className="py-2 pr-3">OF</th>
                    <th className="py-2 pr-3">Pièce / Client</th>
                    <th className="py-2 pr-3">Machine / Opérateur</th>
                    <th className="py-2 pr-3">Gamme & Avancement</th>
                    <th className="py-2 pr-3">Régl. / Temps</th>
                    <th className="py-2">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2A38]">
                  {filteredPieces.map(p => (
                    <tr key={p.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 pr-3 font-mono-num text-slate-200">
                        <button type="button" onClick={() => setTimelinePiece(p)} className="text-[#22D3EE] hover:underline font-semibold cursor-pointer" title="Voir tout l'historique & dossier">
                          {p.id}
                        </button>
                        {p.archived && <span className="ml-1 text-[9px] text-slate-500">(arch.)</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="text-slate-200">{p.nom}</div>
                        <div className="text-[10px] text-slate-500">{p.client}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-400">
                        <div>{p.machine}</div>
                        <div className="text-[10px] text-slate-500">{p.operateur}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                            <div className="h-full bg-[#22D3EE]" style={{ width: `${p.progressPct ?? 0}%` }}></div>
                          </div>
                          <span className="font-mono-num text-[11px] text-slate-300">{p.quantiteRealisee}/{p.quantitePrevue}</span>
                          <span className="text-[10px] font-mono-num text-[#22D3EE]">({p.opsTerminees}/{p.opsTotal} op.)</span>
                          {p.quantiteRebut > 0 && <span className="text-[10px] font-mono-num text-red-400">{p.quantiteRebut} NC</span>}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono-num text-slate-400">
                        <span className="text-[#22D3EE]">{p.totalReglageMin || 0}m</span> · {p.tempsReelMin}/{p.tempsPrevuMin}m
                      </td>
                      <td className="py-2.5">
                        <span className={`px-2 py-0.5 rounded-[4px] border text-[11px] font-medium ${statusBadge(p.statut, p.urgence)}`}>
                          {p.urgence} · {p.statut}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* PANEL 2: PILOTAGE ATELIER, TRS & MAINTENANCE PREVENTIVE */}
      {activePanel === 'pilotage' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#22D3EE]" /> Pilotage Atelier — TRS, Qualité & Maintenance Préventive
              </h1>
              <p className="text-xs text-slate-400">Indicateurs temps réel calculés à partir des gammes, pointages opérateurs, pannes et compteurs machines.</p>
            </div>
          </div>

          {/* 5 TRS & SETUP KPIS */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              ['TRS GLOBAL', `${analytics.trsPct}%`, '#22D3EE', 'Disp × Perf × Qualité'],
              ['DISPONIBILITÉ', `${analytics.disponibilitePct}%`, '#10B981', `${analytics.totalArretPanneMin} min d'arrêt panne`],
              ['PERFORMANCE', `${analytics.performancePct}%`, '#38BDF8', `${analytics.totalReelMin}/${analytics.totalPrevuMin} min`],
              ['QUALITÉ', `${analytics.qualitePct}%`, analytics.tauxRebutPct > 3 ? '#F59E0B' : '#10B981', `${analytics.totalBonnes} ok · ${analytics.totalRebuts} NC (${analytics.tauxRebutPct}%)`],
              ['PART RÉGLAGE', `${analytics.setupRatioPct}%`, '#A78BFA', `${analytics.totalReglageMin}m régl. / ${analytics.totalUsinageMin}m usin.`]
            ].map(([lbl, val, col, sub]) => (
              <div key={lbl} className="cyber-card cyber-corners p-4">
                <div className="text-[10px] font-semibold tracking-wider text-slate-400">{lbl}</div>
                <div className="text-2xl font-bold font-mono-num mt-1" style={{ color: col }}>{val}</div>
                <div className="text-[10px] text-slate-500 mt-1">{sub}</div>
              </div>
            ))}
          </div>

          {/* MACHINE PERFORMANCE + PREVENTIVE MAINTENANCE */}
          <div className="cyber-card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Wrench className="w-4 h-4 text-[#22D3EE]" /> Performance & Maintenance Préventive par Machine
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[860px]">
                <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
                  <tr>
                    <th className="py-2 pr-2">Machine</th>
                    <th className="py-2 pr-2">Charge / Cap.</th>
                    <th className="py-2 pr-2">Réel / Prévu (Écart)</th>
                    <th className="py-2 pr-2">Pannes / Arrêt</th>
                    <th className="py-2 pr-2">Qualité (Rebuts)</th>
                    <th className="py-2 pr-2">Compteur Entretien</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2A38]">
                  {(analytics.machineStats || []).map(ms => (
                    <tr key={ms.id}>
                      <td className="py-2.5 pr-2">
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          {ms.nom}
                          {ms.enPanne && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px]">PANNE</span>}
                        </div>
                        <div className="text-[10px] text-slate-500">{ms.type}</div>
                      </td>
                      <td className="py-2.5 pr-2 font-mono-num">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[#0B0F14] rounded-full overflow-hidden">
                            <div className={`h-full ${ms.utilisationPct > 100 ? 'bg-red-500' : 'bg-[#22D3EE]'}`} style={{ width: `${Math.min(100, ms.utilisationPct)}%` }}></div>
                          </div>
                          <span className={ms.utilisationPct > 100 ? 'text-red-400' : 'text-slate-200'}>{ms.utilisationPct}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-2 font-mono-num">
                        {ms.reelMin}/{ms.prevuMin}m{' '}
                        <span className={ms.ecartMin > 0 ? 'text-red-400' : 'text-emerald-400'}>
                          ({ms.ecartMin > 0 ? `+${ms.ecartMin}m` : `${ms.ecartMin}m`})
                        </span>
                      </td>
                      <td className="py-2.5 pr-2 font-mono-num text-slate-300">
                        {ms.nbPannes} ({ms.arretMin}m)
                      </td>
                      <td className="py-2.5 pr-2 font-mono-num">
                        <span className={ms.tauxRebutPct > 3 ? 'text-red-400' : 'text-emerald-400'}>{ms.tauxRebutPct}%</span>
                        <span className="text-slate-500 ml-1">({ms.rebuts} NC)</span>
                      </td>
                      <td className="py-2.5 pr-2 font-mono-num">
                        <div className="flex items-center gap-1.5">
                          {ms.maintenanceStatut !== 'ok' && <ShieldAlert className={`w-3.5 h-3.5 ${ms.maintenanceStatut === 'du' ? 'text-red-400' : 'text-amber-400'}`} />}
                          <span className={ms.maintenanceStatut === 'du' ? 'text-red-400 font-semibold' : ms.maintenanceStatut === 'proche' ? 'text-amber-300' : 'text-slate-300'}>
                            {ms.heuresDepuisEntretien}h / {ms.intervalleEntretienH}h
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500">Dernier : {ms.dernierEntretienDate}</div>
                      </td>
                      <td className="py-2.5">
                        <button
                          type="button"
                          onClick={() => validateMaintenance(ms)}
                          className="px-2.5 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/15 text-[11px] cursor-pointer"
                        >
                          Valider entretien
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* OPERATOR STATS + MAINTENANCE HISTORY */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="cyber-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Qualité & Temps par Opérateur</h3>
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] text-slate-500 uppercase border-b border-[#1E2A38]">
                  <tr>
                    <th className="py-1.5">Opérateur</th>
                    <th className="py-1.5">Ops actives</th>
                    <th className="py-1.5">Bonnes / NC</th>
                    <th className="py-1.5">Temps réel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2A38]">
                  {(analytics.operatorStats || []).map(os => (
                    <tr key={os.id}>
                      <td className="py-2 font-medium text-white">{os.nom}</td>
                      <td className="py-2 font-mono-num text-[#22D3EE]">{os.activeOps}</td>
                      <td className="py-2 font-mono-num">
                        {os.bonnes} ok · <span className={os.rebuts > 0 ? 'text-red-400' : 'text-emerald-400'}>{os.rebuts} NC ({os.tauxRebutPct}%)</span>
                      </td>
                      <td className="py-2 font-mono-num text-slate-300">{os.reelMin} / {os.prevuMin}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cyber-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Historique Maintenance Préventive</h3>
              {(state.maintenanceLogs || []).length === 0 ? (
                <div className="text-xs text-slate-500">Aucun entretien préventif enregistré pour l'instant.</div>
              ) : (
                <div className="space-y-1.5 text-xs max-h-56 overflow-y-auto">
                  {(state.maintenanceLogs || []).map(ml => (
                    <div key={ml.id} className="p-2 rounded bg-[#0B0F14] border border-[#1E2A38] flex justify-between gap-2">
                      <div>
                        <span className="font-semibold text-[#22D3EE]">{ml.machineNom}</span>
                        <span className="text-slate-300 ml-1.5">— {ml.description}</span>
                        <div className="text-[10px] text-slate-500">Par {ml.effectuePar} à {Math.round(ml.heuresAuCompteur || 0)}h</div>
                      </div>
                      <span className="font-mono-num text-[10px] text-slate-500 shrink-0">{ml.createdAt}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Planning unique partagé avec le chef d'atelier. */}
      {activePanel === 'planning' && <ChefPlanningTab state={state} reload={reload} showToast={showToast} />}

      {/* PANEL 4: SIMULATOR */}
      {activePanel === 'simulator' && (
        <div className="cyber-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Simulateur de Décision (What-If)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="text-[10px] text-slate-400">Nom de la pièce</label>
              <input placeholder="Ex: Bride DN80" value={sim.nom} onChange={e => setSim({ ...sim, nom: e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-white" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400">Quantité</label>
              <input type="number" min="1" placeholder="20" value={sim.quantite} onChange={e => setSim({ ...sim, quantite: e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400">Machine</label>
              <select value={sim.machineId} onChange={e => setSim({ ...sim, machineId: e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] text-white">
                {activeMachines.map(m => <option key={m.id} value={m.id}>{m.nom}{m.enPanne ? ' (PANNE)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400">Temps réglage (min)</label>
              <input type="number" min="0" placeholder="20" value={sim.tempsReglageMin} onChange={e => setSim({ ...sim, tempsReglageMin: e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400">Minutes / pièce</label>
              <input type="number" min="0" step="0.5" placeholder="10" value={sim.tempsParPieceMin} onChange={e => setSim({ ...sim, tempsParPieceMin: e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400">Délai souhaité</label>
              <input type="date" value={sim.delai} onChange={e => setSim({ ...sim, delai: e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
            </div>
            <label className="flex items-center gap-2 px-1 pt-2 cursor-pointer text-slate-300"><input type="checkbox" checked={sim.matiereDispo} onChange={e => setSim({ ...sim, matiereDispo: e.target.checked })} className="accent-[#22D3EE]" /> Matière dispo DZ</label>
            {!sim.matiereDispo && (
              <div>
                <label className="text-[10px] text-slate-400">Délai fournisseur (jours)</label>
                <input type="number" min="0" placeholder="Ex: 3" value={sim.delaiFournisseurJours} onChange={e => setSim({ ...sim, delaiFournisseurJours: e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num text-white" />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={runSimulation} className="px-4 py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold cursor-pointer">Simuler l'impact</button>
            {simResult && <button onClick={validateSimulation} className="px-4 py-2 rounded-[6px] bg-emerald-600 text-white text-xs font-medium cursor-pointer">Valider & Créer OF</button>}
          </div>
          {simResult && (
            <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3 text-xs space-y-1">
              {simResult.missing.length > 0 && <div className="text-amber-400">Infos manquantes : {simResult.missing.join(' | ')}</div>}
              <div>Charge {simResult.machineNom} : {simResult.currentLoadHours}h + {simResult.newLoadHours}h (dont {simResult.setupMin}m réglage) = <strong className="font-mono-num">{simResult.totalHours}h</strong></div>
              <div className="font-semibold text-[#22D3EE]">{simResult.verdict}</div>
            </div>
          )}
        </div>
      )}

      {/* PANEL 5: DOSSIERS & CLOTURE */}
      {activePanel === 'dossiers' && (
        <div className="space-y-3">
          {filterBar}
          {filteredPieces.map(p => {
            const realPhotos = [
              ...(p.photoDebut && p.photoDebut.startsWith('/uploads/') ? [{ lbl: 'Photo début', url: p.photoDebut }] : []),
              ...(p.photoFin && p.photoFin.startsWith('/uploads/') ? [{ lbl: 'Photo fin', url: p.photoFin }] : []),
              ...(p.operations || []).flatMap(o => [
                ...(o.photoDebut && o.photoDebut.startsWith('/uploads/') ? [{ lbl: `${o.libelle} (début)`, url: o.photoDebut }] : []),
                ...(o.photoFin && o.photoFin.startsWith('/uploads/') ? [{ lbl: `${o.libelle} (fin)`, url: o.photoFin }] : [])
              ])
            ];
            const activeBeFiles = (p.beFiles || []).filter(f => f.isActive);

            return (
              <div key={p.id} className="cyber-card p-4 text-xs space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-sm">
                  <span className="font-mono-num">{p.id} — <span className="font-sans">{p.nom}</span> <span className="text-xs font-normal text-slate-400">({p.client})</span></span>
                  <div className="flex items-center gap-2">
                    {p.prixFinal > 0 && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono-num text-[11px]">
                        {Number(p.prixFinal).toLocaleString('fr-FR')} DZD
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-[4px] border text-[11px] whitespace-nowrap ${statusBadge(p.statut, p.urgence)}`}>{p.statut}</span>
                  </div>
                </div>

                <div className="text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                  <span>BE: {p.be.nomFichier || '—'} | Prog: {p.be.programme || '—'} | 3D: {p.be.dessin3d || '—'}</span>
                  <span className="font-mono-num text-slate-300">Qté: {p.quantiteRealisee}/{p.quantitePrevue}{p.quantiteRebut > 0 ? ` (${p.quantiteRebut} rebuts)` : ''}</span>
                  <span className="font-mono-num text-slate-300">Temps: {p.tempsReelMin}/{p.tempsPrevuMin}m (régl. {p.totalReglageMin || 0}m)</span>
                </div>

                {activeBeFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {activeBeFiles.map(f => (
                      <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[#22D3EE]/10 border border-[#22D3EE]/30 text-[#22D3EE] text-[10px] font-mono-num">
                        {f.categorie.toUpperCase()} {f.revision} · {f.filename}
                      </a>
                    ))}
                  </div>
                )}

                {(p.operations || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.operations.map((o, idx) => (
                      <span key={o.id} className="px-2 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[10px] text-slate-300 flex items-center gap-1">
                        <Layers className="w-3 h-3 text-[#22D3EE]" />
                        Op {(idx + 1) * 10}: {o.libelle} ({o.machine} · {o.operateur}) — <strong className="text-[#22D3EE]">{o.statut}</strong>
                      </span>
                    ))}
                  </div>
                )}

                {p.notesQualite && (
                  <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                    Qualité / Rebuts : {p.notesQualite}
                  </div>
                )}

                {realPhotos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {realPhotos.map((ph, idx) => (
                      <a key={idx} href={ph.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-[#22D3EE] text-[11px]">
                        <Image className="w-3.5 h-3.5" /> {ph.lbl}
                      </a>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={() => setTimelinePiece(p)} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-[#22D3EE] flex items-center gap-1.5 cursor-pointer"><Clock className="w-3.5 h-3.5" /> Historique / Timeline</button>
                  <button onClick={() => downloadPieceZip(p)} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] flex items-center gap-1.5 cursor-pointer"><Archive className="w-3.5 h-3.5" /> Dossier .ZIP (+ BE & Timeline)</button>
                  {p.statut === 'À acheter' && (
                    <button onClick={() => validateBuy(p.id)} className="px-3 py-1.5 rounded-[6px] bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1.5 cursor-pointer">
                      <ShoppingCart className="w-3.5 h-3.5" /> Valider Achat
                    </button>
                  )}
                  {p.statut === 'À clôturer' && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <button onClick={() => proposePriceAI(p)} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] cursor-pointer">Calculer Prix IA</button>
                      <input type="number" placeholder="Prix final (DZD)" value={prices[p.id] ?? ''} onChange={e => setPrices(prev => ({ ...prev, [p.id]: e.target.value }))} className="w-36 p-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
                      <button onClick={() => closePiece(p)} className="px-3 py-1.5 rounded-[6px] bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer"><FolderCheck className="w-3.5 h-3.5" /> Clôturer</button>
                    </div>
                  )}
                  {p.statut === 'Clôturé' && (
                    <button onClick={() => toggleArchive(p)} className="px-3 py-1.5 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-slate-500 text-slate-300 flex items-center gap-1.5 cursor-pointer">
                      {p.archived ? <><ArchiveRestore className="w-3.5 h-3.5" /> Désarchiver</> : <><Archive className="w-3.5 h-3.5" /> Archiver</>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PANEL 6: ADMIN */}
      {activePanel === 'admin' && (
        <div className="space-y-4">
          {/* MULTI-PROVIDER AI VAULT CARD (DIRECTEUR ONLY) */}
          <div className="cyber-card p-4 border-purple-500/30 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <div>
                  <h3 className="font-semibold text-sm text-white">Fournisseurs IA — Qwen Officiel, OpenRouter, Gemini, OpenAI, Claude…</h3>
                  <p className="text-[11px] text-slate-400">
                    Enregistrez plusieurs clés API (ex. Qwen Officiel + OpenRouter) et activez ou désactivez celle de votre choix en 1 clic.
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded text-[11px] font-semibold border ${
                aiMeta?.source === 'database'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : aiMeta?.source === 'env'
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}>
                {aiMeta?.source === 'database'
                  ? `Actif : ${aiMeta.label || aiMeta.resolvedProvider}${aiMeta.model ? ` (${aiMeta.model})` : ''}`
                  : aiMeta?.source === 'env'
                  ? `Actif : ${aiMeta.resolvedProvider} (ENV)`
                  : 'Aucun provider actif (hors-ligne)'}
              </span>
            </div>

            {/* SAVED PROVIDERS LIST (1-CLICK ACTIVATE / DEACTIVATE / TEST / EDIT / DELETE) */}
            {(aiMeta?.profiles || []).length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Fournisseurs enregistrés ({aiMeta.profiles.length})
                </div>
                <div className="grid md:grid-cols-2 gap-2.5">
                  {aiMeta.profiles.map(p => (
                    <div
                      key={p.id}
                      className={`p-3 rounded-[6px] border text-xs space-y-2 transition ${
                        p.isActive
                          ? 'bg-emerald-950/20 border-emerald-500/50'
                          : p.enabled
                          ? 'bg-[#0B0F14] border-[#1E2A38]'
                          : 'bg-[#0B0F14]/60 border-slate-800 opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                            <span>{p.label}</span>
                            {p.isActive && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[9px] font-bold">
                                ACTIF
                              </span>
                            )}
                            {!p.enabled && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 text-[9px]">
                                DÉSACTIVÉ
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono-num truncate mt-0.5">
                            {p.provider} · {p.model || 'modèle par défaut'} · {p.maskedKey || 'sans clé'}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#1E2A38]/70">
                        {!p.isActive ? (
                          <button
                            type="button"
                            onClick={() => activateAiProfile(p.id)}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer"
                          >
                            Activer
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleAiProfileStatus(p.id, false)}
                            className="px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 text-[11px] font-semibold cursor-pointer"
                          >
                            Désactiver
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={testingProfileId === p.id}
                          onClick={() => testAiConfig(p.id)}
                          className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] hover:border-purple-400 text-purple-300 text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className={`w-3 h-3 ${testingProfileId === p.id ? 'animate-spin' : ''}`} /> Tester
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditAiProfile(p)}
                          className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" /> Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAiProfile(p)}
                          className="ml-auto px-2 py-1 rounded bg-red-500/10 border border-red-500/30 hover:border-red-400 text-red-300 text-[11px] cursor-pointer"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ADD OR EDIT PROVIDER FORM */}
            <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-purple-300">
                  {editingProfileId ? 'Modifier le fournisseur IA sélectionné' : '+ Ajouter un fournisseur IA (Qwen Officiel, OpenRouter, Gemini…)'}
                </div>
                {editingProfileId && (
                  <button type="button" onClick={resetAiForm} className="text-[11px] text-slate-400 hover:text-white cursor-pointer">
                    Annuler la modification
                  </button>
                )}
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Nom du profil <span className="text-slate-500">(ex: Qwen Pro)</span></label>
                  <input
                    value={aiForm.label}
                    onChange={e => setAiForm({ ...aiForm, label: e.target.value })}
                    placeholder="Ex: Qwen Officiel / OpenRouter"
                    className="w-full p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] text-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Fournisseur IA (Provider)</label>
                  <select
                    value={aiForm.provider}
                    onChange={e => {
                      const nextProv = e.target.value;
                      const meta = (aiMeta?.availableProviders || []).find(p => p.id === nextProv);
                      setLiveAiModels([]);
                      setAiForm(f => ({
                        ...f,
                        provider: nextProv,
                        model: meta?.defaultModel || '',
                        baseUrl: nextProv === 'custom' ? f.baseUrl : ''
                      }));
                    }}
                    className="w-full p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] text-white"
                  >
                    {(aiMeta?.availableProviders || [
                      { id: 'qwen', label: 'Alibaba Qwen Officiel (International / Singapour)' },
                      { id: 'qwen_us', label: 'Alibaba Qwen Officiel (Région US / Virginie)' },
                      { id: 'qwen_cn', label: 'Alibaba Qwen Officiel (Région Chine / Pékin)' },
                      { id: 'openrouter', label: 'OpenRouter (1 clé → tous les modèles)' },
                      { id: 'gemini', label: 'Google Gemini (AI Studio)' },
                      { id: 'openai', label: 'OpenAI (GPT-4o / GPT-4o-mini)' },
                      { id: 'anthropic', label: 'Anthropic Claude (Sonnet 4)' },
                      { id: 'groq', label: 'Groq (Vision rapide)' },
                      { id: 'custom', label: 'Endpoint personnalisé (Compatible OpenAI / Ollama)' }
                    ]).map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  {(() => {
                    const sel = (aiMeta?.availableProviders || []).find(p => p.id === aiForm.provider);
                    return sel?.note ? <div className="text-[10px] text-slate-400 mt-1">{sel.note}</div> : null;
                  })()}
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1 flex items-center justify-between">
                    <span>Modèle</span>
                    <button
                      type="button"
                      disabled={loadingAiModels}
                      onClick={fetchLiveAiModels}
                      className="text-[10px] text-purple-300 hover:text-purple-200 underline cursor-pointer"
                    >
                      {loadingAiModels ? 'Chargement...' : 'Lister mes modèles'}
                    </button>
                  </label>
                  <input
                    value={aiForm.model}
                    onChange={e => setAiForm({ ...aiForm, model: e.target.value })}
                    placeholder={
                      aiForm.provider.startsWith('qwen') ? 'qwen3.8-flash ou qwen3.8-max' :
                      aiForm.provider === 'gemini' ? 'gemini-3.8-flash' :
                      aiForm.provider === 'openai' ? 'gpt-4o-mini' :
                      aiForm.provider === 'anthropic' ? 'claude-sonnet-4-20250514' :
                      aiForm.provider === 'openrouter' ? 'qwen/qwen3.8-27b:free' :
                      'Modèle par défaut'
                    }
                    className="w-full p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] text-white font-mono-num"
                  />
                  {liveAiModels.length > 0 && (
                    <select
                      value={liveAiModels.includes(aiForm.model) ? aiForm.model : ''}
                      onChange={e => e.target.value && setAiForm(f => ({ ...f, model: e.target.value }))}
                      className="w-full mt-1.5 p-1.5 rounded bg-[#111821] border border-purple-500/40 text-purple-200 text-[11px] font-mono-num"
                    >
                      <option value="">— Choisir parmi {liveAiModels.length} modèles —</option>
                      {liveAiModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1 flex items-center gap-1">
                    <KeyRound className="w-3 h-3 text-purple-400" /> Clé API secrète
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type={showAiKey ? 'text' : 'password'}
                      value={aiForm.apiKey}
                      onChange={e => setAiForm({ ...aiForm, apiKey: e.target.value })}
                      placeholder={editingProfileId ? 'Laisser vide pour garder la clé' : 'Collez votre clé API (sk-..., AIza...)'}
                      className="flex-1 min-w-0 p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] text-white font-mono-num"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAiKey(v => !v)}
                      className="px-2.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] text-slate-400 hover:text-white cursor-pointer"
                      title={showAiKey ? 'Masquer' : 'Afficher'}
                    >
                      {showAiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {aiForm.provider === 'custom' && (
                <div className="text-xs">
                  <label className="text-[11px] text-slate-400 block mb-1">URL de base de l'API compatible OpenAI</label>
                  <input
                    value={aiForm.baseUrl}
                    onChange={e => setAiForm({ ...aiForm, baseUrl: e.target.value })}
                    placeholder="Ex: http://localhost:11434/v1 ou https://api.mistral.ai/v1"
                    className="w-full p-2 rounded-[6px] bg-[#111821] border border-[#1E2A38] text-white font-mono-num"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingAi}
                    onClick={saveAiProfile}
                    className="px-3.5 py-2 rounded-[6px] bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" /> {savingAi ? 'Enregistrement...' : (editingProfileId ? 'Mettre à jour ce fournisseur' : 'Enregistrer & Activer')}
                  </button>
                  <button
                    type="button"
                    disabled={testingAi}
                    onClick={() => testAiConfig(null)}
                    className="px-3 py-2 rounded-[6px] bg-[#111821] border border-purple-500/40 hover:border-purple-400 text-purple-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingAi ? 'animate-spin' : ''}`} /> {testingAi ? 'Test en cours...' : 'Tester cette clé'}
                  </button>
                </div>
                <div className="text-[10px] text-slate-500">
                  Toutes les clés sont stockées uniquement côté serveur (SQLite) et masquées pour les autres rôles.
                </div>
              </div>
            </div>

            {aiTestResult && (
              <div className={`p-2.5 rounded-[6px] text-xs border ${
                aiTestResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/40 text-red-300'
              }`}>
                {aiTestResult.ok ? (
                  <span>
                    Connexion réussie : <strong>{aiTestResult.provider}</strong> ({aiTestResult.model}) — réponse reçue en <strong className="font-mono-num">{aiTestResult.latencyMs} ms</strong>.
                  </span>
                ) : (
                  <span>Échec du test : {aiTestResult.error}</span>
                )}
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
          <div className="cyber-card p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-[#22D3EE]" /> Comptes Utilisateurs</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input placeholder="Nom complet" value={newUser.nom} onChange={e => setNewUser({ ...newUser, nom: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <input placeholder="Identifiant" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <input type="password" placeholder="Mot de passe" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]" />
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
                <option value="operateur">Opérateur</option><option value="chef">Chef d'Atelier</option><option value="be">Bureau d'Études</option><option value="directeur">Directeur</option><option value="tv">Écran TV</option>
              </select>
            </div>
            <button onClick={createUser} className="mt-2 px-3 py-2 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold cursor-pointer">Créer le compte</button>

            <div className="mt-4 divide-y divide-[#1E2A38] text-xs">
              {state.users.map(u => (
                <div key={u.id} className="py-2.5">
                  {editingUserId === u.id ? (
                    <div className="space-y-2 bg-[#0B0F14] p-2.5 rounded border border-[#22D3EE]/30">
                      <div className="grid grid-cols-2 gap-2">
                        <input value={editUserForm.nom} onChange={e => setEditUserForm({ ...editUserForm, nom: e.target.value })} placeholder="Nom complet" className="p-1.5 rounded bg-[#111821] border border-[#1E2A38]" />
                        <select value={editUserForm.role} onChange={e => setEditUserForm({ ...editUserForm, role: e.target.value })} className="p-1.5 rounded bg-[#111821] border border-[#1E2A38]">
                          <option value="operateur">Opérateur</option><option value="chef">Chef d'Atelier</option><option value="be">Bureau d'Études</option><option value="directeur">Directeur</option><option value="tv">Écran TV</option>
                        </select>
                        <input type="password" value={editUserForm.password} onChange={e => setEditUserForm({ ...editUserForm, password: e.target.value })} placeholder="Nouveau MDP (laisser vide si inchangé)" className="col-span-2 p-1.5 rounded bg-[#111821] border border-[#1E2A38]" />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                          <input type="checkbox" checked={editUserForm.actif} onChange={e => setEditUserForm({ ...editUserForm, actif: e.target.checked })} className="accent-[#22D3EE]" />
                          Compte actif
                        </label>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => saveEditUser(u.id)} className="px-2.5 py-1 rounded bg-emerald-600 text-white flex items-center gap-1 cursor-pointer"><Check className="w-3 h-3" /> Enregistrer</button>
                          <button type="button" onClick={() => setEditingUserId(null)} className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 cursor-pointer">Annuler</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong className={u.actif === 0 ? 'line-through text-slate-500' : 'text-white'}>{u.nom}</strong>
                        <span className="text-slate-400 ml-1.5">({u.username})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#22D3EE] uppercase text-[10px] font-semibold">{u.role}</span>
                        {u.actif === 0 && <span className="text-[10px] text-red-400">Désactivé</span>}
                        <button type="button" onClick={() => startEditUser(u)} className="px-2 py-1 rounded border border-[#1E2A38] text-slate-300 hover:border-[#22D3EE] text-[10px] flex items-center gap-1 cursor-pointer">
                          <Edit3 className="w-3 h-3" /> Modifier
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="cyber-card p-4 flex flex-col space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-sm">Sauvegarde, Export Historique & Audit</h3>
              <button type="button" onClick={triggerBackup} className="px-2.5 py-1 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] text-xs text-[#22D3EE] flex items-center gap-1.5 cursor-pointer">
                <Database className="w-3.5 h-3.5" /> Backup Serveur
              </button>
            </div>

            {/* FULL HISTORY DOWNLOAD & RESTORE PANEL */}
            <div className="p-3 rounded-[6px] bg-[#0B0F14] border border-[#22D3EE]/30 space-y-2 text-xs">
              <div className="font-semibold text-[#22D3EE]">Télécharger & Restaurer tout votre historique</div>
              <p className="text-[11px] text-slate-400">
                Téléchargez l'archive complète (.ZIP : base SQLite + OFs + arrêts + audit CSV/JSON) sur votre PC ou téléphone. Si Render redémarre, restaurez votre fichier <code className="text-slate-200">.db</code> en 1 clic.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={exportingHistory}
                  onClick={downloadFullHistoryZip}
                  className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] text-[#0B0F14] font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" /> {exportingHistory ? 'Préparation...' : 'Archive Complète (.ZIP)'}
                </button>
                <button
                  type="button"
                  onClick={downloadRawDb}
                  className="px-3 py-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Base atelier.db
                </button>
                <button
                  type="button"
                  onClick={exportExcel}
                  className="px-3 py-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Excel / CSV
                </button>
                <label className="px-3 py-1.5 rounded-[6px] bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" /> Restaurer (.db)
                  <input type="file" accept=".db" onChange={handleRestoreDb} className="hidden" />
                </label>
              </div>
            </div>

            <div className="space-y-1.5 text-xs max-h-72 overflow-y-auto">
              {(state.auditLogs || []).map(l => (
                <div key={l.id} className="flex justify-between gap-2 py-1.5 border-b border-[#1E2A38]">
                  <span><strong className="text-[#22D3EE]">{l.user}</strong> ({l.action}) — {l.details}</span>
                  <span className="text-slate-500 font-mono-num shrink-0">{l.createdAt}</span>
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
