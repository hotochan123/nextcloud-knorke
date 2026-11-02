/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The mouse wheel zooms (factory job 154).
 *
 * E55 alice (owner, Chromium 1440 × 900) on a board of her own with note N
 * at (0, 0), opened at 100 % with world (0, 0) 600 px right of and 300 px
 * below the canvas corner. The wheel runs at P, a free spot of the canvas.
 * Chromium gives every Playwright wheel event wheelDeltaY ±120 (one "tick"),
 * whatever its deltaY, so under Automatic mouse.wheel(0, 100) is a notch of
 * Chrome on Windows (rule (c) of isNotchedWheel) and mouse.wheel(0, 40) is a
 * step of a trackpad of Chrome on macOS (|wheelDeltaY| = 3 × |deltaY|);
 * mouse.wheel(0, 10 × 4.000244140625) is ten macOS notches (rule (b)). The
 * checks in (6) show the event's fields. Steps:
 *   (1) the board menu lists "Mouse wheel: Automatic" (wheel, a menuitem
 *       without aria-checked) directly after grid and before cursors;
 *   (2) a click on it: the toast [data-knorke-toast=wheel] says "Mouse
 *       wheel: zoom. …", scene().wheel is 'zoom', localStorage knorke.wheel
 *       'zoom';
 *   (3) mouse.wheel(0, 100) at P zooms: scale × exp(−0.15) (±1 %), the world
 *       point under P stays (±2 px);
 *   (4) after a reload scene().wheel is still 'zoom';
 *   (5) the next click gives "Mouse wheel: Pan" and its toast; mouse.wheel(0,
 *       100) keeps the scale and moves the camera;
 *   (6) the next click gives Automatic: the key is gone, mouse.wheel(0,
 *       40.00244140625) and mouse.wheel(0, 100) zoom around the pointer,
 *       mouse.wheel(0, 40) pans;
 *   (7) Shift+0 puts the scale back: scale and stage as at the start.
 * Own board, no instance setting: before E09, directly after E54.
 * Flake gate: --only E55 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (wheel stage, camera), [C] shell and session (menu, toast, storage),
 * [B] a server answer, [D] a harness precondition. Waiting polls from Node
 * with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, openBoard, waitReady, until, sleep } from '../lib/harness.mjs'

/** The camera alice opens with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Where the wheel runs (world, empty canvas at 100 %), and an empty spot for the right click. */
const SPOT = Object.freeze({ x: 300, y: 150 })
const EMPTY = Object.freeze({ x: -300, y: 300 })
/** Zoom speed of the wheel (GestureController WHEEL_ZOOM). */
const WHEEL_ZOOM = 0.0015
/** Ten notches of a wheel on macOS (10 × 4.000244140625). */
const NOTCHES = 40.00244140625
/** One notch of Chrome on Windows (deltaY 100, wheelDeltaY −120). */
const WIN_NOTCH = 100
/** A trackpad step of Chrome on macOS: wheelDeltaY = −3 × deltaY (−120 here). */
const TRACKPAD = 40
const TEXT = Object.freeze({
	auto: 'Mouse wheel: automatic. A wheel zooms, a trackpad pans.',
	zoom: 'Mouse wheel: zoom. Scrolling zooms, also on a trackpad.',
	pan: 'Mouse wheel: pan. Ctrl + wheel zooms.',
})
const LABEL = Object.freeze({ auto: 'Mouse wheel: Automatic', zoom: 'Mouse wheel: Zoom', pan: 'Mouse wheel: Pan' })
const TOAST = '[data-knorke-toast=wheel]'
const MENU = '[data-knorke-menu=context]'
const ITEM = `${MENU} [data-knorke-menu-item="wheel"]`

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

/** Text of the first match, whitespace folded ('' when missing). */
const textOf = (page, sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '')

/** localStorage knorke.wheel (null when missing). */
const storedWheel = (page) => page.evaluate(() => localStorage.getItem('knorke.wheel')).catch(() => 'error')

/** The stage of the scene (scene().wheel). */
const stageOf = async (page) => (await K.scene(page).catch(() => null))?.wheel ?? null

