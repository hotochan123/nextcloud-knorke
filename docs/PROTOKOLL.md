<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Knorke – Protokoll (`/sync`-Vertrag)

Referenz des HTTP-Vertrags zwischen Client und Server, abgeleitet aus `docs/SPEC-M1.md` §3.10 und §4–§6 (Revision 9; die Präzisierungen aus deren §15 sind hier mit **(R4)** markiert, die aus Stufe 1 mit **(R7)**/**(R8)**/**(R9)**) und, wo M1 nichts ändert, `docs/SPEC-M0.md` §4–§6. Bei Widerspruch gilt die Spezifikation. Geprüft wird der Vertrag von `dev/sim/contract.mjs` (C01–C40, dazu C41–C44 für die Review-Befunde T1, T4, T9/T10, T11, C45–C48 für Runde 2 – Link-Richtlinie, Rechtslinks, 4-Byte-Text – und C49–C52 für M1 Stufe 0 – Protokoll 2, Meta-Kanal, Board-Epoche, Vorwärts-Schlüssel und `now` – und C53–C59 für M1 Stufe 1 – Formen, Text-Objekte, Verbinder und ihre Enden, Freigabe, `keep`, Rückwärts-Verträglichkeit; läuft auf jeder Datenbank) und `dev/sim/converge.mjs` (ebenfalls auf jeder Datenbank; ab Stufe 1 mit Formen, Text, Transforms und `keep`).

Protokollversion: **2** seit M1 Stufe 0 (`Application::PROTOCOL` = `src/sync/protocol.js` `PROTOCOL`). Protokoll 2 friert den **ganzen** M1-Drahtvertrag auf einmal ein, auch Felder, die erst spätere Stufen füllen (Rollen, Stimmen, Schreibbudget); eine Stufe, die ihn ändern müsste, bräuchte eine Spec-Revision und Protokoll 3. Schlüssel, die eine spätere Stufe füllt, fehlen bis dahin in den Antworten; ein Client behandelt ein fehlendes Feld als Vorgabe. Anfragefelder späterer Stufen nimmt der Server schon an und ignoriert sie. Basis aller Pfade: `/index.php/apps/knorke`.

## 1. Endpunkte

| # | Verb | Pfad | Wer | Body-Schlüssel |
|---|---|---|---|---|
| 1–3 | GET | `/`, `/b/{id}`, `/join/{token}` | angemeldet | – (Seiten) |
| 4 | GET | `/p/{token}` | Gast (Angemeldete → Redirect auf `/join/{token}`) | – (Seite) |
| 5 | GET | `/api/v1/boards` | angemeldet | – |
| 6 | POST | `/api/v1/boards` | angemeldet | `title` |
| 7 | PATCH | `/api/v1/boards/{id}` | Besitzer | `title` |
| 8 | DELETE | `/api/v1/boards/{id}` | Besitzer | – |
| 9 | POST | `/api/v1/boards/{id}/link` | Besitzer | `rotate`, `password`, `expiresAt` (die beiden letzten wirken ab Stufe 2) |
| 10 | DELETE | `/api/v1/boards/{id}/link` | Besitzer | – |
| 11 | POST | `/api/v1/links/{token}/join` | angemeldet | `password` (ab Stufe 2) |
| 12 | GET | `/api/v1/boards/{id}/snapshot` | angemeldet | – |
| 13 | POST | `/api/v1/boards/{id}/sync` | angemeldet | `proto, client, since, ep, role, seq, ops, me, pres, vt` |
| 14 | POST | `/pub/v1/{token}/join` | Gast | `client, name, guest, password` (`password` ab Stufe 2) |
| 15 | GET | `/pub/v1/boards/{id}/snapshot` | Gast | – |
| 16 | POST | `/pub/v1/boards/{id}/sync` | Gast | wie 13 |
| 17 | POST | `/api/v1/boards/{id}/votelink` | Besitzer | `rotate, password, expiresAt` (Stufe 2) |
| 18 | DELETE | `/api/v1/boards/{id}/votelink` | Besitzer | – (Stufe 2) |
| 19 | GET | `/api/v1/boards/{id}/shares` | Besitzer, Moderatoren nur `links` | – (Stufe 2) |
| 20 | PUT | `/api/v1/boards/{id}/shares` | Besitzer | `shares` (Stufe 2) |
| 21 | GET | `/api/v1/boards/{id}/sharees?q=…` | Besitzer | Query `q` (Stufe 2) |
| 22 | POST | `/api/v1/boards/{id}/vote` | Moderatoren | `per, perItem, scope, types, minutes` (Stufe 3) |
| 23 | PATCH | `/api/v1/boards/{id}/vote` | Moderatoren | `action, minutes` (Stufe 3) |
| 24 | PUT | `/api/v1/boards/{id}/timer` | Moderatoren | `action, ms` (Stufe 3) |
| 25 | POST | `/api/v1/boards/{id}/summon` | Moderatoren | `client` (Pflicht, Stufe 3) |
| 26 | DELETE | `/api/v1/boards/{id}/summon` | Moderatoren | – (Stufe 3) |
| **(R40)** 27 | PUT | `/api/v1/settings/privacy` | Admins (ohne Anmeldung 401, angemeldete Nicht-Admins 403) | `default, languages` (M2, Factory-Job 032; SPEC-M1 §4.1) |

Die Routen 1–26 stehen ab Stufe 0 in `appinfo/routes.php`; die Routen 17–26 antworten bis zu ihrer Stufe angemeldet **501** `{"error":"not_implemented"}` (anonym 401 wie jede API-Route). **(R40)** Route 27 kam mit Factory-Job 032 (M2, Datenschutzhinweis) dazu: Sie steht als letzte Zeile in `appinfo/routes.php`, ohne `requirements` und ohne 501-Vorstufe; `appinfo/routes.php` hat damit 27 Routen. Nach dem Einspielen neuer Routen braucht Nextcloud einen Neustart (APCu-Routencache), sonst 404.

Requirements: `id` = `\d{1,18}`, `token` = `[A-Za-z0-9]{24}`.

**Header.** Angemeldete: `requesttoken`, `X-Requested-With: XMLHttpRequest`, `Content-Type: application/json`. Gäste: `X-Requested-With: XMLHttpRequest`, `X-Knorke-Guest: <Gast-Token>` (außer beim Beitritt), `Content-Type: application/json`. **(R39)** `X-Knorke-End-State: 1` geht mit `/sync` (Routen 13 und 16, auch beim Keepalive) und mit dem Gast-Beitritt (Route 14) hinaus; der Client versteht damit Endzustände im 200-Body (§2). Der Server wertet ihn nur auf diesen drei Routen aus und nur mit dem Wert genau `1`; Snapshots (12, 15) und Konto-Beitritt (11) bleiben ohne.

**Body-Regeln (`JsonBody`, alle Endpunkte mit Body):** `Content-Length` fehlt → **411** `length_required`; größer als 1 MiB → **413** `too_large` (beides vor dem Lesen); kaputtes JSON → 400; ein Body- oder Query-Schlüssel außerhalb der Liste → 400 `bad_request`; ein Body-Schlüssel, der einen Routenparameter (`id`, `token`) mit anderem Wert überdeckt → 400. Ein Body-Schlüssel mit **demselben** Wert wie der Routenparameter ist nicht erkennbar (Nextcloud mischt Route und Body in `getParams()`) und wird angenommen; C38 prüft deshalb nur einen abweichenden Wert auf 400 und einen gleichen auf 200. Die Routen ohne Body (8, 10, 12, 15) prüfen nur die Überdeckung (`JsonBody::guardRoute`, ohne `Content-Length`-Pflicht): Ein mitgeschickter JSON-Body mit abweichendem `id` ergibt auch dort 400.

**`refuseCrossSite`** läuft in jedem öffentlichen POST zuerst: durch bei `X-Requested-With: XMLHttpRequest` (Groß-/Kleinschreibung egal) oder `Sec-Fetch-Site: same-origin|none`, sonst **403** `cross_site`.

**Kompression:** Alle Antworten sind `JSONResponse` (oder davon abgeleitet); Nextclouds Middleware gzippt jede 200er-Antwort bei `Accept-Encoding: gzip`.

## 2. Fehler

App-Fehler haben immer die Form `{"error": "<code>", "message": "<English text>"}`. **Nicht** von der App kommen: 401 für Angemeldete und 412 (CSRF) von Nextcloud als `{"message": …}`, 429/503 vom Proxy (meist kein JSON). Der Client entscheidet in diesen Fällen am **Status**, nicht am Code (`http.js` bildet Antworten ohne `error` auf `http_<status>` ab).

**(R35)** Ergebniscodes einzelner Ops sind keine HTTP-Fehler. Ein Beispiel ist eine Op, die ein gesperrtes Objekt ändern oder entfernen will oder eine fremde Sperre ohne Moderation aufhebt: `/sync` antwortet dann trotzdem 200, und `acks.res` trägt an der Stelle dieser Op `itemlocked` (§6.1, §6.2 „Sperre“). Die anderen Ops derselben Anfrage wirken unabhängig davon.

**(R39) Endzustände mit HTTP 200** (Factory-Job 028, SPEC-M1 §4.2 (R39)): Trägt eine Anfrage an Route 13, 14 oder 16 den Header `X-Knorke-End-State: 1` (Wert genau `1`, §1) und endet sie mit 401 oder 403 und einem der Codes `guest_token`, `not_logged_in`, `link_revoked`, `link_expired` oder `links_disabled`, antwortet der Server **200** mit genau `{"end": "<code>", "message": "<English text>"}`: `message` wie in der Fehlerform, kein `error`, `proto`, `now`, `rev` oder `guest`, kein `Retry-After`. Prüfungen, Reihenfolge und Nebenwirkungen bleiben gleich: `cross_site` (403) und `protocol` (409) kommen zuerst, kein Fehlversuch wird gezählt, keine Op angewendet. Ohne den Header, mit einem anderen Wert (`0`, `true`, leer) und auf allen anderen Routen (Snapshots 12 und 15, Konto-Beitritt 11) gilt die Fehlerform dieser Tabelle. `password_required` und `password_wrong` bleiben 403 (Passwort-Raten bleibt am Edge gedrosselt), ebenso `forbidden` und `cross_site`; 404, 409 und 429 bleiben. Der Client (`http.js`, `endStateOf`) macht aus der End-Antwort den Fehler der alten Antwort: 401 für `guest_token` und `not_logged_in`, sonst 403 (auch bei einem unbekannten Code), mit `fromApp` = `true`. Alles dahinter (§8.2, endgültige Status) bleibt gleich.

| Status | `error` | Bedeutung | Client |
|---|---|---|---|
| 200 | – (`end`) | **(R39)** Endzustand mit Header `X-Knorke-End-State: 1` (Routen 13, 14, 16): `guest_token`, `not_logged_in`, `link_revoked`, `link_expired`, `links_disabled` als `{"end": "<code>", "message": "<English text>"}`; `password_required` und `password_wrong` bleiben 403 | wie die alte Antwort (Absatz (R39) oben): `guest_token` wie die Zeile 401 `guest_token`, `not_logged_in` wie die Zeile 401 „– (Nextcloud)“, `link_revoked` und `links_disabled` wie ihre 403-Zeilen, `link_expired` wie die 403-Zeile „`sharing_disabled`, `password_required`, `password_wrong`, `link_expired`“ |
| 400 | `bad_request`, `too_many_ops`, `name_required`, `title_required` | Eingabe kaputt | anzeigen; beim Sync Batch verwerfen + Resync |
| 401 | – (Nextcloud) | keine Session; **(R37)** für Konten ohne remember-me kurz auch bei gültiger Session, wenn Redis neu startet (SPEC-M1 §5.6) | **(R37)** Angemeldeter Tab, Antwort auf `/sync`: Das erste 401 überbrückt der Client wie einen vorübergehenden Fehler (wie 0/5xx: der Batch bleibt mit derselben `seq`, ab dem 2. Fehler `offline`, nächster Versuch nach dem nächsten Backoff-Schritt, ohne vorherige Fehler nach 1–1,2 s). Erst ein zweites 401 in Folge, ohne 2xx-Antwort auf `/sync` dazwischen, ergibt `logged_out`, Polling stoppt. Jede 2xx-Antwort auf `/sync` setzt die Zählung zurück, auch mit `busy`-Acks oder `resync: true`; andere Fehler setzen nicht zurück. Es zählt jedes 401, auch das, das der Client nach dem zweiten 412 bildet. Unverändert ergibt schon das erste 401 auf den Snapshot beim Öffnen und beim Resync `logged_out`. Gast-Tabs: Zeile `guest_token` |
| 401 | `guest_token` | Gast-Token ungültig/abgelaufen/anderes Board | **genau einmal** automatisch neu beitreten |
| 403 | `forbidden` | Rolle reicht nicht (Mitglied verwaltet Board) | Meldung |
| 403 | `link_revoked` | Link erneuert/abgeschaltet (ab Stufe 2 auch: Passwort gesetzt, Ablauf vorverlegt) | Konto: `revoked`, Polling stoppt. Gast-Tab (Protokoll 2, SPEC-M1 §6.4): genau **ein** automatischer Neu-Beitritt je Fehlerserie (§8.2); antwortet auch der `link_revoked`, endgültig `revoked` |
| 403 | `links_disabled` | Nextclouds Link-Richtlinie verbietet dem Board-Besitzer Links (§8.1) | endgültig: Hinweis, Polling stoppt, kein Auto-Beitritt; im Teilen-Dialog Hinweis statt Fehler |
| 403 | `cross_site` | Schutz gegriffen | Programmfehler |
| 404 | `not_found` | Board/Link fehlt **oder kein Zugriff** (kein Besitz-Orakel) | `gone`, Polling stoppt |
| 409 | `protocol` | veralteter Client; **Protokoll 2:** Body zusätzlich `"proto": <Server-Version>` | Status `reload`: einfrieren; automatisch neu laden (mit Cache-Bust `?knorke-reload=…`) nur, wenn der `sessionStorage`-Merker `knorke.reloaded` ungleich der Server-Version aus dem Body ist (fehlt sie: `'?'`) – ein zweiter Sprung in derselben Tab-Sitzung lädt also wieder, derselbe Sprung friert ein –, und nur, wenn kein Editor offen ist und nichts aussteht; sonst bleibt der Banner mit „Reload“. Ein Snapshot oder Beitritt mit `proto` ≠ eigener Version zählt wie ein 409; **(R4)** auch ein **fehlendes** `proto` (Merker `'?'`, einmal neu laden). **(R4)** Die M0-Regel „online löscht den Merker“ entfällt (§10) |
| 411 | `length_required` | `Content-Length` fehlt | Programmfehler, Backoff |
| 412 | – (Nextcloud) | CSRF-Token veraltet | einmal `GET /index.php/csrftoken`, dieselbe Anfrage einmal wiederholen |
| 413 | `too_large` | Body > 1 MiB | Batch halbieren |
| 429 | `rate_limited` | App-Drossel (Anlegen, Beitritt) | Meldung, nicht automatisch wiederholen |
| 429 | `slow_down` | **neu, nicht endgültig** (Stufe 2–4): Drossel einer wiederholbaren Aktion (Snapshot, Gast-Beitritt, Freigaben, Suche, Moderation, Passwort-Fehlversuche); Body `retryMs`, Header `Retry-After` | warten (Snapshot und Beitritt: `max(retryMs, 2000)` × 1–1,2, bei Wiederholung verdoppeln bis 60 s) und wiederholen; nie der endgültige Status `rate_limited`, der Tab friert nicht ein. **(R4)** Beim automatischen Neu-Beitritt wird nach der Wartezeit (2000 → 4000 … ≤ 60 s) der **Beitritt selbst** wiederholt, ohne `/sync` dazwischen (§8.2). Auf `/sync` kommt `slow_down` nicht vor; käme es, gilt es wie ein Proxy-429. **(R13)** Die Passwort-Sperre eines Links (20 Fehlversuche je Link und Netz in 10 min, §8) antwortet 429 `slow_down` mit dem additiven Schlüssel `"reason": "password"` (kein Protokollsprung, wie `max`/`maxDays`): nie automatisch wiederholt; im Namens- bzw. Passwort-Dialog „Too many wrong passwords. Try again in {minutes} minutes.“ mit `minutes = ceil(retryMs / 60000)`, beim automatischen Neu-Beitritt sofort endgültig `password_required` (§8.2). Bei `ILimiter`-Drosseln ist `retryMs = ceil(Zeitraum · 1000 / Grenze)` (Freigaben neu 10000, Suche 1000) **(R22)** Auch die schreibenden Link-Aufrufe drosseln: POST und DELETE der Routen 9, 10, 17 und 18 (Anlegen, Erneuern, Passwort, Ablauf, Abschalten) zählen je Konto in `knorke-link` (App-Config `link_limit`, Vorgabe 20 je 600 s) nach der Besitzerprüfung; ausgelöst → 429 `slow_down` mit `retryMs = ceil(600000 / link_limit)` (30000) und `Retry-After` (30), nichts geschrieben; Lesen (Route 19, `board.links` im Snapshot) wird nie gedrosselt |
| 429/503 | – (Proxy/Wartung) | Edge-Token-Bucket, Wartung | `Retry-After` bzw. 2–10 s warten, wiederholen; zählt nicht als offline |
| 400 | `password_enforced`, `password_policy`, `expiry_required`, `expiry_too_far` (+ `maxDays`), `expiry_past` | Link-Passwort und Ablauf (Stufe 2) | Hinweis am Feld |
| 400 | `group_sharing_disabled`, `teams_unavailable`, `group_members_only`, `recipient_not_found`, `self_share`, `too_many_shares` (+ `max` 200, **R13**), `too_many_new_shares` (+ `max` 20) | Freigabe verletzt eine Regel (Stufe 2), dazu `at` = Index im gesendeten `shares` (bei `too_many_new_shares` der Index des 21. vorläufig neuen Eintrags, bei `too_many_shares` 200). **(R13)** Reihenfolge im PUT: Form (≤ 200 Einträge) → vorläufig neue Einträge (byte-genau, vor der Kanonisierung) höchstens 20 → je vorläufig neuem Eintrag ein Zähler `knorke-share-new` (bleibt gezählt, auch wenn die Anfrage danach scheitert) → Richtlinie, Auflösen, Regeln, Doppelte nach der Kanonisierung. Rollen-Erhöhungen prüfen nur `sharing_disabled` und bei Gruppen `group_sharing_disabled` | Zeile markieren, nichts gespeichert; [C] liest `max` für den Text aus dem Body |
| 400 | `vote_config`, `meta_too_large` | Abstimmungs-Einstellung (Stufe 3), Meta über 256 KiB | Hinweis bzw. Meta neu anwenden |
| 403 | `sharing_disabled`, `password_required`, `password_wrong`, `link_expired` | Teilen gesperrt; Link mit Passwort; Link abgelaufen (Stufe 2) | Hinweis; `link_expired` und `password_required` sind endgültige Status (unten). Der Server nennt `link_expired`/`password_*` nur beim Beitritt; **(R4)** kommen sie doch direkt auf `/sync`, bildet der Client sie defensiv ebenfalls auf die Endstatus ab (`link_expired` → `link_expired`, `password_required`/`password_wrong` → `password_required`) |
| 409 | `vote_open`, `vote_closed`, `timer_state` | Moderation passt nicht zum Zustand (Stufe 3) | Meta neu anwenden |
| 501 | `not_implemented` | Route einer späteren Stufe (17–26) | – |
| 500 | `internal` | unerwartet (serverseitig geloggt) | Backoff; nach 3 Antworten 500 für denselben Batch isoliert der Client die Ops (halbieren, eine einzeln scheiternde beiseitelegen, alles andere weiterschicken) und verwirft eine Op erst nach 3 Fehlschlägen allein direkt nach einer 2xx-Antwort, mit Hinweis und Textrettung (Ack-Code `internal` nur im Client) |

