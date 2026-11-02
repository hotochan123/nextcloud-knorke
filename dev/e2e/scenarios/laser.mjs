/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Laser pointer (factory job 171).
 *
 * E61 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own with note N at
 * (0, 0). Steps:
 *   (1) bob presses K with the canvas focus: his tool is laser;
 *   (2) bob drags with the left button for 1.5 s over empty canvas: alice's
 *       __knorke.scene().lasers holds bob's key '<pid>:<client>' at the
 *       latest 2.5 s after bob's press, and her laser canvas shows pixels;
 *       at the latest 4 s after bob's release it is gone; bob's tool stays
 *       laser, items() of both stay as they were and are the same;
 *   (3) alice presses C (other people's cursors hidden): bob draws again,
 *       alice sees his trail the same way (≤ 2.5 s after the press, gone
 *       ≤ 4 s after the release).
 * Own board, no instance setting: before E09, directly after E60.
 * Flake gate: --only E61 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (tool, drawing), [C] session and presence (the trail reaching alice,
 * items), [D] a harness precondition. Waiting polls from Node with until()
 * (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, openBoard, until, sleep } from '../lib/harness.mjs'

/** The camera both open with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Bob's stroke over empty canvas (world): from A to B. */
const FROM = Object.freeze({ x: 300, y: 250 })
const TO = Object.freeze({ x: 600, y: 350 })
/** How long bob holds the button (ms) and how many moves he makes meanwhile. */
const HOLD_MS = 1500
const MOVES = 30
/** AK9: alice sees the trail at the latest this long after bob's press … */
const SHOW_MS = 2500
/** … and it is gone at the latest this long after his release. */
const GONE_MS = 4000

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

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

/** The trails alice's scene painted in its last frame (stats().lasers). */
const lasersOf = async (page) => ((await K.scene(page).catch(() => null)) || {}).lasers || []

/** Pixels with some opacity on the laser canvas of a page (-1 without one). */
const laserPixels = (page) => page.evaluate(() => {
	const c = document.querySelector('canvas.knorke-laser')
	if (!c || !c.width || !c.height) return -1
	const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
	let n = 0
	for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
	return n
}).catch(() => -1)

/**
 * Bob's stroke: the left button down at FROM, MOVES moves to TO within HOLD_MS, up.
 *
 * @return {Promise<{down: number, up: number}>} Date.now() at the press and at the release
 */
async function stroke(pb, from, to) {
	await pb.mouse.move(from.x, from.y)
	await pb.mouse.down()
	const down = Date.now()
	for (let i = 1; i <= MOVES; i++) {
		await pb.mouse.move(from.x + (to.x - from.x) * i / MOVES, from.y + (to.y - from.y) * i / MOVES)
		const left = down + HOLD_MS * i / MOVES - Date.now()
		if (left > 0) await sleep(left)
	}
	await pb.mouse.up()
	return { down, up: Date.now() }
}

/**
 * One stroke of bob and what alice sees of it: when bob's key first shows in her lasers (ms after
 * the press), the pixels of her laser canvas then, and when it is gone (ms after the release).
 */
async function watch(pa, pb, key, from, to) {
	let seenAt = null
	let pixels = -1
	const watcher = (async () => {
		const t0 = Date.now()
		while (Date.now() - t0 < HOLD_MS + SHOW_MS + 1000 && seenAt === null) {
			if ((await lasersOf(pa)).includes(key)) {
				seenAt = Date.now()
				pixels = await laserPixels(pa)
			} else {
				await sleep(50)
			}
		}
	})()
	const { down, up } = await stroke(pb, from, to)
	await watcher
	const gone = await until(async () => !(await lasersOf(pa)).includes(key), { timeout: GONE_MS + 2000, every: 100 })
	return { shownMs: seenAt === null ? null : seenAt - down, pixels, goneMs: gone ? Date.now() - up : null }
}

export const E61 = {
	id: 'E61',
	title: 'Laserpointer (Job 171): bob wählt mit K den Laser und zieht 1,5 s über leere Fläche; alice sieht seine Spur (scene().lasers mit bobs Schlüssel) spätestens 2,5 s nach dem Druck und spätestens 4 s nach dem Loslassen nicht mehr; Objekte unverändert, bobs Werkzeug bleibt Laser; mit ausgeblendeten Cursorn (C) ebenso',
	async run(t, world) {
		const board = await world.board('E61 Laserpointer')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, w: 200, h: 200, data: { text: 'N' } })])
		t.must(res.every((x) => x === 'ok'), '[D] Vorbedingung: Notiz N gesät', res)
		const a = await world.actor('alice-laser', { user: 'alice' })
		const b = await world.actor('bob-laser', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			const bobPid = (await K.state(pb)).pid
			t.must(typeof bobPid === 'string' && bobPid !== '', '[D] Vorbedingung: bobs pid', await K.state(pb))
			const from = await K.w2s(pb, FROM.x, FROM.y)
			const to = await K.w2s(pb, TO.x, TO.y)
			t.must(await canvasAt(pb, from.x, from.y) && await canvasAt(pb, to.x, to.y), '[D] Vorbedingung: bobs Strich liegt frei auf der Leinwand', { from, to })
			// bob's key as alice's presence has it (his mouse over the canvas gives him a cursor entry)
			await pb.mouse.move(from.x, from.y)
			let bobKey = null
			const arrived = await until(async () => {
				const s = ((await K.presence(pa).catch(() => null)) || []).find((x) => x.pid === bobPid)
				bobKey = s ? s.key : null
				return bobKey !== null
			}, { timeout: 8000 })
			t.must(arrived, '[D] Vorbedingung: bobs Präsenz ist bei alice angekommen', await K.presence(pa))
			const itemsA = await K.items(pa)
			const itemsB = await K.items(pb)
			t.must(JSON.stringify(itemsA) === JSON.stringify(itemsB), '[D] Vorbedingung: beide sehen dieselben Objekte', { itemsA, itemsB })

			t.step('(1) bob drückt K')
			await pb.locator(CANVAS).first().focus()
			await pb.keyboard.press('k')
			t.check((await K.scene(pb)).tool === 'laser', '[S] (1) bobs Werkzeug ist laser', (await K.scene(pb)).tool)
			t.check((await pb.locator('[data-knorke-tool=more][data-knorke-tool-picked=laser]').first().getAttribute('aria-pressed')) === 'true', '[S] (1) der Knopf „Mehr Werkzeuge“ ist gedrückt und zeigt den Laserpointer (Job 229: data-knorke-tool-picked=laser)')

			t.step('(2) bob zieht 1,5 s über leere Fläche')
			const one = await watch(pa, pb, bobKey, from, to)
			t.check(one.shownMs !== null && one.shownMs <= SHOW_MS, `[C] (2) alice sieht bobs Spur spätestens ${SHOW_MS} ms nach dem Druck`, one)
			t.check(one.pixels > 0, '[S] (2) alices Laser-Leinwand zeigt dabei Pixel', one)
			t.check(one.goneMs !== null && one.goneMs <= GONE_MS, `[C] (2) bobs Spur fehlt bei alice spätestens ${GONE_MS} ms nach dem Loslassen`, one)
			t.check((await K.scene(pb)).tool === 'laser', '[S] (2) bobs Werkzeug bleibt laser', (await K.scene(pb)).tool)
			t.check(!(await lasersOf(pb)).includes('self'), '[S] (2) bobs eigene Spur ist verblasst', await lasersOf(pb))
			t.check(JSON.stringify(await K.items(pa)) === JSON.stringify(itemsA), '[C] (2) alices items() sind unverändert')
			t.check(JSON.stringify(await K.items(pb)) === JSON.stringify(itemsB), '[C] (2) bobs items() sind unverändert')
			t.check((await K.state(pb)).pending === 0, '[C] (2) bob hat keine Op eingereiht', await K.state(pb))

			t.step('(3) alice blendet die Cursor aus (C), bob zeigt noch einmal')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('c')
			t.must(await until(async () => (await pa.evaluate(() => localStorage.getItem('knorke.cursors'))) === '0', { timeout: 2000 }), '[C] (3) Vorbedingung: alice hat die Cursor ausgeblendet')
			const two = await watch(pa, pb, bobKey, to, from)
			t.check(two.shownMs !== null && two.shownMs <= SHOW_MS, `[C] (3) mit ausgeblendeten Cursorn sieht alice bobs Spur spätestens ${SHOW_MS} ms nach dem Druck`, two)
			t.check(two.pixels > 0, '[S] (3) alices Laser-Leinwand zeigt dabei Pixel', two)
			t.check(two.goneMs !== null && two.goneMs <= GONE_MS, `[C] (3) bobs Spur fehlt bei alice spätestens ${GONE_MS} ms nach dem Loslassen`, two)
			t.check((await K.scene(pb)).tool === 'laser', '[S] (3) bobs Werkzeug bleibt laser', (await K.scene(pb)).tool)
			t.check(JSON.stringify(await K.items(pa)) === JSON.stringify(itemsA) && JSON.stringify(await K.items(pb)) === JSON.stringify(itemsB), '[C] (3) die items() beider sind unverändert')
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
