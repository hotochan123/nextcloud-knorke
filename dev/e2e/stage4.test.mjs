/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the stage-4 harness (SPEC-M1 §8.3, §8.4, Revision 19), no
 * browser, no stack:
 * - scenarios/index.mjs: E34 and E37 after the passes of E33 and before E09,
 *   E35 after E16 and E30, before E36 (§8.4 "Reihenfolge" R19)
 * - every check label of scenarios/stage4.mjs names exactly ONE owner
 *   (SPEC-M1 §9.6), waits only from Node (CSP), no dispatched contextmenu
 *   (E37: only real input, §6.3 rule 3), the WebKit part of E37 only notes
 * - the R19 wording of E34 (3 s busy acks, same seq, no offline, convergence),
 *   E35 (hold ≤ 8 s below SYNC_TIMEOUT_MS, purge-tombstones <b> 0, resyncs and
 *   snapshotRequests + 1, editor open, D missing) and E37 (1280 × 800, steps
 *   (1)–(8), paste-here missing on http, vote mode without a menu)
 * - E37 also checks the aria-label of the menu root (§6.11, English or the
 *   German of l10n/de.json) and its place (§6.6 Ort) – ask of [C], stage 4
 * - E12 (R19, T4-11): four pages incl. the vote link as a tablet, the M0
 *   totals 85/34/32/34, no Pulse column; classify() against synthetic
 *   request lists (the gate "no other app request before the first /sync")
 * - run.mjs: World.limiterReset() at the start of every case (T4-01)
 * - contract.mjs: C76–C79 in the R19 form, ratelimitReset before every case,
 *   none inside C44, which waits 61 s, CINV last
 * - P7-C (SPEC-M1 §33.1 k, l; Revision 22): E09c directly after E09b, E38
 *   directly after E37, both before E09; the flake gate
 *   --only E34,E35,E37,E38 --repeat 8; E38 (1280 × 800, per 9 / perItem 3,
 *   wheel pan closes the stepper, B at the right edge, both buttons inside
 *   and ≥ 44 px, vote-add twice 150 ms apart → mine 2, no vote-limit), E09c
 *   (403 and 404 text/html once each, FROZEN_STATUSES = the list of
 *   src/board/BoardSession.js, read every 150 ms), the row tap of
 *   E31@390x844; C80–C83 between C79 and CINV, keys through the stack helper
 *   and back to the baseline of the profile in `finally`
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/stage4.mjs')
const part = (a, b) => {
	const i = src.indexOf(a)
	assert.ok(i >= 0, `found: ${a}`)
	return src.slice(i, b ? src.indexOf(b, i + 1) : undefined)
}
const contract = fs.readFileSync(path.join(DIR, '..', 'sim', 'contract.mjs'), 'utf8')
const cpart = (id, next) => {
	const i = contract.indexOf(`await C('${id}'`)
	assert.ok(i >= 0, `contract case ${id}`)
	return contract.slice(i, contract.indexOf(next, i + 1))
}

