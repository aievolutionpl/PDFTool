// PDF Tool — renderer entry point.
// pdf.js core must be evaluated before the viewer component (it reads globalThis.pdfjsLib).
import * as pdfjsLib from "pdfjs-dist";
import {
  EventBus,
  FindState,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  $,
  $$,
  choose,
  closeMenus,
  errorToast,
  escapeHtml,
  formatBytes,
  icon,
  openDialog,
  parsePageRanges,
  progress,
  showMenu,
  toast,
} from "./ui.js";
import { isDesktop, platform } from "./platform.js";
import * as ops from "./pdf-ops.js";
import { clearThumbnailCache, extractText, pageToImage, renderPage, thumbnail } from "./convert.js";
import { CancelledError, pdfToDocx, pdfToXlsx } from "./office.js";
import { Organizer } from "./organizer.js";
import { createSignature } from "./signature.js";

const { AnnotationEditorType: AET, AnnotationEditorParamsType: AEP } = pdfjsLib;

const assetUrl = p => new URL(p, document.baseURI).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = assetUrl("pdf.worker.min.mjs");

const DOC_PARAMS = {
  cMapUrl: assetUrl("cmaps/"),
  cMapPacked: true,
  standardFontDataUrl: assetUrl("standard_fonts/"),
  wasmUrl: assetUrl("wasm/"),
  iccUrl: assetUrl("iccs/"),
  isEvalSupported: false,
  enableXfa: false,
};

const PDF_FILTER = [{ name: "PDF documents", extensions: ["pdf"] }];
const IMAGE_FILTER = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }];
const MODES = {
  none: AET.NONE,
  freetext: AET.FREETEXT,
  ink: AET.INK,
  highlight: AET.HIGHLIGHT,
  stamp: AET.STAMP,
};
const MODE_NAMES = Object.fromEntries(Object.entries(MODES).map(([k, v]) => [v, k]));

const store = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`pdftool.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`pdftool.${key}`, value);
    } catch {
      // ignore
    }
  },
};

const state = {
  pdf: null,
  bytes: null, // bytes on disk / last applied edit (includes saved annotations)
  name: "",
  path: null,
  editsDirty: false, // page-level edits not yet saved
  annotDirty: false, // annotation / form edits not yet saved
  docKey: "",
  loadId: 0,
  uiManager: null,
  mode: AET.NONE,
  editState: {},
  cursor: "select",
  pendingView: null,
  history: [],
  beforePresent: null,
};
const isDirty = () => state.editsDirty || state.annotDirty;
const baseName = name => (name || "document").replace(/\.pdf$/i, "");

const app = $("#app");
document.documentElement.classList.toggle("is-desktop", isDesktop);

// ===========================================================================
// Viewer
// ===========================================================================
const container = $("#viewerContainer");
const eventBus = new EventBus();
const linkService = new PDFLinkService({
  eventBus,
  externalLinkTarget: LinkTarget.BLANK,
  externalLinkRel: "noopener noreferrer nofollow",
});
const findController = new PDFFindController({ eventBus, linkService });
const viewer = new PDFViewer({
  container,
  viewer: $("#viewer"),
  eventBus,
  linkService,
  findController,
  removePageBorders: true,
  annotationEditorMode: AET.NONE,
  annotationEditorHighlightColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F",
  enableHighlightFloatingButton: true,
  imageResourcesPath: "./images/",
});
linkService.setViewer(viewer);

eventBus.on("pagesinit", () => {
  const view = state.pendingView;
  state.pendingView = null;
  applyLayout($("#layoutSelect").value);
  viewer.currentScaleValue = view?.scale || "auto";
  if (view?.rotation) viewer.pagesRotation = view.rotation;
  if (view?.page) viewer.currentPageNumber = Math.min(Math.max(1, view.page), viewer.pagesCount);
  updatePageUI(viewer.currentPageNumber);
});
eventBus.on("pagechanging", ({ pageNumber }) => updatePageUI(pageNumber));
eventBus.on("scalechanging", ({ scale }) => {
  $("#zoomBtn").textContent = `${Math.round(scale * 100)}%`;
});
eventBus.on("annotationeditoruimanager", ({ uiManager }) => {
  state.uiManager = uiManager;
});
eventBus.on("annotationeditormodechanged", ({ mode }) => {
  state.mode = mode;
  updateModeUI();
  pushToolParams(mode);
});
eventBus.on("switchannotationeditormode", evt => {
  setEditorMode(evt.mode, {
    editId: evt.editId,
    isFromKeyboard: evt.isFromKeyboard,
    mustEnterInEditMode: evt.mustEnterInEditMode,
    editComment: evt.editComment,
  });
  if (evt.mode !== AET.NONE) switchTab("annotate");
});
eventBus.on("editingstateschanged", ({ details }) => {
  const wasSelected = state.editState.hasSelectedEditor;
  state.editState = { ...details };
  updateEditButtons();
  // After deselecting, the toolbar values become the defaults for new annotations again.
  if (wasSelected && !details.hasSelectedEditor) pushToolParams(state.mode);
});
eventBus.on("annotationeditorparamschanged", ({ details }) => {
  // Only mirror a selected annotation's style; pdf.js' own defaults must not override the toolbar.
  if (state.uiManager?.hasSelection) syncToolParams(details);
});
eventBus.on("updatefindmatchescount", ({ matchesCount }) => updateFindCount(matchesCount));
eventBus.on("updatefindcontrolstate", ({ state: findState, matchesCount }) => updateFindCount(matchesCount, findState));

// ===========================================================================
// Opening, saving, closing
// ===========================================================================
function askPassword(name, reason) {
  const wrong = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
  return openDialog({
    title: "Password required",
    subtitle: `"${name}" is protected.`,
    content: `
      <label class="field"><span>${wrong ? "That password didn't work — try again" : "Enter the document password"}</span>
      <input class="input" type="password" name="password" autocomplete="off"></label>`,
    okLabel: "Unlock",
    validate: v => (v.password ? null : "Please enter the password."),
  }).then(v => (v ? v.password : null));
}

async function openDocument({ data, name, path = null, dirty = false, keepView = false, page = null, keepHistory = false }) {
  const loadId = ++state.loadId;
  let cancelled = false;
  const task = pdfjsLib.getDocument({ ...DOC_PARAMS, data: data.slice() });
  task.onPassword = (update, reason) => {
    askPassword(name, reason).then(pw => {
      if (pw === null) {
        cancelled = true;
        task.destroy();
      } else update(pw);
    });
  };

  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    if (!cancelled) errorToast(`Couldn't open "${name}"`, err);
    return false;
  }
  if (loadId !== state.loadId) {
    pdf.loadingTask.destroy();
    return false;
  }

  const old = state.pdf;
  const oldKey = state.docKey;
  state.pendingView =
    keepView && old
      ? { page: page ?? viewer.currentPageNumber, scale: viewer.currentScaleValue, rotation: viewer.pagesRotation }
      : page
        ? { page }
        : null;

  Object.assign(state, {
    pdf,
    bytes: data,
    name,
    path,
    editsDirty: dirty,
    annotDirty: false,
    docKey: `doc${loadId}`,
    uiManager: null,
    mode: AET.NONE,
    editState: {},
  });
  if (!keepHistory) state.history = [];

  pdf.annotationStorage.onSetModified = () => {
    if (state.pdf === pdf) {
      state.annotDirty = true;
      updateTitle();
    }
  };

  if (organizer.isOpen) organizer.close();
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  if (old) {
    old.loadingTask.destroy();
    clearThumbnailCache(oldKey);
  }

  app.classList.remove("no-doc");
  updateTitle();
  updateModeUI();
  updateEditButtons();
  setDocButtonsEnabled(true);
  buildThumbnails();
  buildOutline();
  if (!$("#findbar").hidden && $("#findInput").value) setTimeout(() => dispatchFind(""), 300);
  if (path && !keepView) platform.recent.add(path);
  container.focus({ preventScroll: true });
  return true;
}

async function confirmDiscard() {
  if (!state.pdf || !isDirty()) return true;
  const choice = await choose({
    title: "Unsaved changes",
    message: `Save changes to "${state.name}" first?`,
    buttons: [
      { label: "Cancel", value: "cancel" },
      { label: "Don't save", value: "discard" },
      { label: "Save", value: "save", kind: "primary" },
    ],
  });
  if (choice === "save") return save();
  return choice === "discard";
}

async function openViaDialog() {
  if (!(await confirmDiscard())) return;
  const [file] = await platform.pickFiles({ title: "Open PDF", filters: PDF_FILTER });
  if (file) await openDocument({ data: file.data, name: file.name, path: file.path });
}

async function openPath(filePath, { skipConfirm = false } = {}) {
  if (!skipConfirm && !(await confirmDiscard())) return;
  try {
    const file = await platform.readFile(filePath);
    await openDocument({ data: file.data, name: file.name, path: file.path });
  } catch (err) {
    errorToast("Couldn't open the file", err);
    platform.recent.remove(filePath);
    renderRecent();
  }
}

/** Opens freshly generated bytes as a new, unsaved document. */
async function openGenerated(bytes, name) {
  if (!(await confirmDiscard())) {
    // Still let the user keep the result.
    const res = await platform.saveAs({ title: "Save PDF", defaultName: name, filters: PDF_FILTER, data: bytes });
    if (res) toast(`Saved ${res.name}`, { type: "success" });
    return;
  }
  await openDocument({ data: bytes, name, path: null, dirty: true });
  toast(`Created ${name} — it isn't saved yet.`, {
    type: "success",
    timeout: 8000,
    action: { label: "Save", onClick: () => save({ saveAs: true }) },
  });
}

/** Current document bytes including any unsaved annotations and form values. */
async function currentBytes() {
  if (state.pdf && state.annotDirty && state.pdf.annotationStorage.size > 0) {
    return state.pdf.saveDocument();
  }
  return state.bytes.slice();
}

