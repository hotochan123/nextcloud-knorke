/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * M1 stage 0 (SPEC-M1 §8.4), each on its own boards and contexts; the shared
 * world of E03–E09 is not touched, no instance setting changes.
 *
 * E18 (U8 in the browser, an M0 leftover, SPEC-M0 §6.4 "Isolierung bei
 *   Serverfehlern"): ctx.route answers every /sync whose ops contain the
 *   marker text KNORKE-U8-500 with 500 {"message":"Internal Server Error"};
 *   everything else reaches the server. Part A: notes A and B, B gets the
 *   marker, right after that C is created and A moved – C and A arrive, the
 *   marked op is sent alone exactly three times, each right after a 2xx, then
 *   dropped: toast "A change could not be saved because of a server error.",
 *   the text goes to the text rescue, afterwards online with pending 0.
 *   Part B: every /sync answers 500 for 6 s while two notes are created and a
 *   text is changed – no "internal" toast, all three changes arrive (an outage
 *   never drops an op).
 * E19 (live title, SPEC-M1 §4.13.4, §6.5.1): alice renames in tab A, bob (link
 *   member) and the guest Gina see it ≤ 3 s without a reload; then alice opens
 *   the rename field in tab B and types while tab A renames again – the open
 *   field keeps what was typed, after Esc tab B shows the title of tab A.
 * E20 (protocol jump, SPEC-M1 §4.3): ctx.route answers ONE /sync with 409
 *   {proto: 3} – exactly one reload; a second 409 with proto 4 in the same tab
 *   session – again exactly one reload; the same version once more – no
 *   reload, the board freezes with the reload banner (marker per version);
 *   with an open editor and a new version – no reload, banner reload, the
 *   editor keeps its text.
 *
 * Toasts disappear after a few seconds: an init script records every
 * .knorke-toast that appears (window.__kdToasts) before the app starts.
 */
import {
	K, APP, api, waitReady, until, sleep, bannerVisible, createSticky, itemMap, centerOf, field, action, openBoard, editText, dragItem,
} from '../lib/harness.mjs'

const MARKER = 'KNORKE-U8-500'
const SERVER_ERROR_TOAST = 'A change could not be saved because of a server error.'
const SERVER_ERROR_BODY = JSON.stringify({ message: 'Internal Server Error' })

/** Records every toast of the page in window.__kdToasts (init script, before the app). */
async function recordToasts(ctx) {
	await ctx.addInitScript(() => {
		window.__kdToasts = []
		const seen = new WeakSet()
		const take = (n) => {
			if (n.nodeType !== 1 || seen.has(n)) return
			if (n.classList && n.classList.contains('knorke-toast')) {
				seen.add(n)
				window.__kdToasts.push({ t: Date.now(), text: String(n.textContent || '').trim(), cls: String(n.className) })
			}
			if (n.querySelectorAll) for (const c of n.querySelectorAll('.knorke-toast')) take(c)
		}
		new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) take(n) })
			.observe(document, { childList: true, subtree: true })
	})
}

