/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Privacy notice for guests and on boards open by link (factory job 032, M2).
 * Both cases change an instance setting (theming URLs through the bridge,
 * the notice through route 27 as admin) and put it back in `finally`; they
 * run directly after E42@390x844, before E09.
 *
 * E43 (guests, AK11–AK13) alice's board with an edit link; theming URLs
 *   (bridge legal-links set); the notice as admin: default T0 (two lines),
 *   de with Tde and Ude.
 *   - a new guest (en-US) sees T0 with its line break in
 *     [data-knorke=privacy-notice], under it the privacy link with the
 *     theming URL; the block comes before [data-knorke-field=guest-name]; no
 *     checkbox; name + Join is enough;
 *   - that tab shows no card, also not after a reload; a second tab of the
 *     same context opens the board without the dialog and shows the guest
 *     card with T0 and the link (new tab, noopener noreferrer); then
 *     sessionStorage knorke.privacy.<id> = '1'; closing it removes it, a
 *     reload of that tab does not bring it back;
 *   - a guest de-DE sees Tde and Ude, fr-FR T0 and the theming URL; after
 *     PUT {} (4.5 s, trap 25) a guest en-US sees exactly the built-in text;
 *   - round 1: a long admin text at 390 × 844 (touch) scrolls in
 *     [data-knorke-privacy-text] alone, the privacy link is not inside it and
 *     lies in the viewport; the voting link's dialog shows the built-in text
 *     of the voting role under "Your votes are anonymous.".
 * E44 (accounts and the admin page, AK14–AK15) alice owns B1 with an edit
 *   link, bob has an edit share on it; B2 is shared with bob, without link.
 *   (a) bob on B1: the badge (name "Open by link", title = explanation) and
 *       the one-time account card (explanation and built-in text) without a
 *       focus move, localStorage knorke.linkInfo.<B1>.<pid>; (b) reload:
 *       badge, no card; (c) keyboard: badge focused, Enter → card,
 *       aria-expanded true, focus on its close button; Esc → gone, focus on
 *       the badge, aria-expanded false; (d) alice on B1: badge, no card after
 *       2 s; (e) bob on B2: neither; (f) alice renews the link, bob reloads:
 *       the card again; (g) bob at 390 × 844 (touch, coarse pointer): the
 *       badge without visible text, aria-label "Open by link", a hit area of
 *       at least 44 × 44 px (elementFromPoint ±21 px around its centre).
 *   Admin page: admin opens /settings/admin/knorke, sets the default text,
 *   adds de through the <select>, sets its text, saves (PUT 200, "Saved."),
 *   both values after a reload; an invalid URL marks its field
 *   (aria-invalid); bob gets 403 on route 27.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell
 * (dialog, card, badge, admin form), [B] server (route 27, initial state),
 * [D] a harness precondition. Waiting polls from Node with until()
 * (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import {
	K, APP, BASE, ENV, PHONE, api, field, action, openBoard, waitReady, until, sleep,
} from '../lib/harness.mjs'
import { bridge } from '../lib/bridge.mjs'

/** The theming URLs of the bridge action legal-links set. */
const PRIVACY = 'https://example.org/knorke-harness/datenschutz'
/** The admin's notice of E43: default (two lines) and German. */
const T0 = 'E43 Hinweis Zeile 1\nE43 Hinweis Zeile 2'
const TDE = 'E43 Deutscher Hinweis'
const UDE = 'https://example.org/knorke-harness/de/datenschutz'
/** The built-in English text and the explanation (components/privacy.js). */
const BUILT_IN = 'Everyone on this board sees your name, your cursor and everything you add or change. The board is stored on this Nextcloud server.'
const BUILT_IN_VOTE = 'Others on this board see neither your cursor nor how you vote. The board is stored on this Nextcloud server.'
const EXPLAIN = 'Guests can join this board through a link without an account. They see the display names and cursors of everyone on the board and all of its content.'
/** App config is cached up to 3 s in APCu (trap 25). */
const SETTLE_MS = 4500

const CARD = '[data-knorke=privacy-info]'
const BADGE = '[data-knorke-action=link-badge]'

/** The edit link of a board (route 9 as alice); rotate renews it. */
async function linkToken(board, rotate = false) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Route 27 as the admin; waits for the app-config cache. */
async function putNotice(body) {
	const r = await api(ENV.admin.user, 'PUT', '/api/v1/settings/privacy', body)
	await sleep(SETTLE_MS)
	return r
}

/** Text of the first match ('' when missing), as the browser renders it (innerText). */
const textOf = (page, sel) => page.locator(sel).first().evaluate((el) => el.innerText).catch(() => '')
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
/** The selector stays absent for `ms` (polled). */
async function staysAway(page, sel, ms = 2000) {
	const t0 = Date.now()
	while (Date.now() - t0 < ms) {
		if (await visible(page, sel)) return false
		await sleep(100)
	}
	return true
}

/** The link a[data-knorke-privacy-link] or [data-knorke-legal=privacy] under `scope`: {href, target, rel}. */
function linkOf(page, sel) {
	return page.locator(sel).first().evaluate((el) => {
		const a = el.tagName === 'A' ? el : el.querySelector('a')
		return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '' } : null
	}).catch(() => null)
}

