/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Swimlanes (factory job 199).
 *
 * E80 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own with note N where
 * lane 1 will be and note M where lane 3 will be. Steps:
 *   (1) alice chooses "Swimlanes" among the variants of the frame tool
 *       (job 229: a right-click on [data-knorke-tool=frame],
 *       [data-knorke-tool-option=lanes])
 *       and drags a frame over N and M: a frame F with three lanes, N and M
 *       its children; bob's __knorke.scene().lanes shows F with 3 lanes at
 *       the latest 3 s after her release;
 *   (2) alice double-clicks the head of lane 1 (the editor kind lane),
 *       types "Sales" and presses Enter: bob sees the name in scene().lanes;
 *       (job 234) the editor stands turned by -90°, the head is 48 wide and
 *       "Sales" drawn at 20;
 *  (2b) (job 234) alice names lane 2 "Customer service and complaints": bob
 *       sees it drawn smaller than 20 (fs in scene().lanes, at least 12);
 *   (3) the menu on the head of lane 1 has the lane entries in order;
 *       "Move lane down" puts lane 1 second and N into the second band, at
 *       both; Ctrl+Z puts both back;
 *   (4) bob selects F and drags the line below lane 1 by +100: lane 1 is
 *       100 higher and M 100 lower, at both and at the server;
 *   (5) alice's "+" below F gives 4 lanes; "Delete lane" on the new one
 *       gives 3 again, and N and M stay where they are.
 * Own board, no instance setting: before E09, directly after E78 (E79 is
 * job 198's). Flake gate: --only E80 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (tool, editor, handles, border, menu), [C] session and sync (what reaches
 * the other one, undo), [B] the server, [D] a harness precondition. Waiting
 * polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, openBoard, until, settle, itemMap, idSet, serverMap, dragPath } from '../lib/harness.mjs'

/** The camera both open with: world (0, 0) 600 px right of and 120 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -120, scale: 1 })
/**
 * The frame alice drags (world): 900 × 450 from (-300, 0), three lanes of 150; 100 higher after (4), its "+"
 * still lies in the 900 px high window.
 */
const R = Object.freeze({ x: -300, y: 0, w: 900, h: 450 })
/** AK7: bob sees the new frame's lanes at the latest this long after alice's release. */
const SEEN_MS = 3000
const MENU = '[data-knorke-menu=context]'
const LANE_ENTRIES = ['lane-rename', 'lane-above', 'lane-below', 'lane-down']
/** (Job 234) A name too long for a lane of 150 at 20. */
const LONG = 'Customer service and complaints'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** The scene's entry of F in stats().lanes ({id, lanes: [{key, y, h, title}]}), or null. */
async function sceneLanes(page, id) {
	const s = await K.scene(page).catch(() => null)
	return (s?.lanes ?? []).find((x) => x.id === id) ?? null
}

/** Client point in the head of lane i (0-based) of F, from the bands the scene draws. */
async function headPoint(page, id, i) {
	const it = (await itemMap(page)).get(id)
	const st = await sceneLanes(page, id)
	if (!it || !st?.lanes[i]) return null
	return K.w2s(page, it.x + 40, it.y + st.lanes[i].y + st.lanes[i].h / 2)
}

