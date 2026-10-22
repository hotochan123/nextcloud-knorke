/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Convergence run with fault injection (SPEC-M0 §8.3, ERGEBNIS §5.7), on
 * every KD_DB kind (SPEC-M1 §8.6): pgsql, mariadb, mysql, sqlite, also
 * mariadb/mysql with mysql.utf8mb4 = false.
 *
 * Six simulated clients (alice, bob = accounts; four guests) play random ops
 * against ONE board for --secs seconds (default 30): create, move (always
 * the whole placement group, sometimes into or out of a frame), text with a
 * lease (me.e, sometimes taking over with tk), colour, z, unknown data
 * fields, delete, delete + immediate revive (same batch and next tick),
 * frames, the same "hot" objects. One request per tick, the tick measured
 * from the START of the request like the real client (400 ± 50 ms).
 *
 * SPEC-M1 §8.6, round 1a (--mix m1, the default): additionally shapes (every
 * kind, every style field, sometimes without data.kind, upper-case colours),
 * text items (h written with every text, font-size or width change, rule
 * 13), transforms (placement group + w, h, r in one patch; text items also
 * style.fontSize; sometimes keep: true on a non-container, which the server
 * ignores), frame resize at a random handle (top/left handles move the frame
 * and mostly carry keep: true, rule 15), style and data.kind changes per
 * type, delete/revive of every content type, and a few ops the server must
 * refuse (kind 'star', fontSize 401, type 'pen', w 5, dash 'wavy'). A frame
 * resize sends the client's membership patches right after the frame patch,
 * like transformItems (§6.5.2): children whose centre lies outside the new
 * box are released, root content items wholly inside it are adopted relative
 * to the NEW frame position (with keep, sometimes one root item more is
 * dropped into the new box) – keep acts at the time of its op (§4.7 rule 15,
 * R9), so these later ops stay as sent. Nothing is fenced: a client may
 * place items into a frame, move, resize or delete it again while its keep
 * patch waits in the queue; the oracle models keep in op order. K0 counts the
 * keep patches with a later adoption or release of the same frame in their
 * batch (must be > 0). --mix m0 plays the M0 workload unchanged.
 *
 * Connectors (SPEC-M1 §8.6, round 1b: on by default with --mix m1,
 * --no-connectors turns them off; --connectors is still accepted): connectors
 * between content items (ends auto, anchored with ax/ay of any precision,
 * free, onto a tombstone – removed by this or another client, seen in the sync
 * answers – or onto one of the "hot" items the other clients move and delete
 * at the same time, so an end often names an item a concurrent batch removed),
 * retargeting of one end, style/route/label changes, deleting connectors,
 * deleting bound items (delBound: preferably the hot ones), half of the time
 * with the client's own release of the bound ends before the remove
 * (deleteItems v2), binding an end to an item removed EARLIER IN THE SAME
 * BATCH (bindRemoved: retarget or new connector), and keep with connectors
 * (keepConnector: a frame child with a bound connector – existing or new in
 * the batch – and the frame's keep patch before or after the child's removal:
 * the release anchor is the child's working copy at the end of the batch
 * with the frame's end position, R9; a child removed before the keep op is no
 * live child then and is not shifted). The oracle checks every end against
 * its stored form and the release at the anchor (exact for unrotated targets,
 * ±0.01 for anchored ends on rotated ones). K0 counts what the connector
 * workload reached (lib/oracle.mjs connectorStats and the workload tags) and
 * fails the run when a kind never happened.
 *
 * Faults every 5 s:
 *   basic  delete r:, lower r: (with TTL), delete the presence blob p:
 *   full   + delete a:/g: (redis-del-access), delete ALL <prefix>/knorke/… keys at
 *          once, and the dev hook knorke_dev_skip_bump = 0.2 for the run
 *          (lost rev bumps after commit; deleted again after the active
 *          phase, in `finally`, and – round 2 U5 – on SIGINT/SIGTERM: the
 *          handler awaits the occ call before the process exits, because
 *          Node runs no `finally` when a signal ends it)
 *   full   + (stage 4, SPEC-M1 §8.6 R19, T4-14) the fault `purge` every 10 s:
 *          Stack.purgeTombstones(b, 0) – every tombstone of the board
 *          backdated beyond the retention, then occ knorke:compact --board=<b>
 *          WITHOUT --now. Clients below the new min_rev resync and load their
 *          mirror from the snapshot. The purged ids (tombstones before minus
 *          rows after, read by SQL around the purge) go to the oracle with the
 *          board rev after the purge: ops of later batches on them must get
 *          the code of §4.13.7 "Folgen" (put + revive = creation ok, patch
 *          or remove → gone, parent or connector end → bad; lib/oracle.mjs
 *          purgedBefore, folgenCode). A deviation about them is not counted
 *          only with that code; a code that contradicts "Folgen" is a
 *          deviation of its own (R20, K1). K0 requires at least one purge with
 *          a risen min_rev; K2 checks that every purged id that is not live
 *          again ends "removed" in the replayed log and is missing in the
 *          snapshot.
 *
 * Then quiet, catch-up, and three checks – all must report 0 deviations:
 *   1. every client mirror (snapshot + sync answers) equals the snapshot
 *   2. replaying the whole change log equals the snapshot; the log is read
 *      exactly through Nextcloud's own database connection (PHP in the
 *      Nextcloud container, Stack.changesJson: JSON, COUNT(*) = rows read)
 *      and its length is compared with the SQL side channel's count
 *   3. every `ok` op is in effect in the replayed state at its rev, after
 *      server normalisation (lowercase typed colours, cleaned text, empty values
 *      dropped, children of removed containers released, tombstone parents
 *      per §4.7 rule 6; keep shifts of containers, SPEC-M1 §4.7 rule 15, also
 *      for the children the batch did not touch; on a database without 4-byte UTF-8 every code point
 *      above U+FFFF becomes U+FFFD, oracle option fourByte); paths a later op
 *      of the same batch overwrote are skipped (placement: any path of the
 *      group)
 *
 * Protocol 2 (SPEC-M1 §4.3): every client sends the board epoch `ep` it
 * got from its snapshot or join (lib/http.mjs); the stack's epoch from occ
 * stands in until the server sends one.
 *
 *   KD_NS=d dev/sim/run.sh converge [--secs 30] [--faults basic|full|none] [--mix m1|m0] [--no-connectors] [--seed N] [--keep]
 *   (SQLite: --secs defaults to 45 – its single writer lock makes fewer ops per second)
 *
 * Exit 0 = 0 deviations, 1 = deviations or protocol errors, 2 = setup failed.
 */
import { loadEnv, Stack, rkey } from './lib/env.mjs'
import { Client, brief } from './lib/http.mjs'
import { Suite } from './lib/report.mjs'
import { ulid, clientId, zKey, prng, sleep, round2 } from './lib/gen.mjs'
import { Mirror, snapshotKeys, diffKeys, isObj, replayChanges, replayKeys } from './lib/mirror.mjs'
import { checkOps, connectorStats } from './lib/oracle.mjs'
import { mixAction, hotOf } from './lib/workload.mjs'

// ── arguments ────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const opt = (k, d) => {
	const i = args.indexOf('--' + k)
	return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d
}
const FAULTS = String(opt('faults', 'full'))
const MIX = String(opt('mix', 'm1'))
const SEED = Number(opt('seed', String(Date.now() % 1000000)))
const KEEP = args.includes('--keep')
if (!['basic', 'full', 'none'].includes(FAULTS)) { console.error('--faults basic|full|none'); process.exit(2) }
if (!['m0', 'm1'].includes(MIX)) { console.error('--mix m0|m1'); process.exit(2) }
if (args.includes('--connectors') && args.includes('--no-connectors')) { console.error('--connectors oder --no-connectors, nicht beides'); process.exit(2) }
/** Connector ops in the workload (SPEC-M1 §8.6, round 1b: part of --mix m1 unless --no-connectors; --connectors is the default). */
const CONNECTORS = MIX === 'm1' && !args.includes('--no-connectors')

