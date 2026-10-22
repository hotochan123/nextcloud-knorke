<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="root"
		class="knorke-contextmenu"
		role="menu"
		:aria-label="name"
		data-knorke-menu="context"
		:data-knorke-menu-target="menu.id === null ? '' : menu.id"
		:data-knorke-menu-at="atAttr"
		:aria-describedby="count !== null ? 'knorke-contextmenu-count' : undefined"
		@keydown="onKey"
		@mousedown="onRootDown"
		@contextmenu.prevent>
		<button v-for="(e, i) in items"
			:key="e.name"
			:ref="(el) => setItem(el, i)"
			type="button"
			:role="e.checked === null ? 'menuitem' : 'menuitemcheckbox'"
			class="knorke-contextmenu__item"
			:tabindex="i === active ? 0 : -1"
			:aria-checked="e.checked === null ? undefined : String(e.checked)"
			:aria-keyshortcuts="e.aria"
			:aria-disabled="e.blocked ? 'true' : undefined"
			:title="e.title"
			:data-knorke-menu-item="e.name"
			@focus="active = i"
			@click="(ev) => activate(e.name, ev)">
			<span v-if="checkColumn"
				class="knorke-contextmenu__check"
				aria-hidden="true">
				<svg v-if="e.checked === true"
					viewBox="0 0 24 24"
					width="16"
					height="16"
					focusable="false">
					<path :d="checkPath" fill="currentColor" />
				</svg>
			</span>
			<span class="knorke-contextmenu__label">{{ e.label }}</span>
			<span v-if="e.hint"
				class="knorke-contextmenu__key"
				aria-hidden="true">{{ e.hint }}</span>
		</button>
		<div v-if="count !== null"
			id="knorke-contextmenu-count"
			class="knorke-contextmenu__count"
			aria-hidden="true"
			:data-knorke-menu-count="menu.items">{{ count }}</div>
	</div>
</template>

<script setup>
/*
 * Context menu of the canvas (SPEC-M1 §6.6 ContextMenu.vue, §6.8, §6.11,
 * §6.12; stage 4, R19 T4-02/T4-03), opened by the scene's intent
 * contextMenu (right click, macOS Ctrl+click, the context-menu key or
 * Shift+F10 with the canvas focus; mode edit only, never on touch).
 *
 * - Place: a sibling of .knorke-canvas in .knorke-board, never inside the
 *   scene container (the canvas's pointer and key logic must not see it).
 * - Position: top left corner at canvas rect + `at`; mirrored at an axis
 *   where it does not fit, then pushed into the viewport (cut down to the
 *   board, which clips) with an 8 px margin (menu.js placeMenu). Before it
 *   is measured, its max-height is set inline from the same bounds less the
 *   margin above and below (border box): in a very low window the whole menu
 *   still fits and scrolls; the CSS limit is the fallback.
 * - Entries: contextbar.js menuEntries(selection, id), the same source as
 *   the context bar; unavailable entries are missing. "Paste here" only
 *   where the browser lets a click read the clipboard (canPaste). (M2,
 *   R20) "Unlock" names the locker (contextbar.js unlockLabel); a long
 *   label stays on one line, cut with an ellipsis, the full text in its
 *   title. (M2, R20 Gruppieren) "Group items" and "Ungroup" stay when
 *   blocked (the user's wish, the one exception to "missing, never
 *   disabled"): aria-disabled="true" and the reason as title
 *   (contextbar.js menuBlocked); activating one (click, Enter) emits the
 *   action as usual, the session closes the menu and shows the toast
 *   group-blocked. (Job 044, job 062) "Unlock all" (last in the board
 *   menu), "Unlock all in this frame" (on a frame before "Zoom to
 *   selection"; in the board menu for the frame under the point, before
 *   "Unlock all") and "Unlock all locked by {name}" (on an item someone else
 *   locked, after "Unlock") only while menu.unlockAll / menu.unlockFrame /
 *   menu.unlockBy count something a moderator may unlock (the state when
 *   the session reported the menu): plain entries, no shortcut. Only
 *   "Unlock all locked by {name}" has a title, its full label
 *   (menu.unlockByName is someone's display name, a long one is cut like
 *   "Unlock (locked by …)").
 * - Grid (board menu only, M2, SPEC-M1 §1.2 (R12)): the entry "Show grid"
 *   (menu.grid, the state when the session reported the menu) and, only
 *   while the grid is shown, after it "Snap to grid" (menu.gridSnap; only
 *   the mass unlocks follow, job 062) are role=menuitemcheckbox with aria-checked
 *   "true"/"false"; their labels stay the same in both states and neither
 *   has a shortcut hint. While an entry of the menu has a state
 *   (checked ≠ null), every entry starts with the check column
 *   (aria-hidden, 16 × 16 px), so the labels line up; only the checked one
 *   holds the check mark (inline SVG in currentColor, icons.check). The
 *   menu on items has no such column.
 * - Count (board menu only): a line under the entries with the items of the
 *   local model when the menu was reported (contextbar.js menuCount, not
 *   live). It is no entry (no button, role or tabindex; menuKey never sees
 *   it) and aria-hidden, since role=menu may only own menu items; the root
 *   points at it with aria-describedby, so it is still read out. A press on
 *   it, or on the root itself beside the entries (in both menus: the 4 px
 *   padding, the gap above the line, the border), keeps the focus on the
 *   active entry (the root prevents that mousedown, onRootDown); otherwise
 *   the focus would fall to body and Esc and the arrows would no longer
 *   reach the open menu. Not on the root of a menu that can scroll
 *   (menu.js noScrollRange): its scrollbar behaves as before.
 * - Keyboard: WAI-ARIA APG "Menu" with a roving tabindex (menu.js menuKey):
 *   focus on the first entry when it opens, ↓/↑ wrap, Home/End, Enter/Space
 *   activate, Esc and Tab close; these keys never reach the scene
 *   (preventDefault + stopPropagation: its Esc would clear the selection).
 *   Shortcut hints are visible (aria-hidden) and in aria-keyshortcuts.
 * - Closing: Esc, Tab and a pointerdown outside (capture; the event goes on)
 *   emit close with the reason, the board then gives the canvas the focus;
 *   window blur and resize close it as well. Everything else that closes it
 *   (user camera, following, mode, frozen status, selection from another
 *   source, the target gone) is the session's (BoardSession.closeMenu).
 * - Focus on the way out (§6.6 R20, K6): when the menu goes away while the
 *   focus is still inside it, the focus goes to the canvas host without
 *   scrolling, never to body (returnFocus). After Esc, Tab, a click outside
 *   or an entry the focus has already left the menu (focusCanvas, or the
 *   editor of edit-text and note-here): it stays where it is.
 * - Hooks (§6.8): [data-knorke-menu=context] with data-knorke-menu-target
 *   (item id or "") and data-knorke-menu-at ("x,y", whole px), entries
 *   button[role=menuitem][data-knorke-menu-item=<name>] (the grid entries
 *   role=menuitemcheckbox; never data-knorke-action: delete and back are
 *   taken).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { menuBlocked, menuCount, menuEntries, menuLabel, menuName, menuShortcut } from './contextbar.js'
import { icons } from './icons.js'
import { intersect, menuKey, menuMaxHeight, noScrollRange, placeMenu } from './menu.js'

const props = defineProps({
	/** {id: string|null, at: [x, y] container px, seq, items, grid, gridSnap, unlockAll, unlockFrame, unlockBy, unlockByName} of BoardSession (ui.onContextMenu) */
	menu: { type: Object, required: true },
	/** selection v2 (BoardSession.selectionInfo) */
	selection: { type: Object, default: null },
	/** the canvas host (.knorke-canvas): `at` is relative to its rect */
	host: { type: Object, default: null },
	/** the browser lets a click read the clipboard (board/clipboard.js canReadClipboard) */
	canPaste: { type: Boolean, default: false },
	/** Apple platform: ⌘ hints and Meta+… (util/device.js isApplePlatform) */
	apple: { type: Boolean, default: false },
})

