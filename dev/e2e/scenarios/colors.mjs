/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Colour picker in the context bar (factory job 135).
 *
 * E46 alice's own board, bob through the edit link (an account, link
 *   member), both on the desktop (1440 × 900) in Chromium. Notes A (0, 0,
 *   #a2d9fe) and B (300, 0, #faea89; job 227: tones of the one palette), a frame F (0, 500, 600 × 400,
 *   #ffffff). Steps:
 *   (1) alice selects A and clicks the fill toggle [data-knorke-section=fill]
 *       (its dot [data-knorke-fill-current] carries #a2d9fe): the panel
 *       [data-knorke-panel=fill] opens; in input[data-knorke-hex=style.fill]
 *       she types #1f3a5f and presses Enter: A's fill in window.__knorke and
 *       at the server is #1f3a5f, the focus stays in the field;
 *   (2) Backspace in the field shortens the code and deletes no item (A
 *       stays locally and at the server);
 *   (3) "zz" and Enter: the field carries aria-invalid="true", A's fill
 *       stays #1f3a5f;
 *   (4) bob selects B and opens its fill toggle: the row
 *       [data-knorke-board-colors] offers #1f3a5f; a click on it colours B
 *       (bob's items() and the server);
 *   (5) alice selects F alone (a click on its title band), opens the fill
 *       toggle and sets #ff8800 through the system picker
 *       input[type=color][data-knorke-system-color=style.fill]
 *       (locator.fill: input and change): F's fill is #ff8800 locally and at
 *       the server, unchanged (no nearest frame colour).
 *   Own board, no instance setting: before E09, directly after E45. Flake
 *   gate: --only E46 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection), [C] shell and session (bar, panel, field, the other client),
 * [B] stored server state, [D] a harness precondition. Waiting polls from
 * Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, waitReady, until, selectItem, settle, centerOf } from '../lib/harness.mjs'

/** The edit link of a board (route 9 as alice). */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** An account opens /p/<token> (becomes a link member) and lands in the board. */
async function joinAsMember(actor, token) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await waitReady(actor.page, 30000)
}

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })

/** The fill of `id` in the page's items() (window.__knorke). */
const fillIn = async (page, id) => (await itemMap(page)).get(id)?.style?.fill ?? null

/** Is the canvas the element at this client point (no bar over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/** Closes the one-time privacy card ([data-knorke=privacy-info]) when it is shown. */
async function closePrivacyCard(page) {
	const close = page.locator('[data-knorke=privacy-info] [data-knorke-action=privacy-close]').first()
	if (await until(() => close.isVisible().catch(() => false), { timeout: 1500 })) await close.click()
	await until(async () => (await page.locator('[data-knorke=privacy-info]').count()) === 0, { timeout: 2000 })
}

/** Same ids, any order. */
function sameIds(a, b) {
	return Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x))
}

const HEX = 'input[data-knorke-hex="style.fill"]'
const SYSTEM = 'input[data-knorke-system-color="style.fill"]'
// job 230: the colour dot opens the colour panel on its tab "Fill"; the hex row lies behind "Custom color…"
const FILL_TOGGLE = '.knorke-contextbar [data-knorke-section=color]'
const CUSTOM = '.knorke-contextbar__panel [data-knorke-action=custom-color]'

