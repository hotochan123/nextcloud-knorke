/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * M1 stage 4 (SPEC-M1 §8.4, Revision 19): write budget in the client, purge
 * during a session, context menu.
 *
 * E34 write budget in the client: alice's context answers every /sync WITH
 *   ops for 3 s with busy acks (ctx.route: the request goes to the server
 *   without ops and seq, the real answer gets acks {seq, rev: null, res: all
 *   busy, retryMs}), while alice creates two notes and edits a third. The
 *   batch stays in flight and comes back with the same seq; no op is lost,
 *   the status never goes offline (no [data-knorke-banner=offline]), and
 *   afterwards alice, bob and the server agree.
 * E35 purge during a session (R19, T4-07): alice has an open, typed editor on
 *   A; ctx.route holds her next /sync (at most 8 s, below SYNC_TIMEOUT_MS);
 *   bob creates note D over the API and deletes it; the bridge runs
 *   purge-tombstones <b> 0 (answer minRev > alice's since); then the request
 *   goes on. Exactly one resync: counters().resyncs and snapshotRequests each
 *   + 1; the editor stays open with the text; after closing it the text is
 *   at bob, D is missing in the snapshot.
 * E37 context menu (R19, T4-02/T4-03/T4-04; owner [D]): alice, own board,
 *   1280 × 800, notes A, B, C (C at the canvas centre); only real input
 *   (page.mouse.click(…, {button: 'right'}), Shift+F10, the ContextMenu key;
 *   a dispatched contextmenu opens nothing, §6.3). Steps (1)–(8) of §8.4:
 *   right click on A without a selection; A + B, duplicate, Ctrl+Z; empty
 *   area → note-here (paste-here missing: the dev stacks are plain http, no
 *   secure context, §6.5.3 R19); keyboard (Shift+F10, ContextMenu) at the
 *   selection; in and next to an open editor; near the lower right corner;
 *   bob following alice; mode vote. Step (4) also runs in WebKit as a report
 *   (notes, never a check). Touch long press and macOS Ctrl+click are
 *   tests/js/scene/contextMenu.test.mjs's ([S]).
 *   Beyond the §8.4 list, (1) and (3) check the aria-label of the menu root
 *   (§6.11) and (1) its place (§6.6 Ort: sibling of .knorke-canvas in
 *   .knorke-board), as frozen in T4-02 (ask of [C], stage 4 phase 1).
 * E38 vote stepper (P7-C, SPEC-M1 §33.1 i/k, P7-08 and P7-10): alice, own
 *   board, 1280 × 800, notes A (canvas centre) and B; a session over route 22
 *   with per 9 and perItem 3, alice in mode vote. (1) a click on A opens the
 *   stepper, a wheel pan changes the camera and closes it within 2 s; (2) B
 *   pushed to the right edge of the board container (.knorke-board, its
 *   screen centre ≤ 20 px from the edge), a click on B: vote-add and
 *   vote-stepper-close lie completely in the viewport and the container, each
 *   ≥ 44 × 44 px; (3) vote-add twice 150 ms apart → votes().mine[B] = 2 after
 *   waitIdle (and in alice's snapshot), no vote-limit toast. Part of the flake
 *   gate --only E34,E35,E37,E38 --repeat 8 (§33.1 l).
 *
 * Every case starts with World.limiterReset() (run.mjs, R19 T4-01). Check
 * labels start with exactly ONE owner (SPEC-M1 §9.6; stage4.test.mjs refuses
 * two): [C] protocol, state, banners, menu component, entries, hooks,
 * "paste here"; [S] the intent contextMenu (hit, selection, at, echo),
 * canvas; [B] a server answer or stored server state; [D] a harness
 * precondition. Waiting polls from Node with until() (Nextcloud's CSP,
 * ENTWICKLUNG trap 9.10).
 */
import { webkit } from 'playwright'
import {
	K, APP, api, waitReady, until, sleep, openBoard, CANVAS, put, ulid, seedOps, serverMap, itemMap, createSticky, centerOf, newActor, settle,
} from '../lib/harness.mjs'
import { bridge } from '../lib/bridge.mjs'

/** E37 (7): a follower's camera is not read before this long after the follow started. */
export const E37_FOLLOW_MIN_MS = 2500
/** Viewport of E37 (§8.4). */
export const E37_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
/** How long E35 holds alice's /sync at most (below SYNC_TIMEOUT_MS = 10 s of src/sync/transport.js). */
export const E35_HOLD_MS = 8000
/** How long E34 answers /sync with ops as busy. */
export const E34_BUSY_MS = 3000
/** retryMs of E34's synthetic busy acks. */
export const E34_RETRY_MS = 700

/** Entries of the menu on objects and on empty canvas (§6.6 ContextMenu.vue, §6.8). */
export const MENU_ON_ITEMS = Object.freeze(['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'edit-text', 'connect', 'zoom-selection'])
export const MENU_ON_EMPTY = Object.freeze(['paste-here', 'note-here', 'select-all', 'fit'])
/** aria-label of the menu root (§6.11: id ≠ null → "Selection actions", null → "Board actions"; the German texts of l10n/de.json too). */
export const MENU_LABELS = Object.freeze({
	items: Object.freeze(['Selection actions', 'Aktionen für die Auswahl']),
	empty: Object.freeze(['Board actions', 'Aktionen auf dem Board']),
})

/** Is the menu where §6.6 puts it: a child of .knorke-board, sibling of .knorke-canvas, never inside the scene container? */
export const menuPlaced = (place) => !!(place && place.parentBoard && place.siblingCanvas && !place.inCanvas)

// ── helpers ──────────────────────────────────────────────────────────────

const MENU = '[data-knorke-menu=context]'
const canvasBox = (page) => page.locator(CANVAS).first().boundingBox()

/** Shares the board with an account (PUT shares as alice, the complete list). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Brings a world point to the canvas centre (wheel pan; the zoom stays). */
async function centerOn(page, wx, wy) {
	for (let i = 0; i < 4; i++) {
		const p = await K.w2s(page, wx, wy)
		const box = await canvasBox(page)
		const dx = p.x - (box.x + box.width / 2)
		const dy = p.y - (box.y + box.height / 2)
		if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return true
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		for (let k = 0; k < 4; k++) {
			await page.mouse.wheel(dx / 4, dy / 4)
			await sleep(30)
		}
		await sleep(300)
	}
	return false
}

/** Is the canvas the topmost element at a client point (no bar, dialog or editor over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/** World point under a container point (inverse of worldToScreen: the camera is a scale plus an offset). */
async function containerToWorld(page, at) {
	const box = await canvasBox(page)
	const a = await K.w2s(page, 0, 0)
	const b = await K.w2s(page, 1000, 1000)
	const s = (b.x - a.x) / 1000
	return { x: (box.x + at[0] - a.x) / s, y: (box.y + at[1] - a.y) / s, scale: s }
}

/**
 * Records every contextmenu that reaches window in the bubbling phase
 * (defaultPrevented as the app left it) and every opening or move of the
 * context menu (MutationObserver: the root added, or its data-knorke-menu-at
 * changed). Read with ctxLog(); a page.evaluate, no init script.
 */
async function watchMenus(page) {
	await page.evaluate((sel) => {
		if (window.__kdCtx) return
		window.__kdCtx = { events: [], menus: [] }
		window.addEventListener('contextmenu', (e) => {
			window.__kdCtx.events.push({ t: Date.now(), dp: e.defaultPrevented, tag: e.target && e.target.tagName ? e.target.tagName : null })
		}, false)
		const note = (el, why) => window.__kdCtx.menus.push({ t: Date.now(), why, at: el.getAttribute('data-knorke-menu-at'), target: el.getAttribute('data-knorke-menu-target') })
		new MutationObserver((muts) => {
			for (const m of muts) {
				if (m.type === 'attributes' && m.target.matches && m.target.matches(sel)) note(m.target, 'at')
				for (const n of m.addedNodes || []) {
					if (n.nodeType !== 1) continue
					if (n.matches && n.matches(sel)) note(n, 'open')
					if (n.querySelectorAll) for (const c of n.querySelectorAll(sel)) note(c, 'open')
				}
			}
		}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-knorke-menu-at'] })
	}, MENU)
}

const ctxLog = (page) => page.evaluate(() => window.__kdCtx || { events: [], menus: [] }).catch(() => ({ events: [], menus: [] }))

/** Clears the records of watchMenus (the next step counts afresh). */
const ctxReset = (page) => page.evaluate(() => { if (window.__kdCtx) { window.__kdCtx.events = []; window.__kdCtx.menus = [] } }).catch(() => {})

/** The open menu: {count, target, at, role, label, place, items, focused, box} (count 0 = none). */
async function menuState(page) {
	return page.evaluate((sel) => {
		const all = [...document.querySelectorAll(sel)]
		if (!all.length) return { count: 0 }
		const m = all[0]
		const a = document.activeElement
		const r = m.getBoundingClientRect()
		return {
			count: all.length,
			target: m.getAttribute('data-knorke-menu-target'),
			at: m.getAttribute('data-knorke-menu-at'),
			role: m.getAttribute('role'),
			label: m.getAttribute('aria-label'),
			place: {
				parentBoard: !!(m.parentElement && m.parentElement.matches('.knorke-board')),
				siblingCanvas: !!(m.parentElement && [...m.parentElement.children].some((c) => c !== m && c.matches('.knorke-canvas'))),
				inCanvas: !!m.closest('.knorke-canvas'),
			},
			items: [...m.querySelectorAll('button[role="menuitem"][data-knorke-menu-item]')].map((b) => b.getAttribute('data-knorke-menu-item')),
			focused: a && a.getAttribute ? a.getAttribute('data-knorke-menu-item') : null,
			box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
			vw: document.documentElement.clientWidth || window.innerWidth,
			vh: document.documentElement.clientHeight || window.innerHeight,
		}
	}, MENU).catch(() => ({ count: 0 }))
}

/** Waits for the menu (count ≥ 1) and lets an echo arrive; returns menuState. */
async function menuOpened(page, timeout = 3000) {
	await until(async () => (await menuState(page)).count > 0, { timeout })
	await sleep(300)
	return menuState(page)
}

/** "x,y" → [x, y] (numbers) or null. */
const parseAt = (s) => (typeof s === 'string' && /^-?\d+,-?\d+$/.test(s) ? s.split(',').map(Number) : null)
const near = (a, b, tol = 1) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol

/** Is the canvas host the focused element? */
const canvasFocused = (page) => page.evaluate((sel) => !!(document.activeElement && document.activeElement.matches && document.activeElement.matches(sel)), CANVAS).catch(() => false)

/**
 * The keyboard anchor of §6.3 (Tastaturweg): centre of the screen box of the
 * selection, its corners clamped into the container; no selection → centre.
 */
async function keyboardAnchor(page, ids) {
	const box = await canvasBox(page)
	if (!ids.length) return [box.width / 2, box.height / 2]
	let l = Infinity
	let t = Infinity
	let r = -Infinity
	let b = -Infinity
	for (const id of ids) {
		const rc = await K.rect(page, id)
		if (!rc) continue
		l = Math.min(l, rc.x - box.x)
		t = Math.min(t, rc.y - box.y)
		r = Math.max(r, rc.x - box.x + rc.w)
		b = Math.max(b, rc.y - box.y + rc.h)
	}
	const cl = (v, max) => Math.min(Math.max(v, 0), max)
	return [(cl(l, box.width) + cl(r, box.width)) / 2, (cl(t, box.height) + cl(b, box.height)) / 2]
}

/** A free canvas point (client px) near the given fractions: canvas topmost and no item rect under it. */
async function freePoint(page, ids, fractions) {
	const box = await canvasBox(page)
	const rects = []
	for (const id of ids) {
		const r = await K.rect(page, id)
		if (r) rects.push(r)
	}
	for (const [fx, fy] of fractions) {
		const x = Math.round(box.x + box.width * fx)
		const y = Math.round(box.y + box.height * fy)
		if (rects.some((r) => x >= r.x - 12 && x <= r.x + r.w + 12 && y >= r.y - 12 && y <= r.y + r.h + 12)) continue
		if (await canvasAt(page, x, y)) return { x, y }
	}
	return null
}

/** Sorted copy (selections compared as sets). */
const sorted = (a) => (Array.isArray(a) ? [...a].sort() : a)

// ── E34 ──────────────────────────────────────────────────────────────────

export const E34 = {
	id: 'E34',
	title: 'Schreibbudget im Client (R19): ctx.route antwortet 3 s lang auf /sync mit Ops mit busy-Acks → derselbe Batch kommt mit derselben seq wieder, keine Op verloren, kein offline, danach Konvergenz alice/bob/Server',
	async run(t, world) {
		const board = await world.board('E2E Schreibbudget')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const E = ulid()
		const res = await seedOps('alice', board, [put.sticky(E, { x: 0, y: 0, data: { text: 'vorher' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz E gesät', res)
		const a = await world.actor('alice-budget', { user: 'alice' })
		await openBoard(a, board)
		const b = await world.actor('bob-budget', { user: 'bob' })
		await openBoard(b, board)
		// the busy window: every /sync WITH ops goes to the server without ops and seq, the answer gets busy acks
		const seen = []
		let busyEnd = 0
		await a.ctx.route('**/sync', async (route) => {
			const req = route.request()
			let body = null
			try { body = JSON.parse(req.postData() || '') } catch { /* not JSON */ }
			const hasOps = !!(body && Array.isArray(body.ops) && body.ops.length)
			if (hasOps && Date.now() < busyEnd) {
				const { ops, seq, ...rest } = body
				let resp = null
				try { resp = await route.fetch({ postData: JSON.stringify(rest) }) } catch { return route.abort().catch(() => {}) }
				let j = null
				try { j = await resp.json() } catch { /* not JSON */ }
				if (resp.status() !== 200 || !j) return route.fulfill({ response: resp })
				j.acks = { seq, rev: null, res: ops.map(() => 'busy'), retryMs: E34_RETRY_MS }
				seen.push({ seq, n: ops.length, busy: true, at: Date.now() })
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) })
			}
			if (hasOps) seen.push({ seq: body.seq, n: body.ops.length, busy: false, at: Date.now() })
			return route.continue()
		})
		// status and offline banner, sampled through the busy window and 3 s after it
		const samples = []
		let sampling = true
		const sampler = (async () => {
			while (sampling) {
				const st = await K.state(a.page).catch(() => null)
				const off = await a.page.locator('[data-knorke-banner=offline]').first().isVisible().catch(() => false)
				samples.push({ status: st?.status ?? null, off })
				await sleep(150)
			}
		})()

		t.step('3 s busy: alice legt zwei Notizen an und ändert E')
		busyEnd = Date.now() + E34_BUSY_MS
		const box = await canvasBox(a.page)
		const w0 = await containerToWorld(a.page, [box.width * 0.6, box.height * 0.4])
		const n1 = await createSticky(a.page, w0.x, w0.y, 'Budget eins')
		const n2 = await createSticky(a.page, w0.x + 260, w0.y, 'Budget zwei')
		const ce = await centerOf(a.page, E)
		await a.page.mouse.dblclick(ce.x, ce.y)
		const ed = a.page.locator('textarea[data-knorke-editor]').first()
		await ed.waitFor({ state: 'visible', timeout: 5000 })
		await a.page.keyboard.press('Control+A')
		await a.page.keyboard.type('nachher', { delay: 5 })
		await a.page.keyboard.press('Escape')
		const left = busyEnd - Date.now()
		if (left > 0) await sleep(left)
		t.step('Ende des busy-Fensters: warten, bis alles bestätigt ist')
		await K.waitIdle(a.page, 15000)
		await sleep(3000)
		sampling = false
		await sampler
		await a.ctx.unroute('**/sync')
		await settle([a.page, b.page])

		const busy = seen.filter((x) => x.busy)
		t.must(busy.length >= 1, '[D] Vorbedingung: mindestens eine Anfrage mit Ops bekam busy-Acks', seen)
		const s0 = busy[0].seq
		const retried = seen.find((x) => !x.busy && x.seq === s0)
		t.check(Number.isInteger(s0) && !!retried, '[C] der busy-Batch kommt nach retryMs mit derselben seq wieder (bleibt in-flight)', { busy: busy.map((x) => x.seq), sent: seen.map((x) => `${x.seq}${x.busy ? '*' : ''}`) })
		t.check(busy.length >= 2, '[C] während des busy-Fensters wiederholt der Client den Batch (mehrere busy-Antworten)', busy.map((x) => x.seq))
		t.check(samples.length > 10 && samples.every((x) => x.status !== 'offline' && !x.off), '[C] kein offline (state().status, [data-knorke-banner=offline]) während und nach busy', samples.filter((x) => x.status !== 'online' || x.off).slice(0, 5))
		const srv = await serverMap('alice', board)
		const texts = { [n1]: 'Budget eins', [n2]: 'Budget zwei', [E]: 'nachher' }
		t.check(Object.entries(texts).every(([id, txt]) => srv.get(id)?.data?.text === txt), '[C] keine Op verloren: beide Notizen und der geänderte Text auf dem Server', Object.fromEntries(Object.keys(texts).map((id) => [id, srv.get(id)?.data?.text ?? null])))
		const am = await itemMap(a.page)
		const bm = await itemMap(b.page)
		const ids = [...srv.keys()].sort()
		const same = (m) => ids.length === m.size && ids.every((id) => JSON.stringify(m.get(id)?.data) === JSON.stringify(srv.get(id)?.data) && m.get(id)?.x === srv.get(id)?.x && m.get(id)?.y === srv.get(id)?.y)
		t.check(same(am), '[C] Konvergenz: alices Modell = Snapshot des Servers', { server: ids.length, alice: am.size })
		t.check(same(bm), '[C] Konvergenz: bobs Modell = Snapshot des Servers', { server: ids.length, bob: bm.size })
		t.note(`busy-Antworten ${busy.length} (seq ${[...new Set(busy.map((x) => x.seq))].join(', ')}), Anfragen mit Ops ${seen.length}, Proben ${samples.length}`)
		await world.drop(a)
		await world.drop(b)
	},
}

// ── E35 ──────────────────────────────────────────────────────────────────

export const E35 = {
	id: 'E35',
	title: 'Bereinigung während einer Sitzung (R19): alice mit offenem, getipptem Editor; ihre nächste /sync-Anfrage angehalten (≤ 8 s); bob legt D an und löscht es; Brücke purge-tombstones <b> 0 (minRev > alices since); weiter → genau ein Resync (resyncs, snapshotRequests je + 1), Editor offen mit Text; danach Text bei bob, D fehlt',
	async run(t, world) {
		const board = await world.board('E2E Bereinigung')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const A = ulid()
		const res = await seedOps('alice', board, [put.sticky(A, { x: 0, y: 0, data: { text: 'A' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz A gesät', res)
		const a = await world.actor('alice-purge', { user: 'alice' })
		await openBoard(a, board)
		const typed = 'Getippt in E35'

		t.step('alice öffnet den Editor auf A und tippt')
		const ca = await centerOf(a.page, A)
		await a.page.mouse.dblclick(ca.x, ca.y)
		const ed = a.page.locator('textarea[data-knorke-editor]').first()
		await ed.waitFor({ state: 'visible', timeout: 5000 })
		await a.page.keyboard.press('Control+A')
		await a.page.keyboard.type(typed, { delay: 5 })
		await K.waitIdle(a.page, 10000).catch(() => {})

		t.step('alices nächste /sync-Anfrage wird angehalten')
		let held = null
		let release = null
		const gate = new Promise((r) => { release = r })
		let gotHeld = null
		const heldNow = new Promise((r) => { gotHeld = r })
		await a.ctx.route('**/sync', async (route) => {
			if (held === null) {
				let body = null
				try { body = JSON.parse(route.request().postData() || '') } catch { /* not JSON */ }
				held = { at: Date.now(), since: body?.since ?? null, ops: body?.ops?.length ?? 0 }
				gotHeld()
				await Promise.race([gate, sleep(E35_HOLD_MS)])
				held.released = Date.now()
			}
			return route.continue().catch(() => {})
		})
		const ok = await Promise.race([heldNow.then(() => true), sleep(5000).then(() => false)])
		t.must(ok && Number.isInteger(held?.since), '[D] Vorbedingung: alices nächste /sync-Anfrage angehalten (mit since)', held)
		const c0 = await K.counters(a.page)

		t.step('bob legt D an und löscht es (API), Brücke purge-tombstones <b> 0')
		const D = ulid()
		const r1 = await seedOps('bob', board, [put.sticky(D, { x: 400, y: 0, data: { text: 'D' } })])
		const r2 = await seedOps('bob', board, [{ o: 'remove', id: D }])
		t.check(r1[0] === 'ok' && r2[0] === 'ok', '[B] bob: D anlegen und löschen → ok', { r1, r2 })
		let p = null
		try {
			p = await bridge('purge-tombstones', board, 0)
		} catch (e) {
			t.check(false, '[B] Brücke purge-tombstones <b> 0 (occ knorke:compact --board, WP-B4)', String(e.message).slice(0, 300))
		}
		if (p) t.check(p.minRev > held.since && p.tombstones >= 1, '[B] purge-tombstones: Grabstein von D bereinigt, minRev > alices since', { minRev: p.minRev, since: held.since, tombstones: p.tombstones })
		release()
		const heldMs = (held.released ?? Date.now()) - held.at
		t.check(heldMs <= E35_HOLD_MS + 500, `[D] Anfrage höchstens ${E35_HOLD_MS / 1000} s angehalten (unter SYNC_TIMEOUT_MS)`, heldMs)

		t.step('genau ein Resync, Editor bleibt offen')
		await until(async () => {
			const c = await K.counters(a.page)
			return c.resyncs > c0.resyncs && c.snapshotRequests > c0.snapshotRequests
		}, { timeout: 8000 })
		await sleep(2500)
		const c1 = await K.counters(a.page)
		t.check(c1.resyncs === c0.resyncs + 1, '[C] counters().resyncs genau + 1', { c0, c1 })
		t.check(c1.snapshotRequests === c0.snapshotRequests + 1, '[C] counters().snapshotRequests genau + 1', { c0, c1 })
		const open = await ed.isVisible().catch(() => false)
		const val = open ? await ed.inputValue().catch(() => null) : null
		t.check(open && val === typed, '[C] Editor nach dem Resync offen, mit dem getippten Text', { open, val })
		await a.ctx.unroute('**/sync')

		t.step('Editor schließen: Text bei bob, D fehlt im Snapshot')
		await a.page.keyboard.press('Escape')
		await ed.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
		await K.waitIdle(a.page, 10000).catch(() => {})
		const srv = await serverMap('bob', board)
		t.check(srv.get(A)?.data?.text === typed, '[C] nach dem Schließen steht der Text bei bob (Snapshot als bob)', srv.get(A)?.data)
		t.check(!srv.has(D), '[B] D fehlt im Snapshot', [...srv.keys()])
		const am = await itemMap(a.page)
		t.check(!am.has(D) && am.get(A)?.data?.text === typed, '[C] alices Modell: A mit Text, D fehlt', { a: am.get(A)?.data, d: am.has(D) })
		await world.drop(a)
	},
}

// ── E37 ──────────────────────────────────────────────────────────────────

/**
 * Waits until a follower's camera has settled: following glides to the
 * target's viewport on every presence card (glide 300–2000 ms, follow.js),
 * and the first card can come later than a fixed pause. Settled = the item's
 * screen rect unchanged over `stableMs` (reads every 300 ms), and not before
 * `minMs` after the follow started.
 * @return {Promise<{rect: object, waitedMs: number}|null>} null on timeout
 */
async function settledRect(page, id, startedAt, { minMs = E37_FOLLOW_MIN_MS, stableMs = 1200, timeout = 12000 } = {}) {
	const key = (r) => (r ? [r.x, r.y, r.w, r.h].map((v) => Math.round(v)).join(',') : 'null')
	let last = null
	let since = Date.now()
	const end = Date.now() + timeout
	while (Date.now() < end) {
		const r = await K.rect(page, id)
		const k = key(r)
		if (k !== last) { last = k; since = Date.now() }
		if (r && Date.now() - since >= stableMs && Date.now() - startedAt >= minMs) return { rect: r, waitedMs: Date.now() - startedAt }
		await sleep(300)
	}
	return null
}

/** Right click (real input) at a client point. */
async function rightClick(page, pt) {
	await page.mouse.move(pt.x, pt.y)
	await page.mouse.click(pt.x, pt.y, { button: 'right' })
}

/** Closes an open menu with Esc and waits until it is gone. */
async function escMenu(page) {
	await page.keyboard.press('Escape')
	return until(async () => (await menuState(page)).count === 0, { timeout: 2000 })
}

/** Clicks a menu entry. */
async function menuItem(page, name) {
	const b = page.locator(`${MENU} button[role="menuitem"][data-knorke-menu-item="${name}"]`).first()
	await b.click({ timeout: 3000 })
}

/** Step (4) in WebKit as a report: Shift+F10 at the selection opens one menu at A. Notes only. */
async function webkitReport(t, board, A) {
	let browser = null
	try {
		browser = await webkit.launch()
		const w = await newActor(browser, 'alice-webkit-menu', { user: 'alice', viewport: E37_VIEWPORT })
		await openBoard(w, board)
		await watchMenus(w.page)
		const c = await centerOf(w.page, A)
		await w.page.mouse.click(c.x, c.y)
		await w.page.locator(CANVAS).first().focus()
		await w.page.keyboard.press('Shift+F10')
		await sleep(600)
		const m = await menuState(w.page)
		const log = await ctxLog(w.page)
		t.note(`WebKit (Bericht, Schritt 4): Umschalt+F10 → ${m.count} Menü(s), Ziel ${m.target ?? '–'}, at ${m.at ?? '–'}, Öffnungen ${log.menus.length}, contextmenu-Ereignisse ${log.events.length}`)
		await w.page.keyboard.press('Escape').catch(() => {})
		await w.close()
	} catch (e) {
		t.note(`WebKit (Bericht, Schritt 4): nicht gelaufen – ${String(e?.message || e).split('\n')[0].slice(0, 200)}`)
	} finally {
		if (browser) await browser.close().catch(() => {})
	}
}

export const E37 = {
	id: 'E37',
	title: 'Kontextmenü (R19): (1) Rechtsklick auf A ohne Auswahl, ↓/↑, Esc; (2) A + B, duplicate, Strg+Z; (3) leere Fläche → note-here, paste-here fehlt (http); (4) Umschalt+F10 und Kontextmenü-Taste an der Auswahl, kein Echo; (5) im Editor das Menü des Browsers, daneben Commit + Menü; (6) Ecke unten rechts ganz im Viewport; (7) bob folgt alice, Rechtsklick beendet das Folgen; (8) Modus vote: kein Menü; WebKit-Bericht für (4)',
	async run(t, world) {
		const board = await world.board('E2E Kontextmenü')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const [A, B, C] = [ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: -500, y: -300, w: 200, h: 200, data: { text: 'A' } }),
			put.sticky(B, { x: -220, y: -300, w: 200, h: 200, data: { text: 'B' } }),
			put.sticky(C, { x: -100, y: -100, w: 200, h: 200, data: { text: 'C' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notizen A, B, C gesät', res)
		const a = await world.actor('alice-menu', { user: 'alice', viewport: E37_VIEWPORT })
		await openBoard(a, board)
		const p = a.page
		// 100 % and C (centre 0, 0) at the canvas centre
		await p.locator(CANVAS).first().focus()
		await p.keyboard.press('Shift+Digit0')
		await sleep(300)
		t.must(await centerOn(p, 0, 0), '[D] Vorbedingung: C in der Leinwand-Mitte (100 %)')
		await watchMenus(p)
		const box = await canvasBox(p)

		t.step('(1) ohne Auswahl Rechtsklick auf A; ↓, ↑, Esc')
		await p.keyboard.press('Escape')
		const pa = await centerOf(p, A)
		await ctxReset(p)
		await rightClick(p, pa)
		let m = await menuOpened(p)
		const sel1 = await K.selection(p)
		t.check(JSON.stringify(sel1) === JSON.stringify([A]), '[S] (1) selection() = [A] beim Menü (Treffer außerhalb der Auswahl wählt zuerst)', sel1)
		t.check(m.count === 1 && m.role === 'menu' && m.target === A, '[C] (1) genau ein [data-knorke-menu=context] mit role=menu, Ziel A', m)
		t.check(MENU_LABELS.items.includes(m.label), '[C] (1) aria-label der Wurzel = „Selection actions“ (§6.11, id ≠ null)', m.label)
		t.check(menuPlaced(m.place), '[C] (1) Menü als Geschwister von .knorke-canvas in .knorke-board, nicht im Szenen-Container (§6.6 Ort)', m.place)
		t.check(near(parseAt(m.at), [pa.x - box.x, pa.y - box.y]), '[S] (1) data-knorke-menu-at = Klickpunkt − Leinwand-Ecke (±1)', { at: m.at, want: [pa.x - box.x, pa.y - box.y] })
		const want1 = ['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'edit-text', 'zoom-selection']
		t.check(m.items && want1.every((x) => m.items.includes(x)) && !m.items.includes('connect'), '[C] (1) Einträge cut, copy, duplicate, delete, front, back, edit-text, zoom-selection; connect fehlt', m.items)
		t.check(m.items && m.focused === m.items[0], '[C] (1) Fokus auf dem ersten Eintrag', { focused: m.focused, first: m.items?.[0] })
		await p.keyboard.press('ArrowDown')
		const f2 = (await menuState(p)).focused
		await p.keyboard.press('ArrowUp')
		const f3 = (await menuState(p)).focused
		t.check(m.items && f2 === m.items[1] && f3 === m.items[0], '[C] (1) ↓/↑ bewegen den Fokus', { f2, f3 })
		t.check(await escMenu(p), '[C] (1) nach Esc kein Menü')
		t.check(await canvasFocused(p), '[C] (1) nach Esc document.activeElement = .knorke-canvas')
		t.check(JSON.stringify(await K.selection(p)) === JSON.stringify([A]), '[C] (1) Auswahl nach Esc weiter [A] (Esc erreicht die Szene nicht)', await K.selection(p))
		let log = await ctxLog(p)
		t.check(log.events.length >= 1 && log.events.every((e) => e.dp === true), '[S] (1) das contextmenu war defaultPrevented', log.events)

		t.step('(2) A und B auswählen, Rechtsklick auf B, duplicate, Strg+Z')
		await p.mouse.click(pa.x, pa.y)
		const pb = await centerOf(p, B)
		await p.keyboard.down('Shift')
		await p.mouse.click(pb.x, pb.y)
		await p.keyboard.up('Shift')
		const before2 = await itemMap(p)
		await rightClick(p, pb)
		m = await menuOpened(p)
		t.check(JSON.stringify(sorted(await K.selection(p))) === JSON.stringify(sorted([A, B])), '[S] (2) Auswahl bleibt [A, B] (Treffer in der Auswahl)', await K.selection(p))
		t.check(m.count === 1 && m.target === B && m.items?.includes('connect') && !m.items?.includes('edit-text'), '[C] (2) Menü mit Ziel B, connect da, edit-text fehlt', m)
		await menuItem(p, 'duplicate')
		const copies = await until(async () => {
			const now = await itemMap(p)
			const added = [...now.values()].filter((it) => !before2.has(it.id))
			return added.length >= 2 ? added : null
		}, { timeout: 4000 })
		const bA = before2.get(A)
		const bB = before2.get(B)
		const okCopies = Array.isArray(copies) && copies.length === 2
			&& copies.some((it) => it.data?.text === 'A' && it.x === bA.x + 20 && it.y === bA.y + 20)
			&& copies.some((it) => it.data?.text === 'B' && it.x === bB.x + 20 && it.y === bB.y + 20)
		t.check(okCopies, '[C] (2) zwei Kopien, Lage wie Strg/⌘+D (+20/+20)', copies && copies.map((it) => ({ text: it.data?.text, x: it.x, y: it.y })))
		await p.keyboard.press('Control+z')
		const undone = await until(async () => {
			const now = await itemMap(p)
			return [...now.keys()].every((id) => before2.has(id)) && now.size === before2.size
		}, { timeout: 3000 })
		t.check(undone, '[C] (2) Strg+Z entfernt beide Kopien (ein Schritt)', (await itemMap(p)).size)

		t.step('(3) Rechtsklick auf leere Fläche, note-here, tippen, Esc')
		const pt3 = await freePoint(p, [A, B, C], [[0.8, 0.75], [0.75, 0.7], [0.85, 0.6], [0.7, 0.8], [0.6, 0.8]])
		t.must(pt3, '[D] Vorbedingung: freie Stelle der Leinwand gefunden')
		const before3 = await itemMap(p)
		await ctxReset(p)
		await rightClick(p, pt3)
		m = await menuOpened(p)
		t.check(JSON.stringify(await K.selection(p)) === '[]', '[S] (3) Rechtsklick auf leere Fläche leert die Auswahl', await K.selection(p))
		t.check(m.count === 1 && m.target === '', '[C] (3) Menü mit Ziel "" (leere Fläche)', m)
		t.check(MENU_LABELS.empty.includes(m.label), '[C] (3) aria-label der Wurzel = „Board actions“ (§6.11, id null)', m.label)
		t.check(m.items && ['note-here', 'select-all', 'fit'].every((x) => m.items.includes(x)), '[C] (3) note-here, select-all, fit da', m.items)
		t.check(m.items && !m.items.includes('paste-here'), '[C] (3) paste-here fehlt (http-Dev-Stack ohne Secure Context, §6.5.3 R19)', m.items)
		const at3 = parseAt(m.at)
		const W = at3 ? await containerToWorld(p, at3) : null
		await menuItem(p, 'note-here')
		const ed = p.locator('textarea[data-knorke-editor]').first()
		const edOpen = await ed.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)
		t.check(edOpen, '[C] (3) note-here: Editor offen')
		const nid = await until(async () => {
			for (const [k, it] of await itemMap(p)) if (!before3.has(k) && it.t === 'sticky') return k
			return null
		}, { timeout: 4000 })
		const nit = nid ? (await itemMap(p)).get(nid) : null
		t.check(nit && W && Math.abs(W.scale - 1) < 0.01 && Math.abs(nit.x + nit.w / 2 - W.x) <= 1 && Math.abs(nit.y + nit.h / 2 - W.y) <= 1,
			'[C] (3) neue Notiz mit Box-Mitte = screenToWorld(at) (±1 bei 100 %)', { item: nit && { x: nit.x, y: nit.y, w: nit.w, h: nit.h }, W })
		if (edOpen) {
			await p.keyboard.type('Hier', { delay: 5 })
			await p.keyboard.press('Escape')
			await ed.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {})
		}
		await K.waitIdle(p, 8000).catch(() => {})
		const srv3 = nid ? await serverMap('alice', board) : new Map()
		t.check(nid && srv3.get(nid)?.data?.text === 'Hier', '[C] (3) Text gespeichert (Snapshot)', nid && srv3.get(nid)?.data)
		await p.keyboard.press('Control+z')
		const gone3 = await until(async () => !(await itemMap(p)).has(nid), { timeout: 3000 })
		t.check(nid && gone3, '[C] (3) ein Undo-Schritt: Strg+Z entfernt die neue Notiz samt Text')

		t.step('(4) A auswählen, Leinwand fokussieren, Umschalt+F10, Esc, Taste ContextMenu, Esc')
		const pa4 = await centerOf(p, A)
		await p.mouse.click(pa4.x, pa4.y)
		await p.locator(CANVAS).first().focus()
		const anchor = await keyboardAnchor(p, [A])
		for (const key of ['Shift+F10', 'ContextMenu']) {
			await ctxReset(p)
			await p.keyboard.press(key)
			m = await menuOpened(p)
			log = await ctxLog(p)
			t.check(m.count === 1 && log.menus.filter((x) => x.why === 'open').length === 1 && log.menus.filter((x) => x.why === 'at').length === 0,
				`[S] (4) ${key}: genau ein Menü (kein zweites durch das Echo)`, { m, menus: log.menus })
			t.check(m.target === A && near(parseAt(m.at), anchor), `[S] (4) ${key}: Ziel A, data-knorke-menu-at = Anker nach §6.3 (±1)`, { target: m.target, at: m.at, anchor })
			t.check(JSON.stringify(await K.selection(p)) === JSON.stringify([A]), `[S] (4) ${key}: Auswahl [A]`, await K.selection(p))
			t.check(await escMenu(p), `[C] (4) ${key}: Esc schließt`)
		}

		t.step('(5) Doppelklick auf B, tippen; Rechtsklick in den Editor, dann daneben')
		const pb5 = await centerOf(p, B)
		await p.mouse.dblclick(pb5.x, pb5.y)
		await ed.waitFor({ state: 'visible', timeout: 4000 })
		await p.keyboard.press('Control+A')
		await p.keyboard.type('B neu', { delay: 5 })
		const eb = await ed.boundingBox()
		await ctxReset(p)
		await rightClick(p, { x: eb.x + eb.width / 2, y: eb.y + eb.height / 2 })
		await sleep(400)
		m = await menuState(p)
		log = await ctxLog(p)
		t.check(m.count === 0, '[S] (5) im Editor kein Knorke-Menü', m)
		t.check(log.events.length >= 1 && log.events.every((e) => e.dp === false), '[S] (5) contextmenu im Editor: defaultPrevented === false (Menü des Browsers)', log.events)
		const still = await ed.isVisible().catch(() => false)
		t.check(still && (await ed.inputValue().catch(() => null)) === 'B neu', '[S] (5) Editor offen mit dem Text', still)
		const pt5 = await freePoint(p, [A, B, C], [[0.62, 0.3], [0.7, 0.35], [0.8, 0.3], [0.85, 0.45]])
		t.must(pt5, '[D] Vorbedingung: freie Stelle neben dem Editor')
		await ctxReset(p)
		await rightClick(p, pt5)
		m = await menuOpened(p)
		const closed5 = !(await ed.isVisible().catch(() => false))
		t.check(closed5, '[S] (5) Rechtsklick daneben beendet den Editor')
		await K.waitIdle(p, 8000).catch(() => {})
		const srv5 = await serverMap('alice', board)
		t.check(srv5.get(B)?.data?.text === 'B neu', '[S] (5) mit Commit (Text im Snapshot)', srv5.get(B)?.data)
		t.check(m.count === 1, '[C] (5) danach genau ein Menü', m)
		await escMenu(p)

		t.step('(6) Rechtsklick 5 px vor der rechten unteren Ecke der Leinwand')
		let pt6 = null
		for (let d = 5; d <= 80 && !pt6; d += 5) {
			const q = { x: Math.round(box.x + box.width - d), y: Math.round(box.y + box.height - d) }
			if (await canvasAt(p, q.x, q.y)) pt6 = { ...q, d }
		}
		t.must(pt6, '[D] Vorbedingung: Punkt nahe der rechten unteren Ecke auf der Leinwand')
		if (pt6.d !== 5) t.note(`(6) die Ecke liegt unter einer Leiste: Rechtsklick ${pt6.d} px vor der Ecke`)
		await rightClick(p, pt6)
		m = await menuOpened(p)
		t.check(m.count === 1 && m.box.left >= 0 && m.box.top >= 0 && m.box.right <= m.vw && m.box.bottom <= m.vh, '[C] (6) Menü ganz im Viewport', m)
		await escMenu(p)

		t.step('(4) in WebKit als Bericht (vor der Abstimmung in (8))')
		await webkitReport(t, board, A)

		t.step('(7) bob folgt alice über den Teilnehmer-Knopf, Rechtsklick auf C')
		const bob = await world.actor('bob-menu', { user: 'bob' })
		await openBoard(bob, board)
		const alicePid = (await K.state(p)).pid
		const pbtn = bob.page.locator(`[data-knorke-participant="${alicePid}"]`).first()
		t.must(await pbtn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false), '[C] (7) bob: Teilnehmer-Knopf von alice')
		await pbtn.click()
		const followedAt = Date.now()
		t.must(await until(async () => (await K.state(bob.page)).following === alicePid, { timeout: 4000 }), '[C] (7) Vorbedingung: bob folgt alice', await K.state(bob.page))
		// the camera glides on presence cards: wait until C stands still on bob's screen
		const steady = await settledRect(bob.page, C, followedAt)
		t.must(steady, '[C] (7) Vorbedingung: bobs Kamera steht nach dem Folgen still (C ruhig auf dem Schirm)', await K.state(bob.page))
		t.note(`(7) Kamera ruhig nach ${steady.waitedMs} ms`)
		await watchMenus(bob.page)
		const pc = { x: steady.rect.x + steady.rect.w / 2, y: steady.rect.y + steady.rect.h / 2 }
		await rightClick(bob.page, pc)
		const mb = await menuOpened(bob.page)
		t.check((await K.state(bob.page)).following === null, '[C] (7) danach bob state().following === null', await K.state(bob.page))
		t.check(mb.count === 1 && mb.target === C, '[C] (7) bob: ein Menü mit Ziel C', mb)
		await escMenu(bob.page)
		await world.drop(bob)

		t.step('(8) alice startet eine Abstimmung (Route 22), Modus vote, Rechtsklick auf A')
		const vs = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
		t.must(vs.status === 200, '[B] (8) Route 22 → 200', vs.text.slice(0, 200))
		// §6.5.4: preferVote defaults to vote at the start of a session; vote-mode only when alice is not in it yet
		let mode = await until(async () => ((await K.state(p)).uiMode === 'vote' ? 'vote' : null), { timeout: 5000 })
		if (!mode) {
			await p.locator('[data-knorke-action=vote-mode]').first().click().catch(() => {})
			mode = await until(async () => ((await K.state(p)).uiMode === 'vote' ? 'vote' : null), { timeout: 3000 })
			t.note('(8) alice war nach dem Start nicht im Modus vote; vote-mode geklickt')
		}
		t.must(mode === 'vote', '[C] (8) Vorbedingung: alice im Modus vote', await K.state(p))
		const pa8 = await centerOf(p, A)
		await ctxReset(p)
		await rightClick(p, pa8)
		await sleep(500)
		m = await menuState(p)
		log = await ctxLog(p)
		t.check(m.count === 0, '[S] (8) Modus vote: kein Menü', m)
		t.check(log.events.length >= 1 && log.events.every((e) => e.dp === true), '[S] (8) contextmenu defaultPrevented', log.events)
		await world.drop(a)
	},
}

// ── E38 (P7-C) ───────────────────────────────────────────────────────────

/** Viewport of E38 (SPEC-M1 §33.1 k). */
export const E38_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
/** Gap between the two clicks on vote-add in E38 (3), below the 400-ms repeat window of the toggle tap (§6.5.5 R2). */
export const E38_GAP_MS = 150
/** Smallest size of a stepper button (§6.12, §33.1 i: ≥ 44 × 44 px). */
export const E38_MIN_PX = 44

const STEPPER = (id) => `[data-knorke-vote-stepper="${id}"]`

/** Client rect of the first visible match, or null. */
async function visibleBox(page, sel) {
	const loc = page.locator(sel).first()
	if (!(await loc.isVisible().catch(() => false))) return null
	return loc.boundingBox().catch(() => null)
}

/** Is box completely inside the viewport and inside the rect `inner` (client px, ±0.5 for subpixel edges)? */
export function boxInside(box, inner, vp) {
	if (!box || !inner || !vp) return false
	const e = 0.5
	const l = Math.max(0, inner.x)
	const t = Math.max(0, inner.y)
	const r = Math.min(vp.width, inner.x + inner.width)
	const b = Math.min(vp.height, inner.y + inner.height)
	return box.x >= l - e && box.y >= t - e && box.x + box.width <= r + e && box.y + box.height <= b + e
}

/**
 * Records every toast hook ([data-knorke-toast]) that appears on the page
 * (a page.evaluate, no init script); read with toastHooks().
 */
async function watchToasts(page) {
	await page.evaluate(() => {
		if (window.__kdToastHooks) return
		window.__kdToastHooks = []
		const take = (n) => {
			if (n.nodeType !== 1) return
			if (n.matches && n.matches('[data-knorke-toast]')) window.__kdToastHooks.push({ t: Date.now(), hook: n.getAttribute('data-knorke-toast'), text: String(n.textContent || '').trim() })
			if (n.querySelectorAll) for (const c of n.querySelectorAll('[data-knorke-toast]')) take(c)
		}
		new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) take(n) }).observe(document.body, { childList: true, subtree: true })
	})
}
const toastHooks = (page) => page.evaluate(() => window.__kdToastHooks || []).catch(() => [])

/** A point on the item that the canvas takes (inside its screen rect and the canvas, canvas topmost), from its centre leftwards. */
async function itemPoint(page, id) {
	const r = await K.rect(page, id)
	const box = await canvasBox(page)
	if (!r || !box) return null
	const y = Math.round(r.y + r.h / 2)
	for (let f = 0.5; f >= 0.1; f -= 0.1) {
		const x = Math.round(r.x + r.w * f)
		if (x < box.x + 2 || x > box.x + box.width - 2) continue
		if (await canvasAt(page, x, y)) return { x, y }
	}
	return null
}

export const E38 = {
	id: 'E38',
	title: 'Schrittregler (P7-08, P7-10): eigenes Board, 1280 × 800, Notizen A (Mitte) und B; Sitzung über Route 22 mit per 9, perItem 3, Modus vote; (1) Klick auf A → Regler, Mausrad-Schwenk → Kamera geändert, Regler von A binnen 2 s weg; (2) B am rechten Rand des Board-Containers (Mitte ≤ 20 px vom Rand), Klick auf B → Regler von B, vote-add und vote-stepper-close ganz im Viewport und im Board-Container, je ≥ 44 × 44 px; (3) zweimal vote-add im Abstand von 150 ms → nach waitIdle votes().mine[B] = 2 (Server-Stand), kein Toast vote-limit',
	async run(t, world) {
		const board = await world.board('E2E Schrittregler')
		const [A, B] = [ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: -100, y: -100, w: 200, h: 200, data: { text: 'A' } }),
			put.sticky(B, { x: 400, y: -100, w: 200, h: 200, data: { text: 'B' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notizen A und B gesät', res)
		const a = await world.actor('alice-stepper', { user: 'alice', viewport: E38_VIEWPORT })
		await openBoard(a, board)
		const p = a.page
		await watchToasts(p)
		// 100 % and A (centre 0, 0) at the canvas centre
		await p.locator(CANVAS).first().focus()
		await p.keyboard.press('Shift+Digit0')
		await sleep(300)
		t.must(await centerOn(p, 0, 0), '[D] Vorbedingung: A in der Leinwand-Mitte (100 %)')

		t.step('alice startet eine Sitzung (Route 22, per 9, perItem 3) und ist im Modus vote')
		const vs = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 9, perItem: 3, scope: null, types: ['sticky'], minutes: null })
		t.must(vs.status === 200, '[B] Route 22 (per 9, perItem 3) → 200', vs.text.slice(0, 200))
		// §6.5.4: vote is the default at the start of a session; vote-mode only when alice is not in it
		let mode = await until(async () => ((await K.state(p)).uiMode === 'vote' ? 'vote' : null), { timeout: 5000 })
		if (!mode) {
			await p.locator('[data-knorke-action=vote-mode]').first().click().catch(() => {})
			mode = await until(async () => ((await K.state(p)).uiMode === 'vote' ? 'vote' : null), { timeout: 3000 })
			t.note('alice war nach dem Start nicht im Modus vote; vote-mode geklickt')
		}
		t.must(mode === 'vote', '[C] Vorbedingung: alice im Modus vote', await K.state(p))
		t.must(await until(async () => { const v = await K.votes(p); return v && v !== 'missing' && v.sid ? v : null }, { timeout: 5000 }), '[C] Vorbedingung: votes() mit der offenen Sitzung', await K.votes(p))

		t.step('(1) Klick auf A → Regler; Mausrad über der Leinwand (Schwenk)')
		const pa = await itemPoint(p, A)
		t.must(pa, '[D] Vorbedingung: A liegt frei auf der Leinwand')
		await p.mouse.click(pa.x, pa.y)
		t.must(await until(async () => !!(await visibleBox(p, STEPPER(A))), { timeout: 3000 }), '[C] (1) Klick auf A im Modus vote (perItem 3) → [data-knorke-vote-stepper=A] sichtbar')
		const cam0 = await K.camera(p)
		const box = await canvasBox(p)
		// the wheel over free canvas (upper left quarter), away from the stepper
		await p.mouse.move(Math.round(box.x + box.width * 0.2), Math.round(box.y + box.height * 0.25))
		for (let k = 0; k < 4; k++) {
			await p.mouse.wheel(30, 20)
			await sleep(30)
		}
		const cam1 = await until(async () => {
			const c = await K.camera(p)
			return c && cam0 && JSON.stringify(c) !== JSON.stringify(cam0) ? c : null
		}, { timeout: 2000 })
		t.check(!!cam1, '[S] (1) das Mausrad schwenkt die Kamera (camera() geändert)', { cam0, cam1: cam1 || await K.camera(p) })
		const gone = await until(async () => !(await visibleBox(p, STEPPER(A))), { timeout: 2000 })
		t.check(gone, '[C] (1) [data-knorke-vote-stepper=A] ist binnen 2 s nach der Kameraänderung verschwunden')

		t.step('(2) Kamera so, dass B an den rechten Rand des Board-Containers stößt; Klick auf B')
		const container = await visibleBox(p, '.knorke-board')
		t.must(container, '[D] Vorbedingung: Board-Container .knorke-board sichtbar')
		const right = container.x + container.width
		let rb = null
		for (let i = 0; i < 5; i++) {
			rb = await K.rect(p, B)
			if (!rb) break
			const dx = rb.x + rb.w / 2 - (right - 10)
			if (Math.abs(dx) <= 4) break
			await p.mouse.move(Math.round(box.x + box.width * 0.2), Math.round(box.y + box.height * 0.25))
			for (let k = 0; k < 4; k++) {
				await p.mouse.wheel(dx / 4, 0)
				await sleep(30)
			}
			await sleep(300)
		}
		rb = await K.rect(p, B)
		const bc = rb ? rb.x + rb.w / 2 : null
		t.must(rb && bc <= right && right - bc <= 20, '[D] Vorbedingung: Bildschirmmitte von B höchstens 20 px vom rechten Rand des Board-Containers', { centre: bc, right, rect: rb })
		const pb = await itemPoint(p, B)
		t.must(pb, '[D] Vorbedingung: ein Punkt von B liegt frei auf der Leinwand')
		await p.mouse.click(pb.x, pb.y)
		t.check(await until(async () => !!(await visibleBox(p, STEPPER(B))), { timeout: 3000 }), '[C] (2) Klick auf B → [data-knorke-vote-stepper=B] sichtbar')
		const vp = p.viewportSize() || E38_VIEWPORT
		const boardBox = await visibleBox(p, '.knorke-board')
		const add = await visibleBox(p, `${STEPPER(B)} [data-knorke-action=vote-add]`)
		const close = await visibleBox(p, `${STEPPER(B)} [data-knorke-action=vote-stepper-close]`)
		t.check(add && boxInside(add, boardBox, vp) && add.width >= E38_MIN_PX && add.height >= E38_MIN_PX,
			`[C] (2) [data-knorke-action=vote-add] im Regler von B ganz im Viewport und im Board-Container, ≥ ${E38_MIN_PX} × ${E38_MIN_PX} px`, { add, board: boardBox, vp })
		t.check(close && boxInside(close, boardBox, vp) && close.width >= E38_MIN_PX && close.height >= E38_MIN_PX,
			`[C] (2) [data-knorke-action=vote-stepper-close] im Regler von B ganz im Viewport und im Board-Container, ≥ ${E38_MIN_PX} × ${E38_MIN_PX} px`, { close, board: boardBox, vp })

		t.step(`(3) im Regler von B zweimal vote-add, im Abstand von ${E38_GAP_MS} ms`)
		const hooks0 = (await toastHooks(p)).length
		t.must(add, '[C] (3) Vorbedingung: vote-add im Regler von B vorhanden')
		const ax = Math.round(add.x + add.width / 2)
		const ay = Math.round(add.y + add.height / 2)
		await p.mouse.click(ax, ay)
		await sleep(E38_GAP_MS)
		await p.mouse.click(ax, ay)
		await K.waitIdle(p, 10000).catch(() => {})
		await sleep(300)
		const mine = await K.votes(p)
		t.check(mine && mine !== 'missing' && mine.mine?.[B] === 2, '[C] (3) nach waitIdle __knorke.votes().mine[B] = 2 (zwei schnelle Klicks, keine Wiederholungssperre)', mine)
		const sn = await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)
		t.check(sn.status === 200 && sn.data?.votes?.mine?.[B] === 2, '[C] (3) Server-Stand: votes.mine[B] = 2 im Snapshot von alice', sn.data?.votes)
		const hooks = (await toastHooks(p)).slice(hooks0)
		t.check(!hooks.some((h) => h.hook === 'vote-limit') && !(await p.locator('[data-knorke-toast=vote-limit]').first().isVisible().catch(() => false)), '[C] (3) kein Toast vote-limit (9 Stimmen, 3 je Objekt)', hooks)
		await world.drop(a)
	},
}
