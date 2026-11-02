<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-admin__form" @input="form.serverError.value = null">
		<h3 class="knorke-admin__heading">
			{{ t('knorke', 'Default') }}
		</h3>
		<div class="knorke-admin__block">
			<div class="knorke-admin__field">
				<label :for="fieldId('default', 'text')">{{ t('knorke', 'Default text') }}</label>
				<textarea :id="fieldId('default', 'text')"
					:ref="(el) => setField('default', 'text', el)"
					v-model="defaults.text"
					rows="3"
					:maxlength="form.textMax"
					:placeholder="builtIn"
					:aria-invalid="invalid('default', 'text')"
					:aria-describedby="describedBy('default', 'text')"
					:data-knorke-field="ai ? 'ai-text' : 'privacy-text'"
					data-knorke-lang="default"
					@input="fitHeight($event.target)" />
				<p :id="hintId('default', 'text')" class="knorke-admin__hint">
					{{ t('knorke', 'Empty: Knorke\'s built-in text.') }}
				</p>
			</div>
			<div class="knorke-admin__field">
				<label :for="fieldId('default', 'url')">{{ urlLabel }}</label>
				<input :id="fieldId('default', 'url')"
					:ref="(el) => setField('default', 'url', el)"
					v-model="defaults.url"
					type="url"
					:placeholder="form.themingUrl"
					:aria-invalid="invalid('default', 'url')"
					:aria-describedby="describedBy('default', 'url')"
					:data-knorke-field="ai ? 'ai-url' : 'privacy-url'"
					data-knorke-lang="default">
				<p :id="hintId('default', 'url')" class="knorke-admin__hint">
					{{ ai ? t('knorke', 'Empty: no link.') : t('knorke', 'Empty: the privacy policy URL from the Theming settings.') }}
				</p>
			</div>
			<p v-if="errorAt('default')"
				:id="errorId('default')"
				class="knorke-admin__error"
				:data-knorke-error="errorAt('default').code">
				<NcIconSvgWrapper :path="icons.close" :size="16" inline />
				{{ errorAt('default').text }}
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
					rows="3"
					:maxlength="form.textMax"
					:aria-invalid="invalid(e.code, 'text')"
					:aria-describedby="describedBy(e.code, 'text')"
					:data-knorke-field="ai ? 'ai-text' : 'privacy-text'"
					:data-knorke-lang="e.code"
					@input="fitHeight($event.target)" />
				<p :id="hintId(e.code, 'text')" class="knorke-admin__hint">
					{{ t('knorke', 'Empty: the default is used.') }}
				</p>
			</div>
			<div class="knorke-admin__field">
				<label :for="fieldId(e.code, 'url')">{{ urlLabel }}</label>
				<input :id="fieldId(e.code, 'url')"
					:ref="(el) => setField(e.code, 'url', el)"
					v-model="e.url"
					type="url"
					:aria-invalid="invalid(e.code, 'url')"
					:aria-describedby="describedBy(e.code, 'url')"
					:data-knorke-field="ai ? 'ai-url' : 'privacy-url'"
					:data-knorke-lang="e.code">
				<p :id="hintId(e.code, 'url')" class="knorke-admin__hint">
					{{ t('knorke', 'Empty: the default is used.') }}
				</p>
			</div>
			<p v-if="errorAt(e.code)"
				:id="errorId(e.code)"
				class="knorke-admin__error"
				:data-knorke-error="errorAt(e.code).code">
				<NcIconSvgWrapper :path="icons.close" :size="16" inline />
				{{ errorAt(e.code).text }}
			</p>
			<NcButton variant="tertiary"
				:data-knorke-lang="e.code"
				:data-knorke-action="ai ? 'ai-remove-language' : 'privacy-remove-language'"
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
					:aria-invalid="errorAt('language') ? 'true' : null"
					:aria-describedby="errorAt('language') ? errorId('language') : null"
					:data-knorke-field="ai ? 'ai-language' : 'privacy-language'">
					<option value="">
						{{ t('knorke', 'Choose a language') }}
					</option>
					<option v-for="l in free" :key="l.code" :value="l.code">
						{{ labelOf(l.code) }}
					</option>
				</select>
			</div>
			<NcButton :disabled="pick === '' || entries.length >= form.languagesMax"
				:data-knorke-action="ai ? 'ai-add-language' : 'privacy-add-language'"
				@click="add">
				{{ t('knorke', 'Add language') }}
			</NcButton>
			<p v-if="errorAt('language')"
				:id="errorId('language')"
				class="knorke-admin__error"
				:data-knorke-error="errorAt('language').code">
				<NcIconSvgWrapper :path="icons.close" :size="16" inline />
				{{ errorAt('language').text }}
			</p>
		</div>
	</div>
</template>

<script setup>
/*
 * The fields of one notice form of the admin page (factory job 281; before
 * part of AdminSettings.vue, M2 and job 267): the default text and address,
 * one fieldset per language ("Name (code)", text, address, "Remove
 * {language}") and a native <select> of the languages not used yet with
 * "Add language" (disabled without a choice and at languagesMax entries).
 * The state is the form of noticeForm.js; saving is the page's save bar.
 *
 * An error (the browser's address check or a 400 of the save) stands under
 * its block with an icon; its field carries aria-invalid and names it in
 * aria-describedby. Text fields grow with their text (fitHeight); the page
 * calls fitAll when the section opens and after a discard or a save.
 * Plain text, never HTML.
 */
import { nextTick, onMounted } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { aiNoticeText, builtInText } from '../components/privacy.js'
import { icons } from '../components/icons.js'
import { t } from '../util/l10n.js'
import { fitHeight } from './noticeForm.js'

const props = defineProps({
	/** the form of noticeForm.js createNoticeForm */
	form: { type: Object, required: true },
})

const form = props.form
const ai = form.kind === 'ai'
const { defaults, entries, pick, free } = form
const builtIn = ai ? aiNoticeText() : builtInText()
const urlLabel = ai ? t('knorke', 'Link') : t('knorke', 'Privacy policy URL')
/** Field elements by "<at>:<field>" (focus after an error, fitting the text fields). */
const fields = new Map()

/**
 * @param {string} code language code
 * @return {string} its name in Nextcloud's list, else the code
 */
function nameOf(code) {
	return form.names.get(code) ?? code
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
	return 'knorke-' + form.kind + '-' + at + '-' + field
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
	return 'knorke-' + form.kind + '-' + at + '-error'
}

/**
 * @param {string} at block
 * @return {object|undefined} the first open error of that block
 */
function errorAt(at) {
	return form.errors.value.find((e) => e.at === at)
}

/**
 * @param {string} at block
 * @param {string} field field
 * @return {string|null} 'true' on a field the shown error of its block points to
 */
function invalid(at, field) {
	return errorAt(at)?.field === field ? 'true' : null
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

/** Fits every text field to its text (after the DOM caught up). */
function fitAll() {
	nextTick(() => {
		for (const [key, el] of fields) {
			if (key.endsWith(':text')) {
				fitHeight(el)
			}
		}
	})
}

function add() {
	const code = pick.value
	if (form.add()) {
		focusField(code, 'text')
		fitAll()
	}
}

/** @param {string} code language code */
function remove(code) {
	form.remove(code)
	focusField('language', 'pick')
}

onMounted(fitAll)

defineExpose({ focusField, fitAll })
</script>
