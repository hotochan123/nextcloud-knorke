<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="rootEl"
		class="knorke-present"
		data-knorke-presentation
		:data-knorke-role="state.role">
		<div class="knorke-present__catch"
			data-knorke-present-catch
			@pointerdown="onDown"
			@pointerup="onUp"
			@pointercancel="down = null"
			@wheel.prevent
			@contextmenu.prevent />
		<div v-if="rect"
			class="knorke-present__hole"
			:style="holeStyle"
			aria-hidden="true" />
		<div v-else class="knorke-present__cover" aria-hidden="true" />
		<div ref="barEl"
			class="knorke-present__bar"
			role="toolbar"
			data-knorke-present-bar
			:aria-label="t('knorke', 'Presentation')">
			<template v-if="presenter">
				<button ref="prevEl"
					type="button"
					class="knorke-present__btn"
					data-knorke-action="slide-prev"
					:disabled="state.index <= 0"
					:aria-label="t('knorke', 'Previous slide')"
					:title="t('knorke', 'Previous slide')"
					@click="$emit('step', -1)">
					<NcIconSvgWrapper :path="icons.chevronLeft" />
				</button>
				<span class="knorke-present__count" data-knorke-slide-count>{{ count }}</span>
				<button ref="nextEl"
					type="button"
					class="knorke-present__btn"
					data-knorke-action="slide-next"
					:disabled="state.index >= state.list.length - 1"
					:aria-label="t('knorke', 'Next slide')"
					:title="t('knorke', 'Next slide')"
					@click="$emit('step', 1)">
					<NcIconSvgWrapper :path="icons.chevronRight" />
				</button>
				<button type="button"
					class="knorke-present__btn knorke-present__btn--text"
					data-knorke-action="slides-panel"
					:aria-expanded="panelOpen ? 'true' : 'false'"
					@click="panelOpen = !panelOpen">
					{{ t('knorke', 'Slides') }}
				</button>
				<button type="button"
					class="knorke-present__btn knorke-present__btn--text"
					data-knorke-action="slides-end"
					@click="$emit('end')">
					{{ t('knorke', 'End') }}
				</button>
			</template>
			<template v-else>
				<span class="knorke-present__text" data-knorke-slide-count>
					{{ t('knorke', '{name} is presenting · {n} / {total}', { name: state.name || t('knorke', 'Someone'), n: state.index + 1, total: state.list.length }) }}
				</span>
				<button type="button"
					class="knorke-present__btn knorke-present__btn--text"
					data-knorke-action="look-around"
					@click="$emit('look-around')">
					{{ t('knorke', 'Look around myself') }}
				</button>
			</template>
		</div>
		<nav v-if="presenter && panelOpen"
			ref="panelEl"
			class="knorke-present__panel"
			data-knorke-slides
			:style="{ top: panelTop + 'px', bottom: barCover + 'px' }"
			:aria-label="t('knorke', 'Slides')">
			<div class="knorke-present__head">
				<span class="knorke-present__heading">{{ t('knorke', 'Slides') }}</span>
				<button type="button"
					class="knorke-present__btn"
					data-knorke-action="slides-close"
					:aria-label="t('knorke', 'Close')"
					:title="t('knorke', 'Close')"
					@click="panelOpen = false">
					<NcIconSvgWrapper :path="icons.close" />
				</button>
			</div>
			<ol class="knorke-present__list">
				<li v-for="(s, i) in state.list"
					:key="s.id"
					class="knorke-present__row"
					:class="{ 'knorke-present__row--current': s.id === state.current, 'knorke-present__row--target': drag !== null && drag.to === i && drag.from !== i }"
					:data-knorke-slide="s.id">
					<button type="button"
						class="knorke-present__grip"
						data-knorke-slide-grip
						:aria-label="t('knorke', 'Move slide {n}: drag, or Alt+arrow keys', { n: i + 1 })"
						:title="t('knorke', 'Drag to change the order')"
						@pointerdown="dragStart($event, s.id, i)"
						@pointermove="dragMove"
						@pointerup="dragEnd"
						@pointercancel="drag = null"
						@keydown="gripKey($event, s.id, i)">
						⠿
					</button>
					<button type="button"
						class="knorke-present__slide"
						:aria-current="s.id === state.current ? 'step' : undefined"
						@click="pick(s.id)">
						<span class="knorke-present__num">{{ i + 1 }}</span>
						<span class="knorke-present__title">{{ s.title }}</span>
					</button>
				</li>
			</ol>
		</nav>
	</div>
