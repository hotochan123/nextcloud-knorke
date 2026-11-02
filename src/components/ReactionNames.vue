<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="root"
		class="knorke-reactnames"
		:class="{ 'knorke-reactnames--list': kind === 'list', 'knorke-reactnames--tip': kind === 'names' && !hold }"
		:role="kind === 'list' ? 'dialog' : 'tooltip'"
		:aria-label="t('knorke', 'Reactions')"
		:data-knorke-reactions="kind === 'list' ? 'list' : 'names'"
		:data-knorke-reactions-item="id"
		:style="style"
		@keydown.esc.stop.prevent="$emit('close')">
		<section v-for="g in entries"
			:key="g.e"
			class="knorke-reactnames__group"
			:data-knorke-reactions-entry="g.e">
			<button v-if="kind === 'list' && canReact"
				type="button"
				class="knorke-reactnames__head knorke-reactnames__head--button"
				:class="{ 'knorke-reactnames__head--mine': g.mine }"
				:aria-pressed="g.mine ? 'true' : 'false'"
				:data-knorke-react="g.e"
				@click="$emit('react', g.e)">
				<span class="knorke-reactnames__emoji">{{ fromHex(g.e) }}</span>
				<span class="knorke-reactnames__count">{{ g.n }}</span>
			</button>
			<div v-else
				class="knorke-reactnames__head"
				:class="{ 'knorke-reactnames__head--mine': g.mine }">
				<span class="knorke-reactnames__emoji">{{ fromHex(g.e) }}</span>
				<span class="knorke-reactnames__count">{{ g.n }}</span>
			</div>
			<ul class="knorke-reactnames__names">
				<li v-for="(p, i) in g.names"
					:key="i"
					:class="{ 'knorke-reactnames__name--mine': p.mine }"
					:data-knorke-reactions-name="p.mine ? 'mine' : ''">
					{{ nameLine(p) }}
				</li>
			</ul>
		</section>
	</div>
</template>

<script setup>
/*
 * Who reacted (factory job 172), a DOM popover at a pill or at "+n" (prop
 * rect, board px; components/reactions.js popoverPlace):
 * - kind 'names' ([data-knorke-reactions=names]): one emoji, its count and
 *   every name (summarize: localeCompare), the own one as "{name} (you)";
 *   from a resting mouse a tooltip that ignores the pointer (the scene hides
 *   it when the mouse leaves the pill), from a long press (hold) a popover
 *   that scrolls and closes on Esc or a pointerdown beside it
 * - kind 'list' ([data-knorke-reactions=list]): every emoji of the note with
 *   its count and names; while this person may react (canReact) each head
 *   is a button ([data-knorke-react=<e>], aria-pressed for the own one) that
 *   acts like the pill (react(e)); it closes on Esc or a pointerdown beside it
 * Names are interpolated text, never HTML. From about ten lines on the
 * names scroll (knorke.css).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fromHex } from '../model/reactions.js'
import { nameLine, popoverPlace } from './reactions.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	/** 'names' (one emoji) or 'list' (every emoji, from "+n") */
	kind: { type: String, default: 'names' },
	/** the note */
	id: { type: String, default: '' },
	/** [{e, n, mine, names: [{name, mine}]}] (model/reactions.js summarize) */
	entries: { type: Array, default: () => [] },
	/** {x, y, w, h} board px: the pill or "+n" */
	rect: { type: Object, default: null },
	/** this person may react (the list's heads act like pills) */
	canReact: { type: Boolean, default: false },
	/** names opened by a long press: a popover, not a tooltip */
	hold: { type: Boolean, default: false },
})

const emit = defineEmits(['react', 'close'])

const root = ref(null)
/** {w, h, bw, bh}: the popover and its board in px (null until measured) */
const measured = ref(null)

const style = computed(() => {
	const m = measured.value
	const p = popoverPlace(props.rect, m ? { w: m.w, h: m.h } : null, m ? { w: m.bw, h: m.bh } : null)
	return { left: p.x + 'px', top: p.y + 'px' }
})

/** Measures the popover and the board (its parent) for the placement. */
function measure() {
	const el = root.value
	const box = el?.parentElement
	if (!el || !box) {
		return
	}
	measured.value = { w: el.offsetWidth, h: el.offsetHeight, bw: box.clientWidth, bh: box.clientHeight }
}

watch(() => [props.rect, props.entries], () => nextTick(measure))

const onDown = (e) => {
	if (props.kind === 'names' && !props.hold) {
		return
	}
	if (root.value && e?.target && !root.value.contains(e.target)) {
		emit('close')
	}
}

onMounted(() => {
	measure()
	document.addEventListener('pointerdown', onDown, true)
	window.addEventListener('resize', measure)
	if (props.kind === 'list') {
		root.value?.querySelector?.('button')?.focus?.({ preventScroll: true })
	}
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onDown, true)
	window.removeEventListener('resize', measure)
})
</script>
