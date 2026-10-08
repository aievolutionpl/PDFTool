// Small UI toolkit: icons, modal dialogs, toasts, progress overlay, menus.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Modal dialog
// ---------------------------------------------------------------------------

/**
 * Opens a modal dialog. `content` is an HTML string; form fields inside it
 * (with `name` attributes) are collected and returned when the user confirms.
 * Resolves to the values object, or null when cancelled.
 */
export function openDialog({
  title,
  subtitle = "",
  content = "",
  okLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
  wide = false,
  hideOk = false,
  onMount = null,
  collect = null,
  validate = null,
}) {
  return new Promise(resolve => {
    const dlg = document.createElement("dialog");
    dlg.className = `modal${wide ? " modal-wide" : ""}`;
    dlg.innerHTML = `
      <form class="modal-form" novalidate>
        <header class="modal-header">
          <div>
            <h2 class="modal-title">${escapeHtml(title)}</h2>
            ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ""}
          </div>
          <button type="button" class="icon-btn" data-cancel aria-label="Close">${icon("x")}</button>
        </header>
        <div class="modal-body">${content}</div>
        <p class="modal-error" hidden></p>
        <footer class="modal-footer">
          ${cancelLabel ? `<button type="button" class="btn" data-cancel>${escapeHtml(cancelLabel)}</button>` : ""}
          ${hideOk ? "" : `<button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${escapeHtml(okLabel)}</button>`}
        </footer>
      </form>`;
    document.body.append(dlg);

    const form = dlg.querySelector("form");
    const body = dlg.querySelector(".modal-body");
    const errorEl = dlg.querySelector(".modal-error");
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };

    const readValues = () => {
      const values = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === "checkbox") values[el.name] = el.checked;
        else if (el.type === "radio") {
          if (el.checked) values[el.name] = el.value;
        } else values[el.name] = el.value;
      }
      return collect ? collect(body, values) : values;
    };

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const values = readValues();
      const error = validate ? await validate(values, body) : null;
      if (error) {
        errorEl.textContent = error;
        errorEl.hidden = false;
        return;
      }
      finish(values);
    });
    dlg.addEventListener("cancel", event => {
      event.preventDefault();
      finish(null);
    });
    dlg.querySelectorAll("[data-cancel]").forEach(btn => btn.addEventListener("click", () => finish(null)));

    dlg.showModal();
    onMount?.(body, { close: finish, form });
    const first =
      body.querySelector("[autofocus]") ||
      body.querySelector(
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([data-no-autofocus]), textarea",
      );
    if (first) {
      first.focus();
      if (first.select && first.type === "text") first.select();
    } else {
      form.querySelector("button[type=submit]")?.focus();
    }
  });
}

/** Multi-button question. buttons: [{ label, value, kind: "primary"|"danger"|"" }]. Esc → null. */
export function choose({ title, message, buttons }) {
  return new Promise(resolve => {
    const dlg = document.createElement("dialog");
    dlg.className = "modal";
    dlg.innerHTML = `
      <div class="modal-form">
        <header class="modal-header"><div><h2 class="modal-title">${escapeHtml(title)}</h2></div></header>
        <div class="modal-body"><p class="modal-text">${escapeHtml(message)}</p></div>
        <footer class="modal-footer">${buttons
          .map((b, i) => `<button type="button" class="btn ${b.kind ? `btn-${b.kind}` : ""}" data-i="${i}">${escapeHtml(b.label)}</button>`)
          .join("")}</footer>
      </div>`;
    document.body.append(dlg);
    const done = value => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.addEventListener("cancel", event => {
      event.preventDefault();
      done(null);
    });
    dlg.querySelectorAll("[data-i]").forEach(btn =>
      btn.addEventListener("click", () => done(buttons[Number(btn.dataset.i)].value)),
    );
    dlg.showModal();
    dlg.querySelector(".btn-primary")?.focus();
  });
}

export async function confirmDialog({ title, message, okLabel = "Continue", cancelLabel = "Cancel", danger = false }) {
  const result = await openDialog({
    title,
    content: `<p class="modal-text">${escapeHtml(message)}</p>`,
    okLabel,
    cancelLabel,
    danger,
  });
  return result !== null;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
let toastHost = null;

export function toast(message, { type = "info", timeout = 4000, action = null } = {}) {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.append(toastHost);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  const iconName = { success: "check", error: "alert", info: "info" }[type] || "info";
  el.innerHTML = `${icon(iconName)}<span class="toast-msg">${escapeHtml(message)}</span>`;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      dismiss();
    });
    el.append(btn);
  }
  const close = document.createElement("button");
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss");
  close.innerHTML = icon("x");
  close.addEventListener("click", () => dismiss());
  el.append(close);
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add("show"));

  let timer = timeout ? setTimeout(() => dismiss(), timeout) : null;
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }
  return dismiss;
}

