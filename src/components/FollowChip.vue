<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-banner knorke-banner--chip"
		data-knorke-follow-chip
		data-knorke-bar="banner"
		role="status">
		<button type="button"
			class="knorke-followchip"
			data-knorke-action="follow-presenter"
			@click="$emit('follow')">
			{{ t('knorke', '{name} is presenting · Follow', { name: chip.name || t('knorke', 'Someone') }) }}
		</button>
	</div>
</template>

<script setup>
/*
 * Back to the presenter (SPEC-M1 §6.5.6, §6.6 FollowChip, R2): while "Bring
 * everyone here" is active, this tab does not follow and the presenter's tab
 * has a fresh presence entry with a viewport, one tap follows again. The
 * whole strip is the button (≥ 44 px high, §6.12 touch target).
 */
import { t } from '../util/l10n.js'

defineProps({
	/** {pid, client, name} */
	chip: { type: Object, required: true },
})

defineEmits(['follow'])
</script>
