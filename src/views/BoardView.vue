<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-board"
		:class="{ 'knorke-board--guest': mode === 'guest', 'knorke-board--viewonly': uiMode !== 'edit', 'knorke-board--narrow': narrow, 'knorke-board--votebar': showVoteBar }"
		@pointerdown.capture="onPointerDown"
		@keydown.capture="onKeyDown">
		<div ref="host"
			class="knorke-canvas"
			tabindex="0"
			role="application"
			:aria-label="t('knorke', 'Canvas')" />
		<ContextMenu v-if="menu && ready && uiMode === 'edit' && !frozen"
			:menu="menu"
			:selection="selection"
			:host="host"
			:can-paste="menuCanPaste"
			:apple="apple"
			@action="menuAction"
			@close="menuClose" />
		<textarea ref="catcher"
			class="knorke-paste-catcher"
			data-knorke-paste-catcher
			aria-hidden="true"
			tabindex="-1" />
		<TopBar ref="topBar"
			:title="boardTitle"
			:is-owner="isOwner"
			:is-guest="mode === 'guest'"
			:mod="isMod"
			:can-moderate="canModerate"
			:can-go-back="mode === 'user'"
			:participants="participants"
			:following="followState.following ? followState.following.pid : null"
			:timer="timerMeta"
			:now="nowTick"
			:narrow="narrow"
			:vote-open="!!(votes && votes.open)"
			:presenting="presenting"
			:summon-active="summonActive"
			:max-title="limits.maxTitle || 200"
			:legal="legal"
			:link-badge="linkBadge"
			:link-info-open="privacyCard !== null && privacyCard.kind === 'account'"
			:link-info-id="privacyCardId"
			@link-info="toggleLinkInfo"
			@back="$emit('back')"
			@rename="rename"
			@share="shareOpen = true"
			@timer-open="openTimer"
			@vote-setup="openSetup"
			@summon="moderate((s) => s.summon())"
			@summon-end="moderate((s) => s.endSummon())"
			@follow="onFollowParticipant" />
		<Toolbar v-if="ready && uiMode === 'edit' && !frozen"
			:active="tool"
			:options="toolOptions"
			:can-undo="undoState.canUndo"
			:can-redo="undoState.canRedo"
			@tool="(x, e) => act(e, (s) => s.setTool(x))"
			@options="(tl, o) => act(null, (s) => s.setToolOptions(tl, o))"
			@undo="(e) => act(e, (s) => s.undo())"
			@redo="(e) => act(e, (s) => s.redo())" />
		<div class="knorke-topstack">
			<div class="knorke-banners" aria-live="polite">
				<ConnectionBanner :status="status"
					:reason="statusReason"
					:role-banner="roleBanner"
					:show-status="strips.includes('status')"
					:show-role="strips.includes('role')" />
				<FollowBanner v-if="strips.includes('follow')"
					:following="followState.following"
					@stop="stopFollowing" />
				<FollowChip v-if="strips.includes('chip')"
					:chip="followState.chip"
					@follow="followPresenter" />
				<div v-if="strips.includes('time_up')"
					class="knorke-banner knorke-banner--time_up"
					data-knorke-banner="time_up"
					data-knorke-bar="banner"
					role="status">
					<button type="button"
						class="knorke-banner__dismiss"
						:title="t('knorke', 'Close')"
						@click="dismissTimeUp">
						{{ t('knorke', 'Time\'s up') }}
					</button>
				</div>
				<PrivacyInfo v-if="privacyCard"
					:id="privacyCardId"
					ref="privacyInfo"
					:kind="privacyCard.kind"
					:privacy="privacy"
					:vote="me !== null && me.role === 'vote'"
					@close="closePrivacy" />
			</div>
			<ContextBar v-if="ready && uiMode === 'edit' && !frozen && selection.count > 0"
				:selection="selection"
				@style="(p, v, e) => act(e, (s) => s.setStyle(p, v))"
				@kind="(k, e) => act(e, (s) => s.setShapeKind(k))"
				@arrange="(b) => session && session.arrange(b)"
				@align="(edge, e) => act(e, (s) => s.align(edge))"
				@distribute="(axis, e) => act(e, (s) => s.distribute(axis))"
				@tidy="(e) => act(e, (s) => s.tidy())"
				@copy="(e) => act(e, (s) => s.copy())"
				@cut="(e) => act(e, (s) => s.cut())"
				@duplicate="(e) => act(e, (s) => s.duplicate())"
				@reorder="(w, e) => act(e, (s) => s.reorder(w))"
				@delete="(e) => act(e, (s) => s.deleteSelection())"
				@connect="connect"
				@group="(e) => groupAct(e, (s) => s.groupSelection())"
				@ungroup="(e) => groupAct(e, (s) => s.ungroupSelection())"
				@lock="() => lockAct((s) => s.lockSelection())"
				@unlock="() => lockAct((s) => s.unlockSelection())"
				@label="() => session && session.editLabel()" />
		</div>
		<ZoomControls v-if="ready"
			:percent="zoom"
			:frames="frameList"
			:has-selection="selection.count > 0"
			@frames="readFrames"
			@zoom-to="(id) => act(null, (s) => s.zoomToItem(id))"
			@zoom-selection="(e) => act(e, (s) => s.zoomToSelection())"
			@zoom-in="(e) => act(e, (s) => s.zoomIn())"
			@zoom-out="(e) => act(e, (s) => s.zoomOut())"
			@zoom-fit="(e) => act(e, (s) => s.zoomFit())"
			@zoom-100="(e) => act(e, (s) => s.zoom100())" />
		<VoteBar v-if="showVoteBar"
			:votes="votes"
			:now="nowTick"
			:narrow="narrow"
			:panel-open="panelOpen"
			:busy="modBusy"
			@mode="(v, e) => act(e, (s) => s.setPreferVote(v))"
			@panel="togglePanel"
			@end="moderate((s) => s.updateVote('end'))"
			@extend="moderate((s) => s.updateVote('extend', 5))" />
		<VotePanel v-if="panelOpen && votes && votes.state"
			:votes="votes"
			:items="panelItems"
			:lookup="lookupItem"
			:narrow="narrow"
			:busy="modBusy"
			@vote="(id, n) => session && session.vote(id, n)"
			@focus="focusItem"
			@show="moderate((s) => s.updateVote('show'))"
			@hide="moderate((s) => s.updateVote('hide'))"
			@clear="clearResults"
			@copy="copyResults"
			@close="closePanel" />
		<VoteStepper v-if="stepper && votes && votes.open && votes.canVote && uiMode === 'vote' && !frozen"
			:id="stepper.id"
			:rect="stepper.rect"
			:mine="(votes.mine && votes.mine[stepper.id]) || 0"
			:per-item="votes.perItem"
			:left="votes.left || 0"
			:text="session ? session.textOf(stepper.id) : ''"
			@set="(n) => session && session.vote(stepper.id, n)"
			@close="closeStepper" />
		<div v-if="!ready && !openError && !openFinal" class="knorke-board__loading">
			<NcLoadingIcon :size="44" :name="t('knorke', 'Loading board …')" />
		</div>
		<NcEmptyContent v-if="openError"
			class="knorke-board__error"
			:name="t('knorke', 'Could not open the board')"
			:description="openError">
			<template #action>
				<NcButton variant="primary" @click="reload">
					{{ t('knorke', 'Try again') }}
				</NcButton>
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-if="openFinal"
			class="knorke-board__error"
			data-knorke-empty="board-final"
			:name="t('knorke', 'Could not open the board')">
			<template v-if="openFinal.back" #action>
				<NcButton variant="primary"
					data-knorke-action="back-to-list"
					@click="$emit('back')">
					{{ t('knorke', 'Back to all boards') }}
				</NcButton>
			</template>
		</NcEmptyContent>
		<ShareDialog v-if="shareOpen && board"
			:board-id="board.id"
			:owner="isOwner"
			:mod="isMod"
			:title="boardTitle"
			:links="board.links || null"
			:links-allowed="board.linksAllowed === false ? false : null"
			:link-policy="board.linkPolicy || null"
			@links="mergeBoard"
			@close="shareOpen = false" />
		<VoteSetupDialog v-if="setupOpen && canModerate"
			:frame="setupFrame"
			:count="(cfg) => (session ? session.votableCount(cfg) : 0)"
			:busy="modBusy"
			:error="setupError"
			@start="startVote"
			@close="setupOpen = false" />
		<TimerDialog v-if="timerOpen && canModerate"
			:timer="timerMeta"
			:now="nowTick"
			:busy="modBusy"
			:muted="muted"
			@action="timerAction"
			@mute="setMuted"
			@close="timerOpen = false" />
		<ConfirmDialog v-if="rescues.length > 0"
			:name="rescueInfo.name"
			:confirm-label="t('knorke', 'Close')"
			hide-cancel
			data-knorke-dialog="rescue"
			@confirm="closeRescues"
			@cancel="closeRescues">
			<!-- NcDialog shows its message only without slot content -->
			<p class="knorke-rescue__label">
				{{ rescueInfo.message }}
			</p>
			<textarea v-for="r in rescues"
				:key="r.key"
				class="knorke-rescue"
				readonly
				:value="r.text" />
		</ConfirmDialog>
		<ConfirmDialog v-if="ask"
			:name="ask.name"
			:confirm-label="ask.confirmLabel"
			data-knorke-dialog="paste-notes"
			@confirm="answerAsk(true)"
			@cancel="answerAsk(false)" />
		<ConfirmDialog v-if="leaveOpen"
			:name="t('knorke', 'Some changes have not been saved yet. Leave anyway?')"
			:confirm-label="t('knorke', 'Leave')"
			:cancel-label="t('knorke', 'Stay')"
			danger
			data-knorke-dialog="leave"
			@confirm="answerLeave(true)"
			@cancel="answerLeave(false)" />
	</div>
