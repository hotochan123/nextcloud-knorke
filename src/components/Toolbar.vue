<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<nav ref="navEl"
		class="knorke-toolbar"
		data-knorke-toolbar
		data-knorke-chrome
		:aria-label="t('knorke', 'Tools')"
		@scroll.passive="closePop()">
		<template v-for="(group, gi) in TOOL_GROUPS" :key="gi">
			<div v-if="gi > 0" class="knorke-toolbar__sep" role="separator" />
			<NcButton v-for="id in group"
				:key="id"
				variant="tertiary"
				class="knorke-toolbar__button"
				:class="{ 'knorke-toolbar__button--active': highlighted(id), 'knorke-toolbar__button--variants': hasVariants(id) }"
				:pressed="pressed(id)"
				:aria-label="labelOf(id)"
				:title="titleOf(id)"
				:aria-haspopup="popupOf(id)"
				:aria-expanded="expandedOf(id)"
				:aria-controls="controlsOf(id)"
				:data-knorke-tool="id"
				:data-knorke-tool-picked="id === 'more' && picked ? picked : null"
				@click="(e) => onClick(id, e)"
				@pointerdown="(e) => onDown(id, e)"
				@contextmenu="(e) => onContext(id, e)">
				<template #icon>
					<NcIconSvgWrapper :path="iconOf(id)" />
				</template>
			</NcButton>
		</template>
		<template v-if="ai">
			<div class="knorke-toolbar__sep" role="separator" />
			<NcButton variant="tertiary"
				class="knorke-toolbar__button"
				:aria-label="t('knorke', 'Create with AI')"
				:title="t('knorke', 'Create with AI')"
				aria-haspopup="dialog"
				:disabled="aiBusy"
				data-knorke-tool="ai"
				@click="(e) => { closePop(); emit('ai', e) }">
				<template #icon>
					<span class="knorke-toolbar__ai knorke-ai-mark">
						<NcIconSvgWrapper :path="icons.sparkle" />
						<span class="knorke-toolbar__ailabel" aria-hidden="true">{{ t('knorke', 'AI') }}</span>
					</span>
				</template>
			</NcButton>
		</template>
	</nav>
	<ToolVariants v-if="pop && pop.kind === 'variants'"
		:id="popId"
		ref="popEl"
		:tool="pop.tool"
		:value="options[pop.tool] || {}"
		:style="popStyle"
		@pick="pickVariant" />
	<section v-else-if="pop && pop.kind === 'more'"
		:id="popId"
		ref="popEl"
		class="knorke-toolpop knorke-moretools"
		role="dialog"
		:aria-label="t('knorke', 'More tools')"
		:style="popStyle"
		data-knorke-more-tools>
		<div class="knorke-toolpop__tiles">
			<button v-for="id in MORE_TOOLS"
				:key="id"
				type="button"
				class="knorke-toolpop__tile"
				:aria-pressed="active === id ? 'true' : 'false'"
				:title="withShortcut(toolLabel(id), id, apple)"
				:data-knorke-tool="id"
				@click="(e) => pickMore(id, e)">
				<NcIconSvgWrapper :path="TOOL_ICONS[id]" :size="28" />
				<span class="knorke-toolpop__label">{{ toolLabel(id) }}</span>
				<span class="knorke-toolpop__key" aria-hidden="true">{{ keyOf(id) }}</span>
			</button>
		</div>
	</section>
</template>

