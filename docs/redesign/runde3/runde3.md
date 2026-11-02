# Knorke Redesign, Runde 3: Notizen, Grundformen, Verbinder

Stand 01.11.2026. Gehört zu `runde3.html`; die Seite läuft ohne Internet.
- Oben wählt man Teil N, F, V oder D und darin eine Variante.
- Jede Variante lässt sich direkt verlinken (`runde3.html#N2`, `#F4`, `#V6`, `#D`).
- Die Tasten ← → blättern.

Alle Leinwand-Ausschnitte sind mit Canvas 2D gezeichnet, nur mit dem, was Konva kann: Rechtecke mit Radius, Pfade, Kreise, Linien mit Strichmuster, Text in Arial, Deckkraft, Schatten. Schatten und Verbinder-Beschriftungen fallen unter 30 % Zoom weg, wie heute; keine Variante ändert diese Regel.

Gebaut wird mit `node src3/build.mjs` aus `src3/`. `index.html`, `runde2.html`, `tokens.css`, `zuordnung.md`, `src/` und `src2/` sind nicht verändert.

## Teil N: Notizen

**Was flach oder lebendig wirkt:**
- ein einzelner, harter Schatten wirkt aufgeklebt; zwei Schatten (nah und fern) wirken wie Papier, das leicht absteht;
- eine feine Kante grenzt helle Notizen ab;
- mehr Luft um den Text macht ihn ruhiger;
- kleine Merkmale echter Haftzettel geben Charakter, kosten aber Ruhe.

**N0 heute.** Ein Schatten (0/2/8, 12 %), Ecken 6, Text mittig, Zeilenabstand 1,2, Innenabstand 16.
- Für: sauber, nichts zu bauen.
- Wider: flach. Weiße Notizen verschwinden fast auf der Leinwand, unter 30 % fehlt jede Abgrenzung.

**N1 Papier.** Zwei Schatten: nah 0/1/2 mit 10 %, fern 0/6/16 mit 10 %. Text mit Zeilenabstand 1,25 und Innenabstand 18.
- Für: deutlich weniger flach, dabei ruhig.
- Wider: unter 30 % sieht sie aus wie heute.
- Die Werte aus `tokens.css` (0/1/2 10 % + 0/3/8 8 %) sind zu schwach. Der ferne Schatten ist dort kaum zu sehen (Vergleich in `#N1`).
- Bauen: Konva kennt einen Schatten je Form. Der zweite braucht eine zweite Fläche unter der Notiz, also einen Knoten mehr je Notiz.
- Bestehende Boards: alle Notizen bekommen den neuen Schatten. Gespeicherte Werte ändern sich nicht.

**N2 Haftzettel.** Wie N1, dazu ein Merkmal echter Haftnotizen. Drei getrennt zum Auswählen:
- **N2a** die unteren Ecken heben sich (zwei kleine Flächen unter der Notiz, nur ihr Schatten ist zu sehen);
- **N2b** ein angedeuteter Klebestreifen oben im kräftigen Ton mit 22 % Deckkraft;
- **N2c** ein Eselsohr unten rechts.

Für und wider:
- Für: am meisten „Papier“.
- Wider: viele Notizen dicht nebeneinander werden unruhig. N2b und N2c sehen bei gedrehten und überlappenden Notizen schnell verspielt aus. Das Eselsohr nimmt dem Text und den Tags eine Ecke.

Bauen:
- N2a: zwei Knoten je Notiz.
- N2b: ein Rechteck.
- N2c: ein anderer Umriss plus Dreieck.

Bestehende Boards: alle Notizen bekommen das Merkmal.

**N3 Rand statt Schatten.** Eine feine Kante (1,5) im kräftigen Ton derselben Farbe mit 35 % Deckkraft, dazu fast kein Schatten (0/1/1, 6 %).
- Für: ruhig und modern, weiße Notizen sind klar abgegrenzt, auch bei 25 %.
- Wider: wirkt eher wie eine Karte. Gegen „flach“ hilft es nicht.
- Bauen: nur ein Rand, am billigsten.

**N4 Vorschlag: Papier mit feiner Kante.** Der Papier-Schatten aus N1 etwas leiser (0/1/2 10 % + 0/5/14 9 %), dazu eine sehr feine Kante: 1 Einheit, kräftiger Ton mit 18 %; bei Weiß der kräftige Ton von Grau.
- Für: Die Kante hilft genau dort, wo der Schatten nicht hilft: weiße Notizen, dichte Gruppen und Zoom unter 30 %.
- Wider: ein Merkmal mehr als N1.
- Bauen: wie N1 plus ein Rand.

**Text.** Alle neuen Varianten nutzen Zeilenabstand 1,25 und Innenabstand 18. Die Seite zeigt kurz, drei Zeilen, sehr lang (wird kleiner) und „Datenschutzgrundverordnung“ (wird ab 16 getrennt), jeweils **mittig** und **oben links**.