</template>

<script setup>
/*
 * Board view (SPEC-M0 §6.6): hosts the canvas and mounts a BoardSession
 * (markRaw in a shallowRef, never in reactive data). Only small state is
 * reactive here: status, selection summary, participants, zoom %, tool,
 * undo/redo availability, board metadata.
 *
 * Leaving the board inside the app (Back, browser Back/Forward, T3): a
 * router leave guard first lets the session commit the open editor and wait
 * briefly for the server; whatever is still pending then (offline, failing)
 * would be lost with the session, so the user is asked: Stay or Leave.
 *
 * SPEC-M1 (stage 0):
 * - The board view is MERGED, never replaced (Befund F3): the session sends
 *   its merged view (live title from the meta channel); link changes made
 *   here go into the session first (mergeBoard), so a later meta update
 *   cannot bring an old link back. The edit link is `board.links.edit`.
 * - The own rename answer goes through the session's meta path.
 * - 'password_required' (guest, §6.4): the texts that would be lost go to the
 *   copy dialog first; closing it (or nothing to rescue) hands the guest over
 *   to PublicApp's name and password phase ('password-required').
 *
 * SPEC-M1 stage 1, round 1a:
 * - The canvas host is focusable (.knorke-canvas[tabindex="0"], §6.8): the
 *   scene's single keys work only while it has the focus. After a POINTER
 *   click on a toolbar, context bar or zoom button the focus goes back to
 *   it (components/focus.js); keyboard users keep the focus on the button.
 * - The paste catcher (textarea[data-knorke-paste-catcher], §6.5.3) lives
 *   here; the session focuses it on Ctrl/⌘+V and reads the paste event.
 * - Toolbar v2 (tools of TOOLS, shape kinds), ContextBar v2 (selection v2),
 *   the question before pasting more than 100 notes (ui.onConfirm).
 *
 * SPEC-M1 stage 1, round 1b (connectors):
 * - "Connect" (context bar, two bindable items selected) creates the
 *   connector and selects it; the button then disappears with the old
 *   selection, so the focus goes to the canvas after a pointer AND a
 *   keyboard activation (otherwise a keyboard user would land on <body>,
 *   where single keys do nothing).
 * - "Edit label" opens the scene's label editor, which takes the focus
 *   (no refocus of the canvas).
 * - (M2, R20) Lock and Unlock of the context bar run lockSelection /
 *   unlockSelection; the button changes with the lock, so the canvas gets
 *   the focus after either activation (like "Connect").
 * - (M2, R20 Gruppieren) Group items and Ungroup run groupSelection /
 *   ungroupSelection: when ops went out the button changes (the canvas gets
 *   the focus after either activation, like Lock); a blocked one stays with
 *   its toast, and only a pointer click gives the canvas the focus back.
 *
 * SPEC-M1 stage 2 (sharing and roles):
 * - The client mode comes from the session (ui.onMode, board/mode.js
 *   modeFor): toolbar and context bar only in mode 'edit'; it follows a live
 *   role change. The one role/device banner next to the status banner is
 *   mode.js bannerFor(me.role, device, {votingEnabled: FEATURES.voting}).
 * - Share button and dialog for the owner and for moderators (me.mod, R13);
 *   moderators get the read-only "Links" tab. Losing the right closes an
 *   open dialog. Link changes in the dialog are merged into the session's
 *   board view (mergeBoard), never replacing it.
 * - Guests: the link password of the name dialog goes with the join.
 *
 * SPEC-M1 stage 3 (moderation, §6.6):
 * - VoteBar (always at the bottom while a session is open or its results
 *   stand), VotePanel (opens once per sid when the session turns closed;
 *   in the narrow layout also at the start, as a bottom sheet),
 *   VoteSetupDialog, VoteStepper (perItem > 1), TimerChip/TimerDialog,
 *   FollowBanner/FollowChip, the moderation menu, participant buttons, the
 *   frame list. One display tick (timeout to the next full second of server
 *   time, session.clock) drives every countdown; never the scene's frames.
 * - Banner strips stand at the top under the TopBar in one stack with the
 *   context bar (no overlap); precedence and "one in the narrow layout" from
 *   components/bars.js. Narrow = matchMedia NARROW_QUERY (≤ 600 px).
 * - "Time's up": banner until a click or 30 s, the memory per pair (seq,
 *   end); the end sound (util/sound.js, unlocked by the first pointerdown or
 *   key) unless muted. Wake lock while a session is open or a timer runs.
 * - The routes 22–26 are called once per click (never repeated); errors are
 *   toasted by the session, vote_config shows in the setup dialog.
 *
 * Review round P7 (SPEC-M1 §33.1 i, R22):
 * - P7-08: the VoteStepper shows only in mode vote while this person may
 *   vote and the board is not frozen; the session closes it on a camera
 *   change and when its item goes (ui.onStepper(null)); the shell's close
 *   (×, Esc, a press elsewhere) tells the session. The VoteSetupDialog needs
 *   canModerate like the TimerDialog: losing the right closes it.
 * - P7-11: "Show on the board" (focusItem, components/voteLayout.js
 *   focusPlan): the narrow layout closes the bottom sheet first; the side
 *   panel's width stays free (zoomToItem(id, {left, right})).
 *
 * SPEC-M1 stage 4 (§6.6 ContextMenu.vue, R19 T4-02):
 * - The context menu is a sibling of .knorke-canvas (never inside the scene
 *   container), shown while the session reports one (ui.onContextMenu) in
 *   mode edit. Its entries run through session.menuAction; Esc, Tab and a
 *   click outside close it and give the canvas the focus back, window blur
 *   and resize only close it. "Paste here" is offered only where a click may
 *   read the clipboard (secure context, board/clipboard.js canReadClipboard).
 *
 * M2 privacy notice (components/privacy.js, PrivacyInfo.vue):
 * - Accounts: the TopBar badge "Open by link" while linkOpen (board.links of
 *   owners and moderators, else the snapshot's board.linkOpenSince); a press
 *   opens or closes the info card (focus on its close button). The one-time
 *   info appears after the open and for every new linkOpenSince, never for
 *   the owner, without moving the focus, and is remembered when shown.
 * - Guests: the card once the board is ready when PublicApp says so
 *   (guestPrivacyInfo: a returning guest, once per tab session).
 * - A person with the role vote (voting link, vote share) gets the built-in
 *   text of the voting role (no cursor, anonymous votes).
 * - The card is the last child of .knorke-banners (the polite live region),
 *   no banner strip. Closing: back to the badge when it was opened there,
 *   else to the canvas host when the focus was inside the card. An
 *   automatic account card goes when the board is no longer open by link.
 *
 * Factory job 049 (final status on opening): when open() ends in a status of
 * statusOf (gone, revoked, links_disabled, link_expired, logged_out, reload,
 * …) the spinner goes and the empty state [data-knorke-empty=board-final]
 * "Could not open the board" shows, without a description and without the
 * board title; the reason stays in the status banner (hook, live region and
 * its actions as before). Accounts get "Back to all boards"
 * ([data-knorke-action=back-to-list], the TopBar's back path); guests none.
 * A 404 says "Your access through the link ended. Open the link again." only
 * when this tab's board list knew the board came through a link (prop
 * knownSource, components/banner.js finalOpenView). openFinal is set only
 * here: a status after a successful open keeps the frozen board and banner.
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { SceneModel } from '../model/SceneModel.js'
import { SceneManager } from '../scene/index.js'
import * as boardsApi from '../api/boards.js'
import { BoardSession, FROZEN_STATUSES } from '../board/BoardSession.js'
import { canReadClipboard } from '../board/clipboard.js'
import { installDebug } from '../board/debug.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { isLinksDisabled } from '../components/join.js'
import { lockoutText } from '../components/share.js'
import { addRescue, rescueDialog } from '../components/rescue.js'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import ContextBar from '../components/ContextBar.vue'
import ContextMenu from '../components/ContextMenu.vue'
import PrivacyInfo from '../components/PrivacyInfo.vue'
import { accountInfoDue, linkOpen, markAccountSeen } from '../components/privacy.js'
import FollowBanner from '../components/FollowBanner.vue'
import FollowChip from '../components/FollowChip.vue'
import ShareDialog from '../components/ShareDialog.vue'
import TimerDialog from '../components/TimerDialog.vue'
import Toolbar from '../components/Toolbar.vue'
import TopBar from '../components/TopBar.vue'
import VoteBar from '../components/VoteBar.vue'
import VotePanel from '../components/VotePanel.vue'
import VoteSetupDialog from '../components/VoteSetupDialog.vue'
import VoteStepper from '../components/VoteStepper.vue'
import ZoomControls from '../components/ZoomControls.vue'
import { finalOpenView, bannerFor as statusBannerFor } from '../components/banner.js'
import { NARROW_QUERY, bannerStrips, resultsText } from '../components/bars.js'
import { focusPlan } from '../components/voteLayout.js'
import { copyText } from '../components/copyText.js'
import { nextTickMs, timeUpShown, timerKey, timerOf } from '../components/countdown.js'
import { summonOf } from '../board/follow.js'
import { createSound } from '../util/sound.js'
import { createWakeLock } from '../util/wakelock.js'
import { notePointerDown, refocusAfter } from '../components/focus.js'
import { addLeaveGuard } from '../router.js'
import { bannerFor as roleBannerFor } from '../board/mode.js'
import { HttpError, PASSWORD_LOCK } from '../sync/http.js'
import { isApplePlatform, isViewOnlyDevice } from '../util/device.js'
import { FEATURES } from '../util/features.js'
import { t } from '../util/l10n.js'
import { showError, showInfo } from '../util/toast.js'
import { webStorage } from '../util/storage.js'

const props = defineProps({
	mode: { type: String, default: 'user' },
	boardId: { type: Number, default: null },
	linkToken: { type: String, default: null },
	guestName: { type: String, default: null },
	/** link password of the guest name dialog (stage 2), only for this join */
	guestPassword: { type: String, default: null },
	debug: { type: Boolean, default: false },
	limits: { type: Object, default: () => ({}) },
	/** (U9) guest page: the instance's legal links (initial state `legal`) */
	legal: { type: Object, default: null },
	/** M2 privacy notice: initial state `privacy` ({text, url}) */
	privacy: { type: Object, default: null },
	/** M2: a returning guest (no name dialog) gets the info card once this tab session */
	guestPrivacyInfo: { type: Boolean, default: false },
	/** origin of the board in this tab's board list (own|share|link), null when unknown (factory job 049) */
	knownSource: { type: String, default: null },
})

