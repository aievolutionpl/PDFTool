// Page analysis for Word/Excel conversion.
//
// For each page this finds the visible text as lines → segments → styled runs
// (real font family, size, bold/italic, colour) and can render a "graphics
// only" background: the page drawn with its upright text removed, so the text
// can be re-created as editable text on top of it in exactly the same place.
import { AnnotationMode, OPS, Util } from "pdfjs-dist";

const TEXT_OPS = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Removes characters that are invalid in XML (Word/Excel refuse such files). */
export function cleanText(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** True when a (viewport-space) matrix draws normal left-to-right horizontal text. */
function isUpright(m) {
  const scale = Math.abs(m[0]) + Math.abs(m[3]);
  return m[0] > 0 && m[3] < 0 && Math.abs(m[1]) + Math.abs(m[2]) < scale * 0.02;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------
const KNOWN_FONTS = {
  arial: "Arial",
  arialmt: "Arial",
  arialnarrow: "Arial Narrow",
  helvetica: "Arial",
  helveticaneue: "Arial",
  timesnewroman: "Times New Roman",
  timesnewromanps: "Times New Roman",
  timesnewromanpsmt: "Times New Roman",
  times: "Times New Roman",
  timesroman: "Times New Roman",
  couriernew: "Courier New",
  couriernewps: "Courier New",
  couriernewpsmt: "Courier New",
  courier: "Courier New",
  calibri: "Calibri",
  calibrilight: "Calibri Light",
  cambria: "Cambria",
  cambriamath: "Cambria Math",
  candara: "Candara",
  consolas: "Consolas",
  constantia: "Constantia",
  corbel: "Corbel",
  georgia: "Georgia",
  verdana: "Verdana",
  tahoma: "Tahoma",
  trebuchetms: "Trebuchet MS",
  segoeui: "Segoe UI",
  garamond: "Garamond",
  bookantiqua: "Book Antiqua",
  centurygothic: "Century Gothic",
  palatinolinotype: "Palatino Linotype",
  palatino: "Palatino Linotype",
  aptos: "Aptos",
  symbol: "Symbol",
  wingdings: "Wingdings",
  zapfdingbats: "Wingdings",
  lucidaconsole: "Lucida Console",
  franklingothic: "Franklin Gothic",
  gillsans: "Gill Sans MT",
};

function fontInfo(page, loadedName, style, cache) {
  if (cache.has(loadedName)) return cache.get(loadedName);
  let obj = null;
  try {
    obj = page.commonObjs.has(loadedName) ? page.commonObjs.get(loadedName) : null;
  } catch {
    obj = null;
  }
  const raw = String(obj?.name || "").replace(/^[A-Z]{6}\+/, "");
  const lower = raw.toLowerCase();
  const bold = !!obj?.bold || !!obj?.black || /bold|black|heavy|semibold|demi/.test(lower);
  const italic = !!obj?.italic || /italic|oblique/.test(lower) || /-(it|ita|obl)$/.test(lower);

  let family = raw.split(/[-,+]/)[0].replace(/(PSMT|MT|PS)$/, "");
  const key = family.toLowerCase().replace(/[^a-z]/g, "");
  if (KNOWN_FONTS[key]) {
    family = KNOWN_FONTS[key];
  } else {
    family = family.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  }
  if (!family || family.length < 3 || /^(f|t|tt|c|font)\d+/i.test(family)) {
    const generic = style?.fontFamily || obj?.fallbackName || "sans-serif";
    family = /mono/.test(generic) ? "Courier New" : /serif/.test(generic) && !/sans/.test(generic) ? "Times New Roman" : "Arial";
  }
  const info = { family, bold, italic, key: `${family}|${bold}|${italic}` };
  cache.set(loadedName, info);
  return info;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** Indices of operations that draw upright page text (outside annotations). */
function uprightTextOps(opList, baseTransform) {
  const { fnArray, argsArray } = opList;
  const result = new Set();
  const stack = [];
  let ctm = baseTransform;
  let tm = IDENTITY;
  let annotationDepth = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
      case OPS.beginGroup:
        stack.push(ctm);
        break;
      case OPS.restore:
      case OPS.endGroup:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = Util.transform(ctm, args);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (args?.[0]) ctm = Util.transform(ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.beginAnnotation:
        annotationDepth++;
        break;
      case OPS.endAnnotation:
        annotationDepth = Math.max(0, annotationDepth - 1);
        break;
      case OPS.beginText:
        tm = IDENTITY;
        break;
      case OPS.setTextMatrix:
        tm = args[0];
        break;
      default:
        if (TEXT_OPS.has(fn) && annotationDepth === 0 && isUpright(Util.transform(ctm, tm))) {
          result.add(i);
        }
    }
  }
  return result;
}

async function renderCanvas(page, viewport, params) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // An alpha canvas gets greyscale anti-aliasing; opaque canvases use LCD
  // sub-pixel AA whose coloured fringes would distort the sampled text colour.
  const canvasContext = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  await page.render({ canvasContext, viewport, background: "#ffffff", ...params }).promise;
  return canvas;
}

/** Colour of the text inside a box, comparing the full render with the text-free one. */
function sampleColor(full, bg, width, height, box) {
  const x0 = Math.max(0, Math.floor(box.x0));
  const x1 = Math.min(width - 1, Math.ceil(box.x1));
  const y0 = Math.max(0, Math.floor(box.y0));
  const y1 = Math.min(height - 1, Math.ceil(box.y1));
  if (x1 <= x0 || y1 <= y0) return null;
  const step = (x1 - x0) * (y1 - y0) > 40_000 ? 2 : 1;
  let maxDiff = 0;
  const hits = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const i = (y * width + x) * 4;
      const diff = Math.abs(full[i] - bg[i]) + Math.abs(full[i + 1] - bg[i + 1]) + Math.abs(full[i + 2] - bg[i + 2]);
      if (diff > 60) {
        hits.push(i, diff);
        if (diff > maxDiff) maxDiff = diff;
      }
    }
  }
  if (hits.length < 4) return null; // nothing drawn here: invisible (e.g. OCR layer) text
  // Average only the most strongly changed pixels: the fully covered middle of
  // the glyph strokes, not their anti-aliased (lighter) edges.
  const pairs = [];
  for (let k = 0; k < hits.length; k += 2) pairs.push([hits[k], hits[k + 1]]);
  pairs.sort((p, q) => q[1] - p[1]);
  const take = pairs.slice(0, Math.max(1, Math.ceil(pairs.length * 0.12)));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [i] of take) {
    r += full[i];
    g += full[i + 1];
    b += full[i + 2];
    n++;
  }
  r = Math.round(r / n);
  g = Math.round(g / n);
  b = Math.round(b / n);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (Math.max(r, g, b) < 45 && spread < 24) return "000000";
  if (spread < 14) {
    // Neutral grey: drop tiny tints left over from anti-aliasing.
    const v = Math.round((r + g + b) / 3);
    r = g = b = v;
  }
  return [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Average colour behind the text (text-free render), or null when it's white/near-white. */
function sampleBackground(bg, width, height, box) {
  const x0 = Math.max(0, Math.floor(box.x0));
  const x1 = Math.min(width - 1, Math.ceil(box.x1));
  const y0 = Math.max(0, Math.floor(box.y0));
  const y1 = Math.min(height - 1, Math.ceil(box.y1));
  if (x1 <= x0 || y1 <= y0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = 3;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const i = (y * width + x) * 4;
      r += bg[i];
      g += bg[i + 1];
      b += bg[i + 2];
      n++;
    }
  }
  if (!n) return null;
  r = Math.round(r / n);
  g = Math.round(g / n);
  b = Math.round(b / n);
  if (r > 238 && g > 238 && b > 238) return null;
  return [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function isBlank(data) {
  for (let i = 0; i < data.length; i += 16) {
    if (data[i] < 246 || data[i + 1] < 246 || data[i + 2] < 246) return false;
  }
  return true;
}

function canvasToJpeg(canvas, quality = 0.88) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      async blob => (blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new Error("Could not encode image"))),
      "image/jpeg",
      quality,
    ),
  );
}

