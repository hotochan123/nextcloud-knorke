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
- [Templates and export](#templates-and-export)
- [Updates and connection problems](#updates-and-connection-problems)

## Boards

- **Board list:** your own boards and boards you joined through a link; create,
  rename, delete (owner only, with confirmation: "Delete board?" with Cancel
  and Delete). The boards stand as cards in a grid: a large picture (240 × 150),
  the title in up to two lines, the time in a muted colour and, for a board
  that is not your own, its owner, origin and access in a second line. The
  owner's "…" beside the title holds Rename and Delete. A switch "Grid / List"
  next to the sort menu shows rows with a smaller picture instead; this browser
  keeps the choice. On a phone two cards stand side by side, without "…" and
  star button: a long press on a card (or a right-click) opens the star,
  Rename and Delete as a sheet at the bottom. Every filter (All, Favorites,
  Mine, Shared with me) has its own empty state; "No boards yet" shows the
  Knorke logo in colour.
  The picture is a small sketch of the board: its frames as outlines and its
  other items as boxes in their colour, in place, without any text (at most 40
  boxes, frames and large items first; connectors and rotation are left out).
  An empty board shows the board icon.
  "New board" asks for the title and a template, "Blank" picked; with a
  template the new board opens with it already inserted (one undo removes it).
- **"Shared with me":** the board list filters "All", "Mine" and "Shared with
  me" and shows for every board that is not your own where it comes from
  ("Shared with you" or "Joined through a link") and what you may do
  ("Can facilitate", "Can edit", "Can vote" or "Can view").
  The effective role is the highest of all your shares (yourself, your groups,
  your teams) and links.
- **Favorites and sort order:** every board in the board list has a star on its
  picture, shown while it is set and otherwise under the pointer or with the
  focus in the card (always on touch screens without a pointer); the
  filter "Favorites" shows the starred boards. Stars belong to you and count on
  all your devices. The list sorts by "Last opened", "Last modified" (the
  default) or "Name" (menu next to the heading); this browser keeps the choice.
  Boards you opened before this version count as never opened under
  "Last opened" and come after the opened ones.
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
- **Link previews and the Smart Picker:** a board address (as "Copy board
  link" gives it, `…/apps/knorke/b/42`) pasted in Talk, Text, Mail or Deck
  shows a card with the board's sketch from the board list (frames and
  coloured boxes, no text; the Knorke symbol for an empty board), the board
  title, the owner, the number of items and the last change ("by Alice
  Adler · 42 items · Changed Oct 24, 2026, 2:05 PM"); a click opens the
  board. Only accounts that may open the board see the card, everyone else
  sees the plain
  address, as do guests in Talk and visitors of public pages. Edit, vote and
  join links (`…/p/…`, `…/join/…`) never get a card, so they never show a
  board title. The Smart Picker (for example "/" in Talk or Text) offers
  "Knorke boards" (German: "Knorke-Boards"), which finds boards like
  Nextcloud's search and inserts the board address. Only addresses under
  which Nextcloud is opened at that moment get a card. A card can show a
  new title, item count, sketch or a lost access up to about a minute late.
  Accounts outside "Limit to groups" and accounts of the Guests app that
  may not open Knorke get neither a card nor the picker entry.
- **Languages:** English and German.

## Canvas and navigation

- **Infinite canvas:** pan with the hand tool, space + drag, middle mouse
  button, two-finger scroll and one-finger drag on touch; zoom 5–1000 % with
  Ctrl/⌘ + wheel, trackpad pinch, touch pinch, the keys + and − and buttons;
  "show all" and 100 %. Zoom to the selection (Shift+2) and following someone
  go up to 1000 %; the jump to a frame or an item (frame list, vote list,
  comments) zooms in at most to 400 %, so its surroundings stay in view. PNG and
  JPEG pictures of own shapes get blurry far above 100 %, SVG pictures stay sharp.
  Wheel and touch gestures run on a CSS transform, so the canvas stays smooth on
  large boards. "Show all", zoom to the selection and the jump from the frame
  list place the content in the part of the screen the bars and an open side
  panel leave free, never under the tool bar or the top bar.
- **The mouse wheel zooms:** a mouse wheel with notches zooms towards the
  pointer, as fast as Ctrl/⌘ + wheel, while two fingers on a trackpad still
  pan and a pinch zooms; Knorke tells them apart by the pattern of the
  wheel events. Shift + wheel pans sideways and Ctrl/⌘ + wheel zooms as
  before. Where the guess is wrong, "Mouse wheel" in the right-click menu on
  the empty canvas switches between Automatic, Zoom (every wheel and
  trackpad scroll zooms) and Pan (the wheel pans, as before); the choice
  applies to every board in this browser, also after a reload, and a short
  message names it on each switch.
- **Right-drag pans:** hold the right mouse button and drag to pan the
  board, like in Miro: in "Edit", "Vote" and "View", with every tool and
  mouse wheel setting, also when the drag starts on an item or a handle;
  it selects, moves and creates nothing. A right click without moving still
  opens the right-click menu, now when you release the button, for whatever
  lies under the pointer then. Holding the side button of a pen (such as the
  S Pen) and dragging pans the same way; a press with the side button
  without moving opens the menu when the pen lifts. While you write a text,
  a right-drag beside it pans the view and leaves the text field open with
  your text and cursor, so you can type on; a right click beside it ends
  and saves the text as before.
- **Navigation:** Shift+2 zooms to the selection; "Frames ▸" in the zoom
  menu lists all frames and jumps to one.
- **Search on the board:** the magnifier in the top bar or Ctrl/⌘+F (while
  the focus is not in a text field; the browser's own search stays out)
  opens a search field under the top bar, for everyone on the board,
  guests and view-only included; on phones it spans the width. It searches
  the text of notes, shapes, text items, table cells, frame titles and
  comments (open and resolved), without case, and only what the board
  already shows this person; connector labels, note pads and mind maps are
  not searched. The list shows each hit with its kind and a short excerpt
  (at most 200 hits) and counts "n of m"; Enter and Shift+Enter or the
  arrows go from hit to hit, the board moves the item into view and a blue
  frame marks it until the next hit or Esc. A comment's row opens its
  thread. Searching changes nothing on the board and selects nothing; the
  hits follow changes by others while the field is open.
- **Board as an outline:** "Board | Outline" in the top bar (on phones a
  list button) shows the board as a list, for everyone on the board, guests
  and view-only included: each frame's title as a heading in reading order,
  below it the notes, text items and shapes with text of that frame, the
  items outside a frame last under "Not in a frame". It is read only and
  follows changes by others. A click on a point or heading goes back to the
  board, moves that item into view and marks it with the blue search frame,
  without selecting anything. "Copy as text" and "Download as Markdown" take
  the list along as a record of the workshop. Esc, the search, a
  presentation or "Bring everyone here" go back to the board; the choice is
  not saved, a reload shows the board.
- **Overview of large boards (LOD 2):** below 10 % zoom the whole board is
  drawn by one painter without text, so zooming and panning an entire
  workshop board stays smooth: notes as boxes in their colour, frames with
  their titles, shapes with their outline (a symbol with its picture, a
  shape without fill as its border, at least one pixel wide; only shapes a
  few pixels small as boxes), connectors as thin lines in their colour along
  their course (arrowheads only while they are big enough to see, no
  labels), mind maps as their centre, small bars in the branch colours and
  the branches; selecting by
  click still works for notes, shapes, text and connectors (frames by their
  title band and border, as at every zoom, and at this zoom also by the
  painted title rectangle above the frame; a note, shape or connector painted
  over a frame title wins, and a frame title wins over a neighbouring frame's
  border). The selection rectangle takes connectors that lie completely
  inside it, as at closer zoom, so moving or deleting an area takes them
  along; a finger dragging over a connector line pans the board, its tap
  selects the connector. A connector moving with a dragged item is hidden
  until the drag ends.
- **Background grid:** "Show grid" in the right-click menu on the empty
  canvas (only in "Edit", its last entry), or the key G (in
  every mode, while the canvas has the focus) shows a grid behind all items:
  lines every 20 units (20 pixels at 100 % zoom), every fifth line darker;
  zoomed out, the grid gets five times coarser before its lines come closer
  than 10 screen pixels; above 400 % thin lines every 4 units join, and the
  20-unit lines become the darker ones. A check mark in the menu shows the state. The
  setting belongs to this browser: it applies to every board, stays after a
  reload, and nobody else sees it. While the grid is shown, dragging puts
  the top-left corner of what you drag on the 20-unit grid, and dragging a
  resize handle puts the moving edge on it, at every zoom up to 400 %; above
  400 % both snap to the 4-unit lines; snapping to
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
- **Layout:** notices stand at the top centre, right below the top bar, one
  at a time (the others wait), each with a close button "×" (the tag
  filter's "×" ends the filter); a closed notice stays away until it changes
  or ends; the session
  bar docks at the bottom while something runs, with the toolbar and the zoom controls
  above it. Esc closes the voting setup and the timer dialog, also while the
  cursor is in one of their fields.
- **Tool bar, undo and zoom bar:** the tool bar stands at the top left,
  under the left island, with nine buttons in two groups: Select and Pan;
  Note, Shape, Text, Pen, Connector, Frame and "More tools" (a small grid with
  Table, Mind map and Laser pointer; the one you picked shows its icon on
  the button). A tool with variants (note or note pad, the connector's route
  and end tip, frame or swimlanes) has a small corner at its icon: the first
  click chooses the tool with its last variant and shows the variants as
  pictures, like the Shape tool opens the shapes panel; a click or tap on the
  board then creates at once and hides them, another click on the tool hides
  them and the tool stays chosen. A long press or a right-click shows them
  too; the keys N, L and F choose the tool without them. The button shows
  the chosen variant. Undo and redo have their own small island at the bottom
  left. The zoom bar shows −, the percentage, + and "Show everything"; a
  click on the percentage opens "Zoom to 100 %", "Zoom to selection",
  "Frames ▸" and "Keyboard shortcuts". Every tool keeps its key.
- **Narrow layout (≤ 600 px wide):** the top bar is one island over the full
  width, with "Guest · Open by link" (or "Open by link") under the title, the
  presence bar as "+n", Share and the moderation entries in "More", the vote
  bar fixed to the bottom of the screen. On touch devices
  editors see "On this device you can view and vote. Editing works on a
  computer.".
- **Bars, menus, panels and dialogs:** the bars around the canvas are 44 px
  high (52 px on a tablet or phone, where a pen or finger needs bigger
  targets, with 44 px buttons), with rounded corners of 12 px; panels and
  menus have 12 px, dialogs 16 px. Each of these three levels has one soft
  shadow of its own and no visible border (Windows contrast themes draw an
  edge). Spacing follows a 4 px grid, a focused control shows a ring in the
  text colour, and notices (connection, following, presenting, device and
  role hints) are light with dark text. Every icon is a Phosphor icon
  (Regular weight), 20 px, with own drawings in the same style where
  Phosphor has none (note pad, swimlanes, routes, end tips, line styles,
  laser, "Distribute", the mind-map layout); the tool options show each
  choice with its icon or picture. A switched-on button (the active tool, a
  tool whose variants or panel are open, a pressed button of the context
  bar, an open "Comments", "List" or menu, "Grid / List" of the board list)
  is filled with the theme's primary colour and has a white icon, in the
  dark theme too; hovering keeps it so. In
  Nextcloud's dark theme the canvas stays light and the bars, menus, panels
  and dialogs turn dark grey with light text; contrast themes keep
  Nextcloud's own colours.
- **Top bar as two islands:** over the canvas, with free canvas between them.
  The left one holds "Back", the title (the owner clicks it to rename: Enter
  saves, Esc cancels) and the chips "Open by link" (it opens the privacy
  info; guests have it too) and "Guest". The right one holds up to
  four participants (the rest behind "+n", whose list starts with "Present
  (n)"), "Comments", "Facilitate" with its word, "Share" as the board's only
  primary button (never for guests) and "More". "More" groups its entries:
  "Export ▸" (PNG, SVG, PDF, BPMN, CSV, the board file), "Insert ▸"
  (template, board file, BPMN file, CSV), then "Suggest as template…",
  "Keyboard shortcuts" and "Legal ▸" (the instance's legal notice and
  privacy policy, now for accounts too); the submenus open in the same list
  with a back entry. Between 601 and 900 px the participants show as "+n"
  and the link chip as its icon. "Show everything" keeps clear of both
  islands and of the notice.

## Items

- **Pen, highlighter and eraser:** the Pen tool (key P) draws freehand lines
  with the mouse, a pen (S Pen) or a finger, smoothed but without shape
  recognition. Its variants: Pen, Highlighter and Eraser; for the pen and
  the highlighter three widths (pen 2, 4, 8; highlighter 12, 20, 32) and
  their colours (the pen the strong tones, Black first chosen; the
  highlighter the light tones, Yellow first chosen, drawn see-through). The
  tool, its kind, width and colour stay after a stroke; Esc ends a stroke
  without keeping it, a second Esc chooses Select. Everyone sees a stroke
  once it is finished. On a device that has used a pen on the board, a
  finger pans and zooms with the Pen tool; without a pen the finger draws.
  The eraser removes every whole stroke its path touches (never a locked
  one, never other items), in one undo step. A stroke is an item: select it
  by clicking its line, move, copy, lock, delete and undo like a shape; the
  context bar changes its colour and width. Strokes are not resized or
  rotated. At most 500 points per stroke: a long scribble is simplified.
- **Sticky notes and frames:** create, move (also several at once), edit text,
  colour, bring to front/send to back, delete; drag notes into and out of frames.
  Deleting a frame keeps its notes. Unknown item types show as placeholders.
  The automatic text size of a note gets smaller until the wrapped lines fit
  the note; only a text too long even for the smallest size ends with "…".
  A new note gets the text size M (22); "Text" in the context bar offers
  Auto, S (16), M and L (32) for notes, notes made before keep "Auto". A
  text that does not fit gets smaller, but because of one long word at most
  down to S; a word that still does not fit is split with a hyphen where the
  line is full (only on the board: the text itself stays as written). Notes
  look like paper on the canvas of #f3f2f0: corners of 6 px, two soft
  shadows (near and far, gone below 30 % zoom), a fine edge in a stronger
  tone of their colour (grey on white, none on black, kept below 30 %) and a
  dog ear at the bottom right corner in a darker tone of their colour. The
  text has 18 px room inside, line height 1.25, and keeps clear of the dog
  ear, as does the tag row; tags that no longer fit go into "+n". This look
  applies to every note, also on older boards, and the PNG, SVG and PDF
  exports draw it the same. A frame's name stands in a tab on its top left edge, like an
  index card: 22 px, semibold, on a stronger tone of the frame's colour (grey
  on a white frame; light text on a dark one, always at least 4.5 : 1), the
  outline running round tab and frame; a long name is cut with "…" short of
  the frame's right edge. Frames have rounded corners (8, also the tab's top
  corners) and an outline in the strong tone of their own colour (grey
  #6f6f6d on white and grey frames, the nearest palette tone on a custom
  colour); a frame without a name has no tab, and the PNG, SVG and PDF
  exports draw the tab and the outline the same. A selected frame's selection
  outline runs round frame and tab, 4 px outside with rounded corners, and
  your own selection tints the tab with the selection colour.
  A new frame opens its title field at once; left empty, the frame stays
  untitled. While you have a frame without a title selected (and may edit),
  a dashed tab "Add title…" stands above it, seen only by you; a second click or tap
  on that hint, or on the tab of a selected frame, edits the title, as
  do "Rename" in the context bar, Enter and a double
  click on the tab. Only the tab (or that hint) grabs the frame above its
  top edge, with the usual extra margin for a finger or pen; beside it is
  plain canvas, so a click there clears the selection and a drag draws a
  selection box. Below 10 % zoom the whole band above the frame still grabs it.
  "Frame around" (edit mode, in the context bar's "…" and the right-click
  menu, no key) puts a new frame round the selection with 40 units of margin
  on every side, behind the items, and opens its title field; it is one undo
  step. The selected items move into it, and so do other items lying
  completely inside, as when you draw a frame. Selected frames lie on the new
  frame (frames do not lie in frames). The items must all lie in the same
  frame or all outside frames, and none may be locked; else the entry is
  greyed and says why. Items of one frame move into the new frame, which lies
  on top of the old one.
- **Swimlanes:** the option "Swimlanes" of the frame tool (F) makes a frame
  that is divided into lanes stacked top to bottom (a click: 1200 × 600 with
  "Lane 1" to "Lane 3"; a drag: that size, three equal lanes). Each lane has
  a narrow head at the left (48 wide) with its name turned on its side, reading
  upwards; a name that does not fit gets smaller, down to 12, before it is
  cut with "…". The heads (lanes, columns and the empty corner) are tinted
  in the tone of the frame's colour, group cells a little stronger, and the
  only lines are fine dividers between lanes and between columns; names are
  bold 16 (column groups 14), column names left aligned and wrapping, light
  on a dark frame. A double click or double tap on the head,
  or "Rename lane" in the right-click menu (long press on a tablet), edits it;
  dragging the head moves that lane with its content to another place (with a
  finger: on the selected frame), and the frame itself moves by its title or
  its border. On the selected frame, dragging the
  line below a lane (with a mouse, pen or finger) makes that lane taller or
  shorter, and the button "+ Lane" below the frame adds a lane at the end (the
  "+" buttons of swimlanes, tables and mind maps are 24 px circles in the
  selection colour with a white plus); the frame's
  top and bottom corner handles change the first and the last lane. The right-click
  menu on a lane adds a lane above or below it, moves it up or down, or
  deletes it: its space goes to the lane above (the first lane's to the one
  below), and nothing on the board is deleted. A note, shape or other item
  lies in the lane that holds its middle (a group by its middle as a whole)
  and moves with that lane when lanes are added, moved or resized. "Add
  column" in the right-click menu divides the frame into columns as well, so
  lanes and columns make a grid (for example phases as columns and roles as
  lanes): each column has a head on top with its name, is renamed, added left
  or right, moved left or right, made wider or narrower by dragging its right
  line, deleted (its space goes to the column on its left) and dragged by its
  head to another place like a lane; the "+" right of the frame adds one at the
  end, and what lies in a cell moves with its lane and its column. A frame
  with a single lane without a name shows no lane head, so a frame of columns
  only is possible. Neighbouring lanes can be gathered under one heading:
  "Create lane group" in the right-click menu of a lane puts a narrow cell
  left of the lane names whose name stands turned on its side (like a pool
  in BPMN tools) and opens its name; "Create column group" puts a cell above
  the names of neighbouring columns the same way. The first group widens the
  frame by its cell (a column group: heightens it) and everything inside
  moves along; when the last group goes, the frame shrinks back. Dragging
  the cell's top or bottom edge (a column group's left or right edge) takes
  neighbouring lanes in or lets them go, snapping to their borders, but never
  over another group; dragging the cell moves the whole group with its lanes
  and their content. A lane dragged between two lanes of a group joins it,
  one dragged out leaves it, "Add lane above/below" on a lane of a group adds
  one in that group, and the "+" adds one without a group. "Rename lane
  group" or a double click on the cell renames it, "Dissolve lane group"
  removes only the group (lanes and content stay), and deleting a group's
  last lane removes the group too. Otherwise
  a frame with lanes works like a frame: title, colour, moving, the frame
  list, presenting, saving as an image, copying and templates. A BPMN file
  leaves the columns out and writes a lane group as a lane with its lanes
  inside (a child lane set).
- **Shapes:** rectangle, rounded rectangle, ellipse, diamond, triangle and block
  arrow (tool S; click for the default size or drag), with fill, opacity,
  border colour, width and style (solid, dashed, dotted), and text with
  alignment (automatic size or a fixed font size; the automatic size gets
  smaller until the wrapped text fits, and only a text too long even for the
  smallest size ends with "…"). Basic and flowchart shapes have a dark grey
  default border (offered first as "Default" in the border colours), slightly
  rounded corners, and picking a fill colour from the palette gives the border
  the strong tone of the same colour (white fill: the default border); the
  border can still be changed afterwards. A click puts a rectangle 200 × 120,
  an ellipse or diamond 160 × 160, a triangle 160 × 140 and an arrow
  200 × 100. BPMN shapes keep their black border. A shape without fill is
  grabbed at its border and at its text, like a frame at its title; the rest
  of its inside works like empty canvas, so the items in it stay easy to
  click and drag.
- **Shapes panel:** the Shape tool (S) opens a panel beside the tool bar
  (a second click on it or × closes the panel; once you picked a shape, the
  tool keeps it, so the next click or drag on the board puts it): a search over all shapes (also in
  libraries you hid), "Recently used" (the last 3) and the libraries "Basic shapes" (the six above), "Flowchart"
  (process, decision, start / end, input / output, document, database,
  subprocess, preparation, manual input, manual operation, delay, off-page
  reference) and "Symbols" (person, people, place, clock, warning, info,
  question, done, error, star, heart, idea, flag, calendar, mail, phone,
  home, settings, padlock, cloud), each to fold open and closed; "Libraries"
  at the end of the list chooses which libraries it shows. Drag a shape onto the board
  (with a finger or pen sideways out of the panel; up and down scrolls), or
  click it and then click or drag on the board like the shape tool; Enter on
  a shape puts it in the middle of the view. The choice of libraries, the
  folded ones and the recently used shapes stay in this browser. Flowchart
  shapes have text like the other shapes and switch among each other under
  "Shape" in the context bar. A symbol is drawn in its fill colour (dark at
  first, without border) as a Phosphor Duotone icon: its lines in the
  colour, its inside in a light fill of it (20 % of the colour's opacity;
  none at opacity 0), on the board, in the panel and in exports; it has a
  label instead of text inside: a double
  click or double tap (or Enter, or "Edit text") writes it, it stands
  centred below the symbol, wraps at the symbol's width (160 units at
  least), takes the text colour and size of the context bar (size "Auto":
  16) and moves, turns, copies and deletes with the symbol; empty, nothing
  stands there, and a click on the label selects the symbol.
  The library "BPMN" (after "Flowchart") has the BPMN 2.0 events (start,
  intermediate and end; with message, timer, error or terminate), tasks
  (user, service, manual, script, business rule, send and receive task,
  collapsed subprocess, call activity), gateways (exclusive, parallel,
  inclusive, event-based) and data (object, input, output, store), drawn
  with their markers in the border colour; end events and call activities
  have a border twice as thick. Tasks and data carry text inside, events
  and gateways a label below them (like symbols). Under "Shape" in the context bar a BPMN
  shape switches among its group (events, tasks, gateways or data). A
  connector drawn from the "+" of an event, task or gateway (dragged, or a
  click or tap on "+") is a sequence flow, with a filled triangle at its
  end, instead of the arrow; an end tip picked in the connector tool's menu
  still applies, and data shapes keep the arrow. The library's
  last entry, "Pool with lanes", puts a frame with three swimlanes like the
  frame tool's "Swimlanes" (the pool's name is the frame title). Knorke
  checks no BPMN rules and runs nothing.
  Phones, which only view and vote, have no panel.
- **Own shape libraries:** "Import shapes…" at the foot of the Shapes panel
  (signed-in accounts) picks SVG files and draw.io libraries (.xml); all
  files picked at once become one library of your own, named after the
  draw.io library (or "My shapes", to change in the dialog). Every SVG is a
  shape; from a draw.io library every symbol stored as a picture is taken,
  symbols drawn from draw.io shapes are skipped. A PNG or JPEG picture
  larger than 48 KB is drawn smaller until it fits (same format, the shape
  keeps the size the library gives it); only one that still does not fit,
  an SVG larger than 48 KB or what is no picture is skipped (the dialog
  counts them). Your libraries follow the built-in
  ones in the panel, on every device of your account, with search, "Recently
  used" and "Libraries" like the others; the "⋯" of a library renames it,
  deletes it (shapes already on boards stay), or suggests it to the admins
  with an optional note ("Waiting for approval" until they decide, "Withdraw
  suggestion" ends it). An admin adopts or rejects suggestions in the admin
  settings under "Shape libraries" and renames or deletes adopted libraries
  there; their own "Make available to everyone" adopts one at once. Adopted
  libraries are in every account's panel. A shape from a library lies on
  the board as its picture, stretched over its box (no text inside and no
  colours of its own): it moves, resizes, rotates, takes connectors,
  votes and comments, and goes into copies, templates, board files and the
  PNG, SVG and PDF export. It has a label below it like a symbol: a double
  click or double tap (or Enter, or "Edit text") writes it, with the text
  colour and size of the context bar, and without one it looks as before; far out it shows its picture as long as it is a
  few pixels large. Guests see such shapes but place new shapes only from
  the built-in libraries; accounts of the Guests app likewise.
- **Text items** (tool T): free text on the board; the height grows with the
  text, the side handles change the wrap width, the corner handles the font
  size; its connection points show at the top and bottom. A text item that is left empty disappears when its editor closes.
  A new text is centred: a click or tap puts the middle of the text where you
  clicked, and in a box you drag out the text stands centred in its width;
  texts already on a board keep their alignment, the context bar changes it.
- **Markdown in texts:** notes, shapes (and the labels below symbols), text
  items and table cells understand `**bold**`, `*italic*`,
  `~~strikethrough~~`, `` `code` ``, lists with "- " and numbered lists with
  "1. " at the start of a line, and links as `[text](address)` or a bare
  https:// address (only http, https and mailto become links). The text is
  stored as typed; the editor shows the marks, the board shows the text
  formatted without them, also in PNG, SVG and PDF (code in the PDF in
  Helvetica). While such an editor is open the context bar shows B, I, S
  and a list button, and Ctrl/⌘+B and Ctrl/⌘+I set bold and italic. A link
  is underlined; Ctrl+click (⌘+click on a Mac) opens it in a new tab, a plain
  click still selects, and a selected item with links shows "Open link" in
  the context bar (the way on a tablet). Frame titles, connector labels and
  mind map nodes stay plain. Search, CSV and the AI get the text without
  marks; the outline shows it without them and "Download as Markdown" keeps
  them.
- **Tables:** the tool "Table" (key B) puts a table of 3 × 3 cells with
  plain text where you click and opens its top-left cell; a double click
  (double tap) or Enter writes in a cell, Tab and Shift+Tab move from cell
  to cell like in a spreadsheet (Tab in the last cell adds a row), ↑ and
  ↓ in the first or last line of a cell's text and ← and → at its start or
  end move to the cell beside it, Esc ends writing, and every row grows
  with its longest text. Cells copied from Excel, LibreOffice Calc or
  Google Sheets and pasted while writing in a cell fill the table from that
  cell, add the rows and columns they need (up to 50 rows × 20 columns)
  and are one undo step; only what goes beyond that is left out with a
  message, and pasted on the empty canvas they still become notes. The
  first row is a bold, tinted header row; "Header" in the context bar
  switches it off or changes its colour, its switch "Header column" makes
  the first column bold and tinted too (off by default), and "Border" and
  "Text" colour the whole table. Tables have rounded corners, a fine outer
  border, lines across a little stronger than lines down, and the cell you
  write in is tinted and framed in your theme's colour. With the table selected, "+" at its right and bottom edge
  adds a column or a row, dragging a column's border sets its width, and
  the right-click menu of a cell (on a tablet or phone: hold a finger still
  on a cell of the selected table) inserts a row above or below or a column left or right, deletes
  its row or column, and "Export as CSV" downloads the table (UTF-8,
  comma, cells that start like a formula get an apostrophe). Several people
  write at once in different cells, one person per cell like a note, each
  with "X is editing…" and "Take over" at that cell. A table holds at most
  50 rows and 20 columns; connectors attach to the whole table, and tables
  get no votes. Sorting rows or columns and merged cells are not available.
- **Mind maps:** the tool "Mind map" (key M) puts a central topic where
  you click and opens it for writing. With a node selected (a click on it
  selects the mind map and focuses that node), Tab adds a child and Enter a
  sibling, and the new node opens for writing at once; while writing, Enter
  and Tab do the same, Shift+Enter starts a new line, Esc ends writing. The
  arrow keys move from node to node, F2 or a double click writes in a node,
  Delete removes a branch with everything below it, Esc first leaves the
  node, then the selection. With a finger or a pen, the "+" beside the
  focused node adds a child and the one below it a sibling; the right-click
  menu of a node (on a tablet: hold a finger still on a node of the
  selected mind map) has "Add child", "Add sibling", "Fold branch",
  "Delete branch" and "Copy as text". Knorke lays every node out by itself,
  the same for everyone and also while several people add branches at
  once: the main branches spread to the left and right of the central box
  ("Right only" in the context bar keeps them on the right): the centre is
  a white box with a dark border, each main branch a pill in the light tone
  of its own colour, the other nodes text on a line, joined by curved
  branches that grow thinner towards the outside. Drag a node onto another node to hang it below it, onto the upper
  or lower edge of a node to put it before or after it; let go on empty
  space and the node stays exactly there, on its old branch, the same for
  everyone: its sub-branches move with it and its curved branch follows,
  and Knorke moves the nodes it lays out by itself out of the way, so a
  node placed freely covers none of them. A main branch let go on the
  other side of the centre changes to that side. "Rearrange" in the
  right-click menu of the centre puts every node back into the automatic
  layout, in the menu of a node only that node and its branch. Dragging the
  centre moves the whole mind map. The dot at the end of a branch folds and
  unfolds it for everyone; a folded branch shows a badge "+n" in its colour
  with the number of nodes it hides, and a click on it unfolds it.
  "Branch" in the context bar gives the focused node another colour (its
  branch follows) or shape (text on a line, rectangle, rounded rectangle,
  pill; a main branch is a pill by default). An indented list (tabs, spaces or bullets, also Word's bullet
  list) pasted on the board becomes a mind map, and "Copy as text" copies a
  branch as an indented list, for example for minutes; Ctrl/⌘+C puts the
  same list into plain text. "Layout" in the context bar switches a mind
  map to "Org chart" (top to bottom) or "Tree" (left to right) and back
  ("Mind map", "Right only"), for everyone: the same tree, only drawn
  differently, every node a white card with a dark border on dark
  right-angled lines with rounded bends. Each card has a band in its colour
  (org chart: on top, tree: on the left), its name in bold and its role
  below in smaller grey letters: the first line of its text is the name, the next lines
  (Shift+Enter while writing) the role. There ↓ goes to the children, ↑ to
  the parent and ← → between siblings; a node is dropped onto another node
  (its left or right quarter: before or after it), never placed freely, and
  a node placed freely in the mind map finds its place again when you
  switch back. Nodes take comment threads like notes, whose
  bubbles sit at their node; mind maps get no votes, reactions, tags or
  connectors. Copy, undo, templates, board files and the PNG export take
  them along; the CSV export leaves them out.
- **Note pads:** a pad is a pile of blank notes in one colour and size:
  four sheets show as an edge below it, a binding in a darker tone of its
  colour runs across the top with an optional short title in bold (left,
  one line, cut with "…"; hidden below 30 % zoom), and a dashed tear line
  lies under the binding. Everyone who may
  edit (guests of the edit link too) puts one on the board: the variants of
  the note tool offer "Note" and "Note pad" ("Note pad" holds for
  one click or tap, then the tool is back to notes). A new pad opens its title for
  writing at once, like a new frame; Esc or a click elsewhere leaves it
  without one, and one undo removes the pad with its title. In "Edit", drag from the sheet below the tear line
  with the mouse, a pen or a finger to take a new note off it, as often as
  you like: it lands where you drop it (into a frame too) in the pad's
  colour and size, selected and open for writing; left empty it stays, one
  undo takes it away. A click on the pile does nothing; with the keyboard,
  Enter on the selected pad puts a note beside it. The binding (down to the
  tear line) selects and moves the pad like any item, a double click there (or "Edit
  text" in its menu) writes the title, and the colour and the corners
  change like a note's. A locked pad stays where it is but still gives
  notes. In "Vote" and "View" a pad just lies there. Copy, undo,
  templates, board files and the PNG export take pads along, the CSV
  export leaves them out, and a pad gets no votes, reactions or
  connectors. The four built-in templates have a pad beside each guiding
  question, in its colour.
- **Tags on notes:** every board has its own list of tags, each a short
  name (up to 30 characters) in one of 12 colours. In "Edit", "Tags" in the
  context bar of the selected notes opens the
  board's tags with a search field on top: a click on a tag's box gives it
  to every selected note or takes it from all (one undo step each; a note
  holds at most 8), Enter creates a tag of the typed name in the next free
  colour and ticks it. Everyone who may edit, guests of the edit link too,
  renames, recolours and deletes tags with the pencil beside them
  (deleting removes the tag from every note at once, without a question);
  creating, renaming, recolouring and deleting a tag are each one undo
  step (Ctrl/⌘+Z, redo as usual), and undoing a deletion brings the tag
  back on every note that carried it; a board has at most 100 tags. Notes show their tags as coloured labels at their
  bottom edge, in every mode, "+n" for those that do not fit (a tap lists
  them all), only coloured strokes when zoomed far out. "Filter by tags…"
  in the "⋯" menu fades the notes without one of the chosen tags, only in
  this tab and in every mode (also while voting); a chip says what is
  filtered and clears it, and in "Edit" "Select all with this tag"
  selects those notes. Copy and paste (into another board too: missing
  tags are created there), templates and board files take the tags along,
  the CSV export has a column "Tags" and the PNG shows them as on the
  board.
- **Emoji reactions on notes:** everyone who can edit or vote (guests of
  both links too) reacts to a sticky note with one emoji, like in Miro. The
  smiley-plus button at the note's bottom left (it shows when the pointer
  is over the note, on the selected note and always at the end of its
  reactions; on phones, tablets and other devices with a touch screen it
  stands at every note during a vote and in "View", also before the note
  has a reaction, and a tap on it never counts as a vote), "Add reaction"
  in the context bar opens a quick row of
  👍 ❤️ 😂 🎉 🤔 👀; "More…" opens Nextcloud's emoji
  picker with search (it loads the first time you open it). The reactions
  show small below the note for everyone, live: the most frequent first, as
  many as fit in the note's width, the rest as "+n", which lists them all.
  Your own is highlighted. Pointing at one, or a long press, shows who
  reacted. Tapping a reaction makes it yours, tapping it again takes it
  back, and choosing another emoji replaces yours; there is one per person
  and note. Reactions work during a vote too, never become an undo step,
  stay visible but cannot be changed on a frozen board or by viewers, are
  not copied with a note and come back with a deleted note you undo.

## Connectors

- **Connectors** (tool L): drag from one item to another, or from one of the
  connection points on the frame of a selected note, shape or text item (a
  text item's left and right ones with the connector tool, where they all
  show); an end dropped on
  empty canvas stays free. Ends attach to the side facing the other item, or
  to an anchor point when you start or drop near one. Hold Ctrl/⌘ while you
  start the drag or let go to make that end a free end: it attaches to no
  item and no anchor point, even over an item. A drag never attaches both
  ends to the same item. Routes straight, elbow or curved; tips none, arrow,
  triangle, dot, diamond, open circle or open triangle at either end; line
  colour, width and style; a label (double-click the line). The context
  bar's "Tips" panel has "Sequence flow" (solid, a filled triangle at the
  end) and "Message flow" (dashed, an open circle at the start and an open
  triangle at the end) for BPMN: one step for every selected connector that
  is not locked, the button of the look the selection has is pressed.
- **Look of connectors** (design round 3): right-angled routes bend in soft
  curves (radius 10, smaller where a piece is short); the tips are 6 + 4 ×
  √width long, so thick lines get only slightly bigger tips, and the line ends
  at the base of a filled tip; curved routes swing out 60 % of the distance
  (at least 60). The label is a white pill with a fine grey edge, Arial 15,
  at half the length, at most 240 wide, hidden below 30 % zoom. Older boards
  and the PNG, SVG and PDF exports show the same look.
- **Elbow connectors, swap direction:** every new connector (the connector
  tool L, a drag from "+", a click or tap on "+", "Connect") runs at right
  angles with a filled triangle at its end (an open arrow until 0.4.0;
  existing connectors keep their tips); a route or end tip you pick in the
  connector tool's menu applies until you reload, a change in the context
  bar only to that connector, and existing or pasted connectors keep their
  route. "Swap direction", below "Start tip" and "End tip" in the context
  bar's "Tips" panel, swaps the two
  tips of every selected connector (a dot and an arrow trade places) in
  one undo step; locked connectors stay as they are. With the same tip at
  both ends the button is greyed out and the menu entry is missing.
  Right-angled connectors run around the notes, shapes, texts, tables, note
  pads and mind maps between their ends instead of through them (frames and
  other connectors do not count), live while you drag, resize or add items;
  with nothing in the way the line stays as it was. Straight and curved
  connectors are unchanged.
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
  it. The first time a finger pans the board in edit mode with the Select
  tool, a small tip at the bottom explains holding, then dragging, until
  you press OK; each browser shows it only once.
- **Resize and rotate** with handles of a fixed screen size: a selected item
  shows four round corner handles, white with a rim in the theme's primary
  colour, 12 px with a mouse and 16 px with a pen or finger (a text item also
  its side handles); the corners keep the aspect ratio of notes (Shift
  releases it) and are free for shapes (Shift keeps it). With the mouse the
  rotation handle appears when the pointer comes near the top right corner,
  and the connection point of an edge when it comes near that edge; with a
  pen or a finger every handle and point stays visible, larger, with a
  44-pixel target. Rotation turns by how far you move around the centre and
  snaps to 45° (Shift: 15° steps); Esc cancels; every
  transform is one undo step. Several selected items scale uniformly, without
  rotation. Frames resize too, and their content stays where it is on the
  board when the top or left edge moves; items that end up outside leave the
  frame. The selection frame and its handles sit a few pixels outside the
  item at every zoom (rotated with it), and a press into that gap still grabs
  the selected item. In a multi selection or a selected group, a drag that
  starts anywhere inside its frame (on an empty spot, an item that is not
  selected or a locked item) moves the whole selection, with the mouse, a pen
  or one finger; a click there without moving clears the selection or selects
  that item, and Shift+click still adds or removes items. A finger held still
  first still draws a selection frame; to pan, use two fingers or start
  outside the frame.
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
  item's size; the markers and guides show why. As in Miro, they carry
  numbers in whole board units (1 unit = 1 pixel at 100 % zoom): every gap
  marker shows its length, and every guide a solid measuring line with the
  distance to the nearest item on that line; without a guide (nothing
  snaps, or Ctrl/⌘ held) there are no numbers. While you drag a resize
  handle, a label like "240 × 180" just below the bottom right corner of
  the selection shows the width × height of the selection frame (several
  items or a group: their common frame; a rotated item: its own size, as
  in "Arrange"), with or without Ctrl/⌘. The numbers are white on magenta
  and keep their size at every zoom. Only you see your guides, markers
  and numbers; the others see the snapped items without them (a move
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
- **Sort notes by colour:** select notes and choose "Sort by color" in the
  "Align items" panel or in the right-click menu: the notes form one
  near-square block per colour, in their old reading order, the blocks side
  by side in the order of the palette (Light blue first, custom colours
  last; an old and a new tone of one colour share a block), starting
  at the top-left corner of the notes. Only loose notes move: shapes, texts,
  frames, locked or grouped notes and notes inside a frame stay where they
  are. For one selected frame, "Sort notes by color" (in the context bar's "…" and
  the right-click menu) sorts the notes in it from its top-left corner, and
  the frame grows until they fit. Right after sorting, a grey field "Name
  this group…" stands above each block, seen only by you: type a name and
  press Enter (or click elsewhere) and it becomes a text above the block;
  untouched fields vanish with the next click elsewhere, Esc or action. One
  undo step undoes the sorting, another one each name.
- **Neighbour with one click:** in edit mode, select one note or shape and
  click or tap one of its four "+" handles. An empty item of the same kind,
  size, rotation and style appears 20 units away on that side, lined up
  with the first one, and a connector joins the two, like one dragged from
  the "+" (right-angled with an arrow from the first item to the new one,
  unless you chose another line or end for the Connector tool). The new
  item is selected, so a click on its "+" adds the next one: a row or a
  column in a few clicks. One undo removes the new item with its
  connector. When a note, shape or text item that is not connected to the
  first one yet lies close on that side (up to 200 units away and at least
  partly across from it), a click or tap only adds a connector to that item
  and selects it; one undo removes just the connector. With a mouse,
  hovering a "+" shows beforehand what a click does: a faint outline on the
  item it would connect to, or a faint dashed outline where the new item
  would appear. When something is in the way, the new item moves on past it
  and never covers an item. It goes into the frame of the first item when
  it fits there completely. To write on a new note or shape, double-click
  it or press Enter; left empty it stays. On a text item, a click or tap on
  a "+" starts a connector that follows the pointer: click or tap an item
  to connect it there (that item is then selected, so its "+" goes on from
  it), or empty canvas to leave a loose end. Esc, a right
  click, or a click or tap on the text item or on that "+" cancels. While
  you type, no "+" handles show. With the keyboard, Alt+arrow (Option+arrow
  on a Mac) adds the item without a connector while the board has the focus
  (in the editor these keys still move the cursor); on a text item it puts
  a copy with the same text and look beside it and selects it, so pressing
  again builds a row. Dragging from a "+" still draws a connector.
- **Grouping:** select notes, shapes or text items and press Ctrl+G (⌘G on
  a Mac), or use "Group items" in the context bar's "…" or the right-click menu;
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
  "Lock" in the context bar's "…" or the right-click menu, or with Ctrl+Shift+L
  (⌘⇧L on a Mac). A lock symbol then sits on the item while the board is
  in "Edit" (not in "Vote" or "View"). A locked item can still be
  selected, copied, connected and voted on, but nobody can move, resize,
  edit or delete it until it is unlocked (it only moves along when someone
  moves the unlocked frame it is in, and each attached end of a locked
  connector still follows its item); a locked frame stays where it is,
  while its content stays free. A locked item works like the background,
  so a large locked template does not get in the way: a click or a tap
  selects it (for example to unlock it), a drag that starts on it draws a
  selection frame with the mouse or a pen and pans the board with a finger,
  and holding a finger still, then dragging, draws a selection frame too. A
  marquee and Ctrl+A (⌘A) skip locked items; Tab still reaches them. To
  select several locked items at once, hold Alt (⌥ on a Mac) while you draw
  the selection frame: it then takes only the locked items in it
  (Shift+Alt adds them to the selection). Without a keyboard, after a
  selection frame or Ctrl+A that skipped locked items the context bar
  offers "Select 3 locked items" (with their number), also when nothing
  else was selected; a click or tap on it selects exactly those, for
  example to unlock or copy them all at once.
  Wherever a lock names a guest, the name says so, as in "Locked by Anna
  (guest)".
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
  locks each item again in the name of the person who had locked it (also
  after "Unlock" on a single item), so they can still unlock it themselves;
  when that is no longer possible (for example because someone else locked
  or unlocked the item in the meantime), undo leaves the item as it is. If
  someone was quicker, choosing an entry when nothing is left to unlock
  shows "Nothing left to unlock.". A marquee and Ctrl+A (⌘A) still skip
  locked items, also for facilitators.
- **Copy, cut, paste, duplicate:** Ctrl/⌘+C, X, V and D, Ctrl/⌘+Shift+V pastes
  in place; frames come with their content; between boards in the same
  browser; plain text becomes one note per line (more than 100 notes ask
  first); cells copied from Excel, LibreOffice Calc or Google Sheets become
  one note per cell at its row and column (a cell with a line break, tab or
  quotes stays one note, a single column stays a column, empty cells keep
  their place); one paste makes at most 1000 notes, a message says when the
  rest was left out; a full board says so instead of pasting half. Selected
  page text is still copied normally.
- **Undo/redo** of your own actions (up to 50 steps). Undo keeps what others
  changed since, property by property: a note you moved and someone else
  recoloured goes back with the new colour, a note someone else moved stays
  where they put it, and an item you created goes even when someone else
  moved, resized, rotated or restyled it; it stays only when someone else
  wrote or changed its text (for a table: its cells). Redo of a delete
  follows the same rule. A notice says how many items were skipped. Undo and
  redo bring back exactly what the other took back, a removed item with the
  others' changes. This holds for everyone, facilitators included.
- **Context bar per item type**, always in the same order: from two items
  on a chip "4 selected ▾" (see "Narrow the selection"), "Align items"
  right after it, then one colour dot, the item type's own buttons
  ("Change shape", "Edit label", "Rename", "Route", "Tips", "Header",
  "Branch", "Layout"), "Add reaction", "Comment" and "Tags", and "…" last. The
  colour dot shows the item's colour (split in two when the selected fills
  differ) and opens one panel with the tabs "Fill" (palette, "On this
  board", opacity), "Border" or, for connectors, "Line" (palette, width,
  dash) and "Text" (size, alignment, colour); it opens on the tab you picked
  last, and the arrow keys move between the tabs. "…" holds, in groups: Cut,
  Copy, Duplicate · Bring to front, Send to back · Connect · Arrange…, Sort
  by color · Group items or Ungroup · Lock or Unlock · and Delete last, in
  the error colour; each entry names its shortcut as a tooltip, and a
  blocked "Group items" stays with its reason below it. A note thus has five
  buttons.
- **One palette:** every colour of the board comes from one palette of 13
  named colours in the same order everywhere: Light blue, Turquoise, Sage,
  Yellow, Orange, Coral, Pink, Purple, Indigo, Sand, White, Gray and Black.
  Fills of notes, note pads, frames, shapes and table headers take the light
  tones; borders, text colours, connector lines, tags and mind-map branches
  the strong ones (lines, tags and branches without White). Every swatch
  shows its name as a tooltip. Connector lines and table header rows also
  offer their own "Default" first. A colour of the old palettes (before the
  redesign) is drawn as the nearest new tone, in exports and the CSV too,
  while the stored colour stays until someone recolours the item; custom
  colours stay exactly as they are and never show as old palette colours in
  "On this board".
- **Context bar at the selection:** on tablets and computers the context bar
  stands centred above the selected items, far enough away that the rotation
  and "+" handles stay free. Without room there it goes below them, and
  otherwise to the top of the view; it never leaves the view, and the banners
  keep their place. While items are dragged, resized or rotated and while the
  view pans or zooms the bar hides and comes back at the new place; with the
  selection out of view it stays hidden, and the keyboard shortcuts keep
  working. Its panels open on the side away from the selection; where they
  do not fit there, beside the selection, and they never cover the bar. On phones
  (up to 600 px wide) the bar stays at the top as before.
- **Colour picker:** every palette of the context bar (fill, border, text
  colour, connector line, table header, branch) is a grid of swatches; White
  and Black have an edge that shows on the light and the dark panel. The row
  "On this board" below it offers up to 8 custom colours already used on the
  board, the most used first. "Custom color…" opens a "#" field that takes a
  hex code such as `#ff8800` (Enter applies it; an invalid code turns the
  field red and changes nothing) and a round button for the colour picker of
  the system. Frames keep any colour picked for them. A
  note in a dark colour gets white text automatically; shapes keep the text
  colour chosen for them.
- **Narrow the selection:** from two selected items on, the context bar
  starts with the chip "12 selected ▾". When the selection mixes kinds of
  items or tags (after a selection rectangle or Ctrl/⌘+A, say) it is a
  button: it lists the kinds present with their numbers ("Only notes (5)",
  "Only shapes (2)", … "Only groups (1)") and, under "By tag", the tags of
  the selected notes ("Budget (3)"), and one click or tap keeps only that
  kind, or the items with that tag, selected. "Only groups" keeps the fully
  selected groups whole; every other entry keeps all items of its kind,
  group members included. Nothing on the board changes.
- **"Arrange" keeps up:** while the "Arrange" panel is open, its X, Y,
  width, height and angle show the item's real position, also after you or
  someone else moved it; a field you typed in keeps your input until you
  apply it. An X or Y beyond the board's limit of ±10,000,000 puts the item
  at that limit, and the field shows where it ended up; an item in a frame
  moves as far as it can, since the board also limits its position
  relative to the frame, and stays in its frame. When the board cannot
  store a position for another reason, "Position could not be set" appears
  and the fields go back to the real position. For a shape (also a symbol,
  a BPMN shape or an own shape) the panel has a tick "1:1": ticking it makes
  the shape square (the width counts, the height follows) and keeps it so –
  a typed width sets the height too, and dragging a corner on the board
  keeps it square, with or without Shift; untick it to drag freely. The
  tick belongs to the shape: everyone sees it, it survives a reload, and
  undo takes it back with the size. Symbols, BPMN events, gateways, the
  data store and the off-page reference start ticked; such a shape already
  on a board counts as ticked while it is square. Notes keep their own
  rule; frames and texts have no tick.
- **Only the caret while writing:** while you edit the text of a note, a
  shape, a text item, a frame title or a connector label, the item shows
  just its text and the blinking caret: no selection frame (on a connector
  no halo), no handles and no "+" handles. A text item shows its width only
  by where the text wraps. When the editor closes, the item stays selected
  and its frame and handles come back; a click elsewhere on the board ends
  the editor and then selects what lies there, as before. Other
  participants still see your selection and "X is editing…".
  The frame title's field has no white background any more; the connector
  label keeps its light background.
- **Right-click menu** on the canvas (in "Edit" only): on items the groups
  of the context bar's "…" in the same order (Cut, Copy, Duplicate · Bring
  to front, Send to back · Connect · Arrange…, Sort by color · Group items ·
  Lock), then what belongs to the spot (a table cell, a mind map node, a
  lane), "Save as image (PNG)", SVG, PDF, BPMN and CSV and "Suggest as
  template…" for the selection, and Delete last in the error colour, with a
  line between the groups; on empty canvas only "Mouse wheel", the
  facilitators' mass unlocks and "Show grid" (with "Snap to grid"). A right click on an item outside the selection
  selects it first; on empty canvas it clears the selection. While the canvas
  has the focus, the context-menu key or Shift+F10 opens it at the selection;
  with nothing selected, the board menu (the same as on empty canvas; screen
  readers announce it as "Board actions") opens in the middle of the canvas.
  Arrow keys, Home/End, Enter/Space and Esc work as in any menu, and the
  shortcut of each entry is shown. Inside an open text editor the browser's
  own menu stays.
