# Knorke · Zuordnung „heute → neu“

Stand 29.10.2026. Gehört zu `index.html` (Prototyp P1–P12) und `tokens.css`.
Jede Zeile aus dem Inventar (UEBERGABE.md, Abschnitt 7) steht hier in derselben Reihenfolge. Spalte **Ansicht** nennt, wo man es im Prototyp sieht (Deep-Link: `index.html#P7`). „—“ heißt: im Prototyp nicht gezeichnet, Ort ist trotzdem festgelegt.

Alle Bedienelemente bleiben Nextcloud-Vue-Komponenten: Knöpfe = **NcButton** (tertiär, sekundär oder primär), Menüs = **NcActions** (Untermenüs als NcActions-Untermenü in derselben Liste), Dialoge = **NcDialog**, Boardliste = **NcAppNavigation**. Icons: Material Design Icons, Umriss-Variante, 20 px (V5); der MDI-Name steht in Klammern.

**Begriffe im Plan:**
- **Linke Insel**: Zurück, Titel und Hinweise oben links.
- **Rechte Insel**: Personen und Aktionen oben rechts.
- **Werkzeugleiste**: links, senkrecht.
- **Kontextleiste**: erscheint an der Auswahl.
- **„…“ der Kontextleiste**: ihr letztes Element.
- **Sitzungsleiste**: unten mittig, nur sichtbar, solange etwas läuft.
- **Zoomleiste**: unten rechts.

---

## Kopfzeile

| Heute | Neu | Ansicht |
|---|---|---|
| Zurück | Linke Insel, erstes Element, NcButton tertiär (`arrow-left`). Führt zur Boardliste. | P1 |
| Titel umbenennen | Linke Insel. Der Titel ist selbst der Knopf (Tooltip „Umbenennen“). Ein Klick macht daraus ein Eingabefeld: Enter speichert, Esc bricht ab. | P1 |
| Hinweis „Per Link offen“ (öffnet Datenschutz-Info) | Chip in der linken Insel, als Info-Paar (helle Primärfläche, dunkler Text, `link-variant`). Ein Klick öffnet ein Popover mit der Datenschutz-Info. Auf dem Telefon steht der Hinweis als Unterzeile unter dem Titel. | P1, P11 |
| Hinweis „Gast“ | Neutraler Chip in der linken Insel (`account-outline`). Auf dem Telefon steht er in der Unterzeile: „Gast · Per Link offen“. | P11 |
| Timer-Chip | Wandert in die **Sitzungsleiste** als Segment „Timer 04:12“, daneben ein ×-Knopf „Timer beenden“ (nur für Moderierende). | P7, P11 |
| Avatare mit Folgen und „+n“-Liste | Rechte Insel, vorn. Klick auf einen Avatar = Folgen; das bestätigt der Hinweis „Du folgst Bob Berg · Nicht mehr folgen“. „+n“ öffnet NcActions „Anwesend (n)“ mit „Folgen“ je Person. Die Farbe gehört fest zum Konto (V17). | P1, P11 |
| Kommentare | Rechte Insel, Icon-Knopf (`comment-outline`). Öffnet das Kommentar-Panel rechts. Ist das Panel offen, ist der Knopf gedrückt. | P1 |
| Moderieren: Abstimmung starten, Timer, Alle hierher holen, Beenden | Rechte Insel, Fahne **mit dem Wort** „Moderieren“ (`flag-outline`). Das Menü enthält: „Abstimmung starten …“, „Timer …“, „Alle hierher holen“. Läuft etwas, kommt der Abschnitt „Läuft gerade“ dazu, mit „Abstimmung beenden“, „Timer beenden“ und „Präsentation beenden“. Beenden gibt es außerdem direkt in der Sitzungsleiste. | P6b, P7 |
| Teilen | Rechte Insel. Der **einzige Primärknopf** auf dem Board (`share-variant-outline` + „Teilen“). Öffnet den Dialog „Board teilen“. Gäste sehen ihn nicht. | P1 |
| Mehr › Als Bild speichern (PNG) | Mehr › **Exportieren ▸** › Als Bild (PNG) | P6 (Klick auf „Exportieren“) |
| Mehr › Als SVG speichern | Mehr › Exportieren ▸ › Als SVG | P6 |
| Mehr › Als PDF speichern … | Mehr › Exportieren ▸ › Als PDF … (öffnet den PDF-Dialog) | P6 |
| Mehr › Als BPMN speichern | Mehr › Exportieren ▸ › Als BPMN | P6 |
| Mehr › Als CSV speichern | Mehr › Exportieren ▸ › Als CSV | P6 |
| Mehr › Board herunterladen | Mehr › Exportieren ▸ › Board-Datei herunterladen | P6 |
| Mehr › Als Vorlage vorschlagen … | Mehr, oberste Ebene, nach dem Trenner | P6 |
| Mehr › Vorlage einfügen … | Mehr › **Einfügen ▸** › Vorlage … (öffnet den Dialog „Vorlage einfügen“) | P6 |
| Mehr › Boarddatei einfügen … | Mehr › Einfügen ▸ › Board-Datei … | P6 |
| Mehr › BPMN-Datei einfügen … | Mehr › Einfügen ▸ › BPMN-Datei … | P6 |
| Mehr › CSV importieren … | Mehr › Einfügen ▸ › CSV … | P6 |
| Mehr › Rechtliches | Mehr, oberste Ebene, letzter Eintrag | P6 |
| *(neu in diesem Menü)* Tastenkürzel | Mehr, oberste Ebene. Hierher kommt der Eintrag aus dem entfallenen runden „?“-Knopf (V9), siehe auch Zoom. | P6 |

