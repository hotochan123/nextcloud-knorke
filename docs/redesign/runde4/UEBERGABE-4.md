# Knorke Redesign, Runde 4: Notizblock, Frames, Swimlanes, Tabellen und Diagramme

Stand 01.11.2026. Runde 1 (`UEBERGABE.md`, `index.html`, `tokens.css`, `zuordnung.md`), Runde 2 (`UEBERGABE-2.md`, `runde2.html`, `runde2.md`) und Runde 3 (`UEBERGABE-3.md`, `runde3.html`, `runde3.md`) sind fertig. Runde 1 und 2 sind gebaut. Runde 3 ist entschieden und wird gerade gebaut (Werte unten in §3). Diese Runde baut auf allen dreien auf und ändert nichts an ihnen. Diesmal sind die **großen Dinge auf der Leinwand** dran: Notizblock, Frames, Swimlanes, Tabellen, Mindmaps und Organigramm/Baum.

## 1. Worum es geht

Die Person hat angekreuzt, was sie stört:

- **Notizblock:** wirkt wie eine Notiz (kaum vom abgerissenen Zettel zu unterscheiden); der graue Titel-Streifen; die Blätter dahinter.
- **Frames:** Rand und Fläche; wie ein ausgewählter Frame mit seinen Griffen aussieht. Der Reiter aus Runde 2 (A2) bleibt.
- **Swimlanes:** die Köpfe; die Linien und Trenner; wirkt wie eine Tabelle, zu technisch und streng.
- **Diagramme:** Mindmaps, Organigramm und Baum, Tabellen.
- Bei allen zusätzlich: **freie Hand**, eigene Vorschläge sind erwünscht.

Die Person ist keine Designerin und keine Entwicklerin. Sie entscheidet, indem sie auf Varianten zeigt. Zeig deshalb **Varianten nebeneinander**, jede mit einem Kürzel (B1, R1, S1, T1, M1, O1 …), und sag in einfachen Worten, worin sie sich unterscheiden und *was* etwas streng oder freundlich, laut oder ruhig wirken lässt. Paare „heute / anders“ helfen.

Alles soll mit Runde 3 zusammenpassen: Auf Frames und in Swimlanes liegen Notizen (N4 mit Eselsohr), Formen (F4) und Verbinder (V6). Zeichne diese Objekte in jeder Kachel schon im Look von Runde 3, nicht im heutigen.

**Knorke ist noch nicht produktiv.** Bestehende Boards sind egal: Jede Variante darf für alle Objekte gelten, auch für schon gespeicherte. Gespeicherte Werte müssen nur weiter ohne Fehler laden. Unterscheide also nicht zwischen „nur neue Objekte“ und „auch bestehende“.

## 2. Fester Rahmen

