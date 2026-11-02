/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The context bar at the selection (factory job 137).
 *
 * One board for the case and its passes (a WeakMap per world: the full run
 * stays under MAX_BOARDS_PER_RUN); every pass seeds its own note N and frame
 * F in its own part of the world and opens the board with a stored camera
 * (localStorage knorke.cam.<board>), so N stands where the pass wants it.
 *
 * E48 alice, mouse, Chromium 1280 × 800 (the wide layout). N (200 × 200)
 *   and a frame F (2000 × 1400) far from it. Steps:
 *   (1) a click on N: [data-knorke-place=above]; the bar's bottom edge lies
 *       at least 30 px above the topmost handle (__knorke.handles()), its
 *       middle over N's middle (±1);
 *   (2) "Fill" opens its panel with [data-knorke-panel-side=above], wholly
 *       above the bar and inside the canvas;
 *   (3) while N is dragged and while the view pans with the middle button
 *       the bar is not visible; afterwards it stands 'above' at N's new place;
 *   (4) N just under the TopBar: 'below'; N half over the left edge: the
 *       bar's left edge ≥ 8 px into the board; F filling the view (a click on
 *       its title band): 'pinned' with its top at T (±1), T = the deeper
 *       bottom edge of the TopBar and the visible banners + 8;
 *   (5) N panned out of view: 'hidden'; the selection stays, Del deletes N,
 *       Ctrl+Z brings it back;
 *   (6) the focus on "Fill", then the wheel pans N out of view: the focus
 *       is on the canvas;
 *   (7) bob (an account through the edit link, a link member) sees the
 *       privacy card; selecting N leaves the card's rectangle as it was
 *       (±0.5) and the bar does not overlap it.
 * E48@820x1180 alice with a finger (touch, a fine pointer too: mode edit):
 *   a tap on N gives 'above', no handle circle of 22 px overlaps the bar;
 *   while a finger drags N the bar is not visible, afterwards it is back;
 *   with F filling the view and its title band under where the pinned bar
 *   shows, a tap there (the middle, then "Delete", then "Fill") selects F
 *   and its compatibility click does nothing in the bar: no panel, the same
 *   number of items.
 * E48@390x844 alice with a finger on a phone (the narrow layout): no
 *   [data-knorke-place], the bar stands at the top in the flow as before,
 *   stays visible while a finger drags N, and its panel opens below it.
 * Own board, no instance setting: before E09, directly after E46 (E47 is
 * job 136's). Flake gate: --only E48 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection, handles), [C] shell (bar, panel, focus, card), [B] stored
 * server state, [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, CANVAS, PHONE, TABLET, api, put, ulid, seedOps, itemMap, openBoard, waitReady, until, sleep, canvasFocused, settle } from '../lib/harness.mjs'

const DESK = Object.freeze({ width: 1280, height: 800 })
const BAR = '.knorke-contextbar'
// job 230: the colour dot (Fill, Border and Text are tabs of its panel)
const FILL = `${BAR} [data-knorke-section=color]`
/** The radius of a handle for a finger (src/model/tokens.js HANDLE_TOUCH_PX). */
const HANDLE_TOUCH_PX = 22

/** One board per world for E48 and its passes (and E49 of factory job 139, sort.mjs). */
const boards = new WeakMap()

/** @return {Promise<number>} the board of this world's E48 (created once) */
export async function placeBoard(world) {
	if (!boards.has(world)) boards.set(world, world.board('E48 Leiste an der Auswahl'))
	return boards.get(world)
}

/** The edit link of a board (route 9 as alice). */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/**
 * Runs in the page: the bar, its panel and the room around it (client px).
 * No closure over Node values (page.evaluate serialises it).
 */
function measure() {
	const r = (el) => {
		if (!el) return null
		const b = el.getBoundingClientRect()
		return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }
	}
	const shown = (el) => {
		if (!el) return false
		const cs = getComputedStyle(el)
		return cs.visibility !== 'hidden' && cs.display !== 'none'
	}
	const bar = document.querySelector('.knorke-contextbar')
	const panel = document.querySelector('.knorke-contextbar__panel')
	const banners = document.querySelector('.knorke-banners')
	const card = document.querySelector('[data-knorke=privacy-info]')
	const bannersBox = banners && banners.getBoundingClientRect().height > 0 ? r(banners) : null
	const top = r(document.querySelector('[data-knorke-bar=top]'))
	return {
		bar: r(bar),
		exists: !!bar,
		place: bar ? bar.getAttribute('data-knorke-place') : null,
		hasPlace: !!bar && bar.hasAttribute('data-knorke-place'),
		shown: shown(bar),
		position: bar ? getComputedStyle(bar).position : null,
		board: r(document.querySelector('.knorke-board')),
		canvas: r(document.querySelector('.knorke-canvas')),
		top,
		banners: bannersBox,
		chrome: Math.max(top ? top.b : 0, bannersBox ? bannersBox.b : 0),
		card: r(card),
		panel: r(panel),
		panelSide: panel ? panel.getAttribute('data-knorke-panel-side') : null,
		hasPanelSide: !!panel && panel.hasAttribute('data-knorke-panel-side'),
		panelShown: shown(panel),
		focusInBar: !!bar && bar.contains(document.activeElement),
	}
}

