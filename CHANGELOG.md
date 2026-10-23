<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

All notable changes to Knorke are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] – 2026-10-23

**Needs one `occ upgrade`:** new database columns for grouping and locking.
Existing boards keep every item.

### Added
- Group items: Ctrl+G (⌘G on a Mac) or "Group items" in the context bar or
  the right-click menu. A group moves, resizes, copies and deletes as a
  whole; Ctrl+Shift+G (⌘⇧G) or "Ungroup" dissolves it.
- Lock items: "Lock" and "Unlock" (Ctrl+Shift+L, ⌘⇧L) for everyone who may
  edit. Nobody moves, edits or deletes a locked item until it is unlocked.
  Facilitators can lift any lock, also many at once with "Unlock all",
  "Unlock all in this frame" and "Unlock all locked by {name}".
- Align, distribute and tidy up: "Align items" in the context bar lines up
  edges and centers, spaces three or more items evenly and puts items on a
  tidy grid.
- Snapping: dragged and resized items snap to the edges, centers and gaps of
  the items around them, with guides. Hold Ctrl (⌘) to move freely.
- Background grid: "Show grid" in the right-click menu of the canvas or the
  key G; items snap to it while "Snap to grid" is on.
- Selecting with a finger: hold a finger still on empty canvas until a ring
  appears, then drag over the items.
- Share notifications: people get a Nextcloud notification when a board is
  shared with them, their group or their team.
- Share dialog: "Cannot open Knorke" below accounts that are not allowed to
  use the app.
- Boards in Nextcloud's unified search (board titles only).
- Privacy notice for guests, with a link to the privacy policy.
  Administrators set the text in the new "Knorke" section of the
  Administration settings. Signed-in people see "Open by link" while a
  guest link of the board is active.
- The right-click menu of the canvas shows how many items are on the board.
- Screenshots for the App Store.

### Changed
- The end of access (link revoked, expired or switched off, session ended)
  is answered with HTTP 200 and an end state in the body instead of 401 or
  403, so ban rules at a reverse proxy (for example CrowdSec) no longer
  count it. Only requests with the header `X-Knorke-End-State: 1` get this
  form; the board always sends it.
- A single "not logged in" answer during sync, as Nextcloud gives it for a
  moment while Redis restarts, no longer signs you out; Knorke tries again.
- Context bar: Esc closes an open panel first, and the panel comes right
  after its button in the Tab order.
- The app description no longer names a version.

### Fixed
- Panning and zooming no longer leave an empty strip at the window edge.
- Opening a board you can no longer open shows "Could not open the board"
  instead of an endless spinner.
- Browser tab, bookmark and home screen show the Knorke icon.
- Guests can no longer install the guest page as an app that starts on the
  login page.
- Accounts of the Guests app that may not use Knorke get no search hits and
  no share notifications.
- The Knorke icon in the unified search is visible in the dark theme.
- Esc clears the selection for signed-in users too.
- Align items: a double click no longer adds an invisible undo step.
- The right-click menu keeps the keyboard focus after a click on its edge.
- Pen tablets: a palm resting on the screen no longer pans or zooms the board
  during a pen or mouse drag, and new notes and connectors appear at the pen.

### Security
- DOMPurify 3.4.17 (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr,
  GHSA-c6gr-qvv4-5v3f). Knorke does not use the affected options.

## [0.2.0] – 2026-10-15

