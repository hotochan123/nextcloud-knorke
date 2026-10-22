/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Page memory for the measurement report (SPEC-M0 §9.4: "Seitenspeicher mit
 * zwei Canvas", GPU run with KNORKE_GPU=1). Pure helpers without Playwright
 * and without DOM: run.mjs collects the raw inputs inside the lab container
 *
 * - CDP Performance.getMetrics after HeapProfiler.collectGarbage (JS heap,
 *   DOM nodes, documents, listeners)
 * - performance.measureUserAgentSpecificMemory() (page is cross-origin
 *   isolated through COOP/COEP; Chromium runs with ForceEagerMeasureMemory)
 * - the lab's canvas probe (backing stores of both layer canvases, their hit
 *   canvases and isolation surfaces)
 * - /proc of every Chromium process (smaps_rollup PSS/RSS, falling back to
 *   status VmRSS) and the DRM fdinfo of /dev/dri file descriptors (VRAM/GTT
 *   of the GPU process when the container got the GPU)
 *
 * and these functions turn them into measure.json `memory` and the report
 * section. WebKit (run.mjs --browser webkit) has no CDP: plainSnapshot()
 * keeps the canvas probe and /proc and reports the Chromium-only sizes as
 * "n/a". Unit tested in tests/js/scene/labMemory.test.mjs and
 * dev/scene-lab/test/memory.test.mjs.
 */

const UNITS = { b: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3 }

/**
 * @param {number|null|undefined} bytes bytes
 * @param {number} [digits] decimals
 * @return {number|null} MiB, rounded
 */
export function mib(bytes, digits = 1) {
	if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return null
	const f = 10 ** digits
	return Math.round((bytes / 1024 ** 2) * f) / f
}

/**
 * "12345 kB" (procfs), "512 KiB" (DRM fdinfo) or a bare number (bytes).
 *
 * @param {string} text value
 * @return {number|null} bytes
 */
export function parseSize(text) {
	const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(String(text ?? ''))
	if (!m) return null
	const unit = m[2] === '' ? 1 : UNITS[m[2].toLowerCase()]
	return unit === undefined ? null : Math.round(Number(m[1]) * unit)
}

/**
 * @param {string} text "Key:   value" lines
 * @return {Map<string, string>} key → raw value
 */
function keyValues(text) {
	const out = new Map()
	for (const line of String(text ?? '').split('\n')) {
		const i = line.indexOf(':')
		if (i > 0) out.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
	}
	return out
}

/**
 * /proc/<pid>/status (world readable).
 *
 * @param {string} text file content
 * @return {{rss: number|null, peak: number|null}} bytes
 */
export function parseProcStatus(text) {
	const kv = keyValues(text)
	return { rss: parseSize(kv.get('VmRSS') ?? ''), peak: parseSize(kv.get('VmHWM') ?? '') }
}

/**
 * /proc/<pid>/smaps_rollup (needs ptrace read access; PSS splits shared pages
 * between the processes that map them, so the sum over processes is honest).
 *
 * @param {string} text file content
 * @return {{rss: number|null, pss: number|null}} bytes
 */
export function parseSmapsRollup(text) {
	const kv = keyValues(text)
	return { rss: parseSize(kv.get('Rss') ?? ''), pss: parseSize(kv.get('Pss') ?? '') }
}

/**
 * One DRM fdinfo block (/proc/<pid>/fdinfo/<fd> of a /dev/dri descriptor).
 * Reads the generic drm-{total,shared,resident,purgeable,active}-<region> keys
 * and the older drm-memory-<region> (amdgpu, i915).
 *
 * @param {string} text file content
 * @return {{driver: string, clientId: string, regions: Object<string, Object<string, number>>}|null}
 *   regions[region][kind] in bytes, kind ∈ memory|total|shared|resident|purgeable|active; null when not DRM
 */
