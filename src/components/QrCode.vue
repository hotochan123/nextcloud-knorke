<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<svg v-if="qr.d !== ''"
		class="knorke-qr"
		:viewBox="'0 0 ' + qr.size + ' ' + qr.size"
		:style="{ width: cssSize }"
		role="img"
		:aria-label="label || t('knorke', 'QR code')"
		shape-rendering="crispEdges"
		:data-knorke-qr-value="value">
		<rect class="knorke-qr__bg"
			x="0"
			y="0"
			:width="qr.size"
			:height="qr.size" />
		<path class="knorke-qr__modules" :d="qr.d" />
	</svg>
</template>

<script setup>
/*
 * QR code of a link (SPEC-M1 §6.6, R2): qrcode-generator 1.5.2 (error
 * correction M) through components/qr.js, drawn as one <svg> path – no
 * innerHTML, no SVG string from the library. Hook
 * [data-knorke-qr-value=<url>] (E27/E28 compare it with link.url). Always
 * dark modules on a white square, also in Nextcloud's dark theme, or phones
 * cannot scan it.
 */
import { computed } from 'vue'
import { t } from '../util/l10n.js'
import { qrPath } from './qr.js'

const props = defineProps({
	value: { type: String, required: true },
	/** CSS size of the square (number = px, string = any CSS length) */
	size: { type: [Number, String], default: 160 },
	/** accessible name (default "QR code") */
	label: { type: String, default: '' },
})

const qr = computed(() => qrPath(props.value))
const cssSize = computed(() => (typeof props.size === 'number' ? props.size + 'px' : props.size))
</script>
