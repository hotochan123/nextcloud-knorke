/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Behaviour of the stage-3 shell components (SPEC-M1 §6.6, §6.8, R16
 * CLI-09), run in Node with ./sfc.mjs (@nextcloud/vue as stubs):
 * VoteSetupDialog semantics (switch → perItem, scope only with one frame,
 * empty minutes = no limit, start disabled at 0), VoteBar texts and hooks
 * (narrow "{n} left" + List, "+5 min" only with endsAt, closed bar),
 * VotePanel (list, ranking, empty result), TimerChip hooks
 * (data-knorke-timer-left rounded up, done), PresenceBar buttons and the
 * compact "+{n}", ModerationMenu entries, FollowBanner/FollowChip; R17:
 * TimerDialog buttons by timer state (K3: "+1 min"/"+5 min" also for a
 * run-out timer, "Pause" only while running) and the vote-mode switch as a
 * plain action button (K5).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp, h } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const VoteSetupDialog = (await import('../../../src/components/VoteSetupDialog.vue')).default
const VoteBar = (await import('../../../src/components/VoteBar.vue')).default
const VotePanel = (await import('../../../src/components/VotePanel.vue')).default
const TimerChip = (await import('../../../src/components/TimerChip.vue')).default
const TimerDialog = (await import('../../../src/components/TimerDialog.vue')).default
const PresenceBar = (await import('../../../src/components/PresenceBar.vue')).default
const ModerationMenu = (await import('../../../src/components/ModerationMenu.vue')).default
const FollowBanner = (await import('../../../src/components/FollowBanner.vue')).default
const FollowChip = (await import('../../../src/components/FollowChip.vue')).default

const NOW = 1760100000000
const render = (C, props) => renderToString(createSSRApp(C, props))
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

const view = (extra = {}) => ({
	sid: 12, state: 'open', open: true, left: 2, per: 3, perItem: 1, types: ['sticky'], scope: null, scopeTitle: null,
	mine: {}, endsAt: null, results: null, total: null, voters: null, show: false, by: 'Alice', mod: false, canVote: true,
	mode: 'vote', canSwitch: false, event: null, ...extra,
})

test('VoteSetupDialog (CLI-09): defaults; switch on → perItem 1, off → per; scope "frame" only with one selected frame (then default); empty minutes = no limit; start at 0 disabled', async () => {
	const asked = []
	const count = (cfg) => {
		asked.push(cfg)
		return cfg.scope === 'F1' ? 0 : 4
	}
	const props = { frame: null, count, busy: false, error: '' }
	let { bindings, emitted } = setupOf(VoteSetupDialog, props)
	assert.equal(bindings.per.value, '5')
	assert.equal(bindings.onePerItem.value, true)
	assert.equal(bindings.scopeKind.value, 'board')
	assert.deepEqual(bindings.types.value, ['sticky'])
	assert.equal(bindings.minutes.value, '')
	assert.equal(bindings.votableNow.value, 4)
	assert.equal(bindings.canStart.value, true)
	bindings.per.value = '3'
	bindings.submit()
	assert.deepEqual(emitted, [['start', { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null }]])
	bindings.onePerItem.value = false
	bindings.minutes.value = '10'
	bindings.types.value = ['text', 'sticky']
	bindings.submit()
	assert.deepEqual(emitted[1], ['start', { per: 3, perItem: 3, scope: null, types: ['sticky', 'text'], minutes: 10 }], 'switch off → perItem = per; types in a fixed order')
	bindings.minutes.value = '0'
	assert.equal(bindings.canStart.value, false, 'minutes outside 1–1440')
	bindings.minutes.value = ''
	bindings.types.value = []
	assert.equal(bindings.votableNow.value, 0)
	assert.equal(bindings.canStart.value, false, 'no type')
	;({ bindings, emitted } = setupOf(VoteSetupDialog, { ...props, frame: { id: 'F1', title: 'Frame A' } }))
	assert.equal(bindings.scopeKind.value, 'frame', 'one selected frame: the default')
	assert.equal(bindings.votableNow.value, 0)
	assert.equal(bindings.canStart.value, false, 'counter 0 → "Start voting" disabled')
	bindings.submit()
	assert.deepEqual(emitted, [])
	const html = strip(await render(VoteSetupDialog, { ...props, frame: { id: 'F1', title: 'Frame A' } }))
	assert.match(html, /data-knorke-vote-votable="0"/)
	assert.match(html, /data-knorke-vote-scope-option="frame"/)
	assert.match(html, /Selected frame “Frame A”/)
	const board = strip(await render(VoteSetupDialog, props))
	assert.doesNotMatch(board, /data-knorke-vote-scope-option="frame"/, 'no frame option without one selected frame')
	assert.match(board, /data-knorke-vote-type="sticky"[\s\S]*data-knorke-vote-type="shape"[\s\S]*data-knorke-vote-type="text"/)
	assert.match(board, /4 items can get votes/)
})

