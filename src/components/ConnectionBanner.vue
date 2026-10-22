<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div v-if="banner.kind && showStatus"
		class="knorke-banner"
		:class="'knorke-banner--' + banner.kind"
		:data-knorke-banner="banner.kind"
		data-knorke-bar="banner"
		role="status">
		<span class="knorke-banner__text">{{ banner.text }}</span>
		<NcButton v-if="banner.action"
			variant="tertiary"
			size="small"
			@click="reload">
			{{ banner.action === 'signin' ? t('knorke', 'Sign in again') : t('knorke', 'Reload') }}
		</NcButton>
	</div>
	<div v-if="role.kind && !frozen && showRole"
		class="knorke-banner knorke-banner--role"
		:class="'knorke-banner--' + role.kind"
		:data-knorke-banner="role.kind"
		data-knorke-bar="banner"
		role="status">
		<span class="knorke-banner__text">{{ role.text }}</span>
	</div>
</template>

<script setup>
/*
 * State banners of a board (SPEC-M0 §6.6, §6.8): [data-knorke-banner=<state>]
 * for offline, gone, revoked, logged_out, reload and rate_limited;
 * SPEC-M1 §4.2 adds link_expired and password_required (a guest view hands
 * over to PublicApp right after) and the link variant of gone (reason 'link').
 * The texts come from banner.js; 'revoked' after a re-join answered by an app
 * 429 (reason 'rate_limited') keeps its state hook but says what happened.
 * Frozen = FROZEN_STATUSES of the session.
 * The Reload action is a cache-busting reload (U15, util/reload.js): after a
 * 409 a plain reload could bring the same stale bundle back.
 *
 * SPEC-M1 §6.5.4 (stage 2, R13): next to the status banner it shows exactly
 * the one result of board/mode.js bannerFor (prop roleBanner: view_role,
 * vote_ready, device_vote or viewonly), never while the board is frozen. The
 * M0 viewonly strip comes only from rule 4 of bannerFor now (an editor on a
 * device without a fine pointer, without FEATURES.voting).
 *
 * Stage 3 (R16 narrow layout (3)): both are banner strips
 * ([data-knorke-bar=banner]) inside the board's banner stack at the top;
 * the board decides which strips show (components/bars.js bannerStrips:
 * at most one in the narrow layout) through showStatus/showRole.
 */
import { computed } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import { FROZEN_STATUSES } from '../board/BoardSession.js'
import { t } from '../util/l10n.js'
import { hardReload } from '../util/reload.js'
import { bannerFor, roleBannerFor } from './banner.js'

const props = defineProps({
	status: { type: String, default: 'connecting' },
	reason: { type: String, default: null },
	/** result of board/mode.js bannerFor (null: none) */
	roleBanner: { type: String, default: null },
	/** the status strip may show (banner precedence of the board) */
	showStatus: { type: Boolean, default: true },
	/** the role strip may show */
	showRole: { type: Boolean, default: true },
})

const banner = computed(() => bannerFor(props.status, props.reason))
const role = computed(() => roleBannerFor(props.roleBanner))
const frozen = computed(() => FROZEN_STATUSES.includes(props.status))

function reload() {
	hardReload(window)
}
</script>
