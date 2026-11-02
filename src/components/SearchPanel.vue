<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section class="knorke-search"
		:class="{ 'knorke-search--narrow': narrow }"
		role="search"
		:aria-label="t('knorke', 'Search on the board')"
		data-knorke-search
		data-knorke-chrome
		@keydown.esc.stop.prevent="$emit('close')">
		<div class="knorke-search__bar">
			<input ref="field"
				v-model="query"
				class="knorke-search__field"
				type="search"
				enterkeyhint="search"
				autocomplete="off"
				spellcheck="false"
				:placeholder="t('knorke', 'Search on this board')"
				:aria-label="t('knorke', 'Search on this board')"
				:aria-controls="listId"
				data-knorke-field="search"
				@keydown="onFieldKey">
			<span class="knorke-search__count" aria-live="polite" data-knorke-search-count>{{ countText }}</span>
			<NcButton variant="tertiary"
				:disabled="hits.length === 0"
				:aria-label="t('knorke', 'Previous result')"
				:title="t('knorke', 'Previous result')"
				data-knorke-action="search-previous"
				@click="step(-1)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.caretUp" />
				</template>
			</NcButton>
			<NcButton variant="tertiary"
				:disabled="hits.length === 0"
				:aria-label="t('knorke', 'Next result')"
				:title="t('knorke', 'Next result')"
				data-knorke-action="search-next"
				@click="step(1)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.caretDown" />
				</template>
			</NcButton>
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Close')"
				:title="t('knorke', 'Close')"
				data-knorke-action="search-close"
				@click="$emit('close')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.close" />
				</template>
			</NcButton>
		</div>
		<ul v-if="hits.length > 0 && !folded"
			:id="listId"
			ref="list"
			class="knorke-search__list"
			:aria-label="t('knorke', 'Results')">
			<li v-for="(h, i) in hits" :key="h.kind + ':' + h.id">
				<button type="button"
					class="knorke-search__hit"
					:class="{ 'knorke-search__hit--current': i === index }"
					:aria-current="i === index ? 'true' : null"
					:data-knorke-search-hit="i"
					@click="pick(i)">
					<span class="knorke-search__kind">{{ kindLabel(h) }}</span>
					<span class="knorke-search__snippet">{{ h.before }}<mark class="knorke-search__mark">{{ h.match }}</mark>{{ h.after }}</span>
				</button>
			</li>
		</ul>
	</section>
</template>

<script setup>
/*
 * Search on the board (factory job 271), a lazy part (util/parts.js
 * search, with board/search.js). Under the top bar on the right, full
 * width on phones (narrow). The field searches what `source()` gives
 * ({model, threads, anchorOf}: the session's model and the loaded comment
 * threads, so only what this person may see) with board/search.js
 * searchBoard; typing waits TYPE_MS, a change of `rev` (the model or the
 * comments changed) RECOUNT_MS before it counts again. The current hit
 * stays while it is still found (same kind and id), else there is none.
 *
 * Enter goes to the next hit, Shift+Enter to the previous one (with
 * wrap-around, stepHit), as do the two arrow buttons: emit jump(hit,
 * 'step'). A click on a row: jump(hit, 'open'). Every change of the current
 * hit (also to none) emits current(hit|null), so the board view moves the
 * frame on the canvas. Esc and × emit close. Ctrl/⌘+F in the field selects
 * its text (the browser search stays off). On phones (narrow) the list
 * folds after a jump, so the hit stays visible; typing opens it again.
 *
 * The snippets are plain text ({{ }}), never HTML.
 *
 * Props: source (function), rev (number), narrow. Events: jump, current, close.
 * Exposed: focus() (the field, its text selected).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { icons } from './icons.js'
import { SEARCH_MAX, searchBoard, stepHit } from '../board/search.js'
import { n, t } from '../util/l10n.js'

const TYPE_MS = 120
const RECOUNT_MS = 250
let seq = 0

const props = defineProps({
	/** () => ({model, threads, anchorOf}) or null */
	source: { type: Function, required: true },
	/** grows with every change of the model or the comments */
	rev: { type: Number, default: 0 },
	/** full width under the top bar (phones) */
	narrow: { type: Boolean, default: false },
})

