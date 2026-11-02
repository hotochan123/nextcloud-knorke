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
import { readFileSync } from 'node:fs'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp, h } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const VoteSetupDialog = (await import('../../../src/components/VoteSetupDialog.vue')).default
// job 233: the vote bar is the vote segment of the session bar (same props for the vote part)
const SessionBar = (await import('../../../src/components/SessionBar.vue')).default
const VoteBar = SessionBar
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
	assert.deepEqual(emitted, [['start', { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null, live: false, accountsOnly: false }]])
	bindings.onePerItem.value = false
	bindings.minutes.value = '10'
	bindings.types.value = ['text', 'sticky']
	bindings.submit()
	assert.deepEqual(emitted[1], ['start', { per: 3, perItem: 3, scope: null, types: ['sticky', 'text'], minutes: 10, live: false, accountsOnly: false }], 'switch off → perItem = per; types in a fixed order')
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

test('VoteBar (job 233 AK3: the vote segment): open ("{left} of {per} votes left", voters only for moderators, "+5 min" only with endsAt), narrow line 1 "{left} of {per} votes left" + List, closed "Voting ended · {n} voted · Results"', async () => {
	let html = strip(await render(VoteBar, { votes: view(), now: NOW, narrow: false }))
	assert.match(html, /data-knorke-bar="session"/)
	assert.match(html, /data-knorke-bar="vote"/)
	assert.match(html, /data-knorke-vote-state="open"/)
	assert.match(html, /data-knorke-vote-left="2"/)
	assert.match(html, /<b class="knorke-sessionbar__word">Voting<\/b>/)
	assert.match(html, />2 of 3 votes left</)
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
	assert.match(html, /knorke-sessionbar__line1[^>]*>2 of 3 votes left</)
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

/** The opening tag of the first element carrying `hook` ('' when none). */
const tagOf = (html, hook) => html.match(new RegExp(`<[a-z]+[^>]*${hook}[^>]*>`))?.[0] ?? ''

test('job 149 VoteSetupDialog: the switch vote-live (before the counter) is off at every opening; start emits live true|false', async () => {
	const props = { frame: null, count: () => 4, busy: false, error: '' }
	let { bindings, emitted } = setupOf(VoteSetupDialog, props)
	assert.equal(bindings.live.value, false, 'off')
	bindings.submit()
	assert.equal(emitted[0][1].live, false)
	bindings.live.value = true
	bindings.submit()
	assert.deepEqual(emitted[1], ['start', { per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: null, live: true, accountsOnly: false }])
	;({ bindings, emitted } = setupOf(VoteSetupDialog, props))
	assert.equal(bindings.live.value, false, 'off again when the dialog opens anew')
	const html = strip(await render(VoteSetupDialog, props))
	const label = html.match(/<label[^>]*data-knorke-field="vote-live"[^>]*>[\s\S]*?<\/label>/)?.[0] ?? ''
	assert.match(label, /<input[^>]*type="checkbox"/)
	assert.match(label, /role="switch"/)
	assert.doesNotMatch(label.match(/<input[^>]*>/)[0], /\bchecked\b/, 'not checked')
	assert.match(label, /Show live counts to moderators/)
	assert.match(label, /Participants see a notice\./)
	assert.ok(html.indexOf('data-knorke-field="vote-live"') < html.indexOf('data-knorke-vote-votable'), 'before the counter')
})

test('job 149 VoteBar (job 233: "Show live count" behind "⋯"): moderators get the check entry vote-live with its state (wide in vote-more, narrow in session-more); everyone else the notice (wide text, narrow an eye button); without live neither', async () => {
	const liveMod = (x = {}) => view({ mod: true, voters: 2, live: true, liveShown: false, ...x })
	let html = strip(await render(VoteBar, { votes: liveMod(), now: NOW }))
	let btn = tagOf(html, 'data-knorke-action="vote-live"')
	assert.match(btn, /data-stub="NcActionButton"/)
	assert.match(btn, /type="checkbox"/, 'a check entry (menuitemcheckbox with aria-checked in NcActionButton)')
	assert.match(btn, /model-value="false"/)
	assert.match(html, /data-knorke-action="vote-live"[^>]*>[\s\S]*?Show live count/)
	const more = html.match(/<div[^>]*data-knorke-action="vote-more"[^>]*>[\s\S]*$/)?.[0] ?? ''
	assert.ok(more.includes('data-knorke-action="vote-live"') && more.includes('data-knorke-action="vote-edit"'), 'both behind "⋯"')
	assert.match(tagOf(html, 'data-knorke-action="vote-more"'), /aria-label="More voting actions"/)
	assert.doesNotMatch(html, /data-knorke-vote-live-note/, 'no notice for moderators')
	html = strip(await render(VoteBar, { votes: liveMod({ liveShown: true }), now: NOW }))
	assert.match(tagOf(html, 'data-knorke-action="vote-live"'), /model-value="true"/)
	html = strip(await render(VoteBar, { votes: liveMod(), now: NOW, narrow: true, mod: true }))
	const nmore = html.match(/<div[^>]*data-knorke-action="session-more"[^>]*>[\s\S]*$/)?.[0] ?? ''
	assert.ok(nmore.includes('data-knorke-action="vote-live"'), 'narrow: in the session bar\'s "⋯"')
	// toggling emits the new value
	let s = setupOf(VoteBar, { votes: liveMod(), now: NOW })
	s.bindings.toggleLive()
	s = { ...s, again: setupOf(VoteBar, { votes: liveMod({ liveShown: true }), now: NOW }) }
	s.again.bindings.toggleLive()
	assert.deepEqual([s.emitted, s.again.emitted], [[['live', true]], [['live', false]]])
	// participants: the notice
	const livePart = view({ live: true, liveShown: false, tally: null })
	html = strip(await render(VoteBar, { votes: livePart, now: NOW }))
	const note = html.match(/<span[^>]*data-knorke-vote-live-note="bar"[^>]*>([\s\S]*?)<\/span>/)
	assert.ok(note, 'wide: a text notice')
	assert.match(note[1], /Moderators see live counts/)
	assert.match(note[1], /data-stub="NcIconSvgWrapper"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-stub="NcIconSvgWrapper"/, 'the eye is aria-hidden')
	assert.doesNotMatch(html, /data-knorke-action="vote-live"/, 'no button for participants')
	html = strip(await render(VoteBar, { votes: livePart, now: NOW, narrow: true }))
	btn = tagOf(html, 'data-knorke-vote-live-note="bar"')
	assert.match(btn, /^<button/)
	assert.match(btn, /aria-label="Moderators see live counts"/)
	assert.match(btn, /title="Moderators see live counts"/)
	assert.match(btn, /knorke-votebar__icon/)
	assert.doesNotMatch(html.match(/data-knorke-vote-live-note="bar"[^>]*>([\s\S]*?)<\/button>/)[1].replace(/<[^>]*>/g, ''), /\S/, 'narrow: only the eye')
	s = setupOf(VoteBar, { votes: livePart, now: NOW, narrow: true })
	s.bindings.liveNote()
	assert.deepEqual(s.emitted, [['live-note']], 'a tap asks for the toast')
	// without live: neither
	for (const v of [view({ mod: true, voters: 2 }), view()]) {
		for (const narrow of [false, true]) {
			html = strip(await render(VoteBar, { votes: v, now: NOW, narrow }))
			assert.doesNotMatch(html, /vote-live/, `no live hook (mod ${v.mod}, narrow ${narrow})`)
		}
	}
	// after the close: neither
	html = strip(await render(VoteBar, { votes: view({ state: 'closed', open: false, left: null, voters: 2, results: [], live: true, mod: true }), now: NOW }))
	assert.doesNotMatch(html, /vote-live/)
})

test('job 149 VotePanel: moderators of a live session get the tabs "Vote" (chosen) and "Live count" with the ranking (top 3, no ±, no copy/show/close, "No votes yet."); participants the notice; ←/→ switch', async () => {
	const items = [{ id: 'A', text: 'Idea A', mine: 1 }, { id: 'B', text: 'Idea B', mine: 0 }]
	const lookup = (id) => ({ text: { A: 'Idea A', B: 'Idea B', C: 'Idea C', D: 'Idea D' }[id], exists: true })
	const tally = [['C', 4], ['A', 3], ['D', 2], ['B', 1]]
	let html = strip(await render(VotePanel, { votes: view({ mod: true, live: true, tally }), items, lookup }))
	assert.match(html, /role="tablist"/)
	const tabVote = tagOf(html, 'data-knorke-vote-tab="vote"')
	const tabLive = tagOf(html, 'data-knorke-vote-tab="live"')
	assert.match(tabVote, /role="tab"/)
	assert.match(tabVote, /aria-selected="true"/)
	assert.match(tabVote, /tabindex="0"/)
	assert.match(tabLive, /aria-selected="false"/)
	assert.match(tabLive, /tabindex="-1"/, 'only the chosen tab is in the tab order')
	assert.match(html, /data-knorke-vote-tab="vote"[^>]*>\s*Vote\s*</)
	assert.match(html, /data-knorke-vote-tab="live"[^>]*>\s*Live count\s*</)
	for (const t of [tabVote, tabLive]) {
		const controls = t.match(/aria-controls="([^"]+)"/)[1]
		assert.match(html, new RegExp(`id="${controls}"[^>]*role="tabpanel"|role="tabpanel"[^>]*id="${controls}"`), 'aria-controls names a tabpanel')
	}
	// the "Vote" list as before, in its order; the live panel hidden
	assert.match(html, /data-knorke-vote-item="A"[\s\S]*data-knorke-vote-item="B"/)
	assert.match(html, /data-knorke-action="vote-add"/)
	const livePanel = html.match(/<div[^>]*knorke-votepanel__live[^>]*>[\s\S]*?<\/div>/)[0]
	assert.match(livePanel, /display:\s*none/, '"Vote" is chosen at the opening')
	assert.match(livePanel, /<ol[^>]*data-knorke-vote-live/)
	assert.deepEqual([...livePanel.matchAll(/data-knorke-vote-live-item="([A-D])"/g)].map((m) => m[1]), ['C', 'A', 'D', 'B'], 'the ranking in tally order')
	assert.equal((livePanel.match(/knorke-votepanel__result--top/g) ?? []).length, 3)
	assert.match(livePanel, /1\.<\/span>\s*Idea C[\s\S]*>4</)
	assert.equal((livePanel.match(/data-knorke-action="vote-focus"/g) ?? []).length, 4, 'a text button per row')
	assert.doesNotMatch(livePanel, /vote-add|vote-remove|vote-copy|vote-show|vote-hide|vote-clear/, 'no ±, no copy, show or close')
	assert.doesNotMatch(html, /data-knorke-vote-live-note/, 'no notice for moderators')
	for (const empty of [[], null]) {
		html = strip(await render(VotePanel, { votes: view({ mod: true, live: true, tally: empty }), items, lookup }))
		assert.match(html, /<p[^>]*data-knorke-vote-live[^>]*>\s*No votes yet\.\s*<\/p>/, `tally ${JSON.stringify(empty)}`)
	}
	// the tabs do not depend on the bar's button
	html = strip(await render(VotePanel, { votes: view({ mod: true, live: true, liveShown: true, tally }), items, lookup }))
	assert.match(html, /role="tablist"/)
	// tab switching: ←/→ switch and activate
	const { bindings } = setupOf(VotePanel, { votes: view({ mod: true, live: true, tally }), items, lookup })
	assert.equal(bindings.tab.value, 'vote')
	assert.equal(bindings.tabs.value, true)
	bindings.step(1)
	assert.equal(bindings.tab.value, 'live')
	bindings.step(1)
	assert.equal(bindings.tab.value, 'vote')
	bindings.step(-1)
	assert.equal(bindings.tab.value, 'live')
	assert.deepEqual(bindings.liveRanking.value.map((r) => [r.id, r.n]), tally)
	// participants: the notice under the head, no tabs
	html = strip(await render(VotePanel, { votes: view({ live: true, tally: null }), items, lookup }))
	const note = html.match(/<p[^>]*data-knorke-vote-live-note="panel"[^>]*>([\s\S]*?)<\/p>/)
	assert.ok(note)
	assert.match(note[1], /Moderators see live counts/)
	assert.ok(html.indexOf('</header>') < html.indexOf('data-knorke-vote-live-note="panel"'), 'under the head')
	assert.doesNotMatch(html, /role="tablist"|data-knorke-vote-live[^-]/)
	// without live: neither
	html = strip(await render(VotePanel, { votes: view({ mod: true }), items, lookup }))
	assert.doesNotMatch(html, /role="tablist"|data-knorke-vote-live|data-knorke-vote-tab/)
})

test('job 175 VoteSetupDialog: the switch vote-accounts (after vote-live, before the counter) is off at every opening; start emits accountsOnly true|false', async () => {
	const props = { frame: null, count: () => 4, busy: false, error: '' }
	let { bindings, emitted } = setupOf(VoteSetupDialog, props)
	assert.equal(bindings.accountsOnly.value, false, 'off')
	bindings.submit()
	assert.equal(emitted[0][1].accountsOnly, false)
	bindings.accountsOnly.value = true
	bindings.submit()
	assert.deepEqual(emitted[1], ['start', { per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: null, live: false, accountsOnly: true }])
	;({ bindings, emitted } = setupOf(VoteSetupDialog, props))
	assert.equal(bindings.accountsOnly.value, false, 'off again when the dialog opens anew')
	const html = strip(await render(VoteSetupDialog, props))
	const label = html.match(/<label[^>]*data-knorke-field="vote-accounts"[^>]*>[\s\S]*?<\/label>/)?.[0] ?? ''
	const input = label.match(/<input[^>]*>/)?.[0] ?? ''
	assert.match(input, /type="checkbox"/)
	assert.match(input, /role="switch"/)
	assert.doesNotMatch(input, /\bchecked\b/, 'not checked')
	const labelledby = input.match(/aria-labelledby="([^"]+)"/)?.[1]
	const describedby = input.match(/aria-describedby="([^"]+)"/)?.[1]
	assert.match(label, new RegExp(`id="${labelledby}"[^>]*>Accounts only<`))
	assert.match(label, new RegExp(`id="${describedby}"[^>]*>Guests can watch but not vote\\.<`))
	assert.ok(html.indexOf('data-knorke-field="vote-live"') < html.indexOf('data-knorke-field="vote-accounts"'), 'after vote-live')
	assert.ok(html.indexOf('data-knorke-field="vote-accounts"') < html.indexOf('data-knorke-vote-votable'), 'before the counter')
})

