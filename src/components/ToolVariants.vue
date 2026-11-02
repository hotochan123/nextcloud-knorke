<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section class="knorke-toolpop knorke-toolvariants"
		role="dialog"
		:aria-label="menuLabel"
		:data-knorke-tool-variants="tool">
		<div v-for="g in groups"
			:key="g.option"
			class="knorke-toolpop__group"
			role="group"
			:aria-label="g.caption">
			<p v-if="groups.length > 1" class="knorke-toolpop__caption" aria-hidden="true">
				{{ g.caption }}
			</p>
			<div class="knorke-toolpop__tiles">
				<button v-for="e in g.entries"
					:key="g.option + ':' + e.value"
					type="button"
					:class="['knorke-toolpop__tile', { 'knorke-toolpop__tile--swatch': g.swatch }]"
					:aria-pressed="current(g.option) === e.value ? 'true' : 'false'"
					:data-knorke-tool-option="e.value"
					:aria-label="g.swatch ? e.label : null"
					:title="g.swatch ? e.label : null"
					:data-knorke-tool-group="g.option"
					@click="(ev) => $emit('pick', g.option, e.value, ev)">
					<span v-if="g.swatch" class="knorke-toolpop__swatch" :style="{ background: e.color }" />
					<template v-else>
						<NcIconSvgWrapper :path="e.icon" :size="28" />
						<span class="knorke-toolpop__label">{{ e.label }}</span>
					</template>
				</button>
			</div>
		</div>
	</section>
</template>

<script setup>
/*
 * Variants of a creation tool as pictures (factory job 229, redesign
 * docs/redesign/ P5b; before: ToolOptions.vue, a menu with an arrow): what
 * the note tool creates (job 188: note or note pad), the frame tool (job 199:
 * frame or swimlanes), the connector tool's route and end tip (round 1b).
 * [data-knorke-tool-variants=<tool>], one group per option (a caption only
 * with two groups), each value a tile [data-knorke-tool-option=<value>] with
 * its picture (icons.js OPTION_ICONS) and name, aria-pressed for the current
 * one. A tile emits pick(option, value, event); the tool bar sets the option
 * (which activates the tool) and places and closes this popover. Values and
 * order are the frozen lists of the registry and of model/tools.js, never a
 * copy.
 * (Job 273) The pen tool: its kind (pen, highlighter, eraser), then for the
 * pen and the highlighter the three widths of that kind (option penWidth or
 * markerWidth) and its colours as swatches (penColor or markerColor; a
 * swatch carries its name as aria-label and title), model/ink.js.
 */
import { computed } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { ENUMS } from '../model/registry.js'
import { FRAME_TOOL_KINDS, NOTE_TOOL_TYPES } from '../model/tools.js'
import { t } from '../util/l10n.js'
import { icons, OPTION_ICONS } from './icons.js'
import { PEN_COLORS, PEN_TOOL_KINDS, PEN_WIDTHS } from '../model/ink.js'
import { capLabel, frameKindLabel, noteTypeLabel, paletteName, penKindLabel, penWidthLabel, routeLabel, toolLabel } from './labels.js'
import { VARIANTS } from './toolbar.js'

const props = defineProps({
	tool: { type: String, required: true },
	value: { type: Object, default: () => ({}) },
})

defineEmits(['pick'])

/** The values of each option, the frozen lists themselves. */
const OPTION_VALUES = Object.freeze({
	route: ENUMS.routes,
	endCap: ENUMS.caps,
	type: NOTE_TOOL_TYPES,
	frameKind: FRAME_TOOL_KINDS,
	penKind: PEN_TOOL_KINDS,
})

/**
 * @param {string} option option name
 * @param {string} value option value
 * @return {string} translated label
 */
function labelOf(option, value) {
	switch (option) {
	case 'route': return routeLabel(value)
	case 'endCap': return capLabel(value)
	case 'type': return noteTypeLabel(value)
	case 'frameKind': return frameKindLabel(value)
	case 'penKind': return penKindLabel(value)
	default: return String(value)
	}
}

/**
 * @param {string} option option name
 * @return {string} caption of the option group
 */
function captionOf(option) {
	switch (option) {
	case 'route': return t('knorke', 'Route')
	case 'endCap': return t('knorke', 'End tip')
	default: return toolLabel(props.tool)
	}
}

/**
 * (job 273) The groups of the pen tool: the kind; for the pen and the highlighter its widths and colours.
 *
 * @return {Array<object>}
 */
function penGroups() {
	const kind = PEN_TOOL_KINDS.includes(props.value?.penKind) ? props.value.penKind : 'pen'
	const out = [{
		option: 'penKind',
		caption: t('knorke', 'Kind'),
		entries: PEN_TOOL_KINDS.map((value) => ({ value, label: penKindLabel(value), icon: OPTION_ICONS.penKind[value] })),
	}]
	if (kind === 'eraser') return out
	out.push({
		option: kind + 'Width',
		caption: t('knorke', 'Width'),
		entries: PEN_WIDTHS[kind].map((value, i) => ({ value, label: penWidthLabel(i), icon: OPTION_ICONS.width[i] })),
	}, {
		option: kind + 'Color',
		caption: t('knorke', 'Color'),
		swatch: true,
		entries: PEN_COLORS[kind].map((value) => ({ value, label: paletteName(value) ?? value, color: value })),
	})
	return out
}

const groups = computed(() => props.tool === 'pen' ? penGroups() : (VARIANTS[props.tool] ?? []).map((option) => ({
	option,
	caption: captionOf(option),
	entries: (OPTION_VALUES[option] ?? []).map((value) => ({ value, label: labelOf(option, value), icon: OPTION_ICONS[option]?.[value] ?? icons.check })),
})))

const menuLabel = computed(() => t('knorke', '{tool} options', { tool: toolLabel(props.tool) }))

/**
 * @param {string} option option name
 * @return {string} the current value (first value when none is set)
 */
function current(option) {
	const v = props.value?.[option]
	// (job 273) the widths of the pen tool are numbers
	return typeof v === 'string' || typeof v === 'number' ? v : (OPTION_VALUES[option]?.[0] ?? '')
}
</script>
