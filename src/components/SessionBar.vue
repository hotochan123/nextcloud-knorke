<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="root"
		class="knorke-sessionbar"
		:class="{ 'knorke-sessionbar--narrow': narrow, 'knorke-sessionbar--compact': compact && !narrow }"
		role="region"
		:aria-label="t('knorke', 'Session')"
		data-knorke-bar="session"
		data-knorke-chrome>
		<div v-if="privateWriting" class="knorke-sessionbar__seg" data-knorke-session="private">
			<NcIconSvgWrapper class="knorke-sessionbar__icon" :path="icons.eyeOff" :size="20" aria-hidden="true" />
			<span class="knorke-votebar__text">
				<b class="knorke-sessionbar__word">{{ t('knorke', 'Private writing') }}</b>
				<span v-if="privateWriting.frameTitle" class="knorke-sessionbar__muted"> · {{ privateWriting.frameTitle }}</span>
			</span>
			<NcButton v-if="mod"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="private-reveal"
				@click="$emit('private-reveal')">
				{{ t('knorke', 'Reveal') }}
			</NcButton>
		</div>
		<span v-if="privateWriting && !lines && (hasTimer || hasVote || presenting)" class="knorke-sessionbar__sep" aria-hidden="true" />
		<template v-if="!lines">
			<div v-if="hasTimer" class="knorke-sessionbar__seg" data-knorke-session="timer">
				<TimerChip :timer="timer"
					:now="now"
					:mod="mod"
					@open="$emit('timer-open')" />
				<NcButton v-if="mod"
					variant="tertiary"
					:aria-label="t('knorke', 'End timer')"
					:title="t('knorke', 'End timer')"
					:disabled="busy"
					data-knorke-action="timer-end"
					@click="$emit('timer-end')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.close" />
					</template>
				</NcButton>
			</div>
			<span v-if="hasTimer && hasVote" class="knorke-sessionbar__sep" aria-hidden="true" />
			<div v-if="hasVote"
				class="knorke-sessionbar__seg knorke-votebar"
				:class="{ 'knorke-votebar--closed': !votes.open }"
				data-knorke-session="vote"
				data-knorke-bar="vote"
				data-knorke-vote-bar
				:data-knorke-vote-state="votes.state"
				:data-knorke-vote-left="voteLeftHook">
				<template v-if="votes.open">
					<NcIconSvgWrapper class="knorke-sessionbar__icon" :path="icons.vote" :size="20" aria-hidden="true" />
					<span class="knorke-votebar__text">
						<b class="knorke-sessionbar__word">{{ t('knorke', 'Voting') }}</b>
						<span v-if="votes.canVote" class="knorke-votebar__left">{{ leftText }}</span>
						<span v-if="clock" class="knorke-votebar__clock">{{ clock }}</span>
						<span v-if="votedText" class="knorke-sessionbar__muted">· {{ votedText }}</span>
					</span>
					<span v-if="votes.live && !votes.mod" class="knorke-votebar__note" data-knorke-vote-live-note="bar">
						<NcIconSvgWrapper :path="icons.eye" aria-hidden="true" />
						{{ t('knorke', 'Moderators see live counts') }}
					</span>
					<template v-if="votes.accountsOnly">
						<span class="knorke-votebar__note" :data-knorke-vote-accounts="votes.voteBlocked ? 'guest' : 'note'">
							<NcIconSvgWrapper :path="icons.account" aria-hidden="true" />
							{{ accountsText }}
						</span>
						<NcButton v-if="votes.voteBlocked"
							variant="secondary"
							class="knorke-votebar__signin"
							data-knorke-action="vote-signin"
							@click="$emit('signin')">
							{{ t('knorke', 'Sign in') }}
						</NcButton>
					</template>
					<button v-if="votes.canSwitch"
						type="button"
						class="knorke-chip"
						data-knorke-action="vote-mode"
						@click="(e) => $emit('mode', votes.mode !== 'vote', e)">
						{{ votes.mode === 'vote' ? t('knorke', 'Edit') : t('knorke', 'Vote') }}
					</button>
					<NcButton v-if="votes.mod && votes.endsAt !== null"
						variant="tertiary"
						:disabled="busy"
						data-knorke-action="vote-extend"
						@click="$emit('extend')">
						{{ t('knorke', '+5 min') }}
					</NcButton>
					<NcButton variant="tertiary"
						data-knorke-bar="list"
						data-knorke-action="vote-panel"
						:aria-expanded="panelOpen ? 'true' : 'false'"
						@click="$emit('panel')">
						{{ t('knorke', 'List') }}
					</NcButton>
					<NcActions v-if="votes.mod"
						variant="tertiary"
						force-menu
						container="#knorke-menus"
						:aria-label="t('knorke', 'More voting actions')"
						:title="t('knorke', 'More voting actions')"
						data-knorke-action="vote-more">
						<template #icon>
							<NcIconSvgWrapper :path="icons.dotsHorizontal" />
						</template>
						<NcActionButton close-after-click
							data-knorke-action="vote-edit"
							@click="$emit('vote-edit')">
							<template #icon>
								<NcIconSvgWrapper :path="icons.pencil" />
							</template>
							{{ t('knorke', 'Edit voting …') }}
						</NcActionButton>
						<NcActionButton v-if="votes.live"
							type="checkbox"
							:model-value="votes.liveShown === true"
							data-knorke-action="vote-live"
							@click="toggleLive">
							<template #icon>
								<NcIconSvgWrapper :path="icons.eye" />
							</template>
							{{ t('knorke', 'Show live count') }}
						</NcActionButton>
					</NcActions>
					<NcButton v-if="votes.mod"
						variant="secondary"
						:disabled="busy"
						data-knorke-action="vote-end"
						@click="$emit('end')">
						{{ t('knorke', 'End') }}
					</NcButton>
				</template>
				<NcButton v-else
					variant="tertiary"
					class="knorke-votebar__results"
					data-knorke-bar="list"
					data-knorke-action="vote-panel"
					:aria-expanded="panelOpen ? 'true' : 'false'"
					@click="$emit('panel')">
					{{ resultsText }}
				</NcButton>
			</div>
			<span v-if="presenting && (hasTimer || hasVote)" class="knorke-sessionbar__sep" aria-hidden="true" />
			<div v-if="presenting" class="knorke-sessionbar__seg" data-knorke-session="present">
				<NcIconSvgWrapper class="knorke-sessionbar__icon" :path="icons.present" :size="20" aria-hidden="true" />
				<span class="knorke-votebar__text">
					<b class="knorke-sessionbar__word">{{ t('knorke', 'You\'re presenting') }}</b>
				</span>
				<NcButton variant="secondary"
					:disabled="busy"
					data-knorke-action="present-end"
					@click="$emit('present-end')">
					{{ t('knorke', 'End') }}
				</NcButton>
			</div>
		</template>
		<div v-else-if="hasTimer || hasVote || presenting"
			class="knorke-sessionbar__main"
			:class="{ 'knorke-votebar': hasVote, 'knorke-votebar--closed': hasVote && !votes.open }"
			:data-knorke-session="hasVote ? 'vote' : null"
			:data-knorke-bar="hasVote ? 'vote' : null"
			:data-knorke-vote-bar="hasVote ? '' : null"
			:data-knorke-vote-state="hasVote ? votes.state : null"
			:data-knorke-vote-left="voteLeftHook">
			<div class="knorke-sessionbar__lines">
				<span class="knorke-sessionbar__line1">
					<template v-if="hasVote && votes.open">{{ votes.canVote ? leftText : t('knorke', 'Voting') }}</template>
					<NcButton v-else-if="hasVote"
						variant="tertiary"
						class="knorke-votebar__results"
						data-knorke-bar="list"
						data-knorke-action="vote-panel"
						:aria-expanded="panelOpen ? 'true' : 'false'"
						@click="$emit('panel')">
						{{ resultsText }}
					</NcButton>
					<TimerChip v-else-if="hasTimer"
						:timer="timer"
						:now="now"
						:mod="false" />
					<template v-else>{{ t('knorke', 'You\'re presenting') }}</template>
				</span>
				<span v-if="line2.length > 0" class="knorke-sessionbar__line2">
					<template v-for="(part, i) in line2" :key="part">
						<template v-if="i > 0"> · </template>
						<TimerChip v-if="part === 'timer'"
							:timer="timer"
							:now="now"
							:mod="false" />
						<span v-else-if="part === 'clock'" class="knorke-votebar__clock">{{ t('knorke', '{time} left', { time: clock }) }}</span>
						<template v-else-if="part === 'voted'">{{ votedText }}</template>
						<template v-else>{{ t('knorke', 'You\'re presenting') }}</template>
					</template>
				</span>
			</div>
			<template v-if="hasVote && votes.open">
				<button v-if="votes.live && !votes.mod"
					type="button"
					class="knorke-chip knorke-votebar__icon"
					:aria-label="t('knorke', 'Moderators see live counts')"
					:title="t('knorke', 'Moderators see live counts')"
					data-knorke-vote-live-note="bar"
					@click="liveNote">
					<NcIconSvgWrapper :path="icons.eye" aria-hidden="true" />
				</button>
				<template v-if="votes.accountsOnly">
					<button type="button"
						class="knorke-chip knorke-votebar__icon"
						:aria-label="accountsText"
						:title="accountsText"
						:data-knorke-vote-accounts="votes.voteBlocked ? 'guest' : 'note'"
						@click="accountsNote">
						<NcIconSvgWrapper :path="icons.account" aria-hidden="true" />
					</button>
					<NcButton v-if="votes.voteBlocked"
						variant="secondary"
						class="knorke-votebar__signin"
						data-knorke-action="vote-signin"
						@click="$emit('signin')">
						{{ t('knorke', 'Sign in') }}
					</NcButton>
				</template>
				<button v-if="votes.canSwitch"
					type="button"
					class="knorke-chip"
					data-knorke-action="vote-mode"
					@click="(e) => $emit('mode', votes.mode !== 'vote', e)">
					{{ votes.mode === 'vote' ? t('knorke', 'Edit') : t('knorke', 'Vote') }}
				</button>
				<NcButton variant="tertiary"
					data-knorke-bar="list"
					data-knorke-action="vote-panel"
					:aria-expanded="panelOpen ? 'true' : 'false'"
					@click="$emit('panel')">
					{{ t('knorke', 'List') }}
				</NcButton>
			</template>
		</div>
		<template v-if="lines">
			<NcButton v-if="presenting && !mod"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="present-end"
				@click="$emit('present-end')">
				{{ t('knorke', 'End') }}
			</NcButton>
			<NcActions v-if="mod && narrowMore"
				variant="tertiary"
				force-menu
				container="#knorke-menus"
				:aria-label="t('knorke', 'More session actions')"
				:title="t('knorke', 'More session actions')"
				data-knorke-action="session-more">
				<template #icon>
					<NcIconSvgWrapper :path="icons.dotsHorizontal" />
				</template>
				<template v-if="hasVote && votes.open">
					<NcActionButton v-if="votes.endsAt !== null"
						close-after-click
						data-knorke-action="vote-extend"
						@click="$emit('extend')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.timer" />
						</template>
						{{ t('knorke', '+5 min') }}
					</NcActionButton>
					<NcActionButton close-after-click
						data-knorke-action="vote-edit"
						@click="$emit('vote-edit')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.pencil" />
						</template>
						{{ t('knorke', 'Edit voting …') }}
					</NcActionButton>
					<NcActionButton v-if="votes.live"
						type="checkbox"
						:model-value="votes.liveShown === true"
						data-knorke-action="vote-live"
						@click="toggleLive">
						<template #icon>
							<NcIconSvgWrapper :path="icons.eye" />
						</template>
						{{ t('knorke', 'Show live count') }}
					</NcActionButton>
					<NcActionButton close-after-click
						data-knorke-action="vote-end"
						@click="$emit('end')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.close" />
						</template>
						{{ t('knorke', 'End voting') }}
					</NcActionButton>
				</template>
				<NcActionButton v-if="hasTimer"
					close-after-click
					data-knorke-action="timer-end"
					@click="$emit('timer-end')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.close" />
					</template>
					{{ t('knorke', 'End timer') }}
				</NcActionButton>
				<NcActionButton v-if="presenting"
					close-after-click
					data-knorke-action="present-end"
					@click="$emit('present-end')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.close" />
					</template>
					{{ t('knorke', 'Stop presenting') }}
				</NcActionButton>
			</NcActions>
		</template>
		<span class="hidden-visually" aria-live="polite">{{ announce }}</span>
	</div>