Empfehlung: mittig lassen.
- Kurze Zettel lesen sich mittig wie Haftnotizen.
- Oben links hilft erst bei langen Texten.
- Eine Umstellung gälte für alle bestehenden Notizen.

Gewicht normal lassen; halbfett macht lange Texte schwer.

**Grundgröße.** 200 bleibt. Mit 180 werden drei Zeilen in M (22) eng, und lange Wörter werden früher klein und getrennt. 180 aus Runde 1 bitte nicht umsetzen.

## Teil F: Grundformen

**Was plump oder fein wirkt:**
- ein schwarzer Rand wirkt hart; Dunkelgrau mit derselben Stärke wirkt feiner;
- spitze Ecken wirken technisch, eine kleine Rundung (4) freundlich;
- 200 × 120 staucht Raute und Ellipse;
- Textfelder in Raute und Dreieck sind heute zu klein.

**F0 heute.** Schwarzer Rand 2, weiß, spitze Ecken, alle 200 × 120, Textfeld-Anteile wie in UEBERGABE-3, Innenabstand 8.
- Für: klar.
- Wider: hart, gestauchte Raute, wenig Text in Raute und Dreieck.

**F1 weicher Rand.** Rand #3d4044 (wie Verbinder) statt Schwarz. Alle Ecken Radius 4, auch Raute, Dreieck und Pfeil. Abgerundetes Rechteck mit festem Radius 16 statt 15 %.
- Für: deutlich feiner bei gleicher Stärke 2.
- Wider: kaum etwas.
- Bauen: Radius an Polygonen (arcTo/lineJoin round). Klein.
- Bestehende Boards: Formen mit Standard-Rand bekommen Dunkelgrau, und die Ecken werden für alle weicher. Ein bewusst gewähltes Schwarz bleibt Schwarz.
- Hinweis an die Factory: Der Standard-Rand muss als „Standard“ gespeichert sein, nicht als #191b1d; sonst ist Schwarz nicht von „nie gewählt“ zu unterscheiden. Ist das nicht so, bleiben bestehende Formen schwarz, und nur neue Formen bekommen Dunkelgrau.

**F2 farbig gefüllt.** Neue Formen bekommen einen hellen Ton als Fläche und den kräftigen Ton derselben Farbe als Rand (Ton-in-Ton, im Beispiel Indigo).
- Für: lebendig.
- Wider: Bunte Flussdiagramme werden unruhig und sehen Notizen zu ähnlich.
- Nur neue Formen.

**F3 leichter Schatten.** Wie heute plus 0/1/4 mit 10 %.
- Für: Formen lösen sich von der Leinwand.
- Wider: Rand und Schatten zugleich wirken doppelt. Formen und Notizen sehen sich ähnlicher, beide „liegen auf“.
- Bestehende Boards ändern sich.

**F4 Vorschlag: weich, Ton-in-Ton, bessere Maße.** F1 plus vier Regeln:
1. **Weiß bleibt Standard.** Wer eine Farbe wählt, bekommt den kräftigen Ton derselben Farbe als Rand (Ton-in-Ton).
2. **Neue Grundgrößen** (siehe unten).
3. **Textfelder, die zur neuen Größe passen:** Raute 58 × 38 % der Form, Dreieck ab 60 % der Höhe nach unten und 58 % breit, Ellipse 84 × 54 %. Innenabstand dort 4 (Raute, Dreieck) bzw. 8 (Ellipse), weil die Ecken des Felds schon innen an der Kontur liegen; bei Rechteck, Pfeil, Dokument 12. Damit fassen Raute und Dreieck bei gleicher Schriftgröße mindestens so viel wie heute:

   | Textfläche (Einheiten) | heute (200 × 120) | neu |
   |---|---|---|
   | Raute | 84 × 44 | 84,8 × 52,8 (160 × 160) |
   | Dreieck | 84 × 44 | 84,8 × 48 (160 × 140) |
   | Ellipse | 126 × 69 | 118 × 70 (160 × 160): gleich hoch, etwa 6 % schmaler |
   | Raute im Board (Teil D) | 79 × 41 (190 × 114) | 79 × 49 (150 × 150) |

   Die Ellipse fasst als Kreis etwas weniger breite Zeilen; wer viel Text in eine Ellipse schreibt, zieht sie breiter.
4. **Kein Schatten.** Der bleibt das Merkmal der Notizen.

Bestehende Boards: nur Ecken, Textfeld und gegebenenfalls die Randfarbe wie bei F1. Größen und Farben sind gespeichert und bleiben.

