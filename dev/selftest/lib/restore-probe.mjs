/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Restore probe of the epoch runbook (SPEC-M1 §5.4, §10 P5, Revision 19
 * T4-08), started by dev/selftest/restore.sh against ONE namespace (pgsql
 * only). A Sim client (alice, dev/sim/lib Client + Mirror) stays open and
 * polls every 400 ms through the whole probe:
 *
 *   1. board with SEED notes (alice, through /sync)
 *   2. pg_dump -Fc inside the database container (file /tmp/knorke-restore-probe.dump there)
 *   3. confirmed writes W after the dump: the open client puts W_NOTES notes
 *      and patches one seeded note (acks ok, mirror has them)
 *   4. occ maintenance:mode --on → pg_restore --clean --if-exists
 *      --single-transaction of the dump → occ config:app:set knorke epoch
 *      --value=<8 × [a-z0-9]> (a core command: Nextcloud loads no app
 *      commands in maintenance mode) → EPOCH_SETTLE_MS (other PHP processes
 *      keep app config 3 s in APCu, §5.4) → occ maintenance:mode --off
 *   5. the client polls on for AFTER_MS
 *
 * Pass (§10 P5): the client resyncs exactly once; W is missing afterwards in
 * the snapshot and in the client's mirror (the patched note has its old
 * text); every snapshot after the restore carries the new epoch, the
 * client's syncs with it never resync again, occ reads the new epoch back.
 * The dump file is removed and maintenance mode is off in every case
 * (finally); the board is deleted unless --keep.
 *
 * Report: dev/sim/out/<ns>/<KD_REPORT_STEM>.{md,json} (restore.sh sets
 * restore-pgsql[-<label>], §9.0 point 2 R19). Exit 0 green, 1 red, 2 setup.
 * A protected namespace (KD_PROTECT_NS, default try) is refused with exit 2
 * before loadEnv and any docker call unless KD_FORCE=1 (SPEC-M1 §8.1 R20,
 * K2: protectedNs of dev/sim/lib/env.mjs; restore.sh guards through
 * dev/lib.sh as well, this covers a direct start of the module).
 */
import { loadEnv, Stack, run, protectedNs } from '../../sim/lib/env.mjs'
import { Client, brief } from '../../sim/lib/http.mjs'
import { Suite } from '../../sim/lib/report.mjs'
import { Mirror, diffKeys, snapshotKeys } from '../../sim/lib/mirror.mjs'
import { ulid, clientId, sleep } from '../../sim/lib/gen.mjs'

export const SEED = 20
export const W_NOTES = 3
export const POLL_MS = 400
export const EPOCH_SETTLE_MS = 4500
export const AFTER_MS = 12000
export const DUMP = '/tmp/knorke-restore-probe.dump'
/** A new epoch value as §5.4 wants it: 8 characters [a-z0-9] (the runbook uses tr -dc 'a-z0-9' </dev/urandom | head -c 8). */
export function newEpoch(rand = Math.random) {
	const al = 'abcdefghijklmnopqrstuvwxyz0123456789'
	let s = ''
	for (let i = 0; i < 8; i++) s += al[Math.floor(rand() * al.length)]
	return s
}

const sticky = (id, x, text) => ({ o: 'put', id, t: 'sticky', p: { x, y: 0, w: 200, h: 200, r: 0, z: 'i' + (id.slice(-1).toLowerCase().replace(/[^0-9a-z]/, '0')), parent: null, data: { text }, style: { fill: '#a8d8f8' } } })

/** The open Sim client: polls every POLL_MS, keeps a mirror, counts resyncs and records every answer. */
class Poller {
	constructor(http, board) {
		this.http = http
		this.board = board
		this.client = clientId()
		this.mirror = new Mirror()
		this.cursor = 0
		this.resyncs = []
		this.answers = []
		this.queue = []
		this.seq = 0
		this.running = true
		this.acks = []
	}

	async load() {
		const r = await this.http.snapshot(this.board)
		if (r.status !== 200) throw new Error(`Snapshot: ${brief(r)}`)
		this.mirror.load(r.data)
		this.cursor = r.data.rev
		this.lastSnapshot = r.data
		return r.data
	}

