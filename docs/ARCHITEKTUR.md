<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Knorke – Architektur

Kurzfassung von `docs/SPEC-M0.md` §3–§7 und der Änderungen aus `docs/SPEC-M1.md` (Stand Stufe 0) für Leser ohne die Spezifikation. Bei Widerspruch gilt die Spezifikation. Den `/sync`-Vertrag im Detail beschreibt `docs/PROTOKOLL.md`.

## 1. Was Knorke ist

Ein Workshop-Board als Nextcloud-App (`knorke`, NC 34 und 35): eine unendliche Leinwand mit Haftnotizen und Frames, Live-Cursor, Text-Bearbeitung mit Lease, ein Bearbeitungslink je Board für Gäste ohne Konto. Tablets und Handys (ohne feinen Zeiger) sehen nur zu. Datenbanken: PostgreSQL, MySQL/MariaDB (auch Altinstallationen ohne utf8mb4) und SQLite; `appinfo/info.xml` deklariert genau diese drei, Nextcloud verweigert die Installation auf Oracle (§2.7).

Leitentscheidungen:

- **Serverautoritativ, last writer wins (LWW) je Pfad.** Keine CRDTs: Der Server ordnet alle Schreibvorgänge eines Boards über einen Zeilenlock auf die Board-Zeile, und jeder Pfad eines Objekts (`x`, `data.text`, `style.fill`, …) ist ein Register. `x`, `y` und `parent` bilden zusammen **ein** Register (Lagegruppe).
- **Eine Anfrage je Takt.** Der Client schickt alle 400 ms (aktiv) bis 5 s (versteckter Tab) genau ein `POST …/sync` mit eigenen Ops, Bestätigungen, Präsenz und Cursor und bekommt verdichtete Änderungen, Bestätigungen und die Präsenz der anderen zurück. Der Takt zählt ab Anfragebeginn.
- **Kein eigener Server-Prozess.** Polling über normale Controller-Routen, Redis über Nextclouds verteilten Cache (`ICacheFactory`), keine rohen Redis-Befehle.
- **Konva imperativ, außerhalb von Vue.** Modell und Szene liegen außerhalb der Vue-Reaktivität; Vue zeigt nur kleine Zustände (Status, Auswahl, Teilnehmer, Zoom).

## 2. Server

```
Controller (Routen §4.1)            Services                                 Stores / Redis
  PageController      ─┐            Access ── GuestToken, LinkThrottle         BoardStore (boards, links, members)
  PublicPageController ┤            BoardService                               ItemStore  (items, changes; JSON wörtlich gespleißt)
  BoardApiController   ┼─ JsonBody ─ SyncService ── OpValidator, ItemRegistry, FastCache (r:, a:, g:)
  SyncController       ┤   Input      │              PathOps, ZOrder          PresenceStore (p:)
  PublicSyncController ┘              └─ applyOps (Schreibweg) / sync (Leseweg)
```

- **Routen:** Seiten `/`, `/b/{id}`, `/join/{token}`, Gastseite `/p/{token}`; API `/api/v1/…` für Angemeldete (CSRF an), `/pub/v1/…` für Gäste (Token im Header `X-Knorke-Guest`, `refuseCrossSite` gegen fremde Seiten). Keine OCS-Hülle.
- **Eingaben:** Body-Felder kommen nur über `JsonBody::read` (Pflicht `Content-Length`, ≤ 1 MiB, nur erlaubte Schlüssel, Routenparameter nicht überdeckbar) und `Input::*`.
- **Fehler:** immer `{"error": "<code>", "message": "<English text>"}`. 401 (Session weg) und 412 (CSRF) kommen von Nextcloud als `{"message": …}`; der Client entscheidet dort am Status.

### 2.1 Datenmodell

