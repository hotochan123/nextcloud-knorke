<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="root"
		class="knorke-votestepper"
		role="group"
		:aria-label="label"
		:style="style"
		:data-knorke-vote-stepper="id"
		@keydown.esc.stop.prevent="$emit('close')">
		<button type="button"
			class="knorke-votestepper__step"
			:disabled="mine <= 0"
			:aria-label="t('knorke', 'Remove a vote from “{text}”', { text: text || t('knorke', '(no text)') })"
			data-knorke-action="vote-remove"
			@click="$emit('set', mine - 1)">
			−
		</button>
		<span class="knorke-votestepper__count" aria-live="polite">{{ mine }} / {{ perItem }}</span>
		<button type="button"
			class="knorke-votestepper__step"
			:disabled="mine >= perItem"
			:aria-label="t('knorke', 'Add a vote to “{text}”', { text: text || t('knorke', '(no text)') })"
			data-knorke-action="vote-add"
			@click="$emit('set', mine + 1)">
			+
		</button>
		<button type="button"
			class="knorke-votestepper__close"
			:aria-label="t('knorke', 'Close')"
			data-knorke-action="vote-stepper-close"
			@click="$emit('close')">
			×
		</button>
	</div>
</template>

<script setup>
/*
 * Vote stepper at an item (SPEC-M1 §6.5.5, §6.6 VoteStepper, §6.8): opens on
 * a tap/click in mode vote when a session allows more than one vote per
 * item. DOM above the canvas at the item's screen rectangle (rect of the
 * vote intent = itemScreenRect, container px, R16 CLI-18), every button
 * (−, +, ×) ≥ 44 × 44 px (§6.12). Esc, the close button
 * ([data-knorke-action=vote-stepper-close]) or a pointerdown elsewhere
 * close it; the session closes it on a camera change and when its item,
 * the mode or the right to vote goes (R22, P7-08).
 * (R22, P7-08) Clamped into the board container (components/voteLayout.js
 * stepperCentre): measured right after mounting, again when the rect
 * changes and on a window resize.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { stepperCentre } from './voteLayout.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	id: { type: String, required: true },
	/** {x, y, w, h} container px */
	rect: { type: Object, default: null },
	mine: { type: Number, default: 0 },
	perItem: { type: Number, default: 1 },
	left: { type: Number, default: 0 },
	text: { type: String, default: '' },
})

const emit = defineEmits(['set', 'close'])

const root = ref(null)
/** {w, h, bw, bh}: the stepper and its board container in px (null until measured) */
const measured = ref(null)
const label = computed(() => t('knorke', 'Vote for "{text}", {mine} of {perItem}', { text: props.text || t('knorke', '(no text)'), mine: props.mine, perItem: props.perItem }))
const style = computed(() => {
	const c = stepperCentre(props.rect, measured.value)
	if (!c) {
		return { left: '50%', top: '50%' }
	}
	return { left: c.x + 'px', top: c.y + 'px' }
})

/** Measures the stepper and the board container (its parent) for the clamping. */
function measure() {
	const el = root.value
	const box = el?.parentElement
	if (!el || !box) {
		return
	}
	measured.value = { w: el.offsetWidth, h: el.offsetHeight, bw: box.clientWidth, bh: box.clientHeight }
}

watch(() => props.rect, () => nextTick(measure))

const onDown = (e) => {
	if (root.value && e?.target && !root.value.contains(e.target)) {
		emit('close')
	}
}

onMounted(() => {
	measure()
	document.addEventListener('pointerdown', onDown, true)
	window.addEventListener('resize', measure)
	root.value?.querySelector?.('button:not([disabled])')?.focus?.({ preventScroll: true })
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onDown, true)
	window.removeEventListener('resize', measure)
})
</script>