### Added
- Milestone M1, review round P7 (after stage 4), version 0.2.0:
    - Daily byte quotas per board and per account (`budget_bytes_board_day`,
      256 MiB, and `budget_bytes_user_day`, 512 MiB; 0 switches one off;
      Redis only): above a quota the changes wait ("busy", retried about once
      a minute until the next UTC day). The change log of a board is cut back
      to `changes_bytes_cap` (64 MiB) by the clean-up and `occ
      knorke:compact`. A deleted item keeps a tombstone without its content
      (`data` and `style` empty); restoring it sends the whole item.
    - Link changes (create, renew, password, expiry, switch off) are limited
      per account (`link_limit`, default 20 per 10 minutes, answer 429
      "slow_down"); reading links is never limited.
    - `occ knorke:orphans [--dry-run]` removes shares, link memberships, open
      votes and boards of accounts and groups that Nextcloud no longer knows;
      five lines of counts as output. The daily clean-up does the same for ids
      that are still missing 20 hours after they were first seen.
    - App setting `public_url` for the address in link URLs and QR codes.
    - Presence: at most 50 entries of people who may only vote, and entries of
      text-lease holders and presenters are kept before others.
    - The page template `public.php` is now `guest.php`, and both
      templates answer 404 without any output when called outside Nextcloud.
    - The app description in `appinfo/info.xml` names milestone M1.
    - Client: a 403 or 404 without an answer from Knorke (proxy, firewall) no
      longer ends the tab; the vote stepper closes when the board moves, stays
      inside the board and has buttons of at least 44 px; the vote buttons
      accept quick clicks; "Show on the board" closes the list on phones and
      makes room for the side panel; "Bring everyone here" returns to the
      presenter after an interruption; Esc in a text field no longer ends
      following; closing a tab with unsent changes always asks first.
    - Runbook (`docs/ENTWICKLUNG.md` §10): checklist rows P12 (client address
      behind the proxy chain), P13 (firewall probe) and P14 (legal links),
      corrected P3, P9 and restore commands, the rule for links during a
      session and the emergency fix after an address ban, the byte keys and
      the PostgreSQL note. README: known limits for guest limits per network
      address, firewalls, banned networks, byte quotas, orphans after
      disabling, votes from two tabs and revoked rights; the M1 feature list.
    - Harness: contract cases C80–C83 (link limit, byte limits, presence cap,
      `public_url`), browser cases E09c (proxy 403/404 without a body) and E38
      (vote stepper) and a row tap in E31 on phones; the flake gate is
      `--only E34,E35,E37,E38 --repeat 8`; the dev stacks set
      `budget_bytes_board_day` and `budget_bytes_user_day` to 0 and
      `link_limit` to 1000, `normalise_ns` restores these values; probes
      `dev/selftest/ops1-orphans.mjs` and `dev/selftest/ops3-templates.mjs`,
      `dev/selftest/release.test.mjs`.
- Milestone M1, stage 4 ("production readiness"), built and tested in
  development stacks:
    - Right-click menu on the canvas (also the context-menu key and
      Shift+F10) with the actions of the context bar; "Paste here" only over
      HTTPS.
    - Write budget per board and participant ("busy" answers that the
      browser waits out), snapshot and guest-join throttles, the daily
      clean-up of old deleted items and of the change log, and
      `occ knorke:compact` (one JSON line per board; exit 1 for an unknown
      board, 2 for a malformed option).
    - Note shadows are painted with gradients instead of the canvas blur:
      the same look, much cheaper in WebKit (Safari, iPad); the scene lab
      measures with `--shadows on|off` and new rows for the one-finger pan,
      following and the voting badges.
    - Harness: HTTP contract cases C76–C79 (write budget in sub-cases aligned
      to the 10-s window, snapshot throttle, tombstone purge also through the
      background job, change-log cap), the contract suite clears Nextcloud's
      rate limits before every case and counts its own snapshots against the
      new throttle, C44 waits out the per-board guest throttle; browser cases
      E34 (busy in the client), E35 (purge during a session), E37 (right-click
      menu, step 4 also in WebKit as a report) and E12 with a fourth page (the
      voting link on a tablet) and a gate per page; every browser case clears
      the rate limits first; at most 48 boards per run. Host bridge actions
      `purge-tombstones` and `app-config` with their self-tests (bridge
      self-test 125 checks on Nextcloud 34). The convergence run's full fault
      set adds the purge every 10 s.
    - Restore probe of the database-restore runbook (`dev/selftest/restore.sh`),
      release directory with archive and SHA-256 (`dev/release.sh`), and the
      production runbook (German, `docs/ENTWICKLUNG.md` §10).
    - Load-run tooling for the release gate (run only in phase 2): one account
      per editor (`KD_USERS=90`), write-budget calibration from the server's
      counters, board-lock report, key TTL check, page-request measurement for
      the cold-start model, the real Traefik for S4e, fault recovery for SF and
      the rules for runs the load guard aborts.
    - Tools for the later iPad measurement R-B: a LAN relay that binds only
      the Tower's address, `KD_IPAD_PROFILE=1` for the namespace `ipad`, and
      a script that runs voting, timer and "Bring everyone here" over the API.
    - Phase 2, known fixes of Revision 20 (K1–K3 are listed under "Changed"):
        - K4: `docs/PROTOKOLL.md` §14 states the full contract of
          `occ knorke:compact`: key order and whole numbers, `blocks` counts
          only the tombstone blocks, exit 0, exit 1 for an unknown board and
          exit 2 for a malformed `--board` or `--now`, and the run without
          `--board` (instance-wide old change rows and links first, then the
          boards within 60 seconds, an interrupted board is resumed).
        - K6: the right-click menu gives the focus back to the board when it
          closes with the focus inside it; a focus outside the menu (for
          example in a text editor) stays where it is.
        - K7: the voting badges stay painted in groups (all edges, then all
          bodies, then all digits); where badges overlap, their bodies merge
          without a white edge. This is now a recorded decision in the header
          of `src/scene/nodes/badges.js`, and a test pins the call order. No
          behaviour change.
        - K8: the scene lab names the reports of `--shadows off` with
          `-noshadow` (for example `measure-webkit-cpu-noshadow.json`), so
          they no longer overwrite the run with shadows.
        - K9, K11 (documentation): `docs/ENTWICKLUNG.md` §5.4 describes the
          current scene-lab scenarios and report names; the M2 list in
          `docs/ARCHITEKTUR.md` §5 names grouping and the lock rule for
          groups, as decided on 13.10.2026.
        - K10: the hand tool (source label "Pan") is "Schwenken" in German
          instead of "Verschieben".
    - Load-run harness after the first full run (W3), still tooling for
      development stacks only: a drag commits as the patch `{x, y, parent}`;
      the error classes of the S5 gate are those of rule 2 of S4; the seeding
      of the board is reported apart (`budget.seed`) and is not part of the
      per-pid maximum; the counters are collected fresh for every S5 step.
      The fault-recovery run (SF) behaves like the real client and counts a
      401 only when the request was sent after the end of the Redis restart
      window (the first 401 per device and series); a device that gets a 401
      signs in again (operations not yet sent are counted as `lostOps`), and
      sign-outs after a 412 are reported apart (`loggedOut412`). The reports
      gained one T4-10 line per step, "0 calls" for the board lock when there
      were none, and a time-weighted CPU mean. The budget counters are read
      with one `MGET` per key kind and at least one second between two
      reads. `auth=` and password parameters are redacted in the reports.
