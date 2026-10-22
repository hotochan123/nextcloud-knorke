<!--
  SPDX-FileCopyrightText: 2026 hotochan123
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Tablet-Messung R-A – Anleitung und Messprotokoll

Termin R-A aus SPEC-M1 §8.8 und §16 (Stufe 0). Gemessen wird die **Basis**: der Spike-Bench und das Szenen-Labor auf dem echten **Android-Tablet in Chrome**. Das Ergebnis entscheidet, ob LOD 2 (grobe Darstellung unter 10 % Zoom) schon in Runde 1b kommt. Dauer ≈ 30–40 Minuten, davon 10 Minuten Bedienung für die Wärmeprobe.

Das iPad (Safari) kommt erst mit R-B dran: nach der Abnahme von Stufe 4 und vor der Prod-Freigabe (P9), mit dem eigenen iPad des Nutzers (SPEC-M1 §8.8, Revision 19), siehe Abschnitt 6.

## 1. Für den Betreiber auf dem Tower

Der Tower (Unraid) liefert die Sitzung aus; der Mac mini wird nicht gebraucht. `<LAN-Adresse>` steht unten für die LAN-Adresse des Towers im Heimnetz (auf dem Entwicklungs-Host `KD_LAN_HOST` in `dev/local.env`, docs/ENTWICKLUNG.md §3.10).

1. **Paket bauen** (im Ordner der Arbeitskopie bzw. des Repos), **vor** der Sitzung:
   `dev/scene-lab/run.sh ipad`
   Das legt `dev/scene-lab/out/ipad-ra/` an (Labor `lab/`, Bench `bench/`, Sitzungsserver `session.mjs` mit `session-start.html` und `session-send.html`, diese Anleitung, `MANIFEST.txt` mit SHA-256) und prüft das Paket gleich in Chromium und WebKit. In `dev/scene-lab/out/ipad-check.md` müssen beide Browser „ok“ zeigen.
   **Während einer Sitzung kein `run.sh ipad` starten:** Es löscht `out/ipad-ra/` und baut es neu; der laufende Server liefert Labor und Bench dann nicht mehr verlässlich aus (fehlende Dateien während des Neubaus, neue Dateinamen der Labor-Skripte).
2. **Sitzung starten** (im Vordergrund, in einem eigenen Terminal):
   `node dev/scene-lab/out/ipad-ra/session.mjs <LAN-Adresse> 18612`
   Der Server bindet **nur** an die LAN-Adresse des Towers (nie `0.0.0.0`), liefert das Paket nur lesend aus und schreibt die Adressen auf:
   - Startseite `http://<LAN-Adresse>:18612/`
   - Senden `http://<LAN-Adresse>:18612/send`
   - Ergebnisordner (Standard `dev/scene-lab/out/ipad-ra-results/`)
   Optionen: `--results <Ordner>` für einen anderen Ergebnisordner (darf nicht im Paket liegen), `--hours <n>` für die Laufzeit (mehr als 0, höchstens 24, Standard 4 Stunden; danach beendet sich der Server selbst und sagt das im Terminal).
   Meldet er „port 18612 is in use“, läuft schon eine Sitzung. Dann **nichts beenden**, was nicht dir gehört, sondern einen anderen Port nehmen (z. B. `18613`) und dem Nutzer die neue Adresse nennen.
3. **Ergebnisse:** Jedes „Senden“ legt genau eine neue Datei `<UTC-Zeit>_<Bezeichnung>.json` an (`.txt`, wenn der Text kein JSON ist), z. B. `2026-10-12T15-04-11-123Z_labor-lauf-1.json`. Nachsehen mit `ls -l dev/scene-lab/out/ipad-ra-results/`. Ein neues `run.sh ipad` lässt diesen Ordner stehen.
   **Nach der Sitzung die Ergebnisse dem Orchestrator melden** (Ordner und Dateiliste): `dev/*/out` fließt beim Rückfluss einer Arbeitskopie **nicht** ins Haupt-Repo zurück, der Orchestrator übernimmt die Dateien selbst.