const emit = defineEmits(['back', 'open-failed', 'opened', 'password-required'])

const host = ref(null)
const catcher = ref(null)
const session = shallowRef(null)
const ready = ref(false)
const openError = ref('')
/** null | {back: boolean}: opening the board ended in a final status (factory job 049). */
const openFinal = ref(null)
const status = ref('connecting')
const statusReason = ref(null)
const selection = ref({ ids: [], count: 0, types: new Set(), fields: [], mixed: [], fill: null, hasContainer: false, canConnect: false, box: null })
const toolOptions = ref({})
/** Open question of the session (paste many notes): {name, confirmLabel, resolve}. */
const ask = ref(null)
const participants = ref([])
const zoom = ref(100)
const tool = ref('select')
const undoState = ref({ canUndo: false, canRedo: false })
const board = ref(null)
const me = ref(null)
const shareOpen = ref(false)
/** Stage 3: what the session says about the vote (votesView) and following. */
const votes = ref(null)
const followState = ref({ following: null, chip: null })
const panelOpen = ref(false)
const panelItems = ref([])
const setupOpen = ref(false)
const setupFrame = ref(null)
const setupError = ref('')
const timerOpen = ref(false)
/** A moderation call is running (buttons wait). */
const modBusy = ref(false)
/** {id, rect} of the open vote stepper */
const stepper = ref(null)
const frameList = ref([])
/** Server time of the display tick (countdowns). */
const nowTick = ref(Date.now())
/** Key (seq:end) of the "Time's up" banner the user clicked away. */
const dismissedTimeUp = ref(null)
const narrow = ref(false)
const sound = createSound()
const muted = ref(sound.muted())
const wakeLock = createWakeLock()
/** sids whose results opened the panel automatically (once per sid). */
const autoPanel = new Set()
let tickTimer = null
let narrowQuery = null
const rescues = ref([])
const leaveOpen = ref(false)
/** Open context menu of the session ({id, at, seq, items}) or null (stage 4). */
const menu = ref(null)
/** "Paste here" needs a click that may read the clipboard (secure context). */
const menuCanPaste = canReadClipboard()
/** ⌘ hints and Meta+… shortcuts on Apple platforms. */
const apple = isApplePlatform()
/** The device has no fine pointer (fixed); the mode also follows the role. */
const deviceViewOnly = isViewOnlyDevice()
/** Client mode of the session (SPEC-M1 §6.5.4): 'edit' | 'vote' | 'view'. */
const uiMode = ref(deviceViewOnly ? 'view' : 'edit')
/** Resolves the pending leave question (Stay → false, Leave → true). */
let leaveAnswer = null
let unguard = null
/** 'password_required' reached: hand over to PublicApp once the copy dialog is closed. */
let handoverPending = false
/** What the hand-over tells PublicApp ({lockText} after the password lock-out). */
let handoverInfo = {}

