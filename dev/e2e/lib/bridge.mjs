/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Container side of the host bridge (SPEC-M0 §8.2, hostbridge.sh): writes
 * <out>/bridge/<n>.req atomically (tmp + rename), waits for <n>.res. The host
 * runs only its whitelist; this side knows nothing about docker.
 *
 * <out> is the run's output dir of ONE namespace (round 2 U3): KD_E2E_OUT
 * (run.sh mounts dev/e2e/out/<ns> at /out), else dev/e2e/out/<KD_NS>.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Namespaces that are no namespace (SPEC-M1 §8.1): the folders of the pre-R5
 * report layout. Same list as KD_RESERVED_NS in dev/lib.sh and RESERVED_NS in
 * dev/sim/lib/report.mjs (this file runs in the container, where only
 * dev/e2e is mounted, so it keeps its own copy).
 */
export const RESERVED_NS = Object.freeze(['shots', 'report', 'bridge', 'out'])

export function outDir(env = process.env) {
	if (env.KD_E2E_OUT) return path.resolve(env.KD_E2E_OUT)
	const ns = env.KD_NS || 'main'
	if (!/^[a-z]{1,8}$/.test(ns)) throw new Error(`KD_NS='${ns}' ist ungültig`)
	if (RESERVED_NS.includes(ns)) throw new Error(`KD_NS='${ns}' ist reserviert (nicht erlaubt: ${RESERVED_NS.join(' ')})`)
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out', ns)
}

const DIR = path.join(outDir(), 'bridge')
const TIMEOUT_MS = 35000
/**
 * Actions that take longer than one 30-s command (hostbridge.sh): seed-board
 * sends up to 25 sync requests of 200 notes, each capped at 30 s on the host;
 * purge-tombstones (stage 4) runs occ knorke:compact --board for up to 120 s.
 */
export const ACTION_TIMEOUT_MS = Object.freeze({ 'seed-board': 180000, 'purge-tombstones': 150000 })
let counter = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Raw call: resolves the whole answer {ok, action, result|error, ms}; rejects
 * only when no answer comes in time.
 */
export async function bridgeRaw(action, ...args) {
	const n = String(++counter)
	const req = path.join(DIR, n + '.req')
	const res = path.join(DIR, n + '.res')
	fs.writeFileSync(req + '.tmp', JSON.stringify({ action, args: args.map(String) }))
	fs.renameSync(req + '.tmp', req)
	const t0 = Date.now()
	const limit = ACTION_TIMEOUT_MS[action] ?? TIMEOUT_MS
	while (Date.now() - t0 < limit) {
		if (fs.existsSync(res)) {
			const text = fs.readFileSync(res, 'utf8')
			fs.rmSync(res, { force: true })
			try {
				return JSON.parse(text)
			} catch {
				return { ok: false, action, error: 'Antwort ist kein JSON: ' + text.slice(0, 200) }
			}
		}
		await sleep(40)
	}
	fs.rmSync(req, { force: true })
	throw new Error(`Brücke: keine Antwort auf ${action} in ${limit / 1000} s (läuft hostbridge.sh?)`)
}

/** Call that returns the result or throws the bridge's error. */
export async function bridge(action, ...args) {
	const r = await bridgeRaw(action, ...args)
	if (!r.ok) throw new Error(`Brücke ${action} ${args.join(' ')}: ${r.error}`)
	return r.result
}