- Milestone M1, stage 3 ("Moderation"), phase 1, for development stacks
  only:
    - Dot voting for the owner and "Can facilitate": votes per person, one
      vote per item, area (board or selected frame), item types, optional
      time limit, live count of votable items; vote bar, rings on votable
      items, tap and list voting on tablets and phones, ranking after the
      end, totals on the board, "Close results". Facilitators see only how
      many people voted. The voting link and "Can vote" are now visible;
      guests on the voting link may stay "Guest".
    - Timer (start, pause, resume, +1/+5 min, stop, "Time's up", optional
      sound), following a participant, "Bring everyone here" with
      "{name} is presenting · Follow", Shift+2 and the frame list, the narrow
      layout up to 600 px.
    - Harness: HTTP contract cases C69–C75 (session life cycle and codes,
      the vote op with the votes block of Revision 16, vote secrecy and the
      `vt` rule, expiry in three sub-cases, timer, "everyone to me",
      presence `v`) and browser cases E31–E33 with phone and tablet passes
      (`E31@390x844`, …; `--only E31` selects all passes), the stage-3
      additions of E28 (voting link, "Guest", `vote_ready`, its QR code) and
      E11 on `device_vote`. New host bridge action `vote-expire` (and the
      stack helper `Stack.voteExpire`) lets an open session expire without
      waiting; the moderation rate limit is cleared before each stage-3 case.
      A bars check (`dev/e2e/lib/bars.mjs`) verifies the narrow layout.
      The browser cases open a moderation entry only through an open menu
      and retry once (`dev/e2e/lib/moderation.mjs`; a closing menu still
      shows its old entries), and E31 counts the expected vote rings over
      the renderer's culled set (viewport plus 10 %).
    - Run evidence: `dev/selftest/upgrade.sh` writes its reports as
      `upgrade-<db>-{seed,verify,contract}[-<KD_RUN_LABEL>].{md,json}`
      (`KD_REPORT_STEM` in `dev/sim/lib/report.mjs`), so two runs in the
      same namespace keep their evidence.
    - CI: the frontend job runs `npm audit --omit=dev --audit-level=low`
      after `npm ci` (runtime dependencies; the 12 findings of the
      devDependency chain of `@nextcloud/vite-config` were accepted on
      13.10.2026 and are checked again in stage 4).
    - Phase 2, known fixes of Revision 17 (K1–K7):
        - K1: lowering a vote or setting it to the same value never fails
          with `limit`; only an increase checks the votes per person and per
          item (an overdrawn budget after an undo is tolerated). The
          client's local pre-check lets such a change through as well.
        - K2: a vote can be lowered or taken back (`n` ≤ the stored value)
          regardless of item type and voting area, also after an editor
          moved the item out of the area's frame; only an increase checks
          type, area and budget. Votes on live items outside the area keep
          counting in "votes left", the tally and the results. Contract case
          C70 has a sub-case for it (vote, move the note out of the frame,
          `n: 0` → `ok`, votes left + n).
        - K3: the timer dialog offers "+1 min" and "+5 min" whenever a timer
          exists (running, paused or run out); "Pause" only while it runs.
        - K4: the open vote list follows changes of the board (items added,
          deleted, moved into or out of the frame, text edited), not only
          vote updates.
        - K5: the vote/edit switch in the vote bar is a plain action button
          ("Edit" or "Vote"); it no longer combines `aria-pressed` with a
          changing label.
        - K6: the bridge self-test records the server outcomes of its live
          part as checks, not notes (re-join after an expired link →
          `link_expired`, the vote op after `vote-expire` → `closed`, the
          session closed, a second `vote-expire` refused; a board, snapshot,
          sync, link or route 22 that does not answer is a failure, never a
          skip; `dev/e2e/lib/selftestLive.mjs`). `menuAction` clicks an entry
          directly only when it is outside every popover, closes open menus
          with Escape before it opens the moderation menu (through the
          trigger on a page that follows someone), and tags every failure
          "[C] menuAction …" with the element at the entry's centre.
        - K7: the browser bars check expects the vote bar at the bottom in
          both test viewports (390 × 844 and 820 × 1180), since it docks at
          the bottom in every layout; the E28 passes start a session to
          check it.
        - Fix round 1 (K7): in the wide layout the vote bar now docks flush
          at the bottom edge of the board (only its top corners round, no
          border on the docked edge); the zoom controls and the vote panel
          stand one gap above it.