4. **Beenden:** im Terminal Strg+C (oder automatisch nach 4 Stunden). Danach ist nichts mehr im LAN offen.

Grenzen des Servers: nur `GET`/`HEAD` für Dateien des Pakets (keine Ordnerlisten, keine Pfade außerhalb, auch nicht über symbolische Links), `POST /result` nur mit einer Bezeichnung aus `a–z`, `0–9`, `-` (höchstens 40 Zeichen) und höchstens 4 MiB Text; Anfragen über einen anderen Hostnamen (421) oder von einer fremden Seite (403) werden abgewiesen.

## 2. Tablet vorbereiten (Android, Chrome)

- **Notieren:** Modell, Android-Version, Chrome-Version (Chrome: ⋮ → Einstellungen → Über Google Chrome), Bildwiederholrate (Einstellungen → Anzeige; 60, 90 oder 120 Hz, bei „adaptiv“ das notieren).
- **Energiesparmodus aus**, **Ladegerät an**, **Bildschirm-Zeitlimit lang** (Einstellungen → Anzeige → Bildschirm-Timeout, z. B. 30 Minuten), **Querformat**, alle anderen Tabs in Chrome und andere Apps schließen.
- Das Tablet ist im selben WLAN wie der Tower.
- In Chrome `http://<LAN-Adresse>:18612/` öffnen. Chrome zeigt „Nicht sicher“ an – im Heimnetz über http ist das normal.
- Die Startseite verlinkt: **1 · Spike-Bench**, **2 · Szenen-Labor mit Messfeld**, **3 · Ergebnis senden** und diese Anleitung. Alles im **selben Tab** öffnen (die Sendeseite merkt sich dort, was schon gesendet ist).

## 3. Ablauf

Während automatischer Läufe das Tablet **nicht berühren**. **Immer erst messen, dann „JSON kopieren“** – ein JSON von vor der Messung ist leer (in der ersten R-A-Sitzung kam so ein leeres Labor-Ergebnis an; die Sendeseite weist es jetzt ab: „Darin ist noch keine Messung …“).

Nach jedem Lauf das Ergebnis über **3 · Ergebnis senden** schicken: Text einfügen (lange drücken → Einfügen), **Bezeichnung vor jedem Senden prüfen**, „Senden“. Die Seite antwortet mit „Gespeichert: …“, zeigt darunter „Gesendet: …“ und stellt die nächste Bezeichnung ein; beides merkt sie sich in diesem Tab auch über das Neuladen hinweg. Wer einen Lauf wiederholt oder die Reihenfolge ändert, wählt die Bezeichnung von Hand.

**A · Spike-Bench** (Link 1, `bench/bench-standalone.html`) – drei Durchgänge

1. Bedienfeld: Engine **„Konva 10.7.1“**, Szenario **„Alle Szenarien“**, Szene **„100 % (voll)“** (4670 Objekte), Wiederholungen **„1“**, Schatten **an**.
2. **„Messung starten“** und ≈ 1 Minute nicht berühren, bis **„8 Messungen fertig.“** dasteht. „Alle Szenarien“ misst in einem Durchgang alle acht Szenarien nacheinander, darunter die vier, die zählen: „1 Laden → erste Vollzeichnung“, „2 Schwenken 5 s (100 %)“, „3 Zoom 10 % → 400 % → 10 % (6 s)“ und „6 Fremd-Änderungen 50/s beim Schwenken“.
3. **„JSON kopieren“**, dann senden mit der Bezeichnung **`bench-lauf-1`**.
4. Die Bench-Seite **neu laden**, die Einstellungen aus Schritt 1 erneut prüfen (nach dem Neuladen stehen wieder die Vorgaben da) und genauso den zweiten und dritten Durchgang: **`bench-lauf-2`**, **`bench-lauf-3`**. Das ergibt die drei Wiederholungen je Szenario aus SPEC-M1 §8.8, jede nach einem Neuladen.
5. Klappt „JSON kopieren“ nicht: **„JSON speichern“** (landet unter „Downloads“) und auf der Sendeseite **„… oder gespeicherte Datei wählen“**.

