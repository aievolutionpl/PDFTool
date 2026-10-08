// Rendering and conversion helpers built on pdf.js (PDF → images / text / Word).
import { AnnotationMode } from "pdfjs-dist";

const MAX_PIXELS = 40_000_000;

/** Renders one page (with annotations and pending edits) into a canvas. */
export async function renderPage(pdfDoc, pageNumber, scale, { forPrint = true } = {}) {
  const page = await pdfDoc.getPage(pageNumber);
  let viewport = page.getViewport({ scale });
  const pixels = viewport.width * viewport.height;
  if (pixels > MAX_PIXELS) {
    viewport = page.getViewport({ scale: scale * Math.sqrt(MAX_PIXELS / pixels) });
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const params = { canvas, viewport };
  if (forPrint) {
    params.intent = "print";
    params.annotationMode = AnnotationMode.ENABLE_STORAGE;
    params.printAnnotationStorage = pdfDoc.annotationStorage.print;
  }
  await page.render(params).promise;
  page.cleanup();
  return canvas;
}

function canvasToBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async blob => {
        if (!blob) return reject(new Error("Could not encode image."));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      type,
      quality,
    );
  });
}

export async function pageToImage(pdfDoc, pageNumber, { format = "png", dpi = 150, quality = 0.9 } = {}) {
  const canvas = await renderPage(pdfDoc, pageNumber, dpi / 72);
  const type = format === "jpg" ? "image/jpeg" : "image/png";
  const data = await canvasToBytes(canvas, type, quality);
  canvas.width = canvas.height = 0;
  return data;
}

// ---------------------------------------------------------------------------
// Thumbnails (cached, rendered without annotations for speed)
// ---------------------------------------------------------------------------
const thumbCache = new Map();
let thumbQueue = Promise.resolve();

export function clearThumbnailCache(prefix = "") {
  for (const key of thumbCache.keys()) {
    if (key.startsWith(prefix)) thumbCache.delete(key);
  }
}

/** Returns a data URL thumbnail of a page, `width` CSS pixels wide. */
export function thumbnail(pdfDoc, pageNumber, width, cacheKey) {
  const key = `${cacheKey}:${pageNumber}:${width}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const job = thumbQueue.then(async () => {
    const page = await pdfDoc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width * ratio) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
    const url = canvas.toDataURL("image/jpeg", 0.85);
    canvas.width = canvas.height = 0;
    return { url, width: base.width, height: base.height };
  });
  thumbQueue = job.catch(() => {});
  thumbCache.set(key, job);
  job.catch(() => thumbCache.delete(key));
  return job;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Groups a page's text items into lines: [{ text, y, size }]. */
async function pageLines(pdfDoc, pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  const lines = [];
  let current = null;
  const flush = () => {
    if (current && current.text.trim()) {
      current.text = current.text.replace(/\s+/g, " ").trim();
      lines.push(current);
    }
    current = null;
  };
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const [, , c, d, , f] = item.transform;
    const size = Math.hypot(c, d) || item.height || 10;
    if (!current) {
      current = { text: "", y: f, size };
    } else if (Math.abs(f - current.y) > size * 0.6 && item.str.trim()) {
      // Moved to a different baseline without an explicit EOL.
      flush();
      current = { text: "", y: f, size };
    }
    current.text += item.str;
    current.size = Math.max(current.size, size);
    if (item.hasEOL) {
      flush();
    }
  }
  flush();
  page.cleanup();
  return lines;
}

/** Joins lines into paragraphs using vertical gaps and font size changes. */
function linesToParagraphs(lines) {
  const paragraphs = [];
  let para = null;
  let prev = null;
  for (const line of lines) {
    const gap = prev ? Math.abs(prev.y - line.y) : 0;
    const sizeChanged = prev && Math.abs(prev.size - line.size) > Math.max(prev.size, line.size) * 0.15;
    const newPara = !para || sizeChanged || gap > Math.max(prev.size, line.size) * 1.75;
    if (newPara) {
      para = { text: line.text, size: line.size };
      paragraphs.push(para);
    } else if (/[A-Za-zÀ-ž]-$/.test(para.text) && /^[a-zà-ž]/.test(line.text)) {
      para.text = para.text.slice(0, -1) + line.text;
    } else {
      para.text += " " + line.text;
    }
    prev = line;
  }
  return paragraphs;
}

export async function extractText(pdfDoc, pageNumbers, onProgress) {
  const chunks = [];
  for (let i = 0; i < pageNumbers.length; i++) {
    onProgress?.(i, pageNumbers.length);
    const lines = await pageLines(pdfDoc, pageNumbers[i]);
    const paragraphs = linesToParagraphs(lines);
    chunks.push(paragraphs.map(p => p.text).join("\n\n"));
  }
  return chunks.join("\n\n\f\n\n").replace(/\f/g, "");
}
