/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Hotfix H1 (SPEC-M1 §35): touch editing on a device with a fine pointer.
 *
 * E39 A phone that also reports a fine pointer (an Android phone whose
 *   Chrome says (any-pointer: fine), e.g. a Samsung touch driver or a pen)
 *   is in mode edit and shows the toolbar. Before H1 a finger with the note
 *   tool created nothing (claimTouch took a first finger only with the select
 *   tool). Actor "Handy": guest over the edit link, 393 × 873, DPR 2.75,
 *   isMobile, hasTouch, matchMedia('(any-pointer: fine)') forced true
 *   (newActor fine, the init script of the touch-bug repro); every pointer
 *   input of the phone is touch: buttons with locator.tap(), the canvas with
 *   CDP Input.dispatchTouchEvent. Steps:
 *   (1) preconditions: mode edit, toolbar, narrow layout, DPR, both pointer
 *       media queries;
 *   (2) note tool, a tap on free canvas → exactly one new note centred at the
 *       tap point, its editor open, the tool back on select;
 *   (3) typing, then a tap beside the editor → the editor ends with its
 *       commit (R9/R10), the text is local and at the server, and the note
 *       keeps the default fill E39_DEFAULT_FILL (no ghost click hit a colour
 *       swatch of the context bar, review B3);
 *   (4) alice (desktop, 1440 × 900, mouse) sees the note with the text;
 *   (5) the select tool unchanged: a tap on note A selects it, no new item;
 *       (5b) a double tap on A opens its editor (the select tap keeps its
 *       click, review B3), a tap beside closes it, A's text unchanged;
 *   (6) shape tool, a finger drag over free canvas → one shape with the
 *       dragged size (±3 px), the tool back on select;
 *   (7) (R38, SPEC-M1 §6.3) hold, then drag: navigator.vibrate is replaced
 *       by a counter (window.__vib); alice puts two notes X and Y into a
 *       free area of the phone's view; a finger held still E39_HOLD_MS on
 *       free canvas P → the ring under the finger (centre ±2 px at P,
 *       E39_RING_PX ±1 px) and __vib = [20]; the finger drags in 10 moves, one frame
 *       apart, so that the rectangle covers X and Y (the ring stays at P),
 *       then lifts → selection {X, Y}, the camera unchanged, no new item,
 *       the ring gone; the same way without the hold (cdpDrag) pans, keeps
 *       {X, Y}, never shows a ring and does not vibrate; with reduced motion
 *       a hold still shows the ring, without animation (animation-name
 *       none), and it goes with the finger.
 *   Own board, no instance setting: before E09, directly after E38.
 *   Red before H1 at (2) (no new note), green after it; red before R38 at
 *   (7) (no ring, the held finger pans).
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene input
 * (claim, create intent, hit, selection), [C] shell and session (mode,
 * toolbar, editor, sync to the other client), [B] stored server state, [D]
 * a harness precondition. Waiting polls from Node with until() (Nextcloud's
 * CSP, ENTWICKLUNG trap 9.10).
 */
import {
	K, APP, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, waitReady, until, sleep, field, toolPressed,
} from '../lib/harness.mjs'

export const E39_VIEWPORT = Object.freeze({ width: 393, height: 873 })
export const E39_DPR = 2.75
export const E39_TEXT = 'Finger note H1'
/** Fill of a new note without a chosen colour: src/model/tokens.js DEFAULT_STICKY_FILL (touch.test.mjs compares). */
export const E39_DEFAULT_FILL = '#a8d8f8'
/** Size of the shape drag in screen px (step 6). */
export const E39_DRAG = Object.freeze({ w: 120, h: 90 })
/** Step 7: how long the finger is held still (LONG_PRESS_MS = 500 plus room for a slow frame). */
export const E39_HOLD_MS = 700
/** Step 7: diameter of the hold ring (src/model/tokens.js HOLD_RING_PX) and the vibration (LONG_PRESS_VIBRATE_MS). */
export const E39_RING_PX = 120
export const E39_VIBRATE_MS = 20
/** Step 7: the free area (screen px) that takes P, X, Y and the marquee. */
export const E39_MARQUEE = Object.freeze({ w: 200, h: 150 })

/** One finger down, held `hold` ms, up (CDP touch events, like a real finger). */
async function cdpTap(cdp, x, y, hold = 60) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
	await sleep(hold)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** One finger from `a` to `b` in `steps` moves, one frame apart (CDP touch events). */
