<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<Teleport to="body">
		<div class="knorke-sheet__scrim"
			@pointerdown="onDown"
			@mousedown.prevent
			@click="act('close', $event)" />
		<div ref="el"
			class="knorke-sheet"
			role="dialog"
			aria-modal="true"
			:aria-labelledby="'knorke-sheet-title-' + board.id"
			data-knorke-sheet="board-actions"
			@pointerdown="onDown"
			@mousedown="keepFocus">
			<h3 :id="'knorke-sheet-title-' + board.id" class="knorke-sheet__title">
				{{ board.title }}
			</h3>
			<button type="button"
				class="knorke-sheet__entry"
				data-knorke-action="favorite"
				@click="act('favorite', $event)">
				<NcIconSvgWrapper :path="board.favorite === true ? icons.star : icons.starOutline" />
				{{ board.favorite === true ? t('knorke', 'Remove from favorites') : t('knorke', 'Add to favorites') }}
			</button>
			<template v-if="board.role === 'owner'">
				<button type="button"
					class="knorke-sheet__entry"
					data-knorke-action="rename"
					@click="act('rename', $event)">
					<NcIconSvgWrapper :path="icons.pencil" />
					{{ t('knorke', 'Rename') }}
				</button>
				<button type="button"
					class="knorke-sheet__entry knorke-sheet__entry--danger"
					data-knorke-action="delete"
					@click="act('delete', $event)">
					<NcIconSvgWrapper :path="icons.trash" />
					{{ t('knorke', 'Delete') }}
				</button>
			</template>
		</div>
	</Teleport>
</template>

<script setup>
/*
 * The actions of a board card on a phone (factory job 232, docs/redesign/
 * P9b, V14): a sheet at the bottom, opened by a long press on the card (or
 * its context menu event). A dialog (aria-modal) named by the board's
 * title, with native buttons of at least 44 px: the star for everyone
 * ("Add to favorites" / "Remove from favorites"), Rename and Delete for the
 * owner. The first entry gets the focus; Tab stays inside; Esc or a tap
 * beside it emits close, an entry emits its action (the list closes the
 * sheet and gives the focus back to the card's link). Teleported to <body>,
 * above Nextcloud's header and navigation.
 *
 * The finger of the long press is still down when the sheet opens, and the
 * click that ends the press lands on whatever lies under it now: the scrim
 * or an entry. So a click of a pointer counts only after a pointer went
 * down in the sheet or on its scrim; a click of the keyboard (detail 0)
 * always counts. The mouse event a browser sends when the finger lifts
 * would take the focus away from the entry (to <body>): the scrim and the
 * sheet's own surface keep it (preventDefault on mousedown), and Esc and Tab
 * are heard on the document while the sheet is open.
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'

defineProps({
	/** the board of the card: {id, title, favorite, role} */
	board: { type: Object, required: true },
})

const emit = defineEmits(['favorite', 'rename', 'delete', 'close'])

const el = ref(null)
/** A pointer went down in the sheet or on its scrim since it opened. */
let down = false

function onDown() {
	down = true
}

/**
 * @param {'favorite'|'rename'|'delete'|'close'} what the entry (or the scrim's close)
 * @param {MouseEvent} e its click
 */
function act(what, e) {
	if (e?.detail === 0 || down) {
		emit(what)
	}
}

/** @return {HTMLElement[]} the sheet's buttons */
function entries() {
	return [...(el.value?.querySelectorAll('button') ?? [])]
}

/** @param {MouseEvent} e mousedown on the sheet: only an entry takes the focus */
function keepFocus(e) {
	if (!e.target?.closest?.('button')) {
		e.preventDefault()
	}
}

/** @param {KeyboardEvent} e key while the sheet is open: Esc closes, Tab stays inside (and comes back in) */
function onKey(e) {
	if (e.key === 'Escape') {
		e.preventDefault()
		e.stopPropagation()
		emit('close')
		return
	}
	if (e.key !== 'Tab') {
		return
	}
	const list = entries()
	const i = list.indexOf(document.activeElement)
	if (i < 0) {
		e.preventDefault()
		list[0]?.focus()
	} else if (e.shiftKey && i === 0) {
		e.preventDefault()
		list.at(-1)?.focus()
	} else if (!e.shiftKey && i === list.length - 1) {
		e.preventDefault()
		list[0]?.focus()
	}
}

onMounted(async () => {
	document.addEventListener('keydown', onKey)
	await nextTick()
	entries()[0]?.focus()
})

onBeforeUnmount(() => {
	document.removeEventListener('keydown', onKey)
})
</script>
