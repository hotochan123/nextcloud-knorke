/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Tags on notes (factory job 191, AK9).
 *
 * E75 alice (owner) and bob (guest of the edit link), Chromium, both with the
 * same camera (CAM, 100 %), on a board of their own with the notes N1 at
 * (0, 0), N2 at (300, 0) and N3 at (0, 300), each 200 × 200; N3 carries the
 * eight tags "Tagname Nummer 1" … "8" (seeded through route 44 and a put).
 * Steps:
 *   (a) alice selects N1 and N2, "Tags" of the context bar
 *       ([data-knorke-action=tags]) opens the panel with the search field
 *       focused; she types "Kosten" and presses Enter: the tag is created
 *       (meta.tags) and both notes get it; bob sees the labels at the latest
 *       3 s after the Enter (data.tags and scene().tags); the field is empty
 *       and the panel stays; Esc closes it; Ctrl+Z takes the tag off both
 *       notes and out of the list (job 206: creating is one undo step),
 *       Ctrl+Shift+Z brings both back (at bob too); then alice's click on
 *       the tag's box in the panel takes it off both notes, the tag stays
 *       in the list;
 *   (b) bob selects N1, opens "Tags", the pencil of "Kosten": a colour and
 *       the name "Budget" (Enter); alice sees both in meta.tags;
 *   (c) N3 shows one label and "+7" (scene().tags); alice's click on "+7"
 *       lists all eight tags ([data-knorke-tag-list]) and selects nothing;
 *   (e) alice ticks "Budget" on N1 in the panel, copies N1 (Ctrl+C) and
 *       pastes it into a second board (Ctrl+V in a second tab): the second
 *       board gets a tag "Budget" in the same colour with a new id, the copy
 *       carries it;
 *   (d) alice starts a vote (route 22), is in mode vote and filters by
 *       "Budget" ("⋯" → "Filter by tags…"): scene().tagFilter fades N2 and
 *       N3, the chip [data-knorke-tag-filter] names "Budget"; at bob nothing
 *       is faded; "Clear filter" ends it; the vote ends (route 23);
 *   (f) bob deletes "Budget" (pencil, "Delete tag", no question since job
 *       206): at alice the tag leaves meta.tags and N1 shows no label any
 *       more; bob's Ctrl+Z brings it back with its id, name and colour, and
 *       alice sees N1's label again at the latest 3 s after it;
 *   (g) job 213: alice opens the second board in a laptop window (1366 ×
 *       768) with the copy low on it (its top LOW px below the canvas
 *       corner): "Tags" opens the list below the button; the pencil of
 *       "Budget" opens the editor, which would not fit below the button:
 *       the panel, "Save", "Cancel" and "Delete tag" lie inside the board,
 *       also while the window is SHORT (1366 × 500, like a screen keyboard);
 *       after "Cancel" and after typing "zz" the panel stays inside the
 *       board, above the button, the focus in the search field.
 * (e) runs before (d): copying needs mode edit.
 * Own boards, no instance setting: directly after E74, before E09. Flake
 * gate: --only E75 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (labels, "+n"), [C] shell and session (panels, ops, undo, filter), [B] the
 * server, [D] a harness precondition. Waiting polls from Node with until()
 * (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, APP, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, settle, sleep, itemMap, idSet, serverMap, field, action } from '../lib/harness.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'

/** The camera both open with: world (0, 0) 300 px right of and 150 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -150, scale: 1 })
/** AK9 (a): bob sees the labels at the latest this long after alice's Enter. */
const SEEN_MS = 3000
/** The names of N3's eight tags. */
export const EIGHT = Object.freeze(Array.from({ length: 8 }, (_, i) => `Tagname Nummer ${i + 1}`))
/**
 * N3's "+7" chip in the note's own coordinates (src/scene/nodes/tags.js
 * tagRowPlan of a 200 × 200 note with EIGHT: one label of 120, the chip at
 * x 132–160, y 170–192; dev/e2e/tags.test.mjs recomputes it from src).
 */
