<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-banner knorke-banner--following"
		data-knorke-banner="following"
		data-knorke-bar="banner"
		role="status">
		<span class="knorke-banner__text">{{ text }}</span>
		<NcButton variant="tertiary"
			size="small"
			:title="withShortcut(t('knorke', 'Stop following'), 'stop-following', apple)"
			data-knorke-action="follow-stop"
			@click="$emit('stop')">
			{{ following.summon ? t('knorke', 'Stop following') : t('knorke', 'Stop') }}
		</NcButton>
		<NoticeClose @close="$emit('close')" />
	</div>
</template>

<script setup>
/*
 * Banner while this tab follows someone (SPEC-M1 §6.6 FollowBanner, §6.8):
 * "Following {name} · Stop", during "Bring everyone here" "{name} is
 * presenting. · Stop following". Esc ends following as well (the button's
 * title says so, §6.12). A banner strip ([data-knorke-bar=banner]).
 * Job 141: that key comes from the one formatter (util/shortcuts.js).
 * Job 228: the close button (NoticeClose, emit close) hides the banner;
 * following goes on.
 */
import { computed } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import { isApplePlatform } from '../util/device.js'
import { t } from '../util/l10n.js'
import { withShortcut } from '../util/shortcuts.js'
import NoticeClose from './NoticeClose.vue'

const props = defineProps({
	/** {pid, name, summon} */
	following: { type: Object, required: true },
})

defineEmits(['stop', 'close'])

/** Apple platform (the formatter's hint for Esc is the same on every platform today) */
const apple = isApplePlatform()

const text = computed(() => (props.following.summon
	? t('knorke', '{name} is presenting.', { name: props.following.name || t('knorke', 'Someone') })
	: t('knorke', 'Following {name}', { name: props.following.name || t('knorke', 'Someone') })))
</script>