const isOwner = computed(() => props.mode === 'user' && board.value?.role === 'owner')
/** Moderator who is not the owner (me.mod, R13): share button with the read-only links. */
const isMod = computed(() => props.mode === 'user' && !isOwner.value && me.value?.mod === true)
/** This client moderates (me.mod, owners included; stage 3 moderation menu). */
const canModerate = computed(() => props.mode === 'user' && me.value?.mod === true)
/** The one role/device banner (SPEC-M1 §6.5.4, R13); none before the board is known. */
const roleBanner = computed(() => (me.value ? roleBannerFor(me.value.role, deviceViewOnly, { sessionOpen: !!votes.value?.open, votingEnabled: FEATURES.voting }) : null))
const timerMeta = computed(() => board.value?.meta?.timer ?? null)
const summon = computed(() => summonOf(board.value?.meta?.summon))
const summonActive = computed(() => summon.value !== null)
/** This tab presents (meta.summon = my pid and this tab's client id). */
const presenting = computed(() => summon.value !== null && summon.value.pid === me.value?.pid && summon.value.client === session.value?.client)
const showVoteBar = computed(() => ready.value && !!votes.value?.state)
const timeUp = computed(() => timeUpShown(timerOf(timerMeta.value), nowTick.value, dismissedTimeUp.value))
/** Banner strips under the TopBar (R16 (3)): precedence, one in the narrow layout. */
const strips = computed(() => bannerStrips({
	status: statusBannerFor(status.value, statusReason.value).kind,
	follow: !!followState.value.following,
	chip: !!followState.value.chip,
	timeUp: timeUp.value,
	role: roleBanner.value,
	frozen: frozen.value,
}, narrow.value))