## Werkzeuge

| Heute | Neu | Ansicht |
|---|---|---|
| Auswählen (V) | Werkzeugleiste, Gruppe 1 (`cursor-default-outline`) | P1 |
| Schwenken / Hand (H) | Werkzeugleiste, Gruppe 1 (`hand-back-right-outline`). Auf dem Tablet schwenkt zusätzlich der Finger. | P1, P10 |
| Notiz (Notiz / Notizblock) (N) | Werkzeugleiste, Gruppe 2 (`note-outline`). Der eigene Pfeil entfällt; stattdessen sitzt eine **Ecke** am Icon. Zweiter Klick, langes Drücken oder Rechtsklick öffnet die Varianten als Bilder. Ist Notizblock gewählt, zeigt der Knopf `note-multiple-outline`. | P5b |
| Form (Grundformen) (S) | Werkzeugleiste, Gruppe 2 (`shape-outline`). Öffnet **direkt das Formen-Panel**; das Pfeil-Menü mit der Textliste entfällt (V3). | P5 |
| Text (T) | Werkzeugleiste, Gruppe 2 (`format-text`) | P1 |
| Tabelle (B) | „Mehr Werkzeuge“ (`view-grid-plus-outline`): kleines Raster mit Tabelle (`table-large`), Mindmap und Laserpointer. Das gewählte Werkzeug zeigt danach sein Icon auf dem Knopf. | P1 (Klick) |
| Mindmap (M) | „Mehr Werkzeuge“ (`sitemap-outline`) | P1 (Klick) |
| Verbinder (Route Gerade/Rechtwinklig/Gebogen, Spitzen) (L) | Werkzeugleiste, Gruppe 2 (`arrow-top-right`, bei Route „Rechtwinklig“ `vector-polyline`), mit Ecke. Das Varianten-Popover zeigt „Route“ (drei Bilder) und „Spitzen“ (Ohne / Am Ende / Beide Enden). | P1 (zweiter Klick) |
| Frame (Frame / Swimlanes) (F) | Werkzeugleiste, Gruppe 2 (`crop-free`, bei Swimlanes `view-sequential-outline`), mit Ecke und Varianten-Bildern. | P1 (zweiter Klick) |
| Laserpointer (K) | „Mehr Werkzeuge“ (`laser-pointer`) | P1 (Klick) |
| Formen-Panel (eigener Knopf) | **Kein eigener Knopf mehr.** Das Form-Werkzeug (S) öffnet das Panel. | P5 |
| Rückgängig, Wiederholen | Eigene kleine Insel unten links (`undo`, `redo`). Auf dem Telefon nicht vorhanden, dort wird nicht bearbeitet. | P1 |

