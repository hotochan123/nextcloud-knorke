<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-colorpicker">
		<div class="knorke-contextbar__colors knorke-contextbar__colors--grid" role="group" :aria-label="label">
			<button v-for="c in palette"
				:key="c"
				type="button"
				class="knorke-swatch"
				:class="{ 'knorke-swatch--active': isColor(c) }"
				:style="{ backgroundColor: c }"
				:title="swatchName(c)"
				:aria-label="swatchName(c)"
				:aria-pressed="isColor(c) ? 'true' : 'false'"
				:data-knorke-style="path"
				:data-knorke-value="c"
				:data-knorke-swatch-edge="edged(c) ? '' : undefined"
				@click="(e) => pick(c, e)" />
		</div>
		<!-- the row "On this board" -->
		<div v-if="boardColors.length > 0"
			class="knorke-contextbar__colors knorke-colorpicker__board"
			role="group"
			:aria-label="t('knorke', 'On this board')"
			data-knorke-board-colors>
			<span class="knorke-contextbar__label">{{ t('knorke', 'On this board') }}</span>
			<button v-for="c in boardColors"
				:key="c"
				type="button"
				class="knorke-swatch"
				:class="{ 'knorke-swatch--active': isColor(c) }"
				:style="{ backgroundColor: c }"
				:aria-label="t('knorke', 'Color {color}', { color: c })"
				:aria-pressed="isColor(c) ? 'true' : 'false'"
				:data-knorke-style="path"
				:data-knorke-value="c"
				@click="(e) => pick(c, e)" />
		</div>
		<slot />
		<button type="button"
			class="knorke-colorpicker__custom"
			:aria-expanded="custom ? 'true' : 'false'"
			:aria-controls="hexId"
			data-knorke-action="custom-color"
			@click="custom = !custom">
			<NcIconSvgWrapper :path="icons.sortColors" :size="20" />
			{{ t('knorke', 'Custom color…') }}
		</button>
		<div v-show="custom" :id="hexId" class="knorke-colorpicker__hex">
			<span class="knorke-colorpicker__hash" aria-hidden="true">#</span>
			<input type="text"
				class="knorke-colorpicker__input"
				:value="draft"
				:aria-label="t('knorke', 'Hex color')"
				:aria-invalid="invalid ? 'true' : undefined"
				:data-knorke-hex="path"
				maxlength="7"
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="done"
				@input="onInput"
				@keydown="onKey">
			<span class="knorke-colorpicker__preview"
				:style="preview === null ? undefined : { backgroundColor: preview }"
				:data-knorke-hex-preview="preview ?? ''" />
			<input type="color"
				class="knorke-colorpicker__system"
				:value="systemColor"
				:aria-label="t('knorke', 'Custom color')"
				:title="t('knorke', 'Custom color')"
				:data-knorke-system-color="path"
				@change="onSystem">
		</div>
	</div>
</template>

<script setup>
/*
 * The colour block of one palette in a panel of the context bar (job 135):
 * fill of notes, frames and shapes, border or line, text colour. Rows:
 * - the palette as a grid of 8 columns ([data-knorke-style=<path>]
 *   [data-knorke-value=#rrggbb], aria-pressed on the common colour; job 227:
 *   the colour's name, labels.js paletteName, as title and aria-label);
 * - the hex row: a fixed "#", the field input[data-knorke-hex=<path>]
 *   (the common colour without "#", empty while the selection differs; it
 *   follows the colour when that changes), the preview dot
 *   [data-knorke-hex-preview] (the colour while the input is valid, else
 *   only its edge) and the system colour picker
 *   input[type=color][data-knorke-system-color=<path>] (round, its value the
 *   common colour, else the first palette colour). Enter with a valid code
 *   (contextbar.js parseHex) sets it, the focus stays in the field; Enter
 *   with an invalid one sets nothing and marks the field
 *   (aria-invalid="true", red edge) until the next input. Blur or closing
 *   the panel sets nothing. The system picker sets on `change` (picker
 *   confirmed or closed), never on `input`;
 * - "On this board" ([data-knorke-board-colors], only with at least one
 *   colour): the board's custom colours (selection v2 boardColors) as
 *   swatches like the grid.
 * Job 230 (redesign of the context bar): the order is the grid, "On this
 * board", the default slot (the panel's own rows, e.g. the opacity), then the
 * text button "Custom color…" ([data-knorke-action=custom-color],
 * aria-expanded, aria-controls) that shows and hides the hex row (v-show:
 * hidden, it stays in the DOM, so a typed draft survives); it starts
 * closed whenever the picker mounts (every panel or tab opened anew). The
 * swatches of white and black carry [data-knorke-swatch-edge]: an edge in
 * --k-swatch-edge, visible on the light and the dark panel.
 * Only colours that passed parseHex or the registry rule 'color' reach a
 * style binding or the emit.
 *
 * Emits: style(path, #rrggbb, event), the same emit as the bar's other style
 * buttons (one op per item, one undo step).
 */