let env
try {
	env = loadEnv(undefined, { anyDb: true })
} catch (e) {
	console.error(`converge: ${e.message}`)
	process.exit(2)
}
const stack = new Stack(env)
/** SQLite serialises every writer through one file lock: a longer window gives K0 its ≥ 50 ok ops (SPEC-M1 §8.6). */
const SECS = Number(opt('secs', stack.kind === 'sqlite' ? '45' : '30'))
if (!Number.isFinite(SECS) || SECS < 1) { console.error('--secs N (N ≥ 1)'); process.exit(2) }

// ── fault injection knorke_dev_skip_bump: on, off, and off on a signal ───
let skipBumpOp = Promise.resolve()
const skipBump = (on) => {
	skipBumpOp = skipBumpOp.catch(() => {}).then(() => (on
		? stack.occ('config:system:set', 'knorke_dev_skip_bump', '--value=0.2', '--type=float')
		: stack.occ('config:system:delete', 'knorke_dev_skip_bump')))
	return skipBumpOp
}
let stopping = false
for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		if (stopping) return
		stopping = true
		console.error(`converge: ${sig} – knorke_dev_skip_bump wird gelöscht, dann Ende`)
		try { for (const c of clients) c.running = false } catch { /* signal before the clients exist */ }
		// waits for a set that may still be in flight, then deletes – never the other way round
		skipBump(false)
			.then(() => console.error('converge: knorke_dev_skip_bump gelöscht'), (e) => console.error(`converge: Zurücksetzen schlug fehl – ${e?.message || e}`))
			.finally(() => stack.bruteforceReset().catch(() => {}))
			.finally(() => process.exit(sig === 'SIGINT' ? 130 : 143))
	})
}
const rnd = prng(SEED)
const suite = new Suite('converge')

const PALETTE = ['#a8d8f8', '#ffd6a5', '#caffbf', '#bdb2ff', '#ffadad', '#fdffb6', '#9bf6ff', '#ffc6ff']
const WORDS = 'Idee Ziel Risiko Kunde Termin Budget Team Frage Plan Test Doku Fehler Wunsch Fokus Lernen Retro Ärger Größe 漢字 😀'.split(' ')
/** SPEC-M1 §3.10, §4.8 (the harness keeps its own copy, it is the oracle). */
const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight']
const DASHES = ['solid', 'dashed', 'dotted']
const ALIGNS = ['left', 'center', 'right']
const VALIGNS = ['top', 'middle', 'bottom']
const SIZE = { sticky: [20, 2000], frame: [50, 100000], shape: [10, 20000], text: [4, 50000] }
const ROTATIONS = [0, 0, 0, 15, 30, 45, -45, 90, 135, -12.5]
/** Content types (not containers) the workload creates and edits; also the types an end binds to. */
const CONTENT = ['sticky', 'shape', 'text']
const ROUTES = ['straight', 'elbow', 'curved']
const CAPS = ['none', 'arrow', 'triangle', 'dot', 'diamond']
const ACTIVE_MS = 400
const JITTER_MS = 50

// ── setup ────────────────────────────────────────────────────────────────
let board
let link
const clients = []
const protocolErrors = []
const faultLog = []

class SimClient {
	constructor(http, name) {
		this.http = http
		this.name = name
		this.client = clientId()
		this.mirror = new Mirror()
		this.cursor = 0
		this.queue = []
		this.inflight = null
		this.seq = 0
		this.acks = []
		this.editing = null
		this.editLeft = 0
		this.takeOver = false
		this.pointer = [0, 0]
		this.pendingRevive = null
		// keep patches of frames and the membership patches after them (K0 counts the order of §6.5.2)
		this.keepOps = new WeakSet()
		this.memberOps = new WeakMap() // op → frame id
		// content items removed lately, by this client or (seen in a sync answer) another one:
		// connector ends onto tombstones (rule 14)
		this.removed = []
		// op → workload tag (K0 counts the ok ones); end value → 'live' | 'tombstone' (where endpoint() took the item from)
		this.tags = new WeakMap()
		this.epSource = new WeakMap()
		this.stats = { requests: 0, failures: 0, resyncs: 0, more: 0, codes: {} }
		this.acting = true
		this.running = true
		this.wake = null
	}

	async load() {
		const r = await this.http.snapshot(board)
		if (r.status !== 200 || !Array.isArray(r.data?.items)) throw new Error(`Snapshot ${this.name}: ${brief(r)}`)
		this.mirror.load(r.data)
		this.cursor = r.data.rev
		this.pid = r.data.me?.pid
	}

	enqueue(op) {
		// Queue compaction of the real client (§6.4), the part the checks rely on:
		// remove after patch → remove (the patches of that id are dropped).
		if (op.o === 'remove') this.queue = this.queue.filter((q) => !(q.id === op.id && q.o === 'patch'))
		this.queue.push(op)
	}

	async loop() {
		while (this.running) {
			const t0 = Date.now()
			if (this.acting) this.act()
			else this.flushRevive()
			const more = await this.tick()
			if (more) continue
			const delay = Math.max(0, t0 + ACTIVE_MS + rnd.range(-JITTER_MS, JITTER_MS) - Date.now())
			await sleep(delay)
		}
	}

	/** One request: ops (if any), presence, catch-up. Returns true when the server said `more`. */
	async tick() {
		if (!this.inflight && this.queue.length) {
			this.inflight = { seq: ++this.seq, ops: this.queue.splice(0, 200) }
		}
		const body = { client: this.client, since: this.cursor, pres: 1 }
		if (this.inflight) { body.ops = this.inflight.ops; body.seq = this.inflight.seq }
		body.me = { c: this.pointer, s: this.editing ? [this.editing] : [], d: [], e: this.editing }
		if (this.takeOver && this.editing) { body.me.tk = 1; this.takeOver = false }
		this.stats.requests++
		const r = await this.http.sync(board, body, { timeoutMs: 15000 })
		if (r.status === 200 && isObj(r.data)) {
			if (this.inflight) {
				const a = r.data.acks
				if (!a || !Array.isArray(a.res) || a.res.length !== this.inflight.ops.length || a.seq !== this.inflight.seq) {
					protocolErrors.push({ client: this.name, problem: 'acks fehlen oder passen nicht', acks: a, n: this.inflight.ops.length })
				} else {
					this.acks.push({ client: this.client, name: this.name, seq: this.inflight.seq, rev: a.rev, res: a.res, ops: this.inflight.ops })
					for (const c of a.res) this.stats.codes[c] = (this.stats.codes[c] || 0) + 1
				}
				this.inflight = null
			}
			if (r.data.resync) {
				this.stats.resyncs++
				await this.load()
				return false
			}
			if (typeof r.data.rev === 'number' && r.data.rev < this.cursor) {
				// §4.10.3: an answer with rev < since and no resync counts as resync.
				this.stats.resyncs++
				await this.load()
				return false
			}
			// content items this answer removes: candidate tombstones for connector ends (before the mirror forgets their type)
			for (const id of r.data.removed || []) if (CONTENT.includes(this.mirror.items.get(id)?.t)) this.noteRemoved(id)
			this.mirror.apply(r.data)
			this.cursor = r.data.rev
			if (r.data.more) { this.stats.more++; return true }
			return false
		}
		this.stats.failures++
		if (r.status === 'neterr' || r.status === 'timeout' || (typeof r.status === 'number' && r.status >= 500)) {
			// keep the in-flight batch: identical retry with the same seq
			return false
		}
		protocolErrors.push({ client: this.name, status: r.status, body: String(r.text).slice(0, 300), ops: this.inflight?.ops?.length || 0 })
		this.inflight = null
		return false
	}