// a live role change took the right away: the dialog goes (R13)
watch(() => isOwner.value || isMod.value, (may) => {
	if (!may) {
		shareOpen.value = false
	}
})
// R22 (P7-08, CLIENT-7): losing the moderation closes the vote setup for good
watch(canModerate, (may) => {
	if (!may) {
		setupOpen.value = false
	}
})
const boardTitle = computed(() => board.value?.title ?? '')
const frozen = computed(() => FROZEN_STATUSES.includes(status.value))
const rescueInfo = computed(() => rescueDialog(rescues.value))

// ---- M2 privacy notice ----------------------------------------------------

const topBar = ref(null)
const privacyInfo = ref(null)
const privacyStorage = webStorage()
/** The info card: null | {kind: 'guest'|'account', viaBadge: boolean}. */
const privacyCard = ref(null)
const privacyCardId = 'knorke-privacy-info-' + (props.boardId ?? 'board')
/** The guest card of this view was shown (PublicApp keeps it to once per tab session). */
let guestCardShown = false
/** The board is open by link: the badge of accounts (guests have "Guest"). */
const linkBadge = computed(() => props.mode === 'user' && linkOpen(board.value, serverNow()))

/**
 * The account's one-time info: after the open and for every new
 * linkOpenSince (resync); never for the owner; shown without moving the
 * focus and remembered at once (components/privacy.js).
 */
function maybeAccountInfo() {
	if (props.mode !== 'user' || !ready.value || !linkBadge.value) {
		return
	}
	const o = { board: board.value, me: me.value, isOwner: isOwner.value }
	if (!accountInfoDue(o, privacyStorage)) {
		return
	}
	markAccountSeen(o, privacyStorage)
	if (privacyCard.value === null) {
		privacyCard.value = { kind: 'account', viaBadge: false }
	}
}
watch(() => [ready.value, board.value?.linkOpenSince ?? null, me.value?.pid ?? null, isOwner.value, linkBadge.value].join('|'), maybeAccountInfo)
// a returning guest: the card as soon as the board is ready (PublicApp decided it is due)
watch(ready, (r) => {
	if (r && props.mode === 'guest' && props.guestPrivacyInfo && !guestCardShown) {
		guestCardShown = true
		privacyCard.value = { kind: 'guest', viaBadge: false }
	}
})
// the automatic account card goes when the board is no longer open by link
watch(linkBadge, (open) => {
	if (!open && privacyCard.value?.kind === 'account' && !privacyCard.value.viaBadge) {
		privacyCard.value = null
	}
})

/** The badge: opens the account card (the focus goes to its close button) or closes it. */
async function toggleLinkInfo() {
	if (privacyCard.value?.kind === 'account') {
		closePrivacy()
		return
	}
	privacyCard.value = { kind: 'account', viaBadge: true }
	await nextTick()
	privacyInfo.value?.focusClose()
}

/**
 * Closes the card. Opened through the badge: the focus goes back to the
 * badge (to the canvas when the badge is gone); otherwise to the canvas
 * host, but only when it was inside the card.
 *
 * @param {{focusInside?: boolean}} [e] close event of the card
 */
function closePrivacy(e = {}) {
	const card = privacyCard.value
	if (!card) {
		return
	}
	privacyCard.value = null
	if (card.viaBadge) {
		nextTick(() => {
			if (!topBar.value?.focusBadge?.() && e?.focusInside) {
				focusCanvasHost()
			}
		})
	} else if (e?.focusInside) {
		focusCanvasHost()
	}
}

function focusCanvasHost() {
	if (session.value) {
		session.value.focusCanvas()
	} else {
		host.value?.focus?.()
	}
}

/**
 * Leave guard (router, T3): may this board be left now?
 *
 * @return {Promise<boolean>} true: leave; false: stay on the board
 */
