/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Frozen tables of the load run (SPEC-M1 §8.7, stage 4, phase 0), pure – no
 * I/O, no clock unless a caller passes one:
 *
 * - SCENARIOS  S1, S4, S4e, S4d, S5, SF, SC (ids, sizes, windows, what they gate)
 * - WORKSHOP   the S4 workload mix (a reading of §8.7, tunable in phase 2;
 *              the report states the mix a run really produced)
 * - INTERVALS  the client cadence of SPEC-M0 §6.4 (never scaled)
 * - VARIANTS   the states dev/load/variant.sh sets (env.json .load.variant)
 * - FAULTS     the SF fault list of §8.7 in its fixed order
 * - GATE_S4    the pass rules of S4 (§8.7 "Bestehensregeln S4"), S5/SF/SC rules
 * - report names (§9.0 point 2): <scenario>-<variant>[-<label>].{json,md}
 * - seeded randomness: one mulberry32 stream per actor (dev/sim/lib/gen.mjs),
 *   seeded ULIDs, so a seed reproduces every actor's decisions
 * - the cold-start arrival model of SC (85 requests per editor page, 34 per
 *   tablet page, devices spread over 30/60/120 s)
 */
import { prng, zKey } from '../../sim/lib/gen.mjs'

const deepFreeze = (o) => {
	for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v)
	return Object.freeze(o)
}

/** Client cadence of SPEC-M0 §6.4 (src/sync/scheduler.js INTERVALS); the load run never scales it. */
export const INTERVALS = deepFreeze({
	activeMs: 400, jitterMs: 50, idleMs: 1000, viewMs: 2000, activeWindowMs: 5000, commitGapMs: 150,
	backoffMs: [1000, 2000, 4000, 8000, 15000],
})

/** Board of §8.7: 3000 notes + 500 shapes + 800 connectors + 20 frames. */
export const BOARD = deepFreeze({ notes: 3000, shapes: 500, connectors: 800, frames: 20 })

/**
 * The S4 workload (§8.7). Numbers that §8.7 states are marked; the rest is
 * this package's reading, frozen as defaults and reported per run:
 * - draggerShare 1/3, dragsPerMin 2–4, commit on release (§8.7)
 * - hot: 20 objects take ≈ 30 % of the ops (§8.7)
 * - createDelete ≈ 20 % of the actions, shapes and connectors included (§8.7)
 * - text with a lease (me.e), transforms, cursor every tick (§8.7)
 * - vote: tablets every 15–45 s (§8.7); editorsVoteShare = share of the
 *   non-moderator editors that switch to mode vote while the session is open
 *   and then send no `me` (§8.7 R2 names the rule, not the share – reading)
 */
export const WORKSHOP = deepFreeze({
	draggerShare: 1 / 3,
	dragsPerMin: [2, 4],
	dragMs: [1500, 4500],
	actionEveryMs: [3000, 8000],
	mix: [[45, 'text'], [20, 'createDelete'], [20, 'transform'], [15, 'style']],
	createKinds: [[50, 'sticky'], [25, 'shape'], [25, 'connector']],
	hot: { count: 20, share: 0.3 },
	textEdits: [2, 5],
	textGapMs: [600, 1400],
	editorsVoteShare: 1 / 3,
	tabletVoteEveryS: [15, 45],
	firstVoteS: [2, 15],
	vote: { per: 5, perItem: 2, scope: null, types: ['sticky'], minutes: null },
	timerMs: 600000,
	viewportEveryMs: 3000,
})

const S4_BASE = {
	editors: 30, guests: 5, tablets: 100, warmupS: 15, windowS: 90,
	workload: 'workshop', moderator: true, vote: { openS: 20, closeS: 80 }, checks: true,
}

/**
 * Scenario table of §8.7. `gate`: what decides the run's exit code –
 * 's4' (rules GATE_S4), 's5' (S5 rules), 'sf', 'sc', or null (report only).
 */
export const SCENARIOS = deepFreeze({
	S1: { title: '30 Bearbeiter untätig (1-s-Takt) + 100 Tablets (2 s)', editors: 30, guests: 5, tablets: 100, warmupS: 15, windowS: 90, workload: 'idle', moderator: false, vote: null, checks: false, gate: null },
	S4: { ...S4_BASE, title: 'Workshop: 30 Bearbeiter + 100 Tablets, Moderator, Abstimmung t = 20–80 s', gate: 's4' },
	S4e: { ...S4_BASE, title: 'S4 durch echten Traefik (127.0.0.1:18601)', via: 'traefik', gate: 's4e' },
	S4d: { ...S4_BASE, title: 'S4 mit dbpersistent + PG max_connections 200', requiresVariant: 'dbpersistent', gate: null },
	S5: { ...S4_BASE, title: 'Knie: Bearbeiter 30 → 45 → 60 → 75 → 90 je 60 s + 100 Tablets', vote: null, steps: [30, 45, 60, 75, 90], windowS: 60, quietS: 10, gate: 's5' },
	SF: { ...S4_BASE, title: 'S4 + Fehlereinspielung, knorke_dev = true', windowS: 240, faults: true, knorkeDev: true, gate: 'sf' },
	SC: { ...S4_BASE, title: 'Kaltstart: Seiten über 30/60/120 s verteilt (Modell) + direkt 60 s, dann 30 s S4', windowS: 30, vote: null, spreadsS: [30, 60, 120], spreadS: 60, editorPageRequests: 85, tabletPageRequests: 34, gate: 'sc' },
})
export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS))

