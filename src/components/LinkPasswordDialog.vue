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
		data-knorke-dialog="link-password"
		@submit="submit">
		<p class="knorke-dialog__message">
			{{ t('knorke', 'Enter the password for this board.') }}
		</p>
		<PasswordInput v-model="password"
			v-model:visible="shown"
			:label="t('knorke', 'Password')"
			:disabled="busy"
			:error="!!error"
			required
			autocomplete="current-password"
			data-knorke-field="link-join-password" />
		<p v-if="error"
			class="knorke-dialog__error"
			role="alert"
			:data-knorke-error="errorCode || null">
			{{ error }}
		</p>
		<template #actions>
			<NcButton type="button"
				variant="tertiary"
				:disabled="busy"
				@click="$emit('cancel')">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton type="submit"
				variant="primary"
				:disabled="busy || password === ''"
				data-knorke-action="link-join">
				{{ t('knorke', 'Join') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * A signed-in user opens a link that has a password (SPEC-M1 §4.11.4, §6.6
 * LinkPasswordDialog): [data-knorke-dialog=link-password] with the field
 * [data-knorke-field=link-join-password]. App.vue sends the join again with
 * the password; "Wrong password." and the lock-out text come back as
 * `error` (hook [data-knorke-error=<code>]). The password is never stored.
 */
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { t } from '../util/l10n.js'
import PasswordInput from './PasswordInput.vue'

const props = defineProps({
	error: { type: String, default: '' },
	/** §4.2 code of the error ('password_wrong', 'slow_down' …) */
	errorCode: { type: String, default: '' },
	busy: { type: Boolean, default: false },
})

const emit = defineEmits(['submit', 'cancel'])

const password = ref('')
const shown = ref(false)

function submit() {
	if (!props.busy && password.value !== '') {
		emit('submit', password.value)
	}
}
</script>
