/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The moderator of the iPad measurement R-B, over the API (SPEC-M1 §8.8 (5),
 * Revision 19 T4-13): during the session the user holds the iPad, this
 * script plays alice at the desktop – board, voting, timer and "Alle zu mir"
 * with a moving view the iPad follows. Runs on the host against the
 * namespace ipad (env.json from dev/.state/ipad/, the container address, Host
 * localhost; KD_NS overrides the namespace, e.g. d for a dry run).
 *
 *   KD_NS=ipad node dev/ipad/moderate.mjs board [--notes N]
 *        a board "R-B iPad" with N notes (default 3000, batches of 200,
 *        `busy` waited out with the same seq), 20 frames, edit and vote
 *        link; prints {board, voteUrl, editUrl} – the URLs through the relay
 *        (http://<env.json .ipad.lanHost>:18612/…, dev/ipad/relay.mjs); for
 *        a namespace without .ipad (a dry run, e.g. d) <env.json .baseHost>/…
 *   … vote-start <board> [--minutes N]     route 22 (5 votes, 1 per item, notes)
 *   … vote-end <board>                     route 23 {action: end}
 *   … timer <board> <minutes>              route 24 {action: start, ms}
 *   … timer-stop <board>                   route 24 {action: stop}
 *   … present <board> [--secs N]           route 25 "Alle zu mir" with this
 *        script's client id, then N s (default 60, max 900) of presence with
 *        a view v that steps around the board every 2 s (the iPad follows
 *        these jumps, §8.8 (5) "Folgen-Sprünge"); route 26 at the end, also on
 *        Strg+C
 * One JSON line per action on stdout. Exit 0 done, 1 the server said no,
 * 2 usage, env.json or a protected namespace (KD_PROTECT_NS, default try,
 * refused before loadEnv and any other step unless KD_FORCE=1; SPEC-M1 §8.1
 * R20, K2: protectedNs of dev/sim/lib/env.mjs). Nothing here touches the
 * stack other than through the app's API as alice.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, protectedNs } from '../sim/lib/env.mjs'
import { Client, brief } from '../sim/lib/http.mjs'
import { clientId, ulid, zKey, sleep } from '../sim/lib/gen.mjs'
import { RELAY_PORT, lanHostValid } from './relay.mjs'

export const ACTIONS = Object.freeze(['board', 'vote-start', 'vote-end', 'timer', 'timer-stop', 'present'])
export const NOTES_DEFAULT = 3000
export const VOTE = Object.freeze({ per: 5, perItem: 1, scope: null, types: ['sticky'] })
/**
 * Base URL of the links (what the iPad opens): through the relay on
 * env.ipad.lanHost (written by up.sh with KD_IPAD_PROFILE=1), else – in a dry
 * run against another namespace – the stack's own env.baseHost.
 * @param {object} env env.json of the namespace
 * @return {string}
 */
export function linkBase(env) {
	const lan = env?.ipad?.lanHost
	return lanHostValid(lan) ? `http://${lan}:${RELAY_PORT}/index.php/apps/knorke` : `${env.baseHost}/index.php/apps/knorke`
}

/** Strict parser: action, board id, minutes; --notes, --minutes, --secs. */
export function parseArgs(argv) {
	const [action, ...rest] = argv
	if (!ACTIONS.includes(action)) throw new Error(`Aktion fehlt oder ist unbekannt (${ACTIONS.join(' | ')})`)
	const o = { action }
	const pos = []
	for (let i = 0; i < rest.length; i++) {
		const m = /^--(notes|minutes|secs)$/.exec(rest[i])
		if (m) {
			if (!/^\d{1,5}$/.test(rest[i + 1] ?? '')) throw new Error(`--${m[1]} braucht eine Zahl`)
			o[m[1]] = Number(rest[++i])
			continue
		}
		if (rest[i].startsWith('--')) throw new Error(`unbekannte Option ${rest[i]}`)
		pos.push(rest[i])
	}
	const needBoard = action !== 'board'
	if (needBoard) {
		if (!/^\d{1,18}$/.test(pos[0] ?? '')) throw new Error(`${action} braucht eine Board-ID`)
		o.board = Number(pos.shift())
	}
	if (action === 'timer') {
		if (!/^\d{1,2}$/.test(pos[0] ?? '') || Number(pos[0]) < 1 || Number(pos[0]) > 99) throw new Error('timer braucht Minuten (1–99)')
		o.minutes = Number(pos.shift())
	}
	if (pos.length) throw new Error(`überzählige Argumente: ${pos.join(' ')}`)
	if (o.notes !== undefined && (o.notes < 1 || o.notes > 4000)) throw new Error('--notes 1–4000')
	if (action === 'vote-start' && o.minutes !== undefined && (o.minutes < 1 || o.minutes > 1440)) throw new Error('--minutes 1–1440')
	if (o.secs !== undefined && (o.secs < 1 || o.secs > 900)) throw new Error('--secs 1–900')
	return o
}

/** Writes ops in batches of 200; `busy` → retryMs, same seq. Returns the last rev. */
async function writeOps(c, board, ops, since) {
	const client = clientId()
	let seq = 0
	let rev = since
	for (let i = 0; i < ops.length; i += 200) {
		const s = ++seq
		for (let attempt = 0; attempt < 10; attempt++) {
			const r = await c.sync(board, { client, since: rev, seq: s, pres: 0, ops: ops.slice(i, i + 200) }, { timeoutMs: 60000 })
			const a = r.data?.acks
			if (r.status === 200 && a?.res?.includes('busy')) { await sleep(Math.min(Math.max(Number(a.retryMs) || 1000, 100), 11000)); continue }
			if (r.status !== 200 || !a?.res?.every((x) => x === 'ok')) throw new Error(`Batch ${s}: ${brief(r)}`)
			rev = a.rev ?? rev
			break
		}
	}
	return rev
}

/** The view path of `present`: a 3 × 3 tour over the seeded area, one step every 2 s. */
export function viewAt(step) {
	const cells = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2]]
	const [cx, cy] = cells[step % cells.length]
	return [cx * 3000, cy * 2400, 2400, 1500]
}

