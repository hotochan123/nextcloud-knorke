/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The redesigned board list (factory job 232, docs/redesign/ P9, P9b, V12,
 * V14).
 *
 * E97 alice with two boards of her own, A "E97 Raster" and B "E97 Zweites".
 * Real clicks and keys only; the server's view through route 5. Steps:
 *   (1) Chromium 1440 × 900, mouse: the list is a grid; A's card shows its
 *       picture at least 240 px wide at 240 : 150, the title in at most two
 *       lines, the time in a muted colour (not the title's), the star and
 *       the owner's "…" outside the link;
 *   (2) the unset star of A is hidden (opacity 0) while the pointer is
 *       elsewhere, shows under the pointer; a click sets it (route 5 says
 *       favorite true) and it stays visible with the pointer elsewhere; a
 *       second click takes it away again;
 *   (3) the switch: "List" shows rows with a 96 × 60 picture, and after a
 *       reload the list is still a list (knorke.boardView); "Grid" brings
 *       the cards back;
 *   (4) a phone 390 × 844 with a finger: two cards side by side, no "…";
 *   (5) "New board": the dialog [data-knorke-dialog=new-board] has the
 *       title field and the template tiles, "Blank" picked; a click picks
 *       "Kanban", Esc closes the dialog with the focus on a tile; with "Kanban"
 *       picked the new board opens with 3 frames "To do", "Doing", "Done"
 *       (9 items, the server has them) and no start tiles; one Ctrl+Z
 *       empties it and the start tiles come; a second new board with
 *       "Blank" opens empty with the start tiles (gone while the note tool
 *       is picked, back with Select), Tab from the canvas
 *       reaches them, Enter on SWOT inserts 4 frames.
 * Pictures of the steps go to out/<ns>/shots/E97-*.png (for the review).
 * Own boards, no instance setting: after E95, before E09.
 * Flake gate: --only E97 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] the shell
 * in the browser, [B] a server answer, [D] a harness precondition. Waiting
 * polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { outDir } from '../lib/bridge.mjs'
import { APP, CANVAS, PHONE, action, field, itemMap, listBoards, serverMap, sleep, until, waitReady } from '../lib/harness.mjs'

const TITLE_A = 'E97 Raster'
const TITLE_B = 'E97 Zweites'
const LIST = '[data-knorke=board-list]'
const START = '[data-knorke=start-templates]'
const NEW = '[data-knorke-dialog=new-board]'

/** Opens the board list and waits for its cards. */
async function openList(page) {
	await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	await page.locator(LIST).first().waitFor({ state: 'attached', timeout: 15000 })
	return until(async () => (await page.locator('[data-knorke-board]').count()) > 0, { timeout: 10000 })
}

/** What the browser shows of a card: the picture, the title's lines, the colours, the star. */
const cardOf = (page, id) => page.locator(`[data-knorke-board="${id}"]`).first().evaluate((li) => {
	const box = (el) => {
		const r = el?.getBoundingClientRect()
		return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
	}
	const link = li.querySelector('a.knorke-list__link')
	const title = li.querySelector('.knorke-list__title')
	const meta = li.querySelector('.knorke-list__meta')
	const star = li.querySelector('[data-knorke-action=favorite]')
	const lh = title ? parseFloat(getComputedStyle(title).lineHeight) || parseFloat(getComputedStyle(title).fontSize) * 1.5 : 0
	return {
		picture: box(li.querySelector('.knorke-list__icon')),
		titleLines: title ? Math.round(title.getBoundingClientRect().height / lh) : 0,
		titleColor: title ? getComputedStyle(title).color : null,
		metaColor: meta ? getComputedStyle(meta).color : null,
		star: star ? { opacity: getComputedStyle(star).opacity, pressed: star.getAttribute('aria-pressed'), inLink: !!link?.contains(star) } : null,
		actions: !!li.querySelector('.knorke-list__actions') && !link?.contains(li.querySelector('.knorke-list__actions')),
		box: box(li),
	}
}).catch(() => null)

/** The box is a card's picture: at least minW wide, at 240 : 150 (± 0.02). */
const cardPicture = (b, minW = 240) => !!b && b.w >= minW - 0.5 && Math.abs(b.w / b.h - 240 / 150) <= 0.02