	// ── random workload ──
	live(t) {
		const out = []
		for (const [id, it] of this.mirror.items) if (!t || (Array.isArray(t) ? t.includes(it.t) : it.t === t)) out.push([id, it])
		return out
	}

	/** Enqueues the revive of a "delete + revive next tick". */
	flushRevive() {
		const rv = this.pendingRevive
		if (!rv) return
		this.enqueue(rv)
		this.pendingRevive = null
	}

	act() {
		this.flushRevive()
		if (this.editing && this.editLeft-- <= 0) this.editing = null
		this.pointer = [round2(rnd.range(-500, 3000)), round2(rnd.range(-500, 2000))]
		const n = rnd.int(0, 3)
		const touched = new Set()
		for (let k = 0; k < n; k++) {
			const x = rnd.next()
			if (MIX === 'm0') {
				// the M0 workload (SPEC-M0 §8.3), kept for comparison runs
				if (x < 0.22) this.createSticky()
				else if (x < 0.26) this.createFrame()
				else if (x < 0.50) this.move(touched, rnd.chance(0.85) ? ['sticky'] : ['frame'])
				else if (x < 0.64) this.text(touched, rnd.chance(0.85) ? ['sticky'] : ['frame'])
				else if (x < 0.70) this.style(touched, ['sticky', 'frame'])
				else if (x < 0.76) this.del(touched, rnd.chance(0.8) ? ['sticky'] : ['frame'])
				else if (x < 0.80) this.delRevive(touched, true, ['sticky'])
				else if (x < 0.83) this.delRevive(touched, false, ['sticky'])
				else if (x < 0.87) this.zMove(touched)
				else if (x < 0.90) this.unknownField(touched)
				else if (x < 0.92) this.noop(touched)
				continue
			}
			// SPEC-M1 §8.6: shapes, text items (h with the text), transforms, frame resize with keep
			// (round 1a) and connectors at full strength (round 1b) – weights in lib/workload.mjs
			const a = mixAction(x, CONNECTORS)
			if (a === 'delReviveSame') this.delRevive(touched, true)
			else if (a === 'delReviveNext') this.delRevive(touched, false)
			else this[a](touched)
		}
	}

	/** Enqueues `op` with a workload tag (K0 counts the ok ops per tag). */
	tag(op, kind) {
		this.tags.set(op, kind)
		this.enqueue(op)
		return op
	}

	/** Remembers a removed content item as a candidate tombstone for connector ends (the last 12). */
	noteRemoved(id) {
		this.removed = this.removed.filter((x) => x !== id)
		this.removed.push(id)
		if (this.removed.length > 12) this.removed.shift()
	}

	/** Enqueues the remove of `id` (optionally tagged); a content item becomes a candidate tombstone. */
	removeItem(id, t, kind = null) {
		const op = { o: 'remove', id }
		if (kind) this.tag(op, kind)
		else this.enqueue(op)
		if (CONTENT.includes(t)) this.noteRemoved(id)
		return op
	}

	/** Ids of the live connectors (as the mirror has them) with an end bound to `id`. */
	boundTo(id) {
		const out = []
		for (const [cid, c] of this.live('connector')) if (c.data?.start?.item === id || c.data?.end?.item === id) out.push(cid)
		return out
	}

	/**
	 * The client's own release of deleteItems v2 (§6.5.2): every end of a live
	 * connector bound to `id` becomes a free point BEFORE the remove (here the
	 * centre of the item's stored box; the client takes the visible docking
	 * point). Connectors of this act are left alone.
	 */
	releaseEnds(id, it, touched) {
		for (const [cid, c] of this.live('connector')) {
			if (touched.has(cid)) continue
			for (const side of ['start', 'end']) {
				if (c.data?.[side]?.item === id) this.tag({ o: 'patch', id: cid, p: { ['data.' + side]: { x: round2(it.x + it.w / 2), y: round2(it.y + it.h / 2) } } }, 'client-release')
			}
		}
	}

