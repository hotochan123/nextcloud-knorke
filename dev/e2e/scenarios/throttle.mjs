/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E09b app throttle on /sync (SPEC-M0 R3: §6.4, §6.5, §6.8, §10.2). Not in
 * the §8.2 table; it guards the frozen DOM hook [data-knorke-banner=rate_limited]
 * that [C] hands to [D].
 *
 * The server cannot be made to throttle /sync on purpose (the app 429 comes
 * from Limits/LinkThrottle), so the browser context answers the FIRST /sync
 * with ops after arming with 429 {error:'rate_limited'} via ctx.route; every
 * other request reaches the dev stack unchanged.
 *
 * Expected (spec): status 'rate_limited' (final, loop stops, never repeated),
 * banner rate_limited, scene view-only, an open editor keeps its text with a
 * notice (text rescue §6.5), waitIdle throws (§6.7). Own board and own
 * context: the shared world of E03–E09 is not touched.
 */
import { K, createSticky, openBoard, tool, until, sleep, bannerVisible, api, serverMap } from '../lib/harness.mjs'

const RL_BODY = JSON.stringify({ error: 'rate_limited', message: 'Too many requests' })
const SYNC_RE = /\/api\/v1\/boards\/\d+\/sync$/

export const E09b = {
	id: 'E09b',
	title: 'Drossel: App-429 auf /sync → Status und Banner rate_limited, endgültig, Text bleibt',
	async run(t, world) {
		const board = await world.board('E2E Drossel')
		const a = await world.actor('alice-rl', { user: 'alice' })
		const p = a.page
		// a beforeunload prompt (unacknowledged ops) must not block leaving the page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		let armed = false
		let throttled = 0
		await a.ctx.route(`**/api/v1/boards/${board}/sync`, async (route) => {
			let body = null
			try { body = JSON.parse(route.request().postData() || '{}') } catch { /* not JSON */ }
			if (armed && Array.isArray(body?.ops) && body.ops.length > 0) {
				throttled++
				return route.fulfill({ status: 429, contentType: 'application/json', body: RL_BODY })
			}
			return route.continue()
		})
		await openBoard(a, board)
		await createSticky(p, 0, 0, 'vor der Drossel')
		await K.waitIdle(p, 10000)
		const s0 = await K.state(p)
		t.must(s0.status === 'online' && !s0.viewOnly, 'vorher online und bearbeitbar', s0)

		t.step('Drossel scharf; neue Notiz, Editor bleibt offen')
		armed = true
		await tool(p, 'sticky')
		const pt = await K.w2s(p, 300, 0)
		await p.mouse.click(pt.x, pt.y)
		const ed = p.locator('textarea[data-knorke-editor]')
		await ed.waitFor({ state: 'visible', timeout: 5000 })
		const typed = 'getippt vor dem 429'
		await p.keyboard.type(typed, { delay: 5 })
		const tArm = Date.now()
		const st = await until(async () => ((await K.state(p)).status === 'rate_limited' ? Date.now() - tArm : null), { timeout: 8000 })
		const s1 = await K.state(p)
		t.check(st, 'state().status === rate_limited', { status: s1.status, pending: s1.pending, inflight: s1.inflight })
		t.check(throttled === 1, 'genau eine gedrosselte /sync-Anfrage (nicht wiederholt)', throttled)
		t.check(await bannerVisible(p, 'rate_limited'), '[data-knorke-banner=rate_limited] sichtbar')
		t.check(!(await bannerVisible(p, 'gone')) && !(await bannerVisible(p, 'revoked')), 'kein gone-/revoked-Banner')
		// §6.5: the SCENE goes view-only (scene.setViewOnly); state().viewOnly is
		// the device/role flag of the session and stays as it was
		const sc = await K.scene(p)
		t.check(sc.viewOnly === true, 'Szene im Ansehen-Modus (scene().viewOnly)', sc.viewOnly)
		t.check((await p.locator('[data-knorke-toolbar]').count()) === 0, 'keine Werkzeugleiste mehr')
		const edState = await ed.getAttribute('data-knorke-editor-state').catch(() => null)
		const edText = await ed.inputValue().catch(() => null)
		t.check(edState === 'locked' && edText === typed, 'offener Editor behält den Text mit Hinweis (locked)', { edState, edText })
		const waitErr = await p.evaluate(() => window.__knorke.waitIdle(2000).then(() => null, (e) => String(e?.message || e)))
		t.check(typeof waitErr === 'string' && waitErr.length > 0, 'waitIdle wirft bei gestopptem Sync', waitErr)

		t.step('5 s Ruhe trotz Mausbewegung')
		const tq = Date.now()
		const c0 = await K.counters(p)
		await p.mouse.move(pt.x + 60, pt.y + 60)
		await sleep(5000)
		const c1 = await K.counters(p)
		const quiet = a.requestsSince(tq, SYNC_RE)
		t.check(quiet.length === 0 && c1.syncRequests === c0.syncRequests, 'keine /sync-Anfrage nach dem 429', { reqs: quiet.length, c0: c0.syncRequests, c1: c1.syncRequests })

		t.step('Seite verlassen: kein Keepalive-Nachschuss')
		const tl = Date.now()
		await p.goto('about:blank').catch(() => {})
		await sleep(1500)
		const leave = a.requestsSince(tl, SYNC_RE)
		t.check(leave.length === 0 && throttled === 1, 'beim Verlassen keine /sync-Anfrage (nie wiederholt)', { reqs: leave.length, throttled })
		await world.drop(a)
	},
}

