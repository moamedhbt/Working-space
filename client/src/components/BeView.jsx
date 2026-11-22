import React, { useState } from 'react';
import {
  Save, Upload, Download, CheckSquare, FileText, Code2, Box,
  History, Eye, Trash2, X
} from 'lucide-react';
import { api } from '../api';
import MaterialCalculator from './MaterialCalculator';
import ModelViewer3D from './ModelViewer3D';

function generateBoxSTL(L, W, H) {
  const x = L / 2, y = W / 2, z = H / 2;
  const tris = [
    [[-x,-y,z],[x,-y,z],[x,y,z]], [[-x,-y,z],[x,y,z],[-x,y,z]],
    [[-x,-y,-z],[x,y,-z],[x,-y,-z]], [[-x,-y,-z],[-x,y,-z],[x,y,-z]],
    [[-x,y,-z],[-x,y,z],[x,y,z]], [[-x,y,-z],[x,y,z],[x,y,-z]],
    [[-x,-y,-z],[x,-y,z],[-x,-y,z]], [[-x,-y,-z],[x,-y,-z],[x,-y,z]],
    [[x,-y,-z],[x,y,z],[x,-y,z]], [[x,-y,-z],[x,y,-z],[x,y,z]],
    [[-x,-y,-z],[-x,-y,z],[-x,y,z]], [[-x,-y,-z],[-x,y,z],[-x,y,-z]]
  ];
  let stl = 'solid piece\n';
  tris.forEach(t => {
    stl += '  facet normal 0 0 0\n    outer loop\n';
    t.forEach(v => { stl += `      vertex ${v[0]} ${v[1]} ${v[2]}\n`; });
    stl += '    endloop\n  endfacet\n';
  });
  stl += 'endsolid piece\n';
  return stl;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BeView({ state, reload }) {
  const [dims, setDims] = useState({ longueur: 120, largeur: 60, hauteur: 40 });
  const [appliedDims, setAppliedDims] = useState({ longueur: 120, largeur: 60, hauteur: 40 });
  const [verified, setVerified] = useState(false);
  const [viewerFile, setViewerFile] = useState({ url: null, name: '' });
  const [notesByKey, setNotesByKey] = useState({});
  const [uploadingKey, setUploadingKey] = useState('');
  const [historyOpen, setHistoryOpen] = useState({});
  const [codeModal, setCodeModal] = useState(null);
  const [toast, setToast] = useState({ type: 'ok', text: '' });

  function notify(text, type = 'ok') {
    setToast({ type, text });
    setTimeout(() => setToast({ type: 'ok', text: '' }), 4000);
  }

  function downloadSTL() {
    if (!verified) return notify('Cochez "Cotes vérifiées par le BE" avant le téléchargement.', 'err');
    const stl = generateBoxSTL(dims.longueur, dims.largeur, dims.hauteur);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([stl], { type: 'application/octet-stream' }));
    a.download = `piece_${dims.longueur}x${dims.largeur}x${dims.hauteur}.stl`;
    a.click();
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
    { key: 'plan', label: 'Plan PDF / Dessin 2D', accept: '.pdf,.png,.jpg,.jpeg,.webp,.dxf', Icon: FileText },
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

      {/* CNC CODE PREVIEW MODAL */}
      {codeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
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

      {/* 3D VIEWER + PROPERTIES */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <ModelViewer3D
            dims={appliedDims}
            fileUrl={viewerFile.url}
            fileName={viewerFile.name}
            allowUpload
          />
        </div>

        <div className="lg:col-span-4 space-y-4">
          <div className="cyber-card p-4 space-y-3 text-xs">
            <div className="font-semibold text-sm text-white">Générateur Brut 3D & Validation BE</div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[10px] text-slate-400">L (mm)</label><input type="number" value={dims.longueur} onChange={e => setDims({ ...dims, longueur: +e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
              <div><label className="text-[10px] text-slate-400">l (mm)</label><input type="number" value={dims.largeur} onChange={e => setDims({ ...dims, largeur: +e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
              <div><label className="text-[10px] text-slate-400">H (mm)</label><input type="number" value={dims.hauteur} onChange={e => setDims({ ...dims, hauteur: +e.target.value })} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
            </div>
            <button
              type="button"
              onClick={() => { setViewerFile({ url: null, name: '' }); setAppliedDims({ ...dims }); }}
              className="w-full py-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] hover:border-[#22D3EE] font-medium cursor-pointer"
            >
              Mettre à jour le modèle 3D
            </button>
            <label className="flex items-center gap-2 cursor-pointer text-slate-300 pt-1">
              <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} className="accent-[#22D3EE]" />
              <CheckSquare className="w-3.5 h-3.5 text-[#22D3EE]" /> Cotes vérifiées par le BE (obligatoire)
            </label>
            <button type="button" onClick={downloadSTL} className={`w-full py-2 rounded-[6px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${verified ? 'bg-[#22D3EE] text-[#0B0F14]' : 'bg-slate-800 text-slate-500'}`}>
              <Download className="w-3.5 h-3.5" /> Télécharger .STL
            </button>
          </div>

          <MaterialCalculator />
        </div>
      </div>

      {/* DOSSIERS TECHNIQUES BE (VRAIS FICHIERS + REVISIONS) */}
      <div className="cyber-card p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-sm text-white">Dossiers Techniques BE — Plans PDF, Programmes CNC & 3D (avec Révisions)</h2>
          <p className="text-xs text-slate-400">Chaque fichier publié crée une nouvelle révision active (Rev A, Rev B…) immédiatement consultable sur le poste Opérateur.</p>
        </div>

        {state.pieces.filter(p => !p.archived).map(p => {
          const files = p.beFiles || [];
          const showHist = !!historyOpen[p.id];

          return (
            <div key={p.id} className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-3.5 text-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-sm">
                  <span className="font-mono-num text-[#22D3EE]">{p.id}</span> · <span className="text-white">{p.nom}</span>
                  <span className="text-slate-400 text-xs font-normal ml-2">({p.client})</span>
                </div>
                <div className="flex items-center gap-2">
                  {files.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                      className="px-2 py-1 rounded bg-[#111821] border border-[#1E2A38] hover:border-[#22D3EE] text-slate-300 text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" /> Historique ({files.length})
                    </button>
                  )}
                  <span className="text-[11px] text-[#22D3EE]">{p.urgence} · {p.statut}</span>
                </div>
              </div>

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
                                onClick={() => {
                                  setViewerFile({ url: activeFile.url, name: `${p.id} · ${activeFile.filename} (${activeFile.revision})` });
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
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
                          placeholder="Note révision (optionnel, ex: tolérance H7)"
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

              {/* REVISION HISTORY */}
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
                        {f.notes && <span className="text-slate-400 truncate">— {f.notes}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-[10px] text-slate-500">
                        <span>{f.uploadedBy} · {f.createdAt}</span>
                        <button type="button" onClick={() => deleteRevision(f.id)} className="text-red-400 hover:text-red-300 cursor-pointer" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* QUICK TEXT REFERENCES (COMPATIBILITY) */}
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
