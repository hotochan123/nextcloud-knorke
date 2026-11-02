# Knorke Redesign, Runde 4: Notizblock, Frames, Swimlanes, Tabellen, Diagramme

Stand 01.11.2026. Gehört zu `runde4.html`; die Seite läuft ohne Internet.

**Bedienung:**
- Oben wählt man den Teil: B Notizblock, R Frames, S Swimlanes, T Tabellen, M Mindmaps, O Organigramm/Baum, D Zusammen.
- Darin wählt man die Übersicht oder eine Variante; jede Variante zeigt ihr Kürzel groß.
- Links wie `runde4.html#S2`, `#B4` oder `#D` öffnen eine Variante direkt, die Tasten ← → blättern.

**Zeichnung:**
- Alles ist mit Canvas 2D gezeichnet, nur mit Konva-Mitteln: Rechtecke mit Radius, Pfade, Kreise, Strichmuster, Text in Arial, Deckkraft, Schatten, Clip.
- Notizen (N4 mit Eselsohr), Formen (F4) und Verbinder (V6) stehen in jeder Kachel schon so, wie in Runde 3 entschieden.

Gebaut wird mit `node src4/build.mjs` aus `src4/`. Die Leinwand-Bausteine sind eine Kopie von `src3/scene.js`. Frühere Runden (`index.html`, `runde2.html`, `runde3.html`, `tokens.css`, `zuordnung.md`, `src/`, `src2/`, `src3/`) sind nicht verändert.

**Prüfung der gerenderten Seite:** In dieser Umgebung gibt es keinen Browser. Geprüft habe ich deshalb mit einer Canvas-Nachbildung, die jede Zeichenoperation mit den echten Koordinaten, Verschiebungen, Zooms und Ausschnitten (Clip) nachrechnet. Ergebnis:
- Alle 33 Ansichten und 268 Kachel-Felder sind geprüft.
- **Nichts ragt über einen Kachelrand.** Ausnahme sind die als „Ausschnitt“ beschrifteten Zoom-Felder, die absichtlich nur einen Teil zeigen. Die Prüfung lief auch mit absichtlich zu breit geschätzter Schrift (fett).
- Jedes Feld zeigt sichtbaren Inhalt, auch alle Zoom-Felder 25 %, 100 % und 200 %.
- Jede Variante trägt ihr großes Kürzel und steht im Umschalter.
- Alle 33 Deep-Links (`#B`, `#B0` … `#O2`, `#D`) öffnen die richtige Ansicht.

Pixelgenau gesehen habe ich die Seite nicht. Einen Blick in Chromium und Safari solltest du deshalb noch werfen.

## Teil B: Notizblock

Was den Block vom Zettel unterscheidet: Blätter dahinter als Stapelkante, eine Bindung oben, ein klarer Griff. **Kein Eselsohr am Block.** Ich stimme deinem Vorschlag zu: Das Eselsohr bleibt das Zeichen des abgerissenen Zettels, so sieht man den Unterschied auf einen Blick.

**B0 heute.** Zwei Blätter dahinter (je 4 nach rechts unten) mit harter schwarzer Kante (35 %), kein Schatten, grauer Titel-Streifen darunter.
- Wider: Neben N4-Notizen wirkt der Block wie ein umrandeter Zettel, der graue Streifen fremd.
- Griff: Verschieben am Streifen, Abreißen am Blatt.

**B1 Stapel im Look N4.** Vier Blätter, je 3 nach unten versetzt, mit der feinen N4-Kante (kräftiger Ton 18 %). Den weichen N4-Schatten hat nur das unterste Blatt.
- Für: Die Stapelkante liest sich als Block.
- Wider: Der graue Streifen bleibt.
- Bauen: vier statt zwei Rechtecke.

**B2 Bindung oben.** Leimbindung 30 hoch im Reiter-Ton der Blockfarbe (wie Frames A2), Titel fett 15 darauf, drei Blätter, kein Streifen.
- Für: sieht sofort wie ein Haftnotizblock aus.
- Bauen: ein Rechteck und eine Linie.
- Griff: Verschieben an der Bindung, Abreißen am Blatt darunter.

**B3 Reiter wie Frames.** Titel im Reiter über dem Block (Reiter-Ton, fett 18).
- Für: einheitlich mit Frames.
- Wider: Der Block sieht aus wie ein kleiner Frame. Ohne Titel gibt es keinen Reiter und damit keinen klaren Griff.