## Formen-Panel

| Heute | Neu | Ansicht |
|---|---|---|
| Suche | Oben im Panel, Feld „Formen suchen“ | P5 |
| Gruppen: Grundformen, Flussdiagramm, BPMN, Bibliotheken | Aufklappbare Gruppen in dieser Reihenfolge, Raster mit drei Spalten, Bild und Name. Darüber neu: **„Zuletzt benutzt“** (V3, drei Formen). | P5 |
| Formen importieren … | Fußzeile des Panels, bleibt beim Scrollen sichtbar; öffnet den Dialog „Formbibliothek importieren“. | P5 |
| Eigene Bibliotheken mit Menü und Status „Wartet auf Freigabe“ | Gruppe „Bibliotheken“. Je Bibliothek eine Zeile mit Name, Anzahl und „…“ (NcActions). Der Status steht als Warn-Paar-Chip (`clock-outline`, „Wartet auf Freigabe“). | P5 |

## Kontextleiste

Feste Ordnung (V4): **[Zähler-Chip bei ≥ 2] · Farbpunkt · Typ-Gruppe · Zusammenarbeit · „…“**. Bei Mehrfachauswahl rückt „Objekte ausrichten“ direkt hinter den Chip.

| Heute | Neu | Ansicht |
|---|---|---|
| Füllung mit Deckkraft | Farbpunkt › Reiter **Füllung**: die eine Palette (13 Felder mit Namen), Regler „Deckkraft“, „Eigene Farbe …“ | P2 |
| Rand oder Linie mit Stärke und Strichart | Farbpunkt › Reiter **Rand** (Formen) bzw. **Linie** (Verbinder): Palette (kräftige Töne), Stärke (Dünn/Mittel/Dick), Strichart | P3 (Farbpunkt › Rand) |
| Text: Farbe, Größe (auch „Auto“), horizontale und vertikale Ausrichtung | Farbpunkt › Reiter **Text**: Textgröße S/M/L/Auto, Ausrichtung (links/mittig/rechts, oben/Mitte/unten), Textfarbe | P2 (Reiter Text) |
| Kopfzeile (Tabelle) | Typ-Gruppe bei Tabellen: „Kopfzeile“ (`page-layout-header`) | — |
| Ast und Layout (Mindmap) | Typ-Gruppe bei Mindmaps: „Ast“ (`source-branch`) und „Layout“ (`file-tree-outline`) | — |
| Form wechseln | Typ-Gruppe bei Formen (`rhombus-outline`). Öffnet ein Popover mit den Grundformen als Bilder und „Alle Formen …“. | P3 |
| Route, Spitzen, Richtung tauschen, BPMN-Flussarten | Typ-Gruppe bei Verbindern: Route (`vector-polyline`; bei BPMN-Verbindern mit Abschnitt „Flussart“), Spitzen (`arrow-right-thin`), Richtung tauschen (`swap-horizontal`) | — |
| Beschriftung bearbeiten, Umbenennen | Typ-Gruppe: Formen und Verbinder haben „Beschriftung bearbeiten“ (`form-textbox`), Frames und Swimlanes „Umbenennen“ (`pencil-outline`). | P3; Frame anklicken |
| Verbinden | „…“ › Verbinden (`vector-line`). Dazu die Verbindungspunkte an der Kante (V8). | P2 („…“) |
| Nach Farbe sortieren | Mehrfachauswahl: im Popover „Objekte ausrichten“ und in „…“ (`palette-outline`). Sortiert nach den Farbnamen in Palettenreihenfolge. | P4 |
| Anordnen (X, Y, B, H, Winkel) | „…“ › Anordnen … (`move-resize`): kleines Popover mit den fünf Feldern | P2 („…“) |
| Objekte ausrichten und verteilen, Aufräumen | Mehrfachauswahl: zweiter Platz (`align-horizontal-left`). Das Popover hat die Abschnitte „Ausrichten“ (6), „Verteilen“ (2) und „Aufräumen (Raster)“. Bei Einzelauswahl nicht sichtbar. | P4 |
| Kopieren | „…“ › Kopieren (Strg+C) | P2 („…“) |
| Reaktion | Gruppe Zusammenarbeit (`emoticon-happy-outline`); Popover mit Reaktionen | P2 |
| Kommentar | Gruppe Zusammenarbeit (`comment-outline`); öffnet das Kommentar-Panel mit Bezug auf das Objekt | P2 |
| Tags | Gruppe Zusammenarbeit (`tag-outline`); Popover: vorhandene Tags, „Neuer Tag …“, „Nach Tag filtern“ | P2 |
| Ausschneiden, Duplizieren, Nach vorne, Nach hinten, Löschen | „…“, gruppiert: Ausschneiden/Kopieren/Duplizieren · Nach vorne/Nach hinten · … · Löschen (als letzter Eintrag, in Fehler-Textfarbe) | P2 („…“) |
| Gruppieren, Gruppierung lösen | „…“: „Gruppieren“ bei Mehrfachauswahl, „Gruppierung lösen“ bei einer Gruppe | P4 („…“) |
| Sperren, Entsperren | „…“: „Sperren“, bei gesperrtem Objekt stattdessen „Entsperren“ | P2 („…“) |
| „n ausgewählt“ als Filter | **Chip vorn** („8 ausgewählt ▾“, Info-Paar) ab zwei Objekten. Öffnet „Auswahl eingrenzen“: nach Typ, „Nach Tag …“. | P4 |