// ---------------------------------------------------------------------------
// Page analysis
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{width, height, lines, background}>}
 *   lines: [{ y, fs, segments: [{ x0, x1, y, fs, descent, text, runs: [{ text, family, bold, italic, size, color }] }] }]
 *   background: { data: Uint8Array (JPEG), width, height } | null   (only with { background: true })
 */
export async function analyzePage(
  pdf,
  pageNumber,
  { render = true, scale = 2, background = false, keepInvisible = true, splitGap = 0.8 } = {},
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const renderParams = {
    intent: "print",
    annotationMode: AnnotationMode.ENABLE_STORAGE,
    printAnnotationStorage: pdf.annotationStorage.print,
  };
  // The operator list also makes the page's fonts available in commonObjs.
  const opList = await page.getOperatorList(renderParams);
  const textContent = await page.getTextContent();

  // Full render and text-free render, used for colours, visibility and the background.
  let fullCanvas = null;
  let bgCanvas = null;
  let full = null;
  let bg = null;
  let W = 0;
  let H = 0;
  if (render) {
    const renderViewport = page.getViewport({ scale });
    const skip = uprightTextOps(opList, viewport.transform);
    fullCanvas = await renderCanvas(page, renderViewport, renderParams);
    bgCanvas = await renderCanvas(page, renderViewport, { ...renderParams, operationsFilter: i => !skip.has(i) });
    W = fullCanvas.width;
    H = fullCanvas.height;
    full = fullCanvas.getContext("2d").getImageData(0, 0, W, H).data;
    bg = bgCanvas.getContext("2d").getImageData(0, 0, W, H).data;
  }

  // 1. Fragments: one per text item that is upright and visible.
  const fonts = new Map();
  const fragments = [];
  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    const m = Util.transform(viewport.transform, item.transform);
    if (!isUpright(m)) continue; // rotated text stays in the background image
    const text = cleanText(item.str);
    if (!text.trim()) {
      const last = fragments.at(-1);
      if (last) last.trailingSpace = true;
      continue;
    }
    const fs = Math.hypot(m[2], m[3]);
    if (fs < 1 || !(item.width > 0)) continue;
    const style = textContent.styles[item.fontName];
    const font = fontInfo(page, item.fontName, style, fonts);
    const frag = {
      text,
      x0: m[4],
      x1: m[4] + item.width,
      y: m[5],
      fs,
      descent: style?.descent ?? -0.22,
      ...font,
    };
    const box = {
      x0: frag.x0 * scale,
      x1: frag.x1 * scale,
      y0: (frag.y - fs * 0.85) * scale,
      y1: (frag.y + fs * 0.25) * scale,
    };
    const color = render ? sampleColor(full, bg, W, H, box) : "000000";
    if (!color && !keepInvisible) continue;
    frag.color = color || "000000";
    frag.visible = !!color;
    frag.bgColor = render ? sampleBackground(bg, W, H, box) : null;
    fragments.push(frag);
  }

  // 2. Lines: group fragments sharing a baseline.
  fragments.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines = [];
  for (const f of fragments) {
    const line = lines.at(-1);
    if (line && Math.abs(f.y - line.y) <= Math.min(f.fs, line.fs) * 0.35) {
      line.frags.push(f);
      line.fs = Math.max(line.fs, f.fs);
    } else {
      lines.push({ y: f.y, fs: f.fs, frags: [f] });
    }
  }

  // 3. Segments: split each line at large horizontal gaps (columns), build styled runs.
  for (const line of lines) {
    line.frags.sort((a, b) => a.x0 - b.x0);
    const segments = [];
    let seg = null;
    for (const f of line.frags) {
      if (seg) {
        // Drop duplicates (text drawn twice to fake bold or shadows).
        const dup = seg.frags.some(o => o.text === f.text && Math.abs(o.x0 - f.x0) < f.fs * 0.3);
        if (dup) continue;
      }
      const gap = seg ? f.x0 - seg.x1 : Infinity;
      // A bullet stays attached to the text that follows it.
      const afterBullet = seg && /^[•◦▪▫●○■□►✓·*–-]$/.test(seg.text.trim()) && gap < f.fs * 3;
      if (!seg || (!afterBullet && gap > splitGap * Math.min(f.fs, seg.fs)) || gap < -0.5 * f.fs) {
        seg = { x0: f.x0, x1: f.x1, y: f.y, fs: f.fs, descent: f.descent, bgColor: f.bgColor, runs: [], frags: [f], text: "" };
        segments.push(seg);
        addRun(seg, f, "");
        continue;
      }
      const prev = seg.frags.at(-1);
      const needsSpace = (gap > 0.2 * f.fs || prev.trailingSpace) && !/\s$/.test(seg.text) && !/^\s/.test(f.text);
      addRun(seg, f, needsSpace ? " " : "");
      seg.frags.push(f);
      seg.x1 = Math.max(seg.x1, f.x1);
      if (f.fs > seg.fs) {
        seg.fs = f.fs;
        seg.y = f.y;
        seg.descent = f.descent;
      }
    }
    for (const s of segments) delete s.frags;
    line.segments = segments;
    delete line.frags;
  }

  // 4. Optional background image of everything except the editable text.
  let backgroundImage = null;
  if (render && background && !isBlank(bg)) {
    backgroundImage = { data: await canvasToJpeg(bgCanvas), width: viewport.width, height: viewport.height };
  }

  if (fullCanvas) fullCanvas.width = fullCanvas.height = 0;
  if (bgCanvas) bgCanvas.width = bgCanvas.height = 0;
  page.cleanup();
  return { width: viewport.width, height: viewport.height, lines, background: backgroundImage };
}

