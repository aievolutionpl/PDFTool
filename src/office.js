// PDF → Word (.docx) and PDF → Excel (.xlsx).
//
// Word modes:
//   "exact"  – looks like the PDF: graphics as a background picture, every line
//              of text as real, editable Word text in a positioned frame.
//   "flow"   – reflowing document: paragraphs, headings, tables, fonts, colours.
//   "images" – one picture per page (pixel perfect, not editable).
import { analyzePage, assignColumns, cleanText, inferColumns } from "./layout.js";
import { pageToImage } from "./convert.js";
import { t } from "./i18n.js";

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

const tw = pt => Math.round(pt * 20); // points → twips
const px = pt => Math.round((pt * 96) / 72); // points → pixels (docx image sizes)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const yieldToUi = () => new Promise(r => setTimeout(r, 0));
const NUMBER_LIKE = /^\(?[-−–+]?\s?(?:[$€£¥]\s?)?\d[\d\s.,']*\)?\s?(?:%|zł|PLN|EUR|USD|€|\$)?$/i;

async function step(opts, i, n, label) {
  if (opts.isCancelled?.()) throw new CancelledError();
  opts.onProgress?.(i, n, label);
  await yieldToUi();
}

// ---------------------------------------------------------------------------
// Word helpers
// ---------------------------------------------------------------------------
let measureCtx = null;
function measureRun(run) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = `${run.italic ? "italic " : ""}${run.bold ? "700" : "400"} ${run.size}px "${run.family}"`;
  return measureCtx.measureText(run.text).width;
}

/** Extra letter spacing (twips) so Word's line is as wide as the original. */
function fitSpacing(seg) {
  const chars = seg.runs.reduce((n, r) => n + [...r.text].length, 0);
  if (chars < 3) return 0;
  const natural = seg.runs.reduce((w, r) => w + measureRun(r), 0);
  const perChar = clamp((seg.x1 - seg.x0 - natural) / chars, -seg.fs * 0.08, seg.fs * 0.3);
  const twips = Math.round(perChar * 20);
  return Math.abs(twips) >= 1 ? twips : 0;
}

function isLight(hex) {
  if (!hex) return false;
  const n = parseInt(hex, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.8;
}

/** Same background behind all segments → that colour, else null. */
function commonBackground(segments) {
  const first = segments[0]?.bgColor;
  return first && segments.every(s => s.bgColor === first) ? first : null;
}

function makeRun(docx, run, extra = {}, { onBackground = null } = {}) {
  let color = run.color && run.color !== "000000" ? run.color : undefined;
  // White text only works on its original dark background.
  if (!onBackground && isLight(color)) color = undefined;
  return new docx.TextRun({
    text: cleanText(run.text),
    font: run.family,
    size: Math.max(2, Math.round(run.size * 2)),
    bold: run.bold || undefined,
    italics: run.italic || undefined,
    color,
    ...extra,
  });
}

function shadingFor(docx, fill) {
  return fill ? { type: docx.ShadingType.CLEAR, color: "auto", fill } : undefined;
}

// ---------------------------------------------------------------------------
// Word: exact layout, editable
// ---------------------------------------------------------------------------
async function exactSections(docx, pdf, pages, opts) {
  const {
    Paragraph,
    ImageRun,
    LineRuleType,
    FrameAnchorType,
    FrameWrap,
    HorizontalPositionRelativeFrom,
    VerticalPositionRelativeFrom,
    TextWrappingType,
  } = docx;
  const sections = [];
  for (let i = 0; i < pages.length; i++) {
    await step(opts, i, pages.length, t("Page {n}", { n: pages[i] }));
    const page = await analyzePage(pdf, pages[i], { scale: 2, background: true, keepInvisible: false });
    const children = [];

    // Graphics, images, lines and anything that isn't plain text: one picture behind the text.
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
        children: page.background
          ? [
              new ImageRun({
                type: "jpg",
                data: page.background.data,
                transformation: { width: px(page.width), height: px(page.height) },
                floating: {
                  horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                  verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                  behindDocument: true,
                  allowOverlap: true,
                  lockAnchor: true,
                  wrap: { type: TextWrappingType.NONE },
                },
              }),
            ]
          : [],
      }),
    );

    // Every text segment as an editable paragraph in an absolutely positioned frame.
    for (const line of page.lines) {
      for (const seg of line.segments) {
        const lineHeight = seg.fs * 1.2;
        const descent = clamp(-seg.descent, 0.12, 0.35) * seg.fs;
        const top = Math.max(0, seg.y - lineHeight + descent);
        const spacing = fitSpacing(seg);
        children.push(
          new Paragraph({
            frame: {
              type: "absolute",
              position: { x: tw(Math.max(0, seg.x0)), y: tw(top) },
              width: undefined, // auto width: never wraps
              height: undefined,
              anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
              wrap: FrameWrap.AROUND,
            },
            spacing: { before: 0, after: 0, line: tw(lineHeight), lineRule: LineRuleType.EXACT },
            children: seg.runs.map(r =>
              makeRun(docx, r, spacing ? { characterSpacing: spacing } : {}, { onBackground: "picture" }),
            ),
          }),
        );
      }
    }

    sections.push({
      properties: {
        page: {
          size: { width: tw(page.width), height: tw(page.height) },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
        },
      },
      children,
    });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Word: flowing text with paragraphs, headings and tables
// ---------------------------------------------------------------------------
function lineInfo(line) {
  const segs = line.segments;
  return {
    y: line.y,
    fs: line.fs,
    x0: segs[0].x0,
    x1: segs.at(-1).x1,
    segments: segs,
    text: segs.map(s => s.text).join(" "),
  };
}

function textColumn(page) {
  const xs0 = [];
  const xs1 = [];
  for (const l of page.lines) {
    xs0.push(l.segments[0].x0);
    xs1.push(l.segments.at(-1).x1);
  }
  if (!xs0.length) return { l: 72, r: page.width - 72 };
  xs0.sort((a, b) => a - b);
  xs1.sort((a, b) => a - b);
  // Ignore stray outliers (page numbers in the margin etc.).
  return { l: xs0[Math.floor(xs0.length * 0.05)], r: xs1[Math.ceil(xs1.length * 0.95) - 1] };
}

function pageBlocks(page) {
  const blocks = [];
  const lines = page.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].segments.length >= 2) {
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j].segments.length >= 2 &&
        lines[j].y - lines[j - 1].y < 3.2 * Math.max(lines[j].fs, lines[j - 1].fs)
      ) {
        j++;
      }
      if (j - i >= 2) {
        const rows = lines.slice(i, j);
        const columns = inferColumns(rows, page.width);
        if (columns.length >= 2) {
          blocks.push({ type: "table", columns, rows: rows.map(r => assignColumns(r.segments, columns)), y: rows[0].y, endY: rows.at(-1).y, fs: rows.at(-1).fs });
          i = j;
          continue;
        }
      }
    }
    blocks.push({ type: "line", line: lineInfo(lines[i]) });
    i++;
  }

  // Merge consecutive lines into paragraphs.
  const col = textColumn(page);
  const colWidth = Math.max(1, col.r - col.l);
  const merged = [];
  for (const block of blocks) {
    if (block.type !== "line") {
      merged.push(block);
      continue;
    }
    const line = block.line;
    const prevBlock = merged.at(-1);
    if (prevBlock?.type === "para") {
      const prev = prevBlock.lines.at(-1);
      const gap = line.y - prev.y;
      const sameSize = Math.abs(line.fs - prev.fs) <= 0.15 * Math.max(line.fs, prev.fs);
      const close = gap > 0 && gap <= Math.max(line.fs, prev.fs) * 1.75;
      const prevShort = prev.x1 < col.r - Math.max(prev.fs * 3, colWidth * 0.12);
      const indented = line.x0 > prev.x0 + prev.fs * 1.5;
      const bullet = /^([•◦▪▫●○■□►✓–—*-]|\(?\d{1,3}[.)]|[a-z][.)])\s/i.test(line.text);
      const centered = Math.abs((line.x0 + line.x1) / 2 - (col.l + col.r) / 2) < colWidth * 0.04;
      if (close && sameSize && (!prevShort || centered) && !indented && !bullet && line.segments.length === 1) {
        prevBlock.lines.push(line);
        continue;
      }
    }
    merged.push({ type: "para", lines: [line] });
  }
  return { blocks: merged, col };
}

