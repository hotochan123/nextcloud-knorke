<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="t('knorke', 'Save as PDF')"
		size="small"
		is-form
		class="knorke-dialog knorke-pdfexport"
		data-knorke-dialog="export-pdf"
		@update:open="(o) => !o && $emit('close')"
		@submit="$emit('save', choice)">
		<!-- NcModal ignores Esc inside inputs (useHotKey): the radios close the dialog themselves -->
		<fieldset class="knorke-pdfexport__group" @keydown.esc.stop.prevent="$emit('close')">
			<legend>{{ t('knorke', 'Page size') }}</legend>
			<label v-for="o in OPTIONS"
				:key="o.key"
				class="knorke-pdfexport__option"
				:data-knorke-pdf-page="o.key">
				<input v-model="choice"
					type="radio"
					:name="name"
					:value="o.key">
				<span>{{ o.label() }}</span>
			</label>
		</fieldset>
		<template #actions>
			<NcButton type="button"
				variant="tertiary"
				@click="$emit('close')">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton type="submit"
				variant="primary"
				data-knorke-action="export-pdf-save">
				{{ t('knorke', 'Save') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * "Save as PDF…" (factory job 207): the page size of the PDF, one radio per
 * size in PDF_PAGE_KEYS order, each a whole row
 * [data-knorke-pdf-page=a4|a3|content] ("A4", "A3", "Size of the
 * content"), the one of the prop page checked. "Save"
 * ([data-knorke-action=export-pdf-save], Enter) emits save with the chosen
 * key, "Cancel", Esc (also on a radio) and the close button emit close.
 * The shell saves the file (session.exportVector, which stores the choice).
 */
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { PDF_PAGE_KEYS } from '../scene/exportPdf.js'
import { t } from '../util/l10n.js'

const LABELS = {
	a4: () => t('knorke', 'A4'),
	a3: () => t('knorke', 'A3'),
	content: () => t('knorke', 'Size of the content'),
}
const OPTIONS = PDF_PAGE_KEYS.map((key) => ({ key, label: LABELS[key] }))

let seq = 0

const props = defineProps({
	/** the page size checked when the dialog opens (session.pdfPage) */
	page: { type: String, default: 'content' },
})

defineEmits(['save', 'close'])

const name = 'knorke-pdf-page-' + (++seq)
const choice = ref(PDF_PAGE_KEYS.includes(props.page) ? props.page : 'content')
</script>
