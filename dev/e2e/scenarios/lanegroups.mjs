/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Lane and column groups (factory job 225).
 *
 * E91 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own with a frame F of
 * three lanes and two columns (seeded) and note N in lane 2. Steps:
 *   (1) alice opens the menu on the head of lane 1, chooses "Create lane
 *       group", types "Team" and Enter: bob's __knorke.scene().lanes shows
 *       the group cell (gw 48) at the latest 3 s after her click, then the
 *       group "Team" over lane 1; N lies 48 further right, at both;
 *   (2) alice selects F and drags the bottom edge of the group's cell over
 *       lane 2: both lanes are in the group, at both;
 *   (3) alice drags the group's cell below lane 3: N (lane 2) moves down by
 *       lane 3's height, at both; Ctrl+Z puts it back, at both;
 *   (4) "Dissolve lane group": gw 0 again, N at its first x, at both and at
 *       the server;
 *   (5) "Create column group" on the head of column 1: bob sees cg 48.
 * Own board, no instance setting: before E09, directly after E86. Flake
 * gate: --only E91 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (menu, editor, cell and edge drags), [C] session and sync (what reaches
 * the other one, undo), [B] the server, [D] a harness precondition. Waiting
 * polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, openBoard, until, settle, itemMap, serverMap, dragPath } from '../lib/harness.mjs'

/** The camera both open with: world (0, 0) 600 px right of and 120 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -120, scale: 1 })
/** The frame (world): 700 × 420 from (-500, 0): the head row (60), three lanes of 120, two columns of 270. */
const R = Object.freeze({ x: -500, y: 0, w: 700, h: 420 })
const LANES = Object.freeze({ l00000001: { o: 'i0', h: 120, t: 'Kunde' }, l00000002: { o: 'i1', h: 120, t: 'Vertrieb' }, l00000003: { o: 'i2', h: 120, t: 'Service' } })
const COLS = Object.freeze({ c00000001: { o: 'i0', w: 270, t: 'Plan' }, c00000002: { o: 'i1', w: 270, t: 'Bau' } })
/** AK8: bob sees the group cell at the latest this long after alice's click. */
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

/** The scene's entry of F in stats().lanes ({id, head, top, gw, cg, lanes, cols, groups, cgroups}), or null. */
async function sceneLanes(page, id) {
	const s = await K.scene(page).catch(() => null)
	return (s?.lanes ?? []).find((x) => x.id === id) ?? null
}

/** Client point in the name cell of lane i (0-based) of F (right of a group's cell). */
async function laneHead(page, id, i) {
	const it = (await itemMap(page)).get(id)
	const st = await sceneLanes(page, id)
	if (!it || !st?.lanes[i]) return null
	return K.w2s(page, it.x + st.gw + 40, it.y + st.lanes[i].y + st.lanes[i].h / 2)
}

/** Client point in the head of column i (0-based) of F. */
async function colHead(page, id, i) {
	const it = (await itemMap(page)).get(id)
	const st = await sceneLanes(page, id)
	if (!it || !st?.cols[i]) return null
	return K.w2s(page, it.x + st.cols[i].x + st.cols[i].w / 2, it.y + st.top - 15)
}

