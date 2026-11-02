<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div v-if="panel"
		ref="root"
		class="knorke-tags"
		:class="'knorke-tags--' + panel.kind"
		role="dialog"
		:aria-label="title"
		:data-knorke-tag-panel="panel.kind"
		:style="style"
		@keydown.esc.stop.prevent="close(true)">
		<header class="knorke-tags__head">
			<h3 class="knorke-tags__title">
				{{ title }}
			</h3>
			<button type="button"
				class="knorke-tags__icon"
				:aria-label="t('knorke', 'Close')"
				:title="t('knorke', 'Close')"
				data-knorke-action="tags-close"
				@click="close(true)">
				<NcIconSvgWrapper :path="icons.close" :size="20" />
			</button>
		</header>

		<!-- the tags of the selected notes (mode edit) -->
		<template v-if="panel.kind === 'tag'">
			<form v-if="editing"
				class="knorke-tags__edit"
				data-knorke-tag-editor
				@submit.prevent="saveName">
				<label class="knorke-tags__label" :for="nameId">{{ t('knorke', 'Name') }}</label>
				<input :id="nameId"
					ref="nameEl"
					v-model="name"
					type="text"
					class="knorke-tags__input"
					:maxlength="TAG_NAME_MAX"
					data-knorke-tag-name
					@keydown.esc.stop.prevent="cancelEdit">
				<div class="knorke-tags__colors" role="radiogroup" :aria-label="t('knorke', 'Color')">
					<button v-for="c in TAG_COLORS"
						:key="c"
						type="button"
						role="radio"
						class="knorke-tags__color"
						:aria-checked="editColor === c ? 'true' : 'false'"
						:aria-label="paletteName(c)"
						:title="paletteName(c)"
						:data-knorke-tag-color="c"
						:style="{ '--knorke-tag-color': c }"
						@click="recolor(c)" />
				</div>
				<div class="knorke-tags__actions">
					<button type="submit" class="knorke-tags__button knorke-tags__button--primary" data-knorke-tag-save>
						{{ t('knorke', 'Save') }}
					</button>
					<button type="button" class="knorke-tags__button" data-knorke-tag-cancel @click="cancelEdit">
						{{ t('knorke', 'Cancel') }}
					</button>
					<button type="button"
						class="knorke-tags__button knorke-tags__button--danger"
						data-knorke-tag-delete
						@click="remove">
						{{ t('knorke', 'Delete tag') }}
					</button>
				</div>
			</form>
			<template v-else>
				<input ref="searchEl"
					v-model="query"
					type="text"
					class="knorke-tags__input"
					:maxlength="TAG_NAME_MAX"
					:placeholder="t('knorke', 'Search or create a tag')"
					:aria-label="t('knorke', 'Search or create a tag')"
					data-knorke-tag-search
					@keydown.enter.prevent="enter">
				<ul class="knorke-tags__list">
					<li v-for="tg in shown"
						:key="tg.id"
						class="knorke-tags__row"
						:data-knorke-tag-row="tg.id">
						<button type="button"
							role="checkbox"
							class="knorke-tags__check"
							:aria-checked="ariaChecked(tg.state)"
							data-knorke-tag-check
							@click="$emit('action', 'tick', tg.id)">
							<span class="knorke-tags__box" aria-hidden="true">{{ tg.state === 'on' ? '✓' : tg.state === 'mixed' ? '–' : '' }}</span>
							<span class="knorke-tags__chip" :style="{ background: tg.color, color: tagTextColor(tg.color) }">{{ tg.name }}</span>
						</button>
						<button v-if="view.mayEdit"
							type="button"
							class="knorke-tags__icon"
							:aria-label="t('knorke', 'Edit tag “{name}”', { name: tg.name })"
							:title="t('knorke', 'Edit tag “{name}”', { name: tg.name })"
							data-knorke-tag-edit
							@click="startEdit(tg)">
							<NcIconSvgWrapper :path="icons.pencil" :size="20" />
						</button>
					</li>
					<li v-if="offer" class="knorke-tags__row">
						<button type="button"
							class="knorke-tags__check knorke-tags__create"
							data-knorke-tag-create
							:disabled="view.busy"
							@click="enter">
							{{ t('knorke', 'Create “{name}”', { name: offer }) }}
						</button>
					</li>
				</ul>
				<p v-if="shown.length === 0 && !offer" class="knorke-tags__empty">
					{{ view.tags.length === 0 ? t('knorke', 'No tags yet. Type a name and press Enter.') : t('knorke', 'No tag matches.') }}
				</p>
			</template>
		</template>

		<!-- the filter of this tab (every mode) -->
		<template v-else-if="panel.kind === 'filter'">
			<ul class="knorke-tags__list">
				<li v-for="tg in view.tags"
					:key="tg.id"
					class="knorke-tags__row"
					:data-knorke-tag-filter-row="tg.id">
					<button type="button"
						role="checkbox"
						class="knorke-tags__check"
						:aria-checked="ariaChecked(view.filter.includes(tg.id))"
						data-knorke-tag-check
						@click="$emit('action', 'filter', tg.id)">
						<span class="knorke-tags__box" aria-hidden="true">{{ view.filter.includes(tg.id) ? '✓' : '' }}</span>
						<span class="knorke-tags__chip" :style="{ background: tg.color, color: tagTextColor(tg.color) }">{{ tg.name }}</span>
						<span class="knorke-tags__count">{{ n('knorke', '%n note', '%n notes', tg.count) }}</span>
					</button>
					<button v-if="view.edit"
						type="button"
						class="knorke-tags__icon"
						:aria-label="t('knorke', 'Select all with this tag')"
						:title="t('knorke', 'Select all with this tag')"
						:data-knorke-tag-select="tg.id"
						@click="$emit('action', 'select', tg.id)">
						<NcIconSvgWrapper :path="icons.select" :size="20" />
					</button>
				</li>
			</ul>
			<div class="knorke-tags__actions">
				<button type="button"
					class="knorke-tags__button"
					data-knorke-tag-filter-clear
					:disabled="view.filter.length === 0"
					@click="$emit('action', 'clear-filter')">
					{{ t('knorke', 'Clear filter') }}
				</button>
			</div>
		</template>

		<!-- every tag of one note ("+n", every mode) -->
		<ul v-else class="knorke-tags__list" :data-knorke-tag-list="panel.id">
			<li v-for="tg in panel.list"
				:key="tg.id"
				class="knorke-tags__row"
				data-knorke-tag-list-item>
				<span class="knorke-tags__chip" :style="{ background: tg.color, color: tagTextColor(tg.color) }">{{ tg.name }}</span>
			</li>
		</ul>
	</div>
