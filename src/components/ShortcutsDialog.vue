<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="t('knorke', 'Keyboard shortcuts')"
		size="normal"
		class="knorke-dialog knorke-shortcuts"
		data-knorke-dialog="shortcuts"
		:set-return-focus="false"
		@update:open="(o) => !o && $emit('close')">
		<div class="knorke-shortcuts__body">
			<section v-for="g in groups"
				:key="g.id"
				class="knorke-shortcuts__group"
				:data-knorke-shortcuts-group="g.id">
				<h3 class="knorke-shortcuts__heading">
					{{ g.title }}
				</h3>
				<dl class="knorke-shortcuts__list">
					<div v-for="(r, i) in g.rows"
						:key="i"
						class="knorke-shortcuts__row">
						<dt class="knorke-shortcuts__label">
							{{ r.label }}
						</dt>
						<dd v-if="r.keys.length > 0" class="knorke-shortcuts__keys">
							<template v-for="(k, j) in r.keys" :key="k.name">
								<span v-if="j > 0" class="knorke-shortcuts__or"> / </span>
								<kbd class="knorke-shortcuts__key">{{ k.hint }}</kbd>
							</template>
						</dd>
					</div>
				</dl>
			</section>
		</div>
	</NcDialog>
</template>

<script setup>
/*
 * The shortcuts overview (factory job 145): every key of the board in
 * groups (components/shortcutList.js shortcutGroups), the keys as <kbd> with
 * the formatter's hint of this platform, only the ones of the current mode
 * (prop mode, live: the board passes 'view' while frozen); the finger
 * gestures first on a device with a touch screen (prop touch, read when it
 * opened).
 *
 * Esc and (job 161) a new ? close only this dialog: a capturing keydown
 * listener on the window takes them before anything else sees them (no
 * selection is cleared, no follow ends, the scene's keys never see them, so
 * ? does not open it again), wherever the focus is, also before NcModal's
 * focus trap has moved the focus in; a key inside another dialog on top
 * stays with that one. ? as when opening: Shift allowed, not with Ctrl/⌘ or
 * Alt, never a repeat (holding ? opens once, nothing flickers).
 *
 * A click beside the box (job 161): a press of the main button, a finger or
 * a pen on the dimmed backdrop (inside NcModal's mask, outside
 * .modal-container) whose release and click are there too closes it. The
 * close waits for the click, the last event of the gesture (a tap's mouse
 * events come before it), so nothing of it falls through to what lay under
 * the mask ("?" button, tool bar, canvas); capturing listeners on the window
 * stop every pointer, mouse and click event on the backdrop, so no listener
 * of the board sees them either. NcModal's close-on-click-outside closes on
 * mousedown and is not used. A phone (≤ 512 px) has no backdrop.
 *
 * The focus trap gives the focus back nowhere (set-return-focus false): the
 * board decides (canvas or the "?" button).
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { t } from '../util/l10n.js'
import { shortcutGroups } from './shortcutList.js'

const props = defineProps({
	/** client mode: 'edit' | 'vote' | 'view' */
	mode: { type: String, default: 'edit' },
	/** Apple platform (⌘ hints) */
	apple: { type: Boolean, default: false },
	/** touch screen: the finger gestures first */
	touch: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const groups = computed(() => shortcutGroups({ mode: props.mode, apple: props.apple, touch: props.touch }))

/** NcModal's mask (it carries this attribute, the whole viewport) and its box. */
const MASK = '[data-knorke-dialog="shortcuts"]'
const BOX = '.modal-container'
/** The events of a click that the backdrop keeps from everyone else. */
const GESTURE = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']

/**
 * Esc or a new ? anywhere but in another dialog closes this one, before
 * every other listener (window, capture).
 *
 * @param {KeyboardEvent} e keydown
 * @return {boolean} it closed the dialog
 */
function onKey(e) {
	if (!e || e.isComposing) {
		return false
	}
	if (e.key === '?') {
		if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
			return false
		}
	} else if (e.key !== 'Escape') {
		return false
	}
	const other = e.target?.closest?.('[role="dialog"], [aria-modal="true"]')
	if (other && !other.closest(MASK)) {
		return false
	}
	e.preventDefault()
	e.stopPropagation()
	emit('close')
	return true
}

/**
 * @param {EventTarget|null|undefined} el event target
 * @return {boolean} el is this dialog's backdrop: in its mask, outside the box
 */
function onBackdrop(el) {
	return !!el?.closest?.(MASK) && !el.closest(BOX)
}

/**
 * The element under a pointerup: a finger or a pen keeps its pointerdown
 * target (implicit capture), so it is looked up at the point.
 *
 * @param {PointerEvent} e pointerup
 * @return {EventTarget|null} element
 */
function releasedOn(e) {
	if (e.pointerType === 'mouse') {
		return e.target
	}
	return globalThis.document?.elementFromPoint?.(e.clientX, e.clientY) ?? e.target
}

/** The press that started on the backdrop: {id: pointerId, up: released there}, else null. */
let press = null

/**
 * One event of a click (GESTURE, window, capture): pointerdown and pointerup
 * follow the press, the click closes; every one of them on the backdrop
 * stops there.
 *
 * @param {PointerEvent|MouseEvent} e event
 * @return {boolean} it closed the dialog
 */
function onPointer(e) {
	const mine = onBackdrop(e.target)
	if (e.type === 'pointerdown') {
		// the main button, one finger or a pen; another pointer ends the press
		press = mine && e.button === 0 && e.isPrimary !== false ? { id: e.pointerId, up: false } : null
	} else if (e.type === 'pointerup' && press !== null && e.pointerId === press.id) {
		press.up = onBackdrop(releasedOn(e))
	}
	if (!mine) {
		return false
	}
	e.stopPropagation()
	if (e.type !== 'click') {
		return false
	}
	const done = press !== null && press.up && e.button === 0
	press = null
	if (!done) {
		return false
	}
	e.preventDefault()
	emit('close')
	return true
}

onMounted(() => {
	window.addEventListener('keydown', onKey, true)
	for (const type of GESTURE) {
		window.addEventListener(type, onPointer, true)
	}
})

onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey, true)
	for (const type of GESTURE) {
		window.removeEventListener(type, onPointer, true)
	}
})
</script>
