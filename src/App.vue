<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcContent app-name="knorke" class="knorke-app" :data-knorke-features="features">
		<template v-if="route.name === 'list'">
			<NcAppNavigation :aria-label="t('knorke', 'Knorke navigation')">
				<template #list>
					<NcAppNavigationNew :text="t('knorke', 'New board')"
						data-knorke-action="new-board"
						@click="openCreate">
						<template #icon>
							<NcIconSvgWrapper :path="icons.plus" />
						</template>
					</NcAppNavigationNew>
					<NcAppNavigationItem v-for="f in filters"
						:key="f.id"
						:name="f.name"
						:active="filter === f.id"
						:aria-current="filter === f.id ? 'page' : null"
						:data-knorke-filter="f.id"
						@click="(e) => pickFilter(e, f.id)">
						<template #icon>
							<NcIconSvgWrapper :path="f.icon" />
						</template>
					</NcAppNavigationItem>
				</template>
			</NcAppNavigation>
			<NcAppContent>
				<BoardList :boards="boards"
					:loading="loading"
					:error="listError"
					:filter="filter"
					@open="(id) => push({ name: 'board', id })"
					@rename="openRename"
					@delete="openDelete" />
			</NcAppContent>
		</template>
		<NcAppContent v-else-if="route.name === 'board'" class="knorke-app__board">
			<BoardView :key="'board-' + route.id"
				mode="user"
				:board-id="route.id"
				:debug="state.debug === true"
				:limits="state.limits || {}"
				:privacy="state.privacy || null"
				:known-source="listSourceOf(boards, route.id)"
				@back="push({ name: 'list' })" />
		</NcAppContent>
		<NcAppContent v-else class="knorke-app__join">
			<NcEmptyContent v-if="joinState === 'revoked'"
				data-knorke-banner="revoked"
				:name="t('knorke', 'This link was revoked')"
				:description="t('knorke', 'Ask the owner of the board for the new link.')" />
			<NcEmptyContent v-else-if="joinState === 'disabled'"
				data-knorke-banner="links_disabled"
				:name="t('knorke', 'Link sharing is disabled')"
				:description="t('knorke', 'The administrator of this Nextcloud does not allow sharing by link, so this board cannot be opened through it.')" />
			<NcEmptyContent v-else-if="joinState === 'expired'"
				data-knorke-banner="expired"
				:name="t('knorke', 'This link has expired.')"
				:description="t('knorke', 'Ask the owner of the board for the new link.')" />
			<NcEmptyContent v-else-if="joinState === 'invalid'"
				data-knorke-banner="invalid"
				:name="t('knorke', 'This link is invalid')"
				:description="t('knorke', 'Check that you copied the whole link.')" />
			<NcEmptyContent v-else-if="joinState === 'limited'"
				:name="t('knorke', 'Too many attempts')"
				:description="t('knorke', 'Please wait a moment and try again.')" />
			<NcEmptyContent v-else-if="joinState === 'error'"
				:name="t('knorke', 'Could not join the board')"
				:description="t('knorke', 'Something went wrong. Please try again.')" />
			<NcEmptyContent v-else-if="joinState === 'password'"
				:name="t('knorke', 'Join board')"
				:description="t('knorke', 'Enter the password for this board.')">
				<template #action>
					<NcButton variant="primary" @click="passwordOpen = true">
						{{ t('knorke', 'Enter password') }}
					</NcButton>
				</template>
			</NcEmptyContent>
			<div v-else class="knorke-board__loading">
				<NcLoadingIcon :size="44" :name="t('knorke', 'Joining board …')" />
			</div>
		</NcAppContent>

		<LinkPasswordDialog v-if="route.name === 'join' && joinState === 'password' && passwordOpen"
			:key="passwordKey"
			:error="passwordError"
			:error-code="passwordCode"
			:busy="joinBusy"
			@submit="(pw) => join(route.token, pw)"
			@cancel="passwordOpen = false" />
		<ConfirmDialog v-if="dialog === 'create'"
			:name="t('knorke', 'New board')"
			:confirm-label="t('knorke', 'Create')"
			:busy="busy"
			:confirm-disabled="draft.trim() === ''"
			@confirm="create"
			@cancel="closeDialog">
			<NcTextField v-model="draft"
				:label="t('knorke', 'Title')"
				:maxlength="maxTitle"
				required
				data-knorke-field="title" />
		</ConfirmDialog>
		<ConfirmDialog v-if="dialog === 'rename'"
			:name="t('knorke', 'Rename board')"
			:confirm-label="t('knorke', 'Rename')"
			:busy="busy"
			:confirm-disabled="draft.trim() === ''"
			@confirm="rename"
			@cancel="closeDialog">
			<NcTextField v-model="draft"
				:label="t('knorke', 'Title')"
				:maxlength="maxTitle"
				required
				data-knorke-field="title" />
		</ConfirmDialog>
		<ConfirmDialog v-if="dialog === 'delete'"
			:name="t('knorke', 'Delete board?')"
			:message="t('knorke', '“{title}” and everything on it will be deleted for everyone. This cannot be undone.', { title: target ? target.title : '' })"
			:confirm-label="t('knorke', 'Delete')"
			:busy="busy"
			danger
			@confirm="remove"
			@cancel="closeDialog" />
	</NcContent>