## Zoom

| Heute | Neu | Ansicht |
|---|---|---|
| Tastenkürzel (runder „?“-Knopf) | Der runde Knopf **entfällt**. Neue Orte: Zoom-Menü › Tastenkürzel, Mehr › Tastenkürzel, Taste „?“ | P1 (Klick auf „60 %“) |
| Frames-Liste | Zoom-Menü › Frames ▸ (Untermenü mit den Frame-Namen) | P1 (Klick auf „60 %“) |
| Auf Auswahl zoomen | Zoom-Menü; ohne Auswahl ausgegraut | P1 (Klick auf „60 %“) |
| Herauszoomen, 100 %, Hereinzoomen | Sichtbar: − · Prozentzahl · +. „100 %“ steht als erster Eintrag im Zoom-Menü; ein Klick auf die Prozentzahl öffnet dieses Menü. | P1 |
| Alles zeigen | Sichtbar, letztes Element der Zoomleiste (`fit-to-screen-outline`) | P1 |

## Rechtsklick-Menü

| Heute | Neu | Ansicht |
|---|---|---|
| Dieselben Bearbeiten-Befehle | Gleiche Gruppen und Reihenfolge wie „…“ der Kontextleiste. Ein Rechtsklick auf ein Objekt wählt es vorher aus. | P1 (Rechtsklick auf eine Notiz) |
| Raster anzeigen | Letzter Eintrag mit Häkchen; auf leerer Leinwand der einzige Eintrag | P1 (Rechtsklick) |

## Panels

Alle Panels liegen auf Ebene 2, sind 296 px breit und überdecken weder die Inseln noch die Zoomleiste. Sie enden über der Zoomleiste, die deshalb an ihrem Platz bleibt. Auf dem Telefon füllen sie den Bildschirm, wie heute.

| Heute | Neu | Ansicht |
|---|---|---|
| Kommentare: Neuer Kommentar, Blasen anzeigen, Offen/Erledigt | Panel rechts. Oben „Neuer Kommentar“ (sekundär) und Schalter „Blasen anzeigen“. Darunter das Segment „Offen (n) / Erledigt (n)“, dann die Threads, je Thread mit Bezug („Zu ‚Preisseite überarbeiten‘“), „Antworten“ und „Erledigt“. | P1 (Kommentare) |
| Abstimmungsliste | Panel rechts, geöffnet über „Liste“ in der Sitzungsleiste: je Notiz Farbfeld, Text und „− n +“ | P7 (Liste) |
| Tags mit Filter-Chip | Zuweisen im Tags-Popover der Kontextleiste. Ein aktiver Tag-Filter erscheint als schließbarer Hinweis oben mittig (V16-Platz) statt als freier Chip. | P2 (Tags) |
| Formen | Panel links neben der Werkzeugleiste | P5 |