/** The world point under a client point (the canvas box and the confirmed camera). */
async function worldAt(page, p) {
	const box = await page.locator(CANVAS).first().boundingBox()
	const c = await K.camera(page)
	return { x: c.x + (p.x - box.x) / c.scale, y: c.y + (p.y - box.y) / c.scale }
}

/** One wheel event at p, then the wheel gesture's end; the camera afterwards. */
async function wheelAt(page, p, dy) {
	await page.mouse.move(p.x, p.y)
	await page.mouse.wheel(0, dy)
	await sleep(120 + 300)
	return K.camera(page)
}

/**
 * Records the fields of every wheel event on the page (window, capture) for the
 * details of a failed check; deltaMode is read first, as the app does.
 */
const recordWheel = (page) => page.evaluate(() => {
	window.addEventListener('wheel', (e) => {
		const deltaMode = e.deltaMode
		window.__e55wheel = { deltaMode, deltaX: e.deltaX, deltaY: e.deltaY, wheelDeltaY: e.wheelDeltaY }
	}, { capture: true, passive: true })
}).catch(() => {})

/** The fields of the last wheel event recorded (recordWheel). */
const lastWheel = (page) => page.evaluate(() => window.__e55wheel ?? null).catch(() => null)

/** Opens the board menu at the empty spot; true when it is there. */
async function openMenu(page) {
	const pe = await K.w2s(page, EMPTY.x, EMPTY.y)
	await page.mouse.move(pe.x, pe.y)
	await page.mouse.click(pe.x, pe.y, { button: 'right' })
	return page.locator(ITEM).first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)
}