function paragraphFromLines(docx, para, col, bodySize, extra) {
  const { Paragraph, AlignmentType, HeadingLevel, LineRuleType, Tab, TextRun } = docx;
  const lines = para.lines;
  const colWidth = Math.max(1, col.r - col.l);
  const size = Math.max(...lines.map(l => l.fs));

  // Runs, joining lines with spaces (and undoing hyphenation).
  const runs = [];
  lines.forEach((line, li) => {
    line.segments.forEach((seg, si) => {
      seg.runs.forEach((r, ri) => {
        let text = r.text;
        if (li > 0 && si === 0 && ri === 0) {
          const last = runs.at(-1);
          if (last && /[A-Za-zÀ-ž]-$/.test(last.text) && /^[a-zà-ž]/.test(text)) last.text = last.text.slice(0, -1);
          else if (last && !/\s$/.test(last.text)) text = " " + text.trimStart();
        }
        if (si > 0 && ri === 0) runs.push({ tab: true });
        const last = runs.at(-1);
        if (last && !last.tab && last.key === r.key && Math.abs(last.size - r.size) < 0.6 && last.color === r.color) last.text += text;
        else runs.push({ ...r, text });
      });
    });
  });

  // Alignment and indentation.
  const centered =
    lines.every(l => Math.abs((l.x0 + l.x1) / 2 - (col.l + col.r) / 2) < colWidth * 0.04) &&
    lines.some(l => l.x1 - l.x0 < colWidth * 0.85);
  const right = !centered && lines.every(l => Math.abs(l.x1 - col.r) < 4) && lines.some(l => l.x0 > col.l + colWidth * 0.25);
  const maxRight = Math.max(...lines.map(l => l.x1));
  const justified = !centered && !right && lines.length >= 3 && lines.slice(0, -1).every(l => maxRight - l.x1 < 3);
  const minX0 = Math.min(...lines.map(l => l.x0));
  const indentLeft = centered || right ? 0 : Math.max(0, minX0 - col.l);
  const firstLine = lines.length > 1 ? lines[0].x0 - Math.min(...lines.slice(1).map(l => l.x0)) : 0;

  let lineSpacing;
  if (lines.length > 1) {
    const avgGap = (lines.at(-1).y - lines[0].y) / (lines.length - 1);
    lineSpacing = { line: Math.round(clamp(avgGap / (size * 1.17), 0.85, 3) * 240), lineRule: LineRuleType.AUTO };
  }

  const ratio = size / bodySize;
  const heading = ratio >= 1.6 ? HeadingLevel.HEADING_1 : ratio >= 1.25 ? HeadingLevel.HEADING_2 : undefined;

  const background = commonBackground(lines.flatMap(l => l.segments));

  const indent = {};
  if (firstLine < -4) {
    // Hanging indent (lists): "left" is where the following lines start.
    indent.left = tw(indentLeft - firstLine);
    indent.hanging = tw(-firstLine);
  } else {
    if (indentLeft > 4) indent.left = tw(indentLeft);
    if (firstLine > 4) indent.firstLine = tw(firstLine);
  }

  return new Paragraph({
    heading,
    alignment: centered ? AlignmentType.CENTER : right ? AlignmentType.RIGHT : justified ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    indent: Object.keys(indent).length ? indent : undefined,
    spacing: { before: 0, after: tw(extra.after ?? 6), ...lineSpacing },
    pageBreakBefore: extra.pageBreakBefore || undefined,
    keepLines: true,
    shading: shadingFor(docx, background),
    children: runs.map(r =>
      r.tab ? new TextRun({ children: [new Tab()] }) : makeRun(docx, r, {}, { onBackground: background }),
    ),
  });
}