test('VoteBar: open (left, voters only for moderators, "+5 min" only with endsAt), narrow "{n} left" + List, closed "Voting ended · {n} voted · Results"', async () => {
	let html = strip(await render(VoteBar, { votes: view(), now: NOW, narrow: false }))
	assert.match(html, /data-knorke-bar="vote"/)
	assert.match(html, /data-knorke-vote-state="open"/)
	assert.match(html, /data-knorke-vote-left="2"/)
	assert.match(html, /Voting · 2 votes left/)
	assert.doesNotMatch(html, /vote-end|vote-extend|voted/, 'not a moderator')
	assert.match(html, /data-knorke-bar="list"[^>]*data-knorke-action="vote-panel"|data-knorke-action="vote-panel"[^>]*data-knorke-bar="list"/)
	html = strip(await render(VoteBar, { votes: view({ mod: true, voters: 4, endsAt: NOW + 90500 }), now: NOW }))
	assert.match(html, /01:31/)
	assert.match(html, /4 voted/)
	assert.match(html, /data-knorke-action="vote-extend"/)
	assert.match(html, /data-knorke-action="vote-end"/)
	html = strip(await render(VoteBar, { votes: view({ mod: true, voters: 4 }), now: NOW }))
	assert.doesNotMatch(html, /vote-extend/, '"+5 min" only with endsAt (R16 SRV-07)')
	html = strip(await render(VoteBar, { votes: view({ canSwitch: true, mode: 'vote' }), now: NOW }))
	assert.match(html, /data-knorke-action="vote-mode"[^>]*>\s*Edit/)
	// R17 K5: one way only – the action label flips, no aria-pressed in either mode
	const modeSwitch = (x) => x.match(/<button[^>]*data-knorke-action="vote-mode"[^>]*>[^<]*/)?.[0] ?? ''
	assert.doesNotMatch(modeSwitch(html), /aria-pressed/, 'mode vote: "Edit" without aria-pressed')
	html = strip(await render(VoteBar, { votes: view({ canSwitch: true, mode: 'edit' }), now: NOW }))
	assert.match(modeSwitch(html), />\s*Vote\s*$/, 'mode edit: the action "Vote"')
	assert.doesNotMatch(modeSwitch(html), /aria-pressed/, 'mode edit: "Vote" without aria-pressed')
	html = strip(await render(VoteBar, { votes: view(), now: NOW, narrow: true }))
	assert.match(html, />\s*2 left\s*</)
	assert.match(html, /List/)
	html = strip(await render(VoteBar, { votes: view({ state: 'closed', open: false, left: null, voters: 5, results: [] }), now: NOW }))
	assert.match(html, /data-knorke-vote-state="closed"/)
	assert.doesNotMatch(html, /data-knorke-vote-left/)
	assert.match(html, /Voting ended · 5 voted · Results/)
})

