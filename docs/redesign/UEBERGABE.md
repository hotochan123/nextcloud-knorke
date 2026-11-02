# Knorke: Übergabe für eine Re-Design-Runde

Stand 29.10.2026. Geschrieben für OpenDesign und für alle, die den Entwurf später prüfen.

## 1. Worum es geht

Knorke ist ein Whiteboard als Nextcloud-App. Teams halten damit Workshops ab: Notizen, Frames, Abstimmungen, Timer und Kommentare. Seit Oktober zeichnet man darin auch Diagramme: Formen, Verbinder, Swimlanes, Mindmaps, Organigramme und BPMN.

In wenigen Wochen sind viele Funktionen dazugekommen. Jede hat sich ihren Knopf dort genommen, wo gerade Platz war. Deshalb wirkt die Oberfläche jetzt voll und unruhig.

**Ziel dieser Runde:** das Erscheinungsbild vereinfachen und beruhigen, ohne eine Funktion zu verlieren. Neue Funktionen gehören nicht dazu.

**Ergebnis, das wir brauchen:**
1. Ein klickbarer HTML-Prototyp der Kernansichten (Liste in Abschnitt 6).
2. Eine Token-Datei mit Abständen, Radien, Schatten, Farben und Schriftgrößen.
3. Eine Zuordnungstabelle: jedes heutige Bedienelement (Inventar in Abschnitt 7) mit seinem Platz im neuen Entwurf.

Umgesetzt wird der Entwurf danach Schritt für Schritt von der Knorke-Factory. Deshalb muss alles im Rahmen von Abschnitt 2 bleiben.

## 2. Fester Rahmen

- **Nextcloud drumherum.** Knorke läuft in Nextcloud 34, unter dessen blauer Kopfleiste. Knorke kann diese Leiste nicht entfernen oder umfärben, sie gehört in jeden Screen.
  - Die Primärfarbe stellt der Nextcloud-Admin ein. Im Prototyp gilt Nextclouds Standard `#00679e`, er darf aber nicht fest eingebaut wirken: Akzente laufen über eine Variable.
- **Bausteine.** Knöpfe, Menüs, Dialoge und die Navigation der Boardliste sind Nextcloud-Vue-Komponenten: NcButton, NcActions, NcDialog, NcAppNavigation.
  - Ändern darf der Entwurf: Anordnung, Gruppierung, Größe, Abstände, Icons, Leistenformen und alle Farben der Leinwand.
  - Eine eigene Komponentenbibliothek darf er nicht einführen.
- **Leinwand.** Notizen, Formen, Frames, Verbinder, Tabellen und Mindmaps sind auf ein Canvas gezeichnet (Konva), sie sind kein HTML.
  - Der Entwurf legt für sie Farben, Schrift, Linienstärken, Ecken, Schatten und Auswahlgriffe fest.
  - Im Prototyp dürfen sie als SVG nachgebaut sein.
- **Dunkelmodus.** Heute folgen die Leisten dem Nextcloud-Thema, die Leinwand bleibt aber immer hell. Siehe Vorschlag V13.
- **Barrierefreiheit.**
  - Kontrast nach WCAG 2.2 AA: Text 4,5:1, Bedienelemente und Linien 3:1.
  - Sichtbarer Tastaturfokus.
  - Fingerziele mindestens 44 px bei Touch.
  - Funktioniert mit Windows-Kontrastmodus (forced-colors) und mit „Bewegung reduzieren“.
- **Geräte.**
  - Desktop mit Maus.
  - Mac mit Safari.
  - Android-Tablet mit Stift (Samsung, Chrome): Bearbeiten mit dem Stift, Schwenken mit dem Finger.
  - Telefon und Tablet ohne Stift: nur ansehen und abstimmen.
  - Ein iPad gibt es nicht.
- **Sprachen.** Deutsch und Englisch. Deutsche Texte sind etwa 30 % länger, Leisten mit Text müssen das aushalten. Den Prototyp bitte auf Deutsch, mit den Begriffen aus dem Glossar (Abschnitt 8).
- **Bleibt so:**
  - der Name „Knorke“;
  - die Standardfarbe neuer Notizen: Hellblau, bewusst nicht Gelb;
  - Gäste ohne Konto sehen dieselbe Oberfläche ohne die Konto-Funktionen.

## 3. Heutiger Stand in Bildern

