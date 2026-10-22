<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog v-if="!confirm && !presenting"
		:name="t('knorke', 'Share board')"
		size="normal"
		class="knorke-dialog knorke-share"
		@update:open="(o) => !o && $emit('close')">
		<div class="knorke-share__tabs" role="tablist" :aria-label="t('knorke', 'Share board')">
			<NcButton v-if="owner"
				:variant="tab === 'people' ? 'secondary' : 'tertiary'"
				role="tab"
				:aria-selected="tab === 'people' ? 'true' : 'false'"
				data-knorke-share-tab="people"
				@click="tab = 'people'">
				{{ t('knorke', 'People') }}
			</NcButton>
			<NcButton :variant="tab === 'links' ? 'secondary' : 'tertiary'"
				role="tab"
				:aria-selected="tab === 'links' ? 'true' : 'false'"
				data-knorke-share-tab="links"
				@click="tab = 'links'">
				{{ t('knorke', 'Links') }}
			</NcButton>
		</div>
		<div class="knorke-share__panel" role="tabpanel">
			<SharePeople v-if="tab === 'people' && owner"
				:board-id="boardId"
				:shares="draft"
				:stored="stored"
				:policy="policy"
				:loaded="loaded"
				:busy="busy"
				:error="peopleError"
				@update:shares="onDraft"
				@save="saveShares" />
			<ShareLinks v-else
				:links="links"
				:links-allowed="linksAllowed"
				:link-policy="linkPolicy"
				:read-only="!owner"
				:loaded="loaded || hasSnapshotLinks"
				:busy="busy"
				:drafts="drafts"
				:settings-open="settingsOpen"
				:qr-open="qrOpen"
				:errors="linkErrors"
				:today="today"
				@toggle="toggleLink"
				@rotate="(role) => ask({ kind: 'rotate', role })"
				@save="saveLink"
				@remove-password="removePassword"
				@update:draft="setDraft"
				@fix-policy="fixPolicy"
				@qr="(role) => { qrOpen[role] = !qrOpen[role] }"
				@present="(role) => { presenting = role }" />
		</div>
	</NcDialog>
	<ConfirmDialog v-if="confirm"
		:name="confirm.kind === 'rotate' ? t('knorke', 'Create new link?') : t('knorke', 'Set a new password?')"
		:message="confirm.kind === 'rotate' ? t('knorke', 'The old link and everyone who joined through it lose access.') : t('knorke', 'Everyone who joined through this link will have to enter the password again.')"
		:confirm-label="confirm.kind === 'rotate' ? t('knorke', 'Create new link') : t('knorke', 'Set password')"
		:busy="busy"
		danger
		data-knorke-dialog="link-confirm"
		@confirm="onConfirm"
		@cancel="confirm = null" />
	<PresentLinkDialog v-if="presenting"
		:link="links[presenting]"
		:title="title"
		@close="presenting = null" />
</template>