## Sitzung

| Heute | Neu | Ansicht |
|---|---|---|
| Abstimmungsleiste: verbleibende Stimmen, Restzeit, Anzahl Abstimmender, Bearbeiten, +5 min, Beenden, Liste, Zwischenstand | Sitzungsleiste, Segment „Abstimmung“. Immer sichtbar: „2 von 3 Stimmen übrig“, „09:54“ und „4 haben abgestimmt“. Für Moderierende: „+5 min“, „Liste“, „Beenden“. Hinter „⋯“: „Abstimmung bearbeiten …“ und „Zwischenstand zeigen“. Auf dem Telefon zweizeilig mit „Liste“. | P7, P11 |
| Zähler-Abzeichen an Objekten | Kreis in der oberen rechten Ecke der Notiz: leer mit „+“ oder gefüllt in Primärfarbe mit Zahl. Sichtbar 28 px, Trefferfläche 32 px (Maus) bzw. 44 px (Touch). Ein Klick gibt eine Stimme ab oder nimmt sie zurück. | P7, P11 |
| Reaktionen | Chip unten links in der Notiz, auf der Leinwand gezeichnet | P1 (Notiz „Weniger Meetings“) |
| Kommentar-Blasen | Sprechblase rechts neben dem Objekt mit Anzahl. Ein Klick öffnet das Kommentar-Panel. Der Schalter „Blasen anzeigen“ blendet sie aus. | P1 („Preisseite überarbeiten“) |
| Folgen-Banner, Chip „… präsentiert · Folgen“ | Hinweis-Platz oben mittig (V16): „Du folgst Bob Berg · Nicht mehr folgen“ oder „Alice Adler präsentiert · Folgen“. Es steht immer nur ein Hinweis da. Wer selbst präsentiert, sieht das Segment „Du präsentierst · Beenden“ in der Sitzungsleiste. | P11 (Hinweis schließen), P1 (Avatar BB) |

## Dialoge

Alle Dialoge sind NcDialog auf Ebene 3, mit 16 px Radius und abgedunkeltem Hintergrund. Pro Dialog gibt es genau einen Primärknopf.

| Heute | Neu | Ansicht |
|---|---|---|
| Teilen: Personen, Links, Passwort, QR-Code, Dem Raum zeigen | „Board teilen“ mit Segment „Personen / Links“. Unter „Links“ zwei Abschnitte: Bearbeitungslink (Link kopieren, QR-Code, Passwort …, Link löschen) und Abstimmungslink. „Dem Raum zeigen“ ist ein eigener dritter Abschnitt. | P1 (Teilen) |
| Vorlagen | „Vorlage einfügen“ (Mehr › Einfügen › Vorlage …) mit Vorschau-Raster. Dasselbe Raster nutzen „Neues Board“ und das leere Board. | P6 → Einfügen |
| Timer | Dialog „Timer“: Dauer als Segment, eigene Dauer, „Timer starten“ | P6b → Timer … |
| Abstimmung einrichten | Dialog „Abstimmung einrichten“: Stimmen pro Person, Dauer, „Abstimmung starten“. Erreichbar über Moderieren und über „⋯ › Abstimmung bearbeiten …“. | P6b → Abstimmung starten … |
| PDF | Inhalt unverändert, erreichbar über Exportieren › Als PDF … | — |
| Formbibliothek | Inhalt unverändert, erreichbar über Formen-Panel › Formen importieren … | — |
| Tastenkürzel | Dialog mit Tabelle; erreichbar über Mehr, Zoom-Menü und Taste „?“ | P1 („?“ drücken) |
| Gastname mit Datenschutzhinweis | Inhalt unverändert. Er übernimmt nur Radius, Schatten und Abstände aus `tokens.css`. | — |
| Bestätigen | NcDialog mit Frage als Titel, einem Satz zur Folge und „Abbrechen / Löschen“ | P9 („…“ › Löschen …) |

## Boardliste