export function parseDrmFdinfo(text) {
	const kv = keyValues(text)
	const driver = kv.get('drm-driver')
	const clientId = kv.get('drm-client-id')
	if (!driver || clientId === undefined) return null
	const regions = {}
	for (const [key, value] of kv) {
		const m = /^drm-(memory|total|shared|resident|purgeable|active)-([a-z0-9_]+)$/.exec(key)
		if (!m) continue
		const bytes = parseSize(value)
		if (bytes === null) continue
		regions[m[2]] ??= {}
		regions[m[2]][m[1]] = bytes
	}
	return { driver, clientId, regions }
}

/**
 * Sums the DRM clients of one or more processes, each drm-client-id once
 * (a process often holds several descriptors of the same client). Per region
 * the resident figure counts, else drm-memory, else drm-total.
 *
 * @param {Array<ReturnType<typeof parseDrmFdinfo>>} infos parsed blocks (null entries ignored)
 * @return {{driver: string|null, clients: number, regions: Object<string, number>}|null} bytes per region; null without any client
 */
export function sumDrmClients(infos) {
	const seen = new Map()
	for (const info of infos) {
		if (info && !seen.has(info.driver + '/' + info.clientId)) seen.set(info.driver + '/' + info.clientId, info)
	}
	if (seen.size === 0) return null
	const regions = {}
	let driver = null
	for (const info of seen.values()) {
		driver ??= info.driver
		for (const [region, kinds] of Object.entries(info.regions)) {
			const bytes = kinds.resident ?? kinds.memory ?? kinds.total
			if (bytes !== undefined) regions[region] = (regions[region] ?? 0) + bytes
		}
	}
	return { driver, clients: seen.size, regions }
}

/**
 * Chromium process kind from its NUL-separated /proc/<pid>/cmdline.
 *
 * @param {string} cmdline raw cmdline
 * @return {string|null} browser|renderer|gpu|utility|zygote|other (crashpad); null when not Chromium
 */
export function chromiumKind(cmdline) {
	let args = String(cmdline ?? '').split('\0').filter(Boolean)
	if (!args.length) return null
	// Zygote children (renderer, GPU, utility) rewrite their title: one string,
	// arguments separated by spaces ("…/chrome --type=renderer --lang=…")
	const flags = args.length === 1 ? args[0].indexOf(' --') : -1
	if (flags > 0) args = [args[0].slice(0, flags), ...args[0].slice(flags + 1).split(' ')]
	const exe = args[0].split('/').pop()
	if (exe === 'chrome_crashpad_handler') return 'other'
	if (!['chrome', 'chromium', 'chromium-browser', 'headless_shell', 'chrome-headless-shell'].includes(exe)) return null
	const typeArg = args.find((a) => a.startsWith('--type='))
	if (!typeArg) return 'browser'
	const type = typeArg.slice('--type='.length)
	if (type === 'gpu-process') return 'gpu'
	return ['renderer', 'utility', 'zygote'].includes(type) ? type : 'other'
}

/**
 * @param {Array<{name: string, value: number}>} metrics CDP Performance.getMetrics().metrics
 * @return {Object<string, number>} name → value
 */
export function metricsMap(metrics) {
	const out = {}
	for (const m of metrics ?? []) out[m.name] = m.value
	return out
}

/**
 * performance.measureUserAgentSpecificMemory() result, grouped by type.
 *
 * @param {{bytes: number, breakdown: Array<{bytes: number, types: string[]}>}|null} result result (or null)
 * @return {{bytes: number, byType: Object<string, number>}|null} bytes
 */
export function summarizeUaMemory(result) {
	if (!result || !Number.isFinite(result.bytes)) return null
	const byType = {}
	for (const b of result.breakdown ?? []) {
		if (!b.bytes) continue
		const key = b.types?.length ? b.types.join('+') : 'other'
		byType[key] = (byType[key] ?? 0) + b.bytes
	}
	return { bytes: result.bytes, byType }
}

/**
 * Canvas probe of the lab (lab.js canvasMemory()) → backing-store bytes.
 * Nominal: width × height × 4 (RGBA8), what the browser has to hold per
 * canvas in CPU or GPU memory.
 *
 * @param {{dom: number, pixelRatio: number, list: Array<{name: string, w: number, h: number}>}} probe probe
 * @return {{dom: number, pixelRatio: number, list: Array<{name: string, w: number, h: number, bytes: number}>, bytes: number}}
 */