**B4 Vorschlag: Bindung mit Abreißkante.** Bindung 36 hoch (mit Finger und Stift gut zu treffen), Titel fett 16, darunter eine gestrichelte Abreißkante, vier Blätter als Stapelkante.
- Für: Griff (Bindung) und Abreißen (unter der Kante) sind sichtbar getrennt, auch ohne Titel.
- Bauen: zwei Rechtecke, zwei Linien.

## Teil R: Frames

**Wichtig vorab:** Ein Rand im Reiter-Ton (R1) löst den Kontrast-Mangel nicht, er verschärft ihn. Gegen die Leinwand erreichen die Reiter-Töne nur 1,4 bis 2,3 : 1, der Rand von heute 5 : 1. Was trägt, ist der **kräftige** Ton derselben Farbe: gegen die Leinwand mindestens 4,5 : 1.

| Fläche | Rand heute #67686a gegen Fläche | Reiter-Ton gegen Leinwand | kräftiger Ton gegen Leinwand / gegen Fläche |
|---|---|---|---|
| Weiß | 5,58 | 1,37 | #6f6f6d 4,50 / 5,04 |
| Gelb | 4,57 | 1,41 | #7e6f01 4,51 / 4,13 |
| Hellblau | 3,69 | 1,83 | #0275a9 4,56 / 3,37 |
| Salbei | 4,01 | 1,65 | #307d37 4,56 / 3,67 |
| Koralle | 3,07 | 2,26 | #c43e45 4,55 / 2,80 |

**R0 heute.** Rand #67686a 1,5 px, Ecken 6, volle Fläche, Reiter A2.
- Für: klar.
- Wider: Das Grau wirkt auf farbigen Flächen fremd.

**R1 Ton-in-Ton-Rand (Reiter-Ton).**
- Für: weich und einheitlich.
- Wider: weiße Frames verlieren fast ihren Rand (siehe oben).
- Bauen: nur eine Farbe.

**R2 Fläche leiser.** Farbige Flächen als 50 % des hellen Tons auf der Leinwand, Reiter kräftig.
- Für: Notizen derselben Farbe heben sich ab, alles darauf steht ruhiger.
- Wider: Die Flächen werden blass, Gelb und Sand liegen nahe beieinander.
- Bauen: nur Farben.

**R3 ohne Rand.** Nur Fläche, Reiter und ein leiser Schatten (0/1/4, 10 %).
- Für: Farbige Frames wirken modern.
- Wider: Ein weißer Frame hat auf #f3f2f0 nur 1,1 : 1. Er ist fast nur am Schatten zu sehen, unter 30 % (ohne Schatten) gar nicht.