Alle Bilder liegen in `screenshots/heute/` (Desktop 1440 × 900 px, Tablet 820 × 1180, Telefon 390 × 844). Sie zeigen ein Demo-Board „Q4 planning workshop“ in englischer Oberfläche. Ältere Bilder einer laufenden Abstimmung und des Ausrichten-Menüs liegen in `screenshots/aelter/`.

| Bild | Zeigt |
|---|---|
| `01-board-list.png` | Boardliste: links die Nextcloud-Navigation, rechts die Liste mit kleinen Skizzen |
| `02-board-overview.png` | Board nach „Alles zeigen“: Frame mit Notizen, Swimlane-Ablauf, Mindmap, Cursor einer zweiten Person |
| `03-note-selected-contextbar.png` | Eine Notiz ausgewählt: Kontextleiste, Auswahlgriffe |
| `04-note-fill-panel.png` | Farbfeld der Notiz offen |
| `05-shape-selected-contextbar.png` | Raute im Ablauf ausgewählt: Kontextleiste für Formen |
| `07-multi-selection.png` | Alles ausgewählt (21 Objekte) |
| `08-shapes-panel.png` | Formen-Panel (Grundformen, Flussdiagramm, BPMN, Bibliotheken) |
| `09-tool-options-menu.png` | Pfeil-Menü am Form-Werkzeug (sechs Grundformen als Textliste) |
| `10-board-more-menu.png` | Menü „Mehr“ (…) mit elf Einträgen |
| `11-facilitate-menu.png` | Menü „Moderieren“ (Fahnen-Icon) |
| `12-share-dialog.png` | Dialog „Board teilen“, Reiter „Links“ |
| `13-comments-panel.png` | Kommentar-Panel rechts |
| `14-zoomed-far-out.png` | Weit herausgezoomt (14 %) |
| `15-empty-board.png` | Leeres Board |
| `16-dark-mode.png` | Nextcloud im Dunkelmodus, Notiz ausgewählt |
| `17-phone-board.png`, `18-phone-board-list.png` | Telefon: Board und Boardliste |
| `19-tablet-board.png` | Tablet ohne Stift |
| `aelter/abstimmung.png` | Laufende Abstimmung: Leiste unten, Zähler an den Notizen |

Die Werte, mit denen Knorke heute zeichnet, stehen in `heute-tokens.css`. Das sind die Rollen-Token der Leisten und alle Paletten der Leinwand.

### So ist die Oberfläche heute aufgebaut

- **Kopfleiste**, eine weiße Karte über die volle Breite: Zurück, Board-Titel (umbenennbar), Hinweis „Per Link offen“, Hinweis „Gast“, Timer-Chip, Avatare der Anwesenden (anklicken = folgen), Kommentare, Moderieren (Fahne), Teilen, Mehr (…).
- **Werkzeugleiste**, senkrecht am linken Rand, 10 Werkzeuge:

  | Werkzeug | Taste | Varianten im Pfeil-Menü |
  |---|---|---|
  | Auswählen | V | |
  | Schwenken (Hand) | H | |
  | Notiz | N | Notiz / Notizblock |
  | Form | S | 6 Grundformen |
  | Text | T | |
  | Tabelle | B | |
  | Mindmap | M | |
  | Verbinder | L | Route, Spitze |
  | Frame | F | Frame / Swimlanes |
  | Laserpointer | K | |

  Darunter folgen der Knopf für das Formen-Panel sowie Rückgängig und Wiederholen.
- **Kontextleiste**, erscheint bei einer Auswahl in ihrer Nähe. Je nach Auswahl hat sie bis zu etwa 25 Knöpfe in einer Reihe:
  - Aussehen: Füllung, Rand/Linie, Text, Kopfzeile, Ast, Layout, Form, Route, Spitzen, Beschriftung, Umbenennen
  - Platz: Verbinden, Nach Farbe sortieren, Anordnen (X/Y/B/H/Winkel), Objekte ausrichten
  - Zusammenarbeit: Kopieren, Reaktion, Kommentar, Tags
  - Bearbeiten: Ausschneiden, Duplizieren, Nach vorne, Nach hinten, Löschen
  - Gruppe und Sperre: Gruppieren, Gruppierung lösen, Sperren, Entsperren
  - am Ende „n ausgewählt“, das als Filter dient
