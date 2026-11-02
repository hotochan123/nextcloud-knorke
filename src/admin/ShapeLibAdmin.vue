<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-admin-templates"
		data-knorke-admin="shapelibs"
		:data-knorke-admin-shapelibs-state="state">
		<p v-if="state === 'error'" class="knorke-admin__error" role="alert" data-knorke-error="shapelibs-load">
			{{ t('knorke', 'The shape libraries could not be loaded.') }}
		</p>
		<p v-if="failure" class="knorke-admin__error" role="alert" data-knorke-error="shapelibs">
			{{ failure }}
		</p>

		<template v-for="list in lists" :key="list.key">
			<h3 :ref="(el) => (headings[list.key] = el)"
				class="knorke-admin__heading"
				tabindex="-1"
				:data-knorke-admin-heading="'shapelibs-' + list.key">
				{{ list.title }}
			</h3>
			<p v-if="state === 'ready' && list.rows.length === 0" class="knorke-admin__hint" :data-knorke-admin-empty="'shapelibs-' + list.key">
				{{ list.empty }}
			</p>
			<ul v-if="list.rows.length > 0" class="knorke-admin-templates__list">
				<li v-for="e in list.rows"
					:key="e.id"
					class="knorke-admin-templates__row"
					:data-knorke-shapelib="e.id">
					<span class="knorke-admin-shapelibs__pics" aria-hidden="true">
						<img v-for="(pic, i) in picturesOf(e.id)"
							:key="i"
							:src="pic.uri"
							alt=""
							width="24"
							height="24">
					</span>
					<div class="knorke-admin-templates__text">
						<input v-if="renaming === e.id"
							ref="renameEl"
							v-model="renameValue"
							type="text"
							class="knorke-admin-templates__field"
							:maxlength="NAME_MAX"
							:aria-label="t('knorke', 'Name')"
							data-knorke-field="shapelib-name"
							@keydown.enter.prevent="saveName(e)"
							@keydown.esc.stop.prevent="renaming = null">
						<span v-else class="knorke-admin-templates__name">{{ e.name }}</span>
						<span class="knorke-admin-templates__by">{{ n('knorke', '%n shape', '%n shapes', e.names.length) }}</span>
						<span v-if="e.note" class="knorke-admin-templates__note">{{ e.note }}</span>
						<span v-if="e.by" class="knorke-admin-templates__by">{{ t('knorke', 'suggested by {name}', { name: e.by }) }}</span>
					</div>
					<div v-if="list.key === 'suggestions'" class="knorke-admin-templates__actions">
						<NcButton variant="primary" :disabled="busy" data-knorke-action="shapelib-adopt" @click="act('suggestions', () => libsApi.adoptShapeLib(e.id))">
							{{ t('knorke', 'Adopt') }}
						</NcButton>
						<NcButton variant="tertiary" :disabled="busy" data-knorke-action="shapelib-reject" @click="question = { kind: 'reject', ...e }">
							{{ t('knorke', 'Reject') }}
						</NcButton>
					</div>
					<div v-else class="knorke-admin-templates__actions">
						<NcButton v-if="renaming === e.id"
							variant="primary"
							:disabled="busy || renameValue.trim() === ''"
							data-knorke-action="shapelib-rename-save"
							@click="saveName(e)">
							{{ t('knorke', 'Save') }}
						</NcButton>
						<NcButton v-if="renaming !== e.id"
							variant="secondary"
							:disabled="busy"
							data-knorke-action="shapelib-rename"
							@click="startRename(e)">
							{{ t('knorke', 'Rename') }}
						</NcButton>
						<NcButton v-if="renaming !== e.id"
							variant="tertiary"
							:disabled="busy"
							data-knorke-action="shapelib-delete"
							@click="question = { kind: 'delete', ...e }">
							{{ t('knorke', 'Remove') }}
						</NcButton>
					</div>
				</li>
			</ul>
		</template>

		<ConfirmDialog v-if="question"
			:name="question.kind === 'reject' ? t('knorke', 'Reject suggestion?') : t('knorke', 'Delete library?')"
			:message="question.kind === 'reject'
				? t('knorke', '“{name}” stays with {user} and is no longer suggested; {user} is told.', { name: question.name, user: question.by })
				: t('knorke', '“{name}” will be deleted. Nobody finds it in the Shapes panel any more; shapes already on boards stay. This cannot be undone.', { name: question.name })"
			:confirm-label="question.kind === 'reject' ? t('knorke', 'Reject') : t('knorke', 'Delete')"
			:busy="busy"
			danger
			:data-knorke-dialog="'shapelib-' + question.kind"
			@confirm="confirm"
			@cancel="question = null" />
	</div>
</template>

