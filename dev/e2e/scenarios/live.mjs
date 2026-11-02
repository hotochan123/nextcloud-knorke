/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Live vote count for moderators (factory job 149).
 *
 * E54 alice (owner, Chromium 1440 × 900), bob (shared with "edit", desktop)
 * and Gina (guest over the edit link, 390 × 844 with touch) on a board of
 * their own with four notes N1–N4 in a row. Steps:
 *   (1) alice opens the vote setup through the moderation menu: the switch
 *       [data-knorke-field=vote-live] is off; she switches it on, sets 3
 *       votes and starts: route 22 carries live: true; alice's bar has
 *       "⋯" ([data-knorke-action=vote-more], job 233) with the check entry
 *       [data-knorke-action=vote-live] "Show live count", aria-checked
 *       "false";
 *   (2) bob sees [data-knorke-vote-live-note=bar] as text; Gina sees the
 *       notice at the top of her vote list and, after closing it, the eye
 *       button in the bar, whose tap shows [data-knorke-toast=vote-live-note];
 *   (3) bob votes N1 and N2, Gina N1 (vote list): alice's votes().tally is
 *       [[N1, 2], [N2, 1]], but scene().voteState.totals stays 0 while the
 *       button is off;
 *   (4) alice checks "Show live count": aria-checked "true", voteState.live
 *       true and totals 2;
 *   (5) the tab "Live count" of alice's list ranks N1 (2) before N2 (1),
 *       without ±; "Vote" was chosen at the opening, ← goes back to it;
 *   (6) Gina votes N3: alice's totals become 3 within 6 s;
 *   (7) bob: votes().tally null, totals 0, live false, and none of his /sync
 *       answers contains "tally" (alice's do);
 *   (8) "End voting": alice's voteState.live and liveShown false, the results
 *       stand as before (meta.vote, the ranking at everyone);
 *   (9) a second session without live (route 22): no button, no notice.
 * Own board, no instance setting: before E09, directly after E53.
 * Flake gate: --only E54 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell,
 * session and __knorke (bar, list, tabs, toast, votes()), [S] scene
 * (voteState), [B] a server answer or stored server state, [D] a harness
 * precondition. Waiting polls from Node with until() (Nextcloud's CSP,
 * ENTWICKLUNG trap 9.10).
 */
import { K, APP, PHONE, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, sleep, field, action } from '../lib/harness.mjs'
import { menuAction } from '../lib/moderation.mjs'

const TEXT = Object.freeze({
	note: 'Moderators see live counts',
	button: 'Show live count',
	empty: 'No votes yet.',
})
const OPEN_BAR = '[data-knorke-vote-bar][data-knorke-vote-state=open]'
/** job 233: "⋯" of the vote segment; its menu (in #knorke-menus) holds the check entry "Show live count" */
const MORE = '[data-knorke-vote-bar] [data-knorke-action=vote-more]'
const LIVE_BTN = '[data-knorke-action=vote-live]'
const LIVE_CHECK = '[data-knorke-action=vote-live] [role=menuitemcheckbox]'
const BAR_NOTE = '[data-knorke-vote-live-note=bar]'
const PANEL_NOTE = '[data-knorke-vote-live-note=panel]'
const TOAST = '[data-knorke-toast=vote-live-note]'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** A guest joins through /p/<token> with `name` (the name dialog), then the board session runs. */
async function joinAsGuest(actor, token, name) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await field(actor.page, 'guest-name', name)
	await action(actor.page, 'guest-join')
	await waitReady(actor.page, 30000)
}

/** Starts a session over route 22 as alice; returns the answer. */
function apiStart(board, cfg = {}) {
	return api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null, ...cfg })
}