export function summarizeCanvases(probe) {
	const list = (probe?.list ?? []).map((c) => ({ name: c.name, w: c.w, h: c.h, bytes: c.w * c.h * 4 }))
	return { dom: probe?.dom ?? 0, pixelRatio: probe?.pixelRatio ?? 1, list, bytes: list.reduce((a, c) => a + c.bytes, 0) }
}

/**
 * Process table → sums per kind, the page's renderer (largest renderer by
 * PSS, else RSS) and the GPU memory of all DRM clients.
 *
 * @param {Array<{pid: number, kind: string, pss: number|null, rss: number|null, drm: Array}>} procs processes
 * @return {object} summary (bytes)
 */
export function summarizeProcesses(procs) {
	const list = procs ?? []
	const size = (p) => p.pss ?? p.rss ?? 0
	const byKind = {}
	for (const p of list) {
		const k = (byKind[p.kind] ??= { n: 0, pss: 0, rss: 0 })
		k.n++
		k.pss += p.pss ?? 0
		k.rss += p.rss ?? 0
	}
	const renderers = list.filter((p) => p.kind === 'renderer').sort((a, b) => size(b) - size(a))
	const page = renderers[0] ? { pid: renderers[0].pid, pss: renderers[0].pss, rss: renderers[0].rss } : null
	const gpuProc = list.filter((p) => p.kind === 'gpu').sort((a, b) => size(b) - size(a))[0] ?? null
	return {
		n: list.length,
		pssAvailable: list.length > 0 && list.every((p) => p.pss !== null),
		total: { pss: list.reduce((a, p) => a + (p.pss ?? 0), 0), rss: list.reduce((a, p) => a + (p.rss ?? 0), 0) },
		byKind,
		pageRenderer: page,
		gpuProcess: gpuProc ? { pid: gpuProc.pid, pss: gpuProc.pss, rss: gpuProc.rss } : null,
		gpuMemory: sumDrmClients(list.flatMap((p) => p.drm ?? [])),
	}
}

/**
 * One memory snapshot from the raw inputs.
 *
 * @param {{metrics: Array, ua: object|null, uaError?: string|null, canvases: object, processes: Array}} raw raw inputs
 * @return {object} snapshot (bytes and counts)
 */
export function memorySnapshot(raw) {
	const m = metricsMap(raw.metrics)
	return {
		jsHeapUsed: m.JSHeapUsedSize ?? null,
		jsHeapTotal: m.JSHeapTotalSize ?? null,
		domNodes: m.Nodes ?? null,
		documents: m.Documents ?? null,
		listeners: m.JSEventListeners ?? null,
		ua: summarizeUaMemory(raw.ua),
		uaError: raw.ua ? null : (raw.uaError ?? 'not measured'),
		canvases: summarizeCanvases(raw.canvases),
		processes: summarizeProcesses(raw.processes),
	}
}

/**
 * Memory snapshot of a browser without CDP (WebKit, run.mjs --browser
 * webkit): JS heap, DOM counts and measureUserAgentSpecificMemory exist only
 * in Chromium and stay null ("n/a" in the report, never a guess). The canvas
 * probe is the same page code in every engine; the process sizes come from
 * /proc like for Chromium (kinds ui|web|network|gpu, gpu.js webkitKind).
 *
 * @param {{browser: string, canvases: object, processes: Array}} raw raw inputs
 * @return {object} snapshot in the shape of memorySnapshot()
 */
export function plainSnapshot(raw) {
	return {
		jsHeapUsed: null,
		jsHeapTotal: null,
		domNodes: null,
		documents: null,
		listeners: null,
		ua: null,
		uaError: `n/a in ${raw.browser}`,
		canvases: summarizeCanvases(raw.canvases),
		processes: summarizeProcesses(raw.processes),
	}
}

const fmt = (bytes) => {
	const v = mib(bytes)
	return v === null ? '–' : String(v)
}
const count = (v) => (v === null || v === undefined ? '–' : String(v))

