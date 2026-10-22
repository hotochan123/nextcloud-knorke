<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<form class="knorke-arrange"
		data-knorke-dialog="arrange"
		:aria-label="t('knorke', 'Arrange')"
		@submit.prevent="apply">
		<NcTextField v-model="x"
			class="knorke-arrange__field"
			type="number"
			step="any"
			label="X"
			data-knorke-field="arrange-x"
			@keydown.enter.prevent="apply" />
		<NcTextField v-model="y"
			class="knorke-arrange__field"
			type="number"
			step="any"
			label="Y"
			data-knorke-field="arrange-y"
			@keydown.enter.prevent="apply" />
		<NcTextField v-model="w"
			class="knorke-arrange__field"
			type="number"
			step="any"
			min="0"
			:label="t('knorke', 'Width')"
			:disabled="!resizable"
			data-knorke-field="arrange-w"
			@keydown.enter.prevent="apply" />
		<NcTextField v-model="h"
			class="knorke-arrange__field"
			type="number"
			step="any"
			min="0"
			:label="t('knorke', 'Height')"
			:disabled="!resizable || measured"
			data-knorke-field="arrange-h"
			@keydown.enter.prevent="apply" />
		<NcTextField v-model="r"
			class="knorke-arrange__field"
			type="number"
			step="any"
			:label="t('knorke', 'Angle')"
			:disabled="!rotatable"
			data-knorke-field="arrange-r"
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
})

const emit = defineEmits(['apply'])

const x = ref('')
const y = ref('')
const w = ref('')
const h = ref('')
const r = ref('')

/**
 * @param {unknown} v number
 * @return {string} the value with at most two decimals, for the field
 */
function show(v) {
	return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : ''
}

watch(() => props.box, (b) => {
	x.value = show(b?.x)
	y.value = show(b?.y)
	w.value = show(b?.w)
	h.value = show(b?.h)
	r.value = show(b?.r ?? 0)
}, { immediate: true, deep: true })

const typeList = computed(() => [...(props.types ?? [])])
const resizable = computed(() => typeList.value.length > 0 && typeList.value.every((tp) => typeInfo(tp).resize !== 'none'))
const measured = computed(() => typeList.value.includes('text'))

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

function apply() {
	emit('apply', {
		x: num(x.value),
		y: num(y.value),
		w: resizable.value ? num(w.value) : undefined,
		h: resizable.value && !measured.value ? num(h.value) : undefined,
		r: props.rotatable ? num(r.value) : undefined,
	})
}
</script>
