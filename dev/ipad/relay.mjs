/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * App relay of the iPad measurement R-B (SPEC-M1 §8.8 (2) (c), Revision 19
 * T4-13; run only during the session with the user, R-B comes after stage 4):
 * a plain TCP relay from the host's LAN address to the dev stack `ipad`
 *
 *   <lanHost>:18612  →  127.0.0.1:18611   (Nextcloud of KD_NS=ipad)
 *
 *   node dev/ipad/relay.mjs [--hours N]     (N 0.05–8, default 2)
 *
 * - the LAN address is no constant and no argument: the CLI reads it from
 *   dev/.state/ipad/env.json of this repo copy (.ipad.lanHost, only with
 *   .ipad.profile === true), which `KD_NS=ipad KD_IPAD_PROFILE=1 dev/up.sh`
 *   writes from KD_LAN_HOST (environment or dev/local.env, docs/ENTWICKLUNG.md
 *   §3.10); no stack with the profile, no file, no field or an address that
 *   is no private IPv4 host address: exit 2, nothing listens
 * - binds ONLY that LAN address: never 0.0.0.0 or :: (the stack must not be
 *   reachable from anywhere else), never another port; the target is only
 *   127.0.0.1:18611 (the published port of the namespace ipad, dev/lib.sh)
 * - ends by itself after --hours (default 2), on SIGINT/SIGTERM at once, and
 *   then closes every open connection; afterwards `KD_NS=ipad dev/down.sh`
 * - no TLS, no HTTP parsing: bytes go through unchanged (the Host header
 *   <lanHost>:18612 is a trusted domain of the stack only with
 *   KD_IPAD_PROFILE=1, dev/up.sh)
 * - prints one line per connection (time, client address, bytes each way)
 *
 * startRelay() is exported for dev/selftest/ipad.test.mjs, which runs it on
 * 127.0.0.1 with kernel-chosen ports (the only other listen address it
 * accepts); the command line has no way to change addresses or ports.
 * startFailure() (the message of a failed start) is exported for the same test.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The relay port on the LAN address (SPEC-M1 §8.1 ports, §8.8 (2)). */
export const RELAY_PORT = 18612
/** The published Nextcloud port of the namespace ipad (dev/lib.sh default_port). */
export const TARGET_HOST = '127.0.0.1'
export const TARGET_PORT = 18611
export const HOURS_DEFAULT = 2
export const HOURS_MIN = 0.05
export const HOURS_MAX = 8

/** env.json of the namespace ipad in this repo copy (written by dev/up.sh). */
export const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.state', 'ipad', 'env.json')
const HINT = 'erst KD_NS=ipad KD_IPAD_PROFILE=1 dev/up.sh (mit KD_LAN_HOST, docs/ENTWICKLUNG.md §3.10)'

/**
 * A private IPv4 host address: four decimal parts 0–255 without leading
 * zeros, in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16, last part 1–254.
 * The rule of KD_LAN_HOST (dev/lib.sh valid_lan_host).
 * @param {unknown} host
 * @return {boolean}
 */
export function lanHostValid(host) {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(typeof host === 'string' ? host : '')
	if (!m || m.slice(1).some((p) => /^0\d/.test(p) || Number(p) > 255)) return false
	const [a, b, , d] = m.slice(1).map(Number)
	if (d < 1 || d > 254) return false
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * The LAN address of env.json (parsed): .ipad.lanHost when .ipad.profile is
 * true and the address is valid; otherwise an Error that says why.
 * @param {object|null} env
 * @return {string}
 */
export function lanHostOf(env) {
	const ipad = env?.ipad
	if (!ipad || ipad.profile !== true) throw new Error(`der Stack ipad läuft nicht mit dem iPad-Profil (env.json ohne .ipad.profile = true) – ${HINT}`)
	if (!lanHostValid(ipad.lanHost)) throw new Error(`env.json .ipad.lanHost '${ipad.lanHost ?? ''}' ist keine private IPv4-Hostadresse – ${HINT}`)
	return ipad.lanHost
}

/** Reads ENV_FILE (or file) and returns its LAN address; an Error when it is missing or unusable. */
export function readLanHost(file = ENV_FILE) {
	let env
	try {
		env = JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch {
		throw new Error(`${file} fehlt oder ist kaputt – ${HINT}`)
	}
	return lanHostOf(env)
}

/**
 * Why a listen/target pair is refused, or null when it is fine. Listen
 * addresses: lanHost (a valid private IPv4 host address) and 127.0.0.1 for
 * the self-test only. Anything that is no non-empty string (null, a number …)
 * is refused like 0.0.0.0: Node binds a falsy host to every address.
 * @param {{lanHost?: string, listenHost: string, listenPort: number, targetHost: string, targetPort: number}} o
 */
export function refusal({ lanHost, listenHost, listenPort, targetHost, targetPort }) {
	const lan = lanHostValid(lanHost) ? lanHost : null
	const only = lan ?? 'die LAN-Adresse aus env.json'
	if (typeof listenHost !== 'string' || listenHost === '' || listenHost === '0.0.0.0' || listenHost === '::') return `Adresse '${listenHost ?? ''}' verweigert: der Stack wäre von überall erreichbar (nur ${only})`
	const onLan = lan !== null && listenHost === lan
	if (listenHost !== '127.0.0.1' && !onLan) return `Adresse '${listenHost}' verweigert (nur ${only}; 127.0.0.1 nur im Selbsttest)`
	if (onLan && listenPort !== RELAY_PORT) return `auf ${lan} nur Port ${RELAY_PORT}`
	if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) return `Port ${listenPort} ungültig`
	if (targetHost !== TARGET_HOST) return `Ziel ${targetHost} verweigert (nur ${TARGET_HOST})`
	if (onLan && targetPort !== TARGET_PORT) return `Ziel nur ${TARGET_HOST}:${TARGET_PORT} (Namensraum ipad)`
	if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) return `Zielport ${targetPort} ungültig`
	return null
}

