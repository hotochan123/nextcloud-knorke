<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="title || t('knorke', 'Show to the room')"
		size="full"
		class="knorke-present"
		data-knorke-dialog="present-link"
		@update:open="(o) => !o && $emit('close')">
		<div class="knorke-present__body">
			<p class="knorke-present__call">
				{{ link && link.role === 'vote' ? t('knorke', 'Scan to vote on this board') : t('knorke', 'Scan to join this board') }}
			</p>
			<div class="knorke-present__code">
				<QrCode v-if="link && link.url"
					:value="link.url"
					size="min(64vmin, 720px)"
					:label="t('knorke', 'QR code of the link')" />
			</div>
			<p class="knorke-present__url">
				{{ link ? link.url : '' }}
			</p>
		</div>
	</NcDialog>
</template>

<script setup>
/*
 * "Show to the room" (SPEC-M1 §6.6, R2): full screen for the projector. A
 * large QR code (64 % of the shorter screen side, ≥ 60 %), below it the URL
 * in large type, the board title as the dialog name and "Scan to vote on
 * this board" (voting link) or "Scan to join this board" (edit link). Esc
 * closes (NcDialog). The code is always dark on white; the texts use the
 * Nextcloud main text on the main background (≥ 4.5:1 light and dark).
 */
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { t } from '../util/l10n.js'
import QrCode from './QrCode.vue'

defineProps({
	/** Link {token, role, url, …} */
	link: { type: Object, default: null },
	/** board title */
	title: { type: String, default: '' },
})

defineEmits(['close'])
</script>
