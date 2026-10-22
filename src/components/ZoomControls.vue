<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="root" class="knorke-zoom" role="group" :aria-label="t('knorke', 'Zoom')">
		<NcButton ref="button"
			variant="tertiary"
			:aria-label="t('knorke', 'Frames')"
			:title="t('knorke', 'Frames')"
			:aria-expanded="open ? 'true' : 'false'"
			:aria-controls="id"
			data-knorke-action="frames"
			@click="toggleFrames">
			<template #icon>
				<NcIconSvgWrapper :path="icons.frame" />
			</template>
		</NcButton>
		<FrameList v-if="open"
			:id="id"
			:frames="frames"
			@zoom-to="(fid) => pickFrame(fid)" />
		<NcButton v-if="hasSelection"
			variant="tertiary"
			:aria-label="t('knorke', 'Zoom to selection')"
			:title="t('knorke', 'Zoom to selection') + ' (Shift+2)'"
			data-knorke-action="zoom-selection"
			@click="(e) => $emit('zoom-selection', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.zoomSelection" />
			</template>
		</NcButton>
		<NcButton variant="tertiary"
			:aria-label="t('knorke', 'Zoom out')"
			:title="t('knorke', 'Zoom out') + ' (−)'"
			@click="(e) => $emit('zoom-out', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.minus" />
			</template>
		</NcButton>
		<NcButton variant="tertiary"
			class="knorke-zoom__percent"
			:aria-label="t('knorke', 'Zoom to 100 %')"
			:title="t('knorke', 'Zoom to 100 %') + ' (Shift+0)'"
			@click="(e) => $emit('zoom-100', e)">
			{{ percent }} %
		</NcButton>
		<NcButton variant="tertiary"
			:aria-label="t('knorke', 'Zoom in')"
			:title="t('knorke', 'Zoom in') + ' (+)'"
			@click="(e) => $emit('zoom-in', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.plus" />
			</template>
		</NcButton>
		<NcButton variant="tertiary"
			:aria-label="t('knorke', 'Show everything')"
			:title="t('knorke', 'Show everything') + ' (Shift+1)'"
			@click="(e) => $emit('zoom-fit', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.fit" />
			</template>
		</NcButton>
	</div>
</template>

<script setup>
/*
 * Zoom controls, bottom right (SPEC-M0 §6.6, SPEC-M1 §6.6): Frames, zoom
 * to selection, −, %, +, show everything. The percentage updates at most 10
 * times per second (the scene throttles onCamera). Every emit carries the
 * click event: after a pointer click the view gives the focus back to the
 * canvas (SPEC-M1 §6.5.1).
 *
 * Stage 3: "Frames" ([data-knorke-action=frames]) opens the frame list
 * (FrameList, emit zoom-to with the frame id; the list is read when it
 * opens, emit frames); "Zoom to selection" (like Shift+2) while something
 * is selected.
 */
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import FrameList from './FrameList.vue'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'
import { usePopover } from './popover.js'

defineProps({
	percent: { type: Number, default: 100 },
	/** [{id, title}] of the frame list (read by the board when it opens) */
	frames: { type: Array, default: () => [] },
	hasSelection: { type: Boolean, default: false },
})

const emit = defineEmits(['zoom-in', 'zoom-out', 'zoom-fit', 'zoom-100', 'zoom-to', 'zoom-selection', 'frames'])

const { open, root, button, id, toggle, close } = usePopover()

function toggleFrames() {
	if (!open.value) {
		emit('frames')
	}
	toggle()
}

/** @param {string} fid frame id */
function pickFrame(fid) {
	close(false)
	emit('zoom-to', fid)
}
</script>