/** Client point in the middle (edge 'mid') or on the bottom edge ('end') of the first lane group's cell of F. */
async function groupCell(page, id, edge = 'mid') {
	const it = (await itemMap(page)).get(id)
	const st = await sceneLanes(page, id)
	const g = st?.groups[0]
	if (!it || !g) return null
	return K.w2s(page, it.x + st.gw / 2, it.y + g.y + (edge === 'end' ? g.h : g.h / 2))
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

export const E91 = {
	id: 'E91',
	title: 'Bahn- und Spaltengruppen (Job 225): alice bildet per Menü eine Bahngruppe „Team“, bob sieht die Gruppenzelle ≤ 3 s, die Notiz rückt um 48; Ziehen der Unterkante nimmt Bahn 2 auf, Ziehen der Zelle nimmt die Notiz mit, Strg+Z zurück; „Dissolve lane group“ stellt alles her; eine Spaltengruppe erscheint bei bob',
	async run(t, world) {
		const board = await world.board('E91 Bahngruppen')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const F = ulid()
		const N = ulid()
		const res = await seedOps('alice', board, [
			put.frame(F, { ...R, data: { title: 'Journey', lanes: LANES, cols: COLS } }),
			put.sticky(N, { x: 250, y: 190, w: 100, h: 100, parent: F, data: { text: 'N' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[D] Vorbedingung: Rahmen F mit 3 Bahnen, 2 Spalten und Notiz N gesät', res)
		const a = await world.actor('alice-gruppen', { user: 'alice' })
		const b = await world.actor('bob-gruppen', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must(await until(async () => (await sceneLanes(pb, F))?.cols.length === 2 && (await itemMap(pb)).has(N), { timeout: 8000 }), '[D] Vorbedingung: beide sehen F und N')
			const x0 = (await itemMap(pa)).get(N).x

			t.step('(1) alice: „Create lane group“ an Bahn 1, Name „Team“')
			t.must(await menuAt(pa, await laneHead(pa, F, 0)), '[S] (1) das Kontextmenü öffnet sich am Kopf von Bahn 1')
			const names = await menuNames(pa)
			t.check(names.includes('lane-group') && names.includes('column-group') && !names.includes('lane-ungroup'), '[S] (1) „Create lane group“ und „Create column group“ im Menü', names)
			await menuItem(pa, 'lane-group')
			const clicked = Date.now()
			t.check(await until(async () => (await pa.locator(EDITOR).count()) > 0, { timeout: 3000 }), '[S] (1) der Editor des Gruppennamens öffnet sich')
			const key = await pa.locator(EDITOR).first().getAttribute('data-knorke-lane')
			t.check(/^g[0-9a-z]{8}$/.test(key ?? ''), '[S] (1) der Editor gehört der neuen Gruppe', key)
			await pa.keyboard.type('Team')
			await pa.keyboard.press('Enter')
			const seen = await until(async () => ((await sceneLanes(pb, F))?.gw === 48 ? Date.now() : null), { timeout: SEEN_MS + 2000, every: 50 })
			t.check(seen !== null && seen - clicked <= SEEN_MS, `[C] (1) bob sieht die Gruppenzelle spätestens ${SEEN_MS} ms nach dem Klick`, seen === null ? null : seen - clicked)
			t.check(await until(async () => {
				const g = (await sceneLanes(pb, F))?.groups ?? []
				return g.length === 1 && g[0].title === 'Team' && JSON.stringify(g[0].lanes) === JSON.stringify(['l00000001'])
			}, { timeout: 5000 }), '[C] (1) bob sieht die Gruppe „Team“ über Bahn 1', await sceneLanes(pb, F))
			t.check(await until(async () => (await itemMap(pb)).get(N)?.x === x0 + 48, { timeout: 3000 }), '[C] (1) N liegt bei bob 48 weiter rechts', (await itemMap(pb)).get(N)?.x)
			t.check((await itemMap(pa)).get(N)?.x === x0 + 48, '[S] (1) und bei alice')
			await settle([pa, pb])

			t.step('(2) alice zieht die Unterkante der Gruppenzelle über Bahn 2')
			const ha = await laneHead(pa, F, 2)
			await pa.mouse.click(ha.x, ha.y)
			t.must(await until(async () => ((await K.selection(pa)) || []).includes(F), { timeout: 3000 }), '[S] (2) alice hat F gewählt')
			const edge = await groupCell(pa, F, 'end')
			await dragPath(pa, edge, { x: edge.x, y: edge.y + 120 }, { steps: 12 })
			t.check(await until(async () => JSON.stringify((await sceneLanes(pb, F))?.groups[0]?.lanes) === JSON.stringify(['l00000001', 'l00000002']), { timeout: 5000 }),
				'[C] (2) beide Bahnen in der Gruppe, bei bob', await sceneLanes(pb, F))
			t.check(JSON.stringify((await sceneLanes(pa, F))?.groups[0]?.lanes) === JSON.stringify(['l00000001', 'l00000002']), '[S] (2) und bei alice')
			await settle([pa, pb])

			t.step('(3) alice zieht die Gruppenzelle unter Bahn 3, Strg+Z zurück')
			const y0 = (await itemMap(pa)).get(N).y
			const cell = await groupCell(pa, F)
			await dragPath(pa, cell, { x: cell.x, y: cell.y + 200 }, { steps: 16 })
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[0]?.key === 'l00000003', { timeout: 5000 }), '[C] (3) Bahn 3 steht bei bob oben', await sceneLanes(pb, F))
			t.check(await until(async () => (await itemMap(pb)).get(N)?.y === y0 + 120, { timeout: 5000 }), '[C] (3) N rückt bei bob mit der Gruppe um 120 nach unten', (await itemMap(pb)).get(N)?.y)
			t.check(await until(async () => (await itemMap(pa)).get(N)?.y === y0 + 120, { timeout: 3000 }), '[C] (3) und bei alice')
			t.check((await itemMap(pa)).get(F)?.x === R.x, '[S] (3) der Rahmen selbst bleibt liegen', (await itemMap(pa)).get(F))
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[0]?.key === 'l00000001' && (await itemMap(pb)).get(N)?.y === y0, { timeout: 5000 }),
				'[C] (3) Strg+Z: Gruppe und N wieder oben, auch bei bob')
			await settle([pa, pb])

			t.step('(4) „Dissolve lane group“: alles wie vorher')
			t.must(await menuAt(pa, await laneHead(pa, F, 0)), '[S] (4) das Kontextmenü am Kopf von Bahn 1')
			t.check((await menuNames(pa)).includes('lane-ungroup'), '[S] (4) „Dissolve lane group“ im Menü')
			await menuItem(pa, 'lane-ungroup')
			t.check(await until(async () => (await sceneLanes(pb, F))?.gw === 0 && (await itemMap(pb)).get(N)?.x === x0, { timeout: 5000 }),
				'[C] (4) bei bob keine Gruppenzelle mehr, N an seinem ersten x', { st: await sceneLanes(pb, F), x: (await itemMap(pb)).get(N)?.x })
			await settle([pa, pb])
			const srv = await serverMap('alice', board)
			t.check(srv.get(N)?.x === x0 && srv.get(F)?.w === R.w && srv.get(F)?.data?.lgroups === undefined, '[B] (4) beim Server auch', { n: srv.get(N)?.x, w: srv.get(F)?.w })

			t.step('(5) „Create column group“ am Kopf von Spalte 1')
			t.must(await menuAt(pa, await colHead(pa, F, 0)), '[S] (5) das Kontextmenü am Kopf von Spalte 1')
			await menuItem(pa, 'column-group')
			t.check(await until(async () => (await pa.locator(EDITOR).count()) > 0, { timeout: 3000 }), '[S] (5) der Editor der Spaltengruppe öffnet sich')
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await sceneLanes(pb, F))?.cg === 48 && (await sceneLanes(pb, F))?.cgroups.length === 1, { timeout: 5000 }),
				'[C] (5) bob sieht die Spaltengruppe (cg 48)', await sceneLanes(pb, F))
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
