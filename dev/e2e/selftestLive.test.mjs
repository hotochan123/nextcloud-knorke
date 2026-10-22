/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Host-side self-test of lib/selftestLive.mjs and of the live part of the
 * bridge self-test (SPEC-M1 §8.4 R17 K6, review finding R-D1), no stack:
 *
 * - liveVote against fake api/bridge/sync: a healthy server gives six
 *   passed checks; route 22 answering anything but 200, a vote op after
 *   vote-expire that does not answer ["closed"] (path (a) of WP-B3), a
 *   snapshot that still shows the session open and a second vote-expire that
 *   still finds an open session are FAILED checks, never notes or skips.
 * - rejoinChecks: the re-join after link-expire must answer 403
 *   link_expired (WP-B2).
 * - livePurge (stage 4, SPEC-M1 §8.4 R19, T4-07) against a fake board with
 *   tombstones and min_rev: a healthy compact gives eleven passed checks; a
 *   bridge error (no occ knorke:compact yet), a compact that leaves min_rev
 *   alone or keeps the note are FAILED checks.
 * - lib/selftest.mjs as text (it reads env.json on import): it calls both,
 *   keeps no note about WP-B2/WP-B3 or route 22 and no "ÜBERSPRUNGEN"
 *   branch in the live part; the only note left is pgss off PostgreSQL.
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveVote, rejoinChecks, livePurge, PURGE_ITEM, COMPACT_KEYS } from './lib/selftestLive.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))

/** A check() like the self-test's: records every outcome. */
function recorder() {
	const out = []
	const check = (cond, label, info) => {
		out.push({ ok: !!cond, label, info })
		return !!cond
	}
	return { out, check, failed: () => out.filter((x) => !x.ok).map((x) => x.label), passed: () => out.filter((x) => x.ok).length }
}

const ITEM = '01KSE1FTEST00000000000000A'

/**
 * A fake server for one live board.
 * @param {object} o
 * @param {number} [o.startStatus] answer of route 22
 * @param {boolean} [o.pathA] the vote op after vote-expire closes the session (WP-B3 path (a))
 * @param {boolean} [o.expireTouchesMeta] vote-expire moves metaRev (a broken bridge)
 */
function fakeServer({ startStatus = 200, pathA = true, expireTouchesMeta = false } = {}) {
	const st = { rev: 7, metaRev: 3, vote: null, endsAt: null, calls: [] }
	const board = () => ({ title: 'bridge selftest live', metaRev: st.metaRev, meta: st.vote ? { vote: { ...st.vote } } : {} })
	const api = async (user, method, p, body) => {
		st.calls.push(`${method} ${p}`)
		if (method === 'POST' && /\/vote$/.test(p)) {
			if (startStatus !== 200) return { status: startStatus, data: { error: 'boom' }, text: '{"error":"boom"}' }
			assert.deepEqual(body, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: 10 })
			st.metaRev = ++st.rev
			st.endsAt = Date.now() + 600000
			st.vote = { sid: 41, state: 'open', endsAt: st.endsAt }
			return { status: 200, data: { board: board(), now: Date.now() }, text: '{}' }
		}
		if (method === 'GET' && /\/snapshot$/.test(p)) return { status: 200, data: { rev: st.rev, board: board() }, text: '{}' }
		throw new Error(`unexpected ${method} ${p}`)
	}
	const bridgeRaw = async (action, id) => {
		st.calls.push(`bridge ${action} ${id}`)
		assert.equal(action, 'vote-expire')
		if (!st.vote || st.vote.state !== 'open') return { ok: false, error: `Board ${id}: keine offene Abstimmung` }
		const now = Date.now()
		st.endsAt = now - 1
		if (expireTouchesMeta) st.metaRev++
		return { ok: true, sid: st.vote.sid, endsAt: now - 1, now, rev: st.rev, metaRev: st.metaRev, deleted: 0, keys: [] }
	}
	const bridge = async (action, ...args) => {
		const r = await bridgeRaw(action, ...args)
		if (!r.ok) throw new Error(`Brücke ${action}: ${r.error}`)
		return r
	}
	const sync = async (body) => {
		st.calls.push('sync')
		assert.deepEqual(body.ops, [{ o: 'vote', s: 41, id: ITEM, n: 1 }])
		if (pathA && st.endsAt <= Date.now()) {
			st.vote = { ...st.vote, state: 'closed', results: [], voters: 0 }
			st.metaRev = ++st.rev
			return { status: 200, data: { rev: st.rev, acks: { res: ['closed'] } }, text: '{}' }
		}
		return { status: 200, data: { rev: st.rev, acks: { res: ['ok'] } }, text: '{}' }
	}
	return { st, api, bridge, bridgeRaw, sync }
}

const run = (srv, rec) => liveVote({ id: 12, itemId: ITEM, api: srv.api, bridge: srv.bridge, bridgeRaw: srv.bridgeRaw, sync: srv.sync, check: rec.check })