export const E46 = {
	id: 'E46',
	title: 'Farbwähler (Job 135): Füllknopf mit Farbpunkt öffnet das Panel, #1f3a5f + Enter färbt die Notiz, Rücktaste im Feld löscht nichts, „zz“ markiert das Feld rot, bob findet #1f3a5f unter „On this board“ und färbt seine Notiz, ein Frame nimmt #ff8800 aus dem Systemwähler unverändert',
	async run(t, world) {
		const board = await world.board('E46 Farbwähler')
		const [A, B, F] = [ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: 0, y: 0, data: { text: 'A' }, style: { fill: '#a2d9fe' } }),
			put.sticky(B, { x: 300, y: 0, data: { text: 'B' }, style: { fill: '#faea89' } }),
			put.frame(F, { x: 0, y: 500, w: 600, h: 400, data: { title: 'F' }, style: { fill: '#ffffff' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notizen A, B und Frame F', res)
		const L = await linkToken(board)
		const alice = await world.actor('alice-farben', { user: 'alice' })
		const bob = await world.actor('bob-farben', { user: 'bob' })
		const pa = alice.page
		const pb = bob.page
		try {
			await openBoard(alice, board)
			await joinAsMember(bob, L)
			for (const p of [pa, pb]) {
				// the one-time privacy card of a link member lies over the canvas
				await closePrivacyCard(p)
				await p.locator(CANVAS).first().focus()
				await p.keyboard.press('Shift+Digit1')
			}
			await settle([pa, pb])
			const bobState = await K.state(pb)
			t.must(bobState.role === 'edit', '[D] bob ist über den Bearbeitungslink im Board (edit)', bobState)
			await steps(t, pa, pb, board, { A, B, F })
		} finally {
			await world.drop(bob)
			await world.drop(alice)
		}
	},
}

/** Steps (1)–(5) of E46 (header). */
async function steps(t, pa, pb, board, { A, B, F }) {
	t.step('(1) alice wählt A, öffnet den Füllknopf und tippt #1f3a5f + Enter')
	await selectItem(pa, A)
	t.must(sameIds((await K.selection(pa)) || [], [A]), '[S] (1) A ist gewählt', await K.selection(pa))
	t.must(await appears(pa, FILL_TOGGLE), '[C] (1) der Füllknopf steht in der Leiste')
	const dot = await pa.locator(`${FILL_TOGGLE} [data-knorke-fill-current]`).first().getAttribute('data-knorke-fill-current').catch(() => null)
	t.check(dot === '#a2d9fe', '[C] (1) der Farbpunkt des Füllknopfs trägt #a2d9fe', dot)
	await pa.locator(FILL_TOGGLE).first().click()
	t.must(await appears(pa, '[data-knorke-panel=color] [data-knorke-tab=fill][aria-selected=true]'), '[C] (1) der Farbpunkt öffnet das Panel [data-knorke-panel=color] auf dem Reiter „Fill“')
	t.must(await appears(pa, CUSTOM), '[C] (1) „Custom color…“ steht im Panel')
	await pa.locator(CUSTOM).first().click()
	const field = pa.locator(HEX).first()
	t.must(await appears(pa, HEX), `[C] (1) das Feld ${HEX} ist sichtbar`)
	t.check((await field.inputValue()) === 'a2d9fe', '[C] (1) das Feld zeigt die Farbe ohne #', await field.inputValue())
	await field.click()
	await pa.keyboard.press('Control+a')
	await pa.keyboard.type('#1f3a5f', { delay: 10 })
	await pa.keyboard.press('Enter')
	t.check(await until(async () => (await fillIn(pa, A)) === '#1f3a5f', { timeout: 3000 }), '[C] (1) window.__knorke: A hat die Füllung #1f3a5f', await fillIn(pa, A))
	await settle([pa, pb])
	t.check((await serverMap('alice', board)).get(A)?.style?.fill === '#1f3a5f', '[B] (1) beim Server hat A die Füllung #1f3a5f', (await serverMap('alice', board)).get(A)?.style)
	const focused = await pa.evaluate(() => document.activeElement?.getAttribute?.('data-knorke-hex') ?? null)
	t.check(focused === 'style.fill', '[C] (1) der Fokus bleibt im Feld', focused)

	t.step('(2) Rücktaste im Feld')
	await pa.keyboard.press('Backspace')
	await pa.keyboard.press('Backspace')
	await settle([pa, pb])
	t.check((await field.inputValue()) === '1f3a', '[C] (2) die Rücktaste kürzt nur den Code im Feld', await field.inputValue())
	t.check((await itemMap(pa)).has(A) && sameIds((await K.selection(pa)) || [], [A]), '[C] (2) A ist noch da und gewählt', await K.selection(pa))
	t.check((await serverMap('alice', board)).has(A), '[B] (2) beim Server ist A nicht gelöscht')

	t.step('(3) „zz“ + Enter')
	await pa.keyboard.press('Control+a')
	await pa.keyboard.type('zz', { delay: 10 })
	await pa.keyboard.press('Enter')
	t.check(await until(async () => (await field.getAttribute('aria-invalid')) === 'true', { timeout: 2000 }), '[C] (3) das Feld trägt aria-invalid="true"', await field.getAttribute('aria-invalid'))
	await settle([pa, pb])
	t.check((await fillIn(pa, A)) === '#1f3a5f', '[C] (3) A behält die Füllung #1f3a5f', await fillIn(pa, A))
	t.check((await serverMap('alice', board)).get(A)?.style?.fill === '#1f3a5f', '[B] (3) beim Server behält A #1f3a5f')
	await pa.keyboard.type('1', { delay: 10 })
	t.check(await until(async () => (await field.getAttribute('aria-invalid')) === null, { timeout: 2000 }), '[C] (3) die nächste Eingabe hebt die Markierung auf', await field.getAttribute('aria-invalid'))
	await pa.keyboard.press('Escape')
	t.check(await until(async () => (await pa.locator('[data-knorke-panel]').count()) === 0, { timeout: 2000 }), '[C] (3) Esc im Feld schließt das Panel')

	t.step('(4) bob wählt B und färbt sie über „On this board“')
	t.must(await until(async () => (await fillIn(pb, A)) === '#1f3a5f', { timeout: 5000 }), '[D] bob sieht A in #1f3a5f', await fillIn(pb, A))
	const cb = await centerOf(pb, B)
	t.must(await canvasAt(pb, cb.x, cb.y), '[D] (4) die Mitte von B liegt bei bob frei auf der Leinwand', cb)
	await selectItem(pb, B)
	t.must(sameIds((await K.selection(pb)) || [], [B]), '[S] (4) bob hat B gewählt', await K.selection(pb))
	t.must(await appears(pb, FILL_TOGGLE), '[C] (4) bobs Füllknopf steht in der Leiste')
	await pb.locator(FILL_TOGGLE).first().click()
	const offer = pb.locator('[data-knorke-board-colors] [data-knorke-value="#1f3a5f"]').first()
	t.check(await until(() => offer.isVisible().catch(() => false), { timeout: 3000 }), '[C] (4) [data-knorke-board-colors] bietet #1f3a5f an')
	await offer.click()
	t.check(await until(async () => (await fillIn(pb, B)) === '#1f3a5f', { timeout: 3000 }), '[C] (4) ein Klick färbt B bei bob in #1f3a5f', await fillIn(pb, B))
	await settle([pa, pb])
	t.check((await serverMap('alice', board)).get(B)?.style?.fill === '#1f3a5f', '[B] (4) beim Server hat B die Füllung #1f3a5f', (await serverMap('alice', board)).get(B)?.style)

	t.step('(5) alice wählt F allein und setzt #ff8800 über den Systemwähler')
	const title = await K.w2s(pa, 30, 492)
	t.must(await canvasAt(pa, title.x, title.y), '[D] (5) der Titel von F liegt frei auf der Leinwand', title)
	await pa.mouse.click(title.x, title.y)
	t.must(await until(async () => sameIds((await K.selection(pa)) || [], [F]), { timeout: 2000 }), '[S] (5) ein Klick auf den Titel wählt F allein', await K.selection(pa))
	t.must(await appears(pa, FILL_TOGGLE), '[C] (5) der Füllknopf des Frames steht in der Leiste')
	await pa.locator(FILL_TOGGLE).first().click()
	t.must(await appears(pa, CUSTOM), '[C] (5) „Custom color…“ steht im Panel')
	await pa.locator(CUSTOM).first().click()
	t.must(await appears(pa, SYSTEM), `[C] (5) der Systemwähler ${SYSTEM} ist sichtbar`)
	await pa.locator(SYSTEM).first().fill('#ff8800')
	t.check(await until(async () => (await fillIn(pa, F)) === '#ff8800', { timeout: 3000 }), '[C] (5) window.__knorke: F hat die Füllung #ff8800', await fillIn(pa, F))
	await settle([pa, pb])
	t.check((await serverMap('alice', board)).get(F)?.style?.fill === '#ff8800', '[B] (5) beim Server hat F die Füllung #ff8800 (unverändert, keine nächste Frame-Farbe)', (await serverMap('alice', board)).get(F)?.style)
}
