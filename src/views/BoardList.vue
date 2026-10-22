<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-list" data-knorke="board-list">
		<h2 class="knorke-list__heading">
			{{ heading }}
		</h2>
		<div v-if="loading && boards.length === 0" class="knorke-list__loading">
			<NcLoadingIcon :size="32" :name="t('knorke', 'Loading boards …')" />
		</div>
		<NcEmptyContent v-else-if="error"
			:name="t('knorke', 'Could not load the boards')"
			:description="error">
			<template #icon>
				<NcIconSvgWrapper :path="icons.board" />
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-else-if="shown.length === 0 && filter === 'shared'"
			:name="t('knorke', 'Nothing has been shared with you yet.')"
			data-knorke-empty="shared">
			<template #icon>
				<NcIconSvgWrapper :path="icons.share" />
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-else-if="shown.length === 0"
			:name="t('knorke', 'No boards yet')"
			:description="t('knorke', 'Create your first board with “New board”.')">
			<template #icon>
				<NcIconSvgWrapper :path="icons.board" />
			</template>
		</NcEmptyContent>
		<ul v-else class="knorke-list__items">
			<li v-for="b in shown"
				:key="b.id"
				class="knorke-list__item"
				:data-knorke-board="b.id"
				:data-knorke-board-source="sourceOf(b)"
				:data-knorke-board-access="boardAccess(b)">
				<a class="knorke-list__link"
					:href="href({ name: 'board', id: b.id })"
					@click="open($event, b.id)">
					<span class="knorke-list__icon" aria-hidden="true">
						<NcIconSvgWrapper :path="icons.board" />
					</span>
					<span class="knorke-list__main">
						<span class="knorke-list__title">{{ b.title }}</span>
						<span class="knorke-list__meta">
							<template v-if="b.role !== 'owner' && b.owner">{{ t('knorke', 'by {name}', { name: b.owner.name }) }} · </template><template v-if="sourceOf(b) !== 'own'">{{ sourceLabel(sourceOf(b)) }} · {{ accessLabel(boardAccess(b)) }} · </template>{{ relative(b.updatedAt) }}
						</span>
					</span>
				</a>
				<span v-if="b.role === 'owner'" class="knorke-list__actions">
					<NcActions :inline="2">
						<NcActionButton data-knorke-action="rename" @click="$emit('rename', b)">
							<template #icon>
								<NcIconSvgWrapper :path="icons.pencil" />
							</template>
							{{ t('knorke', 'Rename') }}
						</NcActionButton>
						<NcActionButton data-knorke-action="delete" @click="$emit('delete', b)">
							<template #icon>
								<NcIconSvgWrapper :path="icons.trash" />
							</template>
							{{ t('knorke', 'Delete') }}
						</NcActionButton>
					</NcActions>
				</span>
			</li>
		</ul>
	</div>
</template>

<script setup>
/*
 * Board list (SPEC-M0 §6.6, §6.8): own boards and boards joined through a
 * link, newest first (the server sorts). [data-knorke=board-list] is always
 * in the DOM; every row is [data-knorke-board=<id>] and opens on click.
 * Rename and delete only for the owner.
 *
 * (U14) Each row stays a list item. Its title and meta sit in a real link
 * (href = the board URL, its content is its name: no aria-label override,
 * so owner and time are read too); the owner's actions are a sibling of the
 * link, never inside it. A plain click opens the board in the app; with a
 * modifier key or the middle button the browser handles the link (new tab).
 * The link fills the row up to the actions, so a click on the row still
 * opens the board.
 *
 * SPEC-M1 stage 2 (§4.10.4, §6.6 BoardList, R13): the navigation filters
 * "All", "Mine" (source own) and "Shared with me" (source share or link)
 * pick what the list shows (prop filter). Each row carries its origin
 * [data-knorke-board-source=own|share|link] and access level
 * [data-knorke-board-access=owner|moderate|edit|vote|view]; a board that is
 * not the user's own names both ("Shared with you · Can edit"), so one knows
 * before opening it what one may do. An empty "Shared with me" says
 * "Nothing has been shared with you yet.".
 *
 * (R14-12) While FEATURES.voting is false a row with access vote says
 * "Can view" (such a board opens view-only, like the role toasts); its hook
 * stays [data-knorke-board-access=vote] (components/share.js accessLabel).
 */
import { computed } from 'vue'
import { getLanguage } from '@nextcloud/l10n'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { icons } from '../components/icons.js'
import { accessLabel, boardAccess, filterBoards, sourceLabel, sourceOf } from '../components/share.js'
import { href } from '../router.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	boards: { type: Array, default: () => [] },
	loading: { type: Boolean, default: false },
	error: { type: String, default: '' },
	/** 'all' | 'mine' | 'shared' (navigation, R13) */
	filter: { type: String, default: 'all' },
})

const shown = computed(() => filterBoards(props.boards, props.filter))
const heading = computed(() => (props.filter === 'mine'
	? t('knorke', 'Mine')
	: props.filter === 'shared' ? t('knorke', 'Shared with me') : t('knorke', 'All boards')))

const emit = defineEmits(['open', 'rename', 'delete'])

/**
 * @param {MouseEvent} e click
 * @param {number} id board id
 */
function open(e, id) {
	if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
		return
	}
	e.preventDefault()
	emit('open', id)
}

let formatter = null

/**
 * @param {number} ms timestamp in ms
 * @return {string} relative time ("3 minutes ago")
 */
function relative(ms) {
	if (!Number.isFinite(ms) || ms <= 0) {
		return ''
	}
	try {
		formatter = formatter ?? new Intl.RelativeTimeFormat(getLanguage() || undefined, { numeric: 'auto' })
	} catch (e) {
		formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
	}
	const diff = (ms - Date.now()) / 1000
	const abs = Math.abs(diff)
	if (abs < 60) {
		return formatter.format(Math.round(diff), 'second')
	}
	if (abs < 3600) {
		return formatter.format(Math.round(diff / 60), 'minute')
	}
	if (abs < 86400) {
		return formatter.format(Math.round(diff / 3600), 'hour')
	}
	if (abs < 86400 * 30) {
		return formatter.format(Math.round(diff / 86400), 'day')
	}
	if (abs < 86400 * 365) {
		return formatter.format(Math.round(diff / (86400 * 30)), 'month')
	}
	return formatter.format(Math.round(diff / (86400 * 365)), 'year')
}
</script>
