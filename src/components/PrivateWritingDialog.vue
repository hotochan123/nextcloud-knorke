<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="t('knorke', 'Private writing')"
		size="small"
		class="knorke-dialog"
		data-knorke-dialog="private"
		@update:open="(o) => !o && $emit('close')">
		<p>{{ t('knorke', 'Everyone sees only their own new notes; the others\' show as covered cards until you reveal them.') }}</p>
		<fieldset class="knorke-privatedialog__where">
			<legend>{{ t('knorke', 'Where') }}</legend>
			<label>
				<input v-model="where"
					type="radio"
					value=""
					data-knorke-field="private-board">
				{{ t('knorke', 'Whole board') }}
			</label>
			<label v-for="f in frames" :key="f.id">
				<input v-model="where"
					type="radio"
					:value="f.id"
					:data-knorke-field="'private-frame-' + f.id">
				{{ f.title }}
			</label>
		</fieldset>
		<template #actions>
			<NcButton variant="primary"
				:disabled="busy"
				data-knorke-action="private-start"
				@click="$emit('start', where === '' ? null : where)">
				{{ t('knorke', 'Start') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * Start of private writing (factory job 275, lazy part `moderate`): the
 * whole board or one frame (frames: BoardSession.frames(), initial: the
 * selected frame or null). "Start" emits start(frameId|null); the board
 * view calls PUT …/private and the answer comes back over the meta path.
 */
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { t } from '../util/l10n.js'

const props = defineProps({
	/** {id, title} of every frame */
	frames: { type: Array, default: () => [] },
	/** the frame picked at the opening, null = whole board */
	initial: { type: String, default: null },
	busy: { type: Boolean, default: false },
})

defineEmits(['start', 'close'])

const where = ref(props.initial ?? '')
</script>

<style scoped>
.knorke-privatedialog__where {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 12px 0 0;
	padding: 0;
	border: none;
	max-height: 40vh;
	overflow-y: auto;
}
</style>
