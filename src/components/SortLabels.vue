<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-sortlabels" data-knorke-sort-labels>
		<template v-for="l in labels" :key="l.i">
			<input v-if="pos.has(l.i)"
				:ref="(el) => setField(l.i, el)"
				type="text"
				class="knorke-sortlabel"
				data-knorke-sort-label
				:data-knorke-sort-color="l.color"
				:data-knorke-sort-index="l.i"
				:placeholder="hint"
				:aria-label="hint"
				:maxlength="MAX_NAME"
				autocomplete="off"
				enterkeyhint="done"
				:style="styleOf(l.i)"
				@input="(e) => $emit('input', l.i, e.target.value)"
				@keydown="(e) => onKey(e, l.i)"
				@blur="(e) => onBlur(e, l.i)">
		</template>
	</div>
</template>

<script setup>
/*
 * The name fields after "Sort by color" (factory job 139): one single-line
 * field input[data-knorke-sort-label][data-knorke-sort-color] per open block
 * of the session (ui.onSortLabels), seen only by the person who sorted;
 * nothing goes to the server until a name is saved as a text item.
 *
 * - Place: a sibling of .knorke-canvas in .knorke-board (presses on a field
 *   never reach the canvas). Every animation frame reads the places from
 *   the session (prop places = BoardSession.sortLabelPlaces, the live
 *   camera): left on the block's left edge, the bottom edge LABEL_GAP px
 *   above the block's top edge, as wide as the block on screen, at least
 *   LABEL_MIN_W px; 32 px high (44 px for a coarse pointer, knorke.css).
 * - Typing reports input(i, value) (the session saves it when the fields
 *   end). Leaving a field with a name (trimmed, not empty) by Enter, Tab or
 *   blur emits name(i, value); Enter then gives the canvas the focus (canvas),
 *   an empty Enter does nothing. Tab / Shift+Tab go to the next / previous
 *   field, round the list (the canvas when none is left).
 * - Esc in a field or on the canvas host and a press outside the fields
 *   (canvas, bars; capture phase on the document) emit end (the session
 *   saves the typed names and ends all fields); Esc also gives the canvas
 *   the focus and goes no further.
 * - focusFirst() (exposed): the first field takes the focus (the board view
 *   calls it after a keyboard activation of the command).
 */
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { t } from '../util/l10n.js'

const props = defineProps({
	/** the open blocks of the session ([{i, color, x, y, w, h, parent}], ui.onSortLabels) */
	labels: { type: Array, required: true },
	/** () => [{i, color, x, y, w}] container px of the blocks now (BoardSession.sortLabelPlaces) */
	places: { type: Function, required: true },
})

const emit = defineEmits(['input', 'name', 'end', 'canvas'])

/** Gap between a field's bottom edge and its block's top edge (px). */
const LABEL_GAP = 8
/** Smallest width of a field (px). */
const LABEL_MIN_W = 120
/** Longest name (the rule of data.text). */
const MAX_NAME = 6000

const hint = t('knorke', 'Name this group…')
/** i → {left, top, width} (board px; top = where the bottom edge goes) */
const pos = shallowRef(new Map())
/** i → the field element */
const fields = new Map()
let raf = 0

/**
 * @param {number} i block
 * @param {HTMLInputElement|null} el its field
 */
function setField(i, el) {
	if (el) {
		fields.set(i, el)
	} else {
		fields.delete(i)
	}
}

/**
 * @param {number} i block
 * @return {object} inline place of its field
 */
function styleOf(i) {
	const p = pos.value.get(i)
	return p ? { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px` } : undefined
}

/** Reads the places (one animation frame); only real changes go into pos. */
function measure() {
	let list = []
	try {
		list = props.places() ?? []
	} catch (e) {
		list = []
	}
	const old = pos.value
	const next = new Map()
	let changed = list.length !== old.size
	for (const p of list) {
		const v = { left: Math.round(p.x), top: Math.round(p.y - LABEL_GAP), width: Math.max(LABEL_MIN_W, Math.round(p.w)) }
		next.set(p.i, v)
		const o = old.get(p.i)
		if (!o || o.left !== v.left || o.top !== v.top || o.width !== v.width) {
			changed = true
		}
	}
	if (changed) {
		pos.value = next
	}
}

function frame() {
	measure()
	raf = requestAnimationFrame(frame)
}

// the first render already has the places (focusFirst right after it finds the fields)
measure()

/** @return {HTMLInputElement[]} the fields in the order of the blocks */
function ordered() {
	return props.labels.map((l) => fields.get(l.i)).filter((el) => !!el)
}

/** The first field takes the focus (after a keyboard activation of the command). */
function focusFirst() {
	ordered()[0]?.focus({ preventScroll: true })
}

/**
 * @param {KeyboardEvent} e keydown in a field
 * @param {number} i its block
 */
function onKey(e, i) {
	if (e.isComposing) {
		return
	}
	const value = e.target.value
	const named = value.trim() !== ''
	if (e.key === 'Enter') {
		e.preventDefault()
		if (named) {
			emit('name', i, value)
			emit('canvas')
		}
	} else if (e.key === 'Tab') {
		e.preventDefault()
		const list = ordered()
		const at = list.indexOf(e.target)
		const step = e.shiftKey ? -1 : 1
		// the next field round the list, never this one when it goes with its name
		let next = null
		for (let k = 1; k <= list.length; k++) {
			const el = list[(((at + step * k) % list.length) + list.length) % list.length]
			if (el !== e.target || !named) {
				next = el
				break
			}
		}
		if (named) {
			emit('name', i, value)
		}
		if (next && next !== e.target) {
			next.focus({ preventScroll: true })
		} else if (!next) {
			emit('canvas')
		}
	}
}

/**
 * @param {FocusEvent} e blur of a field
 * @param {number} i its block
 */
function onBlur(e, i) {
	const value = e.target?.value ?? ''
	if (value.trim() !== '') {
		emit('name', i, value)
	}
}

/** @param {PointerEvent} e any press (document, capture phase): outside the fields the fields end */
function onDocDown(e) {
	if (!e?.target?.closest?.('[data-knorke-sort-label]')) {
		emit('end')
	}
}

/** @param {KeyboardEvent} e any key (document, capture phase): Esc in a field or on the canvas ends the fields */
function onDocKey(e) {
	if (e.key !== 'Escape' || e.isComposing) {
		return
	}
	const target = e.target
	if (!target?.closest?.('[data-knorke-sort-label]') && !target?.classList?.contains('knorke-canvas')) {
		return
	}
	e.preventDefault()
	e.stopPropagation()
	emit('end')
	emit('canvas')
}

onMounted(() => {
	document.addEventListener('pointerdown', onDocDown, true)
	document.addEventListener('keydown', onDocKey, true)
	if (typeof requestAnimationFrame === 'function') {
		raf = requestAnimationFrame(frame)
	}
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onDocDown, true)
	document.removeEventListener('keydown', onDocKey, true)
	if (raf) {
		cancelAnimationFrame(raf)
	}
	raf = 0
})

defineExpose({ focusFirst })
</script>
