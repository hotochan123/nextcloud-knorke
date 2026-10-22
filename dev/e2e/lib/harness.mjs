/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Helpers of the browser acceptance (SPEC-M0 §8.2), used inside the
 * Playwright container only.
 *
 * - Every context runs with locale en-US unless a case asks for another one
 *   (option locale, E43; alice/bob also have core lang en),
 *   so checked texts are the English source strings; the checks themselves go
 *   through window.__knorke (§6.7) and the DOM test hooks (§6.8).
 * - Before every page: localStorage key that hides Nextcloud's
 *   "unsupported browser" page.
 * - page.on('pageerror') is collected per actor, for its first page and for
 *   every later page of its context (lib/browsers.mjs watchContext); a
 *   scenario fails when any page it used threw, also of an actor it dropped
 *   before its end (World.drop keeps the errors).
 * - Setup/cleanup via the API (node fetch, Basic auth + OCS-APIRequest: no
 *   CSRF token needed), checks via the UI.
 */
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { watchContext } from './browsers.mjs'

export const ENV = JSON.parse(fs.readFileSync(process.env.KD_ENV_JSON || '/state/env.json', 'utf8'))
export const BASE = ENV.baseNet
export const APP_PATH = '/index.php/apps/knorke'
export const APP = BASE + APP_PATH
export const DESKTOP = { width: 1440, height: 900 }
export const TABLET = { width: 820, height: 1180 }
/** The phone viewport of the stage-3 viewport passes (SPEC-M1 §6.6 narrow layout, §8.4 R16). */
export const PHONE = { width: 390, height: 844 }
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

// ── actors ───────────────────────────────────────────────────────────────

