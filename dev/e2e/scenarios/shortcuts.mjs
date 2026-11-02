/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The shortcuts overview (factory jobs 145, 161).
 *
 * One board for the case and its pass (a WeakMap per world), notes A and B.
 *
 * E52 alice, mouse and keyboard, Chromium 1280 × 800 (mode edit). Steps:
 *   (1) a click selects A (canvas focus); ? (Shift+/) opens
 *       [data-knorke-dialog="shortcuts"]: the first group "Tools", the
 *       finger gestures last, the keys of this platform (Ctrl+Shift+V);
 *   (2) Esc closes it: the canvas has the focus, the selection is still [A];
 *   Job 229: the round "?" button is gone; the overview opens from the zoom
 *   menu (its trigger is the percentage, the entry "Keyboard shortcuts").
 *   (3) Tab from "Zoom out" reaches the zoom menu's trigger (a visible focus
 *       ring), Enter opens the menu, PageDown reaches its last entry
 *       "Keyboard shortcuts", Enter opens the overview, Esc closes it and
 *       the trigger has the focus again;
 *   (4) a mouse click on the trigger and on the entry opens it, Esc gives
 *       the canvas the focus;
 *   (5) with A selected and with nothing selected: no round "?" button, the
 *       entry only in the open menu, the trigger inside .knorke-zoom with
 *       nothing over it;
 *   (6) (job 161) A selected, canvas focus: ? opens, a second ? closes (the
 *       canvas has the focus, the selection is [A], 500 ms later still
 *       closed); holding ? (Shift+Slash down, repeats, up) opens it once
 *       and it stays open; a click on × closes it;
 *   (7) (job 161) a click on the backdrop over (a) the tool button "Sticky
 *       note", (b) note B, (c) the zoom menu's trigger, each outside the box [D],
 *       closes it: tool select, selection [A], number of items unchanged,
 *       the canvas has the focus, 500 ms later still closed (not reopened
 *       by (c)); a click on a group heading in the box does not close;
 *   (8) (job 161) a touch laptop: a second actor (1280 × 800, mouse) whose
 *       init script reports navigator.maxTouchPoints 10 and (any-pointer:
 *       coarse) (the browser keeps (pointer: fine)): mode edit, ? shows
 *       "Finger gestures" first, then "Tools", and "With mouse or pen".
 * E52@820x1180 (job 161) alice with a finger on a tablet (touch, no fine
 *   pointer: mode view): a tap on the zoom menu's trigger and on "Keyboard
 *   shortcuts" opens the overview with "Finger gestures" first; a tap on the
 *   backdrop (over the trigger, then over the canvas, outside the box [D])
 *   closes it, 500 ms later still closed, selection and camera unchanged.
 * E52@360x780 alice with a finger on a 360 px phone (no fine pointer: mode
 *   view, the narrow layout): the zoom menu's trigger is visible in the
 *   viewport with nothing over it; a tap on it and on "Keyboard shortcuts"
 *   opens the overview with "Finger gestures" first and without "Hold a
 *   finger still …" (mode view); Esc closes it.
 * Own board, no instance setting: before E09, directly after E50 (E51 is
 * job 144's). Flake gate: --only E52 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene keys
 * and selection, [C] shell (button, dialog, focus), [D] a harness
 * precondition. Waiting polls from Node with until() (Nextcloud's CSP,
 * ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, TABLET, put, ulid, seedOps, openBoard, until, sleep, selectItem, canvasFocused, sameList, toolPressed } from '../lib/harness.mjs'

const DESK = Object.freeze({ width: 1280, height: 800 })
/** The narrowest phone the spec names (risk "Touch"). */
export const PHONE_360 = Object.freeze({ width: 360, height: 780 })
const DIALOG = '[data-knorke-dialog="shortcuts"]'
/** Job 229: the zoom menu's trigger (the percentage) and its entry "Keyboard shortcuts". */
const BUTTON = '[data-knorke-menu=zoom] .action-item__menutoggle'
const ENTRY = '#knorke-menus [data-knorke-action=shortcuts]'

/**
 * Job 229: opens the overview from the zoom menu: the trigger, then the
 * entry once it shows (a mouse click, or a finger's tap).
 */
async function fromMenu(page, how = 'click') {
	await page.locator(BUTTON).first()[how]({ timeout: 3000 })
	const entry = page.locator(ENTRY).first()
	await entry.waitFor({ state: 'visible', timeout: 3000 })
	await entry[how]({ timeout: 3000 })
}

/** One board per world for E52 and its pass. */
const boards = new WeakMap()

/** @return {Promise<{board: number, A: string, B: string}>} the board of this world's E52 (created and seeded once) */
async function shortcutsBoard(t, world) {
	if (!boards.has(world)) {
		boards.set(world, (async () => {
			const board = await world.board('E52 Tastenkürzel')
			const [A, B] = [ulid(), ulid()]
			const res = await seedOps('alice', board, [
				put.sticky(A, { x: 0, y: 0, data: { text: 'A' } }),
				put.sticky(B, { x: 300, y: 0, data: { text: 'B' } }),
			])
			if (!res.every((x) => x === 'ok')) throw new Error('E52 seed: ' + JSON.stringify(res))
			return { board, A, B }
		})())
	}
	const b = await boards.get(world)
	t.must(!!b.board, '[D] Vorbedingung: Board mit den Notizen A und B', b)
	return b
}

/**
 * Runs in the page: the overview, the button, the zoom bar and the other
 * bars (client px). No closure over Node values (page.evaluate serialises it).
 */
function measure() {
	const r = (el) => {
		if (!el) return null
		const b = el.getBoundingClientRect()
		return b.width > 0 && b.height > 0 ? { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom } : null
	}
	const dialog = document.querySelector('[data-knorke-dialog="shortcuts"]')
	// job 229: the zoom menu's trigger instead of the round "?" button
	const button = document.querySelector('[data-knorke-menu=zoom] .action-item__menutoggle')
	const bb = r(button)
	let top = null
	if (bb) {
		const el = document.elementFromPoint(bb.x + bb.w / 2, bb.y + bb.h / 2)
		top = !!el && !!button.contains(el)
	}
	const others = []
	for (const sel of ['[data-knorke-bar=top]', '.knorke-toolbar', '.knorke-undo', '.knorke-contextbar', '.knorke-touchtip', '[data-knorke-vote-bar]', '.knorke-banners > *']) {
		for (const el of document.querySelectorAll(sel)) {
			const x = r(el)
			if (x) others.push({ sel, ...x })
		}
	}
	const groups = dialog ? [...dialog.querySelectorAll('[data-knorke-shortcuts-group]')] : []
	const a = document.activeElement
	const cs = button ? getComputedStyle(button) : null
	return {
		open: !!dialog,
		groups: groups.map((g) => g.getAttribute('data-knorke-shortcuts-group')),
		headings: groups.map((g) => (g.querySelector('h3')?.textContent || '').trim()),
		keys: dialog ? [...dialog.querySelectorAll('kbd')].map((k) => k.textContent.trim()) : [],
		text: dialog ? dialog.textContent : '',
		box: dialog ? r(dialog.querySelector('.modal-container')) : null,
		button: bb,
		buttonOnTop: top,
		zoom: r(document.querySelector('.knorke-zoom')),
		roundButton: !!document.querySelector('.knorke-zoom__shortcuts'),
		entryShown: !!r(document.querySelector('[data-knorke-action=shortcuts]')),
		others,
		focusButton: !!button && a === button,
		focusInDialog: !!dialog && dialog.contains(a),
		outline: cs ? { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0 } : null,
		vw: window.innerWidth,
		vh: window.innerHeight,
	}
}

/** The measurement of a page (measure() in it). */
const look = (page) => page.evaluate(measure)

/** Overlap of two client boxes along both axes (> 0.5 on both = they overlap). */
function overlaps(a, b, slack = 0.5) {
	if (!a || !b) return false
	const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x)
	const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y)
	return ox > slack && oy > slack
}

