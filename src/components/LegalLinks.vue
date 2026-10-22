<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<nav v-if="links.length > 0"
		class="knorke-legal"
		:aria-label="t('knorke', 'Legal')"
		data-knorke="legal">
		<template v-for="(l, i) in links" :key="l.key">
			<span v-if="i > 0" class="knorke-legal__sep" aria-hidden="true">·</span>
			<a class="knorke-legal__link"
				:href="l.href"
				target="_blank"
				rel="noopener noreferrer"
				:data-knorke-legal="l.key">{{ l.label }}</a>
		</template>
	</nav>
</template>

<script setup>
/*
 * Small imprint / privacy links of the guest page (U9, components/legal.js).
 * Renders nothing when neither is configured.
 */
import { computed } from 'vue'
import { legalLinks } from './legal.js'

const props = defineProps({
	legal: { type: Object, default: null },
})

const links = computed(() => legalLinks(props.legal))
</script>
