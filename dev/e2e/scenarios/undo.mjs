/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Undo keeps other people's changes (factory job 155).
 *
 * E56 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own with notes A at
 * (0, 0) and B at (400, 0). A new action empties the redo stack, so alice
 * makes both of her moves first (B, then A); her undo stack is then [B, A].
 * Steps:
 *   (1) alice drags B to the right, then A down; bob recolours A (a palette
 *       button of the context bar) and drags B down;
 *   (2) alice presses Ctrl+Z (undo of her move of A): at the server A lies
 *       at its old place with bob's colour, and no toast undo-changed shows
 *       (the colour is no part of her step);
 *   (3) alice presses Ctrl+Z again (undo of her move of B): B stays where
 *       bob put it, and alice sees [data-knorke-toast=undo-changed]
 *       ("1 item was skipped because someone else changed it.");
 *   (4) alice presses Ctrl+Shift+Z: A lies at her new place again, with
 *       bob's colour (the skipped step of B never reached the redo stack).
 * Own board, no instance setting: before E09, directly after E55.
 * Flake gate: --only E56 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell and
 * session (undo, redo, toast), [B] stored server state, [D] a harness
 * precondition. Waiting polls from Node with until()
 * (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, until, settle, selectItem, dragItem, styleButton, closeContextPanels } from '../lib/harness.mjs'

/** The camera both open with: world (0, 0) 300 px right of and 200 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -200, scale: 1 })
/** bob's colour for A (a palette colour of notes) and the colour A starts with. */
/** (Job 227) Pink and Light blue of the one palette: bob's colour is a swatch of the fill palette */
const BOB_FILL = '#f9b7d6'
const START_FILL = '#a2d9fe'
const TOAST = '[data-knorke-toast=undo-changed]'
const TEXT = '1 item was skipped because someone else changed it.'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })

/** Text of the first match, whitespace folded ('' when missing). */
const textOf = (page, sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '')

/** Placement and fill of an item ({x, y, parent, fill}, null when missing). */
const brief = (it) => (it ? { x: it.x, y: it.y, parent: it.parent ?? null, fill: it.style?.fill ?? null } : null)

/** The stored state of an item (brief). */
const stored = async (board, id) => brief((await serverMap('alice', board)).get(id))

/** The state of an item in a page's items() (brief). */
const shown = async (page, id) => brief((await itemMap(page)).get(id))

/** Same placement. */
const samePlace = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.parent === b.parent

/** Waits until the server stores `want` (a predicate on stored()) for id; returns the last state. */
async function storedUntil(board, id, want, timeout = 8000) {
	let last = null
	await until(async () => want(last = await stored(board, id)), { timeout })
	return last
}

/** The canvas has the focus, nothing is selected, no panel of the context bar is open. */
async function canvasReady(page) {
	await closeContextPanels(page)
	await page.locator(CANVAS).first().focus()
	await page.keyboard.press('Escape')
}