/** Waits until the overview is open (and its focus trap had time to move in); returns the measurement. */
async function opened(page) {
	const ok = await until(async () => (await look(page)).open, { timeout: 3000 })
	if (ok) await until(async () => (await look(page)).focusInDialog, { timeout: 1500 })
	return look(page)
}

/** Waits until the overview is gone; returns the measurement. */
async function closed(page) {
	await until(async () => !(await look(page)).open, { timeout: 3000 })
	await sleep(100)
	return look(page)
}

/** Step (5), job 229: no round "?" button; the entry only in the open menu; the trigger inside the zoom bar, nothing over it. */
function placeChecks(t, m, what) {
	const b = m.button
	const z = m.zoom
	t.must(!!b && !!z, `[D] (5) ${what}: Auslöser des Zoom-Menüs und Zoom-Leiste sind sichtbar`, { button: b, zoom: z })
	t.check(!m.roundButton && !m.entryShown, `[C] (5) ${what}: kein runder „?“-Knopf, „Keyboard shortcuts“ nur im offenen Zoom-Menü`, { rund: m.roundButton, eintrag: m.entryShown })
	t.check(b.x >= z.x - 0.5 && b.r <= z.r + 0.5 && b.y >= z.y - 0.5 && b.b <= z.b + 0.5, `[C] (5) ${what}: der Auslöser liegt in der Zoom-Leiste`, { button: b, zoom: z })
	const hit = m.others.filter((o) => overlaps(b, o))
	t.check(hit.length === 0 && m.buttonOnTop === true, `[C] (5) ${what}: der Auslöser überlappt keine andere Leiste, nichts liegt über ihm`, { überlappt: hit, oben: m.buttonOnTop })
}