/** The index of the lane whose band holds the centre of child c of F, or -1. */
async function laneOfChild(page, id, c) {
	const items = await itemMap(page)
	const st = await sceneLanes(page, id)
	const it = items.get(c)
	if (!st || !it || it.parent !== id) return -1
	const cy = it.y + it.h / 2
	return st.lanes.findIndex((l) => cy >= l.y && cy < l.y + l.h)
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

export const E80 = {
	id: 'E80',
	title: 'Swimlanes (Job 199): alice zieht mit „Swimlanes“ einen Rahmen mit 3 Bahnen über zwei Notizen, bob sieht ihn ≤ 3 s; Doppelklick benennt Bahn 1 „Sales“; „Move lane down“ nimmt Bahn und Notiz mit, Strg+Z zurück; bob zieht die Grenze unter Bahn 1 um 100, die Notiz der unteren Bahn rückt mit; „+“ und „Delete lane“',
	async run(t, world) {
		const board = await world.board('E80 Swimlanes')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const N = ulid()
		const M = ulid()
		const res = await seedOps('alice', board, [
			put.sticky(N, { x: 100, y: 30, w: 100, h: 100, data: { text: 'N' } }),
			put.sticky(M, { x: 100, y: 330, w: 100, h: 100, data: { text: 'M' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[D] Vorbedingung: Notizen N und M gesät', res)
		const a = await world.actor('alice-bahnen', { user: 'alice' })
		const b = await world.actor('bob-bahnen', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must(await until(async () => (await itemMap(pb)).has(M), { timeout: 8000 }), '[D] Vorbedingung: beide sehen N und M')

			t.step('(1) alice wählt „Swimlanes“ und zieht einen Rahmen über N und M')
			await pa.locator('[data-knorke-tool=frame]').first().click({ button: 'right', timeout: 3000 })
			await pa.locator('[data-knorke-tool-option=lanes]').first().click({ timeout: 3000 })
			t.must(await until(async () => (await pa.locator('[data-knorke-tool=frame]').first().getAttribute('aria-pressed')) === 'true', { timeout: 2000 }), '[S] (1) die Option wählt das Rahmenwerkzeug (aria-pressed)')
			const before = await idSet(pa)
			const from = await K.w2s(pa, R.x, R.y)
			const to = await K.w2s(pa, R.x + R.w, R.y + R.h)
			await dragPath(pa, from, to, { steps: 16 })
			const released = Date.now()
			const F = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!before.has(k) && it.t === 'frame') return k
				return null
			}, { timeout: 5000 })
			t.must(F, '[S] (1) das Aufziehen legt einen Rahmen an')
			const seen = await until(async () => ((await sceneLanes(pb, F))?.lanes.length === 3 ? Date.now() : null), { timeout: SEEN_MS + 2000, every: 50 })
			t.check(seen !== null && seen - released <= SEEN_MS, `[C] (1) bob sieht F in scene().lanes mit 3 Bahnen spätestens ${SEEN_MS} ms nach dem Loslassen`, seen === null ? null : seen - released)
			await pa.keyboard.press('Escape')
			await settle([pa, pb])
			const f1 = (await itemMap(pa)).get(F)
			t.check(f1?.w === R.w && f1?.h === R.h && Object.keys(f1?.data?.lanes ?? {}).length === 3, '[C] (1) 900 × 450 mit drei Bahnen', { w: f1?.w, h: f1?.h, lanes: f1?.data?.lanes })
			const items1 = await itemMap(pb)
			t.check(items1.get(N)?.parent === F && items1.get(M)?.parent === F, '[C] (1) N und M liegen im Rahmen (auch bei bob)')
			t.check(await laneOfChild(pb, F, N) === 0 && await laneOfChild(pb, F, M) === 2, '[C] (1) N in Bahn 1, M in Bahn 3')

			t.step('(2) alice benennt Bahn 1 per Doppelklick „Sales“')
			const h1 = await headPoint(pa, F, 0)
			await pa.mouse.dblclick(h1.x, h1.y)
			t.must(await until(async () => (await pa.locator('textarea[data-knorke-editor][data-knorke-editor-kind="lane"]').count()) > 0, { timeout: 3000 }), '[S] (2) der Editor des Bahnnamens ist offen')
			const turned = await pa.locator('textarea[data-knorke-editor][data-knorke-editor-kind="lane"]').first().evaluate((el) => el.style.transform)
			t.check(/rotate\(-90deg\)/.test(turned), '[S] (2) Job 234: der Editor steht um −90° gedreht über dem Kopf', turned)
			await pa.keyboard.press('Control+a')
			await pa.keyboard.type('Sales')
			await pa.keyboard.press('Enter')
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[0]?.title === 'Sales', { timeout: 5000 }), '[C] (2) bob sieht „Sales“ an Bahn 1', await sceneLanes(pb, F))
			const st2 = await sceneLanes(pb, F)
			t.check(st2?.head === 48 && st2?.lanes[0]?.fs === 20, '[S] (2) Job 234: der Kopf ist 48 breit, „Sales“ steht in 20', st2)
			await settle([pa, pb])

			t.step('(2b) Job 234: ein langer Name an Bahn 2 wird kleiner')
			const h2 = await headPoint(pa, F, 1)
			await pa.mouse.dblclick(h2.x, h2.y)
			t.must(await until(async () => (await pa.locator('textarea[data-knorke-editor][data-knorke-editor-kind="lane"]').count()) > 0, { timeout: 3000 }), '[S] (2b) der Editor von Bahn 2 ist offen')
			await pa.keyboard.press('Control+a')
			await pa.keyboard.type(LONG)
			await pa.keyboard.press('Enter')
			t.check(await until(async () => {
				const s = await sceneLanes(pb, F)
				return s?.lanes[1]?.title === LONG && s.lanes[1].fs < 20 && s.lanes[1].fs >= 12
			}, { timeout: 5000 }), '[C] (2b) bob sieht den langen Namen an Bahn 2 kleiner als 20 (höchstens bis 12)', await sceneLanes(pb, F))
			await settle([pa, pb])

			t.step('(3) „Move lane down“ nimmt Bahn 1 und N mit, Strg+Z zurück')
			const key1 = (await sceneLanes(pa, F)).lanes[0].key
			t.must(await menuAt(pa, await headPoint(pa, F, 0)), '[S] (3) das Kontextmenü öffnet sich am Kopf von Bahn 1')
			const names = await pa.locator(`${MENU} button[data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			t.check(JSON.stringify(names.filter((x) => x.startsWith('lane-') && !x.includes('group'))) === JSON.stringify([...LANE_ENTRIES, 'lane-delete']), '[S] (3) die Bahneinträge in Ordnung (die erste Bahn ohne „Move lane up“)', names)
			await menuItem(pa, 'lane-down')
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[1]?.key === key1, { timeout: 5000 }), '[C] (3) Bahn 1 ist bei bob jetzt die zweite')
			t.check(await until(async () => (await laneOfChild(pb, F, N)) === 1, { timeout: 5000 }), '[C] (3) N liegt bei bob im zweiten Band')
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[0]?.key === key1 && (await laneOfChild(pb, F, N)) === 0, { timeout: 5000 }), '[C] (3) Strg+Z: Bahn 1 und N wieder oben, auch bei bob')
			await settle([pa, pb])

			t.step('(4) bob zieht die Grenze unter Bahn 1 um 100 nach unten')
			const hb = await headPoint(pb, F, 1)
			await pb.mouse.click(hb.x, hb.y)
			t.must(await until(async () => ((await K.selection(pb)) || []).includes(F), { timeout: 3000 }), '[S] (4) bob hat F gewählt')
			const fb = (await itemMap(pb)).get(F)
			const stb = await sceneLanes(pb, F)
			const mY = (await itemMap(pb)).get(M).y
			const line = await K.w2s(pb, fb.x + fb.w * 0.75, fb.y + stb.lanes[0].h)
			await dragPath(pb, line, { x: line.x, y: line.y + 100 }, { steps: 12 })
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes[0]?.h === stb.lanes[0].h + 100, { timeout: 3000 }), '[S] (4) Bahn 1 ist 100 höher (scene().lanes)', await sceneLanes(pb, F))
			t.check(await until(async () => (await itemMap(pa)).get(M)?.y === mY + 100, { timeout: 5000 }), '[C] (4) M rückt bei alice um 100', (await itemMap(pa)).get(M)?.y)
			t.check(await until(async () => (await itemMap(pb)).get(M)?.y === mY + 100, { timeout: 3000 }), '[C] (4) und bei bob')
			await settle([pa, pb])
			const srv4 = await serverMap('alice', board)
			t.check(srv4.get(M)?.y === mY + 100 && srv4.get(F)?.h === fb.h + 100, '[B] (4) beim Server auch', { m: srv4.get(M)?.y, h: srv4.get(F)?.h })

			t.step('(5) „+“ gibt 4 Bahnen, „Delete lane“ wieder 3, N und M bleiben')
			const ha = await headPoint(pa, F, 0)
			await pa.mouse.click(ha.x, ha.y)
			t.must(await until(async () => ((await K.handles(pa)) || []).some((x) => x.name === 'lane-add'), { timeout: 3000 }), '[S] (5) der gewählte Rahmen zeigt sein „+“', await K.handles(pa))
			const plus = ((await K.handles(pa)) || []).find((x) => x.name === 'lane-add')
			await pa.mouse.click(plus.x, plus.y)
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes.length === 4, { timeout: 5000 }), '[C] (5) „+“: 4 Bahnen, auch bei bob', { alice: (await sceneLanes(pa, F))?.lanes.length, plus })
			await pa.keyboard.press('Escape')
			await settle([pa, pb])
			const where = async () => { const m = await itemMap(pa); return [m.get(N)?.y, m.get(M)?.y] }
			const kept = await where()
			t.must(await menuAt(pa, await headPoint(pa, F, 3)), '[S] (5) das Kontextmenü am Kopf der neuen Bahn')
			await menuItem(pa, 'lane-delete')
			t.check(await until(async () => (await sceneLanes(pb, F))?.lanes.length === 3, { timeout: 5000 }), '[C] (5) „Delete lane“: 3 Bahnen, auch bei bob')
			await settle([pa, pb])
			t.check(JSON.stringify(await where()) === JSON.stringify(kept) && (await itemMap(pb)).has(N) && (await itemMap(pb)).has(M), '[C] (5) N und M bleiben, wo sie waren', { kept, now: await where() })
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
