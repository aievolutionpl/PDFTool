// Bundles the renderer (src/) into dist/ and copies the pdf.js runtime assets.
// Usage: node scripts/build.mjs [--serve] [--dev]
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const pdfjs = path.join(root, "node_modules", "pdfjs-dist");
const serve = process.argv.includes("--serve");
const dev = serve || process.argv.includes("--dev");

async function copyAssets() {
  await mkdir(dist, { recursive: true });
  const copies = [
    [path.join(root, "src", "index.html"), path.join(dist, "index.html")],
    [path.join(root, "src", "styles.css"), path.join(dist, "styles.css")],
    [path.join(root, "src", "theme-init.js"), path.join(dist, "theme-init.js")],
    [path.join(pdfjs, "build", "pdf.worker.min.mjs"), path.join(dist, "pdf.worker.min.mjs")],
    [path.join(pdfjs, "web", "pdf_viewer.css"), path.join(dist, "pdf_viewer.css")],
    [path.join(pdfjs, "web", "images"), path.join(dist, "images")],
    [path.join(pdfjs, "cmaps"), path.join(dist, "cmaps")],
    [path.join(pdfjs, "standard_fonts"), path.join(dist, "standard_fonts")],
    [path.join(pdfjs, "wasm"), path.join(dist, "wasm")],
    [path.join(pdfjs, "iccs"), path.join(dist, "iccs")],
  ];
  for (const [from, to] of copies) {
    await cp(from, to, { recursive: true });
  }
  // IBM Plex (Latin + Latin Extended) bundled locally — the app works offline.
  await mkdir(path.join(dist, "fonts"), { recursive: true });
  const fonts = [
    ["ibm-plex-sans", [400, 500, 600, 700]],
    ["ibm-plex-mono", [400, 500]],
  ];
  for (const [family, weights] of fonts) {
    for (const weight of weights) {
      for (const subset of ["latin", "latin-ext"]) {
        const file = `${family}-${subset}-${weight}-normal.woff2`;
        await cp(path.join(root, "node_modules", "@fontsource", family, "files", file), path.join(dist, "fonts", file));
      }
    }
  }
}

const options = {
  entryPoints: [path.join(root, "src", "app.js")],
  outdir: dist,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["chrome130"],
  minify: !dev,
  sourcemap: dev ? "linked" : false,
  chunkNames: "chunks/[name]-[hash]",
  logLevel: "info",
  legalComments: "none",
};

await rm(dist, { recursive: true, force: true });
await copyAssets();

if (serve) {
  // Browser preview of the UI (no Electron APIs; falls back to file inputs/downloads).
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "copy-static",
        setup(build) {
          build.onEnd(() => copyAssets().catch(err => console.error(err)));
        },
      },
    ],
  });
  await ctx.watch();
  // esbuild only watches the JS graph; also re-copy HTML/CSS when they change.
  let timer = null;
  watch(path.join(root, "src"), { recursive: true }, (_event, file) => {
    if (!file || file.endsWith(".js")) return;
    clearTimeout(timer);
    timer = setTimeout(() => copyAssets().catch(err => console.error(err)), 100);
  });
  const { port } = await ctx.serve({ servedir: dist, port: 5199 });
  console.log(`PDF Tool web preview: http://localhost:${port}/`);
} else {
  await esbuild.build(options);
}
