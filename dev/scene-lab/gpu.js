/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * GPU evidence of the measurement mode (SPEC-M1 §16: a lab run with WebKit
 * and the GPU as an approximation of Safari, before stage 1 phase 0). Pure
 * helpers without Playwright and without DOM: run.mjs collects the raw
 * inputs inside the lab container
 *
 * - /proc/<pid>/cmdline of every browser process (Chromium or WebKit/WPE)
 * - /proc/<pid>/maps: which Mesa driver the process loaded (radeonsi = the
 *   host GPU, swrast/kms_swrast = llvmpipe in software)
 * - the DRM fdinfo of its /dev/dri descriptors: drm-engine-<engine> busy time
 *   in ns per DRM client, read before and after the scenarios (a rising gfx
 *   counter is work the GPU did for this browser)
 * - the WebGL renderer string (WEBGL_debug_renderer_info) of the page
 *
 * and these functions turn them into measure.json `gpuEvidence` and the
 * report section. Unit tested in dev/scene-lab/test/gpu.test.mjs.
 */

const WEBKIT_EXES = Object.freeze({
	MiniBrowser: 'ui',
	WPEWebProcess: 'web',
	WPENetworkProcess: 'network',
	WPEGPUProcess: 'gpu',
	WebKitWebProcess: 'web',
	WebKitNetworkProcess: 'network',
	WebKitGPUProcess: 'gpu',
})

/**
 * WebKit process kind from its NUL-separated /proc/<pid>/cmdline (the
 * Playwright build runs WPE in headless mode: MiniBrowser is the UI process).
 *
 * @param {string} cmdline raw cmdline
 * @return {string|null} ui|web|network|gpu; null when not WebKit
 */
export function webkitKind(cmdline) {
	const exe = String(cmdline ?? '').split('\0').find(Boolean)?.split(' ')[0]?.split('/').pop()
	return exe ? WEBKIT_EXES[exe] ?? null : null
}

/**
 * Mesa drivers a process has mapped (/proc/<pid>/maps). The loader opens
 * <name>_dri.so by name, so the mapped path tells radeonsi from swrast even
 * where the files are hard links of one megadriver.
 *
 * @param {string} maps file content
 * @return {string[]} driver names, sorted
 */
export function mesaDrivers(maps) {
	const out = new Set()
	for (const m of String(maps ?? '').matchAll(/\/dri\/([a-z0-9_]+)_dri\.so\b/g)) out.add(m[1])
	return [...out].sort()
}

/**
 * Engine busy times of one DRM fdinfo block (drm-engine-<name>: <n> ns).
 *
 * @param {string} text /proc/<pid>/fdinfo/<fd> of a /dev/dri descriptor
 * @return {{driver: string, clientId: string, engines: Object<string, number>}|null} ns per engine; null when not DRM
 */
export function parseDrmEngines(text) {
	let driver = null
	let clientId = null
	const engines = {}
	for (const line of String(text ?? '').split('\n')) {
		const i = line.indexOf(':')
		if (i <= 0) continue
		const key = line.slice(0, i).trim()
		const value = line.slice(i + 1).trim()
		if (key === 'drm-driver') driver = value
		else if (key === 'drm-client-id') clientId = value
		else {
			const m = /^drm-engine-([a-z0-9_]+)$/.exec(key)
			const v = /^(\d+)\s*ns$/.exec(value)
			if (m && v) engines[m[1]] = Number(v[1])
		}
	}
	return driver && clientId !== null ? { driver, clientId, engines } : null
}

/**
 * Busy time per engine that the DRM clients spent between two readings.
 * A client counts once however many descriptors point at it; a client that
 * is new in `after` counts with its whole time, one that closed in between
 * is lost (it can no longer be read).
 *
 * @param {Array<ReturnType<typeof parseDrmEngines>>} before blocks of the first reading (null entries ignored)
 * @param {Array<ReturnType<typeof parseDrmEngines>>} after blocks of the second reading
 * @return {{clients: number, engines: Object<string, number>}} ns per engine
 */
export function engineDelta(before, after) {
	const byClient = (list) => {
		const m = new Map()
		for (const b of list ?? []) if (b) m.set(b.driver + '/' + b.clientId, b.engines)
		return m
	}
	const b0 = byClient(before)
	const b1 = byClient(after)
	const engines = {}
	for (const [key, e1] of b1) {
		const e0 = b0.get(key) ?? {}
		for (const [name, ns] of Object.entries(e1)) engines[name] = (engines[name] ?? 0) + Math.max(0, ns - (e0[name] ?? 0))
	}
	return { clients: b1.size, engines }
}

/**
 * WebKit answers WEBGL_debug_renderer_info with the fixed pair "Apple Inc." /
 * "Apple GPU" on every platform (fingerprinting protection), so its renderer
 * string says nothing about the device; Chromium names the real one
 * ("ANGLE (AMD, … radeonsi …)" or "… SwiftShader …").
 *
 * @param {string|null|undefined} renderer WebGL UNMASKED_RENDERER_WEBGL (or RENDERER)
 * @return {'gpu'|'software'|'masked'|'unknown'}
 */
