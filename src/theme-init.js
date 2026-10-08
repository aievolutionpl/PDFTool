// Applies the saved theme before first paint to avoid a light/dark flash.
try {
  const t = localStorage.getItem("pdftool.theme") || "system";
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