/** States of dev/load/variant.sh (env.json .load.variant). app-off-<id>: one app of the prod set disabled (E1). */
export const VARIANT_RE = /^(base|dbpersistent|app-off-[a-z0-9_]{1,32})$/

/** SF faults (§8.7) in their fixed order; every docker action only on the namespace's own containers. */
export const FAULTS = deepFreeze([
	{ id: 'skip-bump', title: 'verlorenes Hochziehen (knorke_dev_skip_bump 0,2)', holdS: 20 },
	{ id: 'rev-del', title: 'r:<b> löschen' },
	{ id: 'rev-lower', title: 'r:<b> senken' },
	{ id: 'presence-del', title: 'p:<b> löschen' },
	{ id: 'gens-del', title: 'a:<b> und g:<b>:* löschen' },
	{ id: 'all-del', title: 'alle */knorke/* auf einmal löschen' },
	{ id: 'epoch-rotate', title: 'Epoche drehen (occ knorke:epoch:rotate)' },
	{ id: 'redis-restart', title: 'Redis-Neustart (einmal)' },
	{ id: 'db-pause', title: 'DB 3 s pausieren (docker pause)', holdS: 3 },
])
export const FAULT_IDS = Object.freeze(FAULTS.map((f) => f.id))

/** Pass rules of S4 (§8.7), thresholds as numbers; rule numbers as in the spec table. */
export const GATE_S4 = deepFreeze({
	edge: { meanRpsMax: 153.8, max10sRpsMax: 200, minTokensMin: 280, rejected: 0 },
	latencyP95Ms: { syncEmpty: 50, syncItems: 80, syncOps: 120, syncVote: 120, snapshot: 500 },
	p99OverP95Max: 2, latencyMaxMs: 2000,
	cpu: { ncPgCoresHard: 6.6, ncPgCoresTarget: 5.0, msPerRequestMax: 40 },
	apacheBusyMax: 60, pgBackendsMax: 80,
	presence: { cursorLagP95Ms: 1500, blobMaxBytes: 150 * 1024, followLagMs: 2500 },
	bandwidthWarnBytesPerS: 2 * 1024 * 1024,
	allowed4xx: ['locked', 'gone', 'dup', 'limit', 'closed'],
})
export const GATE_S5 = deepFreeze({ at: 45, p95Ms: 100, kneeP95Ms: 300, kneeErrorShare: 0.01 })
export const GATE_SF = deepFreeze({ recoveryS: 35, fiveXxWindowS: 5 })
export const GATE_SC = deepFreeze({ spreadS: 60, rejected: 0 })
/**
 * Requests per page of M0 (SPEC-M1 §8.4 E12: 85 signed in, 34 guest page /
 * vote link): SC's model uses them only when load.mjs gets no
 * --page-requests, and then the report says "nicht gemessen" (§8.7 R19, T4-11).
 */
export const PAGE_REQUESTS_M0 = deepFreeze({ editor: 85, tablet: 34 })
/**
 * E12 of stage 4 phase 1 with the M1 bundle (SPEC-M1 §31, docs/ENTWICKLUNG
 * E12: signed in 85, vote link on the tablet 31; first run 13.10.2026 in `d`):
 * the SC report names them beside the M0 reference, never as one pair
 * "E12/M0" (§8.7 "die E12-Werte daneben", W3E-09).
 */
export const PAGE_REQUESTS_E12 = deepFreeze({ editor: 85, tablet: 31 })
/** The write budget's fixed window (lib/Service/Limits.php BUDGET_WINDOW_MS, SPEC-M1 §4.13.6): key suffix = floor(now / 10000). */
export const BUDGET_WINDOW_MS = 10000

// --- report names (SPEC-M1 §9.0 point 2) ---------------------------------------

/** Run label (KD_RUN_LABEL), as for upgrade.sh and the scene lab. */
export const LABEL_RE = /^[a-z0-9-]{1,24}$/
/** File stem of a run report: <scenario lower case>-<variant>[-<label>]. */
export const STEM_RE = /^(s1|s4|s4e|s4d|s5|sf|sc)-(base|dbpersistent|app-off-[a-z0-9_]{1,32})(-[a-z0-9-]{1,24})?$/

/**
 * Stems of one run: `stem` is the file of THIS run (with the label), `latest`
 * the copy that always holds the last run of this scenario and variant.
 * @param {{scenario: string, variant?: string, label?: string}} o
 * @return {{stem: string, latest: string}}
 */