/**
 * The final statuses of the session (SPEC-M1 §6.4 FINAL_STATUSES =
 * FROZEN_STATUSES of src/board/BoardSession.js; dev/e2e/stage4.test.mjs
 * compares the two lists). E09c reads them every 150 ms.
 */
export const FROZEN_STATUSES = Object.freeze(['gone', 'revoked', 'logged_out', 'rate_limited', 'reload', 'links_disabled', 'link_expired', 'password_required'])

/** E09c reads status and banners this often (SPEC-M1 §33.1 k: every 150 ms). */
export const E09C_SAMPLE_MS = 150

/** The body of a reverse proxy or WAF that answers 403/404 itself: HTML, no JSON with `error`. */
const PROXY_BODY = { 403: '<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>Forbidden</h1><p>Request blocked.</p></body></html>\n', 404: '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>\n' }

/*
 * E09c proxy 403/404 without an app body on /sync (P7-07, SPEC-M1 §33.1 i, k;
 * Revision 22): own board and own context like E09b; after arming, ctx.route
 * answers the FIRST /sync with ops once with 403 text/html (no JSON), and
 * after a new note the next /sync with ops once with 404 text/html; every
 * other request reaches the dev stack. Such an answer is not the app's
 * (HttpError.fromApp false): the failure path with backoff, never a final
 * status. Expected: the status (read every 150 ms) is never final, never
 * [data-knorke-banner=gone] nor the banner of any other FROZEN_STATUSES
 * status, never offline after a single such answer, both notes reach the
 * server (snapshot as bob), pending 0 afterwards. Check labels name one owner
 * (SPEC-M1 §9.6): [C] client, [B] server answer, [D] harness precondition.
 */
