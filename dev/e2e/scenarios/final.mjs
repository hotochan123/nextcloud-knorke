/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Board page after a final status on opening (factory job 049). Own boards,
 * no instance setting: directly after E44, before E09.
 *
 * E45 (1) alice's board A with an edit link; bob joins it through the API
 *   (POST /api/v1/links/<token>/join) and opens his board list: row A with
 *   the origin link. alice renews the link (bob's snapshot: 404). bob clicks
 *   row A in his list that was not reloaded: the banner gone with "Your
 *   access through the link ended. Open the link again.", the empty state
 *   [data-knorke-empty=board-final] "Could not open the board", no spinner
 *   (3 s later neither), no title of A. Keyboard: from the TopBar's back
 *   arrow at most 5 Tab presses to [data-knorke-action=back-to-list], Enter
 *   opens the list, which no longer has row A.
 * (2) bookmark: bob goes to /b/A directly (a full page load, the list of the
 *   tab is empty): "This board is no longer available.", the empty state,
 *   no spinner; a click on the button opens the list.
 * (3) alice at 390 × 844 with touch has her board B in the list; B is deleted
 *   through the API ("from another device", no page has a session on B,
 *   trap 9.11); a tap on row B: the general text (origin own), the empty
 *   state, no spinner, the button inside the viewport; a tap on it opens the
 *   list without B.
 *
 * Only DOM checks: after a failed open there is no window.__knorke. Check
 * labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell, [B] server,
 * [D] a harness precondition. Waiting polls from Node with until()
 * (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { APP, PHONE, api, until, sleep } from '../lib/harness.mjs'

const LINK_TEXT = 'Your access through the link ended. Open the link again.'
const GONE_TEXT = 'This board is no longer available.'
const EMPTY = '[data-knorke-empty=board-final]'
const BACK = '[data-knorke-action=back-to-list]'
const SPINNER = '.knorke-board__loading'
const LIST = '[data-knorke=board-list]'

/** The edit link of a board (route 9 as alice); rotate renews it. */
async function linkToken(board, rotate = false) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
/** Text of the first match as the browser renders it, whitespace folded ('' when missing). */
const textOf = (page, sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '')
const rowSel = (id) => `[data-knorke-board="${id}"]`

/** The board list at /apps/knorke/ (loaded) with the row of `id` visible. */
async function listWith(page, id) {
	await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	return page.locator(rowSel(id)).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
}

/** The URL is the board list (/apps/knorke/ or /apps/knorke). */
const atList = (page) => /\/apps\/knorke\/?$/.test(new URL(page.url()).pathname)

/** The answer of the next GET of the board list (route 1), from Node. */
const nextList = (page) => page.waitForResponse((r) => /\/api\/v1\/boards$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET', { timeout: 15000 }).catch(() => null)

/**
 * The checks of the final page: banner gone with `text`, the empty state,
 * no spinner.
 */
async function finalPage(t, page, text, label) {
	const banner = await until(() => visible(page, '[data-knorke-banner=gone]'), { timeout: 10000 })
	const bt = await textOf(page, '[data-knorke-banner=gone] .knorke-banner__text')
	t.check(banner && bt === text, `[C] ${label}: [data-knorke-banner=gone] mit „${text}“`, bt)
	const empty = await until(() => visible(page, EMPTY), { timeout: 5000 })
	const et = await textOf(page, EMPTY)
	t.check(empty && et.includes('Could not open the board'), `[C] ${label}: ${EMPTY} sichtbar mit „Could not open the board“`, et)
	const spin = await page.locator(SPINNER).count()
	t.check(spin === 0, `[C] ${label}: kein Spinner (${SPINNER} hat die Anzahl 0)`, spin)
	return { banner, bt }
}

export const E45 = {
	id: 'E45',
	title: 'Endgültiger Fehler beim Öffnen: veraltete Liste mit Link (Link-Text, Leerzustand statt Spinner, Tastatur zurück), Lesezeichen (allgemeiner Text), gelöschtes Board am Telefon mit Touch',
	async run(t, world) {
		const A = await world.board('E45 Link')
		const TITLE_A = 'E45 Link'
		const L = await linkToken(A)
		const jr = await api('bob', 'POST', `/api/v1/links/${L}/join`)
		t.must(jr.status === 200, '[D] bob tritt über den Bearbeitungslink bei (API)', { status: jr.status, body: jr.text.slice(0, 200) })

		t.step('(1) veraltete Liste: bob klickt die Zeile A nach dem Erneuern des Links')
		const bob = await world.actor('bob-endgueltig', { user: 'bob' })
		const p = bob.page
		t.must(await listWith(p, A), `[D] bobs Liste zeigt die Zeile ${rowSel(A)}`)
		const src = await p.locator(rowSel(A)).first().getAttribute('data-knorke-board-source')
		t.must(src === 'link', `[D] die Zeile A trägt [data-knorke-board-source=link]`, src)
		await linkToken(A, true)
		const snap = await api('bob', 'GET', `/api/v1/boards/${A}/snapshot`)
		t.check(snap.status === 404, '[B] nach dem Erneuern: GET /api/v1/boards/A/snapshot als bob → 404', { status: snap.status, text: snap.text.slice(0, 200) })
		await p.locator(`${rowSel(A)} a`).first().click()
		await finalPage(t, p, LINK_TEXT, 'Liste mit Link')
		await sleep(3000)
		const spin3 = await p.locator(SPINNER).count()
		t.check(spin3 === 0 && (await visible(p, EMPTY)), '[C] 3 s später: weiterhin kein Spinner, der Leerzustand steht', { spinner: spin3 })
		const boardText = await p.locator('.knorke-board').first().innerText().catch(() => '')
		t.check(boardText !== '' && !boardText.includes(TITLE_A), '[C] .knorke-board enthält den Titel von A nicht', boardText.slice(0, 300))

		await p.locator('[data-knorke-action=back]').first().focus()
		let tabs = 0
		let reached = false
		while (tabs < 5 && !reached) {
			await p.keyboard.press('Tab')
			tabs++
			reached = await p.evaluate((sel) => !!document.activeElement?.closest?.(sel), BACK)
		}
		t.check(reached, `[C] Tastatur: vom Zurück-Pfeil der TopBar erreichen höchstens 5 Tab-Drücke ${BACK}`, { tabs, active: await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)) })
		const reload1 = nextList(p)
		await p.keyboard.press('Enter')
		const list1 = await p.locator(LIST).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)
		t.check(list1 && atList(p), '[C] Enter öffnet die Board-Liste (URL /apps/knorke/)', p.url())
		const r1 = await reload1
		t.check(r1?.status() === 200, '[B] die Liste wird neu geladen (GET /api/v1/boards → 200)', r1?.status())
		const noA = await until(async () => (await p.locator(rowSel(A)).count()) === 0, { timeout: 5000 })
		t.check(noA, '[C] die neu geladene Liste enthält keine Zeile A')

		t.step('(2) Lesezeichen: bob ruft /b/A direkt auf')
		await p.goto(`${APP}/b/${A}`, { waitUntil: 'domcontentloaded' })
		const b2 = await finalPage(t, p, GONE_TEXT, 'Lesezeichen')
		t.check(b2.bt !== LINK_TEXT, '[C] Lesezeichen: nicht der Link-Text (die Liste dieses Tabs ist leer)', b2.bt)
		await p.locator(BACK).first().click()
		const list2 = await p.locator(LIST).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)
		t.check(list2 && atList(p), '[C] Lesezeichen: ein Klick auf „Back to all boards“ öffnet die Liste', p.url())
		await world.drop(bob)

		t.step('(3) gelöschtes Board am Telefon mit Touch')
		const B = await world.board('E45 Gelöscht')
		const phone = await world.actor('alice-endgueltig-handy', { user: 'alice', touch: true, viewport: PHONE })
		const q = phone.page
		t.must(await listWith(q, B), `[D] alices Liste zeigt die Zeile ${rowSel(B)}`)
		const del = await api('alice', 'DELETE', `/api/v1/boards/${B}`)
		t.must(del.status === 200, '[D] B über die API gelöscht (von einem anderen Gerät)', { status: del.status, text: del.text.slice(0, 200) })
		await q.locator(`${rowSel(B)} a`).first().tap()
		await finalPage(t, q, GONE_TEXT, 'Telefon')
		const box = await q.locator(BACK).first().boundingBox().catch(() => null)
		const vp = q.viewportSize()
		t.check(!!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, `[C] Telefon: ${BACK} liegt ganz im Viewport ${vp.width} × ${vp.height}`, { box, vp })
		const reload3 = nextList(q)
		await q.locator(BACK).first().tap()
		const list3 = await q.locator(LIST).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)
		t.check(list3 && atList(q), '[C] Telefon: ein Tipp auf „Back to all boards“ öffnet die Liste', q.url())
		await reload3
		const noB = await until(async () => (await q.locator(rowSel(B)).count()) === 0, { timeout: 5000 })
		t.check(noB, '[C] Telefon: die Liste enthält keine Zeile B')
		await world.drop(phone)
	},
}
