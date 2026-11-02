<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="root"
		class="knorke-reactpicker"
		role="dialog"
		:aria-label="t('knorke', 'Add reaction')"
		data-knorke-reactions="pick"
		:style="style"
		@keydown="onKey">
		<div class="knorke-reactpicker__row" role="group" :aria-label="t('knorke', 'Reactions')">
			<button v-for="(e, i) in QUICK_REACTIONS"
				:key="e"
				:ref="(el) => setButton(el, i)"
				type="button"
				class="knorke-reactpicker__emoji"
				:class="{ 'knorke-reactpicker__emoji--mine': e === mine }"
				:aria-pressed="e === mine ? 'true' : 'false'"
				:data-knorke-react="e"
				@click="$emit('pick', e)">
				{{ fromHex(e) }}
			</button>
			<button :ref="(el) => setButton(el, QUICK_REACTIONS.length)"
				type="button"
				class="knorke-reactpicker__more"
				data-knorke-react="more"
				@click="more">
				{{ t('knorke', 'More…') }}
			</button>
		</div>
		<p v-if="failed"
			class="knorke-reactpicker__error"
			role="alert"
			data-knorke-reactions="error">
			{{ t('knorke', 'The emoji list could not be loaded. Reload the page.') }}
		</p>
		<component :is="full"
			v-if="full"
			ref="fullEl"
			:container="root"
			@select="onSelect">
			<span class="knorke-reactpicker__anchor" aria-hidden="true" />
		</component>
	</div>
</template>

<script setup>
/*
 * The reaction picker of a note (factory job 172, [data-knorke-reactions=pick]):
 * a DOM popover at the smiley-plus button, below the context bar's "Add
 * reaction" or at the menu's point (prop rect, board px; components/
 * reactions.js popoverPlace, measured after mounting and on a window
 * resize). The quick row: 👍 ❤️ 😂 🎉 🤔 👀 ([data-knorke-react=<e>], the own
 * one with aria-pressed="true") and "More…" ([data-knorke-react=more]).
 * The focus starts on the own emoji (else the first); the arrows wander,
 * Home and End jump (reactions.js quickKey), Enter and Space choose; Esc
 * and a pointerdown beside it close it (the view gives the canvas the
 * focus). A choice emits pick(e) (the session closes it and reacts).
 *
 * "More…" loads the emoji chunk (NcEmojiPicker with emoji-mart-vue-fast and
 * its data, js/emoji-*.chunk.mjs) by a dynamic import the first time and
 * opens NcEmojiPicker at the same place, inside this popover (its container),
 * so a press in it is no press beside the picker; its choice emits pick(e)
 * (model/reactions.js toHex), closing it closes the picker. When the import
 * fails, the hint "The emoji list could not be loaded. Reload the page."
 * ([data-knorke-reactions=error]) shows and the quick row stays.
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { QUICK_REACTIONS, fromHex, toHex } from '../model/reactions.js'
import { popoverPlace, quickKey } from './reactions.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	/** {x, y, w, h} board px: where it opens (below this box) */
	rect: { type: Object, default: null },
	/** the own emoji on the note (hex form), null without one */
	mine: { type: String, default: null },
})

const emit = defineEmits(['pick', 'close'])

const root = ref(null)
/** the buttons of the quick row (six emoji and "More…") */
const buttons = []
/** NcEmojiPicker once its chunk is loaded */
const full = shallowRef(null)
const fullEl = ref(null)
/** the chunk could not be loaded */
const failed = ref(false)
/** the full picker was open (closing it closes this popover) */
let fullWasOpen = false
/** {w, h, bw, bh}: the popover and its board in px (null until measured) */
const measured = ref(null)

const style = computed(() => {
	const m = measured.value
	const p = popoverPlace(props.rect, m ? { w: m.w, h: m.h } : null, m ? { w: m.bw, h: m.bh } : null)
	return { left: p.x + 'px', top: p.y + 'px' }
})

/**
 * @param {HTMLElement|null} el a button
 * @param {number} i its place in the row
 */
function setButton(el, i) {
	buttons[i] = el
}

/** Measures the popover and the board (its parent) for the placement. */
function measure() {
	const el = root.value
	const box = el?.parentElement
	if (!el || !box) {
		return
	}
	measured.value = { w: el.offsetWidth, h: el.offsetHeight, bw: box.clientWidth, bh: box.clientHeight }
}

/**
 * Esc closes; on the quick row the arrows, Home and End move the focus.
 * Keys never reach the scene (its Esc would clear the selection).
 *
 * @param {KeyboardEvent} e keydown
 */
function onKey(e) {
	if (e.key === 'Escape') {
		e.preventDefault()
		e.stopPropagation()
		emit('close')
		return
	}
	const index = buttons.indexOf(e.target)
	if (index < 0) {
		// the full picker keeps its keys
		return
	}
	const next = quickKey(e.key, index, QUICK_REACTIONS.length + 1)
	if (next === null) {
		return
	}
	e.preventDefault()
	e.stopPropagation()
	buttons[next]?.focus?.()
}

/** "More…": the emoji chunk on first use, then NcEmojiPicker at the same place. */
async function more() {
	failed.value = false
	if (full.value === null) {
		try {
			const m = await import('@nextcloud/vue/components/NcEmojiPicker')
			full.value = markRaw(m.default)
		} catch (err) {
			console.error('[knorke] the emoji list could not be loaded', err)
			failed.value = true
			nextTick(measure)
			return
		}
	}
	await nextTick()
	if (fullEl.value) {
		fullEl.value.open = true
	}
}

/**
 * @param {string} native the emoji NcEmojiPicker chose
 */
function onSelect(native) {
	const e = toHex(native)
	if (e !== null) {
		emit('pick', e)
	}
}

// closing the full picker (Esc, a press beside it) closes the whole popover
watch(() => fullEl.value?.open === true, (open) => {
	if (open) {
		fullWasOpen = true
	} else if (fullWasOpen) {
		fullWasOpen = false
		emit('close')
	}
})
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
	const own = props.mine === null ? -1 : QUICK_REACTIONS.indexOf(props.mine)
	buttons[own >= 0 ? own : 0]?.focus?.({ preventScroll: true })
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onDown, true)
	window.removeEventListener('resize', measure)
})
</script>
