// Signature pad: draw, type or upload a signature and get back a trimmed PNG File.
import { openDialog, escapeHtml } from "./ui.js";
import { t } from "./i18n.js";

const STORE_KEY = "pdftool.signature";
const FONTS = ["Segoe Script", "Ink Free", "Lucida Handwriting", "Segoe Print", "Brush Script MT", "cursive"];
const COLORS = { Black: "#111111", Blue: "#1d3fbb", Red: "#b42318" };

function loadSaved() {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function saveSignature(dataUrl) {
  try {
    localStorage.setItem(STORE_KEY, dataUrl);
  } catch {
    // Storage unavailable — the signature just won't be remembered.
  }
}

/** Crops transparent margins. Returns a new canvas or null when empty. */
function trimCanvas(source) {
  const ctx = source.getContext("2d");
  const { width, height } = source;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const pad = 6;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext("2d").drawImage(source, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function canvasToFile(canvas) {
  return new Promise(resolve =>
    canvas.toBlob(blob => resolve(new File([blob], "signature.png", { type: "image/png" })), "image/png"),
  );
}

async function dataUrlToFile(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], "signature.png", { type: "image/png" });
}

export async function createSignature() {
  const saved = loadSaved();
  let drawCanvas;
  let imageCanvas = null;
  let activeTab = "draw";
  let hasInk = false;

  const content = `
    ${saved ? `
      <div class="sig-saved">
        <img src="${saved}" alt="Saved signature">
        <div><strong>Saved signature</strong><span>Use the one you created last time</span></div>
        <button type="button" class="btn btn-primary btn-small" data-use-saved>Use it</button>
      </div>` : ""}
    <div class="segmented sig-tabs" role="tablist">
      <button type="button" class="seg active" data-tab="draw">Draw</button>
      <button type="button" class="seg" data-tab="type">Type</button>
      <button type="button" class="seg" data-tab="upload">Upload image</button>
    </div>
    <div class="sig-panel" data-panel="draw">
      <div class="sig-canvas-wrap"><canvas class="sig-canvas" width="1120" height="360"></canvas>
        <span class="sig-hint">Sign here with your mouse, pen or finger</span></div>
    </div>
    <div class="sig-panel" data-panel="type" hidden>
      <input type="text" class="input sig-type-input" placeholder="Type your name" maxlength="60">
      <div class="sig-fonts">${FONTS.map((f, i) => `
        <label class="sig-font"><input type="radio" name="sigFont" value="${escapeHtml(f)}" ${i === 0 ? "checked" : ""}>
        <span style="font-family:'${escapeHtml(f)}', cursive">Your Name</span></label>`).join("")}
      </div>
    </div>
    <div class="sig-panel" data-panel="upload" hidden>
      <label class="drop-mini">
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden class="sig-file">
        <span>Choose a photo or scan of your signature</span>
      </label>
      <label class="check"><input type="checkbox" class="sig-remove-bg" checked> Remove white background</label>
      <div class="sig-preview" hidden><canvas></canvas></div>
    </div>
    <div class="sig-options">
      <div class="field-inline"><span>Ink</span>
        ${Object.entries(COLORS).map(([name, c], i) => `
          <label class="swatch" title="${name}"><input type="radio" name="sigColor" value="${c}" ${i === 0 ? "checked" : ""}><span style="background:${c}"></span></label>`).join("")}
      </div>
      <button type="button" class="btn btn-small" data-clear>Clear</button>
      <label class="check"><input type="checkbox" name="remember" checked> Remember this signature</label>
    </div>`;

  let useSaved = false;

  const result = await openDialog({
    title: "Add signature",
    subtitle: "It's placed on the current page — drag to move it, use the corners to resize.",
    content,
    okLabel: "Place signature",
    wide: true,
    onMount(body, { close }) {
      drawCanvas = body.querySelector(".sig-canvas");
      const ctx = drawCanvas.getContext("2d");
      const hint = body.querySelector(".sig-hint");
      const color = () => body.querySelector("input[name=sigColor]:checked").value;

      body.querySelector("[data-use-saved]")?.addEventListener("click", () => {
        useSaved = true;
        close({ saved: true });
      });

      // Tabs
      body.querySelectorAll("[data-tab]").forEach(btn =>
        btn.addEventListener("click", () => {
          activeTab = btn.dataset.tab;
          body.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b === btn));
          body.querySelectorAll("[data-panel]").forEach(p => (p.hidden = p.dataset.panel !== activeTab));
          if (activeTab === "type") body.querySelector(".sig-type-input").focus();
        }),
      );

      // Drawing with smoothed strokes
      let points = [];
      let drawing = false;
      const pos = e => {
        const r = drawCanvas.getBoundingClientRect();
        return {
          x: ((e.clientX - r.left) / r.width) * drawCanvas.width,
          y: ((e.clientY - r.top) / r.height) * drawCanvas.height,
          p: e.pressure || 0.5,
        };
      };
      drawCanvas.addEventListener("pointerdown", e => {
        drawing = true;
        drawCanvas.setPointerCapture(e.pointerId);
        points = [pos(e)];
        hint.hidden = true;
        hasInk = true;
      });
      drawCanvas.addEventListener("pointermove", e => {
        if (!drawing) return;
        points.push(pos(e));
        if (points.length < 3) return;
        const [a, b, c] = points.slice(-3);
        ctx.strokeStyle = color();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3.2 + (e.pointerType === "pen" ? b.p * 4 : 1.6);
        ctx.beginPath();
        ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
        ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
        ctx.stroke();
      });
      const end = () => {
        if (drawing && points.length < 3 && points.length) {
          const p = points[0];
          ctx.fillStyle = color();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        drawing = false;
      };
      drawCanvas.addEventListener("pointerup", end);
      drawCanvas.addEventListener("pointercancel", end);

      body.querySelector("[data-clear]").addEventListener("click", () => {
        ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        hint.hidden = false;
        hasInk = false;
        body.querySelector(".sig-type-input").value = "";
        imageCanvas = null;
        body.querySelector(".sig-preview").hidden = true;
      });

      // Typed preview
      const typeInput = body.querySelector(".sig-type-input");
      typeInput.addEventListener("input", () => {
        body.querySelectorAll(".sig-font span").forEach(span => (span.textContent = typeInput.value || t("Your Name")));
      });

      // Upload
      const fileInput = body.querySelector(".sig-file");
      const removeBg = body.querySelector(".sig-remove-bg");
      const preview = body.querySelector(".sig-preview");
      let uploaded = null;
      const renderUpload = () => {
        if (!uploaded) return;
        const maxW = 1200;
        const scale = Math.min(1, maxW / uploaded.width);
        const c = preview.querySelector("canvas");
        c.width = Math.round(uploaded.width * scale);
        c.height = Math.round(uploaded.height * scale);
        const cx = c.getContext("2d");
        cx.clearRect(0, 0, c.width, c.height);
        cx.drawImage(uploaded, 0, 0, c.width, c.height);
        if (removeBg.checked) {
          const img = cx.getImageData(0, 0, c.width, c.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (lum > 200) d[i + 3] = 0;
            else if (lum > 150) d[i + 3] = Math.round(((200 - lum) / 50) * d[i + 3]);
          }
          cx.putImageData(img, 0, 0);
        }
        imageCanvas = c;
        preview.hidden = false;
      };
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        uploaded = await createImageBitmap(file);
        renderUpload();
      });
      removeBg.addEventListener("change", renderUpload);
    },
    collect(body, values) {
      return { ...values, tab: activeTab, typed: body.querySelector(".sig-type-input").value.trim() };
    },
    validate(values) {
      if (values.tab === "draw" && !hasInk) return "Draw your signature first.";
      if (values.tab === "type" && !values.typed) return "Type your name first.";
      if (values.tab === "upload" && !imageCanvas) return "Choose an image first.";
      return null;
    },
  });

  if (!result) return null;
  if (useSaved || result.saved) return dataUrlToFile(saved);

  let source;
  if (result.tab === "draw") {
    source = drawCanvas;
  } else if (result.tab === "type") {
    source = document.createElement("canvas");
    source.width = 1400;
    source.height = 320;
    const ctx = source.getContext("2d");
    ctx.fillStyle = result.sigColor;
    ctx.textBaseline = "middle";
    let size = 150;
    ctx.font = `${size}px '${result.sigFont}', cursive`;
    while (ctx.measureText(result.typed).width > source.width - 60 && size > 40) {
      size -= 6;
      ctx.font = `${size}px '${result.sigFont}', cursive`;
    }
    ctx.fillText(result.typed, 30, source.height / 2);
  } else {
    source = imageCanvas;
  }

  const trimmed = trimCanvas(source);
  if (!trimmed) return null;
  if (result.remember) saveSignature(trimmed.toDataURL("image/png"));
  return canvasToFile(trimmed);
}
