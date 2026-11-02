/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E95 (factory job 230, the redesigned context bar; docs/redesign zuordnung.md
 * "Kontextleiste", "Rechtsklick-Menü"). Own board: notes N1, N2, N3 (N1 and
 * N2 with the tag "A") and a shape S.
 *   (1) mouse, 1280 × 800: a click on N3 – the bar holds exactly the colour
 *       dot, "Add reaction", "Comment", "Tags" and "…", in this order;
 *   (2) the dot opens the panel 'color' on the tab "Fill" (tabs Fill, Text);
 *       the panel overlaps neither the bar nor N3; "Yellow" fills N3,
 *       "Custom color…" shows the hex field, the tab "Text" sets L (32);
 *   (3) S: the tabs Fill, Border, Text and "Change shape" in the bar;
 *   (4) "…" of S: cut, copy, duplicate | front, back | arrange | lock |
 *       delete, "Delete" last in another (reddish) colour;
 *   (4b) by key: Enter on "…" › "Duplicate" gives "…" the focus back, "Arrange…"
 *       puts it into the field X, Esc there back to "…";
 *   (5) Ctrl+A (four items): the chip "4 selected" first, "Align items"
 *       right after it; "Only notes (3)" narrows to the notes; Ctrl+A
 *       again and "A (2)" narrows to N1 and N2;
 *   (6) a right click on N3 (not selected) selects it; its menu holds the
 *       entries of "…" in the same order, the exports before "Delete", which
 *       comes last; on the empty canvas only the wheel, the mass unlocks and
 *       the grid ("Show grid" among them);
 *   (7) "…" › Delete removes S;
 *   (8) dark mode (b): the black swatch keeps its edge #8f9196 on the panel
 *       #2b2c30;
 *   (9) tablet 820 × 1180 with a pen (touch, fine pointer): the bar is 52 px
 *       high, a tap opens "…", its entries are at least 44 px high; a tap
 *       on the dot opens the panel beside the bar, never over it.
 * Flake gate: --only E95 --repeat 3.
 */
import { CANVAS, K, api, centerOf, itemMap, openBoard, put, seedOps, ulid, until } from '../lib/harness.mjs'

const TITLE = 'E95 Kontextleiste'
const VIEW = { width: 1280, height: 800 }
const BAR = '.knorke-contextbar'
const MENUS = '#knorke-menus'
const MENU = '[data-knorke-menu=context]'
/** Rounding of sizes (px). */
const TOL = 0.5

/** Bounding box of the first visible match (null when absent). */
function box(page, sel) {
	return page.evaluate((s) => {
		const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().height > 0)
		if (!el) return null
		const r = el.getBoundingClientRect()
		return { x: r.x, y: r.y, w: r.width, h: r.height }
	}, sel)
}

const apart = (a, b) => !!a && !!b && (a.x + a.w <= b.x + TOL || b.x + b.w <= a.x + TOL || a.y + a.h <= b.y + TOL || b.y + b.h <= a.y + TOL)

/** The bar's own elements in order: section:<name>, action:<name>, menu:selection, chip, count (the panel left out). */
function barOrder(page) {
	return page.evaluate((b) => {
		const bar = document.querySelector(b)
		if (!bar) return null
		const out = []
		for (const el of bar.querySelectorAll('[data-knorke-section], [data-knorke-action], [data-knorke-menu], .knorke-contextbar__count')) {
			if (el.closest('.knorke-contextbar__panel') || el.getBoundingClientRect().height === 0) continue
			if (el.hasAttribute('data-knorke-menu')) out.push('menu:' + el.getAttribute('data-knorke-menu'))
			else if (el.classList.contains('knorke-contextbar__count')) out.push('count')
			else if (el.hasAttribute('data-knorke-section')) out.push('section:' + el.getAttribute('data-knorke-section'))
			else if (el.getAttribute('data-knorke-action') === 'filter') out.push('chip')
			else out.push('action:' + el.getAttribute('data-knorke-action'))
		}
		return out
	}, BAR)
}