**Endgültige Client-Status** (eingefroren ab Stufe 0): `FINAL_STATUSES` = `FROZEN_STATUSES` = `['gone','revoked','logged_out','reload','rate_limited','links_disabled','link_expired','password_required']`. `link_expired`: Gast-Sync nach Ablauf (401 `guest_token` → Neu-Beitritt → 403 `link_expired`). `password_required` (Stufe 2): der automatische Neu-Beitritt eines offenen Gast-Tabs antwortet 403 `password_required`/`password_wrong`. **(R4)** Übergabe schon ab Stufe 0: Ungesendete Texte (offener Editor und Text-Ops) gehen zuerst in den Kopier-Dialog, danach zeigt die Gastseite die Namensphase mit dem gespeicherten Namen; das Passwortfeld kommt mit Stufe 2. Die Gastseiten-Phase `expired` und der Beitrittsstatus `expired` der App gibt es ab Stufe 0. Fällt ein angemeldeter Link-Nutzer (`me.source === 'link'`) auf 404, zeigt der Banner „Your access through the link ended. Open the link again.“ (Status bleibt `gone`).

## 3. Boards und Links

Board-Objekt: `{"id", "title", "role": "owner"|"edit", "updatedAt" (ms), "owner": {"uid", "name"}, "viaLink", "linksAllowed"}`; `linksAllowed` ist die Link-Richtlinie des Besitzers (§8.1; fehlt der Schlüssel, gilt `true`).

- `GET /api/v1/boards` → `{"boards": [Board…]}`, eigene und beigetretene, nach `updatedAt` absteigend, dann `id`.
- `POST /api/v1/boards {"title"}` → **201** `{"board"}`; Titel getrimmt, 1–200 Zeichen, keine Steuerzeichen; leer → 400 `title_required`; mehr als 500 Boards → 429. Drossel `create_limit` (Vorgabe 30 je 10 min). Ohne 4-Byte-UTF-8 in der Datenbank wird jeder Codepunkt über U+FFFF zu U+FFFD (§6.3); die Antwort trägt den gespeicherten Titel (auch beim Umbenennen).
- `PATCH` / `DELETE` / Link nur für den Besitzer: Mitglied → 403 `forbidden`, Fremder → 404. **Umbenennen (Protokoll 2)** läuft über den Meta-Schreibweg: unter dem Board-Lock `meta_rev = rev + 1, rev = rev + 1` in einer Anweisung, **keine** `changes`-Zeile; offene Clients sehen den Titel im nächsten Takt (`board` in der Sync-Antwort, §5.2). Antwort `{"board": Board}`; **(R4, ab Stufe-0-Phase 2)** trägt dieses Board-Objekt zusätzlich `metaRev` (der rev nach dem Umbenennen, = `meta_rev`, also größer als der vorige `metaRev`) und `meta` (leer `{}`) aus `MetaService::write`. Titel, `meta` und `metaRev` stammen alle aus diesem einen Schreibvorgang (nie aus einem späteren Lesen der Zeile), sodass eine gleichzeitige Umbenennung nie einen neueren Titel mit diesem `metaRev` paart. Der Client führt die eigene Umbenennung damit direkt über den `onMeta`-Weg zusammen (SPEC-M1 §6.5.1). Additiv: Ohne diese Schlüssel übernimmt er nur den Titel, und `metaRev` kommt mit dem `board`-Block des nächsten Sync. Geprüft von C50.
- `POST …/link {"rotate": false|true}` → `{"link": {"token", "role": "edit", "url"}}`: anlegen, vorhandenen liefern oder erneuern. **(R4)** Bis Stufe 2 antworten die Routen 9/10 in dieser M0-Form; `password`, `expiresAt` und `expiresOn` kommen mit Stufe 2 (§4). Verbietet die Link-Richtlinie dem Besitzer Links → 403 `links_disabled` (nach der Besitzprüfung: ein Fremder bekommt weiter 404). `DELETE …/link` → `{"link": null}`, auch dann.
- `POST /api/v1/links/{token}/join` → `{"boardId"}`; Besitzer/Mitglied: keine Änderung; zurückgezogener Token → 403 `link_revoked` (ohne Fehlversuch); verbietet die Richtlinie Links → 403 `links_disabled` für alle außer dem Besitzer; nie ausgestellter → 404 (zählt als Fehlversuch, gesperrt → 429).
- Solange die Richtlinie Links verbietet, ist ein Link-Mitglied ein Fremder: Snapshot und Sync → 404, das Board fehlt in seiner Liste, `PATCH`/`DELETE` → 404 (nicht 403).

## 4. Snapshot

`GET …/snapshot` (Angemeldete: immer volle Rechteprüfung, setzt danach den Grant neu; Gäste: Token-Prüfreihenfolge §8), Protokoll 2:

```json
{"proto": 2, "epoch": "k3x9a0b2", "now": 1760100000123, "rev": 42, "minRev": 0, "schema": 1,
 "board": {"id": 7, "title": "Retro KW41", "role": "owner", "metaRev": 40, "meta": {},
           "links": {"edit": {"token": "…", "role": "edit", "url": "…/p/…", "password": false,
                              "expiresAt": null, "expiresOn": null},
                     "vote": null},
           "linksAllowed": true},
 "me": {"pid": "3f9a1c0b7d2e4a51", "name": "Alice Adler", "role": "owner", "guest": false,
        "mod": true, "source": "own"},
 "items": [{"id": "01JA…", "t": "sticky", "x": 120.0, "y": 80.0, "w": 200.0, "h": 200.0, "r": 0.0,
            "z": "i0", "parent": null, "data": {"text": "Hallo"}, "style": {"fill": "#a8d8f8"},
            "group": null, "lock": null}]}
```

- `epoch`: die Board-Epoche der Instanz (§12); der Client schickt sie in jedem `/sync` als `ep` zurück. `now`: Serverzeit in ms beim Bau der Antwort (Abgleich der Uhr, `board/clock.js`); **(R4)** `now` = max(Anfragezeit, Serveruhr beim Bau der Antwort), im Snapshot wie im Sync. Ist `proto` ≠ eigene Version (oder fehlt es), behandelt der Client das wie ein 409 (vor dem ersten `/sync`).
- `board.meta` (JSON-Objekt, leer `{}`; Timer, Abstimmung, „Alle zu mir“ ab Stufe 3) und `board.metaRev` (rev der letzten Titel- oder Meta-Änderung) bekommen alle Rollen; `meta` hängt nie vom Betrachter ab. **(R4)** Eine leere Meta-Map speichert der Server als `NULL`; auf dem Draht ist sie **immer** `{}` (Snapshot, `board`-Block des Sync, Antwort des Umbenennens), nie `[]` oder `null`. Gespeichertes Meta-JSON wird wörtlich eingesetzt, `{}` bleibt also in jeder Tiefe `{}`.
- `board.links` (statt M0 `board.link`) = `{edit, vote}` je als Link-Objekt oder `null`, für den Besitzer und (ab Stufe 2) Moderatoren lesend; `linksAllowed` nur für den Besitzer, `linkPolicy` (ab Stufe 2) ebenso. Mitglieder ohne Moderation und Gäste bekommen keinen dieser Schlüssel. Die Antworten der Link-Routen bleiben `{"link": …}`.
- **(R40)** `board.linkOpenSince` (Factory-Job 032, M2, Datenschutzhinweis): Route 12 liefert es für jede Rolle (Besitzer, Moderation, Mitglied, Link-Mitglied). Der Wert ist das neueste `created_at` (ms) eines Bearbeitungs- oder Abstimmungslinks, der weder widerrufen noch abgelaufen ist, sonst `null`. Es fehlt im Gast-Snapshot, im Gast-Beitritt und im `board`-Block von `/sync`; es kommt also nur mit einem Snapshot (Öffnen, Neuladen, Resync). Mitglieder erfahren daraus nur, dass und seit wann ein Link aktiv ist; Token, Passwortstatus und Ablauf stehen nur in `links`. Das Feld ist additiv, Protokoll 2 bleibt: Ältere Clients ignorieren unbekannte Schlüssel (§5.2). Genauer: SPEC-M1 §4.4 (R40).
- **(R4) Link-Objekt bis Stufe 2:** `{token, role, url}` **ohne** `password`, `expiresAt` und `expiresOn` (Schlüssel späterer Stufen fehlen, SPEC-M1 §0). Ab WP-B2 sind sie immer vorhanden (`false` bzw. `null`, wenn nicht gesetzt), wie im Beispiel oben. C49 duldet das Fehlen bis dahin. Bis dahin behalten auch die Grants von Link-Mitgliedern ihre TTL von 120 s.
- `me.mod` = darf moderieren (Besitzer; ab Stufe 2 auch Freigaben „Darf moderieren“), `me.source` = Herkunft der wirksamen Rolle: `own`, `link` (Konto über einen Link), `guest`, ab Stufe 2 `share`. **(R4)** In Stufe 0 also nur `own`/`link`/`guest`; eine alte `knorke_members`-Zeile mit `link_id NULL` (schreibt M0 nie) gilt als `link`.
- `votes` (Stufe 3) nur bei offener Sitzung und Stimmrecht.

- Der rev wird **vor** den Items gelesen; eine dazwischen committete Änderung steht dann im Snapshot und im nächsten Sync (doppelt anwenden ist harmlos).
- **(R4)** `board.title`, `board.meta` und `board.metaRev` stammen aus **einem** `BoardStore::meta()`-Lesen **nach** dem rev, nie aus der Zeile der Zugriffsprüfung. Ein Meta-Lesen vor dem rev könnte einen alten Titel mit einem Cursor hinter seiner Änderung paaren; der Client bekäme die Umbenennung dann nie (sein `since` läge schon über `meta_rev`).
- `items`: nur lebende Objekte, nach `id` sortiert; `data`/`style` leer → `{}`.
- **`group` und `lock` (M2-Datenbasis, 0.3.0):** Jedes Objekt trägt nach `style` zwei Schlüssel, für **jede** Rolle und auch im Gast-Beitritt (gefiltert wird nichts); ein Grabstein trägt sie nie (er steht nur in `removed`). `group` ist `null` (keine Gruppe) oder die Gruppen-ID als String. `lock` ist `null` (nicht gesperrt) oder `{"by": <pid>|null, "name": <string>|null}` mit beiden Schlüsseln in dieser Reihenfolge: `by` ist die **pid** des Sperrenden (dieselbe Ableitung wie `me.pid` und die Präsenz-`k`, `Access::derivePid`), nie `u:<uid>`/`g:<gid>`; `name` ist der beim Sperren gemerkte Anzeigename (höchstens 64 Zeichen, wie ein Gastname bereinigt) und geht unverändert an jede Rolle. `lock: null` und `{"by": null, "name": null}` (gesperrt, Sperrender unbekannt) sind verschiedene Zustände. **(R35)** Seit Job 023 setzt der patch-Pfad `lock` die Sperre (§6.1). `by` und `name` kommen dabei immer vom angemeldeten Principal, nie aus dem gesendeten Wert. `name` ist `null`, wenn der Anzeigename beim Sperren leer war. `{"by": null, "name": null}` entsteht, wenn das Konto des Sperrenden gelöscht wird; das erledigen die Kontolöschung, `occ knorke:orphans` und der tägliche `CleanupJob` (§6.2 „Sperre“). Die Sperre bleibt dann bestehen, und nur Moderierende heben sie auf. **(R36)** Seit Job 026 setzen ein put (`p.group`) und der patch-Pfad `group` die Gruppe (§6.1). Die Gruppen-ID ist eine ULID (`OpValidator::ULID_RE`), und nur Notizen, Formen und Text-Objekte tragen eine. Behält eine Gruppe nach einem Batch nur ein lebendes Mitglied, setzt der Server dessen `group` auf `null` (§6.2 „Gruppen“). Ob eine Gruppe mindestens zwei Mitglieder hat und alle denselben Elternteil, prüft nur der Client. Eine Gruppen-ID, die er an weniger als zwei lebenden Objekten kennt, wertet er als keine Gruppe. Das Protokoll bleibt 2; ältere Clients ignorieren unbekannte Item-Schlüssel (§5.2). Dieselbe Form gilt für `items` im Sync (§5.2).
- `board.links.edit` steht auch bei `linksAllowed: false` darin: Der Link ist nur stillgelegt, nicht zurückgezogen.
- Gast-Beitritt liefert dieselbe Form plus `"guest": {"token", "exp"}`. **(R39)** Mit dem Header `X-Knorke-End-State: 1` kann der Beitritt stattdessen eine End-Antwort sein (`link_revoked`, `link_expired`, `links_disabled`; §2); `end` ist reserviert (§5.2).

## 5. `POST …/sync`

### 5.1 Anfrage

```json
{"proto": 2, "client": "cK3j9aZp2Q", "since": 42, "ep": "k3x9a0b2", "role": "owner", "seq": 17,
 "ops": [{"o": "put", "id": "01JA…", "t": "sticky", "p": {"x": 100, "y": 40, "w": 200, "h": 200, "r": 0, "z": "i1",
                                                         "parent": null, "data": {"text": ""}, "style": {"fill": "#a8d8f8"}}},
         {"o": "patch", "id": "01JB…", "p": {"x": 340.5, "y": 120, "parent": "01JF…"}},
         {"o": "remove", "id": "01JC…"}],
 "me": {"c": [512.3, -88.0], "s": ["01JB…"], "d": [], "e": null},
 "pres": 1, "vt": 0}
```

