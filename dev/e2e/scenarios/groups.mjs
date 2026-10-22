/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Group items (factory job 026, M2 SPEC-M1 §1.2 "(R20) Gruppieren").
 *
 * E42 alice's own board, bob through the edit link (an account, link
 *   member), both on the desktop (1440 × 900). Notes A (0, 0), B (300, 0),
 *   C (0, 600) and a frame F (1100, 0, 800 × 600). Steps:
 *   (1) alice selects A and B (click, Shift+click) and presses Ctrl+G: the
 *       server shows A and B with the same group ≠ null, C with null
 *       (serverMap and alice's serverItems()); bob's items() the same;
 *   (2) alice clicks the empty canvas, then A: selection() holds A and B,
 *       scene().groupOutlines = 1, handles() exactly the four corners; a
 *       second click (after the double-click time) → only A; a double
 *       click on B → scene().editing = B; the group selected again (A
 *       current), Enter on the canvas → selection [A] and scene().editing
 *       = A (round 1: the keyboard double click narrows first);
 *   (3) alice drags the group (pressed on A) by 100 world units with
 *       Ctrl (no snapping): A and B moved by 100 locally and at the server,
 *       C not; then into F: parent = F for A and B;
 *   (4) alice selects the group and C (outside F):
 *       [data-knorke-action=group] carries aria-disabled="true"; Ctrl+G
 *       shows [data-knorke-toast=group-blocked], the groups stay;
 *   (5) alice selects the group, Ctrl+D: two new items with a common group
 *       other than the old one (Ctrl+Z takes them away again: at +20/+20
 *       they would cover A's centre for the next steps);
 *   (6) alice deletes A (second click, Del; with [A] the bar shows
 *       [data-knorke-action=ungroup] and no [data-knorke-action=group],
 *       round 1): B has group null; Ctrl+Z brings A back, A and B share a
 *       group again;
 *   (7) a right click on A → [data-knorke-menu-item=ungroup] dissolves the
 *       group (both null); Ctrl+Z groups again;
 *   (8) Ctrl+Shift+L on the group locks both; a drag moves nothing.
 * E42@390x844 (pass, mechanics of E41@390x844 with the finger of E39: a
 *   touch context that reports a fine pointer, so the phone edits): a tap
 *   on a member selects both; [data-knorke-action=ungroup] lies wholly in
 *   the viewport and is at least 44 × 44 CSS px; a tap on it dissolves the
 *   group at the server.
 *   Own boards, no instance setting: before E09, directly after
 *   E41@390x844.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection, drag, handles, outline, editor), [C] shell and session (bar,
 * menu, toasts, keys through the session, the other client), [B] stored
 * server state, [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import {
	K, APP, PHONE, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, waitReady, until, sleep, centerOf, selectItem,
	dragPath, settle, TRANSFORM_HANDLES,
} from '../lib/harness.mjs'

/** Longer than the double-click time of the browsers (500 ms): two clicks, no double click. */
const APART_MS = 700

/** The edit link of a board (route 9 as alice). */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** An account opens /p/<token> (becomes a link member) and lands in the board. */
async function joinAsMember(actor, token) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await waitReady(actor.page, 30000)
}

/** Is the canvas the element at this client point (no bar over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })

/** The groups of the given ids in a Map of items (null for a missing item or no group). */
const groupsIn = (map, ids) => ids.map((id) => map.get(id)?.group ?? null)

/** Same ids, any order. */
function sameIds(a, b) {
	return Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x))
}

/** A free point of the canvas (no item, no bar): the world point (wx, wy) on screen when the canvas lies there. */
async function freePoint(page, wx, wy) {
	const p = await K.w2s(page, wx, wy)
	return (await canvasAt(page, p.x, p.y)) ? p : null
}

/** Drags from the centre of `id` by (dx, dy) WORLD units with Ctrl held (no snapping, R12). */
async function dragWorld(page, id, dx, dy) {
	const c = await centerOf(page, id)
	const s = (await K.camera(page)).scale
	await dragPath(page, c, { x: c.x + dx * s, y: c.y + dy * s }, { mods: ['Control'] })
}

/** Clicks a member twice with a pause (no double click): the second click narrows to it. */
async function secondClick(page, id) {
	await sleep(APART_MS)
	await selectItem(page, id)
}