</template>

<script setup>
/*
 * The tag panels of a board (factory job 191), one at a time after the
 * session's tagsView().panel (BoardSession):
 * - kind 'tag' ([data-knorke-tag-panel=tag], mode edit): a focused search
 *   field (at most TAG_NAME_MAX characters) above the board's tags sorted by
 *   name and filtered by it; each box ([data-knorke-tag-check], role
 *   checkbox, aria-checked true / mixed / false for the panel's notes)
 *   emits tick; Enter or the row "Create “…”" ([data-knorke-tag-create])
 *   emits create with the search and empties it, the panel stays; the
 *   pencil ([data-knorke-tag-edit]) opens the name field (Enter saves, Esc
 *   cancels), the 12 colours ([data-knorke-tag-color=<c>], job 227: the
 *   strong tones, their names as tooltips) and "Delete tag"
 *   ([data-knorke-tag-delete]), at once without a question (job 206: undo
 *   brings the tag back)
 * - kind 'filter' ([data-knorke-tag-panel=filter], every mode): a box per
 *   tag with its count of notes (emits filter), in mode edit "Select all
 *   with this tag" per row ([data-knorke-tag-select=<id>]), "Clear filter"
 * - kind 'list' ([data-knorke-tag-panel=list]): every tag of one note
 * Everything is reached with Tab; Esc closes and gives the focus to the
 * canvas (emit action close true), a pointerdown beside the panel closes it
 * without (close false). Rows are 44 px high with a coarse pointer
 * (knorke.css). Names are interpolated text, never HTML. Every change goes
 * out as emit('action', name, ...args) (BoardSession.tagAction).
 * Job 213: the panel is measured again whenever its size changes (the
 * editor opening or closing, the search changing the rows; a
 * ResizeObserver where there is one) and placed by tags.js tagPanelPlace,
 * so the editor never reaches past the board's bottom.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { icons } from './icons.js'
import { popoverPlace } from './reactions.js'
import { ariaChecked, createOffer, shownTags, tagPanelPlace, tagTextColor } from './tags.js'
import { TAG_NAME_MAX, cleanTagName } from '../model/tags.js'
import { TAG_COLORS } from '../model/tokens.js'
import { paletteName } from './labels.js'
import { n, t } from '../util/l10n.js'

const props = defineProps({
	/** BoardSession.tagsView() */
	view: { type: Object, required: true },
})

const emit = defineEmits(['action'])

