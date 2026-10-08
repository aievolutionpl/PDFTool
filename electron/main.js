"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  shell,
} = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://pdftool`;
const DIST_DIR = path.join(__dirname, "..", "dist");
const MAX_RECENT = 12;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ftl": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".icc": "application/octet-stream",
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ---------------------------------------------------------------------------
// File access allow-list: the renderer may only read/write files the user
// picked through a dialog, opened via Explorer, dropped, or has in "recent".
// ---------------------------------------------------------------------------
const allowedFiles = new Set();
const allowedFolders = new Set();
const keyOf = p => path.resolve(p).toLowerCase();
const allowFile = p => p && allowedFiles.add(keyOf(p));
const isAllowedFile = p => typeof p === "string" && allowedFiles.has(keyOf(p));
const isAllowedFolder = p => typeof p === "string" && allowedFolders.has(keyOf(p));

// ---------------------------------------------------------------------------
// Recent files
// ---------------------------------------------------------------------------
const recentFile = () => path.join(app.getPath("userData"), "recent.json");

function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeRecent(list) {
  try {
    fs.mkdirSync(path.dirname(recentFile()), { recursive: true });
    fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, MAX_RECENT), null, 2));
  } catch (err) {
    console.error("Could not save recent files", err);
  }
}

function addRecent(filePath) {
  const key = keyOf(filePath);
  const list = readRecent().filter(item => keyOf(item.path) !== key);
  list.unshift({ path: filePath, name: path.basename(filePath), time: Date.now() });
  writeRecent(list);
  if (process.platform === "win32") {
    app.addRecentDocument(filePath);
  }
}

// ---------------------------------------------------------------------------
// Texts shown by native dialogs, in the interface language set by the renderer.
// ---------------------------------------------------------------------------
const NATIVE_TEXT = {
  en: {
    save: "Save",
    dontSave: "Don't save",
    cancel: "Cancel",
    unsavedTitle: "Unsaved changes",
    unsavedMessage: name => `Save changes to "${name}" before closing?`,
    thisDocument: "this document",
    unsavedDetail: "Your annotations and page edits will be lost if you don't save them.",
    open: "Open",
    chooseFolder: "Choose a folder",
  },
  pl: {
    save: "Zapisz",
    dontSave: "Nie zapisuj",
    cancel: "Anuluj",
    unsavedTitle: "Niezapisane zmiany",
    unsavedMessage: name => `Zapisać zmiany w pliku „${name}” przed zamknięciem?`,
    thisDocument: "tym dokumencie",
    unsavedDetail: "Jeśli ich nie zapiszesz, adnotacje i zmiany stron zostaną utracone.",
    open: "Otwórz",
    chooseFolder: "Wybierz folder",
  },
};
let uiLanguage = "en";
const text = () => NATIVE_TEXT[uiLanguage] || NATIVE_TEXT.en;

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
const windows = new Map(); // id -> { win, dirty, name, forceClose, launchFile }
let lastDir = null;

function findPdfArg(argv) {
  return argv
    .slice(1)
    .find(arg => !arg.startsWith("-") && /\.pdf$/i.test(arg) && fs.existsSync(arg)) || null;
}

function titleBarColors(dark) {
  return dark
    ? { color: "#1a1918", symbolColor: "#ece9e4", height: 44 }
    : { color: "#fbfaf8", symbolColor: "#1c1b1a", height: 44 };
}

