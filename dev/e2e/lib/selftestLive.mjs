/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The stage-2 and stage-3 server outcomes of the bridge self-test's live
 * part (lib/selftest.mjs, Part 2), as CHECKS, never as notes (SPEC-M1 §8.4
 * R17 K6, review finding R-D1):
 *
 * - rejoinChecks: a guest's re-join after link-expire answers 403
 *   link_expired (WP-B2).
 * - liveVote: route 22 starts a real session (answering anything but 200
 *   with meta.vote.sid is a failed check, not a skip); vote-expire hits that
 *   session and leaves rev, metaRev and meta alone; the vote op afterwards
 *   answers ["closed"] (path (a) of WP-B3), the snapshot then shows
 *   meta.vote.state "closed" for that sid, and a second vote-expire is
 *   refused ("keine offene Abstimmung").
 * - livePurge (stage 4, SPEC-M1 §8.4 R19, T4-07): a note is put and
 *   removed, purge-tombstones <b> 0 backdates its tombstone and runs
 *   occ knorke:compact --board (WP-B4); the answer is compact's JSON line
 *   with the six keys of §4.13.7 (d) plus rev, min_rev rose to at least the
 *   tombstone's rev, a client below it resyncs and one at it does not, the
 *   snapshot no longer has the note, and a second purge finds nothing. A
 *   bridge error (no compact command yet) is a failed check.
 *
 * Kept apart from selftest.mjs, which reads env.json on import, so
 * dev/e2e/selftestLive.test.mjs drives both with fakes on the host. The
 * callers pass `check(cond, label, info) → boolean` of the self-test.
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const cut = (s, n = 160) => String(s ?? '').slice(0, n)

/**
 * The re-join of a guest after link-expire (WP-B2): 403 link_expired.
 * @param {(cond: boolean, label: string, info?: unknown) => boolean} check
 * @param {{status: number, data: object|null, text?: string}} rj answer of POST /pub/v1/<token>/join
 * @return {boolean}
 */
export function rejoinChecks(check, rj) {
	return check(rj?.status === 403 && rj?.data?.error === 'link_expired', 'live: Neu-Beitritt nach link-expire → 403 link_expired (WP-B2)', { status: rj?.status, text: cut(rj?.text) })
}

/**
 * A real session through route 22, then vote-expire and path (a) (WP-B3).
 * @param {object} o
 * @param {string|number} o.id the live board
 * @param {string} o.itemId a live sticky of the board (the vote op's target)
 * @param {(user: string, method: string, path: string, body?: object) => Promise<{status: number, data: any, text: string}>} o.api
 * @param {(action: string, ...args: string[]) => Promise<object>} o.bridge throws unless ok
 * @param {(action: string, ...args: string[]) => Promise<object>} o.bridgeRaw never throws, answers {ok: false, error} on a refusal
 * @param {(body: object) => Promise<{status: number, data: any, text: string}>} o.sync alice's protocol-2 sync on the board
 * @param {(cond: boolean, label: string, info?: unknown) => boolean} o.check
 * @return {Promise<boolean>} false when route 22 did not start a session (that is a failed check)
 */