</template>

<script setup>
/*
 * Session bar (factory job 233, redesign docs/redesign/ P7, P11, V10): one
 * bar at the bottom centre ([data-knorke-bar=session], region "Session",
 * [data-knorke-chrome]) for what runs on the board: the timer, the dot vote
 * and this tab's presentation. The board view shows it only while one of
 * them runs (meta.timer exists, a vote is open or its results stand, this
 * tab presents). It takes over the VoteBar (SPEC-M1 §6.6 VoteBar, §6.8, R16
 * narrow layout (2): docked at the bottom in every layout) and the timer
 * chip of the top bar.
 *
 * Wide, segments in this order with a line between them:
 * - timer [data-knorke-session=timer]: TimerChip (icon, "Timer", the clock;
 *   a button to the timer dialog for moderators) and, for moderators, ×
 *   "End timer" ([data-knorke-action=timer-end], no question)
 * - vote [data-knorke-session=vote], keeping the VoteBar's hooks
 *   ([data-knorke-bar=vote], [data-knorke-vote-bar], data-knorke-vote-state,
 *   data-knorke-vote-left): open: "Voting", "{left} of {per} votes left"
 *   (canVote), the time (endsAt), "· {n} voted" (only moderators get the
 *   number, SPEC-M1 §7.2); the notices of job 149 ("Moderators see live
 *   counts") and job 175 ("Accounts only", "Sign in"); the switch Edit/Vote
 *   (R17 K5, canSwitch); for moderators "+5 min" (endsAt), "List" (all),
 *   "⋯" ([data-knorke-action=vote-more]: "Edit voting …" vote-edit and,
 *   with live, the check entry "Show live count" vote-live, aria-checked =
 *   liveShown) and "End" (vote-end; the board view asks first). Closed:
 *   "Voting ended · {n} voted · Results" opens the ranking.
 * - presenting [data-knorke-session=present]: "You're presenting" and "End"
 *   ([data-knorke-action=present-end]).
 * Job 275: first, in both forms, private writing [data-knorke-session=private]:
 * "Private writing" (with the frame's title) and, for moderators, "Reveal"
 * ([data-knorke-action=private-reveal]).
 * The text parts keep their whole width. (Round 3) When the one-line bar
 * does not fit (bars.js sessionOverflows: the bar or a text block runs over,
 * e.g. German texts while presenting during a timed vote), it turns into
 * the two-line form of the narrow layout over the board's width
 * (.knorke-sessionbar--compact, event compact for the board's bar height);
 * it tries one line again when the segments change or the window grows
 * beyond the width it overflowed at.
 * Narrow (≤ 600 px): the full width at the viewport's bottom, two lines on
 * the left; lines, notices, Edit/Vote and "List" form one block that carries
 * the vote's hooks while a vote is there. Line 1: "{left} of {per} votes left" (else "Voting"), the
 * results button, the timer or "You're presenting"; line 2: the rest joined
 * with " · " (the vote's time, the timer, "{n} voted", "You're presenting").
 * (Round 5) In the two lines the timer is text, not a button, also for
 * moderators (a 18 px line is no touch target): they open the timer dialog
 * with "Timer …" of the moderation menu.
 * Buttons on the right, at least 44 px: the notices as symbols (a tap
 * toasts the sentence), Edit/Vote, "List", "End" for a presenter who does
 * not moderate, and for moderators "⋯" ([data-knorke-action=session-more])
 * with "+5 min", "Edit voting …", "Show live count", "End voting", "End
 * timer" and "Stop presenting", each when it applies.
 * The polite live region speaks the own count after a vote ("Vote added, 3
 * of 5 left", §6.12) and the start and end of a session.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import TimerChip from './TimerChip.vue'
import { n, t } from '../util/l10n.js'
import { sessionOverflows } from './bars.js'
import { timerOf, voteClock } from './countdown.js'
import { icons } from './icons.js'

const props = defineProps({
	/** BoardSession.votesView(), null without a session */
	votes: { type: Object, default: null },
	/** meta.timer (raw), null without a timer */
	timer: { type: Object, default: null },
	/** server time of the display tick */
	now: { type: Number, default: 0 },
	narrow: { type: Boolean, default: false },
	/** this client may moderate (timer and presentation controls) */
	mod: { type: Boolean, default: false },
	/** this tab presents (meta.summon = me and this client) */
	presenting: { type: Boolean, default: false },
	panelOpen: { type: Boolean, default: false },
	busy: { type: Boolean, default: false },
	/** job 275: private writing runs: {frameTitle} ('' for the whole board), else null */
	privateWriting: { type: Object, default: null },
})

