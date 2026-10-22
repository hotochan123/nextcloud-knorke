<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="name"
		:message="message"
		size="small"
		is-form
		:no-close="busy"
		class="knorke-dialog"
		@update:open="onOpen"
		@submit="onSubmit">
		<slot />
		<template #actions>
			<NcButton v-if="!hideCancel"
				type="button"
				variant="tertiary"
				:disabled="busy"
				@click="$emit('cancel')">
				{{ cancelLabel || t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton type="submit"
				:variant="danger ? 'error' : 'primary'"
				:disabled="busy || confirmDisabled"
				data-knorke-action="confirm">
				{{ confirmLabel || t('knorke', 'OK') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * The one confirmation dialog of the shell (SPEC-M0 §6.6, §6.8). Its
 * confirming button carries [data-knorke-action=confirm]; the caller renders
 * the dialog with v-if, so only one is in the DOM at a time. Enter in a field
 * of the default slot submits (NcDialog is-form).
 */
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'

const props = defineProps({
	name: { type: String, required: true },
	message: { type: String, default: '' },
	confirmLabel: { type: String, default: '' },
	cancelLabel: { type: String, default: '' },
	danger: { type: Boolean, default: false },
	busy: { type: Boolean, default: false },
	confirmDisabled: { type: Boolean, default: false },
	hideCancel: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])

/** @param {boolean} open new open state from NcDialog (close button, Esc) */
function onOpen(open) {
	if (!open && !props.busy) {
		emit('cancel')
	}
}

function onSubmit() {
	if (!props.busy && !props.confirmDisabled) {
		emit('confirm')
	}
}
</script>
