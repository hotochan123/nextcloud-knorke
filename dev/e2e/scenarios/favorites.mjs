/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Favorites and sort order of the board list (factory job 219, AK8).
 *
 * E87 alice (Chromium 1440 × 900, mouse) with two boards of her own: A
 * "Zz E87 Favorit" (sorts last by name among the run's boards), then B
 * "Aa E87 Neu" (newer, so above A by "Last modified"; before A by name).
 * Real clicks on the list only; the server's view through route 5
 * (listBoards). Steps:
 *   (1) the list sorts by "Last modified" (menu "Sort: Last modified" in a
 *       fresh browser), B above A; a click on A's star presses it, the row
 *       says data-knorke-favorite=true and route 5 answers favorite true;
 *   (2) after a reload A is still starred, B is not;
 *   (3) the filter "Favorites" shows A, not B, and only starred rows;
 *       unstarring A there takes its row away at once, route 5 answers
 *       favorite false; a click on the star again (back in "All boards")
 *       stars it again;
 *   (4) sort "Name": B before A, A the last row; alice opens A and goes back
 *       (route 5 answers an openedAt of now); sort "Last opened": A is the
 *       first row, above B;
 *   (5) after a reload the menu still says "Sort: Last opened" and A is the
 *       first row (localStorage knorke.boardSort = opened).
 *   (6) (round 1; job 232: the sheet) alice on a phone 390 × 844 with a
 *       finger: the sort button at least 44 px high and inside the screen;
 *       no star button and no "…" on the cards; a long press on A's card
 *       opens the sheet [data-knorke-sheet=board-actions] at the bottom (the
 *       board does not open), its entries favorite, rename, delete at least
 *       44 px high inside the screen, the first one focused after the
 *       finger lifts; a tap on the star entry closes it and
 *       toggles the star (route 5 follows, a set star shows as the mark).
 * Own boards, no instance setting: after E86, before E09.
 * Flake gate: --only E87 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] the board
 * list in the browser, [B] a server answer, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap
 * 9.10).
 */
import { APP, PHONE, listBoards, sleep, until, waitReady } from '../lib/harness.mjs'

const TITLE_A = 'Zz E87 Favorit'
const TITLE_B = 'Aa E87 Neu'
const LIST = '[data-knorke=board-list]'
/** Least hit area for a finger (--knorke-touch). */
const TOUCH = 44

/** Opens the board list and waits for its rows. */
async function openList(page) {
	await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	await page.locator(LIST).first().waitFor({ state: 'attached', timeout: 15000 })
	return until(async () => (await page.locator('[data-knorke-board]').count()) > 0, { timeout: 10000 })
}

/** Board ids of the shown rows, top to bottom. */
const rows = (page) => page.$$eval('[data-knorke-board]', (els) => els.map((e) => Number(e.getAttribute('data-knorke-board')))).catch(() => [])

/** data-knorke-favorite of a row and aria-pressed of its star. */
async function starOf(page, id) {
	const row = page.locator(`[data-knorke-board="${id}"]`).first()
	if ((await row.count()) === 0) return null
	return {
		row: await row.getAttribute('data-knorke-favorite'),
		pressed: await row.locator('[data-knorke-action=favorite]').first().getAttribute('aria-pressed'),
	}
}

/** Clicks the star of a row. */
const clickStar = (page, id) => page.locator(`[data-knorke-board="${id}"] [data-knorke-action=favorite]`).first().click({ timeout: 3000 })

/** The text on the sort menu's button. */
const sortText = async (page) => ((await page.locator('[data-knorke-action=sort] button').first().textContent({ timeout: 3000 }).catch(() => '')) || '').trim()

/** Bounding box of the first match (null when absent). */
const box = (page, sel) => page.locator(sel).first().boundingBox().catch(() => null)

/** Picks an order in the sort menu. */
async function pickSort(page, order) {
	await page.locator('[data-knorke-action=sort] button').first().click({ timeout: 3000 })
	await page.locator(`[data-knorke-sort=${order}]`).first().click({ timeout: 3000 })
}

/** Picks a navigation filter and waits until it is the current one. */
async function pickFilter(page, id) {
	const f = page.locator(`[data-knorke-filter=${id}]`).first()
	await f.click({ timeout: 3000 })
	return until(async () => (await f.getAttribute('aria-current')) === 'page' || (await f.locator('[aria-current=page]').count()) > 0, { timeout: 3000 })
}

/** Does x stand above y in the list? */
const above = (list, x, y) => list.includes(x) && list.includes(y) && list.indexOf(x) < list.indexOf(y)

/** Board A as route 5 answers it to alice. */
const served = async (id) => (await listBoards('alice')).find((b) => b.id === id) ?? null

