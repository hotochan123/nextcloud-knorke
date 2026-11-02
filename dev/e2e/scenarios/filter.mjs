/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Filter the selection (factory job 144).
 *
 * E51 alice with a finger on a tablet (Chromium 1280 × 800, touch that also
 * reports a fine pointer: mode edit, the wide layout with the bar at the
 * selection) on a board of her own: note N1 (0, 0), the group G = {N3, N4}
 * (notes at 300 and 600) and the shape S2 (900, 0). Steps:
 *   (1) Ctrl+A on the canvas: the four items are selected; the count of the
 *       bar is the button [data-knorke-action=filter], wholly in the
 *       viewport and at least 44 × 44 CSS px;
 *   (2) a tap on it opens [data-knorke-panel=filter] with the entries
 *       sticky, shape and group ([data-knorke-filter]), each at least 44 px
 *       high;
 *   (3) a tap on [data-knorke-filter=group] leaves exactly N3 and N4
 *       selected; the tap sets nothing off below the moved bar (the
 *       selection stays, nothing moved at the server);
 *   (4) the panel is closed, the count is text again
 *       (.knorke-contextbar__count, no filter button), the canvas has the
 *       focus, and at the server N3 and N4 are still in G.
 * Own board, no instance setting: before E09, directly after E50.
 * Flake gate: --only E51 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection), [C] shell and session (bar, panel, filter, focus), [B] stored
 * server state, [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, serverMap, openBoard, until, sleep, canvasFocused } from '../lib/harness.mjs'

/** The tablet of E51: 1280 × 800, wide layout (more than 600 px). */
const TAB = Object.freeze({ width: 1280, height: 800 })
/** Every seeded item in view at scale 0.8, with room above for the bar. */
const CAM = Object.freeze({ x: -150, y: -300, scale: 0.8 })
/** Finger size (src/styles/knorke.css --knorke-touch). */
const TOUCH = 44

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** One finger down, held `hold` ms, up (CDP touch events, like a real finger). */
async function cdpTap(cdp, x, y, hold = 80) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
	await sleep(hold)
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** Taps the middle of a box. */
const tapBox = (cdp, b) => cdpTap(cdp, Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))

/** Same ids, any order. */
const sameIds = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x))

/** The visible box of the first element of a selector (null while hidden or missing). */
async function boxOf(page, sel) {
	const loc = page.locator(sel).first()
	if (!(await loc.isVisible().catch(() => false))) return null
	return loc.boundingBox().catch(() => null)
}

/** The entries of the open filter panel: [{kind, h}] in document order. */
function entriesOf(page) {
	return page.evaluate(() => [...document.querySelectorAll('[data-knorke-panel=filter] [data-knorke-filter]')].map((el) => ({
		kind: el.getAttribute('data-knorke-filter'),
		h: el.getBoundingClientRect().height,
		text: el.textContent.trim(),
	}))).catch(() => [])
}