/** Shows the whole board (Shift+1) with the canvas focused. */
async function fitAll(page) {
	await page.locator(CANVAS).first().focus()
	await page.keyboard.press('Shift+Digit1')
	await sleep(300)
}

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })
/** It disappears (or never shows) within `timeout`. */
const vanishes = (page, sel, timeout = 3000) => until(async () => !(await page.locator(sel).first().isVisible().catch(() => false)), { timeout })
/** Text of the first visible match, whitespace folded ('' when missing). */
const textOf = async (page, sel) => {
	const l = page.locator(sel).first()
	if (!(await l.isVisible().catch(() => false))) return ''
	return (await l.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}
/** An attribute of the first match (null when missing). */
const attrOf = (page, sel, name) => page.locator(sel).first().getAttribute(name, { timeout: 1000 }).catch(() => null)
/** Number of matches. */
const countOf = (page, sel) => page.locator(sel).count().catch(() => -1)
/** (job 233) Opens "⋯" of the vote segment; true when its menu shows "Edit voting …". */
async function openMore(page) {
	await page.locator(`${MORE} button`).first().click({ timeout: 3000 }).catch(() => {})
	return appears(page, '[data-knorke-action=vote-edit]', 3000)
}

/** The scene's vote state (__knorke.scene().voteState). */
const sceneVote = async (page) => (await K.scene(page).catch(() => null))?.voteState ?? null
/** __knorke.votes() or null. */
const votesOf = async (page) => {
	const v = await K.votes(page).catch(() => null)
	return v && v !== 'missing' ? v : null
}
/** The checked state of the input inside a field hook. */
const checkedIn = (page, sel) => page.locator(`${sel} input`).first().evaluate((el) => el.checked === true).catch(() => null)

/** Opens the VotePanel through the vote bar. */
async function openPanel(page) {
	if (await page.locator('[data-knorke-vote-panel]').first().isVisible().catch(() => false)) return true
	await page.locator('[data-knorke-vote-bar] [data-knorke-action=vote-panel]').first().click().catch(() => {})
	return appears(page, '[data-knorke-vote-panel]', 3000)
}

/** Closes an open VotePanel. */
async function closePanel(page) {
	if (!(await page.locator('[data-knorke-vote-panel]').first().isVisible().catch(() => false))) return true
	await page.locator('[data-knorke-action=vote-panel-close]').first().click().catch(() => {})
	return vanishes(page, '[data-knorke-vote-panel]', 3000)
}

/** One vote through the vote list ([data-knorke-vote-item=<id>] → vote-add). */
async function listVote(page, id) {
	const item = page.locator(`[data-knorke-vote-panel] [data-knorke-vote-item="${id}"]`).first()
	await item.waitFor({ state: 'visible', timeout: 5000 })
	await item.locator('[data-knorke-action=vote-add]').first().click()
}

/** Records the /sync answers of a page: how many, and how many contain "tally". */
function watchSync(page) {
	const seen = { n: 0, tally: 0 }
	page.on('response', (r) => {
		if (!/\/sync$/.test(r.url()) || r.request().method() !== 'POST') return
		r.text().then((body) => {
			seen.n++
			if (body.includes('"tally"')) seen.tally++
		}, () => {})
	})
	return seen
}

export const E54 = {
	id: 'E54',
	title: 'Live-Zwischenstand für die Moderation (Job 149): alice startet mit „Show live counts to moderators“; bob und Gina (Telefon) sehen den Hinweis, Ginas Augen-Tipp zeigt ihn als Meldung; bei alice keine Zahlen, solange „Live count“ aus ist, danach hohle Zahlen und eine neue Stimme in ≤ 6 s; der Reiter „Live count“ ordnet richtig; bob bekommt nie ein tally; nach dem Ende live aus und die Ergebnisse wie bisher; eine Sitzung ohne live zeigt weder Knopf noch Hinweis',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E54 Zwischenstand')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const L = await linkToken(board)
		const N = [ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, N.map((id, i) => put.sticky(id, { x: i * 280, y: 0, data: { text: `Notiz ${i + 1}` } })))
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: vier Notizen gesät', res)
		const a = await world.actor('alice-live', { user: 'alice' })
		const b = await world.actor('bob-live', { user: 'bob' })
		const g = await world.actor('gina-live', { touch: true, viewport: PHONE })
		try {
			const aliceSync = watchSync(a.page)
			const bobSync = watchSync(b.page)
			await openBoard(a, board)
			await openBoard(b, board)
			await joinAsGuest(g, L, 'Gina')
			await fitAll(a.page)
			await fitAll(b.page)

			t.step('(1) alice startet mit „Show live counts to moderators“')
			await menuAction(a.page, 'vote-setup')
			const dlg = a.page.locator('[data-knorke-dialog=vote-setup]').first()
			t.must(await dlg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (1) der Dialog vote-setup ist offen')
			t.check((await checkedIn(a.page, '[data-knorke-dialog=vote-setup] [data-knorke-field=vote-live]')) === false, '[C] (1) der Schalter vote-live ist beim Öffnen aus', await checkedIn(a.page, '[data-knorke-dialog=vote-setup] [data-knorke-field=vote-live]'))
			await dlg.locator('[data-knorke-field=vote-live] input').first().check()
			t.check((await checkedIn(a.page, '[data-knorke-dialog=vote-setup] [data-knorke-field=vote-live]')) === true, '[C] (1) vote-live lässt sich einschalten')
			await field(a.page, 'vote-per', '3')
			const reqP = a.page.waitForRequest((r) => /\/api\/v1\/boards\/\d+\/vote$/.test(r.url()) && r.method() === 'POST', { timeout: 10000 }).catch(() => null)
			const respP = a.page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/vote$/.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null)
			await dlg.locator('[data-knorke-action=vote-start]').first().click()
			const req = await reqP
			let sent = null
			try { sent = req ? req.postDataJSON() : null } catch { sent = null }
			t.check(sent && sent.live === true && sent.per === 3, '[C] (1) Route 22 bekommt live: true (und per 3)', sent)
			const resp = await respP
			t.check(resp && resp.status() === 200, '[B] (1) Route 22 → 200', resp && resp.status())
			const started = await Promise.all([a, b, g].map((x) => until(() => x.page.locator(OPEN_BAR).first().isVisible().catch(() => false), { timeout: 5000 })))
			t.must(started.every(Boolean), `[C] (1) die Leiste ist bei allen offen (alice, bob, Gina: ${started.map(Boolean).join(', ')})`)
			const meta = await K.meta(a.page)
			t.check(meta?.vote?.cfg?.live === true, '[B] (1) meta.vote.cfg.live === true', meta?.vote?.cfg)
			t.check(await appears(a.page, MORE, 3000), '[C] (1) alice: „⋯“ [data-knorke-action=vote-more] ist in der Leiste')
			t.check(await openMore(a.page), '[C] (1) alice: „⋯“ öffnet sich')
			t.check(await appears(a.page, LIVE_BTN, 3000), '[C] (1) alice: der Eintrag [data-knorke-action=vote-live] ist da')
			t.check((await attrOf(a.page, LIVE_CHECK, 'aria-checked')) === 'false', '[C] (1) alice: aria-checked="false" beim Start', await attrOf(a.page, LIVE_CHECK, 'aria-checked'))
			t.check((await textOf(a.page, LIVE_BTN)) === TEXT.button, `[C] (1) alice: der Eintrag heißt „${TEXT.button}“`, await textOf(a.page, LIVE_BTN))
			await a.page.keyboard.press('Escape')
			await vanishes(a.page, LIVE_BTN, 2000)
			t.check((await countOf(a.page, BAR_NOTE)) === 0, '[C] (1) alice: kein Hinweis für die Moderation')
			const av0 = await votesOf(a.page)
			t.check(av0 && av0.live === true && av0.liveShown === false, '[C] (1) alice: votes() {live true, liveShown false}', av0)

			t.step('(2) bob und Gina sehen den Hinweis; Ginas Tipp aufs Auge zeigt ihn als Meldung')
			t.check(await appears(b.page, BAR_NOTE, 3000), '[C] (2) bob: [data-knorke-vote-live-note=bar] ist sichtbar')
			t.check((await textOf(b.page, BAR_NOTE)) === TEXT.note, `[C] (2) bob: der Hinweis sagt „${TEXT.note}“`, await textOf(b.page, BAR_NOTE))
			t.check((await countOf(b.page, MORE)) === 0 && (await countOf(b.page, LIVE_BTN)) === 0, '[C] (2) bob: kein „⋯“ und kein „Show live count“')
			t.check(await appears(g.page, '[data-knorke-vote-panel]', 3000), '[C] (2) Gina: die Stimmliste ist beim Start offen (Telefon)')
			t.check(await appears(g.page, PANEL_NOTE, 3000), '[C] (2) Gina: [data-knorke-vote-live-note=panel] oben in der Liste')
			t.check((await textOf(g.page, PANEL_NOTE)).includes(TEXT.note), `[C] (2) Gina: der Listen-Hinweis sagt „${TEXT.note}“`, await textOf(g.page, PANEL_NOTE))
			t.check(await closePanel(g.page), '[C] (2) Gina: die Liste schließt (vote-panel-close)')
			const eye = g.page.locator(BAR_NOTE).first()
			t.must(await eye.isVisible().catch(() => false), '[C] (2) Gina: das Auge [data-knorke-vote-live-note=bar] in der Leiste')
			t.check((await eye.evaluate((el) => el.tagName).catch(() => '')) === 'BUTTON', '[C] (2) Gina: das Auge ist ein Knopf', await eye.evaluate((el) => el.tagName).catch(() => ''))
			t.check((await eye.getAttribute('aria-label').catch(() => null)) === TEXT.note, '[C] (2) Gina: aria-label des Auges ist der Satz', await eye.getAttribute('aria-label').catch(() => null))
			const eyeBox = await eye.boundingBox().catch(() => null)
			t.check(eyeBox && eyeBox.width >= 44 && eyeBox.height >= 44, '[C] (2) Gina: das Auge ist mindestens 44 × 44 px groß', eyeBox)
			await eye.tap({ timeout: 3000 }).catch(() => {})
			t.check(await appears(g.page, TOAST, 3000), '[C] (2) Gina: der Tipp zeigt die Meldung [data-knorke-toast=vote-live-note]')
			t.check((await textOf(g.page, TOAST)) === TEXT.note, `[C] (2) Gina: die Meldung sagt „${TEXT.note}“`, await textOf(g.page, TOAST))

			t.step('(3) bob stimmt für N1 und N2, Gina für N1: alice sieht den Stand, aber keine Zahlen auf dem Board')
			t.must(await openPanel(b.page), '[C] (3) bob: Stimmliste offen')
			await listVote(b.page, N[0])
			t.check(await until(async () => (await votesOf(b.page))?.mine?.[N[0]] === 1, { timeout: 5000 }), '[C] (3) bob: Stimme auf N1', await votesOf(b.page))
			await listVote(b.page, N[1])
			t.check(await until(async () => (await votesOf(b.page))?.mine?.[N[1]] === 1, { timeout: 5000 }), '[C] (3) bob: Stimme auf N2', await votesOf(b.page))
			t.check(await closePanel(b.page), '[C] (3) bob: Stimmliste zu')
			t.must(await openPanel(g.page), '[C] (3) Gina: Stimmliste offen')
			await listVote(g.page, N[0])
			t.check(await until(async () => (await votesOf(g.page))?.mine?.[N[0]] === 1, { timeout: 5000 }), '[C] (3) Gina: Stimme auf N1', await votesOf(g.page))
			const want1 = JSON.stringify([[N[0], 2], [N[1], 1]])
			t.check(await until(async () => JSON.stringify((await votesOf(a.page))?.tally) === want1, { timeout: 10000 }), '[C] (3) alice: votes().tally = [[N1, 2], [N2, 1]]', await votesOf(a.page))
			t.check(await until(() => aliceSync.tally > 0, { timeout: 2000 }), '[B] (3) alices /sync-Antworten tragen tally', aliceSync)
			const off = await sceneVote(a.page)
			t.check(off && off.totals === 0 && off.live === false, '[S] (3) alice: voteState {totals 0, live false}, solange „Live count“ aus ist', off)
			await sleep(2500)
			const off2 = await sceneVote(a.page)
			t.check(off2 && off2.totals === 0, '[S] (3) alice: auch 2,5 s später totals 0', off2)

			t.step('(4) alice drückt „Live count“')
			t.check(await openMore(a.page), '[C] (4) alice: „⋯“ öffnet sich')
			await a.page.locator(LIVE_CHECK).first().click()
			t.check(await until(async () => (await attrOf(a.page, LIVE_CHECK, 'aria-checked')) === 'true', { timeout: 2000 }), '[C] (4) alice: aria-checked="true"', await attrOf(a.page, LIVE_CHECK, 'aria-checked'))
			await a.page.keyboard.press('Escape')
			t.check((await votesOf(a.page))?.liveShown === true, '[C] (4) alice: votes().liveShown true', await votesOf(a.page))
			const on = await until(async () => { const v = await sceneVote(a.page); return v && v.live === true && v.totals === 2 ? v : null }, { timeout: 3000 })
			t.check(on, '[S] (4) alice: voteState {live true, totals 2}', await sceneVote(a.page))

			t.step('(5) der Reiter „Live count“ ordnet richtig')
			t.must(await openPanel(a.page), '[C] (5) alice: Stimmliste offen')
			const tabVote = a.page.locator('[data-knorke-vote-panel] [data-knorke-vote-tab=vote]').first()
			const tabLive = a.page.locator('[data-knorke-vote-panel] [data-knorke-vote-tab=live]').first()
			t.must(await tabLive.isVisible().catch(() => false), '[C] (5) alice: Reiter [data-knorke-vote-tab=live] da')
			t.check((await tabVote.getAttribute('aria-selected').catch(() => null)) === 'true', '[C] (5) beim Öffnen ist „Vote“ gewählt', await tabVote.getAttribute('aria-selected').catch(() => null))
			t.check(await a.page.locator(`[data-knorke-vote-panel] [data-knorke-vote-item="${N[0]}"] [data-knorke-action=vote-add]`).first().isVisible().catch(() => false), '[C] (5) „Vote“ zeigt die Liste mit +')
			await tabLive.click()
			t.check((await tabLive.getAttribute('aria-selected').catch(() => null)) === 'true', '[C] (5) „Live count“ gewählt', await tabLive.getAttribute('aria-selected').catch(() => null))
			t.check(await appears(a.page, '[data-knorke-vote-panel] ol[data-knorke-vote-live]', 3000), '[C] (5) die Rangliste [data-knorke-vote-live] ist sichtbar')
			const rows = await a.page.locator('[data-knorke-vote-panel] [data-knorke-vote-live-item]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-knorke-vote-live-item'), Number(e.querySelector('.knorke-votepanel__count')?.textContent?.trim())])).catch(() => [])
			t.check(JSON.stringify(rows) === want1, '[C] (5) Rangliste: N1 (2) vor N2 (1)', rows)
			const liveSteps = await a.page.locator('[data-knorke-vote-panel] .knorke-votepanel__live [data-knorke-action=vote-add], [data-knorke-vote-panel] .knorke-votepanel__live [data-knorke-action=vote-remove]').count().catch(() => -1)
			t.check(liveSteps === 0, '[C] (5) im Reiter „Live count“ kein + oder −', liveSteps)
			await tabLive.press('ArrowLeft')
			t.check(await until(async () => (await tabVote.getAttribute('aria-selected').catch(() => null)) === 'true', { timeout: 2000 }), '[C] (5) ← wählt „Vote“ wieder')
			t.check(await tabVote.evaluate((el) => el === document.activeElement).catch(() => false), '[C] (5) ← gibt „Vote“ den Fokus')
			t.check(await closePanel(a.page), '[C] (5) alice: Stimmliste zu')

			t.step('(6) Gina stimmt für N3: alice sieht die Zahl in ≤ 6 s')
			const t6 = Date.now()
			await listVote(g.page, N[2])
			const seen = await until(async () => { const v = await sceneVote(a.page); return v && v.totals === 3 ? v : null }, { timeout: 6000, every: 100 })
			t.check(seen, `[S] (6) alice: totals 3 binnen 6 s (nach ${Date.now() - t6} ms)`, await sceneVote(a.page))
			t.note(`neue Stimme bei alice nach ${Date.now() - t6} ms`)

			t.step('(7) bob bekommt nie einen Zwischenstand')
			await K.forceTick(b.page).catch(() => {})
			await K.waitIdle(b.page, 10000).catch(() => {})
			const bv = await votesOf(b.page)
			t.check(bv && bv.tally === null && bv.live === true && bv.liveShown === false, '[C] (7) bob: votes() {tally null, live true, liveShown false}', bv)
			const bs = await sceneVote(b.page)
			t.check(bs && bs.totals === 0 && bs.live === false, '[S] (7) bob: voteState {totals 0, live false}', bs)
			t.check(bobSync.n > 5 && bobSync.tally === 0, '[B] (7) keine von bobs /sync-Antworten enthält "tally"', bobSync)

			t.step('(8) alice beendet: live aus, Ergebnisse wie bisher')
			await a.page.locator('[data-knorke-vote-bar] [data-knorke-action=vote-end]').first().click()
			const confirm = a.page.locator('[data-knorke-action=confirm]').first()
			t.must(await confirm.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (8) „End voting“ fragt nach')
			await confirm.click()
			const panels = await Promise.all([a, b, g].map((x) => until(() => x.page.locator('[data-knorke-vote-panel] [data-knorke-vote-results]').first().isVisible().catch(() => false), { timeout: 8000 })))
			t.check(panels.every(Boolean), `[C] (8) die Rangliste öffnet sich bei allen (${panels.map(Boolean).join(', ')})`)
			const ended = await until(async () => { const v = await sceneVote(a.page); return v && v.live === false ? v : null }, { timeout: 3000 })
			t.check(ended && ended.totals === 0, '[S] (8) alice: voteState {live false, totals 0} nach dem Ende', await sceneVote(a.page))
			const avEnd = await votesOf(a.page)
			t.check(avEnd && avEnd.state === 'closed' && avEnd.liveShown === false && avEnd.tally === null, '[C] (8) alice: votes() {state closed, liveShown false, tally null}', avEnd)
			const results = [[N[0], 2], ...[N[1], N[2]].sort().map((id) => [id, 1])]
			const mv = (await K.meta(a.page))?.vote
			t.check(mv && mv.state === 'closed' && JSON.stringify(mv.results) === JSON.stringify(results) && mv.voters === 2 && mv.total === 3, '[B] (8) meta.vote: closed, results [[N1, 2], N2/N3 je 1 nach id], voters 2, total 3', mv)
			t.check((await countOf(a.page, MORE)) === 0 && (await countOf(a.page, LIVE_BTN)) === 0, '[C] (8) alice: kein „⋯“ und kein „Show live count“ mehr')
			const closedText = await textOf(a.page, '[data-knorke-vote-bar]')
			t.check(closedText.includes('Voting ended · 2 voted · Results'), '[C] (8) alice: Leiste „Voting ended · 2 voted · Results“', closedText)
			for (const x of [a, b, g]) await closePanel(x.page)

			t.step('(9) eine zweite Sitzung ohne live: weder Knopf noch Hinweis')
			const s2 = await apiStart(board)
			t.must(s2.status === 200 && s2.data?.board?.meta?.vote?.state === 'open' && !('live' in (s2.data.board.meta.vote.cfg || {})), '[B] (9) zweite Sitzung über Route 22 ohne live → 200, cfg ohne live', s2.text.slice(0, 300))
			const reopened = await Promise.all([a, b, g].map((x) => until(() => x.page.locator(OPEN_BAR).first().isVisible().catch(() => false), { timeout: 5000 })))
			t.must(reopened.every(Boolean), `[C] (9) die Leiste ist bei allen wieder offen (${reopened.map(Boolean).join(', ')})`)
			await sleep(1000)
			t.check(await openMore(a.page), '[C] (9) alice: „⋯“ öffnet sich')
			t.check((await countOf(a.page, LIVE_BTN)) === 0, '[C] (9) alice: kein „Show live count“ in „⋯“')
			await a.page.keyboard.press('Escape')
			t.check((await votesOf(a.page))?.live === false, '[C] (9) alice: votes().live false', await votesOf(a.page))
			for (const x of [b, g]) {
				t.check((await countOf(x.page, '[data-knorke-vote-live-note]')) === 0, `[C] (9) ${x.name}: kein Hinweis [data-knorke-vote-live-note]`)
			}
			await openPanel(a.page)
			t.check((await countOf(a.page, '[data-knorke-vote-panel] [data-knorke-vote-tab]')) === 0, '[C] (9) alice: keine Reiter in der Liste')
		} finally {
			await world.drop(g)
			await world.drop(b)
			await world.drop(a)
		}
	},
}
