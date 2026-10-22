/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Scene lab, measurement report: page memory with two canvases (SPEC-M0 §9.4,
 * "Seitenspeicher mit zwei Canvas (GPU-Lauf, falls KNORKE_GPU=1)").
 * Phase-2 finding: the measure run wrote no memory figure at all. These tests
 * pin the pure helpers of dev/scene-lab/memory.js on inputs recorded in the
 * lab container (Chromium 131, amdgpu) and check that run.mjs actually puts
 * the memory block into measure.json and report.md.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, stripComments } from './sourceScan.mjs'
import {
	chromiumKind, memoryReportLines, memorySnapshot, mib, parseDrmFdinfo, parseProcStatus, parseSize,
	parseSmapsRollup, summarizeCanvases, summarizeProcesses, summarizeUaMemory, sumDrmClients,
} from '../../../dev/scene-lab/memory.js'

const KIB = 1024
const EXE = '/ms-playwright/chromium-1148/chrome-linux/chrome'

// recorded in knorke-lab-* (amdgpu, kernel 6.12): the GPU process holds three
// descriptors of ONE DRM client
const AMDGPU = (client) => [
	'pos:\t0', 'flags:\t02100002', 'mnt_id:\t6631', 'ino:\t13',
	'drm-driver:\tamdgpu', `drm-client-id:\t${client}`, 'drm-pdev:\t0000:cb:00.0', 'pasid:\t32770',
	'drm-memory-vram:\t18956 KiB', 'drm-memory-gtt: \t15888 KiB', 'drm-memory-cpu: \t0 KiB',
	'amd-memory-visible-vram:\t18956 KiB', 'amd-requested-vram:\t18956 KiB',
	'drm-shared-vram:\t0 KiB', 'drm-shared-gtt:\t0 KiB', 'drm-shared-cpu:\t0 KiB',
	'drm-engine-gfx:\t5787029 ns', '',
].join('\n')

describe('process discovery in the lab container', () => {
	test('browser (NUL-separated argv) and zygote children (title rewritten to one string)', () => {
		assert.equal(chromiumKind(`${EXE}\0--disable-field-trial-config\0--headless\0`), 'browser')
		assert.equal(chromiumKind(`${EXE} --type=renderer --string-annotations --crashpad-handler-pid=0 --user-data-dir=/tmp/p/x\0`), 'renderer')
		assert.equal(chromiumKind(`${EXE} --type=gpu-process --no-sandbox --headless --ozone-platform=headless`), 'gpu')
		assert.equal(chromiumKind(`${EXE} --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US`), 'utility')
		assert.equal(chromiumKind(`${EXE} --type=zygote --no-zygote-sandbox --no-sandbox`), 'zygote')
		assert.equal(chromiumKind(`${EXE} --type=broker`), 'other')
		assert.equal(chromiumKind('/ms-playwright/chromium-1148/chrome-linux/chrome_crashpad_handler\0--monitor-self\0'), 'other')
	})

	test('not Chromium: init, node, empty or unreadable', () => {
		assert.equal(chromiumKind('/sbin/docker-init\0--\0node\0run.mjs\0'), null)
		assert.equal(chromiumKind('node\0run.mjs\0--mode\0measure\0'), null)
		assert.equal(chromiumKind(''), null)
		assert.equal(chromiumKind(null), null)
	})

	test('procfs sizes: smaps_rollup (PSS) and status (RSS fallback)', () => {
		assert.equal(parseSize('123 kB'), 123 * KIB)
		assert.equal(parseSize('2 MiB'), 2 * 1024 * 1024)
		assert.equal(parseSize('77'), 77)
		assert.equal(parseSize('5787029 ns'), null)
		assert.deepEqual(parseSmapsRollup('55a0-7ffd ---p 00000000 00:00 0  [rollup]\nRss:              120300 kB\nPss:               84021 kB\nPss_Anon:          60000 kB\n'),
			{ rss: 120300 * KIB, pss: 84021 * KIB })
		assert.deepEqual(parseProcStatus('Name:\tchrome\nVmHWM:\t  130000 kB\nVmRSS:\t  120300 kB\n'), { rss: 120300 * KIB, peak: 130000 * KIB })
		assert.deepEqual(parseProcStatus(''), { rss: null, peak: null })
	})
})

describe('GPU memory from DRM fdinfo', () => {
	test('amdgpu block: drm-memory-<region>, shared kept apart, engine time ignored', () => {
		const d = parseDrmFdinfo(AMDGPU(2782))
		assert.equal(d.driver, 'amdgpu')
		assert.equal(d.clientId, '2782')
		assert.deepEqual(d.regions.vram, { memory: 18956 * KIB, shared: 0 })
		assert.deepEqual(d.regions.gtt, { memory: 15888 * KIB, shared: 0 })
		assert.equal(d.regions.gfx, undefined)
		assert.equal(parseDrmFdinfo('pos:\t0\nflags:\t02\n'), null)
	})

	test('one client behind several descriptors counts once; two clients add up', () => {
		const one = sumDrmClients([AMDGPU(2782), AMDGPU(2782), AMDGPU(2782)].map(parseDrmFdinfo))
		assert.deepEqual(one, { driver: 'amdgpu', clients: 1, regions: { vram: 18956 * KIB, gtt: 15888 * KIB, cpu: 0 } })
		const two = sumDrmClients([AMDGPU(1), AMDGPU(2), null].map((t) => (t ? parseDrmFdinfo(t) : null)))
		assert.equal(two.clients, 2)
		assert.equal(two.regions.vram, 2 * 18956 * KIB)
		assert.equal(sumDrmClients([]), null)
	})

	test('generic keys: resident wins over total', () => {
		const d = parseDrmFdinfo('drm-driver:\txe\ndrm-client-id:\t9\ndrm-total-system0:\t800 KiB\ndrm-resident-system0:\t600 KiB\n')
		assert.deepEqual(sumDrmClients([d]).regions, { system0: 600 * KIB })
	})
})

