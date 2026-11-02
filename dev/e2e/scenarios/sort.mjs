/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Sort notes by colour (factory job 139).
 *
 * The board of E48 (place.mjs placeBoard, one per world), each pass in a
 * part of the world of its own (x from 60000 on), opened with a stored
 * camera: no board of its own, so the full run stays under
 * MAX_BOARDS_PER_RUN.
 *
 * E49 alice (Chromium 1280 × 800, mouse) and bob (account, edit link).
 *   (1) alice selects six notes A–F (#b9c8fc, #faea89, #b9c8fc / #123456,
 *       #faea89, #faea89, 200 × 200, 300 apart) and a shape with a marquee;
 *       "Align items" → "Sort by color";
 *   (2) the notes stand in three blocks (B, E, F | A, C | D) locally, at the
 *       server and at bob's; the shape stays; the selection is empty, the
 *       canvas has the focus; three name fields
 *       input[data-knorke-sort-label] in the palette's order, the first one
 *       8 px above its block;
 *   (3) a click into the first field, "Ideas", Enter: a text "Ideas" above
 *       the yellow block (bottom 10 above it, the block's width), at bob's;
 *       two fields stay;
 *   (4) a click on empty canvas: no field, no further text;
 *   (5) Ctrl+Z twice: the text is gone, the notes are back (also at the
 *       server);
 *   (6) a frame (500 × 300) with two notes of two colours each: a right
 *       click on its title band, "Sort notes by color" → the frame is
 *       1060 × 320 (x/y kept), its notes 60 from its corner; two fields; Esc
 *       → no field, the canvas has the focus;
 *   (7) the six notes again, "Sort by color" with Enter: the first field
 *       has the focus, Tab and Shift+Tab go round the fields, Esc in a field
 *       ends them (the canvas has the focus, no text).
 * E49@820x1180 alice with a finger (touch, a fine pointer too: mode edit):
 *   a tap on a frame's title band, a tap on "Sort notes by color" in the
 *   bar; a tap into a field leaves the selection as it is (empty) and puts
 *   the focus there; typing "Team", a tap on empty canvas: the text "Team",
 *   no field.
 * Flake gate: --only E49 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection), [C] shell and session (bar, fields, texts, sync to the
 * others), [B] stored server state, [D] a harness precondition. Waiting polls
 * from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, CANVAS, TABLET, api, put, ulid, seedOps, serverMap, itemMap, openBoard, waitReady, until, sleep, canvasFocused, settle, dragPath } from '../lib/harness.mjs'
import { placeBoard } from './place.mjs'

const DESK = Object.freeze({ width: 1280, height: 800 })
const FIELD = 'input[data-knorke-sort-label]'
/** (Job 227) Indigo and Yellow of the one palette: yellow comes first in its order. */
const BLUE = '#b9c8fc'
const YELLOW = '#faea89'
const CUSTOM = '#123456'
/** The bottom edge of a field above its block (SortLabels.vue LABEL_GAP). */
const LABEL_GAP = 8
/** The bottom edge of a name text above its block (actions.js SORT_NAME_GAP). */
const NAME_GAP = 10

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

/** Is the canvas the element at this client point (no field, bar or menu over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/** The name fields now: [{color, index, x, y, w, h, b}] (client px) in document order. */
function fieldsOf(page) {
	return page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
		const r = el.getBoundingClientRect()
		return { color: el.getAttribute('data-knorke-sort-color'), index: el.getAttribute('data-knorke-sort-index'), x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom, placeholder: el.placeholder, focused: document.activeElement === el }
	}), FIELD).catch(() => [])
}

/** Waits until there are n fields; returns them. */
async function fieldCount(page, n, timeout = 3000) {
	let f = []
	await until(async () => (f = await fieldsOf(page)).length === n, { timeout })
	return f
}

/** The text items of a map (items(), serverMap). */
const textsOf = (m) => [...m.values()].filter((it) => it.t === 'text')

