/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Elbow connectors run around the items between their ends (factory job 197).
 *
 * E78 alice (owner, Chromium 1440 × 900, mouse) and bob (shared with "edit",
 * desktop) on alice's board: notes N1 at (0, 0) and N2 at (800, 0), joined
 * by the elbow connector C (N1 → N2), and note N3 at (400, 350) below the
 * line (its centre stays inside the 900 px high window). alice opens at 100 % with world (0, 0) 200 px right of and 260 px
 * below the canvas corner. Only real input (page.mouse). Steps:
 *   (1) both see C as the straight line [200, 100, 800, 100];
 *   (2) alice presses on N3 and drags it up by 350 px in 7 moves, the mouse
 *       still down: C's points (alice) no longer run through N3 (its screen
 *       rectangle), the route is no longer the straight line;
 *   (3) she lets go: C still avoids N3 at alice, and bob shows exactly the
 *       same points within 5 s.
 * Own board, no instance setting: directly after E76, before E09.
 * Flake gate: --only E78 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (route, positions), [B] a server answer, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap
 * 9.10).
 */
import { K, api, put, ulid, seedOps, openBoard, until, sleep } from '../lib/harness.mjs'

/** The camera alice opens with: world (0, 0) 200 px right of and 260 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -200, y: -260, scale: 1 })
const STRAIGHT = [200, 100, 800, 100]

async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** The points of connector `id` on that page (world), or null. */
const pointsOf = async (page, id) => (await K.connector(page, id).catch(() => null))?.points ?? null

/**
 * Does the route (world points) run through the item's screen rectangle?
 * The points go to the screen through the page's own worldToScreen.
 */
async function runsThrough(page, pts, id) {
	const r = await K.rect(page, id)
	if (!r || !Array.isArray(pts)) return null
	const s = []
	for (let i = 0; i + 1 < pts.length; i += 2) s.push(await K.w2s(page, pts[i], pts[i + 1]))
	for (let i = 0; i + 1 < s.length; i++) {
		const a = s[i]
		const b = s[i + 1]
		const horizontal = Math.abs(a.y - b.y) < 0.5
		const hit = horizontal
			? a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w
			: a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h
		if (hit) return true
	}
	return false
}

export const E78 = {
	id: 'E78',
	title: 'Rechtwinklige Verbinder laufen um Elemente herum (Job 197): alice zieht eine Notiz zwischen zwei verbundene Notizen; schon bei gedrückter Maustaste weicht die Linie aus, nach dem Loslassen ebenso, und bob sieht dieselbe Linie',
	async run(t, world) {
		const board = await world.board('E78 Umleitung')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const N1 = ulid()
		const N2 = ulid()
		const N3 = ulid()
		const C = ulid()
		const res = await seedOps('alice', board, [
			put.sticky(N1, { x: 0, y: 0 }), put.sticky(N2, { x: 800, y: 0 }), put.sticky(N3, { x: 400, y: 350 }),
			put.connector(C, { item: N1 }, { item: N2 }, { data: { route: 'elbow' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: drei Notizen und der Verbinder C gesät', res)
		const a = await world.actor('alice-routearound', { user: 'alice' })
		const b = await world.actor('bob-routearound', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			await openBoard(b, board)
			const cam0 = await K.camera(pa)
			t.must(Math.abs(cam0.scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', cam0)

			t.step('(1) beide sehen C als gerade Linie')
			t.check(await until(async () => JSON.stringify(await pointsOf(pa, C)) === JSON.stringify(STRAIGHT), { timeout: 5000 }), '[S] (1) alice: C ist [200, 100, 800, 100]', await pointsOf(pa, C))
			t.check(await until(async () => JSON.stringify(await pointsOf(pb, C)) === JSON.stringify(STRAIGHT), { timeout: 5000 }), '[S] (1) bob: C ist [200, 100, 800, 100]', await pointsOf(pb, C))

			t.step('(2) alice zieht N3 mit der Maus zwischen N1 und N2, die Taste bleibt gedrückt')
			const from = await K.w2s(pa, 500, 450)
			const vp = pa.viewportSize()
			t.must(from.y < vp.height - 20, '[D] Vorbedingung: die Mitte von N3 liegt im Fenster', { from, vp })
			await pa.mouse.move(from.x, from.y)
			await pa.mouse.down()
			for (let i = 1; i <= 7; i++) {
				await pa.mouse.move(from.x, from.y - 50 * i)
				await sleep(30)
			}
			await sleep(200)
			const mid = await pointsOf(pa, C)
			t.check(Array.isArray(mid) && JSON.stringify(mid) !== JSON.stringify(STRAIGHT), '[S] (2) alice: C ist beim Ziehen nicht mehr die gerade Linie', { mid, rect: await K.rect(pa, N3) })
			t.check((await runsThrough(pa, mid, N3)) === false, '[S] (2) alice: C läuft beim Ziehen nicht durch N3', { mid, rect: await K.rect(pa, N3) })

			t.step('(3) alice lässt los; bob sieht dieselbe Linie')
			await pa.mouse.up()
			await K.waitIdle(pa).catch(() => {})
			const after = await pointsOf(pa, C)
			t.check((await runsThrough(pa, after, N3)) === false, '[S] (3) alice: C läuft nach dem Loslassen nicht durch N3', { after, rect: await K.rect(pa, N3) })
			const same = await until(async () => JSON.stringify(await pointsOf(pb, C)) === JSON.stringify(await pointsOf(pa, C)), { timeout: 5000 })
			t.check(same, '[S] (3) bob: C hat dieselben Punkte wie bei alice', { alice: await pointsOf(pa, C), bob: await pointsOf(pb, C) })
			t.check((await runsThrough(pb, await pointsOf(pb, C), N3)) === false, '[S] (3) bob: C läuft nicht durch N3', await pointsOf(pb, C))
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