- **Zoomleiste** unten rechts:
  - Tastenkürzel (ein runder „?“-Knopf daneben)
  - Frames-Liste
  - Auf Auswahl zoomen (nur mit Auswahl)
  - −, Prozentanzeige, +
  - Alles zeigen
- **Panels:** Formen (links), Kommentare (rechts), Abstimmungsliste (rechts), Tags. Auf dem Telefon füllen sie den Bildschirm.
- **Unten mittig** sitzt während einer Abstimmung die Abstimmungsleiste: verbleibende Stimmen, Restzeit, Anzahl Abstimmender, Bearbeiten, +5 min, Beenden, Liste.
- **Dialoge:** Teilen (Personen und Links, QR-Code, „Dem Raum zeigen“), Vorlagen, Timer, Abstimmung einrichten, Als PDF speichern, Formbibliothek importieren, Tastenkürzel, Gastname.
- **Hinweise:** Banner oben (Verbindung, Folgen, „Auf diesem Gerät kannst du ansehen und abstimmen. Bearbeiten geht am Computer.“) und Toasts.
- **Leinwand:**
  - Hintergrund `#f1f1ec`.
  - Notizen: 14 Farben, leichter Schatten, Schrift Arial, Textgröße automatisch.
  - Frames: weiß mit grauem Rand, Titel grau über dem Frame.
  - Swimlanes: graue Kopfspalte.
  - Formen haben eine eigene Palette mit 16 Farben, Verbinder eine mit 8, Mindmap-Äste eine mit 8, Tags eine mit 12.
  - Auswahl: blaue Eckgriffe, ein Drehgriff und blaue Punkte zum Verbinden.
  - Andere Personen: Cursor mit Namensschild, ihre Auswahl gestrichelt in ihrer Personenfarbe.

## 4. Was auffällt

1. **Doppelte Kopfleiste.** Unter Nextclouds blauer Leiste liegt eine zweite, weiße Leiste über die volle Breite. Zusammen kosten sie gut 100 px Höhe, und die Mitte der Knorke-Leiste bleibt leer (`02`).
2. **Lange Werkzeugleiste.** Sie hat 13 Knöpfe, 4 kleine Pfeile und Trenner. Sie überdeckt Inhalt am linken Rand (`02`, `03`). Die Pfeile machen sie breiter und unruhig.
3. **Formen an zwei Stellen.** Das Pfeil-Menü des Form-Werkzeugs zeigt sechs Formen als Textliste mit Radioknöpfen (`09`). Das Formen-Panel zeigt dieselben Formen noch einmal als Bilder, plus alle anderen (`08`).
4. **Kontextleiste.** Sie ist lang und flach: lauter gleich gewichtete Icons ohne Rangfolge (`03`, `05`). Sie legt sich über die Werkzeugleiste (`03`) und über Inhalt (`05`) und springt je nach Auswahl an andere Stellen. „1 ausgewählt“ steht als Text am Ende.
5. **Gemischte Icons.** Ein Teil stammt aus Material Design Icons (gefüllt), ein Teil sind eigene Umrisszeichnungen. Die Hand ist gefüllt, die Notiz nur umrandet, der Laserpointer wieder gefüllt.
6. **Menü „Mehr“.** Elf gleichrangige Einträge, Export und Import durcheinander (`10`).
7. **Moderieren** ist nur eine Fahne ohne Beschriftung, schwer zu finden (`11`). Timer-Chip, Abstimmungsleiste und „Alle hierher holen“ sehen jeweils anders aus.
8. **Zoomleiste.** Sieben Elemente plus einen runden „?“-Knopf daneben. Die Frames-Liste versteckt sich hinter einem Rechteck-Icon.
9. **Unruhige Schrift auf der Leinwand.**
   - Die Textgröße der Notizen richtet sich nach der Textmenge. Nebeneinander stehen deshalb winzige und riesige Texte (`02`: „Self-service onboarding“ neben „Dark mode“).
   - Auf der Leinwand steht Arial, in den Leisten die Systemschrift.
   - Frame-Titel sind klein und grau über dem Frame.
   - Lane-Namen sind sehr klein (`02`).