/**
 * Runs one action as alice. env: env.json of the namespace (or a fake).
 * @return {Promise<object>} the JSON line of the action
 */
export async function runAction(o, env, { log = () => {}, stop = { requested: false } } = {}) {
	const c = await new Client(env, 'alice').login('alice')
	const ok = (r, what) => {
		if (r.status !== 200 && r.status !== 201) {
			const e = new Error(`${what}: ${brief(r)}`)
			e.code = 1
			throw e
		}
		return r
	}
	if (o.action === 'board') {
		const n = o.notes ?? NOTES_DEFAULT
		const cr = ok(await c.createBoard(`R-B iPad ${new Date().toISOString().slice(0, 16)}`), 'Board anlegen')
		const b = cr.data.board.id
		const s0 = ok(await c.snapshot(b), 'Snapshot')
		const frames = Array.from({ length: 20 }, (_, f) => ({ o: 'put', id: ulid(), t: 'frame', p: { x: (f % 5) * 2000, y: Math.floor(f / 5) * 1600, w: 1900, h: 1500, r: 0, z: zKey(f), parent: null, data: { title: `Phase ${f + 1}` }, style: { fill: '#ffffff' } } }))
		const notes = Array.from({ length: n }, (_, i) => {
			const f = i % 20
			const slot = Math.floor(i / 20)
			return { o: 'put', id: ulid(), t: 'sticky', p: { x: 40 + (slot % 8) * 230, y: 80 + (Math.floor(slot / 8) % 6) * 230, w: 200, h: 200, r: 0, z: zKey(20 + i), parent: frames[f].id, data: { text: `Notiz ${i + 1}` }, style: { fill: '#fff59d' } } }
		})
		const rev = await writeOps(c, b, [...frames, ...notes], s0.data.rev)
		const edit = ok(await c.postLink(b, {}, 'edit'), 'Bearbeitungslink')
		const vote = ok(await c.postLink(b, {}, 'vote'), 'Abstimm-Link')
		const base = linkBase(env)
		return { action: 'board', board: b, notes: n, frames: 20, rev, voteUrl: `${base}/p/${vote.data.link.token}`, editUrl: `${base}/p/${edit.data.link.token}` }
	}
	const b = o.board
	if (o.action === 'vote-start') {
		const r = ok(await c.startVote(b, { ...VOTE, minutes: o.minutes ?? null }), 'Route 22')
		return { action: o.action, board: b, vote: r.data.board?.meta?.vote ?? null }
	}
	if (o.action === 'vote-end') {
		const r = ok(await c.updateVote(b, { action: 'end' }), 'Route 23')
		return { action: o.action, board: b, vote: r.data.board?.meta?.vote ?? null }
	}
	if (o.action === 'timer') {
		const r = ok(await c.timer(b, { action: 'start', ms: o.minutes * 60000 }), 'Route 24')
		return { action: o.action, board: b, timer: r.data.board?.meta?.timer ?? null }
	}
	if (o.action === 'timer-stop') {
		const r = ok(await c.timer(b, { action: 'stop' }), 'Route 24')
		return { action: o.action, board: b, timer: r.data.board?.meta?.timer ?? null }
	}
	// present: summon with this client, then presence with a moving view, then end
	const client = clientId()
	const s = ok(await c.snapshot(b), 'Snapshot')
	let since = s.data.rev
	ok(await c.summon(b, { client }), 'Route 25')
	const secs = o.secs ?? 60
	const t0 = Date.now()
	let step = 0
	let ticks = 0
	try {
		while (!stop.requested && Date.now() - t0 < secs * 1000) {
			const v = viewAt(Math.floor((Date.now() - t0) / 2000))
			if (Math.floor((Date.now() - t0) / 2000) !== step) { step = Math.floor((Date.now() - t0) / 2000); log(`Ansicht ${step}: ${v.join(', ')}`) }
			const r = await c.sync(b, { client, since, pres: 1, me: { c: [v[0] + v[2] / 2, v[1] + v[3] / 2], s: [], d: [], e: null, v } })
			if (r.status === 200 && Number.isInteger(r.data?.rev)) { since = r.data.rev; ticks++ }
			await sleep(1000)
		}
	} finally {
		await c.endSummon(b).catch(() => null)
	}
	return { action: 'present', board: b, client, secs, ticks, views: step + 1 }
}

async function main() {
	// SPEC-M1 §8.1 (R20, K2): before loadEnv and before any docker call
	const ns = process.env.KD_NS || 'ipad'
	if (protectedNs(ns)) {
		console.error(`[moderate] VERWEIGERT: Namensraum '${ns}' ist geschützt (KD_PROTECT_NS)`)
		return 2
	}
	let o
	try {
		o = parseArgs(process.argv.slice(2))
	} catch (e) {
		console.error(`[moderate] ${e.message}`)
		return 2
	}
	let env
	try {
		env = loadEnv(ns)
	} catch (e) {
		console.error(`[moderate] ${e.message}`)
		return 2
	}
	const stop = { requested: false }
	process.on('SIGINT', () => { stop.requested = true })
	process.on('SIGTERM', () => { stop.requested = true })
	try {
		console.log(JSON.stringify(await runAction(o, env, { log: (s) => console.error(`[moderate] ${s}`), stop })))
		return 0
	} catch (e) {
		console.error(`[moderate] ${e.message}`)
		return e.code === 1 ? 1 : 1
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main().then((c) => process.exit(c), (e) => { console.error('[moderate] ABBRUCH', e); process.exit(1) })
}
