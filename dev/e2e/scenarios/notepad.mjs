/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Note pads (factory job 188, AK9; job 193 AK6: a new pad opens its title).
 *
 * E74 alice (owner), bob (guest of the edit link) and Tina (a tablet guest
 * of the edit link: touch, 820 × 1180, a fine pointer too, so mode edit),
 * Chromium, every page with the same camera (CAM, 80 %), on a board of
 * their own with the frame F at (0, 0), 700 × 450. Steps:
 *   (a) alice chooses "Note pad" among the variants of the note tool (job
 *       229: a right-click on [data-knorke-tool=sticky],
 *       [data-knorke-tool-variants=sticky] [data-knorke-tool-option=pad])
 *       and clicks into F: a pad P with parent F, selected, the tool back on
 *       select, (job 193) its padTitle editor open and empty; Esc closes it,
 *       P stays untitled; N and a click after it give a note (the type is
 *       Note again);
 *   (b) alice drags from P's pile out of F: a note in P's colour and size at
 *       the drop place (the pile's corner plus the way), without a parent,
 *       selected, its note editor open; she types "Idee" and presses Esc;
 *       bob sees it with its text at the latest 3 s later; Ctrl+Z removes
 *       it (at bob too), P stays;
 *   (c) a click on the pile changes neither the items nor the selection;
 *   (d) bob gives P the title "Ideen" with a double click on its band
 *       (editor kind padTitle, Enter), alice sees it; bob drags a note off P;
 *   (e) alice locks P (Ctrl+Shift+L); bob's drag on the band moves nothing,
 *       from the pile he still gets a note;
 *   (f) Enter at the selected P (alice) puts a note right of it, covering
 *       no item, its editor open;
 *   (g) Tina's finger drags a note off the (locked) pile;
 *   (i) a right click on empty canvas lists no "Add note pad here" (job 230); the tool option "Note pad" and a click there give a pad,
 *       (job 193) its padTitle editor open; alice types "Mehr" and clicks
 *       beside it: the title, bob sees it; Ctrl+Z removes the pad with it;
 *   (h) alice in mode "Vote" (a session through route 22): a drag from the
 *       pile creates nothing and shows no preview.
 * (i) runs before (h): the session started in (h) stays open to the end.
 * Own board, no instance setting: directly after E73@820x1180 (job 189),
 * before E09. Flake gate: --only E74 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (tool, press, preview, editor, handles), [C] session and sync (what
 * reaches the other one, undo), [B] the server, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, settle, sleep, itemMap, idSet, serverMap, dragPath, field, action } from '../lib/harness.mjs'

/** The camera every page opens with: world (0, 0) 200 px right of and 120 px below the canvas corner, 80 %. */
const CAM = Object.freeze({ x: -250, y: -150, scale: 0.8 })
/** Where alice clicks with "Note pad" (world): the pad's centre, so P is (50, 50)–(250, 250), (job 263) its binding y 50–86, the tear line at y 92. */
const AT = Object.freeze({ x: 150, y: 150 })
/** A point on P's pile and one on its band, (job 263) the binding on top (world). */
const PILE = Object.freeze({ x: 150, y: 150 })
const BAND = Object.freeze({ x: 150, y: 68 })
/** Where alice clicks with N in (a) (world): the note (450, 260)–(650, 460) in F, clear of the place of (f). */
const N1_AT = Object.freeze({ x: 550, y: 360 })
/** AK9 (b): bob sees the note at the latest this long after alice's Esc. */
const SEEN_MS = 3000
const MENU = '[data-knorke-menu=context]'

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** A guest joins through /p/<token> with `name`, with the camera stored first. */
async function joinAsGuest(actor, token, name, board) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await storeCamera(actor.page, board, CAM)
	await field(actor.page, 'guest-name', name)
	await action(actor.page, 'guest-join')
	await waitReady(actor.page, 30000)
}

/** Client point of a world point on a page. */
const at = (page, p) => K.w2s(page, p.x, p.y)

