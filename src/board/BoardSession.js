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
 * - Shell commands: setToolOptions, setStyle, setShapeKind, arrange, nudge,
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
 *   or copy dialog). editLabel() opens the editor from the context bar.
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
 * - Vote ops {o:'vote', s, id, n} go through enqueue (urgent only on
 *   devices with a fine pointer: tablets ride the 2-s tick), never into the
 *   undo stack. A tap in mode vote toggles (perItem 1) or opens the stepper
 *   (ui.onStepper); voteMiss explains why (at most every 3 s). Toasts carry
 *   [data-knorke-toast=vote-miss|vote-limit|vote-closed].
 * - vt (moderators only, open session only, at most every VT_EVERY_MS;
 *   R16 SRV-01). A moderator's tab ends the session itself at endsAt (the
 *   only automatic call of routes 22–26; 409 is swallowed).
 * - The scene gets SceneVoteState (§6.3): votable(id) over the model (a
 *   real boolean), badges(), markVotable in mode vote, color = colorFor(me.pid).
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
 *   grid, gridSnap, unlockAll, unlockFrame, unlockBy, unlockByName}) or
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
 *   quicker) the toast unlock-none. Undo locks them again in me's name. The
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
 *   sendHistory() with the toast lock-undo (the step still moves to the
 *   other stack). So no derived client patch reaches a locked item (a
 *   released child, a released connector end, a membership patch); the
 *   server does those itself.
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
 */
import { GONE_VIA_LINK, roleToastText } from '../components/banner.js'
import { SELECTION_FIELDS, groupHintText } from '../components/contextbar.js'
import { groupSummary, movableIds } from '../model/groups.js'
import { clientId } from '../model/ids.js'
import { isLocked, lockSummary, mayUnlock } from '../model/locks.js'
import { getPath, itemKey } from '../model/paths.js'
import { q } from '../model/geometry.js'
import { allTextPaths, fieldDefault, fieldRule, fieldValue, isBindable, textPathOf, typeInfo } from '../model/registry.js'
import { selectionFrame } from '../model/transform.js'
import { HttpError, isPasswordLock, isProxyBlock, isProxyRetry, isSlowDown, slowDownDelay } from '../sync/http.js'
import { colorFor, PresenceModel } from '../sync/presence.js'
import { PROTOCOL } from '../sync/protocol.js'
import { BUSY, Replica, isLockPatch } from '../sync/Replica.js'
import { INTERVALS, nextDelay } from '../sync/scheduler.js'
import { ACCESS_LEVELS, LINKS_DISABLED, LINK_EXPIRED, PASSWORD_REQUIRED, RATE_LIMITED, SERVER_ERROR, SyncClient, UNKNOWN_PROTO, defaultSleep, protoValue } from '../sync/SyncClient.js'
import { guestTransport, newCounters, userTransport } from '../sync/transport.js'
import { isApplePlatform } from '../util/device.js'
import { n, t } from '../util/l10n.js'
import { claimReload, hardReload } from '../util/reload.js'
import { keys, webStorage } from '../util/storage.js'
import { showError, showInfo } from '../util/toast.js'
import * as boardsApi from '../api/boards.js'
import * as actions from './actions.js'
import { attachPasteCatcher, clipAttrOf, clipboardItemsData, clipboardReader, decodeClipAttr, encodeClip, hasDomSelection, inputFocused, isInputElement, readStoredClip, storeClip, validatePayload, writeClipboard } from './clipboard.js'
import { Clock } from './clock.js'
import { FollowController, summonOf } from './follow.js'
import { ROLES, accessOf, canEdit, canVote, modeFor, roleToastFor } from './mode.js'
import { UndoStack } from './undo.js'
import { VoteState } from './votes.js'

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
export const KNOWN_CODES = Object.freeze(['ok', 'dup', 'gone', 'bad', 'denied', 'limit', 'locked', 'closed', 'itemlocked', BUSY, SERVER_ERROR])
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
/** The board's area for the tablet camera and "zoom to" keeps this margin (screen px). */
export const ZOOM_PAD_PX = 40
/** Clock skew changes below this are not reported to the shell. */
const SKEW_REPORT_MS = 100

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
export const META_STALE_CODES = Object.freeze(['vote_open', 'vote_closed', 'timer_state', 'meta_too_large'])

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
 * @param {number} v number
 * @return {number} rounded to 0.1 (presence coordinates)
 */
