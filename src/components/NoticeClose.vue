<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcButton variant="tertiary"
		class="knorke-banner__close"
		:aria-label="label || t('knorke', 'Close notice')"
		:title="label || t('knorke', 'Close notice')"
		:data-knorke-action="action"
		@click="$emit('close')">
		<template #icon>
			<NcIconSvgWrapper :path="icons.close" />
		</template>
	</NcButton>
</template>

<script setup>
/*
 * The close button "×" at the end of a notice (factory job 228, redesign
 * V16): [data-knorke-action=notice-close] "Close notice" by default; the
 * tag filter's names it "Clear filter" with its own hook. It only emits
 * close; the board view decides what closing means (bars.js noticeOf).
 */
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'

defineProps({
	/** accessible name and hint; empty: "Close notice" */
	label: { type: String, default: '' },
	/** the data-knorke-action hook */
	action: { type: String, default: 'notice-close' },
})

defineEmits(['close'])
</script>
