/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Memory section of the measurement report for a browser without CDP
 * (dev/scene-lab/memory.js plainSnapshot and the WebKit branch of
 * memoryReportLines): the Chromium-only sizes are "n/a", never a number;
 * canvas probe and /proc sizes are reported. The Chromium branch is covered
 * by tests/js/scene/labMemory.test.mjs.
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { memoryReportLines, plainSnapshot } from '../memory.js'

const MIB = 1024 ** 2
const canvases = {
	dom: 2, pixelRatio: 2,
	list: [{ name: 'static', w: 2560, h: 1600 }, { name: 'static:hit', w: 0, h: 0 }, { name: 'overlay', w: 2560, h: 1600 }],
}
const procs = (web) => [
	{ pid: 18, kind: 'ui', pss: 86 * MIB, rss: 120 * MIB, drm: [] },
	{ pid: 36, kind: 'network', pss: 41 * MIB, rss: 60 * MIB, drm: [] },
	{ pid: 37, kind: 'web', pss: web * MIB, rss: (web + 100) * MIB, drm: [] },
]

describe('plainSnapshot (WebKit)', () => {
	test('Chromium-only sizes stay null, canvases and processes are summarised', () => {
		const s = plainSnapshot({ browser: 'webkit', canvases, processes: procs(436) })
		for (const k of ['jsHeapUsed', 'jsHeapTotal', 'domNodes', 'documents', 'listeners', 'ua']) assert.equal(s[k], null, k)
		assert.equal(s.uaError, 'n/a in webkit')
		assert.equal(s.canvases.bytes, 2 * 2560 * 1600 * 4)
		assert.equal(s.processes.n, 3)
		assert.equal(s.processes.total.pss, (86 + 41 + 436) * MIB)
		assert.equal(s.processes.byKind.web.pss, 436 * MIB)
		assert.equal(s.processes.pageRenderer, null)
	})
})

describe('memoryReportLines for WebKit', () => {
	const memory = {
		browser: 'webkit', gpu: true, gpuInfo: null, idleMs: 10000,
		settled: plainSnapshot({ browser: 'webkit', canvases, processes: procs(436) }),
		after: plainSnapshot({ browser: 'webkit', canvases, processes: procs(656) }),
		idle: plainSnapshot({ browser: 'webkit', canvases, processes: procs(628) }),
	}
	const md = memoryReportLines(memory).join('\n')

	test('n/a for heap, UA memory and DOM; measured canvas and process rows; no Chromium rows', () => {
		assert.match(md, /\| JS-Heap belegt \(MiB\) \| n\/a \| n\/a \| n\/a \|/)
		assert.match(md, /\| measureUserAgentSpecificMemory \(MiB\) \| n\/a \| n\/a \| n\/a \|/)
		assert.match(md, /\| DOM-Knoten \| n\/a \| n\/a \| n\/a \|/)
		assert.match(md, /\| Canvas-Backing-Stores nominal \(MiB\) \| 31\.3 \| 31\.3 \| 31\.3 \|/)
		assert.match(md, /\| Prozess web PSS \(MiB\) \| 436 \| 656 \| 628 \|/)
		assert.match(md, /\| alle webkit-Prozesse PSS \(MiB\) \| 563 \| 783 \| 755 \|/)
		assert.match(md, /GPU-Lauf \(\/dev\/dri im Container\)/)
		assert.doesNotMatch(md, /Chromium-Prozesse|Renderer der Seite|GPU-Prozess|GPU-Speicher/)
		// no row of the Chromium table shows a number where WebKit has none
		assert.doesNotMatch(md, /JS-Heap belegt \(MiB\) \| \d/)
	})

	test('the Chromium branch is untouched when browser is chromium or missing', () => {
		const chromium = memoryReportLines({ ...memory, browser: 'chromium' }).join('\n')
		assert.match(chromium, /alle Chromium-Prozesse/)
		const legacy = memoryReportLines({ ...memory, browser: undefined }).join('\n')
		assert.match(legacy, /alle Chromium-Prozesse/)
	})
})
