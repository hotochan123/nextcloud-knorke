<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section class="knorke-admin-section"
		:data-knorke-admin-section="id"
		:data-knorke-open="open ? 'true' : 'false'">
		<h2 class="knorke-admin-section__heading">
			<button type="button"
				class="knorke-admin-section__head"
				:aria-expanded="open ? 'true' : 'false'"
				:aria-controls="bodyId"
				:data-knorke-admin-toggle="id"
				@click="emit('toggle')">
				<span class="knorke-admin-section__tile" aria-hidden="true">
					<NcIconSvgWrapper :path="icon" :size="24" />
				</span>
				<span class="knorke-admin-section__text">
					<span class="knorke-admin-section__title">
						{{ title }}
						<span v-if="count > 0" class="knorke-admin-section__count" :data-knorke-admin-count="id">{{ count }}</span>
					</span>
					<span class="knorke-admin-section__summary" :data-knorke-admin-summary="id">{{ summary }}</span>
				</span>
				<span class="knorke-admin-section__arrow" aria-hidden="true">
					<NcIconSvgWrapper :path="icons.chevronDown" :size="20" />
				</span>
			</button>
		</h2>
		<div v-show="open" :id="bodyId" class="knorke-admin-section__body">
			<slot />
		</div>
	</section>
</template>

<script setup>
/*
 * One collapsible section of the admin page (factory job 281, design A3):
 * [data-knorke-admin-section=<id>] with data-knorke-open. Its head is one
 * native button over the whole row inside the <h2> (heading navigation
 * stays): a 40 × 40 icon tile, the title with a counter pill
 * [data-knorke-admin-count=<id>] while count > 0, one line below it
 * [data-knorke-admin-summary=<id>] (the page passes the state while closed
 * and the explaining sentence while open) and an arrow (down closed, up
 * open). aria-expanded and aria-controls name the body; a closed body stays
 * in the DOM (v-show), so unsaved input survives closing it.
 */
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { icons } from '../components/icons.js'

const props = defineProps({
	/** templates | shapelibs | ai | privacy */
	id: { type: String, required: true },
	title: { type: String, required: true },
	summary: { type: String, default: '' },
	/** SVG path of the tile's icon */
	icon: { type: String, required: true },
	/** open suggestions (pill), 0: none */
	count: { type: Number, default: 0 },
	open: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle'])
const bodyId = 'knorke-admin-' + props.id + '-body'
</script>