	/** One poll (with the queued ops, if any); returns the answer. */
	async tick() {
		const body = { client: this.client, since: this.cursor, pres: 0 }
		const ops = this.queue.splice(0)
		if (ops.length) { body.ops = ops; body.seq = ++this.seq }
		const ep = this.http.ep
		const sent = Date.now()
		const r = await this.http.sync(this.board, body, { timeoutMs: 15000 })
		const rec = { sent, at: Date.now(), status: r.status, ep, resync: false }
		if (r.status === 200 && r.data) {
			if (ops.length) this.acks.push({ ops, acks: r.data.acks })
			if (r.data.resync || (typeof r.data.rev === 'number' && r.data.rev < this.cursor)) {
				rec.resync = true
				const s = await this.load()
				this.resyncs.push({ at: Date.now(), epoch: s.epoch, rev: s.rev, why: r.data.resync ? 'resync' : 'rev < since' })
			} else {
				this.mirror.apply(r.data)
				this.cursor = r.data.rev
			}
		} else if (ops.length) {
			this.queue.unshift(...ops)
			this.seq--
		}
		this.answers.push(rec)
		return r
	}

	async loop() {
		while (this.running) {
			const t0 = Date.now()
			await this.tick().catch((e) => this.answers.push({ at: Date.now(), status: 'error', error: String(e.message || e) }))
			await sleep(Math.max(0, POLL_MS - (Date.now() - t0)))
		}
	}
}

