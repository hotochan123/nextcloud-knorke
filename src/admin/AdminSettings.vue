<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="section knorke-admin" data-knorke-admin="privacy">
		<h2>{{ t('knorke', 'Privacy notice') }}</h2>
		<p class="knorke-admin__intro">
			{{ t('knorke', 'Guests who join a board through a link see this notice in the name dialog. Signed-in people see it on boards that are open by link. Plain text; line breaks are kept.') }}
		</p>
		<form class="knorke-admin__form"
			novalidate
			@input="status = ''"
			@submit.prevent="save">
			<h3 class="knorke-admin__heading">
				{{ t('knorke', 'Default') }}
			</h3>
			<div class="knorke-admin__block">
				<div class="knorke-admin__field">
					<label :for="fieldId('default', 'text')">{{ t('knorke', 'Default text') }}</label>
					<textarea :id="fieldId('default', 'text')"
						:ref="(el) => setField('default', 'text', el)"
						v-model="defaults.text"
						rows="5"
						:maxlength="textMax"
						:placeholder="builtIn"
						:aria-invalid="invalid('default', 'text')"
						:aria-describedby="describedBy('default', 'text')"
						data-knorke-field="privacy-text"
						data-knorke-lang="default" />
					<p :id="hintId('default', 'text')" class="knorke-admin__hint">
						{{ hintBuiltIn }}
					</p>
				</div>
				<div class="knorke-admin__field">
					<label :for="fieldId('default', 'url')">{{ t('knorke', 'Privacy policy URL') }}</label>
					<input :id="fieldId('default', 'url')"
						:ref="(el) => setField('default', 'url', el)"
						v-model="defaults.url"
						type="url"
						:placeholder="themingUrl"
						:aria-invalid="invalid('default', 'url')"
						:aria-describedby="describedBy('default', 'url')"
						data-knorke-field="privacy-url"
						data-knorke-lang="default">
					<p :id="hintId('default', 'url')" class="knorke-admin__hint">
						{{ t('knorke', 'Empty: the privacy policy URL from the Theming settings.') }}
					</p>
				</div>
				<p v-if="error && error.at === 'default'"
					:id="errorId('default')"
					class="knorke-admin__error"
					:data-knorke-error="error.code">
					{{ error.text }}
				</p>
			</div>

			<h3 class="knorke-admin__heading">
				{{ t('knorke', 'Texts per language') }}
			</h3>
			<fieldset v-for="e in entries"
				:key="e.code"
				class="knorke-admin__block knorke-admin__lang"
				:data-knorke-lang="e.code">
				<legend>{{ labelOf(e.code) }}</legend>
				<div class="knorke-admin__field">
					<label :for="fieldId(e.code, 'text')">{{ t('knorke', 'Text') }}</label>
					<textarea :id="fieldId(e.code, 'text')"
						:ref="(el) => setField(e.code, 'text', el)"
						v-model="e.text"
						rows="4"
						:maxlength="textMax"
						:aria-invalid="invalid(e.code, 'text')"
						:aria-describedby="describedBy(e.code, 'text')"
						data-knorke-field="privacy-text"
						:data-knorke-lang="e.code" />
					<p :id="hintId(e.code, 'text')" class="knorke-admin__hint">
						{{ t('knorke', 'Empty: the default is used.') }}
					</p>
				</div>
				<div class="knorke-admin__field">
					<label :for="fieldId(e.code, 'url')">{{ t('knorke', 'Privacy policy URL') }}</label>
					<input :id="fieldId(e.code, 'url')"
						:ref="(el) => setField(e.code, 'url', el)"
						v-model="e.url"
						type="url"
						:aria-invalid="invalid(e.code, 'url')"
						:aria-describedby="describedBy(e.code, 'url')"
						data-knorke-field="privacy-url"
						:data-knorke-lang="e.code">
					<p :id="hintId(e.code, 'url')" class="knorke-admin__hint">
						{{ t('knorke', 'Empty: the default is used.') }}
					</p>
				</div>
				<p v-if="error && error.at === e.code"
					:id="errorId(e.code)"
					class="knorke-admin__error"
					:data-knorke-error="error.code">
					{{ error.text }}
				</p>
				<NcButton variant="tertiary"
					:data-knorke-lang="e.code"
					data-knorke-action="privacy-remove-language"
					@click="remove(e.code)">
					{{ t('knorke', 'Remove {language}', { language: nameOf(e.code) }) }}
				</NcButton>
			</fieldset>

			<div class="knorke-admin__add">
				<div class="knorke-admin__field">
					<label :for="fieldId('language', 'pick')">{{ t('knorke', 'Language') }}</label>
					<select :id="fieldId('language', 'pick')"
						:ref="(el) => setField('language', 'pick', el)"
						v-model="pick"
						:aria-invalid="error && error.at === 'language' ? 'true' : null"
						:aria-describedby="error && error.at === 'language' ? errorId('language') : null"
						data-knorke-field="privacy-language">
						<option value="">
							{{ t('knorke', 'Choose a language') }}
						</option>
						<option v-for="l in free" :key="l.code" :value="l.code">
							{{ labelOf(l.code) }}
						</option>
					</select>
				</div>
				<NcButton :disabled="pick === '' || entries.length >= languagesMax"
					data-knorke-action="privacy-add-language"
					@click="add">
					{{ t('knorke', 'Add language') }}
				</NcButton>
				<p v-if="error && error.at === 'language'"
					:id="errorId('language')"
					class="knorke-admin__error"
					:data-knorke-error="error.code">
					{{ error.text }}
				</p>
			</div>

			<div class="knorke-admin__actions">
				<NcButton type="submit"
					variant="primary"
					:disabled="busy"
					data-knorke-action="privacy-save">
					{{ t('knorke', 'Save') }}
				</NcButton>
				<p class="knorke-admin__status" role="status" data-knorke-admin-status>
					{{ status }}
				</p>
			</div>
			<p v-if="failure" class="knorke-admin__error" role="alert" data-knorke-error="save">
				{{ failure }}
			</p>
		</form>
	</div>