async function save({ saveAs = false } = {}) {
  if (!state.pdf) return false;
  const wasAnnotDirty = state.annotDirty;
  try {
    const data = await currentBytes();
    if (saveAs || !state.path || !isDesktop) {
      const res = await platform.saveAs({
        title: saveAs ? "Save a copy as" : "Save PDF",
        defaultName: state.name || "document.pdf",
        filters: PDF_FILTER,
        data,
      });
      if (!res) {
        state.annotDirty = wasAnnotDirty;
        return false;
      }
      if (res.path) state.path = res.path;
      state.name = res.name;
    } else {
      await platform.writeFile(state.path, data);
    }
    state.bytes = data;
    state.editsDirty = false;
    state.annotDirty = false;
    updateTitle();
    if (state.path) platform.recent.add(state.path);
    toast(`Saved ${state.name}`, { type: "success", timeout: 2500 });
    return true;
  } catch (err) {
    state.annotDirty = wasAnnotDirty;
    errorToast("Couldn't save", err);
    return false;
  }
}

async function closeDocument() {
  if (!state.pdf || !(await confirmDiscard())) return;
  if (organizer.isOpen) organizer.close();
  closeFind();
  const old = state.pdf;
  state.loadId++;
  viewer.setDocument(null);
  linkService.setDocument(null, null);
  old.loadingTask.destroy();
  clearThumbnailCache(state.docKey);
  Object.assign(state, { pdf: null, bytes: null, name: "", path: null, editsDirty: false, annotDirty: false, history: [] });
  app.classList.add("no-doc");
  $("#thumbs").innerHTML = "";
  $("#outline").innerHTML = "";
  $("#pageInput").value = "–";
  $("#pageCount").textContent = "/ –";
  $("#zoomBtn").textContent = "100%";
  updateDocInfo();
  updateTitle();
  setDocButtonsEnabled(false);
  renderRecent();
}

/** Applies a page-level change (pdf-lib), reloads, and offers undo. */
async function applyDocChange(producer, { message, page = null, busy = "Updating document…" } = {}) {
  const p = await progress(busy);
  try {
    const before = await currentBytes();
    const after = await producer(before);
    const prev = { bytes: before, page: viewer.currentPageNumber };
    const ok = await openDocument({ data: after, name: state.name, path: state.path, dirty: true, keepView: true, page, keepHistory: true });
    if (!ok) return false;
    state.history.push(prev);
    if (state.history.length > 20) state.history.shift();
    if (message) toast(message, { type: "success", action: { label: "Undo", onClick: undoDocChange } });
    return true;
  } catch (err) {
    errorToast("Couldn't change the document", err);
    return false;
  } finally {
    p.close();
  }
}

async function undoDocChange() {
  const prev = state.history.pop();
  if (!prev) return;
  await openDocument({ data: prev.bytes, name: state.name, path: state.path, dirty: true, keepView: true, page: prev.page, keepHistory: true });
  toast("Undone", { timeout: 1800 });
}

// ===========================================================================
// UI state updates
// ===========================================================================
function updateTitle() {
  const title = $("#docTitle");
  const dirty = !!state.pdf && isDirty();
  title.classList.toggle("has-doc", !!state.pdf);
  title.classList.toggle("dirty", dirty);
  $(".doc-name", title).textContent = state.pdf ? state.name : "No document";
  title.title = state.path || state.name || "";
  document.title = state.pdf ? `${dirty ? "● " : ""}${state.name} — PDF Tool` : "PDF Tool";
  platform.setDocState(dirty, state.pdf ? state.name : "");
}

function setDocButtonsEnabled(enabled) {
  $$("[data-needs-doc]").forEach(el => (el.disabled = !enabled));
}

async function updateDocInfo(pageNumber) {
  const pdf = state.pdf;
  const info = $("#docInfo");
  if (!pdf) {
    info.textContent = "";
    return;
  }
  const parts = [plural(pdf.numPages, "page"), formatBytes(state.bytes.byteLength)];
  try {
    const page = await pdf.getPage(pageNumber);
    const vp = page.getViewport({ scale: 1 });
    parts.push(pageSizeLabel(vp.width, vp.height));
  } catch {
    // Document was replaced meanwhile.
  }
  if (state.pdf === pdf) info.textContent = parts.join("  ·  ");
}

function updatePageUI(pageNumber) {
  $("#pageInput").value = String(pageNumber);
  $("#pageCount").textContent = `/ ${viewer.pagesCount || 1}`;
  updateDocInfo(pageNumber);
  const thumbs = $("#thumbs");
  thumbs.querySelector(".thumb.current")?.classList.remove("current");
  const current = thumbs.querySelector(`.thumb[data-page="${pageNumber}"]`);
  if (current) {
    current.classList.add("current");
    if (!app.classList.contains("no-sidebar")) current.scrollIntoView({ block: "nearest" });
  }
}

function updateModeUI() {
  const name = MODE_NAMES[state.mode] ?? "none";
  $$("[data-mode]").forEach(btn => btn.classList.toggle("active", state.pdf && btn.dataset.mode === name));
  $$("#toolParams .param").forEach(p => p.classList.toggle("show", p.dataset.for === name));
  updateCursorUI();
  updateEditButtons();
}

function updateEditButtons() {
  const editing = !!state.pdf && state.mode !== AET.NONE;
  const s = state.editState;
  $("[data-cmd='undo']").disabled = !editing || !s.hasSomethingToUndo;
  $("[data-cmd='redo']").disabled = !editing || !s.hasSomethingToRedo;
  $("[data-cmd='delete-annot']").disabled = !editing || !s.hasSelectedEditor;
}

function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tool-panel").forEach(p => (p.hidden = p.dataset.panel !== name));
  store.set("tab", name);
}

// ===========================================================================
// Annotation tools
// ===========================================================================
function setEditorMode(mode, extra = {}) {
  if (!state.pdf) return;
  if (viewer.annotationEditorMode === AET.DISABLE) {
    toast("This document doesn't allow annotations.", { type: "error" });
    return;
  }
  try {
    viewer.annotationEditorMode = { mode, ...extra };
  } catch (err) {
    errorToast("Couldn't switch tools", err);
  }
}

function setModeAndWait(mode) {
  if (viewer.annotationEditorMode === mode) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, 4000);
    function done() {
      clearTimeout(timer);
      eventBus.off("annotationeditormodechanged", onChange);
      resolve();
    }
    function onChange({ mode: changed }) {
      if (changed === mode) done();
    }
    eventBus.on("annotationeditormodechanged", onChange);
    setEditorMode(mode);
  });
}

function updateParam(type, value) {
  state.uiManager?.updateParams(type, value);
}

function pushToolParams(mode) {
  if (!state.uiManager) return;
  if (mode === AET.FREETEXT) {
    updateParam(AEP.FREETEXT_COLOR, $("#textColor").value);
    updateParam(AEP.FREETEXT_SIZE, Number($("#textSize").value));
  } else if (mode === AET.INK) {
    updateParam(AEP.INK_COLOR, $("#inkColor").value);
    updateParam(AEP.INK_THICKNESS, Number($("#inkThickness").value));
    updateParam(AEP.INK_OPACITY, Number($("#inkOpacity").value) / 100);
  } else if (mode === AET.HIGHLIGHT) {
    updateParam(AEP.HIGHLIGHT_COLOR, $("#highlightColors .active")?.dataset.color);
    updateParam(AEP.HIGHLIGHT_THICKNESS, Number($("#hlThickness").value));
  }
}

function setRange(id, value, suffix = "") {
  const input = $(id);
  input.value = String(value);
  input.nextElementSibling.textContent = `${Math.round(value)}${suffix}`;
}

/** Reflects the selected annotation's properties in the toolbar. */
function syncToolParams(details) {
  for (const [type, value] of details || []) {
    switch (type) {
      case AEP.FREETEXT_COLOR:
        $("#textColor").value = value;
        break;
      case AEP.FREETEXT_SIZE:
        setRange("#textSize", value);
        break;
      case AEP.INK_COLOR:
        $("#inkColor").value = value;
        break;
      case AEP.INK_THICKNESS:
        setRange("#inkThickness", value);
        break;
      case AEP.INK_OPACITY:
        setRange("#inkOpacity", value * 100, "%");
        break;
      case AEP.HIGHLIGHT_COLOR:
        $$("#highlightColors .swatch-btn").forEach(b =>
          b.classList.toggle("active", b.dataset.color.toLowerCase() === String(value).toLowerCase()),
        );
        break;
      case AEP.HIGHLIGHT_THICKNESS:
        setRange("#hlThickness", value);
        break;
    }
  }
}

function bindToolParams() {
  const range = (id, type, map = v => v, suffix = "") => {
    $(id).addEventListener("input", e => {
      const v = Number(e.target.value);
      e.target.nextElementSibling.textContent = `${v}${suffix}`;
      updateParam(type, map(v));
    });
  };
  $("#textColor").addEventListener("input", e => updateParam(AEP.FREETEXT_COLOR, e.target.value));
  range("#textSize", AEP.FREETEXT_SIZE);
  $("#inkColor").addEventListener("input", e => updateParam(AEP.INK_COLOR, e.target.value));
  range("#inkThickness", AEP.INK_THICKNESS);
  range("#inkOpacity", AEP.INK_OPACITY, v => v / 100, "%");
  range("#hlThickness", AEP.HIGHLIGHT_THICKNESS);
  $("#highlightColors").addEventListener("click", e => {
    const btn = e.target.closest(".swatch-btn");
    if (!btn) return;
    $$("#highlightColors .swatch-btn").forEach(b => b.classList.toggle("active", b === btn));
    updateParam(AEP.HIGHLIGHT_COLOR, btn.dataset.color);
  });
}

