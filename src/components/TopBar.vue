<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<header class="knorke-topbar" :class="{ 'knorke-topbar--narrow': narrow }" data-knorke-bar="top">
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
				{{ title }}
			</button>
		</h2>
		<h2 v-else class="knorke-topbar__title" :title="title">
			{{ title }}
		</h2>
		<button v-if="linkBadge"
			ref="badge"
			type="button"
			class="knorke-topbar__linkbadge"
			:class="{ 'knorke-topbar__linkbadge--icon': narrow }"
			:title="linkExplain"
			:aria-label="narrow ? t('knorke', 'Open by link') : null"
			:aria-expanded="linkInfoOpen ? 'true' : 'false'"
			:aria-controls="linkInfoId"
			data-knorke-action="link-badge"
			@click="$emit('link-info')">
			<NcIconSvgWrapper :path="icons.link" :size="16" inline />
			<span v-if="!narrow" class="knorke-topbar__linkbadge-text">{{ t('knorke', 'Open by link') }}</span>
		</button>
		<span v-if="isGuest" class="knorke-topbar__badge">{{ t('knorke', 'Guest') }}</span>
		<div class="knorke-topbar__spacer" />
		<TimerChip :timer="timer"
			:now="now"
			:mod="canModerate"
			@open="$emit('timer-open')" />
		<PresenceBar :participants="participants"
			:following="following"
			:mod="canModerate"
			:compact="narrow"
			@follow="(pid, was) => $emit('follow', pid, was)"
			@summon="$emit('summon')" />
		<ModerationMenu v-if="narrow && (isOwner || mod || canModerate)"
			overflow
			:can-share="isOwner || mod"
			:mod="canModerate"
			:vote-open="voteOpen"
			:presenting="presenting"
			:summon-active="summonActive"
			@share="$emit('share')"
			@vote-setup="$emit('vote-setup')"
			@timer-open="$emit('timer-open')"
			@summon="$emit('summon')"
			@summon-end="$emit('summon-end')" />
		<ModerationMenu v-if="!narrow && canModerate"
			:mod="canModerate"
			:vote-open="voteOpen"
			:presenting="presenting"
			:summon-active="summonActive"
			@vote-setup="$emit('vote-setup')"
			@timer-open="$emit('timer-open')"
			@summon="$emit('summon')"
			@summon-end="$emit('summon-end')" />
		<NcButton v-if="!narrow && (isOwner || mod)"
			variant="secondary"
			data-knorke-action="share"
			@click="$emit('share')">
			<template #icon>
				<NcIconSvgWrapper :path="icons.share" />
			</template>
			{{ t('knorke', 'Share') }}
		</NcButton>
		<NcActions v-if="isGuest && legalItems.length > 0"
			class="knorke-topbar__more"
			:aria-label="t('knorke', 'More')"
			data-knorke="guest-menu">
			<NcActionLink v-for="l in legalItems"
				:key="l.key"
				:href="l.href"
				target="_blank"
				:data-knorke-legal="l.key">
				{{ l.label }}
			</NcActionLink>
		</NcActions>
	</header>
</template>

<script setup>
/*
 * Top bar of a board (SPEC-M0 §6.6): back, title (inline rename for the
 * owner), share button for the owner, participant bar.
 * (U14) The owner's rename trigger is a real button inside the heading,
 * named "Rename board: <title>"; for everyone else the title is a plain
 * heading (not focusable).
 * (U9) Guests get a small menu with the instance's imprint and privacy
 * links (the guest page hides Nextcloud's footer); NcActionLink opens them
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
 * M2 privacy notice: on a board open by link (BoardView: linkOpen) an
 * account sees the permanent badge "Open by link" behind the title
 * ([data-knorke-action=link-badge], also the owner; guests have "Guest").
 * Wide: link icon and text; narrow: the icon only, named by aria-label. Its
 * title is the explanation (the accessible description). A press opens or
 * closes the privacy info card (event link-info); aria-expanded follows the
 * card, aria-controls points to it.
 */
import { computed, nextTick, ref } from 'vue'
import NcActionLink from '@nextcloud/vue/components/NcActionLink'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import ModerationMenu from './ModerationMenu.vue'
import PresenceBar from './PresenceBar.vue'
import TimerChip from './TimerChip.vue'
import { icons } from './icons.js'
import { legalLinks } from './legal.js'
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
	/** meta.timer (raw) and the server time of the display tick */
	timer: { type: Object, default: null },
	now: { type: Number, default: 0 },
	/** pid this tab follows */
	following: { type: String, default: null },
	narrow: { type: Boolean, default: false },
	voteOpen: { type: Boolean, default: false },
	presenting: { type: Boolean, default: false },
	summonActive: { type: Boolean, default: false },
	/** M2 privacy notice: the board is open by link (account view only) */
	linkBadge: { type: Boolean, default: false },
	/** the privacy info card is open (aria-expanded of the badge) */
	linkInfoOpen: { type: Boolean, default: false },
	/** element id of the card (aria-controls) */
	linkInfoId: { type: String, default: null },
})

const emit = defineEmits(['back', 'rename', 'share', 'timer-open', 'vote-setup', 'summon', 'summon-end', 'follow', 'link-info'])

const legalItems = computed(() => legalLinks(props.legal))
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
