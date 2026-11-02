<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-modmenu" :data-knorke-menu="overflow ? 'overflow' : board ? 'board' : 'moderation'">
		<NcActions ref="actions"
			force-menu
			variant="tertiary"
			container="#knorke-menus"
			:menu-name="overflow || board ? undefined : t('knorke', 'Facilitate')"
			:aria-label="overflow || board ? t('knorke', 'More') : t('knorke', 'Facilitate')"
			:title="overflow || board ? t('knorke', 'More') : t('knorke', 'Facilitate')"
			@open="$emit('opened')"
			@close="level = 'root'">
			<template #icon>
				<NcIconSvgWrapper :path="overflow || board ? icons.dotsHorizontal : icons.facilitate" />
			</template>
			<template v-if="level === 'root'">
				<NcActionButton v-if="overflow && canShare"
					close-after-click
					data-knorke-action="share"
					@click="$emit('share')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.share" />
					</template>
					{{ t('knorke', 'Share') }}
				</NcActionButton>
				<template v-if="mod">
					<NcActionButton v-if="!voteOpen && !privateOn"
						close-after-click
						data-knorke-action="vote-setup"
						@click="$emit('vote-setup')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.vote" />
						</template>
						{{ t('knorke', 'Start voting …') }}
					</NcActionButton>
					<NcActionButton close-after-click
						data-knorke-action="timer-open"
						@click="$emit('timer-open')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.timer" />
						</template>
						{{ t('knorke', 'Timer …') }}
					</NcActionButton>
					<NcActionButton v-if="!voteOpen && !privateOn"
						close-after-click
						data-knorke-action="private-setup"
						@click="$emit('private-setup')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.eyeOff" />
						</template>
						{{ t('knorke', 'Private writing …') }}
					</NcActionButton>
					<NcActionButton v-if="!presenting && canSummon"
						close-after-click
						data-knorke-action="summon"
						@click="$emit('summon')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.present" />
						</template>
						{{ t('knorke', 'Bring everyone here') }}
					</NcActionButton>
					<NcActionButton v-if="!presenting && canSummon && canPresent"
						close-after-click
						data-knorke-action="present"
						@click="$emit('present')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.frame" />
						</template>
						{{ t('knorke', 'Present frames') }}
					</NcActionButton>
					<template v-if="running">
						<NcActionSeparator />
						<NcActionCaption :name="t('knorke', 'Running now')" data-knorke-menu-caption="running" />
						<NcActionButton v-if="voteOpen"
							close-after-click
							data-knorke-action="vote-end"
							@click="$emit('vote-end')">
							<template #icon>
								<NcIconSvgWrapper :path="icons.close" />
							</template>
							{{ t('knorke', 'End voting') }}
						</NcActionButton>
						<NcActionButton v-if="privateOn"
							close-after-click
							data-knorke-action="private-reveal"
							@click="$emit('private-reveal')">
							<template #icon>
								<NcIconSvgWrapper :path="icons.eye" />
							</template>
							{{ t('knorke', 'Reveal notes') }}
						</NcActionButton>
						<NcActionButton v-if="timerActive"
							close-after-click
							data-knorke-action="timer-end"
							@click="$emit('timer-end')">
							<template #icon>
								<NcIconSvgWrapper :path="icons.close" />
							</template>
							{{ t('knorke', 'End timer') }}
						</NcActionButton>
						<NcActionButton v-if="summonActive"
							close-after-click
							data-knorke-action="summon-end"
							@click="$emit('summon-end')">
							<template #icon>
								<NcIconSvgWrapper :path="icons.close" />
							</template>
							{{ t('knorke', 'Stop presenting') }}
						</NcActionButton>
						<NcActionSeparator v-if="overflow && boardItems.length > 0" />
					</template>
				</template>
				<template v-for="e in rootBefore" :key="e.key">
					<NcActionButton close-after-click
						:data-knorke-action="e.key"
						@click="$emit('board-action', e.key)">
						<template #icon>
							<NcIconSvgWrapper :path="e.icon" />
						</template>
						{{ e.label }}
					</NcActionButton>
				</template>
				<NcActionButton v-for="g in submenusBefore"
					:key="g"
					is-menu
					:data-knorke-submenu="g"
					@click="openLevel(g)">
					<template #icon>
						<NcIconSvgWrapper :path="SUBMENU_ICONS[g]" />
					</template>
					{{ submenuName(g) }}
				</NcActionButton>
				<NcActionSeparator v-if="(rootBefore.length > 0 || submenusBefore.length > 0) && (rootAfter.length > 0 || hasLegal)" />
				<NcActionButton v-for="e in rootAfter"
					:key="e.key"
					close-after-click
					:data-knorke-action="e.key"
					@click="$emit('board-action', e.key)">
					<template #icon>
						<NcIconSvgWrapper :path="e.icon" />
					</template>
					{{ e.label }}
				</NcActionButton>
				<NcActionButton v-if="hasLegal"
					is-menu
					data-knorke-submenu="legal"
					@click="openLevel('legal')">
					<template #icon>
						<NcIconSvgWrapper :path="SUBMENU_ICONS.legal" />
					</template>
					{{ submenuName('legal') }}
				</NcActionButton>
			</template>
			<template v-else>
				<NcActionButton data-knorke-submenu-back
					@click="openLevel('root')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.chevronLeft" directional />
					</template>
					{{ submenuName(level) }}
				</NcActionButton>
				<NcActionSeparator />
				<template v-for="e in levelItems" :key="e.key">
					<NcActionLink v-if="e.kind === 'link'"
						:href="e.href"
						target="_blank"
						:data-knorke-legal="e.key">
						{{ e.label }}
					</NcActionLink>
					<NcActionButton v-else
						close-after-click
						:data-knorke-action="e.key"
						@click="$emit('board-action', e.key)">
						<template #icon>
							<NcIconSvgWrapper :path="e.icon" />
						</template>
						{{ e.label }}
					</NcActionButton>
				</template>
			</template>
		</NcActions>
	</div>
