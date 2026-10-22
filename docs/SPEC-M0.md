# Knorke M0 „Gerüst“ – Implementierungs-Spezifikation

Stand 11.10.2026, **Revision 5** (R2 vom 10.10.2026: Architektur-Review mit 17 blockierenden und 45 weiteren Befunden, siehe §13; R3: Befunde aus Phase 1, die Spezifikation folgt der abgenommenen Implementierung, siehe §14; R4 vom 11.10.2026: Review nach Phase 2, 17 Befunde T1–T17, siehe §15; **R5 vom 11.10.2026: Review-Runde 2, die 16 in Runde 1 zurückgestellten Befunde (OPS-1…5, CLIENT-7…10, NC-1…7) als Arbeitspunkte U1–U20, dazu Restnotizen aus Runde 1, siehe §16**). Diese Spezifikation ist für M0 verbindlich. Prosa deutsch, Bezeichner, Code und JSON englisch.

**Rangfolge der Quellen** (bei Widerspruch gilt die höhere):

1. diese Spezifikation
2. `claude_projects/knorke-spike/ERGEBNIS.md` §3 (13 Korrekturen); sie überschreibt das Dossier
3. `claude_projects/miro-recherche-2026-10/RECHERCHE.md` §4, §6, §9
4. Spike-Code unter `knorke-spike/poll/` und `knorke-spike/engine/` (was portiert wird, steht in §11)
5. Pulse-Konventionen (`$KD_PROD_STACK_DIR/nextcloud_html/apps/pulse` im Prod-Stack, nur lesen)

Wo diese Spezifikation bewusst vom Dossier oder vom Spike abweicht, steht im Text **Abweichung**. Was das Review geändert hat, ist mit **(R2)** markiert, was Phase 1 geändert hat, mit **(R3)**, was das Review nach Phase 2 geändert hat, mit **(R4)**, was Review-Runde 2 geändert hat, mit **(R5)**.

---

## 0. Leitplanken für alle Arbeitspakete

- **Repo-Ort:** der Checkout `…/claude_projects/knorke/` auf dem Entwicklungs-Host (im Folgenden `$ROOT`).
  - Nie unter `nextcloud_html/`, denn Prod liefert dieses Verzeichnis aus.
  - Das Repo wird nur read-only in `custom_apps/knorke` von Wegwerf-Containern gemountet.
- **Prod ist tabu:** alle Container `nextcloud-nextcloud-*` (`nextcloud-nextcloud-1`, `-db-1`, `-redis-1`, `-cron-1`, `-collabora-1`) werden nie angefasst (kein `exec`, kein `restart`, kein schreibender Mount). Lesend erlaubt ist nur `docker ps`/`inspect`.
- **Wegwerf-Container:**
  - heißen `knorke-*` und publizieren Ports nur auf `127.0.0.1`
  - werden mit `docker rm -fv` abgebaut (die anonymen Volumes haben einmal `docker.img` gefüllt)
  - `rm -rf` steht nur mit Schutz da: `"${VAR:?}/…"`
  - **(R2) Dev-Stacks sind nach Namensraum getrennt** (`KD_NS`, §8.1). Jedes Paket fasst nur Container, Netze und Zustände seines eigenen Namensraums an; `knorke-lab-*` gehört allein [S].
- **Node:**
  - `node_modules/.bin` ist auf dem Unraid-Pool, auf dem `$ROOT` liegt, nicht ausführbar. Werkzeuge laufen deshalb immer als `node node_modules/<pkg>/bin/<x>.js`; `npx` gibt es nicht.
  - Host-Node ist 22.18.0, npm 10.9.3. Auf dem Host gibt es kein python3.
  - **(R2) Nur [C] führt im Wurzelverzeichnis `npm ci`/`npm install` aus, und nur in Phase 0** (§10). Danach ist `$ROOT/node_modules` für alle nur lesbar. Die Unterprojekte `dev/e2e/` und `dev/scene-lab/` haben eigene `package.json`/`node_modules`, die ihr Besitzer installiert.
  - **(R2) Frontend-Builds** laufen nur über `dev/build.sh` (exklusive Sperre `flock`, §8.1), sobald es existiert.
- **Keine Git-Commits** in den M0-Arbeitspaketen. Der Nutzer committet selbst.
- **Sprache:**
  - UI-Texte als englische Quelltexte über l10n, `l10n/de.json` von Hand gepflegt. **(R2)** Nur [C] besitzt `l10n/`; [S] darf ausschließlich die in §6.9 aufgezählten Quelltexte benutzen, [B] keine (Fehlermeldungen des Servers sind englisch und werden nie übersetzt).
  - Code-Kommentare englisch
  - `docs/` deutsch (README/CHANGELOG siehe offene Frage F4)
- **(R2) DOM-Sicherheit:** Text kommt nur über `textContent` (bzw. Vue-Interpolation) ins DOM. In `src/` gibt es kein `innerHTML`, `outerHTML`, `insertAdjacentHTML` und kein `v-html`; je ein Grep-Test in [S] und [C] prüft das (§9.3). Namen (Gäste wählen frei bis 40 Zeichen) sind Daten, kein Markup.
- **(R2) Unsicherer Kontext:** `http://knorke-dev-*-nc` ist kein Secure Context. `navigator.clipboard`, `crypto.randomUUID` und `crypto.subtle` gibt es dort nicht; jeder Aufruf ist abgesichert (Rückfall: Text markieren bzw. `crypto.getRandomValues`).
- **SPDX-Kopf** in jeder Quelldatei, im Pulse-Stil (`SPDX-FileCopyrightText: 2026 hotochan123`, `SPDX-License-Identifier: AGPL-3.0-or-later`).
  - PHP: `<?php`, Leerzeile, die beiden `//`-Zeilen, Leerzeile, `declare(strict_types=1);`
  - JS: `/** … */`-Block; Vue: HTML-Kommentar vor `<template>`; Shell: `#`
  - Ausgenommen sind generierte Dateien (`l10n/de.js`, `js/`, `css/`).
- **Pulse-Regeln, die hier gelten:**
  - kein `#[BruteForceProtection]`/`#[AnonRateLimit]` (sperrt ganze Schul-NATs); stattdessen nur Fehlversuche von Hand zählen (§4.9)
  - kein `#[UseSession]`, damit es keine Session-Sperren gibt
  - jeder Client-Wert läuft durch `Input::*`
  - `#[\SensitiveParameter]` an jedem Token- und Namensparameter
  - in `atomic()` zuerst sperren, dann prüfen; eine Unique-Verletzung wird nie innerhalb einer PG-Transaktion gefangen
  - jede Liste mit explizitem `ORDER BY`
  - `QBMapper` hat kein `find()`; Knorke nutzt ohnehin Stores ohne Entities (§2)

---

## 1. Umfang

### 1.1 In M0

| Bereich | Inhalt |
|---|---|
| App | Lässt sich auf NC 34 (34.0.1 wie Prod) und NC 35 (35.0.1) im Dev-Stack aktivieren. Navigationseintrag „Knorke“. Migration, Hintergrund-Job (Change-Log stutzen), `UserDeletedListener`. |
| Board-Liste | Eigene Boards und Boards, denen man per Link beigetreten ist. Anlegen, Umbenennen, Löschen (nur Besitzer, mit Bestätigung), Öffnen. Sortiert nach `updated_at` absteigend. |
| Leinwand | Unendlich. Schwenken per Hand-Werkzeug, Leertaste+Ziehen, Mitteltaste, Zwei-Finger-Scroll (Wheel) und Ein-Finger-Ziehen auf Touch. Zoom 5–400 % per Strg/⌘+Wheel, Trackpad-Pinch (Wheel mit `ctrlKey`), Touch-Pinch und Knöpfe. Dazu „Alles zeigen“ und 100 %. **CSS-Transform-Gestenpfad** für Wheel **und jede Touch-Geste** (Ein-Finger-Schwenk, Pinch und der Wechsel zwischen beiden; Pflicht, Korrektur 8, **(R2)**). LOD-Stufe 1 unter 0,3 (kein Text, kein Schatten). Culling durch Herausnehmen der Knoten; Knoten werden nur für Sichtbares gebaut. |
| Objekte | **Haftnotiz:** anlegen (Werkzeug N + Klick), verschieben (auch Mehrfachauswahl), Text bearbeiten (Doppelklick → Overlay), Farbe ändern, löschen. **Frame** (günstig, deshalb drin): anlegen per Aufziehen oder Klick, Titel bearbeiten, verschieben (Kinder ziehen mit), Farbe, löschen (Kinder werden freigegeben, offene Frage F2). Notizen in Frames ziehen und wieder heraus. Unbekannte Typen erscheinen als Platzhalter. |
| Text-Lease **(R2)** | Wer den Text eines Objekts bearbeitet, hält dessen Lease (Präsenzfeld `e`). Ein zweiter Editor öffnet sich nicht, sondern zeigt „X bearbeitet …“ mit der Aktion „Übernehmen“. Der Server lehnt Text-Patches gegen eine fremde, frische Lease mit `locked` ab (§4.11). Getippter Text geht nie still verloren (§6.5). |
| Bearbeiten | Auswahl per Klick, Umschalt+Klick und Rahmen. Nach vorn / nach hinten. Entf/Rücktaste. Einfaches Undo/Redo **nur eigener Aktionen** (≤ 50 Schritte, nicht über Neuladen). Tastenkürzel siehe §6.3. |
| Sync | `POST …/sync` als **eine Anfrage je Takt** mit Ops, Acks, verdichteten Änderungen und huckepack getragener Präsenz. Takt ab Anfragebeginn, adaptiv. Positionen werden erst beim Loslassen committet. Resync-Signal. Gzip über die NC-Middleware. |
| Präsenz | Live-Cursor mit Namen und Farbe (Gäste am Namensschild gekennzeichnet), fremde Auswahl als Umriss, Ziehvorschau der anderen (interpoliert), Chip „X bearbeitet …“ (Text-Lease, durchgesetzt, siehe oben). Teilnehmerleiste. |
| Teilen | **Ein Bearbeitungslink je Board** (an, aus, erneuern). Gäste ohne Konto treten mit Namen bei. Angemeldete Nutzer werden über den Link Board-Mitglied (offene Frage F1). **(R2)** Zurückgezogene Links bleiben 30 Tage bekannt: Wer einen alten Link öffnet, sieht „Link zurückgezogen“, ohne dass ein Fehlversuch gezählt wird. **(R5)** Knorke befolgt Nextclouds Link-Freigabe-Richtlinie für den Board-Besitzer (§4.9.7, F9 – vom Nutzer am 11.10.2026 bestätigt). Die Gastseite zeigt die Rechtslinks der Instanz (Impressum, Datenschutz) selbst (§6.6). |
| Datenbanken **(R5)** | PostgreSQL, MySQL/MariaDB (auch mit `mysql.utf8mb4 = false`) und SQLite. Oracle wird nicht unterstützt; `info.xml` deklariert die drei Arten, Nextcloud verweigert die Installation auf Oracle (§3). Lesereplikate (`dbreplica`) werden unterstützt: Knorke liest immer vom Primärserver (§3.7). |
| Geräte | Ohne feinen Zeiger (Tablet, Handy) nur ansehen: schwenken, zoomen, Cursor sehen. Abstimmen folgt in M1 mit dem Voting. |
| Sprache | Englische Quelltexte, deutsche Übersetzung vollständig. |
| Qualität | PHP-Unit-Tests ohne DB, PHP-Integrationstests gegen den Dev-Stack, reine JS-Tests mit `node --test`, HTTP-Vertragstests (`dev/sim`), Browser-E2E (`dev/e2e`, Playwright 1.49.1 im Container), Szenen-Labor (`dev/scene-lab`). **(R2)** Gemeinsame Abnahme in einer eigenen Integrationsrunde (Phase 2, §10). |

**Gast-Link in M0, begründet:** Der Poll-Spike liefert den größten Teil schon fertig und gemessen:
- Beitritt mit Namen
- HMAC-Gast-Token ohne DB-Zugriff
- Widerruf über eine Generationsnummer
- `X-Requested-With`-Schutz
- Gast-Endpunkte für Snapshot, Ops und Poll

Neu sind nur die öffentliche Seite mit Namensdialog, die Fehlversuchs-Drossel (Pulse-Muster, ≈ 30 Zeilen), dauerhafte Gast-Identität beim erneuten Beitritt und die Link-Verwaltung. Das ist klein genug für M0.

### 1.2 Nicht in M0, aber nicht verbaut

| Thema | Kommt in | Was M0 dafür schon vorsieht |
|---|---|---|
| Resize/Rotate (Transformer), Formen, Text-Objekt, Verbinder-UI, Stift | M1 | Datengetriebene Typ-Registry (PHP und JS), `r` im Schema, Platzhalter-Rendering, Geometrie-Modul portiert, UI-Layer vorhanden |
| Explizites Teilen (Nutzer, Gruppen, Teams; Rollen edit/view/vote) | M1 | `members` mit `role`, `Role`-Enum, ACL-Generation in Redis |
| Abstimmungs-Link und Punkte-Abstimmung | M1 | `links.role`, Rollen `vote`/`view`, Rollenrechte je Op in `OpValidator` (vor dem Lock), opake `pid` als künftiger Stimmschlüssel |
| **(R2)** Objektbezogene Rechte (gesperrt, versteckte Frames, privater Modus) | M1/M2 | Haken `SyncService::authorize($p, $op, $row)` **im Lock** nach dem Laden der Zeile (M0: erlaubt immer). Rechte, die die Zeile brauchen, gehören dorthin, nicht in `OpValidator`. Präsenz (`s`, `d`, `e`) ist ein zweiter Lieferweg neben `itemsSince`/`snapshotItems` und bekommt in M2 denselben Filter je Betrachter |
| **(R2)** Schreibbudget: `ILimiter` je Principal für Sync mit Ops (Gäste mit `gid` im Schlüssel), Obergrenze für Grabsteine und `changes` je Board, Drossel für Snapshot-GETs | M1, **Pflicht vor jedem Prod-Einsatz** | `Limits` als zentrale Stelle, `item_count` und **(R4)** `item_bytes` (Byte-Budget je Board, §4.8, schon in M0) im Lock gepflegt; M0 läuft nur im Dev-Stack (F5) |
| Timer, Folgen, „alle zu mir“ | M1 | Präsenz-Blob ist erweiterbar (unbekannte Felder werden ignoriert) |
| LOD-Stufe 2 (< 10 %), Engine-Messrunde auf echtem iPad, Lastlauf S4 mit `/sync` (Ziel ≥ 30 % Edge-Spielraum) | M1 | `scene-lab` mit Messhaken, `lodLevel` in der Szene |
| Grabsteine bereinigen und `min_rev` anheben | M1 | `boards.min_rev` plus Resync-Pfad sind in M0 gebaut und getestet |
| Kopieren, Einfügen, Duplizieren, Gruppieren, Sperren, Minimap, Suche, Raster und Einrasten | M1 | `group_id`/`locked` als spätere nullable-Spalten (§3.6) |
| Privater Modus und versteckte Frames (serverseitig gefiltert) | M2 | Auslieferung läuft schon heute über einen einzigen Pfad (`ItemStore::itemsSince`/`snapshotItems`), dort kommt später der Filter hinein |
| Vorlagen, Export (SVG/PNG/PDF/CSV), Kommentare, Bilder aus NC-Dateien, Aktivitätslog und Wiederherstellen, Board-Snapshots als Datei | M2 | `changes`-Log wird geschrieben; Ein-Rev-größer-als-Seite-Fall ist behoben (§4.10.2); **(R4)** er entsteht schon in M0 (Frame-Freigabe) und ist durch `MAX_BOARD_BYTES` begrenzt |
| Undo über Neuladen hinaus oder bedingtes Undo | M2 | Op-Format mit `revive` |
| Rich Text | M2 | `data.text` ist Klartext, später kommt `data.rich` mit Klartext als Fallback |
| notify_push, WebSocket-Sidecar | später | Transport hinter der Schnittstelle in `src/sync/transport.js` (`userTransport`/`guestTransport`, §6.4) |
| **(R2)** Board-Epoche (Schutz nach DB-Restore bei vorauseilendem Redis) | M1 | Runbook in M0 (§5.3 c) |
| **(R5)** Erzwungenes Link-Passwort und erzwungenes Ablaufdatum aus Nextclouds Freigabe-Richtlinie | M1 | M0 befolgt nur „Freigabe per Link erlauben“ samt Gruppenausschluss (§4.9.7); bekannte Grenze, dokumentiert |
| App-Store-Paket, Signatur, CI-Workflow | M2 (CI in M1) | `info.xml`-Reihenfolge nach `info.xsd`, `.htaccess`, SPDX |

### 1.3 Was M1 und M2 hinzufügen (Kurzfassung)

- **M1 „Workshop-Kern“:**
  - Transformer
  - Formen, Text und Verbinder über die Registry
  - Teilen-Dialog mit Nutzern, Gruppen und Teams
  - Abstimm-Link und Punkte-Abstimmung
  - Timer, Folgen, Kopieren/Einfügen
  - LOD 2 und Engine-Messrunde (iPad/WebKit)
  - Grabstein-Bereinigung mit `min_rev`
  - Lastlauf S4/S5 mit Prod-App-Satz und Fehlereinspielung
  - CI
  - Board-Metadaten im Sync (`meta_rev`, damit sich ein Titel live ändert)
- **M2 „Moderation & Ausgabe“:**
  - privater Modus und versteckte Frames (serverseitig)
  - Vorlagen, Export, Kommentare, Bilder
  - Aktivitätslog, Papierkorb, Snapshots als Datei
  - Rich Text
  - App-Store-Release

---

## 2. Repository-Layout

Kennung in eckigen Klammern = besitzendes Arbeitspaket (§10): **[B]** Backend, **[S]** Szene + Modell, **[C]** Sync-Client + Vue-Shell + Build, **[D]** Dev-Stack + E2E + Doku. Jede Datei hat genau einen Besitzer.

```
$ROOT/
├── appinfo/
│   ├── info.xml                      [B] id knorke, NC 34–35, PHP 8.2–8.5, Navigation, Hintergrund-Job
│   └── routes.php                    [B] Routentabelle §4.1, jeder Platzhalter mit requirements
├── lib/
│   ├── AppInfo/Application.php       [B] APP_ID, PROTOCOL; register() nur Listener-Klassenname; boot() leer
│   ├── Controller/
│   │   ├── ApiResponses.php          [B] Trait: run(), refuseCrossSite(), json()-Helfer, Fehlerabbildung
│   │   ├── PageController.php        [B] Seiten /, /b/{id}, /join/{token} (Template main + Initial-State)
│   │   ├── BoardApiController.php    [B] Board-Liste, CRUD, Link an/aus/erneuern, Link-Beitritt angemeldet
│   │   ├── SyncController.php        [B] snapshot + sync für angemeldete Nutzer
│   │   ├── PublicPageController.php  [B] /p/{token}: Gastseite oder Redirect für Angemeldete
│   │   └── PublicSyncController.php  [B] join, snapshot, sync für Gäste
│   ├── Db/
│   │   ├── BoardStore.php            [B] SQL für boards, members, links
│   │   ├── ItemStore.php             [B] SQL für items, changes (Hot Path, JSON wörtlich gespleißt)
│   │   └── PrimaryReads.php          [B] (R5) Lesen vom Primärserver bei dbreplica (§3.7)
│   ├── Exception/HttpError.php       [B] status + error + message (R3: Feld `error`, `\Exception::$code` ist belegt)
│   ├── Http/RawJsonResponse.php      [B] erbt von JSONResponse, render() liefert fertigen String
│   ├── Http/JsonBody.php             [B] (R2) Body lesen: Content-Length, Größe, Routen-Überdeckung, erlaubte Schlüssel
│   ├── Service/
│   │   ├── Access.php                [B] Rechteauflösung mit Redis-Grants, Gast-Beitritt, pid
│   │   ├── AccessResult.php          [B] Wertobjekt {principal, dbRev, minRev}
│   │   ├── BoardService.php          [B] Board-CRUD, Links, Mitgliedschaft, Widerruf, Nutzer gelöscht
│   │   ├── FastCache.php             [B] Redis: rev, Generationen, Grants
│   │   ├── GuestToken.php            [B] HMAC-Token ausstellen/prüfen (rein, testbar)
│   │   ├── Input.php                 [B] Pulse-Port: str/int/flag/clip + text/displayName
│   │   ├── ItemRegistry.php          [B] datengetriebene Typregeln (sticky, frame)
│   │   ├── Limits.php                [B] Grenzwerte, teils per App-Config übersteuerbar
│   │   ├── LinkPolicy.php            [B] (R5) Nextclouds Link-Freigabe-Richtlinie je Besitzer (§4.9.7)
│   │   ├── LinkThrottle.php          [B] nur-Fehlversuch-Drossel (Pulse codeMissBlocked)
│   │   ├── OpValidator.php           [B] normalize/clean* (rein, testbar)
│   │   ├── PathOps.php               [B] getPath/setPath/setIn (Spiegel von src/model/paths.js)
│   │   ├── PresenceStore.php         [B] Präsenz-Blob mit cas-Schleife, Text-Lease (leaseHolder)
│   │   ├── Principal.php             [B] Wertobjekt Handelnder
│   │   ├── Role.php                  [B] enum owner|edit|view|vote
│   │   ├── SyncRequest.php           [B] geprüfte Sync-Anfrage
│   │   ├── SyncService.php           [B] applyOps (Schreibweg) + sync (Leseweg)
│   │   └── ZOrder.php                [B] (R2) isValid(): Port von validateOrderKey (fractional-indexing 4.0, base36)
│   ├── Migration/Version000100Date20261011000000.php  [B]
│   ├── BackgroundJob/CleanupJob.php  [B] TimedJob täglich: changes und zurückgezogene Links > 30 Tage löschen
│   └── Listener/UserDeletedListener.php [B]
├── templates/
│   ├── main.php                      [B] addScript/addStyle + <div id="knorke-root">
│   └── public.php                    [B] wie main.php (Initial-State wählt PublicApp)
├── img/app.svg, img/app-dark.svg     [B] Icon: Klebezettel mit Eselsohr (kein Bär, kein Ampelmann)
├── .htaccess                         [B] RedirectMatch 404 für dev|build|tests|src|node_modules|docs|tools|.git
├── composer.json                     [B] nur autoload + require-dev nextcloud/ocp dev-stable34 (IDE/psalm)
├── phpunit.xml                       [B] Unit-Suite (ohne base.php)
├── phpunit.integration.xml           [B] Integrations-Suite (mit base.php, nur Dev-Stack)
├── tests/
│   ├── php/bootstrap.php             [B] Pulse-Muster: NC-Autoloader + PSR-4, KEIN base.php
│   ├── php/bootstrap-integration.php [B] base.php + Schutz knorke_dev=true
│   ├── php/run.sh                    [B] unit (Wegwerf-Container) | integration (knorke-dev-$KD_NS-nc aus env.json)
│   ├── php/unit/*Test.php            [B]
│   ├── php/integration/*Test.php     [B]
│   ├── php/smoke.sh                  [B] (R2) curl-Proben aller Routen gegen den eigenen Dev-Stack
│   ├── php/replica.sh                [B] (R5) Probe mit eingefrorenem Lesereplikat (nur pgsql, §3.7, §9.2)
│   ├── fixtures/paths-golden.json    [B] goldene Fälle für PathOps + Wertregeln, von [S] in JS mitgeprüft
│   ├── fixtures/zorder-golden.json   [B] (R2) gültige/ungültige z-Schlüssel, von [S] in JS mitgeprüft
│   └── js/
│       ├── model/*.test.mjs          [S]
│       ├── scene/*.test.mjs          [S] inkl. noHtml.test.mjs (Grep über src/model, src/scene)
│       ├── sync/*.test.mjs           [C]
│       ├── board/*.test.mjs          [C]
│       └── shell/*.test.mjs          [C] routes.js ↔ routes.php, PROTOCOL-Gleichheit, Initial-State-Schlüssel,
│                                         noHtml.test.mjs (Grep über src/ ohne model/ und scene/)
├── src/
│   ├── main.js                       [C] Einstieg: App oder PublicApp je Initial-State
│   ├── App.vue                       [C] angemeldete Shell (NcContent, Liste | Board | Join)
│   ├── PublicApp.vue                 [C] Gast-Shell (Name → Board)
│   ├── router.js                     [C] Mini-Router über History-API (kein vue-router)
│   ├── views/BoardList.vue           [C]
│   ├── views/BoardView.vue           [C] Leinwand-Host, montiert BoardSession (markRaw)
│   ├── components/                   [C] TopBar, Toolbar, ContextBar, ZoomControls, PresenceBar,
│   │                                     ShareDialog, GuestNameDialog, ConnectionBanner, ConfirmDialog (.vue), icons.js;
│   │                                     (R5) LegalLinks.vue, reine Module join.js, legal.js, rescue.js
│   ├── board/                        [C] BoardSession.js, actions.js, undo.js, debug.js
│   ├── sync/                         [C] SyncClient.js, Replica.js, scheduler.js, transport.js, http.js,
│   │                                     presence.js, protocol.js
│   ├── api/boards.js                 [C] Board-Liste/CRUD/Link-Aufrufe
│   ├── util/                         [C] l10n.js, routes.js, toast.js, device.js, storage.js; (R5) unicode.js, reload.js
│   ├── styles/knorke.css             [C] Tokens + Layout (landet in css/knorke-style.css)
│   ├── model/                        [S] ids.js, paths.js, zorder.js, registry.js, geometry.js, text.js,
│   │                                     tokens.js, SceneModel.js
│   └── scene/                        [S] index.js, SceneManager.js, KonvaRenderer.js, Camera.js, culling.js,
│                                         order.js, GestureController.js, InputController.js, Selection.js,
│                                         CursorLayer.js, TextEditor.js, nodes/{index,common,sticky,frame,placeholder}.js
├── l10n/de.json                      [C] von Hand (enthält von Anfang an die [S]-Texte aus §6.9)
├── l10n/de.js                        [C] generiert (build/l10n-build.mjs)
├── build/
│   ├── l10n-build.mjs                [C] Port Pulse build/l10n-build.js (CommonJS → ESM)
│   ├── l10n-check.mjs                [C] Port Pulse build/l10n-check.js (CommonJS → ESM; fehlende/verwaiste Schlüssel → exit 1)
│   └── check-bundle.mjs              [C] prüft Bündelform (§7.4)
├── js/  css/                         [C erzeugt] Build-Ausgabe, in M0 gitignored
├── package.json, package-lock.json   [C]
├── vite.config.js                    [C]
├── dev/                              [D] außer dev/scene-lab/ = [S]
│   ├── lib.sh                        [D] Namensraum (KD_NS), Namen, log/die, rnd, wait_nc, occ, state_dir
│   ├── up.sh, down.sh                [D] Dev-Stack je Namensraum (§8.1)
│   ├── build.sh                      [D] (R2) flock-Sperre + npm run build + bust aller laufenden Namensräume
│   ├── restart.sh, bust.sh, occ.sh, logs.sh, psql.sh, redis-keys.sh  [D] alle namensraumbezogen
│   ├── db.sh                         [D] (R5) SQL-Shell für jede KD_DB-Art (§8.1)
│   ├── php/zz-knorke-dev.ini         [D] opcache.revalidate_freq=0
│   ├── selftest/placeholder/         [D] (R2) Platzhalter-App (id knorke, 1 Route) für den Alleintest von up.sh
│   ├── selftest/updown.sh            [D] (R3) up/down-Matrix NC 34/35 × Platzhalter/echte App; (R5) × KD_DB-Arten
│   ├── selftest/isolation.sh         [D] (R5) Live-Prüfung eines Namensraums (Netze, Ports, Redis-Passwort, Zeichensatz)
│   ├── sim/                          [D] HTTP-Vertragstests + Konvergenzlauf (§8.3)
│   ├── e2e/                          [D] Playwright-Szenarien (§8.2), eigenes package.json + package-lock.json
│   └── scene-lab/                    [S] Szenen-Labor: index.html, lab.js, scene-gen.js, prng.js,
│                                         metrics.js, vite.lab.config.js, run.mjs, run.sh,
│                                         package.json + package-lock.json (playwright 1.49.1)
├── docs/
│   ├── SPEC-M0.md                    (dieses Dokument)
│   ├── ENTWICKLUNG.md                [D] Dev-Stack, Build, Tests, Fallen
│   ├── ARCHITEKTUR.md                [D] Kurzfassung §4–§6 für Leser ohne Spec
│   └── PROTOKOLL.md                  [D] /sync-Vertrag als Referenz (aus §4 abgeleitet)
├── README.md, CHANGELOG.md           [D]
├── LICENSE                           [D] AGPL-3.0-Text (Kopie aus Pulse)
└── .gitignore                        [D]
```

Inhalt von `.gitignore` [D]:

```
node_modules/
/js/
/css/
/tools/
/dev/.state/
/dev/e2e/node_modules/
/dev/e2e/out/
/dev/sim/out/
/dev/scene-lab/node_modules/
/dev/scene-lab/dist/
/dev/scene-lab/out/
.phpunit.cache
*.key
*.csr
*.crt
/_*.php
```

---

## 3. Datenbankschema

Alle Tabellen tragen das Präfix `oc_knorke_*`; in Migration und SQL heißen sie `knorke_*`, `*PREFIX*` ergänzt NC. Es gibt eine Migration: `lib/Migration/Version000100Date20261011000000.php` (`SimpleMigrationStep::changeSchema`).

Regeln für die Migration:
- jede Tabelle hinter `if (!$schema->hasTable(…))`
- nur `$schema->createTable`, `$table->addColumn($name, Types::X, [...])`, `setPrimaryKey`, `addIndex`, `addUniqueIndex`
- keine Doctrine-Typ-Hinweise, weil NC 35 `ITable` statt der Doctrine-Tabelle liefert
- keine Fremdschlüssel; JSON steht als `TEXT` (`Types::JSON` ist seit NC 33 veraltet)
- Indexnamen höchstens 63 Zeichen inklusive `oc_`
- **Keine** NOT-NULL-Spalte mit `''` als Vorgabe. Beim Anlegen ist das zwar erlaubt, beim späteren Hinzufügen bricht es (Oracle-Prüfung in `MigrationService`). Spalten, die leer sein können, sind deshalb nullable.

**(R5) Unterstützte Datenbanken:**
- PostgreSQL, MySQL/MariaDB (auch mit `mysql.utf8mb4 = false`) und SQLite. Oracle wird **nicht** unterstützt.
- `appinfo/info.xml` deklariert sie in `<dependencies>` in der Reihenfolge, die `info.xsd` verlangt: `<php …/>`, `<database>pgsql</database>`, `<database>mysql</database>`, `<database>sqlite</database>`, `<nextcloud …/>`. Nextcloud verweigert damit die Installation auf Oracle. Kein Versionssprung (§0).
- Alles App-SQL ist auf PostgreSQL 17, MySQL 8.4, MariaDB 11.8 und SQLite 3.46 geprüft: rohes `LIMIT`, die `CASE`-Ausdrücke in `itemsSince` und `releaseMany`, mehrzeiliges `INSERT`, `insertIgnoreConflict` (`INSERT IGNORE` bzw. `INSERT OR IGNORE`), BIGINT-Autoincrement und die Zeilenzahl von `lockBoard` (Nextcloud setzt `MYSQL_ATTR_FOUND_ROWS`). Keine Abfrage brauchte eine Änderung. Nextclouds Kollationen `utf8mb4_bin`/`utf8mb3_bin` vergleichen groß-/kleinschreibungsgenau.
- **4-Byte-Text:** Liefert `IDBConnection::supports4ByteText()` `false` (MySQL/MariaDB mit `mysql.utf8mb4 = false`, `utf8mb3`-Tabellen), ersetzt der Server jeden Codepunkt über U+FFFF in Board-Titeln und in jedem String-Wert von `data`/`style` durch U+FFFD (§4.8). Vorher antwortete jedes Emoji mit 500 (SQLSTATE 22007/1366).
- **SQLite** sperrt die ganze Datei: Schreiber verschiedener Boards warten aufeinander (busy timeout). Für Dev und Test hingenommen; Nextcloud rät selbst von SQLite in Produktion ab.
- **MySQL/MariaDB:** `pdo_mysql` puffert ganze Ergebnismengen. Der Snapshot eines Boards am Byte-Budget (8,2 MiB Antwort) braucht dort +19,1 MiB Spitze (2,33 × Antwort, PG und SQLite +16,4 MiB), ein Sync +22,9 MiB. Beides liegt unter dem 2,5×-Test und dem 128-MiB-Gate, der Abstand ist aber klein; ungepufferte Abfragen lassen sich über OCP nicht einstellen.

### 3.1 `oc_knorke_boards`

| Spalte | Typ | Optionen | Zweck |
|---|---|---|---|
| `id` | BIGINT | autoincrement, notnull | PK |
| `owner` | STRING(64) | notnull | uid des Besitzers |
| `title` | STRING(200) | notnull | Titel, 1–200 Zeichen |
| `rev` | BIGINT | notnull, default 0 | **der** Cursor; jeder Schreib-Batch: `rev = rev + 1` als erste Anweisung |
| `min_rev` | BIGINT | notnull, default 0 | Untergrenze des lieferbaren Verlaufs; `since < min_rev` → Resync |
| `schema_version` | INTEGER | notnull, default 1 | Nachrüst-Regel „Schema-Version je Board“ |
| `item_count` | INTEGER | notnull, default 0 | lebende Objekte (für das Limit), im selben Lock gepflegt |
| `item_bytes` | BIGINT | notnull, default 0 | **(R4)** Summe über lebende Objekte von `strlen(obj(data)) + strlen(obj(style))` (Byte-Budget, §4.8), im selben Lock und in derselben Anweisung wie `item_count` gepflegt. Kommt in die bestehende M0-Migration, ohne `info.xml`-Versionssprung; Dev-Stacks installieren frisch |
| `acl_gen` | INTEGER | notnull, default 1 | +1 bei jedem Rechteentzug (Mitglied entfernt, Link erneuert/aus) |
| `link_gen` | INTEGER | notnull, default 1 | +1 bei Link erneuern/aus → alle Gast-Tokens ungültig |
| `created_at` | BIGINT | notnull, default 0 | ms |
| `updated_at` | BIGINT | notnull, default 0 | ms, wird im `rev`-Update mitgesetzt |

Indizes: PK(`id`); `knorke_boards_owner` (`owner`, `updated_at`).

**Abweichung zum Spike:** Es gibt kein `open_to_users` (Spike-Abkürzung), keine Token-Spalten im Board (stattdessen eine eigene Tabelle `links`) und kein `share_gen` (stattdessen `link_gen` und `acl_gen`).

### 3.2 `oc_knorke_links`

| Spalte | Typ | Optionen | Zweck |
|---|---|---|---|
| `id` | BIGINT | autoincrement, notnull | PK |
| `board_id` | BIGINT | notnull | |
| `token` | STRING(32) | notnull | 24 Zeichen `[A-Za-z0-9]` (ISecureRandom), ≈ 143 Bit |
| `role` | STRING(16) | notnull | M0 nur `edit`; M1 `vote`/`view` |
| `created_by` | STRING(64) | notnull | uid |
| `created_at` | BIGINT | notnull, default 0 | ms |
| `revoked_at` | BIGINT | **nullable** | **(R2)** ms; NULL = aktiv. Erneuern, Abschalten und Board-Löschen setzen den Wert, statt die Zeile zu löschen. `CleanupJob` löscht Zeilen mit `revoked_at` älter als 30 Tage |

Indizes: PK(`id`); UNIQUE `knorke_links_token` (`token`); `knorke_links_board` (`board_id`). In M0 hat ein Board höchstens einen **aktiven** Link (`revoked_at IS NULL`); das Schema erlaubt mehrere (Abstimm-Link in M1).

**(R2) Warum zurückgezogene Links erhalten bleiben:** Ein bekannter, zurückgezogener Token wird mit „zurückgezogen“ beantwortet und zählt **keinen** Fehlversuch. Nur nie ausgestellte Tokens zählen. Sonst sperrt ein erneuerter Link eine ganze Workshop-NAT (15 Gäste laden die alte Seite neu → > 10 Fehlversuche → 30 Minuten 429, auch für den neuen Link). Die Zeile eines gelöschten Boards bleibt ebenfalls 30 Tage (kein Fremdschlüssel; `board_id` zeigt dann ins Leere).

### 3.3 `oc_knorke_members`

| Spalte | Typ | Optionen | Zweck |
|---|---|---|---|
| `board_id` | BIGINT | notnull | |
| `user_id` | STRING(64) | notnull | uid |
| `role` | STRING(16) | notnull | `edit` (M0), später `view`/`vote` |
| `link_id` | BIGINT | nullable | gesetzt = über diesen Link beigetreten; NULL = explizit geteilt (M1) |
| `created_at` | BIGINT | notnull, default 0 | ms |

Indizes: PK(`board_id`, `user_id`); `knorke_members_user` (`user_id`). Der Besitzer steht **nicht** in `members`, denn `boards.owner` reicht. Gruppen und Teams kommen in M1 als eigene Tabelle `knorke_shares` und ändern an `members` nichts.

### 3.4 `oc_knorke_items`

| Spalte | Typ | Optionen | Zweck |
|---|---|---|---|
| `board_id` | BIGINT | notnull | |
| `id` | STRING(26) | notnull | Client-ULID `^[0-9A-HJKMNP-TV-Z]{26}$` |
| `type` | STRING(24) | notnull | `sticky`, `frame` (M0), später weitere |
| `parent_id` | STRING(26) | nullable | NULL oder lebender Container (Invariante §4.7) |
| `z` | STRING(64) | notnull | fractional-indexing-Schlüssel, Alphabet `0-9a-z`, byteweise verglichen; **(R2)** nur Schlüssel, die `ZOrder::isValid` besteht (§4.8) |
| `x`, `y`, `w`, `h`, `rotation` | FLOAT | notnull, default 0 | 1 Einheit = 1 CSS-px bei 100 %; x/y = oben links der unrotierten Box **relativ zum Eltern-Container**; Rotation in Grad im Uhrzeigersinn um die Mitte |
| `data` | TEXT | nullable | JSON-Objekt (nie `[]`) |
| `style` | TEXT | nullable | JSON-Objekt |
| `version` | INTEGER | notnull, default 1 | +1 je Schreibvorgang |
| `rev` | BIGINT | notnull, default 0 | rev der letzten Änderung; Grundlage der Verdichtung |
| `deleted` | SMALLINT | notnull, default 0 | Grabstein |
| `created_by` | STRING(80) | notnull | Principal-ID (`u:<uid>` bis 66, `g:<gid>` 14 Zeichen); **Abweichung:** keine 47-Zeichen-Kürzung |
| `created_at` | BIGINT | notnull, default 0 | ms |
| `modified_by` | STRING(80) | notnull | Principal-ID |
| `modified_at` | BIGINT | notnull, default 0 | ms |

Indizes:
- PK(`board_id`, `id`)
- **`knorke_items_rev` (`board_id`, `rev`)**, neu, Grundlage der verdichteten Auslieferung (Korrektur 5, Option B)
- `knorke_items_parent` (`board_id`, `parent_id`)

### 3.5 `oc_knorke_changes`

| Spalte | Typ | Optionen | Zweck |
|---|---|---|---|
| `board_id` | BIGINT | notnull | |
| `rev` | BIGINT | notnull | |
| `item_id` | STRING(26) | notnull | |
| `op` | STRING(8) | notnull | `put` / `patch` / `remove` |
| `patch` | TEXT | nullable | **(R3, eingefroren §10.2)** put (auch revive): volles Objekt ohne id im Drahtformat `{"t","x","y","w","h","r","z","parent","data","style"}` (Zahlen mit Nachkommastelle, `data`/`style` per `ItemStore::obj()`, leer `{}`); patch: `{"<pfad>": wert \| null}` nur mit den effektiv geänderten Pfaden (inkl. Freigabe-Pfade); remove: NULL |
| `actor` | STRING(80) | notnull | Principal-ID (ungekürzt) |
| `client` | STRING(16) | notnull | Client-ID |
| `ts` | BIGINT | notnull, default 0 | ms |

Indizes: PK(`board_id`, `rev`, `item_id`); `knorke_changes_ts` (`ts`) zum Stutzen.

**(R2) Genau eine Änderungszeile je Objekt und rev.** Der Schreibweg schreibt je Objekt einmal, nach seinem **Endzustand** im Batch (§4.10.1). Wird ein Kind im selben Batch gepatcht und durch das Entfernen seines Containers freigegeben, landen beide Pfadmengen in **einer** `patch`-Zeile (Fall C17). Zwei Zeilen für dasselbe Objekt wären eine PK-Verletzung und damit ein 500er.

**Rolle in M0:** Der Sync liest `changes` **nicht** mehr, er liest die Items (§4.5). `changes` ist in M0 das Prüfprotokoll:
- Der Vertragstest spielt das Log nach und vergleicht es mit dem Snapshot.
- In M1/M2 bildet es die Grundlage für Aktivitätslog und Wiederherstellen.
- `CleanupJob` löscht Zeilen, die älter als 30 Tage sind, dazu zurückgezogene Links älter als 30 Tage (§3.2).

### 3.6 Geplante M1-Migration (nicht in M0 anlegen)

Alles nullable, damit es nachträglich hinzufügbar ist:
- `items.group_id STRING(26)`, `items.locked SMALLINT NULL`
- `items.start_item`/`end_item STRING(26)` plus Indizes (`board_id`, `start_item`) und (`board_id`, `end_item`) für Verbinder
- `boards.meta_rev BIGINT NULL`
- Tabelle `knorke_shares`

Das braucht Versionssprung und `occ upgrade` und ist im Dev-Stack unkritisch.

### 3.7 Lesereplikate (`dbreplica`) **(R5)**

**Regel:** Jedes Knorke-SELECT liest vom Primärserver.

**Grund (NC-1):** Nextcloud schickt Lesezugriffe außerhalb einer Transaktion an ein Replikat. Ein nachlaufendes Replikat zusammen mit dem rev aus Redis lieferte eine leere Seite, deren rev der Client als Cursor übernahm (Änderungen gingen für ihn still verloren). Anlegen → Öffnen, Link-Anlegen und Beitritt antworteten 404.

**Mechanik (`OCA\Knorke\Db\PrimaryReads::pin()`):**
- Läuft einmal je Anfrage vor dem ersten Knorke-SELECT, und nur, wenn die System-Config `dbreplica` nicht leer ist und keine Transaktion läuft.
- Sie öffnet und committet eine leere Transaktion über das öffentliche `IDBConnection`. `BEGIN` lässt Doctrine zum Primärserver verbinden; Nextcloud lässt `keepReplica` aus, also belegt der Primärserver für den Rest der Anfrage auch den Replikat-Platz. Geprüft in den Quellen von NC 34.0.1 und 35.0.1 (`PrimaryReadReplicaConnection::performConnect`, `OC\DB\Connection::executeQuery`).
- Die Instanz ist über DI geteilt. Die einzigen Lesepfade in `lib/`, `BoardStore::rows` sowie `ItemStore::rows`, `::each` und `::qbRows`, rufen `$this->primary?->pin()`.

**Kosten:** +2 Roundtrips je Anfrage, die Knorke-SQL ausführt; ohne `dbreplica` 0. Der leere Fastpath-Sync bleibt ohne SQL und pinnt nie (§5.2).

**Grenzen:**
- Der Pin gilt eine Anfrage lang. In langlaufenden Prozessen schließt Nextcloud eine Verbindung nach 30 s Leerlauf und öffnet sie neu; der Pin wird dann nicht erneuert (`PrimaryReads` merkt ihn sich je Instanz). Heute laufen nur `CleanupJob` und `UserDeletedListener` lang, und beide schreiben nur.
- Eine Anfrage, deren erste Knorke-Anweisung ein Schreibvorgang ist, steht schon auf dem Primärserver und zahlt die leere Transaktion trotzdem einmal, wenn sie später liest.

**Test:** `tests/php/replica.sh` gegen eine eingefrorene `pg_dump`-Kopie (§9.2).

---

## 4. HTTP-API

Basis: `/index.php/apps/knorke`. Alle Routen sind normale Controller-Routen, kein OCS. Eine neu angelegte Route liefert bis zum Neustart des Containers 404 (APCu-Routencache), deshalb `dev/restart.sh`.

### 4.1 Routentabelle (`appinfo/routes.php`)

Requirements: `$id = ['id' => '\d{1,18}']`, `$tok = ['token' => '[A-Za-z0-9]{24}']`.

| # | Name (`controller#method`) | Verb | URL | Attribute | Grenzen |
|---|---|---|---|---|---|
| 1 | `page#index` | GET | `/` | `NoAdminRequired`, `NoCSRFRequired` | – |
| 2 | `page#board` | GET | `/b/{id}` | wie 1; `postfix => 'board'` nicht nötig (anderer Name) | – |
| 3 | `page#join` | GET | `/join/{token}` | wie 1 | – |
| 4 | `publicPage#show` | GET | `/p/{token}` | `PublicPage`, `NoCSRFRequired` | nur nie ausgestellte Tokens → `LinkThrottle::missBlocked` (§4.9.5) |
| 5 | `boardApi#index` | GET | `/api/v1/boards` | `NoAdminRequired` (CSRF an) | – |
| 6 | `boardApi#create` | POST | `/api/v1/boards` | `NoAdminRequired` | `ILimiter::registerUserRequest('knorke-create', Limits::createPer10Min(), 600)` (Vorgabe 30, App-Config `create_limit`, **(R2)**), max. 500 Boards je Besitzer |
| 7 | `boardApi#update` | PATCH | `/api/v1/boards/{id}` | `NoAdminRequired` | nur Besitzer |
| 8 | `boardApi#destroy` | DELETE | `/api/v1/boards/{id}` | `NoAdminRequired` | nur Besitzer |
| 9 | `boardApi#enableLink` | POST | `/api/v1/boards/{id}/link` | `NoAdminRequired` | nur Besitzer; **(R5)** danach Link-Richtlinie (§4.9.7) |
| 10 | `boardApi#disableLink` | DELETE | `/api/v1/boards/{id}/link` | `NoAdminRequired` | nur Besitzer |
| 11 | `boardApi#joinLink` | POST | `/api/v1/links/{token}/join` | `NoAdminRequired` | `registerUserRequest('knorke-linkjoin', 60, 600)`; nur nie ausgestellte Tokens → `LinkThrottle::missBlocked`; **(R5)** Link-Richtlinie für Nicht-Besitzer (§4.9.7) |
| 12 | `sync#snapshot` | GET | `/api/v1/boards/{id}/snapshot` | `NoAdminRequired` | – |
| 13 | `sync#sync` | POST | `/api/v1/boards/{id}/sync` | `NoAdminRequired` | keine in M0 (Schreibbudget M1, §1.2); Body ≤ 1 MiB |
| 14 | `publicSync#join` | POST | `/pub/v1/{token}/join` | `PublicPage`, `NoCSRFRequired` + `refuseCrossSite` | nur nie ausgestellte Tokens → `LinkThrottle::missBlocked`; neue Gast-Identität: `registerAnonRequest('knorke-guest-'.$boardId.'-'.$linkId, 300, 600, $ip)` (**(R4)** mit Link-ID, §4.9.2); **(R5)** Link-Richtlinie vor Name, Drossel und Token (§4.9.2 Schritt 2a) |
| 15 | `publicSync#snapshot` | GET | `/pub/v1/boards/{id}/snapshot` | `PublicPage`, `NoCSRFRequired` | – (Token im Header, Prüfreihenfolge §4.9.3) |
| 16 | `publicSync#sync` | POST | `/pub/v1/boards/{id}/sync` | `PublicPage`, `NoCSRFRequired` + `refuseCrossSite` | keine; Body ≤ 1 MiB |

Weitere Regeln:
- Kein Controller nutzt `#[UseSession]`, `#[BruteForceProtection]`, `#[AnonRateLimit]` oder `#[UserRateLimit]`. Das Rate-Limit-Attribut braucht für `shouldApply()` außerdem NC 34.0.2, Prod hat 34.0.1.
- Controller-Signaturen enthalten **nur** Routenparameter (`int $id`, `#[\SensitiveParameter] string $token`). Body-Felder liest der Controller **nur** über `JsonBody` (unten) und gibt sie durch `Input::*`. So erzeugen Arrays an Stelle von Strings keine 500er.
- `#[\SensitiveParameter]` steht an jedem `$token`-Parameter und an Gastnamen.
- **(R2) `JsonBody::read(IRequest $r, array $allowed, int $maxBytes = Limits::MAX_BODY_BYTES): array`** für jeden Endpunkt mit Body (6, 7, 9, 11, 13, 14, 16):
  1. `Content-Length` fehlt oder ist nicht numerisch → 411 `length_required` (ein chunked Body würde sonst die Größenprüfung umgehen; NC liest den ganzen Body ein). Größer als `$maxBytes` → 413 `too_large`. Beides **vor** dem ersten `getParam()`.
  2. `$r->throwDecodingExceptionIfAny()` → `JsonException` → 400 `bad_request`.
  3. NC mischt den JSON-Body **nach** den Routenparametern in `getParams()` (geprüft in `Request::decodeContent`, NC 34.0.1); ein Body-Schlüssel `id` oder `token` überdeckt also den Routenwert, auch im Methodenargument des Controllers. Deshalb: Für jeden Schlüssel aus `$r->urlParams` (magische Eigenschaft von `OC\AppFramework\Http\Request`, enthält auch `_route`) muss `getParam(k)` gleich dem Routenwert sein, sonst 400 `bad_request`.
  4. Body = `getParams()` ohne die Routenschlüssel. Jeder Schlüssel außerhalb von `$allowed` → 400 `bad_request` (auch Query-Parameter).
  5. Erlaubte Schlüssel: create/rename `title`; link `rotate`; joinLink keine; sync `proto, client, since, seq, ops, me, pres`; join `client, name, guest`.
  - **(R3) Grenze von Schritt 3:** Ein Body-Schlüssel mit **demselben** Wert wie der Routenparameter ist über `IRequest` nicht erkennbar (NC mischt beide) und wird angenommen. Nur ein abweichender Wert ergibt 400 (C38).
- **(R3) `JsonBody::guardRoute(IRequest $r)`** (nur Schritt 3, ohne `Content-Length`-Pflicht) läuft zusätzlich auf den Routen ohne Body (8, 10, 12, 15). Nextcloud lässt einen mitgeschickten JSON-Body auch bei DELETE/GET `{id}` im Methodenargument überdecken; diese Routen antworten darauf mit 400. DELETE und GET brauchen kein `Content-Length`.
- **(R2) Festes Textformat für `appinfo/routes.php`**, weil die Shell-Tests von [C] die Datei als Text lesen: eine Route je Zeile als Array-Literal in genau dieser Schlüsselreihenfolge, `['name' => 'x#y', 'url' => '/…', 'verb' => 'GET'(, 'requirements' => $id|$tok)],`. Ebenso `public const PROTOCOL = 1;` in `Application.php` und `public const INITIAL_STATE_KEYS = [...];` (eine Zeile, einfache Anführungszeichen) in `PageController.php`.

### 4.2 Gemeinsame Konventionen

- **Anfrage-Header für Angemeldete:** `requesttoken: <getRequestToken()>`, `X-Requested-With: XMLHttpRequest`, `Content-Type: application/json`. CSRF bleibt an. Antwortet der Server mit 412, holt der Client einmal `GET /index.php/csrftoken` und wiederholt die Anfrage.
- **Anfrage-Header für Gäste:** `X-Requested-With: XMLHttpRequest`, `X-Knorke-Guest: <guestToken>` (außer beim Beitritt), `Content-Type: application/json`.
- **`refuseCrossSite()`** (Port aus Pulse) läuft in jedem öffentlichen POST zuerst, noch vor jedem Lookup:
  - durchlassen, wenn `X-Requested-With` gleich `XMLHttpRequest` ist (ohne Beachtung der Groß-/Kleinschreibung)
  - sonst durchlassen, wenn `Sec-Fetch-Site` gleich `same-origin` oder `none` ist
  - sonst 403 `cross_site`
- **Kompression:** Alle Antworten sind `JSONResponse` oder `RawJsonResponse extends JSONResponse`. Damit gzippt NCs `CompressionMiddleware` jede 200er-Antwort, wenn der Client `Accept-Encoding: gzip` schickt (Browser tun das immer). **Abweichung zum Spike-Digest:** Es gibt kein eigenes `gzencode`; die Middleware erledigt das, sofern die Klasse von `JSONResponse` erbt (geprüft in `CompressionMiddleware.php`, NC 34.0.1).
- **Protokollversion:**
  - `Application::PROTOCOL = 1` und `src/sync/protocol.js` `PROTOCOL = 1` müssen gleich sein; ein Test prüft das.
  - Jede Sync-Anfrage schickt `"proto": 1`. Weicht sie ab, antwortet der Server 409 `protocol`, und der Client lädt die Seite einmal neu (Schutz über einen `sessionStorage`-Marker, Pulse-Muster).
- **Fehlerform der App:** immer `{"error": "<code>", "message": "<English text>"}`.
- **(R2) Fehler, die nicht von der App kommen**, haben diese Form **nicht**:
  - **401 für Angemeldete** (Session weg) und **412** (CSRF) erzeugt Nextclouds `SecurityMiddleware` als `{"message": …}`. Eine App-Middleware kann das nicht umbauen: `MiddlewareDispatcher::afterException` ruft nur Middlewares bis `middlewareCounter` auf, und App-Middlewares sind vor der Security-Prüfung nie gelaufen (geprüft, NC 34.0.1). Der Client schickt `Accept: */*` und bekommt deshalb JSON statt einer Weiterleitung.
  - **429/503 vom Proxy** (Traefik-Token-Bucket, Wartung) sind meist kein JSON.
  - `http.js` bildet jede Antwort ohne `error` auf `code = 'http_' + status` ab. **Für diese Fälle entscheiden Transport und SyncClient am Status**, nicht am Code (§6.4).

| Status | `error` | Bedeutung | Client-Reaktion |
|---|---|---|---|
| 400 | `bad_request`, `too_many_ops`, `name_required`, `title_required` | Eingabe kaputt | Fehler anzeigen; bei Sync: Batch verwerfen + Resync |
| 401 | – (`http_401`, Nextcloud) | keine Session (nur Angemeldete) | Status `logged_out`, Banner „Bitte neu anmelden“, Polling stoppt |
| 401 | `guest_token` | Gast-Token ungültig, abgelaufen oder für ein anderes Board | automatischer Neu-Beitritt mit dem gespeicherten Link-Token, **genau einmal** je Fehlerfolge |
| 403 | `forbidden` | Rolle reicht nicht (z. B. Board-Verwaltung als Mitglied) | Meldung |
| 403 | `link_revoked` | Link erneuert/abgeschaltet (`link_gen` passt nicht, oder der Token ist als zurückgezogen bekannt) | **(R2)** Status `revoked`, Polling stoppt, **kein** automatischer Beitritt |
| 403 | `links_disabled` | **(R5)** Nextclouds Link-Freigabe-Richtlinie verbietet Links für den Board-Besitzer (§4.9.7). Meldung „Link sharing is disabled by the administrator.“ | Endgültig, kein automatischer Neuversuch: auf `/sync` (Gast, auch beim Neu-Beitritt nach 401) Status `links_disabled` mit Banner und Polling-Stopp; beim Beitritt (Gast und angemeldet) Endzustand; bei enable/rotate im Teilen-Dialog Hinweis statt Fehler-Toast (§6.4, §6.6) |
| 403 | `cross_site` | Schutz gegriffen | Programmfehler, loggen |
| 404 | `not_found` | Board/Link fehlt **oder kein Zugriff** (kein Besitz-Orakel) | Polling stoppt endgültig (Pulse-Regel), Banner; beim Gast-Beitritt zusätzlich den gespeicherten Gast-Eintrag löschen |
| 409 | `protocol` | veralteter Client | einmal neu laden |
| 411 | `length_required` | **(R2)** `Content-Length` fehlt | Programmfehler, loggen, Backoff |
| 412 | – (`http_412`, Nextcloud) | CSRF-Token veraltet | einmal `GET /index.php/csrftoken`, dann dieselbe Anfrage einmal wiederholen; erneut 412 → `logged_out` |
| 413 | `too_large` | Body > 1 MiB | Batch halbieren und neu senden |
| 429 | `rate_limited` | App-Drossel (Beitritt/Anlegen) | Meldung, **nicht** automatisch wiederholen (endgültig) |
| 429 | – (`http_429`, Proxy) | **(R2)** Edge-Token-Bucket | Bei join/snapshot/sync wiederholen: `Retry-After` beachten, sonst 2–10 s mit Zufall; zählt nicht als `offline` |
| 500 | `internal` | unerwartet; serverseitig mit `LoggerInterface` geloggt (nie Tokens) | Backoff; **(R5)** nach 3 Antworten für denselben Batch isoliert der Client die verdächtigen Ops, statt denselben Batch endlos zu wiederholen (§6.4). Zählt als 500 mit oder ohne App-Form; Proxy-502/503/504 zählen nie |
| 503 | – | Wartung/Upgrade/Proxy | wie Proxy-429 |

### 4.3 Board-Liste und Links

**Board-Objekt** (Liste, Anlegen, Umbenennen):

```json
{"id": 7, "title": "Retro KW41", "role": "owner", "updatedAt": 1760100000000,
 "owner": {"uid": "alice", "name": "Alice Adler"}, "viaLink": false, "linksAllowed": true}
```

- **(R5)** `linksAllowed` (bool, letzter Schlüssel) ist die Link-Richtlinie des **Besitzers** dieses Boards (§4.9.7). Ein fehlender Schlüssel gilt im Client als `true`.
- `GET /api/v1/boards` → `{"boards": [Board, …]}`. Die Liste enthält eigene Boards und Mitgliedschaften, nach `updatedAt` absteigend und dann nach `id` sortiert. Den Anzeigenamen des Besitzers liefert `IUserManager::getDisplayName`, je Anfrage zwischengespeichert. **(R5)** Die Richtlinie wird je Liste einmal je verschiedenem Besitzer ausgewertet (ein Nutzer-Lookup, bei Ausschlussgruppen dazu ein Gruppen-Lookup); die Liste ist kein heißer Pfad.
- `POST /api/v1/boards` mit `{"title": "…"}` → 201 `{"board": Board}`. Der Titel wird getrimmt, muss 1–200 Zeichen haben und darf keine Steuerzeichen enthalten. Ist er leer → 400 `title_required`. **(R5)** Ohne 4-Byte-UTF-8 in der DB (§3) wird jeder Codepunkt über U+FFFF zu U+FFFD; die Antwort trägt den gespeicherten Titel (ebenso beim Umbenennen).
- `PATCH /api/v1/boards/{id}` mit `{"title": "…"}` → `{"board": Board}`. Nur der Besitzer, sonst 404 bzw. 403 (Mitglied → 403 `forbidden`; Fremder → 404).
- **(R5) Link-Mitglieder bei verbotenen Links:** Solange die Richtlinie Links für den Besitzer verbietet, gilt ein Mitglied, das über einen Link beigetreten ist (`link_id` ≠ NULL), als Fremder: Das Board fehlt in seiner Liste, Snapshot und Sync antworten 404 `not_found`, PATCH/DELETE des Boards 404 (nicht 403). `listFor` und `requireOwner` behandeln es so.
- `DELETE /api/v1/boards/{id}` → `{"deleted": true}`. Nur der Besitzer. Ablauf in §4.10.4.
- `POST /api/v1/boards/{id}/link` mit `{"rotate": false}` → `{"link": {"token": "…24…", "role": "edit", "url": "https://…/index.php/apps/knorke/p/<token>"}}`.
  - Gibt es keinen aktiven Link, wird einer angelegt.
  - Gibt es einen und `rotate` ist `true`, wird erneuert (§4.10.4).
  - Gibt es einen und `rotate` ist `false`, wird der vorhandene geliefert.
  - Die `url` kommt aus `IURLGenerator::linkToRouteAbsolute('knorke.publicPage.show', …)`.
  - **(R5)** Verbietet die Richtlinie Links für den Besitzer (§4.9.7) → 403 `links_disabled`, mit `rotate` `true` wie `false`. Geprüft **nach** der Besitzerprüfung, ein Fremder bekommt also weiter 404. Die 403-Antwort hat kein `linksAllowed`-Feld.
- `DELETE /api/v1/boards/{id}/link` → `{"link": null}`. **(R5)** Funktioniert auch, solange Links verboten sind.
- `POST /api/v1/links/{token}/join` (angemeldet) → `{"boardId": 7}`.
  - Besitzer oder gültiges Mitglied: keine Änderung.
  - Sonst wird ein `members`-Eintrag mit `role = links.role` und `link_id` angelegt. **(R4)** Das läuft in einer Transaktion unter dem Board-Lock (§4.10.4). **(R5) Korrektur nach Implementierung:** Eine vorhandene Zeile auf einem zurückgezogenen Link gewährt nichts und wird ersetzt (`deleteMember` + `addMember`); sonst sperrte der Rückhalt aus §5.2 das Konto dauerhaft aus, weil `insertIgnoreConflict` eine alte Zeile nie ersetzt.
  - **(R2)** Bekannter, zurückgezogener Token (`revoked_at` gesetzt) → 403 `link_revoked`, **ohne** Fehlversuch.
  - **(R5)** Nach der Rückzugsprüfung: Nicht-Besitzer und die Richtlinie verbietet Links → 403 `links_disabled`. Der Besitzer bekommt weiter `{"boardId"}`.
  - Nie ausgestellter Token → `LinkThrottle::missBlocked()` → 404 (bzw. 429, wenn gesperrt).

### 4.4 Snapshot

`GET /api/v1/boards/{id}/snapshot` (Angemeldete) führt immer die **volle** Rechteprüfung aus und setzt danach den Grant neu. `GET /pub/v1/boards/{id}/snapshot` (Gäste) prüft das Token in der Reihenfolge aus §4.9.3 (Board-Bindung `b` zuerst) und danach `link_gen`.

```json
{
  "proto": 1,
  "rev": 42,
  "minRev": 0,
  "schema": 1,
  "board": {"id": 7, "title": "Retro KW41", "role": "owner",
            "link": {"token": "Ab3dEf…", "role": "edit", "url": "https://…/p/Ab3dEf…"}, "linksAllowed": true},
  "me": {"pid": "3f9a1c0b7d2e4a51", "name": "Alice Adler", "role": "owner", "guest": false},
  "items": [
    {"id": "01JA2B3C4D5E6F7G8H9J0KMNPQ", "t": "sticky", "x": 120.0, "y": 80.0, "w": 200.0, "h": 200.0,
     "r": 0.0, "z": "i0", "parent": null, "data": {"text": "Hallo"}, "style": {"fill": "#a8d8f8"}}
  ]
}
```

- **Den rev vor den Items lesen** (Spike-Regel): Ein Schreibvorgang, der dazwischen committet, steht dann in den Items **und** im nächsten Sync. Doppelt angewendet ist harmlos; eine verpasste Änderung wäre es nicht.
- `items` enthält nur lebende Objekte (`deleted = 0`), sortiert nach `id`. Jedes Element wird mit `ItemStore::itemJson()` zusammengesetzt (`data`/`style` wörtlich eingespleißt, leer → `{}`). **(R4)** Der JSON-Text wird inkrementell gebaut: Jedes `itemJson` wird beim Iterieren an **einen** String angehängt, ohne Zwischen-Arrays aus Zeilen oder Fragmenten (`implode`); Spitzenspeicher ≈ 1,3 × Body statt ≈ 3 × (§4.8 `MAX_BOARD_BYTES`). **(R5) Gemessen:** ≈ 2 × Antwort (8,2 MiB Antwort → +16,4 MiB auf PG und SQLite, 2,33 × auf MySQL/MariaDB, §3), weil der String wächst; gut unter dem 128-MiB-Gate. Näher an 1 × käme nur eine gestreamte Antwort, die Nextclouds `CompressionMiddleware` und den `RawJsonResponse`-Vertrag umginge. `snapshotItems()` ist ein Generator über einen streamenden Cursor (`ItemStore::each()`).
- `board.link` gibt es nur für den Besitzer (sonst fehlt der Schlüssel); ist kein Link aktiv, steht dort `null`.
- **(R5)** Das Board des Besitzers ist `{id, title, role, link, linksAllowed}`. `link` wird auch geliefert, solange Links verboten sind, denn der Link bleibt bestehen und wird nicht zurückgezogen (§4.9.7). Mitglieder und Gäste bekommen weder `link` noch `linksAllowed`; ein fehlender Schlüssel heißt `true`.
- `me.pid` ist eine opake, je Board stabile Teilnehmer-ID (§4.9.4). Uids gelangen nie an Gäste.
- Beim Gast-Beitritt (§4.9) hat die Antwort dieselbe Form plus `"guest": {"token": "<signed>", "exp": 1762700000}`.

### 4.5 `POST …/sync` – eine Anfrage je Takt

**Anfrage:**

```json
{
  "proto": 1,
  "client": "cK3j9aZp2Q",
  "since": 42,
  "seq": 17,
  "ops": [
    {"o": "put", "id": "01JA…", "t": "sticky",
     "p": {"x": 100, "y": 40, "w": 200, "h": 200, "r": 0, "z": "i1", "parent": null,
           "data": {"text": ""}, "style": {"fill": "#a8d8f8"}}},
    {"o": "patch", "id": "01JB…", "p": {"x": 340.5, "y": 120, "parent": "01JF…"}},
    {"o": "remove", "id": "01JC…"}
  ],
  "me": {"c": [512.3, -88.0], "s": ["01JB…"], "d": [], "e": null},
  "pres": 1
}
```

| Feld | Pflicht | Regel |
|---|---|---|
| `proto` | ja | gleich `Application::PROTOCOL`, sonst 409 |
| `client` | ja | `^[A-Za-z][A-Za-z0-9]{0,15}$`; der Client erzeugt `'c'` + 9 Zeichen alphanumerisch und hält die ID je Tab und Board in `sessionStorage` |
| `since` | ja | int ≥ 0; der Cursor des Clients (der zuletzt bestätigte `rev`) |
| `seq` | nur mit `ops` | int ≥ 1, je Client monoton; wird in `acks.seq` zurückgegeben. Eine Wiederholung nach Netzfehler schickt denselben Batch mit derselben `seq` |
| `ops` | nein | 0–200 Ops (> 200 → 400 `too_many_ops`); Formate in §4.6 |
| `me` | nein | eigene Präsenz; fehlt sie, schreibt der Server keine Präsenz. `c`: `[x, y]` in Weltkoordinaten oder `null`; `s`: höchstens 20 ULIDs (Auswahl); `d`: höchstens 20 × `[ulid, x, y]` (Ziehvorschau, **absolute** Welt-Position oben links); `e`: ULID oder `null` (bearbeitet gerade Text = Text-Lease, §4.11); **(R2)** `tk`: 1 = Lease übernehmen (nur zusammen mit `e`, einmalig nach „Übernehmen“). Für die Rolle `view` wird `me` ignoriert |
| `pres` | nein | 1 (Vorgabe) = Präsenz der anderen mitliefern, 0 = nicht |

Andere Schlüssel → 400 (§4.1 `JsonBody`).

**Antwort** (`RawJsonResponse`, Schlüssel fehlen, wenn sie leer wären; **Ausnahme `presence`**, siehe Tabelle):

```json
{
  "rev": 45,
  "items": [ {"id": "01JA…", "t": "sticky", "x": 100.0, "...": "volles Objekt wie im Snapshot"} ],
  "removed": ["01JC…"],
  "more": true,
  "acks": {"seq": 17, "rev": 44, "res": ["ok", "ok", "gone"]},
  "presence": {
    "3f9a1c0b7d2e4a51:cK3j9aZp2Q": {"n": "Bob Berg", "k": "3f9a1c0b7d2e4a51", "g": 0,
                                    "x": 12.5, "y": -40.0, "s": [], "d": [], "e": null, "h": 0}
  },
  "resync": true
}
```

| Feld | Bedeutung |
|---|---|
| `rev` | neuer Cursor des Clients. Er wird **nur** übernommen, wenn `resync` fehlt |
| `items` | aktueller Zustand jedes Objekts mit `since < items.rev ≤ rev`, **je Objekt verdichtet**: ein Eintrag mit dem letzten Stand, egal wie viele Änderungen dazwischen lagen (Korrektur 5, Option B). Reihenfolge nach (`rev`, `id`) |
| `removed` | IDs von Grabsteinen mit `since < items.rev ≤ rev`. Eine ID steht nie zugleich in `items` |
| `more` | Die Seite war voll, es gibt mehr bis zum echten rev; der Client fragt **sofort** wieder |
| `acks` | nur wenn `ops` geschickt wurden. `res` ist positionsgleich mit `ops`. **(R2)** `rev`: der rev des Schreib-Batches, wenn etwas geschrieben wurde. Lief eine Transaktion, schrieb aber nichts Wirksames (nur `dup`/`gone`/`locked`/No-op), wird sie zurückgerollt, und `rev` ist der unter dem Lock beobachtete Board-rev (`head.rev − 1`). `null` nur, wenn gar keine Transaktion lief (alle `bad`/`denied`) |
| `presence` | **(R3) Immer vorhanden, wenn `pres = 1`, auch als `{}`; ist Präsenz nicht verfügbar (kein Redis), immer `{}`**. Bei `pres = 0` fehlt der Schlüssel. Einträge der **anderen** (der eigene Schlüssel `<pid>:<client>` ist ausgenommen, `t` und `es` entfernt). `n` Anzeigename, `k` pid (für die Farbe), `g` 1 = Gast, `x`/`y` Cursor oder `null`, `s`, `d`, `e` wie in der Anfrage, **`h`** 1 = dieser Eintrag hält die Text-Lease für `e` (§4.11) |
| `resync` | `true`: Der Client verwirft den bestätigten Zustand und lädt den Snapshot neu (§4.10.3). `acks` und `presence` gelten trotzdem |

Wichtige Eigenschaften:
- Die Antwort deckt den **eigenen Schreibvorgang** ab: `rev ≥ acks.rev`, es sei denn `more` ist gesetzt. Die eigenen Objekte kommen in `items` derselben Antwort zurück. **(R5)** Das gilt auch, wenn der Server einen Wert beim Speichern geändert hat (U+FFFD-Ersatz, §4.8): Die Op wird `ok` quittiert, das Objekt kommt in seiner gespeicherten Form mit `rev = acks.rev > since`, und der Client konvergiert ohne Neuladen. Bei `more: true` kommt es mit der Folgeseite.
- Gilt `since == rev` ohne `ops`, ist die Antwort `{"rev":42}` plus `presence` (bei `pres = 1`), und zwar **ohne App-SQL** (§5.2).
- Seitengröße `Limits::PAGE = 500` Objekte. Eine Seite zerteilt nie einen rev; den Sonderfall „ein rev hat mehr als PAGE Objekte“ behandelt §4.10.2.
- **Verdichtung ist korrekt, weil:** Ein Objekt, dessen aktueller `rev` ≤ `since` ist, hat der Client schon im letzten Stand. Ein Objekt mit `rev` > `upTo` kommt beim nächsten Takt mit vollem Stand. Zwischenstände dürfen fehlen. Folge für den Client: **Zwischen den Seiten** kann ein Kind vor seinem Eltern-Frame ankommen; der Client muss unbekannte `parent` als Wurzel behandeln, bis der Elternteil eintrifft (§6.2).

### 4.6 Ops und Ergebniscodes

| Op | Form | Wirkung |
|---|---|---|
| put | `{"o":"put","id":ULID,"t":type,"p":{x,y,w,h,r,z,parent,data,style}}` | Legt an. `t` muss ein Registry-Typ sein (M0: `sticky`, `frame`). `z` ist Pflicht und muss `ZOrder::isValid` bestehen; fehlende Zahlen werden 0, `data`/`style` werden `{}`, `parent` wird `null`. Der Client schickt `x`, `y`, `parent` immer mit |
| put + revive | dazu `"revive": true` | Wie put, belebt aber auch einen **Grabstein** derselben ID wieder (nur für Undo von Löschen), **(R2)** auch einen, den derselbe Batch gerade entfernt hat. **(R4)** Nur mit dem gespeicherten Typ: weicht `t` vom Typ des Grabsteins (bzw. der im Batch entfernten Arbeitskopie) ab → `bad`, die Arbeitskopie bleibt unberührt (ein früheres remove im Batch wirkt weiter, seine Kinder werden normal freigegeben) |
| patch | `{"o":"patch","id":ULID,"p":{"<path>": value \| null, …}}` | Setzt 1–50 Pfade, `null` (und **(R2)** `{}`/`[]`) löscht. Pfade: `x`, `y`, `w`, `h`, `r`, `z`, `parent`, `data.<k>[.<k>…]`, `style.<k>[.<k>…]` (1–4 Ebenen unter `data`/`style`, Schlüssel `^[A-Za-z][A-Za-z0-9_-]{0,39}$`). **(R2) Lagegruppe:** Enthält ein patch einen der Pfade `x`, `y`, `parent`, muss er alle drei enthalten, sonst `bad` (§4.7 Regel 2a) |
| remove | `{"o":"remove","id":ULID}` | Setzt einen Grabstein. Ist das Objekt ein Container, werden die übrigen Kinder freigegeben (§4.7) |

**(R3) Nachsicht, so umgesetzt:** Unbekannte Schlüssel auf Op-Ebene und unbekannte Wurzelschlüssel in `put.p` werden ignoriert (Vorwärtskompatibilität, client-interne Merker). Unbekannte patch-Pfade sind `bad`. `revive` wirkt nur als literales `true`.

| Code | Bedeutung | Client |
|---|---|---|
| `ok` | angewendet (auch ein No-op-Patch, auch ein freigegebener Eltern-Verweis nach §4.7 Regel 6) | Op bleibt als „bestätigt, wartet“ im Overlay, bis Cursor ≥ `acks.rev`; ist `acks.rev` `null`, sofort erledigt |
| `dup` | put auf lebende ID; der gespeicherte Stand gewinnt (typisch: Wiederholung eines schon angewendeten put) | Op verwerfen |
| `gone` | patch/remove auf fehlendes oder gelöschtes Objekt, put ohne `revive` auf Grabstein | Op verwerfen; Text-Op → Textrettung (§6.5) |
| `bad` | Validierung gescheitert (Format, Typregel, z-Schlüssel, Lagegruppe, nie existierender Elternteil) | Op verwerfen, `console.warn`; Text-Op → Textrettung |
| `denied` | Rolle darf das nicht (z. B. `view`) | Op verwerfen, einmal Toast „Keine Berechtigung“; Text-Op → Textrettung |
| `limit` | Objekt-Limit des Boards erreicht (`Limits::MAX_ITEMS_PER_BOARD`); **(R3)** auch bei put + revive, denn es erhöht die Zahl lebender Objekte. **(R4)** Ebenso, wenn die Op das Byte-Budget `MAX_BOARD_BYTES` überschreiten würde (put, put + revive, wachsender patch); schrumpfende oder größenneutrale Ops sind immer erlaubt (§4.8) | Op verwerfen, Toast „Board ist voll“; Text-Op → Textrettung |
| `locked` | **(R2)** Text-Patch auf ein Objekt, dessen Text-Lease ein **anderer** Teilnehmer frisch hält (§4.11) | Op verwerfen, Textrettung: Editor bleibt offen mit dem getippten Text, Hinweis „Nicht gespeichert: X bearbeitet …“ |

**Wiederholungen sind gefahrlos, ohne Sequenztabelle:** Alle Ops sind idempotente Setz-Operationen:
- put → `dup`
- patch setzt dieselben Werte noch einmal
- remove → `gone`

Ein nach Netzfehler wiederholter Batch kann einen fremden Schreibvorgang aus demselben Zeitfenster überschreiben. Das ist eine gültige LWW-Reihenfolge und wird bewusst hingenommen; dokumentiert in `docs/PROTOKOLL.md`.

### 4.7 LWW-Regeln (serverautoritativ)

1. **Reihenfolge = Server-Reihenfolge.** Batches sind über den Board-Zeilenlock serialisiert (`rev` aufsteigend); innerhalb eines Batches gilt die Array-Reihenfolge.
2. **Granularität = Pfad.** Jeder Pfad ist ein Register. Zeitgleiche Patches auf verschiedenen Pfaden desselben Objekts (`data.text` und `style.fill`) überleben beide. Auf demselben Pfad gewinnt der spätere rev. Ein Vorfahr-Pfad (`data.start`) ersetzt den ganzen Teilbaum; ein späterer Nachfahr-Pfad (`data.start.item`) ändert darin.
   - **2a (R2) Lagegruppe `{x, y, parent}` = ein Register.** `x`/`y` sind relativ zu `parent`; drei getrennte Register ergäben bei zwei Schreibern ein Tripel, das keiner geschrieben hat (A zieht S in Frame F, B zieht S an der Wurzel → S landet als Kind von F bei F + (2000, 500)). Deshalb schreibt jeder patch die Gruppe ganz oder gar nicht (§4.6), put schreibt sie immer, und auch die Freigabe durch den Server (Regel 6) setzt alle drei. Das Ergebnis ist immer das Tripel **eines** Schreibers.
3. **Werte (R2, Variante „leer = abwesend“):**
   - Skalare (string, int, float, bool) und, laut Nachrüst-Regel, **Listen und Objekte als ganze Werte**: höchstens 6 Ebenen tief, höchstens 1000 Elemente je Liste, höchstens 100 Schlüssel je Objekt.
   - **Leere Objekte `{}` und leere Listen `[]` gelten auf jeder Ebene als abwesend**, genau wie `null`. Als patch-Wert heißen alle drei „Pfad löschen“. Innerhalb von Objekt-Werten werden solche Einträge entfernt (wird ein Objekt dadurch leer, entfällt es ebenfalls).
   - **In Listen** sind `null`, `{}` und `[]` als Element verboten → `bad` (Entfernen würde Indizes verschieben).
   - **Schlüssel in Objekt-Werten** müssen ebenfalls `^[A-Za-z][A-Za-z0-9_-]{0,39}$` erfüllen, auf jeder Ebene. Damit gibt es keine numerischen Schlüssel.
   - Begründung: NC dekodiert den Body mit `json_decode($content, true)`; PHP kann `{}` und `[]` danach nicht mehr unterscheiden, und `{"0": …}` wird zur Liste. Mit diesen Regeln ist ein PHP-Array eindeutig: leer = abwesend, `array_is_list` = Liste, sonst Objekt. JS (`paths.js`) wendet dieselben Regeln an, die goldenen Fälle in `paths-golden.json` decken `{}`/`[]` in Tiefe 1–3 und numerische Schlüssel ab, und der PHP-Test liest die Fixtures **wie die Produktion** (`json_decode(…, true)`).
   - Ein fremder Client, der `{"0": "a"}` schickt, bekommt die Server-Form (Liste) zurück; `isWireValue` in JS lehnt solche Schlüssel ab, ein korrekter Client schickt sie nie.
   - **(R3) Die Grenzen gelten für den Rohwert, vor dem Säubern** (PHP `PathOps::isWireValue` und JS `isWireValue` gleich): Ein Container auf Ebene 7 ist `bad`, auch wenn er leer ist; ein Objekt mit 101 Schlüsseln ist `bad`, auch wenn alle Werte `null` sind; ein ungültiger Schlüssel ist `bad`, auch mit dem Wert `null`. In JS sind zusätzlich `undefined`, `NaN`, `±Infinity` und Klasseninstanzen überall ungültig.
   - **(R3)** Weitere Feinheiten von `setPath` legt `paths-golden.json` fest: Löschen eines fehlenden Pfads ist ein strikter No-op, auch durch einen Skalar, eine Liste oder einen fehlenden Wurzelcontainer hindurch (sonst verdeckte ein Löschen eine Änderung, die das Log nie aufzeichnet); Setzen durch einen Skalar oder eine Liste ersetzt sie durch ein Objekt; `data`/`style` bleiben als `{}` stehen; nur eigene Schlüssel zählen (`constructor`, `toString` sind gewöhnliche Schlüssel).
   - **(R4) Form nach dem Patch:** Nach dem Anwenden eines patch müssen `data` und `style` der Arbeitskopie weiter die put-Grenzen erfüllen: höchstens 100 Wurzelschlüssel (`PathOps::MAX_KEYS`), und jeder Wurzelwert besteht `isWireValue` ab Tiefe 0 (≤ 6 Ebenen, ≤ 100 Schlüssel je Objekt, ≤ 1000 Listenelemente). Sonst `bad` (Prüfung neben `MAX_ITEM_BYTES`, z. B. `ItemRegistry::fitsShape()`). Sonst bauten Pfade Wurzelschlüssel einzeln auf oder schachtelten 4 Pfadebenen plus einen 6-Ebenen-Wert, und Undo von Löschen (put + revive des gespeicherten Stands) bekäme `bad`. **Invariante:** Jedes gespeicherte Objekt lässt sich mit `revive` erneut putten. M0-Clients schicken solche Patches nie.
4. **put gegen put** auf dieselbe ID: Der erste gewinnt, der zweite bekommt `dup`.
5. **remove gegen patch:** Kommt remove zuerst, wird der patch zu `gone`. Kommt patch zuerst, ist danach entfernt. Nur `revive` belebt wieder.
6. **Eltern-Invariante** (der Server erzwingt sie, im Lock): Jedes lebende Objekt hat `parent = null` oder einen **lebenden Container** desselben Boards, dessen Typ es als Kind erlaubt (Registry `childOf`). Die Prüfung läuft zum Zeitpunkt der Op gegen die Arbeitskopien des Batches.
   - **(R2) Drei Fälle für den genannten Elternteil P:**
     - P hat nie existiert (keine Zeile, nicht im Batch angelegt) **oder** P verletzt eine Typregel (kein Container, `childOf` passt nicht, Zyklus) → `bad`.
     - P ist ein **Grabstein** (Zeile mit `deleted = 1` oder im selben Batch entfernt) → **kein** `bad`, sondern Freigabe wie unten: `parent = null`, `x += P.abs.x`, `y += P.abs.y` (in M0 sind Container Wurzel, also `P.x`/`P.y` aus der gespeicherten Zeile). Ergebnis `ok`. So verschwindet eine neue Notiz, die gerade in einem Frame entsteht, den jemand löscht, nicht samt Text, und ein Kind, das jemand innerhalb eines gelöschten Frames verschiebt, behält eine stimmige absolute Lage.
     - P lebt und passt → gesetzt.
   - Zyklen sind ausgeschlossen: Es wird höchstens 8 Ebenen nach oben gelaufen; der eigene Knoten als Vorfahr → `bad`. In M0 haben Container keine Eltern.
   - **Freigabe:** Ist ein Container **am Ende des Batches** entfernt (Endzustand `removed`), setzt der Server jedes noch lebende Kind auf `parent = null`, mit `x += container.x` und `y += container.y`. Das gilt für Kinder aus der DB und für Kinder aus dem Batch selbst; die Freigabe-Pfade werden mit eventuellen Patches desselben Kindes zu **einer** Änderungszeile `patch` zusammengeführt, gleicher rev (§3.5). Die absolute Lage bleibt dadurch gleich. Ein Container, den derselbe Batch entfernt und wieder belebt, gibt keine Kinder frei.
7. **Typregeln** (Registry, §4.8): Frames sind nicht drehbar (`r ≠ 0` → `bad`). Größen liegen in den Typgrenzen. Bekannte Felder werden typisiert geprüft; unbekannte Felder unter `data`/`style` werden **erhalten** und nur generisch geprüft.
8. **Unbekannte Typen:** put nimmt nur Registry-Typen an. patch und remove auf **gespeicherte** Objekte unbekannten Typs (Import, spätere Version, Rückstufung) sind mit generischen Regeln erlaubt; ein `parent` ist dort nur als `null` zulässig.
9. **No-op:** Ein patch, der nichts ändert, schreibt keine Zeile und keine Änderung (das Ergebnis bleibt `ok`). Ein Batch, der nur aus `bad`/`denied` besteht, öffnet **keine** Transaktion und erhöht den rev nicht (behebt Spike-Mangel §4.12). **(R2)** Schreibt ein Batch im Lock nichts Wirksames (nur `dup`/`gone`/`locked`/`limit`/No-op), wird die Transaktion über eine Wächter-Ausnahme zurückgerollt: kein rev-Sprung, kein `bumpRev`, alle Poller bleiben auf dem Fastpath; `acks.rev` = beobachteter rev (§4.5).
10. **Konflikte werden nicht gezählt** (kein `cf`, keine Abfrage `foreignPaths`); das war nur eine Messhilfe.
11. **(R2) Text-Lease** (§4.11): Ein patch, der den Textpfad seines Typs (`textPath`: `data.text` bei Notizen, `data.title` bei Frames) setzt, wird mit `locked` abgelehnt, wenn ein **anderer** Principal die frische Lease für dieses Objekt hält. Andere Pfade (Farbe, Lage) bleiben frei.

**Client-seitig** (§6.4):
- Sichtbarer Zustand = bestätigter Server-Zustand ⊕ eigene ausstehende Ops in Sende-Reihenfolge. Eigene unbestätigte Änderungen haben dadurch Vorrang und flackern nicht.
- Ein Objekt, das lokal gerade gezogen oder bearbeitet wird, ignoriert fremde Änderungen bis zum Loslassen. Danach wird der Commit oben auf den neuesten bestätigten Zustand gelegt.
- **(R2)** Ops auf dieselbe ID behalten in der Warteschlange und im Batch ihre relative Reihenfolge (§6.4 `takeBatch`). Ein `bad`/`gone`/`locked`/`denied` auf einer Text-Op verwirft nie still den getippten Text (§6.5 Textrettung).

### 4.8 Validierung und Limits

`lib/Service/Limits.php`. Werte mit `*` lassen sich per `occ config:app:set knorke <key> --value N` übersteuern, aber nur mit einer positiven Ganzzahl (Pulse-Regel: 0 oder ein Tippfehler heißt nie „unbegrenzt“).

| Konstante | Wert | Wirkung |
|---|---|---|
| `MAX_OPS` | 200 | je Anfrage, sonst 400 |
| `MAX_PATCH_PATHS` | 50 | je patch, sonst `bad` |
| `MAX_ITEM_BYTES` | **65536 (R2)** | `strlen(ItemStore::obj($data)) + strlen(ItemStore::obj($style))` nach dem Anwenden, sonst `bad`. Muss ≥ 4 × `MAX_TEXT` + 4 × `MAX_TITLE` + 8 KiB sein (UTF-8 bis 4 Byte je Codepunkt; `obj()` kodiert ohne `\uXXXX`-Escapes und ohne `JSON_HEX_TAG`). 6000 × „漢“ oder × „😀“ passt also immer |
| `MAX_TEXT` | 6000 | Zeichen (`mb_strlen`, Codepunkte) für `data.text`; im Client als `maxlength` (zählt UTF-16-Einheiten, also strenger) |
| `MAX_TITLE` | 200 | Board-Titel, Frame-`data.title` |
| `MAX_STRING` | 6000 | jeder andere String-Wert (generisch) |
| `MAX_BODY_BYTES` | 1048576 | `Content-Length` größer → 413, fehlend → 411 |
| `PAGE` | 500 | Objekte je Sync-Seite |
| `MAX_ITEMS_PER_BOARD`* | **5000 (R2)** | lebende Objekte (`item_count`), Überschreitung → `limit`. Gemessen ist eine Szene mit 4670 Objekten; über 5000 erst nach einer Labormessung mit 10000 (Kamera-Schritt O(N), ERGEBNIS §1) |
| `MAX_BOARD_BYTES`* | **8388608 (R4)** | Byte-Budget je Board, App-Config `max_board_bytes` (nur positive Ganzzahl). Gemessen als Summe über lebende Objekte von `strlen(ItemStore::obj(data)) + strlen(ItemStore::obj(style))` (dieselbe Formel wie `MAX_ITEM_BYTES`, je Objekt einmal berechnet und wiederverwendet), gepflegt in `boards.item_bytes` unter dem Lock wie `item_count`. Beitrag je Op: put und put + revive `+size`, patch `size(neu) − size(alt)`, remove und new → none `−size(cur)`; nur freigegebene Kinder 0. Eine Op, die die Summe **über** das Budget **erhöht**, → `limit` und wird nicht angewendet (Arbeitskopie unberührt); schrumpfende und größenneutrale Ops sind immer erlaubt, damit sich ein Board über einem gesenkten Budget aufräumen lässt. Grund: Ohne Budget hielt ein Board ≈ 320 MiB `data`/`style`, und Snapshot bzw. Sync brauchten ≈ 0,9–1 GB je Anfrage (500 bzw. Fatal bei 512M) |
| `MAX_BOARDS_PER_OWNER`* | 500 | Anlegen → 429 `rate_limited` mit Meldung |
| `CREATE_PER_10MIN`* | 30 | **(R2)** `knorke-create`-Limiter; App-Config `create_limit`, `dev/up.sh` setzt 1000 |
| `NUM_ABS_MAX` | 1e7 | `\|x\|`, `\|y\|` |
| `PRESENCE_IDS` | 20 | `s`, `d` |
| `PRESENCE_PER_PID` | 3 | **(R2)** Präsenz-Einträge je pid (Tabs); der älteste derselben pid fliegt |
| `NAME_MAX` | 40 | Gastname nach Säuberung |
| `GUEST_TOKEN_MAX` | 1024 | **(R2)** Byte, statt 600 |
| `GUEST_TTL` | 30 Tage | Gast-Token-Laufzeit, beim Neu-Beitritt verlängert |
| `CHANGES_RETENTION` | 30 Tage | CleanupJob (auch zurückgezogene Links) |
| `LEASE_FRESH_MS` | 10000 | **(R2)** Präsenz-Eintrag gilt als frisch (auch für die Text-Lease) |

**Generische Prüfung** (`OpValidator`, rein statisch):
- `id` matcht ULID
- Zahlen sind `int|float`, endlich, `|v| ≤ 1e7`; `w`, `h` ≥ 0
- `r` liegt in [-360, 360]
- **(R2)** `z`: `ZOrder::isValid($z)` (bei put und bei patch von `z`), sonst `bad`. Das ist ein Port von `validateOrderKey` aus fractional-indexing 4.0 mit `digits = intDigits = '0123456789abcdefghijklmnopqrstuvwxyz'`:
  1. `^[0-9a-z]{1,64}$`
  2. nicht der kleinste Schlüssel `'0' . str_repeat('0', 18)`
  3. Kopf `h` = erstes Zeichen, `i` = Position in den 36 Ziffern, `half = 18`; Ganzzahlteil-Länge `n = i < half ? half − i + 1 : i − half + 2`; `strlen(z) ≥ n`, sonst ungültig
  4. der Bruchteil `substr(z, n)` endet nicht auf `'0'`
  - Golden (`tests/fixtures/zorder-golden.json`, Form `{"valid": [...], "invalid": [...]}`, von PHP **und** JS geprüft): gültig mindestens `i0`, `hz`, `j00`, `i0a`, `i1`, `zzzzzzzzzzzzzzzzzzz` (Kopf `z` mit 19 Zeichen); ungültig mindestens `a`, `zz`, `0`, `i10`, `''`, `i0V` (Großbuchstabe), `0000000000000000000` (kleinster Schlüssel), **(R3)** zwei Schlüssel mit 65 Zeichen: `i0` + 63 × `1` (fractional-indexing nimmt ihn an, er ist also wie `i0V` nur per Regex ungültig; ohne die Grenze endete er am `varchar(64)` mit 500) und `i` + 64 × `0`. Ohne diese Prüfung reicht ein einziger gespeicherter Schlüssel wie `a`, damit `keyBetween` auf jedem Client wirft und auf dem Board niemand mehr anlegen oder umordnen kann (über den öffentlichen Bearbeitungslink erreichbar).
  - **Abweichung zum Spike**: Der Regex dort erlaubte auch Großbuchstaben.
  - **(R4) Erschöpfte Enden bleiben gültig.** Schlüssel wie `'z'` × 64 (kein Nachfolger), `'0'` × 63 + `'1'` (kein Vorgänger) oder zwei benachbarte 64-Zeichen-Schlüssel (nichts dazwischen) bestehen `ZOrder::isValid` und bleiben auf dem Server erlaubt; jeder Bearbeitungslink-Inhaber kann sie mit einem Sync speichern. Eine strengere Server-Regel verschöbe die Wand nur (jede Gesamtordnung über Schlüssel ≤ 64 Zeichen hat ein größtes Element). Stattdessen degradieren die Clients, statt zu werfen (§6.2 `keyBetween`). `zorder-golden.json` bleibt unverändert.
- `parent` ist `null` oder eine ULID; **(R2)** Lagegruppe: patch mit einem von `x`/`y`/`parent` ohne die beiden anderen → `bad`
- Strings:
  - gültiges UTF-8 (`mb_check_encoding`)
  - NUL und C0-Steuerzeichen außer `\t`/`\n` werden entfernt, `\r\n` wird zu `\n`
  - Länge ≤ `MAX_STRING` (sonst `bad`, nicht kürzen)
  - **(R5) 4-Byte-Ersatz:** Ist `IDBConnection::supports4ByteText()` `false` (MySQL/MariaDB mit `mysql.utf8mb4 = false`, `utf8mb3`-Tabellen), ersetzt der Server jeden Codepunkt U+10000–U+10FFFF durch U+FFFD (`Input::bmp`), in jedem String-Wert von `data`/`style` in jeder Tiefe und in Listen, ebenso in Board-Titeln. Das passiert bei der Validierung (`OpValidator::normalize/clean*` mit `$fourByte = false`, von `SyncService::applyOps` vor der Transaktion übergeben), nie als 500. Die Zahl der Codepunkte bleibt gleich, Längengrenzen gelten also weiter. Eine schnelle Byte-Prüfung (F0–F4) überspringt Strings ohne 4-Byte-Folgen. `item_bytes` und das Änderungsprotokoll halten die gespeicherte 3-Byte-Form. Der Schreiber bekommt seine gespeicherten Objekte in derselben `/sync`-Antwort (§4.5). Gastnamen stehen nie in der DB (nur im Gast-Token und in der Präsenz) und bleiben unverändert.
- **(R2)** Objekt- und Listenwerte nach §4.7 Regel 3 (leer = abwesend, keine leeren/`null`-Elemente in Listen, Schlüsselregex auf jeder Ebene)
- **(R4)** Nach jedem patch: `data`/`style` erfüllen weiter die put-Grenzen (≤ 100 Wurzelschlüssel, jeder Wurzelwert `isWireValue` ab Tiefe 0), sonst `bad` (§4.7 Regel 3, „Form nach dem Patch“); dazu das Byte-Budget `MAX_BOARD_BYTES` (`limit`)
- **(R2)** `ItemStore::obj()` kodiert mit `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR`; leeres Array → `{}`. **Kein `JSON_HEX_TAG` mehr**: Objekte werden nur als `application/json` ausgeliefert und nie in HTML eingebettet (Initial-State enthält keine Objekte); `<` kostete sonst 6 Byte und sprengte `MAX_ITEM_BYTES`. FastCache speichert nie Gleitkommazahlen (§5.1)

**Typregeln** (`ItemRegistry`, datengetrieben):

```php
private const TYPES = [
    'sticky' => [
        'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => true,
        'size' => [20, 2000],
        'fields' => ['data.text' => ['text', 6000], 'style.fill' => ['color'], 'style.fontSize' => ['int', 8, 200]],
    ],
    'frame' => [
        'layer' => 'back', 'container' => true, 'childOf' => [], 'rotatable' => false,
        'size' => [50, 100000],
        'fields' => ['data.title' => ['text', 200], 'style.fill' => ['color']],
    ],
];
```

- Prüfarten: `text` (Klartext nach Säuberung, ≤ n Zeichen), `color` (`^#[0-9a-fA-F]{6}$`, gespeichert in Kleinbuchstaben), `int` (Ganzzahl in Grenzen), `enum` (später).
- `size` gilt für `w` und `h`.
- Unbekannte Typen nutzen `GENERIC`: Container `false`, `childOf` leer, drehbar, Größe 0–1e6, keine Feldregeln.
- **Text ist Klartext.** Der Client rendert ihn nie als HTML (Konva-Text, `<textarea>`). Rich Text mit Whitelist kommt erst in M2.

### 4.9 Gäste und Links

#### 4.9.1 Öffentliche Seite `GET /p/{token}`

- **Angemeldet** (`IUserSession::isLoggedIn()`): `RedirectResponse` auf `page#join` (`/apps/knorke/join/{token}`). Die SPA ruft dann `POST /api/v1/links/{token}/join` auf und navigiert zu `/b/{id}`.
- **Gast (R2, Reihenfolge wie Pulse `codeMissBlocked`: nur ein Fehltreffer fragt die Drossel):**
  1. Link suchen (`BoardStore::findLinkByToken`), **ohne** vorher die Drossel zu fragen.
  2. **Aktiver Link** → `TemplateResponse('knorke', 'public', [], <Modus>)` mit `linkState = 'ok'` und `boardId` (Initial-State §6.6). Kein Drosselaufruf.
  3. **Bekannter, zurückgezogener Link** (`revoked_at` gesetzt) → dieselbe Seite mit `linkState = 'revoked'`, `boardId = null`; die UI zeigt „Dieser Link wurde zurückgezogen“. Kein Drosselaufruf, **kein** Fehlversuch.
  4. **Nie ausgestellter Token** → `LinkThrottle::missBlocked(ip)`: gesperrt → `TooManyRequestsResponse`; sonst die Seite mit `linkState = 'invalid'` („Dieser Link ist ungültig“).
  - `<Modus>` ist `RENDER_AS_PUBLIC`; mit App-Config `public_template = base` (nur für die Messung E12) `RENDER_AS_BASE`.
  - Die Seite selbst schreibt nichts.
  - **(R5)** Jede Variante (`ok`, `revoked`, `invalid`) setzt den Initial-State `legal` = `PublicPageController::legalLinks()` (§6.6). Es gibt **keinen** `linkState` `'disabled'`: Ob die Link-Richtlinie Links verbietet, erfährt der Gast erst beim Beitritt (403 `links_disabled`, §4.9.2).

#### 4.9.2 Beitritt `POST /pub/v1/{token}/join`

Anfrage `{"client": "c…", "name": "Gina", "guest": "<altes Gast-Token>"|null}`:

1. `refuseCrossSite()`, dann `JsonBody::read` (§4.1).
2. Link suchen: aktiv → weiter; **zurückgezogen → 403 `link_revoked` ohne Fehlversuch (R2)**; nie ausgestellt → `missBlocked` → 404 (bzw. 429).
   - **2a (R5)** Der Link ist aktiv und sein Board existiert, aber `LinkPolicy::allows(<Board-Besitzer>)` ist `false` → 403 `links_disabled`. Das kommt vor Schritt 3 (Name), vor der Drossel und bevor ein Token ausgestellt wird; es ist **kein** Fehltreffer.
3. Name per `Input::displayName()` säubern (Pulse `cleanText`-Muster): Steuerzeichen und unsichtbare Zeichen entfernen, Leerraum zusammenfassen, auf 40 Zeichen kürzen. Leer → 400 `name_required`.
4. Ist `guest` gesetzt und `GuestToken::verify($t, allowExpired: true)` ergibt **`b === board`** (`lg` darf abweichen: ein Gast, der nach dem Erneuern mit dem neuen Link zurückkommt, behält seine Identität), wird `gid` **übernommen**. Die Identität bleibt so beim Neuladen und Neu-Beitritt erhalten; das behebt Spike-Mangel §4.6.
5. Sonst wird `ILimiter::registerAnonRequest('knorke-guest-'.$board.'-'.$linkId, 300, 600, $ip)` aufgerufen (429 bei Überschreitung) und `gid = 'g' . random(11, alnum)` erzeugt.
   - **(R4) Link-ID im Schlüssel:** Erneuern gibt dem neuen Link ein frisches Budget für neue Gäste und schneidet den Verursacher ab; vorher füllte ein Link-Inhaber das Budget einer geteilten IP in ≈ 9 s und sperrte jeden Neuen hinter derselben NAT 10 min aus, auch nach dem Erneuern. Zurückkehrende Gäste (Schritt 4) bleiben ausgenommen.
   - **Verbleibender Zielkonflikt (NAT):** Ein Insider mit dem **aktuellen** Link kann das Budget seiner NAT weiter für ≤ 10 min erschöpfen. Abhilfe ist das Erneuern des Links; ein Budget je Gerät ist ohne Konto nicht unterscheidbar.
6. Token ausstellen (§4.9.3), Gens seeden, die Snapshot-Antwort mit `me` und `guest` liefern.

#### 4.9.3 Gast-Token (`GuestToken`)

- Claims: `{"v":1,"b":7,"g":"gA1b2C3d4E5","r":"edit","lg":3,"exp":1762700000,"n":"Gina"}`.
- **(R2)** Claims werden mit `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES` kodiert (ein Name aus 40 × „😀“ ergibt sonst über 600 Byte, das Token würde ausgestellt, aber nie bestätigt, und der Client liefe 401 → join → neue gid bis zum 429).
- Token = `b64url(json) . '.' . b64url(hmac_sha256(payload, key))`.
- `key = hash('sha256', 'knorke-guest|' . system.secret, true)`.
- `GuestToken::verify(string $t, bool $allowExpired = false): ?array` (rein, ohne Board-Wissen):
  - genau 2 Teile, ≤ `GUEST_TOKEN_MAX` (1024) Byte
  - `hash_equals` auf die Signatur
  - Pflicht-Claims vorhanden und typrichtig, `v === 1`
  - `exp ≥ now`, außer `allowExpired`
- **(R2) Normative Prüfreihenfolge in `Access::forGuest($token, $id)`** – gilt gleich auf dem Fastpath, dem vollen Pfad und in `publicSync#snapshot`:
  1. `GuestToken::verify($token)` scheitert → 401 `guest_token`.
  2. **`claims.b !== $id` → 401 `guest_token`.** Ohne diese Bindung passt ein Token von Board A (`lg = 1`) auf jedes Board B mit `link_gen = 1`, auch auf private Boards, die nie einen Link hatten; Board-IDs sind fortlaufend.
  3. `claims.r` nicht in den Link-Rollen (M0: `['edit']`) → 401 `guest_token`.
  4. Generationen lesen (`a:<board>` bzw. DB): Board weg → 404 `not_found`; `claims.lg !== link_gen` → 403 `link_revoked`. **(R5)** Danach: `links = 0` in `a:<board>` (Fastpath) bzw. `LinkPolicy::allows(<Besitzer>)` `false` (voller Pfad) → 403 `links_disabled`. Reihenfolge also: 401 `guest_token` → 404 → 403 `link_revoked` → 403 `links_disabled`. Gilt für Gast-Snapshot und Gast-Sync.
  5. Principal mit Rolle `claims.r`, `id = 'g:' . claims.g`.
- **(R2)** Der Client speichert `{token, name, link}` in `localStorage['knorke.guest.' + boardId]` (Zugriffe in try/catch). Schlüssel ist die Board-ID, damit ein Gast nach dem Erneuern mit dem neuen Link dieselbe Identität behält (M1-Stimmen). Das alte Token wird beim Beitritt trotzdem als `guest` mitgeschickt.

#### 4.9.4 pid (opake Teilnehmer-ID)

```
pid = substr(hash_hmac('sha256', "knorke-pid|$boardId|$principalId", key('knorke-pid|')), 0, 16)
```

Die pid ist je Board und Person stabil. Sie dient als Präsenzschlüssel und Farbe, in M1 auch als Stimmschlüssel. **Abweichung zum Spike:** Es gibt kein `voteKey = 'u' . uid`, und Uids sind nie für Gäste sichtbar. Sichtbar ist nur der Anzeigename (offene Frage F3).

#### 4.9.5 `LinkThrottle` (nur Fehlversuche, Pulse-Muster)

```php
// Port of Pulse PublicVoteController::codeMissBlocked(). Called ONLY after a lookup found
// no link row at all (never-issued token). true = blocked (answer 429).
public function missBlocked(string $ip): bool;
// try { sleepDelayOrThrowOnMax($ip,'knorke_link'); registerAttempt('knorke_link',$ip);
//       sleepDelayOrThrowOnMax($ip,'knorke_link'); } catch (MaxDelayReached) { return true; } return false;
```

- **(R2)** Es gibt kein `isBlocked()` vor dem Lookup mehr. Treffer (aktiv oder zurückgezogen) fragen die Drossel nie; so sperrt weder ein Tippfehler noch ein erneuerter Link die Geräte hinter einer NAT aus existierenden Boards aus.
- Eine schon gesperrte Adresse bekommt ihr 429 ohne weiteren Versuch (sonst hielte ein dauernd pollendes Gerät die Sperre am Leben).
- NC 34 schläft nicht mehr, sondern wirft erst bei mehr als 10 Fehlversuchen in 30 Minuten (geprüft, 34.0.1): 10 × 404, der 11. ist 429.
- **(R3)** Anfragen vom Host (über `127.0.0.1:PORT` und über die Container-IP) sieht der Server im Dev-Stack als Gateway des Dev-Netzes (`env.json` `gatewayIp`, §8.1). Ein Container **im** Dev-Netz (der E2E-Browser) kommt mit seiner eigenen IP an.

#### 4.9.6 Wer darf was (M0)

| Rolle | Herkunft | Ops | Board umbenennen/löschen/Link | Präsenz |
|---|---|---|---|---|
| `owner` | `boards.owner` | alle | ja | ja |
| `edit` | Mitglied über Link, Gast über Link; **(R5)** nur, solange die Link-Richtlinie des Besitzers Links erlaubt (§4.9.7) | alle | nein (403) | ja |
| `view` | (M1: explizites Teilen) | keine (`denied`) | nein | nur lesen; `me` wird ignoriert |

**(R4)** `e`/`tk` (Text-Lease) tragen nur Rollen mit `canEdit()`. Für andere Rollen außer `view` (`vote`, M1) setzt der Server `e = null` und verwirft `tk`; Cursor und Auswahl bleiben erlaubt. Bei `view` bleibt `me` ganz ignoriert. Sonst könnte ein Principal ohne Schreibrecht die Lease halten und die Text-Patches der Bearbeiter mit `locked` sperren (in M0 latent, weil Links und Gast-Tokens nur `edit` kennen).

Ansehen-Modus auf Touch-Geräten ist **nur clientseitig** (§6.6): Die Rolle bleibt `edit`, die UI bietet nur keine Bearbeitung an.

#### 4.9.7 Link-Richtlinie von Nextcloud (R5)

**Entscheidung U11, vom Nutzer am 11.10.2026 bestätigt (F9).**

- **Regel:** Knorke befolgt `OCP\Share\IManager::shareApiAllowLinks($ownerIUser)` für den **Besitzer** des Boards, also das globale „Freigabe per Link erlauben“ (`shareapi_allow_links`) samt Gruppenausschluss (`shareapi_allow_links_exclude_groups`). Es entscheiden die Gruppen des Besitzers, nie die des Besuchers. Signatur in NC 34.0.1 und 35.0.1: `shareApiAllowLinks(?IUser $user = null): bool`. Knorke ruft sie nie mit `null` auf (das prüfte den Sitzungsnutzer statt des Besitzers).
- **`LinkPolicy::allows(string $ownerUid, ?IUser $known = null): bool`:** Der Share-Manager wird lazy über `Psr\Container\ContainerInterface` geholt (sein Aufbau kostete in einer CLI-Messung ≈ 1,6 ms). Ergebnisse gelten je Besitzer für die Anfrage. Gibt es das Besitzerkonto nicht mehr → keine Links.
- **Keine eigene Admin-Einstellung in M0.**
- **Solange Links verboten sind:**
  - Link anlegen/erneuern → 403 `links_disabled` (nach der Besitzerprüfung, §4.3)
  - Gast-Beitritt, Gast-Snapshot und Gast-Sync → 403 `links_disabled` (§4.9.2 Schritt 2a, §4.9.3 Schritt 4)
  - angemeldeter Link-Beitritt eines Nicht-Besitzers → 403 `links_disabled`
  - eine Mitgliedschaft mit `link_id` ≠ NULL gewährt nichts (404, als wäre der Link aus; §4.3, §5.2)
  - Link abschalten funktioniert weiter
- **Nichts wird zurückgezogen**, und `link_gen` bleibt. Erlaubt der Admin Links wieder, gelten der Link, seine Mitglieder und alte Gast-Tokens wieder.
- **Verzug:** Ein Richtlinienwechsel erreicht die Fastpaths über `a:<board>[3]` innerhalb der TTL von `a:`/`g:` (120 s, §5.1). Nextcloud selbst cached die App-Config 3 s (`AppConfig::LOCAL_CACHE_TTL`, APCu je Worker); `occ config:app:set` leert nur die Kopie der CLI. Beobachtet: Der erste Besitzer-Snapshot wenige Sekunden nach dem Abschalten zeigte noch `linksAllowed: true`, kurz danach `false`; ein Gast, der schon im Board war, stand 44 s nach dem Wechsel still.
- **Bekannte Grenze (M1):** Erzwungenes Link-Passwort und erzwungenes Ablaufdatum aus Nextclouds Freigabe-Richtlinie werden in M0 **nicht** befolgt (§1.2).

### 4.10 Server-Abläufe

#### 4.10.1 Schreibweg `SyncService::applyOps`

```
applyOps(Principal $p, int $board, string $client, array $ops, int $nowMs, ?array $presence = null): array{0:?int, 1:list<string>}
  1  if count($ops) > MAX_OPS → HttpError(400,'too_many_ops')
  2  $norm[i] = OpValidator::normalize($p, $ops[i])            // vor der Transaktion: Lock kurz halten
                                                               // (Format, Rolle, z, Lagegruppe, Werte)
  3  if alle $norm ∈ {bad, denied} → return [null, Codes]       // keine Transaktion, kein rev-Sprung
  4  try atomic(function () {
  5    $head = items->lockAndBumpRev($board, $nowMs) ?? 404     // ERSTE Anweisung: Zeilenlock + rev; (R4) liefert auch item_bytes
  6    $ids  = berührte IDs ∪ referenzierte parent-IDs (put p.parent, patch 'parent')
  7    $rows = items->loadItems($board, $ids)                   // inkl. Grabsteine, 1 Abfrage
  8    $start = Zustand je ID zu Beginn: none | live | gone
  9    für jede Op in Reihenfolge, Zustand je ID: none|live|gone|new|revived|removed
         (vor jeder Wirkung: authorize($p, $op, $row) – M0 immer erlaubt, Haken für M1/M2)
 10      put:    none    → Registry::checkItem + parent(…) → new (lebend+1 > MAX_ITEMS → 'limit';
                         (R4) $bytes + size > MAX_BOARD_BYTES → 'limit')
 11              live|new|revived → 'dup'
 12              gone|removed → revive ? (checkItem + parent(…) → revived) : 'gone'      // (R2) removed → revived
                         (R4) revive mit t ≠ gespeichertem Typ → 'bad'; Limits wie Zeile 10 (zählt +1 und +size)
 13      patch:  live|new|revived → Registry::checkPatch(type) → lease(…) → parent(…) → Pfade setzen
                 → fitsBytes und (R4) fitsShape (§4.7 Regel 3), sonst 'bad'
                 → (R4) size(neu) − size(alt) > 0 und $bytes danach > MAX_BOARD_BYTES → 'limit'
 14              sonst 'gone'
 15      remove: live|revived → removed ; new → none (nichts schreiben) ; sonst 'gone'
         (R4) $bytes läuft neben $live mit: put/revive +size, patch +(size(neu) − size(alt)), remove und new → none −size(cur);
              size(item) = strlen(obj(data)) + strlen(obj(style)), je Arbeitskopie einmal berechnet und wiederverwendet;
              'limit' lässt die Arbeitskopie unberührt
         parent(P): P nie existiert / Typregel / Zyklus → 'bad'
                    P Grabstein oder removed → parent=null, x+=P.x, y+=P.y, Ergebnis 'ok'   // (R2) §4.7 Regel 6
                    P lebt → setzen
         lease(op): op setzt textPath(type) und PresenceStore::leaseHolder($presence, id, now) ∉ {null, $p->pid}
                    → 'locked' (ganze Op)                                                    // (R2) §4.11
                    (R4) $presence !== null (Redis da) und der Batch enthält einen patch auf textPath(type):
                    direkt nach lockAndBumpRev, spätestens vor der ersten lease-Prüfung, EINMAL
                    $presence = presence->read($board, now) und gegen DIESE Map prüfen (ein GET je Text-Batch, im Lock)
 16    Freigabe: für jeden Container C mit ENDZUSTAND removed: Kinder = items->liveChildren($board,[C])
                 ∪ Arbeitskopien mit parent==C → parent=null, x+=C.x, y+=C.y (Container in M0 sind Wurzel)
       (R4, kein Vertrag) liveChildren lädt nur Lagespalten (id, type, parent_id, x, y, deleted, rev; data/style
                 fehlen → {}); Kinder, die eine Op desselben Batches berührt, behalten ihre volle Zeile aus loadItems.
                 Kinder, deren einzige wirksame Pfade die Lagegruppe sind, schreibt Schritt 17 gebündelt (mehrzeilige
                 Anweisungen in Blöcken, z. B. 500 Zeilen, Werte in PHP berechnet, Objekt- und Änderungszeile gleich);
                 Kinder mit weiteren Pfaden einzeln mit EINER zusammengeführten Zeile. Format §3.5 unverändert
                 ({x, y, parent:null}); nur freigegebene Kinder tragen 0 Byte zu $bytes bei
       (R5, so gebaut) ItemStore::releaseMany in Blöcken zu 500: je Block EIN UPDATE mit x = CASE id WHEN ? THEN ?
                 … ELSE x END (ebenso y; ELSE gibt PG den Spaltentyp), parent_id = NULL, version+1, rev, modified_*,
                 WHERE id IN (…), und EIN mehrzeiliges INSERT der Änderungszeilen; portabel (§3)
 17    Schreiben je Objekt GENAU EINMAL nach Endzustand (eine Änderungszeile je Objekt und rev, §3.5):
         new      → insertItem + change put(voll)
         revived  → reviveItem(alle Spalten, deleted=0) + change put(voll)      // auch live→removed→revived
         removed  (Start live) → updateItem(deleted=1) + change remove(null)
         live mit effektiven Pfaden (inkl. Freigabe) → updateItem(nur geänderte Spalten) + change patch(nur effektive Pfade)
 18    $delta = #(Ende lebend: new|revived|live) − #(Start lebend: live)  (nur über berührte IDs)
       $delta ≠ 0 → items->addItemCount($board, $delta)
       (R4) item_bytes daneben: Byte-Delta ($bytes Ende − Start) in DERSELBEN UPDATE-Anweisung wie item_count
            (z. B. addItemCount($board, $delta, $bytesDelta), aufgerufen, wenn eines der beiden ≠ 0); Invariante wie item_count:
            item_bytes = Σ über lebende Zeilen size(item)
       (R5) Das geschriebene Byte-Delta stammt aus den exakt GESPEICHERTEN Strings beim Schreiben, nicht aus den
            Arbeitskopien je Op. Sonst ließe ein No-op-Patch wie data.v=1 auf gespeichertem 1.0 item_bytes bei jeder
            Wiederholung schrumpfen, und ein Client könnte es unter 0 drücken und das Budget umgehen
 19    nichts geschrieben → throw new NothingWritten($res, $head['rev'] - 1)   // (R2) Rollback statt rev-Sprung
 20    return [$head['rev'], $res]
 21  }, $this->db)
     catch NothingWritten $n → return [$n->observedRev, $n->res]             // kein bumpRev
 22  nach COMMIT: cache->bumpRev($board, $rev)                  // nie vorher
```

Weitere Regeln:
- Die Spalten-Abbildung aus dem Spike wird übernommen: `NUM` = `x`, `y`, `w`, `h`, `r`→`rotation`, dazu `z` und `parent`→`parent_id`. Ein `data.*`/`style.*`-Pfad schreibt die ganze Spalte über `ItemStore::obj()`.
- `ItemStore::obj()` kodiert wie in §4.8 angegeben (ohne `JSON_HEX_TAG`; `{}` statt `[]`).
- Die Arbeitskopien-Logik (`getPath`/`setPath`/`setIn` mit Beschneiden leerer Eltern-Maps und den Wertregeln aus §4.7 Regel 3) liegt in `PathOps`. Sie wird von goldenen Fällen (`tests/fixtures/paths-golden.json`) gegen `src/model/paths.js` festgenagelt.
- `$presence` ist die Präsenz-Map, die `sync()` vor `applyOps` geschrieben oder gelesen hat (§4.10.2). `null` (Redis aus) heißt: keine Lease-Prüfung, reines LWW. **(R4)** Für die Lease-Prüfung zählt diese Map vor dem Lock nicht mehr: Enthält der Batch einen Text-Patch, liest der Schreibweg die Präsenz unter dem Lock neu (`lease(op)` oben). Der eigene Präsenz-Schreibvorgang der Anfrage (auch `tk`) liegt dann schon in Redis, eine Übernahme in derselben Anfrage zählt also weiter. Vorher konnte eine Übernahme samt Text von B, die zwischen As Präsenz-Schritt und As Lock committete, unbemerkt bleiben, und As späterer Text überschrieb Bs Text mit `ok` (gemessen bei 10–20 ms Versatz).
- `NothingWritten` ist eine app-eigene Ausnahme; `atomic()` rollt bei jeder Ausnahme zurück und wirft sie weiter.

#### 4.10.2 Leseweg `SyncService::sync`

```
sync(AccessResult $a, int $board, SyncRequest $r, int $nowMs): string
  0  $map = null                                                    // (R2) Präsenz VOR den Ops: Lease (auch tk) zählt schon
     if $r->me !== null && role ≠ view: [$st, $map] = presence->write($board, "$pid:$client", entry($p,$r->me), $nowMs)
                                        // (R4) !role->canEdit() (vote, M1): entry() setzt e = null und verwirft tk (§4.9.6)
  1  $acks = null
     if $r->ops:
        if $map === null && OpValidator::touchesTextPath($r->ops): $map = presence->read($board, $nowMs)
        [$A, $res] = applyOps(..., $map); $acks = {seq, rev:$A, res}
  2  $rev = $a->dbRev ?? cache->getRev($board)
     if $rev === null: $db = items->readRev($board) ?? 404; $rev = $db.rev; $minRev = $db.min_rev; cache->seedRev($board,$rev)
     else $minRev = $a->minRev
  3  if $A !== null: $rev = max($rev, $A)                         // Cursor deckt eigenen Schreibvorgang
  4  if $r->since > $rev:                                           // Sicherheitsnetz (b): Redis hinkt beweisbar
        $db = items->readRev($board)
        if $db.rev >= $r->since: cache->bumpRev($board,$db.rev); $rev = $db.rev
        else $resync = true                                         // Client „aus der Zukunft“ (DB-Restore, Reset)
  5  if $r->since < $minRev: $resync = true
  6  if !$resync && $rev > $r->since:
        [$rows,$upTo,$more] = items->itemsSince($board, $r->since, $rev, PAGE)
        Antwort: rev=$upTo, items = itemJson(lebende Zeilen), removed = IDs (deleted=1), more
     else Antwort: rev=$rev (+ "resync":true)
  7  if $r->pres:                                                   // (R3) bei pres=1 IMMER ausgeben
        if Präsenz verfügbar: $map ??= presence->read($board,$nowMs)
                              presence = PresenceStore::public($map, self, $nowMs)   // auch {}
        else                  presence = {}                         // (R3) kein Redis → {}
  8  JSON von Hand zusammensetzen (wie Spike), RawJsonResponse
```

- `OpValidator::touchesTextPath($ops)`: irgendein patch setzt einen Pfad aus `ItemRegistry::allTextPaths()` (M0: `data.text`, `data.title`). Kostet höchstens einen zusätzlichen GET je Batch, und nur wenn kein `me` mitkam.

`ItemStore::itemsSince($board, $since, $upTo, $limit)` = `SELECT id, type, parent_id, z, x, y, w, h, rotation, data, style, deleted, rev FROM *PREFIX*knorke_items WHERE board_id = ? AND rev > ? AND rev <= ? ORDER BY rev, id LIMIT <limit+1>`, dann:
- **(R4)** `data` und `style` nur für lebende Zeilen: `CASE WHEN deleted = 0 THEN data END` (ebenso `style`, portabel für PG, MySQL und SQLite). Grabsteine tragen keine Nutzlast, von ihnen wird nur die ID ausgeliefert.
- Gibt es höchstens `limit` Zeilen → (`rows`, `upTo`, `more = false`).
- Sonst: `last` = rev der Zeile Nummer `limit`. Behalten werden die Zeilen mit `rev < last`.
  - Ist das Behaltene nicht leer → (`kept`, max rev in `kept`, `true`).
  - **Ist es leer** (ein einziger rev hat mehr als `limit` Objekte): `WHERE board_id = ? AND rev = last ORDER BY id` **ohne** LIMIT nachladen → (alle Zeilen von `last`, `last`, `last < upTo`). Das behebt den latenten Spike-Fehler §2.8. **(R4) Korrektur:** Der Fall entsteht nicht erst in M2 (Vorlagen, Import), sondern **schon in M0** durch die Frame-Freigabe: Ein remove eines Frames schreibt bis zu `MAX_ITEMS_PER_BOARD − 1` Kinderzeilen in **einen** rev. Begrenzt ist die nachgeladene Seite durch `MAX_BOARD_BYTES` (§4.8); der Integrationstest erzeugt den Fall direkt über den Store und über einen Frame mit vielen Kindern (§9.2). **(R5)** Die erste Seite wird vor dem Nachladen verworfen. Der ganze rev wird weiter ohne LIMIT geladen; ein byte-begrenzter zusammengesetzter Cursor wäre eine Protokolländerung (M1/M2).
- **(R4)** Die Sync-Antwort setzt die Item-Seite wie der Snapshot inkrementell zusammen (§4.4): jedes `itemJson` beim Iterieren an einen String anhängen, ohne Zwischen-Arrays.

Ein Batch mit 50 Patches auf einem Objekt plus 3 neuen Objekten liefert dem nächsten Poller 4 Einträge statt 53 Log-Zeilen.

#### 4.10.3 Resync (Client)

`resync: true`:
- Den Snapshot neu holen (Angemeldete `GET …/snapshot`, Gäste `GET /pub/v1/…/snapshot`).
- `Replica.loadSnapshot` aufrufen; dabei bleiben die eigenen ausstehenden Ops erhalten, und bestätigte Ops mit `ackRev ≤ snapshot.rev` werden verworfen.
- Modell und Szene neu laden, Cursor = `snapshot.rev`.
- **(R4)** Objekte, die lokal gerade bearbeitet oder gezogen werden (`scene.isActive(id)`), bleiben im Modell, auch wenn der Snapshot sie nicht mehr enthält (fremd gelöscht): Die Session übernimmt ihren bisherigen Modellstand und setzt sie auf `deferred`. Ihr letzter Commit geht als patch hinaus, kommt `gone` zurück und landet bei einer Text-Op in der Textrettung (§6.5); vorher fiel das Objekt aus dem Modell, `setText` erzeugte keine Op, und der Text verschwand still.

Auslöser in M0:
- `since > DB-rev` (Client „aus der Zukunft“ nach DB-Restore)
- `since < min_rev`; `min_rev` setzt in M0 nur ein Test (Brücken-Aktion `set-min-rev`: `rev = rev + 1, min_rev = rev + 1` in **einer** Anweisung, **(R5)** portabel als `SET min_rev = rev + 1, rev = rev + 1`, §8.2), in M1 die Grabstein-Bereinigung
- eine Antwort mit `rev < since` ohne `resync` wird zur Abwehr ebenfalls als Resync behandelt

**(R2) Resync-Bremse:** Der dritte Resync binnen 10 s wartet vorher 2 s, jeder weitere doppelt so lang (bis 30 s). Ein dauerhafter Zustand (Redis vor der DB, ein Fehler) hämmert sonst Snapshots von bis zu ≈ 3 MB in Schleife.

#### 4.10.4 Verwaltung (BoardService)

| Aktion | Transaktion (erste Anweisung sperrt die Board-Zeile) | Nach COMMIT |
|---|---|---|
| Link anlegen | **(R5)** vorher: Besitzerprüfung, dann `LinkPolicy` → 403 `links_disabled`. `INSERT links` (kein Gen-Sprung) | `cache->setGens` nicht nötig |
| Link erneuern | **(R5)** Vorprüfung wie Link anlegen. `UPDATE boards SET acl_gen=acl_gen+1, link_gen=link_gen+1, updated_at=?` → `DELETE members WHERE link_id IN (alt)` → **(R2)** `UPDATE links SET revoked_at=? WHERE board_id=? AND revoked_at IS NULL` → `INSERT links` (neu) | `cache->setGens(board, acl, link, minRev, links)` (sofort wirksam; **(R5)** 5. Argument = Richtlinien-Merker, §5.1) |
| Link aus | wie erneuern, ohne INSERT | wie erneuern |
| Board löschen | `UPDATE boards SET acl_gen=acl_gen+1` (Lock) → DELETE changes, items, members, boards; **(R2)** Links nur zurückziehen (`revoked_at`), nicht löschen | `cache->markGone(board)` |
| Nutzer gelöscht | je eigenes Board: Board löschen; je Mitgliedschaft: DELETE + `acl_gen+1` | `setGens` je Board (**(R5)** mit dem Richtlinien-Merker des Besitzers) |
| Link-Beitritt (angemeldet) | **(R4)** Vorprüfungen und Drossel wie bisher (nie ausgestellt → `missBlocked`, zurückgezogen → 403). **(R5)** Danach Nicht-Besitzer und `LinkPolicy` verbietet Links → 403 `links_disabled`. Dann `atomic()`: **erste Anweisung** `lockBoard($board, false, false, $now)` (Lock ohne Gen-Sprung; Board weg → 404) → Link **unter dem Lock** per Token neu lesen: `revoked_at` gesetzt oder anderes Board → 403 `link_revoked` → Besitzer → Board zurück → **(R5) so gebaut:** gültiges Mitglied (`findBoardForUser` liefert `member_role`) → Board zurück ohne Schreiben (Neu-Beitritt bei jedem Seitenaufruf); sonst `deleteMember` + `addMember` (`INSERT … ON CONFLICT DO NOTHING` über `insertIgnoreConflict`, in der Transaktion zulässig, keine Unique-Verletzung). Das Löschen ersetzt eine Zeile auf einem zurückgezogenen Link, die nichts mehr gewährt. Vorher (ohne Lock) konnte ein Beitritt, dessen SELECT vor und dessen INSERT nach dem `DELETE members` eines Erneuerns lief, eine Mitgliedschaft auf einem zurückgezogenen Link hinterlassen, die kein späteres Erneuern mehr löscht (dauerhafter, unsichtbarer Zugriff, verletzt F1) | nichts (Hinzufügen widerruft nichts) |
| `CleanupJob` (täglich) | `DELETE changes WHERE ts < now−30 d`; **(R2)** `DELETE links WHERE revoked_at < now−30 d` | – |

Widerruf wirkt, sobald `setGens` Redis erreicht hat. Scheitert dieser Redis-Schreibvorgang, wirkt der Widerruf spätestens nach 120 s (TTL von `a:`). **(R5)** Jedes `setGens` trägt den Richtlinien-Merker als 5. Argument: `setGens(board, acl, link, minRev, links)`. Ein Richtlinienwechsel des Admins löst selbst kein `setGens` aus; er wirkt über den Ablauf von `a:` (§4.9.7).

**(R4)** Erneuern löscht weiter nur die Mitglieder der dann aktiven Links (`DELETE members WHERE link_id IN (alt)`), nicht alle link-abgeleiteten Mitglieder; das bräche M1-Boards mit mehreren Links. Rückhalt gegen schon kaputte Zeilen ist die volle Prüfung (§5.2): Eine Mitgliedschaft auf einem zurückgezogenen Link zählt nicht.

### 4.11 Text-Lease (R2)

Entschieden ist „Text-Lease + letzter gewinnt“ (Dossier §6). Ein Chip, der nichts sperrt, verliert aber Text: Öffnet B eine Notiz, während A tippt (A committet 1× je Sekunde), überschreibt Bs letzter `data.text`-Patch alles, was A nach Bs Öffnen getippt hat. Deshalb wirkt die Lease jetzt.

**Datenmodell (nur Präsenz, keine DB):**
- Die Lease steckt im Präsenz-Eintrag: `e` = Objekt-ID, die der Eintrag gerade bearbeitet.
- Neu im gespeicherten Eintrag: `es` (ms, vom Server gesetzt) = Lease-Rang. Wechselt `e` eines Eintrags auf eine neue ID, setzt der Server `es = now`; bleibt `e` gleich, bleibt `es`.
- **Übernahme:** `me.tk = 1` zusammen mit `e` setzt `es = min(es aller anderen frischen Einträge mit demselben e) − 1`.
- **Halter** einer ID = frischer Eintrag (`t` jünger als `LEASE_FRESH_MS`) mit `e == id` und dem **kleinsten** `es` (Gleichstand: kleinerer Schlüssel). Wer zuerst öffnet, hält; wer übernimmt, wird Halter; wer nach einem Verfall (Tab versteckt, > 10 s ohne Präsenz) zurückkommt, steht hinten an.
- `PresenceStore::leaseHolder(array $map, string $itemId, int $nowMs): ?string` → pid des Halters oder `null`.
- `PresenceStore::public()` gibt je Eintrag `h = 1` aus, wenn er Halter seines `e` ist; `es` und `t` bleiben intern.

**Server:** §4.7 Regel 11 und §4.10.1 (`lease(op)`). Der gleiche Principal (gleiche pid, auch in einem zweiten Tab) ist nie gesperrt. Ohne Redis gibt es keine Lease (reines LWW, wie ohne Präsenz). **(R4)** Geprüft wird gegen die Präsenz, die der Schreibweg **unter dem Board-Lock** neu liest (nur bei Batches mit Text-Patch); die vor dem Lock geschriebene Map dient nur dem eigenen Präsenz-Schreibvorgang der Anfrage. So sieht jeder Text-Batch alle Lease-Wechsel, die vor ihm committet sind. Lease halten nur Rollen mit `canEdit()` (§4.9.6).

**Client:**
- **Öffnen:** Doppelklick auf ein Objekt, für das ein fremder `RemoteSample` mit `editing == id` und `editingHolder == true` existiert → kein Editor, sondern der Chip „X bearbeitet …“ mit der Aktion „Übernehmen“ (§6.3). „Übernehmen“ öffnet den Editor und meldet `onEditing(id, true)`; die Session schickt dann einmal `me.tk = 1`.
- **Lease verloren:** Sieht die Session für die eigene Editier-ID einen fremden Halter (`h = 1`) **oder** kommt `locked` zurück, bleibt der Editor offen, der Text bleibt drin, Zwischen-Commits hören auf, und der Editor zeigt „Nicht gespeichert: X bearbeitet dieses Objekt. Text vor dem Schließen kopieren.“ Schließen verwirft dann ohne Commit (der Nutzer wurde gewarnt).
- **(R3) Lease bis zur Bestätigung halten (Client-Pflicht):** Der Server schreibt die Präsenz **vor** den Ops (§4.10.2 Schritt 0). Schickte ein Client beim Schließen `e = null` im selben Takt wie seinen letzten Text, ginge die Lease zuerst an einen Wartenden, und der eigene letzte Text käme `locked` zurück (gefunden in E04b). Deshalb meldet die Session nach dem Schließen weiter `e` = ID dieses Editors, bis dessen letzte Text-Op bestätigt oder verworfen ist; erst danach `e = null`.
- Tablets im Ansehen-Modus schicken kein `me` und halten nie eine Lease.

---

## 5. Redis

### 5.1 Schlüssel

`FastCache` und `PresenceStore` holen sich je `ICacheFactory::createDistributed('knorke/')`. Damit sehen die echten Schlüssel so aus: `<globalPrefix>/knorke/<key>`. Der Fastpath ist nur an, wenn das Objekt `instanceof IMemcacheTTL` ist und `$factory->isAvailable()` stimmt. Sonst laufen alle Pfade über die DB, und Präsenz ist aus (`presence` = `{}` bei `pres = 1`, **(R3)** §4.5).

Es gibt keine rohen Redis-Befehle, keine Hashes, kein MGET und kein eigenes Lua; damit bleibt die App App-Store-tauglich.

| Schlüssel | Wert | Geschrieben von | TTL | Hinweis |
|---|---|---|---|---|
| `r:<board>` | int rev | `seedRev`: `add(…, 30)`; `bumpRev`: get/add/cas-Schleife (6 Versuche), nach erfolgreichem `cas` `setTTL(key, 30)`; scheitert sie → `remove` | **30 s, bei jedem Hochziehen erneuert** | Sicherheitsnetz (a): Ein ruhiges Board liest höchstens alle 30 s einmal `SELECT rev` und sät neu. Das heilt auch verlorenes Hochziehen, einen Redis-Wert vor der DB und das Präfix-Leck |
| `a:<board>` | **(R5)** `[aclGen, linkGen, minRev, links]` (int-Array; `links` = 1, wenn Nextcloud dem Besitzer Links erlaubt, sonst 0, §4.9.7); gelöscht = `[-1,-1,-1]` (unverändert). **(R5)** Jede andere Form, auch der alte 3-Element-Wert, ist ein Fehltreffer; alte Werte verfallen ≤ 120 s nach dem Einspielen | `seedGens`: `add(…, 120)` nach DB-Lesen; `setGens`: `set(…, 120)` nach Widerruf; beide **(R5)** mit `links`; `markGone`: `set([-1,-1,-1], 300)` | 120 s (gelöscht 300 s) | Verwaltung schreibt mit `set`, Leser säen mit `add`. So überschreibt ein verspäteter Säer nie einen frischen Widerruf |
| `g:<board>:<uh>` | `"<aclGen>\|<role>"` | `setGrant`: `set(…, 120)` nach voller Prüfung | 120 s | `uh = substr(sha256(uid), 0, 24)`. Gültig nur, wenn `aclGen == a:<board>[0]` |
| `p:<board>` | JSON-String-Blob `{"<pid>:<client>": entry, …}` | `PresenceStore::write`: get/modify/`cas` (6 Versuche) bzw. `add(…, 60)` | **(R2) 60 s, nach jedem erfolgreichen `cas` per `setTTL(key, 60)` erneuert** (kein `_ttl`-Marker mehr) | `cas` löscht die TTL (Lua `SET`). Nur alle 30 s zu erneuern hinterließ nach dem letzten `cas` einen Blob ohne TTL, also ein Leck je Board und Präfixwechsel (§11.2 Nr. 5). Einträge älter als 10 s fliegen bei jedem Schreiben und Lesen raus |

Werte in FastCache: rev ist ein int, Generationen sind ein int-Array, Grant und Präsenz sind JSON-Strings (in Anführungszeichen gespeichert, also sicher). **(R2) Die eigentliche Falle in NCs `decodeValue` sind Gleitkommazahlen** (`is_numeric` → `(int)` schneidet ab): FastCache speichert nie einen float, auch nicht in Arrays.

### 5.2 Fastpath, Schritt für Schritt (leerer Sync eines Angemeldeten)

1. Die uid kommt aus der Session; der NC-Kern hat den Nutzer schon geladen, das kostet kein App-SQL.
2. `GET a:<board>`. Ist es `[-1,…]` → 404.
3. `GET g:<board>:<uh>`. Passt `aclGen` → Principal (Rolle aus dem Grant, Anzeigename aus `IUser::getDisplayName()`, pid berechnet).
4. Keine Ops → kein Schreibweg.
5. `GET r:<board>` → `rev`. Ist `rev == since`, gibt es keine Item-Abfrage.
6. Präsenz: `GET p:<board>`, Eintrag einsetzen, `cas`, `setTTL`. Die geschriebene Map wird fürs Lesen wiederverwendet (spart einen GET).
7. Antwort `{"rev":…,"presence":{…}}`, gzip durch die Middleware.

Das macht 4 GETs, 1 EVAL und 1 EXPIRE, **null App-SQL**. Der NC-Kern macht weiter ≈ 6,4 PG-Transaktionen je Anfrage (Korrektur 1); der Fastpath bleibt trotzdem, weil er billig und korrekt ist. Der echte Hebel ist `dbpersistent`, eine prod-weite Entscheidung außerhalb von M0.

Für Gäste entfällt Schritt 3. Stattdessen läuft `Access::forGuest` in der Reihenfolge aus §4.9.3: HMAC prüfen (nur CPU), **`claims.b === board`**, `claims.r` erlaubt, dann `claims.lg == a:<board>[1]` (bei Ungleichheit → 403 `link_revoked`), **(R5)** dann `a:<board>[3] = 0` → 403 `links_disabled`, ohne SQL.

**(R5) Link-Richtlinie auf dem Fastpath angemeldeter Nutzer:** Ein Grant eines Nicht-Besitzers zählt nur, solange `a:<board>[3] = 1`; sonst läuft die volle Prüfung. Der Grant des Besitzers ist davon unberührt. Die volle Prüfung ruft `LinkPolicy::allows(<Besitzer>)` erst, nachdem eine Rolle gefunden ist (`Access::forUserWithRow`), Fremde kosten also keine Richtlinienabfrage. Kosten: ein `oc_users`-Lookup des Besitzers je Nicht-Besitzer-Principal, keiner für den Besitzer; der Share-Manager wird lazy geholt.

**Fehltreffer:** Fehlt `a:` oder der Grant oder passt die Generation nicht, läuft die volle Prüfung:
- `BoardStore::findBoardForUser($board, $uid)`: Board-Zeile mit `LEFT JOIN members` in einer Abfrage. Kein Board oder weder Besitzer noch Mitglied → 404.
  - **(R4)** Dazu `LEFT JOIN knorke_links l ON l.id = m.link_id`: Eine Mitgliedschaft zählt nur, wenn `m.link_id IS NULL` (explizit geteilt, M1) **oder** ihr Link existiert und aktiv ist (`l.id IS NOT NULL AND l.revoked_at IS NULL`). Sonst sind `member_role` und `member_link` `null`. `listForUser` wendet dieselbe Regel an und lässt das Board weg, außer der Nutzer ist Besitzer. Das neutralisiert auch schon vorhandene kaputte Zeilen (§4.10.4). Der JOIN läuft nur bei Fehltreffern, der Fastpath (E06) bleibt unverändert.
- Danach `seedGens` und `setGrant`. `AccessResult.dbRev` = Board-`rev`, damit `sync` keinen weiteren rev-Lookup braucht.

### 5.3 Sicherheitsnetz für `r:<board>` (Korrektur 2)

- **(a) TTL 30 s:** `seedRev` setzt sie über `add`, `bumpRev` erneuert sie nach jedem **(R5)** erfolgreichen (anhebenden) `cas`. Geht ein Hochziehen nach dem Commit verloren (PHP-Fatal, Redis-Aussetzer), hat ein aktives Board es mit dem nächsten Schreibvorgang überholt (monotones Maximum). Ein ruhiges Board liest spätestens nach 30 s die DB.
- **(b) `since > cachedRev`:** Clients kennen nur committete revs. Redis hinkt also beweisbar → DB lesen und `bumpRev`.
- **(c) Redis vor der DB** (DB-Restore): **(R2) Die frühere Aussage „höchstens 30 s“ war falsch.** Die DB kann den alten Cursor der Clients überholen, solange `r:` noch zu hoch steht; dann löst `since ≤ DB-rev` keinen Resync aus, und Clients verpassen revs still. **(R4) Korrektur der R2-Begründung:** Nicht „jedes `bumpRev` hält den zu hohen Wert am Leben“. Die TTL wird nur erneuert, wenn der Wert **angehoben** wird (`cas` → `setTTL`); ein `bumpRev` unterhalb des zu hohen Werts ändert nichts. Ein zu hohes `r:` verfällt also ≤ 30 s nach seinem letzten Anheben, es sei denn, ein Schlüssel hat seine TTL verloren (Prozess stirbt zwischen `cas` und `setTTL`). Warten ist deshalb kein verlässlicher Ersatz, und in dem Fenster kann die DB den Cursor schon überholt haben.
  - **Runbook (R4)** (in `docs/ENTWICKLUNG.md` und `docs/PROTOKOLL.md`): `occ maintenance:mode --on` → DB zurückspielen → alle Redis-Schlüssel `*/knorke/*` **über alle Präfixe** löschen (`redis-cli --scan --pattern '*/knorke/*'` an `UNLINK`/`DEL`, mit Auth) → `occ maintenance:mode --off` → alle Clients neu laden. **Neu laden allein hilft nicht**, solange `r:` zu hoch steht: Der erste Poll eines neu geladenen Clients springt mit seinem Cursor über revs, die noch nicht in der DB stehen.
  - **Gestrichen (R4):** „oder die App aus- und wieder einschalten, das verschiebt das Präfix“. Nach dem Wiedereinschalten ist das Präfix dasselbe (siehe d), und `r:`, `a:`, `g:`, `p:` überleben.
  - Eine Board-Epoche, die ein Reparatur-occ-Befehl dreht, folgt in M1 (§1.2); sie ist die eigentliche Lösung.
- **(d) Präfixwechsel:** **(R4) präzisiert:** Das Präfix ist ein Hash über `instanceid`, die Core-Version und die aktivierten Apps samt Versionen; im Wartungsmodus tritt `core:maintenance` an die Stelle der App-Liste (`Factory::getGlobalPrefix`, NC 34). Es ist also eine Funktion des Zustands: **Dauerhaft** verschiebt es sich nur bei einem Versionswechsel (App oder Core) oder einer dauerhaft geänderten App-Menge. Deaktivieren einer App und der Wartungsmodus verschieben es nur, **solange** sie andauern; danach gilt wieder das alte Präfix samt alter Schlüssel. Ein fehlender Schlüssel heißt immer „DB fragen“; alte Schlüssel verfallen über ihre TTL.
- **Kein `tx:`-Marker wie bei Pulse nötig:** Redis wird erst nach dem Commit monoton angehoben, und Clients lesen nie über den rev hinaus. Ein veralteter Wert verzögert also nur, er kann nichts verbergen.

### 5.4 Ausfall-Verhalten

| Lage | Wirkung |
|---|---|
| Redis weg/leer | Alle Anfragen gehen über SQL (Board-Zeile, rev), Präsenz leer (**(R3)** `presence: {}` bei `pres = 1`), keine Text-Lease. Korrekt, nur teurer |
| Grant abgelaufen | Eine volle Prüfung, dann wieder Fastpath |
| `bumpRev` verloren | Spätestens nach 30 s sichtbar (a), sofort bei aktivem Board |
| Widerruf-`setGens` verloren | Widerruf wirkt spätestens nach 120 s |
| **(R5)** Admin ändert die Link-Richtlinie | wirkt auf den Fastpaths ≤ 120 s (+ 3 s App-Config-Cache von Nextcloud), auf vollen Prüfungen nach ≤ 3 s (§4.9.7) |
| **(R5)** Lesereplikat hinkt | ohne Wirkung: Knorke liest vom Primärserver (§3.7) |
| `PresenceStore` `lost` (6 cas-Kollisionen) | Dieser Takt ohne eigenes Präsenz-Update; der nächste Takt holt es nach |

### 5.5 Präsenz-Eintrag

```php
// PresenceStore::entry(Principal $p, array $me, int $nowMs): array
['n' => $p->displayName, 'k' => $p->pid, 'g' => $p->isGuest ? 1 : 0,
 'x' => ?float (round 1), 'y' => ?float, 's' => list<ulid> (≤20),
 'd' => list<[ulid, float, float]> (≤20), 'e' => ?ulid, 'tk' => 0|1 (nur Eingabe),
 't' => $nowMs]
// write() ergänzt 'es' (Lease-Rang, §4.11) aus dem alten Eintrag bzw. now bzw. Übernahme; 'tk' wird nicht gespeichert.
// (R4) !$p->role->canEdit(): 'e' => null, kein 'tk' (Cursor und Auswahl bleiben); view kommt gar nicht hierher (§4.9.6)
```

- Schlüssel ist `"<pid>:<client>"`. Die pid kommt vom Server, deshalb kann niemand fremde Cursor überschreiben (behebt Spike-Mangel §4.9).
- Drossel: höchstens ein Schreiben je Schlüssel alle 250 ms (`skip`). **(R2)** Ausnahme: Ein Schreiben, das `e` ändert oder `tk` trägt, wird nie gedrosselt.
- **(R2)** Höchstens `PRESENCE_PER_PID` = 3 Einträge je pid (der älteste derselben pid fliegt), höchstens 200 je Blob (die ältesten fliegen). Sonst verdrängt ein Principal mit zufälligen Client-IDs alle anderen.
- Veraltet nach 10 s.
- **(R2)** `public($map, $selfKey, $nowMs)` liefert immer ein Objekt (leer = `{}`), ohne `t`/`es`, mit `h`.
- Ab ≈ 60 Editoren ist der Blob neu zu bewerten; das gehört zum Lastlauf in M1.

---

## 6. Frontend-Module

### 6.1 Überblick und Datenfluss

```
             ┌──────────────── Vue-Shell [C] (App.vue / PublicApp.vue / BoardView.vue) ────────────────┐
             │  Toolbar, ContextBar, ZoomControls, PresenceBar, ShareDialog, Banner (nur Zustände ≤10 Hz) │
             └───────────────▲──────────────────────────────────────────────┬───────────────────────────┘
                     ui-Callbacks│                                      Befehle│ (setTool, undo, zoom, setFill …)
             ┌───────────────┴──────────────── BoardSession [C] (markRaw) ─────▼───────────────────────────┐
             │ actions.js → ops+inverse → undo.js                                                         │
             │        │enqueue                         flushVisible(ids) (außer scene.isActive(id))       │
             │   SyncClient [C] ──transport/http──► /sync     Replica [C]: confirmed ⊕ pending → visible  │
             │        │ onChanges/onAcks/onPresence             │ upserts/removes                         │
             │        ▼                                         ▼                                         │
             │   presence.js (Interpolation) ─sampler─►  SceneModel [S] ──ChangeSummary──► SceneManager [S]│
             │                                         (items, abs, rbush, Ordnung)   (Konva, Input, Overlays)│
             │                                                  ▲ moveLocal (nur während Ziehen)  │ Intents │
             └──────────────────────────────────────────────────┴───────────────────────────────────┘─────┘
```

**Invariante:** `SceneModel` = `Replica.visible` für alle IDs außer den lokal aktiven (gezogen oder in Bearbeitung). Das Modell und die Konva-Objekte liegen **außerhalb** der Vue-Reaktivität: `BoardSession` wird mit `markRaw` erzeugt und in einer `shallowRef` gehalten, nie in `data()`.

Gemeinsamer Datentyp **WireItem** (Client-Modell = Drahtformat, keine Umbenennung):

```js
/** @typedef {{id:string, t:string, x:number, y:number, w:number, h:number, r:number, z:string,
 *             parent:(string|null), data:Object, style:Object}} WireItem */
```

**Abweichung zum Engine-Spike:** `type`/`parent_id`/`rotation` heißen dort anders; beim Portieren werden sie umbenannt. Unbekannte Felder bleiben erhalten (`structuredClone` beim Laden).

### 6.2 `src/model/` [S] (frameworkfrei, ohne Konva, in Node testbar)

**`ids.js`**

```js
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
export function ulid(now = Date.now()) {}          // 10 Zeitzeichen + 16 Zufallszeichen (crypto.getRandomValues), Crockford
export function clientId() {}                      // 'c' + 9 aus [A-Za-z0-9] (crypto)
```

**`paths.js`**, Spiegel von `PathOps.php`, festgenagelt durch `tests/fixtures/paths-golden.json`:

```js
export const TOP_FIELDS = ['t','x','y','w','h','r','z','parent','data','style']
export const PLACEMENT = ['x','y','parent']        // (R2) Lagegruppe, §4.7 Regel 2a
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/
export function getPath(item, path) {}             // → Wert oder null
export function setPath(item, path, value) {}      // mutiert; null/{}/[] löscht; leere Eltern-Maps werden beschnitten;
                                                   // Objekt-Werte gesäubert (leere/null-Einträge entfernt, rekursiv)
export function applyPatch(item, patch) {}         // Pfade in Objekt-Reihenfolge
export function isWireValue(v, depth = 0) {}       // (R2) Wertregeln §4.7 Regel 3: Tiefe ≤ 6, Liste ≤ 1000 ohne null/{}/[],
                                                   // Objekt ≤ 100 Schlüssel mit KEY_RE; true/false
export function diffPatch(before, after) {}        // (R2) → patch-Objekt (Pfade auf Tiefe 1 unter data/style, ganze Werte),
                                                   // das before in after überführt; x/y/parent immer als Gruppe; {} wenn gleich
export function canon(v) {}                         // sortierte Schlüssel, ohne null und ohne leere Objekte/Listen (R2)
export function itemKey(item) {}                    // kanonischer JSON-String inkl. id für Vergleiche (Tests, Debug, E2E)
export function itemFromPut(op) {}                  // put-Op → WireItem (Vorgaben wie Server §4.6)
```

**`zorder.js`**

```js
export const Z_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
export const Z_RE = /^[0-9a-z]{1,64}$/
export function isValidKey(k) {}                    // (R2) Z_RE + validateOrderKey-Regeln (§4.8), gleiche Golden wie PHP
export function cmpBytes(a, b) {}                   // -1/0/1, reiner Code-Unit-Vergleich
export function keyBetween(a, b) {}                 // generateKeyBetween(a, b, Z_DIGITS); wirft nie für schlechte Eingaben (R2):
                                                    //   ungültige Grenze → wie null; a ≥ b (gleiche Schlüssel zweier Clients)
                                                    //   → keyBetween(a, null).
                                                    //   (R4) wirft für KEINE Eingabe: Ergebnis > 64 Zeichen → nächste gültige
                                                    //   Grenze selbst (aufwärts oder dazwischen → a; abwärts mit a = null → b)
export function keysBetween(a, b, n) {}             // generateNKeysBetween(…), gleiche Rückfälle; (R4) wirft nie, liefert n
                                                    //   gültige, nicht fallende Schlüssel (ab einer geklemmten Grenze dieselbe)
```

**(R4) Erschöpfte Enden** (ersetzt „Ergebnis > 64 Zeichen → Error, in M0 nicht erreichbar“): Ein Bearbeitungslink-Inhaber kann gültige Extremschlüssel speichern (§4.8). Gemessen mit fractional-indexing 4.0: Genau `'z'` × 64 hat keinen Nachfolger (`'z'` × 63 + `'y'` → `'z'` × 64 geht), genau `'0'` × 63 + `'1'` keinen Vorgänger, und zwischen zwei benachbarten 64-Zeichen-Schlüsseln gibt es keinen (`keyBetween('z'×63+'y', 'z'×64)` ergäbe 65 Zeichen); Ketten aus `keysBetween(a, null, n)` laufen an dieselbe Wand. Vorher warfen `keyBetween`/`keysBetween`, und Anlegen sowie „nach vorn/nach hinten“ scheiterten still für jeden Client dieser Ebene. Jetzt:
- Ist das Bibliotheksergebnis länger als 64 Zeichen, wird die nächste gültige Grenze zurückgegeben (ein vorhandener, vom Server angenommener Schlüssel). Gleichstände ordnet `cmpOrder` über die `id` (Vergleich `(rank, z, id)`, unten).
- `keysBetween` rekursiert nie auf einem geklemmten Schlüssel, der einer Grenze gleicht, sondern liefert ihn für die restlichen Positionen (sonst fiele `keyBetween(a, a)` auf `keyBetween(a, null)` zurück und spränge über `b`).
- `isValidKey`, `ZOrder::isValid` und `zorder-golden.json` bleiben unverändert; der Fix für den kleinsten Ganzzahl-Schlüssel (R3, unten) bleibt.

- Reihenfolge ist **ein globaler Schlüsselraum** mit Ebenenrang. Frames (`layer: 'back'`) liegen immer hinter allem, dann folgt der Inhalt.
- Vergleich: `(rank, z, id)` mit `cmpBytes`. Die **id als Tie-Breaker** fängt identische Schlüssel ab, die zwei Clients gleichzeitig erzeugen (Spike-Mangel §8.8).
- **Abweichung zum Dossier** („je Parent“): Ein Schlüsselraum je Parent ergibt keine Gesamtordnung über Eltern hinweg.

**`registry.js`** (Client-Gegenstück zur PHP-Registry, ohne Konva):

```js
export const TYPES = {
  sticky: { layer: 'content', container: false, childOf: ['frame'], rotatable: true,
            defaults: { w: 200, h: 200, data: { text: '' }, style: { fill: DEFAULT_STICKY_FILL } },
            textPath: 'data.text', hit: 'box' },
  frame:  { layer: 'back', container: true, childOf: [], rotatable: false,
            defaults: { w: 800, h: 600, data: { title: '' }, style: { fill: '#ffffff' } },
            textPath: 'data.title', hit: 'frameEdge' },
}
export const PLACEHOLDER = { layer: 'content', container: false, childOf: [], rotatable: true, hit: 'box', textPath: null }
export function typeInfo(t) {}                     // TYPES[t] ?? PLACEHOLDER
export function layerRank(t) {}                    // back 0, content 1
export function canBeChildOf(childT, parentT) {}
export function textPathOf(t) {}                   // (R2) → 'data.text' | 'data.title' | null
```

**Treffer bei Frames (`frameEdge`):**
- Titelband (Höhe `FRAME_TITLE_SIZE * 1.5` über der Box) und Randband (8 px / scale) treffen den Frame.
- Das Innere gilt als leere Fläche (Rahmenauswahl oder Schwenken).

Damit ist die UX-Frage aus dem Engine-Digest §2.5 für M0 entschieden.

**`geometry.js`**, Port von `engine/src/geometry.js` ohne `bezierPath`: `routeConnector`, `pointsBBox`, `rotatedBBox`, `toLocal`, `pointInPolygon`, `distToSegment`, `distToPolyline`, `sampleBezier`, `shapePolygon`. Signaturen wie im Spike.

**`text.js`:** `autoFontSize(text, w, h, pad = STICKY_PADDING)` als Port. Die Schriftgröße wird **berechnet, nicht gespeichert** (Nachrüst-Regel); `style.fontSize` ist nur ein manueller Override (keine UI in M0).

**`tokens.js`**, Port von `style.js`:
- Konstanten: `STICKY_COLORS` (14 Farben), `DEFAULT_STICKY_FILL = '#a8d8f8'` (**kein Gelb als Vorgabe**, Markenhinweis §5 des Dossiers), `FRAME_*`, `SHADOW`, `FONT_FAMILY`, `LINE_HEIGHT`, `STICKY_PADDING`, `STICKY_RADIUS`, `FONT_STEPS`
- `LOD_TEXT_SCALE = 0.3`, `LOD_COARSE_SCALE = 0.1` (M1)
- `MIN_SCALE = 0.05`, `MAX_SCALE = 4`
- `BOARD_BACKGROUND`

**`SceneModel.js`**, Port des Kerns von `engine/src/model.js`, erweitert:

```js
/** @typedef {{added:string[], removed:string[], updated:Map<string,Set<'geom'|'z'|'parent'|'text'|'style'|'data'|'type'>>,
 *             geometry:Set<string>, reordered:boolean}} ChangeSummary
 *  geometry = alle IDs, deren absolute Box sich änderte (inkl. Nachfahren eines bewegten Containers). */
export class SceneModel {
  constructor()
  load(items /* WireItem[] */)                       // Massenladen: abs, Kinder-Index, rbush per tree.load
  apply({ upserts = [], removes = [] })              // → ChangeSummary; volle Objekte, generisch
  moveLocal(ids, dx, dy)                             // → Set<string> geometry; nur während Ziehen, ohne Ops
  get(id) {}  has(id) {}  get size() {}
  abs(id) {}                                         // → {x, y, w, h, r} absolut (Eltern-Versatz aufgelöst)
  query(minX, minY, maxX, maxY) {}                   // → rbush-Einträge {minX,minY,maxX,maxY,id,t}
  hitTest(wx, wy, tolWorld = 0, { edgeWorld } = {}) {} // → id | null (oberstes, präzise je Registry-hit);
                                                     // (R3) edgeWorld = Frame-Randband in Welteinheiten (Vorgabe
                                                     // FRAME_EDGE_HIT_PX); die Szene übergibt 8 / scale
  queryRect(rect, mode = 'intersect') {}             // → id[] für Rahmenauswahl ('contain' | 'intersect')
  topContainerAt(wx, wy, excludeIds = new Set()) {}  // → id | null (oberster Container, der den Punkt enthält)
  childrenOf(id) {}  descendantsOf(id) {}            // → id[]
  compareOrder(a, b) {}                              // (rank, z, id)
  sortByOrder(ids) {}                                // → neues Array
  maxZ(layer) {}  minZ(layer) {}                     // → string | null; (R2) überspringt Schlüssel, die isValidKey nicht besteht
  boundsOf(ids) {}  allBounds() {}                   // → {x,y,w,h} | null
}
```

Pflichtänderungen gegenüber dem Spike (Engine-Digest §2.3, §2.7, §8):
- **Generisches `parent`:** Die absolute Box wird rekursiv aufgelöst, höchstens 8 Ebenen, ohne Abhängigkeit von der Ladereihenfolge.
  - Ein Kinder-Index `Map<parentId, Set<childId>>` gilt auch für **noch unbekannte** Eltern.
  - Ein Objekt mit unbekanntem Elternteil oder einem, der kein Container ist, liegt vorläufig an der Wurzel (Versatz 0).
  - Trifft der Elternteil ein, werden die Kinder neu berechnet und neu indiziert.
- **Kaskade:** Bewegt sich ein Container (Patch oder `moveLocal`), werden für alle Nachfahren `abs` und rbush neu berechnet; sie landen in `geometry`.
- **Keine `orderIndex`-Map** (O(n) je Einfügen). Die Ordnung läuft über `compareOrder`; der Treffertest sortiert die Kandidaten damit.
- **rbush-Polster** wie im Spike: Notiz mit Schatten, Frame mit Titelband, gedreht über `rotatedBBox`. Platzhalter ohne Polster.
- **Keine gespeicherte Schriftgröße** (anders als `patch()` im Spike).
- `version`/`rev`/`deleted` gibt es im Client-Modell nicht.

**(R3) Additive Ergänzungen aus Phase 1** (die eingefrorene API bleibt unverändert):
- `SceneModel.ids()`, `SceneModel.bboxOf(id)`; `zorder.cmpOrder({rank, z, id})` (der Vergleich, an den `compareOrder` delegiert); `paths.isPatchPath(path)`; `registry.isKnownType(t)` und `TYPES[*].size` (Spiegel der PHP-Registry); `text.noteFontSize(item)`.
- Tokens: `FRAME_STROKE_WIDTH`, `FRAME_TITLE_BAND` (= `FRAME_TITLE_SIZE * 1.5`), `FRAME_EDGE_HIT_PX` (8), `TEXT_COLOR`, `PLACEHOLDER_*`, `ARROW_SIZE`, `SELECTION_COLOR`, `SELECTION_STROKE_PX`, `DROP_TARGET_COLOR`, `DROP_TARGET_STROKE_PX`, `MARQUEE_FILL`, `MARQUEE_STROKE`.
- Registry-Tabellen und Token-Objekte sind tief eingefroren. [C] klont Vorgaben (`structuredClone`), bevor es sie in ein neues Objekt übernimmt.
- `itemFromPut`: Ein fehlendes `z` wird `null` (nicht `''`), damit ein kaputter put sichtbar bleibt. `itemKey`: Fehlende Felder sind `null` (`r: undefined` ≠ `r: 0`), `data`/`style` kanonisch. `diffPatch` erzeugt nie `t` und löscht nie `z`.
- `keyBetween`: Liefert die Bibliothek den kleinsten Ganzzahl-Schlüssel (`generateKeyBetween(null, '0000000000000000001')` → `'0000000000000000000'`, selbst ungültig), wird die mittlere Ziffer angehängt (`…0i`). Praktisch unerreichbar; nur der Client erzeugt Schlüssel.

### 6.3 `src/scene/` [S] (Konva 10.7.1, imperativ)

**Grundregeln, alle Pflicht:**
- Konva wird nur über tiefe Importe geladen: `konva/lib/Core` plus `konva/lib/shapes/{Rect,Text,Line}`. In M0 werden **keine** weiteren Formen importiert; Arrow, Ellipse und Image kommen in M1.
- `Konva.autoDrawEnabled = false` (global). Jede berührte Ebene wird ausdrücklich neu gezeichnet, höchstens einmal je Bild. **(R3)** Der Renderer markiert sie und zeichnet sie mit `layer.draw()` in der **einen** rAF-Schleife der Szene, nicht per `batchDraw()` (das plant ein eigenes rAF). Nur so lassen sich Draws während einer CSS-Geste zurückhalten und am Gestenende synchron nachholen. Eine leere Overlay-Ebene (beide Gruppen leer) wird bei Kamerawechseln nicht neu gezeichnet; **(R3)** wird sie leer (letzter Umriss weg), wird sie einmal gezeichnet, damit keine alten Pixel stehen bleiben.
- `Konva.pixelRatio = Math.min(2, devicePixelRatio || 1)` vor dem Bau der Stage.
- Ebenen **(R2: zwei Konva-Layer statt drei)**:
  - `staticLayer` (`listening:false`)
  - `overlayLayer` (`listening:false`) mit zwei Gruppen:
    - `activeGroup`: lokal gezogene Objekte und fremde Ziehvorschau (die Zieh-Ebene aus Korrektur 7 bleibt damit getrennt von der statischen Ebene)
    - `uiGroup`: Auswahlrahmen, fremde Auswahl, Rahmenauswahl, Ablage-Ziel
  - **Abweichung zum Dossier:** Jede Konva-Layer ist eine Canvas, und auf der GPU kostet jede einen vollen Viewport-Puffer (ERGEBNIS 1a: ≈ +32 MB je Canvas bei 1920, auf dem iPad mit DPR 2 mehr). Die UI-Gruppe ändert sich zu denselben Zeiten wie die Zieh-Gruppe oder mit dem Präsenztakt; ein gemeinsames Neuzeichnen ist billig. Speicher auf dem iPad wird in M1 gemessen.
  - Fremde Cursor, Editier-Chips und der Text-Editor sind **DOM** in einem Overlay-Div, damit keine weitere Canvas-Fläche entsteht.
- **Kamera nur per `stage.setAttrs({scaleX, scaleY, x: -x*scale, y: -y*scale})`**, höchstens einmal je rAF. Nirgends `stage.scale()` oder `stage.position()`.
- **Culling durch Herausnehmen:** Knoten außerhalb von Viewport + 10 % werden mit `node.remove()` aus der Ebene genommen, nicht mit `visible(false)` verborgen. Knoten werden **erst beim ersten Eintritt** gebaut und dann gecacht.
  - Gezogene und aktive Objekte nimmt das Culling nie heraus.
  - Einfügen in Ordnung: binäre Suche über `compareOrder` auf `getAttr('kid')` (Port aus `endDrag`).
  - Treten mehr als 50 % der angehängten Anzahl gleichzeitig ein (Sprung beim Herauszoomen): alles herausnehmen, sortieren und in Ordnung neu einhängen.
- **Treffertest nur über `model.hitTest`**, nie nativ. Toleranz 4 px / scale (Maus) bzw. 12 px / scale (Touch).
- **LOD 1** (`scale < 0.3`):
  - Notiz ohne Text und ohne Schatten. Unter LOD wird der Text-Knoten gar nicht erst gebaut (Text messen ist der teuerste Teil des Knotenbaus); beim Hochzoomen wird er nachgebaut. Schon gebaute Text-Knoten werden per `visible(false)` verborgen, wie im Spike (`#lod`).
  - Frame-Titel bleibt.
- **Ein gemeinsamer Platzierungshelfer** für alle Typen (`nodes/common.js place()`), der Rotation berücksichtigt und `transformsEnabled` zwischen `'position'` und `'all'` umschaltet (behebt Spike-Mängel §8.4 und §8.6).
- Unbekannter Typ → Platzhalter (graues gestricheltes Rechteck mit Typname), nie ein `throw`.

**Dateien und Schnittstellen:**

`index.js` exportiert `SceneManager` und die JSDoc-Typen.

`SceneManager.js` ist die Fassade, die `BoardSession` [C] benutzt:

```js
/** @typedef {{x:number, y:number, scale:number}} Camera   // x/y = Weltkoordinate der linken oberen Viewport-Ecke
 *  @typedef {{x:number, y:number}} Point
 *  @typedef {'select'|'hand'|'sticky'|'frame'} Tool
 *  @typedef {{key:string, pid:string, name:string, color:string, guest:boolean,
 *             cursor:([number,number]|null), selection:string[], drag:Array<[string,number,number]>,
 *             editing:(string|null), editingHolder:boolean}} RemoteSample      // (R2) editingHolder = h
 *  @typedef {(
 *    {type:'create', t:'sticky'|'frame', at:{x:number,y:number}, rect:({x,y,w,h}|null)} |
 *    {type:'move', ids:string[], dx:number, dy:number, origin:Map<string,{x:number,y:number,parent:(string|null)}>} |
 *    {type:'delete', ids:string[]} |
 *    {type:'text', id:string, path:string, value:string, before:string, final:boolean} |
 *    {type:'reorder', ids:string[], where:'front'|'back'} |
 *    {type:'undo'} | {type:'redo'}
 *  )} Intent
 *  @typedef {{onIntent(i:Intent):void, onSelection(ids:string[]):void, onCamera(c:Camera):void,
 *             onPointer(w:([number,number]|null)):void, onActivity(a:{kind:'drag'|'edit'|'gesture',
 *             active:boolean, ids:string[]}):void, onDragPreview(p:Array<[string,number,number]>):void,
 *             onEditing(id:(string|null), takeover:boolean):void, onTool(t:Tool):void}} SceneCallbacks */
export class SceneManager {
  constructor(container /* HTMLElement */, model /* SceneModel */, { viewOnly = false, shadows = true, callbacks,
              limits = null /* (R3) {maxText, maxTitle} → maxlength des Editors */ })
  mount()                      // Stage, Ebenen, Overlay, ResizeObserver, Input; baut noch keinen Knoten
  destroy()
  getCamera() {}               // (R2) → Camera, die BESTÄTIGTE Kamera (während einer Geste unverändert)
  setCamera(cam) {}            // gebündelt auf rAF
  zoomBy(factor, anchor = null) {}            // (R2) anchor: Point in Container-Koordinaten oder null (= Mitte)
  fit(rect = model.allBounds(), padPx = 48) {} // (R2) rect null (leeres Board) → Kamera {x: −vw/2, y: −vh/2, scale: 1};
                                               // (R3) zoomt nie über 100 % (FIT_MAX_SCALE = 1), sonst öffnete eine
                                               //      einzelne Notiz mit 400 %
  screenToWorld(sx, sy) {}     // (R2) Container-Koordinaten → Point (Welt)
  worldToScreen(wx, wy) {}     // (R2) → Point in Container-Koordinaten (bestätigte Kamera)
  itemScreenRect(id) {}        // (R2) → {x,y,w,h} in Container-Koordinaten oder null; der Debug-Haken (§6.7) addiert
                               //      container.getBoundingClientRect() und liefert Client-Koordinaten für page.mouse
  update(summary /* ChangeSummary */) {}      // nach model.apply: bauen/umbauen/platzieren/neu cullen nur Betroffenes
  reset() {}                                  // nach model.load (Resync): alle Knoten weg, neu cullen; (R3) ein laufendes
                                              //      lokales Ziehen fällt ohne Intent weg (Modell ist neu geladen,
                                              //      ein Zurücksetzen per Delta wäre falsch)
  setTool(tool) {}  getTool() {}
  getSelection() {}  setSelection(ids) {}     // (R3) setSelection meldet nicht über onSelection zurück
  setViewOnly(viewOnly) {}                    // (R2) zur Laufzeit (gone/revoked/logged_out): bricht Ziehen ab wie Esc,
                                              //      keine neuen Intents; ein offener Editor bleibt offen ([C] setzt dann
                                              //      setEditorNotice, damit der Text kopiert werden kann)
  setRemoteSampler(fn /* (nowMs) => RemoteSample[] */) {}   // je Frame abgefragt, solange nicht leer
  presenceChanged() {}                        // (R2) [C] ruft es nach jedem onPresence; weckt die rAF-Schleife
  isActive(id) {}                             // lokal gezogen (inkl. Nachfahren) oder in Bearbeitung
  openTextEditor(id, { text = null, notice = null } = {}) {}   // (R2) text: Startinhalt statt Modellwert (Textrettung)
  setEditorNotice(id, notice /* string|null */) {}             // (R2) Lease verloren/abgelehnt: Hinweis zeigen, Zwischen-
                                                               //      Commits stoppen, Schließen verwirft ohne Intent
  flushEditor() {}             // (R4, additiv) → boolean. Offener Editor ohne Hinweis, dessen Wert vom zuletzt gemeldeten
                               //      abweicht: 1-Hz-Timer löschen, aktuellen Text SYNCHRON als Zwischen-Intent melden
                               //      ({type:'text', …, final:false}, derselbe Weg wie der 1-Hz-Commit), true. Sonst false.
                               //      Schließt nie den Editor, verschiebt nie den Fokus, fasst einen Editor mit Hinweis nie an
  stats() {}  // → {items, nodesBuilt, attached, staticChildren, activeChildren (activeGroup), uiChildren (uiGroup), lod,
              //    camera, liveCamera, lastCameraMs, gestureActive, cssTransform:(string|null),
              //    draws:{static:number, overlay:number}}   // (R2) liveCamera, draws (Zähler für Labor-Gates)
}
```

**(R2) Feste Semantik der Fassade:**
- **Kamera:** `getCamera()` und `stats().camera` sind die bestätigte Kamera; `stats().liveCamera` ist die Gesten-Kamera (gleich der bestätigten, wenn keine Geste läuft). `onCamera` feuert mit der **Live**-Kamera, höchstens 10 × je Sekunde, und am Gestenende einmal mit der neuen bestätigten.
- **Reihenfolge beim Loslassen eines Ziehens:** `onDragPreview([])` → `onIntent({type:'move', …})` (in diesem Moment gilt `isActive(id)` noch, und das Modell steht noch an der gezogenen Position) → `onActivity({kind:'drag', active:false})`. [C] berechnet die neue Lage **nie** aus dem aktuellen Modell, sondern aus `abs(alter Elternteil) + origin + (dx, dy)` (§6.5).
- **Text-Editor beenden (kein Abbrechen in M0):** Blur, Esc, Klick daneben und Strg/⌘+Enter beenden **alle** mit Commit (`final: true`). Esc im Editor leert nicht die Auswahl. Ein Editor mit Hinweis (`setEditorNotice`) verwirft beim Beenden ohne Intent.
- **(R4) `flushEditor()`** ist eine additive Ergänzung der eingefrorenen Fassade [S] → [C] (§10.2). Sie dient Seitenwechsel, Tab-Verstecken und Schließen (§6.4, §6.5): Ein Neuladen oder Schließen per Tastatur löst kein Blur aus, und bis zu ≈ 1 s Getipptes seit dem letzten Zwischen-Commit ginge ohne Rückfrage verloren. Ein zweiter Aufruf ohne neue Eingabe liefert `false` und meldet nichts.
- **Lease-Sperre beim Öffnen:** Doppelklick (oder `openTextEditor` aus der Session ohne `text`) auf ein Objekt, für das ein `RemoteSample` mit `editing == id && editingHolder` existiert → **kein** Editor; stattdessen bekommt der Chip `[data-knorke-editing=<id>]` 5 s lang die Aktion „Übernehmen“ (`[data-knorke-action=take-over]`). Klick darauf öffnet den Editor und meldet `onEditing(id, true)`. Neu angelegte Notizen öffnen immer.

**Interaktion, die die Szene selbst erledigt** und die als Intent oder Callback an die Session geht:
- **Auswählen:** Klick (Umschalt = umschalten), Rahmen auf leerer Fläche (`queryRect` `intersect`), Strg/⌘+A. **(R3)** Der Rahmen wählt Nicht-Container per `intersect`, Container (Frames) aber nur, wenn sie ganz darin liegen (`contain`). Sonst wählte jeder Rahmen, der im leeren Inneren eines Frames beginnt (laut §6.2 leere Fläche), den Frame und zöge ihn samt Kindern.
- **Ziehen:** `pointerdown` auf ausgewähltem oder getroffenem Objekt, Schwelle 3 px.
  - Gezogen werden nur die **obersten** ausgewählten Objekte (Nachfahren eines ausgewählten Frames fahren über die Kaskade mit).
  - Je Frame `model.moveLocal` → Knoten in der `activeGroup` platzieren. Dazu `onDragPreview` (absolute Positionen der obersten Objekte) und `onActivity({kind:'drag'})`.
  - Beim Loslassen (Reihenfolge der Callbacks siehe oben): Intent `move` mit `origin` (x, y, parent vor dem Ziehen); die Knoten gehen in Ordnung zurück in die statische Ebene.
  - Esc bricht ab: `moveLocal` zurück, kein Intent.
  - Das Ablage-Ziel (oberster Container unter der Objektmitte) wird in der `uiGroup` hervorgehoben.
- **Werkzeuge:**
  - `sticky` + Klick → Intent `create` mit `at`; danach Text-Editor öffnen und auf `select` zurückfallen (`onTool`).
  - `frame` + Aufziehen (mindestens 50×50, sonst Klick = Vorgabegröße zentriert) → `create` mit `rect`.
  - `hand` / Leertaste / Mitteltaste → schwenken.
- **Text:** Doppelklick auf Notiz oder Frame-Titel → `TextEditor` (mit Lease-Sperre, siehe oben). Zwischenstände als Intent `text` mit `final:false`, höchstens 1× je Sekunde; beim Beenden `final:true`. Das Overlay ist ein `<textarea>` mit gleicher Schrift, Zeilenhöhe und Innenabstand × scale, horizontal zentriert, `maxlength` aus `limits.maxText` bzw. `maxTitle`. Vertikal oben statt mittig ist für M0 hingenommen; während der Bearbeitung ist der Konva-Text verborgen.
- **Tasten** (nur wenn der Fokus nicht in einem Eingabefeld liegt):

  | Taste | Wirkung |
  |---|---|
  | V / H / N / F | Werkzeug Auswahl / Hand / Notiz / Frame |
  | Leertaste halten | schwenken |
  | Entf, Rücktaste | Intent `delete` |
  | Esc | Ziehen abbrechen bzw. Auswahl leeren (im Text-Editor: beenden mit Commit) |
  | Strg/⌘+Z | `undo` |
  | Strg/⌘+Umschalt+Z, Strg+Y | `redo` |
  | + / − | Zoom |
  | Umschalt+1 / Umschalt+0 | alles zeigen / 100 % |
  | Strg/⌘+A | alles auswählen |

- **Ansehen-Modus** (`viewOnly`, auch per `setViewOnly`): nur Schwenken, Zoomen und Auswahl-Hervorhebung, sonst keine Intents.

`Camera.js` (rein, in Node getestet):

```js
export class Camera {
  constructor({ minScale = MIN_SCALE, maxScale = MAX_SCALE } = {})
  get() {}  set(x, y, scale) {}               // klemmt scale
  screenToWorld(sx, sy) {}  worldToScreen(wx, wy) {}
  zoomAt(sx, sy, factor) {}                   // → neue Kamera, Weltpunkt unter (sx,sy) bleibt fest
  fit(rect, vw, vh, padPx) {}                 // → Kamera
  viewRect(vw, vh, marginFrac = 0.1) {}       // → {minX,minY,maxX,maxY}
}
export function cssTransformFor(c0, c1) {}    // → {k, tx, ty}: k = s1/s0, tx = (x0-x1)*s1, ty = (y0-y1)*s1
```

`culling.js` (rein): `diffVisible(prev /*Set*/, hits /*Iterable<string>*/, exempt /*Set*/)` → `{enter, leave, next}`.

`order.js` (rein): `insertIndex(kids /*string[] in Ebenenreihenfolge*/, id, compare)` → number, und `shouldBulkReattach(enterCount, attachedCount)` → boolean.

`KonvaRenderer.js`: engine-gebundener Teil. Die Schnittstelle bleibt engine-neutral, als billige Versicherung, falls die iPad-Messung die Engine-Wahl kippt.

```js
export class KonvaRenderer {
  constructor(container, model, { shadows })
  mount(width, height) {}  resize(width, height) {}  destroy() {}
  setCamera(x, y, scale) {}                   // EIN setAttrs + cull + Ebene zum Zeichnen markieren (statisch; Overlay nur
                                              // wenn nicht leer); (R3) gezeichnet per draw() in der Szenen-rAF
  beginGesture() {}  gestureFrame(c1) {}  endGesture(c1) {}   // CSS-Pfad, siehe unten
  applySummary(summary) {}                    // added/removed/updated/geometry/reordered → bauen, platzieren, umhängen, cullen
  beginDrag(ids) {}  dragMoved(geometryIds) {}  endDrag() {}
  setPreviews(map /* Map<id,{x,y}> */) {}     // fremde Ziehvorschau (absolute Welt), activeGroup; Container nehmen Nachfahren mit
  setSelection(localIds, remote /* Array<{ids, color}> */) {}  setMarquee(rect) {}  setDropTarget(id) {}
  setTextHidden(id, hidden) {}
  get contentEl() {}                          // stage.content (.konvajs-content) für den CSS-Pfad
  stats() {}
}
```

`nodes/index.js`: `nodeSpecFor(t)` → `{ build(ctx, item, abs, lod) → Entry, update(ctx, entry, item, abs, fields, lod) → boolean (true = neu bauen), setLod(entry, lod), destroy(entry) }`, dabei ist `Entry = {root, parts, lod}`.

`nodes/sticky.js`, `frame.js` und `placeholder.js` sind Ports der Spike-Builder. Frame-Füllung kommt aus `style.fill`, nicht aus Konstanten (Spike-Mangel §8.5).

`GestureController.js`, der **CSS-Transform-Gestenpfad** (Korrektur 8):

```js
export class GestureController {
  constructor(el, { getCamera, viewOnly: () => boolean, claimTouch(e) /* → true, wenn InputController den
                    Ein-Finger-Touch übernimmt */, onDirect(cam), onGestureStart(c0), onGestureFrame(c1), onGestureEnd(c1) })
  destroy() {}
}
```

- **Wheel:**
  - `passive:false` plus `preventDefault`, damit es keinen Seitenzoom gibt.
  - Mit `ctrlKey` (auch Trackpad-Pinch) wird gezoomt: `factor = exp(-deltaY * 0.0015)`, im Modus `deltaMode = 1` mal 16 gerechnet. Ohne `ctrlKey` wird geschwenkt (`deltaX`/`deltaY` ÷ scale).
  - Die Geste beginnt beim ersten Wheel-Ereignis und endet 120 ms nach dem letzten, **(R5)** oder sofort (Commit), wenn ein Touch oder ein Maus-/Stift-Schwenk beginnt.
- **(R2) Touch, alle Gesten über den CSS-Pfad** (`pointerType === 'touch'`; `pointerdown`/`pointermove`/`pointerup`/`pointercancel`):
  - **Ein Finger:** schwenken. Ausnahme im Bearbeiten-Modus: Trifft der Finger ein Objekt, darf `claimTouch(e)` ihn für Auswahl/Ziehen übernehmen (InputController); im Ansehen-Modus übernimmt nie jemand.
  - **Zwei Finger:** Mittelpunkt und Abstand ergeben Zoom und Schwenk. Kommt der zweite Finger, während der InputController einen Touch-Zug hält, bricht dieser ab wie Esc, und beide Pointer gehören der Geste.
  - **Wechsel innerhalb einer Geste:** Pinch → ein Finger hebt ab → der verbleibende schwenkt weiter, **dieselbe** Geste (kein Ende, kein Neuzeichnen); neuer Bezugspunkt ist die aktuelle Fingerposition. Die Geste endet, wenn kein Touch-Pointer mehr unten ist.
  - Auf dem Container gilt `touch-action: none`, und `gesturestart` wird unterbunden (WebKit).
- **Während der Geste:**
  - **Konva bleibt unberührt.** Gesetzt wird nur `contentEl.style.transform = translate(tx px, ty px) scale(k)` mit `transform-origin: 0 0`, höchstens einmal je rAF.
  - Ein Zwischen-Neuzeichnen gibt es nur, wenn `k ∉ [0.5, 2]` oder `|t| > 0.5 × Viewport`.
  - **Hinweis (M2):** Ersetzt durch die Deckungsregel, SPEC-M1 §6.3 (M2), Absatz „Überstand und Deckungsregel (M2)“: Die Bühne ist um einen Überstand größer als der Viewport, `.konvajs-content` liegt bei (−l, −t) mit `transform-origin` `l px t px` statt `0 0`, und zwischendurch gezeichnet wird, sobald die transformierte Bühne mehr als 1 px des Viewports frei ließe oder k > 2 ist. Dort steht auch das Culling-Rechteck, das „Viewport + 10 %“ ersetzt.
  - DOM-Overlays (Cursor, Chips, Editor) rechnen mit der Live-Kamera.
- **Ende:**
  - `renderer.setCamera(c1)` → **(R2) jede nicht leere Ebene synchron zeichnen** (`staticLayer.draw()` immer, `overlayLayer.draw()`, wenn eine Gruppe Kinder hat; Auswahlrahmen und fremde Ziehvorschau liegen im selben transformierten `.konvajs-content` und stünden sonst ein Bild lang falsch) → Transform im selben Task zurücksetzen.
  - So gibt es kein veraltetes Bild; `batchDraw` allein würde eine rAF zu spät malen.
- **Direkter Pfad nur für Maus und Stift** (Hand-Werkzeug, Leertaste, Mitteltaste): `setCamera` je rAF.
  - **(R5, U17/CLIENT-9)** Jeder Zug verschiebt die **aktuelle** bestätigte Kamera (`getCamera()`) um das Zeiger-Delta seit dem vorigen Zug (nicht Startkamera + Gesamtdelta; intern `#direct = {id, last}`). Eine Kameraänderung während des Schwenks (Zoom-Taste, „Alles zeigen“, 100 %, `setCamera`) bleibt erhalten.
  - **CSS-Pfad und direkter Pfad laufen nie gleichzeitig:** Ein Maus-/Stift-Schwenk, der während einer Wheel-Geste beginnt, beendet sie zuerst (Commit, wie ein Touch) und setzt an ihrer Kamera an; während einer Touch-Geste beginnt er nicht. Wheel-Ereignisse während eines Maus-/Stift-Schwenks werden mit `preventDefault` verschluckt (Trackpad-Nachlauf, Freilauf-Mausrad), wie schon während einer Touch-Geste. Ein Touch, der während eines Maus-/Stift-Schwenks aufsetzt, bleibt bis zum Abheben wirkungslos (keine Geste, kein `claimTouch`).
  - Folge für [C] (kein Code nötig): Beginnt ein Schwenk ≤ 120 ms nach einem Wheel-Ereignis, kommen im selben `pointerdown` erst `onActivity({kind:'gesture', active:false})` der Wheel-Geste, dann `active:true` des Schwenks. Wheel-Ereignisse während eines Schwenks erzeugen kein `onActivity`/`onCamera`. Ein Auswahlklick ≤ 120 ms nach Wheel beendet die Wheel-Geste nicht; der Treffertest rechnet mit der Live-Kamera und stimmt.

`InputController.js`, `Selection.js`, `CursorLayer.js` und `TextEditor.js` erledigen die Zeiger-/Tastatur-Logik, die Auswahlmenge (`topLevel(ids, model)`), die DOM-Cursor mit Namensschild und die „bearbeitet“-Chips (CursorLayer zeichnet je Frame aus `RemoteSample[]` und Live-Kamera) sowie das Text-Overlay. Die Signaturen sind innerhalb von [S] frei, solange die Fassade oben und die Test-Haken aus §6.8 gelten. Alle Texte in diesen Overlays gehen über `textContent`; Namensschilder von Gästen tragen den Zusatz aus §6.9 und die Klasse `knorke-cursor--guest`. **(R3)** Die Overlays sind inline gestylt, mit den Klassen `knorke-scene-overlay`, `knorke-cursor`, `knorke-cursor-name`, `knorke-cursor--guest`, `knorke-editing-chip`, `knorke-editor`, `knorke-editor-notice`; `knorke.css` braucht nichts, darf sie aber thematisieren.

**rAF-Schleife:** Es gibt genau eine, und sie läuft nur, wenn etwas zu tun ist: Kamera geändert, Geste, Ziehen, nicht leere Fremdpräsenz oder ausstehende Platzierungen. **(R2)** Läuft sie nicht, weckt sie `presenceChanged()` (sonst erschienen Cursor auf einer ruhigen Szene nie); sie fragt den Sampler, solange er nicht leer liefert, und hält danach an.

### 6.4 `src/sync/` [C]

**`http.js`**

```js
export class HttpError extends Error { constructor(status, code, message, retryAfterMs = null, fromApp = false) }
export async function request(method, url, { body, headers = {}, timeoutMs = 10000, keepalive = false } = {}) {}
// fetch, credentials 'same-origin', AbortController-Timeout; Netzfehler/Timeout → HttpError(0,'network');
// (R2) JSON mit `error` → HttpError(status, error, message, …, fromApp=true);
//      JSON ohne `error` (Nextcloud 401/412 `{message}`) und Nicht-JSON (Traefik-429) → HttpError(status, 'http_' + status);
//      Retry-After (Sekunden) → retryAfterMs
// (R4) Body = JSON.stringify(body, replacer); der Replacer gibt jeden String als wellFormed(v) aus (Rückhalt, §6.5)
export function isProxyRetry(e) {}   // (R2) status 429|503 && !fromApp → true
```

**(R4) Wohlgeformte Strings:** Ein einzelnes UTF-16-Surrogat (aus einer UTF-16-Zwischenablage oder einem IME) schreibt `JSON.stringify` als `\udXXX`; Nextclouds `json_decode` lehnt den ganzen Body mit 400 ab, und der SyncClient verwarf den ganzen Batch als `bad` (Nicht-Text-Ops still). Deshalb macht `util` `wellFormed(s)` (`String.prototype.toWellFormed`, sonst ein Regex: ungepaarte Surrogate → U+FFFD) jeden ausgehenden String wohlgeformt, **bevor** er in die Warteschlange kommt (§6.5), und `request()` tut es als Rückhalt für jeden Body noch einmal.

**`transport.js`**

```js
export function userTransport(boardId) {}          // → {kind:'user', snapshot(), sync(body)}
export function guestTransport({ boardId, linkToken, client, getGuest, setGuest, clearGuest }) {}
// → {kind:'guest', join(name), snapshot(), sync(body)}; Header X-Knorke-Guest; join schickt gespeichertes Token mit
// (R3) client = Client-ID des Tabs, Pflichtfeld im Beitrittsbody (§4.9.2)
```

Zeitlimits: `sync` 10 s, `snapshot`/`join` 30 s.

**(R2) Regeln im Transport** (am Status, nicht am Code, wo Nextcloud oder der Proxy antwortet):
- **412** (nur `userTransport`): einmal `GET /index.php/csrftoken`, Token übernehmen, dieselbe Anfrage einmal wiederholen; erneut 412 → `HttpError(401, 'http_401')` (→ `logged_out`).
- **Proxy-429/503** (`isProxyRetry`) bei `join`, `snapshot`, `sync`: Der Transport wirft weiter; **SyncClient und `BoardSession.open`** warten `retryAfterMs` bzw. 2–10 s mit Zufall und wiederholen, ohne `failures` hochzuzählen und ohne `offline` zu melden. App-`rate_limited` (429 mit `error`) ist endgültig; **(R3)** auf `/sync` stoppt der SyncClient mit Status `rate_limited` (Banner, §6.8).
- `guestTransport.join`: 404 → `clearGuest()` (gespeicherten Eintrag löschen) und weiterwerfen.

**`protocol.js`:** `export const PROTOCOL = 1`.

**`Replica.js`**, bestätigter Zustand plus ausstehende Ops (eigene Ops haben Vorrang):

```js
export class Replica {
  constructor()
  loadSnapshot(items, rev) {}            // → Set<id> (alle betroffenen); verwirft bestätigte Ops mit ackRev ≤ rev
  applyServer(items, removed) {}         // → Set<id>
  addLocal(ops, { urgent = true } = {}) {}   // → Set<id>; Verdichtung in der Warteschlange (s. u.); urgent für scheduler
  takeBatch(max = 200) {}                // → {seq, ops} | null; nach Fehler: derselbe Batch, dieselbe seq
  ack({ seq, rev, res }) {}              // (R2) → {ids:Set<id>, failed:Array<{op, code}>}; ok → wartet bis Cursor ≥ rev
                                         //      (rev null → sofort erledigt); dup/gone/bad/denied/limit/locked → verworfen
                                         //      und in failed gemeldet (die Session rettet Text, §6.5)
  failInflight() {}                      // Batch bleibt für eine identische Wiederholung
  splitInflight({ maybeSent = false } = {}) {}  // (R2) nach 413: erste Hälfte bleibt in-flight (gleiche seq), Rest zurück an
                                         //      den Anfang der Warteschlange; (R5) maybeSent: die zurückgegebene Hälfte
                                         //      bekommt die Verdichtungssperre (nach 500, das nach dem Commit kommen kann)
  holdInflight() {}                      // (R5, U8) → boolean; nur bei genau einer Op in-flight: beiseitelegen
  releaseHeld() {}                       // (R5) → {seq, ops} | null: älteste gehaltene Op allein, neue seq
  heldCount() {}                         // (R5)
  static withoutDependents(ops, blockedOps) {}  // (R5) Ops ohne die, die auf blockierten IDs liegen oder sie als parent nennen
                                         //      (transitiv in Warteschlangen-Reihenfolge)
  markMaybeSent(ops = null) {}           // (R4/R5) Verdichtungssperre für die Einträge, deren Op-Objekte per Keepalive
                                         //      hinausgingen (Vorgabe: ganze Warteschlange)
  settle(cursor) {}                      // → Set<id>; bestätigte Ops mit rev ≤ cursor fallen weg
  visible(id) {}                         // → WireItem | null
  hasQueued() {}  hasUrgent() {}  hasInflight() {}  pendingCount() {}
  pendingIds() {}  pendingOps() {}       // (R5) schließen gehaltene Ops ein; pendingOps: gehalten, dann in-flight, dann Warteschlange
  confirmedItems() {}                    // Debug
}
export function mergePatch(older, newer) {}   // rein
```

**(R5) Stufen:** Warteschlange → gehalten (U8) → in-flight → bestätigt-wartend. `visible(id)` = confirmed ⊕ wartend ⊕ gehalten ⊕ in-flight ⊕ Warteschlange. Solange Ops gehalten sind, überspringt `takeBatch` Warteschlangen-Ops auf einer gehaltenen ID oder mit ihr als `parent` (transitiv in Warteschlangen-Reihenfolge); bleibt nichts Sendbares, liefert es `null`.

`visible(id)` = Klon von `confirmed.get(id)` oder `null`, dann die ausstehenden Ops der ID in Reihenfolge (bestätigt-wartend → in-flight → Warteschlange) anwenden:
- put: Fehlt das Objekt, entsteht es aus dem put. Gibt es es schon, gewinnt der Server (bei `revive` ebenso, solange es bestätigt existiert).
- patch: `applyPatch`, falls das Objekt existiert.
- remove: `null`.

Verdichtung **nur in der Warteschlange** (nie gesendete Ops), Port von `load.mjs enqueue`:
- put + patch → in das put einarbeiten (`setPath` auf `p`)
- remove eines ungesendeten put → beide verwerfen
- patch + patch → `mergePatch`:
  - Für jeden Pfad `k` aus dem neueren Patch: Liegt im älteren ein Vorfahr-Pfad `a`, wird per `setPath` in dessen Wert gesetzt.
  - Sonst werden die Nachfahren-Pfade von `k` im älteren gelöscht, und `k` wird angehängt.
  - Die Lagegruppe bleibt vollständig (beide Patches tragen sie ganz oder gar nicht).
- remove nach patch → remove
- **(R2) remove(X) gefolgt von put(X, revive)** (Löschen und Rückgängig vor dem nächsten Takt, oder beides offline): beide werden zu **einem** `patch` = `diffPatch(Zustand vor dem remove, Zustand des put)` zusammengezogen; ist der leer, fallen beide weg. „Zustand vor dem remove“ = `visible`, berechnet ohne das remove und alles danach. Gibt es keinen Vorzustand (das Objekt existierte nur als ungesendetes put), bleibt das put. Ohne diese Regel ergäbe der Batch `[put X revive → dup, remove X]`, und das Objekt wäre trotz Rückgängig gelöscht (Datenverlust).
- Nach einem Netzfehler wird der in-flight-Batch **nicht** mit neuen Ops verschmolzen, denn er ist vielleicht schon committet.
- **(R4) Verdichtungssperre nach `flushKeepalive`:** Der Keepalive schickt Ops, die in der Warteschlange bleiben; sie sind danach „vielleicht gesendet“. `flushKeepalive` ruft eine Replica-Methode (z. B. `markMaybeSent()`), die `barrier = queue.length` setzt. `lastIndex()` und die Verdichtung verschmelzen nie mit Einträgen unterhalb der Sperre und schneiden keine heraus; neue Ops werden angehängt. `takeBatch` senkt die Sperre, wenn Einträge in-flight gehen. Die Reihenfolge je ID bleibt erhalten.
  - **(R5) So gebaut (statt Zähler):** `markMaybeSent(ops?)` markiert genau die Warteschlangen-Einträge, deren Op-Objekte hinausgingen (`flushKeepalive` übergibt `body.ops`). `enqueue()` verschmilzt nie mit einem markierten letzten Eintrag und schneidet ihn nie heraus; die neue Op wird angehängt. Ausnahme: Ein patch oder remove nach einem markierten remove fällt weiter weg, denn das Objekt ist für diesen Client schon fort. Die Markierungen wandern mit den Einträgen, wenn `takeBatch` sie in-flight nimmt. Ohne Sperre fiel remove + put revive zu einem diff-patch oder zu nichts zusammen, ein patch verschwand in einem schon gesendeten put (kam als `dup` zurück), und remove eines gesendeten put verwarf beide; ein zurückgenommenes Löschen verschwand so wieder.

**`takeBatch` ordnet stabil (R2: Reihenfolge je ID bleibt immer erhalten):**
1. Ein put eines Containers wird nach vorn gezogen (topologisch nach Elternkette), **nur wenn keine frühere Op in der Warteschlange dieselbe ID hat**.
2. Ein remove wandert ans Ende, **nur wenn keine spätere Op dieselbe ID hat oder sie als `parent` nennt**.
3. Alles andere bleibt in Warteschlangen-Reihenfolge. Zwei Ops auf dieselbe ID tauschen nie die Plätze.

So existiert ein Elternteil vor einem Kind, das auf ihn verweist (der Server prüft die Eltern zum Zeitpunkt der Op), und Löschen + Rückgängig kann nicht in „belebt, dann gelöscht“ umkippen. Pflichttests in `replica.test.mjs`: „delete+undo in einem Takt → Objekt lebt“, „Frame löschen + Rückgängig in einem Takt (put F revive, Kinder zurück, kein remove F)“, „remove ans Ende nur ohne spätere Referenz“.

**`scheduler.js`** (rein):

```js
export const INTERVALS = { activeMs: 400, jitterMs: 50, idleMs: 1000, viewMs: 2000, hiddenMs: 5000,
                           activeWindowMs: 5000, commitGapMs: 150, backoffMs: [1000, 2000, 4000, 8000, 15000] }
export function nextDelay(state, nowMs, intervals = INTERVALS, rand = Math.random) {}
// state = {t0, lastLocalAt, lastRemoteAt, remoteDragging, hidden, viewOnly, failures, more, urgent}
// more → 0; failures>0 → backoff[min(f-1,4)] * (1 + rand*0.2);
// sonst Basis = hidden ? hiddenMs : viewOnly ? viewMs : aktiv ? activeMs±jitter : idleMs
//   (aktiv = eigene Aktion oder Fremdänderung < activeWindowMs oder remoteDragging)
// (R2) urgent → min(Basis, commitGapMs); Ergebnis = max(0, t0 + Basis − nowMs)  ← Takt ab ANFRAGEBEGINN (Korrektur 4)
```

- **(R2) Nur „endgültige“ Ops verkürzen den Takt** (`urgent`): Loslassen nach dem Ziehen, Anlegen, Löschen, Farbe, Reihenfolge, Undo/Redo und das Schließen des Editors (`final: true`). Text-Zwischenstände (`final: false`, 1 Hz) laufen im normalen Takt mit; sonst triebe ein Tippender den Editor auf 3–6 Anfragen/s statt der im Spike angenommenen ≈ 2,3 (Korrektur 3, Ziel ≥ 30 % Edge-Spielraum).
- `poke()` (Nutzeraktivität) setzt nur `lastLocalAt` und rechnet `nextDelay` ab `t0` neu; es sendet nie vor `t0 + activeMs`.
- **(R3) Jitter und poke:** „aktiv → `activeMs ± jitter`“ widersprach bei negativem Jitter der Regel „poke nie vor `t0 + activeMs`“. `nextDelay` behält `± jitterMs`; nur ein **durch `poke` ausgelöstes** Wecken wird auf `t0 + activeMs` geklemmt (`pokeDelay(state, nowMs, …)` in `scheduler.js`, im Client `SyncClient.pokeFloor`), außer bei `more`, `urgent` oder Fehlern.

**`SyncClient.js`**

```js
export class SyncClient {
  constructor({ transport, replica, client, getPresence, viewOnly = false,
                onChanges(items, removed), onAcks(acks), onSettled(cursor), onPresence(map),
                onStatus(s /* 'online'|'offline'|'resyncing'|'gone'|'revoked'|'logged_out'|'reload'|'rate_limited' (R3)
                             |'links_disabled' (R5) */),
                onResync() /* → Promise<number> neuer Cursor */, now = () => performance.now(),
                sleep = (ms, signal) => …, intervals = INTERVALS })
  start(cursor) {}  stop() {}
  enqueue(ops, { urgent = true } = {}) {}   // replica.addLocal + Wecken (urgent: frühestens commitGapMs nach t0)
  poke() {}                 // Nutzeraktivität (sendet nie vor t0 + activeMs)
  setHidden(hidden) {}      // visibilitychange; sichtbar werden → sofort Takt
  get cursor() {}
  flushKeepalive() {}       // pagehide/visibilitychange hidden mit Ausstehendem: fetch keepalive, ein Versuch,
                            // (R2) höchstens 60 KiB Body (Browser-Grenze 64 KiB): nur so viele Ops, wie passen; kein 412-Retry
                            // (R4) zusätzlich höchstens MAX_OPS (200) Ops, in Reihenfolge: zuerst in-flight (immer neu
                            //      senden, Wiederholung ist idempotent), dann Warteschlange; sonst 400 too_many_ops für alles.
                            //      Statt „an der Replica ändert sich nichts“: die gesendeten Warteschlangen-Einträge werden
                            //      nicht mehr verdichtbar (Verdichtungssperre, oben)
                            // (R5) ohne die Ops, die die Schleife je beiseitegelegt hat (U8), samt allem, was hinter ihnen
                            //      wartet (gleiche ID oder als parent, transitiv); eine einzige solche Op ließe den ganzen
                            //      Keepalive scheitern
  setCursor(n) {}           // (R3) nur für debug.setCursor (§6.7): eine Antwort, deren Anfrage VOR dem Aufruf begann,
                            //      setzt den Cursor nicht mehr (Präsenz und Acks wirken weiter)
}
```

Schleife (immer **genau eine Anfrage in Arbeit**):

```
loop:
  t0 = now()
  body = {proto, client, since: cursor, pres: hidden ? 0 : 1}
  batch = replica.takeBatch(200) → body.ops, body.seq
  me = getPresence() → mitsenden, wenn geändert oder letzte Sendung ≥ 3 s her (Keepalive < 10 s Veralterung);
       nie im Ansehen-Modus oder bei verstecktem Tab
  try res = await transport.sync(body)
  catch e:                                         // (R2) Entscheidung am STATUS, wo Nextcloud/Proxy antworten
    if batch: replica.failInflight()
    isProxyRetry(e)               → warten retryAfterMs bzw. 2–10 s Zufall; failures unverändert; nicht 'offline'
    404                           → onStatus('gone'); stop
    401 && kind=='user'           → onStatus('logged_out'); stop          // Nextcloud {message}, kein `error`
    401 guest_token (kind guest)  → genau einmal transport.join(gespeicherter Name):
                                      ok → weiter (neues Token); 403 link_revoked / 404 / App-429 → 'revoked'; stop
                                      (R5) 403 links_disabled → 'links_disabled'; stop
    403 link_revoked              → onStatus('revoked'); stop             // (R2) KEIN automatischer Beitritt
    403 links_disabled            → onStatus('links_disabled'); stop      // (R5) endgültig, §4.9.7
    403 sonst                     → onStatus('gone'); stop
    409 protocol                  → 'reload'; stop
    413                           → replica.splitInflight(); sofort
    400                           → Batch verwerfen (replica.ack mit 'bad' für alle) + onResync
    429 rate_limited (fromApp)    → onStatus('rate_limited'); stop        // (R3) endgültig, Banner, nie wiederholen
    sonst (0/411/5xx)             → failures++ (ab 2 → 'offline'); delay = Backoff
    (R5) 500 mit Batch            → zusätzlich _isolate (U8, unten)
  else:
    failures = 0; 'online'
    (R5) nach jeder 2xx-Antwort: replica.releaseHeld() schickt die älteste gehaltene Op allein erneut (neue seq, sofort)
    if res.acks: onAcks(res.acks)               // Session: replica.ack → flushVisible + Textrettung
    if res.resync: resyncs.push(now); bei ≥ 3 in 10 s erst Backoff (2, 4, … 30 s); cursor = await onResync(); continue
    onChanges(res.items ?? [], res.removed ?? []); cursor = res.rev; onSettled(cursor)
    if res.presence !== undefined: onPresence(res.presence)   // (R2) bei pres=1 immer da, auch {}
  await sleep(nextDelay(...))  // durch enqueue/poke/visible weckbar
```

**(R5) Isolierung bei Serverfehlern (U8, NC-3).** Vorher ging ein Batch, der 500 bekam, bei jeder Wiederholung unverändert hinaus (`failInflight` ist ein No-op), und alles Spätere wartete dahinter. Jetzt (`SyncClient._isolate`, nach dem normalen Backoff und der Offline-Zählung):
1. 3 aufeinanderfolgende 500 für denselben Batch machen seine Ops verdächtig. Eine Nicht-500-Antwort des Servers setzt den Zähler zurück, Netzfehler und Proxy-Wiederholungen nicht. Proxy-429/502/503/504 zählen nie.
2. Ein scheiternder Batch mit Verdächtigen wird halbiert (`splitInflight({maybeSent: true})`; die zurückgegebene Hälfte bekommt die Verdichtungssperre, weil ein 500 nach dem Commit kommen kann). Der nächste Versuch folgt nach `backoffMs[0]` (1 s), nicht nach dem wachsenden Backoff.
3. Eine einzelne verdächtige Op, die scheitert, wird beiseitegelegt (`holdInflight`). Alles andere läuft weiter. Nach der nächsten 2xx-Antwort geht sie allein erneut hinaus (`releaseHeld`, neue seq).
4. Verworfen wird eine Op erst nach 3 Fehlschlägen allein, jeweils direkt nach einer 2xx-Antwort; während eines Ausfalls also nie. Das Verwerfen ruft `onAcks({seq, rev: null, res: ['internal']})`. `internal` ist ein rein clientseitiger Ack-Code (Toast und Textrettung, §6.5) und wird nie gesendet.
- Konstanten: `SERVER_ERROR_TRIES = 3`, `SERVER_ERROR = 'internal'`, `LINKS_DISABLED = 'links_disabled'`; `FINAL_STATUSES` = `['gone','revoked','logged_out','reload','rate_limited','links_disabled']`.
- **(R5, U7)** Der Client verlässt sich auf §4.5: Ein vom Server geänderter Wert kommt als gespeichertes Objekt in derselben Antwort (`onAcks` → wartend, `onChanges` → bestätigt, `onSettled` verwirft die wartende Op). Ein offener Editor übernimmt den gespeicherten Text, sobald er schließt.

Weitere Ereignisse: `online` (Browser) → `poke()`. **(R2)** Solange Ops ausstehen (`pendingCount() > 0`), setzt die Session einen `beforeunload`-Hinweis; offline gemachte Änderungen gingen beim Schließen sonst verloren. **(R4)** In den Handlern für `visibilitychange` (hidden), `pagehide` und `beforeunload` ruft die Session **zuerst** `scene.flushEditor()` (§6.3): Der Zwischen-Intent läuft synchron über `onIntent` → `actions.setText` → Replica. Erst danach folgen `flushKeepalive` bzw. die Prüfung für den Hinweis. Ein Editor mit ungespeichertem Text zählt so als ausstehend (`pendingCount() > 0`), auch wenn die Warteschlange vorher leer war.

**`presence.js`**

```js
export function colorFor(pid) {}                         // stabile Farbe aus pid (Palette mit 12 Farben, kontrastgeprüft)
export class PresenceModel {
  constructor({ now = () => performance.now(), staleMs = 10000, maxGlideMs = 3000, snapAfterMs = 4000 })
                                                         // (R5) ersetzt delayMs = 400 (Ursache von CLIENT-8)
  update(map, receivedAt) {}                             // Serverkarte → je Eintrag eine Gleitstrecke (R5, unten);
                                                         // (R2) Schlüssel, die in der neuesten Karte fehlen, fliegen sofort
  sample(nowMs) {}                                       // → RemoteSample[], reine Arithmetik auf der vorbereiteten Strecke,
                                                         // ohne Extrapolation; (R2) Einträge ohne Auffrischung > staleMs fallen weg
  participants() {}                                      // → [{pid, name, color, guest}] dedupliziert nach pid
  hasDragging() {}
  leaseHolder(itemId) {}                                 // (R2) → {pid, name} | null (Eintrag mit e == itemId und h == 1)
}
```

**(R5) Gleiten statt fester Verzögerung (U16, CLIENT-8).** Mit festen 400 ms Verzug sprang jeder Cursor bei 1-s-Takt (ruhige Beobachter) bzw. 2-s-Takt (Ansehen-Geräte) um 60–80 % jedes Schritts. Jetzt startet jede neue Karte je Eintrag eine Gleitstrecke von der zum Ankunftszeitpunkt angezeigten Position zur neuesten Stichprobe. Dauer = beobachteter Abstand der letzten beiden Karten (eigene Poll-Kadenz 0,4/1/2 s), höchstens `maxGlideMs`. Sofort angezeigt werden: die erste Karte, eine Lücke > `snapAfterMs` (etwa ein versteckter Tab), ein neuer Schlüssel, ein Cursor, der erscheint oder verschwindet, eine neue Ziehvorschau-ID. Ziehvorschauen gleiten je ID genauso. Keine Extrapolation.

### 6.5 `src/board/` [C]

**`BoardSession.js`**, die Verdrahtung:

```js
export class BoardSession {
  constructor({ container, mode /* 'user'|'guest' */, boardId = null, linkToken = null, viewOnly, debug,
                ui: { onStatus, onSelection, onParticipants, onBoard, onTool, onZoom, onUndoState } })
  async open(guestName = null) {}   // join|snapshot → replica.loadSnapshot → model.load → scene.mount+fit/Kamera
                                    // aus localStorage['knorke.cam.'+boardId] → sync.start(rev); gibt {me, board} zurück
  setTool(t) {}  undo() {}  redo() {}
  setFill(color) {}  reorder(where) {}  deleteSelection() {}
  zoomIn() {}  zoomOut() {}  zoomFit() {}  zoom100() {}
  destroy() {}                      // (R3) Reihenfolge: zuerst scene.destroy() (beendet einen offenen Editor mit dem
                                    // letzten Text-Intent), dann flushKeepalive(), dann sync.stop(); sonst ginge bis
                                    // zu ≈ 1 s Getipptes seit dem letzten Zwischen-Commit verloren
  async prepareLeave({ timeoutMs = 3000 } = {}) {}   // (R4) → boolean, für die Verlassen-Sperre (§6.6):
                                    // 1. scene.flushEditor(); 2. pendingCount() === 0 oder Sitzung eingefroren bzw. in
                                    // endgültigem Status → true; 3. online: Takt wecken und bis timeoutMs auf
                                    // pendingCount() === 0 warten → true; 4. noch Ausstehendes → false
                                    // (R5, so gebaut) „ausstehend“ = Warteschlange, gehalten, in-flight, Übernahme-Text;
                                    // offline (Status 'offline' oder navigator.onLine false) → sofort false; online ruft es
                                    // einmal forceTick() (überspringt für eine Anfrage ein Retry-After- bzw. Backoff-Warten)
                                    // und prüft alle 50 ms; wird der Status dabei 'offline' → false
}
```

Pflichtverhalten:
- **`flushVisible(ids)`:** Für jede ID ohne `scene.isActive(id)` wird `replica.visible(id)` gesammelt → `model.apply({upserts, removes})` → `scene.update(summary)`. Aktive IDs kommen in `deferred` und werden bei `onActivity(... active:false)` nachgeholt.
- **(R4) Resync mit aktiven Objekten:** Vor `model.load` behält `resync` jede ID des alten Modells mit `scene.isActive(id)`, auch wenn `replica.allIds()` sie nicht mehr kennt: aktueller Modellstand mitladen, ID in `deferred` (§4.10.3).
- **Intent `move`** (kommt **vor** `onActivity(active:false)`, §6.3): `actions.moveItems` erzeugt für jedes oberste Objekt die neue Elternzuordnung:
  - **(R2)** Neue absolute Lage = `abs(origin.parent) + (origin.x, origin.y) + (dx, dy)` (`abs(null)` = 0), **nie** aus dem aktuellen Modell.
  - Kandidat ist `model.topContainerAt(Mittelpunkt der neuen absoluten Box, exclude = gezogene + Nachfahren)`, sofern `canBeChildOf` passt; sonst `null`.
  - Daraus folgt ein `patch {x, y, parent}` (**immer alle drei**, §4.7 Regel 2a) mit relativen Koordinaten, gerundet auf 0,01. Inverse = `origin` (ebenfalls alle drei).
- **Intent `create`:**
  - Neue ULID, `z = keyBetween(model.maxZ(layer), null)` (wirft nie, §6.2), Elternteil wie oben.
  - Ein Frame per `rect` **übernimmt** alle obersten Nicht-Container-Objekte, deren Box ganz drin liegt (patch `x, y, parent` mit relativen Koordinaten).
  - Danach Auswahl = neues Objekt; bei einer Notiz `scene.openTextEditor`.
- **Intent `delete`:** Für jeden Container ohne mitgelöschte Kinder werden die Kinder freigegeben (`patch {parent:null, x, y}` mit absoluten Koordinaten), dann folgen die removes. Inverse = put mit `revive` und den alten Zuständen, dazu Patches (`x, y, parent`), die die Kinder zurückhängen.
- **Intent `text`:** `patch {[path]: value}`; Zwischenstände (`final:false`) gehen mit `urgent:false` in die Warteschlange und verschmelzen im Undo zu **einem** Schritt (`before` des ersten); `final:true` mit `urgent:true`. **(R4)** Nennt ein `text`-Intent eine ID, die das Modell nicht mehr hat, geht der Text in die Textrettung (`ui.onRescue`), statt still zu verschwinden.
- **(R4) Wohlgeformte Strings an der Quelle** (§6.4): `actions.setText` (Text-Intents), das Board-Titelfeld und das Gastnamen-Feld geben jeden String durch `wellFormed()`, bevor er in die Warteschlange bzw. in eine Anfrage geht. So gleicht das lokale Modell dem, was der Server speichert.
- **`reorder`:** `keysBetween(max, null, n)` bzw. `keysBetween(null, min, n)` in aktueller relativer Ordnung.
- **(R2) Textrettung** (getippter Text geht nie still verloren). `onAcks` wertet `replica.ack(...).failed` aus; für jede gescheiterte Op, deren patch den `textPathOf(type)` enthält (`bad`, `gone`, `locked`, `denied`, `limit`, **(R5)** `internal`):
  - Editor für dieses Objekt noch offen → `scene.setEditorNotice(id, <Hinweis>)`; Text bleibt im Editor.
  - Editor schon zu, Objekt existiert noch → `scene.openTextEditor(id, {text: <abgelehnter Wert>, notice: <Hinweis>})`, **(R4) aber nur, wenn gerade kein Editor offen ist** (kein normaler und kein Rettungs-Editor). Sonst geht der Text in die Dialogliste (nächster Punkt).
  - Objekt existiert nicht mehr → `ConfirmDialog` „Dieses Objekt wurde gelöscht. Dein Text:“ mit schreibgeschütztem Textfeld zum Kopieren.
  - **(R4) Mehrere Rettungen:** `ui.onRescue` hängt `{id, text}` (**(R5)** so gebaut: `{id, text, gone}`; reines Modul `components/rescue.js`, Dialog-Haken `[data-knorke-dialog=rescue]`) an eine **Liste** an (statt ein einziges Feld zu überschreiben). Der Kopier-Dialog zeigt jeden Text als eigenes schreibgeschütztes Feld, den neuesten zuletzt, und leert die Liste beim Schließen. Ein offener Editor (mit oder ohne Hinweis) wird **nie** durch einen Rettungs-Editor ersetzt; die Session ruft `scene.openTextEditor` nie, solange ein Editor offen ist. Vorher überlebte bei mehreren Rettungen auf einmal (eine Antwort oder zwei Antworten ≈ 150 ms nacheinander, etwa nach Offline-Bearbeitung) nur die letzte: Der neue Rettungs-Editor beendete den vorigen, und ein Editor mit Hinweis verwirft beim Beenden ohne Intent.
  - Hinweise ([C]-Texte): bei `locked` „Nicht gespeichert: {name} bearbeitet dieses Objekt. Text vor dem Schließen kopieren.“, sonst „Nicht gespeichert. Text vor dem Schließen kopieren.“
  - **(R5)** Ergebniscode `internal` (vom SyncClient nach U8 verworfen, §6.4) → zusätzlich Toast „A change could not be saved because of a server error.“ (de „Eine Änderung konnte wegen eines Serverfehlers nicht gespeichert werden.“, aus `handleFailed`); Text-Ops gehen wie `bad`/`gone` in die Textrettung (allgemeiner Hinweis).
  - Dasselbe gilt, wenn die Session für die eigene Editier-ID einen fremden Lease-Halter sieht (`presence.leaseHolder(id)`), und beim Wechsel in `gone`/`revoked`/`logged_out`/`rate_limited` **(R3)** **(R5)** /`reload`/`links_disabled` mit offenem Editor; ein Übernahme-Text geht dann in den Kopier-Dialog.
- **(R5) Ausnahmen aus `actions` (U19):** `onIntent` und die Shell-Aktionen `setFill`, `reorder`, `deleteSelection`, `undo`, `redo` laufen durch einen Wächter (`guard()`/`applyIntent`): Eine Ausnahme ergibt `console.error` und den Toast „This change could not be applied.“ (de „Diese Änderung konnte nicht ausgeführt werden.“); ein finaler Text-Intent mit Text geht zusätzlich an `ui.onRescue({id, text, gone: false})`. Vorher endete eine Ausnahme still in `reportAsync`.
- **Präsenz nach außen** (`getPresence`):
  - `c` = letzter Weltzeiger (`onPointer`), `s` = Auswahl (≤ 20), `d` = `onDragPreview` (≤ 20), `e` = Editier-ID; **(R3)** nach dem Schließen bleibt `e` die ID dieses Editors, bis dessen letzte Text-Op bestätigt oder verworfen ist (§4.11)
  - **(R2)** `tk: 1` genau einmal, nach `onEditing(id, true)` (Übernehmen)
  - Ansehen-Modus → `null`
- **Takt-Hinweise:** `sync.poke()` bei jeder Nutzeraktion; die Fremd-Ziehvorschau setzt `remoteDragging`; nach jedem `onPresence` `scene.presenceChanged()` **(R2)**.
- **Lebenszyklus:**
  - Status `gone`/`revoked`/`logged_out`/`rate_limited` **(R3)** → Szene bleibt sichtbar, `scene.setViewOnly(true)` **(R2)**; Banner.
  - **(R5, U15/CLIENT-7)** `FROZEN_STATUSES` = alle endgültigen Status = `['gone','revoked','logged_out','rate_limited','reload','links_disabled']`, gleich `FINAL_STATUSES`. Auch `reload` und `links_disabled` frieren also ein: `setViewOnly(true)`, Toolbar und ContextBar verborgen (BoardView liest `FROZEN_STATUSES`), offener Editor behält seinen Text mit Hinweis (`loseLease`), Übernahme-Text in den Kopier-Dialog; `onIntent`, `getPresence` und der `beforeunload`-Hinweis folgen dem eingefrorenen Zustand. Die frühere Ausnahme „außer `reload` (die Seite lädt neu)“ entfällt: Nach einem zweiten 409 oder einem abgebrochenen `beforeunload` blieb die Seite bei gestoppter Schleife bearbeitbar, und Änderungen stauten sich ungesendet.
  - **(R5)** `reloadOnce` lädt nur automatisch neu, wenn nichts auf dem Spiel steht (kein offener Editor, `pendingCount() === 0`, kein Übernahme-Text) und der `sessionStorage`-Marker noch nicht gesetzt ist; sonst bleibt der Banner mit „Reload“. Neu geladen wird über `util/reload.js` `hardReload(win)`: `fetch(src, {cache: 'reload'})` für die eigenen `js/*.mjs`-Skripte der App (Best Effort, ≤ 1,5 s), dann `location.replace(URL + '?knorke-reload=<Stempel>')`. `main.js` entfernt den Parameter beim Start per `history.replaceState`. Der Reload-Knopf des Banners nutzt `hardReload`. So kann ein veraltetes, gecachtes Bündel keine Schleife bilden. §6.4 „409 → reload; stop“ bleibt.
  - **(R4)** `visibilitychange` (hidden), `pagehide`, `beforeunload`: zuerst `scene.flushEditor()`, dann `flushKeepalive`/Kamera bzw. die Prüfung für den `beforeunload`-Hinweis (§6.4). Ein Editor mit ungespeichertem Text zählt für den Hinweis als ausstehend.
  - **(R4) Verlassen innerhalb der App** (Zurück-Knopf, Browser-Zurück/-Vor): siehe Verlassen-Sperre §6.6. Vorher lief `destroy()` mit **einem** Keepalive-Versuch, und alles, was dieser nicht zustellte (offline, im Backoff, mit veraltetem CSRF-Token oder bei zu großer Warteschlange), ging ohne Rückfrage verloren, obwohl der Offline-Banner „Änderungen bleiben erhalten“ sagt. Ausstehende Ops werden **nicht** über Seitenladen hinweg gespeichert (nicht in M0).
  - Die Kamera wird gedrosselt (1 s) in `localStorage['knorke.cam.'+boardId]` gespeichert.
  - Die Client-ID liegt in `sessionStorage['knorke.client.'+boardId]`.
  - **(R5, U18/CLIENT-10) Duplizierte Tabs:** Ein dupliziertes Tab erbt `sessionStorage` samt Client-ID; zwei lebende Tabs teilten sich dann einen Präsenz-Eintrag. `open()` startet deshalb zu Beginn, parallel zu Snapshot bzw. Beitritt, `claimClientId(id)` über `BroadcastChannel('knorke.client.<boardId>')` (derselbe String wie der Storage-Schlüssel; Gäste vor dem Beitritt `'knorke.client.link-<token>'`): Nachricht `{t:'claim', id, nonce}`; ein lebender Tab mit derselben ID antwortet `{t:'taken', id, nonce:<nonce des Anfragenden>}`, und der Anfragende nimmt eine neue `clientId()` und speichert sie im eigenen (geklonten) `sessionStorage`. Gleichzeitige Ansprüche: Die kleinere nonce behält die ID. Lauschzeit `CLAIM_MS = 200` (über `deps.sleep`); `open()` wartet darauf, bevor der SyncClient entsteht. Der Kanal bleibt die Sitzung über offen, um die ID zu verteidigen, und `destroy()` schließt ihn. Ohne `BroadcastChannel` gilt die gespeicherte ID sofort, wie bisher. Hinweis: Der Beitrittsbody des Gasts trägt noch die ID von vor dem Claim; der Server prüft sie nur, das ist harmlos.
  - **(R2)** Der Gast-Eintrag liegt in `localStorage['knorke.guest.'+boardId]` (§4.9.3).
  - Alle Storage-Zugriffe laufen in try/catch (`util/storage.js`).

**`actions.js`** (rein; nur Modell lesen, keine Seiteneffekte):

```js
export function createItem(model, { t, at, rect }, newId = ulid) {}        // → {ops, inverse, selectIds}
export function moveItems(model, { ids, dx, dy, origin }) {}               // → {ops, inverse}
export function deleteItems(model, ids) {}                                  // → {ops, inverse}
export function setText(model, { id, path, value, before }) {}              // → {ops, inverse}
export function setFill(model, ids, color) {}                               // → {ops, inverse}
export function reorder(model, ids, where) {}                               // → {ops, inverse}
```

**`undo.js`**

```js
export class UndoStack {
  constructor(limit = 50)
  push({ ops, inverse, mergeKey = null }) {}   // gleicher mergeKey wie oben → zusammenführen (Text-Sitzung)
  undo() {}  redo() {}                          // → ops | null (inverse bzw. ops); Session schickt sie als neue Ops
  canUndo() {}  canRedo() {}  clear() {}
}
```

Undo ist unbedingt (LWW). Scheitert eine Undo-Op (`bad`/`gone`), meldet ein Toast „Rückgängig nicht möglich“. **(R4)** `gone` auf einem **remove** gilt als Erfolg (idempotente Wiederholung, §4.6, etwa nach einem Keepalive, der das remove schon angewendet hat), nie als Scheitern eines Undo. Ein inzwischen gelöschter Eltern-Frame ist kein Scheitern mehr: Der Server hängt das Objekt an die Wurzel und erhält die absolute Lage (§4.7 Regel 6).

**`debug.js`:** installiert `window.__knorke` nur, wenn der Initial-State `debug === true` ist (§6.7).

### 6.6 Vue-Shell [C]

- **`main.js`:**
  - `import './styles/knorke.css'`
  - `page = loadState('knorke', 'page')`, dann `createApp(page === 'public' ? PublicApp : App)`
  - `app.config.globalProperties.t/n` = Wrapper aus `util/l10n.js` (Pulse-Port, `escape:false, sanitize:false`, ohne `v-html`)
  - `mount('#knorke-root')`
- **`App.vue`:**
  - Mini-Router (`router.js`: `parse(location.pathname)` → `{name:'list'}`, `{name:'board', id}` oder `{name:'join', token}`; `push(route)` über `history.pushState`; `popstate`).
  - Liste: `NcContent app-name="knorke"` mit `NcAppNavigation` („Alle Boards“, „Neues Board“) und `NcAppContent` mit `BoardList`.
  - Board: `NcContent` ohne Navigation, `NcAppContent` mit `BoardView`.
  - Join: `api.joinLink(token)` → `replace({name:'board', id})`; **(R2)** 403 `link_revoked` → `[data-knorke-banner=revoked]`, 404 → `[data-knorke-banner=invalid]`, App-429 → Meldung. **(R5)** 403 `links_disabled` → `joinState` `'disabled'` mit `[data-knorke-banner=links_disabled]`, endgültig, kein erneuter Versuch. Die Entscheidungen stehen im reinen Modul `src/components/join.js` (`guestJoinOutcome`, `accountJoinState`, `isLinksDisabled`, `shareView`); `statusOf()` bildet ein 403 `links_disabled` beim Öffnen auf `'links_disabled'` ab.
  - **(R5) Router (so gebaut, R4-Nachtrag):** `router.addLeaveGuard(fn)`; `push()` und `replace()` liefern `Promise<boolean>`. Ein einziger `popstate`-Handler fragt die Sperren vor jedem Routenwechsel. Abgelehnt: `push`/`replace` ändern nichts, `popstate` stellt die URL der gezeigten Route per `history.pushState` wieder her. Solange eine Sperre wartet, wird ein weiteres `push` ignoriert, bei `popstate` entscheidet die URL am Ende. Eine Sperre, die wirft, erlaubt die Navigation.
  - **(R4) Verlassen-Sperre:** Jeder Routenwechsel innerhalb der App **weg von einem Board** (`push`, `replace`, `popstate`) läuft zuerst durch eine Sperre im Router: `BoardView` ruft `session.prepareLeave({timeoutMs: 3000})` (§6.5): Editor flushen, bis ≈ 3 s auf einen normalen Sync warten. Liefert sie `false` (noch Ausstehendes), zeigt `BoardView` einen `ConfirmDialog` mit dem Quelltext „Some changes have not been saved yet. Leave anyway?“ und den Knöpfen „Stay“ und „Leave“ (`de.json`-Eintrag dazu).
    - „Stay“: bei `push`/`replace` nicht navigieren; bei `popstate` die Board-URL per `history.pushState` wiederherstellen und die Route behalten.
    - „Leave“: navigieren; `destroy()` läuft wie bisher.
    - Der Offline-Banner-Text bleibt; mit der Sperre stimmt er jetzt.
- **`PublicApp.vue`:**
  - **(R2)** `linkState === 'revoked'` → `NcEmptyContent` „Dieser Link wurde zurückgezogen“ (`[data-knorke-banner=revoked]`); `linkState === 'invalid'` → „Dieser Link ist ungültig“ (`[data-knorke-banner=invalid]`). In beiden Fällen kein Beitritt.
  - Gespeicherter Gast für dieses Board (`localStorage['knorke.guest.'+boardId]`) → stiller Beitritt mit dem aktuellen `linkToken` und dem alten Token als `guest`. Antwortet der Beitritt 404, wird der Eintrag gelöscht und der Namensdialog gezeigt; 403 `link_revoked` → Zustand „zurückgezogen“.
  - Sonst `GuestNameDialog` (NcDialog + NcTextField, `maxlength=40`, Pflicht) → `BoardView mode=guest`.
  - **(R5)** Beitritt 403 `links_disabled` → Endzustand `'disabled'`: `NcEmptyContent` „Link sharing is disabled“ mit `[data-knorke-banner=links_disabled]`, kein erneuter Versuch.
  - **(R5, U20)** App-429 beim Gastbeitritt: „Too many people joined from here in a short time. Please wait a moment, or ask the person who shared the board for a new link.“ (de „…Bitte warte einen Moment oder bitte die Person, die das Board geteilt hat, um einen neuen Link.“).
  - **(R5, U9/NC-4) Rechtslinks:** Der NC-Footer bleibt verborgen (F7). Aus dem Initial-State `legal` zeigt die App Impressum und Datenschutzerklärung selbst (`LegalLinks.vue`, `nav[data-knorke=legal]`, Links `[data-knorke-legal=imprint|privacy]`, `target=_blank`, `rel="noopener noreferrer"`, Impressum zuerst, nur konfigurierte): im Namensdialog unter dem Feld, unter den leeren Zuständen (`revoked`/`invalid`/`disabled`, auf einer lesbaren Pille über dem Theming-Hintergrund) und im Menü der Gast-TopBar (`NcActions` `[data-knorke=guest-menu]` mit `NcActionLink`, das `rel="nofollow noreferrer noopener"` setzt; nur sichtbar, wenn Links da sind). `components/legal.js` `httpUrl()` filtert erneut: nur absolute http(s)-URLs mit Host, ohne Leerraum und Steuerzeichen, ≤ 2048 Zeichen.
  - **(R5) Nebenbefund:** `NcDialog` zeigt `message` nicht, wenn der Default-Slot Inhalt hat. Der Erklärsatz des Namensdialogs („Choose a name. Others on this board will see it next to your cursor.“) steht deshalb jetzt im Slot.
- **`views/BoardList.vue`:** Liste mit Titel, Besitzer (wenn nicht ich), relativer Zeit (`Intl.RelativeTimeFormat`) und Aktionen (`NcActions`: Umbenennen, Löschen nur für den Besitzer). Leerer Zustand → `NcEmptyContent`. „Neues Board“ öffnet einen Dialog → `createBoard` → `push(board)`.
  - **(R5, U14/NC-7) Barrierefreiheit:** Jede Zeile bleibt ein schlichtes `<li>` (Listenpunkt, ohne `role`/`tabindex`/`aria-label`; `[data-knorke-board=<id>]` bleibt daran). Titel, Meta und Icon liegen in `<a class="knorke-list__link" href="<Board-URL>">` ohne `aria-label`, damit der Name Besitzer und Zeit enthält. Ein normaler Linksklick öffnet in der App (`preventDefault`); mit Modifikator oder Mittelklick übernimmt der Browser. `NcActions` ist Geschwister des Links. Der Link füllt die Zeile bis zu den Aktionen, ein Klick in die Zeilenmitte öffnet also weiter das Board; Hover/Fokus-Hintergrund an der Zeile, `focus-visible`-Umriss am Link.
- **`views/BoardView.vue`:**
  - Template: `<div class="knorke-board"><div ref="host" class="knorke-canvas"/>` plus `TopBar`, `Toolbar` (nicht bei viewOnly), `ContextBar` (bei Auswahl, fest oben mittig), `ZoomControls` (unten rechts), `PresenceBar`, `ConnectionBanner`.
  - `onMounted`: `session.value = markRaw(new BoardSession({container: host.value, …}))` → `await session.value.open()`.
  - `onBeforeUnmount`: `session.value?.destroy()`.
  - Reaktiv sind nur kleine Zustände per `ref`: Status, Auswahl-Kurzinfo, Teilnehmer, Zoom-% (≤ 10 Hz), Werkzeug, Undo/Redo-Verfügbarkeit, Board-Metadaten.
- **Komponenten:**
  - `TopBar` (zurück, Titel mit Inline-Umbenennen für den Besitzer, Teilen-Knopf für den Besitzer, `PresenceBar`). **(R5, U14)** Für den Besitzer enthält `<h2>` einen `<button type="button" class="knorke-topbar__rename-trigger" aria-label="Rename board: {title}" title="Rename board" data-knorke-action="rename-board">` (de „Board umbenennen: {title}“); für alle anderen ist der Titel ein schlichtes `<h2 :title>`, nie fokussierbar. Nach Enter (Commit) oder Esc (Abbruch) kehrt der Fokus zum Knopf zurück; ein Commit per Blur nimmt den Fokus nicht. CSS setzt Nextclouds globale Knopf-Stile mit `!important` zurück. Gäste bekommen das Rechtslink-Menü (oben).
  - `Toolbar` (Werkzeuge + Undo/Redo, linke Leiste)
  - `ContextBar` (Farbpalette, nach vorn, nach hinten, löschen)
  - `ZoomControls` (−, %, +, alles zeigen)
  - `PresenceBar` (Initialen-Kreise in pid-Farbe, Gäste markiert; **kein NcAvatar**, das zieht Lazy-Chunks und NcProfileHoverCard nach)
  - `ShareDialog`: Link an/aus, URL kopieren (`navigator.clipboard`, nur im Secure Context; sonst URL-Feld markieren), „Neuen Link erzeugen“ mit Warnung „Der alte Link und alle, die über ihn beigetreten sind, verlieren den Zugriff“. **(R5, U12)** Prop `view` = `'on'|'off'|'disabled'` (BoardView: `shareView(board)`). `'disabled'` (bei `board.linksAllowed === false` oder nach 403 `links_disabled` auf enable/rotate, das dann `board.linksAllowed = false` setzt statt des allgemeinen Fehler-Toasts) zeigt „Link sharing is disabled by your administrator.“ (`[data-knorke-banner=links_disabled]`, `role=status`), ohne URL, Kopieren, Erzeugen oder Erneuern. Ein behaltener Link lässt sich weiter abschalten (`[data-knorke-action=link-toggle]`), mit dem Text „The existing edit link does not work while link sharing is disabled.“
  - `GuestNameDialog`, `ConnectionBanner`, `ConfirmDialog`
  - `icons.js`: rund 14 MDI-Pfadstrings (Apache-2.0, im README vermerkt), gerendert mit `NcIconSvgWrapper :path`. Kein `@mdi/js` als Abhängigkeit.
- **@nextcloud/vue 9:**
  - Komponenten einzeln importieren (`@nextcloud/vue/components/NcButton`).
  - v9-API: `variant` statt `type`, `modelValue`, `v-model:open`, `noClose`.
  - **Kein `@nextcloud/dialogs`** (+ 280 KB); Toasts über `util/toast.js` (Pulse-Port).
- **Gerät:** `util/device.js` `isViewOnlyDevice()` = `!matchMedia('(any-pointer: fine)').matches`. Banner „Nur ansehen auf diesem Gerät“.
- **CSS** (`styles/knorke.css`):
  - Rollen-Tokens `--knorke-*` mit Bindung an NC-`--color-*` (je ein Fallback).
  - Wurzel: `#knorke-root { flex: 1 1 auto; width: 100%; min-width: 0; display: flex }` (NC-`#content` ist eine Zeilen-Flexbox); **(R3)** `#knorke-root > #content-vue` (NcContent) ist ebenfalls gestrecktes Flex-Element mit `height: 100%`.
  - **(R3) Höhe über eine 100-%-Kette statt einer Formel:** `.knorke-board { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden }`. `#content` hat in jedem Layout eine feste Höhe (`var(--body-height)`), und alles zwischen ihm und dem Board ist gestrecktes Flex-Element oder 100 % hoch. Die frühere Formel `calc(100svh − Kopfzeile − 2 × Rand)` war gemessen falsch: auf NC 34 und 35 um 8 px zu kurz (`#content` hat nur unten einen Rand), in `RENDER_AS_BASE` ganz falsch. Gemessen ohne Seiten-Scroll und mit Board = `#content` (1424×842 auf NC 34, 1424×848 auf NC 35) auf der Board-Seite, der Gastseite (`RENDER_AS_PUBLIC`) und der Gastseite mit `public_template = base`, je bei 1440×900 und 390×844. In `RENDER_AS_BASE` lässt NC oben ein leeres Band von 50 px (`#content` behält `margin-top` = Kopfzeilenhöhe); das ist nur kosmetisch und betrifft nur den Messmodus E12. **(R2)** Die Gastseite muss in beiden Template-Modi passen (`RENDER_AS_PUBLIC` Vorgabe, `RENDER_AS_BASE` per App-Config `public_template = base` für die Messung E12): ohne doppelte Scrollbalken, ohne abgeschnittenen Rand.
  - `.knorke-canvas { touch-action: none; overscroll-behavior: none; background: var(--knorke-board-bg) }`.
  - Die Leinwand bleibt hell, auch im NC-Dunkelmodus; die Bedienelemente folgen dem NC-Thema.
  - Overlay-DOM (Cursor, Editor) bekommt **nicht gescopte** Styles (die Klassen beginnen mit `knorke-`).
  - Auf der Gastseite wird `footer.guest-box` über `body#body-public .guest-box { display:none }` verborgen. **(R5)** Begründung: Die App zeigt die Rechtslinks der Instanz selbst (Initial-State `legal`, oben); sonst wären Impressum und Datenschutz auf der Gastseite nicht erreichbar (NC-4).
- **Initial-State** (gesetzt von [B], gelesen von [C]):

| Schlüssel | Seiten | Typ |
|---|---|---|
| `page` | alle | `'user'` \| `'public'` |
| `boardId` | `/b/{id}`; **(R2)** `/p/{token}` bei aktivem Link | int \| null |
| `joinToken` | `/join/{token}` | string \| null |
| `linkToken` | `/p/{token}` | string \| null |
| `linkState` | `/p/{token}` | **(R2)** `'ok'` \| `'revoked'` \| `'invalid'` \| null (ersetzt `linkValid`) |
| `debug` | alle | bool = `IConfig::getSystemValueBool('knorke_dev', false)` |
| `protocol` | alle | int (`Application::PROTOCOL`) |
| `limits` | alle | `{maxText, maxTitle, maxOps, nameMax, maxItemBytes}` |
| `legal` | **(R5)** `/p/{token}` (jeder `linkState`) | `{imprintUrl: string, privacyUrl: string}` aus Theming (`imprintUrl`/`privacyUrl` über `IAppConfig::getValueString('theming', …, '')`, jede Ausnahme → `''`); `''` = nicht gesetzt oder keine absolute http(s)-URL (`PublicPageController::httpUrl()`: getrimmt, nur http/https mit Host, ≤ 2048 Byte, ohne Leerraum und Steuerzeichen; `javascript:`, `data:`, relative URLs, `//host`, `mailto:`, `ftp:` → `''`). Auf Nutzerseiten `null` |

**(R5)** `PageController::INITIAL_STATE_KEYS = ['page', 'boardId', 'joinToken', 'linkToken', 'linkState', 'debug', 'protocol', 'limits', 'legal'];` (weiter eine Zeile; `legal` am Ende, gleich `STATE_KEYS` in `src/util/state.js`) ersetzt die bisherige Zeile ohne `legal` und ist die einzige Liste; `PublicPageController` benutzt sie mit. Jede Seite setzt **alle** Schlüssel (nicht zutreffende als `null`). **(R3) Falle:** `IInitialState::provideInitialState` verwirft ein nacktes PHP-`null` still (NC 34/35: `is_scalar(null)` ist falsch, es gibt nur eine Log-Warnung), und `loadState()` würfe dann. `PageController::provideState()` übergibt `null` deshalb als `JsonSerializable`, das zu `null` kodiert.

### 6.7 Debug-Haken `window.__knorke` (nur bei `debug`) [C, nutzt `scene.stats()` von S]

```js
window.__knorke = {
  version, state(),          // → {boardId, mode, cursor, status, pid, role, viewOnly, pending, inflight}
  items(),                   // (R2) → string[]: itemKey(item) je sichtbarem Objekt (inkl. id), nach id sortiert
  confirmed(),               // → string[] wie items(), aus dem bestätigten Zustand
  serverItems(),             // (R2) → Promise<string[]>: frischer Snapshot über den Transport der Sitzung, gleiche
                             //      Kanonisierung (itemKey aus src/model/paths.js); zählt NICHT in counters()
  scene(),                   // → scene.stats()
  camera(), presence(),      // → bestätigte Kamera, letzte RemoteSample[]
  itemScreenRect(id),        // → {x,y,w,h} in Client-Koordinaten (für page.mouse) oder null
  worldToScreen(x, y),       // (R2) → {x, y} in Client-Koordinaten
  waitIdle(timeoutMs = 10000),   // → Promise: keine ausstehenden Ops, nichts in Arbeit, danach ein vollständiger Takt;
                                 //   (R3) erzwingt einen Takt nur, wenn keine Anfrage offen ist (sonst kettet sich jede
                                 //   Anfrage an die vorige, und es wird nie ruhig); wirft, wenn der Sync gestoppt ist
  debug: { setCursor(n), forceTick() },   // (R3) setCursor: Antworten auf Anfragen, die vor dem Aufruf begannen,
                                          //   verschieben den Cursor nicht mehr (E08a)
  counters()                 // → {syncRequests, snapshotRequests, resyncs, bytesIn}
}
```

### 6.8 Test-Haken im DOM (R2, verbindlich für [C] und [S])

[D] bedient die UI, ohne sie zu sehen. Diese Attribute sind deshalb Teil des Vertrags; E2E prüft **Attribute und `state()`**, Texte nur in Ausnahmefällen und dann die englischen Quelltexte.

| Selektor | Besitzer | Element |
|---|---|---|
| `[data-knorke=board-list]` | [C] | Liste der Boards |
| `[data-knorke-board=<id>]` | [C] | Zeile/Kachel eines Boards (Klick öffnet); **(R5)** bleibt am `<li>`, ein Klick in seine Mitte trifft den Board-Link |
| `[data-knorke-action=new-board\|rename\|delete\|confirm\|share\|link-toggle\|link-rotate\|guest-join\|back]` | [C] | Knöpfe; `confirm` ist der bestätigende Knopf jedes `ConfirmDialog` |
| `[data-knorke-action=rename-board]` | [C] | **(R5, additiv)** Umbenennen-Knopf im Titel der TopBar (nur Besitzer) |
| `[data-knorke=guest-menu]` | [C] | **(R5, additiv)** Menü der Gast-TopBar mit den Rechtslinks (nur, wenn welche konfiguriert sind) |
| `[data-knorke=legal]`, `[data-knorke-legal=imprint\|privacy]` | [C] | **(R5, additiv)** Rechtslinks der Gastseite (Namensdialog, leere Zustände) bzw. ein einzelner Link |
| `[data-knorke-field=title\|guest-name\|link-url]` | [C] | Eingabefelder (`link-url` schreibgeschützt, enthält die volle URL) |
| `[data-knorke-banner=offline\|gone\|revoked\|invalid\|logged_out\|viewonly\|reload\|rate_limited\|links_disabled]` | [C] | sichtbarer Zustandshinweis (Banner bzw. leerer Zustand der Gastseite); **(R3)** `rate_limited` = App-429 auf `/sync` (§6.4); **(R5, additiv)** `links_disabled`: Gast-Leerzustand, Join-Seite, Hinweis im Teilen-Dialog und Banner im Board (§4.9.7) |
| `[data-knorke-toolbar]` | [C] | Werkzeugleiste (fehlt im Ansehen-Modus) |
| `[data-knorke-tool=select\|hand\|sticky\|frame]` | [C] | Werkzeugknöpfe, aktiver mit `aria-pressed="true"` |
| `[data-knorke-fill=#rrggbb]` | [C] | Farbknöpfe der Kontextleiste (Kleinbuchstaben) |
| `[data-knorke-cursor=<key>]` mit Kind `.knorke-cursor-name` | [S] | fremder Cursor, `key` = Präsenzschlüssel `<pid>:<client>` |
| `[data-knorke-editing=<itemId>]` | [S] | Chip „X bearbeitet …“ am Objekt |
| `[data-knorke-action=take-over]` | [S] | Übernehmen-Aktion im Chip (nur nach Doppelklick auf ein gesperrtes Objekt) |
| `textarea[data-knorke-editor]` | [S] | offener Text-Editor; `data-knorke-editor-state="locked"`, wenn ein Hinweis gesetzt ist |
| `[data-knorke-dialog=leave]` | [C] | **(R4, optional, additiv)** `ConfirmDialog` der Verlassen-Sperre (§6.6); „Leave“ ist sein `[data-knorke-action=confirm]`. Pflicht erst, wenn [D] den Dialog im E2E gezielt anspricht. **(R5)** E13 spricht ihn an, damit ist er Pflicht. „Stay“ ist der Abbrechen-Knopf und hat keinen Aktions-Haken (E13 findet ihn über die Rolle und den Text „Stay“) |
| `[data-knorke-dialog=rescue]` | [C] | **(R5, additiv, R4-Nachtrag)** Kopier-Dialog der Textrettung mit je einem schreibgeschützten Feld je Text (§6.5) |

**Sprache im E2E:** `dev/up.sh` setzt für alice und bob `core lang en`, und jeder Browser-Kontext läuft mit `locale: 'en-US'`. Geprüfte Texte sind damit die englischen Quelltexte.

### 6.9 UI-Texte außerhalb von [C] (R2)

`l10n/de.json` gehört [C]. Damit `l10n:check` nicht von anderen Paketen abhängt, sind die einzigen Quelltexte, die [S] benutzen darf, hier aufgezählt; [C] trägt sie in Phase 0 in `de.json` ein:

| Quelltext | Deutsch | Wo |
|---|---|---|
| `{name} is editing…` | `{name} bearbeitet …` | Editier-Chip |
| `Take over` | `Übernehmen` | Aktion im Chip |
| `{name} (guest)` | `{name} (Gast)` | Namensschild am Cursor eines Gastes |
| `Unknown item type: {type}` | `Unbekannter Objekttyp: {type}` | Platzhalter (Konva-Text) |

- [S] importiert `t` **nur** aus `src/util/l10n.js` ([C], Phase 0; `escape: false, sanitize: false`) und rendert ausschließlich über `textContent` bzw. Konva-Text. Direkter Import von `@nextcloud/l10n` ist verboten (Vorgabe `escape: true` machte aus „Tom & Jerry“ „Tom &amp; Jerry“).
- **(R3) Aufrufform** (Pulse-Port): `t('knorke', text, vars)` und `n('knorke', singular, plural, count, vars)`. Die App-ID steht immer ausgeschrieben; die Kurzform `t('…')` in dieser Spezifikation meint nie einen Aufruf ohne App-ID. `l10n-check.mjs` erkennt genau diese Form und zählt die vier Texte oben als benutzt, damit es nicht von [S] abhängt.
- Im Szenen-Labor darf `src/util/l10n.js` per Vite-Alias durch einen Identitäts-Stub ersetzt werden; **(R3)** er hat dieselbe Signatur und füllt `{Platzhalter}` ein.
- [B] hat keine übersetzten Texte.

---

## 7. Build und Bündelung [C]

### 7.1 `package.json`

```json
{
  "name": "knorke",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "engines": { "node": "^22.18.0", "npm": "^10.9.0" },
  "browserslist": ["extends @nextcloud/browserslist-config"],
  "scripts": {
    "build": "node node_modules/vite/bin/vite.js --mode production build && node build/check-bundle.mjs",
    "build:nocheck": "node node_modules/vite/bin/vite.js --mode production build",
    "dev": "node node_modules/vite/bin/vite.js --mode development build",
    "watch": "node node_modules/vite/bin/vite.js --mode development build --watch",
    "test": "node --test 'tests/js/**/*.test.mjs'",
    "l10n:build": "node build/l10n-build.mjs",
    "l10n:check": "node build/l10n-check.mjs"
  },
  "dependencies": {
    "@nextcloud/auth": "2.6.0",
    "@nextcloud/initial-state": "3.0.0",
    "@nextcloud/l10n": "3.4.1",
    "@nextcloud/router": "3.2.0",
    "@nextcloud/vue": "9.13.1",
    "fractional-indexing": "4.0.0",
    "konva": "10.7.1",
    "rbush": "4.0.1",
    "vue": "3.5.43"
  },
  "devDependencies": {
    "@nextcloud/browserslist-config": "3.1.2",
    "@nextcloud/vite-config": "2.5.4",
    "browserslist": "^4.26.3",
    "sass": "1.105.1",
    "typescript": "^6.0.3",
    "vite": "7.3.7"
  }
}
```

- `package-lock.json` wird eingecheckt; Installation mit `npm ci`.
- **(R3) Lockfile-Falle:** Ein schlichtes `npm install` (npm 10.9.3) löst `@nextcloud/files` zu 3.12.2 auf. Das verletzt den optionalen Peer `^4.1.0` von @nextcloud/vue 9.13.1, und `npm ci` verwirft das Lockfile danach („lock file's @nextcloud/files@3.12.2 does not satisfy @nextcloud/files@4.1.0“). Das eingecheckte Lockfile enthält deshalb `@nextcloud/files` 4.1.0, nur im Lock, `package.json` bleibt unverändert. Wer das Lockfile neu erzeugt, muss das wiederholen; `--package-lock-only` ergibt ebenfalls ein kaputtes Lock.
- **`typescript` ^6.0.3 ist Pflicht**, sonst installiert npm 7.0.2 als Peer, und das Laden der Konfiguration bricht ab (`useCaseSensitiveFileNames`).
- **Kein `vite` 8** und kein vite-config 3 (Beta).
- **Kein `sass-embedded`.**
- Kein `@nextcloud/axios` (eigener `fetch`-Wrapper reicht), kein `@nextcloud/dialogs`, kein `vue-router`, keine ULID-Bibliothek.
- Lizenzen der Bundle-Inhalte (für das README): Konva MIT, rbush MIT, quickselect ISC, fractional-indexing CC0-1.0, Vue MIT, @nextcloud/* AGPL/GPL.
- **(R2) Geprüft** (Registry und Probe-Build, Node 22.18, npm 10.9.3): Alle gepinnten Versionen existieren; die Peers `@nextcloud/dialogs`/`@nextcloud/files` von @nextcloud/vue 9 sind optional; `npm run build` ergibt genau `js/knorke-main.mjs`, `js/vendor-<hash>.chunk.mjs`, `js/canvas-<hash>.chunk.mjs`, `css/knorke-style.css`. esbuild läuft vom Share (`app_storage/appdata` ist ZFS mit `exec=on`), ein `chmod` ist nicht nötig. `npm ci` meldet nur `EBADENGINE` (rollup-plugin-node-externals 9.0.1 will Node ≥ 24); der Build ist davon nicht betroffen.
- **(R2) Testbefehle:** `node --test` mit einem **Verzeichnis** als Argument scheitert auf Node 22.18 (`Cannot find module '…/tests/js'`, 0 echte Tests). Deshalb immer **in Anführungszeichen gesetzte Globs**, die Node 22 selbst auflöst: alle `node --test 'tests/js/**/*.test.mjs'`; nur [S] `node --test 'tests/js/model/*.test.mjs' 'tests/js/scene/*.test.mjs'`; nur [C] `node --test 'tests/js/{sync,board,shell}/*.test.mjs'`. Nie ein nacktes `node --test` (dessen Vorgabemuster greifen auch andere `test*`-Dateien).

### 7.2 `vite.config.js`

```js
/** SPDX-FileCopyrightText: 2026 hotochan123
 *  SPDX-License-Identifier: AGPL-3.0-or-later */
import { createAppConfig } from '@nextcloud/vite-config'
import { join, resolve } from 'node:path'

export default createAppConfig({ main: resolve(join('src', 'main.js')) }, {
	appName: 'knorke',                         // (R2) sonst aus appinfo/info.xml bzw. npm_package_name → ohne info.xml "undefined-main.mjs"
	nodePolyfills: false,
	config: {
		resolve: { dedupe: ['vue'] },
		build: {
			cssCodeSplit: false,               // genau eine CSS-Datei: css/knorke-style.css
			chunkSizeWarningLimit: 1500,
			rollupOptions: {
				output: {
					manualChunks: (id) => {
						if (/[\\/]node_modules[\\/](konva|rbush|quickselect|fractional-indexing)[\\/]/.test(id)) return 'canvas'
						if (/[\\/]node_modules[\\/]/.test(id)) return 'vendor'   // auch Lazy-Importe von @nextcloud/vue → keine Lazy-Chunks
					},
				},
			},
		},
	},
})
```

### 7.3 Ausgabe und Einbindung

- Die Ausgabe landet im App-Wurzelverzeichnis:
  - `js/knorke-main.mjs` (Einstieg), `js/vendor-<hash>.chunk.mjs`, `js/canvas-<hash>.chunk.mjs`
  - `css/knorke-style.css`
  - dazu `.map` und REUSE-`.license`-Dateien
- `EmptyJSDir` leert `js/` bei jedem Build.
- `templates/main.php` und `templates/public.php` [B]:

```php
<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

\OCP\Util::addScript('knorke', 'knorke-main');   // lädt .mjs als Modul + Import-Map, dazu l10n/<lang>.js automatisch
\OCP\Util::addStyle('knorke', 'knorke-style');
?>
<div id="knorke-root"></div>
```

- **Cache-Falle:** JS-URLs tragen `?v=<serverHash>-<theming cachebuster>`, **ohne** die App-Version, und `.htaccess` liefert sie als `immutable` aus. Nach jedem Frontend-Build heißt es deshalb `dev/bust.sh` (Cachebuster +1); sonst fordern gecachte Einstiege gelöschte Chunks an und bekommen 404.

### 7.4 `build/check-bundle.mjs`

Läuft nach jedem `npm run build` und bricht mit Exit 1 ab, wenn:
- in `js/` andere `.mjs`-Dateien liegen als genau `knorke-main.mjs`, eine `vendor-*.chunk.mjs` und eine `canvas-*.chunk.mjs`
- `css/knorke-style.css` fehlt
- `canvas` mehr als `konva/lib/Core` plus Rect/Text/Line enthält. Prüfung: Keiner der Klassennamen-Strings `"Ellipse"`, `"Arrow"`, `"Star"`, `"Wedge"`, `"RegularPolygon"` steht im Chunk-Text. `"Transformer"` und `Filters` taugen nicht als Marker, weil sie schon in Konva-Core vorkommen (geprüft in `konva/lib/Layer.js`, `Stage.js`, `Node.js`).
- die Summe der drei JS-Dateien gzip -9 über **350 KiB** liegt

Dazu gibt das Skript die Größen aus. Eigene Assets für eine kalte Board-Seite: **3 JS + 1 CSS (+ 1 l10n nur für deutsche Nutzer)**, dazu genau ein Snapshot bzw. Beitritt vor dem ersten Sync. Seiten-HTML und App-Icons zählen getrennt. Der Rest der 91 Anfragen gehört NC und anderen Apps; gemessen und berichtet wird das in E12 (§8.2).

### 7.5 Node-Befehle (ohne `.bin`)

```
npm ci                                  # nur [C], nur Phase 0; Postinstall-Skripte laufen über node
dev/build.sh                            # (R2) = flock + npm run build + bust aller laufenden Dev-Namensräume
npm run build                           # = node node_modules/vite/bin/vite.js --mode production build + check (ohne Sperre)
npm test                                # = node --test 'tests/js/**/*.test.mjs'
npm run l10n:build && npm run l10n:check
node build/check-bundle.mjs
```

- `@nextcloud/vite-config` liest `appinfo/info.xml` (Regex auf `<version>` **und** `<id>`); fehlt **(R3)** eines der beiden, wirft die Konfiguration (2.5.4 prüft die Treffer nicht). Gibt es gar keine `info.xml`, baut sie (Version aus `npm_package_version`). Die Suche läuft auch in Elternverzeichnisse hoch. [B] liefert `info.xml` deshalb in Phase 0 mit beiden Elementen.

---

## 8. Dev-Stack, E2E und Vertragstests [D]

### 8.1 `dev/up.sh` / `dev/down.sh`

Grundlage ist `knorke-spike/poll/setup.sh` bzw. `teardown.sh`. Gemeinsame Funktionen stehen in `dev/lib.sh`.

**(R2) Namensräume.** Vier Agenten arbeiten gleichzeitig; ohne Trennung zerstörte ein `down.sh` die Stacks der anderen. Jeder Aufruf aller `dev/*.sh` (und von `tests/php/run.sh`, `dev/sim/run.sh`, `dev/e2e/run.sh`) gilt für genau einen Namensraum `KD_NS` (`^[a-z]{1,8}$`, Vorgabe `main`):

| `KD_NS` | Benutzer | Port (`KD_PORT`-Vorgabe) |
|---|---|---|
| `main` | gemeinsame Abnahme (Phase 0 und Phase 2) | 18580 |
| `b` | [B] Integrationstests, `tests/php/smoke.sh` | 18581 |
| `c` | [C] Durchklicken | 18582 |
| `d` | [D] Selbsttest, sim, e2e während Phase 1 | 18583 |

**(R5)** Namensräume außerhalb dieser Tabelle brauchen `KD_PORT`.

| Element | Wert |
|---|---|
| Netze **(R5)** | **zwei** Netze, beide mit Label `knorke=dev-$NS`: `knorke-dev-$NS-net` (vorn: NC und E2E-Browser, publiziert `127.0.0.1:$KD_PORT`) und `knorke-dev-$NS-back` (`docker network create --internal`: nur DB, Redis und NC). NC wird im vorderen Netz angelegt (`docker create`), per `docker network connect` an das hintere angeschlossen und erst dann gestartet. DB und Redis hängen **nur** am hinteren Netz (OPS-5) |
| Container | `knorke-dev-$NS-db` (`postgres:17-alpine`, `postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=top`), `knorke-dev-$NS-redis` (`redis:7-alpine`), `knorke-dev-$NS-nc` (`${KD_NC_IMAGE:-nextcloud:34-apache}`; NC 35: `KD_NC_IMAGE=nextcloud:35.0.1-apache`); alle mit Label `knorke=dev-$NS`. **(R5)** DB je `KD_DB`: `postgres:17-alpine` wie oben \| `mariadb:11.8` \| `mysql:8.4` (beide mit `--transaction-isolation=READ-COMMITTED`) \| bei `sqlite` kein DB-Container. Redis mit `requirepass` = erzeugtes 32-Zeichen-Passwort, übergeben als `REDISCLI_AUTH` in der Umgebung des Redis-Containers (`sh -c 'exec docker-entrypoint.sh redis-server --requirepass "$REDISCLI_AUTH"'`); so authentisiert sich jedes `docker exec <redis> redis-cli …` selbst, und kein Passwort steht auf einer Befehlszeile. NC trägt das Label `knorke.db=<kind>` |
| Port | nur NC: `127.0.0.1:${KD_PORT}:80` |
| CPU | `--cpus ${KD_NC_CPUS:-4}` (0 = keine Grenze) |
| NC-Umgebung | `POSTGRES_*`, `REDIS_HOST=knorke-dev-$NS-redis`, `REDIS_HOST_PORT=6379`, `NEXTCLOUD_ADMIN_USER=admin`, `NEXTCLOUD_ADMIN_PASSWORD=<rnd>`, `NEXTCLOUD_TRUSTED_DOMAINS="localhost knorke-dev-$NS-nc"`, `PHP_MEMORY_LIMIT=1024M`. **(R5)** Dazu `REDIS_HOST_PASSWORD` (das Image trägt es in `config.php` und den PHP-Session-Handler ein); statt `POSTGRES_*` je `KD_DB` `MYSQL_HOST`/`MYSQL_DATABASE`/`MYSQL_USER`/`MYSQL_PASSWORD` bzw. `SQLITE_DATABASE=nextcloud` |
| Mounts | `${KD_APP_DIR:-$ROOT}:/var/www/html/custom_apps/knorke:ro` (**custom_apps**, nicht apps: `rsync --delete` des Entrypoints) und `$ROOT/dev/php/zz-knorke-dev.ini:/usr/local/etc/php/conf.d/zz-knorke-dev.ini:ro` mit `opcache.revalidate_freq=0` (das Image setzt 60) |
| Zustand | `dev/.state/$NS/` (`env.json`, Passwörter), `chmod 700` |
| Optional | `KD_PROD_APPS=1`: Prod-Apps read-only wie im Spike (für den Lastlauf in M1; Vorgabe 0) |
| **(R2)** Schalter | `KD_APP_DIR` (Vorgabe `$ROOT`; für den Alleintest von [D] `dev/selftest/placeholder`; **(R3)** verweigert jeden Pfad unter `stacks/nextcloud`), `KD_SKIP_BUILD_CHECK=1` (kein Abbruch ohne `js/knorke-main.mjs`), **(R3)** `KD_DNS` (Vorgabe damals der Router des LANs, seit Factory-Job 036 leer und auf dem Host aus `dev/local.env`, ENTWICKLUNG §3.10; leer = Docker-Vorgabe; nur am NC-Container, gegen die Pi-hole-Langsamkeit). **(R5)** `KD_DB` = `pgsql` (Vorgabe, unverändert) \| `mariadb` \| `mysql` \| `sqlite`; `KD_DB_IMAGE` (Vorgabe je Art: `postgres:17-alpine`, `mariadb:11.8`, `mysql:8.4`; bei `sqlite` verweigert); `KD_MYSQL_UTF8MB4` = `1` (Vorgabe) \| `0`, `0` nur mit `mariadb`/`mysql`: setzt nach der Installation und **vor** `app:enable knorke` `occ config:system:set mysql.utf8mb4 --type=boolean --value=false`, die Knorke-Tabellen werden damit `utf8mb3_bin`, der Verbindungszeichensatz `utf8` (Altinstallation ohne 4-Byte-Text, §3) |

`up.sh` läuft in dieser Reihenfolge, mit `set -euo pipefail`:
1. Verweigern, wenn Netz oder Container **dieses Namensraums** schon existieren, und wenn `$KD_APP_DIR/js/knorke-main.mjs` fehlt (außer `KD_SKIP_BUILD_CHECK=1` oder Platzhalter-App; Hinweis: `dev/build.sh`). **(R5)** Vor allem anderen: ungültiges `KD_DB`/`KD_MYSQL_UTF8MB4`/`KD_DB_IMAGE` verweigern; ebenso ein schon vorhandenes `knorke-dev-$NS-back`.
2. `mkdir -p dev/.state/$NS && chmod 700`, `umask 077`.
3. `rnd()` ohne SIGPIPE-Falle: `s="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "$1" || true)"`, danach die Länge prüfen.
4. Netz, PG (warten mit `pg_isready`, 60 s), Redis, NC starten; warten bis `curl -H 'Host: localhost' http://127.0.0.1:$PORT/status.php` `"installed":true` meldet (240 s). **(R5)** Beide Netze (Reihenfolge NC: anlegen, `network connect`, starten). DB-Bereitschaft über eine TCP-Anfrage (`pg_isready -h 127.0.0.1` bzw. `mariadb`/`mysql -h 127.0.0.1 … SELECT 1`; 120 s), weil die Init-Server von MariaDB/MySQL nur am Socket lauschen.
5. occ:
   - `config:system:set has_internet_connection --value=false --type=boolean`
   - `config:system:set appstoreenabled --value=false --type=boolean`
   - `background:cron`
   - `config:system:set skeletondirectory --value=''`, `templatedirectory --value=''`
   - `config:system:set knorke_dev --value=true --type=boolean` (Schutzmarke für Integrationstests und den Debug-Haken)
   - `app:disable firstrunwizard`
   - **(R5)** nur bei `KD_MYSQL_UTF8MB4=0`: `config:system:set mysql.utf8mb4 --type=boolean --value=false`
   - `app:enable knorke`
   - **(R2)** `config:app:set knorke create_limit --value=1000` (Vertrags- und E2E-Läufe legen viele Boards an)
6. `psql -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'`. Prüfen, dass `memcache.distributed` Redis ist, sonst `die`. **(R5)** `pg_stat_statements` nur bei `pgsql`. Bei MariaDB/MySQL mit echter App: Zeichensatz von `oc_knorke_items` prüfen (`utf8mb4` bzw. bei `KD_MYSQL_UTF8MB4=0` `utf8mb3`), sonst `die`. `die`, wenn `occ config:system:get redis password` leer ist oder `knorke-dev-$NS-back` nicht `internal` ist.
7. Konten anlegen über `docker exec -e OC_PASS=… occ user:add --password-from-env --display-name=…`:
   - `alice` („Alice Adler“)
   - `bob` („Bob Berg“)
   - beide mit einem gemeinsamen Zufallspasswort (24 Zeichen, in `env.json` `.userPass`); **(R3)** nicht der wörtliche Text „userPass“, den NCs Mindestlänge 10 ablehnt
   - **(R2)** `occ user:setting alice core lang en` und dasselbe für bob (E2E prüft englische Quelltexte)
   - Vorwärmen mit `curl -u user:pass …/index.php/csrftoken`
8. `occ config:app:set theming cachebuster --value=$(date +%s)`.
9. `docker restart knorke-dev-$NS-nc` (APCu-Routencache), warten.
10. Prüfen, dass `GET /index.php/apps/knorke/api/v1/boards` mit `Host: localhost` **401** liefert (404 heißt Routencache oder App aus → `die`). Die Platzhalter-App hat genau diese eine Route.
11. `dev/.state/$NS/env.json` schreiben:

```json
{"ns": "main", "ncIp": "172.x.y.z", "gatewayIp": "172.x.y.1", "port": 18580, "host": "localhost",
 "baseHost": "http://127.0.0.1:18580", "baseNet": "http://knorke-dev-main-nc", "appDir": "/srv/…/knorke",
 "containers": {"nc": "knorke-dev-main-nc", "db": "knorke-dev-main-db", "redis": "knorke-dev-main-redis"},
 "network": "knorke-dev-main-net", "admin": {"user": "admin", "pass": "…"},
 "userPass": "…", "users": {"alice": "Alice Adler", "bob": "Bob Berg"},
 "versions": {"nextcloud": "34.0.1", "php": "8.5.8", "postgres": "…", "redis": "…", "image": "nextcloud:34-apache"}}
```

   - **(R5) Additive Schlüssel** (alle bisherigen bleiben unverändert; `env.json` hat Modus 600 und wird zuletzt geschrieben):
     - `networks`: `{"front": "knorke-dev-<ns>-net", "back": "knorke-dev-<ns>-back"}`
     - `db`: `{kind: "pgsql"|"mariadb"|"mysql"|"sqlite", image, host, port: 5432|3306|null, name: "nextcloud", user, pass, ncDbtype: "pgsql"|"mysql"|"sqlite3", utf8mb4: true|false|null, tableCharset: "utf8mb4"|"utf8mb3"|null, pgss: bool, version}`; `utf8mb4` nur bei mariadb/mysql, `tableCharset` nur dort mit echter App
     - `redis`: `{host: "knorke-dev-<ns>-redis", port: 6379, pass: <32 Zeichen>}`
     - `versions.db`: `"<kind> <version>"`
     - Bei `sqlite` sind `containers.db`, `db.host`, `db.port`, `db.user` und `db.pass` `null`; `versions.postgres` gibt es nur bei `pgsql` (sonst `null`).
     - Werkzeuge behandeln ein `env.json` ohne `.db.kind` als `pgsql` mit Redis ohne Passwort (Stacks von vor R5, etwa der Nutzer-Stack `try`; sein nächstes `up.sh` bekommt das neue Layout).

   - **(R2)** `gatewayIp` = Gateway des Dev-Netzes (`docker network inspect`); diese Adresse sieht der Server (und die Fehlversuchs-Drossel) bei Anfragen vom Host, über `127.0.0.1:PORT` wie über die Container-IP. **(R3) Korrektur:** Ein Container **im** Dev-Netz, also der E2E-Browser, kommt mit seiner eigenen IP an. `bruteforce-reset` (§8.2) setzt nur `gatewayIp` zurück; die E-Fälle erzeugen deshalb keine Fehlversuche aus dem Browser (E09 benutzt nur ausgestellte Tokens). Braucht ein späterer Fall das, bekommt die Brücke in einer Revision ein IP-Argument.
12. Ausgeben: Browser-Weg vom Arbeitsplatz `ssh -L $PORT:127.0.0.1:$PORT root@<unraid>`, dann `http://localhost:$PORT/` (der vertrauenswürdige Name ist `localhost`).

`down.sh` macht Folgendes, **(R2) nur im eigenen Namensraum**:
- `docker rm -fv` auf die 3 Container, dann auf alles mit Label `knorke=dev-$NS`, dazu auf übrig gebliebene `knorke-e2e-$NS-*`
- **nie** `knorke-lab-*` (gehört [S]) und nie Container anderer Namensräume
- das Netz entfernen; **(R5)** beide Netze: jedes Netz namens `knorke-dev-$NS-*` oder mit Label `knorke=dev-$NS` (räumt auch Stacks von vor R5 mit nur einem Netz ab)
- `rm -rf "${STATE:?}"` mit `STATE=$ROOT/dev/.state/$NS`
- prüfen, dass kein `knorke-dev-$NS-*` übrig ist (sonst Exit 1)

Fremde `knorke-*` werden nur gemeldet, nie angefasst.

Hilfsskripte (alle mit `KD_NS`):

| Skript | Zweck |
|---|---|
| `build.sh` | **(R2)** `flock -x "$ROOT/dev/.state/build.lock" npm run build`, danach `bust.sh` für **jeden** laufenden Namensraum (`docker ps --filter label=knorke`). Einziger Weg, ab Phase 1 zu bauen (`EmptyJSDir` leert `js/` während des Builds) |
| `restart.sh` | `docker restart` + warten + 401-Prüfung, nach jeder neuen Route (nur eigener Namensraum) |
| `bust.sh` | Cachebuster +1 im eigenen Namensraum |
| `occ.sh` | `docker exec -u www-data knorke-dev-$NS-nc php occ "$@"` |
| `logs.sh` | `nextcloud.log` mit Filter `knorke`, Level ≥ 2 |
| `psql.sh` | `docker exec -it knorke-dev-$NS-db psql -U nextcloud nextcloud`; **(R5)** nur bei `KD_DB=pgsql`, sonst Exit 2 mit Verweis auf `db.sh` |
| `db.sh` | **(R5)** SQL für jede `KD_DB`: interaktiv `psql`/`mariadb`/`mysql`; `-c SQL` oder stdin → TSV ohne Kopf über `lib.sh` `db_sql` (NULL ist bei pgsql/sqlite leer, bei mariadb/mysql `NULL`; Exit ≠ 0 bei Fehler); bei SQLite über PHP-PDO als `www-data` im NC-Container (kein interaktiver Client); `--kind` nennt die Art. `lib.sh` dazu: `valid_db_kind`, `db_kind` (`env.json` `.db.kind` → NC-Label → `pgsql`), `require_pgsql` (Exit 2 mit Meldung), `db_container_running` |
| `redis-keys.sh [board]` | `redis-cli --scan --pattern '*/knorke/*'`; **(R5)** das Passwort kommt aus `REDISCLI_AUTH` im Redis-Container |
| `selftest/isolation.sh` | **(R5)** Live-Prüfung eines Namensraums (Netze, Ports, Redis-Passwort, Seitenkanäle, Zeichensatz), Exit 0/1 |
| `selftest/updown.sh [image…]` | **(R3)** up/down-Matrix; **(R5)** Schalter `KD_UPDOWN_DBS` (Vorgabe `"pgsql"`; Tokens `pgsql mariadb mysql sqlite <kind>-utf8mb3`), `KD_UPDOWN_APPS` = `both`\|`real`\|`placeholder`, `KD_UPDOWN_SMOKE=1`; ruft `isolation.sh` |

- Läufe, die das gebaute Frontend brauchen (`dev/e2e/run.sh`, Durchklicken), halten während des Laufs eine **geteilte** Sperre `flock -s` auf dieselbe Datei; ein Build wartet dann.
- `dev/selftest/placeholder/` [D]: `appinfo/info.xml` (id `knorke`, `<version>`), `appinfo/routes.php` mit der einen Route `boardApi#index`, ein Controller mit `#[NoAdminRequired]`, der `[]` liefert. Damit prüft [D] `up.sh`/`down.sh` allein.

**(R5) Host-Hinweis (OPS-5, Restrisiko):** Auf diesem Host (Docker 27.5.1, `FORWARD`-Policy `ACCEPT`, leere `DOCKER-USER`-Kette) erreicht Direkt-Routing aus dem LAN die Container-IPs jedes Docker-Netzes, trotz Port-Bindung an `127.0.0.1`. Das ist hostweit. Die Dev-Werkzeuge ändern weder iptables noch `DOCKER-USER` noch Daemon-Einstellungen. DB und Redis schützt jetzt das interne Netz (und Redis das Passwort); NC:80 im vorderen Netz bleibt per Direkt-Routing erreichbar. Schließen lässt es sich nur hostweit (Regel in `DOCKER-USER` oder Docker ≥ 28): Entscheidung des Nutzers (F10). Dokumentiert in `docs/ENTWICKLUNG.md` §3.5.

**(R5) Adress-Pools:** Jeder Stack legt zwei Netze an. Docker vergibt nach den 172er-Pools `192.168.x.0/20`-Subnetze (sie überschneiden das /24-LAN des Hosts nicht). Bei ≈ 12 Knorke-Netzen plus den übrigen Stacks waren die Vorgabe-Pools erschöpft („all predefined address pools have been fully subnetted“); die DB-Matrix lief deshalb in zwei Wellen. Die Pools sind eine hostweite Einstellung (Nutzerentscheidung, nichts geändert).

Für die PHP-Integrationstests muss der Stack des jeweiligen Namensraums laufen; `tests/php/run.sh` liest Containernamen aus `dev/.state/${KD_NS:-main}/env.json`. **(R5)** Die DB-Art steht in `env.json` `.db.kind` (Vorgabe `pgsql`; `run.sh integration` protokolliert sie), im NC-Container in `dbtype` (`pgsql` \| `mysql` \| `sqlite3`). Tests, die eine eigene Verbindung öffnen, bauen den DSN daraus (§9.2).

### 8.2 `dev/e2e/` – Browser-Abnahme (Playwright 1.49.1 im Container)

**Aufbau:**
- `dev/e2e/package.json` mit `{"type":"module","private":true,"devDependencies":{"playwright":"1.49.1"}}` (**(R3)** zusätzlich `name`/`version`/`license` erlaubt)
- **(R2)** Lockfile zuerst erzeugen: `npm install --package-lock-only` in `dev/e2e/`, dann `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci` (eigenes `node_modules`, berührt `$ROOT/node_modules` nicht)
- `run.sh` (mit `KD_NS`, Vorgabe `main`): hält während des ganzen Laufs `flock -s "$ROOT/dev/.state/build.lock"`, dann `docker run --rm --name knorke-e2e-$NS-$$ --init --network knorke-dev-$NS-net --shm-size 1g --cpuset-cpus ${KD_E2E_CPUSET:-8-15} -v $ROOT/dev/e2e:/work -v $ROOT/dev/.state/$NS/env.json:/state/env.json:ro -w /work mcr.microsoft.com/playwright:v1.49.1-jammy node run.mjs "$@"`
  - **(R5, U3/U4) ersetzt durch:** zusätzlich eine **exklusive** Sperre `flock -n` auf `dev/.state/$NS/e2e.lock` direkt nach der `env.json`-Prüfung (ein zweiter Lauf im selben Namensraum → Exit 2), dann `normalise_ns` (§8.3), dann `docker run --rm --name knorke-e2e-$NS-$$ --init --network knorke-dev-$NS-net --user ${KD_E2E_UID:-47001}:${KD_E2E_UID:-47001} --shm-size 1g --cpuset-cpus ${KD_E2E_CPUSET:-8-15} -v $ROOT/dev/e2e:/work:ro --mount type=tmpfs,destination=/work/out -v $ROOT/dev/e2e/out/$NS:/out -v <Steuerverzeichnis>/env.json:/state/env.json:ro -w /work -e KD_NS=$NS -e KD_E2E_OUT=/out -e HOME=/tmp mcr.microsoft.com/playwright:v1.49.1-jammy node run.mjs "$@"`.
  - Der Container läuft als uid 47001 (ohne Host-Konto; der `pwuser` des Images hat uid 1000 = ein Host-Konto). Playwright/Chromium läuft so ohne root. `dev/e2e` ist nur lesbar, das leere tmpfs über `/work/out` verbirgt die Ausgaben anderer Namensräume, schreiben darf er nur `dev/e2e/out/$NS` (auf die uid gechownt). Die `env.json`-Kopie hat kein `db.pass` und kein `redis.pass` (Modus 644 im Steuerverzeichnis mit Modus 700).
  - Am Start leert `run.sh` `bridge/`, `shots/` und den Bericht im eigenen Ausgabeverzeichnis (`--selftest` behält den Bericht).
- `trap` mit `docker rm -fv`
- Der Browser im Container spricht `http://knorke-dev-$NS-nc` an (vertrauenswürdige Domain; **kein** Secure Context, §0).

**Host-Brücke:** Für Schritte, die DB- oder Redis-Zugriff brauchen, schreibt `run.mjs` die Datei `out/bridge/<n>.req` (JSON `{action, args}`). Ein Hintergrundprozess in `run.sh` (`hostbridge.sh`) führt **nur** diese Whitelist aus (Board-ID als `^\d{1,18}$` geprüft) und antwortet mit `out/bridge/<n>.res`:

**(R5) Pfade und Härtung (U3/U4, OPS-2/OPS-3, verbindlich):**
- Alles liegt je Namensraum: `dev/e2e/out/$NS/{bridge/, report.md, report.json, shots/}`; im Container `KD_E2E_OUT=/out` (`bridge.mjs` `outDir()`: `KD_E2E_OUT`, sonst `dev/e2e/out/<KD_NS>`). Zwei Läufe in verschiedenen Namensräumen sehen ihre Anfragen nie gegenseitig; das E06-Gate kann nie von einem fremden Namensraum bedient werden.
- Board-ID-Regex wird `^-?\d{1,18}$` (negative IDs nur für die Selbsttest-Fixtures).
- Aufruf `KD_NS=<ns> hostbridge.sh <Brückenverzeichnis> <Steuerverzeichnis>`. Das Steuerverzeichnis (`dev/.state/$NS/e2e-ctl.*`, `mktemp -d`) ist nur auf dem Host sichtbar, liegt im selben Dateisystem und enthält die Stoppdatei; die Brücke bricht ab, wenn das Brückenverzeichnis ein Symlink ist, das Steuerverzeichnis darin liegt oder beide auf verschiedenen Dateisystemen sind.
- Das Brückenverzeichnis gilt als feindlich. Angenommen werden nur reguläre Dateien namens `^[1-9][0-9]{0,8}\.req$`; Symlinks und falsche Namen werden gelöscht (nie verfolgt), Verzeichnisse ignoriert (einmal gewarnt, keine Schleife).
- Die Anfrage wird mit `mv -T --` ins Steuerverzeichnis verschoben, dort erneut geprüft (`-L`/`-f`) und nur dort gelesen (≤ 4 KiB). Antworten und stderr entstehen nur im Steuerverzeichnis; die Antwort kommt per `mv -T --` hinein (ein untergeschobener `<n>.res`-Symlink wird ersetzt, ein Verzeichnis lässt die Antwort fallen).

| Aktion | Wirkung |
|---|---|
| `pgss-reset` | `SELECT pg_stat_statements_reset()`; **(R5)** nur bei `pgsql`, sonst `{ok:false, action, error, ms, unsupported:true}` |
| `pgss-count` | `SELECT coalesce(sum(calls),0) FROM pg_stat_statements WHERE query ILIKE '%oc_knorke_%'` (+ Liste je Statement); **(R5)** nur bei `pgsql`, sonst wie oben |
| `redis-del-rev <board>` | Scan `*/knorke/r:<board>` + DEL |
| `redis-get-rev <board>` | Wert + TTL |
| `redis-del-access <board>` | **(R2)** Scan + DEL `*/knorke/a:<board>` und `*/knorke/g:<board>:*` |
| `set-min-rev <board>` | **(R2)** `UPDATE oc_knorke_boards SET rev = rev + 1, min_rev = rev + 1 WHERE id = $1` (**eine** Anweisung; PG wertet beide Ausdrücke aus der alten Zeile aus), dann DEL `*/knorke/a:<board>` und `*/knorke/r:<board>`. Jeder Client mit `since` = altem rev bekommt `resync`, und der Snapshot liefert `rev = min_rev`, sodass die Schleife endet. (Das frühere `min_rev = rev` löste bei aktuellen Clients nie einen Resync aus, `rev + 1` allein liefe endlos.) **(R5) Portabel auf jeder DB-Art:** `BEGIN; UPDATE oc_knorke_boards SET min_rev = rev + 1, rev = rev + 1 WHERE id = $1; SELECT rev, min_rev …; COMMIT;`, dann DEL `a:`/`r:`. Die Zuweisungsreihenfolge stimmt überall: MySQL/MariaDB weisen von links nach rechts zu, PG/SQLite aus der alten Zeile. Ergebnisform unverändert `{row:{rev,min_rev}\|null, deleted, keys}` |
| `bruteforce-reset` | **(R2)** `occ security:bruteforce:reset <gatewayIp>`; **(R3)** nur diese Adresse, nicht die des E2E-Containers (§8.1) |

Zeitlimit je Anfrage 30 s.

**Helfer:**
- Login über das NC-Formular (`/login`, `input[name=user]`, `input[name=password]`)
- vor jeder Seite `addInitScript`: `localStorage['nextcloud_vol_Y29yZQ==_unsupported-browser-ignore']='true'`
- **(R2)** jeder Kontext mit `locale: 'en-US'`; Prüfungen über `window.__knorke` (§6.7) und die Test-Haken aus §6.8, Texte nur als englische Quelltexte
- `page.on('pageerror')` lässt den Test scheitern
- Ergebnisausgabe im Pulse-Stil `N ok / M fehlgeschlagen`, Exit 1 bei Fehlern; Bericht nach `out/report.md` (**(R5)** `out/$NS/report.{md,json}`; die Dateien gehören auf dem Host uid 47001. Alte Berichte unter `dev/e2e/out/report.*`, `shots/` und `dev/sim/out/*` von vor R5 sind Altlast, gitignored)
- **(R5) Übersprungene Fälle:** Ein Szenario darf `skipIf(ENV)` → Grund \| `null` definieren. Übersprungene Läufe zählen getrennt (`report.json` `skipped`, je Ergebnis `skipped: <Grund>`, dazu `db`; ebenso in der Flake-Zusammenfassung) und ändern den Exit-Code nicht; sie sind nie grün oder rot.
- **(R5) `--selftest`:** Fixtures mit den negativen IDs −900000000000000001/2. Explizite IDs hoben auf mariadb/mysql/sqlite den `AUTO_INCREMENT`-/`sqlite_sequence`-Zähler, jedes spätere Board bekam eine ID > 2^53, JS rundete sie, und `/sync` traf ein anderes Board (404). Der Live-Teil prüft, dass eine neue Board-ID eine kleine sichere Ganzzahl ist. Neuer Teil 4 prüft die Containergrenzen: nicht root, `/work` nur lesbar, `/work/out` leer, `/out` beschreibbar, kein DB-/Redis-Passwort in `env.json`. Brücken-Selbsttest: 33 Prüfungen auf pgsql, 23 auf anderen Arten (pgss durch `unsupported`-Prüfungen ersetzt).
- Vor dem Löschen von Boards `about:blank` öffnen (Throttle-Falle aus Pulse)
- Boards werden je Lauf wiederverwendet, wo es geht (≤ 20 je Konto und Lauf)
- **(R2)** Mausrad im E10: `page.mouse.wheel(0, -60)` mit `ctrlKey` (Faktor je Ereignis `exp(0,09)`, 5 Ereignisse → k ≈ 1,57 < 2; mit dem Playwright-Wert −100 wäre k ≈ 2,12 > 2 und erzwänge ein Zwischen-Neuzeichnen)
- **(R2)** Touch-Schwenk im E11 über eine CDP-Sitzung: `Input.dispatchTouchEvent` (`touchStart` → 10 × `touchMove` à 16 ms, zusammen 200 px → `touchEnd`) in einem Kontext mit `hasTouch: true`
- **(R3) Konvergenz-Wartepunkt `settle(pages)`:** `waitIdle` auf allen Seiten gleichzeitig und danach **ein zweites Mal** auf allen (gleichwertig: erst die Schreiber, dann die Leser). Eine Runde garantiert nicht, dass der Takt eines Lesers nach dem Commit eines gleichzeitigen Schreibers lief. „Nach `waitIdle` auf allen Seiten“ in E03, E05, E07 und E08 meint `settle`.
- **(R3)** Vor `page.reload`/`page.goto` `waitIdle`: Mit unbestätigten Ops setzt die Board-Seite einen `beforeunload`-Hinweis (§6.4), Playwright verwirft ihn, und die Navigation fällt aus.
- **(R3)** Kein `page.waitForFunction` mit String-Ausdruck (NCs CSP verbietet `eval`), stattdessen Polling über `page.evaluate`. Eine ruhende Szene taugt nicht als Wartebedingung, solange Fremdpräsenz da ist (die rAF-Schleife läuft, solange der Sampler Einträge liefert).

**Szenarien** (Akteure: `alice`, `bob`, Gast „Gina“, je ein eigener Browser-Kontext, Chromium, 1440×900):

| ID | Ablauf | Bestanden wenn |
|---|---|---|
| E01 Installation | alice öffnet `/apps/knorke/` | 200, Navigationseintrag „Knorke“ sichtbar, `[data-knorke=board-list]` da, keine Seitenfehler |
| E02 Board-CRUD | alice legt „E2E Board“ an (`new-board`, `field=title`, `confirm`), benennt es in „E2E Board 2“ um und lädt neu; legt „Weg damit“ an und löscht es (`delete` + `confirm`); bob öffnet seine Liste | Titel bleibt nach dem Neuladen; gelöschtes Board fehlt; bob sieht alices Boards nicht |
| E03 Konvergenz | alice öffnet das Board und schaltet den Link an (`share`, `link-toggle`, URL aus `field=link-url`); bob öffnet den Link (wird Mitglied); Gina öffnet den Link und gibt ihren Namen ein (`field=guest-name`, `guest-join`). Jeder legt 3 Notizen an verschiedenen Stellen an und tippt Text (Editor endet mit Esc = Commit). alice legt einen Frame an und zieht 2 Notizen hinein. bob verschiebt eine Notiz von alice. Gina ändert bobs Text. alice löscht eine Notiz von Gina. alice und bob ziehen **gleichzeitig** dieselbe Notiz | Nach `settle` **(R3)** auf allen drei Seiten sind `items()` gleich und gleich `await serverItems()` in alices Seite. Die 2 Notizen haben `parent = Frame`. Konvergenz ≤ 3 s nach der letzten Aktion |
| E04 Präsenz | alice bewegt die Maus an Weltpunkt P; alice zieht eine Notiz und hält dabei; alice öffnet den Text-Editor | Bei bob **und** Gina erscheint ≤ 2 s ein `[data-knorke-cursor]`, dessen `.knorke-cursor-name` „Alice Adler“ enthält, ±30 px um `worldToScreen(P)` (**(R3)** gemessen am Element `[data-knorke-cursor]` selbst, einer 14×20-px-Box, deren Pfeilspitze 1 px innen links oben am Weltpunkt sitzt, nicht am außen liegenden Namensschild). Beim Ziehen ist bei bob `scene().activeChildren ≥ 1`, und die Vorschauposition ändert sich; nach dem Loslassen gilt die Endposition. Beim Bearbeiten gibt es bei bob `[data-knorke-editing=<id>]` |
| E04b Text-Lease **(R2)** | alice öffnet den Editor einer Notiz N und tippt weiter (1 Zeichen je 200 ms); bob doppelklickt N. **(R3)** Vor jedem Doppelklick wartet bob, bis seine `presence()` alice mit `editing == N` und `editingHolder` zeigt (vorher öffnet ein schneller Doppelklick zu Recht einen Editor, denn die Lease ist nur über die Präsenz bekannt); „Übernehmen“ wird binnen 5 s nach dem Doppelklick geklickt | Bei bob öffnet sich **kein** `textarea[data-knorke-editor]`; `[data-knorke-editing=N]` mit `[data-knorke-action=take-over]` ist sichtbar. Nach alices Esc hat N alices vollen Text auf allen Seiten. Danach: bob klickt „Übernehmen“ während alice wieder tippt → alices Editor bekommt `data-knorke-editor-state=locked`, ihr Text bleibt im Editor, und `items()` enthält bobs Text |
| E05 Neuladen | bob lädt neu; Gina lädt neu | Bei bob sind die `items()` vorher und nachher gleich, die Kamera ist wiederhergestellt. Gina kommt **ohne** Namensdialog wieder herein, mit derselben `state().pid` und demselben Namen |
| E06 Fastpath **(Phase 2)** | alice schreibt etwas; **(R2)** `redis-del-access <board>`; 2 s warten (jeder Client sät über genau eine volle Prüfung neu); `pgss-reset`; alice und bob bleiben **15 s** untätig (≥ 30 Syncs laut `counters()`); dann `pgss-count`; danach `redis-del-rev`, 2 s warten, `redis-get-rev` | Während der Untätigkeit **0** Aufrufe von Statements mit `oc_knorke_` (alle Schlüssel sind frisch gesät, das Fenster endet vor jeder TTL: `r:` 30 s ab dem Schreiben, `a:`/`g:` 120 s). Nach dem Löschen ist der Schlüssel wieder gesetzt (TTL ≤ 30), und die Clients laufen fehlerfrei weiter. **(R5)** Bei `KD_DB` ≠ `pgsql` „übersprungen“ mit Grund (kein `pg_stat_statements`), nie grün oder rot |
| E07 Offline | `bobCtx.setOffline(true)`; bob verschiebt 2 Notizen und ändert einen Text; **(R2)** bob löscht eine dritte Notiz und macht es sofort rückgängig (Strg+Z); alice legt eine Notiz an; nach 5 s `setOffline(false)` | Bei bob erscheint ≤ 3 s `[data-knorke-banner=offline]`. ≤ 5 s nach der Rückkehr sind alle `items()` gleich, bobs Änderungen sind bei alice zu sehen, und die gelöschte-und-wiederhergestellte Notiz **lebt** überall |
| E08 Resync **(Phase 2)** | (a) `bob: __knorke.debug.setCursor(cursor+1000)`; (b) `set-min-rev` | (a) und (b): `counters().resyncs` steigt bei den Betroffenen um genau 1 (keine Schleife), danach Konvergenz wie in E03 |
| E09 Widerruf | alice erneuert den Link (`link-rotate` + `confirm`) | ≤ 3 s: Gina hat `[data-knorke-banner=revoked]`, bob `[data-knorke-banner=gone]`; `state().status` passt. Danach schicken beide in 5 s **keine** weiteren `/sync`-Anfragen (auch keinen Beitritt). **(R2)** Gina und zwei weitere Gast-Kontexte laden die alte Link-Seite neu → 200 mit `[data-knorke-banner=revoked]`. Ein neuer Gast mit dem neuen Link kommt herein (200, Namensdialog, kein 429). Am Ende `bruteforce-reset` (im `finally`) |
| E10 Gestenpfad | alice: Strg+Wheel (−60, siehe Helfer) an der Mitte einer Notiz, 5 Ereignisse im Abstand von 16 ms | Während der Geste ist `scene().cssTransform` nicht null, und `camera()` (bestätigt) ist unverändert. ≥ 250 ms nach dem letzten Ereignis ist `cssTransform` null, `scale` hat sich um den erwarteten Faktor geändert (±1 %), und die Bildschirmposition der Notizmitte ist gleich geblieben (±2 px) |
| E11 Ansehen-Modus | bob in einem Kontext mit `hasTouch:true, isMobile:true`, 820×1180, öffnet das Board; **(R2)** schwenkt per Touch 200 px nach links | Kein `[data-knorke-toolbar]`, `[data-knorke-banner=viewonly]` sichtbar, `state().viewOnly === true`. Ein Doppelklick erzeugt nichts. **(R2)** Während des Touch-Schwenks ist `scene().cssTransform` gesetzt; danach null, und `camera().x` ist um 200 / scale (±2 px) gewachsen. Änderungen von alice kommen an |
| E12 Kaltstart (Messung, **Phase 2**) | neuer Kontext ohne Cache: Board-Seite angemeldet und Gastseite; Anfragen zählen; Gastseite **zweimal** (App-Config `public_template` = `public`, dann `base`). **(R3)** Umgeschaltet als Admin über die Provisioning-OCS-API (`POST /ocs/v2.php/apps/provisioning_api/api/v1/config/apps/knorke/public_template`, Zugang aus `env.json` `.admin`), am Ende im `finally` zurück auf `public`; die Brücke hat dafür keine Aktion | **(R2) Gate:** Assets unter `/custom_apps/knorke/(js\|css\|l10n)/` ≤ 5 je Seite, und genau **ein** Snapshot bzw. Beitritt vor dem ersten `/sync`. Getrennt berichtet (kein Gate): Seiten-HTML, App-Icons `/custom_apps/knorke/img/*`, Anzahl `/sync` bis 5 s, **Gesamtzahl aller Anfragen** je Seite und Modus, verglichen mit 91 (Pulse angemeldet) bzw. 142 (Pulse öffentlich) |

**(R5) Nachgetragen** (seit R3/R4 im Harness, fehlten in der Tabelle; eigene Boards und Kontexte, die gemeinsame Welt von E03–E09 bleibt unberührt):

| ID | Ablauf | Bestanden wenn |
|---|---|---|
| E09b App-Drossel auf `/sync` (R3) | Der Browser-Kontext beantwortet den ersten `/sync` mit Ops nach dem Scharfschalten per `ctx.route` mit 429 `{error:'rate_limited'}` (der Server lässt sich nicht gezielt drosseln); alles andere erreicht den Stack | Status `rate_limited` (endgültig, Schleife stoppt, keine Wiederholung), `[data-knorke-banner=rate_limited]`, Szene im Ansehen-Modus, offener Editor behält seinen Text mit Hinweis, `waitIdle` wirft |
| E13 Verlassen-Sperre (T3) | offline → Zurück-Knopf bzw. Browser-Zurück mit ungespeicherter Arbeit; „Stay“; online; danach ohne Ausstehendes Zurück; „Leave“ | `[data-knorke-dialog=leave]` erscheint; „Stay“ hält Board und Sitzung (nach `popstate` steht die URL wieder auf dem Board); online kommt die Notiz beim Server an; ohne Ausstehendes geht Zurück direkt zur Liste; „Leave“ (`[data-knorke-action=confirm]`) verlässt |
| E14 Editor offen beim Neuladen/Schließen (T5) | Text tippen, Editor offen lassen (kein Esc, kein Blur), neu laden bzw. schließen | Der getippte Text steht auf dem Server (`flushEditor` vor `beforeunload`/`pagehide`); der `beforeunload`-Hinweis erscheint |

**NC 35:** `KD_NS=main KD_NC_IMAGE=nextcloud:35.0.1-apache dev/up.sh`, danach E01–E05 und E10. Das ist Teil der M0-Abnahme (Phase 2).

### 8.3 `dev/sim/` – HTTP-Vertragstests (Node auf dem Host, `node:http`)

- Der Weg geht direkt zur Container-IP mit `Host: localhost`; `fetch` würde den Host-Header überschreiben.
- Login wie im Spike: Cookies `nc_sameSiteCookielax`/`strict`, `cookie_test` und einmal `GET /index.php/csrftoken` mit Basic-Auth.
- DB- und Redis-Eingriffe laufen über `docker exec knorke-dev-$NS-db psql …` und `docker exec knorke-dev-$NS-redis redis-cli …` (Namen aus `env.json`); die Sim läuft auf dem Host und darf das. **(R5)** `redis-cli` authentisiert sich über `REDISCLI_AUTH` im Container (§8.1).
- **(R5) Nur `KD_DB=pgsql`:** Der Seitenkanal nutzt `psql`, C24 `pg_stat_statements`. `run.sh` und `lib/env.mjs` verweigern andere Arten mit Exit 2 bzw. einem Fehler. Die Portabilität der übrigen Arten prüfen PHP-Integration und Smoke (§9.2).
- **(R5) Berichte je Namensraum:** `dev/sim/out/$NS/{contract,converge}.{json,md}` (`report.mjs` `outDir`).
- **(R5) Normalisierung (U5, OPS-4):** `run.sh` ruft zuerst `lib.sh` `normalise_ns`: `occ config:system:delete knorke_dev_skip_bump` und `occ config:app:delete knorke public_template`; Warnung, wenn ein Wert nicht harmlos war (nicht `0`/`0.0` bzw. `public`); nach einem abweichenden `public_template` 4 s Pause (APCu-App-Config-Cache von 3 s, C41). `run.sh` exportiert `KD_NORMALISED=1`; `contract.mjs` normalisiert selbst, wenn es direkt gestartet wird. `dev/e2e/run.sh` ruft `normalise_ns` ebenso.
- **(R5) Signale:** `run.sh` startet node im Hintergrund und leitet INT/TERM als TERM weiter (ein Hintergrundjob einer nicht-interaktiven Shell ignoriert SIGINT), wartet auf node und endet mit 130/143, ohne den nächsten Teil von `all` zu starten. Exit-Codes: 0 grün, 1 rot, 2 nicht bereit oder nicht pgsql, 130 INT, 143 TERM.
- Dateien:
  - `run.sh` (mit `KD_NS`) bricht ab, wenn `occ status -e` scheitert.
  - `lib/http.mjs` (Client mit Cookie-Krug, Gast-Header, setzt immer `Content-Length`)
  - `lib/mirror.mjs` (eigene, **unabhängige** Spiegel-Implementierung als Orakel: Snapshot + `items`/`removed` anwenden; `itemKey`)
  - `contract.mjs`
  - `converge.mjs`
- Fälle, die Drossel-Zähler berühren (C27, C39), räumen im `finally` mit `occ security:bruteforce:reset <gatewayIp>` auf.

**`contract.mjs`** (deterministisch, Port von `probe.mjs`, mindestens diese Fälle):

| # | Fall | Erwartung |
|---|---|---|
| C01 | Sync ohne Login | **(R2)** Status 401, Body JSON mit Schlüssel `message` (von Nextcloud, kein `error`) |
| C02 | Gast-POST ohne `X-Requested-With` und `Sec-Fetch-Site` | 403 `cross_site` |
| C03 | gefälschtes Gast-Token (Signatur, Claims, > 1024 Byte) | 401 `guest_token` |
| C03b | **(R2)** Board A bekommt einen Link, ein Gast tritt A bei; Board B hatte nie einen Link (`link_gen` 1). As Gast-Token gegen `/pub/v1/boards/B/snapshot` und `/pub/v1/boards/B/sync` | beide 401 `guest_token`; B unverändert |
| C04 | `proto: 2` | 409 `protocol` |
| C05 | put ok; derselbe put | `ok`, dann `dup` |
| C06 | put `t:'shape'` (nicht in der M0-Registry) | `bad` |
| C07 | put Frame mit `r:5` | `bad` |
| C08 | patch `data.foo.bar = [1,{"a":2}]` (unbekanntes Feld, Liste) | `ok`, im Snapshot erhalten |
| C09 | patch `style.fill = 'red'` | `bad` |
| C10 | Text mit 6001 Zeichen | `bad`; 6000 → `ok` |
| C11 | LWW gleicher Pfad (2 Clients nacheinander) | Der Spätere gewinnt |
| C12 | LWW verschiedene Pfade | Beide bleiben |
| C13 | No-op-Patch | `ok`, **keine** neue `changes`-Zeile, Objekt-`rev` unverändert, **(R2)** Board-rev unverändert (Rollback), `acks.rev` = Board-rev |
| C14 | remove; patch/remove/put danach | `gone` ×3 |
| C15 | put mit `revive` auf Grabstein | `ok`, Objekt lebt wieder |
| C16 | Notiz → Frame-Elternteil | `ok`; Notiz → Notiz `bad`; Frame → Frame `bad`; **nie existierender** parent `bad`; **(R2)** Grabstein-parent → `ok`, Notiz an der Wurzel mit `x = x_rel + F.x`, `y = y_rel + F.y` |
| C17 | Frame entfernen mit 2 Kindern (eines nur in der DB, eines im selben Batch verschoben) | Kinder `parent:null`, absolute Lage unverändert, **genau eine** `changes`-Zeile je Kind |
| C18 | Batch nur aus `bad` | `acks.rev === null`, Board-rev unverändert (psql) |
| C19 | leerer Sync | Antwort genau `{"rev":N,"presence":{}}` bei `pres:1` ohne andere, genau `{"rev":N}` bei `pres:0` |
| C20 | 3 Patches auf ein Objekt zwischen zwei Syncs | **ein** Eintrag in `items` |
| C21 | Paging: 3 × 200 puts | Seite 1 hat 400 Objekte (2 ganze revs) + `more`, Seite 2 hat 200 |
| C22 | eigener Schreibvorgang | `rev ≥ acks.rev`, eigene Objekte in `items` derselben Antwort |
| C23 | Präsenz | ok; Self ausgenommen; `n` = Anzeigename; `k` stabil über Neu-Beitritt; Schlüssel mit fremder pid nicht erzeugbar; zweites Schreiben < 250 ms wird verworfen; Eintrag nach 10 s weg; **(R2)** vierter Client derselben pid verdrängt deren ältesten Eintrag, nicht fremde; `p:`-TTL nach jedem Schreiben 55–60 s |
| C24 | Fastpath **(R2: mit Aufwärmen)** | schreiben, `redis-del-access`, ein leerer Sync je Client, `pgss-reset`, dann 20 leere Syncs in ≤ 15 s → 0 `oc_knorke_`-Aufrufe (`pg_stat_statements`) |
| C25 | Sicherheitsnetz | `r:` löschen → nächster Sync liest die DB und sät neu; `r:` per redis-cli **niedriger** setzen **mit TTL** (`SET … KEEPTTL` oder `EX 30`; ohne TTL griffe Netz (a) nie) und schreiben ohne Bump simulieren (Board-rev per psql +1 und Objekt per psql ändern) → spätestens nach TTL-Ablauf (≤ 30 s) geliefert; `since > cached` → sofortiger DB-Abgleich |
| C26 | Resync | `since = rev + 5` → `resync:true`; **(R2)** `set-min-rev` (rev und min_rev = rev + 1 in einer Anweisung, Redis-Schlüssel weg) → Sync mit altem `since` → `resync:true`; Snapshot liefert `rev = minRev`; Sync mit diesem rev → **kein** `resync` |
| C27 | Link | Name leer → 400; Neu-Beitritt mit Token → gleiche pid; erneuern → altes Gast-Token 403 `link_revoked`; Link-Mitglied → 404; **(R2)** `/p/<alt>` → 200 mit `linkState: 'revoked'` (Initial-State im HTML), Beitritt mit altem Link → 403 `link_revoked`, beides ohne Fehlversuch (Drossel-Tabelle per psql `oc_bruteforce_attempts` unverändert). **Zuletzt:** unbekannter Token 10× → 404, 11. → 429 |
| C28 | Grenzen | 201 Ops → 400; Body > 1 MiB → 413; **(R2)** Body ohne `Content-Length` (chunked) → 411 |
| C29 | gzip | Mit `Accept-Encoding: gzip` ist `Content-Encoding: gzip` gesetzt, und der Body entpackt sich zu gültigem JSON |
| C30 | Board löschen | Danach liefern alle Syncs 404, auch über den Fastpath (`a:` gelöscht); `/p/<token>` des gelöschten Boards → `linkState: 'revoked'` |
| C31 | **(R2)** Lagegruppe | patch nur `{x}` → `bad`; nur `{parent}` → `bad`; `{x, y, parent}` → `ok` |
| C32 | **(R2)** gleichzeitiges Umhängen | A: `{x:100,y:100,parent:F}`, B danach im selben Fenster: `{x:2000,y:500,parent:null}` → Endzustand genau Bs Tripel; umgekehrte Reihenfolge → genau As Tripel |
| C33 | **(R2)** Frame löschen, während ein Kind darin verschoben wird | A entfernt F; B patcht danach S `{x:50,y:60,parent:F}` → `ok`, S an der Wurzel bei `(F.x+50, F.y+60)`; in umgekehrter Reihenfolge ebenso stimmig |
| C34 | **(R2)** z-Schlüssel | put mit `z` aus `zorder-golden.json` `invalid` → `bad` (jeder Fall), `valid` → `ok`; patch `z:'a'` → `bad` |
| C35 | **(R2)** leere Werte | patch `data.x = {}` und `data.y = []` → `ok`, Pfade fehlen im Snapshot; `data.e = {"k": {}}` → `ok`, `data.e` fehlt; `data.l = [1, null]` und `[1, {}]` → `bad`; `data.n = {"a": {"1": "x"}}` → `bad` (Schlüsselregel); `data.o = {"0": "a"}` → `ok` und im Snapshot die **Liste** `["a"]` (dokumentierte PHP-Grenze, serverautoritativ) |
| C36 | **(R2)** Text-Lease | alice sendet `me.e = N`; bob patcht `data.text` von N → `locked`; bob patcht `style.fill` von N → `ok`; bob sendet `me {e:N, tk:1}` und im selben Sync `data.text` → `ok`; danach alices `data.text` → `locked`; alices Präsenz 11 s still → bobs Lease bleibt, alice ohne Lease |
| C37 | **(R2)** Text-Bytes | `data.text` = 6000 × „漢“ → `ok`; 6000 × „😀“ → `ok`; 6000 × „<“ → `ok` |
| C38 | **(R2)** Body-Schlüssel | Sync mit zusätzlichem Schlüssel `foo` → 400; Sync-Body mit `"id": <anderes Board>` → 400; Beitritt mit `"token"` im Body, **(R3)** dessen Wert vom Routen-Token abweicht → 400 (ein gleicher Wert ist über `IRequest` nicht erkennbar und wird angenommen, §4.1) |
| C39 | **(R2)** Workshop-NAT nach Erneuern | 15 Gäste treten über Link L1 bei; alice erneuert (L2); jeder der 15 ruft `/p/L1` auf und versucht den Beitritt mit L1 (je 403 `link_revoked`); danach `/p/L2` → **200** (nicht 429), Beitritt mit L2 → 200 |
| C40 | **(R2)** Batch ohne Wirkung | Batch nur aus `dup`/`gone`/No-op → Board-rev unverändert, `acks.rev` = Board-rev, `r:` unverändert |
| C41 | **(R5, R4-Nachtrag)** Byte-Budget (T1) | `item_bytes` = Σ `data` + `style`; eine wachsende Op über dem Budget → `limit`, schrumpfende und neutrale immer `ok` |
| C42 | **(R5, R4-Nachtrag)** Beitritt gegen Erneuern (T4) | 20 Runden: kein Mitglied überlebt; eine Mitgliedschaft auf einem zurückgezogenen Link gewährt nichts |
| C43 | **(R5, R4-Nachtrag)** revive und Form (T9, T10) | revive behält den Typ; Patches bauen nur put-fähige Stände |
| C44 | **(R5, R4-Nachtrag)** Gast-Budget je Board und Link (T11) | 300 neue Gäste, Rückkehrer frei, Erneuern gibt ein frisches Budget |

**(R5)** Für `links_disabled`, den Initial-State `legal` und 4-Byte-Text gibt es noch keinen C-Fall; `tests/php/smoke.sh` deckt alle drei ab (§9.2). Ein Vertragsfall ist optional für [D].

**`converge.mjs`:**
- 6 simulierte Clients (2 Konten, 4 Gäste) spielen 30 s zufällige Ops gegen 1 Board: anlegen, verschieben (Commit beim Loslassen, **immer mit Lagegruppe**), Text (mit Lease über `me.e`), löschen, Löschen + sofortiges Revive, Frames, Elternwechsel, gleiche Objekte.
- Takt wie im echten Client (ab Anfragebeginn).
- **Fehlereinspielung** (Grundstufe, Phase 1) alle 5 s: `r:` löschen, `r:` senken (mit TTL), Präsenz-Blob löschen.
- **(R2) Fehlereinspielung, volle Stufe (Phase 2, ERGEBNIS §5.7):** zusätzlich `a:`/`g:` löschen (`redis-del-access`), **alle** `*/knorke/*`-Schlüssel auf einmal löschen (alle Clients säen gleichzeitig neu), verlorenes Hochziehen über den Dev-Haken `knorke_dev_skip_bump` (System-Config, Wahrscheinlichkeit 0–1, wirkt nur bei `knorke_dev = true`; [B] baut ihn in `SyncService` nach dem Commit ein; der Lauf setzt 0,2 und am Ende 0). **(R5) Ersetzt „am Ende 0“:** Der Lauf setzt 0,2 und **löscht** den Schlüssel danach (`config:system:delete knorke_dev_skip_bump`): nach der aktiven Phase, im `finally` und in einem SIGINT/SIGTERM-Handler (`process.on`, mit Wiedereintrittsschutz), der den occ-Aufruf abwartet, bevor er mit 130/143 endet. Alle Schalt-Aufrufe laufen nacheinander über eine Promise-Kette; der Handler hängt sich hinter einen laufenden Aufruf. Vorher ließ ein abgebrochener Lauf 0,2 stehen, und spätere Vertragsläufe wurden rot.
- Danach Ruhe und Prüfung:
  1. Jeder Spiegel ist gleich dem Snapshot.
  2. Das Nachspielen des ganzen `changes`-Logs (psql-Export) ist gleich dem Snapshot. **(R3)** Das Zeilenformat, das nachgespielt wird, steht in §3.5 und ist in §10.2 eingefroren.
  3. **(R2)** Jede `ok`-Op wirkt im nachgespielten Zustand bei ihrem rev, und zwar nach **Server-Normalisierung** (Farben in Kleinbuchstaben, Text gesäubert wie §4.8, leere Werte entfernt, Freigabe von Kindern entfernter Container, Grabstein-Eltern nach §4.7 Regel 6). Übersprungen wird ein Pfad, den eine spätere Op **desselben Batches** überschrieb (bei der Lagegruppe: irgendein Pfad der Gruppe).
- Ergebnis: 0 Abweichungen.

---

## 9. Testplan

| Ebene | Werkzeug | Läuft wo | Besitzer | Inhalt |
|---|---|---|---|---|
| PHP-Unit | PHPUnit **11.5.57**-PHAR (`tools/phpunit.phar`, gitignored, von `tests/php/run.sh` geladen; **(R3)** gegen eine gepinnte SHA-256 geprüft, keine GPG-Prüfung) | Wegwerf-Container (siehe unten), ohne DB, ohne `base.php` | [B] | siehe 9.1 |
| PHP-Integration | dieselbe PHAR, `phpunit.integration.xml` | `docker exec -u www-data knorke-dev-$NS-nc …` (Name aus `env.json`); Bootstrap lädt `base.php` und bricht ab, wenn `knorke_dev` nicht `true` ist | [B] | siehe 9.2 |
| JS-Unit | `node --test` mit **Globs in Anführungszeichen** (§7.1; keine Abhängigkeit, kein vitest) | Host | [S], [C] | siehe 9.3 |
| HTTP-Vertrag | `dev/sim` (Node, `node:http`) | Host → Dev-Stack | [D] | §8.3 |
| Browser-E2E | `dev/e2e` (Playwright 1.49.1, Container) | Dev-Stack | [D] | §8.2 |
| Szenen-Labor | `dev/scene-lab` (Vite-Build + Playwright-Container, `--network none`) | Container `knorke-lab-*` | [S] | siehe 9.4 |
| **(R5)** Replikat-Probe | `tests/php/replica.sh` | eigener Dev-Stack mit `KD_DB=pgsql` | [B] | §3.7, §9.2 |
| **(R5)** Harness-Selbsttests | `node --test 'dev/sim/*.test.mjs' 'dev/e2e/*.test.mjs' 'dev/selftest/*.test.mjs'` | Host, ohne Stack | [D] | Generator, Orakel, CLI, Brücke (`bridge.test.mjs`), Namensräume (`namespaces.test.mjs`), Doku-Drift, Wächter |

**PHP-Unit-Aufruf ohne Dev-Stack** (geprüft: `/var/www/html` ist leer, wenn das Image nicht mit Apache gestartet wird; die NC-Quellen liegen unter `/usr/src/nextcloud`; PHPUnit 11.5.x läuft auf PHP 8.5.8):

```
docker run --rm --name knorke-phpunit-$$ --network none -e NEXTCLOUD_ROOT=/usr/src/nextcloud \
  -v "$ROOT":/app:ro --entrypoint php nextcloud:34-apache /app/tools/phpunit.phar -c /app/phpunit.xml
```

Mit `KD_NC_IMAGE=nextcloud:35.0.1-apache` (PHP 8.5.11) läuft derselbe Aufruf gegen NC 35. Läuft `knorke-dev-$NS-nc`, darf `run.sh unit` stattdessen `docker exec` mit `NEXTCLOUD_ROOT=/var/www/html` nutzen.

`tests/php/bootstrap.php` ist der Pulse-Port:
- `$ncRoot = getenv('NEXTCLOUD_ROOT') ?: dirname(__DIR__, 4)`. Gemeint ist `custom_apps/knorke/tests/php` → `/var/www/html`.
- Geladen werden `lib/composer/autoload.php`, `3rdparty/psr/clock` sowie die Namensräume Doctrine DBAL/Deprecations, PSR Log/EventDispatcher.
- Dazu PSR-4 für `OCA\Knorke\` → `lib/` und `OCA\Knorke\Tests\` → `tests/php/`.
- **(R5)** Dazu der Namensraum `Psr\Container` (für `LinkPolicy`).
- `phpunit.xml`: `cacheResult="false"`, `failOnWarning`, `failOnNotice`, `beStrictAboutOutputDuringTests`.

### 9.1 PHP-Unit-Tests [B]

| Test | Prüft |
|---|---|
| `PathOpsTest` | alle Fälle aus `tests/fixtures/paths-golden.json`, **(R2) gelesen mit `json_decode(…, true)` wie in der Produktion** (mindestens 35: Blatt setzen/löschen, Beschneiden, Objektwert, Liste, Vorfahr/Nachfahr, Wurzelfelder, `{}`/`[]` in Tiefe 1–3, numerische Schlüssel, leere/`null`-Elemente in Listen) |
| `ZOrderTest` | **(R2)** alle Fälle aus `tests/fixtures/zorder-golden.json` |
| `OpValidatorTest` | jede Regel aus §4.8 positiv/negativ; Strings: kaputtes UTF-8, NUL, `\r\n`; Arrays an Stelle von Strings; **(R2)** Lagegruppe, z-Schlüssel, Wertregeln (alle `values`-Fälle aus `paths-golden.json`, assoc gelesen), `touchesTextPath` |
| `ItemRegistryTest` | Typregeln, `childOf`, unbekannter Typ = GENERIC, Farbnormalisierung, `allTextPaths` |
| `GuestTokenTest` | ausstellen/prüfen, Manipulation der Signatur oder Claims, abgelaufen (`allowExpired`), > 1024 Byte, falsche Version; **(R2)** Name 40 × „😀“ → ausgestellt **und** bestätigt |
| `JsonBodyTest` | **(R2)** 411 ohne `Content-Length`, 413, 400 bei unbekanntem Schlüssel, 400 bei Body-`id` ≠ Routen-`id`, `_route` erlaubt (Fake-`IRequest` mit `urlParams`) |
| `SyncServiceApplyTest` | Zustandsautomat §4.10.1 mit `ItemStore`-Fake (zeichnet Aufrufe auf): new/live/gone/revived/removed, put+remove in einem Batch = nichts geschrieben, **(R2) remove+revive in einem Batch → revived, eine Zeile `put`**, No-op ohne Zeile, nur-`bad`-Batch ohne `atomic`, **(R2) wirkungsloser Batch → Rollback, `acks.rev` = beobachteter rev, kein `bumpRev`**, Eltern-Invariante inkl. **Grabstein-Eltern → Freigabe**, Freigabe-Kaskade mit **genau einer Änderungszeile je Objekt**, `limit`, `item_count`-Delta Start/Ende, **`locked` per Präsenz-Map**, Reihenfolge `lockAndBumpRev` **zuerst**, `bumpRev` **nach** dem Commit (Mock-`IDBConnection` mit Aufrufprotokoll) |
| `SyncServiceSyncTest` | Leseweg mit Fakes: Fastpath ohne Store-Aufruf, `max(A, cached)`, `since > cached` → DB + bump, Resync-Fälle, **(R2) Präsenz vor den Ops geschrieben**, Präsenz-Wiederverwendung, `presence` immer vorhanden bei `pres=1` (auch `{}`, **(R3)** auch ohne Redis), `me` bei `view` ignoriert, JSON-Form wörtlich (`{}` nie `[]`) |
| `FastCacheTest` | In-Memory-Fake von `IMemcacheTTL` (inkl. „cas löscht TTL“): rev monoton, TTL 30 nach cas, Abbruch → remove, Gens add/set-Vorrang, Grant-Gültigkeit nur bei passender `aclGen`, kein float im Speicher |
| `PresenceStoreTest` | Drossel 250 ms (nicht bei `e`-Wechsel/`tk`), Bereinigung 10 s, Obergrenze 200, **(R2)** höchstens 3 je pid, **TTL 60 nach jedem cas**, Self-Ausschluss, `t`/`es` entfernt, `h` gesetzt, `leaseHolder` (erster hält, Übernahme, Verfall, gleiche pid nie gesperrt) |
| `AccessTest` | 401/404 (fremd = 404), Grant-Fastpath, Gast `link_revoked`, Neu-Beitritt übernimmt `gid` (auch mit neuem Link), pid stabil und je Board verschieden; **(R2) Token von Board A gegen Board B → 401 `guest_token` auf Fastpath, vollem Pfad und Snapshot**; falsche Rolle im Token → 401 |
| `LinkThrottleTest` | **(R2)** `missBlocked`-Reihenfolge mit Fake-`IThrottler`: gesperrt → kein `registerAttempt`; sonst register + erneut prüfen |
| `ItemStoreSqlTest` | `itemsSince`-Seitenlogik mit Fake-Ergebnis inkl. „ein rev > PAGE“ (Nachladen ohne LIMIT) |
| **(R4)** Review-Regressionen | `SyncServiceApplyTest`: Byte-Budget (put, wachsender patch, put + revive → `limit`; schrumpfender patch auf übervollem Board → `ok`; remove gibt Bytes frei) (T1), Lease gegen die unter dem Lock gelesene Map (T7), revive mit anderem Typ → `bad` (T9), Form nach dem Patch (T10); `AccessTest`: Limiter-Schlüssel mit Link-ID (T11); `PresenceStoreTest`: `entry()` für `vote` ohne `e`/`tk` (T12); `findBoardForUser`/`listForUser` ignorieren Mitgliedschaften auf zurückgezogenen Links (T4). Befunde in §15 |
| **(R5)** Runde 2 | Neu: `FourByteTextTest` (U7: `bmp` ersetzt nur Codepunkte über U+FFFF, Validator ersetzt in jedem String von `data`/`style`, Sync speichert den Ersatz und liefert das gespeicherte Objekt, Board-Titel), `LinkPolicyTest` (U11: Share-Manager einmal je Anfrage nach dem Besitzer gefragt, Mitglieder und Gäste verlieren den Zugriff und bekommen ihn zurück, Fastpath vertraut einem Mitglieds-Grant nur bei erlaubten Links, BoardService verweigert Links ohne etwas zurückzuziehen), `PrimaryReadsTest` (U6: ohne Replikat kostenlos, einmal je Anfrage vor dem ersten Lesen, in einer Transaktion schon Primärserver, jede Lesemethode der Stores pinnt), `PublicPageControllerTest` (U10: `httpUrl` nur http(s), `legal` aus Theming, jede Variante der Gastseite trägt sie, Nutzerseiten ohne). Angepasst: `AccessTest`, `BoardServiceTest` und `FastCacheTest` für die 4-Element-Gens, `links_disabled` und `linksAllowed` |
| `RoutesTest` | Routentabelle §4.1 vollständig festgenagelt (Name, Verb, URL, requirements) **und** das feste Textformat (eine Route je Zeile) |
| `ControllerAttributesTest` | per Reflection: jede öffentliche Methode hat `NoAdminRequired` oder `PublicPage`; nur Seiten haben `NoCSRFRequired` (dazu die öffentlichen Controller); nirgends `UseSession`/`BruteForceProtection`/`AnonRateLimit`; `#[\SensitiveParameter]` an jedem `$token` |
| `SourceGuardTest` | `lib/` liest keine Request-Parameter roh (kein `$_GET`/`$_POST`, kein `(string)$this->request->getParam`, `getParams()` nur in `JsonBody`), kein `->fetch(` (nur `fetchAssociative`), kein `Types::JSON`, kein `JSON_HEX_TAG` |
| `RawJsonResponseTest` | `instanceof JSONResponse`, `render()` wörtlich, Content-Type |
| `MigrationTest` | Schema über einen ISchemaWrapper-Fake: Tabellen, Spalten (inkl. `links.revoked_at` nullable), Indexnamen ≤ 63 Zeichen inkl. `oc_`, keine NOT-NULL-Spalte mit `''`. **(R2)** Der Fake unterscheidet NC 35 (`interface_exists(\OCP\DB\Schema\ITable::class)` → `createTable(): ITable`, geprüft in 35.0.1) von NC 34 (untypisiert, Doctrine-Tabelle); die benutzten Methoden (`addColumn`, `setPrimaryKey`, `addIndex`, `addUniqueIndex`) gibt es in beiden |

### 9.2 PHP-Integrationstests [B] (echte PG/Redis im Dev-Stack; **(R5)** echte DB jeder `KD_DB`-Art)

- **(R5) Jede DB-Art:** `tests/php/run.sh integration` läuft auf `pgsql`, `mariadb`, `mysql`, `sqlite` und auf `mariadb`/`mysql` mit `KD_MYSQL_UTF8MB4=0`; es protokolliert die Art aus `env.json` (`.db.kind // "pgsql"`, `.db.utf8mb4`). `IntegrationCase::dbKind()` fragt Nextcloud nach der DB; `pdoParams()` baut den DSN wie `ConnectionFactory` (pgsql; mysql mit `charset=utf8mb4` bzw. `utf8` bei `mysql.utf8mb4 = false`; sqlite `datadirectory/dbname.db`). Keine Prüfung ist PG-only, also gibt es kein Überspringen; `dbKind()` steht für ausdrückliche Sprünge bereit, nie stille. Die Tests legen echte Nextcloud-Konten an und löschen sie wieder (`knorke-it-<hex>`, `knorke-it-<hex>o`, Gruppe `knorke-it-g<hex>`), weil `LinkPolicy` den Share-Manager nach dem Besitzer fragt.
- `ItemStoreIntegrationTest`:
  - **(R2)** `lockAndBumpRev` serialisiert: Ein PHP-Prozess teilt sich eine `IDBConnection`; deshalb öffnet der Test eine **zweite, rohe PDO-Verbindung** mit den Zugangsdaten aus `config.php` und `SET lock_timeout = '1s'`. Hält die erste Verbindung die Board-Zeile in einer offenen Transaktion, endet `UPDATE … SET rev = rev + 1` auf der zweiten mit einem Lock-Timeout (SQLSTATE 55P03). **(R5)** `lockWaitingPdo()` je Art, Wartezeit ≈ 1 s: PG `lock_timeout` → 55P03; MySQL/MariaDB `innodb_lock_wait_timeout=1` → 1205; SQLite busy timeout → 5 „database is locked“ (Sperre der ganzen Datei, der Test sagt das ausdrücklich). Dieser Test und der Kindprozess-Test „Beitritt gegen Erneuern“ laufen auf jeder Art.
  - `itemsSince` über 3 Seiten
  - **ein rev mit 1200 Objekten** (direkt über Store-Methoden in einer Transaktion) → eine Seite mit allen 1200, Cursor korrekt
  - Snapshot: rev vor den Items
- `SyncFlowIntegrationTest`: `applyOps` + `sync` über echte Services (`\OCP\Server::get`) mit Test-Uid `knorke-it-<rnd>`, Aufräumen in `tearDown`.
  - Fehlereinspielung: `r:` entfernen, senken, erhöhen; Präsenz-Blob löschen.
  - Konvergenz der Services mit einem PHP-Spiegel.
  - **(R2)** `JsonBody` gegen einen echten Request (Body-`id` überdeckt die Route → 400).
- `BoardServiceIntegrationTest`: Link erneuern (alter Link mit `revoked_at`), abschalten, Board löschen (Links bleiben zurückgezogen), Nutzer gelöscht (über `UserDeletedListener` mit einem Fake-Event) → Gens, Mitglieder, Redis; `CleanupJob` löscht nur Links mit `revoked_at` älter als 30 Tage.
- **(R4)** Regressionen der Review-Befunde (Befunde in §15): `item_bytes` = Summe über lebende Zeilen nach zufälligen Batches, Frame mit vielen Kindern bis zum Budget entfernen → remove, Sync und Snapshot 200 mit < 128 MiB Spitzenzuwachs (T1); Beitritt gegen offenes Erneuern auf zweiter PDO-Verbindung → 403, kein Mitglied (T4); Frame mit 4900 Kindern: eine Änderungszeile je Kind, Lock < 1000 ms (T8); remove + put revive des gespeicherten Stands nach zufälligen Patches → `ok` (T10).
- **(R5)** Neu: `SyncFlowIntegrationTest::testFourByteTextNeverFailsTheBatch`, `BoardServiceIntegrationTest::testFourByteTitle` (U7), `::testNextcloudLinkPolicyOfTheOwner`, `::testLinkPolicyGroupExclusionAppliesToTheOwner` (U11).
- **(R5) `tests/php/smoke.sh`:** zusätzlich ein Richtlinien-Block (`core shareapi_allow_links`), ein `legal`-Block (`theming imprintUrl`/`privacyUrl`) und 4-Byte-Proben (Emoji). Es liest `env.json` `containers.redis` und löscht `a:<board>` per `redis-cli` in diesem Container; alle drei occ-Schlüssel löscht es im EXIT-Trap. Nach jeder occ-Config-Änderung wartet es 4 s: Nextcloud 34/35 cached die App-Config 3 s in APCu (`AppConfig::LOCAL_CACHE_TTL`), und `occ config:app:set` leert nur die Kopie der CLI. Das gilt für jeden Test, der App-Config per occ umschaltet und dann über HTTP prüft.
- **(R5) `tests/php/replica.sh`** (Aufruf `KD_NS=<pgsql-ns> tests/php/replica.sh`): braucht `env.json` `networks.back`, `db.pass` und `db.image` (Stack ab R5), sonst oder auf Nicht-pgsql Exit 2. Legt `knorke-dev-<ns>-replica` (Label `knorke=dev-<ns>`) aus einem `pg_dump` an, das danach nie aktualisiert wird, und `config/zz-knorke-replica.config.php` mit `dbreplica`; entfernt beides im EXIT-Trap. Lesezugriffe, die frisch sein müssen, scheiterten ohne §3.7 sichtbar.

### 9.3 JS-Unit-Tests

**[S]** in `tests/js/model/` (Befehl: `node --test 'tests/js/model/*.test.mjs' 'tests/js/scene/*.test.mjs'`):
- `paths.test.mjs` (goldene Datei, inkl. `isWireValue`-Fälle; `diffPatch` mit Lagegruppe)
- `zorder.test.mjs` (Alphabet, Tie-Breaker, Ordnung über Ebenen, **(R2)** `zorder-golden.json`, `keyBetween` wirft nie bei ungültiger Grenze oder gleichen Schlüsseln; **(R4)** erschöpfte Enden: `keyBetween('z'×64, null) === 'z'×64`, `keyBetween(null, '0'×63+'1') === '0'×63+'1'`, `keyBetween('z'×63+'y', 'z'×64)` gültig, ≤ 64 Zeichen und `lo ≤ k ≤ hi`; `keysBetween('z'×63+'y', null, 5)`, `keysBetween('z'×64, null, 3)`, `keysBetween(null, '0'×63+'1', 5)` liefern n gültige, nicht fallende Schlüssel ohne Wurf; Eigenschaftstest mit 2000 Zufallspaaren gültiger Schlüssel inkl. 64-Zeichen-Extremen: wirft nie, `isValidKey`, `lo ≤ k ≤ hi`)
- `ids.test.mjs`
- `sceneModel.test.mjs`:
  - load/apply/removes
  - Kaskade beim Container-Verschieben
  - Waise → Wurzel → Elternteil trifft ein
  - `hitTest` (Frame-Rand gegen Innenfläche, gedrehte Notiz, Platzhalter)
  - `queryRect`, `topContainerAt`, `moveLocal`
  - `ChangeSummary`-Inhalt
  - **(R2)** `maxZ`/`minZ` überspringen ungültige Schlüssel
- `geometry.test.mjs` (Port-Regression)
- `text.test.mjs` (`autoFontSize` deterministisch)

**[S]** in `tests/js/scene/`:
- `camera.test.mjs` (`zoomAt` hält den Punkt fest, `fit` inkl. leeres Board, Klemmen, `cssTransformFor` = Formel aus §6.3 inkl. Gegenprobe `screen₁ = k·screen₀ + (c0−c1)·s1`)
- `culling.test.mjs`
- `order.test.mjs`
- `gesture.test.mjs` **(R2)**: Zustandsautomat des GestureController mit synthetischen Pointer-Ereignissen (ohne DOM-Rendering): Ein-Finger-Touch → CSS-Pfad, Pinch → ein Finger hebt ab → dieselbe Geste schwenkt weiter, Maus → direkter Pfad, `claimTouch` nur im Bearbeiten-Modus; **(R5, U17)** ein Pfad zur Zeit: Schwenk ≤ 120 ms nach Wheel beendet die Wheel-Geste und setzt an ihrer Kamera an (kein Rücksprung beim Timer), Wheel während eines Schwenks verschluckt, Touch während eines Stift-Schwenks ignoriert, Maus-Schwenk während einer Touch-Geste abgewiesen, Kameraänderung während des Schwenks bleibt
- `cameraPaths.test.mjs` **(R5, U17)**: echter SceneManager + GestureController auf `fakeDom` mit aufzeichnendem Renderer-Stub; dieselben Fälle als Folge der gezeigten Kameras (Wheel 300 → Schwenk: css −200, end −200, direct −190, −180). U17 ist durch diese beiden deterministischen Node-Tests abgedeckt, nicht durch ein Labor-Gate
- `noHtml.test.mjs` **(R2)**: Grep über `src/model/**` und `src/scene/**`: kein `innerHTML`, `outerHTML`, `insertAdjacentHTML`, kein Import von `@nextcloud/l10n`, keine `t('…')`-Quelltexte außer denen aus §6.9, kein `stage.scale(`/`stage.position(`

**[C]** in `tests/js/sync/` (Befehl für [C] allein: `node --test 'tests/js/{sync,board,shell}/*.test.mjs'`):
- `replica.test.mjs`:
  - visible = confirmed ⊕ pending
  - ack ok wartet bis settle; **(R2)** `rev: null` → sofort erledigt; `failed` enthält verworfene Ops samt Code
  - dup/gone/locked verworfen
  - Netzfehler → identischer Batch; 413 → `splitInflight`
  - Verdichtung inkl. remove-einer-ungesendeten-put
  - `mergePatch` mit Vorfahr/Nachfahr
  - `takeBatch`-Ordnung (Container zuerst nur ohne frühere Op derselben ID, remove zuletzt nur ohne spätere Referenz, Reihenfolge je ID unverändert)
  - **(R2)** „delete+undo in einem Takt → Objekt lebt“ (remove + put revive → ein patch bzw. nichts)
  - **(R2)** „Frame löschen + Rückgängig in einem Takt“ (Freigabe-Patches, remove F, put F revive, Rückhänge-Patches → F lebt, Kinder hängen wieder in F)
  - Resync behält pending
- `scheduler.test.mjs`: alle Zweige, Takt ab `t0`, **(R2)** Text-Zwischenstände verkürzen den Takt nicht, `poke` sendet nie vor `t0 + activeMs`
- `syncClient.test.mjs`: Fake-Transport + Fake-Zeit:
  - eine Anfrage in Arbeit
  - `more` → sofort
  - Backoff; **(R2)** Proxy-429 mit/ohne `Retry-After` → Warten ohne `offline`; App-`rate_limited` endgültig
  - 404 stoppt
  - **(R2)** 401 ohne `error` (user) → `logged_out`; 401 `guest_token` → genau ein join; **403 `link_revoked` → `revoked`, kein join**
  - 409 → reload
  - Präsenz-Keepalive alle 3 s; `presence: {}` leert die Fremdpräsenz
  - **(R2)** Resync-Bremse ab dem dritten Resync in 10 s
  - `flushKeepalive` schickt ≤ 60 KiB
- `presence.test.mjs`: Interpolation (**(R5)** Gleitstrecke statt `delayMs`), `colorFor` stabil, **(R2)** fehlender Schlüssel fliegt, Verfall nach 10 s, `leaseHolder`
- `transport.test.mjs`: Header, 412-Wiederholung (genau einmal), Fehlerabbildung (`{message}` → `http_<status>`, Nicht-JSON → `http_<status>`), `clearGuest` bei 404 im Beitritt

**[C]** in `tests/js/board/` und `tests/js/shell/`:
- `actions.test.mjs` (jede Aktion: Ops + Inverse; Frame-Übernahme; Löschen gibt Kinder frei; **(R2)** jede Lage-Op und jede Inverse trägt `x`, `y`, `parent`; `moveItems` rechnet aus `origin`, nicht aus dem Modell)
- `undo.test.mjs` (Limit, Zusammenführen)
- `session.test.mjs` (`flushVisible` mit aktiven IDs aufgeschoben; Fake-Szene/-Modell; **(R2)** Textrettung für `locked`/`gone`/`bad` bei offenem und geschlossenem Editor; `presenceChanged` nach jedem `onPresence`; `setViewOnly` bei `gone`)
- `routes.test.mjs` (jeder Builder in `util/routes.js` ↔ `appinfo/routes.php`, als Text im festen Format gelesen)
- `protocol.test.mjs` (`PROTOCOL` gleich `Application::PROTOCOL`)
- `initialState.test.mjs` (Schlüssel gleich `PageController::INITIAL_STATE_KEYS`, als Text gelesen)
- `noHtml.test.mjs` **(R2)**: Grep über `src/**` ohne `src/model`/`src/scene`: kein `innerHTML`, `outerHTML`, `insertAdjacentHTML`, kein `v-html`; jeder Zugriff auf `navigator.clipboard`/`crypto.randomUUID` abgesichert
- **(R4)** Regressionen der Review-Befunde (Befunde in §15): Extremschlüssel in `actions` (T2), `prepareLeave` und Router-Sperre (T3), `flushEditor` bei `pagehide`/`beforeunload` (T5), mehrere Rettungen (T6), `wellFormed` (T14), Verdichtungssperre und `gone` auf remove (T15), Keepalive ≤ 200 Ops (T16), Resync mit aktivem Objekt (T17)
- **(R5)** Runde 2 (Befunde in §16):
  - `replica.test.mjs` (U8: halten, freigeben, `withoutDependents`)
  - `syncClient.test.mjs` (U8: Halbieren und Verwerfen, nie während eines Ausfalls, neue Ops fließen weiter, Proxy-5xx zählen nicht, Keepalive ohne gehaltene Op; U12: `links_disabled` bei Sync und Neu-Beitritt)
  - `presence.test.mjs` (U16: Kadenzen 0,4/1/2 s)
  - `session.test.mjs` (U8/U7 Konvergenz auf den gespeicherten Wert, auch mit offenem Editor; U15 ×3; U18 ×3; U19-Wächter)
  - `board/extremeZ.test.mjs` (U19, der [C]-Regressionstest zu T2): echtes `SceneModel` und echte `actions` mit Notiz `z = 'z'×64`, Notiz `'0'×63 + '1'`, Frame `'z'×64`; `createItem` für Notiz, Frame und Frame per Rahmen sowie `reorder` nach vorn/hinten über mehrere ID-Mengen liefern gültige `z` (≤ 64 Zeichen) ohne Wurf
  - `shell/`: `join.test.mjs`, `legal.test.mjs`, `reload.test.mjs`, `a11y.test.mjs` (über `@vue/compiler-dom`)

### 9.4 Szenen-Labor [S]

`dev/scene-lab/`:
- `package.json` + `package-lock.json` [S] mit `playwright` 1.49.1 (das Image bringt nur Browser mit); `npm ci` darin installiert nur `dev/scene-lab/node_modules`
- `vite.lab.config.js`: einfaches Vite (aus `$ROOT/node_modules`, nur lesend), keine NC-Konfiguration; Alias `src/util/l10n.js` → Identitäts-Stub erlaubt; Ausgabe `dev/scene-lab/dist/`
- `scene-gen.js`: Port des Spike-Generators im Wire-Format; Notizen, Frames, zusätzlich 1 % unbekannte Typen
- `prng.js`, `metrics.js` (FrameMeter-Port)
- `lab.js` montiert `SceneModel` + `SceneManager` ohne NC und ohne Sync und stellt `window.__lab` bereit
- `run.mjs`/`run.sh` laufen im Playwright-Container `knorke-lab-$$` mit `--network none`; die Seite liefert `run.mjs` selbst über `node:http` aus, mit COOP/COEP wie im Spike

Abnahme M0 (Chromium, 1920×1080, Szene: 3000 Notizen + 20 Frames + 30 Platzhalter); Draws zählt `stats().draws`:

| Gate (deterministisch, Phase 1) | Bedingung |
|---|---|
| Lazy Build | Nach dem Laden ist `nodesBuilt` ≤ Anzahl Objekte in Viewport + 10 % (rbush-Abfrage) |
| Herausnehmen | Nach dem Schwenken über das ganze Board liegt `attached` stets ≤ sichtbare + 5 |
| Kamera | Es gibt keine Aufrufe von `stage.scale`/`stage.position` (Spion auf dem Prototyp) |
| Gestenpfad Wheel | Während der simulierten Wheel-Geste (k < 2) ist `cssTransform` gesetzt, und es gibt **0** Konva-Draws; danach genau ein synchrones Draw je nicht leerer Ebene und `cssTransform` null |
| **(R2)** Gestenpfad Touch | Ein-Finger-Touch-Schwenk über 300 px (synthetische `PointerEvent` mit `pointerType:'touch'`): `cssTransform` gesetzt, **0** Konva-Draws während der Geste, danach genau ein synchrones Draw je nicht leerer Ebene. Dasselbe für Pinch → ein Finger hebt ab → weiterschwenken (eine Geste, ein End-Draw) |
| **(R2)** Gestenende mit Auswahl | Mit ausgewählter Notiz (UI-Gruppe nicht leer): Am Gestenende wird auch `overlayLayer` synchron gezeichnet |
| Platzhalter | Unbekannte Typen werden ohne Fehler gerendert |
| Ordnung | Nach Ziehen und Loslassen entspricht die Kinder-Reihenfolge der statischen Ebene `compareOrder` |
| **(R2)** Cursor auf ruhiger Szene | Sampler liefert nach Stillstand einen neuen Eintrag, `presenceChanged()` → `[data-knorke-cursor]` erscheint im nächsten Bild |

Messwerte (nur Bericht, kein Gate; **Phase 2**, erste Messung der Engine-Phase):
- erstes Rendern
- Kamera-Schritt p50/p95 beim Schwenken und Zoomen, verglichen mit den Spike-Werten 1,9/4,1 ms
- fps beim Schwenken, Zoomen und Ziehen einer Notiz
- Seitenspeicher mit zwei Canvas (GPU-Lauf, falls `KNORKE_GPU=1`)

---

## 10. Arbeitspakete (4 Agenten, getrennte Dateien)

Die vier Agenten können nicht miteinander reden. **(R2)** Deshalb gibt es drei Phasen mit Barrieren, eingefrorene Querverträge (§10.2) und getrennte Dev-Stacks (§8.1). Jedes Paket prüft in Phase 1 nur, was es allein prüfen kann; alles Gemeinsame ist Phase 2.

### 10.1 Phasen (R2)

**Phase 0 – Gerüst (kurz, nacheinander in dieser Reihenfolge, Barriere am Ende):**

| # | Paket | Liefert (endgültige Form, keine Platzhalter-Signaturen) | Prüfung |
|---|---|---|---|
| 0.1 | [C] | `package.json`, `package-lock.json` (§7.1), `vite.config.js` (§7.2, mit `appName`), **`npm ci`** (einziges Mal im Wurzelverzeichnis), `src/util/l10n.js` (endgültig: `t`/`n`, `escape:false, sanitize:false`), `l10n/de.json` mit den Texten aus §6.9 + `l10n/de.js`, Platzhalter-`src/main.js` (schreibt „Knorke“ in `#knorke-root`, ohne Konva) und minimales `src/styles/knorke.css` | `npm run build:nocheck` erzeugt `js/knorke-main.mjs` und `css/knorke-style.css` |
| 0.2 | [B] | `appinfo/info.xml` (mit `<id>` und `<version>`, Reihenfolge nach `info.xsd`), `appinfo/routes.php` (endgültig, festes Textformat §4.1), `Application.php` (`APP_ID`, `PROTOCOL`), `PageController` endgültig inkl. `INITIAL_STATE_KEYS`, `templates/main.php`/`public.php` endgültig, **alle übrigen Controller als Stubs** mit endgültigen Methodensignaturen und Attributen (Antwort 501 `{"error":"not_implemented"}`), `HttpError`, Migration endgültig, `CleanupJob`/`UserDeletedListener` als leere Stubs, Icons, `.htaccess`, `composer.json`, **`tests/fixtures/paths-golden.json`** (≥ 35 Fälle, Format §10.2) und **`tests/fixtures/zorder-golden.json`** endgültig | `php -l` über alle PHP-Dateien (Wegwerf-Container `knorke-phpunit-*`); beide Fixtures parsen; jeder `zorder-golden`-Fall gegen fractional-indexing 4.0 aus `$ROOT/node_modules` gegengeprüft (nur lesend; Ausnahmen, nur per Regex ungültig: `i0V` und **(R3)** `i0` + 63 × `1`) |
| 0.3 | [S] | `src/model/{ids,paths,zorder,registry,tokens}.js` endgültig (API §6.2, implementiert, nicht nur Signaturen) mit `tests/js/model/{ids,paths,zorder}.test.mjs` | `node --test 'tests/js/model/*.test.mjs'` grün gegen die Fixtures von [B] |
| 0.4 | [D] | `.gitignore`, `dev/lib.sh`, `up.sh`, `down.sh`, `build.sh`, `bust.sh`, `restart.sh`, `occ.sh`, `dev/php/zz-knorke-dev.ini`, `dev/selftest/placeholder/` | `bash -n`; **Phase-0-Abnahme:** `KD_NS=main dev/up.sh` mit der echten App (Stand 0.1 + 0.2): `app:enable` und 401-Probe grün; `dev/down.sh` hinterlässt nichts; dasselbe mit `KD_NS=d KD_APP_DIR=dev/selftest/placeholder`. Scheitert die echte App, geht sie vor Phase 1 an [B] zurück |

**Phase 1 – parallel.** Regeln:
- Jedes Paket schreibt nur seine Dateien (Besitz in §2 und unten). Die Phase-0-Dateien bleiben beim Besitzer und dürfen wachsen, aber **die Querverträge aus §10.2 sind eingefroren**; eine Änderung braucht eine neue Spec-Revision, kein Agent ändert sie allein.
- Kein `npm ci`/`npm install` in `$ROOT`. `dev/e2e/` ([D]) und `dev/scene-lab/` ([S]) installieren in ihr eigenes `node_modules`.
- Dev-Stacks nur im eigenen Namensraum: [B] `b`, [C] `c`, [D] `d`; `knorke-lab-*` nur [S]. Niemand fährt `main` hoch.
- Gebaut wird nur über `dev/build.sh` (Sperre, §8.1), in Phase 1 nur von [C]. [D] testet gegen den jeweils letzten Build und hält beim E2E-Lauf die geteilte Sperre.
- Bis eine Lieferung des anderen Pakets fertig ist, arbeitet jedes Paket gegen die Verträge dieser Spezifikation, mit Fakes in seinen eigenen Tests.

**Phase 2 – Integrationsrunde** (Leitung [D], Namensraum `main`):
1. NC 34: `up.sh` → PHP-Unit + Integration ([B]-Skripte) → `npm test` → `contract.mjs` → `converge.mjs` (volle Fehlereinspielung) → E01–E12 → Labor-Gates und Messbericht ([S]) → E12-Bericht.
2. NC 35: `up.sh` → PHP-Unit + Integration → E01–E05, E10.
3. `down.sh`, Restkontrolle.
4. Jeder rote Test geht an **genau einen** Besitzer; der korrigiert nur eigene Dateien; [D] wiederholt erst die betroffene Suite, am Ende einmal alles:

| Rot | Besitzer |
|---|---|
| PHP-Unit/Integration; C-Fall, bei dem die Server-Antwort von der Spec abweicht; Konvergenz-Abweichung des Servers | [B] |
| C-Fall oder Spiegel, der der Spec widerspricht; Brücke, Zeitverhalten des Harness, `up.sh`/`down.sh` | [D] |
| E-Fall: Server-Antwort falsch | [B] |
| E-Fall: Protokoll, Zustand, Banner, Test-Haken der Shell, Textrettung, `__knorke` | [C] |
| E-Fall: Leinwand, Geste, Cursor, Chip, Editor, Test-Haken der Szene; Labor-Gates | [S] |
| `l10n:check` wegen eines Textes außerhalb §6.9 | [S]; fehlender `de.json`-Eintrag → [C] |

### 10.2 Querverträge (eingefroren ab Phase 0)

| Vertrag | Von → an | Festgelegt in |
|---|---|---|
| Routentabelle, Namen, Verben, URLs, requirements; festes Textformat von `routes.php`, `PROTOCOL`, `INITIAL_STATE_KEYS` | [B] → [C], [D] | §4.1, §6.6 |
| Fehlerform `{error,message}`; Nextcloud-401/412 als `{message}`; Entscheidung am Status | [B] → [C], [D] | §4.2 |
| `/sync`-Anfrage/Antwort inkl. `presence` immer bei `pres=1` (**(R3)** ohne Redis `{}`), `acks.rev`-Semantik, `me.tk`, `h` | [B] → [C], [D] | §4.5 |
| **(R3)** Zeilenformat von `oc_knorke_changes.patch` (put = Drahtformat ohne id, patch = `{pfad: wert \| null}` der effektiven Pfade, remove = NULL), das `converge.mjs` nachspielt | [B] → [D] | §3.5, §8.3 |
| Ops, Ergebniscodes inkl. `locked`; Lagegruppe; Wertregeln „leer = abwesend“; z-Gültigkeit; **(R4)** `limit` auch für das Byte-Budget, revive nur mit gespeichertem Typ, Form nach dem Patch | [B] ↔ [S], [C], [D] | §4.6–§4.8 |
| Gast-Token-Prüfreihenfolge (`b` zuerst), Link-Zustände `ok/revoked/invalid`, Drossel nur bei Fehltreffern | [B] → [C], [D] | §4.9 |
| `paths-golden.json`: `{"paths":[{"name","item","path","value","expect"}], "values":[{"name","value","ok"}]}`; `zorder-golden.json`: `{"valid":[…],"invalid":[…]}` | [B] → [S] | §4.7, §4.8 |
| `src/model/{ids,paths,zorder,registry,tokens}.js` API; **(R4)** `keyBetween`/`keysBetween` werfen nie, an erschöpften Enden liefern sie die Grenze selbst | [S] → [C] | §6.2 |
| SceneManager-Fassade, `Intent`, `RemoteSample`, Callback-Reihenfolge beim Loslassen, Kamera-Semantik, `stats()`; **(R4)** additiv `flushEditor(): boolean` | [S] → [C] | §6.3 |
| Test-Haken im DOM (**(R3)** + Banner `rate_limited`; **(R4)** optional `[data-knorke-dialog=leave]`; **(R5)** additiv Banner `links_disabled`, `rename-board`, `guest-menu`, `legal`, `[data-knorke-dialog=rescue]`) | [C], [S] → [D] | §6.8 |
| `window.__knorke` inkl. `items(): string[]`, `serverItems()` | [C] → [D] | §6.7 |
| `src/util/l10n.js` (`t`, `n`; **(R3)** Aufruf `t('knorke', …)`) und die erlaubten [S]-Texte | [C] → [S] | §6.9 |
| Build-Ausgabe `js/knorke-main.mjs`, `css/knorke-style.css`; nur über `dev/build.sh` | [C] → [B], [D] | §7.3, §8.1 |
| Dev-Stack: `KD_NS`, Namen, Ports, `env.json` (inkl. `gatewayIp`), `KD_APP_DIR`, `KD_SKIP_BUILD_CHECK`, Sperrdatei | [D] → alle | §8.1 |
| Host-Brücke (Aktionen, Wirkung) | [D] intern, wirkt auf [B]-Daten | §8.2 |
| Dev-Haken `knorke_dev_skip_bump` | [B] → [D] | §8.3 |
| **(R5)** 403 `links_disabled` (Endpunkte, Prüfreihenfolge), `linksAllowed` im Board-Objekt und im Besitzer-Snapshot, Link-Mitglieder bei verbotenen Links → 404 | [B] → [C], [D] | §4.2, §4.3, §4.4, §4.9.2, §4.9.3, §4.9.7 |
| **(R5)** Initial-State `legal` (`INITIAL_STATE_KEYS` mit 9 Schlüsseln, eine Zeile) | [B] → [C] | §6.6 |
| **(R5)** 4-Byte-Ersatz U+FFFD bei `supports4ByteText() = false`; gespeicherter Stand in derselben `/sync`-Antwort | [B] → [C] | §4.3, §4.5, §4.8 |
| **(R5)** `a:<board>` = `[aclGen, linkGen, minRev, links]`; alte Form = Fehltreffer | [B] intern, wirkt auf [D]-Brücke | §5.1 |
| **(R5)** Status `links_disabled`, `FROZEN_STATUSES` = `FINAL_STATUSES`, Ack-Code `internal` nur clientseitig | [C] → [D] | §6.4, §6.5 |
| **(R5)** `env.json`-Zusätze `networks`, `db`, `redis`, `versions.db` (additiv); `KD_DB`, `KD_DB_IMAGE`, `KD_MYSQL_UTF8MB4`; Berichtspfade `dev/e2e/out/<ns>/report.*` und `dev/sim/out/<ns>/*` (die Regressionsskripte des Orchestrators lesen die neuen Pfade) | [D] → alle | §8.1, §8.2, §8.3 |

### WP-B Backend

- **Dateien:** `appinfo/**`, `lib/**`, `templates/**`, `img/**`, `.htaccess`, `composer.json`, `phpunit.xml`, `phpunit.integration.xml`, `tests/php/**`, `tests/fixtures/**`.
- **Liefert:**
  - HTTP-API §4 (Routen, JSON-Formen, Fehlercodes, Ergebniscodes, Text-Lease §4.11)
  - Initial-State-Schlüssel §6.6
  - Template lädt `knorke-main`/`knorke-style`; App-Config `public_template` (§4.9.1)
  - Redis-Verhalten §5
  - `tests/fixtures/paths-golden.json` und `zorder-golden.json` (Format §10.2)
  - Dev-Haken `knorke_dev_skip_bump` (§8.3)
- **Bezieht:**
  - Build-Ausgabe von [C], nur Dateinamen
  - Dev-Stack von [D] (Namensraum `b`, `env.json`)

**PHP-Signaturen** (verbindlich für [D]-Tests, nur über HTTP, und für die Lesbarkeit; intern frei, solange §4/§5 gelten):

```php
namespace OCA\Knorke\AppInfo;
final class Application extends App implements IBootstrap {
    public const APP_ID = 'knorke';
    public const PROTOCOL = 1;
    // register(): $context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class); boot(): leer
}

namespace OCA\Knorke\Http;
final class JsonBody {   // (R2) §4.1
    /** @throws HttpError 400|411|413 */
    public static function read(IRequest $r, array $allowed, int $maxBytes = Limits::MAX_BODY_BYTES): array;
    /** (R3) nur Schritt 3 für Routen ohne Body (8, 10, 12, 15) @throws HttpError 400 */
    public static function guardRoute(IRequest $r): array;
}

namespace OCA\Knorke\Service;
enum Role: string { case Owner = 'owner'; case Edit = 'edit'; case View = 'view'; case Vote = 'vote';
    public function canEdit(): bool; }
final class Principal {
    public function __construct(public readonly string $id /* u:<uid> | g:<gid> */, public readonly Role $role,
        public readonly string $displayName, public readonly string $pid, public readonly bool $isGuest,
        public readonly ?string $uid) {}
}
final class AccessResult { public function __construct(public readonly Principal $principal,
    public readonly ?int $dbRev, public readonly int $minRev) {} }
final class SyncRequest {
    public function __construct(public readonly string $client, public readonly int $since, public readonly ?int $seq,
        public readonly array $ops, public readonly ?array $me, public readonly bool $wantPresence) {}
    public static function fromRequest(IRequest $r): self;   // JsonBody + Input::*, wirft HttpError(400|409|411|413)
    public static function fromBody(array $body): self;      // (R3) additiv: prüft einen schon gelesenen Body
                                                             //      (fromRequest = JsonBody::read + fromBody)
}
final class ZOrder { public static function isValid(string $z): bool; }          // (R2) §4.8
final class GuestToken {
    public function issue(array $claims): string;                                 // JSON_UNESCAPED_UNICODE|_SLASHES
    public function verify(#[\SensitiveParameter] string $t, bool $allowExpired = false): ?array;   // ohne Board-Wissen
}
final class LinkThrottle { public function missBlocked(string $ip): bool; }       // (R2) §4.9.5, nur nach Fehltreffer
class Access {
    public function forUser(int $board, bool $full = false): AccessResult;
    /** Prüfreihenfolge §4.9.3: verify → b === $board → r ∈ Link-Rollen → lg; 401 guest_token | 403 link_revoked | 404 */
    public function forGuest(#[\SensitiveParameter] string $token, int $board, bool $full = false): AccessResult;
        // (R3) $full additiv: Board-Zeile immer aus der DB, nie die gecachten Gens (Gast-Snapshot)
    /** (R3) additiv: volle Prüfung wie forUser/forGuest, dazu die Board-Zeile (Snapshot braucht den Titel) → [AccessResult, row] */
    public function forUserWithRow(int $board): array;
    public function forGuestWithRow(#[\SensitiveParameter] string $token, int $board): array;
    /** @return array{0: AccessResult, 1: string guestToken, 2: int exp, 3: array boardRow}
     *  @throws HttpError 400 name_required | 403 link_revoked | 404 not_found | 429 rate_limited */
    public function joinGuest(#[\SensitiveParameter] string $linkToken, #[\SensitiveParameter] string $name,
        #[\SensitiveParameter] ?string $existing, string $ip): array;
    public function pid(int $board, string $principalId): string;
}
class SyncService {
    /** @return array{0: ?int, 1: list<string>}  0 = Schreib-rev | beobachteter rev (Rollback) | null (keine Transaktion) */
    public function applyOps(Principal $p, int $board, string $client, array $ops, int $nowMs, ?array $presence = null): array;
    public function sync(AccessResult $a, int $board, SyncRequest $r, int $nowMs): string;          // JSON
    public function snapshotJson(AccessResult $a, int $board, array $boardMeta, ?array $guest = null): string;
    protected function authorize(Principal $p, array $op, ?array $row): ?string;   // (R2) M0: immer null (= erlaubt)
}
class BoardService {
    public function listFor(string $uid): array;
    public function create(string $uid, string $title): array;
    public function rename(string $uid, int $board, string $title): array;
    public function delete(string $uid, int $board): void;
    public function enableLink(string $uid, int $board, bool $rotate): array;
    public function disableLink(string $uid, int $board): void;
    public function joinLinkAsUser(string $uid, #[\SensitiveParameter] string $token): int;   // 403 link_revoked | 404 | 429
    public function onUserDeleted(string $uid): void;
    public function activeLink(int $board): ?array;                                            // (R3) additiv
    public function linksAllowed(string $owner): bool;                                         // (R5) §4.9.7
    // (R5) enableLink → 403 links_disabled nach requireOwner; joinLinkAsUser → 403 links_disabled für Nicht-Besitzer;
    //      listFor/requireOwner behandeln Link-Mitglieder bei verbotenen Links als Fremde. Konstruktor: LinkPolicy $policy zuletzt
}
class LinkPolicy {   // (R5) §4.9.7; Konstruktor (Psr\Container\ContainerInterface, IUserManager), Share-Manager lazy
    public function allows(string $ownerUid, ?IUser $known = null): bool;   // shareApiAllowLinks($owner), nie mit null
}
final class Input { /* … */ public static function bmp(string $s): string; }   // (R5) U+10000–U+10FFFF → U+FFFD
final class OpValidator {  // (R5) normalize, cleanPut, cleanPatch, cleanValue bekommen bool $fourByte = true (false → bmp auf jeden String)
    public static function normalize(Principal $p, mixed $op, bool $fourByte = true): array;
}
// (R5) Access: Konstruktor bekommt LinkPolicy $policy als letzten Parameter; Gast: links_disabled nach link_revoked (§4.9.3)
// (R5) HttpError: Vorgabemeldung für links_disabled („Link sharing is disabled by the administrator.“)
// (R5) PublicPageController::legalLinks(IAppConfig): array {imprintUrl, privacyUrl}; ::httpUrl(string): string (§6.6)
class FastCache {
    public function available(): bool;
    public function getRev(int $b): ?int;  public function seedRev(int $b, int $rev): void;  public function bumpRev(int $b, int $rev): void;
    /** @return array{acl:int, link:int, minRev:int, links:bool, gone:bool}|null   (R5) links */
    public function getGens(int $b): ?array;
    public function seedGens(int $b, int $acl, int $link, int $minRev, bool $links): void;   // (R5) 5. Parameter Pflicht
    public function setGens(int $b, int $acl, int $link, int $minRev, bool $links): void;    // (R5) 5. Parameter Pflicht
    public function markGone(int $b): void;
    /** @return array{acl:int, role:string}|null */
    public function getGrant(int $b, string $uid): ?array;
    public function setGrant(int $b, string $uid, int $acl, string $role): void;
}
class PresenceStore {
    public function available(): bool;                                                    // (R3) additiv
    /** @return array{0: string status ok|retry|skip|lost|off, 1: ?array map}  nach jedem cas setTTL(60) */
    public function write(int $b, string $key, array $entry, int $nowMs): array;
    public function read(int $b, int $nowMs): array;
    public static function entry(Principal $p, array $me, int $nowMs): array;
    public static function public(array $map, string $selfKey, int $nowMs): array;        // immer Objekt, mit h
    public static function leaseHolder(?array $map, string $itemId, int $nowMs): ?string; // (R2) pid | null
}
```

```php
namespace OCA\Knorke\Db;
class PrimaryReads {   // (R5) §3.7; Konstruktor (IDBConnection, IConfig)
    public function pin(): void;   // einmal je Anfrage, nur mit dbreplica und ohne laufende Transaktion
}
// (R5) BoardStore und ItemStore: Konstruktor (IDBConnection $db, ?PrimaryReads $primary = null); rows/each/qbRows
//      rufen $this->primary?->pin() (in den Unit-Fakes null)
class ItemStore {
    /** @return array{rev:int, item_count:int, item_bytes:int, min_rev:int}|null  — UPDATE … SET rev=rev+1, updated_at=? WHERE id=?; dann SELECT
     *  (R4) item_bytes additiv */
    public function lockAndBumpRev(int $board, int $nowMs): ?array;
    public function addItemCount(int $board, int $delta, int $bytes = 0): void; // (R4) dazu das Byte-Delta für item_bytes, dieselbe
                                                                               //      UPDATE-Anweisung; (R5) Signatur so gebaut
    public function releaseMany(int $board, array $moves, int $rev, string $actor, string $client, int $nowMs): void;
                                                                               // (R5, R4-Nachtrag) gebündelte Freigabe (§4.10.1 Schritt 16)
    /** @return array{rev:int, min_rev:int}|null */
    public function readRev(int $board): ?array;
    /** @return list<string> JSON-Fragmente, ORDER BY id
     *  (R4) Rückgabe darf der fertige JSON-Array-Text als EIN String werden: beim Iterieren angehängt, ohne Zwischen-Arrays (§4.4)
     *  (R5, so gebaut) Generator über einen streamenden Cursor (protected each()); Rückgabetyp iterable */
    public function snapshotItems(int $board): iterable;
    /** @return array{0: list<array>, 1: int upTo, 2: bool more} */
    public function itemsSince(int $board, int $since, int $upTo, int $limit): array;
    /** @return array<string, array> inkl. Grabsteine */
    public function loadItems(int $board, array $ids): array;
    public function liveChildren(int $board, array $parentIds): array;          // (R4) nur Lagespalten (§4.10.1 Schritt 16)
    public function insertItem(int $board, string $id, array $item, int $rev, string $actor, int $nowMs): void;
    public function updateItem(int $board, string $id, array $cols, int $rev, string $actor, int $nowMs): void;
    public function reviveItem(int $board, string $id, array $item, int $rev, string $actor, int $nowMs): void;
    public function insertChange(int $board, int $rev, string $itemId, string $op, ?string $patch, string $actor, string $client, int $nowMs): void;
    public function pruneChanges(int $olderThanMs): int;
    public static function itemJson(array $row): string;
    public static function obj(array $map): string;                            // Flags §4.8, ohne JSON_HEX_TAG
}
class BoardStore {
    public function findBoard(int $board): ?array;
    public function findBoardForUser(int $board, string $uid): ?array;        // + member_role; (R4) nur bei link_id NULL oder aktivem Link (§5.2)
    public function listForUser(string $uid): array;                           // owner ∪ member, ORDER BY updated_at DESC, id DESC; (R4) Regel wie oben
    public function createBoard(string $owner, string $title, int $nowMs): int;
    public function renameBoard(int $board, string $title, int $nowMs): void;
    public function lockBoard(int $board, bool $bumpAcl, bool $bumpLink, int $nowMs): ?array; // UPDATE … gens; SELECT
    public function deleteBoardRows(int $board): void;                         // (R2) changes, items, members, boards – Links NICHT
    public function countOwned(string $uid): int;
    /** (R2) Link-Zeile inkl. revoked_at, dazu Board-Gens per LEFT JOIN (Board kann fehlen) */
    public function findLinkByToken(string $token): ?array;
    public function activeLinkOf(int $board): ?array;                          // (R2) revoked_at IS NULL
    public function insertLink(int $board, string $token, string $role, string $by, int $nowMs): int;
    public function revokeLinks(int $board, int $nowMs): array;                // (R2) statt deleteLinks; → zurückgezogene link_ids
    public function pruneRevokedLinks(int $olderThanMs): int;                  // (R2) CleanupJob
    public function addMember(int $board, string $uid, string $role, ?int $linkId, int $nowMs): bool; // false = existierte
    public function deleteMember(int $board, string $uid): int;                // (R5, R4-Nachtrag) Link-Beitritt ersetzt tote Zeilen
    public function deleteMembersByLinks(int $board, array $linkIds): int;
    public function deleteMembershipsOf(string $uid): array;                   // betroffene board_ids
    public function boardsOwnedBy(string $uid): array;
}
```

- **Fertig in Phase 1, wenn (allein prüfbar):**
  - `php -l` über `lib/` und `tests/` sauber
  - `tests/php/run.sh unit` grün auf `nextcloud:34-apache` **und** `nextcloud:35.0.1-apache` (Wegwerf-Container, ohne Stack)
  - `KD_NS=b tests/php/run.sh integration` grün auf NC 34 (NC 35 in Phase 2)
  - `KD_NS=b tests/php/smoke.sh` grün: jede Route aus §4.1 mit erwartetem Status und Antwortform, inkl. 411/413/400 aus `JsonBody`, `linkState` auf `/p/…`
  - kein Spike-Rest aus §11.2
  - `info.xml` passt zu `info.xsd` (xmllint in einem Wegwerf-Container oder per Augenschein der Reihenfolge)
- **In Phase 2:** `contract.mjs` (C01–C40) und `converge.mjs` grün (läuft [D], [B] behebt Server-Abweichungen); Integration auf NC 35.

### WP-S Szenenmanager + Modell

- **Dateien:** `src/model/**`, `src/scene/**`, `tests/js/model/**`, `tests/js/scene/**`, `dev/scene-lab/**` (inkl. `package.json`/`package-lock.json` dort).
- **Liefert:** die Schnittstellen aus §6.2 und §6.3 (`SceneModel`, `SceneManager`, `ChangeSummary`, `Intent`, `RemoteSample`, `stats()`), `paths.js`/`ids.js`/`zorder.js`/`registry.js`/`tokens.js` für [C] (Phase 0), die Szenen-Test-Haken aus §6.8.
- **Bezieht:** Fixtures von [B] (Phase 0), `$ROOT/node_modules` von [C] (Phase 0, nur lesend), `src/util/l10n.js` von [C] (Phase 0).
- **Fertig in Phase 1, wenn (allein prüfbar):**
  - `node --test 'tests/js/model/*.test.mjs' 'tests/js/scene/*.test.mjs'` grün
  - deterministische Gates des Szenen-Labors §9.4 grün (`dev/scene-lab/run.sh`, Container `knorke-lab-*`, `--network none`)
  - keine Konva-Objekte und kein Modell in Vue-Reaktivität (die Szene importiert Vue nicht)
  - Culling ohne `visible()`: Ein Spion auf `Node.prototype.visible` zählt bei einem reinen Schwenk ohne LOD-Wechsel 0 **Setter**-Aufrufe (LOD darf Text-Knoten weiter per `visible(false)` verbergen). **(R3)** Konva ruft `visible()` beim Zeichnen intern als Getter auf (≈ 72 000-mal je Laborlauf); das ist kein Culling und zählt nicht.
  - kein `stage.scale(` und kein `stage.position(` im Code, keine HTML-Senken, nur Texte aus §6.9 (`noHtml.test.mjs`)
  - keine native Treffererkennung, `listening:false` auf allen Inhaltsebenen
- **In Phase 2:** Messbericht `dev/scene-lab/out/report.md`; E-Fälle der Szene (E04, E04b, E10, E11).

### WP-C Sync-Client + Vue-Shell + Build

- **Dateien:**
  - `src/main.js`, `src/App.vue`, `src/PublicApp.vue`, `src/router.js`
  - `src/views/**`, `src/components/**`, `src/board/**`, `src/sync/**`, `src/api/**`, `src/util/**`, `src/styles/**`
  - `l10n/**`, `build/**`, `package.json`, `package-lock.json`, `vite.config.js`
  - `tests/js/sync/**`, `tests/js/board/**`, `tests/js/shell/**`
  - die Build-Ausgabe `js/`, `css/`
- **Liefert:** Bündel §7, `window.__knorke` §6.7, die Shell-Test-Haken §6.8, die gesamte UI, Client-Protokoll §4/§6.4, Textrettung §6.5.
- **Bezieht:**
  - HTTP-API von [B]; in Phase 1 Fake-Transport in den Tests, Stubs/Teilstände im eigenen Stack `c`
  - Modell von [S] (Phase 0, echt), Szene von [S]; bis zur Fertigstellung Fakes, die §6.3 erfüllen
  - Dev-Stack und `dev/build.sh` von [D]
- **Fertig in Phase 1, wenn (allein prüfbar):**
  - `node --test 'tests/js/{sync,board,shell}/*.test.mjs'` grün (Shell-Tests gegen die Phase-0-Dateien von [B])
  - `dev/build.sh` grün inkl. `check-bundle`
  - `l10n:check` grün, `de.json` vollständig
- **In Phase 2:** im Stack `main` (34 und 35) per Hand durchgeklickt: Liste, Board, Notiz, Frame, Teilen, Gast; E01–E12 grün (mit [D]); Layout ohne doppelte Scrollbalken auf NC 34 und 35, Gastseite in beiden Template-Modi.

### WP-D Dev-Stack + E2E + Doku

- **Dateien:** `dev/**` außer `dev/scene-lab/**`; `docs/**` außer `SPEC-M0.md`; `README.md`, `CHANGELOG.md`, `LICENSE`, `.gitignore`.
- **Liefert:**
  - `dev/up.sh`/`down.sh`, `build.sh` und Hilfsskripte §8.1 mit Namensräumen, `env.json`-Form §8.1, Platzhalter-App
  - `dev/sim` §8.3, `dev/e2e` §8.2 inkl. Host-Brücke
  - `docs/ENTWICKLUNG.md`:
    - Stack, Namensräume, Tunnel, Build (`dev/build.sh`) → bust → restart
    - Fallen: Routencache, Cachebuster, opcache, `occ upgrade` zieht Store-Updates, `.bin`, `docker rm -fv`, `node --test` nur mit Globs
    - Runbook „nach DB-Restore“ (§5.3 c)
  - `docs/ARCHITEKTUR.md`, `docs/PROTOKOLL.md` (inkl. Runbook und der bewusst hingenommenen LWW-Fälle)
  - README mit KI-Hinweis wie Pulse, Funktionen, Installation (Warnung vor Checkout im Webroot), Bauen, Tests, Lizenzen der Bündelinhalte und MDI-Icons, bekannte Grenzen
  - **(R5)** nutzerseitig nachzutragen (README englisch, `docs/` deutsch): Link-Richtlinie des Besitzers samt Gruppenausschluss, Verzug ≤ 120 s + 3 s, nichts wird zurückgezogen, keine eigene Admin-Einstellung, Grenze „erzwungenes Link-Passwort/Ablaufdatum erst in M1“ (§4.9.7); `dbreplica` unterstützt, +2 Roundtrips je Anfrage mit Knorke-SQL (§3.7); Emoji werden bei `mysql.utf8mb4 = false` als U+FFFD gespeichert (§4.8); unterstützte Datenbanken, Oracle per `info.xml` ausgeschlossen (§3); Host-Hinweis Direkt-Routing (§8.1)
  - CHANGELOG nach Keep a Changelog: `## [Unreleased]`, Unterlisten mit 4 Leerzeichen eingerückt
- **Bezieht:** `window.__knorke` und die Test-Haken von [C] und [S], die API von [B], die Szene von [S] (nur über den Debug-Haken).
- **Fertig in Phase 1, wenn (allein prüfbar):**
  - `up.sh` → `down.sh` hinterlässt nichts (geprüft mit `docker ps -a`/`network ls`/`volume ls`), mit 34 und 35, mit Platzhalter- und echter App, in `d` und ohne einen anderen Namensraum zu berühren
  - `node --check` über alle `.mjs`, `bash -n` über alle Skripte
  - Host-Brücke mit Selbsttest (`dev/e2e/run.sh --selftest`: alle Aktionen ohne Browser gegen Stack `d`)
  - `contract.mjs`, `converge.mjs` und E01–E12 laufen gegen Stack `d` und melden ehrlich (rot ist in Phase 1 erlaubt)
  - Doku vollständig
- **In Phase 2:** Leitung der Integrationsrunde (§10.1).

### 10.3 Gemeinsame Abnahme M0 (Ende Phase 2)

Alles grün auf NC 34 (Namensraum `main`):
- `npm test`, PHP-Unit, PHP-Integration
- `contract.mjs` (C01–C40), `converge.mjs` (0 Abweichungen mit voller Fehlereinspielung)
- E01–E12 (E12 mit Bericht), Gates des Szenen-Labors, Messbericht des Labors

Auf NC 35: PHP-Unit, Integration, E01–E05, E10. Danach `down.sh` sauber, auch für `b`, `c`, `d`; keine `knorke-lab-*`-Reste. Kein Prod-Container wurde angefasst.

**(R5)** Dazu auf NC 34: PHP-Integration und Smoke je `KD_DB`-Art (`pgsql`, `mariadb`, `mysql`, `sqlite`, `mariadb`/`mysql` mit `KD_MYSQL_UTF8MB4=0`) und `tests/php/replica.sh` auf `pgsql`. `contract.mjs`, `converge.mjs` und E06 bleiben `pgsql`-only (§8.2, §8.3). Wegen der Adress-Pools (§8.1) läuft die Matrix in Wellen.

---

## 11. Portierung aus dem Spike

### 11.1 Was wohin wandert

| Quelle (`knorke-spike/…`) | Ziel | Art |
|---|---|---|
| `poll/app/knorkespike/appinfo/info.xml` | `appinfo/info.xml` | anpassen: id `knorke`, Namensraum `Knorke`, Zusammenfassung/Beschreibung en+de mit Untertitel „Workshop-Board“ und KI-Hinweis, Repo `hotochan123/nextcloud-knorke`, `<php>`-Abhängigkeit, Job, Navigation |
| `…/appinfo/routes.php` | `appinfo/routes.php` | neu schreiben (§4.1); Stil mit `$id`/`$tok`-requirements bleibt |
| `…/lib/AppInfo/Application.php` | gleich | portieren; zusätzlich nur die Listener-Registrierung (Klassenname) |
| `…/lib/Controller/BoardController.php` | `SyncController`, `BoardApiController`, Trait `ApiResponses` | anpassen: `run()`-Muster plus `\Throwable` → Log + 500; `client()`-Prüfung; JSON-Spleiß `substr($snap,0,-1).',"me":'…` |
| `…/lib/Controller/PublicBoardController.php` | `PublicSyncController`, `PublicPageController` | anpassen: `X-Requested-With`-Regel → `refuseCrossSite` (+ `Sec-Fetch-Site`); `X-Knorke-Guest`; Beitritt mit Drossel und Identitätsübernahme |
| `…/lib/Http/RawJsonResponse.php` | gleich | anpassen: **erbt von `JSONResponse`** (gzip über die Middleware) |
| `…/lib/Service/HttpError.php` | `lib/Exception/HttpError.php` | portieren + `code` |
| `…/lib/Migration/Version000001…` | `Version000100Date20261011000000` | anpassen (§3) |
| `…/lib/Service/BoardStore.php` | `Db/ItemStore.php` (+ neu `Db/BoardStore.php`) | portieren: `lockAndBumpRev`, `loadItems`, `insertItem`, `updateItem`, `insertChange`, `itemJson`, `obj`, Seitenlogik. **Behoben:** ein rev > Seite; `changes()` → `itemsSince()` über Items; `fetchAssociative` |
| `…/lib/Service/SyncService.php` Schreibweg | `SyncService::applyOps` | portieren mit den Änderungen aus §4.10.1 (revive, Eltern-Invariante, Freigabe, limit, ohne `cf`/`foreignPaths`, ohne Vote-Sonderfall) |
| `…/SyncService.php` `normalize`/`clean*` | `OpValidator` + `ItemRegistry` | portieren + erweitern (Listen/Objekte, Registry, unbekannte Felder) |
| `…/SyncService.php` `getPath`/`setPath`/`setIn` | `PathOps` | portieren + Objektwerte |
| `…/SyncService.php` `poll()` | `SyncService::sync()` | neu schreiben (§4.10.2) |
| `…/lib/Service/FastCache.php` | `FastCache` + `PresenceStore` | anpassen: TTL-Netz, Gens, Grants mit aclGen, Präsenz an pid gebunden, TTL-Erneuerung, Map-Wiederverwendung |
| `…/lib/Service/Access.php` | `Access` + `GuestToken` | anpassen: Token-Format und -Prüfung bleiben (Domänentrennung `knorke-guest\|`); die Board-Bindung `$c['b'] !== $board` aus dem Spike wird **normativ** (§4.9.3); Rechtemodell neu; Identität dauerhaft |
| `…/lib/Service/Principal.php` | `Principal` + `Role` | anpassen |
| `poll/setup.sh`, `teardown.sh` | `dev/up.sh`, `dev/down.sh`, `dev/lib.sh` | anpassen (§8.1, Namensräume) |
| `poll/load/probe.mjs` | `dev/sim/contract.mjs` | gegen `/sync` neu schreiben |
| `poll/load/load.mjs` (Login, `node:http`-Agent, `Mirror`, `setPath`, `canon`, `itemKey`, `quiesceAndCheck`) | `dev/sim/lib/*.mjs`, `dev/sim/converge.mjs` | anpassen (`items`/`removed` statt Log-Zeilen) |
| `poll/load/load.mjs` `enqueue`, `ulid`, `clientId` | `src/sync/Replica.js`, `src/model/ids.js` | anpassen (crypto-Zufall, Verdichtung §6.4) |
| `engine/src/geometry.js` | `src/model/geometry.js` | portieren ohne `bezierPath` |
| `engine/src/model.js` | `src/model/SceneModel.js` | Kern portieren und stark erweitern (§6.2) |
| `engine/src/style.js` | `src/model/tokens.js` | portieren; Frame-Stil kommt aus dem Objekt |
| `engine/src/scene.js` `autoFontSize` | `src/model/text.js` | portieren |
| `engine/src/scene.js` Generator + `prng.js` + `metrics.js` | `dev/scene-lab/` | anpassen (Wire-Format) |
| `engine/src/renderers/konva.js` | `src/scene/KonvaRenderer.js` + `nodes/*` | Gerüst portieren: Importe, Flags, Ebenen, Builder, gebündelte Kamera, Drag-Fluss, `endDrag`-Binärsuche; **neu**: Culling, Init, `patched()` → `applySummary` |
| `engine/runner/run.sh`/`run.mjs` (Containermuster, COOP/COEP-Server) | `dev/scene-lab/run.*`, `dev/e2e/run.sh` | anpassen |
| Pulse (`$KD_PROD_STACK_DIR/nextcloud_html/apps/pulse`, nur lesen) `lib/Service/Input.php`, `lib/Controller/PublicVoteController.php::codeMissBlocked`, `refuseCrossSite`, `tests/bootstrap.php`, `tests/run.sh`, `src/util/l10n.js`, `src/toast.js`, `build/l10n-*.js` | entsprechende Knorke-Dateien | portieren; **(R2)** Pulses `build/l10n-*.js` sind CommonJS, die Ports sind ESM (`.mjs`, Knorke hat `"type": "module"`); `codeMissBlocked` → `LinkThrottle::missBlocked` |
| `engine/node_modules/fractional-indexing/src/index.js` `validateOrderKey`, `getIntegerLength`, `isSmallestInteger` | `lib/Service/ZOrder.php`, `src/model/zorder.js` `isValidKey` | **(R2)** portieren (CC0), mit `digits = intDigits = base36` |

Nicht übernommen werden: `engine/src/renderers/leafer*.js`, `images.js`, `bench.js`, `scenarios.js`, `main.js`, `build.mjs` (Szenarien folgen in M1 als Bench auf dem Szenen-Labor), dazu `poll/variant.sh`, `run.sh`, `smoke.sh`, `pageload*`, `edge*`, `verify-edge.sh`, `summarize.mjs` und `apache/knorke-status.conf`. Diese gehören zum Lastlauf in M1.

### 11.2 Spike-Abkürzungen, die **nicht** mitkommen

1. `open_to_users` und `create(open=true)`, also „jeder Angemeldete darf bearbeiten“.
2. Grants ohne Rollen und Generation; Widerruf erst nach 120 s.
3. `/pub/{token}/join` ohne Drossel.
4. Seitenlogik, die bei einem rev > Seite Zeilen verliert.
5. TTL-Lecks (`cas` auf `r:`/`p:` ohne TTL-Erneuerung nach **jedem** `cas`).
6. Neue Gast-ID bei jedem Beitritt (öffnet Mehrfachabstimmen).
7. `voteKey = 'u' . uid` und Präsenz-`n = uid`, die Uids an Gäste verraten; Kollisionen durch die Säuberung.
8. Stimmen in `data` mit voller Identität. Das kommt in M1 bewusst entschieden, nicht als Erbe.
9. Präsenz-Schlüssel = frei gewählte Client-ID (fremde Cursor überschreibbar).
10. `actor` auf 47 Zeichen gekürzt.
11. Zu strenge Validierung: keine Listen, feste `TYPES`, unbekannte Felder → `bad`. Fehlende Eltern- und Zyklusprüfung, drehbare Frames.
12. rev-Sprung bei einem Batch, der nur aus `bad` besteht.
13. `cf`-Konfliktzählung mit `foreignPaths`-Abfrage im Lock.
14. Header `X-Knorke-Spike-Fastpath`, die Felder `src` und `pw`, `log`-Endpunkt, `<bugs>https://example.invalid…`.
15. Nur `HttpError` abgebildet, andere Ausnahmen ohne Log.
16. Getrennte Endpunkte für ops, poll, pollPush, presence und presenceGet; Polltakt ab Antwortende; Commit von Positionen während des Ziehens (5 Batches/s); unverdichtete Log-Zeilen ohne gzip.
17. Engine: `visible(false)`-Culling; alle Knoten vorab bauen; Bilder vorab dekodieren; `throw` bei unbekanntem Typ; `patched()` ohne Neu-Cullen und nur für pos/text/fill; `orderIndex` statisch; nur eine Elternebene, keine Kaskade; `fontSize` gespeichert; z ohne id als Tie-Breaker; Kamera je Eingabeereignis statt je rAF; Frame-Treffer auf der ganzen Fläche; Frame- und Verbinder-Stil aus Konstanten; Bench-Instrumentierung im Produktcode (nur über `stats()` und das Labor).
18. `rnd()` mit `head | base64 | tr | head` unter `pipefail`.
19. **(R2)** Feste Container-/Netznamen ohne Namensraum (`knorke-dev-nc`) und ein `down.sh`, das fremde Läufe abräumt.

---

## 12. Risiken und offene Fragen (für den Nutzer)

| # | Frage | Empfohlene Vorgabe (gilt, wenn keine Antwort kommt) |
|---|---|---|
| F1 | **Teilen in M0 nur per Bearbeitungslink.** Angemeldete, die den Link öffnen, werden Board-Mitglied (das Board erscheint in ihrer Liste). Wird der Link erneuert oder abgeschaltet, verlieren genau diese Mitglieder den Zugriff. Explizites Teilen mit Nutzern, Gruppen und Teams kommt erst in M1. Passt das? | Ja, so umsetzen. Sicher und einfach; wer dauerhaft Zugriff braucht, bekommt in M1 eine explizite Freigabe. |
| F2 | **Frame löschen:** Kinder freigeben (bleiben an Ort und Stelle) oder mitlöschen (Miro-Verhalten)? Undo gibt es in M0 nur einfach und nicht über Neuladen. | Freigeben. Ohne belastbares Undo ist Mitlöschen zu riskant. In M1 lässt sich mit Mehrfachauswahl „Frame + Inhalt löschen“ ausdrücklich anbieten. |
| F3 | **Datenschutz:** Gäste über den Link sehen die **Anzeigenamen** angemeldeter Teilnehmer (Cursor, Teilnehmerleiste). Uids und E-Mails sehen sie nie. | Anzeigenamen sichtbar lassen, wie bei öffentlichen Talk-Räumen. Später wäre eine Board-Option „Namen für Gäste verbergen“ möglich. |
| F4 | **Sprache von README und CHANGELOG:** Die Konvention sagt „Doku deutsch“. Pulse musste für den App Store auf Englisch umstellen. | README, CHANGELOG (und später SECURITY) von Anfang an **englisch**; `docs/` bleibt deutsch. Das spart die Umstellung vor dem Store-Release. |
| F5 | **Ziel von M0:** nur Dev-Stack oder schon Prod? | Nur Dev-Stack. Ein Prod-Einsatz bringt Migration (Freigabe vor dem Lauf), Cachebuster und Edge-Fragen mit sich (kalter Seitenaufruf, Token-Bucket 200/400 je IP). Er sollte mit M1 kommen, nach dem Lastlauf S4 mit `/sync`, der Entscheidung zu `dbpersistent` und den Edge-Ausnahmen **und nach dem Schreibbudget (§1.2, R2)**. |
| F6 | **(R2) Text-Lease „Übernehmen“:** Darf jeder Bearbeiter einem anderen die Lease abnehmen (wer übernimmt, gewinnt; der Verdrängte behält seinen Text im Editor zum Kopieren)? | Ja. Eine Lease, die nie verfällt, solange ein vergessener Tab offen ist, wäre schlimmer. Moderatorenrechte („nur Besitzer darf übernehmen“) erst mit den Rollen in M1. |
| F7 | **(R2) Gastseite im Template-Modus `RENDER_AS_BASE`** (ohne NC-Kopfzeile, vermutlich deutlich weniger Anfragen beim kalten Start als 142)? | Vorgabe bleibt `RENDER_AS_PUBLIC`. E12 misst beide Modi; zeigt `BASE` mindestens 30 Anfragen weniger und sieht die Gastseite ohne Kopfzeile vertretbar aus, wird es in M1 die Vorgabe. **(R3) Entschieden:** E12 maß `RENDER_AS_PUBLIC` 34 und `RENDER_AS_BASE` 32 Anfragen (angemeldete Board-Seite 85; Pulse 91 bzw. 142). Der Abstand liegt weit unter 30, `public` bleibt Vorgabe. |
| F8 | **(R3) Teilen-Knopf auf Ansehen-Geräten:** Auf Touch-Geräten (Ansehen-Modus) sieht der Besitzer weiter den Teilen-Knopf und kann den Link verwalten. Soll das so bleiben? | Ja. Link-Verwaltung ist keine Bearbeitung des Boards, und ein Besitzer am Tablet will den Link weitergeben können. |
| F9 | **(R5) Link-Richtlinie von Nextcloud (NC-5):** Bearbeitungslinks ohne Konto übergingen „Freigabe per Link erlauben“ der Instanz, und Admins hatten keinen Schalter für Gastzugriff. Wie soll Knorke sich verhalten? | **Entschieden (11.10.2026, vom Nutzer bestätigt):** Knorke befolgt die Core-Richtlinie für den **Besitzer** (inkl. Gruppenausschluss), ohne eigenen Admin-Schalter in M0; bei verbotenen Links wird nichts zurückgezogen, erneutes Erlauben stellt alles wieder her (§4.9.7). Erzwungenes Link-Passwort und Ablaufdatum werden erst in M1 befolgt (dokumentierte Grenze). Alternativen: zusätzlich ein App-Schalter „Gast-Bearbeitungslinks erlauben“; oder Passwort/Ablauf schon in M0. |
| F10 | **(R5) Hostweite Erreichbarkeit per Direkt-Routing (OPS-5, Rest):** Docker 27.5.1 mit `FORWARD`-Policy `ACCEPT` und leerer `DOCKER-USER`-Kette lässt ein LAN-Gerät mit eigener Route jedes nicht-interne Container-Netz des Hosts erreichen, Prod eingeschlossen. Die Dev-Stacks schützen DB und Redis jetzt per internem Netz; NC:80 der Dev-Stacks bleibt erreichbar (mit Anmeldung). | Keine Vorgabe der Skripte: Sie ändern absichtlich nichts am Host. Abhilfe ist eine `DOCKER-USER`-Regel, die neue Verbindungen von außen in die `br-*`-Brücken verwirft, oder Docker ≥ 28. Beides betrifft alle Container des Hosts und ist Sache des Nutzers. |

**Technische Risiken** (keine Nutzerentscheidung, aber im Blick behalten):
- **WebKit/iPad ist ungemessen.** Der CSS-Gestenpfad ist Pflicht, aber noch nicht gemessen. M0 liefert ihn samt Gates im Labor; die Gerätemessung folgt in M1 und entscheidet über die Umkehr-Bedingung aus ERGEBNIS §1.
- **Mounten von NcContent** in `#knorke-root` ist nur gebaut, nicht in einer echten Seite geprüft (Tooling-Digest). [C] prüft das zuerst; Rückfall ist ein schlichtes `div` wie bei Pulse. **(R3) Erledigt:** läuft auf NC 34.0.1 und 35.0.1 (Durchklicken in `c`, 29/0).
- **Kalte Gastseite** (`RENDER_AS_PUBLIC`) kostete in Pulse 142 Anfragen. E12 misst das **und** `RENDER_AS_BASE` (F7). **(R3) Gemessen:** 34 bzw. 32.
- **(R2) Integrationsrunde:** Phase 2 ist eine eigene Runde mit Besitzer je rotem Test (§10.1). Erst danach ist M0 abgenommen; Phase 1 allein beweist nur die Pakete einzeln.
- **(R2) DB-Restore bei vorauseilendem Redis** ist in M0 nur per Runbook abgesichert (§5.3 c).
- **(R5) MySQL/MariaDB-Speicher:** Snapshot und Sync eines Boards am Byte-Budget brauchen dort 2,33 × die Antwort (Puffer von `pdo_mysql`); unter den Gates, aber mit kleinem Abstand (§3).
- **(R5) SQLite** serialisiert Schreiber verschiedener Boards (Dateisperre); nur für Dev und Test (§3).
- **(R5) `dbreplica` in langlaufenden Prozessen:** Nach 30 s Leerlauf öffnet Nextcloud die Verbindung neu, der Pin aus §3.7 wird nicht erneuert. Heute schreiben die langlaufenden Pfade nur.

---

## 13. Review-Entscheidungen (Revision 2, 10.10.2026)

### 13.1 Blockierende Befunde – alle übernommen

| # | Befund | Lösung in |
|---|---|---|
| B1 | Gast-Token nicht an das Board gebunden (Cross-Board-Zugriff) | §4.9.3 Prüfreihenfolge, §5.2, §10.2; `AccessTest`, C03b |
| B2 | Link erneuern sperrt eine Workshop-NAT 30 min aus; Auto-Beitritt nach `link_revoked` sinnlos | §3.2 `revoked_at`, §4.2, §4.9.1/§4.9.2/§4.9.5 (`missBlocked` nur nach Fehltreffer), §4.10.4, §6.4 (kein Auto-Join bei 403), §6.6; C27, C39, E09 |
| B3 | Löschen + Rückgängig im selben Takt löscht doch | §6.4 Verdichtung und `takeBatch`, §4.10.1 (`removed` → `revived`); `replica.test`, `SyncServiceApplyTest`, E07 |
| B4 | `{x, y, parent}` als getrennte Register; `bad` bei gelöschtem Elternteil verliert Objekte | §4.6, §4.7 Regel 2a und 6, §4.10.1, §6.5; C16, C31–C33 |
| B5 | Text-Lease nur kosmetisch → Textverlust | §1.1, §4.5 (`tk`, `h`), §4.6 `locked`, §4.7 Regel 11, §4.10.2 (Präsenz vor Ops), **§4.11**, §5.5, §6.3, §6.5 Textrettung; C36, E04b |
| B6 | z-Regex lässt Schlüssel zu, an denen fractional-indexing wirft (Board-DoS) | §4.8 `ZOrder::isValid`, §6.2 `isValidKey`/`keyBetween`, `zorder-golden.json`; C34 |
| B7 | `{}`/`[]` in PHP nicht unterscheidbar | §4.7 Regel 3, Variante (a) „leer = abwesend“ + Schlüsselregex auf jeder Ebene; Fixtures assoc gelesen; C35 |
| B8 | Ein-Finger-Touch-Schwenk lief am CSS-Pfad vorbei | §1.1, §6.3 GestureController; Labor-Gate „Touch“, `gesture.test`, E11 |
| B9 | `MAX_ITEM_BYTES` < möglicher Text | §4.8 (65536, ohne `JSON_HEX_TAG`), §6.5 Textrettung; C37 |
| B10 | `node --test <verzeichnis>` läuft auf Node 22.18 nicht | §7.1, §7.5, §9.3 (Globs in Anführungszeichen) |
| B11 | 401/412 von Nextcloud haben kein `error` | §4.2, §6.4 (`http_<status>`, Entscheidung am Status); C01 |
| B12 | Keine Barriere, keine Isolation zwischen den Agenten | §0, §8.1 Namensräume + `build.sh`/`flock`, §10.1 Phasen 0–2, §10.2 Querverträge |
| B13 | UI-Vertrag für [D] fehlte | **§6.8** Test-Haken, §6.7 `items(): string[]`, `serverItems()`, Editor-Ende ohne Abbrechen (§6.3), Sprache `en` im E2E |
| B14 | Fassade unvollständig (Cursor-Wecken, Laufzeit-Ansehen, Formen, Kamera, Reihenfolge) | §6.3 `presenceChanged`, `setViewOnly`, `{x,y}`-Formen, bestätigte vs. Live-Kamera, Loslass-Reihenfolge; §6.5 `moveItems` aus `origin` |
| B15 | `set-min-rev` konnte E08(b) nie bestehen | §8.2 Brücke (`rev = rev + 1, min_rev = rev + 1`), §4.10.3; C26 |
| B16 | E06/C24 zufällig rot durch TTL-Abläufe | §8.2 `redis-del-access` + Aufwärmen + 15-s-Fenster; C24 |
| B17 | `l10n:check` hing an [S]/[B]; Escaping-Konflikt | **§6.9** aufgezählte Texte, `t` nur aus `src/util/l10n.js`, `textContent` |

Abweichungen im Detail (bewusst, keine Ablehnung):
- **B5:** Der Server liest die Präsenz nicht in einem eigenen GET vor dem Lock, sondern schreibt sie in `sync()` **vor** `applyOps` und nutzt die Map (ein GET nur, wenn kein `me` mitkam). So zählt eine Übernahme (`tk`) schon für die Text-Ops derselben Anfrage. **(R4)** Die vor dem Lock geschriebene Map dient nur noch dem eigenen Präsenz-Schreibvorgang der Anfrage; die Lease-Prüfung liest die Präsenz bei Text-Batches unter dem Lock neu (§4.10.1 `lease(op)`, §4.11). Der Client sperrt das Öffnen nicht schon bei irgendeinem fremden `e`, sondern beim **Halter** (`h = 1`); sonst sperrten sich zwei gleichzeitig Öffnende gegenseitig.
- **B2/C39:** Den Fall „15 Gäste hinter einer IP“ prüft der HTTP-Vertragstest mit 15 Gast-Identitäten; E09 nutzt nur drei Browser-Kontexte (15 Chromium-Kontexte kosten viel und prüfen dieselbe Drossel).
- **B9:** 65536 statt 49152, und `JSON_HEX_TAG` entfällt ganz (statt nur bei der Messung), weil Objekte nie in HTML eingebettet werden.

### 13.2 Weitere Befunde – übernommen

Präsenz immer ausgeben (`{}`) und Verfall im Client (§4.5, §6.4); `p:`-TTL nach jedem `cas` (§5.1); Proxy-429/503 wiederholen, App-`rate_limited` endgültig (§4.2, §6.4); E12 misst auch `RENDER_AS_BASE` (§8.2, F7); nur endgültige Ops verkürzen den Takt, `poke` nie vor `t0 + activeMs` (§6.4); keine HTML-Senken + Grep-Tests (§0, §9.3); Gast-Token mit `JSON_UNESCAPED_*` und 1024 Byte (§4.9.3); `Content-Length` Pflicht, unbekannte Body-Schlüssel und Routen-Überdeckung → 400 (`JsonBody`, §4.1); alle nicht leeren Ebenen am Gestenende synchron zeichnen (§6.3); Resync-Bremse (§4.10.3); §5.3 (c) korrigiert + Runbook; Präsenz höchstens 3 je pid, `me` bei `view` ignoriert (§5.5, §4.9.6); Fehlereinspielung nach ERGEBNIS §5.7 inkl. `knorke_dev_skip_bump` (§8.3, Phase 2); `MAX_ITEMS_PER_BOARD` 5000 (§4.8); wirkungslose Batches zurückrollen (§4.7 Regel 9, §4.10.1); `authorize()`-Haken im Lock und Präsenz-Filter für M2 (§1.2); `flushKeepalive` ≤ 60 KiB + `beforeunload` (§6.4); zwei statt drei Konva-Canvas (§6.3); float-Falle in FastCache (§5.1); Gast-Identität je Board, Gäste am Namensschild markiert (§4.9.3, §6.3, §6.9); `appName: 'knorke'` und `<version>` in `info.xml` (§7.2, §7.5); esbuild-Sorge gestrichen, EBADENGINE vermerkt (§7.1); Secure-Context-Absicherung (§0); `gatewayIp` + `bruteforce:reset` im `finally` (§8.1, §8.2, §8.3); `create_limit` per App-Config (§4.8, §8.1); eine Änderungszeile je Objekt und rev (§3.5); E10-Wheel-Delta −60 und `r:` mit TTL senken (§8.2, C25); E12-Gate präzisiert (§8.2); Prüfung 3 des Konvergenzlaufs mit Server-Normalisierung (§8.3); `dev/scene-lab/package.json` bei [S], Lockfile für `dev/e2e` (§2, §8.2, §9.4); festes Textformat der von [C] gelesenen PHP-Dateien (§4.1); `MigrationTest` für NC 34 und 35 (§9.1); zweite PDO-Verbindung im Lock-Test (§9.2); `fit` auf leerem Board, `keyBetween`-Grenze kommentiert (§6.2, §6.3); absoluter Pulse-Pfad, ESM-Ports (Kopf, §11.1); Integrationsrunde mit Besitzer je rotem Test, Phase-1-Kriterien nur allein prüfbar (§10).

Als geprüfte Fakten ohne Änderungsbedarf festgehalten: gepinnte npm-Versionen und Bündelform (§7.1), Docker-Images und PHP-Versionen (§9), `(any-pointer: fine)` = false bei `hasTouch + isMobile` in Chromium 1.49.1 (E11), NC-34-Drossel wirft erst nach > 10 Fehlversuchen ohne zu schlafen (§4.9.5).

### 13.3 Abgelehnt oder verschoben

- **Abgelehnt für M0: Schreibbudget** (`ILimiter` je Principal für Sync mit Ops, Grabstein-/`changes`-Obergrenze je Board, Snapshot-Drossel), **weil** M0 nur im Dev-Stack läuft (F5) und ein Limiter je Takt einen zusätzlichen Redis-Roundtrip kostet, dessen Grenzwerte erst der Lastlauf S4 mit `/sync` in M1 sinnvoll festlegen kann. Festgehalten als **Pflicht vor jedem Prod-Einsatz** (§1.2, F5).
- **Abgelehnt: Grants `g:` bei jedem Fastpath-Treffer verlängern**, **weil** das jeden leeren Poll um einen Redis-Schreibvorgang verteuert; das Aufwärmen mit `redis-del-access` macht E06/C24 ebenso deterministisch.
- **Abgelehnt: das weichere E06-Gate** („≤ 1 Aufruf je Schlüssel auf `oc_knorke_boards`“), **weil** mit Aufwärmen und 15-s-Fenster alle Schlüssel frisch sind und „0 Aufrufe“ deterministisch hält; ein weicheres Gate würde echte Fastpath-Regressionen verdecken.
- **Abgelehnt: Variante (b) für `{}`/`[]`** (eigenes `json_decode` als `stdClass`), **weil** sie Typinformation durch `PathOps`, `obj()` und alle Validatoren tragen müsste; Variante (a) ist kleiner, in PHP und JS gleich und durch Fixtures festnagelbar. Kosten: ein fremder Client, der `{"0": …}` schickt, erhält eine Liste zurück (C35, dokumentiert).
- **Abgelehnt: Gate auf die Gesamtzahl der Anfragen beim kalten Start (gegen 91)**, **weil** die Zahl überwiegend vom NC-Kern und den installierten Apps abhängt (der Dev-Stack hat den Prod-App-Satz nicht) und M0 nicht in Prod geht. E12 berichtet die Zahl für beide Template-Modi; die Entscheidung folgt über F7.
- **Verschoben auf M1: Board-Epoche** gegen vorauseilendes Redis nach einem DB-Restore, **weil** sie einen Reparatur-occ-Befehl und ein weiteres Feld im Fastpath braucht; M0 deckt den Fall per Runbook ab (§5.3 c).
- **Verschoben auf M1: Speichermessung der zwei Canvas auf dem iPad**, **weil** es in M0 kein Gerät im Messaufbau gibt; die Zusammenlegung von UI- und Zieh-Ebene ist in M0 umgesetzt.

---

## 14. Revision 3 – Befunde aus Phase 1

Stand 11.10.2026. Alle vier Pakete haben ihre Phase-1-Kriterien grün gemeldet ([B] 312 PHP-Unit-Tests auf 34 und 35, Integration 13/0, Smoke 91/0; [S] 330 Node-Tests, Labor-Gates 10/0; [C] 120 Node-Tests, Build mit `check-bundle` und `l10n:check` grün, Durchklicken 29/0 auf 34 und 35; [D] Vertrag 41/0, Konvergenz ohne Abweichung, E2E 13/0, E04b aber zeitweise rot). Revision 3 schreibt fest, was dabei gelernt und abgenommen wurde. Die Querverträge aus §10.2 gelten mit den hier genannten Änderungen weiter als eingefroren.

| Befund | Entscheidung | Stelle |
|---|---|---|
| Präsenz ohne Redis: §4.5/§4.10.2 sagten „Schlüssel fehlt“, §5.1 sagte `{}`; umgesetzt war „fehlt“ | Bei `pres = 1` immer `presence`, ohne Redis `{}` ([B] passt `SyncService::sync` an) | §4.5, §4.10.2, §5.1, §5.4, §9.1, §10.2 |
| C38: Ein Body-`token` gleich dem Routen-Token ist über `IRequest` nicht erkennbar | C38 prüft mit abweichendem Wert; ein gleicher Wert wird angenommen | §4.1, §8.3 |
| `guestTransport` hatte keine Client-ID, der Beitrittsbody braucht `client` | neue Option `client` | §6.4 |
| Präsenz vor Ops + `e = null` beim Schließen → eigener letzter Text `locked` (E04b) | Client-Pflicht: `e` bleibt, bis die letzte Text-Op bestätigt oder verworfen ist | §4.11, §6.5 |
| `debug.setCursor` wurde von einer Antwort im Flug überschrieben (E08a wackelte) | Antworten auf Anfragen, die vor dem Aufruf begannen, setzen den Cursor nicht; `SyncClient.setCursor` | §6.4, §6.7 |
| `waitIdle` erzwang Takte während offener Anfragen und wurde nie ruhig | erzwingt nur ohne offene Anfrage; wirft bei gestopptem Sync | §6.7 |
| Scheduler: `activeMs ± jitter` widersprach „poke nie vor `t0 + activeMs`“ | `nextDelay` behält den Jitter; nur poke-Wecken wird geklemmt (`pokeDelay`, `pokeFloor`) | §6.4 |
| App-429 auf `/sync` hatte keinen Status (umgesetzt: `gone`) | endgültig: Schleife stoppt, Status und Banner `rate_limited` | §6.4, §6.5, §6.8, §10.2 |
| Abbau: `flushKeepalive`/`stop` vor `scene.destroy` verlor bis ≈ 1 s Getipptes | Reihenfolge Szene/Editor → `flushKeepalive` → `stop` ([C] korrigiert) | §6.5 |
| `.knorke-board`-Formel auf NC 34/35 um 8 px zu kurz, in `RENDER_AS_BASE` falsch | 100-%-Höhenkette, gemessen auf 34, 35 und `BASE` | §6.6 |
| Konvergenzprüfungen wackelten mit einer Runde `waitIdle` | `settle`: zweimal auf allen Seiten (oder erst Schreiber, dann Leser) | §8.2 |
| E12 muss `public_template` umschalten, die Brücke kann das nicht | Provisioning-OCS-API als Admin, Rückstellung im `finally` | §8.2 |
| E04b: Ein schneller Doppelklick öffnet zu Recht einen Editor | bob wartet, bis er alice als Halter sieht | §8.2 |
| Format von `oc_knorke_changes.patch` war nicht eingefroren | put = Drahtformat ohne id, patch = effektive Pfade, remove = NULL; eingefroren | §3.5, §8.3, §10.2 |
| E12-Messung: Gastseite `public` 34, `base` 32 Anfragen (Board-Seite 85; Pulse 91/142) | F7 entschieden: `public` bleibt | §12 |
| [S]: Das Frame-Randband (8 px / scale) braucht die Skala, das Modell kennt sie nicht | `hitTest(…, {edgeWorld})` optional | §6.2 |
| [S]: `batchDraw` plant ein eigenes rAF; Draws ließen sich in der Geste nicht zurückhalten | `layer.draw()` in der einen Szenen-rAF-Schleife; leer gewordenes Overlay einmal zeichnen | §6.3 |
| [S]: `fit` öffnete eine einzelne Notiz mit 400 % | `fit` nie über 100 % | §6.3 |
| [S]: Ein Rahmen im leeren Frame-Inneren wählte den Frame | Frames nur, wenn ganz im Rahmen | §6.3 |
| [S]: Konva ruft `visible()` als Getter auf | Der Spion zählt nur Setter | §10 WP-S |
| [S]: zusätzliche Tokens und Helfer, `limits`-Option, `setSelection` ohne Echo, `reset()` während des Ziehens | additiv übernommen | §6.2, §6.3 |
| [B]: `forGuest(…, $full)`, `forUserWithRow`/`forGuestWithRow`, `activeLink`, `PresenceStore::available`, `SyncRequest::fromBody`; `JsonBody::guardRoute` auch auf 8/10/12/15 | additiv übernommen, eingefrorene Signaturen unverändert | §4.1, §10 WP-B |
| [B]: unbekannte Op- und `put.p`-Schlüssel ignoriert; `limit` auch bei put + revive | festgehalten | §4.6 |
| Wertregeln auf dem Rohwert (PHP und JS gleich), `setPath`-Feinheiten der Golden-Datei | festgehalten | §4.7 |
| Phase 0: `l10n`-Aufrufform `t('knorke', …)`; Lockfile-Falle `@nextcloud/files`; Initial-State-`null`-Falle; zweiter Nur-Regex-Fall in `zorder-golden.json`; `HttpError::$error`; `userPass` zufällig; `gatewayIp` gilt nicht für den E2E-Container | festgehalten | §6.9, §7.1, §6.6, §4.8, §10.1, §2, §8.1, §4.9.5 |

### 14.1 Stand nach Phase 2 (11.10.2026)

**(R5)** Aktuelle Zahlen nach beiden Review-Runden: §16.3. Die Zahlen unten sind der Stand vor dem Review.

- **Phase 2 abgeschlossen, alles grün** (zwei Runden, Leitung [D], Namensraum `main`). NC 34.0.1: PHP-Unit 313/0, Integration 13/0, Smoke 104/0, `npm test` 500/0, `contract.mjs` 41/0 (263 Prüfungen), `converge.mjs --faults full` 0 Abweichungen, E01–E12 + E09b 14/0, E12-Gate ok (angemeldet 85, Gast public 34 / base 32 Anfragen), Labor-Gates 10/0, Labor-Messung mit GPU (Schwenken 59,7 fps, Zoom 57,2 fps, 4,4 % verpasst). NC 35.0.1: PHP-Unit, Integration, Smoke, E01–E05, E04b, E10, E09b grün. Prod-Container unverändert, keine Reste.
- **E04b behoben:** Ursachen lagen in [C] (Übernahme-Merker ging beim Schließen des Editors vor dem nächsten Takt verloren; schon eingereihter Zwischentext überschrieb nach Lease-Verlust den Text des Übernehmenden; `locked` vor gelandetem `tk` galt als Lease-Verlust) und in [S] (früher Rücksprung in `openEditor` verschluckte „Übernehmen“; Fokuswechsel auf den Knopf verwarf geretteten Text; Timer des alten Editors feuerte in den neuen). Flake-Gate 15/15, dazu 2/2 in den vollen Läufen.
- **Im Code:** `presence: {}` ohne Redis ([B]), Abbau-Reihenfolge Szene/Editor → `flushKeepalive` → `stop` ([C]), Status `rate_limited` mit Banner `[data-knorke-banner=rate_limited]` ([C], E2E-Fall E09b). **(R3)** Nach jedem endgültigen Status sendet `flushKeepalive` nichts mehr (§6.4). Die Status-Tokens `--knorke-*` sind Paare aus Hintergrund und Text, weil NCs `--color-error/-warning/-success` auf 34/35 Pastell-Hintergründe sind (§6.6).
- **Klarstellung §6.7:** `state().viewOnly` ist das Geräte-/Rollen-Merkmal und bleibt nach `gone`/`revoked`/`rate_limited` unverändert; den Ansehen-Modus nach einem endgültigen Status zeigt `scene().viewOnly` (§6.5).
- ~~**Offen (an das Review):** Lease-Prüfung auf dem Server nutzt die Präsenz-Map, die vor dem Board-Lock gelesen wurde.~~ **(R4) Geschlossen:** Das Review hat den Spalt nachgestellt (10–20 ms Versatz, ≈ 190 Ops je Batch: As später Text überschrieb Bs Text nach der Übernahme). Bei Batches mit Text-Patch liest der Schreibweg die Präsenz jetzt direkt nach `lockAndBumpRev` neu und prüft die Lease dagegen (§4.10.1, §4.11, T7 in §15).
- **Nur Bericht, kein Gate:** GPU-VRAM nach den Szenarien schwankt zwischen ≈ 160 und ≈ 500 MiB je Lauf (DRM-Zahl umfasst alle Puffer des GPU-Prozesses), Ursache nicht untersucht.
- **F8 (neu, Vorgabe gilt):** Besitzer sieht „Teilen“ auch auf Geräten ohne feinen Zeiger; Link-Verwaltung funktioniert dort. Vorgabe: so lassen.

---

## 15. Revision 4 – Review-Befunde

Stand 11.10.2026. Review nach Phase 2 unter der Frage „Was übersehen die grünen Tests?“. Die Einzelbefunde (INPUT-1…4, SYNC-1…5, CLIENT-1…6, AUTHZ-1…3) sind zu 17 Befunden T1–T17 zusammengefasst. **Triage: alle 17 „jetzt beheben“** (fix-now). In dieser Runde gibt es keinen Befund mit „auf M1 verschoben“, „Nutzerentscheidung nötig“ oder „wird nicht behoben“. Fehlende Schreibbudgets und Drosseln bleiben bekannte M1-Arbeit (§1.2, F5); T1 und T11 gehören trotzdem in M0, weil sie über bloßes Volumen hinausgehen (Speicher je Anfrage, Aussperren anderer). Die Querverträge aus §10.2 gelten mit den hier genannten additiven Änderungen weiter als eingefroren.

**Eingabe unvollständig:** Die Befundliste brach im Urteil zu CLIENT-6 ab. Befunde nach CLIENT-6 lagen nicht vor und brauchen eine eigene Triage-Runde. **(R5) Erledigt:** Review-Runde 2 hat die zurückgestellten Befunde OPS-1…5, CLIENT-7…10 und NC-1…7 behandelt (§16).

| # | Befund | Entscheidung | Stelle |
|---|---|---|---|
| T1 (hoch; INPUT-2, SYNC-1) | Kein Deckel auf die Gesamtdaten eines Boards (nur 5000 Objekte × 64 KiB, also ≈ 320 MiB `data`/`style`). Snapshot und Sync halten Zeilen, Fragmente, `implode` und Body gleichzeitig (≈ 3 × Nutzlast); ein rev größer als eine Seite wird ohne LIMIT geladen und ist in M0 per Frame-Freigabe erreichbar; Grabsteine laden ihre Nutzlast mit. Gemessen 871–965 MB je Anfrage: Schreiber 500 nach dem Commit, jeder Poller dahinter dauerhaft 500, Snapshot Fatal bei 512M | **Jetzt beheben [B]:** `boards.item_bytes` und `MAX_BOARD_BYTES` = 8 MiB (`limit` nur für wachsende Ops, Schrumpfen immer erlaubt), Grabsteine ohne Nutzlast, JSON inkrementell gebaut. [C]: keine Änderung (`limit` → „Board ist voll“, Text-Op → Textrettung). [D] optional: Vertragsfall „Byte-Budget → `limit`“, kein bestehender Fall ändert sich | §1.2, §3.1, §4.4, §4.6, §4.8, §4.10.1 (Schritte 5, 10–18), §4.10.2, §9.1, §9.2, §10 WP-B |
| T2 (hoch; INPUT-1) | Gespeicherte Extremschlüssel (`'z'`×64, `'0'`×63+`'1'`, zwei benachbarte 64-Zeichen-Schlüssel) lassen `keyBetween`/`keysBetween` werfen; Anlegen und „nach vorn/nach hinten“ scheitern still für jeden Client dieser Ebene. Eine strengere Server-Regel verschöbe die Wand nur | **Jetzt beheben [S]** (nur `src/model/zorder.js`): nie werfen, an der Wand die nächste gültige Grenze liefern, Gleichstand über `id`; `isValidKey`, `ZOrder::isValid`, Golden unverändert. [C]: Regressionstest in `tests/js/board` (Modell mit Extremschlüsseln: `createItem` für Notiz und Frame, `reorder` nach vorn/hinten liefern gültige `z` ohne Wurf); optional fängt `BoardSession.onIntent` Ausnahmen aus `actions` mit Toast | §4.8, §6.2, §9.3, §10.2 |
| T3 (hoch; CLIENT-1) | Verlassen innerhalb der App (Zurück-Knopf, Browser-Zurück/-Vor) verwirft Ausstehendes still, auch Offline-Arbeit, deren Erhalt der Banner verspricht; `beforeunload` feuert bei History-Navigation nicht, der Router hatte keine Sperre | **Jetzt beheben [C]:** Verlassen-Sperre für `push`/`replace`/`popstate`, `BoardSession.prepareLeave` (Editor flushen, ≈ 3 s auf Sync warten, sonst Rückfrage „Stay“/„Leave“). [S] liefert `flushEditor` (T5). [D] optional: E2E offline → Zurück → Dialog, „Stay“ hält das Board, online kommt die Notiz an; Haken `[data-knorke-dialog=leave]` | §6.5, §6.6, §6.8, §9.3, §10.2 |
| T4 (mittel; AUTHZ-1, SYNC-5) | Ein angemeldeter Link-Beitritt im Wettlauf mit Erneuern/Abschalten hinterlässt eine Mitgliedschaft auf einem zurückgezogenen Link, die kein späteres Erneuern löscht: dauerhafter, unsichtbarer Bearbeitungszugriff, verletzt F1 (nachgestellt 5/60 einzeln, 28/296 unter Last) | **Jetzt beheben [B]:** Beitritt in einer Transaktion mit Board-Lock als erster Anweisung (ohne Gen-Sprung), Link unter dem Lock neu lesen; Rückhalt in `findBoardForUser`/`listForUser` (Mitgliedschaft nur mit `link_id IS NULL` oder aktivem Link). Erneuern löscht weiter nur die Mitglieder der aktiven Links (M1 mit mehreren Links). [D] optional: Vertragsfall Beitritt gegen Erneuern über 20 Runden, kein Mitglied darf überleben | §4.3, §4.10.4, §5.2, §9.1, §9.2, §10 WP-B |
| T5 (mittel; CLIENT-2) | Neuladen oder Schließen mit offenem Editor verliert bis ≈ 1 s Getipptes ohne `beforeunload`-Hinweis (Tastatur löst kein Blur aus; `pendingCount()` ist nach dem letzten bestätigten Zwischen-Commit 0). R3 hatte das nur für `destroy()` behoben | **Jetzt beheben:** [S] `SceneManager.flushEditor(): boolean` (additiv zur eingefrorenen Fassade, mit `TextEditor`-Unterstützung und Tests); [C] ruft es zuerst in `visibilitychange` (hidden), `pagehide` und `beforeunload` | §6.3, §6.4, §6.5, §9.3, §10.2 |
| T6 (mittel; CLIENT-4, INPUT-4) | Mehrere Textrettungen auf einmal: Nur die letzte überlebt (der Dialog hat ein Feld; jeder neue Rettungs-Editor beendet den vorigen, und ein Editor mit Hinweis verwirft ohne Intent). Auch über zwei Antworten ≈ 150 ms nacheinander nach Offline-Bearbeitung | **Jetzt beheben [C]:** Rettungsliste, der Dialog zeigt alle Texte; Rettungs-Editor nur, wenn kein Editor offen ist; ein offener Editor wird nie ersetzt | §6.5, §9.3 |
| T7 (niedrig; SYNC-2) | Die Lease-Prüfung nutzt die Präsenz-Map von vor dem Board-Lock: Nach einer Übernahme überschreibt ein späterer Text des alten Halters den Text des neuen (nachgestellt bei 10–20 ms Versatz). Offener Punkt aus §14.1 | **Jetzt beheben [B]:** bei Batches mit Text-Patch und verfügbarem Redis die Präsenz direkt nach `lockAndBumpRev` neu lesen und dagegen prüfen (ein GET je Text-Batch im Lock); ohne Redis weiter reines LWW | §4.10.1, §4.11, §9.1, §13.1 (B5), §14.1 |
| T8 (niedrig; SYNC-1) | Frame entfernen hält den Board-Lock für ein UPDATE plus ein INSERT je Kind und lädt `data`/`style` aller Kinder (4900 Kinder: 3,1 s Lock, ein gleichzeitiger Schreiber wartet 3,1 s) | **Jetzt beheben [B]** (kein Vertrag): `liveChildren` nur Lagespalten, Freigabe-Schreibvorgänge gebündelt; Format der Änderungszeilen §3.5 unverändert, Konvergenz bleibt kompatibel; Byte-Beitrag freigegebener Kinder 0 (T1) | §4.10.1 Schritt 16, §9.2, §10 WP-B |
| T9 (niedrig; SYNC-4) | put + revive kann den Typ ändern: Ein entfernter und als Notiz wiederbelebter Frame behält seine Kinder, die Eltern-Invariante (§4.7 Regel 6) bricht | **Jetzt beheben [B]:** revive nur mit dem gespeicherten Typ, sonst `bad`; die Arbeitskopie bleibt unberührt, ein früheres remove gibt die Kinder normal frei | §4.6, §4.10.1 Schritt 12, §9.1 |
| T10 (niedrig; INPUT-4) | Patches bauen Zustand auf, den put nicht annimmt (> 100 Wurzelschlüssel, zu tiefe Werte); Undo von Löschen (put + revive des gespeicherten Stands) bekommt `bad`, das Objekt bleibt gelöscht. Nur mit handgemachten Anfragen erreichbar | **Jetzt beheben [B]:** Form nach jedem patch prüfen (`fitsShape`), Invariante „jedes gespeicherte Objekt ist mit revive erneut puttbar“; keine Client-Änderung | §4.7 Regel 3, §4.8, §4.10.1 Schritt 13, §9.1, §9.2 |
| T11 (niedrig; AUTHZ-3) | Ein Teilnehmer erschöpft das Budget für neue Gäste je Board und IP in ≈ 9 s und sperrt jeden Neuen hinter derselben NAT 10 min aus; Erneuern des Links setzt es nicht zurück (Ausnahme „Aussperren anderer“ aus F5) | **Jetzt beheben [B]:** Limiter-Schlüssel `knorke-guest-<board>-<linkId>`; verbleibender NAT-Zielkonflikt dokumentiert (Abhilfe: Erneuern). Zurückkehrende Gäste bleiben ausgenommen, C39 bleibt unberührt. [C] optional: 429-Text beim Gastbeitritt rät, den Gastgeber um einen neuen Link zu bitten (neuer `de.json`-Eintrag) | §4.1, §4.9.2, §9.1 |
| T12 (niedrig; AUTHZ-2) | Rollen ohne Schreibrecht (`vote`) schreiben `e`/`tk` in die Präsenz und könnten die Text-Lease halten und Bearbeiter mit `locked` sperren (latent, bis M1 Abstimm-Links bringt) | **Jetzt beheben [B]** (zwei Zeilen): `e`/`tk` nur mit `canEdit()`; Cursor und Auswahl bleiben; `view` ignoriert `me` weiter ganz | §4.9.6, §4.10.2 Schritt 0, §5.5, §9.1 |
| T13 (niedrig; SYNC-3) | Runbook-Schritt „App aus- und wieder einschalten verschiebt das Präfix“ ist falsch (NC-34-Präfix = Hash über Zustand, nach dem Wiedereinschalten identisch; `r:` überlebt, neu geladene Clients springen über revs). Die R2-Begründung „jedes `bumpRev` hält den zu hohen Wert am Leben“ ebenso | **Jetzt beheben:** Spec §5.3 c/d korrigiert; [D] zieht `docs/ENTWICKLUNG.md` §8 und `docs/PROTOKOLL.md` §12 nach (Wartung an → Restore → `*/knorke/*` über alle Präfixe löschen, genauer Befehl für den Stack → Wartung aus → alle neu laden; Neuladen allein hilft nicht; Verweis auf die M1-Board-Epoche). Kein automatischer Test; [D] liest beide Dokumente gegen §5.3 gegen | §5.3 |
| T14 (niedrig; INPUT-3) | Ein einzelnes UTF-16-Surrogat in einem ausgehenden String macht den ganzen Sync-Body für PHP ungültig (400); der Batch wird `bad` quittiert, Nicht-Text-Ops verschwinden still, der gerettete Text scheitert bei jedem Speichern erneut; ein Gastbeitritt mit solchem Namen bekommt 400 | **Jetzt beheben [C]:** `wellFormed()` (`toWellFormed` oder Regex → U+FFFD) an der Quelle (`setText`, Board-Titel, Gastname) und als Rückhalt im Transport-Encoder | §6.4, §6.5, §9.3 |
| T15 (niedrig; CLIENT-3) | Per Keepalive gesendete Ops bleiben verdichtbar: Ein späteres Undo oder Tippen kann still verloren gehen (remove + revive kollabiert, patch verschwindet im gesendeten put); dazu ein falscher Toast „Rückgängig nicht möglich“ bei `gone` auf einem schon angewendeten remove | **Jetzt beheben [C]:** Verdichtungssperre nach `flushKeepalive`; `gone` auf remove zählt als Erfolg | §6.4, §6.5, §9.3 |
| T16 (niedrig; CLIENT-5) | Der Keepalive-Body ist auf 60 KiB begrenzt, aber nicht auf 200 Ops; der Server lehnt die letzte Chance mit 400 `too_many_ops` ganz ab | **Jetzt beheben [C]:** höchstens `MAX_OPS` Ops zusätzlich zu 60 KiB, in Reihenfolge, in-flight zuerst | §6.4, §9.3 |
| T17 (niedrig; CLIENT-6) | Ein Resync wirft ein gerade bearbeitetes, fremd gelöschtes Objekt aus dem Modell; sein letzter Text erzeugt keine Op und keine Rettung (Auslöser in M0: 400-Antwort, DB-Restore, `rev < since`, `debug.setCursor`) | **Jetzt beheben [C]:** aktive IDs bleiben beim Resync im Modell (letzter Commit → `gone` → Textrettung); Text-Intent auf fehlende ID → Textrettung | §4.10.3, §6.5, §9.3 |

---

## 16. Revision 5 – Review-Runde 2

Stand 11.10.2026. **(R5)** Runde 2 behandelt die 16 geprüften Befunde, die die Triage von Runde 1 zurückgestellt hatte (OPS-1…5, CLIENT-7…10, NC-1…7), als Arbeitspunkte U1–U20, dazu zwei Restpunkte aus Runde 1 (U19 aus dem [S]-Bericht zu T2, U20 aus dem [B]-Bericht zu T11). Schwere in Klammern = nach der Prüfung. **Kein Fix-Bericht hat einen Punkt auf `notFixed` gesetzt**; U6 (Replikate) ist korrekt lösbar gewesen, der Rückfall „`dbreplica` nicht unterstützt“ im README entfällt. Die Querverträge aus §10.2 gelten mit den hier genannten additiven Änderungen weiter als eingefroren. Die Zahlen nach der Regression stehen in §16.3.

| Befund | Entscheidung | Stelle |
|---|---|---|
| OPS-1 (niedrig) | Runbook „App aus- und einschalten verschiebt das Präfix“ falsch. **Erledigt durch T13 (R4)**: §5.3 c/d korrigiert, `docs/ENTWICKLUNG.md` §8 und `docs/PROTOKOLL.md` §12 von [D] nachgezogen, Drift-Test in `dev/selftest/docs.test.mjs` | §5.3 |
| OPS-2 (mittel) | E2E-Brücke und `out/` nicht nach Namensraum getrennt; Läufe führten Brücken-Aktionen anderer Namensräume aus und stoppten deren Brücke. **Behoben [D] (U3):** `dev/e2e/out/<ns>/`, `dev/sim/out/<ns>/`, exklusive Sperre je Namensraum, Stoppdatei im Steuerverzeichnis | §8.2, §8.3, §10.2 |
| OPS-3 (niedrig) | Die Root-Brücke folgte Symlinks aus dem E2E-Container, der Container konnte Host-Skripte umschreiben. **Behoben [D] (U4):** `dev/e2e` nur lesbar, Schreiben nur in `out/<ns>`, uid 47001, strenge Namen, `mv -T --`, Steuerverzeichnis nur auf dem Host, `env.json` ohne Passwörter | §8.2 |
| OPS-4 (niedrig) | Abgebrochenes `converge` ließ `knorke_dev_skip_bump = 0,2` stehen. **Behoben [D] (U5):** Signal-Handler löscht den Schlüssel, `normalise_ns` am Start von sim und e2e | §8.3 |
| OPS-5 (niedrig) | `127.0.0.1`-Bindung hält Dev-Stacks auf diesem Host nicht lokal (Direkt-Routing). **Behoben [D] (U1) für DB und Redis:** internes Hinternetz, Redis-Passwort. **Rest beim Nutzer:** NC:80 im vorderen Netz und alle anderen Netze des Hosts (F10) | §8.1, §12 |
| CLIENT-7 (niedrig) | Nach 409 (`reload`) blieb das Board bei gestoppter Schleife bearbeitbar. **Behoben [C] (U15):** `reload` friert ein, `reloadOnce` nur ohne Risiko, `hardReload` mit Cache-Bust | §6.5 |
| CLIENT-8 (niedrig) | Präsenz sprang bei 1-/2-s-Takt um 60–80 % je Schritt. **Behoben [C] (U16):** Gleitstrecke über die beobachtete Kadenz, `delayMs` gestrichen | §6.4, §9.3 |
| CLIENT-9 (niedrig) | Maus-/Stift-Schwenk während einer Wheel-Geste startete von der alten Kamera und sprang zurück. **Behoben [S] (U17):** ein Kamerapfad zur Zeit, inkrementeller direkter Schwenk; deckt auch die drei Spiegelfälle mit derselben Ursache (Wheel/Nachlauf während eines Schwenks, Touch während eines Stift-Schwenks, Zoom-Taste während eines Schwenks) | §6.3, §9.3 |
| CLIENT-10 (niedrig) | Duplizierter Tab erbt die Client-ID (geteilter Präsenz-Eintrag; Leases sind je pid, sperren sich also nicht). **Behoben [C] (U18):** BroadcastChannel-Claim | §6.5 |
| NC-1 (mittel) | Mit `dbreplica` übernahmen Clients Cursor über Änderungen hinweg, die sie nie bekamen; Anlegen/Beitritt → 404. **Behoben [B] (U6):** `PrimaryReads::pin()` | §1.1, §3.7, §5.4, §10 WP-B |
| NC-2 (mittel) | Link-Beitritt im Wettlauf mit Erneuern hinterließ dauerhafte Mitgliedschaft. **Erledigt durch T4 (R4)**; die Umsetzung ersetzt tote Zeilen (`deleteMember` + `addMember`), hier nachgetragen | §4.3, §4.10.4 |
| NC-3 (mittel) | MySQL/MariaDB ohne utf8mb4: jedes Emoji → 500, der Client wiederholte denselben Batch endlos. **Behoben:** [B] (U7) U+FFFD-Ersatz bei der Validierung; [C] (U8) Isolierung nach 3 × 500, Verwerfen nur allein und nach 2xx, Toast und Textrettung; [D] (U2) Testmatrix mit `KD_MYSQL_UTF8MB4=0` | §3, §4.3, §4.5, §4.8, §6.4, §6.5, §8.1 |
| NC-4 (niedrig) | Gastseite verbarg mit dem Footer Impressum und Datenschutz. **Behoben:** [B] (U10) Initial-State `legal`; [C] (U9) Rechtslinks im Namensdialog, in leeren Zuständen und im Gast-Menü; Footer bleibt verborgen (F7) | §4.9.1, §6.6, §6.8, §10.2 |
| NC-5 (niedrig) | Gast-Links übergingen Nextclouds Link-Richtlinie. **Behoben als Vorgabe-Entscheidung U11:** [B] (U11) `LinkPolicy`, 403 `links_disabled`, `linksAllowed`, `a:`-Merker; [C] (U12) Teilen-Dialog, Endzustände, Banner. **Vom Nutzer bestätigt (F9, 11.10.2026)** | §1.1, §1.2, §4.1–§4.4, §4.9.2, §4.9.3, §4.9.7, §4.10.4, §5.1, §5.2, §6.4–§6.8, §12 |
| NC-6 (niedrig) | Rohes `LIMIT` bricht auf Oracle; `info.xml` ohne DB-Deklaration. **Behoben:** [B] (U13) `<database>` pgsql/mysql/sqlite, Oracle ausgeschlossen, Portabilität auf allen Arten geprüft (keine Abfrage geändert), Integration auf jeder Art; [D] (U2) `KD_DB`-Matrix, `db.sh` | §1.1, §3, §8.1, §9.2, §10.3 |
| NC-7 (niedrig) | Board-Liste: Zeilen mit `role=link` enthielten Aktionsknöpfe; Umbenennen war eine fokussierbare Überschrift. **Behoben [C] (U14):** `<li>` + echter Link, `NcActions` als Geschwister, Umbenennen-Knopf mit Label | §6.6, §6.8 |
| U19 (Rest aus T2) | **Behoben [C]:** `board/extremeZ.test.mjs` mit echtem Modell; Wächter um `onIntent` und Shell-Aktionen mit Toast | §6.5, §9.3 |
| U20 (Rest aus T11) | **Behoben [C]:** 429-Text beim Gastbeitritt rät, um einen neuen Link zu bitten | §6.6 |

### 16.1 Entscheidungen beim Nutzer

1. ~~**U11 / F9 – Link-Richtlinie:** Vorgabe umgesetzt (Core-Richtlinie für den Besitzer, kein eigener Schalter, Passwort/Ablauf erst M1). Bestätigen oder eine Alternative wählen (§12 F9).~~ **Entschieden 11.10.2026:** Nutzer hat die Vorgabe bestätigt.
2. **OPS-5-Rest / F10 – Direkt-Routing auf dem Host:** Docker 27.5.1 + `FORWARD ACCEPT` macht jedes nicht-interne Container-Netz aus dem LAN erreichbar, Prod eingeschlossen. Abhilfe hostweit (`DOCKER-USER`-Regel oder Docker ≥ 28). **11.10.2026:** Der Nutzer lässt das in einer eigenen Sitzung beheben (Auftrag `stacks/_handoffs/docker-forward-haertung.md`); Knorke-Agenten fassen den Host nicht an.
3. **Docker-Adress-Pools:** Mit zwei Netzen je Stack waren die Vorgabe-Pools bei ≈ 12 Knorke-Netzen erschöpft (§8.1). Größere bzw. weitere `default-address-pools` sind eine Daemon-Einstellung.
4. **Verzeichnisrechte des Repos:** Die Verzeichnisse sind 777 (Unraid-Freigabe-Vorgabe), jedes Host-Konto könnte Skripte ersetzen, die root ausführt. [D] hat nur die Dateimodi eigener Skripte auf 755 gesetzt.

### 16.2 Offene Restpunkte (keine Nutzerentscheidung)

- [S]: `dev/scene-lab/run.sh` mountet sein Verzeichnis weiter les- und schreibbar in einen root-Container (Muster von OPS-3); die Behandlung wie bei `dev/e2e` (nur lesbar, eigenes Ausgabeverzeichnis, Nicht-root) steht aus.
- ~~[D] optional: Vertragsfälle für `links_disabled`, `legal` und 4-Byte-Text; E2E für U15.~~ **Erledigt durch [D]-Tests:** C45–C48 (C48 nur mit `KD_MYSQL_UTF8MB4=0`), Lauf-Invariante CINV, E15 (Rechtslinks), E16 (Admin schaltet Links ab), E17 (`reload` friert ein), T3-Verlassen-Dialog als E2E. `replica.sh` lief in der Regression auf NC 34 und 35, ist aber nicht in `dev/sim`/E2E eingebunden. **Offen:** E2E-Fall für U8 (500 für einen Markertext → Toast + Rettung); Ad-hoc-Nachweis im Scratchpad des Orchestrators (`c2/adhoc/v2.mjs`).
- ~~[D] Vorschlag: Seitenkanal von `dev/sim` portieren.~~ **Erledigt für `contract`:** Die Vertragssuite läuft auf allen DB-Arten (übersprungen: C24 außerhalb pgsql, C48 außer bei utf8mb3, C37 bei utf8mb3). **Offen:** `converge` läuft nur auf pgsql (spielt das Änderungsprotokoll über psql ab), Konvergenz mit Fehlereinspielung ist auf MariaDB/MySQL/SQLite also ungeprüft.
- [C]: Die leeren Zustände der Gastseite (`revoked`/`invalid`/`disabled`) stehen mit wenig Kontrast direkt auf dem Theming-Hintergrund (älter als diese Runde); nur die Rechtslinks haben eine lesbare Pille.
- [C]: `guestTransport` schickt im Beitrittsbody die Client-ID von vor dem Claim (U18); harmlos, ein `getClient()` räumte es auf.
- Host: 44 hängende Docker-Volumes beim Abbau stammen nicht aus Namensraum `c`; ihre Herkunft ist ungeklärt.
- Altlasten: Berichte von vor R5 unter `dev/e2e/out/{report.*,shots/}` und `dev/sim/out/*` (gitignored); ein Namensraum namens `shots` kollidiert mit dem alten `shots/`, solange es existiert.

### 16.3 Stand nach der Regression (11.10.2026)

Eine Regressionsrunde, alles grün, keine roten Tests, keine Harness-Korrekturen. Prod-Container unverändert (StartedAt/RestartCount wie Baseline), keine Knorke-Reste außer dem Nutzer-Stack `try`.

| Suite | Ergebnis |
|---|---|
| PHP-Unit | 343/0 (2483 Assertions) auf NC 34.0.1 und 35.0.1 |
| PHP-Integration | 26/0 je Stack: NC 34 mit pgsql 17.10, MariaDB 11.8.9, MySQL 8.4.11, SQLite 3.46.1, MariaDB utf8mb3 (`KD_MYSQL_UTF8MB4=0`); NC 35 mit pgsql |
| Smoke | 126/0 auf denselben sechs Stacks |
| `tests/php/replica.sh` | 19/0 auf NC 34 und 35 (pgsql mit eingefrorener Replik) |
| Node-Tests | 615/0 |
| Harness-Selbsttests | 38 (37 grün, 1 übersprungen `KD_MDI_JS`); `isolation.sh` 26/27/27/24/28 je DB-Art; Brücken-Selbsttest 39 (pgsql) bzw. 38 |
| Vertrag | pgsql (NC 34 und 35): 49 ok / 1 übersprungen (C48), 458 Prüfungen; MariaDB, MySQL, SQLite: 48 / 2 übersprungen (C24, C48), 453; MariaDB utf8mb3: 48 / 2 übersprungen (C24, C37), 471 |
| `converge --faults full` | 0 Abweichungen auf NC 34 und 35 (nur pgsql, s. §16.2) |
| E2E | NC 34 pgsql: 19/0 (E01–E17, E04b, E09b), E06-Fastpath-Gate grün; Flake-Gate E03/E04/E04b 30/0; NC 35 pgsql: 10/0 plus E15–E17 3/0; E01–E04 auf MariaDB und SQLite je 4/0 |
| Szenen-Labor | Gates 10/0, gesamt 26/0 |

Vorher (§14.1, Runde 1): Unit 326, Integration 22 (nur pgsql), Smoke 104, Node 561, Vertrag 45 Fälle / 341 Prüfungen, E2E 16.

### 16.4 Gemeldete Zahlen der Fix-Berichte (vor der Regression, überholt durch §16.3)

[B]: PHP-Unit 343 (vorher 326) auf NC 34 und 35, Integration 26 (vorher 22) je DB-Art, Smoke 126 (vorher 104), `replica.sh` 19 (neu), C24 grün auf NC 34 und 35. [C]: Node-Tests 615/0. [D]: Harness-Selbsttests 34 (33 grün, 1 übersprungen `KD_MDI_JS`; neu `dev/selftest/bridge.test.mjs`, `dev/selftest/namespaces.test.mjs` mit 4 Tests, ein `cli.test.mjs`-Fall), Brücken-Selbsttest 33 Prüfungen auf pgsql und 23 auf anderen Arten, beobachtete Node-Unit-Zahl 571. [S]: U17 durch `gesture.test.mjs` und `cameraPaths.test.mjs` abgedeckt, Labor-Gates unverändert.
