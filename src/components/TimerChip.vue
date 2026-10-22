<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<component :is="mod ? 'button' : 'div'"
		v-if="view"
		:type="mod ? 'button' : null"
		class="knorke-timerchip"
		:class="'knorke-timerchip--' + view.state"
		data-knorke-bar="timer"
		data-knorke-timer
		:data-knorke-timer-state="view.state"
		:data-knorke-timer-left="view.leftMs"
		:aria-label="mod ? t('knorke', 'Timer') : null"
		:title="t('knorke', 'Timer')"
		@click="mod && $emit('open')">
		<span role="timer" aria-atomic="true">
			<span class="hidden-visually">{{ t('knorke', 'Timer') }}</span>
			{{ view.state === 'done' ? t('knorke', 'Time\'s up') : view.text }}
		</span>
		<span v-if="view.state === 'paused'" class="knorke-timerchip__paused">{{ t('knorke', 'Paused') }}</span>
	</component>
	<span class="hidden-visually" aria-live="polite">{{ announce }}</span>
</template>

<script setup>
/*
 * Timer chip in the top bar (SPEC-M1 §6.6 TimerChip, §6.8, §6.12): the rest
 * of meta.timer in server time ([data-knorke-timer] with
 * data-knorke-timer-state=running|paused|done and data-knorke-timer-left =
 * the shown rest in ms, rounded up to whole seconds; R16 TST-09). The rest
 * sits in role="timer" (aria-live off) and an own polite live region names
 * only the milestones: start, 1 minute, 10 seconds, end (never every
 * second, no blinking). For moderators the chip is a button that opens the
 * timer dialog. The view ticks on the clock prop of the board (one timeout
 * to the next full second there, never the scene's frames).
 */
import { computed, ref, watch } from 'vue'
import { t } from '../util/l10n.js'
import { formatClock, milestone, timerOf, timerView } from './countdown.js'

const props = defineProps({
	/** meta.timer (raw), null/undefined = none */
	timer: { type: Object, default: null },
	/** server time of the board's display tick */
	now: { type: Number, default: 0 },
	/** moderator: the chip opens the timer dialog */
	mod: { type: Boolean, default: false },
})

defineEmits(['open'])

const view = computed(() => timerView(timerOf(props.timer), props.now))
const announce = ref('')
let prev = null
let prevSeq = null

watch(() => [view.value?.leftMs ?? null, view.value?.state ?? null, timerOf(props.timer)?.seq ?? null], ([left, state, seq]) => {
	if (left === null) {
		prev = null
		prevSeq = null
		return
	}
	if (seq !== prevSeq) {
		// a new start (or a change by a moderator): announce the rest once
		if (prevSeq === null || state === 'running') {
			announce.value = state === 'done' ? t('knorke', 'Time\'s up') : t('knorke', 'Timer started: {time}', { time: formatClock(left) })
		}
		prevSeq = seq
		prev = left
		return
	}
	const m = state === 'paused' ? null : milestone(prev, left)
	prev = left
	if (m === 'minute') {
		announce.value = t('knorke', '1 minute left')
	} else if (m === 'seconds') {
		announce.value = t('knorke', '10 seconds left')
	} else if (m === 'end') {
		announce.value = t('knorke', 'Time\'s up')
	}
}, { immediate: true })
</script>