/** The measurement of a page (measure() in it). */
const look = (page) => page.evaluate(measure)

/** Waits until the bar carries data-knorke-place = place; returns the last measurement. */
async function placed(page, place, timeout = 3000) {
	let m = null
	await until(async () => {
		m = await look(page)
		return m.place === place && (place === 'hidden' ? !m.shown : m.shown)
	}, { timeout })
	return m
}

/** Same ids, any order. */
const sameIds = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x))

/** Overlap of two client boxes along both axes (> 0.5 on both = they overlap). */
function overlaps(a, b, slack = 0.5) {
	if (!a || !b) return false
	const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x)
	const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y)
	return ox > slack && oy > slack
}

/** Distance of a point to a client box (0 inside). */
function distToBox(p, b) {
	const dx = Math.max(b.x - p.x, 0, p.x - b.r)
	const dy = Math.max(b.y - p.y, 0, p.y - b.b)
	return Math.hypot(dx, dy)
}

/** Is the canvas the element at this client point (no bar or card over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/**
 * Pans with the mouse wheel (no Ctrl, the stage Pan of job 154: pan by screen
 * px) until the world point (wx, wy) stands at the client point (sx, sy); the
 * wheel runs at `at`, a point on the bare canvas. Waits for the wheel's end.
 */
async function panTo(page, wx, wy, sx, sy, at) {
	for (let i = 0; i < 4; i++) {
		const p = await K.w2s(page, wx, wy)
		const dx = p.x - sx
		const dy = p.y - sy
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return true
		await page.mouse.move(at.x, at.y)
		await page.mouse.wheel(dx, dy)
		await sleep(350)
	}
	const p = await K.w2s(page, wx, wy)
	return Math.abs(p.x - sx) < 0.5 && Math.abs(p.y - sy) < 0.5
}

/** One finger down, held `hold` ms, up (CDP touch events, like a real finger). */
async function cdpTap(cdp, x, y, hold = 80) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
	await sleep(hold)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** The finger that is down moves from `a` to `b` in `steps` moves, one frame apart. */
async function cdpMoves(cdp, a, b, steps) {
	for (let i = 1; i <= steps; i++) {
		await sleep(16)
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }] })
	}
	await sleep(16)
}

/** Esc with the canvas focus: the selection goes (and with it the bar). */
async function deselect(page) {
	await page.locator(CANVAS).first().focus()
	await page.keyboard.press('Escape')
	await until(async () => ((await K.selection(page)) || []).length === 0, { timeout: 2000 })
}

/** Closes the one-time privacy card ([data-knorke=privacy-info]) when it is shown. */
async function closePrivacyCard(page) {
	const close = page.locator('[data-knorke=privacy-info] [data-knorke-action=privacy-close]').first()
	if (await until(() => close.isVisible().catch(() => false), { timeout: 1500 })) await close.click()
	await until(async () => (await page.locator('[data-knorke=privacy-info]').count()) === 0, { timeout: 2000 })
}