export class Actor {
	constructor(name, ctx, page, kind) {
		this.name = name
		this.ctx = ctx
		this.page = page
		this.kind = kind
		this.errors = []
		this.requests = []
		this.takeOvers = 0
		this.trace = []
		this.traceE = undefined
		// every page of the context: second tabs (E19, E24 board 2), helper pages
		watchContext(ctx, page, this.errors)
		page.on('request', (r) => {
			const u = r.url()
			// with or without /index.php: Nextcloud's front controller drops it in generated URLs
			if (!/\/apps\/knorke\//.test(u) || /\/custom_apps\//.test(u)) return
			const entry = { t: Date.now(), method: r.method(), url: u, status: null }
			this.requests.push(entry)
			// the HTTP status of its answer (E09, SPEC-M1 §1.2 R23: no 401/403 after a
			// revocation); stays null while none came and when the request failed
			r.response().then((resp) => { entry.status = resp ? resp.status() : null }).catch(() => {})
			// diagnostics for the text lease: did this page ever send me.tk?
			if (/\/sync$/.test(u)) {
				const body = r.postData() || ''
				if (/"tk":1/.test(body)) this.takeOvers++
				if (/"me":\{/.test(body)) this.lastMe = body.slice(body.indexOf('"me":'), body.indexOf('"me":') + 160)
				let j = null
				try { j = JSON.parse(body) } catch { /* not JSON */ }
				if (j) this.traceSync(r, j)
			}
		})
	}

	/**
	 * Protocol trace for red scenarios (report via lib/cli.mjs traceMarkdown):
	 * every /sync with ops or me.tk, and every request whose me.e differs from
	 * the last traced one (lease handover is visible even without ops). The
	 * answer fills acks.res, the holder of the own me.e among the others
	 * (presence h = 1) and the rev.
	 */
	traceSync(r, j) {
		const e = j.me && 'e' in j.me ? (j.me.e ?? null) : this.traceE
		const eChanged = j.me && e !== this.traceE
		if (!(j.ops?.length || j.me?.tk || eChanged)) return
		if (j.me) this.traceE = e
		const texts = (j.ops || []).filter((o) => o.p && ('data.text' in o.p || 'data.title' in o.p)).map((o) => String(o.p['data.text'] ?? o.p['data.title']).slice(-16))
		const entry = { at: Date.now(), seq: j.seq ?? null, tk: j.me?.tk ? 1 : 0, e: typeof e === 'string' ? e.slice(-6) : null, ops: j.ops?.length || 0, texts, res: null, holder: null, rev: null, pending: true }
		this.trace.push(entry)
		if (this.trace.length > 200) this.trace.shift()
		r.response().then((resp) => resp && resp.json()).then((d) => {
			entry.pending = false
			entry.res = d?.acks?.res ?? null
			entry.rev = d?.rev ?? null
			if (typeof e === 'string' && d?.presence && typeof d.presence === 'object') {
				const names = Object.values(d.presence).filter((p) => p && p.e === e && p.h === 1).map((p) => p.n)
				entry.holder = names.length ? names.join(',') : 'kein anderer'
			}
		}).catch(() => { entry.pending = false })
	}

	/** Marks a step of the scenario in the trace (shown between the /sync rows). */
	event(label) {
		this.trace.push({ at: Date.now(), ev: String(label) })
		if (this.trace.length > 200) this.trace.shift()
	}

	/**
	 * Requests to the app since t (ms epoch), optionally filtered by a RegExp on
	 * the URL: {t, method, url, status}, status = HTTP status of the answer or null.
	 */
	requestsSince(t, re = null) {
		return this.requests.filter((r) => r.t >= t && (!re || re.test(r.url)))
	}

	async close() {
		await this.ctx.close().catch(() => {})
	}
}

/**
 * New browser context + page. user = 'alice' | 'bob' logs in through the
 * Nextcloud form; touch = tablet context (hasTouch, isMobile, 820×1180);
 * colorScheme = 'light' | 'dark' sets prefers-color-scheme of the context
 * (Playwright's default is light; E15/E16 check the guest page in both);
 * timeout = default timeout of the page in ms (login included; Firefox in
 * E24 needs more than 15 s for its first login); reducedMotion = 'reduce'
 * sets prefers-reduced-motion (E33, SPEC-M1 §8.4 R16: following jumps, the
 * glide itself is G15's). (H1, SPEC-M1 §35) deviceScaleFactor = the
 * context's devicePixelRatio; fine = true makes matchMedia('(any-pointer:
 * fine)') answer true before the app loads (finePointerInit): a touch device
 * that also reports a fine pointer (a pen, a touchpad, some Samsung touch
 * drivers), which Chromium cannot emulate otherwise (E39). (M2 privacy
 * notice) locale = the context's locale and Accept-Language (default en-US;
 * E43 opens the guest page as de-DE and fr-FR); user = ENV.admin.user logs
 * in with ENV.admin.pass (E44 opens the admin section).
 */
export async function newActor(browser, name, { user = null, touch = false, viewport = null, colorScheme = null, timeout = 15000, reducedMotion = null, locale = 'en-US', deviceScaleFactor = null, fine = false } = {}) {
	if (typeof locale !== 'string' || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(locale)) throw new Error(`newActor: locale '${locale}' ist ungültig`)
	const opts = { locale, viewport: viewport || (touch ? TABLET : DESKTOP) }
	if (touch) Object.assign(opts, { hasTouch: true, isMobile: true })
	if (deviceScaleFactor !== null) opts.deviceScaleFactor = deviceScaleFactor
	if (colorScheme === 'light' || colorScheme === 'dark') opts.colorScheme = colorScheme
	else if (colorScheme !== null) throw new Error(`newActor: colorScheme '${colorScheme}' ist ungültig`)
	if (reducedMotion === 'reduce' || reducedMotion === 'no-preference') opts.reducedMotion = reducedMotion
	else if (reducedMotion !== null) throw new Error(`newActor: reducedMotion '${reducedMotion}' ist ungültig`)
	const ctx = await browser.newContext(opts)
	await ctx.addInitScript(() => {
		try { window.localStorage.setItem('nextcloud_vol_Y29yZQ==_unsupported-browser-ignore', 'true') } catch (e) { /* storage blocked */ }
	})
	if (fine) await ctx.addInitScript(finePointerInit)
	const page = await ctx.newPage()
	page.setDefaultTimeout(timeout)
	const a = new Actor(name, ctx, page, user ? 'user' : 'guest')
	if (user) await login(page, user)
	return a
}

/**
 * Init script of newActor({fine: true}) (H1, SPEC-M1 §35): matchMedia answers
 * (any-pointer: fine) with true, every other query as the browser does. Runs
 * in the page before the app (util/device.js reads it once per session).
 */
export function finePointerInit() {
	const orig = window.matchMedia.bind(window)
	window.matchMedia = (q) => {
		if (/\(\s*any-pointer\s*:\s*fine\s*\)/.test(String(q))) {
			return { matches: true, media: String(q), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } }
		}
		return orig(q)
	}
}

/** Password of a harness account: the admin's own (ENV.admin.pass), else the common user password. */
export const passOf = (user) => (user === ENV.admin?.user ? ENV.admin.pass : ENV.userPass)

/** Login through the Nextcloud form (/login, input[name=user], input[name=password]). */
export async function login(page, user, pass = passOf(user)) {
	await page.goto(BASE + '/index.php/login', { waitUntil: 'domcontentloaded' })
	await page.fill('input[name=user]', user)
	await page.fill('input[name=password]', pass)
	await Promise.all([
		page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }),
		page.click('button[type=submit]'),
	])
}