export function reportStem({ scenario, variant = 'base', label = '' }) {
	if (!SCENARIO_IDS.includes(scenario)) throw new Error(`Szenario '${scenario}' ist unbekannt (${SCENARIO_IDS.join(', ')})`)
	if (!VARIANT_RE.test(variant)) throw new Error(`Variante '${variant}' ist ungültig (${VARIANT_RE})`)
	if (label && !LABEL_RE.test(label)) throw new Error(`KD_RUN_LABEL '${label}' ist ungültig (${LABEL_RE})`)
	const latest = `${scenario.toLowerCase()}-${variant}`
	return { stem: label ? `${latest}-${label}` : latest, latest }
}

// --- seeded randomness -------------------------------------------------------

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** A uint32 seed from (seed, stream): every actor draws from its own stream. */
export function streamSeed(seed, stream) {
	let h = (seed >>> 0) ^ Math.imul(stream + 1, 0x9E3779B1)
	h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B)
	h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35)
	return (h ^ (h >>> 16)) >>> 0
}

/**
 * Seeded random helpers of one stream (gen.mjs prng plus ids).
 * @param {number} seed
 * @param {number} stream
 */
export function rngFor(seed, stream) {
	const r = prng(streamSeed(seed, stream))
	return {
		...r,
		/** ULID with the given time and 16 seeded characters (Crockford base32). */
		ulid(now) {
			let t = now
			let s = ''
			for (let i = 0; i < 10; i++) { s = CROCK[t % 32] + s; t = Math.floor(t / 32) }
			for (let i = 0; i < 16; i++) s += CROCK[Math.floor(r.next() * 32)]
			return s
		},
		/** Client id 'c' + 9 alphanumerics (§4.5 regex). */
		clientId(prefix = 'c') {
			let s = prefix
			for (let i = 0; i < 9; i++) s += ALNUM[Math.floor(r.next() * ALNUM.length)]
			return s.slice(0, 16)
		},
		/** Weighted pick from [[weight, value], …]. */
		weighted(rows) {
			const total = rows.reduce((a, [w]) => a + w, 0)
			let x = r.next() * total
			for (const [w, v] of rows) { if ((x -= w) < 0) return v }
			return rows[rows.length - 1][1]
		},
	}
}

/** The first n decisions of an actor's stream (pins reproducibility in the self-test). */
export function decisionTrace(seed, stream, n = 16) {
	const r = rngFor(seed, stream)
	return Array.from({ length: n }, () => [r.weighted(WORKSHOP.mix), Math.round(r.range(...WORKSHOP.actionEveryMs))])
}

/** z keys for the seed board: strictly increasing, valid (gen.mjs zKey). */
export const seedZ = (i) => zKey(i)

// --- sizes -------------------------------------------------------------------

/**
 * Actor counts of a scenario run. Editors include the moderator (S4: 1
 * moderator + 24 account editors + 5 guest editors = 30, plus 100 tablets =
 * the 130 mirrors of K1). --scale multiplies, never below 1 where the base is > 0.
 * @param {object} sc   SCENARIOS entry
 * @param {{scale?: number, editors?: number}} o  editors: override (S5 steps)
 */
export function actorCounts(sc, { scale = 1, editors = null } = {}) {
	const s = (n) => (n <= 0 ? 0 : Math.max(1, Math.round(n * scale)))
	const ed = editors === null ? s(sc.editors) : editors
	const guests = Math.min(s(sc.guests), Math.max(0, ed - (sc.moderator ? 1 : 0)))
	const moderator = sc.moderator && ed > 0 ? 1 : 0
	return { editors: ed, moderator, accounts: Math.max(0, ed - guests - moderator), guests, tablets: s(sc.tablets) }
}

/**
 * Times of a scenario run in ms relative to the window start. Workload
 * periods (drags, actions, votes, viewport moves) scale with secs/windowS so
 * a short self-test run still sees every event; the client cadence never scales.
 */
export function timeline(sc, secs) {
	const k = secs / sc.windowS
	return {
		k,
		windowMs: Math.round(secs * 1000),
		voteOpenMs: sc.vote ? Math.round(sc.vote.openS * 1000 * k) : null,
		voteCloseMs: sc.vote ? Math.round(sc.vote.closeS * 1000 * k) : null,
	}
}

// --- cold start (SC) ---------------------------------------------------------

/**
 * Arrival times (ms) of the cold start of SC as the edge would see them: each
 * device opens its page at a uniform random moment within spreadS, and its
 * page's requests arrive within pageMs after that (85 for an editor's board
 * page, 34 for a tablet's vote page, measured in M0/R-A).
 */
export function coldStartArrivals({ editors, tablets, spreadS, editorReqs = 85, tabletReqs = 34, pageMs = 2000, seed = 1 }) {
	const r = rngFor(seed, 9999)
	const out = []
	const page = (n) => {
		const t0 = r.range(0, spreadS * 1000)
		for (let i = 0; i < n; i++) out.push(t0 + r.range(0, pageMs))
	}
	for (let i = 0; i < editors; i++) page(editorReqs)
	for (let i = 0; i < tablets; i++) page(tabletReqs)
	return out.sort((a, b) => a - b)
}
