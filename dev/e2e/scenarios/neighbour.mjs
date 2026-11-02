/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Neighbour with one click (factory job 136; empty neighbours stay since
 * job 138; since job 148 no editor, and a click or tap on "+" adds a
 * connector; since job 159 the "+" of a text item hangs a connector until
 * the next click or tap, and Alt/Option+arrow copies a text item; since job
 * 162 a click on "+" connects to a near item, and a hovering mouse shows
 * that first; since job 169 the target of a text item's "+" is selected
 * afterwards). Own board, no instance setting: directly after E46, before E09.
 *
 * E47 alice (desktop, mouse) on her board with note A and text item T
 *   (apart from the row and from the place below A); bob (account, edit
 *   link) watches; a phone (guest over the edit link, touch with a fine
 *   pointer as in E39, so mode edit). Steps:
 *   (1) alice selects A and clicks its "+" handle plus-r → a new note B
 *       right of A (gap E47_GAP, same top edge and fill), selected alone,
 *       no editor; a connector A → B (anchors r/l, elbow since job 153, arrow) locally,
 *       at the server and for bob;
 *   (2) she clicks plus-r of B → a note C with a connector B → C; then
 *       Alt+→ → a note D right of C, no third connector; A–D in a row
 *       locally, at the server and for bob;
 *   (3) a double click on B opens its editor, she types "B", Esc; a click
 *       on D, Enter, "D", Esc; both texts at the server;
 *   (4a) (job 159) she selects T, clicks its plus-t (job 231: a text item's
 *       sides l/r hold the wrap width handles, its points are plus-t and
 *       plus-b; a connector hangs, no
 *       new item) and then A → a connector T → A (start anchor (0.5, 0) at
 *       T, elbow, arrow) locally, at the server and for bob; (job 169) A
 *       is selected alone, not the connector; no new text item;
 *   (4b) T, plus-b, a click on empty canvas below T → a connector from T
 *       with a free end there, selected alone, at the server;
 *   (4c) T, plus-t, Esc → nothing hangs, the number of items stays;
 *   (4d) T, Alt+→ twice → two text items with T's text in a row right of
 *       T (gap E47_GAP, same top edge and width), the second selected
 *       alone, no editor; both at the server and for bob;
 *   (5) the phone (its start camera fits the whole row, so a finger first
 *       pans A clear of the toolbar) taps A, then its plus-b → a note below
 *       A, selected, with a connector from A; no editor after the finger
 *       lifted, and 500 ms later the same note is still selected (no
 *       compatibility click changed the selection);
 *   (6) (job 159) the phone taps T, then its plus-t, then note B → a
 *       connector T → B (start anchor (0.5, 0)) at the server; (job 169) B
 *       is selected alone, and 500 ms later still B;
 *   (7a) (job 162) the harness puts note E at E47_NEAR, 120 right of D;
 *       alice selects D, the mouse hovers its plus-r: scene().plusPreview
 *       names E; the click gives a connector D → E (anchors r/l, elbow,
 *       arrow) locally, at the server and for bob, no new note, and E is
 *       selected alone;
 *   (7b) D again, hovering plus-r previews the neighbour; the click gives
 *       note F at E47_F, moved on past E, with a connector D → F, F selected
 *       alone.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene input
 * (handles, intent, place), [C] shell and session (editor, selection, sync to
 * the others), [B] stored server state, [D] a harness precondition. Waiting
 * polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import {
	K, APP, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, waitReady, until, sleep, field, centerOf, selectItem,
	handleOf, settle, idSet,
} from '../lib/harness.mjs'

/** Gap between a note and its neighbour (src/board/actions.js SERIES_GAP). */
export const E47_GAP = 20
/** Fill of note A (and so of every neighbour). */
export const E47_FILL = '#ffd6a5'
/** Top left of text item T: below the row but clear of it (y 0..200) and of the place below A (x 0..200). */
export const E47_TEXT_AT = Object.freeze({ x: 400, y: 300 })
/** The phone of step 5 (as E39). */
export const E47_PHONE = Object.freeze({ width: 393, height: 873 })
/** Step 5: the phone pans its view this far right (px) before the tap, so A clears the toolbar. */
export const E47_PHONE_PAN = 120
/** Step 5: how long the selection must stay after the tap (ms). */
export const E47_HOLD_MS = 500
/** Step 7a (job 162): note E, 120 right of D (D at 660..860, 0..200), within reach and offset across. */
export const E47_NEAR = Object.freeze({ x: 980, y: 80 })
/** Step 7b: where the neighbour F of D lands, 20 beyond E's right edge. */
export const E47_F = Object.freeze({ x: 1200, y: 0 })

