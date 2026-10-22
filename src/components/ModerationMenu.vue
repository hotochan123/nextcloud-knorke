<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-modmenu" :data-knorke-menu="overflow ? 'overflow' : 'moderation'">
		<NcActions force-menu
			variant="tertiary"
			:aria-label="overflow ? t('knorke', 'More') : t('knorke', 'Facilitate')"
			:title="overflow ? t('knorke', 'More') : t('knorke', 'Facilitate')">
			<template #icon>
				<NcIconSvgWrapper :path="overflow ? icons.dotsVertical : icons.facilitate" />
			</template>
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
				<NcActionButton v-if="!voteOpen"
					close-after-click
					data-knorke-action="vote-setup"
					@click="$emit('vote-setup')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.vote" />
					</template>
					{{ t('knorke', 'Start voting') }}
				</NcActionButton>
				<NcActionButton close-after-click
					data-knorke-action="timer-open"
					@click="$emit('timer-open')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.timer" />
					</template>
					{{ t('knorke', 'Timer') }}
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
				<NcActionButton v-if="summonActive"
					close-after-click
					data-knorke-action="summon-end"
					@click="$emit('summon-end')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.close" />
					</template>
					{{ t('knorke', 'Stop presenting') }}
				</NcActionButton>
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
 * share]) as well; its entries keep their hooks. Every entry closes the menu
 * (close-after-click): the entries change with the state (summon ↔
 * summon-end), and a menu left open would make the next trigger click close
 * it instead.
 */
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'

defineProps({
	/** this client moderates (me.mod) */
	mod: { type: Boolean, default: false },
	/** the narrow layout's overflow menu (with "Share") */
	overflow: { type: Boolean, default: false },
	/** owner or moderator: "Share" in the overflow menu */
	canShare: { type: Boolean, default: false },
	voteOpen: { type: Boolean, default: false },
	/** this tab presents (meta.summon = me and this client) */
	presenting: { type: Boolean, default: false },
	/** meta.summon is set (by anyone) */
	summonActive: { type: Boolean, default: false },
	/** "Bring everyone here" needs a client id (signed-in tab) */
	canSummon: { type: Boolean, default: true },
})

defineEmits(['share', 'vote-setup', 'timer-open', 'summon', 'summon-end'])
</script>
