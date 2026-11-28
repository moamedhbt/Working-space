import React, { useState } from 'react';
import {
  Save, Upload, FileText, Code2, Box, History, Eye, Trash2, X,
  Plus, CheckCircle2, AlertTriangle, Clock
} from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';
import ModelViewer3D from './ModelViewer3D';
import ParametricBuilder3D from './ParametricBuilder3D';
import CreateOfModal from './CreateOfModal';
import TimelineModal from './TimelineModal';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BeView({ state, user, reload }) {
  const activePieces = (state.pieces || []).filter(p => !p.archived && p.statut !== 'Refusé');
  const [selectedPieceId, setSelectedPieceId] = useState('');
  const [viewerFile, setViewerFile] = useState({ url: null, name: '' });
  const [notesByKey, setNotesByKey] = useState({});
  const [uploadingKey, setUploadingKey] = useState('');
  const [historyOpen, setHistoryOpen] = useState({});
  const [codeModal, setCodeModal] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [timelinePiece, setTimelinePiece] = useState(null);
  const [toast, setToast] = useState({ type: 'ok', text: '' });

  const selectedPiece = activePieces.find(p => p.id === selectedPieceId) || activePieces[0] || null;
  const openBeStops = (state.stops || []).filter(s => s.statut === 'Ouvert' && s.cibleRole === 'be');

  function notify(text, type = 'ok') {
    setToast({ type, text });
    setTimeout(() => setToast({ type: 'ok', text: '' }), 4000);
  }

  async function uploadBeFile(pieceId, categorie, file) {
    if (!file) return;
    const key = `${pieceId}_${categorie}`;
    setUploadingKey(key);
    try {
      const base64 = await fileToBase64(file);
      const res = await api(`/api/pieces/${pieceId}/be-files`, 'POST', {
        categorie,
        filename: file.name,
        base64,
        notes: notesByKey[key] || ''
      });
      setNotesByKey(prev => ({ ...prev, [key]: '' }));
      notify(`${categorie.toUpperCase()} ${res.revision} publié sur ${pieceId} (${res.filename}).`);
      if (categorie === '3d') {
        setViewerFile({ url: res.url, name: `${pieceId} · ${res.filename} (${res.revision})` });
      }
      reload();
    } catch (e) {
      notify(e.message, 'err');
    } finally {
      setUploadingKey('');
    }
  }

  async function publishParametric3D(pieceId, filename, base64, notes) {
    const targetId = pieceId || selectedPiece?.id;
    if (!targetId) return;
    try {
      const res = await api(`/api/pieces/${targetId}/be-files`, 'POST', {
        categorie: '3d',
        filename,
        base64,
        notes
      });
      notify(`3D ${res.revision} publié sur ${targetId} (${res.filename}).`);
      setViewerFile({ url: res.url, name: `${targetId} · ${res.filename} (${res.revision})` });
      reload();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function validateBe(pieceId, nonRequis = false) {
    try {
      await api(`/api/pieces/${pieceId}/be-validate`, 'POST', { nonRequis });
      notify(nonRequis ? `${pieceId} marqué sans étude BE requise.` : `Dossier BE validé pour ${pieceId} !`);
      reload();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function resolveStop(stopId) {
    try {
      await api(`/api/stops/${stopId}/resolve`, 'POST');
      notify('Alerte plan/programme résolue.');
      reload();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function deleteRevision(fileId) {
    if (!window.confirm('Supprimer cette révision de fichier BE ?')) return;
    try {
      await api(`/api/be-files/${fileId}`, 'DELETE');
      notify('Révision supprimée.');
      reload();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function openCncPreview(f) {
    try {
      const res = await api(`/api/be-files/${f.id}/text`);
      setCodeModal({ title: `${f.filename} (${f.revision})`, content: res.content, url: f.url });
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function saveBE(id, e) {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/pieces/${id}/be`, 'POST', {
        nomFichier: f.nomFichier.value,
        programme: f.programme.value,
        dessin3d: f.dessin3d.value
      });
      notify(`Références BE enregistrées pour ${id}.`);
      reload();
    } catch (err) {
      notify(err.message, 'err');
    }
  }

  const slots = [
    { key: 'plan', label: 'Plan 2D (PDF / Image)', accept: '.pdf,.png,.jpg,.jpeg,.webp,.dxf', Icon: FileText },
    { key: 'cnc', label: 'Programme CNC (.nc / .tap)', accept: '.nc,.tap,.gcode,.txt', Icon: Code2 },
    { key: '3d', label: 'Modèle 3D (.STL / .STEP)', accept: '.stl,.step,.stp', Icon: Box }
  ];

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

      <CreateOfModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        state={state}
        user={user}
        onCreated={res => {
          notify(res.validationDirection ? `OF ${res.id} créé.` : `OF ${res.id} créé et envoyé au Directeur pour validation.`);
          reload();
        }}
      />
      <TimelineModal piece={timelinePiece} onClose={() => setTimelinePiece(null)} />

      {/* HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-white">Bureau d'Études & Méthodes 3D</h1>
          <p className="text-xs text-slate-400">Plans clients, lecture IA 2D, modeleur 3D paramétrique exact (.STL/.STEP) et gestion d'indices.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 rounded-[6px] bg-[#22D3EE] hover:bg-cyan-300 text-[#0B0F14] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Nouvelle pièce
        </button>
      </div>

      {/* TARGETED BE ALERTS (OPERATOR REPORTED PLAN / CNC ISSUE) */}
      {openBeStops.length > 0 && (
        <div className="p-3.5 rounded-[6px] bg-purple-500/15 border border-purple-500/40 space-y-2 text-xs">
          <div className="font-semibold text-purple-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Alertes Atelier pour le BE ({openBeStops.length})
          </div>
          {openBeStops.map(s => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 bg-[#0B0F14]/70 p-2 rounded border border-purple-500/20">
              <span>
                <strong className="font-mono-num text-[#22D3EE]">{s.pieceId}</strong> · {s.operationLibelle} — {s.motif} <span className="text-slate-400">({s.operateurNom})</span>
              </span>
              <button type="button" onClick={() => resolveStop(s.id)} className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold cursor-pointer">
                Marquer corrigé
              </button>
            </div>
          ))}
        </div>
      )}

      {/* CNC CODE PREVIEW MODAL */}
      {codeModal && (
        <div className="fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl cyber-card cyber-corners p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#1E2A38] pb-2">
              <span className="text-sm font-semibold text-white font-mono-num">{codeModal.title}</span>
              <div className="flex items-center gap-2">
                <a href={codeModal.url} download className="px-2.5 py-1 rounded bg-[#22D3EE] text-[#0B0F14] text-xs font-semibold">Télécharger</a>
                <button onClick={() => setCodeModal(null)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <pre className="bg-[#0B0F14] border border-[#1E2A38] rounded p-3 text-xs font-mono-num text-cyan-200 max-h-[65vh] overflow-auto whitespace-pre-wrap">
              {codeModal.content}
            </pre>
          </div>
        </div>
      )}

      {/* PARAMETRIC 3D CAD BUILDER + AI 2D PLAN ANALYZER */}
      <div className="space-y-2">
        {activePieces.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">OF actif dans le modeleur 3D :</span>
            <select
              value={selectedPiece?.id || ''}
              onChange={e => setSelectedPieceId(e.target.value)}
              className="p-1.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-white font-mono-num"
            >
              {activePieces.map(p => <option key={p.id} value={p.id}>{p.id} — {p.nom}</option>)}
            </select>
          </div>
        )}
        <ParametricBuilder3D piece={selectedPiece} onPublishToOf={publishParametric3D} onReload={reload} />
      </div>

      {/* 3D VIEWER FOR UPLOADED .STEP / .STL + MATERIAL CALCULATOR */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <ModelViewer3D
            fileUrl={viewerFile.url}
            fileName={viewerFile.name}
            allowUpload
            title="Inspecteur 3D (.STEP / .STL uploadés)"
          />
        </div>
        <div className="lg:col-span-4">
          <MaterialCalculator state={state} allowAssociation={false} />
        </div>
      </div>

      {/* DOSSIERS TECHNIQUES BE (VRAIS FICHIERS + REVISIONS + VALIDATION BE) */}
      <div className="cyber-card p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-sm text-white">Dossiers Techniques BE — Plans Client, Plans 2D, CNC & 3D</h2>
          <p className="text-xs text-slate-400">Chaque fichier publié est rattaché à l'OF (Rev A, Rev B…) et visible sur le poste Opérateur.</p>
        </div>

        {activePieces.map(p => {
          const files = p.beFiles || [];
          const clientFile = p.be?.clientFile;
          const showHist = !!historyOpen[p.id];

          return (
            <div key={p.id} className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3.5 text-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-sm">
                  <span className="font-mono-num text-[#22D3EE]">{p.id}</span> · <span className="text-white">{p.nom}</span>
                  <span className="text-slate-400 text-xs font-normal ml-2">({p.client})</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPieceId(p.id);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 cursor-pointer border ${
                      selectedPiece?.id === p.id
                        ? 'bg-[#22D3EE]/20 border-[#22D3EE] text-[#22D3EE] font-semibold'
                        : 'bg-[#111821] border-[#1E2A38] text-slate-300 hover:border-[#22D3EE]'
                    }`}
                  >
                    <Box className="w-3 h-3" /> {selectedPiece?.id === p.id ? 'Actif en 3D' : 'Ouvrir en 3D'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimelinePiece(p)}
                    className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Clock className="w-3.5 h-3.5 text-[#22D3EE]" /> Dossier
                  </button>
                  {files.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                      className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] text-slate-300 text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" /> Révisions ({files.length})
                    </button>
                  )}
                  {p.beValide || p.beNonRequis ? (
                    <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {p.beNonRequis ? 'BE non requis' : 'BE validé'}
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => validateBe(p.id, false)}
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Valider Dossier BE
                      </button>
                      <button
                        type="button"
                        onClick={() => validateBe(p.id, true)}
                        className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] text-slate-300 text-[10px] cursor-pointer"
                      >
                        Sans BE
                      </button>
                    </>
                  )}
                </div>
              </div>

              {clientFile && (
                <div className="p-2 rounded bg-cyan-950/20 border border-[#22D3EE]/30 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-200">
                    📎 <strong className="text-[#22D3EE]">Plan Client fourni :</strong> {clientFile.filename}
                  </span>
                  <div className="flex gap-1.5">
                    <a href={clientFile.url} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[#22D3EE] text-[#0B0F14] font-semibold">
                      Ouvrir Plan Client
                    </a>
                    <button
                      type="button"
                      onClick={() => { setSelectedPieceId(p.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className="px-2 py-0.5 rounded bg-[#111821] border border-[#22D3EE]/40 text-[#22D3EE] cursor-pointer"
                    >
                      Modéliser en 3D
                    </button>
                  </div>
                </div>
              )}

              {/* 3 FILE UPLOAD SLOTS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {slots.map(({ key, label, accept, Icon }) => {
                  const activeFile = files.find(f => f.categorie === key && f.isActive);
                  const upKey = `${p.id}_${key}`;
                  const isUp = uploadingKey === upKey;

                  return (
                    <div key={key} className="bg-[#111821] border border-[#1E2A38] rounded-[6px] p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-slate-200 flex items-center gap-1.5 text-[11px]">
                          <Icon className="w-3.5 h-3.5 text-[#22D3EE]" /> {label}
                        </span>
                        {activeFile && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono-num text-[10px]">
                            {activeFile.revision}
                          </span>
                        )}
                      </div>

                      {activeFile ? (
                        <div className="bg-[#0B0F14] border border-[#1E2A38] rounded p-2 space-y-1.5">
                          <div className="font-mono-num text-[11px] text-white truncate" title={activeFile.filename}>{activeFile.filename}</div>
                          {activeFile.notes && <div className="text-[10px] text-amber-300">{activeFile.notes}</div>}
                          <div className="text-[10px] text-slate-500">{activeFile.uploadedBy} · {activeFile.createdAt}</div>
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {key === 'plan' && (
                              <a href={activeFile.url} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[#22D3EE]/15 text-[#22D3EE] text-[10px] flex items-center gap-1">
                                <Eye className="w-3 h-3" /> Ouvrir
                              </a>
                            )}
                            {key === 'cnc' && (
                              <button type="button" onClick={() => openCncPreview(activeFile)} className="px-2 py-0.5 rounded bg-[#22D3EE]/15 text-[#22D3EE] text-[10px] flex items-center gap-1 cursor-pointer">
                                <Eye className="w-3 h-3" /> Lire CNC
                              </button>
                            )}
                            {key === '3d' && (
                              <button
                                type="button"
                                onClick={() => setViewerFile({ url: activeFile.url, name: `${p.id} · ${activeFile.filename} (${activeFile.revision})` })}
                                className="px-2 py-0.5 rounded bg-[#22D3EE]/15 text-[#22D3EE] text-[10px] flex items-center gap-1 cursor-pointer"
                              >
                                <Box className="w-3 h-3" /> Voir en 3D
                              </button>
                            )}
                            <a href={activeFile.url} download={activeFile.filename} className="px-2 py-0.5 rounded bg-[#111821] border border-[#1E2A38] text-slate-300 text-[10px]">
                              Télécharger
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 italic">Aucun fichier publié</div>
                      )}

                      <div className="space-y-1.5 pt-1">
                        <input
                          value={notesByKey[upKey] || ''}
                          onChange={e => setNotesByKey(prev => ({ ...prev, [upKey]: e.target.value }))}
                          placeholder="Note révision (optionnel)"
                          className="w-full p-1.5 rounded bg-[#0B0F14] border border-[#1E2A38] text-[11px]"
                        />
                        <label className="w-full py-1.5 rounded bg-[#22D3EE]/15 hover:bg-[#22D3EE] text-[#22D3EE] hover:text-[#0B0F14] border border-[#22D3EE]/40 font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition">
                          <Upload className="w-3.5 h-3.5" />
                          {isUp ? 'Publication...' : (activeFile ? 'Publier nouvelle révision' : 'Importer fichier')}
                          <input type="file" accept={accept} className="hidden" disabled={isUp} onChange={e => uploadBeFile(p.id, key, e.target.files?.[0])} />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              {showHist && files.length > 0 && (
                <div className="bg-[#111821] border border-[#1E2A38] rounded p-2.5 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Historique des révisions</div>
                  {files.map(f => (
                    <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1 border-b border-[#1E2A38]/60 last:border-0 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`px-1.5 py-0.5 rounded font-mono-num text-[10px] ${f.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                          {f.categorie.toUpperCase()} · {f.revision}{f.isActive ? ' (ACTIVE)' : ''}
                        </span>
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-slate-200 hover:text-[#22D3EE] truncate font-mono-num">{f.filename}</a>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-[10px] text-slate-500">
                        <span>{f.uploadedBy} · {f.createdAt}</span>
                        <button type="button" onClick={() => deleteRevision(f.id)} className="text-red-400 hover:text-red-300 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={e => saveBE(p.id, e)} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-[#1E2A38]">
                <input name="nomFichier" defaultValue={p.be.nomFichier} placeholder="Référence plan" className="p-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38]" />
                <input name="programme" defaultValue={p.be.programme} placeholder="Réf. Programme CNC" className="p-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] font-mono-num" />
                <input name="dessin3d" defaultValue={p.be.dessin3d} placeholder="Réf. Dessin 3D" className="p-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] font-mono-num" />
                <button type="submit" className="px-3 py-1.5 rounded-[6px] bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-200 font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                  <Save className="w-3.5 h-3.5" /> Enregistrer réf.
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