- **Keyboard:** single-key shortcuts act only while the canvas has the focus;
  Tab/Shift+Tab select the items one by one (frames first, then by position)
  and Tab leaves the canvas after the last one; arrow keys move by 1 (Shift:
  10); Enter edits the text; "Arrange" sets position, size and angle by
  number. Tab in a note's editor saves it and starts the next note to its
  right (serial input).
- **Keyboard shortcuts overview:** press ? on the board, or choose "Keyboard
  shortcuts" in the zoom menu (also on tablets and phones) or in "More", to see every
  shortcut in groups (tools, editing, selection, view, while writing, with
  a mouse or pen), with the keys of your platform and only those that work
  in your current mode, plus the finger gestures (listed first on every
  device with a touch screen, also a laptop or a monitor with touch). Esc,
  a second ?, the close button or a click or tap beside it closes it; that
  click does nothing on the board, and your selection and your following
  stay.
- **Shortcut hints for your platform and language:** the keys named in
  tooltips (tool bar, context bar, zoom buttons, follow banner), in the
  right-click menu and in messages appear as Mac symbols on a Mac (⌘C, ⌘⇧Z,
  ⌫) and otherwise in the language of the interface (Ctrl+C, Shift, Del in
  English; Strg+C, Umschalt, Entf in German).