| Feld | Pflicht | Regel |
|---|---|---|
| `proto` | ja | = 2, sonst 409 `protocol` mit `"proto": 2` im Body. Der Server prüft `proto` **zuerst** und erst danach `ep`: Ein M0-Tab (`proto: 1`, ohne `ep`) bekommt so 409 (neu laden) statt 400 (Batch verwerfen) |
| `ep` | ja | `^[a-z0-9]{1,16}$`, die Board-Epoche aus Snapshot bzw. Beitritt; fehlt oder ungültig → 400 `bad_request`; weicht sie ab → Antwort mit `resync: true`, die Ops der Anfrage wirken trotzdem (§12). **(R4)** Kennt der Client keine gültige Epoche, schickt er `ep: "0"` (den Wert von `Epoch::current()` ohne gespeicherte Epoche) statt das Feld wegzulassen: Ein fehlendes `ep` gäbe 400, und die Regel für 400 verwürfe den Batch samt Ops; auf `"0"` antwortet der Server mit `resync` (hat die Instanz keine gespeicherte Epoche, ist `"0"` sogar die richtige), und die Ops wirken |
| `role` | nein | die Zugangsstufe, die der Client zuletzt kannte: `owner`, `moderate`, `edit`, `vote`, `view` oder `null`; jeder andere Wert → 400. Weicht die wirksame ab, antwortet der Server ab Stufe 2 mit `me: {role, mod}`. **(R4)** Der Client schickt `role` nur mit einem der fünf Werte `owner\|moderate\|edit\|vote\|view`, sonst gar nicht. Bis Stufe 2 ist `onRole` ein strikter No-op: `role` bleibt die Zugangsstufe aus dem Snapshot |
| `vt` | nein | (Stufe 3) nur Moderatoren: zuletzt gesehener Stand `seq` der Zählung der Abstimmenden **der aktuellen Sitzung**; für andere ignoriert. **(R4)** Der Client schickt `vt` nur als Ganzzahl ≥ 0, sonst gar nicht. **(R16)** Und nur, wenn `me.mod` gilt und `meta.vote.state === 'open'` ist (höchstens alle 2 s); nach `closed` bzw. `clear` fehlt der Schlüssel sofort, bei einem sid-Wechsel beginnt er bei 0 (§13.3) |
| `client` | ja | `^[A-Za-z][A-Za-z0-9]{0,15}$`; je Tab und Board in `sessionStorage` |
| `since` | ja | int ≥ 0, der zuletzt bestätigte rev des Clients |
| `seq` | nur mit `ops` | int ≥ 1, je Client monoton; eine Wiederholung nach Netzfehler schickt **denselben Batch mit derselben `seq`** |
| `ops` | nein | 0–200 (mehr → 400 `too_many_ops`) |
| `me` | nein | eigene Präsenz (§7); fehlt sie, schreibt der Server keine. Für die Rolle `view` ignoriert. Der Client schickt `me` nur im Modus edit (Ausnahme: der präsentierende Tab, §7); `me.v` (Viewport `[x, y, w, h]` in Welt, Stufe 3) rundet der Server je mit `q(…, 10)`, ein ungültiges `v` (nicht vier Zahlen, `w` oder `h` ≤ 0, ein Betrag > 1e7) verwirft nur `v`, nicht den Eintrag |
| `pres` | nein | 1 (Vorgabe) = Präsenz der anderen mitliefern, 0 = nicht |

### 5.2 Antwort

```json
{"rev": 45, "now": 1760100000456,
 "board": {"title": "Retro KW41", "meta": {}, "metaRev": 44},
 "items": [{"id": "01JA…", "t": "sticky", "…": "volles Objekt wie im Snapshot"}],
 "removed": ["01JC…"],
 "more": true,
 "acks": {"seq": 17, "rev": 44, "res": ["ok", "ok", "gone"]},
 "presence": {"<pid>:<client>": {"n": "Bob Berg", "k": "<pid>", "g": 0, "x": 12.5, "y": -40.0,
                                 "s": [], "d": [], "e": null, "h": 0}},
 "resync": true}
```

| Feld | Bedeutung |
|---|---|
| `rev` | neuer Cursor; übernommen **nur**, wenn `resync` fehlt |
| `now` | Serverzeit in ms (`floor(microtime(true) · 1000)`), **immer** da, auch im Fastpath. **(R4)** `now` = max(Anfragezeit, Serveruhr beim Bau der Antwort), liegt also nie vor dem Eingang der Anfrage |
| `board` | Meta-Kanal: `{title, meta, metaRev}`, sobald `since < meta_rev` (nur auf dem langsamen Pfad; der Fastpath bleibt ohne App-SQL). Wiederholte Auslieferung ist harmlos: der Client übernimmt nur `metaRev` > bekanntem Stand und überschreibt ein offenes Umbenennen-Feld nicht. `meta` leer → `{}` (§4). **(R4)** Den Kopf der vollen Zugriffsprüfung (`rev`, `min_rev`, `meta_rev` einer Zeile) nutzt der Server nur wieder, solange dessen `rev` gleich dem beantworteten `rev` ist; sonst liest `ItemStore::readHead` neu. Sonst könnte ein Client nach eigenem Schreiben (oder einem fremden zwischen Prüfung und Antwort) seinen Cursor über eine Umbenennung schieben, die er nie bekommen hat (`SyncServiceSyncTest::testOwnWriteNeverReusesAStaleHead`) |
| `me` | (Stufe 2) `{role, mod}`, wenn `role` mitkam und die wirksame Zugangsstufe abweicht |
| `votes` | (Stufe 3) eigene Stimmen und Reststimmen; Moderatoren zusätzlich `voters` und `vt`, nie eine Verteilung je Objekt. Form und Sende-Regel: §13.2, §13.3 |
| `items` | (Form wie §4, auch `group`/`lock`) aktueller Stand jedes Objekts mit `since < rev(Objekt) ≤ rev`, **je Objekt verdichtet** (ein Eintrag, egal wie viele Änderungen dazwischen lagen), Reihenfolge (`rev`, `id`) |
| `removed` | Grabsteine im selben Fenster; eine ID steht nie zugleich in `items` |
| `more` | Seite voll (500 Objekte), sofort weiterfragen; eine Seite zerteilt nie einen rev (hat ein einziger rev mehr als 500 Objekte, kommt er ganz) |
| `acks` | nur wenn `ops` kamen; `res` positionsgleich mit `ops`; `retryMs` nur zusammen mit `busy` (Stufe 4). `rev` = rev des Schreib-Batches; schrieb der Batch nichts Wirksames (nur `dup`/`gone`/`locked`/`itemlocked`/`limit`/No-op), wird zurückgerollt und `rev` ist der beobachtete Board-rev; `null` nur, wenn gar keine Transaktion lief (alles `bad`/`denied`) |
| `presence` | **immer** vorhanden bei `pres = 1`, auch als `{}`; ohne Redis (keine Präsenz) immer `{}`. Ohne den eigenen Eintrag, ohne `t`/`es`, mit `h`. Bei `pres = 0` fehlt der Schlüssel |
| `resync` | `true`: bestätigten Zustand verwerfen, Snapshot neu laden. `acks` und `presence` gelten trotzdem |

Eigenschaften:
- Die Antwort deckt den **eigenen** Schreibvorgang: `rev ≥ acks.rev` (außer bei `more`), die eigenen Objekte kommen in `items` derselben Antwort.
- Leerer Sync mit `since == rev`: genau `{"rev": N, "now": T}` bzw. `{"rev": N, "now": T, "presence": {…}}` – ohne App-SQL (Fastpath; die Epoche ist ein Vergleich mit der vorgeladenen App-Config, `now` kostet nichts).
- **Unbekannte Antwortschlüssel** ignoriert der Client (spätere Stufen dürfen Schlüssel ergänzen, z. B. `votes.tally` in M2). **(R39)** Ausnahme ist `end`: Der Schlüssel ist auf der obersten Ebene von Sync- und Beitritts-Antworten reserviert. Eine 2xx-Antwort mit `end` als nicht leerem String ist eine End-Antwort (§2), keine Erfolgsantwort; spätere Stufen dürfen den Schlüssel nicht anders verwenden. Ein unbekannter Code führt beim Client zu 403, also zu `gone`. Das `end` des Timers liegt verschachtelt in `board.meta.timer`.
- Verdichtung ist korrekt: Ein Objekt mit `rev ≤ since` hat der Client im letzten Stand; eins mit `rev > upTo` kommt beim nächsten Takt voll. Zwischen den Seiten kann ein Kind vor seinem Eltern-Frame ankommen – unbekannte `parent` behandelt der Client bis dahin als Wurzel.

## 6. Ops, Ergebniscodes, LWW

### 6.1 Ops

| Op | Form | Wirkung |
|---|---|---|
| put | `{"o":"put","id","t","p":{x,y,w,h,r,z,parent,data,style}}` | legt an; `t` aus der Registry (M0: `sticky`, `frame`; ab Stufe 1 auch `shape`, `text`, `connector`, §6.4), `z` Pflicht und gültig; fehlende Zahlen 0, `data`/`style` `{}`, `parent` `null`. **Ausnahme (M2-Datenbasis):** `p.lock` mit einem Wert ungleich `null` (auch `""`, `{}`, `false`, `0`) → `bad`; fehlend oder `null` ist wie bisher. **(R36)** `p.group` (seit Job 026): fehlend oder `null` heißt keine Gruppe, sonst eine ULID (`OpValidator::ULID_RE`: 26 Zeichen Crockford-Base32 in Großbuchstaben). Jeder andere Wert ist `bad` (`""`, Kleinbuchstaben, 25 oder 27 Zeichen, Zahl, `true`, `{}`, `[]`). Eine Gruppe ≠ `null` gibt es nur bei `sticky`, `shape` und `text` (§6.2 „Gruppen“); das gilt auch für put + `revive`. |
| put + `"revive": true` | dazu | belebt auch einen Grabstein derselben ID (Undo von Löschen), auch einen, den derselbe Batch gerade entfernt hat |
| patch | `{"o":"patch","id","p":{"<pfad>": wert \| null}}` | 1–50 Pfade: `x, y, w, h, r, z, parent, data.<k>[.<k>…], style.<k>[.<k>…]` (1–4 Ebenen, Schlüssel `^[A-Za-z][A-Za-z0-9_-]{0,39}$`); `null`, `{}`, `[]` löschen. **(R36)** Dazu kommt der Pfad `group`; er nimmt nur `null` oder eine ULID, `{}` und `[]` sind dort `bad` (Zeile „patch mit `group`“). **Lagegruppe:** enthält ein patch `x`, `y` oder `parent`, muss er alle drei enthalten |
| patch + `"keep": true` | dazu (ab Stufe 1, nur das Literal `true`) | nur bei Containern: die Kinder behalten ihre absolute Lage (Regel 15, §6.4); bei anderen Typen ignoriert |
| patch mit `lock` **(R35)** | `{"o":"patch","id","p":{"lock":{…}}}` sperrt; `{"o":"patch","id","p":{"lock":null}}` entsperrt, ebenso `{}` oder `[]` | `lock` muss der **einzige** Schlüssel von `p` sein, sonst `bad`; `keep` wird ignoriert. Ein nicht leeres JSON-Objekt sperrt, wenn es die Wertregeln erfüllt (§6.2 Regel 3, §6.3); sein Inhalt wird weder gelesen noch gespeichert. Jeder andere Wert ist `bad` (`true`, `false`, Zahl, String, nicht leere Liste, Objekt mit ungültigem Schlüssel). Als Sperrender gilt immer der angemeldete Principal: `locked_by` ist seine Principal-ID (`u:<uid>` bzw. `g:<gid>`), `locked_name` sein Anzeigename (höchstens 64 Zeichen und wie ein Gastname bereinigt; ohne 4-Byte-UTF-8 in der Datenbank werden Zeichen über U+FFFF zu U+FFFD; ein leerer Name wird `NULL`). Der Client schickt `{"by": me.pid, "name": me.name}` in dieser Reihenfolge, damit sein optimistischer Stand dem Echo des Servers gleicht. Ein gesperrtes Objekt erneut zu sperren ergibt `ok` ohne Wirkung, der erste Sperrende bleibt; ein freies Objekt zu entsperren ergibt ebenfalls `ok` ohne Wirkung. Rechte und Reihenfolge stehen in §6.2 „Sperre“ |
| patch mit `group` **(R36)** | `{"o":"patch","id","p":{"group":"<ULID>"}}` setzt in die Gruppe; `{"o":"patch","id","p":{"group":null}}` nimmt heraus | Wurzelpfad `group` (seit Job 026), ein eigenes LWW-Register wie `z`. Er darf neben anderen Pfaden stehen und zählt dann zu den 50. Gültig sind nur `null` und eine ULID wie beim put. Jeder andere Wert ist `bad`, auch `{}` und `[]`: `group` ist wie `parent` ein Bezeichner und keine `data`-Map. Neben `lock` ist er `bad`, denn der Sperr-Pfad steht allein; `group.<k>` bleibt `bad`. Typregel, Rechte und Auflösen stehen in §6.2 „Gruppen“ |
| remove | `{"o":"remove","id"}` | Grabstein; ein Container gibt seine übrigen Kinder frei; ab Stufe 1 werden außerdem gebundene Verbinder-Enden frei (Regel 14) **(R22)** Der Grabstein behält Typ, Lage, Eltern und z, trägt aber `data = '{}'` und `style = '{}'`; die Nutzlast bleibt nur in den `put`-/`patch`-Zeilen des Änderungsprotokolls, bis Schnitt und Deckel (Prod-Reife) sie löschen. `put` mit `revive` bringt das volle Objekt mit |

| Code | Bedeutung |
|---|---|
| `ok` | angewendet (auch No-op, auch eine Freigabe wegen Grabstein-Elternteil) |
| `dup` | put auf lebende ID, der gespeicherte Stand gewinnt |
| `gone` | patch/remove auf fehlendes oder gelöschtes Objekt, put ohne `revive` auf Grabstein |
| `bad` | Validierung (Format, Typregel, z-Schlüssel, Lagegruppe, nie existierender Elternteil; ab Stufe 1 auch unbekannter Aufzählungswert, fehlendes Pflichtfeld, ungültiges oder nicht bindbares Verbinder-Ende, Lage eines Verbinders, Unterpfad eines Endes) |
| `denied` | Rolle darf das nicht (`view`) |
| `limit` | Objekt-Limit des Boards (5000 lebende Objekte) |
| `locked` | Text-Patch gegen eine fremde, frische Text-Lease (nur die Lease; **(R35)** eine Sperre ist `itemlocked`) |
| `itemlocked` | **(R35)** Objekt gesperrt (seit Job 023). Das gilt in zwei Fällen: jede Änderung (patch jedes Pfads, auch mit `keep`) und jedes Entfernen eines gesperrten Objekts, auch durch Moderierende, solange sie es nicht entsperrt haben; das Entsperren einer fremden Sperre ohne Moderation. Das ist nicht `denied`: Die Rolle darf bearbeiten, nur dieses Objekt nicht. Geschrieben wird nichts |
| `closed` | (Stufe 3) Stimm-Op auf eine nicht offene Sitzung: Op verwerfen, Hinweis „Voting has ended.“ |
| `busy` | (Stufe 4) Schreibbudget erschöpft: **nichts** aus der Anfrage wurde angewendet, `acks.rev = null`, `acks.retryMs` gesetzt. Der Client lässt den Batch in Arbeit und schickt ihn nach `retryMs` (+ 0–20 % Zufall) mit derselben `seq` erneut; kein Fehler, kein `offline`; nach 30 s Dauer-`busy` einmal der Toast „Changes are being saved more slowly. Nothing is lost.“ **(R4)** `busy` ist alles oder nichts (SPEC-M1 §4.6): Eine gemischte Antwort (einige Ops `busy`, andere nicht) ist ein Serverfehler. Kommt sie doch, nimmt der Client die `busy`-Ops vorne zurück in die Warteschlange (sie gehen als Erste wieder hinaus) und wertet die übrigen Codes normal |

Der Client versteht `busy`, `closed` und **unbekannte Ergebniscodes** ab Stufe 0; ein unbekannter Code gilt wie `bad` (Op verwerfen, `console.warn`, Textrettung bei Text-Ops). Ab Stufe 1 gibt es den patch-Merker `"keep": true` (Container: Kinder behalten ihre absolute Lage), ab Stufe 3 die Op `{"o":"vote","s","id","n"}`; Stimm-Ops erhöhen den Board-rev nicht. **(R35)** Seit Job 023 kennt der Client `itemlocked`: Je Antwort kommt ein Toast „%n locked item was not changed.“ bzw. „%n locked items were not changed.“ mit der Zahl der Objekte; eine Text-Op geht in die Textrettung, mit dem Hinweis „Not saved: this item is locked. Copy your text before closing.“; nie gibt es den `bad`-Weg oder „Undo not possible“. Ein Tab mit einem Bündel von vor Job 023 kennt den Code nicht. Er behandelt ihn wie `bad`: Die Op wird verworfen, und es kommt eine Warnung. Schlösser zeigt so ein Tab nicht. Das endet mit Bau, Cache-Bust und Neuladen. Protokoll 2 und die Epoche bleiben, denn der Pfad war vorher `bad` und kommt nur hinzu. **(R36)** Seit Job 026 sendet der Client `p.group` und den Pfad `group`; einen neuen Ergebniscode gibt es dafür nicht. Ein Tab mit einem Bündel von vor Job 026 sendet beides nicht. Er bekommt `group` in `items`, wertet es aber nicht aus: Ein Klick wählt dort nur ein Mitglied, und Ziehen bewegt es allein; Rückgängig eines Löschens bringt das Mitglied ohne Gruppe zurück. Das endet mit Bau, Cache-Bust und Neuladen. Protokoll 2 und die Epoche bleiben, denn beide Formen waren vorher `bad` und kommen nur hinzu.

Alle Ops sind idempotente Setz-Operationen; Wiederholungen sind gefahrlos (put → `dup`, patch setzt dasselbe, remove → `gone`).

**Nachsicht, so umgesetzt:** Unbekannte Schlüssel auf Op-Ebene und unbekannte Wurzelschlüssel in `put.p` werden ignoriert (Vorwärtskompatibilität, client-interne Merker); unbekannte patch-Pfade sind `bad`. **Ausnahme seit 0.3.0:** Die Wurzelschlüssel `group` und `lock` in `put.p` sind nicht unbekannt, sondern für den Server reserviert. Für `lock` ergibt ein Wert ungleich `null` `bad` (anders als bei anderen unbekannten Wurzelschlüsseln); **(R36)** `group` ist seit Job 026 die Gruppe des neuen Objekts (Tabelle oben: `null` oder eine ULID, sonst `bad`). Die patch-Pfade `lock.by`, `lock.name` und `group.<k>` sind weiter `bad` (keine gültigen Pfade); **(R35)** `lock` ist seit Job 023 der Sperr-Pfad (Tabelle oben), und eine Sperre setzt nur er, nie ein put; **(R36)** `group` ist seit Job 026 der Gruppen-Pfad (Tabelle oben). Die Schreibweisen `group_id`, `locked`, `locked_by`, `locked_name` (und `lockedBy`, `lockedName`) bleiben unbekannte Schlüssel und werden ignoriert. Die Rollenprüfung kommt zuerst (`view`/`vote` → `denied`). `revive` wirkt nur als literales `true`. `limit` gilt auch für put + `revive`, denn das erhöht die Zahl lebender Objekte.