// coldstart.mjs reads env.json through harness.mjs on import: a throwaway one
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-stage4-'))
fs.writeFileSync(path.join(TMP, 'env.json'), JSON.stringify({ baseNet: 'http://kd.invalid', userPass: 'x', ns: 'd' }))
process.env.KD_ENV_JSON = path.join(TMP, 'env.json')
process.env.KD_E2E_OUT = TMP
const { classify, M0_TOTALS } = await import('./scenarios/coldstart.mjs')
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('index: E34 and E37 after the passes of E33, before E09; E35 after E16 and E30, before E36 (§8.4 R19); P7-C: E09c right after E09b, E38 right after E37, both before E09; flake gate --only E34,E35,E37,E38 --repeat 8', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	const at = (id) => list.indexOf(id)
	for (const id of ['E34', 'E35', 'E37']) assert.equal(list.filter((x) => x === id).length, 1, `${id} once`)
	assert.ok(at('E33_TABLET') < at('E34') && at('E34') < at('E37') && at('E37') < at('E09'), 'E33 passes < E34 < E37 < E09')
	assert.ok(at('E16') < at('E35') && at('E30') < at('E35') && at('E35') < at('E36'), 'E16, E30 < E35 < E36')
	assert.ok(at('E11') < at('E12') && at('E12') < at('E09'), 'E12 keeps its place in the shared world')
	assert.match(idx, /import \{ E34, E35, E37, E38 \} from '\.\/stage4\.mjs'/)
	assert.match(idx, /import \{ E09b, E09c \} from '\.\/throttle\.mjs'/)
	for (const id of ['E09c', 'E38']) assert.equal(list.filter((x) => x === id).length, 1, `${id} once`)
	assert.equal(at('E09c'), at('E09b') + 1, 'E09c directly after E09b (§33.1 k)')
	assert.equal(at('E38'), at('E37') + 1, 'E38 directly after E37 (§33.1 k)')
	assert.ok(at('E09c') < at('E09') && at('E38') < at('E09'), 'both before E09 (own board, no instance setting)')
	assert.ok(idx.includes('Flake gate (P7-C, SPEC-M1 §33.1 l): --only E34,E35,E37,E38 --repeat 8.'), 'the flake gate of P7-C is named')
	assert.doesNotMatch(idx, /--only E34,E35,E37 --repeat 8/, 'the stage-4 gate without E38 is gone')
	assert.match(read('scenarios/world.mjs'), /^export const MAX_BOARDS_PER_RUN = 56$/m, 'the board cap stayed 48 with E09c and E38 (ED-36); 56 since factory job 032 (E43, E44)')
})

test('stage4.mjs: waits only from Node (CSP, trap 9.10), no dispatched contextmenu, every check label starts with exactly one owner [S], [C], [B] or [D] (§9.6)', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/, 'CSP: poll from Node with until()')
	assert.doesNotMatch(code, /dispatchEvent\(|new MouseEvent\(/, 'E37: only real input (§6.3: a dispatched contextmenu opens nothing)')
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 50, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l)).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without a label that starts with exactly one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
	const wk = part('async function webkitReport(', '\nexport const E37')
	assert.doesNotMatch(wk, /t\.(check|must)\(/, 'E37 step (4) in WebKit is a report: notes only')
	assert.match(wk, /webkit\.launch\(\)/)
})

test('run.mjs: World.limiterReset() at the start of every case (R19, T4-01)', () => {
	const run = read('run.mjs')
	const body = run.slice(run.indexOf('world.resetErrors()'), run.indexOf('const pageErrors = world.pageErrors()'))
	assert.ok(body.indexOf('await world.limiterReset()') >= 0 && body.indexOf('await world.limiterReset()') < body.indexOf('sc.run(t, world)'), 'before the scenario runs')
})