- Knorke ist ein Whiteboard in Nextcloud, die Leinwand zeichnet **Konva (Canvas 2D)**. Erlaubt: Rechtecke mit gerundeten Ecken, Pfade, Kreise, Linien mit Strichmustern, Text, flache Farbflächen, Deckkraft, weiche Schatten (wie die Notiz in Runde 3), Ausschneiden (Clip). Keine Bilder oder Texturen aus Dateien, keine Filter, keine Verläufe als Füllung. Zusatzformen (Bindung, Klebekante, Reiter) sind möglich; sag, was sie beim Bauen kosten.
- **Die Leinwand bleibt bei Arial.** Größe, Gewicht, Zeilenabstand und Innenabstand dürfen sich ändern.
- **Die Palette ist fest:** 13 Farben hell/kräftig, siehe `UEBERGABE-3.md` §3 und `tokens.css` Teil 2. Dazu gibt es die Reiter-Töne der Frames aus Runde 2 (unten). Ein Rand, Kopf oder Schatten darf aus einem Ton abgeleitet werden (z. B. kräftiger Ton mit Deckkraft), wenn du die Regel nennst.
- Alles wächst mit dem Zoom. Es muss bei **25 %** noch erkennbar und bei **200 %** nicht klobig sein. „Einheiten“ wachsen mit dem Zoom, „px“ bleiben auf dem Bildschirm gleich groß. Heutige Zoom-Regeln siehe §3.7; sag, ob deine Variante sie ändert.
- Export (PNG, SVG, PDF) zeichnet genau wie die Leinwand.
- Tags, Abstimmungs-Punkte, Reaktionen und Kommentare sind nicht Thema.
- Auswahl und Griffe sind nur bei Frames Thema (Teil R). Die „+“-Knöpfe an Tabellen, Swimlanes und Mindmaps darfst du anfassen, wenn es zur Variante gehört.
- Dunkelmodus: Die Leinwand bleibt hell (#f3f2f0), nur die Leisten werden dunkel. Für die Leinwand gilt also nur der helle Fall.
- Keine Ressourcen aus dem Netz. Symbole aus `quellen/` (Phosphor) dürfen benutzt werden.
- Die Person testet mit dem Stift auf einem Samsung-Tablet (Chrome) und am Mac (Safari). Griffe und Knöpfe müssen mit Finger und Stift zu treffen sein.

## 3. Heutiger Stand (exakte Werte, Stand Code 01.11.2026)

### 3.0 Gemeinsam

- Schrift `Arial, "Liberation Sans", Helvetica, sans-serif`, Zeilenabstand 1,2, Text #191b1d, Leinwand #f3f2f0.
- Auswahlfarbe: die Hauptfarbe des Nextcloud-Themes, wenn sie gegen die Leinwand 3 : 1 erreicht, sonst #0082c9.
- Auswahl-Umriss: 2 px, durchgezogen, eckig, 4 px außerhalb des Objekts. Auswahl anderer Leute: gestrichelt [6,4] in deren Farbe. Mehrfachauswahl: gestrichelt [6,4], 1 px.
- Größengriffe: weiße Quadrate, Ecken 2 px, Rand 2 px in Auswahlfarbe; 10 px mit Maus, 14 px mit Stift oder Finger.
- „+“-Knöpfe (Tabelle, Swimlanes, Mindmap): Kreis 12 px in Auswahlfarbe mit 2 px weißem Rand, 48 px außerhalb der Kante.

### 3.1 Runde 3, entschieden (bitte so zeichnen)

- **Notiz N4:** 200 × 200, Radius 6; Schatten nah 0/1/2 Schwarz 10 %, fern 0/5/14 Schwarz 9 %; Kante 1 Einheit im kräftigen Ton mit 18 % (Weiß: #6f6f6d mit 18 %, Schwarz: keine); **Eselsohr unten rechts (N2c) an jeder Notiz**, wie in `runde3.html#N2` und Teil D; Text Arial 22, Zeilenabstand 1,25, Innenabstand 18, mittig.
- **Formen F4:** Rand #3d4044, Stärke 2, Ecken Radius 4 (abgerundetes Rechteck 16), Weiß als Standard, mit Farbe Ton-in-Ton, kein Schatten, Innenabstand 12.
- **Verbinder V6:** eckig mit runden Knicken (Radius 10), #3d4044, Stärke 2, gefülltes Dreieck (Länge 6 + 4 × √Stärke), Beschriftung als weiße Plakette (Rand #191b1d 28 %, Arial 15).
- Die genauen Tabellen stehen in `runde3.md`, Abschnitt „Empfehlung mit Werten“.

### 3.2 Notizblock

- Das oberste Blatt ist der Block: Notizfarbe (Standard Hellblau #a2d9fe), Radius 6, 200 × 200.
- Dahinter 2 Blätter, jedes 4 Einheiten nach rechts unten versetzt, gleiche Farbe.
- Alle drei Blätter (auch das oberste) haben eine harte Kante: Schwarz 35 %, 1 Einheit. Kein Schatten.
- 12 unter dem Block ein grauer Streifen #e4e6e9, 32 hoch, so breit wie der Block, Radius 6. Darin der Titel: Arial 18, normal, #191b1d, mittig, eine Zeile mit „…“.
- Wer vom Block zieht, reißt eine neue Notiz ab. Der Streifen ist der Griff zum Auswählen und Verschieben.
- Ausgewählt: der Umriss nur um das oberste Blatt; 4 Eckgriffe, Seitenverhältnis fest, nicht drehbar.
- Unter 30 % kein Titel. Unter 9,5 % nur eine Fläche in der Blockfarbe.

### 3.3 Frames

- Rand #67686a, 1,5 px (bleibt bei jedem Zoom gleich dünn), durchgezogen. Radius 6. Kein Schatten.
- Fläche: Standard Weiß; wählbar die 13 hellen Töne.
- Neuer Frame: wird aufgezogen; 800 × 600 ohne Titel. Frei in der Größe, nicht drehbar.
- **Reiter (Runde 2, A2, bleibt):** 40 hoch über der Oberkante. Breite = Titel + 2 × 14, endet mindestens 24 vor der rechten Kante. Obere Ecken Radius 6. Eine Umrisslinie läuft um Reiter und Frame wie bei einer Karteikarte. Titel Arial 22, Gewicht 600, eine Zeile mit „…“. Reiter-Ton je Fläche: Weiß → #d1d1ce, Gelb → #e8ce49, Hellblau → #6bbef2, Türkis → #50cec7, Salbei → #8acf8b, Orange → #ec9d4f, Koralle → #ef8482, Rosa → #e693bc, Lila → #c198db, Indigo → #98aaec, Sand → #c8b08a, Grau → #c3c3bf, Schwarz → #36383b (Titel dann weiß).
- Ohne Titel: kein Reiter. Nur beim ausgewählten Frame erscheint ein gestrichelter, unten offener Reiter (#646d77, 1,5 px, [5,4]) mit „Titel hinzufügen…“ in 22.
- **Ausgewählt:** Auswahl-Umriss nur um den Kasten, der Reiter gehört nicht dazu. 4 Eckgriffe (siehe 3.0), kein Drehgriff.
- Bekannter Mangel aus Runde 2: Der Rand #67686a erreicht auf gelber und blauer Fläche nur 2,8 bzw. 2,2 : 1.

### 3.4 Swimlanes

- Swimlanes sind ein Frame mit waagrechten Bahnen. Umriss, Fläche, Radius und Reiter wie beim Frame. Alles wird auf den Frame-Umriss zugeschnitten.
- **Kopfspalte links:** 48 breit (höchstens die halbe Breite) über die volle Höhe. Sie fehlt bei einer einzigen Bahn ohne Namen und Gruppe.
- **Spalten (wahlweise):** Kopfzeile oben, 60 hoch, beginnt rechts der Kopfspalte.
- **Gruppen (wahlweise):** Bahngruppen als Zelle links der Bahnnamen (48 breit); Spaltengruppen als Zelle über den Spaltennamen (48 hoch).
- **Köpfe:** Schwarz 5 % über der Frame-Fläche. Die leere Ecke oben links bekommt nur den Ton der Kopfspalte, ohne Text.
- **Namen:** Bahn- und Gruppennamen fett 20, um −90° gedreht (lesen nach oben), eine Zeile; werden zu 18/16/14/12 kleiner, dann „…“. Spaltennamen fett 20, waagrecht, mittig, mit Umbruch. Innenabstand 12.
- **Trenner:** alle #67686a, 1,5 px, gleich wie der Frame-Rand: rechts der Kopfspalte, unter der Kopfzeile, an jeder Gruppenzelle, zwischen allen Bahnen (volle Breite), zwischen allen Spalten (volle Höhe).
- Neu: 1200 × 600, 3 Bahnen „Lane 1“–„Lane 3“ je 200 hoch, ohne Spalten, ohne Titel. Neue Bahn 200 hoch, neue Spalte 300 breit.
- Ausgewählt: wie Frame, dazu „+ Bahn“ unter der Mitte unten und mit Spalten „+ Spalte“ rechts der Mitte. Ein gezogener Kopf zeigt einen Geist (Auswahlfarbe 30 %, gestrichelte Kante); die Ablagemarke ist #0082c9, 3 px.
- Bleiben auch unter 30 % sichtbar. Unter 9,5 % nicht gezeichnet.

### 3.5 Tabellen

- Neu: 3 × 3, Spalten 160 breit, 480 × 108. Zeilen mindestens 36 hoch (Text + 2 × 8). Spalten 40–1000 breit, bis 20 Spalten und 50 Zeilen.
- Nur eine Kopfzeile (erste Zeile, fett), standardmäßig an. Eine Kopfspalte gibt es nicht.
- Kopf-Fläche Standard #eef1f5, wählbar dazu die 13 hellen Töne. Zellen Weiß.
- Gitter #c6cacf, 1 Einheit (wächst mit dem Zoom), Außenrand und alle inneren Linien. Ecken spitz. Kein Schatten.
- Text Arial 16, normal (Kopf fett), #191b1d, oben links, Innenabstand 8, Umbruch.
- Ausgewählt: nur der Auswahl-Umriss, keine Griffe; „+ Spalte“ rechts, „+ Zeile“ unten. Eine gewählte Zelle wird auf der Leinwand nicht hervorgehoben, nur das offene Textfeld hat einen 2 px Rand #0082c9.
- Unter 30 % kein Zellentext. Unter 9,5 % ein Kasten in Gitterfarbe.

### 3.6 Mindmaps, Organigramm und Baum

Alle drei sind derselbe Objekttyp mit vier Anordnungen: beidseitig (Standard), rechts, Organigramm, Baum. Nur in der Mindmap lassen sich Knoten frei verschieben.

**Mindmap:**
- **Zentrum:** abgerundetes Rechteck, Radius 8, Weiß, Rand 2 #191b1d (oder in der Knotenfarbe), Text fett 20, Innenabstand 16 × 12, mindestens 120 breit, Umbruch bei 280.
- **Knoten:** Standard „Linie“: Text über einem Unterstrich in der Astfarbe (2, an Hauptästen 3), links bündig, Innenabstand 6 × 4. Wählbar auch Rechteck, abgerundetes Rechteck (8) oder Pille: Weiß, Rand 2 in der Astfarbe, Text mittig, Innenabstand 12 × 8. Text normal 16, Umbruch bei 240. Außer der Linienstärke kein Unterschied je Ebene.
- **Astfarben:** Hauptäste bekommen der Reihe nach die ersten 10 kräftigen Töne (#0275a9, #087c77, #307d37, #7e6f01, #a25d04, #c43e45, #b94082, #9550bb, #5165d3, #816b46). Tiefere Knoten erben die Farbe.
- **Äste:** S-Kurve (Griffe waagrecht bei halbem Abstand), Hauptäste 3, tiefer 2, runde Enden. Start an der Seitenmitte des Zentrums bzw. am Ende des Unterstrichs.
- **Abstände:** Kinder 40 neben dem Elternknoten, Geschwister 10, Hauptäste 20.
- **Zuklappen:** zugeklappt ein voller Punkt (Radius 7) in der Astfarbe mit der Zahl versteckter Knoten (weiß, fett 8); aufgeklappt ein hohler Punkt (Radius 6, Ring 1,5), nur bei Auswahl oder Zeiger darüber.
- Ausgewählt: Umriss ums Ganze, keine Griffe; der fokussierte Knoten hat einen eckigen Umriss 3 außerhalb, 2 px #0082c9; „+“-Knöpfe für Kind und Geschwister.

**Organigramm:**
- Jeder Knoten (auch das Zentrum) ist eine Karte: abgerundetes Rechteck 8, Weiß, Rand 2 in der Knotenfarbe, oben ein 6 hohes Farbband.
- Erste Zeile Name fett 16, Rest Rolle normal 16, mittig, Innenabstand 12 × 8, Umbruch 200, mindestens 120 breit.
- Linien rechtwinklig: von unten Mitte nach unten bis 20 über der Kinderreihe, quer, nach unten auf oben Mitte. Farbe des Elternknotens (vom Zentrum aus #191b1d), Stärke 3 bzw. 2. Knicke ohne Radius (nur runde Linienverbindung).
- Geschwister 20 auseinander, Reihen 40.

**Baum:** wie „rechts“ angeordnet, Knoten als abgerundete Kästen, Linien rechtwinklig (20 nach rechts, senkrecht, nach rechts zur Kante).

### 3.7 Zoom

- Ab 30 %: alles voll.
- Unter 30 %: kein Text in Tabellenzellen, Mindmaps, Notizblock-Titel und Notizen. Frame-Titel, Reiter, Bahnen, Gitter, Mindmap-Formen und Äste bleiben.
- Unter 9,5 %: eine grobe Ersatzzeichnung. Frames als Fläche mit 1 px Rand, ohne Reiter und Bahnen, mit Titel 12 px darüber. Tabellen als Kasten in Gitterfarbe, Notizblock als Fläche, Mindmaps als Balken.

## 4. Teil B: Notizblock

Wunsch: Der Block soll klar anders aussehen als eine Notiz. Der graue Streifen und die Blätter dahinter stören.

- **B0 heute.**
- **B1 Stapel im Look N4:** die Blätter dahinter mit dem weichen Schatten und der feinen Kante von N4 statt der harten schwarzen Kante. Der Stapel ist sichtbar höher (z. B. 3–5 Blätter, oder eine Stapelkante). Titel wie heute.
- **B2 Bindung oben:** eine Klebekante oder Leimbindung oben am Block (dunklerer Ton derselben Farbe), wie bei einem echten Haftnotizblock; der Titel steht darauf. Kein grauer Streifen mehr.
- **B3 Reiter wie Frames:** Titel in einem Reiter (wie Runde 2, A2) über dem Block, im Reiter-Ton der Blockfarbe.
- **B4 dein Vorschlag** (z. B. Spiralbindung, ein Symbol „Block“ auf dem Deckblatt, Titel auf dem Block selbst).

Klär in jeder Variante:
- Hat der Block ein Eselsohr wie die Notizen? Mein Vorschlag: nein, damit man ihn vom Zettel unterscheidet. Sag, was du findest.
- Wo greift man zum Verschieben, wo zum Abreißen? Der Griff muss mit Stift und Finger klar zu finden sein.

Zustände: Hellblau, Gelb, Weiß; kurzer, langer und kein Titel; ausgewählt; neben zwei abgerissenen Notizen derselben Farbe (Block klar vom Zettel unterscheidbar?); Zoom 25 %, 100 %, 200 %.

## 5. Teil R: Frames

Wunsch: Rand und Fläche; wie ein ausgewählter Frame aussieht. Der Reiter A2 bleibt.

- **R0 heute.**
- **R1 Ton-in-Ton-Rand:** Rand aus dem Reiter-Ton der Fläche statt #67686a. Damit wäre auch der Kontrast-Mangel auf Gelb und Blau gelöst. Weiß bekommt den grauen Reiter-Ton.
- **R2 Fläche leiser:** farbige Fläche heller oder mit Deckkraft (z. B. 40–60 % des hellen Tons auf der Leinwand), damit Notizen und Formen darauf ruhiger stehen; Reiter bleibt kräftig.
- **R3 ohne Rand:** nur Fläche und Reiter, kein Rand, oder ein sehr feiner Rand; ein leiser Schatten oder keiner. Sag, ob ein weißer Frame auf der Leinwand #f3f2f0 dann noch zu sehen ist.
- **R4 dein Vorschlag**, auch zu den Ecken (heute 6).

**Ausgewählt:** Zeig für die beste Variante zwei, drei Lösungen:
- heute (Umriss 4 px außerhalb, ohne Reiter, 4 eckige Griffe);
- Umriss folgt dem Frame-Umriss samt Reiter und Radius;
- andere Griffe (rund, an den Seitenmitten zusätzlich, größer für Stift).
- Prüf, ob der Reiter ausgewählt anders aussehen soll (z. B. in Auswahlfarbe).

Zustände: Weiß, Gelb, Hellblau, Salbei, Schwarz; mit und ohne Titel; zwei Frames knapp neben- und untereinander (Abstand 16); mit Notizen (N4), Formen (F4) und einem Verbinder (V6) darauf; ausgewählt, auch bei 25 % und 200 %.

## 6. Teil S: Swimlanes

Wunsch: Köpfe, Linien und Trenner; wirkt wie eine Tabelle, zu technisch und streng.

- **S0 heute.**
- **S1 farbige Köpfe:** Köpfe im Reiter-Ton der Frame-Fläche (wie A2) oder je Bahn ein eigener heller Ton der Palette. Sag, was dafür und dagegen spricht (Bahnen unterscheiden vs. bunt).
- **S2 weniger Linien:** Trenner zwischen Bahnen nur als feine oder gestrichelte Linie, oder ganz ohne Linie und stattdessen Bahnen im Wechsel leicht getönt; Köpfe ohne Trenner.
- **S3 Köpfe als Plaketten:** Bahnnamen als runde Plakette oder Reiter am linken Rand statt einer durchgehenden Kopfspalte; der gedrehte Text wird geprüft (waagrecht lesbar?).
- **S4 dein Vorschlag.**

Prüf auch:
- die gedrehte Schrift (heute −90°, fett 20): waagrecht oder gedreht, Größe, Gewicht;
- die leere Ecke oben links (heute leer und grau);
- wie Gruppen (Bahn- und Spaltengruppen) in deiner Variante aussehen.

Zustände: 3 Bahnen ohne Spalten (Standard); 4 Bahnen × 3 Spalten; mit Bahngruppe und Spaltengruppe; Fläche Weiß und Gelb; mit Titel-Reiter; mit Notizen und einem kleinen Ablauf aus Formen und Verbindern darin; lange Bahnnamen; ausgewählt mit „+“-Knöpfen; Zoom 25 %, 100 %, 200 %.

## 7. Teil T: Tabellen

Freie Hand: Die Person hat Tabellen dazugenommen, ohne einen Wunsch anzukreuzen. Mach sie passend zu Swimlanes und F4.

- **T0 heute.**
- **T1 weicher:** Ecken Radius (z. B. 6) außen, Gitter feiner oder heller, Kopfzeile Ton-in-Ton.
- **T2 nur waagrechte Linien:** wie moderne Tabellen, senkrechte Linien weg oder sehr leise; Kopf durch Fläche oder fette Schrift abgesetzt.
- **T3 dein Vorschlag**, auch zur Hervorhebung einer gewählten Zelle (heute keine) und zur Kopfspalte (heute keine).

Prüf: Passen Tabelle und Swimlane zusammen, ohne gleich auszusehen? Sag, wie man sie auseinanderhält.

Zustände: 3 × 3 Standard; 5 × 6 mit langen Texten; Kopf Weiß/Standard und Gelb; ausgewählt mit „+“-Knöpfen; eine Zelle im Bearbeiten; auf einem Frame; Zoom 25 %, 100 %, 200 %.

## 8. Teil M: Mindmaps

Freie Hand, passend zu Notizen (N4), Formen (F4) und Verbindern (V6).

- **M0 heute.**
- **M1 Knoten mit mehr Charakter:** Zentrum größer und klar anders (z. B. Fläche im hellen Ton oder Pille), Hauptäste als Plakette oder Pille in hellem Ton der Astfarbe, tiefere Ebenen als „Linie“.
- **M2 Äste:** Äste dicker am Zentrum und dünner nach außen (abgestuft je Ebene), oder als sich verjüngende Kurve, wenn Konva das als Pfad kann; sag, was es kostet.
- **M3 dein Vorschlag**, auch zum Zuklapp-Punkt.

Zustände: Zentrum mit 4 Hauptästen, je 2–3 Unterknoten, eine Ebene tiefer; ein Ast zugeklappt mit Zahl; ein langer Knotentext; gemischt „Linie“ und Kasten; ausgewählt mit fokussiertem Knoten und „+“; Zoom 25 %, 100 %, 200 %.

## 9. Teil O: Organigramm und Baum

- **O0 heute.**
- **O1 Karten im Look F4:** Rand #3d4044 bzw. Ton-in-Ton, Radius passend zu F4, Farbband oben oder links; Linien mit runden Knicken wie V6 (Radius 10).
- **O2 dein Vorschlag** (z. B. Fläche im hellen Ton statt Band, Initialen-Kreis, kleinere Rolle in Grau).

Baum: zeig, wie er in O1/O2 aussieht.

Zustände: Organigramm mit 3 Ebenen, 1 + 3 + 5 Karten, je Name und Rolle; ein langer Name; ein Zweig zugeklappt; Baum mit 3 Ebenen; ausgewählt; Zoom 25 %, 100 %, 200 %.

## 10. Teil D: Zusammen

Ein Ausschnitt eines echten Boards, einmal **heute** und einmal mit deinen Empfehlungen: eine Swimlane mit Titel-Reiter und einem kleinen Ablauf (F4 + V6), daneben ein Frame mit Notizen (N4) und einem Notizblock, eine Tabelle und eine kleine Mindmap. Dazu ein Satz, warum die Kombination zusammenpasst.

## 11. Lieferumfang

- **`runde4.html`:** eine eigenständige Seite (alles eingebettet), oben ein Umschalter für Teil B, R, S, T, M, O und D und zwischen den Varianten. Jede Variante trägt ihr Kürzel groß sichtbar, damit die Person in einer Fragerunde sagen kann „B2“ oder „S1“. Links wie `#S2` öffnen eine Variante. Desktop 1440 × 900 zuerst. Die Leinwand-Ausschnitte als SVG oder Canvas so zeichnen, wie Konva es könnte (keine CSS-Effekte, die Konva nicht hat). Du darfst die Seite aus Quellen in `src4/` bauen wie Runde 3.
- **`runde4.md`:** pro Variante zwei, drei Sätze: was sie anders macht, was dafür spricht, was dagegen, was sie beim Bauen kostet. Am Ende deine Empfehlung je Teil mit den konkreten Werten (Farben, Radien, Größen, Stärken, Abstände) als Tabellen wie in `runde3.md`, damit daraus Bauaufträge werden können.
- `index.html`, `runde2.html`, `runde3.html`, `tokens.css`, `zuordnung.md`, `src/`, `src2/`, `src3/` nicht ändern.