function r1(v) {
	return Math.round(v * 10) / 10
}

/**
 * `meta` of a board block as a map (SPEC-M1 §3.11). The wire form of an
 * empty map is {} (§15 R4); an empty JSON list is what PHP's json_encode
 * makes of an empty array, so it counts as {} as well. Anything else that is
 * not a plain object (a non-empty list, a scalar, null) is no meta.
 *
 * @param {unknown} v `meta` of the block
 * @return {object|null} the map, or null: no usable meta in the block
 */
function metaMapOf(v) {
	if (Array.isArray(v)) {
		return v.length === 0 ? {} : null
	}
	return v !== null && typeof v === 'object' ? v : null
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
	constructor({ container, mode = 'user', boardId = null, linkToken = null, viewOnly = false, debug = false, limits = null, pasteCatcher = null, ui = {}, deps = {} }) {
		this.container = container
		this.mode = mode === 'guest' ? 'guest' : 'user'
		this.boardId = boardId
		this.linkToken = linkToken
		/** The device has no fine pointer (util/device.js); fixed for the session. */
		this.deviceViewOnly = !!viewOnly
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

		this.counters = newCounters()
		this.replica = new Replica()
		this.presence = new PresenceModel({ now: this.now })
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
		this.pointer = null
		this.dragPreview = []
		this.editingId = null
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
		/** The vote panel is open (presence pauses while a session is open, §6.4). */
		this.votePanelOpen = false
		/** (R17 K4) A ui.onVotes for a model change is queued (one per tick). */
		this.voteItemsQueued = false
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
			callbacks: this.sceneCallbacks(),
			limits: this.limits,
		})
		this.scene.mount()
		this.focusCanvasOnOpen()
		const cam = this.storage.getJson('local', keys.camera(this.storageId()))
		if (cam && Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.scale) && cam.scale > 0) {
			this.scene.setCamera({ x: cam.x, y: cam.y, scale: cam.scale })
		} else {
			this.scene.fit()
		}
		this.scene.setRemoteSampler((nowMs) => this.presence.sample(nowMs))
		this.follower = new FollowController({
			scene: () => this.scene,
			presence: this.presence,
			now: this.now,
			sleep: this.sleep,
			self: () => ({ pid: this.me?.pid ?? null, client: this.client }),
			sessionOpen: () => this.voteState.open,
			onChange: (st) => this.emitFollow(st),
			onLeft: (name) => this.info(t('knorke', '{name} left.', { name })),
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
		if (this.pasteCatcher) {
			this.detachCatcher = attachPasteCatcher(this.pasteCatcher, (data) => this.onCatcherPaste(data))
		}
		this.emitBoard()
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
		if (meta !== null) {
			next.meta = meta
		}
		next.metaRev = board.metaRev
		this.metaRev = board.metaRev
		this.board = next
		this.emitBoard()
		if (meta !== null) {
			// stage 3: vote session, summon (SPEC-M1 §6.5.1 "an Shell, VoteState und FollowController")
			this.applyMeta()
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
		// a new role: a denial of the next ops is news again (toasted once)
		this.deniedShown = false
		const text = roleToastText(roleToastFor(before, this.accessLevel()))
		if (text !== null) {
			this.info(text)
		}
		this.updateMode()
		this.emitBoard()
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
		return modeFor(this.me?.role ?? null, this.deviceViewOnly, { sessionOpen: this.voteState.open, preferVote: this.preferVote })
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
		if (lostEdit && this.editingId !== null && !this.leaseLost.has(this.editingId)) {
			this.loseLease(this.editingId, this.noticeFor(this.editingId, 'denied'))
		}
		this.pushVoteState()
		this.ui.onMode?.(next)
		this.emitVotes()
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
	 * of the same answer; a foreign sid is dropped (R16 SRV-03).
	 *
	 * @param {object} votes `votes` block of a sync answer
	 */
	onVotes(votes) {
		const r = this.voteState.ack(null, votes, this.pendingVotes())
		if (r.taken) {
			this.pushVoteState()
			this.emitVotes()
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
		return {
			// the scene asks with an id; a real boolean (S-13)
			votable: (id) => v.votable(typeof id === 'string' && this.model?.has(id) ? this.model.get(id) : null),
			scope: v.scope,
			badges: v.badges(),
			markVotable: v.open && this.clientMode === 'vote',
			color: colorFor(this.me?.pid ?? ''),
		}
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
			canVote: canVote(this.me?.role),
			mode: this.clientMode,
			canSwitch: v.open && canEdit(this.me?.role) && !this.deviceViewOnly,
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
			return { sid: null, state: null, open: false, left: null, mine: {}, results: null, voters: null }
		}
		return {
			sid: v.sid,
			state: v.state,
			open: v.open,
			left: v.left,
			mine: { ...v.mine },
			results: v.state === 'closed' ? v.results : null,
			voters: this.me?.mod === true ? v.voters : null,
		}
	}

	/**
	 * Sets my votes on an item (SPEC-M1 §6.5.5): a vote op, not in the undo
	 * stack; tablets send it with the 2-s tick (not urgent). (R22, P7-10) Only
	 * the canvas tap of perItem = 1 passes tap: the vote list and the stepper
	 * are never taken for a double tap.
	 *
	 * @param {string} id item id
	 * @param {number} n my votes on it (0 = none)
	 * @param {{tap?: boolean}} [o] tap: the toggle tap on the canvas (double-tap lock)
	 * @return {boolean} proposed and queued
	 */
	vote(id, n, { tap = false } = {}) {
		if (this.frozen || !this.sync || !canVote(this.me?.role)) {
			return false
		}
		const r = this.voteState.propose(id, n, this.clock.now(), { tap })
		if (!r.ok) {
			if (r.reason === 'limit') {
				this.voteToast('vote-limit', t('knorke', 'You have no votes left.'))
			} else if (r.reason === 'closed') {
				this.voteToast('vote-closed', t('knorke', 'Voting has ended.'))
			}
			return false
		}
		this.sync.enqueue([{ o: 'vote', s: this.voteState.sid, id, n }], { urgent: !this.deviceViewOnly })
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
		if (this.frozen || this.destroyed || this.clientMode !== 'vote' || !canVote(this.me?.role) || !this.voteState.open || !item || !this.voteState.votable(item)) {
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
	 * item with ZOOM_PAD_PX around it (no 100 % limit). (R22, P7-11) With
	 * `left`/`right` (screen px a side panel covers at that edge of the
	 * canvas) the item lands centred in the visible rest (reserveRect).
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
		return this.zoomToRect(this.reserveRect(box, left, right))
	}

	/**
	 * (R22, P7-11) The world rectangle widened by the covered edges, so that
	 * cameraForRect(…, ZOOM_PAD_PX) puts `rect` centred into the visible part
	 * of the canvas at the scale it gets there: s is the fit of rect into the
	 * visible width (cameraForRect of rect stretched by (vw − 2·pad) / free,
	 * so the scene's scale limits apply as usual), then left/s and right/s
	 * world units are added at the two edges. Without a covered edge, without
	 * a measurable canvas or when nothing would stay free: rect itself.
	 *
	 * @param {{x: number, y: number, w: number, h: number}} rect world rectangle
	 * @param {number} left covered screen px at the left edge
	 * @param {number} right covered screen px at the right edge
	 * @return {{x: number, y: number, w: number, h: number}}
	 */
	reserveRect(rect, left = 0, right = 0) {
		const l = Number.isFinite(left) && left > 0 ? left : 0
		const r = Number.isFinite(right) && right > 0 ? right : 0
		const sc = this.scene
		if (l + r === 0 || !sc || typeof sc.cameraForRect !== 'function' || !(rect?.w > 0)) {
			return rect
		}
		const vp = sc.getViewport?.()
		const cam = sc.getCamera?.()
		const vw = vp && cam && Number.isFinite(vp.w) && cam.scale > 0 ? vp.w * cam.scale : 0
		const full = vw - 2 * ZOOM_PAD_PX
		const free = full - l - r
		if (!(free > 0)) {
			return rect
		}
		const s = sc.cameraForRect({ x: rect.x, y: rect.y, w: rect.w * full / free, h: rect.h }, ZOOM_PAD_PX)?.scale
		if (!(s > 0)) {
			return rect
		}
		return { x: rect.x - l / s, y: rect.y, w: rect.w + (l + r) / s, h: rect.h }
	}

	/**
	 * "Zoom to selection" (zoom controls, like Shift+2).
	 *
	 * @return {boolean} the camera moved
	 */
	zoomToSelection() {
		const ids = this.selection.filter((id) => this.model?.has(id))
		return ids.length > 0 && this.zoomToRect(this.boundsOf(ids))
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
	 * @return {boolean} the camera moved
	 */
	zoomToRect(rect) {
		const sc = this.scene
		if (!rect || !sc || typeof sc.cameraForRect !== 'function') {
			return false
		}
		this.follower?.stop('user')
		sc.setCamera(sc.cameraForRect(rect, ZOOM_PAD_PX))
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
	 * @param {{per: number, perItem: number, scope: (string|null), types: string[], minutes: (number|null)}} cfg settings
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
				this.selection = Array.isArray(ids) ? [...ids] : []
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
			onEditing: (id, takeover) => this.onEditing(id, takeover),
			onTool: (tool) => this.ui.onTool?.(tool),
			// the key G switched the grid in the scene (R12): only store it
			onGrid: (on) => this.storeGrid(on),
		}
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
	 * shape and text, and the item's first text merges with its creation into
	 * one undo step.
	 *
	 * @param {object} i create intent
	 * @return {string|null} new id
	 */
	createNow(i) {
		const r = actions.createItem(this.model, i)
		if (r.ops.length === 0) {
			return null
		}
		const id = r.selectIds[0]
		this.measurePut(r.ops[0])
		const key = 'new:' + id
		this.commit(r, { urgent: true, mergeKey: key })
		this.select(r.selectIds)
		if (r.edit) {
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
	 * Intent connect (SPEC-M1 §6.3, §6.5.2): a new connector from the
	 * connector tool or a "+" handle; route and end cap come with the intent
	 * (the scene's tool options). One undo step; the connector is selected.
	 *
	 * @param {{start: object, end: object, route?: string, endCap?: string}} i connect intent
	 * @return {string|null} new connector id
	 */
	connectNow(i) {
		const r = actions.connectItems(this.model, { start: i.start, end: i.end, route: i.route, endCap: i.endCap })
		if (r.ops.length === 0) {
			return null
		}
		this.commit(r, { urgent: true })
		this.select(r.selectIds)
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
		if (this.leaseLost.has(i.id)) {
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
		this.scene?.setSelection(ids)
		this.selection = [...ids]
		this.emitSelection()
	}

	/**
	 * Sends ops, records the undo step, shows the result at once. Safety net
	 * (M2, R20): an op on an item that is locked in the model (lock patches
	 * excepted) is left out silently; the inverse stays as it is, and the
	 * item shows its visible state again (a drag that a lock overtook jumps
	 * back). Nothing left to send: no undo step.
	 *
	 * @param {{ops: object[], inverse: object[]}} r action result
	 * @param {{urgent?: boolean, mergeKey?: string|null}} [o] options
	 */
	commit(r, { urgent = true, mergeKey = null } = {}) {
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
			return
		}
		const ids = this.sync.enqueue(ops, { urgent })
		this.undoStack.push({ ops: r.ops, inverse: r.inverse, mergeKey })
		for (const id of held) {
			ids.add(id)
		}
		this.flushVisible(ids)
		this.emitUndo()
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
	 * Undo/redo ops to send. Safety net (M2, R20): an op on an item that is
	 * locked in the model (lock patches excepted: undoing the own lock
	 * unlocks, redo locks again) is skipped, and the toast lock-undo names
	 * how many items; the step has moved to the other stack anyway.
	 *
	 * @param {object[]} ops undo/redo ops to send
	 */
	sendHistory(ops) {
		if (!ops || ops.length === 0 || !this.sync) {
			return
		}
		const skipped = new Set()
		ops = ops.filter((op) => {
			if (this.heldByLock(op)) {
				skipped.add(op.id)
				return false
			}
			return true
		})
		if (skipped.size > 0) {
			this.info(n('knorke', '%n locked item was skipped.', '%n locked items were skipped.', skipped.size), { hook: 'lock-undo' })
		}
		if (ops.length === 0) {
			this.emitUndo()
			return
		}
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
		this.emitUndo()
	}

	undo() {
		if (this.viewOnly || this.frozen) {
			return
		}
		this.guard(() => this.sendHistory(this.undoStack.undo()))
	}

	redo() {
		if (this.viewOnly || this.frozen) {
			return
		}
		this.guard(() => {
			const ops = this.undoStack.redo()
			// A redone create hits a tombstone: it must revive.
			this.sendHistory(ops?.map((op) => (op.o === 'put' ? { ...op, revive: true } : op)) ?? null)
		})
	}

	/** @param {string} tool a tool id of TOOLS (select, hand, sticky, shape, text, frame, connector) */
	setTool(tool) {
		const opts = this.toolOptions[tool] ?? null
		this.scene?.setTool(tool, opts ? { ...opts } : null)
		this.ui.onTool?.(this.scene?.getTool?.() ?? tool)
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
		this.toolOptions[tool] = { ...(this.toolOptions[tool] ?? {}), ...opts }
		this.setTool(tool)
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
		this.ui.onToolOptions?.({ shape: this.getToolOptions('shape'), connector: this.getToolOptions('connector') })
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
			this.commit(actions.setStyle(this.model, ids, path, value, { heights }), { urgent: true, mergeKey })
			this.emitSelection()
		})
	}

	/** @param {string} kind shape kind for the selected shapes */
	setShapeKind(kind) {
		this.setStyle('data.kind', kind)
	}

	/**
	 * "Arrange" (X, Y, W, H, angle, WCAG 2.5.7) for the one selected item.
	 *
	 * @param {{x?: number, y?: number, w?: number, h?: number, r?: number}} box target (absolute)
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
			this.commit(actions.arrangeItem(this.model, id, box ?? {}, { textH }), { urgent: true })
			this.emitSelection()
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
		if (this.viewOnly || this.frozen || !this.scene || this.selection.length !== 1) {
			return false
		}
		const id = this.selection[0]
		if (!this.model?.has(id) || textPathOf(this.model.get(id).t) !== 'data.label' || isLocked(this.model.get(id))) {
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
		const payload = actions.copyPayload(this.model, take, { board: this.boardId })
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
		const r = actions.duplicateItems(this.model, ids, { offset: PASTE_STEP, limits: this.limits, board: this.boardId })
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
		this.pasteText(text, intent?.at ?? null)
	}

	/**
	 * @param {object} payload checked payload
	 * @param {number} skipped items already skipped by the check
	 * @param {{inPlace: boolean}} intent paste intent
	 */
	pastePayload(payload, skipped, intent) {
		const r = actions.pasteItems(this.model, payload, { ...this.pastePlacement(payload, intent), limits: this.limits, board: this.boardId })
		this.finishPaste(r, skipped)
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
	 *
	 * @param {string} text plain text
	 * @param {{x: number, y: number}|null} [where] world point ("Paste here"); default pointer or viewport center
	 */
	pasteText(text, where = null) {
		const count = actions.noteTexts(text).length
		if (count === 0) {
			return
		}
		const run = () => {
			if (this.destroyed || this.frozen || this.viewOnly || !this.model) {
				return
			}
			const at = where ?? (Array.isArray(this.pointer) ? { x: this.pointer[0], y: this.pointer[1] } : this.viewportCenter())
			const r = actions.notesFromText(this.model, text, { at, limits: this.limits })
			this.finishPaste({ ...r, skipped: 0 }, 0)
		}
		if (count <= NOTES_ASK) {
			run()
			return
		}
		const ask = this.ui.onConfirm
		if (typeof ask !== 'function') {
			return
		}
		Promise.resolve(ask({ name: t('knorke', 'Paste {n} notes?', { n: count }), confirmLabel: t('knorke', 'Paste') }))
			.then((ok) => {
				if (ok === true) {
					this.guard(run)
				}
			})
			.catch(() => {})
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
			this.commit(actions.alignItems(this.model, movableIds(this.model, this.selection), edge), { urgent: true })
			this.emitSelection()
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
			this.commit(actions.distributeItems(this.model, movableIds(this.model, this.selection), axis), { urgent: true })
			this.emitSelection()
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
			this.commit(actions.tidyItems(this.model, movableIds(this.model, this.selection)), { urgent: true })
			this.emitSelection()
		})
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

	zoomFit() {
		this.scene?.fit()
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
		this.menu = { id, at, world, ids: [...this.selection], seq: this.menuSeq, frame: this.menuFrame(id, world), locker: this.menuLocker(id) }
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
	 * @return {{by: string, name: string}|null} the target's lock when someone else with a known pid and
	 *   name holds it; else null
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
		return { by, name }
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
	 * The menu state for the shell; items, grid, gridSnap, unlockAll (board
	 * menu), unlockFrame (the menu's frame: the target, or in the board menu
	 * the frame under W) and unlockBy with unlockByName (the target's locker,
	 * job 062) as they are now, not live.
	 */
	emitMenu() {
		const m = this.menu
		const by = m?.locker ? this.unlockByIds(m.locker.by).length : 0
		this.ui.onContextMenu?.(m ? {
			id: m.id, at: [...m.at], seq: m.seq, items: this.model?.size ?? 0,
			grid: this.scene?.getGrid?.() === true, gridSnap: this.scene?.getGridSnap?.() === true,
			unlockAll: m.id === null ? this.unlockAllIds().length : 0,
			unlockFrame: m.frame !== null ? this.unlockFrameIds(m.frame).length : 0,
			unlockBy: by,
			unlockByName: by > 0 ? m.locker.name : null,
		} : null)
	}

	/**
	 * Runs a context-menu entry (§6.6) and closes the menu. The entries on
	 * items act on the selection the scene set before the intent. Every entry
	 * but edit-text and note-here gives the canvas the focus back. paste-here
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
		case 'connect':
			this.connectSelection()
			break
		case 'group':
			// a blocked entry stays in the menu (M2, R20): its activation shows the reason
			this.groupSelection()
			break
		case 'ungroup':
			this.ungroupSelection()
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
		case 'paste-here':
			this.pasteHere(m.world)
			break
		case 'note-here':
			this.noteHere(m.world)
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

	/** "Select all" (like Ctrl/⌘+A): every item of the board but the locked ones (M2, R20). */
	selectAll() {
		if (!this.model) {
			return
		}
		this.select(this.unlockedOf([...this.model.ids()]))
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

	/** Toast [data-knorke-toast=paste-blocked] (§6.5.3 R19): use the keyboard instead. */
	pasteBlocked() {
		const shortcut = isApplePlatform(this.win?.navigator ?? null) ? '⌘V' : 'Ctrl+V'
		this.toast(t('knorke', 'Paste with {shortcut} instead: the browser did not allow reading the clipboard.', { shortcut }), { hook: 'paste-blocked' })
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
		if ((lockMoved || (groupMoved && this.selection.length > 0)) && !reported) {
			this.emitSelection()
		}
		// R17 K4: the vote list follows the model (one ui.onVotes per tick)
		this.voteItemsChanged()
		this.checkMenu()
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
	}

	/**
	 * @param {{seq: number, rev: number|null, res: string[]}} acks acks
	 */
	onAcks(acks) {
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
		/** items whose ops came back itemlocked (M2, R20): one toast with their number */
		const held = new Set()
		// per item only the newest rejected text: a batch can carry two text
		// patches of one item when the older one went out with a keepalive
		// flush (compaction barrier, T15), and ops of one id keep their order
		const rescues = new Map()
		/** result codes of rejected vote ops (SPEC-M1 §4.6) */
		const voteCodes = []
		for (const failure of failed) {
			const { op } = failure
			let { code } = failure
			if (op && op.o === 'vote') {
				// votes are no item state: no rescue, no undo; VoteState corrects below
				voteCodes.push(code)
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
			const rejected = this.rejectedText(op)
			if (rejected !== null && code === 'locked' && op.id === this.takeoverId) {
				// Sent before this tab's take-over reached the server (every request
				// from the take-over on carries me.tk until it is through, and its
				// answer clears takeoverId before its acks are read): not a lost
				// lease. The text goes out again right behind the take-over.
				this.takeoverText = { id: op.id, path: rejected.path, text: rejected.text }
			} else if (rejected !== null) {
				rescues.set(op.id, [op.id, rejected.text, code])
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
		if (closed) {
			this.voteToast('vote-closed', t('knorke', 'Voting has ended.'))
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
	 * Rejected vote ops (SPEC-M1 §4.6): limit → "You have no votes left.",
	 * closed → "Voting has ended.", denied → "No permission" (once); the
	 * optimistic votes go back to the server state plus what is still pending
	 * (the votes block of the same answer corrects the server part).
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
			if (!['limit', 'closed', 'denied', 'gone', 'dup'].includes(c)) {
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
		for (const path of this.textPathsOf(op.id)) {
			if (Object.prototype.hasOwnProperty.call(op.p, path) && typeof op.p[path] === 'string') {
				if (this.hasNewerText(op.id, path)) {
					return null
				}
				return { path, text: op.p[path] }
			}
		}
		return null
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
	 * @param {string} id item id
	 * @param {string} text rejected text
	 * @param {string} code result code
	 */
	rescue(id, text, code) {
		const notice = this.noticeFor(id, code)
		if (this.editingId === id) {
			// The editor may already show a notice (lease lost through presence).
			if (!this.leaseLost.has(id)) {
				this.loseLease(id, notice)
			}
			return
		}
		const exists = this.replica.visible(id) !== null || !!this.model?.has(id)
		// A rescue editor opens only when no editor is open at all (T6): opening
		// one finishes the open editor, and a rescue editor with a notice is
		// discarded without an intent, so an earlier rescued text would vanish,
		// and the focus would leave the editor the user is typing in.
		if (exists && this.scene && this.editingId === null && this.rescueEditorId === null) {
			this.loseLease(id, null)
			if (this.scene.openTextEditor(id, { text, notice }) !== false) {
				this.rescueEditorId = id
				return
			}
			this.leaseLost.delete(id)
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
		if (this.leaseLost.has(id) || !this.model?.has(id) || isLocked(this.model.get(id))) {
			return
		}
		if (isLocked(this.replica.visible(id))) {
			this.loseLease(id, this.noticeFor(id, 'itemlocked'))
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
	 * @param {string} id item id
	 * @param {string|null} notice notice for the open editor (null: none to set)
	 */
	loseLease(id, notice) {
		this.leaseLost.add(id)
		if (notice !== null) {
			this.scene?.setEditorNotice(id, notice)
		}
		const paths = this.textPathsOf(id)
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
			const holder = id ? this.presence.leaseHolder(id) : null
			return t('knorke', 'Not saved: {name} is editing this item. Copy your text before closing.', { name: holder?.name || t('knorke', 'someone else') })
		}
		return t('knorke', 'Not saved. Copy your text before closing.')
	}

	/**
	 * @param {string|null} id item now being edited
	 * @param {boolean} takeover the user took over the text lease
	 */
	onEditing(id, takeover) {
		const prev = this.editingId
		this.editingId = typeof id === 'string' ? id : null
		if (this.rescueEditorId !== null && this.rescueEditorId !== this.editingId) {
			this.rescueEditorId = null
		}
		if (prev !== null && prev !== this.editingId) {
			if (!this.dropEmptyNewText(prev)) {
				if (this.newEdit !== null && this.newEdit.id === prev) {
					this.newEdit = null
				}
				this.remeasureClosed(prev)
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
		if (takeover && this.editingId !== null) {
			// Taking over: me.tk goes out with the next sync and stays pending
			// until a request carrying it got through, also when the editor
			// closes first (the lease tail keeps announcing the item, and its
			// final text must not go out without the take-over).
			this.takeoverId = this.editingId
			this.leaseLost.delete(this.editingId)
		}
		this.dropStaleTakeover()
		if (this.editingId === null) {
			this.flushDeferred()
		}
		this.sync?.poke()
	}

	/**
	 * SPEC-M1 §6.5.2 (last bullet), §1.4: the editor of a NEW text item closed
	 * and the item is still empty. The editor sends no final intent when the
	 * value equals its start value (Esc or a click beside it without typing,
	 * M0 rule), so textNow() never sees this close; the session deletes the
	 * item here, in the undo step of its creation. Not while the lease is lost
	 * (the editor showed a notice), the board is frozen or view-only.
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
	remeasureClosed(id) {
		if (this.frozen || this.viewOnly || this.leaseLost.has(id) || !this.model?.has(id)) {
			return
		}
		const it = this.knownItem(id)
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

	/** @return {string|null} the item announced as me.e (open editor, else the lease tail) */
	announcedEdit() {
		return this.editingId ?? this.leaseTail
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} something of id still has to reach the server: an op not
	 *   acknowledged yet (queued or in flight), or text waiting for the take-over
	 */
	hasPendingText(id) {
		return this.takeoverText?.id === id || this.replica.pendingOps().ops.some((op) => op.id === id)
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
					this.rescue(st.id, st.text, 'locked')
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
		if (!me || me.tk !== 1 || me.e !== this.takeoverId || this.takeoverId === null) {
			return
		}
		this.takeoverId = null
		const st = this.takeoverText
		this.takeoverText = null
		if (!st || st.id !== me.e || this.hasNewerText(st.id, st.path) || this.frozen) {
			return
		}
		const ids = this.sync?.enqueue([{ o: 'patch', id: st.id, p: { [st.path]: st.text } }], { urgent: this.editingId !== st.id })
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
		this.sync?.setRemoteDragging(this.presence.hasDragging())
		this.emitParticipants()
		// SPEC-M1 §6.5.6: every presence card moves a follower's camera
		this.follower?.onPresence()
		const id = this.editingId
		// While a take-over (me.tk) has not reached the server, answers to older
		// requests still name the previous holder: no verdict yet.
		if (id !== null && !this.leaseLost.has(id) && this.takeoverId !== id) {
			const holder = this.presence.leaseHolder(id)
			if (holder && holder.pid !== this.me?.pid) {
				this.loseLease(id, this.noticeFor(id, 'locked'))
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
			this.scene?.setViewOnly(true)
			if (this.editingId !== null) {
				this.loseLease(this.editingId, this.noticeFor(this.editingId, s))
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
		this.model.load(items)
		this.scene?.reset()
		// R17 K4: the reloaded model refreshes the vote list too
		this.voteItemsChanged()
		const rest = this.selection.filter((id) => this.model.has(id))
		if (rest.length !== this.selection.length) {
			this.selection = rest
			this.scene?.setSelection(rest)
			this.emitSelection()
		}
		this.checkMenu()
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
		const e = this.announcedEdit()
		const me = {
			c: this.pointer ? [r1(this.pointer[0]), r1(this.pointer[1])] : null,
			s: this.selection.slice(0, PRESENCE_IDS),
			d: this.dragPreview.slice(0, PRESENCE_IDS).map((d) => [d[0], r1(d[1]), r1(d[2])]),
			e,
		}
		if (this.takeoverId !== null && e === this.takeoverId) {
			me.tk = 1
		}
		const v = this.viewV()
		if (v) {
			me.v = v
		}
		return me
	}

	/** @param {{x: number, y: number, scale: number}} c live camera */
	onCamera(c) {
		if (c && Number.isFinite(c.scale)) {
			this.ui.onZoom?.(Math.round(c.scale * 100))
		}
		// R22 (P7-08): the stepper never moves the camera; any other camera
		// change (wheel, trackpad, zoom keys, a follow jump, fit, zoomToItem)
		// leaves it over another item: close it
		if (this.stepper !== null && cameraMoved(this.stepper.cam, c)) {
			this.closeStepper()
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
		this.ui.onSelection?.(this.selectionInfo())
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
		}
		for (const [key, path] of Object.entries(SELECTION_FIELDS)) {
			let value
			let mixed = false
			for (const it of items) {
				if (fieldRule(it.t, path) === null) {
					value = null
					break
				}
				const v = fieldValue(it, path) ?? null
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
				byId.set(id, text)
			}
		}
		for (const op of this.replica.pendingOps().ops) {
			if (op.o === 'put') {
				const path = textPathOf(op.t)
				consider(op.id, path, path ? getPath(op.p ?? {}, path) : undefined)
			} else if (op.o === 'patch' && op.p) {
				for (const path of this.textPathsOf(op.id)) {
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
					byId.set(i.id, i.value)
				}
			} else {
				consider(i.id, typeof i.path === 'string' ? i.path : 'data.text', i.value)
			}
		}
		return [...byId].map(([id, text]) => ({ id, text, gone: !this.model?.has(id) }))
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
		const path = item ? textPathOf(item.t) : null
		const value = path ? getPath(item, path) : undefined
		return typeof value === 'string' && value !== '' ? [{ type: 'text', id, path, value, open: true }] : []
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
		this.destroyed = true
		this.menu = null
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
