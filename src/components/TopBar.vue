<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<header class="knorke-topbar" :class="{ 'knorke-topbar--narrow': narrow }" data-knorke-bar="top" data-knorke-chrome>
		<div class="knorke-island knorke-island--left" data-knorke-island="left">
			<NcButton v-if="canGoBack"
				variant="tertiary"
				:aria-label="t('knorke', 'Back to all boards')"
				:title="t('knorke', 'Back to all boards')"
				data-knorke-action="back"
				@click="$emit('back')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.back" />
				</template>
			</NcButton>
			<div class="knorke-topbar__head">
				<form v-if="editing"
					class="knorke-topbar__rename"
					@submit.prevent="commit(true)">
					<input ref="field"
						v-model="draft"
						class="knorke-topbar__input"
						type="text"
						:maxlength="maxTitle"
						:aria-label="t('knorke', 'Board title')"
						data-knorke-field="title"
						@keydown.esc.prevent="cancel"
						@blur="commit(false)">
				</form>
				<h2 v-else-if="isOwner" class="knorke-topbar__title knorke-topbar__title--editable">
					<button ref="trigger"
						type="button"
						class="knorke-topbar__rename-trigger"
						:aria-label="t('knorke', 'Rename board: {title}', { title })"
						:title="t('knorke', 'Rename board')"
						data-knorke-action="rename-board"
						@click="startEdit">
						<span class="knorke-topbar__title-text">{{ title }}</span>
						<span v-if="narrow && linkChip" class="knorke-topbar__subline">{{ subline }}</span>
					</button>
				</h2>
				<button v-else-if="narrow && linkChip"
					ref="badge"
					type="button"
					class="knorke-topbar__headbadge"
					:title="linkExplain"
					:aria-expanded="linkInfoOpen ? 'true' : 'false'"
					:aria-controls="linkInfoId"
					data-knorke-action="link-badge"
					@click="$emit('link-info')">
					<span class="knorke-topbar__title-text">{{ title }}</span>
					<span class="knorke-topbar__subline">{{ subline }}</span>
				</button>
				<h2 v-else class="knorke-topbar__title" :title="title">
					{{ title }}
				</h2>
			</div>
			<template v-if="!narrow">
				<button v-if="linkChip"
					ref="badge"
					type="button"
					class="knorke-topbar__linkbadge"
					:class="{ 'knorke-topbar__linkbadge--icon': mid }"
					:title="linkExplain"
					:aria-label="mid ? t('knorke', 'Open by link') : null"
					:aria-expanded="linkInfoOpen ? 'true' : 'false'"
					:aria-controls="linkInfoId"
					data-knorke-action="link-badge"
					@click="$emit('link-info')">
					<NcIconSvgWrapper :path="icons.link" :size="16" inline />
					<span v-if="!mid" class="knorke-topbar__linkbadge-text">{{ t('knorke', 'Open by link') }}</span>
				</button>
				<span v-if="isGuest" class="knorke-topbar__badge" data-knorke-guest-chip>
					<NcIconSvgWrapper :path="icons.account" :size="16" inline />
					{{ t('knorke', 'Guest') }}
				</span>
			</template>
			<template v-else>
				<button v-if="isOwner && linkChip"
					ref="badge"
					type="button"
					class="knorke-topbar__linkbadge knorke-topbar__linkbadge--icon"
					:title="linkExplain"
					:aria-label="t('knorke', 'Open by link')"
					:aria-expanded="linkInfoOpen ? 'true' : 'false'"
					:aria-controls="linkInfoId"
					data-knorke-action="link-badge"
					@click="$emit('link-info')">
					<NcIconSvgWrapper :path="icons.link" :size="16" inline />
				</button>
				<PresenceBar :participants="participants"
					:following="following"
					:mod="canModerate"
					compact
					@follow="(pid, was) => $emit('follow', pid, was)"
					@summon="$emit('summon')" />
				<NcButton v-if="ready"
					variant="tertiary"
					class="knorke-topbar__outline"
					:aria-label="t('knorke', 'Outline')"
					:title="t('knorke', 'Outline')"
					:aria-pressed="view === 'outline' ? 'true' : 'false'"
					data-knorke-view="outline"
					@click="$emit('view', 'toggle')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.viewList" />
					</template>
				</NcButton>
				<NcButton v-if="ready"
					variant="tertiary"
					class="knorke-topbar__search"
					:aria-label="searchLabel"
					:title="searchLabel"
					:aria-keyshortcuts="searchKeys"
					:aria-pressed="searchOpen ? 'true' : 'false'"
					data-knorke-action="search"
					@click="$emit('search')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.search" />
					</template>
				</NcButton>
				<NcButton v-if="ready"
					variant="tertiary"
					class="knorke-topbar__comments"
					:aria-label="t('knorke', 'Comments')"
					:title="t('knorke', 'Comments')"
					:aria-pressed="commentsOpen ? 'true' : 'false'"
					data-knorke-action="comments"
					@click="$emit('comments')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.comment" />
					</template>
				</NcButton>
				<ModerationMenu overflow
					:can-share="mayShare"
					:mod="canModerate"
					:vote-open="voteOpen"
					:private-on="privateOn"
					:timer-active="timerActive"
					:presenting="presenting"
					:summon-active="summonActive"
					:can-present="canPresent"
					:board-items="boardItems"
					@board-action="(k) => $emit('board-action', k)"
					@share="$emit('share')"
					@vote-setup="$emit('vote-setup')"
					@private-setup="$emit('private-setup')"
					@private-reveal="$emit('private-reveal')"
					@timer-open="$emit('timer-open')"
					@summon="$emit('summon')"
					@summon-end="$emit('summon-end')"
					@vote-end="$emit('vote-end')"
					@timer-end="$emit('timer-end')"
					@present="$emit('present')"
					@opened="$emit('menu-open')" />
			</template>
		</div>
		<div v-if="!narrow" class="knorke-island knorke-island--right" data-knorke-island="right">
			<PresenceBar :participants="participants"
				:following="following"
				:mod="canModerate"
				:compact="mid"
				@follow="(pid, was) => $emit('follow', pid, was)"
				@summon="$emit('summon')" />
			<div v-if="ready"
				class="knorke-topbar__views"
				role="group"
				:aria-label="t('knorke', 'View')"
				data-knorke-view-switch>
				<NcButton v-for="v in VIEW_KEYS"
					:key="v"
					variant="tertiary"
					class="knorke-topbar__view"
					:aria-label="mid ? viewLabel(v) : null"
					:title="viewLabel(v)"
					:aria-pressed="view === v ? 'true' : 'false'"
					:data-knorke-view="v"
					@click="$emit('view', v)">
					<template v-if="mid" #icon>
						<NcIconSvgWrapper :path="v === 'outline' ? icons.viewList : icons.board" />
					</template>
					<template v-if="!mid">
						{{ viewLabel(v) }}
					</template>
				</NcButton>
			</div>
			<NcButton v-if="ready"
				variant="tertiary"
				class="knorke-topbar__search"
				:aria-label="searchLabel"
				:title="searchLabel"
				:aria-keyshortcuts="searchKeys"
				:aria-pressed="searchOpen ? 'true' : 'false'"
				data-knorke-action="search"
				@click="$emit('search')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.search" />
				</template>
			</NcButton>
			<NcButton v-if="ready"
				variant="tertiary"
				class="knorke-topbar__comments"
				:aria-label="t('knorke', 'Comments')"
				:title="t('knorke', 'Comments')"
				:aria-pressed="commentsOpen ? 'true' : 'false'"
				data-knorke-action="comments"
				@click="$emit('comments')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.comment" />
				</template>
			</NcButton>
			<ModerationMenu v-if="canModerate"
				:mod="canModerate"
				:vote-open="voteOpen"
				:private-on="privateOn"
				:timer-active="timerActive"
				:presenting="presenting"
				:summon-active="summonActive"
				:can-present="canPresent"
				@vote-setup="$emit('vote-setup')"
				@private-setup="$emit('private-setup')"
				@private-reveal="$emit('private-reveal')"
				@timer-open="$emit('timer-open')"
				@summon="$emit('summon')"
				@present="$emit('present')"
				@opened="$emit('menu-open')"
				@summon-end="$emit('summon-end')"
				@vote-end="$emit('vote-end')"
				@timer-end="$emit('timer-end')" />
			<NcButton v-if="mayShare"
				variant="primary"
				data-knorke-action="share"
				@click="$emit('share')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.share" />
				</template>
				{{ t('knorke', 'Share') }}
			</NcButton>
			<ModerationMenu v-if="boardItems.length > 0"
				board
				:board-items="boardItems"
				@board-action="(k) => $emit('board-action', k)" />
		</div>
	</header>