export const E56 = {
	id: 'E56',
	title: 'Undo behält die Änderungen anderer (Job 155): alice verschiebt B und A, bob färbt A um und verschiebt B; Strg+Z legt A an die alte Stelle mit bobs Farbe, das zweite Strg+Z lässt B an bobs Stelle mit der Meldung undo-changed, Strg+Umschalt+Z legt A wieder an alices neue Stelle mit bobs Farbe',
	async run(t, world) {
		const board = await world.board('E56 Undo anderer')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const [A, B] = [ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: 0, y: 0, w: 200, h: 200, data: { text: 'A' }, style: { fill: START_FILL } }),
			put.sticky(B, { x: 400, y: 0, w: 200, h: 200, data: { text: 'B' }, style: { fill: START_FILL } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notizen A und B gesät', res)
		const a = await world.actor('alice-undo', { user: 'alice' })
		const b = await world.actor('bob-undo', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must((await K.state(pb)).role === 'edit', '[D] Vorbedingung: bob bearbeitet (edit)', await K.state(pb))
			const a0 = await stored(board, A)
			const b0 = await stored(board, B)

			t.step('(1) alice verschiebt B, dann A; bob färbt A um und verschiebt B')
			await canvasReady(pa)
			await dragItem(pa, B, { dx: 200, dy: 0 })
			await settle([pa, pb])
			const b1 = await storedUntil(board, B, (s) => s && !samePlace(s, b0))
			t.must(b1 && !samePlace(b1, b0), '[D] (1) Vorbedingung: alices Verschieben von B ist beim Server', { vorher: b0, nachher: b1 })
			await dragItem(pa, A, { dx: 0, dy: 300 })
			await settle([pa, pb])
			const a1 = await storedUntil(board, A, (s) => s && !samePlace(s, a0))
			t.must(a1 && !samePlace(a1, a0), '[D] (1) Vorbedingung: alices Verschieben von A ist beim Server', { vorher: a0, nachher: a1 })
			await canvasReady(pb)
			await selectItem(pb, A)
			t.must(await styleButton(pb, 'style.fill', BOB_FILL), `[D] (1) Vorbedingung: bob findet den Farbknopf ${BOB_FILL} in der Kontextleiste`)
			await settle([pa, pb])
			const aBob = await storedUntil(board, A, (s) => s?.fill === BOB_FILL)
			t.must(aBob?.fill === BOB_FILL && samePlace(aBob, a1), '[D] (1) Vorbedingung: A trägt bobs Farbe an alices neuer Stelle', aBob)
			await canvasReady(pb)
			await dragItem(pb, B, { dx: 0, dy: 300 })
			await settle([pa, pb])
			const b2 = await storedUntil(board, B, (s) => s && !samePlace(s, b1))
			t.must(b2 && !samePlace(b2, b1) && !samePlace(b2, b0), '[D] (1) Vorbedingung: bobs Verschieben von B ist beim Server', { alice: b1, bob: b2 })
			t.must(await until(async () => samePlace(await shown(pa, B), b2) && (await shown(pa, A))?.fill === BOB_FILL, { timeout: 5000 }), '[D] (1) Vorbedingung: alices Client kennt bobs Stand von A und B', { A: await shown(pa, A), B: await shown(pa, B) })

			t.step('(2) alice drückt Strg+Z: A an der alten Stelle, mit bobs Farbe')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			await settle([pa, pb])
			const a2 = await storedUntil(board, A, (s) => samePlace(s, a0))
			t.check(samePlace(a2, a0), '[B] (2) beim Server liegt A an der alten Stelle', { alt: a0, jetzt: a2 })
			t.check(a2?.fill === BOB_FILL, `[B] (2) A behält bobs Farbe ${BOB_FILL}`, a2)
			t.check((await pa.locator(TOAST).count()) === 0, '[C] (2) keine Meldung undo-changed (die Farbe gehört nicht zu alices Schritt)')

			t.step('(3) alice drückt noch einmal Strg+Z: B bleibt an bobs Stelle, die Meldung undo-changed')
			await pa.keyboard.press('Control+z')
			t.check(await appears(pa, TOAST, 3000), `[C] (3) bei alice erscheint ${TOAST}`)
			t.check((await textOf(pa, TOAST)) === TEXT, `[C] (3) ihr Text: „${TEXT}“`, await textOf(pa, TOAST))
			await settle([pa, pb])
			const b3 = await stored(board, B)
			t.check(samePlace(b3, b2), '[B] (3) beim Server bleibt B an bobs Stelle', { bob: b2, jetzt: b3 })

			t.step('(4) alice drückt Strg+Umschalt+Z: A wieder an alices neuer Stelle, mit bobs Farbe')
			await pa.keyboard.press('Control+Shift+z')
			await settle([pa, pb])
			const a4 = await storedUntil(board, A, (s) => samePlace(s, a1))
			t.check(samePlace(a4, a1), '[B] (4) beim Server liegt A wieder an alices neuer Stelle', { neu: a1, jetzt: a4 })
			t.check(a4?.fill === BOB_FILL, `[B] (4) A trägt weiter bobs Farbe ${BOB_FILL}`, a4)
			t.check(samePlace(await stored(board, B), b2), '[B] (4) B bleibt an bobs Stelle (der übersprungene Schritt kam nicht auf den Redo-Stapel)', await stored(board, B))
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