export function classifyRenderer(renderer) {
	const s = String(renderer ?? '')
	if (!s) return 'unknown'
	if (/^Apple GPU$/.test(s)) return 'masked'
	if (/llvmpipe|softpipe|swiftshader|swrast|lavapipe|software/i.test(s)) return 'software'
	if (/\bAMD\b|radeon|\bGFX\d|intel|nvidia|mali|adreno/i.test(s)) return 'gpu'
	return 'unknown'
}

/** Below this much gfx engine time over the scenarios the GPU did not render the board (ms). */
export const GFX_MIN_MS = 20

/**
 * Verdict from the evidence of one run. "gpu-confirmed" needs the GPU's own
 * accounting: the browser's DRM clients spent ≥ GFX_MIN_MS on the gfx engine
 * during the scenarios and a process loaded a hardware Mesa driver.
 * "software-only" needs the opposite on every count: no gfx time, no
 * /dev/dri descriptor, no hardware driver, during the scenarios and after
 * the WebGL probe. A renderer string alone proves only where WebGL would run,
 * not where the 2D canvas and the compositor did (and WebKit masks it).
 *
 * @param {{webgl: {renderer: string|null, drivers?: string[], drmFds?: number}|null, processes: Array<{kind: string, drivers: string[], drmFds: number}>, scenarioEngines: {clients: number, engines: Object<string, number>}}} ev evidence
 * @return {{verdict: 'gpu-confirmed'|'software-only'|'unclear', gfxMs: number, hwDriver: boolean, swDriver: boolean, rendererClass: string, reasons: string[]}}
 */
export function gpuVerdict(ev) {
	const procs = ev?.processes ?? []
	const drivers = new Set(procs.flatMap((p) => p.drivers ?? []))
	const hwDriver = [...drivers].some((d) => !/^(kms_)?swrast$|^zink$/.test(d))
	const swDriver = [...drivers].some((d) => /^(kms_)?swrast$/.test(d))
	const gfxMs = Math.round(((ev?.scenarioEngines?.engines?.gfx ?? 0) / 1e6) * 10) / 10
	const rendererClass = classifyRenderer(ev?.webgl?.renderer)
	const drmFds = procs.reduce((a, p) => a + (p.drmFds ?? 0), 0)
	const probeDrivers = ev?.webgl?.drivers ?? []
	const probeHw = probeDrivers.some((d) => !/^(kms_)?swrast$|^zink$/.test(d))
	const reasons = [
		`gfx engine ${gfxMs} ms during the scenarios (${ev?.scenarioEngines?.clients ?? 0} DRM clients, ${drmFds} /dev/dri descriptors)`,
		`Mesa drivers loaded: ${[...drivers].sort().join(', ') || 'none'}`,
		`WebGL renderer: ${ev?.webgl?.renderer ?? 'n/a'} (${rendererClass}); after the WebGL probe: ` +
			`${probeDrivers.join(', ') || 'no Mesa driver'}, ${ev?.webgl?.drmFds ?? 0} /dev/dri descriptors`,
	]
	let verdict = 'unclear'
	if (gfxMs >= GFX_MIN_MS && hwDriver) verdict = 'gpu-confirmed'
	else if (gfxMs === 0 && drmFds === 0 && !hwDriver && !probeHw && !(ev?.webgl?.drmFds > 0)) verdict = 'software-only'
	return { verdict, gfxMs, hwDriver, swDriver, rendererClass, reasons }
}

/**
 * Report section (German like the rest of out/report.md).
 *
 * @param {{webgl: object|null, processes: Array, scenarioEngines: object, verdict: ReturnType<typeof gpuVerdict>, launch: object}} ev evidence of one run
 * @return {string[]} markdown lines
 */
export function gpuReportLines(ev) {
	const v = ev.verdict
	const word = { 'gpu-confirmed': 'GPU bestätigt', 'software-only': 'nur Software', unclear: 'unklar' }[v.verdict]
	const ms = (ns) => Math.round((ns / 1e6) * 10) / 10
	const lines = [
		'## GPU-Nachweis',
		'',
		`Urteil: **${word}** (${v.verdict}). gfx-Engine während der Szenarien: ${v.gfxMs} ms; ` +
			`WebGL-Renderer: ${ev.webgl?.renderer ?? 'n/a'} (${ev.webgl?.vendor ?? 'n/a'}, ${v.rendererClass}` +
			(v.rendererClass === 'masked' ? ': WebKit nennt immer „Apple GPU“, kein Beleg' : '') + ').',
		`WebGL-Probe danach: Mesa-Treiber ${ev.webgl?.drivers?.join(', ') || '–'}, ${ev.webgl?.drmFds ?? 0} /dev/dri-Deskriptoren.`,
		'',
		'| Prozess | PID | Mesa-Treiber | /dev/dri-Deskriptoren | gfx ms (Szenarien) |',
		'|---|---|---|---|---|',
		...ev.processes.map((p) => `| ${p.kind} | ${p.pid} | ${p.drivers.join(', ') || '–'} | ${p.drmFds} | ${p.gfxNs === null ? '–' : ms(p.gfxNs)} |`),
		'',
	]
	if (ev.launch?.note) lines.push(`Start: ${ev.launch.note}`, '')
	return lines
}
