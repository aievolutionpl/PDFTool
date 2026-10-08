// Page organizer: a grid of page thumbnails to reorder (drag & drop), rotate,
// delete, insert blank pages / other PDFs and extract selections.
import { $, icon, escapeHtml, toast, errorToast } from "./ui.js";
import { thumbnail } from "./convert.js";

let uid = 0;

export class Organizer {
  /**
   * host: { getDoc, getDocKey, pickPdf, loadPdfJs, onApply(plan, externals), onExtract(plan, externals) }
   */
  constructor(root, host) {
    this.root = root;
    this.host = host;
    this.grid = $(".organizer-grid", root);
    this.countEl = $("[data-org-count]", root);
    this.items = [];
    this.selected = new Set();
    this.anchor = null;
    this.externals = new Map(); // docKey -> { bytes, pdf }
    this.thumbWidth = 150;
    this.dragIds = null;
    this.bind();
  }

  get isOpen() {
    return !this.root.hidden;
  }

  async open(selectPage = null) {
    const doc = this.host.getDoc();
    if (!doc) return;
    this.items = [];
    this.selected.clear();
    this.externals.clear();
    for (let i = 0; i < doc.numPages; i++) {
      this.items.push({ id: ++uid, type: "page", index: i, rotation: 0, label: `${i + 1}` });
    }
    if (selectPage) this.selected.add(this.items[selectPage - 1]?.id);
    this.root.hidden = false;
    document.body.classList.add("organizing");
    this.render();
    $("[data-org='apply']", this.root).focus();
  }

  close() {
    this.root.hidden = true;
    document.body.classList.remove("organizing");
    this.grid.innerHTML = "";
    for (const ext of this.externals.values()) ext.pdf?.loadingTask.destroy();
    this.externals.clear();
  }

  isModified() {
    return (
      this.items.length !== this.host.getDoc()?.numPages ||
      this.items.some((item, i) => item.type !== "page" || item.index !== i || item.rotation % 360 !== 0)
    );
  }

  plan() {
    return this.items.map(item => ({
      type: item.type,
      index: item.index,
      docKey: item.docKey,
      width: item.width,
      height: item.height,
      rotation: ((item.rotation % 360) + 360) % 360,
    }));
  }

  externalBytes() {
    return new Map([...this.externals].map(([key, ext]) => [key, ext.bytes]));
  }

  // -------------------------------------------------------------------------
  bind() {
    this.root.addEventListener("click", event => {
      const btn = event.target.closest("[data-org]");
      if (!btn) return;
      const action = btn.dataset.org;
      const handlers = {
        "select-all": () => this.selectAll(),
        "rotate-left": () => this.rotateSelected(-90),
        "rotate-right": () => this.rotateSelected(90),
        delete: () => this.deleteSelected(),
        blank: () => this.insertBlank(),
        "insert-pdf": () => this.insertPdf(),
        extract: () => this.extract(),
        reverse: () => this.reverse(),
        cancel: () => this.close(),
        apply: () => this.apply(),
      };
      handlers[action]?.();
    });

    $("[data-org-size]", this.root).addEventListener("input", event => {
      this.thumbWidth = Number(event.target.value);
      this.grid.style.setProperty("--thumb-w", `${this.thumbWidth}px`);
    });

    this.grid.addEventListener("click", event => {
      const card = event.target.closest(".org-card");
      if (!card) {
        if (event.target === this.grid) {
          this.selected.clear();
          this.updateSelection();
        }
        return;
      }
      const id = Number(card.dataset.id);
      const action = event.target.closest("[data-card]")?.dataset.card;
      if (action === "rotate") {
        this.rotate([id], 90);
        return;
      }
      if (action === "delete") {
        this.remove([id]);
        return;
      }
      this.handleSelect(id, event);
    });

    this.grid.addEventListener("dblclick", event => {
      const card = event.target.closest(".org-card");
      if (card) this.rotate([Number(card.dataset.id)], 90);
    });

    // Drag & drop reordering
    this.grid.addEventListener("dragstart", event => {
      const card = event.target.closest(".org-card");
      if (!card) return;
      const id = Number(card.dataset.id);
      if (!this.selected.has(id)) {
        this.selected.clear();
        this.selected.add(id);
        this.updateSelection();
      }
      this.dragIds = new Set(this.selected);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "pages");
      requestAnimationFrame(() => {
        this.grid.querySelectorAll(".org-card").forEach(c => {
          if (this.dragIds?.has(Number(c.dataset.id))) c.classList.add("dragging");
        });
      });
    });
    this.grid.addEventListener("dragover", event => {
      if (!this.dragIds) return;
      event.preventDefault();
      const target = this.dropTarget(event);
      this.grid.querySelectorAll(".drop-before, .drop-after").forEach(c => c.classList.remove("drop-before", "drop-after"));
      if (target) target.card.classList.add(target.after ? "drop-after" : "drop-before");
    });
    this.grid.addEventListener("drop", event => {
      if (!this.dragIds) return;
      event.preventDefault();
      const target = this.dropTarget(event);
      if (target) this.move(this.dragIds, Number(target.card.dataset.id), target.after);
      this.endDrag();
    });
    this.grid.addEventListener("dragend", () => this.endDrag());