### 6.2 LWW-Regeln (serverautoritativ)

1. Reihenfolge = Server-Reihenfolge: Batches über den Board-Zeilenlock serialisiert, im Batch die Array-Reihenfolge.
2. Jeder Pfad ist ein Register; verschiedene Pfade überleben beide, gleicher Pfad: der spätere gewinnt. Ein Vorfahr-Pfad ersetzt den Teilbaum.
   - **2a** `{x, y, parent}` ist **ein** Register (x/y sind relativ zu `parent`); das Ergebnis ist immer das Tripel eines Schreibers.
3. **Werte, „leer = abwesend“:** Skalare, Listen und Objekte als ganze Werte (≤ 6 Ebenen, ≤ 1000 Elemente je Liste, ≤ 100 Schlüssel je Objekt). `{}`, `[]` und `null` sind auf jeder Ebene „abwesend“ und werden entfernt; in Listen sind sie verboten (`bad`). Objekt-Schlüssel erfüllen auf jeder Ebene den Schlüssel-Regex – numerische Schlüssel gibt es nicht. Grund: PHP dekodiert mit `json_decode(…, true)` und kann `{}` und `[]` nicht unterscheiden.
4. put gegen put auf dieselbe ID: der erste gewinnt, der zweite bekommt `dup`.
5. remove gegen patch: remove zuerst → patch `gone`; patch zuerst → danach entfernt. Nur `revive` belebt.
6. **Eltern-Invariante:** lebende Objekte haben `parent = null` oder einen lebenden Container passenden Typs (Notiz → Frame). Nie existierender Elternteil, Typfehler oder Zyklus → `bad`. **Grabstein als Elternteil → `ok`**, das Objekt kommt an die Wurzel mit `x += P.x`, `y += P.y`. Ein Container, der am **Ende** des Batches entfernt ist, gibt seine lebenden Kinder frei (Lage absolut erhalten, eine Änderungszeile je Kind); wird er im selben Batch wieder belebt, gibt er nichts frei.
7. Typregeln: Frames nicht drehbar (`r ≠ 0` → `bad`), Größen in Typgrenzen (Notiz 20–2000, Frame 50–100000; ab Stufe 1 Form 10–20000, Text 4–50000, Verbinder immer 0), Farben `#rrggbb` (ganzer String, gespeichert klein), Text ≤ 6000 (Notiz, Form, Text-Objekt) bzw. 200 Zeichen (Frame-Titel, Verbinder-Beschriftung). Unbekannte Felder unter `data`/`style` bleiben erhalten. Die Feldregeln der Stufe-1-Typen stehen in §6.4.
8. Unbekannte Typen: put nur für Registry-Typen (ein unbekannter Typ wie `pen` → `bad`); patch/remove auf gespeicherte Objekte unbekannten Typs generisch erlaubt (`parent` dort nur `null`). Ein gespeicherter unbekannter Typ ist nie Ziel eines Verbinder-Endes (`bad`, auch als Grabstein; C59).
9. Ein patch, der nichts ändert, schreibt nichts (`ok`). Ein Batch nur aus `bad`/`denied` öffnet keine Transaktion; ein Batch ohne Wirkung wird zurückgerollt (kein rev-Sprung).
10. Konflikte werden nicht gezählt.
11. **Text-Lease:** Ein patch auf den Textpfad (`data.text` bei Notizen, Formen und Text-Objekten, `data.title` bei Frames, `data.label` bei Verbindern) gegen eine fremde, frische Lease → `locked`. Stilfelder, Breite und Schriftgröße bleiben frei (LWW; beim Text-Objekt mit `h`, Regel 13).

**Sperre** **(R35)** (seit Job 023; SPEC-M1 §1.2 Zeile „(R20) Sperren“; geprüft von C84 und C85). `SyncService::authorize()` prüft unter dem Board-Lock gegen die **Arbeitskopie**; ein Sperren oder Entsperren früher im selben Batch zählt also mit. „Gesperrt“ heißt: `locked` ist weder `NULL` noch 0.

| Op | Objekt an dieser Stelle des Batches | Ergebnis |
|---|---|---|
| sperren | lebt, frei | `ok`, gesperrt durch den Principal |
| sperren | lebt, gesperrt (egal von wem) | `ok` ohne Wirkung, der erste Sperrende bleibt |
| entsperren | lebt, frei | `ok` ohne Wirkung |
| entsperren | lebt, eigene Sperre (`locked_by` = Principal-ID) | `ok`, alle drei Sperrspalten `NULL` |
| entsperren | lebt, fremd oder unbekannt gesperrt, mit Moderation (`me.mod`) | `ok`, entsperrt |
| entsperren | lebt, fremd oder unbekannt gesperrt, ohne Moderation | `itemlocked` |
| sperren, entsperren | Grabstein, nie da oder früher im Batch entfernt | `gone` |
| patch (jeder Pfad, auch mit `keep`), remove | lebt, gesperrt | `itemlocked` |
| put, auch mit `revive` | lebt | `dup` wie bisher |

- **Reihenfolge:**
  - Vor der Transaktion prüft `OpValidator::normalize` die Op. Die Rollenprüfung kommt dort zuerst (vorher nur Op-Art und ID): `view`/`vote` bekommen `denied`, auch beim Sperren und beim Entsperren der eigenen Sperre. Wer das Bearbeitungsrecht verloren hat, bekommt also `denied`.
  - Danach prüft `normalize` Pfade und Werte (Format, Wertregeln, Lagegruppe, `lock` als einziger Schlüssel). Ein Fehler dort ist `bad`, auch auf einem gesperrten Objekt, etwa ein patch nur mit `x`.
  - Unter dem Board-Lock kommt dann `itemlocked`, noch vor den Typregeln (`ItemRegistry::checkPatch`), der Text-Lease und den Referenzen. Ein gesperrtes Objekt ergibt also nie `locked`.
  - Auch Moderierende ändern ein gesperrtes Objekt erst nach dem Entsperren. Ein stilles Umgehen gibt es nicht.
- **Gäste:**
  - Eine Gast-Sperre gehört `g:<gid>`.
  - Ein Beitritt mit dem alten Gast-Token behält die gid und damit die Sperre, auch nach Erneuern des Links.
  - Ist die Identität weg (neuer Browser, Beitritt ohne altes Token), entsperren nur Moderierende.
- **Frei bleiben** die abgeleiteten Schreibvorgänge; sie laufen nicht durch `authorize()`:
  - die Freigabe der Kinder eines entfernten Containers (Regel 6): Ein gesperrtes Kind kommt mit absoluter Lage an die Wurzel und bleibt gesperrt;
  - die Freigabe gebundener Verbinder-Enden (Regel 14, §6.4);
  - die `keep`-Verschiebung (Regel 15, §6.4);
  - **(R36)** das Auflösen einer Gruppe (Block „Gruppen“): Ein gesperrtes letztes Mitglied verliert seine Gruppe und bleibt gesperrt.

  Dazu gilt: Ein freier Frame, der ohne `keep` verschoben wird, nimmt gesperrte Kinder mit (ihre Lage ist relativ, ihre Zeilen werden nicht geschrieben). Ein gesperrter Frame ist ein gültiger Elternteil, ein gesperrtes Objekt ein gültiges Verbinder-Ende (`authorizeRef` bleibt `true`). Stimm-Ops sehen die Sperre nicht.
- **Batch:** Eine Op mit `itemlocked` ändert nichts. Ein Batch nur aus `itemlocked`, No-ops und anderen wirkungslosen Codes wird zurückgerollt (Regel 9, kein rev-Sprung).
- **Änderungszeilen:**
  - Es bleibt bei einer Zeile je Objekt und rev.
  - Die Sperre steht darin als Pfad `lock`: `"lock":true` heißt gesperrt, `"lock":null` entsperrt. Der Wert trägt nie Principal-ID oder Name; die Spalte `actor` ist wie bei jeder Op der Sendende.
  - Beispiel `[patch x/y/parent, sperren]` auf dasselbe Objekt: `{"x":…,"y":…,"parent":…,"lock":true}`.
  - Legt derselbe Batch ein Objekt an (oder belebt es wieder) und sperrt es, endet die put-Zeile mit `"lock":true`.
  - `item_bytes` ändert sich durch Sperren nicht.
- **Grabstein und `revive`:**
  - Ein `remove` leert die drei Sperrspalten im selben Schreibvorgang. Das betrifft `[entsperren X, remove X]` in einem Batch.
  - `ItemStore::reviveItem` leert sie ebenfalls; put mit `revive` bringt also ein freies Objekt zurück.
  - Eine spätere Sperre derselben ID im selben Batch wirkt.
- **Gelöschte Konten:**
  - `UserDeletedListener`, `occ knorke:orphans` und der tägliche `CleanupJob` leeren `locked_by` und `locked_name` der Sperren eines gelöschten Kontos.
  - `locked` bleibt; auf dem Draht steht `"lock":{"by":null,"name":null}` (§4).
  - Je betroffenem Board läuft eine kurze Transaktion: rev + 1, die Zeilen bekommen den neuen rev, Änderungszeilen entstehen nicht.
  - Offene Clients holen die Zeilen über `items` im nächsten Sync.

**Gruppen** **(R36)** (seit Job 026; SPEC-M1 §1.2 Zeile „(R20) Gruppieren“; geprüft von C86). Die Gruppe ist ein Feld je Objekt (Spalte `group_id`, auf dem Draht `group`) und ein eigenes LWW-Register wie `z`. Eine Gruppe als eigenes Objekt gibt es auf dem Server nicht: Gruppieren und Lösen sind gewöhnliche patches auf jedes Mitglied.

- **Typregel:** Eine Gruppe ≠ `null` gibt es nur für `sticky`, `shape` und `text`. Das prüft `ItemRegistry::isGroupable`: registrierter Typ, Platzierung `box`, kein Container. Das Gegenstück im Client ist `isGroupable` in `src/model/registry.js`.
  - Ein put eines Frames oder Verbinders mit Gruppe ist `bad` (`checkItem`). Das prüft `OpValidator::cleanPut` schon vor der Schreib-Transaktion, denn der put bringt seinen Typ mit.
  - Ein patch `group` ≠ `null` auf einen Frame, einen Verbinder oder einen gespeicherten unbekannten Typ ist `bad` (`checkPatch`). Das prüft `writeBatch` unter dem Board-Lock, denn erst dort ist der gespeicherte Typ bekannt.
  - `group: null` ist auf jedem Typ `ok` (No-op, wenn schon `null`).
- **Rechte:** wie bei jedem patch.
  - `view` und `vote` bekommen `denied`.
  - Ein patch `group` auf ein gesperrtes Objekt ergibt `itemlocked` (Block „Sperre“).
  - Gäste des Bearbeitungslinks gruppieren und lösen wie jede Rolle, die bearbeiten darf. Ein neues Recht gibt es nicht.
- **Nur der Client prüft** „alle Mitglieder haben denselben Elternteil“ und „mindestens zwei Mitglieder“. Der Server prüft keine Regel über mehrere Objekte; sonst würden gestückelte Anfragen (mehr als 200 Ops) abgelehnt. Eine schiefe Gruppe wirkt nur auf die Darstellung (§11 Fall 12).
- **Auflösen** (Schritt 16c von `writeBatch`, nach der Freigabe von Kindern und Verbinder-Enden, vor dem Schreiben):
  1. Verlierer-Gruppen sind die gespeicherten Gruppen aller Objekte, die bei Batch-Beginn lebten und am Ende entfernt sind oder jetzt eine andere Gruppe haben.
  2. Ihre lebenden Mitglieder sind zum einen die gespeicherten Zeilen, die keine Op des Batches berührt hat. Die liefert `ItemStore::groupMembers` in einer Abfrage über den Index `knorke_items_group`, und nur, wenn es eine Verlierer-Gruppe gibt. Zum anderen zählt jede lebende Arbeitskopie mit dieser Gruppe.
  3. Bleibt genau ein Mitglied, wird seine Gruppe `null`, im selben rev. Der Pfad `group` geht in seine eine Änderungszeile (`"group":null`). Hat keine Op des Batches dieses Mitglied mit `ok` geändert, zählt die Zeile als abgeleitete Zeile ins Schreibbudget (SPEC-M1 §4.13.6); sonst gehört der Pfad zur Zeile dieser Op, die nicht abgeleitet ist.
  4. Bei keinem oder mindestens zwei Mitgliedern geschieht nichts.

  Dazu gilt:
  - Das Auflösen läuft ohne `authorize()`, wie die Freigaben der Regeln 6, 14 und 15. Auch ein gesperrtes letztes Mitglied verliert seine Gruppe; Lage, Inhalt und Sperre bleiben.
  - Wer bearbeiten darf, auch ein Gast, kann einem gesperrten Objekt so mittelbar die Gruppe nehmen. Er löscht dazu dessen letzten freien Partner oder nimmt ihn aus der Gruppe. Der Nutzer hat das am 17.10.2026 bestätigt.
  - Gruppen, die nur Mitglieder gewinnen, prüft der Server nie. So darf eine Gruppe über mehrere Anfragen entstehen.
  - Ein Mitglied, das nur für das Zählen geladen wurde, ist eine Teilkopie wie bei der Freigabe von Kindern. Es schreibt höchstens Lage und `group_id`, nie `data` oder `style`.
  - Beispiele:
    - G = {A, B, C}: remove A → nichts; danach remove B in einem eigenen Batch → C bekommt `group: null` im selben rev.
    - `[remove A, remove B, remove C]` → nichts wird gelöst, keine weitere Zeile.
    - G = {A, B}: patch A `{group: H}` → B wird gelöst. H = {A} wird nicht geprüft.
    - G = {A, B} in Frame F: `[remove F, remove A]` → B kommt an die Wurzel und wird gelöst, in einer Änderungszeile mit Lage und `group`.
    - G = {A, B}: `[patch B {data.text}, remove A]` → B wird gelöst, in derselben Änderungszeile wie sein Text; sie zählt nicht als abgeleitete Zeile.
- **Schreiben:**
  - `insertItem` und `reviveItem` schreiben `group_id` aus dem put. Ein put mit `revive` ohne Gruppe schreibt `NULL`, auch wenn der Grabstein noch eine trug.
  - Ein `remove` lässt `group_id` im Grabstein stehen. Er wird nie ausgeliefert und nie gezählt.
  - `item_bytes` ändert sich durch `group` nicht.
- **Änderungszeilen:**
  - Es bleibt bei einer Zeile je Objekt und rev.
  - Ein patch trägt `"group":"<id>"` bzw. `"group":null`.
  - Im put-JSON folgt nach `"style"` der Schlüssel `,"group":"<id>"`, vor einem `,"lock":true`. Ohne Gruppe bleibt das put-JSON wie bisher.
- **Darauf baut der Client** (`src/board/actions.js`):
  - `groupItems` schickt je Mitglied `{group: <neue ULID>}`, `ungroupItems` je Mitglied `{group: null}`. Die Inverse setzt die alten Werte. Beides ist je ein Undo-Schritt.
  - `deleteItems` schickt vor den `remove`s `{group: null}` an das eine übrig bleibende Mitglied, wenn es nicht gesperrt ist. Die Inverse belebt mit `p.group` und setzt danach `{group: g}`. Ist der Rest gesperrt, schickt der Client nichts, und der Server löst auf.
  - Einfügen und Duplizieren schicken puts mit `p.group`: eine neue Gruppen-ID je Einfügen und alter Gruppe.

### 6.3 Validierung und Grenzen

| Grenze | Wert |
|---|---|
| Ops je Anfrage | 200 (sonst 400) |
| Pfade je patch | 50 (sonst `bad`) |
| Text `data.text` | 6000 Codepunkte; Titel 200; jeder andere String 6000 |
| `data` + `style` je Objekt | 65536 Byte nach dem Anwenden (UTF-8, ohne `\u`-Escapes) |
| Body | 1 MiB |
| Seite | 500 Objekte |
| lebende Objekte je Board | 5000 (`limit`) |
| Koordinaten | endlich, `|x|, |y| ≤ 1e7`, `w, h ≥ 0`, `r ∈ [-360, 360]` |
| z-Schlüssel | fractional-indexing 4.0, base 36: `^[0-9a-z]{1,64}$`, nicht der kleinste Schlüssel, Ganzzahlteil vollständig, Bruchteil endet nicht auf `0` |
| Strings | gültiges UTF-8; NUL und C0-Steuerzeichen außer `\t`/`\n` entfernt, `\r\n` → `\n` |
| 4-Byte-Zeichen | nur ohne 4-Byte-UTF-8 in der Datenbank (`supports4ByteText()` = false: MySQL/MariaDB mit `mysql.utf8mb4 = false`): jeder Codepunkt U+10000–U+10FFFF in Titeln und in jedem String von `data`/`style` (jede Tiefe) → U+FFFD; die Op bleibt `ok`, die Codepunkt-Zahl gleich; der Schreiber bekommt seine gespeicherten Objekte in `items` derselben Antwort (bei `more: true` in der Folgeseite) |