const EDITOR = 'textarea[data-knorke-editor]'
const editorVisible = (page) => page.locator(EDITOR).first().isVisible().catch(() => false)
/** Anchors [start, end] of the connector of a click on plus-r and plus-b (anchorsFor: side midpoints). */
const RIGHT = Object.freeze([[1, 0.5], [0, 0.5]])
const BELOW = Object.freeze([[0.5, 1], [0.5, 0]])

/** The edit link of a board (route 9 as alice). */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Is the bare canvas (the Konva canvas inside .knorke-canvas) the element at this client point? */
function onCanvas(page, pt) {
	return page.evaluate(([x, y, sel]) => {
		const el = document.elementFromPoint(x, y)
		return !!el && el.tagName === 'CANVAS' && !!el.closest(sel)
	}, [pt.x, pt.y, CANVAS]).catch(() => false)
}

/** One finger down and up at a client point (CDP touch events, like a real finger). */
async function cdpTap(cdp, x, y, hold = 60) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
	await sleep(hold)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** One finger that moves at once from `a` to `b` (client points) and lifts: a pan on empty canvas. */
async function cdpDrag(cdp, a, b, steps = 12) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] })
	for (let i = 1; i <= steps; i++) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(a.x + ((b.x - a.x) * i) / steps), y: Math.round(a.y + ((b.y - a.y) * i) / steps) }] })
		await sleep(16)
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/**
 * The new items that are not in `before`, once they are exactly of the types `types` (sorted), else null.
 *
 * @return {Promise<object|null>} {item, connector}: the one new item that is no connector and the new connector (or null)
 */
async function fresh(page, before, types, timeout = 5000) {
	const want = JSON.stringify([...types].sort())
	const got = await until(async () => {
		const f = [...(await itemMap(page)).values()].filter((it) => !before.has(it.id))
		return JSON.stringify(f.map((it) => it.t).sort()) === want ? f : null
	}, { timeout })
	if (!got) return null
	return { item: got.find((it) => it.t !== 'connector') ?? null, connector: got.find((it) => it.t === 'connector') ?? null }
}

/** Is exactly `id` selected? */
async function selectedAlone(page, id) {
	const s = await K.selection(page)
	return Array.isArray(s) && s.length === 1 && s[0] === id
}

/** The "+" handle `name` of the selection: on the bare canvas, else null. */
async function plusAt(page, name) {
	const h = await handleOf(page, name)
	return h && (await onCanvas(page, h)) ? h : null
}

/** The connectors of an item map. */
const connectorsOf = (m) => [...m.values()].filter((it) => it.t === 'connector')

/** Does `m` hold an elbow connector (job 153) with an arrow from `from` to `to` at the anchors `[[sx, sy], [ex, ey]]`? */
function joins(m, from, to, [[sx, sy], [ex, ey]]) {
	return connectorsOf(m).some((c) => c.data?.start?.item === from && c.data.start.ax === sx && c.data.start.ay === sy &&
		c.data?.end?.item === to && c.data.end.ax === ex && c.data.end.ay === ey && c.data.route === 'elbow' &&
		(c.style?.endCap ?? 'arrow') === 'arrow')
}

/** The ends of every connector of `m`, for a failure. */
const endsOf = (m) => connectorsOf(m).map((c) => [c.data?.start, c.data?.end, c.data?.route, c.style?.endCap])

