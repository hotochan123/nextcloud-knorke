<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-list"
		:class="{ 'knorke-list--grid': view === 'grid', 'knorke-list--narrow': narrow }"
		data-knorke="board-list"
		:data-knorke-view-mode="view">
		<div class="knorke-list__head">
			<h2 class="knorke-list__heading">
				{{ heading }}
			</h2>
			<NcActions v-if="boards.length > 0 && !error"
				class="knorke-list__sort"
				variant="tertiary"
				container="#knorke-menus"
				force-menu
				:menu-name="narrow ? undefined : sortName"
				:aria-label="sortName"
				data-knorke-action="sort">
				<template #icon>
					<NcIconSvgWrapper :path="icons.sort" />
				</template>
				<NcActionRadio v-for="s in SORTS"
					:key="s"
					name="knorke-board-sort"
					:value="s"
					:model-value="sort"
					:data-knorke-sort="s"
					@update:model-value="pickSort">
					{{ sortLabel(s) }}
				</NcActionRadio>
			</NcActions>
			<div v-if="boards.length > 0 && !error"
				class="knorke-list__views"
				role="group"
				:aria-label="t('knorke', 'View')"
				data-knorke-view-switch>
				<NcButton v-for="v in VIEWS"
					:key="v"
					variant="tertiary"
					:data-knorke-view="v"
					:aria-pressed="view === v ? 'true' : 'false'"
					:aria-label="viewLabel(v)"
					:title="viewLabel(v)"
					@click="pickView(v)">
					<template #icon>
						<NcIconSvgWrapper :path="v === 'grid' ? icons.viewGrid : icons.viewList" />
					</template>
				</NcButton>
			</div>
		</div>
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
		<NcEmptyContent v-else-if="shown.length === 0 && filter === 'favorites'"
			:name="t('knorke', 'No favorites yet')"
			:description="t('knorke', 'Mark a board with the star to find it here.')"
			data-knorke-empty="favorites">
			<template #icon>
				<NcIconSvgWrapper :path="icons.starOutline" />
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-else-if="shown.length === 0 && filter === 'shared'"
			:name="t('knorke', 'Nothing has been shared with you yet.')"
			:description="t('knorke', 'Boards that others share with you appear here.')"
			data-knorke-empty="shared">
			<template #icon>
				<NcIconSvgWrapper :path="icons.share" />
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-else-if="shown.length === 0 && filter === 'mine'"
			:name="t('knorke', 'No boards of your own yet')"
			:description="t('knorke', 'Create one with “New board”.')"
			data-knorke-empty="mine">
			<template #icon>
				<NcIconSvgWrapper :path="icons.account" />
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-else-if="shown.length === 0"
			:name="t('knorke', 'No boards yet')"
			:description="t('knorke', 'Create your first board with “New board”.')"
			data-knorke-empty="all">
			<template #icon>
				<img class="knorke-list__logo" :src="logo" alt="" width="64" height="64">
			</template>
		</NcEmptyContent>
		<ul v-else class="knorke-list__items">
			<li v-for="b in shown"
				:key="b.id"
				class="knorke-list__item"
				:data-knorke-board="b.id"
				:data-knorke-board-source="sourceOf(b)"
				:data-knorke-board-access="boardAccess(b)"
				:data-knorke-favorite="b.favorite === true ? 'true' : 'false'">
				<a :ref="(el) => setLink(el, b.id)"
					class="knorke-list__link"
					:href="href({ name: 'board', id: b.id })"
					@click="open($event, b.id)"
					@contextmenu="onMenu($event, b)"
					@pointerdown="onDown($event, b)"
					@pointermove="press.move"
					@pointerup="press.up"
					@pointercancel="press.cancel">
					<BoardSketch :board-id="b.id" :updated-at="b.updatedAt" />
					<span class="knorke-list__main">
						<span class="knorke-list__title">{{ b.title }}</span>
						<span class="knorke-list__meta">{{ relative(b.updatedAt) }}</span>
						<span v-if="origin(b)" class="knorke-list__meta knorke-list__origin">{{ origin(b) }}</span>
						<span v-if="narrow && b.favorite === true" class="hidden-visually">{{ t('knorke', 'Favorite') }}</span>
					</span>
				</a>
				<NcButton v-if="!narrow"
					class="knorke-list__star"
					variant="tertiary"
					data-knorke-action="favorite"
					:aria-pressed="b.favorite === true ? 'true' : 'false'"
					:aria-label="starLabel(b)"
					:title="starLabel(b)"
					:aria-disabled="favoriteBusy.includes(b.id) ? 'true' : null"
					@click="$emit('favorite', b.id)">
					<template #icon>
						<NcIconSvgWrapper :path="b.favorite === true ? icons.star : icons.starOutline" />
					</template>
				</NcButton>
				<span v-else-if="b.favorite === true" class="knorke-list__starmark" aria-hidden="true">
					<NcIconSvgWrapper :path="icons.star" />
				</span>
				<span v-if="b.role === 'owner' && !narrow" class="knorke-list__actions">
					<NcActions container="#knorke-menus"
						force-menu
						variant="tertiary"
						:aria-label="t('knorke', 'Actions for {title}', { title: b.title })">
						<template #icon>
							<NcIconSvgWrapper :path="icons.dotsHorizontal" />
						</template>
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
		<BoardActionsSheet v-if="sheetBoard"
			:board="sheetBoard"
			@favorite="sheetDo('favorite')"
			@rename="sheetDo('rename')"
			@delete="sheetDo('delete')"
			@close="closeSheet" />
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
 *
 * Factory job 219: every row has a star [data-knorke-action=favorite]
 * (aria-pressed, a sibling of the link like the actions; the row says
 * [data-knorke-favorite=true|false]); a click emits favorite(id), the shell
 * flips it and sends it (components/boardList.js useFavorites), and while
 * that row's request runs (prop favoriteBusy) the star is aria-disabled and
 * a click does nothing. The filter "Favorites" shows the starred boards; an
 * empty one says so [data-knorke-empty=favorites]. Next to the heading the
 * sort menu [data-knorke-action=sort] names the order in use and offers
 * [data-knorke-sort=opened|updated|name]; the choice is kept in this
 * browser (readSort/writeSort).
 *
 * Factory job 221: the picture of each row is a sketch of the board
 * (components/BoardSketch.vue: its frames and coloured boxes, no text,
 * asked for when the row comes into view), the board icon until it is
 * there and for an empty board.
 *
 * Factory job 232 (redesign, docs/redesign/ P9, P9b, V14): the rows are
 * cards in a grid (minmax 240 px; the picture on top at 240 : 150, the
 * title in up to two lines, the time muted, a board not of one's own names
 * its owner, origin and access in a second muted line). The star sits on
 * the picture: set it always shows, unset only under the pointer or with
 * the focus in the card (CSS, only where the device can hover). The
 * owner's "…" [NcActions "Actions for {title}"] beside the title holds
 * rename and delete. The switch [data-knorke-view-switch] picks
 * [data-knorke-view=grid|list] (kept in this browser, readView/writeView);
 * "List" shows rows with a 96 × 60 picture. Every filter has its empty
 * state [data-knorke-empty=all|mine|favorites|shared]. On a phone
 * (NARROW_QUERY, ≤ 600 px) two columns, no "…" and no star button: a set
 * star shows as a mark (the link says "Favorite"), and a long press of a
 * finger or pen (createLongPress) or the link's contextmenu event (a
 * right-click, Android's long press, the menu key) opens the sheet
 * BoardActionsSheet with the star, Rename and Delete instead of the
 * browser's menu; the click after a long press does not open the board.
 * Closing the sheet gives the focus back to the card's link.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getLanguage } from '@nextcloud/l10n'