Die Wertgrenzen (6 Ebenen, 1000 Listenelemente, 100 Schlüssel, Schlüssel-Regex) gelten für den **Rohwert vor dem Säubern**: Ein Container auf Ebene 7 ist `bad`, auch wenn er leer ist; ein Objekt mit 101 Schlüsseln ist `bad`, auch wenn alle Werte `null` sind; ein ungültiger Schlüssel ist `bad`, auch mit dem Wert `null`. Weitere Feinheiten von `setPath` (Löschen eines fehlenden Pfads ist ein strikter No-op, Setzen durch einen Skalar ersetzt ihn durch ein Objekt) legt `tests/fixtures/paths-golden.json` fest.

### 6.4 Stufe 1: Formen, Text-Objekte, Verbinder (SPEC-M1 §3.10, §4.7, §4.8)

Der Server-Teil der ganzen Stufe 1 (auch der Verbinder) steht seit Runde 1a; die Verbinder-Oberfläche kam mit Runde 1b (unten: Verbinder im Client). Geprüft von C53–C59 und der erweiterten Lauf-Invariante CINV.

**Rundungsformel `q`** (bitgleich in PHP `Connectors::q` und JS `q` aus `src/model/geometry.js`, nie PHP `round()`):

```
q(v, k) = (v < 0 ? -1 : 1) * floor(abs(v) * k + 0.5) / k
```

**(R7)** `q` liefert nie `-0`: Ein Ergebnis 0 wird als `+0` geliefert (PHP `$r + 0.0`, JS `r + 0`). Für −0,005 < v < 0 ergäbe die Formel sonst `-0`; PHP `json_encode(-0.0)` schreibt `-0`, `JSON.stringify(-0)` `0`, und Vergleiche gespeicherter Enden wären je nach Sprache verschieden. `k = 100` für Ankerpunkte, `k = 10000` für `ax`/`ay`, `k = 10` für Präsenz-`v` (Stufe 3), `k = 100` für Lagewerte aus Transform und Anordnen (nur Client). Beispiele (festgenagelt in `tests/fixtures/connector-golden.json`): `q(51.945, 100)` = 51,95; `q(-0.005, 100)` = −0,01; `q(1.005, 100)` = 1 (weil `1.005·100` = 100,49999999999999; PHP `round` gäbe 1,01); `q(-0.001, 100)` = 0.

**Typregeln** (`ItemRegistry` = `src/model/registry.js`, beide gegen `tests/fixtures/registry-golden.json`):

| Typ | Lage | Größe | Felder |
|---|---|---|---|
| `shape` | Box, drehbar, Kind von Frames, bindbar | 10–20000 | `data.kind` ∈ rect, roundRect, ellipse, diamond, triangle, arrowRight; `data.text` ≤ 6000; `style.fill`, `style.stroke`, `style.textColor` (Farben); `style.fillOpacity` 0–100; `style.strokeWidth` 0–24; `style.dash` ∈ solid, dashed, dotted; `style.fontSize` 8–200 (fehlt = automatisch angepasst); `style.align` ∈ left, center, right; `style.valign` ∈ top, middle, bottom |
| `text` | Box, drehbar, Kind von Frames, bindbar | 4–50000 (`w` = Umbruchbreite, `h` gemessen) | `data.text` ≤ 6000; `style.fontSize` 8–400; `style.color`; `style.align` |
| `connector` | **none**: `x = y = w = h = r = 0`, `parent = null` | 0 | `data.start`, `data.end` (Pflicht, Endpunkt); `data.route` ∈ straight, elbow, curved; `data.label` ≤ 200; `style.stroke`; `style.strokeWidth` 1–24; `style.dash`; `style.startCap`, `style.endCap` ∈ none, arrow, triangle, dot, diamond |

Ganzzahlen nehmen Gleitkommazahlen mit `.0` an und werden nie als `-0` gespeichert. Aufzählungen prüft der Server streng (`is_string` und `in_array(…, true)`: `true` ist kein gültiger `kind`). Fehlt ein Feld in einem gespeicherten Objekt, gilt die Darstellungs-Vorgabe aus SPEC-M1 §3.10 (z. B. `data.kind` → `rect`, `style.endCap` → `none`); die Anlege-Vorgaben des Clients (z. B. Endspitze `arrow`) werden beim Anlegen gespeichert.

**Endpunkt** (`data.start`, `data.end`), genau eine von drei Formen, kein weiterer Schlüssel (sonst `bad`):

| Form | Bedeutung | gespeichert |
|---|---|---|
| `{item}` | an einem Objekt, Seite beim Routing automatisch | wie gesendet |
| `{item, ax, ay}` | an einem Ankerpunkt der **ungedrehten** Box, `ax`, `ay` ∈ [0, 1] | **(R8)** am gesendeten Wert geprüft (`ax: 1.00004` → `bad`), dann `q(v, 10000)` (`0.123456` → `0.1235`); Reihenfolge `item, ax, ay` |
| `{x, y}` | freies Ende in Weltkoordinaten, Beträge ≤ 1e7 | **(R8)** nicht gerundet, wie gesendet, nie `-0`; Reihenfolge `x, y` |

**(R8)** `item` ist eine ULID (26 Zeichen Crockford-Base32, Großbuchstaben), sonst `bad`; ob sie ein lebendes, bindbares Objekt nennt, entscheidet Regel 14 im Lock.

**LWW-Regeln 12–15, 18, 19** (Ergänzung zu §6.2):

12. **Lage none (Verbinder):** put mit einer anderen Lage als 0/0/0/0/0/`null` → `bad`; ein patch mit einem der Pfade `x`, `y`, `w`, `h`, `r`, `parent` → `bad`. Einen Verbinder verschieben heißt, seine freien Enden zu patchen.
13. **Gemessene Texthöhe (`text`):** `h` ist eine gewöhnliche Zahl, die der Client im **selben** patch mitschreibt, der Text, Schriftgröße oder Breite ändert; der Server rechnet `h` nie. Der Lease-Halter misst beim Schließen des Editors noch einmal und schickt `{h}`, wenn der Wert um mehr als 0,5 abweicht.
14. **Verbinder-Enden:**
    - `data.start` und `data.end` sind je **ein Register** (ganzer Wert). Ein patch auf einen Unterpfad (`data.start.item`, `data.start.ax`, `data.end.x`) → `bad`. Zwei Personen, die verschiedene Enden ziehen, gewinnen beide; dasselbe Ende: der Spätere.
    - **Prüfung im Lock** gegen die Arbeitskopien des Batches, für jedes Ende mit `item = E`: `E` ist der Verbinder selbst, hat nie existiert oder ist nicht bindbar (Frame, Verbinder, unbekannter gespeicherter Typ) → `bad`; `E` ist ein Grabstein oder im selben Batch entfernt → **kein** `bad`, das Ende wird zum freien Punkt am Ankerpunkt von `E` (`ok`); `E` lebt → gesetzt. **(R9)** Ein Ziel, das derselbe Batch angelegt und wieder entfernt hat, gilt als „im Batch entfernt“ (freier Punkt, nicht „nie existiert“). Der Ankerpunkt kommt hier aus den Arbeitskopien von `E` und seinem Container **zum Zeitpunkt der Op**.
    - **Freigabe am Batch-Ende:** Für jedes Objekt, das am Ende des Batches entfernt ist (**(R9)** auch eines, das derselbe Batch angelegt und wieder entfernt hat), bekommt jeder **lebende** Verbinder, der daran hängt, das betroffene Ende als freien Punkt am Ankerpunkt: gleicher rev, **eine** zusammengeführte Änderungszeile je Verbinder (`patch {"data.start": {x, y}}` bzw. `data.end`, beide in einer Zeile, wenn beide Enden betroffen sind). Ein Verbinder, der im selben Batch selbst entfernt wird, wird nicht freigegeben.
      - **(R9)** Der Ankerpunkt kommt aus den Arbeitskopien **am Batch-Ende** (Ziel und Container): Ein Container, der nach dem Entfernen des Ziels im selben Batch noch verschoben wird, zählt mit seiner Endlage.
      - Der Byte-Beitrag ist die echte Größenänderung, die Freigabe wird aber nie mit `limit` abgelehnt. **(R9)** Auch `MAX_ITEM_BYTES` lehnt sie nie ab: Ein Verbinder mit fast 64 KiB generischer `data` kann die Grenze um wenige Bytes überschreiten (hingenommen).
      - **(R9)** Liefert `authorizeRef` bei der Freigabe `false` (erst ab M2 möglich; M1 liefert immer `true`), bleibt dieses Ende gebunden und wird nicht geschrieben.
    - Hat der Client das Ende vorher selbst gelöst (patch auf einen freien Punkt **vor** dem remove, so macht es `deleteItems`, damit Rückgängig die Bindung wiederherstellt), gibt der Server nichts frei. Die Server-Freigabe fängt nur gleichzeitige Fälle; bei einem `{item}`-Ende („auto“) landet das freie Ende dann in der Objektmitte statt an der Seitenmitte.
    - **Abgeleitete Spalten:** Jedes Schreiben von `data` eines Verbinders setzt `start_item`/`end_item` aus dem gespeicherten Endzustand (freies Ende → `NULL`); andere Typen haben dort immer `NULL`.
    - **Ankerpunkt** (`Connectors::anchorPoint` = `anchorPoint` in `src/model/connectors.js`): Box `(X, Y, w, h, r)` mit `X = x + parent.x`, `Y = y + parent.y` (Container sind Wurzel), `cx = X + w/2`, `cy = Y + h/2`; ohne `ax/ay` → `(cx, cy)`, sonst `dx = (ax − 0,5)·w`, `dy = (ay − 0,5)·h`, `θ = r·π/180`, `px = cx + dx·cos θ − dy·sin θ`, `py = cy + dx·sin θ + dy·cos θ`; Ergebnis `[q(px, 100), q(py, 100)]`, Rechenreihenfolge wörtlich so. Für `r = 0` bitgleich in PHP und JS; für `r ≠ 0` können `sin`/`cos` von V8 und libm im letzten Bit abweichen. Deshalb vergleichen C55, C56 und das Konvergenz-Orakel freie Enden **gedrehter** Ziele mit ±0,01, ungedrehter exakt.
15. **Container `keep`:** Ein patch mit `"keep": true` (nur das Literal) auf einen Container `C` rechnet nach dem Setzen seiner Pfade `dx = x_neu − x_alt`, `dy = y_neu − y_alt` (Arbeitskopie vor bzw. nach dieser Op). Ist eines ≠ 0, bekommt jedes Kind, das **zum Zeitpunkt dieser Op** lebendes Kind von `C` ist (gespeicherte Kinder und Arbeitskopien mit `parent == C`), sofort `x −= dx`, `y −= dy`: Die Kinder bleiben auf dem Board stehen.
    - **(R9) Zeitpunkt der Op, nicht Batch-Ende:** Eine spätere Op desselben Batches auf die Lagegruppe eines Kindes gewinnt (LWW in Op-Reihenfolge). Objekte, die erst **nach** der `keep`-Op in `C` gesetzt werden, werden nicht verschoben. Ein Kind, das der Batch später entfernt, bleibt entfernt. Ein Kind, das der Batch **vor** der `keep`-Op in `C` gesetzt oder darin verschoben hat, wird mitverschoben (seine absolute Lage bleibt die der Op). Mehrere `keep`-patches eines Containers in einem Batch wirken nacheinander, jeder auf die dann lebenden Kinder. Wird `C` im selben Batch danach entfernt, gibt das Batch-Ende die verschobenen Kinder frei (Regel 6: `x/y` plus die Endlage von `C`).
    - **Geschrieben** wird mit der ganzen Lagegruppe: Die Änderungszeile eines verschobenen Kindes trägt immer `{x, y, parent}` (`parent` unverändert; gewöhnliche patches lassen ein unverändertes `parent` weiter weg), eine zusammengeführte Änderungszeile je Kind, auch bei 600 Kindern in einem Bündel-Schreibvorgang (`ItemStore::shiftChildren`, C58: < 1 s).
    - **Darauf baut der Client:** `transformItems` schickt den `keep`-patch des Frames **vor** den Mitgliedschafts-patches, die relativ zur **neuen** Frame-Lage gerechnet sind, und die Inverse ebenso; `Replica` spielt die Verschiebung lokal genauso nach. Kinder, die danach außerhalb der Box liegen, bleiben Kinder; die Mitgliedschaft prüft der Client im selben Commit neu (Freigabe per `patch {x, y, parent: null}`, Übernahme per `patch {x, y, parent: C}` relativ zur neuen Lage).
    - Ohne `keep` wandern die Kinder wie in M0 mit; `keep` auf einer Notiz wird ignoriert. Rückgängig trägt ebenfalls `keep`. Ein gleichzeitiges Verschieben eines Kindes durch jemand anderen, dessen Relativlage gegen die alte Frame-Lage gerechnet war, landet um `(dx, dy)` versetzt – dieselbe hingenommene Eigenschaft wie beim Verschieben eines Frames in M0.
    - **Geprüft:** C58 prüft beide Reihenfolgen in einem Batch (Kind vor dem `keep`-patch verschoben → mitverschoben; danach übernommen, freigegeben oder verschoben → wie gesendet; danach entfernt → entfernt). Die Konvergenz-Last schickt die Reihenfolge von `transformItems` (`keep`-patch, danach Übernahmen und Freigaben im selben Batch), das Orakel bildet `keep` in Op-Reihenfolge nach.
18. **Aufzählungsfelder:** unbekannte Werte → `bad` bei put und patch. Ein gespeicherter Wert aus einer späteren Version bleibt erhalten, patches anderer Pfade sind erlaubt, der Client zeichnet ihn mit Rückfall (unbekannte Form → Rechteck, unbekannte Spitze → keine).
19. **Pflichtfelder** (nur Verbinder: `data.start`, `data.end`): put ohne → `bad`; ein patch, der eines löscht (`null`, `{}`), → `bad`.

**Verbinder im Client (Runde 1b, `src/board/actions.js`).** Alle Verbinder-Änderungen sind gewöhnliche Ops; einen neuen Vertrag gibt es nicht.

| Aktion | Ops | Rückgängig |
|---|---|---|
| **Anlegen** (`connectItems`: Werkzeug L, „+“-Griff, „Connect“ mit zwei ausgewählten Objekten) | genau ein `put` mit Lage none (`x = y = w = h = r = 0`, `parent: null`), beide Enden in gespeicherter Form (`normalizeEndpoint`: `ax`/`ay` mit `q(v, 10000)`, freie Enden auf dem 0,01-Raster der Client-Lagen), `data.route` und `style.endCap` aus den Werkzeug-Optionen (Vorgaben `straight` und `arrow`). Ein Ende an sich selbst, an einem Frame, einem Verbinder oder einem unbekannten Typ schickt der Client gar nicht erst | `remove` |
| **Umhängen** (`retargetEnd`: Endgriff ziehen) | ein `patch` mit dem **ganzen** Ende (`{"data.start": …}` bzw. `data.end`), nie ein Unterpfad (Regel 14: `bad`) | das alte Ende |
| **Verschieben** (`moveItems` v2) | gebundene Enden werden nie geschrieben, sie folgen ihren Zielen beim Zeichnen; ein ausgewählter Verbinder verschiebt seine freien Enden (ganzes Ende plus Versatz) nur, wenn jedes gebundene Ende einem mitbewegten Objekt folgt – allein ist ein Verbinder mit gebundenem Ende nicht ziehbar | die alten Enden |
| **Löschen** (`deleteItems` v2) | **vor** den `remove`s ein `patch` je Verbinder, der an einem gelöschten Objekt hängt und nicht selbst gelöscht wird: das betroffene Ende als freier Punkt an der **sichtbaren** Andockstelle (Route aus `geometryOf`; ohne Route der Ankerpunkt des Ziels). Der Server hat dann nichts mehr freizugeben. Verbinder an Kindern eines gelöschten Frames bleiben gebunden (die Kinder werden nur freigegeben) | erst die Objekte beleben, dann die Enden wieder binden: **ein** Schritt |
| **Kopieren und Einfügen** (`copyPayload`, `pasteItems` mit `remapEndpoint`) | Mitgenommen wird ein Verbinder, der selbst ausgewählt ist oder dessen beide Enden im Payload liegen; ein Ende, dessen Ziel nicht im Payload liegt, wird **schon beim Kopieren** zum freien Punkt an seiner aktuellen Lage (Route aus `geometryOf`). Beim Einfügen: Ende im Payload → neue ID; ein gebundenes Ende außerhalb (nur in einem Payload, den nicht Knorke selbst kopiert hat) bleibt auf demselben Board an einem lebenden, bindbaren Ziel gebunden; freie Enden wandern mit dem Einfügen; ein Ende, das sich nicht setzen lässt, lässt den Verbinder weg (als übersprungen gemeldet). In der Op-Liste steht ein Verbinder nach beiden Enden | alle `remove`s |

Die Beschriftung `data.label` liegt unter der Text-Lease (`allTextPaths`) und nimmt an der Textrettung teil. Die Freigabe des Servers greift deshalb nur in gleichzeitigen Fällen (jemand bindet ein Ende an ein Objekt, das ein anderer im selben Moment löscht), denn der löschende Client löst die Enden, die er sieht, vorher selbst; ein „auto“-Ende landet dann in der Mitte des Objekts statt an seiner Seite.

