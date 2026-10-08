// Document editing with pdf-lib. Every function takes PDF bytes and returns
// new PDF bytes (Uint8Array) — the viewer then reloads the result.
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

export const PAGE_SIZES = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
};

const norm = angle => ((angle % 360) + 360) % 360;

async function loadForEdit(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypted/i.test(err?.message || "")) {
      throw new Error("This PDF is password-protected, so its pages can't be edited.");
    }
    throw err;
  }
}

async function finish(doc) {
  doc.setModificationDate(new Date());
  doc.setProducer("PDF Tool");
  return doc.save();
}

/** Copies inherited attributes onto the page so it can be moved safely within the page tree. */
function bakeInherited(page) {
  const node = page.node;
  for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
    const name = PDFName.of(key);
    if (!node.get(name)) {
      const inherited = node.getInheritableAttribute(name);
      if (inherited) node.set(name, inherited);
    }
  }
}

export async function getPageCount(bytes) {
  const doc = await loadForEdit(bytes);
  return doc.getPageCount();
}

export async function rotatePages(bytes, pageIndices, delta) {
  const doc = await loadForEdit(bytes);
  for (const i of pageIndices) {
    const page = doc.getPage(i);
    page.setRotation(degrees(norm(page.getRotation().angle + delta)));
  }
  return finish(doc);
}

export async function deletePages(bytes, pageIndices) {
  const doc = await loadForEdit(bytes);
  const unique = [...new Set(pageIndices)].sort((a, b) => b - a);
  if (unique.length >= doc.getPageCount()) {
    throw new Error("A PDF needs at least one page — you can't delete all of them.");
  }
  for (const i of unique) doc.removePage(i);
  return finish(doc);
}

/**
 * Rebuilds the page list from a plan, keeping document-level data (bookmarks,
 * metadata, forms) intact.
 * plan items: { type: "page", index, rotation }
 *           | { type: "blank", width, height, rotation }
 *           | { type: "external", docKey, index, rotation }
 */
export async function applyPagePlan(bytes, plan, externalBytes = new Map()) {
  if (!plan.length) throw new Error("The document must keep at least one page.");
  const doc = await loadForEdit(bytes);
  const original = doc.getPages();
  original.forEach(bakeInherited);

  const external = await copyExternalPages(doc, plan, externalBytes);
  const used = new Set();
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);

  for (const item of plan) {
    let page;
    if (item.type === "page") {
      if (used.has(item.index)) {
        // Same page used twice: append a copy.
        const [copy] = await doc.copyPages(await loadForEdit(bytes), [item.index]);
        page = doc.addPage(copy);
      } else {
        used.add(item.index);
        page = doc.addPage(original[item.index]);
      }
    } else if (item.type === "blank") {
      page = doc.addPage([item.width, item.height]);
    } else {
      page = doc.addPage(external.get(item.docKey).get(item.index));
    }
    if (item.rotation) {
      page.setRotation(degrees(norm(page.getRotation().angle + item.rotation)));
    }
  }
  return finish(doc);
}

/** Copies all external pages a plan needs, one batch per source (so shared fonts are copied once). */
async function copyExternalPages(target, plan, externalBytes) {
  const needed = new Map();
  for (const item of plan) {
    if (item.type !== "external") continue;
    if (!needed.has(item.docKey)) needed.set(item.docKey, new Set());
    needed.get(item.docKey).add(item.index);
  }
  const result = new Map();
  for (const [docKey, indexSet] of needed) {
    const src = await loadForEdit(externalBytes.get(docKey));
    const indices = [...indexSet];
    const pages = await target.copyPages(src, indices);
    result.set(docKey, new Map(indices.map((index, i) => [index, pages[i]])));
  }
  return result;
}

/** Builds a brand-new PDF from a plan (used to extract a selection of pages). */
export async function buildFromPlan(bytes, plan, externalBytes = new Map()) {
  const src = await loadForEdit(bytes);
  const out = await PDFDocument.create();
  const ownIndices = [...new Set(plan.filter(i => i.type === "page").map(i => i.index))];
  const ownPages = await out.copyPages(src, ownIndices);
  const own = new Map(ownIndices.map((index, i) => [index, ownPages[i]]));
  const external = await copyExternalPages(out, plan, externalBytes);
  for (const item of plan) {
    let page;
    if (item.type === "page") page = out.addPage(own.get(item.index));
    else if (item.type === "external") page = out.addPage(external.get(item.docKey).get(item.index));
    else page = out.addPage([item.width, item.height]);
    if (item.rotation) {
      page.setRotation(degrees(norm(page.getRotation().angle + item.rotation)));
    }
  }
  const title = src.getTitle();
  if (title) out.setTitle(title);
  out.setCreator("PDF Tool");
  return finish(out);
}

