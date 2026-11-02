/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The text of a shape without fill grabs the shape (factory job 177).
 *
 * E66 alice (owner, Chromium 1440 × 900, mouse) on a board of her own with
 * the rectangle S at (0, 0), 400 × 240, without fill (fillOpacity 0), text
 * "Hello" at font size 32 (center, middle), opened at 100 % with world (0, 0)
 * 200 px right of and 260 px below the canvas corner. Only real input
 * (page.mouse). The width W of the text is measured in the page with a
 * canvas 2D context in the shape's font (TEXT_FONT, 32 px and the token
 * FONT_FAMILY), apart from Konva. Steps:
 *   (1) a click on the middle of the text (the middle of S) selects S, no
 *       editor;
 *   (2) after a click on empty canvas beside S (nothing selected), a drag
 *       from the middle of the text 100 px to the right moves S: x + 100
 *       locally and at the server, y unchanged;
 *   (3) a click into the inside of S at 3/4 of its width and half its
 *       height (beyond W/2 + the mouse tolerance from the text's middle)
 *       selects nothing;
 *   (4) a double click on the middle of the text opens the editor of S
 *       (scene().editing = S, the text field with
 *       data-knorke-editor-kind=shape); Esc closes it.
 * Between two presses at least 700 ms pass (no double click by timing).
 * Own board, no instance setting: before E09, directly after E65 (job 175's).
 * Flake gate: --only E66 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection, editor, the local move), [B] a server answer, [D] a harness
 * precondition. Waiting polls from Node with until() (Nextcloud's CSP,
 * ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, serverMap, itemMap, openBoard, until, sleep, settle, dragPath } from '../lib/harness.mjs'

/** The camera alice opens with: world (0, 0) 200 px right of and 260 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -200, y: -260, scale: 1 })
const TEXT = 'Hello'
/** The shape's text font (style.fontSize 32, src/model/tokens.js FONT_FAMILY). */
export const TEXT_FONT = '32px Arial, "Liberation Sans", Helvetica, sans-serif'
/** The text zone's margin for the mouse (InputController HIT_TOL_MOUSE_PX). */
export const TOL_PX = 4
const EDITOR = 'textarea[data-knorke-editor]'

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Is the canvas the element at this client point (no bar over it)? */
function canvasAt(page, p) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [p.x, p.y, CANVAS]).catch(() => false)
}

/** Width of a text in the shape's font, measured by the page's canvas (apart from Konva). */
const measure = (page, text) => page.evaluate(([s, font]) => {
	const c = document.createElement('canvas').getContext('2d')
	c.font = font
	return c.measureText(s).width
}, [text, TEXT_FONT])

/** The open editor: {id: scene().editing, kind: the text field's data-knorke-editor-kind}. */
const editorState = async (page) => ({
	id: (await K.scene(page).catch(() => null))?.editing ?? null,
	kind: await page.locator(EDITOR).first().getAttribute('data-knorke-editor-kind', { timeout: 500 }).catch(() => null),
})

/** Is the selection exactly `ids`? */
const selected = async (page, ids) => JSON.stringify(await K.selection(page)) === JSON.stringify(ids)

const near = (a, b, tol = 0.5) => typeof a === 'number' && Math.abs(a - b) <= tol
const boxOf = (it) => (it ? { x: it.x, y: it.y, w: it.w, h: it.h } : null)

