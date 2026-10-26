<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Knorke for administrators

Requirements, installation, settings, `occ` commands and every known limit.
What users can do on a board is in [FEATURES.md](FEATURES.md); the
development stack, the tests and the production runbook are described in
German in [ENTWICKLUNG.md](ENTWICKLUNG.md).

- [Requirements](#requirements)
- [Installation](#installation)
- [Settings](#settings)
- [Load limits, quotas and clean-up](#load-limits-quotas-and-clean-up)
- [How it works](#how-it-works)
- [Known limits](#known-limits)

## Requirements

Nextcloud 34 or 35, PHP 8.2–8.5, PostgreSQL, MySQL/MariaDB or
SQLite (Oracle is not supported; `appinfo/info.xml` declares the three, so
Nextcloud refuses to enable the app on Oracle), and a distributed memory cache
(Redis) for the fast path, presence and the text lease (without it everything
works through the database, without presence). Read replicas (`dbreplica`)
are supported: every Knorke read goes to the primary.

## Installation

Since version 0.3.0, Knorke is in the Nextcloud App Store: an administrator
installs it on the Apps page of Nextcloud (search for "Knorke").

To try it from the repository, **do not clone it into the web root.** A
checkout carries the whole development tree – sources, tests, the dev and test
harnesses and, after a build, `node_modules/` – and the web server hands out
static files below `apps/` and `custom_apps/` as they are, so all of it would
be public on your Nextcloud's own origin. Clone and build somewhere else, then
copy only the runtime folders into Nextcloud:

```
git clone https://github.com/hotochan123/nextcloud-knorke.git ~/knorke-src
cd ~/knorke-src
npm ci && npm run build
mkdir -p <nextcloud>/custom_apps/knorke
cp -r appinfo css img js l10n lib templates LICENSE README.md THIRD-PARTY.md CHANGELOG.md <nextcloud>/custom_apps/knorke/
occ app:enable knorke
```

The directory has to be named after the app ID, `knorke`. `dev/release.sh` writes
exactly these folders and files to `dev/release/out/knorke-<version>/`, together
with a `.tar.gz` (folder `knorke/`) and its SHA-256, and refuses when the
built bundle does not match the sources. The repository ships
an `.htaccess` as a safety net for a checkout inside the web root: on Apache
(with `mod_alias` and `AllowOverride` for the app folders) it answers 404 for
`dev/`, `build/`, `tests/`, `src/`, `node_modules/`, `docs/`, `tools/`,
`.git/`, local `_*.php` scripts and the package and build files. nginx ignores `.htaccess`; there, deploy the runtime folders as above.

When `<version>` in `appinfo/info.xml` goes up, Nextcloud serves the app only
after `occ upgrade` – and `occ upgrade` also updates every App Store app, so
check `occ update:check` first.

## Settings

**Link address for guests.** Links and QR codes use the host of the request, so
a board opened from an internal address produces links that guests outside the
network cannot open. Set the public address once:
`occ config:app:set knorke public_url --value=https://cloud.example.org` (an
origin: `http` or `https`, host, optional port, no path; an invalid value is
ignored). Other app settings (all optional, in bytes or counts, see
`docs/ENTWICKLUNG.md` §10): `budget_bytes_board_day`, `budget_bytes_user_day`,
`changes_bytes_cap` and `link_limit`.

**Privacy notice for guests.** Administrators set this notice under
"Administration settings", section "Knorke" (only administrators see this
section), and guests see it in the name dialog when they open a board link.
The section has a default text and texts per language from Nextcloud's
language list, at most 20 languages and at most 2000 characters per text. The
texts are plain text: line breaks are kept, HTML is not interpreted. Each
entry can also have a privacy policy URL (http or https). It overrides the
privacy policy URL from Theming (`privacyUrl`); on the guest page it also
replaces it in the guest menu and on the pages for invalid, revoked or expired
links. Text and URL are resolved separately: the exact language (for example
`de_DE`), then its base language (`de`), then the default, and last Knorke's
built-in text (English and German; people who can only vote get their own
wording) or the URL from Theming. Accounts get the language of their account,
guests the language Nextcloud detects from their browser. In the name dialog
the notice appears above the name field, without a checkbox, and nothing is
worded as consent; a returning guest sees it once per browser tab as a card.
On boards with an active edit or voting link, signed-in accounts see the badge
"Open by link" (the owner too); a press on it opens an info card with what
guests can see. The card also appears by itself once per board, account and
device, and again each time a link is switched on again or renewed, also when
a second link is switched on alongside the first, but never for the owner. The
built-in text is a general notice, not legal advice.
Without a privacy policy URL, the dialog and the card show no link to a
privacy policy.

## Load limits, quotas and clean-up

- **Board epoch:** after a database restore, a new epoch (set in maintenance
  mode with `occ config:app:set knorke epoch`, or `occ knorke:epoch:rotate`
  outside it) makes every open tab load the restored state once by itself (see
  [Known limits](#known-limits)).
- **Write budget:** at most 60 requests with changes and 2000 changes per 10
  seconds per board and participant; above that the server answers "busy" and
  the browser sends the same changes again a moment later (nothing is lost,
  no "offline").
- **Snapshot throttle:** full board loads are limited per account, per guest
  and per board and network address; a client told to slow down waits and
  tries again.
- **Clean-up:** a daily background job (and `occ knorke:compact`) removes
  deleted items after 30 days or beyond 10 000 per board and keeps the change
  log of a board at 100 000 entries; open tabs that missed such a clean-up
  load the board again once. `occ knorke:compact` without options does one
  run of the job (old change rows and links of the whole instance first,
  then the boards for at most 60 seconds, continuing where the last run
  stopped); `--board=N` cleans only board N completely. It prints one JSON
  line per board: `{"board","blocks","tombstones","changes","minRevBefore","minRev"}`
  (whole numbers; `blocks` counts the tombstone blocks only, `changes` the
  change rows removed by the cap and the 30-day cut). Exit code 0 on
  success, 1 for an unknown board, 2 for a malformed `--board` or `--now`.
- **Daily byte quotas** per board and per account (`budget_bytes_board_day`,
  `budget_bytes_user_day`), a byte cap on the change log of a board
  (`changes_bytes_cap`) and tombstones without their content: a deleted item
  keeps its place and type but no longer its text. Defaults and details under
  [Known limits](#known-limits) and in `docs/ENTWICKLUNG.md` §10.
- **Limit on link changes:** creating, renewing, protecting, expiring or
  switching off links is limited per account (`link_limit`, default 20 per 10
  minutes); reading links is never limited.
- **`occ knorke:orphans [--dry-run]`** removes the shares, link memberships,
  open votes and boards of accounts and groups that Nextcloud no longer knows
  (see [Known limits](#known-limits)); the daily clean-up does the same with a
  two-run rule.
- **`public_url`:** the app setting that makes link addresses and QR codes
  use the public address of the instance (`occ config:app:set knorke
  public_url --value=https://<public name>`). Without it they use the host of
  the request.

## How it works

Every client sends one request per tick (`POST …/sync`, about 2.5 per second
while active) with its own changes, its cursor and presence, and gets back the
changes of everybody else, compacted to the latest state per object. The server
orders all writes of a board through a row lock and resolves conflicts per
property, last writer wins; position and parent of an object form one unit.
Nextcloud's distributed cache (Redis) answers idle polls without touching the
app's database tables. Details (German):
[`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md),
[`docs/PROTOKOLL.md`](docs/PROTOKOLL.md); the binding specification is
[`docs/SPEC-M1.md`](docs/SPEC-M1.md), with [`docs/SPEC-M0.md`](docs/SPEC-M0.md)
for everything M1 does not change. Since M1 stage 0 the wire protocol is version
2: every sync carries the board epoch, every answer the server time, and board
titles and metadata travel in the same request.

## Known limits

### On a board

- **Votes are anonymous, within limits.** Votes are stored only while a
  session is open, under an opaque participant id per board (never a user
  id), and deleted when the session ends; afterwards only the totals exist.
  During a session facilitators see only how many people voted, and voting
  devices send no cursor, selection or viewport. What remains: in a very
  small group, a facilitator who watches someone tap while "{n} voted" goes
  up, or who reads the ranking, can draw conclusions; an administrator with
  the database and the instance secret can link the ids to people while a
  session is open; editors who stay in "Edit" and point at items show their
  interest (not their vote). Live totals for facilitators may come in a later
  version as an option announced per session.
- **Guest votes are not one per person.** A guest who clears the browser (or
  uses a private window) gets a new identity and a fresh set of votes, and a
  script can create up to 300 guest identities per address and link every 10
  minutes, each with the full number of votes. Accounts have exactly one set
  of votes per board (all tabs and devices). "Only accounts may vote" is
  planned for a later version.
- **Votes from two tabs.** One person voting in two tabs or on two devices at the same time can lose a vote when more than one vote per item is allowed (the last change wins). With one vote per item, the default, this does not happen.
- **Revoked rights do not remove votes.** Votes cast before a share or link is removed keep counting in the running vote. A "Bring everyone here" started by a facilitator who then loses the right stays until the owner or another facilitator ends it; followers drop out once the presenter's tab has been gone for 10 seconds.
- **Tablets and voters are invisible.** Tablets, phones and everyone voting
  send no presence, so they do not appear in the presence bar ("People on
  tablets or voting don't appear here.") and "{n} voted" has no total to
  compare with. Tablets follow a presenter in jumps about every 2 seconds
  (they poll every 2 s to spare the edge rate limit).
- **Moderation limits:** 120 moderation actions per 10 minutes per
  facilitator; a vote session allows 1–99 votes per person and at most 1440
  minutes, the ranking keeps the top 500 items; the timer runs at most 99:59.
- **iPad and Safari have not been measured on real hardware.** Rendering was
  measured on a high-end Android tablet (Chrome, measurement R-A: zooming over
  the whole board at 59.7 fps with 0 % missed frames, first render within
  361 ms); the touch path is built and tested in Chromium and headless WebKit
  only. A measurement on a real iPad is planned for a later version. Until
  then, large boards may draw more slowly on iPads, and keeping the screen on
  during a vote or timer has not been checked there.
- Right-click menu: Firefox always shows its own menu on Shift+right-click (the page never sees it); Mac keyboards have no context-menu key, Shift+F10 may need fn, and Ctrl+click works as a right click; a finger opens no menu, not even with a long press (in edit mode with the Select tool, a finger held still on empty canvas starts a selection frame instead; see "Selecting with a finger" in [FEATURES.md](FEATURES.md#editing)); tablets view and vote.
- **Copy and paste** works between Knorke boards; pasting needs the keyboard
  (there is no "Paste" button; the only exception is "Paste here" in the
  right-click menu, see below). Because Ctrl/⌘+Shift+V delivers only plain text
  in Chromium and Firefox, every copy also keeps the copied items for 10 minutes
  in the browser's local storage (`knorke.clip`) of the Nextcloud origin; the
  guest page deletes it when it is left. Up to 1000 items per paste.
- Paste here (right-click menu) reads the clipboard through the browser's clipboard API. It only appears over HTTPS (or on localhost), and the browser decides: Chrome and Edge ask once for permission, Firefox may show a small “Paste” button that has to be clicked, Safari may show a “Paste” bubble. If the browser refuses, Knorke says so and pastes nothing; Ctrl+V (⌘V on a Mac) always works and pastes at the mouse pointer.
- **Connectors count as items** towards the limit of 5000 per board (3000 notes,
  500 shapes, 800 connectors and 20 frames fit).
- **Rotation** works for single items; a multi-selection only scales. Elbow
  connectors do not route around other items; connector geometry is computed
  in the browser and never stored.
- **Connectors and concurrent deletes:** when you delete an item, Knorke
  frees the attached ends where they were docked. When someone deletes an item
  while another person attaches a connector to it at the same moment, the
  server frees that end instead: an end attached to an anchor point stays
  there, an end attached to a side ("auto") lands in the middle of the deleted
  item. Other people see a resize or rotation (and the connectors following
  it) when you let go; moves they see live. A label holds at most 200
  characters.
- **Text height** is measured by the browser that writes the text; different
  browsers may measure a slightly different height (only the selection box
  differs).
- Guests see the display names of signed-in participants (never user IDs or
  e-mail addresses).
- Not yet: minimap, search within a board, mind maps, templates, export,
  comments, images, rich text, activity log, undo across reloads.

### For administrators

- **Write budget and throttles need Redis.** Per board and participant at
  most 60 requests with changes and 2000 changes (including rows the server
  derives, such as the children a frame moves) per 10 seconds; above that the
  server answers "busy" and the browser retries. Full board loads: 30 per
  minute per account or guest, 300 per minute per board and network address.
  Without Redis there is no write budget. A guest who changes identity gets a
  fresh budget, so the budget slows down broken clients, not attackers (the
  edge rate limit does that).
- **Redis outages sign some accounts out.** When Redis restarts or is
  unavailable, Nextcloud answers accounts that signed in without
  "remember me" as signed out, although the session itself is still valid.
  The board bridges one such answer: it waits a moment (about a second) and
  tries again. If that try is refused as well, for example because Redis is
  still down, the board shows "Your session has ended. Please sign in again."
  The cause is Nextcloud core (PHP sessions in Redis), not Knorke; signing in
  again restores the board, and changes that had not been sent yet may be
  lost.
- **Clean-up:** deleted items are removed for good after 30 days or beyond
  10 000 per board, the change log keeps the newest 100 000 entries per board.
  Undo of a delete after that creates the item anew; a tab that was offline
  longer than that loads the board again.
- **Daily byte quotas.** A board accepts at most 256 MiB of sync requests with changes per day (UTC) and an account at most 512 MiB over all its boards; guests count towards the board only (app config `budget_bytes_board_day`, `budget_bytes_user_day`; 0 switches a quota off). Above a quota, changes wait and are retried about once a minute until the next day starts ("Changes are being saved more slowly. Nothing is lost."); they are kept as long as the tab stays open. The change log of a board is cut back to 64 MiB in the nightly clean-up (`changes_bytes_cap`), deleted items keep a tombstone without their content, and PostgreSQL keeps freed space for reuse instead of giving it back to the file system. Without Redis there are no quotas.
- **Guest limits count per network address.** Knorke's limits for guests (new guest identities per link, board loads and joins, wrong link passwords, unknown link addresses) count per IP address as Nextcloud sees it. All guests behind one network address (venue Wi-Fi, company proxy) share them, and behind a reverse proxy that Nextcloud does not trust (`trusted_proxies` and the forwarded-for header) every guest has the proxy's address, so one guest guessing a password can lock out all guests.
- **A web application firewall can block board content.** A WAF in front of Nextcloud (for example CrowdSec AppSec or ModSecurity rules) may answer a sync request with 403 when a note contains text that looks like an attack. The tab then shows the connection notice, keeps the unsent changes and retries; content that stays blocked is never saved, and closing the tab asks first.
- **Revoking or expiring a link during a session can get a shared network banned.** Reverse proxies with fail2ban-like rules ban an address after a few 401 or 403 answers (for example CrowdSec's http-generic-403-bf and -401-bf scenarios), and such a ban can hit the whole network of a room for hours. When a link is revoked, renewed or given a password, or expires, while guests are on the board, every open guest tab learns it on its next sync and then joins again once by itself (`POST …/join`). The board sends the request header `X-Knorke-End-State: 1` with every sync and with this join, and the server then answers the end states `guest_token`, `not_logged_in`, `link_revoked`, `link_expired` and `links_disabled` (link sharing turned off by the administrator) with 200 and `{"end": …, "message": …}` instead of 401 or 403. Some answers are still 401 or 403: when a password is set or changed, the join of every open guest tab gets one 403 (`password_required`), so that guessing a password keeps counting; tabs that were opened before Knorke was updated to a version that sends the header get the old answers until they are reloaded, and so do requests through a proxy that drops the header; and when the session of a signed-in account ends, Nextcloud itself answers 401, at most twice per tab. The rule therefore stays: while a session with many guests on one network is running, do not revoke or renew a link, do not set a password on it and do not let it expire. If an address is banned anyway, remove the decision (with CrowdSec: `cscli decisions list -i <IP>`, then `cscli decisions delete -i <IP>`).
- **Example exemption for administrators (CrowdSec).** Knorke still answers
  some sync requests with 401 or 403 (see above: tabs of an older version, a
  proxy that drops the header, a signed-in session that ended). Such an
  answer reports a state (link revoked or expired, guest token no longer
  valid, session ended), not a failed login. A parser whitelist like the one
  below keeps these answers out of the brute-force scenarios. It covers the
  sync routes of accounts (`/apps/knorke/api/v1/boards/<id>/sync`) and of
  guests (`/apps/knorke/pub/v1/boards/<id>/sync`) and deliberately leaves
  out `…/pub/v1/<token>/join`, so wrong link passwords keep counting; it
  does not replace the rule above. Adapt the filter to the log types of your
  setup, reload CrowdSec (for example `docker kill -s HUP crowdsec`) and
  check a sample log line with `cscli explain`: it should report "ignored by
  whitelist". For support: the access log now shows the sync and join
  requests as 200 after a link is revoked, renewed or expires or the
  administrator turns off link sharing, and the sync requests after a new
  password is set (the join then still gets the one
  403 (`password_required`) named above); the end state is only in the
  response body (`{"end": …}`), for example in the network tab of the
  browser's developer tools.

  ```yaml
  # for example /etc/crowdsec/parsers/s02-enrich/knorke-whitelist.yaml
  name: local/knorke-whitelist
  description: "Knorke: 401/403 on /sync report a state (link revoked or expired, guest token, session), not brute force"
  filter: "evt.Meta.service == 'http' && evt.Meta.log_type in ['http_access-log', 'http_error-log']"
  whitelist:
    reason: "Knorke sync 401/403"
    expression:
      - evt.Meta.http_verb == 'POST' && evt.Meta.http_status in ['401', '403'] && evt.Meta.http_path matches '^(/index\\.php)?/apps/knorke/(api|pub)/v1/boards/[0-9]+/sync([?].*)?$'
  ```
- **After a database restore** set a new board epoch while Nextcloud is
  still in maintenance mode: `occ maintenance:mode --on`, restore the
  database, `occ config:app:set knorke epoch --value=<8 random characters a-z0-9>`,
  wait a few seconds, `occ maintenance:mode --off` (runbook in
  `docs/ENTWICKLUNG.md` §8). Nextcloud loads no app commands in maintenance
  mode, so `occ knorke:epoch:rotate` only works outside it.

  Every open tab then loads the restored state once by itself. Changes that
  were confirmed after the backup was taken are gone with the restore (visibly,
  not as silent gaps); changes a tab had not sent yet are sent again.
  Disabling and re-enabling the app does not help (the cache prefix stays the
  same).
- **Updates of the app** need `occ upgrade` once for the whole of M1 (version
  0.2.0) and once more for the M2 data foundation (version 0.3.0), then the theming cache buster and a restart of the web server (new
  routes are cached); open tabs reload once by themselves.
- **Deleting accounts or groups while Knorke is disabled.** Knorke removes the shares, link memberships, open votes and boards of a deleted account or group when Nextcloud reports the deletion. A disabled app gets no such report, so an account or group created later with the same name would inherit them. Run `occ knorke:orphans --dry-run` and then `occ knorke:orphans` after every `occ app:enable knorke` and after Nextcloud major upgrades; the daily clean-up job also removes them when it finds the same account or group missing again at least 20 hours after the first time.
- **Sharing policy:** Knorke follows Nextcloud's sharing settings for
  the board's owner. With sharing turned off for the owner (globally or through
  an excluded group) nobody can be added, no role raised and no link created,
  renewed or loosened; removing, lowering, adding a password or an earlier
  expiry and turning a link off still work, and existing shares and links keep
  working (like Nextcloud's own shares). Group sharing off blocks new group
  shares and raising a group's role; "only share with group members" applies to
  new entries. A policy change never revokes existing shares.
- **Nextcloud's link-sharing policy** is honoured for the board's owner: the
  global "Allow users to share via link" and its group exclusion (the owner's
  groups count, never the visitor's). While links are not allowed, nobody can
  create or renew a link, guests and signed-in users cannot join or open a
  board through it, and members who joined through the link lose access.
  Nothing is revoked: allowing links again restores the link, its members and
  its guests. An admin's change reaches open boards within 120 s (Knorke's
  Redis cache) plus Nextcloud's 3-second app-config cache. There is no
  separate Knorke admin switch.
- **Enforced link passwords and expiry dates** (Nextcloud's link settings) are
  required when a link is created, renewed or its password or expiry changes;
  they are **not retroactive**: an older link without them keeps working and
  the dialog marks it ("This link does not meet the current sharing policy.").
  The default expiry is today plus Nextcloud's "expire after n days".
- **Link password strength** depends on Nextcloud's `password_policy` app.
  Without it any password is accepted, even a single character; keep the app
  enabled. After 20 wrong passwords per link and network (IPv4 address, IPv6
  /56) within 10 minutes the link refuses further attempts until the window
  ends; this never locks out other boards.
- **Group and team changes:** removing someone from a group or team, deleting
  a group or team takes effect at once through Nextcloud's events; changes
  without an event (and LDAP groups, which arrive with LDAP's own sync) take up
  to 120 s. Teams need the Circles app; hidden or backend teams grant nothing,
  and with Circles off, team shares grant nothing (they stay stored). A team
  share needs the owner to be a member of the team.
- **Limits of sharing:** at most 200 shares per board, 20 new recipients per
  save, 60 new recipients and 30 saves per 10 minutes per owner, 60 searches per
  minute; the search offers at most 25 results (or Nextcloud's
  `sharing.maxAutocompleteResults`). Members of a group or team are notified
  only on the next run of Nextcloud's background jobs (cron); groups and
  teams with more than 500 members are not notified at all. For them, use
  "Copy board link".
- **A failing group backend can drop share notifications.** If a group
  backend (for example LDAP) fails with an error while the background job
  reads the members of a group, the members get no notification at all,
  not even in the bell, and the job is not retried; Knorke logs
  "Knorke: share notification fan-out failed". The share stays, and the
  members find the board under "Shared with me" once the backend answers
  again. Knorke tells neither them nor the owner: the warning is only in
  the log, and the entry gives the board's ID in the field "board"; it is
  the number at the end of the board's address (`/apps/knorke/b/<ID>`). An
  administrator who finds the warning can tell the board's owner, and the
  owner can send the members the address from "Copy board link". If a
  group backend fails with an error while Knorke checks a notification
  before showing it, Knorke logs
  "Knorke: preparing a share notification failed" and keeps the
  notification; it shows in the bell once the backend answers again. A
  push message missed this way is not sent later, and the e-mail digest
  may leave it out.
- **Accounts of the Guests app** find boards in Nextcloud's search, see
  "Knorke boards" under "Places" in the search dialog and are notified about
  shared boards only when Knorke is on that app's whitelist or the whitelist
  is off. While the whitelist keeps Knorke out, a share notification is
  deleted the first time it would be shown (in the bell, as a push message
  or in the e-mail digest), and it does not come back once Knorke is
  allowed; the share stays, and the board is in the account's board list. To
  notify the account again, note its role in "Share" → "People", remove the
  share and save, then share the board again, or send the address from
  "Copy board link". Both help only once Knorke is allowed: before that, a
  new notification is deleted the same way, and the address leads to the
  Guests app's error page. For a direct share, you see in "Share" → "People"
  whether Knorke is allowed: once it is, the account's row no longer says
  "Cannot open Knorke" the next time you open the dialog. Once you remove
  the share, the dialog no longer shows the account's role, and shared
  again, the account starts with the default role "Can edit"; pick the noted
  role before saving. For a share through a group or team, removing it takes
  the board away from its members until you share it again, and they get a
  new notification on the next cron run; keep that share instead and share
  the board with the guest account directly, with the role it has through
  the group or team. That direct share stays when the account later leaves
  the group or team, or when the group or team share is removed or gets a
  lower role (the highest role of all shares counts: the account keeps
  "Can edit" from the direct share when the group or team gets "Can view");
  remove the direct share then too. If search hits, "Knorke boards" or
  notifications are still missing, or the share dialog still says
  "Cannot open Knorke" although Knorke is allowed, check the
  version of the Guests app.
- **Read replicas:** with `dbreplica` set, every request that runs Knorke SQL
  first opens and commits one empty transaction so that all its reads go to the
  primary: two extra round trips per such request, none without replicas.
- **Legacy MySQL/MariaDB without 4-byte UTF-8** (`mysql.utf8mb4 = false`): emoji
  and every other character above U+FFFF in board titles, notes and frame titles
  are stored as U+FFFD (�). Guest names are not stored in the database and keep
  them.
- **SQLite** locks the whole database file for each write, so writers on
  different boards wait for each other. It is fine for testing; Nextcloud itself
  discourages SQLite in production.
- The guest page of a cold browser makes many requests that belong to
  Nextcloud itself; the count is measured per release (scenario E12).