export function errorToast(prefix, err) {
  console.error(prefix, err);
  const detail = err?.message ? `: ${err.message}` : "";
  toast(`${prefix}${detail}`, { type: "error", timeout: 7000 });
}

// ---------------------------------------------------------------------------
// Progress overlay
// ---------------------------------------------------------------------------
export function progress(label, { cancellable = false } = {}) {
  const el = document.createElement("div");
  el.className = "progress-overlay";
  el.innerHTML = `
    <div class="progress-card" role="progressbar" aria-valuemin="0" aria-valuemax="100">
      <div class="spinner"></div>
      <div class="progress-label">${escapeHtml(label)}</div>
      <div class="progress-track"><div class="progress-bar"></div></div>
      <div class="progress-detail"></div>
      ${cancellable ? `<button class="btn btn-small" data-cancel>Cancel</button>` : ""}
    </div>`;
  document.body.append(el);
  const bar = el.querySelector(".progress-bar");
  const detail = el.querySelector(".progress-detail");
  const card = el.querySelector(".progress-card");
  const handle = {
    cancelled: false,
    update(done, total, text) {
      const pct = total ? Math.round((done / total) * 100) : 0;
      bar.style.width = `${pct}%`;
      card.setAttribute("aria-valuenow", String(pct));
      detail.textContent = text ?? (total ? `${done} of ${total}` : "");
    },
    close() {
      el.remove();
    },
  };
  el.querySelector("[data-cancel]")?.addEventListener("click", () => {
    handle.cancelled = true;
    detail.textContent = "Cancelling…";
  });
  // Let the overlay paint before heavy work starts.
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(() => resolve(handle), 0)));
}

// ---------------------------------------------------------------------------
// Popup menu
// ---------------------------------------------------------------------------
let openMenuEl = null;

export function closeMenus() {
  openMenuEl?.remove();
  openMenuEl = null;
}

/**
 * items: [{ label, icon, shortcut, onClick, disabled, separator, submenu: items }]
 */
export function showMenu(anchor, items, { align = "left" } = {}) {
  closeMenus();
  const menu = buildMenu(items);
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  openMenuEl = menu;
  menu.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
}

function buildMenu(items) {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    if (item.separator) {
      menu.append(Object.assign(document.createElement("div"), { className: "menu-sep" }));
      continue;
    }
    if (item.heading) {
      const h = document.createElement("div");
      h.className = "menu-heading";
      h.textContent = item.heading;
      menu.append(h);
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.setAttribute("role", "menuitem");
    btn.disabled = !!item.disabled;
    btn.innerHTML = `${item.icon ? icon(item.icon) : `<span class="icon"></span>`}
      <span class="menu-label">${escapeHtml(item.label)}</span>
      ${item.hint ? `<span class="menu-hint">${escapeHtml(item.hint)}</span>` : ""}
      ${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ""}`;
    btn.title = item.title || "";
    btn.addEventListener("click", event => {
      event.stopPropagation();
      closeMenus();
      item.onClick?.();
    });
    menu.append(btn);
  }
  menu.addEventListener("keydown", event => {
    const buttons = [...menu.querySelectorAll("button:not([disabled])")];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      buttons[(index + 1) % buttons.length]?.focus();
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
      event.preventDefault();
    } else if (event.key === "Escape") {
      closeMenus();
    }
  });
  return menu;
}

document.addEventListener("pointerdown", event => {
  if (openMenuEl && !openMenuEl.contains(event.target)) closeMenus();
});
window.addEventListener("blur", closeMenus);
window.addEventListener("resize", closeMenus);

// ---------------------------------------------------------------------------
// Page range parsing ("1-3, 5, 8-")
// ---------------------------------------------------------------------------
export function parsePageRanges(text, pageCount) {
  const result = [];
  const parts = String(text).split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new Error("Enter at least one page or range.");
  for (const part of parts) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let from;
    let to;
    if (m) {
      from = m[1] ? parseInt(m[1], 10) : 1;
      to = m[2] ? parseInt(m[2], 10) : pageCount;
    } else if (/^\d+$/.test(part)) {
      from = to = parseInt(part, 10);
    } else {
      throw new Error(`"${part}" is not a valid page or range.`);
    }
    if (from < 1 || to > pageCount || from > to) {
      throw new Error(`"${part}" is outside 1–${pageCount}.`);
    }
    const range = [];
    for (let p = from; p <= to; p++) range.push(p);
    result.push(range);
  }
  return result; // array of ranges, each an array of 1-based page numbers
}
