// Draws the PDF Tool mark and writes build/icon.png (512px) and build/icon.ico
// (16–256px). Pure Node — no image libraries needed.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "build");

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const INK = hex("#1c1b1a");
const PAPER = hex("#fbfaf8");
const FOLD = hex("#e0552b");
const LINE_2 = hex("#a39d94");

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour of the mark at (x, y) in a 32×32 design space (same geometry as #i-mark), or null if transparent. */
function sample(x, y) {
  if (!inRoundRect(x, y, 0, 0, 32, 32, 7)) return null;
  let color = INK;
  // Page: x 9–24, y 7–25, top-right corner cut along the fold diagonal.
  const inPage = inRoundRect(x, y, 9, 7, 24, 25, 1) && x - y <= 11.6;
  if (inPage) {
    color = PAPER;
    if (inRoundRect(x, y, 12, 15.6, 20, 17.3, 0.4)) color = INK;
    if (inRoundRect(x, y, 12, 19.2, 17.4, 20.9, 0.4)) color = LINE_2;
  }
  // Fold triangle in the red-pencil accent.
  if (x >= 18.6 && y <= 12.4 && x - y >= 6.2 && x - y <= 11.6) color = FOLD;
  return color;
}

function render(size) {
  const ss = size <= 32 ? 8 : 4;
  const data = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 32;
          const y = ((py + (sy + 0.5) / ss) / size) * 32;
          const c = sample(x, y);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        data[i] = Math.round(r / a);
        data[i + 1] = Math.round(g / a);
        data[i + 2] = Math.round(b / a);
        data[i + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return data;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "icon.png"), encodePng(512, render(512)));
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
writeFileSync(
  path.join(outDir, "icon.ico"),
  encodeIco(icoSizes.map(size => ({ size, png: encodePng(size, render(size)) }))),
);
console.log("Wrote build/icon.png and build/icon.ico");
