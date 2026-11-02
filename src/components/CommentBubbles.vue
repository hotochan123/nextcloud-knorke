<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-bubbles" data-knorke-bubbles>
		<button v-for="b in pos"
			:key="b.id"
			type="button"
			class="knorke-bubble"
			:class="{ 'knorke-bubble--active': b.id === active }"
			:style="{ left: b.x + 'px', top: b.y + 'px' }"
			:data-knorke-bubble="b.id"
			:aria-label="label(b.n)"
			:title="label(b.n)"
			@pointerdown.stop
			@click.stop="$emit('open', b.id)">
			{{ b.n }}
		</button>
	</div>
</template>

<script setup>
/*
 * The comment bubbles (factory job 189): one button[data-knorke-bubble] per
 * open thread with the number of its comments, a sibling of .knorke-canvas
 * above every item (and below the bars). Every animation frame reads the
 * places from the session (prop places = BoardSession.commentPlaces, the
 * live camera and the live model: a drag or resize moves them); only real
 * changes go into the DOM. Always BUBBLE_PX on screen whatever the zoom;
 * with a coarse pointer the button is at least 32 px (knorke.css). (Job
 * 233) It is a speech bubble right of its item (comments.js bubblePlaces).
 * A click or tap opens the thread (event open; the board view opens the
 * comment panel with it): the press never reaches the canvas
 * (a sibling, and the pointerdown stops here), so nothing is selected,
 * voted or panned. The bubbles are DOM, never drawn by the scene: they are
 * never in the PNG.
 */
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { n } from '../util/l10n.js'
import { BUBBLE_PX } from '../board/comments.js'

const props = defineProps({
	/** () => [{id, n, x, y}] container px of the bubbles' centres (BoardSession.commentPlaces) */
	places: { type: Function, required: true },
	/** the thread whose popover is open (its bubble is marked) */
	active: { type: String, default: null },
})

defineEmits(['open'])

/** [{id, n, x, y}] board px of the top left corners */
const pos = shallowRef([])
let raf = 0

/**
 * @param {number} count comments of the thread
 * @return {string} the button's name
 */
function label(count) {
	return n('knorke', '%n comment', '%n comments', count)
}

/** Reads the places (one animation frame); only real changes replace pos. */
function measure() {
	let list = []
	try {
		list = props.places() ?? []
	} catch (e) {
		list = []
	}
	const next = list.map((p) => ({ id: p.id, n: p.n, x: Math.round(p.x - BUBBLE_PX / 2), y: Math.round(p.y - BUBBLE_PX / 2) }))
	const old = pos.value
	if (next.length !== old.length || next.some((p, i) => p.id !== old[i].id || p.n !== old[i].n || p.x !== old[i].x || p.y !== old[i].y)) {
		pos.value = next
	}
}

function frame() {
	measure()
	raf = requestAnimationFrame(frame)
}

measure()

onMounted(() => {
	if (typeof requestAnimationFrame === 'function') {
		raf = requestAnimationFrame(frame)
	}
})

onBeforeUnmount(() => {
	if (raf && typeof cancelAnimationFrame === 'function') {
		cancelAnimationFrame(raf)
	}
	raf = 0
})
</script>