- Milestone M1, stage 2 ("Teilen & Rollen"), phase 1, for development stacks
  only:
    - Sharing with people, groups and teams with the roles "Can facilitate",
      "Can edit" and "Can view" ("Can vote" stays hidden until voting arrives
      in stage 3); "Shared with me" in the board list with the source and the
      access level of every board; role changes and removals take effect
      live; "Copy board link".
    - Link password and expiry date (a calendar day in the owner's time
      zone), QR code and "Show to the room" per link; Nextcloud's sharing
      policy (sharing off, group sharing off, only group members, enforced
      link password and expiry) for shares and links.
    - LOD 2: below 10 % zoom one painter draws the whole board.
    - Harness: HTTP contract cases C60–C68 (shares API with every rule, roles
      and origins, live revocation, sharee search, vote link, link password
      with the lock-out, expiry in the owner's calendar day, fast path of share
      users, board list and teams) and browser cases E27–E30 and E36. New host
      bridge action `ratelimit-reset` clears Nextcloud's rate-limiter state,
      which otherwise outlives a run (the sharing cases call it first, the
      contract suite through a stack helper); `link-expire` now also raises the
      generation of the link's role, like a real expiry ends guest tokens.
      `normalise_ns` deletes the system keys `sharing.minSearchStringLength`
      and `sharing.maxAutocompleteResults`; the contract suite's own
      normalisation also restores the harness groups and destroys harness
      teams. Nextcloud booleans are compared tolerantly (`yes|true|1`,
      `no|false|0`). A browser run may create up to 40 boards (stages 0–2
      need 28); E36 clicks a note or a shape at 5 %, never a connector, since
      connectors are skipped by click and marquee at LOD 2.
    - Harness, phase 2 (R14-04, R14-05): contract case C66 checks that the
      owner answer of the share route carries `linkPolicy.today` (today in the
      instance's `default_timezone` for an owner without a stored zone) and
      that the snapshot's `board.linkPolicy` has none; C60, C66 expect the fifth
      key. E29 ends with the bridge action `link-expire` on the edit link
      (guest tab in `link_expired` with no `/sync` for 5 s, reload shows
      `expired`, a signed-in link member sees `gone` with the link text).
      README: at LOD 2 a frame is also selected through its painted title
      rectangle.
    - Docs: the scene lab's `measure` scenarios (whole-board pan `boardPan`,
      the A/B set `--set noconn`, the LOD-2 zoom row and the first render of
      the whole board `lod2First`), its 17 gates and 49 checks with G14 and
      the four new LOD-2 checks, the M2 list in the architecture overview,
      sharing and its limits in the README, the new bridge actions and five
      new traps in `docs/ENTWICKLUNG.md`. A drift test keeps the lab section
      of `docs/ENTWICKLUNG.md` in line with the lab's gate and check counts.
- Milestone M1, stage 2 ("Teilen & Rollen"), phase 0, development harness
  only: the host bridge of the browser tests knows `share-policy` (the
  sharing-policy keys of the spec, also sharing on/off and the excluded
  groups), `group-member`, `circles`, `team-create`, `team-member`,
  `link-expire` and `seed-board` (E36), each argument checked against a fixed
  list (harness accounts and groups only). Every switching action is put
  back by the test world's cleanup; the namespace is normalised before and
  after every browser run, now also the members of the harness group
  `knorke-e2e` and the harness teams (`knorke-e2e-…`).
