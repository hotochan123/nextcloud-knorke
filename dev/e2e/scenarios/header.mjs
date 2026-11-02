/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E93 – the redesigned header (factory job 228, docs/redesign/ P1, P6, P11):
 * (1) alice, mouse, 1280 × 800, a board open by link: two islands of 44 px
 *     with 12 px radius, apart, the canvas between them; "Share" the primary
 *     button, "Facilitate" with its word
 * (2) the title: a click makes it a field, Enter renames, Esc does not
 * (3) "More": the root with "Export ▸", "Insert ▸" and "Keyboard
 *     shortcuts"; "Export" shows its six entries and a back entry, "Insert"
 *     four; closing goes back to the root; "Keyboard shortcuts" opens the
 *     overview
 * (4) the share dialog: the segment, three sections, "Show to the room"
 * (5) the comment panel: 296 px on the right, above the zoom controls
 * (6) bob (touch, the device notice) follows alice: one notice (following);
 *     its × closes it, following goes on, then the device notice stands;
 *     after Esc "Show everything" keeps the notes below the notice and off
 *     the islands
 * (7) alice at 800 px: the islands do not overlap, the participants as "+n"
 * (8) a guest on a phone (390 × 844, finger): one island over the width,
 *     title and subline "Guest · Open by link" are one target of 44 px that
 *     opens the privacy card, no "Share", no "Keyboard shortcuts" in "More"
 * (9) the owner on a phone: rename (title with subline) and the link icon
 *     are separate targets of 44 px; renaming keeps the island's height
 * Own board, no instance setting. Check labels start with exactly ONE owner
 * (SPEC-M1 §9.6): [C] the board in the browser, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap
 * 9.10).
 */
import { APP, CANVAS, K, action, api, field, openBoard, put, seedOps, ulid, until, waitReady } from '../lib/harness.mjs'

const TITLE = 'E93 Kopfzeile'
const VIEW = { width: 1280, height: 800 }
const LEFT = '[data-knorke-island=left]'
const RIGHT = '[data-knorke-island=right]'
const MENUS = '#knorke-menus'
const BOARD = '.knorke-board'
const NOTICE = '.knorke-banners > [data-knorke-bar=banner]'
/** Rounding of sizes (px). */
const TOL = 0.5

/** Bounding box and look of the first match (null when absent). */
function look(page, sel) {
	return page.evaluate((s) => {
		const el = document.querySelector(s)
		if (!el) return null
		const r = el.getBoundingClientRect()
		if (r.width === 0 && r.height === 0) return null
		const cs = getComputedStyle(el)
		return { x: r.x, y: r.y, w: r.width, h: r.height, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, cls: el.className }
	}, sel)
}

const near = (v, want, tol = TOL) => typeof v === 'number' && Math.abs(v - want) <= tol
const apart = (a, b) => !!a && !!b && (a.x + a.w <= b.x + TOL || b.x + b.w <= a.x + TOL || a.y + a.h <= b.y + TOL || b.y + b.h <= a.y + TOL)

/** The hooks of the visible entries of the open Knorke menu, in order. */
function menuHooks(page) {
	return page.evaluate((m) => [...document.querySelectorAll(`${m} [data-knorke-action], ${m} [data-knorke-submenu], ${m} [data-knorke-submenu-back], ${m} [data-knorke-legal]`)]
		.filter((el) => el.getBoundingClientRect().height > 0)
		.map((el) => (el.hasAttribute('data-knorke-submenu-back') ? 'back' : el.getAttribute('data-knorke-submenu') ? 'submenu:' + el.getAttribute('data-knorke-submenu') : el.getAttribute('data-knorke-action') ?? 'legal:' + el.getAttribute('data-knorke-legal'))), MENUS)
}

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