<script setup>
/*
 * Tool bar (SPEC-M0 §6.6, §6.8; v2 SPEC-M1 §6.6; factory job 229, redesign
 * docs/redesign/ P1, P5, P5b): eight buttons in two groups (components/
 * toolbar.js TOOL_GROUPS), [data-knorke-toolbar], every tool button
 * [data-knorke-tool=<id>] with aria-pressed (NcButton :pressed) for the
 * active one. It stands at the top left, under the left island of the top
 * bar (knorke.css), and is absent in view-only mode.
 *
 * - A tool with variants (toolbar.js VARIANTS: note, connector, frame) has a
 *   corner (class knorke-toolbar__button--variants, aria-haspopup dialog).
 *   (Job 239) A click chooses the tool (with the click, so a pointer click
 *   gives the canvas the focus) and opens ToolVariants beside the button
 *   ([data-knorke-tool-variants]); a click while they are open closes them,
 *   the tool stays. A click that chooses no tool emits refocus(e) (the view
 *   gives the canvas the focus after a pointer click, so the keys go on). A right-click (contextmenu: also Shift+F10, and Android's
 *   long press) or a press held LONG_PRESS_MS without moving
 *   LONG_PRESS_SLOP_PX opens them as well and chooses the tool; the click a
 *   long press leaves is dropped (SKIP_CLICK_MS). The keys N, L and F choose
 *   the tool without them. A click on the board closes them (a pointerdown
 *   outside) and the scene creates at once. A tile emits options(tool, {option: value}) (the
 *   session activates the tool with it); the note's and the frame's popover
 *   closes then, the connector's (two choices) stays. The button shows the
 *   picked variant's picture (toolbar.js toolIcon).
 * - "More tools" ([data-knorke-tool=more]) opens a small grid
 *   [data-knorke-more-tools] with table, mind map and laser pointer
 *   ([data-knorke-tool=<id>], their keys); a tile chooses the tool and closes
 *   the grid. While one of them is active the button shows its icon, is
 *   pressed and carries data-knorke-tool-picked=<id>.
 * - The shape tool opens and closes the shapes panel (emit shapes; the view
 *   decides, BoardView.vue): aria-expanded and aria-controls = shapesId; it
 *   is highlighted while the panel is open or the tool is active.
 * A popover closes on Esc (the focus goes back to its button when it was
 * inside it, job 239), a pointerdown
 * outside it and its button, scrolling the bar and another tool (a pointer
 * pick of a connector variant gives the canvas the focus and leaves it open). Opened from the keyboard, the focus goes to its pressed tile.
 * The popovers are siblings of the bar (it scrolls, they would be clipped),
 * placed beside it in the board's coordinates, top-aligned with the button.
 *
 * Every emit carries the DOM event, so the view can give the focus back to
 * the canvas after a pointer click (SPEC-M1 §6.5.1, components/focus.js).
 * Job 141: the titles name the key through the one formatter
 * (util/shortcuts.js withShortcut), as ⌘ symbols on Apple (prop apple).
 * Undo and redo have their own island (UndoBar.vue, job 229).
 * Job 268: with prop ai a last group holds "Create with AI"
 * ([data-knorke-tool=ai], the sparkle; disabled while aiBusy), emit ai(e):
 * the view opens the window (AiDiagramDialog.vue); it is no tool.
 * Job 277: the sparkle with the small label "AI" below it, both in the AI
 * violet --k-ai; the label is aria-hidden, the button keeps its name.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { TOOLS } from '../model/tools.js'
import { t } from '../util/l10n.js'
import { withShortcut } from '../util/shortcuts.js'
import { isPointerActivation } from './focus.js'
import { icons } from './icons.js'
import { toolLabel } from './labels.js'
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, MORE_TOOLS, TOOL_GROUPS, TOOL_ICONS, hasVariants, isMoreTool, toolIcon } from './toolbar.js'
import ToolVariants from './ToolVariants.vue'

const props = defineProps({
	active: { type: String, default: 'select' },
	options: { type: Object, default: () => ({}) },
	/** Apple platform: ⌘ hints (util/device.js isApplePlatform) */
	apple: { type: Boolean, default: false },
	/** (job 201) the shapes panel is open */
	shapesOpen: { type: Boolean, default: false },
	/** (job 201) id of the shapes panel */
	shapesId: { type: String, default: 'knorke-shapes' },
	/** (job 268) AI is available here: the button "Create with AI" */
	ai: { type: Boolean, default: false },
	/** (job 268) an AI task of this tab runs: the button is disabled */
	aiBusy: { type: Boolean, default: false },
})

const emit = defineEmits(['tool', 'options', 'shapes', 'refocus', 'ai'])

/** A click this soon after a long press belongs to it. */
const SKIP_CLICK_MS = 1500
/** Space between the bar and a popover (--knorke-gap). */
const POP_GAP = 8

const navEl = ref(null)
const popEl = ref(null)
/** The open popover {kind: 'variants'|'more', tool}, null without one. */
const pop = ref(null)
/** Where the popover stands (board px, inline style). */
const popStyle = ref(null)
const popId = 'knorke-toolpop-' + Math.random().toString(36).slice(2, 8)

/** The tool of "More tools" that is active, else null. */
const picked = computed(() => (isMoreTool(props.active) ? props.active : null))

/**
 * @param {string} id tool id or 'more'
 * @return {string} the key of the tool (upper case), '' without one
 */
function keyOf(id) {
	return (TOOLS.find((x) => x.id === id)?.key ?? '').toUpperCase()
}

/**
 * @param {string} id tool id or 'more'
 * @return {string} the button's name
 */
function labelOf(id) {
	if (id === 'more') {
		return picked.value ? t('knorke', 'More tools: {tool}', { tool: toolLabel(picked.value) }) : t('knorke', 'More tools')
	}
	return toolLabel(id)
}

/**
 * @param {string} id tool id or 'more'
 * @return {string} the button's title, with its key
 */
function titleOf(id) {
	return id === 'more' ? labelOf(id) : withShortcut(toolLabel(id), id, props.apple)
}

/**
 * @param {string} id tool id or 'more'
 * @return {string} SVG path
 */
