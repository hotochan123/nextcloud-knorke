/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * GPU evidence of the measurement mode (dev/scene-lab/gpu.js, SPEC-M1 §16):
 * WebKit process kinds, Mesa drivers from /proc/<pid>/maps, DRM engine busy
 * times and their deltas, the masked WebKit renderer string, the verdict.
 * The fdinfo and maps lines are recorded in knorke-lab-* (amdgpu, kernel
 * 6.12, Mesa 23.2.1 of the Playwright image).
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { GFX_MIN_MS, classifyRenderer, engineDelta, gpuReportLines, gpuVerdict, mesaDrivers, parseDrmEngines, webkitKind } from '../gpu.js'

const WPE = '/ms-playwright/webkit-2104/minibrowser-wpe/bin/'
const fdinfo = (client, gfxNs, extra = []) => [
	'pos:\t0', 'flags:\t02100002', 'drm-driver:\tamdgpu', `drm-client-id:\t${client}`, 'drm-pdev:\t0000:cb:00.0',
	'drm-memory-vram:\t18956 KiB', `drm-engine-gfx:\t${gfxNs} ns`, ...extra, '',
].join('\n')

describe('process kinds and drivers', () => {
	test('WebKit (WPE) processes by executable; Chromium, shells and empty cmdlines are not WebKit', () => {
		assert.equal(webkitKind(`${WPE}MiniBrowser\0--inspector-pipe\0--headless\0`), 'ui')
		assert.equal(webkitKind(`${WPE}WPEWebProcess\x0012\x0034\0`), 'web')
		assert.equal(webkitKind(`${WPE}WPENetworkProcess\x0013\0`), 'network')
		assert.equal(webkitKind(`${WPE}WPEGPUProcess\x0014\0`), 'gpu')
		assert.equal(webkitKind('/usr/lib/webkitgtk/WebKitWebProcess 7 9'), 'web')
		assert.equal(webkitKind('/ms-playwright/chromium-1148/chrome-linux/chrome\0--type=gpu-process\0'), null)
		assert.equal(webkitKind('/bin/bash\0/ms-playwright/webkit-2104/pw_run.sh\0'), null)
		assert.equal(webkitKind(''), null)
		assert.equal(webkitKind(null), null)
	})

	test('Mesa drivers from maps: radeonsi vs swrast, each once, sorted', () => {
		const maps = [
			'7f1c2a000000-7f1c2b000000 r-xp 00000000 00:3a 1234 /usr/lib/x86_64-linux-gnu/dri/radeonsi_dri.so',
			'7f1c2b000000-7f1c2b100000 r--p 01000000 00:3a 1234 /usr/lib/x86_64-linux-gnu/dri/radeonsi_dri.so',
			'7f1c2c000000-7f1c2c100000 r-xp 00000000 00:3a 99 /usr/lib/x86_64-linux-gnu/libEGL_mesa.so.0.0.0',
		].join('\n')
		assert.deepEqual(mesaDrivers(maps), ['radeonsi'])
		assert.deepEqual(mesaDrivers('… /usr/lib/x86_64-linux-gnu/dri/swrast_dri.so\n… /usr/lib/x86_64-linux-gnu/dri/kms_swrast_dri.so'), ['kms_swrast', 'swrast'])
		assert.deepEqual(mesaDrivers(''), [])
		assert.deepEqual(mesaDrivers(null), [])
	})
})

describe('DRM engine time', () => {
	test('parse: drm-engine-<name> in ns, other keys ignored; not DRM → null', () => {
		assert.deepEqual(parseDrmEngines(fdinfo(2782, 5787029, ['drm-engine-compute:\t12 ns', 'drm-engine-capacity-gfx:\t1'])),
			{ driver: 'amdgpu', clientId: '2782', engines: { gfx: 5787029, compute: 12 } })
		assert.equal(parseDrmEngines('pos:\t0\nflags:\t02\n'), null)
		assert.equal(parseDrmEngines(''), null)
	})

	test('delta: one client behind several descriptors counts once; new clients count fully; never negative', () => {
		const b = [parseDrmEngines(fdinfo(1, 1000)), parseDrmEngines(fdinfo(1, 1000)), parseDrmEngines(fdinfo(2, 500))]
		const a = [parseDrmEngines(fdinfo(1, 4000)), parseDrmEngines(fdinfo(1, 4000)), parseDrmEngines(fdinfo(2, 400)), parseDrmEngines(fdinfo(3, 700)), null]
		assert.deepEqual(engineDelta(b, a), { clients: 3, engines: { gfx: 3000 + 0 + 700 } })
		assert.deepEqual(engineDelta([], []), { clients: 0, engines: {} })
	})
})

