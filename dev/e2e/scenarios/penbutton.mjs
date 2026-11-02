/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The pen's side button pans, the editor stays open during a right-drag
 * (factory job 168).
 *
 * E60 alice (owner, Chromium 1440 × 900) on a board of her own with an empty
 * note N at (0, 0), 200 × 200, opened at 100 % with world (0, 0) 600 px right
 * of and 300 px below the canvas corner. Only real input: page.mouse and
 * page.keyboard, the pen through CDP Input.dispatchMouseEvent with
 * pointerType 'pen' and button 'right' (the side button). Every right-drag
 * starts at BESIDE (free canvas right of and below N's editor) and goes by
 * (−200, −100) in 10 steps. Steps:
 *   (1) a double click on N, "abc" typed, ← twice; a mouse right-drag beside
 *       the editor: the camera moves by (200, 100) (±2); the text field is
 *       there and focused with "abc" and the caret at 1 (selectionStart =
 *       selectionEnd = 1); its box moved by (−200, −100) (±2); 400 ms after
 *       the release no [data-knorke-menu=context]; typing "X" gives "aXbc";
 *   (2) the same with the pen (precondition [D]: the recorded pointerdown is
 *       pointerType pen, button 2): it pans, the editor stays open with
 *       "aXbc", the caret at 2;
 *   (3) a mouse right click beside the editor without moving: the editor
 *       closes, the server has "aXbc" for N (after waitIdle), exactly one menu
 *       with data-knorke-menu-at = the release point minus the canvas corner
 *       (±1); Esc closes it;
 *   (4) a pen right click on N: exactly one menu with target N at the release
 *       point; Esc closes it.
 * Every contextmenu is defaultPrevented. Own board, no instance setting:
 * before E09, after E59 (job 158's).
 * Flake gate: --only E60 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (camera, editor, focus, intent, contextmenu), [C] shell (menu), [B] a
 * server answer or stored server state, [D] a harness precondition. Waiting
 * polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, serverMap, openBoard, centerOf, until, sleep } from '../lib/harness.mjs'

/** The camera alice opens with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Where every right-drag and the right click of (3) start, canvas px: free canvas beside N's editor. */
const BESIDE = Object.freeze({ x: 1100, y: 600 })
/** The way of every right-drag (screen px). */
const WAY = Object.freeze({ x: -200, y: -100 })
const MENU = '[data-knorke-menu=context]'
const EDITOR = 'textarea[data-knorke-editor]'

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Is the canvas the element at this client point (no bar, no editor over it)? */
function canvasAt(page, p) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel) && el.tagName !== 'TEXTAREA')
	}, [p.x, p.y, CANVAS]).catch(() => false)
}

/**
 * Records, on window (capture for the order, bubbling for defaultPrevented after the app's own
 * listener), every pointerdown with its pointerType and button, and every contextmenu.
 */
const watchInput = (page) => page.evaluate(() => {
	if (window.__e60) return
	window.__e60 = { downs: [], menus: [] }
	window.addEventListener('pointerdown', (e) => window.__e60.downs.push({ type: e.pointerType, button: e.button }), { capture: true })
	window.addEventListener('contextmenu', (e) => window.__e60.menus.push({ dp: e.defaultPrevented, type: e.pointerType ?? null }))
}).catch(() => {})

const inputLog = (page) => page.evaluate(() => window.__e60 ?? { downs: [], menus: [] }).catch(() => ({ downs: [], menus: [] }))
const inputReset = (page) => page.evaluate(() => { if (window.__e60) { window.__e60.downs = []; window.__e60.menus = [] } }).catch(() => {})

/** The open menus: {count, target, at}. */
const menuState = (page) => page.evaluate((sel) => {
	const all = [...document.querySelectorAll(sel)]
	return { count: all.length, target: all[0]?.getAttribute('data-knorke-menu-target') ?? null, at: all[0]?.getAttribute('data-knorke-menu-at') ?? null }
}, MENU).catch(() => ({ count: 0 }))

/** The text field: {value, focused, start, end, x, y} (its box in client px), null without one. */
const fieldState = (page) => page.evaluate((sel) => {
	const ta = document.querySelector(sel)
	if (!ta) return null
	const r = ta.getBoundingClientRect()
	return { value: ta.value, focused: document.activeElement === ta, start: ta.selectionStart, end: ta.selectionEnd, x: r.x, y: r.y }
}, EDITOR).catch(() => null)

/** A mouse right-drag (real input) from p by WAY in 10 steps; the camera before and after. */
async function mouseDrag(page, p) {
	const before = await K.camera(page)
	await page.mouse.move(p.x, p.y)
	await page.mouse.down({ button: 'right' })
	await page.mouse.move(p.x + WAY.x, p.y + WAY.y, { steps: 10 })
	await page.mouse.up({ button: 'right' })
	await sleep(150)
	return { before, after: await K.camera(page) }
}