// ── API (setup, cleanup, cross-checks) ───────────────────────────────────

/** Knorke API as a user (Basic auth + OCS-APIRequest → no CSRF token needed); the admin with ENV.admin.pass (M2, route 27). */
export async function api(user, method, path, body) {
	const headers = {
		Authorization: 'Basic ' + Buffer.from(`${user}:${passOf(user)}`).toString('base64'),
		'OCS-APIRequest': 'true',
		Accept: 'application/json',
	}
	let payload
	if (body !== undefined) {
		payload = JSON.stringify(body)
		headers['Content-Type'] = 'application/json'
	} else if (!['GET', 'HEAD'].includes(method)) {
		payload = ''
	}
	const r = await fetch(APP + path, { method, headers, body: payload })
	const text = await r.text()
	let data = null
	try { data = JSON.parse(text) } catch { /* not JSON */ }
	return { status: r.status, data, text }
}

/** App config as admin through the provisioning API (E12 switches public_template). */
export async function setAppConfig(app, key, value) {
	const r = await fetch(`${BASE}/ocs/v2.php/apps/provisioning_api/api/v1/config/apps/${app}/${key}`, {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${ENV.admin.user}:${ENV.admin.pass}`).toString('base64'),
			'OCS-APIRequest': 'true',
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ value }),
	})
	return { status: r.status, text: (await r.text()).slice(0, 300) }
}

export async function createBoard(user, title) {
	const r = await api(user, 'POST', '/api/v1/boards', { title })
	if (r.status !== 201 || !r.data?.board?.id) throw new Error(`Board anlegen (${user}): ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.board.id
}

export async function listBoards(user) {
	const r = await api(user, 'GET', '/api/v1/boards')
	if (r.status !== 200) throw new Error(`Board-Liste (${user}): ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.boards || []
}

// ── window.__knorke (§6.7) ───────────────────────────────────────────────

export const K = {
	state: (p) => p.evaluate(() => window.__knorke.state()),
	items: (p) => p.evaluate(() => window.__knorke.items()),
	confirmed: (p) => p.evaluate(() => window.__knorke.confirmed()),
	serverItems: (p) => p.evaluate(() => window.__knorke.serverItems()),
	scene: (p) => p.evaluate(() => window.__knorke.scene()),
	camera: (p) => p.evaluate(() => window.__knorke.camera()),
	presence: (p) => p.evaluate(() => window.__knorke.presence()),
	rect: (p, id) => p.evaluate((i) => window.__knorke.itemScreenRect(i), id),
	w2s: (p, x, y) => p.evaluate(([a, b]) => window.__knorke.worldToScreen(a, b), [x, y]),
	waitIdle: (p, ms = 10000) => p.evaluate((m) => window.__knorke.waitIdle(m), ms),
	counters: (p) => p.evaluate(() => window.__knorke.counters()),
	setCursor: (p, n) => p.evaluate((c) => window.__knorke.debug.setCursor(c), n),
	forceTick: (p) => p.evaluate(() => window.__knorke.debug.forceTick()),
	// SPEC-M1 §6.7, stage 1 ([C] installs them): null while the hook is missing, so a
	// scenario can say so instead of throwing "is not a function"
	handles: (p) => p.evaluate(() => (typeof window.__knorke?.handles === 'function' ? window.__knorke.handles() : null)),
	selection: (p) => p.evaluate(() => (typeof window.__knorke?.selection === 'function' ? window.__knorke.selection() : null)),
	connector: (p, id) => p.evaluate((i) => (typeof window.__knorke?.connector === 'function' ? window.__knorke.connector(i) : null), id),
	// SPEC-M1 §6.7, stage 3 ([C]): meta() (applied board.meta), votes() and
	// sentPresence() (R16). A missing hook gives the string 'missing', so a
	// scenario can tell it from a real null.
	meta: (p) => p.evaluate(() => (typeof window.__knorke?.meta === 'function' ? window.__knorke.meta() : 'missing')),
	votes: (p) => p.evaluate(() => (typeof window.__knorke?.votes === 'function' ? window.__knorke.votes() : 'missing')),
	sentPresence: (p) => p.evaluate(() => (typeof window.__knorke?.sentPresence === 'function' ? window.__knorke.sentPresence() : 'missing')),
}

/** items() parsed: Map id → item. */
export async function itemMap(p) {
	const m = new Map()
	for (const s of await K.items(p)) {
		const o = JSON.parse(s)
		m.set(o.id, o)
	}
	return m
}

/**
 * Waits until the board session runs: __knorke present, status online, cursor set.
 * Polls with page.evaluate from Node: page.waitForFunction fails under
 * Nextcloud's CSP (no 'unsafe-eval') even in function form ("Refused to
 * evaluate a string"), because Playwright's in-page polling uses eval – and
 * the contexts deliberately keep the CSP on (SPEC-M1 §15, docs/ENTWICKLUNG.md
 * trap 9.10).
 */
export async function waitReady(page, timeout = 20000) {
	let last = null
	const ok = await until(async () => {
		last = await page.evaluate(() => {
			const k = window.__knorke
			if (!k || typeof k.state !== 'function') return { hook: false }
			return { hook: true, ...k.state() }
		})
		return last.hook && last.status === 'online' && last.cursor !== null && last.cursor !== undefined
	}, { timeout, every: 100 })
	if (!ok) throw new Error(`Board-Sitzung nicht bereit nach ${timeout} ms (${last ? JSON.stringify(last) : 'Seite antwortet nicht'})`)
}

/** Polls fn until it returns a truthy value (returned) or the timeout passes (returns last value). */
export async function until(fn, { timeout = 5000, every = 100 } = {}) {
	const t0 = Date.now()
	let v
	while (Date.now() - t0 <= timeout) {
		try { v = await fn() } catch (e) { v = undefined }
		if (v) return v
		await sleep(every)
	}
	return v
}

/** Opens a board page and waits for the session. */
export async function openBoard(actor, id) {
	const r = await actor.page.goto(`${APP}/b/${id}`, { waitUntil: 'domcontentloaded' })
	await waitReady(actor.page)
	return r
}

/** Center of an item in client coordinates (for page.mouse). */
export async function centerOf(page, id) {
	const r = await K.rect(page, id)
	if (!r) throw new Error(`itemScreenRect(${id}) = null`)
	return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** Clicks the tool button and checks aria-pressed. */
export async function tool(page, name) {
	const b = page.locator(`[data-knorke-tool=${name}]`).first()
	await b.click()
	await until(async () => (await b.getAttribute('aria-pressed')) === 'true', { timeout: 2000 })
}

/**
 * Waits until every page saw every write: waitIdle on all pages (each writer
 * has its ops acknowledged, i.e. on the server), then once more on all pages
 * (each one completes a full tick after the last write). One round is not
 * enough: a reader's tick can run before a concurrent writer's commit.
 */
export async function settle(pages, ms = 15000) {
	await Promise.all(pages.map((p) => K.waitIdle(p, ms)))
	await Promise.all(pages.map((p) => K.waitIdle(p, ms)))
}

/** Ids of items() as a Set. */
export async function idSet(page) {
	return new Set((await itemMap(page)).keys())
}

/** Waits for a new id in items() that is not in `before`; returns it. */
export async function newId(page, before, timeout = 5000) {
	const id = await until(async () => {
		for (const k of await idSet(page)) if (!before.has(k)) return k
		return null
	}, { timeout })
	if (!id) throw new Error('kein neues Objekt erschienen')
	return id
}

/**
 * Creates a sticky with the sticky tool at world point (wx, wy), types text,
 * ends the editor with Esc (= commit, §6.3). Returns the new id.
 *
 * The id is found by its (unique) text, not as "the id that appeared": other
 * actors create notes at the same time, and theirs arrive through sync.
 */
export async function createSticky(page, wx, wy, text) {
	const before = await idSet(page)
	await tool(page, 'sticky')
	const p = await K.w2s(page, wx, wy)
	await page.mouse.click(p.x, p.y)
	const ed = page.locator('textarea[data-knorke-editor]')
	await ed.waitFor({ state: 'visible', timeout: 5000 })
	if (text) await page.keyboard.type(text, { delay: 5 })
	await page.keyboard.press('Escape')
	await ed.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
	if (!text) return newId(page, before)
	const id = await until(async () => {
		for (const [k, it] of await itemMap(page)) if (!before.has(k) && it.data?.text === text) return k
		return null
	}, { timeout: 5000 })
	if (!id) throw new Error(`keine neue Notiz mit Text „${text}“`)
	return id
}

/** Draws a frame with the frame tool between two world points; returns the new id. */
export async function createFrame(page, w1, w2) {
	const before = await idSet(page)
	await tool(page, 'frame')
	const a = await K.w2s(page, w1.x, w1.y)
	const b = await K.w2s(page, w2.x, w2.y)
	await page.mouse.move(a.x, a.y)
	await page.mouse.down()
	for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8)
	await page.mouse.up()
	// by type: notes of other actors may arrive through sync meanwhile
	const id = await until(async () => {
		for (const [k, it] of await itemMap(page)) if (!before.has(k) && it.t === 'frame') return k
		return null
	}, { timeout: 5000 })
	if (!id) throw new Error('kein neuer Frame erschienen')
	// a new frame may open its title editor; end it
	if (await page.locator('textarea[data-knorke-editor]').isVisible().catch(() => false)) await page.keyboard.press('Escape')
	await tool(page, 'select').catch(() => {})
	return id
}

/** Drags an item by its center to a client point (or by dx/dy), in small steps. */
export async function dragItem(page, id, { to = null, dx = 0, dy = 0, steps = 12, hold = 0 } = {}) {
	const c = await centerOf(page, id)
	const target = to || { x: c.x + dx, y: c.y + dy }
	await page.mouse.move(c.x, c.y)
	await page.mouse.down()
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(c.x + ((target.x - c.x) * i) / steps, c.y + ((target.y - c.y) * i) / steps)
		await sleep(16)
	}
	if (hold) await sleep(hold)
	await page.mouse.up()
}

/** Opens the editor of an existing item by double click, replaces the text, ends with Esc. */
export async function editText(page, id, text) {
	const c = await centerOf(page, id)
	await page.mouse.dblclick(c.x, c.y)
	const ed = page.locator('textarea[data-knorke-editor]')
	await ed.waitFor({ state: 'visible', timeout: 5000 })
	await page.keyboard.press('Control+A')
	await page.keyboard.type(text, { delay: 5 })
	await page.keyboard.press('Escape')
	await ed.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
}

/** Selects an item by clicking its center (select tool). */
export async function selectItem(page, id) {
	const c = await centerOf(page, id)
	await page.mouse.click(c.x, c.y)
}

/**
 * Clicks [data-knorke-action=<name>] inside `scope` (a locator or the page).
 * Actions that live in a closed NcActions menu are reached by opening the
 * menu trigger of the scope first; menu content is teleported to <body>.
 */
export async function action(page, name, scope = null) {
	const sel = `[data-knorke-action=${name}]`
	const inScope = (scope || page).locator(sel).first()
	if (await inScope.isVisible().catch(() => false)) return inScope.click()
	if (scope) {
		const trigger = scope.locator('button[aria-haspopup], .action-item__menutoggle').first()
		if (await trigger.isVisible().catch(() => false)) {
			await trigger.click()
			const anywhere = page.locator(sel + ':visible').first()
			await anywhere.waitFor({ state: 'visible', timeout: 5000 })
			return anywhere.click()
		}
	}
	const anywhere = page.locator(sel + ':visible').first()
	await anywhere.waitFor({ state: 'visible', timeout: 10000 })
	return anywhere.click()
}

/** Fills [data-knorke-field=<name>]. */
export async function field(page, name, value) {
	const f = page.locator(`[data-knorke-field=${name}]:visible`).first()
	await f.waitFor({ state: 'visible', timeout: 10000 })
	const tag = await f.evaluate((el) => el.tagName)
	// NcTextField puts the attribute on the wrapper or on the input
	const input = ['INPUT', 'TEXTAREA'].includes(tag) ? f : f.locator('input, textarea').first()
	await input.fill(value)
	return input
}

/** Value of [data-knorke-field=<name>] (input or wrapper with input). */
export async function fieldValue(page, name) {
	const f = page.locator(`[data-knorke-field=${name}]`).first()
	await f.waitFor({ state: 'attached', timeout: 10000 })
	return f.evaluate((el) => {
		const i = ['INPUT', 'TEXTAREA'].includes(el.tagName) ? el : el.querySelector('input, textarea')
		return i ? i.value : el.textContent.trim()
	})
}

export async function bannerVisible(page, name) {
	return page.locator(`[data-knorke-banner=${name}]`).first().isVisible().catch(() => false)
}

/** Equal string arrays. */
export const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])

/** First difference of two items() lists (for messages). */
export function firstDiff(a, b) {
	const sa = new Set(a)
	const sb = new Set(b)
	const onlyA = a.filter((x) => !sb.has(x))
	const onlyB = b.filter((x) => !sa.has(x))
	return { onlyA: onlyA.slice(0, 2), onlyB: onlyB.slice(0, 2), na: a.length, nb: b.length }
}

// ── SPEC-M1 stage 1 helpers (§6.3, §6.7, §6.8) ───────────────────────────

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/** ULID (26 Crockford base32 characters) for items the harness seeds through the API. */
export function ulid(now = Date.now()) {
	let t = now
	let out = ''
	for (let i = 0; i < 10; i++) { out = CROCK[t % 32] + out; t = Math.floor(t / 32) }
	const r = randomBytes(16)
	for (let i = 0; i < 16; i++) out += CROCK[r[i] % 32]
	return out
}

let zSeq = 0
/** Strictly increasing valid z keys (i0…iz, j00…), like dev/sim/lib/gen.mjs zKey. */
export function nextZ() {
	let n = zSeq++
	if (n < 36) return 'i' + B36[n]
	n -= 36
	return 'j' + B36[Math.floor(n / 36) % 36] + B36[n % 36]
}

/**
 * Writes ops to a board through /sync as `user` (setup of a scenario: the
 * board is seeded, the checks go through the UI). Epoch and rev come from a
 * snapshot. @returns {Promise<string[]>} acks.res; throws unless 200 with acks
 */
export async function seedOps(user, board, ops) {
	const s = await api(user, 'GET', `/api/v1/boards/${board}/snapshot`)
	if (s.status !== 200) throw new Error(`Snapshot ${board}: ${s.status} ${s.text.slice(0, 200)}`)
	const client = 'cSeed' + randomBytes(4).toString('hex').slice(0, 6)
	const r = await api(user, 'POST', `/api/v1/boards/${board}/sync`, { proto: 2, client, since: s.data.rev, ep: s.data.epoch, pres: 0, seq: 1, ops })
	if (r.status !== 200 || !Array.isArray(r.data?.acks?.res)) throw new Error(`Seed ${board}: ${r.status} ${r.text.slice(0, 300)}`)
	return r.data.acks.res
}

/** Items of the server's snapshot as a Map (API as `user`). */
export async function serverMap(user, board) {
	const r = await api(user, 'GET', `/api/v1/boards/${board}/snapshot`)
	if (r.status !== 200) throw new Error(`Snapshot ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return new Map((r.data.items || []).map((i) => [i.id, i]))
}

/** Puts of the four content/container types with the creation defaults of SPEC-M1 §6.2. */
export const put = {
	sticky: (id, p = {}) => ({ o: 'put', id, t: 'sticky', p: { x: 0, y: 0, w: 200, h: 200, r: 0, z: nextZ(), parent: null, data: { text: '' }, style: { fill: '#ffd6a5' }, ...p } }),
	frame: (id, p = {}) => ({ o: 'put', id, t: 'frame', p: { x: 0, y: 0, w: 800, h: 600, r: 0, z: nextZ(), parent: null, data: { title: '' }, style: { fill: '#ffffff' }, ...p } }),
	shape: (id, p = {}) => ({ o: 'put', id, t: 'shape', p: { x: 0, y: 0, w: 200, h: 120, r: 0, z: nextZ(), parent: null, data: { kind: 'rect', text: '' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 }, ...p } }),
	text: (id, p = {}) => ({ o: 'put', id, t: 'text', p: { x: 0, y: 0, w: 240, h: 31, r: 0, z: nextZ(), parent: null, data: { text: '' }, style: { fontSize: 24, color: '#1a1a1a', align: 'left' }, ...p } }),
	/** Connector (placement none, §4.7 rule 12) from `start` to `end` (Endpoint forms of §3.10); p.data/p.style are merged in. */
	connector: (id, start, end, p = {}) => ({
		o: 'put',
		id,
		t: 'connector',
		p: {
			x: 0, y: 0, w: 0, h: 0, r: 0, z: p.z ?? nextZ(), parent: null,
			data: { route: 'straight', ...(p.data || {}), start, end },
			style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow', ...(p.style || {}) },
		},
	}),
}

/** The fokusable canvas host (SPEC-M1 §6.8 .knorke-canvas[tabindex="0"]). */
export const CANVAS = '.knorke-canvas'

/** Is the canvas host the focused element? */
export async function canvasFocused(page) {
	return page.evaluate((sel) => {
		const a = document.activeElement
		return !!(a && a.matches && a.matches(sel))
	}, CANVAS).catch(() => false)
}

/** aria-pressed of a tool button [data-knorke-tool=<name>] ('true' | 'false' | null). */
export async function toolPressed(page, name) {
	return page.locator(`[data-knorke-tool=${name}]`).first().getAttribute('aria-pressed', { timeout: 2000 }).catch(() => null)
}

/**
 * World point at the given fractions of the visible canvas (0..1), so a
 * scenario draws inside the viewport whatever the start camera is. Uses
 * worldToScreen at two points (the camera is a scale plus an offset).
 */
export async function worldAt(page, fx, fy) {
	const box = await page.locator(CANVAS).first().boundingBox()
	if (!box) throw new Error('Leinwand (.knorke-canvas) nicht gefunden')
	const a = await K.w2s(page, 0, 0)
	const b = await K.w2s(page, 1000, 1000)
	const s = (b.x - a.x) / 1000
	return { x: (box.x + box.width * fx - a.x) / s, y: (box.y + box.height * fy - a.y) / s, scale: s }
}

/** Presses the mouse at `from`, moves to `to` in steps (one frame each), releases. Points in client coordinates. */
export async function dragPath(page, from, to, { steps = 12, mods = [] } = {}) {
	for (const m of mods) await page.keyboard.down(m)
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
		await sleep(16)
	}
	await page.mouse.up()
	for (const m of mods.slice().reverse()) await page.keyboard.up(m)
}

/** One handle of __knorke.handles() by name ({name, x, y} in client coordinates), or null. */
export async function handleOf(page, name) {
	const hs = await K.handles(page)
	return Array.isArray(hs) ? hs.find((h) => h.name === name) || null : null
}

/*
 * Handle names of __knorke.handles() (SPEC-M1 §6.7, frozen since R11):
 * transformer TRANSFORM_HANDLES, end handles END_HANDLES ('start', 'end'),
 * "+" handles PLUS_HANDLES ('plus-t', 'plus-r', 'plus-b', 'plus-l'). The
 * scenarios pick end and "+" handles by name (pickHandle); the pick by
 * position (nearestHandle among extraHandles) stays as the fallback when a
 * name is missing. Pure helpers, defined in lib/geom.mjs.
 */
export { TRANSFORM_HANDLES, END_HANDLES, PLUS_HANDLES, handleNames, extraHandles, nearestHandle, pickHandle } from './geom.mjs'

/**
 * Is the world point `pt` on the border of the box {x, y, w, h} (unrotated),
 * within `tol` world units? Connector ends attach to the side of their target
 * (auto ends at a side midpoint, SPEC-M1 §6.2).
 */
export function onBorder(pt, box, tol = 2) {
	if (!pt || !box) return false
	const { x, y, w, h } = box
	const inside = pt.x >= x - tol && pt.x <= x + w + tol && pt.y >= y - tol && pt.y <= y + h + tol
	const edge = Math.abs(pt.x - x) <= tol || Math.abs(pt.x - (x + w)) <= tol || Math.abs(pt.y - y) <= tol || Math.abs(pt.y - (y + h)) <= tol
	return inside && edge
}

/** Two points within `tol` (per coordinate). */
export const nearPt = (a, b, tol = 2) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol

/**
 * Clicks the context-bar style button [data-knorke-style=<path>][data-knorke-value=<value>]
 * (SPEC-M1 §6.8). Buttons inside a closed panel of the context bar are reached
 * by opening the sections ([data-knorke-section]) one after the other.
 * @return {Promise<boolean>} false when no such button exists
 */
export async function styleButton(page, path, value) {
	const sel = `[data-knorke-style="${path}"][data-knorke-value="${value}"]`
	const visible = () => page.locator(sel + ':visible').first()
	if (await visible().isVisible().catch(() => false)) {
		await visible().click()
		return true
	}
	const sections = page.locator('.knorke-contextbar [data-knorke-section]')
	const n = await sections.count().catch(() => 0)
	for (let i = 0; i < n; i++) {
		const s = sections.nth(i)
		if (!(await s.isVisible().catch(() => false))) continue
		await s.click()
		if (await visible().waitFor({ state: 'visible', timeout: 800 }).then(() => true, () => false)) {
			await visible().click()
			return true
		}
		// close the section again (toggle) before trying the next one
		if ((await s.getAttribute('aria-expanded').catch(() => null)) === 'true') await s.click().catch(() => {})
	}
	return false
}

/**
 * Closes every open panel of the context bar (its section toggle with
 * aria-expanded="true"), as a user does before going back to the canvas: an
 * open panel lies over the canvas and takes the clicks there.
 * @return {Promise<number>} panels closed
 */
export async function closeContextPanels(page) {
	let n = 0
	for (let i = 0; i < 6; i++) {
		const open = page.locator('.knorke-contextbar [data-knorke-section][aria-expanded="true"]').first()
		if (!(await open.isVisible().catch(() => false))) break
		await open.click().catch(() => {})
		n++
	}
	return n
}

/** Records every toast of a context in window.__kdToasts (init script, before the app; E18 pattern). */
export async function recordToasts(ctx) {
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

/** Toasts recorded by recordToasts(). */
export const toastsOf = (p) => p.evaluate(() => window.__kdToasts || []).catch(() => [])
