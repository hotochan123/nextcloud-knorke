/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Right-drag pans (factory job 156).
 *
 * E57 alice (owner, Chromium 1440 × 900) on a board of her own with note N
 * at (0, 0), 200 × 200, opened at 100 % with world (0, 0) 600 px right of
 * and 300 px below the canvas corner. Only real input (page.mouse with
 * button 'right'); Chromium on Linux sends the contextmenu event at the
 * press, before the pointerup. Steps:
 *   (1) mode edit: a right-drag from N's centre by (−200, −100) in 10
 *       steps moves the camera by (200, 100) (±2) at 100 %; N stays where it
 *       is, locally and on the server; the selection stays empty; 400 ms
 *       after the release there is no [data-knorke-menu=context]; every
 *       contextmenu was defaultPrevented;
 *   (2) the right button pressed on N without moving: after 300 ms still no
 *       menu (its contextmenu came before the pointerup); after the release
 *       exactly one menu with target N, data-knorke-menu-at = the release
 *       point minus the canvas corner (±1); Esc closes it;
 *   (3) mode vote (a session over route 22): a right-drag pans the same; a
 *       right click on N opens no menu and gives no vote (votes().mine
 *       without N); every contextmenu was defaultPrevented.
 * Own board, no instance setting: before E09, after E55.
 * Flake gate: --only E57 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (camera, selection, intent, contextmenu), [C] shell and session (menu,
 * mode, votes), [B] a server answer or stored server state, [D] a harness
 * precondition. Waiting polls from Node with until() (Nextcloud's CSP,
 * ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, centerOf, until, sleep } from '../lib/harness.mjs'

