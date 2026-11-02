/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The look of the redesign foundation (factory job 226, AK7).
 *
 * E92 alice with one board of her own, seeded through /sync with a note.
 *   (1) Chromium 1280 × 800 with a mouse: the top bar, the zoom controls and
 *       (job 229) the undo island 44 px high, the tool bar's buttons 36 px;
 *       each bar with a 12 px radius, a shadow and a transparent edge
 *       (outline); (job 229) the variants of the note and the frame tool (a
 *       right-click) a popover with a 12 px radius, every tile with its
 *       picture; the board menu "More" with a 12 px radius; the shortcuts
 *       dialog (job 229: from the zoom menu) with a 16 px radius; the
 *       reaction picker of a selected note with a 12 px radius and a shadow;
 *       <body> without a dark mark.
 *   (2) a tablet context (touch, coarse pointer): the top bar 52 px high.
 *   (3) prefers-color-scheme dark (Nextcloud's default theme follows it):
 *       <body data-knorke-dark="b">, the top bar rgb(43, 44, 48) with text
 *       rgb(235, 235, 235), the canvas still rgb(243, 242, 240) (job 227: #f3f2f0).
 *   (4) round 2 of the fresh review: edit mode with touch and a fine pointer
 *       (as E39) on a phone 390 × 844, a small phone 360 × 740 and a tablet
 *       held across 1316 × 740: every tool button the bar shows and "Back"
 *       can be hit (elementFromPoint), also with a note selected (docked or
 *       floating context bar) and with the "Offline" notice; the tool bar
 *       keeps clear of the top bar, the zoom controls and (job 229) the undo
 *       island, which stays inside the window; phone and tablet show every
 *       tool without scrolling; the font panel of a shape and the tips
 *       panel of a connector lie inside the window with every button hit.
 * Job 244 (Phosphor icons, switched-on buttons in the accent): in (1) the
 *   active tool (hovered, too), the pressed tile of the note's variants, the
 *   context bar's pressed "Change shape" and the pressed kind in its panel,
 *   "Shapes" with its panel open and the open "Comments" are filled with
 *   --color-primary-element and draw their icon in
 *   --color-primary-element-text (rgb(255, 255, 255) with Nextcloud's
 *   default colour); a tool that is not active has no accent; pictures of
 *   the connector's panels (route, tips, line), the shapes panel and a star
 *   symbol in Duotone. In (3) the same for the active tool and "Comments"
 *   in the dark theme, with --color-primary and --color-primary-text there
 *   (Nextcloud's dark accent element is #0091f2 with black on it).
 * Pictures of each step go to shots/E92-*.png.
 * Own board, no instance setting: after E90, before E09.
 * Flake gate: --only E92 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] the board
 * in the browser, [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { outDir } from '../lib/bridge.mjs'
import { CANVAS, K, colorTab, openBoard, put, seedOps, ulid, until } from '../lib/harness.mjs'

const TITLE = 'E92 Neuer Look'
const VIEW = { width: 1280, height: 800 }
const TOP = '[data-knorke-bar=top]'
/** Job 228: the top bar is a strip with two islands; the islands carry the look. */
const LEFT = '[data-knorke-island=left]'
const RIGHT = '[data-knorke-island=right]'
const TOOLS = '[data-knorke-toolbar]'
const ZOOM = '.knorke-zoom'
const MENU = '#knorke-menus .v-popper__inner'
const SHOWN = '#knorke-menus .v-popper__popper--shown'
const DIALOG = '[data-knorke-dialog=shortcuts] .modal-container'
/** Job 229: the undo island and the tool bar's popovers. */
const UNDO = '.knorke-undo'
const TOOLPOP = '.knorke-toolpop'
const PICKER = '.knorke-reactpicker'
/** Rounding of sizes (px). */
const TOL = 0.5

/** The computed look of the first match (null when absent). */
function look(page, sel) {
	return page.evaluate((s) => {
		const el = document.querySelector(s)
		if (!el) return null
		const cs = getComputedStyle(el)
		const r = el.getBoundingClientRect()
		return {
			w: r.width,
			h: r.height,
			radius: cs.borderTopLeftRadius,
			shadow: cs.boxShadow,
			outline: cs.outlineStyle + ' ' + cs.outlineColor,
			border: cs.borderTopWidth,
			bg: cs.backgroundColor,
			color: cs.color,
		}
	}, sel)
}

/** Is the menu in #knorke-menus fully faded in? */
const shown = (page) => page.evaluate((s) => {
	const el = document.querySelector(s)
	return !!el && getComputedStyle(el).opacity === '1'
}, SHOWN)

/** Clicks the centre of item `id`; true when it is the selection then. */
async function clickItem(page, id) {
	const r = await K.rect(page, id)
	if (!r) return false
	await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2)
	return until(async () => ((await K.selection(page)) || []).join() === id, { timeout: 3000 })
}

/** Clicks connector `id` a quarter, then three quarters along its route; true when it is the selection then. */
async function clickConnector(page, id) {
	for (const f of [0.25, 0.75]) {
		const g = await K.connector(page, id)
		if (!g) return false
		const pt = await K.w2s(page, g.start.x + (g.end.x - g.start.x) * f, g.start.y + (g.end.y - g.start.y) * f)
		await page.mouse.click(pt.x, pt.y)
		if (await until(async () => ((await K.selection(page)) || []).join() === id, { timeout: 1500 })) return true
	}
	return false
}

/** Does the open panel of the context bar lie inside the window, and can every button in it be hit at its centre? */
function panelReach(page) {
	return page.evaluate(() => {
		const panel = document.querySelector('.knorke-contextbar__panel')
		const p = panel.getBoundingClientRect()
		const bad = []
		let n = 0
		for (const el of panel.querySelectorAll('button')) {
			const r = el.getBoundingClientRect()
			if (r.width === 0 || r.height === 0) continue
			const [x, y] = [r.x + r.width / 2, r.y + r.height / 2]
			if (y < p.y || y > p.y + p.height) continue
			n++
			const hit = document.elementFromPoint(x, y)
			if (!hit || !(hit === el || el.contains(hit))) bad.push({ label: el.getAttribute('aria-label') ?? el.textContent.trim(), hit: String(hit?.className ?? hit?.tagName ?? null).slice(0, 60) })
		}
		const inside = p.x >= -0.5 && p.x + p.width <= window.innerWidth + 0.5
		return { inside, n, bad, panel: [p.x, p.y, p.width, p.height].map(Math.round), w: window.innerWidth }
	})
}

/** Saves a picture of the page as E92-<name>.png in shots/; false when it fails. */
async function picture(page, name) {
	const dir = path.join(outDir(), 'shots')
	fs.mkdirSync(dir, { recursive: true })
	return page.screenshot({ path: path.join(dir, `E92-${name}.png`), timeout: 5000 }).then(() => true, () => false)
}

const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= TOL
/** (4) The touch devices in edit mode (touch plus a fine pointer, as E39): fits = the whole tool bar without scrolling. */
const TOUCH_EDIT = [
	{ name: 'phone', viewport: { width: 390, height: 844 }, fits: true },
	{ name: 'phone-small', viewport: { width: 360, height: 740 }, fits: false },
	{ name: 'tablet-across', viewport: { width: 1316, height: 740 }, fits: true },
]

/**
 * Can every tool button (the ones the tool bar shows; it may scroll) and
 * "Back" be hit at its centre? And do the tool bar, the top bar, the zoom
 * controls and (job 229) the undo island keep clear of each other, the
 * undo island inside the window?
 */
function reach(page) {
	return page.evaluate(() => {
		const box = (el) => (el ? el.getBoundingClientRect() : null)
		const bar = box(document.querySelector('[data-knorke-toolbar]'))
		const sels = ['[data-knorke-toolbar] [data-knorke-tool]', '[data-knorke-action=back]']
		const bad = []
		let n = 0
		for (const sel of sels) {
			for (const el of document.querySelectorAll(sel)) {
				const r = el.getBoundingClientRect()
				const [x, y] = [r.x + r.width / 2, r.y + r.height / 2]
				if (r.width === 0 || (el.closest('[data-knorke-toolbar]') && (y < bar.y || y > bar.y + bar.height))) continue
				n++
				const hit = document.elementFromPoint(x, y)
				if (!hit || !(hit === el || el.contains(hit))) bad.push({ el: el.getAttribute('data-knorke-tool') ?? el.getAttribute('data-knorke-action'), hit: String(hit?.className ?? hit?.tagName ?? null).slice(0, 60) })
			}
		}
		const top = box(document.querySelector('[data-knorke-bar=top]'))
		const zoom = box(document.querySelector('.knorke-zoom'))
		const undo = box(document.querySelector('.knorke-undo'))
		const apart = (a, b) => !a || !b || a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5
		const inside = !!undo && undo.x >= -0.5 && undo.x + undo.width <= window.innerWidth + 0.5 && undo.y + undo.height <= window.innerHeight + 0.5
		const clear = apart(bar, top) && apart(bar, zoom) && apart(bar, undo) && apart(undo, zoom) && inside
		const r = (b) => (b ? [b.x, b.y, b.width, b.height].map(Math.round) : null)
		return { n, bad, clear, boxes: { toolbar: r(bar), top: r(top), zoom: r(zoom), undo: r(undo) } }
	})
}

/**
 * (Job 244) The fill of the first match and the colour of its icon, beside
 * Nextcloud's accent pair as the page resolves it there (null when absent):
 * the accent element and its text, in the dark theme the colour the admin
 * set and its text (Nextcloud's dark accent element is light with black).
 */
function accent(page, sel) {
	return page.evaluate((s) => {
		const el = document.querySelector(s)
		if (!el) return null
		const dark = document.body.getAttribute('data-knorke-dark') === 'b'
		const probe = document.createElement('span')
		probe.style.background = dark ? 'var(--color-primary)' : 'var(--color-primary-element)'
		probe.style.color = dark ? 'var(--color-primary-text)' : 'var(--color-primary-element-text)'
		el.parentElement.appendChild(probe)
		const want = { bg: getComputedStyle(probe).backgroundColor, color: getComputedStyle(probe).color }
		probe.remove()
		const svg = el.querySelector('svg')
		const path = svg?.querySelector('path')
		return { bg: getComputedStyle(el).backgroundColor, icon: svg ? getComputedStyle(svg).color : null, fill: path ? getComputedStyle(path).fill : null, want }
	}, sel)
}
const isAccent = (x) => !!x && x.bg === x.want.bg && x.icon === x.want.color && (x.fill === null || x.fill === x.want.color) && x.want.color === 'rgb(255, 255, 255)'
/** accent() once Nextcloud's button transition (0.1 s) has run: polls until the state is `on` (at most 3 s), the last look either way. */
async function settled(page, sel, on = true) {
	let x = null
	await until(async () => {
		x = await accent(page, sel)
		return !!x && isAccent(x) === on && !/^oklab/.test(x.bg)
	}, { timeout: 3000 })
	return x
}

const isBar = (l) => !!l && l.radius === '12px' && l.shadow !== 'none' && /^solid rgba\(0, 0, 0, 0\)/.test(l.outline) && l.border === '0px'

export const E92 = {
	id: 'E92',
	title: 'Neuer Look (Job 226): Leisten 44 px (52 px mit Finger), Radius 12 für Leisten und Menüs, 16 für Dialoge, Schatten statt Rand, Dunkelmodus (b) mit heller Leinwand',
	async run(t, world) {
		const B = await world.board(TITLE)
		const N = ulid()
		const S = ulid()
		const C = ulid()
		const Y = ulid()
		const res = await seedOps('alice', B, [
			put.sticky(N, { x: 0, y: 0, data: { text: 'E92 Notiz' } }),
			put.shape(S, { x: 0, y: 240, w: 180, h: 80, data: { kind: 'rect', text: 'E92 Form' } }),
			put.connector(C, { x: 0, y: 380 }, { x: 180, y: 380 }),
			// job 244: a symbol in Phosphor Duotone
			put.shape(Y, { x: 300, y: 240, w: 96, h: 96, data: { kind: 'iconStar', text: '' }, style: { fill: '#c43e45', strokeWidth: 0 } }),
		])
		t.must(res.length === 4 && res.every((x) => x === 'ok'), '[D] Vorbedingung: eine Notiz, eine Form, ein Verbinder und ein Stern-Symbol liegen auf dem Board', res)

		t.step('(1) Maus, 1280 × 800: Leisten, Menüs, Dialog')
		const a = await world.actor('alice-look', { user: 'alice', viewport: VIEW })
		const p = a.page
		try {
			await openBoard(a, B)
			t.must(await until(async () => !!(await look(p, TOOLS)) && !!(await look(p, ZOOM)), { timeout: 10000 }), '[D] Vorbedingung: Werkzeugleiste und Zoom-Leiste stehen da (breites Layout, Modus Edit)')
			const top = await look(p, LEFT)
			const right = await look(p, RIGHT)
			const tools = await look(p, TOOLS)
			const select = await look(p, `${TOOLS} [data-knorke-tool=select]`)
			const zoom = await look(p, ZOOM)
			const undo = await look(p, UNDO)
			await picture(p, 'desktop')
			t.check(near(top?.h, 44) && near(right?.h, 44) && near(zoom?.h, 44), '[C] (1) beide Inseln der Kopfleiste (Job 228) und die Zoom-Leiste sind 44 px hoch', { top, right, zoom })
			t.check(near(undo?.h, 44) && isBar(undo), '[C] (1) die Rückgängig-Insel (Job 229) ist 44 px hoch, mit 12 px Radius, Schatten und transparentem Rand', undo)
			t.check(near(select?.w, 36) && near(select?.h, 36), '[C] (1) die Knöpfe der Werkzeugleiste sind 36 × 36 px', select)
			t.check(isBar(top) && isBar(right) && isBar(tools) && isBar(zoom), '[C] (1) jede Leiste und Insel hat 12 px Radius, einen Schatten und einen transparenten Rand (Outline, kein Border)', { top, right, tools, zoom })
			t.check(await p.evaluate(() => !document.body.hasAttribute('data-knorke-dark')), '[C] (1) helles Thema: <body> ohne data-knorke-dark')
			// job 244: the active tool in the accent, also hovered; another tool without
			const active = await settled(p, `${TOOLS} [data-knorke-tool=select]`)
			await p.locator(`${TOOLS} [data-knorke-tool=select]`).first().hover()
			const hovered = await settled(p, `${TOOLS} [data-knorke-tool=select]`)
			const idle = await settled(p, `${TOOLS} [data-knorke-tool=sticky]`, false)
			t.check(isAccent(active) && isAccent(hovered), '[C] (1) Job 244: das aktive Werkzeug ist in der Akzentfarbe gefüllt, sein Symbol weiß, auch unter der Maus', { active, hovered })
			t.check(!!idle && idle.bg !== idle.want.bg, '[C] (1) Job 244: ein nicht aktives Werkzeug hat keine Akzentfläche', idle)
			// job 229: the variants are a popover of tiles (a right-click on the tool)
			await p.locator('[data-knorke-tool=sticky]').first().click({ button: 'right' })
			t.must(await until(async () => !!(await look(p, TOOLPOP)), { timeout: 5000 }), '[D] Vorbedingung: die Varianten der Notiz sind offen')
			const menu = await look(p, TOOLPOP)
			const icons = await p.evaluate(() => [...document.querySelectorAll('[data-knorke-tool-variants] [data-knorke-tool-option]')].map((el) => !!el.querySelector('svg path[d]')))
			await picture(p, 'tool-options')
			t.check(menu?.radius === '12px' && menu.shadow !== 'none', '[C] (1) das Varianten-Popover hat 12 px Radius und einen Schatten', menu)
			t.check(icons.length === 2 && icons.every(Boolean), '[C] (1) Notiz und Notizblock zeigen je ein Bild', icons)
			const tile = await settled(p, `${TOOLPOP} [aria-pressed=true]`)
			const opened = await settled(p, `${TOOLS} [data-knorke-tool=sticky]`)
			t.check(isAccent(tile), '[C] (1) Job 244: die gewählte Kachel der Varianten ist in der Akzentfarbe, ihr Bild weiß', tile)
			t.check(isAccent(opened), '[C] (1) Job 244: das Werkzeug mit offenen Varianten ist eingeschaltet (Akzentfläche)', opened)
			await p.keyboard.press('Escape')
			t.must(await until(async () => !(await look(p, TOOLPOP)), { timeout: 5000 }), '[D] Vorbedingung: das Varianten-Popover ist zu')

			await p.locator('[data-knorke-tool=frame]').first().click({ button: 'right' })
			t.must(await until(async () => !!(await look(p, TOOLPOP)), { timeout: 5000 }), '[D] Vorbedingung: die Varianten des Frames sind offen')
			const frameIcons = await p.evaluate(() => [...document.querySelectorAll('[data-knorke-tool-variants] [data-knorke-tool-option]')].map((el) => !!el.querySelector('svg path[d]')))
			await picture(p, 'frame-options')
			t.check(frameIcons.length === 2 && frameIcons.every(Boolean), '[C] (1) Frame und Swimlanes zeigen je ein Bild', frameIcons)
			await p.keyboard.press('Escape')
			t.must(await until(async () => !(await look(p, TOOLPOP)), { timeout: 5000 }), '[D] Vorbedingung: das Frame-Popover ist zu')

			await p.locator('[data-knorke-tool=connector]').first().click({ button: 'right' })
			t.must(await until(async () => !!(await look(p, TOOLPOP)), { timeout: 5000 }), '[D] Vorbedingung: die Varianten des Verbinders sind offen')
			await picture(p, 'connector-options')
			await p.keyboard.press('Escape')
			t.must(await until(async () => !(await look(p, TOOLPOP)), { timeout: 5000 }), '[D] Vorbedingung: das Verbinder-Popover ist zu')
			await p.locator('[data-knorke-tool=select]').first().click()

			// job 244: the context bar's pressed buttons; the connector's panels and the symbol as pictures
			t.must(await clickItem(p, S), '[D] Vorbedingung: die Form ist ausgewählt', await K.selection(p))
			await p.locator('.knorke-contextbar [data-knorke-section=kind]').first().click()
			t.must(await until(async () => !!(await look(p, '.knorke-contextbar__panel')), { timeout: 5000 }), '[D] Vorbedingung: das Panel „Change shape“ ist offen')
			const kindToggle = await settled(p, '.knorke-contextbar [data-knorke-section=kind]')
			const kindPressed = await settled(p, '.knorke-contextbar__panel .button-vue[aria-pressed=true]')
			await picture(p, 'shape-kind')
			t.check(isAccent(kindToggle) && isAccent(kindPressed), '[C] (1) Job 244: „Change shape“ bei offenem Panel und die gewählte Art darin sind in der Akzentfarbe, Symbol weiß', { kindToggle, kindPressed })
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Escape')
			await p.keyboard.press('Escape')
			t.must(await clickConnector(p, C), '[D] Vorbedingung: der Verbinder ist ausgewählt', await K.selection(p))
			for (const section of ['route', 'caps', 'color']) {
				await p.locator(`.knorke-contextbar [data-knorke-section=${section}]`).first().click()
				t.must(await until(async () => !!(await look(p, '.knorke-contextbar__panel')), { timeout: 5000 }), `[D] Vorbedingung: das Panel „${section}“ des Verbinders ist offen`)
				await picture(p, 'connector-' + section)
			}
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Escape')
			await p.keyboard.press('Escape')
			await p.locator(`${TOOLS} [data-knorke-tool=shape]`).first().click()
			t.must(await until(async () => !!(await look(p, '[data-knorke-shapes]')), { timeout: 5000 }), '[D] Vorbedingung: das Formen-Fenster ist offen')
			const shapeTool = await settled(p, `${TOOLS} [data-knorke-tool=shape]`)
			const symbolPreview = await p.evaluate(() => [...document.querySelectorAll('[data-knorke-shapes] .knorke-shapepreview__duo')].length)
			await picture(p, 'shapes-panel')
			t.check(isAccent(shapeTool), '[C] (1) Job 244: „Formen“ bei offenem Formen-Fenster ist in der Akzentfarbe', shapeTool)
			t.check(symbolPreview >= 20, '[C] (1) Job 244: die 20 Symbole im Formen-Fenster zeigen ihre Duotone-Fläche', symbolPreview)
			await p.locator(`${TOOLS} [data-knorke-tool=shape]`).first().click()
			await p.locator(`${TOOLS} [data-knorke-tool=select]`).first().click()
			const star = await K.rect(p, Y)
			t.must(!!star, '[D] Vorbedingung: das Stern-Symbol hat ein Bildschirmrechteck', star)
			await p.screenshot({ path: path.join(outDir(), 'shots', 'E92-symbol.png'), clip: { x: Math.max(0, star.x - 24), y: Math.max(0, star.y - 24), width: star.w + 48, height: star.h + 48 }, timeout: 5000 }).catch(() => {})
			await p.locator(`${TOP} [data-knorke-action=comments]`).first().click()
			t.must(await until(async () => (await p.locator(`${TOP} [data-knorke-action=comments]`).first().getAttribute('aria-pressed')) === 'true', { timeout: 5000 }), '[D] Vorbedingung: das Kommentarfenster ist offen')
			const comments = await settled(p, `${TOP} [data-knorke-action=comments]`)
			await picture(p, 'comments')
			t.check(isAccent(comments), '[C] (1) Job 244: „Comments“ bei offenem Kommentarfenster ist in der Akzentfarbe, Symbol weiß', comments)
			await p.locator(`${TOP} [data-knorke-action=comments]`).first().click()
			t.must(await until(async () => (await p.locator(`${TOP} [data-knorke-action=comments]`).first().getAttribute('aria-pressed')) === 'false', { timeout: 5000 }), '[D] Vorbedingung: das Kommentarfenster ist zu')

			await p.locator(`${TOP} [data-knorke-menu=board] button`).first().click()
			t.must(await until(() => shown(p), { timeout: 5000 }), '[D] Vorbedingung: das Board-Menü „More“ ist offen')
			const board = await look(p, MENU)
			await picture(p, 'board-menu')
			t.check(board?.radius === '12px', '[C] (1) das Board-Menü hat 12 px Radius', board)
			await p.keyboard.press('Escape')
			t.must(await until(async () => !(await look(p, MENU)), { timeout: 5000 }), '[D] Vorbedingung: das Board-Menü ist zu')

			// job 229: "Keyboard shortcuts" from the zoom menu
			await p.locator('[data-knorke-menu=zoom] button').first().click()
			t.must(await until(() => shown(p), { timeout: 5000 }), '[D] Vorbedingung: das Zoom-Menü ist offen')
			await p.locator('#knorke-menus [data-knorke-action=shortcuts]').first().click()
			t.must(await until(() => p.evaluate((s) => { const el = document.querySelector(s)?.closest('.modal-mask'); return !!el && getComputedStyle(el).opacity === '1' }, DIALOG), { timeout: 5000 }), '[D] Vorbedingung: der Dialog „Keyboard shortcuts“ ist offen')
			const dialog = await look(p, DIALOG)
			await picture(p, 'dialog')
			t.check(dialog?.radius === '16px' && dialog.shadow !== 'none', '[C] (1) der Dialog hat 16 px Radius und einen Schatten', dialog)
			await p.keyboard.press('Escape')
			t.must(await until(async () => !(await look(p, DIALOG)), { timeout: 5000 }), '[D] Vorbedingung: der Dialog ist zu')

			// round 1 (fresh review): the reaction picker is a panel of level 2 as well
			const r = await K.rect(p, N)
			t.must(!!r, '[D] Vorbedingung: die Notiz hat ein Bildschirmrechteck', r)
			await p.mouse.click(r.x + r.w / 2, r.y + r.h / 2)
			t.must(await until(async () => (await p.evaluate(() => window.__knorke.selection())).join() === N, { timeout: 5000 }), '[D] Vorbedingung: die Notiz ist ausgewählt')
			await p.locator('.knorke-contextbar [data-knorke-action=react]').first().click()
			t.must(await until(async () => !!(await look(p, PICKER)), { timeout: 5000 }), '[D] Vorbedingung: der Reaktionswähler ist offen')
			const picker = await look(p, PICKER)
			await picture(p, 'reactions')
			t.check(picker?.radius === '12px' && picker.shadow !== 'none' && /^solid rgba\(0, 0, 0, 0\)/.test(picker.outline), '[C] (1) der Reaktionswähler hat 12 px Radius, einen Schatten und einen transparenten Rand', picker)
			await p.keyboard.press('Escape')
		} finally {
			await world.drop(a)
		}

		t.step('(2) Tablet mit Finger: 52 px')
		const b = await world.actor('alice-look-touch', { user: 'alice', touch: true })
		try {
			await openBoard(b, B)
			t.must(await until(async () => !!(await look(b.page, LEFT)), { timeout: 10000 }), '[D] Vorbedingung: die Kopfleiste steht da (Tablet)')
			const topT = await look(b.page, LEFT)
			await picture(b.page, 'tablet')
			t.check(near(topT?.h, 52), '[C] (2) mit Finger ist die Kopfleiste 52 px hoch', topT)
		} finally {
			await world.drop(b)
		}

		t.step('(3) Dunkles Thema: Leisten #2b2c30, Leinwand hell')
		const c = await world.actor('alice-look-dark', { user: 'alice', viewport: VIEW, colorScheme: 'dark' })
		try {
			await openBoard(c, B)
			t.must(await until(async () => !!(await look(c.page, LEFT)), { timeout: 10000 }), '[D] Vorbedingung: die Kopfleiste steht da (dunkles Thema)')
			t.check(await until(() => c.page.evaluate(() => document.body.getAttribute('data-knorke-dark') === 'b'), { timeout: 5000 }), '[C] (3) <body data-knorke-dark="b"> im dunklen Thema')
			const topD = await look(c.page, RIGHT)
			const canvas = await look(c.page, CANVAS)
			await c.page.locator(`${TOP} [data-knorke-menu=board] button`).first().click()
			t.must(await until(() => shown(c.page), { timeout: 5000 }), '[D] Vorbedingung: das Board-Menü ist offen (dunkles Thema)')
			const menuD = await look(c.page, MENU)
			await picture(c.page, 'dark')
			t.check(topD?.bg === 'rgb(43, 44, 48)' && topD.color === 'rgb(235, 235, 235)', '[C] (3) die Insel der Kopfleiste ist #2b2c30 mit Text #ebebeb', topD)
			t.check(menuD?.bg === 'rgb(43, 44, 48)', '[C] (3) das Board-Menü ist ebenfalls #2b2c30', menuD)
			t.check(canvas?.bg === 'rgb(243, 242, 240)', '[C] (3) die Leinwand bleibt hell (#f3f2f0)', canvas)
			// job 244: switched-on buttons keep the accent in the dark theme
			await c.page.keyboard.press('Escape')
			t.must(await until(async () => !(await look(c.page, MENU)), { timeout: 5000 }), '[D] Vorbedingung: das Board-Menü ist zu (dunkles Thema)')
			const activeD = await settled(c.page, `${TOOLS} [data-knorke-tool=select]`)
			await c.page.locator(`${TOP} [data-knorke-action=comments]`).first().click()
			t.must(await until(async () => (await c.page.locator(`${TOP} [data-knorke-action=comments]`).first().getAttribute('aria-pressed')) === 'true', { timeout: 5000 }), '[D] Vorbedingung: das Kommentarfenster ist offen (dunkles Thema)')
			const commentsD = await settled(c.page, `${TOP} [data-knorke-action=comments]`)
			await picture(c.page, 'dark-active')
			t.check(isAccent(activeD) && isAccent(commentsD), '[C] (3) Job 244: aktives Werkzeug und offenes „Comments“ sind auch im dunklen Thema in der Akzentfarbe, Symbol weiß', { activeD, commentsD })
		} finally {
			await world.drop(c)
		}
		t.step('(4) Bearbeiten mit Stift oder Finger: Telefon, schmales Telefon, Tablet quer – jeder Werkzeugknopf und „Zurück“ bleiben erreichbar')
		for (const dev of TOUCH_EDIT) {
			const d = await world.actor('alice-look-' + dev.name, { user: 'alice', touch: true, fine: true, viewport: dev.viewport })
			const q = d.page
			try {
				await openBoard(d, B)
				t.must(await until(async () => !!(await look(q, TOOLS)), { timeout: 10000 }), `[D] Vorbedingung: ${dev.name} im Modus edit mit Werkzeugleiste`)
				const plain = await reach(q)
				await picture(q, dev.name)
				t.check(plain.bad.length === 0 && plain.n >= 7, `[C] (4) ${dev.name}: jeder sichtbare Werkzeugknopf und „Zurück“ sind erreichbar`, plain)
				t.check(plain.clear, `[C] (4) ${dev.name}: Werkzeugleiste, Zoomleiste und Rückgängig-Insel liegen frei voneinander und von der Kopfleiste, die Insel ganz im Bild`, plain.boxes)
				t.check(!dev.fits || plain.n >= 9, `[C] (4) ${dev.name}: alle acht Knöpfe und „Zurück“ ohne Scrollen sichtbar`, plain.n)

				const r = await K.rect(q, N)
				await q.mouse.click(r.x + r.w / 2, r.y + r.h / 2)
				t.must(await until(async () => (await q.evaluate(() => window.__knorke.selection())).join() === N && !!(await look(q, '.knorke-contextbar')), { timeout: 5000 }), `[D] Vorbedingung: ${dev.name}: die Notiz ist ausgewählt, die Kontextleiste steht`)
				const picked = await reach(q)
				await picture(q, dev.name + '-selected')
				t.check(picked.bad.length === 0, `[C] (4) ${dev.name} mit Auswahl: kein Werkzeugknopf und nicht „Zurück“ unter der Kontextleiste`, picked)
				t.check(picked.clear, `[C] (4) ${dev.name} mit Auswahl: Rückgängig-Insel ganz im Bild, Werkzeugleiste frei`, picked.boxes)
				// round 3 (fresh review): the panels of the context bar stay inside the window, every button in them can be hit
				for (const [what, sel] of [['Form', S], ['Verbinder', C]]) {
					await q.locator(CANVAS).first().focus()
					await q.keyboard.press('Escape')
					await q.keyboard.press('Escape')
					const ok = what === 'Form' ? await clickItem(q, S) : await clickConnector(q, C)
					t.must(ok, `[D] Vorbedingung: ${dev.name}: ${what} ausgewählt`, await K.selection(q))
					const section = what === 'Form' ? 'text' : 'caps'
					// job 230: "Text" is a tab of the colour panel
					if (section === 'text') await colorTab(q, 'text')
					else await q.locator(`.knorke-contextbar [data-knorke-section=${section}]`).first().click()
					t.must(await until(async () => !!(await look(q, '.knorke-contextbar__panel')), { timeout: 5000 }), `[D] Vorbedingung: ${dev.name}: das Panel „${section}“ ist offen`)
					const pan = await panelReach(q)
					await picture(q, `${dev.name}-panel-${section}`)
					t.check(pan.inside && pan.n >= 4 && pan.bad.length === 0, `[C] (4) ${dev.name}: das Panel „${section}“ (${what}) liegt ganz im Fenster, jeder Knopf darin ist erreichbar`, pan)
				}
				await q.locator(CANVAS).first().focus()
				await q.keyboard.press('Escape')
				await q.keyboard.press('Escape')

				await d.ctx.setOffline(true)
				t.must(await until(() => q.locator('[data-knorke-banner=offline]').first().isVisible().catch(() => false), { timeout: 15000 }), `[D] Vorbedingung: ${dev.name}: der Hinweis „Offline“ steht`)
				const noticed = await reach(q)
				await picture(q, dev.name + '-notice')
				t.check(noticed.bad.length === 0, `[C] (4) ${dev.name} mit Hinweis: kein Werkzeugknopf und nicht „Zurück“ unter dem Hinweis`, noticed)
				await d.ctx.setOffline(false)
			} finally {
				await world.drop(d)
			}
		}
	},
}