export const MORE = Object.freeze({ x: 146, y: 181, n: 7, shown: 1 })
/** (g) Job 213: the laptop window of the bug, and how far below the canvas corner the copy's top sits. */
const LAPTOP = Object.freeze({ width: 1366, height: 768 })
const LOW = 575
/** (g) The window got lower while the editor is open (a screen keyboard, a rotated tablet). */
const SHORT = Object.freeze({ width: 1366, height: 500 })
/** The colour bob gives the tag (TAG_COLORS[7], job 227: Purple's strong tone). */
const BLUE = '#9550bb'
const PANEL = '[data-knorke-tag-panel=tag]'

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
const at = (page, x, y) => K.w2s(page, x, y)

/** The tag list of the board as a page knows it (meta.tags). */
const tagsOf = async (page) => {
	const m = await K.meta(page)
	return Array.isArray(m?.tags) ? m.tags : []
}

/** scene().tags of a page by note id. */
const rowsOf = async (page) => new Map(((await K.scene(page))?.tags ?? []).map((r) => [r.id, r]))

/** Is a locator visible (false on any error)? */
const visible = (loc) => loc.isVisible().catch(() => false)

/** Clicks a note's centre; with shift it joins the selection. */
async function clickNote(page, id, x, y, shift = false) {
	const p = await at(page, x + 100, y + 100)
	if (shift) await page.keyboard.down('Shift')
	await page.mouse.click(p.x, p.y)
	if (shift) await page.keyboard.up('Shift')
	return until(async () => ((await K.selection(page)) ?? []).includes(id), { timeout: 2000 })
}

/**
 * (g) The client boxes of the tag panel, its board (the parent), the
 * editor's three buttons and the "Tags" button; null for what is not there.
 */
const panelBoxes = (page) => page.evaluate((sel) => {
	const box = (el) => {
		if (!el) return null
		const r = el.getBoundingClientRect()
		return { x: r.left, y: r.top, w: r.width, h: r.height }
	}
	const panel = document.querySelector(sel)
	const tags = [...document.querySelectorAll('[data-knorke-action=tags]')].find((el) => el.offsetParent !== null)
	return {
		panel: box(panel),
		board: box(panel?.parentElement),
		save: box(panel?.querySelector('[data-knorke-tag-save]')),
		cancel: box(panel?.querySelector('[data-knorke-tag-cancel]')),
		del: box(panel?.querySelector('[data-knorke-tag-delete]')),
		tags: box(tags),
	}
}, PANEL)

/** (g) Does box a lie inside box b (1 px of rounding)? */
const inside = (a, b) => !!a && !!b && a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1

/** Opens the tag panel through the context bar; true when it is there. */
async function openTags(page) {
	await page.locator('[data-knorke-action=tags]:visible').first().click({ timeout: 5000 })
	return until(() => visible(page.locator(PANEL).first()), { timeout: 3000 })
}