const newTabOk = (l) => !!l && l.target === '_blank' && /\bnoopener\b/.test(l.rel) && /\bnoreferrer\b/.test(l.rel)

/** The guest page of a token in a fresh context (opts: further newActor options); waits for the name dialog. */
async function guestDialog(world, name, token, locale, opts = {}) {
	const g = await world.actor(name, { ...opts, locale })
	await g.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await g.page.locator('[data-knorke-field=guest-name]').first().waitFor({ state: 'visible', timeout: 15000 })
	return g
}

export const E43 = {
	id: 'E43',
	title: 'Datenschutzhinweis für Gäste: Namensdialog mit Text und Link vor dem Namensfeld, ohne Kontrollkästchen; zurückkehrender Gast einmal je Tab-Sitzung als Karte; Sprachen de-DE/fr-FR und der eingebaute Text',
	async run(t, world) {
		const board = await world.board('E43 Datenschutz')
		const token = await linkToken(board)
		world.touchedLegal = true
		world.touchedPrivacy = true
		try {
			const set = await bridge('legal-links', 'set')
			t.must(set.privacyUrl === PRIVACY, '[D] theming privacyUrl gesetzt (Brücke)', set)
			const put = await putNotice({ default: { text: T0, url: '' }, languages: { de: { text: TDE, url: UDE } } })
			t.must(put.status === 200 && put.data?.privacy?.default?.text === T0, '[B] Route 27 als Admin: 200 mit der normalisierten Einstellung', { status: put.status, text: put.text.slice(0, 300) })

			t.step('neuer Gast en-US: Hinweis im Namensdialog')
			const g = await guestDialog(world, 'gast-hinweis', token, 'en-US')
			const p = g.page
			const dlg = p.locator('.knorke-dialog').filter({ has: p.locator('[data-knorke-field=guest-name]') }).first()
			t.check(await visible(p, '[data-knorke=privacy-notice]'), '[C] Namensdialog: [data-knorke=privacy-notice] sichtbar')
			t.check((await textOf(p, '[data-knorke=privacy-notice] [data-knorke-privacy-text]')).trim() === T0, '[C] Hinweistext = T0 mit Zeilenumbruch', await textOf(p, '[data-knorke-privacy-text]'))
			const pl = await linkOf(p, '[data-knorke=privacy-notice] [data-knorke-legal=privacy]')
			t.check(pl?.href === PRIVACY && newTabOk(pl), '[C] im Block: [data-knorke-legal=privacy] mit der theming-Adresse, neuer Tab', pl)
			const before = await p.evaluate(() => {
				const n = document.querySelector('[data-knorke=privacy-notice]')
				const f = document.querySelector('[data-knorke-field=guest-name]')
				return !!(n && f && (n.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING))
			})
			t.check(before, '[C] der Block steht im DOM vor [data-knorke-field=guest-name]')
			t.check((await dlg.locator('input[type=checkbox]').count()) === 0, '[C] kein input[type=checkbox] im Dialog')
			const nameFocus = await until(() => p.evaluate(() => {
				const a = document.activeElement
				return !!(a && a.closest && a.closest('[data-knorke-field=guest-name], input[data-knorke-field=guest-name]'))
			}), { timeout: 3000 })
			t.check(nameFocus, '[C] das Namensfeld hat den ersten Fokus (nicht die Rechtslinks davor)', await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)))
			const described = await p.evaluate(() => {
				const f = document.querySelector('[data-knorke-field=guest-name]')
				const input = f && (f.matches('input') ? f : f.querySelector('input'))
				return (input?.getAttribute('aria-describedby') || '').split(' ').includes(document.querySelector('[data-knorke-privacy-text]')?.id || '-')
			})
			t.check(described, '[C] das Namensfeld wird vom Hinweistext beschrieben (aria-describedby)')
			t.check((await dlg.locator('[data-knorke=legal]').count()) === 1, '[C] genau ein Paar Rechtslinks im Dialog (E15)')
			await field(p, 'guest-name', 'Lena')
			await action(p, 'guest-join')
			await waitReady(p, 30000)
			t.check(true, '[C] Name und „Join“ genügen: das Board ist bereit')

			t.step('derselbe Tab: keine Karte, auch nicht nach dem Neuladen')
			t.check(await staysAway(p, CARD, 1500), '[C] nach dem Beitritt keine Karte')
			await p.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(p, 30000)
			t.check(await staysAway(p, CARD, 2000), '[C] nach dem Neuladen keine Karte')

			t.step('zweiter Tab desselben Kontexts: ohne Dialog, mit der Gast-Karte')
			const p2 = await g.ctx.newPage()
			p2.setDefaultTimeout(15000)
			await p2.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await waitReady(p2, 30000)
			t.check((await p2.locator('[data-knorke-field=guest-name]').count()) === 0, '[C] zweiter Tab: kein Namensdialog (gespeicherte Identität)')
			const card = await until(() => visible(p2, `${CARD}[data-knorke-privacy-kind=guest]`), { timeout: 5000 })
			t.check(card, '[C] zweiter Tab: [data-knorke=privacy-info][data-knorke-privacy-kind=guest] sichtbar')
			t.check((await textOf(p2, `${CARD} [data-knorke-privacy-text]`)).trim() === T0, '[C] Karte: T0', await textOf(p2, CARD))
			const cl = await linkOf(p2, `${CARD} a[data-knorke-privacy-link]`)
			t.check(cl?.href === PRIVACY && newTabOk(cl), '[C] Karte: a[data-knorke-privacy-link] mit der theming-Adresse, target _blank, rel noopener noreferrer', cl)
			const mark = await p2.evaluate((id) => sessionStorage.getItem('knorke.privacy.' + id), board)
			t.check(mark === '1', `[C] sessionStorage knorke.privacy.${board} = '1'`, mark)
			await p2.locator('[data-knorke-action=privacy-close]').first().click()
			t.check(await until(async () => !(await visible(p2, CARD)), { timeout: 3000 }), '[C] Schließen: die Karte verschwindet')
			await p2.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(p2, 30000)
			t.check(await staysAway(p2, CARD, 2000), '[C] zweiter Tab neu geladen: keine Karte')
			await p2.goto('about:blank').catch(() => {})
			await world.drop(g)

			t.step('Sprachen: de-DE → Tde/Ude, fr-FR → T0/theming')
			const de = await guestDialog(world, 'gast-de', token, 'de-DE')
			t.check((await textOf(de.page, '[data-knorke-privacy-text]')).trim() === TDE, '[B] de-DE: Tde (Kette de_DE → de)', await textOf(de.page, '[data-knorke-privacy-text]'))
			const dl = await linkOf(de.page, '[data-knorke=privacy-notice] [data-knorke-legal=privacy]')
			t.check(dl?.href === UDE, '[B] de-DE: Datenschutz-Link = Ude (legal.privacyUrl ist die wirksame Adresse)', dl)
			await world.drop(de)
			const fr = await guestDialog(world, 'gast-fr', token, 'fr-FR')
			t.check((await textOf(fr.page, '[data-knorke-privacy-text]')).trim() === T0, '[B] fr-FR: T0 (Standard)', await textOf(fr.page, '[data-knorke-privacy-text]'))
			const fl = await linkOf(fr.page, '[data-knorke=privacy-notice] [data-knorke-legal=privacy]')
			t.check(fl?.href === PRIVACY, '[B] fr-FR: theming-Adresse', fl)
			await world.drop(fr)

			t.step('langer Hinweis bei 390 × 844: nur der Text scrollt, die Rechtslinks bleiben sichtbar')
			const longText = Array.from({ length: 20 }, (_, i) => `E43 langer Hinweis, Absatz ${i + 1}: Verantwortliche Stelle, Zweck, Speicherdauer, Rechte.`).join('\n')
			const putLong = await putNotice({ default: { text: longText, url: '' } })
			t.must(putLong.status === 200, '[B] langer Standardtext gespeichert (Route 27)', putLong.text.slice(0, 200))
			const lg = await guestDialog(world, 'gast-lang', token, 'en-US', { touch: true, viewport: PHONE })
			const layout = await until(() => lg.page.evaluate(() => {
				const text = document.querySelector('[data-knorke=privacy-notice] [data-knorke-privacy-text]')
				const legal = document.querySelector('[data-knorke=privacy-notice] [data-knorke-legal=privacy]')
				if (!text || !legal || text.getAttribute('tabindex') !== '0') return null
				const r = legal.getBoundingClientRect()
				return {
					scrolls: text.scrollHeight > text.clientHeight + 1, role: text.getAttribute('role'), label: text.getAttribute('aria-label'),
					inside: text.contains(legal), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, vw: window.innerWidth, vh: window.innerHeight,
				}
			}), { timeout: 5000 })
			t.check(layout?.scrolls && layout.role === 'region' && layout.label === 'Privacy notice', '[C] der lange Text scrollt selbst und ist dann eine benannte Region mit tabindex 0', layout)
			t.check(layout && !layout.inside, '[C] [data-knorke-legal=privacy] liegt nicht im scrollenden Text', layout)
			t.check(layout && layout.rect.top >= 0 && layout.rect.left >= 0 && layout.rect.bottom <= layout.vh && layout.rect.right <= layout.vw, '[C] der Datenschutz-Link liegt nach dem Öffnen im Viewport', layout)
			await world.drop(lg)

			t.step('PUT {}: der eingebaute englische Text')
			const reset = await putNotice({})
			t.check(reset.status === 200, '[B] PUT {} → 200', reset.text.slice(0, 200))
			const en = await guestDialog(world, 'gast-eingebaut', token, 'en-US')
			t.check((await textOf(en.page, '[data-knorke-privacy-text]')).trim() === BUILT_IN, '[C] en-US: genau der eingebaute englische Text', await textOf(en.page, '[data-knorke-privacy-text]'))
			await world.drop(en)

			t.step('Abstimmungslink: die eingebaute Fassung der Abstimmenden')
			const vl = await api('alice', 'POST', `/api/v1/boards/${board}/votelink`, {})
			t.must(vl.status === 200 && vl.data?.link?.token, '[D] Abstimmungslink angelegt', vl.text.slice(0, 200))
			const vg = await guestDialog(world, 'gast-abstimmend', vl.data.link.token, 'en-US')
			const vt = (await textOf(vg.page, '[data-knorke-privacy-text]')).trim()
			t.check(vt === BUILT_IN_VOTE, '[C] Abstimmungslink: eigene Fassung (weder Mauszeiger noch Stimmen sichtbar), nicht der Text des Bearbeitungslinks', vt)
			t.check((await textOf(vg.page, '.knorke-dialog__message')).includes('Your votes are anonymous.'), '[C] Abstimmungslink: „Your votes are anonymous.“ steht weiter darüber')
			await world.drop(vg)
		} finally {
			await putNotice({}).catch(() => {})
			await bridge('legal-links', 'clear').catch(() => {})
		}
	},
}