async function guardLeave() {
	const s = session.value
	if (!s || s.destroyed) {
		return true
	}
	if (leaveAnswer !== null) {
		return false
	}
	let ok
	try {
		ok = await s.prepareLeave({ timeoutMs: 3000 })
	} catch (e) {
		console.error('[knorke] prepareLeave failed', e)
		ok = false
	}
	if (ok || session.value !== s) {
		return true
	}
	leaveOpen.value = true
	return new Promise((resolve) => {
		leaveAnswer = resolve
	})
}

/** @param {boolean} leave the user chose Leave */
function answerLeave(leave) {
	leaveOpen.value = false
	const resolve = leaveAnswer
	leaveAnswer = null
	resolve?.(leave)
}

/**
 * @param {unknown} e error of open()
 * @return {string|null} banner status for the error, null for a retryable error
 */
function statusOf(e) {
	if (!(e instanceof HttpError)) {
		return null
	}
	if (e.status === 404) {
		return 'gone'
	}
	if (e.status === 403) {
		if (e.code === 'link_expired') {
			return 'link_expired'
		}
		if (e.code === 'password_required' || e.code === 'password_wrong') {
			return 'password_required'
		}
		return e.code === 'link_revoked' ? 'revoked' : isLinksDisabled(e) ? 'links_disabled' : 'gone'
	}
	if (e.status === 401) {
		return props.mode === 'user' ? 'logged_out' : 'revoked'
	}
	if (e.status === 409) {
		return 'reload'
	}
	return null
}

onMounted(async () => {
	unguard = addLeaveGuard(() => guardLeave())
	watchNarrow()
	const s = markRaw(new BoardSession({
		container: host.value,
		mode: props.mode,
		boardId: props.boardId,
		linkToken: props.linkToken,
		viewOnly: deviceViewOnly,
		debug: props.debug,
		limits: props.limits,
		pasteCatcher: catcher.value,
		ui: {
			onStatus: (x, reason) => {
				status.value = x
				statusReason.value = reason ?? null
				if (x === 'password_required' && props.mode === 'guest') {
					queueMicrotask(handOver)
				}
			},
			onSelection: (x) => { selection.value = x },
			onParticipants: (x) => { participants.value = x },
			onBoard: (x) => {
				// merged, never replaced (F3): a partial update keeps links/linksAllowed
				board.value = x.board ? { ...(board.value ?? {}), ...x.board } : board.value
				me.value = x.me ?? null
			},
			onTool: (x) => { tool.value = x },
			onMode: (x) => { uiMode.value = x },
			onToolOptions: (x) => { toolOptions.value = x },
			onConfirm: (q) => new Promise((resolve) => {
				ask.value?.resolve(false)
				ask.value = { name: q.name, confirmLabel: q.confirmLabel ?? '', resolve }
			}),
			onZoom: (x) => { zoom.value = x },
			onUndoState: (x) => { undoState.value = x },
			onRescue: (x) => { rescues.value = addRescue(rescues.value, x) },
			onVotes: (x) => onVotes(x),
			onFollow: (x) => { followState.value = { following: x?.following ?? null, chip: x?.chip ?? null } },
			onStepper: (x) => { stepper.value = x && typeof x.id === 'string' ? { id: x.id, rect: x.rect ?? null } : null },
			onContextMenu: (x) => { menu.value = x && Array.isArray(x.at) ? x : null },
			onClockSkew: () => tick(),
		},
		deps: { SceneModel, SceneManager, installDebug },
	}))
	session.value = s
	try {
		await s.open(props.guestName, props.guestPassword)
		ready.value = true
		emit('opened', { board: board.value, me: me.value })
	} catch (e) {
		if (s.destroyed) {
			return
		}
		const st = statusOf(e)
		if (st) {
			const v = finalOpenView(st, { mode: props.mode, source: props.knownSource })
			status.value = st
			statusReason.value = v.reason
			openFinal.value = { back: v.back }
		} else if (e instanceof HttpError && e.status === 429 && e.fromApp) {
			openError.value = t('knorke', 'Too many attempts. Please wait a moment and try again.')
		} else {
			openError.value = e instanceof HttpError && e.status === 0
				? t('knorke', 'The server cannot be reached. Check your connection.')
				: t('knorke', 'Something went wrong while opening the board.')
		}
		emit('open-failed', e)
	}
})

onBeforeUnmount(() => {
	clearTimeout(tickTimer)
	tickTimer = null
	narrowQuery?.removeEventListener?.('change', onNarrow)
	wakeLock.destroy()
	sound.close()
	answerAsk(false)
	unguard?.()
	unguard = null
	// unmounted by another path while the question was open: nothing to keep
	answerLeave(true)
	session.value?.destroy()
	session.value = null
})

function reload() {
	window.location.reload()
}

/**
 * Runs a bar command on the session; after a pointer activation the canvas
 * gets the focus back (single keys work at once, SPEC-M1 §6.5.1).
 *
 * @param {Event|null} e activation event (null: decide by the last pointerdown)
 * @param {(s: BoardSession) => void} fn command
 */
function act(e, fn) {
	const s = session.value
	if (!s) {
		return
	}
	fn(s)
	refocusAfter(e, s)
}

/**
 * Lock and Unlock of the context bar (M2, SPEC-M1 §1.2 "(R20) Sperren"):
 * the button goes away with the new lock state, so the canvas gets the
 * focus after a pointer AND a keyboard activation (like "Connect").
 *
 * @param {(s: object) => void} fn lockSelection or unlockSelection
 */
function lockAct(fn) {
	const s = session.value
	if (!s) {
		return
	}
	fn(s)
	s.focusCanvas()
}