export async function insertBlankPage(bytes, atIndex, size = null) {
  const doc = await loadForEdit(bytes);
  let dims = size;
  if (!dims) {
    const ref = doc.getPage(Math.min(Math.max(atIndex - 1, 0), doc.getPageCount() - 1));
    const { width, height } = ref.getSize();
    const rotated = ref.getRotation().angle % 180 !== 0;
    dims = rotated ? [height, width] : [width, height];
  }
  doc.insertPage(atIndex, dims);
  return finish(doc);
}

export async function insertPdf(bytes, otherBytes, atIndex) {
  const doc = await loadForEdit(bytes);
  const other = await loadForEdit(otherBytes);
  const pages = await doc.copyPages(other, other.getPageIndices());
  pages.forEach((page, i) => doc.insertPage(atIndex + i, page));
  return finish(doc);
}

export async function extractPages(bytes, pageIndices, title = "") {
  const src = await loadForEdit(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, pageIndices);
  pages.forEach(page => out.addPage(page));
  const srcTitle = src.getTitle();
  if (title || srcTitle) out.setTitle(title || srcTitle);
  out.setCreator("PDF Tool");
  return finish(out);
}

/** groups: array of arrays of 0-based page indices. Returns array of PDF bytes. */
export async function splitPdf(bytes, groups) {
  const src = await loadForEdit(bytes);
  const outputs = [];
  for (const indices of groups) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    pages.forEach(page => out.addPage(page));
    out.setCreator("PDF Tool");
    outputs.push(await finish(out));
  }
  return outputs;
}

export async function mergePdfs(list, onProgress) {
  const out = await PDFDocument.create();
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i, list.length, list[i].name);
    const src = await loadForEdit(list[i].data);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(page => out.addPage(page));
  }
  out.setCreator("PDF Tool");
  return finish(out);
}

export async function readMetadata(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    return {
      title: doc.getTitle() || "",
      author: doc.getAuthor() || "",
      subject: doc.getSubject() || "",
      keywords: doc.getKeywords() || "",
    };
  } catch {
    return { title: "", author: "", subject: "", keywords: "" };
  }
}

export async function writeMetadata(bytes, { title, author, subject, keywords }) {
  const doc = await loadForEdit(bytes);
  doc.setTitle(title || "", { showInWindowTitleBar: !!title });
  doc.setAuthor(author || "");
  doc.setSubject(subject || "");
  doc.setKeywords(
    String(keywords || "")
      .split(/[,;]/)
      .map(k => k.trim())
      .filter(Boolean),
  );
  return finish(doc);
}

// ---------------------------------------------------------------------------
// Geometry helpers: work in "visual" coordinates (what the user sees, origin
// bottom-left, after /Rotate) and map back to the page's content space.
// ---------------------------------------------------------------------------
function visualFrame(page) {
  const box = page.getCropBox();
  const rotation = norm(page.getRotation().angle);
  const swap = rotation % 180 !== 0;
  return {
    box,
    rotation,
    width: swap ? box.height : box.width,
    height: swap ? box.width : box.height,
  };
}

function toContent(frame, vx, vy) {
  const { box, rotation } = frame;
  const W = box.width;
  const H = box.height;
  let x;
  let y;
  switch (rotation) {
    case 90:
      x = W - vy;
      y = vx;
      break;
    case 180:
      x = W - vx;
      y = H - vy;
      break;
    case 270:
      x = vy;
      y = H - vx;
      break;
    default:
      x = vx;
      y = vy;
  }
  return { x: box.x + x, y: box.y + y };
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Renders text with the system fonts into a PNG so any language/script works. */
async function textToPng(text, { color, fontSize, bold = true, fontFamily = "Segoe UI, Arial, sans-serif" }) {
  const scale = 4;
  const font = `${bold ? "700" : "400"} ${fontSize * scale}px ${fontFamily}`;
  const measure = new OffscreenCanvas(1, 1).getContext("2d");
  measure.font = font;
  const lines = String(text).split(/\r?\n/);
  const lineHeight = fontSize * scale * 1.2;
  const width = Math.ceil(Math.max(...lines.map(l => measure.measureText(l).width), 1)) + 8 * scale;
  const height = Math.ceil(lineHeight * lines.length) + 4 * scale;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  lines.forEach((line, i) => ctx.fillText(line, width / 2, lineHeight * (i + 0.5) + 2 * scale));
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    width: width / scale,
    height: height / scale,
  };
}

/**
 * opts: { text, color, opacity (0-1), fontSize, angle (deg), layout: "center"|"tile", pages: [indices] | null }
 */