const emit = defineEmits(['action', 'close'])

const root = ref(null)
const active = ref(0)
const itemEls = []

const entries = computed(() => menuEntries(props.selection, props.menu.id ?? null, {
	canPaste: props.canPaste, items: props.menu.items, grid: props.menu.grid, gridSnap: props.menu.gridSnap,
	unlockAll: props.menu.unlockAll, unlockFrame: props.menu.unlockFrame,
	unlockBy: props.menu.unlockBy, unlockByName: props.menu.unlockByName,
}))
const items = computed(() => entries.value.map((name) => {
	// Ctrl/⌘+Shift+L locks while something can be locked: no hint at unlock then (M2, R20)
	const s = name === 'unlock' && (props.selection?.lockable ?? 0) > 0 ? null : menuShortcut(name, props.apple)
	// checked: the state of a check box entry (grid, grid-snap), null for every other entry
	const checked = name === 'grid' ? props.menu.grid === true : name === 'grid-snap' ? props.menu.gridSnap === true : null
	const label = menuLabel(name, props.selection, { unlockByName: props.menu.unlockByName })
	// a blocked group/ungroup (M2, R20): stays, aria-disabled, the reason as its title
	const blocked = menuBlocked(name, props.selection)
	// unlock and unlock-by name the locker (M2, R20; job 062): a long name is cut with an ellipsis, the full text is the title
	return {
		name, label, hint: s ? s.hint : '', aria: s ? s.aria : null, checked, blocked: blocked !== null,
		title: blocked ?? (name === 'unlock' || name === 'unlock-by' ? label : undefined),
	}
}))
/** an entry has a state: every entry gets the check column, so the labels line up */
const checkColumn = computed(() => items.value.some((e) => e.checked !== null))
const checkPath = icons.check
const name = computed(() => menuName(props.menu.id ?? null))
const count = computed(() => menuCount(props.menu.id ?? null, props.menu.items))
const atAttr = computed(() => Math.round(props.menu.at[0]) + ',' + Math.round(props.menu.at[1]))