</template>

<script setup>
/*
 * Top bar of a board (SPEC-M0 §6.6): back, title (inline rename for the
 * owner), share button for the owner, participant bar.
 * (U14) The owner's rename trigger is a real button inside the heading,
 * named "Rename board: <title>"; for everyone else the title is a plain
 * heading (not focusable).
 * (U9) Guests get the instance's imprint and privacy links in the board
 * menu (the guest page hides Nextcloud's footer); NcActionLink opens them
 * in a new tab with rel="nofollow noreferrer noopener".
 * SPEC-M1 §6.6: the title is live (meta channel). An open rename field keeps
 * its draft; closing it renames only when the draft differs from the title
 * the field started with (components/title.js renameTarget), so an untouched
 * field never undoes a rename from elsewhere. After Esc the live title shows.
 * SPEC-M1 §6.6 (R13): the share button shows for the owner and for
 * moderators (prop mod = me.mod, §6.6) from stage 2 on and follows a live role
 * change (moderators get the read-only "Links" tab); the timer and the
 * moderation menu come with stage 3.
 *
 * Stage 3 (SPEC-M1 §6.6, R16 narrow layout): [data-knorke-bar=top]; the
 * timer chip (TimerChip, [data-knorke-bar=timer], a button for
 * moderators); participant buttons (follow, own entry of a moderator =
 * "Bring everyone here"); the moderation menu (canModerate = me.mod,
 * owners included). Narrow (≤ 600 px): one line – back, title (ellipsis),
 * guest badge, timer chip, the participants as "+{n}" with the list in a
 * popover, and an overflow menu ([data-knorke-menu=overflow]) with "Share"
 * and the moderation entries.
 *
 * Job 178 (save as image): the board menu "⋯" (boardMenu.js
 * boardMenuItems) for every role and mode. Wide: last in the bar, after
 * "Share", ModerationMenu with board ([data-knorke-menu=board], "More"):
 * first "Save as image (PNG)" ([data-knorke-action=export-png], once
 * ready), for guests then the legal links ([data-knorke-legal]). Narrow: no second menu;
 * the overflow menu shows for every role with "Share" (owner, moderators),
 * the moderation entries (moderators), then the same entries. An action
 * emits board-action with its key. Job 200: "Save as SVG"
 * ([data-knorke-action=export-svg]) and "Save as PDF" (job 207: "Save as PDF…")
 * ([data-knorke-action=export-pdf]) right after it. Job 179: "Save as CSV"
 * ([data-knorke-action=export-csv]) after them while canEdit (the
 * board view's canEdit of me.role, live).
 *
 * Job 180 (templates): prop edit (this person edits now: mode edit, board
 * not frozen) adds "Insert template…" ([data-knorke-action=insert-template])
 * as the board menu's last action, before the guests' legal links; it
 * follows the prop live.
 *
 * Job 182 (template suggestions): with templateRight 'suggest' "Suggest as
 * template…", with 'save' (admins) "Save as template…"
 * ([data-knorke-action=save-template]) right after "Download board", in
 * every role and mode, frozen too; null (the guest page, before route 28
 * answered) none.
 *
 * Job 189 (comments): the speech-bubble button "Comments"
 * ([data-knorke-action=comments], icons.comment, aria-pressed while the
 * panel is open) after the participants, once the board is ready, for every
 * role and mode, guests and view-only tablets too; narrow too, as the icon
 * it always is. It emits comments (the board view toggles the panel).
 *
 * Job 191 (tags): prop hasTags (the board has tags) adds "Filter by tags…"
 * ([data-knorke-action=filter-tags]) as the board menu's first action, for
 * every role and mode; it emits board-action like the others.
 *
 * M2 privacy notice: on a board open by link (BoardView: linkOpen) an
 * account sees the permanent badge "Open by link" behind the title
 * ([data-knorke-action=link-badge], also the owner; guests have "Guest").
 * Wide: link icon and text; narrow: the icon only, named by aria-label. Its
 * title is the explanation (the accessible description). A press opens or
 * closes the privacy info card (event link-info); aria-expanded follows the
 * card, aria-controls points to it.
 *
 * Job 228 (redesign header, docs/redesign/ P1, P6, P11): the header is an
 * invisible strip ([data-knorke-bar=top], [data-knorke-chrome]) with two
 * islands ([data-knorke-island=left|right]) over the canvas. Left: back, the
 * title, the chip "Open by link" (the badge above: an info pair; now for
 * guests too, always, as they come by link) and for guests the plain chip
 * "Guest" ([data-knorke-guest-chip]). Right (job 233: the timer moved to the
 * session bar), the participants (at most 4, the rest behind
 * "+n"), "Comments", "Facilitate" (moderators, the flag with the word),
 * "Share" as the board's one primary button (owner and moderators, never
 * guests: mayShare) and "More" (the board menu, its levels in
 * ModerationMenu.vue; "Keyboard shortcuts" in it while wide). Prop mid
 * (601–900 px, bars.js MID_QUERY): the participants only as "+n", the chip
 * only its icon. Narrow: one island over the full width with back, the title
 * and under it the subline ("Guest · Open by link", "Open by link"), the
 * "+n", "Comments" and the overflow menu ("More": "Share", the
 * moderation entries, the board menu). Round 3: title and subline fill the
 * island's height as one target – for everyone but the owner the badge
 * ([data-knorke-action=link-badge], a native button), for the owner the
 * rename button, whose badge is the link icon (44 px with pen or finger)
 * right after it; while the field is open the subline goes.
 *
 * Job 274 (board as an outline): once the board is ready, for every role
 * and mode. Wide: the group "Board | Outline" ([data-knorke-view-switch],
 * buttons [data-knorke-view=board|outline], aria-pressed) before the
 * magnifier, mid as icons named by aria-label; it emits view('board') or
 * view('outline'). Narrow: one list button ([data-knorke-view=outline],
 * pressed while the outline shows) before the magnifier; it emits
 * view('toggle').
 */
