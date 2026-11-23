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
      const targetMax = 1800;
      const scale = Math.min(2.5, Math.max(1.2, targetMax / Math.max(baseVp.width, baseVp.height)));
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

  // Standard image file (jpg/png/webp) — compress gently if huge (> 2000px)
  const rawUrl = await readAsDataUrl(file);
  try {
    const img = await loadImage(rawUrl);
    const maxDim = 2000;
    if (img.width > maxDim || img.height > maxDim) {
      const ratio = maxDim / Math.max(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const resized = canvas.toDataURL('image/jpeg', 0.9);
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
  const rotated = canvas.toDataURL(mime, 0.92);
  return {
    ...att,
    base64: rotated,
    previewUrl: rotated
  };
}
