/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E96 (factory job 231, redesign V8): the lighter selection in the browser.
 * Two notes N (0, 0) and M (220, 0), 200 × 200, 20 units apart; alice on a
 * desktop (1280 × 800) with the mouse, then on a tablet with a pen (touch
 * and a fine pointer).
 *   (1) a click on N: handles() has the four corners, rot and plus-t/r/b/l;
 *       drawn (shown) are only the corners, 12 px (job 262; the points 10); stats().selectionColor
 *       is the page's --color-primary-element (or SELECTION_COLOR when it is
 *       too light for the canvas)
 *   (2) the mouse 8 px beyond the top right corner: rot drawn, no point; a
 *       drag on rot by 45° around the centre turns N by 45°; Ctrl+Z
 *   (3) the mouse 8 px right of the right edge at half height: only plus-r
 *       drawn; it lies 4 px right of N's edge, not on M; dragging it to M
 *       gives a connector from N's right anchor to M
 *   (4) a tablet with a pen: a tap on N draws every handle, 16 px (job 262; the points 14)
 */
import { CANVAS, K, itemMap, openBoard, put, seedOps, ulid, until } from '../lib/harness.mjs'

const TITLE = 'E96 Auswahl'
const VIEW = { width: 1280, height: 800 }
/** SELECTION_COLOR of src/model/tokens.js (the fallback). */
const FALLBACK = '#0082c9'

