<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section class="knorke-votepanel"
		:class="{ 'knorke-votepanel--sheet': narrow }"
		role="dialog"
		:aria-label="votes.open ? t('knorke', 'Vote list') : t('knorke', 'Results')"
		data-knorke-vote-panel
		@keydown.esc.stop.prevent="$emit('close')">
		<header class="knorke-votepanel__head">
			<h3 class="knorke-votepanel__title">
				{{ votes.open ? t('knorke', 'Vote list') : t('knorke', 'Results') }}
			</h3>
			<span v-if="votes.open && votes.canVote" class="knorke-votepanel__left">
				{{ n('knorke', '%n vote left', '%n votes left', votes.left ?? 0) }}
			</span>
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Close')"
				:title="t('knorke', 'Close')"
				data-knorke-action="vote-panel-close"
				@click="$emit('close')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.close" />
				</template>
			</NcButton>
		</header>
		<ul v-if="votes.open" class="knorke-votepanel__list">
			<li v-if="items.length === 0" class="knorke-votepanel__empty">
				{{ t('knorke', 'No items can get votes.') }}
			</li>
			<li v-for="it in items"
				:key="it.id"
				class="knorke-votepanel__item"
				:data-knorke-vote-item="it.id">
				<button type="button"
					class="knorke-votepanel__text"
					:title="t('knorke', 'Show on the board')"
					data-knorke-action="vote-focus"
					@click="$emit('focus', it.id)">
					{{ excerpt(it.text) || t('knorke', '(no text)') }}
				</button>
				<template v-if="votes.canVote">
					<button type="button"
						class="knorke-votepanel__step"
						:disabled="it.mine <= 0"
						:aria-label="t('knorke', 'Remove a vote from “{text}”', { text: label(it) })"
						data-knorke-action="vote-remove"
						@click="$emit('vote', it.id, it.mine - 1)">
						−
					</button>
					<span class="knorke-votepanel__count">
						<span aria-hidden="true">{{ it.mine }}</span>
						<span class="hidden-visually">{{ countLabel(it) }}</span>
					</span>
					<button type="button"
						class="knorke-votepanel__step"
						:disabled="it.mine >= votes.perItem"
						:aria-label="t('knorke', 'Add a vote to “{text}”', { text: label(it) })"
						data-knorke-action="vote-add"
						@click="$emit('vote', it.id, it.mine + 1)">
						+
					</button>
				</template>
			</li>
		</ul>
		<template v-else>
			<ol v-if="ranking.length > 0" class="knorke-votepanel__results" data-knorke-vote-results>
				<li v-for="(r, i) in ranking"
					:key="r.id"
					class="knorke-votepanel__result"
					:class="{ 'knorke-votepanel__result--top': i < 3 }">
					<button type="button"
						class="knorke-votepanel__text"
						:disabled="!r.exists"
						data-knorke-action="vote-focus"
						@click="$emit('focus', r.id)">
						<span class="knorke-votepanel__rank">{{ i + 1 }}.</span>
						{{ excerpt(r.text) || t('knorke', '(no text)') }}
					</button>
					<span class="knorke-votepanel__count">{{ r.n }}</span>
				</li>
			</ol>
			<p v-else class="knorke-votepanel__empty" data-knorke-vote-results>
				{{ t('knorke', 'No votes were cast.') }}
			</p>
			<div class="knorke-votepanel__actions">
				<NcButton v-if="ranking.length > 0"
					variant="secondary"
					data-knorke-action="vote-copy"
					@click="$emit('copy')">
					{{ t('knorke', 'Copy results') }}
				</NcButton>
				<template v-if="votes.mod">
					<NcButton v-if="!votes.show"
						variant="secondary"
						:disabled="busy"
						data-knorke-action="vote-show"
						@click="$emit('show')">
						{{ t('knorke', 'Show results on the board') }}
					</NcButton>
					<NcButton v-else
						variant="secondary"
						:disabled="busy"
						data-knorke-action="vote-hide"
						@click="$emit('hide')">
						{{ t('knorke', 'Hide from board') }}
					</NcButton>
					<NcButton variant="secondary"
						:disabled="busy"
						data-knorke-action="vote-clear"
						@click="$emit('clear')">
						{{ t('knorke', 'Close results') }}
					</NcButton>
				</template>
			</div>
		</template>
	</section>
</template>

<script setup>
/*
 * Vote panel (SPEC-M1 §6.6 VotePanel, §6.8, §6.12): while a session is open
 * the list of all items that can get votes (text excerpt, own count, − and
 * + with ≥ 44 px targets; [data-knorke-vote-item=<id>], vote-add,
 * vote-remove) – the way to vote without the canvas (WCAG 2.5.7) and the
 * main way on phones; a click on the text shows the item (zoomToItem;
 * [data-knorke-action=vote-focus], also on the ranking rows). (R22, P7-11)
 * In the narrow layout the board closes this sheet first, with the side
 * panel it keeps the panel's width free (BoardView focusItem).
 * "+" stays active when no votes are left: the click says "You have no
 * votes left." (a disabled button would explain nothing).
 * After the close: the ranking (top 3 marked, [data-knorke-vote-results]),
 * "No votes were cast.", "Copy results"; moderators "Show results on the
 * board" / "Hide from board" and "Close results" (clear). The board opens
 * it once per sid when the session turns closed, and in the narrow layout
 * at the start of a session (a bottom sheet there). While it is open during
 * a session, this tab sends no presence (§6.4).
 */
import { computed } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { n, t } from '../util/l10n.js'
import { excerpt } from './bars.js'
import { icons } from './icons.js'

const props = defineProps({
	/** BoardSession.votesView() */
	votes: { type: Object, required: true },
	/** session.votableItems(): [{id, text, mine}] */
	items: { type: Array, default: () => [] },
	/** (id) => {text, exists} of a result item */
	lookup: { type: Function, default: () => ({ text: '', exists: false }) },
	narrow: { type: Boolean, default: false },
	busy: { type: Boolean, default: false },
})

defineEmits(['vote', 'focus', 'show', 'hide', 'clear', 'copy', 'close'])

const ranking = computed(() => (props.votes.results ?? []).filter((r) => r[1] > 0).map(([id, count]) => {
	const info = props.lookup(id)
	return { id, n: count, text: info.text, exists: info.exists }
}))

/**
 * @param {{text: string, mine: number}} it item
 * @return {string} accessible name of the own count
 */
function countLabel(it) {
	return t('knorke', 'Vote for "{text}", {mine} of {perItem}', { text: label(it), mine: it.mine, perItem: props.votes.perItem })
}

/**
 * @param {{text: string}} it item
 * @return {string} its short text for labels
 */
function label(it) {
	return excerpt(it.text, 40) || t('knorke', '(no text)')
}
</script>