function tableFromBlock(docx, block) {
  const { Table, TableRow, TableCell, Paragraph, WidthType, BorderStyle, AlignmentType, TextRun } = docx;
  const widths = block.columns.map(c => tw(Math.max(24, c.x1 - c.x0 + 10)));
  const line = { style: BorderStyle.SINGLE, size: 4, color: "C8C3BB" };
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: block.rows.map(
      cells =>
        new TableRow({
          children: cells.map((segs, ci) => {
            const text = segs.map(s => s.text).join(" ");
            const background = commonBackground(segs);
            const runs = [];
            segs.forEach((s, k) => {
              if (k) runs.push(new TextRun({ text: " " }));
              s.runs.forEach(r => runs.push(makeRun(docx, r, {}, { onBackground: background })));
            });
            return new TableCell({
              width: { size: widths[ci], type: WidthType.DXA },
              margins: { top: 40, bottom: 40, left: 90, right: 90 },
              shading: shadingFor(docx, background),
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  alignment: NUMBER_LIKE.test(text.trim()) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: runs,
                }),
              ],
            });
          }),
        }),
    ),
  });
}

async function flowSections(docx, pdf, pages, opts) {
  const { Paragraph } = docx;
  const analysed = [];
  for (let i = 0; i < pages.length; i++) {
    await step(opts, i, pages.length, t("Page {n}", { n: pages[i] }));
    analysed.push(await analyzePage(pdf, pages[i], { scale: 1.5, keepInvisible: true }));
  }

  // Body text size = most common size, weighted by characters.
  const weights = new Map();
  for (const page of analysed) {
    for (const line of page.lines) {
      for (const seg of line.segments) {
        for (const r of seg.runs) {
          const key = Math.round(r.size * 2) / 2;
          weights.set(key, (weights.get(key) || 0) + r.text.length);
        }
      }
    }
  }
  const bodySize = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;

  const children = [];
  analysed.forEach((page, pageIndex) => {
    const { blocks, col } = pageBlocks(page);
    let breakBefore = pageIndex > 0;
    blocks.forEach((block, bi) => {
      const next = blocks[bi + 1];
      if (block.type === "table") {
        if (breakBefore) {
          children.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }));
          breakBefore = false;
        }
        children.push(tableFromBlock(docx, block));
        children.push(new Paragraph({ spacing: { before: 0, after: 80 }, children: [] }));
        return;
      }
      const last = block.lines.at(-1);
      const nextY = next ? (next.type === "table" ? next.y : next.lines[0].y) : null;
      const after = nextY !== null ? clamp(nextY - last.y - last.fs * 1.25, 0, 24) : 6;
      children.push(paragraphFromLines(docx, block, col, bodySize, { after, pageBreakBefore: breakBefore }));
      breakBefore = false;
    });
    if (!blocks.length && breakBefore) children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
  });

  if (!children.length) {
    children.push(new Paragraph({ children: [makeRun(docx, { text: t("No selectable text was found. This PDF is probably a scan — try the Exact layout option."), size: 11 })] }));
  }

  const first = analysed[0];
  const col = first ? textColumn(first) : { l: 72, r: 523 };
  const top = first?.lines.length ? first.lines[0].y - first.lines[0].fs : 72;
  return [
    {
      properties: {
        page: {
          size: { width: tw(first?.width ?? 595), height: tw(first?.height ?? 842) },
          margin: {
            left: tw(clamp(col.l, 36, 108)),
            right: tw(clamp((first?.width ?? 595) - col.r, 36, 108)),
            top: tw(clamp(top, 36, 90)),
            bottom: tw(54),
          },
        },
      },
      children,
    },
  ];
}