10. **Fünf Paletten.** Notizen 14, Formen 16, Verbinder 8, Mindmap 8, Tags 12 Farben, jede in eigener Reihenfolge. Einige Notizfarben sind kaum zu unterscheiden: zwei Gelbgrün, zwei Rosa (`04`).
11. **Viel Blau bei einer Auswahl.** Eckgriffe, Drehgriff, vier Verbindungspunkte, und ein Punkt liegt sogar auf der Nachbarnotiz (`03`).
12. **Viele Karten.** Kopfleiste, Werkzeugleiste, Kontextleiste, Zoomleiste und Panels sind alle weiße Karten mit Rand und Schatten. Sie wirken gleich wichtig.
13. **Leeres Board.** Es zeigt nur einen Knopf „Mit einer Vorlage beginnen“ (`15`).
14. **Boardliste.**
    - Schmale Liste, Skizzen nur 48 × 32 px.
    - Stern, Umbenennen und Löschen sind immer sichtbar. Auf dem Telefon schneiden sie die Titel ab (`18`).
    - Auf dem Desktop bleibt viel Fläche leer (`01`).
15. **Dunkelmodus.** Schwarze Leisten liegen über heller Leinwand, das ist ein harter Kontrast (`16`).
16. **Personenfarbe.** Die eigene Farbe wechselt je Sitzung, zum Beispiel ein rotes „AA“ in `02` und ein lila „AA“ in `15`. Das wirkt zufällig.
17. **Hinweis-Banner.** Er ist eine dunkle Pille, die über dem Inhalt liegt (`17`, `19`).

## 5. Vorschläge

Sortiert nach Wirkung. Zu jedem Vorschlag bitte im Prototyp zeigen, wie er aussieht. Wo zwei Wege genannt sind, beide als Variante.

**V1 Kopfzeile als zwei Inseln statt einer Leiste über die volle Breite.**
- Links: Zurück, Titel, Hinweise („Per Link offen“, „Gast“).
- Rechts: Avatare, Kommentare, Moderieren, Teilen (primär), Mehr.
- Die Mitte bleibt Leinwand. Der Timer-Chip wandert in die Sitzungsleiste (V10).

**V2 Werkzeugleiste kürzen.**
- Sichtbar bleiben: Auswählen, Schwenken, Notiz, Form, Verbinder, Text, Frame.
- Tabelle, Mindmap und Laserpointer wandern in eine Gruppe „Mehr Werkzeuge“ (ein Knopf, der ein kleines Raster öffnet).
- Varianten bekommen keinen eigenen Pfeil mehr: Notizblock, Swimlanes, Route und Spitze. Stattdessen eine kleine Ecke am Icon. Ein zweiter Klick, langes Drücken oder Rechtsklick öffnet die Varianten mit Bildern statt Radioknöpfen.
- Rückgängig und Wiederholen wandern als eigene kleine Insel nach unten links.
- Die Leiste bleibt senkrecht links, denn unten liegt während einer Abstimmung die Abstimmungsleiste.

**V3 Ein Ort für Formen.**
- Das Form-Werkzeug öffnet direkt das Formen-Panel; das Pfeil-Menü mit der Textliste entfällt.
- Die zuletzt benutzte Form liegt als Schnellwahl oben im Panel.

**V4 Kontextleiste mit fester Ordnung, höchstens etwa 8 sichtbare Knöpfe.**
1. Ein Farbpunkt. Er öffnet ein Panel mit Reitern für Füllung, Rand und Text, dazu Schriftgröße und Ausrichtung.
2. Was zum Objekttyp gehört: Form wechseln, Route, Spitzen, Layout, Ast, Kopfzeile.
3. Zusammenarbeit: Reaktion, Kommentar, Tags.
4. „…“ für den Rest: Ausschneiden, Kopieren, Duplizieren, Ebenen, Gruppieren, Sperren, Anordnen, Ausrichten und Verteilen, Nach Farbe sortieren, Löschen.

Weitere Regeln:
- Die Anzahl der ausgewählten Objekte steht als kleiner Chip vorn.
- Die Leiste steht über der Auswahl, sonst darunter. Werkzeugleiste, Kopfzeile und Zoomleiste überdeckt sie nie.
- Bei Mehrfachauswahl rückt „Ausrichten“ nach vorne.

**V5 Ein Icon-Satz.**
- Material Design Icons in der Umriss-Variante, 20 px, eine Strichstärke. Das passt zu Nextcloud.
- Eigene Zeichnungen nur, wo es nichts Passendes gibt, und dann im selben Stil.