const emit = defineEmits(['mode', 'panel', 'end', 'extend', 'live', 'live-note', 'signin', 'accounts-note', 'vote-edit', 'timer-open', 'timer-end', 'present-end', 'private-reveal', 'compact'])

const root = ref(null)
/** round 3: the one-line bar did not fit, the two-line form stands in */
const compact = ref(false)
/** the two-line form: narrow layout or compact */
const lines = computed(() => props.narrow || compact.value)
/** the window width at which the one-line bar last overflowed */
let overflowAt = Infinity

const hasVote = computed(() => !!props.votes?.state)
const hasTimer = computed(() => timerOf(props.timer) !== null)
const clock = computed(() => (props.votes?.open ? voteClock(props.votes.endsAt, props.now) : null))
/** "{left} of {per} votes left", the plural after per ("1 of 3 votes left") */
const leftText = computed(() => n('knorke', '{left} of %n vote left', '{left} of %n votes left', props.votes?.per ?? 0, { left: props.votes?.left ?? 0 }))
/** moderators only (§7.2): the number of voters of an open session */
const votedText = computed(() => (props.votes?.open && props.votes.mod && props.votes.voters !== null ? n('knorke', '%n voted', '%n voted', props.votes.voters) : null))
const resultsText = computed(() => n('knorke', 'Voting ended · %n voted · Results', 'Voting ended · %n voted · Results', props.votes?.voters ?? 0))
const voteLeftHook = computed(() => (hasVote.value && props.votes.open && props.votes.left !== null ? props.votes.left : null))
/** job 175: the notice of a session with accountsOnly (the longer sentence for a guest kept from voting) */
const accountsText = computed(() => (props.votes?.voteBlocked ? t('knorke', 'Only signed-in accounts can vote.') : t('knorke', 'Accounts only')))
/** narrow: what line 2 holds, in order ('clock', 'timer', 'voted', 'present') */
const line2 = computed(() => {
	const out = []
	const open = hasVote.value && props.votes.open
	if (open && clock.value) out.push('clock')
	if (hasVote.value && hasTimer.value) out.push('timer')
	if (votedText.value) out.push('voted')
	if (props.presenting && (hasVote.value || hasTimer.value)) out.push('present')
	return out
})
/** narrow: the moderator's "⋯" has an entry */
const narrowMore = computed(() => (hasVote.value && props.votes.open) || hasTimer.value || props.presenting)
const announce = ref('')
/** what the one-line bar holds: a change tries one line again */
const shape = computed(() => [props.narrow, hasTimer.value, props.votes?.state ?? null, props.votes?.open === true, props.presenting, props.mod, props.votes?.mod === true, props.votes?.canVote === true, props.votes?.canSwitch === true, props.votes?.live === true, props.votes?.accountsOnly === true, props.votes?.voteBlocked === true].join())