</template>

<script setup>
/*
 * Moderation menu (SPEC-M1 §6.6 ModerationMenu, §6.8 R16 CLI-09): root
 * [data-knorke-menu=moderation], its trigger is the NcActions button with
 * aria-haspopup; entries "Start voting" ([data-knorke-action=vote-setup],
 * opens the setup dialog; not while a session is open), "Timer"
 * (timer-open), "Bring everyone here" (summon; also to take over from
 * another presenter) and "Stop presenting" (summon-end; every moderator may
 * end it). In the narrow layout the same component is the overflow menu
 * ([data-knorke-menu=overflow]) and carries "Share" ([data-knorke-action=
 * share]) as well; its entries keep their hooks. (Job 178) The overflow menu
 * shows for every role: after the moderation entries come the entries of the
 * board menu (boardMenu.js boardMenuItems, prop boardItems); an action emits
 * board-action with its key. The same component is the wide layout's board
 * menu (prop board: [data-knorke-menu=board], "More" with NcActions' own "⋯"
 * icon, only these entries). Every action closes the menu
 * (close-after-click): the entries change with the state (summon ↔
 * summon-end), and a menu left open would make the next trigger click close
 * it instead.
 *
 * Job 228 (redesign header, docs/redesign/ P6, P6b): the moderation menu's
 * trigger carries the flag and the word "Facilitate" (menu-name); the
 * overflow menu has NcActions' own "⋯" too ("More"). The board entries stand
 * on the levels of boardMenu.js: on the root the root entries before the
 * submenus (filter-tags), then "Export ▸" and "Insert ▸"
 * ([data-knorke-submenu=export|insert], is-menu, only with entries), a
 * separator, the root entries after them (save-template, shortcuts) and
 * "Legal ▸" ([data-knorke-submenu=legal]) last. A submenu opens in the same
 * list, as Nextcloud does it: it does not close the menu, shows a back entry
 * with its name ([data-knorke-submenu-back], chevron) and a separator, then
 * its entries; the focus goes to the first entry. Closing the menu goes back
 * to the root.
 *
 * Job 233 (redesign session bar, docs/redesign/ P6b, P7): "Start voting …"
 * and "Timer …" name the dialog they open. While something runs, a
 * separator and the caption "Running now" ([data-knorke-menu-caption=
 * running]) follow the moderation entries, with "End voting" (vote-end, the
 * board view asks first), "End timer" (timer-end) and "Stop presenting"
 * (summon-end), each only when it applies; the separate "Stop presenting"
 * entry is gone.
 * Job 275: "Private writing …" ([data-knorke-action=private-setup], opens its
 * start dialog) while neither a vote is open nor private writing runs;
 * "Start voting …" hides while it runs, and "Running now" offers
 * "Reveal notes" ([data-knorke-action=private-reveal]).
 */
