/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Run evidence of dev/selftest/upgrade.sh (SPEC-M1 §9.0 R15 point 2, R16,
 * TST-12): the upgrade run writes its reports per database under their own
 * names, upgrade-<db>-{seed,verify,contract}[-<label>].{md,json} in
 * dev/sim/out/<ns>/, with <db> = the value of --db verbatim and the optional
 * run label KD_RUN_LABEL (^[a-z0-9-]{1,24}$) appended to the stem. Before
 * this, every run wrote upgrade-seed.md, upgrade-verify.md and contract.md,
 * and the second run of a wave (pgsql, then mariadb-utf8mb3 in the same
 * namespace br) overwrote the first one's evidence.
 *
 * - dev/sim/lib/report.mjs: KD_REPORT_STEM replaces the suite name as the
 *   file stem (checked; never a path), Suite.finish writes exactly
 *   <stem>.{json,md}
 * - upgrade.sh: report_stem builds the names, the three suites get
 *   KD_REPORT_STEM, the step lines name the files, an invalid KD_RUN_LABEL
 *   is refused before any docker call
 * No Docker, no stack. Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reportStem, REPORT_STEM_RE, Suite } from '../sim/lib/report.mjs'
import { SIM_DIR } from '../sim/lib/env.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const UPG = fs.readFileSync(path.join(ROOT, 'dev/selftest/upgrade.sh'), 'utf8')

/** The bash function report_stem of upgrade.sh, run for --db <db> and KD_RUN_LABEL <label>. */
function stemOf(db, label, part) {
	const fn = UPG.match(/^report_stem\(\) \{ .* \}$/m)?.[0]
	assert.ok(fn, 'upgrade.sh defines report_stem() on one line')
	const r = spawnSync('bash', ['-c', `DBSEL="$1"; RUN_LABEL="$2"; ${fn}; report_stem "$3"`, '_', db, label, part], { encoding: 'utf8' })
	assert.equal(r.status, 0, r.stderr)
	return r.stdout
}

test('reportStem: the suite name without KD_REPORT_STEM, the stem with it, never a path', () => {
	assert.equal(reportStem('contract', {}), 'contract')
	assert.equal(reportStem('contract', { KD_REPORT_STEM: '' }), 'contract')
	assert.equal(reportStem('contract', { KD_REPORT_STEM: 'upgrade-pgsql-contract' }), 'upgrade-pgsql-contract')
	assert.equal(reportStem('upgrade-seed', { KD_REPORT_STEM: 'upgrade-mariadb-utf8mb3-seed-r1w2' }), 'upgrade-mariadb-utf8mb3-seed-r1w2')
	for (const bad of ['../contract', 'a/b', 'Upgrade', 'x.md', '-x', 'a b', 'x'.repeat(81)]) {
		assert.throws(() => reportStem('contract', { KD_REPORT_STEM: bad }), /KD_REPORT_STEM/, bad)
	}
	assert.ok(REPORT_STEM_RE.test('upgrade-mysql-utf8mb3-verify-' + 'a'.repeat(24)), 'the longest stem upgrade.sh builds fits')
})

test('Suite.finish writes exactly <KD_REPORT_STEM>.{json,md} (no copy under the suite name)', async (t) => {
	const ns = 'simtestr'
	const dir = path.join(SIM_DIR, 'out', ns)
	assert.ok(!fs.existsSync(dir), `${dir} exists – remove it first`)
	const before = { ns: process.env.KD_NS, stem: process.env.KD_REPORT_STEM }
	const log = console.log
	t.after(() => {
		console.log = log
		for (const [k, v] of [['KD_NS', before.ns], ['KD_REPORT_STEM', before.stem]]) {
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
		}
		fs.rmSync(dir, { recursive: true, force: true })
	})
	process.env.KD_NS = ns
	process.env.KD_REPORT_STEM = 'upgrade-pgsql-contract-r1w2'
	console.log = () => {}
	const s = new Suite('contract')
	await s.run('C01', 'eins', (x) => { x.check(true, 'ok') })
	const code = s.finish({ ns })
	console.log = log
	assert.equal(code, 0)
	assert.deepEqual(fs.readdirSync(dir).sort(), ['upgrade-pgsql-contract-r1w2.json', 'upgrade-pgsql-contract-r1w2.md'])
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'upgrade-pgsql-contract-r1w2.json'), 'utf8')).suite, 'contract', 'the suite name stays in the report')
})