const root = ref(null)
const searchEl = ref(null)
const nameEl = ref(null)
const query = ref('')
/** the tag whose name and colour are being edited, or null */
const editing = ref(null)
const name = ref('')
/** where the panel stands, tags.js tagPanelPlace of the last measure(); null: not measured yet */
const placed = ref(null)
const nameId = 'knorke-tag-name-' + Math.random().toString(36).slice(2, 8)

const panel = computed(() => props.view?.panel ?? null)
const shown = computed(() => shownTags(props.view.tags, query.value))
const offer = computed(() => (panel.value?.kind === 'tag' ? createOffer(props.view.tags, query.value) : null))
const editColor = computed(() => props.view.tags.find((tg) => tg.id === editing.value?.id)?.color ?? editing.value?.color ?? null)
const title = computed(() => {
	switch (panel.value?.kind) {
	case 'tag': return t('knorke', 'Tags')
	case 'filter': return t('knorke', 'Filter by tags')
	default: return t('knorke', 'Tags of this note')
	}
})
const style = computed(() => {
	if (panel.value?.kind === 'filter') {
		return {}
	}
	const p = placed.value ?? popoverPlace(panel.value?.rect ?? null, null, null)
	return { left: p.x + 'px', top: p.y + 'px' }
})

/** Measures the panel and the board (its parent) and places the panel; above the box it stays above while it fits. */
function measure() {
	const el = root.value
	const box = el?.parentElement
	if (!el || !box || panel.value?.kind === 'filter') {
		return
	}
	placed.value = tagPanelPlace(panel.value?.rect ?? null, { w: el.offsetWidth, h: el.offsetHeight }, { w: box.clientWidth, h: box.clientHeight }, placed.value?.above === true)
}

/** Job 213: one observer measures whichever panel element is there whenever its size changes. */
const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null

/** The first field or box of the panel takes the focus. */
function focusFirst() {
	nextTick(() => {
		const el = panel.value?.kind === 'tag' ? (editing.value ? nameEl.value : searchEl.value) : root.value?.querySelector?.('[data-knorke-tag-check], li, button')
		el?.focus?.({ preventScroll: true })
	})
}

/** @param {boolean} focus the canvas gets the focus (Esc, the close button) */
function close(focus) {
	emit('action', 'close', focus)
}

function enter() {
	const q = query.value
	if (cleanTagName(q) === null || props.view.busy) {
		return
	}
	emit('action', 'create', q)
	query.value = ''
}

/** @param {object} tg the tag to edit */
function startEdit(tg) {
	editing.value = { id: tg.id, name: tg.name, color: tg.color }
	name.value = tg.name
	focusFirst()
}

function cancelEdit() {
	editing.value = null
	focusFirst()
}

function saveName() {
	const e = editing.value
	const clean = cleanTagName(name.value)
	if (e && clean !== null && clean !== e.name) {
		emit('action', 'rename', e.id, clean)
	}
	cancelEdit()
}

/** @param {string} c one of TAG_COLORS */
function recolor(c) {
	if (editing.value && c !== editColor.value) {
		emit('action', 'recolor', editing.value.id, c)
	}
}

/** "Delete tag": at once, no question (job 206: undo brings it back) */
function remove() {
	const e = editing.value
	if (e) {
		emit('action', 'delete', e.id)
	}
	cancelEdit()
}

const onDown = (e) => {
	if (!root.value || !e?.target || root.value.contains(e.target)) {
		return
	}
	// a press inside a Nextcloud dialog is no press beside the panel
	if (typeof e.target.closest === 'function' && e.target.closest('.modal-mask, [role="dialog"]')) {
		return
	}
	close(false)
}

watch(() => panel.value?.kind + ':' + (panel.value?.id ?? ''), () => {
	query.value = ''
	editing.value = null
	placed.value = null
	focusFirst()
	nextTick(measure)
})
watch(() => [panel.value?.rect, props.view.tags.length], () => nextTick(measure))
// the editor opening or closing changes the panel's height
watch(() => editing.value === null, () => nextTick(measure))
watch(root, (el, old) => {
	if (old) {
		resizer?.unobserve(old)
	}
	if (el) {
		resizer?.observe(el)
	}
}, { flush: 'post' })
// a tag that is gone (deleted elsewhere) ends its editor
watch(() => props.view.tags, (tags) => {
	if (editing.value && !tags.some((tg) => tg.id === editing.value.id)) {
		editing.value = null
	}
})

onMounted(() => {
	measure()
	focusFirst()
	document.addEventListener('pointerdown', onDown, true)
	window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onDown, true)
	window.removeEventListener('resize', measure)
	resizer?.disconnect()
})
</script>