| Tabelle | Zweck |
|---|---|
| `knorke_boards` | Board mit Besitzer, Titel, **`rev`** (der Cursor, +1 je Schreib-Batch), `min_rev`, `item_count`, `item_bytes` (Byte-Budget, Σ der gespeicherten `data`+`style`), `acl_gen`, `link_gen`; seit M1 `meta` (JSON der Board-Metadaten), `meta_rev` (rev der letzten Titel-/Meta-Änderung) und `vote_link_gen` |
| `knorke_links` | Bearbeitungslinks (24 Zeichen Token); zurückgezogene bleiben 30 Tage mit `revoked_at` stehen |
| `knorke_members` | Mitglieder über einen Link (der Besitzer steht nicht drin) |
| `knorke_items` | ein Objekt je Zeile: Typ, Eltern, z-Schlüssel, Geometrie, `data`/`style` als JSON, `rev` der letzten Änderung, Grabstein-Flag. **(R22)** Ein Grabstein trägt `data` und `style` als `{}` (die Nutzlast bleibt nur im Änderungsprotokoll, bis Schnitt und Byte-Deckel sie löschen) |
| `knorke_changes` | Prüfprotokoll: genau eine Zeile je Objekt und rev (`put` voll, `patch` nur effektive Pfade, `remove`) |

Koordinaten sind relativ zum Eltern-Container; in M0 sind Container (Frames) immer an der Wurzel.

**M1-Migration** (`Version000200Date20261012000000`, App-Version 0.2.0, ein einziges `occ upgrade` für ganz M1): dazu `knorke_links.password_hash`/`expires_at`, `knorke_items.start_item`/`end_item`/`locked` mit zwei Indizes, die neuen Tabellen `knorke_shares`, `knorke_vote_sessions`, `knorke_votes`. Spalten und Tabellen späterer Stufen bleiben bis dahin ungenutzt. Reparaturschritte: `InitEpoch` (Board-Epoche setzen, falls leer; nie lazy) und `BackfillItemBytes` (nur für Stacks, die `item_bytes` noch nicht hatten).

**M2-Migration** (`Version000300Date20261017000000`, App-Version 0.3.0, ein `occ upgrade`): ergänzt `knorke_items` um `group_id` (VARCHAR(26), nullable), `locked_by` (VARCHAR(80), nullable, `u:<uid>`/`g:<gid>`) und `locked_name` (VARCHAR(64), nullable, Anzeigename zum Zeitpunkt der Sperre) sowie den Index `knorke_items_group (board_id, group_id)`. Kein Backfill (NULL = keine Gruppe, nicht gesperrt), `locked` aus der M1-Migration bleibt. Seit den Factory-Jobs 023 („Sperren“) und 026 („Gruppieren“) stehen sie in `LOAD_COLS`/`UPDATE_COLS`: `group_id` schreiben ein put (`p.group`), der patch-Pfad `group` und das Auflösen einer Gruppe, der nur ein Mitglied bleibt (`writeBatch` Schritt 16c setzt dessen `group_id` auf NULL); die Sperrspalten setzt der patch-Pfad `lock` (`docs/PROTOKOLL.md` §6.1, §6.2). Snapshot, Gast-Beitritt und `itemsSince` lesen sie und liefern `group`/`lock` (PROTOKOLL §4); `lock.by` ist die pid (`Access::derivePid`), die gespeicherte Principal-ID verlässt den Server nie.

### 2.2 Schreibweg (`SyncService::applyOps`)

1. Ops vor der Transaktion prüfen (Format, Rolle, z-Schlüssel, Lagegruppe, Wertregeln). Nur `bad`/`denied` → keine Transaktion, kein rev-Sprung.
2. `UPDATE boards SET rev = rev + 1` als erste Anweisung (Zeilenlock), betroffene Objekte und genannte Eltern in einer Abfrage laden (inkl. Grabsteine).
3. Ops in Reihenfolge gegen Arbeitskopien anwenden: put → `ok`/`dup`/`gone`/`limit`, patch → Pfade setzen (Text-Lease prüfen → `locked`), remove → Grabstein. Eltern-Invariante: lebender Container passenden Typs; ein Grabstein als Elternteil setzt das Objekt an die Wurzel und erhält die absolute Lage.
4. Container, die am **Ende** des Batches entfernt sind, geben ihre lebenden Kinder frei (`parent = null`, absolute Lage bleibt).
5. Je Objekt genau eine Zeile in `items` und `changes`. Hat der Batch nichts Wirksames geschrieben, wird zurückgerollt (`acks.rev` = beobachteter rev).
6. Nach dem Commit `r:<board>` in Redis anheben.