test('E34 (R19): 3 s busy for /sync with ops (all busy, rev null, retryMs), the batch again with the same seq, no offline, convergence', () => {
	const e = part('export const E34 = {', '// ── E35')
	assert.match(src, /export const E34_BUSY_MS = 3000$/m)
	assert.match(e, /a\.ctx\.route\('\*\*\/sync'/)
	assert.match(e, /j\.acks = \{ seq, rev: null, res: ops\.map\(\(\) => 'busy'\), retryMs: E34_RETRY_MS \}/, 'busy acks for every op, acks.rev null, retryMs')
	assert.match(e, /route\.fetch\(\{ postData: JSON\.stringify\(rest\) \}\)/, 'the server sees the request without ops and seq (nothing applied)')
	assert.match(e, /!x\.busy && x\.seq === s0/, 'the busy batch comes back with the same seq')
	assert.match(e, /x\.status !== 'offline' && !x\.off/, 'never offline, no offline banner')
	assert.match(e, /'\[C\] Konvergenz: bobs Modell = Snapshot des Servers'/)
	assert.match(e, /'\[C\] keine Op verloren/)
})

test('E35 (R19, T4-07): hold ≤ 8 s below SYNC_TIMEOUT_MS, purge-tombstones <b> 0 with minRev > since, resyncs and snapshotRequests + 1, editor open, text at bob, D missing', () => {
	const e = part('export const E35 = {', '// ── E37')
	const hold = Number(src.match(/^export const E35_HOLD_MS = (\d+)$/m)?.[1])
	const timeout = Number(fs.readFileSync(path.join(DIR, '..', '..', 'src', 'sync', 'transport.js'), 'utf8').match(/export const SYNC_TIMEOUT_MS = (\d+)/)?.[1])
	assert.equal(hold, 8000)
	assert.ok(timeout > hold, `hold ${hold} ms below SYNC_TIMEOUT_MS ${timeout} ms`)
	assert.match(e, /bridge\('purge-tombstones', board, 0\)/)
	assert.match(e, /p\.minRev > held\.since/)
	assert.ok(e.indexOf("bridge('purge-tombstones'") > e.indexOf("seedOps('bob', board, [{ o: 'remove', id: D }])"), 'bob creates and deletes D before the purge')
	assert.ok(e.indexOf('release()') > e.indexOf("bridge('purge-tombstones'"), 'the request goes on after the purge')
	assert.match(e, /c1\.resyncs === c0\.resyncs \+ 1/)
	assert.match(e, /c1\.snapshotRequests === c0\.snapshotRequests \+ 1/)
	assert.match(e, /open && val === typed/)
	assert.match(e, /serverMap\('bob', board\)/, 'the text is checked as bob')
	assert.match(e, /!srv\.has\(D\)/)
})

test('E37 (R19): 1280 × 800, real input, steps (1)–(8), paste-here missing on http, vote mode without a menu', () => {
	const e = part('export const E37 = {')
	assert.match(src, /export const E37_VIEWPORT = Object\.freeze\(\{ width: 1280, height: 800 \}\)/)
	assert.match(e, /viewport: E37_VIEWPORT/)
	assert.match(src, /button: 'right'/)
	for (const key of ["'Shift+F10'", "'ContextMenu'"]) assert.ok(e.includes(key), key)
	for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) assert.ok(e.includes(`t.step('(${n})`), `step (${n})`)
	assert.match(e, /!m\.items\.includes\('paste-here'\)/, '(3) paste-here missing (no secure context)')
	assert.match(e, /!m\.items\.includes\('connect'\)/, '(1) connect missing on one note')
	assert.match(e, /e\.dp === false/, '(5) the browser menu in the editor (defaultPrevented false)')
	assert.match(e, /following === null/, '(7) the right click ends following')
	assert.match(e, /'\[S\] \(8\) Modus vote: kein Menü'/)
	assert.match(e, /\/api\/v1\/boards\/\$\{board\}\/vote/, '(8) the session over route 22')
	for (const item of ['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'edit-text', 'zoom-selection', 'note-here', 'select-all', 'fit']) {
		assert.ok(e.includes(`'${item}'`), `entry ${item} checked`)
	}
})

test('E37 (R19, T4-02): the menu root carries the aria-label of §6.11 and sits where §6.6 puts it (sibling of .knorke-canvas in .knorke-board); ask of [C], stage 4 phase 1', () => {
	const spec = fs.readFileSync(path.join(DIR, '..', '..', 'docs', 'SPEC-M1.md'), 'utf8')
	assert.ok(spec.includes('| `Selection actions`, `Board actions` (`aria-label` der Wurzel bei `id ≠ null` bzw. `null`) | `Aktionen für die Auswahl`, `Aktionen auf dem Board` |'), 'SPEC-M1 §6.11 row of the two labels')
	assert.ok(spec.includes('**Ort:** Geschwister von `.knorke-canvas` in `.knorke-board`, nie im Szenen-Container'), 'SPEC-M1 §6.6 Ort')
	const de = JSON.parse(fs.readFileSync(path.join(DIR, '..', '..', 'l10n', 'de.json'), 'utf8')).translations
	assert.equal(de['Selection actions'], 'Aktionen für die Auswahl')
	assert.equal(de['Board actions'], 'Aktionen auf dem Board')
	assert.ok(src.includes("export const MENU_LABELS = Object.freeze({\n\titems: Object.freeze(['Selection actions', 'Aktionen für die Auswahl']),\n\tempty: Object.freeze(['Board actions', 'Aktionen auf dem Board']),\n})"), 'MENU_LABELS: English and German of each')
	// menuPlaced (stage4.mjs imports playwright, which the self-tests do not load): exactly the three conditions of §6.6 Ort
	assert.match(src, /^export const menuPlaced = \(place\) => !!\(place && place\.parentBoard && place\.siblingCanvas && !place\.inCanvas\)$/m)
	const ms = part('async function menuState(page)', 'async function menuOpened(')
	assert.match(ms, /parentBoard: !!\(m\.parentElement && m\.parentElement\.matches\('\.knorke-board'\)\)/)
	assert.match(ms, /siblingCanvas: .*c !== m && c\.matches\('\.knorke-canvas'\)/)
	assert.match(ms, /inCanvas: !!m\.closest\('\.knorke-canvas'\)/)
	const e = part('export const E37 = {')
	const s1 = e.slice(e.indexOf("t.step('(1)"), e.indexOf("t.step('(2)"))
	const s3 = e.slice(e.indexOf("t.step('(3)"), e.indexOf("t.step('(4)"))
	assert.match(s1, /t\.check\(MENU_LABELS\.items\.includes\(m\.label\), '\[C\] \(1\) aria-label/)
	assert.match(s1, /t\.check\(menuPlaced\(m\.place\), '\[C\] \(1\) Menü als Geschwister von \.knorke-canvas in \.knorke-board/)
	assert.match(s3, /t\.check\(MENU_LABELS\.empty\.includes\(m\.label\), '\[C\] \(3\) aria-label/)
})

test('E12 (R19, T4-11): four pages incl. the vote link as a tablet, M0 totals, no Pulse column', () => {
	const c = read('scenarios/coldstart.mjs')
	assert.deepEqual({ ...M0_TOTALS }, { user: 85, public: 34, base: 32, vote: 34 })
	assert.match(c, /touch: true/, 'the vote link page as a tablet (hasTouch, isMobile, 820 × 1180)')
	assert.match(c, /guestName: ''/, 'name left empty')
	assert.match(c, /\/votelink`, \{\}\)/, 'the vote link over route 17')
	assert.doesNotMatch(c.replace(/^\s*\*.*$/gm, ''), /\b91\b|\b142\b|Pulse/, 'no Pulse column (R19)')
	assert.match(c, /m\.extraBeforeSync\.length === 0/)
})

test('E12 classify: page HTML, assets, icon and one snapshot/join before the first /sync pass; any other app request before it is listed', () => {
	const r = (path, type = 'xhr') => ({ t: 0, path, type })
	const ok = classify([
		r('/index.php/apps/knorke/b/7', 'document'),
		r('/core/js/main.js', 'script'),
		r('/custom_apps/knorke/js/knorke-main.mjs', 'script'),
		r('/custom_apps/knorke/css/knorke-style.css', 'stylesheet'),
		r('/custom_apps/knorke/l10n/de.js', 'script'),
		r('/custom_apps/knorke/img/app.svg', 'image'),
		r('/index.php/apps/knorke/api/v1/boards/7/snapshot'),
		r('/index.php/apps/knorke/api/v1/boards/7/sync'),
		r('/index.php/apps/knorke/api/v1/boards/7/shares'),
	], 'x')
	assert.equal(ok.firstBeforeSync, 1)
	assert.deepEqual(ok.extraBeforeSync, [], 'requests after the first /sync do not count')
	assert.equal(ok.assets, 3)
	assert.equal(ok.icons, 1)
	const bad = classify([
		r('/index.php/apps/knorke/p/AbCdEfGhIjKlMnOpQrStUvWx', 'document'),
		r('/index.php/apps/knorke/api/v1/boards'),
		r('/index.php/apps/knorke/pub/v1/AbCdEfGhIjKlMnOpQrStUvWx/join'),
		r('/index.php/apps/knorke/pub/v1/boards/7/snapshot'),
		r('/index.php/apps/knorke/pub/v1/boards/7/sync'),
	], 'y')
	assert.equal(bad.firstBeforeSync, 2, 'join plus an extra snapshot: two')
	assert.deepEqual(bad.extraBeforeSync, ['/index.php/apps/knorke/api/v1/boards'])
	const none = classify([r('/index.php/apps/knorke/b/7', 'document')], 'z')
	assert.equal(none.sawSync, false)
})

test('contract.mjs (R19): ratelimitReset before every case, none inside C44, which waits 61 s; C76–C79 in their R19 form; CINV last', () => {
	const cfn = contract.slice(contract.indexOf('async function C(id, title, fn'), contract.indexOf('/** C24: pg_stat_statements'))
	assert.ok(cfn.indexOf('await stack.ratelimitReset()') > 0 && cfn.indexOf('await stack.ratelimitReset()') < cfn.indexOf('await suite.run('), 'C() resets before every case')
	const c44 = cpart('C44', '// ── round 2')
	assert.doesNotMatch(c44, /stack\.ratelimitReset\(/, 'no reset inside C44')
	assert.match(c44, /await sleep\(61000\)/)
	assert.ok(c44.indexOf('await sleep(61000)') > c44.indexOf('limitedAt === 301') && c44.indexOf('await sleep(61000)') < c44.indexOf('const back = await first.joinGuest'), 'after the 301st join, before the returning guest')
	const c76 = cpart('C76', "await C('C77'")
	for (const s of ['(a)', '(b)', '(c)', '(d)']) assert.ok(c76.includes(`inOneWindow(t, '${s}'`), `C76 ${s} in one window`)
	assert.doesNotMatch(c76, /config:app:set/, 'no app config override in C76')
	assert.match(contract, /const busyRetry = \(now\) => \(winOf\(now\) \+ 1\) \* WIN_MS - now \+ 100/)
	assert.match(contract, /est % WIN_MS >= 50 && est % WIN_MS <= 1000/, 'start 50–1000 ms into a window')
	const c77 = cpart('C77', "await C('C78'")
	assert.equal((c77.match(/stack\.ratelimitReset\(\)/g) || []).length, 3, 'C77: (0) before, (b) after expires_at went back, (0) in finally')
	assert.match(c77, /a31\.data\.retryMs === 2000 && String\(a31\.headers\?\.\['retry-after'\]\) === '2'/)
	assert.match(c77, /per\.get\(gg\) >= 27/)
	assert.match(c77, /s301\.data\?\.error !== 'rate_limited'/)
	const c78 = cpart('C78', "await C('C79'")
	assert.match(c78, /stack\.purgeTombstones\(b, 0\)/)
	assert.match(c78, /--class=OCA\\\\Knorke\\\\BackgroundJob\\\\CleanupJob/)
	assert.match(c78, /'background-job:execute', String\(job\.id\), '--force-execute'/)
	const c79 = cpart('C79', '// ── P7-C')
	assert.match(c79, /stack\.occ\('config:app:set', 'knorke', 'changes_cap', '--value=50'\)/)
	assert.match(c79, /stack\.occ\('config:app:delete', 'knorke', 'changes_cap'\)/)
	assert.match(c79, /left\.length === 50 && deepEq\(left, all\.slice\(0, 50\)\)/)
	assert.ok(contract.indexOf("await C('CINV'") > contract.indexOf("await C('C79'"), 'CINV stays last')
})

// ── P7-C (SPEC-M1 §33.1 k, Revision 22) ─────────────────────────────────────

test('E38 (P7-08, P7-10): 1280 × 800, route 22 with per 9 / perItem 3, wheel pan closes the stepper within 2 s, B at the right edge of .knorke-board, vote-add and vote-stepper-close inside and ≥ 44 px, vote-add twice 150 ms apart → mine 2, no vote-limit', () => {
	const e = part('export const E38 = {')
	assert.match(src, /export const E38_VIEWPORT = Object\.freeze\(\{ width: 1280, height: 800 \}\)/)
	assert.match(src, /^export const E38_GAP_MS = 150$/m)
	assert.match(src, /^export const E38_MIN_PX = 44$/m)
	assert.match(e, /viewport: E38_VIEWPORT/)
	assert.match(e, /\{ per: 9, perItem: 3, scope: null, types: \['sticky'\], minutes: null \}/, 'the session over route 22')
	assert.match(e, /\/api\/v1\/boards\/\$\{board\}\/vote/)
	assert.match(e, /p\.mouse\.wheel\(/, '(1) a real wheel pan')
	assert.match(e, /until\(async \(\) => !\(await visibleBox\(p, STEPPER\(A\)\)\), \{ timeout: 2000 \}\)/, '(1) the stepper of A gone within 2 s')
	assert.match(e, /visibleBox\(p, '\.knorke-board'\)/, '(2) the board container')
	assert.match(e, /right - bc <= 20/, '(2) B at most 20 px from the right edge')
	assert.match(e, /\[data-knorke-action=vote-add\]/)
	assert.match(e, /\[data-knorke-action=vote-stepper-close\]/)
	assert.match(e, /boxInside\(add, boardBox, vp\) && add\.width >= E38_MIN_PX && add\.height >= E38_MIN_PX/)
	assert.match(e, /boxInside\(close, boardBox, vp\) && close\.width >= E38_MIN_PX && close\.height >= E38_MIN_PX/)
	assert.match(e, /await p\.mouse\.click\(ax, ay\)\n\t\tawait sleep\(E38_GAP_MS\)\n\t\tawait p\.mouse\.click\(ax, ay\)/, '(3) two clicks 150 ms apart')
	assert.match(e, /K\.waitIdle\(p, 10000\)/)
	assert.match(e, /mine\.mine\?\.\[B\] === 2/)
	assert.match(e, /sn\.data\?\.votes\?\.mine\?\.\[B\] === 2/, '(3) and in the server state')
	assert.match(e, /h\.hook === 'vote-limit'/)
})

test('E38: boxInside – completely inside the viewport and the container (±0.5 px)', async () => {
	const { boxInside } = await import('./scenarios/stage4.mjs').catch(() => ({}))
	// stage4.mjs imports playwright; without it in this tree the logic is pinned as text
	if (typeof boxInside !== 'function') {
		const b = part('export function boxInside(box, inner, vp) {', '\n}\n')
		assert.match(b, /box\.x >= l - e && box\.y >= t - e && box\.x \+ box\.width <= r \+ e && box\.y \+ box\.height <= b \+ e/)
		return
	}
	const vp = { width: 1280, height: 800 }
	const inner = { x: 0, y: 50, width: 1280, height: 750 }
	assert.equal(boxInside({ x: 1200, y: 400, width: 44, height: 44 }, inner, vp), true)
	assert.equal(boxInside({ x: 1250, y: 400, width: 44, height: 44 }, inner, vp), false, 'over the right edge')
	assert.equal(boxInside({ x: 100, y: 30, width: 44, height: 44 }, inner, vp), false, 'above the container')
	assert.equal(boxInside(null, inner, vp), false)
})

test('E09c (P7-07): 403 and 404 text/html once each on /sync with ops, FROZEN_STATUSES = src/board/BoardSession.js, status every 150 ms, never gone/frozen, no offline, both notes at bob, pending 0', () => {
	const th = read('scenarios/throttle.mjs')
	const e = th.slice(th.indexOf('export const E09c = {'))
	const list = JSON.parse(th.match(/^export const FROZEN_STATUSES = Object\.freeze\((\[[^\]]*\])\)$/m)[1].replace(/'/g, '"'))
	const bs = fs.readFileSync(path.join(DIR, '..', '..', 'src', 'board', 'BoardSession.js'), 'utf8')
	const sc = fs.readFileSync(path.join(DIR, '..', '..', 'src', 'sync', 'SyncClient.js'), 'utf8')
	const consts = Object.fromEntries([...sc.matchAll(/^export const ([A-Z_]+) = '([a-z_]+)'$/gm)].map((m) => [m[1], m[2]]))
	const srcList = bs.match(/^export const FROZEN_STATUSES = Object\.freeze\(\[([^\]]*)\]\)/m)[1].split(',').map((x) => x.trim()).map((x) => (x.startsWith("'") ? x.slice(1, -1) : consts[x]))
	assert.deepEqual(list, srcList, 'the same final statuses as the client')
	assert.deepEqual([...list].sort(), ['gone', 'link_expired', 'links_disabled', 'logged_out', 'password_required', 'rate_limited', 'reload', 'revoked'], 'SPEC-M1 §6.4 FINAL_STATUSES')
	assert.match(e, /return route\.fulfill\(\{ status, contentType: 'text\/html; charset=utf-8', body: PROXY_BODY\[status\] \}\)/, 'an HTML body, no JSON')
	assert.match(th, /const PROXY_BODY = \{ 403: '<!DOCTYPE html>/)
	assert.match(e, /armed = 403\n/)
	assert.match(e, /armed = 404\n/)
	assert.match(e, /armed = null\n\t\t\t\tinjected\.push/, 'each one once')
	assert.match(th, /^export const E09C_SAMPLE_MS = 150$/m)
	assert.match(e, /const sample = \(\) => \{[\s\S]*?window\.__knorke\.state\(\)\.status[\s\S]*?\}\n\t\t\twindow\.__kdE09c = \[\]\n\t\t\tsample\(\)\n\t\t\twindow\.__kdE09cTimer = setInterval\(sample, every\)\n\t\t\}, \[\[\.\.\.FROZEN_STATUSES, 'offline'\], E09C_SAMPLE_MS\]\)/, 'read every 150 ms in the page (status, every frozen banner and offline), the first read before arming')
	const r0 = e.indexOf('const recovered = (k) =>')
	const rec = r0 < 0 ? '' : e.slice(r0, e.indexOf('await K.waitIdle(p, 10000)', r0))
	assert.ok(rec.length > 0 && !rec.includes('waitIdle') && !rec.includes('forceTick'), 'while the client recovers only state() is read (waitIdle forces ticks and would skip the backoff)')
	assert.match(e, /serverMap\('bob', board\)/, 'both notes in the snapshot as bob')
	assert.match(e, /s1\.pending === 0/)
	for (const l of ["'[C] nie [data-knorke-banner=gone]'", "'[C] kein Banner eines Status aus FROZEN_STATUSES'"]) assert.ok(e.includes(l), l)
	assert.match(e, /x\.status !== 'offline' && !x\.banners\.includes\('offline'\)/)
	assert.doesNotMatch(e.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, ''), /waitFor[F]unction/, 'CSP: poll from Node')
})

test('E31@390x844 (P7-11): the row tap on [data-knorke-vote-item=<id>] [data-knorke-action=vote-focus] in the phone pass only: panel gone within 3 s, the item centre in the viewport and outside the vote bar and any visible panel', () => {
	const s3 = read('scenarios/stage3.mjs')
	const p = s3.slice(s3.indexOf('function e31Pass(vp) {'), s3.indexOf('\n}\n', s3.indexOf('function e31Pass(vp) {')))
	const i = p.indexOf('if (narrow) {\n\t\t\t\t// P7-11')
	assert.ok(i > p.indexOf('listVote(g.page, N[0])'), 'after the vote through the list')
	assert.ok(i < p.indexOf("closePanel(g.page), '[C] vote-panel-close schließt die Liste'"), 'before the list is closed')
	assert.match(p, /\[data-knorke-vote-item="\$\{N\[0\]\}"\] \[data-knorke-action=vote-focus\]/)
	assert.match(p, /focus\.tap\(\{ timeout: 3000 \}\)/, 'a tap of the touch actor')
	assert.match(p, /vanishes\(g\.page, '\[data-knorke-vote-panel\]', 3000\)/)
	const fp = s3.slice(s3.indexOf('async function focusPlace(page, id) {'), s3.indexOf('function e31Pass(vp) {'))
	assert.match(fp, /\[data-knorke-bar=vote\], \[data-knorke-vote-panel\]/)
	assert.match(fp, /cx >= 0 && cx <= vw && cy >= 0 && cy <= vh && hit\.length === 0/)
})

test('contract.mjs (P7-C): C80–C83 between C79 and CINV; keys through the stack helper, back to the baseline in finally (4 s); the fixed numbers of §33.1 k', () => {
	const order = ['C79', 'C80', 'C81', 'C82', 'C83', 'CINV'].map((id) => contract.indexOf(`await C('${id}'`))
	assert.ok(order.every((x) => x > 0), 'all there')
	assert.deepEqual(order, [...order].sort((a, b) => a - b), 'C79 < C80 < C81 < C82 < C83 < CINV')
	const c80 = cpart('C80', "await C('C81'")
	assert.match(c80, /stack\.occ\('config:app:set', 'knorke', 'link_limit', '--value=20'\)/)
	assert.match(c80, /for \(let i = 0; i < 25; i\+\+\) \{\n\t\t\tconst r = await bob\.postLink\(b, \{\}\)/, '(a) 25 stranger calls')
	assert.match(c80, /seen\[404\] === 25/)
	assert.match(c80, /for \(let i = 0; i < 20; i\+\+\)/, '(b) 20 writing calls')
	assert.match(c80, /r21\.data\?\.retryMs === 30000 && String\(r21\.headers\?\.\['retry-after'\]\) === '30'/)
	assert.match(c80, /deepEq\(rows1, rows0\)/, 'link rows unchanged (SQL)')
	assert.match(c80, /deepEq\(reads, \[200, 200, 200\]\)/)
	assert.match(c80, /\} finally \{\n\t\tawait toBaseline\('link_limit'\)\.catch\(\(\) => \{\}\)\n\t\tawait sleep\(4000\)\n\t\tawait stack\.ratelimitReset\(\)/)
	const c81 = cpart('C81', "await C('C82'")
	assert.match(c81, /bigStyle\[`kdPad\$\{k\}`\] = 'z'\.repeat\(4800\)/)
	assert.match(c81, /ch\.repeat\(6000\)/)
	assert.match(c81, /Number\(after\[9\]\) === 4/, '(a) tombstone bytes 4')
	assert.match(c81, /Number\(putRow\[1\]\) >= 50000/)
	for (const k of ['budget_bytes_board_day', 'budget_bytes_user_day']) assert.ok(c81.includes(`stack.occ('config:app:set', 'knorke', '${k}', '--value=4000')`), k)
	assert.ok(c81.includes("stack.occ('config:app:set', 'knorke', 'changes_bytes_cap', '--value=20000')"))
	assert.equal((c81.match(/await stack\.ratelimitReset\(\)\n/g) || []).length, 3, 'reset right before every quota check: (b), (c), (d)')
	assert.match(contract, /const dayRetry = \(now\) => Math\.min\(\(Math\.floor\(now \/ DAY_MS\) \+ 1\) \* DAY_MS - now, 60000\) \+ 100/)
	assert.match(c81, /sizedSync\(alice, bb, 1500, /)
	assert.match(c81, /for \(const key of \['budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap'\]\) await toBaseline\(key\)/)
	const c82 = cpart('C82', "/** A link URL")
	assert.match(c82, /for \(let i = 1; i <= 70; i\+\+\) guests\.push\(await guest\(/)
	assert.match(c82, /alice\.summon\(b, \{ client: A2 \}\)/)
	assert.match(c82, /deepEq\(after\.data\?\.acks\?\.res, \['locked'\]\)/)
	assert.match(c82, /e1\.e === X && e1\.h === 1/)
	assert.match(c82, /guestsSeen <= 50/)
	const c83 = cpart('C83', '// Run-wide invariant')
	assert.ok(c83.includes("const PUB = 'https://knorke-harness.example.org'"))
	assert.ok(c83.includes("await setPub(`${PUB}/`)"))
	assert.ok(c83.includes("for (const bad of ['knorke-harness.example.org', 'ftp://knorke-harness.example.org', `${PUB}/x`])"))
	assert.match(c83, /\} finally \{\n\t\tawait stack\.occ\('config:app:delete', 'knorke', 'public_url'\)\.catch\(\(\) => \{\}\)\n\t\tawait sleep\(4000\)/)
	assert.doesNotMatch(c80 + c81 + c83, /bridge\(/, 'no bridge in the contract cases (ED-42)')
})