export async function liveVote({ id, itemId, api, bridge, bridgeRaw, sync, check }) {
	const vs = await api('alice', 'POST', `/api/v1/boards/${id}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: 10 })
	const sid = vs?.data?.board?.meta?.vote?.sid
	if (!check(vs?.status === 200 && Number.isInteger(sid) && vs.data.board.meta.vote.state === 'open', 'live: Route 22 (Abstimmung starten) → 200 mit offener Sitzung (meta.vote.sid)', { status: vs?.status, text: cut(vs?.text) })) {
		return false
	}
	const before = await api('alice', 'GET', `/api/v1/boards/${id}/snapshot`)
	const ve = await bridge('vote-expire', String(id))
	check(ve.sid === sid && ve.endsAt === ve.now - 1, 'live: vote-expire trifft die über Route 22 gestartete Sitzung', { ve, sid })
	const after = await api('alice', 'GET', `/api/v1/boards/${id}/snapshot`)
	check(after.status === 200 && after.data.rev === before.data?.rev && after.data.board?.metaRev === before.data?.board?.metaRev
		&& same(after.data.board?.meta, before.data?.board?.meta) && after.data.board?.meta?.vote?.state === 'open',
	'live: rev, metaRev und meta (auch meta.vote.endsAt) unverändert, Sitzung noch offen', { before: before.data?.board, after: after.data?.board, revs: [before.data?.rev, after.data?.rev] })
	const vo = await sync({ since: after.data?.rev ?? 0, seq: 9, ops: [{ o: 'vote', s: sid, id: itemId, n: 1 }] })
	check(vo?.status === 200 && same(vo.data?.acks?.res, ['closed']), 'live: Stimm-Op nach vote-expire → ["closed"] (Weg (a), WP-B3)', { status: vo?.status, res: vo?.data?.acks?.res, text: cut(vo?.text) })
	const closed = await api('alice', 'GET', `/api/v1/boards/${id}/snapshot`)
	const mv = closed?.data?.board?.meta?.vote
	check(closed?.status === 200 && mv?.sid === sid && mv?.state === 'closed', 'live: danach meta.vote.state = closed (Snapshot, dieselbe sid)', { status: closed?.status, vote: mv })
	const ve2 = await bridgeRaw('vote-expire', String(id))
	check(ve2?.ok === false && /keine offene Abstimmung/.test(String(ve2?.error ?? '')), 'live: zweites vote-expire → Fehler (Weg (a) hat geschlossen, keine offene Abstimmung)', ve2)
	return true
}

/** The six keys of one JSON line of occ knorke:compact (SPEC-M1 §4.13.7 (d)). */
export const COMPACT_KEYS = Object.freeze(['board', 'blocks', 'tombstones', 'changes', 'minRevBefore', 'minRev'])

/** ULID of the note livePurge puts and removes. */
export const PURGE_ITEM = '01KSE1FTEST00000000000000P'

/**
 * purge-tombstones on the live board (stage 4, T4-07): checks, never notes.
 * @param {object} o
 * @param {string|number} o.id the live board
 * @param {(user: string, method: string, path: string, body?: object) => Promise<{status: number, data: any, text: string}>} o.api
 * @param {(action: string, ...args: string[]) => Promise<object>} o.bridgeRaw never throws, answers {ok, result|error}
 * @param {(body: object) => Promise<{status: number, data: any, text: string}>} o.sync alice's protocol-2 sync on the board
 * @param {(cond: boolean, label: string, info?: unknown) => boolean} o.check
 * @return {Promise<boolean>} false when a precondition or the purge itself failed
 */
export async function livePurge({ id, api, bridgeRaw, sync, check }) {
	const sn0 = await api('alice', 'GET', `/api/v1/boards/${id}/snapshot`)
	if (!check(sn0?.status === 200 && Number.isInteger(sn0?.data?.rev), 'live: Snapshot vor purge-tombstones → 200', { status: sn0?.status, text: cut(sn0?.text) })) return false
	const put = await sync({ since: sn0.data.rev, seq: 21, ops: [{ o: 'put', id: PURGE_ITEM, t: 'sticky', p: { x: 400, y: 0, w: 200, h: 200, r: 0, z: 'i1', parent: null, data: { text: 'purge' }, style: { fill: '#a8d8f8' } } }] })
	const rm = await sync({ since: put?.data?.rev ?? sn0.data.rev, seq: 22, ops: [{ o: 'remove', id: PURGE_ITEM }] })
	const tombRev = rm?.data?.acks?.rev
	if (!check(put?.status === 200 && same(put.data?.acks?.res, ['ok']) && rm?.status === 200 && same(rm.data?.acks?.res, ['ok']) && Number.isInteger(tombRev),
		'live: Notiz P anlegen und entfernen → Grabstein', { put: put?.data?.acks, rm: rm?.data?.acks })) return false
	const pr = await bridgeRaw('purge-tombstones', String(id), '0')
	if (!check(pr?.ok === true, 'live: purge-tombstones <b> 0 → ok (Rückdatierung + occ knorke:compact --board, WP-B4)', pr)) return false
	const r = pr.result
	check(COMPACT_KEYS.every((k) => Number.isInteger(r?.[k])) && r.board === Number(id),
		'live: Antwort = JSON-Zeile von compact (board, blocks, tombstones, changes, minRevBefore, minRev; §4.13.7 (d))', r)
	check(r?.backdated >= 1 && r?.tombstones >= 1 && r?.blocks >= 1, 'live: Grabstein rückdatiert und bereinigt (backdated, tombstones, blocks ≥ 1)', r)
	check(r?.minRev >= tombRev && r?.minRev > r?.minRevBefore, 'live: min_rev = X ≥ rev des Grabsteins und gestiegen', { r, tombRev })
	check(Number.isInteger(r?.rev) && r.rev >= r.minRev, 'live: Antwort trägt rev des Boards (≥ minRev)', r)
	const old = await sync({ since: tombRev - 1 })
	check(old?.status === 200 && old.data?.resync === true, 'live: Client mit since < X → resync', { status: old?.status, text: cut(old?.text) })
	const cur = await sync({ since: r?.minRev ?? tombRev })
	check(cur?.status === 200 && cur.data?.resync !== true, 'live: Client mit since ≥ X → kein resync', { status: cur?.status, text: cut(cur?.text) })
	const sn = await api('alice', 'GET', `/api/v1/boards/${id}/snapshot`)
	check(sn?.status === 200 && Array.isArray(sn.data?.items) && !sn.data.items.some((it) => it.id === PURGE_ITEM), 'live: Snapshot ohne die bereinigte Notiz', { status: sn?.status })
	const again = await bridgeRaw('purge-tombstones', String(id), '0')
	check(again?.ok === true && again.result?.tombstones === 0 && again.result?.minRev === r?.minRev, 'live: zweites purge-tombstones → nichts mehr zu bereinigen, min_rev bleibt', again)
	return true
}