<script setup>
/*
 * The admin section "Shape libraries" (factory job 203), since job 281 the
 * body of the second collapsible section of AdminSettings.vue: [data-knorke-admin=shapelibs] with two lists from
 * route 53 (api/shapeLibs.js reviewShapeLibs; load state in
 * [data-knorke-admin-shapelibs-state]: loading, ready or error). Each row
 * [data-knorke-shapelib=<id>] shows the first PREVIEW_MAX pictures (route
 * 48, components/shapeLibCache.js), the name and the number of shapes.
 *
 * - "Suggestions" (oldest first) with the note and "suggested by {name}": "Adopt"
 *   (route 52) and "Reject" (asks first, [data-knorke-dialog=shapelib-reject],
 *   then route 50; the library stays with its account).
 * - "Adopted libraries": "Rename" turns the name into a field (Enter saves,
 *   Esc cancels; route 49), "Remove" asks first
 *   ([data-knorke-dialog=shapelib-delete], then route 50).
 * After a success or a 404 (another admin was faster) route 53 loads again
 * and the focus goes to the heading of the list. Any other error: "The
 * change could not be saved." Names, notes and display names are text only,
 * pictures <img> only.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import * as libsApi from '../api/shapeLibs.js'
import { NAME_MAX, cleanName } from '../board/shapeImport.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { forgetLib, libEntries } from '../components/shapeLibCache.js'
import { HttpError } from '../sync/http.js'
import { n, t } from '../util/l10n.js'

/** Pictures shown per row. */
const PREVIEW_MAX = 8

const emit = defineEmits(['lists'])

/** 'loading' | 'ready' | 'error' of route 53 */
const state = ref('loading')
const suggestions = ref([])
const adopted = ref([])
/** library id → its pictures (loaded) */
const pictures = ref(new Map())
const busy = ref(false)
const failure = ref('')
/** the question before reject or delete: {kind, id, name, by} */
const question = ref(null)
const renaming = ref(null)
const renameValue = ref('')
const renameEl = ref(null)
const headings = {}
let loads = 0

const lists = computed(() => [
	{ key: 'suggestions', title: t('knorke', 'Suggestions'), empty: t('knorke', 'No open suggestions.'), rows: suggestions.value },
	{ key: 'adopted', title: t('knorke', 'Adopted libraries'), empty: t('knorke', 'No adopted libraries yet.'), rows: adopted.value },
])

/**
 * @param {number} id library id
 * @return {Array<{uri: string}>} its first PREVIEW_MAX pictures, once loaded
 */
function picturesOf(id) {
	return (pictures.value.get(String(id)) ?? []).filter((p) => p !== null).slice(0, PREVIEW_MAX)
}

/**
 * @param {unknown} list a list of route 53
 * @return {Array<{id: number, name: string, names: string[], note: (string|null), by: string}>}
 */
function rows(list) {
	return (Array.isArray(list) ? list : []).filter((e) => Number.isSafeInteger(e?.id) && typeof e?.name === 'string').map((e) => ({
		id: e.id, name: e.name, names: Array.isArray(e.names) ? e.names : [], note: typeof e.note === 'string' ? e.note : null,
		by: typeof e.by === 'string' ? e.by : '',
	}))
}

/** Loads route 53 (the newest load wins), then the pictures of its rows. */
async function load() {
	const k = ++loads
	state.value = 'loading'
	try {
		const res = await libsApi.reviewShapeLibs()
		if (k !== loads) return
		suggestions.value = rows(res.suggestions)
		adopted.value = rows(res.adopted)
		state.value = 'ready'
		for (const e of [...suggestions.value, ...adopted.value]) {
			libEntries(e.id).then((list) => {
				pictures.value = new Map(pictures.value).set(String(e.id), list)
			})
		}
	} catch (e) {
		console.warn('[knorke] shape libraries could not be loaded', e)
		if (k === loads) state.value = 'error'
	}
}

/**
 * Runs one change; a success or a 404 reloads the lists and focuses the heading of `list`.
 *
 * @param {string} list 'suggestions' | 'adopted'
 * @param {() => Promise<unknown>} fn the request
 * @return {Promise<boolean>}
 */
async function act(list, fn) {
	if (busy.value) return false
	busy.value = true
	failure.value = ''
	try {
		await fn()
	} catch (e) {
		if (!(e instanceof HttpError && e.status === 404)) {
			console.warn('[knorke] shape library change failed', e)
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

/** The question confirmed: route 50. */
async function confirm() {
	const q = question.value
	if (!q) return
	if (q.kind === 'delete') forgetLib(q.id)
	await act(q.kind === 'reject' ? 'suggestions' : 'adopted', () => libsApi.deleteShapeLib(q.id))
	question.value = null
}

/** @param {{id: number, name: string}} e an adopted library */
function startRename(e) {
	renaming.value = e.id
	renameValue.value = e.name
	failure.value = ''
	nextTick(() => {
		const el = Array.isArray(renameEl.value) ? renameEl.value[0] : renameEl.value
		el?.focus?.()
	})
}

/** @param {{id: number}} e the library being renamed */
async function saveName(e) {
	const name = cleanName(renameValue.value, '')
	if (name === '' || busy.value) return
	if (await act('adopted', () => libsApi.renameShapeLib(e.id, name))) renaming.value = null
}

// (job 281) the page's counter pill, notice and opening rule
watch([state, suggestions, adopted], () => emit('lists', { state: state.value, suggestions: suggestions.value.length, adopted: adopted.value.length }), { immediate: true })

onMounted(load)
</script>
