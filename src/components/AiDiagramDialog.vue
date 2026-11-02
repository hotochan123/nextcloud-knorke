<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="t('knorke', 'Create with AI')"
		size="normal"
		class="knorke-dialog knorke-aidialog"
		data-knorke-dialog="ai-diagram"
		@update:open="(o) => !o && $emit('close')">
		<!-- NcModal ignores Esc inside inputs (useHotKey): the fields close the dialog themselves -->
		<div class="knorke-aidialog__body" @keydown.esc.stop.prevent="$emit('close')">
			<div class="knorke-aidialog__shapes"
				role="radiogroup"
				:aria-label="t('knorke', 'Diagram')"
				@keydown="onShapeKey">
				<button v-for="s in SHAPES"
					:key="s.id"
					type="button"
					role="radio"
					class="knorke-chip"
					:class="{ 'knorke-chip--active': shape === s.id }"
					:aria-checked="shape === s.id ? 'true' : 'false'"
					:tabindex="shape === s.id ? 0 : -1"
					:disabled="working"
					:data-knorke-ai-shape="s.id"
					@click="shape = s.id">
					{{ s.label }}
				</button>
			</div>
			<label class="knorke-aidialog__field">
				<span class="hidden-visually">{{ t('knorke', 'What should the diagram show?') }}</span>
				<textarea ref="promptEl"
					v-model="prompt"
					rows="3"
					:maxlength="PROMPT_MAX"
					:placeholder="t('knorke', 'What should the diagram show?')"
					:disabled="working"
					data-knorke-field="ai-prompt"
					@keydown.enter="(e) => (e.ctrlKey || e.metaKey) && (e.preventDefault(), create())" />
			</label>
			<p v-if="count >= COUNT_FROM" class="knorke-aidialog__count" aria-live="polite">
				{{ count }} / {{ PROMPT_MAX }}
			</p>
			<p v-if="working" class="knorke-aidialog__working" role="status" data-knorke-ai="diagram-working">
				<span class="knorke-aidialog__spinner" aria-hidden="true" />
				{{ t('knorke', 'AI is working…') }}
			</p>
			<p v-else-if="view && view.error" class="knorke-dialog__error" role="alert" data-knorke-ai="diagram-error">
				{{ view.error }}
			</p>
			<svg v-if="preview && !working"
				class="knorke-aidialog__preview"
				:viewBox="`-8 -8 ${preview.w + 16} ${preview.h + 16}`"
				role="img"
				:aria-label="preview.frames ? n('knorke', 'Preview: %n frame', 'Preview: %n frames', preview.frames) : n('knorke', 'Preview: %n node', 'Preview: %n nodes', preview.boxes.length)"
				data-knorke-ai="diagram-preview">
				<defs v-if="preview.arrows">
					<marker id="knorke-ai-tip"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="6"
						markerHeight="6"
						orient="auto">
						<path d="M0 0L10 5L0 10Z" fill="#8a8f94" />
					</marker>
				</defs>
				<path v-for="(d, i) in preview.lines"
					:key="'l' + i"
					:d="d"
					fill="none"
					stroke="#8a8f94"
					stroke-width="2"
					:marker-end="preview.arrows ? 'url(#knorke-ai-tip)' : null" />
				<text v-for="(lb, i) in preview.labels || []"
					:key="'t' + i"
					:x="lb.x"
					:y="lb.y"
					font-size="13"
					fill="#5b5f63">{{ lb.text }}</text>
				<g v-for="b in preview.boxes" :key="b.key">
					<path v-if="b.d"
						:d="b.d"
						:fill="b.fill"
						:stroke="b.stroke"
						stroke-width="2" />
					<rect v-else
						:x="b.x"
						:y="b.y"
						:width="b.w"
						:height="b.h"
						rx="8"
						:fill="b.fill"
						:stroke="b.stroke"
						stroke-width="2" />
					<text v-if="b.label"
						:x="b.x + b.w / 2"
						:y="b.ty ?? b.y + b.h / 2"
						text-anchor="middle"
						dominant-baseline="central"
						:font-size="b.root ? 18 : 15"
						:font-weight="b.root ? 'bold' : 'normal'"
						fill="#191b1d">{{ b.label }}</text>
				</g>
			</svg>
		</div>
		<template #actions>
			<NcButton variant="secondary"
				data-knorke-action="ai-diagram-cancel"
				@click="$emit('close')">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton v-if="preview && !working"
				variant="secondary"
				:disabled="!canCreate"
				data-knorke-action="ai-diagram-retry"
				@click="create">
				{{ t('knorke', 'Try again') }}
			</NcButton>
			<NcButton v-if="preview && !working"
				variant="primary"
				data-knorke-action="ai-diagram-insert"
				@click="$emit('insert')">
				{{ t('knorke', 'Insert') }}
			</NcButton>
			<NcButton v-else
				variant="primary"
				:disabled="!canCreate"
				data-knorke-action="ai-diagram-create"
				@click="create">
				{{ t('knorke', 'Create') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * "Create with AI" (factory job 268): a mind map, org chart or tree from a
 * prompt; (job 269) or a flowchart (its boxes as outlines, b.d, its
 * arrows with tips and labels). The choice ([data-knorke-ai-shape], a radio group: arrow keys),
 * the request ([data-knorke-field=ai-prompt], at most PROMPT_MAX
 * characters, the count from COUNT_FROM; Ctrl/⌘+Enter = Create), "AI is
 * working…" while the task runs, the message of a failed one, and the
 * preview (aiPreview.js: boxes and lines as SVG, texts as text) with
 * "Insert", "Try again" and "Cancel". Emits run(shape, prompt), insert and
 * close (Cancel, Esc, the close button); the board session does the rest
 * (sessionAi.js diagram). view = ui.onAiDiagram {working, shape, tree, error}.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { PROMPT_MAX } from '../board/sessionAi.js'
import { n, t } from '../util/l10n.js'
import { aiPreview } from './aiPreview.js'

/** The count of characters shows from here. */
const COUNT_FROM = 900

const SHAPES = [
	{ id: 'mindmap', label: t('knorke', 'Mind map') },
	{ id: 'org', label: t('knorke', 'Org chart') },
	{ id: 'tree', label: t('knorke', 'Tree') },
	{ id: 'flowchart', label: t('knorke', 'Flowchart') },
	{ id: 'workshop', label: t('knorke', 'Workshop') },
]

const props = defineProps({
	view: { type: Object, default: null },
})

const emit = defineEmits(['run', 'insert', 'close'])

const shape = ref(SHAPES.some((s) => s.id === props.view?.shape) ? props.view.shape : 'mindmap')
const prompt = ref('')
const promptEl = ref(null)

const working = computed(() => props.view?.working === true)
const count = computed(() => [...prompt.value].length)
const canCreate = computed(() => !working.value && prompt.value.trim() !== '' && count.value <= PROMPT_MAX)
const preview = computed(() => (props.view?.tree ? aiPreview(props.view.tree, props.view.shape) : null))

watch(() => props.view?.shape, (s) => {
	if (SHAPES.some((x) => x.id === s)) shape.value = s
})

onMounted(() => nextTick(() => promptEl.value?.focus?.()))

function create() {
	if (canCreate.value) emit('run', shape.value, prompt.value)
}

/** Arrow keys move the choice (radio group). @param {KeyboardEvent} e */
function onShapeKey(e) {
	const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
	if (step === 0 || working.value) return
	e.preventDefault()
	const group = e.currentTarget
	const i = SHAPES.findIndex((s) => s.id === shape.value)
	shape.value = SHAPES[(i + step + SHAPES.length) % SHAPES.length].id
	nextTick(() => group?.querySelector?.('[aria-checked="true"]')?.focus?.())
}
</script>
