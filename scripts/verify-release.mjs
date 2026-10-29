// Verify the code shipped in the application, then hash both Windows downloads.
// Usage: node scripts/verify-release.mjs <app.asar> [--package-only]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = process.argv[2];
assert.ok(archive, "Pass the packaged app.asar path");
const sourcePackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const packaged = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
assert.equal(packaged.version, sourcePackage.version, "Packaged application version is stale");
assert.equal(lock.version, sourcePackage.version, "Lockfile version is stale");
assert.equal(lock.packages[""].version, sourcePackage.version, "Lockfile package version is stale");

const files = {};
for (const [packedName, sourceName] of [
  ["dist/styles.css", "src/styles.css"],
  ["dist/app.js", "dist/app.js"],
  ["dist/pdf_viewer.css", "dist/pdf_viewer.css"],
  ["dist/pdf.worker.min.mjs", "dist/pdf.worker.min.mjs"],
  ["electron/main.js", "electron/main.js"],
  ["electron/preload.js", "electron/preload.js"],
]) {
  const actual = asar.extractFile(archive, packedName);
  const expected = await readFile(path.join(root, sourceName));
  assert.ok(actual.equals(expected), `Packaged ${packedName} differs from this release's source/build`);
  files[packedName] = createHash("sha256").update(actual).digest("hex");
}
console.log(`Verified PDF Tool ${packaged.version}: all ${Object.keys(files).length} packaged files match this release`);
if (!process.argv.includes("--package-only")) {
  const output = path.resolve(path.dirname(archive), "../..");
  const checksums = {};
  for (const name of ["PDF-Tool-Setup.exe", "PDF-Tool-Portable.exe"]) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path.join(output, name))) hash.update(chunk);
    checksums[name] = hash.digest("hex");
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const manifest = JSON.stringify({ version: packaged.version, commit, packagedFiles: files, artifacts: checksums }, null, 2) + "\n";
  await writeFile(path.join(output, "build-info.json"), manifest);
  checksums["build-info.json"] = createHash("sha256").update(manifest).digest("hex");
  await writeFile(path.join(output, "SHA256SUMS.txt"), Object.entries(checksums).map(([name, sum]) => `${sum}  ${name}\n`).join(""));
  console.log("Created build-info.json and SHA256SUMS.txt for both Windows downloads");
}