</template>

<script setup>
/*
 * Shell of signed-in users (SPEC-M0 §6.6): board list | board | join, with a
 * mini router over the History API. The list page has the app navigation;
 * the board page uses the whole content area for the canvas.
 *
 * SPEC-M1 stage 2:
 * - Navigation filters "All", "Mine", "Shared with me"
 *   ([data-knorke-filter=all|mine|shared], the active one with
 *   aria-current="page", R13); BoardList applies them (components/share.js).
 * - Opening a link with a password (/join/{token} answering 403
 *   password_required, R13 E29): LinkPasswordDialog
 *   ([data-knorke-dialog=link-password]); a wrong password shows "Wrong
 *   password.", the lock-out (429 slow_down with reason 'password', never
 *   repeated) its text with the minutes.
 * - The root carries data-knorke-features ("voting" with FEATURES.voting,
 *   else "") for the E cases (R13).
 *
 * M2 privacy notice: the board view gets the initial state `privacy` (the
 * text and privacy policy URL in the account's language) for its badge card
 * and one-time info on boards open by link.
 *
 * Factory job 049: the board view gets the board's origin from the list this
 * tab loaded last (components/share.js listSourceOf; null after a full page
 * load), so a final 404 when opening it can say that a link access ended.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcAppNavigationNew from '@nextcloud/vue/components/NcAppNavigationNew'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcContent from '@nextcloud/vue/components/NcContent'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import * as boardsApi from './api/boards.js'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { icons } from './components/icons.js'
import { accountJoinState } from './components/join.js'
import LinkPasswordDialog from './components/LinkPasswordDialog.vue'
import { errorText, listSourceOf } from './components/share.js'
import { current, onRouteChange, push, replace } from './router.js'
import { HttpError } from './sync/http.js'
import { FEATURES } from './util/features.js'
import { t } from './util/l10n.js'
import { showError } from './util/toast.js'
import { wellFormed } from './util/unicode.js'
import BoardList from './views/BoardList.vue'
import BoardView from './views/BoardView.vue'

const state = inject('knorke-state', {})
const route = ref(current())
const boards = ref([])
const loading = ref(false)
const listError = ref('')
const dialog = ref(null)
const draft = ref('')
const target = ref(null)
const busy = ref(false)
const joinState = ref('pending')
const maxTitle = computed(() => state.limits?.maxTitle || 200)
const features = FEATURES.voting ? 'voting' : ''
/** Board list filter (R13): 'all' | 'mine' | 'shared'. */
const filter = ref('all')
const filters = [
	{ id: 'all', name: t('knorke', 'All boards'), icon: icons.board },
	{ id: 'mine', name: t('knorke', 'Mine'), icon: icons.account },
	{ id: 'shared', name: t('knorke', 'Shared with me'), icon: icons.share },
]
const passwordOpen = ref(false)
const passwordError = ref('')
const passwordCode = ref('')
const passwordKey = ref(0)
const joinBusy = ref(false)

let unsubscribe = null

onMounted(() => {
	unsubscribe = onRouteChange((r) => { route.value = r })
	enter(route.value)
})

