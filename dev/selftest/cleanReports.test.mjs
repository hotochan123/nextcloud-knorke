/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * dev/clean-reports.sh (SPEC-M1 §8.1): --legacy removes the report layout from
 * before round 5 (files and reserved folders directly in dev/e2e/out and
 * dev/sim/out), --stale the output folders of namespaces that do not run and
 * are not protected (also the uid-1000 folder dev/e2e/out/dl); the default is a
 * dry run. Runs in a sandbox (lib/sandbox.mjs: a throwaway copy of the
 * scripts, a fake docker for `docker ps`), never against a real out folder.
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Sandbox } from './lib/sandbox.mjs'

/** dev/e2e/out and dev/sim/out of the sandbox with the layout seen in $ROOT on 11.10. */
function plant(sb) {
	const e2e = path.join(sb.dev, 'e2e/out')
	const sim = path.join(sb.dev, 'sim/out')
	for (const ns of ['c', 'd', 'dl', 'dm', 'main', 'try', 'rs']) {
		fs.mkdirSync(path.join(e2e, ns, 'shots'), { recursive: true })
		fs.writeFileSync(path.join(e2e, ns, 'report.md'), `# ${ns}\n`)
	}
	fs.writeFileSync(path.join(e2e, 'report.md'), '# alt\n')
	fs.writeFileSync(path.join(e2e, 'report.json'), '{}\n')
	fs.mkdirSync(path.join(e2e, 'shots'))
	fs.writeFileSync(path.join(e2e, 'shots', 'E01-alice.png'), 'png')
	fs.mkdirSync(path.join(e2e, 'bridge'))
	for (const ns of ['b', 'br', 'd']) {
		fs.mkdirSync(path.join(sim, ns), { recursive: true })
		fs.writeFileSync(path.join(sim, ns, 'contract.md'), '# c\n')
	}
	for (const f of ['contract.json', 'contract.md', 'converge.json', 'converge.md']) fs.writeFileSync(path.join(sim, f), 'alt\n')
	// a planted symlink: removed itself, its target untouched
	const victim = path.join(sb.root, 'victim')
	fs.mkdirSync(victim)
	fs.writeFileSync(path.join(victim, 'keep.txt'), 'keep')
	fs.symlinkSync(victim, path.join(sim, 'link'))
	return { e2e, sim, victim }
}

const ls = (d) => fs.readdirSync(d).sort()
/** Namespaces d and c run (fake docker), the others do not. */
const RUNNING = [
	[0, 'ps --filter label=knorke --format *', 'dev-c\ndev-d\ndev-try\nspike-x\n'],
	[0, 'container inspect -f {{.State.Running}} knorke-dev-c-nc', 'true\n'],
	[0, 'container inspect -f {{.State.Running}} knorke-dev-d-nc', 'true\n'],
	[0, 'container inspect -f {{.State.Running}} knorke-dev-try-nc', 'true\n'],
]

test('clean-reports.sh: dry run by default, --legacy and --stale delete exactly their kind', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const { e2e, sim, victim } = plant(sb)
	const before = { e2e: ls(e2e), sim: ls(sim) }

	// default: both kinds, dry run – nothing goes
	sb.rules(RUNNING)
	let r = sb.run('clean-reports.sh')
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual({ e2e: ls(e2e), sim: ls(sim) }, before, 'dry run deletes nothing')
	const would = r.stdout.trim().split('\n').map((l) => l.replace(/ \(.*$/, '')).sort()
	assert.deepEqual(would, [
		'würde löschen: dev/e2e/out/bridge', 'würde löschen: dev/e2e/out/dl', 'würde löschen: dev/e2e/out/dm',
		'würde löschen: dev/e2e/out/main', 'würde löschen: dev/e2e/out/report.json', 'würde löschen: dev/e2e/out/report.md',
		'würde löschen: dev/e2e/out/rs', 'würde löschen: dev/e2e/out/shots',
		'würde löschen: dev/sim/out/b', 'würde löschen: dev/sim/out/br', 'würde löschen: dev/sim/out/contract.json',
		'würde löschen: dev/sim/out/contract.md', 'würde löschen: dev/sim/out/converge.json', 'würde löschen: dev/sim/out/converge.md',
		'würde löschen: dev/sim/out/link',
	].sort())
	assert.match(r.stderr, /behalten: dev\/e2e\/out\/try \(Namensraum try ist geschützt\)/)
	assert.match(r.stderr, /behalten: dev\/e2e\/out\/d \(Namensraum d läuft\)/)
	assert.match(r.stderr, /Trockenlauf: 15 Einträge würden gelöscht/)
	assert.ok(sb.calls().every((c) => /^(ps|container inspect)/.test(c)), 'docker only read')

	// --legacy --apply: only the old layout goes
	sb.rules([])
	r = sb.run('clean-reports.sh', ['--legacy', '--apply'])
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(ls(e2e), ['c', 'd', 'dl', 'dm', 'main', 'rs', 'try'])
	assert.deepEqual(ls(sim), ['b', 'br', 'd'])
	assert.deepEqual(sb.calls(), [], '--legacy needs no docker')
	assert.deepEqual(ls(victim), ['keep.txt'], 'the symlink went, its target stayed')

	// --stale --apply: not running and not protected
	sb.rules(RUNNING)
	r = sb.run('clean-reports.sh', ['--stale', '--apply'])
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(ls(e2e), ['c', 'd', 'try'], 'running c, d and protected try stay')
	assert.deepEqual(ls(sim), ['d'])
	assert.match(r.stdout, /gelöscht: dev\/e2e\/out\/dl \(Namensraum dl läuft nicht/)
	assert.match(r.stderr, /6 Einträge gelöscht/)
})

test('clean-reports.sh: KD_NS is ignored, a symlinked out dir and unknown arguments are refused', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const { e2e } = plant(sb)
	sb.rules(RUNNING)
	// KD_NS=try in the environment neither trips the guard nor picks a namespace
	let r = sb.run('clean-reports.sh', ['--stale'], { KD_NS: 'try' })
	assert.equal(r.status, 0, r.stderr)
	assert.doesNotMatch(r.stderr, /VERWEIGERT/)
	assert.ok(fs.existsSync(path.join(e2e, 'try')), 'try untouched')
	r = sb.run('clean-reports.sh', ['--bogus'])
	assert.equal(r.status, 1)
	assert.match(r.stderr, /unbekanntes Argument '--bogus'/)
	// out dir as a symlink: refused, nothing followed
	const real = path.join(sb.root, 'elsewhere')
	fs.renameSync(e2e, real)
	fs.symlinkSync(real, e2e)
	sb.rules(RUNNING)
	r = sb.run('clean-reports.sh', ['--legacy', '--apply'])
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /dev\/e2e\/out ist ein Symlink/)
	assert.ok(fs.existsSync(path.join(real, 'report.md')), 'nothing deleted through the symlink')
})
