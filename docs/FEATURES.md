<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Knorke features

Everything Knorke does, by topic. The short overview is in the
[README](../README.md), what changed in which version in the
[changelog](../CHANGELOG.md), and settings, `occ` commands and all known
limits for administrators in [ADMIN.md](ADMIN.md).

- [Boards](#boards)
- [Canvas and navigation](#canvas-and-navigation)
- [Items](#items)
- [Connectors](#connectors)
- [Editing](#editing)
- [Working together](#working-together)
- [Sharing and guests](#sharing-and-guests)
- [Facilitation](#facilitation)
- [Updates and connection problems](#updates-and-connection-problems)

## Boards

- **Board list:** your own boards and boards you joined through a link; create,
  rename, delete (owner only, with confirmation).
- **"Shared with me":** the board list filters "All", "Mine" and "Shared with
  me" and shows for every board that is not your own where it comes from
  ("Shared with you" or "Joined through a link") and what you may do
  ("Can facilitate", "Can edit", "Can vote" or "Can view").
  The effective role is the highest of all your shares (yourself, your groups,
  your teams) and links.
- **Live titles:** renaming a board shows up for everybody on it within a poll
  (about a second), without a reload; a rename field that is open elsewhere is
  not overwritten.
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
  [Known limits](ADMIN.md#known-limits).
- **Languages:** English and German.

## Canvas and navigation

- **Infinite canvas:** pan with the hand tool, space + drag, middle mouse
  button, two-finger scroll and one-finger drag on touch; zoom 5–400 % with
  Ctrl/⌘ + wheel, trackpad pinch, touch pinch and buttons; "show all" and 100 %.
  Wheel and touch gestures run on a CSS transform, so the canvas stays smooth on
  large boards.
- **Navigation:** Shift+2 zooms to the selection; "Frames" in the zoom
  controls lists all frames and jumps to one.
- **Overview of large boards (LOD 2):** below 10 % zoom the whole board is
  drawn by one painter (boxes per colour, frame titles, no connectors), so
  zooming and panning an entire workshop board stays smooth; selecting by
  click still works for notes, shapes and text (frames by their title band
  and border, as at every zoom, and at this zoom also by the painted title
  rectangle above the frame; a note or shape painted over a frame title wins,
  and a frame title wins over a neighbouring frame's border). Connectors are not drawn at this zoom and
  are skipped by a click and by the selection rectangle; Ctrl+A and Tab still
  select them.
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
  resizing (see "Snapping to other items" under [Editing](#editing)) does not snap to the grid either, nor does rotating;
  dragging a rotated item snaps its outer box. Creating items, arrow keys,
  "Arrange", paste and align never snap to the grid. Hold Ctrl (⌘ on a
  Mac) to drag or resize freely. "Snap to grid", right below "Show grid"
  while the grid is shown, is on by default; switched off, the grid stays
  visible without snapping. It is stored like the grid. A finger opens no
  menu: on a touch device, the grid needs a keyboard (G) or a pen, which
  opens the menu in "Edit"; without either, its snapping cannot be
  switched off.
- **Devices:** tablets and phones (no fine pointer) can view, pan and zoom.
  Touch devices that also report a fine pointer (a pen, a touchpad, some touch
  drivers) edit like a computer; there a finger held still on empty canvas,
  then dragged, draws a selection frame (see "Selecting with a finger" below).
- **Layout:** banners stand at the top, right below the top bar; the vote
  bar always docks at the bottom, with the toolbar and the zoom controls
  above it. Esc closes the voting setup and the timer dialog, also while the
  cursor is in one of their fields.
- **Narrow layout (≤ 600 px wide):** a one-line top bar, the presence bar as
  "+n", Share and the moderation entries in an overflow menu, the vote bar
  fixed to the bottom of the screen and at most one banner. On touch devices
  editors see "On this device you can view and vote. Editing works on a
  computer.".

## Items

- **Sticky notes and frames:** create, move (also several at once), edit text,
  colour, bring to front/send to back, delete; drag notes into and out of frames.
  Deleting a frame keeps its notes. Unknown item types show as placeholders.
- **Shapes:** rectangle, rounded rectangle, ellipse, diamond, triangle and block
  arrow (tool S; click for the default size or drag), with fill, opacity,
  border colour, width and style (solid, dashed, dotted), and text with
  alignment (automatic size or a fixed font size).
- **Text items** (tool T): free text on the board; the height grows with the
  text, the side handles change the wrap width, the corner handles the font
  size. A text item that is left empty disappears when its editor closes.

## Connectors

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

## Editing

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
- **Resize and rotate** with handles of a fixed screen size: corners keep the
  aspect ratio of notes (Shift releases it) and are free for shapes (Shift
  keeps it); rotation snaps to 45° (Shift: 15° steps); Esc cancels; every
  transform is one undo step. Several selected items scale uniformly, without
  rotation. Frames resize too, and their content stays where it is on the
  board when the top or left edge moves; items that end up outside leave the
  frame.
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
- **Copy, cut, paste, duplicate:** Ctrl/⌘+C, X, V and D, Ctrl/⌘+Shift+V pastes
  in place; frames come with their content; between boards in the same
  browser; plain text becomes one note per line (more than 100 notes ask
  first); a full board says so instead of pasting half. Selected page text is
  still copied normally.
- **Undo/redo** of your own actions (up to 50 steps).
- **Context bar per item type** with palettes for fill, border and text.
- **Right-click menu** on the canvas (in "Edit" only): on items Cut, Copy,
  Duplicate, Delete, Bring to front, Send to back, Edit text (one item with
  text), Connect (two items) and Zoom to selection; on empty canvas Paste here
  (only over HTTPS, see [Known limits](ADMIN.md#known-limits)), Add note here, Select
  all and Show everything. A right click on an item outside the selection
  selects it first; on empty canvas it clears the selection. While the canvas
  has the focus, the context-menu key or Shift+F10 opens it at the selection;
  with nothing selected, the board menu (the same as on empty canvas; screen
  readers announce it as "Board actions") opens in the middle of the canvas.
  Arrow keys, Home/End, Enter/Space and Esc work as in any menu, and the
  shortcut of each entry is shown. Inside an open text editor the browser's
  own menu stays. In the board menu a line under the entries shows how many
  items are on the board, for example "12 items on this board". The number is what this browser knows when the menu opens;
  it does not change while the menu is open. It is not a menu entry: the
  arrow keys skip it, and screen readers read it as the menu's description.
- **Keyboard:** single-key shortcuts act only while the canvas has the focus;
  Tab/Shift+Tab select the items one by one (frames first, then by position)
  and Tab leaves the canvas after the last one; arrow keys move by 1 (Shift:
  10); Enter edits the text; "Arrange" sets position, size and angle by
  number. Tab in a note's editor saves it and starts the next note to its
  right (serial input).

## Working together

- **Live collaboration:** cursors with names, other people's selections, drag
  previews and an "X is editing…" chip. Text editing holds a lease: a second
  person cannot silently overwrite what someone is typing, but can take over.

## Sharing and guests

- **Sharing:** one edit link per board (on, off, renew). Guests without an
  account join with a name; signed-in users who open the link become members.
  Renewing the link removes everybody who joined through the old one. Knorke
  honours Nextcloud's "Allow users to share via link" setting and its group
  exclusion for the board's owner (see [Known limits](ADMIN.md#known-limits)).
- **Share with people, groups and teams:** the owner opens "Share" → "People",
  searches by name (Nextcloud's own rules for whom you may find and share
  with), picks a role per entry and saves. Roles:
    - **Can facilitate** – edit, plus facilitation: the person sees the board's
      links read-only (copy, QR code, "Show to the room") and runs voting, the timer and "Bring everyone here". Only the owner and
      shares with this role facilitate – sharing with a whole department as
      "Can edit" makes nobody a facilitator.
    - **Can edit**, **Can view** and **Can vote** (view and
      vote, nothing else).
  A new recipient starts as "Can edit". Removing an entry or changing a role
  takes effect on the recipient's next poll (about a second), without a
  reload: the toolbar appears or disappears, a "View only" banner shows, and
  a recipient who loses access sees "This board is no longer available.".
- **"Copy board link"** in the dialog copies the board's internal address for
  Talk or e-mail. People you share the board with also get a Nextcloud
  notification; see "Share notifications" under [Sharing and guests](#sharing-and-guests).
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
- **Voting link:** a second link per board for people who should only view
  and vote, with its own QR code and "Show to the room" ("Scan to vote on
  this board"). Guests may leave their name empty (they appear as "Guest")
  and are told "Your votes are anonymous.".
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
  [Known limits](ADMIN.md#known-limits)).
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
- **Guest page:** Nextcloud's footer stays hidden, so the page shows the
  instance's legal notice and privacy policy links itself (from theming) in the
  name dialog, in the guest menu of the top bar and on the "link revoked/invalid"
  pages.
- **Nextcloud's sharing policy** applies to shares and links (see
  [Known limits](ADMIN.md#known-limits)).

## Facilitation

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
  accepts taking it back, but the list and the canvas offer no control
  for items outside the area. Facilitators see only how many people voted,
  never a distribution; "End voting" asks first. Then the ranking opens once
  for everyone (top three highlighted, "Copy results" as plain text); "Show on
  board" puts the totals on the items and "Close results" clears bar and
  totals. A session with a time limit ends by itself; "+5 min" extends it.
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

## Updates and connection problems

- **Clean reloads after an update:** a tab with an old bundle reloads exactly
  once per protocol version, also after a second update in the same session,
  and never while text or unsent changes are at stake.
- **Connection errors without an answer from Knorke** (a 403 or 404 from a
  proxy or firewall) do not end the tab; it shows the connection notice and
  keeps trying. Closing a tab with unsent changes asks first, also when the
  board is frozen.
