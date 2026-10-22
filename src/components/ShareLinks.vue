<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-links">
		<template v-if="view === 'disabled'">
			<p class="knorke-share__off" data-knorke-banner="links_disabled" role="status">
				{{ t('knorke', 'Link sharing is disabled by your administrator.') }}
			</p>
			<template v-for="role in roles" :key="role">
				<section v-if="links[role]" class="knorke-link" :data-knorke-link="role">
					<p class="knorke-share__off">
						{{ role === 'vote' ? t('knorke', 'The existing voting link does not work while link sharing is disabled.') : t('knorke', 'The existing edit link does not work while link sharing is disabled.') }}
					</p>
					<NcButton variant="tertiary"
						:disabled="busy"
						data-knorke-action="link-toggle"
						@click="$emit('toggle', role)">
						{{ t('knorke', 'Turn off link') }}
					</NcButton>
				</section>
			</template>
		</template>
		<template v-else>
			<div v-if="!loaded" class="knorke-people__loading">
				<NcLoadingIcon :size="28" :name="t('knorke', 'Loading …')" />
			</div>
			<section v-for="role in (loaded ? roles : [])"
				:key="role"
				class="knorke-link"
				:data-knorke-link="role">
				<h3 class="knorke-link__heading">
					{{ role === 'vote' ? t('knorke', 'Voting link') : t('knorke', 'Edit link') }}
				</h3>
				<p class="knorke-link__explain">
					{{ role === 'vote' ? t('knorke', 'Anyone with this link can view the board and vote, but cannot change anything.') : t('knorke', 'Anyone with this link can edit the board.') }}
				</p>
				<template v-if="links[role]">
					<NcNoteCard v-if="!readOnly && !linkMeetsPolicy(links[role], linkPolicy, today)"
						type="warning"
						data-knorke-note="link-policy">
						<p>{{ t('knorke', 'This link does not meet the current sharing policy.') }}</p>
						<NcButton variant="secondary"
							:disabled="busy"
							data-knorke-action="link-policy-fix"
							@click="$emit('fix-policy', role)">
							{{ t('knorke', 'Add password or expiry date') }}
						</NcButton>
					</NcNoteCard>
					<p v-if="isExpired(links[role])" class="knorke-share__off">
						{{ t('knorke', 'This link has expired.') }}
					</p>
					<div class="knorke-share__row">
						<input :ref="(el) => { urlFields[role] = el }"
							class="knorke-share__url"
							type="text"
							readonly
							:value="links[role].url"
							:aria-label="role === 'vote' ? t('knorke', 'Voting link') : t('knorke', 'Edit link')"
							data-knorke-field="link-url"
							@focus="(e) => e.target.select()">
						<NcButton variant="secondary"
							data-knorke-action="link-copy"
							@click="copy(role)">
							<template #icon>
								<NcIconSvgWrapper :path="icons.copy" />
							</template>
							{{ copied === role ? t('knorke', 'Copied') : t('knorke', 'Copy') }}
						</NcButton>
					</div>
					<div class="knorke-share__row knorke-share__row--actions">
						<NcButton variant="tertiary"
							:aria-expanded="qrOpen[role] ? 'true' : 'false'"
							data-knorke-action="link-qr"
							@click="$emit('qr', role)">
							<template #icon>
								<NcIconSvgWrapper :path="icons.qrcode" />
							</template>
							{{ t('knorke', 'Show QR code') }}
						</NcButton>
						<NcButton variant="tertiary"
							data-knorke-action="link-present"
							@click="$emit('present', role)">
							<template #icon>
								<NcIconSvgWrapper :path="icons.present" />
							</template>
							{{ t('knorke', 'Show to the room') }}
						</NcButton>
						<template v-if="!readOnly">
							<NcButton variant="tertiary"
								:disabled="busy"
								data-knorke-action="link-rotate"
								@click="$emit('rotate', role)">
								<template #icon>
									<NcIconSvgWrapper :path="icons.refresh" />
								</template>
								{{ t('knorke', 'Create new link') }}
							</NcButton>
							<NcButton variant="tertiary"
								:disabled="busy"
								data-knorke-action="link-toggle"
								@click="$emit('toggle', role)">
								{{ t('knorke', 'Turn off link') }}
							</NcButton>
						</template>
					</div>
					<div v-if="qrOpen[role]" class="knorke-link__qr">
						<QrCode :value="links[role].url"
							:size="176"
							:label="t('knorke', 'QR code of the link')" />
					</div>
					<LinkSettings v-if="!readOnly"
						:role="role"
						:link="links[role]"
						:draft="drafts[role]"
						:policy="linkPolicy"
						:busy="busy"
						:error="errors[role]"
						:today="today"
						@update:draft="(d) => $emit('update:draft', role, d)"
						@save="$emit('save', role)"
						@remove-password="$emit('remove-password', role)" />
				</template>
				<template v-else>
					<p class="knorke-share__off">
						{{ t('knorke', 'Link sharing is off.') }}
					</p>
					<NcButton v-if="!readOnly"
						:variant="settingsOpen[role] ? 'secondary' : 'primary'"
						:disabled="busy"
						:aria-expanded="settingsFirst(linkPolicy) ? (settingsOpen[role] ? 'true' : 'false') : null"
						data-knorke-action="link-toggle"
						@click="$emit('toggle', role)">
						<template #icon>
							<NcIconSvgWrapper :path="icons.link" />
						</template>
						{{ role === 'vote' ? t('knorke', 'Create voting link') : t('knorke', 'Create edit link') }}
					</NcButton>
					<LinkSettings v-if="!readOnly && settingsOpen[role]"
						:role="role"
						:link="null"
						:draft="drafts[role]"
						:policy="linkPolicy"
						:busy="busy"
						:error="errors[role]"
						:today="today"
						@update:draft="(d) => $emit('update:draft', role, d)"
						@save="$emit('save', role)" />
				</template>
				<p v-if="errors[role] && !(errors[role].field && (links[role] || settingsOpen[role]))"
					class="knorke-dialog__error"
					role="alert"
					:data-knorke-error="errors[role].code">
					{{ errors[role].text }}
				</p>
			</section>
		</template>
	</div>