/** Centre of a client box. */
const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Is a client point inside a client box (edges included)? */
const inside = (pt, b) => !!b && pt.x >= b.x && pt.x <= b.r && pt.y >= b.y && pt.y <= b.b

/**
 * Runs in the page (job 161): what lies at a client point – on top the
 * overview's backdrop (in its mask, outside .modal-container) or not, and
 * under the mask the first element of the board (tool button, action
 * button, canvas).
 */
function hitAt([x, y]) {
	const el = document.elementFromPoint(x, y)
	const mask = el ? el.closest('[data-knorke-dialog="shortcuts"]') : null
	const below = document.elementsFromPoint(x, y).find((e) => !e.closest('[data-knorke-dialog="shortcuts"]') && e !== document.documentElement && e !== document.body) || null
	return {
		backdrop: !!mask && !el.closest('.modal-container'),
		top: el ? el.tagName + '.' + String(el.className || '').split(' ')[0] : null,
		tool: below?.closest('[data-knorke-tool]')?.getAttribute('data-knorke-tool') ?? null,
		action: below?.closest('[data-knorke-action]')?.getAttribute('data-knorke-action') ?? null,
		menu: below?.closest('[data-knorke-menu]')?.getAttribute('data-knorke-menu') ?? null,
		canvas: !!below?.closest('.knorke-canvas'),
	}
}

/**
 * Job 161 [D]: the point lies outside the dialog's box, the backdrop is on
 * top there (the click hits the backdrop) and `under` holds for what lies
 * under the mask.
 *
 * @return {Promise<object>} hitAt's answer
 */
async function backdropPoint(t, page, m, pt, what, under) {
	const hit = await page.evaluate(hitAt, [pt.x, pt.y])
	t.must(!!m.box && !inside(pt, m.box) && hit.backdrop, `[D] ${what}: der Punkt liegt außerhalb des Dialogkastens auf dem Hintergrund`, { punkt: pt, kasten: m.box, oben: hit })
	t.must(under(hit), `[D] ${what}: unter dem Hintergrund liegt das Ziel`, hit)
	return hit
}

/** The board state a click beside the overview must keep (job 161): tool (null without a tool bar), selection, number of items, camera. */
async function boardState(page) {
	const bar = (await page.locator('[data-knorke-tool=select]').count()) > 0
	return {
		select: bar ? await toolPressed(page, 'select') : null,
		sticky: bar ? await toolPressed(page, 'sticky') : null,
		selection: (await K.selection(page)) || [],
		items: (await K.items(page)).length,
		camera: await K.camera(page),
	}
}

/** Same camera (± 0.01 px, ± 1e-6 scale). */
const sameCamera = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.scale - b.scale) < 1e-6

/**
 * Init script of the touch laptop (job 161 AK7): navigator.maxTouchPoints
 * 10 and (any-pointer: coarse) true; every other query (pointer: fine
 * included) as the browser answers it. Runs in the page before the app.
 */
