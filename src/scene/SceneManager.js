/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SceneManager (SPEC-M0 §6.3, v2 in SPEC-M1 §6.3): the facade BoardSession
 * [C] talks to. It owns the Konva renderer, the DOM overlay (cursors, chips,
 * text editor, the hold ring of the touch marquee), the gesture and input
 * controllers, the transformer and the ONE animation-frame loop.
 *
 * Fixed semantics (R2):
 * - camera: getCamera() and stats().camera are the CONFIRMED camera (unchanged
 *   during a CSS gesture); stats().liveCamera is the gesture camera. onCamera
 *   fires with the live camera at most 10 × per second, and once at the end of
 *   a gesture with the new confirmed camera.
 * - (M1) onUserCamera() fires once per USER camera change: a wheel or touch
 *   gesture (its first frame), a hand/space/middle-button pan (its first
 *   move), the zoom keys +/−, Shift+1/0/2 and a Tab selection that pans the
 *   item into view, and (R16, from WP-S3 on) the small-target zoom of mode
 *   vote; never for setCamera, fit or zoomBy of this facade and never for
 *   followTo.
 * - (stage 3, signatures frozen in phase 0 and step 3.1b, behaviour WP-S3,
 *   SPEC-M1 §6.3) setVoteState(state) checks a SceneVoteState strictly,
 *   values included (TypeError on a deviation, the old state stays) and
 *   keeps a copy; null clears it. The renderer paints from it (own badges in
 *   state.color with digits in contrastTextOn, totals, with markVotable the
 *   empty rings and the scope outline); stats().voteState = null without
 *   one, else {scope, markVotable, live, rings, badges, totals, outline} counted
 *   from what the last frame DREW. Mode vote: a click (mouse) or tap
 *   (finger, pen) on an item asks votable(id) === true → vote {id, rect:
 *   itemScreenRect} or voteMiss {id}; a touch/pen tap on a votable item
 *   smaller than SMALL_TARGET_PX zooms instead (onUserCamera); empty canvas
 *   gives nothing. followTo(cam, ms) → Promise<boolean> glides over the CSS
 *   path without onActivity gesture and without onUserCamera (onCamera as
 *   for a gesture), semantics (1)–(7) of §6.3 "Folgen" at followTo;
 *   stopFollow() ends a glide (a no-op without one). getViewport() = the
 *   world rectangle of the confirmed camera; cameraForRect(rect, padPx) = a
 *   camera without the 100 % limit of fit() (job 238: at most 400 % unless
 *   its maxScale says more). onActivity kind 'press' in
 *   modes vote and view describes the canvas: on with the first pointer
 *   down, off with the last one up (and at a switch to edit).
 * - (stage 4, step 4.2, SPEC-M1 §9.5 WP-S4 (R16)) context menu: onIntent
 *   ({type:'contextMenu', id, at:[x, y]}), at in container px, mode edit
 *   only. It fires for the canvas's contextmenu event of a mouse or pen
 *   (macOS Ctrl+click, press-and-hold), (job 156) at the pointerup of a
 *   right click of the mouse (job 168: or of the pen's side button), and for the ContextMenu key
 *   or Shift+F10 with the canvas focus; the rules
 *   (selection first, handles, empty canvas, keyboard anchor, what drops an
 *   unmoved press) are in the Intent typedef and in InputController.js. It
 *   never fires in modes vote and view (preventDefault as before), for a
 *   finger (no long press on touch; job 173: but a finger held on a cell of
 *   the one selected table, InputController), during a moved press or a user camera
 *   gesture, nor while a text editor is open or for an overlay control;
 *   these two keep the browser's own menu (no preventDefault).
 * - (job 156) right-drag: a right press on the canvas (not on an overlay
 *   control; the right mouse button, job 168: or the pen with its side
 *   button, GestureController isRightPress) pans in every mode, with every
 *   tool and wheel stage, on items and handles too, once it moves beyond
 *   its threshold (DRAG_THRESHOLD_PX, the pen TAP_SLOP_PX; wantsPan,
 *   deferPan: the direct path like the middle button, onActivity gesture,
 *   its first step covers the whole way since the pointerdown). It selects,
 *   moves and creates nothing. Released within the threshold it is a right
 *   click: the menu at the release point in mode edit, nothing in modes
 *   vote and view. The contextmenu event of the press (after the
 *   pointerdown on macOS and Linux, after the pointerup on Windows, maybe
 *   outside the canvas) gets preventDefault and opens nothing
 *   (InputController). (job 168) Beside an open text editor the press
 *   leaves it open with its focus, text and caret, and the editor moves
 *   with its item during the pan; only a right click ends it, at its
 *   release, with its final commit before the menu.
 * - releasing a drag calls onDragPreview([]) → onIntent({type:'move', …})
 *   (isActive(id) still true, the model still at the dragged position) →
 *   onActivity({kind:'drag', active:false}); a transform releases the same
 *   way: onDragPreview([]) → onIntent({type:'transform', …}) (isActive still
 *   true) → onActivity({kind:'transform', active:false}). Esc ends either
 *   without an intent (model back).
 * - (M2, SPEC-M1 §1.2 (R12)) a drag snaps: the union box of the dragged
 *   boxes (connectors not counted, taken at the start) snaps per axis with
 *   its left/centre/right and top/middle/bottom lines to the same lines of
 *   the items in view at the start (src/model/snap.js; not the dragged items,
 *   their descendants and attached connectors, no connector at all), within
 *   OBJECT_SNAP_PX screen px of the live scale; with the same threshold a
 *   gap to a neighbour in the row or column of the box snaps to the gap of
 *   two other items there (equal gaps, snapMove; the smaller correction per
 *   axis wins against a line). The model, the preview rows (onDragPreview)
 *   and the move intent carry the snapped shift; the guides and the gap
 *   markers go to the renderer's uiGroup while snapped (stats().snapGuides,
 *   stats().gapMarkers) and leave at the end. Ctrl/⌘ held (host.moveDrag
 *   mods.ctrl) drags free.
 * - (M2, R12) a resize snaps too: a transform with a resize handle collects
 *   the candidates once at its start (the items in the live view; one item:
 *   without itself, so the children of a resized frame are targets; several:
 *   without everything that moves) and every step snaps the moving edges of
 *   the transformer frame to them (TransformController.step snap, the same
 *   threshold); the guides go to the renderer while snapped
 *   (stats().snapGuides) and leave before the release's onDragPreview([]),
 *   at Esc and when the transform is dropped. No gap markers. Ctrl/⌘ held
 *   (host.moveTransform mods.ctrl) resizes free.
 * - (job 194) numbers like Miro, only for this client: while a drag or a
 *   resize shows guides, each guide gets a measuring line to the nearest
 *   candidate on its line (snap.js guideMeasure; renderer.setMeasureLines),
 *   and each gap marker and measuring line a label with its length in whole
 *   board units (renderer.setSnapLabels; stats().measureLines,
 *   stats().snapLabels); they come and go with the guides and markers. While
 *   a resize handle is dragged, a label "W × H" of the transformer frame sits
 *   below the bottom right corner of the drawn frame (renderer.setSizeLabel,
 *   stats().sizeLabel), Ctrl/⌘ or not; it leaves when the transform ends.
 * - (M2, R12) background grid: option grid (default false; only true turns it
 *   on), setGrid(on) / getGrid(); the renderer paints it below everything
 *   (renderer.setGrid, from mount() on), in every mode. The key G with the
 *   canvas focus (InputController) toggles it through host.toggleGrid and
 *   reports onGrid(on) (like onTool: only for the scene's own switch, never
 *   for setGrid). While it is on, a drag puts the left/top edge of its box
 *   on the GRID_SIZE grid and a resize its moving edges (snapMove,
 *   TransformController.step snap.grid), on every axis where no item snaps
 *   (items keep the priority); Ctrl/⌘ turns both off. (Job 238) Above
 *   400 % the step is 4 (grid.js gridSnapStep of the live scale, read anew
 *   in every step). Option gridSnap
 *   (default true; anything but true turns it off), setGridSnap(on) /
 *   getGridSnap(): the grid snapping acts only while the grid is shown and
 *   gridSnap is on (no renderer call, no callback; BoardSession switches it
 *   from the board menu). A switch of either during a drag or resize acts
 *   from the next step. stats().grid, stats().gridSnap; stats().draws.grid.
 * - (job 154) mouse wheel: option wheel ('auto' by default, 'zoom' or 'pan';
 *   anything else is 'auto'), setWheel(stage) / getWheel(), stats().wheel;
 *   the GestureController asks it (option wheel) in every mode, also while
 *   following (a wheel zoom ends following like Ctrl/⌘ + wheel, onUserCamera).
 *   No renderer call, no callback; BoardSession switches it from the board menu.
 * - isActive(id): dragged items with descendants, transformed items with
 *   descendants, every connector attached to them (and the selected
 *   connectors that follow a drag or transform), the connector whose end is
 *   being dragged (retarget), the item in the text editor.
 * - connectors (round 1b, SPEC-M1 §6.3): tool connector (L) or a "+" handle
 *   of one selected note/shape/text drags a new connector (ConnectController:
 *   snapping to targets and anchors, Ctrl/⌘ = free, Esc cancels); the end
 *   handles of one selected connector drag that end (retarget, previewed in
 *   the model with setEndsLocal). Both report onActivity({kind:'connect'})
 *   and release like a drag: preview cleared → onIntent (isActive still true
 *   for the re-targeted connector) → onActivity(active false). A drag takes
 *   the connectors attached to the dragged items into the activeGroup (they
 *   are re-routed, the static layer is not redrawn: gate G12); a selected
 *   connector moves with the drag only when it has no bound end outside the
 *   dragged items (its free ends shift; bound ends follow their targets).
 *   Remote drag previews re-route attached connectors over the model's box
 *   resolver. A double click on a connector edits its label (kind label).
 * - the text editor has no cancel: blur, Esc, a click beside it and
 *   Ctrl/⌘+Enter end it with a commit (final: true); Esc in the editor keeps
 *   the selection; an editor with a notice discards on close. (M1) Tab in a
 *   note editor ends it with next:'right' (series entry); a text intent of a
 *   `text` item carries h, its height measured for the new text (rule 13).
 *   An editor ended by a key gives the focus back to the canvas.
 * - (R4) flushEditor() reports the open editor's not yet committed text at
 *   once as an intermediate intent (final:false) and leaves the editor open;
 *   [C] calls it first on pagehide, beforeunload, visibilitychange (hidden)
 *   and before leaving the board, because none of these fires a blur.
 * - lease lock: opening (double click, Enter, or openTextEditor without
 *   `text`) an item whose text another participant holds (RemoteSample
 *   editing == id && editingHolder) opens no editor; the chip offers "Take
 *   over" for 5 s, and a click opens the editor with onEditing(id, true).
 * - openTextEditor while the editor is closing (called from inside its final
 *   intent, e.g. the series entry) opens right after the close.
 * - the loop runs only when there is work (camera, gesture, drag, transform,
 *   non-empty presence, pending draws); presenceChanged() wakes it.
 * - keys (SPEC-M1 §6.3, §6.10): single keys only with the canvas focus (the
 *   container; mount() gives it tabindex 0 when the host did not);
 *   focusCanvas() puts the focus there.
 * - modes (SPEC-M1 §6.3, stage 2): setMode('edit'|'vote'|'view', {settle});
 *   vote is view plus voting (stage 3, above). Leaving edit
 *   without settle works like Esc (role lost, frozen): a drag, transform or
 *   connect drag ends without an intent, an open editor stays open (the
 *   session decides about it). (R13) With settle (a voting session starts
 *   while editing) the scene first ends an open editor with its final
 *   commit, then finishes a drag, transform or connect drag like a release
 *   (onDragPreview([]) → intent → onActivity({active: false})), and only
 *   then switches. setViewOnly(v) = setMode(v ? 'view' : 'edit').
 * - LOD 2 (SPEC-M1 §6.3, R13 (c)): while the renderer draws LOD 2, (job 209)
 *   a click and the marquee reach connectors as at LOD 0/1, only a finger's
 *   press and the hits of mode vote pass over them (hitTest with accept,
 *   InputController); a selected connector shows only its halo, no end
 *   handles and no "+" handles; frames hit as at LOD 0/1 (title band and
 *   border, not the inside) and (R14-13) also in their title as the LOD-2
 *   painting drew it (renderer.coarseTitleAt, host.coarseTitleAt).
 * - (M2, SPEC-M1 §1.2 "(R20) Sperren") locked items (model/locks.js): job
 *   151, like background (InputController): a click or a finger's tap
 *   selects them (the tap through onTap in mode edit, #tap), a drag from
 *   one draws the marquee (mouse, pen) or pans (finger); a drag and
 *   the arrow keys move only the unlocked top-level items of the
 *   selection; marquee and Ctrl/⌘+A skip locked items, Tab reaches them.
 *   While a top-level selected item is locked there are no transformer
 *   handles (size, rotation); exactly one locked note, shape or text keeps
 *   its four "+" handles (Connect), a locked connector shows no end
 *   handles; the outline of the selection stays; the handles follow a lock
 *   change at once. A user editor (double click, Enter, openTextEditor
 *   without text and notice) never opens on a locked item; the rescue
 *   editor (with a notice) still does. The renderer paints a lock symbol
 *   on every locked item in view, at every LOD (uiGroup, nodes/locks.js),
 *   (job 151) only while the scene is in mode edit (renderer.setMode);
 *   stats().locks counts the symbols of the last painting.
 * - (M2, SPEC-M1 §1.2 "(R20) Gruppieren", model/groups.js) groups: the
 *   selection rules of a press are InputController's. A drag and the arrow
 *   keys move only movableIds of the top-level selection (no locked item,
 *   no member of a group with a locked member; nothing left: no drag). Tab
 *   selects like a click (the members, the reached item last) and skips the
 *   other members of the current item's fully selected group. The drop
 *   target of a dragged group (the lead belongs to a group that is fully
 *   dragged) lies under the centre of the members' union; a member of a
 *   group that is not fully dragged keeps its parent and shows none. A
 *   fully selected group is a multi-selection for the transformer (four
 *   corners, uniform scaling, no rotation); with more than one top-level
 *   item there are no transformer handles while one belongs to a group
 *   with a locked member; exactly one group drops the dashed frame of the
 *   multi-selection (the corners stay). Every fully selected group gets
 *   ONE solid outline (the renderer's setSelection groups, the union of its
 *   members' rotated boxes) instead of its members' own;
 *   stats().groupOutlines counts them. Outlines and handles follow a
 *   change of group at once (update). Selections of others stay per item.
 * - (R38, SPEC-M1 §6.3 "Halten, dann Ziehen") touch marquee: a first
 *   finger held still on empty canvas for LONG_PRESS_MS with the select tool
 *   (GestureController longPress → InputController.claimLongPress) gets the
 *   hold signal: a ring under the finger (a DOM element in the overlay,
 *   [data-knorke-hold-ring], aria-hidden, HOLD_RING_PX wide; look, fade-in,
 *   forced colors and reduced motion in knorke.css) and one vibration of
 *   LONG_PRESS_VIBRATE_MS where navigator.vibrate exists. A drag beyond
 *   TAP_SLOP_PX then draws the marquee from the pointerdown point and
 *   selects live like a mouse marquee without Shift; no camera moves. The
 *   ring stays at the start point until the press ends (release, Esc,
 *   pointercancel, second finger, mode switch, destroy). stats().holdRing.
 *   The scene sets no timer of its own (the GestureController's default
 *   setTimeout).
 * - (job 136) neighbour with one click: a press on a "+" handle that ends
 *   without a move beyond the threshold (mouse and pen DRAG_THRESHOLD_PX, a
 *   finger TAP_SLOP_PX), and Alt/Option+arrow with the canvas focus, give
 *   onIntent({type:'neighbour', id, side}) (InputController); (job 148) the
 *   click or tap adds connect: {route, endCap}, the connector tool options.
 *   (job 159) The click or tap on a "+" of a text item gives no intent: a
 *   new connector hangs from that "+" without a press (beginConnectHandle
 *   with hang, stats().connecting 'connect') until the next click or tap
 *   ends it like the release of a drag from "+" (InputController); no
 *   handles and no selection box meanwhile, the finger is not claimed. Esc,
 *   a right click, another tool (setTool), a mode switch (with settle too),
 *   reset, the removal of the text item and an editor that opens drop it
 *   without a connector. Others see nothing of it. (job 169) Its connect
 *   intent carries selectEnd: true when the end is bound to an item, so the
 *   session selects that item instead of the connector.
 *   (job 162) The click or tap on a "+" of a note or shape connects to a
 *   near item instead when there is one (plusPlan, model/plus.js; the
 *   session decides, the intent stays). A mouse that hovers a "+"
 *   (InputController: host.setHoverHandle with pointerType 'mouse', no
 *   press) shows beforehand what a click does: the renderer's
 *   setPlusPreview gets the rotated box of the item it would connect to
 *   ('connect') or of the new neighbour ('neighbour'), in the uiGroup;
 *   stats().plusPreview is {kind:'connect', id}, {kind:'neighbour', box} or
 *   null. Only in mode edit with the select tool, without a hanging or
 *   dragged connector and without an editor, and only while that "+" is
 *   shown; it is planned anew when the hovered handle changes and with
 *   every reconciliation of the handles (#syncHandles: model changes, also
 *   from others, at most once per frame), never per pointermove. It goes
 *   with every pointerdown, when the pointer leaves the "+" or the canvas,
 *   with reset, and whenever that "+" is not shown (another tool or mode,
 *   an editor, a hanging connector, LOD 2). A pen (an S Pen hovering too), a
 *   finger and the "+" of a text item show none. Others see nothing of it.
 *   (job 148) While a text editor is open the scene shows no handles, and a
 *   press that ends an editor hits none (InputController). panIntoView(id)
 *   centres an item that is not fully in view, like Tab (onUserCamera).
 *   (job 150) Nor does the item of the open editor get its own selection
 *   outline (a connector: its halo), nor its fully selected group the group
 *   outline (the other members get none either); both come back when the
 *   editor closes. Others' selections of the item stay.
 * - (job 140) selection frame with a gap: the renderer draws every
 *   selection, group and multi-selection frame SELECTION_GAP_PX screen px
 *   outside the boxes (gapFrame); the transformer handles sit on that
 *   frame, the "+" buttons of tables, lanes and mind maps plusOffset(scale)
 *   from their anchors, the context bar's box is the hull of the frames,
 *   and a press into the gap of an own selected item hits it
 *   (InputController). The transform itself still works on the boxes.
 *   stats().outlines lists the frames.
 * - (job 231, redesign V8) lighter selection: one note, shape or frame has
 *   its four corner handles (a text item its sides l/r too), the rotation
 *   handle beyond the top right corner; the connection points plus-t/r/b/l
 *   lie on the drawn frame (pointOffset; a text item with its sides has no
 *   plus-l/plus-r). What the renderer draws follows shownHandles: with the
 *   mouse the rotation handle and a point show only near their corner or
 *   edge (the last hover point, InputController host.pointer(w, sp), at the
 *   confirmed camera; during a resize no rotation handle, during a rotation
 *   it stays), with a pen or a finger all of
 *   them at the touch size; the look follows the pointerType of the last
 *   pointerdown or hover on the canvas, before the first one
 *   matchMedia('(pointer: coarse)'). Hit testing (#handleAt) stays over the
 *   whole list and only with the select tool. With the connector tool one
 *   selected note, shape or text item shows its four points (display only:
 *   the tool's press snaps to the anchor). At mount the scene reads
 *   --color-primary-element of its container (selectionColorOf) and hands
 *   it to the renderer (setSelectionColor). handles() gives shown (drawn
 *   now) and size (screen px) with every handle.
 * - (job 163) drag in the selection frame: host.dragFrame() is that frame
 *   (gapFrame of the selection frame, where the four corner handles sit)
 *   of the own selection with more than one top-level item, one of them no
 *   connector and one movable; a drag that starts anywhere in it moves the
 *   whole selection (InputController), a finger over the GestureController
 *   option claimDrag (InputController.claimDrag).
 * - (job 142) one-time tip: onTouchPan() when a finger's one-finger pan
 *   starts (GestureController onTouchPan: a pending finger beyond
 *   TAP_SLOP_PX), only in mode edit with the select tool, where holding it
 *   still would have drawn a selection frame.
 * - (job 143) title hint: while the scene is in mode edit, the own
 *   selection is exactly one frame that is not locked and has no title
 *   (data.title empty or blanks only), its title editor is not open, no
 *   local drag or transform runs and the level is LOD 0 or 1, the renderer
 *   draws "Add title…" in its title band (renderer.setTitleHint, uiGroup);
 *   it follows every change by the next frame (#syncHandles, also for a
 *   title that arrives by sync). stats().titleHint is that frame's id while
 *   the hint is drawn, else null. A second press on the title band of the
 *   frame that was the whole selection before it opens its title editor
 *   (InputController), (job 158) only on its text: host.titleTextWidth(id)
 *   gives the width of the text the frame shows there, measured on every
 *   call (at LOD 0/1 its title or, while the hint is drawn, "Add title…",
 *   renderer.measureTitleWidth, at most the frame's width; at LOD 2 its
 *   title as the last painting drew it, renderer.coarseTitleWidth), null
 *   without one. revealTitle(id, top) brings a frame's title band
 *   into view below the top chrome before the editor of a new frame opens
 *   (BoardSession.createNow); (job 193) a new note pad's band below it too.
 * - (job 177) the text of a shape without fill grabs it (InputController):
 *   host.shapeTextRect(id) gives the block of the text lines such a shape
 *   draws, in its own coordinates (nodes/shape.js shapeTextBlock over the
 *   widths of renderer.measureShapeLines), measured on every call (no cache:
 *   a text that arrives by sync counts at once); null at LOD 1 and 2 (no
 *   text painted), for a blank text and for any other item.
 * - (job 172) emoji reactions of notes (nodes/reactions.js): setReactions
 *   ({canReact, me, touch}) is the session's part (role, frozen board, own
 *   pid, job 183: a touch screen); the scene adds its own rule (in mode edit
 *   only with the select tool; job 183: with touch in mode vote or view the
 *   button stands at every note, everyNote) and hands the renderer a
 *   ReactState (renderer.setReactions) with the note under a mouse or
 *   hovering pen (its box or its band), the one selected note and the notes
 *   whose button hides (dragged, transformed, in the own text editor), once
 *   per frame and only when it changed. A press on a row part (a pill, "+n",
 *   the button; exact hits before the transformer handles, then the hit
 *   tolerance, never into a note's box) is the scene's in every mode (mode
 *   edit: select tool only, never a right press): it reaches neither the
 *   gesture nor the input controller.
 *   A tap (released within DRAG_THRESHOLD_PX for a mouse, TAP_SLOP_PX for a
 *   pen or finger) gives onIntent {type:'react', id, e} on a pill (only while
 *   one may react; in mode vote it votes nothing), {type:'reactList', id,
 *   rect} on "+n" and {type:'reactPick', id, rect} on the button (rect: its
 *   screen box, container px). Held for LONG_PRESS_MS it gives
 *   {type:'reactNames', id, e, rect} on a pill and its release is no tap;
 *   the contextmenu of that press opens nothing (no menu, no touch
 *   marquee), its touchend is cancelled (no ghost click), a double click on
 *   a row part does nothing. A press that moves on beyond the threshold
 *   first is handed over: its pointerdown is sent again, so the controllers
 *   act as they would there (drag, marquee, pan). A mouse that rests on a
 *   pill for REACT_NAMES_MS gives reactNames as well, and {type:'reactNames',
 *   id: null} when it leaves the pill or the canvas. The band of the one
 *   selected note counts for its selection frame (gapFrame below), its
 *   bottom, corner and lower "+" handles, the context bar's box and the gap
 *   hit (host.reactBand). stats().reactions: the rows the renderer painted
 *   last ({id, shown: [[e, n, mine]], more, add}; [] without).
 * - (job 178) exportImage(job) draws an image of items apart from the stage
 *   (renderer.renderImage) and resolves with its PNG Blob (null when the
 *   browser gave no canvas or no Blob); nothing shown changes.
 * - (job 200) exportVector(job) draws the same items as vectors
 *   (renderer.renderVector) and resolves with {blob, width, height, scale}
 *   of the SVG or PDF (null when it could not be drawn).
 * - (job 171) laser pointer: with the tool laser (K) in mode edit the left
 *   button, a pen or a finger (claimTouch takes every first finger) draws a
 *   stroke (InputController); it selects, moves and creates nothing, and the
 *   tool stays until another one or Esc. The scene reports its points
 *   (onLaser, world) at the press, at every move and every LASER_BEAT_MS
 *   while held still, and null at its end; it draws the own trail at once in
 *   the colour of setLaserColor, the others' from RemoteSample.laser, all in
 *   the LaserLayer of the overlay (over the items, under the cursors), with
 *   the camera the user sees. Frames run only while a stroke runs or a
 *   trail is visible; stats().lasers lists the trails the last frame painted.
 *   Cursor: crosshair.
 * - (job 273) pen: with the tool pen (P) in mode edit the left button, a pen
 *   or a claimed finger (only until a pen was seen, InputController) draws a
 *   stroke of the tool's option penKind. The InkLayer of the overlay shows it
 *   at once in the kind's colour and width (options penColor/penWidth,
 *   markerColor/markerWidth; the highlighter at MARKER_OPACITY); at the
 *   release its points (world, kept from INK_MIN_STEP_PX apart, fitted to
 *   ≤ 500 with INK_TOLERANCE_PX / scale) become the intent {type: 'stroke',
 *   points, kind, stroke, strokeWidth}. The eraser (penKind 'eraser')
 *   collects every unlocked pen stroke within INK_ERASER_PX (pen or finger
 *   INK_ERASER_COARSE_PX) of its path, the renderer hides them
 *   (setErasing), and its release gives {type: 'delete', ids}. Esc, a
 *   cancel, a mode switch or another tool drop the stroke (nothing made,
 *   nothing erased); the tool and its kind stay after a stroke.
 *   stats().ink = {kind, points, erasing} while one runs, else null.
 *   Cursor: crosshair.
 * - (job 173) tables (model/table.js, nodes/table.js): the tool table (B)
 *   creates like the note tool (intent create t 'table'). The scene lays a
 *   table out by the measured text heights (measureTableCell: the renderer's
 *   Konva measurement; estimateCellHeight without one) and lists every table
 *   of the model in stats().tables as {id, cols: [w…], rows: [h…], header}.
 *   One selected, unlocked table in mode edit with the select tool, without
 *   an editor and not at LOD 2 has no connector "+" but the handles
 *   table-col (right middle) and table-row (bottom middle), plusOffset(scale)
 *   outside its box; a click on one gives {type:'tableAppend', id, axis:
 *   'col'|'row'} (InputController). Over a column border there (TABLE_BORDER_PX
 *   screen px, a finger TABLE_BORDER_TOUCH_PX, the right outer edge too) the
 *   cursor is col-resize; a drag changes that width live (the renderer's
 *   setTablePreview, stats().tables) in TABLE_COL_MIN–TABLE_COL_MAX and its
 *   release gives ONE intent {type:'tableWidth', id, col, w}; Esc ends it
 *   without one. A double click (double tap) on a cell, Enter on the one
 *   selected table (its top-left cell) and openTextEditor(id, {cell}) open
 *   the editor kind cell over that cell (lease per cell: a cell someone else
 *   holds opens nothing, its chip offers "Take over" for TAKE_OVER_MS); its
 *   row grows with the text while typing (the preview), Tab and Shift+Tab
 *   move row by row and end after the last (before the first) cell, and
 *   onEditing(id, takeover, cell) names the cell. A cell editor does not
 *   make its table active (isActive): the others' cells arrive while one
 *   writes. The chips "{name} is editing…" sit at their cells
 *   ([data-knorke-cell]). The intent contextMenu on a table carries the
 *   cell under its point (the keyboard path: under the selection's middle).
 * - (job 174) a cell editor's arrow key at the edge of its text opens the
 *   cell beside it (model/table.js neighbourCell; one someone else holds
 *   ends the editor, its chip offers "Take over"); Tab in the last cell
 *   (still there, the last in the order, no notice) gives the intent
 *   {type:'tableAppend', id, axis:'row', open:true} after the close (the
 *   session appends the row and opens its left cell); a grid pasted into a
 *   cell gives {type:'tablePaste', id, cell, grid} after the close.
 * - (job 188) note pads (model/pad.js, nodes/pad.js): the note tool has the
 *   option type ('sticky' or 'pad', model/tools.js NOTE_TOOL_TYPES); with
 *   'pad' a click creates {type:'create', t:'pad', at}, and every change of
 *   the tool (setTool, the keys, the switch back to select after creating)
 *   puts the option back to 'sticky'. A selected pad has its four corners,
 *   no rotation handle and no "+". In mode edit with the select tool a
 *   press on a pad's pile (InputController) drawn beyond the threshold
 *   shows the preview note (the pad's size and fill, the renderer's
 *   setNotePreview; stats().notePreview {id, x, y, w, h}) under the pointer
 *   with the offset where it was grabbed, and its release gives ONE intent
 *   {type:'takeNote', id, at: {x, y}}, the note's top-left corner; Esc, a
 *   second finger, pointercancel, a mode switch (settled too), reset and
 *   the removal of the pad end it without one. Enter at the one selected pad
 *   gives {type:'takeNote', id, at: null}. A mouse or pen over a pile shows
 *   the cursor copy. A double click on the band opens the editor kind
 *   padTitle over the band (one line).
 * - (job 199) swimlanes (model/lanes.js, nodes/frame.js): the frame tool has
 *   the option frameKind ('frame' or 'lanes', model/tools.js
 *   FRAME_TOOL_KINDS), put back to 'frame' with the note tool's type; with
 *   'lanes' the tool creates {type:'create', t:'frame', at, rect, lanes:
 *   true}. stats().lanes lists every frame with lanes as {id, lanes: [{key,
 *   y, h, title}]} (the bands as drawn, relative to the frame). The one
 *   selected, unlocked frame with lanes (mode edit, select tool, no editor,
 *   not at LOD 2) has the handle lane-add (bottom middle, plusOffset(scale)
 *   below), a click on it gives {type:'laneAdd', id}; the border below each
 *   lane (the frame's bottom edge for the last one) is dragged like a
 *   table's column border: the cursor row-resize, a live preview of the
 *   frame (setTablePreview {id, key, h, lane}) and of the children of the
 *   lanes below (the renderer's previews), ONE intent {type:'laneHeight',
 *   id, lane, h} at the release (whole units, at least LANE_MIN_H, the frame
 *   at most FRAME_MAX); Esc ends it without one. A double click on the head
 *   of a lane, and openTextEditor(id, {cell: <lane>}), open the editor kind
 *   lane over that head (no lease, no "Take over"); its text intents carry
 *   the lane as cell. The intent contextMenu on a frame with lanes carries
 *   the lane under W as cell.
 * - (job 208) columns of a frame with lanes: stats().lanes also has head
 *   (the head column's width as drawn), top (the head row's height) and
 *   cols: [{key, x, w, title}]. The right edge of each column (the frame's
 *   right edge for the last one) is dragged like a lane's border, the nearer
 *   of the two where both are in reach (a tie: the lane): the cursor
 *   col-resize, the live preview {id, col, w, lane} of the frame and of the
 *   children right of it, ONE intent {type:'colWidth', id, col, w} at the
 *   release (whole units, at least COL_MIN_W, the frame at most FRAME_MAX).
 *   One selected, unlocked frame with columns has the handle col-add (right
 *   middle, plusOffset(scale) right of it): {type:'colAdd', id}. A double
 *   click on a column's head (and openTextEditor(id, {cell: <column>})) opens
 *   the editor kind lane over it; the intent contextMenu carries the column
 *   under W as col. A press on the head of a lane or a column (headAt) of an
 *   unlocked frame dragged beyond the threshold (beginHeadDrag, mode edit,
 *   the select tool) shows the ghost of its band and the bar where it lands
 *   (setNodeDragPreview; stats().headDrag {id, key, to}), and its release
 *   gives {type:'laneMove', id, lane, to} or {type:'colMove', id, col, to}
 *   when to is another index; Esc, reset and the removal of the frame end it
 *   without one.
 * - (job 225) lane and column groups (model/lanes.js laneRuns, colRuns):
 *   stats().lanes also has gw, cg, g of each lane and column, groups [{key,
 *   y, h, title, lanes}] and cgroups [{key, x, w, title, cols}], one per
 *   run. headAt gives lgroup (cgroup) in a group's cell; a double click there
 *   opens the editor kind lane of the group (a lane group's turned by -90°),
 *   its text intent's path data.lgroups.<g> (data.cgroups.<h>). A dragged
 *   cell shows the ghost of its run and the bar before the unit it lands at
 *   (groupUnits, by the ghost's centre) and gives {type:'laneGroupMove' |
 *   'colGroupMove', id, group, to}. At the one selected frame the top and
 *   bottom edge of a run in the cell column (a column group's left and right
 *   edge in its cell row) win over the lane border there: the cursor
 *   row-resize (col-resize), a drag snaps to the lanes' borders, keeps one
 *   lane, stops at another group, previews {id, span, lane: true} and gives
 *   {type:'laneGroupSpan' | 'colGroupSpan', id, group, from, to} at the
 *   release when the range changed; Esc none.
 * - (job 191) tags of notes (nodes/tags.js): setTags(list) hands the
 *   board's tags (meta.tags, cleaned) to the renderer and re-lays the open
 *   note editor, whose text area ends tagReserve above the note's bottom
 *   edge like the drawn text; setTagFilter(ids) is this tab's tag filter
 *   (the renderer fades the notes without a chosen tag). A press on the
 *   "+n" chip of the topmost note's tag row (an exact hit, LOD 0 only) is
 *   the scene's like a reaction row part, in every mode: its tap gives
 *   {type:'tagList', id, rect} (no vote, no selection, no editor), a press
 *   that moves on is handed over (a drag moves the note as before).
 *   stats().tags and stats().tagFilter are the renderer's.
 * - (job 190) locked items by marquee (InputController): with Alt a marquee
 *   takes only the locked items; a plain marquee and Ctrl/⌘+A keep their
 *   skipped locked items as the offer (getLockedOffer, setLockedOffer for
 *   the session's "Select all"; onLockedOffer for the scene's own changes),
 *   only in mode edit. Every change of the selection (also setSelection, a
 *   removal), the next press, a finger's tap, Esc and leaving mode edit end
 *   it. Without a selection onSelectionBox reports the box of the offered
 *   items that still exist and are locked.
 * - (job 195) mind maps (model/mindmap.js, nodes/mindmap.js): the tool
 *   mindmap (M) creates like the note tool (intent create t 'mindmap'). The
 *   scene lays a mind map out by the measured texts (measureNodeText: the
 *   renderer's Konva measurement; estimateNodeSize without one), hands that
 *   layout to the model for the hit mode 'tree' (setTreeLayout) and lists
 *   every mind map in stats().mindmaps: {id, layout, focus, nodes: [{key,
 *   parent, depth, side, x, y, w, h, folded, hidden, color, shape, text, dot, free}]}
 *   (world boxes and the centre of the fold dot; a hidden node has x, y, w,
 *   h null, a node without children dot null). The focus is one node
 *   of the one selected mind map (a click on it, the keys, focusNode), only
 *   in mode edit; onNodeFocus(id, key) reports every change (null, null
 *   when it goes: any other selection, the map gone); a focused node hidden
 *   by a fold passes the focus to its folded ancestor, a deleted one to the
 *   root. The renderer draws the focus outline and, while the map is
 *   selected or a mouse or pen hovers a node, the hollow dots
 *   (setMindmapUi). One selected, unlocked mind map with a focus, with the
 *   select tool, without an editor and not at LOD 2 has the "+" mm-child
 *   (beyond the outer edge of the focused node and its dot) and mm-sibling
 *   (below it); at the root mm-child-r and, with layout both, mm-child-l. A
 *   click on one gives {type:'mmAdd', id, key, as: 'child'|'sibling',
 *   side?: 'l'|'r'} (InputController). A press on a fold dot gives at its
 *   release {type:'mmFold', id, key}; a node (never the root) dragged beyond
 *   the threshold shows its ghost and the mark of its drop target
 *   (setNodeDragPreview, model/mindmap.js dropTarget; stats().nodeDrag {id,
 *   key, target}) and its release gives {type:'mmMove', id, key, target}.
 *   (Job 196) While it runs the map is drawn as if the node were dropped
 *   where its ghost is (previewMindmap with placeNode's patch, the dragged
 *   branch no obstacle, the rest where it was, its old room empty), and
 *   the drop target comes from that picture; a release without a target
 *   gives {type:'mmMove', id, key, target: null, place: {x, y}} (the world
 *   centre of the ghost). Esc, reset and the removal of the map end it
 *   without one. A double click on a node, F2 and Enter at the root and
 *   openTextEditor(id, {cell: key}) open the editor kind node over it (the
 *   node's key is its cell: lease, chip and take-over as for a table's
 *   cell; the root keeps its place while the text grows, previewMindmap's
 *   anchor); Enter and Tab in it give {type:'mmAdd', id, key, as: 'sibling'
 *   | 'child', open: true} after the close. The keys at a focus belong to
 *   InputController (Tab, Enter, F2, the arrows: stepFocus, Delete).
 * - (job 198) layouts org and tree (model/mindmap.js isBoxLayout): stats()
 *   nodes name the drawn shape and, in org, the card's name and role (else
 *   null). In org the "+" mm-child (at the root mm-child-r, its only one)
 *   stands below the card, mm-sibling in the gap above its top right
 *   corner (never on a card or a dot); tree has those of
 *   right. The node editor of a card shows the option cardPlaceholder (the
 *   session's text) as its placeholder; while it is empty the local preview
 *   lays the card out with that text, so the editor is large enough for it. A node dragged in org or tree shows its ghost and the mark of its
 *   target, the map stays as it is drawn (no preview patch), and a release
 *   without a target gives nothing.
 *
 * Neither the model nor any Konva object is ever handed to a reactive system;
 * this module does not import Vue.
 */
import { labelBox } from '../model/connectors.js'
import { rotatedBBox } from '../model/geometry.js'
import { expandGroups, groupOf, heldGroup, isOneGroup, movableIds, wholeGroups } from '../model/groups.js'
import {
	COL_GROUP_SIZE, LANE_PAD, LANE_TITLE_MAX, LANE_TITLE_SIZE, colBands, colGroupH, colRuns, colTop, hasCols, hasLanes, headWidth, laneBands,
	laneGroupW, laneHeadW, laneRuns, namePath,
} from '../model/lanes.js'
import { isLocked } from '../model/locks.js'
import {
	INK_ERASER_COARSE_PX, INK_ERASER_PX, INK_TOLERANCE_PX, MARKER_OPACITY, PEN_COLORS, PEN_DEFAULTS, PEN_TOOL_KINDS, PEN_WIDTHS,
	eraserTouches, fitPoints, keepPoint, pointsOf,
} from '../model/ink.js'
import { padBand, padExtent, padLayout, padPart } from '../model/pad.js'
import { tagMap } from '../model/tags.js'
import { getPath } from '../model/paths.js'
import { ENUMS, canBeChildOf, fieldValue, isBindable, textPathOf, typeInfo } from '../model/registry.js'
import { plusPlan } from '../model/plus.js'
import { hasLabel, isTextless, symbolLabelBox } from '../model/shapes.js'
import { onImageReady } from './imageCache.js'
import { placeablePicture } from '../model/shapeImage.js'
import { isUnfilledShape, labelReach, shapeLabelOf } from '../model/SceneModel.js'
import {
	TABLE_CELL_MAX, TABLE_FONT_SIZE, TABLE_PAD, cellBox, cellPath, estimateCellHeight, firstCell, hasCell, isHeadCell, neighbourCell,
	stepCell,
} from '../model/table.js'
import { buildSnapIndex, distanceText, guideMeasure, sizeText, snapMoveDetail } from '../model/snap.js'
import {
	MM_BADGE_GAP, MM_BADGE_H, MM_BADGE_ORG_GAP, MM_CARD_BAND, MM_DOT_R, MM_GAP_X, MM_GAP_Y, MM_ORG_GAP_X, MM_ORG_GAP_Y, MM_TEXT_MAX, clearPlus, drawnShape, dropTarget, estimateNodeSize, isBoxLayout,
	mindTree, mindmapLayout, nodeAtLayout, nodeText, nodesOf, placeNode, previewMindmap, stepFocus, textPath as nodeTextPath, visibleAncestor,
} from '../model/mindmap.js'
import { noteFontSize } from '../model/text.js'
import { FRAME_TOOL_KINDS, NOTE_TOOL_TYPES, TOOL_IDS } from '../model/tools.js'
import { ANCHORS, gapFrame, getCursor, handlesFor, selectionFrame, shownHandles } from '../model/transform.js'
import {
	CONNECTOR_LABEL_FILL, CONNECTOR_LABEL_FONT_SIZE, CONNECTOR_LABEL_PAD, CONNECTOR_LABEL_PAD_X, FRAME_TAB_INSET, FRAME_TAB_PAD, FRAME_TITLE_BAND,
	FRAME_TITLE_HINT_WEIGHT, FRAME_TITLE_SIZE, FRAME_TITLE_WEIGHT, frameTabFill, frameTabText, frameTabWidth, HANDLE_PX, HANDLE_TOUCH_PX, HOLD_RING_PX, LONG_PRESS_VIBRATE_MS, MAX_SCALE, MIN_SCALE,
	LOD_TEXT_SCALE, MM_FILL, NOTE_LINE_HEIGHT, OBJECT_SNAP_PX, REACT_GAP, REACT_H, SNAP_PX, STICKY_PADDING, TABLE_FILL, TEXT_COLOR,
	VOTE_BADGE_HIT_MOUSE_PX, VOTE_BADGE_HIT_TOUCH_PX, ZOOM_TO_MAX_SCALE,
	SELECTION_COLOR, STRUCT_PLUS_PX, TABLE_EDIT_MIX, laneTones, mixColor, noteTextColor, selectionColorOf, shownColor,
} from '../model/tokens.js'
import { Camera, clampScale, freePart, viewRectOf } from './Camera.js'
import { ConnectController, plusHandles, plusOffset, pointOffset, snapAt } from './ConnectController.js'
import { CursorLayer, setStyles } from './CursorLayer.js'
import { GestureController, LONG_PRESS_MS, TAP_SLOP_PX, isRightPress } from './GestureController.js'
import { gridSnapStep } from './grid.js'
import { DRAG_THRESHOLD_PX, HIT_TOL_MOUSE_PX, HIT_TOL_TOUCH_PX, InputController } from './InputController.js'
import { KonvaRenderer, handleLook } from './KonvaRenderer.js'
import { LaserLayer } from './LaserLayer.js'
import { InkLayer } from './InkLayer.js'
import { isStructPlus, onStructPlus } from './nodes/plusButton.js'
import { bandAt, reactionAt, reactionBand } from './nodes/reactions.js'
import { padLook } from './nodes/pad.js'
import { shapeTextBlock, shapeTextBox } from './nodes/shape.js'
import { noteTextReserve, tagMoreAt } from './nodes/tags.js'
import { titleHintText } from './nodes/titleHint.js'
import { Selection, topLevel } from './Selection.js'
import { isCovered } from '../model/privateWriting.js'
import { TextEditor } from './TextEditor.js'
import { isApplePlatform } from '../util/device.js'
import { openLink } from '../util/openLink.js'
import { StructureController } from './StructureController.js'
import { TransformController } from './TransformController.js'

/**
 * @typedef {{x:number, y:number, scale:number}} Camera
 * @typedef {{x:number, y:number}} Point
 * @typedef {'select'|'hand'|'sticky'|'shape'|'text'|'table'|'mindmap'|'connector'|'frame'|'laser'|'pen'} Tool
 * @typedef {{kind?:string, route?:string, endCap?:string, type?:string, penKind?:string, penColor?:string, penWidth?:number,
 *   markerColor?:string, markerWidth?:number}} ToolOptions
 * @typedef {'edit'|'vote'|'view'} SceneMode
 * @typedef {{x:number, y:number, w:number, h:number, r:number}} Box   absolute, world
 * @typedef {{key:string, pid:string, name:string, color:string, guest:boolean,
 *            cursor:([number,number]|null), selection:string[], drag:Array<[string,number,number]>,
 *            editing:(string|null), editingHolder:boolean,
 *            view:([number,number,number,number]|null)}} RemoteSample
 *   view (stage 3): the participant's viewport [x, y, w, h] in world units (presence v, §6.4); the scene does not read it
 *   (job 171) a sample may also carry laser: Array<Array<[number,number,number]>>, the participant's laser strokes as
 *   they are to be drawn now, points [x, y, age ms] (src/sync/presence.js plays them back); missing or [] = none
 *   (job 173) and editingCell: the cell "<col>.<row>" of the table `editing` (null or missing: none)
 * @typedef {{votable:(id:string) => boolean, scope:(string|null),
 *            badges:Map<string, {mine:number, total:(number|null)}>,
 *            markVotable:boolean, color:string, live?:boolean}} SceneVoteState
 *   (stage 3, SPEC-M1 §6.3, values R16; setVoteState throws a TypeError on any deviation)
 *   votable: may this item get votes, asked with an item id ([C] adapts: (id) => voteState.votable(model.get(id)));
 *   scope: frame ULID of the voting area or null (whole board);
 *   badges: per item id (string) my votes (mine, an integer >= 0) and the total (an integer >= 0, or null =
 *     show no total, e.g. while results are hidden; never undefined);
 *   markVotable: empty rings on visible votable items without an own vote and a 2-px outline around the scope frame;
 *   color: #rrggbb of the own pid ([C]: colorFor(me.pid), src/sync/presence.js; hex digits in either case, like
 *     contrastTextOn): own badges are drawn in it, their digits in contrastTextOn(color);
 *   live (job 149, optional; missing = false, else a boolean): the totals are a moderator's live count and are
 *     drawn as "live" pills (same size and place as a result total, but hollow);
 *   keys beyond these are ignored
 * @typedef {{item:string}|{item:string, ax:number, ay:number}|{x:number, y:number}} Endpoint
 * @typedef {(
 *   {type:'create', t:string, at:{x:number,y:number}, rect:({x:number,y:number,w:number,h:number}|null),
 *    data?:object, style?:object} |
 *   {type:'move', ids:string[], dx:number, dy:number, origin:Map<string,{x:number,y:number,parent:(string|null)}>,
 *    nudge?:boolean} |
 *   {type:'transform', ids:string[], before:Map<string, Box & {parent:(string|null), fontSize?:number}>,
 *    after:Map<string, Box & {fontSize?:number}>, keep:boolean} |
 *   {type:'connect', start:Endpoint, end:Endpoint, route:string, endCap:string, selectEnd?:true} |
 *   {type:'retarget', id:string, which:'start'|'end', value:Endpoint, before:Endpoint} |
 *   {type:'delete', ids:string[]} |
 *   {type:'text', id:string, path:string, value:string, before:string, final:boolean, h?:number, next?:'right', cell?:string} |
 *   {type:'tableAppend', id:string, axis:('col'|'row'), open?:boolean} | {type:'tableWidth', id:string, col:string, w:number} |
 *   {type:'takeNote', id:string, at:({x:number, y:number}|null)} |
 *   {type:'tablePaste', id:string, cell:string, grid:string[][]} |
 *   {type:'reorder', ids:string[], where:'front'|'back'} |
 *   {type:'copy'} | {type:'cut'} | {type:'duplicate'} | {type:'pasteKey', inPlace:boolean} |
 *   {type:'vote', id:string, rect:{x:number, y:number, w:number, h:number}} |
 *   {type:'voteMiss', id:(string|null)} |
 *   {type:'contextMenu', id:(string|null), at:[number, number]} |
 *   {type:'neighbour', id:string, side:('t'|'r'|'b'|'l'), connect?:{route:string, endCap:string}} |
 *   {type:'undo'} | {type:'redo'} |
 *   {type:'react', id:string, e:string} | {type:'reactPick', id:string, rect:{x:number, y:number, w:number, h:number}} |
 *   {type:'reactList', id:string, rect:{x:number, y:number, w:number, h:number}} |
 *   {type:'reactNames', id:(string|null), e?:string, rect?:{x:number, y:number, w:number, h:number}, hold?:boolean} |
 *   {type:'tagList', id:string, rect:{x:number, y:number, w:number, h:number}}
 * )} Intent
 *   (job 199) {type:'laneAdd', id:string} | {type:'laneHeight', id:string, lane:string, h:number} (a frame with lanes);
 *   (job 208) {type:'colAdd', id:string} | {type:'colWidth', id:string, col:string, w:number} |
 *   {type:'laneMove', id:string, lane:string, to:number} | {type:'colMove', id:string, col:string, to:number};
 *   contextMenu on a frame with columns also carries col (the column under W);
 *   (job 173) contextMenu on a table also carries cell: "<col>.<row>" under its point (the keyboard path:
 *   under the menu anchor); text of a cell editor carries cell; tableAppend: a click on table-col/table-row;
 *   tableWidth: the release of a column border drag (whole units, TABLE_COL_MIN–TABLE_COL_MAX).
 *   (job 174) tableAppend with open: Tab in the last cell (the session opens the new row's left cell);
 *   tablePaste: a grid (model/table.js clipGrid) pasted into the cell editor of cell.
 *   react, reactPick, reactList, reactNames (job 172, every mode): a tap on a pill, the smiley-plus button
 *   and "+n" of a note's reaction row, a hold (hold true) or a resting mouse (hold false) on a pill (id null:
 *   the mouse left it); rect = the part's screen box, container px
 *   connect/retarget: round 1b. connect.selectEnd (job 169): a connector that hung from a text item's "+"
 *   ends bound to an item (end.item); the session selects that item, not the connector.
 *   move.nudge: arrow keys (one undo step per key series, the session merges).
 *   vote/voteMiss (stage 3, mode vote only): a click or tap on an item for which
 *   SceneVoteState.votable(id) holds, resp. a hit on an item that is not votable (the shell explains why);
 *   a click into empty space gives neither. (R16) vote.rect = itemScreenRect(id) at the time of the click
 *   or tap: container px, confirmed camera, axis-aligned (the shell anchors its vote stepper there).
 *   A touch/pen tap on a votable item whose itemScreenRect has min(w, h) < 44 px zooms instead (onUserCamera,
 *   no vote) as long as the zoom can still enlarge it; a mouse click always votes; an item that is not
 *   votable always gives voteMiss, never a zoom.
 *   contextMenu (stage 4, step 4.2; SPEC-M1 §9.5 WP-S4): mode edit only; open a context menu. id = the item
 *   it is about (string) or null (empty canvas); at = [x, y] in container px (the space of vote.rect and
 *   itemScreenRect; confirmed camera, a running follow glide or wheel gesture ends first). From the canvas's
 *   contextmenu event (macOS Ctrl+click, pen press-and-hold): at = the event point; (job 156)
 *   from a right click of the mouse (job 168: or the pen's side button) at its pointerup: at = the release
 *   point (its contextmenu event opens nothing; beside an open text editor the editor ends first with its
 *   final commit); an item outside the selection is selected first (onSelection before onIntent), an item inside
 *   keeps the selection, a transformer handle keeps it too (id = the hit item when selected, else the last
 *   selected item), empty canvas clears it (id null). From the ContextMenu key or Shift+F10 with the canvas
 *   focus: id = the last selected item or null, at = the midpoint of the selection's screen box clamped into
 *   the container, the container centre without a selection. Never in modes vote and view, never for a
 *   finger (long press), never while a text editor is open or on an overlay control (no preventDefault:
 *   the browser's menu stays), never during a moved press (drag, transform, connect, marquee, create
 *   drag), a touch gesture, a mouse/pen pan or a finger below the tap threshold; an unmoved press (macOS
 *   Ctrl+click) is dropped first (no drag, no marquee, nothing created; the tool stays).
 * @typedef {{onIntent(i:Intent):void, onSelection(ids:string[]):void, onCamera(c:Camera):void,
 *            onUserCamera():void, onPointer(w:([number,number]|null)):void,
 *            onActivity(a:{kind:'drag'|'edit'|'gesture'|'transform'|'connect'|'press', active:boolean, ids:string[]}):void,
 *            onDragPreview(p:Array<[string,number,number]>):void,
 *            onEditing(id:(string|null), takeover:boolean):void, onTool(t:Tool):void,
 *            onGrid(on:boolean):void, onSelectionBox(b:(SelectionBox|null)):void, onTouchPan():void,
 *            onShortcuts():void, onCursors():void, onLaser(p:({x:number, y:number}|null)):void,
 *            onLockedOffer(ids:string[]):void, viewInsets():({top:number, right:number, bottom:number, left:number}|null)}} SceneCallbacks
 *   viewInsets (factory job 223) is asked, not told: the container px the bars cover at each edge, for
 *   Shift+1 and Shift+2 (Camera.js freePart); null or no callback: the whole container. It must not throw
 *   (BoardSession's catches what the view throws).
 *   onLockedOffer (factory job 190, the session reports the selection again): the scene's offer of locked
 *   items changed by the scene's own input (set by a plain marquee or Ctrl/⌘+A, ended by a press, a tap,
 *   Esc, leaving mode edit), with the offered ids ([] when it ended); never for setLockedOffer of this
 *   facade, and not when a change of the selection ends it (onSelection follows then).
 *   onLaser (factory job 171, the session sends the trail): a point of the own laser stroke in world units at
 *   its press, at every move and at least every LASER_BEAT_MS while it is held still; null when it ends
 *   (release, Esc, pointercancel, a second finger, a mouse or pen press over a finger's stroke, another
 *   tool, a mode switch, reset, destroy). Only in mode edit with the laser tool; never an intent.
 *   onGrid (M2, R12): the scene itself switched the background grid (the key G), with the new state; never
 *   for setGrid of this facade (as onTool for the tool keys).
 *   onSelectionBox (factory job 137, the shell places its context bar by it): {box, keep} in container px
 *   (confirmed camera, rounded to whole px) or null without a selection and while something moves (drag,
 *   transform, connect, a wheel/trackpad/pinch gesture until its end, a mouse/pen pan from onDirectStart to
 *   onDirectEnd, a followTo glide); meanwhile the scene computes nothing. box = the hull of the selected
 *   items (rotated boxes, connectors by their route box as in itemScreenRect, frames with their title band
 *   FRAME_TITLE_BAND above the top edge, (job 193) note pads with their sheets below the box, job 263); keep =
 *   box joined with a square of ±HANDLE_TOUCH_PX around every
 *   drawn handle (the list handles() gives). Only changes are reported, null → box included, at the latest
 *   in the frame after a movement ends; a change of the selection, the model, the camera or the container
 *   size reports the new box without a null before it. (job 190) Without a selection but with an offer of
 *   locked items it is the box of the offered items that still exist and are locked (keep = box).
 *   onTouchPan (factory job 142, the shell's one-time tip about "hold, then drag"): a finger on empty canvas
 *   started the one-finger pan (moved beyond TAP_SLOP_PX while pending); once per pan, only in mode edit with
 *   the select tool. Never for a tap, a hold that became a marquee, a finger on an item (drag), a pinch, the
 *   finger left after a pinch, a mouse/pen pan, the wheel; never with the hand tool or in modes vote and view.
 *   onShortcuts (factory job 145, the shell opens its shortcuts overview): the key ? with the canvas focus
 *   (InputController), in every mode, also view-only; never an intent, the selection and the tool stay.
 *   onSearch (factory job 271, the shell opens its board search): Ctrl/⌘+F outside text fields and dialogs,
 *   in every mode, with preventDefault; never an intent.
 *   onCursors (factory job 147, the session shows or hides other people's cursors): the key C with the canvas
 *   focus, the same way; the scene keeps no state of its own (the session filters the sampler).
 *   onActivity kind 'press' (stage 3; §6.3, §6.5.6: the session holds follow jumps
 *   back while it is active): modes vote and view only, any pointer type, ids always []. (R16) It describes
 *   the canvas, not a pointer: active true on the first pointerdown on the canvas while no other pointer is
 *   down, active false only when the last pointer down reports pointerup/pointercancel (a second finger
 *   neither starts a second press nor ends the first). A switch to mode edit ends an open press with
 *   active false. Not reported in mode edit (drag/gesture cover it there).
 * @typedef {{box:{x:number, y:number, w:number, h:number}, keep:{x:number, y:number, w:number, h:number}}} SelectionBox
 *   (factory job 137) onSelectionBox's value, container px
 */

/** Tool ids (SPEC-M1 §6.2 TOOLS, the table lives in src/model/tools.js). */
export const TOOLS = TOOL_IDS
/** onCamera at most every CAMERA_EMIT_MS. */
const CAMERA_EMIT_MS = 100
/** "Take over" stays on the chip this long after a blocked double click. */
export const TAKE_OVER_MS = 5000
/** openTextEditor for an item that is not in the model yet waits this long for it. */
const PENDING_OPEN_MS = 2000
/** Zoom step of the +/− keys. */
const KEY_ZOOM_STEP = 1.25
/** Screen margin of Shift+2 (zoom to the selection). */
const SELECTION_ZOOM_PAD_PX = 40
/** (job 143) revealTitle: the least distance of a title band (frame, job 193: note pad) to the container's left and bottom edges (px). */
export const TITLE_REVEAL_EDGE_PX = 8
const DEFAULT_LIMITS = Object.freeze({ maxText: 6000, maxTitle: 200, maxLabel: 200 })
/** (job 154) the stages of the mouse wheel without Ctrl/⌘ (GestureController option wheel); anything else is 'auto'. */
export const WHEEL_STAGES = Object.freeze(['auto', 'zoom', 'pan'])
const CALLBACKS = ['onIntent', 'onSelection', 'onCamera', 'onUserCamera', 'onPointer', 'onActivity', 'onDragPreview', 'onEditing', 'onTool', 'onGrid', 'onSelectionBox', 'onTouchPan', 'onShortcuts', 'onCursors', 'onLaser', 'onLockedOffer', 'onNodeFocus', 'viewInsets', 'onSearch']
/**
 * (job 171) A laser stroke held still reports its point again after this long (ms): at least one point every
 * 100 ms with frames of up to 20 ms (the receivers join points up to 300 ms apart).
 */
export const LASER_BEAT_MS = 80
/** Default tool options (§6.2 TOOLS options), validated against the registry enums; (job 153) connectors elbow; (job 261) ending with a filled triangle. */
const TOOL_OPTION_DEFAULTS = Object.freeze({
	// job 203: picture, the own shape the tool places ({uri, w, h}, only with kind image)
	shape: Object.freeze({ kind: 'rect', picture: null }), connector: Object.freeze({ route: 'elbow', endCap: 'triangle' }),
	// job 188: what the note tool creates
	sticky: Object.freeze({ type: 'sticky' }),
	// job 199: what the frame tool creates
	frame: Object.freeze({ frameKind: 'frame' }),
	// job 273: what the pen tool does (pen, highlighter, eraser) and the colour and width of each kind that draws
	pen: Object.freeze({
		penKind: 'pen', penColor: PEN_DEFAULTS.pen.stroke, penWidth: PEN_DEFAULTS.pen.strokeWidth,
		markerColor: PEN_DEFAULTS.marker.stroke, markerWidth: PEN_DEFAULTS.marker.strokeWidth,
	}),
})
const TOOL_OPTION_ENUMS = Object.freeze({
	kind: ENUMS.shapeKinds, route: ENUMS.routes, endCap: ENUMS.caps, type: NOTE_TOOL_TYPES, frameKind: FRAME_TOOL_KINDS,
	// job 273: the pen tool's options, each from its own list (model/ink.js)
	penKind: PEN_TOOL_KINDS, penColor: PEN_COLORS.pen, markerColor: PEN_COLORS.marker, penWidth: PEN_WIDTHS.pen, markerWidth: PEN_WIDTHS.marker,
})
/** Tools that create items (crosshair cursor; job 171: the laser has it too). */
const CREATE_TOOLS = new Set(['sticky', 'shape', 'text', 'table', 'connector', 'frame', 'mindmap'])
/** (job 173) Reach of a table's column border (screen px): mouse and pen, finger (job 258: kept here for its importers). */
export { TABLE_BORDER_PX, TABLE_BORDER_TOUCH_PX } from './StructureController.js'
/** Scene modes (SPEC-M1 §6.3 SceneMode). */
export const MODES = Object.freeze(['edit', 'vote', 'view'])
/** (job 172) A mouse that rests this long on a reaction pill shows the names. */
export const REACT_NAMES_MS = 300
/** (job 172) The fields of a pointerdown a handed-over press sends again. */
const POINTER_INIT = Object.freeze(['pointerId', 'pointerType', 'isPrimary', 'clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons',
	'pressure', 'width', 'height', 'tiltX', 'tiltY', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey'])
/** (job 162) The side of each "+" handle (plusPlan). */
const PLUS_SIDE_OF = Object.freeze({ 'plus-t': 't', 'plus-r': 'r', 'plus-b': 'b', 'plus-l': 'l' })

/**
 * (job 211) The box of the label editor of a symbol, BPMN event or gateway
 * in world units, turned with the shape around its centre: wrapW wide,
 * centred, SYMBOL_LABEL_GAP below the box, as high as the lines of value
 * (one at least).
 *
 * @param {object} it the shape
 * @param {{x: number, y: number, w: number, h: number, r: number}} a its absolute box
 * @param {string} value the editor's text
 * @return {{cx: number, cy: number, w: number, h: number, fs: number}} centre and size of the
 *   (unturned) box, its font size
 */
function labelEditorBox(it, a, value) {
	const k = fieldValue(it, 'data.kind')
	const fs = fieldValue(it, 'style.fontSize')
	const l = symbolLabelBox(k, value, fs, a.w, a.h) ?? symbolLabelBox(k, 'x', fs, a.w, a.h)
	const r = (a.r || 0) * Math.PI / 180
	const oy = l.y + l.h / 2 - a.h / 2
	return { cx: a.x + a.w / 2 - oy * Math.sin(r), cy: a.y + a.h / 2 + oy * Math.cos(r), w: l.wrapW, h: l.h, fs: l.fs }
}

/**
 * (job 193) The title band of an item in world units, where its title editor opens: a frame's
 * FRAME_TITLE_BAND above its box, a note pad's binding on top of it (model/pad.js padBand, job 263).
 *
 * @param {string|null} editor the type's editor (registry)
 * @param {{x: number, y: number, w: number, h: number}} a the item's absolute box
 * @return {{x: number, y: number, w: number, h: number}|null} null for a type without a title band
 */
function titleBandOf(editor, a) {
	if (editor === 'title') return { x: a.x, y: a.y - FRAME_TITLE_BAND, w: a.w, h: FRAME_TITLE_BAND }
	if (editor === 'padTitle') {
		const b = padBand(a.w, a.h)
		return { x: a.x + b.x, y: a.y + b.y, w: b.w, h: b.h }
	}
	return null
}

/**
 * Re-throws an error from a callback outside the scene's own stack, so the
 * scene state stays consistent and the error still surfaces.
 *
 * @param {unknown} err error
 */
function reportAsync(err) {
	if (typeof reportError === 'function') {
		reportError(err)
	} else {
		setTimeout(() => { throw err }, 0)
	}
}

/**
 * The short vibration of the hold signal (R38), only where the browser has
 * navigator.vibrate (not Safari). Its answer and any error are ignored:
 * Chrome refuses before the first user activation of the page, and a
 * switched-off vibration is the system's choice; the ring still shows.
 *
 * @param {number} ms duration
 */
function vibrate(ms) {
	const nav = globalThis.navigator
	if (typeof nav?.vibrate !== 'function') return
	try {
		nav.vibrate(ms)
	} catch {
		// refused or not allowed: the ring alone is the signal
	}
}

/** @param {number} v value @return {number} rounded to 0.01 */
const r2 = (v) => Math.round(v * 100) / 100

/**
 * @param {unknown} cam value
 * @return {boolean} a camera {x, y, scale} with finite numbers and scale > 0
 */
function isCamera(cam) {
	return cam !== null && typeof cam === 'object' && Number.isFinite(cam.x) && Number.isFinite(cam.y) &&
		Number.isFinite(cam.scale) && cam.scale > 0
}

/** followTo (§6.3 "Folgen" (3)): a target whose corner lies closer than this to the confirmed one (screen px) … */
const FOLLOW_SAME_PX = 0.5
/** … with a scale within this share of the confirmed scale is the same camera (nothing to draw). */
const FOLLOW_SAME_SCALE = 0.001

/**
 * @param {Camera} c0 confirmed camera
 * @param {Camera} c1 target camera (scale already clamped)
 * @return {boolean} c1 shows the same picture as c0 (§6.3 "Folgen" (3))
 */
function sameCamera(c0, c1) {
	return Math.hypot(c1.x - c0.x, c1.y - c0.y) * c0.scale < FOLLOW_SAME_PX &&
		Math.abs(c1.scale - c0.scale) <= c0.scale * FOLLOW_SAME_SCALE
}

/**
 * The camera of a follow glide at u ∈ [0, 1] from a to b (§6.3 "Folgen"):
 * the viewport centre moves linearly, the scale geometrically (no swing of
 * a corner while zooming); constant speed, so a glide that replaces the
 * previous one (the next presence card) continues smoothly.
 *
 * @param {Camera} a start camera
 * @param {Camera} b target camera
 * @param {number} u progress
 * @param {number} vw viewport width (px)
 * @param {number} vh viewport height (px)
 * @return {Camera}
 */
export function glideCamera(a, b, u, vw, vh) {
	if (u >= 1) return { x: b.x, y: b.y, scale: b.scale }
	if (u <= 0) return { x: a.x, y: a.y, scale: a.scale }
	const s = a.scale * Math.pow(b.scale / a.scale, u)
	const ax = a.x + vw / (2 * a.scale)
	const ay = a.y + vh / (2 * a.scale)
	const bx = b.x + vw / (2 * b.scale)
	const by = b.y + vh / (2 * b.scale)
	return { x: ax + (bx - ax) * u - vw / (2 * s), y: ay + (by - ay) * u - vh / (2 * s), scale: s }
}

/** stats().voteState counters while nothing is drawn. */
const VOTE_DRAWN_NONE = Object.freeze({ rings: 0, badges: 0, totals: 0, outline: null })
/** Mode vote: a touch/pen tap on a votable item smaller than this (min(w, h) of itemScreenRect, px) zooms instead of voting. */
export const SMALL_TARGET_PX = 44
/** … the zoom gives the item's shorter side this size (px), … */
export const SMALL_TARGET_GOAL_PX = 88
/** … at most so far that the item fits with this margin (px), … */
const SMALL_TARGET_PAD_PX = 16
/** … and only when it enlarges the item by more than this share (else the tap votes: no endless zoom). */
const SMALL_TARGET_MIN_GAIN = 0.01
/** SceneVoteState.color: #rrggbb (hex digits in either case, as contrastTextOn reads them). */
const VOTE_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** @param {unknown} v value @return {boolean} an integer >= 0 (a vote count) */
const isCount = (v) => Number.isInteger(v) && v >= 0

/**
 * Checks a SceneVoteState against its typedef and value rules (SPEC-M1 §6.3,
 * R16) and returns a frozen copy: votable kept as given, badges copied entry
 * by entry. Keys beyond the typedef are ignored. Values: votable a function,
 * scope a string or null, badges a Map from item ids (strings) to {mine: an
 * integer >= 0, total: an integer >= 0 or null (never undefined)},
 * markVotable a boolean, color #rrggbb, live (job 149) missing (= false) or
 * a boolean.
 *
 * @param {unknown} state value handed to setVoteState (not null)
 * @return {Readonly<SceneVoteState>} copy
 * @throws {TypeError} when state deviates from SceneVoteState
 */
function checkVoteState(state) {
	const bad = (what) => new TypeError(`setVoteState: ${what} (SceneVoteState, SPEC-M1 §6.3)`)
	if (state === null || typeof state !== 'object' || Array.isArray(state)) throw bad('state must be an object or null')
	const { votable, scope, badges, markVotable, color, live = false } = state
	if (typeof votable !== 'function') throw bad('votable must be a function (id) => boolean')
	if (scope !== null && typeof scope !== 'string') throw bad('scope must be a frame id (string) or null')
	if (!(badges instanceof Map)) throw bad('badges must be a Map')
	if (typeof markVotable !== 'boolean') throw bad('markVotable must be a boolean')
	if (typeof color !== 'string' || !VOTE_COLOR_RE.test(color)) throw bad('color must be #rrggbb')
	if (typeof live !== 'boolean') throw bad('live must be a boolean or missing')
	const copy = new Map()
	for (const [id, b] of badges) {
		if (typeof id !== 'string') throw bad('badge keys must be item ids (strings)')
		if (b === null || typeof b !== 'object') throw bad(`the badge of ${id} must be {mine, total}`)
		if (!isCount(b.mine)) throw bad(`the badge of ${id}: mine must be an integer >= 0`)
		if (b.total !== null && !isCount(b.total)) throw bad(`the badge of ${id}: total must be an integer >= 0 or null`)
		copy.set(id, Object.freeze({ mine: b.mine, total: b.total }))
	}
	return Object.freeze({ votable, scope, badges: copy, markVotable, color, live })
}

/** Smallest width of the label editor (world units): about six average glyphs (4 em) and the padding. */
const LABEL_EDITOR_MIN_W = 4 * CONNECTOR_LABEL_FONT_SIZE + 2 * CONNECTOR_LABEL_PAD_X
/** Hit tolerance of the connect tool (screen px; touch and pen: the wider one). */
const CONNECT_TOL_PX = 4
const CONNECT_TOL_TOUCH_PX = 12

/**
 * @param {object} model SceneModel
 * @param {string} id item id
 * @return {boolean} a routed item (connector)
 */
function isRouted(model, id) {
	return typeInfo(model.get(id)?.t).hit === 'line'
}

/**
 * The items a drag or nudge moves (SPEC-M1 §6.5.2 moveItems v2): the
 * top-level boxes, plus the selected connectors whose bound ends all lie
 * on moved items (descendants included); a connector bound to anything
 * outside stays (only its end handles move it).
 *
 * @param {object} model SceneModel
 * @param {string[]} top top-level selection
 * @return {{top:string[], all:Set<string>}} moved ids and every id that moves (descendants, the connectors among top)
 */
function movedItems(model, top) {
	const boxes = top.filter((id) => !isRouted(model, id))
	const all = new Set(boxes)
	for (const id of boxes) {
		for (const d of model.descendantsOf(id)) all.add(d)
	}
	const conns = top.filter((id) => isRouted(model, id)).filter((id) => {
		const it = model.get(id)
		return ['start', 'end'].every((w) => {
			const item = fieldValue(it, 'data.' + w)?.item
			return typeof item !== 'string' || all.has(item)
		})
	})
	for (const c of conns) all.add(c)
	return { top: [...boxes, ...conns], all }
}

/**
 * Snap candidates of a drag (M2, R12): the axis-aligned, unpadded boxes of
 * the items in a world rectangle, without the dragged ids and without any
 * connector.
 *
 * @param {object} model SceneModel
 * @param {{minX:number, minY:number, maxX:number, maxY:number}} r world rectangle (the view at the start)
 * @param {Set<string>} exclude dragged items, their descendants and attached connectors
 * @return {import('../model/snap.js').SnapIndex}
 */
function snapIndexOf(model, r, exclude) {
	const boxes = []
	for (const e of model.query(r.minX, r.minY, r.maxX, r.maxY)) {
		if (exclude.has(e.id) || isRouted(model, e.id)) continue
		const b = model.boundsOf([e.id])
		if (b) boxes.push({ minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h })
	}
	return buildSnapIndex(boxes)
}

/**
 * @param {Array<{axis:string, at:number, from:number, to:number}>} a guides (or gap markers)
 * @param {Array<{axis:string, at:number, from:number, to:number}>} b guides (or gap markers)
 * @return {boolean} the same guides in the same order
 */
function sameGuides(a, b) {
	return a.length === b.length &&
		a.every((g, i) => g.axis === b[i].axis && g.at === b[i].at && g.from === b[i].from && g.to === b[i].to)
}

/**
 * Tab order key of an item (SPEC-M1 §6.3): frames first, then content; per
 * group by y, then x of the box centre on a 10-unit grid, then stacking order.
 *
 * @param {object} model SceneModel
 * @param {string} id item id
 * @return {[number, number, number]} [group, row, column]
 */
function tabKey(model, id) {
	// connectors with their route box; one that has no route yet goes last
	const b = model.boundsOf([id])
	if (!b) return [1, Infinity, Infinity]
	const cx = b.x + b.w / 2
	const cy = b.y + b.h / 2
	return [typeInfo(model.get(id).t).container ? 0 : 1, Math.round(cy / 10), Math.round(cx / 10)]
}

export class SceneManager {
	#container
	#model
	#cb
	/** @type {SceneMode} */
	#mode = 'edit'
	/** mode !== 'edit' (vote is view-only until stage 3) */
	#viewOnly
	/** (job 189) "New comment" waits for its click or tap: the input works as in mode view, a tap picks */
	#pick = false
	/** (job 189) the touchend of a finger's or pen's pick tap is cancelled (no ghost mousedown on the new field) */
	#pickTouchEnd = false
	#limits
	/** (job 198) the placeholder of the editor of an org chart card (translated by the session), or null */
	#cardPlaceholder = null
	#renderer
	#camera = new Camera()
	#selection = new Selection()
	#tool = 'select'
	#toolOptions = {
		shape: { ...TOOL_OPTION_DEFAULTS.shape }, connector: { ...TOOL_OPTION_DEFAULTS.connector }, sticky: { ...TOOL_OPTION_DEFAULTS.sticky },
		frame: { ...TOOL_OPTION_DEFAULTS.frame }, pen: { ...TOOL_OPTION_DEFAULTS.pen },
	}
	#space = false
	#mounted = false
	#destroyed = false
	#raf = 0
	/** (job 203) ends the subscription to decoded pictures (scene/imageCache.js) */
	#offPictures = null
	#size = { w: 0, h: 0 }
	#resizePending = false
	#resizeObserver = null
	#overlay = null
	#cursors = null
	#editor = null
	#gestures = null
	#input = null
	#pendingCam = false
	#live = null
	#liveDirty = false
	#lastCameraMs = 0
	#camLast = -Infinity
	#camPending = null
	#drag = null
	#xf = null
	#xfTarget = null
	/**
	 * snapping of a running transform (R12): {index (null at 'rot'), guides shown, gaps (always []), (job 194)
	 * measures and labels shown}, else null
	 */
	#xfSnap = null
	#sampler = null
	#samplesActive = false
	#presenceDirty = false
	#lastSamples = []
	#remoteSel = []
	#takeOver = null
	#pendingOpen = null
	#handlesDirty = false
	/** handles shown now: {list:[{name,x,y}] world, frame, scale} or null */
	#handleState = null
	#hoverHandle = null
	/** (job 231) the container point of the last hover of the mouse or a pen, null during a press and off the canvas */
	#hoverSp = null
	/** (job 231) the look of a pen or a finger (every handle shows, touch size), else the mouse's */
	#touchLook = false
	/** (job 265) the colour of the own selection (selectionColorOf), also the frame of a table cell's editor */
	#selColor = SELECTION_COLOR
	/** (job 231) the names of #handleState.list drawn now, with the look they were drawn for */
	#shown = { names: new Set(), touch: false }
	/** (job 162) pointerType of the hover that reported #hoverHandle, null after a pointerdown or leave */
	#hoverType = null
	/** (job 162) the "+" preview shown: {kind:'connect', id, box} or {kind:'neighbour', box} (absolute boxes), else null */
	#plusPreview = null
	/** a user gesture/pan reported onUserCamera already */
	#userCamSent = false
	/** measured text height of the open text editor: [value, h] */
	#editorMeasure = null
	/** connect / retarget drag ([S]-internal) */
	#cc = null
	/** pending pointer step of the connect drag: {w, mods} */
	#ccTarget = null
	/** (job 159) the "+" handle (plus-t/r/b/l) the new connector hangs from without a press, else null */
	#ccHang = null
	/** the handles were placed for LOD 2 (#syncHandles) */
	#handleCoarse = false
	/** connectors attached to the transformed items (isActive, activeGroup) */
	#xfLinks = new Set()
	/** top-level ids of the remote drag previews shown now */
	#previewIds = new Set()
	/** voting state (setVoteState): a frozen, checked copy, or null @type {Readonly<SceneVoteState>|null} */
	#vote = null
	/** votable(id) === true per item id for the badge painting; cleared with every vote state and model change */
	#votableCache = new Map()
	/** an error of votable() was reported for the current vote state */
	#votableErr = false
	/** follow glide (followTo): {from, to, t0, ms, resolve} or null; #live is its camera meanwhile */
	#glide = null
	/** 'press' (modes vote/view): pointers down on the canvas, and whether press is reported active */
	#press = { ids: new Set(), active: false }
	/** listeners of the scene itself: [target, type, fn] */
	#own = []
	/** background grid shown, and drags and resizes snap to it while #gridSnap (M2, R12) */
	#grid = false
	/** (job 271) the item of the board search frame (setSearchHit), or null */
	#searchHit = null
	/** drags and resizes snap to the shown grid (M2, R12; off: the grid is only shown) */
	#gridSnap = true
	/** (job 154) what the mouse wheel does without Ctrl/⌘: one of WHEEL_STAGES */
	#wheel = 'auto'
	/** hold signal of the touch marquee (R38): {el, x, y} (the ring in the overlay, its centre in container px) or null */
	#holdRing = null
	/** the selection box reported last (onSelectionBox, factory job 137): {box, keep} or null */
	#selBox = null
	/** (job 190) the offer of locked items (a plain marquee, Ctrl/⌘+A, setLockedOffer): their ids, or null */
	#lockedOffer = null
	/** (job 143) the frame whose "Add title…" hint the renderer draws (renderer.setTitleHint), or null */
	#titleHint = null
	/** (job 194) the size label of a running resize the renderer draws (renderer.setSizeLabel): {text, x, y} or null */
	#sizeLabel = null
	/** (job 172) the session's part of the reaction rule (setReactions) */
	#reactCfg = { canReact: false, me: null, touch: false }
	/** (job 172) the note under a mouse or hovering pen (its box or its band), else null */
	#reactHover = null
	/** (job 172) the ReactState the renderer got last, as a key (only changes are handed on) */
	#reactKey = ''
	/** (job 172) the press a row part took: {pid, type, x, y, init, hit, held, timer}, else null */
	#reactPress = null
	/** (job 279) a Ctrl/⌘ press of a mouse or pen that may open a link: {pid, x, y} */
	#linkPress = null
	/** (job 172) a pointerdown is being sent again (handed over): the scene lets it pass */
	#reactReplay = false
	/** (job 172) the pill a resting mouse is on ({key, timer, shown}), else null */
	#reactRest = null
	/** (job 172) the touchend of a finger the row took is cancelled (no ghost click) */
	#reactTouchEnd = false
	/** (job 172) the cursor is over a row part a click acts on */
	#reactCursor = false
	/** (job 191) the board's tags (setTags), id → {id, name, color} */
	#tags = new Map()
	/** (job 171) the laser trails in the overlay (LaserLayer, from mount() on) */
	#laser = null
	/** (job 273) the running pen stroke in the overlay (InkLayer, from mount() on) */
	#ink = null
	/**
	 * (job 273) the running pen stroke or eraser path: kind, its points (world, flat), the last kept point
	 * (container px), coarse (pen or finger), and the strokes the eraser touched
	 * @type {{kind:string, pts:number[], last:({x:number, y:number}|null), coarse:boolean, hit:Set<string>}|null}
	 */
	#inkPress = null
	/** (job 171) own laser colour until mount() (setLaserColor) */
	#laserColor = null
	/** (job 171) the running own laser stroke: {sp (container px of its last point), at (time it was reported)} or null */
	#laserPress = null
	/** (job 173) the pointer hovers a column border of the selected table */
	#hoverBorder = false
	/** (job 258) tables, lanes and their drags, the one local table preview (StructureController) */
	#structure
	/**
	 * (job 188) a note being taken off a pad: the pad, the world point of the press, the pile's corner then
	 * (x0, y0), size and fill of the note and its top-left corner now (x, y); null while none is
	 */
	#take = null
	/** (job 188) a mouse or pen hovers the pile of a pad (the cursor copy) */
	#hoverStack = false
	/** (job 195) the layouts of the stored mind maps (item object → layout) */
	#mmLayouts = new WeakMap()
	/** (job 195) the focused node {id, key, item (the object it was checked on)} of the one selected mind map, else null */
	#mmFocus = null
	/** (job 195) the node under a hovering mouse or pen {id, key}, else null */
	#mmHover = null
	/** (job 195) what the renderer shows on each mind map (id → its JSON), so it hears only changes */
	#mmUiSent = new Map()
	/** (job 195) a node being dragged: {id, key, w0 (the press, world), x0, y0, w, h (its box then), target}, else null */
	#nodeDrag = null

	/**
	 * @param {HTMLElement} container scene host element (empty, positioned, touch-action: none)
	 * @param {import('../model/SceneModel.js').SceneModel} model scene model
	 * @param {{mode?:SceneMode, viewOnly?:boolean, shadows?:boolean, grid?:boolean, gridSnap?:boolean, wheel?:string,
	 *          callbacks?:Partial<SceneCallbacks>, limits?:{maxText?:number, maxTitle?:number, maxLabel?:number}}} [opts]
	 *   options; mode decides (none = 'edit', an unknown one = 'view': as in M0, anything but
	 *   edit is view-only); viewOnly is the M0 alias and only ever restricts: viewOnly true
	 *   turns 'edit' into 'view' and keeps vote/view (BoardSession passes both, e.g. mode
	 *   'vote' with viewOnly true). vote is view-only until stage 3; grid (M2, R12): the background grid
	 *   is on from mount() on (only true turns it on); gridSnap (M2, R12): drags and resizes snap to the
	 *   shown grid (missing = on; any other value but true turns it off); wheel (job 154): what the mouse
	 *   wheel does without Ctrl/⌘, 'auto' (the default), 'zoom' or 'pan' (anything else is 'auto')
	 */
	constructor(container, model, {
		mode = undefined, viewOnly = undefined, shadows = true, grid = false, gridSnap = true, wheel = 'auto', callbacks = {}, limits = null,
		cardPlaceholder = null,
	} = {}) {
		this.#container = container
		this.#cardPlaceholder = typeof cardPlaceholder === 'string' ? cardPlaceholder : null
		this.#model = model
		// job 275: a covered note (private writing) is never selected (click, marquee, Ctrl/⌘+A, Tab)
		this.#selection.accept = (id) => !isCovered(model.get(id))
		const m = mode === undefined ? 'edit' : MODES.includes(mode) ? mode : 'view'
		this.#mode = viewOnly === true && m === 'edit' ? 'view' : m
		this.#viewOnly = this.#mode !== 'edit'
		this.#grid = grid === true
		this.#gridSnap = gridSnap === true
		this.setWheel(wheel)
		this.#cb = {}
		for (const name of CALLBACKS) {
			this.#cb[name] = typeof callbacks?.[name] === 'function' ? callbacks[name] : null
		}
		const lim = (k) => (Number.isInteger(limits?.[k]) && limits[k] > 0 ? limits[k] : DEFAULT_LIMITS[k])
		this.#limits = { maxText: lim('maxText'), maxTitle: lim('maxTitle'), maxLabel: lim('maxLabel') }
		this.#renderer = new KonvaRenderer(container, model, { shadows, mode: this.#mode })
		this.#xf = new TransformController(model)
		this.#cc = new ConnectController(model)
		const scene = this
		this.#structure = new StructureController({
			get model() { return scene.#model },
			get renderer() { return scene.#renderer },
			get camera() { return scene.#camera },
			get selection() { return scene.#selection },
			get tool() { return scene.#tool },
			get viewOnly() { return scene.#viewOnly },
			canGrabBorder: () => !(!this.#mounted || this.#viewOnly || this.#tool !== 'select' || this.#editor.id !== null || this.#ccHang !== null ||
				this.#drag !== null || this.#xf.active || this.#cc.active || this.#live !== null || this.#coarseNow()),
			cursor: () => this.#applyCursorStyle(),
			wake: () => this.#wake(),
			call: (name, arg) => this.#call(name, arg),
			presence: () => this.#renderPresence(performance.now()),
			dirtyHandles: () => {
				this.#handlesDirty = true
			},
			measureCell: (text, w, bold) => this.measureTableCell(text, w, bold),
		})
	}

	/** Stage, layers, overlay, ResizeObserver, input. Builds no node yet. */
	mount() {
		if (this.#mounted || this.#destroyed) return
		this.#mounted = true
		// job 203: a picture of an own shape finished loading: draw again
		this.#offPictures = onImageReady(() => {
			this.#renderer?.picturesChanged?.()
			this.#wake()
		})
		const { w, h } = this.#measure()
		this.#size = { w, h }
		// single keys need a focusable canvas ([C] sets tabindex="0" on .knorke-canvas; keep it when present)
		if (typeof this.#container.hasAttribute === 'function' && !this.#container.hasAttribute('tabindex')) {
			this.#container.setAttribute('tabindex', '0')
		}
		this.#renderer.mount(w, h)
		if (this.#grid) this.#renderer.setGrid(true)
		if (this.#searchHit !== null) this.#renderer.setSearchHit(this.#searchHit)
		// (job 231) the own selection in the theme's primary color; the look of a pen or a finger on a coarse pointer
		let primary = ''
		try {
			primary = typeof getComputedStyle === 'function' ? getComputedStyle(this.#container).getPropertyValue('--color-primary-element') : ''
		} catch (e) {
			primary = ''
		}
		this.#selColor = selectionColorOf(primary)
		this.#renderer.setSelectionColor(this.#selColor)
		try {
			this.#touchLook = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches === true
		} catch (e) {
			this.#touchLook = false
		}
		// remote drag previews: attached connectors route over the preview boxes
		this.#model.setBoxResolver((id) => {
			const off = this.#renderer.previewOffset(id)
			if (!off) return null
			const a = this.#model.abs(id)
			return a ? { x: a.x + off.dx, y: a.y + off.dy, w: a.w, h: a.h, r: a.r } : null
		})
		// (job 195) the hit mode 'tree' takes the mind maps as drawn
		this.#model.setTreeLayout((id) => this.#mindmapLayoutOf(id))
		const overlay = document.createElement('div')
		overlay.className = 'knorke-scene-overlay'
		setStyles(overlay, {
			position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden',
			'pointer-events': 'none', 'z-index': '1', 'user-select': 'none', '-webkit-user-select': 'none',
		})
		this.#container.appendChild(overlay)
		this.#overlay = overlay
		// before the gesture and input controllers: a pointerdown ends a follow glide
		// first (the press then works on the camera shown) and starts 'press'
		this.#listen(this.#container, 'pointerdown', this.#onCanvasDown)
		// (job 172) before the gesture and input controllers: a press on a reaction row is the scene's
		this.#listen(this.#container, 'pointerdown', this.#onReactDown)
		// (job 279) Ctrl/⌘ + click on a link opens it; the press itself goes on as usual
		this.#listen(this.#container, 'pointerdown', this.#onLinkDown)
		this.#listen(this.#container, 'pointerup', this.#onLinkUp)
		this.#listen(this.#container, 'pointermove', this.#onReactMove)
		this.#listen(this.#container, 'pointerup', this.#onReactUp)
		this.#listen(this.#container, 'pointercancel', this.#onReactUp)
		this.#listen(this.#container, 'pointerleave', this.#onReactLeave)
		this.#listen(this.#container, 'dblclick', this.#onReactDblClick)
		this.#listen(this.#container, 'contextmenu', this.#onReactMenu)
		this.#listen(this.#container, 'touchend', this.#onReactTouchEnd)
		// (job 189) the pick tap's touchend; a new touch forgets a flag whose touchend never came
		this.#listen(this.#container, 'touchend', this.#onPickTouchEnd)
		this.#listen(this.#container, 'touchstart', this.#onPickTouchStart)
		// (job 171) before the cursors: the trails lie under them (z-index 2 against 3)
		this.#laser = new LaserLayer(overlay)
		this.#ink = new InkLayer(overlay)
		if (this.#laserColor !== null) this.#laser.setColor(this.#laserColor)
		this.#cursors = new CursorLayer(overlay, { onTakeOver: (id, cell) => this.#takeOverClicked(id, cell) })
		this.#editor = new TextEditor(overlay, {
			onIntent: (i) => this.#editorIntent(i),
			onClose: (id, info) => this.#editorClosed(id, info),
			onInput: () => this.#wake(),
			// (job 174) the arrow keys of a cell editor: the cell beside it, null at the table's edge
			neighbour: (id, cell, dir) => {
				const it = this.#model.get(id)
				return it?.t === 'table' ? neighbourCell(it, cell, dir) : null
			},
		})
		this.#gestures = new GestureController(this.#container, {
			getCamera: () => this.#camera.get(),
			viewOnly: () => this.#viewOnly || this.#pick,
			claimTouch: (e) => this.#input.claimTouch(e),
			cancelClaim: () => this.#input.cancelTouch(),
			// (job 156) every right press in every mode (job 168: the pen's side button too)
			wantsPan: (e) => e.button === 1 || isRightPress(e) ||
				(e.button === 0 && (this.#viewOnly || this.#pick || this.#space || this.#tool === 'hand')),
			ignoreTarget: (e) => this.#isInteractive(e.target),
			onDirect: (cam) => {
				this.#userCameraOnce()
				this.#setCam(cam)
			},
			onDirectStart: () => {
				this.#userCamSent = false
				this.#call('onActivity', { kind: 'gesture', active: true, ids: [] })
			},
			onDirectEnd: () => {
				this.#emitCamera(this.#camera.get(), true)
				this.#call('onActivity', { kind: 'gesture', active: false, ids: [] })
				// the selection box comes back in the next frame (onSelectionBox)
				this.#wake()
			},
			onGestureStart: (c0) => this.#gestureStart(c0),
			onGestureFrame: (c1) => {
				this.#userCameraOnce()
				this.#live = { ...c1 }
				this.#liveDirty = true
				this.#emitCamera(c1)
				this.#wake()
			},
			onGestureEnd: (c1) => this.#gestureEnd(c1),
			// stage 3: taps and clicks of mode vote (job 151: a finger's tap in mode edit), the late start of
			// mouse/pen pans there, glides end first; (job 156) a right click goes to the menu (mode edit only,
			// InputController.rightClick), never to #tap: no vote, voteMiss or small-target zoom
			onTap: (e, button) => (button === 2 ? this.#input.rightClick(e) : this.#tap(e)),
			// (job 156) and every right press in every mode (job 168: the pen's beyond TAP_SLOP_PX)
			deferPan: (e) => (isRightPress(e) || ((this.#mode === 'vote' || this.#pick) && e.button === 0) ? (e.pointerType === 'pen' ? TAP_SLOP_PX : DRAG_THRESHOLD_PX) : 0),
			beforeStart: () => this.#abortGlide(),
			// (R38) a first finger held still on empty canvas: the input controller may take it for a marquee
			longPress: (id, p) => this.#input.claimLongPress(id, p),
			// (job 163) a first finger that moves before its hold ran out: it may drag the selection from its frame
			claimDrag: (id, p) => this.#input.claimDrag(id, p),
			// (job 142) the pan of a finger where holding it still would have drawn a selection frame
			onTouchPan: () => {
				// (job 159) not while a connector hangs: holding the finger draws no frame then
				if (this.#mode === 'edit' && this.#tool === 'select' && this.#ccHang === null) this.#call('onTouchPan')
			},
			// (job 154) the mouse wheel without Ctrl/⌘, in every mode
			wheel: () => this.#wheel,
			now: () => performance.now(),
		})
		this.#input = new InputController(this.#container, this.#host())
		// after them (window, bubbling): a tap or click is handled before 'press' ends
		this.#listen(window, 'pointerup', this.#onPressUp)
		this.#listen(window, 'pointercancel', this.#onPressUp)
		if (this.#vote !== null) this.#pushVoteBadges()
		this.#camera.set(-w / 2, -h / 2, 1)
		this.#pendingCam = true
		if (typeof ResizeObserver !== 'undefined') {
			this.#resizeObserver = new ResizeObserver(() => {
				this.#resizePending = true
				this.#wake()
			})
			this.#resizeObserver.observe(this.#container)
		}
		this.#applyCursorStyle()
		this.#wake()
	}

	destroy() {
		if (this.#destroyed) return
		if (this.#mounted && this.#editor?.id !== null) {
			// typed text is never lost silently: commit (or discard a noticed editor)
			if (this.#editor.notice !== null) this.#editor.discard()
			else this.#editor.finish()
		}
		this.#destroyed = true
		this.#offPictures?.()
		this.#offPictures = null
		if (this.#raf) cancelAnimationFrame(this.#raf)
		this.#raf = 0
		const glide = this.#glide
		this.#glide = null
		this.#live = null
		glide?.resolve(false)
		for (const [target, type, fn] of this.#own) target.removeEventListener(type, fn)
		this.#own = []
		this.#press = { ids: new Set(), active: false }
		this.#reactDrop()
		this.#input?.destroy()
		this.#gestures?.destroy()
		this.#holdSignal(null)
		this.#resizeObserver?.disconnect()
		this.#cursors?.destroy()
		this.#laser?.destroy()
		this.#ink?.destroy()
		this.#inkPress = null
		this.#overlay?.remove()
		if (this.#mounted) this.#renderer.destroy()
		this.#drag = null
		this.#xf.end()
		this.#sizeLabel = null
		this.#xfSnap = null
		this.#cc.end()
		this.#model.setBoxResolver(null)
		this.#model.setTreeLayout(null)
		this.#sampler = null
	}

	// ---------------------------------------------------------------- camera

	/** @return {Camera} confirmed camera (unchanged during a CSS gesture) */
	getCamera() {
		return this.#camera.get()
	}

	/**
	 * Factory job 139 (the name fields after "Sort by color" follow the view
	 * per frame): the camera the user sees now, like stats().liveCamera
	 * without the renderer's counts.
	 *
	 * @return {Camera} the gesture or glide camera while one runs, else the confirmed camera
	 */
	liveCamera() {
		return this.#live ? { ...this.#live } : this.#camera.get()
	}

	/**
	 * Sets the camera; applied in the next animation frame. Ends a running gesture first.
	 *
	 * @param {Camera} cam camera
	 */
	setCamera(cam) {
		if (!cam) return
		this.#endGestureNow()
		this.#setCam(cam)
	}

	/**
	 * @param {number} factor scale factor (> 1 zooms in)
	 * @param {Point|null} [anchor] container point that stays fixed (null = centre)
	 */
	zoomBy(factor, anchor = null) {
		this.#endGestureNow()
		const a = anchor ?? { x: this.#size.w / 2, y: this.#size.h / 2 }
		this.#setCam(this.#camera.zoomAt(a.x, a.y, factor))
	}

	/**
	 * Shows a world rectangle (default: everything). An empty board (null)
	 * gets the camera {x: -vw/2, y: -vh/2, scale: 1}. (Job 223) With insets:
	 * in the part the bars leave free (Camera.js freePart).
	 *
	 * @param {{x:number, y:number, w:number, h:number}|null} [rect] world rectangle
	 * @param {number} [padPx] screen padding
	 * @param {{top?:number, right?:number, bottom?:number, left?:number}|null} [insets] covered px per edge
	 */
	fit(rect = this.#model.allBounds(), padPx = 48, insets = null) {
		this.#endGestureNow()
		this.#setCam(this.#camera.fit(rect, this.#size.w, this.#size.h, padPx, insets))
	}

	/**
	 * Camera that shows rect centred with padPx on every side, WITHOUT the
	 * 100 % limit of fit() (SPEC-M1 §6.3; Shift+2, frame list). Does not set it.
	 * (Job 223) With insets: centred in the part the bars leave free
	 * (Camera.js freePart), padPx inside it. (Job 238) The scale stays at
	 * most maxScale (ZOOM_TO_MAX_SCALE, 400 %, by default; following and,
	 * job 242, "Zoom to selection" pass MAX_SCALE) and never above MAX_SCALE.
	 *
	 * @param {{x:number, y:number, w:number, h:number}} rect world rectangle
	 * @param {number} [padPx] screen padding
	 * @param {{top?:number, right?:number, bottom?:number, left?:number}|null} [insets] covered px per edge
	 * @param {number} [maxScale] highest scale (not a finite number > 0: ZOOM_TO_MAX_SCALE)
	 * @return {Camera}
	 */
	cameraForRect(rect, padPx = 0, insets = null, maxScale = ZOOM_TO_MAX_SCALE) {
		const vw = this.#size.w
		const vh = this.#size.h
		if (!rect || !(vw > 0) || !(vh > 0)) return this.#camera.get()
		const f = freePart(vw, vh, padPx, insets)
		const aw = Math.max(1, f.w - 2 * padPx)
		const ah = Math.max(1, f.h - 2 * padPx)
		const sw = rect.w > 0 ? aw / rect.w : Infinity
		const sh = rect.h > 0 ? ah / rect.h : Infinity
		let scale = Math.min(sw, sh)
		if (!Number.isFinite(scale)) scale = this.#camera.get().scale
		const max = Number.isFinite(maxScale) && maxScale > 0 ? maxScale : ZOOM_TO_MAX_SCALE
		scale = clampScale(scale, MIN_SCALE, Math.min(max, MAX_SCALE))
		const cx = rect.x + rect.w / 2
		const cy = rect.y + rect.h / 2
		return { x: cx - (f.x + f.w / 2) / scale, y: cy - (f.y + f.h / 2) / scale, scale }
	}

	/**
	 * The world rectangle the CONFIRMED camera shows (SPEC-M1 §6.3; the
	 * session derives the presence v from it, §6.4): origin = camera x/y,
	 * size = container size / scale, with the container size the scene
	 * measured last (at mount and after a resize). It stays at the confirmed
	 * camera during a CSS gesture, like getCamera(). Before mount w and h are 0.
	 *
	 * @return {{x:number, y:number, w:number, h:number}} world units, unrounded ([C] rounds v with q(…, 10))
	 */
	getViewport() {
		const c = this.#camera.get()
		return { x: c.x, y: c.y, w: this.#size.w / c.scale, h: this.#size.h / c.scale }
	}

	/**
	 * Follow step (SPEC-M1 §6.3 "Folgen" (1)–(7), §6.5.6): brings the camera
	 * to cam without onActivity({kind:'gesture'}) and without onUserCamera.
	 * Never rejects. The promise says whether the camera is at cam now; false
	 * never ends following ([C] keeps following and tries again with the next
	 * presence card).
	 *
	 * The glide runs over the CSS path of a gesture (renderer.beginGesture →
	 * gestureFrame(c) per animation frame → endGesture(c1)): Konva stays
	 * untouched, one synchronous draw at the end (an intermediate draw only
	 * where the renderer's gesture rule asks for one: k ∉ [0.5, 2] or a
	 * translation beyond half the viewport). Meanwhile getCamera() and
	 * getViewport() stay at the confirmed camera, stats().liveCamera is the
	 * glide camera and stats().gliding is true. The viewport centre moves
	 * linearly, the scale geometrically (glideCamera); at the end the
	 * confirmed camera is exactly cam (scale clamped).
	 *
	 * (1) ms is taken as given (the FollowController [C] clamps it to the
	 *     observed interval of the presence cards, 300–2000 ms): ms <= 0, a
	 *     non-finite ms and prefers-reduced-motion (the scene checks it at
	 *     every call) jump, true.
	 * (2) A followTo during a glide replaces it: the old promise resolves
	 *     false; the new glide starts at the camera shown now, without an
	 *     intermediate draw (the CSS path stays open). A jump (1) replacing a
	 *     glide ends the CSS path at cam with one draw.
	 * (3) cam equal to the confirmed camera (Euclidean corner distance ×
	 *     confirmed scale < 0.5 px, |Δscale| <= 0.1 % of the confirmed scale,
	 *     after clamping) while no glide runs: nothing is drawn, no onCamera,
	 *     the camera stays, true.
	 * (4) a user camera gesture runs or may start (wheel or touch on the CSS
	 *     path, a finger down below TAP_SLOP_PX, a mouse/pen pan from its
	 *     pointerdown on, also a deferred one of mode vote): nothing happens,
	 *     false; the user's camera wins, nothing jumps under the finger. A
	 *     drag, transform or press on an item does not block it (in mode edit
	 *     the session ends following on those, §6.5.6).
	 * (5) A pointerdown on the canvas, the start of a wheel gesture,
	 *     stopFollow(), setCamera, fit and zoomBy abort a glide: the camera
	 *     shown becomes the confirmed one (one draw, like endGesture, onCamera
	 *     as at a gesture end), the promise resolves false, no onUserCamera;
	 *     the triggering event or facade call then works as usual (on that
	 *     camera). So do the camera keys (+/−, Shift+1/0/2, Tab).
	 * (6) cam not {x, y, scale} with finite numbers and scale > 0, before
	 *     mount and after destroy: nothing happens, false (destroy resolves
	 *     a running glide false). The scale is clamped to MIN_SCALE..MAX_SCALE
	 *     exactly as setCamera clamps it.
	 * (7) onCamera reports as for a gesture: the glide camera at most 10 ×
	 *     per second, the confirmed camera once at the end.
	 *
	 * @param {Camera} cam target camera, e.g. cameraForRect(viewRect, 0)
	 * @param {number} ms glide duration in ms (see (1))
	 * @return {Promise<boolean>} true when the camera is at cam (jumped, glided, or already there); false
	 *   when nothing happened ((4), (6)) or the glide was aborted or replaced ((2), (5))
	 */
	followTo(cam, ms) {
		if (!this.#mounted || this.#destroyed || !isCamera(cam) || this.#userCameraBusy()) {
			return Promise.resolve(false)
		}
		const target = { x: cam.x, y: cam.y, scale: clampScale(cam.scale, MIN_SCALE, MAX_SCALE) }
		const running = this.#glide
		if (running === null && sameCamera(this.#camera.get(), target)) return Promise.resolve(true)
		if (!(typeof ms === 'number' && Number.isFinite(ms) && ms > 0) || this.#reducedMotion()) {
			// (1) a jump; (2) it replaces a running glide: the CSS path ends at the target
			if (running !== null) this.#finishGlide(target, false)
			else this.#setCam(target)
			return Promise.resolve(true)
		}
		return new Promise((resolve) => {
			const now = performance.now()
			if (running !== null) {
				// (2) the new glide starts at the camera shown now; the CSS path stays open
				running.resolve(false)
				this.#glide = { from: { ...this.#live }, to: target, t0: now, ms, resolve }
			} else {
				this.#beginGlide(target, ms, now, resolve)
			}
			this.#wake()
		})
	}

	/**
	 * Ends a running followTo glide (SPEC-M1 §6.3 "Folgen" (5), (7)): the
	 * camera it shows now becomes the confirmed camera (one draw, like a
	 * gesture end, onCamera as at a gesture end), its promise resolves false,
	 * no onUserCamera. Without a glide, before mount and after destroy it does
	 * nothing (no draw, no callback).
	 */
	stopFollow() {
		if (!this.#mounted || this.#destroyed) return
		this.#abortGlide()
	}

	/**
	 * (Job 279) B, I, S and the list button: the open text editor formats its
	 * selection (TextEditor.format); false without an open editor of a kind
	 * with Markdown.
	 *
	 * @param {'bold'|'italic'|'strike'|'list'} what the button
	 * @return {boolean} the text changed
	 */
	formatText(what) {
		if (!this.#mounted || this.#destroyed || !this.#editor?.element) return false
		return this.#editor.format(what)
	}

	/**
	 * (Job 279) The link under a world point in the drawn text of an item
	 * (renderer.linkAt), for tests and the E2E hook.
	 *
	 * @param {string} id item
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @return {string|null}
	 */
	linkAt(id, wx, wy) {
		if (!this.#mounted || this.#destroyed) return null
		return this.#renderer.linkAt?.(id, wx, wy) ?? null
	}

	/**
	 * (Job 279) The drawn text of an item (renderer.drawnText), the test hook.
	 *
	 * @param {string} id item
	 * @return {object|null}
	 */
	drawnText(id) {
		if (!this.#mounted || this.#destroyed) return null
		return this.#renderer.drawnText?.(id) ?? null
	}

	/**
	 * @param {number} sx container x
	 * @param {number} sy container y
	 * @return {Point} world point (confirmed camera)
	 */
	screenToWorld(sx, sy) {
		return this.#camera.screenToWorld(sx, sy)
	}

	/**
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @return {Point} container point (confirmed camera)
	 */
	worldToScreen(wx, wy) {
		return this.#camera.worldToScreen(wx, wy)
	}

	/**
	 * @param {string} id item id
	 * @return {{x:number, y:number, w:number, h:number}|null} axis-aligned screen box in container
	 *   coordinates (a connector: its route box; null while it has no route)
	 */
	itemScreenRect(id) {
		const b = this.#model.boundsOf([id])
		if (!b) return null
		const c = this.#camera.get()
		return { x: (b.x - c.x) * c.scale, y: (b.y - c.y) * c.scale, w: b.w * c.scale, h: b.h * c.scale }
	}

	/**
	 * (job 136) Like Tab: an item whose box is not fully in view is centred,
	 * the zoom stays; a user camera change (onUserCamera). Nothing for an item
	 * in view, an unknown item, before mount and after destroy.
	 *
	 * @param {string} id item id
	 * @return {boolean} the camera moved
	 */
	panIntoView(id) {
		if (!this.#mounted || this.#destroyed || !this.#model.has(id)) return false
		return this.#panIntoView(id)
	}

	/**
	 * (job 143) Brings a frame's title band into view before its title editor
	 * opens (a new frame is centred on the click, so its band may lie above
	 * the view or under the top bar): the camera moves as little as needed,
	 * the zoom stays, so that the band's top lies at least `top` px below the
	 * container's top edge, its bottom TITLE_REVEAL_EDGE_PX inside the bottom
	 * edge (the top wins when both cannot hold), and its left edge, where the
	 * title starts, TITLE_REVEAL_EDGE_PX inside the left edge with the band in
	 * view from there over its whole width, at most half the view's width (a
	 * wide band only keeps its left part in view). A user camera change
	 * (onUserCamera), like panIntoView. Nothing for a band in place, an item
	 * without a title band, an unknown item, before mount and after destroy.
	 * (job 193) A note pad's band too, below its box (titleBandOf): a new pad
	 * is centred on the click, so its band may lie below the view; and the
	 * band's bottom stays `bottom` px more above the bottom edge, clear of
	 * the zoom controls and the other bars there.
	 *
	 * @param {string} id frame or note pad id
	 * @param {number} [top] container px the board's top chrome covers, with room for the context bar
	 *   (the view measures it, session ui.viewTop); not finite or below 0: 0
	 * @param {number} [bottom] (job 193) container px the bars at the bottom cover (session ui.viewBottom);
	 *   not finite or below 0: 0
	 * @return {boolean} the camera moved
	 */
	revealTitle(id, top = 0, bottom = 0) {
		if (!this.#mounted || this.#destroyed || !this.#model.has(id)) return false
		const a = this.#model.abs(id)
		const band = a ? titleBandOf(typeInfo(this.#model.get(id).t).editor, a) : null
		if (!band) return false
		this.#endGestureNow()
		const c = this.#camera.get()
		const s = c.scale
		const { w: W, h: H } = this.#size
		const E = TITLE_REVEAL_EDGE_PX
		const T = Number.isFinite(top) && top > 0 ? top : 0
		const B = E + (Number.isFinite(bottom) && bottom > 0 ? bottom : 0)
		// the band in container px
		const bx = (band.x - c.x) * s
		const by = (band.y - c.y) * s
		const bh = band.h * s
		// the part right of the left edge that must be in view
		const seen = Math.min(band.w * s, (W - 2 * E) / 2)
		let dx = 0
		if (bx < E) dx = E - bx
		else if (bx + seen > W - E) dx = W - E - (bx + seen)
		let dy = 0
		if (by < T) dy = T - by
		else if (by + bh > H - B) dy = Math.max(H - B - (by + bh), T - by)
		if (dx === 0 && dy === 0) return false
		this.#call('onUserCamera')
		this.#setCam({ x: c.x - dx / s, y: c.y - dy / s, scale: s })
		return true
	}

	// ---------------------------------------------------------------- model

	/**
	 * After model.apply: build, rebuild, place and re-cull only what changed.
	 *
	 * @param {import('../model/SceneModel.js').ChangeSummary} summary changes
	 */
	update(summary) {
		if (!this.#mounted || this.#destroyed || !summary) return
		if (this.#xf.active && summary.removed.some((id) => this.#xf.all.has(id))) {
			// a transformed item (or a descendant) is gone: drop the transform, no intent
			this.#abortTransform()
		}
		if (this.#cc.active && summary.removed.some((id) => id === this.#cc.id || id === this.#cc.startItem)) {
			// the re-targeted connector or the start item of a new one is gone: drop the drag, no intent
			this.#abortConnect()
		}
		if (this.#take !== null && summary.removed.includes(this.#take.id)) {
			// (job 188) the pad a note is being taken off is gone: no note
			this.#input.cancel()
		}
		if (this.#nodeDrag !== null && !this.#model.has(this.#nodeDrag.id)) {
			// (job 195) the mind map of a dragged node is gone: no move
			this.#input.cancel()
		}
		if (this.#structure.headDrag !== null && !hasLanes(this.#model.get(this.#structure.headDrag.id))) {
			// (job 208) the frame of a dragged head is gone (or has no lanes any more): no move
			this.#input.cancel()
		}
		// what is votable may change with any item (type, parent, removal)
		this.#votableCache.clear()
		// (job 172) a hovered or pressed note that is gone
		if (this.#reactHover !== null && !this.#model.has(this.#reactHover)) this.#reactHover = null
		if (this.#reactPress !== null && !this.#model.has(this.#reactPress.hit.id)) this.#reactDrop()
		this.#renderer.applySummary(summary)
		if (summary.removed.length > 0 && this.#selection.prune(this.#model)) {
			this.#selectionChanged(true)
		} else {
			this.#renderSelection()
		}
		if (this.#drag) {
			this.#drag.top = this.#drag.top.filter((id) => this.#model.has(id))
		}
		const p = this.#pendingOpen
		if (p && this.#model.has(p.id) && !this.#editor.closing) {
			this.#pendingOpen = null
			this.openTextEditor(p.id, { text: p.text, notice: p.notice, cell: p.cell ?? null })
		}
		this.#presenceDirty = this.#presenceDirty || this.#samplesActive
		this.#handlesDirty = true
		this.#wake()
	}

	/** After model.load (resync): all nodes go, everything is culled anew. A running drag or transform is dropped without intent. */
	reset() {
		if (!this.#mounted || this.#destroyed) return
		this.#abortDrag()
		this.#abortTransform()
		this.#abortConnect()
		this.#input.cancel()
		// (job 162) the "+" preview goes; the next hover plans anew
		this.#input.dropHover()
		// (job 172) so does a press or hover of a reaction row
		this.#reactDrop()
		this.#reactHover = null
		this.#votableCache.clear()
		this.#renderer.reset()
		if (this.#selection.prune(this.#model)) {
			this.#selectionChanged(true)
		} else {
			this.#renderSelection()
		}
		this.#presenceDirty = true
		this.#pendingCam = true
		this.#handlesDirty = true
		this.#wake()
	}

	// ---------------------------------------------------------------- tools, selection, mode

	/**
	 * Tool chosen in the shell, optionally with its options (§6.2 TOOLS:
	 * shape {kind}, connector {route, endCap}); unknown option values are
	 * ignored, missing ones keep their value. No onTool echo. (job 159)
	 * Another tool drops a connector that hangs from a "+", without one;
	 * (job 171) and ends a running laser stroke (onLaser(null)). (job 188)
	 * Another tool puts the note tool's type back to 'sticky' first; the
	 * options given apply after that.
	 *
	 * @param {Tool} tool tool id
	 * @param {ToolOptions|null} [options] options of that tool
	 */
	setTool(tool, options = null) {
		if (!TOOL_IDS.includes(tool)) return
		if (tool !== this.#tool) this.#noteBack()
		if (options && typeof options === 'object' && this.#toolOptions[tool]) {
			for (const [k, v] of Object.entries(options)) {
				if (Object.prototype.hasOwnProperty.call(this.#toolOptions[tool], k) && TOOL_OPTION_ENUMS[k]?.includes(v)) {
					this.#toolOptions[tool][k] = v
				}
			}
			// (job 203) the kind image only with its picture; any other kind drops the picture
			if (tool === 'shape') {
				const o = this.#toolOptions.shape
				if (Object.prototype.hasOwnProperty.call(options, 'picture')) o.picture = placeablePicture(options.picture)
				if (o.kind !== 'image') o.picture = null
				else if (o.picture === null) o.kind = TOOL_OPTION_DEFAULTS.shape.kind
			}
		}
		if (tool !== this.#tool) {
			// (job 159) another tool drops a hanging connector (InputController); (job 171) a laser stroke ends
			if (this.#ccHang !== null || this.#laserPress !== null || this.#inkPress !== null) this.#input.cancel()
			this.#tool = tool
			this.#handlesDirty = true
			this.#applyCursorStyle()
			this.#wake()
		}
	}

	/**
	 * (job 188) Every change of the tool puts the note tool's type back to 'sticky' ("Note"); (job 199) the
	 * frame tool's frameKind back to 'frame'.
	 */
	#noteBack() {
		this.#toolOptions.sticky.type = TOOL_OPTION_DEFAULTS.sticky.type
		this.#toolOptions.frame.frameKind = TOOL_OPTION_DEFAULTS.frame.frameKind
	}

	/** @return {Tool} */
	getTool() {
		return this.#tool
	}

	/**
	 * @param {Tool} tool tool id
	 * @return {ToolOptions|null} a copy of the tool's options, null for tools without options
	 */
	getToolOptions(tool) {
		const o = typeof tool === 'string' && Object.prototype.hasOwnProperty.call(this.#toolOptions, tool) ? this.#toolOptions[tool] : null
		return o ? { ...o } : null
	}

	/** @return {string[]} selected ids */
	getSelection() {
		return this.#selection.values()
	}

	/**
	 * Selection set by the shell (no onSelection echo). Unknown ids are dropped.
	 * (job 190) A change ends the offer of locked items (no onLockedOffer).
	 *
	 * @param {string[]} ids item ids
	 */
	setSelection(ids) {
		const next = (Array.isArray(ids) ? ids : []).filter((id) => this.#model.has(id))
		if (!this.#selection.set(next)) return
		this.#lockedOffer = null
		if (this.#mounted) {
			this.#renderSelection()
			this.#handlesDirty = true
			this.#wake()
		}
	}

	/**
	 * (job 190) The offer of locked items: the ids the scene's last plain
	 * marquee or Ctrl/⌘+A skipped (InputController), or setLockedOffer's.
	 * They are kept as they were offered; the session counts those that
	 * still exist and are locked. Without a selection, onSelectionBox reports
	 * the box of these (existing, locked) items, so the context bar stands
	 * there with only "Select n locked items".
	 *
	 * @return {string[]} the offered ids ([] without an offer)
	 */
	getLockedOffer() {
		return this.#lockedOffer === null ? [] : [...this.#lockedOffer]
	}

	/**
	 * (job 190) Sets the offer of locked items (the session's "Select all"),
	 * only in mode edit; null or [] ends it. No onLockedOffer echo. A change
	 * of the selection, the next press, a tap, Esc and leaving mode edit end
	 * it.
	 *
	 * @param {string[]|null} ids item ids
	 * @return {boolean} the offer changed
	 */
	setLockedOffer(ids) {
		return this.#setOffer(ids, false)
	}

	/**
	 * Mode at runtime (SPEC-M1 §6.3, §6.5.4: role, device, voting session;
	 * gone/revoked/logged_out freeze into view). vote behaves like view until
	 * stage 3. Leaving edit:
	 * - without settle (Esc semantics: role lost, frozen): a drag, transform
	 *   or connect drag ends without an intent (model back); an open editor
	 *   stays open, the session decides about it (notice, text rescue)
	 * - (R13) with settle (a voting session starts while editing): first an
	 *   open editor ends with its final commit ({type:'text', …, final:true}),
	 *   then a drag, transform or connect drag ends like a release
	 *   (onDragPreview([]) → intent → onActivity({active:false})); the switch
	 *   comes after both
	 * The same mode again, or an unknown one, does nothing. (R16) A switch
	 * to edit ends an open press (onActivity({kind:'press', active:false,
	 * ids:[]})), after the switch.
	 *
	 * @param {SceneMode} mode new mode
	 * @param {{settle?:boolean}} [opts] settle: finish open work like a release (§6.3)
	 */
	setMode(mode, { settle = false } = {}) {
		if (!MODES.includes(mode) || mode === this.#mode) return
		if (this.#mode === 'edit' && this.#mounted && !this.#destroyed) {
			if (settle) {
				this.#settle()
			} else {
				this.#input.cancel()
			}
		}
		this.#mode = mode
		this.#viewOnly = mode !== 'edit'
		// (job 190) the offer of locked items lives only in mode edit
		this.#setOffer(null, true)
		// (job 172) a press on a reaction row ends without a tap
		this.#reactDrop()
		// (job 151) the lock symbols only in mode edit
		if (!this.#destroyed) this.#renderer.setMode(mode)
		this.#handlesDirty = true
		this.#applyCursorStyle()
		if (mode === 'edit' && this.#press.active) {
			this.#press.active = false
			this.#call('onActivity', { kind: 'press', active: false, ids: [] })
		}
		this.#wake()
	}

	/** @return {SceneMode} */
	getMode() {
		return this.#mode
	}

	/**
	 * Background grid on or off (M2, SPEC-M1 §1.2 (R12)), in every mode. Only
	 * true turns it on; the same state again does nothing. No onGrid echo. A
	 * running drag or resize snaps to the new state from its next step.
	 *
	 * @param {boolean} on grid shown (drags and resizes snap to it)
	 */
	setGrid(on) {
		const v = on === true
		if (v === this.#grid) return
		this.#grid = v
		if (this.#mounted && !this.#destroyed) this.#renderer.setGrid(v)
	}

	/**
	 * (Job 271) The current hit of the board search: a frame around item id
	 * in every mode (renderer setSearchHit), null removes it. Also before
	 * mount() (the state only); no callback.
	 *
	 * @param {string|null} id item id
	 */
	setSearchHit(id) {
		this.#searchHit = typeof id === 'string' ? id : null
		if (this.#mounted && !this.#destroyed) this.#renderer.setSearchHit(this.#searchHit)
	}

	/** @return {string|null} (job 271) the item of the search frame (null: none, or its item is gone) */
	getSearchHit() {
		return this.#searchHit !== null && this.#model.has(this.#searchHit) ? this.#searchHit : null
	}

	/** @return {boolean} the background grid is on */
	getGrid() {
		return this.#grid
	}

	/**
	 * Snapping to the shown grid on or off (M2, SPEC-M1 §1.2 (R12)); only true
	 * turns it on. Draws nothing and calls back nothing; also before mount()
	 * and after destroy() (the state only). With the grid hidden nothing snaps
	 * to it either way. A running drag or resize follows from its next step.
	 *
	 * @param {boolean} on drags and resizes snap to the shown grid
	 */
	setGridSnap(on) {
		this.#gridSnap = on === true
	}

	/** @return {boolean} drags and resizes snap to the grid while it is shown */
	getGridSnap() {
		return this.#gridSnap
	}

	/**
	 * What the mouse wheel does without Ctrl/⌘ (job 154), in every mode: 'auto' (a
	 * wheel with notches zooms, a trackpad pans), 'zoom' or 'pan'; anything else is
	 * 'auto'. A running wheel gesture keeps what it decided. Draws nothing, calls back
	 * nothing; also before mount() and after destroy().
	 *
	 * @param {string} stage one of WHEEL_STAGES
	 */
	setWheel(stage) {
		this.#wheel = WHEEL_STAGES.includes(stage) ? stage : 'auto'
	}

	/** @return {string} the stage of the mouse wheel (WHEEL_STAGES) */
	getWheel() {
		return this.#wheel
	}

	/**
	 * (Factory job 189) "New comment": while on, the canvas takes its input
	 * as in mode view (a drag pans, nothing is selected or moved, keys of
	 * mode edit do nothing; a left press of the mouse or pen pans only
	 * beyond its threshold, like in mode vote) and the next click or tap
	 * without a drag gives onIntent({type: 'pick', at, world, touch}) in
	 * every mode, instead of a selection or a vote; the cursor is a
	 * crosshair. The touchend of a finger's or pen's pick tap is cancelled
	 * (no compatibility mousedown on the field that opens there; the next
	 * touchstart forgets a flag whose touchend never came). The session switches it off again (after the pick, Esc,
	 * "Cancel"). Before mount and after destroy nothing.
	 *
	 * @param {boolean} on pick the next tap
	 */
	setPick(on) {
		if (this.#destroyed) return
		const v = on === true
		if (v === this.#pick) return
		this.#pick = v
		this.#applyCursorStyle()
	}

	/** @return {boolean} (job 189) setPick is on */
	getPick() {
		return this.#pick
	}

	/**
	 * M0 alias: setMode(v ? 'view' : 'edit') without settle (an open editor stays open).
	 *
	 * @param {boolean} viewOnly true = view, false = edit
	 */
	setViewOnly(viewOnly) {
		this.setMode(viewOnly ? 'view' : 'edit')
	}

	/**
	 * (job 172) The session's part of the reaction rule: canReact (the role
	 * may react and the board is not frozen; only true counts) and me (the
	 * own pid, which pills are mine) and (job 183) touch (the device has a
	 * touch screen; only true counts). The scene adds its own rule (mode
	 * edit: only the select tool; a touch screen in mode vote or view: the
	 * button at every note) and draws from the next frame on. Also before
	 * mount; after destroy nothing.
	 *
	 * @param {{canReact?: boolean, me?: (string|null), touch?: boolean}|null} cfg the session's part
	 */
	setReactions(cfg) {
		if (this.#destroyed) return
		const canReact = cfg?.canReact === true
		const me = typeof cfg?.me === 'string' ? cfg.me : null
		const touch = cfg?.touch === true
		if (canReact === this.#reactCfg.canReact && me === this.#reactCfg.me && touch === this.#reactCfg.touch) return
		this.#reactCfg = { canReact, me, touch }
		this.#handlesDirty = true
		this.#wake()
	}

	/**
	 * (job 191) The board's tags (meta.tags, cleaned): the notes' tag rows
	 * and an open note editor follow. Also before mount; after destroy
	 * nothing.
	 *
	 * @param {Array<{id: string, name: string, color: string}>} list tags
	 */
	setTags(list) {
		if (this.#destroyed) return
		const tags = Array.isArray(list) ? list : []
		this.#tags = tagMap(tags)
		this.#renderer.setTags(tags)
		if (this.#editor?.id) this.#layoutEditor()
		this.#wake()
	}

	/**
	 * (job 191) This tab's tag filter: the notes without one of the tags fade.
	 *
	 * @param {string[]|null} ids chosen tags (null or []: no filter)
	 */
	setTagFilter(ids) {
		if (this.#destroyed) return
		this.#renderer.setTagFilter(ids)
		this.#wake()
	}

	/**
	 * Voting state for mode vote (SPEC-M1 §6.3 SceneVoteState, values R16;
	 * [C] builds it from VoteState, §6.5.5). null clears it.
	 *
	 * Unlike setTool or setMode, which ignore unknown values, a deviation
	 * throws: SceneVoteState is a frozen cross-contract, and ignoring a
	 * broken one would only show as missing badges or votes. The check
	 * follows the typedef and its value rules: votable a function, scope a
	 * string or null, badges a Map from item ids (strings) to {mine: an
	 * integer >= 0, total: an integer >= 0 or null (never undefined)},
	 * markVotable a boolean, color #rrggbb, live (job 149) missing or a
	 * boolean; keys beyond it are ignored. On a
	 * TypeError the previous state stays. The scene keeps a frozen copy
	 * (badges copied entry by entry, votable as given), so a later change to
	 * the caller's Map shows only with the next call. Before mount the state
	 * is kept; after destroy a valid one is ignored.
	 *
	 * The renderer draws from it in every mode (renderer.setVoteBadges, one
	 * node in the uiGroup): own votes on a circle in color with digits in
	 * contrastTextOn(color), totals as a number circle beside it when total
	 * !== null (with live a hollow "live" pill, job 149), with markVotable the empty rings on visible votable items
	 * without an own vote (not at LOD 2) and the 2-px outline of the scope
	 * frame; stats().voteState counts what the last frame drew. Only
	 * votable(id) === true counts as votable (S-13); votable is asked on a
	 * click or tap of mode vote and, cached until the next state or model
	 * change, for the rings. An exception from votable counts as false and
	 * is reported once per state.
	 *
	 * @param {SceneVoteState|null} state voting state, null = no voting session
	 * @throws {TypeError} when state is neither null nor a valid SceneVoteState
	 */
	setVoteState(state) {
		const next = state === null ? null : checkVoteState(state)
		if (this.#destroyed) return
		this.#vote = next
		this.#votableCache.clear()
		this.#votableErr = false
		if (this.#mounted) this.#pushVoteBadges()
	}

	/** Hands the vote state to the renderer (badges, the cached votable predicate). */
	#pushVoteBadges() {
		const v = this.#vote
		this.#renderer.setVoteBadges(v === null ? null : { badges: v.badges, votable: this.#votableCached, markVotable: v.markVotable, scope: v.scope, color: v.color, live: v.live })
		this.#wake()
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} SceneVoteState.votable(id) === true now (S-13: anything else is not votable)
	 */
	#votableNow(id) {
		const v = this.#vote
		if (v === null) return false
		try {
			return v.votable(id) === true
		} catch (err) {
			if (!this.#votableErr) {
				this.#votableErr = true
				reportAsync(err)
			}
			return false
		}
	}

	/** votable for the painting: #votableNow, cached until the next vote state or model change. */
	#votableCached = (id) => {
		let v = this.#votableCache.get(id)
		if (v === undefined) {
			v = this.#votableNow(id)
			this.#votableCache.set(id, v)
		}
		return v
	}

	/**
	 * (R13) Before a settled mode switch: the open editor ends with its final
	 * commit (an editor with a notice closes without one, as always; the
	 * focus goes back to the canvas when the editor had it), then the running
	 * drag, transform or connect drag ends like a release.
	 */
	#settle() {
		const ed = this.#editor
		if (ed !== null && ed.id !== null && !ed.closing) {
			const el = ed.element
			const focused = !!el && typeof document !== 'undefined' && document.activeElement === el
			ed.finish({ byKey: focused })
		}
		this.#input.settle()
	}

	/** Puts the keyboard focus on the canvas (single keys work again, §6.5.1). */
	focusCanvas() {
		if (!this.#mounted || this.#destroyed) return
		try {
			this.#container.focus?.({ preventScroll: true })
		} catch {
			// focus can fail in a detached document
		}
	}

	/**
	 * Debug/E2E (§6.3, __knorke.handles()): the handles usable now; (job 231)
	 * shown: drawn now (shownHandles), size: their drawn size in screen px.
	 *
	 * @return {Array<{name:string, x:number, y:number, shown:boolean, size:number}>} handle centres in container coordinates
	 */
	handles() {
		if (!this.#mounted || this.#destroyed) return []
		if (this.#handlesDirty) {
			this.#syncHandles()
			this.#wake()
		}
		const st = this.#handleState
		if (!st) return []
		const c = this.#camera.get()
		const sh = this.#shown
		return st.list.map((h) => ({ name: h.name, x: (h.x - c.x) * c.scale, y: (h.y - c.y) * c.scale, shown: sh.names.has(h.name), size: handleLook(h.name, sh.touch).size }))
	}

	/**
	 * (Job 178) Draws an image of items apart from the stage
	 * (KonvaRenderer.renderImage; the job from scene/exportImage.js): the
	 * camera, the selection, the LOD and everything shown stay as they are.
	 *
	 * @param {{ids: string[], frame: {x:number, y:number, w:number, h:number}, scale: number, width: number,
	 *   height: number, plan: object}} job the image
	 * @return {Promise<Blob|null>} the PNG, null when the browser could not draw it (or after destroy)
	 */
	exportImage(job) {
		if (this.#destroyed) return Promise.resolve(null)
		return this.#renderer.renderImage(job)
	}

	/**
	 * (Job 200) Draws an export as vectors apart from the stage
	 * (KonvaRenderer.renderVector): the camera, the selection, the LOD and
	 * everything shown stay as they are.
	 *
	 * @param {{ids: string[], frame: {x:number, y:number, w:number, h:number}, plan: object, format: 'svg'|'pdf', page?: string}} job the export (job 207: page)
	 * @return {Promise<{blob: Blob, width: number, height: number, scale: number}|null>} the file (null after destroy)
	 */
	exportVector(job) {
		if (this.#destroyed) return Promise.resolve(null)
		return this.#renderer.renderVector(job)
	}

	/**
	 * Height of a text item for a target state (rule 13): a detached Konva
	 * text measures it, never per frame.
	 *
	 * @param {object} item WireItem (target state: w, style.fontSize, data.text)
	 * @return {number} height in world units
	 */
	measureTextHeight(item) {
		const h = this.#renderer.measureTextHeight(item)
		return typeof h === 'number' && Number.isFinite(h) ? h : (Number.isFinite(item?.h) ? item.h : 0)
	}

	/**
	 * (Job 267) The height the content of an AI card needs (KonvaRenderer.measureAiHeight).
	 *
	 * @param {object} item WireItem
	 * @return {number|null} height in world units, null when it cannot be measured
	 */
	measureAiHeight(item) {
		if (this.#destroyed) return null
		const h = this.#renderer.measureAiHeight?.(item)
		return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : null
	}

	/**
	 * (Job 173) The text height of a table cell, measured like the renderer
	 * draws it (KonvaRenderer.measureCellHeight); estimateCellHeight when the
	 * renderer gives none. The session measures the target state of a table
	 * with it (model/table.js withSize).
	 *
	 * @param {string} text cell text
	 * @param {number} width wrap width (column width − 2 · TABLE_PAD)
	 * @param {boolean} bold header row
	 * @return {number} height in world units
	 */
	measureTableCell(text, width, bold) {
		let h
		try {
			h = this.#renderer.measureCellHeight(text, width, bold)
		} catch {
			h = undefined
		}
		return typeof h === 'number' && Number.isFinite(h) ? h : estimateCellHeight(text, width, bold)
	}

	/**
	 * (Job 195) The text size of a mind map node, measured like the renderer
	 * draws it (KonvaRenderer.measureNodeText); estimateNodeSize when the
	 * renderer gives none. The session measures the target state of a mind
	 * map with it (model/mindmap.js withBox).
	 *
	 * @param {string} text text
	 * @param {number} maxW wrap width
	 * @param {number} size font size
	 * @param {boolean} bold bold (the root)
	 * @return {{w: number, h: number}} world units
	 */
	measureNodeText(text, maxW, size, bold) {
		let m
		try {
			m = this.#renderer.measureNodeText(text, maxW, size, bold)
		} catch {
			m = undefined
		}
		return m && Number.isFinite(m.w) && Number.isFinite(m.h) ? m : estimateNodeSize(text, maxW, size, bold)
	}

	/**
	 * (Job 195) The box of a node as drawn (world units), for the comment bubbles.
	 *
	 * @param {string} id mind map id
	 * @param {string} key node key
	 * @return {{x:number, y:number, w:number, h:number, r:number}|null} null for a hidden or missing node
	 */
	nodeBox(id, key) {
		const a = this.#model.abs(id)
		const n = a ? this.#mindmapLayoutOf(id)?.byKey.get(key) : null
		return n ? { x: a.x + n.x, y: a.y + n.y, w: n.w, h: n.h, r: 0 } : null
	}

	/**
	 * (Job 195) The node under a world point (its box or its fold dot).
	 *
	 * @param {string} id mind map id
	 * @param {{x:number, y:number}} w world point
	 * @param {number} [tolPx] tolerance in screen px
	 * @return {string|null} its key, null elsewhere
	 */
	nodeAt(id, w, tolPx = HIT_TOL_MOUSE_PX) {
		return this.#mindmapPart(id, w, tolPx)?.key ?? null
	}

	/**
	 * (Job 195) Focuses a node of the one selected mind map (the session after
	 * adding one); a node the layout hides gives its folded ancestor.
	 *
	 * @param {string} id mind map id (selected alone)
	 * @param {string|null} key node key, null: no focus
	 * @return {boolean} the focus is that node now
	 */
	focusNode(id, key) {
		if (!this.#mounted || this.#destroyed || this.#viewOnly) return false
		const sel = this.#selection.values()
		if (key !== null && (sel.length !== 1 || sel[0] !== id)) return false
		this.#setFocus(id, key)
		return key === null ? this.#mmFocus === null : this.#mmFocus?.id === id
	}

	/** @return {{id: string, key: string}|null} (job 195) the focused node of the one selected mind map */
	getNodeFocus() {
		return this.#mmFocus ? { id: this.#mmFocus.id, key: this.#mmFocus.key } : null
	}

	// ---------------------------------------------------------------- presence

	/**
	 * @param {((nowMs:number) => RemoteSample[])|null} fn sampler, asked every frame while it returns samples
	 */
	setRemoteSampler(fn) {
		this.#sampler = typeof fn === 'function' ? fn : null
		this.#presenceDirty = true
		if (!this.#sampler && this.#mounted) {
			this.#lastSamples = []
			this.#samplesActive = false
			this.#renderPresence(performance.now())
		}
		this.#wake()
	}

	/** New presence arrived: wake the loop (cursors on a quiet scene). */
	presenceChanged() {
		this.#presenceDirty = true
		this.#wake()
	}

	/**
	 * (Job 171) The colour of the own laser trail (BoardSession: colorFor(me.pid)); others' trails come in the
	 * colour of their samples.
	 *
	 * @param {string} color #rrggbb
	 */
	setLaserColor(color) {
		this.#laserColor = color
		this.#laser?.setColor(color)
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} true while dragged or transformed locally (with descendants and attached
	 *   connectors), while its end is dragged (connector), or in the text editor
	 */
	isActive(id) {
		// (job 173) a cell editor leaves its table free: the cells of the others arrive meanwhile; (job 195) a node
		// editor its mind map; (job 199) a lane editor its frame
		return (this.#drag !== null && this.#drag.all.has(id)) || this.#xf.all.has(id) || this.#xfLinks.has(id) ||
			(this.#cc.active && this.#cc.id === id) ||
			(this.#editor !== null && this.#editor.id === id && this.#editor.kind !== 'cell' && this.#editor.kind !== 'node' && this.#editor.kind !== 'lane')
	}

	// ---------------------------------------------------------------- text editor

	/**
	 * Opens the text editor. Without `text` the lease lock applies (another
	 * participant holds the text → chip with "Take over" instead). With `text`
	 * (text rescue) it always opens, with that text instead of the model value.
	 * Called while the editor is closing (from inside its final intent), the
	 * editor opens right after the close.
	 *
	 * (Job 173) A table opens the editor of one cell: cell, or its top-left
	 * cell without one; a cell whose column or row is gone opens nothing.
	 * (Job 195) A mind map the editor of one node: cell (its key), or the
	 * focused node (else the root) without one; a node that is gone opens
	 * nothing. The node gets the focus when its map is selected alone.
	 * (Job 201) A symbol (a shape of a kind with an icon) has no text: it
	 * opens no editor, only the rescue editor (notice) still does. (Job 211)
	 * Symbols, BPMN events and gateways open the editor of their label below
	 * the box; only an own shape (kind image) opens none.
	 *
	 * @param {string} id item id
	 * @param {{text?:(string|null), notice?:(string|null), cell?:(string|null)}} [opts] start text, notice, the cell of a table
	 * @return {boolean} true when the editor is open (or opens after the close) for id
	 */
	openTextEditor(id, { text = null, notice = null, cell = null } = {}) {
		if (!this.#mounted || this.#destroyed) return false
		const it = this.#model.get(id)
		if (!it || this.#editor.closing) {
			if (text === null || it) {
				this.#pendingOpen = { id, text, notice, cell, until: performance.now() + PENDING_OPEN_MS }
				this.#wake()
			}
			return !!it
		}
		const table = it.t === 'table'
		// (job 195) a mind map opens the editor of one node: cell, or its focus (else its root) without one
		const mm = it.t === 'mindmap'
		if (!textPathOf(it.t) && !table && !mm) return false
		// job 201: a symbol has no text editor; (job 211) unless its text is a label (symbols, BPMN events and gateways)
		if (it.t === 'shape' && notice === null && isTextless(fieldValue(it, 'data.kind')) && !hasLabel(fieldValue(it, 'data.kind'))) return false
		// (job 199) a frame with lanes: cell names the lane whose name is edited (no lease)
		if (it.t === 'frame' && cell !== null) {
			// (job 225) or the name of a group
			if (!laneBands(it).some((b) => b.key === cell) && !colBands(it).some((b) => b.key === cell) &&
				!laneRuns(it).some((r) => r.key === cell) && !colRuns(it).some((r) => r.key === cell)) return false
			if (text === null && notice === null && (isLocked(it) || this.#viewOnly)) return false
			return this.#openEditor(id, { text, notice, takeover: false, cell })
		}
		const c = table
			? (cell === null ? firstCell(it) : (hasCell(it, cell) ? cell : null))
			: mm ? (cell === null ? (this.#mmFocus?.id === id ? this.#mmFocus.key : mindTree(it).root) : (nodesOf(it.data).has(cell) ? cell : null)) : null
		if ((table || mm) && c === null) return false
		// a locked item opens no user editor (M2, R20); the rescue editor (notice) still does
		if (text === null && notice === null && isLocked(it)) return false
		if (text === null) {
			if (this.#viewOnly && notice === null) return false
			if ((this.#editor.id !== id || this.#editor.cell !== c) && this.#leaseHeldByOther(id, c)) {
				this.#offerTakeOver(id, c)
				return false
			}
		}
		return this.#openEditor(id, { text, notice, takeover: false, cell: c })
	}

	/**
	 * Lease lost or text rejected: show the notice, stop intermediate commits;
	 * closing then discards without an intent. null removes the notice.
	 *
	 * @param {string} id item id
	 * @param {string|null} notice text (from the session)
	 * @param {string|null} [cell] (job 173) only the editor of this cell of a table
	 */
	setEditorNotice(id, notice, cell = null) {
		if (!this.#mounted || this.#editor.id !== id || this.#editor.cell !== (typeof cell === 'string' ? cell : null)) return
		this.#editor.setNotice(notice)
		this.#layoutEditor(true)
		this.#wake()
	}

	/**
	 * (R4, T5) Page hide, reload, close or leaving the board: a reload or close
	 * by keyboard fires no blur, so the text typed since the last 1 Hz commit
	 * would be lost. An open editor without a notice whose text differs from
	 * the last value it reported cancels its 1 Hz timer and reports the current
	 * text SYNCHRONOUSLY as an intermediate intent ({type:'text', …,
	 * final:false}, the same path as the 1 Hz commit). Never closes the editor,
	 * never moves the focus, never touches an editor with a notice.
	 *
	 * @return {boolean} true when an intent was emitted; false otherwise (no
	 *   editor, notice shown, nothing new since the last report)
	 */
	flushEditor() {
		if (!this.#mounted || this.#destroyed || this.#editor === null) return false
		return this.#editor.flush()
	}

	// ---------------------------------------------------------------- stats

	/**
	 * voteState (SPEC-M1 §6.3, §6.7 __knorke.scene().voteState, R16): null
	 * without a SceneVoteState, else {scope, markVotable, live, rings, badges,
	 * totals, outline}, counted from what is DRAWN as of the last frame:
	 * rings = empty rings on visible votable items without an own vote
	 * (always 0 at LOD 2), badges = drawn badges with an own number, totals =
	 * drawn total circles, outline = id of the outlined scope frame or null,
	 * live = the state's live (job 149: the totals are the live count).
	 * "Visible" is the renderer's culled set (its cull rectangle: the stage
	 * with its overscan, per side at least CULL_MARGIN of the viewport; the
	 * items it draws nodes for); before the first frame with the state the
	 * counters are those of the last frame (0, 0, 0, null without one).
	 * gliding: a followTo glide runs; pressing: 'press' is active.
	 * snapGuides (M2, R12): the number of snap guides the scene last handed
	 * to the renderer for a drag or a resize (0, 1 or 2; 0 without either
	 * and before mount).
	 * gapMarkers (M2, R12, equal gaps): the number of gap markers the scene
	 * last handed to the renderer (0 without a drag, before mount and after
	 * destroy).
	 * (job 194) measureLines: the number of measuring lines, snapLabels: the
	 * texts of the distance labels (gap markers first, then measuring lines)
	 * the scene last handed to the renderer during a drag or resize (0 and []
	 * otherwise); sizeLabel: the text "W × H" of the size label of a running
	 * resize, else null.
	 * grid (M2, R12): the background grid is on (getGrid; also before mount
	 * and after destroy); gridSnap: drags and resizes snap to the shown grid
	 * (getGridSnap; also before mount and after destroy); draws.grid: the grid
	 * paintings since mount (0 before mount and after destroy). snapGuides and
	 * gapMarkers count the snapping to items only. locks (M2, R20): the lock
	 * symbols the last painting drew (0 before mount and after destroy).
	 * holdRing (R38): {x, y}, the centre of the hold ring in container px,
	 * while it shows; null otherwise (also before mount and after destroy).
	 * overscan (M2, SPEC-M1 §6.3 "Überstand"): the renderer's {l, r, t, b,
	 * stageW, stageH} (CSS px: the stage's margin per side and its size);
	 * null before mount, after destroy and when the renderer reports none.
	 * outlines (job 140): the renderer's visible selection frames as placed,
	 * {kind: 'local'|'remote'|'group'|'multi', id, x, y, w, h, r} in world
	 * units (id null for group and multi; no connector halos); [] before
	 * mount, after destroy and when the renderer reports none.
	 * titleHint (job 143): the id of the frame whose "Add title…" hint is
	 * drawn, else null (also before mount and after destroy).
	 * reactions (job 172): the reaction rows the renderer painted last,
	 * [{id, shown: [[e, n, mine]], more, add}] ([] before mount, after
	 * destroy and when the renderer reports none); reactHover: the note
	 * under a mouse or hovering pen (box or band), else null.
	 * lasers (job 171): the laser trails the last frame painted, sorted
	 * ('<pid>:<client>', the own one 'self'; a trail without a point in view
	 * is not painted); [] before mount and after destroy.
	 * tables (job 173): every table of the model, by id, as the scene lays it
	 * out (measured row heights, a local preview included): {id, cols: [w…],
	 * rows: [h…], header}; [] before mount and after destroy. editingCell:
	 * the cell of the open cell editor, else null.
	 * notePreview (job 188): the note being taken off a pad, {id (the pad),
	 * x, y, w, h} in world units, else null.
	 * mindmaps (job 195): every mind map of the model, by id (header); []
	 * before mount and after destroy. nodeDrag: the node being dragged {id,
	 * key, target} (target: model/mindmap.js dropTarget or null), else null.
	 * headDrag (job 208): the head of a lane or column being dragged {id,
	 * key, to}, else null.
	 *
	 * @return {object} {items, nodesBuilt, attached, staticChildren, activeChildren, uiChildren, lod,
	 *   camera, liveCamera, lastCameraMs, gestureActive, cssTransform, draws:{static, overlay, grid}, transforming,
	 *   handles, voteState:({scope:(string|null), markVotable:boolean, live:boolean, rings:number, badges:number, totals:number,
	 *   outline:(string|null)}|null), snapGuides:number, gapMarkers:number, grid:boolean, gridSnap:boolean, wheel:string,
	 *   holdRing:({x:number, y:number}|null), overscan:({l:number, r:number, t:number, b:number, stageW:number,
	 *   stageH:number}|null), outlines:Array<{kind:string, id:(string|null), x:number, y:number, w:number,
	 *   h:number, r:number}>, titleHint:(string|null), …}
	 */
	stats() {
		const camera = this.#camera.get()
		const base = {
			items: this.#model.size,
			camera,
			liveCamera: this.#live ? { ...this.#live } : camera,
			lastCameraMs: this.#lastCameraMs,
			gestureActive: this.#live !== null,
			tool: this.#tool,
			mode: this.#mode,
			viewOnly: this.#viewOnly,
			loopRunning: this.#raf !== 0,
			editing: this.#editor ? this.#editor.id : null,
			dragging: this.#drag !== null,
			transforming: this.#xf.active,
			transformLive: this.#xf.active ? this.#xf.live : null,
			connecting: this.#cc.mode,
			voteState: this.#vote ? { scope: this.#vote.scope, markVotable: this.#vote.markVotable, live: this.#vote.live, ...this.#drawnVotes() } : null,
			gliding: this.#glide !== null,
			pressing: this.#press.active,
			snapGuides: this.#drag !== null ? this.#drag.guides.length : (this.#xfSnap !== null ? this.#xfSnap.guides.length : 0),
			gapMarkers: this.#drag !== null ? this.#drag.gaps.length : 0,
			// job 194
			measureLines: (this.#drag ?? this.#xfSnap)?.measures.length ?? 0,
			snapLabels: (this.#drag ?? this.#xfSnap)?.labels.map((l) => l.text) ?? [],
			sizeLabel: this.#sizeLabel?.text ?? null,
			grid: this.#grid,
			gridSnap: this.#gridSnap,
			wheel: this.#wheel,
			holdRing: this.#holdRing !== null ? { x: this.#holdRing.x, y: this.#holdRing.y } : null,
			titleHint: this.#mounted && !this.#destroyed ? this.#titleHint : null,
			plusPreview: this.#plusPreviewStat(),
			reactHover: this.#reactHover,
			lasers: this.#mounted && !this.#destroyed && this.#laser !== null ? [...this.#laser.keys] : [],
			// (job 273) the running pen stroke or eraser path: its kind, its points so far, the strokes it erases
			ink: this.#inkPress === null ? null : { kind: this.#inkPress.kind, points: this.#inkPress.pts.length / 2, erasing: [...this.#inkPress.hit].sort() },
			// job 173
			editingCell: this.#editor ? this.#editor.cell : null,
			tables: this.#mounted && !this.#destroyed ? this.#structure.tableStats() : [],
			// job 199
			lanes: this.#mounted && !this.#destroyed ? this.#structure.laneStats() : [],
			// job 188
			notePreview: this.#take !== null ? { id: this.#take.id, x: this.#take.x, y: this.#take.y, w: this.#take.w, h: this.#take.h } : null,
			// job 195
			mindmaps: this.#mounted && !this.#destroyed ? this.#mindmapStats() : [],
			nodeDrag: this.#nodeDrag !== null ? { id: this.#nodeDrag.id, key: this.#nodeDrag.key, target: this.#nodeDrag.target } : null,
			// job 208
			headDrag: this.#structure.headDrag !== null ? { id: this.#structure.headDrag.id, key: this.#structure.headDrag.key, to: this.#structure.headDrag.to } : null,
		}
		if (!this.#mounted || this.#destroyed) {
			return {
				...base, nodesBuilt: 0, attached: 0, staticChildren: 0, activeChildren: 0, uiChildren: 0, lod: 0,
				visible: 0, cssTransform: null, draws: { static: 0, overlay: 0, grid: 0 }, cursors: 0, handles: 0, selectionColor: null, locks: 0, groupOutlines: 0,
				overscan: null, outlines: [], reactions: [], tags: [], tagFilter: null,
			}
		}
		const r = this.#renderer.stats()
		return {
			...base,
			nodesBuilt: r.nodesBuilt,
			attached: r.attached,
			staticChildren: r.staticChildren,
			activeChildren: r.activeChildren,
			uiChildren: r.uiChildren,
			lod: r.lod,
			visible: r.visible,
			cssTransform: this.#renderer.cssTransform,
			draws: r.draws,
			cursors: this.#cursors.cursorCount,
			handles: this.#handleState ? this.#handleState.list.length : 0,
			// job 231: the color of the own selection (the theme's primary color or SELECTION_COLOR)
			selectionColor: r.selectionColor ?? null,
			locks: r.locks ?? 0,
			groupOutlines: r.groupOutlines ?? 0,
			overscan: r.overscan ? { ...r.overscan } : null,
			outlines: Array.isArray(r.outlines) ? r.outlines.map((o) => ({ ...o })) : [],
			reactions: Array.isArray(r.reactions) ? r.reactions.map((x) => ({ id: x.id, shown: x.shown.map((v) => [...v]), more: x.more, add: x.add })) : [],
			// job 191
			tags: Array.isArray(r.tags) ? r.tags.map((x) => ({ id: x.id, shown: [...x.shown], more: x.more })) : [],
			tagFilter: r.tagFilter ? { chosen: [...r.tagFilter.chosen], faded: [...r.tagFilter.faded] } : null,
		}
	}

	/** @return {{rings:number, badges:number, totals:number, outline:(string|null)}} what the last frame drew */
	#drawnVotes() {
		const d = this.#mounted && !this.#destroyed ? this.#renderer.voteDrawn() : null
		if (d === null || typeof d !== 'object') return { ...VOTE_DRAWN_NONE }
		return { rings: d.rings, badges: d.badges, totals: d.totals, outline: d.outline }
	}

	/** @return {KonvaRenderer} renderer (scene lab and debugging only) */
	get renderer() {
		return this.#renderer
	}

	// ---------------------------------------------------------------- internals: loop

	#wake() {
		if (!this.#raf && this.#mounted && !this.#destroyed) {
			this.#raf = requestAnimationFrame(this.#frame)
		}
	}

	#frame = () => {
		this.#raf = 0
		if (this.#destroyed) return
		const now = performance.now()
		if (this.#resizePending) {
			this.#resizePending = false
			const { w, h } = this.#measure()
			if (w !== this.#size.w || h !== this.#size.h) {
				this.#size = { w, h }
				this.#renderer.resize(w, h)
			}
		}
		if (this.#glide !== null) {
			this.#glideStep(now)
		}
		if (this.#live) {
			if (this.#liveDirty) {
				this.#liveDirty = false
				this.#renderer.gestureFrame(this.#live)
			}
		} else if (this.#pendingCam) {
			this.#applyCameraNow()
		}
		if (this.#drag !== null && this.#drag.pending) {
			this.#dragStep()
		}
		if (this.#xfTarget !== null) {
			this.#transformStep()
		}
		if (this.#ccTarget !== null) {
			this.#connectStep()
		}
		if (this.#pendingOpen && now > this.#pendingOpen.until) {
			this.#pendingOpen = null
		}
		if (this.#takeOver && now >= this.#takeOver.until) {
			this.#takeOver = null
			this.#presenceDirty = true
		}
		if (!this.#live) {
			// (job 172) before the handles: the band of the selected note's row places them
			this.#syncReactState()
		}
		if (this.#handlesDirty && !this.#live) {
			this.#syncHandles()
		}
		// (job 171) a laser stroke held still reports its point again
		if (this.#laserPress !== null && now - this.#laserPress.at >= LASER_BEAT_MS) {
			this.#laserAt(this.#laserPress.sp)
		}
		this.#samplePresence(now)
		this.#laser.render(this.#lastSamples, this.#liveCam(), this.#size, now)
		this.#ink.render(this.#liveCam(), this.#size)
		this.#layoutEditor()
		this.#syncSelectionBox()
		if (!this.#live) {
			this.#renderer.flushDraws()
		}
		if (this.#camPending && now - this.#camLast >= CAMERA_EMIT_MS) {
			this.#emitCamera(this.#camPending, true)
		}
		if (this.#needsFrame(now)) {
			this.#wake()
		}
	}

	/**
	 * @param {number} now time of this frame
	 * @return {boolean} the next frame has work; (job 171) a laser stroke runs or a trail is still visible
	 */
	#needsFrame(now) {
		return this.#pendingCam || this.#resizePending || this.#presenceDirty || this.#samplesActive || this.#glide !== null ||
			(this.#live !== null && this.#liveDirty) || (this.#drag !== null && this.#drag.pending) ||
			this.#xfTarget !== null || this.#ccTarget !== null || (this.#handlesDirty && this.#live === null) ||
			(this.#live === null && this.#renderer.hasDirty()) || this.#camPending !== null ||
			this.#takeOver !== null || this.#pendingOpen !== null || this.#laserPress !== null || this.#laser.active(now) ||
			this.#ink.active()
	}

	/**
	 * (Job 171) A point of the own laser stroke at a container point (world with the camera the user sees),
	 * drawn at once and reported (onLaser); null ends the stroke (onLaser(null), only when one runs).
	 *
	 * @param {{x:number, y:number}|null} sp container point
	 */
	#laserAt(sp) {
		if (sp === null) {
			if (this.#laserPress === null) return
			this.#laserPress = null
			this.#laser?.end()
			this.#call('onLaser', null)
			this.#wake()
			return
		}
		if (!this.#mounted || this.#destroyed) return
		const now = performance.now()
		const c = this.#liveCam()
		const w = { x: c.x + sp.x / c.scale, y: c.y + sp.y / c.scale }
		this.#laserPress = { sp: { x: sp.x, y: sp.y }, at: now }
		this.#laser.add(w.x, w.y, now)
		this.#call('onLaser', w)
		this.#wake()
	}

	/**
	 * (Job 273) The own pen stroke or eraser path (InputController, mode 'ink'). 'down' starts it with the
	 * pen tool's kind, 'move' and 'end' add the point when it lies INK_MIN_STEP_PX from the last kept one
	 * (world with the camera the user sees), 'cancel' drops it. While it runs the overlay shows it
	 * (InkLayer); the eraser collects every pen stroke it touches (not locked ones) and the renderer hides
	 * them (setErasing). At 'end' a pen or highlighter stroke becomes the intent {type: 'stroke', points
	 * (fitted, world), kind, stroke, strokeWidth}; the eraser's strokes the intent {type: 'delete', ids}.
	 *
	 * @param {{x:number, y:number}|null} sp container point (null: none)
	 * @param {'down'|'move'|'end'|'cancel'} phase what happens
	 * @param {boolean} [coarse] down: a pen or a finger (the eraser's reach INK_ERASER_COARSE_PX)
	 */
	#inkAt(sp, phase, coarse = false) {
		if (phase === 'cancel') {
			this.#inkDrop()
			return
		}
		if (phase === 'down') {
			if (!this.#mounted || this.#destroyed) return
			this.#inkPress = { kind: this.#toolOptions.pen.penKind, pts: [], last: null, coarse: coarse === true, hit: new Set() }
		}
		const P = this.#inkPress
		if (P === null) return
		const c = this.#liveCam()
		if (sp !== null && keepPoint(P.last, sp)) {
			P.pts.push(c.x + sp.x / c.scale, c.y + sp.y / c.scale)
			P.last = { x: sp.x, y: sp.y }
			if (P.kind === 'eraser') this.#eraseAlong(P, c.scale)
		}
		if (phase === 'end') {
			this.#inkPress = null
			this.#ink.set(null)
			if (P.kind === 'eraser') {
				this.#renderer.setErasing?.(null)
				const ids = [...P.hit].filter((id) => this.#model.has(id))
				if (ids.length > 0) this.#call('onIntent', { type: 'delete', ids })
			} else if (P.pts.length >= 2) {
				const look = this.#inkLook(P.kind)
				this.#call('onIntent', { type: 'stroke', points: fitPoints(P.pts, INK_TOLERANCE_PX / c.scale), kind: P.kind, stroke: look.color, strokeWidth: look.width })
			}
			this.#wake()
			return
		}
		this.#ink.set(P.kind === 'eraser'
			? { pts: P.pts, eraser: true, reachPx: this.#eraserPx(P) }
			: { pts: P.pts, ...this.#inkLook(P.kind) })
		this.#wake()
	}

	/** (job 273) Drops a running pen stroke or eraser path: nothing made, nothing erased. */
	#inkDrop() {
		if (this.#inkPress === null) return
		const eraser = this.#inkPress.kind === 'eraser'
		this.#inkPress = null
		this.#ink?.set(null)
		if (eraser) this.#renderer.setErasing?.(null)
		this.#wake()
	}

	/**
	 * @param {string} kind 'pen' or 'marker'
	 * @return {{color:string, width:number, opacity:number}} the colour, width and opacity the tool draws with
	 */
	#inkLook(kind) {
		const o = this.#toolOptions.pen
		return kind === 'marker'
			? { color: o.markerColor, width: o.markerWidth, opacity: MARKER_OPACITY }
			: { color: o.penColor, width: o.penWidth, opacity: 1 }
	}

	/** @return {number} the eraser's reach (container px) */
	#eraserPx(P) {
		return P.coarse ? INK_ERASER_COARSE_PX : INK_ERASER_PX
	}

	/**
	 * (job 273) The pen strokes the eraser's last piece touches join P.hit (locked ones never); the renderer
	 * hides them until the release or the drop.
	 *
	 * @param {object} P the running eraser path
	 * @param {number} scale camera scale
	 */
	#eraseAlong(P, scale) {
		const n = P.pts.length
		const bx = P.pts[n - 2]
		const by = P.pts[n - 1]
		const ax = n >= 4 ? P.pts[n - 4] : bx
		const ay = n >= 4 ? P.pts[n - 3] : by
		const reach = this.#eraserPx(P) / scale
		let grew = false
		for (const e of this.#model.query(Math.min(ax, bx) - reach, Math.min(ay, by) - reach, Math.max(ax, bx) + reach, Math.max(ay, by) + reach)) {
			if (P.hit.has(e.id)) continue
			const it = this.#model.get(e.id)
			if (it?.t !== 'pen' || isLocked(it)) continue
			const a = this.#model.abs(e.id)
			if (!a) continue
			const r = reach + fieldValue(it, 'style.strokeWidth') / 2
			if (eraserTouches(pointsOf(it.data?.points), ax - a.x, ay - a.y, bx - a.x, by - a.y, r)) {
				P.hit.add(e.id)
				grew = true
			}
		}
		if (grew) this.#renderer.setErasing?.([...P.hit])
	}

	#measure() {
		return { w: this.#container.clientWidth || 0, h: this.#container.clientHeight || 0 }
	}

	// ---------------------------------------------------------------- internals: camera

	/** @param {Camera} cam new confirmed camera, applied in the next frame */
	#setCam(cam) {
		const c = this.#camera.set(cam.x, cam.y, cam.scale)
		this.#pendingCam = true
		this.#emitCamera(c)
		this.#wake()
	}

	#applyCameraNow() {
		this.#pendingCam = false
		const c = this.#camera.get()
		const t0 = performance.now()
		this.#renderer.setCamera(c.x, c.y, c.scale)
		this.#lastCameraMs = performance.now() - t0
		this.#presenceDirty = this.#presenceDirty || this.#samplesActive
		// handles follow the scale, and the end and "+" handles appear or go with LOD 2
		if ((this.#handleState && this.#handleState.scale !== c.scale) || this.#coarseAt(c.scale) !== this.#handleCoarse) this.#syncHandles()
	}

	/** A running gesture ends now (commit), a follow glide ends at the camera it shows (§6.3 "Folgen" (5)). */
	#endGestureNow() {
		if (this.#glide !== null) {
			this.#abortGlide()
		} else if (this.#live !== null) {
			this.#gestures.cancel()
		}
	}

	/**
	 * @return {boolean} a user camera gesture runs or may start: CSS path (wheel, touch), a finger
	 *   below the tap threshold, a mouse/pen pan (also a deferred one); a follow glide is none
	 */
	#userCameraBusy() {
		return (this.#live !== null && this.#glide === null) || this.#gestures?.active === true ||
			this.#gestures?.panning === true || this.#gestures?.pending === true
	}

	/** @return {boolean} the user asks for reduced motion (checked at every followTo) */
	#reducedMotion() {
		try {
			return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
				window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true
		} catch {
			return false
		}
	}

	/**
	 * A follow glide starts from the confirmed camera: the canvas is brought
	 * up to date first (as at a gesture start), then the CSS path opens.
	 *
	 * @param {Camera} target clamped target camera
	 * @param {number} ms duration
	 * @param {number} now start time
	 * @param {(ok:boolean) => void} resolve settles the followTo promise
	 */
	#beginGlide(target, ms, now, resolve) {
		if (this.#pendingCam) {
			this.#applyCameraNow()
		}
		this.#renderer.flushDraws()
		const c0 = this.#camera.get()
		this.#live = { ...c0 }
		this.#liveDirty = false
		this.#renderer.beginGesture()
		this.#glide = { from: c0, to: target, t0: now, ms, resolve }
	}

	/** @param {number} now frame time: the glide camera of this frame, or the end */
	#glideStep(now) {
		const g = this.#glide
		const u = (now - g.t0) / g.ms
		if (u >= 1) {
			this.#finishGlide(g.to, true)
			return
		}
		const c = glideCamera(g.from, g.to, u, this.#size.w, this.#size.h)
		this.#live = c
		this.#liveDirty = true
		this.#emitCamera(c)
	}

	/**
	 * The glide ends at cam: it becomes the confirmed camera, drawn once
	 * synchronously (endGesture), onCamera with it; the promise gets result.
	 *
	 * @param {Camera} cam camera
	 * @param {boolean} result true = arrived, false = aborted or replaced by a jump
	 */
	#finishGlide(cam, result) {
		const g = this.#glide
		this.#glide = null
		const c = this.#camera.set(cam.x, cam.y, cam.scale)
		this.#live = null
		this.#liveDirty = false
		this.#pendingCam = false
		this.#syncHandles(c.scale)
		this.#renderer.endGesture(c)
		this.#renderPresence(performance.now())
		this.#layoutEditor(true)
		this.#emitCamera(c, true)
		g.resolve(result)
		this.#wake()
	}

	/** (5) A running glide ends at the camera it shows now, its promise resolves false. */
	#abortGlide() {
		if (this.#glide !== null) this.#finishGlide(this.#live ?? this.#camera.get(), false)
	}

	/** onUserCamera at most once per gesture or pan (its first camera change). */
	#userCameraOnce() {
		if (this.#userCamSent) return
		this.#userCamSent = true
		this.#call('onUserCamera')
	}

	/**
	 * Camera keys (SPEC-M1 §6.10): user camera changes, reported with onUserCamera.
	 *
	 * @param {'in'|'out'|'fit'|'100'|'selection'} what key action
	 */
	#keyCamera(what) {
		if (what === 'selection' && !this.#model.boundsOf(this.#selection.values())) return
		// a running gesture or follow glide ends first: the key works on the camera the user sees
		this.#endGestureNow()
		let cam = null
		const c = this.#camera.get()
		const mid = { x: this.#size.w / 2, y: this.#size.h / 2 }
		if (what === 'in') cam = this.#camera.zoomAt(mid.x, mid.y, KEY_ZOOM_STEP)
		else if (what === 'out') cam = this.#camera.zoomAt(mid.x, mid.y, 1 / KEY_ZOOM_STEP)
		else if (what === '100') cam = this.#camera.zoomAt(mid.x, mid.y, 1 / c.scale)
		else if (what === 'fit') cam = this.#camera.fit(this.#model.allBounds(), this.#size.w, this.#size.h, 48, this.#cb.viewInsets?.())
		else if (what === 'selection') {
			const rect = this.#model.boundsOf(this.#selection.values())
			if (!rect) return
			// job 242: up to MAX_SCALE, like a zoom by hand
			cam = this.cameraForRect(rect, SELECTION_ZOOM_PAD_PX, this.#cb.viewInsets?.(), MAX_SCALE)
		}
		if (!cam) return
		this.#call('onUserCamera')
		this.#setCam(cam)
	}

	/** @param {Camera} c0 camera at the start of the gesture */
	#gestureStart(c0) {
		// The CSS transform starts from what the canvas shows: bring it up to date first.
		if (this.#pendingCam) {
			this.#applyCameraNow()
		}
		this.#renderer.flushDraws()
		this.#userCamSent = false
		this.#live = { ...c0 }
		this.#liveDirty = false
		this.#renderer.beginGesture()
		this.#call('onActivity', { kind: 'gesture', active: true, ids: [] })
		this.#wake()
	}

	/** @param {Camera} c1 final camera of the gesture */
	#gestureEnd(c1) {
		const c = this.#camera.set(c1.x, c1.y, c1.scale)
		this.#live = null
		this.#liveDirty = false
		// handles take their screen size for the new scale before the synchronous draw
		this.#syncHandles(c.scale)
		// one synchronous draw of every non-empty layer, transform reset in the same task
		this.#renderer.endGesture(c)
		this.#renderPresence(performance.now())
		this.#layoutEditor(true)
		this.#emitCamera(c, true)
		this.#call('onActivity', { kind: 'gesture', active: false, ids: [] })
		this.#wake()
	}

	/** @return {Camera} the camera the user sees right now (live during a gesture) */
	#liveCam() {
		return this.#live ? this.#live : this.#camera.get()
	}

	/**
	 * @param {Camera} cam camera to report
	 * @param {boolean} [force] ignore the 10 Hz limit
	 */
	#emitCamera(cam, force = false) {
		const now = performance.now()
		if (force || now - this.#camLast >= CAMERA_EMIT_MS) {
			this.#camLast = now
			this.#camPending = null
			this.#call('onCamera', { x: cam.x, y: cam.y, scale: cam.scale })
		} else {
			this.#camPending = { x: cam.x, y: cam.y, scale: cam.scale }
			this.#wake()
		}
	}

	#applyCursorStyle() {
		if (!this.#mounted || this.#destroyed) return
		let cursor = 'default'
		if (this.#pick) cursor = 'crosshair'
		else if (this.#viewOnly || this.#space || this.#tool === 'hand') cursor = 'grab'
		else if (CREATE_TOOLS.has(this.#tool) || this.#tool === 'laser' || this.#tool === 'pen') cursor = 'crosshair'
		// (job 173) a column border of the selected table: being dragged or hovered
		else if (this.#structure.colDrag !== null) cursor = typeof this.#structure.colDrag.lane === 'string' || this.#structure.colDrag.ax === 'y' ? 'row-resize' : 'col-resize'
		else if (this.#hoverHandle !== null) {
			const f = this.#handleState?.frame
			cursor = ANCHORS.includes(this.#hoverHandle) ? getCursor(this.#hoverHandle, f ? f.r || 0 : 0) : 'crosshair'
		} else if (this.#hoverBorder) cursor = this.#hoverBorder === 'row' ? 'row-resize' : 'col-resize'
		// (job 188) the pile of a pad gives notes
		else if (this.#take !== null || this.#hoverStack) cursor = 'copy'
		else if (this.#reactCursor) cursor = 'pointer'
		this.#renderer.contentEl.style.cursor = cursor
	}

	// ---------------------------------------------------------------- internals: input host

	#host() {
		return {
			model: this.#model,
			gestures: this.#gestures,
			selection: this.#selection,
			viewOnly: () => this.#viewOnly || this.#pick,
			coarse: () => this.#coarseNow(),
			coarseTitleAt: (w, tolWorld) => (this.#coarseNow() ? this.#renderer.coarseTitleAt(w.x, w.y, tolWorld) ?? null : null),
			// (job 158) the width of the text a frame shows in its title band (world), null without one
			titleTextWidth: (id) => this.#titleTextWidth(id),
			// (job 177) the block of the text lines a shape without fill draws (its own coordinates), null without one
			shapeTextRect: (id) => this.#shapeTextRect(id),
			tool: () => this.#tool,
			toolOptions: (t) => this.getToolOptions(t) ?? {},
			// (job 171) a point of the own laser stroke at a container point, null ends it
			laser: (sp) => this.#laserAt(sp),
			// (job 273) the pen stroke or eraser path at a container point: 'down', 'move', 'end' or 'cancel'
			ink: (sp, phase, coarse) => this.#inkAt(sp, phase, coarse),
			setToolFromScene: (t) => {
				if (TOOL_IDS.includes(t) && t !== this.#tool) {
					this.#noteBack()
					this.#tool = t
					this.#handlesDirty = true
					this.#applyCursorStyle()
					this.#call('onTool', t)
					this.#wake()
				}
			},
			// the key G (M2, R12): the scene's own switch, reported like a tool key
			toggleGrid: () => {
				this.setGrid(!this.#grid)
				this.#call('onGrid', this.#grid)
			},
			// the key ? (job 145): the shell's shortcuts overview
			showShortcuts: () => this.#call('onShortcuts'),
			// (job 271) Ctrl/⌘+F outside text fields and dialogs
			showSearch: () => this.#call('onSearch'),
			// the key C (job 147): other people's cursors, switched by the session
			toggleCursors: () => this.#call('onCursors'),
			setSpace: (on) => {
				if (on !== this.#space) {
					this.#space = on
					this.#applyCursorStyle()
				}
			},
			scale: () => this.#liveCam().scale,
			local: (e) => {
				const r = this.#container.getBoundingClientRect()
				return { x: e.clientX - r.left, y: e.clientY - r.top }
			},
			toWorld: (p) => {
				const c = this.#liveCam()
				return { x: c.x + p.x / c.scale, y: c.y + p.y / c.scale }
			},
			canvasFocused: (e) => e?.target === this.#container,
			focusCanvas: () => this.focusCanvas(),
			selectionChanged: () => this.#selectionChanged(true),
			// (job 190) the offer of locked items (a plain marquee, Ctrl/⌘+A); null ends it (onLockedOffer)
			lockedOffer: (ids) => this.#setOffer(ids, true),
			intent: (i) => this.#call('onIntent', i),
			// (job 231) sp: the container point of a hover (null off the canvas), for the handles shown
			pointer: (w, sp) => {
				this.#hoverSp = w && sp && Number.isFinite(sp.x) && Number.isFinite(sp.y) ? { x: sp.x, y: sp.y } : null
				this.#pushHandles()
				this.#call('onPointer', w)
			},
			beginDrag: (ids, primary) => this.#beginDrag(ids, primary),
			// (job 163) the frame of the own multi-selection or group in which a drag moves all of it, else null
			dragFrame: () => this.#dragFrame(),
			// mods.ctrl: Ctrl/⌘ held, the drag does not snap (R12)
			moveDrag: (dx, dy, mods) => {
				if (this.#drag) {
					this.#drag.tx = dx
					this.#drag.ty = dy
					this.#drag.ctrl = !!mods?.ctrl
					this.#drag.pending = true
					this.#wake()
				}
			},
			endDrag: (commit) => this.#endDrag(commit),
			handleAt: (sp, coarse) => this.#handleAt(sp, coarse),
			// (job 136) the one note, shape or text item whose "+" handles show now, else null
			plusItem: () => this.#handleState?.item ?? null,
			// (job 162) type: the pointerType of the hover, null after a pointerdown (no "+" preview)
			setHoverHandle: (name, type) => {
				this.#hoverHandle = name
				this.#hoverType = typeof type === 'string' ? type : null
				if (this.#hoverType !== null) this.#setLook(this.#hoverType)
				this.#applyCursorStyle()
				this.#syncPlusPreview()
			},
			beginTransform: (anchor, w) => this.#beginTransform(anchor, w),
			// mods.ctrl: Ctrl/⌘ held, the resize does not snap (R12)
			moveTransform: (w, mods) => {
				if (this.#xf.active) {
					this.#xfTarget = { p: { x: w.x, y: w.y }, mods: { shift: !!mods?.shift, alt: !!mods?.alt, ctrl: !!mods?.ctrl } }
					this.#wake()
				}
			},
			endTransform: (commit) => this.#endTransform(commit),
			beginConnect: (w, mods) => this.#beginConnect(w, mods),
			// (job 159) hang: the connector hangs from the "+" without a press (no handles meanwhile)
			beginConnectHandle: (name, w, hang) => this.#beginConnectHandle(name, w, hang === true),
			// (job 159) sp lies in the hit circle of the "+" the connector hangs from
			hangPlusAt: (sp, coarse) => this.#hangPlusAt(sp, coarse),
			moveConnect: (w, mods) => {
				if (this.#cc.active) {
					this.#ccTarget = { w: { x: w.x, y: w.y }, mods: { ctrl: !!mods?.ctrl, coarse: !!mods?.coarse } }
					this.#wake()
				}
			},
			endConnect: (commit) => this.#endConnect(commit),
			setMarquee: (rect, kind) => {
				this.#renderer.setMarquee(rect, kind)
				this.#wake()
			},
			// (R38) the hold signal of the touch marquee at sp (container px), null hides the ring
			holdSignal: (sp) => this.#holdSignal(sp),
			finishEditor: () => this.#editor.finish(),
			// (job 173) w: the world point of a double click (a table opens the cell there)
			editFromUser: (id, w) => this.openTextEditor(id, this.#editTarget(id, w)),
			// (job 173) the cell of a table under a world point, null outside its cells; (job 195) a mind map's node
			// (job 199) a frame with lanes: the lane under it
			cellAt: (id, w) => (this.#model.get(id)?.t === 'mindmap' ? this.#mindmapPart(id, w)?.key ?? null
				: this.#model.get(id)?.t === 'frame' ? this.#structure.laneAt(id, w) : this.#structure.cellAt(id, w)),
			// (job 208) the column of a frame under a world point (clamped), null without columns
			colAt: (id, w) => this.#structure.colAt(id, w),
			// (job 208) the head of a lane or a column under a world point: {lane} or {col}, else null
			headAt: (id, w) => this.#structure.headAt(id, w),
			beginHeadDrag: (id, head, w) => this.#structure.beginHeadDrag(id, head, w),
			moveHeadDrag: (w) => this.#structure.moveHeadDrag(w),
			endHeadDrag: (commit) => this.#structure.endHeadDrag(commit),
			// (job 173) a column border of the one selected table at a container point, null without one;
			// (job 199) or the border below a lane of the one selected frame with lanes ({id, lane, h0}); (job 208) or
			// the right edge of one of its columns ({id, fcol, w0})
			tableBorderAt: (sp, coarse) => this.#structure.tableBorderAt(sp, coarse) ?? this.#structure.laneBorderAt(sp, coarse),
			beginColumn: (b) => this.#structure.beginColumn(b),
			moveColumn: (dx, dy) => this.#structure.moveColumn(dx, dy),
			endColumn: (commit) => this.#structure.endColumn(commit),
			setHoverBorder: (on) => {
				const v = on === 'row' ? 'row' : on === true
				if (v !== this.#hoverBorder) {
					this.#hoverBorder = v
					this.#applyCursorStyle()
				}
			},
			// (job 188) the part of a pad under a world point ('stack', 'band'), null for anything but a pad
			padPart: (id, w) => padPart(this.#model, id, w),
			// (job 195) mind maps: the node or fold dot under a world point ({key, part}), the focus, a node drag
			mindmapPart: (id, w, tolPx) => this.#mindmapPart(id, w, tolPx),
			mmFocus: () => this.getNodeFocus(),
			// (job 195) the node under a hovering mouse or pen ({id, key}), else null
			mmHover: () => (this.#mmHover ? { ...this.#mmHover } : null),
			setMmFocus: (id, key) => this.#setFocus(id, key),
			mmStep: (dir) => this.#stepFocus(dir),
			beginNodeDrag: (id, key, w) => this.#beginNodeDrag(id, key, w),
			moveNodeDrag: (w) => this.#moveNodeDrag(w),
			endNodeDrag: (commit) => this.#endNodeDrag(commit),
			setHoverNode: (id, key) => this.#setHoverNode(id, key),
			beginTake: (id, w) => this.#beginTake(id, w),
			moveTake: (w) => this.#moveTake(w),
			endTake: (commit) => this.#endTake(commit),
			setHoverStack: (on) => {
				if ((on === true) !== this.#hoverStack) {
					this.#hoverStack = on === true
					this.#applyCursorStyle()
				}
			},
			userCamera: (what) => this.#keyCamera(what),
			nudge: (dx, dy) => this.#nudge(dx, dy),
			tabSelect: (dir) => this.#tabSelect(dir),
			isInteractiveTarget: (e) => this.#isInteractive(e.target),
			editorOpen: () => this.#editor !== null && this.#editor.id !== null,
			menuReady: () => this.#menuReady(),
			menuAnchor: (ids) => this.#menuAnchor(ids),
			// (job 172) the band of the one selected note's reaction row counts like the gap (world units, else 0)
			reactBand: (id) => this.#reactBandOf(id, this.#liveCam().scale),
		}
	}

	// ---------------------------------------------------------------- internals: note pads (job 188)

	/**
	 * (Job 188) A press on the pile of a pad moved beyond its threshold: the
	 * preview note (the pad's size and fill) follows the pointer from now on
	 * with the offset where it was grabbed. Nothing goes to the others.
	 *
	 * @param {string} id the pad
	 * @param {{x:number, y:number}} w world point of the press
	 * @return {boolean} the preview runs (mode edit, the select tool, the pad in the model)
	 */
	#beginTake(id, w) {
		if (this.#viewOnly || this.#tool !== 'select' || this.#take !== null) return false
		const it = this.#model.get(id)
		const a = it?.t === 'pad' ? this.#model.abs(id) : null
		if (!a) return false
		this.#take = { id, w0: { x: w.x, y: w.y }, x0: a.x, y0: a.y, w: a.w, h: a.h, fill: shownColor(fieldValue(it, 'style.fill')), x: a.x, y: a.y }
		this.#applyCursorStyle()
		this.#moveTake(w)
		return true
	}

	/**
	 * @param {{x:number, y:number}} w world point of the pointer: the note's corner is the pile's corner plus
	 *   the way since the press
	 */
	#moveTake(w) {
		const T = this.#take
		if (T === null) return
		T.x = T.x0 + w.x - T.w0.x
		T.y = T.y0 + w.y - T.w0.y
		this.#renderer.setNotePreview({ x: T.x, y: T.y, w: T.w, h: T.h, fill: T.fill })
		this.#wake()
	}

	/**
	 * @param {boolean} commit the release: the intent takeNote with the note's top-left corner; false (Esc, a
	 *   second finger, pointercancel, a mode switch, reset, the pad gone): nothing
	 */
	#endTake(commit) {
		const T = this.#take
		if (T === null) return
		this.#take = null
		this.#renderer.setNotePreview(null)
		this.#applyCursorStyle()
		this.#wake()
		if (commit && this.#model.has(T.id)) this.#call('onIntent', { type: 'takeNote', id: T.id, at: { x: T.x, y: T.y } })
	}

	// ---------------------------------------------------------------- internals: mind maps (job 195)

	/**
	 * @param {string} id mind map id
	 * @return {object|null} its stored layout as drawn (measured texts, no preview), null for anything else
	 */
	#storedLayoutOf(id) {
		const it = this.#model.get(id)
		if (!it || it.t !== 'mindmap') return null
		let l = this.#mmLayouts.get(it)
		if (!l) {
			l = mindmapLayout(it, (text, maxW, size, bold) => this.measureNodeText(text, maxW, size, bold))
			this.#mmLayouts.set(it, l)
		}
		return l
	}

	/**
	 * @param {string} id mind map id
	 * @return {object|null} its layout as drawn (measured texts, the text of the open node editor included,
	 *   anchored at the root), null for anything but a mind map
	 */
	#mindmapLayoutOf(id) {
		const it = this.#model.get(id)
		if (!it || it.t !== 'mindmap') return null
		const pv = this.#structure.preview
		const p = pv !== null && pv.id === id && (typeof pv.key === 'string' || typeof pv.drag === 'string') ? pv : null
		if (p !== null) return mindmapLayout(previewMindmap(it, p), (text, maxW, size, bold) => this.measureNodeText(text, maxW, size, bold))
		return this.#storedLayoutOf(id)
	}

	/** @return {object[]} stats().mindmaps */
	#mindmapStats() {
		const out = []
		for (const id of this.#model.ids()) {
			const it = this.#model.get(id)
			if (it?.t !== 'mindmap') continue
			const l = this.#mindmapLayoutOf(id)
			const a = this.#model.abs(id)
			const tree = mindTree(it)
			const nodes = []
			for (const [key, e] of tree.nodes) {
				const n = l?.byKey.get(key) ?? null
				nodes.push({
					key, parent: e.parent, depth: e.depth, side: n ? n.side : null,
					x: n && a ? a.x + n.x : null, y: n && a ? a.y + n.y : null, w: n ? n.w : null, h: n ? n.h : null,
					folded: e.n.f === true && e.kids.length > 0 && e.parent !== null, hidden: n === null, color: n ? n.color : null,
					shape: n ? n.shape : drawnShape(e.n, e.parent === null, tree.layout, e.depth), text: nodeText(it.data, key),
					dot: n?.dot && a ? { x: a.x + n.dot.x, y: a.y + n.dot.y } : null, free: n?.free === true,
					name: n?.name ?? null, role: n?.role ?? null,
				})
			}
			out.push({ id, layout: tree.layout, focus: this.#mmFocus?.id === id ? this.#mmFocus.key : null, nodes })
		}
		return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
	}

	/**
	 * @param {string} id mind map id
	 * @param {{x:number, y:number}} w world point
	 * @param {number} [tolPx] tolerance in screen px
	 * @return {{key: string, part: ('node'|'dot')}|null} the node or fold dot there (model/mindmap.js nodeAtLayout)
	 */
	#mindmapPart(id, w, tolPx = HIT_TOL_MOUSE_PX) {
		const a = this.#model.abs(id)
		const l = this.#mindmapLayoutOf(id)
		if (!a || !l || !w) return null
		return nodeAtLayout(l, w.x - a.x, w.y - a.y, tolPx / this.#liveCam().scale)
	}

	/**
	 * @param {string} id item a double click, Enter or F2 opens
	 * @param {{x:number, y:number}|undefined} w the world point of a double click
	 * @return {object} the options of openTextEditor: (job 173) the cell of a table under w, (job 195) the node of a
	 *   mind map under w (else its focus or root)
	 */
	#editTarget(id, w) {
		const t = this.#model.get(id)?.t
		if (w && t === 'table') return { cell: this.#structure.cellAt(id, w) ?? undefined }
		if (t === 'mindmap') return { cell: (w ? this.#mindmapPart(id, w)?.key : null) ?? null }
		// (job 199) the head of a lane: its name (job 208: of a column, too); elsewhere the frame's title
		const head = t === 'frame' ? this.#structure.headAt(id, w) : null
		// (job 225) a group's cell: the group's name
		if (head !== null) return { cell: head.lgroup ?? head.cgroup ?? head.lane ?? head.col }
		return {}
	}

	/**
	 * The "+" of the focused node (header), never on a node (job 195 round 2): a child's beyond its outer
	 * edge, off beyond it (and its dot) when no child shows on that side, else in the middle of the free gap
	 * between the dot and the children; a sibling's in the gap on its inner side, just below it (only branch
	 * lines run there); at the root right (mm-child-r) and with layout both left (mm-child-l). (Job 266) Beyond a
	 * folded node's "+n" badge, and moved off every node's text and badge (model/mindmap.js clearPlus): the
	 * child's outwards (org: down), the sibling's inwards (org: up).
	 *
	 * @param {string} id the one selected mind map
	 * @param {number} scale camera scale
	 * @return {Array<{name: string, x: number, y: number}>}
	 */
	#mindmapHandles(id, scale) {
		const f = this.#mmFocus
		const a = this.#model.abs(id)
		const l = f !== null && f.id === id && a ? this.#mindmapLayoutOf(id) : null
		const n = l ? l.byKey.get(f.key) : null
		if (!n) return []
		const off = plusOffset(scale)
		const y = a.y + n.y + n.h / 2
		// (job 266) beyond the "+n" badge of a folded node instead of its dot
		const dotW = n.badge ? MM_BADGE_GAP + n.badge.w : 2 * MM_DOT_R + 2
		// (job 266) off any node's text and any badge: the child's outwards (org: down), the sibling's inwards (org: up)
		const r = (STRUCT_PLUS_PX / 2 + 2) / (Number.isFinite(scale) && scale > 0 ? scale : 1)
		const clear = (list, dirs) => list.map((p) => {
			const [dx, dy] = dirs[p.name]
			const q = clearPlus(l, p.x - a.x, p.y - a.y, dx, dy, r)
			return { name: p.name, x: a.x + q.x, y: a.y + q.y }
		})
		if (l.layout === 'org') {
			// job 198: the child's below the card (in the gap between its dot and the row of its children); the
			// sibling's (round 1) in the gap above the card's top right corner, between it and the next card of its
			// row, below the line from the parent: only lines run there, never a card or a dot (the next card of a
			// row may be MM_ORG_GAP_X away)
			const bottom = n.y + n.h
			const kid = n.folded ? null : l.nodes.find((k) => k.parent === n.key)
			const d = n.badge ? MM_BADGE_ORG_GAP + MM_BADGE_H : n.dot ? 2 * MM_DOT_R + 2 : 0
			const below = a.y + (kid ? (bottom + d + kid.y) / 2 : bottom + d + off)
			const cx = a.x + n.x + n.w / 2
			const down = { 'mm-child': [0, 1], 'mm-child-r': [0, 1], 'mm-sibling': [0, -1] }
			if (n.parent === null) return clear([{ name: 'mm-child-r', x: cx, y: below }], down)
			return clear([
				{ name: 'mm-child', x: cx, y: below },
				{ name: 'mm-sibling', x: a.x + n.x + n.w + MM_ORG_GAP_X / 2, y: a.y + n.y - MM_ORG_GAP_Y / 4 },
			], down)
		}
		// beyond the outer edge x on side s: free at any distance without children there, else only up to them
		const childX = (x, s, kids, dot) => {
			const d = dot ? dotW : 0
			return a.x + x + s * (kids ? d + (MM_GAP_X - d) / 2 : off + d)
		}
		if (n.parent === null) {
			const kidsOn = (s) => l.nodes.some((k) => k.parent === n.key && k.side === s)
			const out = [{ name: 'mm-child-r', x: childX(n.x + n.w, 1, kidsOn(1), false), y }]
			if (l.layout === 'both') out.push({ name: 'mm-child-l', x: childX(n.x, -1, kidsOn(-1), false), y })
			return clear(out, { 'mm-child-r': [1, 0], 'mm-child-l': [-1, 0] })
		}
		const s = n.side > 0 ? 1 : -1
		const sibW = 2 * MM_DOT_R + 2
		return clear([
			{ name: 'mm-child', x: childX(s > 0 ? n.x + n.w : n.x, s, n.kids > 0 && !n.folded, !!n.dot), y },
			{ name: 'mm-sibling', x: a.x + (s > 0 ? n.x : n.x + n.w) - s * (MM_GAP_X - sibW) / 2, y: a.y + n.y + n.h + MM_GAP_Y / 2 },
		], { 'mm-child': [s, 0], 'mm-sibling': [-s, 0] })
	}

	/**
	 * The focus (header): a node of the one selected mind map, only in mode edit.
	 *
	 * @param {string|null} id mind map id
	 * @param {string|null} key node key (null: no focus)
	 * @return {boolean} it changed
	 */
	#setFocus(id, key) {
		const it = typeof id === 'string' ? this.#model.get(id) : null
		const sel = this.#selection.values()
		const ok = !this.#viewOnly && it?.t === 'mindmap' && typeof key === 'string' && sel.length === 1 && sel[0] === id
		const shown = ok ? visibleAncestor(it, key) : null
		const prev = this.#mmFocus
		if (shown === null ? prev === null : prev !== null && prev.id === id && prev.key === shown) return false
		this.#mmFocus = shown === null ? null : { id, key: shown, item: it }
		this.#handlesDirty = true
		this.#call('onNodeFocus', shown === null ? null : id, shown)
		this.#syncMindmapUi()
		this.#wake()
		return true
	}

	/**
	 * An arrow key at the focus (model/mindmap.js stepFocus).
	 *
	 * @param {'left'|'right'|'up'|'down'} dir arrow
	 * @return {boolean} the focus moved
	 */
	#stepFocus(dir) {
		const f = this.#mmFocus
		const it = f ? this.#model.get(f.id) : null
		const next = it ? stepFocus(it, f.key, dir) : null
		return next !== null && this.#setFocus(f.id, next)
	}

	/**
	 * The focus checked against the selection and the model (header), then
	 * what the renderer shows on each mind map: the focus outline, the hollow
	 * dots of a selected map, the hovered node; only changes go out.
	 */
	#syncMindmapUi() {
		if (!this.#mounted || this.#destroyed) return
		const sel = this.#selection.values()
		const f = this.#mmFocus
		if (f !== null) {
			const it = this.#model.get(f.id)
			const alone = sel.length === 1 && sel[0] === f.id && it?.t === 'mindmap' && !this.#viewOnly
			if (!alone) {
				this.#mmFocus = null
				this.#handlesDirty = true
				this.#call('onNodeFocus', null, null)
			} else if (it !== f.item) {
				// the map changed: a node hidden by a fold gives its folded ancestor, a deleted one the root
				const key = visibleAncestor(it, f.key) ?? mindTree(it).root
				this.#mmFocus = key === null ? null : { id: f.id, key, item: it }
				if (key !== f.key) {
					this.#handlesDirty = true
					this.#call('onNodeFocus', key === null ? null : f.id, key)
				}
			}
		}
		const want = new Map()
		for (const id of sel) {
			if (this.#model.get(id)?.t === 'mindmap') want.set(id, { focus: null, hover: null, dots: true })
		}
		if (this.#mmFocus !== null && want.has(this.#mmFocus.id)) want.get(this.#mmFocus.id).focus = this.#mmFocus.key
		const hv = this.#mmHover
		if (hv !== null && this.#model.get(hv.id)?.t === 'mindmap') {
			const u = want.get(hv.id) ?? { focus: null, hover: null, dots: false }
			u.hover = hv.key
			want.set(hv.id, u)
		}
		for (const [id, ui] of want) {
			const k = JSON.stringify(ui)
			if (this.#mmUiSent.get(id) === k) continue
			this.#mmUiSent.set(id, k)
			this.#renderer.setMindmapUi(id, ui)
		}
		for (const id of [...this.#mmUiSent.keys()]) {
			if (want.has(id)) continue
			this.#mmUiSent.delete(id)
			this.#renderer.setMindmapUi(id, null)
		}
	}

	/**
	 * @param {string|null} id mind map under a hovering mouse or pen
	 * @param {string|null} key its node there (null: none)
	 */
	#setHoverNode(id, key) {
		const next = typeof id === 'string' && typeof key === 'string' ? { id, key } : null
		const prev = this.#mmHover
		if (next === null ? prev === null : prev !== null && prev.id === next.id && prev.key === next.key) return
		this.#mmHover = next
		this.#syncMindmapUi()
		this.#wake()
	}

	/**
	 * A press on a node moved beyond its threshold: its ghost follows the
	 * pointer, the drop target is marked. Nothing goes to the others.
	 *
	 * @param {string} id mind map
	 * @param {string} key the node (never the root)
	 * @param {{x:number, y:number}} w world point of the press
	 * @return {boolean} the drag runs (mode edit, the select tool, an unlocked mind map)
	 */
	#beginNodeDrag(id, key, w) {
		if (this.#viewOnly || this.#tool !== 'select' || this.#nodeDrag !== null) return false
		const it = this.#model.get(id)
		const a = this.#model.abs(id)
		const n = it?.t === 'mindmap' && !isLocked(it) && a ? this.#mindmapLayoutOf(id)?.byKey.get(key) : null
		if (!n || n.parent === null) return false
		this.#nodeDrag = { id, key, w0: { x: w.x, y: w.y }, x0: a.x + n.x, y0: a.y + n.y, w: n.w, h: n.h, target: null }
		this.#moveNodeDrag(w)
		return true
	}

	/** @param {{x:number, y:number}} w world point of the pointer */
	#moveNodeDrag(w) {
		const D = this.#nodeDrag
		if (D === null || !w) return
		const it = this.#model.get(D.id)
		const a = this.#model.abs(D.id)
		const stored = this.#storedLayoutOf(D.id)
		if (!it || !a || !stored) return
		const ghost = { x: D.x0 + w.x - D.w0.x, y: D.y0 + w.y - D.w0.y, w: D.w, h: D.h }
		// job 198: in org and tree nothing is placed freely: the map stays as it is drawn
		const boxes = isBoxLayout(stored.layout)
		D.place = boxes ? null : { x: ghost.x + ghost.w / 2, y: ghost.y + ghost.h / 2 }
		// job 196: the map as if dropped here (the dragged branch is no obstacle, the root keeps its place)
		const r = boxes ? {} : placeNode(it, D.key, { x: D.place.x - a.x, y: D.place.y - a.y }, (text, maxW, size, bold) => this.measureNodeText(text, maxW, size, bold), stored)
		const patch = r.p ?? (Array.isArray(r.patches) ? Object.assign({}, ...r.patches) : null)
		const root = stored.byKey.get(stored.root)
		this.#structure.setPreview(patch !== null && root ? { id: D.id, drag: D.key, patch, ghost: D.key, anchor: { x: root.x, y: root.y } } : null)
		const l = this.#mindmapLayoutOf(D.id)
		D.target = l ? dropTarget(it, l, D.key, w.x - a.x, w.y - a.y, HIT_TOL_MOUSE_PX / this.#liveCam().scale) : null
		const t = D.target !== null ? l.byKey.get(D.target.key) : null
		this.#renderer.setNodeDragPreview({
			ghost,
			// job 198 round 6: in org before and after lie left and right of the card
			target: t ? { x: a.x + t.x, y: a.y + t.y, w: t.w, h: t.h, where: D.target.where, beside: l.layout === 'org' } : null,
		})
		this.#wake()
	}

	/** @param {boolean} commit released (the intent mmMove: onto the target, or job 196 placed freely); false: Esc, cancel */
	#endNodeDrag(commit) {
		const D = this.#nodeDrag
		if (D === null) return
		this.#nodeDrag = null
		this.#structure.clearPreview((p) => p.id === D.id && typeof p.drag === 'string')
		this.#renderer.setNodeDragPreview(null)
		this.#wake()
		if (!commit || !this.#model.has(D.id)) return
		if (D.target !== null) {
			this.#call('onIntent', { type: 'mmMove', id: D.id, key: D.key, target: { ...D.target } })
		} else if (D.place) {
			this.#call('onIntent', { type: 'mmMove', id: D.id, key: D.key, target: null, place: { ...D.place } })
		}
	}

	// ---------------------------------------------------------------- internals: context menu (step 4.2)

	/**
	 * Before an intent contextMenu (SPEC-M1 §9.5 WP-S4, step 4.2): no menu
	 * while a camera gesture of the user runs or may start (touch gesture,
	 * mouse/pen pan, a finger below the tap threshold). A wheel gesture or a
	 * follow glide ends first, as at a pointerdown or a camera key: the
	 * camera shown becomes the confirmed one (followTo resolves false, no
	 * onUserCamera), so hit, at and itemScreenRect agree with the picture.
	 *
	 * @return {boolean} true when the menu may open now
	 */
	#menuReady() {
		const g = this.#gestures
		if (g.mode === 'touch' || g.panning || g.pending) return false
		this.#endGestureNow()
		return true
	}

	/**
	 * Keyboard anchor of the context menu (step 4.2): the midpoint of the
	 * selection's axis-aligned screen box (model.boundsOf, confirmed camera,
	 * container px) after clamping its corners into the container, i.e. per
	 * axis the middle of its visible part, or the nearest edge when it lies
	 * outside on that axis; the container centre without a selection (or
	 * without bounds).
	 *
	 * @param {string[]} ids selection
	 * @return {[number, number]} at, container px
	 */
	#menuAnchor(ids) {
		const { w, h } = this.#size
		const b = ids.length > 0 ? this.#model.boundsOf(ids) : null
		if (!b) return [w / 2, h / 2]
		const c = this.#camera.get()
		const x0 = Math.min(w, Math.max(0, (b.x - c.x) * c.scale))
		const x1 = Math.min(w, Math.max(0, (b.x + b.w - c.x) * c.scale))
		const y0 = Math.min(h, Math.max(0, (b.y - c.y) * c.scale))
		const y1 = Math.min(h, Math.max(0, (b.y + b.h - c.y) * c.scale))
		return [(x0 + x1) / 2, (y0 + y1) / 2]
	}

	/**
	 * @param {EventTarget|null} target event target
	 * @return {boolean} true for controls in the overlay (editor, chip buttons)
	 */
	#isInteractive(target) {
		return !!this.#overlay && target !== this.#overlay && target instanceof Node && this.#overlay.contains(target)
	}

	/**
	 * (R38, SPEC-M1 §6.3) The hold signal of the touch marquee: a ring
	 * centred on sp in the overlay (aria-hidden, built anew each time so its
	 * fade-in runs again; place and size inline, the look in knorke.css
	 * .knorke-hold-ring) and one short vibration where the browser can.
	 * null removes the ring at once and vibrates nothing.
	 *
	 * @param {{x:number, y:number}|null} sp container px
	 */
	#holdSignal(sp) {
		this.#holdRing?.el.remove()
		this.#holdRing = null
		if (sp === null || !this.#overlay || this.#destroyed) return
		const el = document.createElement('div')
		el.className = 'knorke-hold-ring'
		el.setAttribute('data-knorke-hold-ring', '')
		el.setAttribute('aria-hidden', 'true')
		setStyles(el, {
			left: `${sp.x - HOLD_RING_PX / 2}px`, top: `${sp.y - HOLD_RING_PX / 2}px`,
			width: `${HOLD_RING_PX}px`, height: `${HOLD_RING_PX}px`,
		})
		this.#overlay.appendChild(el)
		this.#holdRing = { el, x: sp.x, y: sp.y }
		vibrate(LONG_PRESS_VIBRATE_MS)
	}

	#selectionChanged(emit) {
		// (job 190) a change of the selection ends the offer of locked items (onSelection reports it)
		this.#lockedOffer = null
		this.#renderSelection()
		this.#handlesDirty = true
		if (emit) this.#call('onSelection', this.#selection.values())
		this.#wake()
	}

	/**
	 * (job 190) Sets or ends the offer of locked items: only in mode edit (not
	 * while "New comment" picks), ids without doubles; null or [] ends it.
	 *
	 * @param {string[]|null} ids offered ids
	 * @param {boolean} echo report a change with onLockedOffer (the scene's own input)
	 * @return {boolean} the offer changed
	 */
	#setOffer(ids, echo) {
		const next = this.#mode === 'edit' && !this.#pick && Array.isArray(ids) && ids.length > 0 ? [...new Set(ids)] : null
		const prev = this.#lockedOffer
		if (next === null ? prev === null : prev !== null && prev.length === next.length && prev.every((id, i) => id === next[i])) return false
		this.#lockedOffer = next
		this.#wake()
		if (echo) this.#call('onLockedOffer', next === null ? [] : [...next])
		return true
	}

	/** @return {string[]} (job 190) the offered ids that still exist and are locked (the box without a selection) */
	#offerIds() {
		return this.#lockedOffer === null ? [] : this.#lockedOffer.filter((id) => isLocked(this.#model.get(id)))
	}

	#renderSelection() {
		if (!this.#mounted || this.#destroyed) return
		// above TRANSFORM_LIVE_MAX the outlines would stay behind the activeGroup preview: hide them meanwhile
		const local = this.#xf.active && !this.#xf.live ? [] : this.#selection.values()
		// one outline per fully selected group instead of its members' own (M2, R20)
		const groups = wholeGroups(this.#model, local).map((g) => this.#model.membersOf(g))
		const grouped = new Set(groups.flat())
		// (job 150) the item of the open text editor shows only its text and the caret: no outline of
		// its own, none of its group; others' selections of it stay
		const editing = this.#editor?.id ?? null
		this.#renderer.setSelection(
			local.filter((id) => !grouped.has(id) && id !== editing),
			this.#remoteSel,
			editing === null ? groups : groups.filter((g) => !g.includes(editing)),
		)
		this.#syncMindmapUi()
	}

	/**
	 * Once per frame (factory job 137): the selection box for the shell's
	 * context bar (SceneCallbacks onSelectionBox), reported only when it
	 * changed. null without a selection and while something moves; then
	 * nothing is computed. Runs after #syncHandles, so the handles are those
	 * of this frame. (job 140) box is the hull of the drawn selection frames
	 * (gapFrame of each box, rotated with it; a connector counts with its
	 * route box), a frame still reaches up over its title band, (job 193) a
	 * note pad down over its band, (job 211) a symbol, BPMN event or gateway
	 * over its label (its index box). (job 190)
	 * Without a selection the same over the offered locked items.
	 */
	#syncSelectionBox() {
		let next = null
		const moving = this.#drag !== null || this.#xf.active || this.#cc.active || this.#live !== null || this.#gestures?.panning === true
		let ids = moving ? [] : this.#selection.values()
		if (!moving && ids.length === 0) ids = this.#offerIds()
		const c = this.#camera.get()
		let x0 = Infinity
		let y0 = Infinity
		let x1 = -Infinity
		let y1 = -Infinity
		for (const id of ids) {
			const b = this.#model.boundsOf([id])
			if (!b) continue
			const info = typeInfo(this.#model.get(id).t)
			// a frame with its title band above the top edge; (job 193) a note pad with what lies below its
			// box (job 263: its sheets, padExtent), so a bar below it never covers the pad
			const band = info.editor === 'title' ? FRAME_TITLE_BAND : 0
			const pa = info.editor === 'padTitle' ? this.#model.abs(id) : null
			const below = pa ? pa.y + padExtent(pa.w, pa.h).h : -Infinity
			// (job 172) the one selected note with the band of its reaction row
			const f = info.placement === 'none' ? null : gapFrame(this.#model.abs(id), c.scale, { below: ids.length === 1 ? this.#reactBandOf(id, c.scale) : 0 })
			const [fx0, fy0, fx1, fy1] = f ? rotatedBBox(f.x, f.y, f.w, f.h, f.r) : [b.x, b.y, b.x + b.w, b.y + b.h]
			x0 = Math.min(x0, fx0)
			y0 = Math.min(y0, fy0, b.y - band)
			x1 = Math.max(x1, fx1)
			y1 = Math.max(y1, fy1, below)
			// (job 211) a label below a symbol, BPMN event or gateway (turned with it): its index box holds it;
			// while its editor is open, the editor's box (the typed text is not in the model yet)
			const it = this.#model.get(id)
			const e = shapeLabelOf(it, this.#model.abs(id)) ? this.#model.bboxOf(id) : null
			if (e) {
				x0 = Math.min(x0, e.minX)
				y0 = Math.min(y0, e.minY)
				x1 = Math.max(x1, e.maxX)
				y1 = Math.max(y1, e.maxY)
			}
			if (this.#editor?.id === id && this.#editor.kind === 'shape' && hasLabel(fieldValue(it, 'data.kind'))) {
				const a = this.#model.abs(id)
				const l = labelEditorBox(it, a, this.#editor.value)
				const [ex0, ey0, ex1, ey1] = rotatedBBox(l.cx - l.w / 2, l.cy - l.h / 2, l.w, l.h, a.r || 0)
				x0 = Math.min(x0, ex0)
				y0 = Math.min(y0, ey0)
				x1 = Math.max(x1, ex1)
				y1 = Math.max(y1, ey1)
			}
		}
		if (x0 !== Infinity) {
			const box = [(x0 - c.x) * c.scale, (y0 - c.y) * c.scale, (x1 - c.x) * c.scale, (y1 - c.y) * c.scale]
			const keep = box.slice()
			// the handles drawn now (the list handles() gives), each with its touch radius
			for (const h of this.#handleState?.list ?? []) {
				const hx = (h.x - c.x) * c.scale
				const hy = (h.y - c.y) * c.scale
				keep[0] = Math.min(keep[0], hx - HANDLE_TOUCH_PX)
				keep[1] = Math.min(keep[1], hy - HANDLE_TOUCH_PX)
				keep[2] = Math.max(keep[2], hx + HANDLE_TOUCH_PX)
				keep[3] = Math.max(keep[3], hy + HANDLE_TOUCH_PX)
			}
			const px = (r) => {
				const [x, y, xr, yb] = r.map((v) => Math.round(v))
				return { x, y, w: xr - x, h: yb - y }
			}
			next = { box: px(box), keep: px(keep) }
		}
		const last = this.#selBox
		const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
		if (next === null ? last === null : last !== null && same(next.box, last.box) && same(next.keep, last.keep)) return
		this.#selBox = next
		this.#call('onSelectionBox', next === null ? null : { box: { ...next.box }, keep: { ...next.keep } })
	}

	// ---------------------------------------------------------------- internals: keys

	/**
	 * Arrow keys (SPEC-M1 §6.3): move intent of the top-level selection by
	 * (dx, dy) world units with origin, marked nudge (the session merges a key
	 * series into one undo step).
	 *
	 * @param {number} dx world delta x
	 * @param {number} dy world delta y
	 */
	#nudge(dx, dy) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return
		// no locked item (M2, R20), no member of a group with a locked member
		const { top } = movedItems(this.#model, movableIds(this.#model, topLevel(this.#selection.values(), this.#model)))
		if (top.length === 0) return
		const origin = new Map()
		for (const id of top) {
			const it = this.#model.get(id)
			origin.set(id, { x: it.x, y: it.y, parent: it.parent })
		}
		this.#call('onIntent', { type: 'move', ids: top, dx, dy, origin, nudge: true })
	}

	/**
	 * Tab / Shift+Tab on the canvas (SPEC-M1 §6.3, WCAG 2.1.1/2.1.2): selects
	 * the next / previous item in reading order and pans it into view. (M2,
	 * R20) Like a click: an item of a group selects its members with the
	 * reached item last; when the current item belongs to a fully selected
	 * group, the step skips that group's other members.
	 *
	 * @param {1|-1} dir direction
	 * @return {boolean} false after the last (before the first) item or without
	 *   items: the key is not handled, Tab leaves the canvas
	 */
	#tabSelect(dir) {
		const model = this.#model
		const ids = [...model.ids()]
		if (ids.length === 0) return false
		const keys = new Map(ids.map((id) => [id, tabKey(model, id)]))
		ids.sort((a, b) => {
			const ka = keys.get(a)
			const kb = keys.get(b)
			for (let i = 0; i < 3; i++) {
				if (ka[i] !== kb[i]) return ka[i] - kb[i]
			}
			return model.compareOrder(a, b)
		})
		const sel = this.#selection.values()
		const curId = sel.length > 0 ? sel[sel.length - 1] : null
		const cur = curId !== null ? ids.indexOf(curId) : -1
		let next = cur < 0 ? (dir > 0 ? 0 : ids.length - 1) : cur + dir
		const g0 = cur < 0 ? null : groupOf(model, curId)
		if (g0 !== null && wholeGroups(model, sel).includes(g0)) {
			const skip = new Set(model.membersOf(g0))
			while (next >= 0 && next < ids.length && skip.has(ids[next])) next += dir
		}
		if (next < 0 || next >= ids.length) return false
		const id = ids[next]
		// like a click: the members of its group first, the reached item last
		this.#selection.set(expandGroups(model, [id]))
		this.#selectionChanged(true)
		this.#panIntoView(id)
		return true
	}

	/**
	 * Centres an item when its box is not fully in the viewport (user camera change).
	 *
	 * @param {string} id item id
	 * @return {boolean} the camera moved
	 */
	#panIntoView(id) {
		const r = this.itemScreenRect(id)
		if (!r) return false
		if (r.x >= 0 && r.y >= 0 && r.x + r.w <= this.#size.w && r.y + r.h <= this.#size.h) return false
		this.#endGestureNow()
		const c = this.#camera.get()
		const a = this.#model.boundsOf([id])
		this.#call('onUserCamera')
		this.#setCam({ x: a.x + a.w / 2 - this.#size.w / (2 * c.scale), y: a.y + a.h / 2 - this.#size.h / (2 * c.scale), scale: c.scale })
		return true
	}

	// ---------------------------------------------------------------- internals: drag

	/**
	 * (job 163) The frame R in which a press drags the whole own selection
	 * (InputController): gapFrame of the selection frame of its top-level
	 * items, the frame the four corner handles sit on, computed now. Only in
	 * mode edit with the select tool, without an open editor, a hanging
	 * connector or a running drag, transform or connect, for more than one
	 * top-level item, at least one of them no connector and at least one of
	 * them movable (movableIds).
	 *
	 * @return {{x:number, y:number, w:number, h:number, r:number, n:number}|null} world; null: none
	 */
	#dragFrame() {
		if (this.#viewOnly || this.#tool !== 'select' || (this.#editor !== null && this.#editor.id !== null) || this.#ccHang !== null ||
			this.#drag !== null || this.#xf.active || this.#cc.active) return null
		const top = topLevel(this.#selection.values(), this.#model)
		if (!top.some((id) => !isRouted(this.#model, id)) || movableIds(this.#model, top).length === 0) return null
		const frame = selectionFrame(this.#model, top)
		return frame !== null && (frame.n ?? 1) > 1 ? gapFrame(frame, this.#liveCam().scale) : null
	}

	/**
	 * @param {string[]} ids selection
	 * @param {string|null} primary item under the pointer
	 * @return {boolean} true when a drag started
	 */
	#beginDrag(ids, primary) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		// only the movable top-level items move (M2, R20: no locked item, no member of a group
		// with a locked member); their locked descendants follow them
		const { top, all } = movedItems(this.#model, movableIds(this.#model, topLevel(ids, this.#model)))
		if (top.length === 0) return false
		// attached connectors are re-routed in every frame in which the items moved: into the activeGroup with the items (G12)
		for (const c of this.#model.connectorsOf(all)) all.add(c)
		const origin = new Map()
		for (const id of top) {
			const it = this.#model.get(id)
			origin.set(id, { x: it.x, y: it.y, parent: it.parent })
		}
		let lead = primary
		for (let i = 0; lead && !top.includes(lead) && i < 8; i++) {
			lead = this.#model.get(lead)?.parent ?? null
		}
		// the lead (drop target) is a box: a connector has none
		const boxes = top.filter((id) => !isRouted(this.#model, id))
		if (!boxes.includes(lead)) lead = boxes[0] ?? null
		// (M2, R20) a lead in a group: the whole group's union decides when the group is fully
		// dragged (leadGroup = its members), a partly dragged one keeps its parent (false: no target)
		const g = lead !== null ? groupOf(this.#model, lead) : null
		const members = g !== null ? this.#model.membersOf(g) : null
		const dragged = new Set(top)
		const leadGroup = members === null ? null : (members.every((m) => dragged.has(m)) ? members : false)
		// snapping (M2, R12), once per drag: the dragged box (null for connectors only) and
		// the candidates in the live view, without everything that moves (all)
		const box0 = boxes.length > 0 ? this.#model.boundsOf(boxes) : null
		const snap = box0 !== null ? snapIndexOf(this.#model, viewRectOf(this.#liveCam(), this.#size.w, this.#size.h, 0), all) : null
		this.#drag = { top, all, origin, dx: 0, dy: 0, tx: 0, ty: 0, pending: false, lead, leadGroup, box0, snap, ctrl: false, guides: [], gaps: [], measures: [], labels: [] }
		this.#renderer.beginDrag(all)
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'drag', active: true, ids: [...all] })
		this.#wake()
		return true
	}

	#dragStep() {
		const d = this.#drag
		d.pending = false
		// the pointer's shift snaps to the candidates (lines and equal gaps), at OBJECT_SNAP_PX of the
		// live scale, and with the grid shown and gridSnap on to it where no item snaps; Ctrl/⌘ drags free
		const s = d.ctrl
			? { dx: d.tx, dy: d.ty, guides: [], gaps: [], gapLen: { x: null, y: null } }
			: snapMoveDetail(d.box0, d.tx, d.ty, d.snap, OBJECT_SNAP_PX / this.#liveCam().scale, this.#grid && this.#gridSnap ? gridSnapStep(this.#liveCam().scale) : 0)
		const ddx = s.dx - d.dx
		const ddy = s.dy - d.dy
		if (ddx !== 0 || ddy !== 0) {
			const geo = this.#model.moveLocal(d.top, ddx, ddy)
			d.dx = s.dx
			d.dy = s.dy
			this.#renderer.dragMoved(geo)
		}
		this.#showGuides(d, s.guides)
		this.#showGaps(d, s.gaps)
		const b = d.box0
		const box = b !== null ? { minX: b.x + s.dx, minY: b.y + s.dy, maxX: b.x + b.w + s.dx, maxY: b.y + b.h + s.dy } : null
		this.#showNumbers(d, d.snap, box, s.gapLen)
		const preview = []
		for (const id of d.top) {
			// a connector has no position of its own (rule 12): others see its result
			if (isRouted(this.#model, id)) continue
			const a = this.#model.abs(id)
			if (a) preview.push([id, r2(a.x), r2(a.y)])
		}
		this.#call('onDragPreview', preview)
		this.#renderer.setDropTarget(this.#dropTarget(d))
	}

	/**
	 * @param {object} d drag state
	 * @return {string|null} container under the centre of the lead item that accepts it; for a
	 *   lead in a fully dragged group under the centre of the members' union (actions.moveItems'
	 *   rule, M2 R20), none for a lead in a partly dragged group (it keeps its parent)
	 */
	#dropTarget(d) {
		if (d.lead === null || d.leadGroup === false) return null
		const it = this.#model.get(d.lead)
		const a = d.leadGroup ? this.#model.boundsOf(d.leadGroup) : this.#model.abs(d.lead)
		if (!it || !a || typeInfo(it.t).container) return null
		const c = this.#model.topContainerAt(a.x + a.w / 2, a.y + a.h / 2, d.all)
		return c !== null && canBeChildOf(it.t, this.#model.get(c).t) ? c : null
	}

	/**
	 * Hands the snap guides of this frame to the renderer, only when they changed.
	 *
	 * @param {object} d drag state or snap state of a transform (#xfSnap)
	 * @param {import('../model/snap.js').SnapGuide[]} guides guides ([] = none)
	 */
	#showGuides(d, guides) {
		if (sameGuides(d.guides, guides)) return
		d.guides = guides
		this.#renderer.setSnapGuides(guides)
	}

	/**
	 * Hands the gap markers of this frame to the renderer, only when they changed.
	 *
	 * @param {object} d drag state
	 * @param {import('../model/snap.js').GapMarker[]} gaps markers ([] = none)
	 */
	#showGaps(d, gaps) {
		if (sameGuides(d.gaps, gaps)) return
		d.gaps = gaps
		this.#renderer.setGapMarkers(gaps)
	}

	/**
	 * (job 194) The numbers of this frame's guides and gap markers (d.guides, d.gaps, set
	 * before): a measuring line per guide (guideMeasure) and a label per gap marker (the
	 * winning gap's length of its axis) and per measuring line, beside the middle of its line
	 * (below a horizontal one, right of a vertical one); handed to the renderer only when
	 * they changed.
	 *
	 * @param {object} d drag state or snap state of a transform (#xfSnap)
	 * @param {import('../model/snap.js').SnapIndex|null} index the candidates
	 * @param {import('../model/snap.js').SnapBox|null} box the snapped box or frame
	 * @param {{x:(number|null), y:(number|null)}} gapLen the winning gap's length per axis
	 */
	#showNumbers(d, index, box, gapLen) {
		const measures = []
		for (const g of d.guides) {
			const m = guideMeasure(index, g, box)
			if (m !== null) measures.push(m)
		}
		const at = (m, len) => (m.axis === 'x'
			? { text: distanceText(len), x: (m.from + m.to) / 2, y: m.at, place: 'below' }
			: { text: distanceText(len), x: m.at, y: (m.from + m.to) / 2, place: 'right' })
		const labels = [
			...d.gaps.map((m) => at(m, gapLen?.[m.axis] ?? m.to - m.from)),
			...measures.map((m) => at(m, m.to - m.from)),
		]
		if (!sameGuides(d.measures, measures)) {
			d.measures = measures
			this.#renderer.setMeasureLines(measures)
		}
		const same = d.labels.length === labels.length &&
			d.labels.every((l, i) => l.text === labels[i].text && l.x === labels[i].x && l.y === labels[i].y && l.place === labels[i].place)
		if (!same) {
			d.labels = labels
			this.#renderer.setSnapLabels(labels)
		}
	}

	/**
	 * @param {object} d drag state (or snap state of a transform) that ends: its guides go
	 *   (setSnapGuides(null)), then its gap markers (setGapMarkers(null)), (job 194) its measuring
	 *   lines (setMeasureLines(null)) and labels (setSnapLabels(null)), each only when there are any
	 */
	#clearGuides(d) {
		if (d.guides.length > 0) {
			d.guides = []
			this.#renderer.setSnapGuides(null)
		}
		if (d.gaps.length > 0) {
			d.gaps = []
			this.#renderer.setGapMarkers(null)
		}
		if (d.measures.length > 0) {
			d.measures = []
			this.#renderer.setMeasureLines(null)
		}
		if (d.labels.length > 0) {
			d.labels = []
			this.#renderer.setSnapLabels(null)
		}
	}

	/** @param {boolean} commit false = Esc (back to the start, no intent) */
	#endDrag(commit) {
		const d = this.#drag
		if (!d) return
		if (commit && d.pending) {
			this.#dragStep()
		}
		const conns = d.top.filter((id) => isRouted(this.#model, id))
		if (!commit) {
			let geo = new Set()
			for (const id of d.top) {
				const it = this.#model.get(id)
				const o = d.origin.get(id)
				if (!it || !o || conns.includes(id)) continue
				geo = new Set([...geo, ...this.#model.moveLocal([id], o.x - it.x, o.y - it.y)])
			}
			// dragged connectors: their free ends go back to the stored ones
			for (const c of this.#model.clearLocal(conns)) geo.add(c)
			this.#renderer.dragMoved(geo)
		}
		this.#clearGuides(d)
		this.#renderer.setDropTarget(null)
		this.#call('onDragPreview', [])
		if (commit && (d.dx !== 0 || d.dy !== 0) && d.top.length > 0) {
			this.#call('onIntent', { type: 'move', ids: d.top.slice(), dx: d.dx, dy: d.dy, origin: new Map(d.origin) })
		}
		this.#drag = null
		this.#renderer.endDrag()
		this.#renderSelection()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'drag', active: false, ids: [...d.all] })
		// the session applied the connectors' stored state in onActivity; whatever
		// is still local (no op came back) returns to the stored ends
		this.#settleLocal(conns)
		this.#wake()
	}

	/**
	 * Ends the local connector states (shifted free ends, end overrides)
	 * that the session did not replace with a stored state, and redraws them.
	 *
	 * @param {Iterable<string>} ids connectors
	 */
	#settleLocal(ids) {
		const geo = this.#model.clearLocal(ids)
		if (geo.size > 0) this.#renderer.dragMoved(geo)
	}

	/** Drops a drag without moving anything back and without an intent (model was reloaded). */
	#abortDrag() {
		const d = this.#drag
		if (!d) return
		this.#model.clearLocal(d.top.filter((id) => isRouted(this.#model, id)))
		this.#clearGuides(d)
		this.#drag = null
		this.#renderer.setDropTarget(null)
		this.#renderer.endDrag()
		this.#call('onDragPreview', [])
		this.#call('onActivity', { kind: 'drag', active: false, ids: [...d.all] })
	}

	// ---------------------------------------------------------------- internals: transformer

	/**
	 * @param {string[]} ids top-level selected ids
	 * @return {boolean} one of their groups has a locked member (heldGroup, asked once per group)
	 */
	#holdsGroup(ids) {
		const seen = new Set()
		for (const id of ids) {
			const g = groupOf(this.#model, id)
			if (g === null || seen.has(g)) continue
			seen.add(g)
			if (heldGroup(this.#model, g)) return true
		}
		return false
	}

	/**
	 * Handles shown now (world), recomputed for the selection, the tool, the
	 * mode and the camera scale; handed to the renderer (uiGroup). (job 140)
	 * The transformer handles sit on gapFrame() of the selection frame (the
	 * frame of the current step while a transform runs), the "+" handles
	 * plusOffset(scale) from their anchors; the dashed frame of a multi
	 * selection goes to the renderer as the bare union, the renderer adds
	 * the gap like for every other outline.
	 *
	 * @param {number} [scale] camera scale (default: the confirmed camera)
	 */
	#syncHandles(scale = this.#camera.get().scale) {
		this.#handlesDirty = false
		if (!this.#mounted || this.#destroyed) return
		// (R13 (c)) at LOD 2 a connector shows only its halo: no end and no "+" handles
		const coarse = this.#coarseAt(scale)
		this.#handleCoarse = coarse
		let st = null
		const sel = this.#selection.values()
		// (job 231) the connector tool: the four connection points of one selected note, shape or text item
		const cTop = this.#tool === 'connector' && !this.#viewOnly && !coarse && !this.#cc.active && this.#editor.id === null && sel.length > 0
			? topLevel(sel, this.#model)
			: []
		const cOne = cTop.length === 1 ? cTop[0] : null
		const cT = cOne !== null ? this.#model.get(cOne)?.t : undefined
		if (cOne !== null && isBindable(cT) && cT !== 'table' && !isRouted(this.#model, cOne)) {
			const frame = selectionFrame(this.#model, [cOne])
			if (frame) {
				const band = this.#reactBandOf(cOne, scale)
				const list = plusHandles(this.#model, cOne, pointOffset(scale), this.#plusBelow(cOne, band, scale)).map((h) => ({ name: h.name, x: h.x, y: h.y }))
				st = { list, frame, scale, outline: null, gf: gapFrame(frame, scale, { below: band }), item: cOne, all: true }
			}
		}
		// (job 148) an open text editor shows no handles (job 136 showed the "+" handles there);
		// (job 159) nor does a connector hanging from a "+"
		if (!this.#viewOnly && this.#tool === 'select' && this.#drag === null && this.#editor.id === null && this.#ccHang === null && sel.length > 0) {
			const top = this.#xf.active ? this.#xf.ids : topLevel(sel, this.#model)
			const one = top.length === 1 ? top[0] : null
			// a locked top-level item (M2, R20): no transformer and no end handles; with more than
			// one top-level item also an item of a group with a locked member (no resize as a whole)
			const locked = top.some((id) => isLocked(this.#model.get(id))) || (top.length > 1 && this.#holdsGroup(top))
			if (one !== null && isRouted(this.#model, one)) {
				// one connector: its end handles (drag = retarget, §6.3)
				const g = coarse || locked ? null : this.#model.geometryOf(one)
				const list = g ? [{ name: 'start', x: g.start.x, y: g.start.y }, { name: 'end', x: g.end.x, y: g.end.y }] : []
				st = list.length > 0 ? { list, frame: null, scale, outline: null, gf: null, connector: one } : null
			} else if (top.some((id) => !isRouted(this.#model, id))) {
				const frame = this.#xf.active ? this.#xf.frame : selectionFrame(this.#model, top)
				if (frame) {
					const types = new Set(top.filter((id) => !isRouted(this.#model, id)).map((id) => this.#model.get(id)?.t).filter((t) => t !== undefined))
					// (job 140) the handles on the drawn frame, SELECTION_GAP_PX outside the boxes;
					// (job 172) the frame of one selected note reaches the band of its reaction row
					const band = one !== null ? this.#reactBandOf(one, scale) : 0
					const gf = gapFrame(frame, scale, { below: band })
					const list = locked ? [] : handlesFor(gf, types, scale)
					// one note, shape or text item, locked too: the four "+" handles (drag = connect, §6.3);
					// (job 173) never on a table; (job 211) the bottom one below a label (#plusBelow);
					// (job 231) on the drawn frame, and a text item's sides l/r take the place of plus-l/plus-r
					const oneT = one !== null ? this.#model.get(one)?.t : undefined
					if (one !== null && !coarse && !this.#xf.active && !this.#cc.active && isBindable(oneT) && oneT !== 'table') {
						const sides = list.some((h) => h.name === 'l' || h.name === 'r')
						for (const h of plusHandles(this.#model, one, pointOffset(scale), this.#plusBelow(one, band, scale))) {
							if (sides && (h.name === 'plus-l' || h.name === 'plus-r')) continue
							list.push({ name: h.name, x: h.x, y: h.y })
						}
					}
					// (job 173) one unlocked table: its "+" for a new column (right middle) and a new row (bottom middle)
					if (oneT === 'table' && !locked && !coarse && !this.#xf.active && !this.#cc.active) {
						const a = this.#model.abs(one)
						const off = plusOffset(scale)
						list.push({ name: 'table-col', x: a.x + a.w + off, y: a.y + a.h / 2 }, { name: 'table-row', x: a.x + a.w / 2, y: a.y + a.h + off })
					}
					// (job 199) one unlocked frame with lanes: its "+" for a new lane at the end (bottom middle)
					if (oneT === 'frame' && !locked && !coarse && !this.#xf.active && !this.#cc.active && hasLanes(this.#model.get(one))) {
						const a = this.#model.abs(one)
						list.push({ name: 'lane-add', x: a.x + a.w / 2, y: a.y + a.h + plusOffset(scale) })
						// (job 208) with columns: its "+" for a new column at the end (right middle)
						if (hasCols(this.#model.get(one))) list.push({ name: 'col-add', x: a.x + a.w + plusOffset(scale), y: a.y + a.h / 2 })
					}
					// (job 195) one unlocked mind map with a focus: the "+" of the focused node
					if (oneT === 'mindmap' && !locked && !coarse && !this.#xf.active && !this.#cc.active) {
						list.push(...this.#mindmapHandles(one, scale))
					}
					if (list.length > 0 || (frame.n ?? 1) > 1) {
						// exactly one group (M2, R20): its own outline, no dashed frame of the multi-selection
						const dashed = (frame.n ?? 1) > 1 && !isOneGroup(this.#model, sel)
						st = { list, frame, scale, outline: dashed ? { x: frame.x, y: frame.y, w: frame.w, h: frame.h } : null, gf, item: one }
					}
				}
			}
		}
		this.#handleState = st
		this.#pushHandles(true)
		if (this.#hoverHandle !== null && !st?.list.some((h) => h.name === this.#hoverHandle)) {
			this.#hoverHandle = null
			this.#applyCursorStyle()
		}
		this.#syncTitleHint(coarse)
		this.#syncSizeLabel(scale)
		this.#syncPlusPreview()
	}

	/**
	 * (job 231) The handles of #handleState the renderer draws (shownHandles at the last hover point
	 * and the confirmed camera, all of them with a pen or a finger or the connector tool); it hears
	 * of the hover only when that changes what is drawn.
	 *
	 * @param {boolean} [force] hand the handles over even when the drawn names and the look stay
	 */
	#pushHandles(force = false) {
		if (!this.#mounted || this.#destroyed) return
		const st = this.#handleState
		const touch = this.#touchLook
		let names = new Set()
		if (st) {
			if (st.all) {
				names = new Set(st.list.map((h) => h.name))
			} else {
				const c = this.#camera.get()
				// a resize shows no rotation handle; a rotation keeps it (rotating)
				const sp = this.#xf.active ? null : this.#hoverSp
				const at = sp ? { x: sp.x / c.scale + c.x, y: sp.y / c.scale + c.y } : null
				names = shownHandles(st.list, st.gf, at, st.scale, { touch, rotating: this.#xf.active && this.#xf.anchor === 'rot' })
			}
		}
		const was = this.#shown
		if (!force && was.touch === touch && was.names.size === names.size && [...names].every((n) => was.names.has(n))) return
		this.#shown = { names, touch }
		this.#renderer.setHandles(st ? { handles: st.list.filter((h) => names.has(h.name)), outline: st.outline, touch } : null)
		if (!force) this.#wake()
	}

	/**
	 * (job 231) The look of the handles after a pointerdown or a hover: a pen or a finger shows every
	 * handle at the touch size, the mouse only what is near.
	 *
	 * @param {unknown} type pointerType
	 */
	#setLook(type) {
		if (type !== 'mouse' && type !== 'pen' && type !== 'touch') return
		const touch = type !== 'mouse'
		if (touch === this.#touchLook) return
		this.#touchLook = touch
		this.#pushHandles()
	}

	/**
	 * (job 194) The size label of a running resize (header): while a transform with a
	 * resize handle runs (not 'rot'), "W × H" of the transformer frame (one item: its own
	 * size, rotated too; several or a group: their common frame), anchored at the bottom
	 * right corner of the drawn frame (gapFrame as the handles; a rotated one: its
	 * axis-parallel hull); also while Ctrl/⌘ resizes free. The renderer hears only of changes.
	 *
	 * @param {number} [scale] camera scale (default: the confirmed camera)
	 */
	#syncSizeLabel(scale = this.#camera.get().scale) {
		let next = null
		if (this.#mounted && !this.#destroyed && this.#xf.active && this.#xf.anchor !== 'rot') {
			const f = this.#xf.frame
			const ids = this.#xf.ids
			const gf = gapFrame(f, scale, { below: ids.length === 1 ? this.#reactBandOf(ids[0], scale) : 0 })
			const [, , x1, y1] = rotatedBBox(gf.x, gf.y, gf.w, gf.h, gf.r || 0)
			next = { text: sizeText(f.w, f.h), x: x1, y: y1 }
		}
		const cur = this.#sizeLabel
		if (cur === next || (cur !== null && next !== null && cur.text === next.text && cur.x === next.x && cur.y === next.y)) return
		this.#sizeLabel = next
		if (this.#mounted && !this.#destroyed) this.#renderer.setSizeLabel(next)
	}

	/**
	 * (job 162) The mouse preview of the hovered "+" (header): plusPlan for
	 * the item of the "+" handles and the side of the hovered one, while a
	 * mouse hovers it in mode edit with the select tool, no connector hangs or
	 * is dragged, no editor is open and that "+" is shown; the renderer
	 * hears only of changes.
	 */
	#syncPlusPreview() {
		if (!this.#mounted || this.#destroyed) return
		const st = this.#handleState
		const name = this.#hoverHandle
		const id = st?.item ?? null
		const on = typeof name === 'string' && Object.prototype.hasOwnProperty.call(PLUS_SIDE_OF, name) && this.#hoverType === 'mouse' &&
			id !== null && this.#mode === 'edit' && this.#tool === 'select' && this.#ccHang === null && !this.#cc.active &&
			this.#editor.id === null && st.list.some((h) => h.name === name)
		const plan = on ? plusPlan(this.#model, { id, side: PLUS_SIDE_OF[name] }) : null
		let next = null
		if (plan?.kind === 'connect') {
			const box = this.#model.abs(plan.target)
			if (box) next = { kind: 'connect', id: plan.target, box }
		} else if (plan?.kind === 'neighbour' && plan.box) {
			next = { kind: 'neighbour', box: plan.box }
		}
		const was = this.#plusPreview
		const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && (a.r || 0) === (b.r || 0)
		if (next === null ? was === null : was !== null && was.kind === next.kind && was.id === next.id && same(was.box, next.box)) return
		this.#plusPreview = next
		this.#renderer.setPlusPreview(next ? { kind: next.kind, box: { ...next.box } } : null)
		this.#wake()
	}

	/** @return {{kind:'connect', id:string}|{kind:'neighbour', box:Box}|null} (job 162) stats().plusPreview */
	#plusPreviewStat() {
		const p = this.#plusPreview
		if (p === null || !this.#mounted || this.#destroyed) return null
		return p.kind === 'connect' ? { kind: 'connect', id: p.id } : { kind: 'neighbour', box: { ...p.box } }
	}

	/**
	 * (job 143) The "Add title…" hint follows the selection, the mode, the
	 * frame's title and lock, its editor, a local drag or transform and LOD 2
	 * (with the handles, header); the renderer hears only of changes.
	 *
	 * @param {boolean} coarse the level is LOD 2
	 */
	#syncTitleHint(coarse) {
		const sel = this.#selection.values()
		const it = sel.length === 1 ? this.#model.get(sel[0]) : null
		const show = !!it && !coarse && !this.#viewOnly && typeInfo(it.t).editor === 'title' && !isLocked(it) &&
			String(fieldValue(it, 'data.title') ?? '').trim() === '' && this.#editor.id !== it.id &&
			this.#drag === null && !this.#xf.active
		const next = show ? it.id : null
		if (next === this.#titleHint) return
		this.#titleHint = next
		this.#renderer.setTitleHint(next)
	}

	/**
	 * (job 158) The width of the text frame id shows in its title band, for
	 * the second click on its title (InputController's text zone), measured
	 * on every call (no cache: a title that arrives by sync counts at once):
	 * at LOD 0/1 its title in one line of the title font, or "Add title…"
	 * while that hint is drawn, (job 243) as the width of the tab it stands
	 * in (frameTabWidth), at most the frame's width; at LOD 2 the
	 * width of its title as the last painting drew it (shortened).
	 *
	 * @param {string} id frame id
	 * @return {number|null} world units; null: no text there (no title and no hint, a title LOD 2 did not paint)
	 */
	#titleTextWidth(id) {
		const it = this.#model.get(id)
		const a = this.#model.abs(id)
		if (!it || !a || !this.#mounted || this.#destroyed) return null
		const title = String(fieldValue(it, 'data.title') ?? '')
		const titled = title.trim() !== ''
		let w = null
		if (this.#coarseNow()) w = titled ? this.#renderer.coarseTitleWidth(id) : null
		else if (titled) w = frameTabWidth(this.#renderer.measureTitleWidth(title), a.w)
		else if (this.#titleHint === id) w = frameTabWidth(this.#renderer.measureTitleWidth(titleHintText(), FRAME_TITLE_HINT_WEIGHT), a.w)
		return typeof w === 'number' && Number.isFinite(w) ? Math.min(Math.max(w, 0), a.w) : null
	}

	/**
	 * (job 177) The block of the text lines shape id draws now, for the hit of
	 * a press on its text (InputController, SceneModel.hitTest textRect):
	 * only a shape without fill (isUnfilledShape) at LOD 0 (LOD 1 paints no
	 * shape text) whose text is not blank; measured on every call with the
	 * renderer's text layout (no cache: a text that arrives by sync counts at
	 * once).
	 *
	 * @param {string} id item id
	 * @return {{x:number, y:number, w:number, h:number}|null} in the shape's own coordinates
	 *   (origin top-left of its unrotated box); null without such a text
	 */
	#shapeTextRect(id) {
		const it = this.#model.get(id)
		const a = this.#model.abs(id)
		if (!it || !a || !isUnfilledShape(it) || !this.#mounted || this.#destroyed || this.#renderer.lodLevel() !== 0) return null
		// (job 211) a label below the box hits through the model (SceneModel shapeLabelOf)
		if (hasLabel(fieldValue(it, 'data.kind')) || String(fieldValue(it, 'data.text') ?? '').trim() === '') return null
		return shapeTextBlock(shapeTextBox(it, a), this.#renderer.measureShapeLines(it, a))
	}

	/** @return {boolean} the renderer draws LOD 2 now (a finger's press and mode vote skip connectors, R13 (c)) */
	#coarseNow() {
		return this.#mounted && !this.#destroyed && this.#renderer.lodLevel() === 2
	}

	/**
	 * @param {number} scale camera scale
	 * @return {boolean} a camera with this scale is drawn at LOD 2 (handles are
	 *   placed for the camera about to be applied)
	 */
	#coarseAt(scale) {
		return this.#mounted && !this.#destroyed && this.#renderer.lodAt(scale) === 2
	}

	/**
	 * Screen-space handle test before the model hit test (SPEC-M1 §6.3).
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {boolean} coarse touch or pen (HANDLE_TOUCH_PX), else HANDLE_PX
	 * @return {string|null} handle name
	 */
	#handleAt(sp, coarse) {
		if (this.#handlesDirty) {
			this.#syncHandles()
			this.#wake()
		}
		const st = this.#handleState
		// (job 231) the points the connector tool shows are not hit (its press snaps to the anchor)
		if (!st || this.#live || st.all === true) return null
		const c = this.#camera.get()
		const radius = coarse ? HANDLE_TOUCH_PX : HANDLE_PX
		// (job 195) a node or a fold dot of the focused mind map right under the point comes before its "+"
		const f = this.#mmFocus
		const onNode = f !== null && this.#mindmapPart(f.id, { x: sp.x / c.scale + c.x, y: sp.y / c.scale + c.y }, 0) !== null
		let best = null
		let bestD = Infinity
		for (const h of st.list) {
			if (onNode && h.name.startsWith('mm-')) continue
			const d = Math.hypot((h.x - c.x) * c.scale - sp.x, (h.y - c.y) * c.scale - sp.y)
			if ((d <= radius || (!coarse && isStructPlus(h.name) && onStructPlus(h.name, (h.x - c.x) * c.scale - sp.x, (h.y - c.y) * c.scale - sp.y))) && d < bestD) {
				best = h.name
				bestD = d
			}
		}
		return best
	}

	/**
	 * @param {string} anchor handle name
	 * @param {{x:number, y:number}} w world point where the press started
	 * @return {boolean} true when a transform started
	 */
	#beginTransform(anchor, w) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		if (!ANCHORS.includes(anchor) || !this.#handleState?.list.some((h) => h.name === anchor)) return false
		if (!this.#xf.begin(this.#selection.values(), anchor, w)) return false
		this.#xfTarget = null
		// (job 199) one frame with lanes: the first (top edge) or last lane takes the change, live as at the release
		const one = this.#xf.ids.length === 1 ? this.#model.get(this.#xf.ids[0]) : null
		if (anchor !== 'rot' && hasLanes(one)) {
			// (job 208) and the first (left edge) or last column the change of its width
			this.#structure.setPreview({
				id: one.id, lane: true, edge: ['tl', 't', 'tr'].includes(anchor) ? 'top' : 'bottom', h0: one.h,
				xedge: ['tl', 'l', 'bl'].includes(anchor) ? 'left' : 'right', w0: one.w,
			})
		}
		// snapping (M2, R12), once per resize: the candidates in the live view; one item without itself
		// (the children of a resized frame stay and are targets), several without everything that moves
		const exclude = this.#xf.startFrame.n === 1 ? new Set(this.#xf.ids) : this.#xf.all
		const index = anchor === 'rot' ? null : snapIndexOf(this.#model, viewRectOf(this.#liveCam(), this.#size.w, this.#size.h, 0), exclude)
		this.#xfSnap = { index, guides: [], gaps: [], measures: [], labels: [] }
		// attached connectors are re-routed while live, scaled with the group above TRANSFORM_LIVE_MAX
		this.#xfLinks = this.#model.connectorsOf(this.#xf.all)
		const all = new Set([...this.#xf.all, ...this.#xfLinks])
		this.#renderer.beginDrag(all)
		if (!this.#xf.live) this.#renderSelection()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'transform', active: true, ids: [...all] })
		this.#wake()
		return true
	}

	/** One transformer step per frame: live (model + nodes) or the activeGroup preview, and the snap guides. */
	#transformStep() {
		const t = this.#xfTarget
		this.#xfTarget = null
		if (!t || !this.#xf.active) return
		// the moving edges snap to the candidates at OBJECT_SNAP_PX of the live scale, and with the grid
		// shown and gridSnap on to it where no item snaps; Ctrl/⌘ resizes free
		const x = this.#xfSnap
		const snap = t.mods.ctrl || x.index === null
			? null
			: { index: x.index, tol: OBJECT_SNAP_PX / this.#liveCam().scale, grid: this.#grid && this.#gridSnap ? gridSnapStep(this.#liveCam().scale) : 0 }
		const r = this.#xf.step(t.p, { shift: t.mods.shift, alt: t.mods.alt, snap })
		if (!r) return
		if (r.preview) {
			this.#renderer.setActiveTransform(r.preview)
		} else {
			const geo = this.#model.setBoxesLocal(r.map)
			for (const c of this.#model.setEndsLocal(this.#xf.endsMap())) geo.add(c)
			this.#renderer.transformMoved(geo)
		}
		this.#showGuides(x, r.guides)
		// (job 194) the measuring lines of the guides from the new frame (no gap markers while resizing)
		const f = r.frame
		this.#showNumbers(x, x.index, { minX: f.x, minY: f.y, maxX: f.x + f.w, maxY: f.y + f.h }, null)
		this.#syncHandles()
	}

	/** @param {boolean} commit false = Esc (model back, no intent) */
	#endTransform(commit) {
		if (!this.#xf.active) return
		if (commit && this.#xfTarget !== null) {
			this.#transformStep()
		}
		this.#xfTarget = null
		const live = this.#xf.live
		const intent = commit ? this.#xf.result() : null
		const conns = this.#xf.connectors
		if (!live) {
			this.#renderer.setActiveTransform(null)
			if (intent) {
				const geo = this.#model.setBoxesLocal(this.#xf.lastMap())
				for (const c of this.#model.setEndsLocal(this.#xf.endsMap())) geo.add(c)
				this.#renderer.transformMoved(geo)
			}
		} else if (!intent) {
			const geo = this.#model.setBoxesLocal(this.#xf.restoreMap())
			for (const c of this.#model.clearLocal(conns)) geo.add(c)
			this.#renderer.transformMoved(geo)
		}
		this.#clearGuides(this.#xfSnap)
		this.#call('onDragPreview', [])
		if (intent) {
			this.#call('onIntent', intent)
		}
		const all = new Set([...this.#xf.all, ...this.#xfLinks])
		this.#structure.clearPreview((p) => p.lane === true && typeof p.edge === 'string')
		this.#xf.end()
		this.#syncSizeLabel()
		this.#xfSnap = null
		this.#xfLinks = new Set()
		this.#renderer.endDrag()
		this.#renderSelection()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'transform', active: false, ids: [...all] })
		this.#settleLocal(conns)
		this.#wake()
	}

	/** Drops a transform without touching the model and without an intent (reload, item gone). */
	#abortTransform() {
		if (!this.#xf.active) return
		const all = new Set([...this.#xf.all, ...this.#xfLinks])
		const live = this.#xf.live
		this.#model.clearLocal(this.#xf.connectors)
		this.#clearGuides(this.#xfSnap)
		this.#xfSnap = null
		this.#xfLinks = new Set()
		this.#structure.clearPreview((p) => p.lane === true && typeof p.edge === 'string')
		this.#xf.end()
		this.#syncSizeLabel()
		this.#xfTarget = null
		this.#input?.cancel()
		if (!live) this.#renderer.setActiveTransform(null)
		this.#renderer.endDrag()
		this.#handlesDirty = true
		this.#call('onDragPreview', [])
		this.#call('onActivity', { kind: 'transform', active: false, ids: [...all] })
	}

	// ---------------------------------------------------------------- internals: connectors

	/**
	 * @param {boolean} coarse touch or pen
	 * @return {{snapWorld:number, tolWorld:number}} snapping distance and hit tolerance (world)
	 */
	#snapOpts(coarse) {
		const s = this.#liveCam().scale
		return { snapWorld: SNAP_PX / s, tolWorld: (coarse ? CONNECT_TOL_TOUCH_PX : CONNECT_TOL_PX) / s }
	}

	/**
	 * Connector tool: a drag starts at the press point (snapped like an end).
	 *
	 * @param {{x:number, y:number}} w world point of the press
	 * @param {{ctrl?:boolean, coarse?:boolean}} [mods] Ctrl/⌘ (free), touch or pen
	 * @return {boolean} true when the drag started
	 */
	#beginConnect(w, mods = {}) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		const start = snapAt(this.#model, w, { ...this.#snapOpts(!!mods.coarse), free: !!mods.ctrl })
		if (!this.#cc.beginConnect(start.ep, w)) return false
		this.#ccTarget = null
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: true, ids: [] })
		this.#wake()
		return true
	}

	/**
	 * Drag from a "+" handle (new connector from its anchor) or a connector
	 * end handle (retarget). (job 159) With hang a new connector from a "+"
	 * hangs there without a press until it ends (#ccHang): no handles meanwhile.
	 *
	 * @param {string} name handle name: plus-t/r/b/l, start, end
	 * @param {{x:number, y:number}} w world point of the press
	 * @param {boolean} [hang] the connector hangs from the "+" (a click on a text item's "+")
	 * @return {boolean} true when the drag started
	 */
	#beginConnectHandle(name, w, hang = false) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		const st = this.#handleState
		if (!st || !st.list.some((h) => h.name === name)) return false
		if (name === 'start' || name === 'end') {
			const id = st.connector
			if (!id || !this.#cc.beginRetarget(id, name, w)) return false
			this.#renderer.beginDrag([id])
			this.#ccTarget = null
			this.#handlesDirty = true
			this.#call('onActivity', { kind: 'connect', active: true, ids: [id] })
			this.#wake()
			return true
		}
		const item = st.item
		const plus = item ? plusHandles(this.#model, item, 0).find((h) => h.name === name) : null
		if (!plus || !this.#cc.beginConnect({ item, ax: plus.ax, ay: plus.ay }, w, true)) return false
		this.#ccTarget = null
		this.#ccHang = hang ? name : null
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: true, ids: [] })
		this.#wake()
		return true
	}

	/**
	 * (job 159) A release of a hanging connector lies on its own "+": within HANDLE_PX (mouse) or
	 * HANDLE_TOUCH_PX (finger, pen) screen px of where that handle stands now (confirmed camera).
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {boolean} coarse finger or pen
	 * @return {boolean}
	 */
	#hangPlusAt(sp, coarse) {
		const item = this.#cc.startItem
		if (this.#ccHang === null || item === null) return false
		const c = this.#camera.get()
		const plus = plusHandles(this.#model, item, pointOffset(c.scale), this.#plusBelow(item, this.#reactBandOf(item, c.scale), c.scale)).find((h) => h.name === this.#ccHang)
		return !!plus && Math.hypot((plus.x - c.x) * c.scale - sp.x, (plus.y - c.y) * c.scale - sp.y) <= (coarse ? HANDLE_TOUCH_PX : HANDLE_PX)
	}

	/** One connect/retarget step per frame: snap, preview, re-route a re-targeted connector. */
	#connectStep() {
		const t = this.#ccTarget
		this.#ccTarget = null
		if (!t || !this.#cc.active) return
		const route = this.#toolOptions.connector.route
		const r = this.#cc.step(t.w, { ...this.#snapOpts(t.mods.coarse), free: t.mods.ctrl, route })
		if (!r) return
		if (this.#cc.mode === 'retarget') {
			const geo = this.#model.setEndsLocal(new Map([[this.#cc.id, { [this.#cc.which]: r.ep }]]))
			this.#renderer.dragMoved(geo)
			this.#handlesDirty = true
		}
		this.#renderer.setConnectPreview({
			points: r.preview ? r.preview.hitPts : [],
			target: r.box,
			anchors: r.anchors.map((a) => ({ x: a.x, y: a.y })),
			snap: r.snap,
		})
	}

	/**
	 * Release (commit) or Esc: preview cleared → intent (connect, or retarget
	 * while the connector is still active) → onActivity(connect, false).
	 *
	 * @param {boolean} commit false = Esc (no intent)
	 */
	#endConnect(commit) {
		if (!this.#cc.active) return
		if (commit && this.#ccTarget !== null) {
			this.#connectStep()
		}
		this.#ccTarget = null
		const mode = this.#cc.mode
		const id = this.#cc.id
		const intent = commit ? this.#cc.result(this.#toolOptions.connector) : null
		// (job 169) a connector that hung from a "+" and ends on an item: the session selects that item
		if (intent?.type === 'connect' && this.#ccHang !== null && 'item' in intent.end) intent.selectEnd = true
		this.#renderer.setConnectPreview(null)
		this.#ccHang = null
		if (mode === 'retarget' && !intent) {
			this.#renderer.dragMoved(this.#model.clearLocal([id]))
		}
		if (intent) {
			this.#call('onIntent', intent)
		}
		this.#cc.end()
		if (mode === 'retarget') this.#renderer.endDrag()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: false, ids: id ? [id] : [] })
		if (mode === 'retarget') this.#settleLocal([id])
		if (mode === 'connect' && intent && this.#tool === 'connector') {
			this.#noteBack()
			this.#tool = 'select'
			this.#applyCursorStyle()
			this.#call('onTool', 'select')
		}
		this.#wake()
	}

	/** Drops a connect/retarget drag without an intent (reload, item gone, view-only). */
	#abortConnect() {
		if (!this.#cc.active) return
		const mode = this.#cc.mode
		const id = this.#cc.id
		this.#cc.end()
		this.#ccTarget = null
		this.#ccHang = null
		this.#input?.cancel()
		this.#renderer.setConnectPreview(null)
		if (mode === 'retarget') {
			this.#model.clearLocal([id])
			this.#renderer.endDrag()
		}
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: false, ids: id ? [id] : [] })
	}

	// ---------------------------------------------------------------- internals: editor

	/**
	 * @param {string} id item id (exists, has a text path; job 173: or a table with cell)
	 * @param {{text:(string|null), notice:(string|null), takeover:boolean, cell?:(string|null)}} o options
	 * @return {boolean}
	 */
	#openEditor(id, { text, notice, takeover, cell = null }) {
		const it = this.#model.get(id)
		const table = it.t === 'table' && typeof cell === 'string'
		// (job 195) a node of a mind map: its key is the editor's cell
		const mm = it.t === 'mindmap' && typeof cell === 'string'
		// (job 199) the name of a lane of a frame
		const lane = it.t === 'frame' && typeof cell === 'string'
		const sub = table || mm || lane ? cell : null
		const path = table ? cellPath(cell) : mm ? nodeTextPath(cell) : lane ? namePath(cell) : textPathOf(it.t)
		if (this.#editor.id === id && this.#editor.cell === sub) {
			if (takeover) {
				// "Take over" for the item whose editor is already open (the
				// button outlives the offer until the next frame, e.g. when a text
				// rescue opened this editor with a notice in between): the user
				// explicitly takes the lease. Lift the notice so commits resume and
				// report the take-over; never drop it silently.
				if (this.#takeOver?.id === id) this.#takeOver = null
				this.#editor.setNotice(null)
				this.#editing(id, true, sub)
				this.#layoutEditor(true)
				this.#presenceDirty = true
				this.#wake()
			} else if (notice !== null) {
				this.#editor.setNotice(notice)
			}
			return true
		}
		if (this.#editor.id !== null) {
			this.#editor.finish()
			if (this.#editor.id !== null) return false
		}
		const cur = mm ? nodeText(it.data, cell) : getPath(it, path)
		const before = typeof cur === 'string' ? cur : ''
		const kind = lane ? 'lane' : typeInfo(it.t).editor ?? 'note'
		// (job 195) the node being edited is the focus of its selected map
		if (mm) {
			const sel = this.#selection.values()
			if (sel.length === 1 && sel[0] === id) this.#setFocus(id, cell)
		}
		if (this.#takeOver?.id === id) this.#takeOver = null
		// (job 159) an editor that opens drops a hanging connector
		if (this.#ccHang !== null) this.#input.cancel()
		this.#editorMeasure = null
		// (job 173) the header row of a table is bold
		const layout = table ? this.#structure.tableLayoutOf(id) : null
		this.#editor.open({
			id,
			path,
			kind,
			value: typeof text === 'string' ? text : before,
			before,
			maxLength: table ? TABLE_CELL_MAX : mm ? MM_TEXT_MAX : lane ? LANE_TITLE_MAX : path === 'data.title' ? this.#limits.maxTitle : path === 'data.label' ? this.#limits.maxLabel : this.#limits.maxText,
			notice,
			cell: sub,
			bold: lane || (mm ? mindTree(it).root === cell && mindTree(it).layout !== 'org' : isHeadCell(layout, cell)),
			// (job 198) a card of an org chart: its name, then its role on the next line (the session's text)
			placeholder: mm && isBoxLayout(mindTree(it).layout) ? this.#cardPlaceholder : null,
		})
		this.#renderer.setTextHidden(id, true, sub)
		// (job 150) its outline goes in this frame, not with the next selection change
		this.#renderSelection()
		this.#handlesDirty = true
		this.#editing(id, takeover, sub)
		this.#call('onActivity', { kind: 'edit', active: true, ids: [id] })
		this.#layoutEditor(true)
		this.#presenceDirty = true
		this.#wake()
		return true
	}

	/**
	 * Text intents of the editor: a `text` item gets h, its height measured
	 * for the new text (rule 13).
	 *
	 * @param {object} i text intent
	 */
	#editorIntent(i) {
		const it = this.#model.get(i.id)
		if (it && typeInfo(it.t).resize === 'text') {
			i.h = this.#textHeight(it, i.value)
		}
		this.#call('onIntent', i)
	}

	/**
	 * @param {object} it text item
	 * @param {string} value text
	 * @return {number} measured height (cached for the open editor's value)
	 */
	#textHeight(it, value) {
		const m = this.#editorMeasure
		if (m && m.id === it.id && m.value === value && m.w === it.w && m.fs === it.style?.fontSize) return m.h
		const h = this.measureTextHeight({ ...it, data: { ...it.data, text: value } })
		this.#editorMeasure = { id: it.id, value, w: it.w, fs: it.style?.fontSize, h }
		return h
	}

	/**
	 * @param {string} id item whose editor closed
	 * @param {{byKey?:boolean}} [info] ended by a key
	 */
	#editorClosed(id, info) {
		if (this.#destroyed) return
		this.#renderer.setTextHidden(id, false)
		// (job 173) the preview of the cell editor's text goes with it; (job 195) the node editor's too
		this.#structure.clearPreview((p) => p.id === id && (typeof p.cell === 'string' || typeof p.key === 'string'))
		// (job 150) the selection stays: its outline comes back
		this.#renderSelection()
		this.#editorMeasure = null
		this.#handlesDirty = true
		this.#call('onEditing', null, false)
		this.#call('onActivity', { kind: 'edit', active: false, ids: [id] })
		// (job 173) Tab / Shift+Tab in a cell: the next / previous cell, row by row;
		// (job 174) an arrow key at the edge of the text: the cell beside it
		const move = info?.move
		if (move !== undefined && typeof info.cell === 'string' && this.#model.has(id) && this.#pendingOpen === null) {
			const it = this.#model.get(id)
			const next = typeof move === 'number' ? stepCell(it, info.cell, move) : neighbourCell(it, info.cell, move)
			if (next !== null && this.openTextEditor(id, { cell: next })) {
				this.#wake()
				return
			}
			// (job 174) Tab in the last cell (it still exists and is the last in the order, no notice): the
			// session appends a row like the "+" and opens its left cell; at 50 rows, in a full or a locked
			// table it sends nothing and no editor opens
			if (move === 1 && next === null && info.notice !== true && hasCell(it, info.cell)) {
				this.#call('onIntent', { type: 'tableAppend', id, axis: 'row', open: true })
				if (this.#editor.id !== null) {
					this.#wake()
					return
				}
			}
		}
		// (job 174) a grid pasted into a cell: the session fills the table from that cell on
		if (Array.isArray(info?.paste) && typeof info.cell === 'string') {
			this.#call('onIntent', { type: 'tablePaste', id, cell: info.cell, grid: info.paste })
		}
		// (job 195) Enter or Tab in a node editor: the session adds the node and opens its editor
		if ((info?.add === 'child' || info?.add === 'sibling') && typeof info.cell === 'string' && info.notice !== true &&
			this.#model.get(id)?.t === 'mindmap' && this.#pendingOpen === null) {
			if (info.byKey) this.focusCanvas()
			this.#call('onIntent', { type: 'mmAdd', id, key: info.cell, as: info.add, open: true })
			if (this.#editor.id !== null) {
				this.#wake()
				return
			}
		}
		const p = this.#pendingOpen
		if (p && this.#model.has(p.id)) {
			// opened from inside the final intent (series entry): now
			this.#pendingOpen = null
			if (info?.byKey) this.focusCanvas()
			this.openTextEditor(p.id, { text: p.text, notice: p.notice, cell: p.cell ?? null })
		} else if (info?.byKey && this.#editor.id === null) {
			this.focusCanvas()
		}
		this.#wake()
	}

	/**
	 * onEditing: (job 173) with the cell of a table as third argument, else as before (two).
	 *
	 * @param {string|null} id item
	 * @param {boolean} takeover the user took the lease over
	 * @param {string|null} cell the cell of a table, else null
	 */
	#editing(id, takeover, cell) {
		if (typeof cell === 'string') this.#call('onEditing', id, takeover, cell)
		else this.#call('onEditing', id, takeover)
	}

	/**
	 * @param {boolean} [force] lay out even when the loop would skip it
	 */
	#layoutEditor(force = false) {
		const id = this.#editor?.id
		if (id === null || id === undefined || (!force && !this.#editor.element)) return
		const it = this.#model.get(id)
		const a = this.#model.abs(id)
		if (!it || !a) return
		const c = this.#liveCam()
		const s = c.scale
		const kind = this.#editor.kind
		if (kind === 'node') {
			// (job 195) over its node, which grows with the text; the root stays (the preview's anchor)
			const key = this.#editor.cell
			const value = this.#editor.value
			// (job 198, round 2) an empty card of an org chart is laid out with its placeholder, so its editor shows all
			// of it (only here: the text of the card is hidden while it is edited)
			const shown = value === '' && this.#cardPlaceholder !== null && isBoxLayout(mindTree(it).layout) ? this.#cardPlaceholder : value
			const pv = this.#structure.preview
			if (pv === null || pv.id !== id || pv.key !== key || pv.text !== shown) {
				const root = this.#storedLayoutOf(id)?.byKey.get(mindTree(it).root)
				this.#structure.setPreview({ id, key, text: shown, anchor: root ? { x: root.x, y: root.y } : null })
			}
			const n = this.#mindmapLayoutOf(id)?.byKey.get(key)
			if (!n) return
			const inset = Math.max(0, n.padX - n.padY)
			// (job 198) a card of an org chart: below its colour band; (job 266) of a tree: right of it
			const band = n.band === 'top' ? MM_CARD_BAND : 0
			const bandL = n.band === 'left' ? MM_CARD_BAND : 0
			this.#editor.layout({
				x: (a.x + n.x + bandL + inset - c.x) * s,
				y: (a.y + n.y + band - c.y) * s,
				w: (n.w - bandL - 2 * inset) * s,
				h: (n.h - band) * s,
				r: 0,
				padding: n.padY * s,
				fontSize: n.font * s,
				background: n.fill ?? MM_FILL,
				align: n.shape !== 'line' || n.parent === null ? 'center' : 'left',
				color: TEXT_COLOR,
				weight: n.bold ? 'bold' : 'normal',
			})
			return
		}
		if (kind === 'cell') {
			// (job 173) over its cell, which grows with the text (the preview lays the table out with it)
			const cell = this.#editor.cell
			const value = this.#editor.value
			const pv = this.#structure.preview
			if (pv === null || pv.id !== id || pv.cell !== cell || pv.text !== value) this.#structure.setPreview({ id, cell, text: value })
			const l = this.#structure.tableLayoutOf(id)
			const b = l ? cellBox(l, cell) : null
			if (!b) return
			// (job 265) the header row or column: bold on the header fill; the editor tints it and frames it inside in the selection colour
			const head = isHeadCell(l, cell)
			this.#editor.layout({
				x: (a.x + b.x - c.x) * s,
				y: (a.y + b.y - c.y) * s,
				w: b.w * s,
				h: b.h * s,
				r: 0,
				padding: TABLE_PAD * s,
				fontSize: TABLE_FONT_SIZE * s,
				background: mixColor(this.#selColor, head ? shownColor(fieldValue(it, 'style.headerFill')) : TABLE_FILL, TABLE_EDIT_MIX),
				outline: this.#selColor,
				align: 'left',
				color: shownColor(fieldValue(it, 'style.textColor')),
				weight: head ? 'bold' : 'normal',
			})
			return
		}
		if (kind === 'label') {
			// connector label: the estimated label box of the text being typed,
			// centred at labelAt (at least LABEL_EDITOR_MIN_W wide)
			const g = this.#model.geometryOf(id)
			if (!g || !g.labelAt) return
			const b = labelBox(this.#editor.value === '' ? ' ' : this.#editor.value, g.labelAt)
			const w = Math.max(b.w, LABEL_EDITOR_MIN_W)
			this.#editor.layout({
				x: (g.labelAt.x - w / 2 - c.x) * s,
				y: (b.y - c.y) * s,
				w: w * s,
				h: b.h * s,
				r: 0,
				padding: CONNECTOR_LABEL_PAD * s,
				paddingX: CONNECTOR_LABEL_PAD_X * s,
				fontSize: CONNECTOR_LABEL_FONT_SIZE * s,
				background: CONNECTOR_LABEL_FILL,
				align: 'center',
			})
			return
		}
		if (kind === 'lane') {
			// (job 264) on the fill of its cell, in the colour the name is drawn in
			const tone = laneTones(fieldValue(it, 'style.fill'))
			const put = (x, y, w, h, r, fill, align, fs = LANE_TITLE_SIZE) => this.#editor.layout({
				x, y, w, h, r, padding: LANE_PAD * s, fontSize: fs * s, background: fill, align, color: frameTabText(fill), weight: 'bold',
			})
			// (job 225) over the cell of a group (its first run): a lane group's turned by -90° about its centre
			const lr = laneRuns(it).find((r) => r.key === this.#editor.cell)
			const cr = lr ? null : colRuns(it).find((r) => r.key === this.#editor.cell)
			if (lr || cr) {
				const gw = lr ? laneGroupW(it) : 0
				const w = (lr ? lr.h : cr.w) * s
				const h = (lr ? gw : colGroupH(it)) * s
				const cx = (a.x + (lr ? gw / 2 : cr.x + cr.w / 2) - c.x) * s
				const cy = (a.y + (lr ? lr.y + lr.h / 2 : colGroupH(it) / 2) - c.y) * s
				put(cx - w / 2, cy - h / 2, w, h, lr ? -90 : 0, tone.group, lr ? 'center' : 'left', lr ? LANE_TITLE_SIZE : COL_GROUP_SIZE)
				return
			}
			// (job 199) over the head of its lane; (job 208) of its column
			const b = laneBands(it).find((x) => x.key === this.#editor.cell)
			const col = b ? null : colBands(it).find((x) => x.key === this.#editor.cell)
			if (!b && !col) return
			if (b) {
				// (job 225) right of the cell of its group; (job 234) turned by -90° about the centre of its cell, as a group's
				const gx = b.g !== null ? laneGroupW(it) : 0
				const cw = (laneHeadW(it, a.w) || headWidth(a.w)) - gx
				const w = b.h * s
				const h = cw * s
				put((a.x + gx + cw / 2 - c.x) * s - w / 2, (a.y + b.y + b.h / 2 - c.y) * s - h / 2, w, h, -90, tone.head, 'center')
				return
			}
			// (job 225) below the cell of its group
			const gy = col.g !== null ? colGroupH(it) : 0
			put((a.x + col.x - c.x) * s, (a.y + gy - c.y) * s, col.w * s, (colTop(it) - gy) * s, 0, tone.head, 'left')
			return
		}
		if (kind === 'padTitle') {
			// (job 188) one line; job 263: on the binding, bold and left like the title drawn there
			const b = padBand(a.w, a.h)
			const l = padLayout(a.w, a.h)
			this.#editor.layout({
				x: (a.x + b.x + l.pad - c.x) * s,
				y: (a.y + b.y - c.y) * s,
				w: Math.max(1, b.w - 2 * l.pad) * s,
				h: b.h * s,
				r: 0,
				padding: 0,
				fontSize: l.font * s,
				background: null,
				align: 'left',
				weight: 'bold',
				color: padLook(it).title,
			})
			return
		}
		if (kind === 'title') {
			// (job 243) on the tab, which is as wide as it can be while the editor is open (nodes/frame.js)
			this.#editor.layout({
				x: (a.x + FRAME_TAB_PAD - c.x) * s,
				y: (a.y - FRAME_TITLE_BAND - c.y) * s,
				w: Math.max(1, a.w - FRAME_TAB_INSET - 2 * FRAME_TAB_PAD) * s,
				h: FRAME_TITLE_BAND * s,
				r: 0,
				padding: 0,
				fontSize: FRAME_TITLE_SIZE * s,
				background: null,
				color: frameTabText(frameTabFill(fieldValue(it, 'style.fill'))),
				weight: FRAME_TITLE_WEIGHT,
			})
			return
		}
		if (kind === 'shape' && hasLabel(fieldValue(it, 'data.kind'))) {
			// (job 211) the label below the box: wrapW wide, as high as the typed lines (one at least),
			// turned with the shape around the shape's centre
			const l = labelEditorBox(it, a, this.#editor.value)
			this.#editor.layout({
				x: (l.cx - l.w / 2 - c.x) * s,
				y: (l.cy - l.h / 2 - c.y) * s,
				w: l.w * s,
				h: l.h * s,
				r: a.r,
				padding: 0,
				fontSize: l.fs * s,
				background: null,
				align: 'center',
				color: shownColor(fieldValue(it, 'style.textColor')),
			})
			return
		}
		if (kind === 'shape') {
			const b = shapeTextBox(it, a, this.#editor.value)
			// the text box rotates with the shape around the shape's centre
			const r = (a.r || 0) * Math.PI / 180
			const ox = b.x + b.w / 2 - a.w / 2
			const oy = b.y + b.h / 2 - a.h / 2
			const cx = a.x + a.w / 2 + ox * Math.cos(r) - oy * Math.sin(r)
			const cy = a.y + a.h / 2 + ox * Math.sin(r) + oy * Math.cos(r)
			this.#editor.layout({
				x: (cx - b.w / 2 - c.x) * s,
				y: (cy - b.h / 2 - c.y) * s,
				w: b.w * s,
				h: b.h * s,
				r: a.r,
				padding: b.pad * s,
				fontSize: b.fontSize * s,
				background: null,
				align: b.align,
				color: b.color,
			})
			return
		}
		if (kind === 'text') {
			const h = Math.max(a.h, this.#textHeight(it, this.#editor.value))
			this.#editor.layout({
				x: (a.x - c.x) * s,
				y: (a.y - c.y) * s,
				w: a.w * s,
				h: h * s,
				r: a.r,
				padding: 0,
				fontSize: fieldValue(it, 'style.fontSize') * s,
				background: null,
				align: fieldValue(it, 'style.align'),
				color: shownColor(fieldValue(it, 'style.color')),
			})
			return
		}
		const fill = shownColor(fieldValue(it, 'style.fill'))
		// (job 191) the text area of a note with tags ends above its tag row; (job 259) without, clear of the dog ear
		const reserve = noteTextReserve(it, this.#tags, a.w, a.h)
		this.#editor.layout({
			x: (a.x - c.x) * s,
			y: (a.y - c.y) * s,
			w: a.w * s,
			h: (a.h - reserve) * s,
			r: a.r,
			padding: STICKY_PADDING * s,
			fontSize: noteFontSize({ ...it, data: { ...it.data, text: this.#editor.value } }, STICKY_PADDING, reserve) * s,
			lineHeight: NOTE_LINE_HEIGHT,
			background: fill,
			color: noteTextColor(fill),
		})
	}

	/**
	 * @param {string} id item id
	 * @param {string|null} [cell] (job 173) the cell of a table: its own lease
	 * @return {boolean} true when another participant holds the text lease (fresh sample)
	 */
	#leaseHeldByOther(id, cell = null) {
		let samples = this.#lastSamples
		if (this.#sampler) {
			try {
				const fresh = this.#sampler(performance.now())
				if (Array.isArray(fresh)) samples = fresh
			} catch (err) {
				reportAsync(err)
			}
		}
		const want = typeof cell === 'string' ? cell : null
		return samples.some((s) => s && s.editing === id && (typeof s.editingCell === 'string' ? s.editingCell : null) === want && s.editingHolder === true)
	}

	/**
	 * @param {string} id blocked item: its chip offers "Take over" for TAKE_OVER_MS
	 * @param {string|null} [cell] (job 173) the cell of a table
	 */
	#offerTakeOver(id, cell = null) {
		this.#takeOver = { id, cell: typeof cell === 'string' ? cell : null, until: performance.now() + TAKE_OVER_MS }
		this.#presenceDirty = true
		this.#wake()
	}

	/**
	 * Always ends in onEditing(id, true) when the item exists and the scene is
	 * editable, also when this item's editor is already open (see #openEditor).
	 *
	 * @param {string} id item whose "Take over" was clicked
	 * @param {string|null} [cell] (job 173) the cell of a table
	 */
	#takeOverClicked(id, cell = null) {
		this.#takeOver = null
		this.#presenceDirty = true
		const it = this.#model.get(id)
		if (!it || this.#viewOnly || (it.t === 'table' && !hasCell(it, cell)) || (it.t === 'mindmap' && !nodesOf(it.data).has(cell))) {
			this.#wake()
			return
		}
		this.#openEditor(id, { text: null, notice: null, takeover: true, cell: it.t === 'table' || it.t === 'mindmap' ? cell : null })
	}

	// ---------------------------------------------------------------- internals: presence

	/** @param {number} now frame time */
	#samplePresence(now) {
		if (!this.#sampler) {
			this.#presenceDirty = false
			return
		}
		if (!this.#samplesActive && !this.#presenceDirty) return
		this.#presenceDirty = false
		let samples = []
		try {
			const out = this.#sampler(now)
			if (Array.isArray(out)) samples = out
		} catch (err) {
			reportAsync(err)
		}
		this.#lastSamples = samples
		this.#samplesActive = samples.length > 0
		this.#renderPresence(now)
	}

	/** @param {number} now time for the take-over window */
	#renderPresence(now) {
		if (!this.#mounted || this.#destroyed) return
		const cam = this.#liveCam()
		this.#cursors.render(this.#lastSamples, cam, {
			itemAnchor: (id, cell) => this.#anchorOf(id, cam, cell),
			takeOver: this.#takeOver,
			now,
		})
		const remote = []
		const previews = new Map()
		for (const s of this.#lastSamples) {
			if (!s) continue
			if (Array.isArray(s.selection) && s.selection.length > 0) {
				remote.push({ ids: s.selection.filter((id) => typeof id === 'string' && this.#model.has(id)), color: s.color })
			}
			if (Array.isArray(s.drag)) {
				for (const d of s.drag) {
					if (Array.isArray(d) && typeof d[0] === 'string' && !this.isActive(d[0])) {
						previews.set(d[0], { x: d[1], y: d[2] })
					}
				}
			}
		}
		this.#remoteSel = remote
		// (job 199) the children below a dragged lane border follow it
		for (const [k, at] of this.#structure.laneMoves()) previews.set(k, at)
		if (this.#renderer.setPreviews(previews)) {
			// the box resolver answers differently now: route the connectors of
			// the items that are (or were) previewed anew
			const ids = new Set([...this.#previewIds, ...previews.keys()])
			this.#previewIds = new Set(previews.keys())
			const geo = this.#model.reroute(ids)
			if (geo.size > 0) this.#renderer.dragMoved(geo)
		}
		this.#renderSelection()
	}

	/**
	 * @param {string} id item id
	 * @param {Camera} cam camera
	 * @param {string|null} [cell] (job 173) the cell of a table: the chip sits above it
	 * @return {{x:number, y:number}|null} screen point above which the chip sits
	 */
	#anchorOf(id, cam, cell = null) {
		const it = this.#model.get(id)
		if (it?.t === 'table' && typeof cell === 'string') {
			const a = this.#model.abs(id)
			const box = a ? cellBox(this.#structure.tableLayoutOf(id), cell) : null
			return box ? { x: (a.x + box.x - cam.x) * cam.scale, y: (a.y + box.y - cam.y) * cam.scale } : null
		}
		if (it?.t === 'mindmap' && typeof cell === 'string') {
			// (job 195) above the node (a hidden one: none)
			const box = this.nodeBox(id, cell)
			return box ? { x: (box.x - cam.x) * cam.scale, y: (box.y - cam.y) * cam.scale } : null
		}
		const b = it ? this.#model.boundsOf([id]) : null
		if (!b) return null
		// a title editor (frame) sits in the band above the box: the chip goes above that band
		const top = typeInfo(it.t).editor === 'title' ? b.y - FRAME_TITLE_BAND : b.y
		return { x: (b.x - cam.x) * cam.scale, y: (top - cam.y) * cam.scale }
	}

	// ---------------------------------------------------------------- internals: stage 3 (press, vote)

	/**
	 * @param {EventTarget} target element or window
	 * @param {string} type event type
	 * @param {Function} fn listener (removed in destroy)
	 */
	#listen(target, type, fn) {
		target.addEventListener(type, fn)
		this.#own.push([target, type, fn])
	}

	/**
	 * First pointerdown listener of the canvas: a follow glide ends at the
	 * camera shown (§6.3 "Folgen" (5)); in modes vote and view the first
	 * pointer down starts 'press' (R16: per canvas, not per pointer).
	 *
	 * @param {PointerEvent} e pointerdown
	 */
	#onCanvasDown = (e) => {
		this.#abortGlide()
		if (this.#isInteractive(e.target)) return
		// (job 231) the look of the handles follows the pointer
		this.#setLook(e.pointerType)
		const P = this.#press
		P.ids.add(e.pointerId)
		if (this.#mode !== 'edit' && !P.active && P.ids.size === 1) {
			P.active = true
			this.#call('onActivity', { kind: 'press', active: true, ids: [] })
		}
	}

	/**
	 * pointerup/pointercancel anywhere (window, after the canvas listeners):
	 * the last pointer of the canvas up ends 'press'.
	 *
	 * @param {PointerEvent} e pointerup or pointercancel
	 */
	#onPressUp = (e) => {
		const P = this.#press
		if (!P.ids.delete(e.pointerId)) return
		if (P.active && P.ids.size === 0) {
			P.active = false
			this.#call('onActivity', { kind: 'press', active: false, ids: [] })
		}
	}

	/**
	 * A tap (finger, pen) or a click (mouse) that did not become a camera
	 * gesture (GestureController.onTap). (job 151) Mode edit: a finger's tap
	 * goes to InputController.tap (a finger on a locked item is not claimed,
	 * its tap selects like a click there). Mode vote with a vote state only:
	 * the item hit (same rules as a selection click) gives voteMiss when it
	 * is not votable (votable(id) === true, S-13), else vote {id, rect}
	 * with rect = itemScreenRect(id) now (container px, confirmed camera,
	 * axis-aligned; CLI-18). A finger or pen on a votable item whose screen
	 * box has min(w, h) < SMALL_TARGET_PX zooms instead (user camera change,
	 * onUserCamera), unless the zoom cannot enlarge it any more. Empty canvas:
	 * nothing. (Job 233) A press on a drawn vote badge (renderer.voteBadgeAt:
	 * VOTE_BADGE_HIT_MOUSE_PX / _TOUCH_PX around its centre, not inside
	 * another item) counts as a tap on the badge's item, also just outside
	 * it; the badge is a big enough target, so it never zooms.
	 *
	 * @param {PointerEvent} e pointerup of the tap or click
	 */
	#tap(e) {
		if (!this.#mounted || this.#destroyed) return
		if (this.#pick) {
			// (job 189) "New comment": the tap picks its place, in every mode; nothing is selected, moved or voted.
			// A finger's or pen's touchend is cancelled (ENTWICKLUNG trap 9.46): its compatibility mousedown would
			// take the focus from the comment field that opens there, like after a create.
			this.#pickTouchEnd = e.pointerType === 'touch' || e.pointerType === 'pen'
			const r = this.#container.getBoundingClientRect()
			const at = [e.clientX - r.left, e.clientY - r.top]
			this.#call('onIntent', { type: 'pick', at, world: this.screenToWorld(at[0], at[1]), touch: e.pointerType === 'touch' })
			return
		}
		if (this.#mode === 'edit') {
			if (e.pointerType === 'touch') this.#input.tap(e)
			return
		}
		if (this.#mode !== 'vote' || this.#vote === null) return
		const r = this.#container.getBoundingClientRect()
		const w = this.screenToWorld(e.clientX - r.left, e.clientY - r.top)
		const hit = this.#input.hitAt(w, e.pointerType === 'touch')
		// (job 233) a drawn badge within 16 px (mouse) or 22 px (pen, finger), never through another item
		const badge = this.#renderer.voteBadgeAt?.(w, e.pointerType === 'mouse' ? VOTE_BADGE_HIT_MOUSE_PX : VOTE_BADGE_HIT_TOUCH_PX, hit) ?? null
		const id = badge ?? hit
		if (id === null) return
		if (!this.#votableNow(id)) {
			this.#call('onIntent', { type: 'voteMiss', id })
			return
		}
		const rect = this.itemScreenRect(id)
		if (rect === null) return
		if (badge === null && (e.pointerType === 'touch' || e.pointerType === 'pen') && Math.min(rect.w, rect.h) < SMALL_TARGET_PX) {
			const cam = this.#smallTargetCamera(id)
			if (cam !== null) {
				this.#endGestureNow()
				this.#call('onUserCamera')
				this.#setCam(cam)
				return
			}
		}
		this.#call('onIntent', { type: 'vote', id, rect })
	}

	/**
	 * Small-target zoom of mode vote (§6.3, CLI-06): the item centred, its
	 * shorter side SMALL_TARGET_GOAL_PX on screen, but never so big that it
	 * leaves SMALL_TARGET_PAD_PX on any side (the item and its surroundings
	 * stay in view; no 100 % limit), and (job 238) at most ZOOM_TO_MAX_SCALE.
	 *
	 * @param {string} id item id
	 * @return {Camera|null} null when this camera would not enlarge the item (the tap votes)
	 */
	#smallTargetCamera(id) {
		const b = this.#model.boundsOf([id])
		const side = b ? Math.min(b.w, b.h) : 0
		if (!(side > 0)) return null
		const s = this.#camera.get().scale
		const want = clampScale(Math.min(SMALL_TARGET_GOAL_PX / side, this.cameraForRect(b, SMALL_TARGET_PAD_PX).scale), MIN_SCALE, ZOOM_TO_MAX_SCALE)
		if (!(want > s * (1 + SMALL_TARGET_MIN_GAIN))) return null
		return { x: b.x + b.w / 2 - this.#size.w / (2 * want), y: b.y + b.h / 2 - this.#size.h / (2 * want), scale: want }
	}

	// ---------------------------------------------------------------- internals: reactions (job 172)

	/**
	 * The ReactState of now (nodes/reactions.js): the session's part, the
	 * scene's rule (mode edit: only the select tool; job 183: a touch screen
	 * in mode vote or view shows the button at every note), the hovered
	 * note, the one selected note and the notes whose button hides (dragged,
	 * transformed, in the own text editor).
	 *
	 * @param {number} [scale] camera scale (default: the live camera's)
	 * @return {import('./nodes/reactions.js').ReactState}
	 */
	#reactState(scale = this.#liveCam().scale) {
		const sel = this.#selection.values()
		const one = sel.length === 1 && this.#model.get(sel[0])?.t === 'sticky' ? sel[0] : null
		const hidden = new Set()
		if (this.#drag !== null) for (const id of this.#drag.all) hidden.add(id)
		if (this.#xf.active) for (const id of this.#xf.all) hidden.add(id)
		const editing = this.#editor?.id ?? null
		if (editing !== null) hidden.add(editing)
		const canReact = this.#reactCfg.canReact && (this.#mode !== 'edit' || this.#tool === 'select')
		return {
			canReact,
			me: this.#reactCfg.me,
			hover: this.#reactHover,
			selected: one,
			hidden,
			scale,
			everyNote: canReact && this.#reactCfg.touch && (this.#mode === 'vote' || this.#mode === 'view'),
		}
	}

	/**
	 * Once per frame, before the handles: the renderer gets the ReactState
	 * when it changed (and the handles follow the band of the selected note).
	 */
	#syncReactState() {
		if (!this.#mounted || this.#destroyed) return
		const st = this.#reactState(this.#camera.get().scale)
		const key = JSON.stringify([st.canReact, st.everyNote, st.me, st.hover, st.selected, this.#drag !== null ? this.#drag.top : null,
			this.#xf.active ? this.#xf.ids : null, this.#editor?.id ?? null, st.scale >= LOD_TEXT_SCALE])
		if (key === this.#reactKey) return
		this.#reactKey = key
		this.#renderer.setReactions(st)
		this.#handlesDirty = true
	}

	/**
	 * @param {string} id item id
	 * @param {number} band (job 172) the band of its reaction row (world units)
	 * @param {number} scale camera scale
	 * @return {number} how much further the bottom "+" of id stands (world units): the band, (job 211)
	 *   or below the label of a symbol, BPMN event or gateway, so a click on the label never hits it;
	 *   (job 231) with the points on the frame it keeps a finger's hit radius (HANDLE_TOUCH_PX) clear of the label
	 */
	#plusBelow(id, band, scale) {
		const reach = labelReach(this.#model.get(id), this.#model.abs(id))
		return Math.max(band, reach > 0 ? reach + HANDLE_TOUCH_PX / (scale > 0 ? scale : 1) : 0)
	}

	/**
	 * @param {string} id item id
	 * @param {number} scale camera scale
	 * @return {number} the band of id's reaction row when it is the one selected note and shows a row, else 0
	 */
	#reactBandOf(id, scale) {
		const st = this.#reactState(scale)
		return id === st.selected ? reactionBand(this.#model, id, st) : 0
	}

	/**
	 * @param {{clientX:number, clientY:number}} e pointer event
	 * @return {{x:number, y:number}} container point
	 */
	#reactPoint(e) {
		const r = this.#container.getBoundingClientRect()
		return { x: e.clientX - r.left, y: e.clientY - r.top }
	}

	/**
	 * The row part at a container point: an exact hit first, then (unless a
	 * transformer or "+" handle lies there) the nearest within the hit
	 * tolerance of the pointer type.
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {string} type pointerType
	 * @param {{handles?:boolean}} [o] handles: a handle there wins over a tolerance hit
	 * @return {import('./nodes/reactions.js').ReactHit|null}
	 */
	#reactHitAt(sp, type, { handles = true } = {}) {
		if (!this.#mounted || this.#destroyed) return null
		const c = this.#liveCam()
		const w = { x: c.x + sp.x / c.scale, y: c.y + sp.y / c.scale }
		const st = this.#reactState(c.scale)
		const offsetOf = (id) => this.#renderer.previewOffset(id) ?? null
		const exact = reactionAt(this.#model, w, st, { exact: true, offsetOf })
		if (exact !== null) return exact
		// (job 191) the "+n" of a note's tag row: an exact hit only
		const more = tagMoreAt(this.#model, w, this.#tags, c.scale)
		if (more !== null) return { id: more.id, kind: 'tags', corners: more.corners }
		if (handles && this.#handleAt(sp, type !== 'mouse') !== null) return null
		const tol = (type === 'mouse' ? HIT_TOL_MOUSE_PX : HIT_TOL_TOUCH_PX) / c.scale
		return reactionAt(this.#model, w, st, { tolWorld: tol, offsetOf })
	}

	/**
	 * @param {import('./nodes/reactions.js').ReactHit} hit a row part
	 * @return {{x:number, y:number, w:number, h:number}} its screen box (container px, confirmed camera, axis-aligned)
	 */
	#reactRect(hit) {
		const c = this.#camera.get()
		if (hit.kind === 'tags') {
			// (job 191) the "+n" chip of a tag row: its corners in world units
			const xs = hit.corners.map((p) => (p[0] - c.x) * c.scale)
			const ys = hit.corners.map((p) => (p[1] - c.y) * c.scale)
			return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
		}
		const row = hit.row
		const t = (row.r || 0) * Math.PI / 180
		const cos = Math.cos(t)
		const sin = Math.sin(t)
		const y0 = row.h + REACT_GAP
		const xs = []
		const ys = []
		for (const [lx, ly] of [[hit.x, y0], [hit.x + hit.w, y0], [hit.x, y0 + REACT_H], [hit.x + hit.w, y0 + REACT_H]]) {
			const dx = lx - row.w / 2
			const dy = ly - row.h / 2
			xs.push((row.x + row.w / 2 + dx * cos - dy * sin - c.x) * c.scale)
			ys.push((row.y + row.h / 2 + dx * sin + dy * cos - c.y) * c.scale)
		}
		const x = Math.min(...xs)
		const y = Math.min(...ys)
		return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
	}

	/**
	 * @param {PointerEvent} e pointerdown
	 * @return {boolean} a press the row may take: the main button (mouse, pen tip, finger), no other
	 *   press running; in mode edit only with the select tool, without Space and a hanging connector
	 */
	#reactPressable(e) {
		if (e.button !== 0 || isRightPress(e)) return false
		if (this.#mode === 'edit' && (this.#tool !== 'select' || this.#space || this.#ccHang !== null)) return false
		return this.#drag === null && !this.#xf.active && !this.#cc.active
	}

	/** A press on a row part: the scene takes it before the gesture and input controllers (header). */
	/**
	 * (Job 279) A mouse or pen press with Ctrl (not on Apple, where Ctrl+click
	 * is the right click) or ⌘, without Shift and Alt, primary button.
	 *
	 * @param {PointerEvent} e pointerdown
	 */
	#onLinkDown = (e) => {
		this.#linkPress = null
		if (this.#destroyed || !this.#mounted || e.pointerType === 'touch' || e.button !== 0 || e.shiftKey || e.altKey) return
		const mod = e.metaKey || (e.ctrlKey && !isApplePlatform())
		if (!mod || this.#isInteractive(e.target)) return
		this.#linkPress = { pid: e.pointerId, x: e.clientX, y: e.clientY }
	}

	/**
	 * (Job 279) The release of that press within DRAG_THRESHOLD_PX: the link
	 * under it (the topmost item's drawn text, renderer.linkAt) opens in a new
	 * tab. A drag (Ctrl: without snapping) opens nothing.
	 *
	 * @param {PointerEvent} e pointerup
	 */
	#onLinkUp = (e) => {
		const L = this.#linkPress
		this.#linkPress = null
		if (L === null || e.pointerId !== L.pid || this.#destroyed || !this.#mounted) return
		if (Math.hypot(e.clientX - L.x, e.clientY - L.y) > DRAG_THRESHOLD_PX) return
		const r = this.#container.getBoundingClientRect()
		const w = this.screenToWorld(e.clientX - r.left, e.clientY - r.top)
		const id = this.#input?.hitAt(w, false) ?? null
		if (id === null) return
		const href = this.#renderer.linkAt?.(id, w.x, w.y) ?? null
		if (href !== null) openLink(href)
	}

	#onReactDown = (e) => {
		if (this.#reactReplay || this.#destroyed || !this.#mounted) return
		const R = this.#reactPress
		if (R !== null) {
			// a second pointer: the first press goes on as it would have without the row
			if (e.pointerId !== R.pid) this.#reactHandOver()
			return
		}
		// only a first pointer: a second finger belongs to the gesture of the first one
		if (this.#isInteractive(e.target) || !this.#reactPressable(e) || this.#press.ids.size > 1) return
		const hit = this.#reactHitAt(this.#reactPoint(e), e.pointerType)
		if (hit === null) return
		e.stopImmediatePropagation()
		try {
			this.#container.setPointerCapture?.(e.pointerId)
		} catch {
			// synthetic pointers cannot be captured
		}
		this.#reactRestEnd()
		const init = {}
		for (const k of POINTER_INIT) {
			if (e[k] !== undefined) init[k] = e[k]
		}
		this.#reactPress = { pid: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, init, hit, held: false, timer: setTimeout(() => this.#reactHold(), LONG_PRESS_MS) }
	}

	/** The press on a row part was held for LONG_PRESS_MS: the names of a pill; its release is no tap. */
	#reactHold() {
		const R = this.#reactPress
		if (R === null) return
		R.timer = 0
		R.held = true
		if (R.hit.kind === 'pill') this.#call('onIntent', { type: 'reactNames', id: R.hit.id, e: R.hit.e, rect: this.#reactRect(R.hit), hold: true })
	}

	/** Moves: the row's press hands itself over beyond its threshold; a mouse or hovering pen hovers. */
	#onReactMove = (e) => {
		if (this.#reactReplay) return
		const R = this.#reactPress
		if (R !== null) {
			if (e.pointerId !== R.pid) return
			const slop = R.type === 'mouse' ? DRAG_THRESHOLD_PX : TAP_SLOP_PX
			if (!R.held && Math.hypot(e.clientX - R.x, e.clientY - R.y) > slop) {
				// it moves on: the controllers get its pointerdown now, and this move after it
				this.#reactHandOver()
				return
			}
			e.stopImmediatePropagation()
			return
		}
		if ((e.pointerType === 'mouse' || e.pointerType === 'pen') && !e.buttons) this.#reactHoverAt(e)
	}

	/**
	 * The row's press goes to the controllers after all: its pointerdown is
	 * sent again (the scene lets it pass), so they act as they would there.
	 */
	#reactHandOver() {
		const R = this.#reactPress
		if (R === null) return
		this.#reactPress = null
		clearTimeout(R.timer)
		const P = globalThis.PointerEvent
		if (typeof P !== 'function' || typeof this.#container.dispatchEvent !== 'function') return
		this.#reactReplay = true
		try {
			this.#container.dispatchEvent(new P('pointerdown', { bubbles: true, cancelable: true, composed: true, ...R.init }))
		} finally {
			this.#reactReplay = false
		}
	}

	/** The row's press ends: a tap acts, a held press or a pointercancel does nothing. */
	#onReactUp = (e) => {
		const R = this.#reactPress
		if (R === null || e.pointerId !== R.pid) return
		e.stopImmediatePropagation()
		this.#reactPress = null
		clearTimeout(R.timer)
		// the window listener of 'press' (modes vote and view) never sees this event
		this.#onPressUp(e)
		if (R.type === 'touch') this.#reactTouchEnd = true
		if (e.type !== 'pointerup' || R.held) return
		this.#reactTap(R.hit)
	}

	/**
	 * @param {import('./nodes/reactions.js').ReactHit} hit the part tapped
	 */
	#reactTap(hit) {
		if (hit.kind === 'pill') {
			if (this.#reactState().canReact) this.#call('onIntent', { type: 'react', id: hit.id, e: hit.e })
		} else if (hit.kind === 'tags') {
			this.#call('onIntent', { type: 'tagList', id: hit.id, rect: this.#reactRect(hit) })
		} else {
			this.#call('onIntent', { type: hit.kind === 'more' ? 'reactList' : 'reactPick', id: hit.id, rect: this.#reactRect(hit) })
		}
	}

	/**
	 * A mouse or hovering pen without a button: the hovered note (its band
	 * first, then the item hit there when it is a note), the pointer cursor
	 * over a part a click acts on, and the names of a pill a mouse rests on.
	 *
	 * @param {PointerEvent} e pointermove
	 */
	#reactHoverAt(e) {
		if (!this.#mounted || this.#destroyed) return
		const sp = this.#reactPoint(e)
		const c = this.#liveCam()
		const w = { x: c.x + sp.x / c.scale, y: c.y + sp.y / c.scale }
		let hover = bandAt(this.#model, w, this.#reactState(c.scale))
		if (hover === null) {
			const id = this.#input?.hitAt(w, false) ?? null
			hover = id !== null && this.#model.get(id)?.t === 'sticky' ? id : null
		}
		if (hover !== this.#reactHover) {
			this.#reactHover = hover
			this.#wake()
		}
		const hit = this.#reactHitAt(sp, e.pointerType, { handles: false })
		const cursor = hit !== null && (hit.kind !== 'pill' || this.#reactState(c.scale).canReact)
		if (cursor !== this.#reactCursor) {
			this.#reactCursor = cursor
			this.#applyCursorStyle()
		}
		this.#reactRestAt(e.pointerType === 'mouse' && hit?.kind === 'pill' ? hit : null)
	}

	/**
	 * A resting mouse: on the same pill for REACT_NAMES_MS the names show;
	 * leaving it hides them again.
	 *
	 * @param {import('./nodes/reactions.js').ReactHit|null} hit the pill under the mouse
	 */
	#reactRestAt(hit) {
		const key = hit ? hit.id + '|' + hit.e : null
		if (this.#reactRest !== null && this.#reactRest.key === key) return
		this.#reactRestEnd()
		if (key === null) return
		const rest = { key, shown: false, timer: 0 }
		rest.timer = setTimeout(() => {
			rest.timer = 0
			rest.shown = true
			this.#call('onIntent', { type: 'reactNames', id: hit.id, e: hit.e, rect: this.#reactRect(hit), hold: false })
		}, REACT_NAMES_MS)
		this.#reactRest = rest
	}

	/** The resting mouse left its pill: its timer goes, names it showed hide. */
	#reactRestEnd() {
		const R = this.#reactRest
		if (R === null) return
		this.#reactRest = null
		clearTimeout(R.timer)
		if (R.shown) this.#call('onIntent', { type: 'reactNames', id: null })
	}

	/** The mouse or pen left the canvas: no hovered note, no resting names. */
	#onReactLeave = (e) => {
		if (e.pointerType === 'touch' || this.#reactPress !== null) return
		this.#reactRestEnd()
		if (this.#reactCursor) {
			this.#reactCursor = false
			this.#applyCursorStyle()
		}
		if (this.#reactHover !== null) {
			this.#reactHover = null
			this.#wake()
		}
	}

	/** A double click on a row part does nothing (no editor, nothing created). */
	#onReactDblClick = (e) => {
		if (this.#isInteractive(e.target) || (this.#mode === 'edit' && this.#tool !== 'select')) return
		if (this.#reactHitAt(this.#reactPoint(e), 'mouse') === null) return
		e.stopImmediatePropagation()
		e.preventDefault()
	}

	/** The contextmenu of a press the row took (a long press) opens nothing. */
	#onReactMenu = (e) => {
		if (this.#reactPress === null) return
		e.preventDefault()
		e.stopPropagation()
	}

	/** (job 189) The touchend of a pick tap is cancelled: no compatibility mouse events, no ghost click. */
	#onPickTouchEnd = (e) => {
		if (!this.#pickTouchEnd) return
		this.#pickTouchEnd = false
		if (e.cancelable) e.preventDefault()
	}

	/** (job 189) A new touch: a pick flag left without its touchend (a pen without touch events) goes. */
	#onPickTouchStart = () => {
		this.#pickTouchEnd = false
	}

	/** The touchend of a finger the row took is cancelled: no compatibility mouse events, no ghost click. */
	#onReactTouchEnd = (e) => {
		if (!this.#reactTouchEnd) return
		this.#reactTouchEnd = false
		e.preventDefault()
	}

	/** A running press, a resting mouse and the pointer cursor of the row end (mode switch, reset, destroy). */
	#reactDrop() {
		const R = this.#reactPress
		this.#reactPress = null
		if (R !== null) clearTimeout(R.timer)
		this.#reactRestEnd()
		this.#reactTouchEnd = false
		this.#reactCursor = false
	}

	// ---------------------------------------------------------------- internals: callbacks

	/**
	 * @param {string} name callback name
	 * @param {...any} args arguments
	 */
	#call(name, ...args) {
		const fn = this.#cb[name]
		if (fn === null) return
		try {
			fn(...args)
		} catch (err) {
			reportAsync(err)
		}
	}
}