/** Frames of the page's items: titles in order of x, and the item count. */
async function frames(page) {
	const m = await itemMap(page)
	const all = [...m.values()]
	return { size: m.size, titles: all.filter((it) => it.t === 'frame').sort((a, b) => a.x - b.x || a.y - b.y).map((f) => f.data?.title ?? '') }
}

/** Creates a board through "New board" with a picked tile; returns its id. */
async function createWith(page, title, tile, world) {
	const before = new Set((await listBoards('alice')).map((x) => x.id))
	await action(page, 'new-board')
	await page.locator(NEW).first().waitFor({ state: 'visible', timeout: 10000 })
	await field(page, 'title', title)
	if (tile !== 'blank') await page.locator(`${NEW} [data-knorke-template=${tile}]`).first().click()
	await action(page, 'confirm')
	const b = await until(async () => (await listBoards('alice')).find((x) => x.title === title && !before.has(x.id)), { timeout: 10000 })
	if (!b) throw new Error(`Board „${title}“ ist nach confirm nicht in der Liste`)
	world.boards.add(b.id)
	await waitReady(page, 30000)
	return b.id
}

/** Saves a picture of the page as E97-<name>.png in shots/; false when it fails. */
async function picture(page, name) {
	const dir = path.join(outDir(), 'shots')
	fs.mkdirSync(dir, { recursive: true })
	return page.screenshot({ path: path.join(dir, `E97-${name}.png`), timeout: 5000 }).then(() => true, () => false)
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)