/**
 * The pen with its side button (CDP Input.dispatchMouseEvent, pointerType 'pen', button 'right'):
 * hovers to `from`, presses, moves to `to` in `steps` steps (none: a click) and lifts.
 */
async function penRight(cdp, from, to = from, steps = 0) {
	const send = (type, p, extra) => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, pointerType: 'pen', ...extra })
	await send('mouseMoved', from, { button: 'none', buttons: 0 })
	await send('mousePressed', from, { button: 'right', buttons: 2, clickCount: 1 })
	for (let i = 1; i <= steps; i++) {
		await send('mouseMoved', { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }, { button: 'right', buttons: 2 })
	}
	await send('mouseReleased', to, { button: 'right', buttons: 0, clickCount: 1 })
}

/** Did the camera move by −WAY / scale (±2 px on screen)? */
const panned = (c) => !!c.before && !!c.after && Math.abs(c.after.scale - c.before.scale) < 1e-9 &&
	Math.abs((c.after.x - c.before.x) * c.before.scale + WAY.x) <= 2 && Math.abs((c.after.y - c.before.y) * c.before.scale + WAY.y) <= 2

/** Did the text field's box move by WAY (±2 px)? */
const moved = (a, b) => !!a && !!b && Math.abs(b.x - a.x - WAY.x) <= 2 && Math.abs(b.y - a.y - WAY.y) <= 2