### 2.3 Leseweg (`SyncService::sync`)

Präsenz zuerst schreiben (damit eine Lease-Übernahme schon für die Text-Ops derselben Anfrage zählt), dann Ops anwenden, dann ausliefern: alle Objekte mit `since < rev ≤ upTo`, **je Objekt verdichtet** auf den letzten Stand (über `items.rev`, nicht über das Log), Seiten zu 500 Objekten, die nie einen rev zerteilen.

### 2.3a Meta-Kanal (M1)

Titel und Board-Metadaten (`meta`: Timer, Abstimmung, „Alle zu mir“ ab Stufe 3) reisen im bestehenden `/sync`, ohne eigene Anfrage je Takt:

- **Schreiben** (`MetaService::write`): `lockBoard` als erste Anweisung (serialisiert mit Objekt-Batches), danach `title`/`meta`/`meta_rev` mit eigenem SELECT lesen (`meta` steht bewusst nicht in `BoardStore::BOARD_COLS`: bis 256 KiB, die heißen Lesewege lesen es nie), die Änderung anwenden (≤ `MAX_META_BYTES`), dann in **einer** Anweisung `meta_rev = rev + 1, rev = rev + 1`. Keine `changes`-Zeile (Aktivitätslog erst M2). Nach dem Commit `r:<board>` anheben. `BoardService::rename` läuft seit Stufe 0 darüber; M0 änderte nur `title` ohne rev, offene Clients sahen den neuen Titel nie.
- **Lesen:** Der Fastpath kennt `meta_rev` nicht (ein eigener Redis-Wert wäre ein Wettlauf zwischen `a:` und `r:`); weil `meta_rev` im rev-Raum liegt, hebt jede Meta-Änderung `rev`, und der nächste Poll jedes Clients nimmt den langsamen Pfad. Dort liest `ItemStore::readHead` `rev`, `min_rev`, `meta_rev`; ist `since < meta_rev`, kommt `board: {title, meta, metaRev}` in die Antwort. Wiederholte Auslieferung ist harmlos (der Client übernimmt nur einen höheren `metaRev`).
- **Client:** `SyncClient` → `onMeta` (vor `onChanges`, auch im Resync-Zweig) → `BoardSession` führt nur vorhandene Schlüssel zusammen → Shell; ein offenes Umbenennen-Feld wird nicht überschrieben (E19). Snapshot und Beitritt tragen `board.meta` und `board.metaRev` für alle Rollen; `meta` hängt nie vom Betrachter ab (Regel für den privaten Modus in M2).

Dazu kommt mit Protokoll 2 `now` (Serverzeit in ms) in jeder Antwort; `board/clock.js` gleicht damit die Uhr ab (Timer, Abstimmungs-Restzeit).

### 2.4 Redis

| Schlüssel | Inhalt | TTL |
|---|---|---|
| `r:<board>` | aktueller rev | 30 s, bei jedem Anheben erneuert |
| `a:<board>` | `[aclGen, linkGen, minRev, links, voteLinkGen]` (`links` 1/0: erlaubt Nextcloud dem Besitzer Links, §2.5; seit M1 fünf Zahlen); gelöscht `[-1,-1,-1]`; jede andere Form (auch die alte vierstellige) gilt als Fehltreffer | 120 s (gelöscht 300 s) |
| `g:<board>:<uh>` | Grant eines Nutzers `aclGen\|role\|origin` (Herkunft `o` Besitz, `l` Link, ab Stufe 2 `s`/`f` Freigabe); zweiteilige M0-Werte sind Fehltreffer | 120 s |
| `p:<board>` | Präsenz-Blob aller Teilnehmer (JSON) | 60 s, nach jedem `cas` erneuert |
| `wd:<board>:<tag>` | **(R22)** Bytes aller `/sync`-Anfragen mit Ops dieses Boards am UTC-Tag `tag` (Tagesquote `budget_bytes_board_day`) | 25 h |
| `wu:<uh>:<tag>` | **(R22)** dasselbe je Konto über alle Boards (`budget_bytes_user_day`; `uh` wie bei `g:`, Gäste zählen hier nicht) | 25 h |