## Working together

- **AI: summarise and cluster:** in edit mode the context bar of a
  selection (or of one frame) has "Summarise" (sparkle) and "Cluster by
  topic". They show only for signed-in accounts with the right to edit,
  while the administrator allows AI and set up a provider for text in
  Nextcloud, and while the board's owner did not switch "Allow AI on this
  board" off in the share dialog. Before the first use a notice says what is
  sent ("Continue" confirms it once per account, again when the
  administrator changes the text). Only the text of the selected notes,
  text items and shapes and the frame titles (a selected frame with its
  items) go to the AI; names, votes, comments, reactions, tags and colours
  never do, and the AI answers in the language of the notes. While it works
  a chip "AI is working…" with "Cancel" stands at the bottom; the result
  lands even when the tab was closed meanwhile, and after a reload the chip
  is back. "Summarise" puts an AI card next to the selection on free space
  (right of it, else below, left or above; inside its frame when it fits)
  and brings it into view: white, with a sparkle and the header "AI summary" or
  "AI summary · <frame>", the Markdown shown formatted (headings, bold,
  italics, lists); it condenses the notes (a heading naming the subject, one
  or two sentences of overview, at most 6 key points) rather than listing them
  again. It moves, copies and deletes like other items, appears in
  the PNG, SVG and PDF export (formatted) and in the CSV (type "AI summary",
  the Markdown as text), but nobody edits it. "Cluster by topic" lays the
  notes out like "Sort by color", one block per topic in the AI's order with
  a text item as heading above each (notes the AI left out go to "Other"); it
  asks the AI for a few broad themes (about one per 3 notes, at most 8);
  notes that someone changed meanwhile stay where they are. Both are one
  undo step. Each account has at most 30 AI tasks a day (the administrator
  sets the number); a cancelled task counts.
