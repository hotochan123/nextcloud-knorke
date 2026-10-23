<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Knorke – Workshop-Board for Nextcloud

> **Vibe-coded:** Knorke is written by AI coding agents (Anthropic's Claude Code),
> not by hand. The maintainer sets the goals, makes the product decisions and tries
> the app out in the browser; there has been no independent human code review and
> no security audit. Details: [How this app is built](#how-this-app-is-built-ai-disclosure).

Knorke is a collaborative whiteboard for workshops as a native Nextcloud app: an
infinite canvas with sticky notes and frames, live cursors of everybody on the
board, and one edit link per board through which guests join with just a name.
It runs inside your own Nextcloud, without an extra server process.

**Status: version 0.3.0, the first release in the Nextcloud App Store.** It
contains milestone M1 and a first part of milestone M2. What is new since
0.2.0 is listed under [New after 0.2.0](#new-after-020). Stages 0 to 4 of M1
are built; the maintainer's production checklist is in `docs/ENTWICKLUNG.md`
§10 (German), and the limits that remain are listed under
[Known limits](#known-limits). Stage 0 ("foundation") brought sync protocol
2, live board titles, the board epoch for database restores and CI. Stage 1
added shapes, text items, resizing and rotating, copy/paste and keyboard use
(round 1a) and connectors between items (round 1b). Stage 2 added sharing
with people, groups and teams with roles. Stage 3 added moderation: dot
voting, a timer and "Bring everyone here". Stage 4 ("production readiness")
added the right-click menu, a per-user write budget, throttles, the daily
clean-up and the tooling for the release checks. The review round after
stage 4 (P7) added a daily byte quota, a limit on link changes, the command
`occ knorke:orphans`, the setting `public_url` and further fixes (see the
[changelog](CHANGELOG.md)).

## How this app is built (AI disclosure)

Knorke is vibe-coded. The maintainer ([hotochan123](https://github.com/hotochan123))
does not write the code by hand. They set the goals, make the product decisions
and try the app out in the browser. Everything else is written by AI coding
agents:

- all code – PHP, JavaScript/Vue, CSS and the database migration;
- the tests and the development tools (dev stack, HTTP contract tests,
  convergence run, browser acceptance, scene lab);
- the documentation, including this README, and the German translation.

**Tool and models.** The agents run in Anthropic's Claude Code; commits carry a
`Co-Authored-By` trailer naming the model.

**Verification.** Knorke is checked by PHP unit and integration tests, pure
JavaScript tests (`node --test`), an HTTP contract suite (cases C01–C87), a
convergence run with fault injection, browser acceptance scenarios (E01–E45
+ E04b, E09b and E09c, with phone and tablet passes of E28, E31 and E33, Playwright) and a scene lab with
deterministic rendering gates. All of them are
written by the same AI agents, so they check the code against the agents' own
reading of the specification. There has been no independent human code review
and no security audit.

**What this means for you.** Evaluate Knorke yourself before you rely on it.
Knorke is licensed under AGPL-3.0-or-later and comes without any warranty.

## Features (M1)

- **Board list:** your own boards and boards you joined through a link; create,
  rename, delete (owner only, with confirmation).
- **Infinite canvas:** pan with the hand tool, space + drag, middle mouse
  button, two-finger scroll and one-finger drag on touch; zoom 5–400 % with
  Ctrl/⌘ + wheel, trackpad pinch, touch pinch and buttons; "show all" and 100 %.
  Wheel and touch gestures run on a CSS transform, so the canvas stays smooth on
  large boards.
- **Sticky notes and frames:** create, move (also several at once), edit text,
  colour, bring to front/send to back, delete; drag notes into and out of frames.
  Deleting a frame keeps its notes. Unknown item types show as placeholders.
- **Live collaboration:** cursors with names, other people's selections, drag
  previews and an "X is editing…" chip. Text editing holds a lease: a second
  person cannot silently overwrite what someone is typing, but can take over.
- **Undo/redo** of your own actions (up to 50 steps).
- **Sharing:** one edit link per board (on, off, renew). Guests without an
  account join with a name; signed-in users who open the link become members.
  Renewing the link removes everybody who joined through the old one. Knorke
  honours Nextcloud's "Allow users to share via link" setting and its group
  exclusion for the board's owner (see [Known limits](#known-limits)).
- **Guest page:** Nextcloud's footer stays hidden, so the page shows the
  instance's legal notice and privacy policy links itself (from theming) in the
  name dialog, in the guest menu of the top bar and on the "link revoked/invalid"
  pages.
- **Devices:** tablets and phones (no fine pointer) can view, pan and zoom.
  Touch devices that also report a fine pointer (a pen, a touchpad, some touch
  drivers) edit like a computer; there a finger held still on empty canvas,
  then dragged, draws a selection frame (see "Selecting with a finger" below).
- **Languages:** English and German.

### New in M1 stage 0

- **Live titles:** renaming a board shows up for everybody on it within a poll
  (about a second), without a reload; a rename field that is open elsewhere is
  not overwritten.
- **Clean reloads after an update:** a tab with an old bundle reloads exactly
  once per protocol version, also after a second update in the same session,
  and never while text or unsent changes are at stake.
- **Board epoch:** after a database restore, a new epoch (set in maintenance
  mode with `occ config:app:set knorke epoch`, or `occ knorke:epoch:rotate`
  outside it) makes every open tab load the restored state once by itself (see
  [Known limits](#known-limits)).
- **Server time** in every sync answer, for timers and voting later in M1.
- **CI** (`.github/workflows/ci.yml`): bundle, translations, JS and harness
  tests, PHPUnit on Nextcloud 34 and 35; it runs once the repository is pushed.

### New in M1 stage 1, round 1a

- **Shapes:** rectangle, rounded rectangle, ellipse, diamond, triangle and block
  arrow (tool S; click for the default size or drag), with fill, opacity,
  border colour, width and style (solid, dashed, dotted), and text with
  alignment (automatic size or a fixed font size).
- **Text items** (tool T): free text on the board; the height grows with the
  text, the side handles change the wrap width, the corner handles the font
  size. A text item that is left empty disappears when its editor closes.
- **Resize and rotate** with handles of a fixed screen size: corners keep the
  aspect ratio of notes (Shift releases it) and are free for shapes (Shift
  keeps it); rotation snaps to 45° (Shift: 15° steps); Esc cancels; every
  transform is one undo step. Several selected items scale uniformly, without
  rotation. Frames resize too, and their content stays where it is on the
  board when the top or left edge moves; items that end up outside leave the
  frame.
- **Copy, cut, paste, duplicate:** Ctrl/⌘+C, X, V and D, Ctrl/⌘+Shift+V pastes
  in place; frames come with their content; between boards in the same
  browser; plain text becomes one note per line (more than 100 notes ask
  first); a full board says so instead of pasting half. Selected page text is
  still copied normally.
- **Keyboard:** single-key shortcuts act only while the canvas has the focus;
  Tab/Shift+Tab select the items one by one (frames first, then by position)
  and Tab leaves the canvas after the last one; arrow keys move by 1 (Shift:
  10); Enter edits the text; "Arrange" sets position, size and angle by
  number. Tab in a note's editor saves it and starts the next note to its
  right (serial input).
- **Context bar per item type** with palettes for fill, border and text.

### New in M1 stage 1, round 1b

- **Connectors** (tool L): drag from one item to another, or from one of the
  four "+" handles of a selected note, shape or text item; an end dropped on
  empty canvas stays free. Ends attach to the side facing the other item, or
  to an anchor point when you start or drop near one. Hold Ctrl/⌘ while you
  start the drag or let go to make that end a free end: it attaches to no
  item and no anchor point, even over an item. A drag never attaches both
  ends to the same item. Routes straight, elbow or curved; tips none, arrow,
  triangle, dot or diamond at either end; line colour, width and style; a
  label (double-click the line).
- **Connectors follow** the items they are attached to, also while you or
  someone else drags them.
- **Re-attach an end** by dragging its handle onto another item or onto empty
  canvas.
- **Deleting an item** leaves the ends attached to it as free ends at the
  spot where they were docked; undo attaches them again.
- **Moving connectors:** attached ends always follow their items. Free ends
  move only when the connector itself is part of what you move: a selected
  connector with two free ends moves with the selection; a selected connector
  with an attached end moves (its free end along) only together with all the
  items it is attached to (selected as well, or inside a frame you move).
  If one of those items stays where it is, the connector stays as well, free
  end included; drag its end handles instead.
- **"Connect"** in the context bar joins two selected items without dragging
  (also from the keyboard).
- **Copy and paste** keep connectors between copied items attached to the
  copies. A connector with an end outside the copy comes along only when it is
  selected itself, and that end becomes a free end at its current place.

### New in M1 stage 2

- **Share with people, groups and teams:** the owner opens "Share" → "People",
  searches by name (Nextcloud's own rules for whom you may find and share
  with), picks a role per entry and saves. Roles:
    - **Can facilitate** – edit, plus facilitation: the person sees the board's
      links read-only (copy, QR code, "Show to the room") and, since stage 3,
      runs voting, the timer and "Bring everyone here". Only the owner and
      shares with this role facilitate – sharing with a whole department as
      "Can edit" makes nobody a facilitator.
    - **Can edit**, **Can view** and, since stage 3, **Can vote** (view and
      vote, nothing else).
  A new recipient starts as "Can edit". Removing an entry or changing a role
  takes effect on the recipient's next poll (about a second), without a
  reload: the toolbar appears or disappears, a "View only" banner shows, and
  a recipient who loses access sees "This board is no longer available.".
- **"Shared with me":** the board list filters "All", "Mine" and "Shared with
  me" and shows for every board that is not your own where it comes from
  ("Shared with you" or "Joined through a link") and what you may do
  ("Can facilitate", "Can edit", "Can vote" or "Can view").
  The effective role is the highest of all your shares (yourself, your groups,
  your teams) and links.
- **"Copy board link"** in the dialog copies the board's internal address for
  Talk or e-mail. People you share the board with also get a Nextcloud
  notification; see "Share notifications" under "New after 0.2.0".
- **Link password and expiry:** each link can have a password and an expiry
  date (a calendar day in the owner's time zone; the link ends at 23:59:59.999
  of that day). Guests and signed-in people who open the link must enter the
  password; an expired link says so. Setting or changing the password asks
  first, because everyone who joined through the link has to enter it again
  (open guest tabs land in the password dialog with their name kept, signed-in
  link members see "Your access through the link ended. Open the link
  again."). Shortening the expiry renews the guests' access tokens; renewing
  a link keeps its password. A password generator creates 16 characters
  locally in the browser.
- **QR code and "Show to the room"** per link: a small QR code in the dialog
  and a full-screen view with a large QR code and the address for a projector.
- **Nextcloud's sharing policy** applies to shares and links (see
  [Known limits](#known-limits)).
- **Overview of large boards (LOD 2):** below 10 % zoom the whole board is
  drawn by one painter (boxes per colour, frame titles, no connectors), so
  zooming and panning an entire workshop board stays smooth; selecting by
  click still works for notes, shapes and text (frames by their title band
  and border, as at every zoom, and at this zoom also by the painted title
  rectangle above the frame; a note or shape painted over a frame title wins,
  and a frame title wins over a neighbouring frame's border). Connectors are not drawn at this zoom and
  are skipped by a click and by the selection rectangle; Ctrl+A and Tab still
  select them.

### New in M1 stage 3

- **Moderation** for the owner and everyone with **Can facilitate**. The
  moderation menu in the top bar (on narrow screens the overflow menu) has
  "Start voting", "Timer" and "Bring everyone here" / "Stop presenting".
- **Dot voting:** the setup dialog sets the votes per person (1–99), "One vote
  per item" (on by default; off allows several votes on one item), the area
  (whole board, or the selected frame when exactly one frame is selected), the
  item types (notes, shapes, text) and an optional time limit. It counts live
  how many items can get votes; at 0, "Start voting" stays disabled. While a
  session runs, everybody sees the vote bar at the bottom with the votes left
  and the time. Editors on a computer switch between "Vote" and "Edit" with a
  button that names the mode it switches to (a session starts in "Vote");
  tablets, phones and people with "Can vote" or the voting link vote
  automatically. Items that can get votes carry an empty ring and the area is
  outlined; a click or a tap votes, a second tap on the same item within 400
  ms is ignored (a double tap counts once), and the list votes without aiming
  (on phones it opens as a bottom sheet at the start). On touch devices a
  small item is zoomed in first. A tap on an item that cannot get votes says
  why. Votes are not part of undo. Lowering or taking back a vote never fails
  at the limit, also when an undo brought back voted items and the budget is
  overdrawn. A vote on an item that an editor moves out of the voting area
  during the session keeps counting (votes left, results); the server still
  accepts taking it back, but in M1 the list and the canvas offer no control
  for items outside the area. Facilitators see only how many people voted,
  never a distribution; "End voting" asks first. Then the ranking opens once
  for everyone (top three highlighted, "Copy results" as plain text); "Show on
  board" puts the totals on the items and "Close results" clears bar and
  totals. A session with a time limit ends by itself; "+5 min" extends it.
- **Voting link:** a second link per board for people who should only view
  and vote, with its own QR code and "Show to the room" ("Scan to vote on
  this board"). Guests may leave their name empty (they appear as "Guest")
  and are told "Your votes are anonymous.".
- **Timer:** start (1/3/5/10/15 minutes or any duration up to 99:59), pause
  (only while it runs), resume, +1 and +5 minutes (also after the time ran
  out), stop. Every participant sees the same remaining time, measured against
  the server clock, also after a reload. At the end "Time's up" shows, with an
  optional sound (mute per browser) and screen reader announcements at the
  start, at 1 minute, at 10 seconds and at the end.
- **Following:** click a participant in the presence bar to follow their
  view; your own pan, zoom or Esc ends it. "Bring everyone here" makes
  everybody follow the presenter until "Stop presenting"; whoever leaves
  comes back with a tap on "{name} is presenting · Follow". During a vote the
  view never jumps under a finger: jumps wait while a finger is down and for
  1.5 s afterwards.
- **Navigation:** Shift+2 zooms to the selection; "Frames" in the zoom
  controls lists all frames and jumps to one.
- **Layout:** banners stand at the top, right below the top bar; the vote
  bar always docks at the bottom, with the toolbar and the zoom controls
  above it. Esc closes the voting setup and the timer dialog, also while the
  cursor is in one of their fields.
- **Narrow layout (≤ 600 px wide):** a one-line top bar, the presence bar as
  "+n", Share and the moderation entries in an overflow menu, the vote bar
  fixed to the bottom of the screen and at most one banner. On touch devices
  editors see "On this device you can view and vote. Editing works on a
  computer.".

### New in M1 stage 4

Stage 4 prepares the production release; apart from the right-click menu, the
German label "Schwenken" for the hand tool (it was "Verschieben") and faster
drawing of note shadows and voting badges in WebKit, it adds nothing visible.

- **Right-click menu** on the canvas (in "Edit" only): on items Cut, Copy,
  Duplicate, Delete, Bring to front, Send to back, Edit text (one item with
  text), Connect (two items) and Zoom to selection; on empty canvas Paste here
  (only over HTTPS, see [Known limits](#known-limits)), Add note here, Select
  all and Show everything. A right click on an item outside the selection
  selects it first; on empty canvas it clears the selection. While the canvas
  has the focus, the context-menu key or Shift+F10 opens it at the selection;
  with nothing selected, the board menu (the same as on empty canvas; screen
  readers announce it as "Board actions") opens in the middle of the canvas.
  Arrow keys, Home/End, Enter/Space and Esc work as in any menu, and the
  shortcut of each entry is shown. Inside an open text editor the browser's
  own menu stays. In the board menu a line under the entries shows how many
  items are on the board, for example "12 items on this board" (added
  after 0.2.0). The number is what this browser knows when the menu opens;
  it does not change while the menu is open. It is not a menu entry: the
  arrow keys skip it, and screen readers read it as the menu's description.
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
- **Release directory:** `dev/release.sh` writes the runtime folders only
  (no sources, tests or tools) plus an archive and its SHA-256, after
  checking that the built bundle matches the sources.

### New in the review round after stage 4 (P7)

The adversarial review round after stage 4 changed the following; none of it
needs a database migration, new state lives in Redis counters and app config.

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
- **Presence cap:** guests on a voting link can no longer push the presenter or
  the holder of a text lease out of the presence list.
- **Connection errors without an answer from Knorke** (a 403 or 404 from a
  proxy or firewall) no longer end the tab; it shows the connection notice and
  keeps trying. Closing a tab with unsent changes asks first, also when the
  board is frozen.
- **Voting:** the `+`/`−` control closes when the board moves and stays inside
  the board on narrow screens; quick clicks are no longer swallowed;
  "Show on the board" closes the list on phones; "Bring everyone here" keeps
  following after a short interruption.

### New after 0.2.0

- **Align, distribute and tidy up:** in "Edit", select at least two items
  and press "Align items" in the context bar. Its panel aligns their left
  edges, horizontal centres, right edges, top edges, vertical centres or
  bottom edges, and "Tidy up" puts the items on an exact grid with equal
  gaps, keeping the order of their rows and columns. From three items,
  "Distribute horizontally" and "Distribute vertically" make the gaps
  between neighbours equal; distributing does not tidy up, so a grid of
  notes loses its columns or rows (undo brings it back). Connectors, items
  inside a selected frame and locked items do not count (nor does a group
  with a locked member), and a group counts as one item. Each click that
  moves something is one undo step; the selection and the panel stay.
- **Snapping to other items:** while you drag items, the edges and centre
  lines of what you drag snap to the edges and centre lines of the items in
  view, within 8 screen pixels at any zoom; a dashed magenta guide shows
  the line. A gap to a neighbour in the same row or column snaps to the gap
  between two other items there, and solid magenta markers show every gap
  of that size. Dragging a resize handle snaps the moving edges to the same
  lines (no gap markers): corners that keep the aspect ratio keep it
  exactly, and snapping never makes an item smaller than its minimum,
  larger than its maximum or flipped. A frame resized on its own snaps to
  its own content; text items snap only horizontally; a rotated item and
  several items that include a frame or a placeholder do not snap while
  resizing, and rotating does not snap to other items. Hold Ctrl (⌘ on a
  Mac, where Ctrl+click opens the right-click menu) to drag or resize
  freely; pressing or releasing it acts at once. Without a keyboard, a
  finger or a pen cannot switch snapping off; for a single item (not a
  group), "Arrange" sets an exact position or size. A small move of the
  last item of an evenly spaced row snaps back to where it was, and a
  small resize in a row of items of the same size snaps back to the
  item's size; the markers and guides show why. Only you see your guides
  and markers; the others see the snapped items without them (a move
  live, a resize when you let go).
- **Background grid:** "Show grid" in the right-click menu on the empty
  canvas (only in "Edit", right after "Show everything"), or the key G (in
  every mode, while the canvas has the focus) shows a grid behind all items:
  lines every 20 units (20 pixels at 100 % zoom), every fifth line darker;
  zoomed out, the grid gets five times coarser before its lines come closer
  than 10 screen pixels. A check mark in the menu shows the state. The
  setting belongs to this browser: it applies to every board, stays after a
  reload, and nobody else sees it. While the grid is shown, dragging puts
  the top-left corner of what you drag on the 20-unit grid, and dragging a
  resize handle puts the moving edge on it, at every zoom; snapping to
  other items wins on its axis. What does not snap to items while
  resizing (see above) does not snap to the grid either, nor does rotating;
  dragging a rotated item snaps its outer box. Creating items, arrow keys,
  "Arrange", paste and align never snap to the grid. Hold Ctrl (⌘ on a
  Mac) to drag or resize freely. "Snap to grid", right below "Show grid"
  while the grid is shown, is on by default; switched off, the grid stays
  visible without snapping. It is stored like the grid. A finger opens no
  menu: on a touch device, the grid needs a keyboard (G) or a pen, which
  opens the menu in "Edit"; without either, its snapping cannot be
  switched off.
- **Share notifications:** when the owner shares a board with an account, a
  group or a team, the recipients get a Nextcloud notification, for example
  "Alice Adler shared the board Retro Q3 with you" (German: "Alice Adler hat
  das Board Retro Q3 mit dir geteilt"). It shows in the bell, as a push
  message and in the e-mail digest of the Notifications app. Accounts get it
  at once; members of a group or team get it on the next run of Nextcloud's
  background jobs (cron), and groups and teams with more than 500 members
  get none. Disabled accounts and accounts without access to Knorke never
  get one, nor do accounts of the Guests app while that app's whitelist
  keeps Knorke out (see "Accounts of the Guests app" under
  [Known limits](#known-limits)).
  A click on the entry opens the board in the same tab. Changing a role,
  removing someone and links (creating, renewing, joining) send no
  notification, and the person who shares gets none. The board title and
  the owner's name are read when the notification is shown. When the share
  is gone, the recipient has left the group or team, or the board is
  deleted, the notification disappears the next time it would be shown,
  unless the recipient still has another share on the board (directly,
  through a group or through a team); a push message already on a phone
  stays. Sharing again replaces the earlier notification.
- **"Cannot open Knorke" in the share dialog:** in "Share" → "People",
  the owner sees this hint (German: "Kann Knorke nicht öffnen") below the
  name of each account that cannot open Knorke: accounts outside Knorke's
  "Limit to groups" on Nextcloud's Apps page, and accounts of the Guests
  app while that app's whitelist keeps Knorke out. It shows in the search
  results and in the list, also after saving and when the dialog is
  opened again. Such accounts get no share notification (see
  "Share notifications" above), so without the hint neither the owner nor
  the person would learn that the share does not work for them yet. The
  hint blocks nothing: the account can be added and saved with any role,
  and the share works as soon as an administrator lets the account open
  Knorke. The hint goes away the next time the dialog is opened. Do not
  count on a notification then; tell the person yourself, for example
  with "Copy board link". Groups and teams are never marked, even when
  some of their members cannot open Knorke.
- **Boards in Nextcloud's search:** Nextcloud's search (the magnifying
  glass in the top bar) lists boards under "Knorke boards" (German:
  "Knorke-Boards"). It finds a board when the search term is part of its
  title, upper and lower case alike, among the boards of your board list:
  your own, those shared with you (directly, through a group or through a
  team) and those you joined through a link. The content of a board is
  never searched. A hit shows the title and the owner ("by Alice Adler")
  and opens the board; the most recently created boards come first. A
  board you can no longer open is gone from the next search. Accounts
  outside Knorke's "Limit to groups" on Nextcloud's Apps page get no hits
  and do not see "Knorke boards" under "Places" in the search dialog; for
  accounts of the Guests app, see "Accounts of the Guests app" under
  [Known limits](#known-limits).
- **Locking:** in "Edit", everyone who may edit (the owner, "Can
  facilitate", "Can edit" and guests of the edit link) can lock items with
  "Lock" in the context bar or the right-click menu, or with Ctrl+Shift+L
  (⌘⇧L on a Mac). A lock symbol then sits on the item, in every mode. A
  locked item can still be selected, copied, connected and voted on, but
  nobody can move, resize, edit or delete it until it is unlocked, not even
  with a finger (it only moves along when someone moves the unlocked frame
  it is in, and each attached end of a locked connector still follows its
  item); a locked frame stays where it is, while its content stays free. A
  marquee and Ctrl+A (⌘A) skip locked items; Tab still reaches them.
  When you delete or cut a selection with locked items, the locked items
  stay and a notice says how many; undo and redo skip locked items with a
  notice too. Only the person who locked an item can unlock it with
  "Unlock"; facilitators (the owner and everyone with "Can facilitate") can
  unlock any item, and the entry names who locked it. Ctrl+Shift+L unlocks
  when nothing in the selection can be locked. Guests keep their locks when
  they come back in the same browser. Locking and unlocking are one undo
  step each.
- **Unlock all (facilitators):** the owner and everyone with "Can
  facilitate" can lift many locks at once in the right-click menu (only in
  "Edit"; a finger opens no menu). Right-click the empty canvas: "Unlock all
  in this frame" (when you right-click inside a frame) and "Unlock all" are
  the last two entries, after the grid entries. Right-click a frame's title
  band or edge for "Unlock all in this frame", and an item someone else
  locked for "Unlock all locked by {name}", right after "Unlock (locked by
  …)". With the keyboard, while the canvas has the focus, press Esc and then
  Shift+F10 (or the context-menu key) to open the menu in the middle of the
  canvas, or Tab to a frame or an item and press Shift+F10. Each entry shows
  only while there is something to unlock. "Unlock all" lifts every lock on
  the board; "Unlock all in this frame" lifts every lock of the frame and
  its content (locked connectors stay locked; "Unlock all" takes them too).
  Both lift your own locks as well, for example on frames you prepared. To
  lift one person's locks and keep your own, right-click one of their locked
  items and choose "Unlock all locked by {name}": it lifts that person's
  locks on the whole board and leaves every other lock, your own too. Each
  is one undo step, and a notice says how many items were unlocked; undo
  locks them again, now in your name, so the people who had locked them can
  no longer unlock them themselves (unless they are facilitators). If
  someone was quicker, choosing an entry when nothing is left to unlock
  shows "Nothing left to unlock.". A marquee and Ctrl+A (⌘A) still skip
  locked items, also for facilitators.
- **Grouping:** select notes, shapes or text items and press Ctrl+G (⌘G on
  a Mac), or use "Group items" in the context bar or the right-click menu;
  Ctrl+Shift+G (⌘⇧G) or "Ungroup" dissolves the whole group, also when
  only one of its members is selected. The context bar shows "Group items"
  while the selection holds at least two notes, shapes or text items that
  are not exactly one group, and "Ungroup" while it contains a grouped
  item: a selected group shows only "Ungroup", a group plus another note,
  shape or text item shows both, and so does a group, or one of its
  members, plus a frame, with "Group items" dimmed (frames cannot be
  grouped). With a finger, use the context bar; to
  select several items, hold a finger still on empty canvas until a ring
  appears, then drag over them (see "Selecting with a finger"). A group
  holds at least two items, all in the same frame or all outside frames;
  frames cannot be grouped, connectors are not members (a connector
  between two members moves along), and groups do not nest. A click on a
  member selects the whole group with one outline: it moves, resizes,
  copies and deletes as a whole and moves into or out of a frame as a
  whole. A second click selects only that member, and a double click
  edits its text. With the keyboard, Enter on a selected group selects one
  member, the one you clicked or reached with Tab, and opens its editor
  unless it is locked. Esc closes the editor, and Tab then reaches the next
  item in reading order, the next member when no other item lies in
  between (Tab inside a note's editor starts a new note instead, see
  "Keyboard"). Align, distribute and tidy up treat a group as one item, and
  copies of a group form a new group. Locking a group locks all its members,
  and a group with a locked member does not move as a whole. When deleting
  leaves one member, the group dissolves. Grouping is one undo step and
  applies to everyone on the board; votes stay per item.
- **Selecting with a finger:** in edit mode with the Select tool, hold a
  finger still on empty canvas for half a second (500 ms). A ring appears
  under the finger, and the device vibrates briefly where the browser can.
  Then drag: the frame selects like a frame dragged with the mouse and
  replaces the selection. A finger that moves at once still pans, two
  fingers still zoom, and a finger on an item selects and drags it as
  before. Holding without dragging changes nothing; a second finger or Esc
  ends the frame. A pen or a mouse takes precedence over every finger (for
  example a palm resting on the screen): while the pen touches the board or
  the left mouse button is held down, fingers neither pan, zoom nor select,
  and a finger that was already down gets no ring or loses it and stays
  without effect until it lifts. The pen or mouse works as usual; a new note or
  connector appears at the pen, not under the palm. There is no button for
  it.

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

Requirements: Nextcloud 34 or 35, PHP 8.2–8.5, PostgreSQL, MySQL/MariaDB or
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
cp -r appinfo css img js l10n lib templates LICENSE README.md CHANGELOG.md <nextcloud>/custom_apps/knorke/
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

## Building

```
npm ci              # exactly the versions of package-lock.json (Node.js 22.18, npm 10.9)
npm run build       # js/knorke-main.mjs + js/vendor-*.chunk.mjs + js/canvas-*.chunk.mjs + css/knorke-style.css
```

`npm run build` also runs `build/check-bundle.mjs`, which fails when the bundle
has a different shape or grows beyond 350 KiB gzipped. In the development
stacks, build only through `dev/build.sh` (it takes a lock and bumps the
theming cache buster of every running stack; script URLs carry that buster, not
the app version).

## Tests

```
npm test                                   # node --test 'tests/js/**/*.test.mjs'
npm run l10n:check                         # translations complete, no orphans
tests/php/run.sh unit                      # PHPUnit in a throwaway container
KD_NS=b tests/php/run.sh integration       # PHPUnit against a dev stack
KD_NS=d dev/sim/run.sh contract            # HTTP contract C01–C87 (any database; cases that do not apply are reported as skipped)
KD_NS=d dev/sim/run.sh converge            # 6 clients, 30 s (SQLite 45 s), fault injection, shapes/text/transforms/keep/connectors, 0 deviations (any database)
KD_NS=d dev/e2e/run.sh                     # browser acceptance E01–E45 + E04b, E09b, E09c and the passes E28/E31/E33@390x844 and @820x1180 (Playwright 1.49.1 in a container; E24 also in WebKit and Firefox, E37 step 4 in WebKit as a report)
KD_NS=d dev/selftest/restore.sh            # restore probe of the epoch runbook (PostgreSQL only); report restore-pgsql[-<KD_RUN_LABEL>].md
dev/release.sh                             # release directory dev/release/out/knorke-<version>/ with archive and SHA-256
dev/selftest/upgrade.sh --db pgsql         # upgrade M0 → M1 with seeded data in a throwaway stack (namespace br); reports upgrade-<db>-{seed,verify,contract}[-<KD_RUN_LABEL>].md
KD_NS=d dev/e2e/run.sh --only E03,E04,E04b --repeat 8   # flake gate: 8 runs, each in a fresh world (stages 4 and P7: --only E34,E35,E37,E38 --repeat 8)
node --test 'dev/sim/*.test.mjs' 'dev/e2e/*.test.mjs' 'dev/selftest/*.test.mjs' 'dev/scene-lab/test/*.test.mjs'   # harness self-tests, no stack
dev/scene-lab/run.sh                       # scene lab gates
```

Always pass `node --test` quoted globs, never a directory. Dev stacks run on
PostgreSQL 17 by default; `KD_DB=mariadb|mysql|sqlite dev/up.sh` starts the same
stack on MariaDB 11.8, MySQL 8.4 or SQLite (`KD_MYSQL_UTF8MB4=0` emulates a legacy
install without 4-byte UTF-8). The convergence run and the contract suite run
everywhere; the contract suite reports C24 and C67 (need `pg_stat_statements`), C37
(needs 4-byte UTF-8) or C48 (needs a database without it) as skipped, and the
browser run skips E06 off PostgreSQL. Nextcloud's rate limits of the share
and moderation routes live in Redis across runs; the contract suite, the
sharing cases and the moderation cases clear them first (host bridge action
`ratelimit-reset`). The voting cases let a session expire without waiting
(host bridge action `vote-expire`). During M1 the agents work in a copy of the
repository; the user's own test stack (namespace `try`) is protected, and at
most five dev stacks run next to it. Database and Redis sit on an internal Docker network,
and Redis requires a password. Reports go to `dev/e2e/out/<namespace>/` and
`dev/sim/out/<namespace>/`. The dev stack (`dev/up.sh`, `dev/down.sh`,
namespaces, host bridge, traps on this setup) is described in German in
[`docs/ENTWICKLUNG.md`](docs/ENTWICKLUNG.md). Host-specific values (DNS server
for the containers, the host's LAN address for the iPad session, the path of
the production stack) go into the untracked `dev/local.env` (template
`dev/local.env.example`); without it the scripts use neutral defaults.

## Licences

Knorke is licensed under AGPL-3.0-or-later, see [`LICENSE`](LICENSE). Every
source file carries the matching SPDX header.

The JavaScript bundle contains third-party code under these licences:

| Package | Licence |
|---|---|
| [Konva](https://konvajs.org/) 10.7.1 | MIT |
| [rbush](https://github.com/mourner/rbush) 4.0.1 | MIT |
| [quickselect](https://github.com/mourner/quickselect) 3.0.0 | ISC |
| [fractional-indexing](https://github.com/rocicorp/fractional-indexing) 4.0.0 | CC0-1.0 |
| [Vue](https://vuejs.org/) 3.5 | MIT |
| @nextcloud/vue | AGPL-3.0-or-later |
| @nextcloud/l10n, @nextcloud/router, @nextcloud/initial-state, @nextcloud/auth | GPL-3.0-or-later |

Most icons in `src/components/icons.js` are SVG path data copied unchanged
from [Material Design Icons](https://pictogrammers.com/library/mdi/) 7.4.47
(Pictogrammers), licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0); the rest are
simple outlines drawn for Knorke itself (AGPL-3.0-or-later like the rest of the
code). They end up in the JavaScript bundle. Each MDI key is one MDI icon:

| Key in `icons.js` | MDI icon |
|---|---|
| `plus` | `mdi-plus` |
| `minus` | `mdi-minus` |
| `pencil` | `mdi-pencil` |
| `trash` | `mdi-trash-can-outline` |
| `share` | `mdi-share-variant` |
| `back` | `mdi-arrow-left` |
| `select` | `mdi-cursor-default` |
| `hand` | `mdi-hand-back-right` |
| `sticky` | `mdi-sticker-outline` |
| `frame` | `mdi-rectangle-outline` |
| `undo` | `mdi-undo` |
| `redo` | `mdi-redo` |
| `fit` | `mdi-fit-to-screen-outline` |
| `front` | `mdi-arrange-bring-to-front` |
| `back2` | `mdi-arrange-send-to-back` |
| `copy` | `mdi-content-copy` |
| `refresh` | `mdi-refresh` |
| `link` | `mdi-link-variant` |
| `board` | `mdi-view-dashboard-outline` |
| `account` | `mdi-account-outline` |
| `cut` | `mdi-content-cut` |
| `duplicate` | `mdi-content-duplicate` |
| `chevronDown` | `mdi-chevron-down` |
| `check` | `mdi-check` |
| `lock` | `mdi-lock` |
| `unlock` | `mdi-lock-open-variant` |
| `groupItems` | `mdi-group` |
| `ungroup` | `mdi-ungroup` |
| `alignLeft` | `mdi-format-align-left` |
| `alignCenter` | `mdi-format-align-center` |
| `alignRight` | `mdi-format-align-right` |
| `alignItemsLeft` | `mdi-align-horizontal-left` |
| `alignItemsCenter` | `mdi-align-horizontal-center` |
| `alignItemsRight` | `mdi-align-horizontal-right` |
| `alignItemsTop` | `mdi-align-vertical-top` |
| `alignItemsMiddle` | `mdi-align-vertical-center` |
| `alignItemsBottom` | `mdi-align-vertical-bottom` |
| `distributeHorizontal` | `mdi-distribute-horizontal-center` |
| `distributeVertical` | `mdi-distribute-vertical-center` |
| `tidyUp` | `mdi-view-grid` |
| `connector` | `mdi-arrow-top-right` |
| `qrcode` | `mdi-qrcode` |
| `group` | `mdi-account-group` |
| `eye` | `mdi-eye` |
| `eyeOff` | `mdi-eye-off` |
| `close` | `mdi-close` |
| `dotsVertical` | `mdi-dots-vertical` |
| `timer` | `mdi-timer-outline` |

Own drawings (M1 stage 1: shape kinds, tools, style controls, and the
connector routes, tips, label, "Connect" and line width of round 1b; stage 2:
team, "Show to the room" and the password generator; stage 3: voting, the
moderation menu and "Zoom to selection"):

| Key in `icons.js` | Origin |
|---|---|
| `team` | own drawing |
| `vote` | own drawing |
| `facilitate` | own drawing |
| `zoomSelection` | own drawing |
| `present` | own drawing |
| `dice` | own drawing |
| `shape` | own drawing |
| `text` | own drawing |
| `rect` | own drawing |
| `roundRect` | own drawing |
| `ellipse` | own drawing |
| `diamond` | own drawing |
| `triangle` | own drawing |
| `arrowRight` | own drawing |
| `arrange` | own drawing |
| `valignTop` | own drawing |
| `valignMiddle` | own drawing |
| `valignBottom` | own drawing |
| `dashSolid` | own drawing |
| `dashDashed` | own drawing |
| `dashDotted` | own drawing |
| `fill` | own drawing |
| `border` | own drawing |
| `textColor` | own drawing |
| `routeStraight` | own drawing |
| `routeElbow` | own drawing |
| `routeCurved` | own drawing |
| `capNone` | own drawing |
| `capArrow` | own drawing |
| `capTriangle` | own drawing |
| `capDot` | own drawing |
| `capDiamond` | own drawing |
| `label` | own drawing |
| `connect` | own drawing |
| `lineWidth` | own drawing |

The validity check for z-order keys in `lib/Service/ZOrder.php` and
`src/model/zorder.js` is a port of `validateOrderKey` from fractional-indexing
(CC0-1.0).

Knorke is an independent project and is not affiliated with any other product
or company of a similar name.

## Known limits

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
- **Daily byte quotas.** A board accepts at most 256 MiB of sync requests with changes per day (UTC) and an account at most 512 MiB over all its boards; guests count towards the board only (app config `budget_bytes_board_day`, `budget_bytes_user_day`; 0 switches a quota off). Above a quota, changes wait and are retried about once a minute until the next day starts ("Changes are being saved more slowly. Nothing is lost."); they are kept as long as the tab stays open. The change log of a board is cut back to 64 MiB in the nightly clean-up (`changes_bytes_cap`), deleted items keep a tombstone without their content, and PostgreSQL keeps freed space for reuse instead of giving it back to the file system. Without Redis there are no quotas.
- **Deleting accounts or groups while Knorke is disabled.** Knorke removes the shares, link memberships, open votes and boards of a deleted account or group when Nextcloud reports the deletion. A disabled app gets no such report, so an account or group created later with the same name would inherit them. Run `occ knorke:orphans --dry-run` and then `occ knorke:orphans` after every `occ app:enable knorke` and after Nextcloud major upgrades; the daily clean-up job also removes them when it finds the same account or group missing again at least 20 hours after the first time.
- **Votes from two tabs.** One person voting in two tabs or on two devices at the same time can lose a vote when more than one vote per item is allowed (the last change wins). With one vote per item, the default, this does not happen.
- **Revoked rights do not remove votes.** Votes cast before a share or link is removed keep counting in the running vote. A "Bring everyone here" started by a facilitator who then loses the right stays until the owner or another facilitator ends it; followers drop out once the presenter's tab has been gone for 10 seconds.
- **iPad and Safari have not been measured on real hardware.** Rendering was
  measured on a high-end Android tablet (Chrome, measurement R-A: zooming over
  the whole board at 59.7 fps with 0 % missed frames, first render within
  361 ms); the touch path is built and tested in Chromium and headless WebKit
  only. A measurement on a real iPad is planned for a later version. Until
  then, large boards may draw more slowly on iPads, and keeping the screen on
  during a vote or timer has not been checked there.
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
- **Sharing policy (stage 2):** Knorke follows Nextcloud's sharing settings for
  the board's owner. With sharing turned off for the owner (globally or through
  an excluded group) nobody can be added, no role raised and no link created,
  renewed or loosened; removing, lowering, adding a password or an earlier
  expiry and turning a link off still work, and existing shares and links keep
  working (like Nextcloud's own shares). Group sharing off blocks new group
  shares and raising a group's role; "only share with group members" applies to
  new entries. A policy change never revokes existing shares.
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
- **Nextcloud's link-sharing policy** is honoured for the board's owner: the
  global "Allow users to share via link" and its group exclusion (the owner's
  groups count, never the visitor's). While links are not allowed, nobody can
  create or renew a link, guests and signed-in users cannot join or open a
  board through it, and members who joined through the link lose access.
  Nothing is revoked: allowing links again restores the link, its members and
  its guests. An admin's change reaches open boards within 120 s (Knorke's
  Redis cache) plus Nextcloud's 3-second app-config cache. There is no
  separate Knorke admin switch.
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
- **Copy and paste** works between Knorke boards; pasting needs the keyboard
  (there is no "Paste" button; the only exception is "Paste here" in the
  right-click menu, see below). Because Ctrl/⌘+Shift+V delivers only plain text
  in Chromium and Firefox, every copy also keeps the copied items for 10 minutes
  in the browser's local storage (`knorke.clip`) of the Nextcloud origin; the
  guest page deletes it when it is left. Up to 1000 items per paste.
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
- **Tablets and voters are invisible.** Tablets, phones and everyone voting
  send no presence, so they do not appear in the presence bar ("People on
  tablets or voting don't appear here.") and "{n} voted" has no total to
  compare with. Tablets follow a presenter in jumps about every 2 seconds
  (they poll every 2 s to spare the edge rate limit).
- **Moderation limits:** 120 moderation actions per 10 minutes per
  facilitator; a vote session allows 1–99 votes per person and at most 1440
  minutes, the ranking keeps the top 500 items; the timer runs at most 99:59.
- Not yet: minimap, search within a board, mind maps, templates, export,
  comments, images, rich text, activity log, undo across reloads.
- Right-click menu: Firefox always shows its own menu on Shift+right-click (the page never sees it); Mac keyboards have no context-menu key, Shift+F10 may need fn, and Ctrl+click works as a right click; a finger opens no menu, not even with a long press (in edit mode with the Select tool, a finger held still on empty canvas starts a selection frame instead; see "Selecting with a finger"); tablets view and vote.
- Paste here (right-click menu) reads the clipboard through the browser's clipboard API. It only appears over HTTPS (or on localhost), and the browser decides: Chrome and Edge ask once for permission, Firefox may show a small “Paste” button that has to be clicked, Safari may show a “Paste” bubble. If the browser refuses, Knorke says so and pastes nothing; Ctrl+V (⌘V on a Mac) always works and pastes at the mouse pointer.

- Guests see the display names of signed-in participants (never user IDs or
  e-mail addresses).
- The guest page of a cold browser makes many requests that belong to
  Nextcloud itself; the count is measured per release (scenario E12).
