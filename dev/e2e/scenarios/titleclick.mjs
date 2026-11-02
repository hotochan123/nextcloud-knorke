/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The second click opens a frame title only on its text (factory job 158).
 *
 * E59 alice (owner, Chromium 1440 × 900, mouse) on a board of her own with
 * frame F at (0, 0), 800 × 600, titled "Retrospective sprint 12", opened at
 * 100 % with world (0, 0) 200 px right of and 260 px below the canvas
 * corner. Only real input (page.mouse). The width W of the title text is
 * measured in the page with a canvas 2D context in the title font
 * (TITLE_FONT, the tokens FRAME_TITLE_SIZE and FONT_FAMILY), apart from
 * Konva. Every press lies in the middle of the title band (y −20; job 243:
 * the band is the tab, 40 high, the title TAB_PAD in from its left edge,
 * the text zone the tab, W + 2 · TAB_PAD wide, + 8 px). Steps:
 *   (1) a click on the middle of the title text selects F, no editor;
 *   (2) a second click there (TAB_PAD + W/2 well over 44 px right of F's
 *       left edge) opens the title editor (scene().editing = F, the text
 *       field with data-knorke-editor-kind=title); Esc closes it, [F] stays;
 *   (3) (job 252: only the tab grabs the frame) a click above F's top
 *       edge at 3/4 of its width (beyond the tab + 8) lands on the canvas:
 *       no editor, the selection empties;
 *   (4) a double click at the same point opens no editor, selects nothing;
 *   (5) a double click on the middle of the title text opens the title
 *       editor; Esc.
 * Between two presses at least 700 ms pass (no double click by timing).
 * Own board, no instance setting: before E09, after E58 (job 157's).
 * Flake gate: --only E59 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection, editor), [B] a server answer, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap
 * 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, openBoard, until, sleep } from '../lib/harness.mjs'

/** The camera alice opens with: world (0, 0) 200 px right of and 260 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -200, y: -260, scale: 1 })
const TITLE = 'Retrospective sprint 12'
/** The frame title's font (src/model/tokens.js: FRAME_TITLE_WEIGHT, FRAME_TITLE_SIZE px, FONT_FAMILY; job 243). */
export const TITLE_FONT = '600 22px Arial, "Liberation Sans", Helvetica, sans-serif'
/** The middle of the title band (FRAME_TITLE_BAND 40 above the top edge, job 243: the tab), world y. */
const BAND_Y = -20
/** Where the title starts in its tab (src/model/tokens.js FRAME_TAB_PAD, job 243), world units. */
export const TAB_PAD = 14
/** Least width of the text zone and its margin (InputController TITLE_CLICK_MIN_PX, TITLE_CLICK_PAD_PX). */
export const MIN_PX = 44
export const PAD_PX = 8
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

/** Width of a text in the title font, measured by the page's canvas (apart from Konva). */
const measure = (page, text) => page.evaluate(([s, font]) => {
	const c = document.createElement('canvas').getContext('2d')
	c.font = font
	return c.measureText(s).width
}, [text, TITLE_FONT])

/** The open editor: {id: scene().editing, kind: the text field's data-knorke-editor-kind}. */
const editorState = async (page) => ({
	id: (await K.scene(page).catch(() => null))?.editing ?? null,
	kind: await page.locator(EDITOR).first().getAttribute('data-knorke-editor-kind', { timeout: 500 }).catch(() => null),
})

/** Waits until the title editor of `id` is open (true) or gives up (false). */
const editorOpens = (page, id) => until(async () => {
	const e = await editorState(page)
	return e.id === id && e.kind === 'title'
}, { timeout: 3000 })

/** Esc in the open text field; waits until scene().editing is null. */
async function closeEditor(page) {
	await page.keyboard.press('Escape')
	return until(async () => (await editorState(page)).id === null, { timeout: 3000 })
}

