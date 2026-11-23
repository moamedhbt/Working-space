const fs = require('fs');
const path = require('path');

const MATERIALS_REGEX = [
  /42CrMo4/i, /XC48|C45/i, /35NCD16/i, /S235|S355/i, /Acier\s+[A-Z0-9-]+/i,
  /Alu(?:minium)?\s*(?:7075|6061|2017|AU4G|AG3)?/i,
  /Inox\s*(?:304L?|316L?|310)?/i,
  /Bronze\s*(?:CuSn12|UE12)?/i,
  /Laiton\s*(?:CuZn\d+)?/i,
  /POM|Delrin|PTFE|Teflon|Nylon/i
];

function extractLocalDimensions(text = '', filename = '') {
  const src = `${filename} ${text}`.replace(/\s+/g, ' ');
  const diameters = [...src.matchAll(/(?:Ø|ø|diam(?:ètre|etre)?|D)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi)]
    .map(m => parseFloat(m[1].replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 2000);

  const lengthMatch = src.match(/(?:L|Long(?:ueur)?|H|Ht)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const widthMatch = src.match(/(?:l|Larg(?:eur)?|W)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const thickMatch = src.match(/(?:e|ep|ép(?:aisseur)?|thk)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const holesMatch = src.match(/(\d+)\s*[x×]\s*(?:Ø|ø|M)\s*(\d+(?:[.,]\d+)?)/i);
  const pcdMatch = src.match(/(?:PCD|entraxe|Ø\s*per[çc]age)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const tolerances = [...src.matchAll(/(?:±\s*\d+(?:[.,]\d+)?|[A-Za-z]\d{1,2}\b|Ra\s*\d+(?:[.,]\d+)?)/g)]
    .map(m => m[0])
    .slice(0, 6);

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
  if (/bride|flange|plateau|disque/.test(low)) partType = 'bride';
  else if (/bague|douille|entretoise|manchon|palier/.test(low)) partType = 'bague';
  else if (/plaque|bloc|support|cale|plat|semelle/.test(low)) partType = 'plaque';

  const uniqueDiams = [...new Set(diameters)].sort((a, b) => b - a);
  const outerDiameter = uniqueDiams[0] || (partType === 'bride' ? 120 : partType === 'bague' ? 50 : 45);
  const innerDiameter = uniqueDiams.length > 1 ? uniqueDiams[1] : (partType === 'bague' ? Math.round(outerDiameter * 0.5) : partType === 'bride' ? Math.round(outerDiameter * 0.35) : 0);

  return {
    partType,
    outerDiameter,
    innerDiameter,
    length: lengthMatch ? parseFloat(lengthMatch[1].replace(',', '.')) : (partType === 'bride' ? 20 : partType === 'bague' ? 40 : 120),
    width: widthMatch ? parseFloat(widthMatch[1].replace(',', '.')) : 80,
    thickness: thickMatch ? parseFloat(thickMatch[1].replace(',', '.')) : 20,
    holeCount: holesMatch ? parseInt(holesMatch[1], 10) : (partType === 'bride' ? 6 : partType === 'plaque' ? 4 : 0),
    holeDiameter: holesMatch ? parseFloat(holesMatch[2].replace(',', '.')) : 10,
    pcd: pcdMatch ? parseFloat(pcdMatch[1].replace(',', '.')) : Math.round(outerDiameter * 0.72),
    material: material || '',
    tolerances,
    detectedRaw: {
      diameters: uniqueDiams,
      hasText: text.trim().length > 0
    }
  };
}

function extractReadableTextFromPdfBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return '';
  // Quick lightweight extraction of ASCII/Latin-1 text tokens inside PDF streams (no heavy native binary required)
  const raw = buf.toString('latin1');
  const matches = [...raw.matchAll(/\(([^()\\]{2,120})\)/g)].map(m => m[1]);
  return matches.join(' ').replace(/[^\x20-\x7EÀ-ÿØø±×]/g, ' ').slice(0, 6000);
}

async function callGeminiVision(base64Data, mimeType, filename) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const prompt = `Tu es un ingénieur méthode CNC. Analyse ce plan technique 2D (${filename}).
Extrais uniquement un JSON strict (sans markdown) avec les clés :
{
  "partType": "arbre" | "bague" | "bride" | "plaque",
  "outerDiameter": number (mm),
  "innerDiameter": number (mm, 0 si plein),
  "length": number (mm),
  "width": number (mm),
  "thickness": number (mm),
  "holeCount": number,
  "holeDiameter": number (mm),
  "pcd": number (mm, diamètre cercle perçage),
  "material": string,
  "tolerances": string[],
  "summary": string
}
Si une cote n'est pas lisible, mets 0 ou une chaîne vide.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }]
    })
  });
  if (!res.ok) return null;
  const json = await res.json();
  const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return JSON.parse(m[0]);
}

async function callOpenAIVision(base64Data, mimeType, filename) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || mimeType === 'application/pdf') return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyse ce plan 2D CNC (${filename}) et retourne un JSON avec partType (arbre|bague|bride|plaque), outerDiameter, innerDiameter, length, width, thickness, holeCount, holeDiameter, pcd, material, tolerances (array), summary (string).`
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Data}` }
          }
        ]
      }]
    })
  });
  if (!res.ok) return null;
  const json = await res.json();
  const txt = json?.choices?.[0]?.message?.content || '';
  return txt ? JSON.parse(txt) : null;
}

async function analyzePlanDocument({ buffer, filename = 'plan', notes = '' }) {
  const ext = path.extname(filename).toLowerCase();
  const mimeType =
    ext === '.pdf' ? 'application/pdf' :
    ext === '.png' ? 'image/png' :
    ext === '.webp' ? 'image/webp' :
    'image/jpeg';

  let visionResult = null;
  let mode = 'local_parser';

  if (buffer && Buffer.isBuffer(buffer) && buffer.length > 0) {
    const b64 = buffer.toString('base64');
    try {
      visionResult = await callGeminiVision(b64, mimeType, filename);
      if (visionResult) mode = 'gemini_vision_ai';
    } catch {}
    if (!visionResult) {
      try {
        visionResult = await callOpenAIVision(b64, mimeType, filename);
        if (visionResult) mode = 'openai_vision_ai';
      } catch {}
    }
  }

  const pdfText = ext === '.pdf' ? extractReadableTextFromPdfBuffer(buffer) : '';
  const local = extractLocalDimensions(`${pdfText} ${notes}`, filename);

  const merged = visionResult ? {
    partType: ['arbre', 'bague', 'bride', 'plaque'].includes(visionResult.partType) ? visionResult.partType : local.partType,
    outerDiameter: Number(visionResult.outerDiameter) || local.outerDiameter,
    innerDiameter: Number(visionResult.innerDiameter) ?? local.innerDiameter,
    length: Number(visionResult.length) || local.length,
    width: Number(visionResult.width) || local.width,
    thickness: Number(visionResult.thickness) || local.thickness,
    holeCount: Number(visionResult.holeCount) ?? local.holeCount,
    holeDiameter: Number(visionResult.holeDiameter) || local.holeDiameter,
    pcd: Number(visionResult.pcd) || local.pcd,
    material: visionResult.material || local.material,
    tolerances: Array.isArray(visionResult.tolerances) && visionResult.tolerances.length > 0 ? visionResult.tolerances : local.tolerances,
    summary: visionResult.summary || 'Cotes extraites par Vision IA.'
  } : {
    ...local,
    summary: local.detectedRaw.diameters.length > 0 || local.material
      ? `Pré-lecture locale : ${local.detectedRaw.diameters.length} diamètre(s) détecté(s)${local.material ? `, matière ${local.material}` : ''}.`
      : 'Aucune cote texte lisible automatiquement (image scannée ou clé Vision IA non configurée) — vérifiez et ajustez les cotes ci-dessous.'
  };

  return {
    mode,
    visionConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
    extracted: merged,
    disclaimer: 'Vérification BE obligatoire : confirmez chaque cote avant génération du 3D paramétrique exact (.STL / .STEP).'
  };
}

module.exports = { analyzePlanDocument, extractLocalDimensions };