async function cdpDrag(cdp, a, b, steps = 10) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] })
	await cdpMoves(cdp, a, b, steps)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** The finger that is down moves from `a` to `b` in `steps` moves, one frame apart (CDP touchMove only). */
async function cdpMoves(cdp, a, b, steps = 10) {
	for (let i = 1; i <= steps; i++) {
		await sleep(16)
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }] })
	}
	await sleep(16)
}

/** Are all client points on the bare canvas (the Konva canvas element inside .knorke-canvas, nothing on top)? */
async function onCanvas(page, pts) {
	return page.evaluate(([sel, list]) => list.every(([x, y]) => {
		const el = document.elementFromPoint(x, y)
		return !!el && el.tagName === 'CANVAS' && !!el.closest(sel)
	}), [CANVAS, pts])
}

/**
 * A free w × h client rectangle on the canvas: inside the canvas box, at
 * least `margin` px away from every item's screen box, its corners and centre
 * on the bare canvas. Scans the canvas from the top left (bottomUp: from the
 * bottom left); null if none.
 */
async function freeRect(page, w, h, margin = 24, { bottomUp = false } = {}) {
	const box = await page.locator(CANVAS).first().boundingBox()
	if (!box) return null
	const rects = []
	for (const id of (await itemMap(page)).keys()) {
		const r = await K.rect(page, id)
		if (r) rects.push(r)
	}
	const clear = (x, y) => rects.every((r) => x + w + margin <= r.x || x >= r.x + r.w + margin || y + h + margin <= r.y || y >= r.y + r.h + margin)
	const rows = []
	for (let fy = 0.1; fy <= 0.9; fy += 0.05) rows.push(fy)
	if (bottomUp) rows.reverse()
	for (const fy of rows) {
		for (let fx = 0.15; fx <= 0.85; fx += 0.1) {
			const x = Math.round(box.x + box.width * fx - w / 2)
			const y = Math.round(box.y + box.height * fy - h / 2)
			if (x < box.x + 8 || y < box.y + 8 || x + w > box.x + box.width - 8 || y + h > box.y + box.height - 8) continue
			if (!clear(x, y)) continue
			if (await onCanvas(page, [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y + h / 2]])) return { x, y, w, h }
		}
	}
	return null
}

/** Taps a tool button with the finger (locator.tap) and waits for aria-pressed. */
async function tapTool(page, name) {
	const b = page.locator(`[data-knorke-tool=${name}]`).first()
	await b.tap()
	return until(async () => (await b.getAttribute('aria-pressed')) === 'true', { timeout: 2000 })
}

const editorVisible = (page) => page.locator('textarea[data-knorke-editor]').first().isVisible().catch(() => false)

const RING = '[data-knorke-hold-ring]'

/**
 * The hold ring (step 7): count, visibility, the centre and size of its
 * bounding box (client px) and its computed animation-name; null without one.
 */
async function ringInfo(page) {
	const count = await page.locator(RING).count()
	if (count === 0) return null
	const loc = page.locator(RING).first()
	const box = await loc.boundingBox()
	const visible = await loc.isVisible().catch(() => false)
	const animationName = await loc.evaluate((el) => getComputedStyle(el).animationName).catch(() => null)
	return { count, visible, animationName, cx: box ? box.x + box.width / 2 : null, cy: box ? box.y + box.height / 2 : null, w: box?.width ?? null, h: box?.height ?? null }
}

/** Is the one ring visible, centred at `pt` (±2 px) and E39_RING_PX wide (±1 px)? */
const ringAt = (r, pt) => !!r && r.count === 1 && r.visible && Math.abs(r.cx - pt.x) <= 2 && Math.abs(r.cy - pt.y) <= 2 &&
	Math.abs(r.w - E39_RING_PX) <= 1 && Math.abs(r.h - E39_RING_PX) <= 1

/**
 * A free w × h area for step 7: after steps 2–6 the phone's view is full
 * (A, the new note, the shape). While there is none, a quick finger drag
 * (the one-finger pan, no hold) from the lowest free canvas point up by 60 %
 * of the canvas height moves the items out of the top; at most 3 times.
 */