**Freigabe, wie gebaut (Server seit Runde 1a, in Runde 1b unter Verbinder-Last geprüft).** Regel 14 gilt so, wie sie oben steht, mit zwei Zeitpunkten in einem Batch:
- **Ein Ende, das auf ein schon entferntes Ziel zeigt** (Grabstein aus einem früheren Batch, auch eines anderen Clients, oder im selben Batch vorher entfernt), wird sofort zum freien Punkt am Ankerpunkt von Ziel und Container **zum Zeitpunkt der Op**. Verschiebt dieselbe Anfrage den Container danach noch, ändert das den Punkt nicht mehr.
- **Ein gebundenes Ende, dessen Ziel am Batch-Ende entfernt ist**, wird am Ankerpunkt der Arbeitskopien **am Batch-Ende** frei. Mit `keep` heißt das: Wird das Kind eines Frames nach dem `keep`-patch entfernt, ist es vorher mitverschoben worden, und der freie Punkt ist die Stelle, an der es stand. Wird es **vor** dem `keep`-patch entfernt, ist es beim `keep` kein lebendes Kind mehr und wird nicht verschoben; sein freier Punkt wandert mit der Endlage des Frames.
- Geprüft von C55/C56 (exakt bei ungedrehten, ±0,01 bei gedrehten Zielen) und der Konvergenz mit Verbinder-Last (`dev/sim/converge.mjs`, ab Runde 1b Vorgabe; `docs/ENTWICKLUNG.md` §5.1): Ende auf ein im selben Batch entferntes Ziel, Ende auf einen fremden Grabstein, Freigabe fremder Verbinder, beide `keep`-Reihenfolgen, je ohne Abweichung auf pgsql, MariaDB ohne utf8mb4 und SQLite.

**Lauf-Invariante CINV** (am Ende jedes Vertragslaufs, über alle Boards des Laufs): `item_bytes`/`item_count` stimmen; jeder lebende Verbinder hat `start_item`/`end_item` gleich `data.*.item`, beide Enden in gespeicherter Form, Lage none und gebundene Enden nur an lebenden, bindbaren Objekten (Löschen gibt frei); `start_item`/`end_item` nur bei Verbindern; keine Stimmzeile einer geschlossenen Sitzung, höchstens eine offene Sitzung je Board, `meta_rev ≤ rev`.

## 7. Präsenz und Text-Lease

`me` = `{"c": [x, y] | null, "s": [ulid…] (≤ 20), "d": [[ulid, x, y]…] (≤ 20, absolute Welt-Position), "e": ulid | null, "tk": 1 (optional)}`.

- Gespeichert unter `<pid>:<client>` im Blob `p:<board>`; die pid kommt vom Server, fremde Einträge sind nicht überschreibbar. Unbekannte Felder werden ignoriert; der Server baut den Eintrag aus einer festen Liste.
- **Präsenz-Regel (Protokoll 2):** Für jeden Principal, der nicht bearbeiten darf (Rolle `vote`, ab Stufe 2), setzt der Server `s: []`, `d: []`, `e: null`, `tk: 0`; es bleiben nur `c` und `v`. So kann ein Inhaber des Abstimm-Links keine fremden Ziehvorschauen einschleusen. Der Client schickt `me` nur im Modus edit; ein abstimmender oder ansehender Client sendet keine Präsenz (einzige Ausnahme ab Stufe 3: der präsentierende Tab außerhalb des Modus edit oder bei offenem `VotePanel` schickt `{v}`, unten), sein letzter Eintrag verfällt nach 10 s.
- **(R22) Präsenz-Kappung:** Höchstens 3 Einträge je pid, 50 Einträge von Nicht-Bearbeitern (Rolle `vote`) und 200 insgesamt. Wer über die Kappung hinaus verdrängt wird, wird in sechs Klassen geordnet (zuerst Nicht-Bearbeiter, zuletzt Moderierende; dazwischen Bearbeiter ohne `e`/`v`, mit `v`, mit `e`, Lease-Halter); darunter bleibt der Schlüssel `<pid>:<client>` aus `meta.summon` immer erhalten. Der Server speichert dafür das interne Feld `rk`; es erscheint nie in der Antwort (SPEC-M1 §5.5).
- Höchstens ein Schreiben je Schlüssel alle 250 ms (außer `e` ändert sich oder `tk` ist gesetzt), höchstens 3 Einträge je pid (der älteste derselben pid fliegt), höchstens 200 je Blob.
- Einträge älter als 10 s verfallen. Der Client sendet `me`, wenn es sich geändert hat oder die letzte Sendung ≥ 3 s her ist.
- Ausgabe je Eintrag: `n` Anzeigename, `k` pid (Farbe), `g` 1 = Gast, `x`/`y`, `s`, `d`, `e`, **`h`** 1 = hält die Lease für `e`, ab Stufe 3 **`v`** = Viewport `[x, y, w, h]` oder `null`. Genau diese zehn Felder (C71, C75); Stimmen stehen nie in der Präsenz.
- **(Stufe 3) Präsenz beim Abstimmen und Präsentieren** (SPEC-M1 §6.4, R16): Ein Client schickt `me` nur im Modus edit und nicht, solange eine Sitzung offen und das `VotePanel` geöffnet ist. Einzige Ausnahme ist der präsentierende Tab (`meta.summon.pid` = eigene pid und `meta.summon.client` = eigene Client-ID): im Modus edit ohne offenes `VotePanel` der volle Eintrag mit `v`, sonst (Modus vote oder view, auch auf Tablets, und bei offenem `VotePanel`) nur `{v}`, mindestens alle 3 s, damit die Folgenden ihr Ziel behalten. Abstimmende Personen erscheinen so nie mit Cursor oder Auswahl; ihr letzter Eintrag aus dem Modus edit verfällt nach 10 s (E31 prüft `__knorke.sentPresence()` = `null` und den Verfall in der Präsenz der Moderatorin).
- **Lease:** Halter einer ID ist der frische Eintrag mit `e == id` und dem kleinsten Rang `es` (vom Server gesetzt, wenn `e` auf eine neue ID wechselt; bleibt `e` gleich, bleibt `es`). `tk: 1` mit `e` setzt `es = min(es der anderen frischen Einträge mit demselben e) − 1`: wer übernimmt, wird Halter. Wer nach einem Verfall zurückkommt, steht hinten an. Derselbe Principal (auch im zweiten Tab) ist nie gesperrt. Ohne Redis gibt es keine Lease (reines LWW).
- **Präsenz vor Ops:** Der Server schreibt die Präsenz einer Anfrage **vor** ihren Ops (§4.10.2 Schritt 0). Eine Übernahme (`tk`) zählt deshalb schon für die Text-Ops derselben Anfrage (C36) – und ein `e = null` gibt die Lease frei, bevor die Text-Ops derselben Anfrage geprüft werden (daraus folgt die Client-Pflicht „Lease-Nachlauf“, §10).

### 7.1 Übernehmen (`tk`), wie umgesetzt

Ablauf zwischen Szene [S], Session [C] und Server [B]:

1. **Sperre beim Öffnen** (Szene, `SceneManager.openTextEditor`/Doppelklick): Zeigt eine **frische** Präsenz-Probe (beim Klick neu vom Sampler geholt) einen anderen Teilnehmer mit `editing == id` und `editingHolder` (`h = 1`), öffnet sich **kein** Editor. Stattdessen bekommt der Chip `[data-knorke-editing=<id>]` 5 s lang (`TAKE_OVER_MS`) die Aktion `[data-knorke-action=take-over]` („Take over“). Die Sperre hängt am Halter, nicht an irgendeinem fremden `e`; zwei gleichzeitig Öffnende sperren sich also nicht gegenseitig, und vor der ersten Präsenz-Antwort öffnet ein Doppelklick zu Recht (E04b wartet deshalb, bis `presence()` den Halter zeigt). Ist der eigene Editor für diese ID schon offen, ändert ein erneutes Öffnen nichts. Neu angelegte Notizen öffnen immer; die Textrettung öffnet mit `text` + Hinweis ohne Sperrprüfung.
2. **Klick auf „Take over“:** Die Szene öffnet den Editor (Objekt muss noch existieren, nicht im Ansehen-Modus) und meldet `onEditing(id, true)`. Ist der Editor dieses Objekts schon offen (der Knopf überlebt das Angebot bis zum nächsten Bild, etwa wenn die Textrettung den Editor dazwischen mit Hinweis geöffnet hat), hebt die Szene den Hinweis auf und meldet ebenfalls `onEditing(id, true)`: Ein Klick auf „Take over“ endet immer in einer Übernahme, nie still im Nichts.
3. **Session** (`BoardSession`): `onEditing(id, true)` setzt `takeoverId = id`, streicht die ID aus den verlorenen Leases (`leaseLost`) und weckt den Takt. `getPresence()` schickt `e = editingId ?? leaseTail` und `tk: 1`, solange `takeoverId === e` – **auch nachdem der Editor schon zu ist**: Der Lease-Nachlauf hält `e`, und der letzte Text geht nie ohne die Übernahme hinaus. `takeoverId` endet erst, wenn eine Anfrage mit `tk` und `e = takeoverId` beantwortet ist (`onPresenceSent`), oder wenn `me.e` das Objekt nicht mehr nennt (anderer Editor, oder nichts mehr zu speichern; `dropStaleTakeover`). Solange die Übernahme offen ist, werten Antworten, die noch den alten Halter nennen, für dieses Objekt **nicht** als „Lease verloren“. Ein Text dieses Objekts, der noch **vor** der Übernahme hinausging und `locked` zurückkam, gilt nicht als verloren: Die Session merkt ihn (`takeoverText`) und schickt ihn hinter der angekommenen Übernahme noch einmal, sofern kein neuerer Text desselben Pfads aussteht; fällt die Übernahme weg, bekommt er die normale Textrettung.
4. **Server:** `tk` + `e` → Rang vor alle anderen (siehe oben), wird nie gedrosselt; die Text-Ops derselben Anfrage sind schon erlaubt.
5. **Der Verdrängte** (`BoardSession.loseLease`): Sobald seine Session für die eigene Editier-ID einen fremden Halter (`h = 1`) sieht, eine Text-Op abgelehnt wird (`locked` u. a.) oder das Board einfriert, bleibt sein Editor offen (`data-knorke-editor-state=locked`), der Text bleibt darin, Zwischen-Commits hören auf (Text-Intents dieser ID werden verworfen), und der Hinweis lautet „Not saved: {name} is editing this item. Copy your text before closing.“. Schließen verwirft ohne Commit (F6: wer übernimmt, gewinnt). **Pflicht:** Auch ein Text-Patch dieses Objekts, der vor dem Verlust in die Warteschlange kam, aber noch nicht gesendet ist, geht nicht mehr hinaus. Sonst landet er beim Server, sobald der neue Halter seinen Editor geschlossen und die Lease freigegeben hat, und überschreibt dessen Text mit einem gültigen `ok` (der Server handelt dabei richtig: es gibt keinen fremden Halter mehr). Umgesetzt: `loseLease` streicht mit `Replica.dropQueuedPaths(id, [Textpfad])` den Textpfad aus jedem eingereihten, noch nicht gesendeten patch dieses Objekts (andere Pfade desselben patch bleiben; ein patch ohne Rest fällt weg). Was schon unterwegs ist, kommt beim Server nach der Übernahme an und wird `locked`. Der gestrichene Text steht weiter im Editor.

**Pflicht „`tk` genau einmal“** (§6.5): Ab `onEditing(id, true)` trägt jede Anfrage `tk: 1` mit `e = id`, bis eine davon beantwortet ist – im Normalfall also genau die erste, nach einem Netzfehler auch die Wiederholung –, und zwar **auch dann, wenn der Editor bis dahin schon wieder zu ist** (schnelles Tippen und Esc innerhalb eines Takts). Fehlt `tk`, geht der letzte Text mit `e = id` (Lease-Nachlauf) ohne Rang zum Server, der alte Halter hält weiter, und der Text kommt `locked` zurück (Textrettung statt Übernahme). So umgesetzt (Schritt 3); wie die Lücke gefunden wurde, steht am Ende von Abschnitt 10.

## 8. Gäste

- **Beitritt** `POST /pub/v1/{token}/join {"client", "name", "guest": <altes Token>|null}`: Link aktiv → weiter; zurückgezogen → 403 `link_revoked` (kein Fehlversuch); nie ausgestellt → Drossel → 404 bzw. 429; verbietet die Link-Richtlinie dem Besitzer Links → 403 `links_disabled`, noch vor der Namensprüfung, der Drossel und dem Ausstellen eines Tokens (kein Fehlversuch). Name gesäubert (Steuer- und unsichtbare Zeichen weg, Leerraum zusammengefasst, ≤ 40 Zeichen), leer → 400 `name_required`. Ist `guest` ein gültiges (auch abgelaufenes) Token **desselben Boards**, bleibt die Identität erhalten, sonst neue Gast-ID (Drossel 300 je 10 min und Board und Adresse).
- **Gast-Token:** `b64url(json) . '.' . b64url(hmac_sha256)`, Claims `{"v":1, "b": board, "g": gid, "r": "edit", "lg": link_gen, "exp", "n"}`, ≤ 1024 Byte, 30 Tage gültig.
- **Prüfreihenfolge** (Fastpath, voller Pfad, Snapshot gleich): Signatur/Form → **`b == Board der Route`** → Rolle in den Link-Rollen (jeweils sonst 401 `guest_token`) → Board weg → 404; `lg ≠ link_gen` → 403 `link_revoked`; Links für den Besitzer verboten (Fastpath: `a:<board>[3] = 0`) → 403 `links_disabled`.
- **Öffentliche Seite `/p/{token}`:** aktiver Link → `linkState = 'ok'` und `boardId`; zurückgezogener → `linkState = 'revoked'`, `boardId = null` (ohne Fehlversuch); nie ausgestellter → Drossel, sonst `linkState = 'invalid'`. Einen eigenen Zustand für „Links verboten“ gibt es nicht (der Beitritt sagt es). Die Seite schreibt nichts. Initial-State-Schlüssel jeder Seite: `page`, `boardId`, `joinToken`, `linkToken`, `linkState`, `debug`, `protocol`, `limits`, `legal`; `legal` = `{"imprintUrl", "privacyUrl"}` aus theming auf jeder `/p`-Variante (`''` = nicht gesetzt oder keine absolute http(s)-URL mit Host), auf Seiten für Angemeldete `null`.
- **Drossel:** nur Fehltreffer (nie ausgestellte Tokens) zählen, Nextcloud 34 antwortet ab dem 11. Fehlversuch in 30 min mit 429.
- Der Client speichert `{token, name, link}` unter `localStorage['knorke.guest.' + boardId]`.

### 8.1 Link-Richtlinie von Nextcloud

Ein Bearbeitungslink ist ein öffentlicher Link seines Besitzers. Knorke beachtet deshalb `IManager::shareApiAllowLinks($besitzer)`: `core shareapi_allow_links` („Teilen über Link erlauben“) und die Gruppen-Ausnahme `shareapi_allow_links_exclude_groups`, ausgewertet für die Gruppen des **Besitzers** (die des Besuchers zählen nie; fehlt das Konto des Besitzers, sind Links verboten). Verboten heißt: 403 `links_disabled` für Link anlegen/erneuern, angemeldeten Beitritt (außer dem Besitzer), Gast-Beitritt, Gast-Snapshot und Gast-Sync; eine Mitgliedschaft über den Link gewährt nichts (404). Nichts wird zurückgezogen, `link_gen` bleibt: Wieder erlaubt, gelten Link, Mitglieder und alte Gast-Tokens sofort wieder. Der Fastpath kennt die Richtlinie aus `a:<board>[3]`; eine Änderung erreicht offene Boards innerhalb der TTL von `a:`/`g:` (120 s), dazu 3 s App-Config-Cache. Ab Stufe 2 beachtet Knorke auch ein erzwungenes Link-Passwort und ein erzwungenes bzw. voreingestelltes Ablaufdatum (Spec §4.11.2: beim Anlegen, Erneuern und wenn sich Passwort oder Ablauf ändern; nicht rückwirkend) und `sharing_disabled` (Teilen für den Besitzer gesperrt: kein Anlegen, Erneuern, Lockern; Verschärfen und Abschalten erlaubt). Geprüft von C45/C46, E16 und ab Stufe 2 C60, C65, C66, E30.

### 8.2 Neu-Beitritt eines offenen Gast-Tabs (Protokoll 2)

Ersetzt die M0-Zuordnung (SPEC-M1 §6.4, R2; mit den Präzisierungen aus §15):

- **Auslöser:** 401 `guest_token` (wie M0) und neu 403 `link_revoked` auf `/sync` (die Generation des Links hat sich geändert: erneuert, ab Stufe 2 auch Passwort gesetzt oder Ablauf vorverlegt). Höchstens **ein** Beitritt je Fehlerserie, mit dem gespeicherten Link-Token, dem Namen und dem alten Gast-Token.
- **Antwort des Beitritts:**

