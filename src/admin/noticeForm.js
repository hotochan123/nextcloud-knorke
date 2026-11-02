/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The state of one notice form of the admin page (factory job 281, design
 * A3): the privacy notice (route 27) or the AI notice before the first use
 * (route 58 `notice`), the same fields and checks (before: AdminSettings.vue
 * kind privacy / ai, jobs 182 and 267).
 *
 * createNoticeForm(admin, kind) takes the admin state of the notice
 * {settings, languages, themingUrl, textMax, languagesMax} and keeps:
 * - defaults {text, url}, entries [{code, text, url}], pick (the language to
 *   add), free (the languages not used yet);
 * - saved: the last loaded or saved settings; dirty: the form differs;
 * - errors: the address checks in the browser (urlProblem, at every URL
 *   field) plus the field error of the last save (`serverError`, a 400 of
 *   the server, cleared with the next input or language change);
 * - add, remove, discard, load, body, takeError (a 400 → its field error).
 * Plain text only: the texts go through v-model and interpolation.
 */
import { computed, reactive, ref } from 'vue'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'

/** Longest privacy policy URL the server accepts (PublicPageController::httpUrl, bytes). */
export const URL_MAX_BYTES = 2048

/**
 * The address check of the browser, as PublicPageController::httpUrl:
 * empty is fine; else http(s)://host without white space or control
 * characters, at most URL_MAX_BYTES bytes.
 *
 * @param {unknown} url the field's value
 * @return {null|'invalid_url'|'too_long'} the problem, null when there is none
 */
export function urlProblem(url) {
	const s = String(url ?? '').trim()
	if (s === '') {
		return null
	}
	if (new TextEncoder().encode(s).length > URL_MAX_BYTES) {
		return 'too_long'
	}
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x20\x7F]/.test(s) || !/^https?:\/\/[^\s/?#]+/i.test(s)) {
		return 'invalid_url'
	}
	return null
}

/**
 * @param {string} problem a result of urlProblem
 * @return {string} its text at the field
 */
function urlText(problem) {
	return problem === 'too_long'
		? t('knorke', 'At most {max} characters.', { max: URL_MAX_BYTES })
		: t('knorke', 'Enter an address starting with http:// or https://.')
}

/**
 * @param {unknown} settings the normalised form {default: {text, url}, languages: {<code>: {text, url}}}
 * @return {{text: string, url: string, entries: Array<{code: string, text: string, url: string}>}} its values
 */
function valuesOf(settings) {
	const s = settings && typeof settings === 'object' ? settings : {}
	const langs = s.languages && typeof s.languages === 'object' && !Array.isArray(s.languages) ? s.languages : {}
	return {
		text: typeof s.default?.text === 'string' ? s.default.text : '',
		url: typeof s.default?.url === 'string' ? s.default.url : '',
		entries: Object.entries(langs).map(([code, e]) => ({
			code,
			text: typeof e?.text === 'string' ? e.text : '',
			url: typeof e?.url === 'string' ? e.url : '',
		})),
	}
}

/**
 * @param {object} admin the notice's admin state
 * @param {'privacy'|'ai'} kind which notice (hooks and ids knorke-<kind>-…)
 * @return {object} the form
 */