export async function addWatermark(bytes, opts) {
  const doc = await loadForEdit(bytes);
  const png = await textToPng(opts.text, { color: opts.color, fontSize: opts.fontSize });
  const image = await doc.embedPng(png.data);
  const targets = opts.pages ?? doc.getPageIndices();
  const theta = (opts.angle * Math.PI) / 180;

  for (const index of targets) {
    const page = doc.getPage(index);
    const frame = visualFrame(page);
    const w = png.width;
    const h = png.height;

    const centers = [];
    if (opts.layout === "tile") {
      const stepX = w * 1.15 + 40;
      const stepY = h * 3 + 40;
      for (let cy = stepY / 2, row = 0; cy < frame.height + stepY; cy += stepY, row++) {
        for (let cx = (row % 2 ? stepX / 2 : 0); cx < frame.width + stepX; cx += stepX) {
          centers.push([cx, cy]);
        }
      }
    } else {
      centers.push([frame.width / 2, frame.height / 2]);
    }

    for (const [cx, cy] of centers) {
      // Bottom-left corner (visual) such that the rotated image is centred on (cx, cy).
      const vx = cx - ((w / 2) * Math.cos(theta) - (h / 2) * Math.sin(theta));
      const vy = cy - ((w / 2) * Math.sin(theta) + (h / 2) * Math.cos(theta));
      const { x, y } = toContent(frame, vx, vy);
      page.drawImage(image, {
        x,
        y,
        width: w,
        height: h,
        rotate: degrees(opts.angle + frame.rotation),
        opacity: opts.opacity,
      });
    }
  }
  return finish(doc);
}

/**
 * opts: { format: "n"|"page-n"|"n-of-total"|"page-n-of-total", position: "bottom-center"|..., fontSize, margin, startAt, color, skipFirst }
 */
export async function addPageNumbers(bytes, opts) {
  const doc = await loadForEdit(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  const color = hexToRgb(opts.color || "#333333");
  const size = opts.fontSize || 10;
  const margin = opts.margin ?? 24;
  const [vertical, horizontal] = (opts.position || "bottom-center").split("-");

  doc.getPages().forEach((page, i) => {
    if (opts.skipFirst && i === 0) return;
    const n = i + (opts.startAt ?? 1);
    const last = total + (opts.startAt ?? 1) - 1;
    const label = {
      n: `${n}`,
      "page-n": `Page ${n}`,
      "n-of-total": `${n} / ${last}`,
      "page-n-of-total": `Page ${n} of ${last}`,
    }[opts.format || "n"];
    const textWidth = font.widthOfTextAtSize(label, size);
    const frame = visualFrame(page);
    let vx;
    if (horizontal === "left") vx = margin;
    else if (horizontal === "right") vx = frame.width - margin - textWidth;
    else vx = (frame.width - textWidth) / 2;
    const vy = vertical === "top" ? frame.height - margin - size : margin;
    const { x, y } = toContent(frame, vx, vy);
    page.drawText(label, { x, y, size, font, color, rotate: degrees(frame.rotation) });
  });
  return finish(doc);
}

// ---------------------------------------------------------------------------
// Images → PDF
// ---------------------------------------------------------------------------
function sniffImage(data) {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data[0] === 0xff && data[1] === 0xd8) return "jpg";
  return "other";
}

/** Reads the EXIF orientation tag of a JPEG (1 = normal). */
function jpegOrientation(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 > view.byteLength) break;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    offset += 2 + length;
  }
  return 1;
}

/** Decodes any browser-supported image (applying EXIF rotation) and re-encodes it. */
async function reencode(data, type) {
  const bitmap = await createImageBitmap(new Blob([data]), { imageOrientation: "from-image" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type, quality: 0.92 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * images: [{ name, data }]
 * opts: { pageSize: "fit"|"A4"|"Letter"|..., orientation: "auto"|"portrait"|"landscape", margin (pt) }
 */
export async function imagesToPdf(images, opts, onProgress) {
  const doc = await PDFDocument.create();
  doc.setCreator("PDF Tool");
  for (let i = 0; i < images.length; i++) {
    onProgress?.(i, images.length, images[i].name);
    let { data } = images[i];
    let kind = sniffImage(data);
    if (kind === "jpg" && jpegOrientation(data) !== 1) {
      data = await reencode(data, "image/jpeg");
    } else if (kind === "other") {
      data = await reencode(data, "image/png");
      kind = "png";
    }
    const image = kind === "jpg" ? await doc.embedJpg(data) : await doc.embedPng(data);
    // 96 dpi → points
    const imgW = image.width * 0.75;
    const imgH = image.height * 0.75;

    let pageW;
    let pageH;
    const margin = opts.pageSize === "fit" ? 0 : Number(opts.margin) || 0;
    if (opts.pageSize === "fit") {
      pageW = imgW;
      pageH = imgH;
    } else {
      [pageW, pageH] = PAGE_SIZES[opts.pageSize] || PAGE_SIZES.A4;
      const landscape =
        opts.orientation === "landscape" || (opts.orientation === "auto" && imgW > imgH);
      if (landscape) [pageW, pageH] = [pageH, pageW];
    }
    const page = doc.addPage([pageW, pageH]);
    const scale = Math.min((pageW - margin * 2) / imgW, (pageH - margin * 2) / imgH, opts.pageSize === "fit" ? 1 : Infinity);
    const w = imgW * scale;
    const h = imgH * scale;
    page.drawImage(image, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
  }
  return finish(doc);
}