**R4 Vorschlag.** Rand 1,5 px im kräftigen Ton der Fläche (Weiß und Grau #6f6f6d), Ecken 8: eine Stufe weicher als Notizen (6) und Formen (4), weil Frames Behälter sind.

Ausgewählt, vier Lösungen in `#R4`:
1. heute;
2. Umriss folgt Frame und Reiter;
3. runde Griffe, auch an den Seitenmitten;
4. **Empfehlung:** Umriss folgt Frame und Reiter (4 px außen, Radius 8 + 4), runde Griffe 12 px (Stift 16 px) nur an den Ecken, Reiter mit 22 % Auswahlfarbe getönt. So ist klar, dass der Reiter dazugehört und der Griff zum Verschieben ist.

## Teil S: Swimlanes

Was streng wirkt: viele gleich starke Linien, gedrehte Schrift, graue Köpfe. Das sieht aus wie eine Tabelle.

**S0 heute.** Kopfspalte 48, Schwarz 5 %, Namen fett 20 um −90° gedreht, alle Trenner wie der Rand.

**S1 farbige Köpfe.** Köpfe im Reiter-Ton. Variante S1b: je Bahn ein eigener heller Ton.
- Für: Kopf und Reiter gehören sichtbar zusammen. S1b unterscheidet Bahnen gut.
- Wider: S1b wird bunt und beißt sich mit Notizfarben.

**S2 weniger Linien.** Trenner fein gestrichelt (1 px, 50 %), Bahnen im Wechsel leicht getönt, kein Trenner an den Köpfen.
- Für: viel ruhiger.
- Wider: Bei 25 % sind die Grenzen kaum zu sehen.

**S3 Köpfe als Plaketten.** Keine Kopfspalte; der Name steht waagrecht als Plakette oben links in der Bahn.
- Für: gut lesbar.
- Wider: Die Plakette liegt im Inhalt, lange Namen werden abgeschnitten.

**S4 Vorschlag.** Kopfspalte 140 breit, Reiter-Ton zu 45 % über der Fläche, **waagrechte** Namen fett 16 (mit Umbruch, oben links). Trenner nur zwischen Bahnen und Spalten, 1 px im etwas dunkleren Reiter-Ton; keine Linie an den Köpfen, die Fläche trennt. Gruppen 75 % Reiter-Ton. Rahmen wie R4. „+“-Knöpfe 24 px.
- Gedrehte Schrift: Waagrecht ist leichter zu lesen und braucht kein Kopfdrehen. Dafür kostet sie 92 Breite mehr. Das lohnt sich, weil Swimlanes meist breit sind.
- Die leere Ecke oben links trägt dieselbe Kopffläche ohne Text.
- Bauen: nur andere Maße und Farben.

## Teil T: Tabellen

**Tabelle und Swimlane unterscheiden:** Die Tabelle hat weiße Zellen mit Gitter und eine getönte Kopfzeile oben. Die Swimlane hat eine getönte Kopfspalte links, keine Zellen und Bahnen über die ganze Breite. Beide teilen Radius und Ton-in-Ton-Regel, sehen aber nicht gleich aus (Paar in der Übersicht).

**T0 heute.** Gleich starkes Gitter #c6cacf, spitze Ecken, Kopf #eef1f5.
- Wider: hart, wie aus einem anderen Programm.

**T1 weicher.** Außen Ecken 6, inneres Gitter heller, Kopf mit Farbe im hellen Ton.
- Für: freundlich, ohne an Klarheit zu verlieren.

**T2 nur waagrechte Linien.** Kein Außenrand, Kopf fett über einer kräftigen Linie.
- Für: modern.
- Wider: Bei schmalen Spalten verrutscht das Auge, auf Frames fehlt die Kante.

**T3 Vorschlag.** Ecken 6, Außenrand 1,5 px #a9adb2, waagrechte Linien deutlicher als senkrechte, Kopf getönt.
- Die Zelle im Bearbeiten bekommt zusätzlich 8 % Auswahlfarbe.
- Eine Kopfspalte als Schalter (erste Spalte fett und getönt).
- „+“-Knöpfe 24 px.

## Teil M: Mindmaps

**M0 heute.** Alles als „Linie“, Zentrum als Kasten mit schwarzem Rand.
- Wider: Ebenen heben sich kaum ab.

**M1 Knoten mit Charakter.** Zentrum als große Pille (Grau hell, fett 22), Hauptäste als Pille im hellen Ton der Astfarbe mit Rand.
- Für: Die Ebenen sind sofort lesbar.

**M2 Äste abgestuft.** Äste verjüngen sich, von etwa 6 am Zentrum bis 1,2 außen.
- Für: wirkt organisch.
- Bauen: Jeder Ast ist ein gefüllter Pfad aus zwei versetzten Kurven (24 Stützpunkte) statt einer Linie. Mittlerer Aufwand, Konva kann das als Path oder sceneFunc.

**M3 Vorschlag.** Zentrum wie F4 (Radius 16, Rand #3d4044), Hauptäste als Pille im hellen Ton ohne Rand, verjüngte Äste, tiefere Ebenen als „Linie“.
- Zugeklappt: Plakette „+3“ in der Astfarbe statt eines 7er-Punkts, mit dem Finger zu treffen.

## Teil O: Organigramm und Baum

**O0 heute.** Bunte Ränder und Linien in Elternfarbe, spitze Knicke.
- Wider: laut.

**O1 Karten im Look F4.** Rand #3d4044, Farbband oben als einzige Farbe, Linien #3d4044 mit runden Knicken (10) wie V6.
- Für: ruhig, passt zu Formen und Verbindern.
- Baum: Band links statt oben.

**O2 Vorschlag.** Karten im hellen Ton der Zweigfarbe ohne Rand, Initialen-Kreis, Rolle 14 in Grau, leise Linien.
- Für: freundlich.
- Wider: Die Karten sehen Notizen ähnlicher.

**Meine Empfehlung: O1.** Die graue Rolle aus O2 kann man als Feinschliff dazunehmen.

## Teil D: Zusammen

Das Board zeigt Swimlane mit Ablauf, Frame mit Notizen und Notizblock, Tabelle und Mindmap, einmal heute und einmal mit B4, R4, S4, T3 und M3.

Sie passen zusammen, weil überall dieselben Regeln gelten:
- Ränder und Köpfe im Ton der eigenen Farbe statt Grau;
- Ecken in drei Stufen: Formen 4, Notizen 6, Behälter 8;
- wenige, feine Linien;
- waagrechte Schrift;
- Schatten nur bei Notizen.

## Empfehlung mit Werten (für Bauaufträge)

Zoom-Regeln (§3.7) bleiben, wie sie sind. Unter 30 % fallen die Texte weg, Bindung, Köpfe, Gitter und Äste bleiben als Flächen und Linien; unter 9,5 % gelten die groben Ersatzzeichnungen.

### Notizblock: B4

| Eigenschaft | Wert |
|---|---|
| Größe | 200 × 200, Radius 6, wie eine Notiz |
| Bindung | 36 hoch über die volle Breite oben, im Block zugeschnitten (obere Ecken 6), Farbe = Reiter-Ton der Blockfarbe (Liste §3.3) |
| Linie unter der Bindung | 1 Einheit, kräftiger Ton mit 35 % (Weiß: #6f6f6d) |
| Abreißkante | 6 unter der Bindung, Strich [4, 4], 1 Einheit, kräftiger Ton mit 40 %, 8 Abstand zu den Seiten |
| Titel | auf der Bindung, Arial fett 16, links, Innenabstand 12, eine Zeile mit „…“; auf Schwarz weiß |
| Blätter dahinter | 4, je 0 nach rechts und 3 nach unten versetzt, Blockfarbe, Kante 1 Einheit im kräftigen Ton mit 18 % (Weiß: #6f6f6d) |
| Schatten | nur unter dem untersten Blatt, wie N4: 0/1/2 Schwarz 10 % und 0/5/14 Schwarz 9 % |
| Eselsohr | keins |
| Grauer Streifen | entfällt |
| Griffe | Verschieben und Auswählen an der Bindung; Abreißen auf dem Blatt unterhalb der Abreißkante |
| Ausgewählt | Umriss um das oberste Blatt samt Bindung, 4 Eckgriffe wie heute (10 px, Stift 14 px), Seitenverhältnis fest |

### Frames: R4

| Eigenschaft | Wert |
|---|---|
| Rand | 1,5 px (bleibt bei jedem Zoom gleich), kräftiger Ton der Fläche; Weiß und Grau #6f6f6d; Schwarz #191b1d |
| Ecken | Radius 8 (heute 6), auch die oberen Ecken des Reiters |
| Fläche | heller Ton wie heute, volle Deckkraft |
| Reiter | wie A2: 40 hoch, Titel Arial 22/600, Reiter-Töne laut §3.3 |
| Schatten | keiner |
| Ausgewählt: Umriss | 2 px Auswahlfarbe, folgt Frame und Reiter, 4 px außen, Radius 12 |
| Ausgewählt: Griffe | rund, weiß, Rand 2 px Auswahlfarbe, 12 px (Stift/Finger 16 px), nur an den 4 Ecken |
| Ausgewählt: Reiter | Reiter-Ton mit 22 % Auswahlfarbe gemischt |
| Ohne Titel, ausgewählt | gestrichelter Reiter wie heute (#646d77, 1,5 px, [5,4]), Radius 8 |

### Swimlanes: S4

| Eigenschaft | Wert |
|---|---|
| Rahmen, Reiter | wie R4 |
| Kopfspalte | 140 breit (höchstens die halbe Breite); Fläche = Reiter-Ton zu 45 % über der Frame-Fläche |
| Bahngruppen | Zelle links, 120 breit, Reiter-Ton zu 75 %; Name fett 14, waagrecht |
| Spaltenköpfe | 56 hoch, Fläche wie Kopfspalte; Namen fett 16, links, Innenabstand 12, mit Umbruch |
| Spaltengruppen | 44 hoch, Reiter-Ton zu 75 %, Name fett 14, links |
| Bahnnamen | waagrecht, Arial fett 16, oben links, Innenabstand 12, Umbruch, höchstens 90 hoch, kleiner bis 12, dann „…“ |
| Leere Ecke | Kopffläche, kein Text |
| Trenner Bahnen | 1 px (bleibt gleich), Reiter-Ton zu 85 % mit Schwarz gemischt, über die volle Breite (innerhalb einer Bahngruppe erst rechts der Gruppenzelle) |
| Trenner Spalten | wie Bahnen, 70 % Deckkraft |
| Trenner Köpfe | keine (die Fläche trennt) |
| „+“-Knöpfe | Kreis 24 px Auswahlfarbe, weißer Rand 2 px, weißes Plus; 36 px außerhalb; „+ Bahn“ unter der Mitte mit Text, „+ Spalte“ rechts der Mitte |
| Neu | 1200 × 600, 3 Bahnen je 200, ohne Spalten, wie heute |

### Tabellen: T3

| Eigenschaft | Wert |
|---|---|
| Ecken | Radius 6 außen (Inhalt zugeschnitten) |
| Außenrand | 1,5 px (bleibt gleich) #a9adb2 |
| Waagrechte Linien | 1 Einheit #d5d8dc |
| Senkrechte Linien | 1 Einheit #e9ebee |
| Kopfzeile | fett 16, Fläche #eef1f5 oder heller Ton der gewählten Farbe |
| Kopfspalte | neuer Schalter, aus; an: erste Spalte fett und mit Kopffläche |
| Zellen | Weiß, Text Arial 16 oben links, Innenabstand 8, Zeilen mindestens 36 |
| Zelle im Bearbeiten | 2 px Rand Auswahlfarbe innen und Fläche 8 % Auswahlfarbe |
| „+“-Knöpfe | 24 px wie bei S4, 36 px außerhalb: „+ Spalte“ rechts, „+ Zeile“ unten |

### Mindmaps: M3

| Eigenschaft | Wert |
|---|---|
| Zentrum | abgerundetes Rechteck Radius 16, Weiß, Rand 2 #3d4044, Arial fett 20, Innenabstand 16 × 12, mindestens 120 breit, Umbruch bei 280 |
| Hauptäste (Ebene 1) | Pille (Radius halbe Höhe), heller Ton der Astfarbe, kein Rand, Arial fett 16, Innenabstand 12 × 8 |
| Tiefere Ebenen | „Linie“ wie heute: Text normal 16 über Unterstrich 2 in der Astfarbe, Innenabstand 6 × 4 |
| Kasten-Knoten | wählbar wie heute (Rechteck, abgerundet 8, Pille), Rand 2 in Astfarbe |
| Äste | gefüllter, sich verjüngender Pfad: Zentrum → Hauptast 6,4 → 3,2; Ebene 2: 3,6 → 1,6; Ebene 3: 1,8 → 1,2; S-Form wie heute; Ende rund |
| Astfarben, Abstände | wie heute (10 kräftige Töne; 40 / 10 / 20) |
| Zugeklappt | Plakette „+n“: Höhe 20, Radius 10, Astfarbe, Arial fett 12 weiß, 12 neben dem Knoten |
| Aufgeklappt | hohler Punkt wie heute, nur bei Auswahl oder Zeiger |
| „+“-Knöpfe | 24 px wie S4 |

### Organigramm und Baum: O1

| Eigenschaft | Wert |
|---|---|
| Karte | abgerundetes Rechteck Radius 8, Weiß, Rand 2 #3d4044 |
| Farbband | 6 hoch oben (Baum: 6 breit links), in der Zweigfarbe; Zentrum #191b1d |
| Text | Name fett 16, Rolle normal 16 (optional aus O2: Rolle 14 #5c5f63), mittig, Innenabstand 12 × 8, Umbruch bei 200, mindestens 120 breit |
| Linien | #3d4044, 2, rechtwinklig wie heute, Knicke Radius 10, runde Verbindung |
| Abstände | Geschwister 20, Reihen 40; Baum: Ebenen 250 auseinander, 20 nach rechts, senkrecht, zur Kante |
| Zugeklappt | Plakette „+n“ unter der Karte (wie M3) |