| Heute | Neu | Ansicht |
|---|---|---|
| Neues Board | Oben in der NcAppNavigation, primär. Öffnet den Dialog „Neues Board“ mit Name und Vorlagen-Raster; **„Leer“ ist vorausgewählt**. | P9 |
| Alle Boards, Favoriten, Meine, Mit mir geteilt | Einträge der NcAppNavigation. Auf dem Telefon als einschiebbare Navigation (`menu`). | P9, P9b |
| Sortieren | Rechts oben, NcActions „Zuletzt geändert“ (`sort`); auf dem Telefon nur als Icon | P9, P9b |
| Je Board: Skizze | Große Vorschau (240 × 150, Seitenverhältnis 1,6). Ein Klick öffnet das Board. | P9 |
| Je Board: Titel, Zeit | Unter der Vorschau; Titel bis zu zwei Zeilen, Zeit in gedämpfter Farbe | P9 |
| Je Board: Favorit | Stern **auf der Karte**, oben rechts auf der Vorschau. Gesetzt ist er immer sichtbar, sonst bei Zeiger oder Fokus. Auf dem Telefon nur als Zustand an Favoriten. | P9, P9b |
| Je Board: Umbenennen, Löschen | „…“ neben dem Titel (NcActions). Auf dem Telefon langes Drücken oder Rechtsklick, dann ein Aktionsblatt unten. | P9, P9b |
| Leere Zustände | NcEmptyContent je Ansicht, z. B. „Noch keine Favoriten“ oder „Noch nichts mit dir geteilt“ | P9 („Mit mir geteilt“) |
| *(neu laut V14)* Umschalter Raster / Liste | Segment rechts oben | P9 |

## Hinweise (aus Abschnitt 3, ohne eigene Inventarzeile)

| Heute | Neu | Ansicht |
|---|---|---|
| Banner oben: Verbindung, Folgen, „Auf diesem Gerät kannst du ansehen und abstimmen …“ | Heller Hinweis oben mittig unter der Kopfzeile, schließbar, mit Status-Paar. „Alles zeigen“ rechnet ihn ein, deshalb verdeckt er keinen Inhalt. | P11 |
| Toasts | Bleiben Nextcloud-Toasts (`showSuccess`/`showError`), unverändert | — |

---

## Vorschläge V1–V17: warum, und wo der Entwurf abweicht

**V1 Kopfzeile als zwei Inseln.** Die Mitte gehört wieder der Leinwand: Das Board gewinnt die volle Höhe unter Nextclouds Leiste, und die leere Mitte der alten Leiste verschwindet. Abweichungen:
- **Telefon:** Auf 390 px passen zwei Inseln nicht nebeneinander. Dort gibt es eine Insel über die volle Breite, Titel und Hinweise stehen zweizeilig.
- **Gäste:** Sie sehen weder „Teilen“ noch „Moderieren“, weil das nach unserem Verständnis Konto-Funktionen sind. *Annahme, bitte bestätigen.*

**V2 Werkzeugleiste kürzen.** Aus 13 Knöpfen, 4 Pfeilen und Trennern werden 8 Knöpfe in zwei Gruppen. Die Ecke am Icon sagt „hier gibt es Varianten“, ohne die Leiste zu verbreitern. Abweichungen:
- Der Knopf für das Formen-Panel entfällt ganz, weil das Form-Werkzeug das Panel öffnet (V3).
- Die Leiste sitzt oben unter der linken Insel statt senkrecht mittig. So hat sie einen festen Platz und wandert nicht mit der Fensterhöhe.

**V3 Ein Ort für Formen.** Es gibt nur noch eine Liste, und zwar mit Bildern: Wer eine Raute sucht, erkennt sie dort schneller als in einer Textliste. „Zuletzt benutzt“ zeigt drei Formen, so passt die Reihe ohne Umbruch in die drei Spalten.

**V4 Kontextleiste mit fester Ordnung.** Eine Notiz hat jetzt 5 Knöpfe statt 13, eine Form 7, eine Mehrfachauswahl 5 (Chip eingerechnet) statt 11. Die Reihenfolge ist immer gleich, deshalb findet die Hand die Knöpfe blind. Abweichungen:
- **Zähler-Chip erst ab zwei Objekten.** Bei einem Objekt gibt es nichts zu filtern, und der Platz ist knapp.
- **Farb-Panel weicht der Auswahl aus.** Würde es das Objekt verdecken, öffnet es sich daneben. Man soll sehen, was man umfärbt.
- **Bei Mehrfachauswahl keine Reaktion und kein Kommentar.** Beides hängt an einem einzelnen Objekt, und das ist schon heute so (`07`).

