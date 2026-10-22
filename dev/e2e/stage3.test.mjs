/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Static self-test of the stage-3 harness (SPEC-M1 §8.3, §8.4, Revisions 16
 * and 17)
 * – no browser, no stack (the scenario modules read env.json on import, so
 * they are checked as text):
 * - scenarios/index.mjs: E31, E32, E33 with their viewport passes after E26
 *   and before E09, in id order; the E28 passes right after E28
 * - the viewport passes (TST-10): exactly 390x844 and 820x1180 for E28, E31
 *   and E33, the viewport only for the touch actor
 * - every check label of scenarios/stage3.mjs names exactly ONE owner
 *   (SPEC-M1 §9.6), no page.waitForFunction, every case and pass clears the
 *   ILimiter budgets first (TST-13)
 * - the R16 wording of E31 (canvas selection, counter 0, scene state,
 *   sentPresence, presence decay, toasts, confirmation, ranking once,
 *   totals, "Close results", vote afterwards over vote-expire), E32
 *   (meta().timer and clockOffset, route 24 with 3 s, done and time_up in
 *   6 s), E33 (reducedMotion, note size, ±5 %, 3 s/5 s, chip, tap under the
 *   finger with forceTick and 450 ms, held jump ≥ 1.5 s, "Edit" before the
 *   frame list and Shift+2, second presentation), E28 stage 3 and E11
 *   device_vote
 * - the full run fits World's board cap (passes counted per call)
 * - contract.mjs C69–C75: the R16 forms (limiter reset first, votes shape,
 *   Stack.voteExpire in the three C72 sub-cases, codes of C73, the five
 *   invalid v of C75) and the R17 K2 sub-case of C70 (vote on N, an editor
 *   moves N out of the scope frame, n 0 → ok, left + n)
 * - R17 K7: every pass with an open session (E31, E33 and E28 after its
 *   route-22 start) runs the bars check with requireVote, so "VoteBar at the
 *   bottom" is checked at 390 × 844 and at 820 × 1180
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/stage3.mjs')
const part = (a, b) => {
	const i = src.indexOf(a)
	assert.ok(i >= 0, `found: ${a}`)
	return src.slice(i, b ? src.indexOf(b, i + 1) : undefined)
}
const contract = fs.readFileSync(path.join(DIR, '..', 'sim', 'contract.mjs'), 'utf8')
const cpart = (id, next) => contract.slice(contract.indexOf(`await C('${id}'`), contract.indexOf(next))

test('index: E31–E33 with their passes after E26, before E09, in id order; the E28 passes after E28 (§8.4 R16)', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	const at = (id) => list.indexOf(id)
	const order = ['E26', 'E31', 'E31_PHONE', 'E31_TABLET', 'E32', 'E33', 'E33_PHONE', 'E33_TABLET', 'E09']
	assert.ok(order.every((id) => at(id) >= 0), 'all listed')
	assert.deepEqual(order.map(at), [...order.map(at)].sort((a, b) => a - b), 'E26 < E31 (+ passes) < E32 < E33 (+ passes) < E09')
	assert.equal(at('E31') + 1, at('E31_PHONE'))
	assert.equal(at('E33') + 1, at('E33_PHONE'))
	assert.deepEqual(['E28', 'E28_PHONE', 'E28_TABLET', 'E29'].map(at), [at('E28'), at('E28') + 1, at('E28') + 2, at('E28') + 3], 'E28 passes right after E28')
	assert.ok(at('E28') > at('E16'), 'E28 after E16')
	assert.match(idx, /import \{ E31, E31_PHONE, E31_TABLET, E32, E33, E33_PHONE, E33_TABLET, E28_PHONE, E28_TABLET \} from '\.\/stage3\.mjs'/)
})

