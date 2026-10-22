/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Static self-test of the stage-2 browser scenarios (SPEC-M1 §8.4, Revision
 * 13) – no browser, no stack (the scenario modules read env.json on import,
 * so they are checked as text):
 * - scenarios/index.mjs runs E27–E30 and E36 after E16, in id order
 * - every check label of scenarios/stage2.mjs names exactly ONE owner of a red
 *   result (SPEC-M1 §9.6) – [S], [C], [B] or [D] (bridge preconditions) – never
 *   two; no page.waitForFunction (Nextcloud's CSP)
 * - E27, E28 and E30 clear the ILimiter state first (World.limiterReset, R13
 *   SRV-07); E30 switches settings only through World.switch (counterparts in
 *   World.cleanup); Nextcloud booleans are compared tolerantly (no === 'yes')
 * - the R13 wording: E27 with the group role over the API, carol in view,
 *   bob as moderator with the read-only "Links" tab and the QR code, vote
 *   through the group after the user share goes, gone without the link
 *   variant; E28's stage-2 part, branching on data-knorke-features (its
 *   stage-3 additions are pinned by stage3.test.mjs);
 *   E29 with the rescue first and bob's password dialog; E30 with its four
 *   sub-cases and the §6.11 texts; E36 with lod and staticChildren
 * - E36 clicks a note or a shape, never a connector: at LOD 2 click and
 *   marquee skip connectors (SPEC-M1 §6.3 rule (c), R13)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/stage2.mjs')
const part = (a, b) => src.slice(src.indexOf(a), b ? src.indexOf(b) : undefined)

test('index: E27–E30 and E36 run after E16, in id order (SPEC-M1 §8.4)', () => {
	const list = read('scenarios/index.mjs').match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	const at = (id) => list.indexOf(id)
	const ids = ['E27', 'E28', 'E29', 'E30', 'E36']
	for (const id of ids) assert.ok(at(id) > at('E16') && at('E16') > at('E09'), `${id} after E16 (instance settings)`)
	assert.deepEqual(ids.map(at), [...ids.map(at)].sort((a, b) => a - b), 'in id order')
	assert.match(read('scenarios/index.mjs'), /import \{ E27, E28, E29, E30, E36 \} from '\.\/stage2\.mjs'/)
})

test('stage2.mjs: no page.waitForFunction, every check label starts with exactly one owner [S], [C], [B] or [D] (§9.6)', () => {
	assert.doesNotMatch(src.replace(/^\s*\*.*$/gm, ''), /waitForFunction/, 'CSP: poll from Node with until()')
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 80, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l)).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without a label that starts with exactly one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
})

