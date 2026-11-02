<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="title"
		size="small"
		is-form
		:no-close="busy"
		class="knorke-dialog knorke-shapelib"
		:data-knorke-dialog="'shapelib-' + mode"
		@update:open="(o) => !o && !busy && $emit('close')"
		@submit="submit">
		<!-- NcModal ignores Esc inside inputs (useHotKey): the fields close the dialog themselves -->
		<div class="knorke-shapelib__body" @keydown.esc.stop.prevent="!busy && $emit('close')">
			<label v-if="mode === 'import' || mode === 'rename'" class="knorke-shapelib__field">
				<span>{{ t('knorke', 'Name') }}</span>
				<input ref="firstEl"
					v-model="name"
					type="text"
					:maxlength="NAME_MAX"
					:disabled="busy"
					required
					data-knorke-shapelib-name>
			</label>
			<template v-if="mode === 'import'">
				<p class="knorke-shapelib__count" data-knorke-shapelib-found>
					{{ n('knorke', '%n shape found', '%n shapes found', draft.entries.length) }}
				</p>
				<p v-if="draft.skipped > 0" class="knorke-shapelib__count" data-knorke-shapelib-skipped>
					{{ n('knorke', '%n skipped (too large or not a picture)', '%n skipped (too large or not a picture)', draft.skipped) }}
				</p>
				<div v-if="draft.entries.length > 0" class="knorke-shapelib__preview" aria-hidden="true">
					<img v-for="(e, i) in draft.entries.slice(0, PREVIEW_MAX)"
						:key="i"
						:src="e.img"
						:title="e.name"
						alt=""
						width="32"
						height="32">
				</div>
			</template>
			<label v-if="mode === 'suggest'" class="knorke-shapelib__field">
				<span>{{ t('knorke', 'Note for the admins (optional)') }}</span>
				<input ref="firstEl"
					v-model="note"
					type="text"
					:maxlength="NOTE_MAX"
					:disabled="busy"
					data-knorke-shapelib-note>
			</label>
			<p v-if="mode === 'delete'">
				{{ t('knorke', 'Delete the library {name}? Shapes from it stay on the boards.', { name: lib?.name ?? '' }) }}
			</p>
			<p v-if="error"
				class="knorke-dialog__error"
				role="alert"
				data-knorke-shapelib-error>
				{{ error }}
			</p>
		</div>
		<template #actions>
			<NcButton type="button"
				variant="tertiary"
				:disabled="busy"
				data-knorke-action="shapelib-cancel"
				@click="$emit('close')">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton type="submit"
				:variant="mode === 'delete' ? 'error' : 'primary'"
				:disabled="!canSend"
				data-knorke-action="shapelib-ok">
				{{ okText }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * The dialogs of own shape libraries (factory job 203), one per mode
 * ([data-knorke-dialog=shapelib-<mode>]):
 * - import: the name [data-knorke-shapelib-name] (prefilled from the draft
 *   of board/shapeImport.js importShapes), "N shapes found", "M skipped
 *   (too large or not a picture)" when M > 0, the first PREVIEW_MAX
 *   pictures as <img>, "Import" (off without a shape): route 47;
 * - rename: the name of lib, "Rename": route 49;
 * - suggest: a note to the admins (optional), "Suggest": route 51;
 * - delete: a question, "Delete": route 50.
 * Success emits done with the answer; an error stays in the dialog
 * ([data-knorke-shapelib-error]). Cancel and Esc emit close. Names, notes
 * and pictures are text and <img> only (v-model, :src), never markup.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import * as libsApi from '../api/shapeLibs.js'
import { LIB_OWN_MAX, LIB_PENDING_MAX, NAME_MAX, NOTE_MAX, cleanName } from '../board/shapeImport.js'
import { HttpError } from '../sync/http.js'
import { n, t } from '../util/l10n.js'

const props = defineProps({
	/** import | rename | suggest | delete */
	mode: { type: String, required: true },
	/** import: {name, entries, skipped} (importShapes) */
	draft: { type: Object, default: null },
	/** rename, suggest, delete: the library {id, name} */
	lib: { type: Object, default: null },
})

const emit = defineEmits(['done', 'close'])

/** Pictures the import shows. */
const PREVIEW_MAX = 24

const name = ref(String(props.mode === 'import' ? props.draft?.name ?? '' : props.lib?.name ?? ''))
const note = ref('')
const busy = ref(false)
const error = ref('')
const firstEl = ref(null)

const title = computed(() => ({
	import: t('knorke', 'Import shapes'),
	rename: t('knorke', 'Rename library'),
	suggest: t('knorke', 'Suggest to admins'),
	delete: t('knorke', 'Delete library'),
})[props.mode] ?? '')
const okText = computed(() => ({
	import: t('knorke', 'Import'),
	rename: t('knorke', 'Rename'),
	suggest: t('knorke', 'Suggest'),
	delete: t('knorke', 'Delete'),
})[props.mode] ?? '')
const named = computed(() => name.value.trim() !== '')
const canSend = computed(() => !busy.value && (props.mode === 'import' ? named.value && (props.draft?.entries?.length ?? 0) > 0
	: props.mode === 'rename' ? named.value : true))

/**
 * @param {unknown} e error of a route
 * @return {string} the text the dialog shows
 */
function failText(e) {
	if (e instanceof HttpError && e.status === 409 && e.code === 'library_limit') {
		return t('knorke', 'You have {max} libraries already. Delete one first.', { max: Number.isInteger(e.body?.max) ? e.body.max : LIB_OWN_MAX })
	}
	if (e instanceof HttpError && e.status === 409 && e.code === 'suggestion_limit') {
		const max = Number.isInteger(e.body?.max) ? e.body.max : LIB_PENDING_MAX
		return t('knorke', 'You have {max} open suggestions already. Withdraw one or wait for a decision.', { max })
	}
	if (e instanceof HttpError && e.status === 413) {
		return t('knorke', 'This library is too large. Import fewer files at once.')
	}
	return t('knorke', 'The library could not be saved.')
}

async function submit() {
	if (!canSend.value) {
		return
	}
	busy.value = true
	error.value = ''
	try {
		let res
		if (props.mode === 'import') {
			res = await libsApi.createShapeLib(cleanName(name.value, ''), props.draft.entries)
		} else if (props.mode === 'rename') {
			res = await libsApi.renameShapeLib(props.lib.id, cleanName(name.value, ''))
		} else if (props.mode === 'suggest') {
			res = await libsApi.suggestShapeLib(props.lib.id, note.value.trim())
		} else {
			res = await libsApi.deleteShapeLib(props.lib.id)
		}
		emit('done', res)
	} catch (e) {
		console.warn('[knorke] shape library not saved', e)
		error.value = failText(e)
	} finally {
		busy.value = false
	}
}

onMounted(async () => {
	await nextTick()
	firstEl.value?.focus?.()
})
</script>