const emit = defineEmits(['jump', 'current', 'close'])

const listId = 'knorke-search-list-' + (++seq)
const field = ref(null)
const list = ref(null)
const query = ref('')
const hits = ref([])
const more = ref(false)
const index = ref(-1)
const folded = ref(false)
let timer = null

const countText = computed(() => {
	if (query.value.trim() === '') {
		return ''
	}
	const total = hits.value.length
	if (total === 0) {
		return t('knorke', 'No results')
	}
	const m = more.value ? SEARCH_MAX + '+' : String(total)
	return index.value >= 0
		? t('knorke', '{n} of {m}', { n: index.value + 1, m })
		: (more.value ? t('knorke', '{m} results', { m }) : n('knorke', '%n result', '%n results', total))
})

/**
 * @param {object} h hit
 * @return {string} the kind of a hit, for its row
 */
function kindLabel(h) {
	switch (h.kind) {
	case 'note': return t('knorke', 'Note')
	case 'shape': return t('knorke', 'Shape')
	case 'text': return t('knorke', 'Text')
	case 'table': return t('knorke', 'Table')
	case 'frame': return t('knorke', 'Frame')
	default: return h.resolved ? t('knorke', 'Resolved comment') : t('knorke', 'Open comment')
	}
}

/** Counts again now; keeps the current hit while it is still found. */
function recount() {
	clearTimeout(timer)
	timer = null
	const src = props.source?.() ?? null
	const prev = index.value >= 0 ? hits.value[index.value] : null
	const r = src ? searchBoard(src.model, src.threads, query.value, { anchorOf: src.anchorOf }) : { hits: [], more: false }
	hits.value = r.hits
	more.value = r.more
	const at = prev ? r.hits.findIndex((h) => h.kind === prev.kind && h.id === prev.id) : -1
	setIndex(at)
}

/** @param {number} ms wait before counting again */
function later(ms) {
	clearTimeout(timer)
	timer = setTimeout(recount, ms)
}

/** @param {number} i the new current hit (-1: none) */
function setIndex(i) {
	const before = index.value >= 0 ? hits.value[index.value] ?? null : null
	index.value = i
	const now = i >= 0 ? hits.value[i] ?? null : null
	if (now !== before) {
		emit('current', now)
	}
}

/** @param {number} i hit to show */
function show(i) {
	nextTick(() => list.value?.querySelector?.(`[data-knorke-search-hit="${i}"]`)?.scrollIntoView?.({ block: 'nearest' }))
}

/**
 * Enter, Shift+Enter, the arrow buttons.
 *
 * @param {1|-1} dir next or previous
 */
function step(dir) {
	if (timer !== null) {
		recount()
	}
	const i = stepHit(index.value, hits.value.length, dir)
	if (i < 0) {
		return
	}
	setIndex(i)
	if (props.narrow) {
		folded.value = true
	}
	show(i)
	emit('jump', hits.value[i], 'step')
}

/** @param {number} i a row of the list */
function pick(i) {
	if (!hits.value[i]) {
		return
	}
	setIndex(i)
	if (props.narrow) {
		folded.value = true
	}
	emit('jump', hits.value[i], 'open')
}

/** @param {KeyboardEvent} e keydown in the field */
function onFieldKey(e) {
	if (e.key === 'Enter' && !e.isComposing) {
		e.preventDefault()
		step(e.shiftKey ? -1 : 1)
	} else if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'f') {
		// neither the browser's nor Nextcloud's search (a listener on the document)
		e.preventDefault()
		e.stopPropagation()
		field.value?.select?.()
	}
}

/** The field gets the focus with its text selected. */
function focus() {
	field.value?.focus?.()
	field.value?.select?.()
}

watch(query, () => {
	folded.value = false
	later(TYPE_MS)
})
watch(() => props.rev, () => later(RECOUNT_MS))

onMounted(() => nextTick(focus))
onBeforeUnmount(() => {
	clearTimeout(timer)
	timer = null
})

defineExpose({ focus, recount })
</script>