| Antwort | Client |
|---|---|
| 2xx | neues Token, weiter (z. B. nach einem verkürzten Ablauf); `proto` ≠ eigene Version (oder fehlend) zählt wie ein 409 |
| 403 `password_required`, `password_wrong` | endgültig `password_required` (Übergabe an die Namens- und Passwort-Phase der Gastseite, §2) |
| 403 `link_revoked`, 404 | endgültig `revoked` |
| 403 `link_expired` | endgültig `link_expired` |
| 403 `links_disabled` | endgültig `links_disabled` |
| 403 oder 404 **ohne App-Body** (Proxy, WAF; `HttpError.fromApp === false`) | **(R22)** nicht endgültig: auf `/sync` der Fehlerweg wie bei 0/5xx (`failInflight`, `failures++`, ab dem zweiten in Folge `offline` mit Banner, Backoff 1/2/4/8/15 s × (1 + 0–20 %)); bei Snapshot und Beitritt Wiederholung mit wachsender Wartezeit, Status bleibt. Nie der feste 2–10-s-Weg von Proxy-429/503, damit eine dauerhaft geblockte Anfrage nicht über der Leerrate eines Edge-Szenarios (403-bf, 1 je 10 s) bleibt (SPEC-M1 §6.4) |
| App-429 `rate_limited` | endgültig `revoked` mit dem Drossel-Text |
| 429 `slow_down` | warten `max(retryMs, 2000)` × (1 + 0–20 % Zufall), bei Wiederholung verdoppeln bis 60 s, dann **derselbe eine Beitritt** noch einmal; **(R4)** ohne `/sync` dazwischen, nie endgültig. **(R13)** Mit `reason: "password"` (Passwort-Sperre) kein Wiederholen: sofort endgültig `password_required` |
| Proxy-429/503, Netzfehler, 411, 5xx | kein Endzustand: später ein neuer Versuch |

- **(R4)** Kommen 403 `link_expired`, `password_required` oder `password_wrong` direkt auf `/sync` (der Server nennt sie nur beim Beitritt), bildet der Client sie ohne Beitritt auf dieselben Endstatus ab.

## 9. Resync

Auslöser: `since > DB-rev` (Client „aus der Zukunft“, z. B. nach DB-Restore), `since < min_rev`, und eine Antwort mit `rev < since` ohne `resync` (Abwehr). Der Client lädt den Snapshot, behält eigene ausstehende Ops, verwirft bestätigte mit `ackRev ≤ snapshot.rev`. **Bremse:** der dritte Resync binnen 10 s wartet 2 s, jeder weitere doppelt so lang (bis 30 s).

## 10. Client-Regeln

- **Takt** ab Anfragebeginn: aktiv 400 ± 50 ms, ruhig 1 s, Ansehen-Modus 2 s, versteckter Tab 5 s; Fehler-Backoff 1, 2, 4, 8, 15 s. Nur endgültige Ops (Loslassen, Anlegen, Löschen, Farbe, Reihenfolge, Undo/Redo, Editor schließen) verkürzen den Takt; Text-Zwischenstände laufen im normalen Takt mit.
- Genau eine Anfrage in Arbeit. Nach Netzfehler wird **derselbe Batch mit derselben `seq`** wiederholt, nie mit neuen Ops verschmolzen.
- Sichtbarer Zustand = bestätigter Server-Zustand ⊕ eigene ausstehende Ops; ein lokal gezogenes oder bearbeitetes Objekt ignoriert fremde Änderungen bis zum Loslassen.
- Verschieben schickt immer die ganze Lagegruppe, berechnet aus der Ausgangslage (`origin`) plus Versatz, nie aus dem gerade angezeigten Modell.
- Getippter Text geht nie still verloren: bei `bad`/`gone`/`locked`/`itemlocked`/`denied`/`limit` auf einer Text-Op bleibt der Editor mit dem Text offen bzw. öffnet sich wieder (Textrettung).
- **409 und Neuladen (Protokoll 2):** Der Merker `knorke.reloaded` in `sessionStorage` speichert die Server-Version aus dem 409-Body; automatisch neu geladen wird nur, wenn er ungleich ist (E20). Weicht der Initial-State `protocol` vom Bündel ab (die Seite kam frisch, das Bündel aus einem alten Cache), ruft `main.js` einmal `hardReload` mit demselben Merker. **(R4) Merker je Version:** Die M0-Regel „eine Online-Phase löscht `knorke.reloaded`“ entfällt. Derselbe Sprung friert ein, egal ob dazwischen eine Online-Phase lag; ein neuer Sprung (andere Server-Version) lädt wieder einmal. Ein alter M0-Merker `'1'` blockiert keinen Sprung auf 2.
- **Epoche:** jede Anfrage trägt `ep` aus dem letzten Snapshot bzw. Beitritt (auch die Keepalive-Sendung); `resync: true` holt einen Snapshot mit der neuen Epoche. **(R4)** Ohne gültige Epoche schickt der Client `ep: "0"`, nie eine Anfrage ohne `ep` (§5.1).
- **(R4) Rolle und `vt`:** `role` nur mit einem der Werte `owner|moderate|edit|vote|view` (bis Stufe 2 die Zugangsstufe aus dem Snapshot, `onRole` ist ein No-op), `vt` nur als Ganzzahl ≥ 0; sonst fehlt das Feld (§5.1).
- **Uhr:** jede 2xx-Antwort mit `now` geht an `board/clock.js` (`offset` aus der Probe mit der kleinsten Laufzeit); Restzeiten von Timer und Abstimmung rechnen nur damit.
- Status: `online`, `offline` (ab 2 Fehlern), `resyncing`, `gone` (404/403), `revoked` (`link_revoked`; ein Gast-Tab erst nach seinem einen Neu-Beitritt, §8.2), `links_disabled` (403 `links_disabled`, auch beim automatischen Gast-Neubeitritt; endgültig), `link_expired` und `password_required` (Antwort auf den Neu-Beitritt, §8.2; **(R4)** auch direkt auf `/sync`; endgültig), `logged_out` (401 Nextcloud; **(R37)** auf `/sync` erst das zweite in Folge, §2), `reload` (409; endgültig und eingefroren wie die anderen, Runde 2 U15, geprüft von E17), `rate_limited` (App-429 auf `/sync`, endgültig, nie automatisch wiederholt; Banner `[data-knorke-banner=rate_limited]`, Spec R3). Ein App-429 auf `/sync` setzt den Status `rate_limited`: endgültig, die Schleife stoppt, die Szene geht in den Ansehen-Modus, ein offener Editor behält seinen Text mit Hinweis (Textrettung), der Banner bietet „Neu laden“ an. Ein Gast-Neubeitritt, den ein App-429 beantwortet, bleibt `revoked` (§6.4 der Spec), zeigt aber den Drossel-Text. Nach **jedem** endgültigen Status schickt `flushKeepalive` (pagehide/Abbau) nichts mehr, damit der gedrosselte Batch nicht doch noch einmal hinausgeht. Abgesichert durch [C]s Unit-Tests und den E2E-Fall E09b (`dev/e2e/scenarios/throttle.mjs`, beantwortet den ersten `/sync` mit Ops per `ctx.route` mit 429 `{error:'rate_limited'}`).
- **Lease-Nachlauf (Pflicht, folgt aus „Präsenz vor Ops“):** Nach dem Schließen des Editors nennt `me.e` das Objekt **weiter**, bis dessen letzte Text-Op bestätigt oder verworfen ist; erst danach `e = null`. Schickte der Client `e = null` im selben Takt wie seinen letzten Text, ginge die Lease zuerst an einen Wartenden, und der eigene letzte Text käme `locked` zurück (gefunden in E04b). Umgesetzt in `BoardSession`: `getPresence()` sendet `e = editingId ?? leaseTail`; `leaseTail` wird beim Schließen gesetzt, wenn für das Objekt noch etwas aussteht (eine unbestätigte Op oder ein Text, der hinter einer Übernahme noch einmal hinaus soll), und in `onSettled` gelöscht, sobald nichts mehr aussteht und keine Übernahme dieses Objekts offen ist. Hatte der Client die Lease beim Schließen schon verloren, entfällt der Nachlauf (er würde nur die Lease eines anderen anfechten).
- **Übernehmen:** `tk: 1` genau einmal nach „Take over“, mit `e`, auch wenn der Editor bis zur nächsten Anfrage schon wieder zu ist (Ablauf in §7.1).
- **`debug.setCursor(n)`** (nur mit `debug`, E08a): Eine Antwort, deren Anfrage **vor** dem Aufruf begann, setzt den Cursor nicht mehr (`SyncClient.cursorEpoch`). Ihre Acks und ihre Präsenz wirken weiter; `rev`, `items`, `removed`, `more` und ein `resync` dieser Antwort werden verworfen. Erst die nächste Anfrage mit dem gesetzten Cursor zählt (bei `n > rev` → `resync`, genau einmal). Ohne diese Regel überschrieb eine Antwort, die schon unterwegs war, den gesetzten Cursor, und E08a war zufällig grün oder rot.
- **Wartepunkt für Tests (`__knorke.waitIdle`):** keine ausstehenden Ops, nichts in Arbeit, danach ein vollständiger Takt. Ein Takt wird nur erzwungen, wenn keine Anfrage offen ist (sonst kettet sich jede Anfrage an die vorige, und es wird nie ruhig). Konvergenz zwischen Seiten braucht zwei Runden (`settle`): erst wartet jede Seite, dann noch einmal jede.

**Gefunden und behoben am 11.10. (Phase 2, Runde „bekannte Fehler“).** Das Flake-Gate `KD_NS=d dev/e2e/run.sh --only E03,E04,E04b --repeat 8` (NC 34) zeigte mit dem Bündel vom 11.10. 00:43 E04b 2/8 grün; die `/sync`-Spur im Bericht belegte zwei Client-Ursachen:

1. **`tk` ging beim schnellen Schließen verloren** (4 von 6 roten Läufen). Das Schließen des Editors setzte die offene Übernahme zurück, und `tk` ging nur bei offenem Editor hinaus. Wer nach „Take over“ schneller tippte und Esc drückte, als der nächste Takt kam (E04b: ≈ 250 ms), schickte seinen letzten Text mit `e = id` ohne `tk` → `locked`; der alte Halter blieb Halter.
2. **Ein eingereihter Text-Patch des Verdrängten ging nach dem Verlust noch hinaus** (2 von 6). Spur: bob `tk` + Text `ok`, letzter Text `ok`, alices Editor `locked`, bob gibt frei (`e = null`), dann alices vor dem Sperren eingereihter Text → `ok` (kein fremder Halter mehr) und überschreibt bobs Text überall.

Behoben in `BoardSession` (`takeoverId` über das Schließen hinaus, `loseLease` mit `Replica.dropQueuedPaths`) und `SceneManager` (`#openEditor` mit `takeover` bei schon offenem Editor). Mit dem Bündel vom 11.10. 08:09: E04b 8/8 grün (E03 8/8, E04 8/8, 24 ok / 0 fehlgeschlagen).

## 11. Bewusst hingenommene LWW-Fälle

Diese Fälle sind keine Fehler, sondern Folge von „serverautoritativ, letzter gewinnt“; sie sind bewusst so entschieden:

1. **Wiederholter Batch nach Netzfehler.** War der erste Versuch schon committet, setzt die Wiederholung dieselben Werte noch einmal und kann dabei einen fremden Schreibvorgang aus demselben Zeitfenster überschreiben. Das ist eine gültige LWW-Reihenfolge.
2. **Gleichzeitiges Ziehen desselben Objekts.** Beide Loslass-Patches tragen die ganze Lagegruppe; es gewinnt, wer zuletzt beim Server ankommt. Das Objekt landet nie bei einem Tripel, das keiner geschrieben hat.
3. **Verschieben in einen Frame, den gerade jemand löscht.** Das Objekt kommt an die Wurzel und behält seine absolute Lage (`ok`, kein Datenverlust).
4. **Frame löschen gibt die Kinder frei** (offene Frage F2), mitlöschen gibt es in M0 nicht.
5. **Ändern gegen Löschen.** Kommt das Löschen zuerst, wird die Änderung `gone`; der Client rettet getippten Text in einen Dialog zum Kopieren.
6. **Undo ist unbedingt.** Rückgängig setzt die alten Werte, auch wenn jemand anderes inzwischen dieselben Pfade geändert hat.
7. **Offline-Änderungen** gewinnen beim Wiederverbinden gegen ältere fremde Änderungen derselben Pfade, weil sie später beim Server ankommen.
8. **Text-Lease „Übernehmen“** (F6): Jeder Bearbeiter darf die Lease übernehmen; der Verdrängte behält seinen Text im Editor zum Kopieren, gespeichert wird er nicht.
9. **`{"0": "a"}` von einem fremden Client** wird zur Liste `["a"]` (PHP-Grenze, dokumentiert; ein korrekter Client schickt solche Schlüssel nie).
10. **Präsenz ist flüchtig.** Ein verlorenes Präsenz-Update (`cas`-Kollision) holt der nächste Takt nach; Präsenz kann bis zu 10 s veraltet sein.
11. **Gleichzeitiges Gruppieren überlappender Auswahlen.** **(R36)** Die Gruppe ist LWW je Objekt: Wer zuletzt beim Server ankommt, setzt die Gruppe der Objekte, die in beiden Auswahlen liegen. Eine vereinigte Gruppe entsteht nicht; es können zwei Gruppen nebeneinander bleiben. Behält die frühere Gruppe dabei nur ein lebendes Mitglied, löst der Server sie auf (§6.2 „Gruppen“).
12. **Regeln über mehrere Objekte prüft nur der Client.** **(R36)** „Gleicher Elternteil“ und „mindestens zwei Mitglieder“ sichert der Client beim Gruppieren; der Server prüft je Objekt. Eine Gruppe, deren Mitglieder verschiedene Elternteile haben, oder eine Gruppen-ID an nur einem Objekt kann so entstehen: durch einen Tab mit einem Bündel von vor Job 026 (er zieht ein einzelnes Mitglied in einen Frame), durch ein gleichzeitiges Verschieben eines Mitglieds in einen Frame oder durch einen manipulierten Client. Das wirkt nur auf die Darstellung und gibt keine Rechte. Eine Gruppen-ID, die der Client an weniger als zwei lebenden Objekten kennt, wertet er als keine Gruppe.

## 12. Runbook „nach DB-Restore“

**Board-Epoche (Protokoll 2, SPEC-M1 §5.4).** Die Instanz hat eine Epoche `knorke/epoch` (App-Config, nicht lazy); sie steckt im Redis-Präfix (`<prefix>/knorke/<epoch>/<key>`) und geht in jedem `/sync` als `ep` mit. Nach einem Restore kann Redis einen höheren Board-rev `r:<board>` kennen als die DB; ohne Gegenmittel schöbe ein offener Tab seinen Cursor über revs, die es in der DB noch nicht gibt, und verpasste die nächsten Schreibvorgänge still. Eine neue Epoche macht alle alten Schlüssel auf einen Schlag unsichtbar; jeder offene Tab schickt beim nächsten Takt die alte Epoche, bekommt `resync: true` und lädt **genau einmal** den Snapshot mit der neuen. Bei jedem DB-Restore, in dieser Reihenfolge (das Zurückspielen setzt auch `oc_appconfig` zurück, deshalb danach drehen):

1. `occ maintenance:mode --on`
2. Datenbank zurückspielen.
3. `occ config:app:set knorke epoch --value=<8 Zeichen [a-z0-9]>` (R19: ein Kernbefehl; im Wartungsmodus lädt Nextcloud keine App-Befehle, `occ knorke:epoch:rotate` geht dort nicht und bleibt für das Drehen ohne Wartung), danach ≥ 4 s warten
4. `occ maintenance:mode --off`

Kein Neuladen nötig: Die Tabs resyncen selbst; ein anderer PHP-Prozess sieht die neue Epoche wegen des lokalen App-Config-Caches bis zu 3 s später. Was nach dem Sicherungszeitpunkt bestätigt war, ist mit dem Restore sichtbar weg; noch nicht bestätigte eigene Ops reicht der Client nach. Alte Schlüssel verfallen über ihre TTL (`r:` 30 s, `p:` 60 s, `a:`/`g:` 120 s, gelöschtes Board 300 s); sie per `redis-cli --scan --pattern '*/knorke/*'` zu löschen ist nur noch ein **optionaler** Aufräumschritt. Die App aus- und einschalten hilft nicht (gleiches Cache-Präfix). Genaue Befehle, auch für den Dev-Stack: `docs/ENTWICKLUNG.md` §8. Geprüft von C51; den ganzen Ablauf probt `dev/selftest/restore.sh` im Dev-Stack (SPEC-M1 §10 P5).

## 13. Moderation (Stufe 3)

Abstimmung, Timer und „Alle zu mir“ (SPEC-M1 §3.11, §4.5, §4.6, §4.12, §4.13.5, §4.13.8, Revision 16). Alles reist im bestehenden `/sync` und über die Routen 22–26; es gibt keine zusätzliche Anfrage je Takt. Moderieren dürfen der Besitzer und Freigaben mit der Rolle `moderate` („Darf moderieren“, `me.mod`); Link-Konten, Gäste und Freigaben mit `edit` (auch über Gruppen oder Teams) nicht.

### 13.1 Meta-Kanal: `board.meta`

`board.meta` (Snapshot, `board`-Block des Sync, Antworten der Routen 7 und 22–26) ist betrachterunabhängig und trägt höchstens drei Schlüssel; ein fehlender Schlüssel heißt „nichts davon“:

```json
{"timer":  {"state": "running", "dur": 300000, "end": 1760100300000, "left": null, "by": "Alice Adler", "seq": 3},
 "vote":   {"sid": 12, "state": "open", "cfg": {"per": 5, "perItem": 1, "scope": null, "types": ["sticky"]},
            "startedAt": 1760100000000, "endsAt": 1760100600000, "by": "Alice Adler", "show": false},
 "summon": {"pid": "3f9a1c0b7d2e4a51", "client": "cK3j9aZp2Q", "name": "Alice Adler", "seq": 4, "at": 1760100000000}}
```