</template>

<script setup>
/*
 * "Links" tab of the share dialog (SPEC-M1 §6.6 ShareLinks): one section
 * [data-knorke-link=edit|vote] per link, the edit section first in the DOM
 * (R13, the M0 helpers take .first()); the voting-link section only with
 * FEATURES.voting (stage 3).
 *
 * Per link: an explanation line, on/off ([data-knorke-action=link-toggle]),
 * the URL ([data-knorke-field=link-url]) with "Copy", "Show QR code"
 * ([data-knorke-action=link-qr], a small QrCode in the section), "Show to
 * the room" ([data-knorke-action=link-present], PresentLinkDialog), renew
 * ([data-knorke-action=link-rotate], asked first) and the settings
 * (LinkSettings: password, expiry, save).
 *
 * readOnly (moderators, R13 exactly): no link-toggle, link-rotate,
 * link-settings-save, link-password, link-expiry; only copy, link-qr and
 * link-present.
 *
 * A link that does not meet the current policy (the admin enforced a
 * password or an expiry date later, not retroactive) shows
 * [data-knorke-note=link-policy] "This link does not meet the current
 * sharing policy." with a button that prefills what is missing.
 *
 * (U12) linksAllowed false: [data-knorke-banner=links_disabled] in this tab;
 * no create, renew, copy; a kept link can still be turned off.
 */
import { computed, reactive, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { FEATURES } from '../util/features.js'
import { t } from '../util/l10n.js'
import { showInfo } from '../util/toast.js'
import { copyText } from './copyText.js'
import { icons } from './icons.js'
import LinkSettings from './LinkSettings.vue'
import QrCode from './QrCode.vue'
import { linkMeetsPolicy, settingsFirst } from './share.js'

const props = defineProps({
	/** {edit: Link|null, vote: Link|null} */
	links: { type: Object, required: true },
	linksAllowed: { type: Boolean, default: true },
	/** normalized linkPolicy */
	linkPolicy: { type: Object, required: true },
	readOnly: { type: Boolean, default: false },
	/** route 19 answered (or the snapshot had links) */
	loaded: { type: Boolean, default: true },
	busy: { type: Boolean, default: false },
	/** settings drafts by role */
	drafts: { type: Object, required: true },
	/** settings shown before a link exists (enforced policy), by role */
	settingsOpen: { type: Object, required: true },
	/** small QR code shown, by role */
	qrOpen: { type: Object, required: true },
	/** section errors by role ({code, text, field}) */
	errors: { type: Object, required: true },
	/** 'YYYY-MM-DD' of today */
	today: { type: String, required: true },
})

defineEmits(['toggle', 'rotate', 'save', 'remove-password', 'update:draft', 'fix-policy', 'qr', 'present'])

/** Link sections in DOM order: the edit link first (R13). */
const roles = computed(() => (FEATURES.voting ? ['edit', 'vote'] : ['edit']))
/** 'disabled' (U12: no create/renew; a kept link can be turned off) or 'on'. Moderators never see it. */
const view = computed(() => (!props.readOnly && props.linksAllowed === false ? 'disabled' : 'on'))
const urlFields = reactive({ edit: null, vote: null })
const copied = ref(null)

/**
 * @param {object} link Link
 * @return {boolean} its expiry lies in the past (the owner still sees it; any POST renews)
 */
function isExpired(link) {
	return Number.isFinite(link?.expiresAt) && link.expiresAt < Date.now()
}

/** @param {'edit'|'vote'} role link role */
async function copy(role) {
	const url = props.links[role]?.url ?? ''
	if (url === '') {
		return
	}
	if (await copyText(url)) {
		copied.value = role
		setTimeout(() => {
			if (copied.value === role) {
				copied.value = null
			}
		}, 2000)
		return
	}
	urlFields[role]?.focus()
	urlFields[role]?.select()
	showInfo(t('knorke', 'Link selected. Press Ctrl+C to copy it.'))
}
</script>
