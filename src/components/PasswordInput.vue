<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-password">
		<NcTextField v-bind="$attrs"
			class="knorke-password__field"
			:model-value="modelValue"
			:type="visible ? 'text' : 'password'"
			:label="label"
			:error="error"
			:helper-text="helperText"
			:disabled="disabled"
			:required="required"
			spellcheck="false"
			@update:model-value="(v) => $emit('update:modelValue', typeof v === 'string' ? v : '')" />
		<NcButton variant="tertiary"
			class="knorke-password__toggle"
			:aria-label="visible ? t('knorke', 'Hide password') : t('knorke', 'Show password')"
			:title="visible ? t('knorke', 'Hide password') : t('knorke', 'Show password')"
			:disabled="disabled"
			@click="$emit('update:visible', !visible)">
			<template #icon>
				<NcIconSvgWrapper :path="visible ? icons.eyeOff : icons.eye" />
			</template>
		</NcButton>
	</div>
</template>

<script setup>
/*
 * Password input of the shell (link password, guest password, account join
 * password; SPEC-M1 §6.6). An NcTextField of type password with a show/hide
 * button instead of NcPasswordField: NcPasswordField imports
 * @nextcloud/axios for its optional strength check (which Knorke never uses,
 * the generator is local), and that alone costs ≈ 23 KiB gzip of the
 * vendor chunk (measured stage 2, §6.13). Attributes (data-knorke-field,
 * autocomplete) go to the text field.
 *
 * The show/hide button is an action button (SPEC-M1 §6.12, R18 A-03): its
 * label says what a click does ("Show password" / "Hide password") and
 * changes with the state, so it carries no aria-pressed (a toggle button
 * keeps one label; both at once would announce the state twice).
 */
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { t } from '../util/l10n.js'
import { icons } from './icons.js'

defineOptions({ inheritAttrs: false })

defineProps({
	modelValue: { type: String, default: '' },
	label: { type: String, required: true },
	error: { type: Boolean, default: false },
	helperText: { type: String, default: '' },
	disabled: { type: Boolean, default: false },
	required: { type: Boolean, default: false },
	/** shown as plain text (v-model:visible) */
	visible: { type: Boolean, default: false },
})

defineEmits(['update:modelValue', 'update:visible'])
</script>