describe('renderer string and verdict', () => {
	test('WebKit masks the renderer ("Apple GPU" everywhere); Chromium names the device', () => {
		assert.equal(classifyRenderer('Apple GPU'), 'masked')
		assert.equal(classifyRenderer('ANGLE (AMD, GFX1103_R1 (gfx1103_r1 LLVM 15.0.7 DRM 3.61 6.12.54-Unraid), OpenGL ES 3.2)'), 'gpu')
		assert.equal(classifyRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), 'software')
		assert.equal(classifyRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), 'software')
		assert.equal(classifyRenderer(''), 'unknown')
		assert.equal(classifyRenderer(null), 'unknown')
	})

	const proc = (kind, drivers, drmFds) => ({ pid: 1, kind, drivers, drmFds, gfxNs: drmFds ? 0 : null })

	test('gpu-confirmed: gfx time ≥ GFX_MIN_MS and a hardware driver (Chromium with KNORKE_GPU=1)', () => {
		const v = gpuVerdict({
			webgl: { renderer: 'ANGLE (AMD, GFX1103_R1 …)', drivers: ['radeonsi'], drmFds: 5 },
			processes: [proc('browser', [], 0), proc('gpu', ['radeonsi'], 5)],
			scenarioEngines: { clients: 2, engines: { gfx: 3429.8e6 } },
		})
		assert.equal(v.verdict, 'gpu-confirmed')
		assert.equal(v.gfxMs, 3429.8)
		assert.equal(v.hwDriver, true)
		assert.equal(v.rendererClass, 'gpu')
		assert.match(v.reasons[0], /gfx engine 3429\.8 ms .*2 DRM clients, 5 \/dev\/dri descriptors/)
	})

	test('software-only: no gfx time, no descriptor, only swrast, also after the WebGL probe (WebKit, with or without /dev/dri)', () => {
		const ev = {
			webgl: { renderer: 'Apple GPU', vendor: 'Apple Inc.', drivers: ['swrast'], drmFds: 0 },
			processes: [proc('ui', [], 0), proc('network', [], 0), proc('web', ['swrast'], 0)],
			scenarioEngines: { clients: 0, engines: {} },
		}
		const v = gpuVerdict(ev)
		assert.equal(v.verdict, 'software-only')
		assert.equal(v.swDriver, true)
		assert.equal(v.rendererClass, 'masked')
		const md = gpuReportLines({ ...ev, verdict: v, launch: { note: 'Playwright-Starter (pw_run.sh) mit WEBKIT_SKIA_ENABLE_CPU_RENDERING=1' } }).join('\n')
		assert.match(md, /Urteil: \*\*nur Software\*\* \(software-only\)/)
		assert.match(md, /WebKit nennt immer „Apple GPU“, kein Beleg/)
		assert.match(md, /\| web \| 1 \| swrast \| 0 \| – \|/)
		assert.match(md, /Start: Playwright-Starter/)
	})

	test('unclear: a descriptor or a hardware driver without enough gfx time, or a WebGL probe that reached the GPU', () => {
		const base = { webgl: null, scenarioEngines: { clients: 1, engines: { gfx: (GFX_MIN_MS - 1) * 1e6 } } }
		assert.equal(gpuVerdict({ ...base, processes: [proc('gpu', ['radeonsi'], 2)] }).verdict, 'unclear')
		assert.equal(gpuVerdict({ ...base, scenarioEngines: { clients: 0, engines: {} }, processes: [proc('web', ['swrast'], 1)] }).verdict, 'unclear')
		assert.equal(gpuVerdict({
			webgl: { renderer: 'Apple GPU', drivers: ['radeonsi'], drmFds: 1 },
			processes: [proc('web', ['swrast'], 0)], scenarioEngines: { clients: 0, engines: {} },
		}).verdict, 'unclear')
		assert.equal(gpuVerdict({ ...base, scenarioEngines: { clients: 1, engines: { gfx: 500e6 } }, processes: [proc('web', ['zink'], 1)] }).verdict, 'unclear')
	})
})
