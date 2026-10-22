<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<nav class="knorke-toolbar" data-knorke-toolbar :aria-label="t('knorke', 'Tools')">
		<div v-for="tool in tools"
			:key="tool.id"
			class="knorke-toolbar__tool"
			:class="{ 'knorke-toolbar__tool--options': tool.options }">
			<NcButton variant="tertiary"
				class="knorke-toolbar__button"
				:class="{ 'knorke-toolbar__button--active': active === tool.id }"
				:pressed="active === tool.id"
				:aria-label="tool.label"
				:title="tool.label + ' (' + tool.key + ')'"
				:data-knorke-tool="tool.id"
				@click="(e) => $emit('tool', tool.id, e)">
				<template #icon>
					<NcIconSvgWrapper :path="tool.icon" />
				</template>
			</NcButton>
			<ToolOptions v-if="tool.options"
				:tool="tool.id"
				:value="options[tool.id] || {}"
				@update="(o) => $emit('options', tool.id, o)" />
		</div>
		<div class="knorke-toolbar__sep" role="separator" />
		<NcButton variant="tertiary"
			class="knorke-toolbar__button"
			:disabled="!canUndo"
			:aria-label="t('knorke', 'Undo')"
			:title="t('knorke', 'Undo') + ' (Ctrl+Z)'"
			@click="(e) => $emit('undo', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.undo" />
			</template>
		</NcButton>
		<NcButton variant="tertiary"
			class="knorke-toolbar__button"
			:disabled="!canRedo"
			:aria-label="t('knorke', 'Redo')"
			:title="t('knorke', 'Redo') + ' (Ctrl+Shift+Z)'"
			@click="(e) => $emit('redo', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.redo" />
			</template>
		</NcButton>
	</nav>
</template>

<script setup>
/*
 * Tool bar on the left (SPEC-M0 §6.6, §6.8; v2 SPEC-M1 §6.6): the tools of
 * the one tool table (model/tools.js TOOLS), [data-knorke-toolbar], tool
 * buttons [data-knorke-tool=<id>], the active one with aria-pressed="true"
 * (NcButton :pressed). A tool with options (shape: kind; connector: route
 * and end tip) has a menu next to its button (ToolOptions,
 * [data-knorke-tool-option=<value>]); choosing an option emits
 * options(tool, {…}) and activates the tool. Every tool of TOOLS is shown
 * (round 1b ends the hidden connector tool of 1a). Absent in view-only
 * mode.
 *
 * Every emit carries the DOM event, so the view can give the focus back to
 * the canvas after a pointer click (SPEC-M1 §6.5.1, components/focus.js).
 */
import { computed } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { TOOLS } from '../model/tools.js'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'
import { toolLabel } from './labels.js'
import ToolOptions from './ToolOptions.vue'

defineProps({
	active: { type: String, default: 'select' },
	options: { type: Object, default: () => ({}) },
	canUndo: { type: Boolean, default: false },
	canRedo: { type: Boolean, default: false },
})

defineEmits(['tool', 'options', 'undo', 'redo'])

const ICONS = Object.freeze({
	select: icons.select,
	hand: icons.hand,
	sticky: icons.sticky,
	shape: icons.shape,
	text: icons.text,
	connector: icons.connector,
	frame: icons.frame,
})

const tools = computed(() => TOOLS
	.map((x) => ({
		id: x.id,
		key: x.key.toUpperCase(),
		icon: ICONS[x.id] ?? icons.select,
		label: toolLabel(x.id),
		options: Array.isArray(x.options) && x.options.length > 0,
	})))
</script>
