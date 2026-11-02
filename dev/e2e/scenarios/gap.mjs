/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The selection frame with a gap (factory job 140); only the caret while
 * writing (factory job 150, step 4).
 *
 * E50 alice (mouse, Chromium 1440 × 900) on a board of her own, bob through
 * the edit link. Seeded: note N (0, 0, 200 × 200), shape S (260, 0,
 * 200 × 120), text T (520, 0), frame F (0, 300, 400 × 200), the notes G1
 * (500, 300) and G2 (660, 300) in one group, and a connector K with free
 * ends from (0, 540) to (400, 540). Steps:
 *   (1) zoom 1 (stored camera): N, S, T and F selected one by one with Tab;
 *       for each the 'local' frame of __knorke.scene().outlines lies 4 ± 0.1
 *       screen px outside its box on every side (factory job 172: the note
 *       N reaches E50_BAND world units further down, the band of its
 *       reaction row with the smiley-plus button), and the handle tl of
 *       __knorke.handles() 4 ± 0.5 px left of and above the corner of
 *       itemScreenRect;
 *   (2) N and S (click, Shift+click): exactly one 'multi' frame, their hull
 *       4 px out; a click on G1 selects the group: exactly one 'group' frame,
 *       the hull of G1 and G2 4 px out, its corner handles on it, no 'multi';
 *   (3) bob selects N: alice gets a 'remote' frame of N, 4 px out;
 *   (4) (job 150) (a) bob selects N again, Enter on alice's selected N
 *       opens its editor: outlines has no 'local' entry of N and handles()
 *       is empty, N stays selected; after Esc N's 'local' frame is back
 *       where it was (± 0.01) and handles() has plus-r again; (b) while the
 *       editor is open alice keeps bob's 'remote' entry of N; (c) Enter on
 *       the selected text item T: no 'local' entry of T, back after Esc;
 *       (d) Enter on the selected frame F opens its title editor: no
 *       'local' entry of F, the text field has the focus and computes
 *       background-color rgba(0, 0, 0, 0), box-shadow none, border-radius
 *       0px and outline-style none (emulated forced colors: a 2px solid
 *       outline); (e) Enter on the selected connector K
 *       opens its label, whose text field computes background-color
 *       rgb(243, 242, 240) (job 227: #f3f2f0);
 *   (5) the selected connector K has no entry in outlines (only its halo);
 *   (6) a mouse press 3 px left of the selected N and a drag of 60 px to the
 *       right move N by 60 px, locally and at the server;
 *   (7) zoom 2 (the board opened again with a stored camera at scale 2):
 *       step (1) once more;
 *   (8) (job 163) zoom 2, the board opened again with that camera (Tab
 *       panned the view in step 7): alice selects N and S (click,
 *       Shift+click); a mouse press on a free spot in their 'multi' frame
 *       (below S: canvas, no item with its gap, no handle under it) and a
 *       drag of 60 px to the right move N and S by 30 world units, locally,
 *       at the server and at bob; then a click without a move on a free
 *       spot in the frame clears the selection.
 * Own board, no instance setting: before E09, directly after E49@820x1180.
 * Flake gate: --only E50 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (outlines, handles, hit), [C] shell and session (editor, sync), [B] stored
 * server state, [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, waitReady, until, sleep, settle, canvasFocused, centerOf, dragPath } from '../lib/harness.mjs'

/** Gap of the selection frame (src/model/tokens.js SELECTION_GAP_PX). */
export const E50_GAP = 4
/**
 * (job 172) The band of a selected note's reaction row (src/model/tokens.js
 * REACT_BAND, world units): alice may react, so the one selected note shows
 * the smiley-plus button below it and its frame reaches the band.
 */
export const E50_BAND = 32
/** The camera of the first opening: every seeded item in view at zoom 1. */
export const E50_CAM1 = Object.freeze({ x: -150, y: -100, scale: 1 })
/** The camera of step 7 (zoom 2); Tab pans the other items into view. */
export const E50_CAM2 = Object.freeze({ x: -60, y: -60, scale: 2 })

const EDITOR = 'textarea[data-knorke-editor]'
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol

/** The edit link of a board (route 9 as alice). */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Is the bare canvas (the Konva canvas inside .knorke-canvas) the element at this client point? */
function onCanvas(page, pt) {
	return page.evaluate(([x, y, sel]) => {
		const el = document.elementFromPoint(x, y)
		return !!el && el.tagName === 'CANVAS' && !!el.closest(sel)
	}, [pt.x, pt.y, CANVAS]).catch(() => false)
}

/** Closes the one-time privacy card ([data-knorke=privacy-info]) when it is shown. */
async function closePrivacyCard(page) {
	const close = page.locator('[data-knorke=privacy-info] [data-knorke-action=privacy-close]').first()
	if (await until(() => close.isVisible().catch(() => false), { timeout: 1500 })) await close.click()
	await until(async () => (await page.locator('[data-knorke=privacy-info]').count()) === 0, { timeout: 2000 })
}

/** Esc with the canvas focus: the selection goes. */
async function deselect(page) {
	await page.locator(CANVAS).first().focus()
	await page.keyboard.press('Escape')
	return until(async () => ((await K.selection(page)) || []).length === 0, { timeout: 2000 })
}

/** Is exactly `ids` selected (any order)? */
async function selected(page, ids) {
	const s = await K.selection(page)
	return Array.isArray(s) && s.length === ids.length && ids.every((id) => s.includes(id))
}

/** Waits until the confirmed camera stands still (Tab may pan an item into view). */
async function still(page) {
	let last = null
	return until(async () => {
		const c = JSON.stringify(await K.camera(page))
		const same = c === last
		last = c
		return same
	}, { timeout: 3000, every: 120 })
}

/**
 * Selects exactly `id` with Tab, starting from an empty selection (frames
 * first, then by position; Tab pans an item into view).
 */
async function tabTo(page, id, max = 14) {
	await deselect(page)
	for (let i = 0; i < max; i++) {
		if (!(await canvasFocused(page))) await deselect(page)
		await page.keyboard.press('Tab')
		if (await selected(page, [id])) return still(page)
	}
	return false
}

/**
 * Runs in the page: the scene stats, the screen box of `id` and the handles,
 * from the same confirmed camera. No closure over Node values.
 */
function probe(id) {
	const k = window.__knorke
	return { scene: k.scene(), rect: id ? k.itemScreenRect(id) : null, handles: k.handles() }
}

/** The first probe whose outlines contain an entry of `kind` (and `id`), or null. */
async function probeFor(page, kind, id = null, rectOf = id) {
	return until(async () => {
		const v = await page.evaluate(probe, rectOf)
		return v.scene?.outlines?.some((o) => o.kind === kind && (id === null || o.id === id)) ? v : null
	}, { timeout: 3000 })
}

/** Screen px between box b and frame o per side [left, top, right, bottom] at scale s (world boxes). */
const sides = (b, o, s) => [(b.x - o.x) * s, (b.y - o.y) * s, (o.x + o.w - b.x - b.w) * s, (o.y + o.h - b.y - b.h) * s]
const gapOk = (d, tol = 0.1) => d.every((v) => near(v, E50_GAP, tol))
const boxOf = (it) => it && { x: it.x, y: it.y, w: it.w, h: it.h }
const hull = (bs) => {
	const x0 = Math.min(...bs.map((b) => b.x))
	const y0 = Math.min(...bs.map((b) => b.y))
	return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 }
}
const fmt = (o) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1000) / 1000 : v]))