export const E09c = {
	id: 'E09c',
	title: 'Proxy-403/404 ohne App-Body auf /sync (P7-07): einmal 403 text/html, nach einer neuen Notiz einmal 404 text/html → Status nie endgültig, kein gone-/Frozen-Banner, kein offline nach einer einzelnen Antwort, beide Notizen beim Server (Snapshot als bob), pending 0',
	async run(t, world) {
		const board = await world.board('E2E Proxy-403')
		const sh = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: [{ kind: 'user', id: 'bob', role: 'edit' }] })
		t.must(sh.status === 200, '[B] Vorbedingung: Board mit bob geteilt (PUT shares → 200)', sh.text.slice(0, 200))
		const a = await world.actor('alice-proxy', { user: 'alice' })
		const p = a.page
		// a beforeunload prompt (unacknowledged ops) must not block leaving the page
		p.on('dialog', (d) => d.accept().catch(() => {}))
		// the next /sync with ops gets this status once (null = pass everything)
		let armed = null
		const injected = []
		// every /sync with ops (time, seq, what it got) – for the note on the retry after each answer
		const withOps = []
		await a.ctx.route(`**/api/v1/boards/${board}/sync`, async (route) => {
			let body = null
			try { body = JSON.parse(route.request().postData() || '{}') } catch { /* not JSON */ }
			const hasOps = Array.isArray(body?.ops) && body.ops.length > 0
			if (armed !== null && hasOps) {
				const status = armed
				armed = null
				injected.push({ status, seq: body.seq ?? null, at: Date.now() })
				withOps.push({ at: Date.now(), seq: body.seq ?? null, got: status })
				return route.fulfill({ status, contentType: 'text/html; charset=utf-8', body: PROXY_BODY[status] })
			}
			if (hasOps) withOps.push({ at: Date.now(), seq: body.seq ?? null, got: 'server' })
			return route.continue()
		})
		await openBoard(a, board)
		await createSticky(p, 0, 0, 'vor dem Proxy')
		await K.waitIdle(p, 10000)
		const s0 = await K.state(p)
		t.must(s0.status === 'online' && !s0.viewOnly, '[C] Vorbedingung: online und bearbeitbar', s0)

		// status and banners every 150 ms through the whole case: a timer in the page (one read per tick,
		// independent of the round trips of the test runner), collected at the end
		await p.evaluate(([names, every]) => {
			const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
			const sample = () => {
				let status = null
				try { status = window.__knorke.state().status } catch (e) { status = null }
				const banners = names.filter((n) => vis(document.querySelector(`[data-knorke-banner="${n}"]`)))
				window.__kdE09c.push({ at: Date.now(), status, banners })
			}
			window.__kdE09c = []
			sample()
			window.__kdE09cTimer = setInterval(sample, every)
		}, [[...FROZEN_STATUSES, 'offline'], E09C_SAMPLE_MS])

		// a note that cannot be made (a frozen board) is noted; the status checks below still run
		const note = (wx, text) => createSticky(p, wx, 0, text).then(() => true, (err) => {
			t.note(`Notiz „${text}“ nicht angelegt: ${String(err?.message || err).split('\n')[0].slice(0, 160)}`)
			return false
		})
		// waits until the client is through on its own: only state() is read, never waitIdle (it forces
		// ticks and would skip the client's backoff after the proxy answer)
		const recovered = (k) => until(async () => {
			const st = await K.state(p).catch(() => null)
			return injected.length >= k && st && st.pending === 0 && !st.inflight ? st : null
		}, { timeout: 25000, every: 150 })
		t.step('403 text/html scharf; neue Notiz')
		armed = 403
		const made1 = await note(300, 'nach dem 403')
		await recovered(1)
		if (made1) {
			t.step('404 text/html scharf; noch eine Notiz')
			armed = 404
			await note(600, 'nach dem 404')
			await recovered(2)
		}
		await K.waitIdle(p, 10000).catch(() => {})
		await sleep(600)
		const samples = await p.evaluate(() => {
			clearInterval(window.__kdE09cTimer)
			return window.__kdE09c || []
		}).catch(() => [])
		armed = null

		t.check(injected.length === 2 && injected[0].status === 403 && injected[1].status === 404, '[C] der Client schickt nach dem 403 weiter Anfragen mit Ops: genau eine bekam 403 text/html, danach genau eine 404 text/html', injected)
		const covered = injected.length >= 1 && samples.length > 0 && samples[0].at <= injected[0].at && samples[samples.length - 1].at >= injected[injected.length - 1].at
		t.check(covered, '[D] die Proben (alle 150 ms) reichen von vor dem 403 bis nach der letzten eingespeisten Antwort', { samples: samples.length, first: samples[0]?.at, last: samples[samples.length - 1]?.at, injected })
		t.check(samples.length > 0 && samples.every((x) => !FROZEN_STATUSES.includes(x.status)), '[C] state().status nie endgültig (FROZEN_STATUSES), alle 150 ms gelesen', samples.filter((x) => FROZEN_STATUSES.includes(x.status)).slice(0, 3))
		t.check(samples.every((x) => !x.banners.includes('gone')), '[C] nie [data-knorke-banner=gone]', samples.filter((x) => x.banners.includes('gone')).slice(0, 3))
		t.check(samples.every((x) => !x.banners.some((n) => FROZEN_STATUSES.includes(n))), '[C] kein Banner eines Status aus FROZEN_STATUSES', samples.filter((x) => x.banners.length).slice(0, 3))
		t.check(samples.every((x) => x.status !== 'offline' && !x.banners.includes('offline')), '[C] nach einer einzelnen solchen Antwort kein offline (Status und [data-knorke-banner=offline])', samples.filter((x) => x.status === 'offline' || x.banners.includes('offline')).slice(0, 3))
		const srv = await serverMap('bob', board)
		const texts = [...srv.values()].map((it) => it.data?.text)
		t.check(texts.includes('nach dem 403') && texts.includes('nach dem 404'), '[C] beide Notizen kommen an (Snapshot als bob)', texts)
		const s1 = await K.state(p)
		t.check(s1.pending === 0 && s1.status === 'online', '[C] danach pending 0 und online', { status: s1.status, pending: s1.pending, inflight: s1.inflight })
		const retries = injected.map((x) => {
			const next = withOps.find((r) => r.at > x.at && r.got === 'server')
			return `${x.status} (seq ${x.seq}) → nächste Anfrage mit Ops nach ${next ? next.at - x.at : '–'} ms (seq ${next ? next.seq : '–'})`
		})
		t.note(`eingespeist: ${retries.join('; ')}; Status gesehen: ${[...new Set(samples.map((x) => x.status))].join(', ')}; Proben ${samples.length} (alle ${E09C_SAMPLE_MS} ms)`)
		await a.ctx.unroute(`**/api/v1/boards/${board}/sync`)
		await world.drop(a)
	},
}
