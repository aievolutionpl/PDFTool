# Polish labels for the PDF.js parts used inside PDF Tool (annotation editors,
# page landmarks). Anything missing falls back to PDF.js' built-in English.

## Pages

pdfjs-page-landmark =
    .aria-label = Strona { $page }
pdfjs-text-annotation-type =
    .alt = [Adnotacja: { $type }]
pdfjs-annotation-date-time-string = { DATETIME($dateObj, dateStyle: "short", timeStyle: "medium") }
pdfjs-rendering-error = Podczas wyświetlania strony wystąpił błąd.

## Editor buttons and toolbars

pdfjs-editor-free-text-button =
    .title = Tekst
pdfjs-editor-free-text-button-label = Tekst
pdfjs-editor-ink-button =
    .title = Rysuj
pdfjs-editor-ink-button-label = Rysuj
pdfjs-editor-stamp-button =
    .title = Dodaj lub edytuj obrazy
pdfjs-editor-stamp-button-label = Dodaj lub edytuj obrazy
pdfjs-editor-highlight-button =
    .title = Wyróżnij
pdfjs-editor-highlight-button-label = Wyróżnij
pdfjs-highlight-floating-button1 =
    .title = Wyróżnij
    .aria-label = Wyróżnij
pdfjs-highlight-floating-button-label = Wyróżnij
pdfjs-comment-floating-button =
    .title = Komentarz
    .aria-label = Komentarz
pdfjs-comment-floating-button-label = Komentarz
pdfjs-editor-color-picker-free-text-input =
    .title = Zmień kolor tekstu
pdfjs-editor-color-picker-ink-input =
    .title = Zmień kolor rysunku
pdfjs-editor-remove-ink-button =
    .title = Usuń rysunek
pdfjs-editor-remove-freetext-button =
    .title = Usuń tekst
pdfjs-editor-remove-stamp-button =
    .title = Usuń obraz
pdfjs-editor-remove-highlight-button =
    .title = Usuń wyróżnienie
pdfjs-editor-remove-signature-button =
    .title = Usuń podpis
pdfjs-editor-free-text-color-input = Kolor
pdfjs-editor-free-text-size-input = Rozmiar
pdfjs-editor-ink-color-input = Kolor
pdfjs-editor-ink-thickness-input = Grubość
pdfjs-editor-ink-opacity-input = Krycie
pdfjs-editor-stamp-add-image-button =
    .title = Dodaj obraz
pdfjs-editor-stamp-add-image-button-label = Dodaj obraz
pdfjs-editor-free-highlight-thickness-input = Grubość
pdfjs-editor-free-highlight-thickness-title =
    .title = Zmień grubość przy wyróżnianiu elementów innych niż tekst

## Editors

pdfjs-free-text2 =
    .aria-label = Edytor tekstu
    .default-content = Zacznij pisać…
pdfjs-editor-highlight-editor =
    .aria-label = Edytor wyróżnień
pdfjs-editor-ink-editor =
    .aria-label = Edytor rysunków
pdfjs-editor-stamp-editor =
    .aria-label = Edytor obrazów
pdfjs-editor-signature-editor1 =
    .aria-description = Edytor podpisu: { $description }

## Alt text

pdfjs-editor-alt-text-button =
    .aria-label = Tekst alternatywny
pdfjs-editor-alt-text-button-label = Tekst alternatywny
pdfjs-editor-alt-text-edit-button =
    .aria-label = Edytuj tekst alternatywny
pdfjs-editor-alt-text-decorative-tooltip = Oznaczony jako dekoracyjny

## Resizers

pdfjs-editor-resizer-top-left =
    .aria-label = Lewy górny róg — zmień rozmiar
pdfjs-editor-resizer-top-middle =
    .aria-label = Środek góry — zmień rozmiar
pdfjs-editor-resizer-top-right =
    .aria-label = Prawy górny róg — zmień rozmiar
pdfjs-editor-resizer-middle-right =
    .aria-label = Środek prawej krawędzi — zmień rozmiar
pdfjs-editor-resizer-bottom-right =
    .aria-label = Prawy dolny róg — zmień rozmiar
pdfjs-editor-resizer-bottom-middle =
    .aria-label = Środek dołu — zmień rozmiar
pdfjs-editor-resizer-bottom-left =
    .aria-label = Lewy dolny róg — zmień rozmiar
pdfjs-editor-resizer-middle-left =
    .aria-label = Środek lewej krawędzi — zmień rozmiar

## Highlight colours

pdfjs-editor-highlight-colorpicker-label = Kolor wyróżnienia
pdfjs-editor-colorpicker-button =
    .title = Zmień kolor
pdfjs-editor-colorpicker-dropdown =
    .aria-label = Wybór kolorów
pdfjs-editor-colorpicker-yellow =
    .title = Żółty
pdfjs-editor-colorpicker-green =
    .title = Zielony
pdfjs-editor-colorpicker-blue =
    .title = Niebieski
pdfjs-editor-colorpicker-pink =
    .title = Różowy
pdfjs-editor-colorpicker-red =
    .title = Czerwony
pdfjs-editor-highlight-show-all-button-label = Pokaż wszystkie
pdfjs-editor-highlight-show-all-button =
    .title = Pokaż wszystkie

## Screen-reader announcements

pdfjs-editor-highlight-added-alert = Dodano wyróżnienie
pdfjs-editor-freetext-added-alert = Dodano tekst
pdfjs-editor-ink-added-alert = Dodano rysunek
pdfjs-editor-stamp-added-alert = Dodano obraz
pdfjs-editor-signature-added-alert = Dodano podpis

## Comments

pdfjs-show-comment-button =
    .title = Pokaż komentarz
pdfjs-editor-add-comment-button =
    .title = Dodaj komentarz