function iconOf(id) {
	if (id === 'more') {
		return picked.value ? TOOL_ICONS[picked.value] : TOOL_ICONS.more
	}
	return toolIcon(id, props.options)
}

/**
 * @param {string} id tool id or 'more'
 * @return {boolean} aria-pressed
 */
function pressed(id) {
	return id === 'more' ? picked.value !== null : props.active === id
}

/**
 * @param {string} id tool id or 'more'
 * @return {boolean} drawn as active (job 244: also while its popover is open)
 */
function highlighted(id) {
	return pressed(id) || (id === 'shape' && props.shapesOpen) || openFor(id)
}

/**
 * @param {string} id tool id or 'more'
 * @return {string|null} aria-haspopup
 */
function popupOf(id) {
	return hasVariants(id) || id === 'more' || id === 'shape' ? 'dialog' : null
}

/**
 * @param {string} id tool id or 'more'
 * @return {string|null} aria-expanded
 */
function expandedOf(id) {
	if (id === 'shape') {
		return props.shapesOpen ? 'true' : 'false'
	}
	if (hasVariants(id) || id === 'more') {
		return openFor(id) ? 'true' : 'false'
	}
	return null
}

/**
 * @param {string} id tool id or 'more'
 * @return {string|null} aria-controls
 */
function controlsOf(id) {
	if (id === 'shape') {
		return props.shapesId
	}
	return openFor(id) ? popId : null
}

/**
 * @param {string} id tool id or 'more'
 * @return {boolean} the popover of this button is open
 */
function openFor(id) {
	return pop.value !== null && pop.value.tool === id
}

/** The press on a tool button that may become a long press: {id, pid, x0, y0, timer}. */
let press = null
/** The click a long press leaves behind: {id, at}, dropped once. */
let skipClick = null

/**
 * @param {string} id tool id or 'more'
 * @return {boolean} this click belongs to a long press (and is used up)
 */
function skipped(id) {
	const s = skipClick
	skipClick = null
	return s !== null && s.id === id && Date.now() - s.at < SKIP_CLICK_MS
}

/**
 * @param {string} id tool id or 'more'
 * @param {MouseEvent} e click
 */
function onClick(id, e) {
	if (skipped(id)) {
		return
	}
	if (id === 'more') {
		if (openFor('more')) {
			closePop()
		} else {
			openPop('more', 'more', e)
		}
		return
	}
	// (job 239) a tool with variants: a click chooses it and opens them, a click while they are open closes them;
	// a pointer click that only opens or closes them gives the canvas the focus as well (refocus)
	if (hasVariants(id)) {
		if (openFor(id)) {
			closePop()
			emit('refocus', e)
			return
		}
		if (props.active !== id) {
			emit('tool', id, e)
		} else {
			emit('refocus', e)
		}
		openPop('variants', id, e)
		return
	}
	closePop()
	if (id === 'shape') {
		emit('shapes', e)
		return
	}
	emit('tool', id, e)
}

/**
 * @param {string} id tool id or 'more'
 * @param {PointerEvent} e pointerdown on its button
 */
function onDown(id, e) {
	endPress()
	// a new press: a click left by an earlier one (a long press without a click after it) is gone
	skipClick = null
	if (!hasVariants(id) || e.button !== 0 || !e.isPrimary) {
		return
	}
	press = { id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, timer: setTimeout(() => longPress(id), LONG_PRESS_MS) }
	window.addEventListener('pointermove', onPressMove, true)
	window.addEventListener('pointerup', endPress, true)
	window.addEventListener('pointercancel', endPress, true)
}

/** @param {PointerEvent} e pointermove during a press */
function onPressMove(e) {
	if (press && e.pointerId === press.pid && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > LONG_PRESS_SLOP_PX) {
		endPress()
	}
}

/** Ends a press without a long press. */
function endPress() {
	if (press) {
		clearTimeout(press.timer)
	}
	press = null
	window.removeEventListener('pointermove', onPressMove, true)
	window.removeEventListener('pointerup', endPress, true)
	window.removeEventListener('pointercancel', endPress, true)
}

/**
 * A press held long enough: the tool and its variants; the click it leaves is dropped.
 *
 * @param {string} id tool id
 */
function longPress(id) {
	endPress()
	skipClick = { id, at: Date.now() }
	showVariants(id, null)
}

/**
 * Right-click, Shift+F10, Android's long press: the variants (never the browser's menu).
 *
 * @param {string} id tool id or 'more'
 * @param {MouseEvent} e contextmenu
 */
function onContext(id, e) {
	if (!hasVariants(id)) {
		return
	}
	e.preventDefault()
	// a long press opened them already (a touch screen sends both)
	if (openFor(id)) {
		return
	}
	endPress()
	// a finger's or pen's long press leaves a click behind, a mouse's right-click none
	skipClick = e.pointerType === 'touch' || e.pointerType === 'pen' ? { id, at: Date.now() } : null
	showVariants(id, e)
}