**V6 Eine Palette für alles.**
- Etwa 10 Farbtöne plus Weiß, Grau und Schwarz.
- Jeder Ton hat zwei Stufen:
  - eine helle für Notizen und Füllungen, mit dunklem Text darauf mindestens 4,5:1;
  - eine kräftige für Linien, Text und Mindmap-Äste, auf Weiß und auf der Leinwand mindestens 3:1.
- Überall dieselbe Reihenfolge.
- Jede Farbe bekommt einen Namen („Hellblau“, „Salbei“ …) für Screenreader und für „Nach Farbe sortieren“.
- Alte Boards behalten ihre Farben, Knorke kennt schon eine Zuordnung zur nächstliegenden Farbe. Der Farbwähler zeigt nur noch die neue Palette, dahinter „Eigene Farbe“.

**V7 Ruhige Schrift auf der Leinwand.**
- Eine Schrift für Leisten und Leinwand.
- Notiztext in drei festen Stufen S, M und L, Standard M. Verkleinert wird nur, wenn der Text sonst nicht passt. So stehen nebeneinander gleich große Texte.
- Frame-Titel dunkler und halbfett, als Kopf im Frame oder direkt darüber.
- Lane-Namen mindestens so groß wie normaler Text.

**V8 Leichtere Auswahl.**
- Nur Eckgriffe in der Primärfarbe.
- Den Drehgriff zeigen, wenn der Zeiger in die Nähe kommt.
- Die Verbindungspunkte zeigen, wenn der Zeiger an den Rand kommt oder das Verbinder-Werkzeug aktiv ist. Mit Stift oder Finger bleiben sie sichtbar, weil es dort keinen schwebenden Zeiger gibt.

**V9 Zoomleiste kompakt.**
- Sichtbar: −, Prozent, +, Alles zeigen.
- Ein Klick auf die Prozentzahl öffnet ein Menü: 100 %, Auf Auswahl zoomen, Frames ▸, Tastenkürzel.
- Der runde „?“-Knopf entfällt.

**V10 Eine Sitzungsleiste unten mittig.**
- Timer, Abstimmung und „Alle hierher holen“ in einer Leiste mit einem gemeinsamen Stil.
- Sie ist nur sichtbar, solange etwas läuft.
- Moderieren in der Kopfzeile bekommt neben der Fahne auch das Wort „Moderieren“.

**V11 Menü „Mehr“ gliedern.**
- „Exportieren ▸“: PNG, SVG, PDF …, BPMN, CSV, Board-Datei.
- „Einfügen ▸“: Vorlage …, Boarddatei …, BPMN-Datei …, CSV …
- Dann einzeln: „Als Vorlage vorschlagen …“, „Tastenkürzel“, „Rechtliches“.

**V12 Einladendes leeres Board.**
- Vorlagen als Kacheln direkt auf der Leinwand: Retrospektive, SWOT, Kanban, Brainstorming, Leer.
- Darunter zwei kurze Hinweise: Doppelklick legt eine Notiz an; eingefügter Text wird zu Notizen oder zu einer Mindmap.

**V13 Dunkelmodus.** Zwei Varianten zeigen:
- (a) Die Leinwand wird gedämpft dunkel, Notizen bleiben farbig und hell.
- (b) Die Leinwand bleibt hell, die Leisten werden im Dunkelmodus dunkelgrau statt schwarz, mit weicherem Übergang.

Die Wahl trifft der Nutzer danach.

**V14 Boardliste als Raster.**
- Karten mit großer Vorschau (etwa 240 × 150), Titel und Zeit darunter.
- Der Stern liegt auf der Karte. Umbenennen und Löschen wandern in ein „…“.
- Ein Umschalter für Raster und Liste.
- Auf dem Telefon eine oder zwei Spalten ohne dauerhaft sichtbare Icons.
- „Neues Board“ fragt gleich nach einer Vorlage, mit „Leer“ als Standard.

**V15 Weniger Karten, klare Ebenen.**
- Leisten: eine flache Ebene, ein leichter Schatten, kein Rand.
- Panels und Menüs: eine Ebene darüber.
- Dialoge: ganz oben.
- Gleiche Eckenradien für alle Leisten.

**V16 Hinweise hell und schmal.**
- Hinweise erscheinen oben mittig unter der Kopfzeile, sind schließbar und überdecken keinen Inhalt.
- Status steht in Nextclouds Paaren aus heller Fläche und dunklem Text.

