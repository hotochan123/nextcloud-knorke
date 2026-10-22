<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="t('knorke', 'Timer')"
		size="small"
		class="knorke-dialog knorke-timerdialog"
		data-knorke-dialog="timer"
		@update:open="(o) => !o && $emit('close')">
		<!-- NcModal ignores Esc inside inputs (useHotKey): the fields close the dialog themselves -->
		<div class="knorke-timerdialog__body" @keydown.esc.stop.prevent="$emit('close')">
		<p v-if="view" class="knorke-timerdialog__rest" aria-live="off">
			{{ view.state === 'done' ? t('knorke', 'Time\'s up') : view.text }}
			<span v-if="view.state === 'paused'">({{ t('knorke', 'Paused') }})</span>
		</p>
		<div class="knorke-timerdialog__row" role="group" :aria-label="t('knorke', 'Duration')">
			<button v-for="m in PRESETS"
				:key="m"
				type="button"
				class="knorke-chip"
				:class="{ 'knorke-chip--active': minutes === String(m) }"
				:disabled="busy"
				:aria-pressed="minutes === String(m) ? 'true' : 'false'"
				@click="minutes = String(m)">
				{{ n('knorke', '%n min', '%n min', m) }}
			</button>
		</div>
		<label class="knorke-timerdialog__field">
			<span>{{ t('knorke', 'Minutes') }}</span>
			<input v-model="minutes"
				type="number"
				min="0.1"
				max="99.98"
				step="any"
				inputmode="decimal"
				:disabled="busy"
				data-knorke-field="timer-minutes"
				@keydown.enter.prevent="start">
		</label>
		<p v-if="tooLong" class="knorke-dialog__error" role="alert">
			{{ t('knorke', 'At most 99:59.') }}
		</p>
		<label class="knorke-timerdialog__mute">
			<input type="checkbox"
				:checked="muted"
				@change="(e) => $emit('mute', e.target.checked)">
			<span>{{ t('knorke', 'Mute sound') }}</span>
		</label>
		</div>
		<template #actions>
			<NcButton v-if="running"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="timer-pause"
				@click="$emit('action', 'pause')">
				{{ t('knorke', 'Pause') }}
			</NcButton>
			<NcButton v-if="paused"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="timer-resume"
				@click="$emit('action', 'resume')">
				{{ t('knorke', 'Resume') }}
			</NcButton>
			<NcButton v-if="exists"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="timer-add1"
				@click="$emit('action', 'add', 60000)">
				{{ t('knorke', '+1 min') }}
			</NcButton>
			<NcButton v-if="exists"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="timer-add5"
				@click="$emit('action', 'add', 300000)">
				{{ t('knorke', '+5 min') }}
			</NcButton>
			<NcButton v-if="timer"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="timer-stop"
				@click="$emit('action', 'stop')">
				{{ t('knorke', 'Stop') }}
			</NcButton>
			<NcButton variant="primary"
				:disabled="busy || ms === null"
				data-knorke-action="timer-start"
				@click="start">
				{{ t('knorke', 'Start') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * Timer dialog of a moderator (SPEC-M1 §6.6 TimerDialog, §6.8, §4.12.2):
 * start with 1/3/5/10/15 minutes or any duration up to 99:59
 * ([data-knorke-field=timer-minutes], minutes, decimals allowed), pause,
 * resume, +1 min, +5 min, stop ([data-knorke-action=timer-*]), and the
 * viewer's own "Mute sound" (util/sound.js). Every button emits
 * action(action, ms?); the board calls route 24 once (never repeated
 * automatically) and the answer comes back over the meta path.
 * (R17 K3) "+1 min" and "+5 min" show whenever a timer exists (running,
 * paused, or run out: route 24 'add' on a run-out timer sets end = now + ms,
 * §4.12.2); "Pause" only for a running timer that has not run out.
 */
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { n, t } from '../util/l10n.js'
import { timerOf, timerView } from './countdown.js'

/** Preset durations in minutes. */
const PRESETS = [1, 3, 5, 10, 15]
/** TIMER_MAX_MS (§4.8): 99:59. */
const MAX_MS = 5999000

const props = defineProps({
	timer: { type: Object, default: null },
	now: { type: Number, default: 0 },
	busy: { type: Boolean, default: false },
	muted: { type: Boolean, default: false },
})

const emit = defineEmits(['action', 'close', 'mute'])

const minutes = ref('5')
const parsed = computed(() => timerOf(props.timer))
const view = computed(() => timerView(parsed.value, props.now))
/** a timer exists: running (also run out) or paused (R17 K3: "+1 min" / "+5 min") */
const exists = computed(() => parsed.value !== null)
/** running and not run out ("Pause") */
const running = computed(() => view.value?.state === 'running')
const paused = computed(() => view.value?.state === 'paused')
const raw = computed(() => {
	const v = Number(String(minutes.value).replace(',', '.'))
	return Number.isFinite(v) && v > 0 ? Math.round(v * 60000) : null
})
const tooLong = computed(() => raw.value !== null && raw.value > MAX_MS)
/** ms of the start: 1 s … 99:59, else null (Start disabled) */
const ms = computed(() => (raw.value !== null && raw.value >= 1000 && raw.value <= MAX_MS ? raw.value : null))

function start() {
	if (ms.value !== null && !props.busy) {
		emit('action', 'start', ms.value)
	}
}
</script>