async function selectTool(name) {
  const mode = MODES[name];
  if (name === "stamp") {
    await setModeAndWait(AET.STAMP);
    // Open the image picker right away; the image lands in the middle of the page.
    updateParam(AEP.CREATE, undefined);
    return;
  }
  setEditorMode(state.mode === mode && mode !== AET.NONE ? AET.NONE : mode);
}

async function addSignature() {
  const file = await createSignature();
  if (!file) return;
  switchTab("annotate");
  await setModeAndWait(AET.STAMP);
  updateParam(AEP.CREATE, { bitmapFile: file });
  toast("Signature added — drag it into place, resize with the corners.", { type: "success" });
}

// ===========================================================================
// View controls
// ===========================================================================
function applyLayout(value) {
  if (!state.pdf) return;
  const map = {
    vertical: [ScrollMode.VERTICAL, SpreadMode.NONE],
    page: [ScrollMode.PAGE, SpreadMode.NONE],
    wrapped: [ScrollMode.WRAPPED, SpreadMode.NONE],
    horizontal: [ScrollMode.HORIZONTAL, SpreadMode.NONE],
    "spread-odd": [ScrollMode.VERTICAL, SpreadMode.ODD],
    "spread-even": [ScrollMode.VERTICAL, SpreadMode.EVEN],
  };
  const [scroll, spread] = map[value] || map.vertical;
  viewer.scrollMode = scroll;
  viewer.spreadMode = spread;
  store.set("layout", value);
}

function setReadingMode(mode) {
  container.classList.remove("reading-night", "reading-sepia");
  if (mode !== "normal") container.classList.add(`reading-${mode}`);
  $$("[data-reading]").forEach(b => b.classList.toggle("active", b.dataset.reading === mode));
  store.set("reading", mode);
}

function setCursor(cursor) {
  state.cursor = cursor;
  store.set("cursor", cursor);
  updateCursorUI();
}

function updateCursorUI() {
  const hand = state.cursor === "hand" && state.mode === AET.NONE;
  container.classList.toggle("hand", hand);
  $$("[data-cursor]").forEach(b => b.classList.toggle("active", b.dataset.cursor === state.cursor));
}

function bindHandTool() {
  let drag = null;
  container.addEventListener("pointerdown", e => {
    if (!container.classList.contains("hand") || e.button !== 0) return;
    if (e.target.closest("a, .annotationLayer section")) return;
    drag = { x: e.clientX, y: e.clientY, left: container.scrollLeft, top: container.scrollTop };
    container.classList.add("grabbing");
    container.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  container.addEventListener("pointermove", e => {
    if (!drag) return;
    container.scrollLeft = drag.left - (e.clientX - drag.x);
    container.scrollTop = drag.top - (e.clientY - drag.y);
  });
  const end = () => {
    drag = null;
    container.classList.remove("grabbing");
  };
  container.addEventListener("pointerup", end);
  container.addEventListener("pointercancel", end);
}

function zoomMenu(anchor) {
  const set = v => () => (viewer.currentScaleValue = v);
  showMenu(anchor, [
    { label: "Automatic", onClick: set("auto") },
    { label: "Fit width", icon: "fit-width", onClick: set("page-width") },
    { label: "Fit page", icon: "fit-page", onClick: set("page-fit") },
    { label: "Actual size", onClick: set("page-actual") },
    { separator: true },
    ...[50, 75, 100, 125, 150, 200, 300, 400].map(p => ({ label: `${p}%`, onClick: set(String(p / 100)) })),
  ]);
}

async function togglePresentation() {
  if (!state.pdf) return;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  state.beforePresent = {
    scroll: viewer.scrollMode,
    spread: viewer.spreadMode,
    scale: viewer.currentScaleValue,
    page: viewer.currentPageNumber,
  };
  setEditorMode(AET.NONE);
  try {
    await $("#stage").requestFullscreen();
  } catch (err) {
    state.beforePresent = null;
    errorToast("Couldn't enter presentation mode", err);
  }
}

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    viewer.scrollMode = ScrollMode.PAGE;
    viewer.spreadMode = SpreadMode.NONE;
    setTimeout(() => (viewer.currentScaleValue = "page-fit"), 60);
    toast("Presentation mode — arrow keys or click to move, Esc to exit.", { timeout: 2500 });
  } else if (state.beforePresent) {
    const b = state.beforePresent;
    state.beforePresent = null;
    viewer.scrollMode = b.scroll;
    viewer.spreadMode = b.spread;
    setTimeout(() => {
      viewer.currentScaleValue = b.scale;
      viewer.currentPageNumber = viewer.currentPageNumber || b.page;
    }, 60);
  }
});

container.addEventListener("click", e => {
  if (document.fullscreenElement && !e.target.closest("a")) viewer.nextPage();
});
container.addEventListener("contextmenu", e => {
  if (document.fullscreenElement) {
    e.preventDefault();
    viewer.previousPage();
  }
});

container.addEventListener(
  "wheel",
  e => {
    if (!(e.ctrlKey || e.metaKey) || !state.pdf) return;
    e.preventDefault();
    viewer.updateScale({
      scaleFactor: Math.exp(-e.deltaY * 0.0025),
      drawingDelay: 300,
      origin: [e.clientX, e.clientY],
    });
  },
  { passive: false },
);

// ===========================================================================
// Find
// ===========================================================================
function openFind() {
  if (!state.pdf) return;
  const bar = $("#findbar");
  bar.hidden = false;
  const input = $("#findInput");
  input.focus();
  input.select();
  if (input.value) dispatchFind("");
}

function closeFind() {
  const bar = $("#findbar");
  if (bar.hidden) return;
  bar.hidden = true;
  eventBus.dispatch("findbarclose", { source: window });
  container.focus({ preventScroll: true });
}

function dispatchFind(type, findPrevious = false) {
  eventBus.dispatch("find", {
    source: window,
    type,
    query: $("#findInput").value,
    caseSensitive: $("#findCase").checked,
    entireWord: $("#findWord").checked,
    highlightAll: true,
    findPrevious,
    matchDiacritics: false,
  });
}

function updateFindCount(matchesCount, findState) {
  const el = $("#findCount");
  const query = $("#findInput").value;
  el.classList.remove("not-found");
  if (!query) {
    el.textContent = "";
  } else if (findState === FindState.NOT_FOUND) {
    el.textContent = "No results";
    el.classList.add("not-found");
  } else if (matchesCount?.total) {
    el.textContent = `${matchesCount.current} of ${matchesCount.total}`;
  } else if (findState === FindState.PENDING) {
    el.textContent = "Searching…";
  }
}

function bindFind() {
  const input = $("#findInput");
  input.addEventListener("input", () => dispatchFind(""));
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      dispatchFind("again", e.shiftKey);
      e.preventDefault();
    } else if (e.key === "Escape") {
      closeFind();
      e.preventDefault();
      e.stopPropagation();
    }
  });
  $("#findCase").addEventListener("change", () => dispatchFind("casesensitivitychange"));
  $("#findWord").addEventListener("change", () => dispatchFind("entirewordchange"));
  $("#findbar").addEventListener("click", e => {
    const action = e.target.closest("[data-find]")?.dataset.find;
    if (action === "next") dispatchFind("again", false);
    else if (action === "prev") dispatchFind("again", true);
    else if (action === "close") closeFind();
  });
}

// ===========================================================================
// Sidebar: thumbnails + outline
// ===========================================================================
let thumbObserver = null;

function buildThumbnails() {
  const host = $("#thumbs");
  thumbObserver?.disconnect();
  host.innerHTML = "";
  const pdf = state.pdf;
  const key = state.docKey;
  thumbObserver = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbObserver.unobserve(entry.target);
        const el = entry.target;
        thumbnail(pdf, Number(el.dataset.page), 160, key)
          .then(({ url, width, height }) => {
            const box = el.querySelector(".thumb-img");
            box.classList.remove("skeleton");
            box.style.aspectRatio = `${width} / ${height}`;
            box.innerHTML = `<img src="${url}" alt="" draggable="false">`;
          })
          .catch(() => {});
      }
    },
    { root: $(".sidebar-body"), rootMargin: "400px 0px" },
  );

  const frag = document.createDocumentFragment();
  for (let i = 1; i <= pdf.numPages; i++) {
    const btn = document.createElement("button");
    btn.className = "thumb";
    btn.dataset.page = String(i);
    btn.title = `Page ${i}`;
    btn.innerHTML = `<div class="thumb-img skeleton" style="aspect-ratio: 1 / 1.414"></div><span class="thumb-num">${i}</span>`;
    frag.append(btn);
  }
  host.append(frag);
  host.querySelectorAll(".thumb").forEach(el => thumbObserver.observe(el));
  updatePageUI(viewer.currentPageNumber || 1);
}

