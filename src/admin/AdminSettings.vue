<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="pageEl" class="section knorke-admin knorke-admin-page" data-knorke-admin-page>
		<p v-if="waiting > 0" class="knorke-admin__notice" data-knorke-admin-notice>
			<NcIconSvgWrapper :path="icons.team" :size="20" inline />
			<span>{{ n('knorke', '%n suggestion is waiting for you', '%n suggestions are waiting for you', waiting) }}</span>
		</p>

		<AdminSection id="templates"
			:title="t('knorke', 'Templates')"
			:summary="open.templates ? t('knorke', 'Accounts suggest templates here. What you adopt, everyone can insert.') : listSummary(lists.templates, t('knorke', 'The templates could not be loaded.'))"
			:icon="icons.board"
			:count="lists.templates.suggestions"
			:open="open.templates"
			@toggle="toggle('templates')">
			<TemplateAdmin @lists="(s) => (lists.templates = s)" />
		</AdminSection>

		<AdminSection id="shapelibs"
			:title="t('knorke', 'Shape libraries')"
			:summary="open.shapelibs ? t('knorke', 'Accounts suggest their shape libraries here. What you adopt, everyone finds in the Shapes panel.') : listSummary(lists.shapelibs, t('knorke', 'The shape libraries could not be loaded.'))"
			:icon="icons.shape"
			:count="lists.shapelibs.suggestions"
			:open="open.shapelibs"
			@toggle="toggle('shapelibs')">
			<ShapeLibAdmin @lists="(s) => (lists.shapelibs = s)" />
		</AdminSection>

		<AdminSection id="ai"
			:title="t('knorke', 'AI')"
			:summary="open.ai ? t('knorke', 'Signed-in people with the right to edit can summarise notes and cluster them by topic with the AI provider set up in Nextcloud (Artificial intelligence settings). Guests never can.') : aiLine"
			:icon="icons.sparkle"
			:open="open.ai"
			@toggle="toggle('ai')">
			<div class="knorke-admin__ai" data-knorke-admin="ai" @input="aiForm.serverError.value = null">
				<p v-if="!aiProvider" class="knorke-admin__hint" data-knorke-ai-provider="none">
					{{ t('knorke', 'No AI provider for text is set up in Nextcloud yet: Knorke shows no AI buttons.') }}
				</p>
				<label class="knorke-admin__check">
					<input v-model="aiEnabled" type="checkbox" data-knorke-field="ai-enabled">
					<span>{{ t('knorke', 'Allow AI in Knorke') }}</span>
				</label>
				<div class="knorke-admin__field">
					<label for="knorke-ai-limit">{{ t('knorke', 'AI tasks per account and day') }}</label>
					<input id="knorke-ai-limit"
						v-model.number="aiLimit"
						type="number"
						min="0"
						:max="aiLimitMax"
						step="1"
						:aria-invalid="limitError ? 'true' : null"
						:aria-describedby="limitError ? 'knorke-ai-limit-error' : null"
						data-knorke-field="ai-limit">
					<p v-if="limitError"
						id="knorke-ai-limit-error"
						class="knorke-admin__error"
						data-knorke-error="ai-limit">
						<NcIconSvgWrapper :path="icons.close" :size="16" inline />
						{{ limitError.text }}
					</p>
				</div>
				<h3 class="knorke-admin__heading">
					{{ t('knorke', 'Notice before the first use') }}
				</h3>
				<NoticeFields ref="aiFields" :form="aiForm" />
			</div>
		</AdminSection>

		<AdminSection id="privacy"
			:title="t('knorke', 'Privacy notice')"
			:summary="open.privacy ? t('knorke', 'Guests who join a board through a link see this notice in the name dialog. Signed-in people see it on boards that are open by link. Plain text; line breaks are kept.') : privacyLine"
			:icon="icons.legal"
			:open="open.privacy"
			@toggle="toggle('privacy')">
			<div data-knorke-admin="privacy">
				<NoticeFields ref="privacyFields" :form="privacyForm" />
			</div>
		</AdminSection>

		<div v-if="dirty" ref="barEl" class="knorke-admin__savebar" data-knorke-admin-savebar>
			<p class="knorke-admin__savebar-text"
				:class="{ 'knorke-admin__savebar-text--error': errorCount > 0 }"
				data-knorke-admin-savebar-text>
				<NcIconSvgWrapper v-if="errorCount > 0" :path="icons.close" :size="16" inline />
				{{ barLine }}
			</p>
			<p v-if="failure" class="knorke-admin__error" role="alert" data-knorke-error="save">
				{{ failure }}
			</p>
			<div class="knorke-admin__savebar-actions">
				<NcButton variant="tertiary"
					:disabled="busy"
					data-knorke-action="admin-discard"
					@click="discard">
					{{ t('knorke', 'Discard') }}
				</NcButton>
				<NcButton variant="primary"
					:disabled="busy || errorCount > 0"
					data-knorke-action="admin-save"
					@click="save">
					{{ t('knorke', 'Save') }}
				</NcButton>
			</div>
		</div>
		<p class="knorke-admin__status" role="status" data-knorke-admin-status>
			{{ status }}
		</p>
	</div>
