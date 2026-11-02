<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-admin-templates"
		data-knorke-admin="templates"
		:data-knorke-admin-templates-state="state">
		<p v-if="state === 'error'" class="knorke-admin__error" role="alert" data-knorke-error="templates-load">
			{{ t('knorke', 'The templates could not be loaded.') }}
		</p>
		<p v-if="failure" class="knorke-admin__error" role="alert" data-knorke-error="templates">
			{{ failure }}
		</p>

		<h3 :ref="(el) => setHeading('suggestions', el)"
			class="knorke-admin__heading"
			tabindex="-1"
			data-knorke-admin-heading="suggestions">
			{{ t('knorke', 'Suggestions') }}
		</h3>
		<p v-if="state === 'ready' && suggestions.length === 0" class="knorke-admin__hint" data-knorke-admin-empty="suggestions">
			{{ t('knorke', 'No open suggestions.') }}
		</p>
		<ul v-if="suggestions.length > 0" class="knorke-admin-templates__list">
			<li v-for="e in suggestions"
				:key="e.id"
				class="knorke-admin-templates__row"
				:data-knorke-suggestion="e.id">
				<TemplateSketch class="knorke-admin-templates__sketch" :rects="e.rects" />
				<div class="knorke-admin-templates__text">
					<span class="knorke-admin-templates__name">{{ e.name }}</span>
					<span v-if="e.note" class="knorke-admin-templates__note">{{ e.note }}</span>
					<span class="knorke-admin-templates__by">{{ t('knorke', 'suggested by {name}', { name: e.by }) }}</span>
				</div>
				<div class="knorke-admin-templates__actions">
					<NcButton variant="primary"
						:disabled="busy"
						data-knorke-action="template-adopt"
						@click="adopt(e)">
						{{ t('knorke', 'Adopt') }}
					</NcButton>
					<NcButton variant="tertiary"
						:disabled="busy"
						data-knorke-action="template-reject"
						@click="ask('reject', e)">
						{{ t('knorke', 'Reject') }}
					</NcButton>
				</div>
			</li>
		</ul>

		<h3 :ref="(el) => setHeading('adopted', el)"
			class="knorke-admin__heading"
			tabindex="-1"
			data-knorke-admin-heading="adopted">
			{{ t('knorke', 'Adopted templates') }}
		</h3>
		<p v-if="state === 'ready' && adopted.length === 0" class="knorke-admin__hint" data-knorke-admin-empty="adopted">
			{{ t('knorke', 'No adopted templates yet.') }}
		</p>
		<ul v-if="adopted.length > 0" class="knorke-admin-templates__list">
			<li v-for="e in adopted"
				:key="e.id"
				class="knorke-admin-templates__row"
				:data-knorke-adopted="e.id">
				<TemplateSketch class="knorke-admin-templates__sketch" :rects="e.rects" />
				<div class="knorke-admin-templates__text">
					<input v-if="renaming === e.id"
						ref="renameEl"
						v-model="renameValue"
						type="text"
						class="knorke-admin-templates__field"
						:maxlength="TEMPLATE_NAME_MAX"
						:aria-label="t('knorke', 'Name')"
						data-knorke-field="template-name"
						@keydown.enter.prevent="saveName(e)"
						@keydown.esc.stop.prevent="cancelRename">
					<span v-else class="knorke-admin-templates__name">{{ e.name }}</span>
				</div>
				<div class="knorke-admin-templates__actions">
					<NcButton v-if="renaming === e.id"
						variant="primary"
						:disabled="busy || cleanName(renameValue) === ''"
						data-knorke-action="template-rename-save"
						@click="saveName(e)">
						{{ t('knorke', 'Save') }}
					</NcButton>
					<NcButton v-if="renaming === e.id"
						variant="tertiary"
						:disabled="busy"
						data-knorke-action="template-rename-cancel"
						@click="cancelRename">
						{{ t('knorke', 'Cancel') }}
					</NcButton>
					<NcButton v-if="renaming !== e.id"
						variant="secondary"
						:disabled="busy"
						data-knorke-action="template-rename"
						@click="startRename(e)">
						{{ t('knorke', 'Rename') }}
					</NcButton>
					<NcButton v-if="renaming !== e.id"
						variant="tertiary"
						:disabled="busy"
						data-knorke-action="template-delete"
						@click="ask('delete', e)">
						{{ t('knorke', 'Remove') }}
					</NcButton>
				</div>
			</li>
		</ul>

		<ConfirmDialog v-if="question"
			:name="question.kind === 'reject' ? t('knorke', 'Reject suggestion?') : t('knorke', 'Delete template?')"
			:message="questionText"
			:confirm-label="question.kind === 'reject' ? t('knorke', 'Reject') : t('knorke', 'Delete')"
			:busy="busy"
			danger
			:data-knorke-dialog="'template-' + question.kind"
			@confirm="confirm"
			@cancel="question = null" />
	</div>
</template>

