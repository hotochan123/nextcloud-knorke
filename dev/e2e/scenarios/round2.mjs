/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Round 2 (SPEC-M0 §15), not in the §8.2 table. Each scenario uses its own
 * boards and contexts; the shared world of E03–E09 is not touched.
 *
 * E15 (U9/U10): the guest page keeps Nextcloud's footer hidden (F7) and
 *   shows the instance's imprint and privacy links itself – in the name
 *   dialog, in the guest top bar menu and under the empty state of an
 *   invalid link – and only while theming has them (host bridge
 *   legal-links set|clear).
 * E15/E16 contrast (SPEC-M1 §8.4, M0 leftover SPEC-M0 §16.2): name and
 *   description of the empty guest states – invalid link (E15), link sharing
 *   disabled (E16) – reach ≥ 4.5:1 against the .knorke-public__card
 *   background composited over black and over white, in a light and in a
 *   dark (prefers-color-scheme) context (lib/contrast.mjs).
 * E16 (U11/U12): the admin turns link sharing off (host bridge links-policy
 *   off). A guest inside the board freezes with the links_disabled banner
 *   and stops polling; the owner's share dialog shows the disabled state,
 *   also after a 403 on "Create edit link" in an already open dialog; a new
 *   guest and a signed-in joiner end in the final links_disabled state
 *   without retrying. Allowed again, the guest comes back with the same
 *   identity and the owner sees the kept link. E16 runs after E09: while it
 *   lasts, every link membership and guest of the instance (also those of the
 *   shared world) loses access.
 * E17 (U15): a real 409 `protocol` from the server – the page's /sync body
 *   is rewritten in flight to an unknown proto, the server answers. Exactly
 *   one automatic, cache-busting reload, then the board freezes (banner
 *   reload, no toolbar, no edits, no more polling) instead of reloading in a
 *   loop; with unsent changes there is no automatic reload at all; after the
 *   "update" (route removed) the banner's Reload brings the board back.
 */
import {
	K, APP, api, waitReady, until, sleep, bannerVisible, createSticky, itemMap, centerOf, field, action, openBoard,
} from '../lib/harness.mjs'
import { bridge } from '../lib/bridge.mjs'
import { ncFalse } from '../lib/switches.mjs'
import { checkEmptyStateContrast } from '../lib/contrast.mjs'

/** The URLs the host bridge action legal-links set writes into theming. */
const IMPRINT = 'https://example.org/knorke-harness/impressum'
const PRIVACY = 'https://example.org/knorke-harness/datenschutz'

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/**
 * The legal links under `scope` as rendered: [{key, href, target, rel, text}]
 * in DOM order, visible ones only. The hook may sit on the <a> itself
 * (LegalLinks.vue) or on a wrapper around it (NcActionLink in the guest menu).
 */
async function legalLinks(scope) {
	return scope.locator('[data-knorke-legal]').evaluateAll((els) => els
		.map((el) => ({ el, a: el.tagName === 'A' ? el : el.querySelector('a') }))
		.filter(({ a }) => a && a.offsetParent !== null)
		.map(({ el, a }) => ({ key: el.getAttribute('data-knorke-legal'), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '', text: a.textContent.trim() })))
}

/** Both links, imprint first, opening in a new tab without opener/referrer. */
function legalOk(t, links, label) {
	t.check(links.length === 2 && links[0].key === 'imprint' && links[1].key === 'privacy', `${label}: Impressum und Datenschutz, in dieser Reihenfolge`, links)
	t.check(links[0]?.href === IMPRINT && links[1]?.href === PRIVACY, `${label}: href = theming imprintUrl/privacyUrl`, links.map((l) => l.href))
	t.check(links.every((l) => l.target === '_blank' && /\bnoopener\b/.test(l.rel) && /\bnoreferrer\b/.test(l.rel)), `${label}: target _blank, rel noopener noreferrer`, links.map((l) => [l.target, l.rel]))
	t.check(links[0]?.text === 'Legal notice' && links[1]?.text === 'Privacy policy', `${label}: Beschriftung „Legal notice“ / „Privacy policy“`, links.map((l) => l.text))
}

