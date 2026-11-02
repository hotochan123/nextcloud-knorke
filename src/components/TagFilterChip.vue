<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-banner knorke-banner--tags"
		data-knorke-tag-filter
		data-knorke-bar="banner"
		role="status">
		<button type="button"
			class="knorke-banner__text knorke-banner__link"
			data-knorke-action="tag-filter-open"
			:title="t('knorke', 'Filter by tags')"
			@click="$emit('open')">
			{{ t('knorke', 'Tags: {names}', { names: names.join(', ') }) }}
		</button>
		<NoticeClose :label="t('knorke', 'Clear filter')"
			action="tag-filter-clear"
			@close="$emit('clear')" />
	</div>
</template>

<script setup>
/*
 * The chip of the tag filter (factory job 191) in the banner stack while
 * this tab filters by tags: the chosen names (components/tags.js
 * filterNames, interpolated text) open the filter panel (emit open),
 * "Clear filter" ends the filter (emit clear).
 * Job 228: a notice like the others (one at a time, bars.js noticeOf); its
 * close button "×" is "Clear filter" ([data-knorke-action=tag-filter-clear]).
 */
import { t } from '../util/l10n.js'
import NoticeClose from './NoticeClose.vue'

defineProps({
	/** the names of the chosen tags */
	names: { type: Array, default: () => [] },
})

defineEmits(['open', 'clear'])
</script>
