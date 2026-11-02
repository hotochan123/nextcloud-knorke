# Knorke Redesign, Runde 5: Admin-Seite und Logo

Stand 02.11.2026. Gehört zu `runde5.html`. Die Seite läuft ohne Internet und ohne JavaScript; sie wird beim Bauen fertig erzeugt.

- **Anker:** `#A0` … `#A3`, `#L` (alle Logos untereinander), `#L0` … `#L7`, `#E` (Empfehlung).
- **Bauen:** `node src5/build.mjs`. Das schreibt `runde5.html` und für jede Logo-Variante `src5/logos/<Kürzel>/app.svg` (weiß), `app-dark.svg` (#000) und `app-neutral.svg` (#808080).
- **Frühere Runden:** nicht verändert.

**Wie geprüft:**
- **Logos:** Ein kleines Prüfwerkzeug (`src5/raster.mjs`) rastert die Logos zu Bildern, die ich mir bei 16, 20, 32 und 128 px angesehen habe, auch die fertigen Dateien. Dabei sind zwei Entwürfe durchgefallen und neu gezeichnet worden: L2 (Verbinder war nur ein Strich) und L4 (las sich nicht als „K“).
- **Admin-Seite:** Sie ist HTML. Gesehen habe ich sie nicht, weil es hier keinen Browser gibt. Bitte in Chromium und Safari ansehen.

## Teil A: Admin-Seite

Jede Variante ist dreimal zu sehen:
- 1440 (Inhaltsfläche 1124 px), voller Zustand, hell: 2 Vorschläge und 3 übernommene je Liste, Texte auf Deutsch und Englisch;
- 1024 (708 px), leer, dunkles Thema, ohne KI-Anbieter;
- 390 (Telefon), voll, mit dem Fehler „Gib eine Adresse ein, die mit http:// oder https:// beginnt.“

Alle Felder bleiben, nichts kommt dazu. Farben kommen nur aus Nextcloud-Variablen.

**A0 heute.** Vier gleich schmale Spalten. Lange Texte sind abgeschnitten, es gibt drei „Speichern“-Knöpfe, und leere Bereiche nehmen so viel Platz wie volle.

**A1 eine Spalte mit Karten.** Alle Bereiche untereinander, höchstens 760 breit, je eine Karte mit Symbol, Überschrift und einem Satz. Textfelder zeigen den ganzen Text, es bleiben zwei „Speichern“.
- Für: ruhig.
- Wider: viel Scrollen, auch wenn nur eine Vorlage wartet.

**A2 Reiter oben.** Ein Reiter je Bereich, mit Zähler bei Vorschlägen.
- Für: kurz und übersichtlich.
- Wider: Man sieht nicht, was in den anderen Reitern steht. Auf dem Telefon muss man die Reiter seitlich schieben.

**A3 Vorschlag.** Einklappbare Bereiche, Vorschläge zuerst, ein gemeinsames Speichern.
- Oben steht der Hinweis „4 Vorschläge warten auf dich“.
- Dann folgen Vorlagen und Formbibliotheken mit Zähler.
- KI und Datenschutz sind eingeklappt und zeigen in einer Zeile, wie sie stehen.
- Ein Speichern-Balken erscheint nur bei Änderungen. Solange ein Fehler offen ist, ist er gesperrt.

## Teil L: Logo

Jedes Logo ist zu sehen:
- groß (128 px) auf Weiß;
- in der App-Leiste auf #00679e neben vier Nachbarn (Platzhalter aus Phosphor, nicht die echten Nextcloud-Symbole);
- 16 px grau in einer Liste;
- im dunklen Thema;
- als App-Store-Kachel;
- in einer bunten Fassung.

| Kürzel | Was es zeigt | Für | Wider |
|---|---|---|---|
| L0 | Notiz mit abgeschnittener Ecke und Eselsohr (heute) | ruhig | wie jedes „Notiz“-Symbol; Lücke nur 0,6 px, verschwimmt bei 16 px |
| L1 | zwei Notizen, vorne mit Eselsohr | „viele Notizen“ statt einer | hintere Streifen bei 16 px nur 2 px |
| L2 | Notiz, aus der ein Verbinder-Pfeil führt | „Notizen verbinden“ | wirkt bei 16 px wie „Weiterleiten“ |
| L3 | rundere Notiz, Eselsohr wie N4, zwei Textzeilen | sofort „Notiz“, freundlich | Zeilen in Notizen zeigen viele Apps |
| L4 | „K“ aus drei Notizen | eigenständig, verbunden mit dem Namen | Buchstabe statt Bild; Arme verschmelzen bei 16 px |
| L5 | Notiz mit Ästen zu zwei Notizen (Mindmap) | zeigt Diagramme | sieht aus wie das Nextcloud-Symbol „Teilen“ |
| L6 | Frame mit Reiter, zwei Notizen darin | „Board“ | sieht aus wie ein Ordner (neben „Dateien“) |
| L7 | Vorschlag: aufrechte Notiz mit Eselsohr vor einer gekippten | lebendig, eigenständig, bei 16 px zwei klare Flächen | etwas verspielter als heute |

## Empfehlung

**Admin-Seite: A3.** Was Arbeit macht, steht oben und zählt sich selbst. Was selten angefasst wird, ist eingeklappt und sagt, wie es steht. Ein Speichern statt drei.

| Eigenschaft | Wert |
|---|---|
| Inhaltsbreite | höchstens 760 px, links bündig; Telefon 16 px Rand |
| Reihenfolge | Hinweis „n Vorschläge warten auf dich“ (nur wenn n > 0, Fläche --color-info) · Vorlagen · Formbibliotheken · KI · Datenschutzhinweis |
| Bereichskopf | ganze Zeile klickbar, mindestens 64 px hoch; Symbol 40 × 40, Radius 10, Fläche --color-primary-element-light; Titel 17, halbfett; darunter eine Zeile 14 in --color-text-maxcontrast (zu: Stand, auf: Erklärsatz); Pfeil rechts |
| Aufklappen | offen sind: der erste Bereich mit offenen Vorschlägen und jeder Bereich mit einem Fehler; alle anderen zu |
| Zähler | Pille 20 hoch, mindestens 22 breit, --color-primary-element, Text 12 fett |
| Listen | Zeile mit Name (und „vorgeschlagen von …“), rechts „Übernehmen“ (primär) und „Ablehnen“ (tertiär) bzw. „Entfernen“; Trennlinie --color-border; leer: ein Satz in --color-text-maxcontrast |
| Textfelder | volle Höhe des Textes (nicht abgeschnitten), Rand 2 px --color-border-maxcontrast, Radius 8 |
| Fehler | Rand --color-error-text, darunter Symbol und Satz in --color-error-text |
| Speichern | ein Balken am Ende, nur bei Änderungen: „Ungespeicherte Änderungen · Verwerfen · Speichern“; bei Fehler „1 Fehler im Datenschutzhinweis“, Speichern gesperrt |
| Knöpfe | NcButton, 36 px hoch (Telefon 44 px) |

**Logo: L7**, als ruhigere Alternative L3.

| Eigenschaft | Wert |
|---|---|
| Raster | 20 × 20, eine Fläche (Füllregel nonzero), keine Linien |
| Vordere Notiz | 12 × 12 ab (6,5 · 6,5), Radius 3; unten rechts Aussparung 5,5 × 5,5 mit innerem Radius 1,5 |
| Eselsohr | Dreieck mit 4 Schenkeln in der Aussparung, Abstand 1,5 |
| Hintere Notiz | 11 × 11, Radius 2,4, um −14° gekippt; sichtbar nur, wo sie mindestens 1,5 Abstand zur vorderen hat |
| Dateien | `src5/logos/L7/app.svg` #fff · `app-dark.svg` #000 · `app-neutral.svg` #808080 |
| Bunte Fassung | vordere Notiz Hellblau Reiter-Ton #6bbef2, Eselsohr Hellblau kräftig #0275a9, hintere Notiz Gelb Reiter-Ton #e8ce49 |
| App-Store-Kachel | weißes Logo auf #00679e |
