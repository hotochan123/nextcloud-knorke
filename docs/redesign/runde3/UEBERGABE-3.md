# Knorke Redesign, Runde 3: Notizen, Grundformen und Verbinder

Stand 01.11.2026. Runde 1 (`UEBERGABE.md`, `index.html`, `tokens.css`, `zuordnung.md`) und Runde 2 (`UEBERGABE-2.md`, `runde2.html`, `runde2.md`) sind fertig und in Knorke gebaut: Leisten, Palette, Frame-Reiter (A2) und Phosphor-Piktogramme (B5, Symbol-Formen in Duotone). Diese Runde ändert nichts daran, sie baut darauf auf. Diesmal geht es um die drei häufigsten Dinge **auf der Leinwand**: Notizen, Grundformen und Verbinder.

## 1. Worum es geht

Die Person hat angekreuzt, was sie stört:

- **Notizen:** wirken flach und steril; Text und Schrift.
- **Grundformen:** Rand und Füllung; Ecken und Proportionen; Text in Formen.
- **Verbinder:** Linie und Pfeilspitzen; Verlauf und Kurven; Beschriftung.
- Bei allen dreien zusätzlich: **freie Hand**, eigene Vorschläge sind erwünscht.

Die Person ist keine Designerin und keine Entwicklerin. Sie entscheidet, indem sie auf Varianten zeigt. Deine Aufgabe ist deshalb, **Varianten nebeneinander zu zeigen**, jede mit einem Kürzel (N1, N2 …, F1 …, V1 …), und in einfachen Worten zu sagen, worin sie sich unterscheiden. Wie in Runde 2 hilft es, wenn du benennst, *was* etwas flach oder lebendig, plump oder fein wirken lässt (Schatten, Ecken, Strichstärke, Verhältnis von Linie zu Fläche, Luft um den Text, Größe der Pfeilspitze), und das an Paaren „heute / anders“ sichtbar machst.

Die drei Teile sollen am Ende zusammenpassen: Zeig deshalb zum Schluss ein Board, auf dem deine empfohlenen Varianten gemeinsam stehen (Teil D).

## 2. Fester Rahmen

