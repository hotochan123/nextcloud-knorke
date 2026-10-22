/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * M1 stage 1, rounds 1a and 1b (SPEC-M1 §8.4), each on its own boards and
 * contexts; no instance setting changes, so they run before E09:
 *
 * E21 shapes and the transformer: tool S (key with the canvas focused), drag
 *   a shape (its text editor opens without a frame: no outline, border or
 *   shadow, only the caret; under emulated forced colors the focused editor
 *   shows a solid 2 px outline, WCAG 2.4.7); drag the corner handle br
 *   (__knorke.handles()), rotate by 45° with the rotation handle, Ctrl+Z
 *   (one step); a second shape, Shift+click, uniform scaling of the
 *   multi-selection (4 corners, no rotation handle), Ctrl+Z (one step); bob
 *   (link member) sees every end state.
 * E22 text items: tool T + click opens the text editor (without a frame: no
 *   outline, border or shadow, only the caret); three lines → h grows; the
 *   side handle r makes the wrap width narrower (more lines, larger h, same
 *   font size); the corner handle br scales font size and width by k; an
 *   empty text item disappears when its editor closes. Serial input (R2):
 *   note (its editor opens without a frame as well), type, Tab, type, Tab,
 *   type, Esc → three notes side by side (+20), three undo steps.
 * E23 connectors (round 1b): key L with the canvas focused, drag from note A
 *   to note B → a connector bound to both (placement none, creation defaults
 *   route straight and end cap arrow); __knorke.connector(id) starts on A's
 *   border and ends on B's (±2). A is dragged and held: the route follows at
 *   alice (local preview) and at bob (remote drag preview through the box
 *   resolver), and after the release by A's displacement, the stored ends
 *   unchanged. Delete B: data.end becomes the free point at the last docking
 *   point (±2; deleteItems v2 releases before the remove), also at bob and the
 *   server; Ctrl+Z revives B and binds the end again. Route "elbow" and end cap
 *   "dot" through the context bar ([data-knorke-style=data.route|style.endCap]),
 *   the label by a double click on the line (editor kind label), all seen by
 *   bob and the server. The end handle of the selected connector dragged onto
 *   C retargets the end (Ctrl+Z hangs it back), and the lower "+" handle of the
 *   selected note A dragged onto C creates a connector A → C. A selected
 *   connector shows exactly the handles 'start' and 'end' and no transformer
 *   handle (R11). End and "+" handles are picked by their frozen names
 *   (SPEC-M1 §6.7, R11: 'end', 'plus-b'; pickHandle); the pick by position
 *   among the non-transformer handles stays as a fallback, with a note.
 * E24 copy/paste: a frame with 2 notes and a connector between them is
 *   copied (Ctrl+A, Ctrl+C: toast "4 items copied") and pasted into board 2
 *   (new ids, children in the new frame at their relative positions, the
 *   connector bound to the copies with its anchor and label – remapEndpoint,
 *   §6.5.3 –, its anchored start exactly at the anchor point of the new note
 *   (rule 14 formula, ±0.01, R11), box centre at the pointer, one undo
 *   step); copying just the two
 *   notes takes the connector along (both ends in the payload), copying one
 *   note leaves it out; Ctrl+D (+20/+20); Ctrl+Shift+V in
 *   place (Chromium delivers only text/plain there: the localStorage store of
 *   §6.5.3 must turn it into objects, not notes); multi-line plain text → one
 *   note per line; selected page text stays a browser copy (Knorke intercepts
 *   nothing). Chromium is the main run. WebKit is a real case for the paste
 *   catcher (§6.5.3, R2): Ctrl+V must fire a trusted `paste` on
 *   textarea[data-knorke-paste-catcher], Knorke handles it (defaultPrevented)
 *   and gives the focus back to the canvas. Playwright's headless WebKit (WPE)
 *   carries no data through its clipboard (probed 12.10.2026: copy handler and
 *   execCommand run, the paste event comes with zero types), so the WebKit
 *   CONTENT check dispatches a paste event with the clip of §6.5.3 built from
 *   the store Knorke wrote on Ctrl+C. Firefox runs the main flow as a report
 *   (notes only) with the pointer prefs of lib/browsers.mjs (headless Firefox
 *   has no fine pointer and Knorke would only let it look) and reports uiMode;
 *   an abort note names the running step and the last lines of Playwright's
 *   call log, and the login gets one second attempt (SPEC-M1 §21, R10).
 *   Page errors: the second Chromium tab counts like the first (the Actor
 *   watches its whole context); the WebKit actor is no World actor, so E24
 *   checks its errors itself; Firefox lists them in its note.
 * E25 frame resize at the top-left handle (keep, rule 15): enlarging keeps the
 *   absolute position of every child; shrinking past a child's centre
 *   releases that child (parent null, absolute position kept); at alice and
 *   bob, ±1.
 * E26 keyboard and focus: right after the board opens, N without any click
 *   selects the note tool (R10: the session focused the canvas); keyboard
 *   only, Tab selects frames first, then content by y/x, and leaves the
 *   canvas after the last item; arrows move by 1, Shift+arrows by 10; Enter
 *   opens the editor; "Arrange" sets width, height and angle; two selected
 *   items and "Connect" activated from the keyboard (focus + Enter) create a
 *   connector between them (1b); "Align items" (two notes): Enter on the
 *   toggle opens its panel, one Tab leads to "Align left edges", Shift+Tab
 *   back to the toggle, the panel lies below the bar; after a mouse click on
 *   a command the canvas has the focus and the panel stays open, a first Esc
 *   closes only the panel (selection and bar stay), a second Esc clears the
 *   selection (also after the preventDefault of a Nextcloud header menu,
 *   E40); the key N with the focus in the TopBar does nothing; after a mouse
 *   click on a toolbar button the focus is back on the canvas and N selects
 *   the note tool, a click creates a note.
 *
 * Check labels start with exactly ONE owner of a red check (SPEC-M1 §9.6;
 * stage1.test.mjs refuses two): [S] where the check fails in the scene –
 * canvas drawing, hit, gesture, focus on click, keys of the canvas, the
 * transformer and its handles, the text editor, tab order, editor kind; [C]
 * where it fails in the replica, sync or session – shell, tool state and
 * aria-pressed, clipboard, toasts, __knorke hooks, DOM hooks, undo, what a
 * second actor (bob) sees, transformItems and its membership patches; [B]
 * where server state is compared (after the local check passed) or a server
 * answer is wrong.
 * Coordinates: worldAt() places everything inside the visible canvas; boxes
 * are compared in world units with ±1 plus one screen pixel (tol).
 * page.waitForFunction is not used (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { webkit, firefox } from 'playwright'
import {
	K, APP, api, waitReady, until, sleep, openBoard, itemMap, idSet, centerOf, selectItem, tool, settle, newActor, action,
	ulid, seedOps, serverMap, put, CANVAS, canvasFocused, toolPressed, worldAt, dragPath, handleOf, recordToasts, toastsOf, sameList,
	login, extraHandles, onBorder, nearPt, styleButton, closeContextPanels, TRANSFORM_HANDLES, PLUS_HANDLES, END_HANDLES,
	handleNames, pickHandle,
} from '../lib/harness.mjs'
import { anchorPoint } from '../lib/geom.mjs'
import { countedErrors, firefoxLaunchOptions, FIREFOX_TIMEOUT_MS, abortNote, retryOnce } from '../lib/browsers.mjs'

const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight']
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol
const boxOf = (it) => (it ? { x: it.x, y: it.y, w: it.w, h: it.h, r: it.r } : null)
const sameBox = (a, b, tol = 0.01) => !!a && !!b && ['x', 'y', 'w', 'h', 'r'].every((k) => near(a[k], b[k], tol))
const fmt = (b) => (b ? ['x', 'y', 'w', 'h', 'r'].map((k) => `${k} ${Number(b[k]).toFixed(2)}`).join(', ') : 'null')
/** Sorted names of the transformer handles of a handles() list (round 1b adds "+" and end handles to the list, §6.7). */
const transformNames = (hs) => handleNames(hs, TRANSFORM_HANDLES)
/** Sorted names of the "+" handles of a handles() list (§6.7, R11: plus-t, plus-r, plus-b, plus-l). */
const plusNames = (hs) => handleNames(hs, PLUS_HANDLES)
const ALL_PLUS = [...PLUS_HANDLES].sort()

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** bob opens the board through its edit link (link member), like E19. */
async function bobViaLink(world, name, token) {
	const b = await world.actor(name, { user: 'bob' })
	await b.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await waitReady(b.page, 30000)
	return b
}

/** Clicks a world point (client coordinates through worldToScreen). */
async function clickWorld(page, x, y, opts = {}) {
	const c = await K.w2s(page, x, y)
	await page.mouse.click(c.x, c.y, opts)
}

/** Focus on the canvas host without a pointer (setup only; E26 tests the real ways). */
async function focusCanvas(page) {
	await page.locator(CANVAS).first().focus()
}

/** Shows every item (Shift+1 = fit, SPEC-M1 §6.10) with the canvas focused. */
async function fitAll(page) {
	await focusCanvas(page)
	await page.keyboard.press('Shift+Digit1')
	await sleep(400)
}

/** The open text editor (any kind) and its data-knorke-editor-kind. */
const editor = (page) => page.locator('textarea[data-knorke-editor]').first()
async function editorKind(page) {
	return editor(page).getAttribute('data-knorke-editor-kind', { timeout: 2000 }).catch(() => null)
}

/**
 * The computed frame of the open text editor (outline style and width, box
 * shadow, top border width) and whether it has the focus; { error } when it
 * is gone.
 */
async function editorLook(page) {
	return editor(page).evaluate((el) => {
		const st = getComputedStyle(el)
		return { outlineStyle: st.outlineStyle, outlineWidth: st.outlineWidth, boxShadow: st.boxShadow, borderTopWidth: st.borderTopWidth, focused: document.activeElement === el }
	}).catch((e) => ({ error: String(e) }))
}

/** Waits for a new item of type `type` that is not in `before`; returns its id or null. */
async function newItemOf(page, before, type, timeout = 5000, extra = () => true) {
	return until(async () => {
		for (const [k, it] of await itemMap(page)) if (!before.has(k) && it.t === type && extra(it)) return k
		return null
	}, { timeout })
}

/** Ids of items whose data.text equals `text`. */
async function idsWithText(page, text) {
	const out = []
	for (const [k, it] of await itemMap(page)) if (it.data?.text === text) out.push(k)
	return out
}

// ── E21 ──────────────────────────────────────────────────────────────────

export const E21 = {
	id: 'E21',
	title: 'Formen und Transformer: Werkzeug S, Form aufziehen; Ecke br ziehen (handles()), Drehgriff 45°, Mehrfachauswahl gleichmäßig skalieren; je Strg+Z ein Schritt zurück; bob sieht jeden Endstand',
	async run(t, world) {
		const board = await world.board('E21 Formen')
		const token = await linkToken(board)
		const a = await world.actor('alice-formen', { user: 'alice' })
		const p = a.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(a, board)
		const b = await bobViaLink(world, 'bob-formen', token)

		t.step('Leinwand fokussieren (Klick), Taste S, Form aufziehen')
		const P = await worldAt(p, 0.25, 0.3)
		const s = P.scale
		const tol = 1 + 1 / s
		await clickWorld(p, P.x - 60, P.y - 60)
		t.check(await canvasFocused(p), '[S] ein Klick auf die Leinwand fokussiert .knorke-canvas (§6.3)', await p.evaluate(() => document.activeElement?.className))
		await p.keyboard.press('s')
		const pressed = await until(async () => (await toolPressed(p, 'shape')) === 'true', { timeout: 2000 })
		t.must(pressed, '[C] Taste S → [data-knorke-tool=shape] aria-pressed=true', await toolPressed(p, 'shape'))
		const W0 = 300
		const H0 = 200
		const before = await idSet(p)
		await dragPath(p, await K.w2s(p, P.x, P.y), await K.w2s(p, P.x + W0, P.y + H0), { steps: 10 })
		const A = await newItemOf(p, before, 'shape')
		t.must(A, '[S] Aufziehen legt eine Form an (t shape)')
		if (await editor(p).isVisible().catch(() => false)) {
			t.check((await editorKind(p)) === 'shape', '[S] nach dem Anlegen öffnet der Editor der Art shape (§6.3)', await editorKind(p))
			const look = await editorLook(p)
			t.check(look.outlineStyle === 'none' && look.boxShadow === 'none' && look.borderTopWidth === '0px' && look.focused === true,
				'[S] Form-Editor offen und fokussiert: kein Rahmen um das Textfeld (outline none, box-shadow none, border 0), nur der Cursor', look)
			// Windows contrast themes: the frameless editor shows its focus by an outline (WCAG 2.4.7)
			try {
				await p.emulateMedia({ forcedColors: 'active' })
				const hc = await editorLook(p)
				t.check(hc.outlineStyle === 'solid' && hc.outlineWidth === '2px' && hc.focused === true,
					'[S] erzwungene Farben (forced-colors: active, emuliert): Form-Editor fokussiert mit sichtbarer Outline (solid, 2px; WCAG 2.4.7)', hc)
			} finally {
				await p.emulateMedia({ forcedColors: null })
			}
			await p.keyboard.press('Escape')
		} else {
			t.check(false, '[S] nach dem Anlegen öffnet der Form-Editor (§6.3)')
		}
		await K.waitIdle(p)
		let it = (await itemMap(p)).get(A)
		t.check(near(it?.x, P.x, tol) && near(it?.y, P.y, tol) && near(it?.w, W0, tol) && near(it?.h, H0, tol) && it?.r === 0,
			`[S] Box = aufgezogenes Rechteck (${W0} × ${H0} bei ${P.x.toFixed(1)}, ${P.y.toFixed(1)}; ±${tol.toFixed(2)})`, fmt(it))
		t.check(SHAPE_KINDS.includes(it?.data?.kind ?? 'rect'), '[C] data.kind ist eine der sechs Arten (fehlt = rect)', it?.data)
		t.note(`neue Form: kind ${it?.data?.kind ?? '(fehlt = rect)'}, ${fmt(it)}, Skala ${s.toFixed(3)}`)

		t.step('Auswahl und Griffe; Ecke br um (+80, +40) px ziehen')
		await tool(p, 'select')
		await selectItem(p, A)
		const sel = await K.selection(p)
		t.check(Array.isArray(sel) && sameList(sel, [A]), '[C] __knorke.selection() = [A]', sel)
		const hs = await K.handles(p)
		t.must(Array.isArray(hs) && hs.length > 0, '[S] __knorke.handles() liefert Griffe', hs)
		t.check(sameList(transformNames(hs), ['b', 'bl', 'br', 'l', 'r', 'rot', 't', 'tl', 'tr']), '[S] eine Form: 8 Griffe + Drehgriff', hs.map((h) => h.name))
		t.check(sameList(plusNames(hs), ALL_PLUS), '[S] eine Form (bindbar): dazu die vier „+“-Griffe plus-t/r/b/l (§6.3, Namen §6.7)', hs.map((h) => h.name))
		const box0 = boxOf((await itemMap(p)).get(A))
		const br = await handleOf(p, 'br')
		const DX = 80
		const DY = 40
		await dragPath(p, br, { x: br.x + DX, y: br.y + DY })
		await K.waitIdle(p)
		const boxR = boxOf((await itemMap(p)).get(A))
		t.check(near(boxR?.w, box0.w + DX / s, tol) && near(boxR?.h, box0.h + DY / s, tol) && near(boxR?.x, box0.x, tol) && near(boxR?.y, box0.y, tol),
			'[S] Ecke br: w + 80/scale, h + 40/scale (Ecken frei bei Formen), x/y fest', { vorher: fmt(box0), nachher: fmt(boxR) })

		t.step('Drehgriff um 45° im Uhrzeigersinn')
		const rot = await handleOf(p, 'rot')
		t.must(rot, '[S] Drehgriff rot vorhanden')
		const c = await K.w2s(p, boxR.x + boxR.w / 2, boxR.y + boxR.h / 2)
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
		const boxRot = boxOf((await itemMap(p)).get(A))
		t.check(near(boxRot?.r, 45, 1), '[S] r = 45 (±1; Rastung 45°)', boxRot?.r)
		t.check(near(boxRot?.w, boxR.w, 0.01) && near(boxRot?.h, boxR.h, 0.01) && near(boxRot?.x, boxR.x, tol) && near(boxRot?.y, boxR.y, tol), '[S] Drehen um die Mitte ändert Box und Lage nicht', { vorher: fmt(boxR), nachher: fmt(boxRot) })
		await settle([p, b.page])
		t.check(sameBox(boxOf((await itemMap(b.page)).get(A)), boxRot), '[C] bob sieht die gedrehte Form', fmt(boxOf((await itemMap(b.page)).get(A))))

		t.step('Strg+Z: Drehung in einem Schritt zurück')
		await p.keyboard.press('Control+z')
		await K.waitIdle(p)
		const boxU = boxOf((await itemMap(p)).get(A))
		t.check(sameBox(boxU, boxR), '[C] ein Strg+Z: r 0, Box wie nach der Größenänderung', { erwartet: fmt(boxR), ist: fmt(boxU) })

		t.step('zweite Form, Umschalt+Klick, Mehrfachauswahl gleichmäßig um 1,25 skalieren')
		const B = ulid()
		const res = await seedOps('alice', board, [put.shape(B, { x: boxR.x + boxR.w + 100, y: boxR.y, w: 200, h: 150, data: { kind: 'ellipse', text: 'B' } })])
		t.must(res[0] === 'ok', '[B] zweite Form angelegt', res)
		t.must(await until(async () => (await itemMap(p)).has(B), { timeout: 8000 }), '[C] alice sieht die zweite Form')
		await selectItem(p, A)
		const cb = await centerOf(p, B)
		await p.keyboard.down('Shift')
		await p.mouse.click(cb.x, cb.y)
		await p.keyboard.up('Shift')
		const sel2 = await K.selection(p)
		t.check(Array.isArray(sel2) && sel2.length === 2 && sel2.includes(A) && sel2.includes(B), '[S] Umschalt+Klick: Auswahl [A, B]', sel2)
		const hs2 = await K.handles(p)
		t.check(Array.isArray(hs2) && sameList(transformNames(hs2), ['bl', 'br', 'tl', 'tr']), '[S] Mehrfachauswahl: 4 Ecken, kein Drehgriff (R2)', hs2?.map((h) => h.name))
		t.check(Array.isArray(hs2) && plusNames(hs2).length === 0 && extraHandles(hs2).length === 0, '[S] Mehrfachauswahl: keine „+“-Griffe (nur bei genau einem Objekt, §6.3) und keine Endgriffe', hs2?.map((h) => h.name))
		const m0 = await itemMap(p)
		const a1 = boxOf(m0.get(A))
		const b1 = boxOf(m0.get(B))
		const fx = Math.min(a1.x, b1.x)
		const fy = Math.min(a1.y, b1.y)
		const fx2 = Math.max(a1.x + a1.w, b1.x + b1.w)
		const fy2 = Math.max(a1.y + a1.h, b1.y + b1.h)
		const k = 1.25
		const br2 = await handleOf(p, 'br')
		t.must(br2, '[S] Griff br der Mehrfachauswahl')
		await dragPath(p, br2, { x: br2.x + (fx2 - fx) * (k - 1) * s, y: br2.y + (fy2 - fy) * (k - 1) * s }, { steps: 14 })
		await K.waitIdle(p)
		const m1 = await itemMap(p)
		for (const [id, o, label] of [[A, a1, 'A'], [B, b1, 'B']]) {
			const n = boxOf(m1.get(id))
			const want = { x: fx + (o.x - fx) * k, y: fy + (o.y - fy) * k, w: o.w * k, h: o.h * k, r: o.r }
			t.check(sameBox(n, want, 2 * tol), `[S] ${label}: gleichmäßig × ${k} um die Ecke tl der Auswahl (±${(2 * tol).toFixed(2)})`, { erwartet: fmt(want), ist: fmt(n) })
		}
		await settle([p, b.page])
		const bm = await itemMap(b.page)
		t.check(sameBox(boxOf(bm.get(A)), boxOf(m1.get(A))) && sameBox(boxOf(bm.get(B)), boxOf(m1.get(B))), '[C] bob sieht das Endergebnis der Skalierung', { bobA: fmt(boxOf(bm.get(A))), bobB: fmt(boxOf(bm.get(B))) })

		t.step('Strg+Z: Skalierung in einem Schritt zurück')
		await p.keyboard.press('Control+z')
		await K.waitIdle(p)
		const m2 = await itemMap(p)
		t.check(sameBox(boxOf(m2.get(A)), a1) && sameBox(boxOf(m2.get(B)), b1), '[C] ein Strg+Z stellt beide Boxen her (ein Undo-Schritt)', { A: fmt(boxOf(m2.get(A))), B: fmt(boxOf(m2.get(B))) })
		await settle([p, b.page])
		const bm2 = await itemMap(b.page)
		t.check(sameBox(boxOf(bm2.get(A)), a1) && sameBox(boxOf(bm2.get(B)), b1), '[C] bob sieht den Ausgangszustand wieder')
		await world.drop(b)
		await world.drop(a)
	},
}

// ── E22 ──────────────────────────────────────────────────────────────────

export const E22 = {
	id: 'E22',
	title: 'Text-Objekt: T + Klick, drei Zeilen (h wächst), Seitengriff schmaler (mehr Zeilen, größeres h), Eckgriff größer (fontSize × k), leerer Text verschwindet; Serien-Eingabe: Notiz, Tab, Tab, Esc → drei Notizen nebeneinander, drei Undo-Schritte',
	async run(t, world) {
		const board = await world.board('E22 Text')
		const a = await world.actor('alice-text', { user: 'alice' })
		const p = a.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(a, board)
		const P = await worldAt(p, 0.15, 0.2)
		const s = P.scale
		const tol = 1 + 1 / s

		t.step('Taste T, Klick legt ein Text-Objekt an und öffnet den Editor')
		await clickWorld(p, P.x - 40, P.y - 40)
		await p.keyboard.press('t')
		t.must(await until(async () => (await toolPressed(p, 'text')) === 'true', { timeout: 2000 }), '[C] Taste T → [data-knorke-tool=text] aria-pressed=true', await toolPressed(p, 'text'))
		const before = await idSet(p)
		await clickWorld(p, P.x, P.y)
		const vis = await editor(p).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
		t.must(vis, '[S] Klick mit T öffnet den Editor')
		t.check((await editorKind(p)) === 'text', '[S] data-knorke-editor-kind=text', await editorKind(p))
		const lookT = await editorLook(p)
		t.check(lookT.outlineStyle === 'none' && lookT.boxShadow === 'none' && lookT.borderTopWidth === '0px' && lookT.focused === true,
			'[S] Text-Editor offen und fokussiert: kein Rahmen um das Textfeld (outline none, box-shadow none, border 0), nur der Cursor', lookT)
		const LINE1 = 'eins zwei drei vier fünf sechs'
		await p.keyboard.type(LINE1, { delay: 5 })
		await p.keyboard.press('Escape')
		const T = await newItemOf(p, before, 'text', 6000, (x) => x.data?.text === LINE1)
		t.must(T, '[C] Text-Objekt mit dem getippten Text angelegt')
		await K.waitIdle(p)
		const t1 = (await itemMap(p)).get(T)
		const fs1 = t1.style?.fontSize ?? 24
		t.note(`Text-Objekt: w ${t1.w}, h ${t1.h}, fontSize ${t1.style?.fontSize}`)

		t.step('zwei weitere Zeilen')
		const ct = await centerOf(p, T)
		await p.mouse.dblclick(ct.x, ct.y)
		t.must(await editor(p).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[S] Doppelklick öffnet den Editor')
		await p.keyboard.press('Control+End')
		await p.keyboard.type('\nZeile zwei\nZeile drei', { delay: 5 })
		await p.keyboard.press('Escape')
		await K.waitIdle(p)
		const t3 = (await itemMap(p)).get(T)
		t.check(t3?.data?.text === `${LINE1}\nZeile zwei\nZeile drei`, '[S] drei Zeilen gespeichert', t3?.data?.text)
		t.check(t3?.h > t1.h + fs1, '[C] h wächst mit dem Text (gemessen beim Schreiben, Regel 13)', { vorher: t1.h, nachher: t3?.h })

		t.step('Seitengriff r: Umbruchbreite etwa halbieren')
		await tool(p, 'select')
		await selectItem(p, T)
		const hsT = await K.handles(p)
		const names = transformNames(hsT)
		t.check(sameList(names, ['bl', 'br', 'l', 'r', 'rot', 'tl', 'tr']), '[S] Text: Seitengriffe l/r, 4 Ecken, Drehgriff (§6.3)', hsT?.map((h) => h.name))
		t.check(sameList(plusNames(hsT), ALL_PLUS), '[S] Text (bindbar): dazu die vier „+“-Griffe plus-t/r/b/l (Runde 1b, Namen §6.7)', hsT?.map((h) => h.name))
		const hr = await handleOf(p, 'r')
		t.must(hr, '[S] Griff r vorhanden')
		await dragPath(p, hr, { x: hr.x - t3.w * 0.5 * s, y: hr.y })
		await K.waitIdle(p)
		const t4 = (await itemMap(p)).get(T)
		t.check(near(t4?.w, t3.w * 0.5, tol) && t4?.x === t3.x, '[S] Seitengriff: w halbiert, x fest', { vorher: t3.w, nachher: t4?.w })
		t.check((t4?.style?.fontSize ?? 24) === fs1, '[S] Seitengriff ändert die Schriftgröße nicht', t4?.style)
		t.check(t4?.h > t3.h, '[C] schmaler → mehr Zeilen → größeres h', { vorher: t3.h, nachher: t4?.h })

		t.step('Eckgriff br: × 1,5 entlang der Diagonale')
		const hb = await handleOf(p, 'br')
		t.must(hb, '[S] Griff br vorhanden')
		await dragPath(p, hb, { x: hb.x + t4.w * 0.5 * s, y: hb.y + t4.h * 0.5 * s }, { steps: 14 })
		await K.waitIdle(p)
		const t5 = (await itemMap(p)).get(T)
		t.check(near(t5?.style?.fontSize, Math.round(fs1 * 1.5), 1), `[S] Eckgriff: fontSize × 1,5 = ${Math.round(fs1 * 1.5)} (±1)`, t5?.style)
		t.check(near(t5?.w, t4.w * 1.5, 2 * tol), '[S] Eckgriff: Breite × 1,5', { vorher: t4.w, nachher: t5?.w })
		t.check(t5?.h > t4.h, '[C] h neu gemessen (größer)', { vorher: t4.h, nachher: t5?.h })

		t.step('leerer Text verschwindet beim Schließen')
		const ids0 = await idSet(p)
		const E = await worldAt(p, 0.7, 0.2)
		await clickWorld(p, E.x, E.y)
		await p.keyboard.press('t')
		await clickWorld(p, E.x + 40, E.y + 40)
		const opened = await editor(p).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
		t.check(opened, '[S] Editor eines neuen Text-Objekts offen')
		await p.keyboard.press('Escape')
		await K.waitIdle(p)
		await sleep(500)
		const ids1 = await idSet(p)
		const extra = [...ids1].filter((id) => !ids0.has(id))
		// [C]: the session deletes a new text item that is still empty when its editor closes, also
		// without a final text intent (§6.5.2, R9); the server check after it is [B]
		t.check(extra.length === 0, '[C] leerer neuer Text → Objekt weg (lokal)', extra)
		const srv = await serverMap('alice', board)
		t.check([...srv.values()].filter((x) => x.t === 'text').length === 1, '[B] beim Server nur das eine Text-Objekt', [...srv.values()].map((x) => [x.t, x.data?.text]))

		t.step('Serien-Eingabe: Notiz, tippen, Tab, tippen, Tab, tippen, Esc')
		const Q = await worldAt(p, 0.15, 0.7)
		await tool(p, 'sticky')
		await clickWorld(p, Q.x, Q.y)
		t.must(await editor(p).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[S] Notiz-Editor offen')
		t.check((await editorKind(p)) === 'note', '[S] data-knorke-editor-kind=note', await editorKind(p))
		const lookN = await editorLook(p)
		t.check(lookN.outlineStyle === 'none' && lookN.boxShadow === 'none' && lookN.borderTopWidth === '0px' && lookN.focused === true,
			'[S] Notiz-Editor offen und fokussiert: kein Rahmen um das Textfeld (outline none, box-shadow none, border 0), nur der Cursor', lookN)
		const texts = ['Serie eins', 'Serie zwei', 'Serie drei']
		for (let i = 0; i < texts.length; i++) {
			await p.keyboard.type(texts[i], { delay: 5 })
			if (i < texts.length - 1) {
				await p.keyboard.press('Tab')
				// the next note's editor opens (pendingOpen until the model has it)
				const next = await until(async () => {
					if ((await idsWithText(p, texts[i])).length !== 1) return null
					const v = await editor(p).inputValue().catch(() => null)
					const focused = await p.evaluate(() => document.activeElement?.hasAttribute?.('data-knorke-editor') === true)
					return v === '' && focused ? true : null
				}, { timeout: 6000 })
				t.check(next, `[C] Tab nach „${texts[i]}“: gespeichert, nächster Notiz-Editor offen und fokussiert`)
			}
		}
		await p.keyboard.press('Escape')
		await K.waitIdle(p)
		const m = await itemMap(p)
		const notes = texts.map((x) => [...m.entries()].find(([, it]) => it.t === 'sticky' && it.data?.text === x)?.[1] ?? null)
		t.check(notes.every(Boolean), '[C] drei Notizen mit den Texten', notes.map((n) => n?.data?.text))
		if (notes.every(Boolean)) {
			const [n1, n2, n3] = notes
			t.check(near(n2.x, n1.x + n1.w + 20, tol) && near(n2.y, n1.y, tol) && near(n3.x, n2.x + n2.w + 20, tol) && near(n3.y, n2.y, tol),
				'[C] nebeneinander: x + w + 20, gleiches y (§6.5.1)', notes.map((n) => [n.x, n.y, n.w]))
			t.check(n2.style?.fill === n1.style?.fill && n3.style?.fill === n1.style?.fill && n2.w === n1.w && n3.h === n1.h, '[C] Farbe und Größe der vorigen Notiz', notes.map((n) => [n.style?.fill, n.w, n.h]))
		}
		t.step('drei Undo-Schritte')
		for (let i = texts.length - 1; i >= 0; i--) {
			await p.keyboard.press('Control+z')
			const ok = await until(async () => {
				const mm = await itemMap(p)
				const left = texts.filter((x) => [...mm.values()].some((it) => it.t === 'sticky' && it.data?.text === x))
				return sameList(left, texts.slice(0, i)) ? true : null
			}, { timeout: 4000 })
			t.check(ok, `[C] Strg+Z Nr. ${texts.length - i}: „${texts[i]}“ weg, ${i} Notiz(en) bleiben`)
		}
		await world.drop(a)
	},
}

// ── E23 ──────────────────────────────────────────────────────────────────

/** A free connector end {x, y} (stored form, §3.10). */
const isFreeEnd = (v) => !!v && typeof v === 'object' && 'x' in v && 'y' in v && !('item' in v)
const ptFmt = (pt) => (pt ? `(${Number(pt.x).toFixed(1)}, ${Number(pt.y).toFixed(1)})` : 'null')
const routeFmt = (g) => (g ? { start: ptFmt(g.start), end: ptFmt(g.end), kind: g.kind } : null)

/** The element at a client point (diagnostics of a pointer step that did not reach the canvas). */
const elementAt = (page, pt) => (pt ? page.evaluate(([x, y]) => {
	const el = document.elementFromPoint(x, y)
	if (!el) return null
	const cls = typeof el.className === 'string' ? el.className : ''
	return `${el.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : ''}${el.closest('.knorke-canvas') ? ' (in .knorke-canvas)' : ''}`
}, [pt.x, pt.y]).catch(() => null) : null)

/**
 * Selects connector `id` with the select tool by clicking its route at a
 * quarter of the way from the start (the label sits at the middle), then at
 * three quarters. @return {Promise<boolean>} selection() = [id]
 */
async function selectConnector(page, id) {
	for (const f of [0.25, 0.75]) {
		const g = await K.connector(page, id)
		if (!g) return false
		await clickWorld(page, g.start.x + (g.end.x - g.start.x) * f, g.start.y + (g.end.y - g.start.y) * f)
		if (sameList((await K.selection(page)) || [], [id])) return true
	}
	return false
}

/** Number of open sections of the context bar (their panel hangs over the canvas). */
const openSections = (page) => page.locator('.knorke-contextbar [data-knorke-section][aria-expanded="true"]').count().catch(() => 0)

/**
 * A client point on the straight route of connector `id` where the canvas
 * itself is hit (document.elementFromPoint lies inside .knorke-canvas, not in
 * a bar or the open panel), away from the middle (label) and the ends
 * (handles); null when every candidate is covered.
 */
async function canvasPointOnLine(page, id) {
	for (const f of [0.25, 0.75, 0.15, 0.85, 0.35, 0.65]) {
		const g = await K.connector(page, id)
		if (!g) return null
		const pt = await K.w2s(page, g.start.x + (g.end.x - g.start.x) * f, g.start.y + (g.end.y - g.start.y) * f)
		const inCanvas = await page.evaluate(([x, y]) => {
			const el = document.elementFromPoint(x, y)
			return !!el && !!el.closest('.knorke-canvas')
		}, [pt.x, pt.y]).catch(() => false)
		if (inCanvas) return { ...pt, f }
	}
	return null
}

/**
 * C-1b-02 (§6.6, R11): an open panel of the context bar closes on a
 * pointerdown on the canvas. The press goes onto the SELECTED connector's
 * line (a free canvas point of it), so the selection and the bar stay and only
 * the dismissal rule can close the panel; a press on empty canvas would
 * deselect and unmount the bar, which proves nothing. The pause afterwards
 * keeps the press apart from the double click of the next step.
 */
async function checkPanelDismiss(t, page, id) {
	const open = await openSections(page)
	if (open === 0) {
		t.note('C-1b-02: nach der Stilwahl ist kein Kontextleisten-Feld offen – Prüfung ohne Aussage')
		return
	}
	const pt = await canvasPointOnLine(page, id)
	if (!pt) {
		t.note('C-1b-02: kein freier Leinwandpunkt auf der Linie (alles verdeckt) – Prüfung ausgelassen')
		return
	}
	await page.mouse.click(pt.x, pt.y)
	const sel = await until(async () => {
		const s = await K.selection(page)
		return sameList(s || [], [id]) ? s : null
	}, { timeout: 1500 })
	t.check(!!sel, '[S] ein Klick auf die Linie des ausgewählten Verbinders lässt ihn ausgewählt', await K.selection(page))
	if (sel) {
		// one owner per red check (§9.6): without the selection the bar is gone and this check would say nothing
		const shut = await until(async () => (await openSections(page)) === 0, { timeout: 2000 })
		t.check(shut === true, '[C] pointerdown auf der Leinwand schließt das offene Kontextleisten-Feld, die Leiste bleibt (C-1b-02, §6.6 R11)', {
			offenVorher: open, offenDanach: await openSections(page), punkt: pt,
			leiste: await page.locator('.knorke-contextbar').first().isVisible().catch(() => false),
		})
	} else {
		t.note('C-1b-02: Auswahl nach dem Klick verloren – Schließ-Prüfung ohne Aussage')
	}
	await sleep(600)
}

/**
 * R11 (§8.4 E23, §6.7): a selected connector shows exactly the handles
 * 'start' and 'end' – no transformer handle, no "+" handle – and each sits at
 * its end of the route (≤ 12 px, client coordinates).
 */
async function checkEndHandles(t, page, id, when) {
	const hs = await K.handles(page)
	const names = Array.isArray(hs) ? hs.map((h) => h.name).sort() : null
	t.check(sameList(names, [...END_HANDLES].sort()), `[S] ${when}: genau die Griffe start und end, keine Transformer- und keine „+“-Griffe (§6.7, R11)`, names)
	const g = await K.connector(page, id)
	const at = g ? { start: await K.w2s(page, g.start.x, g.start.y), end: await K.w2s(page, g.end.x, g.end.y) } : null
	const off = Object.fromEntries(END_HANDLES.map((n) => {
		const h = Array.isArray(hs) ? hs.find((x) => x.name === n) : null
		return [n, h && at ? Math.round(Math.hypot(h.x - at[n].x, h.y - at[n].y) * 10) / 10 : null]
	}))
	t.check(END_HANDLES.every((n) => off[n] !== null && off[n] <= 12), `[S] ${when}: Griff start am Anfang, Griff end am Ende der Route (≤ 12 px)`, { abstand: off, route: routeFmt(g) })
}

export const E23 = {
	id: 'E23',
	title: 'Verbinder: Taste L, von A nach B ziehen; A verschieben (folgt live bei alice und bob); B löschen (freies Ende an der letzten Andockstelle ±2); Strg+Z bindet wieder; Route „elbow“, Endspitze und Strich über die Kontextleiste; Beschriftung per Doppelklick; Ende auf C umhängen, Strg+Z; „+“-Griff von A nach C',
	async run(t, world) {
		const board = await world.board('E23 Verbinder')
		const token = await linkToken(board)
		const a = await world.actor('alice-verbinder', { user: 'alice' })
		const p = a.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(a, board)
		// A and B on one line (the route between them stays horizontal, also as elbow), C below B
		const P = await worldAt(p, 0.1, 0.18)
		const Q = await worldAt(p, 0.55, 0.18)
		const R = await worldAt(p, 0.55, 0.6)
		const s = P.scale
		const tol = 2 + 1 / s
		const [A, B, C] = [ulid(), ulid(), ulid()]
		const y0 = Math.round(P.y)
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: Math.round(P.x), y: y0, w: 160, h: 160, data: { text: 'A' } }),
			put.sticky(B, { x: Math.round(Q.x), y: y0, w: 160, h: 160, data: { text: 'B' } }),
			put.sticky(C, { x: Math.round(R.x), y: Math.round(R.y), w: 160, h: 160, data: { text: 'C' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Notizen A, B, C angelegt', res)
		t.must(await until(async () => { const m = await itemMap(p); return m.has(A) && m.has(B) && m.has(C) }, { timeout: 8000 }), '[C] alice sieht A, B, C')
		const b = await bobViaLink(world, 'bob-verbinder', token)
		t.must(await until(async () => (await itemMap(b.page)).has(C), { timeout: 8000 }), '[C] bob sieht A, B, C')
		const boxIn = async (page, id) => boxOf((await itemMap(page)).get(id))
		t.note(`A ${fmt(await boxIn(p, A))}; B ${fmt(await boxIn(p, B))}; C ${fmt(await boxIn(p, C))}; Skala ${s.toFixed(3)}`)

		t.step('Leinwand fokussieren (Klick ins Leere), Taste L, von A nach B ziehen')
		const E = await worldAt(p, 0.32, 0.85)
		await clickWorld(p, E.x, E.y)
		t.check(await canvasFocused(p), '[S] ein Klick ins Leere fokussiert die Leinwand', await p.evaluate(() => document.activeElement?.className))
		await p.keyboard.press('l')
		t.must(await until(async () => (await toolPressed(p, 'connector')) === 'true', { timeout: 2000 }), '[C] Taste L → [data-knorke-tool=connector] aria-pressed=true (das Werkzeug ist ab Runde 1b sichtbar)', await toolPressed(p, 'connector'))
		const before = await idSet(p)
		await dragPath(p, await centerOf(p, A), await centerOf(p, B), { steps: 16 })
		const KC = await newItemOf(p, before, 'connector', 6000)
		t.must(KC, '[S] Ziehen mit L von A nach B legt einen Verbinder an')
		await K.waitIdle(p)
		let it = (await itemMap(p)).get(KC)
		t.check(it?.data?.start?.item === A && it?.data?.end?.item === B, '[S] Enden gebunden: start an A, end an B', it?.data)
		t.check(it && it.x === 0 && it.y === 0 && it.w === 0 && it.h === 0 && it.r === 0 && it.parent === null, '[C] Lage none: x = y = w = h = r = 0, parent null (Regel 12)', it && fmt(boxOf(it)))
		t.check(it?.data?.route === 'straight' && it?.style?.endCap === 'arrow', '[C] Anlege-Vorgaben gespeichert: Route straight, Endspitze arrow (§6.2)', { route: it?.data?.route, style: it?.style })
		const g0 = await K.connector(p, KC)
		t.must(g0?.start && g0?.end, '[S] __knorke.connector(id) liefert die Route (start, end)', g0)
		t.check(onBorder(g0.start, await boxIn(p, A), 2) && onBorder(g0.end, await boxIn(p, B), 2), '[S] die Route beginnt am Rand von A und endet am Rand von B (±2)', routeFmt(g0))
		const srv0 = (await serverMap('alice', board)).get(KC)
		t.check(srv0?.data?.start?.item === A && srv0?.data?.end?.item === B, '[B] beim Server: Verbinder mit beiden Enden gebunden', srv0?.data)
		await settle([p, b.page])
		const gb0 = await K.connector(b.page, KC)
		t.check(gb0 && nearPt(gb0.start, g0.start, 2) && nearPt(gb0.end, g0.end, 2), '[C] bob sieht den Verbinder mit derselben Route (±2)', { alice: routeFmt(g0), bob: routeFmt(gb0) })
		await tool(p, 'select')

		t.step('A nach rechts ziehen und halten: der Verbinder folgt live bei alice und bob; loslassen')
		const a0 = await boxIn(p, A)
		const DX = 150
		const c = await centerOf(p, A)
		await p.mouse.move(c.x, c.y)
		await p.mouse.down()
		for (let i = 1; i <= 12; i++) {
			await p.mouse.move(c.x + (DX * s * i) / 12, c.y)
			await sleep(16)
		}
		await sleep(200)
		const gl = await K.connector(p, KC)
		t.check(gl && near(gl.start.x - g0.start.x, DX, tol) && near(gl.start.y, g0.start.y, tol) && nearPt(gl.end, g0.end, 2),
			'[S] live lokal: während des Ziehens folgt der Anfang (Δx ≈ 150), das Ende bleibt an B', { vorher: routeFmt(g0), jetzt: routeFmt(gl) })
		const live = await until(async () => {
			const g = await K.connector(b.page, KC)
			return g && near(g.start.x - g0.start.x, DX, tol) && near(g.start.y, g0.start.y, tol) ? g : null
		}, { timeout: 6000 })
		t.check(live, '[S] live fremd: bob sieht den Verbinder während alices Ziehen folgen (Vorschau-Box, setBoxResolver)', routeFmt(await K.connector(b.page, KC)))
		await p.mouse.up()
		await K.waitIdle(p)
		const a1 = await boxIn(p, A)
		const dA = { x: a1.x - a0.x, y: a1.y - a0.y }
		t.check(near(dA.x, DX, tol) && near(dA.y, 0, tol), '[S] A um (150, 0) verschoben', dA)
		const g1 = await K.connector(p, KC)
		t.check(g1 && nearPt(g1.start, { x: g0.start.x + dA.x, y: g0.start.y + dA.y }, 2) && nearPt(g1.end, g0.end, 2), '[S] nach dem Loslassen: Anfang um die Verschiebung von A versetzt, Ende unverändert (±2)', { vorher: routeFmt(g0), nachher: routeFmt(g1), dA })
		it = (await itemMap(p)).get(KC)
		t.check(it?.data?.start?.item === A && it?.data?.end?.item === B, '[C] das Verschieben ändert die gebundenen Enden nicht (moveItems v2)', it?.data)
		await settle([p, b.page])
		const gb1 = await K.connector(b.page, KC)
		t.check(gb1 && nearPt(gb1.start, g1.start, 2) && nearPt(gb1.end, g1.end, 2), '[C] bob: der Verbinder folgt A (Endstand ±2)', { alice: routeFmt(g1), bob: routeFmt(gb1) })

		t.step('B löschen: das Ende wird an der letzten Andockstelle frei (±2)')
		const dock = g1 ? g1.end : null
		await selectItem(p, B)
		t.check(sameList((await K.selection(p)) || [], [B]), '[S] Klick wählt B', await K.selection(p))
		await p.keyboard.press('Delete')
		t.must(await until(async () => !(await itemMap(p)).has(B), { timeout: 4000 }), '[S] Entf löscht B (Leinwand-Fokus)')
		await K.waitIdle(p)
		it = (await itemMap(p)).get(KC)
		t.check(it && isFreeEnd(it.data?.end) && nearPt(it.data.end, dock, 2), '[C] data.end ist ein freier Punkt an der letzten Andockstelle (±2; deleteItems v2 löst vor dem remove)', { end: it?.data?.end, andockstelle: dock })
		t.check(it?.data?.start?.item === A, '[C] der Anfang bleibt an A', it?.data?.start)
		const g2 = await K.connector(p, KC)
		t.check(g2 && nearPt(g2.end, dock, 2), '[S] die Route endet am freien Punkt (±2)', routeFmt(g2))
		const srv2 = await serverMap('alice', board)
		t.check(!srv2.has(B) && isFreeEnd(srv2.get(KC)?.data?.end) && nearPt(srv2.get(KC).data.end, it?.data?.end, 0.005), '[B] beim Server: B gelöscht, das freie Ende wie gesendet', srv2.get(KC)?.data)
		await settle([p, b.page])
		const bm2 = await itemMap(b.page)
		t.check(!bm2.has(B) && isFreeEnd(bm2.get(KC)?.data?.end) && nearPt(bm2.get(KC).data.end, dock, 2), '[C] bob: B weg, freies Ende an der Andockstelle', bm2.get(KC)?.data?.end)

		t.step('Strg+Z: B kommt zurück, das Ende hängt wieder an B')
		await p.keyboard.press('Control+z')
		const back = await until(async () => { const m = await itemMap(p); return m.has(B) && m.get(KC)?.data?.end?.item === B ? true : null }, { timeout: 5000 })
		t.check(back, '[C] ein Strg+Z: B ist wieder da und data.end bindet an B', (await itemMap(p)).get(KC)?.data?.end)
		await K.waitIdle(p)
		const g3 = await K.connector(p, KC)
		t.check(g3 && nearPt(g3.end, dock, 2), '[S] die Route endet wieder am Rand von B (±2)', routeFmt(g3))
		await settle([p, b.page])
		const bm3 = await itemMap(b.page)
		t.check(bm3.has(B) && bm3.get(KC)?.data?.end?.item === B, '[C] bob: B wieder da, das Ende gebunden', bm3.get(KC)?.data?.end)
		const srv3 = await serverMap('alice', board)
		t.check(srv3.has(B) && srv3.get(KC)?.data?.end?.item === B, '[B] beim Server: B belebt, das Ende gebunden', srv3.get(KC)?.data?.end)

		t.step('Verbinder auswählen (Klick auf die Linie), Route „elbow“, Endspitze „dot“ und Strich „dashed“ in der Kontextleiste')
		t.must(await selectConnector(p, KC), '[S] ein Klick auf die Linie wählt den Verbinder (Treffer line)', await K.selection(p))
		await checkEndHandles(t, p, KC, 'ausgewählter Verbinder')
		t.check(await styleButton(p, 'data.route', 'elbow'), '[C] Kontextleiste: [data-knorke-style=data.route][data-knorke-value=elbow] (Route, §6.8)')
		t.check(await until(async () => (await itemMap(p)).get(KC)?.data?.route === 'elbow', { timeout: 4000 }), '[C] data.route = elbow', (await itemMap(p)).get(KC)?.data?.route)
		t.check(await styleButton(p, 'style.endCap', 'dot'), '[C] Kontextleiste: [data-knorke-style=style.endCap][data-knorke-value=dot] (Spitzen, §6.8)')
		t.check(await until(async () => (await itemMap(p)).get(KC)?.style?.endCap === 'dot', { timeout: 4000 }), '[C] style.endCap = dot', (await itemMap(p)).get(KC)?.style)
		t.check(await styleButton(p, 'style.dash', 'dashed'), '[C] Kontextleiste: [data-knorke-style=style.dash][data-knorke-value=dashed] (Strich, §6.8)')
		t.check(await until(async () => (await itemMap(p)).get(KC)?.style?.dash === 'dashed', { timeout: 4000 }), '[C] style.dash = dashed', (await itemMap(p)).get(KC)?.style)
		await K.waitIdle(p)
		const g4 = await K.connector(p, KC)
		t.check(g4 && onBorder(g4.start, await boxIn(p, A), 2) && onBorder(g4.end, await boxIn(p, B), 2), '[S] die rechtwinklige Route beginnt und endet weiter an den Rändern von A und B (±2)', routeFmt(g4))

		t.step('Offenes Kontextleisten-Feld: ein Druck auf die Leinwand schließt es (C-1b-02, §6.6 R11)')
		await checkPanelDismiss(t, p, KC)

		t.step('Beschriftung per Doppelklick auf die Linie')
		// fallback: a panel still open lies over the canvas – close it like a user before going back to the line
		const closed = await closeContextPanels(p)
		if (closed) t.note(`Kontextleiste: ${closed} offene(s) Feld(er) vor dem Doppelklick geschlossen`)
		// A and B on one line: the elbow route is horizontal, its middle (where the label goes) lies on it
		const mid = g4 ? await K.w2s(p, (g4.start.x + g4.end.x) / 2, (g4.start.y + g4.end.y) / 2) : null
		const atMid = await elementAt(p, mid)
		if (mid) await p.mouse.dblclick(mid.x, mid.y)
		const opened = await editor(p).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
		t.check(opened, '[S] ein Doppelklick auf den Verbinder öffnet den Beschriftungs-Editor', opened ? undefined : {
			klick: mid, element: atMid, welt: g4 && { x: (g4.start.x + g4.end.x) / 2, y: (g4.start.y + g4.end.y) / 2 }, auswahl: await K.selection(p),
			fokus: await p.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className),
			editoren: await p.evaluate(() => document.querySelectorAll('textarea[data-knorke-editor]').length),
		})
		if (opened) {
			t.check((await editorKind(p)) === 'label', '[S] data-knorke-editor-kind=label', await editorKind(p))
			await p.keyboard.type('ja', { delay: 5 })
			await p.keyboard.press('Escape')
			t.check(await until(async () => (await itemMap(p)).get(KC)?.data?.label === 'ja', { timeout: 4000 }), '[C] data.label = „ja“', (await itemMap(p)).get(KC)?.data)
		}
		await K.waitIdle(p)
		await settle([p, b.page])
		const bk = (await itemMap(b.page)).get(KC)
		t.check(bk?.data?.route === 'elbow' && bk?.data?.label === 'ja' && bk?.style?.endCap === 'dot' && bk?.style?.dash === 'dashed', '[C] bob sieht Route, Endspitze, Strich und Beschriftung', { data: bk?.data, style: bk?.style })
		const sk = (await serverMap('alice', board)).get(KC)
		t.check(sk?.data?.route === 'elbow' && sk?.data?.label === 'ja' && sk?.style?.endCap === 'dot' && sk?.style?.dash === 'dashed', '[B] beim Server: Route, Endspitze, Strich, Beschriftung', { data: sk?.data, style: sk?.style })

		t.step('Ende umhängen: den Endgriff von B auf C ziehen; Strg+Z')
		t.must(await selectConnector(p, KC), '[S] Verbinder wieder ausgewählt', await K.selection(p))
		const gh = await K.connector(p, KC)
		const endAt = gh ? await K.w2s(p, gh.end.x, gh.end.y) : { x: NaN, y: NaN }
		// by the frozen name (§6.7, R11); the pick by position stays as the fallback
		const hsR = await K.handles(p)
		const eh = pickHandle(hsR, 'end', endAt)
		if (eh?.by === 'position') t.note(`Endgriff „end“ fehlt in __knorke.handles() (${(hsR || []).map((h) => h.name).join(', ')}): Rückfall auf die Wahl nach Lage (${eh.name})`)
		t.must(eh && eh.dist <= 12, '[S] ausgewählter Verbinder: Endgriff end an seinem Ende (__knorke.handles(), ≤ 12 px)', { griffe: hsR, ende: endAt, wahl: eh?.by })
		// the drag by hand: the route's end must follow the pointer while the button is down (preview)
		const cC = await centerOf(p, C)
		const atHandle = await elementAt(p, eh)
		await p.mouse.move(eh.x, eh.y)
		await p.mouse.down()
		for (let i = 1; i <= 14; i++) {
			await p.mouse.move(eh.x + ((cC.x - eh.x) * i) / 14, eh.y + ((cC.y - eh.y) * i) / 14)
			await sleep(16)
		}
		await sleep(150)
		const gMid = await K.connector(p, KC)
		await p.mouse.up()
		const cW = boxOf((await itemMap(p)).get(C))
		t.check(gMid && onBorder(gMid.end, cW, 2), '[S] während des Ziehens folgt das Ende dem Zeiger und rastet am Rand von C ein (Vorschau, ±2)', { route: routeFmt(gMid), C: fmt(cW) })
		t.check(await until(async () => (await itemMap(p)).get(KC)?.data?.end?.item === C, { timeout: 4000 }), '[S] Endgriff über C losgelassen: data.end bindet an C (retarget)', { ende: (await itemMap(p)).get(KC)?.data?.end, griff: eh, element: atHandle, zeiger: cC, auswahl: await K.selection(p) })
		await K.waitIdle(p)
		const g5 = await K.connector(p, KC)
		t.check(g5 && onBorder(g5.end, await boxIn(p, C), 2), '[S] die Route endet am Rand von C (±2)', routeFmt(g5))
		await settle([p, b.page])
		t.check((await itemMap(b.page)).get(KC)?.data?.end?.item === C, '[C] bob: das Ende hängt an C', (await itemMap(b.page)).get(KC)?.data?.end)
		await p.keyboard.press('Control+z')
		t.check(await until(async () => (await itemMap(p)).get(KC)?.data?.end?.item === B, { timeout: 4000 }), '[C] Strg+Z hängt das Ende zurück an B (ein Schritt)', (await itemMap(p)).get(KC)?.data?.end)

		t.step('„+“-Griff: A auswählen, vom unteren „+“-Griff auf C ziehen')
		await p.keyboard.press('Escape').catch(() => {})
		await selectItem(p, A)
		const hsA = await K.handles(p)
		t.check(sameList(plusNames(hsA), ALL_PLUS), '[S] eine Notiz ausgewählt: die vier „+“-Griffe plus-t/r/b/l neben den Transformer-Griffen (§6.3, Namen §6.7)', hsA?.map((h) => h.name))
		const boxA = await boxIn(p, A)
		// the lower "+" handle by its frozen name plus-b (§6.7, R11); by position only as the fallback
		const ph = pickHandle(hsA, 'plus-b', await K.w2s(p, boxA.x + boxA.w / 2, boxA.y + boxA.h))
		if (ph?.by === 'position') t.note(`„+“-Griff plus-b fehlt in __knorke.handles() (${(hsA || []).map((h) => h.name).join(', ')}): Rückfall auf die Wahl nach Lage (${ph.name})`)
		if (ph) {
			const beforeP = await idSet(p)
			await dragPath(p, ph, await centerOf(p, C), { steps: 14 })
			const KP = await newItemOf(p, beforeP, 'connector', 5000)
			t.check(KP, '[S] Ziehen vom „+“-Griff legt einen Verbinder an')
			if (KP) {
				const kp = (await itemMap(p)).get(KP)
				t.check(kp?.data?.start?.item === A && kp?.data?.end?.item === C, '[S] „+“-Verbinder: start an A, end an C', kp?.data)
				await settle([p, b.page])
				t.check((await itemMap(b.page)).has(KP), '[C] bob sieht den „+“-Verbinder')
			}
		} else {
			t.check(false, '[S] unterer „+“-Griff von A gefunden', await K.handles(p))
		}
		await world.drop(b)
		await world.drop(a)
	},
}

// ── E24 ──────────────────────────────────────────────────────────────────

/** Records `paste` events (capture: trusted, target is the catcher; bubble: defaultPrevented). */
async function recordPaste(ctx) {
	await ctx.addInitScript(() => {
		window.__kdPaste = []
		window.addEventListener('paste', (e) => {
			const tgt = e.target
			window.__kdPaste.push({ phase: 'capture', trusted: e.isTrusted, catcher: !!(tgt && tgt.hasAttribute && tgt.hasAttribute('data-knorke-paste-catcher')) })
		}, true)
		window.addEventListener('paste', (e) => { window.__kdPaste.push({ phase: 'bubble', prevented: e.defaultPrevented }) })
	})
}

/** localStorage['knorke.clip'] of the page, parsed (or null). */
const clipStore = (p) => p.evaluate(() => {
	try { return JSON.parse(window.localStorage.getItem('knorke.clip') || 'null') } catch (e) { return null }
}).catch(() => null)

/** Copies `text` as plain text through a helper page of the same context (native copy of selected text). */
async function copyPlain(ctx, text) {
	const h = await ctx.newPage()
	await h.setContent(`<pre id="t"></pre>`)
	await h.evaluate((v) => {
		const el = document.getElementById('t')
		el.textContent = v
		const r = document.createRange()
		r.selectNodeContents(el)
		const sel = window.getSelection()
		sel.removeAllRanges()
		sel.addRange(r)
	}, text)
	await h.keyboard.press('Control+c')
	await h.close()
}

/** Reads the clipboard's plain text by pasting into a textarea of a helper page. */
async function readPlain(ctx) {
	const h = await ctx.newPage()
	await h.setContent('<textarea id="t"></textarea>')
	await h.focus('#t')
	await h.keyboard.press('Control+v')
	const v = await h.inputValue('#t')
	await h.close()
	return v
}

/**
 * The E24 source board: frame with two notes (absolute frame position, relative
 * children) and a connector between them (round 1b: start anchored on N1's
 * right side, end auto on N2).
 */
async function seedSource(board) {
	const ids = { F: ulid(), N1: ulid(), N2: ulid(), KC: ulid() }
	const res = await seedOps('alice', board, [
		put.frame(ids.F, { x: 0, y: 0, w: 700, h: 400, data: { title: 'Kopier-Rahmen' } }),
		put.sticky(ids.N1, { parent: ids.F, x: 40, y: 60, data: { text: 'Notiz eins' }, style: { fill: '#ffadad' } }),
		put.sticky(ids.N2, { parent: ids.F, x: 300, y: 60, data: { text: 'Notiz zwei' }, style: { fill: '#caffbf' } }),
		put.connector(ids.KC, { item: ids.N1, ax: 1, ay: 0.5 }, { item: ids.N2 }, { data: { label: 'weiter' } }),
	])
	if (!res.every((x) => x === 'ok')) throw new Error(`Quelle anlegen: ${res}`)
	return ids
}

export const E24 = {
	id: 'E24',
	title: 'Kopieren/Einfügen: Frame mit 2 Notizen und Verbinder dazwischen in Board 2 (neue IDs, Verbinder an den Kopien, ein Undo-Schritt), zwei Notizen kopieren nimmt den Verbinder mit, Strg+D +20/+20, Klartext → Notizen, Strg+Umschalt+V an Ort und Stelle (Objekte, nicht Notizen), markierter Seitentext bleibt Text, Toast; Chromium; WebKit mit Einfüge-Fänger; Firefox als Bericht',
	async run(t, world) {
		const b1 = await world.board('E24 Quelle')
		const b2 = await world.board('E24 Ziel')
		const src = await seedSource(b1)
		const a = await world.actor('alice-clip', { user: 'alice' })
		await recordToasts(a.ctx)
		await recordPaste(a.ctx)
		const pA = a.page
		pA.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(a, b1)
		// a second tab of alice-clip: its pageerrors count like those of a.page (the Actor
		// watches every page of its context, lib/browsers.mjs watchContext)
		const pB = await a.ctx.newPage()
		pB.on('dialog', (d) => d.accept().catch(() => {}))
		await pB.goto(`${APP}/b/${b2}`, { waitUntil: 'domcontentloaded' })
		await waitReady(pB)

		t.step('Chromium: Strg+A, Strg+C in Board 1')
		await pA.bringToFront()
		await fitAll(pA)
		await pA.keyboard.press('Control+a')
		const selA = await K.selection(pA)
		t.check(Array.isArray(selA) && [src.F, src.N1, src.N2, src.KC].every((id) => selA.includes(id)), '[S] Strg+A wählt Frame, Notizen und Verbinder', selA)
		await pA.keyboard.press('Control+c')
		const toast = await until(async () => (await toastsOf(pA)).find((x) => /\d+ items? copied$/.test(x.text)) || null, { timeout: 4000 })
		t.check(toast, '[C] Toast „{n} items copied“', (await toastsOf(pA)).map((x) => x.text))
		if (toast) t.note(`Toast: „${toast.text}“`)
		t.check(/^4 items copied$/.test(toast?.text || ''), '[C] Toast nennt 4 Objekte (Frame, zwei Notizen, Verbinder)', toast?.text)
		const store = await clipStore(pA)
		t.check(store?.v === 1 && Number.isFinite(store?.ts) && store?.payload?.knorke === 1 && store.payload.items?.length === 4, '[C] Ablage knorke.clip {v:1, ts, text, payload} mit 4 Objekten (§6.5.3)', store && { v: store.v, n: store.payload?.items?.length })
		const kcClip = store?.payload?.items?.find((x) => x.t === 'connector')
		t.check(kcClip?.data?.start?.item === src.N1 && kcClip?.data?.end?.item === src.N2, '[C] der Verbinder liegt mit beiden Enden im Payload', kcClip?.data)

		t.step('Chromium: Strg+V in Board 2 am Zeiger')
		await pB.bringToFront()
		const Z = await worldAt(pB, 0.5, 0.5)
		const beforeB = await idSet(pB)
		await clickWorld(pB, Z.x, Z.y)
		await pB.keyboard.press('Control+v')
		const pasted = await until(async () => {
			const m = await itemMap(pB)
			const fresh = [...m.entries()].filter(([id]) => !beforeB.has(id))
			return fresh.length >= 4 ? new Map(fresh) : null
		}, { timeout: 6000 })
		t.check(pasted, '[C] vier neue Objekte in Board 2 (Frame, zwei Notizen, Verbinder)', [...(await itemMap(pB)).values()].filter((it) => !beforeB.has(it.id)).map((it) => it.t))
		const evB = await pB.evaluate(() => window.__kdPaste.splice(0))
		t.check(evB.some((e) => e.phase === 'capture' && e.trusted && e.catcher) && evB.some((e) => e.phase === 'bubble' && e.prevented), '[C] paste am Einfüge-Fänger, von Knorke behandelt (defaultPrevented)', evB)
		if (pasted) {
			const all = [...pasted.entries()]
			const fr = all.find(([, it]) => it.t === 'frame')
			const n1 = all.find(([, it]) => it.data?.text === 'Notiz eins')
			const n2 = all.find(([, it]) => it.data?.text === 'Notiz zwei')
			t.check(fr && n1 && n2 && fr[1].data?.title === 'Kopier-Rahmen', '[C] Frame (Titel) und beide Notizen eingefügt', all.map(([, it]) => [it.t, it.data]))
			if (fr && n1 && n2) {
				t.check(![src.F, src.N1, src.N2].includes(fr[0]) && ![src.F, src.N1, src.N2].includes(n1[0]), '[C] neue IDs')
				t.check(n1[1].parent === fr[0] && n2[1].parent === fr[0] && n1[1].x === 40 && n1[1].y === 60 && n2[1].x === 300 && n2[1].y === 60, '[C] Notizen im neuen Frame an ihrer relativen Lage', [n1[1], n2[1]].map((x) => [x.parent === fr[0], x.x, x.y]))
				t.check(n1[1].style?.fill === '#ffadad' && n2[1].style?.fill === '#caffbf', '[C] Stil erhalten')
				const cx = fr[1].x + fr[1].w / 2
				const cy = fr[1].y + fr[1].h / 2
				t.check(near(cx, Z.x, 2 + 1 / Z.scale) && near(cy, Z.y, 2 + 1 / Z.scale), '[C] Box-Mitte am Zeiger (§6.5.3 Lage)', { mitte: [cx, cy], zeiger: [Z.x, Z.y] })
				// round 1b: the connector between the copies (remapEndpoint, §6.5.3)
				const kc = all.find(([, it]) => it.t === 'connector')
				t.check(kc && kc[0] !== src.KC, '[C] Verbinder mit neuer ID eingefügt', kc && kc[0])
				if (kc) {
					const d = kc[1].data || {}
					t.check(d.start?.item === n1[0] && d.start?.ax === 1 && d.start?.ay === 0.5 && d.end?.item === n2[0] && !('ax' in (d.end || {})),
						'[C] Verbinder an den Kopien: start an der neuen Notiz eins (ax 1, ay 0,5), end an der neuen Notiz zwei', d)
					t.check(d.label === 'weiter' && kc[1].x === 0 && kc[1].y === 0 && kc[1].w === 0 && kc[1].h === 0 && kc[1].parent === null, '[C] Beschriftung erhalten, Lage none', { label: d.label, box: fmt(boxOf(kc[1])), parent: kc[1].parent })
					const g = await K.connector(pB, kc[0])
					const absBox = (n) => ({ x: n[1].x + fr[1].x, y: n[1].y + fr[1].y, w: n[1].w, h: n[1].h })
					t.check(g && onBorder(g.start, absBox(n1), 2) && onBorder(g.end, absBox(n2), 2), '[S] die Route der Kopie läuft vom Rand der neuen Notiz eins zum Rand der neuen Notiz zwei (±2)', g && { start: [g.start.x, g.start.y], end: [g.end.x, g.end.y] })
					// R11: the anchored start lies exactly at the anchor point of its new target – rule 14 with the
					// stored ax/ay (the [C] check above pins them to 1/0.5) and the note's box in the new frame
					const anc = 'ax' in (d.start || {}) ? anchorPoint(n1[1], fr[1], d.start) : null
					t.check(g && anc && near(g.start.x, anc[0], 0.01) && near(g.start.y, anc[1], 0.01),
						'[S] verankerter Start der Kopie genau am Anker der neuen Notiz eins (Regel 14, ±0,01)', { start: g && [g.start.x, g.start.y], anker: anc, ende: d.start, box: fmt(boxOf(n1[1])), frame: [fr[1].x, fr[1].y] })
				}
			}
			await K.waitIdle(pB)
			const srvB = await serverMap('alice', b2)
			t.check([...pasted.keys()].every((id) => srvB.has(id)), '[B] eingefügte Objekte beim Server')
			const kcS = [...pasted.entries()].find(([, it]) => it.t === 'connector')
			const n1S = [...pasted.entries()].find(([, it]) => it.data?.text === 'Notiz eins')
			if (kcS && n1S) t.check(srvB.get(kcS[0])?.data?.start?.item === n1S[0], '[B] beim Server: der eingefügte Verbinder hängt an der eingefügten Notiz eins', srvB.get(kcS[0])?.data)
			await pB.keyboard.press('Control+z')
			const gone = await until(async () => {
				const m = await itemMap(pB)
				return [...pasted.keys()].every((id) => !m.has(id)) ? true : null
			}, { timeout: 4000 })
			t.check(gone, '[C] ein Strg+Z entfernt das ganze Einfügen samt Verbinder (ein Undo-Schritt)')
		}

		t.step('Chromium: Strg+D in Board 1 (+20/+20)')
		await pA.bringToFront()
		await selectItem(pA, src.N1)
		const beforeD = await idSet(pA)
		await pA.keyboard.press('Control+d')
		const dup = await newItemOf(pA, beforeD, 'sticky', 5000, (x) => x.data?.text === 'Notiz eins')
		t.check(dup, '[C] Strg+D legt ein Duplikat an')
		if (dup) {
			const m = await itemMap(pA)
			const d = m.get(dup)
			const f = m.get(src.F)
			const abs = (it) => ({ x: it.x + (it.parent === src.F ? f.x : 0), y: it.y + (it.parent === src.F ? f.y : 0) })
			const want = { x: abs(m.get(src.N1)).x + 20, y: abs(m.get(src.N1)).y + 20 }
			t.check(near(abs(d).x, want.x, 1) && near(abs(d).y, want.y, 1) && d.style?.fill === '#ffadad', '[C] Duplikat +20/+20, gleicher Stil', { ist: abs(d), soll: want })
			await pA.keyboard.press('Control+z')
			t.check(await until(async () => !(await itemMap(pA)).has(dup), { timeout: 4000 }), '[C] Strg+Z entfernt das Duplikat (ein Schritt)')
		}

		t.step('Chromium: Notiz eins und Notiz zwei auswählen (ohne den Verbinder), Strg+C nimmt den Verbinder mit')
		await selectItem(pA, src.N1)
		const c2 = await centerOf(pA, src.N2)
		await pA.keyboard.down('Shift')
		await pA.mouse.click(c2.x, c2.y)
		await pA.keyboard.up('Shift')
		const sel2 = (await K.selection(pA)) || []
		t.check(sel2.length === 2 && sel2.includes(src.N1) && sel2.includes(src.N2), '[S] Umschalt+Klick: Auswahl [Notiz eins, Notiz zwei]', sel2)
		await pA.keyboard.press('Control+c')
		await sleep(200)
		const st2 = await clipStore(pA)
		const types2 = (st2?.payload?.items || []).map((x) => x.t).sort()
		t.check(sameList(types2, ['connector', 'sticky', 'sticky']), '[C] beide Enden im Payload: der Verbinder kommt mit (§6.5.3)', types2)

		t.step('Chromium: Strg+C auf Notiz zwei, Strg+Umschalt+V an Ort und Stelle (Chromium liefert nur text/plain)')
		await selectItem(pA, src.N2)
		await pA.keyboard.press('Control+c')
		await sleep(200)
		const st3 = await clipStore(pA)
		t.check(sameList((st3?.payload?.items || []).map((x) => x.t), ['sticky']), '[C] nur Notiz zwei: der Verbinder (ein Ende außerhalb, nicht ausgewählt) bleibt draußen', (st3?.payload?.items || []).map((x) => x.t))
		const beforeV = await idSet(pA)
		await pA.keyboard.press('Control+Shift+v')
		const inPlace = await newItemOf(pA, beforeV, 'sticky', 5000, (x) => x.data?.text === 'Notiz zwei')
		t.check(inPlace, '[C] Strg+Umschalt+V fügt ein')
		if (inPlace) {
			const m = await itemMap(pA)
			const n = m.get(inPlace)
			const o = m.get(src.N2)
			const f = m.get(src.F)
			const absN = { x: n.x + (n.parent === src.F ? f.x : 0), y: n.y + (n.parent === src.F ? f.y : 0) }
			const absO = { x: o.x + f.x, y: o.y + f.y }
			t.check(near(absN.x, absO.x, 1) && near(absN.y, absO.y, 1) && n.style?.fill === '#caffbf' && n.w === o.w && n.h === o.h,
				'[C] an Ort und Stelle als Objekt (Lage, Farbe, Größe der Kopie aus der Ablage), nicht als Notiz aus Klartext', { neu: [absN, n.style?.fill, n.w], original: [absO, o.style?.fill, o.w] })
			await pA.keyboard.press('Control+z')
			await until(async () => !(await itemMap(pA)).has(inPlace), { timeout: 4000 })
		}

		t.step('Chromium: mehrzeiliger Klartext → Notizen')
		await copyPlain(a.ctx, 'Alpha\nBeta\nGamma')
		await pB.bringToFront()
		const beforeP = await idSet(pB)
		await clickWorld(pB, Z.x, Z.y)
		await pB.keyboard.press('Control+v')
		const plain = await until(async () => {
			const m = await itemMap(pB)
			const fresh = [...m.entries()].filter(([id, it]) => !beforeP.has(id) && it.t === 'sticky')
			return fresh.length >= 3 ? fresh : null
		}, { timeout: 6000 })
		t.check(plain && sameList(plain.map(([, it]) => it.data?.text).sort(), ['Alpha', 'Beta', 'Gamma']), '[C] 3 Zeilen → 3 Notizen', plain?.map(([, it]) => it.data?.text))
		if (plain) {
			await pB.keyboard.press('Control+z')
			t.check(await until(async () => { const m = await itemMap(pB); return plain.every(([id]) => !m.has(id)) ? true : null }, { timeout: 4000 }), '[C] ein Strg+Z entfernt alle 3 Notizen')
		}

		t.step('Chromium: markierter Seitentext (Board-Titel) mit Strg+C bleibt eine Browser-Kopie')
		await pA.bringToFront()
		const toastsBefore = (await toastsOf(pA)).length
		const itemsBefore = (await K.items(pA)).length
		const title = await pA.evaluate(() => {
			const pick = (el) => {
				const r = document.createRange()
				r.selectNodeContents(el)
				const sel = window.getSelection()
				sel.removeAllRanges()
				sel.addRange(r)
				return sel.toString().trim()
			}
			const el = document.querySelector('.knorke-topbar__title')
			const got = el ? pick(el) : ''
			if (got) return { text: got, where: 'TopBar-Titel' }
			// the title may be a button with user-select: none – a paragraph of the page instead
			const para = document.createElement('p')
			para.setAttribute('data-kd-probe', '')
			para.textContent = 'E24 Seitentext'
			document.body.appendChild(para)
			return { text: pick(para), where: 'Absatz der Seite' }
		})
		t.must(title?.text, '[C] Seitentext markiert', title)
		t.note(`markierter Text: ${title.where} „${title.text}“`)
		await pA.keyboard.press('Control+c')
		await sleep(200)
		const clip = (await readPlain(a.ctx)).trim()
		t.check(clip === title.text, '[S] Zwischenablage enthält den markierten Text (kein Abfangen)', { clip, title: title.text })
		t.check((await toastsOf(pA)).length === toastsBefore && (await K.items(pA)).length === itemsBefore, '[C] kein Kopier-Toast, keine Objektänderung')
		await pA.evaluate(() => { window.getSelection().removeAllRanges(); document.querySelector('[data-kd-probe]')?.remove() })
		await pB.close().catch(() => {})
		await world.drop(a)

		await webkitPart(t, b1, b2, src)
		await firefoxReport(t, b1, b2)
	},
}

/**
 * WebKit (§6.5.3 R2, real case for the paste catcher): Ctrl+C writes the store
 * and shows the toast; Ctrl+V fires a trusted paste on the catcher that Knorke
 * handles; the content goes in through a paste event with the clip built from
 * the store (headless WPE carries no clipboard data, see the header).
 * The WebKit actor is no World actor, so its pageerrors are checked here: every
 * error counts except WPE's "… due to access control checks." inside a
 * navigation window (login, open board 1, board 1 → board 2: a /sync tick in
 * flight when the page leaves), lib/browsers.mjs countedErrors.
 */
async function webkitPart(t, b1, b2, src) {
	t.step('WebKit: Strg+C, Strg+V am Einfüge-Fänger')
	let browser = null
	let w = null
	const nav = []
	try {
		browser = await webkit.launch()
		w = await newActor(browser, 'alice-webkit', { user: 'alice' })
		await recordToasts(w.ctx)
		await recordPaste(w.ctx)
		const p = w.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(w, b1)
		nav.push([0, w.errors.length])
		await fitAll(p)
		await selectItem(p, src.N1)
		await p.keyboard.press('Control+c')
		const toast = await until(async () => (await toastsOf(p)).find((x) => /\d+ items? copied$/.test(x.text)) || null, { timeout: 4000 })
		t.check(toast, '[C] WebKit: Toast „{n} items copied“', (await toastsOf(p)).map((x) => x.text))
		const store = await clipStore(p)
		t.check(store?.payload?.items?.length === 1 && store?.text?.includes('Notiz eins'), '[C] WebKit: Ablage mit der Notiz', store && { n: store.payload?.items?.length, text: store.text })
		// leave board 1 idle (no unacknowledged op, no beforeunload prompt), then navigate
		await K.waitIdle(p)
		const navFrom = w.errors.length
		await p.goto(`${APP}/b/${b2}`, { waitUntil: 'domcontentloaded' })
		await waitReady(p)
		nav.push([navFrom, w.errors.length])
		const Z = await worldAt(p, 0.5, 0.5)
		await clickWorld(p, Z.x, Z.y)
		const before = await idSet(p)
		await p.keyboard.press('Control+v')
		const real = await newItemOf(p, before, 'sticky', 4000, (x) => x.data?.text === 'Notiz eins')
		const ev = await p.evaluate(() => window.__kdPaste.splice(0))
		t.check(ev.some((e) => e.phase === 'capture' && e.trusted && e.catcher), '[C] WebKit: Strg+V löst ein echtes paste am Einfüge-Fänger aus (fokussiertes textarea)', ev)
		t.check(await canvasFocused(p), '[C] WebKit: Fokus danach wieder auf der Leinwand', await p.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className))
		t.check(await p.evaluate(() => document.querySelector('textarea[data-knorke-paste-catcher]')?.value === ''), '[C] WebKit: der Einfüge-Fänger ist danach leer')
		const prevented = ev.some((e) => e.phase === 'bubble' && e.prevented)
		t.note(`WebKit: paste am Fänger ${prevented ? 'mit' : 'ohne'} preventDefault (§6.5.3 sagt „ruft preventDefault“; ohne Daten im Ereignis lässt [C] den Browser den Klartext einfügen und liest ihn aus dem Fänger)`)
		if (real) {
			t.note('WebKit: Inhalt kam über die echte Zwischenablage (Klartext, die Ablage macht daraus Objekte)')
			t.check(real !== src.N1, '[C] WebKit: Notiz mit neuer ID eingefügt (echter Weg)', real)
			await focusCanvas(p)
			await p.keyboard.press('Control+z')
			t.check(await until(async () => !(await itemMap(p)).has(real), { timeout: 4000 }), '[C] WebKit: ein Strg+Z entfernt das Einfügen')
		} else {
			t.note('WebKit: über die echte Zwischenablage kam nichts (headless WPE trägt keine Daten) – Inhalt über ein paste-Ereignis mit dem Clip aus der Ablage')
			t.step('WebKit: Inhalt über ein paste-Ereignis mit dem Clip aus der Ablage')
			const before2 = await idSet(p)
			const res = await p.evaluate(() => {
				const st = JSON.parse(window.localStorage.getItem('knorke.clip') || 'null')
				if (!st || !st.payload) return { error: 'keine Ablage' }
				const json = JSON.stringify(st.payload)
				const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
				const dt = new DataTransfer()
				dt.setData('text/html', `<meta charset="utf-8"><div data-knorke-clip="v1.${b64}"></div>`)
				dt.setData('text/plain', st.text || '')
				const catcher = document.querySelector('textarea[data-knorke-paste-catcher]')
				if (!catcher) return { error: 'kein Einfüge-Fänger' }
				catcher.focus()
				const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
				catcher.dispatchEvent(e)
				return { prevented: e.defaultPrevented }
			})
			t.check(res?.prevented === true, '[C] WebKit: Einfüge-Fänger vorhanden, Knorke behandelt das paste', res)
			const n = await newItemOf(p, before2, 'sticky', 5000, (x) => x.data?.text === 'Notiz eins')
			t.check(n && n !== src.N1, '[C] WebKit: Notiz mit neuer ID eingefügt (Prüfung, Base64, Registry in WebKit)', n)
			if (n) {
				await focusCanvas(p)
				await p.keyboard.press('Control+z')
				t.check(await until(async () => !(await itemMap(p)).has(n), { timeout: 4000 }), '[C] WebKit: ein Strg+Z entfernt das Einfügen')
			}
		}
		await K.waitIdle(p).catch(() => {})
		const tolerated = w.errors.length - countedErrors(w.errors, nav).length
		if (tolerated) t.note(`WebKit: ${tolerated} Seitenfehler „… due to access control checks.“ beim Seitenwechsel toleriert (abgebrochener Abruf, ${nav.map(([a, b]) => `${a}–${b}`).join(', ')})`)
		const errs = countedErrors(w.errors, nav)
		t.check(errs.length === 0, '[C] WebKit: keine Seitenfehler (pageerror, außer abgebrochenen Abrufen beim Seitenwechsel)', errs)
	} catch (e) {
		const errs = w ? countedErrors(w.errors, nav) : []
		t.check(false, `[C] WebKit-Lauf abgebrochen: ${String(e?.message || e).split('\n')[0].slice(0, 300)}`, { abbruch: abortNote(e, 'WebKit-Teil'), ...(errs.length ? { seitenfehler: errs } : {}) })
	} finally {
		if (w) {
			await w.page.goto('about:blank').catch(() => {})
			await w.close()
		}
		await browser?.close().catch(() => {})
	}
}

/**
 * Firefox (§8.4: report only): the main flow, results as notes, never red.
 * Headless Firefox reports no pointer, Knorke would run its view-only device
 * mode: the pointer prefs give it a mouse (lib/browsers.mjs); the note carries
 * uiMode, (any-pointer: fine) and the page errors of every Firefox page.
 * SPEC-M1 §21 (R10): an abort keeps the step that was running and the last
 * lines of Playwright's call log (abortNote); the Nextcloud login gets one
 * second attempt (retryOnce), and the note says so.
 */
async function firefoxReport(t, b1, b2) {
	t.step('Firefox (Bericht): Strg+A, Strg+C, Strg+V in Board 2, Strg+Umschalt+V')
	let browser = null
	let f = null
	let step = 'Firefox starten'
	const out = []
	try {
		browser = await firefox.launch(firefoxLaunchOptions())
		step = 'Kontext anlegen'
		f = await newActor(browser, 'alice-firefox', { timeout: FIREFOX_TIMEOUT_MS })
		await recordToasts(f.ctx)
		const p = f.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		step = 'Nextcloud-Anmeldung'
		const lg = await retryOnce(() => login(p, 'alice'), {
			onRetry: (e) => { out.push(`erster Anmeldeversuch gescheitert (${abortNote(e, step, { lines: 3 })}), zweiter Versuch`) },
		})
		if (lg.attempts > 1) out.push('zweiter Anmeldeversuch: ok')
		step = 'Board 1 öffnen'
		await openBoard(f, b1)
		const dev = await p.evaluate(() => ({ uiMode: window.__knorke.state().uiMode, fine: window.matchMedia('(any-pointer: fine)').matches }))
		out.push(`uiMode ${dev.uiMode}, (any-pointer: fine) ${dev.fine}${dev.uiMode === 'edit' ? '' : ' – ACHTUNG: kein Bearbeiten, Bericht ohne Aussage'}`)
		step = 'Strg+A, Strg+C in Board 1'
		await fitAll(p)
		await p.keyboard.press('Control+a')
		const sel = await K.selection(p)
		const domSel = await p.evaluate(() => String(window.getSelection() || '').length)
		out.push(`Strg+A: ${Array.isArray(sel) ? sel.length : 'keine'} Objekte ausgewählt, DOM-Textauswahl ${domSel} Zeichen`)
		await p.keyboard.press('Control+c')
		const toast = await until(async () => (await toastsOf(p)).find((x) => /copied$/.test(x.text)) || null, { timeout: 4000 })
		out.push(`Kopieren: ${toast ? `„${toast.text}“` : 'kein Toast'}, Ablage ${(await clipStore(p))?.payload?.items?.length ?? 'leer'}`)
		step = 'Board 2 in einem zweiten Tab öffnen'
		const p2 = await f.ctx.newPage()
		await p2.goto(`${APP}/b/${b2}`, { waitUntil: 'domcontentloaded' })
		await waitReady(p2)
		step = 'Strg+V in Board 2'
		const Z = await worldAt(p2, 0.5, 0.5)
		const before = await idSet(p2)
		await clickWorld(p2, Z.x, Z.y)
		await p2.keyboard.press('Control+v')
		await sleep(1500)
		const fresh = [...(await itemMap(p2)).entries()].filter(([id]) => !before.has(id))
		out.push(`Strg+V: ${fresh.length} Objekte (${fresh.map(([, it]) => it.t).join(', ') || '–'})`)
		if (fresh.length) {
			await p2.keyboard.press('Control+z')
			await sleep(800)
			out.push(`Strg+Z: ${[...(await idSet(p2))].filter((id) => !before.has(id)).length} übrig`)
		}
		step = 'Strg+Umschalt+V in Board 2'
		const before2 = await idSet(p2)
		await p2.keyboard.press('Control+Shift+v')
		await sleep(1500)
		const fresh2 = [...(await itemMap(p2)).entries()].filter(([id]) => !before2.has(id))
		out.push(`Strg+Umschalt+V: ${fresh2.length} Objekte (${fresh2.map(([, it]) => it.t).join(', ') || '–'})`)
		if (fresh2.length) {
			await p2.keyboard.press('Control+z')
			await sleep(800)
		}
		step = 'Aufräumen'
		await K.waitIdle(p2).catch(() => {})
		await K.waitIdle(p).catch(() => {})
		await p2.goto('about:blank').catch(() => {})
		await p2.close().catch(() => {})
	} catch (e) {
		out.push(abortNote(e, step))
		if (e?.firstError) out.push('auch der zweite Anmeldeversuch scheiterte')
	} finally {
		if (f) {
			out.push(`Seitenfehler: ${f.errors.length ? f.errors.slice(0, 3).join(' | ').slice(0, 400) : 'keine'}`)
			await f.page.goto('about:blank').catch(() => {})
			await f.close()
		}
		await browser?.close().catch(() => {})
	}
	t.note(`Firefox (nur Bericht): ${out.join('; ')}`)
}

// ── E25 ──────────────────────────────────────────────────────────────────

export const E25 = {
	id: 'E25',
	title: 'Frame am Griff tl vergrößern: absolute Lage der Kinder bei alice und bob unverändert (±1); am Griff tl verkleinern: ein Kind, dessen Mitte danach außerhalb liegt, ist freigegeben (parent null, Lage gleich)',
	async run(t, world) {
		const board = await world.board('E25 Frame')
		const token = await linkToken(board)
		const a = await world.actor('alice-frame', { user: 'alice' })
		const p = a.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(a, board)
		const b = await bobViaLink(world, 'bob-frame', token)
		// frame at 30 % of the visible canvas: room for the enlarged frame above and left of it
		const O = await worldAt(p, 0.3, 0.3)
		const s = O.scale
		const tol = 1 + 1 / s
		const o = { x: Math.round(O.x), y: Math.round(O.y) }
		const [F, A, B] = [ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.frame(F, { x: o.x, y: o.y, w: 800, h: 500, data: { title: 'Rahmen' } }),
			put.sticky(A, { parent: F, x: 40, y: 40, data: { text: 'A' } }),
			put.sticky(B, { parent: F, x: 500, y: 250, data: { text: 'B' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Frame mit zwei Kindern angelegt', res)
		t.must(await until(async () => { const m = await itemMap(p); return m.has(F) && m.has(A) && m.has(B) }, { timeout: 8000 }), '[C] alice sieht Frame und Kinder')
		const absOf = (m, id) => {
			const it = m.get(id)
			const f = it?.parent ? m.get(it.parent) : null
			return it ? { x: it.x + (f ? f.x : 0), y: it.y + (f ? f.y : 0), parent: it.parent } : null
		}
		const m0 = await itemMap(p)
		const absA = absOf(m0, A)
		const absB = absOf(m0, B)
		t.note(`Frame bei (${o.x}, ${o.y}); A absolut (${absA?.x}, ${absA?.y}), B absolut (${absB?.x}, ${absB?.y}); Skala ${s.toFixed(3)}`)

		t.step('Frame über das Titelband auswählen, Griff tl um (−100, −80) ziehen (vergrößern)')
		await tool(p, 'select')
		await clickWorld(p, o.x + 30, o.y - 8)
		t.check(sameList((await K.selection(p)) || [], [F]), '[S] Klick ins Titelband wählt den Frame', await K.selection(p))
		const hs = await K.handles(p)
		t.check(Array.isArray(hs) && sameList(transformNames(hs), ['b', 'bl', 'br', 'l', 'r', 't', 'tl', 'tr']), '[S] Frame: 8 Griffe, kein Drehgriff', hs?.map((h) => h.name))
		t.check(Array.isArray(hs) && plusNames(hs).length === 0 && extraHandles(hs).length === 0, '[S] Frame (nicht bindbar): keine „+“-Griffe und keine anderen Griffe (§6.3)', hs?.map((h) => h.name))
		let tl = await handleOf(p, 'tl')
		t.must(tl, '[S] Griff tl vorhanden')
		await dragPath(p, tl, { x: tl.x - 100 * s, y: tl.y - 80 * s })
		await K.waitIdle(p)
		let m = await itemMap(p)
		const f1 = m.get(F)
		t.check(near(f1?.x, o.x - 100, tol) && near(f1?.y, o.y - 80, tol) && near(f1?.w, 900, tol) && near(f1?.h, 580, tol), '[S] Frame um (−100, −80) vergrößert: 900 × 580', fmt(boxOf(f1)))
		for (const [id, abs0, label] of [[A, absA, 'A'], [B, absB, 'B']]) {
			const now = absOf(m, id)
			t.check(now?.parent === F && near(now.x, abs0.x, 1) && near(now.y, abs0.y, 1), `[C] ${label}: bleibt Kind, absolute Lage unverändert (alice)`, { vorher: abs0, nachher: now })
		}
		await settle([p, b.page])
		const mb = await itemMap(b.page)
		t.check([[A, absA], [B, absB]].every(([id, abs0]) => { const now = absOf(mb, id); return now?.parent === F && near(now.x, abs0.x, 1) && near(now.y, abs0.y, 1) }), '[C] bob: absolute Lage beider Kinder unverändert', [absOf(mb, A), absOf(mb, B)])

		t.step('Griff tl über die Mitte von A hinaus ziehen (verkleinern, A liegt danach außerhalb)')
		tl = await handleOf(p, 'tl')
		t.must(tl, '[S] Griff tl vorhanden (Frame weiter ausgewählt)')
		// new top-left o + (400, 300): A's centre o + (140, 140) is outside, B's centre o + (600, 350) inside
		await dragPath(p, tl, { x: tl.x + 500 * s, y: tl.y + 380 * s })
		await K.waitIdle(p)
		m = await itemMap(p)
		const f2 = m.get(F)
		t.check(near(f2?.x, o.x + 400, tol) && near(f2?.y, o.y + 300, tol) && near(f2?.w, 400, tol) && near(f2?.h, 200, tol), '[S] Frame verkleinert: Ursprung o + (400, 300), 400 × 200', fmt(boxOf(f2)))
		const a2 = absOf(m, A)
		const b2 = absOf(m, B)
		// membership after the transform (§6.5.2, actions.transformItems [C]) on top of the scene's
		// preview of the transform in the model (setBoxesLocal, keep-compensated children [S])
		t.check(a2?.parent === null && near(a2.x, absA.x, 1) && near(a2.y, absA.y, 1), '[C] A (Mitte außerhalb): freigegeben, parent null, absolute Lage gleich (§6.5.2)', { ist: a2, soll: absA })
		t.check(b2?.parent === F && near(b2.x, absB.x, 1) && near(b2.y, absB.y, 1), '[C] B (Mitte innerhalb) bleibt Kind, absolute Lage gleich', { ist: b2, soll: absB })
		await settle([p, b.page])
		const mb2 = await itemMap(b.page)
		t.check(absOf(mb2, A)?.parent === null && near(absOf(mb2, A)?.x, absA.x, 1) && absOf(mb2, B)?.parent === F && near(absOf(mb2, B)?.y, absB.y, 1), '[C] bob sieht dasselbe', [absOf(mb2, A), absOf(mb2, B)])
		await world.drop(b)
		await world.drop(a)
	},
}

// ── E26 ──────────────────────────────────────────────────────────────────

export const E26 = {
	id: 'E26',
	title: 'Tastatur/A11y: Board öffnen und ohne Klick N → Notiz-Werkzeug; nur Tastatur – Tab wählt Frames zuerst, dann Inhalt nach y/x, nach dem letzten verlässt Tab die Leinwand; Pfeile 1/Umschalt 10; Enter öffnet den Editor; „Anordnen“ setzt B/H/Winkel; zwei Objekte + „Connect“ (per Tastatur) legt einen Verbinder an; „Align items“: ein Tab ins Panel, nach Mausklick schließt das erste Esc nur das Panel; N bei TopBar-Fokus legt nichts an; nach Mausklick auf einen Toolbar-Knopf wirkt N sofort',
	async run(t, world) {
		const board = await world.board('E26 Tastatur')
		const [F, N1, N2, N3] = [ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(N3, { x: 100, y: 900, data: { text: 'drei' } }),
			put.sticky(N2, { x: 400, y: 600, data: { text: 'zwei' } }),
			put.frame(F, { x: 0, y: 0, w: 600, h: 400, data: { title: 'Rahmen' } }),
			put.sticky(N1, { x: 100, y: 600, data: { text: 'eins' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Frame und drei Notizen angelegt', res)
		const a = await world.actor('alice-tasten', { user: 'alice' })
		const p = a.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(a, board)

		t.step('Board öffnen und ohne Klick N drücken (R10): das Notiz-Werkzeug ist aktiv')
		// nothing touched the page yet: the session focused the canvas when the board opened (§6.5.1, R9/R10)
		const focusAtOpen = await canvasFocused(p)
		t.note(`Fokus nach dem Öffnen: ${focusAtOpen ? 'Leinwand' : await p.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className)}`)
		await p.keyboard.press('n')
		t.check(await until(async () => (await toolPressed(p, 'sticky')) === 'true', { timeout: 2000 }), '[C] nach dem Öffnen ohne Klick: N aktiviert das Notiz-Werkzeug ([data-knorke-tool=sticky] aria-pressed=true)', { ariaPressed: await toolPressed(p, 'sticky'), leinwandFokus: focusAtOpen })
		await p.keyboard.press('v')
		await until(async () => (await toolPressed(p, 'select')) === 'true', { timeout: 2000 })
		await fitAll(p)

		t.step('Tab-Reihenfolge: Frame, dann Inhalt nach y/x; nach dem letzten verlässt Tab die Leinwand')
		await p.keyboard.press('Escape')
		await focusCanvas(p)
		const order = []
		for (let i = 0; i < 4; i++) {
			await p.keyboard.press('Tab')
			await sleep(120)
			order.push(((await K.selection(p)) || [])[0] ?? null)
		}
		const nameOf = (id) => ({ [F]: 'F', [N1]: 'N1', [N2]: 'N2', [N3]: 'N3' })[id] ?? id
		t.check(sameList(order, [F, N1, N2, N3]), '[S] Tab wählt F, N1, N2, N3 (Frames zuerst, dann y, dann x)', order.map(nameOf))
		t.check(await canvasFocused(p), '[S] Fokus bleibt bis zum letzten Objekt auf der Leinwand')
		await p.keyboard.press('Tab')
		await sleep(150)
		t.check(!(await canvasFocused(p)), '[S] nach dem letzten Objekt verlässt Tab die Leinwand (keine Tastaturfalle)', await p.evaluate(() => document.activeElement?.tagName))
		await p.keyboard.press('Shift+Tab')
		await sleep(150)
		t.note(`Umschalt+Tab zurück: Fokus auf der Leinwand ${await canvasFocused(p)}`)

		t.step('Pfeile: N1 (per Klick ausgewählt, der Klick fokussiert die Leinwand) → 3 × rechts, Umschalt+oben')
		await tool(p, 'select')
		await selectItem(p, N1)
		t.must(sameList((await K.selection(p)) || [], [N1]) && await canvasFocused(p), '[S] Klick wählt N1 und fokussiert die Leinwand', { sel: await K.selection(p), focus: await canvasFocused(p) })
		for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight')
		// up, not down: N1 stays before N2 in reading order (centre y 690 < 700) for the Tab step below
		await p.keyboard.press('Shift+ArrowUp')
		await K.waitIdle(p)
		const n1 = (await itemMap(p)).get(N1)
		t.check(n1?.x === 103 && n1?.y === 590, '[S] Pfeile: x + 3, Umschalt+Pfeil: y − 10', { x: n1?.x, y: n1?.y })

		t.step('Enter öffnet den Editor')
		await p.keyboard.press('Enter')
		t.must(await editor(p).waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false), '[S] Enter öffnet den Editor der ausgewählten Notiz')
		await p.keyboard.press('Control+a')
		await p.keyboard.type('per Tastatur', { delay: 5 })
		await p.keyboard.press('Escape')
		await K.waitIdle(p)
		t.check((await itemMap(p)).get(N1)?.data?.text === 'per Tastatur', '[C] Text über Enter + Tippen gespeichert')
		t.check(await canvasFocused(p), '[S] nach Esc ist der Fokus wieder auf der Leinwand')

		t.step('„Anordnen“: N2 auf B 260, H 240, Winkel 30')
		await p.keyboard.press('Tab')
		t.must(sameList((await K.selection(p)) || [], [N2]), '[S] Tab nach N1 wählt N2 (das nächste in Lesereihenfolge)', await K.selection(p))
		await action(p, 'arrange')
		const fields = [['arrange-w', '260'], ['arrange-h', '240'], ['arrange-r', '30']]
		for (const [name, v] of fields) {
			const f = p.locator(`[data-knorke-field=${name}]:visible`).first()
			const ok = await f.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
			t.must(ok, `[C] Feld [data-knorke-field=${name}] sichtbar`)
			const tag = await f.evaluate((el) => el.tagName)
			const input = ['INPUT', 'TEXTAREA'].includes(tag) ? f : f.locator('input').first()
			await input.fill(v)
		}
		await p.keyboard.press('Enter')
		await K.waitIdle(p)
		const n2 = (await itemMap(p)).get(N2)
		t.check(n2?.w === 260 && n2?.h === 240 && n2?.r === 30, '[C] Anordnen setzt w 260, h 240, r 30', fmt(boxOf(n2)))
		await p.keyboard.press('Escape').catch(() => {})

		t.step('zwei Objekte auswählen (N1, Umschalt+Klick N3) und „Connect“ per Tastatur (Fokus + Enter): ein Verbinder N1 → N3')
		await selectItem(p, N1)
		const c3 = await centerOf(p, N3)
		await p.keyboard.down('Shift')
		await p.mouse.click(c3.x, c3.y)
		await p.keyboard.up('Shift')
		const sel2 = (await K.selection(p)) || []
		t.check(sel2.length === 2 && sel2.includes(N1) && sel2.includes(N3), '[S] Umschalt+Klick: Auswahl [N1, N3]', sel2.map(nameOf))
		const connectBtn = p.locator('[data-knorke-action=connect]:visible').first()
		const hasConnect = await connectBtn.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)
		t.check(hasConnect, '[C] mit zwei ausgewählten Objekten zeigt die Kontextleiste [data-knorke-action=connect] (WCAG 2.5.7)')
		if (hasConnect) {
			const beforeC = await idSet(p)
			await connectBtn.focus()
			await p.keyboard.press('Enter')
			const KN = await newItemOf(p, beforeC, 'connector', 5000)
			t.check(KN, '[C] „Connect“ legt einen Verbinder an (connectSelection → connectItems)')
			if (KN) {
				const kn = (await itemMap(p)).get(KN)
				const ends = [kn?.data?.start?.item, kn?.data?.end?.item]
				t.check(sameList([...ends].sort(), [N1, N3].sort()), '[C] seine Enden binden an N1 und N3', { start: nameOf(ends[0]), end: nameOf(ends[1]) })
				const g = await K.connector(p, KN)
				t.check(g?.start && g?.end, '[S] __knorke.connector(id) routet den neuen Verbinder', g)
				await K.waitIdle(p)
				t.check((await serverMap('alice', board)).get(KN)?.t === 'connector', '[B] beim Server angelegt')
			}
		}
		await p.keyboard.press('Escape').catch(() => {})

		t.step('„Align items“ (N1, Umschalt+Klick N3): Enter öffnet das Panel, ein Tab führt hinein; nach einem Mausklick auf einen Befehl schließt das erste Esc nur das Panel, das zweite leert die Auswahl')
		await selectItem(p, N1)
		const c3a = await centerOf(p, N3)
		await p.keyboard.down('Shift')
		await p.mouse.click(c3a.x, c3a.y)
		await p.keyboard.up('Shift')
		const selA = (await K.selection(p)) || []
		t.must(selA.length === 2 && selA.includes(N1) && selA.includes(N3), '[S] Umschalt+Klick: Auswahl [N1, N3] für „Align items“', selA.map(nameOf))
		const alignBtn = p.locator('[data-knorke-action=align]:visible').first()
		t.must(await alignBtn.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false), '[C] mit zwei Notizen zeigt die Kontextleiste [data-knorke-action=align]')
		const alignPanel = p.locator('[data-knorke-panel=align]')
		const focusInfo = () => p.evaluate(() => {
			const a = document.activeElement
			return {
				align: a?.closest?.('[data-knorke-align]')?.getAttribute('data-knorke-align') ?? null,
				action: a?.closest?.('[data-knorke-action]')?.getAttribute('data-knorke-action') ?? null,
				tag: a?.tagName ?? null,
			}
		})
		// (a) keyboard: focus on the toggle, Enter, one Tab into the panel, Shift+Tab back
		await alignBtn.focus()
		await p.keyboard.press('Enter')
		const panelOpen = await alignPanel.first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)
		const nameA = await alignBtn.getAttribute('aria-label').catch(() => null)
		t.check(panelOpen && (await alignBtn.getAttribute('aria-expanded').catch(() => null)) === 'true' && ['Align items', 'Objekte ausrichten'].includes(nameA),
			'[C] Enter auf „Align items“ öffnet das Panel [data-knorke-panel=align] (aria-expanded="true", Name „Align items“ bzw. „Objekte ausrichten“)', { sichtbar: panelOpen, name: nameA, expanded: await alignBtn.getAttribute('aria-expanded').catch(() => null) })
		await p.keyboard.press('Tab')
		const afterTab = await focusInfo()
		t.check(afterTab.align === 'left', '[C] ein Tab nach Enter auf „Align items“ führt auf „Align left edges“ ([data-knorke-align=left])', afterTab)
		await p.keyboard.press('Shift+Tab')
		const afterBack = await focusInfo()
		t.check(afterBack.action === 'align' && afterBack.align === null, '[C] Umschalt+Tab führt zurück auf den Schalter „Align items“', afterBack)
		const boxes = await p.evaluate(() => {
			const panel = document.querySelector('[data-knorke-panel=align]')
			const bar = panel?.closest('.knorke-contextbar')
			const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
			return { panel: r(panel), bar: r(bar) }
		})
		t.check(!!boxes.panel && !!boxes.bar && boxes.panel.top >= boxes.bar.bottom - 0.5, '[C] das Panel liegt unter der Leiste wie bisher (Oberkante ≥ Unterkante der Leiste)', boxes)
		// (b) pointer: a click on a command gives the focus back to the canvas, the panel stays open
		if (!(await alignPanel.first().isVisible().catch(() => false))) await alignBtn.click()
		const leftBtn = p.locator('[data-knorke-align=left]:visible').first()
		t.must(await leftBtn.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false), '[C] der Befehl [data-knorke-align=left] ist sichtbar')
		await leftBtn.click()
		await K.waitIdle(p)
		const focusBack = await until(() => canvasFocused(p), { timeout: 2000 })
		const stillOpen = await alignPanel.first().isVisible().catch(() => false)
		t.check(focusBack && stillOpen, '[C] nach dem Mausklick auf „Align left edges“ hat die Leinwand den Fokus, und das Panel ist noch offen', { leinwand: focusBack, panel: stillOpen, fokus: await focusInfo() })
		const im = await itemMap(p)
		t.check(near(im.get(N1)?.x, im.get(N3)?.x, 0.01), '[C] „Align left edges“: N1 und N3 haben dieselbe linke Kante', { N1: im.get(N1)?.x, N3: im.get(N3)?.x })
		await p.keyboard.press('Escape')
		const panelGone = await until(async () => (await p.locator('[data-knorke-panel]').count().catch(() => -1)) === 0, { timeout: 2000 })
		const selEsc = (await K.selection(p)) || []
		const barVisible = await p.locator('.knorke-contextbar').first().isVisible().catch(() => false)
		t.check(panelGone && (await alignBtn.getAttribute('aria-expanded').catch(() => null)) === 'false' && sameList([...selEsc].sort(), [N1, N3].sort()) && barVisible,
			'[C] Esc mit Leinwand-Fokus schließt zuerst das Panel: kein [data-knorke-panel], aria-expanded="false", die Auswahl [N1, N3] und die Kontextleiste bleiben', { panelWeg: panelGone, auswahl: selEsc.map(nameOf), leiste: barVisible, leinwand: await canvasFocused(p) })
		// the second Esc: no panel any more, the bar lets it through and the scene clears the selection,
		// also after Nextcloud's header menus cancelled the key (NcHeaderMenu: preventDefault on every
		// Esc; InputController lets an Esc on the canvas host pass, E40). A window listener added now
		// runs after the scene's and records what it saw (detail of a red check)
		await p.evaluate(() => {
			window.__kdEsc2 = null
			window.addEventListener('keydown', (e) => {
				window.__kdEsc2 = { key: e.key, prevented: e.defaultPrevented }
			}, { once: true })
		})
		await p.keyboard.press('Escape')
		const cleared = await until(async () => ((await K.selection(p)) || []).length === 0, { timeout: 2000 })
		t.check(cleared, '[S] das zweite Esc leert die Auswahl (auch nach dem preventDefault eines Kopfzeilen-Menüs)', { auswahl: ((await K.selection(p)) || []).map(nameOf), esc: await p.evaluate(() => window.__kdEsc2).catch(() => null), leinwand: await canvasFocused(p) })

		t.step('Fokus in der TopBar + Taste N legt nichts an')
		const toolBefore = await toolPressed(p, 'sticky')
		const countBefore = (await K.items(p)).length
		const rn = p.locator('[data-knorke-action=rename-board]').first()
		await rn.focus()
		await p.keyboard.press('n')
		await sleep(300)
		t.check(toolBefore !== 'true' && (await toolPressed(p, 'sticky')) !== 'true', '[S] N bei TopBar-Fokus schaltet kein Werkzeug', { vorher: toolBefore, nachher: await toolPressed(p, 'sticky') })
		t.check((await K.items(p)).length === countBefore && !(await canvasFocused(p)), '[S] und legt nichts an; Fokus bleibt in der TopBar')

		t.step('Mausklick auf einen Toolbar-Knopf, danach N')
		await p.locator('[data-knorke-tool=select]').first().click()
		t.check(await canvasFocused(p), '[C] nach einem Zeiger-Klick auf einen Toolbar-Knopf ist der Fokus auf der Leinwand (§6.5.1)', await p.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className))
		await p.keyboard.press('n')
		t.check(await until(async () => (await toolPressed(p, 'sticky')) === 'true', { timeout: 2000 }), '[C] N wirkt sofort: Notiz-Werkzeug aktiv', await toolPressed(p, 'sticky'))
		const before = await idSet(p)
		await clickWorld(p, 800, 1000)
		const created = await newItemOf(p, before, 'sticky', 5000)
		t.check(created, '[S] ein Klick legt danach eine Notiz an')
		if (await editor(p).isVisible().catch(() => false)) await p.keyboard.press('Escape')
		await K.waitIdle(p).catch(() => {})
		await world.drop(a)
	},
}