<script setup>
/*
 * Share dialog v2 (SPEC-M1 §6.6, stage 2): tabs "People" (SharePeople, owner
 * only) and "Links" (ShareLinks). The root keeps the class knorke-share
 * (M0 E2E cases E03, E09, E16).
 *
 * - (R13) "Links" is ALWAYS the active tab on open, for owners and
 *   moderators; [data-knorke-share-tab=people] opens "People". Moderators see
 *   only the "Links" tab, read-only (copy URL, QR code, show to the room).
 * - (R13) Every open loads GET …/shares (route 19): the owner gets
 *   {shares, policy, links, linksAllowed, linkPolicy}, a moderator {links}.
 *   Until it answers "Links" shows board.links of the snapshot (props); 403
 *   or 404 closes the dialog; any other failure (a server before stage 2
 *   answers 501, network) keeps the snapshot's links. An answer that arrives
 *   after a link was changed here does not overwrite that link (the change
 *   is newer).
 * - (R14-07) The "Links" view follows `linksAllowed` of the board view
 *   (snapshot) and of a 403 links_disabled answer here (U12). Of an answer of
 *   route 19 (or 20) only `linksAllowed: true` is applied: it lifts a
 *   disabled view, unless its request started before the last 403
 *   links_disabled (components/share.js linksAllowedAfter). `false` from
 *   route 19 is not applied: the M0 case E16 opens the dialog with a stale
 *   "allowed" view and expects the create button and its 403 path.
 * - (R14-04) "Today" (prefill today + expireDefaultDays, the date picker's
 *   min, the client checks expiryProblem and linkMeetsPolicy) is
 *   linkPolicy.today of the owner's answer of route 19/20, the owner's day;
 *   until that answer it is the browser's local day. A prefill the user did
 *   not touch moves along (components/share.js todayOf, reprefill). A dialog
 *   left open across midnight may still get the server's 400 and shows its
 *   text (accepted, §6.6).
 * - Shares: the "People" tab edits a draft of the complete list; "Save"
 *   sends it (PUT); the answer (same form as GET) replaces list and draft.
 * - Links: turning a link on POSTs at once, except under an enforced policy
 *   (password or expiry): then its settings open first (components/share.js
 *   settingsFirst). Renewing asks first (M0 texts); setting or changing the
 *   password of an existing link asks first ("Everyone who joined through
 *   this link will have to enter the password again."). While a question or
 *   "Show to the room" is open the share dialog steps aside (one modal at a
 *   time, as in M0) and comes back afterwards; its state lives here.
 * - Every link change is reported with `links` (and `linksAllowed` after a
 *   403 links_disabled or a lift by route 19/20), so the board view merges
 *   it (Befund F3).
 */