- Milestone M1, stage 1, round 1b ("Verbinder"), for development stacks only:
    - Connectors in the browser: tool L or a "+" handle of a selected note,
      shape or text item; ends attached to an item (its side or an anchor
      point) or free; straight, elbow and curved routes, tips at both ends,
      line style and a label; connectors follow their items live (also while
      someone else drags them); end handles re-attach an end; deleting an item
      leaves its connector ends free where they were docked, and undo attaches
      them again; "Connect" joins two selected items without dragging; copy
      and paste keep connectors between the copies.
    - Harness: browser scenario E23 (draw, follow at both clients, delete the
      target, undo, route, tip and label, re-attach, "+" handle), the
      connector part of E24 (a frame with two notes and a connector between
      them pasted into another board: the connector is attached to the
      copies) and "Connect" in E26; E26 also presses N right after the board
      opens, without a click. The convergence run plays connectors by default
      (`--no-connectors` turns them off): ends onto items removed in the same
      batch or by another client, deleting attached items, `keep` around a
      removed frame child in both orders; K0 fails the run when one of these
      never happened. The Firefox report of E24 keeps the running step and the
      last lines of Playwright's call log when it aborts, and retries the
      login once.
    - Harness (round 1b, phase 2): the browser scenarios pick end and "+"
      handles by their names, now frozen (`start`, `end`, `plus-t`, `plus-r`,
      `plus-b`, `plus-l`); picking by position is only the fallback and leaves
      a note. E23 checks that a selected connector shows exactly the handles
      `start` and `end`; E24 checks that the pasted connector's anchored start
      lies exactly at the anchor point of the copied note (±0.01), with the
      anchor formula in `dev/e2e/lib/geom.mjs`, pinned to the golden file.
      `docs/ENTWICKLUNG.md` lists the 16 gates and 44 checks of the scene lab.
      E23 also checks that a press on the canvas closes an open panel of
      the context bar while the connector stays selected (it covered the
      connector's line before).
- Milestone M1, stage 1, round 1a ("Formen, Text, Transformer, Tasten,
  Zwischenablage"), for development stacks only:
    - Shapes (rectangle, rounded rectangle, ellipse, diamond, triangle, block
      arrow) with fill, opacity, border and text; text items whose height grows
      with the text; resize and rotate handles for one item, uniform scaling
      for several; frames resize while their content stays in place (`keep`).
    - Copy, cut, paste (also between boards, and plain text as notes),
      duplicate, paste in place; keyboard use (focus rule for single keys,
      Tab through the items, arrow keys, Enter, "Arrange" by number) and serial
      input of notes with Tab.
    - Server side of connectors: ends bound to an item (centre or an anchor)
      or free, checked in the board lock; deleting an item releases the bound
      ends to a free point at their anchor; the drawing tool follows in round
      1b.
    - Harness: contract cases C53–C59 (shapes, text items, connector ends and
      their release, the end registers, `keep` with 600 children, M0
      compatibility) and a wider run invariant (connector form, placement and
      targets); the convergence run plays shapes, text items, transforms and
      frame resizing with `keep` (`--mix m1`, the default; `--mix m0`
      keeps the old workload; `--connectors` added connector ops, opt-in in
      round 1a) and its oracle knows typed colour fields, `keep` and connector
      ends with their release (±0.01 for anchors on rotated items); browser scenarios E21, E22, E24 (Chromium, WebKit with the
      paste catcher, Firefox as a report), E25 and E26; `dev/sim/geom.test.mjs`
      pins the harness's own connector geometry to the golden files.
    - Harness fix: a page error now fails the scenario on every tab of an
      actor and also for actors a scenario closes before its end (before, most
      stage-1 scenarios could not turn red on one); the WebKit part of E24
      checks its own page errors; Firefox runs with a fine pointer (headless
      Firefox has none, and Knorke then only lets it look).
    - Harness: frame `keep` is checked at the time of its op (spec revision
      9). The convergence oracle shifts only placements made before a keep
      patch, and the workload now sends the client's order: the keep patch,
      then adopting and releasing children in the same batch. The workload
      no longer holds back while a keep patch is queued. C58 covers both
      orders in one batch. Every stage-1 browser check names exactly one
      owner.
    - Harness fix (round 1a, wave W1): the HTTP client of the contract and
      convergence runs sends a request once more on a fresh connection when
      Apache closed the pooled keep-alive socket just as it was written (a
      reset after about 5 s of idle time turned one C47 check red under load).
      C58 also moves a child shifted by `keep` into another frame in the same
      batch and checks snapshot, stored parent and change row.
    - Harness fix (round 1a, wave W2): the upgrade probe
      (`dev/selftest/upgrade.sh`) takes its M0 code from the frozen snapshot
      of the start of M1 (0.1.0) instead of the flow-back base, which carries
      0.2.0 since stage 0 flowed back; the M0 code must now be older than the
      M1 code, not merely different.
- Milestone M1, stage 0 ("Fundament"), for development stacks only:
    - Sync protocol 2 with the whole M1 wire contract frozen at once: every
      sync carries the board epoch (`ep`), every answer the server time
      (`now`); snapshots carry `epoch`, `now`, the board's metadata and
      `links` (edit and vote link) instead of `link`; fields of later stages
      are accepted and ignored until their stage.
    - Live board titles: a rename reaches every open client with the next poll,
      without a reload, through the new meta channel (`meta_rev`).
    - Board epoch: `occ knorke:epoch:rotate` hides every Redis key at once
      after a database restore; every open tab resyncs exactly once.
    - The whole M1 database migration (app version 0.2.0) and all 26 routes of
      M1, the ones of later stages answering `501 not_implemented`.
    - A tab with an old bundle reloads once per protocol version (also after a
      second update in the same session) and never while text or unsent
      changes are at stake.
    - CI workflow (`.github/workflows/ci.yml`): bundle, translations, JS and
      harness tests, script syntax, `info.xml` schema, PHPUnit on Nextcloud 34
      and 35; read-only token, actions pinned to commits, no
      `pull_request_target`.
- Milestone M0 ("Gerüst"), for development stacks only:
    - Board list with own boards and boards joined through a link; create,
      rename and delete (owner only, with confirmation).
    - Infinite canvas with pan and zoom (5–400 %) by mouse, trackpad and touch;
      wheel and touch gestures run on a CSS transform; level of detail below
      30 % zoom.
    - Sticky notes and frames: create, move, edit text, colour, order, delete;
      notes move into and out of frames, deleting a frame keeps its notes;
      unknown item types show as placeholders.
    - One sync request per tick with server-authoritative last-writer-wins per
      property (position and parent as one unit), compacted changes, gzip and
      a Redis fast path without app SQL for idle polls.
    - Live presence: cursors with names, selections, drag previews, an
      "is editing" chip and a text lease with "Take over".
    - Undo and redo of one's own actions (up to 50 steps).
    - One edit link per board (on, off, renew); guests join with a name and keep
      their identity across reloads; signed-in users become members.
    - View-only mode on devices without a fine pointer.
    - English source strings and a complete German translation.
    - Nextcloud's link-sharing policy ("Allow users to share via link" and its
      group exclusion) is honoured for the board's owner: while links are not
      allowed, creating, renewing, joining and opening through a link answer
      `403 links_disabled`, link members lose access, and allowing links again
      restores everything; the share dialog, the guest page and the join page
      say so. Enforced link passwords and expiry dates are not honoured yet.
    - The guest page shows the instance's legal notice and privacy policy links
      (theming) in the name dialog, the guest menu and the empty states, since
      Nextcloud's footer stays hidden there.
    - Supported databases are declared in `appinfo/info.xml`: PostgreSQL,
      MySQL/MariaDB and SQLite (Oracle is refused). All queries are portable.
    - Read replicas (`dbreplica`): every Knorke read goes to the primary.
    - On MySQL/MariaDB without 4-byte UTF-8, characters above U+FFFF are stored
      as U+FFFD instead of failing the whole sync batch with a server error.
    - The client no longer retries a batch that keeps failing with a server
      error forever: it isolates the failing change, keeps sending the others,
      and drops a change only after it failed alone three times, with a notice
      and the text rescue.
    - After a protocol update (`409 protocol`) the board freezes and reloads
      at most once per tab, past every cache, and never while text or unsent
      changes are at stake.
    - Smoother remote cursors and drag previews at every poll rate; a duplicated
      browser tab gets its own client id; the board list rows are real links and
      the owner's title is a labelled rename button; a pan started right after a
      wheel zoom no longer jumps back.
- Development tooling:
    - Throwaway dev stacks per namespace (`dev/up.sh`, `dev/down.sh`) for
      Nextcloud 34 and 35 with PostgreSQL 17 and Redis 7, plus helper scripts
      and a placeholder app for testing the stack on its own.
    - HTTP contract tests C01–C48 and a convergence run with fault injection
      (`dev/sim/`); C41–C44 cover the board byte budget, a link join racing
      a link renewal, item types on revive, item shape after patches and the
      per-link budget for new guests; C45–C48 cover Nextcloud's link policy
      (also its group exclusion), the legal links of the guest page and 4-byte
      text on a database without utf8mb4. The contract suite runs on every
      database of the dev stack and reports the cases that do not apply as
      skipped.
    - Browser acceptance E01–E12 with Playwright 1.49.1 in a container and a
      host bridge for database and Redis steps (`dev/e2e/`); `--repeat N`
      runs a selection N times in fresh worlds (flake gate), and a red text
      lease scenario writes its `/sync` trace into the report. An extra
      scenario E09b answers `/sync` with an app 429 and checks the final
      `rate_limited` status and banner; E13 checks the question before leaving
      a board with unsaved changes, E14 that text typed into an open editor
      survives a reload or closing the page, E15 the legal links of the guest
      page, E16 the link policy switched off and on by the admin, E17 that a
      `409 protocol` reloads once and then freezes the board. The host bridge
      gained `links-policy` and `legal-links` for this.
    - The dev stack refuses an app directory inside the production stack under
      every mount path (also the second Unraid view of the same folder).
    - Scene lab with deterministic rendering gates (`dev/scene-lab/`).
    - Dev stacks on more databases: `KD_DB=mariadb|mysql|sqlite` (MariaDB 11.8,
      MySQL 8.4, SQLite) besides the default PostgreSQL 17, and
      `KD_MYSQL_UTF8MB4=0` for a legacy install without 4-byte UTF-8;
      `dev/db.sh` opens an SQL shell on any of them.
    - Database and Redis of a dev stack sit on an internal Docker network
      only, and Redis requires a generated password; `dev/selftest/isolation.sh`
      checks the layout of a running stack.
    - Browser and contract runs keep their bridge, reports and screenshots per
      namespace, and a second browser run in the same namespace is refused.
      The browser container runs as an unprivileged user with the test code
      mounted read-only, and the host bridge no longer follows or moves
      anything the container plants in its directory.
    - Contract, convergence and browser runs first remove fault injection
      and template settings an interrupted run left behind; an interrupted
      convergence run removes its own on SIGINT/SIGTERM.
- Development tooling for M1 stage 0:
    - Protected namespaces: every dev script refuses the user's own stack
      `try` (`KD_PROTECT_NS`) unless `KD_FORCE=1`; at most five dev stacks
      run next to it (shared lock outside every repository copy); `dev/build.sh`
      only bumps the cache buster of stacks that mount its own copy; a working
      copy for M1 with fixed rsync patterns for copying and flowing back.
    - HTTP contract C49–C52 (protocol 2, meta channel, board epoch, forward
      keys and `now`) and a wider run invariant; the M0 cases follow
      protocol 2.
    - The convergence run works on every database (exact change-log reader
      through Nextcloud's own connection, an oracle that knows databases
      without 4-byte UTF-8).
    - Browser acceptance E18 (server errors isolate a single change), E19
      (live titles) and E20 (protocol jumps); E15 and E16 also check the
      contrast of the guest page's empty states (at least 4.5:1 for name and
      description against the card, over black and over white, in a light and
      a dark colour scheme).
    - `dev/selftest/upgrade.sh`: the upgrade from M0 to M1 with seeded data,
      the user's runbook and the full contract, in a throwaway stack; a
      "Repair error" printed by `occ upgrade` fails the run although
      `occ upgrade` itself still exits with 0.
    - Dev stacks with `KD_MYSQL_UTF8MB4=0` are now a faithful legacy install:
      the core tables are converted to utf8mb3 as well (before, only Knorke's
      tables were, and every later `occ upgrade` hit a failing collation
      repair step).
    - `dev/clean-reports.sh` removes old reports (dry run by default); an
      extra account `carol` and the group `knorke-e2e` in every dev stack; the
      host bridge takes up to four checked arguments; runs reset Nextcloud's
      whole sharing policy, the harness's app settings and Circles first.
    - Hardened scene lab (`dev/scene-lab/run.sh`): the container runs as an
      unprivileged user (uid 47001 by default, `KNORKE_LAB_UID`) with every
      capability dropped and `no-new-privileges`, sees its code read-only
      and writes only `dev/scene-lab/out`, which belongs to that uid after a
      run; a new gate G17 checks these bounds. One lab run per copy at a time
      (lock `dev/.state/lab.lock`; a second run waits up to 30 minutes,
      `KNORKE_LAB_LOCK_WAIT`, then gives up with exit code 2). New modes
      `run.sh dist` (build only) and `run.sh ipad` (package for the tablet
      measurement R-A, `out/ipad-ra/` and `out/ipad-ra.tar.gz`, checked in
      Chromium and WebKit, `out/ipad-check.{json,md}`). The package carries a
      session server for the LAN (`ipad/session.mjs`: binds one address of
      the home network only, serves the package read-only, stores the results
      pasted or picked on its send page, ends itself after four hours).
    - Scene lab measurements in WebKit (`KNORKE_LAB_BROWSER=webkit`) and with
      a tablet viewport (`--viewport`, `--dpr`); every report states whether
      the browser really rendered on the GPU (Mesa driver per process, GPU
      engine time, WebGL renderer). `dev/scene-lab/webkit-gpu.mjs` runs the
      comparison series WebKit/Chromium with and without the GPU.
    - The scene lab's own self-tests (`dev/scene-lab/test/`, no Docker and no
      Playwright needed) run with the harness self-tests, also in CI;
      `dev/up.sh` refuses the session server ports 18612 and 18613 as
      `KD_PORT`.