import { imagePath } from '@nextcloud/router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import BoardActionsSheet from '../components/BoardActionsSheet.vue'
import BoardSketch from '../components/BoardSketch.vue'
import { NARROW_QUERY } from '../components/bars.js'
import { SORTS, VIEWS, createLongPress, readSort, readView, sortBoards, writeSort, writeView } from '../components/boardList.js'
import { icons } from '../components/icons.js'
import { accessLabel, boardAccess, filterBoards, sourceLabel, sourceOf } from '../components/share.js'
import { href } from '../router.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	boards: { type: Array, default: () => [] },
	loading: { type: Boolean, default: false },
	error: { type: String, default: '' },
	/** 'all' | 'favorites' | 'mine' | 'shared' (navigation, R13, job 219) */
	filter: { type: String, default: 'all' },
	/** ids of the boards whose star request runs (job 219) */
	favoriteBusy: { type: Array, default: () => [] },
})

/** 'opened' | 'updated' | 'name' (job 219) */
/** Job 283: the coloured logo L7 above "No boards yet" (fixed colours, the same in both themes). */
const logo = imagePath('knorke', 'app-color.svg')

const sort = ref(readSort())
/** 'grid' | 'list' (job 232) */
const view = ref(readView())
/** (job 232) the phone layout (≤ 600 px), live */
const narrow = ref(false)
/** (job 232) id of the board whose sheet is open, null without one */
const sheetId = ref(null)
const sheetBoard = computed(() => (sheetId.value === null ? null : props.boards.find((b) => b.id === sheetId.value) ?? null))
const shown = computed(() => sortBoards(filterBoards(props.boards, props.filter), sort.value, getLanguage()))
const sortName = computed(() => t('knorke', 'Sort: {order}', { order: sortLabel(sort.value) }))
const heading = computed(() => (props.filter === 'mine'
	? t('knorke', 'Mine')
	: props.filter === 'shared'
		? t('knorke', 'Shared with me')
		: props.filter === 'favorites' ? t('knorke', 'Favorites') : t('knorke', 'All boards')))