import { computed, ref, watch } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { PALETTE } from '../model/tokens.js'
import { t } from '../util/l10n.js'
import { parseHex } from './contextbar.js'
import { icons } from './icons.js'
import { paletteName } from './labels.js'

const props = defineProps({
	/** the field path: style.fill, style.stroke, style.textColor or style.color */
	path: { type: String, required: true },
	/** the palette colours (lowercase #rrggbb) */
	palette: { type: Array, required: true },
	/** the common colour of the selection; null while it differs */
	color: { type: String, default: null },
	/** the row "On this board" (selection v2 boardColors) */
	boardColors: { type: Array, default: () => [] },
	/** name of the palette grid */
	label: { type: String, required: true },
})

const emit = defineEmits(['style'])

/** (job 230) White and black, whose swatches carry a contrasting edge (--k-swatch-edge) */
const EDGED = new Set(PALETTE.filter((e) => e.key === 'weiss' || e.key === 'schwarz').flatMap((e) => [e.light, e.strong]))
/** (job 230) "Custom color…" is open: the hex row shows (closed on every new panel, which mounts the picker anew) */
const custom = ref(false)
/** the id of the hex row (aria-controls of "Custom color…") */
const hexId = computed(() => 'knorke-hex-' + props.path.replace(/[^a-z]/gi, '-'))

/** the common colour, validated (null: none or differing) */
const common = computed(() => parseHex(props.color))
const draft = ref(toDraft(common.value))
const invalid = ref(false)
/** the preview dot: the typed colour while it is valid */
const preview = computed(() => parseHex(draft.value))
const systemColor = computed(() => common.value ?? parseHex(props.palette[0]) ?? '#000000')

watch(common, (c) => {
	draft.value = toDraft(c)
	invalid.value = false
})

/**
 * @param {string|null} c #rrggbb or null
 * @return {string} the field's text: the colour without "#", '' for none
 */
function toDraft(c) {
	return c === null ? '' : c.slice(1)
}

/**
 * @param {string} c a palette colour
 * @return {boolean} (job 230) white or black: the swatch gets the contrasting edge
 */
function edged(c) {
	return EDGED.has(parseHex(c))
}

/**
 * @param {string} c a swatch colour
 * @return {boolean} it is the common colour
 */
function isColor(c) {
	return common.value !== null && common.value === parseHex(c)
}

/**
 * @param {string} c a palette colour
 * @return {string} (job 227) its name (tooltip and label), "Color #rrggbb" outside the palette
 */
function swatchName(c) {
	return paletteName(c) ?? t('knorke', 'Color {color}', { color: c })
}

/**
 * @param {string} c swatch colour
 * @param {Event} e click
 */
function pick(c, e) {
	emit('style', props.path, c, e)
}

/** @param {InputEvent} e input of the hex field */
function onInput(e) {
	draft.value = String(e.target?.value ?? '')
	invalid.value = false
}

/** @param {KeyboardEvent} e keydown in the hex field: Enter applies a valid code */
function onKey(e) {
	if (e.key !== 'Enter' || e.isComposing) {
		return
	}
	e.preventDefault()
	const hex = parseHex(draft.value)
	if (hex === null) {
		invalid.value = true
		return
	}
	invalid.value = false
	draft.value = toDraft(hex)
	emit('style', props.path, hex, e)
}

/** @param {Event} e change of the system colour picker (confirmed or closed) */
function onSystem(e) {
	const hex = parseHex(e.target?.value)
	if (hex !== null) {
		emit('style', props.path, hex, e)
	}
}
</script>