function touchLaptopInit() {
	try {
		Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 10 })
	} catch (e) { /* keep the browser's */ }
	const orig = window.matchMedia.bind(window)
	window.matchMedia = (q) => {
		if (/\(\s*any-pointer\s*:\s*coarse\s*\)/.test(String(q))) {
			return { matches: true, media: String(q), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } }
		}
		return orig(q)
	}
}

export const E52 = {
	id: 'E52',
	title: 'Übersicht der Tastenkürzel (Jobs 145, 161, 229, 1280 × 800): ? öffnet sie mit „Tools“ zuerst und den Fingergesten zuletzt, Esc schließt sie mit Fokus auf der Leinwand und derselben Auswahl; mit der Tastatur über das Zoom-Menü geöffnet gibt Esc seinem Auslöser den Fokus zurück; ein Mausklick im Zoom-Menü öffnet; kein runder „?“-Knopf mehr; ein zweites ? schließt, gehaltenes ? flackert nicht; ein Klick auf den Hintergrund schließt und tut auf der Tafel nichts; ein Touch-Laptop zeigt die Fingergesten zuerst',
	async run(t, world) {
		const { board, A, B } = await shortcutsBoard(t, world)
		const a = await world.actor('alice-kuerzel', { user: 'alice', viewport: DESK })
		const p = a.page
		try {
			await openBoard(a, board)
			await K.waitIdle(p)
			t.must((await K.state(p)).uiMode === 'edit', '[D] alice ist im Modus edit', { uiMode: (await K.state(p)).uiMode })

			t.step('(1) A wählen, ? drücken')
			await selectItem(p, A)
			t.must(sameList((await K.selection(p)) || [], [A]) && await canvasFocused(p), '[S] (1) ein Klick wählt A und fokussiert die Leinwand', { auswahl: await K.selection(p) })
			await p.keyboard.press('Shift+Slash')
			let m = await opened(p)
			t.check(m.open, '[C] (1) ? öffnet [data-knorke-dialog="shortcuts"]')
			t.check(m.groups[0] === 'tools' && m.headings[0] === 'Tools', '[C] (1) die erste Gruppe heißt „Tools“', { gruppen: m.groups, überschriften: m.headings })
			t.check(m.groups.at(-1) === 'gestures' && m.headings.at(-1) === 'Finger gestures', '[C] (1) die Fingergesten stehen am Ende', { gruppen: m.groups })
			t.check(m.keys.includes('Ctrl+Shift+V') && m.keys.includes('V') && m.keys.includes('?'), '[C] (1) die Tasten dieser Plattform als <kbd> (Strg+Umschalt+V als Ctrl+Shift+V, V, ?)', { tasten: m.keys.slice(0, 12) })
			t.check(m.text.includes('Hold a finger still, then drag'), '[C] (1) im Modus edit auch „Hold a finger still …“')

			t.step('(2) Esc')
			await p.keyboard.press('Escape')
			m = await closed(p)
			t.check(!m.open, '[C] (2) Esc schließt die Übersicht')
			t.check(await canvasFocused(p), '[C] (2) danach hat die Leinwand den Fokus')
			t.check(sameList((await K.selection(p)) || [], [A]), '[S] (2) die Auswahl ist unverändert [A]', { auswahl: await K.selection(p) })

			t.step('(3) Tab von „Zoom out“ zum Zoom-Menü, Enter, Bild ab, Enter, Esc')
			await p.locator('[data-knorke-action=zoom-out]').first().focus()
			await p.keyboard.press('Tab')
			m = await look(p)
			t.check(m.focusButton, '[C] (3) Tab von „Zoom out“ erreicht den Auslöser des Zoom-Menüs (die Prozentzahl)')
			const ring = await p.evaluate((sel) => {
				const cs = getComputedStyle(document.querySelector(sel))
				return { outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0, shadow: cs.boxShadow }
			}, BUTTON)
			t.check((ring.outline !== 'none' && ring.width >= 2) || (!!ring.shadow && ring.shadow !== 'none'), '[C] (3) der Auslöser zeigt einen sichtbaren Fokusring', ring)
			await p.keyboard.press('Enter')
			t.must(await until(() => p.locator(ENTRY).first().isVisible().catch(() => false), { timeout: 3000 }), '[D] (3) Enter öffnet das Zoom-Menü')
			const inMenu = await until(() => p.evaluate(() => !!document.activeElement?.closest?.('#knorke-menus')), { timeout: 3000 })
			t.must(inMenu, '[D] (3) der Fokus liegt im offenen Zoom-Menü', await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 160) ?? null))
			await p.keyboard.press('PageDown')
			t.check(await until(() => p.evaluate((sel) => !!document.querySelector(sel)?.contains(document.activeElement), ENTRY), { timeout: 2000 }), '[C] (3) Bild ab erreicht den letzten Eintrag „Keyboard shortcuts“')
			await p.keyboard.press('Enter')
			m = await opened(p)
			t.check(m.open, '[C] (3) Enter auf dem Eintrag öffnet die Übersicht')
			await p.keyboard.press('Escape')
			m = await closed(p)
			t.check(!m.open && m.focusButton, '[C] (3) Esc schließt sie, der Fokus ist wieder auf dem Auslöser des Zoom-Menüs', { offen: m.open, button: m.focusButton })
			t.check(sameList((await K.selection(p)) || [], [A]), '[S] (3) die Auswahl ist unverändert [A]', { auswahl: await K.selection(p) })

			t.step('(4) Mausklick im Zoom-Menü, Esc')
			await fromMenu(p)
			m = await opened(p)
			t.check(m.open, '[C] (4) ein Mausklick auf „Keyboard shortcuts“ im Zoom-Menü öffnet die Übersicht')
			await p.keyboard.press('Escape')
			m = await closed(p)
			t.check(!m.open && await canvasFocused(p), '[C] (4) Esc schließt sie, die Leinwand hat den Fokus', { offen: m.open, leinwand: await canvasFocused(p) })

			t.step('(5) kein runder „?“-Knopf, mit und ohne Auswahl')
			placeChecks(t, await look(p), 'mit Auswahl')
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Escape')
			t.must(await until(async () => ((await K.selection(p)) || []).length === 0, { timeout: 2000 }), '[S] (5) Esc auf der Leinwand leert die Auswahl')
			placeChecks(t, await look(p), 'ohne Auswahl')

			t.step('(6) ? öffnet, ein zweites ? schließt; ? gedrückt halten; ×')
			await selectItem(p, A)
			t.must(sameList((await K.selection(p)) || [], [A]) && await canvasFocused(p), '[S] (6) ein Klick wählt A wieder und fokussiert die Leinwand', { auswahl: await K.selection(p) })
			await p.evaluate(() => {
				window.__kd161keys = []
				window.addEventListener('keydown', (e) => { window.__kd161keys.push([e.key, e.repeat]) }, true)
			})
			await p.keyboard.press('Shift+Slash')
			m = await opened(p)
			t.must(m.open, '[C] (6) ? öffnet die Übersicht')
			await p.keyboard.press('Shift+Slash')
			m = await closed(p)
			t.check(!m.open, '[C] (6) ein zweites ? schließt sie')
			t.check(await canvasFocused(p), '[C] (6) danach hat die Leinwand den Fokus')
			t.check(sameList((await K.selection(p)) || [], [A]), '[S] (6) die Auswahl ist unverändert [A]', { auswahl: await K.selection(p) })
			await sleep(500)
			t.check(!(await look(p)).open, '[C] (6) auch 500 ms später ist die Übersicht zu (das zweite ? öffnet sie nicht wieder)')
			await p.keyboard.down('Shift')
			await p.keyboard.down('Slash')
			m = await opened(p)
			t.check(m.open, '[C] (6) ein drittes ? öffnet sie wieder (der erste Druck des Gedrückthaltens)')
			for (let i = 0; i < 5; i++) {
				await p.keyboard.down('Slash')
				await sleep(40)
			}
			await p.keyboard.up('Slash')
			await p.keyboard.up('Shift')
			const keys = await p.evaluate(() => window.__kd161keys.filter((k) => k[0] === '?'))
			t.must(keys.length === 8 && keys.slice(3).every((k) => k[1] === true) && keys.slice(0, 3).every((k) => k[1] === false), '[D] (6) Playwright meldet die gehaltenen Drücke als Wiederholung (repeat)', { tasten: keys })
			await sleep(500)
			t.check((await look(p)).open, '[C] (6) ? gedrückt gehalten (5 Wiederholungen): die Übersicht bleibt offen')
			await p.locator(`${DIALOG} .modal-container__close`).first().click()
			m = await closed(p)
			t.check(!m.open, '[C] (6) ein Klick auf × schließt sie')
			t.check(await canvasFocused(p), '[C] (6) danach hat die Leinwand den Fokus')

			t.step('(7) Klick auf den Hintergrund über „Sticky note“, über Notiz B, über dem Auslöser des Zoom-Menüs')
			// B lies under the box at the start camera: Space + drag on empty canvas moves it right of the box (x ≈ 1110)
			const b0 = await K.rect(p, B)
			const shift = Math.round(DESK.width - 170 - (b0.x + b0.w / 2))
			if (shift > 0) {
				await p.keyboard.down('Space')
				await p.mouse.move(400, 680)
				await p.mouse.down()
				await p.mouse.move(400 + shift, 680, { steps: 10 })
				await p.mouse.up()
				await p.keyboard.up('Space')
				await sleep(300)
			}
			const before = await boardState(p)
			t.must(before.select === 'true' && sameList(before.selection, [A]) && await canvasFocused(p), '[D] (7) Werkzeug select, Auswahl [A], Leinwand fokussiert', before)
			const stickyBox = await p.locator('[data-knorke-tool=sticky]').first().boundingBox()
			const bRect = await K.rect(p, B)
			const qButton = (await look(p)).button
			t.must(!!stickyBox && !!bRect && !!qButton, '[D] (7) Werkzeugknopf „Sticky note“, Notiz B und der Auslöser des Zoom-Menüs sind sichtbar', { stickyBox, bRect, qButton })
			const stickyPt = { x: stickyBox.x + stickyBox.width / 2, y: stickyBox.y + stickyBox.height / 2 }
			// a point of B outside the box: its centre, else nearer to its outer edges
			const bPoint = (box) => [0.5, 0.85, 0.15].map((f) => ({ x: bRect.x + bRect.w * f, y: bRect.y + bRect.h / 2 })).find((pt) => !inside(pt, box)) || mid(bRect)
			const targets = [
				['a', 'über dem Werkzeugknopf „Sticky note“', () => stickyPt, (h) => h.tool === 'sticky'],
				['b', 'über Notiz B', (box) => bPoint(box), (h) => h.canvas],
				['c', 'über dem Auslöser des Zoom-Menüs', () => mid(qButton), (h) => h.menu === 'zoom'],
			]
			for (const [n, what, point, under] of targets) {
				const tag = `(7${n}) ${what}`
				await p.keyboard.press('Shift+Slash')
				m = await opened(p)
				t.must(m.open, `[C] ${tag}: ? öffnet die Übersicht`)
				const pt = point(m.box)
				await backdropPoint(t, p, m, pt, tag, under)
				await p.mouse.click(pt.x, pt.y)
				m = await closed(p)
				t.check(!m.open, `[C] ${tag}: der Klick auf den Hintergrund schließt die Übersicht`)
				const after = await boardState(p)
				t.check(after.select === 'true' && after.sticky === 'false', `[C] ${tag}: das Werkzeug bleibt select`, { select: after.select, sticky: after.sticky })
				t.check(sameList(after.selection, [A]), `[S] ${tag}: die Auswahl bleibt [A]`, { auswahl: after.selection })
				t.check(after.items === before.items, `[S] ${tag}: kein neues Objekt (${before.items})`, { vorher: before.items, nachher: after.items })
				t.check(sameCamera(after.camera, before.camera), `[S] ${tag}: die Ansicht bleibt`, { vorher: before.camera, nachher: after.camera })
				t.check(await canvasFocused(p), `[C] ${tag}: danach hat die Leinwand den Fokus`)
				await sleep(500)
				t.check(!(await look(p)).open, `[C] ${tag}: auch 500 ms später ist die Übersicht zu`)
			}

			t.step('(7) Klicks im Kasten schließen nicht')
			await p.keyboard.press('Shift+Slash')
			m = await opened(p)
			t.must(m.open, '[C] (7) ? öffnet die Übersicht')
			const heading = p.locator(`${DIALOG} [data-knorke-shortcuts-group=edit] h3`).first()
			await heading.click()
			await sleep(500)
			t.check((await look(p)).open, '[C] (7) ein Klick auf die Gruppenüberschrift „Edit“ im Kasten schließt nicht')
			const hb = await heading.boundingBox()
			const out = { x: (m.box.x) / 2, y: m.box.y + m.box.h / 2 }
			await p.mouse.move(hb.x + 4, hb.y + hb.height / 2)
			await p.mouse.down()
			await p.mouse.move(out.x, out.y, { steps: 8 })
			await p.mouse.up()
			await sleep(500)
			t.check((await look(p)).open, '[C] (7) im Kasten gedrückt und daneben losgelassen (Text markieren): sie bleibt offen', { los: out })
			await p.keyboard.press('Escape')
			m = await closed(p)
			t.check(!m.open && sameList((await K.selection(p)) || [], [A]), '[C] (7) Esc schließt sie, die Auswahl bleibt [A]', { auswahl: await K.selection(p) })
		} finally {
			await world.drop(a)
		}

		t.step('(8) Touch-Laptop: maxTouchPoints 10 und (any-pointer: coarse), (pointer: fine) vom Browser')
		const b = await world.actor('alice-kuerzel-touchlaptop', { user: 'alice', viewport: DESK })
		const q = b.page
		try {
			await b.ctx.addInitScript(touchLaptopInit)
			await openBoard(b, board)
			await K.waitIdle(q)
			const dev = await q.evaluate(() => ({ points: navigator.maxTouchPoints, coarse: matchMedia('(any-pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches }))
			t.must(dev.points === 10 && dev.coarse === true && dev.fine === true, '[D] (8) der Akteur meldet maxTouchPoints 10, (any-pointer: coarse) und (pointer: fine)', dev)
			t.must((await K.state(q)).uiMode === 'edit', '[D] (8) der Touch-Laptop ist im Modus edit', { uiMode: (await K.state(q)).uiMode })
			await selectItem(q, A)
			t.must(await canvasFocused(q), '[S] (8) ein Klick auf A fokussiert die Leinwand')
			await q.keyboard.press('Shift+Slash')
			const m = await opened(q)
			t.check(m.open && m.groups[0] === 'gestures' && m.headings[0] === 'Finger gestures', '[C] (8) ? öffnet die Übersicht mit „Finger gestures“ zuerst', { gruppen: m.groups, überschriften: m.headings })
			t.check(m.groups[1] === 'tools' && m.headings[1] === 'Tools', '[C] (8) danach „Tools“', { gruppen: m.groups })
			t.check(m.groups.includes('pointer') && m.headings.includes('With mouse or pen'), '[C] (8) „With mouse or pen“ ist dabei', { überschriften: m.headings })
			await q.keyboard.press('Escape')
			t.check(!(await closed(q)).open, '[C] (8) Esc schließt sie')
		} finally {
			await world.drop(b)
		}
	},
}

export const E52_TABLET = {
	id: 'E52',
	pass: `${TABLET.width}x${TABLET.height}`,
	title: `Übersicht der Tastenkürzel auf einem Tablet mit ${TABLET.width} × ${TABLET.height} (Touch, Jobs 161, 229): Tipps auf das Zoom-Menü und „Keyboard shortcuts“ öffnen sie mit „Finger gestures“ zuerst, ein Tipp auf den Hintergrund (über dem Zoom-Menü, über der Leinwand) schließt sie; Auswahl und Kamera bleiben`,
	async run(t, world) {
		const { board } = await shortcutsBoard(t, world)
		const a = await world.actor(`alice-kuerzel-${TABLET.width}`, { user: 'alice', touch: true, viewport: TABLET })
		const p = a.page
		try {
			await openBoard(a, board)
			await K.waitIdle(p)
			t.note(`Modus ${(await K.state(p)).uiMode}`)
			const qButton = (await look(p)).button
			t.must(!!qButton, '[D] der Auslöser des Zoom-Menüs ist sichtbar', { button: qButton })
			const before = await boardState(p)
			const targets = [
				['über dem Auslöser des Zoom-Menüs', () => mid(qButton), (h) => h.menu === 'zoom'],
				['über der Leinwand links neben dem Kasten', (box) => ({ x: box.x / 2, y: box.y + box.h / 2 }), (h) => h.canvas],
			]
			for (const [what, point, under] of targets) {
				t.step(`Tipps im Zoom-Menü, dann Tipp auf den Hintergrund ${what}`)
				await fromMenu(p, 'tap')
				let m = await opened(p)
				t.must(m.open, '[C] Tipps auf das Zoom-Menü und „Keyboard shortcuts“ öffnen die Übersicht')
				t.check(m.groups[0] === 'gestures' && m.headings[0] === 'Finger gestures', '[C] der erste Abschnitt ist „Finger gestures“', { gruppen: m.groups, überschriften: m.headings })
				const pt = point(m.box)
				await backdropPoint(t, p, m, pt, `Tipp ${what}`, under)
				await p.touchscreen.tap(pt.x, pt.y)
				m = await closed(p)
				t.check(!m.open, `[C] ein Tipp auf den Hintergrund ${what} schließt die Übersicht`)
				await sleep(500)
				t.check(!(await look(p)).open, `[C] ${what}: auch 500 ms später ist sie zu`)
				const after = await boardState(p)
				t.check(sameList(after.selection, before.selection), `[S] ${what}: die Auswahl bleibt`, { vorher: before.selection, nachher: after.selection })
				t.check(sameCamera(after.camera, before.camera), `[S] ${what}: die Kamera bleibt`, { vorher: before.camera, nachher: after.camera })
				t.check(after.items === before.items, `[S] ${what}: kein neues Objekt`, { vorher: before.items, nachher: after.items })
			}
		} finally {
			await world.drop(a)
		}
	},
}

export const E52_PHONE = {
	id: 'E52',
	pass: `${PHONE_360.width}x${PHONE_360.height}`,
	title: `Übersicht der Tastenkürzel auf einem Handy mit ${PHONE_360.width} × ${PHONE_360.height} (Touch, Modus view, Job 229): das Zoom-Menü ist sichtbar und frei, Tipps darauf und auf „Keyboard shortcuts“ öffnen die Übersicht mit „Finger gestures“ zuerst und ohne „Hold a finger still …“`,
	async run(t, world) {
		const { board } = await shortcutsBoard(t, world)
		const a = await world.actor(`alice-kuerzel-${PHONE_360.width}`, { user: 'alice', touch: true, viewport: PHONE_360 })
		const p = a.page
		try {
			await openBoard(a, board)
			await K.waitIdle(p)
			t.must((await K.state(p)).uiMode === 'view', '[D] das Handy ohne feinen Zeiger ist im Modus view', { uiMode: (await K.state(p)).uiMode })
			let m = await look(p)
			const b = m.button
			t.note(`Auslöser ${JSON.stringify(b)}, Zoom-Leiste ${JSON.stringify(m.zoom)}, Viewport ${m.vw} × ${m.vh}`)
			t.check(!!b && b.x >= 0 && b.y >= 0 && b.r <= m.vw && b.b <= m.vh, '[C] der Auslöser des Zoom-Menüs liegt sichtbar im Viewport', { button: b, vw: m.vw, vh: m.vh })
			const hit = m.others.filter((o) => overlaps(b, o))
			t.check(!!b && hit.length === 0 && m.buttonOnTop === true, '[C] der Auslöser überlappt keine andere Leiste, nichts liegt über ihm', { überlappt: hit, oben: m.buttonOnTop })
			t.check(!m.roundButton, '[C] kein runder „?“-Knopf (Job 229)')

			t.step('Tipps auf das Zoom-Menü und „Keyboard shortcuts“')
			await fromMenu(p, 'tap')
			m = await opened(p)
			t.check(m.open, '[C] die Tipps öffnen die Übersicht')
			t.check(m.groups[0] === 'gestures' && m.headings[0] === 'Finger gestures', '[C] der erste Abschnitt ist „Finger gestures“', { gruppen: m.groups, überschriften: m.headings })
			t.check(!m.text.includes('Hold a finger still') && m.text.includes('Two fingers: zoom and move the view'), '[C] im Modus view nur „Two fingers …“, ohne „Hold a finger still …“')
			t.check(!m.groups.includes('tools') && m.groups.includes('view'), '[C] im Modus view keine Werkzeuge, aber „View“', { gruppen: m.groups })
			await p.keyboard.press('Escape')
			m = await closed(p)
			t.check(!m.open, '[C] Esc schließt die Übersicht')
		} finally {
			await world.drop(a)
		}
	},
}