- **AI: mind map, org chart or tree from a prompt:** under the same
  conditions as "Summarise" the tool bar ends with "Create with AI"
  (sparkle with the small label "AI", German "KI"). Every AI button (this one,
  "Summarise" and "Cluster by topic") draws its icon in the AI violet of the
  card's sparkle, a lighter violet in the dark theme. Its window offers
  "Mind map", "Org chart" and "Tree" and a
  field for the request (up to 1000 characters; Ctrl/⌘+Enter creates). Only
  the request goes to the AI, which answers in its language with at most 50
  nodes and 3 levels below the centre (more is cut off). While it works the
  window shows "AI is working…" ("Cancel" stops it); then a small preview
  with "Insert", "Try again" (a new task) and "Cancel"; an answer that cannot
  be used gives a message. "Insert" builds a normal mind map with the chosen
  layout in the middle of the view, selected, as one undo step. After a
  reload the window comes back with a result not yet inserted; the request
  itself is not stored. Each task counts against the daily limit.
  The fourth choice, "Flowchart", asks the AI only for steps (start/end,
  step, decision, document, data; at most 50) and arrows with short labels
  such as "yes"/"no" (at most 100); Knorke lays them out from top to bottom
  as flowchart shapes with right-angled connectors (an arrow back up runs
  around the right side). "Insert" puts them in the middle of the view,
  selected, as one undo step; they are normal shapes and connectors.
  The fifth choice, "Workshop", turns a description such as "retro for 8
  people, 60 minutes" into the parts of the workshop (at most 12): one titled
  frame per part with its length in the title ("Check-in (5 min)"), a note
  with the guiding question and a note pad beside it, like a built-in
  template. The frames stand side by side in the order of the parts, so
  "Frames as slides" shows them in that order. There is no timer.
