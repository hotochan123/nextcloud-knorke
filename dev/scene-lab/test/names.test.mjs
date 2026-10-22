/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Run evidence of the lab (SPEC-M1 §9.0 (R15) "Laufbelege" point 2 with
 * the (R16) names, TST-12, §9.4 WP-S3, R18-C2): every gates/measure/ipad run
 * writes its reports under its own name and keeps gates.*, measure.json,
 * report.md and ipad-check.* as copies of the last run.
 * - names.js: gates-<cpu|gpu>[-<label>].{json,md};
 *   measure-<chromium|webkit>-<cpu|gpu>[-<set>][-noshadow][-<label>].json
 *   and report-<same>.md; the set only when it is not m1; -noshadow after
 *   the set for --shadows off (K8, RSC-03, SPEC-M1 §8.5 / §9.0 point 2 R20);
 *   ipad-check[-<label>].{json,md}; labels ^[a-z0-9-]{1,24}$, anything
 *   else throws
 * - run.mjs and ipad/check.mjs: take --label (checked against LABEL_RE),
 *   remove this run's files before the browser or the servers start and
 *   write every report through writeReport (own name + copy), nothing else
 *   under OUT
 * - run.sh: KNORKE_LAB_LABEL checked with the same pattern for gates,
 *   measure and ipad (not dist), handed on as --label; an invalid label dies
 *   before the lock, the build and any docker call (run for real below, with
 *   docker, flock and node replaced by stubs that only log)
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LABEL_RE, reportFiles } from '../names.js'

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(LAB, p), 'utf8')
const rawSh = read('run.sh')
/** run.sh without comment lines */
const sh = rawSh.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
const runMjs = read('run.mjs')
const checkMjs = read('ipad/check.mjs')