test('upgrade.sh: upgrade-<db>-<part>[-<label>] with <db> = --db verbatim (R16)', () => {
	assert.equal(stemOf('pgsql', '', 'contract'), 'upgrade-pgsql-contract')
	assert.equal(stemOf('mariadb-utf8mb3', '', 'seed'), 'upgrade-mariadb-utf8mb3-seed')
	assert.equal(stemOf('pgsql', 'r1w2', 'contract'), 'upgrade-pgsql-contract-r1w2')
	assert.equal(stemOf('mysql-utf8mb3', 'w2-b', 'verify'), 'upgrade-mysql-utf8mb3-verify-w2-b')
	for (const db of ['pgsql', 'mariadb', 'mysql', 'sqlite', 'mariadb-utf8mb3', 'mysql-utf8mb3']) {
		assert.ok(UPG.includes(db), `--db ${db} exists`)
		assert.match(stemOf(db, 'x', 'contract'), REPORT_STEM_RE, `${db}: a stem report.mjs accepts`)
	}
})

test('upgrade.sh hands the stems to all three suites and names the files in its step lines', () => {
	for (const [part, cmd] of [
		['seed', /KD_REPORT_STEM="\$\(report_stem seed\)" node "\$DEV\/selftest\/lib\/upgrade-data\.mjs" seed/],
		['verify', /KD_REPORT_STEM="\$\(report_stem verify\)" node "\$DEV\/selftest\/lib\/upgrade-data\.mjs" verify/],
		['contract', /KD_REPORT_STEM="\$\(report_stem contract\)" "\$DEV\/sim\/run\.sh" contract/],
	]) {
		assert.match(UPG, cmd, `${part}: KD_REPORT_STEM for the suite`)
		assert.ok(UPG.includes(`dev/sim/out/$NS/$(report_stem ${part}).md`), `${part}: the step line names the file`)
	}
	assert.doesNotMatch(UPG, /out\/\$NS\/(upgrade-seed|upgrade-verify|contract)\.md/, 'no generic report name left')
	const label = UPG.indexOf('RUN_LABEL="${KD_RUN_LABEL:-}"')
	assert.ok(label > 0 && label < UPG.indexOf('for d in "$M0_DIR" "$M1_DIR"'), 'the label is checked first, before the code dirs and any docker call')
	assert.match(UPG, /\[\[ "\$RUN_LABEL" =~ \^\[a-z0-9-\]\{1,24\}\$ \]\]/, 'label regex of §9.0')
})

test('upgrade.sh refuses an invalid KD_RUN_LABEL before any docker call and accepts a valid one', async (t) => {
	const { Sandbox } = await import('./lib/sandbox.mjs')
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	for (const bad of ['R1', 'r1_w2', 'a'.repeat(25), 'x y', '../x']) {
		sb.rules([])
		const r = sb.run('selftest/upgrade.sh', ['--db', 'pgsql'], { KD_RUN_LABEL: bad })
		assert.notEqual(r.status, 0, bad)
		assert.match(r.stderr, /KD_RUN_LABEL .* ist ungültig/, `${bad}: ${r.stderr}`)
		assert.doesNotMatch(r.stderr, /info\.xml fehlt|nicht älter|knorke-main\.mjs fehlt/, `${bad}: refused right there, before the code dirs`)
		assert.deepEqual(sb.calls(), [], `${bad}: no docker call`)
	}
	// a valid label passes the check: the run stops later, at the missing M0 snapshot of the sandbox
	sb.rules([])
	const ok = sb.run('selftest/upgrade.sh', ['--db', 'mariadb-utf8mb3'], { KD_RUN_LABEL: 'r1w2' })
	assert.doesNotMatch(ok.stderr, /KD_RUN_LABEL/, ok.stderr)
	assert.match(ok.stderr, /\/\.knorke-m1-phase\/0\.0\/appinfo\/info\.xml fehlt/)
	assert.deepEqual(sb.calls(), [])
})