/** Nextcloud's public footer (footer.guest-box) is absent or hidden (F7). */
const footerHidden = (p) => p.evaluate(() => {
	const f = document.querySelector('footer.guest-box')
	return !f || getComputedStyle(f).display === 'none'
})

export const E15 = {
	id: 'E15',
	title: 'Rechtslinks auf der Gastseite (U9/U10): Namensdialog, Gast-Menü, ungültiger Link; ohne theming-URLs nichts; Fußzeile bleibt verborgen; Kontrast des leeren Zustands hell/dunkel ≥ 4,5:1',
	async run(t, world) {
		const board = await world.board('E2E Rechtslinks')
		const token = await linkToken(board)
		world.touchedLegal = true
		try {
			const set = await bridge('legal-links', 'set')
			t.must(set.imprintUrl === IMPRINT && set.privacyUrl === PRIVACY, 'theming imprintUrl/privacyUrl gesetzt (Brücke)', set)

			t.step('Namensdialog der Gastseite')
			const g = await world.actor('gast-recht')
			const p = g.page
			await p.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await p.locator('[data-knorke-field=guest-name]').first().waitFor({ state: 'visible', timeout: 15000 })
			const dlg = p.locator('.knorke-dialog').filter({ has: p.locator('[data-knorke-field=guest-name]') }).first()
			t.check(await dlg.locator('[data-knorke=legal]').first().isVisible().catch(() => false), 'Namensdialog: [data-knorke=legal] sichtbar')
			legalOk(t, await legalLinks(dlg), 'Namensdialog')
			t.check(await footerHidden(p), 'Nextclouds Fußzeile footer.guest-box bleibt verborgen (F7)')

			t.step('beitreten, Menü der Gast-Kopfleiste')
			await field(p, 'guest-name', 'Lena')
			await action(p, 'guest-join')
			await waitReady(p, 30000)
			const menu = p.locator('[data-knorke=guest-menu]').first()
			t.must(await menu.isVisible().catch(() => false), 'Gast-Kopfleiste: Menü [data-knorke=guest-menu]')
			await menu.locator('button').first().click()
			const inMenu = await until(async () => {
				const l = await legalLinks(p)
				return l.length === 2 ? l : null
			}, { timeout: 5000 })
			if (t.check(Array.isArray(inMenu), 'Menü geöffnet: zwei Links sichtbar', await legalLinks(p))) {
				t.check(inMenu[0].key === 'imprint' && inMenu[0].href === IMPRINT && inMenu[1].key === 'privacy' && inMenu[1].href === PRIVACY, 'Menü: Impressum, Datenschutz mit den theming-URLs', inMenu)
				t.check(inMenu.every((l) => l.target === '_blank' && /\bnoopener\b/.test(l.rel) && /\bnoreferrer\b/.test(l.rel)), 'Menü: neuer Tab, rel noopener noreferrer', inMenu.map((l) => [l.target, l.rel]))
			}
			await p.keyboard.press('Escape')
			t.check(await footerHidden(p), 'im Board: Fußzeile bleibt verborgen')

			t.step('ungültiger Link: leerer Zustand mit den Links, Kontrast hell und dunkel')
			const inv = await world.actor('gast-ungueltig', { colorScheme: 'light' })
			await inv.page.goto(`${APP}/p/${'Q'.repeat(24)}`, { waitUntil: 'domcontentloaded' })
			const invalid = await inv.page.locator('[data-knorke-banner=invalid]').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
			t.check(invalid, 'ungültiger Link: [data-knorke-banner=invalid]')
			legalOk(t, await legalLinks(inv.page), 'ungültiger Link')
			if (invalid) await checkEmptyStateContrast(t, inv.page, 'invalid', 'light', 'ungültiger Link')
			await world.drop(inv)
			const invDark = await world.actor('gast-ungueltig-dunkel', { colorScheme: 'dark' })
			await invDark.page.goto(`${APP}/p/${'Q'.repeat(24)}`, { waitUntil: 'domcontentloaded' })
			const invalidDark = await invDark.page.locator('[data-knorke-banner=invalid]').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
			if (t.check(invalidDark, 'ungültiger Link (dunkel): [data-knorke-banner=invalid]')) {
				await checkEmptyStateContrast(t, invDark.page, 'invalid', 'dark', 'ungültiger Link')
			}
			await world.drop(invDark)
			await bridge('bruteforce-reset').catch(() => {})

			t.step('theming-URLs gelöscht: nirgends Links')
			const clear = await bridge('legal-links', 'clear')
			t.must(clear.imprintUrl === null && clear.privacyUrl === null, 'theming imprintUrl/privacyUrl gelöscht (Brücke)', clear)
			const n = await world.actor('gast-ohne-recht')
			await n.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await n.page.locator('[data-knorke-field=guest-name]').first().waitFor({ state: 'visible', timeout: 15000 })
			t.check((await n.page.locator('[data-knorke=legal]').count()) === 0, 'Namensdialog ohne [data-knorke=legal]')
			await world.drop(n)
			await p.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(p, 30000)
			t.check((await p.locator('[data-knorke=guest-menu]').count()) === 0, 'Gast im Board (neu geladen): kein Menü')
		} finally {
			await bridge('legal-links', 'clear').catch(() => {})
		}
	},
}

