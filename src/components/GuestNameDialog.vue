<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="t('knorke', 'Join board')"
		size="small"
		is-form
		no-close
		class="knorke-dialog"
		data-knorke-dialog="guest-name"
		@submit="submit">
		<!-- NcDialog shows its message prop only without slot content -->
		<p class="knorke-dialog__message">
			{{ voteForm ? t('knorke', 'Your votes are anonymous.') : t('knorke', 'Choose a name. Others on this board will see it next to your cursor.') }}
		</p>
		<div ref="notice" class="knorke-dialog__privacy" data-knorke="privacy-notice">
			<p id="knorke-guest-privacy-text"
				ref="noticeTextEl"
				class="knorke-dialog__privacy-text"
				data-knorke-privacy-text
				:tabindex="noticeScrolls ? 0 : null"
				:role="noticeScrolls ? 'region' : null"
				:aria-label="noticeScrolls ? t('knorke', 'Privacy notice') : null">
				{{ noticeText(privacy, { vote: voteForm }) }}
			</p>
			<LegalLinks class="knorke-dialog__legal" :legal="legal" />
		</div>
		<NcTextField v-model="name"
			:label="t('knorke', 'Your name')"
			:maxlength="maxLength"
			:disabled="busy"
			:required="!voteForm"
			autocomplete="nickname"
			aria-describedby="knorke-guest-privacy-text"
			data-knorke-field="guest-name" />
		<PasswordInput v-if="needsPassword"
			v-model="password"
			v-model:visible="shown"
			class="knorke-dialog__password"
			:label="t('knorke', 'Password')"
			:disabled="busy"
			:error="!!passwordError"
			required
			autocomplete="current-password"
			data-knorke-field="guest-password" />
		<p v-if="passwordError"
			class="knorke-dialog__error"
			role="alert"
			:data-knorke-error="passwordCode || null">
			{{ passwordError }}
		</p>
		<p v-if="error" class="knorke-dialog__error" role="alert">
			{{ error }}
		</p>
		<template #actions>
			<NcButton type="submit"
				variant="primary"
				:disabled="!canJoin"
				data-knorke-action="guest-join">
				{{ t('knorke', 'Join') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * Name dialog of the guest page (SPEC-M0 §6.6). Required, at most 40
 * characters (the server cleans and cuts the name again). The name is data,
 * never markup: it only goes through Vue interpolation and textContent.
 * (U9) The instance's imprint and privacy links, since the guest page hides
 * Nextcloud's footer.
 *
 * M2 privacy notice: between the intro and the name field the notice block
 * [data-knorke=privacy-notice] – the admin's text in the guest's language or
 * the built-in one ([data-knorke-privacy-text], line breaks kept; the voting
 * form has its own built-in wording, components/privacy.js) and below it the
 * legal links (the privacy policy URL of `legal` is the effective one). No
 * checkbox, no extra button: joining needs the name only (or nothing on the
 * voting link), as before. The name field (first focus) is described by the
 * notice text, so a screen reader reads it with the field. Only the text
 * scrolls (max 30vh), so the legal
 * links under it stay in sight with a long admin text; the text is in the
 * tab order only while it scrolls (tabindex 0, a region named "Privacy
 * notice").
 *
 * SPEC-M1 stage 2 (§6.6 GuestNameDialog, §4.11.4):
 * - needsPassword: the link has a password (linkInfo.password, or the server
 *   asked for it): [data-knorke-field=guest-password] in the same dialog;
 *   the hint at it (Enter the password…, Wrong password., the lock-out text)
 *   comes as passwordError with its §4.2 code ([data-knorke-error=<code>]).
 * - The voting-link form (intro "Your votes are anonymous.", name optional:
 *   empty → "Guest") only with FEATURES.voting (R13); without it the voting
 *   link gets the form of the edit link (name required, E28 stage 2).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import LegalLinks from './LegalLinks.vue'
import PasswordInput from './PasswordInput.vue'
import { noticeText } from './privacy.js'
import { FEATURES } from '../util/features.js'
import { t } from '../util/l10n.js'
import { wellFormed } from '../util/unicode.js'

const props = defineProps({
	initialName: { type: String, default: '' },
	maxLength: { type: Number, default: 40 },
	busy: { type: Boolean, default: false },
	error: { type: String, default: '' },
	legal: { type: Object, default: null },
	/** the link needs a password (stage 2) */
	needsPassword: { type: Boolean, default: false },
	passwordError: { type: String, default: '' },
	/** §4.2 code of passwordError */
	passwordCode: { type: String, default: '' },
	/** role of the link: 'edit' | 'vote' (linkInfo.role) */
	linkRole: { type: String, default: 'edit' },
	/** M2: initial state `privacy` ({text, url}) */
	privacy: { type: Object, default: null },
})

const emit = defineEmits(['join'])

const name = ref(props.initialName)
const password = ref('')
const shown = ref(false)
/** The voting-link form: anonymous intro and optional name (stage 3, FEATURES.voting). */
const voteForm = computed(() => FEATURES.voting && props.linkRole === 'vote')
const notice = ref(null)
const noticeTextEl = ref(null)
/** The notice text scrolls (a long text): then it is reachable with Tab. */
const noticeScrolls = ref(false)
let noticeObserver = null

function measureNotice() {
	const el = noticeTextEl.value
	noticeScrolls.value = !!el && el.scrollHeight > el.clientHeight + 1
}

/**
 * The name field takes the first focus: the notice's legal links now come
 * before it in the tab order, and the dialog's focus trap would otherwise
 * start on them. The trap keeps a focus that is already inside the dialog.
 */
function focusName() {
	const el = notice.value?.parentElement?.querySelector('[data-knorke-field=guest-name]')
	const input = el && (el.matches('input') ? el : el.querySelector('input'))
	input?.focus?.()
}

onMounted(async () => {
	await nextTick()
	focusName()
	measureNotice()
	if (typeof ResizeObserver === 'function' && noticeTextEl.value) {
		noticeObserver = new ResizeObserver(() => measureNotice())
		noticeObserver.observe(noticeTextEl.value)
	} else {
		window.addEventListener('resize', measureNotice)
	}
})

onBeforeUnmount(() => {
	noticeObserver?.disconnect()
	noticeObserver = null
	window.removeEventListener('resize', measureNotice)
})

const canJoin = computed(() => !props.busy
	&& (voteForm.value || name.value.trim() !== '')
	&& (!props.needsPassword || password.value !== ''))

function submit() {
	if (!canJoin.value) {
		return
	}
	// well-formed UTF-16 (T14): a lone surrogate would make the join a 400
	let n = wellFormed(name.value.trim())
	if (n === '' && voteForm.value) {
		n = t('knorke', 'Guest')
	}
	if (n !== '') {
		emit('join', n, props.needsPassword ? password.value : null)
	}
}
</script>