export const E44 = {
	id: 'E44',
	title: 'Konten auf Boards mit Link: Abzeichen „Open by link“ (Tastatur, schmal), einmalige Info nicht für den Besitzer, nicht ohne Link, wieder nach Erneuern; Admin-Abschnitt Knorke speichert Text je Sprache, Feldfehler, 403 für Nicht-Admins',
	async run(t, world) {
		const B1 = await world.board('E44 Datenschutz mit Link')
		const B2 = await world.board('E44 Datenschutz ohne Link')
		await linkToken(B1)
		for (const b of [B1, B2]) {
			const sh = await api('alice', 'PUT', `/api/v1/boards/${b}/shares`, { shares: [{ kind: 'user', id: 'bob', role: 'edit' }] })
			t.must(sh.status === 200, `[D] Board ${b} mit bob geteilt (edit)`, sh.text.slice(0, 200))
		}
		world.touchedPrivacy = true
		try {
			t.step('(a) bob auf B1: Abzeichen und einmalige Info')
			const bob = await world.actor('bob-hinweis', { user: 'bob' })
			const p = bob.page
			await openBoard(bob, B1)
			const badge = p.locator(BADGE).first()
			t.check(await until(() => badge.isVisible().catch(() => false), { timeout: 5000 }), '[C] Abzeichen [data-knorke-action=link-badge] sichtbar')
			t.check((await p.getByRole('button', { name: 'Open by link', exact: true }).count()) === 1, '[C] zugänglicher Name „Open by link“')
			t.check((await badge.getAttribute('title')) === EXPLAIN, '[C] title = Erklärsatz', await badge.getAttribute('title'))
			const card = await until(() => visible(p, `${CARD}[data-knorke-privacy-kind=account]`), { timeout: 5000 })
			t.check(card, '[C] Karte [data-knorke-privacy-kind=account] erscheint')
			const ct = await textOf(p, CARD)
			t.check(ct.includes(EXPLAIN) && ct.includes(BUILT_IN), '[C] Karte: Erklärsatz und eingebauter Text', ct.slice(0, 400))
			const focusIn = await p.evaluate((sel) => !!document.querySelector(sel)?.contains(document.activeElement), CARD)
			t.check(!focusIn, '[C] kein Fokuswechsel in die Karte')
			const pid = (await K.state(p)).pid
			const seen = await p.evaluate(([b, id]) => localStorage.getItem(`knorke.linkInfo.${b}.${id}`), [B1, pid])
			t.check(typeof seen === 'string' && /^\d+$/.test(seen), `[C] localStorage knorke.linkInfo.${B1}.<pid> gesetzt`, { pid, seen })

			t.step('(b) bob lädt neu: Abzeichen ja, Karte nein')
			await p.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(p, 30000)
			t.check(await until(() => badge.isVisible().catch(() => false), { timeout: 5000 }), '[C] nach dem Neuladen: Abzeichen')
			t.check(await staysAway(p, CARD, 2000), '[C] nach dem Neuladen: keine Karte')

			t.step('(c) Tastatur: Enter öffnet, Esc schließt, der Fokus kommt zurück')
			await badge.focus()
			await p.keyboard.press('Enter')
			t.check(await until(() => visible(p, CARD), { timeout: 3000 }), '[C] Enter auf dem Abzeichen: Karte erscheint')
			t.check((await badge.getAttribute('aria-expanded')) === 'true', '[C] aria-expanded="true"')
			const onClose = await until(() => p.evaluate(() => document.activeElement?.getAttribute('data-knorke-action') === 'privacy-close'), { timeout: 2000 })
			t.check(onClose, '[C] der Fokus liegt auf dem Schließen-Knopf', await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)))
			const controls = await badge.getAttribute('aria-controls')
			t.check(controls && (await p.locator(`#${controls}`).count()) === 1, '[C] aria-controls zeigt auf die Karte', controls)
			await p.keyboard.press('Escape')
			t.check(await until(async () => !(await visible(p, CARD)), { timeout: 3000 }), '[C] Esc schließt die Karte')
			const onBadge = await until(() => p.evaluate(() => document.activeElement?.getAttribute('data-knorke-action') === 'link-badge'), { timeout: 2000 })
			t.check(onBadge, '[C] der Fokus liegt wieder auf dem Abzeichen')
			t.check((await badge.getAttribute('aria-expanded')) === 'false', '[C] aria-expanded="false"')

			t.step('(d) alice auf B1: Abzeichen, keine Karte')
			const alice = await world.actor('alice-hinweis', { user: 'alice' })
			await openBoard(alice, B1)
			t.check(await until(() => visible(alice.page, BADGE), { timeout: 5000 }), '[C] Besitzerin: Abzeichen')
			t.check(await staysAway(alice.page, CARD, 2000), '[C] Besitzerin: nach 2 s keine Karte')

			t.step('(e) bob auf B2 (ohne Link): nichts')
			await openBoard(bob, B2)
			t.check(await staysAway(p, BADGE, 2000), '[C] B2: kein Abzeichen')
			t.check(!(await visible(p, CARD)), '[C] B2: keine Karte')

			t.step('(f) alice erneuert den Link, bob lädt B1: die Karte kommt wieder')
			await linkToken(B1, true)
			await openBoard(bob, B1)
			t.check(await until(() => visible(p, `${CARD}[data-knorke-privacy-kind=account]`), { timeout: 5000 }), '[C] nach dem Erneuern: die Karte erscheint wieder')

			t.step('(g) bob bei 390 × 844: Abzeichen nur mit Symbol')
			const phone = await world.actor('bob-hinweis-handy', { user: 'bob', touch: true, viewport: PHONE })
			await openBoard(phone, B1)
			const pb = phone.page.locator(BADGE).first()
			t.check(await until(() => pb.isVisible().catch(() => false), { timeout: 5000 }), '[C] schmal: Abzeichen sichtbar')
			t.check((await pb.getAttribute('aria-label')) === 'Open by link', '[C] schmal: aria-label „Open by link“', await pb.getAttribute('aria-label'))
			t.check((await pb.evaluate((el) => el.innerText.trim())) === '', '[C] schmal: kein sichtbarer Text', await pb.evaluate((el) => el.innerText))
			// grober Zeiger: Trefferfläche ≥ 44 × 44 px (elementFromPoint 21 px um die Mitte in alle vier Richtungen)
			const hit = await pb.evaluate((el) => {
				const r = el.getBoundingClientRect()
				const cx = r.left + r.width / 2
				const cy = r.top + r.height / 2
				const on = (x, y) => !!document.elementFromPoint(x, y)?.closest('[data-knorke-action=link-badge]')
				return { coarse: matchMedia('(pointer: coarse)').matches, up: on(cx, cy - 21), down: on(cx, cy + 21), left: on(cx - 21, cy), right: on(cx + 21, cy), box: { w: r.width, h: r.height } }
			})
			t.check(hit.coarse && hit.up && hit.down && hit.left && hit.right, '[C] schmal mit grobem Zeiger: Trefferfläche mindestens 44 × 44 px', hit)
			await world.drop(phone)

			t.step('Admin-Abschnitt „Knorke“')
			const admin = await world.actor('admin-hinweis', { user: ENV.admin.user })
			const ap = admin.page
			await ap.goto(`${BASE}/index.php/settings/admin/knorke`, { waitUntil: 'domcontentloaded' })
			const form = ap.locator('[data-knorke-admin=privacy]').first()
			t.must(await form.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false), '[C] /settings/admin/knorke: [data-knorke-admin=privacy] sichtbar')
			const defText = ap.locator('[data-knorke-field=privacy-text][data-knorke-lang=default]').first()
			await defText.fill('E44 Standardtext')
			await ap.locator('[data-knorke-field=privacy-language]').first().selectOption('de')
			await ap.locator('[data-knorke-action=privacy-add-language]').first().click()
			const deText = ap.locator('[data-knorke-field=privacy-text][data-knorke-lang=de]').first()
			t.must(await deText.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] Sprache de über das <select> hinzugefügt')
			await deText.fill('E44 Deutscher Text')
			const [resp] = await Promise.all([
				ap.waitForResponse((r) => /\/api\/v1\/settings\/privacy$/.test(r.url()) && r.request().method() === 'PUT', { timeout: 15000 }),
				ap.locator('[data-knorke-action=privacy-save]').first().click(),
			])
			t.check(resp.status() === 200, '[B] Speichern: PUT 200', resp.status())
			t.check(await until(async () => (await textOf(ap, '[data-knorke-admin-status]')).trim() === 'Saved.', { timeout: 5000 }), '[C] Statuszeile „Saved.“', await textOf(ap, '[data-knorke-admin-status]'))
			await ap.reload({ waitUntil: 'domcontentloaded' })
			await form.waitFor({ state: 'visible', timeout: 20000 })
			t.check((await defText.inputValue().catch(() => '')) === 'E44 Standardtext', '[C] nach dem Neuladen: Standardtext im Feld', await defText.inputValue().catch(() => null))
			t.check((await deText.inputValue().catch(() => '')) === 'E44 Deutscher Text', '[C] nach dem Neuladen: Text von de im Feld', await deText.inputValue().catch(() => null))

			t.step('ungültige URL: Feldhinweis mit aria-invalid')
			const defUrl = ap.locator('[data-knorke-field=privacy-url][data-knorke-lang=default]').first()
			await defUrl.fill('javascript:alert(1)')
			await ap.locator('[data-knorke-action=privacy-save]').first().click()
			t.check(await until(async () => (await defUrl.getAttribute('aria-invalid')) === 'true', { timeout: 5000 }), '[C] das URL-Feld trägt aria-invalid="true"')
			t.check(await visible(ap, '[data-knorke-error=invalid_url]'), '[C] Feldhinweis [data-knorke-error=invalid_url] sichtbar')
			const described = (await defUrl.getAttribute('aria-describedby')) || ''
			t.check(described.split(' ').includes('knorke-privacy-default-error'), '[C] aria-describedby nennt den Feldhinweis', described)

			t.step('bob auf Route 27: 403')
			const no = await api('bob', 'PUT', '/api/v1/settings/privacy', { default: { text: 'bob' } })
			t.check(no.status === 403, '[B] Nicht-Admin: PUT /api/v1/settings/privacy → 403', { status: no.status, text: no.text.slice(0, 200) })
		} finally {
			await putNotice({}).catch(() => {})
		}
	},
}