import { computed, nextTick, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { shortcut, withShortcut } from '../util/shortcuts.js'
import { VIEWS } from '../board/viewSwitch.js'
import ModerationMenu from './ModerationMenu.vue'
import PresenceBar from './PresenceBar.vue'
import { boardMenuItems } from './boardMenu.js'
import { timerOf } from './countdown.js'
import { icons } from './icons.js'
import { explainText } from './privacy.js'
import { renameTarget } from './title.js'

const props = defineProps({
	title: { type: String, default: '' },
	isOwner: { type: Boolean, default: false },
	isGuest: { type: Boolean, default: false },
	/** moderator (me.mod, §6.6 TopBar): share button with the read-only links (R13) */
	mod: { type: Boolean, default: false },
	canGoBack: { type: Boolean, default: true },
	participants: { type: Array, default: () => [] },
	maxTitle: { type: Number, default: 200 },
	legal: { type: Object, default: null },
	/** stage 3: this client moderates (me.mod, owners included) */
	canModerate: { type: Boolean, default: false },
	/** meta.timer (raw): job 233, only for "End timer" in the menu (the clock lives in the session bar) */
	timer: { type: Object, default: null },
	/** pid this tab follows */
	following: { type: String, default: null },
	narrow: { type: Boolean, default: false },
	/** job 228: middle width (601–900 px, bars.js MID_QUERY): "+n" only, the chip as an icon */
	mid: { type: Boolean, default: false },
	voteOpen: { type: Boolean, default: false },
	/** job 275: private writing runs (ModerationMenu) */
	privateOn: { type: Boolean, default: false },
	presenting: { type: Boolean, default: false },
	/** job 272: the board has a frame ("Present frames" in the moderation menu) */
	canPresent: { type: Boolean, default: false },
	summonActive: { type: Boolean, default: false },
	/** M2 privacy notice: the board is open by link (account view only) */
	linkBadge: { type: Boolean, default: false },
	/** the privacy info card is open (aria-expanded of the badge) */
	linkInfoOpen: { type: Boolean, default: false },
	/** element id of the card (aria-controls) */
	linkInfoId: { type: String, default: null },
	/** job 178: the board is loaded (the board menu's actions show) */
	ready: { type: Boolean, default: false },
	/** job 179: this person may edit the board (canEdit of me.role): "Save as CSV" */
	canEdit: { type: Boolean, default: false },
	/** job 180: this person edits now (mode edit, not frozen): "Insert template…" in the board menu */
	edit: { type: Boolean, default: false },
	/** job 182: the template right of route 28 ('suggest' | 'save'), null: no save-template */
	templateRight: { type: String, default: null },
	/** (job 191) the board has tags: "Filter by tags…" */
	hasTags: { type: Boolean, default: false },
	/** job 189: the comment panel is open (aria-pressed of "Comments") */
	commentsOpen: { type: Boolean, default: false },
	/** (job 271) the board search is open */
	searchOpen: { type: Boolean, default: false },
	/** (job 274) the view the board shows: 'board' or 'outline' */
	view: { type: String, default: 'board' },
	/** (job 271) Apple platform: ⌘ in the shortcut hint */
	apple: { type: Boolean, default: false },
})

/** (job 271) the magnifier: "Search on the board (Ctrl+F)" */
const searchLabel = computed(() => withShortcut(t('knorke', 'Search on the board'), 'search', props.apple))
const searchKeys = computed(() => shortcut('search', props.apple)?.aria ?? null)

const emit = defineEmits(['back', 'rename', 'share', 'timer-open', 'vote-setup', 'private-setup', 'private-reveal', 'summon', 'summon-end', 'vote-end', 'timer-end', 'follow', 'link-info', 'board-action', 'comments', 'search', 'present', 'menu-open', 'view'])

/** (job 274) the two views of "Board | Outline" */
const VIEW_KEYS = VIEWS

/**
 * @param {string} v a view
 * @return {string} its name in the switch
 */
function viewLabel(v) {
	return v === 'outline' ? t('knorke', 'Outline') : t('knorke', 'Board')
}

/** job 233: a timer exists ("End timer" under "Running now") */
const timerActive = computed(() => timerOf(props.timer) !== null)

/** job 178: the board menu's entries (wide: its own menu; narrow: in the overflow menu) */
const boardItems = computed(() => boardMenuItems({ ready: props.ready, canEdit: props.canEdit, edit: props.edit, templateRight: props.templateRight, tags: props.hasTags, guest: props.isGuest, legal: props.legal, shortcuts: !props.narrow }))
/** job 228: "Share" for the owner and moderators, never on the guest page */
const mayShare = computed(() => (props.isOwner || props.mod) && !props.isGuest)
/** job 228: the chip "Open by link": accounts while the board is open by link, guests always */
const linkChip = computed(() => props.linkBadge || props.isGuest)
/** job 228: the narrow layout's line under the title */
const subline = computed(() => [props.isGuest ? t('knorke', 'Guest') : null, linkChip.value ? t('knorke', 'Open by link') : null].filter(Boolean).join(' · '))
const linkExplain = explainText()
const badge = ref(null)

/** Gives the badge the focus (the card opened through it closes); false without a badge. */
function focusBadge() {
	if (!badge.value) {
		return false
	}
	badge.value.focus()
	return true
}

defineExpose({ focusBadge })
const editing = ref(false)
const draft = ref('')
/** Title when the rename field opened (the live title may change meanwhile). */
let startTitle = ''
const field = ref(null)
const trigger = ref(null)

async function startEdit() {
	if (!props.isOwner || editing.value) {
		return
	}
	draft.value = props.title
	startTitle = props.title
	editing.value = true
	await nextTick()
	field.value?.focus()
	field.value?.select()
}

/** Keyboard (Enter, Esc) ends editing: the focus goes back to the trigger. */
async function refocus() {
	await nextTick()
	trigger.value?.focus()
}

/** @param {boolean} byKey Enter (not a blur) */
function commit(byKey) {
	if (!editing.value) {
		return
	}
	editing.value = false
	const next = renameTarget(draft.value, startTitle)
	if (next !== null) {
		emit('rename', next)
	}
	if (byKey) {
		refocus()
	}
}

function cancel() {
	editing.value = false
	refocus()
}
</script>
