<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<form class="knorke-arrange"
		:class="{ 'knorke-arrange--square': squarable }"
		data-knorke-dialog="arrange"
		:aria-label="t('knorke', 'Arrange')"
		@submit.prevent="apply">
		<NcTextField :model-value="x"
			class="knorke-arrange__field"
			type="number"
			step="any"
			label="X"
			data-knorke-field="arrange-x"
			@update:model-value="(v) => edit('x', v)"
			@keydown.enter.prevent="apply" />
		<NcTextField :model-value="y"
			class="knorke-arrange__field"
			type="number"
			step="any"
			label="Y"
			data-knorke-field="arrange-y"
			@update:model-value="(v) => edit('y', v)"
			@keydown.enter.prevent="apply" />
		<NcTextField :model-value="w"
			class="knorke-arrange__field"
			type="number"
			step="any"
			min="0"
			:label="t('knorke', 'Width')"
			:disabled="!resizable"
			data-knorke-field="arrange-w"
			@update:model-value="(v) => edit('w', v)"
			@keydown.enter.prevent="apply" />
		<NcTextField :model-value="ticked ? w : h"
			class="knorke-arrange__field"
			type="number"
			step="any"
			min="0"
			:label="t('knorke', 'Height')"
			:disabled="!resizable || measured || ticked"
			data-knorke-field="arrange-h"
			@update:model-value="(v) => edit('h', v)"
			@keydown.enter.prevent="apply" />
		<label v-if="squarable"
			class="knorke-arrange__square"
			:title="t('knorke', 'Keep square (1:1)')">
			<input type="checkbox"
				:checked="ticked"
				:aria-label="t('knorke', 'Keep square (1:1)')"
				data-knorke-field="arrange-square"
				@change="tick">
			<span aria-hidden="true">1:1</span>
		</label>
		<NcTextField :model-value="r"
			class="knorke-arrange__field"
			type="number"
			step="any"
			:label="t('knorke', 'Angle')"
			:disabled="!rotatable"
			data-knorke-field="arrange-r"
			@update:model-value="(v) => edit('r', v)"
			@keydown.enter.prevent="apply" />
		<NcButton type="submit"
			variant="primary"
			class="knorke-arrange__apply"
			data-knorke-action="arrange-apply">
			{{ t('knorke', 'Apply') }}
		</NcButton>
	</form>
</template>

<script setup>
/*
 * "Arrange" field of the context bar (SPEC-M1 §6.6, WCAG 2.5.7): X, Y,
 * width, height and angle of the one selected item as numbers, a
 * keyboard and single-pointer alternative to dragging the transformer.
 * Enter in any field (or Apply) emits apply({x, y, w, h, r}) with the
 * absolute world box; empty or non-numeric fields keep their value. Width
 * and height are off for items without handles, the height of a text item
 * is measured (never typed), the angle is off for types that cannot rotate
 * (frames). Fields: [data-knorke-field=arrange-x|y|w|h|r] (§6.8).
 *
 * Job 146 (R22): the fields follow the box. Every new box sets each field
 * without an open input (typed, not applied yet; it stays open while the
 * focus moves on with Tab, until Apply or the panel closes), so a field
 * being typed in keeps its value, focus and caret. Apply ends every open
 * input: from the next box on all fields show the real position.
 *
 * Job 240: for one shape the tick "1:1" ([data-knorke-field=arrange-square],
 * `square` = model/shapes.js squareOn as the session reports it) between
 * height and angle. Ticked, the height is locked and shows the width (also
 * while it is typed), and Apply sends h = w, also when unticking (what the
 * height field showed). A change of the tick applies at
 * once: apply({…, square}) with the fields as they are (one patch, one undo
 * step). The tick always shows `square`: the session's next report sets it.
 */
import { computed, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { typeInfo } from '../model/registry.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	box: { type: Object, default: null },
	rotatable: { type: Boolean, default: false },
	types: { type: [Set, Array], default: () => [] },
	// job 240: the tick "1:1" of the one selected shape
	square: { type: Boolean, default: false },
})

const emit = defineEmits(['apply'])

const x = ref('')
const y = ref('')
const w = ref('')
const h = ref('')
const r = ref('')
const fields = { x, y, w, h, r }
/** fields with an open input (typed, not applied yet) */
const open = new Set()

/**
 * @param {unknown} v number
 * @return {string} the value with at most two decimals, for the field
 */
function show(v) {
	return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : ''
}

/**
 * Input of the user in one field: it stays as typed until Apply.
 *
 * @param {string} name x, y, w, h or r
 * @param {string|number} v the field's new value
 */
function edit(name, v) {
	fields[name].value = v
	open.add(name)
}

watch(() => props.box, (b) => {
	const next = { x: b?.x, y: b?.y, w: b?.w, h: b?.h, r: b?.r ?? 0 }
	for (const [name, field] of Object.entries(fields)) {
		if (!open.has(name)) {
			field.value = show(next[name])
		}
	}
}, { immediate: true, deep: true })

const typeList = computed(() => [...(props.types ?? [])])
const resizable = computed(() => typeList.value.length > 0 && typeList.value.every((tp) => typeInfo(tp).resize !== 'none'))
const measured = computed(() => typeList.value.includes('text'))
// job 240: only a shape has the tick "1:1"
const squarable = computed(() => typeList.value.length === 1 && typeList.value[0] === 'shape')
const ticked = computed(() => squarable.value && props.square)

/**
 * @param {string|number} s field value
 * @return {number|undefined} the number, undefined when empty or not finite
 */
function num(s) {
	if (s === '' || s === null || s === undefined) {
		return undefined
	}
	const v = typeof s === 'number' ? s : Number(String(s).replace(',', '.'))
	return Number.isFinite(v) ? v : undefined
}

/**
 * @param {{square?: boolean}} [extra] (job 240) the tick's new state
 */
function send(extra = {}) {
	// the height follows the width while ticked, and in the step that ticks or unticks
	const follow = ticked.value || extra.square === true
	const box = {
		x: num(x.value),
		y: num(y.value),
		w: resizable.value ? num(w.value) : undefined,
		h: resizable.value && !measured.value ? num((follow ? w : h).value) : undefined,
		r: props.rotatable ? num(r.value) : undefined,
		...extra,
	}
	// no field is open any more: the next box (the session reports one after
	// every apply, also when nothing was sent) shows in every field
	open.clear()
	emit('apply', box)
}

function apply() {
	send()
}

/**
 * (Job 240) The tick changed: apply with its new state. The box shows
 * `square` again until the session reports the new one.
 *
 * @param {Event} e change of the checkbox
 */
function tick(e) {
	const on = !!e.target.checked
	e.target.checked = ticked.value
	send({ square: on })
}
</script>
