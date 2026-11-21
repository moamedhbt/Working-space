import React, { useState } from 'react';
import { Scale } from 'lucide-react';

const MATERIALS = [
  { name: 'Acier (42CrMo4 / S235)', density: 7.85 },
  { name: 'Inox (304L / 316L)', density: 7.90 },
  { name: 'Aluminium (7075 / 6061)', density: 2.70 },
  { name: 'Bronze (CuSn12)', density: 8.80 },
  { name: 'Laiton (CuZn39Pb3)', density: 8.50 },
  { name: 'Fonte', density: 7.20 },
  { name: 'Plastique POM / Delrin', density: 1.41 },
  { name: 'Plastique Nylon PA6', density: 1.15 },
  { name: 'Plastique PTFE / Téflon', density: 2.20 }
];

export default function MaterialCalculator() {
  const [shape, setShape] = useState('rond');
  const [matIdx, setMatIdx] = useState(0);
  const [d, setD] = useState(50);
  const [di, setDi] = useState(20);
  const [w, setW] = useState(80);
  const [h, setH] = useState(20);
  const [len, setLen] = useState(100);
  const [qty, setQty] = useState(10);

  const density = MATERIALS[matIdx].density;
  let error = '';
  let volCm3 = 0;

  if (len <= 0 || qty <= 0) {
    error = '⚠️ Longueur et quantité doivent être supérieures à 0.';
  } else if (shape === 'rond') {
    if (d <= 0) error = '⚠️ Le diamètre doit être > 0.';
    else volCm3 = Math.PI * Math.pow(d / 20, 2) * (len / 10);
  } else if (shape === 'plat') {
    if (w <= 0 || h <= 0) error = '⚠️ Largeur et épaisseur doivent être > 0.';
    else volCm3 = (w / 10) * (h / 10) * (len / 10);
  } else if (shape === 'tube') {
    if (d <= 0 || di < 0 || di >= d) error = '⚠️ Diamètre intérieur doit être inférieur au diamètre extérieur.';
    else volCm3 = Math.PI * (Math.pow(d / 20, 2) - Math.pow(di / 20, 2)) * (len / 10);
  }

  const unitKg = error ? 0 : (volCm3 * density) / 1000;
  const totalKg = unitKg * qty;
  const totalLenM = ((len + 3) * qty) / 1000;

  return (
    <div className="bg-[#11192b] border border-cyan-500/30 rounded-2xl p-4 space-y-4">
      <h3 className="font-bold text-base flex items-center gap-2 text-cyan-300">
        <Scale className="w-5 h-5" /> Calculateur Matière Première (Poids Exact en kg)
      </h3>

      <div className="grid md:grid-cols-3 gap-4 items-center">
        {/* 2D SVG Technical Drawing */}
        <div className="bg-[#060a14] border border-slate-800 rounded-xl p-3 flex flex-col items-center justify-center">
          <svg width="150" height="90" viewBox="0 0 150 90">
            {shape === 'rond' && (
              <>
                <circle cx="45" cy="45" r="26" fill="none" stroke="#22d3ee" strokeWidth="2.5" />
                <line x1="19" y1="45" x2="71" y2="45" stroke="#94a3b8" strokeDasharray="3" />
                <text x="38" y="84" fill="#22d3ee" fontSize="11">Ø {d} mm</text>
                <rect x="85" y="25" width="50" height="40" fill="none" stroke="#3b82f6" strokeWidth="2" />
                <text x="95" y="84" fill="#94a3b8" fontSize="11">L={len}</text>
              </>
            )}
            {shape === 'plat' && (
              <>
                <rect x="20" y="25" width="110" height="35" fill="none" stroke="#22d3ee" strokeWidth="2.5" />
                <text x="55" y="78" fill="#22d3ee" fontSize="11">{w} × {h} × {len} mm</text>
              </>
            )}
            {shape === 'tube' && (
              <>
                <circle cx="55" cy="45" r="28" fill="none" stroke="#22d3ee" strokeWidth="2.5" />
                <circle cx="55" cy="45" r="14" fill="none" stroke="#f59e0b" strokeWidth="2" />
                <text x="92" y="40" fill="#22d3ee" fontSize="11">Øext {d}</text>
                <text x="92" y="56" fill="#f59e0b" fontSize="11">Øint {di}</text>
              </>
            )}
          </svg>
        </div>

        {/* Inputs */}
        <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div>
            <label className="text-slate-400">Forme</label>
            <select value={shape} onChange={e => setShape(e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700">
              <option value="rond">Rond (Barre)</option>
              <option value="plat">Plat (Carré/Rect)</option>
              <option value="tube">Tube (Creux)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-slate-400">Matière (Densité)</label>
            <select value={matIdx} onChange={e => setMatIdx(+e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700">
              {MATERIALS.map((m, i) => <option key={m.name} value={i}>{m.name} ({m.density})</option>)}
            </select>
          </div>
          <div>
            <label className="text-slate-400">Quantité</label>
            <input type="number" value={qty} onChange={e => setQty(+e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" />
          </div>

          {(shape === 'rond' || shape === 'tube') && (
            <div><label className="text-slate-400">Ø Ext (mm)</label><input type="number" value={d} onChange={e => setD(+e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
          )}
          {shape === 'tube' && (
            <div><label className="text-slate-400">Ø Int (mm)</label><input type="number" value={di} onChange={e => setDi(+e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
          )}
          {shape === 'plat' && (
            <>
              <div><label className="text-slate-400">Largeur (mm)</label><input type="number" value={w} onChange={e => setW(+e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
              <div><label className="text-slate-400">Épaisseur (mm)</label><input type="number" value={h} onChange={e => setH(+e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
            </>
          )}
          <div><label className="text-slate-400">Longueur (mm)</label><input type="number" value={len} onChange={e => setLen(+e.target.value)} className="w-full p-2 rounded bg-[#060a14] border border-slate-700" /></div>
        </div>
      </div>

      {error ? (
        <div className="p-2.5 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-bold">{error}</div>
      ) : (
        <div className="grid grid-cols-3 gap-3 bg-[#060a14] border border-slate-800 rounded-xl p-3 text-xs text-center">
          <div><span className="text-slate-400 block">Poids / pièce</span><strong className="text-sm text-white">{unitKg.toFixed(2)} kg</strong></div>
          <div><span className="text-slate-400 block">Poids Total ({qty} pcs)</span><strong className="text-sm text-emerald-400">{totalKg.toFixed(2)} kg</strong></div>
          <div><span className="text-slate-400 block">Longueur (+3mm coupe)</span><strong className="text-sm text-cyan-400">{totalLenM.toFixed(2)} m</strong></div>
        </div>
      )}
    </div>
  );
}
