/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Scenario list in EXECUTION order (SPEC-M0 §8.2). E09 rotates the link and
 * ends the shared world, so it runs last; the report is sorted by id.
 * E09b (app 429 on /sync, R3) is not in the §8.2 table: it guards the
 * frozen banner hook rate_limited on its own board. E13/E14 (R4, §15) guard
 * the review fixes T3 (leave guard) and T5 (editor flushed before unload),
 * each on its own board. E15–E17 (round 2, §15) guard U9/U10 (legal links on
 * the guest page), U11/U12 (Nextcloud's link policy) and U15 (status reload
 * freezes the board). E16 runs after E09: while the admin has link sharing
 * off, every link member and guest of the instance loses access, the shared
 * world's included.
 * SPEC-M1 §8.4 (stage 0): E18 (U8 in the browser), E19 (live title) and E20
 * (protocol jump) use their own boards and change no instance setting, so they
 * run before E09; cases of later stages that switch instance settings go
 * after E16.
 * SPEC-M1 §8.4 (stage 1): E21 (shapes, transformer), E22 (text items, serial
 * input), E23 (connectors, round 1b), E24 (copy/paste with the connector part
 * of 1b; Chromium, WebKit, Firefox as a report), E25 (frame resize with keep)
 * and E26 (keyboard and focus with "Connect" of 1b) use their own boards and
 * change no instance setting either: before E09, in id order.
 * SPEC-M1 §8.4 (stage 2, Revision 13): E27 (sharing), E28 (vote link, stage-2
 * part), E29 (link password), E30 (policy in the dialog) and E36 (LOD 2)
 * switch instance settings, share boards and change links, so they run after
 * E16, in id order; E36 changes no setting but §8.4 lists it there.
 * SPEC-M1 §8.4 (stage 3, Revision 16): E31 (voting), E32 (timer) and E33
 * (following) use their own boards and change no instance setting: before
 * E09, after E26, in id order. Their viewport passes (E31@390x844,
 * E31@820x1180, E33@…) follow their case; the passes of E28 (stage-3
 * additions) follow E28. A pass reports as "<id>@<pass>" and --only <id>
 * selects the case with all its passes (lib/cli.mjs reportId).
 * SPEC-M1 §8.4 (stage 4, Revision 19): E34 (write budget in the client) and
 * E37 (context menu, own board) change no instance setting: before E09,
 * after the passes of E33, in id order; E35 (purge during a session, bridge
 * purge-tombstones) goes with the cases after E16, in id order (before E36).
 * E12 keeps its place (the shared world; R19 adds the vote link page).
 * P7-C (SPEC-M1 §33.1 k, Revision 22): E09c (proxy 403/404 without an app
 * body on /sync, own board and own context, ctx.route) directly after E09b in
 * throttle.mjs, E38 (vote stepper, own board) directly after E37 in
 * stage4.mjs – both change no instance setting, so both run before E09; the
 * row tap of E31@390x844 lives in that pass (stage3.mjs).
 * MAX_BOARDS_PER_RUN stays 48 (scenarios/world.mjs).
 * Flake gate (P7-C, SPEC-M1 §33.1 l): --only E34,E35,E37,E38 --repeat 8.
 * Hotfix H1 (SPEC-M1 §35, Revision 24): E39 (touch editing on a phone that
 * reports a fine pointer, own board, no instance setting) directly after
 * E38, before E09; its flake gate is --only E39 --repeat 8.
 * Factory job 018: E40 (Esc clears the selection for a signed-in user after
 * the preventDefault of Nextcloud's header menus, pressed once and held; own
 * board, no instance setting) directly after E39, before E09; its flake gate
 * is --only E40 --repeat 8.
 * Factory job 023: E41 (lock items, own board, no instance setting; its pass
 * E41@390x844 follows it) directly after E40, before E09; its flake gate is
 * --only E41 --repeat 3.
 * Factory job 026: E42 (group items, own board, no instance setting; its pass
 * E42@390x844 follows it) directly after E41@390x844, before E09; its flake
 * gate is --only E42 --repeat 3.
 * Factory job 032 (M2 privacy notice): E43 (guests: name dialog, card once
 * per tab session, languages) and E44 (accounts: badge and one-time info;
 * the admin section) directly after E42@390x844, before E09. Both switch an
 * instance setting (theming URLs through the bridge, the notice through
 * route 27 as admin) and put it back in their `finally` (World.cleanup
 * once more).
 * Factory job 049: E45 (the board page after a final status on opening:
 * a stale list with a link, a bookmark, a deleted board on a phone with
 * touch; own boards, no instance setting) directly after E44, before E09;
 * its flake gate is --only E45 --repeat 3.
 * Factory job 135: E46 (colour picker in the context bar: the "#" field,
 * the row "On this board" for a second client, a frame through the system
 * picker; own board, no instance setting) directly after E45, before E09;
 * its flake gate is --only E46 --repeat 3.
 * Factory job 136: E47 (neighbour with one click: mouse row, empty notes
 * that stay (job 138), a finger tap on a phone; job 159: the "+" of a text
 * item hangs a connector, Alt+→ copies it; own board, no instance
 * setting) directly after E46, before E09; its flake gate is
 * --only E47 --repeat 3.
 * Factory job 137: E48 (the context bar at the selection; its passes
 * E48@820x1180 and E48@390x844 follow it; one board for the three, no
 * instance setting) directly after E47, before E09; its flake gate is
 * --only E48 --repeat 3.
 * Factory job 139: E49 (sort notes by colour; its pass E49@820x1180 follows
 * it; on E48's board, each in a part of the world of its own, so no board of
 * its own; no instance setting) directly after E48@390x844, before E09; its
 * flake gate is --only E49 --repeat 3.
 * Factory job 140: E50 (the selection frame with a gap at zoom 1 and 2,
 * multi and group frames, a remote frame of bob, the editor, a connector, a
 * press into the gap; own board, no instance setting) directly after
 * E49@820x1180, before E09; its flake gate is --only E50 --repeat 3.
 * Factory job 144: E51 (filter the selection with a finger on a tablet,
 * 1280 × 800, touch with a fine pointer; own board, no instance setting)
 * directly after E50, before E09; its flake gate is --only E51 --repeat 3.
 * Factory job 145: E52 (the shortcuts overview: ?, Esc, the "?" button by
 * keyboard and mouse, its place beside the zoom bar; its pass E52@360x780, a
 * phone in mode view, follows it; one board, no instance setting) directly
 * after E51, before E09; its flake gate is --only E52 --repeat 3. Factory
 * job 161 adds its steps (6)–(8) (? and a click beside it close it, a touch
 * laptop) and the pass E52@820x1180 (a tablet's tap beside it), between E52
 * and E52@360x780.
 * Factory job 147: E53 (hide other people's cursors: alice and bob, the key
 * C, the toast, a reload, the board menu's check box, following; own board,
 * no instance setting) directly after E52@360x780, before E09; its flake
 * gate is --only E53 --repeat 3.
 * Factory job 149: E54 (the live vote count for moderators: alice starts
 * with live, bob and Gina on a phone see the notice, the board counts
 * behind "Live count", the tab "Live count", bob never gets a tally, a
 * session without live; own board, no instance setting) directly after
 * E53, before E09; its flake gate is --only E54 --repeat 3.
 * Factory job 154: E55 (the mouse wheel zooms: the board menu's "Mouse
 * wheel" Automatic → Zoom → Pan → Automatic, the toast, a reload, a wheel
 * that zooms around the pointer and one that pans; own board, no instance
 * setting) directly after E54, before E09; its flake
 * gate is --only E55 --repeat 3.
 * Factory job 155: E56 (undo keeps other people's changes: alice and bob,
 * a recoloured note goes back with the new colour, a note bob moved stays
 * with the toast undo-changed, redo; own board, no instance setting)
 * directly after E55, before E09; its flake gate is --only E56 --repeat 3.
 * Factory job 156: E57 (right-drag pans: mode edit from a note, the menu of
 * a right click at the release, mode vote; own board, no instance setting)
 * after E55, before E09 (E56 is job 155's); its flake gate is
 * --only E57 --repeat 3.
 * Factory job 157: E58 (link previews and the Smart Picker: search, the
 * card through /references/resolve with and without access, no card for the
 * edit and join links, the picker providers; only HTTP, own board, no
 * instance setting) after E57, before E09.
 * Factory job 158: E59 (the second click opens a frame title only on its
 * text: a click on the text, one at 3/4 of the band, a double click there;
 * own board, no instance setting) directly after E58, before E09; its flake
 * gate is --only E59 --repeat 3.
 * Factory job 168: E60 (the pen's side button pans through CDP, a right-drag
 * of the mouse and of the pen beside an open editor leaves it open with its
 * text and caret, a right click beside it commits and opens the menu at the
 * release; own board, no instance setting) directly after E59, before E09;
 * its flake gate is --only E60 --repeat 3.
 * Factory job 171: E61 (the laser pointer: bob points with K, alice sees the
 * trail within 2.5 s and loses it within 4 s of the release, also with the
 * cursors hidden; own board, no instance setting) directly after E60, before
 * E09; its flake gate is --only E61 --repeat 3.
 * Factory job 172: E62 (emoji reactions on notes: alice, the guest Gina,
 * carol with vote and bob with view; the bar, the button, "More…" with its
 * chunk, the names, undo, a duplicate, delete + undo; own board, no
 * instance setting) directly after E61, before E09; its flake gate is
 * --only E62 --repeat 3.
 * Factory job 173: E63 (tables: create with B, two writers at once, "Take
 * over" at a cell, "+", "Delete column" and undo, a border and the header
 * row, a connector to the table, the CSV export; own board, no instance
 * setting; E62 is job 172's) directly after E62, before E09; its flake gate
 * is --only E63 --repeat 3.
 * Factory job 174: E64 (table keys and spreadsheet paste: an Excel grid
 * pasted into the open cell, bob sees it, Ctrl+Z, Tab in the last cell adds
 * a row, the arrows move, Esc; own board, no instance setting) directly
 * after E63, before E09; its flake gate is --only E64 --repeat 3.
 * Factory job 175: E65 (voting only with an account: alice starts with
 * "Accounts only", bob votes, a guest of the voting link and one of the edit
 * link on a phone see the notice and "Sign in" and cannot vote, the first
 * signs in as carol and votes on the same board, a session without the
 * option; own board, no instance setting; E64 is job 174's) directly after
 * E64, before E09; its flake gate is --only E65 --repeat 3.
 * Factory job 177: E66 (the text of a shape without fill grabs it: a click
 * on the text, a drag from it, a click at 3/4 of the inside, a double click
 * on the text; own board, no instance setting) directly after E65, before
 * E09; its flake gate is --only E66 --repeat 3.
 * Factory job 178: E67 (save as image: "⋯" downloads the PNG, its size and
 * pixels, 10 % and 150 % byte-equal, the frame's context menu, a guest with
 * the legal links, a viewer's overflow menu at 500 px; own board, the
 * theming legal links put back in its `finally`) directly after E66, before
 * E09; its flake gate is --only E67 --repeat 3.
 * Factory job 179: E68 (save as CSV: "⋯" downloads the CSV with BOM, header
 * and the rows in order, the frame's context menu its two notes, a viewer
 * has no export-csv, also not in the overflow menu at 500 px; own board, no
 * instance setting) directly after E67, before E09; its flake gate is
 * --only E68 --repeat 3.
 * Factory job 180: E69 (templates: the button of an empty board, Kanban
 * selected and in view, Ctrl+Z, bob with view sees it by sync without button
 * or menu entry, the context menu's entry and Esc, Tab and Enter in the
 * dialog; own board, no instance setting) directly after E68 (job 179's),
 * before E09; its flake gate is --only E69 --repeat 3.
 * Factory job 181: E70 (board as a file: "⋯" downloads "<title>.knorke"
 * without names, bob with view has no "Insert board file…", alice inserts
 * the file through the file picker, bob sees it, Ctrl+Z, a file "{}" toasts
 * board-file-invalid; own board, no instance setting) directly after E69,
 * before E09; its flake gate is --only E70 --repeat 3.
 * Factory job 184: E71 (the name dialog of a link says "Only signed-in
 * accounts can vote right now." with "Sign in" while a vote for accounts
 * only runs: voting link on a desktop, edit link on a phone, the sign-in as
 * carol, no note without the option or with a link password; own board, no
 * instance setting) in accounts.mjs, directly after E70, before E09; its
 * flake gate is --only E71 --repeat 3.
 * Factory job 182: E72 (template suggestions: bob suggests his board and a
 * note, sees both waiting and withdraws one, the admin is notified and
 * adopts in the settings, bob is told, alice inserts and undoes, the admin
 * saves one directly, renames and deletes, rejects another, a guest sees
 * the 4 built-in tiles only; own boards, no instance setting, every
 * template deleted before and after) directly after E71, before E09; its
 * flake gate is --only E72 --repeat 3.
 * Factory job 189: E73 (comments: a thread on a note with @bob, the guest's
 * reply live, bob's notification and link, the bubble following, deleting
 * and undo, resolve and reopen, the "c" in the field, deleting with the
 * question, "Show bubbles" after a reload; its pass E73@820x1180, a tablet
 * guest of the voting link during a vote, follows it; own boards, no
 * instance setting) directly after E72, before E09; its flake gate is
 * --only E73 --repeat 3.
 * Factory job 188: E74 (note pads: alice puts a pad into a frame with "Note
 * pad" of the note tool, drags a note off it, bob sees it, Ctrl+Z; a click on
 * the pile changes nothing; bob, guest of the edit link, writes the title
 * on the band and takes a note; locked, the band does not move, the pile
 * still gives notes; Enter puts a note beside it; a tablet finger takes one;
 * "Add note pad here"; in mode vote the pile gives nothing; own board, no
 * instance setting) directly after E73@820x1180, before E09; its flake gate
 * is --only E74 --repeat 3.
 * Factory job 191: E75 (tags on notes: alice tags two notes with Enter, bob
 * sees the labels within 3 s, Ctrl+Z; bob renames and recolours the tag;
 * "+7" lists eight tags; a copy into a second board creates the tag there;
 * alice filters while voting, bob sees nothing faded; bob deletes the tag;
 * own boards, no instance setting) directly after E74, before E09; its
 * flake gate is --only E75 --repeat 3.
 * Factory job 195: E76 (mind maps: alice builds one with M, Tab and Enter,
 * bob sees it within 3 s; both add a main branch at once and see the same
 * layout; bob drags a node onto another; alice folds a branch; an indented
 * list pasted becomes a mind map, "Copy as text" gives it back; a comment
 * on a node sits at it after a reload; own board, no instance setting)
 * directly after E75, before E09; its flake gate is --only E76 --repeat 3.
 * Factory job 196: E77 (mind map nodes placed freely: alice drags a node
 * onto empty space, both see it there with its child beside it and no node
 * under it; bob chooses "Rearrange" and both see the automatic layout
 * again; own board, no instance setting) directly after E76, before E09;
 * its flake gate is --only E77 --repeat 3.
 * Factory job 197: E78 (elbow connectors run around items: alice drags a
 * note between two connected notes, the line avoids it while the mouse is
 * still down and after release, bob shows the same points; own board, no
 * instance setting) directly after E77, before E09; its flake gate is
 * --only E78 --repeat 3.
 * Factory job 198: E79 (org charts and trees: alice switches a pasted
 * mind map to "Org chart", bob sees the cards in rows; "Tree" and back to
 * "Mind map" give the boxes of the start; in the org chart bob writes a
 * name and a role into a card and alice sees both; own board, no instance
 * setting) directly after E78, before E09; its flake gate is --only E79
 * --repeat 3.
 * Factory job 199: E80 (swimlanes: alice drags a frame with "Swimlanes" over
 * two notes, bob sees its three lanes within 3 s; a double click names lane
 * 1; "Move lane down" takes the lane and its note along, Ctrl+Z back; bob
 * drags the line below lane 1 by 100 and the note of a lower lane follows;
 * "+" and "Delete lane"; own board, no instance setting) directly after E79
 * (job 198's), before E09; its flake gate is --only E80 --repeat 3.
 * Factory job 200: E81 (save as SVG and PDF: alice saves the board from
 * "⋯" as PNG, SVG and PDF; the SVG drawn by the browser matches the PNG,
 * the PDF reads back with one page in Helvetica; 10 % and 150 % give the
 * same bytes; the context menu of a frame saves just it and its note;
 * carol finds both in the overflow menu; own board, no instance setting)
 * directly after E80, before E09; its flake gate is --only E81 --repeat 3.
 * Factory job 201: E82 (shapes panel: alice opens "Shapes", searches
 * "database" and drags its tile onto the board, clicks "Person" and then the
 * board, drops a tile on the panel without effect, hides "Symbols" and finds
 * it hidden after a reload with "Recently used" in order; pictures of the
 * libraries in light and dark; a guest of the edit link finds the foot of the
 * open panel inside it and "Zoom in" free; own board, no instance setting)
 * directly after E81 (job 200's), before E09; its flake gate is
 * --only E82 --repeat 3.
 * Factory job 203: E83 (own shape libraries: alice imports an SVG and a
 * draw.io library, places an own shape with Enter, suggests the library;
 * the admin adopts it in the settings; bob finds it in his panel; a guest of
 * the edit link sees the shape but only the built-in libraries; own boards,
 * no instance setting) directly after E82 (job 201's), before E09; its flake
 * gate is --only E83 --repeat 3.
 * Factory job 204: E84 (BPMN: alice drags a user task and the pool from the
 * section BPMN, clicks a gateway onto the board, connects two shapes and
 * makes the connector a message flow; own board, no instance setting)
 * directly after E83 (job 203's), before E09; its flake gate is
 * --only E84 --repeat 3.
 * Factory job 205: E85 (BPMN files: alice saves the diagram as .bpmn, bob
 * (view) may save but not insert, alice inserts a Camunda file and undoes
 * it, an invalid file toasts; own board, no instance setting) directly after
 * E84 (job 204's), before E09; its flake gate is --only E85 --repeat 3.
 * Factory job 208: E86 (swimlane columns: alice adds two columns from the
 * menu, bob sees them within 3 s; dragging a column's head takes the note
 * into the second column, dragging a lane's head into the last lane, Ctrl+Z
 * back; bob drags the first column's right edge by 100 and the note follows;
 * "Delete column" leaves it in place; own board, no instance setting)
 * directly after E85, before E09; its flake gate is --only E86 --repeat 3.
 * Factory job 225: E91 (lane and column groups: alice creates the lane group
 * "Team" from the menu, bob sees its cell within 3 s and the note 48 to the
 * right; the dragged edge takes lane 2 in, the dragged cell takes the note
 * below lane 3, Ctrl+Z back; "Dissolve lane group" restores it; a column
 * group reaches bob; own board, no instance setting) directly after E86,
 * before E09; its flake gate is --only E91 --repeat 3.
 * Factory job 219: E87 (board list favorites: alice stars a board, it stays
 * starred after a reload and alone in "Favorites", unstarring takes it out
 * at once; sort "Name", opening it, sort "Last opened" puts it first, and
 * the order stays after a reload; own boards, no instance setting) directly
 * after E86 (job 225: after E91), before E09; its flake gate is --only E87 --repeat 3.
 * Factory job 221: E88 (board list sketches: a board with a frame and two
 * coloured notes shows a sketch of 3 rects without text in its row, an
 * empty board the icon; route 57 answers only who may open the board; also
 * on a phone; own boards, no instance setting) directly after E87, before
 * E09; its flake gate is --only E88 --repeat 3.
 * Factory job 222: E89 (team resources: a board shared with a team is
 * among the team's resources of core's OCS team API for members who may
 * open it, not for others, gone without the share and while Circles is off;
 * only HTTP) switches Circles, so it runs with the cases after E16: after
 * E36, before M01.
 * Factory job 223: E90 (show everything clear of the bars: "Show
 * everything", "Zoom to selection" and the frame list put the content
 * beside the top bar, the tool bar, the zoom controls and an open comment
 * panel; own board, no instance setting) directly after E88, before E09;
 * its flake gate is --only E90 --repeat 3.
 * Factory job 226: E92 (the look of the redesign foundation: bars 44 px,
 * 52 px with a finger, 12 px radius for bars and menus, 16 px for dialogs,
 * shadows instead of borders, icons in the tool options, dark mode (b) with
 * a light canvas; own board, no instance setting) directly after E90,
 * before E09; its flake gate is --only E92 --repeat 3.
 * Factory job 228: E93 (the redesigned header: two islands with the canvas
 * between them, the title as a field, "More" with its submenus, the share
 * dialog's "Show to the room", the comment panel of 296 px, one closable
 * notice at a time and "Show everything" clear of it, 800 px, a guest on a
 * phone; own board, no instance setting) directly after E92, before E09;
 * its flake gate is --only E93 --repeat 3.
 * Factory job 229: E94 (the redesigned tool and zoom bars: eight buttons
 * under the left island, variants by a second click, a right-click or a
 * long press, "More tools", the shape tool opening the shapes panel, the
 * undo island, the zoom menu; E94@820x1180 a finger on a tablet,
 * E94@360x780 a phone; own board, no instance setting) directly after E93,
 * before E09; its flake gate is --only E94 --repeat 3.
 * Factory job 230: E95 (the redesigned context bar: its fixed order, the
 * colour panel with tabs beside the selection, "…" in fixed groups with
 * Delete last, the chip narrowing by kind and by tag, the right-click menu
 * with the same groups, the black swatch's edge in dark mode, a tablet with
 * a pen; own board, no instance setting) directly after E94@360x780 (job
 * 229), before E09;
 * its flake gate is --only E95 --repeat 3.
 * Factory job 231: E96 (the redesigned selection: four corner handles in
 * the primary color, the rotation handle near the top right corner, a
 * connection point near its edge on the frame and not on the neighbour,
 * dragging it connects; a tablet with a pen shows every handle at 14 px;
 * own board, no instance setting) directly after E95, before E09; its flake
 * gate is --only E96 --repeat 3.
 * Factory job 232: E97 (the redesigned board list: cards with the large
 * picture, the star under the pointer, "…", the switch "Grid / List" kept
 * after a reload, two columns on a phone, "New board" with a template and
 * the start tiles of an empty board; own boards, no instance setting)
 * directly after E95, before E09; its flake gate is --only E97 --repeat 3.
 * Factory job 233: E98 (the session bar: timer and vote at the bottom centre
 * instead of the header, clear of the other bars; the vote list 296 px on
 * the right; a vote through the badge outside its note; the comment bubble
 * right of its item opening the panel; "Running now"; × ends the timer;
 * "You're presenting · End"; the phone's two lines with 44 px buttons; own
 * board, no instance setting) directly after E97 (job 232's), before E09;
 * its flake gate is --only E98 --repeat 3.
 * Factory job 271: E99 (search on the board: the magnifier, Ctrl+F, two
 * hits, Enter from hit to hit with the frame, Esc; own board, no instance
 * setting) directly after E98, before E09; its flake gate is --only E99 --repeat 3.
 * Factory job 274: E100 (the board as an outline: "Board | Outline", a frame
 * heading with its notes, the loose note last, a change from elsewhere, the
 * Markdown download, a click back to the board without an op, Esc; own
 * board, no instance setting) directly after E99, before E09; its flake gate
 * is --only E100 --repeat 3.
 * Factory job 279: E101 (Markdown in notes: bold and a link drawn without
 * marks, "Open link", B, I, S and list in the open editor, B and Ctrl+I set
 * the marks; own board, no instance setting) directly after E100, before E09;
 * its flake gate is --only E101 --repeat 3.
 * Factory job 214: M01 (a measurement, no test: the vote list on a phone
 * with 3000 notes against the nearest M1 thresholds; own board, no instance
 * setting) comes last and runs only with --only M01 (measure: true).
 */
import { E01, E02 } from './basic.mjs'
import { E03, E04, E04b, E05 } from './collab.mjs'
import { E06, E07, E08, E09 } from './infra.mjs'
import { E10, E11 } from './canvas.mjs'
import { E12 } from './coldstart.mjs'
import { E09b, E09c } from './throttle.mjs'
import { E13, E14 } from './leave.mjs'
import { E15, E16, E17 } from './round2.mjs'
import { E18, E19, E20 } from './stage0.mjs'
import { E21, E22, E23, E24, E25, E26 } from './stage1.mjs'
import { E27, E28, E29, E30, E36 } from './stage2.mjs'
import { E31, E31_PHONE, E31_TABLET, E32, E33, E33_PHONE, E33_TABLET, E28_PHONE, E28_TABLET } from './stage3.mjs'
import { E34, E35, E37, E38 } from './stage4.mjs'
import { E39 } from './touch.mjs'
import { E40 } from './escape.mjs'
import { E41, E41_PHONE } from './locks.mjs'
import { E42, E42_PHONE } from './groups.mjs'
import { E43, E44 } from './privacy.mjs'
import { E45 } from './final.mjs'
import { E46 } from './colors.mjs'
import { E47 } from './neighbour.mjs'
import { E48, E48_PHONE, E48_TABLET } from './place.mjs'
import { E49, E49_TABLET } from './sort.mjs'
import { E50 } from './gap.mjs'
import { E51 } from './filter.mjs'
import { E52, E52_PHONE, E52_TABLET } from './shortcuts.mjs'
import { E53 } from './cursors.mjs'
import { E54 } from './live.mjs'
import { E55 } from './wheel.mjs'
import { E56 } from './undo.mjs'
import { E57 } from './rightdrag.mjs'
import { E58 } from './references.mjs'
import { E59 } from './titleclick.mjs'
import { E60 } from './penbutton.mjs'
import { E61 } from './laser.mjs'
import { E62 } from './reactions.mjs'
import { E63, E64 } from './tables.mjs'
import { E65, E71 } from './accounts.mjs'
import { E66 } from './shapetext.mjs'
import { E67 } from './exportpng.mjs'
import { E68 } from './exportcsv.mjs'
import { E69 } from './templates.mjs'
import { E70 } from './boardfile.mjs'
import { E72 } from './owntemplates.mjs'
import { E73, E73_TABLET } from './comments.mjs'
import { E74 } from './notepad.mjs'
import { E75 } from './tags.mjs'
import { E76, E77, E79 } from './mindmaps.mjs'
import { E78 } from './routearound.mjs'
import { E80 } from './lanes.mjs'
import { E81 } from './exportvector.mjs'
import { E82 } from './shapes.mjs'
import { E83 } from './shapelibs.mjs'
import { E84 } from './bpmn.mjs'
import { E85 } from './bpmnfile.mjs'
import { E86 } from './lanecols.mjs'
import { E91 } from './lanegroups.mjs'
import { E87 } from './favorites.mjs'
import { E88 } from './sketches.mjs'
import { E89 } from './teamresources.mjs'
import { E90 } from './fitclear.mjs'
import { E92 } from './look.mjs'
import { E93 } from './header.mjs'
import { E94, E94_TABLET, E94_PHONE } from './toolbars.mjs'
import { E95 } from './contextbar.mjs'
import { E96 } from './selection.mjs'
import { E97 } from './boardlist.mjs'
import { E98 } from './sessionbar.mjs'
import { E99 } from './search.mjs'
import { E100 } from './outline.mjs'
import { E101 } from './markdown.mjs'
import { M01 } from './votelist.mjs'

export const SCENARIOS = [E01, E02, E03, E04, E04b, E05, E06, E07, E08, E10, E11, E12, E09b, E09c, E13, E14, E15, E17, E18, E19, E20, E21, E22, E23, E24, E25, E26, E31, E31_PHONE, E31_TABLET, E32, E33, E33_PHONE, E33_TABLET, E34, E37, E38, E39, E40, E41, E41_PHONE, E42, E42_PHONE, E43, E44, E45, E46, E47, E48, E48_TABLET, E48_PHONE, E49, E49_TABLET, E50, E51, E52, E52_TABLET, E52_PHONE, E53, E54, E55, E56, E57, E58, E59, E60, E61, E62, E63, E64, E65, E66, E67, E68, E69, E70, E71, E72, E73, E73_TABLET, E74, E75, E76, E77, E78, E79, E80, E81, E82, E83, E84, E85, E86, E91, E87, E88, E90, E92, E93, E94, E94_TABLET, E94_PHONE, E95, E96, E97, E98, E99, E100, E101, E09, E16, E27, E28, E28_PHONE, E28_TABLET, E29, E30, E35, E36, E89, M01]