</template>

<script setup>
/*
 * The admin section "Knorke" (M2 privacy notice, page 'admin'): the notice
 * text and the privacy policy URL as a default and per language, from the
 * initial state `privacyAdmin` {settings, languages, themingUrl, textMax,
 * languagesMax}.
 *
 * - Default: text (placeholder = the built-in text) and URL (placeholder =
 *   theming's privacy policy URL when set).
 * - Texts per language: one fieldset per entry, legend "Name (code)", text,
 *   URL and "Remove {language}"; below a native <select> of the languages
 *   not yet used and "Add language" (disabled without a choice and at
 *   languagesMax entries).
 * - Save (no automatic saving) sends the whole form to route 27
 *   (api/boards.js savePrivacy). 200: the form takes the normalised answer,
 *   the status line says "Saved.". 400: the text of the code stands at the
 *   field of `at` (aria-invalid, aria-describedby) and that field gets the
 *   focus. Anything else: a general message (role alert). "Saved." goes
 *   with the next change (typing, adding or removing a language), so it
 *   never stands next to unsaved edits.
 *
 * Plain text, never HTML: the admin's texts only go through v-model and
 * interpolation. Admin texts are not translated.
 */
import { computed, inject, nextTick, reactive, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import { savePrivacy } from '../api/boards.js'
import { builtInText } from '../components/privacy.js'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	/** the page's initial state (tests); the app provides it as 'knorke-state' */
	state: { type: Object, default: null },
})

const state = props.state ?? inject('knorke-state', {})
const admin = state.privacyAdmin && typeof state.privacyAdmin === 'object' ? state.privacyAdmin : {}
const textMax = Number.isInteger(admin.textMax) && admin.textMax > 0 ? admin.textMax : 2000
const languagesMax = Number.isInteger(admin.languagesMax) && admin.languagesMax > 0 ? admin.languagesMax : 20
const themingUrl = typeof admin.themingUrl === 'string' ? admin.themingUrl : ''
/** Nextcloud's languages in Nextcloud's order (common ones first). */
const languages = (Array.isArray(admin.languages) ? admin.languages : [])
	.filter((l) => l && typeof l.code === 'string' && l.code !== '')
	.map((l) => ({ code: l.code, name: typeof l.name === 'string' && l.name !== '' ? l.name : l.code }))
const names = new Map(languages.map((l) => [l.code, l.name]))
const builtIn = builtInText()
const hintBuiltIn = t('knorke', 'Empty: Knorke\'s built-in text.')

const defaults = reactive({ text: '', url: '' })
/** @type {import('vue').Ref<Array<{code: string, text: string, url: string}>>} */
const entries = ref([])
const pick = ref('')
const busy = ref(false)
const status = ref('')
const failure = ref('')
/** The field error of the last save: {at: 'default'|code|'language', field: 'text'|'url'|'pick', code, text}. */
const error = ref(null)
/** Field elements by "<at>:<field>" (focus after a 400). */
const fields = new Map()

const free = computed(() => languages.filter((l) => !entries.value.some((e) => e.code === l.code)))

/**
 * @param {unknown} settings the normalised form {default: {text, url}, languages: {<code>: {text, url}}}
 */
function load(settings) {
	const s = settings && typeof settings === 'object' ? settings : {}
	defaults.text = typeof s.default?.text === 'string' ? s.default.text : ''
	defaults.url = typeof s.default?.url === 'string' ? s.default.url : ''
	const langs = s.languages && typeof s.languages === 'object' && !Array.isArray(s.languages) ? s.languages : {}
	entries.value = Object.entries(langs).map(([code, e]) => ({
		code,
		text: typeof e?.text === 'string' ? e.text : '',
		url: typeof e?.url === 'string' ? e.url : '',
	}))
}

load(admin.settings)

/**
 * @param {string} code language code
 * @return {string} its name in Nextcloud's list, else the code
 */