describe('names.js', () => {
	test('gates: gates-<variant>[-<label>], copies gates.json/gates.md', () => {
		assert.deepEqual(reportFiles({ mode: 'gates', gpu: false }), { json: 'gates-cpu.json', md: 'gates-cpu.md', copies: { json: 'gates.json', md: 'gates.md' } })
		assert.deepEqual(reportFiles({ mode: 'gates', gpu: true, label: 'r1static' }), { json: 'gates-gpu-r1static.json', md: 'gates-gpu-r1static.md', copies: { json: 'gates.json', md: 'gates.md' } })
		assert.equal(reportFiles({ mode: 'gates', gpu: 'yes' }).json, 'gates-cpu.json', 'only true is gpu')
		assert.equal(reportFiles({ mode: 'gates', gpu: true, browser: 'webkit', set: 'noconn' }).json, 'gates-gpu.json', 'browser and set do not name gates')
	})

	test('measure: measure-<browser>-<variant>[-<set>][-<label>].json and report-<same>.md, copies measure.json/report.md', () => {
		const cases = [
			[{ gpu: false }, 'chromium-cpu'],
			[{ gpu: true }, 'chromium-gpu'],
			[{ gpu: true, browser: 'webkit' }, 'webkit-gpu'],
			[{ gpu: false, browser: 'webkit', set: 'noconn' }, 'webkit-cpu-noconn'],
			[{ gpu: true, set: 'm1', label: 'w2' }, 'chromium-gpu-w2'],
			[{ gpu: true, set: 'noconn', label: 'ab-1' }, 'chromium-gpu-noconn-ab-1'],
		]
		for (const [o, stem] of cases) {
			assert.deepEqual(reportFiles({ mode: 'measure', ...o }), { json: `measure-${stem}.json`, md: `report-${stem}.md`, copies: { json: 'measure.json', md: 'report.md' } }, stem)
		}
	})

	test('K8 (RSC-03): --shadows off appends -noshadow after the set (before the label); it never overwrites the run with shadows', () => {
		const copies = { json: 'measure.json', md: 'report.md' }
		const cases = [
			[{ gpu: false, shadows: 'off' }, 'chromium-cpu-noshadow'],
			[{ gpu: true, browser: 'webkit', shadows: 'off' }, 'webkit-gpu-noshadow'],
			[{ gpu: false, browser: 'webkit', set: 'noconn', shadows: 'off' }, 'webkit-cpu-noconn-noshadow'],
			[{ gpu: true, set: 'm1', shadows: 'off', label: 'p1-s' }, 'chromium-gpu-noshadow-p1-s'],
			[{ gpu: true, set: 'noconn', shadows: 'off', label: 'ab-1' }, 'chromium-gpu-noconn-noshadow-ab-1'],
			[{ gpu: false, browser: 'webkit', shadows: 'on', label: 'p1-s' }, 'webkit-cpu-p1-s'],
		]
		for (const [o, stem] of cases) {
			assert.deepEqual(reportFiles({ mode: 'measure', ...o }), { json: `measure-${stem}.json`, md: `report-${stem}.md`, copies }, stem)
		}
		// shadows on is the default and adds nothing
		assert.deepEqual(reportFiles({ mode: 'measure', gpu: true, browser: 'webkit', set: 'noconn', shadows: 'on', label: 'w2' }),
			reportFiles({ mode: 'measure', gpu: true, browser: 'webkit', set: 'noconn', label: 'w2' }))
		// the same browser, variant, set and label with and without shadows: four distinct files
		for (const browser of ['chromium', 'webkit']) {
			for (const set of ['m1', 'noconn']) {
				for (const label of [null, 'r1']) {
					const on = reportFiles({ mode: 'measure', gpu: true, browser, set, shadows: 'on', label })
					const off = reportFiles({ mode: 'measure', gpu: true, browser, set, shadows: 'off', label })
					assert.equal(new Set([on.json, on.md, off.json, off.md]).size, 4, `${browser} ${set} ${label}`)
				}
			}
		}
		for (const bad of ['', 'no', 'OFF', true, false, null, 0]) {
			assert.throws(() => reportFiles({ mode: 'measure', gpu: false, shadows: bad }), /invalid shadows/, JSON.stringify(bad))
		}
		// gates and the ipad check never measure without shadows (run.mjs refuses --shadows off outside measure): no suffix
		assert.equal(reportFiles({ mode: 'gates', gpu: false, shadows: 'off' }).json, 'gates-cpu.json')
		assert.equal(reportFiles({ mode: 'ipad', shadows: 'off', label: 'r1' }).json, 'ipad-check-r1.json')
	})

	test('ipad (R18-C2): ipad-check[-<label>].{json,md}, copies ipad-check.json/ipad-check.md', () => {
		const copies = { json: 'ipad-check.json', md: 'ipad-check.md' }
		assert.deepEqual(reportFiles({ mode: 'ipad' }), { json: 'ipad-check.json', md: 'ipad-check.md', copies }, 'without a label the report is its own copy')
		assert.deepEqual(reportFiles({ mode: 'ipad', label: 'closeout-s' }), { json: 'ipad-check-closeout-s.json', md: 'ipad-check-closeout-s.md', copies })
		assert.deepEqual(reportFiles({ mode: 'ipad', label: null }), reportFiles({ mode: 'ipad' }))
		assert.deepEqual(reportFiles({ mode: 'ipad', gpu: true, browser: 'webkit', set: 'noconn', label: 'r1' }), reportFiles({ mode: 'ipad', label: 'r1' }),
			'variant, browser and set do not name the ipad check (it drives both engines itself)')
		for (const bad of ['Bad_Label', '', 'R1', '../x', '0123456789abcdefghijklmno']) {
			assert.throws(() => reportFiles({ mode: 'ipad', label: bad }), /invalid run label/, JSON.stringify(bad))
		}
	})

	test('labels: ^[a-z0-9-]{1,24}$; an invalid label, browser, set or mode throws', () => {
		for (const ok of ['a', 'r1static', 'w1-full', '0123456789abcdefghijklmn']) assert.ok(LABEL_RE.test(ok), ok)
		for (const bad of ['', 'R1', 'r_1', 'r.1', 'r 1', '0123456789abcdefghijklmno', '../x', 'ä', 'r1\n']) {
			assert.ok(!LABEL_RE.test(bad), JSON.stringify(bad))
			assert.throws(() => reportFiles({ mode: 'gates', gpu: false, label: bad }), /invalid run label/)
		}
		assert.equal(reportFiles({ mode: 'gates', gpu: false, label: null }).json, 'gates-cpu.json')
		assert.throws(() => reportFiles({ mode: 'measure', gpu: false, browser: 'firefox' }), /browser/)
		assert.throws(() => reportFiles({ mode: 'measure', gpu: false, set: '../x' }), /set/)
		// dist writes no report; anything that is not gates, measure or ipad has no names
		for (const mode of ['dist', 'ipad-ra', 'IPAD', undefined]) assert.throws(() => reportFiles({ mode, gpu: false }), /mode/, String(mode))
	})

	test('two runs of one variant in a phase stay apart only with a label; distinct variants and modes never collide', () => {
		const names = new Set()
		const add = (f) => {
			for (const n of [f.json, f.md]) {
				assert.ok(!names.has(n), n)
				names.add(n)
			}
		}
		for (const gpu of [false, true]) {
			for (const label of [null, 'r1', 'r2']) add(reportFiles({ mode: 'gates', gpu, label }))
		}
		for (const label of [null, 'r1', 'r2']) add(reportFiles({ mode: 'ipad', label }))
	})
})

