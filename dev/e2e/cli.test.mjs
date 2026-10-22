/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Host-side self-test of the E2E runner's pure helpers (lib/cli.mjs): the
 * flake gate `--only E03,E04,E04b --repeat N` must parse, select the right
 * scenarios (E04b has a lower-case b), refuse unknown ids instead of running
 * nothing, count green runs per scenario, and the red report must carry the
 * whole /sync trace. No browser, no stack. Run:
 *   node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, selectScenarios, flakeSummary, traceMarkdown, MAX_REPEAT, reportId } from './lib/cli.mjs'

const ALL = ['E01', 'E02', 'E03', 'E04', 'E04b', 'E05', 'E06', 'E07', 'E08', 'E10', 'E11', 'E12', 'E09'].map((id) => ({ id }))

test('the flake gate command line parses', () => {
	const a = parseArgs(['--only', 'E03,E04,E04b', '--repeat', '8'])
	assert.deepEqual([...a.only], ['E03', 'E04', 'E04B'])
	assert.equal(a.repeat, 8)
	assert.equal(a.list, false)
	assert.equal(a.selftest, false)
	assert.deepEqual(parseArgs(['--repeat=3', '--only=e04b']), { only: new Set(['E04B']), repeat: 3, list: false, selftest: false })
	assert.equal(parseArgs([]).repeat, 1)
	assert.equal(parseArgs([]).only, null)
	assert.equal(parseArgs(['--selftest']).selftest, true)
	assert.equal(parseArgs(['--list']).list, true)
})

test('malformed --repeat / --only and unknown arguments are refused', () => {
	for (const bad of [['--repeat'], ['--repeat', '0'], ['--repeat', String(MAX_REPEAT + 1)], ['--repeat', 'x'], ['--repeat', '2.5'],
		['--repeat', '--only'], ['--only'], ['--only', ','], ['--repaet', '3'], ['E04b']]) {
		assert.throws(() => parseArgs(bad), Error, JSON.stringify(bad))
	}
})

test('selection keeps execution order, matches E04b case-insensitively, reports unknown ids', () => {
	assert.deepEqual(selectScenarios(ALL, parseArgs(['--only', 'E04b,E03,E04']).only), { ids: ['E03', 'E04', 'E04b'], unknown: [] })
	assert.deepEqual(selectScenarios(ALL, new Set(['E04B', 'E13'])), { ids: ['E04b'], unknown: ['E13'] })
	assert.equal(selectScenarios(ALL, null).ids.length, ALL.length)
})

test('flakeSummary counts green runs per scenario and names the red repetitions', () => {
	const results = []
	for (let rep = 1; rep <= 4; rep++) {
		results.push({ id: 'E03', rep, green: true })
		results.push({ id: 'E04b', rep, green: rep !== 2 && rep !== 4 })
	}
	assert.deepEqual(flakeSummary(results), [
		{ id: 'E03', runs: 4, green: 4, skipped: 0, redReps: [] },
		{ id: 'E04b', runs: 4, green: 2, skipped: 0, redReps: [2, 4] },
	])
})

test('flakeSummary counts a skipped run neither green nor red (E06 on a non-pgsql stack)', () => {
	const results = [
		{ id: 'E06', rep: 1, green: false, skipped: 'pg_stat_statements gibt es nur mit KD_DB=pgsql' },
		{ id: 'E06', rep: 2, green: false, skipped: 'pg_stat_statements gibt es nur mit KD_DB=pgsql' },
		{ id: 'E07', rep: 1, green: false },
	]
	assert.deepEqual(flakeSummary(results), [
		{ id: 'E06', runs: 2, green: 0, skipped: 2, redReps: [] },
		{ id: 'E07', runs: 1, green: 0, skipped: 0, redReps: [1] },
	])
})

test('traceMarkdown merges both actors in time order and keeps every row', () => {
	const alice = { name: 'alice', trace: [] }
	const bob = { name: 'bob', trace: [] }
	for (let i = 0; i < 60; i++) {
		alice.trace.push({ at: 1000 + i * 10, seq: i, tk: 0, e: 'ABC123', ops: 1, texts: [`a${i}|x`], res: ['ok'], holder: 'kein anderer', rev: 100 + i })
	}
	bob.trace.push({ at: 1005, ev: 'bob: „Übernehmen“ geklickt' })
	bob.trace.push({ at: 1006, seq: 7, tk: 1, e: 'ABC123', ops: 0, texts: [], res: null, pending: true, holder: null, rev: null })
	bob.trace.push({ at: 500, seq: 1, tk: 0, e: null, ops: 1, texts: ['old'], res: ['ok'] })
	const md = traceMarkdown('E04b rot (Durchlauf 2)', [alice, bob], { since: 1000, facts: ['N = X'] })
	const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l))
	assert.equal(rows.length, 62, 'all 60 + 2 rows in the window, the one before `since` dropped')
	assert.match(md, /^### E04b rot \(Durchlauf 2\)/)
	assert.match(md, /^- N = X$/m)
	assert.match(rows[1], /^\| 5 \| bob \| – .*\*\*bob: „Übernehmen“ geklickt\*\*/)
	assert.match(rows[2], /^\| 6 \| bob \| 7 \| ABC123 \| \*\*1\*\* \| 0 \| {2}\| \(offen\) \|/)
	assert.ok(md.includes('"a59\\|x"'), 'a pipe inside a text is escaped, not a column break')
	assert.ok(!md.includes('"old"'))
	assert.match(traceMarkdown('leer', [alice], { since: 99999 }), /keine \/sync-Einträge/)
})

// SPEC-M1 §8.4 (R16, TST-10): viewport passes are passes of the same case
const PASSES = [{ id: 'E26' }, { id: 'E31' }, { id: 'E31', pass: '390x844' }, { id: 'E31', pass: '820x1180' }, { id: 'E32' }, { id: 'E09' }]

test('viewport passes report as <id>@<pass>; --only E31 takes every pass, --only E31@390x844 exactly one (R16)', () => {
	assert.deepEqual(PASSES.map(reportId), ['E26', 'E31', 'E31@390x844', 'E31@820x1180', 'E32', 'E09'])
	assert.deepEqual(selectScenarios(PASSES, parseArgs(['--only', 'E31']).only), { ids: ['E31', 'E31@390x844', 'E31@820x1180'], unknown: [] })
	assert.deepEqual(selectScenarios(PASSES, parseArgs(['--only', 'e31@390x844,E32']).only), { ids: ['E31@390x844', 'E32'], unknown: [] })
	assert.deepEqual(selectScenarios(PASSES, parseArgs(['--only', 'E31@1x1']).only), { ids: [], unknown: ['E31@1X1'] })
	assert.equal(selectScenarios(PASSES, null).ids.length, 6)
	assert.throws(() => reportId({ id: 'E31', pass: '390*844' }), /Durchgang/)
	assert.throws(() => reportId({ id: 'E31', pass: '' }), /Durchgang/)
})

test('flakeSummary keeps the passes apart (the flake gate counts each pass on its own)', () => {
	const results = [
		{ id: 'E31', rep: 1, green: true }, { id: 'E31@390x844', rep: 1, green: false }, { id: 'E31@390x844', rep: 2, green: true },
	]
	assert.deepEqual(flakeSummary(results), [
		{ id: 'E31', runs: 1, green: 1, skipped: 0, redReps: [] },
		{ id: 'E31@390x844', runs: 2, green: 1, skipped: 0, redReps: [1] },
	])
})
