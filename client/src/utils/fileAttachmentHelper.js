import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Fast client-side image quality check (~20ms, 0 tokens):
 * Detects blur (Laplacian variance), low light / poor contrast, and vertical phone orientation.
 */
export async function analyzeImageQuality(dataUrl) {
  try {
    const img = await loadImage(dataUrl);
    const maxSample = 360;
    const scale = Math.min(1, maxSample / Math.max(img.width, img.height));
    const w = Math.max(32, Math.round(img.width * scale));
    const h = Math.max(32, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const gray = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      gray[i] = g;
      sum += g;
    }
    const mean = sum / (w * h);

    let varianceLum = 0;
    for (let i = 0; i < gray.length; i++) {
      const d = gray[i] - mean;
      varianceLum += d * d;
    }
    const stdLum = Math.sqrt(varianceLum / gray.length);

    // 4-neighbor Laplacian variance for sharpness
    let lapSum = 0;
    let lapSq = 0;
    let lapCount = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const lap = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w];
        lapSum += lap;
        lapSq += lap * lap;
        lapCount++;
      }
    }
    const lapMean = lapSum / Math.max(1, lapCount);
    const sharpness = lapSq / Math.max(1, lapCount) - lapMean * lapMean;

    const warnings = [];
    if (img.height > img.width * 1.15) {
      warnings.push({ code: 'portrait', text: 'Photo verticale — utilisez ↻ 90° si le plan est couché' });
    }
    if (mean < 65) {
      warnings.push({ code: 'dark', text: 'Photo sombre — éclairage faible' });
    } else if (stdLum < 22) {
      warnings.push({ code: 'contrast', text: 'Faible contraste sur le plan' });
    }
    if (sharpness < 75) {
      warnings.push({ code: 'blur', text: 'Image floue — risque d’erreur sur les petites cotes' });
    }
    if (Math.max(img.width, img.height) < 800) {
      warnings.push({ code: 'lowres', text: `Résolution faible (${img.width}×${img.height} px)` });
    }
    return {
      ok: warnings.length === 0,
      width: img.width,
      height: img.height,
      brightness: Math.round(mean),
      sharpness: Math.round(sharpness),
      warnings
    };
  } catch {
    return { ok: true, warnings: [] };
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Converts an image or PDF File into an array of vision-ready PNG/JPEG attachments:
 * [{ filename, mimeType, base64, previewUrl, isFromPdf }]
 * PDFs are rendered at HD resolution via pdf.js so OpenRouter, OpenAI, Claude, Groq & Gemini
 * can all read technical drawings from PDFs accurately.
 */
export async function prepareVisionAttachment(file, maxPdfPages = 2) {
  if (!file) return [];
  const name = file.name || 'document';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);

  if (isPdf) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = Math.min(pdf.numPages, maxPdfPages);
    const results = [];

    for (let p = 1; p <= pageCount; p++) {
      const page = await pdf.getPage(p);
      const baseVp = page.getViewport({ scale: 1 });
      const targetMax = 1800;
      const scale = Math.min(2.4, Math.max(1.3, targetMax / Math.max(baseVp.width, baseVp.height)));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.90);
      results.push({
        filename: pageCount > 1 ? `${name.replace(/\.pdf$/i, '')}_p${p}.jpg` : `${name.replace(/\.pdf$/i, '')}.jpg`,
        originalFilename: name,
        mimeType: 'image/jpeg',
        base64: jpgDataUrl,
        previewUrl: jpgDataUrl,
        isFromPdf: true,
        pageIndex: p,
        totalPages: pdf.numPages
      });
    }
    return results;
  }

  // Standard image file (jpg/png/webp) — crisp 1600px JPEG 0.86 (~300 KB: 6x faster upload & Vision!)
  const rawUrl = await readAsDataUrl(file);
  try {
    const img = await loadImage(rawUrl);
    const maxDim = 1600;
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * ratio));
    canvas.height = Math.max(1, Math.round(img.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const resized = canvas.toDataURL('image/jpeg', 0.86);
    const quality = await analyzeImageQuality(resized);
    return [{
      filename: name,
      originalFilename: name,
      mimeType: 'image/jpeg',
      base64: resized,
      previewUrl: resized,
      isFromPdf: false,
      quality
    }];
  } catch {}

  const mimeType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  const quality = await analyzeImageQuality(rawUrl);
  return [{
    filename: name,
    originalFilename: name,
    mimeType,
    base64: rawUrl,
    previewUrl: rawUrl,
    isFromPdf: false,
    quality
  }];
}