export const E16 = {
	id: 'E16',
	title: 'Link-Freigabe vom Admin abgeschaltet (U11/U12): Gast im Board friert ein, Teilen-Dialog zeigt den Zustand, neuer Gast und Konto-Beitritt endgültig ohne Wiederholung, Kontrast des leeren Zustands hell/dunkel ≥ 4,5:1; wieder erlaubt → alles zurück',
	async run(t, world) {
		const A = await world.board('E2E Link-Richtlinie')
		const B = await world.board('E2E Link-Richtlinie ohne Link')
		const LA = await linkToken(A)

		t.step('Gast Gina tritt bei (Links erlaubt)')
		const g = await world.actor('gina-richtlinie')
		await g.page.goto(`${APP}/p/${LA}`, { waitUntil: 'domcontentloaded' })
		await field(g.page, 'guest-name', 'Gina')
		await action(g.page, 'guest-join')
		await waitReady(g.page, 30000)
		const gpid = (await K.state(g.page)).pid
		t.step('alice öffnet Board B (ohne Link)')
		const a = await world.actor('alice-richtlinie', { user: 'alice' })
		await openBoard(a, B)

		world.touchedPolicy = true
		try {
			t.step('Admin schaltet die Link-Freigabe ab')
			const off = await bridge('links-policy', 'off')
			t.must(ncFalse(off.shareapi_allow_links), 'core shareapi_allow_links = no (Brücke; tolerant no|false|0, SPEC-M1 §24 R13)', off)
			// without this the guest's fast path keeps a: (links 1) for up to 120 s (documented lag)
			await bridge('redis-del-access', A)

			t.step('Gast im Board: endgültig links_disabled')
			const frozen = await until(() => bannerVisible(g.page, 'links_disabled'), { timeout: 15000 })
			t.check(frozen, 'Gast im Board: Banner [data-knorke-banner=links_disabled]', await K.state(g.page).catch(() => null))
			const gs = await K.state(g.page)
			t.check(gs.status === 'links_disabled', 'Gast: Status links_disabled', gs)
			t.check((await g.page.locator('[data-knorke-toolbar]').count()) === 0, 'Gast: eingefroren, keine Werkzeugleiste')
			const tg = Date.now()
			await sleep(3000)
			t.check(g.requestsSince(tg, /\/sync$/).length === 0, 'Gast: kein /sync mehr (keine Schleife)', g.requestsSince(tg, /\/sync$/).length)

			t.step('alice: „Create edit link“ im offenen Dialog → 403 → Hinweis statt Fehler')
			await action(a.page, 'share')
			const create = a.page.locator('.knorke-share [data-knorke-action=link-toggle]').first()
			await create.waitFor({ state: 'visible', timeout: 5000 })
			await create.click()
			const note = a.page.locator('.knorke-share [data-knorke-banner=links_disabled]').first()
			t.check(await note.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false), 'Teilen-Dialog: „Link sharing is disabled by your administrator.“')
			t.check((await a.page.locator('[data-knorke-field=link-url], [data-knorke-action=link-rotate]').count()) === 0, 'kein Link-Feld, kein Erneuern')
			t.check((await a.page.locator('.knorke-share [data-knorke-action=link-toggle]').count()) === 0, 'ohne bestehenden Link: kein Knopf mehr')
			t.check(!(await a.page.locator('.toast-error').first().isVisible().catch(() => false)), 'kein Fehler-Toast')
			await a.page.keyboard.press('Escape')

			t.step('alice öffnet Board A (Link besteht): Dialog gleich im abgeschalteten Zustand')
			await openBoard(a, A)
			await action(a.page, 'share')
			const noteA = a.page.locator('.knorke-share [data-knorke-banner=links_disabled]').first()
			t.check(await noteA.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false), 'Board A: Hinweis im Teilen-Dialog')
			t.check((await a.page.locator('[data-knorke-field=link-url], [data-knorke-action=link-rotate]').count()) === 0, 'Board A: kein Link-Feld, kein Erneuern')
			t.check((await a.page.locator('.knorke-share [data-knorke-action=link-toggle]').count()) === 1, 'Board A: der behaltene Link lässt sich abschalten ([data-knorke-action=link-toggle])')
			await a.page.keyboard.press('Escape')

			t.step('neuer Gast: Beitritt → endgültig links_disabled')
			const n = await world.actor('nora-richtlinie')
			await n.page.goto(`${APP}/p/${LA}`, { waitUntil: 'domcontentloaded' })
			await field(n.page, 'guest-name', 'Nora')
			const tj = Date.now()
			await action(n.page, 'guest-join')
			const dis = await n.page.locator('[data-knorke-banner=links_disabled]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)
			t.check(dis, 'Gastseite: Endzustand [data-knorke-banner=links_disabled]')
			await sleep(3000)
			t.check(n.requestsSince(tj, /\/join$/).length === 1, 'genau ein Beitrittsversuch', n.requestsSince(tj, /\/join$/).length)
			t.check(n.requestsSince(tj, /\/(sync|snapshot)$/).length === 0, 'kein Snapshot, kein /sync', n.requestsSince(tj, /\/(sync|snapshot)$/).map((r) => r.url))
			if (dis) await checkEmptyStateContrast(t, n.page, 'links_disabled', 'light', 'Link-Freigabe aus')

			t.step('neuer Gast im dunklen Schema: derselbe Endzustand, Kontrast')
			const nd = await world.actor('nora-dunkel', { colorScheme: 'dark' })
			await nd.page.goto(`${APP}/p/${LA}`, { waitUntil: 'domcontentloaded' })
			await field(nd.page, 'guest-name', 'Nora')
			await action(nd.page, 'guest-join')
			const disDark = await nd.page.locator('[data-knorke-banner=links_disabled]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)
			if (t.check(disDark, 'Gastseite (dunkel): Endzustand [data-knorke-banner=links_disabled]')) {
				await checkEmptyStateContrast(t, nd.page, 'links_disabled', 'dark', 'Link-Freigabe aus')
			}
			await world.drop(nd)

			t.step('bob öffnet den Link angemeldet: endgültig links_disabled')
			const b = await world.actor('bob-richtlinie', { user: 'bob' })
			const tb = Date.now()
			await b.page.goto(`${APP}/p/${LA}`, { waitUntil: 'domcontentloaded' })
			const bdis = await b.page.locator('[data-knorke-banner=links_disabled]').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
			t.check(bdis, 'Konto-Beitritt: Endzustand [data-knorke-banner=links_disabled]', b.page.url())
			await sleep(2000)
			const joins = b.requestsSince(tb, /\/api\/v1\/links\/[A-Za-z0-9]{24}\/join$/)
			t.check(joins.length === 1, 'genau ein Konto-Beitritt', joins.length)

			t.step('wieder erlaubt: Gina, bob und der Link kommen zurück')
			const on = await bridge('links-policy', 'on')
			t.must(on.shareapi_allow_links === null, 'core shareapi_allow_links gelöscht (Brücke)', on)
			await bridge('redis-del-access', A)
			await g.page.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(g.page, 30000)
			const g2 = await K.state(g.page)
			t.check(g2.status === 'online' && g2.boardId === A && g2.pid === gpid, 'Gina nach dem Neuladen wieder im Board, gleiche pid', { vorher: gpid, nachher: g2 })
			await b.page.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(b.page, 30000)
			t.check((await K.state(b.page)).boardId === A, 'bob tritt über den Link bei', await K.state(b.page))
			await a.page.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(a.page)
			await action(a.page, 'share')
			const url = await until(async () => {
				const v = await a.page.locator('[data-knorke-field=link-url]').first().inputValue().catch(() => '')
				return v.endsWith(`/p/${LA}`) ? v : null
			}, { timeout: 8000 })
			t.check(url, 'Teilen-Dialog zeigt wieder denselben Link', url)
			await a.page.keyboard.press('Escape')
		} finally {
			await bridge('links-policy', 'on').catch(() => {})
			await bridge('redis-del-access', A).catch(() => {})
		}
	},
}