**V5 Ein Icon-Satz.** Alle Icons im Prototyp sind echte Material Design Icons in der Umriss-Variante (Namen in den Tabellen). Gefüllte und eigene Zeichnungen fallen weg. Die Werkzeug-Varianten (Notizblock, Swimlanes, Routen) sind als kleine Bilder im selben Strich gezeichnet, weil es dafür kein passendes MDI gibt.

**V6 Eine Palette für alles.** 10 Töne plus Weiß, Grau und Schwarz, überall in derselben Reihenfolge und mit Namen. Damit gibt es keine zwei Gelbgrün und keine zwei Rosa mehr. Der kleinste Abstand zweier heller Töne liegt jetzt bei ΔE(OKLab) 0,049. Abweichungen:
- **Kräftige Töne strenger als verlangt:** Sie erreichen 4,5:1 auf Weiß und auf der Leinwand statt nur 3:1. So taugen sie auch für Text, etwa Tag-Namen.
- **Eine dritte Stufe „ondark“** gibt es nur für den Dunkelmodus (a). Auf dunkler Leinwand fallen die kräftigen Töne unter 3:1.

**V7 Ruhige Schrift.** Leisten und Leinwand nutzen dieselbe Nextcloud-Systemschrift. Notizen haben die Stufen S 16, M 22 und L 32; M ist Standard. In P1 stehen deshalb fast alle Notizen gleich groß. „Monatliche Kundeninterviews“ ist kleiner, weil das lange Wort sonst nicht passt; genau das erlaubt die Regel. Weitere Festlegungen:
- Frame-Titel stehen als Kopf **im** Frame, 24 px halbfett und dunkel.
- Lane-Namen sind 20 px halbfett.
- Der Nebenbefund „Check…“ / „Pack an…“ ist mit derselben Regel gelöst: Erst wird verkleinert, nie wird mit „…“ gekürzt.

**V8 Leichtere Auswahl.** Statt neun blauer Punkte gibt es vier Eckgriffe. Im Prototyp funktioniert die Regel live: Kommt der Zeiger an die Ecke oben rechts, erscheint der Drehgriff; kommt er an eine Kante, erscheint der Verbindungspunkt dieser Kante (in P2 ausprobieren; P3 zeigt den Zustand fest). Bei aktivem Verbinder-Werkzeug sind alle vier Punkte da. Weitere Festlegungen:
- **Mit Stift** (P10) bleiben die Punkte sichtbar und werden größer (14 px).
- **Die Punkte liegen auf der Kante**, nicht davor. So landet keiner mehr auf der Nachbarnotiz (Befund 11).

**V9 Zoomleiste kompakt.** Vier sichtbare Elemente statt acht. Was selten gebraucht wird, liegt einen Klick entfernt hinter der Prozentzahl. Der runde „?“-Knopf entfällt; die Tastenkürzel stehen jetzt an drei Stellen, die man ohnehin öffnet.

**V10 Eine Sitzungsleiste.** Timer, Abstimmung und „Alle hierher holen“ teilen sich Form, Platz und Schrift. Man lernt eine Leiste statt drei. „Moderieren“ trägt das Wort, die Fahne allein war schwer zu finden. Abweichung: „Abstimmung bearbeiten …“ und „Zwischenstand zeigen“ liegen hinter „⋯“ in der Leiste. Mit deutschen Texten bliebe die Leiste sonst nicht frei von der Zoomleiste. „+5 min“, „Liste“ und „Beenden“ bleiben sichtbar, weil man sie während der Abstimmung braucht.