    this.root.addEventListener("keydown", event => {
      if (event.target.matches("input")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        this.deleteSelected();
        event.preventDefault();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        this.selectAll();
        event.preventDefault();
      } else if (event.key === "Escape") {
        this.close();
      }
    });
  }

  dropTarget(event) {
    const card = event.target.closest(".org-card");
    if (card) {
      const rect = card.getBoundingClientRect();
      return { card, after: event.clientX > rect.left + rect.width / 2 };
    }
    // Dropped in empty space: after the last card.
    const cards = this.grid.querySelectorAll(".org-card");
    const last = cards[cards.length - 1];
    return last ? { card: last, after: true } : null;
  }

  endDrag() {
    this.dragIds = null;
    this.grid.querySelectorAll(".dragging, .drop-before, .drop-after").forEach(c => c.classList.remove("dragging", "drop-before", "drop-after"));
  }

  handleSelect(id, event) {
    if (event.shiftKey && this.anchor != null) {
      const a = this.items.findIndex(i => i.id === this.anchor);
      const b = this.items.findIndex(i => i.id === id);
      const [from, to] = a < b ? [a, b] : [b, a];
      if (!(event.ctrlKey || event.metaKey)) this.selected.clear();
      for (let i = from; i <= to; i++) this.selected.add(this.items[i].id);
    } else if (event.ctrlKey || event.metaKey) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      this.anchor = id;
    } else {
      this.selected.clear();
      this.selected.add(id);
      this.anchor = id;
    }
    this.updateSelection();
  }

  selectAll() {
    if (this.selected.size === this.items.length) this.selected.clear();
    else this.items.forEach(i => this.selected.add(i.id));
    this.updateSelection();
  }

  targets() {
    return this.selected.size ? [...this.selected] : [];
  }

  rotateSelected(delta) {
    const ids = this.targets();
    if (!ids.length) return toast("Select one or more pages first.");
    this.rotate(ids, delta);
  }

  rotate(ids, delta) {
    for (const item of this.items) {
      if (ids.includes(item.id)) item.rotation += delta;
    }
    for (const id of ids) {
      const card = this.grid.querySelector(`[data-id="${id}"]`);
      const item = this.items.find(i => i.id === id);
      if (card && item) this.applyRotation(card, item);
    }
    this.updateCount();
  }

  deleteSelected() {
    const ids = this.targets();
    if (!ids.length) return toast("Select one or more pages first.");
    this.remove(ids);
  }

  remove(ids) {
    if (ids.length >= this.items.length) {
      toast("A PDF needs at least one page.", { type: "error" });
      return;
    }
    this.items = this.items.filter(i => !ids.includes(i.id));
    ids.forEach(id => this.selected.delete(id));
    this.render();
  }

  reverse() {
    this.items.reverse();
    this.render();
  }

  move(ids, targetId, after) {
    if (ids.has(targetId)) return;
    const moving = this.items.filter(i => ids.has(i.id));
    const rest = this.items.filter(i => !ids.has(i.id));
    let index = rest.findIndex(i => i.id === targetId);
    if (after) index += 1;
    rest.splice(index, 0, ...moving);
    this.items = rest;
    this.render();
  }

  insertionIndex() {
    if (!this.selected.size) return this.items.length;
    let last = -1;
    this.items.forEach((item, i) => {
      if (this.selected.has(item.id)) last = i;
    });
    return last + 1;
  }

  async insertBlank() {
    const at = this.insertionIndex();
    const ref = this.items[Math.max(0, at - 1)];
    let width = 595.28;
    let height = 841.89;
    if (ref?.type === "page") {
      const page = await this.host.getDoc().getPage(ref.index + 1);
      const vp = page.getViewport({ scale: 1, rotation: 0 });
      width = vp.width;
      height = vp.height;
    } else if (ref?.width) {
      width = ref.width;
      height = ref.height;
    }
    const item = { id: ++uid, type: "blank", width, height, rotation: 0, label: "Blank" };
    this.items.splice(at, 0, item);
    this.selected.clear();
    this.selected.add(item.id);
    this.render();
  }

  async insertPdf() {
    const file = await this.host.pickPdf();
    if (!file) return;
    try {
      const docKey = `ext${++uid}`;
      const pdf = await this.host.loadPdfJs(file.data);
      this.externals.set(docKey, { bytes: file.data, pdf, name: file.name });
      const at = this.insertionIndex();
      const added = [];
      for (let i = 0; i < pdf.numPages; i++) {
        added.push({ id: ++uid, type: "external", docKey, index: i, rotation: 0, label: `${file.name} · ${i + 1}` });
      }
      this.items.splice(at, 0, ...added);
      this.selected = new Set(added.map(i => i.id));
      this.render();
      toast(`Inserted ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"} from ${file.name}`, { type: "success" });
    } catch (err) {
      errorToast("Couldn't open that PDF", err);
    }
  }

  extract() {
    const ids = this.targets();
    if (!ids.length) return toast("Select the pages you want to extract.");
    const subset = this.items.filter(i => this.selected.has(i.id));
    const plan = subset.map(item => ({
      type: item.type,
      index: item.index,
      docKey: item.docKey,
      width: item.width,
      height: item.height,
      rotation: ((item.rotation % 360) + 360) % 360,
    }));
    this.host.onExtract(plan, this.externalBytes());
  }

  async apply() {
    if (!this.isModified()) {
      this.close();
      return;
    }
    const ok = await this.host.onApply(this.plan(), this.externalBytes());
    if (ok) this.close();
  }

  // -------------------------------------------------------------------------
  render() {
    this.grid.style.setProperty("--thumb-w", `${this.thumbWidth}px`);
    this.grid.innerHTML = this.items
      .map(
        (item, i) => `
        <div class="org-card${this.selected.has(item.id) ? " selected" : ""}" data-id="${item.id}" draggable="true" tabindex="0">
          <div class="org-thumb" data-kind="${item.type}">
            ${item.type === "blank" ? `<div class="org-blank"></div>` : `<div class="org-img skeleton"></div>`}
            <div class="org-card-actions">
              <button type="button" class="icon-btn small" data-card="rotate" title="Rotate">${icon("rotate-cw")}</button>
              <button type="button" class="icon-btn small danger" data-card="delete" title="Delete page">${icon("trash")}</button>
            </div>
            <span class="org-check">${icon("check")}</span>
          </div>
          <div class="org-label"><b>${i + 1}</b>${item.type === "page" ? "" : `<span title="${escapeHtml(item.label)}">${escapeHtml(item.type === "blank" ? "Blank page" : item.label)}</span>`}</div>
        </div>`,
      )
      .join("");

    for (const card of this.grid.querySelectorAll(".org-card")) {
      const item = this.items.find(i => i.id === Number(card.dataset.id));
      this.applyRotation(card, item);
      if (item.type === "blank") {
        card.querySelector(".org-blank").style.aspectRatio = `${item.width} / ${item.height}`;
        continue;
      }
      const pdf = item.type === "page" ? this.host.getDoc() : this.externals.get(item.docKey)?.pdf;
      const key = item.type === "page" ? this.host.getDocKey() : item.docKey;
      thumbnail(pdf, item.index + 1, 220, key)
        .then(({ url, width, height }) => {
          const holder = card.querySelector(".org-img");
          if (!holder) return;
          const img = new Image();
          img.src = url;
          img.alt = `Page ${item.index + 1}`;
          img.draggable = false;
          holder.replaceWith(img);
          img.style.aspectRatio = `${width} / ${height}`;
          this.applyRotation(card, item);
        })
        .catch(() => {});
    }
    this.updateCount();
  }

  applyRotation(card, item) {
    const visual = card.querySelector("img, .org-blank, .org-img");
    if (!visual) return;
    const r = ((item.rotation % 360) + 360) % 360;
    visual.style.transform = r ? `rotate(${item.rotation}deg)${r % 180 ? " scale(0.72)" : ""}` : "";
    card.classList.toggle("rotated", r !== 0);
  }

  updateSelection() {
    for (const card of this.grid.querySelectorAll(".org-card")) {
      card.classList.toggle("selected", this.selected.has(Number(card.dataset.id)));
    }
    this.updateCount();
  }

  updateCount() {
    const n = this.items.length;
    const s = this.selected.size;
    this.countEl.textContent = `${n} page${n === 1 ? "" : "s"}${s ? ` · ${s} selected` : ""}${this.isModified() ? " · unsaved changes" : ""}`;
    $("[data-org='apply']", this.root).disabled = !this.isModified();
  }
}