/** round 3: switches to the two-line form when the one-line bar runs over */
function fit() {
	const el = root.value
	if (props.narrow || compact.value || !el || typeof window === 'undefined') {
		return
	}
	const texts = [...el.querySelectorAll('.knorke-votebar__text')].map((x) => [x.clientWidth, x.scrollWidth])
	if (sessionOverflows({ client: el.clientWidth, scroll: el.scrollWidth, texts })) {
		compact.value = true
		overflowAt = window.innerWidth
	}
}

/** round 3: tries one line again (after a change of the segments, or a window wider than at the overflow) */
function retry() {
	compact.value = false
	overflowAt = Infinity
	nextTick(fit)
}

function onResize() {
	if (compact.value && typeof window !== 'undefined' && window.innerWidth > overflowAt) {
		retry()
	} else {
		fit()
	}
}

watch(shape, () => retry())
watch(lines, (on) => emit('compact', on && !props.narrow))
onMounted(() => {
	window.addEventListener('resize', onResize)
	nextTick(fit)
})
onUpdated(fit)
onBeforeUnmount(() => {
	window.removeEventListener('resize', onResize)
	emit('compact', false)
})

/** job 149: "Show live count" flips this tab's board counts */
function toggleLive() {
	emit('live', props.votes?.liveShown !== true)
}