export const E48 = {
	id: 'E48',
	title: 'Kontextleiste an der Auswahl (Job 137, Maus 1280 × 800): über N mit 30 px Abstand zu den Griffen, Panel „Fill“ darüber, unsichtbar beim Ziehen und Schwenken, unter der TopBar „below“, am linken Rand ≥ 8 px, Frame bildfüllend „pinned“ bei T, aus dem Bild „hidden“ mit Entf und Strg+Z, Fokus von „Fill“ auf die Leinwand, bobs Hinweiskarte bleibt und wird nicht überdeckt',
	async run(t, world) {
		const board = await placeBoard(world)
		const [N, F] = [ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(N, { x: 0, y: 0, data: { text: 'N' } }),
			put.frame(F, { x: 3000, y: 0, w: 2000, h: 1400, data: { title: 'F' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N und Frame F', res)
		// the wheel pans in E48 and its tablet pass: the stage Pan (job 154)
		const alice = await world.actor('alice-leiste', { user: 'alice', viewport: DESK, wheel: 'pan' })
		const p = alice.page
		let bob = null
		try {
			// N at (540, 430) in the board: room above for the bar and for the "Fill" panel
			await storeCamera(p, board, { x: -540, y: -430, scale: 1 })
			await openBoard(alice, board)
			await K.waitIdle(p)
			await desktop(t, p, { N, F })
			t.step('(7) bob (Link-Mitglied) mit Hinweiskarte wählt N')
			const L = await linkToken(board)
			bob = await world.actor('bob-leiste', { user: 'bob', viewport: DESK, wheel: 'pan' })
			await bob.page.goto(`${APP}/p/${L}`, { waitUntil: 'domcontentloaded' })
			await waitReady(bob.page, 30000)
			await settle([p, bob.page])
			await card(t, bob.page, N)
		} finally {
			await world.drop(bob)
			await world.drop(alice)
		}
	},
}

/** Steps (1)–(6) of E48 (header). */
async function desktop(t, p, { N, F }) {
	t.step('(1) Klick auf N')
	let m = await look(p)
	const B = m.board
	t.must(!!B && B.w > 900, '[D] das Board ist breit (kein Schmal-Layout)', B)
	// a point on the bare canvas at the bottom left for the wheel (away from N, bar, toolbar and zoom)
	const wheelAt = { x: B.x + 180, y: B.b - 60 }
	t.must(await canvasAt(p, wheelAt.x, wheelAt.y), '[D] der Punkt fürs Mausrad liegt frei auf der Leinwand', wheelAt)
	const rn = await K.rect(p, N)
	t.must(!!rn && Math.abs(rn.x - (B.x + 540)) < 1 && Math.abs(rn.y - (B.y + 430)) < 1, '[D] N steht bei (540, 430) im Board (gespeicherte Kamera)', { rn, B })
	await p.mouse.click(rn.x + rn.w / 2, rn.y + rn.h / 2)
	t.must(await until(async () => sameIds((await K.selection(p)) || [], [N]), { timeout: 2000 }), '[S] (1) N ist gewählt', await K.selection(p))
	m = await placed(p, 'above')
	t.check(m.place === 'above' && m.shown, '[C] (1) die Leiste steht „above“ und ist sichtbar', { place: m.place, shown: m.shown, bar: m.bar })
	const hs = (await K.handles(p)) || []
	const topHandle = Math.min(...hs.map((h) => h.y))
	t.check(hs.length > 0 && m.bar && m.bar.b <= topHandle - 30 + 0.5, '[C] (1) die Unterkante der Leiste liegt mindestens 30 px über dem obersten Griff', { unterkante: m.bar?.b, obersterGriff: topHandle, griffe: hs.map((h) => h.name) })
	t.check(m.bar && Math.abs(m.bar.x + m.bar.w / 2 - (rn.x + rn.w / 2)) <= 1, '[C] (1) die Mitte der Leiste steht über der Mitte von N (±1)', { leiste: m.bar && m.bar.x + m.bar.w / 2, n: rn.x + rn.w / 2 })

	t.step('(2) „Fill“ öffnet das Panel')
	await p.locator(FILL).first().click()
	await until(async () => (await look(p)).panelSide !== null, { timeout: 3000 })
	m = await look(p)
	t.check(m.panelSide === 'above' && m.panelShown, '[C] (2) das Panel trägt data-knorke-panel-side="above" und ist sichtbar', { side: m.panelSide, shown: m.panelShown })
	t.check(!!m.panel && m.panel.b <= m.bar.y + 0.5, '[C] (2) das Panel liegt ganz über der Leiste', { panel: m.panel, bar: m.bar })
	const C = m.canvas
	t.check(!!m.panel && m.panel.x >= C.x - 0.5 && m.panel.r <= C.r + 0.5 && m.panel.y >= C.y - 0.5 && m.panel.b <= C.b + 0.5, '[C] (2) das Panel liegt in der Leinwand', { panel: m.panel, canvas: C })
	await p.locator(FILL).first().click()
	t.must(await until(async () => (await p.locator('[data-knorke-panel]').count()) === 0, { timeout: 2000 }), '[D] (2) das Panel ist wieder zu')

	t.step('(3) N ziehen, mit der mittleren Taste schwenken')
	const c0 = { x: rn.x + rn.w / 2, y: rn.y + rn.h / 2 }
	await p.mouse.move(c0.x, c0.y)
	await p.mouse.down()
	for (let i = 1; i <= 6; i++) {
		await p.mouse.move(c0.x + 15 * i, c0.y + 3 * i)
		await sleep(16)
	}
	m = await look(p)
	t.check(m.place === 'hidden' && !m.shown, '[C] (3) beim Ziehen ist die Leiste unsichtbar', { place: m.place, shown: m.shown })
	for (let i = 7; i <= 10; i++) {
		await p.mouse.move(c0.x + 15 * i, c0.y + 3 * i)
		await sleep(16)
	}
	await p.mouse.up()
	m = await placed(p, 'above')
	let r1 = await K.rect(p, N)
	t.check(m.place === 'above' && m.shown && Math.abs(m.bar.x + m.bar.w / 2 - (r1.x + r1.w / 2)) <= 1, '[C] (3) nach dem Ziehen steht die Leiste „above“ über N an der neuen Stelle', { place: m.place, leiste: m.bar && m.bar.x + m.bar.w / 2, n: r1.x + r1.w / 2 })
	await p.mouse.move(wheelAt.x, wheelAt.y)
	await p.mouse.down({ button: 'middle' })
	for (let i = 1; i <= 6; i++) {
		await p.mouse.move(wheelAt.x - 12 * i, wheelAt.y - 4 * i)
		await sleep(16)
	}
	m = await look(p)
	t.check(m.place === 'hidden' && !m.shown, '[C] (3) beim Schwenken mit der mittleren Taste ist die Leiste unsichtbar', { place: m.place, shown: m.shown })
	await p.mouse.up({ button: 'middle' })
	m = await placed(p, 'above')
	r1 = await K.rect(p, N)
	t.check(m.place === 'above' && m.shown && Math.abs(m.bar.x + m.bar.w / 2 - (r1.x + r1.w / 2)) <= 1, '[C] (3) nach dem Schwenken steht die Leiste „above“ über N', { place: m.place, leiste: m.bar && m.bar.x + m.bar.w / 2, n: r1.x + r1.w / 2 })

	t.step('(4) N dicht unter der TopBar, halb über den linken Rand; Frame bildfüllend')
	const T = m.chrome + 8
	const n0 = (await itemMap(p)).get(N)
	t.must(await panTo(p, n0.x, n0.y, B.x + 540, T + 20, wheelAt), '[D] (4) N steht 20 px unter T', { T, n: await K.rect(p, N) })
	m = await placed(p, 'below')
	t.check(m.place === 'below' && m.shown, '[C] (4) N dicht unter der TopBar: die Leiste steht „below“', { place: m.place, bar: m.bar, T })
	t.must(await panTo(p, n0.x, n0.y, B.x - 100, B.y + 300, wheelAt), '[D] (4) N steht halb über dem linken Rand', await K.rect(p, N))
	m = await until(async () => {
		const x = await look(p)
		return x.shown && x.place !== 'hidden' ? x : null
	}, { timeout: 3000 })
	t.check(!!m && m.bar.x - B.x >= 8 - 0.5, '[C] (4) N halb über dem linken Rand: die Leiste beginnt mindestens 8 px im Board', { links: m && m.bar.x - B.x, place: m && m.place })
	// F fills the view: its body from 100 px below the board's top, its title band above that
	t.must(await panTo(p, 3000, 0, B.x - 100, B.y + 100, wheelAt), '[D] (4) F füllt den Ausschnitt', await K.rect(p, F))
	await placed(p, 'hidden')
	const title = await K.w2s(p, 3700, -21)
	t.must(await canvasAt(p, title.x, title.y), '[D] (4) das Titelband von F liegt frei auf der Leinwand', title)
	await p.mouse.click(title.x, title.y)
	t.must(await until(async () => sameIds((await K.selection(p)) || [], [F]), { timeout: 2000 }), '[S] (4) ein Klick auf das Titelband wählt F', await K.selection(p))
	m = await placed(p, 'pinned')
	const Tb = m.chrome + 8
	t.check(m.place === 'pinned' && m.shown && Math.abs(m.bar.y - Tb) <= 1, '[C] (4) Frame bildfüllend: die Leiste steht „pinned“ mit der Oberkante bei T (±1)', { place: m.place, oben: m.bar && m.bar.y, T: Tb })

	t.step('(5) N aus dem Bild: hidden, Entf löscht N, Strg+Z bringt N zurück')
	t.must(await panTo(p, n0.x + 100, n0.y + 100, B.x + 640, B.y + 500, wheelAt), '[D] (5) N steht wieder in der Mitte', await K.rect(p, N))
	r1 = await K.rect(p, N)
	await p.mouse.click(r1.x + r1.w / 2, r1.y + r1.h / 2)
	t.must(await until(async () => sameIds((await K.selection(p)) || [], [N]), { timeout: 2000 }), '[S] (5) N ist gewählt', await K.selection(p))
	await placed(p, 'above')
	await p.mouse.move(wheelAt.x, wheelAt.y)
	await p.mouse.wheel(0, 2000)
	await sleep(400)
	m = await placed(p, 'hidden')
	t.check(m.exists && m.place === 'hidden' && !m.shown, '[C] (5) N aus dem Bild: die Leiste ist „hidden“', { place: m.place, shown: m.shown, n: await K.rect(p, N) })
	t.check(sameIds((await K.selection(p)) || [], [N]), '[S] (5) die Auswahl bleibt', await K.selection(p))
	await p.locator(CANVAS).first().focus()
	await p.keyboard.press('Delete')
	t.check(await until(async () => !(await itemMap(p)).has(N), { timeout: 3000 }), '[C] (5) Entf löscht N')
	await p.keyboard.press('Control+z')
	t.check(await until(async () => (await itemMap(p)).has(N), { timeout: 3000 }), '[C] (5) Strg+Z bringt N zurück')

	t.step('(6) Fokus auf „Fill“, dann per Mausrad aus dem Bild')
	t.must(await panTo(p, n0.x + 100, n0.y + 100, B.x + 640, B.y + 500, wheelAt), '[D] (6) N steht wieder in der Mitte', await K.rect(p, N))
	r1 = await K.rect(p, N)
	await p.mouse.click(r1.x + r1.w / 2, r1.y + r1.h / 2)
	t.must(await until(async () => sameIds((await K.selection(p)) || [], [N]), { timeout: 2000 }), '[S] (6) N ist gewählt', await K.selection(p))
	await placed(p, 'above')
	await p.locator(FILL).first().focus()
	t.must((await look(p)).focusInBar, '[D] (6) der Fokus liegt auf „Fill“')
	await p.mouse.move(wheelAt.x, wheelAt.y)
	await p.mouse.wheel(0, 2000)
	await sleep(400)
	m = await placed(p, 'hidden')
	t.check(m.place === 'hidden' && await canvasFocused(p), '[C] (6) die Leiste ist verborgen, der Fokus liegt auf der Leinwand', { place: m.place, imLeiste: m.focusInBar, leinwand: await canvasFocused(p) })
}

/** Step (7) of E48 (header): bob's privacy card keeps its place, the bar does not cover it. */
async function card(t, pb, N) {
	const cardSel = '[data-knorke=privacy-info]'
	t.must(await until(() => pb.locator(cardSel).first().isVisible().catch(() => false), { timeout: 5000 }), '[D] (7) bob sieht die Hinweiskarte')
	await sleep(300)
	const before = (await look(pb)).card
	const B = (await look(pb)).board
	const wheelAt = { x: B.x + 180, y: B.b - 60 }
	const n = (await itemMap(pb)).get(N)
	t.must(!!n, '[D] (7) bob kennt N')
	// N right under the card, where a bar above N would reach into the card
	t.must(await panTo(pb, n.x + 100, n.y, B.x + B.w / 2, before.b + 30, wheelAt), '[D] (7) N steht dicht unter der Karte', { n: await K.rect(pb, N), card: before })
	const rn = await K.rect(pb, N)
	const at = { x: rn.x + rn.w / 2, y: Math.min(rn.y + rn.h / 2, B.b - 80) }
	t.must(await canvasAt(pb, at.x, at.y), '[D] (7) N liegt bei bob frei auf der Leinwand', at)
	await pb.mouse.click(at.x, at.y)
	t.must(await until(async () => sameIds((await K.selection(pb)) || [], [N]), { timeout: 2000 }), '[S] (7) bob hat N gewählt', await K.selection(pb))
	const m = await until(async () => {
		const x = await look(pb)
		return x.shown && x.place !== 'hidden' ? x : null
	}, { timeout: 3000 })
	t.must(!!m, '[C] (7) bobs Leiste ist sichtbar', await look(pb))
	const same = ['x', 'y', 'w', 'h'].every((k) => Math.abs(m.card[k] - before[k]) <= 0.5)
	t.check(same, '[C] (7) die Hinweiskarte behält ihr Rechteck (±0,5)', { vorher: before, nachher: m.card })
	t.check(!overlaps(m.bar, m.card), '[C] (7) die Leiste überlappt die Hinweiskarte nicht', { bar: m.bar, card: m.card, place: m.place })
	await closePrivacyCard(pb)
}

export const E48_TABLET = {
	id: 'E48',
	pass: `${TABLET.width}x${TABLET.height}`,
	title: `Kontextleiste an der Auswahl bei ${TABLET.width} × ${TABLET.height} mit dem Finger: ein Tipp auf N gibt „above“ ohne Überlappung mit einem Griffkreis von 22 px, beim Ziehen unsichtbar, danach wieder da; ein Tipp auf einen bildfüllenden Rahmen löst in der Leiste nichts aus`,
	async run(t, world) {
		const board = await placeBoard(world)
		const [N, F] = [ulid(), ulid()]
		// in a part of the world of its own (the passes share the board)
		const X = 20000
		const res = await seedOps('alice', board, [
			put.sticky(N, { x: X, y: 0, data: { text: 'N' } }),
			put.frame(F, { x: X + 3000, y: 0, w: 2000, h: 2000, data: { title: 'F' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N und Frame F', res)
		const a = await world.actor(`alice-leiste-${TABLET.width}`, { user: 'alice', touch: true, viewport: TABLET, fine: true, wheel: 'pan' })
		const p = a.page
		try {
			await storeCamera(p, board, { x: X - 310, y: -500, scale: 1 })
			await openBoard(a, board)
			await K.waitIdle(p)
			const st = await K.state(p)
			t.must(st.uiMode === 'edit', '[D] das Tablet ist im Modus edit (Touch mit feinem Zeiger, wie E39)', { uiMode: st.uiMode })
			const cdp = await a.ctx.newCDPSession(p)
			await tablet(t, p, cdp, { N, F, X })
		} finally {
			await world.drop(a)
		}
	},
}

/** The tablet pass of E48 (header). */
async function tablet(t, p, cdp, { N, F, X }) {
	t.step('Tipp auf N')
	let m = await look(p)
	const B = m.board
	const rn = await K.rect(p, N)
	const c0 = { x: Math.round(rn.x + rn.w / 2), y: Math.round(rn.y + rn.h / 2) }
	t.must(await canvasAt(p, c0.x, c0.y), '[D] die Mitte von N liegt frei auf der Leinwand', c0)
	await cdpTap(cdp, c0.x, c0.y)
	t.must(await until(async () => sameIds((await K.selection(p)) || [], [N]), { timeout: 3000 }), '[S] ein Tipp auf N wählt N', await K.selection(p))
	m = await placed(p, 'above')
	t.check(m.place === 'above' && m.shown, '[C] die Leiste steht „above“', { place: m.place, bar: m.bar })
	const hs = (await K.handles(p)) || []
	const near = hs.filter((h) => distToBox(h, m.bar) < HANDLE_TOUCH_PX - 0.5)
	t.check(hs.length > 0 && near.length === 0, `[C] kein Griffkreis von ${HANDLE_TOUCH_PX} px überlappt die Leiste`, { zuNah: near, bar: m.bar, griffe: hs.length })

	t.step('Ziehen mit dem Finger')
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c0.x, y: c0.y }] })
	await cdpMoves(cdp, c0, { x: c0.x + 60, y: c0.y + 30 }, 6)
	m = await look(p)
	t.check(m.place === 'hidden' && !m.shown, '[C] beim Ziehen mit dem Finger ist die Leiste unsichtbar', { place: m.place, shown: m.shown })
	await cdpMoves(cdp, { x: c0.x + 60, y: c0.y + 30 }, { x: c0.x + 100, y: c0.y + 50 }, 4)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
	m = await placed(p, 'above')
	const r1 = await K.rect(p, N)
	t.check(m.place === 'above' && m.shown && Math.abs(r1.x - rn.x - 100) <= 2, '[C] danach ist die Leiste wieder da („above“), N wurde gezogen', { place: m.place, dx: r1.x - rn.x })
	const barH = m.bar.h

	t.step('Tipp auf einen bildfüllenden Rahmen')
	await deselect(p)
	await until(async () => !(await look(p)).exists, { timeout: 2000 })
	const T = (await look(p)).chrome + 8
	// F's title band (42 px high at 100 %) centred where the pinned bar's middle will be
	const wheelAt = { x: B.x + B.w / 2, y: B.b - 200 }
	const y0 = T + barH / 2
	t.must(await panTo(p, X + 3000, -21, B.x - 300, y0, wheelAt), '[D] das Titelband von F liegt unter der künftigen Leiste, F füllt den Ausschnitt', { T, barH, f: await K.rect(p, F) })
	const count0 = (await itemMap(p)).size
	const tapAndCheck = async (pt, what) => {
		await cdpTap(cdp, Math.round(pt.x), Math.round(pt.y))
		// selected, or deleted by a compatibility click on "Delete"
		await until(async () => sameIds((await K.selection(p)) || [], [F]) || !(await itemMap(p)).has(F), { timeout: 3000 })
		// the compatibility click of the tap comes right after touchend
		await sleep(500)
		const items = await itemMap(p)
		const panels = await p.locator('[data-knorke-panel]').count()
		t.check(panels === 0 && items.size === count0 && items.has(F), `[C] ${what}: der Tipp löst in der Leiste nichts aus (kein Panel, ${count0} Elemente, F da)`, { panel: panels, items: items.size, f: items.has(F) })
		t.must(sameIds((await K.selection(p)) || [], [F]), `[S] ${what}: der Tipp wählt F`, await K.selection(p))
		const x = await look(p)
		t.check(x.place === 'pinned' && x.shown, `[C] ${what}: die Leiste steht „pinned“`, { place: x.place, bar: x.bar, tap: pt })
		return x
	}
	const first = await tapAndCheck({ x: B.x + B.w / 2, y: y0 }, 'Mitte')
	// job 230: "…" (Delete is one of its entries) and the colour dot
	const del = await p.locator(`${BAR} [data-knorke-menu=selection] button`).first().boundingBox()
	const fill = await p.locator(FILL).first().boundingBox()
	t.must(!!del && !!fill && first.bar && del.y >= first.bar.y && fill.y >= first.bar.y, '[D] „…“ und der Farbpunkt stehen in der Leiste', { del, fill })
	for (const [box, what] of [[del, '„…“'], [fill, 'des Farbpunkts']]) {
		await deselect(p)
		await until(async () => !(await look(p)).exists, { timeout: 2000 })
		await tapAndCheck({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, `an der Stelle von ${what}`)
	}
}

export const E48_PHONE = {
	id: 'E48',
	pass: `${PHONE.width}x${PHONE.height}`,
	title: `Kontextleiste bei ${PHONE.width} × ${PHONE.height} mit dem Finger wie bisher: kein data-knorke-place, oben im Stapel, beim Ziehen sichtbar, das Panel öffnet darunter`,
	async run(t, world) {
		const board = await placeBoard(world)
		const N = ulid()
		const X = 40000
		const res = await seedOps('alice', board, [put.sticky(N, { x: X, y: 0, data: { text: 'N' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N', res)
		const a = await world.actor(`alice-leiste-${PHONE.width}`, { user: 'alice', touch: true, viewport: PHONE, fine: true })
		const p = a.page
		try {
			await storeCamera(p, board, { x: X - 95, y: -400, scale: 1 })
			await openBoard(a, board)
			await K.waitIdle(p)
			const st = await K.state(p)
			t.must(st.uiMode === 'edit', '[D] das Handy ist im Modus edit (Touch mit feinem Zeiger, wie E39)', { uiMode: st.uiMode })
			const cdp = await a.ctx.newCDPSession(p)
			const rn = await K.rect(p, N)
			const c0 = { x: Math.round(rn.x + rn.w / 2), y: Math.round(rn.y + rn.h / 2) }
			t.must(await canvasAt(p, c0.x, c0.y), '[D] die Mitte von N liegt frei auf der Leinwand', c0)
			t.step('Tipp auf N')
			await cdpTap(cdp, c0.x, c0.y)
			t.must(await until(async () => sameIds((await K.selection(p)) || [], [N]), { timeout: 3000 }), '[S] ein Tipp auf N wählt N', await K.selection(p))
			t.must(await until(async () => (await look(p)).shown, { timeout: 3000 }), '[C] die Leiste ist sichtbar')
			let m = await look(p)
			t.check(!m.hasPlace, '[C] die Leiste trägt kein data-knorke-place', { place: m.place })
			t.check(m.position === 'relative' && m.bar.y - m.board.y <= Math.max(120, (m.banners ? m.banners.b - m.board.y : 0) + 60), '[C] die Leiste steht oben im Stapel wie bisher (im Fluss)', { position: m.position, oben: m.bar.y - m.board.y })
			t.step('Ziehen mit dem Finger')
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c0.x, y: c0.y }] })
			await cdpMoves(cdp, c0, { x: c0.x + 30, y: c0.y + 40 }, 6)
			m = await look(p)
			t.check(m.shown, '[C] beim Ziehen bleibt die Leiste sichtbar', { shown: m.shown, place: m.place })
			await cdpMoves(cdp, { x: c0.x + 30, y: c0.y + 40 }, { x: c0.x + 40, y: c0.y + 60 }, 3)
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
			await K.waitIdle(p)
			t.step('Panel „Fill“')
			await p.locator(FILL).first().tap()
			t.must(await until(async () => (await look(p)).panelShown, { timeout: 3000 }), '[C] „Fill“ öffnet das Panel')
			m = await look(p)
			t.check(!m.hasPanelSide && m.panel.y >= m.bar.b - 0.5, '[C] das Panel öffnet unter der Leiste, ohne data-knorke-panel-side', { panel: m.panel, bar: m.bar, side: m.panelSide })
		} finally {
			await world.drop(a)
		}
	},
}