/**
 * Chooses the tool (if needed) and opens its variants.
 *
 * @param {string} id tool id
 * @param {Event|null} e the event (null: a long press)
 */
function showVariants(id, e) {
	if (props.active !== id) {
		emit('tool', id, null)
	}
	openPop('variants', id, e)
}

/**
 * @param {'variants'|'more'} kind which popover
 * @param {string} tool its button
 * @param {Event|null} e the opening event (from the keyboard the focus moves into it)
 */
async function openPop(kind, tool, e) {
	pop.value = { kind, tool }
	popStyle.value = placeOf(tool)
	listen(true)
	await nextTick()
	if (pop.value?.tool !== tool) {
		return
	}
	popStyle.value = placeOf(tool)
	if (e && !isPointerActivation(e)) {
		const el = popEl.value?.$el ?? popEl.value
		const first = el?.querySelector?.('[aria-pressed="true"]') ?? el?.querySelector?.('button')
		first?.focus?.()
	}
}

/**
 * Beside the bar (inline end), top-aligned with the button, kept inside the board.
 *
 * @param {string} tool the button's tool
 * @return {object|null} inline style
 */
function placeOf(tool) {
	const nav = navEl.value
	const btn = nav?.querySelector?.(`[data-knorke-tool="${tool}"]`)
	const b = btn?.getBoundingClientRect?.()
	const r = nav?.offsetParent?.getBoundingClientRect?.()
	if (!b || !r) {
		return null
	}
	const n = nav.getBoundingClientRect()
	const rtl = getComputedStyle(nav).direction === 'rtl'
	const el = popEl.value?.$el ?? popEl.value
	const h = el?.offsetHeight ?? 0
	const top = Math.max(POP_GAP, Math.min(b.top - r.top, r.height - h - POP_GAP))
	const start = (rtl ? r.right - n.left : n.right - r.left) + POP_GAP
	return { top: Math.round(top) + 'px', insetInlineStart: Math.round(start) + 'px' }
}

/**
 * @param {boolean} [refocus] the focus back to the popover's button
 */
function closePop(refocus = false) {
	const was = pop.value
	if (!was) {
		return
	}
	pop.value = null
	listen(false)
	if (refocus) {
		navEl.value?.querySelector?.(`[data-knorke-tool="${was.tool}"]`)?.focus?.()
	}
}

/**
 * @param {string} option option name
 * @param {string} value its value
 * @param {MouseEvent} e click on the tile
 */
function pickVariant(option, value, e) {
	const tool = pop.value?.tool
	if (!tool) {
		return
	}
	emit('options', tool, { [option]: value }, e)
	// (job 273) the pen tool's popover stays open too: kind, width and colour one after the other
	if (tool !== 'connector' && tool !== 'pen') {
		closePop(!isPointerActivation(e))
	}
}

/**
 * @param {string} id table, mindmap or laser
 * @param {MouseEvent} e click on the tile
 */
function pickMore(id, e) {
	closePop(!isPointerActivation(e))
	emit('tool', id, e)
}

/** @param {PointerEvent} e pointerdown anywhere: outside the popover and its button it closes */
function onDocDown(e) {
	if (!pop.value) {
		return
	}
	const el = popEl.value?.$el ?? popEl.value
	const target = e.target
	if (el?.contains?.(target) || target?.closest?.(`[data-knorke-tool="${pop.value.tool}"]`)) {
		return
	}
	closePop()
}

/**
 * Esc closes the popover before the canvas sees it. (Job 239) The focus goes back to its button only from
 * inside it; after a pointer click the canvas keeps it, so the keys go on working.
 *
 * @param {KeyboardEvent} e keydown anywhere while a popover is open
 */
function onDocKey(e) {
	if (pop.value && e.key === 'Escape') {
		e.stopPropagation()
		e.preventDefault()
		const el = popEl.value?.$el ?? popEl.value
		closePop(el?.contains?.(document.activeElement) === true)
	}
}

/** @param {boolean} on listen for pointerdowns outside and for Esc */
function listen(on) {
	if (typeof document === 'undefined') {
		return
	}
	document.removeEventListener('pointerdown', onDocDown, true)
	document.removeEventListener('keydown', onDocKey, true)
	if (on) {
		document.addEventListener('pointerdown', onDocDown, true)
		document.addEventListener('keydown', onDocKey, true)
	}
}

// another tool (a key, the scene's switch back to select): the variants of the old one go
watch(() => props.active, (now) => {
	if (pop.value?.kind === 'variants' && pop.value.tool !== now) {
		closePop()
	}
})

onBeforeUnmount(() => {
	endPress()
	listen(false)
})
</script>
