/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Emoji reactions on notes (factory job 172).
 *
 * E62 alice (owner), the guest Gina (edit link), carol (shared with "vote",
 * no session: mode view) and bob (shared with "view"), Chromium 1440 × 900,
 * all at 100 % with the same camera, on a board of their own with note A at
 * (0, 0) and note B at (400, 0). Before (1) alice nudges B with an arrow
 * key: her one undo step. Steps:
 *   (1) alice selects A, the context bar's "Add reaction" → 👍; everyone
 *       sees 👍 1 at A in scene().reactions within 3 s;
 *   (2) Gina clicks the 👍 pill (👍 2, mine for her), then over the button
 *       at the end of the row ❤️: 👍 1, ❤️ 1; alice points at 👍 and sees
 *       "Alice Adler (you)" in [data-knorke-reactions=names];
 *   (3) carol points at A, its button → "More…" (the emoji chunk loads) →
 *       the search "rocket" → 🚀: 🚀 1 from "Carol Clausen"; bob sees no
 *       button and his click on a pill changes nothing;
 *   (4) alice: Ctrl+Z undoes the nudge and no reaction; a duplicate of A
 *       has no row; after Delete and Ctrl+Z A has the same reactions for
 *       everyone;
 *   (5) (job 183) the tablet guest Tina (touch, 820 × 1180) comes in over
 *       the vote link (route 17) with A and B in view: without a vote (mode
 *       view) B has the button without a reaction (shown [], add true), at
 *       carol's (desktop, mouse beside the notes) B has no row; alice starts
 *       a vote (route 22, notes), Tina is in mode vote: her finger on B's
 *       button opens the quick row, 👍 there reaches alice within 3 s and is
 *       no vote, a finger on B itself votes {B: 1}; zoomed out below 30 %
 *       she has no row at all.
 * Own board, no instance setting: before E09, directly after E61. Flake
 * gate: --only E62 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene (rows,
 * button, hit), [C] shell and session (bar, picker, names, ops, undo), [B]
 * server (stored n), [D] a harness precondition. Waiting polls from Node
 * with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, sleep, field, action, itemMap, newId, idSet } from '../lib/harness.mjs'

/** The camera everyone opens with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Tina's camera (job 183, tablet 820 × 1180): A and B in view at 100 %. */
const TCAM = Object.freeze({ x: -110, y: -300, scale: 1 })
/** The row of A (world): REACT_GAP 8 below its bottom edge, REACT_H 24 high. */
const ROW_Y = 200 + 8 + 12
/** The pills and the button of a row (world x of their centres) for the widths of model/reactions.js (one digit: 39 wide, 4 apart). */
const PILL = (i) => i * 43 + 19.5
const BUTTON = (kinds) => kinds * 43 + 12
const PICK = '[data-knorke-reactions=pick]'
const NAMES = '[data-knorke-reactions=names]'
const THUMBS = '1f44d'
const HEART = '2764-fe0f'
const ROCKET = '1f680'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

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
async function joinAsGuest(actor, token, name, board, cam = CAM) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await storeCamera(actor.page, board, cam)
	await field(actor.page, 'guest-name', name)
	await action(actor.page, 'guest-join')
	await waitReady(actor.page, 30000)
}

/** The row of A in scene().reactions ({id, shown: [[e, n, mine]], more, add}) or null. */
async function rowOf(page, id) {
	const s = await K.scene(page).catch(() => null)
	return (s?.reactions ?? []).find((r) => r.id === id) ?? null
}

/** The emoji with counts of a row, without mine: [[e, n]]. */
const counts = (row) => (row ? row.shown.map(([e, n]) => [e, n]) : null)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Waits until every page shows these counts at id. */
async function everyoneSees(pages, id, want, timeout = 3000) {
	const seen = await Promise.all(pages.map((p) => until(async () => same(counts(await rowOf(p, id)), want), { timeout })))
	return seen.every(Boolean)
}

/** data.react of an item on a page (items()), null without one. */
async function reactOf(page, id) {
	const m = await itemMap(page).catch(() => new Map())
	return m.get(id)?.data?.react ?? null
}

/** votes().mine of a page (job 183), null while the hook is missing. */
async function mineOf(page) {
	const v = await K.votes(page).catch(() => null)
	return v && v !== 'missing' && v.mine && typeof v.mine === 'object' ? v.mine : null
}