export const E66 = {
	id: 'E66',
	title: 'Text einer Form ohne Füllung fasst die Form (Job 177): ein Klick auf den Text wählt sie aus, Ziehen vom Text verschiebt sie um 100 px (lokal und beim Server), ein Klick ins Innere bei 3/4 der Breite wählt nichts, ein Doppelklick auf den Text öffnet ihren Editor',
	async run(t, world) {
		const board = await world.board('E66 Text der Form')
		const S = ulid()
		const res = await seedOps('alice', board, [put.shape(S, {
			x: 0, y: 0, w: 400, h: 240,
			data: { kind: 'rect', text: TEXT },
			style: { fill: '#ffffff', fillOpacity: 0, stroke: '#1a1a1a', strokeWidth: 2, fontSize: 32 },
		})])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Form S ohne Füllung mit Text gesät', res)
		const a = await world.actor('alice-shapetext', { user: 'alice' })
		const pa = a.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			const cam0 = await K.camera(pa)
			t.must(Math.abs(cam0.scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', cam0)
			const W = await measure(pa, TEXT)
			t.must(W > 20 && W / 2 + TOL_PX < 100 - 20, '[D] Vorbedingung: 3/4 der Breite liegt deutlich rechts der Textzone (W/2 + 4 px von der Mitte)', { W })
			const s0 = (await itemMap(pa)).get(S)
			t.must(!!s0 && s0.x === 0 && s0.y === 0, '[D] Vorbedingung: S liegt bei (0, 0)', boxOf(s0))
			const text = await K.w2s(pa, 200, 120)
			const empty = await K.w2s(pa, 700, 120)

			t.step('(1) Klick auf die Mitte des Texts: wählt S aus')
			t.must(await canvasAt(pa, text), '[D] Vorbedingung: die Textmitte liegt frei auf der Leinwand', text)
			await pa.mouse.click(text.x, text.y)
			t.check(await until(() => selected(pa, [S]), { timeout: 3000 }), '[S] (1) der Klick auf den Text wählt S aus', await K.selection(pa))
			await sleep(400)
			t.check((await editorState(pa)).id === null, '[S] (1) der Klick öffnet keinen Editor', await editorState(pa))
			await sleep(300)

			t.step('(2) Klick auf leere Fläche, dann vom Text 100 px nach rechts ziehen: S verschiebt sich')
			t.must(await canvasAt(pa, empty), '[D] Vorbedingung: der Punkt rechts neben S liegt frei auf der Leinwand', empty)
			await pa.mouse.click(empty.x, empty.y)
			t.must(await until(() => selected(pa, []), { timeout: 3000 }), '[S] (2) der Klick auf leere Fläche leert die Auswahl', await K.selection(pa))
			await sleep(700)
			t.must(await canvasAt(pa, text), '[D] Vorbedingung: die Textmitte liegt ohne Auswahl frei auf der Leinwand', text)
			await dragPath(pa, text, { x: text.x + 100, y: text.y })
			await K.waitIdle(pa)
			const moved = (it) => !!it && near(it.x, 100) && near(it.y, 0)
			t.check(await until(async () => moved((await itemMap(pa)).get(S)), { timeout: 3000 }), '[S] (2) S ist um 100 px nach rechts verschoben (lokal)', boxOf((await itemMap(pa)).get(S)))
			await settle([pa])
			const srv = (await serverMap('alice', board)).get(S)
			t.check(moved(srv), '[B] (2) der Server meldet x + 100 für S', boxOf(srv))
			await sleep(700)

			t.step('(3) Klick ins Innere bei 3/4 der Breite und halber Höhe: wählt nichts')
			const s1 = (await itemMap(pa)).get(S)
			const inside = await K.w2s(pa, s1.x + 0.75 * s1.w, s1.y + s1.h / 2)
			t.must(await canvasAt(pa, inside), '[D] Vorbedingung: der Punkt bei 3/4 liegt frei auf der Leinwand', inside)
			await pa.mouse.click(inside.x, inside.y)
			await sleep(500)
			t.check(await selected(pa, []), '[S] (3) der Klick ins leere Innere wählt nichts', await K.selection(pa))
			await sleep(700)

			t.step('(4) Doppelklick auf die Mitte des Texts: der Editor von S öffnet sich')
			const text2 = await K.w2s(pa, s1.x + s1.w / 2, s1.y + s1.h / 2)
			t.must(await canvasAt(pa, text2), '[D] Vorbedingung: die Textmitte liegt frei auf der Leinwand', text2)
			await pa.mouse.dblclick(text2.x, text2.y)
			const opened = await until(async () => {
				const e = await editorState(pa)
				return e.id === S && e.kind === 'shape'
			}, { timeout: 3000 })
			t.check(opened, '[S] (4) der Doppelklick auf den Text öffnet den Editor von S', await editorState(pa))
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await editorState(pa)).id === null, { timeout: 3000 }), '[S] (4) Esc schließt den Editor', await editorState(pa))
		} finally {
			await world.drop(a)
		}
	},
}