**Präfix und Board-Epoche (M1, SPEC-M1 §5.1/§5.4):** `FastCache` und `PresenceStore` holen ihren Cache mit `createDistributed('knorke/' . $epoch . '/')`; echte Schlüssel heißen also `<globales Präfix>/knorke/<epoch>/<key>`, Werkzeuge suchen mit `*/knorke/*/<key>` (`dev/selftest/docs.test.mjs` prüft die Form). Die Epoche (`IAppConfig knorke/epoch`, 8 Zeichen, nicht lazy, also ohne Abfrage aus dem vorgeladenen Satz) ist ein injizierter Dienst `Epoch`; der Client schickt sie in jedem `/sync` als `ep`, eine abweichende gibt `resync`. `occ knorke:epoch:rotate` macht nach einem DB-Restore alle alten Schlüssel auf einmal unsichtbar (Runbook `docs/ENTWICKLUNG.md` §8).

**Fastpath:** Ein leerer Sync eines Angemeldeten mit `since == rev` kostet 4 GETs, 1 EVAL, 1 EXPIRE und **null App-SQL** (der Epochen-Vergleich liest die vorgeladene App-Config). Sicherheitsnetze: `r:` verfällt nach 30 s (ein verlorenes Anheben heilt so), und `since > r:` heißt „Redis hinkt“ → DB fragen. Fällt Redis aus, läuft alles korrekt, nur teurer, über SQL; Präsenz ist dann leer.

### 2.5 Gäste und Links

- Ein aktiver Bearbeitungslink je Board; Erneuern und Abschalten erhöhen `link_gen` und `acl_gen` und entfernen die über den alten Link beigetretenen Mitglieder.
- Gast-Beitritt mit Namen (`POST /pub/v1/{token}/join`) → signiertes Gast-Token (HMAC, kein DB-Zugriff zum Prüfen), gebunden an das Board (`b`) und die Link-Generation (`lg`). Wer mit dem alten Token wiederkommt, behält seine Identität.
- Die **pid** ist eine opake, je Board stabile Teilnehmer-ID (HMAC aus Board und Principal). Gäste sehen nie Uids oder E-Mails, nur Anzeigenamen.
- **Drossel nur bei Fehltreffern:** Nur nie ausgestellte Tokens zählen als Fehlversuch (Pulse-Muster). Ein zurückgezogener Link wird als „zurückgezogen“ beantwortet, ohne zu zählen; so sperrt ein erneuerter Link keine Workshop-NAT aus.
- **Link-Richtlinie von Nextcloud** (Runde 2, U11; vorläufige Entscheidung, Bestätigung durch den Nutzer steht aus): Ein Bearbeitungslink ist ein öffentlicher Link seines **Besitzers**. Knorke fragt `IManager::shareApiAllowLinks($besitzer)` (`LinkPolicy`): den globalen Schalter „Teilen über Link erlauben“ (`core shareapi_allow_links`) samt Gruppen-Ausnahme (`shareapi_allow_links_exclude_groups`); es zählen die Gruppen des Besitzers, nie die des Besuchers, ein gelöschter Besitzer heißt „keine Links“. Verbietet die Richtlinie Links, antworten Link anlegen/erneuern, Gast-Beitritt, Gast-Snapshot, Gast-Sync und der angemeldete Beitritt 403 `links_disabled`, und eine Mitgliedschaft über den Link gewährt nichts (404, als wäre der Link aus). **Nichts wird zurückgezogen:** `link_gen` bleibt, und sobald Links wieder erlaubt sind, gelten derselbe Link, seine Mitglieder und alte Gast-Tokens wieder. Der Fastpath liest die Richtlinie aus `a:<board>[3]`; eine Änderung des Admins erreicht offene Boards deshalb erst, wenn `a:` abläuft (≤ 120 s), dazu kommen 3 s App-Config-Cache von Nextcloud. Ein eigener Admin-Schalter fehlt in M0; ein erzwungenes Link-Passwort und ein erzwungenes Ablaufdatum beachtet M0 **nicht** (M1).
- **Rechtslinks auf der Gastseite** (U9/U10): Die Gastseite blendet Nextclouds Fußzeile aus (F7). Impressum und Datenschutzerklärung aus theming (`imprintUrl`, `privacyUrl`) kommen deshalb als Initial-State `legal` mit (nur absolute http(s)-URLs) und stehen im Namensdialog, im Menü der Gast-Kopfleiste und unter den leeren Zuständen.