/**
 * Rotates an already-prepared vision attachment 90 degrees clockwise
 * so sideways phone photos of 2D drawings can be straightened before sending to Vision AI.
 */
export async function rotateAttachment90(att) {
  if (!att?.base64) return att;
  const img = await loadImage(att.base64);
  const canvas = document.createElement('canvas');
  canvas.width = img.height;
  canvas.height = img.width;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  const mime = att.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const rotated = canvas.toDataURL(mime, 0.96);
  const quality = await analyzeImageQuality(rotated);
  return {
    ...att,
    base64: rotated,
    previewUrl: rotated,
    quality
  };
}

/**
 * Crops a normalized rectangle { x, y, w, h } (values in 0..1) directly from the full-HD attachment
 * so the Vision AI receives a razor-sharp close-up of a view, section, or title block in the same 1st call.
 */
export async function cropAttachmentRegion(att, normRect, label = 'zoom') {
  if (!att?.base64 || !normRect) return null;
  const img = await loadImage(att.base64);
  const sx = Math.max(0, Math.round(normRect.x * img.width));
  const sy = Math.max(0, Math.round(normRect.y * img.height));
  const sw = Math.max(24, Math.min(img.width - sx, Math.round(normRect.w * img.width)));
  const sh = Math.max(24, Math.min(img.height - sy, Math.round(normRect.h * img.height)));

  // Upscale gently if the cropped region is small so tiny digits stay crystal clear
  const scale = Math.max(1, Math.min(2, 1200 / Math.max(sw, sh)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/png');
  const baseName = (att.originalFilename || att.filename || 'plan').replace(/\.[^.]+$/, '');
  return {
    filename: `${baseName}_${label}.png`,
    originalFilename: `Zoom (${label}) · ${att.originalFilename || att.filename}`,
    mimeType: 'image/png',
    base64: dataUrl,
    previewUrl: dataUrl,
    isFromPdf: false,
    isZoomCrop: true
  };
}

/**
 * Free (0-token) mathematical & geometric coherence check on parametric CAD dimensions + B-Rep bounding box.
 */
export function checkCadParamsCoherence(params = [], dims = null) {
  const warnings = [];
  if (!Array.isArray(params) || params.length === 0) return warnings;

  const list = params.map(p => ({
    key: String(p.key || '').toLowerCase(),
    label: String(p.label || p.key || '').toLowerCase(),
    rawLabel: String(p.label || p.key || ''),
    val: Number(p.value),
    unit: String(p.unit || 'mm')
  }));

  for (const p of list) {
    if (!Number.isFinite(p.val)) {
      warnings.push(`Paramètre « ${p.rawLabel} » non numérique.`);
    } else if (p.val <= 0 && /(diam|rayon|long|larg|haut|epais|pas|pitch|pcd|entraxe|nb|count|trou)/.test(`${p.key} ${p.label}`)) {
      warnings.push(`« ${p.rawLabel} » doit être > 0 (actuel : ${p.val}).`);
    }
  }

  const findMax = (re) => {
    const hits = list.filter(p => Number.isFinite(p.val) && p.val > 0 && p.unit === 'mm' && re.test(`${p.key} ${p.label}`));
    return hits.length ? Math.max(...hits.map(h => h.val)) : null;
  };
  const findVal = (re) => {
    const hit = list.find(p => Number.isFinite(p.val) && p.val > 0 && p.unit === 'mm' && re.test(`${p.key} ${p.label}`));
    return hit ? hit.val : null;
  };

  const outerD = findMax(/(diam.*(ext|corps|princ|max|bague|bride)|outer|od\b)/);
  const boreD = findVal(/(alesage|alésage|diam.*(int|noyau|fond|trou_central)|bore|inner_d|\bid\b)/);
  const grooveD = findVal(/(gorge.*diam|diam.*gorge|groove.*d)/);
  const pcd = findVal(/(pcd|entraxe|cercle_perc)/);
  const holeD = findVal(/(diam.*(trou|perc|perç|insert|tige)|hole_d)/);
  const totalLen = findMax(/(long.*(tot|hors|glob)|total_len|longueur_totale)/);

  if (outerD && boreD && boreD >= outerD) {
    warnings.push(`Contradiction : alésage intérieur (Ø${boreD}) ≥ diamètre extérieur (Ø${outerD}).`);
  }
  if (outerD && grooveD && grooveD >= outerD) {
    warnings.push(`Gorge extérieure (Ø${grooveD}) ≥ diamètre extérieur (Ø${outerD}) — vérifiez la cote.`);
  }
  if (outerD && pcd && holeD && (pcd + holeD) >= outerD) {
    warnings.push(`Perçages sur PCD Ø${pcd} (Ø${holeD}) dépassent l’extérieur Ø${outerD} (épaisseur paroi ≤ 0).`);
  }
  if (boreD && pcd && holeD && (pcd - holeD) < boreD) {
    warnings.push(`Attention paroi fine / sécante : PCD Ø${pcd} − trou Ø${holeD} (${(pcd - holeD).toFixed(1)}) < alésage Ø${boreD} (vérifiez si voulu pour inserts tangents).`);
  }
  if (totalLen && dims && (dims.x > 0 || dims.y > 0 || dims.z > 0)) {
    const maxBbox = Math.max(dims.x, dims.y, dims.z);
    if (Math.abs(maxBbox - totalLen) > Math.max(5, totalLen * 0.08)) {
      warnings.push(`Écart 3D vs cote totale : longueur déclarée ${totalLen} mm mais encombrement 3D max = ${maxBbox.toFixed(1)} mm.`);
    }
  }

  return warnings;
}

const ISO_METRIC_COARSE_PITCH = {
  3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2.0,
  16: 2.0, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3.0, 27: 3.0, 30: 3.5, 33: 3.5,
  36: 4.0, 39: 4.0, 42: 4.5, 45: 4.5, 48: 5.0, 52: 5.0, 56: 5.5, 60: 5.5, 64: 6.0
};

/**
 * Free (0-token) ISO Thread Standards Verifier (ISO 2901 Trapezoidal + ISO 261/724 Metric).
 * Extracts thread callouts from fiche/spec and checks actual CAD parameters against ISO formulas.
 */
export function checkIsoThreadStandards(params = [], fiche = null, cadSpec = null) {
  const results = [];
  const textPool = [
    cadSpec?.name || '',
    fiche?.partName || '',
    fiche?.summary || '',
    ...(Array.isArray(fiche?.criticalTolerances) ? fiche.criticalTolerances : []),
    ...(Array.isArray(fiche?.specialNotes) ? fiche.specialNotes : []),
    ...(Array.isArray(params) ? params.map(p => `${p.label || ''} ${p.tolerance || ''}`) : [])
  ].join(' ');

  const list = (Array.isArray(params) ? params : []).map(p => ({
    key: String(p.key || '').toLowerCase(),
    label: String(p.label || p.key || '').toLowerCase(),
    rawLabel: String(p.label || p.key || ''),
    val: Number(p.value)
  }));

  const boreParam = list.find(p => Number.isFinite(p.val) && p.val > 0 && /(alesage|alésage|noyau|fond.*filet|minor|diam.*int|bore)/.test(`${p.key} ${p.label}`));
  const threadNomParam = list.find(p => Number.isFinite(p.val) && p.val > 0 && /(filet|thread|diam.*nom|tr\d|tarau)/.test(`${p.key} ${p.label}`) && !/(pas|pitch|long|len)/.test(`${p.key} ${p.label}`));
  const pitchParam = list.find(p => Number.isFinite(p.val) && p.val > 0 && /(pas\b|pitch)/.test(`${p.key} ${p.label}`));

  // 1) Trapezoidal ISO 2901: Tr D x P [P(lead)]
  const trMatch = textPool.match(/\bTr\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?:\s*P\s*\(?\s*(\d+(?:[.,]\d+)?)\s*\)?)?/i);
  if (trMatch) {
    const D = parseFloat(trMatch[1].replace(',', '.'));
    const P = parseFloat(trMatch[2].replace(',', '.'));
    const lead = trMatch[3] ? parseFloat(trMatch[3].replace(',', '.')) : P;
    const ac = P <= 5 ? 0.25 : P <= 12 ? 0.5 : 1.0;
    const d1Minor = Number((D - P).toFixed(3));
    const d2Pitch = Number((D - 0.5 * P).toFixed(3));
    const d4Major = Number((D + 2 * ac).toFixed(3));
    const starts = lead > P ? Math.round(lead / P) : 1;

    const issues = [];
    if (boreParam && Math.abs(boreParam.val - d1Minor) > Math.max(0.8, P * 0.15)) {
      issues.push(`Ø noyau/alésage lu (${boreParam.val} mm) ≠ ISO 2901 (${d1Minor} mm)`);
    }
    if (pitchParam && Math.abs(pitchParam.val - P) > 0.1 && Math.abs(pitchParam.val - lead) > 0.1) {
      issues.push(`Pas lu (${pitchParam.val} mm) ≠ ${P} mm${starts > 1 ? ` (avance ${lead} mm)` : ''}`);
    }
    if (threadNomParam && Math.abs(threadNomParam.val - D) > 1.5 && Math.abs(threadNomParam.val - d4Major) > 1.5) {
      issues.push(`Ø filet lu (${threadNomParam.val} mm) ≠ nominal ${D} / crête ${d4Major} mm`);
    }

    results.push({
      standard: 'ISO 2901',
      callout: `Tr ${D}×${P}${starts > 1 ? ` P(${lead}) ${starts} filets` : ''}`,
      expected: `Ø noyau D1=${d1Minor} · Ø flancs D2=${d2Pitch} · Ø crête écrou D4=${d4Major} mm`,
      ok: issues.length === 0,
      issues
    });
  }

  // 2) Metric ISO 261/724: M D [x P]
  const mMatches = [...textPool.matchAll(/\bM\s*(\d{1,2})(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?\b/g)];
  const seenM = new Set();
  for (const mm of mMatches) {
    const D = parseInt(mm[1], 10);
    if (!D || D < 3 || D > 64) continue;
    const P = mm[2] ? parseFloat(mm[2].replace(',', '.')) : ISO_METRIC_COARSE_PITCH[D];
    if (!P) continue;
    const tag = `M${D}x${P}`;
    if (seenM.has(tag)) continue;
    seenM.add(tag);

    const d1Minor = Number((D - 1.08253 * P).toFixed(3));
    const tapDrill = Number((D - P).toFixed(2));
    const issues = [];
    if (!trMatch && boreParam && Math.abs(boreParam.val - D) < 4 && Math.abs(boreParam.val - d1Minor) > Math.max(0.5, P * 0.25)) {
      issues.push(`Avant-trou / Ø noyau (${boreParam.val} mm) écarté de ISO 724 (${d1Minor} mm, foret ~${tapDrill} mm)`);
    }
    results.push({
      standard: 'ISO 261 / 724',
      callout: `M${D}×${P}`,
      expected: `Ø noyau écrou D1=${d1Minor} mm · avant-trou ≈ Ø${tapDrill} mm`,
      ok: issues.length === 0,
      issues
    });
    if (results.length >= 3) break;
  }

  return results;
}