function nameOf(code) {
	return names.get(code) ?? code
}

/**
 * @param {string} code language code
 * @return {string} "Name (code)"
 */
function labelOf(code) {
	return nameOf(code) + ' (' + code + ')'
}

/**
 * @param {string} at 'default', a language code or 'language'
 * @param {string} field 'text' | 'url' | 'pick'
 * @return {string} element id
 */
function fieldId(at, field) {
	return 'knorke-privacy-' + at + '-' + field
}

/**
 * @param {string} at 'default' or a language code
 * @param {string} field 'text' | 'url'
 * @return {string} id of the field's hint
 */
function hintId(at, field) {
	return fieldId(at, field) + '-hint'
}

/**
 * @param {string} at 'default', a language code or 'language'
 * @return {string} id of the error text of that block
 */
function errorId(at) {
	return 'knorke-privacy-' + at + '-error'
}

/**
 * @param {string} at block
 * @param {string} field field
 * @return {string|null} 'true' on the field the last error points to
 */
function invalid(at, field) {
	return error.value && error.value.at === at && error.value.field === field ? 'true' : null
}

/**
 * @param {string} at block
 * @param {string} field field
 * @return {string} hint id, plus the error id on the invalid field
 */
function describedBy(at, field) {
	return invalid(at, field) ? hintId(at, field) + ' ' + errorId(at) : hintId(at, field)
}

/**
 * @param {string} at block
 * @param {string} field field
 * @param {Element|null} el element (null on unmount)
 */
function setField(at, field, el) {
	if (el) {
		fields.set(at + ':' + field, el)
	} else {
		fields.delete(at + ':' + field)
	}
}

/**
 * @param {string} at block
 * @param {string} field field
 */
function focusField(at, field) {
	nextTick(() => fields.get(at + ':' + field)?.focus?.())
}

function add() {
	const code = pick.value
	if (code === '' || entries.value.length >= languagesMax || entries.value.some((e) => e.code === code)) {
		return
	}
	entries.value.push({ code, text: '', url: '' })
	pick.value = ''
	status.value = ''
	focusField(code, 'text')
}

/** @param {string} code language code */
function remove(code) {
	entries.value = entries.value.filter((e) => e.code !== code)
	status.value = ''
	if (error.value?.at === code) {
		error.value = null
	}
	focusField('language', 'pick')
}

/** Longest privacy policy URL the server accepts (PublicPageController::httpUrl, bytes). */
const URL_MAX_BYTES = 2048

/**
 * @param {string} at 'default' or a language code
 * @return {boolean} the URL of that block is longer than URL_MAX_BYTES
 */
function urlTooLong(at) {
	const url = at === 'default' ? defaults.url : (entries.value.find((x) => x.code === at)?.url ?? '')
	return new TextEncoder().encode(String(url).trim()).length > URL_MAX_BYTES
}

/**
 * The text of a 400 at its field (the code's own text, `at` from the body).
 *
 * @param {unknown} e error of the save
 * @return {object|null} the field error, null when the error has no field
 */
function fieldError(e) {
	if (!(e instanceof HttpError) || e.status !== 400) {
		return null
	}
	const at = typeof e.body?.at === 'string' ? e.body.at : null
	const max = Number.isInteger(e.body?.max) ? e.body.max : null
	const known = at === 'default' || entries.value.some((x) => x.code === at)
	switch (e.code) {
	case 'text_too_long':
		return known ? { at, field: 'text', code: e.code, text: t('knorke', 'At most {max} characters.', { max: max ?? textMax }) } : null
	case 'invalid_url':
		if (!known) {
			return null
		}
		// the server refuses an address over URL_MAX_BYTES with the same code: say why
		return urlTooLong(at)
			? { at, field: 'url', code: e.code, text: t('knorke', 'At most {max} characters.', { max: URL_MAX_BYTES }) }
			: { at, field: 'url', code: e.code, text: t('knorke', 'Enter an address starting with http:// or https://.') }
	case 'unknown_language':
		return known ? { at, field: 'text', code: e.code, text: t('knorke', 'This language is not available on this Nextcloud.') } : null
	case 'too_many_languages':
		return { at: 'language', field: 'pick', code: e.code, text: t('knorke', 'At most {max} languages.', { max: max ?? languagesMax }) }
	default:
		return null
	}
}

async function save() {
	if (busy.value) {
		return
	}
	busy.value = true
	status.value = ''
	failure.value = ''
	error.value = null
	const body = { default: { text: defaults.text, url: defaults.url }, languages: {} }
	for (const e of entries.value) {
		body.languages[e.code] = { text: e.text, url: e.url }
	}
	try {
		load(await savePrivacy(body))
		status.value = t('knorke', 'Saved.')
	} catch (e) {
		const fe = fieldError(e)
		if (fe) {
			error.value = fe
			focusField(fe.at, fe.field)
		} else {
			failure.value = t('knorke', 'The settings could not be saved.')
		}
	} finally {
		busy.value = false
	}
}
</script>