- Documentation (German): development guide, architecture, sync protocol.

### Changed
- Documentation only, before the production rollout (no code change, no
  migration, still 0.2.0): the iPad measurement R-B moved to milestone M2,
  before the App Store release; the production rollout goes ahead without
  it. README known limits: iPad and Safari are listed as not measured on
  real hardware (the Android tablet measurement R-A is named); links stay
  unchanged during a session, because an exemption for the sync routes alone
  is not enough: the automatic re-join after a revoked or expired link also
  answers 403 and can still count towards an address ban; a new example
  CrowdSec whitelist for administrators. Runbook (`docs/ENTWICKLUNG.md` §10,
  German): P4 moved to M2, a read-only check of the background-job mode for
  P6, a one-time database dump before `occ app:enable`, the legal links (P14)
  before the first guest from the internet, the source of the release for P9
  and its SHA-256 check.
- Convergence run (M1 stage 4): the oracle takes a deviation on an id the
  fault `purge` removed only when the server answered with the code of the
  documented consequences of a purge (creation `ok`, patch or remove `gone`,
  parent or connector end `bad`); a code that contradicts them is now a
  deviation of its own, and an id created anew after a purge counts as an
  ordinary item again. The report names the ops with the expected code.
- Harness (M1 stage 4): the restore probe (`dev/selftest/lib/restore-probe.mjs`)
  and `dev/ipad/moderate.mjs`, started directly, refuse a protected
  namespace (`KD_PROTECT_NS`, default `try`) with exit 2 unless
  `KD_FORCE=1`, before reading `env.json` or calling Docker, like
  `dev/load/lib/pageload.mjs`; the three share one check in
  `dev/sim/lib/env.mjs`.