const emit = defineEmits(['open', 'rename', 'delete', 'favorite'])

/** (job 232) the long press of the phone layout */
const press = createLongPress((b) => openSheet(b))
/** (job 232) the cards' links by board id (the focus comes back to them) */
const links = new Map()

/**
 * @param {HTMLElement|null} el a card's link (null when it unmounts)
 * @param {number} id its board
 */
function setLink(el, id) {
	if (el) {
		links.set(id, el)
	} else {
		links.delete(id)
	}
}

let narrowQuery = null

/** @param {MediaQueryListEvent} e change of the narrow query */
function onNarrow(e) {
	narrow.value = !!e?.matches
	if (!narrow.value) {
		sheetId.value = null
	}
}

onMounted(() => {
	try {
		narrowQuery = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null
	} catch (e) {
		narrowQuery = null
	}
	narrow.value = !!narrowQuery?.matches
	narrowQuery?.addEventListener?.('change', onNarrow)
})

onBeforeUnmount(() => {
	narrowQuery?.removeEventListener?.('change', onNarrow)
	press.cancel()
})

/**
 * @param {string} s sort order
 * @return {string} its name in the menu
 */
function sortLabel(s) {
	return s === 'opened'
		? t('knorke', 'Last opened')
		: s === 'name' ? t('knorke', 'Name') : t('knorke', 'Last modified')
}

/** @param {string} s sort order picked in the menu */
function pickSort(s) {
	if (SORTS.includes(s)) {
		sort.value = s
		writeSort(s)
	}
}

/**
 * @param {string} v view
 * @return {string} its button's name (job 232)
 */
function viewLabel(v) {
	return v === 'list' ? t('knorke', 'List') : t('knorke', 'Grid')
}

/** @param {string} v view picked with the switch (job 232) */
function pickView(v) {
	if (VIEWS.includes(v)) {
		view.value = v
		writeView(v)
	}
}

/**
 * @param {object} b board
 * @return {string} name of its star button
 */
function starLabel(b) {
	return b.favorite === true ? t('knorke', 'Remove from favorites') : t('knorke', 'Add to favorites')
}

/**
 * @param {object} b board
 * @return {string} (job 232) owner, origin and access of a board not of one's own, else ''
 */
function origin(b) {
	const parts = []
	if (b.role !== 'owner' && b.owner) {
		parts.push(t('knorke', 'by {name}', { name: b.owner.name }))
	}
	if (sourceOf(b) !== 'own') {
		parts.push(sourceLabel(sourceOf(b)), accessLabel(boardAccess(b)))
	}
	return parts.join(' · ')
}

/**
 * @param {MouseEvent} e click
 * @param {number} id board id
 */
function open(e, id) {
	// job 232: the click that ends a long press only opened the sheet
	if (press.takeFired()) {
		e.preventDefault()
		return
	}
	if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
		return
	}
	e.preventDefault()
	emit('open', id)
}

/**
 * (job 232) A finger or pen on a card of the phone layout starts the long press.
 *
 * @param {PointerEvent} e pointerdown on the link
 * @param {object} b its board
 */
function onDown(e, b) {
	if (narrow.value) {
		press.down(e, b)
	} else {
		press.cancel()
	}
}

/**
 * (job 232) The link's context menu: on a phone the sheet instead of the
 * browser's menu; elsewhere the browser's menu ("Open in new tab").
 *
 * @param {MouseEvent} e contextmenu
 * @param {object} b its board
 */
function onMenu(e, b) {
	if (narrow.value) {
		e.preventDefault()
		openSheet(b)
	}
}

/** @param {object} b the board whose sheet opens */
function openSheet(b) {
	press.cancel()
	sheetId.value = b.id
}

/** Closes the sheet; the focus goes back to its card's link. */
function closeSheet() {
	const id = sheetId.value
	sheetId.value = null
	links.get(id)?.focus?.()
}

/** @param {'favorite'|'rename'|'delete'} what an entry of the sheet */
function sheetDo(what) {
	const b = sheetBoard.value
	sheetId.value = null
	if (!b) {
		return
	}
	if (what === 'favorite') {
		links.get(b.id)?.focus?.()
		emit('favorite', b.id)
	} else {
		emit(what, b)
	}
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
