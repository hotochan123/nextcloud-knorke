<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section :id="id"
		ref="root"
		class="knorke-privacy-info"
		data-knorke="privacy-info"
		:data-knorke-privacy-kind="kind"
		:aria-labelledby="id + '-title'"
		@keydown.esc.stop.prevent="close">
		<header class="knorke-privacy-info__head">
			<h2 :id="id + '-title'" class="knorke-privacy-info__title">
				{{ t('knorke', 'Privacy notice') }}
			</h2>
			<button ref="closeButton"
				type="button"
				class="knorke-privacy-info__close"
				:aria-label="t('knorke', 'Close privacy notice')"
				:title="t('knorke', 'Close privacy notice')"
				data-knorke-action="privacy-close"
				@click="close">
				<NcIconSvgWrapper :path="icons.close" :size="20" />
			</button>
		</header>
		<div ref="body"
			class="knorke-privacy-info__body"
			:tabindex="scrolls ? 0 : null"
			:role="scrolls ? 'region' : null"
			:aria-label="scrolls ? t('knorke', 'Privacy notice') : null">
			<p v-if="kind === 'account'" class="knorke-privacy-info__explain">
				{{ explain }}
			</p>
			<p class="knorke-privacy-info__text" data-knorke-privacy-text>
				{{ text }}
			</p>
		</div>
		<a v-if="url !== ''"
			class="knorke-privacy-info__link"
			:href="url"
			target="_blank"
			rel="noopener noreferrer"
			data-knorke-privacy-link>{{ t('knorke', 'Privacy policy') }}</a>
	</section>
</template>

<script setup>
/*
 * The privacy info card (M2 privacy notice), shared by guests and accounts:
 * kind 'guest' (a returning guest, once per tab session) or 'account'
 * (the one-time info on a board open by link, or opened through the
 * "Open by link" badge). BoardView puts it as the last child of
 * .knorke-banners, inside the existing aria-live="polite" region, so a
 * screen reader reads it when it appears; it is no banner strip
 * (components/bars.js) and carries neither .knorke-banner nor
 * data-knorke-bar.
 *
 * Content: the heading, for accounts first the explanation, the notice text
 * (the admin's or the built-in one – for the voting role its own wording,
 * components/privacy.js –, line breaks kept) and, when the URL is
 * an absolute http(s) URL, the privacy policy link in a new tab. The link is
 * deliberately no [data-knorke-legal] (E15 counts those). Text only through
 * Vue interpolation, never as HTML: a "<script>" of the admin stays text.
 *
 * Esc with the focus inside closes it (handled here, stopPropagation: no
 * canvas action, and Nextcloud's header menus cancel every Esc, trap 47).
 * The text part scrolls on its own (max height) and only then joins the tab
 * order (tabindex 0, a named region). Where the focus goes after closing is
 * BoardView's decision (event close {focusInside}).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { icons } from './icons.js'
import { explainText, noticeText, noticeUrl } from './privacy.js'
import { t } from '../util/l10n.js'

const props = defineProps({
	/** element id (the badge's aria-controls) */
	id: { type: String, required: true },
	/** 'guest' | 'account' */
	kind: { type: String, default: 'guest' },
	/** initial state `privacy` ({text, url}) */
	privacy: { type: Object, default: null },
	/** the person can only vote (role vote): the built-in text of the voting role */
	vote: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const root = ref(null)
const body = ref(null)
const closeButton = ref(null)
const scrolls = ref(false)
const text = computed(() => noticeText(props.privacy, { vote: props.vote }))
const explain = computed(() => explainText())
const url = computed(() => noticeUrl(props.privacy))
let observer = null

/** The text part scrolls: then (and only then) it is reachable with Tab. */
function measure() {
	const el = body.value
	scrolls.value = !!el && el.scrollHeight > el.clientHeight + 1
}

onMounted(async () => {
	await nextTick()
	measure()
	if (typeof ResizeObserver === 'function' && body.value) {
		observer = new ResizeObserver(() => measure())
		observer.observe(body.value)
	} else {
		window.addEventListener('resize', measure)
	}
})

onBeforeUnmount(() => {
	observer?.disconnect()
	observer = null
	window.removeEventListener('resize', measure)
})

function close() {
	const active = typeof document !== 'undefined' ? document.activeElement : null
	emit('close', { focusInside: !!(root.value && active && root.value.contains(active)) })
}

/** Moves the focus to the close button (opened through the badge). */
function focusClose() {
	closeButton.value?.focus()
}

defineExpose({ focusClose })
</script>
