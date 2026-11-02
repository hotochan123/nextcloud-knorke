/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Swimlane columns and dragging lane heads (factory job 208).
 *
 * E86 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own with a frame F of
 * three lanes (700 × 360, seeded) and note N in lane 1. Steps:
 *   (1) alice opens the menu on the head of lane 1 and chooses "Add column"
 *       (the first column over the whole width, the head row on top), then
 *       on the head of that column "Add column right": bob's
 *       __knorke.scene().lanes shows F with 2 columns at the latest 3 s
 *       after her click; N lies in lane 1 and column 1;
 *   (2) alice drags the head of column 1 behind column 2: N lies in the
 *       second column at both;
 *   (3) alice drags the head of lane 1 onto lane 3: N lies in the last lane
 *       at both; Ctrl+Z puts lane and note back, at both;
 *   (4) bob selects F and drags the right edge of the first column by +100:
 *       N (in the column right of it) moves 100 to the right, at both and at
 *       the server;
 *   (5) "Delete column" on the head of N's column: one column is left, and N
 *       stays where it was.
 * Own board, no instance setting: before E09, directly after E85. Flake
 * gate: --only E86 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (menu, editor, head drag, edge), [C] session and sync (what reaches the
 * other one, undo), [B] the server, [D] a harness precondition. Waiting
 * polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, openBoard, until, settle, itemMap, serverMap, dragPath } from '../lib/harness.mjs'

/** The camera both open with: world (0, 0) 600 px right of and 120 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -120, scale: 1 })
/** The frame (world): 700 × 360 from (-500, 0), three lanes of 120; 1000 × 420 with two columns, still in the window. */
const R = Object.freeze({ x: -500, y: 0, w: 700, h: 360 })
const LANES = Object.freeze({ l00000001: { o: 'i0', h: 120, t: 'Kunde' }, l00000002: { o: 'i1', h: 120, t: 'Vertrieb' }, l00000003: { o: 'i2', h: 120, t: 'Service' } })
/** AK8: bob sees the second column at the latest this long after alice's click. */
const SEEN_MS = 3000
const MENU = '[data-knorke-menu=context]'
const EDITOR = 'textarea[data-knorke-editor][data-knorke-editor-kind="lane"]'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** The scene's entry of F in stats().lanes ({id, head, top, lanes: [{key, y, h, title}], cols: [{key, x, w, title}]}), or null. */
async function sceneLanes(page, id) {
	const s = await K.scene(page).catch(() => null)
	return (s?.lanes ?? []).find((x) => x.id === id) ?? null
}

/** Client point in the head of lane i (0-based) of F, from the bands the scene draws. */
async function laneHead(page, id, i) {
	const it = (await itemMap(page)).get(id)
	const st = await sceneLanes(page, id)
	if (!it || !st?.lanes[i]) return null
	return K.w2s(page, it.x + 40, it.y + st.lanes[i].y + st.lanes[i].h / 2)
}

/** Client point in the head of column i (0-based) of F. */
async function colHead(page, id, i) {
	const it = (await itemMap(page)).get(id)
	const st = await sceneLanes(page, id)
	if (!it || !st?.cols[i]) return null
	return K.w2s(page, it.x + st.cols[i].x + st.cols[i].w / 2, it.y + st.top / 2)
}

/** The index of the lane (axis 'y') or column ('x') whose band holds the centre of child c of F, or -1. */
async function bandOf(page, id, c, axis) {
	const items = await itemMap(page)
	const st = await sceneLanes(page, id)
	const it = items.get(c)
	if (!st || !it || it.parent !== id) return -1
	if (axis === 'y') {
		const cy = it.y + it.h / 2
		return st.lanes.findIndex((l) => cy >= l.y && cy < l.y + l.h)
	}
	const cx = it.x + it.w / 2
	return st.cols.findIndex((l) => cx >= l.x && cx < l.x + l.w)
}

/** Clicks a menu entry. */
async function menuItem(page, name) {
	await page.locator(`${MENU} button[role="menuitem"][data-knorke-menu-item="${name}"]`).first().click({ timeout: 3000 })
}

/** Right click (real input) at a client point and wait for the menu. */
async function menuAt(page, pt) {
	await page.mouse.move(pt.x, pt.y)
	await page.mouse.click(pt.x, pt.y, { button: 'right' })
	return until(async () => (await page.locator(MENU).count()) > 0, { timeout: 3000 })
}

