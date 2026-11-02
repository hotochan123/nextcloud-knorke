<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="knorke-touchtip"
		data-knorke-tip="touch-select"
		role="status">
		<p class="knorke-touchtip__text">
			{{ t('knorke', 'Tip: hold a finger still, then drag, to select several items.') }}
		</p>
		<button type="button"
			class="knorke-touchtip__ok"
			data-knorke-action="touch-tip-ok"
			@click="close">
			{{ t('knorke', 'OK') }}
		</button>
	</div>
</template>

<script setup>
/*
 * Factory job 142: the one-time tip about "hold, then drag" (the touch
 * marquee), shown by BoardView after the first one-finger pan in mode edit
 * (BoardSession maybeTouchTip). A small bubble at the bottom centre of the
 * board; role status, so a screen reader reads it, and it never takes the
 * focus when it appears. Only OK closes it (click, tap, Enter, Space: a
 * native button); where the focus goes then is BoardView's decision
 * (event close).
 */
import { t } from '../util/l10n.js'

const emit = defineEmits(['close'])

/** OK was activated. */
function close() {
	emit('close')
}
</script>