export const E87 = {
	id: 'E87',
	title: 'Favoriten und Sortierung der Boardliste (Job 219): der Stern markiert ein Board auch nach dem Neuladen, „Favorites“ zeigt nur markierte Boards, „Last opened“ stellt das zuletzt geöffnete Board nach oben, und die Sortierung bleibt nach dem Neuladen',
	async run(t, world) {
		const A = await world.board(TITLE_A)
		const B = await world.board(TITLE_B)
		const s0 = await served(A)
		t.must(s0 && s0.favorite === false && s0.openedAt === null, '[B] Vorbedingung: A ist neu, ohne Stern und nie geöffnet', s0)
		const a = await world.actor('alice-favorites', { user: 'alice' })
		const pa = a.page
		try {
			t.step('(1) Stern an A in der Liste „Last modified“')
			t.must(await openList(pa), '[D] Vorbedingung: die Boardliste zeigt Zeilen')
			t.check(await sortText(pa) === 'Sort: Last modified', '[C] (1) ein frischer Browser sortiert nach „Last modified“', await sortText(pa))
			t.check(above(await rows(pa), B, A), '[C] (1) das neuere B steht über A', await rows(pa))
			t.check(JSON.stringify(await starOf(pa, A)) === JSON.stringify({ row: 'false', pressed: 'false' }), '[C] (1) A hat keinen Stern', await starOf(pa, A))
			await clickStar(pa, A)
			t.check(await until(async () => JSON.stringify(await starOf(pa, A)) === JSON.stringify({ row: 'true', pressed: 'true' }), { timeout: 2000 }), '[C] (1) der Klick drückt den Stern, die Zeile sagt data-knorke-favorite=true', await starOf(pa, A))
			t.check(await until(async () => (await served(A))?.favorite === true, { timeout: 5000 }), '[B] (1) Route 5 meldet A als Favorit', await served(A))

			t.step('(2) Neuladen: A bleibt markiert')
			t.must(await openList(pa), '[D] Vorbedingung: die Boardliste zeigt nach dem Neuladen Zeilen')
			t.check(JSON.stringify(await starOf(pa, A)) === JSON.stringify({ row: 'true', pressed: 'true' }), '[C] (2) nach dem Neuladen hat A den Stern', await starOf(pa, A))
			t.check(JSON.stringify(await starOf(pa, B)) === JSON.stringify({ row: 'false', pressed: 'false' }), '[C] (2) B hat keinen Stern', await starOf(pa, B))

			t.step('(3) Filter „Favorites“, Stern dort entfernen und wieder setzen')
			t.must(await pickFilter(pa, 'favorites'), '[D] Vorbedingung: der Filter favorites ist aktiv')
			const favRows = await rows(pa)
			t.check(favRows.includes(A) && !favRows.includes(B), '[C] (3) „Favorites“ zeigt A, nicht B', favRows)
			const stars = await pa.$$eval('[data-knorke-board]', (els) => els.map((e) => e.getAttribute('data-knorke-favorite')))
			t.check(stars.length > 0 && stars.every((x) => x === 'true'), '[C] (3) „Favorites“ zeigt nur markierte Zeilen', stars)
			await clickStar(pa, A)
			t.check(await until(async () => !(await rows(pa)).includes(A), { timeout: 2000 }), '[C] (3) ohne Stern verschwindet A sofort aus „Favorites“', await rows(pa))
			t.check(await until(async () => (await served(A))?.favorite === false, { timeout: 5000 }), '[B] (3) Route 5 meldet A ohne Stern', await served(A))
			t.must(await pickFilter(pa, 'all'), '[D] Vorbedingung: der Filter all ist wieder aktiv')
			await clickStar(pa, A)
			t.check(await until(async () => (await served(A))?.favorite === true, { timeout: 5000 }), '[B] (3) ein neuer Klick markiert A wieder', await served(A))

			t.step('(4) Sortierung „Name“, A öffnen, Sortierung „Last opened“')
			await pickSort(pa, 'name')
			t.check(await until(async () => (await rows(pa)).at(-1) === A && above(await rows(pa), B, A), { timeout: 2000 }), '[C] (4) nach Name steht „Aa E87 Neu“ vor „Zz E87 Favorit“, A unten', await rows(pa))
			t.check(await sortText(pa) === 'Sort: Name', '[C] (4) das Menü nennt „Name“', await sortText(pa))
			const before = Date.now() - 60000
			await pa.locator(`[data-knorke-board="${A}"] a`).first().click({ timeout: 3000 })
			await waitReady(pa, 30000)
			t.check(await until(async () => ((await served(A))?.openedAt ?? 0) >= before, { timeout: 5000 }), '[B] (4) Route 5 meldet für A eine Öffnungszeit von jetzt', await served(A))
			t.must(await openList(pa), '[D] Vorbedingung: zurück in der Boardliste')
			t.check(await sortText(pa) === 'Sort: Name', '[C] (4) die Liste sortiert weiter nach Name', await sortText(pa))
			await pickSort(pa, 'opened')
			t.check(await until(async () => (await rows(pa))[0] === A && above(await rows(pa), A, B), { timeout: 2000 }), '[C] (4) nach „Last opened“ steht A oben, über dem neueren B', await rows(pa))

			t.step('(5) Neuladen: die Sortierung bleibt')
			t.must(await openList(pa), '[D] Vorbedingung: die Boardliste zeigt nach dem Neuladen Zeilen')
			t.check(await sortText(pa) === 'Sort: Last opened', '[C] (5) das Menü nennt nach dem Neuladen „Last opened“', await sortText(pa))
			t.check((await rows(pa))[0] === A, '[C] (5) A steht nach dem Neuladen oben', await rows(pa))
			const stored = await pa.evaluate(() => localStorage.getItem('knorke.boardSort')).catch(() => null)
			t.check(stored === 'opened', '[C] (5) localStorage knorke.boardSort = opened', stored)
		} finally {
			await world.drop(a)
		}

		// (6) round 1 of job 219: a finger on a 390 px phone
		const p = await world.actor('alice-favorites-phone', { user: 'alice', touch: true, viewport: PHONE })
		const pp = p.page
		try {
			t.step('(6) Telefon 390 × 844 mit Finger: Sortierknopf ≥ 44 px; langes Drücken öffnet das Blatt, dessen Stern schaltet')
			t.must(await openList(pp), '[D] Vorbedingung: die Boardliste zeigt auf dem Telefon Zeilen')
			const sort = await box(pp, '[data-knorke-action=sort] button')
			t.check(sort && sort.height >= TOUCH - 0.5 && sort.x + sort.width <= PHONE.width, '[C] (6) der Sortierknopf ist mindestens 44 px hoch und ganz im Bild', sort)
			const card = `[data-knorke-board="${A}"]`
			t.check((await pp.locator(`${card} [data-knorke-action=favorite], ${card} .knorke-list__actions`).count()) === 0, '[C] (6) auf der Karte weder Stern-Knopf noch „…“ (Job 232)')
			const before = await pp.locator(card).first().getAttribute('data-knorke-favorite')
			const link = await box(pp, `${card} a.knorke-list__link`)
			t.must(!!link, '[D] (6) Vorbedingung: der Link der Karte ist sichtbar')
			const cdp = await p.ctx.newCDPSession(pp)
			const pt = { x: link.x + link.width / 2, y: link.y + Math.min(40, link.height / 2) }
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] })
			await sleep(700)
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
			const SHEET = '[data-knorke-sheet=board-actions]'
			t.check(await until(() => pp.locator(SHEET).first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (6) langes Drücken öffnet das Aktionsblatt')
			await sleep(400)
			t.check(new URL(pp.url()).pathname.replace(/\/+$/, '').endsWith('/apps/knorke'), '[C] (6) das Board öffnet sich nicht', pp.url())
			const focus = await pp.evaluate((sel) => !!document.activeElement?.closest(sel) && document.activeElement.getAttribute('data-knorke-action'), SHEET).catch(() => null)
			t.check(focus === 'favorite', '[C] (6) nach dem Loslassen hat der erste Eintrag den Fokus (Job 232 Runde 1)', focus)
			const entries = await pp.locator(`${SHEET} button[data-knorke-action]`).evaluateAll((els) => els.map((e) => {
				const r = e.getBoundingClientRect()
				return { action: e.getAttribute('data-knorke-action'), h: Math.round(r.height), inView: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight }
			})).catch(() => [])
			t.check(entries.map((x) => x.action).join() === 'favorite,rename,delete', '[C] (6) das Blatt hält Stern, Umbenennen und Löschen', entries)
			t.check(entries.length === 3 && entries.every((x) => x.h >= TOUCH && x.inView), '[C] (6) jeder Eintrag ist mindestens 44 px hoch und im Bild', entries)
			await pp.locator(`${SHEET} [data-knorke-action=favorite]`).first().tap({ timeout: 3000 })
			const want = before === 'true' ? 'false' : 'true'
			t.check(await until(async () => (await pp.locator(SHEET).count()) === 0, { timeout: 2000 }), '[C] (6) der Eintrag schließt das Blatt')
			t.check(await until(async () => (await pp.locator(card).first().getAttribute('data-knorke-favorite')) === want, { timeout: 2000 }), '[C] (6) der Stern-Eintrag schaltet den Favoriten', { before })
			t.check((await pp.locator(`${card} .knorke-list__starmark`).count()) === (want === 'true' ? 1 : 0), '[C] (6) ein gesetzter Stern steht als Zeichen auf der Karte')
			t.check(await until(async () => String((await served(A))?.favorite) === want, { timeout: 5000 }), '[B] (6) Route 5 meldet den neuen Zustand', await served(A))
		} finally {
			await world.drop(p)
		}
	},
}
