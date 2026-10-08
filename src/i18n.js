// Interface language. English is the default and the source text; other
// languages map English strings to translations (see src/locales/).
import pl from "./locales/pl.js";

export const LANGUAGES = [
  { code: "en", name: "English", short: "EN" },
  { code: "pl", name: "Polski", short: "PL" },
];

const DICTIONARIES = { pl: pl.strings };
const PLURALS = { pl: pl.plurals };
const STORE_KEY = "pdftool.lang";

let lang = "en";
try {
  const saved = localStorage.getItem(STORE_KEY);
  if (LANGUAGES.some(l => l.code === saved)) lang = saved;
} catch {
  // Storage unavailable — stay in English.
}
document.documentElement.lang = lang;

export const getLanguage = () => lang;

export function setLanguage(code) {
  lang = code;
  try {
    localStorage.setItem(STORE_KEY, code);
  } catch {
    // ignore
  }
  document.documentElement.lang = code;
}

const normalize = text => text.replace(/\s+/g, " ").trim();

/** Translates an English string; {name} placeholders are filled from vars. */
export function t(text, vars) {
  const dict = DICTIONARIES[lang];
  let out = (dict && dict[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
  return out;
}

/**
 * "3 pages" / "3 strony". noun is the English singular ("page", "file", "image", "PDF").
 * grammaticalCase "acc" gives the object form where a language needs it (pl: "1 stronę").
 */
export function plural(n, noun, grammaticalCase = "nom") {
  const forms = PLURALS[lang]?.[noun];
  if (!forms) return `${n} ${noun}${n === 1 ? "" : "s"}`;
  const abs = Math.abs(n);
  const lastTwo = abs % 100;
  const last = abs % 10;
  let form;
  if (abs === 1) form = grammaticalCase === "acc" ? forms.oneAcc || forms.one : forms.one;
  else if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) form = forms.few;
  else form = forms.many;
  return `${n} ${form}`;
}

const ATTRIBUTES = ["title", "placeholder", "aria-label", "alt"];

/**
 * Translates fixed English text in a DOM subtree: text nodes and the
 * title/placeholder/aria-label/alt attributes whose whole text is a known
 * string. Skips [data-no-i18n] subtrees and the PDF page area.
 */
export function translateDom(root) {
  const dict = DICTIONARIES[lang];
  if (!dict || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.hasAttribute("data-no-i18n") || node.id === "viewerContainer" || node.tagName === "SCRIPT" || node.tagName === "STYLE") {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const key = normalize(node.nodeValue);
      const translated = key && dict[key];
      if (translated) {
        const lead = node.nodeValue.match(/^\s*/)[0];
        const trail = node.nodeValue.match(/\s*$/)[0];
        node.nodeValue = lead + translated + trail;
      }
    } else {
      for (const attr of ATTRIBUTES) {
        const value = node.getAttribute(attr);
        const translated = value && dict[normalize(value)];
        if (translated) node.setAttribute(attr, translated);
      }
    }
  }
}