describe('run.mjs, ipad/check.mjs and run.sh use the names', () => {
	test('run.mjs: --label checked against LABEL_RE, --shadows passed to the names (K8), the files of this run removed before the browser starts', () => {
		assert.match(runMjs, /import \{ LABEL_RE, reportFiles \} from '\.\/names\.js'/)
		assert.match(runMjs, /const LABEL = opt\('label', null\)/)
		assert.match(runMjs, /LABEL !== null && \(typeof LABEL !== 'string' \|\| !LABEL_RE\.test\(LABEL\)\)/)
		// K8: run.mjs hands --shadows to the names
		const files = runMjs.indexOf('const FILES = reportFiles({ mode: MODE, gpu: GPU, browser: BROWSER, set: SET, shadows: SHADOWS, label: LABEL })')
		const shadows = runMjs.indexOf("const SHADOWS = String(opt('shadows', 'on'))")
		assert.ok(shadows > 0 && files > shadows, 'SHADOWS is read before the names')
		const unlink = runMjs.indexOf('unlinkSync(join(OUT, name))')
		const launch = runMjs.indexOf('const browser = IS_CHROMIUM')
		assert.ok(files > 0 && unlink > files && launch > unlink, 'names, then unlink, then the browser')
	})

	test('run.mjs: every report goes through writeReport (own name and the copy); no other write under OUT', () => {
		const writes = [...runMjs.matchAll(/writeFileSync\(join\(OUT, ([^)]+)\)/g)].map((m) => m[1])
		assert.deepEqual(writes, ['name'], 'one write, inside writeReport')
		assert.match(runMjs, /for \(const name of \[FILES\[kind\], FILES\.copies\[kind\]\]\) writeFileSync\(join\(OUT, name\), content\)/)
		assert.equal([...runMjs.matchAll(/writeReport\('json', /g)].length, 2, 'gates.json and measure.json')
		assert.equal([...runMjs.matchAll(/writeReport\('md', /g)].length, 2, 'gates.md and report.md')
	})

	test('ipad/check.mjs (R18-C2): --label checked against LABEL_RE, names of mode ipad, files removed before the servers start, every report through writeReport', () => {
		assert.match(checkMjs, /import \{ LABEL_RE, reportFiles \} from '\.\.\/names\.js'/)
		assert.match(checkMjs, /const LABEL = opt\('label', null\)/)
		assert.match(checkMjs, /LABEL !== null && \(typeof LABEL !== 'string' \|\| !LABEL_RE\.test\(LABEL\)\)/)
		const files = checkMjs.indexOf("const FILES = reportFiles({ mode: 'ipad', label: LABEL })")
		const unlink = checkMjs.indexOf('unlinkSync(join(OUT, name))')
		const serve = checkMjs.indexOf("const server = serve(PKG, '127.0.0.1', 0)")
		assert.ok(files > 0 && unlink > files && serve > unlink, 'names, then unlink, then the servers')
		const writes = [...checkMjs.matchAll(/writeFileSync\(join\(OUT, ([^)]+)\)/g)].map((m) => m[1])
		assert.deepEqual(writes, ['name'], 'one write, inside writeReport')
		assert.match(checkMjs, /for \(const name of new Set\(\[FILES\[kind\], FILES\.copies\[kind\]\]\)\) writeFileSync\(join\(OUT, name\), content\)/)
		assert.equal([...checkMjs.matchAll(/writeReport\('json', /g)].length, 1, 'ipad-check json')
		assert.equal([...checkMjs.matchAll(/writeReport\('md', /g)].length, 1, 'ipad-check md')
	})

	test('run.sh: KNORKE_LAB_LABEL with the same pattern, for gates, measure and ipad (R18-C2), as --label, checked before the lock', () => {
		assert.match(sh, /LABEL="\$\{KNORKE_LAB_LABEL:-\}"/)
		assert.ok(sh.includes('[[ "$LABEL" =~ ^[a-z0-9-]{1,24}$ ]]'), 'same pattern as LABEL_RE')
		assert.equal(String(LABEL_RE), '/^[a-z0-9-]{1,24}$/')
		const guard = '{ [ "$MODE" = gates ] || [ "$MODE" = measure ] || [ "$MODE" = ipad ]; } || die "KNORKE_LAB_LABEL applies to gates, measure and ipad only"'
		assert.ok(sh.includes(guard), 'gates, measure and ipad take a label')
		const marker = rawSh.indexOf('R18-C2')
		assert.ok(marker > 0 && marker < rawSh.indexOf(guard) && rawSh.indexOf(guard) - marker < 300, 'the R18-C2 comment sits at the guard')
		assert.match(sh, /set -- "\$@" --label "\$LABEL"/)
		assert.match(sh, /ipad\) .*CMD=\(node ipad\/check\.mjs --pkg \/out\/ipad-ra "\$@"\) ;;/, 'the label reaches ipad/check.mjs')
		const at = sh.indexOf('LABEL="${KNORKE_LAB_LABEL:-}"')
		for (const later of ['exec 8>>"$LAB_LOCK"', 'vite.js" build', 'cleanup() { docker', 'docker run']) {
			assert.ok(at > 0 && sh.indexOf(later) > at, `label checked before ${later}`)
		}
	})

	describe('run.sh for real: the label guard, with docker, flock and node as logging stubs', () => {
		const stubs = mkdtempSync(join(tmpdir(), 'knorke-lab-label-'))
		after(() => rmSync(stubs, { recursive: true, force: true }))
		const calls = join(stubs, 'calls.log')
		for (const cmd of ['docker', 'flock', 'node', 'npm']) {
			writeFileSync(join(stubs, cmd), `#!/bin/sh\necho "${cmd} $*" >> '${calls}'\nexit 97\n`)
			chmodSync(join(stubs, cmd), 0o755)
		}
		/**
		 * @param {string} mode run.sh mode
		 * @param {object} env extra environment (on a clean one: PATH with the stubs first, HOME)
		 * @return {{status:number, stderr:string, calls:string}} what run.sh did
		 */
		const runSh = (mode, env) => {
			rmSync(calls, { force: true })
			const r = spawnSync('bash', [join(LAB, 'run.sh'), mode], {
				encoding: 'utf8',
				timeout: 20000,
				env: { PATH: `${stubs}:${process.env.PATH}`, HOME: process.env.HOME ?? '/tmp', ...env },
			})
			return { status: r.status, stderr: r.stderr, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' }
		}

		test('an invalid label dies (exit 1) before the lock, the build and any docker call, in every mode', () => {
			for (const [mode, label] of [['ipad', 'Bad_Label'], ['gates', 'R1'], ['measure', '../x'], ['ipad', '0123456789abcdefghijklmno'], ['dist', 'a b']]) {
				const r = runSh(mode, { KNORKE_LAB_LABEL: label })
				assert.equal(r.status, 1, `${mode} ${label}: ${r.stderr}`)
				assert.ok(r.stderr.includes(`KNORKE_LAB_LABEL='${label}' is invalid`), r.stderr)
				assert.equal(r.calls, '', `${mode} ${label}: no docker, flock or node call`)
			}
		})

		test('dist refuses a valid label; gates, measure and ipad accept it (the next check, an invalid KNORKE_LAB_UID, stops them)', () => {
			const dist = runSh('dist', { KNORKE_LAB_LABEL: 'closeout-s' })
			assert.equal(dist.status, 1)
			assert.ok(dist.stderr.includes('KNORKE_LAB_LABEL applies to gates, measure and ipad only'), dist.stderr)
			assert.equal(dist.calls, '')
			for (const mode of ['gates', 'measure', 'ipad']) {
				const r = runSh(mode, { KNORKE_LAB_LABEL: 'closeout-s', KNORKE_LAB_UID: '0' })
				assert.equal(r.status, 1, `${mode}: ${r.stderr}`)
				assert.ok(r.stderr.includes("KNORKE_LAB_UID='0' is invalid"), `${mode}: ${r.stderr}`)
				assert.ok(!r.stderr.includes('KNORKE_LAB_LABEL'), `${mode}: the label passed`)
				assert.equal(r.calls, '', `${mode}: no docker, flock or node call`)
			}
		})
	})
})