test('R13: E27, E28 and E30 clear the ILimiter state first; settings only through World.switch; Nextcloud booleans tolerant', () => {
	for (const [id, next] of [['E27', '// ── E28'], ['E28', '// ── E29'], ['E30', '// ── E36']]) {
		const body = part(`export const ${id} = {`, next)
		assert.match(body, /async run\(t, world\) \{\n\t\tawait world\.limiterReset\(\)\n/, `${id} starts with world.limiterReset()`)
	}
	assert.doesNotMatch(src, /\bbridge\('(share-policy|group-member|circles|links-policy|legal-links)'/, 'switching actions only through world.switch (counterparts in cleanup)')
	assert.doesNotMatch(src, /===\s*'(yes|no|true|false)'|'(yes|no|true|false)'\s*===/, 'no strict compare of a Nextcloud boolean (R13: ncTrue/ncFalse)')
	assert.match(src, /import \{ ncTrue \} from '\.\.\/lib\/switches\.mjs'/)
})

test('R13: E27 – view in the dialog, shared filter, live edit, group vote over the API, facilitate with the read-only Links tab and QR, vote through the group, gone without the link variant', () => {
	const e27 = part('export const E27 = {', '// ── E28')
	for (const [re, what] of [
		[/addSharee\(a\.page, 'bob', 'bob', 'Bob Berg'\)/, 'bob through the search'],
		[/neue Empfänger bekommen edit/, 'default role edit (CLI-06)'],
		[/setRole\(a\.page, 'user:bob', 'view'\)/, 'Can view'],
		[/sharedList\(b\.page\)/, '[data-knorke-filter=shared]'],
		[/row\.access === 'view' && row\.source === 'share'/, 'list row view'],
		[/bannerVisible\(b\.page, 'view_role'\)/, 'banner view_role'],
		[/until\(\(\) => hasToolbar\(b\.page\), \{ timeout: 3000 \}\)/, 'toolbar ≤ 3 s'],
		[/api\('alice', 'PUT', `\/api\/v1\/boards\/\$\{board\}\/shares`, \{ shares: \[\{ kind: 'user', id: 'bob', role: 'edit' \}, \{ kind: 'group', id: HGROUP, role: 'vote' \}\] \}\)/, 'group vote over the API with the complete list'],
		[/cs\.role === 'vote' && cs\.uiMode === 'view'/, 'carol vote/view'],
		[/voting\(fc\) \? 'vote_ready' : 'view_role'/, 'stage-3 branch on data-knorke-features'],
		[/setRole\(a\.page, 'user:bob', 'moderate'\)/, 'Can facilitate'],
		[/\(await K\.state\(b\.page\)\)\.mod === true/, 'state().mod'],
		[/mrow\.access === 'moderate'/, 'list row moderate'],
		[/\[data-knorke-action=link-toggle\]', '\[data-knorke-action=link-rotate\]', '\[data-knorke-action=link-settings-save\]', '\[data-knorke-field=link-password\]'/, 'read-only exactly'],
		[/qr === editUrl/, 'QR = edit link'],
		[/s\.role === 'vote' && s\.mod === false/, 'vote through the group'],
		[/!txt\.includes\(TEXT\.linkGone\)/, 'gone without the link variant'],
	]) assert.match(e27, re, what)
})

test('R13: E28 keeps its stage-2 part, branching on data-knorke-features (the stage-3 additions: stage3.test.mjs); E29 rescue first, then name + password, and bob\'s password dialog; E30 sub-cases with the §6.11 texts; E36 lod and staticChildren', () => {
	const e28 = part('export const E28 = {', '// ── E29')
	assert.match(e28, /touch: true/, 'Gina on a touch context')
	assert.match(e28, /api\('alice', 'POST', `\/api\/v1\/boards\/\$\{board\}\/votelink`, \{\}\)/, 'vote link through route 17')
	assert.match(e28, /if \(stage3\) t\.note\(/, 'the stage-3 branch says so in a note')
	assert.match(e28, /!dtext\.includes\(TEXT\.anonymous\)/, 'edit-link form of the name dialog')
	assert.match(e28, /gs\.mode === 'guest' && gs\.role === 'vote' && gs\.uiMode === 'view'/)
	assert.match(e28, /'\[B\] Abstimm-Gast: put → denied'/)
	assert.match(e28, /qr === editUrl/)
	assert.match(e28, /\[data-knorke-dialog=present-link\]/)
	const e29 = part('export const E29 = {', '// ── E30')
	assert.ok(e29.indexOf("'[data-knorke-dialog=rescue]'") > 0 && e29.indexOf("'[data-knorke-dialog=rescue]'") < e29.indexOf("'[data-knorke-field=guest-password]'"), 'rescue before the password field (§15 R4)')
	assert.match(e29, /TEXT\.tighten/, 'question before tightening')
	assert.match(e29, /btxt\.includes\(TEXT\.linkGone\)/, "bob's link variant")
	assert.match(e29, /\[data-knorke-dialog=link-password\]/, "bob's password dialog (R13)")
	const e30 = part('export const E30 = {', '// ── E36')
	for (const re of [/\[data-knorke-note=link-policy\]/, /\[data-knorke-error=expiry_too_far\]/, /\[data-knorke-error=group_sharing_disabled\]/, /\[data-knorke-error=sharing_disabled\]/,
		/world\.switch\('group-member', 'add', 'alice', HGROUP\)/, /world\.switch\('share-policy', 'shareapi_exclude_groups', 'yes'\)/, /dayPlus\(8\)/, /await save\.isDisabled\(\)/]) {
		assert.match(e30, re, String(re))
	}
	assert.match(src, /sharing_disabled: 'Sharing is turned off for your account\.'/)
	assert.match(src, /group_sharing_disabled: 'Sharing with groups is turned off\.'/)
	assert.match(src, /expiry_too_far: 'The expiry date can be at most 7 days away\.'/)
	const e36 = part('export const E36 = {')
	assert.match(e36, /bridge\('seed-board', board, 3000\)/)
	assert.match(e36, /sc\.lod === 2/)
	assert.match(e36, /sc\.staticChildren === 1/)
	assert.match(e36, /back\.lod === 0/)
})

test('R13 (c): the E36 click aims at a note or a shape, never at a connector (connectors are skipped by click and marquee at LOD 2)', () => {
	const e36 = src.slice(src.indexOf('export const E36 = {'))
	const types = e36.match(/const CLICK_TYPES = new Set\(\[([^\]]*)\]\)/)
	assert.ok(types, 'E36 names the click target types')
	assert.deepEqual([...types[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort(), ['shape', 'sticky'])
	assert.match(e36, /if \(!CLICK_TYPES\.has\(it\.t\)\) continue/, 'the target loop filters by CLICK_TYPES')
	assert.ok(!/'connector'/.test(e36.slice(0, e36.indexOf("t.step('zurück auf 100 %')"))), 'no connector as click target')
	const click = e36.indexOf('await p.mouse.click(target.r.x')
	assert.ok(click > e36.indexOf('CLICK_TYPES.has(it.t)'), 'the click comes after the typed target search')
	assert.match(e36, /sel && sel\.length === 1/, 'exactly the target is selected')
})

test('the full suite fits the per-run board cap of World (MAX_BOARDS_PER_RUN = 48 from stage 4, R19, 56 from factory job 032; stage 2 needed more than the M0 cap of 20)', () => {
	const world = read('scenarios/world.mjs')
	const max = Number(world.match(/^export const MAX_BOARDS_PER_RUN = (\d+)$/m)?.[1])
	assert.equal(max, 56, `cap ${max}: SPEC-M1 §8.4 R19 (T4-24) set MAX_BOARDS_PER_RUN = 48 from stage 4 on; factory job 032 (E43, E44) raised it to 56`)
	assert.match(world, /if \(this\.boards\.size >= MAX_BOARDS_PER_RUN\) throw/)
	const dir = path.join(DIR, 'scenarios')
	let used = 0
	for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs') && n !== 'world.mjs')) {
		const s = fs.readFileSync(path.join(dir, f), 'utf8')
		used += (s.match(/\bworld\.board\(/g) || []).length + (s.match(/\bworld\.boards\.add\(/g) || []).length
	}
	used += 1 // the shared world's board (World.build)
	assert.ok(used > 20, `${used} boards in a full run: more than the M0 cap of 20`)
	assert.ok(used <= max, `${used} boards in a full run ≤ ${max}`)
})

test('R14-05: E29 closes with link-expire on the edit link: guest tab link_expired (no /sync for 5 s), reload expired, bob gone with the link text', () => {
	const e29 = part('export const E29 = {', '// ── E30')
	const at = (s) => { const i = e29.lastIndexOf(s); assert.ok(i > 0, s); return i }
	const start = at("bridge('link-expire', board, 'edit')")
	assert.ok(start > at("'[C] bob wieder im Board'"), 'the closing sub-step comes after bob\'s re-join with the right password')
	for (const [s, what] of [
		["bannerVisible(g.page, 'link_expired')", 'guest tab banner link_expired'],
		["status === 'link_expired'", 'state().status link_expired'],
		["g.requestsSince(tq, /\\/sync$/)", 'no /sync after the final status'],
		['await sleep(5000)', 'five seconds of quiet'],
		["bannerVisible(g.page, 'expired')", 'reload shows the expired guest page'],
		["bannerVisible(b.page, 'gone')", 'bob gone (a later occurrence than the first sub-step)'],
	]) assert.ok(at(s) > start, what)
	assert.ok(e29.indexOf('/p/${L}`', start) > at('await sleep(5000)'), 'the reload follows the quiet period')
	assert.ok(e29.indexOf('bExpTxt.includes(TEXT.linkGone)', start) > 0, 'bob\'s gone banner carries the link text')
	assert.ok(at('for (const x of [g, b, a, n]) await world.drop(x)') > at("bannerVisible(g.page, 'expired')"), 'actors dropped after the closing sub-step')
})

test('R14-04: C66 checks linkPolicy.today of route 19 against default_timezone and that the snapshot has none', () => {
	const c = fs.readFileSync(new URL('../sim/contract.mjs', import.meta.url), 'utf8')
	const c66 = c.slice(c.indexOf("await C('C66'"), c.indexOf("await C('C67'"))
	assert.match(c66, /r\.data\?\.linkPolicy\?\.today === today/, 'route 19 owner answer: today equals today in the owner zone')
	assert.match(c66, /!\('today' in sn\.board\.linkPolicy\)/, 'snapshot linkPolicy without today')
	assert.match(c, /'passwordEnforced', 'today'\]/, 'ownerAnswer (C60) expects the fifth key')
})