test('job 175 VoteBar: accountsOnly shows note (accounts) or guest (a guest kept from voting) with text, narrow a symbol button with aria-label; vote-signin only for that guest; without the option neither', async () => {
	const acc = (x = {}) => view({ accountsOnly: true, voteBlocked: false, ...x })
	const guest = (x = {}) => acc({ voteBlocked: true, canVote: false, ...x })
	// wide, an account: the note with the account symbol and "Accounts only", no sign in
	let html = strip(await render(VoteBar, { votes: acc(), now: NOW }))
	let note = html.match(/<span[^>]*data-knorke-vote-accounts="note"[^>]*>([\s\S]*?)<\/span>/)
	assert.ok(note, 'wide: the text note')
	assert.match(note[0], /knorke-votebar__note/)
	assert.match(note[1], /Accounts only/)
	assert.match(note[1], /data-stub="NcIconSvgWrapper"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-stub="NcIconSvgWrapper"/, 'the symbol is aria-hidden')
	assert.doesNotMatch(html, /data-knorke-vote-accounts="guest"|vote-signin/)
	// wide, the guest: the sentence and "Sign in"
	html = strip(await render(VoteBar, { votes: guest(), now: NOW }))
	note = html.match(/<span[^>]*data-knorke-vote-accounts="guest"[^>]*>([\s\S]*?)<\/span>/)
	assert.ok(note, 'wide: the guest sentence')
	assert.match(note[0], /knorke-votebar__note/)
	assert.match(note[1], /Only signed-in accounts can vote\./)
	assert.doesNotMatch(html, /data-knorke-vote-accounts="note"/)
	assert.match(html, /data-knorke-action="vote-signin"[^>]*>\s*Sign in\s*</)
	assert.doesNotMatch(html, /votes? left/, 'no votes left for the guest')
	// narrow: a symbol button with the text as aria-label and title
	html = strip(await render(VoteBar, { votes: acc(), now: NOW, narrow: true }))
	let btn = tagOf(html, 'data-knorke-vote-accounts="note"')
	assert.match(btn, /^<button/)
	assert.match(btn, /aria-label="Accounts only"/)
	assert.match(btn, /title="Accounts only"/)
	assert.match(btn, /knorke-votebar__icon/, 'the ≥ 44 px symbol button')
	assert.doesNotMatch(html.match(/data-knorke-vote-accounts="note"[^>]*>([\s\S]*?)<\/button>/)[1].replace(/<[^>]*>/g, ''), /\S/, 'narrow: only the symbol')
	assert.doesNotMatch(html, /vote-signin/)
	html = strip(await render(VoteBar, { votes: guest(), now: NOW, narrow: true }))
	btn = tagOf(html, 'data-knorke-vote-accounts="guest"')
	assert.match(btn, /^<button/)
	assert.match(btn, /aria-label="Only signed-in accounts can vote\."/)
	assert.match(btn, /title="Only signed-in accounts can vote\."/)
	assert.match(tagOf(html, 'data-knorke-action="vote-signin"'), /knorke-votebar__signin/)
	// a tap asks for the toast
	let s = setupOf(VoteBar, { votes: guest(), now: NOW, narrow: true })
	s.bindings.accountsNote()
	assert.deepEqual(s.emitted, [['accounts-note']])
	assert.equal(s.bindings.accountsText.value, 'Only signed-in accounts can vote.')
	s = setupOf(VoteBar, { votes: acc(), now: NOW, narrow: true })
	assert.equal(s.bindings.accountsText.value, 'Accounts only')
	// without the option and after the end: neither note nor button
	for (const v of [view(), view({ mod: true, voters: 2 }), view({ state: 'closed', open: false, left: null, voters: 2, results: [], accountsOnly: true, voteBlocked: false })]) {
		for (const narrow of [false, true]) {
			html = strip(await render(VoteBar, { votes: v, now: NOW, narrow }))
			assert.doesNotMatch(html, /data-knorke-vote-accounts|vote-signin/, `state ${v.state}, narrow ${narrow}`)
		}
	}
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

// ---- job 233: the session bar ------------------------------------------------

const TopBar = (await import('../../../src/components/TopBar.vue')).default
const RUNNING = { state: 'running', dur: 300000, end: NOW + 252000, seq: 1 }

/** @return {string[]} the data-knorke-session segments of a rendering, in order */
const segments = (html) => [...html.matchAll(/data-knorke-session="([a-z]+)"/g)].map((m) => m[1])

test('job 233 AK1: the session bar is a named region with its segments in order timer, vote, presenting (a line between two); the board view shows it only while something runs; the top bar has no timer any more', async () => {
	let html = strip(await render(SessionBar, { timer: RUNNING, now: NOW, mod: true }))
	assert.match(tagOf(html, 'data-knorke-bar="session"'), /role="region"[^>]*aria-label="Session"|aria-label="Session"[^>]*role="region"/)
	assert.match(tagOf(html, 'data-knorke-bar="session"'), /data-knorke-chrome/)
	assert.deepEqual(segments(html), ['timer'])
	assert.equal((html.match(/knorke-sessionbar__sep/g) ?? []).length, 0)
	html = strip(await render(SessionBar, { votes: view(), timer: RUNNING, presenting: true, now: NOW, mod: true }))
	assert.deepEqual(segments(html), ['timer', 'vote', 'present'])
	assert.equal((html.match(/knorke-sessionbar__sep/g) ?? []).length, 2, 'a line between two segments')
	html = strip(await render(SessionBar, { presenting: true, now: NOW }))
	assert.deepEqual(segments(html), ['present'])
	html = strip(await render(SessionBar, { votes: view({ state: 'closed', open: false, left: null, voters: 3, results: [] }), now: NOW }))
	assert.deepEqual(segments(html), ['vote'], 'standing results count as running')
	// the board view's rule
	const src = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(src, /const showSessionBar = computed\(\(\) => ready\.value && \(!!votes\.value\?\.state \|\| timerOf\(timerMeta\.value\) !== null \|\| presenting\.value \|\| privateMeta\.value !== null\)\)/, 'job 275: private writing too')
	assert.match(src, /<SessionBar v-if="showSessionBar"/)
	assert.match(src, /'knorke-board--votebar': showSessionBar/, 'zoom, undo and tools stand above it')
	// the top bar, wide and narrow, renders no timer even with a running one
	for (const narrow of [false, true]) {
		const top = strip(await render(TopBar, { title: 'Retro', participants: [], ready: true, canModerate: true, timer: RUNNING, narrow }))
		assert.doesNotMatch(top, /data-knorke-timer/, `narrow ${narrow}`)
	}
})

test('job 233 AK2: the timer segment shows the timer icon, "Timer" and the clock ("Time\'s up", "Paused"); moderators get the button to the dialog and × "End timer", everyone else only the text', async () => {
	let html = strip(await render(SessionBar, { timer: RUNNING, now: NOW, mod: true }))
	assert.match(html, /<button[^>]*data-knorke-timer[^>]*>/, 'a button for moderators')
	assert.match(html, /knorke-timerchip__label[^>]*>Timer</)
	assert.match(html, /knorke-timerchip__clock[^>]*>04:12</)
	assert.match(tagOf(html, 'data-knorke-action="timer-end"'), /aria-label="End timer"/)
	html = strip(await render(SessionBar, { timer: RUNNING, now: NOW, mod: false }))
	assert.match(html, /<div[^>]*data-knorke-timer[^>]*>/)
	assert.doesNotMatch(html, /timer-end/, 'no × for participants')
	html = strip(await render(SessionBar, { timer: { ...RUNNING, end: NOW - 1 }, now: NOW }))
	assert.match(html, /Time&#39;s up|Time's up/)
	html = strip(await render(SessionBar, { timer: { state: 'paused', left: 30000, seq: 2 }, now: NOW }))
	assert.match(html, /Paused/)
})

test('job 233 AK3 / risk: "{n} voted" only for moderators, wide and narrow (SPEC-M1 §7.2), also if a number reached the client', async () => {
	for (const narrow of [false, true]) {
		const html = strip(await render(SessionBar, { votes: view({ mod: false, voters: 4, endsAt: NOW + 60000 }), now: NOW, narrow }))
		assert.doesNotMatch(html, /voted/, `narrow ${narrow}`)
		assert.doesNotMatch(html, /vote-end|vote-extend|vote-more|session-more|vote-edit/, 'no moderator controls')
		assert.match(html, /data-knorke-action="vote-panel"/, '"List" for everyone')
	}
	const mod = strip(await render(SessionBar, { votes: view({ mod: true, voters: 4, endsAt: NOW + 60000 }), now: NOW, narrow: true, mod: true }))
	const line2 = mod.match(/<span class="knorke-sessionbar__line2"[^>]*>([\s\S]*?)<\/span><\/div>/)?.[1] ?? ''
	assert.match(line2, /01:00 left[\s\S]*4 voted/, 'a moderator sees the number in line 2')
})

test('job 233 AK4: only the presenting tab sees "You\'re presenting" with "End" (present-end); narrow a presenter who does not moderate keeps "End" as a button', async () => {
	let html = strip(await render(SessionBar, { presenting: true, now: NOW, mod: true }))
	assert.match(html, /<b class="knorke-sessionbar__word">(You&#39;re|You're) presenting<\/b>/)
	assert.match(html, /data-knorke-action="present-end"[^>]*>\s*End\s*</)
	assert.doesNotMatch(strip(await render(SessionBar, { timer: RUNNING, now: NOW, mod: true })), /present/)
	html = strip(await render(SessionBar, { presenting: true, now: NOW, narrow: true, mod: false }))
	assert.match(html, /knorke-sessionbar__line1[^>]*>You&#39;re presenting|knorke-sessionbar__line1[^>]*>You're presenting/)
	assert.match(tagOf(html, 'data-knorke-action="present-end"'), /data-stub="NcButton"/)
	html = strip(await render(SessionBar, { presenting: true, now: NOW, narrow: true, mod: true }))
	assert.match(tagOf(html, 'data-knorke-action="present-end"'), /data-stub="NcActionButton"/, 'a moderator finds it in "⋯"')
})

test('job 233 AK7: narrow, two lines (line 1 the votes left, line 2 time, timer and voters) and for moderators "⋯" with +5 min, Edit voting …, Show live count, End voting, End timer, Stop presenting', async () => {
	let html = strip(await render(SessionBar, { votes: view({ mod: true, voters: 4, endsAt: NOW + 90500, live: true, liveShown: false }), timer: RUNNING, presenting: true, now: NOW, narrow: true, mod: true }))
	assert.match(tagOf(html, 'data-knorke-bar="session"'), /knorke-sessionbar--narrow/)
	assert.match(html, /knorke-sessionbar__line1[^>]*>2 of 3 votes left</)
	// line 2 up to the first action on the right (round 5: the timer in it is a div, so it no longer ends at "</span></div>")
	const line2 = html.split('class="knorke-sessionbar__line2"')[1]?.split('data-knorke-action=')[0] ?? ''
	assert.match(line2, /01:31 left/)
	assert.match(line2, /data-knorke-timer/)
	// round 5 (human rework): in the two lines the timer is text, also for a moderator (no 18 px button)
	assert.match(line2, /<div[^>]*data-knorke-timer/)
	assert.doesNotMatch(html, /<button[^>]*data-knorke-timer/)
	assert.match(line2, /4 voted/)
	assert.match(line2, /You&#39;re presenting|You're presenting/)
	const more = html.match(/<div[^>]*data-knorke-action="session-more"[^>]*>([\s\S]*)$/)?.[1] ?? ''
	assert.deepEqual([...more.matchAll(/data-knorke-action="([a-z-]+)"/g)].map((m) => m[1]), ['vote-extend', 'vote-edit', 'vote-live', 'vote-end', 'timer-end', 'present-end'])
	assert.match(tagOf(html, 'data-knorke-action="session-more"'), /aria-label="More session actions"/)
	// the narrow layout of a timer alone: the timer in line 1
	html = strip(await render(SessionBar, { timer: RUNNING, now: NOW, narrow: true }))
	assert.match(html, /knorke-sessionbar__line1[^>]*>[\s\S]*data-knorke-timer/)
	assert.doesNotMatch(html, /session-more|knorke-sessionbar__line2/)
	html = strip(await render(SessionBar, { timer: RUNNING, now: NOW, narrow: true, mod: true }))
	assert.match(html, /knorke-sessionbar__line1[^>]*><div[^>]*data-knorke-timer/, 'round 5: for a moderator the timer of line 1 is text too')
	assert.doesNotMatch(html, /<button[^>]*data-knorke-timer/)
	// round 1: the text parts stay whole (no "…" on a text that fits)
	assert.match(readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8'), /\.knorke-votebar__text > \* \{\s*flex: 0 0 auto;\s*white-space: nowrap;\s*\}/, 'each part stays whole')
	// the CSS: the narrow bar is the full width at the viewport's bottom, 56 px, buttons ≥ 44 px
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /\.knorke-board--narrow,\s*\.knorke-board--sessionlines \{\s*--knorke-votebar-h: 56px;\s*\}/)
	assert.match(css, /\.knorke-sessionbar--narrow \{[^}]*position: fixed;[^}]*left: 0;[^}]*right: 0;[^}]*bottom: 0;/)
	assert.match(css, /\.knorke-sessionbar--narrow \.button-vue,\s*\.knorke-sessionbar--narrow \.action-item__menutoggle \{[^}]*min-height: var\(--knorke-touch\) !important;[^}]*min-width: var\(--knorke-touch\) !important;/)
})

test('job 233 AK5: the moderation menu has "Start voting …" and "Timer …"; while something runs the caption "Running now" with exactly the matching end entries; nothing runs: no section and no "Stop presenting"', async () => {
	const acts = (html) => [...html.matchAll(/data-knorke-action="([a-z-]+)"/g)].map((m) => m[1])
	let html = strip(await render(ModerationMenu, { mod: true }))
	assert.match(html, /Start voting …/)
	assert.match(html, /Timer …/)
	assert.doesNotMatch(html, /data-knorke-menu-caption/)
	assert.deepEqual(acts(html), ['vote-setup', 'timer-open', 'private-setup', 'summon'])
	html = strip(await render(ModerationMenu, { mod: true, voteOpen: true }))
	assert.match(tagOf(html, 'data-knorke-menu-caption="running"'), /name="Running now"/)
	assert.deepEqual(acts(html), ['timer-open', 'summon', 'vote-end'])
	html = strip(await render(ModerationMenu, { mod: true, timerActive: true }))
	assert.deepEqual(acts(html), ['vote-setup', 'timer-open', 'private-setup', 'summon', 'timer-end'])
	html = strip(await render(ModerationMenu, { mod: true, summonActive: true }))
	assert.deepEqual(acts(html), ['vote-setup', 'timer-open', 'private-setup', 'summon', 'summon-end'])
	html = strip(await render(ModerationMenu, { mod: true, voteOpen: true, timerActive: true, summonActive: true, presenting: true }))
	assert.deepEqual(acts(html), ['timer-open', 'vote-end', 'timer-end', 'summon-end'])
	assert.equal((html.match(/data-knorke-menu-caption/g) ?? []).length, 1)
	// the overflow menu (narrow) carries the same section before the board entries
	html = strip(await render(ModerationMenu, { overflow: true, canShare: true, mod: true, timerActive: true, boardItems: [{ key: 'save-template', group: 'root', label: 'Save as template', icon: '' }] }))
	assert.deepEqual(acts(html), ['share', 'vote-setup', 'timer-open', 'private-setup', 'summon', 'timer-end', 'save-template'])
	// the top bar wires them to the board view's question and the timer's stop
	const src = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(src, /@vote-end="askVoteEnd"\s*@timer-end="timerAction\('stop'\)"/)
})

test('job 233 AK6: "Edit voting" shows the running settings disabled; "Add minutes" 5 → extend 5, empty → close, 0 and 1441 → an error and nothing sent', async () => {
	const running = view({ mod: true, per: 4, perItem: 2, types: ['sticky', 'text'], scope: 'F1', scopeTitle: 'Ideas', live: true, accountsOnly: true, endsAt: NOW + 60000 })
	let html = strip(await render(VoteSetupDialog, { running }))
	assert.match(tagOf(html, 'data-knorke-dialog="vote-edit"'), /name="Edit voting"/)
	assert.match(html, /These settings can&#39;t change while the voting runs\.|These settings can't change while the voting runs\./)
	for (const field of ['vote-per']) assert.match(tagOf(html, `data-knorke-field="${field}"`), /disabled/, field)
	for (const input of html.match(/<input[^>]*>/g)) {
		if (/data-knorke-field="vote-add"/.test(input)) assert.doesNotMatch(input, /disabled/, 'only "Add minutes" is open')
		else assert.match(input, /disabled/, input)
	}
	assert.match(tagOf(html, 'data-knorke-field="vote-per"'), /value="4"/)
	assert.match(html, /Selected frame “Ideas”/)
	assert.doesNotMatch(html, /data-knorke-field="vote-minutes"|data-knorke-vote-votable/, 'no time limit and no counter')
	let { bindings, emitted } = setupOf(VoteSetupDialog, { running })
	assert.equal(bindings.per.value, '4')
	assert.equal(bindings.onePerItem.value, false)
	assert.equal(bindings.scopeKind.value, 'frame')
	assert.deepEqual(bindings.types.value, ['sticky', 'text'])
	assert.equal(bindings.live.value, true)
	assert.equal(bindings.accountsOnly.value, true)
	bindings.minutes.value = '5'
	bindings.submit()
	assert.deepEqual(emitted, [['extend', 5]])
	;({ bindings, emitted } = setupOf(VoteSetupDialog, { running }))
	bindings.submit()
	assert.deepEqual(emitted, [['close']], 'empty: closes without a call')
	for (const bad of ['0', '1441', '2.5']) {
		;({ bindings, emitted } = setupOf(VoteSetupDialog, { running }))
		bindings.minutes.value = bad
		assert.equal(bindings.canSave.value, false, bad)
		assert.equal(bindings.cfg.value.minutesValid, false, bad)
		bindings.submit()
		assert.deepEqual(emitted, [], `${bad}: nothing sent`)
	}
	// the board view lengthens the session with the minutes (route 23 extend)
	const src = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(src, /async function extendVote\(minutes\) \{\s*const r = await moderate\(\(s\) => s\.updateVote\('extend', minutes\)\)/)
})

test('job 233 round 3: when the one-line bar runs over (bar or a text block, 2 px slack) it turns into the two lines over the board\'s width; the board gives them their height; a change of the segments tries one line again', async () => {
	const { SESSION_FIT_SLACK, sessionOverflows } = await import('../../../src/components/bars.js')
	assert.equal(SESSION_FIT_SLACK, 2)
	assert.equal(sessionOverflows({ client: 800, scroll: 800, texts: [[167, 168]] }), false, 'a pixel short is Chrome measuring, not an overflow')
	assert.equal(sessionOverflows({ client: 800, scroll: 803, texts: [] }), true, 'the bar runs over')
	assert.equal(sessionOverflows({ client: 1334, scroll: 1334, texts: [[422, 438], [97, 101]] }), true, 'a text block is cut (German while presenting)')
	assert.equal(sessionOverflows(null), false)
	// the component: compact shows the two lines (like the narrow layout) and tells the board
	const s = setupOf(SessionBar, { votes: view({ mod: true, voters: 2 }), timer: RUNNING, presenting: true, now: NOW, mod: true })
	assert.equal(s.bindings.lines.value, false)
	s.bindings.compact.value = true
	assert.equal(s.bindings.lines.value, true)
	assert.equal(setupOf(SessionBar, { votes: view(), now: NOW, narrow: true }).bindings.lines.value, true, 'narrow: always two lines')
	const src = readFileSync(new URL('../../../src/components/SessionBar.vue', import.meta.url), 'utf8')
	assert.match(src, /'knorke-sessionbar--compact': compact && !narrow/)
	assert.match(src, /<template v-if="!lines">/)
	assert.match(src, /watch\(shape, \(\) => retry\(\)\)/, 'a change of the segments tries one line again')
	assert.match(src, /window\.innerWidth > overflowAt/, 'a wider window tries one line again')
	const view2 = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(view2, /'knorke-board--sessionlines': showSessionBar && sessionLines/)
	assert.match(view2, /@compact="\(on\) => \{ sessionLines = on \}"/)
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /\.knorke-board--narrow,\s*\.knorke-board--sessionlines \{\s*--knorke-votebar-h: 56px;\s*\}/)
	assert.match(css, /\.knorke-sessionbar--compact \{\s*left: var\(--knorke-gap\);\s*right: var\(--knorke-gap\);/)
	assert.match(css, /\.knorke-sessionbar__line2 \{\s*flex-wrap: wrap;\s*row-gap: 0;/, 'line 2 may break once more on a phone')
	assert.match(css, /\.knorke-sessionbar__lines \.knorke-timerchip__icon \{\s*display: none !important;/)
	assert.match(css, /\.knorke-sessionbar__main > :not\(\.knorke-sessionbar__lines\) \{\s*flex: 0 0 auto;/, 'the buttons beside the lines keep their width')
})

test('job 275 AK6: "Private writing …" only while neither a vote is open nor private writing runs; while it runs no "Start voting", and "Reveal notes" under "Running now"', async () => {
	const acts = (html) => [...html.matchAll(/data-knorke-action="([a-z-]+)"/g)].map((m) => m[1])
	let html = strip(await render(ModerationMenu, { mod: true }))
	assert.match(html, /Private writing …/)
	html = strip(await render(ModerationMenu, { mod: true, privateOn: true }))
	assert.deepEqual(acts(html), ['timer-open', 'summon', 'private-reveal'])
	assert.match(tagOf(html, 'data-knorke-menu-caption="running"'), /name="Running now"/)
	assert.match(html, /Reveal notes/)
	html = strip(await render(ModerationMenu, { mod: true, voteOpen: true }))
	assert.doesNotMatch(html, /private-setup/)
	html = strip(await render(ModerationMenu, { mod: false, overflow: true, privateOn: true }))
	assert.doesNotMatch(html, /private-/, 'participants: no entry')
})

test('job 275 AK6: the session bar shows "Private writing" first (with the frame\'s title), "Reveal" for moderators only, in both forms', async () => {
	let html = strip(await render(SessionBar, { privateWriting: { frameTitle: '' }, now: NOW, mod: true }))
	assert.deepEqual(segments(html), ['private'])
	assert.match(html, /Private writing/)
	assert.match(html, /data-knorke-action="private-reveal"/)
	assert.equal((html.match(/knorke-sessionbar__sep/g) ?? []).length, 0)
	html = strip(await render(SessionBar, { privateWriting: { frameTitle: 'Ideen' }, timer: RUNNING, now: NOW, mod: false }))
	assert.deepEqual(segments(html), ['private', 'timer'])
	assert.equal((html.match(/knorke-sessionbar__sep/g) ?? []).length, 1)
	assert.match(html, /· Ideen/)
	assert.doesNotMatch(html, /private-reveal/, 'participants cannot reveal')
	html = strip(await render(SessionBar, { privateWriting: { frameTitle: '' }, now: NOW, mod: true, narrow: true }))
	assert.deepEqual(segments(html), ['private'])
	assert.doesNotMatch(html, /You&#39;re presenting|You're presenting/, 'narrow: no presenting line without a presentation')
	assert.match(html, /data-knorke-action="private-reveal"/)
})