/**
 * Group items and Ungroup of the context bar (M2, SPEC-M1 §1.2 "(R20)
 * Gruppieren"): sent, the button goes away with the new state, so the canvas
 * gets the focus after a pointer AND a keyboard activation (like Lock);
 * blocked (toast group-blocked), the button stays and only a pointer click
 * refocuses the canvas.
 *
 * @param {Event} e activation event
 * @param {(s: object) => string} fn groupSelection or ungroupSelection ('sent' | 'blocked' | 'none')
 */
function groupAct(e, fn) {
	const s = session.value
	if (!s) {
		return
	}
	if (fn(s) === 'sent') {
		s.focusCanvas()
	} else {
		refocusAfter(e, s)
	}
}

/**
 * "Connect" of the context bar (SPEC-M1 §6.12): the new connector is
 * selected and the button is gone, so the canvas gets the focus either way.
 */
function connect() {
	const s = session.value
	if (!s) {
		return
	}
	s.connectSelection()
	s.focusCanvas()
}

/** Remembers the last pointerdown (components/focus.js: menu changes carry no pointer info). */
function onPointerDown() {
	notePointerDown()
	// the timer's end sound may play only after a user gesture (util/sound.js)
	sound.unlock()
}

/** A key on the board: a user gesture too (end sound). */
function onKeyDown() {
	sound.unlock()
}

/**
 * An entry of the context menu (synchronous in its click or key event:
 * "Paste here" reads the clipboard inside that user activation).
 *
 * @param {string} name entry (contextbar.js MENU_ITEMS)
 */
function menuAction(name) {
	session.value?.menuAction(name)
}

/**
 * The context menu closed itself: Esc, Tab and a click outside give the
 * canvas the focus back (§6.6); window blur and resize do not here (a focus
 * still inside the menu goes to the canvas when it unmounts, ContextMenu.vue
 * returnFocus, §6.6 R20).
 *
 * @param {'esc'|'tab'|'outside'|'blur'|'resize'} reason why
 */
function menuClose(reason) {
	const s = session.value
	if (!s) {
		menu.value = null
		return
	}
	s.closeMenu()
	if (reason === 'esc' || reason === 'tab' || reason === 'outside') {
		s.focusCanvas()
	}
}

// ---- stage 3 ----------------------------------------------------------------

/** The narrow layout (R16 (1)): matchMedia, live. */
function watchNarrow() {
	try {
		narrowQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null
	} catch (e) {
		narrowQuery = null
	}
	narrow.value = !!narrowQuery?.matches
	narrowQuery?.addEventListener?.('change', onNarrow)
}

/** @param {MediaQueryListEvent} e change of the narrow query */
function onNarrow(e) {
	narrow.value = !!e?.matches
}

/** @return {number} server time now (the session's clock; local before the board opened) */
function serverNow() {
	return session.value?.clock ? session.value.clock.now() : Date.now()
}

/**
 * The display tick: one timeout to the next full second of the nearest
 * countdown (timer rest, vote rest); runs only while one exists.
 */
function tick() {
	clearTimeout(tickTimer)
	tickTimer = null
	const now = serverNow()
	nowTick.value = now
	const timer = timerOf(timerMeta.value)
	const rests = []
	if (timer) {
		rests.push(timer.state === 'running' ? timer.end - now : 1000)
	}
	if (votes.value?.open && Number.isFinite(votes.value.endsAt)) {
		rests.push(votes.value.endsAt - now)
	}
	if (rests.length === 0) {
		return
	}
	const delay = Math.min(...rests.map((r) => nextTickMs(r > 0 ? r : 1000)))
	tickTimer = setTimeout(tick, delay)
}

/**
 * The session's vote view (ui.onVotes): bar, panel, stepper, the automatic
 * panel (once per sid at the close; narrow: at the start).
 *
 * @param {object} v BoardSession.votesView()
 */
function onVotes(v) {
	const prev = votes.value
	votes.value = v
	if (!v || v.state === null) {
		panelOpen.value = false
		stepper.value = null
	} else if (v.event === 'closed' && !autoPanel.has(v.sid)) {
		autoPanel.add(v.sid)
		stepper.value = null
		openPanel()
	} else if (v.event === 'started' && narrow.value) {
		openPanel()
	}
	if (!v?.open) {
		stepper.value = null
	}
	if (panelOpen.value) {
		panelItems.value = session.value?.votableItems() ?? []
	}
	session.value?.setVotePanelOpen(panelOpen.value)
	if (prev?.open !== v?.open || prev?.endsAt !== v?.endsAt) {
		tick()
	}
}

/**
 * "Show on the board" of a row text in the vote list or the ranking
 * (SPEC-M1 §6.6, R22 P7-11): the narrow layout's bottom sheet would cover
 * the item, so it closes first (the vote bar opens it again); the side
 * panel stays and the canvas part it covers is kept free.
 *
 * @param {string} id item id
 */
function focusItem(id) {
	const s = session.value
	if (!s) {
		return
	}
	const board = host.value?.getBoundingClientRect?.() ?? null
	const panel = host.value?.parentElement?.querySelector?.('[data-knorke-vote-panel]')?.getBoundingClientRect?.() ?? null
	const plan = focusPlan(narrow.value, board, panel)
	if (plan.closeSheet) {
		closePanel()
	}
	s.zoomToItem(id, plan.reserve)
}

/** The stepper's own close (×, Esc, a press elsewhere): the session forgets it too. */
function closeStepper() {
	stepper.value = null
	session.value?.closeStepper()
}

function openPanel() {
	panelItems.value = session.value?.votableItems() ?? []
	panelOpen.value = true
	session.value?.setVotePanelOpen(true)
}

function closePanel() {
	panelOpen.value = false
	session.value?.setVotePanelOpen(false)
}

function togglePanel() {
	if (panelOpen.value) {
		closePanel()
	} else {
		openPanel()
	}
}

/**
 * @param {string} id item id of a result
 * @return {{text: string, exists: boolean}}
 */
