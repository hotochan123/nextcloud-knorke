/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The restore probe (dev/selftest/restore.sh, lib/restore-probe.mjs; SPEC-M1
 * §5.4, §10 P5, Revision 19 T4-08), without a stack:
 * - restore.sh refuses (exit 2, no docker call beyond reading the stack)
 *   a stack that is not pgsql, a missing env.json and an invalid
 *   KD_RUN_LABEL; the report stem is restore-pgsql[-<label>] (§9.0 point 2)
 * - the probe follows the runbook of §5.4 (R19) in this order:
 *   maintenance:mode --on → pg_restore → occ config:app:set knorke epoch
 *   (a core command; never knorke:epoch:rotate, which Nextcloud does not
 *   load in maintenance mode) → maintenance:mode --off, and checks the pass
 *   rule of §10 P5 (exactly one resync, W gone from snapshot and mirror, the
 *   new epoch)
 * - newEpoch: 8 characters [a-z0-9]
 * - (R20, K2) lib/restore-probe.mjs started directly refuses a protected
 *   namespace (KD_PROTECT_NS, default try) with exit 2 before loadEnv and
 *   any docker call; KD_FORCE=1 passes (run from a sandbox copy with the
 *   fake docker, so even a broken guard reaches neither docker nor a real
 *   dev/.state/try)
 * The live run is phase work (namespace d in phase 1, br in W2 of phase 2).
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './lib/sandbox.mjs'
import { newEpoch, EPOCH_SETTLE_MS, DUMP } from './lib/restore-probe.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const probe = fs.readFileSync(path.join(DIR, 'lib', 'restore-probe.mjs'), 'utf8')
const sh = fs.readFileSync(path.join(DIR, 'restore.sh'), 'utf8')

test('restore.sh refuses another database, a missing env.json and an invalid label (exit 2)', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const NS = 'dzrest'
	let r = sb.run('selftest/restore.sh', [], { KD_NS: NS })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /env\.json fehlt/)
	sb.writeEnv(NS, { ns: NS, db: { kind: 'mariadb' }, containers: { nc: `knorke-dev-${NS}-nc`, db: `knorke-dev-${NS}-db`, redis: `knorke-dev-${NS}-redis` } })
	r = sb.run('selftest/restore.sh', [], { KD_NS: NS })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /braucht KD_DB=pgsql/)
	assert.deepEqual(sb.calls(), [], 'nothing reached docker')
	r = sb.run('selftest/restore.sh', [], { KD_NS: NS, KD_RUN_LABEL: 'Bad_Label' })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /KD_RUN_LABEL 'Bad_Label' ist ungültig/)
	r = sb.run('selftest/restore.sh', ['--now'], { KD_NS: NS })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /unbekanntes Argument/)
})

test('the report stem is restore-pgsql[-<label>] (run evidence, §9.0 point 2 R19)', () => {
	assert.match(sh, /^STEM="restore-pgsql\$\{RUN_LABEL:\+-\$RUN_LABEL\}"$/m)
	assert.match(sh, /KD_REPORT_STEM="\$STEM" node "\$DEV\/selftest\/lib\/restore-probe\.mjs"/)
})

test('the probe follows the runbook of §5.4 (R19): maintenance on → pg_restore → config:app:set knorke epoch → maintenance off', () => {
	const r3 = probe.slice(probe.indexOf("await suite.run('R3'"), probe.indexOf("await suite.run('R4'"))
	const at = (s) => { const i = r3.indexOf(s); assert.ok(i > 0, s); return i }
	const on = at("'maintenance:mode', '--on'")
	const restore = at('pg_restore -U nextcloud -d nextcloud --clean --if-exists --single-transaction')
	const epoch = at("'config:app:set', 'knorke', 'epoch', `--value=${epoch}`")
	const settle = at('await sleep(EPOCH_SETTLE_MS)')
	const off = at("'maintenance:mode', '--off'")
	assert.ok(on < restore && restore < epoch && epoch < settle && settle < off, 'in this order')
	assert.doesNotMatch(probe, /knorke:epoch:rotate/, 'no app command in maintenance mode (§5.4 R19)')
	assert.ok(EPOCH_SETTLE_MS >= 4000, 'other PHP processes see the new epoch after ≤ 3 s (APCu)')
	assert.match(probe, /pg_dump -U nextcloud -d nextcloud -Fc -f \$\{DUMP\}/)
	assert.equal(DUMP, '/tmp/knorke-restore-probe.dump')
	assert.match(probe, /'rm', '-f', DUMP/, 'the dump file goes again')
	for (const s of ["'der Client resynct genau einmal'", "'W fehlt im Snapshot'", "'W fehlt im Spiegel des Clients'", "'Snapshot nach dem Restore: epoch = neue Epoche'"]) assert.ok(probe.includes(s), s)
})

test('newEpoch: 8 characters [a-z0-9] (§5.4)', () => {
	let i = 0
	const seq = [0, 0.999, 0.5, 0.25, 0.75, 0.1, 0.9, 0.33]
	assert.match(newEpoch(() => seq[i++ % seq.length]), /^[a-z0-9]{8}$/)
	for (let k = 0; k < 50; k++) assert.match(newEpoch(), /^[a-z0-9]{8}$/)
})

test('R20 K2: restore-probe.mjs refuses a protected namespace before loadEnv and any docker call (exit 2); KD_FORCE=1 passes, KD_PROTECT_NS lists namespaces (SPEC-M1 §8.1)', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.copyDev('sim/lib', 'selftest/lib/restore-probe.mjs')
	// a broken env.json of try in the sandbox: loadEnv would fail with its own message, so the refusal must come first
	fs.mkdirSync(path.join(sb.dev, '.state', 'try'), { recursive: true })
	fs.writeFileSync(path.join(sb.dev, '.state', 'try', 'env.json'), 'kaputt')
	sb.rules([[0, '*', '']])
	let r = sb.node('selftest/lib/restore-probe.mjs', [], { KD_NS: 'try' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /^restore-probe: VERWEIGERT: Namensraum 'try' ist geschützt \(KD_PROTECT_NS\)$/m)
	assert.doesNotMatch(r.stderr, /env\.json/, 'refused before loadEnv')
	assert.deepEqual(sb.calls(), [], 'no docker call')
	r = sb.node('selftest/lib/restore-probe.mjs', [], { KD_NS: 'try', KD_FORCE: '1' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /env\.json fehlt oder ist kaputt/, 'KD_FORCE=1 passes the guard; loadEnv refuses the broken file')
	assert.doesNotMatch(r.stderr, /VERWEIGERT/)
	r = sb.node('selftest/lib/restore-probe.mjs', [], { KD_NS: 'dzrest', KD_PROTECT_NS: 'try dzrest' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /VERWEIGERT: Namensraum 'dzrest' ist geschützt/)
	assert.deepEqual(sb.calls(), [], 'still no docker call')
})