export const E60 = {
	id: 'E60',
	title: 'Seitentaste des Stifts schwenkt, der Editor bleibt beim Rechts-Ziehen offen (Job 168): Rechts-Ziehen mit Maus und Stift neben dem Editor schwenkt, Textfeld, Text und Cursor bleiben, Tippen geht weiter; ein Rechtsklick daneben speichert und öffnet das Menü beim Loslassen; ein Stift-Rechtsklick auf N öffnet das Menü für N',
	async run(t, world) {
		const board = await world.board('E60 Seitentaste')
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, w: 200, h: 200, data: { text: '' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: leere Notiz N gesät', res)
		const a = await world.actor('alice-penbutton', { user: 'alice' })
		const pa = a.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			const cam0 = await K.camera(pa)
			t.must(Math.abs(cam0.scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', cam0)
			await watchInput(pa)
			const cdp = await a.ctx.newCDPSession(pa)
			const box = await pa.locator(CANVAS).first().boundingBox()
			const beside = { x: box.x + BESIDE.x, y: box.y + BESIDE.y }
			const end = { x: beside.x + WAY.x, y: beside.y + WAY.y }

			t.step('(1) Editor von N offen, „abc“, Cursor bei 1; Rechts-Ziehen mit der Maus daneben')
			const pN = await centerOf(pa, N)
			await pa.mouse.dblclick(pN.x, pN.y)
			t.must(await until(async () => (await K.scene(pa))?.editing === N, { timeout: 3000 }), '[S] Vorbedingung: der Editor von N ist offen', await K.scene(pa))
			await pa.keyboard.type('abc', { delay: 20 })
			await pa.keyboard.press('ArrowLeft')
			await pa.keyboard.press('ArrowLeft')
			const f0 = await fieldState(pa)
			t.must(f0?.value === 'abc' && f0.focused && f0.start === 1 && f0.end === 1, '[D] Vorbedingung: Textfeld fokussiert, „abc“, Cursor bei 1', f0)
			t.must(await canvasAt(pa, beside) && await canvasAt(pa, end), '[D] Vorbedingung: Anfang und Ende des Wegs liegen frei auf der Leinwand', { beside, end })
			await inputReset(pa)
			const c1 = await mouseDrag(pa, beside)
			t.check(panned(c1), '[S] (1) die Kamera verschiebt sich um (200, 100) (±2 px)', c1)
			const f1 = await fieldState(pa)
			t.check(!!f1 && f1.focused && f1.value === 'abc' && f1.start === 1 && f1.end === 1, '[S] (1) das Textfeld ist da und fokussiert, „abc“, selectionStart = selectionEnd = 1', f1)
			t.check(moved(f0, f1), '[S] (1) seine Box hat sich um (−200, −100) verschoben (±2 px)', { f0, f1 })
			await sleep(400)
			t.check((await menuState(pa)).count === 0, '[C] (1) 400 ms nach dem Loslassen kein [data-knorke-menu=context]', await menuState(pa))
			const log1 = await inputLog(pa)
			t.check(log1.menus.every((e) => e.dp === true), '[S] (1) jedes contextmenu war defaultPrevented', log1.menus)
			await pa.keyboard.type('X')
			const f1b = await fieldState(pa)
			t.check(f1b?.value === 'aXbc', '[S] (1) „X“ tippen ergibt „aXbc“', f1b)

			t.step('(2) Dasselbe mit dem Stift (Seitentaste)')
			t.must(await canvasAt(pa, beside) && await canvasAt(pa, end), '[D] Vorbedingung: Anfang und Ende des Wegs liegen frei auf der Leinwand', { beside, end })
			await inputReset(pa)
			const before2 = await K.camera(pa)
			await penRight(cdp, beside, end, 10)
			await sleep(150)
			const c2 = { before: before2, after: await K.camera(pa) }
			const log2 = await inputLog(pa)
			const down2 = log2.downs[0] ?? null
			t.must(down2?.type === 'pen' && down2?.button === 2, '[D] (2) Vorbedingung: der aufgezeichnete pointerdown hat pointerType pen und button 2', log2.downs)
			t.check(panned(c2), '[S] (2) der Stift schwenkt die Kamera um (200, 100) (±2 px)', c2)
			const f2 = await fieldState(pa)
			t.check(!!f2 && f2.focused && f2.value === 'aXbc' && f2.start === 2 && f2.end === 2, '[S] (2) der Editor bleibt offen und fokussiert mit „aXbc“, Cursor bei 2', f2)
			t.check((await K.scene(pa))?.editing === N, '[S] (2) scene().editing ist weiter N', await K.scene(pa))
			t.check(log2.menus.every((e) => e.dp === true), '[S] (2) jedes contextmenu war defaultPrevented', log2.menus)

			t.step('(3) Rechtsklick mit der Maus neben dem Editor ohne Bewegen')
			t.must(await canvasAt(pa, beside), '[D] Vorbedingung: der Punkt liegt frei auf der Leinwand', beside)
			await inputReset(pa)
			await pa.mouse.move(beside.x, beside.y)
			await pa.mouse.down({ button: 'right' })
			await pa.mouse.up({ button: 'right' })
			const closed = await until(async () => ((await K.scene(pa))?.editing ?? null) === null && (await fieldState(pa)) === null, { timeout: 3000 })
			t.check(!!closed, '[S] (3) der Editor schließt', { scene: await K.scene(pa), field: await fieldState(pa) })
			await K.waitIdle(pa, 8000).catch(() => {})
			const srv3 = (await serverMap('alice', board)).get(N)
			t.check(srv3?.data?.text === 'aXbc', '[B] (3) der Server hat „aXbc“ für N', srv3?.data)
			const opened3 = await until(async () => ((await menuState(pa)).count > 0 ? menuState(pa) : null), { timeout: 3000 })
			await sleep(300)
			const m3 = await menuState(pa)
			const at3 = typeof m3.at === 'string' ? m3.at.split(',').map(Number) : null
			t.check(!!opened3 && m3.count === 1, '[C] (3) genau ein Menü', m3)
			t.check(!!at3 && Math.abs(at3[0] - BESIDE.x) <= 1 && Math.abs(at3[1] - BESIDE.y) <= 1, '[S] (3) data-knorke-menu-at = Punkt des Loslassens − Leinwand-Ecke (±1)', { at: m3.at, want: BESIDE })
			const log3 = await inputLog(pa)
			t.check(log3.menus.every((e) => e.dp === true), '[S] (3) jedes contextmenu war defaultPrevented', log3.menus)
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await menuState(pa)).count === 0, { timeout: 2000 }), '[C] (3) Esc schließt das Menü')

			t.step('(4) Stift-Rechtsklick auf N')
			const p4 = await centerOf(pa, N)
			t.must(await canvasAt(pa, p4), '[D] Vorbedingung: N liegt frei auf der Leinwand', p4)
			await inputReset(pa)
			await penRight(cdp, p4)
			const opened4 = await until(async () => ((await menuState(pa)).count > 0 ? menuState(pa) : null), { timeout: 3000 })
			await sleep(300)
			const m4 = await menuState(pa)
			const at4 = typeof m4.at === 'string' ? m4.at.split(',').map(Number) : null
			const want4 = [p4.x - box.x, p4.y - box.y]
			t.check(!!opened4 && m4.count === 1 && m4.target === N, '[C] (4) genau ein Menü mit Ziel N', m4)
			t.check(!!at4 && Math.abs(at4[0] - want4[0]) <= 1 && Math.abs(at4[1] - want4[1]) <= 1, '[S] (4) data-knorke-menu-at = Punkt des Loslassens − Leinwand-Ecke (±1)', { at: m4.at, want: want4 })
			const log4 = await inputLog(pa)
			t.check(log4.downs[0]?.type === 'pen' && log4.menus.every((e) => e.dp === true), '[S] (4) ein Stift-Druck, jedes contextmenu war defaultPrevented', log4)
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await menuState(pa)).count === 0, { timeout: 2000 }), '[C] (4) Esc schließt das Menü')
		} finally {
			await world.drop(a)
		}
	},
}