	/** Picks a live item of the given type(s) not touched in this act. */
	pickItem(touched, t = null, hot = true) {
		let pool = this.live(t).filter(([id]) => !touched.has(id))
		if (!pool.length) return null
		if (hot && rnd.chance(0.35)) {
			const sorted = pool.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 5)
			pool = sorted
		}
		const [id, it] = rnd.pick(pool)
		touched.add(id)
		return [id, it]
	}

	placementFor(t) {
		const frames = this.live('frame')
		if (t !== 'frame' && frames.length && rnd.chance(0.35)) {
			const [fid, f] = rnd.pick(frames)
			return { x: round2(rnd.range(0, Math.max(1, f.w - 200))), y: round2(rnd.range(0, Math.max(1, f.h - 200))), parent: fid }
		}
		return { x: round2(rnd.range(-1000, 4000)), y: round2(rnd.range(-1000, 3000)), parent: null }
	}

	fill() {
		const c = rnd.pick(PALETTE)
		return rnd.chance(0.3) ? c.toUpperCase() : c
	}

	/** Any #rrggbb, sometimes upper case (typed colour fields are stored lower case). */
	color() {
		const c = '#' + Array.from({ length: 6 }, () => '0123456789abcdef'[rnd.int(0, 15)]).join('')
		return rnd.chance(0.3) ? c.toUpperCase() : c
	}

	words(n = rnd.int(1, 5)) {
		return Array.from({ length: n }, () => rnd.pick(WORDS)).join(' ')
	}

	/** A "measured" height of a text item (§4.7 rule 13: the writer measures, the server never computes h). */
	textH(fontSize) {
		return round2(fontSize * 1.2 * rnd.int(1, 4))
	}

	createSticky() {
		this.enqueue({ o: 'put', id: ulid(), t: 'sticky', p: { ...this.placementFor('sticky'), w: 200, h: 200, r: 0, z: zKey(rnd.int(0, 1300)), data: { text: this.words() }, style: { fill: this.fill() } } })
	}

	createFrame() {
		if (this.live('frame').length >= 6) return this.createSticky()
		this.enqueue({ o: 'put', id: ulid(), t: 'frame', p: { x: round2(rnd.range(-500, 3000)), y: round2(rnd.range(-500, 2000)), w: 800, h: 600, r: 0, parent: null, z: zKey(rnd.int(0, 1300)), data: { title: this.words(2) }, style: { fill: '#ffffff' } } })
	}

	createShape() {
		const style = { fill: this.color(), stroke: this.color() }
		if (rnd.chance(0.5)) style.fillOpacity = rnd.int(0, 100)
		if (rnd.chance(0.5)) style.strokeWidth = rnd.int(0, 24)
		if (rnd.chance(0.4)) style.dash = rnd.pick(DASHES)
		if (rnd.chance(0.4)) style.textColor = this.color()
		if (rnd.chance(0.4)) style.fontSize = rnd.int(8, 200)
		if (rnd.chance(0.3)) style.align = rnd.pick(ALIGNS)
		if (rnd.chance(0.3)) style.valign = rnd.pick(VALIGNS)
		const data = { text: this.words() }
		if (rnd.chance(0.9)) data.kind = rnd.pick(SHAPE_KINDS)
		this.enqueue({ o: 'put', id: ulid(), t: 'shape', p: { ...this.placementFor('shape'), w: round2(rnd.range(10, 600)), h: round2(rnd.range(10, 400)), r: rnd.pick(ROTATIONS), z: zKey(rnd.int(0, 1300)), data, style } })
	}

	createText() {
		const fontSize = rnd.pick([12, 16, 24, 32, 48, 96])
		this.enqueue({ o: 'put', id: ulid(), t: 'text', p: { ...this.placementFor('text'), w: round2(rnd.range(40, 600)), h: this.textH(fontSize), r: rnd.pick(ROTATIONS), z: zKey(rnd.int(0, 1300)), data: { text: this.words() }, style: { fontSize, color: this.color(), align: rnd.pick(ALIGNS) } } })
	}

	move(touched, types = rnd.chance(0.85) ? CONTENT : ['frame']) {
		const pick = this.pickItem(touched, types)
		if (!pick) return
		const [id, it] = pick
		const p = it.t === 'frame' ? { x: round2(rnd.range(-500, 3000)), y: round2(rnd.range(-500, 2000)), parent: null } : this.placementFor(it.t)
		this.enqueue({ o: 'patch', id, p })
	}

	/**
	 * Transformer result (§6.5.2 transformItems): the whole placement group plus
	 * w, h, r in one patch; text items also scale style.fontSize and carry h.
	 * Sometimes keep: true on a non-container (ignored by the server, §4.6).
	 */
	transform(touched) {
		const pick = this.pickItem(touched, CONTENT)
		if (!pick) return
		const [id, it] = pick
		const [lo, hi] = SIZE[it.t]
		const clamp = (v) => Math.min(hi, Math.max(lo, round2(v)))
		const k = rnd.range(0.5, 1.8)
		const pl = rnd.chance(0.3) ? this.placementFor(it.t) : { x: round2(it.x + rnd.range(-60, 60)), y: round2(it.y + rnd.range(-60, 60)), parent: it.parent }
		const p = { ...pl, w: clamp(it.w * k), h: clamp(it.h * (rnd.chance(0.5) ? k : rnd.range(0.5, 1.8))), r: rnd.pick(ROTATIONS) }
		if (it.t === 'text') {
			const fs = Math.min(400, Math.max(8, Math.round((Number(it.style?.fontSize) || 24) * k)))
			p['style.fontSize'] = fs
			p.h = Math.min(hi, Math.max(lo, this.textH(fs)))
		}
		const op = { o: 'patch', id, p }
		if (rnd.chance(0.08)) op.keep = true
		this.enqueue(op)
	}

	/**
	 * Frame resize at a random handle (§6.3): a handle on the top or left edge
	 * moves the frame, and then the patch carries keep: true (§4.7 rule 15),
	 * mostly; sometimes without (the M0 behaviour: children move with it).
	 * The client's membership patches follow in the same batch (membership).
	 */
	frameResize(touched) {
		const pick = this.pickItem(touched, 'frame')
		if (!pick) return
		const [id, f] = pick
		const handle = rnd.pick(['tl', 't', 'l', 'br', 'r', 'b'])
		const d1 = /l/.test(handle) ? round2(rnd.range(-200, Math.min(200, f.w - 60))) : 0
		const d2 = /t/.test(handle) ? round2(rnd.range(-200, Math.min(200, f.h - 60))) : 0
		const grow = (v) => (handle === 'br' || handle === 'r' || handle === 'b' ? round2(rnd.range(-100, 300)) : 0) + v
		const w = Math.max(50, round2(grow(f.w - d1)))
		const h = Math.max(50, round2(grow(f.h - d2)))
		const p = { x: round2(f.x + d1), y: round2(f.y + d2), parent: null, w, h }
		const op = { o: 'patch', id, p }
		if ((d1 !== 0 || d2 !== 0) && rnd.chance(0.85)) {
			op.keep = true
			this.keepOps.add(op)
		}
		this.enqueue(op)
		const n = this.membership(id, f, { x: p.x, y: p.y, w, h }, op.keep === true, touched)
		if (op.keep === true && n === 0 && rnd.chance(0.5)) {
			// the user drops one more item into the new box right away: same batch, after the keep patch
			const root = this.live(CONTENT).filter(([cid, it]) => !touched.has(cid) && !it.parent)
			if (root.length) {
				const [cid] = rnd.pick(root)
				touched.add(cid)
				this.member({ o: 'patch', id: cid, p: { x: round2(rnd.range(0, Math.max(1, w - 200))), y: round2(rnd.range(0, Math.max(1, h - 200))), parent: id } }, id)
			}
		}
	}

	/**
	 * The membership patches of transformItems (§6.5.2, src/board/actions.js
	 * membership) after frame `id` changed from box `f` to box `a`: children
	 * (as the mirror has them) whose centre lies outside the new box go to the
	 * root at their absolute position (with keep the children stay where they
	 * were, so that is the old frame position plus the relative one; without
	 * keep they moved with the frame), root content items wholly inside the new
	 * box become children relative to the NEW frame position. Returns the
	 * number of patches.
	 */
	membership(id, f, a, kept, touched) {
		let n = 0
		const base = kept ? f : a
		const inside = (x, y) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h
		for (const [cid, it] of this.live(CONTENT)) {
			if (touched.has(cid)) continue
			if (it.parent === id) {
				const ax = base.x + it.x
				const ay = base.y + it.y
				if (inside(ax + it.w / 2, ay + it.h / 2)) continue
				touched.add(cid)
				this.member({ o: 'patch', id: cid, p: { x: round2(ax), y: round2(ay), parent: null } }, id)
				n++
			} else if (!it.parent && it.x >= a.x && it.y >= a.y && it.x + it.w <= a.x + a.w && it.y + it.h <= a.y + a.h) {
				touched.add(cid)
				this.member({ o: 'patch', id: cid, p: { x: round2(it.x - a.x), y: round2(it.y - a.y), parent: id } }, id)
				n++
			}
		}
		return n
	}

	/** Enqueues a membership patch of frame `frame` (K0 counts them after a keep patch). */
	member(op, frame) {
		this.memberOps.set(op, frame)
		this.enqueue(op)
	}

	text(touched, types = rnd.chance(0.85) ? CONTENT : ['frame']) {
		const pick = this.pickItem(touched, types)
		if (!pick) return
		const [id, it] = pick
		if (this.editing !== id) {
			this.editing = id
			this.editLeft = rnd.int(1, 4)
			this.takeOver = rnd.chance(0.3)
		}
		const path = it.t === 'frame' ? 'data.title' : 'data.text'
		const p = { [path]: this.words() }
		if (it.t === 'text') p.h = this.textH(Number(it.style?.fontSize) || 24) // rule 13: h in the same patch
		this.enqueue({ o: 'patch', id, p })
	}

	/** One style (or data.kind) change of the item's type (§3.10, §6.5.2 setStyle). */
	style(touched, types = null) {
		const pick = this.pickItem(touched, types)
		if (!pick) return
		const [id, it] = pick
		let p
		if (it.t === 'sticky') p = rnd.chance(0.8) ? { 'style.fill': this.fill() } : { 'style.fontSize': rnd.int(8, 200) }
		else if (it.t === 'frame') p = { 'style.fill': this.fill() }
		else if (it.t === 'text') {
			const fs = rnd.int(8, 400)
			p = rnd.pick([{ 'style.color': this.color() }, { 'style.align': rnd.pick(ALIGNS) }, { 'style.fontSize': fs, h: this.textH(fs) }])
		} else if (it.t === 'shape') {
			p = rnd.pick([
				{ 'style.fill': this.color() }, { 'style.fillOpacity': rnd.int(0, 100) }, { 'style.stroke': this.color() },
				{ 'style.strokeWidth': rnd.int(0, 24) }, { 'style.dash': rnd.pick(DASHES) }, { 'style.textColor': this.color() },
				{ 'style.fontSize': rnd.int(8, 200) }, { 'style.align': rnd.pick(ALIGNS) }, { 'style.valign': rnd.pick(VALIGNS) },
				{ 'data.kind': rnd.pick(SHAPE_KINDS) }, { 'style.fontSize': null },
			])
		} else return
		this.enqueue({ o: 'patch', id, p })
	}

	del(touched, types = rnd.chance(0.85) ? CONTENT : ['frame']) {
		const pick = this.pickItem(touched, CONNECTORS && rnd.chance(0.1) ? ['connector'] : types, false)
		if (!pick) return
		const [id, it] = pick
		// the client's own release (deleteItems v2): bound ends become free points BEFORE the remove
		if (CONNECTORS && it.t !== 'connector' && rnd.chance(0.5)) this.releaseEnds(id, it, touched)
		this.removeItem(id, it.t)
	}

	/**
	 * Deletes a content item with bound connectors (round 1b), preferably one of
	 * the hot items the other clients bind ends to: their connectors are released
	 * by the server (concurrent) or, half of the time, by this client first.
	 */
	delBound(touched) {
		let pool = this.live(CONTENT).filter(([id]) => !touched.has(id) && this.boundTo(id).length)
		if (!pool.length) return this.del(touched)
		if (rnd.chance(0.5)) pool = hotOf(pool)
		const [id, it] = rnd.pick(pool)
		touched.add(id)
		if (rnd.chance(0.5)) this.releaseEnds(id, it, touched)
		this.removeItem(id, it.t, 'del-bound')
	}

	/** ax/ay of an anchored end: corners, centre lines, or more than 4 decimals (stored with q(v, 10000)). */
	anchor() {
		return { ax: rnd.pick([0, 0.5, 1, rnd.next()]), ay: rnd.pick([0, 0.5, 1, rnd.next()]) }
	}

	/**
	 * A random end: bound to a live content item (auto or anchored; a third of
	 * them to the hot items, which concurrent batches move and delete), to a
	 * tombstone (removed by this or another client), or free. The value object
	 * is remembered in epSource ('live' | 'tombstone'): K0 tells ends whose live
	 * target a concurrent batch removed first (stored as a free point).
	 */
	endpoint() {
		const x = rnd.next()
		let ep
		if (x < 0.15 && this.removed.length) {
			const id = rnd.pick(this.removed)
			ep = rnd.chance(0.7) ? { item: id, ...this.anchor() } : { item: id }
			this.epSource.set(ep, 'tombstone')
			return ep
		}
		let pool = this.live(CONTENT)
		if (x < 0.8 && pool.length) {
			if (rnd.chance(0.35)) pool = hotOf(pool)
			const [id] = rnd.pick(pool)
			ep = rnd.chance(0.5) ? { item: id } : { item: id, ...this.anchor() }
			this.epSource.set(ep, 'live')
			return ep
		}
		return { x: round2(rnd.range(-500, 3000)), y: round2(rnd.range(-500, 2000)) }
	}

	/** A connector put between two ends (route, caps, stroke, dash and label at random). */
	connectorPut([start, end]) {
		const style = { stroke: this.color(), strokeWidth: rnd.int(1, 24), endCap: rnd.pick(CAPS) }
		if (rnd.chance(0.4)) style.startCap = rnd.pick(CAPS)
		if (rnd.chance(0.3)) style.dash = rnd.pick(DASHES)
		const data = { start, end, route: rnd.pick(ROUTES) }
		if (rnd.chance(0.3)) data.label = this.words(2)
		return { o: 'put', id: ulid(), t: 'connector', p: { x: 0, y: 0, w: 0, h: 0, r: 0, parent: null, z: zKey(rnd.int(0, 1300)), data, style } }
	}

	createConnector() {
		this.enqueue(this.connectorPut([this.endpoint(), this.endpoint()]))
	}

	/** Moves one end (retarget, §6.5.2): another item, a tombstone, or a free point. */
	retarget(touched) {
		const pick = this.pickItem(touched, ['connector'])
		if (!pick) return
		this.enqueue({ o: 'patch', id: pick[0], p: { [rnd.chance(0.5) ? 'data.start' : 'data.end']: this.endpoint() } })
	}

	/**
	 * An end onto an item removed EARLIER IN THE SAME BATCH (SPEC-M1 §4.7 rule 14,
	 * §8.6): remove a content item (sometimes after the client release), then
	 * retarget a connector end to it or put a new connector bound to it – the
	 * server stores the free point at the item's anchor at that op.
	 */
	bindRemoved(touched) {
		const pick = this.pickItem(touched, CONTENT)
		if (!pick) return
		const [id, it] = pick
		if (rnd.chance(0.5)) this.releaseEnds(id, it, touched)
		this.removeItem(id, it.t)
		const ep = rnd.chance(0.5) ? { item: id } : { item: id, ...this.anchor() }
		const conn = rnd.chance(0.6) ? this.pickItem(touched, ['connector']) : null
		if (conn) this.tag({ o: 'patch', id: conn[0], p: { [rnd.chance(0.5) ? 'data.start' : 'data.end']: ep } }, 'bind-removed')
		else this.tag(this.connectorPut(rnd.chance(0.5) ? [ep, this.endpoint()] : [this.endpoint(), ep]), 'bind-removed')
	}

	/**
	 * keep together with connectors (SPEC-M1 §4.7 rules 14 and 15, R9): a child E of
	 * a frame F gets a bound connector unless it has one (a new connector in this
	 * batch, anchored or auto), then F's keep patch at its top-left handle and the
	 * removal of E, in either order:
	 *  - keep first: E is a live child at the keep op and shifted with it; the
	 *    release anchor (E's working copy at the end of the batch plus F's end
	 *    position) is the point where E stood;
	 *  - remove first: E is no live child at the keep op and not shifted; the
	 *    release anchor moves with F's end position.
	 * Sometimes the client releases E's ends itself before the remove.
	 */
	keepConnector(touched) {
		const cand = []
		for (const [fid, f] of this.live('frame')) {
			if (touched.has(fid)) continue
			for (const [cid, c] of this.live(CONTENT)) if (c.parent === fid && !touched.has(cid)) cand.push([fid, f, cid, c])
		}
		if (!cand.length) return this.createConnector(touched)
		const [fid, f, eid, e] = rnd.pick(cand)
		touched.add(fid)
		touched.add(eid)
		if (!this.boundTo(eid).length || rnd.chance(0.4)) {
			const ep = rnd.chance(0.5) ? { item: eid } : { item: eid, ...this.anchor() }
			this.tag(this.connectorPut(rnd.chance(0.5) ? [ep, this.endpoint()] : [this.endpoint(), ep]), 'keep-conn:put')
		}
		const dx = round2(rnd.range(-150, 150)) || 10
		const dy = round2(rnd.range(-150, 150))
		const keepOp = { o: 'patch', id: fid, p: { x: round2(f.x + dx), y: round2(f.y + dy), parent: null, w: Math.max(50, round2(f.w - dx)), h: Math.max(50, round2(f.h - dy)) }, keep: true }
		this.keepOps.add(keepOp)
		const removeFirst = rnd.chance(0.5)
		const removeE = () => {
			if (rnd.chance(0.3)) this.releaseEnds(eid, e, touched)
			this.removeItem(eid, e.t, removeFirst ? 'keep-conn:remove-first' : 'keep-conn:remove-after')
		}
		if (removeFirst) {
			removeE()
			// an end bound to E after its removal and before the frame moves: the free point comes
			// from E and F at THIS op (rule 14 at op time), not from F's end position
			if (rnd.chance(0.5)) this.tag(this.connectorPut([{ item: eid, ...this.anchor() }, this.endpoint()]), 'keep-conn:bind-removed')
		}
		this.tag(keepOp, 'keep-conn:keep')
		if (!removeFirst) removeE()
	}

	connectorStyle(touched) {
		const pick = this.pickItem(touched, ['connector'])
		if (!pick) return
		const p = rnd.pick([{ 'data.route': rnd.pick(ROUTES) }, { 'style.startCap': rnd.pick(CAPS) }, { 'style.endCap': rnd.pick(CAPS) },
			{ 'style.stroke': this.color() }, { 'style.strokeWidth': rnd.int(1, 24) }, { 'style.dash': rnd.pick(DASHES) }, { 'data.label': this.words(2) }])
		this.enqueue({ o: 'patch', id: pick[0], p })
	}

	delRevive(touched, sameBatch, types = CONTENT) {
		const pick = this.pickItem(touched, types)
		if (!pick) return
		const [id, it] = pick
		const p = { x: it.x, y: it.y, w: it.w, h: it.h, r: it.r, z: it.z, parent: it.parent, data: structuredClone(it.data), style: structuredClone(it.style) }
		const revive = { o: 'put', id, t: it.t, revive: true, p }
		this.enqueue({ o: 'remove', id })
		if (sameBatch) this.enqueue(revive)
		else this.pendingRevive = revive
	}

	zMove(touched) {
		const pick = this.pickItem(touched)
		if (!pick) return
		this.enqueue({ o: 'patch', id: pick[0], p: { z: zKey(rnd.int(0, 1300)) } })
	}

	unknownField(touched) {
		const pick = this.pickItem(touched)
		if (!pick) return
		const v = rnd.pick([this.words(1), [1, 'zwei', { drei: 3 }], { k: { v: rnd.int(1, 9) } }, null, {}])
		this.enqueue({ o: 'patch', id: pick[0], p: { [rnd.pick(['data.tag', 'data.meta.note', 'style.border'])]: v } })
	}

	noop(touched) {
		const pick = this.pickItem(touched, CONTENT)
		if (!pick) return
		this.enqueue({ o: 'patch', id: pick[0], p: { 'data.text': pick[1].data?.text ?? '' } })
	}

	/** An op the server must refuse with `bad` (§4.8 rules 18 and size); never checked as ok. */
	badOp(touched) {
		const shape = this.live('shape').filter(([id]) => !touched.has(id))
		const ops = [
			{ o: 'put', id: ulid(), t: 'shape', p: { x: 0, y: 0, w: 100, h: 100, r: 0, z: zKey(rnd.int(0, 1300)), parent: null, data: { kind: 'star' }, style: {} } },
			{ o: 'put', id: ulid(), t: 'text', p: { x: 0, y: 0, w: 100, h: 30, r: 0, z: zKey(rnd.int(0, 1300)), parent: null, data: { text: 'x' }, style: { fontSize: 401 } } },
			{ o: 'put', id: ulid(), t: 'pen', p: { x: 0, y: 0, w: 10, h: 10, r: 0, z: zKey(rnd.int(0, 1300)), parent: null } },
		]
		if (shape.length) {
			const [id] = rnd.pick(shape)
			touched.add(id)
			ops.push({ o: 'patch', id, p: { w: 5 } }, { o: 'patch', id, p: { 'style.dash': 'wavy' } })
		}
		this.enqueue(rnd.pick(ops))
	}
}