export const E51 = {
	id: 'E51',
	title: `Auswahl filtern (Job 144) auf einem Tablet ${TAB.width} × ${TAB.height} mit dem Finger: nach Strg+A ist der Zähler ein Knopf (im Viewport, mindestens 44 × 44 px); ein Tipp öffnet die Liste sticky, shape, group (je mindestens 44 px hoch); ein Tipp auf „Only groups“ lässt genau N3 und N4 gewählt; danach ist die Liste zu, der Zähler wieder Text, die Leinwand hat den Fokus, beim Server bleibt die Gruppe`,
	async run(t, world) {
		const board = await world.board('E51 Auswahl filtern')
		const [N1, N3, N4, S2, G] = [ulid(), ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(N1, { x: 0, y: 0, data: { text: 'N1' } }),
			put.sticky(N3, { x: 300, y: 0, group: G, data: { text: 'N3' } }),
			put.sticky(N4, { x: 600, y: 0, group: G, data: { text: 'N4' } }),
			put.shape(S2, { x: 900, y: 0 }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: N1, die Gruppe G = {N3, N4} und die Form S2', res)
		const a = await world.actor(`alice-filtern-${TAB.width}`, { user: 'alice', touch: true, viewport: TAB, fine: true })
		const p = a.page
		try {
			await storeCamera(p, board, CAM)
			await openBoard(a, board)
			await K.waitIdle(p)
			const st = await K.state(p)
			t.must(st.uiMode === 'edit', '[D] das Tablet ist im Modus edit (Touch mit feinem Zeiger, wie E39)', { uiMode: st.uiMode, viewOnly: st.viewOnly })
			const before = await serverMap('alice', board)
			const cdp = await a.ctx.newCDPSession(p)

			t.step('(1) Strg+A: der Zähler ist der Knopf „Filter selection“')
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Control+a')
			t.must(await until(async () => sameIds((await K.selection(p)) || [], [N1, N3, N4, S2]), { timeout: 3000 }), '[S] (1) Strg+A wählt N1, N3, N4 und S2', await K.selection(p))
			let btn = null
			await until(async () => (btn = await boxOf(p, '[data-knorke-action=filter]')) !== null, { timeout: 3000 })
			t.must(btn, '[C] (1) der Zähler ist der Knopf [data-knorke-action=filter]', await p.locator('.knorke-contextbar').first().innerHTML().catch(() => null))
			const place = await p.locator('.knorke-contextbar').first().getAttribute('data-knorke-place').catch(() => null)
			t.check(place !== null && place !== 'hidden', '[D] (1) die Leiste steht im breiten Layout an der Auswahl', place)
			await sleep(300)
			btn = await boxOf(p, '[data-knorke-action=filter]')
			const vp = await p.evaluate(() => ({ vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight }))
			t.check(btn && btn.x >= 0 && btn.y >= 0 && btn.x + btn.width <= vp.vw && btn.y + btn.height <= vp.vh, '[C] (1) der Knopf liegt ganz im Viewport', { btn, vp })
			t.check(btn && btn.width >= TOUCH - 0.5 && btn.height >= TOUCH - 0.5, '[C] (1) der Knopf ist mindestens 44 × 44 CSS-px groß', btn)
			const label = await p.locator('[data-knorke-action=filter]').first().textContent().catch(() => '')
			t.check(/4 selected/.test(label || ''), '[C] (1) der Knopf zeigt „4 selected“', label)

			t.step('(2) ein Tipp öffnet die Liste der Arten')
			await tapBox(cdp, btn)
			let entries = []
			t.must(await until(async () => (entries = await entriesOf(p)).length > 0, { timeout: 3000 }), '[C] (2) der Tipp öffnet [data-knorke-panel=filter]', await p.locator('.knorke-contextbar').first().innerHTML().catch(() => null))
			t.check(entries.map((e) => e.kind).join(',') === 'sticky,shape,group', '[C] (2) die Einträge sticky, shape, group in dieser Reihenfolge', entries)
			t.check(entries.every((e) => e.h >= TOUCH - 0.5), '[C] (2) jeder Eintrag ist mindestens 44 px hoch', entries.map((e) => e.h))
			t.check(entries.map((e) => e.text).join('|') === 'Only notes (3)|Only shapes (1)|Only groups (1)', '[C] (2) die Texte nennen die Anzahl', entries.map((e) => e.text))
			t.check((await p.locator('[data-knorke-action=filter]').first().getAttribute('aria-expanded').catch(() => null)) === 'true', '[C] (2) der Knopf meldet aria-expanded="true"')
			await sleep(300)

			t.step('(3) ein Tipp auf „Only groups“')
			const entry = await boxOf(p, '[data-knorke-filter=group]')
			t.must(entry, '[D] (3) der Eintrag group ist sichtbar')
			await tapBox(cdp, entry)
			t.check(await until(async () => sameIds((await K.selection(p)) || [], [N3, N4]), { timeout: 3000 }), '[C] (3) genau N3 und N4 sind gewählt', await K.selection(p))
			await sleep(500)
			t.check(sameIds((await K.selection(p)) || [], [N3, N4]), '[S] (3) der Tipp löst unter der versetzten Leiste nichts aus: die Auswahl bleibt', await K.selection(p))

			t.step('(4) Liste zu, Zähler wieder Text, Fokus auf der Leinwand, Gruppe beim Server')
			t.check(await until(async () => (await p.locator('[data-knorke-panel=filter]').count()) === 0, { timeout: 2000 }), '[C] (4) die Liste ist zu')
			t.check((await p.locator('[data-knorke-action=filter]').count()) === 0, '[C] (4) kein Filterknopf mehr (eine Gruppe aus Notizen ist nicht filterbar)')
			const count = p.locator('.knorke-contextbar__count').first()
			t.check(await until(() => count.isVisible().catch(() => false), { timeout: 2000 }), '[C] (4) der Zähler ist wieder Text')
			t.check(/2 selected/.test((await count.textContent().catch(() => '')) || ''), '[C] (4) der Zähler zeigt „2 selected“', await count.textContent().catch(() => null))
			t.check(await canvasFocused(p), '[C] (4) die Leinwand hat den Fokus')
			await K.waitIdle(p)
			const after = await serverMap('alice', board)
			t.check(after.get(N3)?.group === G && after.get(N4)?.group === G, '[B] (4) N3 und N4 liegen beim Server weiter in G', [after.get(N3)?.group, after.get(N4)?.group])
			const same = [N1, N3, N4, S2].every((id) => after.get(id)?.x === before.get(id)?.x && after.get(id)?.y === before.get(id)?.y && (after.get(id)?.group ?? null) === (before.get(id)?.group ?? null))
			t.check(same, '[B] (4) beim Server hat sich nichts verändert (keine Op)', [N1, N3, N4, S2].map((id) => after.get(id) && [after.get(id).x, after.get(id).y, after.get(id).group ?? null]))
		} finally {
			await world.drop(a)
		}
	},
}
