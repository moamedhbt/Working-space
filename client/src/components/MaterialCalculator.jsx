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
    error = 'Longueur et quantité doivent être supérieures à 0.';
  } else if (shape === 'rond') {
    if (d <= 0) error = 'Le diamètre doit être > 0.';
    else volCm3 = Math.PI * Math.pow(d / 20, 2) * (len / 10);
  } else if (shape === 'plat') {
    if (w <= 0 || h <= 0) error = 'Largeur et épaisseur doivent être > 0.';
    else volCm3 = (w / 10) * (h / 10) * (len / 10);
  } else if (shape === 'tube') {
    if (d <= 0 || di < 0 || di >= d) error = 'Diamètre intérieur doit être inférieur au diamètre extérieur.';
    else volCm3 = Math.PI * (Math.pow(d / 20, 2) - Math.pow(di / 20, 2)) * (len / 10);
  }

  const unitKg = error ? 0 : (volCm3 * density) / 1000;
  const totalKg = unitKg * qty;
  const totalLenM = ((len + 3) * qty) / 1000;

  return (
    <div className="cyber-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Scale className="w-4 h-4 text-[#22D3EE]" /> Calculateur matière première
      </div>

      <div className="bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-2.5 flex items-center justify-center">
        <svg width="160" height="72" viewBox="0 0 160 72">
          {shape === 'rond' && (
            <>
              <circle cx="42" cy="36" r="22" fill="none" stroke="#22D3EE" strokeWidth="2" />
              <line x1="20" y1="36" x2="64" y2="36" stroke="#64748B" strokeDasharray="3" />
              <rect x="82" y="18" width="60" height="36" fill="none" stroke="#38BDF8" strokeWidth="1.5" />
              <text x="26" y="68" fill="#22D3EE" fontSize="10" fontFamily="JetBrains Mono">Ø {d} mm</text>
              <text x="94" y="68" fill="#94A3B8" fontSize="10" fontFamily="JetBrains Mono">L={len}</text>
            </>
          )}
          {shape === 'plat' && (
            <>
              <rect x="25" y="16" width="110" height="32" fill="none" stroke="#22D3EE" strokeWidth="2" />
              <text x="45" y="64" fill="#22D3EE" fontSize="10" fontFamily="JetBrains Mono">{w} × {h} × {len} mm</text>
            </>
          )}
          {shape === 'tube' && (
            <>
              <circle cx="50" cy="36" r="24" fill="none" stroke="#22D3EE" strokeWidth="2" />
              <circle cx="50" cy="36" r="12" fill="none" stroke="#F59E0B" strokeWidth="1.5" />
              <text x="86" y="32" fill="#22D3EE" fontSize="10" fontFamily="JetBrains Mono">Øext {d}</text>
              <text x="86" y="48" fill="#F59E0B" fontSize="10" fontFamily="JetBrains Mono">Øint {di}</text>
            </>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <label className="text-[11px] text-slate-400">Forme</label>
          <select value={shape} onChange={e => setShape(e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
            <option value="rond">Rond (barre)</option>
            <option value="plat">Plat (rect.)</option>
            <option value="tube">Tube (creux)</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-400">Matière · densité</label>
          <select value={matIdx} onChange={e => setMatIdx(+e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38]">
            {MATERIALS.map((m, i) => <option key={m.name} value={i}>{m.name} ({m.density})</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-400">Quantité</label>
          <input type="number" value={qty} onChange={e => setQty(+e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" />
        </div>
        {(shape === 'rond' || shape === 'tube') && (
          <div><label className="text-[11px] text-slate-400">Ø ext. (mm)</label><input type="number" value={d} onChange={e => setD(+e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
        )}
        {shape === 'tube' && (
          <div><label className="text-[11px] text-slate-400">Ø int. (mm)</label><input type="number" value={di} onChange={e => setDi(+e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
        )}
        {shape === 'plat' && (
          <>
            <div><label className="text-[11px] text-slate-400">Largeur (mm)</label><input type="number" value={w} onChange={e => setW(+e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
            <div><label className="text-[11px] text-slate-400">Épaisseur (mm)</label><input type="number" value={h} onChange={e => setH(+e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
          </>
        )}
        <div className="col-span-2"><label className="text-[11px] text-slate-400">Longueur (mm)</label><input type="number" value={len} onChange={e => setLen(+e.target.value)} className="w-full mt-1 p-2 rounded-[6px] bg-[#0B0F14] border border-[#1E2A38] font-mono-num" /></div>
      </div>

      {error ? (
        <div className="p-2 rounded-[6px] bg-red-500/10 border border-red-500/30 text-red-400 text-xs">{error}</div>
      ) : (
        <div className="grid grid-cols-3 gap-2 bg-[#0B0F14] border border-[#1E2A38] rounded-[6px] p-2.5 text-center">
          <div><span className="text-[10px] text-slate-500 block">PAR PIÈCE</span><strong className="text-xs font-mono-num text-white">{unitKg.toFixed(2)} KG</strong></div>
          <div><span className="text-[10px] text-slate-500 block">TOTAL · {qty} PCS</span><strong className="text-xs font-mono-num text-emerald-400">{totalKg.toFixed(2)} KG</strong></div>
          <div><span className="text-[10px] text-slate-500 block">BARRE (+3 MM)</span><strong className="text-xs font-mono-num text-[#22D3EE]">{totalLenM.toFixed(2)} M</strong></div>
        </div>
      )}
    </div>
  );
}