describe('page side', () => {
	test('measureUserAgentSpecificMemory grouped by type', () => {
		const ua = summarizeUaMemory({ bytes: 55e6, breakdown: [
			{ bytes: 4e6, types: ['JavaScript'], attribution: [] },
			{ bytes: 1e6, types: ['JavaScript'], attribution: [] },
			{ bytes: 50e6, types: ['Canvas'], attribution: [] },
			{ bytes: 0, types: ['DOM'], attribution: [] },
			{ bytes: 3, types: [], attribution: [] },
		] })
		assert.deepEqual(ua, { bytes: 55e6, byType: { JavaScript: 5e6, Canvas: 50e6, other: 3 } })
		assert.equal(summarizeUaMemory(null), null)
	})

	test('two layer canvases at 1920×1080 are 2 × 8 294 400 bytes; hit canvases stay 0 × 0', () => {
		const c = summarizeCanvases({ dom: 2, pixelRatio: 1, list: [
			{ name: 'static', w: 1920, h: 1080 }, { name: 'static:hit', w: 0, h: 0 },
			{ name: 'overlay', w: 1920, h: 1080 }, { name: 'overlay:hit', w: 0, h: 0 },
		] })
		assert.equal(c.bytes, 2 * 1920 * 1080 * 4)
		assert.equal(c.dom, 2)
		assert.equal(mib(c.bytes), 15.8)
	})

	test('process summary: the page is the larger renderer (Chromium keeps a spare one)', () => {
		const p = summarizeProcesses([
			{ pid: 107, kind: 'browser', pss: 80e6, rss: 120e6, drm: [] },
			{ pid: 193, kind: 'renderer', pss: 9e6, rss: 40e6, drm: [] },
			{ pid: 195, kind: 'renderer', pss: 70e6, rss: 110e6, drm: [] },
			{ pid: 135, kind: 'gpu', pss: 30e6, rss: 60e6, drm: [parseDrmFdinfo(AMDGPU(2782)), parseDrmFdinfo(AMDGPU(2782))] },
		])
		assert.deepEqual(p.pageRenderer, { pid: 195, pss: 70e6, rss: 110e6 })
		assert.equal(p.gpuProcess.pid, 135)
		assert.equal(p.byKind.renderer.n, 2)
		assert.equal(p.total.pss, 189e6)
		assert.equal(p.pssAvailable, true)
		assert.equal(p.gpuMemory.regions.vram, 18956 * KIB)
	})
})

