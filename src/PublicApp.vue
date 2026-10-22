<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-public" :data-knorke-features="features">
		<template v-if="phase === 'revoked' || phase === 'invalid' || phase === 'disabled' || phase === 'expired'">
			<div class="knorke-public__card">
				<NcEmptyContent v-if="phase === 'revoked'"
					data-knorke-banner="revoked"
					:name="t('knorke', 'This link was revoked')"
					:description="t('knorke', 'Ask the person who shared the board for the new link.')" />
				<NcEmptyContent v-else-if="phase === 'disabled'"
					data-knorke-banner="links_disabled"
					:name="t('knorke', 'Link sharing is disabled')"
					:description="t('knorke', 'The administrator of this Nextcloud does not allow sharing by link, so this board cannot be opened through it.')" />
				<NcEmptyContent v-else-if="phase === 'expired'"
					data-knorke-banner="expired"
					:name="t('knorke', 'This link has expired.')"
					:description="t('knorke', 'Ask the person who shared the board for the new link.')" />
				<NcEmptyContent v-else
					data-knorke-banner="invalid"
					:name="t('knorke', 'This link is invalid')"
					:description="t('knorke', 'Check that you copied the whole link.')" />
			</div>
			<LegalLinks class="knorke-public__legal" :legal="legal" />
		</template>
		<template v-else>
			<GuestNameDialog v-if="phase === 'name'"
				:key="nameKey"
				:initial-name="lastName"
				:max-length="nameMax"
				:error="joinError"
				:legal="legal"
				:needs-password="needsPassword"
				:password-error="passwordError"
				:password-code="passwordCode"
				:link-role="linkRole"
				:privacy="privacy"
				@join="onName" />
			<BoardView v-if="phase === 'board'"
				:key="viewKey"
				mode="guest"
				:board-id="boardId"
				:link-token="linkToken"
				:guest-name="guestName"
				:guest-password="guestPassword"
				:debug="state.debug === true"
				:limits="state.limits || {}"
				:legal="legal"
				:privacy="privacy"
				:guest-privacy-info="guestPrivacyInfo"
				@open-failed="onOpenFailed"
				@opened="onOpened"
				@password-required="onPasswordRequired" />
		</template>
	</div>
</template>

<script setup>
/*
 * Guest shell (SPEC-M0 §6.6): the public page of an edit link.
 * - linkState 'revoked' / 'invalid' → empty state, no join
 *   ([data-knorke-banner=revoked|invalid])
 * - a stored guest for this board (localStorage knorke.guest.<boardId>) →
 *   silent join with the current link and the old token, so the guest keeps
 *   the same identity (pid) across reloads and link renewals
 * - otherwise the name dialog, then the board
 * A join answering 404 forgets the stored guest and shows the name dialog;
 * 403 link_revoked shows the revoked state; (U12) 403 links_disabled the
 * final "link sharing is disabled" state ([data-knorke-banner=links_disabled]).
 * The decisions live in components/join.js.
 *
 * SPEC-M0 §16.2 / SPEC-M1 §1.4: the empty states sit in a
 * .knorke-public__card (Nextcloud's guest-box look: main background, main
 * text) instead of directly on the theming background, so name and
 * description keep ≥ 4.5:1 contrast in the light and the dark theme.
 * SPEC-M1 §4.2: 403 link_expired (and linkState 'expired') → 'expired'
 * ([data-knorke-banner=expired], no failed attempt on the server).
 *
 * SPEC-M1 stage 2 (§4.11.3, §4.11.4, §6.4, §6.6):
 * - linkInfo {role, password} of the page: a link with password shows the
 *   password field in the name dialog from the start; the password goes
 *   with the join and is never stored (only kept in memory for this join).
 * - A join answering password_required / password_wrong / the lock-out
 *   (429 slow_down reason 'password', never repeated) comes back to the
 *   name phase with the hint at the password field (join.js).
 * - An open board view that froze with 'password_required' (the automatic
 *   re-join after a password change) hands over once its unsent texts went
 *   to the copy dialog (BoardView): the name phase with the stored name, the
 *   password field and "Enter the password for this board.".
 * - The root carries data-knorke-features ("voting" when FEATURES.voting,
 *   else ""), so E cases can tell stage 2 from stage 3 (R13).
 *
 * (U9) Nextcloud's footer stays hidden (F7), so the instance's imprint and
 * privacy links (initial state `legal`) appear in the name dialog, in the
 * guest top bar menu and under the empty states.
 *
 * SPEC-M1 §6.5.3: guests (also kiosk devices shared by many people) drop the
 * stored copy (localStorage knorke.clip) when the page goes away (pagehide).
 *
 * M2 privacy notice (components/privacy.js): the name dialog shows the
 * notice (initial state `privacy`) above the name field; showing the name
 * phase marks the tab session (sessionStorage knorke.privacy.<boardId> =
 * '1'). A returning guest (stored identity, no dialog) without that mark
 * gets it set at once and the board view shows the info card when ready
 * (guestPrivacyInfo). A reload in the same tab – also the automatic one
 * after 409 protocol (location.replace) – keeps the mark: no card; a new
 * tab is a new session. Without usable sessionStorage the card shows on
 * every open.
 */
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import GuestNameDialog from './components/GuestNameDialog.vue'
import LegalLinks from './components/LegalLinks.vue'
import { guestJoinOutcome } from './components/join.js'
import { guestInfoDue, markGuestSeen } from './components/privacy.js'
import { FEATURES } from './util/features.js'
import { t } from './util/l10n.js'
import { getJson, keys, removeItem, webStorage } from './util/storage.js'
import BoardView from './views/BoardView.vue'