test('VotePanel: the list with own counts and ± (add disabled only at perItem); ranking top 3; "No votes were cast."; moderator actions', async () => {
	const items = [{ id: 'A', text: 'Idea A', mine: 1 }, { id: 'B', text: '', mine: 0 }]
	let html = strip(await render(VotePanel, { votes: view({ left: 0 }), items }))
	assert.match(html, /data-knorke-vote-panel/)
	assert.match(html, /data-knorke-vote-item="A"[\s\S]*Idea A/)
	assert.match(html, /data-knorke-vote-item="B"[\s\S]*\(no text\)/)
	assert.match(html, /Vote for (&quot;|")Idea A(&quot;|"), 1 of 1/)
	assert.equal((html.match(/disabled[^>]*data-knorke-action="vote-add"/g) ?? []).length, 1, '+ disabled only at perItem (A has 1 of 1); with no votes left it stays active and the click says why (vote-limit)')
	const lookup = (id) => ({ text: { A: 'Idea A', B: 'Idea B', C: 'Idea C', D: 'Idea D' }[id], exists: true })
	html = strip(await render(VotePanel, { votes: view({ state: 'closed', open: false, results: [['A', 5], ['B', 3], ['C', 2], ['D', 1]], mod: true }), lookup }))
	assert.match(html, /data-knorke-vote-results/)
	assert.equal((html.match(/knorke-votepanel__result--top/g) ?? []).length, 3)
	assert.match(html, /vote-copy[\s\S]*vote-show[\s\S]*vote-clear/)
	html = strip(await render(VotePanel, { votes: view({ state: 'closed', open: false, results: [], mod: false }), lookup }))
	assert.match(html, /No votes were cast\./)
	assert.doesNotMatch(html, /vote-clear|vote-copy/)
	html = strip(await render(VotePanel, { votes: view({ state: 'closed', open: false, results: [['A', 5]], mod: true, show: true }), lookup }))
	assert.match(html, /data-knorke-action="vote-hide"/)
	assert.doesNotMatch(html, /data-knorke-action="vote-show"/)
})

