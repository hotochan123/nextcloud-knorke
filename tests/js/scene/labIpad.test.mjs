/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Support of the iPad session R-A (SPEC-M1 §8.8, §9.1 WP-S0): the package
 * from dev/scene-lab/run.sh ipad, its static server for the Mac
 * (dev/scene-lab/ipad/serve.mjs), the measurement panel of the lab
 * (?panel=1, dev/scene-lab/panel.js) and the whole-board scenario in
 * __lab.measure() that the decision rule of §8.8 point 6 reads.
 */
import { test, describe, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { ROOT, stripComments } from './sourceScan.mjs'
import { parseArgs, resolvePath, serve } from '../../../dev/scene-lab/ipad/serve.mjs'
import { panelRows } from '../../../dev/scene-lab/panel.js'

const IPAD = join(ROOT, 'dev/scene-lab/ipad')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

describe('serve.mjs (static server on the Mac)', () => {
	test('paths stay inside the package', () => {
		assert.equal(resolvePath('/pkg', '/'), '/pkg/index.html')
		assert.equal(resolvePath('/pkg', '/lab/'), '/pkg/lab/index.html')
		assert.equal(resolvePath('/pkg', '/lab/?panel=1'), '/pkg/lab/index.html')
		assert.equal(resolvePath('/pkg', '/bench/bench-standalone.html'), '/pkg/bench/bench-standalone.html')
		assert.equal(resolvePath('/pkg', '/../etc/passwd'), '/pkg/etc/passwd')
		assert.equal(resolvePath('/pkg', '/%2e%2e/etc/passwd'), '/pkg/etc/passwd')
		assert.equal(resolvePath('/pkg', '/..%2f..%2fetc/passwd'), null)
		assert.equal(resolvePath('/pkg', '/a%00b'), null)
		assert.equal(resolvePath('/pkg', '/%E0%A4%A'), null)
	})

	test('bind address is required, port 1024–65535', () => {
		assert.deepEqual(parseArgs(['192.168.1.20']), { host: '192.168.1.20', port: 8000 })
		assert.deepEqual(parseArgs(['192.168.1.20', '8123']), { host: '192.168.1.20', port: 8123 })
		assert.deepEqual(parseArgs(['fd00::5', '9000']), { host: 'fd00::5', port: 9000 })
		assert.equal(parseArgs([]), null)
		assert.equal(parseArgs(['mac.local']), null)
		assert.equal(parseArgs(['192.168.1.20', '80']), null)
		assert.equal(parseArgs(['192.168.1.20', 'x']), null)
	})

	describe('over HTTP (serving dev/scene-lab/ipad on 127.0.0.1)', () => {
		let server
		let port
		const startLines = []
		before(async () => {
			const log = console.log
			console.log = (...a) => startLines.push(a.join(' '))
			server = serve(IPAD, '127.0.0.1', 0)
			await new Promise((resolve) => server.once('listening', resolve))
			console.log = log
			port = server.address().port
		})

		test('start lines name the bound port and the three entry points', () => {
			assert.ok(port > 0)
			assert.ok(startLines.some((l) => l.includes(`http://127.0.0.1:${port}/lab/?panel=1`)), startLines.join('\n'))
			assert.ok(startLines.some((l) => l.includes(`http://127.0.0.1:${port}/bench/bench-standalone.html`)))
		})
		after(() => new Promise((resolve) => server.close(resolve)))

		const fetchRaw = (method, path) => new Promise((resolve, reject) => {
			const log = console.log
			console.log = () => {}
			const req = request({ host: '127.0.0.1', port, method, path }, (res) => {
				const chunks = []
				res.on('data', (c) => chunks.push(c))
				res.on('end', () => {
					console.log = log
					resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
				})
			})
			req.on('error', (e) => {
				console.log = log
				reject(e)
			})
			req.end()
		})

		test('start page with COOP/COEP and no-store', async () => {
			const r = await fetchRaw('GET', '/')
			assert.equal(r.status, 200)
			assert.match(r.headers['content-type'], /^text\/html/)
			assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin')
			assert.equal(r.headers['cross-origin-embedder-policy'], 'require-corp')
			assert.equal(r.headers['cache-control'], 'no-store')
			assert.match(r.body, /href="lab\/\?panel=1"/)
			assert.match(r.body, /href="bench\/bench-standalone\.html"/)
		})

		test('HEAD without body, 405 for other methods, 404 outside and for missing files', async () => {
			const h = await fetchRaw('HEAD', '/index.html')
			assert.equal(h.status, 200)
			assert.equal(h.body, '')
			assert.equal((await fetchRaw('POST', '/')).status, 405)
			assert.equal((await fetchRaw('GET', '/nope.html')).status, 404)
			assert.equal((await fetchRaw('GET', '/..%2frun.sh')).status, 404)
			assert.equal((await fetchRaw('GET', '/../run.sh')).status, 404)
		})
	})
})

describe('measurement panel (?panel=1)', () => {
	test('rows: first renders, five automatic scenarios (R12: the whole-board pan too), numbered hand runs', () => {
		const f = (fps) => ({ frames: { fps, p50: 16.7, p95: 18.2, pctMissed: 2.5 } })
		const rows = panelRows({
			auto: { firstRenderMs: 412.4, fit: { ms: 690.2, scale: 0.05 }, pan: f(59.9), zoom: f(58), drag: f(60), board: f(27.25), boardPan: f(59.7) },
			hand: [{ kind: 'pan', data: f(55) }, { kind: 'pinch', data: f(40) }, { kind: 'pan', data: f(54) }],
		})
		assert.deepEqual(rows.map((r) => r[0]), [
			'Erstes Rendern (Laden), ms', 'Erstes Rendern ganzes Board (5 %), ms', 'Schwenken (auto)', 'Zoomen (auto)',
			'Notiz ziehen (auto)', 'Ganzes Board zoomen (auto)', 'Ganzes Board schwenken (auto)', 'Hand: Schwenk #1', 'Hand: Pinch #1',
			'Hand: Schwenk #2',
		])
		assert.equal(rows[0][1], '412')
		assert.equal(rows[1][1], '690')
		assert.deepEqual(rows[5].slice(1), ['27,3', '16,7', '18,2', '2,5'])
		assert.deepEqual(rows[6].slice(1), ['59,7', '16,7', '18,2', '2,5'])
		// every "(auto)" row of the panel is a row of the instruction sheet's protocol table
		const sheet = read('dev/scene-lab/ipad/ANLEITUNG-R-A.md')
		for (const r of rows.filter((x) => x[0].endsWith('(auto)'))) assert.ok(sheet.includes(`| ${r[0]}: fps / p95 / verpasst % |`), r[0])
		assert.deepEqual(panelRows({ auto: null, hand: [] }), [])
		assert.deepEqual(panelRows({ auto: { fit: null }, hand: [] })[1].slice(0, 2), ['Erstes Rendern ganzes Board (– %), ms', '–'])
	})

	test('panel only with ?panel=1, no HTML sinks, labels match the instruction sheet', () => {
		const lab = stripComments(read('dev/scene-lab/lab.js'))
		assert.match(lab, /if \(params\.get\('panel'\) === '1'\) mountPanel\(window\.__lab\)/)
		const panel = stripComments(read('dev/scene-lab/panel.js'))
		assert.doesNotMatch(panel, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
		const sheet = read('dev/scene-lab/ipad/ANLEITUNG-R-A.md')
		for (const label of ['Automatik-Messung', 'Hand: 5 s Schwenk', 'Hand: 5 s Pinch', 'JSON kopieren']) {
			assert.ok(panel.includes(`'${label}'`), `panel: ${label}`)
			assert.ok(sheet.includes(label), `sheet: ${label}`)
		}
	})
})

describe('__lab.measure(): whole board for the decision rule (§8.8 point 6)', () => {
	const lab = stripComments(read('dev/scene-lab/lab.js'))
	const measure = lab.slice(lab.indexOf('async function measure()'), lab.indexOf('async function fitRender()'))

	test('first render of the whole board and the zoom between fit and 2 × fit', () => {
		assert.match(measure, /result\.fit = await fitRender\(\)/)
		assert.match(measure, /await run\('board', 180,/)
		assert.match(lab, /function fitRender\(\)[\s\S]*scene\.fit\(\)[\s\S]*drawLog\.slice\(before\)\.find\(\(d\) => d\.layer === 'static'\)/)
		assert.match(lab, /^\tmeterFor,$/m)
		assert.match(lab, /^\tdevice,$/m)
	})

	test('the report of run.sh measure shows both', () => {
		const run = stripComments(read('dev/scene-lab/run.mjs'))
		assert.match(run, /row\('Ganzes Board zoomen \(fit … 2 × fit\)', d\.board\)/)
		assert.match(run, /erstes Rendern des ganzen Boards/)
	})
})

describe('run.sh ipad: package for the Mac', () => {
	const sh = read('dev/scene-lab/run.sh').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
	const pack = sh.slice(sh.indexOf('if [ "$MODE" = ipad ]; then'), sh.indexOf('chown "$RUN_UID:$RUN_UID"'))

	test('lab dist, bench copy, server, start page, sheet, manifest and archive below out/', () => {
		assert.ok(pack.length > 100, 'ipad branch found')
		assert.match(pack, /BENCH="\$\{KNORKE_BENCH_HTML:-\$ROOT\/\.\.\/knorke-spike\/engine\/dist\/bench-standalone\.html\}"/)
		assert.match(pack, /PKG="\$OUT\/ipad-ra"/)
		assert.match(pack, /rm -rf -- "\$\{PKG:\?\}"/)
		assert.match(pack, /cp -R "\$HERE\/dist\/\." "\$PKG\/lab\/"/)
		assert.match(pack, /cp "\$BENCH" "\$PKG\/bench\/bench-standalone\.html"/)
		assert.match(pack, /cp "\$HERE\/ipad\/serve\.mjs" "\$HERE\/ipad\/index\.html" "\$HERE\/ipad\/ANLEITUNG-R-A\.md" "\$PKG\/"/)
		assert.match(pack, /sha256sum/)
		assert.match(pack, /tar -czf "\$OUT\/ipad-ra\.tar\.gz"/)
		assert.doesNotMatch(pack, /\bssh\b|\bscp\b|rsync/)
	})

	test('the package is then checked in Chromium and WebKit inside the lab container', () => {
		const check = stripComments(read('dev/scene-lab/ipad/check.mjs'))
		assert.match(check, /import \{ chromium, devices, webkit \} from 'playwright'/)
		assert.match(check, /opt\('browsers', 'chromium,webkit'\)/)
		assert.match(check, /devices\['iPad Pro 11 landscape'\]/)
		assert.match(check, /serve\(PKG, '127\.0\.0\.1', 0\)/)
		for (const label of ['Automatik-Messung', 'Hand: 5 s Schwenk', 'JSON kopieren', 'Messung starten']) {
			assert.ok(check.includes(`name: '${label}'`), label)
		}
		// R18-C2: the report names come from names.js (ipad-check[-<label>].{json,md}, copy ipad-check.*),
		// written through writeReport only (dev/scene-lab/test/names.test.mjs pins the details)
		assert.match(check, /const FILES = reportFiles\(\{ mode: 'ipad', label: LABEL \}\)/)
		assert.deepEqual([...check.matchAll(/writeFileSync\(join\(OUT, ([^)]+)\)/g)].map((m) => m[1]), ['name'], 'one write under OUT, inside writeReport')
		assert.equal([...check.matchAll(/writeReport\('(json|md)', /g)].length, 2, 'ipad-check json and md')
		assert.match(check, /const OUT = process\.env\.KNORKE_LAB_OUT \|\| '\/out'/)
	})
})