const state = inject('knorke-state', {})
const boardId = Number.isInteger(state.boardId) ? state.boardId : null
const linkToken = typeof state.linkToken === 'string' ? state.linkToken : null
const nameMax = state.limits?.nameMax || 40
const legal = state.legal && typeof state.legal === 'object' ? state.legal : null
const linkInfo = state.linkInfo && typeof state.linkInfo === 'object' ? state.linkInfo : null
const linkRole = linkInfo?.role === 'vote' ? 'vote' : 'edit'
const privacy = state.privacy && typeof state.privacy === 'object' ? state.privacy : null
const features = FEATURES.voting ? 'voting' : ''

const stored = boardId !== null ? getJson('local', keys.guest(boardId)) : null
const hasStored = !!(stored && typeof stored.token === 'string' && stored.token !== '')

/** @return {'revoked'|'expired'|'invalid'|'name'|'board'} first phase from the initial state */
function initialPhase() {
	if (state.linkState === 'revoked') {
		return 'revoked'
	}
	if (state.linkState === 'expired') {
		return 'expired'
	}
	if (state.linkState !== 'ok' || boardId === null || linkToken === null) {
		return 'invalid'
	}
	return hasStored ? 'board' : 'name'
}

/** SPEC-M1 §6.5.3: no copy of board content stays behind on a guest device. */
function dropClip() {
	removeItem('local', keys.clip())
}

onMounted(() => {
	window.addEventListener('pagehide', dropClip)
})

onBeforeUnmount(() => {
	window.removeEventListener('pagehide', dropClip)
})

const phase = ref(initialPhase())
const guestName = ref(null)
const guestPassword = ref(null)
const lastName = ref(hasStored && typeof stored.name === 'string' ? stored.name : '')
const joinError = ref('')
const needsPassword = ref(linkInfo?.password === true)
const passwordError = ref('')
const passwordCode = ref('')
const viewKey = ref(0)
/** New dialog instance per name phase (it keeps the typed password otherwise). */
const nameKey = ref(0)

const privacyStorage = webStorage()
/** A returning guest gets the privacy info card in the board view (once per tab session). */
const guestPrivacyInfo = ref(false)
if (boardId !== null && phase.value === 'board' && guestInfoDue(privacyStorage, boardId)) {
	markGuestSeen(privacyStorage, boardId)
	guestPrivacyInfo.value = true
}
// the name phase shows the notice: this tab session has seen it
watch(phase, (p) => {
	if (p === 'name' && boardId !== null) {
		markGuestSeen(privacyStorage, boardId)
		guestPrivacyInfo.value = false
	}
}, { immediate: true })

/**
 * @param {string} name chosen display name
 * @param {string|null} password link password (when the link needs one)
 */
function onName(name, password = null) {
	joinError.value = ''
	passwordError.value = ''
	passwordCode.value = ''
	lastName.value = name
	guestName.value = name
	guestPassword.value = typeof password === 'string' && password !== '' ? password : null
	viewKey.value++
	phase.value = 'board'
}

/** The join went through: the password is not kept any longer than needed. */
function onOpened() {
	guestPassword.value = null
}

/**
 * Back to the name phase.
 *
 * @param {{error?: string, needsPassword?: boolean, passwordError?: string, passwordCode?: string}} o outcome
 */
function toName(o) {
	guestPassword.value = null
	joinError.value = o.error ?? ''
	if (o.needsPassword) {
		needsPassword.value = true
	}
	passwordError.value = o.passwordError ?? ''
	passwordCode.value = o.passwordCode ?? ''
	nameKey.value++
	phase.value = 'name'
}

/**
 * The open board view needs the link password (SPEC-M1 §6.4): back to the
 * name phase with the stored name, the password field and the hint – after
 * the password lock-out (R13) its text with the minutes.
 *
 * @param {{lockText?: string}} [info] from BoardView's hand-over
 */
function onPasswordRequired(info = {}) {
	const g = boardId !== null ? getJson('local', keys.guest(boardId)) : null
	if (g && typeof g.name === 'string' && g.name !== '') {
		lastName.value = g.name
	}
	guestName.value = null
	if (typeof info?.lockText === 'string' && info.lockText !== '') {
		toName({ error: '', needsPassword: true, passwordError: info.lockText, passwordCode: 'slow_down' })
		return
	}
	toName({ error: '', needsPassword: true, passwordError: t('knorke', 'Enter the password for this board.'), passwordCode: 'password_required' })
}

/** @param {unknown} e error of the join */
function onOpenFailed(e) {
	const o = guestJoinOutcome(e)
	if (o === null) {
		return
	}
	if (o.phase === 'name') {
		toName(o)
	} else {
		guestPassword.value = null
		phase.value = o.phase
	}
}
</script>