/** Client point of a world point on a page. */
const at = (page, x, y) => K.w2s(page, x, y)

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })

export const E62 = {
	id: 'E62',
	title: 'Emoji-Reaktionen an Notizen (Job 172): alice reagiert über die Leiste mit 👍, alle sehen 👍 1 in ≤ 3 s; Gina tippt 👍 (2) und ersetzt über den Knopf durch ❤️; alice sieht beim Zeigen „Alice Adler (you)“; carol (Abstimmen ohne Sitzung) wählt über „More…“ mit der Suche 🚀; bob (Ansehen) hat keinen Knopf und sein Klick ändert nichts; Strg+Z ändert keine Reaktion, ein Duplikat hat keine Zeile, Löschen + Strg+Z bringt A mit denselben Reaktionen zurück; (Job 183) Tina (Tablet, Abstimm-Link) hat an B ohne Reaktion den Knopf, ihr Tipp darauf öffnet die Auswahl und ist keine Stimme, ein Tipp auf B stimmt ab, unter 30 % kein Knopf',
	async run(t, world) {
		const board = await world.board('E62 Reaktionen')
		await shareWith(board, [{ kind: 'user', id: 'carol', role: 'vote' }, { kind: 'user', id: 'bob', role: 'view' }])
		const L = await linkToken(board)
		const A = ulid()
		const B = ulid()
		const res = await seedOps('alice', board, [put.sticky(A, { x: 0, y: 0, w: 200, h: 200, data: { text: 'A' } }), put.sticky(B, { x: 400, y: 0, w: 200, h: 200, data: { text: 'B' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notizen A und B gesät', res)
		const a = await world.actor('alice-react', { user: 'alice' })
		const g = await world.actor('gina-react')
		const c = await world.actor('carol-react', { user: 'carol' })
		const b = await world.actor('bob-react', { user: 'bob' })
		const all = [a, g, c, b]
		const pages = all.map((x) => x.page)
		const [pa, pg, pc, pb] = pages
		try {
			for (const x of [a, c, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			await joinAsGuest(g, L, 'Gina', board)
			const modes = await Promise.all(pages.map((p) => K.state(p).then((s) => s.uiMode ?? null).catch(() => null)))
			t.must(same(modes, ['edit', 'edit', 'view', 'view']), '[D] Vorbedingung: alice und Gina im Modus edit, carol (Abstimmen ohne Sitzung) und bob im Modus view', modes)
			// alice's one undo step: B one unit to the right
			const cb = await at(pa, 500, 100)
			await pa.mouse.click(cb.x, cb.y)
			await pa.keyboard.press('ArrowRight')
			t.must(await until(async () => (await itemMap(pa)).get(B)?.x === 401, { timeout: 3000 }), '[C] Vorbedingung: alice hat B mit der Pfeiltaste verschoben (ein Rückgängig-Schritt)', (await itemMap(pa)).get(B))
			await pa.keyboard.press('Escape')

			t.step('(1) alice: A wählen, „Add reaction“ in der Leiste → 👍')
			const ca = await at(pa, 100, 100)
			await pa.mouse.click(ca.x, ca.y)
			const bar = pa.locator('[data-knorke-action=react]').first()
			t.must(await bar.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (1) die Leiste zeigt „Add reaction“ [data-knorke-action=react]')
			t.check((await bar.getAttribute('aria-label')) === 'Add reaction', '[C] (1) aria-label „Add reaction“', await bar.getAttribute('aria-label'))
			await bar.click()
			t.must(await appears(pa, PICK), '[C] (1) die Schnellreihe [data-knorke-reactions=pick] ist offen')
			const quick = await pa.locator(`${PICK} [data-knorke-react]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-knorke-react')))
			t.check(same(quick, ['1f44d', '2764-fe0f', '1f602', '1f389', '1f914', '1f440', 'more']), '[C] (1) 👍 ❤️ 😂 🎉 🤔 👀 und „More…“ in dieser Reihenfolge', quick)
			await pa.locator(`${PICK} [data-knorke-react="${THUMBS}"]`).first().click()
			t.check(await until(async () => (await pa.locator(PICK).count()) === 0, { timeout: 2000 }), '[C] (1) die Wahl schließt die Schnellreihe')
			t.check(await everyoneSees(pages, A, [[THUMBS, 1]]), '[S] (1) alle (alice, Gina, carol, bob) sehen 👍 1 an A in ≤ 3 s', await Promise.all(pages.map((p) => rowOf(p, A))))
			t.check((await rowOf(pa, A))?.shown?.[0]?.[2] === true, '[S] (1) bei alice ist 👍 die eigene (mine)', await rowOf(pa, A))
			t.check((await rowOf(pg, A))?.shown?.[0]?.[2] === false, '[S] (1) bei Gina ist 👍 nicht die eigene', await rowOf(pg, A))
			await pa.keyboard.press('Escape')

			t.step('(2) Gina tippt 👍 und ersetzt es über den Knopf durch ❤️; alice zeigt auf 👍')
			const gp = await at(pg, PILL(0), ROW_Y)
			await pg.mouse.click(gp.x, gp.y)
			t.check(await everyoneSees(pages, A, [[THUMBS, 2]]), '[S] (2) alle sehen 👍 2', await Promise.all(pages.map((p) => rowOf(p, A))))
			t.check((await rowOf(pg, A))?.shown?.[0]?.[2] === true, '[S] (2) bei Gina ist 👍 jetzt die eigene', await rowOf(pg, A))
			const ga = await at(pg, 100, 100)
			await pg.mouse.move(ga.x, ga.y)
			const gb = await at(pg, BUTTON(1), ROW_Y)
			await pg.mouse.move(gb.x, gb.y, { steps: 4 })
			t.check((await rowOf(pg, A))?.add === true, '[S] (2) Gina: der Knopf am Ende der Zeile', await rowOf(pg, A))
			await pg.mouse.click(gb.x, gb.y)
			t.must(await appears(pg, PICK), '[C] (2) Gina: die Schnellreihe am Knopf ist offen')
			t.check((await pg.locator(`${PICK} [data-knorke-react="${THUMBS}"]`).first().getAttribute('aria-pressed')) === 'true', '[C] (2) Gina: ihr 👍 ist aria-pressed="true"')
			await pg.locator(`${PICK} [data-knorke-react="${HEART}"]`).first().click()
			t.check(await everyoneSees(pages, A, [[THUMBS, 1], [HEART, 1]]), '[S] (2) alle sehen 👍 1, ❤️ 1 (das andere Emoji ersetzt ihres)', await Promise.all(pages.map((p) => rowOf(p, A))))
			const ap = await at(pa, PILL(0), ROW_Y)
			await pa.mouse.move(ap.x - 6, ap.y)
			await pa.mouse.move(ap.x, ap.y, { steps: 3 })
			t.must(await appears(pa, NAMES, 3000), '[C] (2) alice: beim Zeigen auf 👍 erscheint [data-knorke-reactions=names]')
			const names = (await pa.locator(NAMES).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
			t.check(names.includes('Alice Adler (you)'), '[C] (2) alice: dort steht „Alice Adler (you)“', names)
			const away = await at(pa, -300, 400)
			await pa.mouse.move(away.x, away.y, { steps: 3 })
			t.check(await until(async () => (await pa.locator(NAMES).count()) === 0, { timeout: 2000 }), '[C] (2) alice: weg von der Pille verschwinden die Namen')

			t.step('(3) carol: Knopf → „More…“ → Suche „rocket“ → 🚀; bob hat keinen Knopf, sein Klick ändert nichts')
			const emojiChunk = []
			pc.on('request', (r) => {
				if (/\/js\/emoji-[A-Za-z0-9_-]+\.chunk\.mjs/.test(r.url())) emojiChunk.push(r.url())
			})
			const cc = await at(pc, 100, 100)
			await pc.mouse.move(cc.x, cc.y)
			const cbtn = await at(pc, BUTTON(2), ROW_Y)
			await pc.mouse.move(cbtn.x, cbtn.y, { steps: 4 })
			t.check((await rowOf(pc, A))?.add === true, '[S] (3) carol (Abstimmen ohne Sitzung): der Knopf ist da', await rowOf(pc, A))
			await pc.mouse.click(cbtn.x, cbtn.y)
			t.must(await appears(pc, PICK), '[C] (3) carol: die Schnellreihe ist offen')
			t.check(emojiChunk.length === 0, '[C] (3) vor „More…“ kein Abruf des Emoji-Chunks', emojiChunk)
			await pc.locator(`${PICK} [data-knorke-react=more]`).first().click()
			const search = pc.locator(`${PICK} input`).first()
			t.must(await search.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false), '[C] (3) carol: NcEmojiPicker mit Suchfeld öffnet an derselben Stelle')
			t.check(emojiChunk.length === 1, '[C] (3) „More…“ lädt den Emoji-Chunk einmal nach', emojiChunk)
			await search.fill('rocket')
			const rocket = pc.locator(`${PICK} .emoji-mart-emoji`, { hasText: '🚀' }).first()
			t.must(await rocket.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (3) carol: die Suche „rocket“ zeigt 🚀')
			await rocket.click()
			t.check(await until(async () => (await pc.locator(PICK).count()) === 0, { timeout: 3000 }), '[C] (3) die Wahl schließt die Auswahl')
			t.check(await everyoneSees(pages, A, [[THUMBS, 1], [ROCKET, 1], [HEART, 1]]), '[S] (3) alle sehen 👍 1, 🚀 1, ❤️ 1', await Promise.all(pages.map((p) => rowOf(p, A))))
			const stored = Object.values((await reactOf(pa, A)) ?? {})
			t.check(stored.some((x) => x.e === ROCKET && x.n === 'Carol Clausen'), '[B] (3) gespeichert ist 🚀 mit dem Namen „Carol Clausen“', stored)
			t.check((await rowOf(pb, A))?.add === false, '[S] (3) bob (Ansehen): kein Knopf', await rowOf(pb, A))
			const before = await reactOf(pb, A)
			const bp = await at(pb, PILL(0), ROW_Y)
			await pb.mouse.click(bp.x, bp.y)
			await sleep(1500)
			t.check(same(await reactOf(pb, A), before) && same(await reactOf(pa, A), before), '[C] (3) bobs Klick auf 👍 ändert nichts (1,5 s)', { bob: await reactOf(pb, A), alice: await reactOf(pa, A) })

			t.step('(4) alice: Strg+Z, ein Duplikat, Löschen + Strg+Z')
			const kept = await reactOf(pa, A)
			const rows = await Promise.all(pages.map((p) => rowOf(p, A)))
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await itemMap(pa)).get(B)?.x === 400, { timeout: 3000 }), '[C] (4) Strg+Z nimmt das Verschieben von B zurück', (await itemMap(pa)).get(B))
			await sleep(500)
			t.check(same(await reactOf(pa, A), kept), '[C] (4) Strg+Z ändert keine Reaktion', await reactOf(pa, A))
			await pa.mouse.click(ca.x, ca.y)
			const ids = await idSet(pa)
			await pa.keyboard.press('Control+d')
			const D = await newId(pa, ids, 5000)
			t.must(typeof D === 'string', '[C] (4) Strg+D legt ein Duplikat von A an', D)
			t.check((await reactOf(pa, D)) === null, '[C] (4) das Duplikat trägt kein data.react', (await itemMap(pa)).get(D))
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await rowOf(pa, D)) === null, { timeout: 2000 }), '[S] (4) das Duplikat hat keine Zeile', await rowOf(pa, D))
			// the duplicate lies 20 units right and down, on top: A where D does not cover it
			const free = await at(pa, 10, 10)
			await pa.mouse.click(free.x, free.y)
			t.must(same((await K.selection(pa)) ?? [], [A]), '[D] (4) Vorbedingung: nur A ist gewählt', await K.selection(pa))
			await pa.keyboard.press('Delete')
			t.check(await until(async () => (await Promise.all(pages.map((p) => itemMap(p)))).every((m) => !m.has(A)), { timeout: 4000 }), '[C] (4) A ist bei allen gelöscht')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await Promise.all(pages.map((p) => reactOf(p, A)))).every((r) => same(r, kept)), { timeout: 5000 }), '[C] (4) nach Strg+Z hat A bei allen dieselben Reaktionen (data.react)', await Promise.all(pages.map((p) => reactOf(p, A))))
			const back = await Promise.all(pages.map((p) => until(async () => same(counts(await rowOf(p, A)), counts(rows[0])), { timeout: 3000 })))
			t.check(back.every(Boolean), '[S] (4) und dieselbe Zeile bei allen', await Promise.all(pages.map((p) => rowOf(p, A))))

			t.step('(5) Tina (Tablet) über den Abstimm-Link: der Knopf an jeder Notiz, ihr Tipp darauf öffnet die Auswahl und ist keine Stimme, unter 30 % kein Knopf')
			const vl = await api('alice', 'POST', `/api/v1/boards/${board}/votelink`, {})
			t.must(vl.status === 200 && typeof vl.data?.link?.token === 'string', '[B] (5) Vorbedingung: Abstimm-Link über Route 17 → 200', `${vl.status} ${vl.text.slice(0, 160)}`)
			const tina = await world.actor('tina-react', { touch: true })
			all.push(tina)
			const pt = tina.page
			await joinAsGuest(tina, vl.data.link.token, 'Tina', board, TCAM)
			const ts = await K.state(pt)
			t.must(ts.mode === 'guest' && ts.role === 'vote' && ts.uiMode === 'view', '[D] (5) Vorbedingung: Tina ist Gast mit der Rolle vote im Modus view (keine Abstimmung)', ts)
			const tb = await until(async () => {
				const r = await rowOf(pt, B)
				return r && r.shown.length === 0 && r.add === true ? r : null
			}, { timeout: 3000 })
			t.check(!!tb, '[S] (5) Tina (Ansehen): B ohne Reaktion hat den Knopf (shown [], add true)', (await K.scene(pt).catch(() => null))?.reactions)
			const off = await at(pc, -300, 400)
			await pc.mouse.move(off.x, off.y, { steps: 3 })
			t.check(await until(async () => (await rowOf(pc, B)) === null, { timeout: 2000 }), '[S] (5) carol (Desktop, Maus neben den Notizen): B hat keine Zeile', await rowOf(pc, B))
			const vs = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
			t.must(vs.status === 200 && vs.data?.board?.meta?.vote?.state === 'open', '[B] (5) Vorbedingung: alice startet eine Abstimmung über Notizen (Route 22) → 200', `${vs.status} ${vs.text.slice(0, 160)}`)
			t.must(await until(async () => (await K.state(pt)).uiMode === 'vote', { timeout: 5000 }), '[C] (5) Tina ist im Modus vote', await K.state(pt))
			// the tablet fits the vote area once at the session start: wait until its camera rests
			await sleep(600)
			let cam = null
			await until(async () => {
				const c = await K.camera(pt)
				const still = cam !== null && same(c, cam)
				cam = c
				return still
			}, { timeout: 5000, every: 250 })
			t.check((await rowOf(pt, B))?.add === true, '[S] (5) Tina (Abstimmen): B hat den Knopf', await rowOf(pt, B))
			const tbtn = await at(pt, 400 + BUTTON(0), ROW_Y)
			await pt.touchscreen.tap(tbtn.x, tbtn.y)
			t.must(await appears(pt, PICK), '[C] (5) Tinas Tipp auf Bs Knopf öffnet [data-knorke-reactions=pick]')
			await pt.locator(`${PICK} [data-knorke-react="${THUMBS}"]`).first().tap()
			t.check(await everyoneSees([pa], B, [[THUMBS, 1]]), '[S] (5) alice sieht 👍 1 an B in ≤ 3 s', await rowOf(pa, B))
			const mine = await mineOf(pt)
			t.check(mine !== null && !(B in mine), '[C] (5) der Tipp auf den Knopf ist keine Stimme: Tinas votes().mine ohne B', await K.votes(pt))
			const tbody = await at(pt, 500, 100)
			await pt.touchscreen.tap(tbody.x, tbody.y)
			t.check(await until(async () => same(await mineOf(pt), { [B]: 1 }), { timeout: 5000 }), '[C] (5) Tinas Tipp auf die Fläche von B: votes().mine {B: 1}', await K.votes(pt))
			const zoomOut = pt.locator('.knorke-zoom [aria-label="Zoom out"]').first()
			for (let i = 0; i < 16; i++) {
				const c = await K.camera(pt)
				if (c && c.scale < 0.3) break
				await zoomOut.tap()
				await sleep(250)
			}
			const low = await until(async () => {
				const c = await K.camera(pt)
				return c && c.scale < 0.3 ? c : null
			}, { timeout: 3000 })
			t.must(low, '[D] (5) Vorbedingung: Tina hat mit „Zoom out“ unter 30 % gezoomt', await K.camera(pt))
			t.check(await until(async () => same((await K.scene(pt))?.reactions, []), { timeout: 3000 }), '[S] (5) unter 30 % hat Tina weder Zeile noch Knopf (scene().reactions [])', (await K.scene(pt).catch(() => null))?.reactions)
		} finally {
			for (const x of all.reverse()) await world.drop(x)
		}
	},
}
