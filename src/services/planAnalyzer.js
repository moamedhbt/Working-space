const path = require('path');
const { getAiSettings } = require('../db/database');

const MATERIALS_REGEX = [
  /CuZn\d+[A-Za-z0-9]*/i,
  /42CrMo4/i, /XC48|C45/i, /35NCD16/i, /S235|S355/i,
  /Bronze\s*(?:au\s+mangan[èe]se|CuSn12|UE12)?/i,
  /Laiton\s*(?:sp[ée]cial|CuZn\d+)?/i,
  /Acier\s+[A-Z0-9-]+/i,
  /Alu(?:minium)?\s*(?:7075|6061|2017|AU4G|AG3)?/i,
  /Inox\s*(?:304L?|316L?|310)?/i,
  /POM|Delrin|PTFE|Teflon|Nylon/i
];

function buildDefaultCadSpec(extracted) {
  const partType = extracted.partType || 'arbre';
  const od = Math.max(6, Number(extracted.outerDiameter) || 50);
  const id = Math.max(0, Math.min(od - 2, Number(extracted.innerDiameter) || 0));
  const len = Math.max(4, Number(extracted.length) || 100);
  const w = Math.max(6, Number(extracted.width) || 80);
  const thk = Math.max(2, Number(extracted.thickness) || 20);
  const holeCount = Math.max(0, Math.min(24, parseInt(extracted.holeCount, 10) || 0));
  const holeD = Math.max(1, Number(extracted.holeDiameter) || 10);
  const pcd = Math.max(id + holeD + 2, Math.min(od - holeD - 2, Number(extracted.pcd) || Math.round(od * 0.72)));

  const features = [];
  if (partType === 'plaque') {
    features.push({ id: 'f1', label: `Bloc ${len}×${w}×${thk}`, op: 'add_box', lx: len, ly: w, lz: thk, x: 0, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f2', label: `Alésage Ø${id}`, op: 'cut_bore', axis: 'z', diameter: id, length: thk + 4, x: 0, y: 0, z: 0 });
    if (holeCount > 0) {
      features.push({ id: 'f3', label: `${holeCount}× Perçages Ø${holeD}`, op: 'cut_hole_pattern', axis: 'z', count: holeCount, holeDiameter: holeD, pcd: Math.min(len, w) * 0.7, depth: thk + 4, startAngleDeg: 45, x: 0, y: 0, z: 0 });
    }
  } else if (partType === 'bride') {
    features.push({ id: 'f1', label: `Disque Ø${od} ép.${thk}`, op: 'add_cylinder', axis: 'z', diameter: od, length: thk, x: 0, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f2', label: `Alésage central Ø${id}`, op: 'cut_bore', axis: 'z', diameter: id, length: thk + 4, x: 0, y: 0, z: 0 });
    if (holeCount > 0) {
      features.push({ id: 'f3', label: `${holeCount}× Trous Ø${holeD} sur PCD Ø${pcd}`, op: 'cut_hole_pattern', axis: 'z', count: holeCount, holeDiameter: holeD, pcd, depth: thk + 4, startAngleDeg: 0, x: 0, y: 0, z: 0 });
    }
  } else if (partType === 'bague') {
    features.push({ id: 'f1', label: `Cylindre ext. Ø${od} L${len}`, op: 'add_cylinder', axis: 'x', diameter: od, length: len, x: 0, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f2', label: `Alésage Ø${id}`, op: 'cut_bore', axis: 'x', diameter: id, length: len + 4, x: 0, y: 0, z: 0 });
  } else if (partType === 'ecrou_complexe') {
    // Rich multi-feature mechanical nut / sleeve template (collar + flats + bore + radial holes + central groove)
    const bodyLen = Math.round(len * 0.82);
    const collarOd = Math.round(od * 0.79);
    features.push({ id: 'f1', label: `Corps principal Ø${od} L${bodyLen}`, op: 'add_cylinder', axis: 'x', diameter: od, length: bodyLen, x: 0, y: 0, z: 0 });
    features.push({ id: 'f2', label: `Manchons extrémités Ø${collarOd} L${len}`, op: 'add_cylinder', axis: 'x', diameter: collarOd, length: len, x: 0, y: 0, z: 0 });
    features.push({ id: 'f3', label: `Méplat supérieur (${Math.round(od * 0.95)} mm)`, op: 'cut_flat', side: '+y', distanceFromCenter: Math.round(od * 0.45), span: len + 10 });
    features.push({ id: 'f4', label: `Alésage central Ø${id || Math.round(od * 0.5)}`, op: 'cut_bore', axis: 'x', diameter: id || Math.round(od * 0.5), length: len + 10, x: 0, y: 0, z: 0 });
    features.push({ id: 'f5', label: `${holeCount || 6}× Perçages Ø${holeD} sur PCD Ø${pcd}`, op: 'cut_hole_pattern', axis: 'x', count: holeCount || 6, holeDiameter: holeD, pcd, depth: len + 10, startAngleDeg: 30, x: 0, y: 0, z: 0 });
    features.push({ id: 'f6', label: 'Rainure centrale L25', op: 'cut_slot', lx: 25, ly: od + 10, lz: 10, x: 0, y: 0, z: Math.round(od * 0.48) });
  } else {
    // Arbre étagé
    features.push({ id: 'f1', label: `Arbre Ø${od} L${len}`, op: 'add_cylinder', axis: 'x', diameter: od, length: len, x: 0, y: 0, z: 0 });
    const s2d = Math.max(6, Math.round(od * 0.72));
    const s2l = Math.max(10, Math.round(len * 0.3));
    features.push({ id: 'f2', label: `Épaulement Ø${s2d} L${s2l}`, op: 'add_cylinder', axis: 'x', diameter: s2d, length: s2l, x: (len + s2l) / 2, y: 0, z: 0 });
    if (id > 0) features.push({ id: 'f3', label: `Alésage axial Ø${id}`, op: 'cut_bore', axis: 'x', diameter: id, length: len + s2l + 10, x: s2l / 2, y: 0, z: 0 });
  }

  return {
    unit: 'mm',
    name: extracted.partName || `Piece_${partType}`,
    features
  };
}

function extractLocalDimensions(text = '', filename = '') {
  const src = `${filename} ${text}`.replace(/\s+/g, ' ');
  const holesMatch = src.match(/(\d+)\s*[x×]\s*(?:Ø|ø|M)\s*(\d+(?:[.,]\d+)?)/i);
  const srcWithoutHoles = holesMatch ? src.replace(holesMatch[0], ' ') : src;

  const diameters = [...srcWithoutHoles.matchAll(/(?:Ø|ø|\bdiam(?:ètre|etre)?|\bD)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi)]
    .map(m => parseFloat(m[1].replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 2000);

  const lengthMatch = src.match(/\b(?:L|Long(?:ueur)?|Ht)\s*[:=]?\s*(\d+(?:[.,]\d+)?)|\bH\s*[:=]\s*(\d+(?:[.,]\d+)?)/i);
  const lengthRaw = lengthMatch ? (lengthMatch[1] || lengthMatch[2]) : null;
  const widthMatch = src.match(/\b(?:Larg(?:eur)?|W)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const thickMatch = src.match(/\b(?:ep|ép(?:aisseur)?|thk)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const pcdMatch = src.match(/\b(?:PCD|entraxe|Ø\s*per[çc]age)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const threadMatch = src.match(/\b(Tr\s*\d+\s*[x×]\s*\d+(?:\s*P\(\d+\))?(?:\s*\d+-START)?|M\d+(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?)/i);
  const tolerances = [...src.matchAll(/(?:±\s*\d+(?:[.,]\d+)?|\+\d+[.,]\d+\/\d+|\b(?:H|h|g|f|k|m|n|p|js|JS|G|F|K|N|P)\d{1,2}\b|Ra\s*\d+(?:[.,]\d+)?)/g)]
    .map(m => m[0])
    .slice(0, 8);

  let material = '';
  for (const re of MATERIALS_REGEX) {
    const m = src.match(re);
    if (m) {
      material = m[0].trim();
      break;
    }
  }

  let partType = 'arbre';
  const low = src.toLowerCase();
  if (/ecrou|écrou|screw|vis femelle|tr\s*\d|manchon/.test(low)) partType = 'ecrou_complexe';
  else if (/bride|flange|plateau|disque/.test(low)) partType = 'bride';
  else if (/bague|douille|entretoise|palier/.test(low)) partType = 'bague';
  else if (/plaque|bloc|support|cale|plat|semelle/.test(low)) partType = 'plaque';

  const uniqueDiams = [...new Set(diameters)].sort((a, b) => b - a);
  const outerDiameter = uniqueDiams[0] || (partType === 'ecrou_complexe' ? 120 : partType === 'bride' ? 120 : partType === 'bague' ? 50 : 45);
  const innerDiameter = uniqueDiams.length > 1
    ? uniqueDiams[1]
    : (partType === 'bague' || partType === 'ecrou_complexe' ? Math.round(outerDiameter * 0.5) : partType === 'bride' ? Math.round(outerDiameter * 0.35) : 0);

  const length = lengthRaw ? parseFloat(lengthRaw.replace(',', '.')) : (partType === 'ecrou_complexe' ? 230 : partType === 'bride' ? 20 : partType === 'bague' ? 40 : 120);
  const width = widthMatch ? parseFloat(widthMatch[1].replace(',', '.')) : 80;
  const thickness = thickMatch ? parseFloat(thickMatch[1].replace(',', '.')) : 20;
  const holeCount = holesMatch ? parseInt(holesMatch[1], 10) : (partType === 'bride' || partType === 'ecrou_complexe' ? 6 : partType === 'plaque' ? 4 : 0);
  const holeDiameter = holesMatch ? parseFloat(holesMatch[2].replace(',', '.')) : 10;
  const pcd = pcdMatch ? parseFloat(pcdMatch[1].replace(',', '.')) : Math.round(outerDiameter * 0.72);

  const rawStock = partType === 'plaque'
    ? `Plat / Bloc ${Math.ceil(length + 6)}×${Math.ceil(width + 6)}×${Math.ceil(thickness + 4)} mm`
    : `Rond Ø${Math.ceil(outerDiameter + 5)} × L${Math.ceil(length + 10)} mm`;

  const suggestedOperations = [];
  if (partType === 'plaque') {
    suggestedOperations.push({ libelle: 'Fraisage CNC (surfaçage + contour + perçages)', typeMachine: 'Fraisage CNC', tempsReglageMin: 30, tempsUnitaireMin: 15 });
  } else {
    suggestedOperations.push({ libelle: `Tournage CNC (ébauche + finition Ø${outerDiameter}${threadMatch ? ` + ${threadMatch[1]}` : ''})`, typeMachine: 'Tournage CNC', tempsReglageMin: 30, tempsUnitaireMin: 18 });
    if (holeCount > 0 || partType === 'ecrou_complexe') {
      suggestedOperations.push({ libelle: `Fraisage CNC (méplats / rainures / ${holeCount}×Ø${holeDFormat(holeDiameter)})`, typeMachine: 'Fraisage CNC', tempsReglageMin: 25, tempsUnitaireMin: 12 });
    }
  }
  suggestedOperations.push({ libelle: 'Ébavurage & Contrôle dimensionnel', typeMachine: 'Contrôle', tempsReglageMin: 10, tempsUnitaireMin: 5 });

  return {
    partType,
    partName: path.parse(filename || 'Piece').name,
    client: '',
    reference: '',
    revision: '',
    outerDiameter,
    innerDiameter,
    length,
    width,
    thickness,
    holeCount,
    holeDiameter,
    pcd,
    material: material || '',
    rawStock,
    tolerances,
    specialNotes: threadMatch ? [`Filetage détecté : ${threadMatch[1]}`] : [],
    suggestedOperations,
    detectedRaw: {
      diameters: uniqueDiams,
      hasText: text.trim().length > 0
    }
  };
}

function holeDFormat(v) {
  return Number.isFinite(Number(v)) ? v : 10;
}

function extractReadableTextFromPdfBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return '';
  const raw = buf.toString('latin1');
  const matches = [...raw.matchAll(/\(([^()\\]{2,120})\)/g)].map(m => m[1]);
  return matches.join(' ').replace(/[^\x20-\x7EÀ-ÿØø±×]/g, ' ').slice(0, 6000);
}

const VISION_PROMPT = (filename, extraPrompt = '') => `Tu es un ingénieur BE / méthodes CNC expert en lecture de plans mécaniques ISO 2D et modélisation CAO paramétrique (style CadQuery / CSG).
Analyse attentivement ce plan technique 2D (${filename}) — y compris les annotations manuscrites, cartouche, vues, coupes, tolérances géométriques et notes.
${extraPrompt}

Retourne STRICTEMENT un JSON valide (aucun texte autour) respectant exactement ce schéma :
{
  "ficheTechnique": {
    "client": string,
    "reference": string,
    "revision": string,
    "partName": string,
    "material": string,
    "rawStock": string,
    "criticalTolerances": string[],
    "specialNotes": string[],
    "suggestedOperations": [
      { "libelle": string, "typeMachine": "Tournage CNC"|"Fraisage CNC"|"Tournage Manuel"|"Contrôle", "tempsReglageMin": number, "tempsUnitaireMin": number }
    ],
    "summary": string
  },
  "cadSpec": {
    "unit": "mm",
    "name": string,
    "features": [
      // Ordonne les fonctions CAO du volume principal vers les enlèvements de matière :
      // { "id": "f1", "label": string, "op": "add_cylinder", "axis": "x"|"y"|"z", "diameter": number, "length": number, "x": number, "y": number, "z": number }
      // { "id": "f2", "label": string, "op": "add_box", "lx": number, "ly": number, "lz": number, "x": number, "y": number, "z": number }
      // { "id": "f3", "label": string, "op": "cut_bore", "axis": "x"|"y"|"z", "diameter": number, "length": number, "x": number, "y": number, "z": number }
      // { "id": "f4", "label": string, "op": "cut_flat", "side": "+y"|"-y"|"+z"|"-z"|"+x"|"-x", "distanceFromCenter": number, "span": number }
      // { "id": "f5", "label": string, "op": "cut_slot", "lx": number, "ly": number, "lz": number, "x": number, "y": number, "z": number }
      // { "id": "f6", "label": string, "op": "cut_hole_pattern", "axis": "x"|"y"|"z", "count": number, "holeDiameter": number, "pcd": number, "depth": number, "startAngleDeg": number, "x": number, "y": number, "z": number }
      // { "id": "f7", "label": string, "op": "cut_groove", "axis": "x"|"y"|"z", "outerDiameter": number, "innerDiameter": number, "width": number, "pitch": number, "count": number, "x": number, "y": number, "z": number }
    ]
  }
}
Assure-toi que toutes les dimensions sont en mm, centrées autour de (0,0,0), fidèles au plan 2D.`;

function extractJsonFromText(txt) {
  if (!txt) return null;
  const trimmed = String(txt).trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return JSON.parse(m[0]);
}

function defaultModelForProvider(provider) {
  if (provider === 'gemini') return 'gemini-3.8-flash';
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'anthropic') return 'claude-sonnet-4-20250514';
  if (provider === 'openrouter') return 'google/gemini-3.8-flash';
  if (provider === 'groq') return 'meta-llama/llama-4-scout-17b-16e-instruct';
  return 'gpt-4o-mini';
}

function resolveRuntimeAiConfig(override = null) {
  const saved = getAiSettings();
  if (!override) return saved;
  const provider = override.provider !== undefined ? String(override.provider).trim() : saved.provider;
  const apiKey = override.apiKey !== undefined && String(override.apiKey).trim() !== ''
    ? String(override.apiKey).trim()
    : saved.apiKey;
  const model = override.model !== undefined ? String(override.model).trim() : saved.model;
  const baseUrl = override.baseUrl !== undefined ? String(override.baseUrl).trim() : saved.baseUrl;

  let resolvedProvider = provider || 'auto';
  if (resolvedProvider === 'auto') {
    if (!apiKey) resolvedProvider = 'offline';
    else if (apiKey.startsWith('AIza')) resolvedProvider = 'gemini';
    else if (apiKey.startsWith('sk-ant-')) resolvedProvider = 'anthropic';
    else if (apiKey.startsWith('sk-or-')) resolvedProvider = 'openrouter';
    else if (apiKey.startsWith('gsk_')) resolvedProvider = 'groq';
    else resolvedProvider = 'openai';
  }
  return { provider, resolvedProvider, apiKey, model, baseUrl, source: 'override' };
}

async function callConfiguredAiRaw({ promptText, buffer = null, mimeType = 'image/jpeg', overrideConfig = null, expectJson = true }) {
  const cfg = resolveRuntimeAiConfig(overrideConfig);
  const provider = cfg.resolvedProvider;
  if (!provider || provider === 'offline') return null;
  if (!cfg.apiKey && provider !== 'custom') return null;

  const model = cfg.model || defaultModelForProvider(provider);
  const b64 = buffer && Buffer.isBuffer(buffer) && buffer.length > 0 ? buffer.toString('base64') : null;

  if (provider === 'gemini') {
    const parts = [{ text: promptText }];
    if (b64) parts.push({ inline_data: { mime_type: mimeType, data: b64 } });

    const callOnce = async (mdl) => {
      const cleanMdl = String(mdl || '').replace(/^models\//, '');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanMdl)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] })
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json, model: cleanMdl };
    };

    let attempt = await callOnce(model);
    if (!attempt.ok) {
      const errMsg = attempt.json?.error?.message || `Gemini HTTP ${attempt.status}`;
      // Auto-retry if Google reports the model is deprecated / unavailable to new users
      if (attempt.status === 404 || /no longer available|not found/i.test(errMsg)) {
        const candidates = [];
        const suggested = errMsg.match(/use\s+(?:models\/)?([a-z0-9._-]+)/i);
        if (suggested?.[1]) candidates.push(suggested[1]);
        for (const fb of ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']) {
          if (fb !== attempt.model && !candidates.includes(fb)) candidates.push(fb);
        }
        // Also try querying live available models for this key
        try {
          const live = await listAvailableModels(overrideConfig);
          for (const m of (live.models || []).slice(0, 4)) {
            if (!candidates.includes(m)) candidates.push(m);
          }
        } catch {}
        for (const cand of candidates) {
          const retry = await callOnce(cand);
          if (retry.ok) {
            attempt = retry;
            break;
          }
        }
      }
      if (!attempt.ok) {
        throw new Error(attempt.json?.error?.message || `Gemini HTTP ${attempt.status}`);
      }
    }
    const txt = attempt.json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { provider, model: attempt.model, text: txt, data: expectJson ? extractJsonFromText(txt) : null };
  }

  if (provider === 'anthropic') {
    const content = [];
    if (b64 && mimeType !== 'application/pdf') {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: b64 }
      });
    } else if (b64 && mimeType === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64 }
      });
    }
    content.push({ type: 'text', text: promptText });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content }]
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);
    const txt = (json?.content || []).map(c => c.text || '').join('\n');
    return { provider, model, text: txt, data: expectJson ? extractJsonFromText(txt) : null };
  }

  // OpenAI / OpenRouter / Groq / Custom OpenAI-compatible
  let endpoint = 'https://api.openai.com/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    headers['HTTP-Referer'] = 'https://atelier-manager.local';
    headers['X-Title'] = 'Atelier Manager Pro';
  } else if (provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  } else if (provider === 'custom') {
    if (!cfg.baseUrl) throw new Error('URL de base requise pour un endpoint personnalisé');
    const clean = cfg.baseUrl.replace(/\/+$/, '');
    endpoint = clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
  }

  const contentParts = [{ type: 'text', text: promptText }];
  if (b64 && mimeType !== 'application/pdf') {
    contentParts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } });
  }
  const payload = {
    model,
    messages: [{ role: 'user', content: contentParts }]
  };
  if (expectJson && provider === 'openai') {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `${provider} HTTP ${res.status}`);
  const txt = json?.choices?.[0]?.message?.content || '';
  return { provider, model, text: txt, data: expectJson ? extractJsonFromText(txt) : null };
}

