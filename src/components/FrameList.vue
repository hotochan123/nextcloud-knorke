<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div :id="id" class="knorke-popover knorke-framelist" data-knorke-frame-list>
		<p v-if="frames.length === 0" class="knorke-popover__hint">
			{{ t('knorke', 'This board has no frames yet.') }}
		</p>
		<ul v-else class="knorke-framelist__list">
			<li v-for="f in frames" :key="f.id">
				<button type="button"
					class="knorke-framelist__item"
					:data-knorke-frame="f.id"
					@click="$emit('zoom-to', f.id)">
					{{ f.title }}
				</button>
			</li>
		</ul>
	</div>
</template>

<script setup>
/*
 * Frame list (SPEC-M1 §6.6 FrameList, §6.8): every frame in z order with its
 * title, else "Frame {n}" ([data-knorke-frame-list], entries
 * [data-knorke-frame=<id>]); a click shows that frame (session.zoomToItem):
 * the moderation jumps between the workshop phases this way before it uses
 * "Bring everyone here".
 */
import { t } from '../util/l10n.js'

defineProps({
	/** [{id, title}] */
	frames: { type: Array, default: () => [] },
	/** id of the popover (aria-controls of the "Frames" button) */
	id: { type: String, default: null },
})

defineEmits(['zoom-to'])
</script>