**B · Szenen-Labor** (Link 2, `lab/?panel=1`; seit Stufe 1 die M1-Szene: 3000 Notizen + 500 Formen + 100 Text-Objekte + 800 Verbinder + 20 Frames + 30 Platzhalter; die R-A-Messung vom 12.10. lief mit der M0-Szene ohne Formen, Text und Verbinder)

Drei Durchgänge, vor jedem die Seite **neu laden**:

1. Warten, bis die Tafel steht und das Messfeld oben rechts die Gerätezeile zeigt (… CSS-px, DPR …, Bildtakt …).
2. **„Automatik-Messung“** tippen und ≈ 1 min nicht berühren, bis „Automatik-Messung fertig.“ erscheint (Schwenken, Zoomen, Ziehen, ganzes Board; seit Stufe 4 dazu Ein-Finger-Schwenk, Folgen und Abzeichen, siehe Abschnitt 6).
3. **„Hand: 5 s Schwenk“**: nach dem Countdown 5 s lang mit **einem Finger** ohne Pause über die Tafel schwenken (nicht auf dem Messfeld).
4. **„Hand: 5 s Pinch“**: nach dem Countdown 5 s lang mit **zwei Fingern** hinein- und herauszoomen.
5. Erst jetzt **„JSON kopieren“** und senden mit **`labor-lauf-1`** (zweiter Durchgang **`labor-lauf-2`**, dritter **`labor-lauf-3`**). Klappt das Kopieren nicht, ist der Text im Feld markiert: lange drücken → Kopieren.

**C · Wärmeprobe:** Nach ≈ 10 Minuten Bedienung (im Labor schwenken und zoomen) noch einmal:

1. Labor neu laden, nur **„Hand: 5 s Schwenk“**, dann **„JSON kopieren“** → **`waerme-labor-schwenk`**.
2. Bench neu laden, Einstellungen wie in A, aber Szenario **„2 Schwenken 5 s (100 %)“**, „Messung starten“, bis „1 Messungen fertig.“ dasteht → **`waerme-bench-schwenken`**.

**D · Gerät und Notizen:** Auf der Sendeseite **`geraet-notiz`** wählen und als Freitext schreiben: Modell, Android-Version, Chrome-Version, Bildwiederholrate, Auffälligkeiten (Ruckler, weiße Flächen, Neuladen durch Chrome, Wärme).

## 4. Messprotokoll (optional zum Mitschreiben; die gesendeten JSON-Texte reichen)

Gerät: Modell ______ · Android ______ · Chrome ______ · ____ Hz · `crossOriginIsolated` ____ · Timer-Schritt ____ ms (beides steht in der Gerätezeile des Messfelds)

**Bench (Konva, 100 %)** – Mittel der 3 Durchgänge (die Szenarien 4, 5, 7 und 8 laufen mit und stehen im JSON)

| Szenario | fps | Frame p50 / p95 / p99 ms | % > 16,7 ms | % > 33 ms | % verpasst | erstes Rendern ms | ganzes Board ms |
|---|---|---|---|---|---|---|---|
| 1 Laden | – | – | – | – | – | | |
| 2 Schwenken | | | | | | – | – |
| 3 Zoom | | | | | | – | – |
| 6 Fremd-Änderungen | | | | | | – | – |
| 2 Schwenken nach 10 min | | | | | | – | – |

**Labor** – Werte aus der Tabelle des Messfelds, je Durchgang

| Messung | Lauf 1 | Lauf 2 | Lauf 3 |
|---|---|---|---|
| Erstes Rendern (Laden), ms | | | |
| Erstes Rendern ganzes Board, ms | | | |
| Schwenken (auto): fps / p95 / verpasst % | | | |
| Zoomen (auto): fps / p95 / verpasst % | | | |
| Notiz ziehen (auto): fps / p95 / verpasst % | | | |
| Ganzes Board zoomen (auto): fps / p95 / verpasst % | | | |
| Ganzes Board schwenken (auto): fps / p95 / verpasst % | | | |
| Hand: Schwenk: fps / p95 / verpasst % | | | |
| Hand: Pinch: fps / p95 / verpasst % | | | |
| Hand: Schwenk nach 10 min | | – | – |

