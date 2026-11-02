<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<svg class="knorke-templates__sketch"
		:viewBox="'0 0 ' + SKETCH_W + ' ' + SKETCH_H"
		aria-hidden="true"
		focusable="false">
		<rect v-for="(r, j) in rects"
			:key="j"
			:class="r.frame ? 'knorke-templates__frame' : 'knorke-templates__note'"
			:x="r.x"
			:y="r.y"
			:width="r.w"
			:height="r.h"
			:fill="r.fill" />
	</svg>
</template>

<script setup>
/*
 * The sketch of a stored template (factory job 182) or board (factory job
 * 221, BoardSketch.vue): an SVG of the
 * rectangles of components/sketch.js sketchRects (only numbers and
 * #rrggbb; a frame without fill), aria-hidden. The template dialog and the
 * admin section draw it alike.
 */
import { SKETCH_H, SKETCH_W } from './sketch.js'

defineProps({
	/** sketchRects of an entry: [{x, y, w, h, frame, fill}] */
	rects: { type: Array, default: () => [] },
})
</script>
