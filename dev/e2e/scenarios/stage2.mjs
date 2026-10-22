/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * M1 stage 2 (SPEC-M1 §8.4, Revision 13): sharing, roles, link password and
 * policy in the dialog, LOD 2. The cases change shares, links and instance
 * settings (bridge share-policy, group-member), so they run after E16
 * (scenarios/index.mjs). Every instance setting goes through World.switch()
 * and comes back in World.cleanup(); E27, E28 and E30 clear Nextcloud's
 * ILimiter state first (World.limiterReset(), bridge ratelimit-reset, R13
 * SRV-07), so the flake gate E27–E29 × 8 never runs into 429.
 *
 * E27 sharing: alice turns the edit link on (API), shares the board with bob
 *   in the dialog ("People" tab, search, role "Can view", save); bob opens it
 *   through [data-knorke-filter=shared]: no toolbar, banner view_role, list
 *   row access view. alice raises bob to "Can edit": his toolbar appears
 *   ≤ 3 s without a reload. alice gives the group knorke-e2e the role vote
 *   through the API (PUT with the complete list; "Can vote" is hidden until
 *   stage 3), carol opens the board: role vote, uiMode view, no toolbar,
 *   banner view_role (vote_ready from stage 3, when the root carries
 *   data-knorke-features="voting"), list row vote. alice raises bob to "Can
 *   facilitate": state().mod, list row moderate, the share button appears
 *   without a reload, the dialog shows only "Links" without toggle, rotate,
 *   settings-save and password; link-qr shows the edit link's URL. alice
 *   removes bob's user share: bob keeps vote through the group (no toolbar,
 *   no share button, mod false); alice removes the group share: bob and carol
 *   see the banner gone without the link variant.
 * E28 vote link: alice has the edit link and creates the vote link through
 *   route 17; Gina (hasTouch, isMobile, default tablet viewport) opens
 *   /p/<vote token>. Stage 2 (no data-knorke-features="voting"): the name
 *   dialog has the edit-link form (name required, without "Your votes are
 *   anonymous."), then guest, role vote, uiMode view, no toolbar, banner
 *   view_role. Stage 3 (R13 additions, WP-D3; "voting"): the dialog says
 *   "Your votes are anonymous.", an empty name joins as "Guest"
 *   (state().name, R16), banner vote_ready; alice's dialog has the vote-link
 *   section, its QR code is links.vote.url and "Show to the room" says "Scan
 *   to vote on this board". Both: an object op over the API → denied; in the
 *   section [data-knorke-link=edit] link-qr shows links.edit.url,
 *   link-present opens [data-knorke-dialog=present-link] with "Scan to join
 *   this board", Esc closes it. The two viewport passes (E28@390x844,
 *   E28@820x1180, bars without overlap) live in scenarios/stage3.mjs.
 * E29 link password: alice sets a password on the edit link in the dialog
 *   (question "Everyone who joined through this link will have to enter the
 *   password again." first); a guest who joined before, with the board open
 *   and an open editor, lands without a reload first in the rescue dialog
 *   with the editor text, then in the name dialog with the name prefilled and
 *   the password field, and the right password brings it back; bob (link
 *   member, board open) sees "Your access through the link ended. Open the
 *   link again."; a new guest: wrong password → "Wrong password.", right →
 *   board; bob opens the link again: [data-knorke-dialog=link-password],
 *   wrong → "Wrong password.", right → board (R13).
 * E30 policy in the dialog (R13 sub-cases): password and expiry enforced (7
 *   days): "Create edit link" opens the settings, link-settings-save stays
 *   disabled until the password is there, the expiry is prefilled with today
 *   + 7, the link comes with both; an old link without them shows
 *   [data-knorke-note=link-policy]; an expiry of today + 8 shows
 *   [data-knorke-error=expiry_too_far]; group sharing off: groups are missing
 *   in the search, raising a group share shows
 *   [data-knorke-error=group_sharing_disabled] at its row; sharing off
 *   (shareapi_enabled no, and through the exclusion group with alice in
 *   knorke-e2e): link-rotate shows [data-knorke-error=sharing_disabled]. Each
 *   text is the one of §6.11.
 * E36 LOD 2 in the real app: 3000 notes (bridge seed-board), zoom to 5 %:
 *   scene().lod 2 and exactly one static node; a click selects a note; back to
 *   100 % → lod 0.
 *
 * Check labels start with exactly ONE owner of a red check (SPEC-M1 §9.6;
 * stage2.test.mjs refuses two): [C] dialogs, banners, shell hooks, state(),
 * live role changes in the client; [B] a server answer or stored server state
 * (after the client part passed); [S] canvas, LOD and hit test; [D] a
 * harness precondition (bridge). Nextcloud booleans are compared tolerantly
 * (lib/switches.mjs ncTrue/ncFalse). No page.waitForFunction (Nextcloud's
 * CSP, ENTWICKLUNG trap 9.10).
 */
import {
	K, APP, api, waitReady, until, sleep, openBoard, action, field, itemMap, bannerVisible, CANVAS, put, ulid, seedOps,
} from '../lib/harness.mjs'
import { bridge } from '../lib/bridge.mjs'
import { ncTrue } from '../lib/switches.mjs'

/** Link passwords Nextcloud's password_policy accepts. */
const PW = 'Knorke-E2E-Pw-4711!'
const PW_WRONG = 'Falsch-E2E-Pw-0815?'
/** The harness group of up.sh (bob, carol). */
const HGROUP = 'knorke-e2e'

/** §6.11 texts the cases compare (English source strings, locale en-US). */
const TEXT = {
	sharing_disabled: 'Sharing is turned off for your account.',
	group_sharing_disabled: 'Sharing with groups is turned off.',
	expiry_too_far: 'The expiry date can be at most 7 days away.',
	password_wrong: 'Wrong password.',
	tighten: 'Everyone who joined through this link will have to enter the password again.',
	linkGone: 'Your access through the link ended. Open the link again.',
	anonymous: 'Your votes are anonymous.',
	scanJoin: 'Scan to join this board',
	scanVote: 'Scan to vote on this board',
	guest: 'Guest',
}

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** GET …/shares as alice (owner answer). */
async function sharesOf(board) {
	const r = await api('alice', 'GET', `/api/v1/boards/${board}/shares`)
	if (r.status !== 200) throw new Error(`GET shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data
}

/** "kind:id:role" of a share list, sorted. */
const keysOf = (shares) => (Array.isArray(shares) ? shares.map((s) => `${s.kind}:${s.id}:${s.role}`).sort() : null)
const sameKeys = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Value of the root's data-knorke-features ('' in stage 2, 'voting' from stage 3), or null when absent. */
async function featuresOf(page) {
	return page.locator('[data-knorke-features]').first().getAttribute('data-knorke-features', { timeout: 5000 }).catch(() => null)
}
const voting = (f) => typeof f === 'string' && f.split(/\s+/).includes('voting')

/** Opens the share dialog of the open board (TopBar [data-knorke-action=share]). */
async function openShare(page) {
	await action(page, 'share')
	await page.locator('.knorke-share').first().waitFor({ state: 'visible', timeout: 10000 })
}

/** Closes the share dialog (Esc) and waits until it is gone. */
async function closeShare(page) {
	await page.keyboard.press('Escape')
	await page.locator('.knorke-share').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
}

/** The "People" tab: the search field (or the sharing_disabled note) is there afterwards. */
async function peopleTab(page) {
	await page.locator('.knorke-share [data-knorke-share-tab=people]').first().click()
	await page.locator('.knorke-share [data-knorke-field=sharee-search], .knorke-share [data-knorke-error=sharing_disabled]').first()
		.waitFor({ state: 'visible', timeout: 10000 })
}

/** The input of [data-knorke-field=sharee-search] (on the input or on its select wrapper). */
async function searchInput(page) {
	const f = page.locator('.knorke-share [data-knorke-field=sharee-search]').first()
	await f.waitFor({ state: 'visible', timeout: 10000 })
	const tag = await f.evaluate((el) => el.tagName)
	return tag === 'INPUT' ? f : f.locator('input').first()
}

/** A search option of the dropdown (teleported to <body>): [data-knorke-sharee=<id>] or the option with the name. */
const shareeOption = (page, id, name) => page.locator(`[data-knorke-sharee="${id}"], .vs__dropdown-option:has-text("${name}")`).first()

/**
 * Types `q` into the sharee search and picks the option of `id` (name as the
 * fallback). Returns the answer of the sharee search route.
 */
async function addSharee(page, q, id, name) {
	const input = await searchInput(page)
	await input.click()
	const resp = page.waitForResponse((r) => /\/sharees\?/.test(r.url()), { timeout: 10000 }).catch(() => null)
	await input.fill(q)
	const answer = await resp
	const opt = shareeOption(page, id, name)
	await opt.waitFor({ state: 'visible', timeout: 8000 })
	await opt.click()
	return answer
}

/** Row [data-knorke-share-item=<kind>:<id>] of the "People" tab. */
const shareItem = (page, key) => page.locator(`.knorke-share [data-knorke-share-item="${key}"]`).first()

/** Picks role `role` in the row's role selector ([data-knorke-field=share-role], options [data-knorke-share-role-option]). */
async function setRole(page, key, role) {
	const item = shareItem(page, key)
	await item.waitFor({ state: 'visible', timeout: 10000 })
	const sel = item.locator('[data-knorke-field=share-role]').first()
	const toggle = sel.locator('.vs__dropdown-toggle, [role=combobox], input').first()
	await ((await toggle.count()) ? toggle : sel).click()
	const opt = page.locator(`[data-knorke-share-role-option="${role}"]`).first()
	await opt.waitFor({ state: 'visible', timeout: 5000 })
	await opt.click()
	return until(async () => (await item.getAttribute('data-knorke-share-role')) === role, { timeout: 3000 })
}

/** Clicks share-save; resolves {status, sent, data} of the PUT …/shares it sends (null when none went out). */
async function saveShares(page) {
	const resp = page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/shares$/.test(r.url()) && r.request().method() === 'PUT', { timeout: 10000 }).catch(() => null)
	await page.locator('.knorke-share [data-knorke-action=share-save]').first().click()
	const r = await resp
	if (!r) return null
	let sent = null
	let data = null
	try { sent = JSON.parse(r.request().postData() || 'null') } catch { /* not JSON */ }
	try { data = await r.json() } catch { /* not JSON */ }
	return { status: r.status(), sent, data }
}

/** The board-list row of `board` ([data-knorke-board=<id>]) on a list page: {source, access} or null. */
async function rowOf(page, board) {
	const row = page.locator(`[data-knorke-board="${board}"]`).first()
	if (!(await row.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false))) return null
	const attr = async (name) => (await row.getAttribute(name)) ?? (await row.locator(`[${name}]`).first().getAttribute(name, { timeout: 1000 }).catch(() => null))
	return { source: await attr('data-knorke-board-source'), access: await attr('data-knorke-board-access') }
}

/** Goes to the board list and picks the filter "Shared with me" ([data-knorke-filter=shared]). */
async function sharedList(page) {
	await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	await page.locator('[data-knorke=board-list]').first().waitFor({ state: 'attached', timeout: 15000 })
	const f = page.locator('[data-knorke-filter=shared]').first()
	await f.waitFor({ state: 'visible', timeout: 10000 })
	await f.click()
	return until(async () => (await f.getAttribute('aria-current')) === 'page' || (await f.locator('[aria-current=page]').count()) > 0, { timeout: 3000 })
}

/** Toolbar present? */
const hasToolbar = async (page) => (await page.locator('[data-knorke-toolbar]').count()) > 0
/** Share button visible? */
const shareButton = (page) => page.locator('[data-knorke-action=share]').first().isVisible().catch(() => false)

/** Text of a visible element (trimmed), '' when absent. */
async function textOf(locator) {
	if (!(await locator.isVisible().catch(() => false))) return ''
	return (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}

/** Today as YYYY-MM-DD (UTC; the dev stacks have no default_timezone, the owner zone is UTC, SPEC-M1 §4.11.2) plus n days. */
function dayPlus(n) {
	const d = new Date()
	d.setUTCDate(d.getUTCDate() + n)
	return d.toISOString().slice(0, 10)
}

/** Guest join without a browser (API): {status, data}. */
async function apiGuestJoin(token, name, password = undefined) {
	const body = { client: 'cE2eApi' + Math.random().toString(36).slice(2, 7), name, guest: null }
	if (password !== undefined) body.password = password
	const r = await fetch(`${APP}/pub/v1/${token}/join`, {
		method: 'POST',
		headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify(body),
	})
	let data = null
	try { data = await r.json() } catch { /* not JSON */ }
	return { status: r.status, data, client: body.client }
}

// ── E27 ──────────────────────────────────────────────────────────────────

export const E27 = {
	id: 'E27',
	title: 'Teilen (R13): bob view über den Dialog, „Mit mir geteilt“, live auf edit; Gruppe vote über die API (carol); bob „Can facilitate“ mit Teilen-Knopf und lesendem Reiter Links (QR = Bearbeitungslink); Nutzer-Freigabe weg → vote über die Gruppe; Gruppen-Freigabe weg → gone ohne Link-Variante',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E2E Teilen')
		await linkToken(board)
		const editUrl = (await sharesOf(board)).links?.edit?.url
		t.must(typeof editUrl === 'string' && /\/p\/[A-Za-z0-9]{24}$/.test(editUrl), '[B] Vorbedingung: Bearbeitungslink an (GET shares links.edit.url)', editUrl)
		const a = await world.actor('alice-teilen', { user: 'alice' })
		await openBoard(a, board)

		t.step('alice teilt im Dialog mit bob (Can view)')
		await openShare(a.page)
		t.check(await a.page.locator('.knorke-share [data-knorke-link=edit]').first().isVisible().catch(() => false), '[C] der Dialog öffnet im Reiter „Links“ ([data-knorke-link=edit] sichtbar, R13)')
		await peopleTab(a.page)
		await addSharee(a.page, 'bob', 'bob', 'Bob Berg')
		const fresh = shareItem(a.page, 'user:bob')
		t.check(await fresh.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] Zeile [data-knorke-share-item=user:bob] erscheint')
		t.check((await fresh.getAttribute('data-knorke-share-role').catch(() => null)) === 'edit', '[C] neue Empfänger bekommen edit („Can edit“, R13)', await fresh.getAttribute('data-knorke-share-role').catch(() => null))
		t.check(await setRole(a.page, 'user:bob', 'view'), '[C] Rolle „Can view“ gewählt (data-knorke-share-role=view)')
		let put = await saveShares(a.page)
		t.check(put && sameKeys(keysOf(put.sent?.shares), ['user:bob:view']), '[C] Speichern sendet PUT shares [bob view]', put?.sent)
		t.check(put && put.status === 200 && sameKeys(keysOf((await sharesOf(board)).shares), ['user:bob:view']), '[B] gespeichert: [bob view]', put && { status: put.status, data: put.data })
		await closeShare(a.page)

		t.step('bob öffnet das Board über „Shared with me“')
		const b = await world.actor('bob-teilen', { user: 'bob' })
		t.check(await sharedList(b.page), '[C] Filter [data-knorke-filter=shared] aktiv (aria-current="page")')
		const row = await rowOf(b.page, board)
		t.check(row && row.access === 'view' && row.source === 'share', '[C] Listenzeile: data-knorke-board-access=view, source share', row)
		await b.page.locator(`[data-knorke-board="${board}"]`).first().click()
		await waitReady(b.page, 30000)
		let bs = await K.state(b.page)
		t.check(bs.boardId === board && bs.role === 'view' && bs.uiMode === 'view', '[C] bob im Board: role view, uiMode view', bs)
		t.check(!(await hasToolbar(b.page)), '[C] bob: keine [data-knorke-toolbar]')
		t.check(await until(() => bannerVisible(b.page, 'view_role'), { timeout: 5000 }), '[C] bob: Banner [data-knorke-banner=view_role]')

		t.step('alice hebt bob auf „Can edit“: Werkzeugleiste ≤ 3 s ohne Neuladen')
		await openShare(a.page)
		await peopleTab(a.page)
		t.check(await setRole(a.page, 'user:bob', 'edit'), '[C] Rolle „Can edit“ gewählt')
		const bLoads = []
		b.page.on('load', () => bLoads.push(Date.now()))
		put = await saveShares(a.page)
		t.check(put && put.status === 200 && sameKeys(keysOf(put.data?.shares), ['user:bob:edit']), '[B] PUT [bob edit] → 200', put && { status: put.status, data: put.data })
		const tEdit = await until(() => hasToolbar(b.page), { timeout: 3000 })
		t.check(tEdit, '[C] bob: Werkzeugleiste ≤ 3 s nach dem Speichern', await K.state(b.page).catch(() => null))
		bs = await K.state(b.page)
		t.check(bs.role === 'edit' && bs.uiMode === 'edit' && bLoads.length === 0, '[C] bob: role edit, uiMode edit, ohne Neuladen', { bs, loads: bLoads.length })
		await closeShare(a.page)

		t.step('Gruppe knorke-e2e bekommt vote über die API; carol öffnet das Board')
		const pv = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: [{ kind: 'user', id: 'bob', role: 'edit' }, { kind: 'group', id: HGROUP, role: 'vote' }] })
		t.must(pv.status === 200 && sameKeys(keysOf(pv.data?.shares), [`group:${HGROUP}:vote`, 'user:bob:edit']), '[B] PUT (vollständige Liste) [bob edit, knorke-e2e vote] → 200', pv.text.slice(0, 200))
		const c = await world.actor('carol-teilen', { user: 'carol' })
		await sharedList(c.page)
		const crow = await rowOf(c.page, board)
		t.check(crow && crow.access === 'vote' && crow.source === 'share', '[C] carol: Listenzeile data-knorke-board-access=vote, source share', crow)
		await c.page.locator(`[data-knorke-board="${board}"]`).first().click()
		await waitReady(c.page, 30000)
		const cs = await K.state(c.page)
		t.check(cs.role === 'vote' && cs.uiMode === 'view', '[C] carol: state().role vote, uiMode view', cs)
		t.check(!(await hasToolbar(c.page)), '[C] carol: keine Werkzeugleiste')
		const fc = await featuresOf(c.page)
		const want = voting(fc) ? 'vote_ready' : 'view_role'
		t.check(await until(() => bannerVisible(c.page, want), { timeout: 5000 }), `[C] carol: Banner [data-knorke-banner=${want}] (data-knorke-features="${fc}")`)

		t.step('alice hebt bob auf „Can facilitate“')
		await openShare(a.page)
		await peopleTab(a.page)
		t.check(await setRole(a.page, 'user:bob', 'moderate'), '[C] Rolle „Can facilitate“ gewählt (moderate)')
		put = await saveShares(a.page)
		t.check(put && put.status === 200 && sameKeys(keysOf(put.data?.shares), [`group:${HGROUP}:vote`, 'user:bob:moderate']), '[B] PUT [bob moderate, knorke-e2e vote] → 200', put && { status: put.status, data: put.data })
		await closeShare(a.page)
		t.check(await until(async () => (await K.state(b.page)).mod === true, { timeout: 5000 }), '[C] bob: state().mod === true ohne Neuladen', await K.state(b.page))
		t.check(await until(() => shareButton(b.page), { timeout: 5000 }), '[C] bob: [data-knorke-action=share] erscheint ohne Neuladen (R13)')
		t.check(bLoads.length === 0, '[C] bob: kein Neuladen', bLoads.length)
		const lp = await b.ctx.newPage()
		try {
			await sharedList(lp)
			const mrow = await rowOf(lp, board)
			t.check(mrow && mrow.access === 'moderate', '[C] bob: Listenzeile data-knorke-board-access=moderate', mrow)
		} finally {
			await lp.close().catch(() => {})
		}
		await openShare(b.page)
		t.check((await b.page.locator('.knorke-share [data-knorke-share-tab=people]').count()) === 0, '[C] Moderator: kein Reiter „People“')
		const roOk = await until(async () => (await b.page.locator('.knorke-share [data-knorke-link=edit] [data-knorke-action=link-qr]').count()) > 0, { timeout: 8000 })
		t.check(roOk, '[C] Moderator: Reiter „Links“ mit link-qr im Abschnitt edit')
		for (const hook of ['[data-knorke-action=link-toggle]', '[data-knorke-action=link-rotate]', '[data-knorke-action=link-settings-save]', '[data-knorke-field=link-password]']) {
			t.check((await b.page.locator(`.knorke-share ${hook}`).count()) === 0, `[C] Moderator (nur lesend): kein ${hook}`)
		}
		await b.page.locator('.knorke-share [data-knorke-link=edit] [data-knorke-action=link-qr]').first().click()
		const qr = await until(async () => b.page.locator('.knorke-share [data-knorke-qr-value]').first().getAttribute('data-knorke-qr-value', { timeout: 1000 }).catch(() => null), { timeout: 5000 })
		t.check(qr === editUrl, '[C] nach link-qr: [data-knorke-qr-value] = Bearbeitungslink-URL', { qr, editUrl })
		await closeShare(b.page)

		t.step('alice entfernt bobs Nutzer-Freigabe: bob behält vote über die Gruppe')
		await openShare(a.page)
		await peopleTab(a.page)
		await shareItem(a.page, 'user:bob').locator('[data-knorke-action=share-remove]').first().click()
		put = await saveShares(a.page)
		t.check(put && put.status === 200 && sameKeys(keysOf(put.data?.shares), [`group:${HGROUP}:vote`]), '[B] PUT [knorke-e2e vote] → 200', put && { status: put.status, data: put.data })
		const toVote = await until(async () => {
			const s = await K.state(b.page)
			return s.role === 'vote' && s.mod === false ? s : null
		}, { timeout: 5000 })
		t.check(toVote && toVote.uiMode === 'view', '[C] bob: state().role vote, mod false, uiMode view', toVote || await K.state(b.page))
		t.check(await until(async () => !(await shareButton(b.page)), { timeout: 5000 }), '[C] bob: Teilen-Knopf weg')
		t.check(!(await hasToolbar(b.page)), '[C] bob: keine Werkzeugleiste')

		t.step('alice entfernt die Gruppen-Freigabe: bob und carol gone (ohne Link-Variante)')
		await shareItem(a.page, `group:${HGROUP}`).locator('[data-knorke-action=share-remove]').first().click()
		put = await saveShares(a.page)
		t.check(put && put.status === 200 && sameKeys(keysOf(put.data?.shares), []), '[B] PUT [] → 200', put && { status: put.status, data: put.data })
		await closeShare(a.page)
		for (const [who, p] of [['bob', b.page], ['carol', c.page]]) {
			const gone = await until(() => bannerVisible(p, 'gone'), { timeout: 8000 })
			t.check(gone, `[C] ${who}: Banner [data-knorke-banner=gone]`, await K.state(p).catch(() => null))
			const txt = await textOf(p.locator('[data-knorke-banner=gone]').first())
			t.check(gone && !txt.includes(TEXT.linkGone), `[C] ${who}: ohne Link-Variante (source share)`, txt)
		}
		for (const x of [a, b, c]) await world.drop(x)
	},
}

// ── E28 ──────────────────────────────────────────────────────────────────

export const E28 = {
	id: 'E28',
	title: 'Abstimm-Link (R13/R16): Gina (Touch) über den Abstimm-Link – Stufe 2: Namensdialog wie beim Bearbeitungslink, view_role; ab Stufe 3: „Your votes are anonymous.“, leerer Name → Guest, vote_ready, Abstimm-Abschnitt mit QR-Code und „Scan to vote on this board“; Objekt-Op denied; QR-Code und „Dem Raum zeigen“ des Bearbeitungslinks',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E2E Abstimm-Link')
		await linkToken(board)
		const vl = await api('alice', 'POST', `/api/v1/boards/${board}/votelink`, {})
		t.must(vl.status === 200 && /^[A-Za-z0-9]{24}$/.test(vl.data?.link?.token || '') && vl.data.link.role === 'vote', '[B] Abstimm-Link über Route 17 → 200, role vote', vl.text.slice(0, 200))
		const LV = vl.data.link.token
		const editUrl = (await sharesOf(board)).links?.edit?.url

		t.step('Gina (Touch, Standard-Viewport) öffnet den Abstimm-Link')
		const g = await world.actor('gina-abstimmen', { touch: true })
		await g.page.goto(`${APP}/p/${LV}`, { waitUntil: 'domcontentloaded' })
		const dlg = g.page.locator('[data-knorke-dialog=guest-name], .knorke-dialog').filter({ has: g.page.locator('[data-knorke-field=guest-name]') }).first()
		await dlg.waitFor({ state: 'visible', timeout: 15000 })
		const f = await featuresOf(g.page)
		t.check(f !== null, '[C] Wurzel der Gastseite trägt data-knorke-features (R13)', f)
		const stage3 = voting(f)
		if (stage3) t.note('data-knorke-features="voting": Stufe-3-Zusätze (R13/R16); die Viewport-Durchgänge sind E28@390x844 und E28@820x1180')
		const dtext = await textOf(dlg)
		const join = g.page.locator('[data-knorke-action=guest-join]').first()
		if (!stage3) {
			t.check(!dtext.includes(TEXT.anonymous), '[C] Namensdialog in der Form des Bearbeitungslinks: ohne „Your votes are anonymous.“', dtext)
			await field(g.page, 'guest-name', '')
			t.check(await join.isDisabled().catch(() => false), '[C] Name ist Pflicht: „Join“ gesperrt bei leerem Namen')
			await field(g.page, 'guest-name', 'Gina')
		} else {
			t.check(dtext.includes(TEXT.anonymous), '[C] Stufe 3: Namensdialog des Abstimm-Links mit „Your votes are anonymous.“', dtext)
			await field(g.page, 'guest-name', '')
			t.check(!(await join.isDisabled().catch(() => true)), '[C] Stufe 3: Name optional – „Join“ bei leerem Namen frei')
		}
		await action(g.page, 'guest-join')
		await waitReady(g.page, 30000)
		const gs = await K.state(g.page)
		t.check(gs.mode === 'guest' && gs.role === 'vote' && gs.uiMode === 'view' && gs.boardId === board, '[C] Gina: mode guest, role vote, uiMode view', gs)
		t.check(!(await hasToolbar(g.page)), '[C] Gina: keine Werkzeugleiste')
		if (!stage3) t.check(await until(() => bannerVisible(g.page, 'view_role'), { timeout: 5000 }), '[C] Gina: Banner [data-knorke-banner=view_role]')
		else {
			t.check(gs.name === TEXT.guest, '[C] Stufe 3: leerer Name → state().name „Guest“ (R16)', gs)
			t.check(await until(() => bannerVisible(g.page, 'vote_ready'), { timeout: 5000 }), '[C] Stufe 3: Banner [data-knorke-banner=vote_ready]')
		}

		t.step('eine Objekt-Op über die API mit einem Abstimm-Gast → denied')
		const j = await apiGuestJoin(LV, 'Api-Gast')
		t.must(j.status === 200 && typeof j.data?.guest?.token === 'string', '[B] Gast-Beitritt über den Abstimm-Link (API) → 200', j)
		const r = await fetch(`${APP}/pub/v1/boards/${board}/sync`, {
			method: 'POST',
			headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', Accept: 'application/json', 'X-Knorke-Guest': j.data.guest.token },
			body: JSON.stringify({ proto: 2, client: j.client, since: j.data.rev ?? 0, ep: j.data.epoch, pres: 0, seq: 1, ops: [put.sticky(ulid())] }),
		})
		const rd = await r.json().catch(() => null)
		t.check(r.status === 200 && JSON.stringify(rd?.acks?.res) === '["denied"]', '[B] Abstimm-Gast: put → denied', rd)

		t.step('alice: QR-Code und „Dem Raum zeigen“ des Bearbeitungslinks')
		const a = await world.actor('alice-abstimmen', { user: 'alice' })
		await openBoard(a, board)
		await openShare(a.page)
		if (!stage3) t.check((await a.page.locator('.knorke-share [data-knorke-link=vote]').count()) === 0, '[C] ohne FEATURES.voting: kein Abschnitt [data-knorke-link=vote]')
		else {
			const voteUrl = (await sharesOf(board)).links?.vote?.url
			const vsec = a.page.locator('.knorke-share [data-knorke-link=vote]').first()
			t.check(await vsec.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] Stufe 3: Abschnitt [data-knorke-link=vote] im Dialog')
			await vsec.locator('[data-knorke-action=link-qr]').first().click()
			const vqr = await until(async () => vsec.locator('[data-knorke-qr-value]').first().getAttribute('data-knorke-qr-value', { timeout: 1000 }).catch(() => null), { timeout: 5000 })
			t.check(typeof voteUrl === 'string' && vqr === voteUrl, '[C] Stufe 3: QR-Code des Abstimm-Links = links.vote.url', { vqr, voteUrl })
			await vsec.locator('[data-knorke-action=link-present]').first().click()
			const vpres = a.page.locator('[data-knorke-dialog=present-link]').first()
			t.check(await vpres.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] Stufe 3: „Dem Raum zeigen“ des Abstimm-Links offen')
			const vtxt = await textOf(vpres)
			t.check(vtxt.includes(TEXT.scanVote) && typeof voteUrl === 'string' && vtxt.includes(voteUrl.slice(-24)), '[C] Stufe 3: „Scan to vote on this board“ und die URL (mit dem Token)', vtxt.slice(0, 300))
			await a.page.keyboard.press('Escape')
			t.check(await vpres.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false), '[C] Esc schließt „Dem Raum zeigen“')
		}
		const sec = a.page.locator('.knorke-share [data-knorke-link=edit]').first()
		await sec.locator('[data-knorke-action=link-qr]').first().click()
		const qr = await until(async () => sec.locator('[data-knorke-qr-value]').first().getAttribute('data-knorke-qr-value', { timeout: 1000 }).catch(() => null), { timeout: 5000 })
		t.check(qr === editUrl, '[C] [data-knorke-qr-value] = links.edit.url', { qr, editUrl })
		t.check(await sec.locator('[data-knorke-qr-value] path, svg[data-knorke-qr-value] path').count() > 0, '[C] QR-Code als <svg> mit Pfaden')
		await sec.locator('[data-knorke-action=link-present]').first().click()
		const pres = a.page.locator('[data-knorke-dialog=present-link]').first()
		t.check(await pres.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] [data-knorke-dialog=present-link] offen')
		const ptxt = await textOf(pres)
		t.check(ptxt.includes(TEXT.scanJoin) && ptxt.includes(editUrl.slice(-24)), '[C] „Scan to join this board“ und die URL (mit dem Token)', ptxt.slice(0, 300))
		await a.page.keyboard.press('Escape')
		t.check(await pres.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false), '[C] Esc schließt „Dem Raum zeigen“')
		for (const x of [g, a]) await world.drop(x)
	},
}

// ── E29 ──────────────────────────────────────────────────────────────────

/** Fills a password field ([data-knorke-field=<name>], input or wrapper). */
async function fillPassword(page, name, value) {
	const f = page.locator(`[data-knorke-field=${name}]`).first()
	await f.waitFor({ state: 'visible', timeout: 10000 })
	const tag = await f.evaluate((el) => el.tagName)
	const input = tag === 'INPUT' ? f : f.locator('input').first()
	await input.fill(value)
	return input
}

export const E29 = {
	id: 'E29',
	title: 'Link-Passwort (R2/R13): Rückfrage vor dem Setzen; offener Gast-Tab mit offenem Editor → Textrettung, dann Passwort-Dialog mit Namen, richtig → Board; bob „Your access through the link ended“; neuer Gast falsch/richtig; bob öffnet den Link erneut: Passwort-Dialog, falsch/richtig',
	async run(t, world) {
		const board = await world.board('E2E Link-Passwort')
		const L = await linkToken(board)
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, data: { text: 'Notiz' } })])
		t.must(res[0] === 'ok', '[B] Vorbedingung: eine Notiz', res)

		t.step('Gast Gina tritt bei und öffnet einen Editor; bob tritt über den Link bei')
		const g = await world.actor('gina-passwort')
		const gLoads = []
		await g.page.goto(`${APP}/p/${L}`, { waitUntil: 'domcontentloaded' })
		await field(g.page, 'guest-name', 'Gina')
		await action(g.page, 'guest-join')
		await waitReady(g.page, 30000)
		g.page.on('load', () => gLoads.push(Date.now()))
		const c = await K.rect(g.page, N)
		await g.page.mouse.dblclick(c.x + c.w / 2, c.y + c.h / 2)
		const ed = g.page.locator('textarea[data-knorke-editor]').first()
		await ed.waitFor({ state: 'visible', timeout: 5000 })
		await g.page.keyboard.press('Control+A')
		await g.page.keyboard.type('Rettungstext E29', { delay: 5 })
		const b = await world.actor('bob-passwort', { user: 'bob' })
		await b.page.goto(`${APP}/p/${L}`, { waitUntil: 'domcontentloaded' })
		await waitReady(b.page, 30000)
		t.check((await K.state(b.page)).boardId === board, '[C] bob im Board über den Link')

		const edOpen = await ed.isVisible().catch(() => false)
		const onServer = (await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)).data?.items?.find((x) => x.id === N)?.data?.text
		t.note(`vor dem Passwort: Editor des Gastes offen ${edOpen}, Text beim Server ${JSON.stringify(onServer)} (die Textrettung nimmt laut §4.2/§6.4 den Text des offenen Editors)`)
		t.step('alice setzt ein Passwort im Dialog (Rückfrage)')
		const a = await world.actor('alice-passwort', { user: 'alice' })
		await openBoard(a, board)
		await openShare(a.page)
		const sec = a.page.locator('.knorke-share [data-knorke-link=edit]').first()
		await sec.waitFor({ state: 'visible', timeout: 10000 })
		await fillPassword(a.page, 'link-password', PW)
		await sec.locator('[data-knorke-action=link-settings-save]').first().click()
		const ask = a.page.locator('.knorke-dialog, [role=dialog]').filter({ hasText: TEXT.tighten }).first()
		t.check(await ask.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), `[C] Rückfrage vor dem Speichern: „${TEXT.tighten}“`)
		const resp = a.page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/link$/.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null)
		await ask.locator('[data-knorke-action=confirm]').first().click()
		const pr = await resp
		const prData = pr ? await pr.json().catch(() => null) : null
		t.check(pr && pr.status() === 200 && prData?.link?.password === true && prData.link.token === L, '[B] POST link {password} → 200, password true, Token bleibt', prData)
		await closeShare(a.page)

		t.step('der offene Gast-Tab: Textrettung, dann Name + Passwort')
		const rescue = g.page.locator('[data-knorke-dialog=rescue]').first()
		const rs = await rescue.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
		t.check(rs, '[C] Gast: erst [data-knorke-dialog=rescue]', await K.state(g.page).catch(() => null))
		const rtext = rs ? await rescue.locator('textarea').evaluateAll((els) => els.map((e) => e.value).join('\n')).catch(() => '') : ''
		t.check(rtext.includes('Rettungstext E29'), '[C] der Editor-Text steht in der Textrettung', rtext)
		if (rs) await rescue.locator('[data-knorke-action=confirm]').first().click().catch(() => {})
		const pwField = g.page.locator('[data-knorke-field=guest-password]').first()
		t.check(await pwField.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false), '[C] danach Namensdialog mit [data-knorke-field=guest-password]')
		const nameVal = await g.page.locator('[data-knorke-field=guest-name]').first().evaluate((el) => (el.tagName === 'INPUT' ? el : el.querySelector('input'))?.value ?? '').catch(() => '')
		t.check(nameVal === 'Gina', '[C] Name vorausgefüllt (Gina)', nameVal)
		t.check(gLoads.length === 0, '[C] ohne Neuladen', gLoads.length)
		await fillPassword(g.page, 'guest-password', PW)
		await action(g.page, 'guest-join')
		await waitReady(g.page, 30000)
		const gs = await K.state(g.page)
		t.check(gs.boardId === board && gs.status === 'online' && gs.mode === 'guest', '[C] richtiges Passwort: wieder im Board', gs)

		t.step('bob (Link-Mitglied): „Your access through the link ended.“')
		const bgone = await until(() => bannerVisible(b.page, 'gone'), { timeout: 10000 })
		const btxt = await textOf(b.page.locator('[data-knorke-banner=gone]').first())
		t.check(bgone && btxt.includes(TEXT.linkGone), `[C] bob: Banner gone mit „${TEXT.linkGone}“`, btxt)

		t.step('neuer Gast: falsch → „Wrong password.“, richtig → Board')
		const n = await world.actor('nora-passwort')
		await n.page.goto(`${APP}/p/${L}`, { waitUntil: 'domcontentloaded' })
		await n.page.locator('[data-knorke-field=guest-password]').first().waitFor({ state: 'visible', timeout: 15000 })
		await field(n.page, 'guest-name', 'Nora')
		await fillPassword(n.page, 'guest-password', PW_WRONG)
		await action(n.page, 'guest-join')
		const wrong = n.page.locator('[data-knorke-error=password_wrong]').first()
		t.check(await wrong.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false) && (await textOf(wrong)).includes(TEXT.password_wrong), '[C] falsches Passwort: [data-knorke-error=password_wrong] „Wrong password.“', await textOf(wrong))
		await fillPassword(n.page, 'guest-password', PW)
		await action(n.page, 'guest-join')
		await waitReady(n.page, 30000)
		t.check((await K.state(n.page)).boardId === board, '[C] richtiges Passwort: Nora im Board')

		t.step('bob öffnet den Link erneut: Passwort-Dialog (R13)')
		await b.page.goto(`${APP}/p/${L}`, { waitUntil: 'domcontentloaded' })
		const pd = b.page.locator('[data-knorke-dialog=link-password]').first()
		t.check(await pd.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false), '[C] bob: [data-knorke-dialog=link-password]', b.page.url())
		const submit = async (pw) => {
			await fillPassword(b.page, 'link-join-password', pw)
			const jr = b.page.waitForResponse((r) => /\/api\/v1\/links\/[A-Za-z0-9]{24}\/join$/.test(r.url()), { timeout: 8000 }).catch(() => null)
			const btn = pd.locator('[data-knorke-action=link-join], [data-knorke-action=confirm], button[type=submit]').first()
			if (await btn.isVisible().catch(() => false)) await btn.click()
			else await b.page.keyboard.press('Enter')
			return jr
		}
		let jr = await submit(PW_WRONG)
		t.check(jr && jr.status() === 403, '[B] Konto-Beitritt mit falschem Passwort → 403', jr && jr.status())
		const bw = b.page.locator('[data-knorke-dialog=link-password] [data-knorke-error=password_wrong], [data-knorke-dialog=link-password] [role=alert]').first()
		t.check(await bw.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false) && (await textOf(bw)).includes(TEXT.password_wrong), '[C] bob: „Wrong password.“', await textOf(bw))
		jr = await submit(PW)
		t.check(jr && jr.status() === 200, '[B] Konto-Beitritt mit richtigem Passwort → 200', jr && jr.status())
		await waitReady(b.page, 30000)
		t.check((await K.state(b.page)).boardId === board, '[C] bob wieder im Board')

		t.step('Schluss (R14-05): Brücke link-expire – Gast-Tab link_expired, Neuladen expired, bob gone')
		const tExp = Date.now()
		const le = await bridge('link-expire', board, 'edit')
		t.check(le && Number.isInteger(le.link?.id), '[D] Brücke link-expire edit: Link abgelaufen gesetzt', le)
		const gExp = await until(() => bannerVisible(g.page, 'link_expired'), { timeout: 15000, every: 100 })
		t.check(gExp, '[C] Gast-Tab: [data-knorke-banner=link_expired]', Date.now() - tExp)
		t.check((await K.state(g.page)).status === 'link_expired', '[C] Gast-Tab: state().status === link_expired', await K.state(g.page).catch(() => null))
		const bExp = await until(() => bannerVisible(b.page, 'gone'), { timeout: 15000, every: 100 })
		const bExpTxt = await textOf(b.page.locator('[data-knorke-banner=gone]').first())
		t.check(bExp && bExpTxt.includes(TEXT.linkGone), `[C] bob: Banner gone mit „${TEXT.linkGone}“`, bExpTxt)
		const tq = Date.now()
		const gc0 = await K.counters(g.page)
		await sleep(5000)
		const gc1 = await K.counters(g.page)
		const syncs = g.requestsSince(tq, /\/sync$/)
		t.check(gc1.syncRequests === gc0.syncRequests && syncs.length === 0, '[C] Gast-Tab: danach 5 s kein /sync (endgültiger Status, wie M0-E09)', { gc0, gc1, syncs: syncs.length })
		await g.page.goto(`${APP}/p/${L}`, { waitUntil: 'domcontentloaded' })
		t.check(await until(() => bannerVisible(g.page, 'expired'), { timeout: 10000 }), '[C] Neuladen von /p/<token>: [data-knorke-banner=expired]')
		for (const x of [g, b, a, n]) await world.drop(x)
	},
}

// ── E30 ──────────────────────────────────────────────────────────────────

/** The link-expiry input of a link section (type=date). */
async function expiryInput(section) {
	const f = section.locator('[data-knorke-field=link-expiry]').first()
	await f.waitFor({ state: 'visible', timeout: 8000 })
	const tag = await f.evaluate((el) => el.tagName)
	return tag === 'INPUT' ? f : f.locator('input').first()
}

export const E30 = {
	id: 'E30',
	title: 'Richtlinie im Dialog (R13): Passwort und Ablauf erzwungen → Einstellungen zuerst, Speichern gesperrt bis zum Passwort, Ablauf vorbelegt; alter Link mit Hinweis link-policy; Ablauf zu weit → expiry_too_far; Gruppenfreigabe aus → keine Gruppen in der Suche, Hochstufen → group_sharing_disabled an der Zeile; Teilen gesperrt (shareapi_enabled, Ausschlussgruppe) → sharing_disabled',
	async run(t, world) {
		await world.limiterReset()
		const bOld = await world.board('E2E Richtlinie alt')
		await linkToken(bOld)
		const bNew = await world.board('E2E Richtlinie neu')
		const bGrp = await world.board('E2E Richtlinie Gruppe')
		const pg = await api('alice', 'PUT', `/api/v1/boards/${bGrp}/shares`, { shares: [{ kind: 'group', id: HGROUP, role: 'view' }] })
		t.must(pg.status === 200, '[B] Vorbedingung: Gruppen-Freigabe view (Gruppenfreigabe erlaubt)', pg.text.slice(0, 200))
		const bRot = await world.board('E2E Richtlinie gesperrt')
		await linkToken(bRot)
		const a = await world.actor('alice-richtlinie2', { user: 'alice' })

		t.step('Brücke: Passwort und Ablauf (7 Tage) erzwungen')
		for (const [k, v] of [['shareapi_enforce_links_password', 'yes'], ['shareapi_default_expire_date', 'yes'], ['shareapi_enforce_expire_date', 'yes'], ['shareapi_expire_after_n_days', '7']]) {
			const r = await world.switch('share-policy', k, v)
			t.must(v === '7' ? r.stored === '7' : ncTrue(r.stored), `[D] share-policy ${k} ${v} (gespeichert, tolerant)`, r)
		}
		const pol = (await sharesOf(bNew)).linkPolicy
		t.check(pol?.passwordEnforced === true && pol?.expireEnforced === true && pol?.expireDefaultDays === 7 && pol?.expireMaxDays === 7, '[B] linkPolicy {passwordEnforced, expireEnforced, 7, 7}', pol)

		t.step('Link anlegen verlangt beide Felder')
		await openBoard(a, bNew)
		await openShare(a.page)
		const sNew = a.page.locator('.knorke-share [data-knorke-link=edit]').first()
		await sNew.locator('[data-knorke-action=link-toggle]').first().click()
		const save = sNew.locator('[data-knorke-action=link-settings-save]').first()
		t.check(await save.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] link-toggle öffnet die Einstellungen (kein Link angelegt)')
		t.check((await sNew.locator('[data-knorke-field=link-url]').count()) === 0, '[C] noch kein Link (kein link-url)')
		const pwIn = sNew.locator('[data-knorke-field=link-password]').first()
		const pwVal = await pwIn.evaluate((el) => (el.tagName === 'INPUT' ? el : el.querySelector('input'))?.value ?? null).catch(() => null)
		t.check(pwVal === '', '[C] link-password leer', pwVal)
		const exIn = await expiryInput(sNew)
		const exVal = await exIn.inputValue().catch(() => null)
		t.check(exVal === dayPlus(7), `[C] link-expiry vorbelegt mit heute + 7 (${dayPlus(7)})`, exVal)
		t.check(await save.isDisabled(), '[C] link-settings-save gesperrt, solange das Passwort fehlt')
		await fillPassword(a.page, 'link-password', PW)
		t.check(await until(async () => !(await save.isDisabled()), { timeout: 3000 }), '[C] mit Passwort: link-settings-save frei')
		const cr = a.page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/link$/.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null)
		await save.click()
		const crr = await cr
		const crBody = crr ? JSON.parse(crr.request().postData() || 'null') : null
		const crData = crr ? await crr.json().catch(() => null) : null
		t.check(crBody && crBody.password === PW && crBody.expiresAt === dayPlus(7), '[C] POST {password, expiresAt: "YYYY-MM-DD"}', crBody && { ...crBody, password: crBody.password ? '***' : crBody.password })
		t.check(crr && crr.status() === 200 && crData?.link?.password === true && crData.link.expiresOn === dayPlus(7), '[B] Link mit Passwort und Ablauf heute + 7', crData)
		await closeShare(a.page)

		t.step('alter Link ohne Passwort/Ablauf: Hinweis; Ablauf zu weit')
		await openBoard(a, bOld)
		await openShare(a.page)
		const sOld = a.page.locator('.knorke-share [data-knorke-link=edit]').first()
		const note = sOld.locator('[data-knorke-note=link-policy]').first()
		t.check(await note.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false), '[C] alter Link: [data-knorke-note=link-policy] „This link does not meet the current sharing policy.“', await textOf(note))
		const exOld = await expiryInput(sOld)
		await exOld.fill(dayPlus(8))
		await exOld.dispatchEvent('change').catch(() => {})
		await fillPassword(a.page, 'link-password', PW)
		const saveOld = sOld.locator('[data-knorke-action=link-settings-save]').first()
		if (!(await saveOld.isDisabled().catch(() => true))) {
			await saveOld.click()
			const ask = a.page.locator('[data-knorke-dialog=link-confirm], .knorke-dialog, [role=dialog]').filter({ hasText: TEXT.tighten }).first()
			if (await ask.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await ask.locator('[data-knorke-action=confirm]').first().click()
		}
		const tooFar = a.page.locator('[data-knorke-error=expiry_too_far]').first()
		t.check(await tooFar.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false) && (await textOf(tooFar)).includes(TEXT.expiry_too_far),
			`[C] Ablauf heute + 8: [data-knorke-error=expiry_too_far] „${TEXT.expiry_too_far}“`, await textOf(tooFar))
		await closeShare(a.page)
		for (const k of ['shareapi_enforce_links_password', 'shareapi_default_expire_date', 'shareapi_enforce_expire_date', 'shareapi_expire_after_n_days']) await world.switch('share-policy', k, 'default')

		t.step('Gruppenfreigabe aus: keine Gruppen in der Suche, Hochstufen → group_sharing_disabled an der Zeile')
		const gs = await world.switch('share-policy', 'shareapi_allow_group_sharing', 'no')
		t.must(gs.stored !== null && !ncTrue(gs.stored), '[D] share-policy shareapi_allow_group_sharing no', gs)
		await openBoard(a, bGrp)
		await openShare(a.page)
		await peopleTab(a.page)
		const input = await searchInput(a.page)
		await input.click()
		const sr = a.page.waitForResponse((r) => /\/sharees\?/.test(r.url()), { timeout: 10000 }).catch(() => null)
		await input.fill('knorke')
		const srr = await sr
		const srData = srr ? await srr.json().catch(() => null) : null
		t.check(srr && srr.status() === 200 && !(srData?.sharees || []).some((x) => x.kind === 'group'), '[B] Suche „knorke“ ohne Gruppen', srData)
		await sleep(500)
		t.check((await a.page.locator(`[data-knorke-sharee="${HGROUP}"]:visible`).count()) === 0, '[C] keine Gruppen-Option in der Suche')
		await input.fill('')
		await a.page.keyboard.press('Escape').catch(() => {})
		if (!(await a.page.locator('.knorke-share').first().isVisible().catch(() => false))) {
			await openShare(a.page)
			await peopleTab(a.page)
		}
		t.check(await setRole(a.page, `group:${HGROUP}`, 'edit'), '[C] Gruppe auf „Can edit“ gehoben')
		const pr = await saveShares(a.page)
		t.check(pr && pr.status === 400 && pr.data?.error === 'group_sharing_disabled' && pr.data?.at === 0, '[B] PUT → 400 group_sharing_disabled, at 0', pr && { status: pr.status, data: pr.data })
		const rowErr = shareItem(a.page, `group:${HGROUP}`).locator('[data-knorke-error=group_sharing_disabled]').first()
		t.check(await rowErr.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false) && (await textOf(rowErr)).includes(TEXT.group_sharing_disabled),
			`[C] an der Zeile: [data-knorke-error=group_sharing_disabled] „${TEXT.group_sharing_disabled}“`, await textOf(rowErr))
		await closeShare(a.page)
		await world.switch('share-policy', 'shareapi_allow_group_sharing', 'default')

		const rotateBlocked = async (label) => {
			await openBoard(a, bRot)
			await openShare(a.page)
			const sec = a.page.locator('.knorke-share [data-knorke-link=edit]').first()
			await sec.locator('[data-knorke-action=link-rotate]').first().click()
			const ask = a.page.locator('[data-knorke-dialog=link-confirm], .knorke-dialog, [role=dialog]').filter({ has: a.page.locator('[data-knorke-action=confirm]') }).last()
			const rr = a.page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/link$/.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null)
			if (await ask.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) await ask.locator('[data-knorke-action=confirm]').first().click()
			const resp = await rr
			const data = resp ? await resp.json().catch(() => null) : null
			t.check(resp && resp.status() === 403 && data?.error === 'sharing_disabled', `[B] ${label}: link-rotate → 403 sharing_disabled`, data)
			const err = a.page.locator('[data-knorke-error=sharing_disabled]:visible').first()
			t.check(await err.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false) && (await textOf(err)).includes(TEXT.sharing_disabled),
				`[C] ${label}: [data-knorke-error=sharing_disabled] „${TEXT.sharing_disabled}“`, await textOf(err))
			if (await a.page.locator('.knorke-share').first().isVisible().catch(() => false)) {
				await peopleTab(a.page).catch(() => {})
				const pnote = a.page.locator('.knorke-share [data-knorke-error=sharing_disabled]').first()
				t.check(await pnote.isVisible().catch(() => false) && (await a.page.locator('.knorke-share [data-knorke-field=sharee-search]').count()) === 0,
					`[C] ${label}: „People“ zeigt den Hinweis statt der Suche (R13)`)
				await closeShare(a.page)
			}
		}

		t.step('Teilen gesperrt (shareapi_enabled no): link-rotate → sharing_disabled')
		await world.switch('share-policy', 'shareapi_enabled', 'no')
		await rotateBlocked('Teilen gesperrt')
		await world.switch('share-policy', 'shareapi_enabled', 'default')

		t.step('Teilen gesperrt über die Ausschlussgruppe (alice in knorke-e2e)')
		await world.switch('share-policy', 'shareapi_exclude_groups', 'yes')
		await world.switch('share-policy', 'shareapi_exclude_groups_list', HGROUP)
		const gm = await world.switch('group-member', 'add', 'alice', HGROUP)
		t.must(Array.isArray(gm.members) && gm.members.includes('alice'), '[D] alice in knorke-e2e (Brücke group-member)', gm)
		await rotateBlocked('Ausschlussgruppe')
		await world.switch('group-member', 'remove', 'alice', HGROUP)
		await world.switch('share-policy', 'shareapi_exclude_groups', 'default')
		await world.switch('share-policy', 'shareapi_exclude_groups_list', 'default')
		await world.drop(a)
	},
}

// ── E36 ──────────────────────────────────────────────────────────────────

export const E36 = {
	id: 'E36',
	title: 'LOD 2 in der echten App: 3000 Notizen (seed-board), Zoom auf 5 % → lod 2, genau ein statischer Knoten, Auswahl per Klick; zurück auf 100 % → lod 0',
	async run(t, world) {
		const board = await world.board('E2E LOD 2')
		const seeded = await bridge('seed-board', board, 3000)
		t.must(seeded.created === 3000 && seeded.items === 3000, '[D] seed-board: 3000 Notizen (Brücke)', seeded)
		const a = await world.actor('alice-lod', { user: 'alice' })
		await openBoard(a, board)
		const p = a.page
		t.must((await itemMap(p)).size === 3000, '[C] 3000 Objekte im Client', (await itemMap(p)).size)
		await p.locator(CANVAS).first().focus()
		await p.keyboard.press('Shift+Digit1')
		for (let i = 0; i < 8; i++) {
			const cam = await K.camera(p)
			if (cam && cam.scale <= 0.0501) break
			await p.keyboard.press('Minus')
			await sleep(150)
		}
		const cam = await K.camera(p)
		t.check(cam && Math.abs(cam.scale - 0.05) < 0.001, '[S] Kamera bei 5 % (MIN_SCALE)', cam)
		const sc = await until(async () => {
			const s = await K.scene(p)
			return s && s.lod === 2 ? s : null
		}, { timeout: 5000 })
		t.check(sc && sc.lod === 2, '[S] scene().lod === 2', sc || await K.scene(p))
		t.check(sc && sc.staticChildren === 1, '[S] scene().staticChildren === 1 (genau ein statischer Knoten, G14)', sc)

		t.step('Auswahl per Klick bei 5 % (auf eine Notiz oder Form, nie auf einen Verbinder)')
		const box = await p.locator(CANVAS).first().boundingBox()
		const items = await itemMap(p)
		// LOD-2 rule (c), SPEC-M1 §6.3 (R13): click and marquee skip connectors at
		// LOD 2, so a click on a connector line selects nothing by design. The
		// target is therefore a note or a shape (seed-board makes notes only).
		const CLICK_TYPES = new Set(['sticky', 'shape'])
		t.note(`Objektarten: ${[...new Set([...items.values()].map((it) => it.t))].join(', ')}`)
		let target = null
		for (const [id, it] of items) {
			if (!CLICK_TYPES.has(it.t)) continue
			const r = await K.rect(p, id)
			if (r && r.w >= 6 && r.x > box.x + 40 && r.y > box.y + 40 && r.x + r.w < box.x + box.width - 40 && r.y + r.h < box.y + box.height - 40) { target = { id, r }; break }
		}
		t.must(target, '[S] eine Notiz liegt sichtbar in der Leinwand', box)
		await p.mouse.click(target.r.x + target.r.w / 2, target.r.y + target.r.h / 2)
		const sel = await until(async () => {
			const s = await K.selection(p)
			return Array.isArray(s) && s.includes(target.id) ? s : null
		}, { timeout: 3000 })
		t.check(sel && sel.length === 1, '[S] Klick wählt genau diese Notiz aus', { sel, want: target.id })
		const sc2 = await K.scene(p)
		t.check(sc2?.lod === 2 && sc2?.staticChildren === 1, '[S] mit Auswahl weiter lod 2, ein statischer Knoten', sc2)

		t.step('zurück auf 100 %')
		await p.locator(CANVAS).first().focus()
		await p.keyboard.press('Shift+Digit0')
		const back = await until(async () => {
			const s = await K.scene(p)
			return s && s.lod === 0 ? s : null
		}, { timeout: 5000 })
		t.check(back && back.lod === 0, '[S] 100 %: scene().lod === 0', back || await K.scene(p))
		const cam2 = await K.camera(p)
		t.check(cam2 && Math.abs(cam2.scale - 1) < 0.001, '[S] Kamera bei 100 %', cam2)
		await world.drop(a)
	},
}
