<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section ref="root"
		class="knorke-thread"
		:class="{ 'knorke-thread--sheet': sheet, 'knorke-thread--panel': inPanel }"
		role="dialog"
		:aria-label="thread ? t('knorke', 'Comment thread') : t('knorke', 'New comment')"
		:data-knorke-thread="thread ? thread.id : 'new'"
		:data-knorke-thread-resolved="thread && thread.resolved ? 'true' : 'false'"
		:style="placeStyle"
		@pointerdown.stop
		@keydown.esc.stop.prevent="$emit('close')">
		<header class="knorke-thread__head">
			<NcButton v-if="inPanel"
				variant="tertiary"
				:aria-label="t('knorke', 'Back to the list')"
				:title="t('knorke', 'Back to the list')"
				data-knorke-action="comment-back"
				@click="$emit('close')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.back" />
				</template>
			</NcButton>
			<h3 class="knorke-thread__title">
				{{ thread ? t('knorke', 'Comment') : t('knorke', 'New comment') }}
			</h3>
			<NcButton v-if="thread && canWrite"
				variant="secondary"
				:disabled="busy"
				data-knorke-action="comment-resolve"
				@click="$emit('resolve', !thread.resolved)">
				{{ thread.resolved ? t('knorke', 'Reopen') : t('knorke', 'Resolve') }}
			</NcButton>
			<NcButton v-if="!inPanel"
				variant="tertiary"
				:aria-label="t('knorke', 'Close')"
				:title="t('knorke', 'Close')"
				data-knorke-action="comment-close"
				@click="$emit('close')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.close" />
				</template>
			</NcButton>
		</header>
		<ol v-if="thread" class="knorke-thread__list">
			<li v-for="c in thread.comments"
				:key="c.id"
				class="knorke-comment"
				:data-knorke-comment="c.id"
				:data-knorke-comment-mine="c.mine ? 'true' : 'false'">
				<div class="knorke-comment__head">
					<span class="knorke-comment__name">{{ c.guest ? t('knorke', '{name} (guest)', { name: c.name }) : c.name }}</span>
					<span class="knorke-comment__time">{{ timeOf(c.at) }}</span>
					<span v-if="c.edited" class="knorke-comment__edited" data-knorke-comment-edited>{{ t('knorke', '(edited)') }}</span>
				</div>
				<CommentEditor v-if="editing === c.id"
					kind="edit"
					:initial="editStart.text"
					:initial-chosen="editStart.chosen"
					:placeholder="t('knorke', 'Edit comment')"
					:send-label="t('knorke', 'Save')"
					:search="search"
					:busy="busy"
					cancelable
					autofocus
					@send="(text) => saveEdit(c.id, text)"
					@cancel="editing = null"
					@escape="editing = null" />
				<p v-else class="knorke-comment__text" data-knorke-comment-text><template v-for="(p, i) in partsView(c.parts)" :key="i"><span v-if="p.mention" class="knorke-comment__mention" data-knorke-comment-mention>{{ p.text }}</span><template v-else>{{ p.text }}</template></template></p>
				<div v-if="editing !== c.id && (mayEdit(c) || mayDelete(c))" class="knorke-comment__actions">
					<button v-if="mayEdit(c)"
						type="button"
						class="knorke-comment__action"
						data-knorke-action="comment-edit"
						@click="startEdit(c)">
						{{ t('knorke', 'Edit') }}
					</button>
					<button v-if="mayDelete(c)"
						type="button"
						class="knorke-comment__action"
						data-knorke-action="comment-delete"
						@click="$emit('delete', c.id, c.id === thread.id)">
						{{ t('knorke', 'Delete') }}
					</button>
				</div>
			</li>
		</ol>
		<div v-if="canReply" class="knorke-thread__foot">
			<CommentEditor ref="editor"
				:key="thread ? thread.id : 'new'"
				:kind="thread ? 'reply' : 'new'"
				:initial="draft.text"
				:initial-chosen="draft.chosen"
				:placeholder="thread ? t('knorke', 'Reply…') : t('knorke', 'Write a comment…')"
				:send-label="t('knorke', 'Send')"
				:search="search"
				:busy="busy"
				:autofocus="autofocus"
				@input="(text, chosen) => $emit('draft', { text, chosen })"
				@send="send"
				@escape="$emit('close')" />
		</div>
	</section>
</template>