test('viewport passes (TST-10): 390x844 and 820x1180 for E28, E31, E33; one board each; the viewport only for the touch actor', () => {
	assert.match(src, /export const E31_PHONE = e31Pass\(PHONE\)\nexport const E31_TABLET = e31Pass\(TABLET\)/)
	assert.match(src, /export const E33_PHONE = e33Pass\(PHONE\)\nexport const E33_TABLET = e33Pass\(TABLET\)/)
	assert.match(src, /export const E28_PHONE = e28Pass\(PHONE\)\nexport const E28_TABLET = e28Pass\(TABLET\)/)
	const h = read('lib/harness.mjs')
	assert.match(h, /export const PHONE = \{ width: 390, height: 844 \}/)
	assert.match(h, /export const TABLET = \{ width: 820, height: 1180 \}/)
	for (const f of ['e31Pass', 'e33Pass', 'e28Pass']) {
		const body = part(`function ${f}(vp) {`, '\n}\n')
		assert.match(body, /id: 'E(28|31|33)',\n\t\tpass: `\$\{vp\.width\}x\$\{vp\.height\}`/, `${f}: pass "<w>x<h>"`)
		assert.equal((body.match(/\bworld\.board\(/g) || []).length, 1, `${f}: one board per pass`)
		const actors = [...body.matchAll(/world\.actor\([^)]*\{([^}]*)\}\)/g)].map((m) => m[1])
		assert.ok(actors.length >= 1)
		for (const o of actors) {
			if (/viewport: vp/.test(o)) assert.match(o, /touch: true/, `${f}: only a touch actor gets the viewport (${o})`)
			else assert.doesNotMatch(o, /touch: true/, `${f}: the touch actor gets the viewport (${o})`)
		}
	}
	const cli = read('lib/cli.mjs')
	assert.match(cli, /export function reportId\(sc\)/)
	assert.match(read('run.mjs'), /const rid = reportId\(sc\)\n\t\t\t\tif \(!SELECTED\.has\(rid\)\) continue/)
})

test('stage3.mjs: no page.waitForFunction, every check label starts with exactly one owner [S], [C], [B] or [D] (§9.6); limiter reset first (TST-13)', () => {
	assert.doesNotMatch(src.replace(/^\s*\*.*$/gm, ''), /waitForFunction/, 'CSP: poll from Node with until()')
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 100, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l)).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without a label that starts with exactly one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
	const runs = [...src.matchAll(/async run\(t, world\) \{\n(\t+)(.*)\n/g)].map((m) => m[2])
	assert.equal(runs.length, 6, 'E31, E32, E33 and the three pass factories')
	assert.ok(runs.every((l) => l === 'await world.limiterReset()'), `every run starts with world.limiterReset(): ${JSON.stringify(runs)}`)
	assert.doesNotMatch(src, /\bbridge\('(share-policy|group-member|circles|links-policy|legal-links)'/, 'no switching bridge action outside World.switch')
})