export const E97 = {
	id: 'E97',
	title: 'Boardliste neu (Job 232): Karten mit großem Bild, Stern bei Zeiger, „…“, Raster/Liste bleibt; Telefon zwei Spalten; „Neues Board“ mit Vorlage öffnet Kanban, „Leer“ zeigt die Startkacheln, Tab und Enter wählen SWOT',
	async run(t, world) {
		const A = await world.board(TITLE_A)
		const B = await world.board(TITLE_B)
		const a = await world.actor('alice-boardlist', { user: 'alice' })
		const pa = a.page
		try {
			t.step('(1) Raster: Bild ≥ 240 px im Verhältnis 240 : 150, Titel ≤ 2 Zeilen, Zeit gedämpft')
			t.must(await openList(pa), '[D] Vorbedingung: die Boardliste zeigt Karten')
			await pa.evaluate(() => localStorage.removeItem('knorke.boardView')).catch(() => {})
			t.must(await openList(pa), '[D] Vorbedingung: die Liste neu geladen (Ansicht Standard)')
			t.check((await pa.locator(LIST).first().getAttribute('data-knorke-view-mode')) === 'grid', '[C] (1) ein frischer Browser zeigt das Raster')
			const ca = await cardOf(pa, A)
			t.check(cardPicture(ca?.picture), '[C] (1) A zeigt sein Bild ≥ 240 px breit im Verhältnis 240 : 150', ca?.picture)
			t.check(ca && ca.titleLines >= 1 && ca.titleLines <= 2, '[C] (1) der Titel hat höchstens zwei Zeilen', ca?.titleLines)
			t.check(ca && ca.metaColor && ca.metaColor !== ca.titleColor, '[C] (1) die Zeit steht in einer gedämpften Farbe', { title: ca?.titleColor, meta: ca?.metaColor })
			t.check(ca?.star && !ca.star.inLink && ca.actions, '[C] (1) Stern und „…“ stehen neben dem Link, nicht darin', ca)
			await picture(pa, 'grid')

			t.step('(2) Stern: verborgen, bei Zeiger sichtbar, gesetzt immer sichtbar')
			await pa.mouse.move(2, 2)
			await sleep(300)
			t.check((await cardOf(pa, A))?.star?.opacity === '0', '[C] (2) der nicht gesetzte Stern ist ohne Zeiger verborgen', (await cardOf(pa, A))?.star)
			await pa.locator(`[data-knorke-board="${A}"] .knorke-list__icon`).first().hover()
			t.check(await until(async () => (await cardOf(pa, A))?.star?.opacity === '1', { timeout: 2000 }), '[C] (2) unter dem Zeiger erscheint er', (await cardOf(pa, A))?.star)
			await pa.locator(`[data-knorke-board="${A}"] [data-knorke-action=favorite]`).first().click()
			t.check(await until(async () => (await listBoards('alice')).find((x) => x.id === A)?.favorite === true, { timeout: 5000 }), '[B] (2) Route 5 meldet A als Favorit')
			await pa.mouse.move(2, 2)
			await sleep(300)
			const set = (await cardOf(pa, A))?.star
			t.check(set?.pressed === 'true' && set.opacity === '1', '[C] (2) gesetzt bleibt er ohne Zeiger sichtbar', set)
			await pa.locator(`[data-knorke-board="${A}"] [data-knorke-action=favorite]`).first().click()
			t.check(await until(async () => (await listBoards('alice')).find((x) => x.id === A)?.favorite === false, { timeout: 5000 }), '[B] (2) ein zweiter Klick nimmt ihn weg')

			t.step('(3) Umschalter: Liste mit 96 × 60, bleibt nach Neuladen, Raster zurück')
			await pa.locator('[data-knorke-view=list]').first().click()
			t.check(await until(async () => (await pa.locator(LIST).first().getAttribute('data-knorke-view-mode')) === 'list', { timeout: 2000 }), '[C] (3) „List“ zeigt die Liste')
			const row = await cardOf(pa, A)
			t.check(!!row?.picture && Math.round(row.picture.w) === 96 && Math.round(row.picture.h) === 60, '[C] (3) das Bild der Zeile ist 96 × 60', row?.picture)
			await picture(pa, 'list')
			t.must(await openList(pa), '[D] Vorbedingung: neu geladen')
			t.check((await pa.locator(LIST).first().getAttribute('data-knorke-view-mode')) === 'list', '[C] (3) nach dem Neuladen bleibt die Liste')
			t.check((await pa.locator('[data-knorke-view=list]').first().getAttribute('aria-pressed')) === 'true', '[C] (3) „List“ ist gedrückt')
			await pa.locator('[data-knorke-view=grid]').first().click()
			t.check(await until(async () => (await pa.locator(LIST).first().getAttribute('data-knorke-view-mode')) === 'grid', { timeout: 2000 }), '[C] (3) „Grid“ bringt die Karten zurück')

			t.step('(5) „Neues Board“ mit Kanban, dann mit „Leer“')
			await action(pa, 'new-board')
			t.must(await until(() => visible(pa, NEW), { timeout: 5000 }), '[C] (5) „New board“ öffnet [data-knorke-dialog=new-board]')
			const picked = await pa.locator(`${NEW} [data-knorke-picked=true]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-template'))).catch(() => [])
			t.check(picked.join() === 'blank', '[C] (5) „Blank“ ist vorgewählt', picked)
			t.check((await pa.locator(`${NEW} input[type=radio]`).count()) >= 5 && (await pa.locator(`${NEW} [data-knorke-field=title]`).count()) === 1, '[C] (5) Titelfeld und mindestens fünf Vorlagen-Kacheln')
			await pa.locator(`${NEW} [data-knorke-template=kanban]`).first().click()
			await sleep(200)
			await picture(pa, 'new-board')
			t.check((await pa.locator(`${NEW} [data-knorke-template=kanban]`).first().getAttribute('data-knorke-picked')) === 'true', '[C] (5) ein Klick wählt „Kanban“')
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await pa.locator(NEW).count()) === 0, { timeout: 3000 }), '[C] (5) Esc schließt den Dialog auch mit dem Fokus auf einer Kachel')
			const K1 = await createWith(pa, 'E97 Neu Kanban', 'kanban', world)
			t.check(await until(async () => { const f = await frames(pa); return f.size === 9 && f.titles.join() === 'To do,Doing,Done' }, { timeout: 8000 }), '[C] (5) das neue Board öffnet mit Kanban: 3 Frames, 9 Objekte', await frames(pa))
			t.check(await until(async () => (await serverMap('alice', K1)).size === 9, { timeout: 8000 }), '[B] (5) der Server hat die 9 Objekte')
			t.check((await pa.locator(START).count()) === 0, '[C] (5) keine Startkacheln auf dem Board mit Vorlage')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await itemMap(pa)).size === 0, { timeout: 5000 }), '[C] (5) ein Strg+Z leert das Board (ein Schritt)')
			t.check(await until(() => visible(pa, START), { timeout: 5000 }), '[C] (5) danach erscheinen die Startkacheln')
			t.must(await openList(pa), '[D] Vorbedingung: zurück in der Boardliste')
			await createWith(pa, 'E97 Neu Leer', 'blank', world)
			t.check(await until(() => visible(pa, START), { timeout: 5000 }), '[C] (5) „Blank“: das neue Board zeigt die Startkacheln')
			t.check((await itemMap(pa)).size === 0, '[C] (5) und ist leer')
			await picture(pa, 'start-tiles')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('n')
			t.check(await until(async () => (await pa.locator(START).count()) === 0, { timeout: 2000 }), '[C] (5) mit dem Notizwerkzeug sind die Startkacheln weg (ein Klick in die Mitte legt eine Notiz an)')
			await pa.keyboard.press('v')
			t.check(await until(() => visible(pa, START), { timeout: 2000 }), '[C] (5) mit „Auswählen“ sind sie wieder da')
			// job 232 round 3: a laptop window split in half (640 px): the tiles clear of the tool bar
			await pa.setViewportSize({ width: 640, height: 800 })
			await sleep(400)
			const half = await pa.evaluate((sel) => {
				const bar = document.querySelector('.knorke-toolbar')?.getBoundingClientRect()
				const tiles = [...document.querySelectorAll(`${sel} [data-knorke-template], ${sel} [data-knorke-own-template]`)].map((el) => el.getBoundingClientRect())
				return {
					bar: !!bar,
					n: tiles.length,
					under: bar ? tiles.filter((r) => r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top).length : -1,
					inView: tiles.every((r) => r.left >= 0 && r.right <= innerWidth),
				}
			}, START)
			t.check(half.bar && half.n >= 5 && half.under === 0 && half.inView, '[C] (5) bei 640 px liegt keine Startkachel unter der Werkzeugleiste, alle im Bild (Job 232 Runde 3)', half)
			await pa.setViewportSize({ width: 1440, height: 900 })
			await sleep(400)
			await pa.locator(CANVAS).first().focus()
			let reached = null
			for (let i = 0; i < 40 && !reached; i++) {
				await pa.keyboard.press('Tab')
				reached = await pa.evaluate((sel) => {
					const el = document.activeElement
					return el && el.closest(sel) ? el.getAttribute('data-knorke-template') ?? el.getAttribute('data-knorke-own-template') : null
				}, START).catch(() => null)
			}
			t.check(reached === 'retro', '[C] (5) Tab von der Leinwand erreicht die erste Startkachel', reached)
			await pa.locator(`${START} [data-knorke-template=swot]`).first().focus()
			await pa.keyboard.press('Enter')
			t.check(await until(async () => (await frames(pa)).titles.length === 4, { timeout: 5000 }), '[C] (5) Enter auf SWOT fügt 4 Frames ein', await frames(pa))
			t.check(await until(async () => (await pa.locator(START).count()) === 0, { timeout: 3000 }), '[C] (5) die Startkacheln gehen')
		} finally {
			await world.drop(a)
		}

		const p = await world.actor('alice-boardlist-phone', { user: 'alice', touch: true, viewport: PHONE })
		const pp = p.page
		try {
			t.step('(4) Telefon 390 × 844: zwei Karten nebeneinander, kein „…“')
			t.must(await openList(pp), '[D] Vorbedingung: die Boardliste zeigt auf dem Telefon Karten')
			const cards = await pp.locator('[data-knorke-board]').evaluateAll((els) => els.slice(0, 2).map((e) => {
				const r = e.getBoundingClientRect()
				return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }
			})).catch(() => [])
			t.check(cards.length === 2 && cards[0].top === cards[1].top && cards[0].right <= cards[1].left && cards[1].right <= PHONE.width, '[C] (4) zwei Karten stehen nebeneinander im Bild', cards)
			t.check((await pp.locator('.knorke-list__actions, [data-knorke-board] [data-knorke-action=favorite]').count()) === 0, '[C] (4) kein „…“ und kein Stern-Knopf auf den Karten')
			t.check(cardPicture((await cardOf(pp, B))?.picture, 100), '[C] (4) das Bild bleibt im Verhältnis 240 : 150', (await cardOf(pp, B))?.picture)
			await picture(pp, 'phone')
			const lb = await pp.locator(`[data-knorke-board="${B}"] a.knorke-list__link`).first().boundingBox().catch(() => null)
			if (lb) {
				await pp.mouse.click(lb.x + lb.width / 2, lb.y + 30, { button: 'right' })
				if (await until(() => visible(pp, '[data-knorke-sheet=board-actions]'), { timeout: 2000 })) await picture(pp, 'phone-sheet')
				await pp.keyboard.press('Escape')
			}
		} finally {
			await world.drop(p)
		}
	},
}
