<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-commentfield" :data-knorke-comment-field="kind">
		<textarea ref="field"
			class="knorke-commentfield__input"
			:value="text"
			:placeholder="placeholder"
			:aria-label="placeholder"
			:maxlength="COMMENT_MAX"
			rows="2"
			:disabled="busy"
			data-knorke-field="comment"
			role="combobox"
			aria-autocomplete="list"
			:aria-expanded="list.length > 0 ? 'true' : 'false'"
			:aria-controls="listId"
			:aria-activedescendant="list.length > 0 ? listId + '-' + active : undefined"
			@input="onInput"
			@click="probe"
			@keydown="onKey" />
		<ul v-if="list.length > 0"
			:id="listId"
			class="knorke-commentfield__mentions"
			role="listbox"
			:aria-label="t('knorke', 'People')"
			data-knorke-mention-list>
			<li v-for="(a, i) in list"
				:id="listId + '-' + i"
				:key="a.id"
				role="option"
				class="knorke-commentfield__mention"
				:class="{ 'knorke-commentfield__mention--active': i === active }"
				:aria-selected="i === active ? 'true' : 'false'"
				:data-knorke-mention="a.id"
				@pointerdown.prevent
				@click="choose(a)">
				{{ a.name }}
			</li>
		</ul>
		<div class="knorke-commentfield__row">
			<span class="knorke-commentfield__count" aria-hidden="true">{{ text.length }} / {{ COMMENT_MAX }}</span>
			<NcButton v-if="cancelable"
				variant="tertiary"
				data-knorke-action="comment-cancel-edit"
				@click="$emit('cancel')">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary"
				:disabled="busy || text.trim() === ''"
				data-knorke-action="comment-send"
				@click="send">
				{{ sendLabel }}
			</NcButton>
		</div>
	</div>
</template>

<script setup>
/*
 * The field of a comment (factory job 189): a new thread, a reply or an
 * edit. Enter sends, Shift+Enter makes a new line, at most COMMENT_MAX
 * characters. Every key stays in the field: keydown never goes further
 * than the field (the board's shortcuts never see it; the canvas listens
 * only with its own focus anyway). The text goes out in the wire form
 * (comments.js toWire): every chosen "@Name" becomes @"uid".
 *
 * @ list (accounts with the right to write, prop search set): "@" at the
 * start or after white space opens it (comments.js mentionQuery); the
 * accounts come from route 39, MENTION_DELAY_MS after the last key (the
 * newest query wins). ↑/↓ move, Enter or Tab or a tap choose (the field
 * gets "@Name "), Esc closes the list only.
 *
 * Events: input(text, chosen) on every change (the board view keeps the
 * draft per thread), send(wire text), cancel (edit only), escape (Esc
 * without an open list).
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import { COMMENT_MAX, insertMention, mentionQuery, toWire } from '../board/comments.js'
import { t } from '../util/l10n.js'

/** Wait after the last key before the @ list asks the server (ms). */
const MENTION_DELAY_MS = 250
let seq = 0

const props = defineProps({
	/** 'new' | 'reply' | 'edit' ([data-knorke-comment-field]) */
	kind: { type: String, default: 'reply' },
	/** the text the field starts with */
	initial: { type: String, default: '' },
	/** mentions the initial text carries ([{id, name}]) */
	initialChosen: { type: Array, default: () => [] },
	placeholder: { type: String, default: '' },
	sendLabel: { type: String, default: '' },
	/** (q) => Promise<[{id, name}]>: the @ list; null: no mentions (guests) */
	search: { type: Function, default: null },
	busy: { type: Boolean, default: false },
	/** an edit: "Cancel" next to "Save" */
	cancelable: { type: Boolean, default: false },
	/** the field takes the focus when it appears */
	autofocus: { type: Boolean, default: false },
})

const emit = defineEmits(['input', 'send', 'cancel', 'escape'])

const field = ref(null)
const text = ref(props.initial)
/** [{id, name}] the mentions chosen in this field */
let chosen = [...props.initialChosen]
const list = ref([])
const active = ref(0)
const listId = 'knorke-mentions-' + (++seq)
/** {start, q} of the open query, null without one */
let query = null
let timer = null
let asked = 0

function onInput(e) {
	text.value = e.target.value
	emit('input', text.value, chosen)
	probe()
}

/** The @ query at the caret (accounts only); the list follows it. */
function probe() {
	const el = field.value
	query = props.search && el ? mentionQuery(text.value, el.selectionStart ?? text.value.length) : null
	clearTimeout(timer)
	if (query === null) {
		list.value = []
		return
	}
	const q = query.q
	const mine = ++asked
	timer = setTimeout(async () => {
		let found = []
		try {
			found = await props.search(q)
		} catch (e) {
			found = []
		}
		if (mine === asked && query !== null && query.q === q) {
			list.value = Array.isArray(found) ? found : []
			active.value = 0
		}
	}, MENTION_DELAY_MS)
}

/** @param {{id: string, name: string}} a the chosen account */
async function choose(a) {
	const el = field.value
	if (query === null || !el) {
		list.value = []
		return
	}
	const r = insertMention(text.value, query.start, el.selectionStart ?? text.value.length, a.name)
	text.value = r.text
	if (!chosen.some((c) => c.id === a.id)) {
		chosen = [...chosen, { id: a.id, name: a.name }]
	}
	list.value = []
	query = null
	emit('input', text.value, chosen)
	await nextTick()
	el.focus()
	el.setSelectionRange?.(r.caret, r.caret)
}

function send() {
	const s = text.value.trim()
	if (s === '' || props.busy) {
		return
	}
	emit('send', toWire(s, chosen))
}

/** @param {KeyboardEvent} e key in the field */
function onKey(e) {
	// no board shortcut sees a key of the field
	e.stopPropagation()
	if (list.value.length > 0) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault()
			const k = list.value.length
			active.value = (active.value + (e.key === 'ArrowDown' ? 1 : k - 1)) % k
			return
		}
		if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
			e.preventDefault()
			choose(list.value[active.value])
			return
		}
		if (e.key === 'Escape') {
			e.preventDefault()
			list.value = []
			query = null
			return
		}
	}
	if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
		e.preventDefault()
		send()
		return
	}
	if (e.key === 'Escape') {
		e.preventDefault()
		emit('escape')
	}
}

/** Empties the field (after a send went through). */
function clear() {
	text.value = ''
	chosen = []
	list.value = []
	query = null
}

/** The field takes the focus. */
function focus() {
	field.value?.focus({ preventScroll: true })
}

defineExpose({ clear, focus })

onMounted(() => {
	if (props.autofocus) {
		nextTick(() => focus())
	}
})

onBeforeUnmount(() => {
	clearTimeout(timer)
})
</script>
