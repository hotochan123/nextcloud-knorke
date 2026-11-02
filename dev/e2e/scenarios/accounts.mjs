/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Voting only with an account (factory job 175).
 *
 * E65 alice (owner, Chromium 1440 × 900), bob (shared with "edit",
 * desktop), Vera (guest over the voting link, desktop) and Gina (guest over
 * the edit link, 390 × 844 with touch) on a board of their own with four
 * notes N1–N4 in a row; carol has no share. Steps:
 *   (1) alice opens the vote setup through the moderation menu: the switch
 *       [data-knorke-field=vote-accounts] is off; she switches it on, sets 3
 *       votes and starts: route 22 carries accountsOnly: true and
 *       meta.vote.cfg.accountsOnly is true;
 *   (2) bob sees [data-knorke-vote-accounts=note] "Accounts only", no
 *       "Sign in", and votes N1 through the list (left 3 → 2);
 *   (3) Vera sees [data-knorke-vote-accounts=guest] with the sentence and
 *       [data-knorke-action=vote-signin]; votes() {canVote false, voteBlocked
 *       true}, state().uiMode view; a click on N2 sends no "o":"vote";
 *   (4) Gina (phone, edit link) sees the symbol button with the sentence as
 *       aria-label, its tap shows [data-knorke-toast=vote-accounts-note],
 *       "Sign in" is at least 44 px high, the bar does not overflow
 *       (scrollWidth ≤ clientWidth + 1), uiMode view, banner viewonly;
 *   (5) Vera clicks "Sign in": the Nextcloud login with redirect_url; she
 *       signs in as carol and lands on the same board as an account
 *       (source link, role vote); carol votes N3 (left 3 → 2, canVote true);
 *   (6) a second session without the option (route 22): no notice anywhere,
 *       and Gina votes as a guest as before (left 3 → 2).
 * Own board, no instance setting: before E09, directly after E64 (job 174's).
 * Flake gate: --only E65 --repeat 3.
 *
 * E71 (factory job 184): the name dialog of the links already says that only
 * accounts vote. Own board with an edit and a voting link; alice works only
 * through the API. Steps:
 *   (1) alice starts a session with accountsOnly over route 22;
 *   (2) Vera (fresh guest, desktop) opens the voting link: the name dialog
 *       shows [data-knorke=accounts-vote] with the sentence and
 *       [data-knorke-action=guest-signin] "Sign in", "Your votes are
 *       anonymous." stays, the name field has the focus;
 *   (3) Gina (fresh guest, 390 × 844 with touch) opens the edit link: the
 *       same note, "Sign in" at least 44 px high, the dialog does not
 *       overflow (scrollWidth ≤ clientWidth + 1); she joins as a guest with
 *       a name and "Join", her bar shows [data-knorke-vote-accounts=guest];
 *   (4) Vera clicks "Sign in": the login with redirect_url = /p/<token>; she
 *       signs in as carol (no share) and lands on the same board as an
 *       account with votes().canVote true;
 *   (5) alice ends the session and starts one without the option: a fresh
 *       guest sees no note;
 *   (6) alice sets a password on the edit link and starts again with
 *       accountsOnly: a fresh guest sees the password field, but no note.
 * Own board, no instance setting: before E09, directly after E70 (job 181's).
 * Flake gate: --only E71 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell,
 * session and __knorke (bar, list, toast, votes(), state()), [B] a server
 * answer or stored server state, [D] a harness precondition. Waiting polls
 * from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, PHONE, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, sleep, field, action, centerOf, bannerVisible, passOf } from '../lib/harness.mjs'
import { menuAction } from '../lib/moderation.mjs'

const TEXT = Object.freeze({
	note: 'Accounts only',
	guest: 'Only signed-in accounts can vote.',
	signin: 'Sign in',
})
const OPEN_BAR = '[data-knorke-vote-bar][data-knorke-vote-state=open]'
const NOTE = '[data-knorke-vote-bar] [data-knorke-vote-accounts=note]'
const GUEST = '[data-knorke-vote-bar] [data-knorke-vote-accounts=guest]'
const SIGNIN = '[data-knorke-vote-bar] [data-knorke-action=vote-signin]'
const TOAST = '[data-knorke-toast=vote-accounts-note]'

/** Shares a board (route 20 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Turns a link of a board on (API as alice: 'link' = edit link, 'votelink' = voting link); returns its token. */
async function linkOf(board, kind) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/${kind}`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`${kind} ${board}: ${r.status} ${r.text.slice(0, 200)}`)
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
/** The bar's data-knorke-vote-left as a number (null when missing). */
const leftOf = async (page) => {
	const v = await attrOf(page, '[data-knorke-vote-bar]', 'data-knorke-vote-left')
	return v === null ? null : Number(v)
}

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

/** Records the vote ops a page sends: every /sync request whose body carries "o":"vote". */
function watchVotes(page) {
	const seen = { n: 0 }
	page.on('request', (r) => {
		if (!/\/sync$/.test(r.url()) || r.method() !== 'POST') return
		if ((r.postData() || '').includes('"o":"vote"')) seen.n++
	})
	return seen
}

/** The Nextcloud login form on the current page (Sign in → /login?redirect_url=…). */
async function loginHere(page, user) {
	await page.waitForSelector('input[name=user]', { timeout: 15000 })
	await page.fill('input[name=user]', user)
	await page.fill('input[name=password]', passOf(user))
	await Promise.all([
		page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }),
		page.click('button[type=submit]'),
	])
}

export const E65 = {
	id: 'E65',
	title: 'Abstimmen nur mit Konto (Job 175): alice startet mit „Accounts only“; bob sieht den Hinweis und stimmt ab; Vera (Abstimmungslink, Computer) sieht den Satz und „Sign in“, kann nicht abstimmen und ein Klick schickt keine Stimme; Gina (Bearbeitungslink, Telefon) sieht das Symbol, ein Tipp zeigt die Meldung, „Sign in“ ≥ 44 px, die Leiste läuft nicht über; Vera meldet sich als carol an und stimmt auf demselben Board ab; eine Sitzung ohne die Option zeigt keinen Hinweis und Gina stimmt wie bisher ab',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E65 Nur Konten')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const LE = await linkOf(board, 'link')
		const LV = await linkOf(board, 'votelink')
		const N = [ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, N.map((id, i) => put.sticky(id, { x: i * 280, y: 0, data: { text: `Notiz ${i + 1}` } })))
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: vier Notizen gesät', res)
		const a = await world.actor('alice-accounts', { user: 'alice' })
		const b = await world.actor('bob-accounts', { user: 'bob' })
		const v = await world.actor('vera-accounts')
		const g = await world.actor('gina-accounts', { touch: true, viewport: PHONE })
		try {
			// "Sign in" leaves the page: a beforeunload question (only with unsent ops) is answered with yes
			v.page.on('dialog', (d) => { d.accept().catch(() => {}) })
			const veraVotes = watchVotes(v.page)
			await openBoard(a, board)
			await openBoard(b, board)
			await joinAsGuest(v, LV, 'Vera')
			await joinAsGuest(g, LE, 'Gina')
			await fitAll(a.page)
			await fitAll(v.page)
			const vs = await K.state(v.page)
			const gs = await K.state(g.page)
			t.must(vs.mode === 'guest' && vs.role === 'vote' && gs.mode === 'guest' && gs.role === 'edit', '[D] Vorbedingung: Vera Gast mit vote, Gina Gast mit edit', { vs, gs })

			t.step('(1) alice startet mit „Accounts only“')
			await menuAction(a.page, 'vote-setup')
			const dlg = a.page.locator('[data-knorke-dialog=vote-setup]').first()
			t.must(await dlg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (1) der Dialog vote-setup ist offen')
			t.check((await checkedIn(a.page, '[data-knorke-dialog=vote-setup] [data-knorke-field=vote-accounts]')) === false, '[C] (1) der Schalter vote-accounts ist beim Öffnen aus', await checkedIn(a.page, '[data-knorke-dialog=vote-setup] [data-knorke-field=vote-accounts]'))
			await dlg.locator('[data-knorke-field=vote-accounts] input').first().check()
			t.check((await checkedIn(a.page, '[data-knorke-dialog=vote-setup] [data-knorke-field=vote-accounts]')) === true, '[C] (1) vote-accounts lässt sich einschalten')
			await field(a.page, 'vote-per', '3')
			const reqP = a.page.waitForRequest((r) => /\/api\/v1\/boards\/\d+\/vote$/.test(r.url()) && r.method() === 'POST', { timeout: 10000 }).catch(() => null)
			const respP = a.page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/vote$/.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null)
			await dlg.locator('[data-knorke-action=vote-start]').first().click()
			const req = await reqP
			let sent = null
			try { sent = req ? req.postDataJSON() : null } catch { sent = null }
			t.check(sent && sent.accountsOnly === true && sent.per === 3, '[C] (1) Route 22 bekommt accountsOnly: true (und per 3)', sent)
			const resp = await respP
			t.check(resp && resp.status() === 200, '[B] (1) Route 22 → 200', resp && resp.status())
			const started = await Promise.all([a, b, v, g].map((x) => until(() => x.page.locator(OPEN_BAR).first().isVisible().catch(() => false), { timeout: 6000 })))
			t.must(started.every(Boolean), `[C] (1) die Leiste ist bei allen offen (alice, bob, Vera, Gina: ${started.map(Boolean).join(', ')})`)
			const meta = await K.meta(a.page)
			t.check(meta?.vote?.cfg?.accountsOnly === true, '[B] (1) meta.vote.cfg.accountsOnly === true', meta?.vote?.cfg)
			t.check(await appears(a.page, NOTE, 3000), '[C] (1) alice: der Hinweis [data-knorke-vote-accounts=note]')
			t.check((await countOf(a.page, SIGNIN)) === 0, '[C] (1) alice: kein „Sign in“')

			t.step('(2) bob sieht „Accounts only“ und stimmt ab')
			t.check(await appears(b.page, NOTE, 3000), '[C] (2) bob: [data-knorke-vote-accounts=note] ist sichtbar')
			t.check((await textOf(b.page, NOTE)) === TEXT.note, `[C] (2) bob: der Hinweis sagt „${TEXT.note}“`, await textOf(b.page, NOTE))
			t.check((await countOf(b.page, SIGNIN)) === 0 && (await countOf(b.page, GUEST)) === 0, '[C] (2) bob: weder Gast-Satz noch „Sign in“')
			const bv0 = await votesOf(b.page)
			t.check(bv0 && bv0.accountsOnly === true && bv0.voteBlocked === false && bv0.canVote === true, '[C] (2) bob: votes() {accountsOnly true, voteBlocked false, canVote true}', bv0)
			t.check((await leftOf(b.page)) === 3, '[C] (2) bob: 3 Stimmen übrig', await leftOf(b.page))
			t.must(await openPanel(b.page), '[C] (2) bob: Stimmliste offen')
			await listVote(b.page, N[0])
			t.check(await until(async () => (await leftOf(b.page)) === 2, { timeout: 5000 }), '[C] (2) bob: nach der Stimme auf N1 2 übrig', await leftOf(b.page))
			t.check(await until(async () => (await votesOf(a.page))?.voters === 1, { timeout: 10000 }), '[B] (2) der Server zählt bobs Stimme: alice sieht votes().voters 1', await votesOf(a.page))
			t.check(await closePanel(b.page), '[C] (2) bob: Stimmliste zu')

			t.step('(3) Vera (Abstimmungslink, Computer) sieht den Satz und „Sign in“, kann nicht abstimmen')
			t.check(await appears(v.page, GUEST, 3000), '[C] (3) Vera: [data-knorke-vote-accounts=guest] ist sichtbar')
			t.check((await textOf(v.page, GUEST)) === TEXT.guest, `[C] (3) Vera: der Satz „${TEXT.guest}“`, await textOf(v.page, GUEST))
			t.check((await countOf(v.page, NOTE)) === 0, '[C] (3) Vera: kein „Accounts only“ daneben')
			t.check(await appears(v.page, SIGNIN, 3000), '[C] (3) Vera: der Knopf [data-knorke-action=vote-signin] ist da')
			t.check((await textOf(v.page, SIGNIN)) === TEXT.signin, `[C] (3) Vera: der Knopf heißt „${TEXT.signin}“`, await textOf(v.page, SIGNIN))
			const vv = await votesOf(v.page)
			t.check(vv && vv.canVote === false && vv.voteBlocked === true && vv.accountsOnly === true, '[C] (3) Vera: votes() {canVote false, voteBlocked true, accountsOnly true}', vv)
			t.check((await K.state(v.page)).uiMode === 'view', '[C] (3) Vera: state().uiMode view', await K.state(v.page))
			t.check(!(await textOf(v.page, '[data-knorke-vote-bar]')).includes('left'), '[C] (3) Vera: keine Reststimmen in der Leiste', await textOf(v.page, '[data-knorke-vote-bar]'))
			const before = veraVotes.n
			const c2 = await centerOf(v.page, N[1])
			await v.page.mouse.click(c2.x, c2.y)
			await sleep(500)
			await K.forceTick(v.page).catch(() => {})
			await K.waitIdle(v.page, 5000).catch(() => {})
			await sleep(2500)
			t.check(veraVotes.n === before, '[C] (3) Vera: der Klick auf N2 schickt keine "o":"vote"', veraVotes)
			const vvm = await votesOf(v.page)
			t.check(vvm && Object.keys(vvm.mine || {}).length === 0, '[C] (3) Vera: votes().mine bleibt leer', vvm)
			await K.forceTick(a.page).catch(() => {})
			await sleep(1000)
			t.check((await votesOf(a.page))?.voters === 1, '[B] (3) der Server zählt weiter nur bob (voters 1)', await votesOf(a.page))

			t.step('(4) Gina (Bearbeitungslink, Telefon) sieht das Symbol; ein Tipp zeigt die Meldung')
			t.check((await countOf(g.page, '[data-knorke-vote-panel]')) === 0, '[C] (4) Gina: die Stimmliste öffnet sich beim Start nicht von selbst')
			const sym = g.page.locator(GUEST).first()
			t.must(await sym.isVisible().catch(() => false), '[C] (4) Gina: das Symbol [data-knorke-vote-accounts=guest] in der Leiste')
			t.check((await sym.evaluate((el) => el.tagName).catch(() => '')) === 'BUTTON', '[C] (4) Gina: das Symbol ist ein Knopf', await sym.evaluate((el) => el.tagName).catch(() => ''))
			t.check((await sym.getAttribute('aria-label').catch(() => null)) === TEXT.guest, '[C] (4) Gina: aria-label des Symbols ist der Satz', await sym.getAttribute('aria-label').catch(() => null))
			const symBox = await sym.boundingBox().catch(() => null)
			t.check(symBox && symBox.width >= 44 && symBox.height >= 44, '[C] (4) Gina: das Symbol ist mindestens 44 × 44 px groß', symBox)
			await sym.tap({ timeout: 3000 }).catch(() => {})
			t.check(await appears(g.page, TOAST, 3000), '[C] (4) Gina: der Tipp zeigt die Meldung [data-knorke-toast=vote-accounts-note]')
			t.check((await textOf(g.page, TOAST)) === TEXT.guest, `[C] (4) Gina: die Meldung sagt „${TEXT.guest}“`, await textOf(g.page, TOAST))
			const gIn = g.page.locator(SIGNIN).first()
			const inBox = await gIn.boundingBox().catch(() => null)
			t.check(inBox && inBox.height >= 44, '[C] (4) Gina: „Sign in“ ist mindestens 44 px hoch', inBox)
			const fit = await g.page.locator('[data-knorke-vote-bar]').first().evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth })).catch(() => null)
			t.check(fit && fit.scroll <= fit.client + 1, '[C] (4) Gina: die Leiste läuft nicht über (scrollWidth ≤ clientWidth + 1)', fit)
			const gv = await votesOf(g.page)
			t.check(gv && gv.canVote === false && gv.voteBlocked === true, '[C] (4) Gina: votes() {canVote false, voteBlocked true}', gv)
			t.check((await K.state(g.page)).uiMode === 'view', '[C] (4) Gina: state().uiMode view', await K.state(g.page))
			t.check(await until(() => bannerVisible(g.page, 'viewonly'), { timeout: 3000 }), '[C] (4) Gina: Banner [data-knorke-banner=viewonly] statt device_vote')
			t.check(!(await bannerVisible(g.page, 'device_vote')), '[C] (4) Gina: kein Banner device_vote')

			t.step('(5) Vera klickt „Sign in“, meldet sich als carol an und stimmt auf demselben Board ab')
			const navP = v.page.waitForURL((u) => /\/login/.test(u.pathname), { timeout: 15000 }).then(() => true, () => false)
			await v.page.locator(SIGNIN).first().click()
			t.must(await navP, '[C] (5) „Sign in“ öffnet die Nextcloud-Anmeldung', v.page.url())
			const loginUrl = new URL(v.page.url())
			const redirect = loginUrl.searchParams.get('redirect_url') || ''
			t.check(redirect.endsWith(`/apps/knorke/p/${LV}`) && redirect.startsWith('/'), '[C] (5) redirect_url ist der relative Pfad /p/<Token>', redirect)
			await loginHere(v.page, 'carol')
			const landed = await until(() => new RegExp(`/apps/knorke/b/${board}$`).test(new URL(v.page.url()).pathname), { timeout: 30000 })
			t.must(landed, '[B] (5) nach der Anmeldung landet carol auf demselben Board (/b/<id>)', v.page.url())
			await waitReady(v.page, 30000)
			const cs = await K.state(v.page)
			t.check(cs.mode === 'user' && cs.source === 'link' && cs.role === 'vote', '[B] (5) carol ist ein Konto über den Link: state() {mode user, source link, role vote}', cs)
			t.check(await appears(v.page, NOTE, 5000), '[C] (5) carol: [data-knorke-vote-accounts=note] statt des Gast-Satzes')
			t.check((await countOf(v.page, SIGNIN)) === 0, '[C] (5) carol: kein „Sign in“ mehr')
			const cv = await votesOf(v.page)
			t.check(cv && cv.canVote === true && cv.voteBlocked === false, '[C] (5) carol: votes() {canVote true, voteBlocked false}', cv)
			t.check((await leftOf(v.page)) === 3, '[C] (5) carol: 3 Stimmen übrig', await leftOf(v.page))
			t.must(await openPanel(v.page), '[C] (5) carol: Stimmliste offen')
			await listVote(v.page, N[2])
			t.check(await until(async () => (await leftOf(v.page)) === 2, { timeout: 5000 }), '[C] (5) carol: nach der Stimme auf N3 2 übrig', await leftOf(v.page))
			t.check(await until(async () => (await votesOf(a.page))?.voters === 2, { timeout: 10000 }), '[B] (5) der Server zählt carols Stimme: alice sieht votes().voters 2', await votesOf(a.page))
			await closePanel(v.page)

			t.step('(6) eine zweite Sitzung ohne die Option: kein Hinweis, Gina stimmt als Gast ab')
			const end = await api('alice', 'PATCH', `/api/v1/boards/${board}/vote`, { action: 'end' })
			t.must(end.status === 200, '[B] (6) Ende über Route 23 → 200', end.text.slice(0, 200))
			t.check(await until(async () => (await votesOf(g.page))?.state === 'closed', { timeout: 8000 }), '[C] (6) Gina: die Sitzung ist zu', await votesOf(g.page))
			for (const x of [a, b, v, g]) await closePanel(x.page)
			const s2 = await apiStart(board)
			t.must(s2.status === 200 && s2.data?.board?.meta?.vote?.state === 'open' && !('accountsOnly' in (s2.data.board.meta.vote.cfg || {})), '[B] (6) zweite Sitzung über Route 22 ohne accountsOnly → 200, cfg ohne den Schlüssel', s2.text.slice(0, 300))
			const reopened = await Promise.all([a, b, v, g].map((x) => until(() => x.page.locator(OPEN_BAR).first().isVisible().catch(() => false), { timeout: 6000 })))
			t.must(reopened.every(Boolean), `[C] (6) die Leiste ist bei allen wieder offen (${reopened.map(Boolean).join(', ')})`)
			await sleep(1000)
			for (const x of [a, b, v, g]) {
				t.check((await countOf(x.page, '[data-knorke-vote-accounts]')) === 0 && (await countOf(x.page, SIGNIN)) === 0, `[C] (6) ${x.name}: kein Hinweis [data-knorke-vote-accounts], kein „Sign in“`)
			}
			const gv2 = await votesOf(g.page)
			t.check(gv2 && gv2.canVote === true && gv2.voteBlocked === false && gv2.accountsOnly === false, '[C] (6) Gina: votes() {canVote true, voteBlocked false, accountsOnly false}', gv2)
			t.check((await K.state(g.page)).uiMode === 'vote', '[C] (6) Gina: state().uiMode vote', await K.state(g.page))
			t.check((await leftOf(g.page)) === 3, '[C] (6) Gina: 3 Stimmen übrig', await leftOf(g.page))
			t.must(await openPanel(g.page), '[C] (6) Gina: Stimmliste offen')
			await listVote(g.page, N[3])
			t.check(await until(async () => (await leftOf(g.page)) === 2, { timeout: 5000 }), '[C] (6) Gina: nach der Stimme auf N4 2 übrig', await leftOf(g.page))
			t.check(await until(async () => (await votesOf(a.page))?.voters === 1, { timeout: 10000 }), '[B] (6) der Server zählt Ginas Stimme: alice sieht votes().voters 1', await votesOf(a.page))
		} finally {
			await world.drop(g)
			await world.drop(v)
			await world.drop(b)
			await world.drop(a)
		}
	},
}

// ---- E71 (job 184): the accounts-only note in the name dialog ----------------

const DIALOG_TEXT = Object.freeze({
	note: 'Only signed-in accounts can vote right now.',
	signin: 'Sign in',
	anonymous: 'Your votes are anonymous.',
})
const NAME_FIELD = '[data-knorke-field=guest-name]'
const DIALOG_NOTE = '[data-knorke=accounts-vote]'
const DIALOG_SIGNIN = '[data-knorke=accounts-vote] [data-knorke-action=guest-signin]'
const E71_PW = 'Knorke-E71-Pw-4711!'

/** A fresh guest (no stored identity) opens /p/<token> and waits for the name dialog. */
async function nameDialog(world, name, token, opts = {}) {
	const g = await world.actor(name, opts)
	await g.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await g.page.locator(NAME_FIELD).first().waitFor({ state: 'visible', timeout: 15000 })
	return g
}

/** The name field (wrapper or input) has the focus. */
const nameFocused = (page) => page.evaluate((sel) => {
	const a = document.activeElement
	return !!(a && a.closest && a.closest(sel))
}, NAME_FIELD).catch(() => false)

/** scrollWidth/clientWidth of the dialog box around the note and of the note itself, and its right edge. */
const dialogFit = (page) => page.evaluate((sel) => {
	const note = document.querySelector(sel)
	if (!note) return null
	const box = note.closest('.modal-container') || note.closest('.knorke-dialog')
	const content = note.closest('.dialog__content')
	const m = (el) => (el ? { scroll: el.scrollWidth, client: el.clientWidth } : null)
	return { box: m(box), content: m(content), note: m(note), right: note.getBoundingClientRect().right, vw: window.innerWidth }
}, DIALOG_NOTE).catch(() => null)
const fits = (m) => !m || m.scroll <= m.client + 1

/** Ends the open session over route 23 as alice. */
function apiEnd(board) {
	return api('alice', 'PATCH', `/api/v1/boards/${board}/vote`, { action: 'end' })
}

export const E71 = {
	id: 'E71',
	title: 'Hinweis „Nur Konten“ im Namensdialog (Job 184): alice startet über Route 22 mit accountsOnly; ein Gast am Computer sieht am Abstimmungslink den Satz und „Sign in“, „Your votes are anonymous.“ bleibt, der Fokus im Namensfeld; ein Gast am Telefon sieht am Bearbeitungslink denselben Hinweis, „Sign in“ ≥ 44 px, kein Überlauf, und tritt als Gast bei; „Sign in“ führt über die Anmeldung als carol aufs Board, dort darf sie abstimmen; ohne die Option und bei einem Link mit Passwort kein Hinweis',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E71 Namensdialog Nur Konten')
		const LE = await linkOf(board, 'link')
		const LV = await linkOf(board, 'votelink')
		const res = await seedOps('alice', board, [put.sticky(ulid(), { x: 0, y: 0, data: { text: 'Notiz' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: eine Notiz gesät', res)
		const guests = []
		const fresh = async (name, token, opts) => {
			const g = await nameDialog(world, name, token, opts)
			guests.push(g)
			return g
		}
		const drop = async (g) => {
			const i = guests.indexOf(g)
			if (i >= 0) guests.splice(i, 1)
			await world.drop(g)
		}
		try {
			t.step('(1) alice startet über Route 22 mit accountsOnly')
			const s1 = await apiStart(board, { accountsOnly: true })
			t.must(s1.status === 200 && s1.data?.board?.meta?.vote?.state === 'open' && s1.data.board.meta.vote.cfg?.accountsOnly === true, '[B] (1) Route 22 mit accountsOnly → 200, meta.vote.cfg.accountsOnly true', s1.text.slice(0, 300))

			t.step('(2) Vera (Abstimmungslink, Computer) sieht im Namensdialog den Satz und „Sign in“')
			const v = await fresh('vera-dialog', LV)
			t.check(await appears(v.page, DIALOG_NOTE, 3000), '[C] (2) Vera: [data-knorke=accounts-vote] im Namensdialog')
			t.check((await textOf(v.page, `${DIALOG_NOTE} p`)) === DIALOG_TEXT.note, `[C] (2) Vera: der Satz „${DIALOG_TEXT.note}“`, await textOf(v.page, `${DIALOG_NOTE} p`))
			t.check((await textOf(v.page, DIALOG_SIGNIN)) === DIALOG_TEXT.signin, `[C] (2) Vera: der Knopf [data-knorke-action=guest-signin] heißt „${DIALOG_TEXT.signin}“`, await textOf(v.page, DIALOG_SIGNIN))
			t.check((await attrOf(v.page, DIALOG_SIGNIN, 'type')) === 'button', '[C] (2) Vera: „Sign in“ ist type=button (Enter tritt als Gast bei)', await attrOf(v.page, DIALOG_SIGNIN, 'type'))
			t.check((await textOf(v.page, '.knorke-dialog__message')) === DIALOG_TEXT.anonymous, `[C] (2) Vera: „${DIALOG_TEXT.anonymous}“ steht weiter da`, await textOf(v.page, '.knorke-dialog__message'))
			t.check(await until(() => nameFocused(v.page), { timeout: 3000 }), '[C] (2) Vera: der Fokus liegt im Namensfeld', await v.page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)).catch(() => null))

			t.step('(3) Gina (Bearbeitungslink, Telefon) sieht denselben Hinweis und tritt als Gast bei')
			const g = await fresh('gina-dialog', LE, { touch: true, viewport: PHONE })
			t.check(await appears(g.page, DIALOG_NOTE, 3000), '[C] (3) Gina: [data-knorke=accounts-vote] im Namensdialog')
			t.check((await textOf(g.page, `${DIALOG_NOTE} p`)) === DIALOG_TEXT.note, '[C] (3) Gina: derselbe Satz', await textOf(g.page, `${DIALOG_NOTE} p`))
			const inBox = await g.page.locator(DIALOG_SIGNIN).first().boundingBox().catch(() => null)
			t.check(inBox && inBox.height >= 44, '[C] (3) Gina: „Sign in“ ist mindestens 44 px hoch', inBox)
			const fit = await dialogFit(g.page)
			t.check(fit && fit.box && fits(fit.box) && fits(fit.content) && fits(fit.note) && fit.right <= fit.vw + 1, '[C] (3) Gina: der Dialog läuft auf 390 px nicht über (scrollWidth ≤ clientWidth + 1)', fit)
			await field(g.page, 'guest-name', 'Gina')
			await action(g.page, 'guest-join')
			await waitReady(g.page, 30000)
			const gs = await K.state(g.page)
			t.check(gs.mode === 'guest' && gs.role === 'edit', '[C] (3) Gina ist als Gast beigetreten: state() {mode guest, role edit}', gs)
			t.check(await appears(g.page, GUEST, 6000), '[C] (3) Gina: ihre Leiste zeigt [data-knorke-vote-accounts=guest]')
			await drop(g)

			t.step('(4) Vera klickt „Sign in“, meldet sich als carol an und darf abstimmen')
			const navP = v.page.waitForURL((u) => /\/login/.test(u.pathname), { timeout: 15000 }).then(() => true, () => false)
			await v.page.locator(DIALOG_SIGNIN).first().click()
			t.must(await navP, '[C] (4) „Sign in“ öffnet die Nextcloud-Anmeldung', v.page.url())
			const redirect = new URL(v.page.url()).searchParams.get('redirect_url') || ''
			t.check(redirect.includes(`/apps/knorke/p/${LV}`) && redirect.startsWith('/'), '[C] (4) redirect_url enthält /apps/knorke/p/<Token> (relativ)', redirect)
			await loginHere(v.page, 'carol')
			const landed = await until(() => new RegExp(`/apps/knorke/b/${board}$`).test(new URL(v.page.url()).pathname), { timeout: 30000 })
			t.must(landed, '[B] (4) nach der Anmeldung landet carol auf demselben Board (/b/<id>)', v.page.url())
			await waitReady(v.page, 30000)
			const cs = await K.state(v.page)
			t.check(cs.mode === 'user' && cs.source === 'link' && cs.role === 'vote', '[B] (4) carol ist ein Konto über den Link: state() {mode user, source link, role vote}', cs)
			t.check(await until(async () => (await votesOf(v.page))?.canVote === true, { timeout: 5000 }), '[C] (4) carol: votes().canVote === true', await votesOf(v.page))
			await drop(v)

			t.step('(5) eine Sitzung ohne die Option: ein frischer Gast sieht keinen Hinweis')
			const e1 = await apiEnd(board)
			t.must(e1.status === 200, '[B] (5) Ende über Route 23 → 200', e1.text.slice(0, 200))
			const s2 = await apiStart(board)
			t.must(s2.status === 200 && s2.data?.board?.meta?.vote?.state === 'open' && !('accountsOnly' in (s2.data.board.meta.vote.cfg || {})), '[B] (5) Route 22 ohne accountsOnly → 200, cfg ohne den Schlüssel', s2.text.slice(0, 300))
			const n = await fresh('gast-ohne-option', LV)
			t.check((await countOf(n.page, DIALOG_NOTE)) === 0 && (await countOf(n.page, '[data-knorke-action=guest-signin]')) === 0, '[C] (5) kein [data-knorke=accounts-vote] und kein „Sign in“ im Namensdialog')
			t.check((await textOf(n.page, '.knorke-dialog__message')) === DIALOG_TEXT.anonymous, '[C] (5) der Dialog ist sonst unverändert', await textOf(n.page, '.knorke-dialog__message'))
			await drop(n)

			t.step('(6) Passwort am Bearbeitungslink, wieder accountsOnly: Passwortfeld, aber kein Hinweis')
			const pw = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false, password: E71_PW })
			t.must(pw.status === 200 && pw.data?.link?.password === true && typeof pw.data.link.token === 'string', '[B] (6) Passwort am Bearbeitungslink gesetzt (Route 9 → 200, password true)', pw.text.slice(0, 200))
			const e2 = await apiEnd(board)
			t.must(e2.status === 200, '[B] (6) Ende der zweiten Sitzung → 200', e2.text.slice(0, 200))
			const s3 = await apiStart(board, { accountsOnly: true })
			t.must(s3.status === 200 && s3.data?.board?.meta?.vote?.cfg?.accountsOnly === true, '[B] (6) Route 22 wieder mit accountsOnly → 200', s3.text.slice(0, 300))
			const p = await fresh('gast-passwort', pw.data.link.token)
			t.check(await appears(p.page, '[data-knorke-field=guest-password]', 5000), '[C] (6) der Namensdialog zeigt das Passwortfeld [data-knorke-field=guest-password]')
			t.check((await countOf(p.page, DIALOG_NOTE)) === 0 && (await countOf(p.page, '[data-knorke-action=guest-signin]')) === 0, '[C] (6) kein [data-knorke=accounts-vote] und kein „Sign in“ bei einem Link mit Passwort')
			await drop(p)
		} finally {
			for (const g of guests.splice(0)) await world.drop(g)
		}
	},
}