// ---------------------------------------------------------------------------
// Word: page images
// ---------------------------------------------------------------------------
async function imageSections(docx, pdf, pages, opts) {
  const { Paragraph, ImageRun } = docx;
  const sections = [];
  for (let i = 0; i < pages.length; i++) {
    await step(opts, i, pages.length, t("Page {n}", { n: pages[i] }));
    const page = await pdf.getPage(pages[i]);
    const vp = page.getViewport({ scale: 1 });
    const data = await pageToImage(pdf, pages[i], { format: "jpg", dpi: 150, quality: 0.88 });
    sections.push({
      properties: {
        page: {
          size: { width: tw(vp.width), height: tw(vp.height) },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
        },
      },
      children: [
        new Paragraph({
          children: [new ImageRun({ type: "jpg", data, transformation: { width: px(vp.width), height: px(vp.height) - 2 } })],
        }),
      ],
    });
  }
  return sections;
}

/**
 * opts: { mode: "exact"|"flow"|"images", title, onProgress(i, n, label), isCancelled() }
 */
export async function pdfToDocx(pdf, pages, opts = {}) {
  const docx = await import("docx");
  const build = { exact: exactSections, flow: flowSections, images: imageSections }[opts.mode] || exactSections;
  const sections = await build(docx, pdf, pages, opts);
  opts.onProgress?.(pages.length, pages.length, t("Writing the Word file…"));
  await yieldToUi();
  const document = new docx.Document({
    title: opts.title || undefined,
    creator: "PDF Tool",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections,
  });
  const blob = await docx.Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/** Parses "1 234,56", "1,234.56", "(12)", "15%", "€ 9.99"… Returns { value, fmt } or null. */
export function parseNumber(raw) {
  let t = raw.trim();
  if (!t || t.length > 32) return null;
  let negative = false;
  let percent = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1).trim();
  }
  const signs = () => {
    if (/^[-−–]/.test(t)) {
      negative = !negative;
      t = t.slice(1).trim();
    } else if (t.startsWith("+")) {
      t = t.slice(1).trim();
    }
  };
  signs();
  if (t.endsWith("%")) {
    percent = true;
    t = t.slice(0, -1).trim();
  }
  t = t.replace(/^(?:[$€£¥]|zł|PLN|USD|EUR|GBP)\s*/i, "").replace(/\s*(?:[$€£¥]|zł|PLN|USD|EUR|GBP)$/i, "");
  signs();
  if (!/^\d[\d\s  .,']*$/.test(t)) return null;
  const compact = t.replace(/[\s  ']/g, "");
  if (/^0\d/.test(compact) || compact.replace(/\D/g, "").length > 15) return null; // IDs, codes
  const hasGrouping = compact !== t || /[.,]\d{3}(?![\d])/.test(compact);
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let decimal = null;
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? "," : ".";
  else if (lastComma >= 0) decimal = (compact.match(/,/g).length === 1 && !/,\d{3}$/.test(compact)) ? "," : null;
  else if (lastDot >= 0) decimal = compact.match(/\./g).length === 1 ? "." : null;
  let intPart = compact;
  let frac = "";
  if (decimal) {
    const k = compact.lastIndexOf(decimal);
    intPart = compact.slice(0, k);
    frac = compact.slice(k + 1);
    if (!/^\d+$/.test(frac) || !intPart) return null;
  }
  const group = decimal === "," ? "." : decimal === "." ? "," : compact.includes(",") ? "," : ".";
  if (intPart.includes(group)) {
    if (!new RegExp(`^\\d{1,3}(\\${group}\\d{3})+$`).test(intPart)) return null;
    intPart = intPart.split(group).join("");
  }
  if (!/^\d+$/.test(intPart)) return null;
  let value = Number(`${intPart}${frac ? `.${frac}` : ""}`);
  if (!Number.isFinite(value)) return null;
  if (negative) value = -value;
  if (percent) return { value: value / 100, fmt: 3 };
  return { value, fmt: frac ? 2 : hasGrouping ? 1 : 0 };
}

const xmlEscape = s =>
  cleanText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columnName(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    name = String.fromCharCode(65 + m) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows, numbers) {
  const widths = [];
  const body = rows
    .map((cells, ri) => {
      const r = ri + 1;
      const xml = [];
      cells.forEach((cell, ci) => {
        if (!cell || !cell.text.trim()) return;
        const ref = `${columnName(ci)}${r}`;
        const text = cell.text.trim();
        widths[ci] = Math.max(widths[ci] || 0, Math.min(text.length, 80));
        const num = numbers ? parseNumber(text) : null;
        const style = (cell.bold ? 4 : 0) + (num ? num.fmt : 0);
        if (num) xml.push(`<c r="${ref}" s="${style}"><v>${num.value}</v></c>`);
        else xml.push(`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`);
      });
      return xml.length ? `<row r="${r}">${xml.join("")}</row>` : "";
    })
    .join("");
  const cols = widths.length
    ? `<cols>${widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${clamp(Math.round((w || 6) * 1.1 + 2), 8, 80)}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="8">` +
  [0, 1]
    .flatMap(font =>
      [0, 3, 4, 10].map(
        fmt => `<xf numFmtId="${fmt}" fontId="${font}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`,
      ),
    )
    .join("") +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

async function writeXlsx(sheets, { numbers, title }) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const used = new Set();
  const names = sheets.map(s => {
    let base = s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 27)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`,
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xmlEscape(title || "")}</dc:title><dc:creator>PDF Tool</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      `</cp:coreProperties>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES_XML);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, numbers)));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/**
 * opts: { oneSheet, numbers, title, onProgress, isCancelled }
 */
export async function pdfToXlsx(pdf, pages, opts = {}) {
  const sheets = [];
  const combined = { name: t("All pages"), rows: [] };
  for (let i = 0; i < pages.length; i++) {
    await step(opts, i, pages.length, t("Page {n}", { n: pages[i] }));
    const page = await analyzePage(pdf, pages[i], { render: false, splitGap: 0.75 });
    const columns = inferColumns(page.lines, page.width);
    const rows = [];
    let prev = null;
    for (const line of page.lines) {
      // Keep visible gaps between blocks of text as empty rows.
      if (prev && line.y - prev.y > Math.max(line.fs, prev.fs) * 2.6) rows.push([]);
      rows.push(
        assignColumns(line.segments, columns).map(segs =>
          segs.length
            ? { text: segs.map(s => s.text).join(" "), bold: segs.every(s => s.runs.every(r => r.bold)) }
            : null,
        ),
      );
      prev = line;
    }
    if (opts.oneSheet) combined.rows.push(...rows);
    else sheets.push({ name: t("Page {n}", { n: pages[i] }), rows });
  }
  if (opts.oneSheet) sheets.push(combined);
  opts.onProgress?.(pages.length, pages.length, t("Writing the Excel file…"));
  await yieldToUi();
  return writeXlsx(sheets, opts);
}