/** One finger down, held `hold` ms, up (CDP touch events, like a real finger). */
async function cdpTap(cdp, x, y, hold = 80) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
	await sleep(hold)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** Same ids, any order. */
const sameIds = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x))

export const E49 = {
	id: 'E49',
	title: 'Notizen nach Farbe sortieren (Job 139, Maus 1280 × 800): sechs Notizen und eine Form, „Align items“ → „Sort by color“: drei Blöcke lokal, beim Server und bei bob, drei Namensfelder; „Ideas“ + Enter → Text bei bob; Klick daneben → keine Felder; zweimal Strg+Z → zurück; Rahmen per Kontextmenü „Sort notes by color“: gewachsen, zwei Felder, Esc → weg',
	async run(t, world) {
		const board = await placeBoard(world)
		const X = 60000
		const [A, B, C, D, E, F, S, R, Y1, Y2, G1, G2] = Array.from({ length: 12 }, () => ulid())
		const note = (id, x, y, fill, extra = {}) => put.sticky(id, { x, y, style: { fill }, ...extra })
		const res = await seedOps('alice', board, [
			note(A, X, 0, BLUE), note(B, X + 300, 0, YELLOW), note(C, X + 600, 0, BLUE),
			note(D, X, 300, CUSTOM), note(E, X + 300, 300, YELLOW), note(F, X + 600, 300, YELLOW),
			put.shape(S, { x: X + 900, y: 450 }),
			put.frame(R, { x: X, y: 700, w: 500, h: 300, data: { title: 'R' } }),
			note(G1, 20, 20, '#febf87', { parent: R }), note(Y1, 260, 20, '#faea89', { parent: R }),
			note(G2, 20, 240, '#febf87', { parent: R }), note(Y2, 260, 240, '#faea89', { parent: R }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: sechs Notizen, eine Form, ein Rahmen mit vier Notizen', res)
		const alice = await world.actor('alice-sortieren', { user: 'alice', viewport: DESK })
		const bob = await world.actor('bob-sortieren', { user: 'bob', viewport: DESK })
		const p = alice.page
		const pb = bob.page
		try {
			// scale 0.6: the notes, their blocks and the grown frame in view; (job 226) 60 units further
			// left than before, so the marquee's start lies right of the tool bar with its 36 px buttons
			await storeCamera(p, board, { x: X - 260, y: -250, scale: 0.6 })
			await openBoard(alice, board)
			await K.waitIdle(p)
			const L = await linkToken(board)
			await pb.goto(`${APP}/p/${L}`, { waitUntil: 'domcontentloaded' })
			await waitReady(pb, 30000)
			await settle([p, pb])
			await desktop(t, p, pb, board, { X, A, B, C, D, E, F, S, R, Y1, Y2, G1, G2 })
		} finally {
			await world.drop(bob)
			await world.drop(alice)
		}
	},
}

/** Steps (1)–(6) of E49 (header). */
async function desktop(t, p, pb, board, { X, A, B, C, D, E, F, S, R, Y1, Y2, G1, G2 }) {
	const six = [A, B, C, D, E, F]
	const old = { [A]: [X, 0], [B]: [X + 300, 0], [C]: [X + 600, 0], [D]: [X, 300], [E]: [X + 300, 300], [F]: [X + 600, 300] }
	const want = { [B]: [X, 0], [E]: [X + 220, 0], [F]: [X, 220], [A]: [X + 520, 0], [C]: [X + 740, 0], [D]: [X + 1040, 0] }
	const at = (m, places) => six.every((id) => m.get(id)?.x === places[id][0] && m.get(id)?.y === places[id][1])
	const where = (m) => six.map((id) => m.get(id) && [m.get(id).x, m.get(id).y])

	t.step('(1) alice wählt sechs Notizen und die Form mit einem Rahmen, „Align items“ → „Sort by color“')
	const from = await K.w2s(p, X - 60, -60)
	const to = await K.w2s(p, X + 1160, 640)
	t.must(await canvasAt(p, from.x, from.y), '[D] (1) der Startpunkt des Auswahlrahmens liegt frei auf der Leinwand', from)
	await dragPath(p, from, to)
	t.must(await until(async () => sameIds((await K.selection(p)) || [], [...six, S]), { timeout: 3000 }), '[S] (1) die sechs Notizen und die Form sind gewählt', await K.selection(p))
	await p.locator('[data-knorke-action=align]').first().click()
	const sortBtn = p.locator('[data-knorke-action=sort-colors]').first()
	t.must(await until(() => sortBtn.isVisible().catch(() => false), { timeout: 3000 }), '[C] (1) „Sort by color“ steht im Panel „Align items“')
	t.check((await sortBtn.getAttribute('aria-label')) === 'Sort by color', '[C] (1) der Knopf heißt „Sort by color“', await sortBtn.getAttribute('aria-label'))
	await sortBtn.click()

	t.step('(2) drei Blöcke lokal, beim Server und bei bob; drei Namensfelder')
	t.check(await until(async () => at(await itemMap(p), want), { timeout: 3000 }), '[C] (2) lokal: B (0,0), E (220,0), F (0,220), A (520,0), C (740,0), D (1040,0) ab der linken oberen Ecke', where(await itemMap(p)))
	const shape = (await itemMap(p)).get(S)
	t.check(shape && shape.x === X + 900 && shape.y === 450, '[C] (2) die Form bleibt liegen', shape && [shape.x, shape.y])
	t.check(sameIds((await K.selection(p)) || [], []), '[C] (2) die Auswahl ist leer', await K.selection(p))
	t.check(await canvasFocused(p), '[C] (2) nach dem Klick hat die Leinwand den Fokus')
	await settle([p, pb])
	t.check(at(await serverMap('alice', board), want), '[B] (2) die Lagen stehen beim Server', where(await serverMap('alice', board)))
	t.check(await until(async () => at(await itemMap(pb), want), { timeout: 8000 }), '[C] (2) bob sieht die Lagen', where(await itemMap(pb)))
	const fields = await fieldCount(p, 3)
	t.check(fields.map((f) => f.color).join(',') === [YELLOW, BLUE, CUSTOM].join(','), '[C] (2) drei Namensfelder in der Reihenfolge der Palette', fields.map((f) => f.color))
	const top0 = await K.w2s(p, X, 0)
	t.check(fields.length > 0 && Math.abs(fields[0].b - (top0.y - LABEL_GAP)) <= 1 && Math.abs(fields[0].x - top0.x) <= 1, '[C] (2) das erste Feld steht links bündig 8 px über seinem Block', { feld: fields[0], block: top0 })
	t.check(fields.length > 0 && fields[0].placeholder === 'Name this group…', '[C] (2) Platzhalter „Name this group…“', fields[0]?.placeholder)
	t.check(textsOf(await itemMap(pb)).length === 0 && (await fieldsOf(pb)).length === 0, '[C] (2) bob sieht keine Felder und keinen Text')

	t.step('(3) Klick ins erste Feld, „Ideas“, Enter')
	const first = p.locator(`${FIELD}[data-knorke-sort-color="${YELLOW}"]`).first()
	await first.click()
	await p.keyboard.type('Ideas', { delay: 5 })
	await p.keyboard.press('Enter')
	const text = await until(async () => textsOf(await itemMap(p)).find((it) => it.data?.text === 'Ideas'), { timeout: 3000 })
	t.must(text, '[C] (3) ein Text „Ideas“ entsteht', textsOf(await itemMap(p)))
	t.check(text.x === X && text.w === 420 && Math.abs(text.y + text.h - (0 - NAME_GAP)) <= 0.011 && (text.parent ?? null) === null, '[C] (3) der Text steht über dem gelben Block: x bündig, Blockbreite 420, Unterkante 10 darüber', [text.x, text.y, text.w, text.h, text.parent])
	t.check(await canvasFocused(p), '[C] (3) nach Enter hat die Leinwand den Fokus')
	t.check((await fieldCount(p, 2)).length === 2, '[C] (3) die anderen zwei Felder bleiben', await fieldsOf(p))
	t.check(sameIds((await K.selection(p)) || [], []), '[C] (3) die Auswahl bleibt leer', await K.selection(p))
	await settle([p, pb])
	t.check((await serverMap('alice', board)).get(text.id)?.data?.text === 'Ideas', '[B] (3) der Text steht beim Server')
	t.check(await until(async () => (await itemMap(pb)).get(text.id)?.data?.text === 'Ideas', { timeout: 8000 }), '[C] (3) bob sieht den Text „Ideas“')

	t.step('(4) Klick auf leere Fläche')
	const empty = await K.w2s(p, X + 1500, 300)
	t.must(await canvasAt(p, empty.x, empty.y), '[D] (4) der Punkt liegt frei auf der Leinwand', empty)
	await p.mouse.click(empty.x, empty.y)
	t.check((await fieldCount(p, 0)).length === 0, '[C] (4) keine Felder mehr', await fieldsOf(p))
	await settle([p, pb])
	t.check(textsOf(await itemMap(p)).length === 1, '[C] (4) keine weiteren Texte', textsOf(await itemMap(p)).map((it) => it.data?.text))

	t.step('(5) zweimal Strg+Z')
	await p.locator(CANVAS).first().focus()
	await p.keyboard.press('Control+z')
	t.check(await until(async () => !(await itemMap(p)).has(text.id), { timeout: 3000 }), '[C] (5) das erste Strg+Z nimmt den Text weg')
	await p.keyboard.press('Control+z')
	t.check(await until(async () => at(await itemMap(p), old), { timeout: 3000 }), '[C] (5) das zweite Strg+Z bringt die Notizen zurück', where(await itemMap(p)))
	await settle([p, pb])
	const s5 = await serverMap('alice', board)
	t.check(at(s5, old) && !s5.has(text.id), '[B] (5) beim Server: Notizen zurück, kein Text', where(s5))

	t.step('(6) Rahmen über das Kontextmenü: „Sort notes by color“')
	const band = await K.w2s(p, X + 250, 700 - 21)
	t.must(await canvasAt(p, band.x, band.y), '[D] (6) das Titelband des Rahmens liegt frei auf der Leinwand', band)
	await p.mouse.click(band.x, band.y, { button: 'right' })
	const entry = p.locator('[data-knorke-menu=context] [data-knorke-menu-item=sort-frame]').first()
	t.must(await until(() => entry.isVisible().catch(() => false), { timeout: 3000 }), '[C] (6) das Kontextmenü des Rahmens zeigt „Sort notes by color“', await p.locator('[data-knorke-menu-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item'))).catch(() => null))
	t.check(((await entry.textContent()) || '').includes('Sort notes by color'), '[C] (6) der Eintrag heißt „Sort notes by color“')
	await entry.click()
	const grown = (m) => {
		const f = m.get(R)
		const rel = { [Y1]: [60, 60], [Y2]: [280, 60], [G1]: [580, 60], [G2]: [800, 60] }
		return !!f && f.x === X && f.y === 700 && f.w === 1060 && f.h === 320 && Object.entries(rel).every(([id, [x, y]]) => m.get(id)?.x === x && m.get(id)?.y === y && m.get(id)?.parent === R)
	}
	const frameOf = (m) => [R, Y1, Y2, G1, G2].map((id) => m.get(id) && [m.get(id).x, m.get(id).y, m.get(id).w, m.get(id).h])
	t.check(await until(async () => grown(await itemMap(p)), { timeout: 3000 }), '[C] (6) der Rahmen ist 1060 × 320 (x/y gleich), seine Notizen 60 von seiner Ecke', frameOf(await itemMap(p)))
	const f6 = await fieldCount(p, 2)
	t.check(f6.length === 2 && f6.map((f) => f.color).join(',') === '#faea89,#febf87', '[C] (6) zwei Namensfelder (Gelb vor Orange, Reihenfolge der Palette)', f6.map((f) => f.color))
	await settle([p, pb])
	t.check(grown(await serverMap('alice', board)), '[B] (6) der gewachsene Rahmen und die Lagen beim Server', frameOf(await serverMap('alice', board)))
	await p.keyboard.press('Escape')
	t.check((await fieldCount(p, 0)).length === 0, '[C] (6) Esc: keine Felder mehr', await fieldsOf(p))
	t.check(await canvasFocused(p), '[C] (6) nach Esc hat die Leinwand den Fokus')

	t.step('(7) „Sort by color“ mit der Tastatur: Fokus im ersten Feld, Tab zum nächsten, Esc')
	await dragPath(p, from, to)
	t.must(await until(async () => sameIds((await K.selection(p)) || [], [...six, S]), { timeout: 3000 }), '[S] (7) die sechs Notizen und die Form sind wieder gewählt', await K.selection(p))
	await p.locator('[data-knorke-action=align]').first().click()
	t.must(await until(() => sortBtn.isVisible().catch(() => false), { timeout: 3000 }), '[D] (7) „Sort by color“ ist sichtbar')
	await sortBtn.focus()
	await p.keyboard.press('Enter')
	let f7 = []
	t.check(await until(async () => (f7 = await fieldsOf(p)).length === 3 && f7[0].focused, { timeout: 3000 }), '[C] (7) nach Enter auf dem Knopf hat das erste Feld den Fokus', f7)
	await p.keyboard.press('Tab')
	t.check(await until(async () => (await fieldsOf(p))[1]?.focused === true, { timeout: 2000 }), '[C] (7) Tab führt ins zweite Feld', await fieldsOf(p))
	await p.keyboard.press('Shift+Tab')
	await p.keyboard.press('Shift+Tab')
	t.check(await until(async () => (await fieldsOf(p))[2]?.focused === true, { timeout: 2000 }), '[C] (7) Umschalt+Tab führt rundherum ins letzte Feld', await fieldsOf(p))
	await p.keyboard.press('Escape')
	t.check((await fieldCount(p, 0)).length === 0 && await canvasFocused(p), '[C] (7) Esc im Feld: keine Felder, die Leinwand hat den Fokus', await fieldsOf(p))
	t.check(textsOf(await itemMap(p)).length === 0, '[C] (7) leere Felder hinterlassen keinen Text')
}

export const E49_TABLET = {
	id: 'E49',
	pass: `${TABLET.width}x${TABLET.height}`,
	title: `Notizen nach Farbe sortieren bei ${TABLET.width} × ${TABLET.height} mit dem Finger: Tipp auf das Titelband eines Rahmens und „Sort notes by color“; Feld antippen (keine Auswahländerung), „Team“ tippen, auf leere Fläche tippen → Text da, Felder weg`,
	async run(t, world) {
		const board = await placeBoard(world)
		const X = 80000
		const [R, Y1, Y2, G1, G2] = Array.from({ length: 5 }, () => ulid())
		const note = (id, x, y, fill) => put.sticky(id, { x, y, parent: R, style: { fill } })
		const res = await seedOps('alice', board, [
			put.frame(R, { x: X, y: 0, w: 500, h: 300, data: { title: 'R' } }),
			note(G1, 20, 20, '#febf87'), note(Y1, 260, 20, '#faea89'), note(G2, 20, 240, '#febf87'), note(Y2, 260, 240, '#faea89'),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: ein Rahmen mit vier Notizen', res)
		const a = await world.actor(`alice-sortieren-${TABLET.width}`, { user: 'alice', touch: true, viewport: TABLET, fine: true })
		const p = a.page
		try {
			await storeCamera(p, board, { x: X - 100, y: -400, scale: 0.6 })
			await openBoard(a, board)
			await K.waitIdle(p)
			const st = await K.state(p)
			t.must(st.uiMode === 'edit', '[D] das Tablet ist im Modus edit (Touch mit feinem Zeiger, wie E39)', { uiMode: st.uiMode })
			const cdp = await a.ctx.newCDPSession(p)

			t.step('Tipp auf das Titelband des Rahmens, Tipp auf „Sort notes by color“')
			const band = await K.w2s(p, X + 250, -21)
			t.must(await canvasAt(p, band.x, band.y), '[D] das Titelband liegt frei auf der Leinwand', band)
			await cdpTap(cdp, Math.round(band.x), Math.round(band.y))
			t.must(await until(async () => sameIds((await K.selection(p)) || [], [R]), { timeout: 3000 }), '[S] der Tipp wählt den Rahmen', await K.selection(p))
			// job 230: "Sort notes by color" is an entry of "…": a tap opens it
			const more = p.locator('.knorke-contextbar [data-knorke-menu=selection] button').first()
			t.must(await until(() => more.isVisible().catch(() => false), { timeout: 3000 }), '[C] die Leiste zeigt „…“')
			await sleep(300)
			const mb = await more.boundingBox()
			await cdpTap(cdp, Math.round(mb.x + mb.width / 2), Math.round(mb.y + mb.height / 2))
			const btn = p.locator('.knorke-menus [data-knorke-action=sort-frame] button').first()
			t.must(await until(() => btn.isVisible().catch(() => false), { timeout: 3000 }), '[C] „…“ zeigt „Sort notes by color“')
			await sleep(300)
			const bb = await btn.boundingBox()
			await cdpTap(cdp, Math.round(bb.x + bb.width / 2), Math.round(bb.y + bb.height / 2))
			t.check(await until(async () => (await itemMap(p)).get(R)?.w === 1060, { timeout: 3000 }), '[C] der Rahmen ist gewachsen', (await itemMap(p)).get(R))
			const fields = await fieldCount(p, 2)
			t.must(fields.length === 2, '[C] zwei Namensfelder', fields)
			t.check(sameIds((await K.selection(p)) || [], []), '[C] die Auswahl ist leer', await K.selection(p))

			t.step('Feld antippen, „Team“ tippen, auf leere Fläche tippen')
			const f0 = fields[0]
			t.check(f0.h >= 44 - 0.5, '[C] das Feld ist für den Finger 44 px hoch', f0.h)
			await cdpTap(cdp, Math.round(f0.x + Math.min(f0.w, 120) / 2), Math.round(f0.y + f0.h / 2))
			t.check(await until(async () => (await fieldsOf(p))[0]?.focused === true, { timeout: 2000 }), '[C] der Tipp setzt den Fokus ins Feld', await fieldsOf(p))
			await sleep(400)
			t.check(sameIds((await K.selection(p)) || [], []), '[C] der Tipp ins Feld ändert die Auswahl nicht', await K.selection(p))
			t.check((await fieldsOf(p)).length === 2, '[C] die Felder bleiben nach dem Tipp', await fieldsOf(p))
			await p.keyboard.type('Team', { delay: 5 })
			const empty = await K.w2s(p, X + 700, 800)
			t.must(await canvasAt(p, empty.x, empty.y), '[D] der Punkt liegt frei auf der Leinwand', empty)
			await cdpTap(cdp, Math.round(empty.x), Math.round(empty.y))
			const text = await until(async () => textsOf(await itemMap(p)).find((it) => it.data?.text === 'Team'), { timeout: 3000 })
			t.check(!!text && text.parent === R, '[C] der Text „Team“ steht im Rahmen', text)
			t.check((await fieldCount(p, 0)).length === 0, '[C] keine Felder mehr', await fieldsOf(p))
			t.check(sameIds((await K.selection(p)) || [], []), '[C] die Auswahl bleibt leer', await K.selection(p))
			await K.waitIdle(p)
			t.check(!!text && (await serverMap('alice', board)).get(text.id)?.data?.text === 'Team', '[B] der Text beim Server')
		} finally {
			await world.drop(a)
		}
	},
}
