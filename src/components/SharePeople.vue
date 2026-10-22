<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-people">
		<div v-if="!loaded" class="knorke-people__loading">
			<NcLoadingIcon :size="28" :name="t('knorke', 'Loading …')" />
		</div>
		<template v-else>
			<NcNoteCard v-if="sharingOff"
				type="warning"
				data-knorke-error="sharing_disabled">
				{{ t('knorke', 'Sharing is turned off for your account.') }}
			</NcNoteCard>
			<template v-else>
				<NcSelect v-model="picked"
					class="knorke-people__search"
					:options="options"
					:loading="searching"
					:filter-by="keepServerHits"
					label="displayName"
					:input-label="t('knorke', 'Search people, groups or teams')"
					:placeholder="t('knorke', 'Search people, groups or teams')"
					:disabled="busy"
					data-knorke-field="sharee-search"
					@search="onSearch"
					@update:model-value="add">
					<template #option="o">
						<span class="knorke-sharee" :data-knorke-sharee="o.id">
							<span class="knorke-people__icon" aria-hidden="true">
								<NcIconSvgWrapper :path="o.kind === 'group' ? icons.group : o.kind === 'team' ? icons.team : icons.account" />
							</span>
							<span class="knorke-people__who">
								<span class="knorke-people__name">{{ o.displayName }}</span>
								<span v-if="o.subname" class="knorke-people__kind">{{ o.subname }}</span>
								<span v-if="o.appAccess === false" class="knorke-people__noapp" data-knorke-note="app-access">{{ t('knorke', 'Cannot open Knorke') }}</span>
							</span>
						</span>
					</template>
				</NcSelect>
				<p v-if="searchNote"
					class="knorke-people__note"
					:data-knorke-error="searchNote.code || null"
					role="status">
					{{ searchNote.text }}
				</p>
			</template>
			<p v-if="generalError"
				class="knorke-dialog__error"
				role="alert"
				:data-knorke-error="generalError.code">
				{{ generalError.text }}
			</p>
			<p v-if="shares.length === 0" class="knorke-people__empty">
				{{ t('knorke', 'Not shared with anyone yet.') }}
			</p>
			<ul v-else class="knorke-people__list">
				<li v-for="(s, i) in shares"
					:key="shareKey(s)"
					class="knorke-people__row"
					:class="{ 'knorke-people__row--off': !s.available }"
					:data-knorke-share-item="shareKey(s)"
					:data-knorke-share-role="s.role">
					<span class="knorke-people__icon" aria-hidden="true">
						<NcIconSvgWrapper :path="s.kind === 'group' ? icons.group : s.kind === 'team' ? icons.team : icons.account" />
					</span>
					<span class="knorke-people__who">
						<span class="knorke-people__name">{{ s.name }}</span>
						<span class="knorke-people__kind">{{ kindLabel(s) }}</span>
						<span v-if="s.appAccess === false" class="knorke-people__noapp" data-knorke-note="app-access">{{ t('knorke', 'Cannot open Knorke') }}</span>
					</span>
					<NcSelect class="knorke-people__role"
						:model-value="roleOption(s.role)"
						:options="roleOptions"
						:clearable="false"
						:searchable="false"
						:disabled="busy"
						label="label"
						:aria-label-combobox="t('knorke', 'Role of {name}', { name: s.name })"
						data-knorke-field="share-role"
						@update:model-value="(o) => o && $emit('update:shares', setShareRole(shares, shareKey(s), o.role))">
						<template #option="o">
							<span :data-knorke-share-role-option="o.role">{{ o.label }}</span>
						</template>
						<template #selected-option="o">
							<span>{{ o.label }}</span>
						</template>
					</NcSelect>
					<NcButton variant="tertiary"
						:aria-label="t('knorke', 'Remove {name}', { name: s.name })"
						:title="t('knorke', 'Remove')"
						:disabled="busy"
						data-knorke-action="share-remove"
						@click="$emit('update:shares', removeShare(shares, shareKey(s)))">
						<template #icon>
							<NcIconSvgWrapper :path="icons.trash" />
						</template>
					</NcButton>
					<p v-if="rowError && rowError.at === i"
						class="knorke-dialog__error knorke-people__error"
						role="alert"
						:data-knorke-error="rowError.code">
						{{ rowError.text }}
					</p>
				</li>
			</ul>
			<div class="knorke-people__actions">
				<NcButton variant="tertiary"
					data-knorke-action="copy-board-link"
					@click="copyBoardLink">
					<template #icon>
						<NcIconSvgWrapper :path="icons.link" />
					</template>
					{{ t('knorke', 'Copy board link') }}
				</NcButton>
				<NcButton variant="primary"
					:disabled="busy || unchanged"
					data-knorke-action="share-save"
					@click="$emit('save')">
					{{ t('knorke', 'Save') }}
				</NcButton>
			</div>
			<input v-if="boardLinkShown"
				ref="boardLinkField"
				class="knorke-share__url"
				type="text"
				readonly
				:value="boardLink"
				:aria-label="t('knorke', 'Board link')"
				@focus="(e) => e.target.select()">
		</template>
	</div>