/** Command line: only --hours N. @return {{hours: number}} */
export function parseArgs(argv) {
	let hours = HOURS_DEFAULT
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--hours' && i + 1 < argv.length && /^\d+(\.\d+)?$/.test(argv[i + 1])) {
			hours = Number(argv[++i])
			continue
		}
		throw new Error(`unbekanntes Argument '${argv[i]}' (nur --hours N; Adresse und Port sind fest: <.ipad.lanHost aus env.json>:${RELAY_PORT} → ${TARGET_HOST}:${TARGET_PORT})`)
	}
	if (!(hours >= HOURS_MIN && hours <= HOURS_MAX)) throw new Error(`--hours ${hours} ungültig (${HOURS_MIN}–${HOURS_MAX})`)
	return { hours }
}

/**
 * Starts the relay. Resolves {server, address, port, close(), done} once it
 * listens; done resolves after close (timer, signal or close()).
 */
export function startRelay({ lanHost, listenHost = lanHost, listenPort = RELAY_PORT, targetHost = TARGET_HOST, targetPort = TARGET_PORT, hours = HOURS_DEFAULT, log = (s) => console.log(s) } = {}) {
	const why = refusal({ lanHost, listenHost, listenPort, targetHost, targetPort })
	if (why) return Promise.reject(new Error(why))
	const sockets = new Set()
	let closed = false
	let resolveDone
	const done = new Promise((r) => { resolveDone = r })
	const server = net.createServer((client) => {
		const peer = `${client.remoteAddress}:${client.remotePort}`
		const up = net.connect({ host: targetHost, port: targetPort })
		sockets.add(client)
		sockets.add(up)
		let inBytes = 0
		let outBytes = 0
		client.on('data', (c) => { inBytes += c.length })
		up.on('data', (c) => { outBytes += c.length })
		client.pipe(up)
		up.pipe(client)
		const end = () => {
			sockets.delete(client)
			sockets.delete(up)
			client.destroy()
			up.destroy()
		}
		client.on('close', () => { log(`[relay ${new Date().toISOString().slice(11, 19)}] ${peer}: ${inBytes} B hin, ${outBytes} B zurück`); end() })
		client.on('error', end)
		up.on('error', (e) => { log(`[relay] Ziel ${targetHost}:${targetPort}: ${e.code || e.message}`); end() })
		up.on('close', end)
	})
	const close = () => {
		if (closed) return done
		closed = true
		clearTimeout(timer)
		for (const s of sockets) s.destroy()
		server.close(() => resolveDone())
		return done
	}
	const timer = setTimeout(() => { log(`[relay] --hours ${hours} abgelaufen – Ende`); close() }, hours * 3600 * 1000)
	timer.unref()
	return new Promise((resolve, reject) => {
		server.once('error', (e) => { clearTimeout(timer); reject(e) })
		server.listen({ host: listenHost, port: listenPort, exclusive: true }, () => {
			const a = server.address()
			resolve({ server, address: a.address, port: a.port, close, done })
		})
	})
}

/**
 * The text main() prints after "[relay] " when startRelay fails: for
 * EADDRNOTAVAIL (lanHost is no address of this host) where to correct it and
 * how to restart the stack, otherwise the error's own message.
 * @param {Error & {code?: string}} err
 * @param {string} lanHost
 * @return {string}
 */
export function startFailure(err, lanHost) {
	if (err.code === 'EADDRNOTAVAIL') return `${lanHost} (.ipad.lanHost aus env.json) ist keine Adresse dieses Hosts – KD_LAN_HOST in dev/local.env oder in der Umgebung korrigieren (docs/ENTWICKLUNG.md §3.10), dann KD_NS=ipad dev/down.sh und KD_NS=ipad KD_IPAD_PROFILE=1 dev/up.sh`
	return err.message
}

async function main() {
	let args
	try {
		args = parseArgs(process.argv.slice(2))
	} catch (e) {
		console.error(`[relay] ${e.message}`)
		return 2
	}
	let lanHost
	try {
		lanHost = readLanHost()
	} catch (e) {
		console.error(`[relay] ${e.message}`)
		return 2
	}
	let r
	try {
		r = await startRelay({ lanHost, hours: args.hours })
	} catch (e) {
		console.error(`[relay] ${startFailure(e, lanHost)}`)
		return 1
	}
	console.log(`[relay] ${r.address}:${r.port} → ${TARGET_HOST}:${TARGET_PORT}, Ende nach ${args.hours} h oder Strg+C; danach KD_NS=ipad dev/down.sh`)
	const stop = (sig) => { console.log(`[relay] ${sig} – Ende`); r.close() }
	process.on('SIGINT', () => stop('SIGINT'))
	process.on('SIGTERM', () => stop('SIGTERM'))
	await r.done
	return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main().then((c) => process.exit(c), (e) => { console.error('[relay] ABBRUCH', e); process.exit(1) })
}
