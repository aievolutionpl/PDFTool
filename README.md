<p align="center">
  <img src="build/icon.png" width="88" height="88" alt="PDF Tool icon">
</p>

<h1 align="center">PDF Tool</h1>

<p align="center">
  <b>Free, open-source PDF app for Windows</b><br>
  Read, annotate, sign, rearrange and convert PDF files —<br>
  including PDF → Word that keeps the exact layout <em>and</em> stays editable.
</p>

<p align="center">
  Made by <a href="https://www.aievolutionpolska.pl"><b>AI Evolution Polska</b></a>
</p>

<p align="center">
  <a href="https://github.com/aievolutionpl/PDFTool/releases/latest/download/PDF-Tool-Setup.exe"><img alt="Download the installer for Windows" src="https://img.shields.io/badge/Download-Installer%20for%20Windows-c63f17?style=for-the-badge"></a>
  &nbsp;
  <a href="https://github.com/aievolutionpl/PDFTool/releases/latest/download/PDF-Tool-Portable.exe"><img alt="Download the portable version" src="https://img.shields.io/badge/Portable-no%20install%20needed-1c1b1a?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://github.com/aievolutionpl/PDFTool/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/aievolutionpl/PDFTool?style=flat-square&label=latest%20version&color=1c1b1a"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-1c1b1a?style=flat-square">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-1c1b1a?style=flat-square"></a>
  <a href="https://github.com/aievolutionpl/PDFTool/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/aievolutionpl/PDFTool/total?style=flat-square&color=1c1b1a"></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.pl.md">Polski</a>
</p>

![PDF Tool showing an invoice with the page sidebar](docs/screenshots/viewer.png)

PDF Tool is a desktop app for everyday work with PDFs: open and read them, write and draw on them,
sign them, put pages in order, and turn them into Word, Excel or images. It's free, it has no ads and
no account, and everything happens on your own computer — your documents are never uploaded anywhere.

## Install in 3 steps

