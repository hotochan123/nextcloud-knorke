<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section ref="root"
		class="knorke-outline"
		:class="{ 'knorke-outline--narrow': narrow }"
		:style="top !== null ? { paddingTop: `calc(${top}px + var(--knorke-gap))` } : null"
		tabindex="-1"
		:aria-label="t('knorke', 'Outline')"
		data-knorke-outline
		@keydown="onKey">
		<div class="knorke-outline__page">
			<div class="knorke-outline__head">
				<h2 class="knorke-outline__title">
					{{ boardTitle }}
				</h2>
				<div class="knorke-outline__actions">
					<NcButton variant="secondary"
						data-knorke-action="outline-copy"
						@click="copy">
						<template #icon>
							<NcIconSvgWrapper :path="icons.copy" />
						</template>
						{{ t('knorke', 'Copy as text') }}
					</NcButton>
					<NcButton variant="secondary"
						data-knorke-action="outline-download"
						@click="download">
						<template #icon>
							<NcIconSvgWrapper :path="icons.download" />
						</template>
						{{ t('knorke', 'Download as Markdown') }}
					</NcButton>
				</div>
			</div>
			<p v-if="outline.sections.length === 0" class="knorke-outline__empty" data-knorke-outline-empty>
				{{ t('knorke', 'This board has no text yet.') }}
			</p>
			<section v-for="s in outline.sections"
				:key="s.frame ?? ''"
				class="knorke-outline__section">
				<h3 class="knorke-outline__frame">
					<button v-if="s.frame !== null"
						type="button"
						class="knorke-outline__heading"
						:data-knorke-outline-frame="s.frame"
						@click="$emit('jump', s.frame)">
						{{ s.title }}
					</button>
					<span v-else class="knorke-outline__heading knorke-outline__heading--loose" data-knorke-outline-loose>{{ t('knorke', 'Not in a frame') }}</span>
				</h3>
				<p v-if="s.items.length === 0" class="knorke-outline__none">
					{{ t('knorke', 'No notes') }}
				</p>
				<ul v-else class="knorke-outline__list" role="list">
					<li v-for="p in s.items" :key="p.id">
						<button type="button"
							class="knorke-outline__item"
							:data-knorke-outline-item="p.id"
							@click="$emit('jump', p.id)">
							<span class="knorke-outline__text">{{ plainText(p.text) }}</span>
						</button>
					</li>
				</ul>
			</section>
		</div>
	</section>
</template>

<script setup>
/*
 * The board as an outline (factory job 274), a lazy part (util/parts.js
 * outline, with board/outline.js). It covers the board below the top bar
 * and lists what `source()` gives ({model, frames}: the session's model and
 * its frames with their shown titles) through boardOutline: frame titles as
 * headings, their notes, text items and shapes with text as points, the
 * loose ones last. Read only; the texts are plain text ({{ }}), never HTML.
 *
 * A change of `rev` (the model changed) counts again, at most every
 * RECOUNT_MS. A point or a frame heading emits jump(id); Esc emits close.
 * Every other key stays here (stopPropagation), so the canvas shortcuts
 * (Delete, Ctrl+Z, …) never act on a board the person does not see; the
 * board view takes Ctrl/⌘+F in its capture phase before this.
 *
 * "Copy as text" (outlineText, components/copyText.js with its textarea
 * fallback) and "Download as Markdown" (outlineMarkdown as
 * exportFileName(title, today, 'md'), text/markdown) take it along.
 *
 * Round 1: the page starts at `top` (below the top bar and the notices
 * under it, measured by the board view), so no notice covers its head; each
 * point draws its own bullet at its first line.
 *
 * Props: source (function), rev (number), title (the board title), top, narrow.
 * Events: jump(id), close. Exposed: focus().
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { icons } from './icons.js'
import { copyText } from './copyText.js'
import { boardOutline, outlineMarkdown, outlineText } from '../board/outline.js'
import { plainText } from '../model/richText.js'
import { exportFileName } from '../scene/exportImage.js'
import { downloadText } from '../util/download.js'
import { t } from '../util/l10n.js'
import { showError, showInfo } from '../util/toast.js'

/** Longest wait (ms) between a change of the board and the new outline. */
const RECOUNT_MS = 250

const props = defineProps({
	/** () => ({model, frames}) or null */
	source: { type: Function, required: true },
	/** grows with every change of the model */
	rev: { type: Number, default: 0 },
	/** the board title */
	title: { type: String, default: '' },
	/** (round 1) board px where the page starts: below the top bar and its notices; null: the CSS default */
	top: { type: Number, default: null },
	/** phones: smaller margins */
	narrow: { type: Boolean, default: false },
})

const emit = defineEmits(['jump', 'close'])

const root = ref(null)
const outline = shallowRef({ sections: [] })
let timer = null

const boardTitle = computed(() => (props.title.trim() !== '' ? props.title.trim() : t('knorke', 'Board')))

/** Counts the outline again now. */
function recount() {
	clearTimeout(timer)
	timer = null
	const src = props.source?.() ?? null
	outline.value = src ? boardOutline(src.model, src.frames) : { sections: [] }
}

/** A change of the board: the outline follows at most every RECOUNT_MS. */
function later() {
	if (timer === null) {
		timer = setTimeout(recount, RECOUNT_MS)
	}
}

/** @return {string} the name of the loose section */
function looseTitle() {
	return t('knorke', 'Not in a frame')
}

/** "Copy as text". */
async function copy() {
	if (timer !== null) {
		recount()
	}
	const ok = await copyText(outlineText(outline.value, boardTitle.value, looseTitle()))
	if (ok) {
		showInfo(t('knorke', 'Outline copied'), { hook: 'outline-copied' })
	} else {
		showError(t('knorke', 'Could not copy the outline'), { hook: 'outline-copy-failed' })
	}
}

/** "Download as Markdown". */
function download() {
	if (timer !== null) {
		recount()
	}
	try {
		downloadText(exportFileName(props.title, new Date(), 'md'), outlineMarkdown(outline.value, boardTitle.value, looseTitle()), 'text/markdown;charset=utf-8')
	} catch (e) {
		console.error('[knorke] outline download failed', e)
		showError(t('knorke', 'The outline could not be saved.'), { hook: 'outline-download-failed' })
	}
}

/** @param {KeyboardEvent} e keydown inside the outline */
function onKey(e) {
	if (e.key === 'Escape' && !e.isComposing) {
		e.preventDefault()
		emit('close')
	}
	e.stopPropagation()
}

/** The outline takes the focus (keyboard users start here). */
function focus() {
	root.value?.focus?.({ preventScroll: true })
}

watch(() => props.rev, later)

recount()
onMounted(() => nextTick(focus))
onBeforeUnmount(() => {
	clearTimeout(timer)
	timer = null
})

defineExpose({ focus, recount })
</script>
