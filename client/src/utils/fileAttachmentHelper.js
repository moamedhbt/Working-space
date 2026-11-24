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
      const targetMax = 2400;
      const scale = Math.min(3.0, Math.max(1.5, targetMax / Math.max(baseVp.width, baseVp.height)));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const pngDataUrl = canvas.toDataURL('image/png');
      results.push({
        filename: pageCount > 1 ? `${name.replace(/\.pdf$/i, '')}_p${p}.png` : `${name.replace(/\.pdf$/i, '')}.png`,
        originalFilename: name,
        mimeType: 'image/png',
        base64: pngDataUrl,
        previewUrl: pngDataUrl,
        isFromPdf: true,
        pageIndex: p,
        totalPages: pdf.numPages
      });
    }
    return results;
  }

  // Standard image file (jpg/png/webp) — keep crisp HD up to 2400px so fine CAD dimensions stay razor-sharp
  const rawUrl = await readAsDataUrl(file);
  try {
    const img = await loadImage(rawUrl);
    const maxDim = 2400;
    if (img.width > maxDim || img.height > maxDim) {
      const ratio = maxDim / Math.max(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const resized = canvas.toDataURL('image/jpeg', 0.95);
      return [{
        filename: name,
        originalFilename: name,
        mimeType: 'image/jpeg',
        base64: resized,
        previewUrl: resized,
        isFromPdf: false
      }];
    }
  } catch {}

  const mimeType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  return [{
    filename: name,
    originalFilename: name,
    mimeType,
    base64: rawUrl,
    previewUrl: rawUrl,
    isFromPdf: false
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
  return {
    ...att,
    base64: rotated,
    previewUrl: rotated
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