1. **Download** — click **[Download the installer](https://github.com/aievolutionpl/PDFTool/releases/latest/download/PDF-Tool-Setup.exe)**
   (`PDF-Tool-Setup.exe`, about 108 MB).
2. **Open the downloaded file.** Windows may show a blue window saying *“Windows protected your PC”*.
   Click **More info**, then **Run anyway**.
   <br><sub>This appears because the app isn't signed with a paid certificate — normal for free, open-source software. The full source code is in this repository.</sub>
3. **Follow the installer:** keep **Only for me** selected → **Next** → keep the suggested folder →
   **Install** → **Finish**. PDF Tool starts, and you'll find it in the Start menu and on your desktop.

With *Only for me* no administrator rights are needed. The installer appears in your Windows language.

> **Polski interfejs:** click **EN** in the top-right corner of the app and choose **Polski**. The choice is
> remembered.

<details>
<summary><b>Open every PDF with PDF Tool</b></summary>

Right-click any PDF file → **Open with** → **Choose another app** → select **PDF Tool** → click **Always**.
From now on, double-clicking a PDF opens it in PDF Tool.
</details>

<details>
<summary><b>No installation — portable version</b></summary>

Download **[PDF-Tool-Portable.exe](https://github.com/aievolutionpl/PDFTool/releases/latest/download/PDF-Tool-Portable.exe)**
and double-click it. Nothing is installed, so it also runs from a USB stick or on a computer where you
can't install programs.
</details>

<details>
<summary><b>Update or uninstall</b></summary>

- **Update:** download the newest installer from the link above and run it — it replaces the old
  version and keeps your settings and recent files. All versions are listed on the
  [Releases](https://github.com/aievolutionpl/PDFTool/releases) page.
- **Uninstall:** Windows **Settings → Apps → Installed apps → PDF Tool → Uninstall**.
</details>

Requires Windows 10 or 11, 64-bit.

## What you can do

| | |
| --- | --- |
| **Read** | Fast, sharp pages (Mozilla's PDF.js, the engine in Firefox) · page thumbnails and bookmarks · search with highlighting · zoom, fit width / page · continuous, single-page, grid and two-page layouts · Sepia and Night page colours · presentation mode · light and dark theme |
| **Annotate & sign** | Text boxes · freehand drawing · highlighter · images · signatures (draw, type, or upload a photo — the white background is removed automatically) · undo/redo · saved into the PDF, so other PDF readers show them too |
| **Pages** | Drag-and-drop page organizer · rotate · delete · insert blank pages or another PDF · extract pages · split into several files · watermark (any language) · page numbers · edit title/author |
| **Convert** | PDF → Word (3 layouts) · PDF → Excel · PDF → PNG/JPG · PDF → text · images → PDF · merge PDFs |
| **Languages** | English (default) and Polish — switch with the **EN / PL** button in the title bar |

### PDF → Word that looks like the original

![Original PDF next to the converted Word document](docs/screenshots/word-comparison.png)

Choose one of three layouts when you convert:

- **Exact & editable** *(default)* — the Word file looks like the PDF. Every line is real Word text you
  can edit, in its original position, font, size and colour. Pictures, lines and coloured areas stay in
  place behind the text. Rotated text, like the “PAID” stamp above, stays part of the picture.
- **Flowing document** — paragraphs, headings, lists and real Word tables that reflow as you type.
  Best when you want to rewrite the content.
- **Page pictures** — a pixel-perfect copy of each page. Not editable.

### PDF → Excel

Finds the rows and columns of tables and puts them into cells. Amounts become real numbers you can
calculate with — `1 234,56`, `1,234.56`, `15%` and `(120)` (negative) are all recognised — and bold
headers stay bold. Get one worksheet per page, or everything on one sheet for tables that continue
across pages.

### Annotate and sign

![Annotating an invoice: a circled total and a note](docs/screenshots/annotate.png)

### Organize pages

![The page organizer with two pages selected](docs/screenshots/organize.png)

### Convert

![The Convert to Word dialog](docs/screenshots/convert-word.png)

### Dark mode

![PDF Tool in dark mode](docs/screenshots/dark.png)

## How to

| I want to… | Do this |
| --- | --- |
| Open a PDF | **Ctrl+O**, drop the file on the window, or use *Recent* on the start screen |
| Write on, draw on or highlight a PDF | **Annotate** tab → *Text*, *Draw* or *Highlight*. Click an annotation later to move, restyle or delete it |
| Sign a document | **Annotate → Sign**, then drag the signature into place. Tick *Remember* to reuse it next time |
| Reorder, rotate or delete pages | **Pages → Organize pages**, drag pages around, then *Apply changes* |
| Take some pages out | **Pages → Extract** (e.g. `1-3, 7`) or *Split* into several files |
| Turn a PDF into Word / Excel | **Convert → Word** or **Excel**. Choose where to save; the file opens when it's ready |
| Make one PDF from photos or scans | **Convert → From images** (or drop images on the window) |
| Combine several PDFs | **Convert → Merge PDFs** (or drop several PDFs on the window) |
| Undo a page change | Click **Undo** in the notification that appears after the change |
| Save | **Ctrl+S** saves in place, **Ctrl+Shift+S** saves a copy. You're asked before closing with unsaved changes |

### Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Open · Save · Save as | Ctrl+O · Ctrl+S · Ctrl+Shift+S |
| Print · Find | Ctrl+P · Ctrl+F |
| Zoom | Ctrl + / Ctrl − / Ctrl+0, or Ctrl + mouse wheel |
| Organize pages | Ctrl+Shift+O |
| Presentation | F5 (Esc to leave) |
| Stop annotating | Esc |
| Undo / redo an annotation | Ctrl+Z / Ctrl+Y |
| New window · Close document | Ctrl+N · Ctrl+W |

## Good to know

- **Scanned PDFs** (photos of paper) have no text inside, so they convert to Word and Excel as
  pictures. Text recognition (OCR) is not included yet.
- **Exact & editable Word files** position text with Word *frames*. Microsoft Word and LibreOffice
  show them exactly; Google Docs doesn't support frames — use *Flowing document* there.
- **Fonts:** if a PDF uses a font that isn't installed on your PC, Word shows a similar one; the
  layout stays the same.
- **Excel** reads columns from how the text lines up, which works well for normal tables. Merged
  cells or text wrapped inside a cell can become extra rows.
- **Password-protected PDFs** can be opened, read and annotated, but their pages can't be rearranged.

## Open source — improve it with us

PDF Tool is **open source** under the [MIT license](LICENSE). Anyone can use it for free — at home
or at work — and anyone can **fix, change, improve and share** it.

- **Found a bug or have an idea?** [Open an issue](https://github.com/aievolutionpl/PDFTool/issues/new)
  and describe what happened or what you'd like.
- **Want to change something yourself?** Fork the repository, make your change and send a pull
  request. [CONTRIBUTING.md](CONTRIBUTING.md) explains how, step by step.
- **Want your own version?** You're free to build on it — just keep the license notice.

### Build from source

You need [Node.js](https://nodejs.org/) 22 or newer.

```bash
git clone https://github.com/aievolutionpl/PDFTool.git
cd PDFTool
npm install
npm start               # build and launch the app
npm run dist            # Windows installer → release/PDF-Tool-Setup.exe
npm run dist:portable   # portable app → release/PDF-Tool-Portable.exe
npm run dev:web         # interface preview in a browser at http://localhost:5199
```

| Path | Contents |
| --- | --- |
| `electron/main.js` | App window, file dialogs, file-access allow-list, recent files |
| `electron/preload.js` | The small API the interface may call (`window.pdftool`) |
| `src/app.js` | Interface: viewer, tools, dialogs, shortcuts |
| `src/layout.js` | Page analysis — text lines with real fonts and colours, text-free background, table columns |
| `src/office.js` | Word (.docx) and Excel (.xlsx) writers |
| `src/pdf-ops.js` | Page editing with pdf-lib — rotate, reorder, merge, split, watermark, numbers, images → PDF |
| `src/convert.js` | Rendering, thumbnails, PDF → images / text |
| `src/i18n.js`, `src/locales/`, `src/locale/` | Interface languages: English source texts, Polish dictionary, Polish labels for PDF.js |
| `src/organizer.js`, `src/signature.js` | Page organizer and signature pad |
| `src/styles.css` | Design (IBM Plex type, light and dark themes) |
| `scripts/` | Build script, icon generator, sample/test PDF generators |

**Security:** the interface runs sandboxed with context isolation; it can only read and write files you
picked in a dialog, opened, or dropped. Links inside PDFs open in your normal browser.

## About AI Evolution Polska

PDF Tool is created and maintained by **AI Evolution Polska** —
**[www.aievolutionpolska.pl](https://www.aievolutionpolska.pl)**.
Questions, ideas, or want a tool like this built for your company? Visit the website or open an issue.

## Built with

[PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0) ·
[pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) ·
[docx](https://github.com/dolanmiu/docx) (MIT) ·
[JSZip](https://github.com/Stuk/jszip) (MIT) ·
[Electron](https://www.electronjs.org/) (MIT) ·
[IBM Plex](https://github.com/IBM/plex) (SIL OFL)

## License

[MIT](LICENSE) © 2026 [AI Evolution Polska](https://www.aievolutionpolska.pl)