export const E93 = {
	id: 'E93',
	title: 'Kopfzeile als zwei Inseln (Job 228): Inseln 44 px mit freier Leinwand dazwischen, „Share“ primär, „Facilitate“ mit Wort, Titel per Klick umbenennen, „More“ mit „Export ▸“/„Insert ▸“, Teilen-Dialog mit „Show to the room“, Kommentar-Panel 296 px, ein Hinweis zur Zeit mit ×, „Alles zeigen“ frei vom Hinweis, 800 px ohne Überlappung, Telefon-Gast mit Unterzeile',
	async run(t, world) {
		const B = await world.board(TITLE)
		const share = await api('alice', 'PUT', `/api/v1/boards/${B}/shares`, { shares: [{ kind: 'user', id: 'bob', role: 'edit' }] })
		t.must(share.status === 200, '[D] Vorbedingung: das Board ist mit bob (Bearbeiten) geteilt', share.status)
		const token = await linkToken(B)
		const notes = [ulid(), ulid(), ulid(), ulid()]
		const corners = [[0, 0], [2400, 0], [0, 1400], [2400, 1400]]
		const res = await seedOps('alice', B, notes.map((id, i) => put.sticky(id, { x: corners[i][0], y: corners[i][1], data: { text: 'E93 ' + i } })))
		t.must(res.length === 4 && res.every((r) => r === 'ok'), '[D] Vorbedingung: vier Notizen in den Ecken', res)

		t.step('(1) Maus, 1280 × 800: zwei Inseln')
		const a = await world.actor('alice-header', { user: 'alice', viewport: VIEW })
		const p = a.page
		const others = []
		try {
			await openBoard(a, B)
			t.must(await until(async () => !!(await look(p, LEFT)) && !!(await look(p, RIGHT)), { timeout: 10000 }), '[D] Vorbedingung: beide Inseln stehen da')
			t.must(await until(async () => !!(await look(p, '[data-knorke-action=link-badge]')), { timeout: 10000 }), '[D] Vorbedingung: der Chip „Open by link“ steht da (Link an)')
			const board = await look(p, BOARD)
			const left = await look(p, LEFT)
			const right = await look(p, RIGHT)
			t.check(near(left.x, board.x + 8) && near(right.x + right.w, board.x + board.w - 8) && near(left.y, board.y + 8), '[C] (1) die linke Insel steht links, die rechte rechts (je 8 px Rand im Board)', { board, left, right })
			t.check(near(left.h, 44) && near(right.h, 44) && left.radius === '12px' && right.radius === '12px' && left.shadow !== 'none', '[C] (1) beide Inseln sind 44 px hoch mit 12 px Radius und Schatten', { left, right })
			t.check(apart(left, right), '[C] (1) die Inseln überlappen nicht', { left, right })
			const mid = { x: (left.x + left.w + right.x) / 2, y: left.y + left.h / 2 }
			t.check(await p.evaluate(([x, y, c]) => !!document.elementFromPoint(x, y)?.closest(c), [mid.x, mid.y, CANVAS]), '[C] (1) zwischen den Inseln liegt die Leinwand', mid)
			const shareBtn = await look(p, `${RIGHT} [data-knorke-action=share]`)
			t.check(!!shareBtn && /button-vue--primary/.test(shareBtn.cls), '[C] (1) „Share“ ist ein Primärknopf', shareBtn?.cls)
			// the chosen tool of the tool bar is pressed in the primary colour until its own redesign line
			const primaries = await p.evaluate((b) => [...document.querySelectorAll(`${b} .button-vue--primary`)].filter((el) => el.getBoundingClientRect().height > 0 && !el.closest('[data-knorke-toolbar]')).map((el) => el.getAttribute('data-knorke-action') ?? el.className), BOARD)
			t.check(primaries.length === 1, '[C] (1) außer dem gewählten Werkzeug hat das Board genau einen Primärknopf: „Share“', primaries)
			const facil = await p.locator(`${RIGHT} [data-knorke-menu=moderation] button[aria-haspopup]`).first().innerText().catch(() => '')
			t.check(/Facilitate/.test(facil), '[C] (1) „Facilitate“ zeigt sein Wort', facil)

			t.step('(2) Titel: Klick → Feld, Enter benennt um, Esc nicht')
			await p.locator('[data-knorke-action=rename-board]').first().click()
			t.must(await until(() => p.locator('[data-knorke-field=title]').first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (2) ein Klick macht den Titel zum Feld')
			await p.locator('[data-knorke-field=title]').first().fill('E93 Neu')
			await p.keyboard.press('Enter')
			t.check(await until(async () => (await p.locator('[data-knorke-action=rename-board]').first().innerText().catch(() => '')).trim() === 'E93 Neu', { timeout: 5000 }), '[C] (2) Enter speichert den neuen Titel')
			await p.locator('[data-knorke-action=rename-board]').first().click()
			await p.locator('[data-knorke-field=title]').first().fill('E93 Verworfen')
			await p.keyboard.press('Escape')
			t.check(await until(async () => (await p.locator('[data-knorke-action=rename-board]').first().innerText().catch(() => '')).trim() === 'E93 Neu', { timeout: 3000 }), '[C] (2) Esc bricht ab, der Titel bleibt')

			t.step('(3) „More“: Untermenüs in derselben Liste')
			const trigger = p.locator(`${RIGHT} [data-knorke-menu=board] button[aria-haspopup]`).first()
			await trigger.click()
			t.must(await until(async () => (await menuHooks(p)).includes('submenu:export'), { timeout: 5000 }), '[D] Vorbedingung: „More“ ist offen')
			const root = await menuHooks(p)
			t.check(root[0] === 'submenu:export' && root[1] === 'submenu:insert' && root.includes('keyboard-shortcuts') && !root.includes('export-png'), '[C] (3) oben „Export ▸“, „Insert ▸“, dann „Keyboard shortcuts“; kein Export-Eintrag', root)
			await p.locator(`${MENUS} [data-knorke-submenu=export]`).first().click()
			t.check(await until(async () => (await menuHooks(p)).join() === 'back,export-png,export-svg,export-pdf,export-bpmn,export-csv,download-board', { timeout: 3000 }), '[C] (3) „Export“ zeigt den Zurück-Eintrag und seine sechs Einträge; das Menü bleibt offen', await menuHooks(p))
			await p.locator(`${MENUS} [data-knorke-submenu-back]`).first().click()
			t.check(await until(async () => (await menuHooks(p))[0] === 'submenu:export', { timeout: 3000 }), '[C] (3) Zurück führt zur obersten Ebene', await menuHooks(p))
			await p.locator(`${MENUS} [data-knorke-submenu=insert]`).first().click()
			t.check(await until(async () => (await menuHooks(p)).join() === 'back,insert-template,insert-board-file,insert-bpmn-file,import-csv', { timeout: 3000 }), '[C] (3) „Insert“ zeigt seine vier Einträge', await menuHooks(p))
			await p.keyboard.press('Escape')
			t.must(await until(async () => (await menuHooks(p)).length === 0, { timeout: 3000 }), '[D] Vorbedingung: „More“ ist zu')
			await trigger.click()
			t.check(await until(async () => (await menuHooks(p))[0] === 'submenu:export', { timeout: 5000 }), '[C] (3) beim nächsten Öffnen steht die oberste Ebene', await menuHooks(p))
			await p.locator(`${MENUS} [data-knorke-action=keyboard-shortcuts]`).first().click()
			t.check(await until(() => p.locator('[data-knorke-dialog=shortcuts]').first().isVisible().catch(() => false), { timeout: 5000 }), '[C] (3) „Keyboard shortcuts“ öffnet die Übersicht')
			await p.keyboard.press('Escape')
			t.must(await until(async () => !(await p.locator('[data-knorke-dialog=shortcuts]').first().isVisible().catch(() => false)), { timeout: 5000 }), '[D] Vorbedingung: die Übersicht ist zu')

			t.step('(4) Teilen-Dialog: Segment, drei Abschnitte, „Show to the room“')
			await p.locator(`${RIGHT} [data-knorke-action=share]`).first().click()
			t.must(await until(() => p.locator('.knorke-share [data-knorke-share-room]').first().isVisible().catch(() => false), { timeout: 8000 }), '[C] (4) der Abschnitt „Show to the room“ steht im Dialog')
			t.check((await p.locator('.knorke-share__tabs [data-knorke-share-tab]').count()) === 2, '[C] (4) das Segment „People / Links“')
			const order = await p.evaluate(() => [...document.querySelectorAll('.knorke-share [data-knorke-link], .knorke-share [data-knorke-share-room]')].map((el) => el.getAttribute('data-knorke-link') ?? 'room'))
			t.check(order.join() === 'edit,vote,room' || order.join() === 'edit,room', '[C] (4) Bearbeitungslink, Abstimmungslink, dann „Show to the room“', order)
			t.check((await p.locator('.knorke-share [data-knorke-link] [data-knorke-action=link-present]').count()) === 0, '[C] (4) kein „Show to the room“ mehr in den Link-Abschnitten')
			await p.locator('.knorke-share [data-knorke-share-room] [data-knorke-present=edit]').first().click()
			t.check(await until(() => p.locator('[data-knorke-dialog=present-link]').first().isVisible().catch(() => false), { timeout: 5000 }), '[C] (4) „Edit link“ zeigt den Link dem Raum')
			await p.keyboard.press('Escape')
			await until(async () => !(await p.locator('[data-knorke-dialog=present-link]').first().isVisible().catch(() => false)), { timeout: 5000 })
			await p.keyboard.press('Escape')
			t.must(await until(async () => (await p.locator('.knorke-share').count()) === 0, { timeout: 5000 }), '[D] Vorbedingung: der Teilen-Dialog ist zu')

			t.step('(5) Kommentar-Panel: 296 px rechts, über der Zoom-Leiste')
			await p.locator(`${RIGHT} [data-knorke-action=comments]`).first().click()
			t.must(await until(async () => !!(await look(p, '[data-knorke-comments]')), { timeout: 5000 }), '[D] Vorbedingung: das Kommentar-Panel ist offen')
			const panel = await look(p, '[data-knorke-comments]')
			const zoom = await look(p, '.knorke-zoom')
			const right2 = await look(p, RIGHT)
			t.check(near(panel.w, 296) && near(panel.x + panel.w, board.x + board.w - 8), '[C] (5) das Panel ist 296 px breit, 8 px vom rechten Rand des Boards', { panel, board })
			t.check(!!zoom && panel.y + panel.h <= zoom.y + TOL && panel.y >= right2.y + right2.h - TOL, '[C] (5) es endet über der Zoom-Leiste und beginnt unter der rechten Insel', { panel, zoom, right: right2 })
			await p.locator('[data-knorke-action=comments-close]').first().click()

			t.step('(6) bob mit Finger folgt alice: ein Hinweis, × schließt ihn, dann der Geräte-Hinweis; „Alles zeigen“ frei davon')
			const b = await world.actor('bob-header', { user: 'bob', touch: true, viewport: VIEW })
			others.push(b)
			await openBoard(b, B)
			const pb = b.page
			t.must(await until(async () => (await pb.locator(NOTICE).count()) === 1 && (await pb.locator('.knorke-banner--role').count()) === 1, { timeout: 10000 }), '[D] Vorbedingung: bob sieht den Geräte-Hinweis')
			const avatar = pb.locator(`${RIGHT} [data-knorke-participant]`).first()
			t.must(await until(() => avatar.isVisible().catch(() => false), { timeout: 15000 }), '[D] Vorbedingung: bob sieht alices Avatar')
			await avatar.click()
			t.check(await until(async () => !!(await K.state(pb))?.following, { timeout: 5000 }), '[C] (6) ein Tipp auf den Avatar folgt alice')
			t.check(await until(async () => (await pb.locator(NOTICE).count()) === 1 && (await pb.locator('[data-knorke-banner=following]').count()) === 1, { timeout: 5000 }), '[C] (6) genau ein Hinweis: „Following …“ (der Geräte-Hinweis wartet)', await pb.locator(NOTICE).count())
			const closeBox = await look(pb, '[data-knorke-banner=following] [data-knorke-action=notice-close]')
			t.check(!!closeBox && closeBox.w >= 44 - TOL && closeBox.h >= 44 - TOL, '[C] (6) das × des Hinweises ist mit dem Finger mindestens 44 × 44 px groß', closeBox)
			await pb.locator('[data-knorke-banner=following] [data-knorke-action=notice-close]').first().click()
			t.check(await until(async () => (await pb.locator('[data-knorke-banner=following]').count()) === 0 && (await pb.locator('.knorke-banner--role').count()) === 1, { timeout: 5000 }), '[C] (6) × schließt den Hinweis; danach steht der Geräte-Hinweis')
			t.check(!!(await K.state(pb))?.following && (await avatar.getAttribute('aria-pressed')) === 'true', '[C] (6) bob folgt weiter (Avatar gedrückt)', await K.state(pb))
			await pb.keyboard.press('Escape')
			t.must(await until(async () => !(await K.state(pb))?.following, { timeout: 5000 }), '[D] Vorbedingung: Esc beendet das Folgen')
			t.check((await pb.locator('[data-knorke-banner=following]').count()) === 0, '[C] (6) ohne Folgen kein Folgen-Hinweis')
			await pb.locator('.knorke-zoom button[aria-label="Show everything"]').first().click()
			let fit = null
			await until(async () => {
				const notice = await look(pb, NOTICE)
				const isl = [await look(pb, LEFT), await look(pb, RIGHT)]
				const rects = []
				for (const id of notes) rects.push(await K.rect(pb, id).catch(() => null))
				fit = { notice, isl, rects }
				return !!notice && rects.every((r) => r && r.y >= notice.y + notice.h - TOL && isl.every((i) => apart({ x: r.x, y: r.y, w: r.w, h: r.h }, i)))
			}, { timeout: 5000 })
			t.check(!!fit?.notice && fit.rects.every((r) => r && r.y >= fit.notice.y + fit.notice.h - TOL), '[C] (6) „Alles zeigen“: jede Notiz unter der Unterkante des Hinweises', fit)
			t.check(!!fit && fit.rects.every((r) => r && fit.isl.every((i) => apart({ x: r.x, y: r.y, w: r.w, h: r.h }, i))), '[C] (6) „Alles zeigen“: keine Notiz unter einer Insel', fit)
		} finally {
			for (const x of others) await world.drop(x)
			await world.drop(a)
		}

		t.step('(7) 800 px breit: die Inseln überlappen nicht, Avatare als „+n“')
		const m = await world.actor('alice-header-800', { user: 'alice', viewport: { width: 800, height: 800 } })
		try {
			await openBoard(m, B)
			t.must(await until(async () => !!(await look(m.page, LEFT)) && !!(await look(m.page, RIGHT)), { timeout: 10000 }), '[D] Vorbedingung: beide Inseln stehen da (800 px)')
			const l = await look(m.page, LEFT)
			const r = await look(m.page, RIGHT)
			t.check(apart(l, r), '[C] (7) bei 800 px überlappen die Inseln nicht', { l, r })
			t.check((await m.page.locator(`${RIGHT} [data-knorke-participant]:visible`).count()) === 0 && (await m.page.locator(`${RIGHT} [data-knorke-action=participants]`).count()) === 1, '[C] (7) die Anwesenden nur als „+n“')
			t.check((await m.page.locator('[data-knorke-action=link-badge] .knorke-topbar__linkbadge-text').count()) === 0, '[C] (7) der Chip „Open by link“ nur als Icon')
			// round 2: the list "+n" lies over the privacy card (the top stack of the notices)
			if (!(await m.page.locator('[data-knorke=privacy-info]').first().isVisible().catch(() => false))) await m.page.locator('[data-knorke-action=link-badge]').first().click()
			t.must(await until(() => m.page.locator('[data-knorke=privacy-info]').first().isVisible().catch(() => false), { timeout: 3000 }), '[D] Vorbedingung: die Datenschutz-Karte ist offen (800 px)')
			await m.page.locator(`${RIGHT} [data-knorke-action=participants]`).first().click()
			t.must(await until(async () => !!(await look(m.page, '.knorke-presence__popover')), { timeout: 3000 }), '[D] Vorbedingung: die Liste der Anwesenden ist offen (800 px)')
			const pop = await look(m.page, '.knorke-presence__popover')
			const card = await look(m.page, '[data-knorke=privacy-info]')
			t.must(!apart(pop, card), '[D] Vorbedingung: Liste und Karte überschneiden sich (800 px)', { pop, card })
			const at = { x: Math.max(pop.x, card.x) + 8, y: Math.max(pop.y, card.y) + 8 }
			t.check(await m.page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.knorke-presence__popover'), [at.x, at.y]), '[C] (7) die Liste „Present (n)“ liegt über der Datenschutz-Karte', { at, pop, card })
		} finally {
			await world.drop(m)
		}

		t.step('(8) Gast auf dem Telefon: eine Insel, Unterzeile, kein „Share“')
		const g = await world.actor('gast-header-phone', { touch: true, viewport: { width: 390, height: 844 } })
		try {
			await g.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await field(g.page, 'guest-name', 'Gina')
			await action(g.page, 'guest-join')
			await waitReady(g.page, 30000)
			const pg = g.page
			t.must(await until(async () => !!(await look(pg, LEFT)), { timeout: 10000 }), '[D] Vorbedingung: die Insel steht da (Telefon)')
			const isl = await look(pg, LEFT)
			const gb = await look(pg, BOARD)
			t.check(near(isl.x, gb.x + 8) && near(isl.x + isl.w, gb.x + gb.w - 8) && (await pg.locator(RIGHT).count()) === 0, '[C] (8) eine Insel über die ganze Breite (je 8 px Rand), keine rechte Insel', { isl, board: gb })
			const sub = (await pg.locator('.knorke-topbar__subline').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
			t.check(sub === 'Guest · Open by link', '[C] (8) die Unterzeile „Guest · Open by link“', sub)
			if (await pg.locator('[data-knorke=privacy-info]').first().isVisible().catch(() => false)) {
				await pg.locator('[data-knorke-action=privacy-close]').first().click()
				await until(async () => !(await pg.locator('[data-knorke=privacy-info]').first().isVisible().catch(() => false)), { timeout: 3000 })
			}
			// round 3: title and subline are one finger target as high as the island's buttons
			const badge = await look(pg, `${LEFT} [data-knorke-action=link-badge]`)
			t.check(!!badge && badge.h >= 44 - TOL && badge.w >= 44 && /knorke-topbar__headbadge/.test(badge.cls), '[C] (8) Titel und Unterzeile sind ein Ziel von mindestens 44 px Höhe', badge)
			await pg.locator(`${LEFT} [data-knorke-action=link-badge]`).first().tap()
			t.check(await until(() => pg.locator('[data-knorke=privacy-info][data-knorke-privacy-kind=guest]').first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (8) ein Tipp auf Titel oder Unterzeile öffnet die Datenschutz-Karte des Gastes')
			t.check((await pg.locator('[data-knorke-action=share]').count()) === 0, '[C] (8) kein „Share“ für Gäste')
			await pg.locator('[data-knorke-menu=overflow] button[aria-haspopup]').first().click()
			t.must(await until(async () => (await menuHooks(pg)).includes('submenu:export'), { timeout: 5000 }), '[D] Vorbedingung: „More“ ist offen (Telefon)')
			const hooks = await menuHooks(pg)
			t.check(!hooks.includes('share') && !hooks.includes('keyboard-shortcuts'), '[C] (8) „More“ ohne „Share“ und ohne „Keyboard shortcuts“', hooks)
			await pg.keyboard.press('Escape')
		} finally {
			await world.drop(g)
		}

		t.step('(9) Besitzerin auf dem Telefon: Umbenennen und Karte als getrennte Ziele von 44 px')
		const o = await world.actor('alice-header-phone', { user: 'alice', touch: true, viewport: { width: 390, height: 844 } })
		try {
			await openBoard(o, B)
			const po = o.page
			t.must(await until(async () => !!(await look(po, `${LEFT} [data-knorke-action=link-badge]`)), { timeout: 10000 }), '[D] Vorbedingung: das Link-Icon steht da (Telefon, Besitzerin)')
			const rename = await look(po, '[data-knorke-action=rename-board]')
			const icon = await look(po, `${LEFT} [data-knorke-action=link-badge]`)
			t.check(!!rename && rename.h >= 44 - TOL && !!icon && icon.w >= 44 - TOL && icon.h >= 44 - TOL, '[C] (9) Umbenennen (Titel mit Unterzeile) und das Link-Icon sind je mindestens 44 px groß', { rename, icon })
			t.check(apart(rename, icon), '[C] (9) die beiden Ziele berühren sich nicht', { rename, icon })
			const sub = (await po.locator('[data-knorke-action=rename-board] .knorke-topbar__subline').first().innerText().catch(() => '')).trim()
			t.check(sub === 'Open by link', '[C] (9) die Unterzeile „Open by link“ steht im Titel', sub)
			if (await po.locator('[data-knorke=privacy-info]').first().isVisible().catch(() => false)) {
				await po.locator('[data-knorke-action=privacy-close]').first().tap()
				await until(async () => !(await po.locator('[data-knorke=privacy-info]').first().isVisible().catch(() => false)), { timeout: 3000 })
			}
			await po.locator(`${LEFT} [data-knorke-action=link-badge]`).first().tap()
			t.check(await until(() => po.locator('[data-knorke=privacy-info][data-knorke-privacy-kind=account]').first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (9) ein Tipp auf das Link-Icon öffnet die Datenschutz-Karte')
			await po.locator('[data-knorke-action=privacy-close]').first().tap()
			const before = await look(po, LEFT)
			await po.locator('[data-knorke-action=rename-board]').first().tap()
			t.check(await until(() => po.locator('[data-knorke-field=title]').first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (9) ein Tipp auf den Titel macht ihn zum Feld')
			const during = await look(po, LEFT)
			t.check(near(during.h, before.h) && (await po.locator(`${LEFT} .knorke-topbar__subline`).count()) === 0, '[C] (9) beim Umbenennen bleibt die Insel so hoch wie vorher, ohne Unterzeile', { before, during })
			await po.keyboard.press('Escape')
		} finally {
			await world.drop(o)
		}
	},
}
