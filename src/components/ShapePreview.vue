<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<svg class="knorke-shapepreview"
		:class="{ 'knorke-shapepreview--filled': look.filled, 'knorke-shapepreview--thick': look.thick }"
		viewBox="0 0 24 24"
		:width="size"
		:height="size"
		aria-hidden="true"
		focusable="false">
		<path v-if="look.duo" class="knorke-shapepreview__duo" :d="look.duo" :fill-opacity="DUO_SHARE" />
		<path :d="look.d" />
		<path v-if="look.mark"
			class="knorke-shapepreview__mark"
			:d="look.mark.d"
			:transform="`translate(${look.mark.x} ${look.mark.y}) scale(${look.mark.s / 24})`" />
	</svg>
</template>

<script setup>
/*
 * (Factory job 201) The preview of a shape kind (model/shapes.js
 * shapePreview), drawn from the same table as the board: a symbol filled,
 * any other kind as its outline and inner lines, in currentColor, so it
 * follows the light and the dark theme. The shapes panel's tiles, its drag
 * preview and the context bar's flowchart buttons use it.
 * (Job 204) A BPMN mark or badge is a second path, filled; a thick kind's
 * outline is stroked twice as wide; the pool entry (shapeLibs.js
 * POOL_KIND) shows POOL_PREVIEW.
 * (Job 244) A symbol's light layer (duo) lies under it, filled at DUO_SHARE.
 */
import { computed } from 'vue'
import { DUO_SHARE, shapePreview } from '../model/shapes.js'
import { POOL_KIND, POOL_PREVIEW } from './shapeLibs.js'

const props = defineProps({
	kind: { type: String, required: true },
	size: { type: Number, default: 24 },
})

const look = computed(() => (props.kind === POOL_KIND ? POOL_PREVIEW : shapePreview(props.kind)))
</script>