/**
 * The order of transformItems (§6.5.2) in the acknowledged batches: ok keep
 * patches of frames (frameResize) and the ok ops AFTER them in the same batch
 * that place an item into that frame (adopt) or are a membership patch of it
 * that releases a child (release). followed = keep patches with at least one.
 */
function keepThenMembers(list) {
	const isKeep = (op) => clients.some((c) => c.keepOps.has(op))
	const memberOf = (op) => clients.find((c) => c.memberOps.has(op))?.memberOps.get(op) ?? null
	const out = { keeps: 0, followed: 0, adopt: 0, release: 0 }
	for (const b of list) {
		b.ops.forEach((op, i) => {
			if (b.res[i] !== 'ok' || op.o !== 'patch' || op.keep !== true || !isKeep(op)) return
			out.keeps++
			let n = 0
			for (let j = i + 1; j < b.ops.length; j++) {
				const o = b.ops[j]
				if (b.res[j] !== 'ok' || (o.o !== 'patch' && o.o !== 'put') || !o.p || !('parent' in o.p)) continue
				if (o.p.parent === op.id) { out.adopt++; n++ } else if (o.p.parent === null && memberOf(o) === op.id) { out.release++; n++ }
			}
			if (n > 0) out.followed++
		})
	}
	return out
}