/** The entries of the open "…" in order, '|' for a separator. */
function moreOrder(page) {
	return page.evaluate((m) => [...document.querySelectorAll(`${m} [data-knorke-action], ${m} .action-separator, ${m} [role=separator]`)]
		.filter((el) => el.getBoundingClientRect().height > 0 || el.matches('.action-separator, [role=separator]'))
		.map((el) => (el.hasAttribute('data-knorke-action') ? el.getAttribute('data-knorke-action') : '|'))
		.filter((x, i, a) => !(x === '|' && a[i - 1] === '|')), MENUS)
}

/** The entries of the open context menu, in order. */
function menuItems(page) {
	return page.locator(`${MENU} [data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item'))).catch(() => [])
}

/** Opens "…" of the bar (a click). */
async function openMore(page) {
	await page.locator(`${BAR} [data-knorke-menu=selection] button`).first().click()
	return until(async () => (await moreOrder(page)).length > 0, { timeout: 3000 })
}

/** @return {Promise<boolean>} keyTo(name), false when it throws */
const keyToSafe = (keyTo, name) => keyTo(name).catch(() => false)

/** @return {Promise<string[]>} the selection of the page */
const selection = async (page) => [...((await K.selection(page)) || [])].sort()

export const E95 = {
	id: 'E95',
	title: 'Kontextleiste neu (Job 230): Notiz = Farbpunkt, Reaktion, Kommentar, Tags, „…“; Farb-Panel mit Reitern neben der Auswahl, „Custom color…“; „…“ in festen Gruppen mit Delete zuletzt; Chip „4 selected“ grenzt nach Typ und Tag ein; Rechtsklick wählt aus und zeigt dieselben Gruppen; leere Fläche nur Raster und Co.; Schwarz mit Rand im Dunkelmodus; Tablet mit Stift',
	async run(t, world) {
		const B = await world.board(TITLE)
		const tag = { id: ulid(), name: 'A', color: '#0275a9' }
		const seeded = await api('alice', 'PUT', `/api/v1/boards/${B}/tags`, { action: 'add', tags: [tag] })
		t.must(seeded.status === 200, '[B] Vorbedingung: Route 44 legt den Tag „A“ an', seeded.status)
		const [N1, N2, N3, S] = [ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', B, [
			put.sticky(N1, { x: 0, y: 0, data: { text: 'N1', tags: [tag.id] }, style: { fill: '#a2d9fe' } }),
			put.sticky(N2, { x: 300, y: 0, data: { text: 'N2', tags: [tag.id] }, style: { fill: '#a2d9fe' } }),
			put.sticky(N3, { x: 600, y: 0, data: { text: 'N3' }, style: { fill: '#a2d9fe' } }),
			put.shape(S, { x: 300, y: 360, data: { kind: 'rect', text: 'S' } }),
		])
		t.must(res.every((r) => r === 'ok'), '[D] Vorbedingung: drei Notizen und eine Form', res)

		const a = await world.actor('alice-contextbar', { user: 'alice', viewport: VIEW })
		const p = a.page
		try {
			await openBoard(a, B)
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Shift+Digit1')
			await K.waitIdle(p)

			t.step('(1) Klick auf N3: Farbpunkt, Reaktion, Kommentar, Tags, „…“')
			const c3 = await centerOf(p, N3)
			await p.mouse.click(c3.x, c3.y)
			t.must(await until(async () => (await selection(p)).join() === N3, { timeout: 3000 }), '[S] (1) N3 ist gewählt', await selection(p))
			t.check(await until(async () => (await barOrder(p))?.join() === 'section:color,action:react,action:comment,action:tags,menu:selection', { timeout: 3000 }),
				'[C] (1) die Leiste: Farbpunkt, „Add reaction“, „Comment“, „Tags“, „…“', await barOrder(p))

			t.step('(2) Farbpunkt: Reiter Fill/Text, Panel neben der Auswahl; Gelb, „Custom color…“, Text L')
			await p.locator(`${BAR} [data-knorke-section=color]`).first().click()
			t.must(await until(async () => !!(await box(p, '[data-knorke-panel=color]')), { timeout: 3000 }), '[C] (2) der Farbpunkt öffnet [data-knorke-panel=color]')
			const tabs = await p.locator('[data-knorke-panel=color] [role=tab]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-knorke-tab'), e.getAttribute('aria-selected')]))
			t.check(JSON.stringify(tabs) === JSON.stringify([['fill', 'true'], ['text', 'false']]), '[C] (2) Reiter Fill (gewählt) und Text', tabs)
			await until(async () => (await p.locator('[data-knorke-panel=color]').first().getAttribute('data-knorke-panel-side')) !== null, { timeout: 3000 })
			const pan = await box(p, '[data-knorke-panel=color]')
			const bar = await box(p, BAR)
			// N3 on the screen: its world box (600, 0, 200 × 200) through the camera
			const tl = await K.w2s(p, 600, 0)
			const br = await K.w2s(p, 800, 200)
			const note = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
			t.check(apart(pan, bar), '[C] (2) das Panel liegt nicht über der Leiste', { pan, bar })
			t.check(apart(pan, note), '[C] (2) das Panel liegt nicht über N3', { pan, note })
			await p.locator('[data-knorke-panel=color] [data-knorke-style="style.fill"][data-knorke-value="#faea89"]').first().click()
			t.check(await until(async () => (await itemMap(p)).get(N3)?.style?.fill === '#faea89', { timeout: 3000 }), '[C] (2) „Yellow“ färbt N3', (await itemMap(p)).get(N3)?.style)
			await p.locator('[data-knorke-panel=color] [data-knorke-action=custom-color]').first().click()
			t.check(await until(() => p.locator('[data-knorke-panel=color] input[data-knorke-hex="style.fill"]').first().isVisible().catch(() => false), { timeout: 2000 }), '[C] (2) „Custom color…“ zeigt das Hex-Feld')
			await p.locator('[data-knorke-panel=color] [data-knorke-tab=text]').first().click()
			await p.locator('[data-knorke-panel=color] [data-knorke-style="style.fontSize"][data-knorke-value="32"]').first().click()
			t.check(await until(async () => (await itemMap(p)).get(N3)?.style?.fontSize === 32, { timeout: 3000 }), '[C] (2) der Reiter Text setzt L (32)', (await itemMap(p)).get(N3)?.style)
			await p.keyboard.press('Escape')

			t.step('(3) S: Reiter Fill/Border/Text, „Change shape“ in der Leiste')
			const cs = await centerOf(p, S)
			await p.mouse.click(cs.x, cs.y)
			t.must(await until(async () => (await selection(p)).join() === S, { timeout: 3000 }), '[S] (3) S ist gewählt', await selection(p))
			t.check(await until(async () => (await barOrder(p))?.includes('section:kind'), { timeout: 3000 }), '[C] (3) „Change shape“ in der Leiste', await barOrder(p))
			await p.locator(`${BAR} [data-knorke-section=color]`).first().click()
			const stabs = await until(async () => {
				const l = await p.locator('[data-knorke-panel=color] [role=tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-tab')))
				return l.length > 0 ? l : null
			}, { timeout: 3000 })
			t.check(JSON.stringify(stabs) === JSON.stringify(['fill', 'border', 'text']), '[C] (3) Reiter Fill, Border, Text', stabs)
			await p.locator(`${BAR} [data-knorke-section=color]`).first().click()

			t.step('(4) „…“ von S: feste Gruppen, Delete zuletzt in anderer Farbe')
			t.must(await openMore(p), '[C] (4) „…“ öffnet sein Menü')
			const more = await moreOrder(p)
			t.check(more.join() === 'cut,copy,duplicate,|,front,back,|,arrange,|,lock,|,delete', '[C] (4) Einträge und Trenner von „…“', more)
			const colors = await p.evaluate((m) => {
				const c = (n) => getComputedStyle(document.querySelector(`${m} [data-knorke-action=${n}] button`)).color
				return { cut: c('cut'), del: c('delete') }
			}, MENUS)
			const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).map(Number)
			const [r, g, b] = rgb(colors.del)
			t.check(colors.del !== colors.cut && r > g && r > b, '[C] (4) „Delete“ in der Fehlerfarbe (rötlich), anders als „Cut“', colors)
			await p.keyboard.press('Escape')
			await until(async () => (await moreOrder(p)).length === 0, { timeout: 3000 })

			t.step('(4b) Tastatur: Enter auf „…“ › „Duplicate“ gibt „…“ den Fokus zurück; „Arrange…“ fokussiert sein erstes Feld')
			const trig = p.locator(`${BAR} [data-knorke-menu=selection] button`).first()
			/** Opens "…" with Enter and moves down to the entry; returns whether it has the focus. */
			const keyTo = async (name) => {
				await trig.focus()
				await p.keyboard.press('Enter')
				// NcActions puts the focus on the first entry once the menu stands
				if (!(await until(() => p.evaluate((m) => !!document.activeElement?.closest?.(m), MENUS), { timeout: 3000 }))) return false
				for (let i = 0; i < 12; i++) {
					if (await p.evaluate((n) => document.activeElement?.closest?.('[data-knorke-action]')?.getAttribute('data-knorke-action') === n, name)) return true
					await p.keyboard.press('ArrowDown')
					await p.waitForTimeout(100)
				}
				return false
			}
			const count4 = (await itemMap(p)).size
			t.must(await keyToSafe(keyTo, 'duplicate'), '[D] (4b) Vorbedingung: „Duplicate“ hat im Menü den Fokus')
			await p.keyboard.press('Enter')
			t.check(await until(async () => (await itemMap(p)).size === count4 + 1, { timeout: 3000 }), '[C] (4b) Enter dupliziert')
			const focus4 = await until(() => p.evaluate((b) => !!document.activeElement?.closest?.(`${b} [data-knorke-menu=selection]`), BAR), { timeout: 2000 })
			t.check(focus4, '[C] (4b) danach hat „…“ den Fokus (nicht <body>)', await p.evaluate(() => document.activeElement?.tagName))
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Control+z')
			t.must(await until(async () => (await itemMap(p)).size === count4, { timeout: 3000 }), '[D] (4b) Strg+Z nimmt die Kopie wieder weg')
			await p.mouse.click(cs.x, cs.y)
			await until(async () => (await selection(p)).join() === S, { timeout: 3000 })
			t.must(await keyToSafe(keyTo, 'arrange'), '[D] (4b) Vorbedingung: „Arrange…“ hat im Menü den Fokus')
			await p.keyboard.press('Enter')
			t.check(await until(() => p.evaluate(() => document.activeElement?.closest?.('[data-knorke-field]')?.getAttribute('data-knorke-field') === 'arrange-x'), { timeout: 3000 }),
				'[C] (4b) „Arrange…“ per Enter: das Feld X hat den Fokus', await p.evaluate(() => document.activeElement?.className))
			await p.keyboard.press('Escape')
			t.check(await until(() => p.evaluate((b) => !!document.activeElement?.closest?.(`${b} [data-knorke-menu=selection]`), BAR), { timeout: 2000 }), '[C] (4b) Esc im Panel gibt „…“ den Fokus')

			t.step('(5) Strg+A: Chip „4 selected“ vorn, „Align items“ dahinter; nach Typ und nach Tag eingrenzen')
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Control+a')
			t.must(await until(async () => (await selection(p)).length === 4, { timeout: 3000 }), '[S] (5) vier Objekte gewählt', await selection(p))
			const order5 = await until(async () => {
				const o = await barOrder(p)
				return o && o[0] === 'chip' ? o : null
			}, { timeout: 3000 })
			t.check(order5 && order5[1] === 'action:align', '[C] (5) der Chip vorn, „Align items“ direkt dahinter', order5 ?? await barOrder(p))
			const chipText = (await p.locator(`${BAR} [data-knorke-action=filter]`).first().innerText().catch(() => '')).trim()
			t.check(chipText === '4 selected', '[C] (5) der Chip heißt „4 selected“', chipText)
			await p.locator(`${BAR} [data-knorke-action=filter]`).first().click()
			await p.locator(`${BAR} [data-knorke-filter=sticky]`).first().click()
			t.check(await until(async () => (await selection(p)).join() === [N1, N2, N3].sort().join(), { timeout: 3000 }), '[S] (5) „Only notes (3)“ grenzt auf die Notizen ein', await selection(p))
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Control+a')
			await until(async () => (await selection(p)).length === 4, { timeout: 3000 })
			await p.locator(`${BAR} [data-knorke-action=filter]`).first().click()
			const tagEntry = p.locator(`${BAR} [data-knorke-filter-tag="${tag.id}"]`).first()
			t.must(await until(() => tagEntry.isVisible().catch(() => false), { timeout: 3000 }), '[C] (5) „By tag“ bietet „A (2)“ an')
			t.check((await tagEntry.innerText()).trim() === 'A (2)', '[C] (5) der Eintrag heißt „A (2)“', await tagEntry.innerText())
			await tagEntry.click()
			t.check(await until(async () => (await selection(p)).join() === [N1, N2].sort().join(), { timeout: 3000 }), '[S] (5) „A (2)“ grenzt auf N1 und N2 ein', await selection(p))

			t.step('(6) Rechtsklick auf die nicht gewählte N3: gewählt, dieselben Gruppen; leere Fläche')
			await p.keyboard.press('Escape')
			await p.mouse.click(c3.x, c3.y)
			await until(async () => (await selection(p)).join() === N3, { timeout: 3000 })
			t.must(await openMore(p), '[D] (6) Vorbedingung: „…“ von N3 offen')
			const moreN3 = (await moreOrder(p)).filter((x) => x !== '|')
			await p.keyboard.press('Escape')
			await p.keyboard.press('Escape')
			await until(async () => (await selection(p)).length === 0, { timeout: 3000 })
			await p.mouse.click(c3.x, c3.y, { button: 'right' })
			t.must(await until(() => p.locator(MENU).first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (6) das Kontextmenü öffnet sich')
			t.check((await selection(p)).join() === N3, '[S] (6) der Rechtsklick hat N3 gewählt', await selection(p))
			const items6 = await menuItems(p)
			t.check(JSON.stringify(items6.filter((x) => moreN3.includes(x))) === JSON.stringify(moreN3), '[C] (6) die Einträge von „…“ in derselben Reihenfolge', { menu: items6, more: moreN3 })
			t.check(items6.at(-1) === 'delete' && items6.indexOf('export-png') > items6.indexOf('lock') && items6.indexOf('export-csv') < items6.indexOf('delete'), '[C] (6) die Exporte vor „Delete“, „Delete“ zuletzt', items6)
			const seps = await p.locator(`${MENU} [role=separator]`).count()
			t.check(seps >= 4, '[C] (6) Trenner zwischen den Gruppen', seps)
			await p.keyboard.press('Escape')
			const empty = await K.w2s(p, 700, 420)
			await p.mouse.click(empty.x, empty.y, { button: 'right' })
			t.must(await until(() => p.locator(MENU).first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (6) das Menü der leeren Fläche öffnet sich')
			const items7 = await menuItems(p)
			t.check(items7.includes('grid') && items7.every((x) => ['wheel', 'unlock-frame', 'unlock-all', 'grid', 'grid-snap'].includes(x)), '[C] (6) leere Fläche: nur Mausrad, Massen-Entsperren und Raster', items7)
			await p.keyboard.press('Escape')

			t.step('(7) „…“ › Delete löscht S')
			await p.mouse.click(cs.x, cs.y)
			await until(async () => (await selection(p)).join() === S, { timeout: 3000 })
			t.must(await openMore(p), '[D] (7) Vorbedingung: „…“ von S offen')
			await p.locator(`${MENUS} [data-knorke-action=delete] button`).first().click()
			t.check(await until(async () => !(await itemMap(p)).has(S), { timeout: 3000 }), '[C] (7) S ist gelöscht')
		} finally {
			await world.drop(a)
		}

		t.step('(8) Dunkelmodus (b): das schwarze Feld behält seinen Rand')
		const d = await world.actor('alice-contextbar-dark', { user: 'alice', viewport: VIEW, colorScheme: 'dark' })
		try {
			await openBoard(d, B)
			await d.page.locator(CANVAS).first().focus()
			await d.page.keyboard.press('Shift+Digit1')
			await K.waitIdle(d.page)
			t.must(await until(() => d.page.evaluate(() => document.body.getAttribute('data-knorke-dark') === 'b'), { timeout: 5000 }), '[D] (8) Vorbedingung: <body data-knorke-dark="b">')
			const c = await centerOf(d.page, N1)
			await d.page.mouse.click(c.x, c.y)
			await d.page.locator(`${BAR} [data-knorke-section=color]`).first().click()
			const black = await until(() => d.page.evaluate(() => {
				const sw = document.querySelector('[data-knorke-panel=color] [data-knorke-value="#191b1d"]')
				const panel = document.querySelector('[data-knorke-panel=color]')
				return sw && panel ? { edge: getComputedStyle(sw).borderTopColor, panel: getComputedStyle(panel).backgroundColor } : null
			}), { timeout: 3000 })
			t.check(black && black.edge === 'rgb(143, 145, 150)' && black.panel === 'rgb(43, 44, 48)', '[C] (8) Rand #8f9196 auf dem Panel #2b2c30', black)
		} finally {
			await world.drop(d)
		}

		t.step('(9) Tablet mit Stift: Leiste 52 px, „…“ per Tipp, Einträge ≥ 44 px, Panel nie über der Leiste')
		const tb = await world.actor('alice-contextbar-pen', { user: 'alice', touch: true, fine: true })
		const q = tb.page
		try {
			await openBoard(tb, B)
			await q.locator(CANVAS).first().focus()
			await q.keyboard.press('Shift+Digit1')
			await K.waitIdle(q)
			const c = await centerOf(q, N2)
			await q.touchscreen.tap(c.x, c.y)
			t.must(await until(async () => (await selection(q)).join() === N2, { timeout: 3000 }), '[S] (9) ein Tipp wählt N2', await selection(q))
			const bar9 = await until(() => box(q, BAR), { timeout: 3000 })
			t.check(bar9 && Math.abs(bar9.h - 52) <= TOL, '[C] (9) die Leiste ist 52 px hoch', bar9)
			await q.waitForTimeout(400)
			const mb = await box(q, `${BAR} [data-knorke-menu=selection] button`)
			await q.touchscreen.tap(mb.x + mb.w / 2, mb.y + mb.h / 2)
			t.must(await until(async () => (await moreOrder(q)).length > 0, { timeout: 3000 }), '[C] (9) ein Tipp öffnet „…“')
			// the popover scales in (floating-vue): measure once it stands
			await q.waitForTimeout(500)
			const heights = await q.evaluate((m) => [...document.querySelectorAll(`${m} [data-knorke-action] button`)].map((e) => e.getBoundingClientRect().height), MENUS)
			t.check(heights.length > 0 && heights.every((h) => h >= 44 - TOL), '[C] (9) jeder Eintrag ist mindestens 44 px hoch', heights)
			await q.keyboard.press('Escape')
			await until(async () => (await moreOrder(q)).length === 0, { timeout: 3000 })
			const dot = await box(q, `${BAR} [data-knorke-section=color]`)
			await q.touchscreen.tap(dot.x + dot.w / 2, dot.y + dot.h / 2)
			t.must(await until(async () => (await q.locator('[data-knorke-panel=color]').first().getAttribute('data-knorke-panel-side').catch(() => null)) !== null, { timeout: 3000 }), '[C] (9) ein Tipp auf den Farbpunkt öffnet das Panel')
			const pan9 = await box(q, '[data-knorke-panel=color]')
			const barNow = await box(q, BAR)
			t.check(apart(pan9, barNow), '[C] (9) das Panel liegt nicht über der Leiste', { pan9, barNow })
		} finally {
			await world.drop(tb)
		}
	},
}
