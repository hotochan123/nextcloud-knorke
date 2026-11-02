<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<ConfirmDialog :name="t('knorke', 'Insert template')"
		size="normal"
		:confirm-label="t('knorke', 'Insert')"
		:confirm-disabled="picked === null"
		class="knorke-templates"
		data-knorke-dialog="templates"
		:data-knorke-templates-state="own ? own.state : null"
		close-on-click-outside
		:set-return-focus="false"
		@confirm="insert"
		@cancel="$emit('close')">
		<TemplateGrid v-model:pick="pick"
			mode="insert"
			:own="own"
			autofocus
			@withdraw="(e) => $emit('withdraw', e)"
			@cancel="$emit('close')" />
	</ConfirmDialog>
</template>

<script setup>
/*
 * The template dialog (factory job 180), opened by the board menu's
 * "Insert template…" and the context menu's entry insert-template. Since
 * factory job 232 its tiles are TemplateGrid's mode 'insert' (the grid of
 * "New board" and the empty board): four built-in tiles in the order of
 * board/templates.js TEMPLATE_KEYS [data-knorke-template=<key>], each with
 * its sketch, name and sentence.
 *
 * Factory job 237 (two steps, docs/redesign/): a tile only picks, as in
 * "New board" (a label around a native radio, [data-knorke-picked=true]);
 * nothing is picked when the dialog opens. "Insert"
 * ([data-knorke-action=confirm], ConfirmDialog) is enabled while a tile of
 * the dialog is picked; it, or Enter in the form, emits insert with the key
 * or insert-own with the id, once (the dialog closes then). "Cancel", Esc
 * (on a radio too), the close button or a click beside the box emit close.
 * The first tile's radio has the focus when the dialog opens; the arrow
 * keys pick, Tab moves on, the focus stays in the dialog (NcModal's focus
 * trap). Where the focus goes after the dialog is the board's decision
 * (set-return-focus false): the canvas.
 *
 * Factory job 182 (template suggestions): for an account with a template
 * right the board view loads route 28 when the dialog opens and passes
 * prop own {state: loading|ready|error, templates, pending} (state also as
 * [data-knorke-templates-state]; null – the guest page, an account of the
 * Guests app – nothing loads and there is no state). The four tiles show at
 * once; then every adopted template [data-knorke-own-template=<id>] and
 * every own open suggestion as a dimmed card
 * [data-knorke-pending-template=<id>] with its withdraw button
 * [data-knorke-template-withdraw=<id>] beside it (emits withdraw with
 * {id, name}). A picked template that a new load no longer lists is picked
 * no more. A failed load shows "The templates of this Nextcloud could not
 * be loaded." ([data-knorke-templates-error]). The grid scrolls inside the
 * dialog.
 */
import { computed, ref } from 'vue'
import { templateTiles } from '../board/ownTemplates.js'
import { TEMPLATE_KEYS } from '../board/templates.js'
import { t } from '../util/l10n.js'
import { startPick } from './boardList.js'
import ConfirmDialog from './ConfirmDialog.vue'
import TemplateGrid from './TemplateGrid.vue'

const props = defineProps({
	/** (job 182) {state, templates, pending} of route 28; null: nothing loads (guests, the Guests app) */
	own: { type: Object, default: null },
})

const emit = defineEmits(['insert', 'insert-own', 'withdraw', 'close'])

/** (Job 237) The picked tile's value (a key or 'own:<id>'), null before the first pick. */
const pick = ref(null)

/** (Job 237) The picked value while its tile is in the dialog, else null. */
const picked = computed(() => {
	const v = pick.value
	if (TEMPLATE_KEYS.includes(v)) {
		return v
	}
	return templateTiles(props.own?.templates).some((e) => 'own:' + e.id === v) ? v : null
})

/** (Job 237) Set by the first insert: a second click on the closing dialog inserts nothing. */
let done = false

/** (Job 237) "Insert" (or Enter): the picked template, once. */
function insert() {
	const p = startPick(picked.value)
	if (done || p === null) {
		return
	}
	done = true
	if (p.own) {
		emit('insert-own', p.own)
	} else {
		emit('insert', p.key)
	}
}
</script>
