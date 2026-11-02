<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="suggest ? t('knorke', 'Suggest as template') : t('knorke', 'Save as template')"
		size="small"
		is-form
		:no-close="busy"
		class="knorke-dialog knorke-templateedit"
		:data-knorke-dialog="suggest ? 'template-suggest' : 'template-save'"
		@update:open="(o) => !o && !busy && $emit('close')"
		@submit="submit">
		<!-- NcModal ignores Esc inside inputs (useHotKey): the fields close the dialog themselves -->
		<div class="knorke-templateedit__body" @keydown.esc.stop.prevent="!busy && $emit('close')">
			<label class="knorke-templateedit__field">
				<span>{{ t('knorke', 'Name') }}</span>
				<input ref="nameEl"
					v-model="name"
					type="text"
					:maxlength="TEMPLATE_NAME_MAX"
					:disabled="busy"
					required
					data-knorke-template-name>
			</label>
			<label v-if="suggest" class="knorke-templateedit__field">
				<span>{{ t('knorke', 'Note for the admins (optional)') }}</span>
				<input v-model="note"
					type="text"
					:maxlength="TEMPLATE_NOTE_MAX"
					:disabled="busy"
					data-knorke-template-note>
			</label>
			<p v-if="error"
				class="knorke-dialog__error"
				role="alert"
				data-knorke-template-error>
				{{ error }}
			</p>
		</div>
		<template #actions>
			<NcButton type="button"
				variant="tertiary"
				:disabled="busy"
				data-knorke-action="template-cancel"
				@click="$emit('close')">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton type="submit"
				variant="primary"
				:disabled="!canSave"
				data-knorke-action="template-save">
				{{ suggest ? t('knorke', 'Suggest') : t('knorke', 'Save') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * Suggesting or saving a template (factory job 182). The draft
 * (BoardSession.templateDraft: content and sketch captured at the click, the
 * board title as the name) and the right of route 28 come as props.
 *
 * right 'suggest' (accounts): [data-knorke-dialog=template-suggest], the
 * name field [data-knorke-template-name] (prefilled, at most 100
 * characters) and the one-line field [data-knorke-template-note] "Note for
 * the admins (optional)" (at most 200); "Cancel" and "Suggest".
 * right 'save' (admins): [data-knorke-dialog=template-save], only the name;
 * "Cancel" and "Save" (the template is adopted at once).
 *
 * The button is disabled while the name is empty (after trimming, like the
 * server's Input::title); Enter sends (NcDialog is-form). Success emits
 * saved with the answer {id, state} (the board view closes the dialog,
 * shows the info template-suggested or template-saved and focuses the
 * canvas). An error stays in the dialog ([data-knorke-template-error]): 409
 * suggestion_limit "You have {max} open suggestions already. …", anything
 * else "The template could not be saved." Cancel and Esc emit close and
 * send nothing.
 *
 * Name and note are text only (v-model, never markup).
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import * as templatesApi from '../api/templates.js'
import { TEMPLATE_MAX_PENDING, TEMPLATE_NAME_MAX, TEMPLATE_NOTE_MAX, cleanName } from '../board/ownTemplates.js'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	/** {scope, content, sketch, name} of BoardSession.templateDraft */
	draft: { type: Object, required: true },
	/** the right of route 28: 'suggest' (accounts) or 'save' (admins) */
	right: { type: String, default: 'suggest' },
})

const emit = defineEmits(['saved', 'close'])

const suggest = computed(() => props.right !== 'save')
const name = ref(String(props.draft?.name ?? ''))
const note = ref('')
const busy = ref(false)
const error = ref('')
const nameEl = ref(null)

const canSave = computed(() => !busy.value && cleanName(name.value) !== '')

/**
 * @param {unknown} e error of route 29
 * @return {string} the text the dialog shows
 */
function saveError(e) {
	if (e instanceof HttpError && e.status === 409 && e.code === 'suggestion_limit') {
		const max = Number.isInteger(e.body?.max) ? e.body.max : TEMPLATE_MAX_PENDING
		return t('knorke', 'You have {max} open suggestions already. Withdraw one or wait for a decision.', { max })
	}
	return t('knorke', 'The template could not be saved.')
}

async function submit() {
	if (!canSave.value) {
		return
	}
	busy.value = true
	error.value = ''
	const body = { name: cleanName(name.value), content: props.draft.content, sketch: props.draft.sketch }
	if (suggest.value) {
		body.note = cleanName(note.value)
	}
	try {
		const res = await templatesApi.createTemplate(body)
		emit('saved', res)
	} catch (e) {
		console.warn('[knorke] template not saved', e)
		error.value = saveError(e)
	} finally {
		busy.value = false
	}
}

onMounted(async () => {
	await nextTick()
	nameEl.value?.focus?.()
})
</script>