<script setup>
/*
 * One comment thread (factory job 189): a popover next to its bubble (prop
 * anchor, board px; it moves with the bubble), inside the comment panel
 * for a resolved thread (inPanel, "Back to the list"), full screen on
 * phones (sheet). thread null: the editor of a new thread.
 *
 * - The comments oldest first: name (guests "{name} (guest)"), time,
 *   "(edited)", the text with mentions marked; every part only as text
 *   (comments.js partsView, Vue interpolation; never HTML).
 * - Own comments (mine) have "Edit" and "Delete" while this person may
 *   write; moderators "Delete" on all. Deleting the first comment asks
 *   first (the board view: ConfirmDialog with danger); a reply goes at once.
 * - The head has "Resolve" / "Reopen" (canWrite). The foot "Reply…" only for
 *   an open thread while this person may write (canReply, the board view:
 *   not frozen); its text is kept per thread (prop draft, event draft).
 * - Esc closes (the field's Esc too, when its @ list is shut).
 * - Place (comments.js threadPlace): beside the bubble, moved up when the
 *   bubble is low, never higher than the room below its top; the list
 *   scrolls, head and field stay, so "Send" is always inside the board.
 *
 * The foot is a <div>, never a <footer>: the guest page of Nextcloud places
 * footer elements at the bottom of the window.
 *
 * Events: close, send(text), edit(id, text), delete(id, first), resolve(bool), draft({text, chosen}).
 */
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import CommentEditor from './CommentEditor.vue'
import { icons } from './icons.js'
import { fromWire, partsView, threadPlace, timeLabel } from '../board/comments.js'
import { language, t } from '../util/l10n.js'


const props = defineProps({
	/** the thread (null: a new one) */
	thread: { type: Object, default: null },
	/** board px of the bubble's centre (popover mode) */
	anchor: { type: Object, default: null },
	/** board size {w, h} (popover mode) */
	bounds: { type: Object, default: null },
	/** inside the comment panel */
	inPanel: { type: Boolean, default: false },
	/** full screen (phones) */
	sheet: { type: Boolean, default: false },
	/** this person may write (resolve, reopen, edit and delete own comments) */
	canWrite: { type: Boolean, default: false },
	/** may write a reply or the first comment now (canWrite, not frozen) */
	canReply: { type: Boolean, default: false },
	/** moderator: "Delete" on every comment */
	canModerate: { type: Boolean, default: false },
	/** the @ list ((q) => Promise<[{id, name}]>), null for guests */
	search: { type: Function, default: null },
	/** the unsent text of this thread {text, chosen} */
	draft: { type: Object, default: () => ({ text: '', chosen: [] }) },
	busy: { type: Boolean, default: false },
	/** server time for the time labels */
	now: { type: Number, default: 0 },
	/** the field takes the focus when the thread opens */
	autofocus: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'send', 'edit', 'delete', 'resolve', 'draft'])

const root = ref(null)
const editor = ref(null)
/** the comment being edited, null without one */
const editing = ref(null)
const editStart = ref({ text: '', chosen: [] })
const lang = language()

const placeStyle = computed(() => {
	if (props.sheet || props.inPanel || !props.anchor) {
		return undefined
	}
	// beside the bubble, its height bound to the room below its top (comments.js threadPlace)
	const p = threadPlace(props.anchor, props.bounds)
	return { left: p.left + 'px', top: p.top + 'px', ...(p.maxHeight === null ? {} : { maxHeight: p.maxHeight + 'px' }) }
})

/**
 * @param {number} ms time of a comment
 * @return {string}
 */
function timeOf(ms) {
	return timeLabel(ms, props.now || Date.now(), lang)
}

/** @param {object} c comment @return {boolean} */
function mayEdit(c) {
	return c.mine === true && props.canWrite
}

/** @param {object} c comment @return {boolean} */
function mayDelete(c) {
	return (c.mine === true && props.canWrite) || props.canModerate
}

/** @param {object} c own comment */
function startEdit(c) {
	editStart.value = fromWire(c.raw ?? c.parts.filter((p) => typeof p === 'string').join(''), c.mentions ?? null)
	editing.value = c.id
}

/**
 * @param {string} id comment
 * @param {string} text wire text
 */
function saveEdit(id, text) {
	emit('edit', id, text)
	editing.value = null
}

/** @param {string} text wire text of the reply or the first comment */
function send(text) {
	emit('send', text)
}

/** Empties the reply field (the board view calls it after the send went through). */
function cleared() {
	editor.value?.clear?.()
}

defineExpose({ cleared, root })
</script>