test('liveVote: a healthy server → six passed checks (route 22, vote-expire, unchanged meta, ["closed"], snapshot closed, second vote-expire refused)', async () => {
	const srv = fakeServer()
	const rec = recorder()
	assert.equal(await run(srv, rec), true)
	assert.deepEqual(rec.failed(), [])
	assert.equal(rec.passed(), 6)
	assert.deepEqual(rec.out.map((x) => x.label), [
		'live: Route 22 (Abstimmung starten) → 200 mit offener Sitzung (meta.vote.sid)',
		'live: vote-expire trifft die über Route 22 gestartete Sitzung',
		'live: rev, metaRev und meta (auch meta.vote.endsAt) unverändert, Sitzung noch offen',
		'live: Stimm-Op nach vote-expire → ["closed"] (Weg (a), WP-B3)',
		'live: danach meta.vote.state = closed (Snapshot, dieselbe sid)',
		'live: zweites vote-expire → Fehler (Weg (a) hat geschlossen, keine offene Abstimmung)',
	])
})

test('liveVote: route 22 not answering 200 is a FAILED check, never a skip with a note; nothing else runs', async () => {
	for (const status of [404, 500, 503]) {
		const srv = fakeServer({ startStatus: status })
		const rec = recorder()
		assert.equal(await run(srv, rec), false)
		assert.deepEqual(rec.failed(), ['live: Route 22 (Abstimmung starten) → 200 mit offener Sitzung (meta.vote.sid)'], `status ${status}`)
		assert.equal(rec.out.length, 1)
		assert.deepEqual(rec.out[0].info, { status, text: '{"error":"boom"}' })
		assert.ok(!srv.st.calls.some((c) => c.startsWith('bridge')), 'no vote-expire without a session')
	}
})

test('liveVote: a dead path (a) (vote op → ok, session stays open) fails three checks: ["closed"], snapshot closed, second vote-expire', async () => {
	const srv = fakeServer({ pathA: false })
	const rec = recorder()
	await run(srv, rec)
	assert.deepEqual(rec.failed(), [
		'live: Stimm-Op nach vote-expire → ["closed"] (Weg (a), WP-B3)',
		'live: danach meta.vote.state = closed (Snapshot, dieselbe sid)',
		'live: zweites vote-expire → Fehler (Weg (a) hat geschlossen, keine offene Abstimmung)',
	])
})

test('liveVote: a vote-expire that moves metaRev fails the "unchanged" check', async () => {
	const rec = recorder()
	await run(fakeServer({ expireTouchesMeta: true }), rec)
	assert.deepEqual(rec.failed(), ['live: rev, metaRev und meta (auch meta.vote.endsAt) unverändert, Sitzung noch offen'])
})

test('rejoinChecks: 403 link_expired passes; any other answer is a failed check (WP-B2)', () => {
	const ok = recorder()
	assert.equal(rejoinChecks(ok.check, { status: 403, data: { error: 'link_expired' }, text: '{"error":"link_expired"}' }), true)
	assert.deepEqual(ok.failed(), [])
	for (const rj of [{ status: 403, data: { error: 'link_revoked' } }, { status: 200, data: { guest: {} } }, { status: 500, data: null, text: 'x' }]) {
		const r = recorder()
		assert.equal(rejoinChecks(r.check, rj), false)
		assert.deepEqual(r.failed(), ['live: Neu-Beitritt nach link-expire → 403 link_expired (WP-B2)'])
	}
})

