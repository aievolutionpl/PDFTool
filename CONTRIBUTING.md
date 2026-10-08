# Contributing to PDF Tool · Jak współtworzyć PDF Tool

PDF Tool is open source (MIT) and made by [AI Evolution Polska](https://www.aievolutionpolska.pl).
Everyone is welcome to report problems, suggest ideas and improve the code.

PDF Tool to otwarte oprogramowanie (MIT) od [AI Evolution Polska](https://www.aievolutionpolska.pl).
Każdy może zgłaszać błędy, proponować pomysły i ulepszać kod. **Polska wersja niżej.**

---

## English

### Report a bug or suggest an idea

[Open an issue](https://github.com/aievolutionpl/PDFTool/issues/new) and include:

- what you did, what you expected, and what happened instead;
- your PDF Tool version (*File → About PDF Tool*) and Windows version;
- if possible, a sample PDF that shows the problem — **only one you're allowed to share**, with no
  personal or confidential data.

### Change the code

1. **Fork** this repository (button at the top right on GitHub) and clone your fork.
2. Install [Node.js](https://nodejs.org/) 22+ and run `npm install`.
3. Create a branch: `git checkout -b fix-short-description`.
4. Make your change. Useful commands:
   - `npm start` — build and run the app;
   - `npm run dev:web` — preview the interface in a browser (http://localhost:5199);
   - `node scripts/make-test-docs.mjs test.pdf` — create a test PDF with a table, colours and a stamp
     to try Word/Excel conversion.
5. Check that the app starts and that the feature you touched works (open, annotate, save, convert).
6. Commit with a clear message and open a **pull request** describing what changed and why.
   Screenshots help for visual changes.

### Code guidelines

- Plain JavaScript (ES modules) and CSS — no frameworks. Match the style of the surrounding code.
- Keep the renderer secure: no Node.js access in `src/`; new file access goes through
  `electron/preload.js` and the allow-list in `electron/main.js`.
- Keep the design consistent: use the colour and spacing tokens at the top of `src/styles.css`.
- Everything must keep working offline — don't load fonts, scripts or data from the internet.

### Releasing (maintainers)

1. Update `version` in `package.json`.
2. `npm run dist` and `npm run dist:portable` → `release/PDF-Tool-Setup.exe` and
   `release/PDF-Tool-Portable.exe`.
3. Commit, push, then
   `gh release create vX.Y.Z release/PDF-Tool-Setup.exe release/PDF-Tool-Portable.exe --title "PDF Tool X.Y.Z" --generate-notes`.

The file names stay the same in every release, so the download links in the README always point to
the newest version.

---

## Polski

### Zgłoś błąd lub pomysł

[Otwórz zgłoszenie (Issue)](https://github.com/aievolutionpl/PDFTool/issues/new) i napisz:

- co zrobiłeś, czego się spodziewałeś i co się stało;
- wersję PDF Tool (*File → About PDF Tool*) i wersję Windows;
- jeśli możesz — przykładowy PDF, w którym widać problem. **Tylko taki, który możesz udostępnić**,
  bez danych osobowych i poufnych.

Można pisać po polsku.

### Zmień kod

1. Zrób **fork** repozytorium (przycisk w prawym górnym rogu na GitHubie) i sklonuj go.
2. Zainstaluj [Node.js](https://nodejs.org/) 22+ i uruchom `npm install`.
3. Utwórz gałąź: `git checkout -b poprawka-krotki-opis`.
4. Wprowadź zmianę. Przydatne polecenia:
   - `npm start` — zbuduj i uruchom aplikację;
   - `npm run dev:web` — podgląd interfejsu w przeglądarce (http://localhost:5199);
   - `node scripts/make-test-docs.mjs test.pdf` — tworzy testowy PDF z tabelą, kolorami i pieczątką do
     sprawdzania konwersji do Worda/Excela.
5. Sprawdź, czy aplikacja się uruchamia i czy zmieniona funkcja działa (otwieranie, notatki, zapis,
   konwersja).
6. Zrób commit z czytelnym opisem i otwórz **pull request** — napisz, co zmieniłeś i dlaczego.
   Przy zmianach wyglądu dołącz zrzuty ekranu.

### Zasady w kodzie

- Czysty JavaScript (moduły ES) i CSS — bez frameworków. Pisz w stylu otaczającego kodu.
- Dbaj o bezpieczeństwo: w `src/` nie ma dostępu do Node.js; nowy dostęp do plików idzie przez
  `electron/preload.js` i listę dozwolonych plików w `electron/main.js`.
- Trzymaj spójny wygląd: używaj kolorów i odstępów zdefiniowanych na początku `src/styles.css`.
- Wszystko musi działać offline — nie ładuj czcionek, skryptów ani danych z internetu.