export async function main(argv = process.argv.slice(2)) {
	const KEEP = argv.includes('--keep')
	// SPEC-M1 §8.1 (R20, K2): before loadEnv and before any docker call
	const ns = process.env.KD_NS || 'main'
	if (protectedNs(ns)) {
		console.error(`restore-probe: VERWEIGERT: Namensraum '${ns}' ist geschützt (KD_PROTECT_NS)`)
		return 2
	}
	let env
	let stack
	try {
		env = loadEnv(ns)
		stack = new Stack(env)
		stack.requirePgsql('Restore-Probe')
	} catch (e) {
		console.error(`restore-probe: ${e.message}`)
		return 2
	}
	const suite = new Suite('restore')
	const db = env.containers.db
	let alice
	let board = null
	let poller = null
	let loop = null
	let maintenance = false
	const epochBefore = await stack.epoch()
	const epoch = newEpoch()
	const facts = { ns: env.ns, db: stack.dbLabel, nextcloud: env.versions?.nextcloud, epochBefore, epochAfter: epoch }
	try {
		env.epoch = epochBefore || undefined
		alice = await new Client(env, 'alice').login('alice')
		await suite.run('R1', 'Vorbereitung: Board mit gesäten Notizen, offener Sim-Client, pg_dump', async (t) => {
			const cr = await alice.createBoard('restore probe')
			t.check(cr.status === 201 && Number.isSafeInteger(cr.data?.board?.id), 'Board anlegen → 201', brief(cr))
			board = cr.data.board.id
			const s0 = await alice.snapshot(board)
			const seed = Array.from({ length: SEED }, (_, i) => sticky(ulid(), i * 220, `Seed ${i}`))
			const sr = await alice.sync(board, { client: clientId(), since: s0.data.rev, seq: 1, pres: 0, ops: seed })
			t.check(sr.status === 200 && sr.data?.acks?.res?.every((x) => x === 'ok'), `${SEED} Notizen gesät`, brief(sr))
			facts.seed = seed.map((o) => o.id)
			poller = new Poller(alice, board)
			await poller.load()
			loop = poller.loop()
			await sleep(1500)
			const d = await run('docker', ['exec', db, 'sh', '-c', `pg_dump -U nextcloud -d nextcloud -Fc -f ${DUMP}`], { timeoutMs: 120000 })
			t.check(d.ok, 'pg_dump -Fc im DB-Container', (d.err || d.out).slice(0, 300))
			facts.dumpRev = poller.cursor
		})
		const W = Array.from({ length: W_NOTES }, () => ulid())
		await suite.run('R2', 'bestätigte Schreibvorgänge W nach dem Dump (offener Client)', async (t) => {
			const target = facts.seed[0]
			poller.queue.push(...W.map((id, i) => sticky(id, 9000 + i * 220, `W ${i}`)), { o: 'patch', id: target, p: { 'data.text': 'W geändert' } })
			const t0 = Date.now()
			while (Date.now() - t0 < 10000 && poller.acks.length === 0) await sleep(100)
			const a = poller.acks[0]?.acks
			t.check(Array.isArray(a?.res) && a.res.length === W_NOTES + 1 && a.res.every((x) => x === 'ok'), `W bestätigt (${W_NOTES} Notizen + 1 patch, acks ok)`, a)
			await sleep(1000)
			t.check(W.every((id) => poller.mirror.items.has(id)) && poller.mirror.items.get(target)?.data?.text === 'W geändert', 'W im Spiegel des Clients')
			facts.wRev = poller.cursor
			facts.w = W
		})
		await suite.run('R3', 'Runbook (§5.4 R19): Wartung an → Restore → Epoche per occ config:app:set → Wartung aus', async (t) => {
			const on = await run('docker', ['exec', '-u', 'www-data', env.containers.nc, 'php', 'occ', 'maintenance:mode', '--on'])
			maintenance = true
			t.check(on.ok, 'occ maintenance:mode --on', (on.err || on.out).slice(0, 200))
			await sleep(1500)
			const rs = await run('docker', ['exec', db, 'sh', '-c', `pg_restore -U nextcloud -d nextcloud --clean --if-exists --single-transaction ${DUMP}`], { timeoutMs: 300000 })
			t.check(rs.ok, 'pg_restore --clean --if-exists --single-transaction', (rs.err || rs.out).slice(0, 400))
			const ep = await run('docker', ['exec', '-u', 'www-data', env.containers.nc, 'php', 'occ', 'config:app:set', 'knorke', 'epoch', `--value=${epoch}`])
			t.check(ep.ok, `occ config:app:set knorke epoch --value=${epoch} im Wartungsmodus (Kernbefehl)`, (ep.err || ep.out).slice(0, 200))
			await sleep(EPOCH_SETTLE_MS)
			const off = await run('docker', ['exec', '-u', 'www-data', env.containers.nc, 'php', 'occ', 'maintenance:mode', '--off'])
			t.check(off.ok, 'occ maintenance:mode --off', (off.err || off.out).slice(0, 200))
			maintenance = !off.ok
			facts.maintenance = poller.answers.filter((x) => x.status === 503).length
			t.note(`Antworten 503 während der Wartung: ${facts.maintenance}`)
		})
		const tOff = Date.now()
		await sleep(AFTER_MS)
		poller.running = false
		await loop
		await suite.run('R4', 'Bestanden (§10 P5): genau ein Resync, W fehlt in Snapshot und Spiegel, neue Epoche überall', async (t) => {
			// requests sent after maintenance off (one sent before may still come back 503)
			const after = poller.answers.filter((x) => x.sent >= tOff)
			t.check(poller.resyncs.length === 1, 'der Client resynct genau einmal', poller.resyncs)
			const r1 = poller.resyncs[0]
			t.check(r1 && r1.epoch === epoch, 'der Resync-Snapshot trägt die neue Epoche', r1)
			const later = r1 ? poller.answers.filter((x) => x.at > r1.at) : []
			t.check(later.length >= 5 && later.every((x) => x.status === 200 && x.ep === epoch && !x.resync), 'danach jede Anfrage mit der neuen Epoche, 200, kein weiterer Resync', later.slice(0, 5))
			t.check(after.length >= 10 && after.every((x) => x.status === 200), 'nach der Wartung (Anfragen danach gesendet) nur 200', after.filter((x) => x.status !== 200).slice(0, 3))
			t.check((await stack.epoch()) === epoch, 'occ config:app:get knorke epoch = neue Epoche')
			const snap = await alice.snapshot(board)
			t.check(snap.status === 200 && snap.data?.epoch === epoch, 'Snapshot nach dem Restore: epoch = neue Epoche', snap.data?.epoch)
			const items = new Map((snap.data?.items || []).map((it) => [it.id, it]))
			t.check(facts.w.every((id) => !items.has(id)), 'W fehlt im Snapshot', facts.w.filter((id) => items.has(id)))
			t.check(items.get(facts.seed[0])?.data?.text === 'Seed 0', 'der patch aus W ist zurückgenommen (Text vor dem Dump)', items.get(facts.seed[0])?.data)
			t.check(facts.w.every((id) => !poller.mirror.items.has(id)), 'W fehlt im Spiegel des Clients')
			const d = diffKeys(poller.mirror.keys(), snapshotKeys(snap.data), 'Spiegel', 'Snapshot')
			t.check(d.length === 0, 'Spiegel = Snapshot', d.slice(0, 3))
			t.note(`dump-rev ${facts.dumpRev}, rev mit W ${facts.wRev}, rev nach dem Restore ${snap.data?.rev}; Epoche ${epochBefore} → ${epoch}`)
		})
	} catch (e) {
		await suite.run('RX', 'Abbruch der Probe', async () => { throw e })
	} finally {
		if (poller) poller.running = false
		await loop?.catch(() => {})
		if (maintenance) await run('docker', ['exec', '-u', 'www-data', env.containers.nc, 'php', 'occ', 'maintenance:mode', '--off'])
		await run('docker', ['exec', db, 'rm', '-f', DUMP])
		if (board && !KEEP) await alice?.deleteBoard(board).catch(() => {})
	}
	return suite.finish(facts)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main().then((c) => process.exit(c), (e) => { console.error('restore-probe: ABBRUCH', e); process.exit(1) })
}