test('TimerChip (TST-09): data-knorke-timer-left = shown rest rounded up; state running/paused/done; a button only for moderators', async () => {
	let html = strip(await render(TimerChip, { timer: { state: 'running', dur: 60000, end: NOW + 59200, seq: 1 }, now: NOW, mod: false }))
	assert.match(html, /data-knorke-timer-state="running"/)
	assert.match(html, /data-knorke-timer-left="60000"/)
	assert.match(html, /role="timer" aria-atomic="true"/)
	assert.match(html, /01:00/)
	assert.match(html, /^<div/, 'no button for participants')
	html = strip(await render(TimerChip, { timer: { state: 'running', dur: 60000, end: NOW, seq: 1 }, now: NOW + 1, mod: true }))
	assert.match(html, /^<button/)
	assert.match(html, /data-knorke-timer-state="done"/)
	assert.match(html, /data-knorke-timer-left="0"/)
	assert.match(html, /Time&#39;s up|Time's up/)
	html = strip(await render(TimerChip, { timer: { state: 'paused', left: 1500, seq: 2 }, now: NOW }))
	assert.match(html, /data-knorke-timer-state="paused"[^>]*data-knorke-timer-left="2000"|data-knorke-timer-left="2000"/)
	assert.doesNotMatch(strip(await render(TimerChip, { timer: null, now: NOW })), /data-knorke-timer/)
})

/**
 * TimerDialog with an NcDialog stand-in that also renders the #actions slot
 * (the sfc.mjs stub renders only the default slot).
 */
const TimerDialogAll = {
	...TimerDialog,
	setup(props, ctx) {
		const b = TimerDialog.setup(props, ctx)
		// a copy of the bindings (getters kept, incl. __isScriptSetup) with the stand-in
		const out = {}
		for (const k of Reflect.ownKeys(b)) {
			if (k !== 'NcDialog') {
				Object.defineProperty(out, k, Object.getOwnPropertyDescriptor(b, k))
			}
		}
		out.NcDialog = { inheritAttrs: false, render() { return h('div', { 'data-stub': 'NcDialog' }, [this.$slots.default?.(), this.$slots.actions?.()]) } }
		return out
	},
}

/**
 * @param {object|null} timer meta.timer
 * @param {number} now server time
 * @return {Promise<string[]>} the timer-* actions the dialog offers, in order
 */
async function timerActions(timer, now = NOW) {
	const html = strip(await render(TimerDialogAll, { timer, now, busy: false, muted: false }))
	return [...html.matchAll(/data-knorke-action="(timer-[a-z0-9]+)"/g)].map((m) => m[1])
}

test('R17 K3 TimerDialog: "+1 min" and "+5 min" whenever a timer exists (running, paused, run out); "Pause" only while running and not run out', async () => {
	const running = { state: 'running', dur: 300000, end: NOW + 90000, left: null, by: 'Alice', seq: 3 }
	const runOut = { ...running, end: NOW - 1000 }
	const paused = { state: 'paused', dur: 300000, end: null, left: 30000, by: 'Alice', seq: 4 }
	assert.deepEqual(await timerActions(runOut), ['timer-add1', 'timer-add5', 'timer-stop', 'timer-start'], 'run out: add buttons there, pause absent')
	assert.deepEqual(await timerActions({ ...running, end: NOW }), ['timer-add1', 'timer-add5', 'timer-stop', 'timer-start'], 'end = now counts as run out')
	assert.deepEqual(await timerActions(running), ['timer-pause', 'timer-add1', 'timer-add5', 'timer-stop', 'timer-start'])
	assert.deepEqual(await timerActions(paused), ['timer-resume', 'timer-add1', 'timer-add5', 'timer-stop', 'timer-start'])
	assert.deepEqual(await timerActions(null), ['timer-start'], 'no timer: only Start')
	assert.match(strip(await render(TimerDialogAll, { timer: runOut, now: NOW, busy: false, muted: false })), /Time&#39;s up|Time's up/)
	// the buttons emit route 24's actions (the board calls it once)
	const { bindings, emitted } = setupOf(TimerDialog, { timer: runOut, now: NOW, busy: false, muted: false })
	assert.equal(bindings.exists.value, true)
	assert.equal(bindings.running.value, false, 'run out: no "Pause" (409 timer_state, §4.12.2)')
	bindings.start()
	assert.deepEqual(emitted, [['action', 'start', 300000]])
})

test('PresenceBar: buttons per participant (aria-pressed = followed), own entry a button only for moderators, compact "+{n}"; emits follow/summon', async () => {
	const ps = [
		{ pid: 'me', name: 'Alice Adler', color: '#c62828', guest: false, self: true },
		{ pid: 'pb', name: 'Bob Berg', color: '#283593', guest: false, self: false },
	]
	let html = strip(await render(PresenceBar, { participants: ps, following: 'pb', mod: false }))
	assert.match(html, /data-knorke-participant="pb"[^>]*>|aria-pressed="true"[^>]*data-knorke-participant="pb"/)
	assert.match(html, /aria-pressed="true"/)
	assert.equal((html.match(/<button/g) ?? []).length, 1, 'the own entry is no button for participants')
	assert.match(html, /People on tablets or voting don&#39;t appear here\.|People on tablets or voting don't appear here\./)
	html = strip(await render(PresenceBar, { participants: ps, following: null, mod: true }))
	assert.equal((html.match(/<button/g) ?? []).length, 2, 'a moderator\'s own entry: "Bring everyone here"')
	assert.match(html, /Bring everyone here/)
	html = strip(await render(PresenceBar, { participants: ps, following: null, compact: true }))
	assert.match(html, /data-knorke-action="participants"[^>]*>\s*\+2/)
	assert.doesNotMatch(html, /data-knorke-participant=/, 'compact: the list is in the popover')
	const { bindings, emitted } = setupOf(PresenceBar, { participants: ps, following: 'pb', mod: true, compact: false })
	bindings.pick(ps[1])
	bindings.pick(ps[0])
	assert.deepEqual(emitted, [['follow', 'pb', true], ['summon']])
})

test('PresenceBar (R18/R19 A-03, T4-25): others are toggles named label(p) with the action as title; a moderator\'s own entry is an action button named titleOf(p) without aria-pressed', async () => {
	const ps = [
		{ pid: 'me', name: 'Alice Adler', color: '#c62828', guest: false, self: true },
		{ pid: 'pb', name: 'Bob Berg', color: '#283593', guest: false, self: false },
		{ pid: 'pg', name: 'Gina', color: '#2e7d32', guest: true, self: false },
	]
	const html = strip(await render(PresenceBar, { participants: ps, following: 'pb', mod: true }))
	const tag = (re) => (html.match(re) ?? [''])[0]
	const bob = tag(/<button[^>]*data-knorke-participant="pb"[^>]*>/)
	assert.match(bob, /aria-label="Bob Berg"/, 'name only, the same in both states')
	assert.match(bob, /title="Bob Berg · Stop following"/, 'the action is the hint')
	assert.match(bob, /aria-pressed="true"/)
	const gina = tag(/<button[^>]*data-knorke-participant="pg"[^>]*>/)
	assert.match(gina, /aria-label="Gina \(guest\)"/)
	assert.match(gina, /title="Gina \(guest\) · Follow"/)
	assert.match(gina, /aria-pressed="false"/)
	const own = tag(/<button(?![^>]*data-knorke-participant)[^>]*knorke-presence__item--self[^>]*>/)
	assert.match(own, /aria-label="Alice Adler \(you\) · Bring everyone here"/, 'the moderator\'s own entry keeps its action name')
	assert.doesNotMatch(own, /aria-pressed/, 'an action button, no toggle')
	// the popover rows: same names (nameOf) and hints (titleOf) as the bar; the row text is nameOf
	const mod = setupOf(PresenceBar, { participants: ps, following: 'pb', mod: true, compact: true }).bindings
	assert.equal(mod.nameOf(ps[1]), 'Bob Berg')
	assert.equal(mod.titleOf(ps[1]), 'Bob Berg · Stop following', '"Stop following" stays in use (no orphaned de.json entry)')
	assert.equal(mod.titleOf(ps[2]), 'Gina (guest) · Follow', '"Follow" stays in use')
	assert.equal(mod.nameOf(ps[0]), 'Alice Adler (you) · Bring everyone here')
	const plain = setupOf(PresenceBar, { participants: ps, following: null, mod: false, compact: true }).bindings
	assert.equal(plain.nameOf(ps[0]), 'Alice Adler (you)', 'a participant\'s own entry: just the name')
	assert.equal(plain.nameOf(ps[1]), 'Bob Berg')
})

test('ModerationMenu: the moderation root and entries; the overflow form carries "Share"; "Start voting" not while open; summon / summon-end by state', async () => {
	let html = strip(await render(ModerationMenu, { mod: true, voteOpen: false, presenting: false, summonActive: false }))
	assert.match(html, /data-knorke-menu="moderation"/)
	assert.match(html, /data-knorke-action="vote-setup"/)
	assert.match(html, /data-knorke-action="timer-open"/)
	assert.match(html, /data-knorke-action="summon"/)
	assert.doesNotMatch(html, /summon-end|data-knorke-action="share"/)
	html = strip(await render(ModerationMenu, { mod: true, voteOpen: true, presenting: true, summonActive: true }))
	assert.doesNotMatch(html, /vote-setup/)
	assert.doesNotMatch(html, /data-knorke-action="summon"/)
	assert.match(html, /data-knorke-action="summon-end"/)
	html = strip(await render(ModerationMenu, { overflow: true, canShare: true, mod: false }))
	assert.match(html, /data-knorke-menu="overflow"/)
	assert.match(html, /data-knorke-action="share"/)
	assert.doesNotMatch(html, /timer-open/)
})

test('FollowBanner and FollowChip texts and hooks', async () => {
	let html = strip(await render(FollowBanner, { following: { pid: 'p', name: 'Alice', summon: false } }))
	assert.match(html, /data-knorke-banner="following"/)
	assert.match(html, /Following Alice/)
	assert.match(html, /data-knorke-action="follow-stop"/)
	html = strip(await render(FollowBanner, { following: { pid: 'p', name: 'Alice', summon: true } }))
	assert.match(html, /Alice is presenting\./)
	assert.match(html, /Stop following/)
	html = strip(await render(FollowChip, { chip: { pid: 'p', client: 'c', name: 'Alice' } }))
	assert.match(html, /data-knorke-follow-chip/)
	assert.match(html, /data-knorke-action="follow-presenter"[^>]*>\s*Alice is presenting · Follow/)
})