import { computed, nextTick, ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionCaption from '@nextcloud/vue/components/NcActionCaption'
import NcActionLink from '@nextcloud/vue/components/NcActionLink'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'

/** (Job 228) The icon of each submenu entry. */
const SUBMENU_ICONS = Object.freeze({ export: icons.exportTo, insert: icons.insertFrom, legal: icons.legal })
/** (Job 228) The root entries that stand before the submenus; the others follow the separator. */
const ROOT_FIRST = Object.freeze(['filter-tags'])

const props = defineProps({
	/** this client moderates (me.mod) */
	mod: { type: Boolean, default: false },
	/** the narrow layout's overflow menu (with "Share") */
	overflow: { type: Boolean, default: false },
	/** owner or moderator: "Share" in the overflow menu */
	canShare: { type: Boolean, default: false },
	voteOpen: { type: Boolean, default: false },
	/** job 275: private writing runs (no "Start voting", "Reveal notes" under "Running now") */
	privateOn: { type: Boolean, default: false },
	/** job 233: meta.timer exists ("End timer") */
	timerActive: { type: Boolean, default: false },
	/** this tab presents (meta.summon = me and this client) */
	presenting: { type: Boolean, default: false },
	/** meta.summon is set (by anyone) */
	summonActive: { type: Boolean, default: false },
	/** "Bring everyone here" needs a client id (signed-in tab) */
	canSummon: { type: Boolean, default: true },
	/** job 272: the board has a frame ("Present frames") */
	canPresent: { type: Boolean, default: false },
	/** job 178: the wide layout's board menu "⋯" (only boardItems) */
	board: { type: Boolean, default: false },
	/** job 178: the board menu's entries (boardMenu.js): the overflow and the board menu get them */
	boardItems: { type: Array, default: () => [] },
})

defineEmits(['share', 'vote-setup', 'private-setup', 'private-reveal', 'timer-open', 'summon', 'summon-end', 'vote-end', 'timer-end', 'board-action', 'present', 'opened'])

const actions = ref(null)
/** job 233: something runs, so the section "Running now" shows */
const running = computed(() => props.voteOpen || props.timerActive || props.summonActive || props.privateOn)
/** (Job 228) The level shown: 'root' or a submenu of boardMenu.js. */
const level = ref('root')
const rootBefore = computed(() => props.boardItems.filter((e) => e.group === 'root' && ROOT_FIRST.includes(e.key)))
const rootAfter = computed(() => props.boardItems.filter((e) => e.group === 'root' && !ROOT_FIRST.includes(e.key)))
const submenusBefore = computed(() => ['export', 'insert'].filter((g) => props.boardItems.some((e) => e.group === g)))
const hasLegal = computed(() => props.boardItems.some((e) => e.group === 'legal'))
const levelItems = computed(() => props.boardItems.filter((e) => e.group === level.value))

/**
 * @param {string} g a submenu of boardMenu.js
 * @return {string} its name, the label of its entry and of its back entry
 */
function submenuName(g) {
	if (g === 'export') {
		return t('knorke', 'Export')
	}
	return g === 'insert' ? t('knorke', 'Insert') : t('knorke', 'Legal')
}

/**
 * Shows a level in the open menu; the focus goes to its first entry.
 *
 * @param {string} g 'root' or a submenu
 */
async function openLevel(g) {
	level.value = g
	await nextTick()
	actions.value?.focusFirstAction?.()
}
</script>