- **Live collaboration:** cursors with names, other people's selections, drag
  previews and an "X is editing…" chip. Each person has one colour, one of
  the ten strong tones of the palette, in the presence bar, on their cursor,
  name tag, selection and laser, the same on every device; it is fixed per
  board (a guest: per guest session). Text editing holds a lease: a second
  person cannot silently overwrite what someone is typing, but can take over.
  The laser pointer (key K) draws a short glowing trail in your colour while
  you hold the mouse button, the pen or one finger down; everyone on the board
  sees it about a second later (phones about 2.5 seconds), also with the
  cursors hidden, and it fades after about a second. Nothing is saved and
  there is no undo step; two fingers still pan and zoom.
- **Hide other people's cursors:** the key C (in every mode, while the
  canvas has the focus)
  hides the arrows and name tags of the other participants; a short message
  confirms each switch. The cursor of the person you follow, and of the
  facilitator during "Bring everyone here", stays visible, as do the others'
  selections and "X is editing…". Like the grid, the setting belongs to this
  browser: it applies to every board and stays after a reload. The others
  still see your cursor.
- **Comments:** "Comments" (the speech bubble in the top bar, for every role
  and mode, on phones too) opens the list of the board's comment threads
  (a panel 296 px wide on the right, above the zoom controls) with the
  segment "Open / Resolved", newest first. Everyone who may edit or
  vote, guests of both links included, writes: "New comment" and then a
  click or tap on a note, shape, text, frame or table or on an empty spot,
  or in "Edit" "Comment" in the context bar (an item
  with an open thread opens that one). Others reply below; Enter sends,
  Shift+Enter makes a new line, at most 1000 characters. "Resolve" moves a
  thread to "Resolved", "Reopen" brings it back; everyone edits and deletes
  their own comments, the owner and "Can facilitate" delete any, and
  deleting the first comment deletes the thread after a question. "Can
  view" and a frozen board only read. Every open thread shows a speech bubble
  with its number: right of its item, just below its vote corner, following it when
  the item moves, or at its spot; a click or tap on it opens the comment
  panel with that thread and never selects or votes. "Show bubbles" hides them on every board of this
  browser. New comments appear live. Accounts type @ to mention someone who
  can see the board (while the admin restricts in Nextcloud's sharing
  settings whom users can find, the @ list shows only people you could find
  there too); when an account is deleted, its mentions read "@Deleted user",
  so a later account with the same user name never appears there; mentions and replies in threads you wrote in reach you
  through Nextcloud's notifications (and mail, as you set it), with a link
  that opens the thread. A thread keeps its spot when its item is deleted
  and hangs on it again when undo brings the item back. Comments are stored
  in Nextcloud's own comment table, without an app update; copies,
  templates, board files, PNG and CSV leave them out, and deleting the board
  deletes them.