import { computed, onMounted, reactive, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import * as boardsApi from '../api/boards.js'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'
import { showError } from '../util/toast.js'
import ConfirmDialog from './ConfirmDialog.vue'
import { isLinksDisabled } from './join.js'
import PresentLinkDialog from './PresentLinkDialog.vue'
import { dayOf, errorText, isTightening, linkDraft, linkSaveBody, linksAllowedAfter, normalizePolicy, normalizeShares, reprefill, settingsFirst, todayOf, wireShares } from './share.js'
import ShareLinks from './ShareLinks.vue'
import SharePeople from './SharePeople.vue'

const props = defineProps({
	boardId: { type: Number, required: true },
	/** the viewer owns the board */
	owner: { type: Boolean, default: false },
	/** the viewer may moderate (me.mod); without owner: read-only links */
	mod: { type: Boolean, default: false },
	/** board title (Show to the room) */
	title: { type: String, default: '' },
	/** board.links of the board view ({edit, vote}), may be missing for a moderator */
	links: { type: Object, default: null },
	/** board.linksAllowed of the board view (owner only; missing = allowed) */
	linksAllowed: { type: Boolean, default: null },
	/** board.linkPolicy of the snapshot (owner only, stage 2) */
	linkPolicy: { type: Object, default: null },
})

const emit = defineEmits(['close', 'links'])

const ROLES = ['edit', 'vote']
/** 'YYYY-MM-DD': the browser's local day until route 19 answers with linkPolicy.today (R14-04) */
const today = ref(dayOf(new Date()))
const tab = ref('links')
const loaded = ref(false)
const busy = ref(false)
const hasSnapshotLinks = !!(props.links && typeof props.links === 'object')
const links = ref({ edit: props.links?.edit ?? null, vote: props.links?.vote ?? null })
const linksAllowed = ref(props.linksAllowed !== false)
const linkPolicy = ref(normalizePolicy(props.linkPolicy))
const stored = ref([])
const draft = ref([])
const policy = ref(null)
const peopleError = ref(null)
const drafts = reactive({ edit: linkDraft(links.value.edit, linkPolicy.value, today.value), vote: linkDraft(links.value.vote, linkPolicy.value, today.value) })
const settingsOpen = reactive({ edit: false, vote: false })
const qrOpen = reactive({ edit: false, vote: false })
const linkErrors = reactive({ edit: null, vote: null })
/** {kind: 'rotate'|'tighten', role, body?} */
const confirm = ref(null)
/** role whose link is shown to the room, or null */
const presenting = ref(null)
/** Counts link changes made here; a route-19 answer older than one keeps the newer link. */
let linkChanges = 0
/** Counts 403 links_disabled answers; an answer to an older request does not lift the disabled view (R14-07). */
let disabledSeq = 0

const readOnly = computed(() => !props.owner)

onMounted(load)

/** Route 19 on every open (R13). */
async function load() {
	const changesAtStart = linkChanges
	const disabledAtStart = disabledSeq
	try {
		const res = await boardsApi.listShares(props.boardId)
		apply(res, changesAtStart === linkChanges)
		liftLinks(res, disabledAtStart)
	} catch (e) {
		if (e instanceof HttpError && (e.status === 403 || e.status === 404)) {
			emit('close')
			return
		}
		// 501 before the server's stage 2, network: the snapshot's links stay
		console.warn('[knorke] shares could not be loaded', e)
	} finally {
		loaded.value = true
	}
}

/**
 * @param {object} res answer of GET or PUT …/shares
 * @param {boolean} takeLinks no link was changed here since the request started
 */
function apply(res, takeLinks) {
	if (!res || typeof res !== 'object') {
		return
	}
	if (takeLinks && res.links && typeof res.links === 'object') {
		setLinks({ edit: res.links.edit ?? null, vote: res.links.vote ?? null })
	}
	if (res.linkPolicy && typeof res.linkPolicy === 'object') {
		const before = { policy: linkPolicy.value, today: today.value }
		linkPolicy.value = normalizePolicy(res.linkPolicy)
		// R14-04: the owner's day from route 19/20; an answer without it keeps the day so far
		today.value = todayOf(res.linkPolicy, today.value)
		const after = { policy: linkPolicy.value, today: today.value }
		for (const role of ROLES) {
			if (!links.value[role]) {
				// open settings keep what the user typed or picked; an untouched prefill moves along
				drafts[role] = settingsOpen[role] ? reprefill(drafts[role], before, after) : linkDraft(null, after.policy, after.today)
			}
		}
	}
	if (!readOnly.value && Array.isArray(res.shares)) {
		stored.value = normalizeShares(res.shares)
		draft.value = [...stored.value]
	}
	if (!readOnly.value && res.policy && typeof res.policy === 'object') {
		policy.value = res.policy
	}
}

/**
 * R14-07: `linksAllowed: true` of an answer of route 19/20 lifts a disabled
 * "Links" view (also in the board view); `false` is not applied.
 *
 * @param {object} res answer of GET or PUT …/shares
 * @param {number} disabledAtStart disabledSeq when the request started
 */
function liftLinks(res, disabledAtStart) {
	const next = linksAllowedAfter(linksAllowed.value, res, disabledAtStart !== disabledSeq)
	if (next !== linksAllowed.value) {
		linksAllowed.value = next
		emit('links', { linksAllowed: next })
	}
}

/** @param {{edit: object|null, vote: object|null}} next links */
function setLinks(next) {
	for (const role of ROLES) {
		const before = links.value[role]
		const after = next[role]
		if (JSON.stringify(before) !== JSON.stringify(after)) {
			drafts[role] = linkDraft(after, linkPolicy.value, today.value)
		}
	}
	links.value = next
	emit('links', { links: { ...next } })
}

/**
 * @param {'edit'|'vote'} role link role
 * @param {object|null} link new link of that role
 */
function setLink(role, link) {
	linkChanges++
	setLinks({ ...links.value, [role]: link ?? null })
}

/** @param {object[]} rows new draft of the share list */
function onDraft(rows) {
	draft.value = rows
	peopleError.value = null
}

async function saveShares() {
	if (busy.value || readOnly.value) {
		return
	}
	const sent = draft.value
	const disabledAtStart = disabledSeq
	busy.value = true
	peopleError.value = null
	try {
		const res = await boardsApi.saveShares(props.boardId, wireShares(sent))
		apply(res, false)
		liftLinks(res, disabledAtStart)
	} catch (e) {
		if (e instanceof HttpError && e.status === 404) {
			emit('close')
			return
		}
		peopleError.value = errorText(e, { shares: sent })
	} finally {
		busy.value = false
	}
}

/**
 * @param {'edit'|'vote'} role link role
 * @param {object} draftRow new settings draft
 */
function setDraft(role, draftRow) {
	drafts[role] = draftRow
	linkErrors[role] = null
}

/**
 * Turn on (or open the settings first under an enforced policy) / turn off.
 *
 * @param {'edit'|'vote'} role link role
 */
async function toggleLink(role) {
	if (busy.value || readOnly.value) {
		return
	}
	linkErrors[role] = null
	const link = links.value[role]
	if (link) {
		await linkCall(role, () => boardsApi.linkCalls(role).disable(props.boardId), () => setLink(role, null))
		settingsOpen[role] = false
		qrOpen[role] = false
		return
	}
	if (settingsFirst(linkPolicy.value)) {
		// R13 (CLI-07): nothing is created yet; the settings ask for what the policy needs
		drafts[role] = linkDraft(null, linkPolicy.value, today.value)
		settingsOpen[role] = !settingsOpen[role]
		return
	}
	await linkCall(role, () => boardsApi.linkCalls(role).enable(props.boardId, {}), (l) => setLink(role, l))
}

/**
 * "Save" of a section: create under an enforced policy, or change password
 * and expiry of the active link (a new password asks first).
 *
 * @param {'edit'|'vote'} role link role
 */
async function saveLink(role) {
	if (busy.value || readOnly.value) {
		return
	}
	const link = links.value[role]
	const body = linkSaveBody(link, drafts[role])
	if (isTightening(link, body)) {
		ask({ kind: 'tighten', role, body })
		return
	}
	await postLink(role, body)
}

/**
 * @param {'edit'|'vote'} role link role
 * @param {object} body POST body
 */
async function postLink(role, body) {
	linkErrors[role] = null
	await linkCall(role, () => boardsApi.linkCalls(role).enable(props.boardId, body), (l) => {
		setLink(role, l)
		settingsOpen[role] = false
	})
}

/** @param {'edit'|'vote'} role link role */
async function removePassword(role) {
	if (busy.value || readOnly.value || !links.value[role]) {
		return
	}
	await postLink(role, { password: null })
}

/**
 * The link misses what the policy now asks for (not retroactive): prefill
 * the expiry when it is enforced and missing; the password field is there.
 *
 * @param {'edit'|'vote'} role link role
 */
function fixPolicy(role) {
	const p = linkPolicy.value
	const d = { ...drafts[role] }
	if (p.expireEnforced && d.expiry === '') {
		d.expiry = linkDraft(null, p, today.value).expiry
	}
	drafts[role] = d
}

/** @param {{kind: string, role: string, body?: object}} q question */
function ask(q) {
	if (busy.value || readOnly.value) {
		return
	}
	confirm.value = q
}

async function onConfirm() {
	const q = confirm.value
	if (!q) {
		return
	}
	if (q.kind === 'rotate') {
		await linkCall(q.role, () => boardsApi.linkCalls(q.role).enable(props.boardId, { rotate: true }), (l) => setLink(q.role, l))
	} else {
		await postLink(q.role, q.body)
	}
	confirm.value = null
}

/**
 * Runs one link request; errors go to the section (hook
 * [data-knorke-error=<code>]); 403 links_disabled switches to the disabled
 * view (U12).
 *
 * @param {'edit'|'vote'} role link role
 * @param {() => Promise<any>} fn request
 * @param {(res: any) => void} done on success
 */
async function linkCall(role, fn, done) {
	busy.value = true
	linkChanges++
	try {
		done(await fn())
	} catch (e) {
		if (isLinksDisabled(e)) {
			disabledSeq++
			linksAllowed.value = false
			emit('links', { linksAllowed: false })
		} else if (e instanceof HttpError && e.status === 404) {
			emit('close')
		} else if (e instanceof HttpError && e.fromApp && e.status >= 400 && e.status < 500) {
			const x = errorText(e)
			linkErrors[role] = x
			if (x.field !== null && !links.value[role] && !settingsOpen[role]) {
				// the policy changed since the dialog loaded it: ask for what the server wants
				settingsOpen[role] = true
			}
		} else {
			showError(t('knorke', 'The link could not be changed.'))
		}
	} finally {
		busy.value = false
	}
}
</script>