function createWindow(launchFile = null) {
  const dark = nativeTheme.shouldUseDarkColors;
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 860,
    minHeight: 560,
    title: "PDF Tool",
    show: false,
    backgroundColor: dark ? "#1a1918" : "#fbfaf8",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : titleBarColors(dark),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: process.env.PDFTOOL_HIDDEN !== "1",
    },
  });

  const entry = { win, dirty: false, name: "", forceClose: false, launchFile };
  windows.set(win.id, entry);
  if (launchFile) {
    allowFile(launchFile);
  }

  // PDFTOOL_HIDDEN=1 shows the window off-screen, without focus or taskbar
  // button (used for automated checks and README screenshots).
  if (process.env.PDFTOOL_HIDDEN === "1") {
    win.once("ready-to-show", () => {
      win.setSkipTaskbar(true);
      win.setPosition(-30000, -30000);
      win.showInactive();
    });
  } else {
    win.once("ready-to-show", () => win.show());
  }
  win.loadURL(`${APP_ORIGIN}/index.html`);

  // Never navigate away from the app; open web links in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      if (/^(https?:|mailto:)/i.test(url)) {
        shell.openExternal(url);
      }
    }
  });

  win.on("close", event => {
    if (!entry.dirty || entry.forceClose) {
      return;
    }
    event.preventDefault();
    const s = text();
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: [s.save, s.dontSave, s.cancel],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: s.unsavedTitle,
      message: s.unsavedMessage(entry.name || s.thisDocument),
      detail: s.unsavedDetail,
    });
    if (choice === 0) {
      win.webContents.send("app:command", "save-and-close");
    } else if (choice === 1) {
      entry.forceClose = true;
      win.close();
    }
  });
  win.on("closed", () => windows.delete(win.id));
  return win;
}

function entryFor(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? windows.get(win.id) : null;
}

function openInWindow(filePath) {
  allowFile(filePath);
  // Reuse an empty window if there is one, otherwise open a new window.
  const empty = [...windows.values()].find(e => !e.name && !e.win.isDestroyed());
  if (empty) {
    if (empty.win.isMinimized()) empty.win.restore();
    empty.win.focus();
    empty.win.webContents.send("app:openFile", filePath);
  } else {
    createWindow(filePath);
  }
}

async function readEntry(filePath) {
  const data = await fsp.readFile(filePath);
  return { name: path.basename(filePath), path: filePath, data: new Uint8Array(data) };
}