</template>

<script setup>
/*
 * Frames as slides (factory job 272): the presentation over the board, for
 * the presenting tab (role 'presenter') and for everyone who follows it
 * (role 'viewer'). A dark cover leaves only the shown frame open (rect: its
 * screen box, following the camera); a catcher above the board takes every
 * pointer, so nothing on the board can be changed meanwhile. The presenter
 * moves on with the arrow keys, PageUp/PageDown, Space, Home/End, a
 * sideways swipe (finger or pen) or the buttons; Esc ends. The slide list
 * (open from 900 px width) jumps to a slide and changes the order by
 * dragging the grip (mouse, finger, pen) or Alt+↑/↓ on it. A viewer leaves
 * with "Look around myself" or Esc. Board shortcuts do not run meanwhile.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'
import { panelOverlays, swipeDir } from '../board/slides.js'

/** From this window width the slide list starts open. */
const PANEL_OPEN_PX = 900

const props = defineProps({
	/** {role, list: [{id, title}], current, index, name} */
	state: { type: Object, required: true },
	/** the shown frame's screen box {x, y, w, h} or null */
	rect: { type: Object, default: null },
})

const emit = defineEmits(['step', 'to', 'move', 'end', 'look-around', 'insets'])

const presenter = computed(() => props.state.role === 'presenter')
const panelOpen = ref(typeof window !== 'undefined' && window.innerWidth >= PANEL_OPEN_PX)
const rootEl = ref(null)
const panelEl = ref(null)
const nextEl = ref(null)
const barEl = ref(null)
/** px from the board's bottom to the top of the bar plus a gap: the list ends there */
const barCover = ref(0)
/** the list lies over the slide (narrow screen) */
const overlay = ref(false)
/** px from the board's top where the list starts: below the notices (connection, device) */
const panelTop = ref(12)
let bannerWatch = null
/** pointer down on the catcher {x, y, id} */
const down = ref(null)
/** a grip drag {id, from, to, y0, rowH, pointer} */
const drag = ref(null)

const count = computed(() => `${props.state.index + 1} / ${props.state.list.length}`)
const holeStyle = computed(() => {
	const r = props.rect
	return { left: r.x + 'px', top: r.y + 'px', width: Math.max(0, r.w) + 'px', height: Math.max(0, r.h) + 'px' }
})

function onDown(e) {
	down.value = { x: e.clientX, y: e.clientY, id: e.pointerId }
}

function onUp(e) {
	const d = down.value
	down.value = null
	if (!d || d.id !== e.pointerId || !presenter.value) {
		return
	}
	const dir = swipeDir(e.clientX - d.x, e.clientY - d.y)
	if (dir !== 0) {
		emit('step', dir)
	}
}

/** @param {string} id slide: jump there; a list over the slide closes */
function pick(id) {
	emit('to', id)
	if (overlay.value) {
		panelOpen.value = false
	}
}

function dragStart(e, id, i) {
	const row = e.currentTarget?.closest?.('li')
	drag.value = { id, from: i, to: i, y0: e.clientY, rowH: row?.offsetHeight || 44, pointer: e.pointerId }
	e.currentTarget?.setPointerCapture?.(e.pointerId)
	e.preventDefault()
}

function dragMove(e) {
	const d = drag.value
	if (!d || d.pointer !== e.pointerId) {
		return
	}
	const to = d.from + Math.round((e.clientY - d.y0) / d.rowH)
	d.to = Math.max(0, Math.min(props.state.list.length - 1, to))
}

