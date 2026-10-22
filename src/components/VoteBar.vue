<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-votebar"
		:class="{ 'knorke-votebar--narrow': narrow, 'knorke-votebar--closed': !votes.open }"
		role="region"
		:aria-label="t('knorke', 'Voting')"
		data-knorke-bar="vote"
		data-knorke-vote-bar
		:data-knorke-vote-state="votes.state"
		:data-knorke-vote-left="votes.open && votes.left !== null ? votes.left : null">
		<template v-if="votes.open">
			<span class="knorke-votebar__text">
				<template v-if="!narrow">{{ t('knorke', 'Voting') }} · </template>
				<template v-if="votes.canVote">{{ narrow ? n('knorke', '%n left', '%n left', votes.left ?? 0) : n('knorke', '%n vote left', '%n votes left', votes.left ?? 0) }}</template>
				<template v-if="clock"> · <span class="knorke-votebar__clock">{{ clock }}</span></template>
				<template v-if="votes.mod && votes.voters !== null"> · {{ n('knorke', '%n voted', '%n voted', votes.voters) }}</template>
			</span>
			<button v-if="votes.canSwitch"
				type="button"
				class="knorke-chip"
				data-knorke-action="vote-mode"
				@click="(e) => $emit('mode', votes.mode !== 'vote', e)">
				{{ votes.mode === 'vote' ? t('knorke', 'Edit') : t('knorke', 'Vote') }}
			</button>
			<NcButton v-if="votes.mod && votes.endsAt !== null && !narrow"
				variant="tertiary"
				:disabled="busy"
				data-knorke-action="vote-extend"
				@click="$emit('extend')">
				{{ t('knorke', '+5 min') }}
			</NcButton>
			<NcButton v-if="votes.mod"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="vote-end"
				@click="confirming = true">
				{{ t('knorke', 'End voting') }}
			</NcButton>
			<NcButton variant="primary"
				data-knorke-bar="list"
				data-knorke-action="vote-panel"
				:aria-expanded="panelOpen ? 'true' : 'false'"
				@click="$emit('panel')">
				{{ t('knorke', 'List') }}
			</NcButton>
		</template>
		<template v-else>
			<NcButton variant="tertiary"
				class="knorke-votebar__results"
				data-knorke-bar="list"
				data-knorke-action="vote-panel"
				:aria-expanded="panelOpen ? 'true' : 'false'"
				@click="$emit('panel')">
				{{ n('knorke', 'Voting ended · %n voted · Results', 'Voting ended · %n voted · Results', votes.voters ?? 0) }}
			</NcButton>
		</template>
		<span class="hidden-visually" aria-live="polite">{{ announce }}</span>
		<ConfirmDialog v-if="confirming"
			:name="t('knorke', 'End voting now? Votes can\'t be changed afterwards.')"
			:confirm-label="t('knorke', 'End voting')"
			danger
			data-knorke-dialog="vote-end"
			@confirm="end"
			@cancel="confirming = false" />
	</div>
</template>

<script setup>
/*
 * Vote bar (SPEC-M1 §6.6 VoteBar, §6.8, R16 narrow layout (2)): docked at
 * the bottom in every layout, never hidden while a session is open or its
 * results stand. Open: "Voting · {n} votes left · mm:ss" (the time only with
 * endsAt), the desktop switch Vote/Edit for editors ([data-knorke-action=
 * vote-mode], preferVote; R17 K5: a plain action button whose label names
 * the mode a click switches to – "Edit" in mode vote, "Vote" in mode edit –
 * without aria-pressed, so the state is conveyed one way only, §6.8,
 * §6.12), for moderators "End voting" (asks first),
 * "+5 min" (only with endsAt !== null, R16 SRV-07) and the live count "{n}
 * voted" (never a distribution, §7.2), and "List" ([data-knorke-bar=list],
 * the vote panel). Narrow: "{n} left" and "List". Closed: "Voting ended ·
 * {n} voted · Results" opens the ranking. The polite live region speaks the
 * own count after a vote ("Vote added, 3 of 5 left", §6.12).
 */
import { computed, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import ConfirmDialog from './ConfirmDialog.vue'
import { n, t } from '../util/l10n.js'
import { voteClock } from './countdown.js'

const props = defineProps({
	/** BoardSession.votesView() */
	votes: { type: Object, required: true },
	/** server time of the display tick */
	now: { type: Number, default: 0 },
	narrow: { type: Boolean, default: false },
	panelOpen: { type: Boolean, default: false },
	busy: { type: Boolean, default: false },
})

const emit = defineEmits(['mode', 'panel', 'end', 'extend'])

const confirming = ref(false)
const clock = computed(() => (props.votes.open ? voteClock(props.votes.endsAt, props.now) : null))
const announce = ref('')

function end() {
	confirming.value = false
	emit('end')
}

watch(() => [props.votes.sid, props.votes.state, props.votes.left], ([sid, state, left], old) => {
	const [osid, ostate, oleft] = old ?? [null, null, null]
	if (state === 'open' && (sid !== osid || ostate !== 'open')) {
		const minutes = props.votes.endsAt !== null ? Math.max(1, Math.round((props.votes.endsAt - props.now) / 60000)) : null
		announce.value = minutes !== null
			? n('knorke', 'Voting started, %n votes, {minutes} minutes', 'Voting started, %n votes, {minutes} minutes', props.votes.per, { minutes })
			: n('knorke', 'Voting started, %n vote', 'Voting started, %n votes', props.votes.per)
	} else if (state === 'closed' && ostate === 'open' && sid === osid) {
		announce.value = t('knorke', 'Voting ended, results available')
	} else if (state === 'open' && sid === osid && Number.isInteger(left) && Number.isInteger(oleft) && left !== oleft) {
		announce.value = left < oleft
			? t('knorke', 'Vote added, {left} of {per} left', { left, per: props.votes.per })
			: t('knorke', 'Vote removed, {left} of {per} left', { left, per: props.votes.per })
	}
}, { immediate: false })
</script>