export const E42 = {
	id: 'E42',
	title: 'Gruppieren (Job 026): Strg+G gruppiert A und B für beide Clients, ein Klick wählt die Gruppe (ein Umriss, vier Ecken), der zweite das Mitglied, Doppelklick bearbeitet; die Gruppe zieht als Ganzes und wandert in einen Frame; verschiedene Elternteile sperren Gruppieren (Hinweis, Toast); Strg+D gibt eine neue Gruppe; Löschen löst auf, Strg+Z gruppiert wieder; Lösen über das Kontextmenü; Strg+Umschalt+L sperrt beide',
	async run(t, world) {
		const board = await world.board('E42 Gruppieren')
		const [A, B, C, F] = [ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: 0, y: 0, data: { text: 'A' } }), put.sticky(B, { x: 300, y: 0, data: { text: 'B' } }),
			put.sticky(C, { x: 0, y: 600, data: { text: 'C' } }), put.frame(F, { x: 1100, y: 0, w: 800, h: 600, data: { title: 'F' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notizen A, B, C und Frame F', res)
		const L = await linkToken(board)
		const alice = await world.actor('alice-gruppen', { user: 'alice' })
		const bob = await world.actor('bob-gruppen', { user: 'bob' })
		const pa = alice.page
		const pb = bob.page
		try {
			await openBoard(alice, board)
			await joinAsMember(bob, L)
			for (const p of [pa, pb]) {
				await p.locator(CANVAS).first().focus()
				await p.keyboard.press('Shift+Digit1')
			}
			await settle([pa, pb])
			const bobState = await K.state(pb)
			t.must(bobState.role === 'edit', '[D] bob ist über den Bearbeitungslink im Board (edit)', bobState)
			await steps(t, pa, pb, board, { A, B, C, F })
		} finally {
			await world.drop(bob)
			await world.drop(alice)
		}
	},
}

/** Steps (1)–(8) of E42 (header). */
async function steps(t, pa, pb, board, { A, B, C, F }) {
	const empty = async () => {
		const p = await freePoint(pa, 700, 450)
		t.must(p, '[D] eine freie Stelle der Leinwand liegt im Bild')
		await pa.mouse.click(p.x, p.y)
	}

	t.step('(1) alice wählt A und B (Klick, Umschalt+Klick) und drückt Strg+G')
	await selectItem(pa, A)
	const cb = await centerOf(pa, B)
	await pa.keyboard.down('Shift')
	await pa.mouse.click(cb.x, cb.y)
	await pa.keyboard.up('Shift')
	t.must(sameIds((await K.selection(pa)) || [], [A, B]), '[S] (1) A und B sind gewählt', await K.selection(pa))
	await pa.keyboard.press('Control+g')
	await settle([pa, pb])
	const s1 = await serverMap('alice', board)
	const [ga, gb, gc] = groupsIn(s1, [A, B, C])
	t.check(typeof ga === 'string' && ga === gb && gc === null, '[B] (1) beim Server tragen A und B dieselbe group ≠ null, C null', { A: ga, B: gb, C: gc })
	const fromAlice = new Map((await K.serverItems(pa)).map((s) => JSON.parse(s)).map((i) => [i.id, i]))
	t.check(deepEqual(groupsIn(fromAlice, [A, B, C]), [ga, ga, null]), '[C] (1) __knorke.serverItems() bei alice zeigt dieselben Gruppen', groupsIn(fromAlice, [A, B, C]))
	t.check(await until(async () => deepEqual(groupsIn(await itemMap(pb), [A, B, C]), [ga, ga, null]), { timeout: 5000 }), '[C] (1) bei bob zeigt items() dasselbe', groupsIn(await itemMap(pb), [A, B, C]))
	const G = ga

	t.step('(2) Klick ins Leere, Klick auf A, zweiter Klick, Doppelklick auf B')
	await empty()
	await selectItem(pa, A)
	t.check(sameIds((await K.selection(pa)) || [], [A, B]), '[S] (2) ein Klick auf A wählt A und B', await K.selection(pa))
	t.check(await until(async () => ((await K.scene(pa))?.groupOutlines ?? 0) === 1, { timeout: 3000 }), '[S] (2) scene().groupOutlines = 1', await K.scene(pa))
	const hs = ((await K.handles(pa)) || []).map((h) => h.name).sort()
	t.check(deepEqual(hs, ['bl', 'br', 'tl', 'tr']), '[S] (2) handles() hat genau die vier Ecken', hs)
	await secondClick(pa, A)
	t.check(sameIds((await K.selection(pa)) || [], [A]), '[S] (2) ein zweiter Klick wählt nur A', await K.selection(pa))
	t.check(((await K.scene(pa))?.groupOutlines ?? -1) === 0, '[S] (2) bei [A] kein Gruppen-Umriss', await K.scene(pa))
	const c2 = await centerOf(pa, B)
	await pa.mouse.dblclick(c2.x, c2.y)
	t.check(await until(async () => (await K.scene(pa))?.editing === B, { timeout: 3000 }), '[S] (2) ein Doppelklick auf B öffnet den Editor von B', (await K.scene(pa))?.editing)
	await pa.keyboard.press('Escape')
	await until(async () => (await K.scene(pa))?.editing === null, { timeout: 3000 })
	// round 1 (UX B2): Enter on exactly one group narrows to the current item, then its editor
	await empty()
	await selectItem(pa, A)
	t.must(sameIds((await K.selection(pa)) || [], [A, B]), '[S] (2) die Gruppe ist wieder gewählt', await K.selection(pa))
	await pa.locator(CANVAS).first().focus()
	await pa.keyboard.press('Enter')
	t.check(await until(async () => (await K.scene(pa))?.editing === A, { timeout: 3000 }), '[S] (2) Enter auf der Gruppe öffnet den Editor von A (aktuelles Objekt)', (await K.scene(pa))?.editing)
	t.check(sameIds((await K.selection(pa)) || [], [A]), '[S] (2) Enter verkleinert die Auswahl auf A wie der zweite Klick', await K.selection(pa))
	await pa.keyboard.press('Escape')
	await until(async () => (await K.scene(pa))?.editing === null, { timeout: 3000 })

	t.step('(3) alice zieht die Gruppe um 100 und dann in den Frame F')
	await empty()
	await selectItem(pa, A)
	const before3 = await serverMap('alice', board)
	await dragWorld(pa, A, 100, 0)
	await settle([pa, pb])
	const s3 = await serverMap('alice', board)
	const moved = (id) => Math.round((s3.get(id)?.x ?? NaN) - (before3.get(id)?.x ?? NaN))
	t.check(moved(A) === 100 && moved(B) === 100 && s3.get(C)?.x === before3.get(C)?.x, '[B] (3) beim Server sind A und B um 100 verschoben, C nicht', { A: moved(A), B: moved(B), C: [before3.get(C)?.x, s3.get(C)?.x] })
	const local = await itemMap(pa)
	t.check(Math.round(local.get(A).x - before3.get(A).x) === 100 && Math.round(local.get(B).x - before3.get(B).x) === 100, '[S] (3) lokal sind A und B um 100 verschoben', [local.get(A).x, local.get(B).x])
	// into F: the union of A and B (100..600) by +1100 → 1200..1700, its centre lies in F (1100..1900)
	await dragWorld(pa, A, 1100, 100)
	await settle([pa, pb])
	const s3b = await serverMap('alice', board)
	t.check(s3b.get(A)?.parent === F && s3b.get(B)?.parent === F, '[B] (3) nach dem Ziehen in F: parent = F bei A und B', { A: s3b.get(A)?.parent, B: s3b.get(B)?.parent })

	t.step('(4) alice wählt die Gruppe und C: Gruppieren gesperrt')
	await empty()
	await selectItem(pa, A)
	const cc = await centerOf(pa, C)
	await pa.keyboard.down('Shift')
	await pa.mouse.click(cc.x, cc.y)
	await pa.keyboard.up('Shift')
	t.must(sameIds((await K.selection(pa)) || [], [A, B, C]), '[S] (4) die Gruppe und C sind gewählt', await K.selection(pa))
	t.must(await appears(pa, '[data-knorke-action=group]'), '[C] (4) Group items ist in der Leiste')
	const disabled = await pa.locator('[data-knorke-action=group]').first().getAttribute('aria-disabled')
	t.check(disabled === 'true', '[C] (4) [data-knorke-action=group] trägt aria-disabled="true"', disabled)
	const hint = await pa.locator('[data-knorke-action=group]').first().getAttribute('title')
	t.check(typeof hint === 'string' && hint.includes('same frame'), '[C] (4) der title nennt den Grund', hint)
	await pa.locator(CANVAS).first().focus()
	await pa.keyboard.press('Control+g')
	t.check(await appears(pa, '[data-knorke-toast=group-blocked]', 3000), '[C] (4) Strg+G zeigt [data-knorke-toast=group-blocked]')
	await settle([pa, pb])
	const s4 = await serverMap('alice', board)
	t.check(deepEqual(groupsIn(s4, [A, B, C]), [G, G, null]), '[B] (4) die Gruppen sind unverändert', groupsIn(s4, [A, B, C]))

	t.step('(5) alice wählt die Gruppe und drückt Strg+D')
	await empty()
	await selectItem(pa, A)
	const ids5 = new Set(s4.keys())
	await pa.keyboard.press('Control+d')
	await settle([pa, pb])
	const s5 = await serverMap('alice', board)
	const fresh = [...s5.values()].filter((i) => !ids5.has(i.id))
	t.check(fresh.length === 2 && typeof fresh[0].group === 'string' && fresh[0].group === fresh[1].group && fresh[0].group !== G, '[B] (5) zwei neue Objekte mit gemeinsamer group, nicht der alten', fresh.map((i) => [i.id, i.group]))
	// the copies lie over A's centre (+20/+20): Ctrl+Z takes them away again for the next steps
	await pa.keyboard.press('Control+z')
	await settle([pa, pb])
	const s5b = await serverMap('alice', board)
	t.must(fresh.every((i) => !s5b.has(i.id)), '[B] (5) Strg+Z nimmt die Kopien wieder weg', fresh.map((i) => [i.id, s5b.has(i.id)]))

	t.step('(6) alice löscht A (zweiter Klick, Entf), dann Strg+Z')
	await empty()
	await selectItem(pa, A)
	await secondClick(pa, A)
	t.must(sameIds((await K.selection(pa)) || [], [A]), '[S] (6) nur A ist gewählt', await K.selection(pa))
	const barOf = async () => ({ group: await pa.locator('[data-knorke-action=group]').count(), ungroup: await pa.locator('[data-knorke-action=ungroup]').count() })
	t.check(await until(async () => deepEqual(await barOf(), { group: 0, ungroup: 1 }), { timeout: 3000 }), '[C] (6) bei [A] zeigt die Leiste Ungroup und kein Group items (round 1)', await barOf())
	await pa.locator(CANVAS).first().focus()
	await pa.keyboard.press('Delete')
	await settle([pa, pb])
	const s6 = await serverMap('alice', board)
	t.check(!s6.has(A) && s6.get(B)?.group === null, '[B] (6) A ist weg, B hat group null', { A: s6.has(A), B: s6.get(B)?.group })
	await pa.keyboard.press('Control+z')
	await settle([pa, pb])
	const s6b = await serverMap('alice', board)
	t.check(s6b.has(A) && typeof s6b.get(A)?.group === 'string' && s6b.get(A).group === s6b.get(B)?.group, '[B] (6) Strg+Z bringt A zurück, A und B haben wieder dieselbe group', groupsIn(s6b, [A, B]))

	t.step('(7) Rechtsklick auf A → Gruppierung aufheben, dann Strg+Z')
	const c7 = await centerOf(pa, A)
	await pa.mouse.click(c7.x, c7.y, { button: 'right' })
	t.must(await appears(pa, '[data-knorke-menu-item=ungroup]', 3000), '[C] (7) der Rechtsklick zeigt [data-knorke-menu-item=ungroup]')
	await pa.locator('[data-knorke-menu-item=ungroup]').first().click()
	await settle([pa, pb])
	const s7 = await serverMap('alice', board)
	t.check(deepEqual(groupsIn(s7, [A, B]), [null, null]), '[B] (7) A und B haben group null', groupsIn(s7, [A, B]))
	await pa.locator(CANVAS).first().focus()
	await pa.keyboard.press('Control+z')
	await settle([pa, pb])
	const s7b = await serverMap('alice', board)
	t.check(typeof s7b.get(A)?.group === 'string' && s7b.get(A).group === s7b.get(B)?.group, '[B] (7) Strg+Z gruppiert wieder', groupsIn(s7b, [A, B]))

	t.step('(8) Strg+Umschalt+L auf der Gruppe, dann ein Ziehen')
	await empty()
	await selectItem(pa, A)
	t.must(sameIds((await K.selection(pa)) || [], [A, B]), '[S] (8) die Gruppe ist gewählt', await K.selection(pa))
	await pa.keyboard.press('Control+Shift+L')
	await settle([pa, pb])
	const s8 = await serverMap('alice', board)
	t.check(s8.get(A)?.lock !== null && s8.get(B)?.lock !== null, '[B] (8) beide sind gesperrt', { A: s8.get(A)?.lock, B: s8.get(B)?.lock })
	await dragWorld(pa, A, 100, 0)
	await settle([pa, pb])
	const s8b = await serverMap('alice', board)
	t.check(s8b.get(A)?.x === s8.get(A)?.x && s8b.get(B)?.x === s8.get(B)?.x, '[B] (8) ein Ziehen bewegt nichts', { A: [s8.get(A)?.x, s8b.get(A)?.x], B: [s8.get(B)?.x, s8b.get(B)?.x] })
}

/** @return {boolean} equal as JSON */
function deepEqual(a, b) {
	return JSON.stringify(a) === JSON.stringify(b)
}

/** One finger down and up (CDP touch events, like touch.mjs E39). */
async function cdpTap(cdp, x, y, hold = 60) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
	await sleep(hold)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/**
 * The phone pass of E42: a tap on a member selects the group; Ungroup in
 * the viewport, finger-sized, and a tap on it dissolves the group.
 */
export const E42_PHONE = {
	id: 'E42',
	pass: `${PHONE.width}x${PHONE.height}`,
	title: `Gruppieren bei ${PHONE.width} × ${PHONE.height} mit dem Finger: ein Tipp auf ein Mitglied wählt die Gruppe, Ungroup liegt im Viewport und ist mindestens 44 × 44 px, ein Tipp darauf löst die Gruppe`,
	async run(t, world) {
		const board = await world.board('E42 Gruppieren Handy')
		const [A, B, G] = [ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [put.sticky(A, { x: 0, y: 0, group: G, data: { text: 'A' } }), put.sticky(B, { x: 300, y: 0, group: G, data: { text: 'B' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: A und B in einer Gruppe', res)
		const a = await world.actor(`alice-gruppen-${PHONE.width}`, { user: 'alice', touch: true, viewport: PHONE, fine: true })
		const p = a.page
		try {
			await openBoard(a, board)
			const st = await K.state(p)
			t.must(st.uiMode === 'edit', '[D] das Handy ist im Modus edit (Touch mit feinem Zeiger, wie E39)', { uiMode: st.uiMode, viewOnly: st.viewOnly })
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Shift+Digit1')
			await K.waitIdle(p)
			const cdp = await a.ctx.newCDPSession(p)
			const ca = await centerOf(p, A)
			t.must(await canvasAt(p, ca.x, ca.y), '[D] die Mitte von A liegt frei auf der Leinwand', ca)
			await cdpTap(cdp, ca.x, ca.y)
			t.check(await until(async () => sameIds((await K.selection(p)) || [], [A, B]), { timeout: 3000 }), '[S] ein Tipp auf A wählt A und B', await K.selection(p))
			t.must(await appears(p, '[data-knorke-action=ungroup]', 3000), '[C] Ungroup ist in der Leiste sichtbar')
			const ub = await p.locator('[data-knorke-action=ungroup]').first().boundingBox()
			const vp = await p.evaluate(() => ({ vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight }))
			t.check(ub && ub.x >= 0 && ub.y >= 0 && ub.x + ub.width <= vp.vw && ub.y + ub.height <= vp.vh, '[C] [data-knorke-action=ungroup] liegt ganz im Viewport', { ub, vp })
			t.check(ub && ub.width >= 44 && ub.height >= 44, '[C] [data-knorke-action=ungroup] ist mindestens 44 × 44 CSS-px groß', ub)
			await p.locator('[data-knorke-action=ungroup]').first().tap()
			await K.waitIdle(p)
			const s = await serverMap('alice', board)
			t.check(deepEqual(groupsIn(s, [A, B]), [null, null]), '[B] ein Tipp auf Ungroup löst die Gruppe', groupsIn(s, [A, B]))
		} finally {
			await world.drop(a)
		}
	},
}