/** The entry names of the open menu, in order. */
const entriesOf = (page) => page.locator(`${MENU} [data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item'))).catch(() => [])

export const E55 = {
	id: 'E55',
	title: 'Mausrad zoomt (Job 154): im Board-Menü steht „Mouse wheel: Automatic“ zwischen grid und cursors; ein Klick stellt auf Zoom (Meldung wheel), das Rad zoomt um den Zeiger, auch nach dem Neuladen; Pan verschiebt; Automatic: zehn Mac-Rasten und eine Windows-Raste (100 px) zoomen, 40 px verschieben (wie ein Trackpad am Mac)',
	async run(t, world) {
		const board = await world.board('E55 Mausrad')
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, w: 200, h: 200, data: { text: 'N' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N gesät', res)
		const a = await world.actor('alice-wheel', { user: 'alice' })
		const pa = a.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			const cam0 = await K.camera(pa)
			t.must(Math.abs(cam0.scale - CAM.scale) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', cam0)
			t.must((await storedWheel(pa)) === null && (await stageOf(pa)) === 'auto', '[D] Vorbedingung: knorke.wheel fehlt, scene().wheel ist auto', { key: await storedWheel(pa), stage: await stageOf(pa) })
			const P = await K.w2s(pa, SPOT.x, SPOT.y)
			t.must(await canvasAt(pa, P.x, P.y), '[D] Vorbedingung: P liegt frei auf der Leinwand', P)

			t.step('(1) Board-Menü: „Mouse wheel: Automatic“ zuerst, vor grid (Job 230)')
			t.must(await openMenu(pa), '[C] (1) das Board-Menü hat den Eintrag wheel')
			const names = await entriesOf(pa)
			t.check(names[0] === 'wheel' && names.indexOf('grid') > 0, '[C] (1) wheel steht zuerst, grid danach (Job 230)', names)
			t.check(!names.includes('cursors'), '[C] (1) kein Eintrag cursors mehr (Job 230)', names)
			const item = pa.locator(ITEM).first()
			t.check((await item.innerText().catch(() => '')).trim() === LABEL.auto, `[C] (1) Text „${LABEL.auto}“`, await item.innerText().catch(() => ''))
			t.check((await item.getAttribute('role')) === 'menuitem', '[C] (1) role=menuitem', await item.getAttribute('role'))
			t.check((await item.getAttribute('aria-checked')) === null, '[C] (1) ohne aria-checked', await item.getAttribute('aria-checked'))

			t.step('(2) Klick: Zoom, Meldung wheel')
			await item.click()
			t.check(await until(async () => (await pa.locator(MENU).count()) === 0, { timeout: 2000 }), '[C] (2) das Menü schließt')
			t.check(await until(() => pa.locator(TOAST).first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (2) die Meldung [data-knorke-toast=wheel] ist sichtbar')
			t.check((await textOf(pa, TOAST)) === TEXT.zoom, `[C] (2) ihr Text: „${TEXT.zoom}“`, await textOf(pa, TOAST))
			t.check((await stageOf(pa)) === 'zoom', '[S] (2) scene().wheel ist zoom', await stageOf(pa))
			t.check((await storedWheel(pa)) === 'zoom', '[C] (2) localStorage knorke.wheel = "zoom"', await storedWheel(pa))

			t.step('(3) mouse.wheel(0, 100) zoomt um den Zeiger')
			const before = await K.camera(pa)
			const w = await worldAt(pa, P)
			const back = await K.w2s(pa, w.x, w.y)
			t.must(Math.abs(back.x - P.x) <= 1 && Math.abs(back.y - P.y) <= 1, '[D] (3) Vorbedingung: der Weltpunkt unter P ist richtig berechnet', { P, back, w })
			const c3 = await wheelAt(pa, P, 100)
			const k3 = c3.scale / before.scale
			const want = Math.exp(-100 * WHEEL_ZOOM)
			t.check(Math.abs(k3 / want - 1) <= 0.01, `[S] (3) Maßstab × ${want.toFixed(4)} (±1 %)`, { k3, before, c3 })
			const p3 = await K.w2s(pa, w.x, w.y)
			t.check(Math.abs(p3.x - P.x) <= 2 && Math.abs(p3.y - P.y) <= 2, '[S] (3) der Weltpunkt unter dem Zeiger bleibt (±2 px)', { P, p3, w })

			t.step('(4) Neu laden: weiter Zoom')
			await pa.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(pa)
			t.check((await stageOf(pa)) === 'zoom', '[S] (4) nach dem Neuladen ist scene().wheel zoom', await stageOf(pa))
			t.check((await storedWheel(pa)) === 'zoom', '[C] (4) der Schlüssel bleibt "zoom"', await storedWheel(pa))
			t.check((await pa.locator(TOAST).count()) === 0, '[C] (4) beim Öffnen keine Meldung wheel')

			t.step('(5) Pan: das Rad verschiebt')
			t.must(await openMenu(pa), '[C] (5) das Board-Menü hat den Eintrag wheel')
			t.check((await pa.locator(ITEM).first().innerText().catch(() => '')).trim() === LABEL.zoom, `[C] (5) Text „${LABEL.zoom}“`, await pa.locator(ITEM).first().innerText().catch(() => ''))
			await pa.locator(ITEM).first().click()
			t.check((await stageOf(pa)) === 'pan', '[S] (5) scene().wheel ist pan', await stageOf(pa))
			t.check((await storedWheel(pa)) === 'pan', '[C] (5) localStorage knorke.wheel = "pan"', await storedWheel(pa))
			t.check(await until(async () => (await textOf(pa, TOAST)) === TEXT.pan, { timeout: 3000 }), `[C] (5) die Meldung sagt „${TEXT.pan}“`, await textOf(pa, TOAST))
			t.check(await until(async () => (await pa.locator(TOAST).count()) === 1, { timeout: 3000 }), '[C] (5) eine Meldung wheel (die vorige ist weg)', await pa.locator(TOAST).count())
			const b5 = await K.camera(pa)
			const c5 = await wheelAt(pa, P, 100)
			t.check(Math.abs(c5.scale - b5.scale) < 1e-9, '[S] (5) der Maßstab bleibt', { b5, c5 })
			t.check(Math.abs(c5.y - b5.y - 100 / b5.scale) < 0.5 && Math.abs(c5.x - b5.x) < 0.5, '[S] (5) die Kamera verschiebt sich um 100 px nach unten', { b5, c5 })

			t.step('(6) Automatic: Mac- und Windows-Rasten zoomen, ein Trackpad-Schritt verschiebt')
			t.must(await openMenu(pa), '[C] (6) das Board-Menü hat den Eintrag wheel')
			t.check((await pa.locator(ITEM).first().innerText().catch(() => '')).trim() === LABEL.pan, `[C] (6) Text „${LABEL.pan}“`, await pa.locator(ITEM).first().innerText().catch(() => ''))
			await pa.locator(ITEM).first().click()
			t.check((await stageOf(pa)) === 'auto', '[S] (6) scene().wheel ist auto', await stageOf(pa))
			t.check((await storedWheel(pa)) === null, '[C] (6) der Schlüssel knorke.wheel fehlt', await storedWheel(pa))
			t.check(await until(async () => (await textOf(pa, TOAST)) === TEXT.auto, { timeout: 3000 }), `[C] (6) die Meldung sagt „${TEXT.auto}“`, await textOf(pa, TOAST))
			await recordWheel(pa)
			const b6 = await K.camera(pa)
			const w6 = await worldAt(pa, P)
			const c6 = await wheelAt(pa, P, NOTCHES)
			const want6 = Math.exp(-NOTCHES * WHEEL_ZOOM)
			t.check(Math.abs(c6.scale / b6.scale / want6 - 1) <= 0.01, `[S] (6) zehn Rasten (${NOTCHES}) zoomen: Maßstab × ${want6.toFixed(4)} (±1 %)`, { b6, c6, event: await lastWheel(pa) })
			const p6 = await K.w2s(pa, w6.x, w6.y)
			t.check(Math.abs(p6.x - P.x) <= 2 && Math.abs(p6.y - P.y) <= 2, '[S] (6) der Weltpunkt unter dem Zeiger bleibt (±2 px)', { P, p6 })
			const w6b = await worldAt(pa, P)
			const c6b = await wheelAt(pa, P, WIN_NOTCH)
			const e6b = await lastWheel(pa)
			t.check(e6b?.deltaY === WIN_NOTCH && e6b?.wheelDeltaY === -120, '[D] (6) Chromium meldet deltaY 100 mit wheelDeltaY −120 (wie eine Raste unter Windows)', e6b)
			const want6b = Math.exp(-WIN_NOTCH * WHEEL_ZOOM)
			t.check(Math.abs(c6b.scale / c6.scale / want6b - 1) <= 0.01, `[S] (6) eine Windows-Raste (100, wheelDeltaY −120) zoomt: Maßstab × ${want6b.toFixed(4)} (±1 %)`, { c6, c6b, event: e6b })
			const p6b = await K.w2s(pa, w6b.x, w6b.y)
			t.check(Math.abs(p6b.x - P.x) <= 2 && Math.abs(p6b.y - P.y) <= 2, '[S] (6) der Weltpunkt unter dem Zeiger bleibt auch dabei (±2 px)', { P, p6b })
			const c6c = await wheelAt(pa, P, TRACKPAD)
			const e6c = await lastWheel(pa)
			t.check(e6c?.deltaY === TRACKPAD && e6c?.wheelDeltaY === -3 * TRACKPAD, '[D] (6) Chromium meldet deltaY 40 mit wheelDeltaY −120 (wie ein Trackpad am Mac)', e6c)
			t.check(Math.abs(c6c.scale - c6b.scale) < 1e-9 && Math.abs(c6c.y - c6b.y - TRACKPAD / c6b.scale) < 0.5 && Math.abs(c6c.x - c6b.x) < 0.5, '[S] (6) 40 px verschieben wie ein Trackpad (Maßstab gleich, Kamera 40 px tiefer)', { c6b, c6c, event: e6c })

			t.step('(7) Shift+0: Maßstab und Stufe wie am Anfang')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Shift+Digit0')
			t.check(await until(async () => Math.abs((await K.camera(pa)).scale - cam0.scale) < 1e-9, { timeout: 3000 }), '[S] (7) der Maßstab ist wieder der vom Anfang', { cam0, now: await K.camera(pa) })
			t.check((await stageOf(pa)) === 'auto' && (await storedWheel(pa)) === null, '[C] (7) die Stufe ist wieder Automatic, ohne Schlüssel', { stage: await stageOf(pa), key: await storedWheel(pa) })
		} finally {
			await world.drop(a)
		}
	},
}
