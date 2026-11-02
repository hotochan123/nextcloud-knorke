<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-templates__grid" :class="'knorke-templates__grid--' + mode">
		<component :is="picking ? 'label' : 'button'"
			v-for="(e, i) in entries"
			:key="e.value"
			:ref="(el) => setTile(el, i)"
			:type="picking ? null : 'button'"
			class="knorke-templates__tile"
			:class="{ 'knorke-templates__tile--blank': e.kind === 'blank' }"
			:data-knorke-template="e.kind === 'own' ? null : e.key"
			:data-knorke-own-template="e.kind === 'own' ? e.id : null"
			:data-knorke-picked="picking ? String(pick === e.value) : null"
			:aria-labelledby="picking ? null : prefix + 'name-' + e.value"
			:aria-describedby="picking || !e.text ? null : prefix + 'text-' + e.value"
			@click="picking || choose(e)">
			<input v-if="picking"
				type="radio"
				class="knorke-templates__radio"
				:name="prefix + 'pick'"
				:value="e.value"
				:checked="pick === e.value"
				:aria-labelledby="prefix + 'name-' + e.value"
				:aria-describedby="e.text ? prefix + 'text-' + e.value : null"
				@change="$emit('update:pick', e.value)"
				@keydown.esc="$emit('cancel')">
			<svg v-if="e.kind === 'blank'"
				class="knorke-templates__sketch"
				viewBox="0 0 120 80"
				aria-hidden="true"
				focusable="false">
				<path class="knorke-templates__plus" d="M60 30V50M50 40H70" />
			</svg>
			<TemplateSketch v-else :rects="e.rects" />
			<span :id="prefix + 'name-' + e.value" class="knorke-templates__name">{{ e.name }}</span>
			<span v-if="e.text" :id="prefix + 'text-' + e.value" class="knorke-templates__text">{{ e.text }}</span>
		</component>
		<template v-if="mode === 'insert'">
			<div v-for="e in pending"
				:key="'pending-' + e.id"
				class="knorke-templates__cell">
				<div class="knorke-templates__tile knorke-templates__pending" :data-knorke-pending-template="e.id">
					<TemplateSketch :rects="e.rects" />
					<span class="knorke-templates__name">{{ e.name }}</span>
					<span class="knorke-templates__text">{{ t('knorke', 'Waiting for approval') }}</span>
				</div>
				<button type="button"
					class="knorke-templates__withdraw"
					:data-knorke-template-withdraw="e.id"
					:aria-label="withdrawLabel(e)"
					:title="withdrawLabel(e)"
					@click="$emit('withdraw', { id: e.id, name: e.name })">
					<svg viewBox="0 0 24 24"
						width="20"
						height="20"
						aria-hidden="true"
						focusable="false">
						<path :d="undo" fill="currentColor" />
					</svg>
				</button>
			</div>
		</template>
		<p v-if="mode !== 'start' && own && own.state === 'error'"
			class="knorke-dialog__error"
			role="alert"
			data-knorke-templates-error>
			{{ t('knorke', 'The templates could not be loaded.') }}
		</p>
	</div>
</template>

<script setup>
/*
 * The one grid of template tiles (factory job 232, docs/redesign/ V12, V14;
 * the tiles of job 180, the own templates and suggestions of job 182). Each
 * tile: the sketch on top (TemplateSketch, aria-hidden; the built-in ones
 * drawn from templateSketch's frames, notes and pads), the name (the
 * accessible name) and, for the built-in ones and "Blank", one sentence
 * (the description). The built-in tiles are [data-knorke-template=<key>] in
 * the order of TEMPLATE_KEYS, the adopted own templates (route 28, the
 * prop own) [data-knorke-own-template=<id>] in the server's order, "Blank"
 * [data-knorke-template=blank] (only outlined, a "+" for a sketch). Three
 * modes:
 * - 'insert' (TemplateDialog, "Insert template"): built-in then own, then
 *   the own open suggestions (dimmed cards with their withdraw button
 *   beside them, job 182; it emits withdraw({id, name})). Since factory
 *   job 237 its tiles pick like those of 'pick', without "Blank" and with
 *   the sentence visible; the dialog's "Insert" inserts the picked one.
 *   With autofocus the first tile's radio gets the focus when the grid
 *   mounts (that picks nothing).
 * - 'pick' (App.vue, "New board"): "Blank" first, then built-in and own,
 *   each a label around a native radio (visually hidden; the arrow keys
 *   pick), the picked one [data-knorke-picked=true]; picking emits
 *   update:pick with the tile's value ('blank', a key, 'own:<id>'). The
 *   sentence is there for screen readers only (small tiles, five a row).
 *   NcModal ignores Esc while an <input> has the focus, so Esc on a radio
 *   emits cancel.
 * - 'start' (BoardView, the empty board): native buttons, built-in, own,
 *   then "Blank"; a tile emits insert(key) or insert-own(id), "Blank"
 *   emits blank.
 * A failed route 28 shows its error line in 'insert' and 'pick'. The ids
 * carry the mode, so the start tiles and the dialog never share one.
 */