function bindThumbs() {
  const host = $("#thumbs");
  host.addEventListener("click", e => {
    const thumb = e.target.closest(".thumb");
    if (thumb) viewer.currentPageNumber = Number(thumb.dataset.page);
  });
  host.addEventListener("contextmenu", e => {
    const thumb = e.target.closest(".thumb");
    if (!thumb) return;
    e.preventDefault();
    const n = Number(thumb.dataset.page);
    viewer.currentPageNumber = n;
    showMenu(
      { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) },
      [
        { heading: `Page ${n}` },
        { label: "Rotate right", icon: "rotate-cw", onClick: () => rotatePages([n - 1], 90) },
        { label: "Rotate left", icon: "rotate-ccw", onClick: () => rotatePages([n - 1], -90) },
        { label: "Insert blank page after", icon: "file-plus", onClick: () => insertBlank(n) },
        { label: "Extract this page…", icon: "extract", onClick: () => extractFlow(String(n)) },
        { separator: true },
        { label: "Delete page", icon: "trash", onClick: () => deletePages([n - 1]) },
      ],
    );
  });

  $(".sidebar-tabs").addEventListener("click", e => {
    const btn = e.target.closest("[data-side]");
    if (!btn) return;
    $$(".sidebar-tabs .side-tab").forEach(b => b.classList.toggle("active", b === btn));
    $("#thumbs").hidden = btn.dataset.side !== "thumbs";
    $("#outline").hidden = btn.dataset.side !== "outline";
  });

  // Resizable sidebar
  const resizer = $("#sidebarResizer");
  const saved = Number(store.get("sidebarW", 0));
  if (saved) app.style.setProperty("--sidebar-w", `${saved}px`);
  resizer.addEventListener("pointerdown", e => {
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add("dragging");
    const startX = e.clientX;
    const startW = $("#sidebar").offsetWidth;
    const move = ev => {
      const w = Math.min(420, Math.max(150, startW + ev.clientX - startX));
      app.style.setProperty("--sidebar-w", `${w}px`);
    };
    const up = () => {
      resizer.classList.remove("dragging");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", up);
      store.set("sidebarW", String($("#sidebar").offsetWidth));
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up);
  });
}

async function buildOutline() {
  const host = $("#outline");
  const pdf = state.pdf;
  const outline = await pdf.getOutline().catch(() => null);
  if (state.pdf !== pdf) return;
  host.innerHTML = "";
  if (!outline?.length) {
    host.innerHTML = `<div class="outline-empty">This document has no bookmarks.</div>`;
    return;
  }
  host.append(renderOutline(outline, 0));
}

function renderOutline(items, depth) {
  const ul = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "outline-item";
    const hasKids = item.items?.length > 0;
    let toggle;
    if (hasKids) {
      toggle = document.createElement("button");
      toggle.className = "outline-toggle";
      toggle.innerHTML = icon("chevron-down");
      row.append(toggle);
    } else {
      row.append(Object.assign(document.createElement("span"), { className: "outline-spacer" }));
    }
    const link = document.createElement("button");
    link.className = "outline-link";
    link.textContent = item.title || "(untitled)";
    if (item.bold) link.style.fontWeight = "600";
    if (item.italic) link.style.fontStyle = "italic";
    link.addEventListener("click", () => {
      if (item.dest) linkService.goToDestination(item.dest);
      else if (item.url) window.open(item.url, "_blank", "noopener");
    });
    row.append(link);
    li.append(row);
    if (hasKids) {
      const child = renderOutline(item.items, depth + 1);
      if (depth >= 1) {
        child.hidden = true;
        toggle.classList.add("collapsed");
      }
      toggle.addEventListener("click", () => {
        child.hidden = !child.hidden;
        toggle.classList.toggle("collapsed", child.hidden);
      });
      li.append(child);
    }
    ul.append(li);
  }
  return ul;
}

// ===========================================================================
// Page operations
// ===========================================================================
const current = () => viewer.currentPageNumber || 1;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function rotatePages(indices, delta) {
  return applyDocChange(bytes => ops.rotatePages(bytes, indices, delta), {
    message: indices.length > 1 ? `Rotated ${plural(indices.length, "page")}` : `Rotated page ${indices[0] + 1}`,
  });
}

function deletePages(indices) {
  return applyDocChange(bytes => ops.deletePages(bytes, indices), {
    message: indices.length > 1 ? `Deleted ${plural(indices.length, "page")}` : `Deleted page ${indices[0] + 1}`,
    page: Math.min(indices[0] + 1, (state.pdf?.numPages || 2) - indices.length),
  });
}

function insertBlank(afterPage) {
  return applyDocChange(bytes => ops.insertBlankPage(bytes, afterPage), {
    message: `Inserted a blank page after page ${afterPage}`,
    page: afterPage + 1,
  });
}

async function insertPdfFlow() {
  const [file] = await platform.pickFiles({ title: "Insert PDF", filters: PDF_FILTER });
  if (!file) return;
  const at = current();
  await applyDocChange(bytes => ops.insertPdf(bytes, file.data, at), {
    message: `Inserted ${file.name} after page ${at}`,
    page: at + 1,
  });
}

/** Shared "which pages?" field. */
function pagesField({ allowCurrent = true } = {}) {
  const total = state.pdf.numPages;
  return `
    <div class="field">
      <span class="field-label">Pages</span>
      <div class="choice-grid">
        <label class="choice"><input type="radio" name="pagesMode" value="all" checked><strong>All pages</strong><span>1–${total}</span></label>
        ${allowCurrent ? `<label class="choice"><input type="radio" name="pagesMode" value="current"><strong>Current page</strong><span>Page ${current()}</span></label>` : ""}
        <label class="choice"><input type="radio" name="pagesMode" value="range"><strong>Custom</strong><span>Choose below</span></label>
      </div>
      <input class="input" name="pagesRange" placeholder="e.g. 1-3, 5, 8-${total}" data-no-autofocus>
    </div>`;
}

function bindPagesField(body) {
  const range = body.querySelector("[name=pagesRange]");
  // Only switch to "Custom" on real interaction — dialogs auto-focus their first field.
  const pickRange = () => (body.querySelector("[name=pagesMode][value=range]").checked = true);
  range?.addEventListener("pointerdown", pickRange);
  range?.addEventListener("input", pickRange);
}

function readPages(values) {
  const total = state.pdf.numPages;
  if (values.pagesMode === "current") return [current()];
  if (values.pagesMode === "range") return [...new Set(parsePageRanges(values.pagesRange, total).flat())];
  return Array.from({ length: total }, (_, i) => i + 1);
}

function validatePages(values) {
  try {
    readPages(values);
    return null;
  } catch (err) {
    return err.message;
  }
}

async function extractFlow(preset = "") {
  const values = await openDialog({
    title: "Extract pages",
    subtitle: "Save the chosen pages as a new PDF. The original isn't changed.",
    content: `<label class="field"><span>Pages to extract</span>
      <input class="input" name="pages" value="${escapeHtml(preset || String(current()))}" placeholder="e.g. 1-3, 7">
      <small>Separate pages and ranges with commas. Order is kept as typed.</small></label>`,
    okLabel: "Extract…",
    validate: v => {
      try {
        parsePageRanges(v.pages, state.pdf.numPages);
        return null;
      } catch (err) {
        return err.message;
      }
    },
  });
  if (!values) return;
  const pages = parsePageRanges(values.pages, state.pdf.numPages).flat();
  const p = await progress("Extracting pages…");
  try {
    const data = await ops.extractPages(await currentBytes(), pages.map(n => n - 1));
    p.close();
    const label = values.pages.replace(/\s+/g, "").replace(/,/g, "_");
    const res = await platform.saveAs({ title: "Save extracted pages", defaultName: `${baseName(state.name)} (pages ${label}).pdf`, filters: PDF_FILTER, data });
    if (res) savedToast(res, `Saved ${plural(pages.length, "page")} to ${res.name}`);
  } catch (err) {
    errorToast("Couldn't extract pages", err);
  } finally {
    p.close();
  }
}

function savedToast(res, message) {
  toast(message, {
    type: "success",
    timeout: 6000,
    action: res?.path && isDesktop ? { label: "Show in folder", onClick: () => platform.showInFolder(res.path) } : null,
  });
}

async function splitFlow() {
  const total = state.pdf.numPages;
  const values = await openDialog({
    title: "Split PDF",
    subtitle: `Create several PDFs from "${state.name}" (${plural(total, "page")}).`,
    content: `
      <div class="choice-grid">
        <label class="choice"><input type="radio" name="mode" value="every" checked><strong>Every N pages</strong><span>Equal-sized parts</span></label>
        <label class="choice"><input type="radio" name="mode" value="each"><strong>Each page</strong><span>One file per page</span></label>
        <label class="choice"><input type="radio" name="mode" value="ranges"><strong>Custom ranges</strong><span>One file per range</span></label>
      </div>
      <label class="field" data-show="every"><span>Pages per file</span><input class="input" type="number" name="n" value="${Math.max(1, Math.ceil(total / 2))}" min="1" max="${total}"></label>
      <label class="field" data-show="ranges" hidden><span>Ranges</span><input class="input" name="ranges" placeholder="e.g. 1-3, 4-10, 11-"><small>Each range becomes its own PDF.</small></label>`,
    okLabel: "Split…",
    onMount(body) {
      const sync = () => {
        const mode = body.querySelector("[name=mode]:checked").value;
        body.querySelectorAll("[data-show]").forEach(el => (el.hidden = el.dataset.show !== mode));
      };
      body.querySelectorAll("[name=mode]").forEach(r => r.addEventListener("change", sync));
    },
    validate: v => {
      if (v.mode === "every" && !(Number(v.n) >= 1)) return "Enter how many pages each file should have.";
      if (v.mode === "ranges") {
        try {
          parsePageRanges(v.ranges, total);
        } catch (err) {
          return err.message;
        }
      }
      return null;
    },
  });
  if (!values) return;

  let groups;
  if (values.mode === "each") groups = Array.from({ length: total }, (_, i) => [i + 1]);
  else if (values.mode === "ranges") groups = parsePageRanges(values.ranges, total);
  else {
    const n = Number(values.n);
    groups = [];
    for (let i = 1; i <= total; i += n) groups.push(Array.from({ length: Math.min(n, total - i + 1) }, (_, k) => i + k));
  }

  const folder = await platform.pickFolder({ title: "Choose where to save the parts" });
  if (!folder) return;
  const p = await progress("Splitting…");
  try {
    const outputs = await ops.splitPdf(await currentBytes(), groups.map(g => g.map(n => n - 1)));
    const base = baseName(state.name);
    const files = outputs.map((data, i) => {
      const g = groups[i];
      const label = g.length === 1 ? `p${g[0]}` : `p${g[0]}-${g[g.length - 1]}`;
      return { name: `${base} (${label}).pdf`, data };
    });
    const written = await platform.writeToFolder(folder, files);
    p.close();
    savedToast({ path: isDesktop ? written[0] : null }, `Created ${plural(files.length, "PDF")}`);
  } catch (err) {
    errorToast("Couldn't split the PDF", err);
  } finally {
    p.close();
  }
}