### 2.6 Text-Lease

Wer den Text eines Objekts bearbeitet, trägt dessen ID im Präsenzfeld `e`. Halter ist der frische Eintrag mit dem kleinsten Rang (wer zuerst öffnet). Text-Patches gegen eine fremde, frische Lease beantwortet der Server mit `locked`; andere Pfade (Farbe, Lage) bleiben frei. „Übernehmen“ (`me.tk = 1`) macht den Übernehmenden zum Halter. Der Client verliert getippten Text nie still (Textrettung). Weil der Server die Präsenz vor den Ops schreibt, nennt der Client nach dem Schließen das Objekt in `e` weiter, bis sein letzter Text bestätigt ist (Lease-Nachlauf); Einzelheiten und die Client-Pflichten rund um `tk` in `docs/PROTOKOLL.md` §7.1 und §10.

### 2.7 Datenbanken, Lesereplikate, 4-Byte-Text

- **Portables SQL** (Runde 2, U13): Alle Abfragen laufen auf PostgreSQL, MySQL/MariaDB und SQLite (rohes `LIMIT`, `CASE`, mehrzeiliges `INSERT`, `insertIgnoreConflict`, BIGINT-Autoincrement). SQLite sperrt beim Schreiben die ganze Datei: Schreiber verschiedener Boards warten aufeinander; für Test und Entwicklung reicht das, Nextcloud selbst rät von SQLite im Betrieb ab. MySQL/MariaDB puffern ganze Ergebnismengen (`pdo_mysql`), der Speicherbedarf eines großen Snapshots ist dort etwas höher.
- **Lesereplikate** (`dbreplica`, U6): Jede Knorke-Abfrage liest vom Primärserver. `Db\PrimaryReads::pin()` läuft vor dem ersten Knorke-SELECT einer Anfrage, aber nur, wenn `dbreplica` gesetzt ist und keine Transaktion läuft: eine leere Transaktion (BEGIN/COMMIT) lässt Doctrine zum Primärserver verbinden, und der bleibt für den Rest der Anfrage. Kosten: zwei Round-Trips je Anfrage mit Knorke-SQL, ohne `dbreplica` keine; der leere Fastpath-Sync bleibt ohne SQL. Grund: Ein hinterherhinkendes Replikat lieferte zusammen mit dem Redis-rev eine leere Seite, deren rev der Client als Cursor übernahm, und Anlegen → Öffnen, Link und Beitritt antworteten 404.
- **4-Byte-UTF-8** (U7): Kann die Datenbank keine 4-Byte-Zeichen speichern (`IDBConnection::supports4ByteText()` = false, MySQL/MariaDB mit `mysql.utf8mb4 = false`), ersetzt der Server jeden Codepunkt über U+FFFF (Emoji u. a.) in Board-Titeln und in jedem String von `data`/`style` durch U+FFFD – beim Prüfen, nie als 500. Die Zahl der Codepunkte bleibt gleich, Längengrenzen gelten weiter; `item_bytes` und das `changes`-Log halten die gespeicherte Form. Der Schreiber bekommt seine gespeicherten Objekte in `items` derselben `/sync`-Antwort und gleicht sich ohne Neuladen an. Gastnamen stehen nicht in der Datenbank und bleiben unverändert.