const toastsOf = (p) => p.evaluate(() => window.__kdToasts || []).catch(() => [])

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Items of the server's snapshot as a Map (API as alice). */
async function serverMap(board) {
	const r = await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)
	if (r.status !== 200) throw new Error(`Snapshot ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return new Map((r.data.items || []).map((i) => [i.id, i]))
}

/** The /sync of one board as a signed-in user (path with or without /index.php). */
const syncRe = (board) => new RegExp(`/apps/knorke/api/v1/boards/${board}/sync$`)

export const E18 = {
	id: 'E18',
	title: 'U8 im Browser: 500 für Ops mit Markertext → C und A kommen an, genau 3 Einzel-Wiederholungen je nach 2xx, Toast, Textrettung, online/pending 0; 6 s Ausfall → kein internal-Toast, alles kommt an',
	async run(t, world) {
		const board = await world.board('E2E U8')
		const a = await world.actor('alice-u8', { user: 'alice' })
		const p = a.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		await recordToasts(a.ctx)
		// every /sync of this board, in order: {t, marker, ops, status}
		const log = []
		let outage = false
		await a.ctx.route(`**/api/v1/boards/${board}/sync`, async (route) => {
			const raw = route.request().postData() || ''
			let body = null
			try { body = JSON.parse(raw) } catch { /* not JSON */ }
			const ops = Array.isArray(body?.ops) ? body.ops.length : 0
			const entry = { t: Date.now(), marker: raw.includes(MARKER), ops, status: null, outage }
			log.push(entry)
			if (outage || entry.marker) {
				entry.status = 500
				return route.fulfill({ status: 500, contentType: 'application/json', body: SERVER_ERROR_BODY })
			}
			try {
				const resp = await route.fetch()
				entry.status = resp.status()
				return route.fulfill({ response: resp })
			} catch (e) {
				entry.status = 'abort'
				return route.abort().catch(() => {})
			}
		})
		await openBoard(a, board)

		t.step('Teil A: Notizen A und B, B bekommt den Markertext, gleich danach C und A verschieben')
		const A = await createSticky(p, 0, 0, 'Notiz A')
		const B = await createSticky(p, 320, 0, 'Notiz B')
		await K.waitIdle(p, 10000)
		const before = await serverMap(board)
		t.must(before.has(A) && before.has(B), 'A und B beim Server', [...before.keys()])
		const iMark = log.length
		await editText(p, B, `${MARKER} in B`)
		const C = await createSticky(p, 0, 320, 'Notiz C')
		await dragItem(p, A, { dx: 160, dy: 40 })
		const doneA = await until(async () => {
			const s = await K.state(p)
			const last = log.filter((e) => e.marker).at(-1)
			return s.status === 'online' && s.pending === 0 && last && Date.now() - last.t > 3000 ? s : null
		}, { timeout: 90000, every: 250 })
		const sA = await K.state(p)
		t.check(doneA, 'danach online und pending 0 (Markertext-Op verworfen)', { status: sA.status, pending: sA.pending })
		const after = await serverMap(board)
		t.check(after.has(C) && after.get(C).data?.text === 'Notiz C', 'C kommt beim Server an')
		t.check(after.has(A) && after.get(A).x !== before.get(A).x, 'A ist beim Server verschoben', { vorher: before.get(A)?.x, nachher: after.get(A)?.x })
		t.check(after.has(B) && !String(after.get(B).data?.text || '').includes(MARKER), 'der Markertext erreicht den Server nie', after.get(B)?.data)
		// the marked op alone, right after a 2xx answer (its first send is no repetition)
		const seq = log.slice(iMark)
		const firstMarker = seq.findIndex((e) => e.marker)
		const singles = []
		seq.forEach((e, i) => {
			if (!e.marker || e.ops !== 1 || i === firstMarker) return
			const prev = seq.slice(0, i).reverse().find((x) => x.status !== null)
			singles.push({ i, afterOk: !!prev && typeof prev.status === 'number' && prev.status >= 200 && prev.status < 300 })
		})
		const afterOk = singles.filter((x) => x.afterOk).length
		t.check(afterOk === 3, 'genau 3 Einzel-Wiederholungen der Markertext-Op, je direkt nach einer 2xx-Antwort', { einzeln: singles.length, nach2xx: afterOk, folge: seq.map((e) => `${e.marker ? 'M' : '-'}${e.ops}:${e.status}`).join(' ') })
		t.note(`Folge ab dem Markertext: ${seq.map((e) => `${e.marker ? 'M' : '·'}${e.ops}/${e.status}`).join(' ')}`)
		const toasts = await toastsOf(p)
		t.check(toasts.some((x) => x.text === SERVER_ERROR_TOAST), `Toast „${SERVER_ERROR_TOAST}“`, toasts.map((x) => x.text))
		const edText = await p.locator('textarea[data-knorke-editor]').first().inputValue().catch(() => '')
		const dlg = p.locator('[data-knorke-dialog=rescue]').first()
		const dlgText = await dlg.isVisible().catch(() => false)
			? await dlg.locator('textarea').evaluateAll((els) => els.map((e) => e.value).join('\n')).catch(() => '')
			: ''
		t.check(edText.includes(MARKER) || dlgText.includes(MARKER), 'Textrettung: der Markertext steht im Rettungs-Editor oder im Kopier-Dialog', { editor: edText, dialog: dlgText })
		// close the rescue
		if (await dlg.isVisible().catch(() => false)) await dlg.locator('[data-knorke-action=confirm]').first().click().catch(() => {})
		if (await p.locator('textarea[data-knorke-editor]').first().isVisible().catch(() => false)) await p.keyboard.press('Escape')
		await K.waitIdle(p, 10000).catch(() => {})

		t.step('Teil B: 6 s lang jede /sync mit 500, dabei 2 Notizen und ein Text')
		const toastsBefore = (await toastsOf(p)).filter((x) => x.text === SERVER_ERROR_TOAST).length
		const iOut = log.length
		outage = true
		const tOut = Date.now()
		const D = await createSticky(p, 640, 0, 'Notiz D')
		const E = await createSticky(p, 640, 320, 'Notiz E')
		await editText(p, A, 'A geändert')
		await sleep(Math.max(0, 6000 - (Date.now() - tOut)))
		const sOut = await K.state(p)
		outage = false
		t.note(`während des Ausfalls: Status ${sOut.status}, pending ${sOut.pending}, ${log.length - iOut} Anfragen mit 500`)
		const doneB = await until(async () => {
			const s = await K.state(p)
			return s.status === 'online' && s.pending === 0 ? s : null
		}, { timeout: 90000, every: 250 })
		t.check(doneB, 'nach dem Ausfall: online, pending 0', await K.state(p))
		const final = await serverMap(board)
		t.check(final.get(D)?.data?.text === 'Notiz D' && final.get(E)?.data?.text === 'Notiz E', 'beide Notizen aus dem Ausfall kommen an', [final.get(D)?.data, final.get(E)?.data])
		t.check(final.get(A)?.data?.text === 'A geändert', 'die Textänderung aus dem Ausfall kommt an', final.get(A)?.data)
		const toastsAfter = (await toastsOf(p)).filter((x) => x.text === SERVER_ERROR_TOAST).length
		t.check(toastsAfter === toastsBefore, 'kein internal-Toast durch den Ausfall (ein Ausfall verwirft nie)', { vorher: toastsBefore, nachher: toastsAfter })
		await a.ctx.unroute(`**/api/v1/boards/${board}/sync`).catch(() => {})
		await world.drop(a)
	},
}

/** Displayed board title of a page (owner: the rename button, others: the h2). */
const titleOf = (p) => p.locator('.knorke-topbar__title').first().textContent({ timeout: 2000 }).then((s) => String(s || '').trim()).catch(() => null)

/** Waits until every page shows `title`; returns the ms per page (null = not within timeout). */
async function seeTitle(pages, title, t0, timeout = 6000) {
	return Promise.all(pages.map(async (p) => {
		const ok = await until(async () => (await titleOf(p)) === title, { timeout, every: 50 })
		return ok ? Date.now() - t0 : null
	}))
}

export const E19 = {
	id: 'E19',
	title: 'Live-Titel: Umbenennen in Tab A erscheint bei bob (Link-Mitglied) und Gina ≤ 3 s ohne Neuladen; offenes Umbenennen-Feld in Tab B behält den getippten Text, nach Esc Titel aus Tab A',
	async run(t, world) {
		const board = await world.board('E19 Start')
		const token = await linkToken(board)
		const a = await world.actor('alice-titel', { user: 'alice' })
		const pA = a.page
		await openBoard(a, board)
		const b = await world.actor('bob-titel', { user: 'bob' })
		await b.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
		await waitReady(b.page, 30000)
		const g = await world.actor('gina-titel')
		await g.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
		await field(g.page, 'guest-name', 'Gina')
		await action(g.page, 'guest-join')
		await waitReady(g.page, 30000)
		t.must((await titleOf(b.page)) === 'E19 Start' && (await titleOf(g.page)) === 'E19 Start', 'bob und Gina sehen den Starttitel', [await titleOf(b.page), await titleOf(g.page)])
		const loads = { bob: 0, gina: 0 }
		b.page.on('load', () => { loads.bob++ })
		g.page.on('load', () => { loads.gina++ })

		/** Renames through the TopBar of a page: click, fill, Enter. */
		const rename = async (p, title) => {
			await p.locator('[data-knorke-action=rename-board]').first().click()
			const f = p.locator('[data-knorke-field=title]').first()
			await f.waitFor({ state: 'visible', timeout: 5000 })
			await f.fill(title)
			const t0 = Date.now()
			await f.press('Enter')
			return t0
		}

		t.step('Tab A benennt um')
		const t1 = await rename(pA, 'E19 Titel eins')
		const [msB, msG] = await seeTitle([b.page, g.page], 'E19 Titel eins', t1)
		t.check(msB !== null && msB <= 3000, 'bob sieht den neuen Titel ≤ 3 s', msB)
		t.check(msG !== null && msG <= 3000, 'Gina sieht den neuen Titel ≤ 3 s', msG)
		t.check(loads.bob === 0 && loads.gina === 0, 'ohne Neuladen', loads)
		t.note(`neuer Titel bei bob nach ${msB} ms, bei Gina nach ${msG} ms`)

		t.step('Tab B öffnet das Umbenennen-Feld und tippt; Tab A benennt erneut um')
		const pB = await a.ctx.newPage()
		pB.on('dialog', (d) => d.accept().catch(() => {}))
		await pB.goto(`${APP}/b/${board}`, { waitUntil: 'domcontentloaded' })
		await waitReady(pB)
		await pB.locator('[data-knorke-action=rename-board]').first().click()
		const fB = pB.locator('[data-knorke-field=title]').first()
		await fB.waitFor({ state: 'visible', timeout: 5000 })
		await fB.fill('')
		await fB.type('Entwurf in Tab B', { delay: 10 })
		const t2 = await rename(pA, 'E19 Titel zwei')
		const [msB2] = await seeTitle([b.page], 'E19 Titel zwei', t2)
		t.check(msB2 !== null && msB2 <= 3000, 'bob sieht den zweiten Titel ≤ 3 s', msB2)
		await K.waitIdle(pB, 10000).catch(() => {})
		await sleep(2500)
		const kept = await fB.inputValue().catch(() => null)
		t.check(kept === 'Entwurf in Tab B', 'das offene Feld in Tab B behält den getippten Text', kept)
		await fB.press('Escape')
		const shownB = await until(async () => ((await titleOf(pB)) === 'E19 Titel zwei' ? true : null), { timeout: 5000 })
		t.check(shownB, 'nach Esc zeigt Tab B den Titel aus Tab A', await titleOf(pB))
		const list = await api('alice', 'GET', '/api/v1/boards')
		t.check((list.data?.boards || []).find((x) => x.id === board)?.title === 'E19 Titel zwei', 'Server kennt den Titel aus Tab A (Tab B hat nichts gespeichert)')
		t.check((await titleOf(g.page)) === 'E19 Titel zwei' && loads.bob === 0 && loads.gina === 0, 'Gina sieht ihn ebenfalls, weiter ohne Neuladen', { gina: await titleOf(g.page), loads })
		await pB.goto('about:blank').catch(() => {})
		await pB.close().catch(() => {})
	},
}

/**
 * Route handler: the next /sync after arming gets 409 protocol with the given
 * server version, everything else reaches the server. stats.answered counts
 * the 409 answers.
 */
function jumpOnce(stats) {
	return async (route) => {
		if (stats.armed !== null) {
			const proto = stats.armed
			stats.armed = null
			stats.answered.push(proto)
			return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'protocol', message: 'Protocol mismatch', proto }) })
		}
		return route.continue()
	}
}

export const E20 = {
	id: 'E20',
	title: 'Protokollsprung: 409 {proto: 3} → genau ein Neuladen; 409 {proto: 4} in derselben Tab-Sitzung → wieder genau eins; dieselbe Version noch einmal → eingefroren; mit offenem Editor → kein Neuladen, Banner reload',
	async run(t, world) {
		const board = await world.board('E2E Protokollsprung')
		const a = await world.actor('alice-sprung', { user: 'alice' })
		const p = a.page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		const SYNC = syncRe(board)
		const stats = { armed: null, answered: [] }
		await p.route(SYNC, jumpOnce(stats))
		await openBoard(a, board)
		await createSticky(p, 0, 0, 'vor dem Sprung')
		await K.waitIdle(p, 10000)
		const loads = []
		const urls = []
		p.on('load', () => loads.push(p.url()))
		p.on('framenavigated', (f) => { if (f === p.mainFrame()) urls.push(f.url()) })

		/** Arms one 409 with `proto`, waits until it was answered and the page settled. */
		const jump = async (proto, expectReload) => {
			const n0 = loads.length
			const a0 = stats.answered.length
			stats.armed = proto
			await K.forceTick(p).catch(() => {})
			const answered = await until(() => stats.answered.length > a0 && stats.answered.at(-1) === proto, { timeout: 15000 })
			t.check(answered, `409 {proto: ${proto}} wurde ausgeliefert`, stats)
			if (expectReload) {
				await until(() => loads.length > n0, { timeout: 15000 })
				await waitReady(p, 30000).catch(() => {})
			}
			await sleep(4000)
			return loads.length - n0
		}

		t.step('erster Sprung: 409 {proto: 3}')
		let n = await jump(3, true)
		t.check(n === 1, 'genau ein Neuladen', { n, loads })
		t.check(urls.some((u) => /[?&]knorke-reload=/.test(u)), 'mit Cache-Bust-Parameter knorke-reload', urls)
		let st = await K.state(p).catch(() => null)
		t.check(st?.status === 'online', 'danach online', st)

		t.step('zweiter Sprung in derselben Tab-Sitzung: 409 {proto: 4}')
		n = await jump(4, true)
		t.check(n === 1, 'wieder genau ein Neuladen (Merker je Version)', { n, loads })
		st = await K.state(p).catch(() => null)
		t.check(st?.status === 'online', 'danach online', st)

		t.step('derselbe Sprung noch einmal: 409 {proto: 4}')
		n = await jump(4, false)
		t.check(n === 0, 'kein Neuladen (Merker = 4)', { n, loads })
		st = await K.state(p).catch(() => null)
		t.check(st?.status === 'reload' && await bannerVisible(p, 'reload'), 'eingefroren mit Banner reload', st)

		t.step('Reload im Banner, dann mit offenem Editor: 409 {proto: 5}')
		const n0 = loads.length
		await p.locator('[data-knorke-banner=reload] button').first().click()
		await until(() => loads.length > n0, { timeout: 15000 })
		await waitReady(p, 30000)
		const loadsBefore = loads.length
		const ids = new Set((await itemMap(p)).keys())
		const [first] = ids
		t.must(first, 'eine Notiz zum Bearbeiten', [...ids])
		const c = await centerOf(p, first)
		await p.mouse.dblclick(c.x, c.y)
		const ed = p.locator('textarea[data-knorke-editor]').first()
		await ed.waitFor({ state: 'visible', timeout: 5000 })
		await p.keyboard.press('Control+A')
		await p.keyboard.type('offen beim Sprung', { delay: 5 })
		n = await jump(5, false)
		t.check(loads.length === loadsBefore && n === 0, 'mit offenem Editor kein automatisches Neuladen', { loads })
		st = await K.state(p).catch(() => null)
		t.check(st?.status === 'reload' && await bannerVisible(p, 'reload'), 'Status reload, Banner reload', st)
		const text = await ed.inputValue().catch(() => null)
		t.check(text === 'offen beim Sprung', 'der Editor behält seinen Text', text)
		await p.unroute(SYNC).catch(() => {})
		await world.drop(a)
	},
}
