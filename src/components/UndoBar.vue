<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-undo"
		data-knorke-undo
		data-knorke-chrome
		role="group"
		:aria-label="t('knorke', 'Undo and redo')">
		<NcButton variant="tertiary"
			:disabled="!canUndo"
			:aria-label="t('knorke', 'Undo')"
			:title="withShortcut(t('knorke', 'Undo'), 'undo', apple)"
			data-knorke-action="undo"
			@click="(e) => $emit('undo', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.undo" />
			</template>
		</NcButton>
		<NcButton variant="tertiary"
			:disabled="!canRedo"
			:aria-label="t('knorke', 'Redo')"
			:title="withShortcut(t('knorke', 'Redo'), 'redo', apple)"
			data-knorke-action="redo"
			@click="(e) => $emit('redo', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.redo" />
			</template>
		</NcButton>
	</div>
</template>

<script setup>
/*
 * Undo and redo (factory job 229, redesign docs/redesign/ P1): their own
 * small island at the bottom left ([data-knorke-undo], [data-knorke-chrome],
 * the look of the bars), shown with the tool bar (mode edit, not frozen).
 * Each button names its key in its title (job 141, util/shortcuts.js
 * withShortcut), is disabled while there is nothing to undo or redo, and
 * emits with the click event (the view gives the canvas the focus after a
 * pointer, SPEC-M1 §6.5.1).
 */
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { withShortcut } from '../util/shortcuts.js'
import { icons } from './icons.js'

defineProps({
	canUndo: { type: Boolean, default: false },
	canRedo: { type: Boolean, default: false },
	/** Apple platform: ⌘ hints (util/device.js isApplePlatform) */
	apple: { type: Boolean, default: false },
})

defineEmits(['undo', 'redo'])
</script>
