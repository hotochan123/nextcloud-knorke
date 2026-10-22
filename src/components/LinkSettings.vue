<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-linksettings">
		<NcNoteCard v-if="policy.passwordEnforced" type="info">
			{{ t('knorke', 'A password is required by your administrator.') }}
		</NcNoteCard>
		<div class="knorke-linksettings__row">
			<PasswordInput class="knorke-linksettings__password"
				:model-value="draft.password"
				:visible="shown"
				:label="link && link.password ? t('knorke', 'New password') : t('knorke', 'Password')"
				:helper-text="link && link.password ? t('knorke', 'A password is set. Enter a new one to change it.') : ''"
				:error="!!passwordError"
				:disabled="busy"
				autocomplete="new-password"
				data-knorke-field="link-password"
				@update:visible="(v) => { shown = v }"
				@update:model-value="(v) => update({ password: typeof v === 'string' ? v : '' })" />
			<NcButton variant="tertiary"
				:disabled="busy"
				data-knorke-action="link-password-generate"
				@click="generate">
				<template #icon>
					<NcIconSvgWrapper :path="icons.dice" />
				</template>
				{{ t('knorke', 'Generate password') }}
			</NcButton>
		</div>
		<p v-if="passwordError"
			class="knorke-dialog__error"
			role="alert"
			:data-knorke-error="passwordError.code">
			{{ passwordError.text }}
		</p>
		<NcButton v-if="link && link.password && !policy.passwordEnforced"
			variant="tertiary"
			:disabled="busy"
			data-knorke-action="link-password-remove"
			@click="$emit('remove-password')">
			{{ t('knorke', 'Remove password') }}
		</NcButton>
		<NcDateTimePickerNative class="knorke-linksettings__expiry"
			:model-value="dateOfDay(draft.expiry)"
			type="date"
			:label="t('knorke', 'Expires on')"
			:min="dateOfDay(today)"
			:max="maxDate"
			:disabled="busy"
			:required="policy.expireEnforced"
			data-knorke-field="link-expiry"
			@update:model-value="(d) => update({ expiry: d instanceof Date && !isNaN(d) ? dayOf(d) : '' })" />
		<p v-if="expiryError"
			class="knorke-dialog__error"
			role="alert"
			:data-knorke-error="expiryError.code">
			{{ expiryError.text }}
		</p>
		<div class="knorke-linksettings__actions">
			<NcButton variant="primary"
				:disabled="busy || disabled"
				data-knorke-action="link-settings-save"
				@click="$emit('save')">
				{{ link ? t('knorke', 'Save') : role === 'vote' ? t('knorke', 'Create voting link') : t('knorke', 'Create edit link') }}
			</NcButton>
		</div>
	</div>
</template>

<script setup>
/*
 * Password and expiry of one link (SPEC-M1 §6.6 LinkSettings, §4.11.2).
 *
 * - Password: [data-knorke-field=link-password] (never
 *   prefilled: the server only says whether one is set; autocomplete
 *   new-password, so no browser fills in the account password; PasswordInput,
 *   an NcTextField with show/hide, §6.13). "Generate password" fills it
 *   locally and shows it (components/share.js generatePassword: 16
 *   characters from crypto.getRandomValues, no password_policy OCS call).
 *   "Remove password" (only when not enforced) loosens the link.
 * - Expiry: NcDateTimePickerNative type=date [data-knorke-field=link-expiry],
 *   sent as the calendar day "YYYY-MM-DD"; a day after today + expireMaxDays
 *   (or in the past) shows the text of expiry_too_far (expiry_past) at the
 *   field at once (the server checks again).
 * - [data-knorke-action=link-settings-save] is disabled while a required
 *   field is empty (R13) or nothing changed on an existing link. For a link
 *   that is not on yet (enforced policy) it creates the link.
 * - Server errors of the section with a field (password_*, expiry_*) show at
 *   their field, with [data-knorke-error=<code>].
 */
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'
import PasswordInput from './PasswordInput.vue'
import { addDays, dateOfDay, dayOf, expiryProblem, generatePassword, saveDisabled, textOf } from './share.js'

const props = defineProps({
	/** 'edit' | 'vote' */
	role: { type: String, default: 'edit' },
	/** the active Link, or null (not on yet) */
	link: { type: Object, default: null },
	/** {password, expiry, removePassword} */
	draft: { type: Object, required: true },
	/** normalized linkPolicy */
	policy: { type: Object, required: true },
	busy: { type: Boolean, default: false },
	/** server error of the section {code, text, field} or null */
	error: { type: Object, default: null },
	/** 'YYYY-MM-DD' of today */
	today: { type: String, required: true },
})

const emit = defineEmits(['update:draft', 'save', 'remove-password'])

/** the password is shown as text (after "Generate password" at once) */
const shown = ref(false)
const disabled = computed(() => saveDisabled(props.link, props.draft, props.policy))
const maxDate = computed(() => (props.policy.expireMaxDays !== null ? dateOfDay(addDays(props.today, props.policy.expireMaxDays)) : null))
const passwordError = computed(() => (props.error && props.error.field === 'password' ? props.error : null))
const expiryError = computed(() => {
	if (props.error && props.error.field === 'expiry') {
		return props.error
	}
	const changed = props.draft.expiry !== (props.link?.expiresOn ?? '')
	const code = changed || !props.link ? expiryProblem(props.draft.expiry, props.policy, props.today) : null
	// an empty required field is no error yet: Save stays disabled until it is filled
	if (code === null || code === 'expiry_required') {
		return null
	}
	return textOf(code, code === 'expiry_too_far' ? { maxDays: props.policy.expireMaxDays } : {})
})

/** @param {object} patch fields of the draft */
function update(patch) {
	emit('update:draft', { ...props.draft, ...patch })
}

function generate() {
	shown.value = true
	update({ password: generatePassword() })
}
</script>