</template>

<script setup>
/*
 * "People" tab of the share dialog (SPEC-M1 §6.6 SharePeople, owner only).
 *
 * - Search: 300 ms debounce, api.searchSharees (query `q`). NcSelect instead
 *   of NcSelectUsers (§6.13, measured in stage 2): NcSelectUsers renders
 *   NcAvatar, whose lazy NcProfileHoverCard pulls NcRichText (highlight.js,
 *   micromark, unified) and axios into the vendor chunk, ≈ 160 KiB gzip and
 *   far over the 350 KiB budget. The options keep NcSelectUsers' form
 *   (displayName, subname = sub / id / '' as in R13, isNoUser) and show an
 *   icon per kind instead of an avatar; the local filter keeps every server
 *   hit (the server already searched by Nextcloud's rules). Each option
 *   carries [data-knorke-sharee=<kind>:<id>]. No hits: "No people, groups or
 *   teams found.".
 * - The list is a draft of the complete share list (the parent saves it with
 *   [data-knorke-action=share-save]). A picked recipient joins it as "Can
 *   edit" (R13). Each row [data-knorke-share-item=<kind>:<id>] carries
 *   data-knorke-share-role = its role in the draft; the role picker is
 *   [data-knorke-field=share-role] (NcSelect, options with
 *   data-knorke-share-role-option); "Can vote" is offered only with
 *   FEATURES.voting, but a stored `vote` row shows it as its value and keeps
 *   it (R13). Unavailable shares (deleted group, teams off) are grey.
 * - An account that cannot open Knorke (outside its "Limit to groups", or
 *   kept out by the Guests app; the server sends appAccess: false, job 079)
 *   says "Cannot open Knorke" ([data-knorke-note=app-access]) as a search
 *   option, as a freshly added row and as a saved row. Only text, not grey:
 *   it stays selectable and savable, and the share works once an admin lets
 *   the account in. Groups and teams are never marked.
 * - An error of the save with `at` sits at that row ([data-knorke-error]);
 *   others above the list. policy.sharing === false (sharing turned off for
 *   the owner): a note with the text of sharing_disabled instead of the
 *   search (removing and downgrading stay possible).
 * - "Copy board link": the internal board URL (/apps/knorke/b/{id}) for Talk
 *   or mail. New recipients also get a Nextcloud notification from the
 *   server (lib/Notification/, SPEC-M1 §4.10.5): accounts at once, members
 *   of groups and teams on the next cron run; this dialog shows nothing of it.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import * as boardsApi from '../api/boards.js'
import { FEATURES } from '../util/features.js'
import { t } from '../util/l10n.js'
import { appUrl, pages } from '../util/routes.js'
import { showSuccess } from '../util/toast.js'
import { copyText } from './copyText.js'
import { icons } from './icons.js'
import { SEARCH_DEBOUNCE_MS, addSharee, errorText, removeShare, roleChoices, roleLabel, sameShares, setShareRole, shareKey, shareeOptions } from './share.js'

const props = defineProps({
	boardId: { type: Number, required: true },
	/** draft rows {kind, id, name, role, available, appAccess?: false} */
	shares: { type: Array, default: () => [] },
	/** saved rows (to tell whether the draft changed) */
	stored: { type: Array, default: () => [] },
	/** sharing policy of the owner {sharing, groups, teams, groupMembersOnly} or null (not loaded) */
	policy: { type: Object, default: null },
	loaded: { type: Boolean, default: false },
	busy: { type: Boolean, default: false },
	/** error of the last save: {code, text, at} */
	error: { type: Object, default: null },
})

