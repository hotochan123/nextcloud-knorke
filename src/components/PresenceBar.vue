<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="root"
		class="knorke-presence"
		role="group"
		:aria-label="t('knorke', 'Participants')"
		:aria-describedby="hintId"
		:title="hint">
		<span :id="hintId" class="hidden-visually">{{ hint }}</span>
		<template v-if="!compact">
			<template v-for="p in shown" :key="p.pid">
				<button v-if="clickable(p)"
					type="button"
					class="knorke-presence__item"
					:class="itemClass(p)"
					:style="{ backgroundColor: p.color }"
					:title="titleOf(p)"
					:aria-label="nameOf(p)"
					:aria-pressed="p.self ? null : (isFollowed(p) ? 'true' : 'false')"
					:data-knorke-participant="p.self ? null : p.pid"
					@click="pick(p)">
					<span aria-hidden="true">{{ initials(p.name) }}</span>
				</button>
				<span v-else
					class="knorke-presence__item"
					:class="itemClass(p)"
					:style="{ backgroundColor: p.color }"
					:title="titleOf(p)">
					<span aria-hidden="true">{{ initials(p.name) }}</span>
					<span class="hidden-visually">{{ titleOf(p) }}</span>
				</span>
			</template>
		</template>
		<button v-if="compact || more > 0"
			ref="button"
			type="button"
			class="knorke-presence__item knorke-presence__item--more"
			:aria-expanded="open ? 'true' : 'false'"
			:aria-controls="id"
			:aria-label="moreLabel"
			:title="moreLabel"
			data-knorke-action="participants"
			@click="toggle">
			+{{ compact ? participants.length : more }}
		</button>
		<div v-if="open"
			:id="id"
			class="knorke-popover knorke-presence__popover">
			<p class="knorke-popover__hint">
				{{ hint }}
			</p>
			<ul class="knorke-presence__list">
				<li v-for="p in listed" :key="p.pid">
					<button type="button"
						class="knorke-presence__row"
						:disabled="!clickable(p)"
						:title="titleOf(p)"
						:aria-label="nameOf(p)"
						:aria-pressed="p.self ? null : (isFollowed(p) ? 'true' : 'false')"
						:data-knorke-participant="p.self ? null : p.pid"
						@click="pick(p, true)">
						<span class="knorke-presence__item knorke-presence__item--small"
							:class="itemClass(p)"
							:style="{ backgroundColor: p.color }"
							aria-hidden="true">{{ initials(p.name) }}</span>
						<span class="knorke-presence__name">{{ nameOf(p) }}</span>
					</button>
				</li>
			</ul>
		</div>
	</div>
</template>

<script setup>
/*
 * Participant bar (SPEC-M0 §6.6, SPEC-M1 §6.6 stage 3): initials in the pid
 * colour, guests marked. No NcAvatar: it pulls lazy chunks and
 * NcProfileHoverCard, and guests have no avatar anyway. Names are data:
 * only interpolation, never markup.
 *
 * Stage 3: every other participant is a <button> [data-knorke-participant=
 * <pid>] with aria-pressed (this tab follows them); a click follows (emit
 * follow). The own entry of a moderator is a button "Bring everyone here"
 * (emit summon; no hook of its own, §6.8); for everyone else it is plain.
 * The hint "People on tablets or voting don't appear here." sits on the bar
 * (title and description, §7.2: they send no presence). More than MAX_SHOWN,
 * or the narrow layout (compact): a button "+{n}" [data-knorke-action=
 * participants] opens the list in a popover (with the same participant
 * buttons).
 *
 * Names and hints (SPEC-M1 §6.12, R18/R19 A-03, T4-25): the buttons of the
 * other participants are toggle buttons (aria-pressed = this tab follows
 * them) with one fixed name, label(p), in bar and popover; what a click does
 * ("· Follow" / "· Stop following") is only the hint (title = titleOf(p)),
 * and the popover row shows label(p). The own entry of a moderator is an
 * action button without aria-pressed: name, hint and row text stay
 * titleOf(p) ("{name} (you) · Bring everyone here"). Everyone else's own
 * entry is plain (bar) or a disabled row (popover) named label(p).
 */
import { computed } from 'vue'
import { n, t } from '../util/l10n.js'
import { usePopover } from './popover.js'

const MAX_SHOWN = 8

const props = defineProps({
	participants: { type: Array, default: () => [] },
	/** pid this tab follows, or null */
	following: { type: String, default: null },
	/** this client may moderate (own entry: "Bring everyone here") */
	mod: { type: Boolean, default: false },
	/** narrow layout: only the "+{n}" button */
	compact: { type: Boolean, default: false },
})

const emit = defineEmits(['follow', 'summon'])

const { open, root, button, id, toggle, close } = usePopover()
const hintId = id + '-hint'
const hint = computed(() => t('knorke', 'People on tablets or voting don\'t appear here.'))
const shown = computed(() => props.participants.slice(0, MAX_SHOWN))
const more = computed(() => Math.max(0, props.participants.length - MAX_SHOWN))
const listed = computed(() => (props.compact ? props.participants : props.participants.slice(MAX_SHOWN)))
const moreLabel = computed(() => n('knorke', '%n participant', '%n participants', props.participants.length))

/**
 * @param {string} name display name
 * @return {string} one or two initials
 */
function initials(name) {
	const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
	if (parts.length === 0) {
		return '?'
	}
	const first = Array.from(parts[0])[0] ?? ''
	const second = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : ''
	return (first + second).toUpperCase()
}

/**
 * @param {{name: string, guest: boolean, self: boolean}} p participant
 * @return {string} accessible label
 */
function label(p) {
	const base = p.guest ? t('knorke', '{name} (guest)', { name: p.name }) : p.name
	return p.self ? t('knorke', '{name} (you)', { name: base }) : base
}

/**
 * @param {object} p participant
 * @return {string} title and name of the button
 */
function titleOf(p) {
	if (p.self) {
		return props.mod ? label(p) + ' · ' + t('knorke', 'Bring everyone here') : label(p)
	}
	return isFollowed(p) ? label(p) + ' · ' + t('knorke', 'Stop following') : label(p) + ' · ' + t('knorke', 'Follow')
}

/**
 * @param {object} p participant
 * @return {string} accessible name: label(p) for a toggle (another participant)
 *   and for a plain own entry; titleOf(p) for a moderator's own action button
 */
function nameOf(p) {
	return p.self && props.mod ? titleOf(p) : label(p)
}

/**
 * @param {object} p participant
 * @return {boolean} this tab follows p
 */
function isFollowed(p) {
	return props.following !== null && props.following === p.pid
}

/**
 * @param {object} p participant
 * @return {boolean} the entry does something on click
 */
function clickable(p) {
	return !p.self || props.mod
}

/**
 * @param {object} p participant
 * @return {object} classes
 */
function itemClass(p) {
	return { 'knorke-presence__item--guest': p.guest, 'knorke-presence__item--self': p.self, 'knorke-presence__item--followed': isFollowed(p) }
}

/**
 * @param {object} p participant
 * @param {boolean} [fromList] chosen in the popover (closes it)
 */
function pick(p, fromList = false) {
	if (fromList) {
		close(false)
	}
	if (p.self) {
		if (props.mod) {
			emit('summon')
		}
		return
	}
	emit('follow', p.pid, isFollowed(p))
}
</script>