async function watermarkFlow() {
  const values = await openDialog({
    title: "Add watermark",
    subtitle: "Stamps text across your pages. Any language works.",
    wide: true,
    content: `
      <div class="wm-preview"><span id="wmPreview">CONFIDENTIAL</span></div>
      <label class="field"><span>Text</span><input class="input" name="text" value="CONFIDENTIAL" maxlength="120"></label>
      <div class="field-row">
        <label class="field"><span>Color</span><input type="color" name="color" value="#e5484d" class="input" style="padding:2px;width:64px"></label>
        <label class="field"><span>Font size (pt)</span><input class="input" type="number" name="fontSize" value="64" min="8" max="300"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Opacity — <output data-out="opacity">25%</output></span><input type="range" name="opacity" min="5" max="100" value="25" style="width:100%"></label>
        <label class="field"><span>Direction</span>
          <select name="angle"><option value="45">Diagonal ↗</option><option value="-45">Diagonal ↘</option><option value="0">Horizontal</option><option value="90">Vertical</option></select></label>
      </div>
      <div class="choice-grid">
        <label class="choice"><input type="radio" name="layout" value="center" checked><strong>Once, centered</strong><span>Classic stamp</span></label>
        <label class="choice"><input type="radio" name="layout" value="tile"><strong>Tiled</strong><span>Repeated over the page</span></label>
      </div>
      ${pagesField()}`,
    okLabel: "Add watermark",
    onMount(body) {
      bindPagesField(body);
      const prev = body.querySelector("#wmPreview");
      const update = () => {
        const f = body.querySelector("form") || body.closest("form");
        const get = n => f.elements[n].value;
        prev.textContent = get("text") || " ";
        prev.style.color = get("color");
        prev.style.opacity = Number(get("opacity")) / 100;
        prev.style.fontSize = `${Math.max(8, Number(get("fontSize")) * 0.28)}px`;
        prev.style.transform = `rotate(${-Number(get("angle"))}deg)`;
        body.querySelector("[data-out=opacity]").textContent = `${get("opacity")}%`;
      };
      body.addEventListener("input", update);
      body.addEventListener("change", update);
      update();
    },
    validate: v => (!v.text.trim() ? "Enter the watermark text." : validatePages(v)),
  });
  if (!values) return;
  const pages = readPages(values).map(n => n - 1);
  await applyDocChange(
    bytes =>
      ops.addWatermark(bytes, {
        text: values.text.trim(),
        color: values.color,
        opacity: Number(values.opacity) / 100,
        fontSize: Math.min(300, Math.max(8, Number(values.fontSize) || 64)),
        angle: Number(values.angle),
        layout: values.layout,
        pages,
      }),
    { message: `Watermark added to ${plural(pages.length, "page")}`, busy: "Adding watermark…" },
  );
}

async function pageNumbersFlow() {
  const values = await openDialog({
    title: "Add page numbers",
    content: `
      <div class="field-row">
        <label class="field"><span>Format</span>
          <select name="format"><option value="n">1</option><option value="page-n">Page 1</option><option value="n-of-total">1 / ${state.pdf.numPages}</option><option value="page-n-of-total">Page 1 of ${state.pdf.numPages}</option></select></label>
        <label class="field"><span>Position</span>
          <select name="position">
            <option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option>
            <option value="top-center">Top center</option><option value="top-right">Top right</option><option value="top-left">Top left</option>
          </select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Font size (pt)</span><input class="input" type="number" name="fontSize" value="10" min="6" max="48"></label>
        <label class="field"><span>Start numbering at</span><input class="input" type="number" name="startAt" value="1" min="0"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Distance from edge (pt)</span><input class="input" type="number" name="margin" value="24" min="4" max="144"></label>
        <label class="field"><span>Color</span><input type="color" name="color" value="#333333" class="input" style="padding:2px;width:64px"></label>
      </div>
      <label class="check"><input type="checkbox" name="skipFirst"> Skip the first page (cover)</label>`,
    okLabel: "Add numbers",
  });
  if (!values) return;
  await applyDocChange(
    bytes =>
      ops.addPageNumbers(bytes, {
        format: values.format,
        position: values.position,
        fontSize: Number(values.fontSize) || 10,
        startAt: Number.isFinite(Number(values.startAt)) ? Number(values.startAt) : 1,
        margin: Number(values.margin) || 24,
        color: values.color,
        skipFirst: values.skipFirst,
      }),
    { message: "Page numbers added", busy: "Adding page numbers…" },
  );
}

// ===========================================================================
// Conversions
// ===========================================================================
async function toImagesFlow() {
  const values = await openDialog({
    title: "PDF → Images",
    subtitle: "Export pages as image files, including your annotations.",
    content: `
      <div class="field"><span class="field-label">Format</span><div class="choice-grid">
        <label class="choice"><input type="radio" name="format" value="png" checked><strong>PNG</strong><span>Crisp text, larger files</span></label>
        <label class="choice"><input type="radio" name="format" value="jpg"><strong>JPG</strong><span>Smaller, best for photos</span></label>
      </div></div>
      <div class="field"><span class="field-label">Resolution</span><div class="choice-grid">
        <label class="choice"><input type="radio" name="dpi" value="96"><strong>Screen</strong><span>96 DPI</span></label>
        <label class="choice"><input type="radio" name="dpi" value="150" checked><strong>Standard</strong><span>150 DPI</span></label>
        <label class="choice"><input type="radio" name="dpi" value="300"><strong>Print</strong><span>300 DPI</span></label>
      </div></div>
      ${pagesField()}`,
    okLabel: "Export…",
    onMount: bindPagesField,
    validate: validatePages,
  });
  if (!values) return;
  const pages = readPages(values);
  const ext = values.format;
  const base = baseName(state.name);
  const fileName = n => `${base} - page ${String(n).padStart(String(state.pdf.numPages).length, "0")}.${ext}`;
  const filters = [{ name: ext.toUpperCase(), extensions: [ext === "jpg" ? "jpg" : "png"] }];

  if (pages.length === 1) {
    const p = await progress("Rendering page…");
    try {
      const data = await pageToImage(state.pdf, pages[0], { format: ext, dpi: Number(values.dpi) });
      p.close();
      const res = await platform.saveAs({ title: "Save image", defaultName: fileName(pages[0]), filters, data });
      if (res) savedToast(res, `Saved ${res.name}`);
    } catch (err) {
      errorToast("Couldn't export the image", err);
    } finally {
      p.close();
    }
    return;
  }

  const folder = await platform.pickFolder({ title: "Choose a folder for the images" });
  if (!folder) return;
  const p = await progress("Exporting images…", { cancellable: true });
  try {
    let first = null;
    for (let i = 0; i < pages.length; i++) {
      if (p.cancelled) break;
      p.update(i, pages.length, `Page ${pages[i]} (${i + 1} of ${pages.length})`);
      const data = await pageToImage(state.pdf, pages[i], { format: ext, dpi: Number(values.dpi) });
      const [written] = await platform.writeToFolder(folder, [{ name: fileName(pages[i]), data }]);
      first ??= written;
    }
    p.close();
    if (p.cancelled) toast("Export cancelled.");
    else savedToast({ path: isDesktop ? first : null }, `Exported ${plural(pages.length, "image")}`);
  } catch (err) {
    errorToast("Couldn't export images", err);
  } finally {
    p.close();
  }
}

const openAfterField = () => `
  <label class="check"><input type="checkbox" name="openAfter" ${store.get("openAfter", "1") === "1" ? "checked" : ""}>
  ${isDesktop ? "Open the file when it's ready" : "Download the file when it's ready"}</label>`;

/**
 * Shared conversion runner: asks where to save first, then converts with a
 * cancellable progress bar, writes the file and opens it if asked.
 */
async function convertAndSave({ label, defaultName, filters, openAfter, run }) {
  store.set("openAfter", openAfter ? "1" : "0");
  const target = await platform.pickSavePath({ title: `Save ${label}`, defaultName, filters });
  if (!target) return;
  const p = await progress(`Converting to ${label}…`, { cancellable: true });
  const started = performance.now();
  try {
    const data = await run({
      onProgress: (i, n, text) => p.update(i, n, text ? `${text}${n ? ` · ${Math.min(i + 1, n)} of ${n}` : ""}` : undefined),
      isCancelled: () => p.cancelled,
    });
    p.update(1, 1, "Saving…");
    await platform.writeOutput(target, data);
    p.close();
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const open = () =>
      platform.openPath(target.path).catch(err => errorToast(`Saved, but Windows couldn't open ${target.name}`, err));
    if (openAfter && target.path) {
      open();
      toast(`Opened ${target.name} (converted in ${seconds}s)`, {
        type: "success",
        timeout: 6000,
        action: { label: "Show in folder", onClick: () => platform.showInFolder(target.path) },
      });
    } else {
      toast(`Saved ${target.name} (converted in ${seconds}s)`, {
        type: "success",
        timeout: 8000,
        action: target.path ? { label: "Open", onClick: open } : null,
      });
    }
  } catch (err) {
    if (err instanceof CancelledError) toast("Conversion cancelled.");
    else errorToast(`Couldn't convert to ${label}`, err);
  } finally {
    p.close();
  }
}