async function clearArea(page, cdp, w, h) {
	for (let i = 0; i < 3; i++) {
		const area = await freeRect(page, w, h)
		if (area) return area
		const box = await page.locator(CANVAS).first().boundingBox()
		const low = await freeRect(page, 40, 40, 24, { bottomUp: true })
		if (!box || !low) return null
		const from = { x: low.x + 20, y: low.y + 20 }
		await cdpDrag(cdp, from, { x: from.x, y: Math.max(box.y + 20, from.y - box.height * 0.6) })
		await sleep(100)
	}
	return freeRect(page, w, h)
}

export const E39 = {
	id: 'E39',
	title: 'Touch-Bearbeiten mit feinem Zeiger (H1): Handy 393×873 im Modus edit, Notiz per Tipp, Text, Desktop sieht sie; Form per Finger aufziehen',
	async run(t, world) {
		const board = await world.board('E39 touch edit')
		const A = ulid()
		await seedOps('alice', board, [put.sticky(A, { x: -100, y: -100, w: 200, h: 200, data: { text: 'A' } })])
		const lr = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
		t.must(lr.status === 200 && typeof lr.data?.link?.token === 'string', '[D] Bearbeitungslink über die API', { status: lr.status, body: lr.text.slice(0, 200) })
		const token = lr.data.link.token
		const alice = await world.actor('alice', { user: 'alice' })
		const phone = await world.actor('handy', { touch: true, viewport: E39_VIEWPORT, deviceScaleFactor: E39_DPR, fine: true })
		try {
			await steps(t, alice, phone, board, A, token)
		} finally {
			await world.drop(phone)
			await world.drop(alice)
		}
	},
}