## 3. Frontend

```
Vue-Shell (App.vue / PublicApp.vue / BoardView.vue)   kleine Zustände ≤ 10 Hz
        │ Befehle                 ▲ ui-Callbacks
BoardSession (markRaw) ── actions.js → Ops + Inverse → undo.js
        │                       SyncClient ── transport/http ──► POST …/sync
        │                       Replica: bestätigt ⊕ ausstehend = sichtbar
        ▼                       presence.js (Interpolation)
SceneModel (Objekte, absolute Boxen, rbush, Ordnung) ── ChangeSummary ──► SceneManager (Konva, Eingabe, Overlays)
```

- **`src/model/`** (frameworkfrei, in Node getestet): ULIDs und Client-IDs, Pfad- und Wertregeln (Spiegel von `PathOps.php`, gemeinsame goldene Fälle), z-Schlüssel (fractional-indexing, base 36, gleiche Gültigkeitsregel wie der Server), Typ-Registry, Geometrie, `SceneModel` mit seinem Gruppen-Index (seit Factory-Job 026: `Map<groupId, Set<id>>` der Objekte mit `group`, gepflegt in `load`/`apply`; `membersOf(groupId)` in Stapelreihenfolge, `groupSize(groupId)` ohne Sortieren) und `src/model/groups.js` (rein, ohne Szene und DOM: `groupOf`, `expandGroups`, `wholeGroups`, `heldGroup`, `movableIds`, `blocksOf`, `groupPlan`, `isOneGroup`, `ungroupPlan`, `groupSummary`; eine Gruppe zählt erst ab zwei Mitgliedern im Modell).
- **`src/scene/`** (Konva 10.7.1, nur `Core` + `Rect`/`Text`/`Line`): zwei Konva-Ebenen (statisch; Overlay mit Zieh- und UI-Gruppe), Kamera nur per `stage.setAttrs` einmal je Frame, Culling durch Herausnehmen der Knoten (Knoten werden erst beim ersten Sichtbarwerden gebaut), Treffertest über das Modell (rbush), LOD unter 30 % (kein Text, kein Schatten). Notiz-Schatten malt die Szene seit Stufe 4 mit Verläufen (`src/scene/nodes/shade.js`: Gauß-Abfall wie ein Canvas-Schatten, vier Randbänder mit einem linearen, vier Ecken mit einem radialen Verlauf) statt mit Canvas-`shadowBlur`, weil WebKit jeden weichgezeichneten Schatten einzeln rechnet (im Labor ≈ 25 statt ≈ 59 fps beim Schwenken bei 100 %); gleiche Optik, in Screenshots nach Angabe von [S] höchstens 11–12 von 255 Stufen Unterschied. **CSS-Transform-Gestenpfad:** Während Wheel- und Touch-Gesten bleibt Konva unberührt, nur `.konvajs-content` bekommt `translate/scale`; am Gestenende wird einmal synchron neu gezeichnet. Fremde Cursor, Editier-Chips und der Text-Editor sind DOM.
- **`src/sync/`**: `http.js` (Fehler am Status entscheiden), `transport.js` (Nutzer/Gast), `Replica.js` (eigene Ops haben Vorrang, Verdichtung nur in der Warteschlange, stabile Batch-Reihenfolge je ID), `scheduler.js` (Takt ab Anfragebeginn), `SyncClient.js` (genau eine Anfrage in Arbeit, Backoff, Resync, Offline), `presence.js` (Gleiten von der angezeigten Lage zur neuesten Probe über den beobachteten Abstand der Präsenz-Antworten, Runde 2 U16).
- **Fehlerpfade (Runde 2):** Drei App-500 in Folge für denselben Batch machen seine Ops verdächtig; der Client halbiert den Batch, legt eine einzeln scheiternde Op beiseite und schickt alles andere weiter. Verworfen wird eine Op erst nach drei Fehlschlägen allein, jeweils direkt nach einer 2xx-Antwort (nie während eines Ausfalls), mit Hinweis und Textrettung (U8). Ein 409 `protocol` friert das Board ein wie jeder andere endgültige Status und lädt höchstens einmal je Tab automatisch neu, mit Cache-Bust und nur, wenn nichts auf dem Spiel steht (U15). Zwei Tabs mit geklonter Client-ID (Tab duplizieren) einigen sich über `BroadcastChannel` (U18).
- **`src/board/`**: `BoardSession` verdrahtet Szene und Sync, erzeugt Ops aus Intents (Verschieben aus der Ausgangslage, nie aus dem Modell), Undo/Redo eigener Aktionen (≤ 50), Textrettung, Debug-Haken `window.__knorke` (nur bei `knorke_dev`).
- **Shell:** Vue 3 mit @nextcloud/vue 9, Mini-Router über die History-API, Board-Liste, Board-Ansicht, Gastseite mit Namensdialog, Teilen-Dialog.