Auffälligkeiten: ______

## 5. Was mit den Zahlen passiert

Entscheidungsregel (SPEC-M1 §8.8 Punkt 6, gilt für die R-A-Werte auf Android/Chrome; der Orchestrator wendet sie vor Stufe-1-Phase 0 an):

- **Zoom über das ganze Board < 30 fps** oder **> 25 % verpasst** oder **erstes Rendern > 1 s** → LOD 2 rückt in Runde 1b vor.
- **Schwenken < 45 fps** → Profiling des Cullings als Arbeit in Stufe 4.

„verpasst“ ist die robuste Größe: Über http im LAN ist die Seite nicht isoliert, `performance.now()` ist dort grob. Die Hand-Messungen können bei einer anderen Bildwiederholrate laufen als die Automatik (z. B. 120 Hz statt 60 Hz); ihr „verpasst“ deshalb nur zusammen mit p50/p95 lesen. Safari/WebKit bleibt bis R-B ein offenes Risiko: WebKit im Labor-Container (headless WPE) erreicht mit den geprüften Startwegen die GPU nicht und rendert in Software (`dev/scene-lab/out/webkit-gpu.md`); es ersetzt kein Gerät.

## 6. iPad mit Safari (R-B, nach Stufe 4, eigenes iPad)

Gleiches Paket, gleiche Abläufe A–D, aber der Sitzungsserver läuft in R-B auf **Port 18613**, weil 18612 dann das Relais der echten App ist (SPEC-M1 §8.1, §8.8 Punkt 2):
`node dev/scene-lab/out/ipad-ra/session.mjs <LAN-Adresse> 18613`, am iPad `http://<LAN-Adresse>:18613/`. R-B misst zusätzlich die echte App (SPEC-M1 §8.8 Punkt 1c, eigener Termin).

Seit Stufe 4 misst die Automatik-Messung mehr, als die Tabelle des Messfelds zeigt (alles steht im JSON von „JSON kopieren“): den Ein-Finger-Schwenk bei 100 % im Modus view (CSS-Pfad, wie auf einem Tablet), Folgen kurz und lang (`followShort`, `followLong`) und das Schwenken über 600 Notizen mit Abzeichen im Modus vote, ohne und mit Summen (`badgePan`, `badgeTotalsPan`). Die Notiz-Schatten zeichnet die Szene seit Stufe 4 mit Verläufen statt mit Canvas-`shadowBlur` (im Labor kostete WebKit der Weichzeichner je Notiz am meisten). Für einen Vergleich ohne Schatten das Labor mit `lab/?panel=1&shadows=0` öffnen und die Bezeichnung entsprechend wählen (z. B. `labor-ohne-schatten-1`). Die Entscheidungsregel für R-B steht in SPEC-M1 §8.8 Punkt 6 in der Fassung von Revision 19 (Befund an das Szenen-Paket in der Fix-Runde nach R-B; bleibt er rot, entscheidet der Nutzer vor P9).

- Notieren: Modell, iPadOS-Version, Safari-Version, Bildwiederholrate (60 Hz oder 120 Hz ProMotion).
- Stromsparmodus aus, Ladegerät an, Auto-Sperre aus, alle anderen Tabs schließen, Querformat.
- Optional für die Timeline (Rendering Frames, Memory) während „Hand: 5 s Schwenk“ und „Hand: 5 s Pinch“: am iPad Einstellungen → Apps → Safari → Erweitert → Web-Inspektor an; am Mac Safari → Einstellungen → Erweitert → „Funktionen für Webentwickler“, iPad per USB-C oder Netz koppeln.
- Kopieren auf dem iPad: Klappt „JSON kopieren“ nicht, ist der Text im Feld markiert (lange drücken → Kopieren).
- Ersatzweg ohne Tower: Das Paket enthält auch `serve.mjs` und `index.html` für einen Rechner mit Node (`node serve.mjs <LAN-IP> 8000`); dieser Weg hat keine Sendeseite, die JSON-Texte gehen dann per Hand an den Orchestrator. Der Mac mini hat kein Node.