/** Steps (1)–(6) of E39 (header); step (7) is holdMarquee. */
async function steps(t, alice, phone, board, A, token) {
	const p = phone.page
	await openBoard(alice, board)

	t.step('(1) Handy tritt über den Bearbeitungslink bei (nur Finger)')
	await p.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await field(p, 'guest-name', 'Handy')
	await p.locator('[data-knorke-action=guest-join]:visible').first().tap()
	await waitReady(p, 30000)
	const env = await p.evaluate(() => ({
		fine: window.matchMedia('(any-pointer: fine)').matches,
		coarse: window.matchMedia('(any-pointer: coarse)').matches,
		dpr: window.devicePixelRatio,
		inner: [window.innerWidth, window.innerHeight],
		touch: navigator.maxTouchPoints,
	}))
	t.must(env.fine === true && env.coarse === true && env.touch > 0, '[D] Handy meldet Touch und (any-pointer: fine)', env)
	t.must(env.dpr === E39_DPR && env.inner[0] === E39_VIEWPORT.width, '[D] Viewport 393 px, DPR 2,75', env)
	const st = await K.state(p)
	t.must(st.uiMode === 'edit' && st.viewOnly === false, '[C] Modus edit (Gerät mit feinem Zeiger, Rolle edit)', { uiMode: st.uiMode, viewOnly: st.viewOnly, role: st.role })
	t.check(await p.locator('[data-knorke-toolbar]').first().isVisible().catch(() => false), '[C] Werkzeugleiste sichtbar')
	t.check(await p.locator('.knorke-board--narrow').count() === 1, '[C] Schmal-Layout aktiv')
	const cdp = await phone.ctx.newCDPSession(p)

	t.step('(2) Notiz-Werkzeug antippen, Tipp auf freie Leinwand')
	t.must(await tapTool(p, 'sticky'), '[C] Notiz-Werkzeug per Tipp gewählt (aria-pressed)')
	const spot = await freeRect(p, 40, 40)
	t.must(spot, '[D] freie Stelle auf der Leinwand gefunden')
	const tapAt = { x: spot.x + 20, y: spot.y + 20 }
	const before = await itemMap(p)
	await cdpTap(cdp, tapAt.x, tapAt.y)
	const N = await until(async () => {
		const fresh = [...(await itemMap(p)).values()].filter((it) => !before.has(it.id))
		return fresh.length ? fresh : null
	}, { timeout: 5000 })
	t.must(Array.isArray(N) && N.length === 1 && N[0].t === 'sticky', '[S] ein Tipp mit dem Notiz-Werkzeug legt genau eine Notiz an', { created: N ?? null, before: before.size })
	const id = N[0].id
	const r = await K.rect(p, id)
	t.check(r && Math.abs(r.x + r.w / 2 - tapAt.x) <= 2 && Math.abs(r.y + r.h / 2 - tapAt.y) <= 2, '[S] die Notiz sitzt mittig am Tipp-Punkt (±2 px)', { r, tapAt })
	t.must(await until(() => editorVisible(p), { timeout: 3000 }), '[C] der Editor der neuen Notiz ist offen')
	t.check(await toolPressed(p, 'select') === 'true' && await toolPressed(p, 'sticky') === 'false', '[C] das Werkzeug fällt auf Auswählen zurück, wie mit der Maus')

	t.step('(3) Text tippen, Tipp daneben beendet den Editor')
	await p.keyboard.type(E39_TEXT, { delay: 5 })
	const beside = await freeRect(p, 40, 40)
	t.must(beside, '[D] freie Stelle neben dem Editor gefunden')
	await cdpTap(cdp, beside.x + 20, beside.y + 20)
	t.check(await until(async () => !(await editorVisible(p)), { timeout: 3000 }), '[C] der Tipp daneben beendet den Editor')
	const local = await until(async () => (await itemMap(p)).get(id)?.data?.text === E39_TEXT, { timeout: 5000 })
	t.check(local, '[C] der Text steht in der Notiz', (await itemMap(p)).get(id)?.data)
	await K.waitIdle(p, 15000)
	const srv = (await serverMap('alice', board)).get(id)
	t.check(srv?.t === 'sticky' && srv?.data?.text === E39_TEXT, '[B] Notiz mit Text beim Server', srv ?? null)
	t.check(srv?.style?.fill === E39_DEFAULT_FILL, '[S] die neue Notiz behält die Vorgabefarbe (kein Geisterklick auf einen Farbknopf)', srv?.style ?? null)

	t.step('(4) alice am Desktop sieht die Notiz')
	const seen = await until(async () => (await itemMap(alice.page)).get(id)?.data?.text === E39_TEXT, { timeout: 8000 })
	t.check(seen, '[C] alice (Desktop) sieht die neue Notiz mit dem Text', (await itemMap(alice.page)).get(id) ?? null)

	t.step('(5) Auswählen-Werkzeug: Tipp auf Notiz A wählt sie aus')
	const ra = await K.rect(p, A)
	t.must(ra, '[D] Notiz A auf dem Handy sichtbar')
	const nBefore = (await itemMap(p)).size
	await cdpTap(cdp, Math.round(ra.x + ra.w / 2), Math.round(ra.y + ra.h / 2))
	const sel = await until(async () => {
		const s = await K.selection(p)
		return Array.isArray(s) && s.length === 1 && s[0] === A ? s : null
	}, { timeout: 3000 })
	t.check(sel, '[S] Tipp auf A wählt A aus', await K.selection(p))
	t.check((await itemMap(p)).size === nBefore, '[S] kein neues Objekt beim Auswählen')

	t.step('(5b) Doppeltipp auf A öffnet den Editor, Tipp daneben schließt ihn')
	const ca = { x: Math.round(ra.x + ra.w / 2), y: Math.round(ra.y + ra.h / 2) }
	await cdpTap(cdp, ca.x, ca.y, 40)
	await sleep(80)
	await cdpTap(cdp, ca.x, ca.y, 40)
	t.check(await until(() => editorVisible(p), { timeout: 3000 }), '[S] Doppeltipp auf A öffnet den Editor (der Auswählen-Tipp behält seinen click)')
	const off5 = await freeRect(p, 40, 40)
	t.must(off5, '[D] freie Stelle neben dem Editor von A gefunden')
	await cdpTap(cdp, off5.x + 20, off5.y + 20)
	t.check(await until(async () => !(await editorVisible(p)), { timeout: 3000 }), '[C] der Tipp daneben schließt den Editor von A')
	t.check((await itemMap(p)).get(A)?.data?.text === 'A' && (await itemMap(p)).size === nBefore, '[S] A unverändert, kein neues Objekt', (await itemMap(p)).get(A)?.data ?? null)

	t.step('(6) Form-Werkzeug: Finger zieht eine Form auf')
	t.must(await tapTool(p, 'shape'), '[C] Form-Werkzeug per Tipp gewählt (aria-pressed)')
	const area = await freeRect(p, E39_DRAG.w, E39_DRAG.h)
	t.must(area, '[D] freie Fläche für das Aufziehen gefunden')
	const before6 = await itemMap(p)
	await cdpDrag(cdp, { x: area.x, y: area.y }, { x: area.x + area.w, y: area.y + area.h })
	const S = await until(async () => {
		const fresh = [...(await itemMap(p)).values()].filter((it) => !before6.has(it.id))
		return fresh.length ? fresh : null
	}, { timeout: 5000 })
	t.must(Array.isArray(S) && S.length === 1 && S[0].t === 'shape', '[S] ein Finger-Zug mit dem Form-Werkzeug legt genau eine Form an', S ?? null)
	const rs = await K.rect(p, S[0].id)
	t.check(rs && Math.abs(rs.x - area.x) <= 3 && Math.abs(rs.y - area.y) <= 3 && Math.abs(rs.w - area.w) <= 3 && Math.abs(rs.h - area.h) <= 3, '[S] die Form hat die aufgezogene Größe (±3 px)', { rs, area })
	t.check(await toolPressed(p, 'select') === 'true', '[C] das Werkzeug fällt nach der Form auf Auswählen zurück')
	if (await editorVisible(p)) {
		const off = await freeRect(p, 40, 40)
		if (off) await cdpTap(cdp, off.x + 20, off.y + 20)
		await until(async () => !(await editorVisible(p)), { timeout: 3000 })
	}
	await K.waitIdle(p, 15000)
	const seenShape = await until(async () => (await itemMap(alice.page)).get(S[0].id)?.t === 'shape', { timeout: 8000 })
	t.check(seenShape, '[C] alice sieht die Form')

	await holdMarquee(t, p, cdp, board)
}

