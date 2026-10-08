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
- Write interface texts in English and wrap them in `t()` (from `src/i18n.js`), then add the Polish
  version to `src/locales/pl.js`. Texts written straight into `src/index.html` are translated
  automatically — they only need an entry in `pl.js`.

### Translations

The interface is in English (default) and Polish. The user picks the language with the **EN / PL**
button in the title bar; the choice is saved.

- **Improve the Polish translation:** edit `src/locales/pl.js`. Each line is
  `"English text": "Polish text"`. Keep placeholders like `{name}` or `{n}` unchanged.
  Polish plural forms (1 strona, 2 strony, 5 stron) are in `plurals` at the bottom.
- **Labels of the annotation tools** (text box, drawing, highlight) come from PDF.js and live in
  `src/locale/pl/viewer.ftl`.
- **Add a new language:** copy `src/locales/pl.js` to e.g. `de.js` and translate it, register it in
  `DICTIONARIES`/`PLURALS` and `LANGUAGES` in `src/i18n.js`, add the PDF.js labels as
  `src/locale/de/viewer.ftl` and to `src/locale/locale.json`, and add the close-dialog texts to
  `NATIVE_TEXT` in `electron/main.js`.

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
- wersję PDF Tool (*Plik → O programie PDF Tool*) i wersję Windows;
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
- Teksty interfejsu pisz po angielsku i otaczaj funkcją `t()` (z `src/i18n.js`), a polską wersję
  dodaj do `src/locales/pl.js`. Teksty wpisane wprost w `src/index.html` tłumaczą się same —
  wystarczy wpis w `pl.js`.

### Tłumaczenia

Interfejs jest po angielsku (domyślnie) i po polsku. Język wybiera się przyciskiem **EN / PL** na
pasku tytułu; wybór jest zapamiętywany.

- **Popraw polskie tłumaczenie:** edytuj `src/locales/pl.js`. Każda linia to
  `"tekst angielski": "tekst polski"`. Nie zmieniaj znaczników typu `{name}` czy `{n}`.
  Odmiana liczebników (1 strona, 2 strony, 5 stron) jest w `plurals` na końcu pliku.
- **Etykiety narzędzi adnotacji** (pole tekstowe, rysowanie, zakreślacz) pochodzą z PDF.js i są w
  `src/locale/pl/viewer.ftl`.
- **Dodaj nowy język:** skopiuj `src/locales/pl.js` np. do `de.js` i przetłumacz, dopisz go w
  `DICTIONARIES`/`PLURALS` i `LANGUAGES` w `src/i18n.js`, dodaj etykiety PDF.js jako
  `src/locale/de/viewer.ftl` i w `src/locale/locale.json`, a teksty okna zamykania w `NATIVE_TEXT`
  w `electron/main.js`.
