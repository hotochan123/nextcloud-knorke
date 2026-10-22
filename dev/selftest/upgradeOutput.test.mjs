/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Wave W2 finding (r1-w2): on the emulated legacy install
 * (KD_MYSQL_UTF8MB4=0) `occ upgrade` printed "Repair error: … 1366 Incorrect
 * string value: '\xF0\x9F\x8E\x82 L...' for column oc_calendarobjects_props"
 * (core step "Repair MySQL collation"), said "Update successful", exited 0 –
 * and dev/selftest/upgrade.sh reported all 13 steps green. Guarded here:
 *   - dev/selftest/lib/upgrade-output.mjs flags "Repair error" lines and apps
 *     other than knorke, on the real outputs of both W2 runs (functions and
 *     the CLI upgrade.sh calls)
 *   - upgrade.sh calls it and turns both into red steps
 *   - up.sh makes the legacy install faithful (birthday calendars rewritten,
 *     core tables converted by Nextcloud's own repair, every table checked)
 * No Docker, no stack. Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { otherApps, repairErrors } from './lib/upgrade-output.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = path.join(ROOT, 'dev/selftest/lib/upgrade-output.mjs')
const FN = { upgrade_other_apps: otherApps, upgrade_repair_errors: repairErrors }

/** One verdict on `input`: the offending lines. */
const verdict = (fn, input) => FN[fn](input)

/** The CLI as upgrade.sh calls it: stdout lines and exit code. */
function cli(args, input) {
	const r = spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' })
	return { status: r.status, lines: r.stdout.split('\n').filter(Boolean), stderr: r.stderr }
}

// `occ upgrade` of wave W2, NC 34.0.1, pgsql (M0 0.1.0 → M1 0.2.0), verbatim
const PGSQL = `Setting log level to debug
Turned on maintenance mode
Updating database schema
Updated database
Updating <knorke> ...
Updated <knorke> to 0.2.0
Starting code integrity check...
Finished code integrity check
Update successful
Turned off maintenance mode
Resetting log level
`
// the same on mariadb with KD_MYSQL_UTF8MB4=0 before the up.sh fix, verbatim
const UTF8MB3_BEFORE = `Setting log level to debug
Turned on maintenance mode
Updating database schema
Updated database
Updating <knorke> ...
Updated <knorke> to 0.2.0
Repair error: An exception occurred while executing a query: SQLSTATE[22007]: Invalid datetime format: 1366 Incorrect string value: '\\xF0\\x9F\\x8E\\x82 L...' for column \`nextcloud\`.\`oc_calendarobjects_props\`.\`value\` at row 3
Starting code integrity check...
Finished code integrity check
Update successful
Turned off maintenance mode
Resetting log level
`

test('the clean pgsql upgrade has no verdict', () => {
	assert.deepEqual(verdict('upgrade_repair_errors', PGSQL), [])
	assert.deepEqual(verdict('upgrade_other_apps', PGSQL), [])
})

test('a repair error is found although occ said "Update successful"', () => {
	const errs = verdict('upgrade_repair_errors', UTF8MB3_BEFORE)
	assert.equal(errs.length, 1)
	assert.match(errs[0], /^Repair error: .*1366 Incorrect string value.*oc_calendarobjects_props/)
	// it is not an app update
	assert.deepEqual(verdict('upgrade_other_apps', UTF8MB3_BEFORE), [])
})

test('an app other than knorke is found; schema, store checks and warnings are not', () => {
	const out = PGSQL.replace('Starting code integrity check...', [
		'Checking for update of app spreed in appstore',
		'Checked for update of app "spreed" in App Store',
		'Updating <spreed> ...',
		'Updated <spreed> to 21.0.4',
		'Repair warning: something minor',
		'Starting code integrity check...',
	].join('\n'))
	assert.deepEqual(verdict('upgrade_other_apps', out), ['Updating <spreed> ...', 'Updated <spreed> to 21.0.4'])
	assert.deepEqual(verdict('upgrade_repair_errors', out), [], 'a warning is not an error')
	assert.deepEqual(verdict('upgrade_repair_errors', '    Repair error: indented\n'), ['    Repair error: indented'])
	assert.deepEqual(verdict('upgrade_other_apps', ''), [])
})

test('the CLI prints the offending lines and exits 0; a wrong call exits 2', () => {
	assert.deepEqual(cli(['repair-errors'], UTF8MB3_BEFORE).lines, repairErrors(UTF8MB3_BEFORE))
	assert.equal(cli(['repair-errors'], UTF8MB3_BEFORE).status, 0)
	assert.deepEqual(cli(['repair-errors'], PGSQL), { status: 0, lines: [], stderr: '' })
	assert.deepEqual(cli(['other-apps'], PGSQL.replace('Update successful', 'Updated <polls> to 8.0.0\nUpdate successful')).lines, ['Updated <polls> to 8.0.0'])
	assert.equal(cli([], PGSQL).status, 2)
	assert.equal(cli(['bogus'], PGSQL).status, 2)
})

test('upgrade.sh uses the verdicts: a repair error or another app makes a red step', () => {
	const upg = fs.readFileSync(path.join(ROOT, 'dev/selftest/upgrade.sh'), 'utf8')
	assert.match(upg, /REPAIR_ERR="\$\(node "\$DEV\/selftest\/lib\/upgrade-output\.mjs" repair-errors <<<"\$UPG"\)"/)
	assert.match(upg, /\[ -z "\$REPAIR_ERR" \][\s\S]{0,120}step ok "occ upgrade[^"]*"[\s\S]{0,40}else[\s\S]{0,20}step rot "occ upgrade meldet Reparaturfehler/)
	assert.match(upg, /UPDATED="\$\(node "\$DEV\/selftest\/lib\/upgrade-output\.mjs" other-apps <<<"\$UPG"\)"/)
	assert.match(upg, /\[ -z "\$UPDATED" \]; then step ok [^;]*; else step rot /)
	assert.doesNotMatch(upg, /grep -iE 'updat\(ed\|ing\)/, 'no second copy of the app regex')
})

test('up.sh makes KD_MYSQL_UTF8MB4=0 a faithful legacy install before app:enable knorke', () => {
	const up = fs.readFileSync(path.join(ROOT, 'dev/up.sh'), 'utf8')
	const flip = up.indexOf('occ config:system:set mysql.utf8mb4 --value=false')
	// the commands, not their mention in comments
	const bday = up.indexOf('occ dav:sync-birthday-calendar >/dev/null')
	const repair = up.indexOf('REPAIR_OUT="$(occ maintenance:repair 2>&1)"')
	const enable = up.indexOf('occ app:enable knorke 2>&1')
	assert.ok(flip > 0 && bday > flip && repair > bday && enable > repair, `order flip ${flip} < birthday ${bday} < repair ${repair} < app:enable ${enable}`)
	assert.match(up, /grep -q 'ERROR:' <<<"\$REPAIR_OUT"[\s\S]{0,200}die /, 'a repair ERROR stops up.sh')
	assert.match(up, /table_collation NOT LIKE 'utf8mb3%'[\s\S]{0,300}die "Tabellen ohne utf8mb3/, 'every table is checked afterwards')
})

// Wave W2 of round 1a (r1-w2): the stage-0 flow-back (12.10.2026) moved the
// snapshot root-base to 0.2.0, so upgrade.sh's old default M0 code equalled
// the M1 code and the run stopped with "dieselbe Version 0.2.0". The default
// is now the frozen snapshot 0.0 (the copy of $ROOT when M1 started, 0.1.0),
// and the M0 code must be OLDER than the M1 code, not merely different.

/** A fake app dir with appinfo/info.xml of the given version (and js/ if asked). */
function fakeApp(dir, version, { js = false } = {}) {
	fs.mkdirSync(path.join(dir, 'appinfo'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'appinfo/info.xml'), `<?xml version="1.0"?>\n<info>\n    <id>knorke</id>\n    <version>${version}</version>\n</info>\n`)
	if (js) {
		fs.mkdirSync(path.join(dir, 'js'), { recursive: true })
		fs.writeFileSync(path.join(dir, 'js/knorke-main.mjs'), '')
	}
	return dir
}

test('upgrade.sh takes the frozen M0 snapshot 0.0 by default, never root-base', () => {
	const upg = fs.readFileSync(path.join(ROOT, 'dev/selftest/upgrade.sh'), 'utf8')
	assert.match(upg, /^M0_DIR="\$\{KD_UPGRADE_M0:-\$\(beside_root \.knorke-m1-phase\/0\.0\)\}"$/m)
	assert.doesNotMatch(upg, /^M0_DIR=.*root-base/m, 'root-base follows every flow-back – no M0 any more')
})

test('upgrade.sh refuses an M0 code that is not older than the M1 code, before any docker call', async (t) => {
	const { Sandbox } = await import('./lib/sandbox.mjs')
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const m1 = fakeApp(path.join(sb.root, 'fake-m1'), '0.2.0')
	for (const [m0ver, refused] of [['0.2.0', true], ['0.3.0', true], ['0.10.0', true], ['0.1.0', false], ['0.1.9', false]]) {
		const m0 = fakeApp(path.join(sb.root, `fake-m0-${m0ver}`), m0ver)
		sb.rules([])
		const r = sb.run('selftest/upgrade.sh', ['--db', 'pgsql'], { KD_UPGRADE_M0: m0, KD_UPGRADE_M1: m1 })
		assert.equal(r.status, 1, `M0 ${m0ver}: exit 1 (${r.stderr})`)
		if (refused) {
			assert.match(r.stderr, /ist nicht älter als M1/, `M0 ${m0ver} → refused`)
		} else {
			// past the version guard: the next check is the missing M1 bundle
			assert.doesNotMatch(r.stderr, /nicht älter/, `M0 ${m0ver} passes the version guard`)
			assert.match(r.stderr, /js\/knorke-main\.mjs fehlt/, `M0 ${m0ver}: stops at the missing bundle`)
		}
		assert.deepEqual(sb.calls(), [], `M0 ${m0ver}: no docker call`)
	}
	// the default M0 dir is the snapshot 0.0 next to the repo copy (absent in the sandbox)
	sb.rules([])
	const d = sb.run('selftest/upgrade.sh', ['--db', 'pgsql'], { KD_UPGRADE_M1: fakeApp(path.join(sb.root, 'fake-m1-js'), '0.2.0', { js: true }) })
	assert.equal(d.status, 1, d.stderr)
	assert.match(d.stderr, /\/\.knorke-m1-phase\/0\.0\/appinfo\/info\.xml fehlt/)
	assert.deepEqual(sb.calls(), [])
})

test('on this host the default M0 snapshot is older than this copy (skipped without the snapshot, e.g. in CI)', (t) => {
	const snap = path.join(path.dirname(fs.realpathSync(ROOT)), '.knorke-m1-phase/0.0/appinfo/info.xml')
	if (!fs.existsSync(snap)) {
		t.skip(`${snap} fehlt`)
		return
	}
	const ver = (f) => fs.readFileSync(f, 'utf8').match(/<version>([^<]+)<\/version>/)[1]
	const [m0, m1] = [ver(snap), ver(path.join(ROOT, 'appinfo/info.xml'))]
	assert.equal(m0, '0.1.0', 'the snapshot 0.0 is M0')
	assert.notEqual(m0, m1)
})