/** The camera alice opens with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** The way of every right-drag (screen px). */
const WAY = Object.freeze({ x: -200, y: -100 })
const MENU = '[data-knorke-menu=context]'

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Is the canvas the element at this client point (no bar over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/**
 * Records, on window in the bubbling phase (after the app's own listener), every contextmenu
 * with its defaultPrevented and the order of pointerdown, contextmenu and pointerup.
 */
const watchInput = (page) => page.evaluate(() => {
	if (window.__e57) return
	window.__e57 = { events: [], order: [] }
	window.addEventListener('contextmenu', (e) => window.__e57.events.push({ dp: e.defaultPrevented, tag: e.target?.tagName ?? null }))
	for (const type of ['pointerdown', 'contextmenu', 'pointerup']) {
		window.addEventListener(type, () => window.__e57.order.push(type), { capture: true })
	}
}).catch(() => {})

const inputLog = (page) => page.evaluate(() => window.__e57 ?? { events: [], order: [] }).catch(() => ({ events: [], order: [] }))
const inputReset = (page) => page.evaluate(() => { if (window.__e57) { window.__e57.events = []; window.__e57.order = [] } }).catch(() => {})

/** The open menus: {count, target, at}. */
const menuState = (page) => page.evaluate((sel) => {
	const all = [...document.querySelectorAll(sel)]
	return { count: all.length, target: all[0]?.getAttribute('data-knorke-menu-target') ?? null, at: all[0]?.getAttribute('data-knorke-menu-at') ?? null }
}, MENU).catch(() => ({ count: 0 }))

/** A right-drag (real input) from p by WAY in 10 steps; the camera before and after. */
async function rightDrag(page, p) {
	const before = await K.camera(page)
	await page.mouse.move(p.x, p.y)
	await page.mouse.down({ button: 'right' })
	await page.mouse.move(p.x + WAY.x, p.y + WAY.y, { steps: 10 })
	await page.mouse.up({ button: 'right' })
	await sleep(150)
	return { before, after: await K.camera(page) }
}

/** Did the camera move by −WAY / scale (±2 px on screen)? */
const panned = (c) => !!c.before && !!c.after && Math.abs(c.after.scale - c.before.scale) < 1e-9 &&
	Math.abs((c.after.x - c.before.x) * c.before.scale + WAY.x) <= 2 && Math.abs((c.after.y - c.before.y) * c.before.scale + WAY.y) <= 2

export const E57 = {
	id: 'E57',
	title: 'Rechts-Ziehen schwenkt (Job 156): im Modus edit verschiebt Rechts-Ziehen von Notiz N die Kamera um (200, 100), N bleibt liegen, keine Auswahl, kein Menü; ein Rechtsklick öffnet das Menü erst beim Loslassen, am Punkt des Loslassens; im Modus vote schwenkt Rechts-Ziehen auch, ein Rechtsklick öffnet nichts und stimmt nicht ab',
	async run(t, world) {
		const board = await world.board('E57 Rechts-Ziehen')
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, w: 200, h: 200, data: { text: 'N' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N gesät', res)
		const a = await world.actor('alice-rightdrag', { user: 'alice' })
		const pa = a.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			const cam0 = await K.camera(pa)
			t.must(Math.abs(cam0.scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', cam0)
			await watchInput(pa)
			const box = await pa.locator(CANVAS).first().boundingBox()

			t.step('(1) Modus edit: Rechts-Ziehen von N um (−200, −100)')
			const p1 = await centerOf(pa, N)
			t.must(await canvasAt(pa, p1.x, p1.y) && await canvasAt(pa, p1.x + WAY.x, p1.y + WAY.y), '[D] Vorbedingung: Anfang und Ende des Wegs liegen frei auf der Leinwand', p1)
			await inputReset(pa)
			const c1 = await rightDrag(pa, p1)
			t.check(panned(c1), '[S] (1) die Kamera verschiebt sich um (200, 100) (±2 px), der Maßstab bleibt', c1)
			const local1 = (await itemMap(pa)).get(N)
			t.check(local1?.x === 0 && local1?.y === 0, '[S] (1) N liegt lokal unverändert bei (0, 0)', local1 && { x: local1.x, y: local1.y })
			t.check(JSON.stringify(await K.selection(pa)) === '[]', '[S] (1) die Auswahl bleibt leer', await K.selection(pa))
			await sleep(400)
			t.check((await menuState(pa)).count === 0, '[S] (1) 400 ms nach dem Loslassen kein [data-knorke-menu=context]', await menuState(pa))
			const log1 = await inputLog(pa)
			t.check(log1.events.length >= 1 && log1.events.every((e) => e.dp === true), '[S] (1) jedes contextmenu war defaultPrevented', log1.events)
			await K.waitIdle(pa, 8000).catch(() => {})
			const srv1 = (await serverMap('alice', board)).get(N)
			t.check(srv1?.x === 0 && srv1?.y === 0, '[B] (1) N liegt auf dem Server unverändert bei (0, 0)', srv1 && { x: srv1.x, y: srv1.y })

			t.step('(2) Rechte Taste auf N ohne Bewegen: das Menü erst beim Loslassen')
			const p2 = await centerOf(pa, N)
			t.must(await canvasAt(pa, p2.x, p2.y), '[D] Vorbedingung: N liegt frei auf der Leinwand', p2)
			await inputReset(pa)
			await pa.mouse.move(p2.x, p2.y)
			await pa.mouse.down({ button: 'right' })
			await sleep(300)
			const held = await menuState(pa)
			const early = await inputLog(pa)
			t.check(early.order.includes('contextmenu') && !early.order.includes('pointerup'), '[D] (2) Chromium unter Linux schickt das contextmenu schon beim Drücken', early.order)
			t.check(held.count === 0, '[S] (2) nach 300 ms gedrückt noch kein Menü', held)
			await pa.mouse.up({ button: 'right' })
			const opened = await until(async () => ((await menuState(pa)).count > 0 ? menuState(pa) : null), { timeout: 3000 })
			await sleep(300)
			const m2 = await menuState(pa)
			t.check(!!opened && m2.count === 1 && m2.target === N, '[S] (2) nach dem Loslassen genau ein Menü mit Ziel N', m2)
			const at = typeof m2.at === 'string' ? m2.at.split(',').map(Number) : null
			const want = [p2.x - box.x, p2.y - box.y]
			t.check(!!at && Math.abs(at[0] - want[0]) <= 1 && Math.abs(at[1] - want[1]) <= 1, '[S] (2) data-knorke-menu-at = Punkt des Loslassens − Leinwand-Ecke (±1)', { at: m2.at, want })
			const log2 = await inputLog(pa)
			t.check(log2.events.length >= 1 && log2.events.every((e) => e.dp === true), '[S] (2) jedes contextmenu war defaultPrevented', log2.events)
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await menuState(pa)).count === 0, { timeout: 2000 }), '[C] (2) Esc schließt das Menü')

			t.step('(3) Modus vote (Route 22): Rechts-Ziehen schwenkt, ein Rechtsklick öffnet nichts und stimmt nicht ab')
			const vs = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
			t.must(vs.status === 200, '[B] (3) Route 22 → 200', vs.text.slice(0, 200))
			let mode = await until(async () => ((await K.state(pa)).uiMode === 'vote' ? 'vote' : null), { timeout: 5000 })
			if (!mode) {
				await pa.locator('[data-knorke-action=vote-mode]').first().click().catch(() => {})
				mode = await until(async () => ((await K.state(pa)).uiMode === 'vote' ? 'vote' : null), { timeout: 3000 })
				t.note('(3) alice war nach dem Start nicht im Modus vote; vote-mode geklickt')
			}
			t.must(mode === 'vote', '[C] (3) Vorbedingung: alice im Modus vote', await K.state(pa))
			t.must(await until(async () => { const v = await K.votes(pa); return v && v !== 'missing' && v.sid ? v : null }, { timeout: 5000 }), '[C] (3) Vorbedingung: votes() mit der offenen Sitzung', await K.votes(pa))
			const p3 = await centerOf(pa, N)
			t.must(await canvasAt(pa, p3.x, p3.y) && await canvasAt(pa, p3.x + WAY.x, p3.y + WAY.y), '[D] Vorbedingung: Anfang und Ende des Wegs liegen frei auf der Leinwand', p3)
			await inputReset(pa)
			const c3 = await rightDrag(pa, p3)
			t.check(panned(c3), '[S] (3) Rechts-Ziehen schwenkt auch im Modus vote: Kamera um (200, 100) (±2 px)', c3)
			const p3b = await centerOf(pa, N)
			t.must(await canvasAt(pa, p3b.x, p3b.y), '[D] Vorbedingung: N liegt nach dem Schwenken frei auf der Leinwand', p3b)
			await pa.mouse.move(p3b.x, p3b.y)
			await pa.mouse.click(p3b.x, p3b.y, { button: 'right' })
			await sleep(500)
			t.check((await menuState(pa)).count === 0, '[S] (3) Rechtsklick auf N im Modus vote: kein Menü', await menuState(pa))
			await K.waitIdle(pa, 8000).catch(() => {})
			const v3 = await K.votes(pa)
			t.check(!!v3 && v3 !== 'missing' && (v3.mine?.[N] ?? 0) === 0, '[C] (3) keine Stimme: votes().mine ohne N', v3 && v3.mine)
			const log3 = await inputLog(pa)
			t.check(log3.events.length >= 2 && log3.events.every((e) => e.dp === true), '[S] (3) jedes contextmenu war defaultPrevented', log3.events)
		} finally {
			await world.drop(a)
		}
	},
}