/** The entries of the open menu. */
async function menuNames(page) {
	return page.locator(`${MENU} button[data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
}

/** Waits for the editor of a new column's name and closes it with Escape. */
async function closeEditor(page) {
	const open = await until(async () => (await page.locator(EDITOR).count()) > 0, { timeout: 3000 })
	await page.keyboard.press('Escape')
	return open
}

export const E86 = {
	id: 'E86',
	title: 'Swimlane-Spalten (Job 208): alice fügt per Menü zwei Spalten ein, bob sieht sie ≤ 3 s; Ziehen am Spaltenkopf nimmt die Notiz in die zweite Spalte mit, Ziehen am Bahnkopf in die letzte Bahn, Strg+Z zurück; bob zieht die rechte Kante der ersten Spalte um 100, die Notiz rückt mit; „Delete column“ lässt sie liegen',
	async run(t, world) {
		const board = await world.board('E86 Swimlane-Spalten')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const F = ulid()
		const N = ulid()
		const res = await seedOps('alice', board, [
			put.frame(F, { ...R, data: { title: 'Journey', lanes: LANES } }),
			put.sticky(N, { x: 200, y: 10, w: 100, h: 100, parent: F, data: { text: 'N' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[D] Vorbedingung: Rahmen F mit 3 Bahnen und Notiz N gesät', res)
		const a = await world.actor('alice-spalten', { user: 'alice' })
		const b = await world.actor('bob-spalten', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must(await until(async () => (await sceneLanes(pb, F))?.lanes.length === 3 && (await itemMap(pb)).has(N), { timeout: 8000 }), '[D] Vorbedingung: beide sehen F und N')

			t.step('(1) alice: „Add column“, dann „Add column right“')
			t.must(await menuAt(pa, await laneHead(pa, F, 0)), '[S] (1) das Kontextmenü öffnet sich am Kopf von Bahn 1')
			const first = await menuNames(pa)
			t.check(first.includes('column-add') && !first.includes('column-delete'), '[S] (1) ohne Spalten nur „Add column“', first)
			await menuItem(pa, 'column-add')
			t.check(await closeEditor(pa), '[S] (1) der Editor der neuen Spalte öffnet sich')
			t.check(await until(async () => (await sceneLanes(pa, F))?.cols.length === 1, { timeout: 3000 }), '[S] (1) eine Spalte mit Kopfzeile', await sceneLanes(pa, F))
			await settle([pa, pb])
			t.must(await menuAt(pa, await colHead(pa, F, 0)), '[S] (1) das Kontextmenü am Kopf der Spalte')
			const second = await menuNames(pa)
			t.check(JSON.stringify(second.filter((x) => x.startsWith('column-') && !x.includes('group'))) === JSON.stringify(['column-rename', 'column-left', 'column-right', 'column-delete']),
				'[S] (1) die Spalteneinträge einer einzigen Spalte', second)
			await menuItem(pa, 'column-right')
			const clicked = Date.now()
			await closeEditor(pa)
			const seen = await until(async () => ((await sceneLanes(pb, F))?.cols.length === 2 ? Date.now() : null), { timeout: SEEN_MS + 2000, every: 50 })
			t.check(seen !== null && seen - clicked <= SEEN_MS, `[C] (1) bob sieht F mit 2 Spalten spätestens ${SEEN_MS} ms nach dem Klick`, seen === null ? null : seen - clicked)
			await settle([pa, pb])
			t.check(await bandOf(pb, F, N, 'y') === 0 && await bandOf(pb, F, N, 'x') === 0, '[C] (1) N liegt in Bahn 1 und Spalte 1')

			t.step('(2) alice zieht den Kopf von Spalte 1 hinter Spalte 2')
			const c1 = (await sceneLanes(pa, F)).cols[0].key
			const from2 = await colHead(pa, F, 0)
			const st2 = await sceneLanes(pa, F)
			const f2 = (await itemMap(pa)).get(F)
			const to2 = await K.w2s(pa, f2.x + st2.cols[1].x + st2.cols[1].w * 0.75, f2.y + st2.top / 2)
			await dragPath(pa, from2, to2, { steps: 16 })
			t.check(await until(async () => (await sceneLanes(pb, F))?.cols[1]?.key === c1, { timeout: 5000 }), '[C] (2) Spalte 1 ist bei bob jetzt die zweite', await sceneLanes(pb, F))
			t.check(await until(async () => (await bandOf(pb, F, N, 'x')) === 1, { timeout: 5000 }), '[C] (2) N liegt bei bob in der zweiten Spalte')
			t.check(await until(async () => (await bandOf(pa, F, N, 'x')) === 1, { timeout: 3000 }), '[C] (2) und bei alice')
			t.check((await itemMap(pa)).get(F)?.x === R.x, '[S] (2) der Rahmen selbst bleibt liegen', (await itemMap(pa)).get(F))
			await settle([pa, pb])

			t.step('(3) alice zieht den Kopf von Bahn 1 auf Bahn 3, Strg+Z zurück')
			const l1 = (await sceneLanes(pa, F)).lanes[0].key
			await dragPath(pa, await laneHead(pa, F, 0), await laneHead(pa, F, 2), { steps: 16 })
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[2]?.key === l1 && (await bandOf(pb, F, N, 'y')) === 2, { timeout: 5000 }),
				'[C] (3) Bahn 1 und N liegen bei bob unten', await sceneLanes(pb, F))
			t.check(await until(async () => (await bandOf(pa, F, N, 'y')) === 2, { timeout: 3000 }), '[C] (3) und bei alice')
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[0]?.key === l1 && (await bandOf(pb, F, N, 'y')) === 0, { timeout: 5000 }),
				'[C] (3) Strg+Z: Bahn 1 und N wieder oben, auch bei bob')
			await settle([pa, pb])

			t.step('(4) bob zieht die rechte Kante der ersten Spalte um 100 nach rechts')
			const hb = await laneHead(pb, F, 1)
			await pb.mouse.click(hb.x, hb.y)
			t.must(await until(async () => ((await K.selection(pb)) || []).includes(F), { timeout: 3000 }), '[S] (4) bob hat F gewählt')
			const fb = (await itemMap(pb)).get(F)
			const stb = await sceneLanes(pb, F)
			const nX = (await itemMap(pb)).get(N).x
			const edge = await K.w2s(pb, fb.x + stb.cols[0].x + stb.cols[0].w, fb.y + stb.lanes[1].y + stb.lanes[1].h / 2)
			await dragPath(pb, edge, { x: edge.x + 100, y: edge.y }, { steps: 12 })
			t.check(await until(async () => (await sceneLanes(pb, F))?.cols[0]?.w === stb.cols[0].w + 100, { timeout: 3000 }), '[S] (4) die erste Spalte ist 100 breiter (scene().lanes)', await sceneLanes(pb, F))
			t.check(await until(async () => (await itemMap(pa)).get(N)?.x === nX + 100, { timeout: 5000 }), '[C] (4) N rückt bei alice um 100', (await itemMap(pa)).get(N)?.x)
			t.check(await until(async () => (await itemMap(pb)).get(N)?.x === nX + 100, { timeout: 3000 }), '[C] (4) und bei bob')
			await settle([pa, pb])
			const srv4 = await serverMap('alice', board)
			t.check(srv4.get(N)?.x === nX + 100 && srv4.get(F)?.w === fb.w + 100, '[B] (4) beim Server auch', { n: srv4.get(N)?.x, w: srv4.get(F)?.w })

			t.step('(5) „Delete column“ am Kopf von Ns Spalte: N bleibt liegen')
			const kept = (await itemMap(pa)).get(N)
			t.must(await menuAt(pa, await colHead(pa, F, 1)), '[S] (5) das Kontextmenü am Kopf der zweiten Spalte')
			await menuItem(pa, 'column-delete')
			t.check(await until(async () => (await sceneLanes(pb, F))?.cols.length === 1, { timeout: 5000 }), '[C] (5) „Delete column“: 1 Spalte, auch bei bob')
			await settle([pa, pb])
			const now = (await itemMap(pb)).get(N)
			t.check(now?.x === kept.x && now?.y === kept.y, '[C] (5) N bleibt, wo es war', { kept: [kept.x, kept.y], now: [now?.x, now?.y] })
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
