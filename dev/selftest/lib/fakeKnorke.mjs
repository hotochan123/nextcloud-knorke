/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A fake Knorke server for the load generator's self-test (SPEC-M1 §9.5
 * row 4.1: "Generator gegen Fake-Server"): node:http on 127.0.0.1 with a
 * kernel-chosen port, enough protocol 2 (SPEC-M1 §4.3–§4.6, §4.12) for one
 * load run without a stack:
 *
 *   GET  /index.php/csrftoken                 Basic auth (any uid, env password) → session cookie + token
 *   POST …/api/v1/boards                      create (201 {board})
 *   PUT  …/api/v1/boards/{id}/shares          accepted as sent
 *   POST …/api/v1/boards/{id}/link|votelink   {link: {token, role}}
 *   GET  …/api/v1/boards/{id}/snapshot        snapshot (proto 2, epoch, now, board.meta, me, votes, items)
 *   POST …/pub/v1/{token}/join                guest join (snapshot form + guest token)
 *   GET  …/pub/v1/boards/{id}/snapshot
 *   POST …/api|pub/v1/boards/{id}/sync        ops put/patch/remove/vote, acks {seq, rev, res},
 *                                             items/removed since, presence (§5.5 rules), votes, board meta
 *   POST|PATCH …/vote, PUT …/timer, POST|DELETE …/summon   moderation answers {board, now}
 *
 * Fault knobs for the test: busyEvery (every n-th sync with ops answers
 * `busy` with retryMs, nothing applied), slowDownJoins (the first n guest
 * joins answer 429 slow_down with retryMs), the change log (`log()`) for K2
 * and K3. It checks what the real server checks where the generator could
 * get it wrong (proto, ep, seq echo, ops ≤ 200, X-Requested-With on guest
 * routes, the session's requesttoken) and answers 400 otherwise; like
 * OpValidator it answers `bad` to a patch with an incomplete placement group
 * {x, y, parent} (SPEC-M0 §4.7 rule 2a – the generator's drag commit once
 * lacked `parent`, W3E-01 of stage 4 phase 2).
 *
 * Session knobs (fix round p2d, G2): killSessions(pred) ends sessions on the
 * server (their cookie answers 401 like Nextcloud's "Current user is not
 * logged in"), outage(ms) answers 401 to every session request and 503 to
 * every login for ms while the sessions survive (Redis down, probe P1),
 * blockLogin(uid) refuses that uid's logins, rotateTokens(pred) changes the
 * request token (412 until the client fetches a new one). Every cookie's
 * requests are logged: hitsAfterFirst401() shows whether a client sent
 * anything more with a session after its first 401, sessionLog() which
 * session made /sync and snapshot requests.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'

const APP = '/index.php/apps/knorke'
const EPOCH = 'fakeep1'
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hex = (n) => randomBytes(n).toString('hex')
const tok = () => randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, 'a').slice(0, 24).padEnd(24, 'b')

/** Placement group (SPEC-M0 §4.7 rule 2a, lib/Service/OpValidator.php PLACEMENT): a patch writes x, y, parent all three or none. */
const PLACEMENT = ['x', 'y', 'parent']
export function placementOk(p) {
	const n = PLACEMENT.filter((k) => Object.prototype.hasOwnProperty.call(p, k)).length
	return n === 0 || n === PLACEMENT.length
}

/** Like OpValidator.cleanPatch: a patch payload is a non-empty object with a complete or absent placement group. */
export function patchOk(p) {
	return isObj(p) && Object.keys(p).length > 0 && placementOk(p)
}

function setPath(item, path, v) {
	const keys = path.split('.')
	if (keys.length === 1) { item[keys[0]] = v; return }
	let node = item
	for (const k of keys.slice(0, -1)) { if (!isObj(node[k])) node[k] = {}; node = node[k] }
	if (v === null) delete node[keys[keys.length - 1]]
	else node[keys[keys.length - 1]] = v
}

export async function startFakeKnorke({ userPass = 'pw', busyEvery = 0, slowDownJoins = 0 } = {}) {
	const sessions = new Map() // cookie → {uid, token}
	const guests = new Map() // guest token → {gid, boardId, role, name}
	const boards = new Map()
	const links = new Map() // token → {boardId, role}
	const stats = { requests: 0, byRoute: {}, busy: 0, slowDown: 0, syncWithOps: 0, badRequests: [] }
	let nextBoard = 1
	let joinsSeen = 0
	// G2 (p2d): session knobs and the per-cookie request log
	let outageUntil = 0
	const blocked = new Set()
	const cookieLog = new Map() // cookie → {uid, hits: [t], first401: t|null}

	const board = (id) => boards.get(Number(id))
	const now = () => Date.now()
	const pidOf = (who) => (who.guest ? `g${who.gid}` : `u-${who.uid}`).padEnd(16, '0').slice(0, 16)

	function snapshotOf(b, who) {
		const items = [...b.items.values()].filter((x) => !x.deleted).map((x) => x.item)
		const role = who.guest ? who.role : (who.uid === b.owner ? 'owner' : 'edit')
		const out = {
			proto: 2, epoch: EPOCH, now: now(), rev: b.rev, minRev: 0, schema: 1,
			board: { id: b.id, title: b.title, role, metaRev: b.metaRev, meta: b.meta },
			me: { pid: pidOf(who), name: who.guest ? who.name : who.uid, role, guest: !!who.guest, mod: role === 'owner', source: who.guest ? 'guest' : (role === 'owner' ? 'own' : 'share') },
			items,
		}
		if (b.meta.vote?.state === 'open' && role !== 'view') out.votes = { sid: b.meta.vote.sid, ...mineOf(b, pidOf(who)) }
		return out
	}

	function mineOf(b, pid) {
		const rows = b.votes.rows.get(pid) || new Map()
		const mine = Object.fromEntries([...rows].filter(([id]) => !b.items.get(id)?.deleted))
		const sum = Object.values(mine).reduce((a, n) => a + n, 0)
		return { mine, left: Math.max(0, b.meta.vote.cfg.per - sum) }
	}

	function bumpMeta(b, mutate) { mutate(b.meta); b.metaRev = ++b.rev }

	function applyOps(b, who, ops) {
		const res = []
		let wrote = false
		const rev = b.rev + 1
		for (const op of ops) {
			if (op.o === 'vote') { res.push(null); continue }
			const cur = b.items.get(op.id)
			if (op.o === 'put') {
				if (cur && !cur.deleted) { res.push('ok'); continue }
				const item = { id: op.id, t: op.t, ...op.p }
				b.items.set(op.id, { item, deleted: false, rev })
				b.log.push({ rev, item_id: op.id, op: 'put', patch: JSON.stringify({ t: op.t, ...op.p }) })
				res.push('ok'); wrote = true
			} else if (op.o === 'patch') {
				// validation before the item (OpValidator): the placement group {x, y, parent} all or none (SPEC-M0 §4.7 rule 2a)
				if (!patchOk(op.p)) { res.push('bad'); continue }
				// parent: null or an existing frame of the board (SyncService.resolveParent), else `bad`
				if (op.p.parent !== undefined && op.p.parent !== null) {
					const pr = typeof op.p.parent === 'string' ? b.items.get(op.p.parent) : null
					if (!pr || pr.deleted || pr.item.t !== 'frame') { res.push('bad'); continue }
				}
				if (!cur || cur.deleted) { res.push('gone'); continue }
				for (const [p, v] of Object.entries(op.p)) setPath(cur.item, p, v)
				cur.rev = rev
				b.log.push({ rev, item_id: op.id, op: 'patch', patch: JSON.stringify(op.p) })
				res.push('ok'); wrote = true
			} else if (op.o === 'remove') {
				if (!cur || cur.deleted) { res.push('gone'); continue }
				cur.deleted = true; cur.rev = rev
				b.log.push({ rev, item_id: op.id, op: 'remove', patch: null })
				res.push('ok'); wrote = true
			} else res.push('bad')
		}
		if (wrote) b.rev = rev
		return { res, rev: b.rev }
	}

	function applyVotes(b, who, ops, res) {
		let touched = false
		const pid = pidOf(who)
		ops.forEach((op, i) => {
			if (op.o !== 'vote') return
			touched = true
			const v = b.meta.vote
			if (!v || v.state !== 'open' || v.sid !== op.s) { res[i] = 'closed'; return }
			const it = b.items.get(op.id)
			if (!it || it.deleted) { res[i] = 'gone'; return }
			if (!v.cfg.types.includes(it.item.t)) { res[i] = 'bad'; return }
			const rows = b.votes.rows.get(pid) || new Map()
			const cur = rows.get(op.id) || 0
			const sum = [...rows.values()].reduce((a, n) => a + n, 0) - cur + op.n
			if (op.n > cur && (op.n > v.cfg.perItem || sum > v.cfg.per)) { res[i] = 'limit'; return }
			if (op.n === 0) rows.delete(op.id); else rows.set(op.id, op.n)
			b.votes.rows.set(pid, rows)
			b.votes.seq++
			res[i] = 'ok'
		})
		return touched
	}

	function sync(b, who, body) {
		if (body.proto !== 2) return [409, { error: 'protocol', proto: 2 }]
		if (typeof body.ep !== 'string') return [400, { error: 'bad_request' }]
		const out = { rev: b.rev, now: now() }
		const pid = pidOf(who)
		if (isObj(body.me)) {
			const role = who.guest ? who.role : 'edit'
			const e = { n: who.guest ? who.name : who.uid, k: pid, g: who.guest ? 1 : 0, x: body.me.c?.[0] ?? null, y: body.me.c?.[1] ?? null, s: [], d: [], e: null, h: 0, v: Array.isArray(body.me.v) ? body.me.v : null, t: now() }
			if (role === 'edit') { e.s = body.me.s || []; e.d = body.me.d || []; e.e = body.me.e ?? null }
			b.presence.set(`${pid}:${body.client}`, e)
		}
		if (Array.isArray(body.ops) && body.ops.length) {
			if (body.ops.length > 200 || !Number.isInteger(body.seq)) return [400, { error: 'bad_request' }]
			stats.syncWithOps++
			if (busyEvery && stats.syncWithOps % busyEvery === 0) {
				stats.busy++
				out.acks = { seq: body.seq, rev: null, res: body.ops.map(() => 'busy'), retryMs: 60 }
			} else {
				const { res, rev } = applyOps(b, who, body.ops)
				const voted = applyVotes(b, who, body.ops, res)
				out.acks = { seq: body.seq, rev, res }
				if (voted && b.meta.vote) out.votes = { sid: b.meta.vote.sid, ...mineOf(b, pid) }
			}
			out.rev = b.rev
		}
		if (Number.isInteger(body.vt) && b.meta.vote?.state === 'open' && body.vt !== b.votes.seq && b.owner === who.uid) {
			out.votes = { ...(out.votes || { sid: b.meta.vote.sid }), voters: b.votes.rows.size, vt: b.votes.seq }
		}
		const since = Number(body.since) || 0
		if (b.rev > since) {
			const changed = [...b.items.values()].filter((x) => x.rev > since)
			const live = changed.filter((x) => !x.deleted).map((x) => x.item)
			const removed = changed.filter((x) => x.deleted).map((x) => x.item.id)
			if (live.length) out.items = live
			if (removed.length) out.removed = removed
			if (since < b.metaRev) out.board = { title: b.title, meta: b.meta, metaRev: b.metaRev }
		}
		if (body.pres === 1) {
			const t = now()
			out.presence = Object.fromEntries([...b.presence].filter(([k, e]) => k !== `${pid}:${body.client}` && t - e.t < 10000).map(([k, e]) => { const { t: _t, ...pub } = e; return [k, pub] }))
		}
		return [200, out]
	}

	function moderation(b, method, sub, body, who) {
		if (b.owner !== who.uid) return [403, { error: 'forbidden' }]
		if (sub === 'vote' && method === 'POST') {
			if (b.meta.vote?.state === 'open') return [409, { error: 'vote_open' }]
			const sid = (b.meta.vote?.sid ?? 0) + 1
			b.votes = { rows: new Map(), seq: 0 }
			bumpMeta(b, (m) => { m.vote = { sid, state: 'open', cfg: { per: body.per, perItem: body.perItem, scope: body.scope, types: body.types }, startedAt: now(), endsAt: null, by: who.uid, show: false } })
		} else if (sub === 'vote' && method === 'PATCH') {
			if (body.action !== 'end' || b.meta.vote?.state !== 'open') return [409, { error: 'vote_closed' }]
			const tally = new Map()
			for (const rows of b.votes.rows.values()) for (const [id, n] of rows) if (!b.items.get(id)?.deleted) tally.set(id, (tally.get(id) || 0) + n)
			const results = [...tally].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
			bumpMeta(b, (m) => { m.vote = { ...m.vote, state: 'closed', results, total: results.length, voters: b.votes.rows.size, closedAt: now() } })
		} else if (sub === 'timer' && method === 'PUT') {
			if (body.action === 'start') bumpMeta(b, (m) => { m.timer = { state: 'running', dur: body.ms, end: now() + body.ms, left: null, by: who.uid, seq: (m.timer?.seq ?? 0) + 1 } })
			else if (body.action === 'stop') bumpMeta(b, (m) => { delete m.timer })
			else return [409, { error: 'timer_state' }]
		} else if (sub === 'summon' && method === 'POST') {
			bumpMeta(b, (m) => { m.summon = { pid: pidOf(who), client: body.client, name: who.uid, seq: (m.summon?.seq ?? 0) + 1, at: now() } })
		} else if (sub === 'summon' && method === 'DELETE') {
			if (b.meta.summon) bumpMeta(b, (m) => { delete m.summon })
		} else return [404, { error: 'not_found' }]
		return [200, { board: { title: b.title, meta: b.meta, metaRev: b.metaRev }, now: now() }]
	}

	function route(req, body) {
		const url = new URL(req.url, 'http://x')
		const p = url.pathname
		const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('fake_session='))?.slice(13)
		const session = cookie ? sessions.get(cookie) : null
		if (cookie) {
			const e = cookieLog.get(cookie) || { uid: session?.uid ?? null, created: null, hits: [], first401: null, syncs: 0, snapshots: 0 }
			e.hits.push(now())
			if (/\/api\/v1\/boards\/\d+\/sync$/.test(p)) e.syncs++
			if (/\/api\/v1\/boards\/\d+\/snapshot$/.test(p)) e.snapshots++
			cookieLog.set(cookie, e)
		}
		const nolog = [401, { message: 'Current user is not logged in' }]
		if (now() < outageUntil) {
			// Redis down (probe P1): logins fail, every session request answers 401, the sessions survive
			if (p === '/index.php/csrftoken' && req.headers.authorization) return [503, { error: 'outage' }]
			if (session && (p === '/index.php/csrftoken' || p.startsWith(`${APP}/api/v1/`))) return nolog
		}
		if (p === '/index.php/csrftoken' && req.method === 'GET') {
			const auth = req.headers.authorization
			if (auth) {
				const [uid, pass] = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':')
				if (pass !== userPass || !/^[a-z][a-z0-9]{1,15}$/.test(uid) || blocked.has(uid)) return [401, { error: 'login' }]
				const c = hex(8)
				const s = { uid, token: hex(16) }
				sessions.set(c, s)
				cookieLog.set(c, { uid, created: now(), hits: [], first401: null, syncs: 0, snapshots: 0 })
				return [200, { token: s.token }, { 'Set-Cookie': `fake_session=${c}; path=/` }]
			}
			return session ? [200, { token: session.token }] : [401, { error: 'login' }]
		}
		let m
		if ((m = /^\/index\.php\/apps\/knorke\/pub\/v1\/([A-Za-z0-9]{24})\/join$/.exec(p)) && req.method === 'POST') {
			if (req.headers['x-requested-with'] !== 'XMLHttpRequest') return [400, { error: 'bad_request' }]
			const l = links.get(m[1])
			if (!l) return [404, { error: 'not_found' }]
			if (joinsSeen++ < slowDownJoins) { stats.slowDown++; return [429, { error: 'slow_down', retryMs: 50 }, { 'Retry-After': '1' }] }
			const g = { guest: true, gid: hex(8), boardId: l.boardId, role: l.role, name: String(body?.name || 'Gast').slice(0, 60) }
			const t = hex(20)
			guests.set(t, g)
			return [200, { ...snapshotOf(board(l.boardId), g), guest: { token: t, exp: now() + 86400000 } }]
		}
		if ((m = /^\/index\.php\/apps\/knorke\/pub\/v1\/boards\/(\d+)\/(snapshot|sync)$/.exec(p))) {
			const g = guests.get(req.headers['x-knorke-guest'])
			if (!g || g.boardId !== Number(m[1]) || req.headers['x-requested-with'] !== 'XMLHttpRequest') return [401, { error: 'guest_token' }]
			const b = board(m[1])
			return m[2] === 'snapshot' ? [200, snapshotOf(b, g)] : sync(b, g, body)
		}
		if (!p.startsWith(`${APP}/api/v1/`)) return [404, { error: 'not_found' }]
		if (!session) return nolog
		if (req.method !== 'GET' && req.headers.requesttoken !== session.token) return [412, { error: 'csrf' }]
		const who = { uid: session.uid }
		if (p === `${APP}/api/v1/boards` && req.method === 'POST') {
			const id = nextBoard++
			boards.set(id, { id, title: body.title, owner: session.uid, rev: 0, metaRev: 0, meta: {}, items: new Map(), log: [], presence: new Map(), votes: { rows: new Map(), seq: 0 } })
			return [201, { board: { id, title: body.title } }]
		}
		if (!(m = /^\/index\.php\/apps\/knorke\/api\/v1\/boards\/(\d+)\/([a-z]+)$/.exec(p))) return [404, { error: 'not_found' }]
		const b = board(m[1])
		if (!b) return [404, { error: 'not_found' }]
		const sub = m[2]
		if (sub === 'snapshot' && req.method === 'GET') return [200, snapshotOf(b, who)]
		if (sub === 'sync' && req.method === 'POST') return sync(b, who, body)
		if (sub === 'shares' && req.method === 'PUT') { b.shares = body.shares; return [200, { shares: body.shares }] }
		if ((sub === 'link' || sub === 'votelink') && req.method === 'POST') {
			const role = sub === 'link' ? 'edit' : 'vote'
			const t = tok()
			links.set(t, { boardId: b.id, role })
			return [200, { link: { token: t, role, url: `http://x/p/${t}`, password: false, expiresAt: null, expiresOn: null } }]
		}
		if (['vote', 'timer', 'summon'].includes(sub)) return moderation(b, req.method, sub, body || {}, who)
		return [404, { error: 'not_found' }]
	}

	const server = http.createServer((req, res) => {
		const chunks = []
		req.on('data', (c) => chunks.push(c))
		req.on('end', () => {
			stats.requests++
			let body = null
			if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = undefined } }
			let out
			try { out = body === undefined ? [400, { error: 'bad_request' }] : route(req, body) } catch (e) { out = [500, { error: String(e) }] }
			const [status, data, headers = {}] = out
			const ck = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('fake_session='))?.slice(13)
			if (status === 401 && ck && cookieLog.has(ck) && cookieLog.get(ck).first401 === null) cookieLog.get(ck).first401 = now()
			const key = `${req.method} ${req.url.replace(/\d+|[A-Za-z0-9]{24}/g, ':')}`
			stats.byRoute[key] = (stats.byRoute[key] || 0) + 1
			if (status === 400 && stats.badRequests.length < 20) stats.badRequests.push({ url: req.url, body })
			const text = JSON.stringify(data)
			res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers })
			res.end(text)
		})
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	return {
		port: server.address().port,
		stats,
		/** Change log of a board in the shape of Stack.changesJson().rows. */
		log: (id) => board(id)?.log.slice() ?? [],
		board,
		/** Ends the sessions pred({uid, token}) selects; returns how many. */
		killSessions: (pred) => { let n = 0; for (const [c, x] of sessions) if (pred(x)) { sessions.delete(c); n++ } return n },
		/** For ms: logins 503, every session request 401; the sessions survive. */
		outage: (ms) => { outageUntil = now() + ms },
		blockLogin: (uid) => { blocked.add(uid) },
		rotateTokens: (pred) => { let n = 0; for (const x of sessions.values()) if (pred(x)) { x.token = hex(16); n++ } return n },
		/** Per cookie that ever got a 401: its uid and the requests that came with it AFTER that first 401 (must be 0). */
		/** Every login session: uid, creation time, its /sync and snapshot requests (G4: the check's own session never syncs). */
		sessionLog: () => [...cookieLog.values()].filter((e) => e.created !== null).map(({ uid, created, syncs, snapshots }) => ({ uid, created, syncs, snapshots })),
		hitsAfterFirst401: () => [...cookieLog.values()].filter((e) => e.first401 !== null).map((e) => ({ uid: e.uid, after: e.hits.filter((t) => t > e.first401).length })),
		close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
	}
}