</template>

<script setup>
/*
 * The admin section "Knorke" (page 'admin'), factory job 281 (design A3 of
 * redesign round 5): one column [data-knorke-admin-page] of collapsible
 * sections (AdminSection.vue), at most 760 px wide:
 * - the notice [data-knorke-admin-notice] "n suggestions are waiting for
 *   you" while the two lists hold open suggestions;
 * - Templates (TemplateAdmin.vue, job 182) and Shape libraries
 *   (ShapeLibAdmin.vue, job 203), each with a counter pill; they report
 *   their load state and counts with the event `lists`;
 * - AI (job 267, from privacyAdmin.ai): "Allow AI in Knorke", the AI tasks
 *   per account and day and the notice before the first use;
 * - Privacy notice (M2, from privacyAdmin): default and texts per language.
 * Once both lists have loaded, the first list section with open suggestions
 * and every list that failed open (adminPage.js initialOpen); all others
 * stay closed. A closed section says in one line how it is set.
 *
 * One save bar [data-knorke-admin-savebar] at the end, only while the AI or
 * the privacy part differs from its saved state: "Unsaved changes" (or the
 * errors per section), "Discard" and "Save" (blocked while an error is
 * open: an address the browser refuses, a daily limit outside 0…limitMax,
 * or the field error of the last save). Save sends route 58 (enabled,
 * dailyLimit and notice in one request) when the AI part changed, then
 * route 27 when the privacy part changed; each answer becomes that part's
 * saved state. A 400 stands at its field, opens its section and focuses
 * the field; the rest is not sent. Any other error: "The settings could
 * not be saved." (role alert). Done: "Saved." in [data-knorke-admin-status]
 * until the next change. While the bar shows, the page's scrolling element
 * keeps a bottom scroll padding of its height (adminPage.js padForBar), so
 * the caret of a growing text field never ends up behind the sticky bar.
 *
 * Plain text, never HTML: the admin's texts only go through v-model and
 * interpolation. Admin texts are not translated.
 */
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { saveAiSettings } from '../api/ai.js'
import { savePrivacy } from '../api/boards.js'
import { icons } from '../components/icons.js'
import { n, t } from '../util/l10n.js'
import AdminSection from './AdminSection.vue'
import { aiSummary, barText, initialOpen, listSummary, ownText, padForBar, privacySummary, scrollParent } from './adminPage.js'
import { createNoticeForm } from './noticeForm.js'
import NoticeFields from './NoticeFields.vue'
import ShapeLibAdmin from './ShapeLibAdmin.vue'
import TemplateAdmin from './TemplateAdmin.vue'

const props = defineProps({
	/** the page's initial state (tests); the app provides it as 'knorke-state' */
	state: { type: Object, default: null },
})

const state = props.state ?? inject('knorke-state', {})
const privacyAdmin = state.privacyAdmin && typeof state.privacyAdmin === 'object' ? state.privacyAdmin : {}
/** (job 267) the AI settings: privacyAdmin.ai (AiService::adminState) */
const aiAdmin = privacyAdmin.ai && typeof privacyAdmin.ai === 'object' ? privacyAdmin.ai : {}

const privacyForm = createNoticeForm(privacyAdmin, 'privacy')
const aiForm = createNoticeForm(aiAdmin.notice, 'ai')
const aiLimitMax = Number.isInteger(aiAdmin.limitMax) && aiAdmin.limitMax > 0 ? aiAdmin.limitMax : 1000
const aiProvider = aiAdmin.provider !== false
const aiEnabled = ref(aiAdmin.enabled !== false)
const aiLimit = ref(Number.isInteger(aiAdmin.dailyLimit) ? aiAdmin.dailyLimit : 30)
/** the saved switch and daily limit */
const aiSaved = ref({ enabled: aiEnabled.value, limit: aiLimit.value })

/** the sections' open state */
const open = reactive({ templates: false, shapelibs: false, ai: false, privacy: false })
/** the two lists' load state and counts (event `lists` of TemplateAdmin and ShapeLibAdmin) */
const lists = reactive({
	templates: { state: 'loading', suggestions: 0, adopted: 0 },
	shapelibs: { state: 'loading', suggestions: 0, adopted: 0 },
})
let opened = false
const aiFields = ref(null)
const privacyFields = ref(null)
const busy = ref(false)
const status = ref('')
const failure = ref('')

const waiting = computed(() => lists.templates.suggestions + lists.shapelibs.suggestions)