function addRun(seg, f, space) {
  const last = seg.runs.at(-1);
  const sameStyle =
    last && last.key === f.key && Math.abs(last.size - f.fs) < 0.6 && last.color === f.color;
  if (sameStyle) {
    last.text += space + f.text;
  } else {
    if (last && space) last.text += space;
    else if (!last && space) f = { ...f, text: space + f.text };
    seg.runs.push({ text: f.text, family: f.family, bold: f.bold, italic: f.italic, size: f.fs, color: f.color, key: f.key });
  }
  seg.text += space + f.text;
}

// ---------------------------------------------------------------------------
// Table structure
// ---------------------------------------------------------------------------

/**
 * Finds column boundaries from the horizontal coverage of multi-segment rows
 * (the "stream" approach used by table extractors).
 */
export function inferColumns(lines, pageWidth) {
  const multi = lines.filter(l => l.segments.length >= 2);
  if (!multi.length) return [{ x0: 0, x1: pageWidth }];
  const size = Math.ceil(pageWidth) + 2;
  const cover = new Uint16Array(size);
  const mark = new Uint8Array(size);
  for (const line of multi) {
    mark.fill(0);
    for (const s of line.segments) {
      const a = Math.max(0, Math.floor(s.x0));
      const b = Math.min(size - 1, Math.ceil(s.x1));
      for (let x = a; x <= b; x++) mark[x] = 1;
    }
    for (let x = 0; x < size; x++) cover[x] += mark[x];
  }
  // Tolerate a few cells that bridge two columns in larger tables.
  const threshold = multi.length >= 8 ? Math.floor(multi.length * 0.1) : 0;
  const columns = [];
  let start = -1;
  for (let x = 0; x < size; x++) {
    const on = cover[x] > threshold;
    if (on && start < 0) start = x;
    if (start >= 0 && (!on || x === size - 1)) {
      columns.push({ x0: start, x1: on ? x : x - 1 });
      start = -1;
    }
  }
  let merged = [];
  for (const c of columns) {
    const last = merged.at(-1);
    if (last && c.x0 - last.x1 < 3) last.x1 = c.x1;
    else merged.push({ ...c });
  }
  if (!merged.length) return [{ x0: 0, x1: pageWidth }];

  // Split columns where one row has two separate values in the same column
  // (e.g. right-aligned numbers touching the next column's header).
  for (let guard = 0; guard < 30; guard++) {
    let split = false;
    for (let ci = 0; ci < merged.length && !split; ci++) {
      const col = merged[ci];
      const gaps = [];
      for (const line of multi) {
        const inside = line.segments.filter(s => s.x0 >= col.x0 - 1 && s.x1 <= col.x1 + 1);
        for (let k = 1; k < inside.length; k++) gaps.push([inside[k - 1].x1, inside[k].x0]);
      }
      if (!gaps.length) continue;
      const lo = Math.max(...gaps.map(g => g[0]));
      const hi = Math.min(...gaps.map(g => g[1]));
      const mids = gaps.map(g => (g[0] + g[1]) / 2).sort((a, b) => a - b);
      const cut = lo < hi ? (lo + hi) / 2 : mids[Math.floor(mids.length / 2)];
      if (cut <= col.x0 || cut >= col.x1) continue;
      merged.splice(ci, 1, { x0: col.x0, x1: cut }, { x0: cut, x1: col.x1 });
      split = true;
    }
    if (!split) break;
  }

  // Merge neighbouring columns that never hold values in the same row
  // (a left-aligned header above right-aligned figures).
  for (let guard = 0; guard < 30 && merged.length > 1; guard++) {
    const used = lines.map(l => new Set(assignColumns(l.segments, merged).flatMap((c, i) => (c.length ? [i] : []))));
    let joined = false;
    for (let i = 0; i < merged.length - 1; i++) {
      if (merged[i + 1].x0 - merged[i].x1 > 100) continue;
      const together = used.some(u => u.has(i) && u.has(i + 1));
      const bothUsed = used.some(u => u.has(i)) && used.some(u => u.has(i + 1));
      if (!together && bothUsed) {
        merged.splice(i, 2, { x0: merged[i].x0, x1: merged[i + 1].x1 });
        joined = true;
        break;
      }
    }
    if (!joined) break;
  }
  return merged;
}