/**
 * ok ops per workload tag (SimClient.tag) in the acknowledged batches; keepConn
 * counts the batches in which a keep patch of keepConnector and the removal of
 * the frame child – before (`first`) or after (`after`) it – were both ok.
 */
function tagCounts(list) {
	const tagOf = (op) => {
		for (const c of clients) if (c.tags.has(op)) return c.tags.get(op)
		return null
	}
	const ops = {}
	const keepConn = { first: 0, after: 0 }
	for (const b of list) {
		const seen = new Set()
		b.ops.forEach((op, i) => {
			if (b.res[i] !== 'ok') return
			const tg = tagOf(op)
			if (!tg) return
			ops[tg] = (ops[tg] || 0) + 1
			seen.add(tg)
		})
		if (seen.has('keep-conn:keep') && seen.has('keep-conn:remove-first')) keepConn.first++
		if (seen.has('keep-conn:keep') && seen.has('keep-conn:remove-after')) keepConn.after++
	}
	return { ops, keepConn }
}

// ── fault injection ──────────────────────────────────────────────────────
/** Purges of the fault `purge` (R19): {at, rev, minRevBefore, minRev, tombstones, ids}. */
const purges = []
/** Interval of the fault `purge` (SPEC-M1 §8.6 R19: every 10 s). */
const PURGE_EVERY_MS = 10000

/**
 * The fault `purge` (SPEC-M1 §8.6 R19, T4-14): Stack.purgeTombstones(b, 0)
 * – backdating by SQL, then occ knorke:compact --board without --now. The
 * purged ids are the tombstones before that are no row at all after it.
 */
async function purgeFault() {
	let info = ''
	try {
		const before = (await stack.sql(`SELECT id FROM oc_knorke_items WHERE board_id = ${board} AND deleted = 1;`)).map(([id]) => id)
		const r = await stack.purgeTombstones(board, 0)
		const after = new Set((await stack.sql(`SELECT id FROM oc_knorke_items WHERE board_id = ${board};`)).map(([id]) => id))
		const ids = before.filter((id) => !after.has(id))
		purges.push({ at: Date.now(), rev: r.rev, minRevBefore: r.minRevBefore, minRev: r.minRev, tombstones: r.tombstones, ids })
		info = `${r.tombstones} Grabsteine in ${r.blocks} Block(en), min_rev ${r.minRevBefore} → ${r.minRev}, rev ${r.rev}`
	} catch (e) {
		info = 'Fehler: ' + e.message
	}
	faultLog.push({ at: new Date().toTimeString().slice(0, 8), kind: 'purge', info })
}

async function injectFault(k) {
	const basic = ['del-r', 'lower-r', 'del-p']
	const full = [...basic, 'del-access', 'del-all']
	const list = FAULTS === 'full' ? full : basic
	const kind = list[k % list.length]
	let info = ''
	try {
		if (kind === 'del-r') info = (await stack.redisDel(rkey(`r:${board}`))).length + ' Schlüssel'
		else if (kind === 'lower-r') {
			const cur = await stack.redisGet(rkey(`r:${board}`))
			if (cur) {
				const v = Math.max(0, Number(cur.value) - 3)
				await stack.redis('SET', cur.key, String(v), 'EX', '30')
				info = `${cur.value} → ${v} (EX 30)`
			} else info = 'r: fehlte'
		} else if (kind === 'del-p') info = (await stack.redisDel(rkey(`p:${board}`))).length + ' Schlüssel'
		else if (kind === 'del-access') info = (await stack.redisDel(rkey(`a:${board}`), rkey(`g:${board}:*`))).length + ' Schlüssel'
		else if (kind === 'del-all') info = (await stack.redisDel('*/knorke/*')).length + ' Schlüssel'
	} catch (e) {
		info = 'Fehler: ' + e.message
	}
	faultLog.push({ at: new Date().toTimeString().slice(0, 8), kind, info })
}

