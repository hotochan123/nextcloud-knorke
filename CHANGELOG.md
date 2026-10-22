<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

All notable changes to Knorke are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Data foundation for grouping and locking (M2), on which "Lock items" and
  "Group items" below build. The app version goes from 0.2.0 to 0.3.0 and
  **needs one `occ upgrade`**: a new migration adds the nullable columns
  `group_id`, `locked_by` and `locked_name` to `knorke_items` (plus the
  index `knorke_items_group`); existing boards keep every item. Snapshot,
  guest join and the slow sync path now give every item for every role the
  two keys `group` and `lock`, each `null` while the item is not grouped or
  not locked (`lock` is `{"by": <pid>, "name": <display name>}`; `by` is
  the per-board pid, never a user id). The protocol stays at 2. A `put`
  that sets `lock` to anything but `null` is answered with `bad`: an item
  is locked with a `patch` (see "Lock items"), and a `put` may carry
  `group` (see "Group items"). The client keeps both fields in its replica
  and scene model.
- Right-click menu on the empty canvas ("Board actions"): a line under the
  entries shows how many items are on the board, for example "12 items on
  this board" (German: "12 Objekte auf diesem Board"). The number is what
  this browser knows when the menu opens; it does not change while the menu
  is open. The line is not a menu entry: the arrow keys skip it, screen
  readers read it as the menu's description, and a press on it keeps the
  focus in the menu. The keyboard path shows the line too: with the canvas
  focus and nothing selected, the context-menu key or Shift+F10 opens this
  menu in the middle of the canvas. Test hook `data-knorke-menu-count` with
  the number.