- **Timer:** `running` mit `end` (Serverzeit) oder `paused` mit `left`; ein laufender Timer mit `end ≤ now` ist abgelaufen und bleibt `running`, bis jemand `stop` oder `start` drückt (alle zeigen „Time's up“). Restzeiten rechnen die Clients nur mit ihrer Serveruhr (`board/clock.js`), deshalb zeigen alle dieselbe Zeit (±1 s, E32).
- **Abstimmung:** während der Sitzung **ohne** `results`, `total`, `voters`; nach dem Schließen dazu `results` (`[[id, n], …]` absteigend nach n, dann id, höchstens 500), `total` (Zahl der Objekte mit Stimmen), `voters`, `closedAt`; `show` schaltet die Zähler auf dem Board. Nach „Close results“ (`clear`) fehlt `vote`, die Sitzungszeile bleibt in der DB.
- **„Alle zu mir“:** ein Aufruf ist das Paar (`seq`, `at`); nach `DELETE` beginnt `seq` wieder bei 1 (C74). Ein Ausstieg („nicht mehr folgen“) und das „wieder dabei“ über den Chip gelten nur für genau dieses Paar, ein neues Paar holt alle wieder ab (E33). Gefolgt wird der Präsenz-Eintrag `<summon.pid>:<summon.client>`.
- Namen sind Anzeigenamen zum Schreibzeitpunkt, nie uids; höchstens 256 KiB je Board (`meta_too_large`).

Jeder Meta-Schreibvorgang setzt `meta_rev = rev + 1, rev = rev + 1` in einer Anweisung und hebt nach dem COMMIT `r:<board>` an (`MetaService`), ohne `changes`-Zeile. Ein Client mit `since < meta_rev` bekommt beim nächsten Takt den `board`-Block (langsamer Pfad); der Fastpath bleibt ohne App-SQL. `MetaService::write` läuft nie in einer offenen Transaktion: Wer schon eine hat (Schließen einer Sitzung im Stimmweg), schreibt über einen internen Weg und hebt `r:` erst nach seinem COMMIT an.

### 13.2 Routen 22–26

Jede Antwort ist `{"board": {"title", "meta", "metaRev"}, "now"}` (der Client führt sie wie den `board`-Block zusammen). Fremde → 404, Rolle ohne Moderation → 403 `forbidden`, mehr als 120 Aufrufe je 10 min je Moderator → 429 `slow_down`.

| Route | Body | Codes |
|---|---|---|
| 22 `POST …/vote` | `per` 1–99, `perItem` 1–`per`, `scope` `null` oder lebender Frame dieses Boards (nur seine direkten Kinder), `types` ⊆ {`sticky`, `shape`, `text`}, `minutes` `null` oder 1–1440 | 400 `vote_config`; offene Sitzung → 409 `vote_open` (eine abgelaufene wird dabei geschlossen, die Ergebnisse stehen danach in `meta`) |
| 23 `PATCH …/vote` | `action`: `end`, `extend` (mit `minutes` 1–1440), `show`, `hide`, `clear` | unbekannte oder fehlende `action` → 400 `bad_request`; `extend` ohne gültige `minutes` → 400 `vote_config`; `end`/`extend` ohne offene Sitzung, `clear` auf offener, `show`/`hide`/`clear` ohne `meta.vote` → 409 `vote_closed`; `extend` auf abgelaufener offener Sitzung schließt sie (committet) und antwortet 409 `vote_closed` |
| 24 `PUT …/timer` | `action`: `start` (`ms` 1000–5 999 000), `pause`, `resume`, `add` (`ms` 1000–3 600 000), `stop` | falscher Wert → 400 `bad_request`; falsche Vorbedingung (auch `pause` auf einen abgelaufenen Timer) → 409 `timer_state`; `add` auf einen abgelaufenen → `end = now + ms`; das Ergebnis höchstens 99:59 Restzeit |
| 25 `POST …/summon` | `client` (Pflicht, Regex wie `sync.client`) | ohne → 400 `bad_request`; `seq` + 1 je Aufruf |
| 26 `DELETE …/summon` | – | jeder Moderator darf beenden |

Aktionen ohne Wirkung (`show` bei `show = true`, `hide` bei `false`, `DELETE summon` ohne `summon`) schreiben nicht und antworten 200 mit dem gespeicherten Stand (gleicher `metaRev`). „Idempotent“ heißt: `end`, `show`, `hide`, `clear` und `DELETE summon` ändern bei Wiederholung nichts mehr; `extend` und Timer-`add` wirken je Aufruf. Der Client wiederholt diese Routen nie automatisch, ausgenommen das automatische `end` bei `endsAt` (eine 409 schluckt er).

### 13.3 Stimmweg

**Op:** `{"o": "vote", "s": <sid>, "id": "<Objekt>", "n": 0–99}` setzt **meine** Stimmenzahl auf dem Objekt (Mengen-Semantik, idempotent, nie ein Delta; `n = 0` nimmt zurück). Vor dem Lock geprüft: `s` ≥ 1, `id` ULID, `n` ganzzahlig 0–99 (sonst `bad`), Rolle mit Stimmrecht (`view` → `denied`). Im Server laufen erst alle Objekt-Ops der Anfrage, danach alle Stimm-Ops unter dem Board-Lock (eigene Transaktion); `res` bleibt positionsgleich mit `ops`, `acks.rev` stammt nur aus dem Objekt-Teil. **Stimm-Ops erhöhen den Board-rev nicht:** Alle anderen bleiben auf dem Fastpath (C70).

| Code | Stimm-Op |
|---|---|
| `ok` | gesetzt (auch gleicher Wert; `n = 0` auf ein gelöschtes Objekt); **(R17)** Senken und Zurücknehmen (`n` ≤ eigene Zeile auf dem lebenden Objekt) immer, unabhängig von Typ, Bereich und Budget |
| `gone` | Objekt fehlt oder ist gelöscht (`n ≥ 1`) |
| `bad` | Formfehler; bei einer Erhöhung (`n` > eigene Zeile): Typ nicht in `cfg.types` oder Objekt nicht direktes Kind von `cfg.scope` |
| `limit` | nur bei einer Erhöhung: `n > perItem` oder Summe über `per` (ein durch Undo überzogenes `per` wird hingenommen, Senken scheitert nie daran) |
| `denied` | Rolle ohne Stimmrecht |
| `closed` | Sitzung `s` nicht offen (beendet, abgelaufen, nie da): Op verwerfen, Hinweis „Voting has ended.“ |

`mine`, `left` und die Budgetprüfung zählen nur Stimmen auf lebenden Objekten: Wird ein Objekt mit eigener Stimme gelöscht, steigt `left` um diese Zahl; nach einem Undo zählen die Zeilen wieder (`left` = max(0, `per` − Σ `mine`), nie negativ). **(R17)** Einen Bereichsfilter beim Zählen gibt es nicht: Schiebt ein Bearbeiter ein Objekt mit Stimmen während der Sitzung aus dem Bereichs-Frame, zählen dessen Zeilen weiter in `mine`, `left` und `results`, und `n = 0` darauf ist `ok` (`left` steigt um die Zahl; C70). Die Oberfläche von M1 bietet dafür keinen eigenen Knopf.

**Antwortblock `votes`** (immer mit `sid`): (a) Erreichten Stimm-Ops der Anfrage den Stimmweg und ist ihre Sitzung danach offen, trägt er `sid`, `mine` (Objekt id → n ≥ 1, leer **`{}`**, nie `[]`) und `left`; ist sie nicht offen (alle `closed`), fehlen `mine` und `left`. (b) Für Moderatoren mit `vt` liefert Schritt 9 `sid`, `voters` (Zahl der verschiedenen Wählenden) und `vt` (= `seq` der Sitzung). Kommt beides, nennen beide dieselbe sid. Snapshot und Beitritt tragen bei offener Sitzung und Stimmrecht `{sid, mine, left}`. Ein Block mit fremder sid wird verworfen; eine Verteilung je Objekt (`tally`) gibt es in M1 nicht, Live-Summen für Moderatoren sind eine M2-Option.

**Schritt 9 (`vt`, R16):** Nur für Moderatoren mit `vt`: Steht `vt:<board>` = `"<sid>:<seq>"` in Redis und ist `seq` = gesendetes `vt`, kommt nichts (keine Abfrage, der Fastpath bleibt). Sonst liest der Server die offene Sitzung: keine → nichts; abgelaufen → schließen, in dieser Antwort keine `voters` (das geschlossene `meta.vote` kommt im nächsten Takt); sonst `vt:` neu säen und `{sid, voters, vt}`. Der Client schickt `vt` deshalb nur bei offener Sitzung (eine Sitzung ohne Stimmen meldet der Server nie, weil `"<sid>:0"` zu `vt = 0` passt) und setzt es bei einem sid-Wechsel auf 0. `vt:` ist ein cas-Maximum: zwei Stimm-Batches, deren Commits sich überholen, lassen es auf dem höheren Stand (C71).

**Schließen** (vier Wege, alle über dasselbe idempotente `VoteService::close` unter dem Board-Lock): (a) eine Stimm-Op sieht `ends_at ≤ now`, (b) der Poll eines Moderators mit `vt` (nur, wenn `vt:` fehlt oder abweicht), (c) der Moderations-Client ruft bei `endsAt` selbst `end`, (d) `VoteCloseJob` alle 300 s. Beim Schließen entstehen `results` (ohne gelöschte Objekte) und `voters`, die **Stimmzeilen werden gelöscht** und `meta.vote` geht auf `closed` (eine Transaktion); danach existieren nur noch Summen. C72 prüft die Wege (a), (b) und (d) über die Brücke `vote-expire` bzw. `Stack.voteExpire` (`ends_at = jetzt − 1 ms`, `meta` unverändert, `vt:` gelöscht).

**Anonymität:** Wählerschlüssel ist die pid (HMAC je Board und Principal), nie uid oder gid; Stimmzeilen leben nur, solange die Sitzung offen ist. Einzelstimmen bekommt nur der Wähler selbst (`mine`), Moderatoren während der Sitzung nur `voters`; keine Antwort enthält eine fremde pid neben einer Stimme (C71). Abstimmende senden keine Präsenz (§7). Die verbleibenden Grenzen (kleine Gruppen, Gast-Lücke, unsichtbare Tablets) stehen in `docs/ADMIN.md` unter „Known limits“. `UserDeletedEvent` löscht die Stimmen der pid des gelöschten Kontos in offenen Sitzungen und hebt `seq` und `vt:` an.

### 13.4 Folgen

Rein clientseitig über `v` in der Präsenz: Der Folgende passt seine Kamera auf den Viewport des Ziels ein (Ziel `<pid>:<client>`; ohne Client der Eintrag dieser pid, dessen `v` sich zuletzt änderte). Eigenes Schwenken, Zoomen oder Esc beendet das Folgen, im Modus vote auch der Kleinziel-Zoom, nicht aber ein Tipp zum Abstimmen. Während eine Sitzung offen ist, hält der Client Sprünge zurück, solange ein Finger auf der Leinwand liegt und bis 1,5 s danach. Tablets folgen im 2-s-Takt in Sprüngen; mit `prefers-reduced-motion` springen alle (E33).

## 14. Prod-Reife (Stufe 4): Schreibbudget, Drosseln, Bereinigung

Die Verträge stehen in SPEC-M1 §4.13.6, §4.13.7, §4.11.4 und §4.1 (Revision 19); hier die Kurzfassung für Client- und Harness-Seite.

- **Schreibbudget je (Board, pid):** zwei Festfenster-Zähler von 10 s in Redis (`w:<b>:<pid>:<win>` für Anfragen **mit** Ops, `wo:…` für Ops einschließlich serverseitig abgeleiteter Zeilen, z. B. der Kinder eines `keep`-patch). Über 60 Anfragen bzw. 2000 Ops im Fenster (App-Config `budget_syncs`/`budget_ops`) antwortet `/sync` mit `busy` für **jede** Op (nie gemischt), `acks.rev = null`, `acks.retryMs = (floor(now/10000) + 1)·10000 − now + 100`; Lesen, Präsenz und `now` laufen normal weiter. Leere Polls kosten nichts. Ein `keep`-patch auf viele Kinder wird nie nachträglich abgewiesen, die **nächste** Anfrage desselben Principals bekommt dann `busy`. Der Client hält den Batch in-flight und schickt ihn nach `retryMs` mit derselben `seq` (kein `offline`). Ohne Redis gibt es kein Budget. Geprüft von C76 und E34.
- **(R22) Tagesquote in Bytes:** Jede `/sync`-Anfrage mit Ops (auch eine, die `busy` bekommt) zählt die Länge ihres Rohbodys in zwei Festfenster-Zähler je UTC-Tag in Redis (TTL 25 h): `wd:<b>:<tag>` je Board für alle Principals, `wu:<uh>:<tag>` je Konto über alle Boards (Gäste nur `wd:`). Über `budget_bytes_board_day` (256 MiB) bzw. `budget_bytes_user_day` (512 MiB) antwortet `/sync` wie beim Schreibbudget mit `busy` für **jede** Op, `acks.rev = null` und `acks.retryMs = min((tag + 1) · 86400000 − now, 60000) + 100`; sind Schreibbudget und Quote zugleich überschritten, gilt der größere Wert. `0` schaltet die Quote aus (die Zähler laufen weiter); ohne Redis gibt es keine Quote. Geprüft von C81 (b, c).
- **Snapshot-Drossel:** Route 12 30 Snapshots je Konto und 60 s, Route 15 30 je gid + IP und 300 je (Board, IP); der Gast-Beitritt (Route 14) zählt in dieser Reihenfolge: Gast-Budget neuer Identitäten (M0, `rate_limited`), dann `knorke-snap-<gid>` (nur mit einer gid aus einem alten, auch abgelaufenen Token), zuletzt `knorke-snapip-<board>`; ein abgelehnter Beitritt erreicht die späteren nicht. Ausgelöst → 429 `slow_down` mit `retryMs` und `Retry-After`. Geprüft von C77 (und C44 mit 61 s Pause).
- **Grabstein-Bereinigung und `changes`-Deckel:** `CleanupJob` (täglich, Fortsetzung über `cleanup_cursor`, 60 s je Lauf) bzw. `occ knorke:compact [--board=N] [--now=ms]` löscht Grabsteine älter als `tombstone_days` (30) und über `tombstone_cap` (10000) in Blöcken je ≤ 5000 + 199 Zeilen, jeder Block hebt `min_rev` auf sein X; ein Client mit `since < X` bekommt `resync`. Folgen für Ops auf bereinigte IDs: put + revive legt neu an, patch → `gone`, Elternteil oder Verbinder-Ende → `bad`. Der `changes`-Deckel lässt die `changes_cap` (100000) neuesten Zeilen stehen (alle Zeilen des Grenz-rev). `compact` schreibt je Board eine JSON-Zeile `{board, blocks, tombstones, changes, minRevBefore, minRev}` (nur Ganzzahlen, in dieser Reihenfolge): `blocks` zählt nur die Grabstein-Blöcke (Transaktionen unter dem Board-Lock, die Grabsteine gelöscht und `min_rev` gehoben haben; Blöcke des `changes`-Deckels zählen nicht), `changes` die vom Deckel gelöschten Zeilen plus den 30-Tage-Schnitt des Boards. Exit 0 bearbeitet (auch wenn nichts fällig war); Exit 1 unbekanntes Board (stderr `Board N not found.`); Exit 2 ungültiger Wert für `--board` oder `--now` (Meldung auf stderr). Ohne `--board` läuft `compact` wie der Job: zuerst instanzweit `changes` und Links, die älter als 30 Tage sind, dann die Boards nach `cleanup_cursor` (ID des zuletzt vollständig bearbeiteten Boards; erst die IDs darüber, dann im Ring von vorn) bis zum 60-s-Budget; ein unterbrochenes Board setzt der nächste Lauf fort. Mit `--board=N` nur dieses Board, alle Blöcke ohne Zeitbudget, `cleanup_cursor` und Links bleiben unberührt. Der langsame Pfad liest `min_rev` nach der Seite erneut (`resync` statt einer stillen Lücke). Geprüft von C78, C79, E35 und dem Konvergenz-Fehler `purge`.
- **(R22) Byte-Deckel des Änderungsprotokolls und Waisen:** `CleanupJob` und `occ knorke:compact` (mit und ohne `--board`) lassen je Board höchstens `changes_bytes_cap` (64 MiB) Summe `octet_length(patch)` in `changes` stehen, die Zeilen des neuesten rev immer; gelöscht werden die Zeilen unterhalb der größeren der beiden Grenzen (Zeilen-Deckel, Byte-Deckel), die Ausgabezeile von `compact` bleibt. `occ knorke:orphans [--dry-run]` gleicht Freigaben, Link-Mitgliedschaften, offene Stimmen und Boards von Konten und Gruppen ab, die Nextcloud nicht mehr kennt; Ausgabe genau fünf Zeilen `user-shares: <n>`, `group-shares: <n>`, `link-members: <n>`, `open-votes: <n>`, `owned-boards: <n>` (`--dry-run` zusätzlich `Dry run: nothing was changed.`), Exit 0 abgeglichen, Exit 1 eine ID ließ sich nicht abgleichen. Der `CleanupJob` führt denselben Abgleich mit Zwei-Lauf-Regel aus (eine ID, die 20 h nach dem ersten Fund noch fehlt). Geprüft von C81 (d) und der Probe OPS-1.