const limitError = computed(() => {
	const v = aiLimit.value
	return Number.isInteger(v) && v >= 0 && v <= aiLimitMax
		? null
		: { at: 'limit', field: 'limit', code: 'ai-limit', text: t('knorke', 'Enter a whole number from 0 to {max}.', { max: aiLimitMax }) }
})
const aiErrors = computed(() => (limitError.value ? 1 : 0) + aiForm.errors.value.length)
const privacyErrors = computed(() => privacyForm.errors.value.length)
const errorCount = computed(() => aiErrors.value + privacyErrors.value)

const aiDirty = computed(() => aiEnabled.value !== aiSaved.value.enabled || aiLimit.value !== aiSaved.value.limit || aiForm.dirty.value)
const dirty = computed(() => aiDirty.value || privacyForm.dirty.value)
const barLine = computed(() => barText(aiErrors.value, privacyErrors.value))

const aiLine = computed(() => aiSummary({
	provider: aiProvider,
	enabled: aiEnabled.value === true,
	limit: limitError.value ? aiSaved.value.limit : aiLimit.value,
	ownNotice: ownText(aiForm.defaults, aiForm.entries.value),
}))
const privacyLine = computed(() => privacySummary({
	ownText: ownText(privacyForm.defaults, privacyForm.entries.value),
	languages: privacyForm.entries.value.length,
	url: privacyForm.defaults.url,
	themingUrl: privacyForm.themingUrl,
}))

// "Saved." goes with the next change
watch(dirty, (d) => {
	if (d) {
		status.value = ''
	}
})

// round 1: the sticky bar never covers the caret or a focused field (scroll padding of the bar's height)
const pageEl = ref(null)
const barEl = ref(null)
watch(barEl, (bar) => padForBar(scrollParent(pageEl.value), bar), { flush: 'post' })
onBeforeUnmount(() => padForBar(scrollParent(pageEl.value), null))

// once both lists have loaded: open the first with suggestions and every one that failed (never closes one)
watch(() => [lists.templates.state, lists.shapelibs.state], () => {
	const keys = opened ? null : initialOpen(lists)
	if (keys !== null) {
		opened = true
		for (const k of keys) {
			open[k] = true
		}
	}
})

/** @return {Array} the notice fields of the AI and the privacy section */
function noticeFields() {
	return [aiFields.value, privacyFields.value].filter(Boolean)
}

/** @param {string} key section id */
function toggle(key) {
	open[key] = !open[key]
	if (open[key]) {
		for (const f of noticeFields()) {
			f.fitAll?.()
		}
	}
}

/** Everything back to the saved state. */
function discard() {
	aiEnabled.value = aiSaved.value.enabled
	aiLimit.value = aiSaved.value.limit
	aiForm.discard()
	privacyForm.discard()
	failure.value = ''
	for (const f of noticeFields()) {
		f.fitAll?.()
	}
}

/**
 * A failed save of one part: a 400 at its field (section open, focus), else the general alert.
 *
 * @param {'ai'|'privacy'} key the section
 * @param {object} form its notice form
 * @param {unknown} e the error
 */
function failed(key, form, e) {
	const fe = form.takeError(e)
	if (fe) {
		open[key] = true
		const fields = key === 'ai' ? aiFields : privacyFields
		nextTick(() => {
			fields.value?.fitAll?.()
			fields.value?.focusField?.(fe.at, fe.field)
		})
	} else {
		failure.value = t('knorke', 'The settings could not be saved.')
	}
}

/** The save bar's Save: route 58 when the AI part changed, then route 27 when the privacy part changed. */
async function save() {
	if (busy.value || errorCount.value > 0 || !dirty.value) {
		return
	}
	busy.value = true
	failure.value = ''
	try {
		if (aiDirty.value) {
			const notice = aiForm.body()
			let s
			try {
				s = await saveAiSettings({ enabled: aiEnabled.value === true, dailyLimit: aiLimit.value, notice })
			} catch (e) {
				failed('ai', aiForm, e)
				return
			}
			if (s && typeof s === 'object') {
				aiEnabled.value = s.enabled !== false
				aiLimit.value = Number.isInteger(s.dailyLimit) ? s.dailyLimit : aiLimit.value
			}
			aiSaved.value = { enabled: aiEnabled.value, limit: aiLimit.value }
			aiForm.load(s?.notice?.settings ?? notice)
		}
		if (privacyForm.dirty.value) {
			const body = privacyForm.body()
			let p
			try {
				p = await savePrivacy(body)
			} catch (e) {
				failed('privacy', privacyForm, e)
				return
			}
			privacyForm.load(p ?? body)
		}
		status.value = t('knorke', 'Saved.')
		for (const f of noticeFields()) {
			f.fitAll?.()
		}
	} finally {
		busy.value = false
	}
}
</script>