/** job 149: the narrow eye asks the board to toast the notice */
function liveNote() {
	emit('live-note')
}

/** job 175: the narrow symbol asks the board to toast the notice */
function accountsNote() {
	emit('accounts-note')
}

watch(() => [props.votes?.sid ?? null, props.votes?.state ?? null, props.votes?.left ?? null], ([sid, state, left], old) => {
	const [osid, ostate, oleft] = old ?? [null, null, null]
	const v = props.votes
	if (state === 'open' && (sid !== osid || ostate !== 'open')) {
		const minutes = v.endsAt !== null ? Math.max(1, Math.round((v.endsAt - props.now) / 60000)) : null
		announce.value = minutes !== null
			? n('knorke', 'Voting started, %n votes, {minutes} minutes', 'Voting started, %n votes, {minutes} minutes', v.per, { minutes })
			: n('knorke', 'Voting started, %n vote', 'Voting started, %n votes', v.per)
	} else if (state === 'closed' && ostate === 'open' && sid === osid) {
		announce.value = t('knorke', 'Voting ended, results available')
	} else if (state === 'open' && sid === osid && Number.isInteger(left) && Number.isInteger(oleft) && left !== oleft) {
		announce.value = left < oleft
			? t('knorke', 'Vote added, {left} of {per} left', { left, per: v.per })
			: t('knorke', 'Vote removed, {left} of {per} left', { left, per: v.per })
	}
}, { immediate: false })
</script>