const emit = defineEmits(['update:shares', 'save'])

const picked = ref(null)
const options = ref([])
const searching = ref(false)
/** {code, text} under the search field (no hits, throttled) */
const searchNote = ref(null)
const boardLinkShown = ref(false)
const boardLinkField = ref(null)
let timer = null
let seq = 0

/** The server already filtered by Nextcloud's rules: never drop one of its hits locally. */
const keepServerHits = () => true
const sharingOff = computed(() => props.policy?.sharing === false)
const unchanged = computed(() => sameShares(props.shares, props.stored))
const rowError = computed(() => (props.error && Number.isInteger(props.error.at) && props.error.at < props.shares.length ? props.error : null))
const generalError = computed(() => (props.error && !rowError.value ? props.error : null))
const roleOptions = computed(() => roleChoices(FEATURES.voting).map((role) => ({ id: role, role, label: roleLabel(role) })))
const boardLink = computed(() => {
	const origin = globalThis.location?.origin ?? ''
	return origin + appUrl(pages.board(props.boardId).path)
})

onBeforeUnmount(() => {
	if (timer !== null) {
		clearTimeout(timer)
	}
})

/**
 * @param {string} role share role
 * @return {{id: string, role: string, label: string}} option of the role picker (also "Can vote" without voting)
 */
function roleOption(role) {
	return { id: role, role, label: roleLabel(role) }
}

/**
 * @param {object} s row
 * @return {string} kind label and "(unavailable)"
 */
function kindLabel(s) {
	const kind = s.kind === 'group' ? t('knorke', 'Group') : s.kind === 'team' ? t('knorke', 'Team') : ''
	const off = s.available ? '' : t('knorke', '(unavailable)')
	return [kind, off].filter((x) => x !== '').join(' ')
}

/** @param {string} q search term (NcSelect emits every change) */
function onSearch(q) {
	if (timer !== null) {
		clearTimeout(timer)
	}
	const term = typeof q === 'string' ? q.trim() : ''
	if (term === '') {
		seq++
		options.value = []
		searching.value = false
		searchNote.value = null
		return
	}
	searching.value = true
	timer = setTimeout(() => search(term), SEARCH_DEBOUNCE_MS)
}

/** @param {string} term search term */
async function search(term) {
	timer = null
	const mine = ++seq
	try {
		const res = await boardsApi.searchSharees(props.boardId, term)
		if (mine !== seq) {
			return
		}
		options.value = shareeOptions(res.sharees, { group: icons.group, team: icons.team })
		searchNote.value = options.value.length === 0 ? { code: '', text: t('knorke', 'No people, groups or teams found.') } : null
	} catch (e) {
		if (mine !== seq) {
			return
		}
		options.value = []
		const x = errorText(e)
		searchNote.value = { code: x.code, text: x.text }
	} finally {
		if (mine === seq) {
			searching.value = false
		}
	}
}

/** @param {object|null} o picked option */
async function add(o) {
	if (!o) {
		return
	}
	const r = addSharee(props.shares, { kind: o.kind, id: o.shareId, name: o.displayName, appAccess: o.appAccess })
	if (r.added) {
		emit('update:shares', r.draft)
	}
	await nextTick()
	picked.value = null
}

async function copyBoardLink() {
	if (await copyText(boardLink.value)) {
		boardLinkShown.value = false
		showSuccess(t('knorke', 'Board link copied'))
		return
	}
	boardLinkShown.value = true
	await nextTick()
	boardLinkField.value?.focus()
	boardLinkField.value?.select()
}
</script>