/**
 * @param {HTMLElement|null} el entry button
 * @param {number} i its index
 */
function setItem(el, i) {
	itemEls[i] = el
}

/** @param {number} i entry to focus (roving tabindex) */
function focusItem(i) {
	active.value = i
	itemEls[i]?.focus?.({ preventScroll: true })
}

/**
 * Puts the menu at canvas rect + `at` (menu.js placeMenu), relative to its
 * offset parent. First its max-height (inline, border box) is set from the
 * bounds (viewport ∩ board, less the margin above and below; '' when they
 * are no finite numbers: the CSS limit applies), only then is it measured,
 * so a menu taller than the bounds shrinks to them and scrolls. No :style
 * binding on the root: Vue would overwrite the value.
 */
function place() {
	const el = root.value
	if (!el || typeof window === 'undefined') {
		return
	}
	const vw = document.documentElement?.clientWidth || window.innerWidth
	const vh = document.documentElement?.clientHeight || window.innerHeight
	const viewport = { left: 0, top: 0, right: vw, bottom: vh }
	const parent = el.offsetParent ?? el.parentElement
	const pr = parent?.getBoundingClientRect?.() ?? viewport
	const canvas = props.host?.getBoundingClientRect?.() ?? pr
	const bounds = intersect(viewport, pr)
	const maxH = menuMaxHeight(bounds)
	el.style.maxHeight = maxH === null ? '' : maxH + 'px'
	const p = placeMenu({
		canvas,
		at: props.menu.at,
		size: { width: el.offsetWidth, height: el.offsetHeight },
		bounds,
	})
	el.style.left = Math.round(p.x - pr.left) + 'px'
	el.style.top = Math.round(p.y - pr.top) + 'px'
}

/** Opened or moved by a new intent: place it, focus the first entry. */
function show() {
	place()
	focusItem(0)
}

/**
 * @param {string} entry entry name
 * @param {Event} [ev] activating event
 */
function activate(entry, ev) {
	emit('action', entry, ev ?? null)
}

/** @param {KeyboardEvent} e keydown inside the menu */
function onKey(e) {
	const r = menuKey(e, active.value, items.value.length)
	if (!r.handled) {
		return
	}
	e.preventDefault()
	e.stopPropagation()
	if (r.close) {
		emit('close', r.close)
	} else if (r.activate) {
		const it = items.value[r.index]
		if (it) {
			activate(it.name, e)
		}
	} else if (r.index !== undefined) {
		focusItem(r.index)
	}
}

const onDown = (e) => {
	if (root.value && e?.target && !root.value.contains(e.target)) {
		emit('close', 'outside')
	}
}

/**
 * A mousedown beside the entries would move the focus to body (neither the
 * root nor the count line is focusable): keep it on the active entry by
 * preventing the default action
 * (a) on the count line or inside it,
 * (b) on the root itself (its padding, the gap above the count line, its
 *     border), but only while the menu has nothing to scroll (menu.js
 *     noScrollRange): a prevented mousedown on a scrollbar can stop its
 *     thumb from being dragged, and an overlay scrollbar lies over the
 *     padding, so the root of a menu that can scroll behaves as before.
 * Entries and their children behave as before. Any button; never
 * stopPropagation. mousedown, not pointerdown: only its default action
 * moves the focus (also a pen's compatibility event).
 *
 * @param {MouseEvent} e mousedown inside the menu
 */
function onRootDown(e) {
	const t = e?.target
	if (!t) {
		return
	}
	const el = root.value
	if (t.closest?.('[data-knorke-menu-count]') || (el && t === el && noScrollRange(el))) {
		e.preventDefault()
	}
}
const onBlur = () => emit('close', 'blur')
const onResize = () => emit('close', 'resize')

/**
 * The menu goes away (before its entries leave the DOM): a focus still
 * inside it goes to the canvas host without scrolling, so single keys keep
 * working and the focus never falls back to body (§6.6 R20, K6). A focus
 * outside the menu stays where it is.
 *
 * @return {boolean} the host got the focus
 */
function returnFocus() {
	const el = root.value
	const a = typeof document === 'undefined' ? null : document.activeElement
	if (!el || !a || !el.contains(a) || typeof props.host?.focus !== 'function') {
		return false
	}
	try {
		props.host.focus({ preventScroll: true })
	} catch (e) {
		// focus can fail in a detached document
		return false
	}
	return true
}

// a new intent moves the open menu to the new place (§6.6)
watch(() => props.menu.seq, () => nextTick(show))

onMounted(() => {
	document.addEventListener('pointerdown', onDown, true)
	window.addEventListener('blur', onBlur)
	window.addEventListener('resize', onResize)
	show()
})

onBeforeUnmount(() => {
	returnFocus()
	document.removeEventListener('pointerdown', onDown, true)
	window.removeEventListener('blur', onBlur)
	window.removeEventListener('resize', onResize)
})
</script>