describe('report section', () => {
	const snap = (gpu) => memorySnapshot({
		metrics: [{ name: 'JSHeapUsedSize', value: 4e6 }, { name: 'JSHeapTotalSize', value: 6e6 }, { name: 'Nodes', value: 33 }],
		ua: { bytes: 55e6, breakdown: [{ bytes: 50e6, types: ['Canvas'] }, { bytes: 5e6, types: ['JavaScript'] }] },
		canvases: { dom: 2, pixelRatio: 1, list: [{ name: 'static', w: 1920, h: 1080 }, { name: 'overlay', w: 1920, h: 1080 }] },
		processes: [
			{ pid: 1, kind: 'browser', pss: 80e6, rss: 90e6, drm: [] },
			{ pid: 2, kind: 'renderer', pss: 70e6, rss: 90e6, drm: [] },
			{ pid: 3, kind: 'gpu', pss: 30e6, rss: 40e6, drm: gpu ? [parseDrmFdinfo(AMDGPU(7))] : [] },
		],
	})
	const cell = (lines, label) => {
		const row = lines.find((l) => l.startsWith(`| ${label} |`))
		assert.ok(row, `row "${label}" missing:\n${lines.join('\n')}`)
		return row.split('|').slice(2, 4).map((s) => s.trim())
	}

	test('GPU run: JS heap, canvases, page renderer, GPU process and its VRAM/GTT, both snapshots', () => {
		const lines = memoryReportLines({ gpu: true, gpuInfo: { glRenderer: 'ANGLE (AMD, GFX1103_R1)', canvas2d: 'enabled' }, settled: snap(true), after: snap(true) })
		assert.ok(lines.includes('## Seitenspeicher mit zwei Canvas'))
		assert.match(lines.join('\n'), /GPU-Lauf; GL-Renderer: ANGLE \(AMD, GFX1103_R1\); 2D-Canvas: enabled/)
		assert.deepEqual(cell(lines, 'JS-Heap belegt (MiB)'), ['3.8', '3.8'])
		assert.deepEqual(cell(lines, 'Canvas im DOM'), ['2', '2'])
		assert.deepEqual(cell(lines, 'Canvas-Backing-Stores nominal (MiB)'), ['15.8', '15.8'])
		assert.deepEqual(cell(lines, '– davon Canvas (MiB)'), ['47.7', '47.7'])
		assert.deepEqual(cell(lines, 'Renderer der Seite PSS (MiB)'), ['66.8', '66.8'])
		assert.deepEqual(cell(lines, 'GPU-Prozess PSS (MiB)'), ['28.6', '28.6'])
		assert.deepEqual(cell(lines, 'GPU-Speicher vram (DRM, MiB)'), ['18.5', '18.5'])
		assert.deepEqual(cell(lines, 'GPU-Speicher gtt (DRM, MiB)'), ['15.5', '15.5'])
		assert.deepEqual(cell(lines, 'Chromium-Prozesse'), ['3', '3'])
		assert.match(lines.join('\n'), /static 1920×1080, overlay 1920×1080/)
		assert.ok(lines.includes('Canvas laut measureUserAgentSpecificMemory: 3 × nominal.'))
	})

	test('third column after the quiet pause when run.mjs took it', () => {
		const idle = snap(true)
		idle.processes.gpuMemory.regions.gtt = 0
		const lines = memoryReportLines({ gpu: true, gpuInfo: null, idleMs: 10000, settled: snap(true), after: snap(true), idle })
		assert.ok(lines.includes('| Größe | nach dem Laden | nach den Szenarien | nach der Ruhepause |'))
		assert.ok(lines.includes('|---|---|---|---|'))
		assert.match(lines.join('\n'), /nach Schwenken, Zoomen und Ziehen und nach 10 s Ruhe\./)
		const row = lines.find((l) => l.startsWith('| GPU-Speicher gtt (DRM, MiB) |'))
		assert.equal(row, '| GPU-Speicher gtt (DRM, MiB) | 15.5 | 15.5 | 0 |')
		assert.match(lines.join('\n'), /nicht nur die zwei Canvas/)
	})

	test('software run: no GPU memory rows, explained instead; missing UA memory explained', () => {
		const s = snap(false)
		const lines = memoryReportLines({ gpu: false, gpuInfo: null, settled: { ...s, ua: null, uaError: 'unavailable (crossOriginIsolated false)' }, after: s })
		assert.ok(!lines.some((l) => l.startsWith('| GPU-Speicher')))
		assert.ok(lines.includes('GPU-Speicher: – (ohne /dev/dri, Software-Rendering).'))
		assert.deepEqual(cell(lines, 'measureUserAgentSpecificMemory (MiB)'), ['–', '52.5'])
		assert.ok(lines.includes('measureUserAgentSpecificMemory: unavailable (crossOriginIsolated false).'))
	})
})

describe('wiring in run.mjs and lab.js', () => {
	const run = stripComments(readFileSync(join(ROOT, 'dev/scene-lab/run.mjs'), 'utf8'))
	const lab = stripComments(readFileSync(join(ROOT, 'dev/scene-lab/lab.js'), 'utf8'))
	const measure = run.slice(run.indexOf('async function measure()'), run.indexOf('let exitCode'))

	test('measure mode snapshots memory before and after the scenarios and writes it to measure.json + report.md', () => {
		assert.ok(measure.length > 100, 'measure() not found')
		assert.match(measure, /settled: await memoryNow\(cdp\)/)
		assert.match(measure, /window\.__lab\.measure\(\)[\s\S]*memory\.after = await memoryNow\(cdp\)[\s\S]*await sleep\(MEMORY_IDLE_MS\)\s*memory\.idle = await memoryNow\(cdp\)/)
		assert.match(measure, /JSON\.stringify\(\{[^}]*\.\.\.meta, memory \}/)
		assert.match(measure, /\.\.\.memoryReportLines\(memory\)/)
	})

	test('memoryNow: forced GC, CDP metrics, UA-specific memory, canvas probe, /proc of all Chromium processes', () => {
		const fn = run.slice(run.indexOf('async function memoryNow('), run.indexOf('async function measure()'))
		for (const re of [/HeapProfiler\.collectGarbage/, /Performance\.getMetrics/, /measureUserAgentSpecificMemory\(\)/,
			/window\.__lab\.canvasMemory\(\)/, /processes: chromiumProcesses\(\)/]) {
			assert.match(fn, re)
		}
		assert.match(run, /MODE === 'measure' \? \['--enable-blink-features=ForceEagerMeasureMemory'\]/)
		assert.match(run, /\/proc\/\$\{pid\}\/fdinfo\/\$\{fd\}/)
	})

	test('lab.js exposes canvasMemory with layer, hit and isolation canvases', () => {
		assert.match(lab, /function canvasMemory\(\)/)
		assert.match(lab, /getHitCanvas\(\)\._canvas/)
		assert.match(lab, /^\tcanvasMemory,$/m)
	})
})