async function listAvailableModels(overrideConfig = null) {
  const cfg = resolveRuntimeAiConfig(overrideConfig);
  const provider = cfg.resolvedProvider;
  if (!provider || provider === 'offline' || (!cfg.apiKey && provider !== 'custom')) {
    return { ok: false, models: [], error: 'Aucune clé API configurée.' };
  }
  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Gemini HTTP ${res.status}`);
    const models = (json.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(name => /gemini/i.test(name) && !/embedding|tts|imagen|veo|aqa/i.test(name))
      .sort((a, b) => {
        const aFlash = /flash/i.test(a) ? 0 : 1;
        const bFlash = /flash/i.test(b) ? 0 : 1;
        if (aFlash !== bFlash) return aFlash - bFlash;
        return b.localeCompare(a);
      });
    return { ok: true, provider, models: models.slice(0, 25) };
  }
  if (provider === 'anthropic') {
    return {
      ok: true,
      provider,
      models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest']
    };
  }
  let endpoint = 'https://api.openai.com/v1/models';
  const headers = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (provider === 'openrouter') endpoint = 'https://openrouter.ai/api/v1/models';
  else if (provider === 'groq') endpoint = 'https://api.groq.com/openai/v1/models';
  else if (provider === 'custom') {
    if (!cfg.baseUrl) throw new Error('URL de base requise');
    endpoint = `${cfg.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`;
  }
  const res = await fetch(endpoint, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `${provider} HTTP ${res.status}`);
  const models = (json.data || []).map(m => m.id).filter(Boolean).slice(0, 40);
  return { ok: true, provider, models };
}

async function testAiConnection(overrideConfig = null) {
  const started = Date.now();
  const cfg = resolveRuntimeAiConfig(overrideConfig);
  if (!cfg.resolvedProvider || cfg.resolvedProvider === 'offline' || (!cfg.apiKey && cfg.resolvedProvider !== 'custom')) {
    return { ok: false, error: 'Aucune clé API configurée (mode hors-ligne actif).' };
  }
  const resp = await callConfiguredAiRaw({
    promptText: 'Réponds uniquement en JSON valide : {"status":"ok","message":"Connexion IA opérationnelle"}',
    overrideConfig,
    expectJson: false
  });
  return {
    ok: true,
    provider: resp.provider,
    model: resp.model,
    latencyMs: Date.now() - started,
    reply: String(resp.text || '').slice(0, 140)
  };
}

function sanitizeCadSpec(spec, fallbackName = 'Piece_CNC') {
  const ALLOWED_OPS = new Set(['add_cylinder', 'add_box', 'cut_bore', 'cut_flat', 'cut_slot', 'cut_hole_pattern', 'cut_groove']);
  const features = Array.isArray(spec?.features)
    ? spec.features
      .filter(f => f && ALLOWED_OPS.has(f.op))
      .map((f, idx) => ({
        ...f,
        id: f.id || `f${idx + 1}`,
        label: String(f.label || f.op)
      }))
    : [];
  return {
    unit: 'mm',
    name: String(spec?.name || fallbackName),
    features
  };
}

async function analyzePlanDocument({ buffer, filename = 'plan', notes = '' }) {
  const ext = path.extname(filename).toLowerCase();
  const mimeType =
    ext === '.pdf' ? 'application/pdf' :
    ext === '.png' ? 'image/png' :
    ext === '.webp' ? 'image/webp' :
    'image/jpeg';

  const aiCfg = getAiSettings();
  let aiData = null;
  let mode = 'local_parser';
  let aiWarning = '';

  if (buffer && Buffer.isBuffer(buffer) && buffer.length > 0 && aiCfg.resolvedProvider !== 'offline') {
    const promptText = VISION_PROMPT(filename, notes ? `Contexte OF : ${notes}` : '');
    try {
      const resp = await callConfiguredAiRaw({ promptText, buffer, mimeType, expectJson: true });
      if (resp?.data) {
        aiData = resp.data;
        mode = `${resp.provider}_vision_ai`;
      }
    } catch (err) {
      aiWarning = err.message;
    }
  }

  const pdfText = ext === '.pdf' ? extractReadableTextFromPdfBuffer(buffer) : '';
  const local = extractLocalDimensions(`${pdfText} ${notes}`, filename);
  const fallbackSpec = buildDefaultCadSpec(local);

  const ficheTechnique = aiData?.ficheTechnique ? {
    client: aiData.ficheTechnique.client || local.client || '',
    reference: aiData.ficheTechnique.reference || local.reference || '',
    revision: aiData.ficheTechnique.revision || local.revision || '',
    partName: aiData.ficheTechnique.partName || local.partName,
    material: aiData.ficheTechnique.material || local.material || '',
    rawStock: aiData.ficheTechnique.rawStock || local.rawStock,
    criticalTolerances: Array.isArray(aiData.ficheTechnique.criticalTolerances) ? aiData.ficheTechnique.criticalTolerances : local.tolerances,
    specialNotes: Array.isArray(aiData.ficheTechnique.specialNotes) ? aiData.ficheTechnique.specialNotes : local.specialNotes,
    suggestedOperations: Array.isArray(aiData.ficheTechnique.suggestedOperations) && aiData.ficheTechnique.suggestedOperations.length > 0
      ? aiData.ficheTechnique.suggestedOperations
      : local.suggestedOperations,
    summary: aiData.ficheTechnique.summary || 'Fiche technique et géométrie 3D extraites par Vision IA.'
  } : {
    client: local.client,
    reference: local.reference,
    revision: local.revision,
    partName: local.partName,
    material: local.material,
    rawStock: local.rawStock,
    criticalTolerances: local.tolerances,
    specialNotes: local.specialNotes,
    suggestedOperations: local.suggestedOperations,
    summary: aiWarning
      ? `Repli local (erreur provider IA : ${aiWarning}). Vérifiez la configuration dans Administration → Configuration IA.`
      : (local.detectedRaw.diameters.length > 0 || local.material
        ? `Pré-analyse locale : ${local.detectedRaw.diameters.length} diamètre(s) détecté(s)${local.material ? `, matière ${local.material}` : ''}. Le Directeur peut activer un provider Vision IA dans Administration → Configuration IA.`
        : 'Modèle de départ généré localement. Le Directeur peut activer un provider Vision IA dans Administration → Configuration IA, ou affinez directement via le prompt ingénieur.')
  };

  const cadSpec = aiData?.cadSpec && Array.isArray(aiData.cadSpec.features) && aiData.cadSpec.features.length > 0
    ? sanitizeCadSpec(aiData.cadSpec, ficheTechnique.partName)
    : fallbackSpec;

  return {
    mode,
    visionConfigured: aiCfg.resolvedProvider !== 'offline',
    aiProvider: aiCfg.resolvedProvider,
    ficheTechnique,
    cadSpec,
    extracted: local,
    disclaimer: 'Validation ingénieur BE obligatoire : inspectez le 3D, corrigez ce qui manque via le prompt IA si besoin, puis validez avant publication.'
  };
}

// Local deterministic French CAD prompt interpreter (works even without API key!)
function applyLocalCadPrompt(cadSpec, prompt = '') {
  const next = {
    unit: 'mm',
    name: cadSpec?.name || 'Piece_CNC',
    features: Array.isArray(cadSpec?.features) ? cadSpec.features.map(f => ({ ...f })) : []
  };
  const changes = [];
  const p = String(prompt || '').trim();
  const low = p.toLowerCase();
  const newId = () => `f_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // 1. Delete / remove last feature
  if (/supprim|retire|enl[èe]ve/.test(low)) {
    if (/trou|per[çc]age/.test(low)) {
      const before = next.features.length;
      next.features = next.features.filter(f => f.op !== 'cut_hole_pattern');
      if (next.features.length < before) changes.push('Motif de perçages supprimé');
    } else if (/m[ée]plat/.test(low)) {
      next.features = next.features.filter(f => f.op !== 'cut_flat');
      changes.push('Méplat(s) supprimé(s)');
    } else if (/rainure|encoche/.test(low)) {
      next.features = next.features.filter(f => f.op !== 'cut_slot');
      changes.push('Rainure(s) supprimée(s)');
    } else if (next.features.length > 1) {
      const popped = next.features.pop();
      changes.push(`Fonction supprimée : ${popped.label}`);
    }
  }

  // 2. Add circular hole pattern (e.g. "6 trous Ø10 sur PCD 70 à 38°")
  const holePatternMatch = p.match(/(\d+)\s*(?:trous?|per[çc]ages?|[x×])\s*(?:de\s*)?(?:Ø|ø|D|diam[èe]tre\s*)?(\d+(?:[.,]\d+)?)/i);
  if (holePatternMatch && !/supprim|retire/.test(low)) {
    const count = Math.max(1, Math.min(24, parseInt(holePatternMatch[1], 10)));
    const holeDiameter = parseFloat(holePatternMatch[2].replace(',', '.'));
    const pcdM = p.match(/(?:pcd|entraxe|cercle)\s*(?:de\s*)?(?:Ø|ø|D)?\s*(\d+(?:[.,]\d+)?)/i);
    const angleM = p.match(/(\d+(?:[.,]\d+)?)\s*(?:°|deg)/i);
    const pcd = pcdM ? parseFloat(pcdM[1].replace(',', '.')) : 70;
    const startAngleDeg = angleM ? parseFloat(angleM[1].replace(',', '.')) : 0;
    const axis = next.features[0]?.axis || 'x';
    const depth = (next.features[0]?.length || next.features[0]?.lz || 100) + 12;
    next.features.push({
      id: newId(),
      label: `${count}× Trous Ø${holeDiameter} sur PCD Ø${pcd}`,
      op: 'cut_hole_pattern',
      axis,
      count,
      holeDiameter,
      pcd,
      depth,
      startAngleDeg,
      x: 0, y: 0, z: 0
    });
    changes.push(`Ajouté ${count}× trous Ø${holeDiameter} sur PCD Ø${pcd}`);
  }

  // 3. Add flat / méplat (e.g. "méplat à 114.5" or "2 méplats à 55")
  if (/m[ée]plat|plat\s+lat[ée]ral|face\s+plane/.test(low) && !/supprim|retire/.test(low)) {
    const distM = p.match(/m[ée]plat[^\d]*(\d+(?:[.,]\d+)?)/i) || p.match(/(\d+(?:[.,]\d+)?)\s*mm/i);
    const val = distM ? parseFloat(distM[1].replace(',', '.')) : 55;
    const mainD = next.features.find(f => f.op === 'add_cylinder')?.diameter || 120;
    const distFromCenter = val > mainD * 0.65 ? Math.max(5, Number((val - mainD / 2).toFixed(2))) : val;
    const span = (next.features[0]?.length || 200) + 12;
    next.features.push({
      id: newId(),
      label: `Méplat (${val} mm)`,
      op: 'cut_flat',
      side: '+y',
      distanceFromCenter: distFromCenter,
      span
    });
    if (/2\s*m[ée]plat|double\s*m[ée]plat|oppos[ée]/.test(low)) {
      next.features.push({
        id: newId(),
        label: `Méplat opposé (${val} mm)`,
        op: 'cut_flat',
        side: '-y',
        distanceFromCenter: distFromCenter,
        span
      });
    }
    changes.push(`Ajouté méplat à ${val} mm`);
  }

  // 4. Add central bore / alésage (e.g. "alésage Ø60")
  if (/al[ée]sage|trou\s+central|per[çc]age\s+central/.test(low) && !/supprim|retire/.test(low)) {
    const dM = p.match(/(?:al[ée]sage|central)[^\d]*(?:Ø|ø|D)?\s*(\d+(?:[.,]\d+)?)/i);
    if (dM) {
      const diameter = parseFloat(dM[1].replace(',', '.'));
      const axis = next.features[0]?.axis || 'x';
      const length = (next.features[0]?.length || next.features[0]?.lz || 120) + 12;
      next.features.push({
        id: newId(),
        label: `Alésage Ø${diameter}`,
        op: 'cut_bore',
        axis,
        diameter,
        length,
        x: 0, y: 0, z: 0
      });
      changes.push(`Ajouté alésage Ø${diameter} mm`);
    }
  }

  // 5. Add slot / rainure / encoche (e.g. "rainure 25x30" or "rainure 25 mm")
  if (/rainure|clavette|encoche/.test(low) && !/supprim|retire/.test(low)) {
    const sM = p.match(/(?:rainure|clavette|encoche)[^\d]*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?/i);
    const lx = sM ? parseFloat(sM[1].replace(',', '.')) : 25;
    const depth = sM && sM[2] ? parseFloat(sM[2].replace(',', '.')) : 12;
    const mainD = next.features.find(f => f.op === 'add_cylinder')?.diameter || 100;
    next.features.push({
      id: newId(),
      label: `Rainure ${lx}×${depth} mm`,
      op: 'cut_slot',
      lx,
      ly: mainD + 10,
      lz: depth,
      x: 0, y: 0, z: Math.round(mainD / 2 - depth / 3)
    });
    changes.push(`Ajouté rainure ${lx}×${depth} mm`);
  }

  // 6. Add groove / filetage relief (e.g. "gorge" or "filetage Tr 65x8")
  if (/gorge|filet|tr\s*\d+/.test(low) && !/supprim|retire/.test(low)) {
    const tM = p.match(/(?:tr|filet|gorge)[^\d]*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?/i);
    const d = tM ? parseFloat(tM[1].replace(',', '.')) : 65;
    const pitch = tM && tM[2] ? parseFloat(tM[2].replace(',', '.')) : 8;
    const axis = next.features[0]?.axis || 'x';
    next.features.push({
      id: newId(),
      label: `Gorges/Filet Ø${d} pas ${pitch}`,
      op: 'cut_groove',
      axis,
      outerDiameter: d + 2,
      innerDiameter: Math.max(4, d - 6),
      width: Math.max(2, Number((pitch * 0.45).toFixed(1))),
      pitch,
      count: 6,
      x: 0, y: 0, z: 0
    });
    changes.push(`Ajouté gorges / profil fileté Ø${d} pas ${pitch}`);
  }

  // 7. Add collar / manchon / cylindre (e.g. "ajoute manchon Ø95 L230")
  if (/(?:ajoute|cr[ée]e)[^\n]*(?:cylindre|manchon|[ée]paulement|collerette)/.test(low)) {
    const dM = p.match(/(?:Ø|ø|D|diam[èe]tre\s*)\s*(\d+(?:[.,]\d+)?)/i);
    const lM = p.match(/(?:L|long(?:ueur)?\s*)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
    const diameter = dM ? parseFloat(dM[1].replace(',', '.')) : 95;
    const length = lM ? parseFloat(lM[1].replace(',', '.')) : 230;
    const axis = next.features[0]?.axis || 'x';
    next.features.push({
      id: newId(),
      label: `Manchon Ø${diameter} L${length}`,
      op: 'add_cylinder',
      axis,
      diameter,
      length,
      x: 0, y: 0, z: 0
    });
    changes.push(`Ajouté manchon Ø${diameter} × L${length} mm`);
  }

  // 8. Modify main length or outer diameter (e.g. "change la longueur à 230" or "diamètre extérieur 120")
  if (/change|modifie|passe|mets/.test(low) && next.features[0]) {
    const lM = p.match(/long(?:ueur)?[^\d]*(\d+(?:[.,]\d+)?)/i);
    const dM = p.match(/diam[èe]tre[^\d]*(\d+(?:[.,]\d+)?)/i);
    if (lM) {
      const val = parseFloat(lM[1].replace(',', '.'));
      if (next.features[0].length !== undefined) next.features[0].length = val;
      else if (next.features[0].lx !== undefined) next.features[0].lx = val;
      changes.push(`Longueur principale mise à ${val} mm`);
    }
    if (dM && next.features[0].diameter !== undefined) {
      const val = parseFloat(dM[1].replace(',', '.'));
      next.features[0].diameter = val;
      changes.push(`Diamètre principal mis à Ø${val} mm`);
    }
  }

  return {
    cadSpec: next,
    changesSummary: changes.length > 0
      ? changes.join(' · ')
      : "Instruction enregistrée. Pour les modifications géométriques complexes en langage libre, le Directeur peut configurer une clé IA dans Administration → Configuration IA — ou utilisez des cotes explicites (ex: 'Ajoute 6 trous Ø10 sur PCD 70', 'Ajoute méplat 114.5', 'Ajoute alésage Ø60', 'Ajoute rainure 25x12')."
  };
}

async function refineCadSpecWithAI({ cadSpec, prompt, planBuffer = null, filename = 'plan', ficheTechnique = null }) {
  const cleanSpec = sanitizeCadSpec(cadSpec);
  const ext = path.extname(filename || '').toLowerCase();
  const mimeType =
    ext === '.pdf' ? 'application/pdf' :
    ext === '.png' ? 'image/png' :
    ext === '.webp' ? 'image/webp' :
    'image/jpeg';

  const refineInstruction = `Tu es un ingénieur CAO paramétrique (CadQuery / CSG).
Voici le modèle 3D actuel (JSON cadSpec) :
${JSON.stringify(cleanSpec, null, 2)}

${ficheTechnique ? `Fiche technique de la pièce : ${JSON.stringify(ficheTechnique)}` : ''}

Demande de correction de l'ingénieur BE par rapport au plan 2D :
"${prompt}"

Retourne STRICTEMENT un JSON valide :
{
  "changesSummary": string (résumé court en français des corrections faites),
  "cadSpec": { "unit": "mm", "name": string, "features": [ ... ] }
}
Opérations autorisées dans features : add_cylinder, add_box, cut_bore, cut_flat, cut_slot, cut_hole_pattern, cut_groove. Toutes les dimensions en mm.`;

  let aiResp = null;
  let mode = 'local_cad_parser';
  const aiCfg = getAiSettings();

  if (aiCfg.resolvedProvider !== 'offline') {
    try {
      const resp = await callConfiguredAiRaw({
        promptText: refineInstruction,
        buffer: planBuffer && Buffer.isBuffer(planBuffer) ? planBuffer : null,
        mimeType,
        expectJson: true
      });
      if (resp?.data?.cadSpec) {
        aiResp = resp.data;
        mode = `${resp.provider}_vision_ai`;
      }
    } catch {}
  }

  if (aiResp?.cadSpec) {
    return {
      mode,
      cadSpec: sanitizeCadSpec(aiResp.cadSpec, cleanSpec.name),
      changesSummary: aiResp.changesSummary || 'Modèle 3D mis à jour par IA.',
      disclaimer: 'Vérifiez la géométrie 3D mise à jour par rapport au plan 2D avant validation.'
    };
  }

  const localRes = applyLocalCadPrompt(cleanSpec, prompt);
  return {
    mode,
    cadSpec: localRes.cadSpec,
    changesSummary: localRes.changesSummary,
    disclaimer: 'Vérifiez la géométrie 3D mise à jour par rapport au plan 2D avant validation.'
  };
}

module.exports = {
  analyzePlanDocument,
  refineCadSpecWithAI,
  testAiConnection,
  listAvailableModels,
  extractLocalDimensions,
  buildDefaultCadSpec
};
