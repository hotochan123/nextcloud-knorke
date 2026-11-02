<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-zoom" data-knorke-chrome role="group" :aria-label="t('knorke', 'Zoom')">
		<NcButton variant="tertiary"
			:aria-label="t('knorke', 'Zoom out')"
			:title="withShortcut(t('knorke', 'Zoom out'), 'zoom-out', apple)"
			data-knorke-action="zoom-out"
			@click="(e) => $emit('zoom-out', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.minus" />
			</template>
		</NcButton>
		<div ref="menuEl" class="knorke-zoom__menu" data-knorke-menu="zoom">
			<NcActions ref="actions"
				force-menu
				variant="tertiary"
				container="#knorke-menus"
				placement="top"
				class="knorke-zoom__percent"
				:menu-name="percent + ' %'"
				@close="level = 'root'">
				<template v-if="level === 'root'">
					<NcActionButton close-after-click
						:description="keyOf('zoom-100')"
						data-knorke-action="zoom-100"
						@click="(e) => $emit('zoom-100', e)">
						<template #icon>
							<NcIconSvgWrapper :path="icons.zoom100" />
						</template>
						{{ t('knorke', 'Zoom to 100 %') }}
					</NcActionButton>
					<NcActionButton close-after-click
						:disabled="!hasSelection"
						:description="keyOf('zoom-selection')"
						data-knorke-action="zoom-selection"
						@click="(e) => $emit('zoom-selection', e)">
						<template #icon>
							<NcIconSvgWrapper :path="icons.zoomSelection" />
						</template>
						{{ t('knorke', 'Zoom to selection') }}
					</NcActionButton>
					<NcActionButton is-menu
						data-knorke-submenu="frames"
						@click="openLevel('frames')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.frame" />
						</template>
						{{ t('knorke', 'Frames') }}
					</NcActionButton>
					<NcActionSeparator />
					<NcActionButton close-after-click
						:description="keyOf('shortcuts')"
						data-knorke-action="shortcuts"
						@click="(e) => $emit('shortcuts', e)">
						<template #icon>
							<NcIconSvgWrapper :path="icons.keyboard" />
						</template>
						{{ t('knorke', 'Keyboard shortcuts') }}
					</NcActionButton>
				</template>
				<template v-else>
					<NcActionButton data-knorke-submenu-back
						@click="openLevel('root')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.chevronLeft" directional />
						</template>
						{{ t('knorke', 'Frames') }}
					</NcActionButton>
					<NcActionSeparator />
					<NcActionText v-if="frames.length === 0" data-knorke-frame-list>
						{{ t('knorke', 'This board has no frames yet.') }}
					</NcActionText>
					<NcActionButton v-for="f in frames"
						:key="f.id"
						close-after-click
						:data-knorke-frame="f.id"
						@click="$emit('zoom-to', f.id)">
						{{ f.title }}
					</NcActionButton>
				</template>
			</NcActions>
		</div>
		<NcButton variant="tertiary"
			:aria-label="t('knorke', 'Zoom in')"
			:title="withShortcut(t('knorke', 'Zoom in'), 'zoom-in', apple)"
			data-knorke-action="zoom-in"
			@click="(e) => $emit('zoom-in', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.plus" />
			</template>
		</NcButton>
		<NcButton variant="tertiary"
			:aria-label="t('knorke', 'Show everything')"
			:title="withShortcut(t('knorke', 'Show everything'), 'fit', apple)"
			data-knorke-action="zoom-fit"
			@click="(e) => $emit('zoom-fit', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.fit" />
			</template>
		</NcButton>
	</div>
</template>

<script setup>
/*
 * Zoom bar, bottom right (SPEC-M0 §6.6, SPEC-M1 §6.6; factory job 229,
 * redesign docs/redesign/ P1): −, the percentage, +, "Show everything". The
 * percentage updates at most 10 times per second (the scene throttles
 * onCamera). The buttons name their key in their title (job 141,
 * util/shortcuts.js withShortcut; prop apple: ⇧ symbols on Apple).
 *
 * The percentage is the trigger of the zoom menu ([data-knorke-menu=zoom],
 * NcActions named by the percentage): "Zoom to 100 %"
 * ([data-knorke-action=zoom-100]), "Zoom to selection" (zoom-selection,
 * disabled without a selection), "Frames ▸" ([data-knorke-submenu=frames]: a
 * level in the same list like the submenus of "More", job 228, with a back
 * entry [data-knorke-submenu-back], then every frame [data-knorke-frame=<id>]
 * in z order with its title, else "Frame {n}", read when the level opens,
 * emit frames; without frames a line saying so) and "Keyboard shortcuts"
 * ([data-knorke-action=shortcuts], emit shortcuts; the round "?" button of
 * job 145 is gone); these three name their key in a second line. Closing
 * the menu goes back to its top level.
 * focusShortcuts() gives the trigger the focus back when the overview closes
 * after a keyboard activation of its entry.
 *
 * Every emit carries the click event: after a pointer click the view gives
 * the focus back to the canvas (SPEC-M1 §6.5.1).
 */
import { nextTick, ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcActionText from '@nextcloud/vue/components/NcActionText'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { shortcut, withShortcut } from '../util/shortcuts.js'
import { icons } from './icons.js'

const props = defineProps({
	percent: { type: Number, default: 100 },
	/** [{id, title}] of the frame list (read by the board when its level opens) */
	frames: { type: Array, default: () => [] },
	hasSelection: { type: Boolean, default: false },
	/** job 141: Apple platform, ⇧ hints in the titles (util/device.js isApplePlatform) */
	apple: { type: Boolean, default: false },
})

const emit = defineEmits(['zoom-in', 'zoom-out', 'zoom-fit', 'zoom-100', 'zoom-to', 'zoom-selection', 'frames', 'shortcuts'])

const actions = ref(null)
const menuEl = ref(null)
/** The level shown: 'root' or 'frames'. */
const level = ref('root')

/**
 * @param {string} name a key of util/shortcuts.js
 * @return {string|null} its key as the entry's second line (job 141 hints: ⇧ on Apple, translated)
 */
function keyOf(name) {
	return shortcut(name, props.apple)?.hint ?? null
}

/**
 * Shows a level in the open menu; the focus goes to its first entry.
 *
 * @param {'root'|'frames'} g the level
 */
async function openLevel(g) {
	if (g === 'frames') {
		emit('frames')
	}
	level.value = g
	await nextTick()
	actions.value?.focusFirstAction?.()
}

/** @return {boolean} the menu's trigger took the focus */
function focusShortcuts() {
	const el = menuEl.value?.querySelector?.('.action-item__menutoggle')
	if (!el || typeof el.focus !== 'function') {
		return false
	}
	el.focus()
	return true
}

defineExpose({ focusShortcuts })
</script>