/** /sync of one board as a signed-in user (path with or without /index.php). */
const syncRe = (board) => new RegExp(`/apps/knorke/api/v1/boards/${board}/sync$`)

/**
 * Route handler: the request goes to the server with an unknown protocol
 * version (one digit for one digit, so Content-Length stays right); the
 * server answers 409 protocol itself. Counts the rewritten requests in
 * `stats`. SPEC-M1 §12.3: the client speaks protocol 2 now, and the reload
 * marker holds the server's version from the 409 body – the same jump twice
 * freezes (this case), a new version reloads again (E20).
 */
function staleClient(stats) {
	return async (route) => {
		const body = route.request().postData() || ''
		if (!/"proto":[0-8],/.test(body)) return route.continue()
		stats.rewritten++
		return route.continue({ postData: body.replace(/"proto":[0-8],/, '"proto":9,') })
	}
}

export const E17 = {
	id: 'E17',
	title: '409 protocol vom Server (U15): genau ein Neuladen mit Cache-Bust, dann eingefroren statt Schleife; mit Ausstehendem kein automatisches Neuladen; Reload holt das Board zurück',
	async run(t, world) {
		const board = await world.board('E2E Neuladen')
		const a = await world.actor('alice-neuladen', { user: 'alice' })
		const p = a.page
		// a beforeunload prompt (unsent changes) must never block a navigation
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await openBoard(a, board)
		const n = await createSticky(p, 0, 0, 'vor dem Update')
		await K.waitIdle(p, 10000)
		const SYNC = syncRe(board)
		const loads = []
		const urls = []
		const stats = { rewritten: 0, s409: 0 }
		p.on('load', () => loads.push(p.url()))
		p.on('framenavigated', (f) => { if (f === p.mainFrame()) urls.push(f.url()) })
		p.on('response', (r) => { if (SYNC.test(r.url()) && r.status() === 409) stats.s409++ })
		let p2 = null
		try {
			t.step('ab jetzt meldet die Seite ein unbekanntes proto: der Server antwortet 409')
			await p.route(SYNC, staleClient(stats))
			await K.forceTick(p).catch(() => {})
			const banner = await until(async () => loads.length >= 1 && await bannerVisible(p, 'reload'), { timeout: 25000 })
			t.check(banner, 'nach einem automatischen Neuladen: Banner [data-knorke-banner=reload]', { loads, stats })
			await sleep(4000)
			t.check(loads.length === 1, 'genau ein automatisches Neuladen (keine Schleife)', loads)
			t.check(stats.s409 >= 2, 'der Server hat 409 geantwortet (vor und nach dem Neuladen)', stats)
			t.check(urls.some((u) => /[?&]knorke-reload=/.test(u)), 'das Neuladen trug den Cache-Bust-Parameter knorke-reload', urls)
			t.check(!/knorke-reload=/.test(p.url()), 'der Parameter ist danach wieder aus der Adresse', p.url())
			const st = await K.state(p)
			t.check(st.status === 'reload', 'Status reload', st)
			t.check((await p.locator('[data-knorke-toolbar]').count()) === 0, 'eingefroren: keine Werkzeugleiste')
			t.check((await itemMap(p)).has(n), 'die Notiz bleibt sichtbar')
			const c = await centerOf(p, n)
			await p.mouse.dblclick(c.x, c.y)
			await sleep(600)
			t.check(!(await p.locator('textarea[data-knorke-editor]').isVisible().catch(() => false)), 'Doppelklick öffnet keinen Editor (nur ansehen)')
			t.check((await K.state(p)).pending === 0, 'keine neue ausstehende Änderung')
			const tq = Date.now()
			await sleep(3000)
			t.check(a.requestsSince(tq, SYNC).length === 0, 'kein /sync mehr', a.requestsSince(tq, SYNC).length)

			t.step('neuer Tab, ungesendete Notiz, dann 409: kein automatisches Neuladen')
			p2 = await a.ctx.newPage()
			p2.on('dialog', (d) => d.accept().catch(() => {}))
			const loads2 = []
			await p2.goto(`${APP}/b/${board}`, { waitUntil: 'domcontentloaded' })
			await waitReady(p2)
			p2.on('load', () => loads2.push(p2.url()))
			await a.ctx.setOffline(true)
			await until(() => bannerVisible(p2, 'offline'), { timeout: 6000 })
			const m = await createSticky(p2, 300, 0, 'ungesendet')
			const stats2 = { rewritten: 0 }
			await p2.route(SYNC, staleClient(stats2))
			await a.ctx.setOffline(false)
			const frozen2 = await until(async () => (await K.state(p2)).status === 'reload', { timeout: 15000 })
			t.check(frozen2, 'mit Ausstehendem: Status reload', await K.state(p2))
			await sleep(4000)
			t.check(loads2.length === 0, 'mit Ausstehendem: kein automatisches Neuladen', loads2)
			const st2 = await K.state(p2)
			t.check(st2.pending >= 1 && (await itemMap(p2)).has(m), 'die ungesendete Notiz bleibt sichtbar und ausstehend', st2)
			t.check(await bannerVisible(p2, 'reload') && (await p2.locator('[data-knorke-toolbar]').count()) === 0, 'Banner reload, keine Werkzeugleiste')

			t.step('nach dem „Update“: Reload im Banner holt das Board zurück')
			await p2.unroute(SYNC)
			await p.unroute(SYNC)
			await p2.locator('[data-knorke-banner=reload] button').first().click()
			await until(() => loads2.length >= 1, { timeout: 10000 })
			await waitReady(p2)
			t.check((await K.state(p2)).status === 'online' && !/knorke-reload=/.test(p2.url()), 'Tab 2: wieder online, Adresse ohne Parameter', { url: p2.url() })
			const loadsBefore = loads.length
			await p.locator('[data-knorke-banner=reload] button').first().click()
			await until(() => loads.length > loadsBefore, { timeout: 10000 })
			await waitReady(p)
			t.check((await p.locator('[data-knorke-toolbar]').count()) === 1, 'Tab 1: wieder online, Werkzeugleiste da')
			const k = await createSticky(p, 600, 0, 'nach dem Update')
			await K.waitIdle(p, 10000)
			const snap = await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)
			t.check((snap.data?.items || []).some((x) => x.id === k), 'Tab 1: eine neue Notiz kommt beim Server an')
		} finally {
			await a.ctx.setOffline(false).catch(() => {})
			await p.unroute(SYNC).catch(() => {})
			if (p2) {
				await p2.unroute(SYNC).catch(() => {})
				await p2.goto('about:blank').catch(() => {})
				await p2.close().catch(() => {})
			}
		}
	},
}