/** Are all client points on the bare canvas (the Konva canvas inside .knorke-canvas, nothing on top)? */
async function onCanvas(page, pts) {
	return page.evaluate(([sel, list]) => list.every(({ x, y }) => {
		const el = document.elementFromPoint(x, y)
		return !!el && el.tagName === 'CANVAS' && !!el.closest(sel)
	}), [CANVAS, pts])
}

/** The new item of type t in items() of a page, not in `before`; null within the time. */
async function newOf(page, before, t, timeout = 5000) {
	return until(async () => {
		for (const [k, it] of await itemMap(page)) if (!before.has(k) && it.t === t) return k
		return null
	}, { timeout })
}

/** The open text editor of a page: {kind, value} or null. */
const editorOf = (page) => page.evaluate(() => {
	const ta = document.querySelector('textarea[data-knorke-editor]')
	return ta ? { kind: ta.getAttribute('data-knorke-editor-kind'), value: ta.value } : null
}).catch(() => null)

/** The world box of an item (parent offsets resolved through items()), or null. */
async function absOf(page, id) {
	const m = await itemMap(page)
	let it = m.get(id)
	if (!it) return null
	const box = { x: it.x, y: it.y, w: it.w, h: it.h }
	for (let n = 0; it?.parent && n < 8; n++) {
		it = m.get(it.parent)
		if (!it) break
		box.x += it.x
		box.y += it.y
	}
	return box
}

/** @param {Map} m items @param {string} id item @return {string|null} its parent */
const parentOf = (m, id) => m.get(id)?.parent ?? null

/** Two boxes share an area (touching does not count). */
const covers = (a, b) => a.x + 0.01 < b.x + b.w && b.x + 0.01 < a.x + a.w && a.y + 0.01 < b.y + b.h && b.y + 0.01 < a.y + a.h

/** One finger from `a` to `b` in `steps` moves, one frame apart (CDP touch events, like a real finger). */
async function fingerDrag(cdp, a, b, steps = 12) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] })
	for (let i = 1; i <= steps; i++) {
		await sleep(16)
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }] })
	}
	await sleep(16)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