test('lib/selftest.mjs: the live part records the WP-B2/WP-B3 outcomes and its preconditions as checks, never as notes (R17 K6)', () => {
	const src = fs.readFileSync(path.join(DIR, 'lib', 'selftest.mjs'), 'utf8')
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.match(code, /import \{ rejoinChecks, liveVote, livePurge \} from '\.\/selftestLive\.mjs'/)
	assert.match(code, /rejoinChecks\(check, rj\)/)
	assert.match(code, /await liveVote\(\{ id, itemId: '01KSE1FTEST00000000000000A', api, bridge, bridgeRaw, sync, check \}\)/)
	assert.match(code, /await livePurge\(\{ id, api, bridgeRaw, sync, check \}\)/, 'stage 4: purge-tombstones live (R19)')
	assert.doesNotMatch(code, /steht noch nicht auf der Liste/, 'stage 4: the self-test checks the actions, not their refusal (§8.4 R19)')
	assert.match(code, /bridge\('app-config', 'budget_ops', '5000'\)/, 'stage 4: app-config in Part 1')
	const notes = [...code.matchAll(/notes\.push\(([^\n]*)\)/g)].map((m) => m[1])
	assert.deepEqual(notes, ['`live: pgss übersprungen (DB ${kind})`'], 'the only note left: pgss off PostgreSQL')
	assert.doesNotMatch(code, /ÜBERSPRUNGEN|erwartet ab WP-B|vote-expire übersprungen|link-expire übersprungen/)
	for (const label of ['live: Board anlegen → 201', 'live: Snapshot mit epoch (Protokoll 2)', 'live: Sync mit einer Notiz → 200', 'live: Bearbeitungslink anlegen (Route 17) → 200']) {
		assert.ok(code.includes(`'${label}'`), `precondition as a check: ${label}`)
	}
	assert.match(code, /if \(!check\(cr\.status === 201 && Number\.isSafeInteger\(cr\.data\?\.board\?\.id\), 'live: Board anlegen → 201'/)
})

// ── stage 4 (SPEC-M1 §8.4 R19, T4-07): livePurge ─────────────────────────────

/**
 * A fake board for livePurge: items with deleted flags, rev, min_rev.
 * @param {object} o
 * @param {boolean} [o.compact] occ knorke:compact exists (WP-B4 landed)
 * @param {boolean} [o.raiseMinRev] compact raises min_rev to X
 * @param {boolean} [o.deleteRows] compact deletes the tombstones
 */
function fakePurgeServer({ compact = true, raiseMinRev = true, deleteRows = true } = {}) {
	const st = { rev: 20, minRev: 11, items: new Map([['01KSE1FTEST00000000000000A', { deleted: 0, rev: 5 }]]), calls: [] }
	const api = async (user, method, p) => {
		st.calls.push(`${method} ${p}`)
		assert.match(p, /\/snapshot$/)
		const items = [...st.items].filter(([, v]) => !v.deleted).map(([id]) => ({ id }))
		return { status: 200, data: { rev: st.rev, minRev: st.minRev, items }, text: '{}' }
	}
	const sync = async (body) => {
		st.calls.push('sync')
		if (body.ops) {
			const res = []
			st.rev++
			for (const op of body.ops) {
				if (op.o === 'put') st.items.set(op.id, { deleted: 0, rev: st.rev })
				else st.items.set(op.id, { deleted: 1, rev: st.rev })
				res.push('ok')
			}
			return { status: 200, data: { rev: st.rev, acks: { rev: st.rev, res } }, text: '{}' }
		}
		return { status: 200, data: body.since < st.minRev ? { rev: st.rev, resync: true } : { rev: st.rev }, text: '{}' }
	}
	const bridgeRaw = async (action, id, age) => {
		st.calls.push(`bridge ${action} ${id} ${age}`)
		assert.equal(action, 'purge-tombstones')
		if (!compact) return { ok: false, error: 'occ knorke:compact: Command "knorke:compact" is not defined.' }
		const tombs = [...st.items].filter(([, v]) => v.deleted)
		const before = st.minRev
		const X = tombs.length ? Math.max(...tombs.map(([, v]) => v.rev)) : null
		if (X !== null && raiseMinRev) st.minRev = Math.max(st.minRev, X)
		if (deleteRows) for (const [k] of tombs) st.items.delete(k)
		return { ok: true, result: { board: Number(id), blocks: tombs.length ? 1 : 0, tombstones: deleteRows ? tombs.length : 0, changes: 0, minRevBefore: before, minRev: st.minRev, rev: st.rev, backdated: tombs.length, olderThanMs: 0, tombstoneDays: 30, now: Date.now() } }
	}
	return { st, api, sync, bridgeRaw }
}

const purge = (srv, rec) => livePurge({ id: 12, api: srv.api, bridgeRaw: srv.bridgeRaw, sync: srv.sync, check: rec.check })

test('livePurge: a healthy compact → eleven passed checks, the board answers with its JSON line, min_rev rises, resync only below X', async () => {
	const srv = fakePurgeServer()
	const rec = recorder()
	assert.equal(await purge(srv, rec), true)
	assert.deepEqual(rec.failed(), [])
	assert.equal(rec.passed(), 11)
	assert.deepEqual(COMPACT_KEYS, ['board', 'blocks', 'tombstones', 'changes', 'minRevBefore', 'minRev'])
	assert.ok(!srv.st.items.has(PURGE_ITEM), 'the note is gone')
	assert.deepEqual(srv.st.calls.filter((c) => c.startsWith('bridge')), ['bridge purge-tombstones 12 0', 'bridge purge-tombstones 12 0'], 'age 0, twice')
})

test('livePurge: no occ knorke:compact yet (WP-B4 not landed) is a FAILED check, and nothing after it runs', async () => {
	const srv = fakePurgeServer({ compact: false })
	const rec = recorder()
	assert.equal(await purge(srv, rec), false)
	assert.deepEqual(rec.failed(), ['live: purge-tombstones <b> 0 → ok (Rückdatierung + occ knorke:compact --board, WP-B4)'])
	assert.equal(srv.st.calls.filter((c) => c.startsWith('bridge')).length, 1)
})

test('livePurge: a compact that leaves min_rev alone or keeps the tombstone fails its checks', async () => {
	const r1 = recorder()
	await purge(fakePurgeServer({ raiseMinRev: false }), r1)
	assert.deepEqual(r1.failed(), ['live: min_rev = X ≥ rev des Grabsteins und gestiegen', 'live: Client mit since < X → resync'])
	const r2 = recorder()
	await purge(fakePurgeServer({ deleteRows: false }), r2)
	assert.deepEqual(r2.failed(), ['live: Grabstein rückdatiert und bereinigt (backdated, tombstones, blocks ≥ 1)'])
})