import { computed, nextTick, onMounted } from 'vue'
import { templateTiles } from '../board/ownTemplates.js'
import { TEMPLATE_KEYS, templateOf, templateSketch } from '../board/templates.js'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'
import TemplateSketch from './TemplateSketch.vue'

const props = defineProps({
	/** 'insert' | 'pick' | 'start' */
	mode: { type: String, default: 'insert' },
	/** (job 182) {state, templates, pending} of route 28; null: nothing loads (guests, the Guests app) */
	own: { type: Object, default: null },
	/** modes 'pick' and 'insert': the picked tile's value (null: none) */
	pick: { type: String, default: 'blank' },
	/** modes 'insert' and 'start': the first tile (in 'insert' its radio) gets the focus on mount */
	autofocus: { type: Boolean, default: false },
})

const emit = defineEmits(['insert', 'insert-own', 'withdraw', 'blank', 'update:pick', 'cancel'])

const prefix = 'knorke-template-' + props.mode + '-'
/** Modes 'pick' and (job 237) 'insert': labels around radios instead of buttons. */
const picking = props.mode === 'pick' || props.mode === 'insert'

/**
 * @param {string} key one of TEMPLATE_KEYS
 * @return {Array<object>} the rectangles of TemplateSketch: frames, then notes, then pads
 */
function builtinRects(key) {
	const s = templateSketch(key)
	return [
		...s.frames.map((f) => ({ ...f, frame: true, fill: null })),
		...[...s.notes, ...s.pads].map((n) => ({ x: n.x, y: n.y, w: n.size, h: n.size, frame: false, fill: n.fill })),
	]
}

const builtins = TEMPLATE_KEYS.map((key) => {
	const def = templateOf(key)
	return { kind: 'builtin', key, value: key, name: def.name, text: def.text, rects: builtinRects(key) }
})
const blank = { kind: 'blank', key: 'blank', value: 'blank', name: t('knorke', 'Blank'), text: t('knorke', 'Without a template') }

/** (job 182) The adopted templates in the server's order (entries that are no template are left out). */
const adopted = computed(() => templateTiles(props.own?.templates).map((e) => ({ kind: 'own', id: e.id, value: 'own:' + e.id, name: e.name, text: '', rects: e.rects })))
/** (job 182) The own open suggestions in the server's order (mode 'insert'). */
const pending = computed(() => templateTiles(props.own?.pending))

/** The tiles in the order of the mode. */
const entries = computed(() => (props.mode === 'pick'
	? [blank, ...builtins, ...adopted.value]
	: props.mode === 'start' ? [...builtins, ...adopted.value, blank] : [...builtins, ...adopted.value]))

const undo = icons.undo

/** @param {object} e a tile of a button mode */
function choose(e) {
	if (e.kind === 'own') {
		emit('insert-own', e.id)
	} else if (e.kind === 'blank') {
		emit('blank')
	} else {
		emit('insert', e.key)
	}
}

/**
 * @param {{name: string}} e a suggestion's tile
 * @return {string} the withdraw button's accessible name
 */
function withdrawLabel(e) {
	return t('knorke', 'Withdraw suggestion “{name}”', { name: e.name })
}

/** The tiles (buttons, labels when picking) by index (the first one gets the focus). */
const buttons = []

/**
 * @param {HTMLElement|null} el a tile's button or label (null when it unmounts)
 * @param {number} i its index
 */
function setTile(el, i) {
	buttons[i] = el
}

onMounted(async () => {
	if (props.autofocus) {
		await nextTick()
		// job 237: a label takes no focus, its radio does (focusing it picks nothing)
		const first = picking ? buttons[0]?.querySelector?.('input') : buttons[0]
		first?.focus?.()
	}
})
</script>