- Load-run page measurement (M1 stage 4): the throwaway Playwright container
  of `dev/load/lib/pageload.mjs` no longer shares the host's IPC namespace
  (`--ipc=host` dropped; Chromium keeps `--disable-dev-shm-usage`).
- Database restore runbook (M1 stage 4): the new board epoch is set in
  maintenance mode with `occ config:app:set knorke epoch` (Nextcloud loads no
  app commands in maintenance mode); `occ knorke:epoch:rotate` stays for
  rotations outside it.
- README (M1 stage 4): the iPad is listed as not yet measured on real
  hardware (the measurement follows after stage 4); limits of the right-click
  menu and of "Paste here".
- Contract case C06 (and C18) now use the unknown type `pen`: `shape`,
  `text` and `connector` are known types from M1 stage 1 on.
- Renaming a board now goes through the meta channel and raises the board's
  revision; it writes no change-log row.
- Redis keys carry the board epoch: `<prefix>/knorke/<epoch>/<key>`. The
  database-restore runbook is now: maintenance on, restore, `occ
  knorke:epoch:rotate`, maintenance off (no more deleting keys by hand).
- An empty sync answer is `{"rev", "now"}` (plus `presence`); a `409
  protocol` answer names the server's protocol version.

### Fixed
- Touch on a device that also reports a fine pointer (hotfix H1, after the
  production rollout; still 0.2.0, no migration, no server change): such a
  phone or tablet is in edit mode, but a finger created nothing with the
  note, text, shape, frame or connector tool, and the note tool stayed
  active. A finger now creates like the mouse: a tap places a note, text,
  shape or frame in its default size, a drag draws a shape or frame (or
  sets the wrap width of a text), the connector goes from item to item or
  point, and the tool goes back to select afterwards. The tap that creates
  an item sends no click to the new editor or the context bar under the
  finger. The hand tool, two fingers, the select tool, mouse and pen, vote
  and view mode and the device detection are unchanged.