export const E47 = {
	id: 'E47',
	title: 'Nachbar mit einem Klick (Job 136, 138, 148, 159, 162, 169): alice klickt „+“ rechts an A → B ausgewählt, ohne Editor, Verbinder A→B; „+“ an B → C mit Verbinder, Alt+→ → D ohne Verbinder, Reihe A–D bei Server und bob; Doppelklick auf B und Enter an D nehmen Text; Punkt oben am Text T, dann Klick auf A → Verbinder T→A, A ausgewählt; Klick auf freie Fläche → loses Ende, Verbinder ausgewählt; Esc → nichts; zweimal Alt+→ an T → zwei Kopien in einer Reihe; Handy tippt „+“ unten an A → Notiz mit Verbinder, ohne Editor, bleibt ausgewählt; Handy tippt T, Punkt oben, B → Verbinder T→B, B bleibt ausgewählt; Notiz E nah rechts von D: Maus über „+“ zeigt E, Klick verbindet D→E ohne neue Notiz; nochmal → Notiz F an E vorbei mit Verbinder D→F',
	async run(t, world) {
		const board = await world.board('E47 Nachbar')
		const A = ulid()
		const T = ulid()
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: 0, y: 0, data: { text: 'A' }, style: { fill: E47_FILL } }),
			put.text(T, { x: E47_TEXT_AT.x, y: E47_TEXT_AT.y, data: { text: 'T' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz A und Text T', res)
		const token = await linkToken(board)
		const alice = await world.actor('alice-nachbar', { user: 'alice' })
		const bob = await world.actor('bob-nachbar', { user: 'bob' })
		const phone = await world.actor('handy-nachbar', { touch: true, viewport: E47_PHONE, deviceScaleFactor: 2.75, fine: true })
		try {
			await openBoard(alice, board)
			await bob.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await waitReady(bob.page, 30000)
			t.must((await K.state(bob.page)).role === 'edit', '[D] bob ist über den Bearbeitungslink im Board')
			const row = await mouseRow(t, alice.page, bob.page, board, A, T)
			await phoneTap(t, phone, alice.page, board, A, token, row.count)
			await phoneConnect(t, phone, alice.page, board, T, row.B)
			await nearConnect(t, alice.page, bob.page, board, row.D)
		} finally {
			await world.drop(phone)
			await world.drop(bob)
			await world.drop(alice)
		}
	},
}

/**
 * Steps (1)–(4d) with the mouse and the keyboard.
 *
 * @return {Promise<{count: number, B: string, D: string}>} the number of items after step 4d and the ids of notes B and D
 */
async function mouseRow(t, p, pb, board, A, T) {
	t.step('(1) alice wählt A und klickt den „+“-Griff rechts')
	await selectItem(p, A)
	const r1 = await plusAt(p, 'plus-r')
	t.must(r1, '[D] plus-r von A liegt frei auf der Leinwand', await K.handles(p))
	const before1 = await idSet(p)
	await p.mouse.click(r1.x, r1.y)
	const n1 = await fresh(p, before1, ['sticky', 'connector'])
	t.must(n1, '[S] der Klick auf plus-r legt genau eine neue Notiz und einen Verbinder an', [...(await itemMap(p)).values()].map((it) => [it.t, it.data?.text]))
	const B = n1.item
	t.must(await until(() => selectedAlone(p, B.id), { timeout: 3000 }), '[C] die neue Notiz B ist allein ausgewählt', await K.selection(p))
	await sleep(300)
	t.check(!(await editorVisible(p)), '[C] kein Editor ist offen')
	const a0 = (await itemMap(p)).get(A)
	t.check(B.x === a0.x + a0.w + E47_GAP && B.y === a0.y && B.style?.fill === E47_FILL, `[S] B liegt ${E47_GAP} rechts von A, gleiche Oberkante und Farbe`, { A: [a0.x, a0.y, a0.w], B: [B.x, B.y, B.style?.fill] })
	t.check(joins(await itemMap(p), A, B.id, RIGHT), '[S] ein Verbinder A→B (Anker r/l, rechtwinklig, Pfeil)', endsOf(await itemMap(p)))
	await settle([p, pb])
	const srv1 = await serverMap('alice', board)
	t.check(joins(srv1, A, B.id, RIGHT), '[B] der Verbinder A→B steht so beim Server', endsOf(srv1))
	t.check(await until(async () => joins(await itemMap(pb), A, B.id, RIGHT), { timeout: 8000 }), '[C] bob sieht den Verbinder A→B', endsOf(await itemMap(pb)))

	t.step('(2) „+“ rechts an B → C mit Verbinder, dann Alt+→ → D ohne Verbinder')
	const r2 = await plusAt(p, 'plus-r')
	t.must(r2, '[D] plus-r von B liegt frei auf der Leinwand', await K.handles(p))
	const before2 = await idSet(p)
	await p.mouse.click(r2.x, r2.y)
	const n2 = await fresh(p, before2, ['sticky', 'connector'])
	t.must(n2, '[S] der Klick auf plus-r von B legt genau eine neue Notiz C und einen Verbinder an')
	const C = n2.item
	t.must(await until(() => selectedAlone(p, C.id), { timeout: 3000 }), '[C] C ist allein ausgewählt', await K.selection(p))
	t.check(joins(await itemMap(p), B.id, C.id, RIGHT), '[S] ein Verbinder B→C (Anker r/l, rechtwinklig, Pfeil)', endsOf(await itemMap(p)))
	const before3 = await idSet(p)
	await p.keyboard.press('Alt+ArrowRight')
	const n3 = await fresh(p, before3, ['sticky'])
	t.must(n3, '[S] Alt+→ legt genau eine neue Notiz D an, keinen Verbinder', [...(await itemMap(p)).values()].map((it) => [it.t, it.data?.text]))
	const D = n3.item
	t.must(await until(() => selectedAlone(p, D.id), { timeout: 3000 }), '[C] D ist allein ausgewählt', await K.selection(p))
	const ids = [A, B.id, C.id, D.id]
	const okRow = (m, texts = ['A', '', '', '']) => {
		const its = ids.map((id) => m.get(id))
		return its.every((it, k) => !!it && it.t === 'sticky' && (it.data?.text ?? '') === texts[k] && it.style?.fill === E47_FILL &&
			it.y === its[0].y && it.w === its[0].w && it.h === its[0].h && (k === 0 || (!!its[k - 1] && it.x === its[k - 1].x + its[k - 1].w + E47_GAP))) &&
			connectorsOf(m).length === 2 && joins(m, A, B.id, RIGHT) && joins(m, B.id, C.id, RIGHT)
	}
	const rowOf = (m) => ({ row: ids.map((id) => m.get(id)).map((it) => it && [it.x, it.y, it.w, it.h, it.style?.fill, it.data?.text]), connectors: endsOf(m) })
	t.check(await until(async () => okRow(await itemMap(p)), { timeout: 5000 }), `[S] A–D in einer Reihe (Abstand ${E47_GAP}, gleiche Oberkante, Größe und Farbe), genau 2 Verbinder`, rowOf(await itemMap(p)))
	await settle([p, pb])
	const srv2 = await serverMap('alice', board)
	t.check(okRow(srv2), '[B] die Reihe A–D mit 2 Verbindern steht so beim Server', rowOf(srv2))
	t.check(await until(async () => okRow(await itemMap(pb)), { timeout: 8000 }), '[C] bob sieht die Reihe A–D mit 2 Verbindern', rowOf(await itemMap(pb)))

	t.step('(3) Doppelklick auf B, „B“, Esc; Klick auf D, Enter, „D“, Esc')
	const cb = await centerOf(p, B.id)
	await p.mouse.dblclick(cb.x, cb.y)
	t.must(await until(() => editorVisible(p), { timeout: 3000 }), '[C] der Doppelklick öffnet den Editor von B')
	await p.keyboard.type('B', { delay: 5 })
	await p.keyboard.press('Escape')
	t.check(await until(async () => !(await editorVisible(p)), { timeout: 3000 }), '[C] Esc beendet den Editor von B')
	await selectItem(p, D.id)
	t.must(await until(() => selectedAlone(p, D.id), { timeout: 3000 }), '[S] der Klick wählt D aus', await K.selection(p))
	await p.keyboard.press('Enter')
	t.must(await until(() => editorVisible(p), { timeout: 3000 }), '[C] Enter öffnet den Editor von D')
	await p.keyboard.type('D', { delay: 5 })
	await p.keyboard.press('Escape')
	t.check(await until(async () => !(await editorVisible(p)), { timeout: 3000 }), '[C] Esc beendet den Editor von D')
	const texts = ['A', 'B', '', 'D']
	t.check(await until(async () => okRow(await itemMap(p), texts), { timeout: 5000 }), '[C] B und D tragen ihre Texte', rowOf(await itemMap(p)))
	await settle([p, pb])
	const srv3 = await serverMap('alice', board)
	t.check(okRow(srv3, texts), '[B] beide Texte beim Server', rowOf(srv3))

	await text4(t, p, pb, board, A, T)
	return { count: (await itemMap(p)).size, B: B.id, D: D.id }
}

/** (job 159) A connector from T: start anchor (1, 0.5) of T (or `ax`/`ay`), elbow, arrow, end on `to` (null: a free end). */
function fromT(c, T, to, [ax, ay] = [1, 0.5]) {
	return !!c && c.t === 'connector' && c.data?.start?.item === T && c.data.start.ax === ax && c.data.start.ay === ay &&
		(to === null ? typeof c.data?.end?.x === 'number' && !('item' in c.data.end) : c.data?.end?.item === to) &&
		c.data.route === 'elbow' && (c.style?.endCap ?? 'arrow') === 'arrow'
}

/** (job 159) T selected alone by a click, then its "+" handle `name` on the bare canvas. */
async function plusOfT(t, p, T, name) {
	await selectItem(p, T)
	t.must(await until(() => selectedAlone(p, T), { timeout: 3000 }), '[S] der Klick wählt T aus', await K.selection(p))
	const h = await plusAt(p, name)
	t.must(h, `[D] ${name} von T liegt frei auf der Leinwand`, await K.handles(p))
	return h
}

/** (job 159) Does a connector hang from a "+" (the scene's connecting)? */
const hanging = async (p) => (await K.scene(p))?.connecting === 'connect'

/**
 * Steps (4a)–(4d) (job 159): the "+" of text item T hangs a connector, Alt+→ copies T.
 */
async function text4(t, p, pb, board, A, T) {
	t.step('(4a) Text T: Punkt oben, dann Klick auf A → Verbinder T→A, A ausgewählt; kein neuer Text')
	const ct = await centerOf(p, T)
	t.must(await onCanvas(p, ct), '[D] T liegt frei auf der Leinwand', ct)
	const r = await plusOfT(t, p, T, 'plus-t')
	const beforeA = await idSet(p)
	await p.mouse.click(r.x, r.y)
	t.check(await until(() => hanging(p), { timeout: 3000 }), '[S] nach dem Klick auf plus-t hängt ein Verbinder am „+“', await K.scene(p))
	t.check((await idSet(p)).size === beforeA.size, '[S] der Klick auf plus-t legt nichts an')
	const ca = await centerOf(p, A)
	await p.mouse.move(ca.x, ca.y, { steps: 4 })
	await p.mouse.click(ca.x, ca.y)
	const na = await fresh(p, beforeA, ['connector'])
	t.must(na, '[S] der Klick auf A legt genau einen Verbinder an, keinen neuen Text', [...(await itemMap(p)).values()].map((it) => [it.t, it.data?.text]))
	const ta = na.connector
	t.check(fromT(ta, T, A, [0.5, 0]), '[S] der Verbinder geht von T (Anker 0.5, 0) zu A, rechtwinklig, mit Pfeil', [ta.data, ta.style])
	// (job 169) the target is selected, not the connector
	t.check(await until(() => selectedAlone(p, A), { timeout: 3000 }), '[C] A ist allein ausgewählt, nicht der Verbinder T→A', await K.selection(p))
	t.check(!(await hanging(p)), '[S] danach hängt nichts mehr')
	await settle([p, pb])
	const srvA = await serverMap('alice', board)
	t.check(fromT(srvA.get(ta.id), T, A, [0.5, 0]), '[B] der Verbinder T→A steht so beim Server', srvA.get(ta.id)?.data)
	t.check(await until(async () => fromT((await itemMap(pb)).get(ta.id), T, A, [0.5, 0]), { timeout: 8000 }), '[C] bob sieht den Verbinder T→A', (await itemMap(pb)).get(ta.id)?.data)

	t.step('(4b) T, „+“ unten, Klick auf freie Leinwand unter T → Verbinder mit losem Ende')
	const b = await plusOfT(t, p, T, 'plus-b')
	// world: 200 below T, nothing lies there
	const w = { x: E47_TEXT_AT.x + 120, y: E47_TEXT_AT.y + 200 }
	const sp = await K.w2s(p, w.x, w.y)
	t.must(sp && (await onCanvas(p, sp)), '[D] die Stelle unter T liegt frei auf der Leinwand', sp)
	const beforeB = await idSet(p)
	await p.mouse.click(b.x, b.y)
	t.check(await until(() => hanging(p), { timeout: 3000 }), '[S] nach dem Klick auf plus-b hängt ein Verbinder', await K.scene(p))
	await p.mouse.click(Math.round(sp.x), Math.round(sp.y))
	const nb = await fresh(p, beforeB, ['connector'])
	t.must(nb, '[S] der Klick auf freie Leinwand legt genau einen Verbinder an')
	const tb = nb.connector
	const looseEnd = (c) => fromT(c, T, null, [0.5, 1]) && Math.hypot(c.data.end.x - w.x, c.data.end.y - w.y) < 5
	t.check(looseEnd(tb), '[S] der Verbinder geht von T (Anker 0.5, 1) zu einem losen Ende an der Klickstelle', [tb.data, w])
	t.check(await until(() => selectedAlone(p, tb.id), { timeout: 3000 }), '[C] der Verbinder mit losem Ende ist allein ausgewählt', await K.selection(p))
	await settle([p, pb])
	const srvB = await serverMap('alice', board)
	t.check(looseEnd(srvB.get(tb.id)), '[B] der Verbinder mit losem Ende steht beim Server', srvB.get(tb.id)?.data)

	t.step('(4c) T, Punkt oben, Esc → nichts Neues')
	const l = await plusOfT(t, p, T, 'plus-t')
	const beforeC = await idSet(p)
	await p.mouse.click(l.x, l.y)
	t.check(await until(() => hanging(p), { timeout: 3000 }), '[S] nach dem Klick auf plus-t hängt ein Verbinder', await K.scene(p))
	await p.keyboard.press('Escape')
	t.check(await until(async () => !(await hanging(p)), { timeout: 3000 }), '[S] Esc lässt den Verbinder fallen', await K.scene(p))
	await sleep(300)
	t.check((await idSet(p)).size === beforeC.size, '[S] die Zahl der Elemente bleibt gleich', { before: beforeC.size, now: (await idSet(p)).size })
	t.check(await selectedAlone(p, T), '[C] T bleibt ausgewählt', await K.selection(p))

	t.step('(4d) T, zweimal Alt+→ → zwei Kopien von T in einer Reihe rechts, die zweite allein ausgewählt, kein Editor')
	const beforeD = await idSet(p)
	await p.keyboard.press('Alt+ArrowRight')
	const k1 = await fresh(p, beforeD, ['text'])
	t.must(k1, '[S] das erste Alt+→ legt genau einen neuen Text an', [...(await itemMap(p)).values()].map((it) => [it.t, it.data?.text]))
	t.must(await until(() => selectedAlone(p, k1.item.id), { timeout: 3000 }), '[C] die erste Kopie ist allein ausgewählt', await K.selection(p))
	await p.keyboard.press('Alt+ArrowRight')
	const k2 = await fresh(p, new Set([...beforeD, k1.item.id]), ['text'])
	t.must(k2, '[S] das zweite Alt+→ legt genau einen weiteren Text an', [...(await itemMap(p)).values()].map((it) => [it.t, it.data?.text]))
	const ids = [k1.item.id, k2.item.id]
	const t0 = (await itemMap(p)).get(T)
	const okCopies = (m) => {
		const [a, c] = ids.map((id) => m.get(id))
		return [a, c].every((it) => !!it && it.t === 'text' && it.data?.text === t0.data?.text && it.y === t0.y && it.w === t0.w) &&
			a.x === t0.x + t0.w + E47_GAP && c.x === a.x + a.w + E47_GAP
	}
	const copiesOf = (m) => [t0, ...ids.map((id) => m.get(id))].map((it) => it && [it.t, it.x, it.y, it.w, it.data?.text])
	t.check(await until(async () => okCopies(await itemMap(p)), { timeout: 5000 }), `[S] zwei Kopien mit dem Text von T rechts in einer Reihe (Abstand ${E47_GAP}, gleiche Oberkante und Breite)`, copiesOf(await itemMap(p)))
	t.check(await until(() => selectedAlone(p, ids[1]), { timeout: 3000 }), '[C] die zweite Kopie ist allein ausgewählt', await K.selection(p))
	await sleep(300)
	t.check(!(await editorVisible(p)), '[C] kein Editor ist sichtbar')
	await settle([p, pb])
	const srvD = await serverMap('alice', board)
	t.check(okCopies(srvD), '[B] beide Kopien stehen so beim Server', copiesOf(srvD))
	t.check(await until(async () => okCopies(await itemMap(pb)), { timeout: 8000 }), '[C] bob sieht beide Kopien', copiesOf(await itemMap(pb)))
}


/**
 * Step (5): the phone taps plus-b of A.
 */
async function phoneTap(t, phone, pa, board, A, token, count) {
	t.step('(5) Handy: Tipp auf A, dann auf den „+“-Griff unten')
	const p = phone.page
	await p.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await field(p, 'guest-name', 'Handy')
	await p.locator('[data-knorke-action=guest-join]:visible').first().tap()
	await waitReady(p, 30000)
	const st = await K.state(p)
	t.must(st.uiMode === 'edit' && st.viewOnly === false, '[D] Handy im Modus edit (feiner Zeiger, Rolle edit)', { uiMode: st.uiMode, viewOnly: st.viewOnly })
	t.must(await until(async () => (await itemMap(p)).size === count, { timeout: 8000 }), '[D] Handy sieht A–D, T und die Verbinder')
	const cdp = await phone.ctx.newCDPSession(p)
	// the start camera fits the whole row A–D, so small that A lies at the toolbar: a finger
	// on empty canvas below the items pans the view right until A and its plus-b are free
	const vp = p.viewportSize()
	const from = { x: Math.round(vp.width / 2), y: Math.round(vp.height * 0.8) }
	t.must(await onCanvas(p, from), '[D] unter den Elementen liegt freie Leinwand des Handys', from)
	const cam0 = JSON.stringify(await K.camera(p))
	await cdpDrag(cdp, from, { x: from.x + E47_PHONE_PAN, y: from.y })
	let cam = cam0
	const still = await until(async () => {
		const c = JSON.stringify(await K.camera(p))
		const same = c === cam && c !== cam0
		cam = c
		return same
	}, { timeout: 3000, every: 150 })
	t.must(still, '[D] der Finger hat die Ansicht des Handys geschwenkt, sie steht still', { before: cam0, now: cam })
	const ca = await centerOf(p, A)
	t.must(await onCanvas(p, ca), '[D] nach dem Schwenken liegt A frei auf der Leinwand des Handys', { A: ca, camera: cam })
	await cdpTap(cdp, Math.round(ca.x), Math.round(ca.y))
	const sel = await until(() => selectedAlone(p, A), { timeout: 3000 })
	t.must(sel, '[S] der Tipp wählt A aus', await K.selection(p))
	const pb = await plusAt(p, 'plus-b')
	t.must(pb, '[D] plus-b von A liegt frei auf der Leinwand des Handys', await K.handles(p))
	const before = await idSet(p)
	await cdpTap(cdp, Math.round(pb.x), Math.round(pb.y))
	const n = await fresh(p, before, ['sticky', 'connector'])
	t.must(n, '[S] der Tipp auf plus-b legt genau eine neue Notiz und einen Verbinder an')
	const E = n.item
	const a = (await itemMap(p)).get(A)
	t.check(E.x === a.x && E.y === a.y + a.h + E47_GAP, `[S] die neue Notiz liegt ${E47_GAP} unter A, linke Kante bündig`, { A: [a.x, a.y, a.h], E: [E.x, E.y] })
	t.check(joins(await itemMap(p), A, E.id, BELOW), '[S] ein Verbinder A→neue Notiz (Anker b/t, rechtwinklig, Pfeil)', endsOf(await itemMap(p)))
	t.check(await until(() => selectedAlone(p, E.id), { timeout: 3000 }), '[C] die neue Notiz ist ausgewählt', await K.selection(p))
	t.check(!(await editorVisible(p)), '[C] nach dem Loslassen des Fingers ist kein Editor offen')
	await sleep(E47_HOLD_MS)
	t.check(await selectedAlone(p, E.id), `[C] nach ${E47_HOLD_MS} ms ist dieselbe Notiz noch ausgewählt (kein Kompatibilitäts-Klick)`, await K.selection(p))
	t.check(!(await editorVisible(p)), '[C] und es ist weiter kein Editor offen')
	await settle([p, pa])
	const srv = await serverMap('alice', board)
	t.check(srv.has(E.id) && joins(srv, A, E.id, BELOW), '[B] die Notiz und ihr Verbinder beim Server', endsOf(srv))
}

/**
 * Step (6) (job 159): the phone taps T, its plus-t (job 231), then note B.
 */
async function phoneConnect(t, phone, pa, board, T, B) {
	t.step('(6) Handy: Tipp auf T, auf den Punkt oben, dann auf Notiz B')
	const p = phone.page
	const cdp = await phone.ctx.newCDPSession(p)
	// T is small on the phone (about 60 × 8 px): a tap at three quarters of its width stays clear of the
	// connectors of (4a) and (4b), which leave its top and bottom middle, and of the plus-r of the note
	// of step 5 (still selected), which stands just left of T
	const rt = await K.rect(p, T)
	const ct = { x: Math.round(rt.x + rt.w * 0.75), y: Math.round(rt.y + rt.h / 2) }
	t.must(await onCanvas(p, ct), '[D] T liegt frei auf der Leinwand des Handys', { T: rt, tap: ct })
	await cdpTap(cdp, ct.x, ct.y)
	const selOf = async () => Promise.all(((await K.selection(p)) ?? []).map(async (id) => [id, (await itemMap(p)).get(id)?.t, await K.rect(p, id)]))
	t.must(await until(() => selectedAlone(p, T), { timeout: 3000 }), '[S] der Tipp wählt T aus', { selection: await selOf(), T: rt, tap: ct })
	const r = await plusAt(p, 'plus-t')
	t.must(r, '[D] plus-t von T liegt frei auf der Leinwand des Handys', await K.handles(p))
	const before = await idSet(p)
	await cdpTap(cdp, Math.round(r.x), Math.round(r.y))
	t.check(await until(() => hanging(p), { timeout: 3000 }), '[S] nach dem Tipp auf plus-t hängt ein Verbinder', await K.scene(p))
	const cb = await centerOf(p, B)
	t.must(await onCanvas(p, cb), '[D] B liegt frei auf der Leinwand des Handys', cb)
	await cdpTap(cdp, Math.round(cb.x), Math.round(cb.y))
	const n = await fresh(p, before, ['connector'])
	t.must(n, '[S] der Tipp auf B legt genau einen Verbinder an', [...(await itemMap(p)).values()].map((it) => it.t))
	const c = n.connector
	t.check(fromT(c, T, B, [0.5, 0]), '[S] der Verbinder geht von T (Anker 0.5, 0) zu B', c.data)
	// (job 169) the target is selected, not the connector
	t.check(await until(() => selectedAlone(p, B), { timeout: 3000 }), '[C] B ist allein ausgewählt, nicht der Verbinder', await K.selection(p))
	await sleep(E47_HOLD_MS)
	t.check(await selectedAlone(p, B), `[C] nach ${E47_HOLD_MS} ms ist B noch ausgewählt (kein Kompatibilitäts-Klick)`, await K.selection(p))
	await settle([p, pa])
	const srv = await serverMap('alice', board)
	t.check(fromT(srv.get(c.id), T, B, [0.5, 0]), '[B] der Verbinder T→B steht beim Server', srv.get(c.id)?.data)
}

/** (job 162) The "+" preview of a scene. */
const previewOf = async (p) => (await K.scene(p))?.plusPreview ?? null

/**
 * Steps (7a) and (7b) (job 162): a click on "+" of D connects to the near note E; then the
 * neighbour F moves on past E.
 */
async function nearConnect(t, p, pb, board, D) {
	t.step('(7a) Notiz E 120 rechts von D: die Maus über „+“ rechts an D zeigt E, der Klick verbindet D→E ohne neue Notiz')
	const E = ulid()
	const res = await seedOps('alice', board, [put.sticky(E, { x: E47_NEAR.x, y: E47_NEAR.y, data: { text: 'E' } })])
	t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz E', res)
	t.must(await until(async () => (await itemMap(p)).has(E) && (await itemMap(pb)).has(E), { timeout: 8000 }), '[D] alice und bob sehen E')
	await selectItem(p, D)
	t.must(await until(() => selectedAlone(p, D), { timeout: 3000 }), '[S] der Klick wählt D aus', await K.selection(p))
	const r = await plusAt(p, 'plus-r')
	t.must(r, '[D] plus-r von D liegt frei auf der Leinwand', await K.handles(p))
	await p.mouse.move(r.x - 6, r.y, { steps: 2 })
	await p.mouse.move(r.x, r.y, { steps: 2 })
	t.check(await until(async () => {
		const v = await previewOf(p)
		return v?.kind === 'connect' && v.id === E
	}, { timeout: 3000 }), '[S] die Maus über plus-r zeigt E als Ziel (plusPreview)', await previewOf(p))
	const before = await idSet(p)
	await p.mouse.click(r.x, r.y)
	const n = await fresh(p, before, ['connector'])
	t.must(n, '[S] der Klick legt genau einen Verbinder an, keine neue Notiz', [...(await itemMap(p)).values()].filter((it) => !before.has(it.id)).map((it) => it.t))
	t.check(joins(await itemMap(p), D, E, RIGHT), '[S] ein Verbinder D→E (Anker r/l, rechtwinklig, Pfeil)', endsOf(await itemMap(p)))
	t.check(await until(() => selectedAlone(p, E), { timeout: 3000 }), '[C] E ist allein ausgewählt', await K.selection(p))
	t.check(await previewOf(p) === null, '[S] nach dem Klick zeigt keine Vorschau mehr', await previewOf(p))
	await settle([p, pb])
	const srv = await serverMap('alice', board)
	t.check(joins(srv, D, E, RIGHT) && srv.get(E)?.x === E47_NEAR.x && srv.get(E)?.y === E47_NEAR.y, '[B] der Verbinder D→E steht so beim Server, E unverändert', endsOf(srv))
	t.check(await until(async () => joins(await itemMap(pb), D, E, RIGHT), { timeout: 8000 }), '[C] bob sieht den Verbinder D→E', endsOf(await itemMap(pb)))

	t.step('(7b) wieder D: die Vorschau zeigt den Nachbarn; der Klick legt F an E vorbei an, mit Verbinder D→F')
	await selectItem(p, D)
	t.must(await until(() => selectedAlone(p, D), { timeout: 3000 }), '[S] der Klick wählt D wieder aus', await K.selection(p))
	const r2 = await plusAt(p, 'plus-r')
	t.must(r2, '[D] plus-r von D liegt frei auf der Leinwand', await K.handles(p))
	await p.mouse.move(r2.x - 6, r2.y, { steps: 2 })
	await p.mouse.move(r2.x, r2.y, { steps: 2 })
	t.check(await until(async () => {
		const v = await previewOf(p)
		return v?.kind === 'neighbour' && v.box?.x === E47_F.x && v.box?.y === E47_F.y
	}, { timeout: 3000 }), `[S] die Maus über plus-r zeigt den Nachbarn bei (${E47_F.x}, ${E47_F.y}): D→E zählt als verbunden`, await previewOf(p))
	const before2 = await idSet(p)
	await p.mouse.click(r2.x, r2.y)
	const n2 = await fresh(p, before2, ['sticky', 'connector'])
	t.must(n2, '[S] der Klick legt genau eine neue Notiz F und einen Verbinder an', [...(await itemMap(p)).values()].filter((it) => !before2.has(it.id)).map((it) => it.t))
	const F = n2.item
	t.check(F.x === E47_F.x && F.y === E47_F.y, `[S] F liegt bei (${E47_F.x}, ${E47_F.y}), ${E47_GAP} hinter E`, [F.x, F.y])
	t.check(joins(await itemMap(p), D, F.id, RIGHT), '[S] ein Verbinder D→F (Anker r/l, rechtwinklig, Pfeil)', endsOf(await itemMap(p)))
	t.check(await until(() => selectedAlone(p, F.id), { timeout: 3000 }), '[C] F ist allein ausgewählt', await K.selection(p))
	await settle([p, pb])
	const srv2 = await serverMap('alice', board)
	t.check(srv2.get(F.id)?.x === E47_F.x && srv2.get(F.id)?.y === E47_F.y && joins(srv2, D, F.id, RIGHT), '[B] F und der Verbinder D→F stehen so beim Server', endsOf(srv2))
	t.check(await until(async () => joins(await itemMap(pb), D, F.id, RIGHT), { timeout: 8000 }), '[C] bob sieht F mit dem Verbinder D→F', endsOf(await itemMap(pb)))
}