async function toWordFlow() {
  const values = await openDialog({
    title: "Convert to Word",
    subtitle: "Creates a .docx file for Microsoft Word or LibreOffice.",
    wide: true,
    content: `
      <div class="field"><span class="field-label">Layout</span>
      <div class="choice-grid choice-grid-3">
        <label class="choice"><input type="radio" name="mode" value="exact" ${store.get("wordMode", "exact") === "exact" ? "checked" : ""}>
          <strong>Exact & editable</strong><span>Looks like the PDF. Every line is real text you can edit; pictures and lines stay in place.</span></label>
        <label class="choice"><input type="radio" name="mode" value="flow" ${store.get("wordMode", "exact") === "flow" ? "checked" : ""}>
          <strong>Flowing document</strong><span>Paragraphs, headings and tables that reflow as you type. Best for rewriting.</span></label>
        <label class="choice"><input type="radio" name="mode" value="images" ${store.get("wordMode", "exact") === "images" ? "checked" : ""}>
          <strong>Page pictures</strong><span>Pixel-perfect copy of each page. Not editable.</span></label>
      </div></div>
      ${pagesField({ allowCurrent: false })}
      ${openAfterField()}`,
    okLabel: "Convert…",
    onMount: bindPagesField,
    validate: validatePages,
  });
  if (!values) return;
  store.set("wordMode", values.mode);
  const pages = readPages(values);
  await convertAndSave({
    label: "Word",
    defaultName: `${baseName(state.name)}.docx`,
    filters: [{ name: "Word document", extensions: ["docx"] }],
    openAfter: values.openAfter,
    run: opts => pdfToDocx(state.pdf, pages, { ...opts, mode: values.mode, title: baseName(state.name) }),
  });
}

async function toExcelFlow() {
  const values = await openDialog({
    title: "Convert to Excel",
    subtitle: "Finds the rows and columns of tables and puts them into cells.",
    wide: true,
    content: `
      <div class="field"><span class="field-label">Worksheets</span>
      <div class="choice-grid">
        <label class="choice"><input type="radio" name="sheets" value="per-page" ${store.get("excelSheets", "per-page") === "per-page" ? "checked" : ""}>
          <strong>One sheet per page</strong><span>Page 1, Page 2, …</span></label>
        <label class="choice"><input type="radio" name="sheets" value="one" ${store.get("excelSheets", "per-page") === "one" ? "checked" : ""}>
          <strong>Everything on one sheet</strong><span>Best for a table that runs over several pages</span></label>
      </div></div>
      <label class="check"><input type="checkbox" name="numbers" ${store.get("excelNumbers", "1") === "1" ? "checked" : ""}>
        Turn numbers into real numbers (1 234,56 · 1,234.56 · 15% · (120))</label>
      ${pagesField({ allowCurrent: true })}
      ${openAfterField()}`,
    okLabel: "Convert…",
    onMount: bindPagesField,
    validate: validatePages,
  });
  if (!values) return;
  store.set("excelSheets", values.sheets);
  store.set("excelNumbers", values.numbers ? "1" : "0");
  const pages = readPages(values);
  await convertAndSave({
    label: "Excel",
    defaultName: `${baseName(state.name)}.xlsx`,
    filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    openAfter: values.openAfter,
    run: opts =>
      pdfToXlsx(state.pdf, pages, { ...opts, oneSheet: values.sheets === "one", numbers: values.numbers, title: baseName(state.name) }),
  });
}

async function toTextFlow() {
  const p = await progress("Extracting text…");
  try {
    const pages = Array.from({ length: state.pdf.numPages }, (_, i) => i + 1);
    const text = await extractText(state.pdf, pages, (i, n) => p.update(i, n));
    p.close();
    if (!text.trim()) {
      toast("No selectable text found — this PDF is probably a scan.", { type: "error", timeout: 6000 });
      return;
    }
    const data = new TextEncoder().encode(text);
    const res = await platform.saveAs({
      title: "Save text",
      defaultName: `${baseName(state.name)}.txt`,
      filters: [{ name: "Text file", extensions: ["txt"] }],
      data,
    });
    if (res) {
      toast(`Saved ${res.name}`, {
        type: "success",
        timeout: 6000,
        action: { label: "Copy text", onClick: () => navigator.clipboard.writeText(text).then(() => toast("Copied to clipboard")) },
      });
    }
  } catch (err) {
    errorToast("Couldn't extract text", err);
  } finally {
    p.close();
  }
}

/** Reorderable file list used by Merge and Images → PDF. */
function fileListDialog({ title, subtitle, files, addLabel, filters, okLabel, extra = "", thumbs = false, min = 1 }) {
  const list = [...files];
  const urls = new Map();
  const thumbUrl = file => {
    if (!urls.has(file)) urls.set(file, URL.createObjectURL(new Blob([file.data])));
    return urls.get(file);
  };
  return openDialog({
    title,
    subtitle,
    wide: true,
    content: `
      <ul class="file-list" data-list></ul>
      <div><button type="button" class="btn btn-small" data-add>${icon("plus")}${escapeHtml(addLabel)}</button></div>
      ${extra}`,
    okLabel,
    onMount(body) {
      const ul = body.querySelector("[data-list]");
      const render = () => {
        ul.innerHTML = list.length
          ? list
              .map(
                (f, i) => `
            <li>
              <span class="file-idx">${i + 1}</span>
              ${thumbs ? `<img class="file-thumb" src="${thumbUrl(f)}" alt="">` : icon("file-text")}
              <span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
              <span class="file-meta">${formatBytes(f.data.byteLength)}</span>
              <button type="button" class="icon-btn small" data-up="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>${icon("arrow-up")}</button>
              <button type="button" class="icon-btn small" data-down="${i}" title="Move down" ${i === list.length - 1 ? "disabled" : ""}>${icon("arrow-down")}</button>
              <button type="button" class="icon-btn small danger" data-remove="${i}" title="Remove">${icon("x")}</button>
            </li>`,
              )
              .join("")
          : `<li class="file-list-empty">No files yet — add some below.</li>`;
      };
      ul.addEventListener("click", e => {
        const btn = e.target.closest("button");
        if (!btn) return;
        if (btn.dataset.up) {
          const i = Number(btn.dataset.up);
          [list[i - 1], list[i]] = [list[i], list[i - 1]];
        } else if (btn.dataset.down) {
          const i = Number(btn.dataset.down);
          [list[i + 1], list[i]] = [list[i], list[i + 1]];
        } else if (btn.dataset.remove) {
          list.splice(Number(btn.dataset.remove), 1);
        }
        render();
      });
      body.querySelector("[data-add]").addEventListener("click", async () => {
        const added = await platform.pickFiles({ title: addLabel, filters, multiple: true });
        list.push(...added);
        render();
      });
      render();
    },
    collect: (_body, values) => ({ ...values, files: list }),
    validate: v => (v.files.length < min ? `Add at least ${plural(min, "file")}.` : null),
  }).finally(() => urls.forEach(url => URL.revokeObjectURL(url)));
}

async function mergeFlow(preset = []) {
  const files = [...preset];
  if (state.pdf && !preset.length) {
    files.push({ name: `${state.name} (current)`, data: await currentBytes(), current: true });
  }
  if (!files.length || (files.length === 1 && files[0].current)) {
    const picked = await platform.pickFiles({ title: "Choose PDFs to merge", filters: PDF_FILTER, multiple: true });
    if (!picked.length) return;
    files.push(...picked);
  }
  const values = await fileListDialog({
    title: "Merge PDFs",
    subtitle: "Files are combined top to bottom. Use the arrows to change the order.",
    files,
    addLabel: "Add PDFs",
    filters: PDF_FILTER,
    okLabel: "Merge",
    min: 2,
  });
  if (!values) return;
  const p = await progress("Merging PDFs…");
  try {
    const data = await ops.mergePdfs(values.files, (i, n, name) => p.update(i, n, name));
    p.close();
    await openGenerated(data, `${baseName(values.files[0].name.replace(/ \(current\)$/, ""))} (merged).pdf`);
  } catch (err) {
    errorToast("Couldn't merge", err);
  } finally {
    p.close();
  }
}

async function imagesToPdfFlow(preset = []) {
  let files = preset;
  if (!files.length) {
    files = await platform.pickFiles({ title: "Choose images", filters: IMAGE_FILTER, multiple: true });
    if (!files.length) return;
  }
  const values = await fileListDialog({
    title: "Images → PDF",
    subtitle: "Each image becomes one page, in this order.",
    files,
    addLabel: "Add images",
    filters: IMAGE_FILTER,
    okLabel: "Create PDF",
    thumbs: true,
    extra: `
      <div class="field-row">
        <label class="field"><span>Page size</span>
          <select name="pageSize"><option value="A4">A4</option><option value="Letter">Letter</option><option value="Legal">Legal</option><option value="fit">Same as image</option></select></label>
        <label class="field"><span>Orientation</span>
          <select name="orientation"><option value="auto">Automatic</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      </div>
      <label class="field"><span>Margin</span>
        <select name="margin"><option value="0">None</option><option value="18" selected>Small</option><option value="36">Medium</option><option value="72">Large</option></select></label>`,
  });
  if (!values) return;
  const p = await progress("Creating PDF…");
  try {
    const data = await ops.imagesToPdf(values.files, values, (i, n, name) => p.update(i, n, name));
    p.close();
    const first = values.files[0].name.replace(/\.[^.]+$/, "");
    await openGenerated(data, `${values.files.length === 1 ? first : "Images"}.pdf`);
  } catch (err) {
    errorToast("Couldn't create the PDF", err);
  } finally {
    p.close();
  }
}