function dragEnd(e) {
	const d = drag.value
	drag.value = null
	if (d && d.pointer === e.pointerId && d.to !== d.from) {
		emit('move', d.id, d.to)
	}
}

function gripKey(e, id, i) {
	if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) {
		return
	}
	e.preventDefault()
	e.stopPropagation()
	const to = i + (e.key === 'ArrowUp' ? -1 : 1)
	if (to >= 0 && to < props.state.list.length) {
		emit('move', id, to)
		// the grip keeps the focus at the slide's new place
		nextTick(() => panelEl.value?.querySelector(`[data-knorke-slide="${id}"] [data-knorke-slide-grip]`)?.focus())
	}
}

const STEP_KEYS = Object.freeze({ ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Home: 'first', End: 'last' })

/**
 * Window keydown, capture phase: the presentation's keys; every other key
 * aimed at the board is held back (no board shortcut runs).
 *
 * @param {KeyboardEvent} e key
 */
function onKey(e) {
	const root = rootEl.value
	const tg = e.target instanceof Element ? e.target : null
	if (tg && !(root && root.contains(tg)) && (tg.closest('input, textarea, select, [contenteditable=""], [contenteditable=true], [role=dialog]') !== null)) {
		// a field or a dialog (e.g. the timer dialog from the session bar) keeps its keys
		return
	}
	const inside = !!(root && e.target instanceof Node && root.contains(e.target))
	if (inside && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab' || (e.altKey && e.target?.matches?.('[data-knorke-slide-grip]')))) {
		// buttons and grips keep their own keys
		return
	}
	if (e.ctrlKey || e.metaKey) {
		if (!inside) {
			e.stopPropagation()
		}
		return
	}
	if (e.key === 'Escape') {
		e.preventDefault()
		e.stopPropagation()
		emit(presenter.value ? 'end' : 'look-around')
		return
	}
	if (presenter.value && Object.hasOwn(STEP_KEYS, e.key)) {
		e.preventDefault()
		e.stopPropagation()
		if (!e.repeat) {
			emit('step', STEP_KEYS[e.key])
		}
		return
	}
	if (!inside) {
		e.stopPropagation()
	}
}

/** Gap (px) kept between the frame and the bar above it. */
const BAR_GAP_PX = 8

/**
 * The screen px the slide list (right) and the bar with what lies below it
 * (bottom: the session bar) cover; the shown frame is fitted into the rest.
 */
function reportInsets() {
	nextTick(() => {
		const root = rootEl.value
		const bar = barEl.value
		const bottom = root && bar ? root.clientHeight - bar.offsetTop + BAR_GAP_PX : 0
		barCover.value = bottom
		const banners = root?.parentElement?.querySelector('.knorke-banners')
		const stack = banners?.parentElement
		panelTop.value = banners && stack && banners.offsetHeight > 0 ? stack.offsetTop + banners.offsetTop + banners.offsetHeight + BAR_GAP_PX : 12
		const open = presenter.value && panelOpen.value && panelEl.value
		overlay.value = open ? panelOverlays(panelEl.value.offsetWidth, root.clientWidth) : false
		const right = open && !overlay.value ? root.clientWidth - panelEl.value.offsetLeft : 0
		emit('insets', { right, bottom })
	})
}

watch([panelOpen, presenter], reportInsets)

onMounted(() => {
	window.addEventListener('keydown', onKey, true)
	window.addEventListener('resize', reportInsets)
	const banners = rootEl.value?.parentElement?.querySelector('.knorke-banners')
	if (banners && typeof ResizeObserver === 'function') {
		// a notice that comes or goes moves the list's top
		bannerWatch = new ResizeObserver(() => reportInsets())
		bannerWatch.observe(banners)
	}
	reportInsets()
	if (presenter.value) {
		nextEl.value?.focus?.()
	}
})

onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey, true)
	window.removeEventListener('resize', reportInsets)
	bannerWatch?.disconnect()
	emit('insets', { right: 0, bottom: 0 })
})
</script>