test('R16: E31 – canvas selection, counter 0, start with 3 votes, scene state, toasts, sentPresence and presence decay, "n voted", confirmation, ranking once, totals, Close results, vote afterwards', () => {
	const e = part('export const E31 = {', '/** A viewport pass of E31')
	for (const [re, what] of [
		[/clickFrameTitle\(a\.page, 0, 0\)[\s\S]*clickFrameTitle\(a\.page, 0, 600\)/, 'frames A and B through their title bands on the canvas'],
		[/menuAction\(a\.page, 'vote-setup'\)/, 'vote-setup through the moderation menu'],
		[/\[data-knorke-vote-scope-option=frame\]/, 'scope option frame'],
		[/=== '0'[\s\S]{0,200}\[data-knorke-vote-votable=0\]/, 'counter 0'],
		[/\[data-knorke-action=vote-start\]'\)\.first\(\)\.isDisabled\(\)/, 'start disabled at 0'],
		[/field\(a\.page, 'vote-per', '3'\)/, 'vote-per 3'],
		[/\[data-knorke-field=vote-per-item\]/, 'one vote per item switch'],
		[/sent\.per === 3 && sent\.perItem === 1 && sent\.scope === FB/, 'the request body'],
		[/timeout: 3000[\s\S]{0,120}\[C\] Leiste \[data-knorke-vote-bar\] offen bei allen ≤ 3 s/, 'bar at everyone ≤ 3 s'],
		[/const cs = await cullSet\(b\.page, N\)[\s\S]{0,400}ringsOk = \(n\) => n >= cs\.in && n <= cs\.in \+ cs\.edge[\s\S]{0,400}v\.outline === FB && ringsOk\(v\.rings\)/, 'rings = votable notes in the culled set (viewport + CULL_MARGIN, ask of [S]), outline = frame B'],
		[/const rings0 = vs \? vs\.rings : cs\.in[\s\S]{0,800}v\.rings === rings0 - 1 && v\.badges === 1/, 'rings − 1, badges + 1'],
		[/tapAt\(g, r2\.cx, r2\.cy, 40\)\n\t\tawait sleep\(80\)\n\t\tawait tapAt\(g, r2\.cx, r2\.cy, 40\)/, 'double tap'],
		[/\[data-knorke-toast=vote-limit\]/, 'vote-limit toast'],
		[/\[data-knorke-toast=vote-miss\][\s\S]*“Notizen”/, 'vote-miss toast with the frame title'],
		[/K\.sentPresence\(p\)[\s\S]{0,80}sp === null/, 'sentPresence() null'],
		[/watch\.goneAt <= 12000/, 'entries gone ≤ 12 s'],
		[/\\b2 voted\\b/, '"2 voted" at alice'],
		[/av\.voters === 2 && av\.results === null/, 'votes() of the moderator'],
		[/TEXT3\.endVoting/, 'End voting asks'],
		[/\[data-knorke-action=confirm\]/, 'confirm'],
		[/das VotePanel öffnet sich je sid nur einmal/, 'ranking once per sid'],
		[/\[data-knorke-action=vote-show\][\s\S]{0,200}v\.totals > 0/, 'Show on board → totals > 0'],
		[/\[data-knorke-action=vote-clear\][\s\S]*\(await sceneVote\(x\.page\)\) === null/, 'Close results → voteState null'],
		[/apiStart\(board, \{ minutes: 10 \}\)[\s\S]*world\.drop\(a\)[\s\S]*bridge\('vote-expire', board\)[\s\S]*\[data-knorke-toast=vote-closed\][\s\S]*state === 'closed'/, 'vote afterwards: route 22, alice leaves, vote-expire, vote-closed, state closed'],
	]) assert.match(e, re, what)
	assert.match(src, /export const TEXT3 = \{\n\tendVoting: 'End voting now\? Votes can\\'t be changed afterwards\.',\n\tvoteClosed: 'Voting has ended\.',\n\tvoteLimit: 'You have no votes left\.'/)
	const p = part('function e31Pass(vp) {', '\n}\n')
	assert.match(p, /narrow = vp\.width <= 600/)
	assert.match(p, /listVote\(g\.page, N\[0\]\)/, 'one vote through [data-knorke-vote-item] (vote-add)')
	assert.match(p, /bars\(g\.page, \{ panelOpenAtStart: panelOpen, requireVote: true \}\)/, 'bars with the panel rule and the VoteBar (R17 K7)')
	assert.doesNotMatch(p, /tapAt|swipe/, 'no canvas tap in a viewport pass')
})

test('R16: E32 – meta().timer with clockOffset at the same moment, data-knorke-timer-left, route 24 with 3 s, done and time_up in 6 s', () => {
	const e = part('export const E32 = {', '// ── E33')
	const l = part('function leftOf(page) {', '\n}\n')
	assert.match(l, /k\.meta\(\)\?\.timer/)
	assert.match(l, /m\.end - \(Date\.now\(\) \+ off\)/)
	assert.match(l, /k\.state\(\)\.clockOffset/)
	assert.match(src, /Math\.abs\(x\.left - ls\[0\]\.left\) <= 1000/, '±1 s')
	for (const a of ['timer-pause', 'timer-add1', 'timer-resume', 'timer-stop']) assert.match(e, new RegExp(`timerAction\\(a\\.page, '${a}'\\)`), a)
	assert.match(e, /b\.page\.reload\(/)
	assert.match(e, /\{ action: 'start', ms: 3000 \}/)
	assert.match(e, /state === 'done' && await bannerVisible\(p, 'time_up'\), \{ timeout: 6000 \}/)
})

test('R16: E33 – reducedMotion everywhere, notes 200 × 200, ±5 %, 3 s / 5 s, chip, tap under the finger, held jump, Edit before frames and Shift+2, second presentation', () => {
	const e = part('export const E33 = {', '/** A viewport pass of E33')
	const actors = [...e.matchAll(/world\.actor\([^)]*\{([^}]*)\}\)/g)].map((m) => m[1])
	assert.equal(actors.length, 3)
	assert.ok(actors.every((o) => /reducedMotion: 'reduce'/.test(o)), 'all contexts reducedMotion reduce')
	assert.match(e, /w: 200, h: 200/)
	assert.match(src, /const tol = 0\.05 \* me\.w/, '±5 % of the follower viewport width')
	assert.match(e, /follows\(b\.page, alicePid, lead, 3000\)/)
	assert.match(e, /follows\(g\.page, alicePid, lead, 5000\)/)
	assert.match(e, /\[data-knorke-participant="\$\{alicePid\}"\]/)
	assert.match(e, /\[data-knorke-follow-chip\]/)
	assert.match(e, /touch\(g, 'touchStart'[\s\S]{0,300}K\.forceTick\(g\.page\)[\s\S]{0,400}touch\(g, 'touchEnd', \[\]\)/, 'touchStart, forceTick, wait, touchEnd')
	assert.match(e, /held <= 450/)
	assert.match(e, /Date\.now\(\) - tRel < 1400/, 'no jump before 1.5 s')
	const mode = e.indexOf("[data-knorke-action=vote-mode]")
	assert.ok(mode > 0 && mode < e.indexOf('[data-knorke-action=frames]') && mode < e.indexOf("press('Shift+Digit2')"), 'Edit before the frame list and Shift+2')
	const end = e.indexOf("menuAction(a.page, 'summon-end')")
	assert.ok(end > 0 && e.indexOf("menuAction(a.page, 'summon')", end) > end, 'a second "Bring everyone here" after "Stop presenting"')
	assert.ok(e.lastIndexOf('swipe(g,', end) > e.indexOf("press('Shift+Digit2')"), 'Gina leaves the first presentation before it ends')
})

test('E28 stage 3 (R13/R16): anonymous text, empty name → Guest, vote_ready, vote-link QR and "Scan to vote on this board"; E11 device_vote (§12.3)', () => {
	const s2 = read('scenarios/stage2.mjs')
	const e28 = s2.slice(s2.indexOf('export const E28 = {'), s2.indexOf('// ── E29'))
	assert.match(e28, /dtext\.includes\(TEXT\.anonymous\)/)
	assert.match(e28, /gs\.name === TEXT\.guest/)
	assert.match(e28, /bannerVisible\(g\.page, 'vote_ready'\)/)
	assert.match(e28, /vqr === voteUrl/)
	assert.match(e28, /TEXT\.scanVote/)
	assert.match(s2, /scanVote: 'Scan to vote on this board',\n\tguest: 'Guest',/)
	const p = part('function e28Pass(vp) {', '\n}\n')
	assert.match(p, /field\(g\.page, 'guest-name', ''\)/)
	assert.match(p, /st\.name === TEXT3\.guest/)
	const c = read('scenarios/canvas.mjs')
	assert.match(c, /const banner = stage3 \? 'device_vote' : 'viewonly'/)
	assert.match(c, /On this device you can view and vote\. Editing works on a computer\./)
})

test('the full run (passes counted per call) fits World\'s board cap', () => {
	const world = read('scenarios/world.mjs')
	const max = Number(world.match(/^export const MAX_BOARDS_PER_RUN = (\d+)$/m)?.[1])
	let used = 1 // the shared world's board (World.build)
	const dir = path.join(DIR, 'scenarios')
	for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs') && n !== 'world.mjs')) {
		const s = fs.readFileSync(path.join(dir, f), 'utf8')
		used += (s.match(/\bworld\.board\(/g) || []).length + (s.match(/\bworld\.boards\.add\(/g) || []).length
		// a pass factory creates one board per call, not one per occurrence
		for (const m of s.matchAll(/^function (e\d+Pass)\(vp\) \{/gm)) {
			const calls = (s.match(new RegExp(`= ${m[1]}\\(`, 'g')) || []).length
			used += calls - 1
		}
	}
	assert.ok(used >= 37, `${used} boards: stages 0–2 (28) + stage 3 (9)`)
	assert.ok(used <= max, `${used} boards in a full run ≤ ${max}`)
})

test('R17 K7: the passes with an open session check "VoteBar at the bottom" in both viewports (bars with requireVote)', () => {
	for (const f of ['e31Pass', 'e33Pass', 'e28Pass']) {
		const body = part(`function ${f}(vp) {`, '\n}\n')
		assert.match(body, /bars\(g\.page, \{ panelOpenAtStart: panelOpen, requireVote: true \}\)/, `${f}: bars with requireVote`)
		assert.match(body, /VoteBar unten \(R17 K7\)/, `${f}: the check label names K7`)
		assert.doesNotMatch(body, /narrow \? '[^']*vote unten/, `${f}: "vote unten" no longer only in the narrow layout`)
	}
	const e28 = part('function e28Pass(vp) {', '\n}\n')
	const first = e28.indexOf('const m = await bars(g.page)')
	const start = e28.indexOf('apiStart(board, {})')
	assert.ok(first > 0 && start > first, 'E28: first the vote_ready bars, then a session through route 22')
	assert.ok(e28.indexOf("appears(g.page, OPEN_BAR, 3000)", start) > start, 'E28: the vote bar opens')
	const bars = read('lib/bars.mjs')
	assert.match(bars, /if \(requireVote && votes\.length === 0\)/)
	const narrowAt = bars.indexOf('if (snap.vw <= NARROW_MAX) {')
	const bottomAt = bars.indexOf('v.rect.y + v.rect.h < snap.vh - BOTTOM_SLACK')
	assert.ok(bottomAt > 0 && narrowAt > bottomAt, 'the bottom rule stands before (outside) the narrow-only block')
})

test('contract.mjs C69–C75 (§8.3 R16): limiter reset first, votes shape, Stack.voteExpire sub-cases, codes, invalid v', () => {
	const ids = ['C69', 'C70', 'C71', 'C72', 'C73', 'C74', 'C75']
	for (let i = 0; i < ids.length; i++) {
		const body = cpart(ids[i], i + 1 < ids.length ? `await C('${ids[i + 1]}'` : '// Run-wide invariant')
		assert.ok(body.length > 500, `${ids[i]} found`)
		assert.match(body, /async \(t\) => \{\n\tawait stack\.ratelimitReset\(\)\n/, `${ids[i]} starts with stack.ratelimitReset() (R16)`)
	}
	assert.match(contract, /function votesShape\(v\)/)
	assert.match(contract, /!isObj\(v\.mine\)/, 'mine an object, never []')
	const c70 = cpart('C70', "await C('C71'")
	assert.match(c70, /\/"mine":\\\{\\\}\/\.test\(r\.text\)/, 'mine {} on the wire')
	assert.match(c70, /left \+ 2/, 'deleted item: left + n')
	// R17 K2 (§8.3 C70): vote (n) on N in the scope frame, an editor moves N out by patch, n 0 → ok, left + n
	assert.match(c70, /go\(gi, \[vote\(sid, N2, 2\)\]\)[\s\S]{0,400}ops\(h, b, \[patch\(N2, \{ x: 2400, y: 400, parent: null \}\)\]\)[\s\S]{0,1200}go\(gi, \[vote\(sid, N2, 0\)\]\)[\s\S]{0,200}deepEq\(r\.data\?\.acks\?\.res, \['ok'\]\)[\s\S]{0,120}r\.data\.votes\.left === k2\.left \+ 2/, 'K2 sub-case: vote, move out of the frame, n 0 → ok, left + n')
	assert.match(c70, /n2\?\.parent === null/, 'K2: N2 really left the frame (snapshot)')
	assert.match(c70, /go\(gi, \[vote\(sid, N2, 1\)\]\)\n\tt\.check\(deepEq\(r\.data\?\.acks\?\.res, \['bad'\]\)/, 'K2: an increase outside the scope stays bad')
	const c71 = cpart('C71', "await C('C72'")
	assert.match(c71, /vt3 >= 1/, 'the old session had votes (vt ≥ 1, R16)')
	assert.match(c71, /r\.data\.votes\.voters === 0 && r\.data\.votes\.vt === 0/)
	const c72 = cpart('C72', "await C('C73'")
	assert.equal((c72.match(/stack\.voteExpire\(b\)/g) || []).length, 3, 'three sub-cases over Stack.voteExpire')
	assert.match(c72, /rawSync\(alice, b, \{ since: rev, vt: 0 \}\)/, '(2) moderator poll with vt 0')
	assert.match(c72, /'background-job:list', '--class=OCA\\\\Knorke\\\\BackgroundJob\\\\VoteCloseJob', '--output=json'/)
	assert.match(c72, /'background-job:execute', String\(job\.id\), '--force-execute'/)
	const c73 = cpart('C73', "await C('C74'")
	assert.match(c73, /errIs\(r, 400, 'bad_request'\)/)
	assert.match(c73, /ms: 5999001/)
	const c75 = cpart('C75', '// Run-wide invariant')
	for (const v of ['[0, 0, 0, 100]', '[0, 0, 10, 10, 5]', '[0, null, 10, 10]', "['0', 0, 10, 10]", '[2e7, 0, 10, 10]']) assert.ok(c75.includes(v), v)
	const env = fs.readFileSync(path.join(DIR, '..', 'sim', 'lib', 'env.mjs'), 'utf8')
	assert.match(env, /async voteExpire\(board\)/)
})