export const E59 = {
	id: 'E59',
	title: 'Zweiter Klick auf den Rahmentitel nur auf dem Text (Job 158): der erste Klick auf die Titelleiste wählt den Rahmen aus, der zweite auf die Mitte des Titeltexts öffnet den Titeleditor, über der Kante bei 3/4 der Breite ist Leinwand (Job 252): Klick und Doppelklick dort öffnen nichts und leeren die Auswahl, ein Doppelklick auf den Titel öffnet den Editor',
	async run(t, world) {
		const board = await world.board('E59 Rahmentitel')
		const F = ulid()
		const res = await seedOps('alice', board, [put.frame(F, { x: 0, y: 0, w: 800, h: 600, data: { title: TITLE } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Rahmen F mit Titel gesät', res)
		const a = await world.actor('alice-titleclick', { user: 'alice' })
		const pa = a.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			const cam0 = await K.camera(pa)
			t.must(Math.abs(cam0.scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', cam0)
			const W = await measure(pa, TITLE)
			t.must(TAB_PAD + W / 2 >= MIN_PX + 16 && W + 2 * TAB_PAD + PAD_PX < 600 - 20, '[D] Vorbedingung: die Textmitte liegt deutlich mehr als 44 px rechts der Kante, 3/4 der Breite deutlich rechts vom Reiter + 8 px', { W })
			const text = await K.w2s(pa, TAB_PAD + W / 2, BAND_Y)
			const beside = await K.w2s(pa, 600, BAND_Y)

			t.step('(1) Klick auf die Mitte des Titeltexts: wählt F aus')
			t.must(await canvasAt(pa, text), '[D] Vorbedingung: die Textmitte liegt frei auf der Leinwand', text)
			await pa.mouse.click(text.x, text.y)
			t.check(await until(async () => JSON.stringify(await K.selection(pa)) === JSON.stringify([F]), { timeout: 3000 }), '[S] (1) der erste Klick wählt F aus', await K.selection(pa))
			await sleep(400)
			t.check((await editorState(pa)).id === null, '[S] (1) der erste Klick öffnet keinen Editor', await editorState(pa))
			await sleep(300)

			t.step('(2) zweiter Klick auf die Mitte des Titeltexts: der Titeleditor öffnet sich')
			t.must(await canvasAt(pa, text), '[D] Vorbedingung: die Textmitte liegt mit Auswahl frei auf der Leinwand', text)
			await pa.mouse.click(text.x, text.y)
			t.check(await editorOpens(pa, F), '[S] (2) der zweite Klick auf den Text öffnet den Titeleditor von F', await editorState(pa))
			t.check(await closeEditor(pa), '[S] (2) Esc schließt den Editor', await editorState(pa))
			t.must(JSON.stringify(await K.selection(pa)) === JSON.stringify([F]), '[S] (2) nach Esc bleibt F ausgewählt', await K.selection(pa))
			await sleep(700)

			t.step('(3) Klick über der Kante bei 3/4 der Breite (neben dem Reiter): Leinwand, kein Editor, keine Auswahl')
			t.must(await canvasAt(pa, beside), '[D] Vorbedingung: der Punkt bei 3/4 liegt frei auf der Leinwand', beside)
			await pa.mouse.click(beside.x, beside.y)
			await sleep(500)
			t.check((await editorState(pa)).id === null, '[S] (3) der Klick neben dem Text öffnet keinen Editor', await editorState(pa))
			t.check(await until(async () => (await K.selection(pa)).length === 0, { timeout: 3000 }), '[S] (3) neben dem Reiter ist Leinwand: die Auswahl ist leer', await K.selection(pa))
			await sleep(700)

			t.step('(4) Doppelklick an derselben Stelle: kein Editor, keine Auswahl')
			await pa.mouse.dblclick(beside.x, beside.y)
			await sleep(700)
			t.check((await editorState(pa)).id === null, '[S] (4) der Doppelklick neben dem Reiter öffnet keinen Editor', await editorState(pa))
			t.check((await K.selection(pa)).length === 0, '[S] (4) und wählt nichts aus', await K.selection(pa))
			await sleep(700)

			t.step('(5) Doppelklick auf die Mitte des Titeltexts: der Titeleditor öffnet sich')
			await pa.mouse.dblclick(text.x, text.y)
			t.check(await editorOpens(pa, F), '[S] (5) der Doppelklick auf den Reiter öffnet den Titeleditor von F', await editorState(pa))
			t.check(await closeEditor(pa), '[S] (5) Esc schließt den Editor', await editorState(pa))
		} finally {
			await world.drop(a)
		}
	},
}