/**
 * Columns of the report, in this order; a snapshot that run.mjs did not take
 * is left out.
 */
export const SNAPSHOTS = Object.freeze([
	['settled', 'nach dem Laden'],
	['after', 'nach den Szenarien'],
	['idle', 'nach der Ruhepause'],
])

/**
 * Report section "Seitenspeicher mit zwei Canvas" (German like the rest of
 * out/report.md).
 *
 * @param {{gpu: boolean, gpuInfo: object|null, idleMs?: number, settled: object, after?: object, idle?: object}} memory memory block of measure.json
 * @return {string[]} markdown lines
 */
export function memoryReportLines(memory) {
	if (memory.browser && memory.browser !== 'chromium') return plainReportLines(memory)
	const cols = SNAPSHOTS.filter(([key]) => memory[key])
	const snaps = cols.map(([key]) => memory[key])
	const last = snaps.at(-1)
	const row = (label, f) => `| ${label} | ${snaps.map(f).join(' | ')} |`
	const union = (f) => [...new Set(snaps.flatMap((s) => Object.keys(f(s) ?? {})))].sort()
	const ua = (s, type) => (s.ua ? fmt(type ? s.ua.byType[type] ?? 0 : s.ua.bytes) : '–')
	const pss = snaps.every((s) => s.processes.pssAvailable)
	const what = pss ? 'PSS' : 'RSS'
	const size = (p) => (p ? (pss ? p.pss : p.rss) : null)
	const gpuRegion = (s, region) => (s.processes.gpuMemory ? fmt(s.processes.gpuMemory.regions[region] ?? 0) : '–')
	const types = union((s) => s.ua?.byType)
	const regions = union((s) => s.processes.gpuMemory?.regions)
	const canvasList = last.canvases.list.map((c) => `${c.name} ${c.w}×${c.h}`).join(', ')
	const gi = memory.gpuInfo
	const idle = memory.idle ? `, nach Schwenken, Zoomen und Ziehen und nach ${Math.round((memory.idleMs ?? 0) / 1000)} s Ruhe` : ' und nach Schwenken, Zoomen und Ziehen'
	const lines = [
		'## Seitenspeicher mit zwei Canvas',
		'',
		`${memory.gpu ? 'GPU-Lauf' : 'Lauf ohne GPU'}` +
			(gi ? `; GL-Renderer: ${gi.glRenderer ?? gi.device ?? '–'}; 2D-Canvas: ${gi.canvas2d ?? '–'}` : '') +
			`. Gemessen jeweils nach erzwungener GC (CDP): nach dem Laden${idle}.`,
		'',
		`| Größe | ${cols.map(([, label]) => label).join(' | ')} |`,
		`|---|${cols.map(() => '---|').join('')}`,
		row('JS-Heap belegt (MiB)', (s) => fmt(s.jsHeapUsed)),
		row('JS-Heap gesamt (MiB)', (s) => fmt(s.jsHeapTotal)),
		row('measureUserAgentSpecificMemory (MiB)', (s) => ua(s)),
		...types.map((t) => row(`– davon ${t} (MiB)`, (s) => ua(s, t))),
		row('DOM-Knoten', (s) => count(s.domNodes)),
		row('Canvas im DOM', (s) => count(s.canvases.dom)),
		row('Canvas-Backing-Stores nominal (MiB)', (s) => fmt(s.canvases.bytes)),
		row(`Renderer der Seite ${what} (MiB)`, (s) => fmt(size(s.processes.pageRenderer))),
		row(`GPU-Prozess ${what} (MiB)`, (s) => fmt(size(s.processes.gpuProcess))),
		...regions.map((r) => row(`GPU-Speicher ${r} (DRM, MiB)`, (s) => gpuRegion(s, r))),
		row(`Browser-Prozess ${what} (MiB)`, (s) => fmt(size(s.processes.byKind.browser))),
		row(`alle Chromium-Prozesse ${what} (MiB)`, (s) => fmt(size(s.processes.total))),
		row('Chromium-Prozesse', (s) => count(s.processes.n)),
		'',
		`Canvas (Pixel, nominal × 4 Byte): ${canvasList || '–'}; pixelRatio ${last.canvases.pixelRatio}.`,
		'Renderer der Seite = größter Renderer-Prozess (Chromium hält einen Ersatz-Renderer bereit).',
	]
	const uaCanvas = last.ua?.byType?.Canvas
	if (uaCanvas && last.canvases.bytes > 0) {
		lines.push(`Canvas laut measureUserAgentSpecificMemory: ${Math.round((uaCanvas / last.canvases.bytes) * 10) / 10} × nominal.`)
	}
	if (regions.length) {
		lines.push('GPU-Speicher (DRM-fdinfo des GPU-Prozesses) zählt alle seine Puffer, nicht nur die zwei Canvas: auch Compositor-Kacheln ' +
			'und Skia-Caches. Er schwankt zwischen Läufen deutlich; Vergleiche nur über mehrere Läufe.')
	} else {
		lines.push(memory.gpu
			? 'GPU-Speicher: kein DRM-fdinfo lesbar (Treiber meldet keinen Speicher oder kein Zugriff).'
			: 'GPU-Speicher: – (ohne /dev/dri, Software-Rendering).')
	}
	const missingUa = snaps.find((s) => !s.ua)
	if (missingUa) lines.push(`measureUserAgentSpecificMemory: ${missingUa.uaError}.`)
	lines.push('')
	return lines
}