export const E74 = {
	id: 'E74',
	title: 'Notizblock (Job 188): alice legt über den Pfeil der Notiz („Note pad“) einen Block in einen Frame, sein Titel-Editor ist offen, Esc lässt ihn leer, N gibt danach eine Notiz; sie zieht eine Notiz vom Stapel aus dem Frame, schreibt „Idee“, bob sieht sie ≤ 3 s, Strg+Z nimmt sie weg; ein Klick auf den Stapel ändert nichts; bob betitelt den Block per Doppelklick aufs Band und zieht eine Notiz ab; gesperrt verschiebt sein Ziehen am Band nichts, der Stapel gibt weiter Notizen; Enter legt eine Notiz rechts daneben; ein Finger (Tablet) zieht eine Notiz ab; „Add note pad here“ öffnet den Titel, „Mehr“ und ein Klick daneben betiteln ihn, Strg+Z nimmt ihn ganz weg; im Modus „Vote“ gibt der Stapel nichts',
	async run(t, world) {
		const board = await world.board('E74 Notizblock')
		const L = await linkToken(board)
		const F = ulid()
		const res = await seedOps('alice', board, [put.frame(F, { x: 0, y: 0, w: 700, h: 450, data: { title: 'Frame' } })])
		t.must(res.every((x) => x === 'ok'), '[D] Vorbedingung: Frame F gesät', res)
		const a = await world.actor('alice-pad', { user: 'alice' })
		const b = await world.actor('bob-pad')
		let tab = null
		const pa = a.page
		const pb = b.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			await joinAsGuest(b, L, 'Bob Gast', board)
			const sb = await K.state(pb)
			t.must(sb.mode === 'guest' && sb.role === 'edit' && sb.uiMode === 'edit', '[D] Vorbedingung: bob ist Gast des Bearbeiten-Links im Modus edit', sb)
			t.must(await until(async () => (await itemMap(pb)).has(F), { timeout: 8000 }), '[D] Vorbedingung: beide sehen F')

			t.step('(a) alice wählt „Note pad“ am Notizwerkzeug und klickt in F')
			await pa.locator('[data-knorke-tool=sticky]').first().click({ button: 'right', timeout: 3000 })
			await pa.locator('[data-knorke-tool-option=pad]').first().click({ timeout: 3000 })
			t.must(await until(async () => (await pa.locator('[data-knorke-tool=sticky]').first().getAttribute('aria-pressed')) === 'true', { timeout: 2000 }), '[S] (a) „Note pad“ wählt das Notizwerkzeug (aria-pressed)')
			const pAt = await at(pa, AT)
			t.must(await onCanvas(pa, [pAt]), '[D] Vorbedingung: der Klickpunkt liegt frei auf der Leinwand', pAt)
			const before = await idSet(pa)
			await pa.mouse.click(pAt.x, pAt.y)
			const P = await newOf(pa, before, 'pad')
			t.must(P, '[S] (a) ein Klick legt einen Notizblock an')
			const p0 = (await itemMap(pa)).get(P)
			t.check(p0.parent === F && p0.x === 50 && p0.y === 50 && p0.w === 200 && p0.h === 200, '[C] (a) P mit F als Eltern, die Mitte am Klickpunkt, 200 × 200', p0)
			t.check(p0.data?.title === '' && p0.style?.fill === '#a2d9fe', '[C] (a) ohne Titel, in der Notiz-Vorgabefarbe (job 227: Light blue)', [p0.data, p0.style])
			t.check(JSON.stringify(await K.selection(pa)) === JSON.stringify([P]), '[S] (a) P ist gewählt', await K.selection(pa))
			// job 193: the title editor opens at once, like a new frame's
			const aed = await until(() => editorOf(pa), { timeout: 3000 })
			t.check(aed?.kind === 'padTitle' && aed.value === '', '[S] (a) der Titel-Editor (padTitle) ist gleich offen und leer', aed)
			t.check((await K.scene(pa)).tool === 'select', '[S] (a) das Werkzeug springt auf Auswahl', (await K.scene(pa)).tool)
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await editorOf(pa)) === null, { timeout: 2000 }), '[S] (a) Esc schließt den Titel-Editor')
			await settle([pa, pb])
			t.check((await itemMap(pa)).get(P)?.data?.title === '' && (await serverMap('alice', board)).get(P)?.data?.title === '', '[C] (a) P bleibt ohne Titel stehen, auch beim Server')
			t.must(await until(async () => JSON.stringify(await K.selection(pa)) === JSON.stringify([P]), { timeout: 2000 }), '[D] Vorbedingung: P bleibt nach Esc gewählt', await K.selection(pa))
			const hs = (await K.handles(pa)) || []
			t.check(JSON.stringify(hs.map((h) => h.name).sort()) === JSON.stringify(['bl', 'br', 'tl', 'tr']), '[S] (a) vier Eckgriffe, kein Drehgriff, kein „+“', hs.map((h) => h.name))
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('n')
			const nAt = await at(pa, N1_AT)
			const before2 = await idSet(pa)
			await pa.mouse.click(nAt.x, nAt.y)
			const N1 = await newOf(pa, before2, 'sticky')
			t.check(!!N1, '[S] (a) N und ein Klick geben danach eine Notiz (die Option steht wieder auf „Note“)', N1)
			t.check((await newOf(pa, before2, 'pad', 300)) === null, '[S] (a) und keinen zweiten Block')
			if (await editorOf(pa)) await pa.keyboard.press('Escape')
			// job 226: the context bar of N1 (36 px buttons) reaches the drop place of (b); Esc clears the selection
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Escape')
			await settle([pa, pb])

			t.step('(b) alice zieht vom Stapel eine Notiz aus F heraus, schreibt „Idee“, bob sieht sie, Strg+Z')
			const from = await at(pa, PILE)
			const to = await at(pa, { x: PILE.x + 800, y: PILE.y })
			t.must(await onCanvas(pa, [to]), '[D] Vorbedingung: der Ablageort liegt frei auf der Leinwand', to)
			const before3 = await idSet(pa)
			await dragPath(pa, from, to, { steps: 14 })
			const NB = await newOf(pa, before3, 'sticky')
			t.must(NB, '[S] (b) das Ziehen vom Stapel legt eine Notiz an')
			const nb = (await itemMap(pa)).get(NB)
			t.check(nb.parent === null && Math.abs(nb.x - 850) <= 1.5 && Math.abs(nb.y - 50) <= 1.5, '[S] (b) am Ablageort (Stapelecke plus Weg, ±1,5), ohne Eltern', nb)
			t.check(nb.w === 200 && nb.h === 200 && nb.style?.fill === p0.style.fill, '[C] (b) in Farbe und Größe des Blocks', [nb.w, nb.h, nb.style])
			t.check(JSON.stringify(await K.selection(pa)) === JSON.stringify([NB]), '[S] (b) die Notiz ist gewählt', await K.selection(pa))
			const ed = await until(() => editorOf(pa), { timeout: 3000 })
			t.check(ed?.kind === 'note', '[S] (b) ihr Notiz-Editor ist offen', ed)
			t.check(JSON.stringify(await absOf(pa, P)) === JSON.stringify({ x: 50, y: 50, w: 200, h: 200 }), '[C] (b) der Block bleibt, wo er ist')
			await pa.keyboard.type('Idee')
			await pa.keyboard.press('Escape')
			const esc = Date.now()
			const seen = await until(async () => ((await itemMap(pb)).get(NB)?.data?.text === 'Idee' ? Date.now() : null), { timeout: SEEN_MS + 2000, every: 50 })
			t.check(seen !== null && seen - esc <= SEEN_MS, `[C] (b) bob sieht die Notiz mit „Idee“ spätestens ${SEEN_MS} ms nach dem Esc`, seen === null ? null : seen - esc)
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => !(await itemMap(pa)).has(NB) && !(await itemMap(pb)).has(NB), { timeout: 5000 }), '[C] (b) Strg+Z entfernt die Notiz (samt Text), auch bei bob')
			await settle([pa, pb])
			t.check((await itemMap(pa)).has(P) && (await serverMap('alice', board)).has(P) && !(await serverMap('alice', board)).has(NB), '[B] (b) beim Server: der Block bleibt, die Notiz ist weg')

			t.step('(c) ein Klick auf den Stapel ändert weder die Objekte noch die Auswahl')
			const n1 = await at(pa, N1_AT)
			await pa.mouse.click(n1.x, n1.y)
			t.must(await until(async () => JSON.stringify(await K.selection(pa)) === JSON.stringify([N1]), { timeout: 2000 }), '[D] (c) Vorbedingung: die Notiz aus (a) ist gewählt')
			await settle([pa, pb])
			const items0 = JSON.stringify(await K.items(pa))
			const pile = await at(pa, PILE)
			await pa.mouse.click(pile.x, pile.y)
			await sleep(300)
			await settle([pa, pb])
			t.check(JSON.stringify(await K.items(pa)) === items0, '[S] (c) die Objekte sind unverändert')
			t.check(JSON.stringify(await K.selection(pa)) === JSON.stringify([N1]), '[S] (c) die Auswahl bleibt', await K.selection(pa))
			t.check((await editorOf(pa)) === null, '[S] (c) kein Editor')

			t.step('(d) bob betitelt den Block per Doppelklick aufs Band und zieht eine Notiz ab')
			const band = await at(pb, BAND)
			t.must(await onCanvas(pb, [band]), '[D] Vorbedingung: das Band liegt bei bob frei', band)
			await pb.mouse.dblclick(band.x, band.y)
			const ted = await until(() => editorOf(pb), { timeout: 3000 })
			t.check(ted?.kind === 'padTitle', '[S] (d) der Doppelklick aufs Band öffnet den Titel (padTitle)', ted)
			await pb.keyboard.type('Ideen')
			await pb.keyboard.press('Enter')
			t.check(await until(async () => (await editorOf(pb)) === null, { timeout: 2000 }), '[S] (d) Enter beendet den Titel-Editor')
			t.check(await until(async () => (await itemMap(pa)).get(P)?.data?.title === 'Ideen', { timeout: 5000 }), '[C] (d) alice sieht den Titel „Ideen“')
			await settle([pa, pb])
			const bFrom = await at(pb, PILE)
			const bTo = await at(pb, { x: PILE.x + 800, y: PILE.y + 300 })
			const before4 = await idSet(pb)
			await dragPath(pb, bFrom, bTo, { steps: 14 })
			const ND = await newOf(pb, before4, 'sticky')
			t.check(!!ND, '[S] (d) bob zieht eine Notiz ab')
			if (await editorOf(pb)) await pb.keyboard.press('Escape')
			await settle([pa, pb])
			t.check((await itemMap(pa)).has(ND), '[C] (d) alice sieht bobs Notiz')

			t.step('(e) alice sperrt den Block; bobs Ziehen am Band verschiebt nichts, der Stapel gibt weiter Notizen')
			const aBand = await at(pa, BAND)
			await pa.mouse.click(aBand.x, aBand.y)
			t.must(await until(async () => JSON.stringify(await K.selection(pa)) === JSON.stringify([P]), { timeout: 2000 }), '[D] (e) Vorbedingung: alice hat P gewählt')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+Shift+L')
			t.must(await until(async () => !!(await itemMap(pb)).get(P)?.lock, { timeout: 5000 }), '[C] (e) P ist gesperrt, auch bei bob')
			await settle([pa, pb])
			const eFrom = await at(pb, BAND)
			await dragPath(pb, eFrom, { x: eFrom.x + 120, y: eFrom.y + 90 }, { steps: 12 })
			await settle([pa, pb])
			t.check(JSON.stringify(await absOf(pb, P)) === JSON.stringify({ x: 50, y: 50, w: 200, h: 200 }), '[S] (e) bobs Ziehen am Band verschiebt nichts', await absOf(pb, P))
			const before5 = await idSet(pb)
			await dragPath(pb, await at(pb, PILE), await at(pb, { x: PILE.x + 1100, y: PILE.y }), { steps: 14 })
			const NE = await newOf(pb, before5, 'sticky')
			t.check(!!NE, '[S] (e) vom gesperrten Stapel bekommt bob trotzdem eine Notiz')
			if (await editorOf(pb)) await pb.keyboard.press('Escape')
			await settle([pa, pb])
			t.check((await serverMap('alice', board)).has(NE), '[B] (e) beim Server angekommen')

			t.step('(f) Enter am gewählten Block legt eine Notiz rechts daneben')
			await pa.keyboard.press('Escape')
			await pa.mouse.click(aBand.x, aBand.y)
			t.must(await until(async () => JSON.stringify(await K.selection(pa)) === JSON.stringify([P]), { timeout: 2000 }), '[D] (f) Vorbedingung: P ist gewählt')
			await pa.locator(CANVAS).first().focus()
			const before6 = await idSet(pa)
			await pa.keyboard.press('Enter')
			const NF = await newOf(pa, before6, 'sticky')
			t.must(NF, '[S] (f) Enter legt eine Notiz an')
			const fBox = await absOf(pa, NF)
			t.check(fBox.x === 50 + 200 + 20 && fBox.y === 50, '[C] (f) rechts vom Block, 20 daneben (Job 263: Blätter nur nach unten), oben bündig', fBox)
			t.check(parentOf(await itemMap(pa), NF) === F, '[C] (f) im Frame des Blocks (sie passt hinein)')
			const m6 = await itemMap(pa)
			const hit = []
			for (const [k, it] of m6) {
				if (k === NF || it.t === 'frame' || it.t === 'connector') continue
				const box = await absOf(pa, k)
				if (it.t === 'pad') Object.assign(box, { h: box.h + 12 })
				if (covers(fBox, box)) hit.push(k)
			}
			t.check(hit.length === 0, '[C] (f) ohne Überlappung mit einem anderen Objekt (ein Block mit seinen Blättern)', hit)
			const fed = await until(() => editorOf(pa), { timeout: 3000 })
			t.check(fed?.kind === 'note', '[S] (f) ihr Editor ist offen', fed)
			await pa.keyboard.press('Escape')
			await settle([pa, pb])

			t.step('(g) ein Finger (Tablet) zieht eine Notiz vom Stapel')
			tab = await world.actor('tina-pad', { touch: true, fine: true })
			const pt = tab.page
			await joinAsGuest(tab, L, 'Tina', board)
			const st = await K.state(pt)
			t.must(st.uiMode === 'edit', '[D] Vorbedingung: das Tablet ist im Modus edit', st)
			t.must(await until(async () => (await itemMap(pt)).has(P), { timeout: 8000 }), '[D] Vorbedingung: Tina sieht P')
			const gFrom = await at(pt, PILE)
			const gTo = await at(pt, { x: PILE.x, y: PILE.y + 520 })
			t.must(await onCanvas(pt, [gFrom, gTo]), '[D] Vorbedingung: Stapel und Ablageort liegen beim Tablet frei', [gFrom, gTo])
			const cdp = await tab.ctx.newCDPSession(pt)
			const cam7 = await K.camera(pt)
			const before7 = await idSet(pt)
			await fingerDrag(cdp, gFrom, gTo)
			const NG = await newOf(pt, before7, 'sticky')
			t.check(!!NG, '[S] (g) der Finger zieht vom (gesperrten) Stapel eine Notiz')
			t.check(JSON.stringify(await K.camera(pt)) === JSON.stringify(cam7), '[S] (g) der Finger schwenkt nicht', await K.camera(pt))
			if (NG) {
				const ng = await absOf(pt, NG)
				t.check(Math.abs(ng.x - 50) <= 2 && Math.abs(ng.y - 570) <= 2, '[S] (g) am Ablageort des Fingers (±2)', ng)
			}
			await settle([pa, pb, pt])

			// job 230: the menu of the empty canvas no longer lists "Add note pad here"; the tool option places a pad
			t.step('(i) Rechtsklick auf leere Fläche (ohne „Add note pad here“), dann „Note pad“ und ein Klick dort')
			await pa.keyboard.press('Escape').catch(() => {})
			const iAt = await at(pa, { x: 950, y: 700 })
			t.must(await onCanvas(pa, [iAt]), '[D] Vorbedingung: die Stelle liegt frei auf der Leinwand', iAt)
			await pa.mouse.move(iAt.x, iAt.y)
			await pa.mouse.click(iAt.x, iAt.y, { button: 'right' })
			t.must(await until(async () => (await pa.locator(MENU).count()) > 0, { timeout: 3000 }), '[S] (i) das Menü der leeren Fläche öffnet sich')
			const names = await pa.locator(`${MENU} button[data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			t.check(!names.includes('pad-here') && !names.includes('note-here'), '[S] (i) kein „Add note pad here“ und kein „Add note here“ (Job 230)', names)
			await pa.keyboard.press('Escape')
			// job 229: the variants of the note tool by a right-click on it
			await pa.locator('[data-knorke-tool=sticky]').first().click({ button: 'right', timeout: 3000 })
			await pa.locator('[data-knorke-tool-option=pad]').first().click({ timeout: 3000 })
			const before8 = await idSet(pa)
			await pa.mouse.click(iAt.x, iAt.y)
			const PI = await newOf(pa, before8, 'pad')
			t.check(!!PI, '[S] (i) ein Block entsteht')
			if (PI) {
				const pi = await absOf(pa, PI)
				t.check(Math.abs(pi.x + 100 - 950) <= 1.5 && Math.abs(pi.y + 100 - 700) <= 1.5, '[S] (i) mit der Mitte an der Stelle des Rechtsklicks (±1,5)', pi)
			}
			// job 193: its title editor opens and keeps the focus; a click beside it sets the title
			const ied = await until(() => editorOf(pa), { timeout: 3000 })
			t.check(ied?.kind === 'padTitle' && ied.value === '', '[S] (i) der Titel-Editor (padTitle) ist gleich offen', ied)
			await pa.keyboard.type('Mehr')
			const iOff = await at(pa, { x: 1200, y: 500 })
			t.must(await onCanvas(pa, [iOff]), '[D] Vorbedingung: die Stelle daneben liegt frei auf der Leinwand', iOff)
			await pa.mouse.click(iOff.x, iOff.y)
			t.check(await until(async () => (await editorOf(pa)) === null, { timeout: 2000 }), '[S] (i) ein Klick daneben schließt den Titel-Editor')
			if (PI) {
				t.check(await until(async () => (await itemMap(pa)).get(PI)?.data?.title === 'Mehr', { timeout: 3000 }), '[C] (i) der Block heißt „Mehr“', (await itemMap(pa)).get(PI)?.data)
				t.check(await until(async () => (await itemMap(pb)).get(PI)?.data?.title === 'Mehr', { timeout: 5000 }), '[C] (i) bob sieht den Titel „Mehr“')
				await settle([pa, pb, pt])
				await pa.locator(CANVAS).first().focus()
				await pa.keyboard.press('Control+z')
				t.check(await until(async () => !(await itemMap(pa)).has(PI), { timeout: 3000 }), '[C] (i) ein Strg+Z nimmt den Block samt Titel weg')
				await settle([pa, pb, pt])
				t.check(!(await serverMap('alice', board)).has(PI), '[B] (i) beim Server ist der Block weg')
			}
			await settle([pa, pb, pt])

			t.step('(h) alice im Modus „Vote“: Ziehen vom Stapel legt nichts an')
			const vs = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
			t.must(vs.status === 200, '[B] (h) Route 22 → 200', vs.text.slice(0, 200))
			let mode = await until(async () => ((await K.state(pa)).uiMode === 'vote' ? 'vote' : null), { timeout: 5000 })
			if (!mode) {
				await pa.locator('[data-knorke-action=vote-mode]').first().click().catch(() => {})
				mode = await until(async () => ((await K.state(pa)).uiMode === 'vote' ? 'vote' : null), { timeout: 3000 })
				t.note('(h) alice war nach dem Start nicht im Modus vote; vote-mode geklickt')
			}
			t.must(mode === 'vote', '[C] (h) Vorbedingung: alice im Modus vote', await K.state(pa))
			const ids9 = JSON.stringify([...(await idSet(pa))].sort())
			const hFrom = await at(pa, PILE)
			const hTo = await at(pa, { x: PILE.x + 800, y: PILE.y })
			await pa.mouse.move(hFrom.x, hFrom.y)
			await pa.mouse.down()
			for (let i = 1; i <= 10; i++) {
				await pa.mouse.move(hFrom.x + ((hTo.x - hFrom.x) * i) / 10, hFrom.y + ((hTo.y - hFrom.y) * i) / 10)
				await sleep(16)
			}
			t.check((await K.scene(pa)).notePreview === null, '[S] (h) keine Vorschau im Modus vote', (await K.scene(pa)).notePreview)
			await pa.mouse.up()
			await sleep(500)
			await settle([pa, pb, pt])
			t.check(JSON.stringify([...(await idSet(pa))].sort()) === ids9, '[S] (h) nichts ist entstanden')
		} finally {
			if (tab) await world.drop(tab)
			await world.drop(b)
			await world.drop(a)
		}
	},
}
