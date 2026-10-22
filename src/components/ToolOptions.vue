<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcActions v-if="groups.length > 0"
		v-model:open="open"
		class="knorke-tooloptions"
		variant="tertiary"
		force-menu
		placement="right"
		:aria-label="menuLabel"
		:title="menuLabel"
		:data-knorke-tool-options="tool">
		<template #icon>
			<NcIconSvgWrapper :path="icons.chevronDown" :size="16" />
		</template>
		<template v-for="g in groups" :key="g.option">
			<NcActionCaption v-if="groups.length > 1" :name="g.caption" />
			<NcActionRadio v-for="e in g.entries"
				:key="g.option + ':' + e.value"
				:name="'knorke-tool-' + tool + '-' + g.option"
				:value="e.value"
				:model-value="current(g.option)"
				:data-knorke-tool-option="e.value"
				@click="pick(g.option, e.value)"
				@update:model-value="(v) => choose(g.option, v)">
				{{ e.label }}
			</NcActionRadio>
		</template>
	</NcActions>
</template>

<script setup>
/*
 * Options of a creation tool (SPEC-M1 §6.6): the shape kind of the shape
 * tool; route and end tip of the connector tool (round 1b). A menu next to
 * the tool button ([data-knorke-tool-options=<tool>]); every entry is
 * [data-knorke-tool-option=<value>] (§6.8). A tool with more than one option
 * shows a caption per option group. Choosing one emits update({<option>:
 * value}) and closes the menu; the toolbar activates the tool with that
 * option. Choosing the option that is already checked emits as well (a
 * checked radio fires no change, so a click on it would otherwise leave the
 * menu open and the tool inactive).
 */
import { computed, ref } from 'vue'
import NcActionCaption from '@nextcloud/vue/components/NcActionCaption'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { ENUMS } from '../model/registry.js'
import { TOOLS } from '../model/tools.js'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'
import { capLabel, routeLabel, shapeKindLabel, toolLabel } from './labels.js'

const props = defineProps({
	tool: { type: String, required: true },
	value: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update'])

const open = ref(false)

/**
 * The options a tool offers (TOOLS[].options): values and menu order are
 * the registry's frozen enums, never a copy.
 */
const OPTION_VALUES = Object.freeze({
	kind: ENUMS.shapeKinds,
	route: ENUMS.routes,
	endCap: ENUMS.caps,
})

/**
 * @param {string} option option name
 * @param {string} value option value
 * @return {string} translated label
 */
function labelOf(option, value) {
	switch (option) {
	case 'kind': return shapeKindLabel(value)
	case 'route': return routeLabel(value)
	case 'endCap': return capLabel(value)
	default: return String(value)
	}
}

/**
 * @param {string} option option name
 * @return {string} caption of the option group
 */
function captionOf(option) {
	switch (option) {
	case 'kind': return t('knorke', 'Shape')
	case 'route': return t('knorke', 'Route')
	case 'endCap': return t('knorke', 'End tip')
	default: return String(option)
	}
}

const groups = computed(() => {
	const spec = TOOLS.find((x) => x.id === props.tool)
	const out = []
	for (const option of spec?.options ?? []) {
		const entries = (OPTION_VALUES[option] ?? []).map((value) => ({ value, label: labelOf(option, value) }))
		if (entries.length > 0) {
			out.push({ option, caption: captionOf(option), entries })
		}
	}
	return out
})

const menuLabel = computed(() => t('knorke', '{tool} options', { tool: toolLabel(props.tool) }))

/**
 * @param {string} option option name
 * @return {string} the current value (first value when none is set)
 */
function current(option) {
	const v = props.value?.[option]
	return typeof v === 'string' ? v : (OPTION_VALUES[option]?.[0] ?? '')
}

/** The last emit ({key, at}): one choice can arrive twice (click on the label and on its input). */
let last = null
/** Two emits of the same choice within this time are one. */
const SAME_CHOICE_MS = 300

/**
 * @param {string} option option name
 * @param {string} value chosen value
 */
function choose(option, value) {
	const key = option + ':' + value
	const now = Date.now()
	if (last !== null && last.key === key && now - last.at < SAME_CHOICE_MS) {
		return
	}
	last = { key, at: now }
	open.value = false
	emit('update', { [option]: value })
}

/**
 * A click on an entry: the checked one fires no change event, so it is
 * chosen here; any other entry is chosen by its change (update:model-value).
 *
 * @param {string} option option name
 * @param {string} value clicked value
 */
function pick(option, value) {
	if (current(option) === value) {
		choose(option, value)
	}
}
</script>