/** Puts a line's segments into columns. Returns an array (one entry per column) of segment lists. */
export function assignColumns(segments, columns) {
  const cells = columns.map(() => []);
  for (const s of segments) {
    const overlapping = [];
    columns.forEach((c, i) => {
      const overlap = Math.min(s.x1, c.x1) - Math.max(s.x0, c.x0);
      if (overlap > 0) overlapping.push([i, overlap]);
    });
    let index;
    if (overlapping.length > 1) {
      // A wide segment (a title) goes where it starts, unless it mostly sits in another column.
      const width = Math.max(1, s.x1 - s.x0);
      const start = columns.findIndex(c => s.x0 >= c.x0 - 1 && s.x0 <= c.x1);
      const startOverlap = overlapping.find(([i]) => i === start)?.[1] ?? 0;
      index = start >= 0 && startOverlap / width >= 0.3 ? start : overlapping.sort((a, b) => b[1] - a[1])[0][0];
    } else if (overlapping.length === 1) {
      index = overlapping[0][0];
    } else {
      const cx = (s.x0 + s.x1) / 2;
      let best = Infinity;
      columns.forEach((c, i) => {
        const d = cx < c.x0 ? c.x0 - cx : cx > c.x1 ? cx - c.x1 : 0;
        if (d < best) {
          best = d;
          index = i;
        }
      });
    }
    cells[index].push(s);
  }
  return cells;
}