/** @return {Promise<object[]>} handles() of the page */
const handles = async (page) => (await K.handles(page)) || []
/** @return {Promise<string[]>} the names drawn now, sorted */
const drawn = async (page) => (await handles(page)).filter((h) => h.shown).map((h) => h.name).sort()
/** @return {Promise<object|null>} one handle by name */
const handle = async (page, name) => (await handles(page)).find((h) => h.name === name) ?? null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const E96 = {
	id: 'E96',
	title: 'Auswahl neu (Job 231): vier Eckgriffe in der Primärfarbe; Drehgriff an der Ecke oben rechts erst mit der Maus in der Nähe, dreht relativ; Verbindungspunkt einer Kante erst an der Kante, auf dem Rahmen statt auf der Nachbarnotiz, Ziehen verbindet; Tablet mit Stift: alle Griffe 16 px, Punkte 14 px (Job 262)',
	async run(t, world) {
		const B = await world.board(TITLE)
		const [N, M] = [ulid(), ulid()]
		const res = await seedOps('alice', B, [
			put.sticky(N, { x: 0, y: 0, data: { text: 'N' } }),
			put.sticky(M, { x: 220, y: 0, data: { text: 'M' } }),
		])
		t.must(res.every((r) => r === 'ok'), '[D] Vorbedingung: zwei Notizen, 20 Einheiten Abstand', res)

		const a = await world.actor('alice-selection', { user: 'alice', viewport: VIEW })
		const p = a.page
		try {
			await openBoard(a, B)
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Shift+Digit1')
			await K.waitIdle(p)

			t.step('(1) Klick auf N: vier Ecken gezeichnet, Drehgriff und Punkte nutzbar, aber nicht gezeichnet; Primärfarbe')
			const c = await K.w2s(p, 100, 100)
			await p.mouse.click(c.x, c.y)
			t.must(await until(async () => ((await K.selection(p)) || []).join() === N, { timeout: 3000 }), '[S] (1) N ist gewählt', await K.selection(p))
			const names = (await handles(p)).map((h) => h.name).sort()
			t.check(names.join() === 'bl,br,plus-b,plus-l,plus-r,plus-t,rot,tl,tr', '[S] (1) handles(): vier Ecken, rot, plus-t/r/b/l', names)
			t.check((await drawn(p)).join() === 'bl,br,tl,tr', '[S] (1) gezeichnet nur die vier Ecken', await drawn(p))
			t.check((await handles(p)).every((h) => h.size === (h.name.startsWith('plus-') ? 10 : 12)), '[S] (1) Griffe 12 px, Punkte 10 px (Maus, Job 262)', (await handles(p)).map((h) => h.size))
			const color = await p.evaluate(() => {
				const el = document.querySelector('.knorke-canvas') || document.body
				return getComputedStyle(el).getPropertyValue('--color-primary-element').trim().toLowerCase()
			})
			const sel = (await K.scene(p))?.selectionColor
			t.check(sel === color || sel === FALLBACK, '[C] (1) stats().selectionColor ist die Primärfarbe der Seite (oder SELECTION_COLOR, wenn sie zu hell ist)', { sel, color })
			t.check(/^#[0-9a-f]{6}$/.test(sel ?? ''), '[C] (1) die Auswahlfarbe ist #rrggbb', sel)

			t.step('(2) Maus an die Ecke oben rechts: Drehgriff erscheint; um 45° ziehen dreht N um 45°; Strg+Z')
			const tr = await handle(p, 'tr')
			await p.mouse.move(tr.x + 8, tr.y - 8)
			t.check(await until(async () => (await drawn(p)).includes('rot'), { timeout: 2000 }), '[S] (2) rot ist gezeichnet', await drawn(p))
			t.check(!(await drawn(p)).some((n) => n.startsWith('plus-')), '[S] (2) kein Punkt in der Zone des Drehgriffs', await drawn(p))
			const rot = await handle(p, 'rot')
			const R = Math.hypot(rot.x - c.x, rot.y - c.y)
			const a0 = Math.atan2(rot.y - c.y, rot.x - c.x)
			await p.mouse.move(rot.x, rot.y)
			await p.mouse.down()
			for (let i = 1; i <= 9; i++) {
				const ang = a0 + ((Math.PI / 4) * i) / 9
				await p.mouse.move(c.x + R * Math.cos(ang), c.y + R * Math.sin(ang))
				await sleep(16)
			}
			await p.mouse.up()
			await K.waitIdle(p)
			const r1 = (await itemMap(p)).get(N)?.r
			t.check(Math.abs((r1 ?? 0) - 45) <= 1, '[S] (2) N ist um 45° gedreht (±1), ohne Sprung beim Drücken', r1)
			await p.keyboard.press('Control+z')
			await K.waitIdle(p)
			t.must(await until(async () => ((await itemMap(p)).get(N)?.r ?? 0) === 0, { timeout: 3000 }), '[C] (2) Strg+Z: r wieder 0', (await itemMap(p)).get(N)?.r)

			t.step('(3) Maus rechts an die Kante: nur plus-r; er liegt auf dem Rahmen, nicht auf M; Ziehen zu M verbindet')
			const edge = await K.w2s(p, 200, 100)
			await p.mouse.move(edge.x + 8, edge.y)
			t.check(await until(async () => (await drawn(p)).join() === 'bl,br,plus-r,tl,tr', { timeout: 2000 }), '[S] (3) gezeichnet: Ecken und plus-r', await drawn(p))
			const pr = await handle(p, 'plus-r')
			const mL = await K.w2s(p, 220, 0)
			const mR = await K.w2s(p, 420, 200)
			t.check(Math.abs(pr.x - (edge.x + 4)) <= 1 && Math.abs(pr.y - edge.y) <= 1, '[S] (3) plus-r liegt 4 px rechts der Kantenmitte von N', { pr, edge })
			t.check(!(pr.x >= mL.x && pr.x <= mR.x && pr.y >= mL.y && pr.y <= mR.y), '[S] (3) plus-r liegt nicht auf M', { pr, m: [mL, mR] })
			const mc = await K.w2s(p, 320, 100)
			await p.mouse.move(pr.x, pr.y)
			await p.mouse.down()
			for (let i = 1; i <= 12; i++) {
				await p.mouse.move(pr.x + ((mc.x - pr.x) * i) / 12, pr.y + ((mc.y - pr.y) * i) / 12)
				await sleep(16)
			}
			await p.mouse.up()
			await K.waitIdle(p)
			const conn = await until(async () => [...(await itemMap(p)).values()].find((it) => it.t === 'connector') ?? null, { timeout: 3000 })
			t.check(conn?.data?.start?.item === N && conn?.data?.start?.ax === 1 && conn?.data?.start?.ay === 0.5 && conn?.data?.end?.item === M,
				'[C] (3) ein Verbinder vom rechten Anker von N zu M', conn?.data)
		} finally {
			await world.drop(a)
		}

		t.step('(4) Tablet mit Stift: ein Tipp auf N zeigt alle Griffe, 16 px, Punkte 14 px')
		const tb = await world.actor('alice-selection-pen', { user: 'alice', touch: true, fine: true })
		const q = tb.page
		try {
			await openBoard(tb, B)
			await q.locator(CANVAS).first().focus()
			await q.keyboard.press('Shift+Digit1')
			await K.waitIdle(q)
			const c = await K.w2s(q, 100, 150)
			await q.touchscreen.tap(c.x, c.y)
			t.must(await until(async () => ((await K.selection(q)) || []).join() === N, { timeout: 3000 }), '[S] (4) ein Tipp wählt N', await K.selection(q))
			t.check(await until(async () => (await drawn(q)).join() === 'bl,br,plus-b,plus-l,plus-r,plus-t,rot,tl,tr', { timeout: 2000 }), '[S] (4) alle Griffe gezeichnet', await drawn(q))
			t.check((await handles(q)).every((h) => h.size === (h.name.startsWith('plus-') ? 14 : 16)), '[S] (4) jeder Griff 16 px, Punkte 14 px', (await handles(q)).map((h) => h.size))
		} finally {
			await world.drop(tb)
		}
	},
}