/**
 * Step (7) of E39 (header): hold, signal, drag (R38).
 *
 * @param {object} t test context
 * @param {import('playwright').Page} p the phone's page
 * @param {object} cdp CDP session of the phone
 * @param {string} board board id
 */
async function holdMarquee(t, p, cdp, board) {
	t.step('(7) Halten, dann Ziehen: Auswahlrahmen per Finger mit Ring und Vibration')
	if (await toolPressed(p, 'select') !== 'true') await tapTool(p, 'select')
	t.must(await toolPressed(p, 'select') === 'true', '[C] Auswählen-Werkzeug aktiv')
	await p.evaluate(() => {
		window.__vib = []
		navigator.vibrate = (pattern) => {
			window.__vib.push(pattern)
			return true
		}
	})
	const vib = () => p.evaluate(() => window.__vib)
	const area = await clearArea(p, cdp, E39_MARQUEE.w, E39_MARQUEE.h)
	t.must(area, '[D] freie Fläche für den Rahmen gefunden', { canvas: await p.locator(CANVAS).first().boundingBox(), camera: await K.camera(p) })
	// X and Y: 40-px notes in the area (world size from the phone's camera), P and the drag end around them
	const cam = await K.camera(p)
	const o = await K.w2s(p, cam.x, cam.y)
	const toWorld = (cx, cy) => ({ x: Math.round(cam.x + (cx - o.x) / cam.scale), y: Math.round(cam.y + (cy - o.y) / cam.scale) })
	const side = Math.max(20, Math.round(40 / cam.scale))
	const X = ulid()
	const Y = ulid()
	const wx = toWorld(area.x + area.w * 0.3, area.y + area.h * 0.3)
	const wy = toWorld(area.x + area.w * 0.6, area.y + area.h * 0.3)
	await seedOps('alice', board, [
		put.sticky(X, { x: wx.x, y: wx.y, w: side, h: side, data: { text: 'X' } }),
		put.sticky(Y, { x: wy.x, y: wy.y, w: side, h: side, data: { text: 'Y' } }),
	])
	const both = await until(async () => {
		const m = await itemMap(p)
		return m.has(X) && m.has(Y)
	}, { timeout: 8000 })
	t.must(both, '[D] X und Y sind beim Handy angekommen')
	const P = { x: area.x + 12, y: area.y + 12 }
	const Q = { x: area.x + area.w - 12, y: area.y + area.h - 12 }
	const rx = await K.rect(p, X)
	const ry = await K.rect(p, Y)
	const within = (r) => !!r && r.x > P.x + 2 && r.y > P.y + 2 && r.x + r.w < Q.x - 2 && r.y + r.h < Q.y - 2
	t.must(within(rx) && within(ry), '[D] X und Y liegen ganz zwischen P und dem Zielpunkt', { rx, ry, P, Q })
	t.must(await onCanvas(p, [[P.x, P.y], [Q.x, Q.y]]), '[D] P und der Zielpunkt liegen auf freier Leinwand', { P, Q })
	const cam0 = await K.camera(p)
	const n0 = (await itemMap(p)).size

	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: P.x, y: P.y }] })
	await sleep(E39_HOLD_MS)
	const r1 = await ringInfo(p)
	t.check(ringAt(r1, P), `[S] nach ${E39_HOLD_MS} ms Halten steht der Ring unter dem Finger (Mitte ±2 px bei P, ${E39_RING_PX} px)`, { ring: r1, P })
	t.check(JSON.stringify(await vib()) === JSON.stringify([E39_VIBRATE_MS]), '[S] genau eine kurze Vibration beim Signal', await vib())
	await cdpMoves(cdp, P, Q)
	const r2 = await ringInfo(p)
	t.check(ringAt(r2, P), '[S] der Ring bleibt während des Ziehens am Startpunkt P', { ring: r2, P })
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
	const sel = await until(async () => {
		const s = await K.selection(p)
		return Array.isArray(s) && s.length === 2 && s.includes(X) && s.includes(Y) ? s : null
	}, { timeout: 3000 })
	t.check(sel, '[S] der Finger-Rahmen wählt genau X und Y aus', await K.selection(p))
	const cam1 = await K.camera(p)
	t.check(Math.abs(cam1.x - cam0.x) * cam0.scale < 0.5 && Math.abs(cam1.y - cam0.y) * cam0.scale < 0.5 && cam1.scale === cam0.scale,
		'[S] die Kamera bleibt beim Rahmen stehen', { cam0, cam1 })
	t.check((await itemMap(p)).size === n0, '[S] kein neues Objekt durch den Rahmen')
	t.check(await until(async () => (await p.locator(RING).count()) === 0, { timeout: 1000 }), '[S] nach dem Abheben ist der Ring weg')

	t.step('(7b) Gegenprobe: derselbe Zug ohne Halten schwenkt')
	await p.evaluate((sel) => {
		window.__ringSeen = false
		window.__ringObs?.disconnect()
		window.__ringObs = new MutationObserver(() => {
			if (document.querySelector(sel)) window.__ringSeen = true
		})
		window.__ringObs.observe(document.body, { childList: true, subtree: true })
	}, RING)
	await cdpDrag(cdp, P, Q)
	const seenDuring = await p.evaluate(() => {
		window.__ringObs?.disconnect()
		return window.__ringSeen
	})
	const cam2 = await K.camera(p)
	t.check(Math.abs(cam2.x - cam1.x) * cam1.scale > 50 || Math.abs(cam2.y - cam1.y) * cam1.scale > 50, '[S] ohne Halten schwenkt der Finger wie bisher', { cam1, cam2 })
	const sel2 = await K.selection(p)
	t.check(Array.isArray(sel2) && sel2.length === 2 && sel2.includes(X) && sel2.includes(Y), '[S] der Schwenk lässt die Auswahl {X, Y} stehen', sel2)
	t.check(seenDuring === false && (await p.locator(RING).count()) === 0, '[S] während und nach dem Schwenk gibt es keinen Ring', { seenDuring })
	t.check(JSON.stringify(await vib()) === JSON.stringify([E39_VIBRATE_MS]), '[S] der Schwenk vibriert nicht', await vib())

	t.step('(7c) Reduzierte Bewegung: der Ring erscheint ohne Einblendung')
	await p.emulateMedia({ reducedMotion: 'reduce' })
	try {
		const spot = await freeRect(p, 40, 40)
		t.must(spot, '[D] freie Stelle zum Halten gefunden')
		const R = { x: spot.x + 20, y: spot.y + 20 }
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: R.x, y: R.y }] })
		await sleep(E39_HOLD_MS)
		const r3 = await ringInfo(p)
		t.check(ringAt(r3, R), '[S] mit reduzierter Bewegung steht der Ring trotzdem unter dem Finger', { ring: r3, R })
		t.check(r3?.animationName === 'none', '[S] mit reduzierter Bewegung ohne Einblendung (animation-name none)', r3)
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		t.check(await until(async () => (await p.locator(RING).count()) === 0, { timeout: 1000 }), '[S] nach dem Abheben ist der Ring wieder weg')
	} finally {
		await p.emulateMedia({ reducedMotion: null })
	}
}