/**
 * Report section for a browser without CDP (WebKit): the Chromium-only
 * sizes are shown as "n/a", the canvas probe and the /proc sizes of the
 * browser's processes as measured.
 *
 * @param {{browser: string, gpu: boolean, idleMs?: number, settled: object, after?: object, idle?: object}} memory memory block of measure.json
 * @return {string[]} markdown lines
 */
function plainReportLines(memory) {
	const cols = SNAPSHOTS.filter(([key]) => memory[key])
	const snaps = cols.map(([key]) => memory[key])
	const last = snaps.at(-1)
	const row = (label, f) => `| ${label} | ${snaps.map(f).join(' | ')} |`
	const na = () => 'n/a'
	const pss = snaps.every((s) => s.processes.pssAvailable)
	const what = pss ? 'PSS' : 'RSS'
	const size = (p) => (p ? (pss ? p.pss : p.rss) : null)
	const kinds = [...new Set(snaps.flatMap((s) => Object.keys(s.processes.byKind)))].sort()
	const canvasList = last.canvases.list.map((c) => `${c.name} ${c.w}×${c.h}`).join(', ')
	return [
		'## Seitenspeicher mit zwei Canvas',
		'',
		`${memory.browser}, ${memory.gpu ? 'GPU-Lauf (/dev/dri im Container)' : 'Lauf ohne GPU'}. JS-Heap, DOM-Zähler und ` +
			'measureUserAgentSpecificMemory gibt es nur über CDP in Chromium: n/a (keine Schätzung).',
		'',
		`| Größe | ${cols.map(([, label]) => label).join(' | ')} |`,
		`|---|${cols.map(() => '---|').join('')}`,
		row('JS-Heap belegt (MiB)', na),
		row('measureUserAgentSpecificMemory (MiB)', na),
		row('DOM-Knoten', na),
		row('Canvas im DOM', (s) => count(s.canvases.dom)),
		row('Canvas-Backing-Stores nominal (MiB)', (s) => fmt(s.canvases.bytes)),
		...kinds.map((k) => row(`Prozess ${k} ${what} (MiB)`, (s) => fmt(size(s.processes.byKind[k])))),
		row(`alle ${memory.browser}-Prozesse ${what} (MiB)`, (s) => fmt(size(s.processes.total))),
		row(`${memory.browser}-Prozesse`, (s) => count(s.processes.n)),
		'',
		`Canvas (Pixel, nominal × 4 Byte): ${canvasList || '–'}; pixelRatio ${last.canvases.pixelRatio}.`,
		'',
	]
}
