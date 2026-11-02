<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section class="knorke-comments"
		:class="{ 'knorke-comments--sheet': sheet }"
		role="dialog"
		:aria-label="t('knorke', 'Comments')"
		data-knorke-comments
		data-knorke-chrome
		@keydown.esc.stop.prevent="$emit('close')">
		<header class="knorke-comments__head">
			<h3 class="knorke-comments__title">
				{{ t('knorke', 'Comments') }}
			</h3>
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Close')"
				:title="t('knorke', 'Close')"
				data-knorke-action="comments-close"
				@click="$emit('close')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.close" />
				</template>
			</NcButton>
		</header>
		<slot v-if="$slots.thread" name="thread" />
		<template v-else>
			<div class="knorke-comments__bar">
				<NcButton v-if="canWrite"
					variant="secondary"
					data-knorke-action="comment-new"
					@click="$emit('new')">
					<template #icon>
						<NcIconSvgWrapper :path="icons.plus" />
					</template>
					{{ t('knorke', 'New comment') }}
				</NcButton>
				<label class="knorke-comments__switch">
					<input type="checkbox"
						:checked="bubbles"
						data-knorke-comments-bubbles
						@change="(e) => $emit('bubbles', e.target.checked)">
					{{ t('knorke', 'Show bubbles') }}
				</label>
			</div>
			<div class="knorke-comments__tabs" role="tablist" :aria-label="t('knorke', 'Comments')">
				<button v-for="x in TABS"
					:id="tabId(x)"
					:key="x"
					type="button"
					role="tab"
					class="knorke-comments__tab"
					:class="{ 'knorke-comments__tab--active': tab === x }"
					:aria-selected="tab === x ? 'true' : 'false'"
					:aria-controls="listId"
					:tabindex="tab === x ? 0 : -1"
					:data-knorke-comments-tab="x"
					@click="setTab(x)"
					@keydown.left.prevent="setTab(other(x), true)"
					@keydown.right.prevent="setTab(other(x), true)">
					{{ x === 'open' ? t('knorke', 'Open ({n})', { n: counts.open }) : t('knorke', 'Resolved ({n})', { n: counts.resolved }) }}
				</button>
			</div>
			<ul :id="listId"
				class="knorke-comments__list"
				role="tabpanel"
				:aria-labelledby="tabId(tab)">
				<li v-if="entries.length === 0" class="knorke-comments__empty">
					{{ !loaded ? t('knorke', 'Loading comments …') : tab === 'open' ? t('knorke', 'No open comments.') : t('knorke', 'No resolved comments.') }}
				</li>
				<li v-for="e in entries" :key="e.id" class="knorke-comments__entry">
					<button type="button"
						class="knorke-comments__open"
						:data-knorke-comment-entry="e.id"
						@click="$emit('open', e.id)">
						<span class="knorke-comments__meta">
							<span class="knorke-comments__author">{{ e.guest ? t('knorke', '{name} (guest)', { name: e.author }) : e.author }}</span>
							<span class="knorke-comments__time">{{ timeLabel(e.at, now || Date.now(), lang) }}</span>
						</span>
						<span class="knorke-comments__text">{{ e.text }}</span>
						<span v-if="e.replies > 0" class="knorke-comments__replies">{{ n('knorke', '%n reply', '%n replies', e.replies) }}</span>
					</button>
				</li>
			</ul>
		</template>
	</section>
</template>

<script setup>
/*
 * The comment panel (factory job 189): on the right like the vote list,
 * full screen with "Close" on phones (sheet); it and the vote list exclude
 * each other (the board view). The tabs "Open" and "Resolved" with their
 * numbers (comments.js tabCounts), "New comment" while this person may
 * write and the board is not frozen, the switch "Show bubbles". The entries
 * are newest activity first (comments.js listEntries): author, the first
 * text (two lines), "{n} replies", the time; a click emits open(id) (the
 * board view: an open thread pans to its bubble and opens there, a resolved
 * one opens inside the panel, slot thread).
 *
 * Job 228 (redesign): 296 px wide (--k-panel-w), under the right island
 * and above the zoom controls; "New comment" is a secondary button (the board
 * has one primary, "Share"), the tabs look like a segment (knorke.css).
 *
 * Events: close, new, open(id), bubbles(bool), tab(name).
 */
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { icons } from './icons.js'
import { listEntries, tabCounts, timeLabel } from '../board/comments.js'
import { language, n, t } from '../util/l10n.js'

const TABS = ['open', 'resolved']
let seq = 0

const props = defineProps({
	/** the threads (BoardSession.commentsView) */
	threads: { type: Array, default: () => [] },
	/** the threads have loaded once */
	loaded: { type: Boolean, default: false },
	/** "New comment" (may write, not frozen) */
	canWrite: { type: Boolean, default: false },
	/** "Show bubbles" */
	bubbles: { type: Boolean, default: true },
	/** full screen (phones) */
	sheet: { type: Boolean, default: false },
	/** the tab shown first */
	initialTab: { type: String, default: 'open' },
	/** server time for the time labels */
	now: { type: Number, default: 0 },
})

const emit = defineEmits(['close', 'new', 'open', 'bubbles', 'tab'])

const tab = ref(TABS.includes(props.initialTab) ? props.initialTab : 'open')
const listId = 'knorke-comments-list-' + (++seq)
const lang = language()
const counts = computed(() => tabCounts(props.threads))
const entries = computed(() => listEntries(props.threads, tab.value))

/** @param {string} x tab @return {string} its element id */
function tabId(x) {
	return listId + '-' + x
}

/** @param {string} x tab @return {string} the other tab */
function other(x) {
	return x === 'open' ? 'resolved' : 'open'
}

/**
 * @param {string} x tab
 * @param {boolean} [focus] move the focus to it (arrow keys)
 */
function setTab(x, focus = false) {
	tab.value = x
	emit('tab', x)
	if (focus && typeof document !== 'undefined') {
		document.getElementById(tabId(x))?.focus()
	}
}

defineExpose({ setTab })
</script>