function safeName(name) {
  return path.basename(String(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "file";
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle("dialog:openFiles", async (event, opts = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const properties = ["openFile"];
    if (opts.multiple) properties.push("multiSelections");
    const result = await dialog.showOpenDialog(win, {
      title: opts.title || text().open,
      defaultPath: lastDir || app.getPath("documents"),
      filters: opts.filters || [{ name: "PDF documents", extensions: ["pdf"] }],
      properties,
    });
    if (result.canceled) return [];
    lastDir = path.dirname(result.filePaths[0]);
    const files = [];
    for (const filePath of result.filePaths) {
      allowFile(filePath);
      files.push(await readEntry(filePath));
    }
    return files;
  });

  ipcMain.handle("dialog:saveFile", async (event, opts = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: opts.title || "Save",
      defaultPath: path.join(lastDir || app.getPath("documents"), safeName(opts.defaultName || "document.pdf")),
      filters: opts.filters || [{ name: "PDF documents", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, opts.data);
    lastDir = path.dirname(result.filePath);
    allowFile(result.filePath);
    return { path: result.filePath, name: path.basename(result.filePath) };
  });

  ipcMain.handle("dialog:pickSavePath", async (event, opts = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: opts.title || "Save",
      defaultPath: path.join(lastDir || app.getPath("documents"), safeName(opts.defaultName || "document")),
      filters: opts.filters,
    });
    if (result.canceled || !result.filePath) return null;
    lastDir = path.dirname(result.filePath);
    allowFile(result.filePath);
    return { path: result.filePath, name: path.basename(result.filePath) };
  });

  ipcMain.handle("shell:openPath", async (_event, filePath) => {
    if (!isAllowedFile(filePath)) throw new Error("Access to this file was not granted.");
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  });

  ipcMain.handle("fs:writeFile", async (_event, filePath, data) => {
    if (!isAllowedFile(filePath)) throw new Error("Access to this file was not granted.");
    await fsp.writeFile(filePath, data);
    return true;
  });

  ipcMain.handle("fs:readFile", async (_event, filePath) => {
    if (!isAllowedFile(filePath)) throw new Error("Access to this file was not granted.");
    return readEntry(filePath);
  });

  ipcMain.handle("dialog:pickFolder", async (event, opts = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: opts.title || text().chooseFolder,
      defaultPath: lastDir || app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const folder = result.filePaths[0];
    allowedFolders.add(keyOf(folder));
    lastDir = folder;
    return folder;
  });

  ipcMain.handle("fs:writeToFolder", async (_event, folder, files) => {
    if (!isAllowedFolder(folder)) throw new Error("Access to this folder was not granted.");
    const written = [];
    for (const file of files) {
      const target = path.join(folder, safeName(file.name));
      await fsp.writeFile(target, file.data);
      allowFile(target);
      written.push(target);
    }
    return written;
  });

  ipcMain.on("fs:allowPath", (_event, filePath) => {
    if (typeof filePath === "string" && filePath) allowFile(filePath);
  });

  ipcMain.handle("recent:get", async () => {
    const list = readRecent().filter(item => fs.existsSync(item.path));
    list.forEach(item => allowFile(item.path));
    return list;
  });
  ipcMain.handle("recent:add", (_event, filePath) => {
    if (isAllowedFile(filePath)) addRecent(filePath);
  });
  ipcMain.handle("recent:remove", (_event, filePath) => {
    writeRecent(readRecent().filter(item => keyOf(item.path) !== keyOf(filePath)));
  });
  ipcMain.handle("recent:clear", () => {
    writeRecent([]);
    if (process.platform === "win32") app.clearRecentDocuments();
  });

  ipcMain.handle("shell:showInFolder", (_event, filePath) => {
    if (isAllowedFile(filePath)) shell.showItemInFolder(filePath);
  });

  ipcMain.handle("win:getLaunchFile", event => {
    const entry = entryFor(event);
    if (!entry) return null;
    const file = entry.launchFile;
    entry.launchFile = null;
    return file;
  });

  ipcMain.on("win:setDirty", (event, dirty, name) => {
    const entry = entryFor(event);
    if (!entry) return;
    entry.dirty = !!dirty;
    entry.name = name || "";
    entry.win.setDocumentEdited?.(!!dirty);
  });

  ipcMain.on("win:forceClose", event => {
    const entry = entryFor(event);
    if (!entry) return;
    entry.forceClose = true;
    entry.win.close();
  });

  ipcMain.on("win:new", () => createWindow());

  ipcMain.on("app:setLanguage", (_event, code) => {
    if (NATIVE_TEXT[code]) uiLanguage = code;
  });

  ipcMain.on("win:setTitleBar", (event, dark) => {
    const entry = entryFor(event);
    if (entry && process.platform !== "darwin") {
      try {
        entry.win.setTitleBarOverlay(titleBarColors(!!dark));
      } catch {
        // Title bar overlay not available (e.g. Linux without WCO support).
      }
    }
  });

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
  }));
}

function registerProtocol() {
  protocol.handle(APP_SCHEME, async request => {
    const { pathname } = new URL(request.url);
    const filePath = path.normalize(path.join(DIST_DIR, decodeURIComponent(pathname)));
    if (!filePath.startsWith(DIST_DIR + path.sep)) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const body = await fsp.readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
// A separate profile lets a test copy run next to the user's own instance.
if (process.env.PDFTOOL_USER_DATA) {
  app.setPath("userData", process.env.PDFTOOL_USER_DATA);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const file = findPdfArg(argv);
    if (file) {
      openInWindow(file);
    } else {
      const [first] = windows.values();
      if (first) {
        if (first.win.isMinimized()) first.win.restore();
        first.win.focus();
      } else {
        createWindow();
      }
    }
  });

  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.pdftool.app");
    }
    Menu.setApplicationMenu(null);
    registerProtocol();
    registerIpc();
    createWindow(findPdfArg(process.argv));

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