<script setup>
/*
 * The admin section "Templates" (factory job 182), since job 281 the body
 * of the first collapsible section of AdminSettings.vue (its head holds the
 * title and the intro sentence): [data-knorke-admin=templates] with two
 * lists from route 34 (api/templates.js
 * reviewTemplates; its load state in [data-knorke-admin-templates-state]:
 * loading, ready or error).
 *
 * - "Suggestions" (oldest first): one row [data-knorke-suggestion=<id>]
 *   each with the sketch (TemplateSketch, as in the template dialog), the
 *   name, the note and "suggested by {name}"; "Adopt" (route 33) and "Reject" (asks
 *   first, a ConfirmDialog with danger [data-knorke-dialog=template-reject],
 *   then route 32). Empty: "No open suggestions."
 * - "Adopted templates": one row [data-knorke-adopted=<id>] each with sketch
 *   and name; "Rename" turns the name into a field with "Save" and "Cancel"
 *   (Enter saves, Esc cancels; route 31) and "Remove" asks first
 *   ([data-knorke-dialog=template-delete], then route 32). Empty: "No
 *   adopted templates yet."
 *
 * After a success or a 404 (another admin was faster) route 34 loads again
 * and the focus goes to the heading of the list the row was in (tabindex
 * -1). Any other error: "The change could not be saved." (role alert); the
 * lists stay. Names, notes and display names are text only (interpolation,
 * never markup).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import * as templatesApi from '../api/templates.js'
import { TEMPLATE_NAME_MAX, cleanName, templateTile } from '../board/ownTemplates.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import TemplateSketch from '../components/TemplateSketch.vue'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'

const emit = defineEmits(['lists'])

/** 'loading' | 'ready' | 'error' of route 34 */
const state = ref('loading')
/** @type {import('vue').Ref<Array<{id: number, name: string, note: (string|null), rects: Array, by: string}>>} */
const suggestions = ref([])
/** @type {import('vue').Ref<Array<{id: number, name: string, note: null, rects: Array}>>} */
const adopted = ref([])
const busy = ref(false)
const failure = ref('')
/** the question before reject or delete: {kind: 'reject'|'delete', id, name, by} */
const question = ref(null)
/** the id of the adopted template whose name is a field, null: none */
const renaming = ref(null)
const renameValue = ref('')
const renameEl = ref(null)
/** The list headings (focus after an action). */
const headings = {}
let loads = 0

const questionText = computed(() => {
	const q = question.value
	if (!q) {
		return ''
	}
	return q.kind === 'reject'
		? t('knorke', '“{name}” is deleted and {user} is told.', { name: q.name, user: q.by })
		: t('knorke', '“{name}” will be deleted. Nobody can insert it any more; items already on boards stay. This cannot be undone.', { name: q.name })
})

/**
 * @param {string} list 'suggestions' | 'adopted'
 * @param {Element|null} el its heading (null on unmount)
 */
function setHeading(list, el) {
	headings[list] = el
}

/**
 * @param {unknown} list entries of route 34
 * @return {Array} their rows (entries that are no template left out); a suggestion's `by` as text
 */
function rows(list) {
	return (Array.isArray(list) ? list : []).map((e) => {
		const tile = templateTile(e)
		return tile === null ? null : { ...tile, by: typeof e.by === 'string' ? e.by : '' }
	}).filter((e) => e !== null)
}

/** Loads route 34 (the newest load wins). */
async function load() {
	const n = ++loads
	state.value = 'loading'
	try {
		const res = await templatesApi.reviewTemplates()
		if (n === loads) {
			suggestions.value = rows(res.suggestions)
			adopted.value = rows(res.templates)
			state.value = 'ready'
		}
	} catch (e) {
		console.warn('[knorke] templates could not be loaded', e)
		if (n === loads) {
			state.value = 'error'
		}
	}
}

/**
 * Runs one change; a success or a 404 reloads the lists and focuses the
 * heading of `list`, any other error shows the alert.
 *
 * @param {string} list 'suggestions' | 'adopted'
 * @param {() => Promise<unknown>} fn the request
 * @return {Promise<boolean>} the change went through (or was done already)
 */
async function act(list, fn) {
	if (busy.value) {
		return false
	}
	busy.value = true
	failure.value = ''
	try {
		await fn()
	} catch (e) {
		if (!(e instanceof HttpError && e.status === 404)) {
			console.warn('[knorke] template change failed', e)
			failure.value = t('knorke', 'The change could not be saved.')
			busy.value = false
			return false
		}
	}
	busy.value = false
	await load()
	await nextTick()
	headings[list]?.focus?.()
	return true
}

/** @param {{id: number}} e a suggestion */
function adopt(e) {
	return act('suggestions', () => templatesApi.adoptTemplate(e.id))
}

/**
 * @param {'reject'|'delete'} kind the question
 * @param {{id: number, name: string, by?: string}} e the row
 */
function ask(kind, e) {
	question.value = { kind, id: e.id, name: e.name, by: e.by ?? '' }
}

/** The question confirmed: route 32. */
async function confirm() {
	const q = question.value
	if (!q) {
		return
	}
	await act(q.kind === 'reject' ? 'suggestions' : 'adopted', () => templatesApi.deleteTemplate(q.id))
	question.value = null
}

/** @param {{id: number, name: string}} e an adopted template */
function startRename(e) {
	renaming.value = e.id
	renameValue.value = e.name
	failure.value = ''
	nextTick(() => {
		const el = Array.isArray(renameEl.value) ? renameEl.value[0] : renameEl.value
		el?.focus?.()
	})
}

function cancelRename() {
	renaming.value = null
	renameValue.value = ''
}

/** @param {{id: number, name: string}} e the template being renamed */
async function saveName(e) {
	const name = cleanName(renameValue.value)
	if (name === '' || busy.value) {
		return
	}
	if (await act('adopted', () => templatesApi.renameTemplate(e.id, name))) {
		cancelRename()
	}
}

// (job 281) the page's counter pill, notice and opening rule
watch([state, suggestions, adopted], () => emit('lists', { state: state.value, suggestions: suggestions.value.length, adopted: adopted.value.length }), { immediate: true })

onMounted(load)
</script>