function lookupItem(id) {
	const s = session.value
	return { text: s ? s.textOf(id) : '', exists: !!s?.model?.has(id) }
}

/** "Copy results": the plain-text ranking over the copy path (until export in M2). */
async function copyResults() {
	const text = resultsText(votes.value?.results ?? [], (id) => lookupItem(id).text, t('knorke', '(no text)'))
	if (await copyText(text)) {
		showInfo(t('knorke', 'Results copied'))
	} else {
		showError(t('knorke', 'The results could not be copied.'))
	}
}

/** "Close results" (clear): the panel closes with the session's meta. */
async function clearResults() {
	await moderate((s) => s.updateVote('clear'))
}

/**
 * Runs one moderation call (never repeated automatically).
 *
 * @param {(s: BoardSession) => Promise<{ok: boolean, code: (string|null)}>} fn call
 * @return {Promise<{ok: boolean, code: (string|null)}>}
 */
async function moderate(fn) {
	const s = session.value
	if (!s || modBusy.value) {
		return { ok: false, code: null }
	}
	modBusy.value = true
	try {
		return await fn(s)
	} finally {
		modBusy.value = false
	}
}

/** "Start voting" in the menu: the setup dialog (scope "frame" when exactly one frame is selected). */
function openSetup() {
	const s = session.value
	const ids = selection.value.ids ?? []
	let frame = null
	if (s && ids.length === 1 && s.model?.has(ids[0]) && s.model.get(ids[0]).t === 'frame') {
		const f = s.frames().find((x) => x.id === ids[0])
		frame = f ? { id: f.id, title: f.title } : null
	}
	setupFrame.value = frame
	setupError.value = ''
	setupOpen.value = true
}

/** @param {object} cfg settings of the setup dialog */
async function startVote(cfg) {
	const r = await moderate((s) => s.startVote(cfg))
	if (r.ok) {
		setupOpen.value = false
	} else if (r.code === 'vote_config') {
		setupError.value = t('knorke', 'These vote settings are not possible.')
	} else if (r.code === 'vote_open') {
		setupOpen.value = false
	}
}

function openTimer() {
	timerOpen.value = true
}

/**
 * @param {string} action timer action
 * @param {number} [ms] for start and add
 */
async function timerAction(action, ms) {
	const r = await moderate((s) => s.timer(action, ms))
	if (r.ok && (action === 'start' || action === 'stop')) {
		timerOpen.value = false
	}
}

/** @param {boolean} on mute the end sound (per viewer) */
function setMuted(on) {
	sound.setMuted(on)
	muted.value = sound.muted()
}

function dismissTimeUp() {
	dismissedTimeUp.value = timerKey(timerOf(timerMeta.value))
}

/**
 * A participant button: follow, or stop when this tab follows them already.
 *
 * @param {string} pid participant
 * @param {boolean} was this tab follows them
 */
function onFollowParticipant(pid, was) {
	const s = session.value
	if (!s) {
		return
	}
	if (was) {
		s.stopFollow()
	} else {
		s.followParticipant(pid)
	}
}

function stopFollowing() {
	session.value?.stopFollow()
}

function followPresenter() {
	session.value?.followPresenter()
}

/** The frame list reads the frames when it opens. */
function readFrames() {
	frameList.value = session.value?.frames() ?? []
}

// a timer appears or changes: the display tick follows
watch(() => JSON.stringify(timerMeta.value ?? null), () => tick())
// "Time's up" starts: the end sound (unless muted or locked)
watch(timeUp, (up, was) => {
	if (up && !was) {
		sound.play()
	}
})
// wake lock while a session is open or a timer runs (tablets, §6.6)
watch(() => !!votes.value?.open || timerOf(timerMeta.value)?.state === 'running', (on) => wakeLock.want(on), { immediate: true })

/** @param {boolean} ok the user's answer to the session's question */
function answerAsk(ok) {
	const q = ask.value
	ask.value = null
	q?.resolve(ok)
}

/**
 * Guest hand-over after 'password_required' (SPEC-M1 §4.2, §6.4): unsent
 * texts first into the copy dialog; PublicApp takes over when it closes.
 */
function handOver() {
	if (handoverPending) {
		return
	}
	handoverPending = true
	// R13 (§6.4): the automatic re-join hit the password lock-out: the password
	// phase shows the lock-out text instead of "Enter the password …"
	const err = statusReason.value === PASSWORD_LOCK ? session.value?.sync?.finalError : null
	handoverInfo = err ? { lockText: lockoutText(err) } : {}
	for (const x of session.value?.unsentTexts() ?? []) {
		rescues.value = addRescue(rescues.value, x)
	}
	if (rescues.value.length === 0) {
		emit('password-required', handoverInfo)
	}
}

function closeRescues() {
	rescues.value = []
	if (handoverPending) {
		emit('password-required', handoverInfo)
	}
}

/**
 * @param {object} partial board keys changed in the share dialog (links, linksAllowed)
 */
function mergeBoard(partial) {
	if (session.value) {
		session.value.mergeBoard(partial)
	} else if (board.value) {
		board.value = { ...board.value, ...partial }
	}
}

/** @param {string} title new board title */
async function rename(title) {
	if (!isOwner.value || !board.value) {
		return
	}
	try {
		const b = await boardsApi.renameBoard(board.value.id, title)
		if (session.value) {
			// SPEC-M1 §6.5.1: the own rename takes the meta path (metaRev)
			session.value.applyBoardUpdate(b)
		} else {
			board.value = { ...board.value, title: b.title }
		}
	} catch (e) {
		showError(e instanceof HttpError && e.status === 400
			? t('knorke', 'Please enter a title (1–200 characters).')
			: t('knorke', 'The board could not be renamed.'))
	}
}
</script>