**V11 Menü „Mehr“ gliedern.** Zwei Untermenüs nach Richtung (hinaus / hinein) ersetzen elf gleichrangige Einträge. Abweichung: Die Untermenüs öffnen sich als NcActions-Untermenü in derselben Liste, mit „‹ Exportieren“ als Zurück-Eintrag, statt als seitliches Ausklappmenü. So macht es Nextcloud selbst, und es funktioniert auf dem Telefon.

**V12 Einladendes leeres Board.** Ein leeres Board zeigt sofort, was man damit tun kann. Jede Vorlage hat eine Vorschau und eine Zeile Inhalt, „Leer“ ist bewusst nur umrandet. Abweichung: Die Kacheln sind HTML-Knöpfe über der Leinwand und nicht in Konva gezeichnet. So bleiben sie mit Tastatur und Screenreader bedienbar und folgen dem Fokus-Stil.

**V13 Dunkelmodus.** Beide Varianten sind zu sehen:
- **(a) P12a:** Die Leinwand ist gedämpft dunkel (#202327). Notizen bleiben hell mit dunklem Text. Linien und Äste nehmen die „ondark“-Töne, Weiß als Füllung wird zur Frame-Fläche.
- **(b) P12b:** Die Leinwand bleibt hell, die Leisten werden dunkelgrau (#2b2c30) mit weicherem Schatten.

Die Wahl trifft wie verabredet der Nutzer. Unsere Empfehlung ist (b): Sie ändert keine Nutzerfarben und braucht keine dritte Farbstufe.

**V14 Boardliste als Raster.** Große Vorschauen machen Boards auf einen Blick erkennbar, und auf dem Desktop bleibt keine Fläche mehr leer. Der Stern bleibt auf der Karte, Umbenennen und Löschen liegen im „…“. Abweichungen:
- **Desktop:** Ein nicht gesetzter Stern erscheint erst bei Zeiger oder Fokus. Dauerhaft sichtbar ist nur ein gesetzter.
- **Telefon:** Es gibt kein sichtbares „…“; die Aktionen öffnen sich per langem Drücken. So verlangt es „ohne dauerhaft sichtbare Icons“.

**V15 Weniger Karten, klare Ebenen.** Es gibt drei Ebenen mit je einem Schatten und keine Ränder. Alle Leisten haben 12 px Radius, Dialoge 16 px. Leisten wirken dadurch ruhiger als Panels, Panels ruhiger als Dialoge. Damit der Windows-Kontrastmodus die Umrisse zeigt, tragen alle Flächen einen transparenten Rand, der dort sichtbar wird.

**V16 Hinweise hell und schmal.** Ein Hinweis steht oben mittig in Nextclouds Statuspaaren: helle Fläche, dunkler Text. Die Kontraste liegen bei 7,4:1 bis 8,6:1 für Warnung, Erfolg und Fehler und bei 9,2:1 für Info mit der Standard-Primärfarbe. Er ist schließbar, und es steht immer nur einer da. Schließt man auf dem Telefon den Geräte-Hinweis, folgt „Alice Adler präsentiert · Folgen“ (P11).

**V17 Feste Personenfarbe.** In jeder Ansicht hat Alice Adler Indigo und Bob Berg Rosa: Avatar, Cursor, Namensschild und gestrichelte Auswahl. Vorgeschlagene Regel für die Factory: Farbe = kräftiger Palettenton Nr. `hash(userId) mod 10`. Weißer Text darauf erreicht mindestens 5,05:1. Gäste bekommen ihre Farbe aus der Sitzungs-ID.

---

## Offene Punkte

- **Gäste ohne „Teilen“ und „Moderieren“:** Sind das Konto-Funktionen? Der Entwurf nimmt es an (V1).
- **Dunkelmodus:** Variante (a) oder (b) wählt der Nutzer; unsere Empfehlung ist (b).
- **Primärfarbe:** Über die Leiste oben im Prototyp lässt sie sich testweise umstellen. Alle Akzente folgen `--color-primary-element`. Der Prototyp leitet den Dunkelmodus-Akzent selbst ab; in Nextcloud kommt er vom Server.
- **Nebenbefund „Alles zeigen“:** Die Funktion muss die Inseln einrechnen. Die Ränder dafür sind `--k-inset` plus Leistenbreite bzw. -höhe (`tokens.css`).