**V17 Feste Personenfarbe.** Jedes Konto behält in jeder Sitzung seine Farbe. Das ist Verhalten, nicht nur Optik: nur zeigen, umgesetzt wird es in der Factory.

## 6. Lieferumfang des Prototyps

Ein HTML-Prototyp mit diesen Ansichten. Inhalt wie im Demo-Board, Texte auf Deutsch.

| Nr. | Ansicht | Größe |
|---|---|---|
| P1 | Board ohne Auswahl: Frame mit Notizen, Swimlane-Ablauf, Mindmap, zweite Person mit Cursor | Desktop |
| P2 | Wie P1, eine Notiz ausgewählt, Kontextleiste, Farbpanel offen | Desktop |
| P3 | Wie P1, eine Form im Ablauf ausgewählt | Desktop |
| P4 | Mehrfachauswahl mit Ausrichten | Desktop |
| P5 | Formen-Panel offen, Werkzeug-Varianten offen (Notiz/Notizblock) | Desktop |
| P6 | Menü „Mehr“ gegliedert, Menü „Moderieren“ | Desktop |
| P7 | Laufende Abstimmung mit Timer in der Sitzungsleiste, Zähler an Notizen | Desktop |
| P8 | Leeres Board mit Vorlagen-Kacheln | Desktop |
| P9 | Boardliste | Desktop und Telefon |
| P10 | Board mit Stift bearbeiten | Tablet 820 × 1180 |
| P11 | Board ansehen und abstimmen | Telefon 390 × 844 |
| P12 | P2 im Dunkelmodus, Varianten (a) und (b) | Desktop |

Dazu kommen:
- `tokens.css` mit Abständen, Radien, Ebenen und Schatten, Leistenhöhen, der Palette (Name, hell, kräftig, Kontrastwerte) und den Schriftgrößen der Leinwand. Akzentfarben über Variablen, so wie Nextcloud sie liefert.
- `zuordnung.md`: jede Zeile des Inventars (Abschnitt 7) mit ihrem Platz im neuen Entwurf, als Tabelle „heute → neu“. Nichts darf fehlen.
- Zu jedem Vorschlag ein bis zwei Sätze, warum. Wo der Entwurf von einem Vorschlag abweicht, auch warum.

## 7. Inventar: jedes Bedienelement von heute

Diese Liste muss in `zuordnung.md` vollständig wieder auftauchen.

**Kopfzeile:**
- Zurück
- Titel umbenennen
- Hinweis „Per Link offen“ (öffnet eine Datenschutz-Info)
- Hinweis „Gast“
- Timer-Chip
- Avatare mit Folgen und „+n“-Liste
- Kommentare
- Moderieren: Abstimmung starten, Timer, Alle hierher holen, Beenden
- Teilen
- Mehr: Als Bild speichern (PNG), Als SVG speichern, Als PDF speichern …, Als BPMN speichern, Als CSV speichern, Board herunterladen, Als Vorlage vorschlagen …, Vorlage einfügen …, Boarddatei einfügen …, BPMN-Datei einfügen …, CSV importieren …, Rechtliches

**Werkzeuge:**
- Auswählen, Schwenken (Hand)
- Notiz (Notiz / Notizblock)
- Form (Grundformen)
- Text, Tabelle, Mindmap
- Verbinder (Route Gerade/Rechtwinklig/Gebogen, Spitzen)
- Frame (Frame / Swimlanes)
- Laserpointer
- Formen-Panel
- Rückgängig, Wiederholen

**Formen-Panel:**
- Suche
- Gruppen: Grundformen, Flussdiagramm, BPMN, Bibliotheken
- Formen importieren …
- eigene Bibliotheken mit Menü und Status „Wartet auf Freigabe“

**Kontextleiste:**
- Füllung mit Deckkraft
- Rand oder Linie mit Stärke und Strichart
- Text: Farbe, Größe (auch „Auto“), horizontale und vertikale Ausrichtung
- Kopfzeile (Tabelle)
- Ast und Layout (Mindmap)
- Form wechseln
- Route, Spitzen, Richtung tauschen, BPMN-Flussarten
- Beschriftung bearbeiten, Umbenennen
- Verbinden
- Nach Farbe sortieren
- Anordnen (X, Y, B, H, Winkel)
- Objekte ausrichten und verteilen, Aufräumen
- Kopieren, Reaktion, Kommentar, Tags
- Ausschneiden, Duplizieren, Nach vorne, Nach hinten, Löschen
- Gruppieren, Gruppierung lösen
- Sperren, Entsperren
- „n ausgewählt“ als Filter

