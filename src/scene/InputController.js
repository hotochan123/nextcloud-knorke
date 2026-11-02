/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pointer and keyboard logic of the scene (SPEC-M0 §6.3, v2 in SPEC-M1 §6.3,
 * §6.10) for everything that is not a camera gesture: selection (click,
 * Shift+click, marquee, Ctrl/⌘+A, Tab), dragging (threshold 3 px, only the
 * top-level selected items), transformer handles, the create tools, double
 * click → text editor, and the keyboard shortcuts.
 *
 * Mouse and pen arrive here unless the GestureController pans with them
 * (hand tool, space, middle button, view-only). Touch arrives here only when
 * the GestureController let this controller claim it (claimTouch: a first
 * finger on an unlocked item or a handle in edit mode; (H1, SPEC-M1 §35) with a
 * create tool or the connector any first finger, and the touchend of a
 * finger that created an item is cancelled: no click lands on the new
 * editor or the context bar). (R38, SPEC-M1 §6.3) A first finger held still
 * on empty canvas reaches it over claimLongPress when the GestureController's
 * hold timer runs out: with the select tool, no press running and nothing
 * (no handle, no unlocked item) under the pointerdown point it becomes a marquee
 * press that starts beyond TAP_SLOP_PX (not DRAG_THRESHOLD_PX) and replaces
 * the selection like a mouse marquee without Shift; the selection stays
 * until then. The scene shows the hold signal (host.holdSignal: ring and
 * vibration) at once; every end of that press (release, Esc, pointercancel,
 * a second finger, settle, destroy) hides the ring again (holdSignal(null)).
 * A mouse or pen pointerdown goes before every press a finger started (a
 * palm resting on a pen tablet: held on empty canvas, on an item, with a
 * create tool or the connector; job 134): that press ends like Esc (no
 * create, no connector, a drag springs back, a marquee goes, no intent; the
 * selection the finger set at its pointerdown stays) and the mouse or pen
 * works as usual; the finger stays without effect until it lifts, and the
 * GestureController keeps every finger out while the pen press runs. A
 * second finger (cancelTouch) aborts only a press a finger started, like
 * Esc; a mouse or pen press goes on.
 * In modes vote and view
 * nothing is selected, dragged or created here; (stage 3) a click or tap in
 * mode vote reaches the scene as GestureController.onTap, which asks hitAt()
 * for the item (SceneManager: vote, voteMiss, small-target zoom).
 *
 * Hit testing: transformer handles first, in screen space (HANDLE_PX for a
 * mouse, HANDLE_TOUCH_PX for touch and pen), then SceneModel.hitTest only
 * (4 px / scale for mouse and pen, 12 px / scale for touch). (job 140) In
 * mode edit an item of the own selection (not a connector) also hits in the
 * gap around its box, up to SELECTION_GAP_PX plus that tolerance outside it
 * per axis of its rotated box (a press, the hover cursor, a right click, a
 * double click, a finger claim); the topmost hit wins. The controller
 * talks to the scene via a small host object; it never touches Konva.
 * (job 170) A shape without fill (fillOpacity 0) is like a frame: with the
 * select tool, not at LOD 2, the hit of every press or click (mouse and pen,
 * a finger's claimTouch, claimLongPress, claimDrag and tap, the context menu
 * and the right click, the double click) passes the model its option
 * hollow, so such a shape hits only in its border band (FRAME_EDGE_HIT_PX
 * plus the tolerance, in screen px, plus half its stroke inside its outline;
 * outside it the tolerance and the gap as before) and its empty inside hits
 * what lies under it or empty canvas, with all the rules of empty canvas
 * (the marquee, a finger's pan, job 163 in the selection frame). A double
 * click whose hit is nothing opens the editor of such a shape there as
 * before. The marquee does not take such a shape while its outline holds
 * all four corners of the rectangle. hitAt (mode vote) keeps the whole
 * inside.
 * (job 177) The text of such a shape grabs it, like a frame's title: with
 * hollow the model also gets the scene's host.shapeTextRect (the block of the
 * text lines the shape draws now, at LOD 0 only, measured per press), and a
 * point of the empty inside within that block grown by the tolerance (4 px
 * for the mouse and pen, 12 px for a finger, in screen px) hits the shape
 * with all the rules of a hit on it (a click selects it, a drag moves it, a
 * finger is claimed, the menu and the double click are the shape's); items
 * above the shape still win, items below it lose there. The marquee rule
 * (inUnfilled) stays, also over the text; a second click on the text opens
 * no editor.
 * (job 172) A press on a note's reaction row (a pill, "+n", the smiley-plus
 * button) never reaches this controller: SceneManager takes it before the
 * gesture controller and, when it moves on beyond the tap threshold, hands
 * it over by sending its pointerdown again, so it acts as it would there.
 * The band of the one selected note's row (host.reactBand) counts like the
 * gap of the selection frame.
 *
 * Keys v2 (WCAG 2.1.4): single keys (tools, Delete, arrows, Enter, Tab, Space,
 * zoom keys) work only while the canvas has the focus (the scene container,
 * tabindex 0; a click on the canvas focuses it, (R9) in mode edit a finger
 * too, and like a click it ends an open text editor with its commit (job
 * 168: a right press beside the editor does neither, below); in vote
 * and view a finger does not focus). Ctrl/⌘ combinations stay window wide
 * (outside text fields and dialogs), Esc too. A key another listener already
 * cancelled (defaultPrevented) is left alone, except Esc on the canvas host
 * itself: Nextcloud's header menus (NcHeaderMenu, e.g. the notifications)
 * listen on the window before the scene and call preventDefault on every Esc
 * outside text fields (@nextcloud/vue useHotKey('Escape', …, { prevent:
 * true })), so honouring it there would leave Esc without effect for every
 * signed-in user. Ctrl/⌘+C/X/D fire
 * copy/cut/duplicate synchronously in the keydown with preventDefault, except
 * while the page has a DOM text selection (then the browser copies the text:
 * no intent, no preventDefault). Ctrl/⌘(+Shift)+V fires pasteKey
 * synchronously and WITHOUT preventDefault, so the DOM paste event follows.
 * (M2, SPEC-M1 §1.2 (R12)) G with the canvas focus toggles the background
 * grid (host.toggleGrid) in every mode, like a tool key without
 * preventDefault; not with Shift, Alt or Ctrl/⌘ (Ctrl/⌘+G and
 * Ctrl/⌘+Shift+G group and ungroup, below), not on auto-repeat and not
 * during a press. (job 145) ? (e.key, with or without Shift, never with
 * Ctrl/⌘ or Alt) with the canvas focus asks for the shortcuts overview
 * (host.showShortcuts) in every mode, with preventDefault; no intent (the
 * selection, the tool and following stay), not on auto-repeat and not
 * during a press. (job 147) C (e.key c or C) with the canvas focus shows or
 * hides other people's cursors (host.toggleCursors) in every mode, like G:
 * no preventDefault, not with Shift, Alt or Ctrl/⌘ (Ctrl/⌘+C copies), not
 * on auto-repeat and not during a press.
 *
 * Connectors (round 1b, SPEC-M1 §6.3): the connector tool (L) turns a drag
 * into a new connector from the press point (a click creates nothing and
 * keeps the tool); a drag on a "+" handle (plus-t/r/b/l) does the same from
 * its anchor, a drag on an end handle (start, end) of a selected connector
 * re-targets that end. Ctrl/⌘ during such a drag suppresses snapping (also
 * when pressed or released without moving); Esc cancels. The marquee takes
 * a connector only when its route box lies completely inside.
 *
 * Neighbour with one click (job 136): a press on a "+" handle that ends
 * without moving beyond the threshold (mouse and pen DRAG_THRESHOLD_PX, a
 * finger TAP_SLOP_PX, so a trembling finger draws no tiny connector) gives
 * (note and shape; job 159: a text item's connector hangs, below)
 * {type: 'neighbour', id, side, connect: {route, endCap}} for the item of the
 * handles (host.plusItem; job 148: connect = the connector tool options,
 * host.toolOptions('connector'), as for a drag from "+"); beyond it the
 * press draws a connector as before. (job 148) A press that ends an open
 * editor (finishEditor at the pointerdown, like at every click beside it)
 * hits no handle, not even one that shows again after the editor: it acts
 * like a press there without handles (an item, the marquee, empty canvas).
 * The touchend of such a tap (finger or pen: a pen on a tablet sends touch
 * events too) is cancelled like after a create (H1). Alt (Option)
 * +arrow with the canvas focus in mode edit always gets preventDefault (Alt+←
 * is the browser's Back) and, without Ctrl/⌘ (AltGr) and Shift, not on
 * auto-repeat, without a press and with exactly one selected note, shape or
 * text item, fires the intent without connect; side = the side whose rotated outer
 * normal lies closest to the arrow on screen (sideToward). In the text
 * editor Alt/Option+arrow stays text navigation (the editor keeps its keys).
 *
 * Hover (job 162): a mouse or pen without a press reports the handle under it
 * and its pointerType (host.setHoverHandle(name, type)) whenever either
 * changes; the scene shows the cursor of that handle and, for the mouse, the
 * preview of a "+". Every pointerdown on the canvas reports the handle again
 * with type null (the preview goes, the cursor stays), so the next hover
 * after the release reports anew; leaving the canvas without a press
 * reports (null, null). A finger never hovers. (job 231) Every hover move
 * hands host.pointer the world point and the container point (pointer(w,
 * sp)); a move during a press and leaving the canvas give no container
 * point: the scene shows the rotation handle and the connection points near
 * the hover only.
 *
 * Hanging connector (job 159): the click or tap on a "+" of a text item gives
 * no intent; a connector starts at its anchor (host.beginConnectHandle with
 * hang) and hangs there without a press, its preview at the release point.
 * A mouse or pen without a press (hover) moves the preview (snapping, Ctrl/⌘
 * free at once); the next press of the main button or a pen sets the end at
 * its release and hits no handle, selects nothing, moves nothing. A finger is
 * not claimed meanwhile: its tap (tap) sets the end with the finger's
 * tolerance, a swipe pans, two fingers zoom, a hold does nothing. A release
 * in the hit circle of that "+" (host.hangPlusAt) gives no connector, nor
 * does a free end in the text item (ConnectController); the touchend after
 * the tap on "+" and after the one that sets the end is cancelled (H1). Esc,
 * a right click, any other contextmenu of a mouse or pen (no menu; a finger's,
 * Android's long press, is only prevented), cancel and settle drop it
 * without a connector; a pointercancel only drops the press that would set
 * the end. While it hangs the controller is busy: the keys act as during a
 * press.
 *
 * Snapping of a drag (M2, SPEC-M1 §1.2 (R12)): host.moveDrag gets {ctrl}
 * with every step; the scene snaps the dragged selection to the edges and
 * centres of the items in view unless ctrl is set. As for a connector,
 * Ctrl/⌘ pressed or released during the drag acts at once (moveDrag with
 * the last pointer position); the next pointer move reads the modifier from
 * the event again, so a missed keyup corrects itself. A resize with a
 * transformer handle snaps the same way: host.moveTransform gets {ctrl}
 * besides Shift and Alt, and Ctrl/⌘ pressed or released acts at once
 * (moveTransform with the last pointer position).
 *
 * LOD 2 (SPEC-M1 §6.3 R13 (c), host.coarse()): (job 209) connectors are
 * painted as thin lines there (job 202), so a click, a pen press, a finger's
 * tap, a double click, a right click and the marquee reach them as at LOD
 * 0/1; only a finger's press (the touch claim and the press it starts) and
 * the hits of mode vote (hitAt) pass over them: a finger on a line pans the
 * overview, and a vote tap is never taken by a line. (R14-13, rule (d)) A frame hits
 * there also in its painted title (host.coarseTitleAt): content under the
 * point wins (LOD 2 paints content above every frame and title); the title
 * wins over another frame hit only by its title band or border band (at LOD
 * 2 an invisible ≈ 2-px band and a 12-px zone around a 1-px line, while the
 * title is painted text; frames stacked with a small gap would otherwise
 * hide the lower title in the upper frame's border band). settle() ends a
 * press like a release (setMode with settle), cancel() like Esc.
 *
 * Context menu (SPEC-M1 §9.5 WP-S4 (R16), frozen in stage-4 step 4.2): the
 * intent {type:'contextMenu', id, at:[x, y]} (at in container px, like
 * vote.rect), only in mode edit. Pointer path, from the canvas's
 * contextmenu event, checked in this order:
 *  1. a contextmenu from an overlay control (the text editor, a chip button)
 *     or while a text editor is open: nothing at all, no preventDefault (the
 *     browser's own menu stays, e.g. spelling); every other contextmenu on
 *     the canvas gets preventDefault (no native menu over the board);
 *  2. modes vote and view: no intent (preventDefault only, as before);
 *  3. no pointerdown on the canvas since the last contextmenu, or the
 *     ContextMenu key / Shift+F10 since that pointerdown: the echo of the
 *     key (handled by the keydown below) or a synthetic event, no intent;
 *  4. a finger (the event's pointerType when the browser sets one, else the
 *     type of that pointerdown): no intent, no long press on touch (job 173:
 *     the hold timer of a finger on the selected table is its own way, below);
 *  5. a press that already moved (drag, transform, connect, marquee, create
 *     drag) goes on, no intent; a touch gesture, a mouse/pen pan or a finger
 *     below the tap threshold: no intent; a wheel gesture or a follow glide
 *     ends first (host.menuReady: the camera shown becomes the confirmed one);
 *  6. a press that has not moved (macOS Ctrl+click and a pen held still both
 *     fire contextmenu after a button-0 pointerdown) is dropped like Esc
 *     before step 7: it starts no drag, marquee, transform, connect
 *     or create (with a create tool nothing is created; every tool stays);
 *  7. the item under the event point (same hit rules as a click, mouse
 *     tolerance): on a transformer handle of the selection (handleAt) the
 *     selection stays and id = the hit item when it is selected, else the
 *     last selected item; an item outside the selection is selected first
 *     (onSelection before onIntent); an item inside keeps the selection;
 *     empty canvas clears the selection like a click there, id = null.
 *     Modifier keys change nothing. at = the event point.
 * Keyboard path: the ContextMenu key or Shift+F10 (no Ctrl/⌘/Alt) with the
 * canvas focus, mode edit, no press and the conditions of 5 → preventDefault
 * on the keydown and the intent with id = the last selected item (the one
 * Tab treats as current) or null, at = host.menuAnchor (the midpoint of the
 * selection's screen box clamped into the container, the container centre
 * without a selection).
 * Right click (factory job 156): a right press on the canvas (not an overlay
 * control; the right mouse button, job 168: or the pen with its side button,
 * GestureController isRightPress) starts nothing here (no marquee or drag:
 * button 0 only), it only focuses the canvas; the GestureController pans
 * with it beyond its threshold (DRAG_THRESHOLD_PX, the pen TAP_SLOP_PX).
 * Released within it, the scene calls rightClick at the pointerup: in mode
 * edit rules 5–7 at the release point (mouse tolerance; the pen reaches a
 * handle with the touch radius), in modes vote and view nothing. The
 * contextmenu event of that press, the first one after its pointerdown
 * (macOS, Linux) or its pointerup (Windows), gets preventDefault and opens
 * nothing, wherever it lands: on the canvas, on an overlay control, outside
 * the canvas (the listener sits on window; a new pointerdown on the canvas,
 * a pointercancel and the menu keys forget it). Rule 4 holds for the mouse's
 * too: a finger's contextmenu (its pointerType) before the pointerup drops
 * the menu of the release; (job 168) the pen's comes with any pointerType
 * and drops nothing. Later contextmenu events follow rules 1–7 on the canvas
 * and stay the browser's outside it.
 * (job 168) A right press beside an open text editor (of any kind) leaves it
 * open: the canvas takes no focus, the browser's own focus change at the
 * compatibility mousedown is prevented, so the text field keeps the focus,
 * its text and its caret, and there is no commit. Its pan moves the editor
 * with its item; a pointercancel or a move without a button ends it with
 * the editor still open. Only its click ends the editor, at the release
 * (rightClick): with its final commit like a click beside it, the canvas
 * takes the focus, then the menu (mode edit). A right press into the editor
 * stays the browser's, as before.
 *
 * Locked items (M2, SPEC-M1 §1.2 "(R20) Sperren", model/locks.js; job 151:
 * like background): a press of the mouse or a pen whose hit (no handle) is
 * a locked item leaves the selection alone; a release without a move past
 * DRAG_THRESHOLD_PX selects it by the click rules (a click selects it alone,
 * Shift toggles, a click into a multi-selection narrows it, groups as
 * below), a move past it draws the marquee from the press point as on empty
 * canvas (without Shift the selection goes when the marquee starts, Shift
 * keeps the one from before the press; nothing moves, the camera neither).
 * A first finger on a locked item without a handle under it is not claimed
 * (#takenAt): it pans, a hold draws the touch marquee (claimLongPress), and
 * its tap (the scene's onTap in mode edit) selects by the click rules (tap).
 * A drag of a selection moves only its unlocked top-level items (the scene,
 * beginDrag); a drag on its locked part draws the marquee (job 163: outside
 * the selection frame, below). The marquee and
 * Ctrl/⌘+A skip locked items (Shift keeps what was selected); Tab still
 * reaches them (the keyboard way to Unlock). Ctrl/⌘+Shift+L (window wide
 * like the other Ctrl/⌘ keys, outside text fields and dialogs) always gets
 * preventDefault and, in mode edit without a press, fires the intent
 * {type: 'toggleLock'}.
 * (job 190) Locked items by marquee: with Alt (Option) held a marquee takes
 * only the locked items among its candidates (the hits by the rules above,
 * groups expanded) instead of the free ones; without Shift that replaces the
 * selection, with Shift (read at the pointerdown) it joins the selection from
 * the press. Every marquee does so (empty canvas, from a locked item, a held
 * finger); Alt is read at every move of the marquee, and its keydown and
 * keyup during one switch at once at the last point (like Ctrl/⌘ during a
 * drag). The keyup of Alt after a marquee that ran with Alt gets
 * preventDefault (Windows: releasing Alt alone focuses the browser's menu).
 * A marquee released without Alt and without Shift whose last candidates held
 * locked items offers exactly those (host.lockedOffer, the scene's offer:
 * the context bar's "Select n locked items"); Ctrl/⌘+A offers every locked
 * item of the board. No offer after an Alt or Shift marquee or a marquee
 * that Esc, pointercancel, a second finger, cancel or settle ended. The
 * offer ends (host.lockedOffer(null)) with the next press of the main
 * button or a pen, a claimed finger (claimTouch, claimLongPress, claimDrag),
 * a finger's tap (tap) and Esc; a pan or zoom (an unclaimed finger, space,
 * the hand tool, middle and right button, the wheel) keeps it.
 *
 * Groups (M2, SPEC-M1 §1.2 "(R20) Gruppieren", model/groups.js): a press
 * on X whose group G (members M) counts (groupOf), in mode edit with the
 * select tool:
 *   X not selected      → selection M with X last (a drag moves M);
 *                         Shift: M joins the selection whole
 *   selection = M       → a release without a drag narrows to [X] (second
 *                         click); a drag moves M; Shift: M leaves whole
 *   selection = [X]     → stays (a drag moves X alone); Shift: M leaves
 *   X selected, else    → a release without a drag selects M with X last;
 *                         a drag moves the selection; Shift: M leaves
 * Items without a group behave as before; a locked X selects by the same
 * rules at the release (a move draws the marquee). A double click opens X's editor as before
 * (first click M, second [X], then the editor). The marquee takes every
 * member of a group it hits (locked ones left out); a right click on a
 * member outside the selection selects M first (X last). Enter on a
 * selection that is exactly one group is the keyboard way to the double
 * click (round 1, UX review): it narrows the selection to the current item
 * (the last one), like the second click, and then opens its editor when it
 * has a text path and is not locked. The group is no longer fully
 * selected afterwards, so the next Tab reaches the next member (WCAG
 * 2.1.1: every member's text is editable without a mouse).
 * Ctrl/⌘+G (without Shift and Alt) and Ctrl/⌘+Shift+G always get
 * preventDefault (else the browser finds on) and, in mode edit without a
 * press, fire {type: 'group'} and {type: 'ungroup'}.
 *
 * Drag in the selection frame (job 163, as in Miro): host.dragFrame() is
 * the frame R of the own selection (the dashed frame of a multi-selection,
 * the frame of exactly one group; null without one, the scene's rules). A
 * press of the main button or a pen without Shift whose point lies in R,
 * grown by its hit tolerance per side, with no handle under it (and not a
 * press that ends an open editor) changes nothing at its pointerdown when
 * its hit is nothing, an unselected item or a locked one: beyond the
 * threshold it moves the whole selection (beginDrag with all of it and no
 * lead, the hit stays where it is; false: nothing until the release), a
 * release without a drag clears the selection on empty canvas and else
 * clicks the hit by the rules above (it alone, a member with its group,
 * job 151 for a locked one). A selected unlocked hit, Shift and every press
 * outside R work as before. A finger claimed on an unselected item in R
 * (claimTouch) follows the same rules with TAP_SLOP_PX as its threshold. A
 * first finger that is not claimed (nothing or a locked item under it) is
 * asked for over claimDrag when it moves beyond TAP_SLOP_PX before its hold
 * runs out: the drag of the selection starts from its pointerdown point
 * when that lies in R (finger tolerance) without a handle or an unlocked
 * item, else it pans as before.
 *
 * Second click on a frame title (job 143): with the select tool, a press of
 * the main mouse button, a pen or a finger without Shift on the title band
 * of a frame F (the press hits F above its top edge, the double click's
 * rule) while the selection was exactly [F] before the pointerdown, F not
 * locked, opens F's title editor at the release like Enter
 * (host.editFromUser: the lease rule and "Take over" apply), with or
 * without a title; a press beyond the threshold drags as before. (job 158)
 * Only from F's text zone: the press lies at most max(tw +
 * TITLE_CLICK_PAD_PX, TITLE_CLICK_MIN_PX) screen px right of F's left edge,
 * tw the width of the text F shows in its band (host.titleTextWidth,
 * measured at the pointerdown: its title, "Add title…" while that hint is
 * drawn, at LOD 2 its painted title); without such a text there is no
 * zone. A press on the band beside the zone keeps [F] (no editor, no
 * intent, its touchend stays, so a double tap still works) and drags as
 * before. The first
 * click only selects; a click into a multi-selection narrows it and opens
 * nothing; the border opens nothing. The touchend of a finger or pen press
 * that asked for the editor this way is cancelled like after a create (H1):
 * no compatibility click lands on the new editor (or a "Take over" chip
 * under the finger). A double click opens the title editor on the whole
 * band at every level of detail; on the text of an unselected frame it
 * opens the editor at its second release, its dblclick then finds the
 * editor open and changes nothing.
 *
 * Laser pointer (job 171): with the tool laser in mode edit a press of the
 * main button, a pen or a finger (claimTouch takes every first finger with
 * it) is a laser stroke: host.laser(sp) at its pointerdown and at every
 * move, host.laser(null) at its end (release, a move of its mouse or pen
 * without a button, Esc, pointercancel, cancel and settle: a second finger,
 * a mouse or pen press over a finger's stroke, a mode switch, another
 * tool). It hits nothing, selects, moves and creates
 * nothing, gives no intent and keeps the tool. Esc with the laser tool ends
 * a running stroke and chooses select; the selection stays. A contextmenu
 * during a stroke (a pen or mouse held still) gets preventDefault and opens
 * nothing; the stroke goes on. Right, middle button, the pen's side button
 * and space still pan.
 *
 * Pen (job 273): with the tool pen in mode edit a press of the main button,
 * a pen or a claimed finger is a stroke: host.ink(sp, 'down', coarse) at its
 * pointerdown, host.ink(sp, 'move') at every move, host.ink(sp, 'end') at
 * its release (a missed pointerup of a mouse or pen: host.ink(null, 'end'))
 * and host.ink(null, 'cancel') when it is dropped (Esc, pointercancel, a
 * second finger, a mouse or pen press over a finger's stroke, a mode switch,
 * another tool). What the stroke makes (a pen line or the eraser's work) is
 * the scene's. claimTouch takes a finger with the pen tool only until a pen
 * was seen on the canvas (a press or a hover of pointerType 'pen', kept until
 * the page reloads): on a device with a pen the finger pans. Esc without a
 * stroke chooses select; a contextmenu during a stroke opens nothing.
 *
 * Tables (job 173): the tool table creates like the note tool (a click or a
 * tap: {type: 'create', t: 'table', at}, then select). At the one selected
 * table (host.tableBorderAt: mode edit, select tool, unlocked, no editor,
 * not at LOD 2) a press of the main button, a pen or a claimed finger on a
 * column border (after the handles, before the items) drags that border
 * beyond the threshold (host.beginColumn, moveColumn with the pointer's
 * world x minus the press's, endColumn(true) at the release; Esc, cancel and a second finger
 * endColumn(false)); a release without a move changes nothing. A mouse or
 * pen hovering a border reports it (host.setHoverBorder: the cursor
 * col-resize). A press on its handle table-col or table-row released
 * without a drag gives {type: 'tableAppend', id, axis: 'col'|'row'}. A
 * double click on a table opens the editor of the cell under it
 * (host.editFromUser with the world point), Enter at the one selected table
 * its top-left cell. The intent contextMenu on a table carries the cell
 * under its point (host.cellAt; the keyboard path: under the menu anchor),
 * with the select tool and not at LOD 2. (Round 1) The one exception to
 * rule 4: a finger pressed on the one selected, unlocked table (not at LOD 2,
 * select tool) and held within TAP_SLOP_PX for LONG_PRESS_MS opens the menu
 * of the cell under it (rules 5–7 at its pointerdown point, like a right
 * click; the press ends without a drag, its touchend is cancelled so no
 * compatibility click lands on the menu). Such a finger starts a drag only
 * beyond TAP_SLOP_PX. The browser's own contextmenu of a long press stays
 * without an intent (rule 4).
 *
 * Swimlanes (job 199, model/lanes.js): the frame tool with its option
 * frameKind 'lanes' (host.toolOptions('frame')) creates {type: 'create', t:
 * 'frame', at, rect, lanes: true}. At the one selected frame with lanes the
 * border below a lane (the frame's bottom edge for the last one) is dragged
 * like a table's column border (host.tableBorderAt gives it with lane, the
 * drag hands the world y of the pointer minus the press's to moveColumn;
 * the hover reports 'row': the cursor row-resize). A press on its handle
 * lane-add released without a drag gives {type: 'laneAdd', id}. A double
 * click on the head of a lane opens the editor of its name
 * (host.editFromUser with the world point), and the intent contextMenu on a
 * frame with lanes carries the lane under its point as cell (host.cellAt).
 * A finger held on the head of a lane of the one selected frame opens the
 * menu of that lane, like a finger held on the selected table.
 *
 * Columns (job 208): the right edge of a column of the one selected frame
 * is dragged like a lane's border (host.tableBorderAt gives it with fcol;
 * the hover reports true: col-resize). A press on its handle col-add
 * released without a drag gives {type: 'colAdd', id}. The head of a lane or
 * a column (host.headAt) opens its editor on a double click, the menu of a
 * held finger as above; the intent contextMenu on a frame with columns also
 * carries the column under its point as col (host.colAt). A press on such a
 * head of an unlocked frame, without Shift (a finger: only at the frame that
 * was selected before the press), dragged beyond the threshold moves that
 * lane or column (host.beginHeadDrag, moveHeadDrag, endHeadDrag(true) at the
 * release, false at Esc, cancel and a second finger) instead of the frame.
 *
 * Note pads (job 188, model/pad.js): the note tool with its option type
 * 'pad' (host.toolOptions('sticky')) creates {type: 'create', t: 'pad', at}
 * at a click or tap. With the select tool in mode edit a press of the main
 * button, a pen or a finger whose hit (after the handles and a table's
 * border; items above the pad win) is the pile of a pad (host.padPart
 * 'stack': job 263 its part below the tear line) takes a note off it, locked too: before
 * the selection frame (job 163) and the lock rule (job 151), and claimTouch
 * takes such a finger always. The pointerdown changes nothing; beyond the
 * threshold (mouse and pen DRAG_THRESHOLD_PX, a finger TAP_SLOP_PX) the
 * scene shows the preview note (host.beginTake, moveTake with the world
 * point), the release gives the intent takeNote (host.endTake(true)) and
 * its touchend is cancelled (H1: the new note's editor lies there). A
 * release without a drag, a tap and a double click on the pile do nothing
 * (the selection stays); Esc, a second finger, pointercancel, cancel and
 * settle end it without an intent (endTake(false)). A mouse or pen
 * hovering a pile reports it (host.setHoverStack: the cursor copy). The
 * band (job 263: the binding on top, down to the tear line) behaves like any item; a double click there opens the
 * pad's title. Enter at the one selected pad gives {type: 'takeNote', id,
 * at: null} instead of an editor, locked too.
 *
 * Mind maps (job 195, model/mindmap.js): the tool mindmap creates like the
 * note tool. A press on a mind map (its nodes and fold dots: hit mode
 * 'tree', host.mindmapPart) selects it by the rules of a click and focuses
 * the node under it (host.setMmFocus; never with Shift). A press on a fold
 * dot that is drawn (#dotShown: folded, the map selected, or a hover over
 * that node; else it counts as the node) changes no selection; its release without a drag gives {type:
 * 'mmFold', id, key} (locked too: the session refuses). A press on a node
 * that is not the root, of an unlocked map, without Shift (a finger: only
 * at the map that was selected before the press) drags that node beyond
 * the threshold (host.beginNodeDrag, moveNodeDrag, endNodeDrag(true) at the
 * release, false at Esc, cancel and a second finger); the root drags the
 * whole map as before. A press on a "+" of the focused node (mm-child,
 * mm-sibling, mm-child-r, mm-child-l) released without a drag gives
 * {type: 'mmAdd', id, key, as: 'child'|'sibling', side?, open: true}. A
 * double click on a node opens its editor. A finger held on a node of the
 * one selected map opens its menu, like a table's cell. With a focus
 * (host.mmFocus) and the canvas focus: Tab {type: 'mmAdd', as: 'child',
 * open: true}, Shift+Tab focuses the parent, Enter {type: 'mmAdd', as:
 * 'sibling', open: true} (at the root its editor), F2 the editor, the
 * arrows (Shift too) move the focus (host.mmStep), Delete and Backspace
 * {type: 'mmDelete', id, key} (the root: the delete of the selection); a
 * locked map or a mode without editing keeps only the arrows. Esc takes
 * the focus first, then the selection. The menu intent on a mind map
 * carries the node as cell: under its point (the node gets the focus), on
 * the keyboard path the focus (else none: the session takes the root). A
 * hovering mouse or pen reports the node under it (host.setHoverNode: its
 * hollow dot shows).
 */
import { pictureSize, splitImage } from '../model/shapeImage.js'
import { toLocal } from '../model/geometry.js'
import { expandGroups, groupOf, isOneGroup } from '../model/groups.js'
import { hasLanes } from '../model/lanes.js'
import { isLocked } from '../model/locks.js'
import { fieldValue, isBindable, textPathOf, typeInfo } from '../model/registry.js'
import { hitShape, isUnfilledShape } from '../model/SceneModel.js'
import { TOOLS } from '../model/tools.js'
import { mindTree } from '../model/mindmap.js'
import { FRAME_EDGE_HIT_PX, NUDGE, NUDGE_BIG, REACT_BAND, SELECTION_GAP_PX } from '../model/tokens.js'
import { LONG_PRESS_MS, TAP_SLOP_PX, isRightPress } from './GestureController.js'

/** Movement (screen px) that turns a press into a drag, a marquee or a transform. */
export const DRAG_THRESHOLD_PX = 3
export const HIT_TOL_MOUSE_PX = 4
export const HIT_TOL_TOUCH_PX = 12
/** (job 158) Margin (screen px) right of a frame title's text where a second click still opens it. */
export const TITLE_CLICK_PAD_PX = 8
/** (job 158) Least width (screen px) of a frame title's text zone from its left edge (a finger on a short title). */
export const TITLE_CLICK_MIN_PX = 44
/** Smallest frame drawn with the frame tool; a smaller drag is a click (default size). */
export const MIN_FRAME_PX = 50
/** Smallest shape drawn with the shape tool (screen px); a smaller drag is a click (default size). */
export const MIN_SHAPE_PX = 10
/** Smallest wrap width drawn with the text tool (screen px); a smaller drag is a click (default width). */
export const MIN_TEXT_PX = 20

const KEY_ZOOM_STEP = 1.25
const TOOLS_BY_KEY = Object.freeze(Object.fromEntries(TOOLS.map((t) => [t.key, t.id])))
/** Handles that start a connector drag instead of a transform. */
const CONNECT_HANDLES = new Set(['plus-t', 'plus-r', 'plus-b', 'plus-l', 'start', 'end'])
const CREATE_TOOLS = new Set(['sticky', 'frame', 'shape', 'text', 'table', 'mindmap'])
/** (job 195) The "+" of a focused mind map node: what a click on it adds, and the side of a main branch. */
const MM_PLUS = Object.freeze({
	'mm-child': Object.freeze({ as: 'child' }), 'mm-sibling': Object.freeze({ as: 'sibling' }),
	'mm-child-r': Object.freeze({ as: 'child', side: 'r' }), 'mm-child-l': Object.freeze({ as: 'child', side: 'l' }),
})
/** (job 195) The arrows at a focus and the way each one moves it. */
const MM_ARROWS = Object.freeze({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })
/** (job 173) The "+" handles of a table and the axis a click on them appends to. */
const TABLE_AXES = Object.freeze({ 'table-col': 'col', 'table-row': 'row' })
/** (job 199) The "+" of a frame with lanes: a new lane at its end. */
const LANE_ADD = 'lane-add'
/** (job 208) the "+" of a frame with columns: a new column at its end */
const COL_ADD = 'col-add'
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'])
const ARROWS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] })
/** "+" handles and the side of the neighbour a click on them asks for (job 136). */
const PLUS_SIDES = Object.freeze({ 'plus-t': 't', 'plus-r': 'r', 'plus-b': 'b', 'plus-l': 'l' })
/** Sides in their tie order with the outer normal at rotation 0 (sideToward). */
const SIDE_NORMALS = Object.freeze([['t', 0, -1], ['r', 1, 0], ['b', 0, 1], ['l', -1, 0]])

/**
 * (job 136) The side of an item rotated by `deg` (clockwise, around its
 * centre) whose outer normal lies closest to the screen direction (ux, uy):
 * the largest dot product; a tie (within float noise) goes to the first of
 * t, r, b, l. Unrotated: → r, ← l, ↑ t, ↓ b; at 90° → gives t.
 *
 * @param {number} deg rotation in degrees
 * @param {number} ux direction x
 * @param {number} uy direction y
 * @return {'t'|'r'|'b'|'l'}
 */
export function sideToward(deg, ux, uy) {
	const a = (Number.isFinite(deg) ? deg : 0) * Math.PI / 180
	const c = Math.cos(a)
	const s = Math.sin(a)
	let best = 't'
	let bestDot = -Infinity
	for (const [side, nx, ny] of SIDE_NORMALS) {
		const d = (nx * c - ny * s) * ux + (nx * s + ny * c) * uy
		if (d > bestDot + 1e-9) {
			best = side
			bestDot = d
		}
	}
	return best
}

/**
 * True when keyboard shortcuts must not fire for this target: text fields,
 * editable content, and anything inside a dialog.
 *
 * @param {EventTarget|null} target event target
 * @return {boolean}
 */
export function ignoresShortcuts(target) {
	if (!target || target.nodeType !== 1) {
		return false
	}
	if (target.isContentEditable) {
		return true
	}
	const tag = target.tagName
	if (tag === 'TEXTAREA' || tag === 'SELECT') {
		return true
	}
	if (tag === 'INPUT' && !NON_TEXT_INPUTS.has(String(target.type || 'text').toLowerCase())) {
		return true
	}
	return !!target.closest?.('[role="dialog"], [aria-modal="true"], .modal-mask')
}

/**
 * (Job 271) Ctrl/⌘+F for the board search: without Alt and Shift, not while
 * composing, not in a text field, the text editor or a dialog
 * (ignoresShortcuts). The board view takes it in the capture phase, before
 * Nextcloud's own search (a listener on the document) sees it.
 *
 * @param {KeyboardEvent} e keydown
 * @return {boolean}
 */
export function isSearchKey(e) {
	return !!e && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing
		&& String(e.key).toLowerCase() === 'f' && !ignoresShortcuts(e.target)
}

/**
 * @return {boolean} true while the page has a non-empty DOM text selection
 *   (marked page text, SPEC-M1 §6.3: Ctrl/⌘+C/X/D then belong to the browser)
 */
export function hasTextSelection() {
	try {
		const sel = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null
		return !!sel && sel.isCollapsed === false
	} catch {
		return false
	}
}

/**
 * @param {KeyboardEvent} e keydown
 * @return {boolean} the ContextMenu key or Shift+F10 (the keys that open a context menu)
 */
function isMenuKey(e) {
	return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey === true)
}

/**
 * @param {unknown} t item type
 * @return {boolean} a routed item (connector)
 */
function isLine(t) {
	return typeInfo(t).hit === 'line'
}

/**
 * @param {{x:number, y:number}} a corner
 * @param {{x:number, y:number}} b opposite corner
 * @return {{x:number, y:number, w:number, h:number}} normalized rectangle
 */
function rectOf(a, b) {
	return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

/**
 * (job 170) The marquee lies in the empty inside of a shape without fill: the
 * outline of id (the point test of its kind without tolerance, in its rotated
 * axes) holds all four corners of rect.
 *
 * @param {object} model SceneModel
 * @param {string} id item id
 * @param {{x:number, y:number, w:number, h:number}} rect normalized world rectangle
 * @return {boolean}
 */
function inUnfilled(model, id, rect) {
	const it = model.get(id)
	const a = model.abs(id)
	if (!isUnfilledShape(it) || !a) return false
	const kind = fieldValue(it, 'data.kind')
	for (const [x, y] of [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]]) {
		const [lx, ly] = toLocal(x, y, a.x, a.y, a.w, a.h, a.r || 0)
		if (!hitShape(kind, lx, ly, a.w, a.h, 0)) return false
	}
	return true
}

export class InputController {
	#el
	#h
	#press = null
	#listeners = []
	#hover = null
	/** (job 162) pointerType of the hover that reported #hover; null after a pointerdown or leave @type {string|null} */
	#hoverType = null
	/** (job 173) a hovering mouse or pen is over a column border of the selected table */
	#hoverBorder = false
	/** (job 173, round 1) the hold timer of a finger on the selected table (its cell menu), null while none runs */
	#cellHold = null
	/**
	 * pointerType ('' when unknown) of the last pointerdown on the canvas; null after a
	 * contextmenu or a menu key (rule 3: a contextmenu without a pointerdown is no pointer's)
	 * @type {string|null}
	 */
	#menuDown = null
	/**
	 * (job 156) the last right press on the canvas (job 168: of the mouse or the pen): 1 = its contextmenu
	 * is still to come, 2 = a finger's contextmenu came (rule 4, the mouse only: its release opens no
	 * menu), 0 = neither
	 * @type {0|1|2}
	 */
	#right = 0
	/** (job 168) the right press of #right is the pen's: its contextmenu comes with any pointerType */
	#rightPen = false
	/**
	 * (job 168) the last pointerdown was a right press beside an open text editor: the compatibility
	 * mousedown that follows gets preventDefault (the browser would focus the canvas and end the editor)
	 */
	#keepFocus = false
	/** (job 273) a pen (pointerType 'pen') pressed or hovered on the canvas since the page loaded: the pen tool leaves fingers to the pan */
	#penSeen = false
	/**
	 * (H1, SPEC-M1 §35) a finger (job 143: or a pen) just created an item:
	 * its touchend is cancelled, so the browser sends no compatibility mouse
	 * events and no click to the editor or context bar that now lies under it
	 * @type {boolean}
	 */
	#touchCreated = false
	/**
	 * (job 159) a connector hanging from a "+" of a text item: the world point of its last step and
	 * whether that came from a finger or a pen (coarse); null while none hangs
	 * @type {{last: {x:number, y:number}, coarse: boolean}|null}
	 */
	#hang = null
	/**
	 * (job 163) the pointer whose pointerdown ended an open text editor (its press never lies in the
	 * selection frame, claimDrag), null when the last pointerdown ended none
	 * @type {number|null}
	 */
	#endedBy = null
	/** (job 190) a marquee ran with Alt since the last keyup of Alt: that keyup gets preventDefault */
	#altFrame = false

	/**
	 * @param {HTMLElement} el scene container
	 * @param {object} host scene services (see SceneManager#host)
	 */
	constructor(el, host) {
		this.#el = el
		this.#h = host
		this.#on(el, 'pointerdown', this.#onDown)
		this.#on(el, 'mousedown', this.#onMouseDown)
		this.#on(el, 'pointermove', this.#onMove)
		this.#on(el, 'pointerup', this.#onUp)
		this.#on(el, 'pointercancel', this.#onCancel)
		this.#on(el, 'pointerleave', this.#onLeave)
		this.#on(el, 'dblclick', this.#onDblClick)
		this.#on(el, 'touchend', this.#onTouchEnd)
		this.#on(window, 'keydown', this.#onKeyDown)
		this.#on(window, 'keyup', this.#onKeyUp)
		this.#on(window, 'blur', () => {
			this.#h.setSpace(false)
			this.#altFrame = false
		})
		// (job 156) on window: the contextmenu of a right-drag may land outside the canvas (Windows: after the pointerup)
		this.#on(window, 'contextmenu', this.#onContextMenu)
	}

	/**
	 * @return {boolean} true while a press (click, drag, marquee, create, transform) is in progress or
	 *   (job 159) a connector hangs from a "+"
	 */
	get busy() {
		return this.#press !== null || this.#hang !== null
	}

	/**
	 * GestureController asks whether a first touch belongs to this controller:
	 * yes in edit mode with the select tool when the finger hits a handle or
	 * an unlocked item (job 151: a locked one is background, the finger pans
	 * or taps, tap); (H1, SPEC-M1 §35) yes anywhere with a create tool (sticky,
	 * text, shape, frame) or the connector, so a finger creates like the
	 * mouse (a touch device that also reports a fine pointer is in mode
	 * edit). The hand tool keeps the finger for the pan. (job 159) Never
	 * while a connector hangs: its finger pans, zooms or taps (tap).
	 *
	 * @param {PointerEvent} e touch pointerdown
	 * @return {boolean}
	 */
	claimTouch(e) {
		const h = this.#h
		if (h.viewOnly() || this.busy || h.isInteractiveTarget(e)) {
			return false
		}
		const tool = h.tool()
		// (job 171) the laser takes every first finger too: one finger points, two pan and zoom
		if (CREATE_TOOLS.has(tool) || tool === 'connector' || tool === 'laser') return true
		// (job 273) the pen tool draws with a finger only until a pen was seen; then the finger pans
		if (tool === 'pen') return !this.#penSeen
		if (tool !== 'select') return false
		return this.#takenAt(h.local(e))
	}

	/**
	 * (job 188) The pile of a pad under a press: the hit at w (the rules of a click) is a pad and w lies on its
	 * pile.
	 *
	 * @param {string|null} hit what the press hits
	 * @param {{x:number, y:number}} w world point
	 * @return {boolean}
	 */
	#onStack(hit, w) {
		return hit !== null && (this.#h.padPart?.(hit, w) ?? null) === 'stack'
	}

	/**
	 * @param {{x:number, y:number}} sp container point
	 * @return {boolean} a finger there would hit a transformer handle or an unlocked item (claimTouch,
	 *   claimLongPress); (job 151) a locked item without a handle there is background
	 */
	#takenAt(sp) {
		const h = this.#h
		if (h.handleAt(sp, true) !== null) return true
		// (job 173) a finger on a column border of the selected table drags it
		if ((h.tableBorderAt?.(sp, true) ?? null) !== null) return true
		const w = h.toWorld(sp)
		// (job 209) at LOD 2 a finger on a connector line is no claim: it pans (its tap selects, tap())
		const hit = this.#hit(w, HIT_TOL_TOUCH_PX, true, false)
		// (job 188) a finger on the pile of a pad belongs to it, locked too
		return hit !== null && (!isLocked(h.model.get(hit)) || this.#onStack(hit, w))
	}

	/**
	 * (R38, SPEC-M1 §6.3) The GestureController's hold timer ran out for a
	 * pending first finger: it becomes a marquee press when the tool is
	 * select, no press runs and neither a handle nor an unlocked item lies under the
	 * pointerdown point (the hits of claimTouch, asked now: an item another
	 * client put there meanwhile counts). The press starts its marquee only
	 * beyond TAP_SLOP_PX and replaces the selection then (keep []); the
	 * selection stays until that. The scene shows the hold signal at once.
	 * (job 190) The offer of locked items ends.
	 *
	 * @param {number} pointerId the finger
	 * @param {{x:number, y:number}} sp its pointerdown point, container px
	 * @return {boolean} true when this controller took the finger
	 */
	claimLongPress(pointerId, sp) {
		const h = this.#h
		if (h.viewOnly() || this.busy || h.tool() !== 'select') return false
		const at = { x: sp.x, y: sp.y }
		if (this.#takenAt(at)) return false
		const w = h.toWorld(at)
		this.#press = { pid: pointerId, touch: true, coarse: true, sp: at, w, last: w, moved: false, mode: 'marquee-pending', keep: [], shift: false, slop: TAP_SLOP_PX, hold: true }
		h.lockedOffer(null)
		h.holdSignal(at)
		return true
	}

	/**
	 * (job 163) A pending first finger moved beyond TAP_SLOP_PX before its
	 * hold ran out (the GestureController asks once, before its pan starts):
	 * it drags the whole selection when no press runs, no connector hangs,
	 * the tool is select and its pointerdown point lies in the selection
	 * frame now (finger tolerance), with neither a handle nor an unlocked
	 * item under it, and its pointerdown ended no open editor. The drag
	 * starts at once from that point, so the move that asked covers the
	 * whole way since the pointerdown. (job 190) The offer of locked items
	 * ends.
	 *
	 * @param {number} pointerId the finger
	 * @param {{x:number, y:number}} sp its pointerdown point, container px
	 * @return {boolean} true when this controller took the finger (no pan)
	 */
	claimDrag(pointerId, sp) {
		const h = this.#h
		if (h.viewOnly() || this.busy || h.tool() !== 'select' || this.#endedBy === pointerId) return false
		const at = { x: sp.x, y: sp.y }
		const w = h.toWorld(at)
		if (this.#takenAt(at) || !this.#inFrame(w, HIT_TOL_TOUCH_PX)) return false
		if (!h.beginDrag(h.selection.values(), null)) return false
		this.#press = { pid: pointerId, touch: true, coarse: true, sp: at, w, last: w, moved: true, mode: 'drag' }
		h.lockedOffer(null)
		return true
	}

	/**
	 * The item a click or tap at a world point hits, by the same rules as a
	 * selection click (SceneModel.hitTest; at LOD 2 a frame also by its painted
	 * title), but (job 209) at LOD 2 never a connector: it gets no votes, and a
	 * line must not take a tap meant for a tiny note beside it. The scene asks
	 * it for a vote in mode vote.
	 * (job 170) The inside of a shape without fill hits here as before.
	 *
	 * @param {{x:number, y:number}} w world point
	 * @param {boolean} touch a finger (HIT_TOL_TOUCH_PX), else HIT_TOL_MOUSE_PX
	 * @return {string|null} item id
	 */
	hitAt(w, touch) {
		return this.#hit(w, touch ? HIT_TOL_TOUCH_PX : HIT_TOL_MOUSE_PX, false, false)
	}

	/**
	 * (job 151) A finger's tap the GestureController kept for itself (onTap,
	 * mode edit): claimTouch took no finger on a locked item, so its tap
	 * reaches the selection here. With the select tool and no press the
	 * item under the tap point is selected like a click there (#click);
	 * empty canvas and a handle there change nothing. (job 159) While a
	 * connector hangs the tap sets its end there instead (finger tolerance),
	 * and its touchend is cancelled. (job 190) With the select tool the tap
	 * ends the offer of locked items, also on empty canvas.
	 *
	 * @param {PointerEvent} e pointerup of the tap
	 */
	tap(e) {
		const h = this.#h
		if (this.#hang !== null) {
			if (this.#press === null && !h.isInteractiveTarget(e)) {
				this.#endHang(h.local(e), e.ctrlKey === true || e.metaKey === true, true)
				this.#touchCreated = true
			}
			return
		}
		if (h.viewOnly() || this.#press !== null || h.tool() !== 'select' || h.isInteractiveTarget(e)) return
		h.lockedOffer(null)
		const sp = h.local(e)
		if (h.handleAt(sp, true) !== null) return
		const hit = this.#hit(h.toWorld(sp), HIT_TOL_TOUCH_PX)
		if (hit !== null) this.#click(hit, e.shiftKey === true)
	}

	/**
	 * (R13) Ends the current press like a release (settled mode switch,
	 * SPEC-M1 §6.3 setMode): a drag, transform or connect drag commits with
	 * its intent; a marquee or a create drag just ends (nothing is created);
	 * a press that has not moved yet is dropped. The later pointerup finds no
	 * press. (job 159) A hanging connector goes without one, like cancel().
	 */
	settle() {
		if (this.#hang !== null) {
			this.cancel()
			return
		}
		this.#clearCellHold()
		const p = this.#press
		if (!p) return
		this.#press = null
		if (p.hold) this.#h.holdSignal(null)
		if (p.mode === 'drag') {
			this.#h.endDrag(true)
		} else if (p.mode === 'transform') {
			this.#h.endTransform(true)
		} else if (p.mode === 'connect') {
			this.#h.endConnect(true)
		} else if (p.mode === 'marquee' || p.mode === 'frame' || p.mode === 'shape' || p.mode === 'text') {
			this.#h.setMarquee(null)
		} else if (p.mode === 'laser') {
			// (job 171) a laser stroke ends like a release
			this.#h.laser(null)
		} else if (p.mode === 'ink') {
			// (job 273) a mode switch drops a running pen stroke or eraser path
			this.#h.ink(null, 'cancel')
		} else if (p.mode === 'col') {
			// (job 173) a column border ends like a release
			this.#h.endColumn(true)
		} else if (p.mode === 'take' || p.mode === 'take-pending') {
			// (job 188) a mode switch takes no note off a pad
			this.#h.endTake(false)
		} else if (p.mode === 'mm-node') {
			// (job 195) a dragged node lands like at a release
			this.#h.endNodeDrag(true)
		} else if (p.mode === 'head') {
			// (job 208) a dragged lane or column lands like at a release
			this.#h.endHeadDrag(true)
		}
	}

	/**
	 * Aborts the current press like Esc (view-only switch, resync; a second finger goes through cancelTouch);
	 * (job 159) a hanging connector goes too, without one.
	 */
	cancel() {
		const p = this.#press
		this.#press = null
		this.#clearCellHold()
		if (p !== null) {
			if (p.hold) this.#h.holdSignal(null)
			if (p.mode === 'drag') {
				this.#h.endDrag(false)
			} else if (p.mode === 'transform') {
				this.#h.endTransform(false)
			} else if (p.mode === 'connect') {
				this.#h.endConnect(false)
			} else if (p.mode === 'marquee' || p.mode === 'frame' || p.mode === 'shape' || p.mode === 'text') {
				this.#h.setMarquee(null)
			} else if (p.mode === 'laser') {
				this.#h.laser(null)
			} else if (p.mode === 'ink') {
				// (job 273) no stroke, nothing erased
				this.#h.ink(null, 'cancel')
			} else if (p.mode === 'col') {
				// (job 173) Esc: the width springs back, no intent
				this.#h.endColumn(false)
			} else if (p.mode === 'take') {
				// (job 188) no note
				this.#h.endTake(false)
			} else if (p.mode === 'mm-node') {
				// (job 195) the node stays where it was
				this.#h.endNodeDrag(false)
			} else if (p.mode === 'head') {
				// (job 208) the lane or column stays where it was
				this.#h.endHeadDrag(false)
			}
		}
		if (this.#hang !== null) {
			this.#hang = null
			this.#h.endConnect(false)
		}
	}

	/**
	 * A second finger arrived (the GestureController's cancelClaim): aborts the
	 * current press like cancel() only when a finger started it (claimTouch,
	 * claimLongPress); a mouse or pen press goes on (the GestureController does
	 * not even ask while one runs: a third contact during a pen drag is inert).
	 */
	cancelTouch() {
		if (this.#press?.touch === true) this.cancel()
	}

	/**
	 * (job 162) The hovered handle is reported again without a pointer type
	 * (no "+" preview, the cursor keeps its handle) until the next hover: at
	 * every pointerdown and when the scene resets.
	 */
	dropHover() {
		if (this.#hoverType === null) return
		this.#hoverType = null
		this.#h.setHoverHandle(this.#hover, null)
	}

	/**
	 * (job 156) A right click: a right press on the canvas (job 168: of the mouse or the pen) released
	 * within its threshold (the scene calls it from GestureController.onTap). (job 168) An open text
	 * editor ends first with its final commit, like a click beside it, and the canvas takes the focus.
	 * Mode edit: the menu at the release point by rules 5–7 (header; the pen reaches a handle with the
	 * touch radius), unless a finger's contextmenu came during the mouse's press (rule 4); modes vote
	 * and view: nothing. (job 159) A hanging connector goes instead, without a menu.
	 *
	 * @param {PointerEvent} e pointerup of the right click
	 */
	rightClick(e) {
		const h = this.#h
		if (this.#hang !== null) {
			this.cancel()
			return
		}
		if (h.editorOpen()) {
			h.focusCanvas()
			h.finishEditor()
		}
		if (this.#right === 2 || h.viewOnly()) return
		this.#menuAt(h.local(e), e.pointerType === 'pen' ? 'pen' : 'mouse')
	}

	destroy() {
		this.cancel()
		for (const [target, type, fn] of this.#listeners) {
			target.removeEventListener(type, fn)
		}
		this.#listeners = []
	}

	// ---------------------------------------------------------------- internals

	#on(target, type, fn) {
		target.addEventListener(type, fn)
		this.#listeners.push([target, type, fn])
	}

	/**
	 * @param {{x:number, y:number}} w world point
	 * @param {number} tolPx tolerance in screen px
	 * @param {boolean} [hollow] (job 170) with the select tool the inside of a shape without fill
	 *   is empty canvas (the hits of a press or click); false: it hits (hitAt, mode vote)
	 * @param {boolean} [lines] (job 209) false: at LOD 2 a connector is no hit (a finger's press,
	 *   mode vote; R13 (c))
	 * @return {string|null} item id; at LOD 2 a frame also by its painted title (R14-13);
	 *   (job 140) in mode edit also an item of the own selection whose gap holds w (#gapHit)
	 */
	#hit(w, tolPx, hollow = true, lines = true) {
		const s = this.#h.scale()
		const tol = tolPx / s
		return this.#gapHit(w, tol + SELECTION_GAP_PX / s, this.#modelHit(w, tol, s, hollow, lines))
	}

	/**
	 * @param {{x:number, y:number}} w world point
	 * @param {number} tol tolerance in world units
	 * @param {number} s camera scale
	 * @param {boolean} hollow (job 170) the inside of a shape without fill is empty canvas
	 *   (with the select tool, not at LOD 2: there the shape is painted filled), (job 177)
	 *   except its text zone (host.shapeTextRect)
	 * @param {boolean} lines (job 209) false: at LOD 2 a connector is no hit
	 * @return {string|null} the item the model hits there (the rules of #hit without the gap)
	 */
	#modelHit(w, tol, s, hollow, lines) {
		const model = this.#h.model
		const opts = { edgeWorld: FRAME_EDGE_HIT_PX / s }
		if (!this.#h.coarse?.()) {
			// (job 177) with hollow the text zone of a shape without fill still hits it
			const textRect = this.#h.shapeTextRect
			// (job 252) above a frame only its visible tab hits (host.titleTextWidth); at LOD 2 the band
			const tabWidth = this.#h.titleTextWidth
			return model.hitTest(w.x, w.y, tol, { ...opts, hollow: hollow && this.#h.tool() === 'select', textRect, tabWidth })
		}
		if (!lines) opts.accept = (id) => !isLine(model.get(id)?.t)
		const id = model.hitTest(w.x, w.y, tol, opts)
		const title = this.#h.coarseTitleAt?.(w, tol) ?? null
		if (title === null || title === id || !model.get(title)) return id
		// LOD 2 paints all frames with their titles first, then the content; a frame
		// the model hits is hit only by its title band or border band (never its inside)
		return id !== null && !typeInfo(model.get(id).t).container ? id : title
	}

	/**
	 * (job 140) A press into the gap between a selected item and its
	 * selection frame hits the item: an item of the OWN selection (not a
	 * connector, members of a selected group included) whose box does not
	 * hold w but would, grown by `reach` per axis in its own rotated axes.
	 * Inside the box the type rule of the model stays (a frame's inside is
	 * empty canvas, a shape hits at its outline). Of these and `id` the
	 * topmost in the stacking order wins. Not in modes vote and view. (job
	 * 172) Below the one selected note the band of its reaction row
	 * (host.reactBand, world units) counts like the gap.
	 *
	 * @param {{x:number, y:number}} w world point
	 * @param {number} reach gap plus tolerance, world units
	 * @param {string|null} id what the model hits there
	 * @return {string|null} item id
	 */
	#gapHit(w, reach, id) {
		const h = this.#h
		if (h.viewOnly() || h.selection.size === 0) return id
		const model = h.model
		let best = id
		// an item whose grown box holds w lies within reach · √2 of w (plus a reaction band below it)
		const pad = reach * 1.5 + REACT_BAND
		for (const e of model.query(w.x - pad, w.y - pad, w.x + pad, w.y + pad)) {
			const sid = e.id
			if (sid === best || !h.selection.has(sid) || isLine(model.get(sid)?.t)) continue
			const a = model.abs(sid)
			if (!a) continue
			const [lx, ly] = toLocal(w.x, w.y, a.x, a.y, a.w, a.h, a.r || 0)
			const inBox = lx >= 0 && ly >= 0 && lx <= a.w && ly <= a.h
			const band = typeof h.reactBand === 'function' ? h.reactBand(sid) : 0
			if (inBox || lx < -reach || ly < -reach || lx > a.w + reach || ly > a.h + reach + band) continue
			if (best === null || model.compareOrder(sid, best) > 0) best = sid
		}
		return best
	}

	/**
	 * (job 163) w lies in the selection frame R (host.dragFrame, computed now), grown by the hit
	 * tolerance on every side.
	 *
	 * @param {{x:number, y:number}} w world point
	 * @param {number} tolPx tolerance in screen px
	 * @return {boolean}
	 */
	#inFrame(w, tolPx) {
		const f = this.#h.dragFrame()
		if (!f) return false
		const t = tolPx / this.#h.scale()
		const [lx, ly] = toLocal(w.x, w.y, f.x, f.y, f.w, f.h, f.r || 0)
		return lx >= -t && ly >= -t && lx <= f.w + t && ly <= f.h + t
	}

	#capture(e) {
		try {
			this.#el.setPointerCapture?.(e.pointerId)
		} catch {
			// synthetic pointers cannot be captured
		}
	}

	#onDown = (e) => {
		const h = this.#h
		this.#touchCreated = false
		// (job 162) every press ends the "+" preview; the next hover after it reports anew
		this.dropHover()
		// context menu rule 3: a contextmenu after this pointerdown is this pointer's
		this.#menuDown = typeof e.pointerType === 'string' ? e.pointerType : ''
		// (job 273) from the first pen press on, the pen tool leaves fingers to the pan
		if (e.pointerType === 'pen') this.#penSeen = true
		// (job 156) a right press on the canvas (job 168: of the mouse or the pen): its contextmenu opens
		// nothing, its click opens the menu at the release (rightClick); an overlay control keeps the browser's menu
		const right = isRightPress(e) && !h.isInteractiveTarget(e)
		this.#right = right ? 1 : 0
		this.#rightPen = right && e.pointerType === 'pen'
		this.#keepFocus = false
		// (R38, job 134) a mouse or pen goes before every press a finger started (a resting palm): it ends like Esc
		if (e.pointerType !== 'touch' && this.#press?.touch === true) this.cancel()
		if (h.isInteractiveTarget(e)) return
		// (job 148) a press that ends an open editor hits no handle: asked before the focus
		// moves, since the editor's blur already ends it
		const ended = h.editorOpen()
		if (right && ended) {
			// (job 168) a right press beside the open editor leaves it open (focus, text, caret): no canvas
			// focus, the browser's focus change at the mousedown is prevented; its click ends it (rightClick)
			this.#endedBy = null
			this.#keepFocus = true
			return
		}
		this.#endedBy = ended ? e.pointerId : null
		// a click on the canvas focuses it (single keys need the canvas focus);
		// (R9) in mode edit a finger too (focus({preventScroll}) on the tabindex
		// div opens no on-screen keyboard), in vote/view a finger does not
		// (viewOnly() means "not edit": vote and view)
		if (e.pointerType !== 'touch' || !h.viewOnly()) h.focusCanvas()
		if (h.gestures.owns(e.pointerId)) return
		if (e.pointerType === 'touch' && !h.gestures.isClaimed(e.pointerId)) return
		// (job 168) a pen's button 0 with its side button held is a right press: never a press here
		if (this.#press !== null || e.button !== 0 || right) return
		// (job 190) the press of the main button, a pen or a claimed finger ends the offer of locked items
		h.lockedOffer(null)
		// a click beside the open editor ends it (with commit)
		h.finishEditor()
		if (h.viewOnly()) return
		const sp = h.local(e)
		const w = h.toWorld(sp)
		const base = { pid: e.pointerId, touch: e.pointerType === 'touch', coarse: e.pointerType === 'touch' || e.pointerType === 'pen', sp, w, last: w, moved: false }
		if (this.#hang !== null) {
			// (job 159) the press that sets the end of the hanging connector at its release: no handle,
			// no selection, no move; the preview follows it
			this.#press = { ...base, mode: 'hang' }
			this.#hangTo(w, e.ctrlKey || e.metaKey, base.coarse)
			this.#capture(e)
			return
		}
		const tool = h.tool()
		if (tool === 'connector') {
			this.#press = { ...base, mode: 'connect-pending' }
			this.#capture(e)
			return
		}
		if (CREATE_TOOLS.has(tool)) {
			this.#press = { ...base, mode: tool }
			this.#capture(e)
			return
		}
		if (tool === 'laser') {
			// (job 171) a laser stroke: no hit, no selection, no intent; the tool stays
			this.#press = { ...base, mode: 'laser' }
			this.#capture(e)
			h.laser(sp)
			return
		}
		if (tool === 'pen') {
			// (job 273) a pen stroke (or the eraser): no hit, no selection; the tool stays
			this.#press = { ...base, mode: 'ink' }
			this.#capture(e)
			h.ink(sp, 'down', base.coarse)
			return
		}
		if (tool !== 'select') return
		const handle = ended ? null : h.handleAt(sp, e.pointerType === 'touch' || e.pointerType === 'pen')
		if (handle !== null) {
			this.#press = { ...base, mode: 'handle', handle }
			if (Object.prototype.hasOwnProperty.call(PLUS_SIDES, handle) || Object.prototype.hasOwnProperty.call(TABLE_AXES, handle) ||
				Object.prototype.hasOwnProperty.call(MM_PLUS, handle) || handle === LANE_ADD || handle === COL_ADD) {
				// (job 136) released without a drag: a neighbour of this item (job 173: a column or row of the
				// table); a finger drags only beyond TAP_SLOP_PX
				this.#press.item = h.plusItem()
				if (base.touch) this.#press.slop = TAP_SLOP_PX
			}
			this.#capture(e)
			return
		}
		// (job 173) a column border of the selected table: its width beyond the threshold
		const border = ended ? null : (h.tableBorderAt?.(sp, base.coarse) ?? null)
		if (border !== null) {
			this.#press = { ...base, mode: 'col-pending', border }
			if (base.touch) this.#press.slop = TAP_SLOP_PX
			this.#capture(e)
			return
		}
		const sel = h.selection
		const tol = base.touch ? HIT_TOL_TOUCH_PX : HIT_TOL_MOUSE_PX
		// (job 209) a finger's press skips connectors at LOD 2, like its claim (#takenAt)
		const hit = this.#hit(w, tol, true, !base.touch)
		const locked = hit !== null && isLocked(h.model.get(hit))
		if (this.#onStack(hit, w)) {
			// (job 188) the pile of a pad, locked too: a drag beyond the threshold takes a note off it; the
			// selection stays (before the selection frame and the lock rule)
			this.#press = { ...base, mode: 'take-pending', pad: hit }
			if (base.touch) this.#press.slop = TAP_SLOP_PX
		} else if ((hit === null || locked || !sel.has(hit)) && !ended && !e.shiftKey && this.#inFrame(w, tol)) {
			// (job 163) in the selection frame: the selection stays; a drag moves all of it, a release clicks
			this.#press = { ...base, mode: 'frame-pending', hit }
			if (base.touch) this.#press.slop = TAP_SLOP_PX
		} else if (locked) {
			// (job 151) a locked item is background: the click selects at the release, a drag draws the marquee;
			// (job 195) on a mind map the click focuses the node under it
			this.#press = { ...base, mode: 'locked', hit, shift: e.shiftKey, keep: e.shiftKey ? sel.values() : [], mmKey: this.#mmPart(hit, w, base)?.key ?? null }
		} else if (hit !== null && h.model.get(hit)?.t === 'mindmap') {
			this.#mindmapPress(base, hit, w, e)
		} else if (hit !== null) {
			// (job 143) the frame was the whole selection before this press: the second click
			const again = !e.shiftKey && sel.size === 1 && sel.has(hit)
			const { collapse, canDrag } = this.#pressSelect(hit, e.shiftKey)
			// title: the frame whose title editor a release without a drag opens (job 143), from its text zone (job 158)
			const title = again && this.#onTitleText(hit, w) ? hit : null
			// (job 208) the head of a lane or a column: a drag moves it, not the frame
			const head = !e.shiftKey && (!base.touch || again) ? (h.headAt?.(hit, w) ?? null) : null
			this.#press = { ...base, mode: canDrag ? (head !== null ? 'head-pending' : 'pending') : 'none', hit, collapse, title, head }
			if (base.touch && again && (h.model.get(hit)?.t === 'table' || (h.headAt?.(hit, w) ?? null) !== null) && !h.coarse?.()) {
				// (job 173, round 1) a finger held on the selected table: the menu of its cell (header);
				// (job 199) on the head of a lane of the selected frame: the menu of that lane
				this.#press.slop = TAP_SLOP_PX
				this.#armCellHold(e.pointerId, sp)
			}
		} else {
			const keep = e.shiftKey ? sel.values() : []
			if (!e.shiftKey && sel.clear()) h.selectionChanged()
			this.#press = { ...base, mode: 'marquee-pending', keep, shift: e.shiftKey }
		}
		this.#capture(e)
	}

	/**
	 * (job 168) The compatibility mousedown of a right press beside an open text editor: preventDefault,
	 * else the browser focuses the canvas and the editor's blur ends it (header "Right click"). Never on
	 * an overlay control: the editor stops its own pointerdown, so a press into it finds the flag of an
	 * earlier press.
	 *
	 * @param {MouseEvent} e mousedown
	 */
	#onMouseDown = (e) => {
		if (!this.#keepFocus) return
		this.#keepFocus = false
		if (!this.#h.isInteractiveTarget(e)) e.preventDefault()
	}

	/**
	 * The selection rules of a press on an item (header "Groups"): without a
	 * group a click selects it alone, Shift toggles it, a click into a
	 * multi-selection narrows it at the release; a group's members go whole.
	 *
	 * @param {string} hit the item pressed
	 * @param {boolean} shift Shift held at the press
	 * @return {{collapse: (string[]|null), canDrag: boolean}} collapse: the selection a release
	 *   without a drag sets (null: it stays); canDrag: a move past the threshold may drag
	 */
	#pressSelect(hit, shift) {
		const h = this.#h
		const sel = h.selection
		let collapse = null
		let canDrag = true
		if (groupOf(h.model, hit) === null) {
			if (shift) {
				sel.toggle(hit)
				h.selectionChanged()
				canDrag = sel.has(hit)
			} else if (!sel.has(hit)) {
				sel.set([hit])
				h.selectionChanged()
			} else if (sel.size > 1) {
				collapse = [hit]
			}
			return { collapse, canDrag }
		}
		// a group (M2, R20): its members M, the hit item last (header table); Sets, no scan per member
		const withHit = expandGroups(h.model, [hit])
		const inGroup = new Set(withHit)
		const selected = sel.values()
		const others = selected.filter((id) => !inGroup.has(id))
		const hitSelected = sel.has(hit)
		if (shift) {
			sel.set(hitSelected ? others : [...others, ...withHit])
			h.selectionChanged()
			canDrag = !hitSelected
		} else if (!hitSelected) {
			sel.set(withHit)
			h.selectionChanged()
		} else if (others.length === 0 && selected.length === inGroup.size) {
			// the selection is exactly M: the second click narrows to X
			collapse = [hit]
		} else if (selected.length > 1) {
			collapse = withHit
		}
		return { collapse, canDrag }
	}

	/**
	 * @param {string} id mind map
	 * @param {{x:number, y:number}} w world point
	 * @param {{touch: boolean}} base press
	 * @return {{key: string, part: string, root: boolean}|null} (job 195) its node or fold dot there
	 */
	#mmPart(id, w, base) {
		const h = this.#h
		if (h.model.get(id)?.t !== 'mindmap' || h.coarse?.()) return null
		const part = h.mindmapPart?.(id, w, base.touch ? HIT_TOL_TOUCH_PX : HIT_TOL_MOUSE_PX) ?? null
		if (part === null) return null
		const root = mindTree(h.model.get(id)).root === part.key
		return { ...part, root }
	}

	/**
	 * (Job 195) The fold dot of a node is drawn: its branch is folded, its map
	 * is selected, or a hovering mouse or pen is over that node (host.mmHover).
	 *
	 * @param {string} id mind map
	 * @param {string} key node
	 * @return {boolean}
	 */
	#dotShown(id, key) {
		const h = this.#h
		if (mindTree(h.model.get(id)).nodes.get(key)?.n.f === true || h.selection.has(id)) return true
		const hv = h.mmHover?.() ?? null
		return hv !== null && hv.id === id && hv.key === key
	}

	/**
	 * (Job 195) A press of the main button, a pen or a claimed finger on a
	 * mind map (header): a fold dot, a node (the focus, a node drag) or the root.
	 *
	 * @param {object} base press
	 * @param {string} hit the mind map
	 * @param {{x:number, y:number}} w world point
	 * @param {PointerEvent} e pointerdown
	 */
	#mindmapPress(base, hit, w, e) {
		const h = this.#h
		const sel = h.selection
		let part = this.#mmPart(hit, w, base)
		// a dot that is not drawn (an unfolded branch of a map that is not selected, no hover over that node:
		// a finger) counts as its node
		if (part?.part === 'dot' && !this.#dotShown(hit, part.key)) part = { ...part, part: 'node' }
		if (part?.part === 'dot' && !e.shiftKey) {
			this.#press = { ...base, mode: 'mm-dot', hit, mmKey: part.key }
			if (base.touch) this.#press.slop = TAP_SLOP_PX
			return
		}
		const again = sel.size === 1 && sel.has(hit)
		const { collapse, canDrag } = this.#pressSelect(hit, e.shiftKey)
		if (!e.shiftKey && part !== null && h.selection.size === 1 && h.selection.has(hit)) h.setMmFocus(hit, part.key)
		const node = part !== null && !part.root && !e.shiftKey && (!base.touch || again)
		// with Shift no focus, also not at the release
		this.#press = { ...base, mode: canDrag ? (node ? 'mm-node-pending' : 'pending') : 'none', hit, collapse, title: null, mmKey: e.shiftKey ? null : part?.key ?? null }
		if (base.touch) {
			this.#press.slop = TAP_SLOP_PX
			// a finger held on a node of the selected map: the menu of that node (header)
			if (again) this.#armCellHold(e.pointerId, base.sp)
		}
	}

	/**
	 * (job 151) A whole click on an item at once: the press rules and the
	 * release's narrowing (a press on a locked item released without a drag,
	 * a finger's tap on one).
	 *
	 * @param {string} hit the item clicked
	 * @param {boolean} shift Shift held at the press
	 */
	#click(hit, shift) {
		const h = this.#h
		if (!h.model.has(hit)) return
		const { collapse } = this.#pressSelect(hit, shift)
		if (collapse !== null && h.selection.set(collapse)) h.selectionChanged()
	}

	/**
	 * (job 159) One step of the hanging connector: its preview end at w.
	 *
	 * @param {{x:number, y:number}} w world point
	 * @param {boolean} ctrl Ctrl/⌘ held (no snapping)
	 * @param {boolean} coarse a finger or a pen (wider hit tolerance)
	 */
	#hangTo(w, ctrl, coarse) {
		this.#hang.last = w
		this.#hang.coarse = coarse
		this.#h.moveConnect(w, { ctrl, coarse })
	}

	/**
	 * (job 159) The hanging connector ends at a container point: in the hit circle of its "+" without
	 * a connector, else like the release of a drag from "+" (the intent connect, none for a free end
	 * in the text item).
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {boolean} ctrl Ctrl/⌘ held (no snapping)
	 * @param {boolean} coarse a finger or a pen (HANDLE_TOUCH_PX, wider hit tolerance)
	 */
	#endHang(sp, ctrl, coarse) {
		const h = this.#h
		this.#hang = null
		if (h.hangPlusAt(sp, coarse)) {
			h.endConnect(false)
			return
		}
		h.moveConnect(h.toWorld(sp), { ctrl, coarse })
		h.endConnect(true)
	}

	#onMove = (e) => {
		const h = this.#h
		const p = this.#press
		if (e.pointerType === 'pen') this.#penSeen = true
		if (!p || e.pointerId !== p.pid) {
			if (e.pointerType !== 'touch' && !h.isInteractiveTarget(e)) {
				const sp = h.local(e)
				const w = h.toWorld(sp)
				// (job 231) with the container point: the scene shows the rotation handle and points near it
				h.pointer([w.x, w.y], sp)
				this.#hoverAt(sp, typeof e.pointerType === 'string' ? e.pointerType : '')
				// (job 159) a hovering mouse or pen moves the hanging connector
				if (this.#hang !== null && !p) this.#hangTo(w, e.ctrlKey || e.metaKey, e.pointerType === 'pen')
			}
			return
		}
		const sp = h.local(e)
		const w = h.toWorld(sp)
		p.last = w
		if (!p.touch) h.pointer([w.x, w.y])
		if (p.mode === 'hang') {
			this.#hangTo(w, e.ctrlKey || e.metaKey, p.coarse)
			return
		}
		if (p.mode === 'laser') {
			if (e.pointerType !== 'touch' && e.buttons === 0) {
				// (job 171) a missed pointerup (mouse or pen without a button): the stroke ends, no dot stays for everyone
				this.#press = null
				h.laser(null)
				return
			}
			// (job 171) every move is a point of the stroke, no threshold
			h.laser(sp)
			return
		}
		if (p.mode === 'ink') {
			if (e.pointerType !== 'touch' && e.buttons === 0) {
				// (job 273) a missed pointerup (mouse or pen without a button): the stroke ends like a release
				this.#press = null
				h.ink(null, 'end')
				return
			}
			h.ink(sp, 'move')
			return
		}
		// a held finger (R38) starts its marquee only beyond TAP_SLOP_PX: no jitter after the signal
		if (!p.moved && Math.hypot(sp.x - p.sp.x, sp.y - p.sp.y) > (p.slop ?? DRAG_THRESHOLD_PX)) {
			p.moved = true
			this.#clearCellHold()
		}
		if (!p.moved) return
		const cmods = { ctrl: e.ctrlKey || e.metaKey, coarse: p.coarse }
		switch (p.mode) {
		case 'handle':
			if (CONNECT_HANDLES.has(p.handle)) {
				if (h.beginConnectHandle(p.handle, p.w)) {
					p.mode = 'connect'
					h.moveConnect(w, cmods)
				} else {
					p.mode = 'none'
				}
			} else if (h.beginTransform(p.handle, p.w)) {
				p.mode = 'transform'
				h.moveTransform(w, { shift: e.shiftKey, alt: e.altKey, ctrl: cmods.ctrl })
			} else {
				p.mode = 'none'
			}
			break
		case 'connect-pending':
			if (h.beginConnect(p.w, cmods)) {
				p.mode = 'connect'
				h.moveConnect(w, cmods)
			} else {
				p.mode = 'none'
			}
			break
		case 'connect':
			h.moveConnect(w, cmods)
			break
		case 'col-pending':
			// (job 173) the border of a column
			if (h.beginColumn(p.border)) {
				p.mode = 'col'
				h.moveColumn(w.x - p.w.x, w.y - p.w.y)
			} else {
				p.mode = 'none'
			}
			break
		case 'col':
			h.moveColumn(w.x - p.w.x, w.y - p.w.y)
			break
		case 'take-pending':
			// (job 188) the preview note under the pointer
			if (h.beginTake(p.pad, p.w)) {
				p.mode = 'take'
				h.moveTake(w)
			} else {
				p.mode = 'none'
			}
			break
		case 'take':
			h.moveTake(w)
			break
		case 'mm-node-pending':
			// (job 195) a node of a mind map: its ghost and the drop target
			if (h.beginNodeDrag(p.hit, p.mmKey, p.w)) {
				p.mode = 'mm-node'
				h.moveNodeDrag(w)
			} else {
				p.mode = 'none'
			}
			break
		case 'mm-node':
			h.moveNodeDrag(w)
			break
		case 'head-pending':
			// (job 208) the head of a lane or a column: its ghost and the bar where it lands
			if (h.beginHeadDrag(p.hit, p.head, p.w)) {
				p.mode = 'head'
				h.moveHeadDrag(w)
			} else {
				p.mode = 'none'
			}
			break
		case 'head':
			h.moveHeadDrag(w)
			break
		case 'mm-dot':
			// (job 195) a fold dot moved away: nothing
			p.mode = 'none'
			break
		case 'transform':
			h.moveTransform(w, { shift: e.shiftKey, alt: e.altKey, ctrl: cmods.ctrl })
			break
		case 'locked':
			// (job 151) a drag from a locked item: the marquee from the press point, as on empty canvas
			p.mode = 'marquee'
			this.#marquee(p, w, e.altKey === true)
			break
		case 'pending':
		case 'frame-pending':
			// (job 163) from the selection frame the whole selection, without a lead
			if (h.beginDrag(h.selection.values(), p.mode === 'pending' ? p.hit : null)) {
				p.mode = 'drag'
				h.moveDrag(w.x - p.w.x, w.y - p.w.y, { ctrl: cmods.ctrl })
			} else {
				p.mode = 'none'
			}
			break
		case 'drag':
			h.moveDrag(w.x - p.w.x, w.y - p.w.y, { ctrl: cmods.ctrl })
			break
		case 'marquee-pending':
			p.mode = 'marquee'
			this.#marquee(p, w, e.altKey === true)
			break
		case 'marquee':
			// (job 190) Alt is read at every move
			this.#marquee(p, w, e.altKey === true)
			break
		case 'frame':
		case 'shape':
		case 'text':
			h.setMarquee(rectOf(p.w, w), 'frame')
			break
		default:
			break
		}
	}

	/**
	 * Cursor over a transformer handle (mouse or pen, no press); (job 162)
	 * with the pointer type, for the scene's "+" preview.
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {string} type pointerType of the event ('' when unknown)
	 */
	#hoverAt(sp, type) {
		const name = this.#h.tool() === 'select' && !this.#h.viewOnly() ? this.#h.handleAt(sp, false) : null
		if (name !== this.#hover || type !== this.#hoverType) {
			this.#hover = name
			this.#hoverType = type
			this.#h.setHoverHandle(name, type)
		}
		// (job 173) a column border of the selected table (the cursor col-resize); (job 199) a lane border: 'row'
		const b = name === null && this.#h.tool() === 'select' && !this.#h.viewOnly() ? (this.#h.tableBorderAt?.(sp, false) ?? null) : null
		const border = b === null ? false : typeof b.lane === 'string' || b.ax === 'y' ? 'row' : true
		if (border !== this.#hoverBorder) {
			this.#hoverBorder = border
			this.#h.setHoverBorder?.(border)
		}
		// (job 188) the pile of a pad (the cursor copy); (job 195) the node of a mind map (its hollow dot)
		let stack = false
		let node = null
		if (name === null && !border && this.#h.tool() === 'select' && !this.#h.viewOnly()) {
			const w = this.#h.toWorld(sp)
			const hit = this.#hit(w, HIT_TOL_MOUSE_PX)
			stack = this.#onStack(hit, w)
			const part = hit !== null ? this.#mmPart(hit, w, { touch: false }) : null
			if (part !== null) node = { id: hit, key: part.key }
		}
		this.#h.setHoverStack?.(stack)
		this.#h.setHoverNode?.(node?.id ?? null, node?.key ?? null)
	}

	/**
	 * Rubber band: items that intersect it; containers only when fully inside
	 * (otherwise a marquee started in a frame's empty inside would always grab the frame);
	 * (job 170) a shape without fill not while the rectangle lies within its outline.
	 * (job 190) These candidates (groups expanded) are kept on the press (p.cands, the offer of
	 * its release); with Alt only the locked ones are taken, else only the free ones.
	 *
	 * @param {object} p press
	 * @param {{x:number, y:number}} w current world point
	 * @param {boolean} alt Alt (Option) held
	 */
	#marquee(p, w, alt) {
		const h = this.#h
		const rect = rectOf(p.w, w)
		h.setMarquee(rect, 'select')
		const model = h.model
		const inside = new Set(model.queryRect(rect, 'contain'))
		// containers and connectors only when completely inside, (job 209) at LOD 2 too
		const whole = (t) => typeInfo(t).container || isLine(t)
		const coarse = !!h.coarse?.()
		// a hit member brings its whole group (M2, R20 Gruppieren); locked items never (M2, R20),
		// (job 190) with Alt only they; (job 170) not at LOD 2, where a shape without fill is painted filled
		const hits = model.queryRect(rect, 'intersect')
			.filter((id) => !whole(model.get(id).t) || inside.has(id))
			.filter((id) => coarse || !inUnfilled(model, id, rect))
		p.cands = expandGroups(model, hits)
		p.alt = alt
		if (alt) this.#altFrame = true
		const ids = p.cands.filter((id) => isLocked(model.get(id)) === alt)
		if (h.selection.set([...p.keep, ...ids])) {
			h.selectionChanged()
		}
	}

	#onUp = (e) => {
		const h = this.#h
		const p = this.#press
		if (!p || e.pointerId !== p.pid) return
		this.#press = null
		this.#clearCellHold()
		if (p.hold) h.holdSignal(null)
		switch (p.mode) {
		case 'laser':
			// (job 171) released: the stroke ends, the tool stays
			h.laser(null)
			break
		case 'ink':
			// (job 273) released: the stroke is made (or the touched strokes erased), the tool stays
			h.ink(h.local(e), 'end')
			break
		case 'locked':
			// (job 151) released on a locked item without a drag: the click selects it by the usual rules
			this.#click(p.hit, p.shift)
			// (job 195) and focuses the node of a mind map
			if (typeof p.mmKey === 'string' && !p.shift && h.selection.size === 1 && h.selection.has(p.hit)) h.setMmFocus(p.hit, p.mmKey)
			break
		case 'mm-dot':
			// (job 195) a click on a fold dot: folds or unfolds that branch
			h.intent({ type: 'mmFold', id: p.hit, key: p.mmKey })
			this.#touchCreated = p.coarse
			break
		case 'mm-node':
			// (job 195) the dragged node lands at its target
			h.endNodeDrag(true)
			break
		case 'head':
			// (job 208) the dragged lane or column lands where its bar is
			h.endHeadDrag(true)
			break
		case 'frame-pending':
			// (job 163) released in the selection frame without a drag: a click on empty canvas or the hit
			if (p.hit === null) {
				if (h.selection.clear()) h.selectionChanged()
			} else {
				this.#click(p.hit, false)
			}
			break
		case 'pending':
		case 'mm-node-pending':
		case 'head-pending':
			if (p.collapse !== null && h.selection.set(p.collapse)) h.selectionChanged()
			// (job 195) a click into a multi-selection narrows it to the mind map: the node under it gets the focus
			if (typeof p.mmKey === 'string' && h.selection.size === 1 && h.selection.has(p.hit)) h.setMmFocus(p.hit, p.mmKey)
			if (typeof p.title === 'string') {
				// (job 143) the second click on the title band: the title editor, like Enter
				h.editFromUser(p.title)
				// a finger's or pen's compatibility click must not land beside the new editor and end it
				this.#touchCreated = p.coarse
			}
			break
		case 'col':
			// (job 173) released: one intent with the new width
			h.endColumn(true)
			break
		case 'take':
			// (job 188) released: the note lands here, its editor opens under a finger or a pen
			h.endTake(true)
			this.#touchCreated = p.coarse
			break
		case 'handle':
			if (Object.prototype.hasOwnProperty.call(MM_PLUS, p.handle)) {
				// (job 195) the "+" of the focused node: a child or a sibling, its editor opens
				const f = h.mmFocus?.() ?? null
				if (f !== null) h.intent({ type: 'mmAdd', id: f.id, key: f.key, ...MM_PLUS[p.handle], open: true })
				this.#touchCreated = p.coarse
				break
			}
			if (typeof p.item === 'string' && p.handle === LANE_ADD) {
				// (job 199) the "+" of a frame with lanes: a new lane at its end
				h.intent({ type: 'laneAdd', id: p.item })
				this.#touchCreated = p.coarse
				break
			}
			if (typeof p.item === 'string' && p.handle === COL_ADD) {
				// (job 208) the "+" of a frame with columns: a new column at its end
				h.intent({ type: 'colAdd', id: p.item })
				this.#touchCreated = p.coarse
				break
			}
			if (typeof p.item === 'string' && Object.prototype.hasOwnProperty.call(TABLE_AXES, p.handle)) {
				// (job 173) the "+" of a table: an empty column or row at its end
				h.intent({ type: 'tableAppend', id: p.item, axis: TABLE_AXES[p.handle] })
				this.#touchCreated = p.coarse
				break
			}
			// (job 136) a "+" handle released without a drag: an empty neighbour on that side,
			// (job 148) joined by a connector with the options of a drag from "+"
			if (typeof p.item === 'string') {
				if (h.model.get(p.item)?.t === 'text') {
					// (job 159) a text item: a connector hangs from this "+" until the next click or tap
					const w = h.toWorld(h.local(e))
					if (h.beginConnectHandle(p.handle, w, true)) {
						this.#hang = { last: w, coarse: p.coarse }
						h.moveConnect(w, { ctrl: e.ctrlKey || e.metaKey, coarse: p.coarse })
					}
				} else {
					const o = h.toolOptions('connector')
					h.intent({ type: 'neighbour', id: p.item, side: PLUS_SIDES[p.handle], connect: { route: o.route, endCap: o.endCap } })
				}
				// a pen tap on a tablet (S Pen, Apple Pencil) also sends touch events with a compatibility click
				this.#touchCreated = p.coarse
			}
			break
		case 'hang':
			// (job 159) released: the end of the hanging connector here
			this.#endHang(h.local(e), e.ctrlKey || e.metaKey, p.coarse)
			this.#touchCreated = p.coarse
			break
		case 'drag':
			h.endDrag(true)
			break
		case 'transform':
			h.endTransform(true)
			break
		case 'connect':
			h.moveConnect(h.toWorld(h.local(e)), { ctrl: e.ctrlKey || e.metaKey, coarse: p.coarse })
			h.endConnect(true)
			break
		case 'marquee':
			h.setMarquee(null)
			if (!p.alt && !p.shift) {
				// (job 190) a plain marquee offers the locked items among its last candidates
				const locked = p.cands.filter((id) => isLocked(h.model.get(id)))
				if (locked.length > 0) h.lockedOffer(locked)
			}
			break
		case 'sticky':
		case 'table':
		case 'mindmap': {
			// (job 173) a table like a note: centred on the point; (job 188) the note tool's type 'pad' a note pad;
			// (job 195) a mind map too
			const t = p.mode === 'sticky' && h.toolOptions('sticky').type === 'pad' ? 'pad' : p.mode
			h.intent({ type: 'create', t, at: { x: p.w.x, y: p.w.y }, rect: null })
			h.setToolFromScene('select')
			this.#touchCreated = p.coarse
			break
		}
		case 'frame':
		case 'shape':
		case 'text':
			this.#create(p)
			// (job 143) a pen too: a new frame's title editor lies above the frame, not under the pen
			this.#touchCreated = p.coarse
			break
		default:
			break
		}
	}

	/**
	 * (H1, SPEC-M1 §35) The touchend of a finger that just created an item:
	 * cancelled, because the browser would otherwise follow the tap with
	 * compatibility mouse events and a click at the finger's point, where the
	 * new item's editor or the context bar now lies (the mousedown moved the
	 * focus out of the editor, which ended it; the click hit a colour
	 * swatch). The mouse has no such echo: its mousedown comes before the
	 * item. (job 143) A pen on a tablet (S Pen, Apple Pencil) sends touch
	 * events with a compatibility click too, so a pen's create sets the flag
	 * as well: the title editor of a new frame lies above the frame, and a
	 * compatibility mousedown on the canvas below it would end it at once.
	 * Only after a create (job 136: and after a tap on a "+" handle, whose
	 * neighbour or connector now lies there and would take the selection; job 143: and after the second
	 * tap on a frame's title band, which opens its title editor there; job
	 * 159: and after the tap on a text item's "+" and the tap that sets the
	 * end of its hanging connector): a tap with the select tool keeps its click
	 * (two of them make the double tap that opens the editor). Never on an
	 * overlay control (editor, chip button): the creating finger never starts
	 * there (claimTouch), so such a touchend belongs to a later touch whose
	 * pointerdown the control stopped before it cleared the flag.
	 *
	 * @param {TouchEvent} e touchend
	 */
	#onTouchEnd = (e) => {
		if (!this.#touchCreated) return
		this.#touchCreated = false
		if (e.cancelable && !this.#h.isInteractiveTarget(e)) e.preventDefault()
	}

	/**
	 * Frame, shape or text tool released: a drag big enough gives a rect
	 * (text: its width is the wrap width), a click the default size (rect null).
	 *
	 * @param {object} p press
	 */
	#create(p) {
		const h = this.#h
		h.setMarquee(null)
		const r = rectOf(p.w, p.last)
		const s = h.scale()
		let big
		if (p.mode === 'frame') {
			big = p.moved && r.w * s >= MIN_FRAME_PX && r.h * s >= MIN_FRAME_PX && r.w >= MIN_FRAME_PX && r.h >= MIN_FRAME_PX
		} else if (p.mode === 'shape') {
			const [min] = typeInfo('shape').size
			big = p.moved && r.w * s >= MIN_SHAPE_PX && r.h * s >= MIN_SHAPE_PX && r.w >= min && r.h >= min
		} else {
			const [min] = typeInfo('text').size
			big = p.moved && r.w * s >= MIN_TEXT_PX && r.w >= min
		}
		const intent = { type: 'create', t: p.mode, at: { x: p.w.x, y: p.w.y }, rect: big ? r : null }
		if (p.mode === 'shape') {
			const o = h.toolOptions('shape')
			intent.data = { kind: o.kind }
			// (job 203) an own shape: its picture, and the proportions of its library entry without a dragged box
			if (o.kind === 'image' && o.picture) {
				intent.data.img = splitImage(o.picture.uri)
				intent.size = pictureSize(o.picture.w, o.picture.h)
			}
		}
		// (job 199) the frame tool's option frameKind 'lanes': a frame with lanes
		if (p.mode === 'frame' && h.toolOptions('frame')?.frameKind === 'lanes') intent.lanes = true
		h.intent(intent)
		h.setToolFromScene('select')
	}

	/**
	 * (job 143) A press at w lies on the title band of frame id: above its
	 * top edge, the rule of the double click (the hit test found the frame
	 * there; at LOD 2 also by its painted title); (job 158) and in its text
	 * zone: at most max(tw + TITLE_CLICK_PAD_PX, TITLE_CLICK_MIN_PX) screen
	 * px right of its left edge, tw the width of the text it shows there
	 * (host.titleTextWidth, measured now); no zone without such a text.
	 *
	 * @param {string} id item the press hit
	 * @param {{x:number, y:number}} w world point
	 * @return {boolean}
	 */
	#onTitleText(id, w) {
		const h = this.#h
		const it = h.model.get(id)
		const a = h.model.abs(id)
		if (!it || !a || typeInfo(it.t).hit !== 'frameEdge' || textPathOf(it.t) === null || w.y >= a.y) return false
		const tw = h.titleTextWidth?.(id) ?? null
		if (typeof tw !== 'number' || !Number.isFinite(tw)) return false
		const s = h.scale()
		return w.x <= a.x + Math.max(tw + TITLE_CLICK_PAD_PX / s, TITLE_CLICK_MIN_PX / s)
	}

	#onCancel = (e) => {
		// (job 156) a cancelled right press sends no contextmenu any more (Windows: none without a pointerup)
		this.#right = 0
		if (this.#press && e.pointerId === this.#press.pid) {
			// (job 159) the press that would set the end goes; the connector keeps hanging
			if (this.#press.mode === 'hang') this.#press = null
			else this.cancel()
		}
	}

	#onLeave = (e) => {
		if (e.pointerType !== 'touch' && !this.#press) {
			this.#h.pointer(null)
			// (job 162) off the canvas no handle is hovered (no "+" preview)
			if (this.#hover !== null || this.#hoverType !== null) {
				this.#hover = null
				this.#hoverType = null
				this.#h.setHoverHandle(null, null)
			}
			if (this.#hoverBorder) {
				this.#hoverBorder = false
				this.#h.setHoverBorder?.(false)
			}
			this.#h.setHoverStack?.(false)
			this.#h.setHoverNode?.(null, null)
		}
	}

	/**
	 * (job 252) A point above the top edge of frame id lies on its visible
	 * tab (host.titleTextWidth, the width the model's hit test uses), widened
	 * by tol on its right; false without a tab.
	 *
	 * @param {string} id frame id
	 * @param {{x:number, y:number}} w world point
	 * @param {number} tol tolerance (world)
	 * @return {boolean}
	 */
	#onTab(id, w, tol) {
		const a = this.#h.model.abs(id)
		const tw = this.#h.titleTextWidth?.(id) ?? null
		if (!a || typeof tw !== 'number' || !Number.isFinite(tw) || tw <= 0) return false
		return w.x >= a.x - tol && w.x <= a.x + Math.min(tw, a.w) + tol
	}

	#onDblClick = (e) => {
		const h = this.#h
		if (h.isInteractiveTarget(e) || h.viewOnly() || h.tool() !== 'select') return
		const w = h.toWorld(h.local(e))
		// (job 170) the hit of a press first (an item under a shape without fill opens its own editor);
		// nothing there: the inside of a shape without fill opens its editor as before
		const id = this.#hit(w, HIT_TOL_MOUSE_PX) ?? this.#hit(w, HIT_TOL_MOUSE_PX, false)
		if (id === null) return
		const it = h.model.get(id)
		// (job 173) a table: the editor of the cell under the point; (job 195) a mind map: of the node there
		if (!textPathOf(it.t) && it.t !== 'table' && it.t !== 'mindmap') return
		// (job 188) the pile of a pad opens nothing (its band opens the title)
		if (this.#onStack(id, w)) return
		const a = h.model.abs(id)
		if (typeInfo(it.t).hit === 'frameEdge' && w.y >= a.y && (h.headAt?.(id, w) ?? null) === null) {
			return // frames: only the title band edits the title; (job 199) the head of a lane its name (job 208: of a column)
		}
		if (typeInfo(it.t).hit === 'frameEdge' && w.y < a.y && !h.coarse?.() && !this.#onTab(id, w, HIT_TOL_MOUSE_PX / h.scale())) {
			return // (job 252) above the top edge beside the tab: the frame's edge band, no title
		}
		e.preventDefault()
		h.editFromUser(id, w)
	}

	/**
	 * The canvas's contextmenu event → intent contextMenu (rules 1–7 in the
	 * header; SPEC-M1 §9.5 WP-S4, step 4.2). (job 156) It listens on window:
	 * the contextmenu of a right-button press may land outside the canvas;
	 * any other one there stays the browser's.
	 *
	 * @param {MouseEvent|PointerEvent} e contextmenu
	 */
	#onContextMenu = (e) => {
		const h = this.#h
		if (this.#right !== 1 && !this.#el.contains(e.target)) return
		const down = this.#menuDown
		this.#menuDown = null
		if (this.#right === 1) {
			// (job 156) the contextmenu of a right press, wherever it lands: its menu opens at the release
			// (rightClick); a finger's (rule 4, its pointerType) drops the mouse's menu; (job 168) the pen's
			// contextmenu comes with any pointerType and drops nothing
			this.#right = e.pointerType === 'touch' && !this.#rightPen ? 2 : 0
			e.preventDefault()
			return
		}
		if (this.#press?.mode === 'laser' || this.#press?.mode === 'ink') {
			// (job 171) a pen or mouse held still while pointing (press-and-hold, macOS Ctrl+click): no menu,
			// the stroke goes on
			if (!h.isInteractiveTarget(e)) e.preventDefault()
			return
		}
		if (this.#hang !== null) {
			// (job 159) any other contextmenu (macOS Ctrl+click, a pen held still) drops a hanging connector, no
			// menu; a finger's (Android's long press, its type as in rule 4) leaves it hanging: a held finger does nothing
			if (!h.isInteractiveTarget(e)) e.preventDefault()
			const type = typeof e.pointerType === 'string' && e.pointerType !== '' ? e.pointerType : down
			if (type !== 'touch') this.cancel()
			return
		}
		// 1. overlay controls and an open text editor keep the browser's own menu (spelling)
		if (h.isInteractiveTarget(e) || h.editorOpen()) return
		e.preventDefault()
		// 2. mode edit only; 3. no pointerdown before it: a menu key's echo (the keydown handled it) or synthetic
		if (h.viewOnly() || down === null) return
		// 4. no long press on touch (pointerType of the event where the browser sets it, else of the pointerdown)
		const type = typeof e.pointerType === 'string' && e.pointerType !== '' ? e.pointerType : down
		if (type === 'touch') return
		this.#menuAt(h.local(e), type)
	}

	/**
	 * (Job 173, round 1) Starts the hold timer of a finger on the selected
	 * table: still pressed and not moved beyond TAP_SLOP_PX after
	 * LONG_PRESS_MS, it opens the menu of the cell under its pointerdown point
	 * (rules 5–7 like a right click) and its touchend is cancelled.
	 *
	 * @param {number} pointerId the finger
	 * @param {{x:number, y:number}} sp its pointerdown point, container px
	 */
	#armCellHold(pointerId, sp) {
		this.#clearCellHold()
		this.#cellHold = setTimeout(() => {
			this.#cellHold = null
			const p = this.#press
			if (p === null || p.pid !== pointerId || p.moved || this.#h.viewOnly()) return
			this.#menuAt(sp, 'touch')
			// the finger lifts over the menu: no compatibility click on its entries
			this.#touchCreated = true
		}, LONG_PRESS_MS)
	}

	#clearCellHold() {
		if (this.#cellHold === null) return
		clearTimeout(this.#cellHold)
		this.#cellHold = null
	}

	/**
	 * Rules 5–7 of the context menu (header) at a container point: from the contextmenu event and
	 * (job 156) from a right click at its release.
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {string} type pointer type ('pen' reaches handles with the touch radius)
	 */
	#menuAt(sp, type) {
		const h = this.#h
		// 5. a press that moved goes on; a user camera gesture: nothing; a wheel gesture or glide ends first
		const p = this.#press
		if ((p !== null && p.moved) || !h.menuReady()) return
		// 6. a press that has not moved (macOS Ctrl+click, a pen held still): no drag, marquee or create
		if (p !== null) this.cancel()
		// 7. the item under the point
		const sel = h.selection
		const hit = this.#hit(h.toWorld(sp), HIT_TOL_MOUSE_PX)
		let id = hit
		if (h.handleAt(sp, type === 'pen') !== null) {
			// a handle belongs to the selection: it stays
			const ids = sel.values()
			id = hit !== null && sel.has(hit) ? hit : ids[ids.length - 1] ?? null
		} else if (hit === null) {
			if (sel.clear()) h.selectionChanged()
		} else if (!sel.has(hit)) {
			// a member of a group (M2, R20): its members first, the hit item last
			sel.set(expandGroups(h.model, [hit]))
			h.selectionChanged()
		}
		h.intent(this.#menuIntent(id, [sp.x, sp.y], h.toWorld(sp)))
	}

	/**
	 * @param {string|null} id the menu's item
	 * @param {[number, number]} at container point
	 * @param {{x:number, y:number}} w its world point W
	 * @param {boolean} [keyboard] (job 195) the keyboard path: a mind map's node is its focus
	 * @return {object} the intent contextMenu; (job 173) on a table with the cell under W (with the select
	 *   tool, not at LOD 2: the rules of a table's structure); (job 195) on a mind map with the node as cell
	 */
	#menuIntent(id, at, w, keyboard = false) {
		const h = this.#h
		const t = id !== null ? h.model.get(id)?.t : null
		// (job 199) a frame with lanes: the lane under W
		const sub = (t === 'table' || t === 'mindmap' || (t === 'frame' && hasLanes(h.model.get(id)))) && h.tool() === 'select' && !h.coarse?.()
		let cell = sub && !(keyboard && t === 'mindmap') ? (h.cellAt?.(id, w) ?? null) : null
		if (sub && t === 'mindmap') {
			// (job 195) the node under the point gets the focus; the keyboard path takes the focus
			const f = h.mmFocus?.() ?? null
			if (cell !== null && h.selection.size === 1 && h.selection.has(id)) h.setMmFocus(id, cell)
			else if (cell === null && f !== null && f.id === id) cell = f.key
		}
		// (job 208) a frame with columns: the column under W as well
		const col = sub && t === 'frame' ? (h.colAt?.(id, w) ?? null) : null
		const out = cell !== null ? { type: 'contextMenu', id, at, cell } : { type: 'contextMenu', id, at }
		return col !== null ? { ...out, col } : out
	}

	/**
	 * ContextMenu key or Shift+F10 with the canvas focus (keyboard path, header).
	 *
	 * @param {KeyboardEvent} e keydown
	 */
	#menuKey(e) {
		const h = this.#h
		if (h.viewOnly() || this.busy || !h.menuReady()) return
		e.preventDefault()
		const ids = h.selection.values()
		const at = h.menuAnchor(ids)
		h.intent(this.#menuIntent(ids[ids.length - 1] ?? null, at, h.toWorld({ x: at[0], y: at[1] }), true))
	}

	/**
	 * (job 136) Alt/Option+arrow with the canvas focus in mode edit: always
	 * preventDefault (Alt+← would be the browser's Back); without Shift, not
	 * on auto-repeat, without a press and with exactly one selected note,
	 * shape or text item the intent neighbour on the side that faces the
	 * arrow on screen (sideToward).
	 *
	 * @param {KeyboardEvent} e keydown
	 */
	#neighbourKey(e) {
		const h = this.#h
		e.preventDefault()
		if (e.shiftKey || e.repeat || this.busy) return
		const ids = h.selection.values()
		const it = ids.length === 1 ? h.model.get(ids[0]) : null
		if (!it || !isBindable(it.t)) return
		const [ux, uy] = ARROWS[e.key]
		h.intent({ type: 'neighbour', id: it.id, side: sideToward(h.model.abs(it.id)?.r ?? 0, ux, uy) })
	}

	/**
	 * (Job 195) A key at the focus of a mind map (header).
	 *
	 * @param {KeyboardEvent} e keydown (canvas focus, no Ctrl/⌘ or Alt)
	 * @param {{id: string, key: string}} f the focus
	 * @param {boolean} editable mode edit
	 * @return {boolean} the key was the mind map's
	 */
	#mindmapKey(e, f, editable) {
		const h = this.#h
		const it = h.model.get(f.id)
		if (!it) return false
		const can = editable && !isLocked(it)
		const tree = mindTree(it)
		const root = tree.root === f.key
		if (Object.prototype.hasOwnProperty.call(MM_ARROWS, e.key)) {
			e.preventDefault()
			h.mmStep(MM_ARROWS[e.key])
			return true
		}
		if (!can) return false
		if (e.key === 'Tab') {
			e.preventDefault()
			if (e.shiftKey) {
				const parent = tree.nodes.get(f.key)?.parent ?? null
				if (parent !== null) h.setMmFocus(f.id, parent)
			} else {
				h.intent({ type: 'mmAdd', id: f.id, key: f.key, as: 'child', open: true })
			}
			return true
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			if (root) h.editFromUser(f.id)
			else h.intent({ type: 'mmAdd', id: f.id, key: f.key, as: 'sibling', open: true })
			return true
		}
		if (e.key === 'F2') {
			e.preventDefault()
			h.editFromUser(f.id)
			return true
		}
		if ((e.key === 'Delete' || e.key === 'Backspace') && !root) {
			e.preventDefault()
			h.intent({ type: 'mmDelete', id: f.id, key: f.key })
			return true
		}
		return false
	}

	#onKeyDown = (e) => {
		const h = this.#h
		// context menu rule 3: the contextmenu event a menu key may cause is that key's echo
		// (job 156: not a right-button press's)
		if (isMenuKey(e)) {
			this.#menuDown = null
			this.#right = 0
		}
		// (job 159) a hanging connector too
		const cp = this.#hang ?? (this.#press?.mode === 'connect' ? this.#press : null)
		if (cp !== null && (e.key === 'Control' || e.key === 'Meta')) {
			// Ctrl/⌘ suppresses snapping at once, not only on the next move
			h.moveConnect(cp.last, { ctrl: true, coarse: cp.coarse })
			return
		}
		if (this.#press?.mode === 'drag' && (e.key === 'Control' || e.key === 'Meta')) {
			// the same for an item drag (R12): free at once, the next move reads the event again
			const p = this.#press
			h.moveDrag(p.last.x - p.w.x, p.last.y - p.w.y, { ctrl: true })
			return
		}
		if (this.#press?.mode === 'transform' && (e.key === 'Control' || e.key === 'Meta')) {
			// and for a resize (R12): the same pointer position, free at once
			h.moveTransform(this.#press.last, { shift: e.shiftKey, alt: e.altKey, ctrl: true })
			return
		}
		if (this.#press?.mode === 'marquee' && e.key === 'Alt') {
			// (job 190) Alt during a marquee: only the locked items, at once at the last point
			if (this.#press.alt !== true) this.#marquee(this.#press, this.#press.last, true)
			return
		}
		// Esc on the canvas host goes on even when a header menu of Nextcloud cancelled it (see above)
		const cancelled = e.defaultPrevented && !(e.key === 'Escape' && h.canvasFocused(e))
		if (cancelled || ignoresShortcuts(e.target) || e.isComposing) return
		const key = e.key
		const mod = e.ctrlKey || e.metaKey
		const lower = typeof key === 'string' ? key.toLowerCase() : ''
		const editable = !h.viewOnly()
		if (mod && !e.altKey) {
			this.#modKey(e, lower, editable)
			return
		}
		if (e.altKey) {
			// (job 136) Alt/Option+arrow: a neighbour; never Ctrl/⌘+Alt (AltGr)
			if (!mod && editable && Object.prototype.hasOwnProperty.call(ARROWS, key) && h.canvasFocused(e)) this.#neighbourKey(e)
			return
		}
		if (key === 'Escape') {
			if (h.tool() === 'laser') {
				// (job 171) Esc ends a running stroke and goes back to select; the selection stays
				if (this.busy) this.cancel()
				h.setToolFromScene('select')
			} else if (h.tool() === 'pen' && !this.busy) {
				// (job 273) Esc goes back to select; during a stroke it only drops the stroke (below)
				h.setToolFromScene('select')
			} else if (this.busy) {
				this.cancel()
			} else if ((h.mmFocus?.() ?? null) !== null) {
				// (job 195) the focus first, then the selection
				h.setMmFocus(null, null)
			} else if (h.selection.clear()) {
				h.selectionChanged()
			}
			// (job 190) and the offer of locked items
			h.lockedOffer(null)
			return
		}
		// every other key is a single-key shortcut: only with the canvas focus
		if (!h.canvasFocused(e)) return
		if (isMenuKey(e)) {
			this.#menuKey(e)
			return
		}
		if (key === ' ' || e.code === 'Space') {
			e.preventDefault()
			if (!e.repeat) h.setSpace(true)
			return
		}
		if (e.shiftKey && e.code === 'Digit1') {
			e.preventDefault()
			h.userCamera('fit')
			return
		}
		if (e.shiftKey && e.code === 'Digit0') {
			e.preventDefault()
			h.userCamera('100')
			return
		}
		if (e.shiftKey && e.code === 'Digit2') {
			e.preventDefault()
			h.userCamera('selection')
			return
		}
		if (key === '?') {
			// (job 145) the shortcuts overview, in every mode: no intent; Shift allowed (US Shift+/, DE Shift+ß)
			if (!e.repeat && !this.busy) {
				e.preventDefault()
				h.showShortcuts()
			}
			return
		}
		if (key === '+' || key === '=' || e.code === 'NumpadAdd') {
			e.preventDefault()
			h.userCamera('in')
			return
		}
		if (key === '-' || key === '_' || e.code === 'NumpadSubtract') {
			e.preventDefault()
			h.userCamera('out')
			return
		}
		// (job 195) the keys at the focus of a mind map
		if (!this.busy && (h.mmFocus?.() ?? null) !== null && this.#mindmapKey(e, h.mmFocus(), editable)) return
		if (key === 'Delete' || key === 'Backspace') {
			e.preventDefault()
			const ids = h.selection.values()
			if (editable && ids.length > 0 && !this.busy) {
				h.intent({ type: 'delete', ids })
			}
			return
		}
		if (Object.prototype.hasOwnProperty.call(ARROWS, key)) {
			e.preventDefault()
			if (editable && !this.busy) {
				const [ux, uy] = ARROWS[key]
				h.nudge(ux * (e.shiftKey ? NUDGE_BIG : NUDGE), uy * (e.shiftKey ? NUDGE_BIG : NUDGE))
			}
			return
		}
		if (key === 'Tab') {
			// no preventDefault after the last (before the first) item: Tab leaves the canvas (WCAG 2.1.2)
			if (editable && !this.busy && h.tabSelect(e.shiftKey ? -1 : 1)) e.preventDefault()
			return
		}
		if (key === 'Enter') {
			const ids = h.selection.values()
			if (editable && ids.length === 1 && !this.busy && h.model.get(ids[0])?.t === 'pad') {
				// (job 188) a note pad: a note right of it (locked too), never its title editor
				e.preventDefault()
				h.intent({ type: 'takeNote', id: ids[0], at: null })
				return
			}
			// (job 173) a table: its top-left cell; (job 195) a mind map without a focus: its root
			if (editable && ids.length === 1 && !this.busy && (textPathOf(h.model.get(ids[0])?.t) || ['table', 'mindmap'].includes(h.model.get(ids[0])?.t))) {
				e.preventDefault()
				h.editFromUser(ids[0])
			} else if (editable && !this.busy && isOneGroup(h.model, ids)) {
				// exactly one group (M2, R20): the keyboard way to the double click – narrow to
				// the current item like the second click, then its editor (when it may open)
				e.preventDefault()
				const cur = h.model.get(ids[ids.length - 1])
				if (h.selection.set([cur.id])) h.selectionChanged()
				// (job 188) never a pad's title (Enter takes notes there)
				if (textPathOf(cur?.t) && !isLocked(cur) && cur.t !== 'pad') h.editFromUser(cur.id)
			}
			return
		}
		if (lower === 'g' && !e.shiftKey) {
			// the background grid (R12): a view setting of this person, in every mode
			if (!e.repeat && !this.busy) h.toggleGrid()
			return
		}
		if (lower === 'c' && !e.shiftKey) {
			// other people's cursors (job 147): a view setting of this person, in every mode
			if (!e.repeat && !this.busy) h.toggleCursors()
			return
		}
		if (!e.shiftKey && Object.prototype.hasOwnProperty.call(TOOLS_BY_KEY, lower) && !this.busy) {
			const tool = TOOLS_BY_KEY[lower]
			if (editable || tool === 'select' || tool === 'hand') {
				h.setToolFromScene(tool)
			}
		}
	}

	/**
	 * Ctrl/⌘ combinations (window wide, outside text fields and dialogs).
	 *
	 * @param {KeyboardEvent} e event
	 * @param {string} lower lower-case key
	 * @param {boolean} editable not view-only
	 */
	#modKey(e, lower, editable) {
		const h = this.#h
		if (lower === 'z' && !e.shiftKey) {
			e.preventDefault()
			if (editable && !this.busy) h.intent({ type: 'undo' })
		} else if ((lower === 'z' && e.shiftKey) || (lower === 'y' && e.ctrlKey && !e.shiftKey)) {
			e.preventDefault()
			if (editable && !this.busy) h.intent({ type: 'redo' })
		} else if (lower === 'a' && !e.shiftKey) {
			e.preventDefault()
			// every item but the locked ones (M2, R20); (job 190) those are offered
			const ids = [...h.model.ids()]
			if (h.selection.set(ids.filter((id) => !isLocked(h.model.get(id))))) h.selectionChanged()
			h.lockedOffer(ids.filter((id) => isLocked(h.model.get(id))))
		} else if (lower === 'l' && e.shiftKey) {
			// lock or unlock the selection (M2, R20): always ours, like Ctrl/⌘+Z
			e.preventDefault()
			if (editable && !this.busy) h.intent({ type: 'toggleLock' })
		} else if (lower === 'g') {
			// group (Shift: ungroup) the selection (M2, R20): always ours, else the browser finds on
			e.preventDefault()
			if (editable && !this.busy) h.intent({ type: e.shiftKey ? 'ungroup' : 'group' })
		} else if ((lower === 'c' || lower === 'x' || lower === 'd') && !e.shiftKey) {
			// marked page text: the browser copies it, Knorke stays out (§6.3)
			if (hasTextSelection() || h.selection.size === 0 || this.busy) return
			if (lower === 'c') {
				e.preventDefault()
				h.intent({ type: 'copy' })
			} else if (editable) {
				e.preventDefault()
				h.intent({ type: lower === 'x' ? 'cut' : 'duplicate' })
			}
		} else if (lower === 'f' && !e.shiftKey) {
			// (job 271) search on the board instead of the browser search, in every mode; no intent
			e.preventDefault()
			if (!e.repeat) h.showSearch()
		} else if (lower === 'v' && editable && !this.busy) {
			// no preventDefault: the DOM paste event must follow (the session focuses its paste catcher now)
			h.intent({ type: 'pasteKey', inPlace: e.shiftKey })
		}
	}

	#onKeyUp = (e) => {
		if (e.key === ' ' || e.code === 'Space') {
			this.#h.setSpace(false)
		}
		const cp = this.#hang ?? (this.#press?.mode === 'connect' ? this.#press : null)
		if (cp !== null && (e.key === 'Control' || e.key === 'Meta')) {
			this.#h.moveConnect(cp.last, { ctrl: false, coarse: cp.coarse })
		}
		if (this.#press?.mode === 'drag' && (e.key === 'Control' || e.key === 'Meta')) {
			const p = this.#press
			this.#h.moveDrag(p.last.x - p.w.x, p.last.y - p.w.y, { ctrl: false })
		}
		if (this.#press?.mode === 'transform' && (e.key === 'Control' || e.key === 'Meta')) {
			this.#h.moveTransform(this.#press.last, { shift: e.shiftKey, alt: e.altKey, ctrl: false })
		}
		if (e.key === 'Alt') {
			// (job 190) Alt released during a marquee: the free items again, at once
			if (this.#press?.mode === 'marquee' && this.#press.alt === true) this.#marquee(this.#press, this.#press.last, false)
			// the keyup after an Alt marquee would focus the browser's menu on Windows
			if (this.#altFrame) {
				this.#altFrame = false
				e.preventDefault()
			}
		}
	}
}
