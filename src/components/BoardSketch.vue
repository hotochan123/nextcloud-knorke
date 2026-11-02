<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<span ref="el" class="knorke-list__icon" aria-hidden="true">
		<TemplateSketch v-if="rects.length > 0"
			class="knorke-list__sketch"
			data-knorke-sketch
			:rects="rects" />
		<NcIconSvgWrapper v-else :path="icons.board" />
	</span>
</template>

<script setup>
/*
 * The picture of a row of the board list (factory job 221): the sketch of
 * the board (frames as outlines, the other items as boxes in their colour,
 * no text; components/boardSketches.js) once it is there, else the board
 * icon, both in the same place so the row does not jump (job 232: the
 * card's picture at 240 : 150, or 96 × 60 in the list; CSS). The row
 * asks for the sketch when it comes into view (IntersectionObserver, 200 px
 * ahead), without an observer at once, and again when the board's
 * updatedAt changes after that. aria-hidden: the link's text names the
 * board.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { sketches } from './boardSketches.js'
import { icons } from './icons.js'
import TemplateSketch from './TemplateSketch.vue'

const props = defineProps({
	boardId: { type: Number, required: true },
	updatedAt: { type: Number, default: 0 },
	/** the loader (tests); the page's own by default */
	loader: { type: Object, default: () => sketches },
})

const el = ref(null)
const rects = computed(() => props.loader.rectsOf(props.boardId, props.updatedAt))
let seen = false
let observer = null

function want() {
	seen = true
	props.loader.want(props.boardId, props.updatedAt)
}

function stop() {
	observer?.disconnect()
	observer = null
}

onMounted(() => {
	if (typeof IntersectionObserver !== 'function' || !el.value) {
		want()
		return
	}
	observer = new IntersectionObserver((entries) => {
		if (entries.some((e) => e.isIntersecting)) {
			stop()
			want()
		}
	}, { rootMargin: '200px' })
	observer.observe(el.value)
})

watch(() => [props.boardId, props.updatedAt], () => {
	if (seen) {
		want()
	}
})

onBeforeUnmount(stop)
</script>