**Zoom:**
- Tastenkürzel
- Frames-Liste
- Auf Auswahl zoomen
- Herauszoomen, 100 %, Hereinzoomen
- Alles zeigen

**Rechtsklick-Menü:** dieselben Bearbeiten-Befehle, dazu „Raster anzeigen“.

**Panels:**
- Kommentare: Neuer Kommentar, Blasen anzeigen, Offen/Erledigt
- Abstimmungsliste
- Tags mit Filter-Chip
- Formen

**Sitzung:**
- Abstimmungsleiste: verbleibende Stimmen, Restzeit, Anzahl Abstimmender, Bearbeiten, +5 min, Beenden, Liste, Zwischenstand
- Zähler-Abzeichen an Objekten
- Reaktionen
- Kommentar-Blasen
- Folgen-Banner, Chip „… präsentiert · Folgen“

**Dialoge:**
- Teilen: Personen, Links, Passwort, QR-Code, Dem Raum zeigen
- Vorlagen
- Timer
- Abstimmung einrichten
- PDF
- Formbibliothek
- Tastenkürzel
- Gastname mit Datenschutzhinweis
- Bestätigen

**Boardliste:**
- Neues Board
- Alle Boards, Favoriten, Meine, Mit mir geteilt
- Sortieren
- je Board: Skizze, Titel, Zeit, Favorit, Umbenennen, Löschen
- leere Zustände

## 8. Glossar (Oberfläche Deutsch / Englisch)

| Deutsch | English |
|---|---|
| Notiz | Note |
| Notizblock | Note pad |
| Form | Shape |
| Formen | Shapes |
| Text | Text |
| Tabelle | Table |
| Mindmap | Mind map |
| Verbinder | Connector |
| Frame | Frame |
| Swimlanes | Swimlanes |
| Laserpointer | Laser pointer |
| Auswählen | Select |
| Schwenken | Pan |
| Teilen | Share |
| Moderieren | Facilitate |
| Mehr | More |
| Kommentare | Comments |
| Abstimmung starten | Start voting |
| Timer | Timer |
| Alle hierher holen | Bring everyone here |
| Alles zeigen | Show everything |
| Füllung | Fill |
| Tags | Tags |
| Sperren | Lock |
| Anordnen | Arrange |
| Objekte ausrichten | Align items |
| Mit einer Vorlage beginnen | Start with a template |
| Alle Boards | All boards |
| Neues Board | New board |
| Tastenkürzel | Keyboard shortcuts |

## 9. Nebenbefunde für die Factory, keine Design-Aufgabe

- „Alles zeigen“ rechnet die schwebenden Leisten nicht ein. Inhalt landet unter der Werkzeugleiste und am oberen Rand unter der Kopfzeile (`02`).
- Beschriftungen in Rechtecken werden bei 52 % Zoom mit „…“ abgeschnitten („Check…“, „Pack an…“), obwohl zwei Wörter verkleinert passen würden. In der Raute daneben wird dagegen verkleinert (`02`).

## 10. Entscheidungen nach dem ersten Entwurf (29.10.2026)

- **Dunkelmodus: Variante (b).** Die Leinwand bleibt hell, die Leisten werden im Dunkelmodus dunkelgrau (#2b2c30) statt schwarz, mit weicherem Schatten. Variante (a) mit dunkler Leinwand entfällt, die Palette braucht keinen dritten Ton.
- **Gäste:** Teilen und Moderieren gibt es nur für Konten (so ist es heute im Code). Die Annahme des Entwurfs stimmt.
- **Noch zu beheben** (beim Durchsehen des ersten Entwurfs gefunden):
  1. Das Farbfeld deckt den Rest der Kontextleiste samt „…“ zu (P2).
  2. Das schwarze Farbfeld ist auf dem dunklen Panel unsichtbar, es braucht einen Rand (P12b).
  3. Auf dem Telefon decken die runden „+“-Knöpfe zum Abstimmen den Notiztext zu (P11).
  4. Notizen mit langen Wörtern haben deutlich kleineren Text als ihre Nachbarn.