## Sharing and guests

- **Sharing:** one edit link per board (on, off, renew). Guests without an
  account join with a name; signed-in users who open the link become members.
  Renewing the link removes everybody who joined through the old one. Knorke
  honours Nextcloud's "Allow users to share via link" setting and its group
  exclusion for the board's owner (see [Known limits](ADMIN.md#known-limits)).
  While the owner's account is disabled, its boards are closed like
  Nextcloud closes that account's files: guests see "Link sharing is
  disabled", everybody it shared with gets "not found" and no longer sees the
  board anywhere, until the account is enabled again (see
  [Settings](ADMIN.md#settings)).
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
  A board shared with a team also shows up among that team's resources in
  Nextcloud (the team view of the Contacts app, section "Knorke boards") with
  its title, a link and the Knorke icon, only for members of the team who may
  open it; while Circles is off it does not.
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
- **QR code and "Show to the room":** a small QR code per link in the dialog,
  and the section "Show to the room" after the links, with one button per
  active link, opens a full-screen view with a large QR code and the address
  for a projector. "People" and "Links" are a segment at the top.
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
- **Hints when you take someone off a share:** in "Share" → "People",
  an account that is also a member through a board link says "Also in
  through a link" (German: "auch über Link drin") below its name. Removing
  such a person shows a short note above the list that they stay on the
  board through the link, until the row is back or the list is saved.
  When a save takes "Can facilitate" from someone (removed or given
  another role; accounts, groups and teams alike) while a link is active,
  the dialog asks "Renew links?" (German: "Links erneuern?"): facilitators
  see the links and still know them. "Renew links" creates new links for
  every active link (the old ones and everyone who joined through them
  lose access; guests need the new links), "Cancel" keeps them as they
  are. Only the owner sees the mark; groups and teams are never marked.
- **Guest page:** Nextcloud's footer stays hidden, so the page shows the
  instance's legal notice and privacy policy links itself (from theming) in the
  name dialog, in the guest menu of the top bar and on the "link revoked/invalid"
  pages.
- **Nextcloud's sharing policy** applies to shares and links (see
  [Known limits](ADMIN.md#known-limits)).

## Facilitation

- **Moderation** for the owner and everyone with **Can facilitate**. The
  moderation menu in the top bar (on narrow screens the overflow menu) has
  "Start voting …", "Timer …" and "Bring everyone here"; while something
  runs, a section "Running now" adds "End voting", "End timer" and "Stop
  presenting", each when it applies.
- **Session bar:** timer, vote and presenting share one bar at the bottom
  centre, shown only while a timer exists, a vote runs or its results stand,
  or you present. In this order: the timer ("Timer 04:12"; facilitators
  click it for the timer dialog and end it with "×"), the vote ("Voting",
  "2 of 3 votes left", the time left and, for facilitators, "4 voted"; for
  facilitators also "+5 min", "List", "⋯" with "Edit voting …" and "Show
  live count", and "End"; everyone else "List") and "You're presenting" with
  "End". "Edit voting …" shows the running session's settings, which cannot
  change while it runs, and adds minutes to the time left. On a phone the
  bar spans the bottom edge with two lines (the votes left, then the time,
  the timer and the number of voters) and "List"; facilitators find the end
  entries and "+5 min" behind "⋯". In the two lines the timer is text only;
  facilitators open the timer dialog with "Timer …" in the menu.
- **Dot voting:** the setup dialog sets the votes per person (1–99), "One vote
  per item" (on by default; off allows several votes on one item), the area
  (whole board, or the selected frame when exactly one frame is selected), the
  item types (notes, shapes, text) and an optional time limit. It counts live
  how many items can get votes; at 0, "Start voting" stays disabled. While a
  session runs, everybody sees the vote in the session bar with the votes left
  and the time. Editors on a computer switch between "Vote" and "Edit" with a
  button that names the mode it switches to (a session starts in "Vote");
  tablets, phones and people with "Can vote" or the voting link vote
  automatically. Items that can get votes carry a white circle with "+" at
  their top right corner (your votes: a filled circle with the number, 28 px
  at every zoom, kept clear of the item's text) and the area is
  outlined; a click or a tap votes, also on the circle just outside the item
  (a 32 px target with the mouse, 44 px with a pen or finger), a second tap on the same item within 400
  ms is ignored (a double tap counts once), and the list votes without aiming
  (on phones it opens as a bottom sheet at the start). On touch devices a
  small item is zoomed in first. A tap on an item that cannot get votes says
  why. Votes are not part of undo. Lowering or taking back a vote never fails
  at the limit, also when an undo brought back voted items and the budget is
  overdrawn. Someone voting in two tabs or on two devices at once keeps every
  vote, also with several votes per item: a tab that had not seen the other
  one's vote adds its own on top (within the limits). A vote on an item that an editor moves out of the voting area
  during the session keeps counting (votes left, results); the server still
  accepts taking it back, but the list and the canvas offer no control
  for items outside the area. Facilitators see only how many people voted,
  never a distribution, unless "Show live counts to moderators" was ticked in
  the setup (off every time, fixed for the whole session): then the owner and
  everyone who may facilitate see the votes per item while the session runs
  (sums only, never who voted what). "Show live count" behind "⋯" in their
  session bar (off at the start and after a reload) shows the counts on the board, as hollow
  "live" numbers, on that screen only, so a projector shows nothing until it
  is switched on; their vote list gets a second tab "Live count" with the
  ranking. Everyone else sees "Moderators see live counts" in the session bar
  from the start (on phones an eye that shows the sentence on tap) and at the
  top of the vote list. "Accounts only" in the setup (off every time, fixed
  for the whole session) lets only signed-in accounts vote: the owner, people
  the board is shared with and everyone who opened a link while signed in.
  Everyone sees "Accounts only" in the session bar (on phones a person symbol
  that shows the sentence on tap); guests of the edit and voting links still
  watch the session, but their bar says "Only signed-in accounts can vote."
  with "Sign in", which opens the Nextcloud login in the same tab and comes
  back to the board as that account. A guest who opens such a link while the
  session runs already sees "Only signed-in accounts can vote right now."
  with "Sign in" in the name dialog and can still join as a guest (not on
  links with a password). "End voting" asks first. Then the
  ranking opens once for everyone (top three highlighted, "Copy results" as
  plain text); "Show on board" puts the totals on the items and "Close
  results" clears the bar's vote and the totals. A session with a time limit ends by itself;
  "+5 min" extends it.
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
- **Frames as slides:** facilitators start "Present frames" in the moderation
  menu (only on a board with frames; with exactly one frame selected, the
  presentation starts there). Only the current frame shows, as large as it fits,
  the rest of the board is covered and the bars step aside; nothing on the board
  can be changed meanwhile. The presenter's tab asks for full screen. Next slide:
  →, ↓, Page Down, Space, a swipe to the left (finger or pen) or "›"; previous:
  ←, ↑, Page Up, a swipe to the right or "‹"; Home/End go to the first/last;
  Esc or "End" ends it for everyone. The slide list on the right (open from
  900 px width, "Slides" shows or hides it) lists the frames in reading order
  at first; a click jumps to a slide, dragging the grip ⠿ (mouse, finger, pen)
  or Alt+↑/↓ on it changes the order, which is saved with the board. A deleted
  frame is skipped. Everyone on the board follows like "Bring everyone here"
  and sees the whole frame on their screen; "Look around myself" (or Esc)
  leaves, and "{name} is presenting · Follow" brings them back.
- **Private writing:** facilitators choose "Private writing …" in the
  moderation menu, then the whole board or one frame. Everyone keeps writing
  notes, but the new notes of the others show only as grey covered cards:
  the server sends them without text, colour or tags, so nothing reaches
  another browser early. Covered cards cannot be selected, edited, moved,
  copied or commented and are left out of the outline, search and CSV. The
  session bar shows "Private writing" for everyone; "Reveal" there (or
  "Reveal notes" in the menu) shows all notes at once. Facilitators see the
  covered cards too. No vote can start, and the AI cannot summarise or
  cluster, while it runs; the frame of private writing cannot be deleted.
  Lane, column and frame changes carry covered cards along (only their
  place changes); "Sort by color" leaves them where they are.

## Templates and export

- **Templates:** "Insert template…" in the "⋯" menu (in "Edit") opens a dialog
  with four structures, as tiles with a picture, a name and a sentence: Retrospective (start, stop, continue doing), SWOT analysis,
  Kanban (to do, doing, done) and Brainstorming with a parking lot. A click
  or tap on a tile picks it (marked as in "New board"; the arrow keys pick
  too), and "Insert" inserts the picked one; until then nothing is inserted
  and "Insert" stays off. Each template is a set of titled frames, each frame with one coloured note that holds a
  guiding question in your language. The template lands in the middle of
  your view on top of what is there (nothing is moved), the view shows it
  whole and its frames are selected; one undo takes it away again. An empty
  board shows the same tiles under "Start with a template" in its middle (as
  buttons, reachable with Tab), plus the adopted templates and "Blank", which
  hides them until the board is opened again; a tile inserts its template
  directly. The tiles go away with the first item and come back when the
  board is empty again. "New board" in the board list offers the same tiles.
- **Template suggestions:** signed-in accounts suggest any board they can
  see as a template with "Suggest as template…" in the "⋯" menu (in every
  role and mode), or just a selection with the same entry in the
  right-click menu. A window asks for a name (the board title to start
  with) and, if you like, a short note to the admins. A template keeps the
  items like a board file (no votes, reactions, locks or names of people),
  at most 1000 items and 2 MB; each account has at most 10 open
  suggestions. Nextcloud admins get a notification and decide in the Knorke
  section of the administration settings: "Adopt", or "Reject" after a
  question. There they also rename adopted templates and delete them, and
  their own "Save as template…" adopts a template at once. Adopted templates
  belong to the Nextcloud: every account finds them in "Insert template…"
  after the four built-in tiles, each with a small picture of its content,
  and a tile inserts the template like a board file: single items this
  version does not know or that are broken are left out, the rest is
  added, and a message says how many items could not be pasted. Whoever
  suggested a template sees it there as "Waiting for approval" until an
  admin decides, can withdraw it, and gets a notification of the decision.
  Guests of links and accounts of the Guests app see only the four built-in
  templates. The templates are stored in the database table
  `knorke_templates`, which came with app version 0.4.0 (`occ upgrade`
  once).
- **Board as a file:** "Download board" in the "⋯" menu, for everyone who
  can see the board (guests and viewers too, in every mode and on a frozen
  board), saves the whole board as "<board title>.knorke": every item with
  its text, colour and size, frames, groups, tables and connectors, plus the
  title, but no votes, reactions, locks or names of people. In "Edit",
  "Insert board file…" in the same menu picks such a file and adds its
  content to the open board: in the middle of your view, selected (the view
  moves only when it does not fit), and one undo takes it away again. Single
  items this version does not know (from a newer Knorke) or that are broken
  are left out and the rest is added, a connector only when both its ends
  come along; a message says how many items could not be pasted. A file
  that is not a valid Knorke board file as a whole adds nothing and says so;
  so does a file that would make the board hold more items than allowed.
  The open board keeps its title.
- **BPMN files:** "Save as BPMN" in the "⋯" menu (after "Save as PDF…",
  for everyone who can see the board) and in the right-click menu of a
  selection or a frame saves the BPMN diagram on the board as
  "<board title> <date>.bpmn", a BPMN 2.0 file with its layout that
  bpmn.io and the Camunda Modeler open. It holds the BPMN shapes, the
  connectors between them (sequence flows, message flows between pools,
  data associations, associations) and every frame with swimlanes that
  holds BPMN shapes or nothing as a pool with its lanes; the label of an
  event or gateway is its name (without a label it takes the text item next
  to it, at most 40 units away), and a note or text item joined to a BPMN shape by a connector
  becomes a text annotation. Everything else is left out. In "Edit",
  "Insert BPMN file…" in the same menu adds a .bpmn file from such tools
  to the board like a board file: shapes in their places and sizes, pools
  as frames with swimlanes (a lane with lanes inside as a lane group, deeper
  levels flat), names of events and gateways as their labels,
  text annotations as text items, flows as connectors. What
  Knorke has no shape for (a complex gateway, a group) is left out and
  counted in the message; other event types come in as the plain event
  (a signal start event as a start event), an expanded subprocess as a
  collapsed one behind its content. Colours and execution settings (for
  example of Camunda) are neither read nor written.
- **CSV import:** in "Edit", "Import CSV…" in the "⋯" menu picks a .csv,
  .tsv or .txt file and turns it into notes like cells pasted from a
  spreadsheet: one note per cell at its row and column, empty cells keep
  their place, quoted cells keep their line breaks, in the middle of your
  view, selected, and one undo takes them away again. Knorke finds the
  separator (tab, semicolon or comma) and the encoding itself, so a file
  that Excel saved keeps its umlauts. Above 100 notes it asks first, and a
  file makes at most 1000 notes (a message says when the rest was left
  out). Excel and OpenDocument files (.xlsx, .xls, .ods) are not read: a
  message asks to save the table as CSV first.
- **Save as image (PNG):** the "⋯" button at the top right ("More", after
  "Share", in both layouts) offers "Export ▸ As image (PNG)" to
  everyone who can see the board, guests and viewers included, in every
  mode; guests find the instance's legal notice and privacy policy in the
  same menu. In "Edit", the right-click menu of a
  selection or a frame saves just those items (with the content of a
  selected frame and the connectors between them). The image shows the
  items in full detail whatever the zoom, as sharp as the board at 200 %,
  on white with a small margin, with the reactions and the vote numbers you
  see on screen, but without selection, handles, grid, lock symbols or
  anyone's cursor. The file is named "<board title> <date>.png"; a board
  too large for the browser is saved smaller, with a notice.
- **Save as SVG and PDF:** right after "Save as image (PNG)", the same
  menus offer "Save as SVG" and "Save as PDF…", for the same people and with
  the same content as the PNG, but drawn as vectors: sharp at any size and
  never saved smaller. The SVG keeps every item as a group of its own and
  its text as text, so it can be edited in Inkscape, PowerPoint or a
  browser. The PDF is one page with the text in Helvetica so it can be
  searched and copied; "Save as PDF…" first asks for its page size: A4 or
  A3, where the content is fitted onto the page (larger or smaller,
  centred, 10 mm margin), portrait or landscape by its shape, or "Size of
  the content" (one board unit is one pixel at 96 dpi, very large boards
  are scaled down to fit a page of 200 inches). The browser remembers the
  choice for every board.
  The files are named "<board title> <date>.svg" and "….pdf".
- **Save as CSV:** for everyone who may edit the board (guests of the edit
  link too), in every mode, "⋯" also offers "Save as CSV", and in "Edit"
  the right-click menu of a selection or a frame saves just those items.
  Every note, text, shape with text and table becomes one row, frame by
  frame and in each from top left to bottom right, with the columns Type,
  Text, Color (its name in your language; a custom colour is named after
  the palette colour it looks most like), Frame, Reactions ("👍 3, 🎉 1")
  and Votes (the totals of the last finished vote, "0" for an item that
  could get votes in it but got none); a table is one row with its cells
  separated by " | ". The file "<board title> <date>.csv"
  opens in Excel and LibreOffice with its umlauts; in German and other
  languages with a decimal comma it is separated by semicolons, and so is a
  table's own "Export as CSV" now.

## Updates and connection problems

- **Clean reloads after an update:** a tab with an old bundle reloads exactly
  once per protocol version, also after a second update in the same session,
  and never while text or unsent changes are at stake.
- **Rarely used parts load on first use:** saving as SVG and PDF, BPMN
  files, importing shape libraries, the admin section and the share dialog
  come the first time someone uses them, so a board opens with less code;
  that first use waits a moment. If such a part cannot be loaded (for
  example after an update while the board was open), the message "This part
  of Knorke could not be loaded. Reload the page." appears and nothing else
  happens.
- **Connection errors without an answer from Knorke** (a 403 or 404 from a
  proxy or firewall) do not end the tab; it shows the connection notice and
  keeps trying. Closing a tab with unsent changes asks first, also when the
  board is frozen.