- Knorke ist ein Whiteboard in Nextcloud. Die Leinwand wird mit **Konva (Canvas 2D)** gezeichnet. Erlaubt: Rechtecke mit gerundeten Ecken, Pfade, Kreise, Linien mit Strichmustern, Text, flache Farbflächen, Deckkraft, ein weicher Schatten (heute als Verlauf gemalt, siehe Notizen). Keine Bilder oder Texturen aus Dateien, keine Filter, keine Verläufe als Füllung einer Form. Ein Schatten oder eine einfache Zusatzform (Eselsohr, Klebestreifen, Knick) ist möglich; sag, was sie beim Bauen kostet.
- **Die Leinwand bleibt bei Arial** (Entscheidung Runde 1, damit jedes Gerät gleich umbricht). Schriftgröße, Gewicht, Zeilenabstand und Innenabstand dürfen sich ändern.
- **Die Palette ist fest:** 13 Farben, jeweils hell (Notiz, Füllung) und kräftig (Linie, Text, Tag). Werte unten in §3 und in `tokens.css` Teil 2. Neue Töne sind nicht vorgesehen; ein Rand oder Schatten darf aus einem Ton abgeleitet werden (z. B. kräftiger Ton mit Deckkraft), wenn du die Regel nennst.
- Alles wächst mit dem Zoom (Teil des Boards). Es muss bei **25 %** noch lesbar bzw. erkennbar und bei **200 %** nicht klobig sein. Unter 30 % Zoom zeichnet Knorke heute keine Schatten und keine Beschriftung von Verbindern; sag, ob deine Variante das ändert.
- **Bestehende Boards:** Gespeichert sind nur Werte (Farbe, Größe, Rand, Route, Pfeilende …). Eine Variante darf ändern, *wie* ein Wert gezeichnet wird, aber keine gespeicherten Werte umdeuten, die Leute bewusst gewählt haben. Wo eine Variante neue Grundwerte für *neue* Objekte vorschlägt (z. B. Größe, Rand), sag das ausdrücklich.
- Export (PNG, SVG, PDF) zeichnet genau wie die Leinwand.
- Auswahl, Griffe, Tags, Abstimmungs-Punkte und Reaktionen sind nicht Thema; sie müssen aber auf deinen Varianten noch Platz haben (zeig je ein Beispiel).
- Dunkelmodus (b): Leinwand bleibt hell (#f3f2f0), nur die Leisten werden dunkelgrau. Für die Leinwand also nur der helle Fall.
- Keine Ressourcen aus dem Netz (Schriften, Skripte, Bilder): die Seite muss ohne Internet laufen. Symbole aus `quellen/` (Phosphor) dürfen benutzt werden.

## 3. Heutiger Stand (exakte Werte, Stand Code 01.11.2026)

„Einheiten“ wachsen mit dem Zoom, „px“ bleiben auf dem Bildschirm gleich. Die Screenshots in `screenshots/heute/` sind vom 29.10., also **vor** dem Umbau (alte Farben, alte Leisten); Formen und Verbinder sehen darin aber im Wesentlichen aus wie heute (`02-board-overview.png`, `03-note-selected-contextbar.png`, `05-shape-selected-contextbar.png`, `08-shapes-panel.png`). Zeichne „heute“ (N0, F0, V0) nach den Werten hier, nicht nach den Screenshots.

### Palette (hell / kräftig)

| # | Name | hell | kräftig |
|---|---|---|---|
| 1 | Hellblau (Standard neuer Notizen) | #a2d9fe | #0275a9 |
| 2 | Türkis | #8fe7e1 | #087c77 |
| 3 | Salbei | #b3e8b3 | #307d37 |
| 4 | Gelb | #faea89 | #7e6f01 |
| 5 | Orange | #febf87 | #a25d04 |
| 6 | Koralle | #ffaaa7 | #c43e45 |
| 7 | Rosa | #f9b7d6 | #b94082 |
| 8 | Lila | #d9b9ee | #9550bb |
| 9 | Indigo | #b9c8fc | #5165d3 |
| 10 | Sand | #e1ceb0 | #816b46 |
| 11 | Weiß | #ffffff | #ffffff |
| 12 | Grau | #e0e0dd | #6f6f6d |
| 13 | Schwarz | #191b1d | #191b1d |

Leinwand #f3f2f0, Text auf der Leinwand #191b1d, Auswahl #0082c9 (oder Akzentfarbe von Nextcloud).

### Notizen

- Quadrat 200 × 200, beim Anlegen per Klick. Seitenverhältnis bleibt beim Größerziehen erhalten.
- Ecken Radius 6. Kein Rand.
- Schatten: eine Ebene, x 0, y 2, Weichheit 8, Schwarz 12 %. Er fällt immer nach unten auf dem Bildschirm, auch wenn die Notiz gedreht ist.
- Fläche: heller Ton der Palette, Standard Hellblau.
- Text: Arial, Zeilenabstand 1,2, **immer mittig waagrecht und senkrecht**, Innenabstand 16 rundum. Größen: Auto, S 16, M 22 (Standard neuer Notizen), L 32. Passt der Text nicht, wird schrittweise kleiner (bis 10); ab 16 abwärts werden lange Wörter getrennt.
- Textfarbe: #191b1d, auf dunklen Flächen automatisch Weiß.
- Tags: eine Reihe kleiner Schilder unten in der Notiz (22 hoch, Schrift 13, in der Tag-Farbe), der Text verliert dafür unten 30.
- Abstimmung: runder Punkt (28 px) auf der rechten oberen Ecke. Reaktionen: Emoji-Leiste 8 unter der Notiz.

### Grundformen

Rechteck, abgerundetes Rechteck, Ellipse, Raute, Dreieck, Pfeil nach rechts.

- Größe: wird aufgezogen; per Klick 200 × 120 (auch Raute, Ellipse, Dreieck).
- Füllung Weiß, Rand #191b1d, Randstärke 2. Angeboten: Rand 0, 1, 2, 4, 8, 12; Füllung-Deckkraft 100, 75, 50, 25, 0 %; Strich durchgezogen, gestrichelt (4w/3w), gepunktet (runde Punkte, Abstand 2,5w).
- Ecken: Rechteck spitz; abgerundetes Rechteck 15 % der kürzeren Seite (18 bei 200 × 120). Raute, Dreieck, Pfeil mit spitzen Ecken.
- Kein Schatten.
- Text: Arial 1,2, Größe Auto oder 12, 16, 20, 24, 32, 48, 64, 96, 128; Ausrichtung wählbar (links/mittig/rechts, oben/mitte/unten), Standard mittig. Innenabstand 8. Textfeld je Form als Anteil der Fläche: Rechteck ganz; Ellipse 71 % mittig; Raute 50 % mittig; Dreieck untere Hälfte, 50 % breit; Pfeil der Schaft (65 % breit, mittlere Hälfte der Höhe).
- Daneben gibt es Flussdiagramm- (12), BPMN- (28) und Symbol-Formen (20, Phosphor Duotone). Die Flussdiagramm-Formen sollen deine Regeln für Rand, Füllung und Text übernehmen können; zeig das an zwei, drei Beispielen (Prozess, Entscheidung, Dokument, Datenbank). BPMN folgt einer Norm und bleibt außen vor.

### Verbinder

- Neuer Verbinder: Route **eckig**, Farbe #3d4044, Stärke 2, Ende Pfeil. Farben: die 12 kräftigen Töne. Stärken 1, 2, 4, 8, 12. Strich durchgezogen, gestrichelt, gepunktet.
- Routen:
  - **gerade:** eine Strecke.
  - **eckig:** rechtwinklig, verlässt jede Form mit einem Stück von 20 senkrecht zur Kante, möglichst wenig Knicke, weicht anderen Objekten aus. **Knicke sind spitz**, nicht gerundet.
  - **gebogen:** eine Bézier-Kurve, Griffpunkte senkrecht aus den Kanten, Länge 40 % des Abstands (mindestens 40).
- Andocken: an vier Punkten (Mitte jeder Seite bzw. Spitzen der Raute), Linie beginnt direkt auf der Kante, kein Abstand.
- Pfeilenden (Größe 3 × Stärke + 4, also 10 bei Stärke 2): offener Pfeil (Winkel, Schenkel 10 lang und 10 breit), gefülltes Dreieck, offenes Dreieck, gefüllte Raute, Punkt, offener Kreis, keins. Immer durchgezogen, auch auf gestrichelter Linie.
- Beschriftung: höchstens eine je Verbinder, auf halber Länge, Arial 16, Innenabstand 4, höchstens 240 breit (dann Umbruch), Hintergrund in Leinwandfarbe mit Radius 3, Text #191b1d. Unter 30 % Zoom unsichtbar.
- Ausgewählt: ein halb durchsichtiger Schein in Auswahlfarbe entlang der Linie, runde Griffe an den Enden.

## 4. Teil N: Notizen

Wunsch: weniger flach und steril, besserer Text.

- **N0 heute:** zum Vergleich.
- **N1 Papier:** weicherer, zweistufiger Schatten (nah und fern), wie ein Blatt, das leicht absteht. `tokens.css` aus Runde 1 hatte so etwas schon vorgesehen (`--note-shadow`, zwei Ebenen); prüfe, ob das reicht.
- **N2 Haftzettel:** wie N1, dazu ein Merkmal echter Haftnotizen: z. B. unten etwas stärkerer Schatten (die Ecke hebt sich), ein angedeuteter Klebestreifen oben in einem dunkleren Ton derselben Farbe, oder ein Eselsohr. Zeig zwei, drei solche Merkmale getrennt, damit sie wählen kann.
- **N3 Rand statt Schatten:** feine Kante im kräftigen Ton derselben Farbe (geringe Deckkraft), kaum Schatten: ruhig und modern statt Papier.
- **N4 dein Vorschlag.**

Text (für jede Variante, mit der jeweils besten Einstellung):
- Größe M (22) mit kurzem Text („Kunden anrufen“), mit drei Zeilen, mit einem sehr langen Text (wird kleiner), mit einem langen Wort („Datenschutzgrundverordnung“).
- Prüf Zeilenabstand (heute 1,2), Innenabstand (heute 16), Gewicht (heute normal), und ob Text **oben links** statt mittig besser liest (gespeichert ist heute keine Ausrichtung; eine Änderung gälte für alle Notizen). Zeig mittig und oben links nebeneinander.
- Grundgröße einer neuen Notiz: 200 (heute) gegen 180 (Runde 1 vorgesehen).

Zustände: Hellblau, Gelb, Koralle, Salbei, Weiß, Schwarz (weißer Text); mit Tags; mit Abstimmungs-Punkt und Reaktionen; ausgewählt; gedreht (5°); fünf Notizen dicht als Gruppe und überlappend; Zoom 25 %, 100 %, 200 %.

## 5. Teil F: Grundformen

Wunsch: Rand und Füllung, Ecken und Proportionen, Text in Formen.

- **F0 heute:** schwarzer 2er-Rand, weiße Fläche, spitze Ecken, 200 × 120.
- **F1 weicher Rand:** Rand dunkelgrau statt schwarz, leicht dünner wirkend; kleine Rundung an allen Ecken (auch Raute, Dreieck, Pfeil), abgerundetes Rechteck mit festem Radius statt 15 %.
- **F2 farbig gefüllt:** neue Formen bekommen einen hellen Palettenton als Fläche und den passenden kräftigen Ton als Rand (Ton-in-Ton), Weiß bleibt wählbar.
- **F3 leichter Schatten:** wie Notizen, aber schwächer, damit Formen sich von der Leinwand lösen; sag, ob Notizen und Formen dann zu ähnlich wirken.
- **F4 dein Vorschlag.**

Proportionen: Zeig, welche Grundgröße je Form beim Klick sinnvoll ist (heute alle 200 × 120; Raute und Kreis wirken so gestaucht). Vorschlag je Form mit Begründung.

Text: Zeig für Ellipse, Raute und Dreieck, wie viel Text heute hineinpasst und wie viel mit einem besser berechneten Textfeld; Innenabstand (heute 8) und Standardgröße.

Zustände: alle sechs Formen in einer Reihe, je mit kurzem und langem Text; Rand 1, 2, 4; gestrichelt und gepunktet; Füllung 0 % und 50 %; zwei, drei Palettenfarben; ausgewählt; Flussdiagramm-Beispiel (Prozess, Entscheidung, Dokument, Datenbank, mit Verbindern); Zoom 25 %, 100 %, 200 %.

## 6. Teil V: Verbinder

Wunsch: Linie und Pfeilspitzen, Verlauf und Kurven, Beschriftung.

- **V0 heute.**
- **V1 runde Knicke:** eckige Route mit gerundeten Ecken (Radius z. B. 8–16, kleiner, wenn das Stück kurz ist).
- **V2 feinere Spitzen:** Pfeilenden schlanker oder spitzer, Größe nicht ganz proportional zur Stärke (bei Stärke 8 und 12 heute sehr groß); gefülltes Dreieck als Standard statt offener Winkel? Zeig alle sieben Enden bei Stärke 1, 2, 4, 8.
- **V3 Abstand zur Form:** Linie endet einige Einheiten vor der Kante statt direkt darauf; Pfeil berührt die Form oder nicht.
- **V4 Beschriftung:** Varianten für den Text auf der Linie: Hintergrund in Leinwandfarbe (heute), als kleine Plakette mit Rand, über der Linie statt darauf, kleiner/größer. Sag, was bei einer Linie über einer farbigen Fläche (Frame, Form) passiert, wo die Leinwandfarbe als Hintergrund falsch aussieht.
- **V5 Kurven:** gebogene Route mit anderer Spannung oder als S-Kurve; Vergleich mit heute.
- **V6 dein Vorschlag** (z. B. Standardfarbe, Standardstärke 1,5, Strichmuster).

Zustände: alle drei Routen zwischen zwei Formen nebeneinander, untereinander und schräg versetzt; eckige Route mit Ausweichen um ein Hindernis; kurze Verbindung (Formen nah beieinander); Stärke 1, 2, 4, 8; gestrichelt und gepunktet; zwei Farben; mit kurzer und langer Beschriftung; über einem farbigen Frame; ausgewählt; Zoom 25 %, 100 %, 200 %.

## 7. Teil D: Zusammen

Ein Ausschnitt eines echten Boards (Retro oder Ablauf mit Frame-Reiter aus Runde 2, ein paar Notizen, ein kleines Flussdiagramm mit beschrifteten Verbindern), einmal **heute** und einmal mit deinen Empfehlungen aus N, F und V. Dazu ein Satz, warum die Kombination zusammenpasst.

## 8. Lieferumfang

- **`runde3.html`:** eine eigenständige Seite (alles eingebettet), oben ein Umschalter für Teil N, F, V und D und zwischen den Varianten; jede Variante trägt ihr Kürzel groß sichtbar, damit die Person in einer Fragerunde sagen kann „N2“ oder „V1“. Links wie `#N2` öffnen eine Variante. Desktop 1440 × 900 zuerst. Die Leinwand-Ausschnitte bitte als SVG oder Canvas so zeichnen, wie Konva es könnte (keine CSS-Effekte, die Konva nicht hat). Du darfst die Seite aus Quellen in `src3/` bauen wie Runde 2.
- **`runde3.md`:** pro Variante zwei, drei Sätze: was sie anders macht, was dafür spricht, was dagegen, was sie beim Bauen kostet, und ob bestehende Boards anders aussehen. Am Ende eine Liste deiner Empfehlung je Teil mit den konkreten Werten (Schatten, Radien, Größen, Stärken), damit daraus Bauaufträge werden können.
- `index.html`, `runde2.html`, `tokens.css`, `zuordnung.md`, `src/`, `src2/` nicht ändern.