**Sicherheit im DOM:** Text kommt nur über `textContent` bzw. Vue-Interpolation ins DOM; in `src/` gibt es kein `innerHTML`/`v-html` (Grep-Tests). Namen sind Daten, kein Markup.

## 4. Bündel

`npm run build` (Vite 7, @nextcloud/vite-config) erzeugt genau `js/knorke-main.mjs`, `js/vendor-<hash>.chunk.mjs`, `js/canvas-<hash>.chunk.mjs` und `css/knorke-style.css`; `build/check-bundle.mjs` prüft Form und Größe (≤ 350 KiB gzip). Eine kalte Board-Seite lädt damit 3 JS + 1 CSS (+ 1 l10n für deutsche Nutzer) und genau einen Snapshot bzw. Beitritt vor dem ersten Sync.

## 5. Was später kommt

- **M1** in fünf Stufen (SPEC-M1 §1.3). **Stufe 0 (Fundament):** Protokoll 2 mit dem ganzen M1-Drahtvertrag, die ganze M1-Migration, alle 26 Routen (17–26 als 501-Stubs bis zu ihrer Stufe), Meta-Kanal (Live-Titel), Serverzeit `now`, Board-Epoche, CI. Danach: Formen, Text, Transformer, Kopieren/Einfügen (1a), Verbinder (1b), explizites Teilen mit Rollen und Abstimm-Link, Link-Passwort und Ablauf, LOD 2 (2), Abstimmen, Timer, Folgen (3), Schreibbudget, Grabstein-Bereinigung, Lastlauf (4).
- **M2** (Stand SPEC-M1 §1.2, Revision 20; dort steht auch, was M1 für jeden Punkt schon vorsieht):
  - privater Modus und versteckte Frames (serverseitig gefiltert; `SyncService::authorize`/`authorizeRef` sind die Haken, Präsenz wird wie `itemsSince` gefiltert);
  - Vorlagen (das Zwischenablage-Format `knorke:1` ist das Import-Format), Export als SVG, PNG, PDF und CSV;
  - Kommentare, Bilder aus Nextcloud-Dateien (als Datei-ID), Aktivitätslog, Papierkorb und Wiederherstellen, Board-Schnappschüsse als Datei, Rich Text;
  - Benachrichtigung „Board geteilt“ (**umgesetzt**, Factory-Job 025, SPEC-M1 §4.10.5: Konten sofort, Mitglieder von Gruppen und Teams beim nächsten Cron-Lauf, Gruppen und Teams mit mehr als 500 Mitgliedern keine; der Notifier prüft beim Anzeigen über `roleFor()`, davor bei Konten der Guests-App deren App-Whitelist über `GuestsAppWhitelist::allows()`, seit Factory-Job 055), Unified Search, Smart Picker und Team-Ressourcen-Anbieter (alle über `ShareService::roleFor()`);
  - **Gruppieren** (vom Nutzer am 13.10.2026 auf M2 gesetzt, vorher „später“; **umgesetzt**, Factory-Job 026, SPEC-M1 §1.2, Drahtform und Auflösen in `docs/PROTOKOLL.md` §6.1 und §6.2): Strg/⌘+G / Strg/⌘+Umschalt+G, ein Klick wählt die Gruppe, ein zweiter Klick das Mitglied, ein Doppelklick bearbeitet seinen Text, die Gruppe gilt für alle Clients. `items.group_id` (nullable) kommt mit der M2-Migration, nicht nachträglich in 0.2.0; die Zugehörigkeit ist ein Feld je Objekt (LWW wie andere Felder), Gruppieren und Lösen sind eine Mehrfach-Op, eine Ebene (keine verschachtelten Gruppen), Verbinder zwischen Gruppenmitgliedern wandern mit. **Eine Gruppe sperren** = `locked` an allen Mitgliedern in einer Mehrfach-Op;
  - **Sperren** (Entscheidung des Nutzers vom 13.10.2026, SPEC-M1 §1.2 und §11 Q10; vorher sperrten nur Moderatoren): Sperren dürfen alle Rollen, die bearbeiten dürfen (Eigentümer, „Darf moderieren“, „Darf bearbeiten“, Gäste über den Bearbeitungslink), `view` und `vote` nicht. Eine Sperre gehört der Person, die sie gesetzt hat; nur sie entsperrt. Eigentümer und „Darf moderieren“ heben jede Sperre auf, in einem Schritt und sichtbar (kein stilles Umgehen). Niemand verschiebt, skaliert, bearbeitet oder löscht ein gesperrtes Objekt, bevor es entsperrt ist; `locked` bleibt eine Regel in `authorize()`. Die Sperre eines Gasts gehört der Gast-Identität des Bearbeitungslinks; ist diese weg (neuer Browser, Link erneuert) oder hat die sperrende Person kein Bearbeitungsrecht mehr, entsperren nur Moderierende. Die Spalte `items.locked` aus der Stufe-0-Migration bleibt die Markierung; die M2-Migration bringt mit `group_id` den Sperrenden (z. B. `locked_by`). Der Feinentwurf von Gruppieren und Sperren steht in der M2-Spec, M1 enthält dafür keinen Code;
  - **Ausrichten, Verteilen, Aufräumen** als Aktionen auf der Auswahl;
  - **Einrasten** an Objekten (Hilfslinien an Kanten und Mitten, gleiche Abstände) beim Ziehen und Skalieren sowie ein **Raster** (Hintergrund, Einrasten, Schalter je Person) – rein im Client, ohne Protokoll und ohne Migration;
  - eine **Optik-Runde** für Formen, Text und Verbinder (weiche Schatten, Verläufe, sauberere Linienenden und Pfeilspitzen, mehr Formen, wahlweise Skizzen-Stil) – im Zeichnen der Knoten-Bauer, mit Design-Brief vorab; die Labor-Gates G11/G12 müssen halten;
  - **Mindmap** (Knoten-Typ, Baum mit automatischem Layout auf den Verbindern; die Baum-Beziehung kommt als eigenes Feld, nie über `parent`);
  - Live-Verteilung der Stimmen für Moderatoren als angekündigte Option je Sitzung, Stimmen nur mit Konto, sichtbare Abstimmungen, Abstimmungs-Verlauf;
  - **Stimmen-Version je Teilnehmer** (zwei Tabs derselben Person bei mehr als einer Stimme je Objekt) und **Bereinigung von Stimmen** entzogener Rechte: Beides sind seit 0.2.0 Grenzen im README (Abschnitt „Known limits“, Punkte „Votes from two tabs“ und „Revoked rights do not remove votes“; Nutzerentscheidungen vom 14.10.2026);
  - App-Store-Release (als erste Version im Store ist 0.3.0 vorgesehen, mit M1 und einem ersten Teil von M2; SPEC-M1 §1.2 Zeile „App-Store-Release“).
- **Später:** Minimap, Suche; ein Tabellen-Objekt (Zeilen, Spalten, Zellen); ein dritter Link „Ansehen“; Stift/Zeichnen und Diagramm-Modus; KI über das eigene Nextcloud.