- Align the selection: when at least two items are selected (connectors,
  items inside a selected frame, locked items and the members of a group
  with a locked member do not count; a group selected as a whole counts as
  one item), the context bar shows "Align items" (German: "Objekte
  ausrichten"). Its panel has six commands: align left edges, horizontal
  centers, right edges, top edges, vertical centers and bottom edges. The
  items move to that edge or center line of the box around all of them (a
  rotated item counts with its outer box); only one direction changes.
  Connectors stay where they are (bound ends follow their items), items
  inside a selected frame move with their frame, and an item joins or
  leaves a frame as when dragging. Each click that moves something is one
  undo step; the selection and the panel stay, so another edge can be
  tried right away. When every item is already in place (within 0.01 world
  units; one world unit is one pixel at 100 % zoom), a click changes
  nothing and adds no undo step. Test hooks `data-knorke-action="align"`
  and `data-knorke-align` (`left`, `center`, `right`, `top`, `middle`,
  `bottom`).
- Distribute the selection: when at least three items are selected
  (counted as for "Align items"), the "Align items" panel shows a third
  row with "Distribute horizontally" and "Distribute vertically" (German:
  "Horizontal verteilen", "Vertikal verteilen"). The two outermost items
  stay where they are; the items between them move so that the gaps
  between neighbouring items are equal (a rotated item counts with its
  outer box). When the items overlap too much for that, their centers get
  equal distances instead. Only one direction changes. Distributing
  handles every item on its own and does not tidy up a grid: a grid of
  notes distributed horizontally loses its columns, its rows end up offset
  from each other, and notes of a row can overlap; distributed vertically,
  it loses its rows the same way (undo brings the grid back). Connectors
  stay where they are (bound ends follow their items), items inside a
  selected frame move with their frame, and an item joins or leaves a
  frame as when dragging. Each click that moves something is one undo
  step; the selection and the panel stay. When the items are already
  distributed (each within 0.01 world units of its place), a click changes
  nothing and adds no undo step. Test hook `data-knorke-distribute`
  (`horizontal`, `vertical`).
- Tidy up the selection: the "Align items" panel ends with a row holding
  "Tidy up" (German: "Aufräumen"), shown from two selected items (counted
  as for "Align items"). It puts the items on an exact grid.
  Two items share a row when the center of one lies within
  the height of the other, the same goes for columns, and
  every cell holds at most one item. Rows and columns keep
  their order, empty cells stay empty, each item is centered in its cell
  (a rotated item counts with its outer box), and the top-left corner of
  the selection stays (rounded to whole world units). All columns get the
  same gap, and so do all rows: about the mean of the current gaps, in
  whole world units, so a loose grid stays loose and a dense one dense.
  Anything else becomes a grid too: a dense pile of notes turns into one
  long row, and a heading above a grid widens one column (undo brings
  everything back). Connectors stay where they are (bound ends follow
  their items), items inside a selected frame move with their frame, and
  an item joins or leaves a frame as when dragging. Each click that moves
  something is one undo step; the selection and the panel stay. A second
  click on the tidied items changes nothing and adds no undo step. Test
  hook `data-knorke-action="tidy"`.
- Snapping to other items: while you drag items, the left, center and
  right lines and the top, middle and bottom lines of their outer box snap
  to the same lines of the items in view, within 8 screen pixels at any
  zoom (a rotated item counts with its outer box, a frame without its
  title band); a dashed magenta guide shows the line. A gap to a
  neighbour in the same row or column snaps to the gap between two other
  items there, and solid magenta markers show every gap of that size.
  Dragging a resize handle snaps the moving edges to the same lines,
  without gap markers: corners that keep the aspect ratio keep it exactly,
  and snapping never makes an item smaller than its minimum, larger than
  its maximum or flipped. A frame resized on its own snaps to its own
  content; text items snap only horizontally; a rotated item and several
  items that include a frame or a placeholder do not snap while resizing,
  and rotating does not snap to other items. Hold Ctrl (⌘ on a Mac) to drag
  or resize freely; pressing or releasing it acts at once. Without a
  keyboard, touch and pen cannot switch snapping off ("Arrange" sets exact
  values for a single item, not a group). A small move of the last item of
  an evenly spaced row snaps back to where it was (nothing changes), and a
  small resize in a row of items of the same size snaps back to the item's
  size. Only the person dragging sees the guides and markers; a drag or a
  resize stays one undo step. Debug counters
  `window.__knorke.scene().snapGuides` and `.gapMarkers`.
- Background grid: "Show grid" (German: "Raster anzeigen") in the
  right-click menu on the empty canvas (only in "Edit", right after "Show
  everything"), or the key G while the canvas has the focus (in every mode;
  not with Shift, Alt or Ctrl/⌘, not on key repeat) shows a grid behind all
  items: lines every 20 world units, every fifth line darker; zoomed out,
  the drawn grid gets five times coarser before its lines come closer than
  10 screen pixels. The menu entry has a check mark while the grid is on
  (every entry of that menu leaves room for it). The setting is stored in
  this browser for every board and stays after a reload; nobody else sees
  it. While the grid is shown, dragging puts the top-left corner of the
  dragged items' outer box on the 20-unit grid, and dragging a resize
  handle puts the moving edge nearest to a grid line on it, at every zoom
  (zoomed out also between the drawn lines). Snapping to other items wins
  on its axis; the grid draws no guides. A rotated item and several items
  that include a frame or a placeholder do not snap to the grid while
  resizing, and text items snap only horizontally; rotating does not snap to
  the grid, and dragging a rotated item snaps its outer box. Creating items,
  arrow keys, "Arrange", paste, align and connector ends do not snap to the
  grid. Hold Ctrl (⌘ on a Mac) to drag or resize freely. "Snap to grid"
  (German: "Am Raster ausrichten"), right after "Show grid" and listed
  only while the grid is shown, is on by default; switched off, the grid
  stays visible without snapping, and only switching it off is stored.
  Debug values `window.__knorke.scene().grid`, `.gridSnap` and
  `.draws.grid`.
- Share notifications: when the owner shares a board with an account, a
  group or a team, the recipients get the Nextcloud notification "{owner}
  shared the board {title} with you" (German: "{owner} hat das Board
  {title} mit dir geteilt"), for example "Alice Adler shared the board
  Retro Q3 with you". It shows in the bell, as a push message and in the
  e-mail digest of the Notifications app. Accounts get it at once; members
  of a group or team get it on the next run of Nextcloud's background jobs
  (cron). Groups and teams with more than 500 members get none; Knorke
  logs "Knorke: share notification skipped, too many members" (level
  `info`) instead. A click on the entry opens the board in the same tab.
  Changing a role, removing a share and links (creating, renewing,
  joining) send no notification, and the person who shares gets none.
  There is one notification per recipient and board: sharing again
  replaces the earlier one. Only IDs are stored; the board title and the
  owner's name are added when the notification is shown. At that moment
  Knorke checks that the recipient may still use the app, the board still
  exists and the recipient still has a share on it (directly, through a
  group or through a team); otherwise Nextcloud deletes the notification
  (share removed, group or team left, board deleted). In background jobs
  (cron, also a long-running `occ background-job:worker`) Knorke reads the
  recipient's groups straight from the group backends each time, not from
  Nextcloud's cache that such a worker never clears: a group left counts at
  once, and a member who just joined keeps the notification (as fresh as
  the group backend; LDAP keeps its own cache). A push message already on a
  phone stays. If a group backend (for example LDAP) fails with an error
  while the background job reads the members of a group, the members get
  no notification at all, not even in the bell, and the job is not
  retried; Knorke logs "Knorke: share notification fan-out failed". If a
  group backend fails with an error while Knorke checks a notification
  before showing it, Knorke logs
  "Knorke: preparing a share notification failed" and keeps the
  notification; it shows in the bell once the backend answers again. A
  push message missed this way is not sent later, and the e-mail digest
  may leave it out. No new route, no migration; it needs the Notifications
  app that comes with Nextcloud.
- Share dialog, "Cannot open Knorke": in "Share" → "People", the owner
  sees this hint (German: "Kann Knorke nicht öffnen") below the name of
  each account that cannot open Knorke, in the search results and in the
  list, also after saving and when the dialog is opened again. These are
  accounts outside Knorke's "Limit to groups" on Nextcloud's Apps page
  and accounts of the Guests app while that app's whitelist keeps Knorke
  out; when Knorke cannot ask the Guests app, its accounts count as kept
  out. Until now, neither the owner nor the person learned that the share
  does not work for them yet, because such accounts get no share
  notification. Saving stays allowed with every role, and the share works
  once an administrator lets the account open Knorke. Groups and teams are
  never marked, even when some of their members cannot open Knorke. The
  answers of GET and PUT `/api/v1/boards/{id}/shares` and of the
  recipient search `GET /api/v1/boards/{id}/sharees` carry
  `"appAccess": false` for such accounts only; the PUT body stays as it
  was. No new route, no migration; the protocol stays at 2.
- Boards in Nextcloud's unified search: the new section "Knorke boards"
  (German: "Knorke-Boards") lists the boards whose title contains the
  search term, upper and lower case alike, among the boards of the
  account's board list: its own, those shared with it (directly, through a
  group or through a team) and those it joined through an edit or voting
  link. Board content (items, frame titles) is never searched. A hit shows
  the title and the owner ("by {owner}", German: "von {owner}") and opens
  the board; the most recently created boards come first, at most 25 per
  request (further pages through the cursor of Nextcloud's search API).
  Each hit is checked as when the board is opened, so a board the account
  can no longer open (share removed, link revoked, renewed or expired,
  board deleted) is gone from the next search. Accounts outside Knorke's
  "Limit to groups" on Nextcloud's Apps page get no hits and do not see
  "Knorke boards" under "Places" in the search dialog. For accounts of the
  Guests app, see the entry "Accounts of the Guests app" under Fixed. No
  new route, no migration; the protocol stays at 2.
- Lock items: in "Edit", everyone who may edit (the owner, "Can facilitate",
  "Can edit" and guests of the edit link; not "Can vote" or "Can view") can
  lock one or more items (frames, notes, shapes, text items, connectors)
  with "Lock" (German: "Sperren") in the context bar or the right-click menu
  and unlock them with "Unlock" (German: "Entsperren"). Ctrl+Shift+L (⌘⇧L on
  a Mac) toggles: it locks while something in the selection can be locked,
  else it unlocks what you may unlock; when only other people's locks are
  left and you are not a facilitator, it shows "Only the person who locked
  it or a facilitator can unlock it." Locking and unlocking are one undo
  step each, and the selection stays. A locked item can still be selected,
  copied, connected and voted on, but nobody moves, resizes, edits or
  deletes it until it is unlocked, not even facilitators, and a finger
  cannot move it either. A locked frame stays where it is, while its content
  stays free; a locked item inside an unlocked frame moves along when
  someone moves the frame. Every locked item shows a lock symbol, in every
  mode and at every zoom (zoomed far out, connectors are not drawn at all).
  The context bar shows who locked the selection: "Locked by you", "Locked
  by {name}", "Locked, locker unknown", or the number of locked items when
  several people locked them. A lock belongs to the person who set it, and
  only they unlock it; facilitators (the owner and everyone with "Can
  facilitate") unlock any lock, and the entry names whose it is: "Unlock
  (locked by {name})", "Unlock (locker unknown)" when no locker has a name,
  or "Unlock (locked by several people)". The marquee and Ctrl+A (⌘A) skip
  locked items for every role (a marquee with Shift keeps what was
  selected); Tab still reaches them, which is the keyboard way to "Unlock".
  In a selection with locked items, editing acts only on the unlocked ones
  (copy, connect and zoom to selection act on all). Deleting or cutting such
  a selection leaves the locked items selected and names their number, for
  example "2 locked items were not deleted."; undo and redo skip changes to
  locked items, for example "2 locked items were skipped.". When the server
  answers `itemlocked` (the item was locked in the meantime), a notice like
  "2 locked items were not changed." shows, and text goes to the text rescue
  with "Not saved: this item is locked. Copy your text before closing.";
  editing also ends with this notice when the item of the open editor gets
  locked. Guests keep their locks when they come back in the same browser,
  also through a renewed link; in a new browser only facilitators unlock
  them. The locks of a deleted account stay ("Locked, locker unknown"), and
  only facilitators unlock them. On the wire, an item is locked with a
  `patch` whose only key is `lock`: any non-empty object locks (it is
  checked like other values but not stored; the server records the sender as
  the locker), and `null` unlocks. A `put` with a `lock` other than `null`
  is answered with `bad`. Every change and every removal of a locked item
  gets `itemlocked`, also from a facilitator before unlocking; change rows
  carry `"lock":true` or `null`. The protocol stays at 2. No migration: the
  columns come with the data foundation above. Debug value
  `window.__knorke.scene().locks`; test hooks `data-knorke-action="lock"`
  and `"unlock"`, `data-knorke-lock-badge`, the menu entries `lock` and
  `unlock`, the toasts `lock-delete`, `lock-undo`, `lock-unlock` and
  `lock-held`.
- Unlock all for facilitators: the owner and everyone with "Can facilitate"
  can lift many locks at once in the right-click menu (only in "Edit", with
  a mouse, trackpad or pen; touch-only devices have no right-click menu).
  "Unlock all" (German: "Alles entsperren") lifts every lock on the board,
  of every kind. "Unlock all in this frame" (German: "Alles in diesem Frame
  entsperren") lifts the locks of a frame and of everything inside it, the
  frame's own lock included (connectors never count). "Unlock all locked by
  {name}" (German: "Alles von {name} entsperren") lifts every
  lock of that person on the whole board, not only in one frame, and leaves
  all other locks, the facilitator's own included; "Unlock all" and "Unlock
  all in this frame" lift the facilitator's own locks too, for example on
  frames and items prepared for the workshop. In the menu of the empty
  canvas, "Unlock all in this frame" (for the frame under the pointer; the
  inside of a frame counts as empty canvas) and "Unlock all" are the last
  two entries, after the grid entries. A right-click on a frame's title band
  or edge, or Tab to the frame and Shift+F10, shows "Unlock all in this
  frame" after the lock entries; on an item someone else locked
  (right-click, or Tab and Shift+F10), "Unlock all locked by {name}" comes
  right after the "Unlock (locked by …)" entry. With the keyboard, while the
  canvas has the focus, Esc (which clears the selection) and then Shift+F10
  or the context-menu key open the menu of the empty canvas in the middle of
  the canvas, and "in this frame" means the frame there. An entry shows only
  while there is something to unlock when the menu opens. A right-click
  inside a frame you prepared and locked offers only the two broad entries,
  and "Unlock all in this frame" would lift your own locks there too; to
  lift one person's locks and keep your own, right-click one of their locked
  items and choose "Unlock all locked by {name}", which lifts that person's
  locks on the whole board. The items are counted again on the click; when
  someone was quicker and nothing is left, "Nothing left to unlock."
  (German: "Nichts mehr zu entsperren.") shows. Otherwise it is one undo
  step of plain `{"lock": null}` patches, sent at most 200 per request
  within the write budget (a busy server is retried, nothing is lost); the
  selection stays, and a notice names the number, for example "12 items
  unlocked" (German: "12 Objekte entsperrt"). Undo locks the items again,
  but in the facilitator's name: the original lockers cannot be restored,
  because the server records whoever locks. There is no shortcut and no
  confirmation, and the entries are neither in the context bar nor in the
  "Facilitate" menu. The marquee and Ctrl+A (⌘A) still skip locked items for
  every role, facilitators too. The server rule is unchanged: only
  facilitators (`canModerate()`) lift someone else's or an unknown lock. The
  protocol stays at 2; there is no new op and no new route. Test hooks: the
  menu entries `unlock-all`, `unlock-frame` and `unlock-by`, the toasts
  `unlock-all` and `unlock-none`.
- Group items: select notes, shapes or text items and press Ctrl+G (⌘G on
  a Mac), or use "Group items" (German: "Gruppieren") in the context bar or
  the right-click menu; Ctrl+Shift+G (⌘⇧G) or "Ungroup" (German:
  "Gruppierung aufheben") dissolves the whole group, also when only one of
  its members is selected. The context bar shows "Group items" while the
  selection holds at least two notes, shapes or text items that are not
  exactly one group, and "Ungroup" while it contains a grouped item: a
  selected group shows only "Ungroup", a group plus another note, shape or
  text item shows both, and so does a group, or one of its members,
  plus a frame, with "Group items" dimmed (frames cannot be grouped).
  With a finger, use the context bar; to select
  several items, hold a finger still on empty canvas until a ring
  appears, then drag over them (see "Selecting with a finger" below). A
  group holds at least two items, all in the same frame or all outside
  frames; frames cannot be grouped, connectors are not members (a
  connector between two members moves along), and groups do not nest:
  grouping a selection that contains groups makes one new group of
  all their members. When the selection cannot be grouped (a frame, a
  locked item, items in different frames), "Group items" is dimmed, its
  tooltip names the reason, and pressing it or Ctrl+G shows the reason
  instead; "Ungroup" does the same for a group with a locked member. A
  click on a member selects the whole group with one outline: it moves,
  resizes (keeping its proportions), copies and deletes as a whole, and
  dragging it moves it into or out of a frame as a whole. A second click
  selects only that member, a double click edits its text. With the
  keyboard, Tab selects a group like a click, and Enter on a selected group
  first selects one member, the one you clicked or reached with Tab, and
  then opens its editor unless it is locked; once Esc has closed the editor,
  the next Tab reaches the next item in reading order, the next member
  when no other item lies in between (Tab inside a note's editor starts
  the next note to its right instead). Align, distribute and tidy up treat a
  group as one item; copy, paste and duplicate make a new group of the
  copies, and undo of a delete brings the members back grouped. Locking a
  selected group locks every member; a group with a locked member does not
  move or resize as a whole. When deleting leaves a group with one member,
  the group dissolves; the server makes sure of that even when several
  people delete at the same time, also for a locked member. Grouping and
  ungrouping are one undo step each, apply to everyone on the board and
  work for guests of the edit link as for other editors; votes stay per
  item. The protocol stays at 2: a `put` may now carry `group` and a
  `patch` may set the path `group` (`null` or a ULID; notes, shapes and
  text items only; not together with `lock`), both answered with `bad`
  before. No migration: the column comes with the data foundation above.
  Debug value `window.__knorke.scene().groupOutlines`; test hooks
  `data-knorke-action="group"` and `"ungroup"`, the menu entries `group`
  and `ungroup`, the toast `group-blocked`.
- Selecting with a finger: in edit mode on a touch device (one that also
  reports a fine pointer, e.g. a pen), with the Select tool, hold a finger
  still on empty canvas for 500 ms (half a second). A ring of 120 pixels
  then appears under the finger, and the device vibrates for 20 ms where
  the browser can. Dragging more than 10 pixels then draws a frame that
  selects like a frame dragged with the mouse (without Shift) and replaces
  the selection; the board does not move. Unchanged: a finger that moves
  at once pans, a finger on an item drags it, and the hand tool, the create
  tools and the vote and view modes work as before. Releasing keeps the
  selection; a second finger, Esc, `pointercancel` and a mode switch end
  the frame. A mouse or pen takes precedence over a finger held on empty
  canvas (a palm resting on the screen), and another contact that lands
  during a mouse or pen drag does not cancel that drag (together with the
  resting palm it can still pan or zoom the board). Forced colors and
  reduced motion (the ring shows without its fade-in) are covered. There is
  no new button and no new text, and a long press still opens no menu.
  Debug value `window.__knorke.scene().holdRing`; test hook
  `data-knorke-hold-ring`.
- Privacy notice for guests and on boards open by link: the name dialog of
  guests shows a notice text and the link to the privacy policy above the
  name field; joining needs no extra click. A long text scrolls on its own
  (at most 30 % of the window height), and the links stay visible below it.
  People who can only vote get their own built-in wording ("Others on this
  board see neither your cursor nor how you vote."). A returning guest sees
  the notice once per browser tab as a card that can be closed. Signed-in
  accounts see the badge "Open by link" (German: "Per Link offen") in the
  top bar while an edit or voting link of the board is active, the owner
  too; a press opens the card with what guests can see. Once per board,
  account and device the card also appears by itself, never for the owner;
  it appears again when the link is switched on again or renewed.
  Administrators set the notice in the new section "Knorke" of the
  Administration settings: a default text, texts per language and a privacy
  policy URL that overrides the one from Theming. Nothing is worded as
  consent. New route `PUT /api/v1/settings/privacy` (administrators only),
  new snapshot field `board.linkOpenSince` for accounts, and the initial
  state of every page has 12 keys; the protocol stays at 2. No migration,
  no `occ upgrade`.

### Changed
- Context bar: while the canvas has the focus (or nothing has, after a
  click beside a button), Esc first closes an open panel of the bar, for
  example after a mouse click on an align command. The selection and the
  bar stay, and following another participant goes on. A second Esc with
  the canvas focus then clears the selection as before.
- Context bar: the panel now comes right after the last panel button in
  the Tab order (and for screen readers). After "Align items" or
  "Arrange", one Tab leads into the panel; Copy, Cut, Duplicate and the
  other buttons are no longer in the way. On screen the panel stays where
  it was, below the bar.
- The app description on Nextcloud's Apps page no longer names a version or
  milestone; the page shows the installed version on its own.
- Signed-in accounts are no longer signed out by a single "not logged in"
  answer (HTTP 401) on sync. When Redis restarts, Nextcloud gives this
  answer for a moment to accounts that signed in without "remember me",
  although their session is still valid. The board now keeps the unsent
  changes and tries again after the next retry step (about a second when
  nothing failed before); only a second such answer in a row, with no
  successful sync in between, shows "Your session has ended. Please sign in
  again." (German: "Deine Sitzung ist abgelaufen. Bitte melde dich neu an.")
  as before. When a board is opened, and when the board data is fully
  reloaded after a resync, the first such answer still signs the account
  out; guest tabs still join the board again once. A Redis outage that
  lasts longer than the retry still signs these accounts out (README,
  Known limits). Client only; the protocol stays at 2.
- Sync and the guest join report the end of access with HTTP 200 instead of
  401 or 403, so that ban rules at a reverse proxy (for example CrowdSec's
  http-generic-403-bf and -401-bf scenarios) no longer count them. When a
  link is revoked, renewed or expires, a guest tab gets 200 with
  `{"end": "<code>", "message": "<text>"}` on its next sync and on its
  automatic join; when the administrator turns off link sharing, it gets the
  200 on its next sync and ends there, without a join (codes `guest_token`,
  `not_logged_in`, `link_revoked`, `link_expired`, `links_disabled`). Only
  requests with the header `X-Knorke-End-State: 1` get this form; the board
  sends it with every sync and with the guest join, and without it the
  answers stay as before. After a new password the sync gets the 200 as
  well, but the join still gets one 403 (`password_required`); a missing or
  wrong link password stays a 403, so guessing keeps counting. The screens
  are the same as before. In the access log such requests now show as 200;
  the end state is only in the response body. The protocol stays at 2.

### Fixed
- Esc with the canvas focus clears the selection (or cancels a drag) also
  for signed-in users. Nextcloud's header menus, such as the notifications,
  cancel every Esc before the board sees it, and the board used to ignore
  a cancelled key; only holding Esc worked, through the key repeat.
- Right-click menu: a press on its inner padding, on the gap above the count
  line or on its border no longer moves the focus out of the menu; the
  active entry keeps it, so Esc and the arrow keys still work. A menu that
  has to scroll (only in very short browser windows) behaves as before, so
  its scrollbar keeps working.
- Align items: a double click on an align command (or a second click to be
  sure) no longer adds a second, invisible undo step, also after more items
  were added to an aligned selection and on boards with very large
  coordinates. For this, a click that moves something puts items that were
  already almost in place (within 0.01 world units) onto the edge or center
  line as well, in the same undo step.
- Browser tab icon, bookmark icon and home screen icon: Knorke pages now
  show the Knorke icon (the white note on the instance's primary colour),
  for accounts and for guests, on Nextcloud 34 and 35. Nextcloud's theming
  answered `/apps/theming/icon/knorke` and `/apps/theming/favicon/knorke`
  with 404 because it did not recognise the app icon file as an SVG image;
  the icon files now start with an XML declaration. A home screen shortcut
  that was made before keeps its old picture until it is removed and added
  again.
- Edit and voting links: guests can no longer install the guest page as an
  app. Since the page shows the Knorke icon, Chrome on Android offered
  "Install app" there, and the installed app started on Knorke's start
  page, which for a guest is Nextcloud's login page, without an address
  bar. The guest page now links no web app manifest, so the browser offers
  only "Add to home screen", and that shortcut opens the guest link with
  the board. An app installed before still starts on the login page:
  remove it and add the page to the home screen again. Pages for signed-in
  accounts are unchanged.
- Nextcloud's unified search: the Knorke icon in front of each board hit
  stays visible in the dark theme. Hits now show `img/app-neutral.svg`, the
  Knorke icon in a mid grey (`#808080`), instead of the black
  `img/app-dark.svg`, which was barely visible on the dark background of
  Nextcloud 34 (about 1.2 : 1). The new icon reaches at least 3 : 1 in the
  light and in the dark theme on Nextcloud 34 and 35. Under
  "Partial matches" (German: "Teilübereinstimmungen") it reaches only
  about 2.3–2.9 : 1. Nextcloud lists Knorke's hits there while a date or
  person filter is active in the search, as Knorke does not support these
  filters, and fades that group to 70 % opacity.
- Accounts of the Guests app: while that app's whitelist keeps Knorke out,
  such an account no longer finds boards in Nextcloud's search, no longer
  sees "Knorke boards" under "Places" in the search dialog and no longer
  gets Knorke's share notification in the bell, as a push message or in the
  e-mail digest. Before, the search hits and the notification showed the
  board title and the owner's name, and a click on the notification led to
  the Guests app's error page. Knorke deletes such a notification the first
  time it would be shown, so it does not come back once Knorke is allowed;
  the share stays, and the board is in the account's board list. To notify
  the account again, note its role in "Share" → "People", remove the share
  and save, then share the board again, or send the address from
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
  remove the direct share then too. When Knorke cannot ask the Guests app
  (for example after a change in a new version of that app), it treats such
  accounts as kept out. Other accounts are not affected. No new route, no
  migration; the protocol stays at 2.
- Panning and zooming no longer leave an empty strip at the edge. With the
  mouse wheel, the trackpad, one finger, a pinch, and while following
  someone, items that come into view are drawn right away; before, the
  strip at the old window edge showed only the grid until the board was
  redrawn. For this the board is drawn up to 384 pixels beyond each window
  edge, within a fixed memory budget, so each of its two canvas layers
  needs about 2 to 3 times the memory. A very large window at high pixel
  density (for example a 2560 × 1440 browser window at 2×, such as full
  screen on a 5K display) gets no margin; there a pan redraws in nearly
  every frame instead of showing a gap. Panning with the mouse or a pen
  (hand tool, space bar, middle mouse button, and a plain drag when you
  can only view or vote) now draws the larger area in every frame; in a
  WebKit lab without a GPU this was clearly slower (about 35 instead of 54
  frames per second at 100 % zoom). It has not been measured on a real
  iPad or in Safari yet.
- Opening a board that you cannot open any more (it was deleted, your
  access was removed, the link you joined through was renewed, revoked or
  expired, or link sharing was turned off by the administrator), for
  example from a board list that was not reloaded, a bookmark or a search
  result, no longer leaves the loading spinner turning below the banner.
  The page now shows "Could not open the board", and accounts get the button
  "Back to all boards" to the board list. The banner above it still says
  why. If the board list in this tab knew that you had the board through
  a link, it says
  "Your access through the link ended. Open the link again."; otherwise,
  for example after a bookmark, a search result or a reload, it says
  "This board is no longer available.", because the server's answer is
  the same for everyone. Guests keep their own pages, for example for a
  revoked or expired link. A board that is already open behaves as
  before: it stays visible, frozen, below the banner.

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