// ===========================================================================
// Print
// ===========================================================================
async function printDocument() {
  const pdf = state.pdf;
  if (!pdf) return;
  const host = $("#printContainer");
  const urls = [];
  const p = await progress("Preparing to print…", { cancellable: true });
  try {
    host.innerHTML = "";
    const first = await pdf.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const style = document.createElement("style");
    style.textContent = `@page { size: ${vp.width}pt ${vp.height}pt; margin: 0; }`;
    host.append(style);
    for (let i = 1; i <= pdf.numPages; i++) {
      if (p.cancelled) return;
      p.update(i - 1, pdf.numPages, `Page ${i} of ${pdf.numPages}`);
      const canvas = await renderPage(pdf, i, 150 / 72);
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      canvas.width = canvas.height = 0;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = new Image();
      img.src = url;
      await img.decode();
      const page = document.createElement("div");
      page.className = "print-page";
      page.append(img);
      host.append(page);
    }
    p.close();
    window.print();
  } catch (err) {
    errorToast("Couldn't print", err);
  } finally {
    p.close();
    setTimeout(() => {
      host.innerHTML = "";
      urls.forEach(u => URL.revokeObjectURL(u));
    }, 1000);
  }
}

// ===========================================================================
// Properties, about, shortcuts
// ===========================================================================
function pageSizeLabel(w, h) {
  const named = { A3: [842, 1191], A4: [595, 842], A5: [420, 595], Letter: [612, 792], Legal: [612, 1008] };
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  const name = Object.entries(named).find(([, [x, y]]) => Math.abs(a - x) < 3 && Math.abs(b - y) < 3)?.[0];
  const mm = v => Math.round((v / 72) * 25.4);
  return `${mm(w)} × ${mm(h)} mm (${name ? `${name}, ` : ""}${w > h ? "landscape" : "portrait"})`;
}

function formatPdfDate(value) {
  const date = value ? pdfjsLib.PDFDateString.toDateObject(value) : null;
  return date ? date.toLocaleString() : "—";
}

async function propertiesFlow() {
  const pdf = state.pdf;
  const { info } = await pdf.getMetadata().catch(() => ({ info: {} }));
  const page = await pdf.getPage(current());
  const vp = page.getViewport({ scale: 1 });
  const row = (k, v) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "—")}</dd>`;
  const original = {
    title: info.Title || "",
    author: info.Author || "",
    subject: info.Subject || "",
    keywords: info.Keywords || "",
  };
  const values = await openDialog({
    title: "Document properties",
    wide: true,
    content: `
      <dl class="props-grid">
        ${row("File", state.name)}
        ${state.path ? row("Location", state.path) : ""}
        ${row("Size", formatBytes(state.bytes.byteLength))}
        ${row("Pages", String(pdf.numPages))}
        ${row("Page size", `${pageSizeLabel(vp.width, vp.height)} — page ${current()}`)}
        ${row("PDF version", info.PDFFormatVersion)}
        ${row("Created by", info.Creator)}
        ${row("Producer", info.Producer)}
        ${row("Created", formatPdfDate(info.CreationDate))}
        ${row("Modified", formatPdfDate(info.ModDate))}
        ${row("Protected", info.IsEncrypted ? "Yes (encrypted)" : "No")}
      </dl>
      <p class="props-section">Description</p>
      <label class="field"><span>Title</span><input class="input" name="title" value="${escapeHtml(original.title)}"></label>
      <div class="field-row">
        <label class="field"><span>Author</span><input class="input" name="author" value="${escapeHtml(original.author)}"></label>
        <label class="field"><span>Subject</span><input class="input" name="subject" value="${escapeHtml(original.subject)}"></label>
      </div>
      <label class="field"><span>Keywords</span><input class="input" name="keywords" value="${escapeHtml(original.keywords)}" placeholder="Comma separated"></label>`,
    okLabel: "Save details",
    cancelLabel: "Close",
  });
  if (!values) return;
  const changed = Object.keys(original).some(k => (values[k] || "") !== original[k]);
  if (!changed) return;
  await applyDocChange(bytes => ops.writeMetadata(bytes, values), { message: "Document details updated" });
}

async function aboutFlow() {
  const info = await platform.appInfo();
  await openDialog({
    title: "About PDF Tool",
    content: `
      <div style="display:flex;gap:14px;align-items:center">
        <svg class="mark mark-lg"><use href="#i-mark"/></svg>
        <div><strong style="font-size:15px;font-weight:600">PDF Tool</strong><br>
        <span style="color:var(--text-3);font:400 12px var(--mono)">v${escapeHtml(info.version)}${info.electron ? ` · Electron ${escapeHtml(info.electron)}` : ""}</span></div>
      </div>
      <p class="modal-text">Built on open-source software: PDF.js by Mozilla (Apache-2.0) for rendering and annotations,
      pdf-lib (MIT) for page editing, docx (MIT) for Word export, Electron (MIT), and the IBM Plex typeface (OFL).</p>`,
    okLabel: "Close",
    cancelLabel: "",
  });
}

async function shortcutsFlow() {
  const rows = [
    ["Open", "Ctrl+O"],
    ["Save / Save as", "Ctrl+S / Ctrl+Shift+S"],
    ["Print", "Ctrl+P"],
    ["Find", "Ctrl+F"],
    ["Zoom in / out / reset", "Ctrl + / Ctrl − / Ctrl+0"],
    ["Zoom with mouse", "Ctrl + wheel"],
    ["Organize pages", "Ctrl+Shift+O"],
    ["Presentation mode", "F5"],
    ["Stop annotating", "Esc"],
    ["Undo / redo annotation", "Ctrl+Z / Ctrl+Y"],
    ["New window", "Ctrl+N"],
    ["Close document", "Ctrl+W"],
  ];
  await openDialog({
    title: "Keyboard shortcuts",
    content: `<dl class="props-grid">${rows.map(([a, k]) => `<dt>${escapeHtml(a)}</dt><dd><kbd>${escapeHtml(k)}</kbd></dd>`).join("")}</dl>`,
    okLabel: "Close",
    cancelLabel: "",
  });
}

// ===========================================================================
// Recent files, theme, main menu
// ===========================================================================
function formatWhen(time) {
  if (!time) return "";
  const date = new Date(time);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString() === date.toDateString();
  const hm = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${hm}`;
  if (yesterday) return `Yesterday ${hm}`;
  return date.toLocaleDateString([], { day: "numeric", month: "short", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

async function renderRecent() {
  const list = await platform.recent.get();
  $("#recentEmpty").hidden = list.length > 0;
  $("#clearRecent").hidden = list.length === 0;
  $("#recentList").innerHTML = list
    .map(
      item => `
      <li>
        <button class="recent-open" data-path="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">
          ${icon("file-text")}
          <div class="recent-meta"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.path.replace(/[\\/][^\\/]*$/, ""))}</span></div>
          <span class="recent-time">${escapeHtml(formatWhen(item.time))}</span>
        </button>
        <button class="icon-btn small" data-remove="${escapeHtml(item.path)}" title="Remove from list">${icon("x")}</button>
      </li>`,
    )
    .join("");
}

function bindRecent() {
  $("#recentList").addEventListener("click", async e => {
    const open = e.target.closest("[data-path]");
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      await platform.recent.remove(remove.dataset.remove);
      renderRecent();
    } else if (open) {
      openPath(open.dataset.path);
    }
  });
  $("#clearRecent").addEventListener("click", async () => {
    await platform.recent.clear();
    renderRecent();
  });
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function applyTheme(pref = store.get("theme", "system")) {
  const dark = pref === "dark" || (pref === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#themeBtn use").setAttribute("href", `#i-${pref === "system" ? "monitor" : dark ? "moon" : "sun"}`);
  $("#themeBtn").title = `Theme: ${pref[0].toUpperCase()}${pref.slice(1)}`;
  platform.setTitleBarTheme(dark);
}
darkQuery.addEventListener("change", () => applyTheme());

function themeMenu(anchor) {
  const set = pref => () => {
    store.set("theme", pref);
    applyTheme(pref);
  };
  showMenu(
    anchor,
    [
      { label: "Light", icon: "sun", onClick: set("light") },
      { label: "Dark", icon: "moon", onClick: set("dark") },
      { label: "Match Windows", icon: "monitor", onClick: set("system") },
    ],
    { align: "right" },
  );
}

async function mainMenu(anchor) {
  const recent = (await platform.recent.get()).slice(0, 6);
  const has = !!state.pdf;
  showMenu(anchor, [
    { label: "New window", icon: "window", shortcut: "Ctrl+N", onClick: () => platform.newWindow() },
    { label: "Open…", icon: "open", shortcut: "Ctrl+O", onClick: openViaDialog },
    ...(recent.length
      ? [{ heading: "Recent" }, ...recent.map(r => ({ label: r.name, title: r.path, icon: "clock", onClick: () => openPath(r.path) }))]
      : []),
    { separator: true },
    { label: "Save", icon: "save", shortcut: "Ctrl+S", disabled: !has, onClick: () => save() },
    { label: "Save as…", icon: "save-as", shortcut: "Ctrl+Shift+S", disabled: !has, onClick: () => save({ saveAs: true }) },
    { label: "Print…", icon: "print", shortcut: "Ctrl+P", disabled: !has, onClick: printDocument },
    { label: "Show in folder", icon: "folder", disabled: !has || !state.path || !isDesktop, onClick: () => platform.showInFolder(state.path) },
    { label: "Document properties", icon: "info", disabled: !has, onClick: propertiesFlow },
    { label: "Close document", icon: "x", shortcut: "Ctrl+W", disabled: !has, onClick: closeDocument },
    { separator: true },
    { label: "Keyboard shortcuts", icon: "keyboard", onClick: shortcutsFlow },
    { label: "About PDF Tool", icon: "info", onClick: aboutFlow },
  ]);
}

// ===========================================================================
// Commands
// ===========================================================================
const commands = {
  open: openViaDialog,
  save: () => save(),
  print: printDocument,
  find: openFind,
  sidebar: () => {
    app.classList.toggle("no-sidebar");
    store.set("sidebar", app.classList.contains("no-sidebar") ? "hidden" : "shown");
  },
  "rotate-view-cw": () => (viewer.pagesRotation = (viewer.pagesRotation + 90) % 360),
  "rotate-view-ccw": () => (viewer.pagesRotation = (viewer.pagesRotation + 270) % 360),
  present: togglePresentation,
  properties: propertiesFlow,
  prev: () => viewer.previousPage(),
  next: () => viewer.nextPage(),
  "zoom-in": () => viewer.increaseScale(),
  "zoom-out": () => viewer.decreaseScale(),
  "fit-width": () => (viewer.currentScaleValue = "page-width"),
  "fit-page": () => (viewer.currentScaleValue = "page-fit"),
  signature: addSignature,
  undo: () => state.uiManager?.undo(),
  redo: () => state.uiManager?.redo(),
  "delete-annot": () => state.uiManager?.delete(),
  organize: () => organizer.open(current()),
  "rotate-page-cw": () => rotatePages([current() - 1], 90),
  "rotate-page-ccw": () => rotatePages([current() - 1], -90),
  "rotate-all": () => rotatePages(Array.from({ length: state.pdf.numPages }, (_, i) => i), 90),
  "delete-page": () => deletePages([current() - 1]),
  "insert-blank": () => insertBlank(current()),
  "insert-pdf": insertPdfFlow,
  extract: () => extractFlow(),
  split: splitFlow,
  watermark: watermarkFlow,
  "page-numbers": pageNumbersFlow,
  "to-images": toImagesFlow,
  "to-word": toWordFlow,
  "to-excel": toExcelFlow,
  "to-text": toTextFlow,
  "images-to-pdf": () => imagesToPdfFlow(),
  merge: () => mergeFlow(),
  "new-window": () => platform.newWindow(),
};

function runCommand(name) {
  const fn = commands[name];
  if (!fn) return;
  Promise.resolve()
    .then(fn)
    .catch(err => errorToast("Something went wrong", err));
}

// ===========================================================================
// Organizer
// ===========================================================================
const organizer = new Organizer($("#organizer"), {
  getDoc: () => state.pdf,
  getDocKey: () => state.docKey,
  pickPdf: async () => (await platform.pickFiles({ title: "Insert PDF", filters: PDF_FILTER }))[0] || null,
  loadPdfJs: data => pdfjsLib.getDocument({ ...DOC_PARAMS, data: data.slice() }).promise,
  onApply: (plan, externals) =>
    applyDocChange(bytes => ops.applyPagePlan(bytes, plan, externals), {
      message: "Page changes applied",
      busy: "Rebuilding document…",
      page: 1,
    }),
  onExtract: async (plan, externals) => {
    const p = await progress("Extracting pages…");
    try {
      const data = await ops.buildFromPlan(await currentBytes(), plan, externals);
      p.close();
      const res = await platform.saveAs({
        title: "Save extracted pages",
        defaultName: `${baseName(state.name)} (extract).pdf`,
        filters: PDF_FILTER,
        data,
      });
      if (res) savedToast(res, `Saved ${plural(plan.length, "page")} to ${res.name}`);
    } catch (err) {
      errorToast("Couldn't extract pages", err);
    } finally {
      p.close();
    }
  },
});

// ===========================================================================
// Event bindings
// ===========================================================================
function bindUi() {
  document.addEventListener("click", e => {
    const cmd = e.target.closest("[data-cmd]");
    if (cmd && !cmd.disabled) {
      runCommand(cmd.dataset.cmd);
      return;
    }
    const tool = e.target.closest("[data-mode]");
    if (tool && !tool.disabled) {
      selectTool(tool.dataset.mode);
      return;
    }
    const cursor = e.target.closest("[data-cursor]");
    if (cursor) {
      setCursor(cursor.dataset.cursor);
      if (state.mode !== AET.NONE) setEditorMode(AET.NONE);
      return;
    }
    const reading = e.target.closest("[data-reading]");
    if (reading) setReadingMode(reading.dataset.reading);
    const tab = e.target.closest(".tab");
    if (tab) switchTab(tab.dataset.tab);
  });

  $("#menuBtn").addEventListener("click", e => mainMenu(e.currentTarget));
  $("#themeBtn").addEventListener("click", e => themeMenu(e.currentTarget));
  $("#zoomBtn").addEventListener("click", e => zoomMenu(e.currentTarget));
  $("#layoutSelect").addEventListener("change", e => applyLayout(e.target.value));

  const pageInput = $("#pageInput");
  pageInput.addEventListener("change", () => {
    const n = parseInt(pageInput.value, 10);
    if (Number.isFinite(n)) viewer.currentPageNumber = Math.min(Math.max(1, n), viewer.pagesCount);
    else pageInput.value = String(viewer.currentPageNumber);
  });
  pageInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      pageInput.dispatchEvent(new Event("change"));
      container.focus({ preventScroll: true });
    }
  });
  pageInput.addEventListener("focus", () => pageInput.select());

  bindToolParams();
  bindFind();
  bindThumbs();
  bindRecent();
  bindHandTool();
  bindDragDrop();
  bindKeyboard();
}

