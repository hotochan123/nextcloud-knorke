/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession (SPEC-M0 §6.5): the wiring between the scene [S] and the
 * replica/sync [C]. Lives OUTSIDE Vue reactivity (the view keeps it with
 * markRaw in a shallowRef); the shell only gets small state through `ui`
 * callbacks (status, selection summary, participants, zoom %, tool, undo).
 *
 * Invariant: SceneModel = Replica.visible for every id that is not locally
 * active (dragged or being edited). Active ids are deferred and flushed when
 * the activity ends.
 *
 * Text is never lost silently (text rescue, §6.5): a text op that comes back
 * bad/gone/locked/denied/limit keeps its text in the editor (with a notice),
 * reopens the editor with the rejected text (only when no editor is open:
 * never over another one), or hands the text to the shell for the copy
 * dialog, which collects every rescued text (T6).
 *
 * Leaving the page or the board: the open editor's latest text is committed
 * first (flushEditor, T5); in-app navigation asks prepareLeave() whether
 * everything reached the server (T3).
 *
 * The scene and model classes come in through `deps` (BoardView passes the
 * real ones), so this module stays importable in Node tests without Konva.
 *
 * Protocol 2 (SPEC-M1 §4.3–§4.5, §6.5.1), stage 0:
 * - Snapshot and join answers carry `proto`; another protocol than the
 *   bundle's is handled like a 409 before the first /sync (reload once per
 *   server version, util/reload.js claimReload; open() then throws the 409).
 * - `epoch` of the snapshot goes out as `ep` with every request; `role`
 *   is the access level from me.role/me.mod (owner|moderate|edit|vote|view).
 * - Board metadata: `this.board` is the one merged board view. onMeta (sync
 *   answers, own rename, later the moderation routes) takes over only a
 *   metaRev above the known one and only the keys present (title, meta); it
 *   never replaces links/linksAllowed (Befund F3). A resync snapshot replaces
 *   the board view as a whole (it is the authoritative state).
 * - Server time: Clock (clock.js) samples `now` of every 2xx answer.
 * - busy (write budget): after 30 s of busy answers in a row one toast
 *   "Changes are being saved more slowly. Nothing is lost." (the status stays
 *   online); 'closed' drops a vote op with "Voting has ended."; unknown result
 *   codes count as 'bad' (warning, text rescue).
 * - 'gone' of a member whose access came through a link (me.source 'link')
 *   carries the reason 'link' for its own banner text (SPEC-M1 §4.2).
 * - 'password_required' (guests): unsentTexts() collects what would be lost
 *   with the handover to PublicApp's name and password phase.
 *
 * Stage 1, round 1a (SPEC-M1 §6.5.1–§6.5.3):
 * - Intents v2: create (shape/text with the tool options; the editor opens
 *   for note, shape and text), transform (with measured text heights),
 *   copy/cut/duplicate (synchronous in the keydown: the clipboard is written
 *   while the user activation lasts), pasteKey (focuses the paste catcher in
 *   the same keydown, so the following DOM paste event lands on it in every
 *   browser), move from the arrow keys (one undo step per key series,
 *   mergeKey 'nudge:<ids>' within 1 s), text with h (text items) and
 *   next: 'right' (series entry: the next note right of this one, its editor
 *   opens; creating a note and its first text are ONE undo step).
 * - A new text item whose first editing ends empty is deleted (merged with
 *   its creation into one undo step). Closing a text item's editor measures
 *   it again and sends {h} when it differs by more than 0.5 (rule 13).
 * - Text heights: before setStyle (font size), arrange (width) and
 *   transform the session measures the target state with
 *   scene.measureTextHeight() and hands the heights to the pure actions.
 * - Selection v2 for the shell (ids, types, common field values, field
 *   intersection, box, canConnect); limits.maxItems/maxLabel fall back to
 *   5000/200.
 * - Shell commands: setToolOptions, setStyle, setShapeKind, swapDirection (job 153), placeShape (job 201), (job 204) placeLanes and setFlow, arrange, nudge,
 *   copy, cut, duplicate, focusCanvas (after pointer clicks on bar buttons).
 * - Opening a board focuses the canvas right after scene.mount() when
 *   nothing else has the focus (body or null), so single keys work at once
 *   (R9); an element focused meanwhile keeps it.
 *
 * Stage 1, round 1b (connectors, SPEC-M1 §6.3, §6.5.1, §6.5.2):
 * - Intent connect (connector tool, "+" handle) → actions.connectItems, the
 *   new connector is selected; intent retarget (an end handle was dragged)
 *   → actions.retargetEnd. Each is one undo step.
 * - "Connect" (connectSelection, WCAG 2.5.7): exactly two bindable items
 *   selected → a connector between them (both ends 'auto', route and end cap
 *   from the connector tool options), then the connector is selected.
 * - The label (data.label) is the connector's text path: the scene's label
 *   editor sends ordinary text intents (setText), and the text rescue covers
 *   it like note texts (rejected label → editor with notice, rescue editor
 *   or copy dialog). editLabel() opens the editor from the context bar;
 *   (job 143) renameFrame() opens a frame's title editor the same way.
 * - Delete releases bound connectors first (deleteItems v2 with the model's
 *   routed geometry): the free end stays where it was drawn, and undo binds
 *   it again in the same step.
 *
 * Stage 2 (SPEC-M1 §6.5.4, roles and modes):
 * - The client mode comes from me.role and the device (mode.js modeFor):
 *   'edit' | 'vote' | 'view'. `viewOnly` means "no editing in this mode"
 *   (role or device); `deviceViewOnly` is the device alone (no fine pointer),
 *   which also keeps the sync loop at the view-only cadence. The scene is
 *   built in that mode and switched with setMode (setViewOnly as the M0
 *   alias when the scene has no setMode).
 * - Live role change (onRole with {role, mod}, also a resync snapshot's me):
 *   me.role/me.mod and board.role follow; the new mode applies at once. When
 *   editing goes away, an open editor ends with the notice (the text stays to
 *   be copied, like a denied text); pending object ops come back 'denied'
 *   and are toasted once. A toast names the new access level (only when it
 *   changed, never for owner; mode.js roleToastFor). A change of mod alone
 *   only re-emits the board view (the shell shows or hides the share button).
 * - The link password lock-out (429 slow_down with reason 'password') is
 *   never repeated by open(): the guest page shows the lock-out text.
 *
 * Stage 3 (SPEC-M1 §6.4–§6.6, moderation):
 * - meta.vote → VoteState (votes.js): a new sid resets vt and voters; the
 *   votes blocks of snapshot, join and sync (onVotes comes after onMeta)
 *   are dropped for a foreign sid. The mode follows the session (modeFor
 *   with sessionOpen and preferVote): a desktop editor switches to vote at
 *   the start of a session (preferVote, the bar's "Vote"/"Edit" switch); the
 *   switch settles first (setMode('vote', {settle: true}): the open editor
 *   commits, a drag ends like a release) and one toast says so. A tablet
 *   that follows nobody brings the voting area into view.
 * - Vote ops {o:'vote', s, id, n, b} (job 216: b = the base, stale answers
 *   are carried onto the votes block in onVotes) go through enqueue (urgent only on
 *   devices with a fine pointer: tablets ride the 2-s tick), never into the
 *   undo stack. A tap in mode vote toggles (perItem 1) or opens the stepper
 *   (ui.onStepper); voteMiss explains why (at most every 3 s). Toasts carry
 *   [data-knorke-toast=vote-miss|vote-limit|vote-closed].
 * - vt (moderators only, open session only, at most every VT_EVERY_MS;
 *   R16 SRV-01). A moderator's tab ends the session itself at endsAt (the
 *   only automatic call of routes 22–26; 409 is swallowed).
 * - The scene gets SceneVoteState (§6.3): votable(id) over the model (a
 *   real boolean), badges(), markVotable in mode vote, color = colorFor(me.pid).
 * - (Job 149) Live count: with cfg.live a moderator's votes blocks carry
 *   tally (VoteState keeps it only for me.mod). liveShown (the bar's "Live
 *   count", setLiveShown) is this tab's alone, never stored or sent, false
 *   on loading, at every new sid, at the close and when mod goes; with it
 *   SceneVoteState gets live and the live totals of the items the model has.
 * - (Job 175) Accounts only: voteBlocked is true for a guest session
 *   (mode 'guest') while a session with cfg.accountsOnly is open. Then
 *   votesView().canVote and canSwitch are false, vote() queues nothing and
 *   the mode is computed as without an open session (vote link: view; edit
 *   link: edit on a computer, view on touch). Reactions stay as they are.
 *   The server denies such ops anyway; this only spares the round trip.
 * - (R17 K4) The vote list follows the model: while a session exists, every
 *   model change that flushVisible applies (server changes, acks, local
 *   edits; an item added, deleted, re-parented or its text edited) and a
 *   resync's reload end in one light ui.onVotes per tick (voteItemsChanged,
 *   coalesced with a microtask), so the open VotePanel list and
 *   votesView().scopeTitle never go stale between votes events.
 * - Presence (§6.4, R16 SRV-05): me only in mode edit and not while the
 *   vote panel is open during a session; there it carries v (the confirmed
 *   viewport, q(…, 10)). The presenting tab (meta.summon = my pid and this
 *   client) sends {v} in every other state, also on view-only devices.
 * - FollowController (follow.js): participant buttons, "Bring everyone
 *   here", the chip, Esc; ui.onFollow({following, chip}).
 * - Moderation routes 22–26 (startVote, updateVote, timer, summon,
 *   endSummon): the answer goes through onMeta; errors are toasted, never
 *   repeated automatically (R16 SRV-07).
 *
 * Stage 4 (SPEC-M1 §6.6 ContextMenu.vue, §6.5.3; R19 T4-02, T4-03, T4-04):
 * - Intent contextMenu (§6.3, step 4.2) → the menu state {id, at, world,
 *   frame, locker} for the shell (ui.onContextMenu({id, at, seq, items,
 *   grid, gridSnap, cursors, wheel, unlockAll, unlockFrame, unlockBy, unlockByName}) or
 *   null). It is
 *   applied after follower.onIntent like every intent in mode edit, so
 *   opening the menu ends following (§6.5.6 unchanged); outside mode edit
 *   it is ignored. The world point W of `at` is taken when the intent
 *   arrives (note-here, paste-here), and with it the frame of the entry
 *   "Unlock all in this frame" (the target, or in the board menu the frame
 *   under W) and the locker of the target (job 062). A new intent moves an
 *   open menu.
 * - The session closes it on a user camera change, the start of following,
 *   a mode switch away from edit, a frozen status, a selection change from
 *   another source and when its target leaves the model; the menu itself
 *   closes on Esc, Tab, a pointerdown outside, window blur and resize.
 * - menuAction(name) runs an entry (the context bar's commands; note-here
 *   like a click with the note tool at W; select-all like Ctrl/⌘+A; fit like
 *   Shift+1) and gives the canvas the focus back, except after edit-text
 *   and note-here (an editor opens).
 * - "Paste here": navigator.clipboard.read() synchronously in the click,
 *   evaluated like the paste event, placed with the box center at W (never
 *   +20/+20), the stored copy only with text from the clipboard; refused,
 *   empty or failed → toast [data-knorke-toast=paste-blocked].
 *
 * Review round P7 (SPEC-M1 §33.1 i, R22):
 * - P7-07: open() repeats a snapshot or join that a proxy or firewall
 *   answered with 403/404 without the app body (http.js isProxyBlock) after
 *   the failure backoff 1/2/4/8/15 s, never final; the status stays
 *   'connecting'. beforeunload asks while ops are pending also when the
 *   board is frozen; only the session's own automatic reload (status
 *   'reload') goes without the question.
 * - P7-08: the vote stepper (ui.onStepper) closes on every camera change
 *   (wheel, trackpad, zoom keys, a follow jump, fit, zoomToItem: onCamera
 *   with a camera other than the one at its opening), when its item leaves
 *   the model or the voting area, when the mode is no longer 'vote', when
 *   this person may no longer vote, and on a frozen status.
 * - P7-09: the presenting tab sends {v} also while hidden
 *   (getHiddenPresence); Esc ends following only outside input fields
 *   (clipboard.js inputFocused).
 * - P7-10: only the canvas tap of perItem = 1 has the double-tap lock
 *   (VoteState.propose with {tap: true}); the vote list and the stepper
 *   never lose a click to it.
 * - P7-11: zoomToItem(id, {left, right}) keeps a side panel's width free:
 *   the item lands centred in the visible part of the canvas.
 *
 * M2 (SPEC-M1 §1.2 "Ausrichten", "Verteilen", "Aufräumen"):
 * - align(edge) from the context bar: actions.alignItems on the selection,
 *   one undo step, the selection stays; selection v2 carries `alignable`
 *   (actions.alignableIds: no connectors, no children of selected frames).
 * - distribute(axis) from the align panel: actions.distributeItems on the
 *   selection (from three alignable items), one undo step, the selection
 *   stays; no selection key of its own (`alignable` tells the bar).
 * - tidy() from the align panel: actions.tidyItems on the selection (from
 *   two alignable items: rows and columns to an exact grid), one undo step,
 *   the selection stays; no selection key of its own either.
 *
 * M2 (SPEC-M1 §1.2 (R12), background grid): a switch of this person in this
 * browser, localStorage knorke.grid = '1' (on; missing = off, every other
 * value too), for every board, no meta key and nothing for the server. The
 * scene gets it when the board opens (option grid); toggleGrid() (the board
 * menu's entry "Show grid", menuAction('grid'), mode edit like every entry)
 * switches the scene and stores; the scene's own switch (the key G, in every
 * mode) arrives as onGrid and is only stored. No op, no undo step, no toast,
 * no poke; following goes on. The menu payload carries grid, the state when
 * the menu is reported. Snapping to the shown grid is a second switch of the
 * same kind, localStorage knorke.gridSnap = '0' (off; missing = on, every
 * other value too): option gridSnap when the board opens, toggleGridSnap()
 * (the entry "Snap to grid", menuAction('grid-snap'), only offered while the
 * grid is shown) switches the scene and stores, the same way and in any
 * state of the grid; the payload carries gridSnap. No key, no scene callback.
 *
 * Factory job 142 (one-time tip about selecting with a finger): the scene's
 * onTouchPan (a finger's one-finger pan started, mode edit, select tool)
 * shows the tip (ui.onTouchTip(true)) when the board is not frozen, the
 * client mode is edit, this session has not shown it yet and localStorage
 * knorke.touchTip is not '1'; the key is set to '1' as it appears (one key
 * for every board, account and guest of this browser). A failed write shows
 * it at most once per session, without an error. dismissTouchTip() (its OK
 * button) hides it (ui.onTouchTip(false)); the key stays.
 *
 * Factory job 145 (shortcuts overview): the scene's onShortcuts (the key ?
 * with the canvas focus) goes to ui.onShortcuts() in every client mode and
 * while frozen; no intent, so following and the selection stay.
 *
 * Factory job 147 (hide other people's cursors): a switch of this browser,
 * localStorage knorke.cursors = '0' (hidden; missing = shown, every other
 * value too), read when the board opens, for every board, account and guest.
 * While hidden, the sampler the scene gets gives cursor: null for every
 * sample but those of the person this client follows and of the presenter
 * of meta.summon (the whole pid, decided per sample); every other field
 * stays, so selections, drag previews and the editing chips remain.
 * toggleCursors() (the board menu's "Show other people's cursors",
 * menuAction('cursors'), and the scene's onCursors, the key C, in every
 * mode and while frozen) switches, stores ('0' or the key removed), calls
 * scene.presenceChanged() and shows the toast [data-knorke-toast=cursors];
 * a new switch hides the previous one first. No op, no undo step, no poke;
 * following goes on. The menu payload carries cursors.
 *
 * Factory job 154 (the mouse wheel zooms): what the wheel does without
 * Ctrl/⌘ is a choice of this browser, localStorage knorke.wheel = 'zoom' or
 * 'pan' (missing, and every other value: automatic), read when the board
 * opens and handed to the scene as its option wheel ('auto', 'zoom', 'pan';
 * it acts in every mode and while following). cycleWheel() (the board menu's
 * "Mouse wheel: …", menuAction('wheel')) switches Automatic → Zoom → Pan →
 * Automatic in the scene, stores it ('zoom', 'pan'; Automatic removes the
 * key; a failed write leaves the scene switched) and shows the toast
 * [data-knorke-toast=wheel] with the new stage; a new switch hides the
 * previous one first. No op, no undo step, no poke; following goes on. The
 * menu payload carries wheel (the scene's stage).
 *
 * M2 (SPEC-M1 §1.2 "(R20) Sperren", §11 Q10): locked items. The server
 * enforces every rule (result code itemlocked); the session mirrors them.
 * - lockSelection() / unlockSelection() (context bar, context menu) and
 *   toggleLock() (intent toggleLock, Ctrl/⌘+Shift+L): actions.lockItems
 *   on the unlocked selected items, actions.unlockItems on those me may
 *   unlock (model/locks.js mayUnlock); one undo step each, the selection
 *   stays. toggleLock locks when something can be locked, else unlocks,
 *   else (only foreign locks) the toast lock-unlock.
 * - Moderators (me.mod, job 044): unlockAll() (board menu "Unlock all")
 *   and unlockFrame(id) ("Unlock all in this frame": in the menu of a frame,
 *   and in the board menu for the frame under its point, job 062) lift
 *   every lock mayUnlock allows on the board / on the frame and its
 *   descendants (unlockAllIds, unlockFrameIds; never connectors, they have
 *   no parent); unlockBy(pid) ("Unlock all locked by {name}" on an item
 *   someone else locked, job 062) every lock of that person, of any type
 *   (unlockByIds; never me's own pid, so only the acting person's own
 *   locks stay; when {name} moderates too, their locks go as well). Each as
 *   actions.unlockItems through lockStep: one undo step, plain {lock: null}
 *   patches that the sync layer sends in batches of MAX_OPS within the
 *   write budget (busy → retried), the selection stays, the toast
 *   unlock-all with the number; with nothing left to unlock (someone was
 *   quicker) the toast unlock-none. Undo locks each again for the person
 *   who had locked it (job 152: the restore op of actions.unlockItems; the
 *   server brings back the lock it remembers, never one in me's name; when
 *   it cannot, the item stays free), me's own locks with me as before. The
 *   menu payload carries unlockAll / unlockFrame / unlockBy (and
 *   unlockByName), the numbers when the menu is reported (0 for everyone
 *   else, in view mode and while frozen); person and frame are the ones of
 *   the opening, the set is computed again when the entry runs. Select all
 *   and the marquee still skip locked items for every role.
 * - Selection v2 gains locked, unlocked, lockable, unlockable, lockedBy,
 *   unlockBy (lockSummary; lockable/unlockable 0 while the session cannot
 *   write); types, fields, mixed, the values, hasContainer, rotatable,
 *   alignable and box describe only the UNLOCKED items, ids, count and
 *   canConnect the whole selection. A lock change of a selected item
 *   reports the selection again.
 * - Editing actions act only on the unlocked items (cut, duplicate,
 *   delete, front/back, style, shape kind, arrange, align, distribute,
 *   tidy, arrows); copy, connect and zoom to selection on all. Deleting or
 *   cutting a selection with locked items toasts lock-delete with their
 *   number (also when nothing was deleted); they stay selected. Select all
 *   skips locked items.
 * - Safety net: commit() and sendHistory() leave out every op whose item
 *   is locked in the model (lock patches excepted): commit() silently
 *   (the inverse stays; the item shows its visible state again),
 *   sendHistory() with the toast lock-undo (job 155: a step from which
 *   nothing went out vanishes). So no derived client patch reaches a
 *   locked item (a released child, a released connector end, a membership
 *   patch); the server does those itself.
 * - itemlocked from the server: one toast lock-held per answer with the
 *   number of distinct items (never "Undo not possible" or the bad path);
 *   a text op goes to the text rescue with its own notice (noticeFor).
 *   When the item of the open editor gets locked (the visible lock changes
 *   from null to a map, also by the own lock from another tab), editing
 *   ends like a lost lease: loseLease with that notice.
 *
 * M2 (SPEC-M1 §1.2 "(R20) Gruppieren", model/groups.js): grouped items.
 * - groupSelection() / ungroupSelection() (context bar, context menu, the
 *   intents group and ungroup = Ctrl/⌘+G, Ctrl/⌘+Shift+G):
 *   actions.groupItems / ungroupItems on the selection, one undo step each;
 *   after grouping the selection is the old one plus the new group's items
 *   (the current item stays last), after ungrouping it stays. Blocked
 *   ('frame', 'locked', 'parent'): the toast group-blocked with the reason
 *   (contextbar.js groupHintText), nothing sent. Nothing in viewOnly or
 *   frozen.
 * - Selection v2 gains groupable, groupBlock, grouped, ungroupBlock and
 *   oneGroup (groupSummary over the whole selection; 0, null, false while
 *   the session cannot write); `alignable` counts blocks. A change of the
 *   group of a model item (own or foreign op, a grouped item removed)
 *   reports the selection again.
 * - Align, distribute, tidy up and the arrows of the shell act on
 *   movableIds(selection): no locked item and no member of a group with a
 *   locked member (heldGroup).
 *
 * Job 139 (sort notes by colour):
 * - sortByColor() (align panel, menu entry sort-colors) sorts the loose
 *   notes of the selection, sortFrameByColor() (bar and menu entry
 *   sort-frame, exactly one frame selected) the notes in that frame
 *   (actions.sortNotesByColor): mode edit only, one commit = one undo step,
 *   then the selection is empty and the name fields appear
 *   (ui.onSortLabels(list), also when nothing moved). Selection v2 carries
 *   sortable and frameSortable (actions.sortableNotes; 0 while the session
 *   cannot write, frameSortable 0 without exactly one frame).
 * - Factory job 267 (board/sessionAi.js, this.ai): selection v2 ai
 *   {summarise, cluster} offers "Summarise" and "Cluster by topic";
 *   aiSummarise(), aiCluster() and aiCancel() hand over; ui.onAi(view) and
 *   ui.onAiNotice({text, url}) → Promise<boolean> (the notice before the
 *   first task); the result of a task is one undo step, an AI card gets the
 *   height of its content once (fixHeights).
 * - Factory job 268: "Create with AI" of the tool bar (sessionAi.js
 *   diagram): aiDiagramOpen/Run/Insert/Close hand over, ui.onAiDiagram(view)
 *   reports the window, insertAiDiagram(tree, shape) puts the mind map;
 *   (job 269) a flowchart through insertAiFlow (board/aiFlow.js, a part);
 *   (job 276) a workshop the same way (board/aiWorkshop.js workshopPayload).
 * - The name fields are local only: list = the open blocks {i, color, x, y,
 *   w, h, parent} (world); sortLabelPlaces() gives their screen places from
 *   the live camera. sortLabelText(i, text) records what was typed;
 *   nameSortBlock(i, text) puts a non-empty (trimmed) name as a text item
 *   above block i (actions.sortBlockName, an undo step of its own, the
 *   selection stays) and drops its field. endSortLabels() saves every typed
 *   field the same way, then ends them all (ui.onSortLabels(null)); so do
 *   every other commit, undo and redo, a change of the selection or a tool,
 *   a mode switch (saving only when it settles), a frozen status (nothing
 *   saved), leaving the board and destroy.
 *
 * Job 144 (filter the selection): selection v2 carries kinds (model/groups.js
 * filterKinds); filterSelection(kind) (the bar's count button, the menu
 * entries only-<kind>) keeps only that kind selected: select(), no op, no
 * undo step, no toast.
 *
 * Job 146 (SPEC-M1 §1.2 (R22), "Arrange" positions):
 * - flushVisible reports the selection again (at most once) when the
 *   absolute box (x, y, w, h, r) of a selected item changed in the model:
 *   own commits, undo/redo, changes of others, a rejection that resets the
 *   model, a frame moving its selected child. The ArrangePopover follows it.
 * - arrange() clamps x and y (actions.arrangeItem) and reports once; a `bad`
 *   answer to its own patch (isArrangeOp, by value) toasts arrange-bad once
 *   per answer; every other code keeps its own toast.
 *
 * Job 155 (undo keeps other people's changes): undo() and redo() send only
 * the parts of a step that nobody else changed since (undo.js planHistory,
 * against replica.visible, for every role); a text item gets the measured
 * height of its target state. After the safety net's lock-undo, the toast
 * undo-changed names how many items were skipped (an item counts in one of
 * the two only, the lock first). The step moves to the other stack trimmed
 * to what went out, or vanishes when nothing did.
 *
 * Job 172 (emoji reactions), job 171 (laser pointer) and factory job 189 (comments): see board/sessionComments.js.
 *
 * Job 190 (locked items by marquee): the scene keeps the locked items a
 * plain marquee or Ctrl/⌘+A skipped as its offer (getLockedOffer;
 * onLockedOffer when its own input changes it); "Select all" of the menu
 * offers every locked item the same way (scene.setLockedOffer, mode edit).
 * Selection v2 lockedOffer counts the offered items that still exist and are
 * locked (lockedOfferIds; 0 outside mode edit, in viewOnly and frozen); a
 * change of that number by a sync answer or a resync reports the selection
 * again. selectLockedOffer() (the bar's "Select n locked items") selects
 * exactly those and ends the offer: no op, no undo step, no toast.
 *
 * Job 173 (tables, model/table.js): the lease, the intermediate texts, the
 * lease tail, the take-over and the text rescue work per cell: the lease key
 * is '<id>' for an item's text and '<id>#<col>.<row>' for a cell (leaseKey;
 * leaseLost, leaseTail, takeoverId and rescueEditorId hold such keys), me
 * carries ec with e, and the scene's onEditing names the cell. A cell's text
 * goes out as one path data.cells.<col>.<row>, "" as null; a text that would
 * bring the table over limits.maxItemBytes, or whose row or column is gone,
 * does not go out (the editor keeps it with its notice). After a cell editor
 * closes, after every own structure, width or header change and after an
 * undo or redo of a table the session measures the table again
 * (scene.measureTableCell, withSize) and writes w/h that differ, the first
 * two in the same undo step. Structure: tableAppend (the "+"), the menu
 * entries row-above … col-delete on the cell of the menu, tableWidth (a
 * border drag); each one undo step; at 50 rows, 20 columns or without bytes
 * nothing goes out and an info names the limit. table-csv downloads the CSV
 * (deps.download, util/download.js downloadText).
 *
 * Job 199 (swimlanes, model/lanes.js): the create intent of a frame with
 * lanes: true gets the names "Lane 1" to "Lane 3". laneAdd (the "+"), laneHeight
 * (a dragged border) and the menu entries lane-rename, lane-above,
 * lane-below, lane-up, lane-down and lane-delete on the lane of the menu
 * (menuLanes: {lanes: {index, count, locked}} for menuEntries) are one undo
 * step each with the frame's patch and the moved children's; nothing goes
 * out in mode view or vote, on a frozen board or at a locked frame, and an
 * info names the limit (30 lanes, a frame too tall, a locked child in the
 * way). A new lane opens the editor of its name. The text intent of a lane
 * editor (cell = the lane) goes out once, at its final text (no lease: me.e
 * never names a lane, so the frame's title stays free).
 *
 * Job 208 (columns of a frame with lanes): colAdd (the "+"), colWidth (a
 * dragged column edge), laneMove and colMove (a dragged head, to an index)
 * and the menu entries column-add, column-rename, column-left,
 * column-right, column-move-left, column-move-right and column-delete on the
 * column of the menu (the intent's col; menuLanes adds lanes.cols {index,
 * count}, null without columns) are one undo step each like a lane's; an
 * info names the limit (30 columns, a frame too wide). A new column opens
 * the editor of its name; the text intent of a column editor (cell = the
 * column) goes out like a lane's.
 *
 * Job 225 (lane and column groups): the menu entries lane-group,
 * lane-group-rename, lane-ungroup and column-group, column-group-rename,
 * column-ungroup on the lane (column) of the menu (menuLanes adds group to
 * lanes and to lanes.cols), and the intents laneGroupSpan, colGroupSpan (a
 * dragged edge) and laneGroupMove, colGroupMove (a dragged cell) are one
 * undo step each like a lane's; a new group opens the editor of its name,
 * whose text intent (cell = the group) goes out once at its final text.
 *
 * Job 174: tableAppend with open (Tab in the last cell) opens the new row's
 * left cell; tablePaste fills a table from the cell a spreadsheet grid was
 * pasted into (model/table.js pasteCells), one undo step of several patches.
 *
 * Jobs 178, 179, 180, 181, 182, 200 and 207 (export, templates, board files): see board/sessionFiles.js
 * (SessionFiles, factory job 253; this session hands over to it).
 *
 * Job 188 (note pads, model/pad.js): the scene's intent takeNote (a drag
 * from a pad's pile with at, Enter at the one selected pad with at null) →
 * actions.takeNote: one commit (urgent, mergeKey 'new:<id>'), only the new
 * note is selected and its editor opens (with at null the view brings it in
 * first); creating it and its first text are one undo step, closed empty it
 * stays. The pad gets no op, locked or not. Like every intent, nothing in
 * modes vote and view, for the role view or while frozen. The menu entry
 * pad-here (menuAction) creates a pad with its centre at W, without an
 * editor, like a click with the note tool's type 'pad'. The note tool's
 * type ('sticky' or 'pad', setToolOptions('sticky', {type})) goes back to
 * 'sticky' at every change of the tool (setTool, setToolOptions of another
 * tool, the scene's onTool); onToolOptions reports it with the others.
 *
 * Job 205 (BPMN files), job 217 (parts on first use) and job 220 (CSV files): see board/sessionFiles.js.
 *
 * Job 206 (undo for tags, undo.js planTagHistory): creating a tag (with
 * ticking the panel's notes: one step), renaming, recolouring and deleting
 * it (changeTag) are each an undo step with a tag part, recorded after the
 * route's answer from meta.tags before and after. Undo and redo of such a
 * step write the route first (sendTagHistory) and then send the step's ops;
 * they run one after another (history, historyQueue). Undoing a delete
 * brings the tag back with its id, name and colour, also on the notes that
 * lost its id meanwhile (retag); deleting asks no question any more. A tag
 * someone else changed is skipped with the info undo-changed; a failed
 * write or a skipped add (tag-exists) leaves the step where it is.
 */
import { pictureSize, placeablePicture, splitImage } from '../model/shapeImage.js'
import { REDESIGN_KINDS, hasLabel, shownBorder, squareOn } from '../model/shapes.js'
import { GONE_VIA_LINK, roleToastText } from '../components/banner.js'
import { SELECTION_FIELDS, WHEEL_STAGES, boardColors, frameHintText, groupHintText } from '../components/contextbar.js'
import { filterKinds, frameAroundPlan, groupSummary, movableIds, selectionKinds } from '../model/groups.js'
import { clientId } from '../model/ids.js'
import { isLocked, lockSummary, mayUnlock } from '../model/locks.js'
import { isCovered, privateOf, wantsResync } from '../model/privateWriting.js'
import { getPath, itemKey } from '../model/paths.js'
import { MAX_SCALE, shownColor, shownLine } from '../model/tokens.js'
import {
	COLS_MAX, COL_KEY_RE, LANES_MAX, LANE_FRAME_H, LANE_FRAME_W, LANE_KEY_RE, addCol, addLane, colBands, deleteCol as deleteLaneCol, deleteLane,
	hasCols, hasLanes, laneBands, moveCol, moveColTo, moveLane, moveLaneTo, renameCol, renameLane, setColWidth as setLaneColWidth, setLaneHeight,
	CGROUP_KEY_RE, LGROUP_KEY_RE, colRuns, groupCol, groupLane, laneRuns, moveGroupTo, renameGroup, spanGroup, ungroup,
} from '../model/lanes.js'
import { noteTagIds, selectionTags, tagMap } from '../model/tags.js'
import {
	TABLE_MAX_BYTES, applyTablePatch, cellKey, cellOfPath, cellPath, deleteCol, deleteRow, estimateCellHeight, hasCell, hasHtmlTable, insertCol,
	insertRow, orderedCols, parseCell, pasteCells, setCellText, setColWidth, tableBytes, withSize,
} from '../model/table.js'
import { itemLinks } from '../model/itemLinks.js'
import { isReactionPatch } from '../model/reactions.js'
import {
	MM_LAYOUTS, NODE_KEY_RE, addChild, addSibling, applyMindmapPatch, deleteBranch, drawnShape, estimateNodeSize, focusAfterDelete, hasPlaced, mindTree,
	mindmapBytes, moveNode, nodeOfTextPath, nodesOf, outlineText, parseOutline, placeNode, rearrange, setNodeField, setNodeText, defaultShape,
	textPath as nodeTextPath, toggleFold, withBox,
} from '../model/mindmap.js'
import { copyText } from '../components/copyText.js'
import { q } from '../model/geometry.js'
import { allTextPaths, checkField, fieldDefault, fieldRule, fieldValue, isBindable, textPathOf, typeInfo } from '../model/registry.js'
import { selectionFrame } from '../model/transform.js'
import { HttpError, isPasswordLock, isProxyBlock, isProxyRetry, isSlowDown, slowDownDelay } from '../sync/http.js'
import { colorFor, laserDelay, PresenceModel } from '../sync/presence.js'
import { PROTOCOL } from '../sync/protocol.js'
import { BUSY, Replica, isLockPatch } from '../sync/Replica.js'
import { INTERVALS, nextDelay } from '../sync/scheduler.js'
import { ACCESS_LEVELS, LINKS_DISABLED, LINK_EXPIRED, PASSWORD_REQUIRED, RATE_LIMITED, SERVER_ERROR, SyncClient, UNKNOWN_PROTO, defaultSleep, protoValue } from '../sync/SyncClient.js'
import { guestTransport, newCounters, userTransport } from '../sync/transport.js'
import { isApplePlatform } from '../util/device.js'
import { language, n, t } from '../util/l10n.js'
import { claimReload, hardReload } from '../util/reload.js'
import { shortcut } from '../util/shortcuts.js'
import { keys, webStorage } from '../util/storage.js'
import { showError, showInfo } from '../util/toast.js'
import { PARTS } from '../util/parts.js'
import { downloadBlob, downloadText } from '../util/download.js'
import { wellFormed } from '../util/unicode.js'
import * as boardsApi from '../api/boards.js'
import * as actions from './actions.js'
import { attachPasteCatcher, clipAttrOf, clipboardItemsData, clipboardReader, decodeClipAttr, encodeClip, hasDomSelection, inputFocused, isInputElement, readStoredClip, storeClip, validatePayload, writeClipboard } from './clipboard.js'
import { Clock } from './clock.js'
import { CommentFeed, commentableIds } from './comments.js'
import { FRAME_PAD_PX, FollowController, summonOf } from './follow.js'
import { SlideShow } from './slides.js'
import { ROLES, accessOf, canEdit, canVote, modeFor, roleToastFor } from './mode.js'
import { COMMENTS_CALLS, COMMENTS_SETS, COMMENTS_STATE, SessionComments } from './sessionComments.js'
import { metaMapOf, modelItems, r1 } from './sessionConsts.js'
import { FILES_CALLS, FILES_STATE, SessionFiles } from './sessionFiles.js'
import { TAGS_CALLS, TAGS_SETS, TAGS_STATE, SessionTags, tagRect } from './sessionTags.js'
import { AI_CALLS, AI_STATE, SessionAi } from './sessionAi.js'
import { UndoStack, planHistory, planTagHistory } from './undo.js'
import { VoteState, rebaseVotes } from './votes.js'

/**
 * (Job 173) The lease key of an item's text, or of one cell of a table.
 *
 * @param {string} id item id
 * @param {string|null} [cell] "<col>.<row>" of a table
 * @return {string} '<id>' or '<id>#<col>.<row>'
 */
export function leaseKey(id, cell = null) {
	return typeof cell === 'string' && cell !== '' ? id + '#' + cell : id
}

/**
 * @param {string} key lease key (leaseKey)
 * @return {[string, (string|null)]} item id and cell (null for an item's text)
 */
export function leaseParts(key) {
	const i = typeof key === 'string' ? key.indexOf('#') : -1
	return i < 0 ? [key, null] : [key.slice(0, i), key.slice(i + 1)]
}

/**
 * (Job 195) The text path of a sub-key: a table's cell "<col>.<row>" or a
 * mind map's node "n<8>" (its text data.texts.<pot>.<key>); (job 199) a
 * frame's lane "l<8>" (its name data.lanes.<key>.t); (job 208) its column
 * "c<8>" (data.cols.<key>.t).
 *
 * @param {string} cell sub-key
 * @return {string} its patch path
 */
function subPath(cell) {
	if (COL_KEY_RE.test(cell)) return 'data.cols.' + cell + '.t'
	// job 225: the name of a lane group or a column group
	if (LGROUP_KEY_RE.test(cell)) return 'data.lgroups.' + cell
	if (CGROUP_KEY_RE.test(cell)) return 'data.cgroups.' + cell
	return NODE_KEY_RE.test(cell) ? nodeTextPath(cell) : LANE_KEY_RE.test(cell) ? 'data.lanes.' + cell + '.t' : cellPath(cell)
}

/**
 * @param {unknown} path patch path
 * @return {string|null} (job 195) its sub-key: the cell of data.cells.<col>.<row>, the node of
 *   data.texts.<pot>.<key>, else null
 */
function subOfPath(path) {
	return cellOfPath(path) ?? nodeOfTextPath(path)
}

/**
 * @param {object|null} item table, mind map or (job 199) frame with lanes
 * @param {string} cell sub-key
 * @return {boolean} (job 195) the table has the cell, the mind map the node; (job 199) the frame the lane (job 208:
 *   or the column)
 */
function hasSub(item, cell) {
	// job 225: or a group of its lanes or columns
	if (item?.t === 'frame') return hasLanes(item) && [...laneBands(item), ...colBands(item), ...laneRuns(item), ...colRuns(item)].some((b) => b.key === cell)
	return item?.t === 'mindmap' ? nodesOf(item.data).has(cell) : hasCell(item, cell)
}

/** (job 195) The box fields withBox may add to a mind map's patch. */
const BOX_PATHS = Object.freeze(['x', 'y', 'parent', 'w', 'h'])

const CLIENT_RE = /^[A-Za-z][A-Za-z0-9]{0,15}$/
/**
 * Statuses after which the board stays visible but read-only (§6.5): every
 * final status of the sync loop. (U15) 'reload' counts too: the loop has
 * stopped for good, and the automatic reload happens at most once per tab
 * session (and never while text is at stake), so the page can stay.
 * The shell (BoardView, ConnectionBanner) uses this one list.
 */
export const FROZEN_STATUSES = Object.freeze(['gone', 'revoked', 'logged_out', RATE_LIMITED, 'reload', LINKS_DISABLED, LINK_EXPIRED, PASSWORD_REQUIRED])
/** How often open() repeats after a proxy 429/503. */
const OPEN_ATTEMPTS = 20
const CAMERA_SAVE_MS = 1000
const PRESENCE_IDS = 20
/** prepareLeave: how often it looks whether the pending ops are through. */
const LEAVE_POLL_MS = 50
/** U18: how long open() listens for another live tab using the same client id. */
export const CLAIM_MS = 200
/** SPEC-M1 §6.4: busy answers in a row for this long → one toast (nothing is lost). */
export const BUSY_TOAST_MS = 30000
/**
 * Result codes the session knows (SPEC-M0 §4.6, SPEC-M1 §4.6, plus the
 * client-side SERVER_ERROR). Any other code counts as 'bad' (§4.3).
 */
export const KNOWN_CODES = Object.freeze(['ok', 'dup', 'gone', 'bad', 'denied', 'limit', 'locked', 'closed', 'itemlocked', 'stale', BUSY, SERVER_ERROR])
/** Job 172: the scene's reaction intents (every mode, handled before the edit rule). */
const REACT_INTENTS = Object.freeze(['react', 'reactPick', 'reactList', 'reactNames'])
/** (Job 191) Meta keys whose change alone leaves vote, timer and summon alone (no applyMeta). */
const QUIET_META = Object.freeze(['comments', 'tags'])
/** Arrow keys within this time on the same items make one undo step (SPEC-M1 §6.3). */
export const NUDGE_MERGE_MS = 1000
/** Pasting more notes from plain text than this asks first (SPEC-M1 §6.5.2). */
export const NOTES_ASK = 100
/** Offset of a repeated paste on the same board while the originals are visible. */
export const PASTE_STEP = 20
/** The paste catcher gives the focus back after this long when no paste event came. */
const CATCHER_MS = 500
/** Fallbacks of initial-state limits missing before stage 1 (SPEC-M1 §4.8). */
export const LIMIT_DEFAULTS = Object.freeze({ maxItems: 5000, maxLabel: 200 })
/** vt goes out at most this often (SPEC-M1 §4.5, R16). */
export const VT_EVERY_MS = 2000
/** At most one voteMiss hint per this many ms (SPEC-M1 §6.5.5). */
export const MISS_HINT_MS = 3000
/** The automatic end at endsAt waits this much longer (server clock skew) … */
export const AUTO_END_DELAY_MS = 250
/** … and tries this often on network errors (409 is the normal end). */
export const AUTO_END_TRIES = 3
/** Camera changes poke the sync loop at most this often (presence v). */
const CAMERA_POKE_MS = 250
/** (Job 171) The laser constants live in sessionConsts.js (factory job 255). */
export { LASER_MIN_GAP_MS, LASER_WINDOW_MS, LASER_WIRE_MAX } from './sessionConsts.js'
/** The board's area for the tablet camera and "zoom to" keeps this margin (screen px). */
export const ZOOM_PAD_PX = 40
/** Clock skew changes below this are not reported to the shell. */
const SKEW_REPORT_MS = 100
/**
 * @param {string|null} stored localStorage knorke.wheel
 * @return {string} 'zoom' or 'pan' as stored, 'auto' for anything else (job 154)
 */
function storedWheel(stored) {
	return stored === 'zoom' || stored === 'pan' ? stored : 'auto'
}

/**
 * @param {object|null} limits initial-state limits
 * @return {object|null} the limits with maxItems/maxLabel (positive whole numbers) or their fallbacks
 */
export function limitsWithDefaults(limits) {
	const out = limits && typeof limits === 'object' ? { ...limits } : {}
	for (const [k, v] of Object.entries(LIMIT_DEFAULTS)) {
		if (!Number.isInteger(out[k]) || out[k] <= 0) {
			out[k] = v
		}
	}
	return out
}

/**
 * Codes of a moderation call whose answer means "the known meta is out of
 * date" (SPEC-M1 §4.2: vote_open "Leiste aktualisieren", vote_closed,
 * timer_state, meta_too_large "Meta neu anwenden"). The server may have
 * changed meta itself (R16: start/extend on an expired session closes it and
 * answers 409); the new meta arrives with the next sync tick.
 */
export const META_STALE_CODES = Object.freeze(['vote_open', 'vote_closed', 'timer_state', 'meta_too_large', 'private_on'])

/**
 * Message of a failed moderation call (routes 22–26, SPEC-M1 §4.2, §6.11).
 *
 * @param {unknown} e error of the call
 * @return {string} translated text
 */
export function moderationError(e) {
	const code = e instanceof HttpError ? e.code : null
	const status = e instanceof HttpError ? e.status : 0
	switch (code) {
	case 'vote_open':
		return t('knorke', 'A vote is already running.')
	case 'private_on':
		// job 275: private writing runs (a second start, a vote or AI on the notes)
		return t('knorke', 'Not possible during private writing.')
	case 'vote_closed':
		return t('knorke', 'This vote has already ended.')
	case 'timer_state':
		return t('knorke', 'The timer has changed in the meantime.')
	case 'vote_config':
		return t('knorke', 'These vote settings are not possible.')
	case 'slow_down':
		return t('knorke', 'Too many requests. Please wait a moment.')
	case 'forbidden':
		return t('knorke', 'No permission')
	default:
		break
	}
	if (status === 404) {
		return t('knorke', 'This board is no longer available.')
	}
	if (status === 0) {
		return t('knorke', 'The server cannot be reached. Check your connection.')
	}
	return t('knorke', 'This change could not be applied.')
}

/**
 * @param {Map|object|null} m Map or plain object
 * @param {string} k key
 * @return {any}
 */
function pick(m, k) {
	if (m instanceof Map) {
		return m.get(k)
	}
	return m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined
}

/**
 * @param {{x: number, y: number, w: number, h: number, r?: number}|null} a absolute box (SceneModel.abs)
 * @param {{x: number, y: number, w: number, h: number, r?: number}|null} b absolute box
 * @return {boolean} the same x, y, w, h and r (job 146)
 */
function sameAbs(a, b) {
	if (!a || !b) {
		return a === b
	}
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && (a.r ?? 0) === (b.r ?? 0)
}

/**
 * (Job 227) The display value of a field for selection v2: a colour field
 * (rule 'color') as it is drawn (tokens.shownColor; a connector's line
 * through shownLine, job 260: a shape's border through shownBorder), anything else as fieldValue gives it.
 *
 * @param {object} it WireItem
 * @param {string} path field path
 * @return {unknown} the value, null when there is none
 */
function shownField(it, path) {
	const v = fieldValue(it, path) ?? null
	if (fieldRule(it.t, path)?.[0] !== 'color') {
		return v
	}
	if (path === 'style.stroke' && it.t === 'connector') return shownLine(v)
	// job 260: a shape's old default border as it is drawn (shapes.js shownBorder)
	if (path === 'style.stroke' && it.t === 'shape') return shownBorder(fieldValue(it, 'data.kind'), v)
	return shownColor(v)
}

/**
 * (Job 189) Did a meta change touch meta.comments and nothing else?
 *
 * @param {object} a meta before
 * @param {object} b meta after
 * @return {boolean}
 */
export function onlyCommentsChanged(a, b) {
	if (a.comments === b.comments) {
		return false
	}
	const keysOf = (m) => Object.keys(m).filter((k) => k !== 'comments')
	const ka = keysOf(a)
	const kb = keysOf(b)
	return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

/**
 * (Job 191) Did a meta change touch only the quiet keys (QUIET_META:
 * meta.comments, meta.tags), at least one of them?
 *
 * @param {object} a meta before
 * @param {object} b meta after
 * @return {boolean}
 */
export function onlyQuietChanged(a, b) {
	const same = (k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null)
	if (QUIET_META.every(same)) {
		return false
	}
	const keysOf = (m) => Object.keys(m).filter((k) => !QUIET_META.includes(k))
	const ka = keysOf(a)
	const kb = keysOf(b)
	return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

/**
 * (Job 191) meta before with the quiet keys of meta after: every other value
 * keeps its object (a vote, a timer).
 *
 * @param {object} a meta before
 * @param {object} b meta after
 * @return {object}
 */
function withQuietKeys(a, b) {
	const out = { ...a }
	for (const k of QUIET_META) {
		if (Object.prototype.hasOwnProperty.call(b, k)) {
			out[k] = b[k]
		} else {
			delete out[k]
		}
	}
	return out
}

/**
 * (R22, P7-08) Did the camera move against the one the vote stepper was
 * placed for? Half a screen pixel of movement or a scale change of 1e-6
 * counts; an unknown camera at the opening counts as moved on any report.
 *
 * @param {{x: number, y: number, scale: number}|null} at camera at the opening
 * @param {{x: number, y: number, scale: number}|null} c camera now (onCamera)
 * @return {boolean}
 */
export function cameraMoved(at, c) {
	if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !(c.scale > 0)) {
		return false
	}
	if (!at) {
		return true
	}
	return Math.abs(c.scale / at.scale - 1) > 1e-6 || Math.abs(c.x - at.x) * c.scale > 0.5 || Math.abs(c.y - at.y) * c.scale > 0.5
}

export class BoardSession {
	/**
	 * @param {object} o options
	 * @param {HTMLElement} o.container canvas host element
	 * @param {'user'|'guest'} o.mode signed-in user or guest
	 * @param {number|null} [o.boardId] board id
	 * @param {string|null} [o.linkToken] link token (guests)
	 * @param {boolean} [o.viewOnly] view-only DEVICE (no fine pointer); the mode also follows me.role (stage 2)
	 * @param {boolean} [o.touch] (job 183) the device has a touch screen (util/device.js hasTouchScreen); only true counts
	 * @param {boolean} [o.debug] install window.__knorke
	 * @param {object|null} [o.limits] initial-state limits (maxText, maxTitle, …) for the text editor;
	 *   maxItems/maxLabel fall back to 5000/200 (SPEC-M1 §4.8)
	 * @param {HTMLTextAreaElement|null} [o.pasteCatcher] textarea[data-knorke-paste-catcher] (SPEC-M1 §6.5.3)
	 * @param {object} [o.ui] shell callbacks (M0 plus onToolOptions(map) and
	 *   onConfirm({name, confirmLabel}) → Promise<boolean>, the question before pasting many notes)
	 * @param {object} [o.deps] injection points: SceneModel, SceneManager (required in the
	 *   app), transport (or request/urlOf for the real transports), storage, sleep, rand,
	 *   now, wall, win, installDebug, toast, info; parseHtml (DOMParser stand-in) and
	 *   clipboardIo ({doc, clipboard, ClipboardItem, Blob} for writeClipboard) in tests;
	 *   api (stage 3: the moderation calls of api/boards.js, startVote/updateVote/timer/summon/endSummon)
	 */
	constructor({ container, mode = 'user', boardId = null, linkToken = null, viewOnly = false, touch = false, debug = false, limits = null, pasteCatcher = null, ui = {}, deps = {} }) {
		this.container = container
		this.mode = mode === 'guest' ? 'guest' : 'user'
		this.boardId = boardId
		this.linkToken = linkToken
		/** The device has no fine pointer (util/device.js); fixed for the session. */
		this.deviceViewOnly = !!viewOnly
		/** (job 183) The device has a touch screen (util/device.js); fixed for the session. */
		this.deviceTouch = touch === true
		/** Client mode (SPEC-M1 §6.5.4): 'edit' | 'vote' | 'view'; from me.role and the device. */
		this.clientMode = this.deviceViewOnly ? 'view' : 'edit'
		/** No editing in the current mode (role or device). */
		this.viewOnly = this.clientMode !== 'edit'
		this.debug = !!debug
		this.limits = limitsWithDefaults(limits)
		this.ui = ui
		this.deps = deps
		this.storage = deps.storage ?? webStorage()
		this.sleep = deps.sleep ?? defaultSleep
		this.rand = deps.rand ?? Math.random
		this.now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
		this.win = deps.win !== undefined ? deps.win : (typeof window !== 'undefined' ? window : null)
		this.toast = deps.toast ?? showError
		this.info = deps.info ?? showInfo
		/** (job 217) the import() of each lazy part (util/parts.js PARTS; tests: deps.parts) */
		this.parts = deps.parts ?? PARTS
		/** (job 173) a file download (the CSV export of a table): (name, text) */
		this.download = deps.download ?? ((name, text) => downloadText(name, text))
		/** (job 178) a file download of a Blob (the PNG of an image): (name, blob) → started */
		this.downloadFile = deps.downloadBlob ?? ((name, blob) => downloadBlob(name, blob))
		/** (job 179) the language the CSV separator follows: () → e.g. 'de' */
		this.language = deps.language ?? language
		/** Wall clock (ms) for the stored copy's TTL (clipboard.js). */
		this.wall = deps.wall ?? Date.now
		/** The hidden paste catcher (textarea[data-knorke-paste-catcher], SPEC-M1 §6.5.3). */
		this.pasteCatcher = pasteCatcher
		/** Server time (SPEC-M1 §6.5.7); same monotonic clock as the sync loop. */
		this.clock = new Clock({ wall: deps.wall ?? Date.now, mono: this.now })
		/** Board epoch of the last snapshot/join (sent as `ep`), null until known. */
		this.epoch = null
		/** metaRev of the merged board view (SPEC-M1 §6.5.1). */
		this.metaRev = 0
		/** Server protocol of a snapshot/join answer that did not match (before the loop exists). */
		this.serverProto = null
		/** busy answers in a row since (this.now()), null when the last answer was not busy. */
		this.busySince = null
		this.busyToastShown = false
		/** While captureEditor() flushes the open editor: the text intents it catches. */
		this.capture = null
		/** Text intents of the open editor caught when the board froze for a hand-over. */
		this.frozenText = []
		/** Factory job 189: the comment threads of the board (live), the pick of "New comment", the bubbles switch. */
		this.comments = new CommentFeed({
			load: () => this.commentApi()?.list(),
			onChange: () => this.emitComments(),
			onError: (e) => console.warn('[knorke] loading the comments failed', e),
		})
		this.commentPicking = false
		this.bubbles = this.storage.getItem('local', keys.bubbles()) !== '0'

		this.counters = newCounters()
		this.replica = new Replica()
		// job 171: the others' laser trails play one poll of the device's cadence plus 500 ms late
		this.presence = new PresenceModel({ now: this.now, laserDelayMs: laserDelay(this.deviceViewOnly, deps.intervals ?? INTERVALS) })
		this.undoStack = new UndoStack(50)
		this.model = null
		this.scene = null
		this.sync = null
		this.transport = null
		this.client = null
		this.me = null
		this.board = null
		this.status = 'connecting'
		this.statusReason = null
		this.frozen = false
		this.destroyed = false

		this.selection = []
		/** (job 178) an image is being drawn (exportPng and, job 200, exportVector ignore further calls) */
		this.exporting = false
		/** (job 178) {name, format, width, height, scale, scaled, ids, bounds} of the last image that downloaded */
		this.lastExport = null
		/** Factory job 253: export and file insert (sessionFiles.js); each callback reads the session at the call. */
		const get = (k) => () => this[k]
		const call = (k) => (...a) => this[k](...a)
		this.files = new SessionFiles({
			...Object.fromEntries(FILES_STATE.map((k) => [k, get(k)])),
			...Object.fromEntries(FILES_CALLS.map((k) => [k, call(k)])),
			setExporting: (on) => {
				this.exporting = on
			},
			setLastExport: (last) => {
				this.lastExport = last
			},
		})
		/** Factory job 255: comments, reactions and the laser (sessionComments.js); each callback reads the session at the call. */
		this.talk = new SessionComments({
			...Object.fromEntries(COMMENTS_STATE.map((k) => [k, get(k)])),
			...Object.fromEntries(COMMENTS_CALLS.map((k) => [k, call(k)])),
			set: (k, v) => {
				if (COMMENTS_SETS.includes(k)) {
					this[k] = v
				}
			},
		})
		/** Factory job 257: the tag list, panels, filter and writes (sessionTags.js); each callback reads the session at the call. */
		this.tagging = new SessionTags({
			...Object.fromEntries(TAGS_STATE.map((k) => [k, get(k)])),
			...Object.fromEntries(TAGS_CALLS.map((k) => [k, call(k)])),
			set: (k, v) => {
				if (TAGS_SETS.includes(k)) {
					this[k] = v
				}
			},
		})
		/** Factory job 267: "Summarise" and "Cluster by topic" (sessionAi.js); each callback reads the session at the call. */
		this.ai = new SessionAi({
			...Object.fromEntries(AI_STATE.map((k) => [k, get(k)])),
			...Object.fromEntries(AI_CALLS.map((k) => [k, call(k)])),
		})
		/** (job 180) the last ui.onEmpty value (null before the first report) */
		this.lastEmpty = null
		this.pointer = null
		this.dragPreview = []
		this.editingId = null
		/** (job 173) the cell of the table editingId whose editor is open, else null */
		this.editingCell = null
		/** job 195: the focused node {id, key} of the one selected mind map (scene onNodeFocus), else null */
		this.mmFocus = null
		/** Item whose editor a text rescue opened, until that editor closes (T6). */
		this.rescueEditorId = null
		/** Item whose text lease this tab takes over; set until me.tk has reached the server. */
		this.takeoverId = null
		/** {id, path, text}: text rejected 'locked' because it went out before the take-over landed. */
		this.takeoverText = null
		this.leaseTail = null
		this.leaseLost = new Set()
		this.deferred = new Set()
		this.textSession = 0
		this.undoPending = new Set()
		this.deniedShown = false
		/** job 146: {id, p} of the newest "Arrange" patch sent (a rejected patch with this placement toasts arrange-bad). */
		this.arrangeSent = null
		/** job 146: ui.onSelection reports so far (arrange reports once, after its commit's flush or by itself). */
		this.selectionReports = 0
		this.camTimer = null
		this.listeners = []
		this.uninstallDebug = null
		/** U18: BroadcastChannel on which this tab defends its client id. */
		this.channel = null
		/** Tool options per tool ({kind} of shape; route/endCap of connector in 1b). */
		this.toolOptions = {}
		/** Running scene activities (drag, transform …) by kind. */
		this.activity = new Set()
		/** {ids, at, key}: the arrow-key series that merges into one undo step. */
		this.nudgeSeries = null
		this.nudgeCount = 0
		/** {id, key}: a new item whose first editing merges with its creation (one undo step). */
		this.newEdit = null
		/** {id, key}: undo key of the newest text commit (the height re-measure merges into it). */
		this.lastTextKey = null
		/** Pending paste of the catcher: {inPlace}. */
		this.pasteIntent = null
		this.catcherTimer = null
		this.detachCatcher = null
		/** {sig, k}: repeated pastes of the same payload on this board cascade by PASTE_STEP. */
		this.lastPaste = null
		/** Moderation REST calls (api/boards.js; tests inject a fake). */
		this.api = deps.api ?? boardsApi
		/** Dot vote (SPEC-M1 §6.5.5). */
		this.voteState = new VoteState()
		/** Desktop editors: vote mode while a session is open (the bar's switch; default at the start: true). */
		this.preferVote = false
		/**
		 * (Job 149) This tab shows the live count on the board (the bar's "Live
		 * count"): only this tab, never stored or sent; false on loading, at
		 * every new sid, at the close and when the moderation right goes.
		 */
		this.liveShown = false
		/** The vote panel is open (presence pauses while a session is open, §6.4). */
		this.votePanelOpen = false
		/** (R17 K4) A ui.onVotes for a model change is queued (one per tick). */
		this.voteItemsQueued = false
		/** (Job 216) Vote ops of the current answer that came back stale ({op, maybeApplied}), until its votes block. */
		this.staleVotes = []
		/** When vt went out last (this.now()). */
		this.vtAt = -Infinity
		/** When the last voteMiss hint was shown (this.now()). */
		this.missAt = -Infinity
		/** FollowController: following and "Bring everyone here" (SPEC-M1 §6.5.6), from open() on. */
		this.follower = null
		/** The automatic end at endsAt: {sid, endsAt, ctl} or null. */
		this.autoEnd = null
		/** Camera changes poke the sync loop at most every CAMERA_POKE_MS (presence v). */
		this.camPokeAt = -Infinity
		/** Last clock offset reported to the shell (ui.onClockSkew). */
		this.skewShown = 0
		/** Open context menu (stage 4, §6.6): {id, at, world, ids, seq} or null. */
		this.menu = null
		/** Open vote stepper (R22, P7-08): {id, cam} (camera at its opening) or null. */
		this.stepper = null
		/** The session reloads the page itself (status 'reload'): beforeunload stays quiet (R22, P7-07). */
		this.selfReload = false
		this.menuSeq = 0
		/**
		 * Job 139: the name fields after "Sort by color": {blocks (sortNotesByColor), open (indexes of
		 * the fields still shown), texts (index → typed text)} or null.
		 */
		this.sortLabels = null
		/** Job 139: nameSortBlock is committing (that commit does not end the fields). */
		this.sortNaming = false
		/** Job 142: this session showed the one-time touch tip (also when storing it failed). */
		this.touchTipShown = false
		/** Job 147: other people's cursors are shown (knorke.cursors, read in open()). */
		this.cursors = true
		/** Job 147: the last toast of toggleCursors ({hideToast}) or null. */
		this.cursorsToast = null
		/** Job 154: the last toast of cycleWheel ({hideToast}) or null. */
		this.wheelToast = null
		/** Job 172: the open reaction picker {id, rect, cam, mode} (camera and client mode at its opening) or null. */
		this.reactPicker = null
		/** Job 172: the open names or list of a note's reactions {kind, id, e, rect, cam, hold} or null. */
		this.reactPopup = null
		/** Job 171: the own laser points [x, y, t] (t = this.now()) and null between strokes, oldest first. */
		this.laser = []
		/** Job 171: the stroke ended (onLaser(null)); the next point starts a new one. */
		this.laserEnded = false
		/** Job 191: this tab's tag filter, the chosen tag ids (never sent, gone on reload). */
		this.tagFilter = []
		/** Job 191: the open tag panel {kind: 'tag'|'filter'|'list', rect, id?, cam?} or null. */
		this.tagPanel = null
		/** Job 191: a write of the tag list runs. */
		this.tagBusy = false
		/** Job 206: the queue of undo/redo while a tag step's write runs (a promise), else null. */
		this.historyQueue = null
	}

	/**
	 * @return {string} key part for per-board storage (board id, or the link for
	 *   a guest before the join answered)
	 */
	storageId() {
		return this.boardId !== null && this.boardId !== undefined ? String(this.boardId) : 'link-' + this.linkToken
	}

	/** @return {object|null} stored guest entry {token, name, link} */
	getGuest() {
		const g = this.storage.getJson('local', keys.guest(this.storageId()))
		return g && typeof g === 'object' && typeof g.token === 'string' ? g : null
	}

	/**
	 * Opens the board: join (guest) or snapshot (user) → replica → model →
	 * scene → camera → sync loop.
	 *
	 * @param {string|null} [guestName] name for a new guest (null: stored name)
	 * @param {string|null} [password] link password from the guest name dialog (stage 2)
	 * @return {Promise<{me: object, board: object}>}
	 * @throws {HttpError} when the board cannot be opened
	 */
	async open(guestName = null, password = null) {
		const { SceneModel, SceneManager } = this.deps
		if (!SceneModel || !SceneManager) {
			throw new Error('BoardSession needs deps.SceneModel and deps.SceneManager')
		}
		this.client = this.loadClientId()
		// U18: in parallel with the snapshot; a duplicated tab gets a fresh id
		const claim = this.claimClientId(this.client)
		this.transport = this.deps.transport ?? this.makeTransport()
		let t0 = this.now()
		const snap = await this.withProxyRetry(() => {
			t0 = this.now()
			return this.transport.kind === 'guest' ? this.transport.join(guestName, password) : this.transport.snapshot()
		})
		const t1 = this.now()
		this.client = await claim
		if (this.destroyed) {
			return { me: snap?.me, board: snap?.board }
		}
		if (snap?.proto !== PROTOCOL) {
			// SPEC-M1 §4.3: like a 409, before the first /sync
			throw this.protocolMismatch(snap?.proto)
		}
		this.clock.sample({ now: snap.now, t0, t1 })
		if (this.boardId === null && Number.isInteger(snap?.board?.id)) {
			this.boardId = snap.board.id
		}
		this.me = snap.me ?? null
		this.takeBoard(snap)
		// SPEC-M1 §6.5.4/§6.5.5: the session decides the first mode
		const voteStart = this.takeVoteMeta(snap.votes ?? null)
		this.clientMode = this.modeNow()
		this.viewOnly = this.clientMode !== 'edit'
		const items = Array.isArray(snap.items) ? snap.items : []
		this.replica.loadSnapshot(items, snap.rev)
		this.model = new SceneModel()
		this.model.load(items.map((it) => structuredClone(it)))
		this.scene = new SceneManager(this.container, this.model, {
			mode: this.clientMode,
			viewOnly: this.viewOnly,
			shadows: true,
			// the background grid of this person (R12): '1' = on, anything else off
			grid: this.storage.getItem('local', keys.grid()) === '1',
			// snapping to the shown grid: '0' = off, anything else (missing too) on
			gridSnap: this.storage.getItem('local', keys.gridSnap()) !== '0',
			// job 154: the mouse wheel of this browser, 'zoom' or 'pan', anything else automatic
			wheel: storedWheel(this.storage.getItem('local', keys.wheel())),
			callbacks: this.sceneCallbacks(),
			limits: this.limits,
			// job 198: the editor of an org chart card: the name, then the role on the next line
			cardPlaceholder: t('knorke', 'Name ({key}: role)', { key: shortcut('mm-break', isApplePlatform(this.win?.navigator ?? null)).hint }),
		})
		this.scene.mount()
		this.focusCanvasOnOpen()
		const cam = this.storage.getJson('local', keys.camera(this.storageId()))
		if (cam && Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.scale) && cam.scale > 0) {
			this.scene.setCamera({ x: cam.x, y: cam.y, scale: cam.scale })
		} else {
			this.scene.fit()
		}
		// job 147: other people's cursors, '0' = hidden, anything else shown
		this.cursors = this.storage.getItem('local', keys.cursors()) !== '0'
		this.scene.setRemoteSampler((nowMs) => this.remoteSamples(nowMs))
		// job 171: the own laser trail in the own presence colour
		this.scene.setLaserColor?.(colorFor(this.me?.pid ?? ''))
		this.follower = new FollowController({
			scene: () => this.scene,
			presence: this.presence,
			now: this.now,
			sleep: this.sleep,
			self: () => ({ pid: this.me?.pid ?? null, client: this.client }),
			sessionOpen: () => this.voteState.open,
			onChange: (st) => this.emitFollow(st),
			onLeft: (name) => this.info(t('knorke', '{name} left.', { name })),
			frameRect: (id) => (this.model?.get(id)?.t === 'frame' ? this.model.abs(id) : null),
			frameInsets: () => ({ bottom: this.slideInsets.bottom }),
		})
		// factory job 272: frames as slides (the presenter's side); the screen
		// px the presentation's bars cover at the right and bottom edge
		this.slideInsets = { right: 0, bottom: 0 }
		this.slideRole = null
		this.slideShow = new SlideShow({
			frames: () => this.frames(),
			reading: (ids) => actions.readingOrder(this.model, ids),
			meta: () => (this.board?.meta && typeof this.board.meta === 'object' ? this.board.meta : {}),
			presenting: () => this.isPresenting(),
			api: {
				start: (f) => this.moderate(() => this.api.summon(this.boardId, this.client, f)),
				move: (f) => this.moderate(() => this.api.moveSummon(this.boardId, f)),
				save: (o) => this.moderate(() => this.api.saveSlides(this.boardId, o)),
				end: () => this.endSummon(),
			},
			show: (f) => this.showSlide(f),
			onChange: () => this.emitSlides(),
		})
		this.sync = new SyncClient({
			transport: this.transport,
			replica: this.replica,
			client: this.client,
			// the device decides the cadence (viewMs); presence follows the mode (getPresence)
			viewOnly: this.deviceViewOnly,
			getPresence: () => this.getPresence(),
			getHiddenPresence: () => this.getHiddenPresence(),
			onChanges: (it, rm) => this.onChanges(it, rm),
			onAcks: (acks) => this.onAcks(acks),
			onSettled: (cursor) => this.onSettled(cursor),
			onPresence: (map) => this.onPresence(map),
			onStatus: (s, reason) => this.onStatus(s, reason),
			onResync: () => this.resync(),
			onPresenceSent: (me) => this.onPresenceSent(me),
			getEpoch: () => this.epoch,
			getRole: () => this.accessLevel(),
			getVoteTally: () => this.voteTally(),
			onMeta: (board) => this.onMeta(board),
			onRole: (me) => this.onRole(me),
			onVotes: (votes) => this.onVotes(votes),
			onClock: (c) => this.onClock(c),
			now: this.now,
			sleep: this.sleep,
			rand: this.rand,
			...(this.deps.intervals ? { intervals: this.deps.intervals } : {}),
		})
		this.addListeners()
		// job 172: who may react and which pills are mine
		this.pushReactions()
		// job 191: the board's tags
		this.pushTags()
		// job 267: the AI of the board (route 59) and the heights of its cards
		this.ai.fixHeights(modelItems(this.model))
		this.ai.load()
		if (this.pasteCatcher) {
			this.detachCatcher = attachPasteCatcher(this.pasteCatcher, (data) => this.onCatcherPaste(data))
		}
		this.emitBoard()
		this.emitEmpty()
		this.ui.onMode?.(this.clientMode)
		this.afterVoteMeta(voteStart, { initial: true })
		this.emitUndo()
		this.emitParticipants()
		const z = this.scene.getCamera()
		this.ui.onZoom?.(Math.round((z?.scale ?? 1) * 100))
		this.ui.onTool?.(this.scene.getTool?.() ?? 'select')
		this.emitToolOptions()
		if (this.debug && this.deps.installDebug) {
			this.uninstallDebug = this.deps.installDebug(this)
		}
		this.sync.start(Number.isInteger(snap.rev) ? snap.rev : 0)
		return { me: this.me, board: this.board }
	}

	/**
	 * A snapshot or join answer with another protocol than this bundle
	 * (SPEC-M1 §4.3): status 'reload' and the automatic reload once per server
	 * version, exactly as for a 409 (nothing can be at stake before the first
	 * /sync). The caller throws the returned error.
	 *
	 * @param {unknown} proto `proto` of the answer
	 * @return {HttpError} 409 `protocol` with the server version in its body
	 */
	protocolMismatch(proto) {
		const version = protoValue(proto)
		this.serverProto = version
		this.onStatus('reload')
		return new HttpError(409, 'protocol', 'Protocol mismatch', null, true, { error: 'protocol', proto: version })
	}

	/**
	 * Takes over the board view, epoch and metaRev of a snapshot or join
	 * answer (first load and resync: the snapshot is authoritative).
	 *
	 * @param {object} snap snapshot (§4.4)
	 */
	takeBoard(snap) {
		this.board = snap.board && typeof snap.board === 'object' ? { ...snap.board } : null
		this.metaRev = Number.isInteger(snap.board?.metaRev) ? snap.board.metaRev : 0
		this.epoch = typeof snap.epoch === 'string' && snap.epoch !== '' ? snap.epoch : null
		// job 189: meta.comments loads the comment threads (without the key: nothing)
		this.comments.meta(metaMapOf(this.board?.meta)?.comments)
		// job 191: the board's tags (a resync snapshot: the scene follows)
		this.pushTags()
	}

	/**
	 * Board metadata from a sync answer, the own rename or (stage 3) a
	 * moderation route: {title?, meta?, metaRev}. Only a metaRev above the
	 * known one counts, and only the keys that are present are merged
	 * (SPEC-M1 §6.5.1, R2); links, linksAllowed and the rest stay.
	 *
	 * @param {object} board the `board` block
	 * @return {boolean} the board view changed
	 */
	onMeta(board) {
		if (!board || typeof board !== 'object' || !Number.isInteger(board.metaRev) || board.metaRev <= this.metaRev) {
			return false
		}
		const next = { ...(this.board ?? {}) }
		if (typeof board.title === 'string') {
			next.title = board.title
		}
		const meta = metaMapOf(board.meta)
		const before = metaMapOf(this.board?.meta) ?? {}
		// job 189: a change of meta.comments alone keeps every other value (and its object) as it was;
		// job 191: so does one of meta.tags (alone or with the comments)
		const onlyComments = meta !== null && onlyQuietChanged(before, meta)
		const tagsChanged = meta !== null && JSON.stringify(before.tags ?? null) !== JSON.stringify(meta.tags ?? null)
		if (meta !== null) {
			next.meta = onlyComments ? withQuietKeys(before, meta) : meta
		}
		next.metaRev = board.metaRev
		this.metaRev = board.metaRev
		this.board = next
		this.emitBoard()
		if (meta !== null && privateOf(before) !== null && wantsResync(before, meta, this.coveredCount() > 0)) {
			// job 275: the reveal changed no row the cursor sees again: the texts come with a new snapshot
			this.sync?.requestResync?.()
		}
		if (meta !== null) {
			// job 267: the board switch "Allow AI on this board" shows or hides the AI buttons at once
			if ((before.ai ?? null) !== (meta.ai ?? null)) {
				this.ai.emit()
				this.emitSelection()
			}
			this.comments.meta(meta.comments)
			if (tagsChanged) {
				// job 191: only the notes are drawn again: no toast, no mode switch
				this.pushTags()
			}
			if (!onlyComments) {
				// stage 3: vote session, summon (SPEC-M1 §6.5.1 "an Shell, VoteState und FollowController")
				this.applyMeta()
			}
		}
		return true
	}

	/**
	 * Answer of the own rename (route 7, SPEC-M1 §6.5.1, §15 R4). The board
	 * object of an M1 server carries {title, meta, metaRev} from
	 * MetaService::write; it takes the onMeta path:
	 * - metaRev ≤ known → ignored as a whole, title included (a newer rename
	 *   from elsewhere already arrived through a sync answer);
	 * - otherwise only title and meta are merged (never role, links,
	 *   linksAllowed or the list-row keys of the answer), and the next sync's
	 *   `board` with the same metaRev changes nothing.
	 * An answer with a metaRev but without the meta map is not the whole state
	 * at that metaRev (another moderator may have changed meta in between): its
	 * title is merged, the known metaRev stays, so the sync's `board` block
	 * still brings the meta. Without a metaRev (M0 server) only the title is
	 * merged, as before.
	 * The open rename field is never touched here: the top bar keeps its own
	 * draft (components/TopBar.vue, components/title.js).
	 *
	 * @param {object|null} b `board` of the answer
	 * @return {boolean} the board view changed
	 */
	applyBoardUpdate(b) {
		if (!b || typeof b !== 'object') {
			return false
		}
		const title = typeof b.title === 'string' ? { title: b.title } : {}
		if (Number.isInteger(b.metaRev)) {
			if (b.metaRev <= this.metaRev) {
				return false
			}
			const meta = metaMapOf(b.meta)
			if (meta !== null) {
				return this.onMeta({ metaRev: b.metaRev, ...title, meta })
			}
		}
		if (title.title === undefined) {
			return false
		}
		this.mergeBoard(title)
		return true
	}

	/**
	 * Shell changes of the board view that no answer reports back (a link
	 * turned on or off): merged into the session's view, so a later meta
	 * update never brings back an old value.
	 *
	 * @param {object} partial keys to replace (e.g. {links}, {linksAllowed})
	 */
	mergeBoard(partial) {
		if (!partial || typeof partial !== 'object') {
			return
		}
		this.board = { ...(this.board ?? {}), ...partial }
		this.emitBoard()
	}

	emitBoard() {
		this.ui.onBoard?.({ board: this.board ? { ...this.board } : null, me: this.me })
		// job 189: the right to comment follows the role
		this.emitComments()
	}

	/**
	 * Live role change (SPEC-M1 §4.5, §6.5.4): the `me` block of a sync
	 * answer, {role, mod}.
	 *
	 * @param {{role: string, mod: boolean}} me `me` block of a sync answer
	 * @return {boolean} role or mod changed
	 */
	onRole(me) {
		if (!me || typeof me !== 'object') {
			return false
		}
		return this.applyRole(me.role, me.mod === true)
	}

	/**
	 * Takes over a new role and moderation right: me and board.role follow,
	 * one toast for a new access level, the mode switches at once, the shell
	 * gets the board view again (share button: owner || me.mod).
	 *
	 * @param {string} role new me.role (owner|edit|vote|view)
	 * @param {boolean} mod new me.mod
	 * @return {boolean} changed
	 */
	applyRole(role, mod) {
		if (typeof role !== 'string' || !ROLES.includes(role) || this.destroyed) {
			return false
		}
		if (this.me?.role === role && (this.me?.mod === true) === mod) {
			return false
		}
		const before = this.accessLevel()
		this.me = { ...(this.me ?? {}), role, mod }
		if (this.board) {
			this.board = { ...this.board, role }
		}
		// job 149: without the moderation right no live count (tally and board counts)
		this.voteState.setMe(this.me)
		if (!this.voteState.liveAllowed()) {
			this.liveShown = false
		}
		// a new role: a denial of the next ops is news again (toasted once)
		this.deniedShown = false
		const text = roleToastText(roleToastFor(before, this.accessLevel()))
		if (text !== null) {
			this.info(text)
		}
		this.updateMode()
		this.emitBoard()
		// job 172: other rights close the picker; the scene, names and list follow
		this.closeReactionPicker()
		this.pushReactions()
		this.emitReactionPopup()
		// stage 3: markVotable, vt and the automatic end follow role and mod
		this.pushVoteState()
		this.scheduleAutoEnd()
		this.emitVotes()
		return true
	}

	/**
	 * @return {'edit'|'vote'|'view'} mode for the current role, device and
	 *   vote session (SPEC-M1 §6.5.4 modeFor)
	 */
	modeNow() {
		// job 175: a guest kept from voting is in the mode of a board without a session
		return modeFor(this.me?.role ?? null, this.deviceViewOnly, { sessionOpen: this.voteState.open && !this.voteBlocked, preferVote: this.preferVote })
	}

	/**
	 * (Job 175) This guest may not vote now: a guest session (mode 'guest')
	 * while a session with cfg.accountsOnly is open. False again at the end.
	 *
	 * @return {boolean}
	 */
	get voteBlocked() {
		return this.mode === 'guest' && this.voteState.open && this.voteState.cfg.accountsOnly === true
	}

	/** @return {boolean} this person may vote now: canVote(me.role) and not kept out by accountsOnly (job 175) */
	mayVote() {
		return canVote(this.me?.role) && !this.voteBlocked
	}

	/**
	 * Applies the mode of the current role, device and session: scene,
	 * presence, shell. Editing that goes away ends an open editor with the
	 * notice (the text stays to be copied; its queued text ops are dropped
	 * like after a lost lease) – unless the switch settles (a vote session
	 * starts, or the desktop switch "Vote"): then the scene commits the open
	 * editor and ends a drag like a release BEFORE the mode changes, while
	 * this session still applies edit intents (SPEC-M1 §6.5.4, R13 settle).
	 *
	 * @param {{settle?: boolean}} [o] settle the scene's open work first
	 */
	updateMode({ settle = false } = {}) {
		const next = this.modeNow()
		if (next === this.clientMode) {
			return
		}
		const lostEdit = this.clientMode === 'edit' && next !== 'edit'
		if (lostEdit) {
			this.closeMenu()
		}
		// job 172: another mode closes the reaction picker
		this.closeReactionPicker()
		// job 139: a mode switch ends the name fields; typed names are saved only
		// when the switch settles (like the open editor), while edit still applies
		this.endSortLabels({ save: settle && lostEdit && !this.frozen })
		if (settle && lostEdit && !this.frozen) {
			this.setSceneMode(next, { settle: true })
			this.clientMode = next
			this.viewOnly = next !== 'edit'
		} else {
			this.clientMode = next
			this.viewOnly = next !== 'edit'
			if (!this.frozen) {
				this.setSceneMode(next)
			}
		}
		const editKey = this.editKey()
		if (lostEdit && editKey !== null && !this.leaseLost.has(editKey)) {
			this.loseLease(editKey, this.noticeFor(editKey, 'denied'))
		}
		this.pushVoteState()
		this.ui.onMode?.(next)
		this.emitVotes()
		// job 191: the tag panel works in mode edit only
		this.checkTags()
		this.sync?.poke()
	}

	/**
	 * Scene facade v2 (SPEC-M1 §6.3): setMode; setViewOnly is the M0 alias
	 * for a scene without it. Without settle losing a role cancels like Esc.
	 *
	 * @param {'edit'|'vote'|'view'} mode client mode
	 * @param {{settle?: boolean}} [o] settle (R13): finish open work like a release first
	 */
	setSceneMode(mode, { settle = false } = {}) {
		const sc = this.scene
		if (!sc) {
			return
		}
		try {
			if (typeof sc.setMode === 'function') {
				if (settle) {
					sc.setMode(mode, { settle: true })
				} else {
					sc.setMode(mode)
				}
			} else if (typeof sc.setViewOnly === 'function') {
				sc.setViewOnly(mode !== 'edit')
			}
		} catch (e) {
			console.error('[knorke] scene.setMode failed', e)
		}
	}

	// ---- stage 3: voting -------------------------------------------------

	/**
	 * meta.vote of the merged board view and the votes block of a snapshot or
	 * join answer into VoteState (no side effects on scene or shell).
	 *
	 * @param {object|null} votes {sid, mine, left} of the answer (or null)
	 * @return {object} setSession's result
	 */
	takeVoteMeta(votes) {
		const meta = this.board?.meta && typeof this.board.meta === 'object' ? this.board.meta : {}
		const r = this.voteState.setSession(meta.vote, this.me)
		if (r.newSid) {
			this.vtAt = -Infinity
		}
		if (r.newSid || !this.voteState.liveAllowed()) {
			// job 149: the board counts start hidden with every session and end with it
			this.liveShown = false
		}
		if (r.opened) {
			// the default at the start of a session: vote (SPEC-M1 §6.5.4)
			this.preferVote = true
		}
		if (votes && typeof votes === 'object') {
			if (this.voteState.setMine(votes.sid, votes.mine, votes.left)) {
				this.voteState.ack(null, null, this.pendingVotes())
			}
		}
		return r
	}

	/**
	 * meta changed (sync answer, moderation answer, resync): VoteState,
	 * mode (a new session settles the scene first), scene, follow, shell.
	 *
	 * @param {{votes?: object|null}} [o] votes block of a resync snapshot
	 */
	applyMeta({ votes = null } = {}) {
		const r = this.takeVoteMeta(votes)
		const before = this.clientMode
		this.updateMode({ settle: r.opened })
		if (r.opened && before === 'edit' && this.clientMode === 'vote') {
			this.info(t('knorke', 'Voting started. You are in vote mode; switch back with “Edit”.'))
		}
		this.afterVoteMeta(r, { initial: false })
	}

	/**
	 * The rest of a meta change: tablet camera at a new session, scene vote
	 * state, summon, automatic end, shell.
	 *
	 * @param {object} r setSession's result
	 * @param {{initial: boolean}} o initial: open() (no "started"/"closed" event)
	 */
	afterVoteMeta(r, { initial }) {
		const meta = this.board?.meta && typeof this.board.meta === 'object' ? this.board.meta : {}
		this.follower?.onSummon(meta.summon)
		this.slideShow?.sync()
		this.emitSlides()
		if (r.opened && this.deviceViewOnly && this.clientMode === 'vote' && !this.follower?.target) {
			this.cameraToVoteArea()
		}
		this.pushVoteState()
		this.scheduleAutoEnd()
		this.emitVotes(initial ? null : r.opened ? 'started' : r.closed ? 'closed' : null)
		if (this.isPresenting()) {
			// the presenting tab's v goes out at once (followers wait for it)
			this.sync?.poke()
		}
	}

	/**
	 * Vote ops still queued or in flight for the current session (they stay
	 * on top of the server state, VoteState.ack).
	 *
	 * @return {Map<string, number>} item id → n (the newest op wins)
	 */
	pendingVotes() {
		const out = new Map()
		const sid = this.voteState.sid
		for (const op of this.replica.pendingOps().ops) {
			if (op && op.o === 'vote' && op.s === sid && typeof op.id === 'string') {
				out.set(op.id, op.n)
			}
		}
		return out
	}

	/**
	 * `votes` block of a sync answer (SPEC-M1 §4.5): after onAcks and onMeta
	 * of the same answer; a foreign sid is dropped (R16 SRV-03). (Job 216)
	 * The vote ops of the same answer that came back stale are carried onto
	 * the state the block brings (rebaseVotes, silently at most perItem), once,
	 * and only when the block of the current sid with `mine` was taken; else
	 * they stay dropped.
	 *
	 * @param {object} votes `votes` block of a sync answer
	 */
	onVotes(votes) {
		const r = this.voteState.ack(null, votes, this.pendingVotes())
		const stale = this.staleVotes.filter((f) => f.op.s === this.voteState.sid)
		this.staleVotes = []
		if (r.taken) {
			this.pushVoteState()
			this.emitVotes()
			if ('mine' in votes) {
				for (const [id, n] of rebaseVotes(stale, this.voteState.mine, this.voteState.cfg.perItem)) {
					this.vote(id, n)
				}
			}
		}
	}

	/**
	 * `vt` of the next request (SPEC-M1 §4.5, R16 SRV-01): moderators only,
	 * only while meta.vote is open, at most every VT_EVERY_MS; else omitted.
	 *
	 * @return {number|null}
	 */
	voteTally() {
		if (this.me?.mod !== true || !this.voteState.open) {
			return null
		}
		const now = this.now()
		if (now - this.vtAt < VT_EVERY_MS) {
			return null
		}
		this.vtAt = now
		return this.voteState.vt
	}

	/**
	 * SceneVoteState for the scene (SPEC-M1 §6.3, R16): null without meta.vote.
	 *
	 * @return {object|null}
	 */
	sceneVoteState() {
		const v = this.voteState
		if (v.state === null) {
			return null
		}
		const badges = v.badges({ live: this.liveShown })
		if (this.liveShown) {
			// job 149: the live totals only on items the model has
			for (const id of [...badges.keys()]) {
				if (!this.model?.has(id)) {
					badges.delete(id)
				}
			}
		}
		return {
			// the scene asks with an id; a real boolean (S-13)
			votable: (id) => v.votable(typeof id === 'string' && this.model?.has(id) ? this.model.get(id) : null),
			scope: v.scope,
			badges,
			markVotable: v.open && this.clientMode === 'vote',
			color: colorFor(this.me?.pid ?? ''),
			// job 149: the totals are the live count (drawn hollow)
			live: this.liveShown,
		}
	}

	/**
	 * (Job 149) The bar's "Live count": shows or hides the live count on the
	 * board of this tab only (never stored, never sent). Only for a moderator
	 * while a session with live is open; else nothing changes.
	 *
	 * @param {boolean} on show the board counts
	 * @return {boolean} taken
	 */
	setLiveShown(on) {
		if (!this.voteState.liveAllowed()) {
			return false
		}
		const next = on === true
		if (next !== this.liveShown) {
			this.liveShown = next
			this.pushVoteState()
			this.emitVotes()
		}
		return true
	}

	/**
	 * @return {Array<[string, number]>|null} the live count (job 149) of the
	 *   items the model has, descending; null without one and for everyone
	 *   without the moderation right
	 */
	liveTally() {
		const tally = this.me?.mod === true ? this.voteState.tally : null
		return tally ? tally.filter(([id]) => !!this.model?.has(id)) : null
	}

	/** Hands the vote state to the scene (a TypeError of the scene is logged, the old state stays). */
	pushVoteState() {
		const sc = this.scene
		if (!sc || typeof sc.setVoteState !== 'function') {
			return
		}
		try {
			sc.setVoteState(this.sceneVoteState())
		} catch (e) {
			console.error('[knorke] setVoteState failed', e)
		}
	}

	/**
	 * What the shell shows (VoteBar, VotePanel; ui.onVotes).
	 *
	 * @param {'started'|'closed'|null} [event] a session started or this sid turned closed (once)
	 * @return {object}
	 */
	votesView(event = null) {
		const v = this.voteState
		const mod = this.me?.mod === true
		const scope = v.scope
		const frame = scope !== null && this.model?.has(scope) ? this.model.get(scope) : null
		return {
			sid: v.sid,
			state: v.state,
			open: v.open,
			left: v.left,
			per: v.cfg.per,
			perItem: v.cfg.perItem,
			types: v.cfg.types,
			scope,
			scopeTitle: frame ? String(frame.data?.title ?? '') : null,
			mine: v.mine,
			endsAt: v.endsAt,
			results: v.results,
			total: v.total,
			// live only for moderators; after the close meta.vote.voters is for everyone
			voters: v.open ? (mod ? v.voters : null) : v.voters,
			show: v.show,
			by: v.by,
			mod,
			canVote: this.mayVote(),
			mode: this.clientMode,
			canSwitch: v.open && canEdit(this.me?.role) && !this.deviceViewOnly && !this.voteBlocked,
			// job 149: the live count option, this tab's board counts, the ranking (moderators only)
			live: v.cfg.live,
			liveShown: this.liveShown,
			tally: this.liveTally(),
			// job 175: only accounts vote; this guest is kept from voting
			accountsOnly: v.cfg.accountsOnly,
			voteBlocked: this.voteBlocked,
			event,
		}
	}

	/** @param {'started'|'closed'|null} [event] see votesView */
	emitVotes(event = null) {
		// mode, role, session and model changes all end here (R22, P7-08)
		this.checkStepper()
		this.ui.onVotes?.(this.votesView(event))
	}

	/**
	 * (R17 K4, SPEC-M1 §6.6 VotePanel) The model changed (an item added,
	 * deleted, re-parented or its text edited): while a session exists, the
	 * shell gets one light ui.onVotes at the end of this tick, so the open
	 * vote list (votableItems) and votesView().scopeTitle follow the model,
	 * not only votes events. Every change of the same turn (onChanges, onAcks,
	 * local edits) is coalesced into one call by a microtask; nothing happens
	 * without a session.
	 */
	voteItemsChanged() {
		if (this.voteState.state === null || this.voteItemsQueued) {
			return
		}
		this.voteItemsQueued = true
		queueMicrotask(() => {
			this.voteItemsQueued = false
			if (!this.destroyed && this.voteState.state !== null) {
				this.emitVotes()
			}
		})
	}

	/**
	 * __knorke.votes() (SPEC-M1 §6.7, R16 CLI-12): JSON-serialisable shapes.
	 *
	 * @return {object}
	 */
	votesDebug() {
		const v = this.voteState
		if (v.state === null) {
			return { sid: null, state: null, open: false, left: null, mine: {}, results: null, voters: null, live: false, liveShown: false, tally: null, accountsOnly: false, voteBlocked: false, canVote: this.mayVote() }
		}
		return {
			sid: v.sid,
			state: v.state,
			open: v.open,
			left: v.left,
			mine: { ...v.mine },
			results: v.state === 'closed' ? v.results : null,
			voters: this.me?.mod === true ? v.voters : null,
			live: v.cfg.live,
			liveShown: this.liveShown,
			tally: this.liveTally(),
			// job 175
			accountsOnly: v.cfg.accountsOnly,
			voteBlocked: this.voteBlocked,
			canVote: this.mayVote(),
		}
	}

	/**
	 * Sets my votes on an item (SPEC-M1 §6.5.5): a vote op, not in the undo
	 * stack; tablets send it with the 2-s tick (not urgent). (R22, P7-10) Only
	 * the canvas tap of perItem = 1 passes tap: the vote list and the stepper
	 * are never taken for a double tap. (Job 216) The op carries the base b,
	 * my number on the item this change starts from (pending ops included):
	 * when another tab of mine changed it meanwhile, the server answers
	 * `stale` and onVotes carries the change onto the new state.
	 *
	 * @param {string} id item id
	 * @param {number} n my votes on it (0 = none)
	 * @param {{tap?: boolean}} [o] tap: the toggle tap on the canvas (double-tap lock)
	 * @return {boolean} proposed and queued
	 */
	vote(id, n, { tap = false } = {}) {
		// job 175: a guest of a session with accountsOnly queues nothing (the server would deny it)
		if (this.frozen || !this.sync || !this.mayVote()) {
			return false
		}
		const b = this.voteState.mine[id] ?? 0
		const r = this.voteState.propose(id, n, this.clock.now(), { tap })
		if (!r.ok) {
			if (r.reason === 'limit') {
				this.voteToast('vote-limit', t('knorke', 'You have no votes left.'))
			} else if (r.reason === 'closed') {
				this.voteToast('vote-closed', t('knorke', 'Voting has ended.'))
			}
			return false
		}
		this.sync.enqueue([{ o: 'vote', s: this.voteState.sid, id, n, b }], { urgent: !this.deviceViewOnly })
		this.pushVoteState()
		this.emitVotes()
		return true
	}

	/**
	 * Intents vote/voteMiss of mode vote (SPEC-M1 §6.3, §6.5.5).
	 *
	 * @param {object} i intent
	 */
	voteIntent(i) {
		if (i.type === 'vote') {
			const id = i.id
			if (typeof id !== 'string' || !this.voteState.open) {
				return
			}
			if (this.voteState.cfg.perItem > 1) {
				// the stepper at the item (VoteStepper, ≥ 44 px buttons)
				this.openStepper(id, i.rect ?? this.scene?.itemScreenRect?.(id) ?? null)
				return
			}
			const now = this.voteState.mine[id] ?? 0
			this.vote(id, now > 0 ? 0 : 1, { tap: true })
			return
		}
		if (typeof i.id !== 'string' || !this.model?.has(i.id)) {
			return
		}
		const reason = this.voteState.missReason(this.model.get(i.id))
		const now = this.now()
		if (reason === null || now - this.missAt < MISS_HINT_MS) {
			return
		}
		this.missAt = now
		if (reason === 'scope') {
			const frame = this.voteState.scope !== null && this.model.has(this.voteState.scope) ? this.model.get(this.voteState.scope) : null
			const title = String(frame?.data?.title ?? '').trim() || t('knorke', 'Frame')
			this.voteToast('vote-miss', t('knorke', 'Only items in “{frame}” can get votes.', { frame: title }))
		} else {
			this.voteToast('vote-miss', t('knorke', 'This kind of item can\'t get votes in this session.'))
		}
	}

	/**
	 * Opens the vote stepper at an item (ui.onStepper) and remembers the
	 * camera it was placed for (R22, P7-08).
	 *
	 * @param {string} id item id
	 * @param {{x: number, y: number, w: number, h: number}|null} rect item's screen rectangle (container px)
	 */
	openStepper(id, rect) {
		const cam = this.scene?.getCamera?.() ?? null
		this.stepper = { id, cam: cam && Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.scale) ? { x: cam.x, y: cam.y, scale: cam.scale } : null }
		this.ui.onStepper?.({ id, rect })
	}

	/** Closes the vote stepper (the shell's ×, Esc, a press elsewhere, or a rule of checkStepper). */
	closeStepper() {
		if (this.stepper === null) {
			return
		}
		this.stepper = null
		this.ui.onStepper?.(null)
	}

	/**
	 * (R22, P7-08) The stepper stands at its item for the camera of its
	 * opening; it closes when it could vote for something else or nothing:
	 * its item left the model or the voting area, the mode is not 'vote', this
	 * person may not vote, no session is open, or the board froze.
	 */
	checkStepper() {
		const st = this.stepper
		if (st === null) {
			return
		}
		const item = this.model?.has(st.id) ? this.model.get(st.id) : null
		if (this.frozen || this.destroyed || this.clientMode !== 'vote' || !this.mayVote() || !this.voteState.open || !item || !this.voteState.votable(item)) {
			this.closeStepper()
		}
	}

	/**
	 * @param {string} hook [data-knorke-toast] value
	 * @param {string} text message
	 */
	voteToast(hook, text) {
		this.info(text, { hook })
	}

	/**
	 * The desktop switch of the vote bar ("Vote"/"Edit", SPEC-M1 §6.5.4).
	 *
	 * @param {boolean} vote true = vote mode while the session is open
	 */
	setPreferVote(vote) {
		this.preferVote = !!vote
		this.updateMode({ settle: !!vote })
	}

	/**
	 * The vote panel opened or closed (SPEC-M1 §6.4: no presence while it is
	 * open during a session, except the presenter's {v}).
	 *
	 * @param {boolean} open panel open
	 */
	setVotePanelOpen(open) {
		const was = this.votePanelOpen
		this.votePanelOpen = !!open
		if (was !== this.votePanelOpen) {
			this.sync?.poke()
		}
	}

	/**
	 * Live items that can get votes under cfg (SPEC-M1 §6.5.1, VoteSetupDialog counter).
	 *
	 * @param {{types?: string[], scope?: (string|null)}} cfg settings in the dialog
	 * @return {number}
	 */
	votableCount(cfg) {
		if (!this.model) {
			return 0
		}
		const types = Array.isArray(cfg?.types) ? cfg.types : []
		const scope = typeof cfg?.scope === 'string' && cfg.scope !== '' ? cfg.scope : null
		let n = 0
		for (const id of this.model.ids()) {
			const it = this.model.get(id)
			if (it && types.includes(it.t) && (scope === null || (it.parent ?? null) === scope)) {
				n++
			}
		}
		return n
	}

	/**
	 * Items of the open session for the vote list (VotePanel), in reading
	 * order (frames' children by y, then x): {id, text, mine}.
	 *
	 * @return {Array<{id: string, text: string, mine: number}>}
	 */
	votableItems() {
		if (!this.model || !this.voteState.open) {
			return []
		}
		const mine = this.voteState.mine
		const out = []
		for (const id of this.model.ids()) {
			const it = this.model.get(id)
			if (this.voteState.votable(it)) {
				const a = this.model.abs?.(id) ?? it
				out.push({ id, text: this.itemText(it), mine: mine[id] ?? 0, y: a.y, x: a.x })
			}
		}
		out.sort((p, r) => (Math.round(p.y / 10) - Math.round(r.y / 10)) || (p.x - r.x) || (p.id < r.id ? -1 : 1))
		return out.map(({ id, text, mine: m }) => ({ id, text, mine: m }))
	}

	/**
	 * @param {string} id item id
	 * @return {string} the item's text for lists (empty when it has none or is unknown)
	 */
	textOf(id) {
		return this.model?.has(id) ? this.itemText(this.model.get(id)) : ''
	}

	/**
	 * @param {object} it item
	 * @return {string} its text (text path of its type), trimmed
	 */
	itemText(it) {
		const path = textPathOf(it?.t)
		const v = path ? getPath(it, path) : ''
		return typeof v === 'string' ? v.trim() : ''
	}

	/**
	 * Frames for the frame list (SPEC-M1 §6.6 FrameList): z order, title or
	 * "Frame {n}".
	 *
	 * @return {Array<{id: string, title: string}>}
	 */
	frames() {
		if (!this.model) {
			return []
		}
		const ids = [...this.model.ids()].filter((id) => this.model.get(id)?.t === 'frame')
		const sorted = typeof this.model.sortByOrder === 'function' ? this.model.sortByOrder(ids) : ids
		return sorted.map((id, i) => {
			const title = String(this.model.get(id)?.data?.title ?? '').trim()
			return { id, title: title !== '' ? title : t('knorke', 'Frame {n}', { n: i + 1 }) }
		})
	}

	/**
	 * Frame list, vote list (SPEC-M1 §6.5.1): stop following, then show the
	 * item with ZOOM_PAD_PX around it (no 100 % limit), in the part of the
	 * canvas the bars leave free (job 223, viewInsets). (R22, P7-11) With
	 * `left`/`right` (screen px a side panel covers at that edge of the
	 * canvas) the larger of that and the measured inset counts.
	 *
	 * @param {string} id item id
	 * @param {{left?: number, right?: number}} [reserve] covered px at the left/right edge
	 * @return {boolean} the camera moved
	 */
	zoomToItem(id, { left = 0, right = 0 } = {}) {
		const box = this.model?.has(id) ? this.model.abs?.(id) : null
		if (!box) {
			return false
		}
		const v = this.viewInsets()
		// NaN || 0 is 0; what is still no positive number counts as 0 in freePart
		return this.zoomToRect(box, { ...v, left: Math.max(v?.left || 0, left || 0), right: Math.max(v?.right || 0, right || 0) })
	}

	/**
	 * (Job 180) The world rectangle widened upwards by the covered top of the
	 * canvas (`top` container px: the top bar, the banners and the context
	 * bar of a new selection, ui.viewTop), so that cameraForRect(…,
	 * ZOOM_PAD_PX) puts `rect` whole below it: s is the fit of rect into the
	 * visible height (cameraForRect of rect stretched by (vh − 2·pad) / free,
	 * so the scene's scale limits apply as usual), then top/s world units are
	 * added above. Without a covered top, without a measurable canvas or when
	 * nothing would stay free: rect itself.
	 *
	 * @param {{x: number, y: number, w: number, h: number}} rect world rectangle
	 * @param {number} top covered screen px at the top edge
	 * @return {{x: number, y: number, w: number, h: number}}
	 */
	reserveTop(rect, top = 0) {
		const T = Number.isFinite(top) && top > 0 ? top : 0
		const sc = this.scene
		if (T === 0 || !sc || typeof sc.cameraForRect !== 'function' || !(rect?.h > 0)) {
			return rect
		}
		const vp = sc.getViewport?.()
		const cam = sc.getCamera?.()
		const vh = vp && cam && Number.isFinite(vp.h) && cam.scale > 0 ? vp.h * cam.scale : 0
		const full = vh - 2 * ZOOM_PAD_PX
		const free = full - T
		if (!(free > 0)) {
			return rect
		}
		const s = sc.cameraForRect({ x: rect.x, y: rect.y, w: rect.w, h: rect.h * full / free }, ZOOM_PAD_PX)?.scale
		if (!(s > 0)) {
			return rect
		}
		return { x: rect.x, y: rect.y - T / s, w: rect.w, h: rect.h + T / s }
	}

	/**
	 * "Zoom to selection" (zoom controls, like Shift+2): (job 242) up to
	 * MAX_SCALE, like a zoom by hand.
	 *
	 * @return {boolean} the camera moved
	 */
	zoomToSelection() {
		const ids = this.selection.filter((id) => this.model?.has(id))
		return ids.length > 0 && this.zoomToRect(this.boundsOf(ids), this.viewInsets(), MAX_SCALE)
	}

	/**
	 * @param {string[]} ids items
	 * @return {{x: number, y: number, w: number, h: number}|null} axis-aligned world bounds
	 */
	boundsOf(ids) {
		let b = null
		for (const id of ids) {
			const a = this.model?.abs?.(id)
			if (!a) {
				continue
			}
			const x0 = Math.min(b ? b.x0 : Infinity, a.x)
			const y0 = Math.min(b ? b.y0 : Infinity, a.y)
			const x1 = Math.max(b ? b.x1 : -Infinity, a.x + a.w)
			const y1 = Math.max(b ? b.y1 : -Infinity, a.y + a.h)
			b = { x0, y0, x1, y1 }
		}
		return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null
	}

	/**
	 * @param {{x: number, y: number, w: number, h: number}|null} rect world rectangle
	 * @param {{top?: number, right?: number, bottom?: number, left?: number}|null} [insets] (job 223) covered px per edge (viewInsets; null: the whole canvas)
	 * @param {number} [maxScale] (job 242) highest scale; undefined: the scene's default (ZOOM_TO_MAX_SCALE)
	 * @return {boolean} the camera moved
	 */
	zoomToRect(rect, insets = null, maxScale = undefined) {
		const sc = this.scene
		if (!rect || !sc || typeof sc.cameraForRect !== 'function') {
			return false
		}
		this.follower?.stop('user')
		sc.setCamera(sc.cameraForRect(rect, ZOOM_PAD_PX, insets, maxScale))
		return true
	}

	/** Tablets at the start of a session (SPEC-M1 §6.5.5): the voting area into view. */
	cameraToVoteArea() {
		const scope = this.voteState.scope
		if (scope !== null && this.model?.has(scope)) {
			this.zoomToItem(scope)
			return
		}
		const ids = [...(this.model?.ids() ?? [])].filter((id) => this.voteState.votable(this.model.get(id)))
		if (ids.length > 0) {
			this.zoomToRect(this.boundsOf(ids))
		}
	}

	/**
	 * The moderator's tab ends the session itself at endsAt (SPEC-M1 §4.12.1
	 * way (c); the one automatic call of routes 22–26, R16): idempotent, a 409
	 * is the normal "somebody was faster"; network errors try again a few times.
	 */
	scheduleAutoEnd() {
		const v = this.voteState
		const want = this.me?.mod === true && v.open && v.endsAt !== null && !this.frozen ? { sid: v.sid, endsAt: v.endsAt } : null
		const cur = this.autoEnd
		if (cur && want && cur.sid === want.sid && cur.endsAt === want.endsAt) {
			return
		}
		cur?.ctl?.abort()
		this.autoEnd = null
		if (!want || this.destroyed) {
			return
		}
		const ctl = typeof AbortController === 'function' ? new AbortController() : null
		this.autoEnd = { ...want, ctl }
		const run = async () => {
			for (let attempt = 0; attempt < AUTO_END_TRIES; attempt++) {
				const wait = Math.max(0, want.endsAt - this.clock.now()) + AUTO_END_DELAY_MS + attempt * 2000
				await this.sleep(wait, ctl?.signal)
				if (this.destroyed || ctl?.signal.aborted || !this.voteState.open || this.voteState.sid !== want.sid) {
					return
				}
				try {
					const res = await this.api.updateVote(this.boardId, 'end')
					this.applyModeration(res)
					return
				} catch (e) {
					if (!(e instanceof HttpError) || e.status === 0 || e.status >= 500 || isProxyRetry(e) || isSlowDown(e)) {
						continue
					}
					// 409 vote_closed (already closed), 403, 404: nothing to do but
					// fetching the closed meta.vote soon
					this.refreshMetaAfter(e)
					return
				}
			}
		}
		run().catch((e) => console.error('[knorke] automatic end failed', e))
	}

	/**
	 * Answer of a moderation route: {board: {title, meta, metaRev}, now}. An
	 * action without effect (show when shown, hide when hidden, DELETE summon
	 * without a summon) answers 200 with the stored state and the same
	 * metaRev: onMeta ignores it, the call still counts as done.
	 *
	 * @param {object|null} res answer
	 */
	applyModeration(res) {
		if (res && typeof res === 'object' && res.board && typeof res.board === 'object') {
			this.onMeta(res.board)
		}
	}

	/**
	 * A moderation call failed with a code of META_STALE_CODES (SPEC-M1 §4.2):
	 * the known meta is applied again (bar, panel, scene, timer show the
	 * known state, nothing optimistic stays) and the sync loop switches to
	 * the active cadence, so the server's new meta (e.g. the session the 409
	 * closed) arrives with the next tick. The route itself is never repeated
	 * (R16 SRV-07).
	 *
	 * @param {unknown} e error of the call
	 * @return {boolean} it was such a code
	 */
	refreshMetaAfter(e) {
		if (!(e instanceof HttpError) || !META_STALE_CODES.includes(e.code) || this.destroyed) {
			return false
		}
		this.emitBoard()
		this.applyMeta()
		this.sync?.poke()
		return true
	}

	/**
	 * Runs one moderation call (routes 22–26): the answer takes the meta path,
	 * an error is toasted; never repeated automatically (R16 SRV-07).
	 *
	 * @param {() => Promise<object>} fn the call
	 * @return {Promise<{ok: boolean, code: (string|null)}>} code: the §4.2 error code
	 */
	async moderate(fn) {
		if (this.destroyed || this.boardId === null || this.mode !== 'user') {
			return { ok: false, code: 'forbidden' }
		}
		try {
			this.applyModeration(await fn())
			return { ok: true, code: null }
		} catch (e) {
			const code = e instanceof HttpError ? (e.code ?? null) : 'network'
			const text = moderationError(e)
			if (text !== null && code !== 'vote_config') {
				this.toast(text)
			}
			this.refreshMetaAfter(e)
			return { ok: false, code }
		}
	}

	/**
	 * @param {{per: number, perItem: number, scope: (string|null), types: string[], minutes: (number|null), live?: boolean}} cfg settings (live: job 149)
	 * @return {Promise<{ok: boolean, code: (string|null)}>}
	 */
	startVote(cfg) {
		return this.moderate(() => this.api.startVote(this.boardId, cfg))
	}

	/**
	 * @param {'end'|'extend'|'show'|'hide'|'clear'} action action
	 * @param {number} [minutes] for extend
	 * @return {Promise<{ok: boolean, code: (string|null)}>}
	 */
	updateVote(action, minutes = undefined) {
		return this.moderate(() => this.api.updateVote(this.boardId, action, minutes))
	}

	/**
	 * @param {'start'|'pause'|'resume'|'add'|'stop'} action action
	 * @param {number} [ms] for start and add
	 * @return {Promise<{ok: boolean, code: (string|null)}>}
	 */
	timer(action, ms = undefined) {
		return this.moderate(() => this.api.timer(this.boardId, action, ms))
	}

	/** @return {Promise<{ok: boolean, code: (string|null)}>} "Bring everyone here" from this tab */
	summon() {
		return this.moderate(() => this.api.summon(this.boardId, this.client))
	}

	/** @return {Promise<{ok: boolean, code: (string|null)}>} "Stop presenting" */
	endSummon() {
		return this.moderate(() => this.api.endSummon(this.boardId))
	}

	/**
	 * Factory job 275: private writing.
	 *
	 * @param {'start'|'reveal'} action action
	 * @param {string|null} [frame] frame of start, null = the whole board
	 * @return {Promise<{ok: boolean, code: (string|null)}>}
	 */
	privateWriting(action, frame = null) {
		return this.moderate(() => this.api.privateWriting(this.boardId, action, frame))
	}

	/** @return {number} job 275: covered notes in the model (private writing) */
	coveredCount() {
		let n = 0
		for (const id of this.model?.ids() ?? []) {
			if (isCovered(this.model.get(id))) {
				n++
			}
		}
		return n
	}

	/** @return {boolean} meta.summon names this tab (my pid and this client id) */
	isPresenting() {
		const s = summonOf(this.board?.meta?.summon)
		return !!s && !!this.me?.pid && s.pid === this.me.pid && s.client === this.client
	}

	// ---- stage 3: following ------------------------------------------------

	/**
	 * Follows a participant (SPEC-M1 §6.5.1 follow(pid), §6.5.6 follow(pid,
	 * client)): the entry '<pid>:<client>', without client the youngest
	 * entry of pid with a viewport.
	 *
	 * @param {string} pid participant
	 * @param {string|null} [client] client id of the tab
	 * @return {boolean} following
	 */
	follow(pid, client = null) {
		return this.follower?.follow(pid, client) ?? false
	}

	/**
	 * A participant button (SPEC-M1 §6.6 PresenceBar): follow that pid.
	 *
	 * @param {string} pid participant
	 * @return {boolean} following
	 */
	followParticipant(pid) {
		return this.follow(pid, null)
	}

	/** "Stop following" (FollowBanner). */
	stopFollow() {
		this.follower?.stop('user')
	}

	/** The chip "{name} is presenting · Follow". */
	followPresenter() {
		return this.follower?.followPresenter() ?? false
	}

	/** @param {{following: object|null, chip: object|null}} st follow state */
	emitFollow(st) {
		if (st?.following) {
			// SPEC-M1 §6.6: following starts → the context menu closes
			this.closeMenu()
		}
		this.ui.onFollow?.(st)
		this.emitSlides()
	}

	// ---- factory job 272: frames as slides -------------------------------

	/**
	 * Starts presenting the frames from this tab: at the selected frame when
	 * exactly one frame is selected, else at the first slide.
	 *
	 * @return {Promise<boolean>} started
	 */
	startSlides() {
		const sel = this.selection ? [...this.selection] : []
		const at = sel.length === 1 && this.model?.get(sel[0])?.t === 'frame' ? sel[0] : null
		this.follower?.stop('user')
		return this.slideShow.start(at)
	}

	/** @param {number|'first'|'last'} dir +1, -1, 'first', 'last' @return {boolean} moved */
	slideStep(dir) {
		return this.slideShow.step(dir)
	}

	/** @param {string} id frame @return {boolean} moved */
	slideTo(id) {
		return this.slideShow.go(id)
	}

	/**
	 * @param {string} id slide
	 * @param {number} to new index
	 * @return {Promise<boolean>} saved
	 */
	moveSlide(id, to) {
		return this.slideShow.reorder(id, to)
	}

	/** @return {Promise<boolean>} ended (DELETE summon) */
	endSlides() {
		return this.slideShow.end()
	}

	/** "Look around myself": leaves the presentation (an own exit, the chip brings back). */
	lookAround() {
		this.follower?.stop('user')
	}

	/**
	 * Screen px the presentation covers at the right edge (the presenter's
	 * slide list) and at the bottom (its bar, and the session bar below it);
	 * the shown frame is fitted into the rest.
	 *
	 * @param {{right?: number, bottom?: number}} o covered px
	 */
	setSlideInsets({ right = 0, bottom = 0 } = {}) {
		const px = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
		const next = { right: px(right), bottom: px(bottom) }
		if (next.right === this.slideInsets.right && next.bottom === this.slideInsets.bottom) {
			return
		}
		this.slideInsets = next
		const cur = this.slideShow.current()
		if (cur) {
			this.showSlide(cur)
		} else if (this.follower?.target?.summon) {
			// a follower fits the frame again with the new bottom
			this.follower.lastView = null
			this.follower.step(this.now())
		}
	}

	/** @param {string} id frame: the presenter's camera fits it */
	showSlide(id) {
		const sc = this.scene
		const box = this.model?.get(id)?.t === 'frame' ? this.model.abs(id) : null
		if (!sc || !box || typeof sc.cameraForRect !== 'function' || typeof sc.followTo !== 'function') {
			return
		}
		const cam = sc.cameraForRect(box, FRAME_PAD_PX, { right: this.slideInsets.right, bottom: this.slideInsets.bottom }, MAX_SCALE)
		sc.followTo(cam, 300)
	}

	/**
	 * The presentation state for the shell (ui.onSlides): role 'presenter'
	 * (this tab presents frames), 'viewer' (this client follows a summon
	 * naming a frame of this board) or null; and the shown frame's screen box
	 * (ui.onSlideRect).
	 */
	emitSlides() {
		if (this.destroyed || !this.slideShow) {
			return
		}
		const meta = this.board?.meta && typeof this.board.meta === 'object' ? this.board.meta : {}
		const s = summonOf(meta.summon)
		let role = null
		let current = null
		if (this.slideShow.active) {
			role = 'presenter'
			current = this.slideShow.current()
		} else if (s?.frame && this.follower?.target?.summon && this.model?.get(s.frame)?.t === 'frame') {
			role = 'viewer'
			current = s.frame
		}
		if (role === null) {
			if (this.slideRole !== null) {
				this.slideRole = null
				this.ui.onSlides?.(null)
			}
			return
		}
		this.slideRole = role
		const list = this.slideShow.list()
		this.ui.onSlides?.({
			role,
			list,
			current,
			index: list.findIndex((x) => x.id === current),
			name: s?.name ?? '',
		})
		this.emitSlideRect()
	}

	/**
	 * The shown frame's screen box (container px) while a presentation shows,
	 * measured with the camera the user sees: the one onCamera reports, else
	 * the scene's live camera (a follow glide moves it before the confirmed
	 * camera follows).
	 *
	 * @param {{x: number, y: number, scale: number}} [cam] camera now
	 */
	emitSlideRect(cam = null) {
		if (this.slideRole === null) {
			return
		}
		const meta = this.board?.meta && typeof this.board.meta === 'object' ? this.board.meta : {}
		const id = this.slideRole === 'presenter' ? this.slideShow.current() : summonOf(meta.summon)?.frame
		const sc = this.scene
		const box = id && this.model?.get(id)?.t === 'frame' ? this.model.abs(id) : null
		const c = cam && [cam.x, cam.y, cam.scale].every(Number.isFinite) && cam.scale > 0
			? cam
			: (typeof sc?.liveCamera === 'function' ? sc.liveCamera() : sc?.getCamera?.())
		if (!box || !c || ![c.x, c.y, c.scale].every(Number.isFinite)) {
			return
		}
		this.ui.onSlideRect?.({ x: (box.x - c.x) * c.scale, y: (box.y - c.y) * c.scale, w: box.w * c.scale, h: box.h * c.scale })
	}

	/**
	 * Server time sample (every 2xx answer): the shell hears about a changed
	 * clock offset (timer countdowns, ui.onClockSkew).
	 *
	 * @param {{now: number, t0: number, t1: number}} c sample
	 */
	onClock(c) {
		this.clock.sample(c)
		const off = this.clock.offset
		if (Math.abs(off - this.skewShown) >= SKEW_REPORT_MS) {
			this.skewShown = off
			this.ui.onClockSkew?.(off)
		}
	}

	/**
	 * Own viewport for presence v (SPEC-M1 §4.5): the confirmed camera's world
	 * rectangle (scene.getViewport), each value q(…, 10); null when invalid.
	 *
	 * @return {[number, number, number, number]|null}
	 */
	viewV() {
		let vp = null
		try {
			vp = this.scene?.getViewport?.() ?? null
		} catch (e) {
			vp = null
		}
		if (!vp) {
			return null
		}
		const v = [q(vp.x, 10), q(vp.y, 10), q(vp.w, 10), q(vp.h, 10)]
		if (!v.every((n) => Number.isFinite(n)) || Math.abs(v[0]) > 1e7 || Math.abs(v[1]) > 1e7 ||
			!(v[2] > 0) || !(v[3] > 0) || v[2] > 1e7 || v[3] > 1e7) {
			return null
		}
		return v
	}

	/**
	 * Access level sent as `role` (SPEC-M1 §4.9 Zugangsstufe): owner, moderate
	 * (role edit with the moderation right), edit, vote, view; null unknown.
	 *
	 * @return {string|null}
	 */
	accessLevel() {
		const level = accessOf(this.me?.role, this.me?.mod)
		return level !== null && ACCESS_LEVELS.includes(level) ? level : null
	}

	/**
	 * Client mode for __knorke.state().uiMode (SPEC-M1 §6.7, §6.5.4): modeFor
	 * of me.role and the device (vote sessions come with stage 3).
	 *
	 * @return {'edit'|'vote'|'view'}
	 */
	uiMode() {
		return this.clientMode
	}

	/**
	 * U18: makes sure no other live tab uses the same client id. Browsers clone
	 * sessionStorage when a tab is duplicated, and two tabs with one id share
	 * one presence entry (the idle copy's e = null resets the editing copy's
	 * lease rank, §4.11). The tab asks on BroadcastChannel
	 * 'knorke.client.<board>' and listens CLAIM_MS: a live tab with the same
	 * id answers 'taken', and this tab takes a fresh id (stored in its own,
	 * cloned sessionStorage). Two tabs claiming at once: the smaller nonce
	 * keeps the id. The channel stays open for the session, so this tab
	 * defends its id against later duplicates. Without BroadcastChannel the
	 * stored id is used as before.
	 *
	 * @param {string} id stored (or new) client id
	 * @return {Promise<string>} the id to use
	 */
	claimClientId(id) {
		const BC = this.deps.BroadcastChannel !== undefined ? this.deps.BroadcastChannel : (this.win?.BroadcastChannel ?? null)
		if (typeof BC !== 'function') {
			return Promise.resolve(id)
		}
		const key = keys.client(this.storageId())
		let ch
		try {
			ch = new BC(key)
		} catch (e) {
			return Promise.resolve(id)
		}
		this.channel = ch
		const nonce = clientId() + clientId()
		let current = id
		let claiming = true
		let settle
		const result = new Promise((resolve) => { settle = resolve })
		const post = (m) => {
			try {
				ch.postMessage(m)
			} catch (e) {
				// closed or unsupported: nothing to defend
			}
		}
		const renew = () => {
			claiming = false
			current = clientId()
			this.storage.setItem('session', key, current)
			settle(current)
		}
		ch.onmessage = (ev) => {
			const m = ev?.data
			if (!m || typeof m !== 'object' || m.id !== current || typeof m.nonce !== 'string') {
				return
			}
			if (m.t === 'claim' && m.nonce !== nonce) {
				if (claiming && m.nonce < nonce) {
					renew()
					return
				}
				post({ t: 'taken', id: current, nonce: m.nonce })
			} else if (m.t === 'taken' && m.nonce === nonce && claiming) {
				renew()
			}
		}
		post({ t: 'claim', id, nonce })
		this.sleep(CLAIM_MS).then(() => {
			if (claiming) {
				claiming = false
				settle(current)
			}
		})
		return result
	}

	/** @return {string} client id of this tab for this board (sessionStorage) */
	loadClientId() {
		const key = keys.client(this.storageId())
		const stored = this.storage.getItem('session', key)
		if (typeof stored === 'string' && CLIENT_RE.test(stored)) {
			return stored
		}
		const id = clientId()
		this.storage.setItem('session', key, id)
		return id
	}

	/** @return {object} transport for the mode (deps.request/deps.urlOf: tests) */
	makeTransport() {
		const inject = {
			...(this.deps.request ? { request: this.deps.request } : {}),
			...(this.deps.urlOf ? { urlOf: this.deps.urlOf } : {}),
		}
		if (this.mode === 'guest') {
			const self = this
			return guestTransport({
				...inject,
				boardId: this.boardId,
				linkToken: this.linkToken,
				// read on every join: the claim may give this tab a fresh id (U18)
				getClient: () => self.client,
				counters: this.counters,
				getGuest: () => self.getGuest(),
				setGuest: (g) => self.storage.setJson('local', keys.guest(self.storageId()), g),
				clearGuest: () => self.storage.removeItem('local', keys.guest(self.storageId())),
			})
		}
		return userTransport(this.boardId, { ...inject, counters: this.counters })
	}

	/**
	 * Repeats fn while a proxy answers 429/503 (§4.2, at most OPEN_ATTEMPTS
	 * times) or the app answers 429 `slow_down` (SPEC-M1 §4.2, R2: snapshot
	 * and guest join; wait max(retryMs, 2000) × (1 + 0–20 %), doubling up to
	 * 60 s, never final); (R22, P7-07) a 403/404 without the app body (a
	 * proxy or firewall) is repeated after the failure backoff 1/2/4/8/15 s
	 * × (1 + 0–20 %), then every ≥ 15 s, never final; every other error is
	 * thrown.
	 *
	 * @param {() => Promise<any>} fn request
	 * @return {Promise<any>}
	 */
	async withProxyRetry(fn) {
		let slow = 0
		let blocked = 0
		for (let attempt = 1; ; attempt++) {
			try {
				return await fn()
			} catch (e) {
				if (this.destroyed) {
					throw e
				}
				if (isPasswordLock(e)) {
					// SPEC-M1 §6.4 (R13): the password lock-out is never repeated
					throw e
				}
				if (isSlowDown(e)) {
					slow++
					attempt--
					await this.sleep(slowDownDelay(e, slow, this.rand))
				} else if (isProxyBlock(e)) {
					blocked++
					attempt--
					await this.sleep(nextDelay({ failures: blocked, more: false }, this.now(), this.deps.intervals ?? INTERVALS, this.rand))
				} else if (!isProxyRetry(e) || attempt >= OPEN_ATTEMPTS) {
					throw e
				} else {
					await this.sleep(e.retryAfterMs ?? (2000 + this.rand() * 8000))
				}
				if (this.destroyed) {
					throw e
				}
			}
		}
	}

	/** @return {object} SceneCallbacks (§6.3) */
	sceneCallbacks() {
		return {
			onIntent: (i) => this.onIntent(i),
			onSelection: (ids) => {
				const next = Array.isArray(ids) ? [...ids] : []
				this.sortSelectionChange(next)
				this.selection = next
				this.emitSelection()
				this.sync?.poke()
			},
			onCamera: (c) => this.onCamera(c),
			onPointer: (w) => {
				this.pointer = Array.isArray(w) ? w : null
				this.sync?.poke()
			},
			onActivity: (a) => {
				if (a && typeof a.kind === 'string') {
					if (a.active) {
						this.activity.add(a.kind)
					} else {
						this.activity.delete(a.kind)
					}
				}
				// SPEC-M1 §6.5.6: own editing ends following, a press holds jumps back
				this.follower?.onActivity(a, this.clientMode)
				if (a && !a.active) {
					this.flushDeferred()
					// job 240: the scene wrote the dragged box into the model while it
					// moved, so no flush sees a change: report the selection once more,
					// "Arrange" (and its tick "1:1") shows the box as it ended up
					if ((a.kind === 'drag' || a.kind === 'transform') && Array.isArray(a.ids) && a.ids.some((id) => this.selection.includes(id))) {
						this.emitSelection()
					}
				}
				if (a?.kind !== 'press') {
					this.sync?.poke()
				}
			},
			// SPEC-M1 §6.3, §6.5.6: user camera changes end following
			onUserCamera: () => {
				// SPEC-M1 §6.6: a user camera change closes the context menu
				this.closeMenu()
				this.follower?.onUserCamera()
			},
			onDragPreview: (p) => {
				this.dragPreview = Array.isArray(p) ? p : []
				this.sync?.poke()
			},
			onEditing: (id, takeover, cell) => this.onEditing(id, takeover, cell),
			onTool: (tool) => {
				// job 139: a tool change ends the name fields
				this.endSortLabels()
				this.ui.onTool?.(tool)
				// job 188: the scene changed the tool (a key, back to select after creating): the note tool says "Note"
				if (this.noteBack()) {
					this.emitToolOptions()
				}
			},
			// the key G switched the grid in the scene (R12): only store it
			onGrid: (on) => this.storeGrid(on),
			// factory job 137: the shell places its context bar at the selection
			onSelectionBox: (b) => this.ui.onSelectionBox?.(b),
			// factory job 142: the first one-finger pan may show the tip about selecting with a finger
			onTouchPan: () => this.maybeTouchTip(),
			// factory job 145: the key ? opens the shell's shortcuts overview, in every mode and frozen too
			onShortcuts: () => this.ui.onShortcuts?.(),
			onSearch: () => this.ui.onSearch?.(),
			// factory job 147: the key C shows or hides other people's cursors, in every mode and frozen too
			onCursors: () => this.toggleCursors(),
			// factory job 171: a point of the own laser stroke, null at its end
			onLaser: (p) => this.laserPoint(p),
			// factory job 190: the scene's offer of locked items changed (the bar's "Select n locked items")
			onLockedOffer: () => this.emitSelection(),
			// factory job 195: the focused node of the one selected mind map (the bar's section "Branch")
			onNodeFocus: (id, key) => {
				this.mmFocus = typeof id === 'string' && typeof key === 'string' ? { id, key } : null
				this.emitSelection()
			},
			// factory job 223: Shift+1 and Shift+2 keep the content clear of the bars, like the buttons
			viewInsets: () => this.viewInsets(),
		}
	}

	// Factory job 255: comments, reactions and the laser live in board/sessionComments.js (SessionComments,
	// this.talk); these hand over.

	mayReact() {
		return this.talk.mayReact()
	}

	pushReactions() {
		return this.talk.pushReactions()
	}

	react(id, e) {
		return this.talk.react(id, e)
	}

	reactIntent(i) {
		return this.talk.reactIntent(i)
	}

	commentApi() {
		return this.talk.commentApi()
	}

	mayComment() {
		return this.talk.mayComment()
	}

	commentsView() {
		return this.talk.commentsView()
	}

	emitComments() {
		return this.talk.emitComments()
	}

	setBubbles(on) {
		return this.talk.setBubbles(on)
	}

	startCommentPick() {
		return this.talk.startCommentPick()
	}

	cancelCommentPick() {
		return this.talk.cancelCommentPick()
	}

	onCommentPick(i) {
		return this.talk.onCommentPick(i)
	}

	commentOn(id, node) {
		return this.talk.commentOn(id, node)
	}

	composeComment(place) {
		return this.talk.composeComment(place)
	}

	commentCall(fn) {
		return this.talk.commentCall(fn)
	}

	createThread(o) {
		return this.talk.createThread(o)
	}

	replyTo(thread, text) {
		return this.talk.replyTo(thread, text)
	}

	editComment(comment, text) {
		return this.talk.editComment(comment, text)
	}

	setResolved(thread, resolved) {
		return this.talk.setResolved(thread, resolved)
	}

	deleteComment(comment) {
		return this.talk.deleteComment(comment)
	}

	searchMentions(q) {
		return this.talk.searchMentions(q)
	}

	commentError(e) {
		return this.talk.commentError(e)
	}

	commentsOnRemove(ops) {
		return this.talk.commentsOnRemove(ops)
	}

	liveCommentBox(item, node) {
		return this.talk.liveCommentBox(item, node)
	}

	liveCameraNow() {
		return this.talk.liveCameraNow()
	}

	commentPlaces() {
		return this.talk.commentPlaces()
	}

	threadAnchor(id) {
		return this.talk.threadAnchor(id)
	}

	commentScreen(o) {
		return this.talk.commentScreen(o)
	}

	centerOn(w, reserve) {
		return this.talk.centerOn(w, reserve)
	}

	/**
	 * (Job 271) What the board search reads: the local model and the loaded
	 * comment threads (only what this person may see), with the anchor of a
	 * thread; null before the board loaded.
	 *
	 * @return {{model: object, threads: object[], anchorOf: function(object): ({x: number, y: number}|null)}|null}
	 */
	searchSource() {
		if (!this.model) {
			return null
		}
		return { model: this.model, threads: this.comments?.threads ?? [], anchorOf: (th) => this.threadAnchor(th.id) }
	}

	/**
	 * (Job 274) What the outline reads: the local model and the frames with
	 * their shown titles (frames()); null before the board loaded.
	 *
	 * @return {{model: object, frames: {id: string, title: string}[]}|null}
	 */
	outlineSource() {
		if (!this.model) {
			return null
		}
		return { model: this.model, frames: this.frames() }
	}

	/**
	 * (Job 271) The frame around the current hit of the board search.
	 *
	 * @param {string|null} id item id (null: none)
	 */
	setSearchHit(id) {
		this.scene?.setSearchHit?.(typeof id === 'string' ? id : null)
	}

	/**
	 * (Job 271) Shows a hit of the board search: an item into view
	 * (zoomToItem with the covered edges), a thread's anchor into the free
	 * part (centerOn), and the frame around the item (a thread: the item it
	 * hangs on, if any). Selection, ops and the undo stack stay as they are.
	 *
	 * @param {{kind: string, id: string, item: (string|null)}|null} hit a hit of board/search.js
	 * @param {{left?: number, right?: number}} [reserve] covered px at the left/right edge
	 * @return {boolean} the camera moved
	 */
	showSearchHit(hit, reserve = {}) {
		if (!hit || typeof hit.id !== 'string') {
			return false
		}
		if (hit.kind === 'comment') {
			this.setSearchHit(hit.item)
			const a = this.threadAnchor(hit.id)
			return a ? this.centerOn(a, reserve) : false
		}
		this.setSearchHit(hit.id)
		return this.zoomToItem(hit.id, reserve)
	}

	openReactionPicker(id, rect) {
		return this.talk.openReactionPicker(id, rect)
	}

	reactFromBar(rect) {
		return this.talk.reactFromBar(rect)
	}

	emitReactionPicker() {
		return this.talk.emitReactionPicker()
	}

	closeReactionPicker() {
		return this.talk.closeReactionPicker()
	}

	pickReaction(e) {
		return this.talk.pickReaction(e)
	}

	openReactionPopup(kind, id, e, rect, hold) {
		return this.talk.openReactionPopup(kind, id, e, rect, hold)
	}

	emitReactionPopup() {
		return this.talk.emitReactionPopup()
	}

	closeReactionPopup() {
		return this.talk.closeReactionPopup()
	}

	checkReactions(ids) {
		return this.talk.checkReactions(ids)
	}

	laserPoint(p) {
		return this.talk.laserPoint(p)
	}

	laserWire() {
		return this.talk.laserWire()
	}

	/** @return {{x: number, y: number, scale: number}|null} the scene's camera when it is a valid one */
	cameraNow() {
		const c = this.scene?.getCamera?.() ?? null
		return c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.scale) ? { x: c.x, y: c.y, scale: c.scale } : null
	}

	// ---- factory job 191: tags ---------------------------------------------

	// Factory job 257: the tag list, the tag panels, the filter and the tag writes live in
	// board/sessionTags.js (SessionTags, this.tagging); these hand over. Undo and redo of a
	// tag step (recordTagStep, sendTagHistory) stay here beside history().

	tagApi() {
		return this.tagging.tagApi()
	}

	boardTags() {
		return this.tagging.boardTags()
	}

	mayTag() {
		return this.tagging.mayTag()
	}

	tagTargets() {
		return this.tagging.tagTargets()
	}

	pushTags() {
		return this.tagging.pushTags()
	}

	tagsView() {
		return this.tagging.tagsView()
	}

	emitTags() {
		return this.tagging.emitTags()
	}

	/**
	 * @param {unknown} rect a box of the shell (board px)
	 * @return {{x: number, y: number, w: number, h: number}|null}
	 */
	static tagRect(rect) {
		return tagRect(rect)
	}

	openTagPanel(rect) {
		return this.tagging.openTagPanel(rect)
	}

	openTagFilter() {
		return this.tagging.openTagFilter()
	}

	openTagList(id, rect) {
		return this.tagging.openTagList(id, rect)
	}

	closeTagPanel(o) {
		return this.tagging.closeTagPanel(o)
	}

	checkTags() {
		return this.tagging.checkTags()
	}

	tickTag(tagId, on, made) {
		return this.tagging.tickTag(tagId, on, made)
	}

	createTag(name) {
		return this.tagging.createTag(name)
	}

	renameTag(id, name) {
		return this.tagging.renameTag(id, name)
	}

	recolorTag(id, color) {
		return this.tagging.recolorTag(id, color)
	}

	deleteTag(id) {
		return this.tagging.deleteTag(id)
	}

	changeTag(id, body, extra) {
		return this.tagging.changeTag(id, body, extra)
	}

	tagById(id) {
		return this.tagging.tagById(id)
	}

	notesWithTag(id) {
		return this.tagging.notesWithTag(id)
	}

	retag(id, notes) {
		return this.tagging.retag(id, notes)
	}

	saveTags(body, o) {
		return this.tagging.saveTags(body, o)
	}

	tagFailed(e) {
		return this.tagging.tagFailed(e)
	}

	setTagFilter(ids) {
		return this.tagging.setTagFilter(ids)
	}

	toggleTagFilter(id) {
		return this.tagging.toggleTagFilter(id)
	}

	selectWithTag(id) {
		return this.tagging.selectWithTag(id)
	}

	tagAction(name, ...args) {
		return this.tagging.tagAction(name, ...args)
	}

	withPasteTags(payload, run) {
		return this.tagging.withPasteTags(payload, run)
	}

	/**
	 * Job 206: a step with only a tag part (renaming, recolouring, deleting,
	 * or creating when no note got the tag).
	 *
	 * @param {object|null} tag the step's tag part (null: nothing)
	 */
	recordTagStep(tag) {
		if (!tag) {
			return
		}
		this.undoStack.push({ ops: [], inverse: [], tag })
		this.emitUndo()
	}

	/**
	 * Job 206: undo or redo of the top step with a tag part (undo.js
	 * planTagHistory): first its write of the tag route, then, after the
	 * answer, the ops of the step (a create's ticking) as sendHistory sends
	 * them; a restored deleted tag returns to the notes that lost its id
	 * meanwhile (retag). A failed write (its hint from saveTags) or an add the
	 * server skipped (another tag has the name: the hint tag-exists) sends
	 * nothing more and the step stays where it is.
	 *
	 * @param {'undo'|'redo'} dir direction
	 * @return {Promise<void>}
	 */
	async sendTagHistory(dir) {
		const step = this.undoStack.peek(dir)
		if (!step?.tag || !this.sync || !this.mayTag()) {
			return
		}
		const start = { gen: this.undoStack.gen, at: this.undoStack.done.length }
		const id = step.tag.id
		const plan = planTagHistory(step.tag, dir, this.tagById(id), this.notesWithTag(id))
		if (plan.body !== null) {
			const ok = await this.saveTags(plan.body)
			if (!ok || this.destroyed) {
				return
			}
			if (plan.body.action === 'add') {
				if (this.tagById(id) === null) {
					this.info(t('knorke', 'A tag with this name already exists.'), { hook: 'tag-exists' })
					return
				}
				this.retag(id, step.tag.notes ?? [])
			}
		}
		if (plan.changed) {
			this.info(t('knorke', 'The tag was skipped because someone else changed it.'), { hook: 'undo-changed' })
		}
		const ops = step.ops.length > 0 || step.inverse.length > 0 ? this.historyPlan({ ops: structuredClone(step.ops), inverse: structuredClone(step.inverse) }, dir) : null
		this.undoStack.settle(step, dir, { ops: ops?.plan.step?.ops ?? [], inverse: ops?.plan.step?.inverse ?? [], tag: plan.tag }, start)
		if (ops !== null) {
			this.historySend(dir, ops)
		}
		this.emitUndo()
	}

	// ---- intents ---------------------------------------------------------

	/**
	 * @param {object} i Intent (§6.3)
	 */
	onIntent(i) {
		if (this.capture !== null && i && i.type === 'text') {
			// unsentTexts(): the frozen editor's latest text, kept for the rescue
			this.capture.push(i)
			return
		}
		if (i && i.type === 'pick') {
			// job 189: the click or tap of "New comment", every mode; never ends following
			this.onCommentPick(i)
			return
		}
		if (i && REACT_INTENTS.includes(i.type)) {
			// job 172: every mode; never ends following
			if (this.model && !this.destroyed) {
				this.reactIntent(i)
			}
			return
		}
		if (i && i.type === 'tagList') {
			// job 191: "+n" of a note's tags, every mode; never ends following
			this.openTagList(i.id, i.rect ?? null)
			return
		}
		if (i && (i.type === 'vote' || i.type === 'voteMiss')) {
			// SPEC-M1 §6.3: mode vote only; a tap to vote never ends following
			if (!this.frozen && this.model && this.clientMode === 'vote') {
				this.voteIntent(i)
			}
			return
		}
		if (!i || this.viewOnly || this.frozen || !this.model) {
			return
		}
		// SPEC-M1 §6.5.6: in mode edit every intent ends following (own editing)
		this.follower?.onIntent(i, this.clientMode)
		try {
			this.applyIntent(i)
		} catch (e) {
			// U19: an action that throws (e.g. on stored data no rule foresaw)
			// must neither vanish in the scene's reportAsync nor break the
			// scene's own state: the user hears about it, a final text is kept
			this.actionFailed(e)
			if (i.type === 'text' && i.final && typeof i.value === 'string' && i.value !== '' && i.value !== i.before) {
				this.ui.onRescue?.({ id: i.id, text: i.value, gone: false })
			}
		}
	}

	/**
	 * @param {unknown} e error of an action
	 */
	actionFailed(e) {
		console.error('[knorke] action failed', e)
		this.toast(t('knorke', 'This change could not be applied.'))
	}

	/**
	 * Runs a shell action (context bar, toolbar), turning an exception into
	 * the same toast as onIntent (U19).
	 *
	 * @param {() => void} fn action
	 */
	guard(fn) {
		try {
			fn()
		} catch (e) {
			this.actionFailed(e)
		}
	}

	/**
	 * @param {object} i Intent (§6.3), already checked by onIntent
	 */
	applyIntent(i) {
		switch (i.type) {
		case 'create':
			this.createNow(i)
			break
		case 'stroke':
			// job 273: a pen stroke, one put, one undo step; nothing is selected
			this.commit(actions.createStroke(this.model, i), { urgent: true })
			break
		case 'neighbour':
			this.neighbourNow(i)
			break
		case 'move': {
			const r = actions.moveItems(this.model, i)
			const nudge = i.nudge === true || (!this.activity.has('drag') && !this.activity.has('transform'))
			this.commit(r, { urgent: true, mergeKey: nudge ? this.nudgeKey(i.ids ?? []) : null })
			break
		}
		case 'transform':
			this.transformNow(i)
			break
		case 'connect':
			this.connectNow(i)
			break
		case 'retarget':
			this.commit(actions.retargetEnd(this.model, i), { urgent: true })
			break
		case 'delete':
			this.deleteIds(i.ids ?? [])
			break
		case 'text':
			this.textNow(i)
			break
		case 'tableAppend':
			// job 173: the "+" of a table; job 174: open (Tab in the last cell) opens the new row's left cell
			this.tableAppend(i.id, i.axis, { open: i.open === true })
			break
		case 'tablePaste':
			// job 174: a grid pasted into a cell
			this.tablePaste(i.id, i.cell, i.grid)
			break
		case 'tableWidth':
			// job 173: a column border was dragged
			this.tableWidth(i.id, i.col, i.w)
			break
		case 'takeNote':
			// job 188: a note off a pad
			this.takeNoteNow(i)
			break
		case 'laneAdd':
			// job 199: the "+" of a frame with lanes
			this.laneAdd(i.id)
			break
		case 'laneHeight':
			// job 199: a lane border was dragged
			this.laneStep(i.id, () => setLaneHeight(this.model, i.id, i.lane, i.h))
			break
		case 'colAdd':
			// job 208: the "+" of a frame with columns
			this.colAdd(i.id)
			break
		case 'colWidth':
			// job 208: a column's edge was dragged
			this.laneStep(i.id, () => setLaneColWidth(this.model, i.id, i.col, i.w), 'col')
			break
		case 'laneMove':
			// job 208: the head of a lane was dragged to another place
			this.laneStep(i.id, () => moveLaneTo(this.model, i.id, i.lane, i.to))
			break
		case 'colMove':
			// job 208: the head of a column was dragged to another place
			this.laneStep(i.id, () => moveColTo(this.model, i.id, i.col, i.to), 'col')
			break
		case 'laneGroupMove':
		case 'colGroupMove':
			// job 225: a group's cell was dragged to another place
			this.laneStep(i.id, () => moveGroupTo(this.model, i.id, i.group, i.to, i.type === 'colGroupMove' ? 'x' : 'y'))
			break
		case 'laneGroupSpan':
		case 'colGroupSpan':
			// job 225: a group's edge was dragged over lanes (columns)
			this.laneStep(i.id, () => spanGroup(this.model, i.id, i.group, i.from, i.to, i.type === 'colGroupSpan' ? 'x' : 'y'))
			break
		case 'mmAdd':
			// job 195: a child or a sibling of a node ("+", Tab, Enter, the menu)
			this.mindmapAdd(i.id, i.key, i.as, { side: i.side ?? null, open: i.open === true })
			break
		case 'mmMove':
			// job 195: a node dragged onto another branch or place in its row; job 196: onto empty space
			this.mindmapPlace(i.id, i.key, i.target ?? null, i.place ?? null)
			break
		case 'mmDelete':
			// job 195: Delete at the focus
			this.mindmapDelete(i.id, i.key)
			break
		case 'mmFold':
			// job 195: the dot of a branch
			this.mindmapStep(i.id, (it) => toggleFold(it, i.key))
			break
		case 'reorder':
			this.commit(actions.reorder(this.model, i.ids ?? [], i.where), { urgent: true })
			break
		case 'copy':
			this.copyNow(false)
			break
		case 'cut':
			this.copyNow(true)
			break
		case 'duplicate':
			this.duplicateNow()
			break
		case 'pasteKey':
			this.onPasteKey(i.inPlace === true)
			break
		case 'contextMenu':
			// stage 4 (§6.6): after follower.onIntent, so opening ends following
			this.openMenu(i)
			break
		case 'undo':
			this.undo()
			break
		case 'redo':
			this.redo()
			break
		case 'toggleLock':
			this.toggleLock()
			break
		case 'group':
			this.groupSelection()
			break
		case 'ungroup':
			this.ungroupSelection()
			break
		default:
			break
		}
	}

	/**
	 * Intent create (SPEC-M1 §6.3, §6.5.2): the tool options come with the
	 * intent; a text item gets its measured height; the editor opens for note,
	 * shape and text (job 143: and a frame's title editor), and the item's
	 * first text merges with its creation into one undo step. A frame closed
	 * without a title stays untitled (no text op; only an empty text item
	 * vanishes, dropEmptyNewText). A new frame's title band, where its
	 * editor opens, first comes into view below the top chrome
	 * (scene.revealTitle with ui.viewTop, review round 1 of job 143: a frame
	 * is centred on the click, so its band may lie above the view); (job 193)
	 * so does a new note pad's title band, which may lie below the view. A
	 * pad closed without a title stays untitled, like a frame.
	 *
	 * @param {object} i create intent
	 * @return {string|null} new id
	 */
	createNow(i) {
		// job 199: a frame with lanes gets three named lanes
		const lanes = i.t === 'frame' && i.lanes === true ? [1, 2, 3].map((k) => t('knorke', 'Lane {n}', { n: k })) : null
		const r = actions.createItem(this.model, lanes ? { ...i, lanes } : i, undefined, this.rand)
		if (r.ops.length === 0) {
			return null
		}
		const id = r.selectIds[0]
		this.measurePut(r.ops[0])
		const key = 'new:' + id
		this.commit(r, { urgent: true, mergeKey: key })
		this.select(r.selectIds)
		if (r.edit) {
			const editor = typeInfo(r.ops[0].t).editor
			if (editor === 'title' || editor === 'padTitle') {
				this.scene.revealTitle?.(id, this.viewTop(), this.viewBottom())
			}
			// The scene finishes an editor that is still open inside
			// openTextEditor (onEditing null, then id): the closed one must still
			// count as new there (an untouched new text item is deleted), so the
			// marker of this item is set afterwards.
			this.scene.openTextEditor(id)
			this.newEdit = { id, key }
		}
		return id
	}

	/**
	 * (Job 188) Intent takeNote (header): a note off the pad i.id, with its
	 * top-left corner at i.at, or right of the pad (at null, Enter).
	 *
	 * @param {{id: string, at: ({x: number, y: number}|null)}} i takeNote intent
	 * @return {string|null} the new note's id
	 */
	takeNoteNow(i) {
		const at = i.at === null || i.at === undefined ? null : i.at
		const r = actions.takeNote(this.model, i.id, { at })
		if (r.ops.length === 0) {
			return null
		}
		const id = r.selectIds[0]
		const key = 'new:' + id
		this.commit(r, { urgent: true, mergeKey: key })
		this.select(r.selectIds)
		if (at === null) {
			this.scene.panIntoView(id)
		}
		// set after openTextEditor, like createNow: a closing editor must not take this note for its own
		this.scene.openTextEditor(id)
		this.newEdit = { id, key }
		return id
	}

	/**
	 * (job 143) How far the board's top chrome reaches down, with room for
	 * the context bar of a new selection (ui.viewTop, the view measures it).
	 *
	 * @return {number} container px; 0 without an answer or when the view fails to measure
	 */
	viewTop() {
		try {
			const v = this.ui?.viewTop?.()
			return Number.isFinite(v) && v > 0 ? v : 0
		} catch (e) {
			console.error('[knorke] viewTop failed', e)
			return 0
		}
	}

	/**
	 * (job 223) The container px the bars and an open side panel cover at
	 * each edge of the canvas (ui.viewInsets, the view measures them):
	 * "Show everything", "Zoom to selection", the frame list and Shift+1/2
	 * place the content in the rest.
	 *
	 * @return {{top?: number, right?: number, bottom?: number, left?: number}|null} as the view answers (Camera.js
	 *   freePart counts what is no positive number as 0); null without an answer or when the view fails to measure
	 */
	viewInsets() {
		try {
			return this.ui?.viewInsets?.() ?? null
		} catch (e) {
			console.error('[knorke] viewInsets failed', e)
			return null
		}
	}

	/**
	 * (job 193) How far the bars at the board's bottom (zoom controls, vote
	 * bar, touch tip) reach up (ui.viewBottom, the view measures it).
	 *
	 * @return {number} container px; 0 without an answer or when the view fails to measure
	 */
	viewBottom() {
		try {
			const v = this.ui?.viewBottom?.()
			return Number.isFinite(v) && v > 0 ? v : 0
		} catch (e) {
			console.error('[knorke] viewBottom failed', e)
			return 0
		}
	}

	/**
	 * Intent neighbour (job 136): a click on a "+" handle or Alt/Option+arrow.
	 * An empty item of the source's kind beside it (actions.neighbourItem;
	 * job 148: a click brings `connect`, then a connector from the source to
	 * it in the same step; job 159: a text item gets a copy with its text),
	 * selected alone, panned into view like Tab. No editor opens (job 148,
	 * job 159 for text): the next "+" or Alt/Option+arrow goes on from it,
	 * text comes later (double click, Enter) in a step of its own. (job 162)
	 * A click whose note or shape has a near item X in that direction adds
	 * only a connector to X; X is selected and panned into view. The step's
	 * mergeKey names the first put (N or the connector), never X: joining X
	 * must not merge into the step that made X, so undo takes back only the
	 * connector.
	 *
	 * @param {{id: string, side: string, connect?: {route: string, endCap: string}}} i neighbour intent
	 * @return {string|null} id of the first new item (N, or the connector to X)
	 */
	neighbourNow(i) {
		const r = actions.neighbourItem(this.model, i)
		if (r.ops.length === 0) {
			return null
		}
		const made = r.ops[0].id
		this.commit(r, { urgent: true, mergeKey: 'new:' + made })
		this.select(r.selectIds)
		this.scene.panIntoView(r.selectIds[0])
		return made
	}

	/**
	 * Intent connect (SPEC-M1 §6.3, §6.5.2): a new connector from the
	 * connector tool or a "+" handle; route and end cap come with the intent
	 * (the scene's tool options). One undo step; the connector is selected.
	 * (job 169) With selectEnd (a connector that hung from a text item's "+")
	 * the item its stored end is bound to is selected alone instead, when it
	 * is in the model; no pan, the user has just clicked or tapped it.
	 *
	 * @param {{start: object, end: object, route?: string, endCap?: string, selectEnd?: boolean}} i connect intent
	 * @return {string|null} new connector id
	 */
	connectNow(i) {
		const r = actions.connectItems(this.model, { start: i.start, end: i.end, route: i.route, endCap: i.endCap })
		if (r.ops.length === 0) {
			return null
		}
		this.commit(r, { urgent: true })
		const x = i.selectEnd === true ? r.ops[0].p.data.end.item : undefined
		this.select(typeof x === 'string' && this.model.has(x) ? [x] : r.selectIds)
		return r.selectIds[0]
	}

	/**
	 * @param {object} put put op of a new item; a text item's h becomes its measured height
	 */
	measurePut(put) {
		if (put?.o !== 'put' || put.t !== 'text') {
			return
		}
		const h = this.measure({ id: put.id, t: put.t, ...put.p })
		if (h !== null) {
			put.p.h = Math.round(h * 100) / 100
		}
	}

	/**
	 * @param {object} item target state of a text item
	 * @return {number|null} scene.measureTextHeight(item), null when unavailable
	 */
	measure(item) {
		try {
			const h = this.scene?.measureTextHeight?.(item)
			return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : null
		} catch (e) {
			console.error('[knorke] measureTextHeight failed', e)
			return null
		}
	}

	/**
	 * @param {string} id item
	 * @return {object|null} the item as this client knows it for sure (the
	 *   replica's visible state; the model may hold a transform preview)
	 */
	knownItem(id) {
		return this.replica.visible(id) ?? (this.model?.has(id) ? this.model.get(id) : null)
	}

	/**
	 * Intent transform (§6.3): measured heights of text items, the stored
	 * placements of the children of transformed containers (the scene's
	 * preview compensates them in the model while a frame keeps them, rule
	 * 15), then the pure action (rule 13).
	 *
	 * @param {object} i transform intent
	 */
	transformNow(i) {
		const origin = new Map()
		for (const id of i.ids ?? []) {
			if (!this.model.has(id) || !typeInfo(this.model.get(id).t).container) {
				continue
			}
			for (const kid of this.model.childrenOf(id) ?? []) {
				const v = this.replica.visible(kid)
				if (v) {
					origin.set(kid, { x: v.x, y: v.y, parent: v.parent ?? null })
				}
			}
		}
		const heights = new Map()
		for (const id of i.ids ?? []) {
			const it = this.knownItem(id)
			const a = pick(i.after, id)
			if (it?.t !== 'text' || !a) {
				continue
			}
			const h = this.measure(actions.measureTarget(it, { w: a.w, fontSize: a.fontSize }))
			if (h !== null) {
				heights.set(id, h)
			}
		}
		this.commit(actions.transformItems(this.model, { ids: i.ids ?? [], before: i.before, after: i.after, keep: i.keep === true, heights, origin }), { urgent: true })
	}

	/**
	 * Intent text (M0 §6.5, SPEC-M1 §6.5.1/§6.5.2): text items carry their
	 * measured height; the first text of a new item merges with its creation;
	 * a new text item that ends empty is deleted; next: 'right' continues a
	 * series of notes.
	 *
	 * @param {object} i text intent
	 */
	textNow(i) {
		// job 173: a cell has a lease of its own
		if (this.leaseLost.has(leaseKey(i.id, i.cell))) {
			return
		}
		if (!this.model.has(i.id)) {
			// No item to patch (T17 backstop; resync keeps edited items, so this
			// should not happen): the final text goes to the copy dialog instead
			// of vanishing. Intermediate texts wait for the final one.
			if (i.final && typeof i.value === 'string' && i.value !== '' && i.value !== i.before) {
				this.ui.onRescue?.({ id: i.id, text: i.value, gone: true })
			}
			return
		}
		const item = this.model.get(i.id)
		if (item.t === 'table' && typeof i.cell === 'string') {
			this.cellTextNow(i)
			return
		}
		// job 195: a node of a mind map has a lease of its own, like a cell
		if (item.t === 'mindmap' && typeof i.cell === 'string') {
			this.nodeTextNow(i)
			return
		}
		// job 199: the name of a lane (job 208: of a column), at its final text only
		if (item.t === 'frame' && typeof i.cell === 'string') {
			if (i.final === true && typeof i.value === 'string') {
				// job 225: or of a group
				const ax = LGROUP_KEY_RE.test(i.cell) ? 'y' : CGROUP_KEY_RE.test(i.cell) ? 'x' : null
				this.laneStep(i.id, () => (ax !== null ? renameGroup(this.model, i.id, i.cell, i.value, ax)
					: (COL_KEY_RE.test(i.cell) ? renameCol : renameLane)(this.model, i.id, i.cell, i.value)))
			}
			return
		}
		const isNew = this.newEdit !== null && this.newEdit.id === i.id
		const key = isNew ? this.newEdit.key : 'text:' + i.id + ':' + this.textSession
		const final = i.final === true || i.next === 'right'
		if (final && isNew && item.t === 'text' && typeof i.value === 'string' && i.value.trim() === '') {
			// SPEC-M1 §6.5.2: an empty new text item vanishes, one undo step with its creation
			this.newEdit = null
			this.commit(actions.deleteItems(this.model, [i.id]), { urgent: true, mergeKey: key })
			this.textSession++
			return
		}
		let h = i.h
		if (item.t === 'text' && !(typeof h === 'number' && Number.isFinite(h) && h > 0)) {
			h = this.measure(actions.measureTarget(this.knownItem(i.id) ?? item, { text: i.value })) ?? undefined
		}
		const r = actions.setText(this.model, { ...i, h })
		this.commit(r, { urgent: final, mergeKey: key })
		this.lastTextKey = { id: i.id, key }
		if (final) {
			this.textSession++
			if (isNew) {
				this.newEdit = null
			}
		}
		if (i.next === 'right' && item.t === 'sticky') {
			this.seriesNext(i.id)
		}
	}

	/**
	 * Series entry (SPEC-M1 §6.5.1): the next note right of `prevId`, same
	 * size, color and frame; its editor opens after the current one closed.
	 *
	 * @param {string} prevId the note just committed
	 */
	seriesNext(prevId) {
		const r = actions.nextNote(this.model, prevId)
		if (r.ops.length === 0) {
			return
		}
		const id = r.selectIds[0]
		const key = 'new:' + id
		this.commit(r, { urgent: true, mergeKey: key })
		this.select(r.selectIds)
		this.newEdit = { id, key }
		queueMicrotask(() => {
			if (!this.destroyed && this.scene && !this.frozen) {
				this.scene.openTextEditor(id)
			}
		})
	}

	// ---- tables (job 173) ------------------------------------------------

	/** @return {string|null} the lease key of the open editor (an item's text or a cell), null without one */
	editKey() {
		return this.editingId === null ? null : leaseKey(this.editingId, this.editingCell)
	}

	/** @return {(text: string, width: number, bold: boolean) => number} the scene's text height of a table cell */
	cellMeasure() {
		return (text, width, bold) => {
			try {
				const h = this.scene?.measureTableCell?.(text, width, bold)
				if (typeof h === 'number' && Number.isFinite(h)) {
					return h
				}
			} catch (e) {
				console.error('[knorke] measureTableCell failed', e)
			}
			return estimateCellHeight(text, width, bold)
		}
	}

	/** @return {number} the largest stored size of an item (limits.maxItemBytes) */
	maxItemBytes() {
		const v = this.limits?.maxItemBytes
		return Number.isInteger(v) && v > 0 ? v : TABLE_MAX_BYTES
	}

	/**
	 * The text of a cell (intent text with cell): one path, "" as null; the
	 * first text of a new table merges with its creation. A row or column
	 * that is gone, or a text that would bring the table over maxItemBytes,
	 * sends nothing: the editor keeps the text with its notice (a final
	 * text whose editor is closing goes to the copy dialog).
	 *
	 * @param {object} i text intent of a cell editor
	 */
	cellTextNow(i) {
		const key = leaseKey(i.id, i.cell)
		const final = i.final === true
		// well-formed UTF-16 (T14), as actions.setText: the local model equals what the server stores
		const value = typeof i.value === 'string' ? wellFormed(i.value) : ''
		const it = this.knownItem(i.id) ?? this.model.get(i.id)
		const lost = (notice) => {
			this.loseLease(key, notice)
			if (final && value !== '' && value !== i.before) {
				this.ui.onRescue?.({ id: i.id, text: value, gone: false })
			}
		}
		const r = setCellText(it, i.cell, value, typeof i.before === 'string' ? i.before : undefined)
		if (r.error) {
			lost(t('knorke', 'Not saved. Copy your text before closing.'))
			return
		}
		if (tableBytes(applyTablePatch(it, r.p)) > this.maxItemBytes()) {
			lost(t('knorke', 'Not saved: the table is full. Copy your text before closing.'))
			return
		}
		const isNew = this.newEdit !== null && this.newEdit.id === i.id
		const mergeKey = isNew ? this.newEdit.key : 'text:' + key + ':' + this.textSession
		this.commit({ ops: [{ o: 'patch', id: i.id, p: r.p }], inverse: [{ o: 'patch', id: i.id, p: r.inv }] }, { urgent: final, mergeKey })
		this.lastTextKey = { id: key, key: mergeKey }
		if (final) {
			this.textSession++
			if (isNew) {
				this.newEdit = null
			}
		}
	}

	/**
	 * One structure or width change of a table (one undo step), measured
	 * again (withSize: w and h that differ travel along). Nothing at 50 rows
	 * or 20 columns or when the result would not fit maxItemBytes: an info
	 * names the limit.
	 *
	 * @param {string} id table
	 * @param {(item: object) => ({p: object, inv: object}|{error: string})} make the op builder (model/table.js)
	 * @return {boolean} something was sent
	 */
	tableStep(id, make) {
		if (this.viewOnly || this.frozen || !this.model?.has(id) || isLocked(this.model.get(id))) {
			return false
		}
		const it = this.knownItem(id)
		if (it?.t !== 'table') {
			return false
		}
		let r = null
		this.guard(() => {
			r = make(it)
		})
		if (r === null) {
			return false
		}
		if (r.error === 'rows') {
			this.info(t('knorke', 'A table can have at most 50 rows.'), { hook: 'table-limit' })
			return false
		}
		if (r.error === 'cols') {
			this.info(t('knorke', 'A table can have at most 20 columns.'), { hook: 'table-limit' })
			return false
		}
		if (r.error) {
			return false
		}
		withSize(it, r, this.cellMeasure())
		if (tableBytes(applyTablePatch(it, r.p)) > this.maxItemBytes()) {
			this.info(t('knorke', 'The table is full.'), { hook: 'table-full' })
			return false
		}
		this.guard(() => this.commit({ ops: [{ o: 'patch', id, p: r.p }], inverse: [{ o: 'patch', id, p: r.inv }] }, { urgent: true }))
		return true
	}

	/**
	 * The "+" of a table: an empty column (TABLE_COL_W) or row at its end.
	 * (Job 174) With open (Tab in the last cell, whose editor has just closed
	 * with its own undo step) the editor of the new row's left cell opens.
	 *
	 * @param {string} id table
	 * @param {'col'|'row'} axis what to append
	 * @param {{open?: boolean}} [o] open the left cell of a new row
	 * @return {boolean} sent
	 */
	tableAppend(id, axis, { open = false } = {}) {
		let key = null
		const sent = this.tableStep(id, (it) => {
			const r = axis === 'col' ? insertCol(it, {}, this.rand) : insertRow(it, {}, this.rand)
			key = typeof r.key === 'string' ? r.key : null
			return r
		})
		const col = sent && open && axis === 'row' && key !== null ? orderedCols(this.model.get(id)?.data)[0] : null
		if (col) {
			this.scene?.openTextEditor(id, { cell: cellKey(col.key, key) })
		}
		return sent
	}

	/**
	 * (Job 174) Cells from a spreadsheet pasted into a cell (model/table.js
	 * pasteCells): from that cell on, new columns as needed up to 20 (job
	 * 185) and new rows up to 50, as ONE undo step of several patches; the
	 * table stays selected. Nothing goes out for a locked table, in mode vote
	 * or view or on a frozen board (without a notice), when someone else
	 * holds a target cell whose text changes ("Someone else is writing in one
	 * of these cells.") or when a state would exceed maxItemBytes ("The table
	 * is full."); what reaches beyond the 20th column or the 50th row is left
	 * out, the rest goes out with "Not all pasted cells fit into the table.".
	 *
	 * @param {string} id table
	 * @param {string} cell the top-left cell (the editor's)
	 * @param {string[][]} grid clipGrid
	 * @return {boolean} something was sent
	 */
	tablePaste(id, cell, grid) {
		if (this.viewOnly || this.frozen || !this.model?.has(id) || isLocked(this.model.get(id))) {
			return false
		}
		const it = this.knownItem(id)
		if (it?.t !== 'table') {
			return false
		}
		const held = (c) => {
			const h = this.presence.leaseHolder(id, c)
			return h !== null && h.pid !== this.me?.pid
		}
		let r = null
		this.guard(() => {
			r = pasteCells(it, cell, grid, { rand: this.rand, measure: this.cellMeasure(), maxBytes: this.maxItemBytes(), held })
		})
		if (r === null) {
			return false
		}
		if (r.error === 'held') {
			this.info(t('knorke', 'Someone else is writing in one of these cells.'), { hook: 'table-paste-held' })
			return false
		}
		if (r.error === 'bytes') {
			this.info(t('knorke', 'The table is full.'), { hook: 'table-full' })
			return false
		}
		if (r.error) {
			return false
		}
		const sent = r.patches.length > 0
		if (sent) {
			const op = (p) => ({ o: 'patch', id, p })
			this.guard(() => this.commit({ ops: r.patches.map(op), inverse: r.inverse.map(op) }, { urgent: true }))
		}
		if (r.cut) {
			this.info(t('knorke', 'Not all pasted cells fit into the table.'), { hook: 'table-paste-cut' })
		}
		if (this.selection.length !== 1 || this.selection[0] !== id) {
			this.select([id])
		}
		return sent
	}

	/**
	 * A column border was dragged: the column's new width.
	 *
	 * @param {string} id table
	 * @param {string} col column key
	 * @param {number} w width
	 * @return {boolean} sent
	 */
	tableWidth(id, col, w) {
		return this.tableStep(id, (it) => setColWidth(it, col, w))
	}

	/**
	 * A table entry of the context menu on the cell of the menu (row-above,
	 * row-below, col-left, col-right, row-delete, col-delete, table-csv).
	 *
	 * @param {string} name entry
	 * @param {string|null} id the menu's table
	 * @param {string|null} cell the cell under W when the menu opened
	 * @return {boolean} it acted
	 */
	tableMenuAction(name, id, cell) {
		if (typeof id !== 'string' || !this.model?.has(id) || this.model.get(id).t !== 'table') {
			return false
		}
		if (name === 'table-csv') {
			return this.exportCsv(id)
		}
		const c = parseCell(cell)
		if (c === null) {
			return false
		}
		switch (name) {
		case 'row-above':
		case 'row-below':
			return this.tableStep(id, (it) => insertRow(it, { at: c.row, where: name === 'row-above' ? 'above' : 'below' }, this.rand))
		case 'col-left':
		case 'col-right':
			return this.tableStep(id, (it) => insertCol(it, { at: c.col, where: name === 'col-left' ? 'left' : 'right' }, this.rand))
		case 'row-delete':
			return this.tableStep(id, (it) => deleteRow(it, c.row))
		case 'col-delete':
			return this.tableStep(id, (it) => deleteCol(it, c.col))
		default:
			return false
		}
	}

	// ---- swimlanes (job 199) ---------------------------------------------

	/**
	 * One change of a frame with lanes and its children (one undo step).
	 * Nothing in mode view or vote, on a frozen board or at a locked frame;
	 * an info names the limit (30 lanes, a frame too tall, a locked child in
	 * the way; job 208: 30 columns, a frame too wide).
	 *
	 * @param {string} id frame
	 * @param {() => ({ops: object[], inverse: object[]}|{error: string})} make the op builder (model/lanes.js)
	 * @param {'lane'|'col'} [what] (job 208) what the limit of 'max' names
	 * @return {object|null} what make gave when it went out, else null
	 */
	laneStep(id, make, what = 'lane') {
		if (this.viewOnly || this.frozen || !this.model?.has(id) || isLocked(this.model.get(id)) || !hasLanes(this.model.get(id))) {
			return null
		}
		let r = null
		this.guard(() => {
			r = make()
		})
		if (r === null) {
			return null
		}
		if (r.error === 'max') {
			this.info(what === 'col'
				? t('knorke', 'A frame can have at most {n} columns.', { n: COLS_MAX })
				: t('knorke', 'A frame can have at most {n} lanes.', { n: LANES_MAX }), { hook: 'lane-limit' })
			return null
		}
		if (r.error === 'wide') {
			this.info(t('knorke', 'The frame cannot get any wider.'), { hook: 'lane-limit' })
			return null
		}
		if (r.error === 'tall') {
			this.info(t('knorke', 'The frame cannot get any taller.'), { hook: 'lane-limit' })
			return null
		}
		if (r.error === 'locked') {
			this.info(t('knorke', 'Locked items are in the way. Unlock them first.'), { hook: 'lane-locked' })
			return null
		}
		if (r.error) {
			return null
		}
		this.guard(() => this.commit({ ops: r.ops, inverse: r.inverse }, { urgent: true }))
		return r
	}

	/**
	 * A new lane without a name above or below a lane, or at the end (the
	 * "+"); the editor of its name opens.
	 *
	 * @param {string} id frame
	 * @param {{at?: (string|null), where?: ('above'|'below')}} [o] the lane of the menu (null: at the end)
	 * @return {boolean} sent
	 */
	laneAdd(id, { at = null, where = 'below' } = {}) {
		const r = this.laneStep(id, () => addLane(this.model, id, { at, where }, this.rand))
		if (r === null) {
			return false
		}
		this.scene?.openTextEditor(id, { cell: r.key })
		return true
	}

	/**
	 * (Job 208) A new column without a name left or right of a column, or at
	 * the end (the "+"; on a frame without columns the first one); the editor
	 * of its name opens.
	 *
	 * @param {string} id frame
	 * @param {{at?: (string|null), where?: ('left'|'right')}} [o] the column of the menu (null: at the end)
	 * @return {boolean} sent
	 */
	colAdd(id, { at = null, where = 'right' } = {}) {
		const r = this.laneStep(id, () => addCol(this.model, id, { at, where }, this.rand), 'col')
		if (r === null) {
			return false
		}
		this.scene?.openTextEditor(id, { cell: r.key })
		return true
	}

	/**
	 * A lane entry of the context menu on the lane of the menu (lane-rename,
	 * lane-above, lane-below, lane-up, lane-down, lane-delete); (job 208) a
	 * column entry on its column (column-add, column-rename, column-left,
	 * column-right, column-move-left, column-move-right, column-delete).
	 *
	 * @param {string} name entry
	 * @param {string|null} id the menu's frame
	 * @param {string|null} lane the lane under W when the menu opened
	 * @param {string|null} [col] (job 208) the column under W then
	 * @return {boolean} it acted
	 */
	laneMenuAction(name, id, lane, col = null) {
		if (typeof id !== 'string' || typeof lane !== 'string' || !LANE_KEY_RE.test(lane) || !hasLanes(this.model?.get(id))) {
			return false
		}
		if (name === 'column-add') {
			return !hasCols(this.model.get(id)) && this.colAdd(id)
		}
		if (name.startsWith('column-') && (typeof col !== 'string' || !COL_KEY_RE.test(col) || !hasCols(this.model.get(id)))) {
			return false
		}
		switch (name) {
		case 'column-rename':
			return this.scene?.openTextEditor(id, { cell: col }) === true
		case 'column-left':
		case 'column-right':
			return this.colAdd(id, { at: col, where: name === 'column-left' ? 'left' : 'right' })
		case 'column-move-left':
		case 'column-move-right':
			return this.laneStep(id, () => moveCol(this.model, id, col, name === 'column-move-left' ? -1 : 1), 'col') !== null
		case 'column-delete':
			return this.laneStep(id, () => deleteLaneCol(this.model, id, col), 'col') !== null
		case 'lane-rename':
			return this.scene?.openTextEditor(id, { cell: lane }) === true
		case 'lane-above':
		case 'lane-below':
			return this.laneAdd(id, { at: lane, where: name === 'lane-above' ? 'above' : 'below' })
		case 'lane-up':
		case 'lane-down':
			return this.laneStep(id, () => moveLane(this.model, id, lane, name === 'lane-up' ? -1 : 1)) !== null
		case 'lane-delete':
			return this.laneStep(id, () => deleteLane(this.model, id, lane)) !== null
		case 'lane-group':
		case 'column-group':
			return this.groupAdd(id, name === 'column-group' ? col : lane, name === 'column-group' ? 'x' : 'y')
		case 'lane-group-rename':
		case 'column-group-rename':
		case 'lane-ungroup':
		case 'column-ungroup': {
			// job 225: the group of the menu's lane (column)
			const ax = name.startsWith('column-') ? 'x' : 'y'
			const it = this.model.get(id)
			const g = (ax === 'x' ? colBands(it) : laneBands(it)).find((b) => b.key === (ax === 'x' ? col : lane))?.g ?? null
			if (g === null) {
				return false
			}
			if (name.endsWith('-rename')) {
				return this.scene?.openTextEditor(id, { cell: g }) === true
			}
			return this.laneStep(id, () => ungroup(this.model, id, g, ax), ax === 'x' ? 'col' : 'lane') !== null
		}
		default:
			return false
		}
	}

	/**
	 * (Job 225) "Create lane group" ("… column group"): a new group without a
	 * name with the lane (column) of the menu; the editor of its name opens.
	 *
	 * @param {string} id frame
	 * @param {string} key lane or column
	 * @param {'x'|'y'} ax column or lane
	 * @return {boolean} sent
	 */
	groupAdd(id, key, ax) {
		const r = this.laneStep(id, () => (ax === 'x' ? groupCol : groupLane)(this.model, id, key, this.rand), ax === 'x' ? 'col' : 'lane')
		if (r === null) {
			return false
		}
		this.scene?.openTextEditor(id, { cell: r.key })
		return true
	}

	// ---- mind maps (job 195) ---------------------------------------------

	/** @return {(text: string, maxW: number, size: number, bold: boolean) => {w: number, h: number}} the scene's node text size */
	nodeMeasure() {
		return (text, maxW, size, bold) => {
			try {
				const m = this.scene?.measureNodeText?.(text, maxW, size, bold)
				if (m && Number.isFinite(m.w) && Number.isFinite(m.h)) {
					return m
				}
			} catch (e) {
				console.error('[knorke] measureNodeText failed', e)
			}
			return estimateNodeSize(text, maxW, size, bold)
		}
	}

	/**
	 * The text of a node (intent text with the node as cell): one path, "" as
	 * null, with the box when the layout moved (model/mindmap.js withBox: the
	 * root keeps its place, also between two commits of one text); the first
	 * text of a new node or map merges with its creation. A node that is
	 * gone, or a text that would bring the map over maxItemBytes, sends
	 * nothing: the editor keeps the text with its notice.
	 *
	 * @param {object} i text intent of a node editor
	 */
	nodeTextNow(i) {
		const key = leaseKey(i.id, i.cell)
		const final = i.final === true
		const value = typeof i.value === 'string' ? wellFormed(i.value) : ''
		const it = this.knownItem(i.id) ?? this.model.get(i.id)
		const lost = (notice) => {
			this.loseLease(key, notice)
			if (final && value !== '' && value !== i.before) {
				this.ui.onRescue?.({ id: i.id, text: value, gone: false })
			}
		}
		const r = setNodeText(it, i.cell, value, typeof i.before === 'string' ? i.before : undefined)
		if (r.error) {
			lost(t('knorke', 'Not saved. Copy your text before closing.'))
			return
		}
		withBox(it, r, this.nodeMeasure())
		if (mindmapBytes(applyMindmapPatch(it, r.p)) > this.maxItemBytes()) {
			lost(t('knorke', 'Not saved: the mind map is full. Copy your text before closing.'))
			return
		}
		const isNew = this.newEdit !== null && this.newEdit.id === i.id && (this.newEdit.node === undefined || this.newEdit.node === i.cell)
		const mergeKey = isNew ? this.newEdit.key : 'text:' + key + ':' + this.textSession
		this.commit({ ops: [{ o: 'patch', id: i.id, p: r.p }], inverse: [{ o: 'patch', id: i.id, p: r.inv }] }, { urgent: final, mergeKey })
		this.lastTextKey = { id: key, key: mergeKey }
		if (final) {
			this.textSession++
			if (isNew) {
				this.newEdit = null
			}
		}
	}

	/**
	 * One structure, colour, shape, fold or layout change of a mind map (one
	 * undo step): the op builder's patch (or patches, children first), the box
	 * in the last one when the layout moved (withBox). Nothing for a locked
	 * map, in mode vote or view, on a frozen board; at 500 nodes or when the
	 * result would not fit maxItemBytes an info names the limit.
	 *
	 * @param {string} id mind map
	 * @param {(item: object) => object} make op builder (model/mindmap.js): {p, inv, key?}, {patches, inverse} or {error}
	 * @param {{mergeKey?: ((r: object) => string)|null}} [o] the undo key of the step (a new node: its first text merges)
	 * @return {object|null} what the builder gave, when something was sent
	 */
	mindmapStep(id, make, { mergeKey = null } = {}) {
		if (this.viewOnly || this.frozen || !this.model?.has(id) || isLocked(this.model.get(id))) {
			return null
		}
		const it = this.knownItem(id)
		if (it?.t !== 'mindmap') {
			return null
		}
		let r = null
		this.guard(() => {
			r = make(it)
		})
		if (r === null) {
			return null
		}
		if (r.error === 'nodes') {
			this.info(t('knorke', 'A mind map can have at most 500 nodes.'), { hook: 'mindmap-limit' })
			return null
		}
		if (r.error) {
			return null
		}
		const patches = Array.isArray(r.patches) ? r.patches.map((x) => ({ ...x })) : [{ ...r.p }]
		const inverse = Array.isArray(r.inverse) ? r.inverse.map((x) => ({ ...x })) : [{ ...r.inv }]
		const box = withBox(it, { p: Object.assign({}, ...patches), inv: {} }, this.nodeMeasure())
		const tail = BOX_PATHS.filter((k) => Object.prototype.hasOwnProperty.call(box.p, k))
		if (tail.length > 0) {
			const last = patches[patches.length - 1]
			const room = Object.keys(last).length + tail.length <= 50
			const into = room ? last : {}
			for (const k of tail) {
				into[k] = box.p[k]
			}
			if (!room) {
				patches.push(into)
			}
			const inv = inverse[inverse.length - 1]
			for (const k of tail) {
				inv[k] = box.inv[k]
			}
		}
		let state = it
		for (const x of patches) {
			state = applyMindmapPatch(state, x)
		}
		if (mindmapBytes(state) > this.maxItemBytes()) {
			this.info(t('knorke', 'The mind map is full.'), { hook: 'mindmap-full' })
			return null
		}
		const op = (x) => ({ o: 'patch', id, p: x })
		this.guard(() => this.commit({ ops: patches.map(op), inverse: inverse.map(op) }, { urgent: true, mergeKey: typeof mergeKey === 'function' ? mergeKey(r) : null }))
		return r
	}

	/**
	 * A new child or sibling of a node ("+", Tab, Enter, the menu): one undo
	 * step with its first text; the new node gets the focus and, with open,
	 * its editor. A sibling of the root is a child.
	 *
	 * @param {string} id mind map
	 * @param {string} key the node
	 * @param {'child'|'sibling'} as what to add
	 * @param {{side?: ('l'|'r'|null), open?: boolean}} [o] side of a new main branch, open its editor
	 * @return {string|null} the new node's key
	 */
	mindmapAdd(id, key, as, { side = null, open = false } = {}) {
		const it0 = this.model?.get(id)
		if (it0?.t !== 'mindmap' || typeof key !== 'string') {
			return null
		}
		const child = as !== 'sibling' || mindTree(it0).root === key
		const mergeKey = (r) => 'new:' + id + '#' + r.key
		const r = this.mindmapStep(id, (it) => (child ? addChild(it, key, { side }, this.rand) : addSibling(it, key, this.rand)), { mergeKey })
		if (r === null || typeof r.key !== 'string') {
			return null
		}
		if (this.selection.length !== 1 || this.selection[0] !== id) {
			this.select([id])
		}
		this.scene?.focusNode?.(id, r.key)
		if (open && this.scene) {
			// set after openTextEditor, like createNow: a closing editor must not take this node for its own
			this.scene.openTextEditor(id, { cell: r.key })
			this.newEdit = { id, key: mergeKey(r), node: r.key }
		}
		return r.key
	}

	/**
	 * Delete at the focus, "Delete branch": the node with its subtree; the
	 * focus goes to the node before it in its row, else after it, else its
	 * parent (model/mindmap.js focusAfterDelete).
	 *
	 * @param {string} id mind map
	 * @param {string} key node (never the root)
	 * @return {boolean} sent
	 */
	mindmapDelete(id, key) {
		const it = this.knownItem(id)
		const next = it?.t === 'mindmap' ? focusAfterDelete(it, key) : null
		const r = this.mindmapStep(id, (x) => deleteBranch(x, key))
		if (r === null) {
			return false
		}
		if (next !== null) {
			this.scene?.focusNode?.(id, next)
		}
		return true
	}

	/**
	 * A node dragged (intent mmMove): onto a target as moveNode says, or (job
	 * 196) without one placed freely with the centre of its box at a world
	 * point (placeNode). One undo step; the free nodes below it travel along.
	 *
	 * @param {string} id mind map
	 * @param {string} key the dragged node
	 * @param {object|null} target model/mindmap.js dropTarget
	 * @param {{x: number, y: number}|null} place world centre of the ghost (no target)
	 * @return {boolean} sent
	 */
	mindmapPlace(id, key, target, place) {
		const measure = this.nodeMeasure()
		if (target !== null) {
			return this.mindmapStep(id, (it) => moveNode(it, key, target, measure)) !== null
		}
		const a = this.model?.has(id) ? this.model.abs?.(id) : null
		if (!a || !Number.isFinite(place?.x) || !Number.isFinite(place?.y)) {
			return false
		}
		return this.mindmapStep(id, (it) => placeNode(it, key, { x: place.x - a.x, y: place.y - a.y }, measure)) !== null
	}

	/**
	 * The context bar's sections "Branch" and (job 198) "Layout": colour (c)
	 * and shape (s) of the focused node, style.layout of the one selected
	 * mind map (both stored as none); one undo step each. A click on the
	 * layout or the shape drawn now sends nothing.
	 *
	 * @param {'color'|'shape'|'layout'} what what changes
	 * @param {string|null} value colour #rrggbb, a shape of MM_SHAPES, a layout of MM_LAYOUTS
	 * @return {boolean} sent
	 */
	mindmapStyle(what, value) {
		const id = this.selection.length === 1 ? this.selection[0] : null
		if (id === null || this.model?.get(id)?.t !== 'mindmap') {
			return false
		}
		if (what === 'layout') {
			if (!MM_LAYOUTS.includes(value)) {
				return false
			}
			const v = value === 'both' ? null : value
			return this.mindmapStep(id, (it) => {
				const now = mindTree(it).layout
				return (now === 'both' ? null : now) === v ? { error: 'same' } : { p: { 'style.layout': v }, inv: { 'style.layout': it.style?.layout ?? null } }
			}) !== null
		}
		const f = this.mmFocus !== null && this.mmFocus.id === id ? this.mmFocus.key : null
		if (f === null) {
			return false
		}
		if (what === 'color') {
			return this.mindmapStep(id, (it) => setNodeField(it, f, 'c', typeof value === 'string' ? value.toLowerCase() : null)) !== null
		}
		if (what === 'shape') {
			return this.mindmapStep(id, (it) => {
				const tree = mindTree(it)
				const e = tree.nodes.get(f)
				// (job 198) the shape drawn now (in org and tree line is drawn as roundRect)
				if (e && drawnShape(e.n, e.parent === null, tree.layout, e.depth) === value) {
					return { error: 'same' }
				}
				// the default shape is stored as none (job 266: a main branch's is pill)
				const plain = e && defaultShape(e.parent === null, e.depth, tree.layout) === value
				return setNodeField(it, f, 's', plain ? null : value)
			}) !== null
		}
		return false
	}

	/**
	 * (Job 195) The mind map of a menu: on a node of the one selected map,
	 * {mindmap: {root, kids, folded, locked, placed}} (contextbar.js menuEntries; job 196 placed: "Rearrange" acts
	 * there), else nothing.
	 *
	 * @param {object} m the menu state
	 * @return {object} {mindmap} or {}
	 */
	menuMindmap(m) {
		const it = m.cell !== null && m.id !== null && this.selection.length === 1 && this.selection[0] === m.id ? this.model?.get(m.id) : null
		if (!it || it.t !== 'mindmap') {
			return {}
		}
		const e = mindTree(it).nodes.get(m.cell)
		if (!e) {
			return {}
		}
		return { mindmap: { root: e.parent === null, kids: e.kids.length, folded: e.n.f === true, locked: isLocked(it), placed: hasPlaced(it, m.cell) } }
	}

	/**
	 * A mind map entry of the context menu on the node of the menu (mm-child,
	 * mm-sibling, mm-fold, mm-delete, mm-text; job 196 mm-rearrange).
	 *
	 * @param {string} name entry
	 * @param {string|null} id the menu's mind map
	 * @param {string|null} key the node under W when the menu opened
	 * @return {boolean} it acted
	 */
	mindmapMenuAction(name, id, key) {
		if (typeof id !== 'string' || typeof key !== 'string' || this.model?.get(id)?.t !== 'mindmap') {
			return false
		}
		switch (name) {
		case 'mm-child':
			return this.mindmapAdd(id, key, 'child', { open: true }) !== null
		case 'mm-sibling':
			return this.mindmapAdd(id, key, 'sibling', { open: true }) !== null
		case 'mm-fold':
			return this.mindmapStep(id, (it) => toggleFold(it, key)) !== null
		case 'mm-rearrange':
			return this.mindmapStep(id, (it) => rearrange(it, key)) !== null
		case 'mm-delete':
			return this.mindmapDelete(id, key)
		case 'mm-text':
			return this.copyMindmapText(id, key)
		default:
			return false
		}
	}

	/**
	 * "Copy as text": a node and its subtree as an indented list
	 * (model/mindmap.js outlineText), text/plain only (components/copyText.js:
	 * inside the click); an info says whether it worked. No op, no undo step.
	 *
	 * @param {string} id mind map
	 * @param {string|null} key the top node (null: the root)
	 * @return {boolean} the copy started
	 */
	copyMindmapText(id, key) {
		const it = this.knownItem(id)
		if (it?.t !== 'mindmap') {
			return false
		}
		const text = outlineText(it, key)
		if (text === '') {
			return false
		}
		const copy = this.deps.copyText ?? copyText
		Promise.resolve(copy(text))
			.then((ok) => {
				if (ok === true) {
					this.info(t('knorke', 'Copied as text.'), { hook: 'mindmap-copied' })
				} else {
					this.toast(t('knorke', 'The text could not be copied.'))
				}
			})
			.catch(() => this.toast(t('knorke', 'The text could not be copied.')))
		return true
	}

	/**
	 * (Job 195) An indented list pasted as plain text: ONE mind map
	 * (actions.mindmapFromText) at the point, selected; what was left out is
	 * named in an info.
	 *
	 * @param {{root: string, lines: object[]}} outline model/mindmap.js parseOutline
	 * @param {{x: number, y: number}|null} where world point ("Paste here"); default pointer or viewport center
	 */
	pasteOutline(outline, where) {
		if (this.destroyed || this.frozen || this.viewOnly || !this.model) {
			return
		}
		const at = where ?? (Array.isArray(this.pointer) ? { x: this.pointer[0], y: this.pointer[1] } : this.viewportCenter())
		const r = actions.mindmapFromText(this.model, outline, { at, limits: this.limits, measure: this.nodeMeasure(), maxBytes: this.maxItemBytes(), rand: this.rand })
		this.finishPaste({ ...r, skipped: 0 }, 0)
		if (!r.full && r.cut > 0) {
			this.info(n('knorke', '%n line was left out.', '%n lines were left out.', r.cut), { hook: 'mindmap-cut' })
		}
	}

	// Factory job 253: export and file insert live in board/sessionFiles.js (SessionFiles, this.files); these hand over.

	/** @param {string} id table @return {boolean} (sessionFiles.js) "Export as CSV" of the table */
	exportCsv(id) {
		return this.files.exportCsv(id)
	}

	/** @return {';'|','} (sessionFiles.js) the CSV separator of the language */
	csvSep() {
		return this.files.csvSep()
	}

	/** @param {'board'|'selection'} scope @return {boolean} (sessionFiles.js) "Save as CSV" */
	exportBoardCsv(scope) {
		return this.files.exportBoardCsv(scope)
	}

	/** @param {'board'|'selection'} scope @return {Promise<boolean>} (sessionFiles.js) "Save as image (PNG)" */
	exportPng(scope) {
		return this.files.exportPng(scope)
	}

	/** @param {'board'|'selection'} scope @param {'svg'|'pdf'} format @param {{page?: string}} [opts] @return {Promise<boolean>} (sessionFiles.js) "Save as SVG" / "Save as PDF" */
	exportVector(scope, format, opts) {
		return this.files.exportVector(scope, format, opts)
	}

	/** @return {string} (sessionFiles.js) the page size "Save as PDF…" starts with */
	pdfPage() {
		return this.files.pdfPage()
	}

	/** @param {'board'|'selection'} scope @return {boolean} (sessionFiles.js) "Save as PDF…": the dialog opened, or the PDF is being saved */
	openPdfExport(scope) {
		return this.files.openPdfExport(scope)
	}

	/** @param {string} key board/templates.js TEMPLATE_KEYS @return {boolean} (sessionFiles.js) the template was inserted */
	insertTemplate(key) {
		return this.files.insertTemplate(key)
	}

	/** @param {'board'|'selection'} scope @return {Promise<boolean>} (sessionFiles.js) "Save as BPMN" */
	exportBpmn(scope) {
		return this.files.exportBpmn(scope)
	}

	/** @return {boolean} (sessionFiles.js) "Download board" */
	exportBoardFile() {
		return this.files.exportBoardFile()
	}

	/** @param {'board'|'selection'} scope @return {object|null} (sessionFiles.js) the draft of "Suggest as template…" */
	templateDraft(scope) {
		return this.files.templateDraft(scope)
	}

	/** @param {string|null} text @return {boolean} (sessionFiles.js) a board file was inserted */
	insertBoardFile(text) {
		return this.files.insertBoardFile(text)
	}

	/** @param {string|null} text @return {Promise<boolean>} (sessionFiles.js) a .bpmn file was inserted */
	insertBpmnFile(text) {
		return this.files.insertBpmnFile(text)
	}

	/** @param {Uint8Array|null} bytes @return {Promise<boolean>} (sessionFiles.js) a CSV file was inserted as notes */
	insertCsvFile(bytes) {
		return this.files.insertCsvFile(bytes)
	}

	/** @param {string|null} content @return {boolean} (sessionFiles.js) an adopted template was inserted */
	insertOwnTemplate(content) {
		return this.files.insertOwnTemplate(content)
	}

	/**
	 * After an undo or redo (job 173): the tables the ops touch, measured in
	 * the state they leave; a {w, h} patch for each one whose stored size
	 * differs goes along (not part of the step). (Job 195) The mind maps they
	 * touch as well, with their box (model/mindmap.js withBox): when the ops
	 * bring the place back (they carry x), only w and h; else the root keeps
	 * the place it has now (the box of the state before the ops with all
	 * their patches, like a new step), also when someone else changed the
	 * map's place meanwhile and the step's place was skipped.
	 *
	 * @param {object[]} ops the ops that go out
	 * @return {object[]} the ops with the size patches appended
	 */
	withTableSizes(ops) {
		const out = [...ops]
		const ids = new Set(ops.filter((op) => op.o === 'patch' || op.o === 'put').map((op) => op.id))
		for (const id of ids) {
			let it = this.replica.visible(id)
			if (it?.t !== 'table' && it?.t !== 'mindmap') {
				continue
			}
			const before = it
			for (const op of ops) {
				if (op.id === id && op.o === 'patch' && op.p) {
					it = it.t === 'mindmap' ? applyMindmapPatch(it, op.p) : applyTablePatch(it, op.p)
				} else if (op.id === id && op.o === 'remove') {
					it = null
					break
				}
			}
			if (it === null) {
				continue
			}
			if (it.t === 'mindmap') {
				// job 195: a mind map's box; the root stays where it is unless the ops set the place
				const patches = ops.filter((op) => op.id === id && op.o === 'patch' && op.p).map((op) => op.p)
				const placed = patches.some((p) => Object.prototype.hasOwnProperty.call(p, 'x'))
				const r = placed
					? withBox(it, { p: {}, inv: {} }, this.nodeMeasure())
					: withBox(before, { p: Object.assign({}, ...patches), inv: {} }, this.nodeMeasure())
				const p = Object.fromEntries(BOX_PATHS.filter((k) => Object.prototype.hasOwnProperty.call(r.p, k)).map((k) => [k, r.p[k]]))
				if (Object.keys(p).length > 0) {
					out.push({ o: 'patch', id, p })
				}
				continue
			}
			const r = withSize(it, { p: {}, inv: {} }, this.cellMeasure())
			if (Object.keys(r.p).length > 0) {
				out.push({ o: 'patch', id, p: r.p })
			}
		}
		return out
	}

	/**
	 * Undo key of an arrow-key series (SPEC-M1 §6.3): the same items moved
	 * again within NUDGE_MERGE_MS → the same key (one undo step).
	 *
	 * @param {string[]} ids moved items
	 * @return {string} merge key
	 */
	nudgeKey(ids) {
		const sig = [...ids].sort().join(',')
		const now = this.now()
		if (this.nudgeSeries === null || this.nudgeSeries.sig !== sig || now - this.nudgeSeries.at > NUDGE_MERGE_MS) {
			this.nudgeCount++
			this.nudgeSeries = { sig, at: now, key: 'nudge:' + sig + ':' + this.nudgeCount }
		}
		this.nudgeSeries.at = now
		return this.nudgeSeries.key
	}

	/**
	 * @param {string[]} ids new selection (scene and shell)
	 */
	select(ids) {
		this.sortSelectionChange(ids)
		this.scene?.setSelection(ids)
		this.selection = [...ids]
		this.emitSelection()
	}

	/**
	 * Sends ops, records the undo step, shows the result at once. Safety net
	 * (M2, R20): an op on an item that is locked in the model (lock patches
	 * excepted) is left out silently; the inverse stays as it is, and the
	 * item shows its visible state again (a drag that a lock overtook jumps
	 * back). Nothing left to send: no undo step (job 206: but the tag part, alone).
	 *
	 * @param {{ops: object[], inverse: object[]}} r action result
	 * @param {{urgent?: boolean, mergeKey?: string|null, tag?: object|null}} [o] options (tag: job 206, the step's tag part)
	 */
	commit(r, { urgent = true, mergeKey = null, tag = null } = {}) {
		if (!r || !Array.isArray(r.ops) || r.ops.length === 0 || !this.sync) {
			return
		}
		const held = new Set()
		const ops = r.ops.filter((op) => {
			if (this.heldByLock(op)) {
				held.add(op.id)
				return false
			}
			return true
		})
		if (ops.length === 0) {
			this.flushVisible(held)
			this.recordTagStep(tag)
			return
		}
		if (!this.sortNaming) {
			// job 139: every other commit ends the name fields (typed names first, steps of their own)
			this.endSortLabels()
		}
		// job 189: threads on removed items keep their last corner
		this.commentsOnRemove(ops)
		const ids = this.sync.enqueue(ops, { urgent })
		this.undoStack.push({ ops: r.ops, inverse: r.inverse, mergeKey, tag })
		for (const id of held) {
			ids.add(id)
		}
		this.flushVisible(ids)
		this.emitUndo()
	}

	/**
	 * commit() urgently, then the selection is reported exactly once: by the
	 * commit's flush when a selected box moved (job 146), else here (the
	 * selection stays; Align, Distribute, Tidy up, Arrange).
	 *
	 * @param {{ops: object[], inverse: object[]}} r action result
	 */
	commitReported(r) {
		const reports = this.selectionReports
		this.commit(r, { urgent: true })
		if (this.selectionReports === reports) {
			this.emitSelection()
		}
	}

	/**
	 * @param {object} op op about to be sent
	 * @return {boolean} the op touches an item that is locked in the model and is no lock patch (M2, R20)
	 */
	heldByLock(op) {
		return !!op && typeof op.id === 'string' && op.o !== 'vote' && !isLockPatch(op)
			&& !!this.model?.has(op.id) && isLocked(this.model.get(op.id))
	}

	/**
	 * @param {string[]} ids items
	 * @return {string[]} those the model holds and that are not locked (M2, R20), in order
	 */
	unlockedOf(ids) {
		return (ids ?? []).filter((id) => this.model?.has(id) && !isLocked(this.model.get(id)))
	}

	/** @param {string[]} ids items to delete */
	deleteIds(ids) {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => this.deleteNow(ids))
	}

	/**
	 * Deletes the unlocked items of ids (M2, R20); locked ones stay (and stay
	 * selected), with the toast lock-delete naming their number.
	 *
	 * @param {string[]} ids items to delete
	 */
	deleteNow(ids) {
		const free = this.unlockedOf(ids)
		const held = (ids ?? []).filter((id) => this.model.has(id)).length - free.length
		if (free.length > 0) {
			this.commit(actions.deleteItems(this.model, free), { urgent: true })
		}
		if (held > 0) {
			this.info(n('knorke', '%n locked item was not deleted.', '%n locked items were not deleted.', held), { hook: 'lock-delete' })
		}
		const gone = new Set(free)
		const rest = this.selection.filter((id) => !gone.has(id))
		if (rest.length !== this.selection.length) {
			this.selection = rest
			this.scene?.setSelection(rest)
			this.emitSelection()
		}
	}

	/**
	 * Undo or redo of the top step (job 155): undo.js planHistory decides per
	 * part against the visible state what goes out. The safety net (M2, R20)
	 * comes first: an op on an item that is locked in the model (lock
	 * patches excepted: undoing the own lock unlocks, redo locks again) is
	 * skipped, and the toast lock-undo names how many items; then the toast
	 * undo-changed names the items skipped because someone else changed
	 * them. The step moves to the other stack trimmed to what went out, or
	 * vanishes when nothing did.
	 *
	 * @param {'undo'|'redo'} dir direction
	 */
	sendHistory(dir) {
		if (!this.sync) {
			return
		}
		let r = null
		const cut = (step) => {
			r = this.historyPlan(step, dir)
			return r.plan.step
		}
		if (dir === 'undo') {
			this.undoStack.undo(cut)
		} else {
			this.undoStack.redo(cut)
		}
		if (r === null) {
			return
		}
		this.historySend(dir, r)
		this.emitUndo()
	}

	/**
	 * The ops of a step against the visible state (planHistory), after the safety net.
	 *
	 * @param {{ops: object[], inverse: object[]}} step the step (fresh copies)
	 * @param {'undo'|'redo'} dir direction
	 * @return {{plan: object, held: Set<string>}} planHistory's answer and the items the safety net holds
	 */
	historyPlan(step, dir) {
		const held = new Set((dir === 'undo' ? step.inverse : step.ops).filter((op) => this.heldByLock(op)).map((op) => op.id))
		return { held, plan: planHistory(step, dir, { visible: (id) => this.replica.visible(id), held, measure: (item) => this.measure(item) }) }
	}

	/**
	 * The toasts of an undo or redo and its ops out (sendHistory).
	 *
	 * @param {'undo'|'redo'} dir direction
	 * @param {{plan: object, held: Set<string>}} r historyPlan's answer
	 */
	historySend(dir, { plan, held }) {
		if (held.size > 0) {
			this.info(n('knorke', '%n locked item was skipped.', '%n locked items were skipped.', held.size), { hook: 'lock-undo' })
		}
		if (plan.changed.length > 0) {
			this.info(n('knorke', '%n item was skipped because someone else changed it.', '%n items were skipped because someone else changed them.', plan.changed.length), { hook: 'undo-changed' })
		}
		// A redone create hits a tombstone: it must revive (job 167: also the put
		// of the state right before the undo, undo.js planHistory). The undo of
		// a redone delete carries its revive in the put itself (job 176).
		const sent = dir === 'redo' ? plan.send.map((op) => (op.o === 'put' ? { ...op, revive: true } : op)) : plan.send
		// job 173: a table's w/h are written again after its undo or redo
		const ops = sent.length > 0 ? this.withTableSizes(sent) : sent
		if (ops.length > 0) {
			// job 189: threads on items an undo or redo removes keep their last corner
			this.commentsOnRemove(ops)
			const ids = this.sync.enqueue(ops, { urgent: true })
			for (const id of ids) {
				this.undoPending.add(id)
			}
			this.flushVisible(ids)
			const rest = this.selection.filter((id) => this.model?.has(id))
			if (rest.length !== this.selection.length) {
				this.selection = rest
				this.scene?.setSelection(rest)
				this.emitSelection()
			}
		}
	}

	/**
	 * Job 206: undo and redo run one after another. A step with a tag part
	 * writes the tag route (sendTagHistory) and waits for its answer; every
	 * undo or redo pressed meanwhile waits in historyQueue and runs after it.
	 * Without a tag step waiting or running, the plain step goes out at once.
	 *
	 * @param {'undo'|'redo'} dir direction
	 * @return {Promise<void>|undefined} the queue when it waits
	 */
	history(dir) {
		const run = () => {
			if (this.destroyed || this.viewOnly || this.frozen) {
				return undefined
			}
			if (this.undoStack.peek(dir)?.tag) {
				return this.sendTagHistory(dir)
			}
			this.guard(() => this.sendHistory(dir))
			return undefined
		}
		if (this.historyQueue === null && !this.undoStack.peek(dir)?.tag) {
			run()
			return undefined
		}
		const next = (this.historyQueue ?? Promise.resolve()).then(run).catch((e) => this.actionFailed(e))
		this.historyQueue = next
		next.then(() => {
			if (this.historyQueue === next) {
				this.historyQueue = null
			}
		})
		return next
	}

	undo() {
		if (this.viewOnly || this.frozen) {
			return
		}
		this.endSortLabels()
		return this.history('undo')
	}

	redo() {
		if (this.viewOnly || this.frozen) {
			return
		}
		this.endSortLabels()
		return this.history('redo')
	}

	/**
	 * @param {string} tool a tool id of TOOLS (select, hand, sticky, shape, text, frame, connector); (job 188)
	 *   another tool than the scene's puts the note tool's type back to 'sticky'
	 */
	setTool(tool) {
		const back = tool !== this.scene?.getTool?.() && this.noteBack()
		this.useTool(tool)
		if (back) {
			this.emitToolOptions()
		}
	}

	/**
	 * @param {string} tool a tool id of TOOLS, given to the scene with its stored options
	 */
	useTool(tool) {
		this.endSortLabels()
		const opts = this.toolOptions[tool] ?? null
		this.scene?.setTool(tool, opts ? { ...opts } : null)
		this.ui.onTool?.(this.scene?.getTool?.() ?? tool)
	}

	/**
	 * (Job 188) The note tool's type goes back to 'sticky' ("Note"); (job 199) the frame tool's frameKind to 'frame'.
	 *
	 * @return {boolean} it was 'pad' (or 'lanes')
	 */
	noteBack() {
		// job 199: the frame tool's frameKind too
		const frame = this.toolOptions.frame?.frameKind === 'lanes'
		if (frame) {
			this.toolOptions.frame = { ...this.toolOptions.frame, frameKind: 'frame' }
		}
		if (this.toolOptions.sticky?.type !== 'pad') {
			return frame
		}
		this.toolOptions.sticky = { ...this.toolOptions.sticky, type: 'sticky' }
		return true
	}

	/**
	 * Tool options (SPEC-M1 §6.5.1): e.g. setToolOptions('shape', {kind:
	 * 'ellipse'}) chooses the shape kind and activates the tool.
	 *
	 * @param {string} tool tool id
	 * @param {object} opts options (merged into the known ones)
	 */
	setToolOptions(tool, opts) {
		if (typeof tool !== 'string' || !opts || typeof opts !== 'object') {
			return
		}
		// (job 188) another tool than the scene's puts the note tool's type back first; opts come after that
		if (tool !== this.scene?.getTool?.()) {
			this.noteBack()
		}
		this.toolOptions[tool] = { ...(this.toolOptions[tool] ?? {}), ...opts }
		// (job 203) another kind drops the picture of an own shape
		if (tool === 'shape' && this.toolOptions.shape.kind !== 'image') delete this.toolOptions.shape.picture
		this.useTool(tool)
		this.emitToolOptions()
	}

	/**
	 * @param {string} tool tool id
	 * @return {object} the options of the tool (the scene's when it has none stored here)
	 */
	getToolOptions(tool) {
		const own = this.toolOptions[tool]
		if (own) {
			return { ...own }
		}
		try {
			const o = this.scene?.getToolOptions?.(tool)
			return o && typeof o === 'object' ? { ...o } : {}
		} catch (e) {
			return {}
		}
	}

	emitToolOptions() {
		// job 188: sticky, the note tool's type
		this.ui.onToolOptions?.({
			shape: this.getToolOptions('shape'), connector: this.getToolOptions('connector'), sticky: this.getToolOptions('sticky'),
			// job 199: frame, the frame tool's frameKind
			frame: this.getToolOptions('frame'),
			// job 273: pen, the pen tool's kind and the colour and width of each kind
			pen: this.getToolOptions('pen'),
		})
	}

	/** @param {string} color #rrggbb for the selection (M0; v2: setStyle) */
	setFill(color) {
		this.setStyle('style.fill', color)
	}

	/**
	 * One field of the selection from the context bar (SPEC-M1 §6.5.1): only
	 * on types with that field; text items get the height of the new state.
	 *
	 * @param {string} path field path (style.fill, style.fontSize, data.kind …)
	 * @param {unknown} value new value (null = back to the default)
	 * @param {{mergeKey?: string|null}} [o] undo merging (e.g. a slider)
	 */
	setStyle(path, value, { mergeKey = null } = {}) {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => {
			const heights = new Map()
			// M2 (R20): only the unlocked items of the selection
			const ids = this.unlockedOf(this.selection)
			if (path === 'style.fontSize') {
				for (const id of ids) {
					const it = this.knownItem(id)
					if (it?.t === 'text') {
						const size = typeof value === 'number' ? value : fieldDefault('text', 'style.fontSize')
						const h = this.measure(actions.measureTarget(it, { fontSize: size }))
						if (h !== null) {
							heights.set(id, h)
						}
					}
				}
			}
			const r = actions.setStyle(this.model, ids, path, value, { heights })
			// job 173: the header row of a table is bold: its size follows (withSize); job 265: the header column too
			r.ops.forEach((op, k) => {
				const it = op.o === 'patch' ? this.knownItem(op.id) : null
				if (it?.t === 'table' && (path === 'style.header' || path === 'style.headerCol')) {
					withSize(it, { p: op.p, inv: r.inverse[k].p }, this.cellMeasure())
				}
			})
			this.commit(r, { urgent: true, mergeKey })
			this.emitSelection()
		})
	}

	/** @param {string} kind shape kind for the selected shapes */
	setShapeKind(kind) {
		this.setStyle('data.kind', kind)
	}

	/**
	 * (job 153) "Swap direction" (context bar panel "Tips", menu entry
	 * swap-direction): the two tips of every unlocked selected connector
	 * whose tips differ change places (actions.swapCaps), one undo step;
	 * locked ones and equal tips stay without a message, like setStyle.
	 */
	swapDirection() {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => {
			this.commit(actions.swapCaps(this.model, this.unlockedOf(this.selection)), { urgent: true })
			this.emitSelection()
		})
	}

	/**
	 * (Job 204) "Sequence flow" / "Message flow" (context bar panel "Tips"):
	 * line and tips of every unlocked selected connector (actions.setFlow),
	 * one undo step; nothing to change sends nothing.
	 *
	 * @param {string} flow sequence | message
	 */
	setFlow(flow) {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => {
			this.commit(actions.setFlow(this.model, this.unlockedOf(this.selection), flow), { urgent: true })
			this.emitSelection()
		})
	}

	/**
	 * "Arrange" (X, Y, W, H, angle, WCAG 2.5.7) for the one selected item.
	 * Job 146 (R22): x and y beyond ±NUM_ABS_MAX are clamped (actions.arrangeItem;
	 * job 160: also the stored value of a frame's child, relative to its frame);
	 * the selection is reported exactly once afterwards, also when nothing was
	 * sent, so the fields show the real position again; the patch sent is kept
	 * as arrangeSent (handleFailed: a `bad` answer to it toasts arrange-bad).
	 * Job 240: square ticks or unticks "1:1" of a shape in the same patch.
	 *
	 * @param {{x?: number, y?: number, w?: number, h?: number, r?: number, square?: boolean}} box target (absolute)
	 */
	arrange(box) {
		if (this.viewOnly || this.frozen || !this.model || this.selection.length !== 1) {
			return
		}
		const id = this.selection[0]
		if (this.unlockedOf([id]).length === 0) {
			return
		}
		this.guard(() => {
			const it = this.knownItem(id)
			let textH
			if (it?.t === 'text') {
				const w = typeof box?.w === 'number' && Number.isFinite(box.w) && box.w > 0 ? box.w : it.w
				textH = this.measure(actions.measureTarget(it, { w })) ?? undefined
			}
			const r = actions.arrangeItem(this.model, id, box ?? {}, { textH })
			const op = r.ops.find((o) => o.o === 'patch' && o.id === id)
			if (op && this.sync) {
				// the Replica copies ops and merges later ops of one item into them: kept by value
				this.arrangeSent = { id, p: { ...op.p } }
			}
			this.commitReported(r)
		})
	}

	/**
	 * Arrow-key move of the selection from the shell (one undo step per series).
	 *
	 * @param {number} dx world units
	 * @param {number} dy world units
	 */
	nudge(dx, dy) {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => {
			const sel = new Set(this.selection.filter((id) => this.model.has(id)))
			// the top-level selected items that may move: no locked item (M2, R20), no member of a group with a locked member
			const top = movableIds(this.model, [...sel].filter((id) => {
				const p = this.model.get(id).parent ?? null
				return p === null || !sel.has(p)
			}))
			const origin = new Map()
			for (const id of top) {
				const it = this.model.get(id)
				origin.set(id, { x: it.x, y: it.y, parent: it.parent ?? null })
			}
			this.commit(actions.moveItems(this.model, { ids: top, dx, dy, origin }), { urgent: true, mergeKey: this.nudgeKey(top) })
		})
	}

	/**
	 * "Connect" (SPEC-M1 §6.5.1, §6.12, WCAG 2.5.7: connecting without
	 * dragging): exactly two bindable items selected → a connector from the
	 * first to the second (selection order), both ends 'auto' (the side is
	 * chosen when routing), route and end cap from the connector tool
	 * options. The new connector is selected (one undo step).
	 *
	 * @return {string|null} new connector id, null when the selection cannot be connected
	 */
	connectSelection() {
		if (this.viewOnly || this.frozen || !this.model || !this.selectionInfo().canConnect) {
			return null
		}
		let id = null
		this.guard(() => {
			const [a, b] = this.selection.filter((x) => this.model.has(x))
			const o = this.getToolOptions('connector')
			id = this.connectNow({ start: { item: a }, end: { item: b }, route: o.route, endCap: o.endCap })
		})
		return id
	}

	/**
	 * Context bar "Label" (keyboard and pointer way to the label editor of
	 * the one selected connector; double click and Enter reach it in the
	 * scene): opens the scene's label editor.
	 *
	 * @return {boolean} the editor opens
	 */
	editLabel() {
		return this.editOneText('data.label')
	}

	/**
	 * (job 143) Context bar "Rename" (the one selected, unlocked frame; like
	 * Enter on the canvas): opens the scene's title editor, which takes the
	 * focus.
	 *
	 * @return {boolean} the editor opens
	 */
	renameFrame() {
		return this.editOneText('data.title')
	}

	/**
	 * @param {string} path text path the one selected item must have (data.label, data.title)
	 * @return {boolean} the scene's editor opens for it (not on a locked item, never view-only or frozen)
	 */
	editOneText(path) {
		if (this.viewOnly || this.frozen || !this.scene || this.selection.length !== 1) {
			return false
		}
		const id = this.selection[0]
		if (!this.model?.has(id) || textPathOf(this.model.get(id).t) !== path || isLocked(this.model.get(id))) {
			return false
		}
		try {
			return this.scene.openTextEditor(id) !== false
		} catch (e) {
			this.actionFailed(e)
			return false
		}
	}

	/** Context bar: copy the selection. */
	copy() {
		this.guard(() => this.copyNow(false))
	}

	/** Context bar: cut the selection (copy + delete, one undo step). */
	cut() {
		this.guard(() => this.copyNow(true))
	}

	/** Context bar: duplicate the selection (+20/+20). */
	duplicate() {
		this.guard(() => this.duplicateNow())
	}

	/**
	 * Lock (M2, SPEC-M1 §1.2 "(R20) Sperren"; context bar, context menu,
	 * toggleLock): every unlocked selected item, one undo step; the
	 * selection stays.
	 *
	 * @return {boolean} lock ops went out
	 */
	lockSelection() {
		return this.lockStep((ids) => actions.lockItems(this.model, ids, this.me)) > 0
	}

	/**
	 * Unlock (M2, R20): every selected item me may unlock (own lock, or any
	 * lock for owner and moderators), one undo step; the selection stays.
	 *
	 * @return {boolean} unlock ops went out
	 */
	unlockSelection() {
		return this.lockStep((ids) => actions.unlockItems(this.model, ids, this.me)) > 0
	}

	/**
	 * One lock step (lock, unlock, the mass unlocks): the ops of `make` on
	 * the items, one undo step (the sync layer splits the queue into batches
	 * of MAX_OPS), the selection stays and is reported again.
	 *
	 * @param {(ids: string[]) => {ops: object[], inverse: object[]}} make lockItems or unlockItems
	 * @param {(() => string[])|null} [idsOf] the items, computed now (a mass unlock); default: the
	 *   selected items in the model
	 * @return {number|null} the ops that went out (0: nothing to do); null when the session may not
	 *   write or the step failed (guard toasted actionFailed)
	 */
	lockStep(make, idsOf = null) {
		if (this.viewOnly || this.frozen || !this.model || !this.me) {
			return null
		}
		let sent = null
		this.guard(() => {
			const r = make(idsOf ? idsOf() : this.selection.filter((id) => this.model.has(id)))
			if (r.ops.length === 0) {
				sent = 0
				return
			}
			this.commit(r, { urgent: true })
			sent = r.ops.length
			this.emitSelection()
		})
		return sent
	}

	/**
	 * Ctrl/⌘+Shift+L (intent toggleLock, M2 R20): lock when something
	 * selected can be locked, else unlock what me may unlock, else (only
	 * foreign locks, no moderation) the toast lock-unlock.
	 */
	toggleLock() {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		const sel = this.selectionInfo()
		if (sel.lockable > 0) {
			this.lockSelection()
		} else if (sel.unlockable > 0) {
			this.unlockSelection()
		} else if (sel.locked > 0) {
			this.info(t('knorke', 'Only the person who locked it or a facilitator can unlock it.'), { hook: 'lock-unlock' })
		}
	}

	/**
	 * @return {boolean} me moderates (owner, "can moderate") and the session may write: the mass unlocks apply (job 044)
	 */
	mayUnlockMany() {
		return !this.viewOnly && !this.frozen && !!this.model && !!this.me && this.me.mod === true
	}

	/**
	 * @return {string[]} every item of the board me may unlock (any locked item, also connectors and
	 *   frames), in model order; [] unless mayUnlockMany()
	 */
	unlockAllIds() {
		if (!this.mayUnlockMany()) {
			return []
		}
		const out = []
		for (const id of this.model.ids()) {
			if (mayUnlock(this.model.get(id), this.me)) {
				out.push(id)
			}
		}
		return out
	}

	/**
	 * @param {unknown} id a frame
	 * @return {string[]} the frame and its descendants in the parent tree that me may unlock; [] for an
	 *   id that is no frame of the model, and unless mayUnlockMany()
	 */
	unlockFrameIds(id) {
		if (!this.mayUnlockMany() || typeof id !== 'string' || !this.model.has(id) || this.model.get(id).t !== 'frame') {
			return []
		}
		return [id, ...this.model.descendantsOf(id)].filter((x) => mayUnlock(this.model.get(x), this.me))
	}

	/**
	 * @param {unknown} pid a locker's pid
	 * @return {string[]} every item of the board locked by that person that me may unlock (any type, also
	 *   frames and connectors), in model order, a subset of unlockAllIds(); [] for no pid, for me's own
	 *   pid (only the acting person's own locks stay, job 062; when that person moderates too, their
	 *   locks go as well) and unless mayUnlockMany()
	 */
	unlockByIds(pid) {
		if (!this.mayUnlockMany() || typeof pid !== 'string' || pid === '' || pid === this.me.pid) {
			return []
		}
		return this.unlockAllIds().filter((id) => this.model.get(id).lock.by === pid)
	}

	/**
	 * "Unlock all" (board menu, moderators only, job 044): every lock of the
	 * board, one undo step, the toast unlock-all (unlock-none when nothing is
	 * left to unlock).
	 *
	 * @return {boolean} unlock ops went out
	 */
	unlockAll() {
		return this.unlockMass(() => this.unlockAllIds())
	}

	/**
	 * "Unlock all in this frame" (moderators only, job 044; the menu of a
	 * frame, and the board menu inside a frame, job 062): the frame and every
	 * locked item inside it, one undo step, the toast unlock-all (unlock-none
	 * when nothing is left to unlock).
	 *
	 * @param {string} id the frame (the menu's target, or the frame under the board menu's point)
	 * @return {boolean} unlock ops went out
	 */
	unlockFrame(id) {
		return this.unlockMass(() => this.unlockFrameIds(id))
	}

	/**
	 * "Unlock all locked by {name}" (menu of an item someone else locked,
	 * moderators only, job 062): every lock of that person, one undo step,
	 * the toast unlock-all (unlock-none when nothing is left to unlock); the
	 * locks of others, the moderation's own among them, stay.
	 *
	 * @param {string|null} pid the locker (named in the menu when it opened; null when the menu named none)
	 * @return {boolean} unlock ops went out
	 */
	unlockBy(pid) {
		return this.unlockMass(() => this.unlockByIds(pid))
	}

	/**
	 * The toast of a mass unlock: unlock-all with the number of unlocked
	 * items, or unlock-none when a moderator's set was empty by the call (no
	 * toast without the right, in mode view, while frozen or after an error).
	 *
	 * @param {() => string[]} idsOf the items to unlock, computed now (not the menu's count)
	 * @return {boolean} ops went out
	 */
	unlockMass(idsOf) {
		const k = this.lockStep((ids) => actions.unlockItems(this.model, ids, this.me), idsOf)
		if (k > 0) {
			this.info(n('knorke', '%n item unlocked', '%n items unlocked', k), { hook: 'unlock-all' })
			return true
		}
		if (k === 0 && this.mayUnlockMany()) {
			this.info(t('knorke', 'Nothing left to unlock.'), { hook: 'unlock-none' })
		}
		return false
	}

	/**
	 * "Group items" (M2, SPEC-M1 §1.2 "(R20) Gruppieren"; context bar,
	 * context menu, intent group = Ctrl/⌘+G): actions.groupItems on the
	 * selection, one undo step; then the selection is the old one plus the
	 * items of the new group, the current item last. Blocked: the toast
	 * group-blocked with the reason, nothing sent.
	 *
	 * @return {'sent'|'blocked'|'none'} ops went out, a reason was shown, or nothing happened
	 */
	groupSelection() {
		if (this.viewOnly || this.frozen || !this.model) {
			return 'none'
		}
		let out = 'none'
		this.guard(() => {
			const sel = this.selection.filter((id) => this.model.has(id))
			const r = actions.groupItems(this.model, sel)
			if (r.blocked !== null) {
				this.groupBlocked(r.blocked)
				out = 'blocked'
				return
			}
			if (r.ops.length === 0) {
				return
			}
			this.commit(r, { urgent: true })
			const have = new Set(sel)
			this.select([...r.ids.filter((id) => !have.has(id)), ...sel])
			out = 'sent'
		})
		return out
	}

	/**
	 * "Ungroup" (M2, R20; context bar, context menu, intent ungroup =
	 * Ctrl/⌘+Shift+G): actions.ungroupItems on the selection, one undo step;
	 * the selection stays. Blocked (a locked member): the toast group-blocked.
	 *
	 * @return {'sent'|'blocked'|'none'} ops went out, a reason was shown, or nothing happened
	 */
	ungroupSelection() {
		if (this.viewOnly || this.frozen || !this.model) {
			return 'none'
		}
		let out = 'none'
		this.guard(() => {
			const r = actions.ungroupItems(this.model, this.selection.filter((id) => this.model.has(id)))
			if (r.blocked !== null) {
				this.groupBlocked(r.blocked)
				out = 'blocked'
				return
			}
			if (r.ops.length === 0) {
				return
			}
			this.commit(r, { urgent: true })
			this.emitSelection()
			out = 'sent'
		})
		return out
	}

	/**
	 * Toast [data-knorke-toast=group-blocked]: why "Group items" or "Ungroup"
	 * does nothing (the same fixed text as the bar's and the menu's title).
	 *
	 * @param {string} reason 'frame', 'locked' or 'parent'
	 */
	groupBlocked(reason) {
		const text = groupHintText(reason)
		if (text !== null) {
			this.info(text, { hook: 'group-blocked' })
		}
	}

	/**
	 * (Job 278) "Frame around" (the bar's "…" and the context menu, no key):
	 * actions.frameAround on the selection, ONE undo step with the title
	 * typed next (mergeKey new:<id>, as createNow for a frame drawn by hand);
	 * the new frame is selected alone, its title band comes into view and
	 * its title editor opens. Blocked: the toast frame-blocked with the
	 * reason (contextbar.js frameHintText), nothing sent.
	 *
	 * @return {'sent'|'blocked'|'none'} ops went out, a reason was shown, or nothing happened
	 */
	frameAroundSelection() {
		if (this.viewOnly || this.frozen || !this.model) {
			return 'none'
		}
		let out = 'none'
		let made = null
		this.guard(() => {
			const r = actions.frameAround(this.model, this.selection.filter((id) => this.model.has(id)))
			if (r.blocked !== null) {
				const text = frameHintText(r.blocked)
				if (text !== null) {
					this.info(text, { hook: 'frame-blocked' })
				}
				out = 'blocked'
				return
			}
			if (r.ops.length === 0) {
				return
			}
			made = r.selectIds[0]
			this.commit(r, { urgent: true, mergeKey: 'new:' + made })
			this.select(r.selectIds)
			out = 'sent'
		})
		if (made !== null && this.model.has(made)) {
			this.scene.revealTitle?.(made, this.viewTop(), this.viewBottom())
			// set after openTextEditor, like createNow: a closing editor must not take this frame for its own
			this.scene.openTextEditor(made)
			this.newEdit = { id: made, key: 'new:' + made }
		}
		return out
	}

	/**
	 * After a pointer click on a bar button (SPEC-M1 §6.5.1, R2): single keys
	 * work at once again.
	 */
	focusCanvas() {
		try {
			this.scene?.focusCanvas?.()
		} catch (e) {
			// the canvas is gone
		}
	}

	/**
	 * Opening a board (SPEC-M1 §6.5.1, R9): the canvas takes the focus when
	 * nothing else has it (document.activeElement is body or null), so single
	 * keys work at once as in M0. An element the user (or a test) focused
	 * while the snapshot was loading keeps the focus. Without a document
	 * (no DOM) there is nothing to decide.
	 */
	focusCanvasOnOpen() {
		const doc = this.win?.document ?? null
		if (!doc) {
			return
		}
		const active = doc.activeElement
		if (active === null || active === undefined || active === doc.body) {
			this.focusCanvas()
		}
	}

	/**
	 * Copy or cut (§6.5.3), synchronously inside the user's gesture. Nothing
	 * when an editor is open, an input field has the focus or the page has a
	 * DOM text selection (the browser copies that).
	 *
	 * @param {boolean} cut delete the selection afterwards
	 * @return {boolean} something was copied
	 */
	copyNow(cut) {
		if (this.viewOnly || this.frozen || !this.model || this.editingId !== null) {
			return false
		}
		if (hasDomSelection(this.win) || inputFocused(this.win?.document ?? null)) {
			return false
		}
		const ids = this.selection.filter((id) => this.model.has(id))
		if (ids.length === 0) {
			return false
		}
		// cut copies and deletes only the unlocked items (M2, R20); copy takes all
		const take = cut ? this.unlockedOf(ids) : ids
		if (take.length === 0) {
			this.deleteNow(ids)
			return false
		}
		const payload = actions.copyPayload(this.model, take, { board: this.boardId, tags: this.boardTags() })
		const clip = encodeClip(payload)
		writeClipboard(clip, { doc: this.win?.document ?? null, ...(this.deps.clipboardIo ?? {}) })
		storeClip(this.storage, { text: clip.text, payload }, this.wall())
		this.info(n('knorke', '%n item copied', '%n items copied', payload.items.length))
		if (cut) {
			this.deleteNow(ids)
		}
		return true
	}

	duplicateNow() {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		const ids = this.unlockedOf(this.selection)
		if (ids.length === 0) {
			return
		}
		const r = actions.duplicateItems(this.model, ids, { offset: PASTE_STEP, limits: this.limits, board: this.boardId, tags: this.boardTags() })
		this.finishPaste(r, 0)
	}

	/**
	 * Ctrl/⌘(+Shift)+V (SPEC-M1 §6.3, §6.5.3): synchronously in the keydown,
	 * the paste catcher gets the focus, so the following DOM paste event lands
	 * on an editable element (WebKit fires none on a focused div). When no
	 * paste event comes, the focus goes back to the canvas.
	 *
	 * @param {boolean} inPlace Shift: paste at the original coordinates
	 */
	onPasteKey(inPlace) {
		if (this.viewOnly || this.frozen || !this.model || !this.pasteCatcher) {
			return
		}
		this.pasteIntent = { inPlace }
		try {
			this.pasteCatcher.value = ''
			this.pasteCatcher.focus({ preventScroll: true })
		} catch (e) {
			return
		}
		if (this.catcherTimer !== null) {
			clearTimeout(this.catcherTimer)
		}
		this.catcherTimer = setTimeout(() => {
			this.catcherTimer = null
			this.pasteIntent = null
			if (!this.destroyed && this.win?.document?.activeElement === this.pasteCatcher) {
				this.focusCanvas()
			}
		}, CATCHER_MS)
	}

	/**
	 * The DOM paste event at the catcher (§6.5.3).
	 *
	 * @param {{html: string, text: string, files: number}} data clipboard formats
	 */
	onCatcherPaste(data) {
		if (this.catcherTimer !== null) {
			clearTimeout(this.catcherTimer)
			this.catcherTimer = null
		}
		const intent = this.pasteIntent ?? { inPlace: false }
		this.pasteIntent = null
		this.focusCanvas()
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => this.pasteData(data, intent))
	}

	/**
	 * Evaluates the clipboard (§6.5.3): [data-knorke-clip] → checked payload;
	 * otherwise the stored copy when its text matches; otherwise plain text
	 * → notes (asking above NOTES_ASK); files alone → "Images can't be pasted
	 * yet.".
	 *
	 * @param {{html?: string, text?: string, files?: number}} data clipboard formats
	 * @param {{inPlace: boolean}} intent paste intent
	 */
	pasteData(data, intent) {
		const text = typeof data?.text === 'string' ? data.text : ''
		const attr = clipAttrOf(data?.html ?? '', this.deps.parseHtml ?? null)
		if (attr !== null) {
			const v = validatePayload(decodeClipAttr(attr))
			if (!v.ok) {
				this.toast(n('knorke', '%n item could not be pasted.', '%n items could not be pasted.', Math.max(1, v.count)))
				return
			}
			this.pastePayload(v.payload, v.skipped, intent)
			return
		}
		if (text.trim() === '' && (data?.files ?? 0) > 0) {
			// an image (or another file) without text: never an older copy
			this.info(t('knorke', 'Images can\'t be pasted yet.'))
			return
		}
		// R19 T4-03: "Paste here" never falls back to the stored copy without text from the clipboard
		const stored = intent?.menu === true && text.trim() === '' ? null : readStoredClip(this.storage, text, this.wall())
		if (stored !== null) {
			const v = validatePayload(stored)
			if (v.ok) {
				this.pastePayload(v.payload, v.skipped, intent)
				return
			}
		}
		if (text.trim() === '') {
			return
		}
		this.pasteText(text, intent?.at ?? null, typeof data?.html === 'string' ? data.html : '')
	}

	/**
	 * @param {object} payload checked payload
	 * @param {number} skipped items already skipped by the check
	 * @param {{inPlace: boolean}} intent paste intent
	 */
	pastePayload(payload, skipped, intent) {
		const place = this.pastePlacement(payload, intent)
		// job 191: the payload's tags first (one add for the missing ones), then the notes
		this.withPasteTags(payload, (tagMap) => {
			if (this.viewOnly || this.frozen || !this.model) {
				return false
			}
			const r = actions.pasteItems(this.model, payload, { ...place, limits: this.limits, board: this.boardId, tagMap })
			this.finishPaste(r, skipped)
			return true
		})
	}

	/**
	 * @param {{ops: object[], selectIds: string[], skipped: number, full: boolean}} r paste result
	 * @param {number} skipped items skipped before
	 */
	finishPaste(r, skipped) {
		if (r.full) {
			this.toast(t('knorke', 'This board is full.'))
			return
		}
		if (r.ops.length > 0) {
			this.commit(r, { urgent: true })
			this.select(r.selectIds)
		}
		const lost = skipped + (r.skipped ?? 0)
		if (lost > 0) {
			this.toast(n('knorke', '%n item could not be pasted.', '%n items could not be pasted.', lost))
		}
	}

	/**
	 * Where a payload goes (§6.5.3): in place → original coordinates; same
	 * board with the originals visible → +20/+20 (again +20 for every repeat
	 * of the same copy); pointer on the canvas → box center at the pointer;
	 * otherwise the viewport center.
	 *
	 * @param {object} payload checked payload
	 * @param {{inPlace: boolean}} intent paste intent
	 * @return {object} placement options of actions.pasteItems
	 */
	pastePlacement(payload, intent) {
		if (intent?.inPlace) {
			this.lastPaste = null
			return { inPlace: true }
		}
		if (intent?.at && Number.isFinite(intent.at.x) && Number.isFinite(intent.at.y)) {
			// "Paste here" (R19 T4-03): box center at the menu's world point, never +20/+20
			this.lastPaste = null
			return { at: { x: intent.at.x, y: intent.at.y } }
		}
		const ids = payload.items.map((it) => it.id)
		if (payload.board === this.boardId && this.originalsVisible(ids)) {
			const sig = this.boardId + ':' + ids.join(',')
			const k = this.lastPaste?.sig === sig ? this.lastPaste.k + 1 : 1
			this.lastPaste = { sig, k }
			return { offset: { x: PASTE_STEP * k, y: PASTE_STEP * k } }
		}
		this.lastPaste = null
		if (Array.isArray(this.pointer)) {
			return { at: { x: this.pointer[0], y: this.pointer[1] } }
		}
		return { at: this.viewportCenter() }
	}

	/**
	 * @return {{x: number, y: number, w: number, h: number}|null} the visible world rectangle
	 */
	viewportWorld() {
		const el = this.container
		let w = 0
		let h = 0
		try {
			const r = el?.getBoundingClientRect?.()
			w = r?.width ?? el?.clientWidth ?? 0
			h = r?.height ?? el?.clientHeight ?? 0
		} catch (e) {
			return null
		}
		if (!this.scene || !(w > 0) || !(h > 0)) {
			return null
		}
		const a = this.scene.screenToWorld(0, 0)
		const b = this.scene.screenToWorld(w, h)
		return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
	}

	/** @return {{x: number, y: number}} center of the viewport in world coordinates */
	viewportCenter() {
		const v = this.viewportWorld()
		if (v) {
			return { x: v.x + v.w / 2, y: v.y + v.h / 2 }
		}
		const c = this.scene?.getCamera?.()
		return c ? { x: c.x, y: c.y } : { x: 0, y: 0 }
	}

	/**
	 * @param {string[]} ids ids of the payload
	 * @return {boolean} one of the originals still exists here and lies in the viewport
	 */
	originalsVisible(ids) {
		const v = this.viewportWorld()
		for (const id of ids) {
			if (!this.model.has(id)) {
				continue
			}
			if (!v) {
				return true
			}
			const a = this.model.abs(id)
			if (a && a.x <= v.x + v.w && a.x + a.w >= v.x && a.y <= v.y + v.h && a.y + a.h >= v.y) {
				return true
			}
		}
		return false
	}

	/**
	 * Plain text → notes at the pointer or the viewport center; above
	 * NOTES_ASK the user is asked first (ui.onConfirm → Promise<boolean>).
	 * (Job 195) An indented list (model/mindmap.js parseOutline) becomes one
	 * mind map instead (pasteOutline). (Job 218) Cells from a spreadsheet (an
	 * HTML table in text/html) are always notes, one per cell; at most
	 * actions.PASTE_NOTES_MAX notes, a message says when the rest was left out.
	 *
	 * @param {string} text plain text
	 * @param {{x: number, y: number}|null} [where] world point ("Paste here"); default pointer or viewport center
	 * @param {string} [html] text/html of the clipboard (only searched for a table)
	 */
	pasteText(text, where = null, html = '') {
		// job 195: an indented list becomes a mind map; job 218: never cells from a spreadsheet
		const outline = hasHtmlTable(html) ? null : parseOutline(text)
		if (outline !== null) {
			this.pasteOutline(outline, where)
			return
		}
		this.pasteNotes(text, {
			at: () => where ?? (Array.isArray(this.pointer) ? { x: this.pointer[0], y: this.pointer[1] } : this.viewportCenter()),
			html,
			may: () => !this.destroyed && !this.frozen && !this.viewOnly && !!this.model,
			ask: (count) => ({ name: t('knorke', 'Paste {n} notes?', { n: count }), confirmLabel: t('knorke', 'Paste') }),
			cut: () => this.toast(t('knorke', 'Only the first {n} notes were pasted.', { n: actions.PASTE_NOTES_MAX })),
		})
	}

	/**
	 * (Jobs 218, 220) Text → notes (actions.notesFromText): above NOTES_ASK
	 * notes (at most PASTE_NOTES_MAX) ui.onConfirm asks first; may() is checked
	 * again before the commit; cut() when the rest was left out.
	 *
	 * @param {string} text plain text
	 * @param {{at: () => {x: number, y: number}, html?: string, sep?: string, may: () => boolean,
	 *   ask: (n: number) => object, cut: () => void, empty?: () => void}} o the centre of the notes (at the commit),
	 *   text/html of the clipboard, a CSV file's separator, the condition, the question, the toasts
	 * @return {boolean|Promise<boolean>} notes were inserted (a promise when asked)
	 */
	pasteNotes(text, { at, html = '', sep = '', may, ask, cut, empty = () => {} }) {
		const count = actions.noteTexts(text, { html, sep, max: actions.PASTE_NOTES_MAX }).length
		if (count === 0) {
			empty()
			return false
		}
		const run = () => {
			if (!may()) {
				return false
			}
			const r = actions.notesFromText(this.model, text, { at: at(), limits: this.limits, html, sep })
			this.finishPaste({ ...r, skipped: 0 }, 0)
			if (r.cut === true) {
				cut()
			}
			return r.ops.length > 0
		}
		if (count <= NOTES_ASK) {
			let done = false
			this.guard(() => {
				done = run()
			})
			return done
		}
		const confirm = this.ui.onConfirm
		if (typeof confirm !== 'function') {
			return false
		}
		return Promise.resolve(confirm(ask(count)))
			.then((ok) => {
				let done = false
				if (ok === true) {
					this.guard(() => {
						done = run()
					})
				}
				return done
			})
			.catch(() => false)
	}

	/** @param {'front'|'back'} where direction */
	reorder(where) {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => this.commit(actions.reorder(this.model, this.unlockedOf(this.selection), where), { urgent: true }))
	}

	/**
	 * "Align" of the context bar (SPEC-M1 §1.2 M2): the alignable items of the
	 * selection to one edge or centre line of their union; one undo step (an
	 * empty result none), the selection stays.
	 *
	 * @param {string} edge one of actions.ALIGN_EDGES
	 */
	align(edge) {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => {
			this.commitReported(actions.alignItems(this.model, movableIds(this.model, this.selection), edge))
		})
	}

	/**
	 * "Distribute" of the context bar (SPEC-M1 §1.2 M2): the alignable items
	 * of the selection to equal gaps along one axis, the two outermost stay;
	 * one undo step (an empty result none), the selection stays.
	 *
	 * @param {string} axis one of actions.DISTRIBUTE_AXES
	 */
	distribute(axis) {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => {
			this.commitReported(actions.distributeItems(this.model, movableIds(this.model, this.selection), axis))
		})
	}

	/**
	 * "Tidy up" of the context bar (SPEC-M1 §1.2 M2): the alignable items of
	 * the selection onto an exact grid of their rows and columns, equal gaps,
	 * the top-left corner stays; one undo step (an empty result none), the
	 * selection stays.
	 */
	tidy() {
		if (this.viewOnly || this.frozen || !this.model) {
			return
		}
		this.guard(() => {
			this.commitReported(actions.tidyItems(this.model, movableIds(this.model, this.selection)))
		})
	}

	/**
	 * "Sort by color" (job 139; align panel, menu entry sort-colors): the
	 * loose notes of the selection in one block per colour.
	 *
	 * @return {boolean} sorted (the name fields are shown)
	 */
	sortByColor() {
		return this.sortNow(null)
	}

	/**
	 * "Sort notes by color" (job 139; bar and menu entry sort-frame): the
	 * notes in the one selected frame, which grows until they fit.
	 *
	 * @return {boolean} sorted (the name fields are shown)
	 */
	sortFrameByColor() {
		const id = this.selection.length === 1 ? this.selection[0] : null
		if (id === null || !this.model?.has(id) || this.model.get(id).t !== 'frame') {
			return false
		}
		return this.sortNow(id)
	}

	/**
	 * Factory job 267: "Summarise" of the context bar (sessionAi.js run).
	 *
	 * @return {Promise<boolean>} started
	 */
	aiSummarise() {
		return this.ai.run('summarise')
	}

	/**
	 * Factory job 267: "Cluster by topic" of the context bar.
	 *
	 * @return {Promise<boolean>} started
	 */
	aiCluster() {
		return this.ai.run('cluster')
	}

	/** Factory job 267: "Cancel" of the chip "AI is working…". */
	aiCancel() {
		return this.ai.cancel()
	}

	/** Factory job 268: "Create with AI" of the tool bar opens the window (sessionAi.js). @return {boolean} opened */
	aiDiagramOpen() {
		return this.ai.openDiagram()
	}

	/** @param {string} shape @param {string} prompt @return {Promise<boolean>} (job 268) "Create" / "Try again" */
	aiDiagramRun(shape, prompt) {
		return this.ai.runDiagram(shape, prompt)
	}

	/** @return {Promise<boolean>} (job 268) "Insert" of the window */
	aiDiagramInsert() {
		return this.ai.insertDiagram()
	}

	/** (Job 268) "Cancel" / Esc of the window. */
	aiDiagramClose() {
		this.ai.closeDiagram()
	}

	/**
	 * Factory job 268: the tree of an AI diagram as ONE mind map
	 * (actions.mindmapFromText, layout by shape), the middle of its hull on
	 * the middle of the view, selected, one undo step.
	 *
	 * (Job 269) The shape flowchart: insertAiFlow.
	 *
	 * @param {object} tree {text, children}; a flowchart's {nodes, edges}
	 * @param {string} shape mindmap | org | tree | flowchart
	 * @return {boolean|Promise<boolean>} inserted
	 */
	insertAiDiagram(tree, shape) {
		if (this.destroyed || this.frozen || this.viewOnly || !this.model) {
			return false
		}
		if (shape === 'flowchart' || shape === 'workshop') {
			return this.insertAiFlow(tree, shape)
		}
		const outline = actions.outlineOfTree(tree)
		if (!outline) {
			return false
		}
		const layout = shape === 'org' ? 'org' : shape === 'tree' ? 'tree' : 'both'
		const r = actions.mindmapFromText(this.model, outline, {
			at: this.viewportCenter(), limits: this.limits, measure: this.nodeMeasure(), maxBytes: this.maxItemBytes(), rand: this.rand, layout, centre: 'hull',
		})
		this.finishPaste({ ...r, skipped: 0 }, 0)
		return !r.full && r.ops.length > 0
	}

	/**
	 * Factory job 269: an AI flowchart as shapes and elbow connectors
	 * (board/aiFlow.js flowPayload, a lazy part), pasted like a board file:
	 * the middle of its hull on the middle of the view, one commit (one undo
	 * step), selected, the camera only when it is not wholly in view.
	 *
	 * (Job 276) shape workshop: the frames of a workshop (aiWorkshop.js).
	 *
	 * @param {object} flow {nodes, edges} (route 59); (job 276) a workshop's {parts}
	 * @param {string} [shape] flowchart | workshop
	 * @return {Promise<boolean>} inserted
	 */
	async insertAiFlow(flow, shape) {
		if (!this.files.mayInsertFile()) {
			return false
		}
		const m = await this.files.part('aiFlow')
		if (!m || this.destroyed || !this.files.mayInsertFile()) {
			return false
		}
		const payload = shape === 'workshop' ? m.workshopPayload(flow) : m.flowPayload(flow)
		if (!payload) {
			return false
		}
		const r = actions.pasteItems(this.model, payload, { at: this.viewportCenter(), limits: this.limits, board: null })
		this.finishPaste(r, 0)
		if (r.full || r.ops.length === 0) {
			return false
		}
		const hull = selectionFrame(this.model, r.selectIds)
		const v = this.viewportWorld()
		if (hull && v && !(hull.x >= v.x && hull.y >= v.y && hull.x + hull.w <= v.x + v.w && hull.y + hull.h <= v.y + v.h)) {
			this.zoomToRect(this.reserveTop({ x: hull.x, y: hull.y, w: hull.w, h: hull.h }, this.viewTop()))
		}
		return true
	}

	/**
	 * Job 139: open name fields end first (typed names saved), then
	 * actions.sortNotesByColor in one commit (one undo step; none when nothing
	 * moves), the selection empty, the new name fields shown. Nothing outside
	 * mode edit, while frozen, without a model or with fewer than two notes.
	 *
	 * @param {string|null} frame the frame whose notes are sorted, null: the loose notes of the selection
	 * @return {boolean} sorted
	 */
	sortNow(frame) {
		if (this.clientMode !== 'edit' || this.viewOnly || this.frozen || !this.model) {
			return false
		}
		let done = false
		this.guard(() => {
			this.endSortLabels()
			const r = actions.sortNotesByColor(this.model, this.selection, { frame })
			if (r.blocks.length === 0) {
				return
			}
			this.commit(r, { urgent: true })
			this.select([])
			this.sortLabels = { blocks: r.blocks.map((b) => ({ ...b })), open: new Set(r.blocks.map((_, i) => i)), texts: new Map() }
			this.emitSortLabels()
			done = true
		})
		return done
	}

	/** Job 139: reports the open name fields (ui.onSortLabels: [{i, color, x, y, w, h, parent}], world). */
	emitSortLabels() {
		const L = this.sortLabels
		this.ui.onSortLabels?.(L === null ? null : [...L.open].sort((a, b) => a - b).map((i) => ({ i, ...L.blocks[i] })))
	}

	/**
	 * Job 139: the screen places of the open name fields, from the camera the
	 * user sees now (the live camera of a gesture when the scene has one).
	 *
	 * @return {Array<{i: number, color: string, x: number, y: number, w: number}>} container px: the block's
	 *   top-left corner and its width
	 */
	sortLabelPlaces() {
		const L = this.sortLabels
		const sc = this.scene
		if (L === null || !sc) {
			return []
		}
		let c = null
		try {
			c = typeof sc.liveCamera === 'function' ? sc.liveCamera() : sc.getCamera?.()
		} catch (e) {
			c = null
		}
		if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !(c.scale > 0)) {
			return []
		}
		return [...L.open].sort((a, b) => a - b).map((i) => {
			const b = L.blocks[i]
			return { i, color: b.color, x: (b.x - c.x) * c.scale, y: (b.y - c.y) * c.scale, w: b.w * c.scale }
		})
	}

	/**
	 * Job 139: what is typed into the field of block i (saved by endSortLabels).
	 *
	 * @param {number} i block
	 * @param {string} text the field's value
	 */
	sortLabelText(i, text) {
		const L = this.sortLabels
		if (L !== null && L.open.has(i)) {
			L.texts.set(i, typeof text === 'string' ? text : '')
		}
	}

	/**
	 * Job 139: the field of block i is left with a name: a non-empty
	 * (trimmed) name becomes a text item above the block
	 * (actions.sortBlockName, an undo step of its own; the selection stays)
	 * and the field goes, the others stay (none left: the fields end).
	 * Nothing for an empty name, a field no longer shown, outside mode edit
	 * or while frozen.
	 *
	 * @param {number} i block
	 * @param {string} text the name
	 * @return {boolean} the text item was put
	 */
	nameSortBlock(i, text) {
		const L = this.sortLabels
		if (L === null || !L.open.has(i) || this.clientMode !== 'edit' || this.viewOnly || this.frozen || !this.model) {
			return false
		}
		const value = typeof text === 'string' ? text.trim() : ''
		if (value === '') {
			return false
		}
		let done = false
		this.guard(() => {
			const r = actions.sortBlockName(this.model, L.blocks[i], value, { measure: (it) => this.measure(it) })
			if (r.ops.length === 0) {
				return
			}
			L.open.delete(i)
			L.texts.delete(i)
			this.sortNaming = true
			try {
				this.commit(r, { urgent: true })
			} finally {
				this.sortNaming = false
			}
			done = true
		})
		if (done && this.sortLabels === L) {
			if (L.open.size === 0) {
				this.endSortLabels()
			} else {
				this.emitSortLabels()
			}
		}
		return done
	}

	/**
	 * Job 139: ends the name fields (ui.onSortLabels(null)); with save, every
	 * field with a typed name is saved first (nameSortBlock).
	 *
	 * @param {{save?: boolean}} [o] save the typed names (not when the board froze)
	 * @return {boolean} fields were open
	 */
	endSortLabels({ save = true } = {}) {
		const L = this.sortLabels
		if (L === null) {
			return false
		}
		if (save) {
			for (const i of [...L.open]) {
				const v = L.texts.get(i)
				if (typeof v === 'string' && v.trim() !== '') {
					this.nameSortBlock(i, v)
				}
			}
		}
		if (this.sortLabels === L) {
			this.sortLabels = null
			this.ui.onSortLabels?.(null)
		}
		return true
	}

	/**
	 * Job 139: a selection change ends the name fields (the same ids do not).
	 *
	 * @param {string[]} ids the new selection
	 */
	sortSelectionChange(ids) {
		if (this.sortLabels === null) {
			return
		}
		const next = Array.isArray(ids) ? ids : []
		if (next.length !== this.selection.length || next.some((id, k) => id !== this.selection[k])) {
			this.endSortLabels()
		}
	}

	deleteSelection() {
		this.deleteIds([...this.selection])
	}

	zoomIn() {
		this.scene?.zoomBy(1.25)
	}

	zoomOut() {
		this.scene?.zoomBy(0.8)
	}

	/** "Show everything": the whole board in the part the bars leave free (job 223, viewInsets), 48 px inside it like Shift+1. */
	zoomFit() {
		this.scene?.fit(undefined, 48, this.viewInsets())
	}

	// ---- M2: background grid (SPEC-M1 §1.2 (R12)) ----

	/**
	 * Stores the grid switch of this person (localStorage, every board):
	 * '1' when on, the key removed when off. The storage helpers never throw;
	 * a failed write leaves the scene switched anyway.
	 *
	 * @param {boolean} on grid on
	 */
	storeGrid(on) {
		if (on === true) {
			this.storage.setItem('local', keys.grid(), '1')
		} else {
			this.storage.removeItem('local', keys.grid())
		}
	}

	/**
	 * Switches the background grid (the board menu's "Show grid") in every
	 * mode, role and frozen state, and stores it. No op, no undo step, no
	 * toast, no poke; following goes on.
	 *
	 * @return {boolean} false without a scene
	 */
	toggleGrid() {
		if (!this.scene) {
			return false
		}
		const on = !(this.scene.getGrid() === true)
		this.scene.setGrid(on)
		this.storeGrid(on)
		return true
	}

	/**
	 * Stores the switch "Snap to grid" of this person (localStorage, every
	 * board): the key removed when on (the default), '0' when off. The storage
	 * helpers never throw; a failed write leaves the scene switched anyway.
	 *
	 * @param {boolean} on drags and resizes snap to the shown grid
	 */
	storeGridSnap(on) {
		if (on === true) {
			this.storage.removeItem('local', keys.gridSnap())
		} else {
			this.storage.setItem('local', keys.gridSnap(), '0')
		}
	}

	/**
	 * Switches the snapping to the shown grid (the board menu's "Snap to
	 * grid") in every mode, role and frozen state and whether the grid is
	 * shown or not, and stores it. The grid's visibility stays. No op, no undo
	 * step, no toast, no poke; following goes on.
	 *
	 * @return {boolean} false without a scene
	 */
	toggleGridSnap() {
		if (!this.scene) {
			return false
		}
		const on = !(this.scene.getGridSnap() === true)
		this.scene.setGridSnap(on)
		this.storeGridSnap(on)
		return true
	}

	// ---- factory job 147: other people's cursors ----

	/**
	 * The scene's sampler: the presence samples, and while the cursors are
	 * hidden each with cursor: null, except the person followed and the
	 * presenter of meta.summon (header).
	 *
	 * @param {number} nowMs current time
	 * @return {Array<object>} RemoteSample[]
	 */
	remoteSamples(nowMs) {
		const all = this.presence.sample(nowMs)
		if (this.cursors) {
			return all
		}
		const keep = [this.follower?.following?.pid, summonOf(this.board?.meta?.summon)?.pid]
		return all.map((s) => (keep.includes(s.pid) ? s : { ...s, cursor: null }))
	}

	/**
	 * Shows or hides other people's cursors in every mode, role and frozen
	 * state, stores it and confirms it with a toast (header).
	 *
	 * @return {boolean} false without a scene
	 */
	toggleCursors() {
		if (!this.scene) {
			return false
		}
		this.cursors = !this.cursors
		if (this.cursors) {
			this.storage.removeItem('local', keys.cursors())
		} else {
			this.storage.setItem('local', keys.cursors(), '0')
		}
		this.scene.presenceChanged()
		this.cursorsToast?.hideToast?.()
		const shortcutHint = shortcut('cursors', isApplePlatform(this.win?.navigator ?? null)).hint
		this.cursorsToast = this.info(this.cursors
			? t('knorke', 'Other people\'s cursors shown')
			: t('knorke', 'Other people\'s cursors hidden – {shortcut} shows them again', { shortcut: shortcutHint }), { hook: 'cursors' })
		return true
	}

	// ---- factory job 154: what the mouse wheel does ----

	/**
	 * The board menu's "Mouse wheel: …": the next stage Automatic → Zoom → Pan →
	 * Automatic in the scene, stored in localStorage knorke.wheel ('zoom', 'pan';
	 * Automatic removes the key; the storage helpers never throw, a failed write
	 * leaves the scene switched) and confirmed with the toast
	 * [data-knorke-toast=wheel], which hides the previous one first (header). No op,
	 * no undo step, no poke; following goes on.
	 *
	 * @return {boolean} false without a scene
	 */
	cycleWheel() {
		if (!this.scene) {
			return false
		}
		const next = WHEEL_STAGES[(Math.max(0, WHEEL_STAGES.indexOf(this.scene.getWheel())) + 1) % WHEEL_STAGES.length]
		this.scene.setWheel(next)
		if (next === 'auto') {
			this.storage.removeItem('local', keys.wheel())
		} else {
			this.storage.setItem('local', keys.wheel(), next)
		}
		this.wheelToast?.hideToast?.()
		const text = next === 'zoom'
			? t('knorke', 'Mouse wheel: zoom. Scrolling zooms, also on a trackpad.')
			: next === 'pan'
				? t('knorke', 'Mouse wheel: pan. {shortcut} + wheel zooms.', { shortcut: shortcut('hold-mod', isApplePlatform(this.win?.navigator ?? null)).hint })
				: t('knorke', 'Mouse wheel: automatic. A wheel zooms, a trackpad pans.')
		this.wheelToast = this.info(text, { hook: 'wheel' })
		return true
	}

	// ---- factory job 142: one-time tip about selecting with a finger ----

	/**
	 * The scene's onTouchPan: shows the tip once per browser (header). The key
	 * is stored as the tip appears, through the storage helpers that never
	 * throw; without storage the session's own flag keeps it to once.
	 *
	 * @return {boolean} true when the tip was shown now
	 */
	maybeTouchTip() {
		if (this.touchTipShown || this.frozen || this.destroyed || this.clientMode !== 'edit') {
			return false
		}
		if (this.storage.getItem('local', keys.touchTip()) === '1') {
			return false
		}
		this.touchTipShown = true
		this.storage.setItem('local', keys.touchTip(), '1')
		this.ui.onTouchTip?.(true)
		return true
	}

	/** The tip's OK: it goes; the stored key stays, so it never comes back in this browser. */
	dismissTouchTip() {
		this.ui.onTouchTip?.(false)
	}

	// ---- stage 4: context menu (SPEC-M1 §6.6 ContextMenu.vue, R19 T4-02/T4-03) ----

	/**
	 * Intent contextMenu (§6.3, step 4.2): opens the menu at `at` (container
	 * px) or moves an open one there. Only in mode edit; ignored elsewhere,
	 * while frozen and for an id the model does not hold. W = the world point
	 * of `at`, taken now (the camera may move while the menu is open); so are
	 * (job 062) the frame of "Unlock all in this frame" (menuFrame) and the
	 * locker of "Unlock all locked by {name}" (menuLocker).
	 *
	 * @param {{id: (string|null), at: number[]}} i intent
	 * @return {boolean} the menu is open
	 */
	openMenu(i) {
		if (this.clientMode !== 'edit' || this.viewOnly || this.frozen || !this.model || !this.scene) {
			return false
		}
		const at = Array.isArray(i?.at) && i.at.length === 2 && i.at.every((v) => Number.isFinite(v)) ? [i.at[0], i.at[1]] : null
		const id = typeof i?.id === 'string' ? i.id : null
		if (at === null || (id !== null && !this.model.has(id))) {
			return false
		}
		let world = null
		try {
			const w = this.scene.screenToWorld(at[0], at[1])
			world = w && Number.isFinite(w.x) && Number.isFinite(w.y) ? { x: w.x, y: w.y } : null
		} catch (e) {
			world = null
		}
		this.menuSeq++
		// job 173: the cell of a table under W (from the scene's intent); job 195: the node of a mind map (none: its root);
		// job 199: the lane of a frame
		const target = id !== null ? this.model.get(id) : null
		let cell = (target?.t === 'table' || target?.t === 'mindmap' || target?.t === 'frame') && typeof i.cell === 'string' && hasSub(target, i.cell) ? i.cell : null
		if (cell === null && target?.t === 'mindmap') cell = mindTree(target).root
		// job 208: and the column of a frame with columns
		const col = target?.t === 'frame' && typeof i.col === 'string' && COL_KEY_RE.test(i.col) && hasSub(target, i.col) ? i.col : null
		this.menu = { id, at, world, ids: [...this.selection], seq: this.menuSeq, frame: this.menuFrame(id, world), locker: this.menuLocker(id), cell, col }
		this.emitMenu()
		return true
	}

	/**
	 * The frame of "Unlock all in this frame" when a menu opens (job 062).
	 *
	 * @param {string|null} id the menu's target
	 * @param {{x: number, y: number}|null} world W
	 * @return {string|null} the target (unlockFrameIds skips one that is no frame); on the empty canvas the
	 *   topmost frame under W; else null
	 */
	menuFrame(id, world) {
		if (id !== null) {
			return id
		}
		if (world === null) {
			return null
		}
		const c = this.model.topContainerAt(world.x, world.y)
		return typeof c === 'string' && this.model.has(c) && this.model.get(c).t === 'frame' ? c : null
	}

	/**
	 * The locker of "Unlock all locked by {name}" when a menu opens (job 062).
	 *
	 * @param {string|null} id the menu's target
	 * @return {{by: string, name: string, guest?: true}|null} the target's lock when someone else with a
	 *   known pid and name holds it ((job 151) guest: true when that person locked as a guest); else null
	 */
	menuLocker(id) {
		const it = id !== null ? this.model.get(id) : null
		if (!isLocked(it)) {
			return null
		}
		const { by, name } = it.lock
		if (typeof by !== 'string' || by === '' || by === this.me?.pid || typeof name !== 'string' || name === '') {
			return null
		}
		return it.lock.guest === true ? { by, name, guest: true } : { by, name }
	}

	/**
	 * Closes the context menu (§6.6); the shell gives the canvas the focus
	 * where the menu itself was closed by Esc, Tab or a click outside.
	 *
	 * @return {boolean} a menu was open
	 */
	closeMenu() {
		if (this.menu === null) {
			return false
		}
		this.menu = null
		this.emitMenu()
		return true
	}

	/** The open menu's target left the model or the selection changed from another source: close it. */
	checkMenu() {
		const m = this.menu
		if (m === null) {
			return
		}
		const same = m.ids.length === this.selection.length && m.ids.every((x, k) => x === this.selection[k])
		if (!same || (m.id !== null && !this.model?.has(m.id))) {
			this.closeMenu()
		}
	}

	/**
	 * The menu state for the shell; items, grid, gridSnap, cursors (job 147), wheel (job 154: the scene's stage),
	 * unlockAll (board menu), unlockFrame (the menu's frame: the target, or in the board menu
	 * the frame under W) and unlockBy with unlockByName (the target's locker,
	 * job 062; job 151: plus unlockByGuest: true when that locker is a guest,
	 * the key is missing otherwise) as they are now, not live.
	 */
	emitMenu() {
		const m = this.menu
		const by = m?.locker ? this.unlockByIds(m.locker.by).length : 0
		this.ui.onContextMenu?.(m ? {
			id: m.id, at: [...m.at], seq: m.seq, items: this.model?.size ?? 0,
			grid: this.scene?.getGrid?.() === true, gridSnap: this.scene?.getGridSnap?.() === true, cursors: this.cursors,
			wheel: this.scene?.getWheel?.() ?? null,
			unlockAll: m.id === null ? this.unlockAllIds().length : 0,
			unlockFrame: m.frame !== null ? this.unlockFrameIds(m.frame).length : 0,
			unlockBy: by,
			unlockByName: by > 0 ? m.locker.name : null,
			...(by > 0 && m.locker.guest === true ? { unlockByGuest: true } : {}),
			...this.menuTable(m),
			...this.menuMindmap(m),
			...this.menuLanes(m),
		} : null)
	}

	/**
	 * (Job 199) The lanes of a menu: on a lane of the one selected frame with
	 * lanes, {lanes: {index, count, locked, cols}} (contextbar.js menuEntries;
	 * job 208: cols {index, count} of the column of the menu, null without
	 * columns), else nothing.
	 *
	 * @param {object} m the menu state
	 * @return {object} {lanes} or {}
	 */
	menuLanes(m) {
		const it = m.cell !== null && m.id !== null && this.selection.length === 1 && this.selection[0] === m.id ? this.model?.get(m.id) : null
		if (!hasLanes(it)) {
			return {}
		}
		const bands = laneBands(it)
		const index = bands.findIndex((b) => b.key === m.cell)
		const cols = colBands(it)
		const ci = cols.findIndex((b) => b.key === m.col)
		// job 225: group, the lane (column) is in a group
		const cl = cols.length === 0 ? null : ci < 0 ? {} : { index: ci, count: cols.length, group: cols[ci].g !== null }
		return index < 0 ? {} : { lanes: { index, count: bands.length, locked: isLocked(it), group: bands[index].g !== null, cols: cl } }
	}

	/**
	 * (Job 173) The table of a menu: on a cell of the one selected table,
	 * {table: {rows, cols, locked}} (contextbar.js menuEntries), else nothing.
	 *
	 * @param {object} m the menu state
	 * @return {object} {table} or {}
	 */
	menuTable(m) {
		const it = m.cell !== null && m.id !== null && this.selection.length === 1 && this.selection[0] === m.id ? this.model?.get(m.id) : null
		if (!it || it.t !== 'table') {
			return {}
		}
		const count = (map) => (map && typeof map === 'object' ? Object.keys(map).length : 0)
		return { table: { rows: count(it.data?.rows), cols: count(it.data?.cols), locked: isLocked(it) } }
	}

	/**
	 * Runs a context-menu entry (§6.6) and closes the menu. The entries on
	 * items act on the selection the scene set before the intent. Every entry
	 * but edit-text, note-here, sort-colors and sort-frame (job 139: the shell
	 * decides), insert-template (job 180: ui.onTemplates, the dialog takes
	 * it), save-template with a draft (job 182: ui.onSaveTemplate, the
	 * dialog takes it) and export-pdf with a dialog (job 207: ui.onExportPdf)
	 * gives the canvas the focus back. paste-here
	 * stays synchronous up to navigator.clipboard.read() (user activation).
	 *
	 * @param {string} name entry (contextbar.js MENU_ITEMS)
	 * @return {boolean} an open menu ran the entry
	 */
	menuAction(name) {
		const m = this.menu
		if (m === null || this.destroyed) {
			return false
		}
		this.closeMenu()
		if (this.clientMode !== 'edit' || this.viewOnly || this.frozen || !this.model) {
			return false
		}
		switch (name) {
		case 'cut':
			this.cut()
			break
		case 'copy':
			this.copy()
			break
		case 'duplicate':
			this.duplicate()
			break
		case 'delete':
			this.deleteSelection()
			break
		case 'front':
		case 'back':
			this.reorder(name)
			break
		case 'edit-text':
			this.editTextOf(m.id)
			return true
		case 'react':
			// job 172: the picker at the menu's point takes the focus
			this.openReactionPicker(this.selection.length === 1 ? this.selection[0] : m.id, { x: m.at[0], y: m.at[1], w: 0, h: 0 })
			return true
		case 'tags':
			// job 191: the tag panel at the menu's point takes the focus
			this.openTagPanel({ x: m.at[0], y: m.at[1], w: 0, h: 0 })
			return true
		case 'swap-direction':
			this.swapDirection()
			break
		case 'connect':
			this.connectSelection()
			break
		case 'arrange':
			// job 230: the bar's panel "Arrange" opens and takes the focus
			this.ui.onArrange?.()
			return true
		case 'sort-colors':
		case 'sort-frame':
			// job 139: the shell puts the focus (canvas after a pointer, the first name field after a key)
			if (name === 'sort-colors') {
				this.sortByColor()
			} else {
				this.sortFrameByColor()
			}
			return true
		case 'group':
			// a blocked entry stays in the menu (M2, R20): its activation shows the reason
			this.groupSelection()
			break
		case 'ungroup':
			this.ungroupSelection()
			break
		case 'frame-around':
			// job 278: a greyed entry shows its reason; else the new frame's title editor takes the focus
			if (this.frameAroundSelection() === 'sent') {
				return true
			}
			break
		case 'lock':
			this.lockSelection()
			break
		case 'unlock':
			this.unlockSelection()
			break
		case 'unlock-by':
			// the person named when the menu opened, however the target is locked now (job 062)
			this.unlockBy(m.locker?.by ?? null)
			break
		case 'unlock-frame':
			// the menu's frame, not the selection: its target, or the frame under W in the board menu (job 044, 062)
			this.unlockFrame(m.frame)
			break
		case 'zoom-selection':
			this.zoomToSelection()
			break
		case 'export-png':
			// job 178: the selection the scene set before the intent (a frame: selected by the right click)
			this.exportPng('selection')
			break
		case 'export-svg':
			// job 200: the same set as the PNG's, as vectors
			this.exportVector('selection', 'svg')
			break
		case 'export-pdf':
			// job 207: the shell's dialog asks for the page size (it takes the focus)
			if (this.openPdfExport('selection') && this.ui.onExportPdf) {
				return true
			}
			break
		case 'export-bpmn':
			// job 205: the BPMN diagram of the same set
			this.exportBpmn('selection')
			break
		case 'export-csv':
			// job 179: the same set as the image's
			this.exportBoardCsv('selection')
			break
		case 'save-template': {
			// job 182: the selection as it is now; the shell's save dialog takes the focus
			const d = this.templateDraft('selection')
			if (d && this.ui.onSaveTemplate) {
				this.ui.onSaveTemplate(d)
				return true
			}
			break
		}
		case 'only-sticky':
		case 'only-shape':
		case 'only-text':
		case 'only-connector':
		case 'only-frame':
		case 'only-group':
			// job 144: "Filter selection", the entries of the bar's count button
			this.filterSelection(name.slice('only-'.length))
			break
		case 'paste-here':
			this.pasteHere(m.world)
			break
		case 'note-here':
			this.noteHere(m.world)
			return true
		case 'pad-here':
			// job 193: its title editor opens and keeps the focus, like note-here's editor
			this.padHere(m.world)
			return true
		case 'comment':
			// job 189: on an item its open thread or a new one there; on the empty canvas a free one at W
			if (m.id !== null) {
				// job 195: on a mind map the node of the menu
				this.commentOn(this.selection.length === 1 ? this.selection[0] : m.id, m.cell ?? undefined)
			} else if (m.world) {
				this.composeComment({ item: null, x: m.world.x, y: m.world.y })
			}
			return true
		case 'insert-template':
			// job 180: the shell opens the template dialog (it takes the focus)
			this.ui.onTemplates?.()
			return true
		case 'select-all':
			this.selectAll()
			break
		case 'unlock-all':
			this.unlockAll()
			break
		case 'fit':
			this.zoomFit()
			break
		case 'grid':
			this.toggleGrid()
			break
		case 'grid-snap':
			this.toggleGridSnap()
			break
		case 'cursors':
			this.toggleCursors()
			break
		case 'wheel':
			this.cycleWheel()
			break
		case 'row-above':
		case 'row-below':
		case 'col-left':
		case 'col-right':
		case 'row-delete':
		case 'col-delete':
		case 'table-csv':
			// job 173: on the cell under W when the menu opened
			this.tableMenuAction(name, m.id, m.cell ?? null)
			break
		case 'lane-rename':
		case 'lane-above':
		case 'lane-below':
		case 'column-add':
		case 'column-rename':
		case 'column-left':
		case 'column-right':
		case 'lane-group':
		case 'lane-group-rename':
		case 'column-group':
		case 'column-group-rename':
			// job 199: an editor of a lane's name takes the focus (job 208: of a column's; job 225: of a group's)
			this.laneMenuAction(name, m.id, m.cell ?? null, m.col ?? null)
			return true
		case 'lane-up':
		case 'lane-down':
		case 'lane-delete':
		case 'column-move-left':
		case 'column-move-right':
		case 'column-delete':
		case 'lane-ungroup':
		case 'column-ungroup':
			// job 199: on the lane under W when the menu opened (job 208: on its column; job 225: on its group)
			this.laneMenuAction(name, m.id, m.cell ?? null, m.col ?? null)
			break
		case 'mm-child':
		case 'mm-sibling':
			// job 195: the new node's editor takes the focus
			this.mindmapMenuAction(name, m.id, m.cell ?? null)
			return true
		case 'mm-fold':
		case 'mm-rearrange':
		case 'mm-delete':
		case 'mm-text':
			// job 195: on the node under W when the menu opened
			this.mindmapMenuAction(name, m.id, m.cell ?? null)
			break
		default:
			return false
		}
		this.focusCanvas()
		return true
	}

	/**
	 * "Edit text" (like Enter): the editor of the one selected item with a text path.
	 *
	 * @param {string|null} id the menu's target
	 * @return {boolean} the editor opens
	 */
	editTextOf(id) {
		if (this.viewOnly || this.frozen || !this.scene || typeof id !== 'string' || this.selection.length !== 1 || this.selection[0] !== id) {
			return false
		}
		if (!this.model?.has(id) || textPathOf(this.model.get(id).t) === null || isLocked(this.model.get(id))) {
			return false
		}
		try {
			return this.scene.openTextEditor(id) !== false
		} catch (e) {
			this.actionFailed(e)
			return false
		}
	}

	/**
	 * "Add note here": like a click with the note tool at W (box center at W,
	 * parent through containerFor, the editor opens, creation and first text
	 * are one undo step).
	 *
	 * @param {{x: number, y: number}|null} world W of the menu (null: viewport center)
	 * @return {string|null} new id
	 */
	noteHere(world) {
		if (this.viewOnly || this.frozen || !this.model) {
			return null
		}
		const at = world ?? this.viewportCenter()
		let id = null
		this.guard(() => {
			id = this.createNow({ type: 'create', t: 'sticky', at: { x: at.x, y: at.y }, rect: null })
		})
		return id
	}

	/**
	 * (Job 188) "Add note pad here": like a click with the note tool's type
	 * 'pad' at W (box centre at W, parent through containerFor; job 193: its
	 * title editor opens, creation and title are one undo step).
	 *
	 * @param {{x: number, y: number}|null} world W of the menu (null: viewport center)
	 * @return {string|null} new id
	 */
	padHere(world) {
		if (this.viewOnly || this.frozen || !this.model) {
			return null
		}
		const at = world ?? this.viewportCenter()
		let id = null
		this.guard(() => {
			id = this.createNow({ type: 'create', t: 'pad', at: { x: at.x, y: at.y }, rect: null })
		})
		return id
	}

	/**
	 * (Job 201) A shape from the shapes panel: like a click with the shape
	 * tool and this kind at the point (box centre there, the kind's own size
	 * and look, parent through containerFor, one undo step; a shape with
	 * text opens its editor, a symbol none), then selected. (Job 203) The
	 * kind image needs its picture {uri, w, h} (an entry of an own library):
	 * data.img, and the proportions of the entry (shapeImage.js pictureSize).
	 *
	 * @param {string} kind data.kind (registry enum; anything else creates nothing)
	 * @param {{x: number, y: number}|null} [screen] point in canvas pixels (the drop point;
	 *   null: the middle of the view)
	 * @param {{uri: string, w: number, h: number}|null} [picture] (job 203) the picture of an own shape
	 * @return {string|null} new id
	 */
	placeShape(kind, screen = null, picture = null) {
		if (this.viewOnly || this.frozen || !this.model || !this.scene || !checkField('shape', 'data.kind', kind).ok) {
			return null
		}
		const pic = kind === 'image' ? placeablePicture(picture) : null
		if (kind === 'image' && pic === null) {
			return null
		}
		const ok = !!screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)
		const at = ok ? this.scene.screenToWorld(screen.x, screen.y) : this.viewportCenter()
		let id = null
		this.guard(() => {
			id = this.createNow(pic === null
				? { type: 'create', t: 'shape', at: { x: at.x, y: at.y }, rect: null, data: { kind } }
				: { type: 'create', t: 'shape', at: { x: at.x, y: at.y }, rect: null, data: { kind, img: splitImage(pic.uri) }, size: pictureSize(pic.w, pic.h) })
		})
		return id
	}

	/**
	 * (Job 204) "Pool with lanes" from the shapes panel: the frame tool's
	 * option "Swimlanes" with its click size (LANE_FRAME_W × LANE_FRAME_H)
	 * centred at the point, given as the dragged box, so the pool takes the
	 * items lying wholly inside it like a drawn frame (createNow: three named
	 * lanes, its title editor, one undo step), then selected.
	 *
	 * @param {{x: number, y: number}|null} [screen] point in canvas pixels (the drop point;
	 *   null: the middle of the view)
	 * @return {string|null} new id
	 */
	placeLanes(screen = null) {
		if (this.viewOnly || this.frozen || !this.model || !this.scene) {
			return null
		}
		const ok = !!screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)
		const at = ok ? this.scene.screenToWorld(screen.x, screen.y) : this.viewportCenter()
		let id = null
		this.guard(() => {
			const rect = { x: at.x - LANE_FRAME_W / 2, y: at.y - LANE_FRAME_H / 2, w: LANE_FRAME_W, h: LANE_FRAME_H }
			id = this.createNow({ type: 'create', t: 'frame', at: { x: at.x, y: at.y }, rect, lanes: true })
		})
		return id
	}

	/**
	 * "Filter selection" (job 144; the bar's count button, the menu entries
	 * only-<kind>): keeps only the items of one kind of the current selection
	 * (model/groups.js selectionKinds, computed again now; 'group' keeps the
	 * fully selected groups whole). An empty entry or one that is the whole
	 * selection changes nothing. Only the selection changes: no op, no undo
	 * step, no toast. Nothing outside mode edit, in viewOnly or while frozen.
	 *
	 * @param {string} kind sticky, shape, text, connector, frame or group
	 * @return {boolean} the selection changed
	 */
	filterSelection(kind) {
		if (this.clientMode !== 'edit' || this.viewOnly || this.frozen || !this.model) {
			return false
		}
		const known = [...new Set(this.selection.filter((id) => this.model.has(id)))]
		const entry = selectionKinds(this.model, known).find((k) => k.kind === kind)
		if (!entry || entry.ids.length === known.length) {
			return false
		}
		this.select(entry.ids)
		return true
	}

	/**
	 * (Job 230) "By tag" of the chip's "Narrow selection": keeps only the
	 * items of the current selection that carry the tag (notes, model/tags.js
	 * noteTagIds). A tag no selected item has, or one every selected item
	 * has, changes nothing. Like filterSelection: only the selection changes
	 * (no op, no undo step, no toast), nothing outside mode edit, in viewOnly
	 * or while frozen.
	 *
	 * @param {string} tagId tag id
	 * @return {boolean} the selection changed
	 */
	filterSelectionByTag(tagId) {
		if (this.clientMode !== 'edit' || this.viewOnly || this.frozen || !this.model || typeof tagId !== 'string') {
			return false
		}
		const byId = tagMap(this.boardTags())
		if (!byId.has(tagId)) {
			return false
		}
		const known = [...new Set(this.selection.filter((id) => this.model.has(id)))]
		const keep = known.filter((id) => noteTagIds(this.model.get(id), byId).includes(tagId))
		if (keep.length === 0 || keep.length === known.length) {
			return false
		}
		this.select(keep)
		return true
	}

	/**
	 * "Select all" (like Ctrl/⌘+A): every item of the board but the locked ones (M2, R20); (job 190)
	 * those are offered in mode edit (scene.setLockedOffer, the bar's "Select n locked items").
	 */
	selectAll() {
		if (!this.model) {
			return
		}
		const all = [...this.model.ids()]
		this.select(this.unlockedOf(all))
		if (this.clientMode === 'edit' && !this.frozen && typeof this.scene?.setLockedOffer === 'function') {
			if (this.scene.setLockedOffer(all.filter((id) => isLocked(this.model.get(id))))) {
				this.emitSelection()
			}
		}
	}

	/**
	 * Job 190: the offered locked items that still exist and are locked (the scene's offer after a plain
	 * marquee, Ctrl/⌘+A or "Select all"); [] outside mode edit, in viewOnly and while frozen.
	 *
	 * @return {string[]} item ids
	 */
	lockedOfferIds() {
		if (this.clientMode !== 'edit' || this.viewOnly || this.frozen || !this.model || typeof this.scene?.getLockedOffer !== 'function') {
			return []
		}
		const ids = this.scene.getLockedOffer()
		return Array.isArray(ids) ? [...new Set(ids)].filter((id) => this.model.has(id) && isLocked(this.model.get(id))) : []
	}

	/**
	 * Job 190, "Select n locked items" of the context bar: selects exactly the offered items that are
	 * still there and locked (replaces the selection, like an Alt marquee); the offer ends. Only the
	 * selection changes: no op, no undo step, no toast.
	 *
	 * @return {boolean} something was selected
	 */
	selectLockedOffer() {
		const ids = this.lockedOfferIds()
		if (ids.length === 0) {
			return false
		}
		this.scene.setLockedOffer?.(null)
		this.select(ids)
		return true
	}

	/**
	 * "Paste here" (§6.5.3 R19, T4-03): reads the clipboard synchronously in
	 * the click (navigator.clipboard.read(), before any await), evaluates it
	 * like the paste event and places it at W. A refusal (NotAllowedError),
	 * an empty result or an error → toast paste-blocked, nothing pasted.
	 *
	 * @param {{x: number, y: number}|null} world W of the menu (null: viewport center)
	 * @return {boolean} the clipboard is being read
	 */
	pasteHere(world) {
		if (this.viewOnly || this.frozen || !this.model) {
			return false
		}
		let pending
		try {
			const cb = clipboardReader(this.win ?? undefined)
			if (cb === null) {
				throw new Error('no readable clipboard here')
			}
			pending = cb.read()
		} catch (e) {
			this.pasteBlocked()
			return false
		}
		const at = world ?? this.viewportCenter()
		Promise.resolve(pending)
			.then((items) => clipboardItemsData(items))
			.then((data) => {
				if (this.destroyed || this.frozen || this.viewOnly || !this.model) {
					return
				}
				if (!data || (data.html === '' && data.text === '' && data.files === 0)) {
					this.pasteBlocked()
					return
				}
				this.guard(() => this.pasteData(data, { inPlace: false, at, menu: true }))
			})
			.catch(() => {
				if (!this.destroyed) {
					this.pasteBlocked()
				}
			})
		return true
	}

	/**
	 * Toast [data-knorke-toast=paste-blocked] (§6.5.3 R19): use the keyboard
	 * instead; the key from the one formatter (util/shortcuts.js, job 141).
	 */
	pasteBlocked() {
		const { hint } = shortcut('paste', isApplePlatform(this.win?.navigator ?? null))
		this.toast(t('knorke', 'Paste with {shortcut} instead: the browser did not allow reading the clipboard.', { shortcut: hint }), { hook: 'paste-blocked' })
	}

	zoom100() {
		const c = this.scene?.getCamera()
		if (c && c.scale > 0) {
			this.scene.zoomBy(1 / c.scale)
		}
	}

	// ---- model flow ------------------------------------------------------

	/**
	 * Visible state → model → scene for the given ids; active ids are deferred.
	 *
	 * @param {Iterable<string>} ids affected ids
	 */
	flushVisible(ids) {
		if (!this.model || !ids) {
			return
		}
		const all = new Set(ids)
		for (const id of all) {
			// a container's move can change what its children show: a pending
			// keep patch (SPEC-M1 §4.7 rule 15) leaves them in place (Replica keepShift)
			if (this.model.has(id) && typeInfo(this.model.get(id).t).container) {
				for (const c of this.model.childrenOf(id) ?? []) {
					all.add(c)
				}
			}
		}
		const upserts = []
		const removes = []
		let lockMoved = false
		// a group changed (M2, R20 Gruppieren: a new, changed or removed group of any
		// item): what a selected item's group is may change, the bar must follow
		let groupMoved = false
		for (const id of all) {
			if (id === this.editingId) {
				this.checkEditorLock(id)
			}
			if (this.scene?.isActive(id)) {
				this.deferred.add(id)
				continue
			}
			this.deferred.delete(id)
			const v = this.replica.visible(id)
			if (v) {
				if (!this.model.has(id) || itemKey(this.model.get(id)) !== itemKey(v)) {
					upserts.push(v)
					// a selected item's lock changed (M2, R20): the bar must follow
					lockMoved = lockMoved || (this.model.has(id) && this.selection.includes(id)
						&& JSON.stringify(this.model.get(id).lock ?? null) !== JSON.stringify(v.lock ?? null))
					groupMoved = groupMoved || (this.model.get(id)?.group ?? null) !== (v.group ?? null)
				}
			} else if (this.model.has(id)) {
				removes.push(id)
				groupMoved = groupMoved || typeof this.model.get(id).group === 'string'
			}
		}
		if (upserts.length === 0 && removes.length === 0) {
			return
		}
		// job 146 (R22): the absolute boxes of the selected items this flush can
		// move (the item itself or its frame); a changed box reports the
		// selection again, so the "Arrange" fields show the real position
		const boxes = new Map()
		for (const id of this.selection) {
			if (this.model.has(id) && (all.has(id) || all.has(this.model.get(id).parent))) {
				boxes.set(id, this.model.abs(id))
			}
		}
		// job 240: the tick "1:1" of the selected shapes, also when only it changed (another person)
		const squares = new Map(this.selection.filter((id) => all.has(id) && this.model.has(id)).map((id) => [id, squareOn(this.model.get(id))]))
		// job 190: the number of offered locked items follows (unlocked or deleted by others)
		const offered = this.lockedOfferIds().length
		const summary = this.model.apply({ upserts, removes })
		this.scene?.update(summary)
		let reported = false
		if (removes.length > 0) {
			const rest = this.selection.filter((id) => this.model.has(id))
			if (rest.length !== this.selection.length) {
				this.selection = rest
				this.scene?.setSelection(rest)
				this.emitSelection()
				reported = true
			}
		}
		const boxMoved = [...boxes].some(([id, b]) => this.model.has(id) && !sameAbs(b, this.model.abs(id)))
		const offerMoved = this.lockedOfferIds().length !== offered
		const squareMoved = [...squares].some(([id, sq]) => this.model.has(id) && squareOn(this.model.get(id)) !== sq)
		if ((lockMoved || boxMoved || offerMoved || squareMoved || (groupMoved && this.selection.length > 0)) && !reported) {
			this.emitSelection()
		}
		// R17 K4: the vote list follows the model (one ui.onVotes per tick)
		this.voteItemsChanged()
		this.checkMenu()
		// job 172: the picker, the names and the list follow their note
		this.checkReactions(all)
		// job 191: the tag panels follow their notes and the counts
		this.checkTags()
		this.emitEmpty()
	}

	/**
	 * (Job 180) ui.onEmpty(empty) when the local model turned empty or got its
	 * first item. (Job 271) Runs after every load and change of the local
	 * model, so it also reports ui.onItems() (the board search counts again).
	 */
	emitEmpty() {
		if (!this.model) {
			return
		}
		this.ui.onItems?.()
		const empty = this.model.size === 0
		if (empty !== this.lastEmpty) {
			this.lastEmpty = empty
			this.ui.onEmpty?.(empty)
		}
	}

	flushDeferred() {
		if (this.deferred.size === 0) {
			return
		}
		const ids = [...this.deferred]
		this.deferred.clear()
		this.flushVisible(ids)
	}

	/**
	 * @param {object[]} items full current objects
	 * @param {string[]} removed ids
	 */
	onChanges(items, removed) {
		if ((!items || items.length === 0) && (!removed || removed.length === 0)) {
			return
		}
		this.flushVisible(this.replica.applyServer(items, removed))
		if (this.slideRole !== null) {
			// job 272: the shown frame may be gone or have moved
			this.slideShow.sync()
			this.emitSlides()
		}
		// job 267: a new AI card gets the height of its content; an AI result is selected once it is here
		this.ai.fixHeights(items ?? [])
		this.ai.selectArrived()
	}

	/**
	 * @param {{seq: number, rev: number|null, res: string[]}} acks acks
	 */
	onAcks(acks) {
		// job 216: stale vote ops of an earlier answer without a votes block stay dropped
		this.staleVotes = []
		const { ids, failed, busy } = this.replica.ack(acks)
		this.trackBusy(busy === true)
		this.flushVisible(ids)
		if (failed.length > 0) {
			this.handleFailed(failed)
		}
		for (const id of ids) {
			this.undoPending.delete(id)
		}
	}

	/**
	 * busy answers (SPEC-M1 §6.4): the loop repeats the batch on its own and
	 * stays online; after BUSY_TOAST_MS of busy answers in a row the user
	 * hears once that saving is slow but nothing is lost.
	 *
	 * @param {boolean} busy this answer was busy for the whole batch
	 */
	trackBusy(busy) {
		if (!busy) {
			this.busySince = null
			this.busyToastShown = false
			return
		}
		const now = this.now()
		if (this.busySince === null) {
			this.busySince = now
		}
		if (!this.busyToastShown && now - this.busySince >= BUSY_TOAST_MS) {
			this.busyToastShown = true
			this.info(t('knorke', 'Changes are being saved more slowly. Nothing is lost.'))
		}
	}

	/**
	 * Rejected ops: toasts and text rescue (§6.5).
	 *
	 * @param {Array<{op: object, code: string}>} failed rejected ops
	 */
	handleFailed(failed) {
		let undoFailed = false
		let limit = false
		let denied = false
		let serverError = false
		let closed = false
		/** job 146: the own "Arrange" patch came back bad (one toast arrange-bad per answer) */
		let arrangeBad = false
		/** items whose ops came back itemlocked (M2, R20): one toast with their number */
		const held = new Set()
		// per item only the newest rejected text: a batch can carry two text
		// patches of one item when the older one went out with a keepalive
		// flush (compaction barrier, T15), and ops of one id keep their order
		const rescues = new Map()
		/** result codes of rejected vote ops (SPEC-M1 §4.6) */
		const voteCodes = []
		/** job 172: a reaction patch came back with a code the user hears of */
		let reactFailed = false
		for (const failure of failed) {
			const { op } = failure
			let { code } = failure
			if (op && isReactionPatch(op)) {
				// no rescue, no undo: gone (the note went) stays silent
				reactFailed = reactFailed || !['gone', 'dup', BUSY].includes(code)
				continue
			}
			if (op && op.o === 'vote') {
				// votes are no item state: no rescue, no undo; VoteState corrects below
				voteCodes.push(code)
				if (code === 'stale') {
					// job 216: carried onto the state of this answer's votes block (onVotes)
					this.staleVotes.push({ op, maybeApplied: failure.maybeApplied === true })
				}
				continue
			}
			if (!KNOWN_CODES.includes(code)) {
				// SPEC-M1 §4.3: an unknown result code counts as 'bad'
				console.warn('[knorke] unknown result code ' + code + ', treated as bad', op)
				code = 'bad'
			}
			if (code === 'dup') {
				continue
			}
			if (code === 'closed') {
				// SPEC-M1 §4.6: a vote op of a session that is no longer open
				closed = true
				continue
			}
			if (code === 'gone' && op.o === 'remove') {
				// Already removed: an idempotent repeat (§4.6), e.g. a remove that a
				// keepalive flush applied before the loop sent it again. The item is
				// gone, as wanted; never an undo failure (T15).
				continue
			}
			if (code === 'denied') {
				denied = true
			}
			if (code === 'itemlocked') {
				held.add(op.id)
			}
			if (code === 'limit') {
				limit = true
			}
			if (code === SERVER_ERROR) {
				// U8: dropped by the sync loop after it failed alone again and again
				serverError = true
			}
			if ((code === 'bad' || code === 'gone') && this.undoPending.has(op.id)) {
				undoFailed = true
			}
			if (code === 'bad' && this.isArrangeOp(op)) {
				arrangeBad = true
			}
			const rejected = this.rejectedText(op)
			// job 173: a cell of a table has its own lease key
			const rkey = rejected !== null ? leaseKey(op.id, rejected.cell) : null
			if (rejected !== null && code === 'locked' && rkey === this.takeoverId) {
				// Sent before this tab's take-over reached the server (every request
				// from the take-over on carries me.tk until it is through, and its
				// answer clears takeoverId before its acks are read): not a lost
				// lease. The text goes out again right behind the take-over.
				this.takeoverText = { id: op.id, cell: rejected.cell, path: rejected.path, text: rejected.text }
			} else if (rejected !== null) {
				rescues.set(rkey, [rkey, rejected.text, code])
			} else if (code === 'bad') {
				console.warn('[knorke] op rejected as bad', op)
			}
		}
		if (denied && !this.deniedShown) {
			this.deniedShown = true
			this.toast(t('knorke', 'No permission'))
		}
		if (held.size > 0) {
			this.toast(n('knorke', '%n locked item was not changed.', '%n locked items were not changed.', held.size), { hook: 'lock-held' })
		}
		if (limit) {
			this.toast(t('knorke', 'This board is full.'))
		}
		if (undoFailed) {
			this.toast(t('knorke', 'Undo not possible'))
		}
		if (serverError) {
			this.toast(t('knorke', 'A change could not be saved because of a server error.'))
		}
		if (arrangeBad) {
			// job 146 (R22): the model is back on the confirmed state, and flushVisible
			// has reported the selection with it (the fields spring back)
			this.arrangeSent = null
			this.toast(t('knorke', 'Position could not be set'), { hook: 'arrange-bad' })
		}
		if (closed) {
			this.voteToast('vote-closed', t('knorke', 'Voting has ended.'))
		}
		if (reactFailed) {
			this.toast(t('knorke', 'Your reaction could not be saved.'), { hook: 'react-failed' })
		}
		if (voteCodes.length > 0) {
			this.voteFailed(voteCodes)
		}
		if (rescues.size > 0) {
			// After the rest of this sync answer: its changes (an item removed in
			// the same answer) and its presence (the name of the lease holder)
			// are applied synchronously after onAcks.
			queueMicrotask(() => {
				if (!this.destroyed) {
					for (const [id, text, code] of rescues.values()) {
						this.rescue(id, text, code)
					}
				}
			})
		}
	}

	/**
	 * Job 146: the rejected op is the own newest "Arrange" patch, recognised by
	 * value (the Replica copies ops and merges later ops of one item into
	 * them): the same item and every key that patch sent with the same value.
	 *
	 * @param {object} op rejected op
	 * @return {boolean}
	 */
	isArrangeOp(op) {
		const a = this.arrangeSent
		if (a === null || !op || op.o !== 'patch' || op.id !== a.id || !op.p || typeof op.p !== 'object') {
			return false
		}
		return Object.keys(a.p).every((k) => Object.prototype.hasOwnProperty.call(op.p, k) && op.p[k] === a.p[k])
	}

	/**
	 * Rejected vote ops (SPEC-M1 §4.6): limit → "You have no votes left.",
	 * closed → "Voting has ended.", denied → "No permission" (once); the
	 * optimistic votes go back to the server state plus what is still pending
	 * (the votes block of the same answer corrects the server part); stale
	 * (job 216) stays silent, onVotes carries the change onto that block.
	 *
	 * @param {string[]} codes result codes of the rejected vote ops
	 */
	voteFailed(codes) {
		const r = this.voteState.ack(codes, null, this.pendingVotes())
		if (r.limit) {
			this.voteToast('vote-limit', t('knorke', 'You have no votes left.'))
		}
		if (r.closed) {
			this.voteToast('vote-closed', t('knorke', 'Voting has ended.'))
		}
		if (r.denied && !this.deniedShown) {
			this.deniedShown = true
			this.toast(t('knorke', 'No permission'))
		}
		for (const c of codes) {
			if (!['limit', 'closed', 'denied', 'gone', 'dup', 'stale'].includes(c)) {
				console.warn('[knorke] vote op rejected: ' + c)
			}
		}
		this.pushVoteState()
		this.emitVotes()
	}

	/**
	 * Text carried by a rejected op, when the op touched the text path of its
	 * type and no newer pending op carries newer text for it.
	 *
	 * @param {object} op rejected op
	 * @return {{path: string, text: string}|null}
	 */
	rejectedText(op) {
		if (op.o === 'put') {
			const path = textPathOf(op.t)
			const v = path ? getPath(op.p ?? {}, path) : null
			return typeof v === 'string' && v !== '' ? { path, text: v } : null
		}
		if (op.o !== 'patch' || !op.p) {
			return null
		}
		for (const path of this.textPathsIn(op)) {
			if (Object.prototype.hasOwnProperty.call(op.p, path) && typeof op.p[path] === 'string') {
				if (this.hasNewerText(op.id, path)) {
					return null
				}
				// job 173: the cell of a table's text path; job 195: the node of a mind map's
				return { path, text: op.p[path], cell: subOfPath(path) }
			}
		}
		return null
	}

	/**
	 * @param {object} op a patch
	 * @return {string[]} the text paths of the op's item (textPathsOf), (job 173) and for a table (or an
	 *   unknown item) the cell paths data.cells.<col>.<row> the patch carries
	 */
	textPathsIn(op) {
		const paths = this.textPathsOf(op.id)
		const known = this.replica.visible(op.id) ?? (this.model?.has(op.id) ? this.model.get(op.id) : null)
		// job 195: and a mind map's node texts data.texts.<pot>.<key>
		if ((!known || known.t === 'table' || known.t === 'mindmap') && op.p && typeof op.p === 'object') {
			for (const path of Object.keys(op.p)) {
				if (subOfPath(path) !== null) {
					paths.push(path)
				}
			}
		}
		return paths
	}

	/**
	 * @param {string} id item id
	 * @return {string[]} the text path of the item's type (none for a type without
	 *   text); every text path (data.text, data.title, data.label) when the item is unknown
	 */
	textPathsOf(id) {
		const known = this.replica.visible(id) ?? (this.model?.has(id) ? this.model.get(id) : null)
		if (!known) {
			return allTextPaths()
		}
		const path = textPathOf(known.t)
		return path ? [path] : []
	}

	/**
	 * @param {string} id item id
	 * @param {string} path text path
	 * @return {boolean} an unacknowledged op still carries text for this path
	 */
	hasNewerText(id, path) {
		const pending = this.replica.pendingOps().ops
		return pending.some((op) => op.id === id && op.o === 'patch' && op.p
			&& Object.prototype.hasOwnProperty.call(op.p, path))
	}

	/**
	 * @param {string} key lease key: the item id, (job 173) '<id>#<cell>' for a cell of a table
	 * @param {string} text rejected text
	 * @param {string} code result code
	 */
	rescue(key, text, code) {
		const [id, cell] = leaseParts(key)
		const notice = this.noticeFor(key, code)
		if (this.editKey() === key) {
			// The editor may already show a notice (lease lost through presence).
			if (!this.leaseLost.has(key)) {
				this.loseLease(key, notice)
			}
			return
		}
		const exists = this.replica.visible(id) !== null || !!this.model?.has(id)
		// A rescue editor opens only when no editor is open at all (T6): opening
		// one finishes the open editor, and a rescue editor with a notice is
		// discarded without an intent, so an earlier rescued text would vanish,
		// and the focus would leave the editor the user is typing in.
		if (exists && this.scene && this.editingId === null && this.rescueEditorId === null) {
			this.loseLease(key, null)
			if (this.scene.openTextEditor(id, cell !== null ? { text, notice, cell } : { text, notice }) !== false) {
				this.rescueEditorId = key
				return
			}
			this.leaseLost.delete(key)
		}
		// Every other case collects the text in the copy dialog.
		this.ui.onRescue?.({ id, text, gone: !exists })
	}

	/**
	 * The item of the open editor got locked (M2, R20): its visible lock
	 * changed from null to a map (a lock of someone else, or the own lock
	 * from another tab). Editing ends like a lost lease: the text stays in
	 * the editor to be copied (notice), nothing more is sent.
	 *
	 * @param {string} id item of the open editor
	 */
	checkEditorLock(id) {
		const key = this.editKey() ?? id
		if (this.leaseLost.has(key) || !this.model?.has(id)) {
			return
		}
		const v = this.replica.visible(id)
		if (!isLocked(this.model.get(id)) && isLocked(v)) {
			this.loseLease(key, this.noticeFor(key, 'itemlocked'))
			return
		}
		// job 173: the row or the column of the open cell (or the table) is gone; job 195: the node of a mind map
		if (this.editingId === id && this.editingCell !== null && (!v || !hasSub(v, this.editingCell))) {
			this.loseLease(key, t('knorke', 'Not saved. Copy your text before closing.'))
		}
	}

	/**
	 * The text lease of id is lost (foreign holder, rejected text, frozen
	 * board): the editor keeps its text with a notice and commits nothing
	 * more, and intermediate text that is still queued (never sent) is
	 * dropped. Sent later, after the lease came back to this tab (the other
	 * participant closed their editor), the server would accept it and
	 * overwrite their newer text. The dropped text is still in the editor.
	 *
	 * @param {string} key lease key: the item id, (job 173) '<id>#<cell>' for a cell of a table
	 * @param {string|null} notice notice for the open editor (null: none to set)
	 */
	loseLease(key, notice) {
		const [id, cell] = leaseParts(key)
		this.leaseLost.add(key)
		if (notice !== null) {
			if (cell !== null) {
				this.scene?.setEditorNotice(id, notice, cell)
			} else {
				this.scene?.setEditorNotice(id, notice)
			}
		}
		const paths = cell !== null ? [subPath(cell)] : this.textPathsOf(id)
		if (paths.length > 0) {
			this.flushVisible(this.replica.dropQueuedPaths(id, paths))
		}
	}

	/**
	 * @param {string|null} id item id
	 * @param {string} code result code ('locked' names the holder; 'itemlocked': the item is locked, M2 R20)
	 * @return {string} translated notice
	 */
	noticeFor(id, code) {
		if (code === 'itemlocked') {
			return t('knorke', 'Not saved: this item is locked. Copy your text before closing.')
		}
		if (code === 'locked') {
			// job 173: id may be a lease key of a cell
			const [item, cell] = id ? leaseParts(id) : [null, null]
			const holder = item ? this.presence.leaseHolder(item, cell) : null
			return t('knorke', 'Not saved: {name} is editing this item. Copy your text before closing.', { name: holder?.name || t('knorke', 'someone else') })
		}
		return t('knorke', 'Not saved. Copy your text before closing.')
	}

	/**
	 * @param {string|null} id item now being edited
	 * @param {boolean} takeover the user took over the text lease
	 * @param {string|null} [cell] (job 173) the cell of a table
	 */
	onEditing(id, takeover, cell = null) {
		const prevKey = this.editKey()
		this.editingId = typeof id === 'string' ? id : null
		this.editingCell = this.editingId !== null && typeof cell === 'string' ? cell : null
		const key = this.editKey()
		if (this.rescueEditorId !== null && this.rescueEditorId !== key) {
			this.rescueEditorId = null
		}
		if (prevKey !== null && prevKey !== key) {
			const prev = prevKey
			const [prevId] = leaseParts(prevKey)
			if (!this.dropEmptyNewText(prevId)) {
				if (this.newEdit !== null && this.newEdit.id === prevId) {
					this.newEdit = null
				}
				this.remeasureClosed(prevKey)
			}
			// Keep announcing the closed item (me.e) until its last text op is
			// acknowledged: the server writes presence BEFORE the ops of the same
			// request, so e = null next to the final commit would hand the lease
			// to a waiting editor first and the own final text would come back
			// locked. Nothing pending for it: nothing to protect, release now.
			this.leaseTail = !this.leaseLost.has(prev) && this.hasPendingText(prev) ? prev : null
			this.leaseLost.delete(prev)
			this.textSession++
		}
		if (takeover && key !== null) {
			// Taking over: me.tk goes out with the next sync and stays pending
			// until a request carrying it got through, also when the editor
			// closes first (the lease tail keeps announcing the item, and its
			// final text must not go out without the take-over).
			this.takeoverId = key
			this.leaseLost.delete(key)
		}
		this.dropStaleTakeover()
		if (this.editingId === null) {
			this.flushDeferred()
		}
		this.sync?.poke()
		// job 279: the context bar shows B, I, S and the list button while a Markdown editor is open
		if (prevKey !== key) this.emitSelection()
	}

	/**
	 * (Job 279) An editor whose text understands Markdown is open: a note, a
	 * shape, a text item, or a cell of a table (not a frame title, a pad title,
	 * a lane, a mind map node or a connector label).
	 *
	 * @return {boolean}
	 */
	richEditing() {
		const it = this.editingId !== null && this.model?.has(this.editingId) ? this.model.get(this.editingId) : null
		if (!it) return false
		if (it.t === 'table') return this.editingCell !== null
		return (it.t === 'sticky' || it.t === 'shape' || it.t === 'text')
	}

	/**
	 * (Job 279) B, I, S or the list button of the context bar: the open editor formats its selection.
	 *
	 * @param {'bold'|'italic'|'strike'|'list'} what the button
	 * @return {boolean} the text changed
	 */
	formatText(what) {
		return this.richEditing() && this.scene?.formatText?.(what) === true
	}

	/**
	 * SPEC-M1 §6.5.2 (last bullet), §1.4: the editor of a NEW text item closed
	 * and the item is still empty. The editor sends no final intent when the
	 * value equals its start value (Esc or a click beside it without typing,
	 * M0 rule), so textNow() never sees this close; the session deletes the
	 * item here, in the undo step of its creation; an empty note or shape
	 * stays (job 138). Not while the lease is lost (the editor showed a
	 * notice), the board is frozen or view-only.
	 *
	 * @param {string} id item whose editor closed
	 * @return {boolean} true when the item was deleted
	 */
	dropEmptyNewText(id) {
		if (this.newEdit === null || this.newEdit.id !== id || this.frozen || this.viewOnly
			|| this.leaseLost.has(id) || !this.model?.has(id)) {
			return false
		}
		const item = this.model.get(id)
		if (item.t !== 'text' || String(fieldValue(item, textPathOf('text')) ?? '').trim() !== '') {
			return false
		}
		const key = this.newEdit.key
		this.newEdit = null
		this.guard(() => this.commit(actions.deleteItems(this.model, [id]), { urgent: true, mergeKey: key }))
		this.textSession++
		return true
	}

	/**
	 * The editor of a text item closed (SPEC-M1 §4.7 rule 13, R2): measure
	 * the visible state again and send {h} when it differs by more than 0.5
	 * (a concurrent width change may have left a height measured on the old
	 * text). Only the lease holder does this.
	 *
	 * @param {string} id item whose editor closed
	 */
	remeasureClosed(key) {
		const [id] = leaseParts(key)
		if (this.frozen || this.viewOnly || this.leaseLost.has(key) || !this.model?.has(id)) {
			return
		}
		const it = this.knownItem(id)
		if (it?.t === 'mindmap') {
			// job 195: the mind map's box as measured now (a concurrent change), into the step of the node's text
			const r = withBox(it, { p: {}, inv: {} }, this.nodeMeasure())
			if (Object.keys(r.p).length > 0 && !isLocked(this.model.get(id))) {
				const mergeKey = this.lastTextKey?.id === key ? this.lastTextKey.key : null
				this.guard(() => this.commit({ ops: [{ o: 'patch', id, p: r.p }], inverse: [{ o: 'patch', id, p: r.inv }] }, { urgent: true, mergeKey }))
			}
			return
		}
		if (it?.t === 'table') {
			// job 173: the table's w/h as measured now, into the step of the cell's text
			const r = withSize(it, { p: {}, inv: {} }, this.cellMeasure())
			if (Object.keys(r.p).length > 0 && !isLocked(this.model.get(id))) {
				const mergeKey = this.lastTextKey?.id === key ? this.lastTextKey.key : null
				this.guard(() => this.commit({ ops: [{ o: 'patch', id, p: r.p }], inverse: [{ o: 'patch', id, p: r.inv }] }, { urgent: true, mergeKey }))
			}
			return
		}
		if (it?.t !== 'text') {
			return
		}
		const h = this.measure(it)
		if (h === null) {
			return
		}
		// into the undo step of the text that was just committed (when it is the newest)
		const mergeKey = this.lastTextKey?.id === id ? this.lastTextKey.key : null
		this.guard(() => this.commit(actions.remeasure(this.model, id, h), { urgent: true, mergeKey }))
	}

	/** @return {string|null} the lease key announced as me.e (and me.ec, job 173): open editor, else the lease tail */
	announcedEdit() {
		return this.editKey() ?? this.leaseTail
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} something of id still has to reach the server: an op not
	 *   acknowledged yet (queued or in flight), or text waiting for the take-over
	 */
	hasPendingText(id) {
		// job 173: id may be the lease key of a cell; any pending op of its table counts
		const [item] = leaseParts(id)
		const st = this.takeoverText
		return (st !== null && leaseKey(st.id, st.cell) === id) || this.replica.pendingOps().ops.some((op) => op.id === item)
	}

	/**
	 * A take-over is moot once me.e no longer names its item (the editor moved
	 * on, or closed with nothing left to save). Text that was rejected before
	 * the take-over landed then gets the ordinary rescue (§6.5).
	 */
	dropStaleTakeover() {
		if (this.takeoverId === null || this.takeoverId === this.announcedEdit()) {
			return
		}
		this.takeoverId = null
		const st = this.takeoverText
		this.takeoverText = null
		if (st) {
			// not inside the scene callback that got us here (rescue may open an editor)
			queueMicrotask(() => {
				if (!this.destroyed) {
					this.rescue(leaseKey(st.id, st.cell), st.text, 'locked')
				}
			})
		}
	}

	/**
	 * `me` reached the server. A delivered take-over is done; text that was
	 * rejected before it landed goes out again now, behind it.
	 *
	 * @param {object} me the presence that was sent
	 */
	onPresenceSent(me) {
		// job 173: the lease key names a cell too (me.ec)
		const sentKey = me && typeof me.e === 'string' ? leaseKey(me.e, me.ec) : null
		if (!me || me.tk !== 1 || sentKey !== this.takeoverId || this.takeoverId === null) {
			return
		}
		this.takeoverId = null
		const st = this.takeoverText
		this.takeoverText = null
		if (!st || leaseKey(st.id, st.cell) !== sentKey || this.hasNewerText(st.id, st.path) || this.frozen) {
			return
		}
		const ids = this.sync?.enqueue([{ o: 'patch', id: st.id, p: { [st.path]: st.text } }], { urgent: this.editKey() !== sentKey })
		this.flushVisible(ids)
	}

	/**
	 * New cursor: acked ops that the confirmed state now contains are done;
	 * the lease of a closed editor is released once its ops are through.
	 *
	 * @param {number} cursor confirmed rev
	 */
	onSettled(cursor) {
		this.flushVisible(this.replica.settle(cursor))
		if (this.leaseTail !== null && this.takeoverId !== this.leaseTail && !this.hasPendingText(this.leaseTail)) {
			this.leaseTail = null
			this.dropStaleTakeover()
		}
	}

	/**
	 * @param {Record<string, object>} map presence of the others
	 */
	onPresence(map) {
		this.presence.update(map, this.now())
		this.scene?.presenceChanged()
		// job 171: someone pointing keeps the fast cadence like a drag (view-only devices stay at viewMs)
		this.sync?.setRemoteDragging(this.presence.hasDragging() || this.presence.hasLaser())
		this.emitParticipants()
		// SPEC-M1 §6.5.6: every presence card moves a follower's camera
		this.follower?.onPresence()
		const key = this.editKey()
		// While a take-over (me.tk) has not reached the server, answers to older
		// requests still name the previous holder: no verdict yet. (job 173) Per cell.
		if (key !== null && !this.leaseLost.has(key) && this.takeoverId !== key) {
			const holder = this.presence.leaseHolder(this.editingId, this.editingCell)
			if (holder && holder.pid !== this.me?.pid) {
				this.loseLease(key, this.noticeFor(key, 'locked'))
			}
		}
	}

	/**
	 * @param {string} s sync status
	 * @param {string|null} [reason] detail of a final status ('rate_limited' with 'revoked' after a re-join
	 *   answered by an app 429)
	 */
	onStatus(s, reason = null) {
		this.status = s
		this.statusReason = typeof reason === 'string' ? reason : null
		if (s === 'gone' && this.me?.source === GONE_VIA_LINK) {
			// SPEC-M1 §4.2 (R2): the access through a link ended (status stays gone)
			this.statusReason = GONE_VIA_LINK
		}
		if (FROZEN_STATUSES.includes(s)) {
			if (s === PASSWORD_REQUIRED && this.editingId !== null && !this.frozen) {
				// The guest view is handed over to PublicApp: catch the text typed
				// since the last commit now, before the notice stops every flush.
				// SPEC-M1 §4.2, §6.4: the open editor's text goes to the rescue
				// even when its last commit reached the server (E29: the guest
				// only sees the editor vanish); then the model holds it.
				this.frozenText = this.openEditorText()
			}
			this.frozen = true
			this.closeMenu()
			this.closeStepper()
			// job 172: no reacting on a frozen board; names and the list stay, without action
			this.closeReactionPicker()
			this.pushReactions()
			this.emitReactionPopup()
			// job 139: the name fields end, a typed name is lost (nothing can be sent)
			this.endSortLabels({ save: false })
			// job 189: no "New comment" pick on a frozen board; reading stays
			this.cancelCommentPick()
			this.emitComments()
			this.scene?.setViewOnly(true)
			if (this.editingId !== null) {
				this.loseLease(this.editKey(), this.noticeFor(this.editKey(), s))
			}
			const st = this.takeoverText
			this.takeoverText = null
			this.takeoverId = null
			if (st) {
				// rejected before the take-over landed and never sent again: copy dialog
				this.ui.onRescue?.({ id: st.id, text: st.text, gone: false })
			}
		}
		if (s === 'reload') {
			this.reloadOnce(this.sync?.serverProto ?? this.serverProto ?? UNKNOWN_PROTO)
		}
		this.ui.onStatus?.(s, this.statusReason)
	}

	/**
	 * 409 protocol (or a snapshot/join answer with another protocol): reload
	 * once per server version (SPEC-M1 §4.3, sessionStorage marker = that
	 * version, util/reload.js claimReload), past every cache (U15). The same
	 * jump reloads once and then stays frozen; a second jump reloads again.
	 * Never while text is at stake: an open editor (now with its rescue
	 * notice) or unsent ops would vanish without a word; the board is frozen
	 * and the banner offers the reload instead.
	 *
	 * @param {number|string} version server protocol ('?' when unknown)
	 */
	reloadOnce(version) {
		if (this.editingId !== null || this.replica.pendingCount() > 0 || this.takeoverText !== null) {
			return
		}
		if (!claimReload(this.storage, version)) {
			return
		}
		// R22 (P7-07): the own reload must not hang on the leave question
		this.selfReload = true
		hardReload(this.win).catch(() => {
			// the banner stays
			this.selfReload = false
		})
	}

	/**
	 * Resync (§4.10.3): new snapshot, keep own pending ops, rebuild model and scene.
	 *
	 * @return {Promise<number>} new cursor
	 */
	async resync() {
		this.counters.resyncs++
		const t0 = this.now()
		const snap = await this.transport.snapshot()
		if (snap?.proto !== PROTOCOL) {
			// SPEC-M1 §4.3: the sync loop handles it as a 409 (serverProto from the body)
			throw new HttpError(409, 'protocol', 'Protocol mismatch', null, true, { error: 'protocol', proto: protoValue(snap?.proto) })
		}
		this.clock.sample({ now: snap.now, t0, t1: this.now() })
		this.replica.loadSnapshot(Array.isArray(snap.items) ? snap.items : [], snap.rev)
		const items = []
		const seen = new Set()
		for (const id of this.replica.allIds()) {
			seen.add(id)
			if (this.scene?.isActive(id) && this.model.has(id)) {
				items.push(structuredClone(this.model.get(id)))
				this.deferred.add(id)
				continue
			}
			const v = this.replica.visible(id)
			if (v) {
				items.push(v)
			}
		}
		// An active item the replica no longer knows (deleted remotely, nothing
		// pending for it) stays until the activity ends (T17): its editor is
		// still open, and the final text must become a patch that comes back
		// 'gone' and reaches the text rescue instead of vanishing.
		if (this.scene) {
			for (const id of [...this.model.ids()]) {
				if (!seen.has(id) && this.scene.isActive(id)) {
					items.push(structuredClone(this.model.get(id)))
					this.deferred.add(id)
				}
			}
		}
		// job 190: the number of offered locked items follows the reloaded model too
		const offered = this.lockedOfferIds().length
		this.model.load(items)
		this.scene?.reset()
		// R17 K4: the reloaded model refreshes the vote list too
		this.voteItemsChanged()
		const rest = this.selection.filter((id) => this.model.has(id))
		if (rest.length !== this.selection.length) {
			this.selection = rest
			this.scene?.setSelection(rest)
			this.emitSelection()
		} else if (this.lockedOfferIds().length !== offered) {
			this.emitSelection()
		}
		this.checkMenu()
		this.emitEmpty()
		if (snap.board) {
			// the snapshot is authoritative (also a lower metaRev after a restore)
			this.takeBoard(snap)
			this.emitBoard()
		} else if (typeof snap.epoch === 'string' && snap.epoch !== '') {
			this.epoch = snap.epoch
		}
		if (snap.me && typeof snap.me === 'object') {
			// stage 2: the role may have changed meanwhile (same path as onRole)
			const { role, mod, ...rest } = snap.me
			this.me = { ...(this.me ?? {}), ...rest }
			if (!this.applyRole(role, mod === true) && this.board && typeof role === 'string') {
				this.board = { ...this.board, role }
				this.emitBoard()
			}
		}
		if (snap.board) {
			// stage 3: vote session and summon of the snapshot, with its votes block
			this.applyMeta({ votes: snap.votes ?? null })
		}
		return snap.rev
	}

	// ---- presence and ui -------------------------------------------------

	/**
	 * Own presence (me, SPEC-M1 §4.5, §6.4): only in mode edit and not while
	 * the vote panel is open during a session; in mode edit with v (stage 3).
	 * The presenting tab (meta.summon = my pid and this client) sends {v} in
	 * every other state (mode vote or view, also on a view-only device, open
	 * vote panel), so its followers keep their target (R16 SRV-05).
	 *
	 * @return {object|null} me, or null: nothing to send
	 */
	/**
	 * (R22, P7-09) Presence of a hidden tab: only the presenting tab sends
	 * {v} (the viewport its followers see), so "Bring everyone here" does not
	 * fall apart while the presenter shows slides in another tab.
	 *
	 * @return {{v: number[]}|null}
	 */
	getHiddenPresence() {
		if (this.frozen || !this.isPresenting()) {
			return null
		}
		const v = this.viewV()
		return v ? { v } : null
	}

	getPresence() {
		if (this.frozen) {
			return null
		}
		if (this.clientMode !== 'edit' || (this.votePanelOpen && this.voteState.open)) {
			if (!this.isPresenting()) {
				return null
			}
			const v = this.viewV()
			return v ? { v } : null
		}
		const announced = this.announcedEdit()
		// job 173: the lease key of a cell is e plus ec; job 199: the name of a lane has no lease (job 208: nor a column's)
		const parts = announced === null ? [null, null] : leaseParts(announced)
		// job 225: nor a group's
		const [e, ec] = typeof parts[1] === 'string' && [LANE_KEY_RE, COL_KEY_RE, LGROUP_KEY_RE, CGROUP_KEY_RE].some((re) => re.test(parts[1])) ? [null, null] : parts
		const me = {
			c: this.pointer ? [r1(this.pointer[0]), r1(this.pointer[1])] : null,
			s: this.selection.slice(0, PRESENCE_IDS),
			d: this.dragPreview.slice(0, PRESENCE_IDS).map((d) => [d[0], r1(d[1]), r1(d[2])]),
			e,
		}
		if (ec !== null) {
			me.ec = ec
		}
		if (this.takeoverId !== null && announced === this.takeoverId) {
			me.tk = 1
		}
		const v = this.viewV()
		if (v) {
			me.v = v
		}
		// job 171: the laser trail of the last LASER_WINDOW_MS (only in this full me)
		const l = this.laserWire()
		if (l) {
			me.l = l
		}
		return me
	}

	/** @param {{x: number, y: number, scale: number}} c live camera */
	onCamera(c) {
		if (c && Number.isFinite(c.scale)) {
			this.ui.onZoom?.(Math.round(c.scale * 100))
		}
		// job 272: the cover around the shown slide follows the camera
		this.emitSlideRect(c)
		// R22 (P7-08): the stepper never moves the camera; any other camera
		// change (wheel, trackpad, zoom keys, a follow jump, fit, zoomToItem)
		// leaves it over another item: close it
		if (this.stepper !== null && cameraMoved(this.stepper.cam, c)) {
			this.closeStepper()
		}
		// job 172: so do the reaction picker, the names and the list
		if (this.reactPicker !== null && cameraMoved(this.reactPicker.cam, c)) {
			this.closeReactionPicker()
		}
		if (this.reactPopup !== null && cameraMoved(this.reactPopup.cam, c)) {
			this.closeReactionPopup()
		}
		// job 191: and the list of a note's tags
		if (this.tagPanel?.kind === 'list' && cameraMoved(this.tagPanel.cam, c)) {
			this.closeTagPanel({ focus: false })
		}
		// presence v: an own camera change goes out soon (not while following someone)
		const now = this.now()
		if (!this.follower?.target && (this.clientMode === 'edit' || this.isPresenting()) && now - this.camPokeAt >= CAMERA_POKE_MS) {
			this.camPokeAt = now
			this.sync?.poke()
		}
		if (this.camTimer !== null) {
			return
		}
		this.camTimer = setTimeout(() => {
			this.camTimer = null
			this.saveCamera()
		}, CAMERA_SAVE_MS)
	}

	saveCamera() {
		const c = this.scene?.getCamera()
		if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.scale)) {
			this.storage.setJson('local', keys.camera(this.storageId()), { x: c.x, y: c.y, scale: c.scale })
		}
	}

	emitSelection() {
		this.checkMenu()
		this.selectionReports++
		this.ui.onSelection?.(this.selectionInfo())
		// job 191: the tag panel works on the selection
		this.checkTags()
	}

	/**
	 * Selection v2 for the shell (SPEC-M1 §6.5.1): {ids, count, types (Set),
	 * fill, stroke, strokeWidth, dash, fontSize, align, kind, route, startCap,
	 * endCap (+ fillOpacity, textColor, color, valign), hasContainer,
	 * canConnect, alignable, box}. A value is the common display value (registry
	 * fieldValue, rule 18) of every selected item, null when they differ or a
	 * type lacks the field; `mixed` lists the fields whose values differ;
	 * `fields` is the intersection of the types' field paths (what the
	 * context bar may show); box = selectionFrame (one item: its box and r);
	 * alignable = how many items "Align" would move (actions.alignableIds);
	 * "Distribute" moves the same items, from three on, "Tidy up" from two.
	 * M2 (R20): types, fields, mixed, the values, hasContainer, rotatable,
	 * alignable and box describe the UNLOCKED selected items only; ids,
	 * count and canConnect the whole selection; locked, unlocked, lockable,
	 * unlockable, lockedBy, unlockBy come from model/locks.js lockSummary
	 * (lockable and unlockable 0 while the session cannot write).
	 * M2 (R20 Gruppieren): alignable counts blocks (a fully selected group
	 * is one; no member of a group with a locked member); groupable,
	 * groupBlock, grouped, ungroupBlock and oneGroup come from
	 * model/groups.js groupSummary over the whole selection (0, null, false
	 * while the session cannot write).
	 * Job 135 (colour picker): fills = the distinct fill values (fieldValue)
	 * of the unlocked selected items in selection order, at most two (the
	 * split fill button of a mixed selection); boardColors = the custom
	 * colours of the whole board (contextbar.js boardColors over every model
	 * item, locked ones too), computed again for every report, so a colour
	 * just set or set by someone else shows from the next report on.
	 * Job 139: sortable = the loose notes of the selection "Sort by color"
	 * moves, frameSortable = the notes in the one selected frame (both
	 * actions.sortableNotes; 0 while the session cannot write).
	 * Job 144: kinds = [{kind, count}] of "Filter selection" over the whole
	 * selection, locked items too (model/groups.js filterKinds; [] while it
	 * is not filterable or the session cannot write).
	 * Job 153: swappable = the unlocked selected connectors whose tips differ
	 * (actions.swappableIds: what "Swap direction" changes; 0 while the
	 * session cannot write).
	 * Job 172: reactable = exactly one note is selected (locked too), the
	 * client mode is edit and this person may react (mayReact).
	 * Job 190: lockedOffer = how many offered locked items still exist and
	 * are locked (lockedOfferIds; 0 without an offer and outside mode edit).
	 * Job 211: labelled = every unlocked selected item is a symbol, BPMN
	 * event, gateway or (job 235) own shape (shapes.js hasLabel: its text is a
	 * label below it).
	 * Job 240: square = the tick "1:1" of "Arrange" (model/shapes.js squareOn)
	 * when exactly one unlocked shape is selected, else null.
	 * Job 227: fills and the colour fields carry the colour an item is drawn
	 * in (shownField: an old palette colour as its new tone), so the bar marks
	 * the new swatch and an old and a new Light blue count as one colour.
	 *
	 * @return {object}
	 */
	selectionInfo() {
		const all = this.selection.filter((id) => this.model?.has(id)).map((id) => this.model.get(id))
		const items = all.filter((it) => !isLocked(it))
		const types = new Set(items.map((it) => it.t))
		let fields = null
		for (const t of types) {
			const own = Object.keys(typeInfo(t).fields)
			fields = fields === null ? own : fields.filter((p) => own.includes(p))
		}
		const writable = !this.viewOnly && !this.frozen
		const locks = lockSummary(all, this.me, { writable })
		const groups = groupSummary(this.model, all.map((it) => it.id), { writable })
		const out = {
			ids: [...this.selection],
			count: all.length,
			types,
			fields: fields ?? [],
			mixed: [],
			hasContainer: items.some((it) => typeInfo(it.t).container),
			canConnect: all.length === 2 && all[0].id !== all[1].id && all.every((it) => isBindable(it.t)),
			rotatable: items.length > 0 && items.every((it) => typeInfo(it.t).rotatable),
			alignable: this.model ? actions.alignableIds(this.model, items.map((it) => it.id)).length : 0,
			box: null,
			locked: locks.locked,
			unlocked: locks.unlocked,
			lockable: locks.lockable,
			unlockable: locks.unlockable,
			lockedBy: locks.lockedBy,
			unlockBy: locks.unlockBy,
			groupable: groups.groupable,
			groupBlock: groups.groupBlock,
			grouped: groups.grouped,
			ungroupBlock: groups.ungroupBlock,
			oneGroup: groups.oneGroup,
			// job 278: "Frame around" (shown while frameable; frameBlock: why it is greyed)
			frameable: false,
			frameBlock: null,
			fills: [],
			boardColors: this.model ? boardColors(modelItems(this.model)) : [],
			sortable: 0,
			frameSortable: 0,
			kinds: [],
			// job 230: the tags of the selected notes with their counts (the chip's "Narrow selection")
			tags: [],
			swappable: 0,
			// job 172: the bar's and the menu's "Add reaction": exactly one note, in mode edit
			reactable: all.length === 1 && all[0].t === 'sticky' && this.clientMode === 'edit' && this.mayReact(),
			// job 279: the links of the one selected item ("Open link") and an open editor with Markdown (B, I, S, list)
			links: all.length === 1 ? itemLinks(all[0]) : [],
			richEditing: this.richEditing(),
			// job 189: the bar's and the menu's "Comment": exactly one item of the five types, in mode edit
			commentable: this.clientMode === 'edit' && this.mayComment() && commentableIds(all.map((it) => it.id), (id) => this.model?.get(id) ?? null),
			// job 191: the bar's and the menu's "Tags": the unlocked selected notes, in mode edit
			taggable: this.clientMode === 'edit' && this.mayTag() ? items.filter((it) => it.t === 'sticky').length : 0,
			// job 190: the bar's "Select n locked items"
			lockedOffer: this.lockedOfferIds().length,
			// job 195: the one selected mind map and its focused node (the bar's sections mm-node and mm-layout)
			mindmap: this.selectedMindmap(all),
			// job 211: only labels below their shapes (the bar has no text alignment for them)
			labelled: items.length > 0 && items.every((it) => it.t === 'shape' && hasLabel(fieldValue(it, 'data.kind'))),
			// job 260: only basic and flowchart shapes (the bar's border palette with "Default" instead of Black)
			redesigned: items.length > 0 && items.every((it) => it.t === 'shape' && REDESIGN_KINDS.includes(fieldValue(it, 'data.kind'))),
			// job 240: the tick "1:1" of "Arrange"
			square: all.length === 1 && items.length === 1 && items[0].t === 'shape' ? squareOn(items[0]) : null,
			// job 267: the bar's "Summarise" and "Cluster by topic"
			ai: this.ai.offer(all),
		}
		if (writable && this.model && all.length > 0) {
			const fp = frameAroundPlan(this.model, all.map((it) => it.id))
			out.frameable = fp.box !== null
			out.frameBlock = fp.box !== null ? fp.blocked : null
		}
		if (writable && this.model) {
			out.kinds = filterKinds(this.model, all.map((it) => it.id))
			out.tags = selectionTags(all, this.boardTags()).map((tg) => ({ ...tg, color: shownColor(tg.color) }))
			out.sortable = actions.sortableNotes(this.model, all.map((it) => it.id)).length
			out.swappable = actions.swappableIds(this.model, items.map((it) => it.id)).length
			if (all.length === 1 && all[0].t === 'frame') {
				out.frameSortable = actions.sortableNotes(this.model, [], { frame: all[0].id }).length
			}
		}
		for (const it of items) {
			const v = fieldRule(it.t, 'style.fill') === null ? null : shownField(it, 'style.fill')
			if (typeof v === 'string' && !out.fills.includes(v)) {
				out.fills.push(v)
				if (out.fills.length === 2) {
					break
				}
			}
		}
		for (const [key, path] of Object.entries(SELECTION_FIELDS)) {
			let value
			let mixed = false
			for (const it of items) {
				if (fieldRule(it.t, path) === null) {
					value = null
					break
				}
				const v = shownField(it, path)
				if (value === undefined) {
					value = v
				} else if (JSON.stringify(value) !== JSON.stringify(v)) {
					mixed = true
				}
			}
			out[key] = mixed || value === undefined ? null : value
			if (mixed) {
				out.mixed.push(path)
			}
		}
		if (items.length > 0) {
			try {
				const f = selectionFrame(this.model, items.map((it) => it.id))
				out.box = f ? { x: f.x, y: f.y, w: f.w, h: f.h, r: f.r ?? 0 } : null
			} catch (e) {
				out.box = null
			}
		}
		return out
	}

	/**
	 * (Job 195) The mind map of selection v2: exactly one selected mind map,
	 * {id, layout, locked, node: {key, root, color (its own c or null), shape,
	 * kids, folded}|null (the focus)}, else null.
	 *
	 * @param {object[]} all the selected items
	 * @return {object|null}
	 */
	selectedMindmap(all) {
		if (all.length !== 1 || all[0].t !== 'mindmap') {
			return null
		}
		const it = all[0]
		const tree = mindTree(it)
		const key = this.mmFocus !== null && this.mmFocus.id === it.id ? this.mmFocus.key : null
		const e = key !== null ? tree.nodes.get(key) : null
		return {
			id: it.id,
			layout: tree.layout,
			locked: isLocked(it),
			node: e ? { key, root: e.parent === null, color: typeof e.n.c === 'string' ? shownColor(e.n.c) : null, shape: drawnShape(e.n, e.parent === null, tree.layout, e.depth), kids: e.kids.length, folded: e.n.f === true } : null,
		}
	}

	emitUndo() {
		this.ui.onUndoState?.({ canUndo: this.undoStack.canUndo(), canRedo: this.undoStack.canRedo() })
	}

	emitParticipants() {
		const list = []
		if (this.me) {
			list.push({ pid: this.me.pid, name: this.me.name, color: colorFor(this.me.pid), guest: !!this.me.guest, self: true })
		}
		for (const p of this.presence.participants()) {
			if (p.pid !== this.me?.pid) {
				list.push({ ...p, self: false })
			}
		}
		this.ui.onParticipants?.(list)
	}

	// ---- lifecycle -------------------------------------------------------

	/**
	 * Commits the open editor's text that is not emitted yet as an
	 * intermediate intent (§6.3 flushEditor, T5): it passes synchronously
	 * through onIntent into the replica. Never closes the editor.
	 *
	 * @return {boolean} an intent was emitted
	 */
	flushEditor() {
		if (!this.scene || typeof this.scene.flushEditor !== 'function') {
			return false
		}
		try {
			return this.scene.flushEditor() === true
		} catch (e) {
			console.error('[knorke] flushEditor failed', e)
			return false
		}
	}

	/**
	 * Texts that would be lost when this (frozen) board view goes away – the
	 * guest hand-over to PublicApp after 'password_required' (SPEC-M1 §4.2,
	 * §6.4: "Text in einem offenen Editor geht vorher in die Textrettung"):
	 * the open editor's text (caught when the board froze, see onStatus:
	 * always, even when its last commit reached the server – the guest only
	 * sees the editor vanish) and the newest text of every text op that never
	 * reached the server. Other texts equal to the server state are left out.
	 *
	 * @return {Array<{id: string, text: string, gone: boolean}>} for the copy dialog (addRescue)
	 */
	unsentTexts() {
		const byId = new Map()
		const confirmedText = (id, path) => {
			const c = this.replica.confirmed.get(id)
			return c ? getPath(c, path) : undefined
		}
		const consider = (id, path, text) => {
			if (typeof id === 'string' && typeof text === 'string' && text !== '' && confirmedText(id, path) !== text) {
				// job 173: one text per cell of a table
				byId.set(leaseKey(id, subOfPath(path)), text)
			}
		}
		for (const op of this.replica.pendingOps().ops) {
			if (op.o === 'put') {
				const path = textPathOf(op.t)
				consider(op.id, path, path ? getPath(op.p ?? {}, path) : undefined)
			} else if (op.o === 'patch' && op.p) {
				for (const path of this.textPathsIn(op)) {
					if (Object.prototype.hasOwnProperty.call(op.p, path)) {
						consider(op.id, path, op.p[path])
					}
				}
			}
		}
		if (this.takeoverText) {
			consider(this.takeoverText.id, this.takeoverText.path, this.takeoverText.text)
		}
		const caught = this.frozenText.length > 0 ? this.frozenText : this.openEditorText()
		for (const i of caught) {
			if (i.open === true) {
				// the open editor's text: always (§4.2, §6.4), also when it reached the server
				if (typeof i.id === 'string' && typeof i.value === 'string' && i.value !== '') {
					byId.set(leaseKey(i.id, i.cell), i.value)
				}
			} else {
				consider(i.id, typeof i.path === 'string' ? i.path : 'data.text', i.value)
			}
		}
		return [...byId].map(([key, text]) => {
			const [id] = leaseParts(key)
			return { id, text, gone: !this.model?.has(id) }
		})
	}

	/**
	 * The open editor's current text for the rescue (SPEC-M1 §4.2, §6.4):
	 * the text not emitted yet (captureEditor), else the item's text with the
	 * own commits (Replica.visible; its last commit). Marked open: unsentTexts() keeps it even when
	 * it equals the server state.
	 *
	 * @return {object[]} at most one text intent {id, path, value, open: true}
	 */
	openEditorText() {
		const id = this.editingId
		if (id === null) {
			return []
		}
		const caught = this.captureEditor()
		if (caught.length > 0) {
			return caught.map((i) => ({ ...i, open: true }))
		}
		// the replica's visible state has the own commits (the model defers an item being edited)
		const item = this.replica.visible(id) ?? (this.model?.has(id) ? this.model.get(id) : null)
		// job 173: the open cell of a table
		const cell = this.editingCell
		const path = item ? (cell !== null ? subPath(cell) : textPathOf(item.t)) : null
		const value = path ? getPath(item, path) : undefined
		if (typeof value !== 'string' || value === '') {
			return []
		}
		return [cell !== null ? { type: 'text', id, path, value, cell, open: true } : { type: 'text', id, path, value, open: true }]
	}

	/**
	 * The open editor's text that was not emitted yet, caught instead of
	 * committed (scene.flushEditor emits it synchronously; under a notice the
	 * scene emits nothing).
	 *
	 * @return {object[]} the caught text intents (at most one)
	 */
	captureEditor() {
		if (!this.scene || this.editingId === null || typeof this.scene.flushEditor !== 'function') {
			return []
		}
		this.capture = []
		try {
			this.scene.flushEditor()
		} catch (e) {
			console.error('[knorke] flushEditor failed', e)
		}
		const caught = this.capture
		this.capture = null
		return caught
	}

	/**
	 * Before an in-app navigation away from this board (T3): commits the open
	 * editor, then waits up to timeoutMs for every pending op to be
	 * acknowledged. The session itself stays as it is; destroy() follows when
	 * the navigation happens.
	 *
	 * @param {{timeoutMs?: number}} [o] options
	 * @return {Promise<boolean>} true: nothing would be lost by leaving; false:
	 *   ops are still pending (offline, failing, or too slow): ask the user
	 */
	async prepareLeave({ timeoutMs = 3000 } = {}) {
		if (this.destroyed || !this.sync) {
			return true
		}
		// job 139: typed names of the name fields are saved before the wait
		this.endSortLabels()
		this.flushEditor()
		const settled = () => this.destroyed || this.frozen || this.sync.finalStatus !== null
			|| (this.replica.pendingCount() === 0 && this.takeoverText === null)
		if (settled()) {
			return true
		}
		const offline = () => this.status === 'offline' || this.win?.navigator?.onLine === false
		if (offline()) {
			return false
		}
		this.sync.forceTick()
		const start = this.now()
		for (;;) {
			const left = timeoutMs - (this.now() - start)
			if (left <= 0) {
				return settled()
			}
			await this.sleep(Math.min(LEAVE_POLL_MS, left))
			if (settled()) {
				return true
			}
			if (offline()) {
				return false
			}
		}
	}

	addListeners() {
		const win = this.win
		if (!win || typeof win.addEventListener !== 'function') {
			return
		}
		const doc = win.document
		const on = (target, type, fn) => {
			target.addEventListener(type, fn)
			this.listeners.push(() => target.removeEventListener(type, fn))
		}
		if (doc) {
			// SPEC-M1 §6.5.6: Esc ends following (the scene needs nothing for it),
			// (R22, P7-09) everywhere except in input fields (§6.10). The key's
			// target counts too: a field's own Esc handler (the title field, the
			// Nextcloud search) may have removed the field before this bubble
			// listener runs (a microtask checkpoint between listeners).
			on(doc, 'keydown', (e) => {
				if (e?.key === 'Escape' && this.follower?.target && !isInputElement(e.target) && !inputFocused(doc)) {
					this.follower.onEsc()
				}
			})
			on(doc, 'visibilitychange', () => {
				const hidden = doc.visibilityState === 'hidden'
				if (hidden) {
					// the open editor's latest text first, so the keepalive carries it (T5)
					this.flushEditor()
				}
				this.sync?.setHidden(hidden)
				if (hidden) {
					this.sync?.flushKeepalive()
					this.saveCamera()
				}
			})
		}
		on(win, 'pagehide', () => {
			// job 139: typed names of the name fields go with the keepalive
			this.endSortLabels()
			this.flushEditor()
			this.sync?.flushKeepalive()
			this.saveCamera()
		})
		on(win, 'online', () => {
			this.sync?.retryNow()
			this.sync?.poke()
		})
		on(win, 'beforeunload', (e) => {
			// A reload or close fires no blur: without this, the text typed since
			// the last 1 Hz commit would be gone without a prompt (T5).
			this.flushEditor()
			// (R22, P7-07) also when frozen: pending ops would be gone without a
			// word; only the session's own reload after status 'reload' goes quietly
			if (this.replica.pendingCount() > 0 && !this.selfReload) {
				e.preventDefault()
				e.returnValue = ''
			}
		})
	}

	/**
	 * Ends the session. Order matters: the scene goes FIRST, because ending it
	 * commits an open text editor as a final 'text' intent (§6.3); that op
	 * must be in the replica before the keepalive flush sends what is pending,
	 * and the loop stops only after that.
	 */
	destroy() {
		if (this.destroyed) {
			return
		}
		// job 139: typed names first, while the session can still commit them
		this.endSortLabels()
		this.destroyed = true
		this.menu = null
		this.comments.close()
		this.ai.destroy()
		this.autoEnd?.ctl?.abort()
		this.autoEnd = null
		this.follower?.destroy()
		if (this.catcherTimer !== null) {
			clearTimeout(this.catcherTimer)
			this.catcherTimer = null
		}
		try {
			this.detachCatcher?.()
		} catch (e) {
			// already gone
		}
		this.detachCatcher = null
		if (this.camTimer !== null) {
			clearTimeout(this.camTimer)
			this.camTimer = null
			this.saveCamera()
		}
		try {
			this.scene?.destroy()
		} catch (e) {
			console.error('[knorke] scene.destroy failed', e)
		}
		try {
			this.sync?.flushKeepalive()
		} catch (e) {
			// best effort
		}
		this.sync?.stop()
		for (const off of this.listeners) {
			off()
		}
		this.listeners = []
		try {
			this.channel?.close()
		} catch (e) {
			// already closed
		}
		this.channel = null
		try {
			this.uninstallDebug?.()
		} catch (e) {
			// ignore
		}
		this.scene = null
	}
}