export const E50 = {
	id: 'E50',
	title: 'Auswahlrahmen mit Abstand (Job 140): bei Zoom 1 und 2 liegen die local-Rahmen von Notiz, Form, Text und Frame 4 px außerhalb, tl 4 px links oberhalb; multi- und group-Rahmen 4 px um die Hülle; bobs Auswahl als remote-Rahmen mit 4 px; bei offenem Editor (Notiz, Text, Frame-Titel) kein eigener Rahmen und keine Griffe, nach Esc zurück, bobs Rahmen bleibt, das Titel-Textfeld ohne Hintergrund, die Beschriftung mit; ein Verbinder hat keinen Eintrag; ein Druck 3 px neben der gewählten Notiz verschiebt sie; (Job 163) ein Ziehen von freier Stelle im multi-Rahmen verschiebt N und S, ein Klick dort hebt die Auswahl auf',
	async run(t, world) {
		const board = await world.board('E50 Auswahlrahmen')
		const [N, S, T, F, G1, G2, G, KC] = [ulid(), ulid(), ulid(), ulid(), ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.frame(F, { x: 0, y: 300, w: 400, h: 200, data: { title: 'F' } }),
			put.sticky(N, { x: 0, y: 0, data: { text: 'N' } }),
			put.shape(S, { x: 260, y: 0, w: 200, h: 120 }),
			put.text(T, { x: 520, y: 0, data: { text: 'T' } }),
			put.sticky(G1, { x: 500, y: 300, w: 120, h: 120, group: G, data: { text: 'G1' } }),
			put.sticky(G2, { x: 660, y: 300, w: 120, h: 120, group: G, data: { text: 'G2' } }),
			put.connector(KC, { x: 0, y: 540 }, { x: 400, y: 540 }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: N, S, T, F, die Gruppe G1/G2 und der Verbinder K', res)
		const token = await linkToken(board)
		const alice = await world.actor('alice-abstand', { user: 'alice' })
		const p = alice.page
		// a beforeunload prompt must never block the reopening in step 7
		p.on('dialog', (d) => d.accept().catch(() => {}))
		let bob = null
		try {
			await storeCamera(p, board, E50_CAM1)
			await openBoard(alice, board)
			await K.waitIdle(p)
			t.must(near((await K.camera(p))?.scale, 1, 1e-9), '[D] alice öffnet das Board bei Zoom 1', await K.camera(p))
			await singles(t, p, { N, S, T, F }, 1, '(1)')
			await groups(t, p, { N, S, G1, G2 })
			t.step('(3) bob wählt N')
			bob = await world.actor('bob-abstand', { user: 'bob' })
			await bob.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await waitReady(bob.page, 30000)
			t.must((await K.state(bob.page)).role === 'edit', '[D] bob ist über den Bearbeitungslink im Board')
			await closePrivacyCard(bob.page)
			await remote(t, p, bob.page, N)
			await editors(t, p, bob.page, { N, T, F, KC })
			await connector(t, p, KC)
			await gapPress(t, p, bob.page, board, N)
			t.step('(7) Zoom 2: das Board neu geöffnet mit gespeicherter Kamera')
			await K.waitIdle(p)
			await p.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
			await storeCamera(p, board, E50_CAM2)
			await openBoard(alice, board)
			await K.waitIdle(p)
			t.must(near((await K.camera(p))?.scale, 2, 1e-9), '[D] alice sieht das Board bei Zoom 2', await K.camera(p))
			await singles(t, p, { N, S, T, F }, 2, '(7)')
			await frameDrag(t, alice, bob.page, board, { N, S })
		} finally {
			await world.drop(bob)
			await world.drop(alice)
		}
	},
}

/** Steps (1) and (7): the local frame and the handle tl of N, S, T and F, each selected alone. */
async function singles(t, p, ids, zoom, step) {
	for (const [name, id] of Object.entries(ids)) {
		t.step(`${step} Zoom ${zoom}: ${name} allein ausgewählt`)
		t.must(await tabTo(p, id), `[D] ${step} Tab wählt ${name} allein, die Ansicht steht`, await K.selection(p))
		const pr = await probeFor(p, 'local', id)
		t.must(pr, `[S] ${step} ${name} hat einen local-Rahmen in scene().outlines`, (await K.scene(p))?.outlines)
		const s = pr.scene.camera.scale
		t.must(near(s, zoom, 1e-9), `[D] ${step} Zoom ${zoom}`, pr.scene.camera)
		const b = boxOf((await itemMap(p)).get(id))
		const o = pr.scene.outlines.find((x) => x.kind === 'local' && x.id === id)
		const d = sides(b, o, s)
		// (job 172) the note: below it the band of its reaction row
		const below = name === 'N' ? E50_BAND * s : 0
		const want = [E50_GAP, E50_GAP, E50_GAP, E50_GAP + below]
		t.check(d.every((v, i) => near(v, want[i], 0.1)) && o.r === 0, `[S] ${step} ${name}: der local-Rahmen liegt auf allen Seiten ${E50_GAP} ± 0,1 Bildschirm-px außerhalb der Box${name === 'N' ? `, unten ${E50_BAND} Einheiten tiefer (Band der Reaktionszeile)` : ''} (Zoom ${zoom})`, { seiten: d.map((v) => Math.round(v * 1000) / 1000), rahmen: fmt(o), box: b })
		const tl = pr.handles.find((h) => h.name === 'tl')
		const r = pr.rect
		t.check(!!tl && !!r && near(r.x - tl.x, E50_GAP, 0.5) && near(r.y - tl.y, E50_GAP, 0.5), `[S] ${step} ${name}: der Griff tl liegt ${E50_GAP} ± 0,5 px links oberhalb der Ecke von itemScreenRect`, { tl, rect: fmt(r) })
	}
}

/** Step (2): the dashed frame of N + S and the outline of the group G1/G2. */
async function groups(t, p, { N, S, G1, G2 }) {
	t.step('(2) Mehrfachauswahl N + S (Klick, Umschalt+Klick)')
	await deselect(p)
	const cn = await centerOf(p, N)
	t.must(await onCanvas(p, cn), '[D] (2) die Mitte von N liegt frei auf der Leinwand', cn)
	await p.mouse.click(cn.x, cn.y)
	t.must(await until(() => selected(p, [N]), { timeout: 3000 }), '[S] (2) der Klick wählt N', await K.selection(p))
	const cs = await centerOf(p, S)
	t.must(await onCanvas(p, cs), '[D] (2) die Mitte von S liegt frei auf der Leinwand', cs)
	await p.keyboard.down('Shift')
	await p.mouse.click(cs.x, cs.y)
	await p.keyboard.up('Shift')
	t.must(await until(() => selected(p, [N, S]), { timeout: 3000 }), '[S] (2) Umschalt+Klick: Auswahl N und S', await K.selection(p))
	const pm = await probeFor(p, 'multi')
	t.must(pm, '[S] (2) scene().outlines hat einen multi-Rahmen', (await K.scene(p))?.outlines)
	const m = await itemMap(p)
	const s = pm.scene.camera.scale
	const multis = pm.scene.outlines.filter((o) => o.kind === 'multi')
	const hNS = hull([boxOf(m.get(N)), boxOf(m.get(S))])
	const dm = sides(hNS, multis[0], s)
	t.check(multis.length === 1 && gapOk(dm), `[S] (2) genau ein multi-Rahmen, ${E50_GAP} px um die Hülle von N und S`, { multi: multis.map(fmt), huelle: hNS, seiten: dm })

	t.step('(2) die Gruppe G1/G2 (Klick auf G1)')
	await deselect(p)
	const cg = await centerOf(p, G1)
	t.must(await onCanvas(p, cg), '[D] (2) die Mitte von G1 liegt frei auf der Leinwand', cg)
	await p.mouse.click(cg.x, cg.y)
	t.must(await until(() => selected(p, [G1, G2]), { timeout: 3000 }), '[S] (2) der Klick auf G1 wählt die Gruppe G1, G2', await K.selection(p))
	const pg = await probeFor(p, 'group')
	t.must(pg, '[S] (2) scene().outlines hat einen group-Rahmen', (await K.scene(p))?.outlines)
	const groupsOf = pg.scene.outlines.filter((o) => o.kind === 'group')
	const hG = hull([boxOf(m.get(G1)), boxOf(m.get(G2))])
	const dg = sides(hG, groupsOf[0], s)
	t.check(groupsOf.length === 1 && gapOk(dg), `[S] (2) genau ein group-Rahmen, ${E50_GAP} px um die Hülle von G1 und G2`, { group: groupsOf.map(fmt), huelle: hG, seiten: dg })
	t.check(!pg.scene.outlines.some((o) => o.kind === 'multi' || o.kind === 'local'), '[S] (2) genau eine Gruppe: kein multi-Rahmen und keine Einzelrahmen der Mitglieder', pg.scene.outlines.map(fmt))
	const tl = pg.handles.find((h) => h.name === 'tl')
	const corner = await K.w2s(p, hG.x, hG.y)
	t.check(!!tl && near(corner.x - tl.x, E50_GAP, 0.5) && near(corner.y - tl.y, E50_GAP, 0.5), `[S] (2) der Griff tl der Gruppe liegt ${E50_GAP} px links oberhalb ihrer Hülle`, { tl, ecke: corner })
	await deselect(p)
}

/** Step (3): bob's selection of N is a remote frame at alice with the same gap. */
async function remote(t, p, pb, N) {
	t.must(await deselect(p), '[D] (3) alice hat nichts ausgewählt')
	const c = await centerOf(pb, N)
	t.must(await onCanvas(pb, c), '[D] (3) N liegt bei bob frei auf der Leinwand', c)
	await pb.mouse.click(c.x, c.y)
	t.must(await until(() => selected(pb, [N]), { timeout: 3000 }), '[S] (3) bob hat N gewählt', await K.selection(pb))
	const pr = await until(async () => {
		const v = await p.evaluate(probe, null)
		return v.scene?.outlines?.some((o) => o.kind === 'remote' && o.id === N) ? v : null
	}, { timeout: 8000 })
	t.must(pr, '[C] (3) alice bekommt bobs Auswahl als remote-Rahmen von N', (await K.scene(p))?.outlines)
	const o = pr.scene.outlines.find((x) => x.kind === 'remote' && x.id === N)
	const d = sides(boxOf((await itemMap(p)).get(N)), o, pr.scene.camera.scale)
	t.check(gapOk(d), `[S] (3) der remote-Rahmen von N liegt ${E50_GAP} ± 0,1 px außerhalb`, { seiten: d, rahmen: fmt(o) })
	await deselect(pb)
	t.check(await until(async () => !((await K.scene(p))?.outlines ?? []).some((x) => x.kind === 'remote'), { timeout: 8000 }), '[C] (3) bob wählt ab: alices remote-Rahmen geht')
}

/** Runs in the page: the computed look of the open text field and whether it has the focus. No closure over Node values. */
function editorLook(sel) {
	const ta = document.querySelector(sel)
	if (!ta) return null
	const cs = getComputedStyle(ta)
	return {
		kind: ta.getAttribute('data-knorke-editor-kind'),
		background: cs.backgroundColor,
		shadow: cs.boxShadow,
		radius: cs.borderRadius,
		outline: cs.outlineStyle,
		outlineWidth: cs.outlineWidth,
		focused: document.activeElement === ta,
	}
}

/** Is the text field shown (open true) or gone (open false)? */
const editorShown = (p, open) => until(async () => (await p.locator(EDITOR).first().isVisible().catch(() => false)) === open, { timeout: 3000 })

/** The 'local' frame of `id` in a probe, or null. */
const localOf = (v, id) => v?.scene?.outlines?.find((o) => o.kind === 'local' && o.id === id) ?? null

/**
 * Enter on the selected item `id` opens an editor of `kind`; while it is
 * open `id` has no 'local' frame and stays selected. Returns the look of
 * the text field.
 */
async function enterEdits(t, p, id, name, kind, step) {
	t.must(await probeFor(p, 'local', id), `[S] ${step} ${name} hat vor dem Editor seinen local-Rahmen`, (await K.scene(p))?.outlines)
	await p.keyboard.press('Enter')
	t.must(await editorShown(p, true), `[C] ${step} Enter öffnet den Editor von ${name}`)
	const look = await p.evaluate(editorLook, EDITOR)
	t.must(look?.kind === kind, `[S] ${step} ein Editor der Art ${kind}`, look)
	const open = await until(async () => {
		const v = await p.evaluate(probe, id)
		return v.scene && !localOf(v, id) ? v : null
	}, { timeout: 3000 })
	t.check(!!open && (await selected(p, [id])), `[S] ${step} bei offenem Editor kein local-Rahmen von ${name}, ${name} bleibt ausgewählt`, (await K.scene(p))?.outlines?.map(fmt))
	return look
}

/** Esc ends the editor of `id`; its 'local' frame comes back. */
async function escBack(t, p, id, name, step) {
	await p.keyboard.press('Escape')
	t.check(await editorShown(p, false), `[C] ${step} Esc beendet den Editor`)
	t.check(!!(await probeFor(p, 'local', id)), `[S] ${step} nach Esc hat ${name} wieder seinen local-Rahmen`, (await K.scene(p))?.outlines?.map(fmt))
}

/**
 * Step (4) (job 150): while a text editor is open its item has no 'local'
 * frame and no handles, bob's selection of it stays; Esc brings frame and
 * handles back. The title text field has no look of its own, the label
 * keeps its background.
 */
async function editors(t, p, pb, { N, T, F, KC }) {
	t.step('(4a) bob wählt N, Enter auf alices gewählter N öffnet ihren Editor')
	const cb = await centerOf(pb, N)
	t.must(await onCanvas(pb, cb), '[D] (4) N liegt bei bob frei auf der Leinwand', cb)
	await pb.mouse.click(cb.x, cb.y)
	t.must(await until(() => selected(pb, [N]), { timeout: 3000 }), '[S] (4) bob hat N gewählt', await K.selection(pb))
	t.must(await until(async () => ((await K.scene(p))?.outlines ?? []).some((o) => o.kind === 'remote' && o.id === N), { timeout: 8000 }), '[C] (4) alice sieht bobs remote-Rahmen von N', (await K.scene(p))?.outlines)
	const c = await centerOf(p, N)
	await p.mouse.click(c.x, c.y)
	t.must(await until(() => selected(p, [N]), { timeout: 3000 }), '[S] (4a) der Klick wählt N', await K.selection(p))
	// (job 172) the scene hands the band of N's reaction row to the renderer in the animation
	// frame after the click (before it paints): wait for the frame that reaches the band
	const bN = boxOf((await itemMap(p)).get(N))
	const banded = (v) => {
		const o = localOf(v, N)
		const s = v?.scene?.camera?.scale ?? 1
		return !!o && !!bN && near((o.y + o.h - bN.y - bN.h) * s, E50_GAP + E50_BAND * s, 0.1)
	}
	const before = localOf(await until(async () => {
		const v = await p.evaluate(probe, N)
		return banded(v) ? v : null
	}, { timeout: 3000 }), N)
	t.must(before, `[S] (4a) N hat vor dem Editor seinen local-Rahmen, unten ${E50_BAND} Einheiten tiefer (Band der Reaktionszeile)`, (await K.scene(p))?.outlines?.map(fmt))
	await p.keyboard.press('Enter')
	t.must(await editorShown(p, true), '[C] (4a) Enter öffnet den Editor von N')
	const open = await until(async () => {
		const v = await p.evaluate(probe, N)
		return v.scene && !localOf(v, N) && Array.isArray(v.handles) && v.handles.length === 0 ? v : null
	}, { timeout: 3000 })
	// a moment later: nothing came back while the editor stays open
	await sleep(300)
	const held = await p.evaluate(probe, N)
	t.check(!!open && !localOf(held, N) && held.handles?.length === 0 && (await selected(p, [N])), '[S] (4a) bei offenem Editor kein local-Rahmen von N und keine Griffe, N bleibt ausgewählt', { outlines: held.scene?.outlines?.map(fmt), handles: held.handles })
	t.check(!!held.scene?.outlines?.some((o) => o.kind === 'remote' && o.id === N), '[C] (4b) bobs remote-Rahmen von N bleibt bei alice, während ihr Editor offen ist', held.scene?.outlines?.map(fmt))
	await p.keyboard.press('Escape')
	t.check(await editorShown(p, false), '[C] (4a) Esc beendet den Editor')
	// (job 172) again the frame after the one the editor closed in, with the band
	const back = await until(async () => {
		const v = await p.evaluate(probe, N)
		return localOf(v, N) && v.handles?.some((x) => x.name === 'plus-r') && banded(v) ? v : null
	}, { timeout: 3000 }) ?? await p.evaluate(probe, N)
	const closed = localOf(back, N)
	t.check(!!closed && ['x', 'y', 'w', 'h', 'r'].every((k) => near(closed[k], before[k], 0.01)), '[S] (4a) nach Esc liegt der local-Rahmen von N an derselben Stelle (± 0,01), handles() enthält wieder plus-r', { vorher: fmt(before), nachher: fmt(closed), griffe: back?.handles?.map((x) => x.name) })
	await deselect(pb)
	t.must(await until(async () => !((await K.scene(p))?.outlines ?? []).some((x) => x.kind === 'remote'), { timeout: 8000 }), '[D] (4) bob wählt ab: alices remote-Rahmen geht')

	t.step('(4c) Enter auf dem gewählten Textobjekt T')
	t.must(await tabTo(p, T), '[D] (4c) Tab wählt T allein, die Ansicht steht', await K.selection(p))
	await enterEdits(t, p, T, 'T', 'text', '(4c)')
	await escBack(t, p, T, 'T', '(4c)')

	t.step('(4d) Enter auf dem gewählten Frame F öffnet den Titel-Editor')
	t.must(await tabTo(p, F), '[D] (4d) Tab wählt F allein, die Ansicht steht', await K.selection(p))
	const title = await enterEdits(t, p, F, 'F', 'title', '(4d)')
	t.check(title?.background === 'rgba(0, 0, 0, 0)' && title.shadow === 'none' && title.radius === '0px' && title.outline === 'none',
		'[S] (4d) das Titel-Textfeld hat keinen Hintergrund, keinen Schatten, keine runden Ecken und keinen Umriss (berechnet)', title)
	t.check(title?.focused === true, '[C] (4d) das Titel-Textfeld hat den Fokus', title)
	// Windows contrast themes: the frameless title field shows its focus by an outline (WCAG 2.4.7)
	try {
		await p.emulateMedia({ forcedColors: 'active' })
		const hc = await p.evaluate(editorLook, EDITOR)
		t.check(hc?.outline === 'solid' && hc.outlineWidth === '2px' && hc.focused === true,
			'[S] (4d) erzwungene Farben (forced-colors: active, emuliert): das fokussierte Titel-Textfeld zeigt eine Outline (solid, 2px)', hc)
	} finally {
		await p.emulateMedia({ forcedColors: null })
	}
	await escBack(t, p, F, 'F', '(4d)')

	t.step('(4e) Enter auf dem gewählten Verbinder K öffnet die Beschriftung')
	await deselect(p)
	const mid = await K.w2s(p, 200, 540)
	t.must(await onCanvas(p, mid), '[D] (4e) die Mitte von K liegt frei auf der Leinwand', mid)
	await p.mouse.click(mid.x, mid.y)
	t.must(await until(() => selected(p, [KC]), { timeout: 3000 }), '[S] (4e) der Klick wählt K', await K.selection(p))
	await p.keyboard.press('Enter')
	t.must(await editorShown(p, true), '[C] (4e) Enter öffnet die Beschriftung von K')
	const label = await p.evaluate(editorLook, EDITOR)
	t.check(label?.kind === 'label' && label.background === 'rgb(243, 242, 240)', '[S] (4e) das Beschriftungs-Textfeld behält seinen hellen Hintergrund (berechnet)', label)
	await p.keyboard.press('Escape')
	t.check(await editorShown(p, false), '[C] (4e) Esc beendet die Beschriftung')
	await deselect(p)
}

/** Step (5): a selected connector has no outline entry. */
async function connector(t, p, KC) {
	t.step('(5) der Verbinder K ausgewählt')
	await deselect(p)
	const mid = await K.w2s(p, 200, 540)
	t.must(await onCanvas(p, mid), '[D] (5) die Mitte von K liegt frei auf der Leinwand', mid)
	await p.mouse.click(mid.x, mid.y)
	t.must(await until(() => selected(p, [KC]), { timeout: 3000 }), '[S] (5) der Klick wählt K', await K.selection(p))
	await sleep(200)
	const outlines = (await K.scene(p))?.outlines
	t.check(Array.isArray(outlines) && outlines.length === 0, '[S] (5) ein ausgewählter Verbinder hat keinen Eintrag in scene().outlines (nur seinen Leuchtsaum)', outlines)
	await deselect(p)
}

/** Step (6): a press 3 px beside the selected N and a drag of 60 px move it. */
async function gapPress(t, p, pb, board, N) {
	t.step('(6) Mausdruck 3 px links neben der ausgewählten N, 60 px ziehen')
	const c = await centerOf(p, N)
	await p.mouse.click(c.x, c.y)
	t.must(await until(() => selected(p, [N]), { timeout: 3000 }), '[S] (6) der Klick wählt N', await K.selection(p))
	await sleep(500)
	const s = (await K.camera(p)).scale
	const n0 = (await itemMap(p)).get(N)
	const r = await K.rect(p, N)
	// 60 px below the top edge: clear of the handles tl (corner) and l (side middle)
	const from = { x: r.x - 3, y: r.y + 60 }
	t.must(await onCanvas(p, from), '[D] (6) 3 px links neben N liegt freie Leinwand', from)
	const hs = (await K.handles(p)) || []
	t.must(hs.every((h) => Math.hypot(h.x - from.x, h.y - from.y) > 8), '[D] (6) kein Griff unter dem Druckpunkt', hs)
	await dragPath(p, from, { x: from.x + 60, y: from.y })
	await K.waitIdle(p)
	const ok = (it) => !!it && near(it.x, n0.x + 60 / s, 0.5) && near(it.y, n0.y, 0.5)
	t.check(await until(async () => ok((await itemMap(p)).get(N)), { timeout: 3000 }), '[S] (6) N ist um 60 px nach rechts verschoben (lokal)', { vorher: boxOf(n0), nachher: boxOf((await itemMap(p)).get(N)) })
	await settle([p, pb])
	const srv = (await serverMap('alice', board)).get(N)
	t.check(ok(srv), '[B] (6) N steht so beim Server', boxOf(srv))
	await deselect(p)
}

/**
 * A free spot in the 'multi' frame of N and S (job 163): below S, in the middle of its width,
 * halfway between its bottom and the bottom of the hull. Client point plus what makes it free:
 * on the bare canvas, inside the frame, outside every item box grown by the gap and the mouse
 * tolerance, no handle within 8 px.
 */
async function freeSpot(p, N, S) {
	const m = await itemMap(p)
	const n = m.get(N)
	const s = m.get(S)
	const scale = (await K.camera(p)).scale
	const w = { x: s.x + s.w / 2, y: (s.y + s.h + Math.max(n.y + n.h, s.y + s.h)) / 2 }
	const pt = await K.w2s(p, w.x, w.y)
	const reach = (E50_GAP + 4) / scale
	const hits = [...m.values()].filter((it) => it.t !== 'connector' && w.x >= it.x - reach && w.x <= it.x + it.w + reach && w.y >= it.y - reach && w.y <= it.y + it.h + reach).map((it) => it.id)
	const multi = ((await K.scene(p))?.outlines ?? []).find((o) => o.kind === 'multi') ?? null
	const inside = !!multi && w.x > multi.x && w.x < multi.x + multi.w && w.y > multi.y && w.y < multi.y + multi.h
	const hs = (await K.handles(p)) || []
	const handle = hs.some((h) => Math.hypot(h.x - pt.x, h.y - pt.y) <= 8)
	const canvas = await onCanvas(p, pt)
	return { pt, world: w, ok: canvas && inside && hits.length === 0 && !handle, canvas, inside, hits, handle, multi: fmt(multi) }
}

/**
 * Step (8) (job 163): a drag from a free spot in the multi frame of N and S moves both by 60 screen
 * px (30 world units at zoom 2), locally, at the server and at bob; a click there clears the selection.
 */
async function frameDrag(t, alice, pb, board, { N, S }) {
	const p = alice.page
	t.step('(8) Zoom 2: N und S gewählt, Mausdruck auf freie Stelle im multi-Rahmen, 60 px ziehen')
	// Tab panned the view in step 7: the board opens again with the camera of step 7
	await K.waitIdle(p)
	await p.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	await storeCamera(p, board, E50_CAM2)
	await openBoard(alice, board)
	await K.waitIdle(p)
	t.must(near((await K.camera(p))?.scale, 2, 1e-9), '[D] (8) alice sieht das Board bei Zoom 2', await K.camera(p))
	await deselect(p)
	const cn = await centerOf(p, N)
	t.must(await onCanvas(p, cn), '[D] (8) die Mitte von N liegt frei auf der Leinwand', cn)
	await p.mouse.click(cn.x, cn.y)
	t.must(await until(() => selected(p, [N]), { timeout: 3000 }), '[S] (8) der Klick wählt N', await K.selection(p))
	const cs = await centerOf(p, S)
	t.must(await onCanvas(p, cs), '[D] (8) die Mitte von S liegt frei auf der Leinwand', cs)
	await p.keyboard.down('Shift')
	await p.mouse.click(cs.x, cs.y)
	await p.keyboard.up('Shift')
	t.must(await until(() => selected(p, [N, S]), { timeout: 3000 }), '[S] (8) Umschalt+Klick: Auswahl N und S', await K.selection(p))
	t.must(await probeFor(p, 'multi'), '[S] (8) scene().outlines hat einen multi-Rahmen', (await K.scene(p))?.outlines)
	const m0 = await itemMap(p)
	const n0 = m0.get(N)
	const s0 = m0.get(S)
	const from = await freeSpot(p, N, S)
	t.must(from.ok, '[D] (8) freie Stelle im multi-Rahmen: Leinwand, kein Element (mit Abstand) und kein Griff darunter', from)
	await dragPath(p, from.pt, { x: from.pt.x + 60, y: from.pt.y })
	await K.waitIdle(p)
	const dx = 60 / (await K.camera(p)).scale
	const movedBy = (m) => [[N, n0], [S, s0]].every(([id, b]) => {
		const it = m.get(id)
		return !!it && near(it.x, b.x + dx, 0.5) && near(it.y, b.y, 0.5)
	})
	const boxes = (m) => ({ N: boxOf(m?.get(N)), S: boxOf(m?.get(S)) })
	t.check(await until(async () => movedBy(await itemMap(p)), { timeout: 3000 }), '[S] (8) N und S sind um 30 Welteinheiten nach rechts verschoben (lokal)', { vorher: { N: boxOf(n0), S: boxOf(s0) }, nachher: boxes(await itemMap(p)) })
	await settle([p, pb])
	const srv = await serverMap('alice', board)
	t.check(movedBy(srv), '[B] (8) N und S stehen so beim Server', boxes(srv))
	t.check(await until(async () => movedBy(await itemMap(pb)), { timeout: 8000 }), '[C] (8) bob sieht N und S an der neuen Stelle', boxes(await itemMap(pb)))
	t.step('(8) Klick ohne Bewegung auf freie Stelle im Rahmen')
	t.must(await until(() => selected(p, [N, S]), { timeout: 2000 }), '[S] (8) nach dem Ziehen sind N und S weiter gewählt', await K.selection(p))
	const spot = await freeSpot(p, N, S)
	t.must(spot.ok, '[D] (8) freie Stelle im verschobenen multi-Rahmen', spot)
	await p.mouse.click(spot.pt.x, spot.pt.y)
	t.check(await until(async () => ((await K.selection(p)) || []).length === 0, { timeout: 3000 }), '[S] (8) der Klick auf die freie Stelle im Rahmen hebt die Auswahl auf (__knorke.selection())', await K.selection(p))
}