**Proportionen, Vorschlag je Form beim Klick:**
- Rechteck 200 × 120 und abgerundetes Rechteck 200 × 120: wie heute, gut für zwei Zeilen;
- Ellipse 160 × 160: wird zum Kreis, liest sich als „Start/Ende“ oder „Idee“ statt gestaucht;
- Raute 160 × 160: nicht mehr flach gedrückt, mit dem neuen Textfeld passen „Bezahlt?“ oder zwei kurze Zeilen;
- Dreieck 160 × 140: fast gleichseitig;
- Pfeil 200 × 100: schlanker, der Schaft bleibt groß genug für ein Wort.

**Text.** In `#F0` und `#F4` ist das Textfeld gestrichelt eingezeichnet. Die Kachel zeichnet „Bestellung prüfen und Kunden informieren“ mit fester Schrift 16, ohne Verkleinern; was nicht passt, endet mit „…“. So sieht man direkt, dass Raute und Dreieck neu mindestens gleich viel fassen. Standardgröße 20 (Auto) bleibt.

**Flussdiagramm.** Prozess, Entscheidung, Dokument und Datenbank übernehmen dieselben Regeln (Randfarbe, Ecken, Ton-in-Ton, Innenabstand), siehe die Kachel in jeder F-Variante. BPMN bleibt außen vor.

## Teil V: Verbinder

**Was grob oder fein wirkt:**
- spitze Knicke wirken hart;
- eine Pfeilspitze, die mit der Stärke mitwächst, wird bei 8 und 12 riesig;
- ein offener Winkel liest sich dünn schwächer als ein gefülltes Dreieck;
- ein Beschriftungs-Fleck in Leinwandfarbe sieht über farbigen Flächen wie ein Loch aus.

**V0 heute.** Eckig mit spitzen Knicken, #3d4044, Stärke 2, offener Winkel (Größe 3 × Stärke + 4), Linie direkt auf der Kante, Beschriftung 16 auf Leinwandfarbe.

**V1 runde Knicke.** Radius 12, höchstens die Hälfte des kürzeren Stücks.
- Für: weicher, besser zu verfolgen.
- Wider: bei sehr kurzen Stücken kaum Unterschied.
- Bauen: arcTo statt lineTo.
- Bestehende Boards: alle eckigen Verbinder werden rund.

**V2 feinere Spitzen.** Länge 6 + 4 × √Stärke, Breite 0,36 × Länge.

| Stärke | 1 | 2 | 4 | 8 | 12 |
|---|---|---|---|---|---|
| heute | 7 | 10 | 16 | 28 | 40 |
| neu | 10 | 11,7 | 14 | 17,3 | 19,9 |

- Neues Standard-Ende für neue Verbinder: gefülltes Dreieck.
- Für: Dicke Linien bekommen keine riesigen Spitzen mehr, dünne Linien zeigen die Richtung klarer.
- Wider: Dünne Linien bekommen etwas größere Spitzen als heute.
- Bestehende Boards: Spitzen ändern ihre Größe, das gewählte Ende bleibt.

**V3 Abstand zur Form.** Die Linie endet 6 vor der Kante.
- Für: luftig.
- Wider: Verbinder wirken lose, als gehörten sie nicht zur Form. Der Mittelweg „Anfang 6, Spitze berührt“ ist besser, aber selten nötig.
- Empfehlung: nicht übernehmen.

**V4 Beschriftung.** Fünf Arten im Vergleich: heute, Plakette, über der Linie, klein 14, groß 18. Über einem gelben Frame ist der Leinwand-Fleck falsch.
- Richtig wäre die Farbe dessen, was darunter liegt. Das verlangt eine Abfrage beim Zeichnen und scheitert an Mustern und überlappenden Flächen.
- Die **Plakette** passt überall: weiß, Rand #191b1d mit 28 %, Radius halbe Höhe (höchstens 12), Text 15, Innenabstand 5.
- „Über der Linie“ braucht keinen Hintergrund, kollidiert aber bei senkrechten Stücken und kurzen Linien.
- Bestehende Boards: alle Beschriftungen bekommen die Plakette.

**V5 Kurven.** Griffe 60 % des Abstands (mindestens 60) statt 40 % (mindestens 40), oder eine S-Kurve.
- 60 % wirkt runder und großzügiger.
- Die S-Kurve ist schön bei versetzten Formen nebeneinander, bei Formen übereinander aber ungewohnt.
- Bestehende Boards: alle gebogenen Verbinder ändern die Form leicht.

**V6 Vorschlag.** V1 + V2 + V4 + V5 zusammen: Knicke Radius 10, feine Spitzen, gefülltes Dreieck als Standard, Plakette 15, Kurven 60 %.
- Unverändert bleiben Farbe #3d4044, Stärke 2 und das Andocken direkt auf der Kante.
- Eine Standardstärke 1,5 schlage ich nicht vor: Sie wäre ein neuer gespeicherter Wert neben 1, 2, 4, 8 und 12.