// ── main ─────────────────────────────────────────────────────────────────
let skipBumpSet = false
let exitCode = 1
try {
	// stand-in epoch until a snapshot names one (lib/http.mjs)
	env.epoch = (await stack.epoch()) || undefined
	const alice = await new Client(env, 'alice').login('alice')
	const bob = await new Client(env, 'bob').login('bob')
	await stack.bruteforceReset().catch(() => {})
	const cr = await alice.createBoard('converge ' + new Date().toISOString().slice(0, 19))
	if (cr.status !== 201) throw new Error(`Board anlegen: ${brief(cr)}`)
	board = cr.data.board.id
	const lr = await alice.enableLink(board, false)
	if (lr.status !== 200) throw new Error(`Link: ${brief(lr)}`)
	link = lr.data.link.token
	const jr = await bob.joinLink(link)
	if (jr.status !== 200) throw new Error(`bob Link-Beitritt: ${brief(jr)}`)
	clients.push(new SimClient(alice, 'alice'), new SimClient(bob, 'bob'))
	for (const name of ['Gina', 'Gustav', 'Greta', 'Gerd']) {
		const g = new Client(env, name, { kind: 'guest' })
		const r = await g.joinGuest(link, name, { client: clientId() })
		if (r.status !== 200) throw new Error(`Gast ${name}: ${brief(r)}`)
		clients.push(new SimClient(g, name))
	}
	for (const c of clients) await c.load()
	if (FAULTS === 'full') {
		skipBumpSet = true
		await skipBump(true)
		// read back: the report shows that the lost-bump fault was really on
		faultLog.push({ at: new Date().toTimeString().slice(0, 8), kind: 'skip-bump', info: `knorke_dev_skip_bump = ${await stack.occ('config:system:get', 'knorke_dev_skip_bump')}` })
	}
	console.log(`converge: Board ${board}, ${clients.length} Clients, ${SECS} s, Fehler ${FAULTS}, Mix ${MIX}${CONNECTORS ? ' + Verbinder' : ''}, Seed ${SEED}, DB ${stack.dbLabel}`)

	const loops = clients.map((c) => c.loop().catch((e) => protocolErrors.push({ client: c.name, problem: 'Schleife abgebrochen', error: String(e?.stack || e).slice(0, 400) })))
	const tEnd = Date.now() + SECS * 1000
	let k = 0
	let nextPurge = Date.now() + PURGE_EVERY_MS
	while (Date.now() < tEnd) {
		await sleep(Math.min(5000, tEnd - Date.now()))
		if (FAULTS !== 'none' && Date.now() < tEnd) await injectFault(k++)
		// stage 4 (R19, T4-14): purge every 10 s in --faults full
		if (FAULTS === 'full' && Date.now() >= nextPurge && Date.now() < tEnd) {
			await purgeFault()
			nextPurge += PURGE_EVERY_MS
		}
	}

	// quiet: stop acting, drain queues
	// a pending revive goes out through the loop (flushRevive)
	for (const c of clients) { c.acting = false; c.editing = null }
	if (skipBumpSet) {
		await skipBump(false)
		skipBumpSet = false
		faultLog.push({ at: new Date().toTimeString().slice(0, 8), kind: 'skip-bump', info: `knorke_dev_skip_bump = ${await stack.occ('config:system:get', 'knorke_dev_skip_bump').catch(() => '(gelöscht)')}` })
	}
	const tq = Date.now()
	while (Date.now() - tq < 30000 && clients.some((c) => c.queue.length || c.inflight || c.pendingRevive)) await sleep(200)
	const drained = !clients.some((c) => c.queue.length || c.inflight || c.pendingRevive)

	// catch-up: every cursor reaches the snapshot rev, and the rev stays put
	let final = null
	let target = -1
	const tc = Date.now()
	for (let round = 0; round < 8 && Date.now() - tc < 70000; round++) {
		const s = await alice.snapshot(board)
		if (s.status !== 200) throw new Error(`Snapshot: ${brief(s)}`)
		final = s.data
		if (final.rev === target && clients.every((c) => c.cursor === target)) break
		target = final.rev
		while (Date.now() - tc < 70000 && clients.some((c) => c.cursor < target)) await sleep(250)
		await sleep(1000)
	}
	for (const c of clients) c.running = false
	await Promise.race([Promise.allSettled(loops), sleep(20000)])

	const snapKeys = snapshotKeys(final)
	// ids of the fault purge (§4.13.7 "Folgen", R19/R20 K1), filled by K3 and reported in its note: deviations
	// taken because the code was the one of "Folgen", and the ops whose code was it
	const purgedDevs = []
	const folgen = { ok: 0, gone: 0, bad: 0 }
	const log = await stack.changesJson(board)
	const rows = log.rows
	const sqlCount = await stack.changeCount(board)
	const batches = clients.flatMap((c) => c.acks)

	await suite.run('K0', 'Lauf: Last, Abarbeitung, keine Protokollfehler', async (t) => {
		const okOps = batches.reduce((a, b) => a + b.res.filter((x) => x === 'ok').length, 0)
		t.check(okOps >= 50, 'genug wirksame Ops (≥ 50 ok)', okOps)
		t.check(drained, 'alle Warteschlangen geleert')
		t.check(protocolErrors.length === 0, 'keine Protokollfehler (unerwartete 4xx/acks)', protocolErrors.slice(0, 5))
		t.check(clients.every((c) => c.cursor === final.rev), 'alle Cursor = Snapshot-rev', clients.map((c) => [c.name, c.cursor, final.rev]))
		const codes = {}
		for (const c of clients) for (const [k2, v] of Object.entries(c.stats.codes)) codes[k2] = (codes[k2] || 0) + v
		const types = {}
		for (const it of final.items) types[it.t] = (types[it.t] || 0) + 1
		const okKinds = {}
		for (const b of batches) b.ops.forEach((op, i) => {
			if (b.res[i] !== 'ok') return
			const k = op.o === 'put' ? `put ${op.t}` : op.o === 'patch' ? (op.keep === true ? 'patch keep' : 'w' in op.p || 'r' in op.p ? 'patch transform' : 'patch') : op.o
			okKinds[k] = (okKinds[k] || 0) + 1
		})
		t.note(`Ergebniscodes ${JSON.stringify(codes)}; Batches ${batches.length}; Objekte am Ende ${final.items.length} ${JSON.stringify(types)}; rev ${final.rev}`)
		t.note(`ok-Ops nach Art ${JSON.stringify(okKinds)}`)
		if (MIX === 'm1') {
			t.check(['put shape', 'put text', 'patch transform', 'patch keep'].every((k) => okKinds[k] > 0), 'M1-Mix wirkt: Formen, Text, Transforms und keep je mindestens einmal ok', okKinds)
			const kt = keepThenMembers(batches)
			t.note(`keep zur Op-Zeit (R9): ${kt.keeps} ok keep-patches von Frames, davon ${kt.followed} mit späterer Übernahme/Freigabe desselben Frames im selben Batch (${kt.adopt} Übernahmen, ${kt.release} Freigaben danach)`)
			t.check(kt.followed > 0, 'keep-patch, danach Übernahme oder Freigabe desselben Frames im selben Batch (Reihenfolge von transformItems, §6.5.2) mindestens einmal ok', kt)
		}
		if (CONNECTORS) {
			// SPEC-M1 §8.6, round 1b: what the connector workload reached (from the log rows of the
			// acknowledged batches and the workload tags); every kind must have happened at least once
			const sourceOf = (op, side) => {
				const v = op.o === 'put' ? op.p?.data?.[side] : op.p?.['data.' + side]
				return v && typeof v === 'object' ? clients.find((c) => c.epSource.has(v))?.epSource.get(v) ?? null : null
			}
			const cs = connectorStats(rows, batches, { sourceOf })
			const tags = tagCounts(batches)
			t.note(`Verbinder: ${types.connector || 0} am Ende; ok: ${cs.puts} angelegt, ${cs.retargets} umgehängt, ${cs.boundEnds} gebundene Enden gesendet; freier Punkt statt Bindung: ${cs.ontoRemovedInBatch} auf ein im selben Batch entferntes Ziel, ${cs.ontoTombstone} auf einen Grabstein (davon ${cs.ontoTombstoneForeign} von einem anderen Client entfernt, ${cs.ontoTombstoneStale} beim Senden im Spiegel noch lebend = gleichzeitig entfernt); Freigaben am Batch-Ende: ${cs.releasedInBatch} im eigenen Batch, ${cs.releasedDerived} abgeleitete Zeilen (Verbinder, die der Batch nicht anfasste)`)
			t.note(`Verbinder-Tags (ok): ${JSON.stringify(tags.ops)}; keep mit Verbinder: ${tags.keepConn.first} Batches „entfernen, dann keep“, ${tags.keepConn.after} „keep, dann entfernen“`)
			t.check(cs.puts > 0 && cs.retargets > 0, 'Verbinder angelegt und umgehängt (je mindestens einmal ok)', cs)
			t.check(cs.ontoRemovedInBatch > 0, 'Ende auf ein im selben Batch entferntes Ziel → freier Punkt am Ankerpunkt (mindestens einmal)', cs)
			t.check(cs.ontoTombstone > 0 && cs.ontoTombstoneForeign > 0, 'Ende auf einen Grabstein (in einem früheren Batch entfernt, auch von einem anderen Client) → freier Punkt (je mindestens einmal)', cs)
			t.check(cs.releasedDerived > 0 && (tags.ops['del-bound'] || 0) > 0, 'gebundene Objekte gelöscht: der Server gibt fremde Verbinder frei (abgeleitete Zeilen, mindestens einmal)', { releasedDerived: cs.releasedDerived, delBound: tags.ops['del-bound'] || 0 })
			t.check((tags.ops['client-release'] || 0) > 0, 'Client-Lösung vor dem remove (deleteItems v2) mindestens einmal ok', tags.ops)
			t.check(tags.keepConn.first > 0 && tags.keepConn.after > 0, 'keep mit Verbinder: beide Reihenfolgen (Ziel vor bzw. nach dem keep-patch entfernt) je mindestens einmal ok', tags.keepConn)
		}
		if (FAULTS === 'full') {
			// SPEC-M1 §8.6 (R19, T4-14): at least one purge that raised min_rev
			t.check(purges.some((p) => p.minRev > p.minRevBefore), 'Fehler purge: mindestens eine Bereinigung mit gestiegenem min_rev (§8.6 R19)', purges.map((p) => ({ minRevBefore: p.minRevBefore, minRev: p.minRev, tombstones: p.tombstones, rev: p.rev })))
			t.note(`Bereinigungen: ${purges.map((p) => `${p.tombstones} Grabsteine, min_rev ${p.minRevBefore} → ${p.minRev}`).join('; ') || 'keine'}`)
		}
		t.note('Clients ' + clients.map((c) => `${c.name}: ${c.stats.requests} Anfr., ${c.stats.failures} Fehl., ${c.stats.resyncs} Resync, ${c.stats.more} more`).join('; '))
		t.note('Fehler ' + faultLog.map((f) => `${f.at} ${f.kind} (${f.info})`).join(', '))
	})

	await suite.run('K1', 'Prüfung 1: jeder Spiegel = Snapshot', async (t) => {
		for (const c of clients) {
			const d = diffKeys(c.mirror.keys(), snapKeys, c.name, 'Snapshot')
			t.check(d.length === 0, `${c.name}: 0 Abweichungen`, { n: d.length, first: d.slice(0, 3) })
		}
	})

	await suite.run('K2', 'Prüfung 2: Nachspielen des changes-Logs = Snapshot', async (t) => {
		const rp = replayChanges(rows)
		const d = diffKeys(replayKeys(rp), snapKeys, 'Log', 'Snapshot')
		t.check(rows.length > 0, 'changes-Log nicht leer', rows.length)
		t.check(log.count === rows.length && sqlCount === rows.length, 'exakter Log-Leser: COUNT(*) der NC-Verbindung = gelesene Zeilen = Zählung des SQL-Seitenkanals', { count: log.count, rows: rows.length, sql: sqlCount })
		t.check(rp.problems.length === 0, 'Log lässt sich nachspielen', rp.problems.slice(0, 5))
		t.check(d.length === 0, '0 Abweichungen Log ↔ Snapshot', { n: d.length, first: d.slice(0, 3) })
		// R19 (T4-14): purged objects end "removed" in the replay, like in the snapshot
		const purged = [...new Set(purges.flatMap((p) => p.ids))].filter((id) => !snapKeys.has(id))
		if (purges.length) {
			const bad = purged.filter((id) => rp.live.has(id) || !rp.dead.has(id))
			t.check(bad.length === 0, `bereinigte Objekte (${purged.length}) enden im Nachspielen mit „entfernt“ und fehlen im Snapshot`, bad.slice(0, 5))
		}
	})

	await suite.run('K3', 'Prüfung 3: jede ok-Op wirkt bei ihrem rev (nach Server-Normalisierung)', async (t) => {
		const d = checkOps(rows, batches, { fourByte: stack.supports4Byte, purges, onPurged: (x) => purgedDevs.push(x), onFolgen: (x) => { folgen[x.code]++ } })
		if (purges.length) t.note(`Ops an bereinigten IDs mit dem Code aus §4.13.7 „Folgen“: ok ${folgen.ok}, gone ${folgen.gone}, bad ${folgen.bad}; Abweichungen daran mit diesem Code (nicht gezählt): ${purgedDevs.length}${purgedDevs.length ? ' – ' + JSON.stringify(purgedDevs.slice(0, 3)) : ''}; ein anderer Code zählt als Abweichung (R20, K1)`)
		const n = batches.reduce((a, b) => a + (b.rev === null ? 0 : b.res.filter((x) => x === 'ok').length), 0)
		t.check(n > 0, 'ok-Ops vorhanden', n)
		t.check(d.length === 0, '0 Abweichungen', { n: d.length, first: d.slice(0, 5) })
		t.note(`${n} ok-Ops in ${batches.filter((b) => b.rev !== null).length} Batches geprüft (${stack.dbLabel}${stack.supports4Byte ? '' : ', Orakel fourByte = false'})`)
	})
	exitCode = suite.finish({ ns: env.ns, board, seed: SEED, secs: SECS, faults: FAULTS, mix: MIX, connectors: CONNECTORS, db: stack.dbLabel, nextcloud: env.versions?.nextcloud })

	if (!KEEP) await alice.deleteBoard(board).catch(() => {})
} catch (e) {
	console.error(`converge: Abbruch – ${e?.stack || e}`)
	await suite.run('KX', 'Abbruch des Laufs', async () => { throw e })
	suite.finish({ ns: env.ns, board, seed: SEED, faults: FAULTS, db: stack.dbLabel, abort: String(e?.message || e) })
	exitCode = 1
} finally {
	for (const c of clients) c.running = false
	if (skipBumpSet) await skipBump(false).catch(() => {})
	await stack.bruteforceReset().catch(() => {})
}
process.exit(exitCode)

