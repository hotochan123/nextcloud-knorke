<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<NcDialog :name="editing ? t('knorke', 'Edit voting') : t('knorke', 'Start voting')"
		size="normal"
		is-form
		:no-close="busy"
		class="knorke-dialog knorke-votesetup"
		:data-knorke-dialog="editing ? 'vote-edit' : 'vote-setup'"
		@update:open="(o) => !o && !busy && $emit('close')"
		@submit="submit">
		<!-- NcModal ignores Esc inside inputs (useHotKey): the fields close the dialog themselves -->
		<div class="knorke-votesetup__body" @keydown.esc.stop.prevent="!busy && $emit('close')">
		<p v-if="editing" class="knorke-votesetup__hint" data-knorke-vote-locked>
			{{ t('knorke', 'These settings can\'t change while the voting runs.') }}
		</p>
		<label class="knorke-votesetup__field">
			<span>{{ t('knorke', 'Votes per person') }}</span>
			<input v-model="per"
				type="number"
				min="1"
				max="99"
				step="1"
				inputmode="numeric"
				required
				:disabled="busy || editing"
				data-knorke-field="vote-per">
		</label>
		<label class="knorke-votesetup__switch" data-knorke-field="vote-per-item">
			<input v-model="onePerItem"
				type="checkbox"
				role="switch"
				:disabled="busy || editing">
			<span>{{ t('knorke', 'One vote per item') }}</span>
		</label>
		<fieldset class="knorke-votesetup__group" data-knorke-field="vote-scope">
			<legend>{{ t('knorke', 'Area') }}</legend>
			<label class="knorke-votesetup__option" data-knorke-vote-scope-option="board">
				<input v-model="scopeKind"
					type="radio"
					name="knorke-vote-scope"
					value="board"
					:disabled="busy || editing">
				<span>{{ t('knorke', 'Whole board') }}</span>
			</label>
			<label v-if="scopeFrame" class="knorke-votesetup__option" data-knorke-vote-scope-option="frame">
				<input v-model="scopeKind"
					type="radio"
					name="knorke-vote-scope"
					value="frame"
					:disabled="busy || editing">
				<span>{{ t('knorke', 'Selected frame “{title}”', { title: scopeFrame.title }) }}</span>
			</label>
		</fieldset>
		<fieldset class="knorke-votesetup__group" data-knorke-field="vote-types">
			<legend>{{ t('knorke', 'Item types') }}</legend>
			<label v-for="o in TYPE_OPTIONS"
				:key="o.type"
				class="knorke-votesetup__option"
				:data-knorke-vote-type="o.type">
				<input v-model="types"
					type="checkbox"
					:value="o.type"
					:disabled="busy || editing">
				<span>{{ o.label() }}</span>
			</label>
		</fieldset>
		<label v-if="editing" class="knorke-votesetup__field">
			<span>{{ t('knorke', 'Add minutes') }}</span>
			<input v-model="minutes"
				type="number"
				min="1"
				max="1440"
				step="1"
				inputmode="numeric"
				:aria-describedby="minutesHintId"
				:aria-invalid="cfg.minutesValid ? null : 'true'"
				:disabled="busy"
				data-knorke-field="vote-add">
			<span :id="minutesHintId" class="knorke-votesetup__hint">{{ t('knorke', 'Added to the time left; empty: no change') }}</span>
		</label>
		<label v-else class="knorke-votesetup__field">
			<span>{{ t('knorke', 'Time limit') }}</span>
			<input v-model="minutes"
				type="number"
				min="1"
				max="1440"
				step="1"
				inputmode="numeric"
				:placeholder="t('knorke', 'No limit')"
				:aria-describedby="minutesHintId"
				:disabled="busy"
				data-knorke-field="vote-minutes">
			<span :id="minutesHintId" class="knorke-votesetup__hint">{{ t('knorke', 'Minutes; empty: no limit') }}</span>
		</label>
		<p v-if="editing && !cfg.minutesValid" class="knorke-dialog__error" role="alert" data-knorke-vote-add-error>
			{{ t('knorke', 'Enter 1 to 1440 minutes.') }}
		</p>
		<label class="knorke-votesetup__switch" data-knorke-field="vote-live">
			<input v-model="live"
				type="checkbox"
				role="switch"
				:aria-labelledby="liveLabelId"
				:aria-describedby="liveHintId"
				:disabled="busy || editing">
			<span class="knorke-votesetup__switchtext">
				<span :id="liveLabelId">{{ t('knorke', 'Show live counts to moderators') }}</span>
				<span :id="liveHintId" class="knorke-votesetup__hint">{{ t('knorke', 'Participants see a notice.') }}</span>
			</span>
		</label>
		<label class="knorke-votesetup__switch" data-knorke-field="vote-accounts">
			<input v-model="accountsOnly"
				type="checkbox"
				role="switch"
				:aria-labelledby="accountsLabelId"
				:aria-describedby="accountsHintId"
				:disabled="busy || editing">
			<span class="knorke-votesetup__switchtext">
				<span :id="accountsLabelId">{{ t('knorke', 'Accounts only') }}</span>
				<span :id="accountsHintId" class="knorke-votesetup__hint">{{ t('knorke', 'Guests can watch but not vote.') }}</span>
			</span>
		</label>
		<p v-if="!editing"
			class="knorke-votesetup__count"
			:data-knorke-vote-votable="votableNow"
			aria-live="polite">
			{{ n('knorke', '%n item can get votes', '%n items can get votes', votableNow) }}
		</p>
		<p v-if="error" class="knorke-dialog__error" role="alert">
			{{ error }}
		</p>
		</div>
		<template #actions>
			<NcButton type="button"
				variant="tertiary"
				:disabled="busy"
				@click="$emit('close')">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
			<NcButton v-if="editing"
				type="submit"
				variant="primary"
				:disabled="!canSave"
				data-knorke-action="vote-save">
				{{ t('knorke', 'Save') }}
			</NcButton>
			<NcButton v-else
				type="submit"
				variant="primary"
				:disabled="!canStart"
				data-knorke-action="vote-start">
				{{ t('knorke', 'Start voting') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
/*
 * Settings of a dot vote (SPEC-M1 §6.6 VoteSetupDialog, §6.8 R16 CLI-09,
 * §4.12.1): votes per person ([data-knorke-field=vote-per], 1–99, default
 * 5); the switch "One vote per item" ([data-knorke-field=vote-per-item]
 * with input[type=checkbox], on by default): on → perItem 1, off → perItem =
 * per; the area ([data-knorke-field=vote-scope], options
 * [data-knorke-vote-scope-option=board|frame]; "frame" only when exactly
 * one frame was selected when the dialog opened, then it is the default);
 * the item types ([data-knorke-field=vote-types] with
 * [data-knorke-vote-type=sticky|shape|text], default notes); the time limit
 * ([data-knorke-field=vote-minutes], empty = no limit, 1–1440); (job 149)
 * the switch "Show live counts to moderators" ([data-knorke-field=vote-live]
 * with input[type=checkbox], off at every opening; start sends live
 * true|false); (job 175) the switch "Accounts only"
 * ([data-knorke-field=vote-accounts], same markup, off at every opening;
 * start sends accountsOnly true|false). The live
 * counter "{n} items can get votes" ([data-knorke-vote-votable=<n>],
 * session.votableCount) disables "Start voting"
 * ([data-knorke-action=vote-start]) at 0. Esc closes it also from inside a
 * field (NcModal's own Esc handler skips inputs).
 *
 * Job 233 ("Edit voting …" of the session bar): with prop running (the
 * votesView of the open session) the dialog is "Edit voting"
 * ([data-knorke-dialog=vote-edit]). The server can only lengthen a running
 * session (route 23 extend), so every setting shows the session's value and
 * is disabled, with the line "These settings can't change while the voting
 * runs."; instead of the time limit there is "Add minutes"
 * ([data-knorke-field=vote-add], 1–1440). "Save" ([data-knorke-action=
 * vote-save]) emits extend(minutes), or close when the field is empty; a
 * value outside 1–1440 shows an error and disables "Save". No counter.
 */
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { n, t } from '../util/l10n.js'

/** Votable item types (registry `votable`, §4.8) with their labels. */
const TYPE_OPTIONS = [
	{ type: 'sticky', label: () => t('knorke', 'Notes') },
	{ type: 'shape', label: () => t('knorke', 'Shapes') },
	{ type: 'text', label: () => t('knorke', 'Text') },
]

let seq = 0

const props = defineProps({
	/** {id, title} of the one selected frame when the dialog opened, else null */
	frame: { type: Object, default: null },
	/** (cfg) => number: live items that can get votes (session.votableCount) */
	count: { type: Function, default: () => 0 },
	busy: { type: Boolean, default: false },
	error: { type: String, default: '' },
	/** job 233: votesView() of the open session: the dialog edits it */
	running: { type: Object, default: null },
})

const emit = defineEmits(['start', 'extend', 'close'])

const r = props.running ?? null
const editing = r !== null
const minutesHintId = 'knorke-vote-minutes-' + (++seq)
const liveLabelId = 'knorke-vote-live-' + seq
const liveHintId = 'knorke-vote-live-hint-' + seq
const accountsLabelId = 'knorke-vote-accounts-' + seq
const accountsHintId = 'knorke-vote-accounts-hint-' + seq
/** the frame of the area option: the running session's, else the one selected at the opening */
const scopeFrame = editing ? (typeof r.scope === 'string' ? { id: r.scope, title: r.scopeTitle ?? '' } : null) : props.frame
const per = ref(editing ? String(r.per) : '5')
const onePerItem = ref(editing ? r.perItem === 1 : true)
const scopeKind = ref(scopeFrame ? 'frame' : 'board')
const types = ref(editing && Array.isArray(r.types) ? [...r.types] : ['sticky'])
const minutes = ref('')
/** job 149: moderators see the live count (off at every opening) */
const live = ref(editing ? r.live === true : false)
/** job 175: only signed-in accounts vote (off at every opening) */
const accountsOnly = ref(editing ? r.accountsOnly === true : false)

/** @return {number|null} an integer in lo..hi from an input value, else null */
function intIn(v, lo, hi) {
	const x = Number(v)
	return Number.isInteger(x) && x >= lo && x <= hi ? x : null
}

const cfg = computed(() => {
	const p = intIn(per.value, 1, 99)
	const m = String(minutes.value ?? '').trim() === '' ? null : intIn(minutes.value, 1, 1440)
	return {
		per: p,
		perItem: p === null ? null : (onePerItem.value ? 1 : p),
		scope: scopeKind.value === 'frame' && scopeFrame ? scopeFrame.id : null,
		types: TYPE_OPTIONS.map((o) => o.type).filter((x) => types.value.includes(x)),
		minutes: m,
		minutesValid: String(minutes.value ?? '').trim() === '' || m !== null,
	}
})
/** live counter (session.votableCount) of the settings now */
const votableNow = computed(() => (!editing && cfg.value.types.length > 0 ? props.count({ types: cfg.value.types, scope: cfg.value.scope }) : 0))
const canStart = computed(() => !props.busy && cfg.value.per !== null && cfg.value.minutesValid && cfg.value.types.length > 0 && votableNow.value > 0)
/** job 233: "Save" of "Edit voting" */
const canSave = computed(() => !props.busy && cfg.value.minutesValid)

function submit() {
	if (editing) {
		if (!canSave.value) {
			return
		}
		if (cfg.value.minutes === null) {
			emit('close')
		} else {
			emit('extend', cfg.value.minutes)
		}
		return
	}
	if (!canStart.value) {
		return
	}
	const c = cfg.value
	emit('start', { per: c.per, perItem: c.perItem, scope: c.scope, types: c.types, minutes: c.minutes, live: live.value === true, accountsOnly: accountsOnly.value === true })
}
</script>