export function createNoticeForm(admin, kind) {
	const a = admin && typeof admin === 'object' ? admin : {}
	const textMax = Number.isInteger(a.textMax) && a.textMax > 0 ? a.textMax : 2000
	const languagesMax = Number.isInteger(a.languagesMax) && a.languagesMax > 0 ? a.languagesMax : 20
	const themingUrl = typeof a.themingUrl === 'string' ? a.themingUrl : ''
	/** Nextcloud's languages in Nextcloud's order (common ones first). */
	const languages = (Array.isArray(a.languages) ? a.languages : [])
		.filter((l) => l && typeof l.code === 'string' && l.code !== '')
		.map((l) => ({ code: l.code, name: typeof l.name === 'string' && l.name !== '' ? l.name : l.code }))
	const names = new Map(languages.map((l) => [l.code, l.name]))

	const defaults = reactive({ text: '', url: '' })
	/** @type {import('vue').Ref<Array<{code: string, text: string, url: string}>>} */
	const entries = ref([])
	const pick = ref('')
	/** the field error of the last save: {at: 'default'|code|'language', field: 'text'|'url'|'pick', code, text} */
	const serverError = ref(null)
	/** the last loaded or saved settings */
	const saved = ref(null)

	const free = computed(() => languages.filter((l) => !entries.value.some((e) => e.code === l.code)))

	/** @return {object} the request body (route 27, or route 58 notice) */
	function body() {
		const b = { default: { text: defaults.text, url: defaults.url }, languages: {} }
		for (const e of entries.value) {
			b.languages[e.code] = { text: e.text, url: e.url }
		}
		return b
	}

	const savedKey = computed(() => {
		const v = valuesOf(saved.value)
		return JSON.stringify({ default: { text: v.text, url: v.url }, languages: Object.fromEntries(v.entries.map((e) => [e.code, { text: e.text, url: e.url }])) })
	})
	const dirty = computed(() => JSON.stringify(body()) !== savedKey.value)

	/** The browser's address checks, one per URL field with a problem. */
	const clientErrors = computed(() => {
		const out = []
		for (const [at, url] of [['default', defaults.url], ...entries.value.map((e) => [e.code, e.url])]) {
			const p = urlProblem(url)
			if (p !== null) {
				out.push({ at, field: 'url', code: 'invalid_url', text: urlText(p) })
			}
		}
		return out
	})
	/** Every open error: the browser's, then the server's (unless it names the same field). */
	const errors = computed(() => {
		const se = serverError.value
		const list = clientErrors.value
		return se && !list.some((e) => e.at === se.at && e.field === se.field) ? [...list, se] : list
	})

	/** @param {unknown} settings the normalised form; it becomes the saved state */
	function load(settings) {
		const v = valuesOf(settings)
		defaults.text = v.text
		defaults.url = v.url
		entries.value = v.entries
		saved.value = settings && typeof settings === 'object' ? settings : null
	}

	load(a.settings)

	/** Back to the saved state. */
	function discard() {
		load(saved.value)
		pick.value = ''
		serverError.value = null
	}

	/** @return {boolean} a language was added */
	function add() {
		const code = pick.value
		if (code === '' || entries.value.length >= languagesMax || entries.value.some((e) => e.code === code)) {
			return false
		}
		entries.value.push({ code, text: '', url: '' })
		pick.value = ''
		if (serverError.value?.at === 'language') {
			serverError.value = null
		}
		return true
	}

	/** @param {string} code language code */
	function remove(code) {
		entries.value = entries.value.filter((e) => e.code !== code)
		if (serverError.value?.at === code || serverError.value?.at === 'language') {
			serverError.value = null
		}
	}

	/**
	 * A 400 of the save as the field error at its field (the code's own text, `at` from the body).
	 *
	 * @param {unknown} e error of the save
	 * @return {object|null} the field error (also kept in serverError), null when the error has no field
	 */
	function takeError(e) {
		if (!(e instanceof HttpError) || e.status !== 400) {
			return null
		}
		const at = typeof e.body?.at === 'string' ? e.body.at : null
		const max = Number.isInteger(e.body?.max) ? e.body.max : null
		const known = at === 'default' || entries.value.some((x) => x.code === at)
		let fe = null
		switch (e.code) {
		case 'text_too_long':
			fe = known ? { at, field: 'text', code: e.code, text: t('knorke', 'At most {max} characters.', { max: max ?? textMax }) } : null
			break
		case 'invalid_url':
			if (known) {
				const url = at === 'default' ? defaults.url : (entries.value.find((x) => x.code === at)?.url ?? '')
				// the server refuses an address over URL_MAX_BYTES with the same code: say why
				fe = { at, field: 'url', code: e.code, text: urlText(urlProblem(url) === 'too_long' ? 'too_long' : 'invalid_url') }
			}
			break
		case 'unknown_language':
			fe = known ? { at, field: 'text', code: e.code, text: t('knorke', 'This language is not available on this Nextcloud.') } : null
			break
		case 'too_many_languages':
			fe = { at: 'language', field: 'pick', code: e.code, text: t('knorke', 'At most {max} languages.', { max: max ?? languagesMax }) }
			break
		}
		serverError.value = fe
		return fe
	}

	return {
		kind,
		textMax,
		languagesMax,
		themingUrl,
		languages,
		names,
		defaults,
		entries,
		pick,
		free,
		saved,
		serverError,
		errors,
		dirty,
		body,
		load,
		discard,
		add,
		remove,
		takeError,
	}
}

/**
 * Lets a textarea show its whole text: its height becomes the height of
 * its content (plus its borders). A hidden field (a closed section) has no
 * box and keeps its height; it is fitted when its section opens.
 *
 * @param {HTMLTextAreaElement|null} el the field
 * @return {boolean} the height was set
 */
export function fitHeight(el) {
	if (!el || !el.style || typeof el.getClientRects !== 'function' || el.getClientRects().length === 0) {
		return false
	}
	el.style.height = 'auto'
	el.style.height = (el.scrollHeight + Math.max(0, el.offsetHeight - el.clientHeight)) + 'px'
	return true
}