onBeforeUnmount(() => {
	unsubscribe?.()
})

watch(route, (r) => enter(r))

/** @param {object} r route entered */
function enter(r) {
	if (r.name === 'list') {
		loadBoards()
	} else if (r.name === 'join') {
		join(r.token)
	}
}

async function loadBoards() {
	loading.value = true
	listError.value = ''
	try {
		boards.value = await boardsApi.listBoards()
	} catch (e) {
		listError.value = e instanceof HttpError && e.status === 401
			? t('knorke', 'Your session has ended. Please sign in again.')
			: t('knorke', 'Please try again in a moment.')
	} finally {
		loading.value = false
	}
}

/**
 * @param {MouseEvent} e click on a navigation item
 * @param {string} id filter
 */
function pickFilter(e, id) {
	e?.preventDefault?.()
	filter.value = id
}

/**
 * @param {string} token link token from the URL
 * @param {string|null} [password] link password (LinkPasswordDialog)
 */
async function join(token, password = null) {
	if (joinBusy.value) {
		return
	}
	if (password === null) {
		joinState.value = 'pending'
	}
	joinBusy.value = true
	try {
		const id = await boardsApi.joinLink(token, password)
		passwordOpen.value = false
		replace({ name: 'board', id })
	} catch (e) {
		// final states, no retry (components/join.js; U12: links_disabled; M1: expired)
		joinState.value = accountJoinState(e)
		if (joinState.value === 'password') {
			// the first ask carries no hint; a wrong password or the lock-out does
			const x = password === null && e instanceof HttpError && e.code === 'password_required' ? null : errorText(e)
			passwordError.value = x ? x.text : ''
			passwordCode.value = x ? x.code : ''
			if (!passwordOpen.value) {
				passwordKey.value++
			}
			passwordOpen.value = true
		} else if (joinState.value === 'limited') {
			showError(t('knorke', 'Too many attempts. Please wait a moment and try again.'))
		}
	} finally {
		joinBusy.value = false
	}
}

function openCreate() {
	draft.value = ''
	target.value = null
	dialog.value = 'create'
}

/** @param {object} b board */
function openRename(b) {
	draft.value = b.title
	target.value = b
	dialog.value = 'rename'
}

/** @param {object} b board */
function openDelete(b) {
	target.value = b
	dialog.value = 'delete'
}

function closeDialog() {
	if (!busy.value) {
		dialog.value = null
		target.value = null
	}
}

/**
 * @param {unknown} e error
 * @param {string} fallback generic message
 * @return {string} message for a toast
 */
function messageOf(e, fallback) {
	if (e instanceof HttpError && e.status === 400) {
		return t('knorke', 'Please enter a title (1–200 characters).')
	}
	if (e instanceof HttpError && e.status === 429) {
		return t('knorke', 'You have created too many boards. Please wait a moment.')
	}
	return fallback
}

async function create() {
	const title = wellFormed(draft.value.trim())
	if (title === '' || busy.value) {
		return
	}
	busy.value = true
	try {
		const b = await boardsApi.createBoard(title)
		dialog.value = null
		push({ name: 'board', id: b.id })
	} catch (e) {
		showError(messageOf(e, t('knorke', 'The board could not be created.')))
	} finally {
		busy.value = false
	}
}

async function rename() {
	const title = wellFormed(draft.value.trim())
	if (title === '' || busy.value || !target.value) {
		return
	}
	busy.value = true
	try {
		const b = await boardsApi.renameBoard(target.value.id, title)
		boards.value = boards.value.map((x) => (x.id === b.id ? { ...x, ...b } : x))
		dialog.value = null
		target.value = null
	} catch (e) {
		showError(messageOf(e, t('knorke', 'The board could not be renamed.')))
	} finally {
		busy.value = false
	}
}

async function remove() {
	if (busy.value || !target.value) {
		return
	}
	busy.value = true
	const id = target.value.id
	try {
		await boardsApi.deleteBoard(id)
		boards.value = boards.value.filter((x) => x.id !== id)
		dialog.value = null
		target.value = null
	} catch (e) {
		showError(t('knorke', 'The board could not be deleted.'))
	} finally {
		busy.value = false
	}
}
</script>