export const E75 = {
	id: 'E75',
	title: 'Tags an Notizen (Job 191): alice taggt zwei Notizen per Enter mit „Kosten“, bob sieht die Etiketten ≤ 3 s, Strg+Z nimmt sie und den Tag ab, Strg+Umschalt+Z bringt beides zurück (Job 206); bob benennt ihn in „Budget“ um und färbt ihn um, alice sieht beides; „+7“ einer Notiz mit 8 Tags listet alle; eine Kopie in ein zweites Board legt den Tag dort an; alice filtert beim Abstimmen, faded stimmt, bei bob ist nichts blass; bob löscht den Tag ohne Rückfrage, bei alice verschwinden die Etiketten, bobs Strg+Z bringt sie zurück (Job 206); am Laptop (1366 × 768) bleibt der Tag-Editor einer tief stehenden Notiz ganz im Board (Job 213)',
	async run(t, world) {
		const board = await world.board('E75 Tags')
		const board2 = await world.board('E75 Ziel')
		const L = await linkToken(board)
		const N1 = ulid()
		const N2 = ulid()
		const N3 = ulid()
		const eight = EIGHT.map((name) => ({ id: ulid(), name, color: '#43a047' }))
		const seeded = await api('alice', 'PUT', `/api/v1/boards/${board}/tags`, { action: 'add', tags: eight })
		t.must(seeded.status === 200 && seeded.data?.board?.meta?.tags?.length === 8, '[B] Vorbedingung: Route 44 legt die acht Tags an', seeded.status)
		const res = await seedOps('alice', board, [
			put.sticky(N1, { x: 0, y: 0, data: { text: 'Eins' }, style: { fill: '#fff6b6' } }),
			put.sticky(N2, { x: 300, y: 0, data: { text: 'Zwei' }, style: { fill: '#fff6b6' } }),
			put.sticky(N3, { x: 0, y: 300, data: { text: 'Acht', tags: eight.map((x) => x.id) }, style: { fill: '#fff6b6' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[D] Vorbedingung: drei Notizen gesät', res)
		const a = await world.actor('alice-tags', { user: 'alice' })
		const b = await world.actor('bob-tags')
		const pa = a.page
		const pb = b.page
		let p2 = null
		let p3 = null
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			await joinAsGuest(b, L, 'Bob Gast', board)
			const sb = await K.state(pb)
			t.must(sb.mode === 'guest' && sb.role === 'edit' && sb.uiMode === 'edit', '[D] Vorbedingung: bob ist Gast des Bearbeiten-Links im Modus edit', sb)
			t.must(await until(async () => (await itemMap(pb)).has(N3) && (await tagsOf(pb)).length === 8, { timeout: 8000 }), '[D] Vorbedingung: beide sehen die Notizen und die acht Tags')

			t.step('(a) alice taggt N1 und N2 per Enter mit „Kosten“, bob sieht es, Strg+Z und Strg+Umschalt+Z')
			t.must(await clickNote(pa, N1, 0, 0) && await clickNote(pa, N2, 300, 0, true), '[D] (a) Vorbedingung: alice hat N1 und N2 gewählt', await K.selection(pa))
			t.must(await openTags(pa), '[C] (a) „Tags“ der Kontextleiste öffnet das Tag-Panel')
			t.check(await pa.evaluate(() => document.activeElement?.hasAttribute?.('data-knorke-tag-search') === true), '[C] (a) das Suchfeld hat den Fokus')
			await pa.keyboard.type('Kosten')
			await pa.keyboard.press('Enter')
			const enter = Date.now()
			const K1 = await until(async () => (await tagsOf(pa)).find((x) => x.name === 'Kosten')?.id ?? null, { timeout: 5000 })
			t.must(K1, '[C] (a) Enter legt den Tag „Kosten“ an (meta.tags)', await tagsOf(pa))
			t.check((await tagsOf(pa)).find((x) => x.id === K1)?.color === '#0275a9', '[C] (a) in der ersten freien Farbe (TAG_COLORS[0], job 227)', await tagsOf(pa))
			const both = (m) => JSON.stringify(m.get(N1)?.data?.tags) === JSON.stringify([K1]) && JSON.stringify(m.get(N2)?.data?.tags) === JSON.stringify([K1])
			t.check(await until(async () => both(await itemMap(pa)), { timeout: 5000 }), '[C] (a) beide Notizen tragen den Tag')
			const seen = await until(async () => {
				const rows = await rowsOf(pb)
				const ok = both(await itemMap(pb)) && JSON.stringify(rows.get(N1)?.shown) === JSON.stringify([K1]) && JSON.stringify(rows.get(N2)?.shown) === JSON.stringify([K1])
				return ok ? Date.now() : null
			}, { timeout: SEEN_MS + 3000, every: 50 })
			t.check(seen !== null && seen - enter <= SEEN_MS, `[C] (a) bob sieht die Etiketten spätestens ${SEEN_MS} ms nach dem Enter`, seen === null ? null : seen - enter)
			t.check(await pa.locator('[data-knorke-tag-search]').first().inputValue().catch(() => null) === '', '[C] (a) das Suchfeld ist leer')
			t.check(await visible(pa.locator(PANEL).first()), '[C] (a) das Panel bleibt offen')
			await pa.keyboard.press('Escape')
			t.check(await until(async () => !(await visible(pa.locator(PANEL).first())), { timeout: 2000 }), '[C] (a) Esc schließt das Panel')
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			const none = (m) => !m.get(N1)?.data?.tags && !m.get(N2)?.data?.tags
			const listed = async (page) => (await tagsOf(page)).some((x) => x.id === K1)
			t.check(await until(async () => none(await itemMap(pa)) && none(await itemMap(pb)), { timeout: 5000 }), '[C] (a) Strg+Z nimmt den Tag von beiden Notizen, auch bei bob')
			t.check(await until(async () => !(await listed(pa)) && !(await listed(pb)), { timeout: 5000 }), '[C] (a) Strg+Z nimmt den Tag auch aus der Liste, auch bei bob', await tagsOf(pb))
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+Shift+z')
			t.check(await until(async () => await listed(pa) && await listed(pb), { timeout: 5000 }), '[C] (a) Strg+Umschalt+Z bringt den Tag zurück in die Liste, auch bei bob', await tagsOf(pb))
			t.check((await tagsOf(pa)).find((x) => x.id === K1)?.name === 'Kosten' && (await tagsOf(pa)).find((x) => x.id === K1)?.color === '#0275a9', '[C] (a) mit gleicher ID, gleichem Namen und gleicher Farbe', await tagsOf(pa))
			t.check(await until(async () => both(await itemMap(pa)) && both(await itemMap(pb)), { timeout: 5000 }), '[C] (a) und an beide Notizen, auch bei bob')
			await settle([pa, pb])
			t.must(JSON.stringify([...((await K.selection(pa)) ?? [])].sort()) === JSON.stringify([N1, N2].sort()) && await openTags(pa), '[D] (a) Vorbedingung: N1 und N2 gewählt, Tag-Panel offen', await K.selection(pa))
			await pa.locator(`${PANEL} [data-knorke-tag-row="${K1}"] [data-knorke-tag-check]`).first().click({ timeout: 3000 })
			t.check(await until(async () => none(await itemMap(pa)) && none(await itemMap(pb)), { timeout: 5000 }), '[C] (a) ein Klick auf das Kästchen nimmt den Tag von beiden Notizen, auch bei bob')
			await pa.keyboard.press('Escape')
			await settle([pa, pb])
			t.check(await listed(pa) && await listed(pb), '[C] (a) der Tag bleibt dabei in der Liste')
			t.check(none(await serverMap('alice', board)), '[B] (a) beim Server: keine Notiz trägt den Tag mehr')

			t.step('(b) bob benennt den Tag in „Budget“ um und färbt ihn um')
			t.must(await clickNote(pb, N1, 0, 0), '[D] (b) Vorbedingung: bob hat N1 gewählt')
			t.must(await openTags(pb), '[C] (b) bobs Tag-Panel öffnet sich')
			await pb.locator(`${PANEL} [data-knorke-tag-row="${K1}"] [data-knorke-tag-edit]`).first().click({ timeout: 3000 })
			t.must(await until(() => visible(pb.locator('[data-knorke-tag-name]').first()), { timeout: 2000 }), '[C] (b) der Stift öffnet Name und Farben')
			await pb.locator(`[data-knorke-tag-color="${BLUE}"]`).first().click({ timeout: 3000 })
			t.check(await until(async () => (await tagsOf(pa)).find((x) => x.id === K1)?.color === BLUE, { timeout: 5000 }), '[C] (b) alice sieht die neue Farbe', await tagsOf(pa))
			await pb.locator('[data-knorke-tag-name]').first().fill('Budget')
			await pb.locator('[data-knorke-tag-name]').first().press('Enter')
			t.check(await until(async () => (await tagsOf(pa)).find((x) => x.id === K1)?.name === 'Budget', { timeout: 5000 }), '[C] (b) alice sieht den neuen Namen „Budget“', await tagsOf(pa))
			const stored = (await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)).data?.board?.meta?.tags?.find((x) => x.id === K1)
			t.check(stored?.name === 'Budget' && stored?.color === BLUE, '[B] (b) der Server hat Name und Farbe', stored)
			await pb.keyboard.press('Escape')
			await settle([pa, pb])

			t.step('(c) bei acht Tags listet „+7“ alle')
			const r3 = (await rowsOf(pa)).get(N3)
			t.check(r3?.shown?.length === MORE.shown && r3?.more === MORE.n, '[S] (c) N3 zeigt ein Etikett und „+7“', r3)
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Escape')
			const sel0 = JSON.stringify(await K.selection(pa))
			const chip = await at(pa, 0 + MORE.x, 300 + MORE.y)
			await pa.mouse.click(chip.x, chip.y)
			const LIST = `[data-knorke-tag-list="${N3}"] [data-knorke-tag-list-item]`
			t.check(await until(async () => (await pa.locator(LIST).count()) === 8, { timeout: 3000 }), '[S] (c) ein Klick auf „+7“ öffnet die Liste mit allen acht Tags', await pa.locator(LIST).count())
			const names = await pa.locator(LIST).allTextContents()
			t.check(JSON.stringify(names.map((x) => x.trim())) === JSON.stringify(EIGHT), '[C] (c) in der Reihenfolge der Notiz', names)
			t.check(JSON.stringify(await K.selection(pa)) === sel0, '[S] (c) der Klick wählt nichts aus', await K.selection(pa))
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await pa.locator(LIST).count()) === 0, { timeout: 2000 }), '[C] (c) Esc schließt die Liste')

			t.step('(e) alice gibt N1 „Budget“, kopiert N1 und fügt die Kopie in ein zweites Board ein')
			t.must(await clickNote(pa, N1, 0, 0), '[D] (e) Vorbedingung: alice hat N1 gewählt')
			t.must(await openTags(pa), '[C] (e) das Tag-Panel öffnet sich')
			await pa.locator(`${PANEL} [data-knorke-tag-row="${K1}"] [data-knorke-tag-check]`).first().click({ timeout: 3000 })
			t.check(await until(async () => JSON.stringify((await itemMap(pa)).get(N1)?.data?.tags) === JSON.stringify([K1]), { timeout: 5000 }), '[C] (e) ein Klick auf das Kästchen gibt N1 den Tag')
			await pa.keyboard.press('Escape')
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+c')
			await sleep(300)
			p2 = await a.ctx.newPage()
			p2.on('dialog', (d) => d.accept().catch(() => {}))
			await p2.goto(`${APP}/b/${board2}`, { waitUntil: 'domcontentloaded' })
			await waitReady(p2)
			const before2 = await idSet(p2)
			const z = await K.w2s(p2, 100, 100)
			await p2.mouse.click(z.x, z.y)
			await p2.keyboard.press('Control+v')
			const copy = await until(async () => {
				for (const [id, it] of await itemMap(p2)) if (!before2.has(id) && it.t === 'sticky') return { ...it, id }
				return null
			}, { timeout: 8000 })
			t.must(copy, '[C] (e) Strg+V legt im zweiten Board eine Kopie an')
			const t2 = (await tagsOf(p2)).find((x) => x.name === 'Budget')
			t.check(t2 && t2.color === BLUE && t2.id !== K1, '[C] (e) das zweite Board hat den Tag „Budget“ in derselben Farbe mit neuer ID', await tagsOf(p2))
			t.check(t2 && JSON.stringify(copy.data?.tags) === JSON.stringify([t2.id]), '[C] (e) die Kopie trägt ihn', copy.data)
			await settle([p2])
			const srv2 = [...(await serverMap('alice', board2)).values()].find((it) => it.t === 'sticky')
			t.check(t2 && JSON.stringify(srv2?.data?.tags) === JSON.stringify([t2.id]), '[B] (e) beim Server: die Kopie mit dem Tag des zweiten Boards', srv2?.data)
			await p2.close().catch(() => {})
			p2 = null
			await pa.bringToFront()

			t.step('(d) alice filtert beim Abstimmen nach „Budget“; bei bob ist nichts blass')
			const vs = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
			t.must(vs.status === 200, '[B] (d) Vorbedingung: Route 22 startet die Abstimmung', vs.status)
			t.must(await until(async () => (await K.state(pa)).uiMode === 'vote', { timeout: 8000 }), '[D] (d) Vorbedingung: alice ist im Modus vote', (await K.state(pa)).uiMode)
			await menuAction(pa, 'filter-tags', { menus: BOARD_MENUS })
			const FILTER = '[data-knorke-tag-panel=filter]'
			t.must(await until(() => visible(pa.locator(FILTER).first()), { timeout: 3000 }), '[C] (d) „Filter by tags…“ öffnet das Filter-Panel')
			await pa.locator(`${FILTER} [data-knorke-tag-filter-row="${K1}"] [data-knorke-tag-check]`).first().click({ timeout: 3000 })
			const want = JSON.stringify({ chosen: [K1], faded: [N2, N3].sort() })
			t.check(await until(async () => JSON.stringify((await K.scene(pa)).tagFilter) === want, { timeout: 3000 }), '[S] (d) tagFilter: N2 und N3 sind blass', (await K.scene(pa)).tagFilter)
			t.check(await until(async () => ((await pa.locator('[data-knorke-tag-filter]').first().textContent().catch(() => '')) || '').includes('Budget'), { timeout: 2000 }), '[C] (d) der Chip nennt „Budget“')
			await sleep(1500)
			t.check((await K.scene(pb)).tagFilter === null, '[C] (d) bei bob ist nichts blass', (await K.scene(pb)).tagFilter)
			await pa.keyboard.press('Escape')
			await pa.locator('[data-knorke-action=tag-filter-clear]').first().click({ timeout: 3000 })
			t.check(await until(async () => (await K.scene(pa)).tagFilter === null, { timeout: 2000 }), '[C] (d) „Clear filter“ beendet den Filter')
			const ve = await api('alice', 'PATCH', `/api/v1/boards/${board}/vote`, { action: 'end' })
			t.check(ve.status === 200, '[B] (d) Route 23 beendet die Abstimmung', ve.status)
			t.must(await until(async () => (await K.state(pb)).uiMode === 'edit', { timeout: 8000 }), '[D] (d) bob ist wieder im Modus edit')

			t.step('(f) bob löscht „Budget“ ohne Rückfrage; bei alice verschwinden die Etiketten; bobs Strg+Z bringt sie zurück')
			t.check(JSON.stringify((await rowsOf(pa)).get(N1)?.shown) === JSON.stringify([K1]), '[S] (f) Vorbedingung: N1 zeigt bei alice „Budget“', (await rowsOf(pa)).get(N1))
			t.must(await clickNote(pb, N2, 300, 0), '[D] (f) Vorbedingung: bob hat N2 gewählt')
			t.must(await openTags(pb), '[C] (f) bobs Tag-Panel öffnet sich')
			await pb.locator(`${PANEL} [data-knorke-tag-row="${K1}"] [data-knorke-tag-edit]`).first().click({ timeout: 3000 })
			await pb.locator('[data-knorke-tag-delete]').first().click({ timeout: 3000 })
			t.check(await until(async () => !(await tagsOf(pa)).some((x) => x.id === K1), { timeout: 5000 }), '[C] (f) „Delete tag“ löscht sofort: bei alice ist der Tag aus der Liste')
			t.check(!(await visible(pb.locator('.modal-mask, [data-knorke-dialog]').first())), '[C] (f) keine Rückfrage')
			t.check(await until(async () => !(await rowsOf(pa)).has(N1), { timeout: 3000 }), '[S] (f) N1 zeigt bei alice kein Etikett mehr', (await rowsOf(pa)).get(N1))
			t.check(JSON.stringify((await serverMap('alice', board)).get(N1)?.data?.tags) === JSON.stringify([K1]), '[B] (f) die ID bleibt unsichtbar in der Notiz stehen')
			await pb.keyboard.press('Escape')
			await settle([pa, pb])
			await pb.locator(CANVAS).first().focus()
			await pb.keyboard.press('Control+z')
			const undone = Date.now()
			const back = await until(async () => (JSON.stringify((await rowsOf(pa)).get(N1)?.shown) === JSON.stringify([K1]) ? Date.now() : null), { timeout: SEEN_MS + 3000, every: 50 })
			t.check(back !== null && back - undone <= SEEN_MS, `[S] (f) nach bobs Strg+Z zeigt N1 bei alice spätestens ${SEEN_MS} ms später wieder „Budget“`, back === null ? (await rowsOf(pa)).get(N1) : back - undone)
			const again = (await tagsOf(pa)).find((x) => x.id === K1)
			t.check(again?.name === 'Budget' && again?.color === BLUE, '[C] (f) mit gleicher ID, gleichem Namen und gleicher Farbe', await tagsOf(pa))
			const restored = (await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)).data?.board?.meta?.tags?.find((x) => x.id === K1)
			t.check(restored?.name === 'Budget' && restored?.color === BLUE, '[B] (f) der Server hat den Tag wieder', restored)

			t.step('(g) Job 213: am Laptop (1366 × 768) bleibt der Tag-Editor einer tief stehenden Notiz ganz im Board')
			await storeCamera(pa, board2, { x: copy.x - 300, y: copy.y - LOW, scale: 1 })
			p3 = await a.ctx.newPage()
			p3.on('dialog', (d) => d.accept().catch(() => {}))
			await p3.setViewportSize(LAPTOP)
			await p3.goto(`${APP}/b/${board2}`, { waitUntil: 'domcontentloaded' })
			await waitReady(p3)
			// the browser reports a ResizeObserver loop as an error event of the window
			await p3.evaluate(() => window.addEventListener('error', (e) => { (window.__knorkeE75Errors ??= []).push(String(e?.message ?? e)) }))
			t.must(await clickNote(p3, copy.id, copy.x, copy.y), '[D] (g) Vorbedingung: alice hat die Kopie im zweiten Board gewählt', await K.selection(p3))
			t.must(await openTags(p3), '[C] (g) „Tags“ öffnet das Tag-Panel')
			const below = await until(async () => {
				const b = await panelBoxes(p3)
				return b.tags && b.panel && b.panel.y >= b.tags.y + b.tags.h && inside(b.panel, b.board) ? b : null
			}, { timeout: 3000 })
			t.must(below, '[D] (g) Vorbedingung: die Liste steht ganz im Board unter dem Knopf „Tags“', await panelBoxes(p3))
			await p3.locator(`${PANEL} [data-knorke-tag-row="${t2.id}"] [data-knorke-tag-edit]`).first().click({ timeout: 3000 })
			t.must(await until(() => visible(p3.locator('[data-knorke-tag-name]').first()), { timeout: 2000 }), '[C] (g) der Stift öffnet Name, Farben und Knöpfe')
			const all = (b) => inside(b.panel, b.board) && inside(b.save, b.board) && inside(b.cancel, b.board) && inside(b.del, b.board)
			const ed = await until(async () => {
				const b = await panelBoxes(p3)
				return all(b) ? b : null
			}, { timeout: 3000 })
			const now = ed ?? await panelBoxes(p3)
			t.must(now.panel && below.tags.y + below.tags.h + 6 + now.panel.h > below.board.y + below.board.h, '[D] (g) Vorbedingung: unter dem Knopf ragte der Editor aus dem Board', now)
			t.check(ed !== null, '[C] (g) Panel, „Save“, „Cancel“ und „Delete tag“ liegen ganz im Board', now)
			await p3.setViewportSize(SHORT)
			const short = await until(async () => {
				const b = await panelBoxes(p3)
				return all(b) ? b : null
			}, { timeout: 3000 })
			t.check(short !== null, '[C] (g) wird das Fenster niedriger (1366 × 500), liegen Panel und Knöpfe weiter ganz im Board', await panelBoxes(p3))
			await p3.setViewportSize(LAPTOP)
			t.must(await until(async () => all(await panelBoxes(p3)), { timeout: 3000 }), '[D] (g) Vorbedingung: wieder 1366 × 768, der Editor ganz im Board', await panelBoxes(p3))
			await p3.locator('[data-knorke-tag-cancel]').first().click({ timeout: 3000 })
			const above = (b) => inside(b.panel, b.board) && b.tags && b.panel.y + b.panel.h <= b.tags.y + 1
			const shorter = await until(async () => {
				const b = await panelBoxes(p3)
				return b.del === null && above(b) ? b : null
			}, { timeout: 3000 })
			t.check(shorter !== null, '[C] (g) nach „Cancel“ steht die Liste ganz im Board über dem Knopf „Tags“', await panelBoxes(p3))
			t.check(await p3.evaluate(() => document.activeElement?.hasAttribute?.('data-knorke-tag-search') === true), '[C] (g) nach „Cancel“ hat das Suchfeld den Fokus')
			await p3.keyboard.type('zz')
			await sleep(300)
			const typed = await panelBoxes(p3)
			t.check(above(typed), '[C] (g) nach „zz“ im Suchfeld bleibt das Panel über dem Knopf und im Board', typed)
			t.check(await p3.locator('[data-knorke-tag-search]').first().inputValue().catch(() => null) === 'zz' && await p3.evaluate(() => document.activeElement?.hasAttribute?.('data-knorke-tag-search') === true), '[C] (g) „zz“ steht im Suchfeld, das den Fokus behält')
			await p3.keyboard.press('Escape')
			const errors = await p3.evaluate(() => window.__knorkeE75Errors ?? [])
			t.check(!errors.some((m) => /ResizeObserver/.test(m)), '[C] (g) keine Meldung „ResizeObserver loop …“', errors)
		} finally {
			if (p3) await p3.close().catch(() => {})
			if (p2) await p2.close().catch(() => {})
			await world.drop(b)
			await world.drop(a)
		}
	},
}