## Teil D: Zusammen

Die Seite zeigt ein Retro-Board mit Frame-Reiter A2, fünf Notizen und einem kleinen Flussdiagramm mit beschrifteten Verbindern, einmal heute (N0, F0, V0) und einmal mit N4, F4 und V6.

Die Kombination passt zusammen, weil alle drei dieselbe Sprache sprechen:
- kleine, weiche Rundungen;
- Dunkelgrau statt Schwarz;
- Farbe nur Ton-in-Ton;
- Schatten nur bei Notizen, so sieht man sofort, was Zettel und was Diagramm ist.

## Empfehlung mit Werten (für Bauaufträge)

### Notizen: N4

| Eigenschaft | Wert |
|---|---|
| Größe neu | 200 × 200, wie heute. 180 nicht umsetzen. |
| Ecken | Radius 6 |
| Schatten nah | x 0, y 1, Weichheit 2, Schwarz 10 % |
| Schatten fern | x 0, y 5, Weichheit 14, Schwarz 9 %, als zweite Fläche unter der Notiz |
| Kante | 1 Einheit, kräftiger Ton der Notizfarbe mit 18 % Deckkraft; bei Weiß Grau kräftig (#6f6f6d) mit 18 %; bei Schwarz keine Kante |
| Unter 30 % Zoom | Schatten aus wie heute, Kante bleibt |
| Text | Arial, normal, Zeilenabstand 1,25 (heute 1,2), Innenabstand 18 (heute 16), weiter mittig; Größen Auto/S 16/M 22/L 32 und Trennung ab 16 unverändert |
| Tags | unverändert; Textfläche verliert weiter unten 30 |

### Grundformen: F4

| Eigenschaft | Wert |
|---|---|
| Randfarbe Standard | #3d4044 statt #191b1d, Stärke 2 |
| Rand bei gewählter Füllfarbe | kräftiger Ton derselben Farbe (Ton-in-Ton), sobald man die Füllung wählt; danach frei änderbar |
| Füllung neu | Weiß, wie heute |
| Ecken | Rechteck, Raute, Dreieck, Pfeil, Prozess, Dokument: Radius 4 (lineJoin round); abgerundetes Rechteck: Radius 16 fest |
| Größe beim Klick | Rechteck 200 × 120, abgerundetes Rechteck 200 × 120, Ellipse 160 × 160, Raute 160 × 160, Dreieck 160 × 140, Pfeil 200 × 100 |
| Textfeld | Raute 58 % breit × 38 % hoch, mittig; Dreieck: Oberkante bei 60 % der Höhe bis unten, 58 % breit, mittig; Ellipse 84 % × 54 %, mittig; Rechteck ganz, Pfeil der Schaft wie heute |
| Innenabstand | Rechteck, abgerundetes Rechteck, Pfeil, Prozess, Dokument, Datenbank 12; Ellipse 8; Raute und Dreieck 4 (heute überall 8) |
| Textgröße | Auto, Standard 20, Zeilenabstand 1,2 |
| Schatten | keiner |
| Flussdiagramm | dieselben Regeln für Rand, Ecken und Innenabstand |

### Verbinder: V6

| Eigenschaft | Wert |
|---|---|
| Route neu | eckig, wie heute |
| Knicke | Radius 10, höchstens die Hälfte des kürzeren angrenzenden Stücks |
| Farbe, Stärke | #3d4044, 2, wie heute |
| Pfeilende neu | gefülltes Dreieck |
| Spitzengröße | Länge 6 + 4 × √Stärke, Breite 0,36 × Länge (1 → 10, 2 → 11,7, 4 → 14, 8 → 17,3, 12 → 19,9); gilt für alle sieben Enden; die Linie endet an der Basis gefüllter Enden |
| Kurve | Griffe senkrecht aus der Kante, 60 % des Abstands, mindestens 60 |
| Andocken | direkt auf der Kante, wie heute |
| Beschriftung | Plakette: Fläche Weiß, Rand #191b1d mit 28 % (1 px), Radius halbe Höhe (höchstens 12), Arial 15, Innenabstand 5, höchstens 240 breit, auf halber Länge |
| Unter 30 % Zoom | Beschriftung aus, wie heute |

### Was bestehende Boards merken

- **Notizen:** Schatten und Kante ändern sich bei allen Notizen.
- **Formen:** Ecken, Textfeld und Innenabstand ändern sich bei allen Formen, der Standard-Rand nur, wenn er als „Standard“ gespeichert ist.
- **Verbinder:** Knicke, Spitzengröße, Kurvenspannung und Beschriftung ändern sich bei allen Verbindern.
- **Unverändert:** gespeicherte Farben, Größen, Stärken, Enden und Routen. Neue Grundwerte (Formgrößen, gefülltes Dreieck) gelten nur für neue Objekte.
