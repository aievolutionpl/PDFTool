// Thin wrapper over the Electron preload API (window.pdftool). When the UI runs
// in a plain browser (web preview), the same calls fall back to file inputs
// and downloads so every feature can still be exercised.

const native = window.pdftool || null;
export const isDesktop = !!native;

const MIME_BY_EXT = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function extOf(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

function browserPick({ filters, multiple }) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!multiple;
    const exts = (filters || []).flatMap(f => f.extensions);
    if (exts.length && !exts.includes("*")) {
      input.accept = exts.map(e => "." + e).join(",");
    }
    input.addEventListener("change", async () => {
      const files = [];
      for (const file of input.files) {
        files.push({ name: file.name, path: null, data: new Uint8Array(await file.arrayBuffer()) });
      }
      resolve(files);
    });
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

function browserDownload(name, data) {
  const blob = new Blob([data], { type: MIME_BY_EXT[extOf(name)] || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const platform = {
  /** @returns {Promise<Array<{name: string, path: string|null, data: Uint8Array}>>} */
  pickFiles(opts = {}) {
    return native ? native.pickFiles(opts) : browserPick(opts);
  },

  /** Shows a save dialog and writes `data`. @returns {Promise<{path, name}|null>} */
  async saveAs({ title, defaultName, filters, data }) {
    if (native) {
      return native.saveFile({ title, defaultName, filters, data });
    }
    browserDownload(defaultName, data);
    return { path: null, name: defaultName };
  },

  /** Asks where to save before doing slow work. @returns {Promise<{path, name}|null>} */
  async pickSavePath({ title, defaultName, filters }) {
    if (native) return native.pickSavePath({ title, defaultName, filters });
    return { path: null, name: defaultName };
  },

  /** Writes data to a target from pickSavePath (downloads in the browser preview). */
  async writeOutput(target, data) {
    if (native && target.path) return native.writeFile(target.path, data);
    browserDownload(target.name, data);
  },

  /** Opens a file with its default Windows app (Word, Excel, …). */
  openPath(path) {
    return native && path ? native.openPath(path) : Promise.resolve();
  },

  /** Overwrites a file the user already opened or saved. */
  writeFile(path, data) {
    if (!native) throw new Error("Saving in place needs the desktop app.");
    return native.writeFile(path, data);
  },

  readFile(path) {
    if (!native) throw new Error("Reading files by path needs the desktop app.");
    return native.readFile(path);
  },

  /** @returns {Promise<string|null>} a folder token to pass to writeToFolder. */
  async pickFolder(opts) {
    return native ? native.pickFolder(opts) : "downloads";
  },

  async writeToFolder(folder, files) {
    if (native) {
      return native.writeToFolder(folder, files);
    }
    for (const file of files) {
      browserDownload(file.name, file.data);
      await new Promise(r => setTimeout(r, 150));
    }
    return files.map(f => f.name);
  },

  showInFolder(path) {
    if (native && path) native.showInFolder(path);
  },

  pathForDroppedFile(file) {
    return native ? native.pathForDroppedFile(file) : null;
  },

  recent: {
    get: () => (native ? native.recent.get() : Promise.resolve([])),
    add: path => (native && path ? native.recent.add(path) : Promise.resolve()),
    remove: path => (native ? native.recent.remove(path) : Promise.resolve()),
    clear: () => (native ? native.recent.clear() : Promise.resolve()),
  },

  getLaunchFile: () => (native ? native.getLaunchFile() : Promise.resolve(null)),
  setDocState: (dirty, name) => native?.setDocState(dirty, name),
  forceClose: () => (native ? native.forceClose() : window.close()),
  newWindow: () => (native ? native.newWindow() : window.open(location.href, "_blank")),
  setTitleBarTheme: dark => native?.setTitleBarTheme(dark),
  appInfo: () => (native ? native.appInfo() : Promise.resolve({ version: "web preview" })),
  onOpenFile: cb => native?.onOpenFile(cb),
  onCommand: cb => native?.onCommand(cb),
};