function bindKeyboard() {
  window.addEventListener("keydown", e => {
    if (document.querySelector("dialog[open]") || organizer.isOpen) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const inField = e.target.closest?.("input, textarea, select, [contenteditable='true'], .freeTextEditor");

    if (mod) {
      const map = {
        o: () => (e.shiftKey ? state.pdf && commands.organize() : openViaDialog()),
        s: () => state.pdf && save({ saveAs: e.shiftKey }),
        p: () => state.pdf && printDocument(),
        f: () => openFind(),
        n: () => platform.newWindow(),
        w: () => closeDocument(),
        "=": () => state.pdf && viewer.increaseScale(),
        "+": () => state.pdf && viewer.increaseScale(),
        "-": () => state.pdf && viewer.decreaseScale(),
        0: () => state.pdf && (viewer.currentScaleValue = "auto"),
      };
      if (map[key]) {
        e.preventDefault();
        map[key]();
      }
      return;
    }

    if (e.key === "F5") {
      e.preventDefault();
      togglePresentation();
    } else if (e.key === "Escape") {
      if (!$("#findbar").hidden) closeFind();
      else if (state.mode !== AET.NONE && !state.editState.hasSelectedEditor && !inField) setEditorMode(AET.NONE);
    } else if (document.fullscreenElement && state.pdf) {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        viewer.nextPage();
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        viewer.previousPage();
      } else if (e.key === "Home") viewer.currentPageNumber = 1;
      else if (e.key === "End") viewer.currentPageNumber = viewer.pagesCount;
    } else if (!inField && state.pdf && state.mode === AET.NONE) {
      if (e.key === "Home" && e.target === container) {
        viewer.currentPageNumber = 1;
        e.preventDefault();
      } else if (e.key === "End" && e.target === container) {
        viewer.currentPageNumber = viewer.pagesCount;
        e.preventDefault();
      }
    }
  });
}

function bindDragDrop() {
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", e => {
    if (!hasFiles(e)) return;
    depth++;
    document.body.classList.add("dragover");
  });
  window.addEventListener("dragleave", e => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove("dragover");
  });
  window.addEventListener("dragover", e => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragover");
    const files = [...e.dataTransfer.files];
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    const images = files.filter(f => f.type.startsWith("image/"));
    const read = async f => ({ name: f.name, path: platform.pathForDroppedFile(f), data: new Uint8Array(await f.arrayBuffer()) });

    if (pdfs.length === 1 && !images.length) {
      if (!(await confirmDiscard())) return;
      const file = await read(pdfs[0]);
      await openDocument(file);
    } else if (pdfs.length > 1) {
      mergeFlow(await Promise.all(pdfs.map(read)));
    } else if (images.length) {
      imagesToPdfFlow(await Promise.all(images.map(read)));
    } else {
      toast("Drop a PDF to open it, or images to turn them into a PDF.");
    }
  });
}

// ===========================================================================
// Start-up
// ===========================================================================
async function init() {
  app.classList.add("no-doc");
  if (store.get("sidebar", "shown") === "hidden") app.classList.add("no-sidebar");
  $("#layoutSelect").value = store.get("layout", "vertical");
  setReadingMode(store.get("reading", "normal"));
  setCursor(store.get("cursor", "select"));
  switchTab(store.get("tab", "view"));
  applyTheme();
  setDocButtonsEnabled(false);
  updateModeUI();
  bindUi();
  renderRecent();

  platform.onOpenFile(filePath => openPath(filePath));
  platform.onCommand(async command => {
    if (command === "save-and-close") {
      if (await save()) platform.forceClose();
    }
  });

  const launchFile = await platform.getLaunchFile();
  if (launchFile) await openPath(launchFile, { skipConfirm: true });

  // Web preview convenience: ?file=sample.pdf opens a PDF served next to the app.
  const sample = new URLSearchParams(location.search).get("file");
  if (!isDesktop && sample) {
    const res = await fetch(sample);
    if (res.ok) await openDocument({ data: new Uint8Array(await res.arrayBuffer()), name: sample.split("/").pop() });
  }
}

window.addEventListener("beforeunload", e => {
  // Browser preview only — the desktop app asks through a native dialog.
  if (!isDesktop && state.pdf && isDirty()) e.preventDefault();
});

init();

// Exposed for debugging in DevTools.
window.pdfToolApp = {
  state,
  viewer,
  eventBus,
  open: filePath => openPath(filePath, { skipConfirm: true }),
  openData: (data, name) => openDocument({ data, name }),
  theme: pref => {
    store.set("theme", pref);
    applyTheme(pref);
  },
  convert: {
    docx: (opts = {}) => pdfToDocx(state.pdf, opts.pages || Array.from({ length: state.pdf.numPages }, (_, i) => i + 1), opts),
    xlsx: (opts = {}) => pdfToXlsx(state.pdf, opts.pages || Array.from({ length: state.pdf.numPages }, (_, i) => i + 1), opts),
  },
};
