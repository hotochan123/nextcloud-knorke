/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Drift checks between the docs and the code they describe – no stack needed.
 *
 * - README "Licences": every icon key in src/components/icons.js is listed
 *   exactly once – either with its Material Design Icons name (version 7.4.47)
 *   or, since M1 stage 1, as "own drawing" (simple outlines of the project
 *   itself, AGPL like the rest); nothing else is listed. With
 *   KD_MDI_JS=<path to @mdi/js 7.4.47 mdi.js> the path data of the MDI keys is
 *   also compared with the original (optional: @mdi/js is not a dependency).
 * - Runbook "nach DB-Restore" with the board epoch (docs/ENTWICKLUNG.md §8,
 *   docs/PROTOKOLL.md §12, SPEC-M1 §5.4, replaces SPEC-M0 §5.3 c; Revision 19,
 *   T4-08): maintenance on → restore → occ config:app:set knorke epoch (a core
 *   command – Nextcloud loads no app commands in maintenance mode, so
 *   knorke:epoch:rotate is no step) → maintenance off; open tabs resync by
 *   themselves exactly once; deleting <prefix>/knorke/… keys is only an
 *   optional clean-up; no disable/enable step; the TTL facts it states match
 *   FastCache.php; ENTWICKLUNG §8 names the restore probe.
 * - Stage 4 (R19): the production runbook ENTWICKLUNG §10 (P1–P11, P3 with
 *   the two config.php keys read by grep, P6 with the full cron container
 *   name, P9 from dev/release.sh's directory, agents never act on prod); the
 *   README states the two context-menu limits of SPEC-M1 §7.7 word for word
 *   and iPad and Safari as not measured on real hardware (Revision 23; since
 *   factory job 050: R-B in a later version; since factory job 072, SPEC-M1
 *   R42, §7.7 quotes the whole iPad limit and the 0.3.0 status sentence of
 *   the README word for word); ENTWICKLUNG names the bridge actions
 *   purge-tombstones and app-config, MAX_BOARDS_PER_RUN (56), the load-run
 *   report names and the R-B tools.
 * - Stage 4, phase 1 asks: ENTWICKLUNG §10 describes occ knorke:compact as
 *   built (the key order of Compactor.php, exit codes 0/1/2 and the stderr
 *   message of Compact.php, cleanup_cursor, 60 s; [B]); §5.4 names the
 *   stage-4 measure rows of run.mjs and run.sh measure --shadows on|off, and
 *   the docs say note shadows are gradients (no shadowBlur in
 *   src/scene/nodes; [S]); §5.5 quotes both check-fresh lines in the form
 *   build/check-fresh.mjs prints them, §5.8 the CSS line of dev/release.sh ([C]).
 * - Stage 4, phase 2, known fixes of Revision 20 (docs of [D]): PROTOKOLL §14
 *   states exit 2, blocks and the run without --board of occ
 *   knorke:compact (K4); ENTWICKLUNG §5.4 no longer says "Stand Stufe 2" and
 *   names the -noshadow report names exactly as dev/scene-lab/names.js
 *   builds them (K9 after K8); ARCHITEKTUR §5 lists grouping (with group
 *   locking) under M2 and locking after A3, grouping no longer under "Später"
 *   (K11); ENTWICKLUNG §5.1 states the oracle rule of K1 (the code of
 *   §4.13.7 "Folgen", folgenCode in dev/sim/lib/oracle.mjs).
 * - SPEC-M1 §5.1: every argument of createDistributed( in lib/ matches the
 *   regular expression ^'knorke/' \. \$epoch \. '/'$ – the Redis key form
 *   <global prefix>/knorke/<epoch>/<key> the tools search with. A call in
 *   another form is red for [B] (SPEC-M1 §9.6).
 * - Every Markdown document of [D] has exactly one SPDX header and one H1: a
 *   scripted edit with String.prototype.replace and "$`" in the replacement
 *   once copied docs/ENTWICKLUNG.md into itself twice (round 2, trap 9.22).
 * - The scenario ids in dev/e2e/scenarios/index.mjs and the contract case ids
 *   in dev/sim/contract.mjs are the ones the README names (C01–C<last>,
 *   E01–E<last>).
 * - docs/ENTWICKLUNG.md §5.4 (scene lab, owner of the lab is [S]) states the
 *   gate and check counts that dev/scene-lab/run.mjs declares (step('gate' …)
 *   and step('check' …)), names the stage-2 checks and measure rows that
 *   exist in the lab, and the number of automatic rows ipad/check.mjs expects
 *   (SPEC-M1 §8.5 (R13), ask of [S] in stage 2); since stage 3 also G15/G16,
 *   the checks "Folgen (2), (5), (1)" and "mode vote with real input" and the
 *   report names the lab writes itself (dev/scene-lab/names.js,
 *   KNORKE_LAB_LABEL; SPEC-M1 §9.0 R16, ask of [S] in stage 3).
 * - docs/ENTWICKLUNG.md follows the R17 harness (SPEC-M1 §8.4 K6, K7): the
 *   bridge self-test records the WP-B2/WP-B3 outcomes as checks (no "als
 *   Notiz"), trap 41 describes menuAction of R17 (fast path only outside a
 *   popover, Esc on open menus, owner tag, elementFromPoint), and the bars
 *   rule "vote unten" holds in both widths.
 * - Revision 23 (SPEC-M1 §34), as of R39: ENTWICKLUNG §10 describes V1 as
 *   live for /sync and keeps the V3 rule, now because the re-join POST …/join
 *   still answers one 403 password_required after a new password; the E7
 *   line follows SPEC-M1 §10 E7 (R23); the README edge-ban limit names the
 *   end states with HTTP 200 and the 401/403 that remain and keeps the rule,
 *   and the administrators' example whitelist still leaves out /join.
 * - Factory job 059 (SPEC-M1 R39, end states with HTTP 200 of factory job
 *   028): the header name and the end-state codes in PROTOKOLL and SPEC-M1
 *   are the ones of lib/Controller/ApiResponses.php and src/sync/http.js
 *   (END_STATE_HEADER, END_STATES); PROTOKOLL §2 has one 200 row and §5.2
 *   reserves `end`; SPEC-M1 §1.2, §4.2, §4.5, §6.4, §8.3 (C87), §12.2, the
 *   head line and §50 carry R39; the CHANGELOG's [Unreleased] names the header.
 * - Factory job 084 (follow-ups of 059): the CHANGELOG's [Unreleased] says a
 *   tab ends after the sync once link sharing is turned off, without a join;
 *   the support hints of the README and of ENTWICKLUNG §10 name link sharing
 *   turned off by the administrator and the sync after a new password; the
 *   200 row of PROTOKOLL §2 says which old row each code follows; ENTWICKLUNG
 *   §10 no longer says "Weiter 401 oder 403 senden" (tabs get them).
 * - Factory job 104 (follow-ups of 084): the client column of the 200 row of
 *   PROTOKOLL §2 names, for every code, the old row it follows, the 403 row
 *   of the four codes in „…“; every row it names exists in §2.
 * - Factory job 116 (follow-ups of 104): the support hint in the README's
 *   example for administrators names the one 403 the join still gets after
 *   a new password with its code, `password_required`.
 * - Factory job 123 (follow-up of 118): the copy blocks of ENTWICKLUNG §10
 *   (P9 step 3, hotfix step 4 dry run and real run) are chained with && and
 *   the rm stands on its own line; run in bash with rsync and chown as stubs,
 *   a failed tar, rsync or chown stops every step after it and the rm still
 *   removes $tmp. P9 step 1 names the fertig line of dev/release.sh.
 * - Factory job 127 (follow-up of 123): the sentences of ENTWICKLUNG §10 that
 *   say what a failed step means (P9 step 3 with its own stop rule, the
 *   hotfix intro of the dry run, any error message in the dry run, a failed
 *   rsync or chown in the real run) are pinned word for word; the messages
 *   of the bash runs F2–F7 carry bash's stderr, and the content lock names
 *   all four words it blocks.
 * - SPEC-M1 §6.11 (R25, follow-up of factory job 003): the row of the board
 *   menu's count line names the two source strings of the l10n/de.json entry
 *   "_%n item on this board_::_%n items on this board_", and its German
 *   column is the two values of that entry word for word, so a change to
 *   de.json cannot drift from the spec unnoticed.
 * - Local values (factory job 036, SPEC-M1 §12.1 R16): the keys of
 *   dev/local.env.example, the key list KD_LOCAL_KEYS of dev/lib.sh and the
 *   key table of ENTWICKLUNG §3.10 "Lokale Werte (`dev/local.env`)" are the
 *   same three; §3.10 names KD_LOCAL_ENV, the ignored BOM, the regex spelling
 *   [.] and example.org as the placeholder host, and the template has an SPDX header
 *   with every line commented out; in the switch table of §3.2 the KD_DNS row
 *   has no IP address as its default, and KD_LAN_HOST, KD_PROD_STACK_DIR and
 *   KD_LOCAL_ENV have rows.
 * - Factory job 050 (store release 0.3.0): the README status names 0.3.0 as
 *   the first release in the Nextcloud App Store and no longer says "custom
 *   app" or "follows with M2"; live totals for facilitators and "Only
 *   accounts may vote" are planned for a later version, not for M2; the
 *   CHANGELOG's [Unreleased] section notes the timeless app description.
 * - Factory job 063 (SPEC-M1 R40, privacy notice of factory job 032): route
 *   27 is in appinfo/routes.php and has one SPEC-M1 §4.1 row right after
 *   route 26 (with its 403 and 400 codes and the limits of PrivacyNotice.php)
 *   and one body-key row; §4.11.3 states INITIAL_STATE_KEYS as
 *   PageController.php declares it; §4.4 and PROTOKOLL §4 name
 *   board.linkOpenSince (set in SyncController, not in PublicSyncController);
 *   §6.6 names the components, 30vh and both storage keys; every hook §6.8
 *   names is set in the code; §6.11 has one row per notice text with its
 *   l10n/de.json German; ED-36 and §8.4 (R14) name 56; the head line has a
 *   revision ≥ 40 and §51; the README's "Privacy notice for guests."
 *   paragraph and the CHANGELOG's [Unreleased] entry name what they must.
 * - Revision 52 (SPEC-M1 §63, factory job 133): R-B is no step before the
 *   App Store release any more (user, 2026-10-22: no iPad); the SPEC-M1
 *   places with the current plan carry (R52), some in the words "keine
 *   Voraussetzung für das App-Store-Release", and the R-B places of
 *   ENTWICKLUNG say it too, without M2 and without "vor dem/das
 *   App-Store-Release"; §8.8 (7) records the device check of 2026-10-22
 *   (board, devices, paths, no fps values, Safari on iPadOS unmeasured).
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scanText } from './lib/privateValues.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/**
 * The status sentence at the top of the README (factory job 050: 0.3.0, the
 * first App Store release), quoted word for word in SPEC-M1 §7.7 (R22, R42).
 * Taking the store sentences back (ENTWICKLUNG §11) changes it here once.
 */
const README_STATUS = '**Status: version 0.3.0, the first release in the Nextcloud App Store.** It contains milestone M1 and a first part of milestone M2.'

/** icons.js keys → path data (text parse: the module is plain data). */
function iconPaths() {
	const src = read('src/components/icons.js')
	return new Map([...src.matchAll(/^\s*(\w+):\s*'([^']+)',?\s*$/gm)].map((m) => [m[1], m[2]]))
}

/** README icon table → key → MDI name. */
function readmeIcons() {
	const md = read('README.md')
	return new Map([...md.matchAll(/^\| `(\w+)` \| `mdi-([a-z0-9-]+)` \|$/gm)].map((m) => [m[1], m[2]]))
}

/** README keys listed as own drawings ("| `key` | own drawing |"). */
function readmeOwnIcons() {
	const md = read('README.md')
	return [...md.matchAll(/^\| `(\w+)` \| own drawing \|$/gm)].map((m) => m[1])
}

test('README names every icon of src/components/icons.js once: MDI name or own drawing', () => {
	const code = iconPaths()
	const docs = readmeIcons()
	const own = readmeOwnIcons()
	assert.ok(code.size >= 10, `icons.js parsed (${code.size} keys)`)
	assert.deepEqual(own.filter((k) => docs.has(k)), [], 'no key is both MDI and own drawing')
	assert.equal(new Set(own).size, own.length, 'no own drawing listed twice')
	assert.deepEqual([...docs.keys(), ...own].sort(), [...code.keys()].sort(), 'README tables (MDI + own drawings) = icons.js keys')
	const md = read('README.md')
	assert.match(md, /Material Design Icons\]\([^)]+\) 7\.4\.47/)
	assert.match(md, /Apache License 2\.0/)
	assert.match(read('src/components/icons.js'), /Material Design\s+\*?\s*Icons 7\.4\.47/)
})

test('icon path data equals @mdi/js 7.4.47 (only with KD_MDI_JS)', { skip: !process.env.KD_MDI_JS && 'KD_MDI_JS not set' }, () => {
	const lib = fs.readFileSync(process.env.KD_MDI_JS, 'utf8')
	const byName = new Map([...lib.matchAll(/export (?:var|const) mdi(\w+) = "([^"]+)"/g)].map((m) => [
		m[1].replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase(), m[2]]))
	const code = iconPaths()
	for (const [key, name] of readmeIcons()) {
		assert.ok(byName.has(name), `mdi-${name} exists in @mdi/js`)
		assert.equal(code.get(key), byName.get(name), `${key} = mdi-${name}`)
	}
})

/** Text of the section that starts with `heading` (up to the next `## ` heading). */
function section(file, heading) {
	const md = read(file)
	const i = md.indexOf(heading)
	assert.ok(i >= 0, `${file}: section "${heading}" exists`)
	const j = md.indexOf('\n## ', i + heading.length)
	return md.slice(i, j < 0 ? md.length : j)
}

/** The fenced code blocks of a Markdown part, each as its lines without the indentation of a list item. */
function fencedBlocks(md) {
	return [...md.matchAll(/^ *```[^\n]*\n([\s\S]*?)\n *```[ \t]*$/gm)].map((m) => m[1].split('\n').map((l) => l.trim()))
}

/** Every *.php file below dir (relative to ROOT). */
function phpFiles(dir) {
	return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name)
		return e.isDirectory() ? phpFiles(p) : (e.name.endsWith('.php') ? [p] : [])
	})
}

const RUNBOOKS = [
	['docs/ENTWICKLUNG.md', '## 8. Runbook „nach DB-Restore“'],
	['docs/PROTOKOLL.md', '## 12. Runbook „nach DB-Restore“'],
]

test('DB-restore runbook with the board epoch: maintenance on → restore → occ config:app:set knorke epoch → maintenance off (SPEC-M1 §5.4 R19)', () => {
	for (const [file, heading] of RUNBOOKS) {
		const s = section(file, heading)
		// a restore resets oc_appconfig too: the new epoch belongs AFTER it, set by a core command (R19, T4-08)
		const on = s.indexOf('maintenance:mode --on')
		const restore = s.search(/zurückspielen/)
		const epoch = s.indexOf('config:app:set knorke epoch --value=', restore)
		const off = s.indexOf('maintenance:mode --off', epoch)
		assert.ok(on >= 0 && restore > on && epoch > restore && off > epoch,
			`${file}: order maintenance on (${on}) < restore (${restore}) < config:app:set knorke epoch (${epoch}) < maintenance off (${off})`)
		// step 3 of the numbered list is the core command, never the app command
		const step3 = s.match(/^3\. (.*)$/m)?.[1] ?? ''
		assert.match(step3, /config:app:set knorke epoch --value=/, `${file}: step 3 sets the epoch with config:app:set`)
		assert.match(step3, /keine App-Befehle/, `${file}: says why (no app commands in maintenance mode)`)
		assert.match(s, /\[a-z0-9\]/, `${file}: 8 characters [a-z0-9]`)
		assert.doesNotMatch(s, /app:disable knorke\s*&&/, `${file}: no disable/enable step`)
		assert.match(s, /resync/i, `${file}: open tabs resync`)
		assert.match(s, /genau einmal/, `${file}: … exactly once`)
		assert.match(s, /3 s/, `${file}: names the 3-s app-config cache of other PHP processes`)
		// deleting keys is no step any more, at most an optional clean-up
		const scan = s.indexOf("*/knorke/*")
		if (scan >= 0) assert.match(s.slice(Math.max(0, scan - 600), scan + 200), /optional/i, `${file}: deleting */knorke/* only as an optional clean-up`)
		assert.doesNotMatch(s, /Neu laden allein hilft/, `${file}: no M0 claim that only deleting the keys helps`)
	}
	const dev = section('docs/ENTWICKLUNG.md', RUNBOOKS[0][1])
	assert.match(dev, /KD_NS=<ns> dev\/occ\.sh maintenance:mode --on[\s\S]*KD_NS=<ns> dev\/occ\.sh config:app:set knorke epoch --value=[\s\S]*KD_NS=<ns> dev\/occ\.sh maintenance:mode --off/, 'dev-stack commands in order')
	assert.doesNotMatch(dev.slice(dev.indexOf('```')), /dev\/occ\.sh knorke:epoch:rotate/, 'no app command in the maintenance-mode commands')
	assert.match(dev, /dev\/selftest\/restore\.sh/, 'the restore probe (§10 P5)')
	assert.match(dev, /restore-pgsql\[-<Kennzeichen>\]\.\{md,json\}/, 'its report name')
	assert.match(dev, /KD_NS=<ns> dev\/redis-keys\.sh/, 'how to look at the keys')
})

test('DB-restore runbook: the TTL facts match FastCache', () => {
	const fc = read('lib/Service/FastCache.php')
	const ttl = (name) => Number(fc.match(new RegExp(`const ${name} = (\\d+);`))?.[1])
	assert.equal(ttl('REV_TTL'), 30)
	assert.equal(ttl('GENS_TTL'), 120)
	assert.equal(ttl('GRANT_TTL'), 120)
	assert.equal(ttl('GONE_TTL'), 300)
	const dev = section('docs/ENTWICKLUNG.md', RUNBOOKS[0][1])
	for (const t of ['30 s', '120 s', '300 s']) assert.ok(dev.includes(t), `ENTWICKLUNG §8 names ${t}`)
	assert.ok(section('docs/PROTOKOLL.md', RUNBOOKS[1][1]).includes('300 s'), 'PROTOKOLL §12 names 300 s')
})

/** The regular expression of SPEC-M1 §5.1 for every createDistributed( argument in lib/. */
export const PREFIX_RE = /^'knorke\/' \. \$epoch \. '\/'$/

/** [file, argument] of every createDistributed( call below dir (balanced parentheses). */
function distributedCalls(dir) {
	return phpFiles(dir).flatMap((f) => {
		const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#).*$/gm, '')
		const out = []
		let i = src.indexOf('createDistributed(')
		while (i >= 0) {
			let depth = 0
			let j = i + 'createDistributed'.length
			for (; j < src.length; j++) {
				if (src[j] === '(') depth++
				else if (src[j] === ')' && --depth === 0) break
			}
			out.push([f, src.slice(i + 'createDistributed('.length, j).trim()])
			i = src.indexOf('createDistributed(', j)
		}
		return out
	})
}

test('PREFIX_RE is the expression of SPEC-M1 §5.1 and tells the forms apart', () => {
	const spec = read('docs/SPEC-M1.md')
	assert.ok(spec.includes("`^'knorke/' \\. \\$epoch \\. '/'$`"), 'SPEC-M1 §5.1 states this expression')
	assert.match("'knorke/' . $epoch . '/'", PREFIX_RE)
	for (const bad of ["'knorke/'", "'knorke/' . $this->epoch->current() . '/'", "'knorke/'.$epoch.'/'", "\"knorke/\" . $epoch . \"/\"", "'knorke/' . $epoch", "'knorke/' . $epoch . '/' . $x"]) {
		assert.doesNotMatch(bad, PREFIX_RE, bad)
	}
})

test('every createDistributed( in lib/ has the epoch prefix form of SPEC-M1 §5.1 (red → [B])', () => {
	const calls = distributedCalls('lib')
	assert.ok(calls.length >= 2, `createDistributed calls found (${calls.length})`)
	for (const f of ['lib/Service/FastCache.php', 'lib/Service/PresenceStore.php']) assert.ok(calls.some(([g]) => g === f), `${f} uses createDistributed`)
	const wrong = calls.filter(([, arg]) => !PREFIX_RE.test(arg))
	assert.deepEqual(wrong, [], 'createDistributed(<arg>) not in the form \'knorke/\' . $epoch . \'/\' (owner [B], SPEC-M1 §9.6)')
})

const MD_DOCS = ['README.md', 'CHANGELOG.md', 'docs/ARCHITEKTUR.md', 'docs/ENTWICKLUNG.md', 'docs/PROTOKOLL.md']

test('every Markdown document has exactly one SPDX header and one H1 (no self-copy)', () => {
	for (const f of MD_DOCS) {
		const md = read(f)
		assert.equal((md.match(/SPDX-FileCopyrightText/g) || []).length, 1, `${f}: one SPDX header`)
		// H1 outside fenced code blocks
		const h1 = md.replace(/^```[\s\S]*?^```/gm, '').match(/^# /gm) || []
		assert.equal(h1.length, 1, `${f}: one H1`)
	}
})

test('README names the last contract case and the last browser scenario', () => {
	const contract = read('dev/sim/contract.mjs')
	const cases = [...contract.matchAll(/^await C\('C(\d+)/gm)].map((m) => Number(m[1]))
	const lastC = Math.max(...cases)
	const index = read('dev/e2e/scenarios/index.mjs')
	const list = index.match(/SCENARIOS = \[([^\]]+)\]/)[1]
	const lastE = Math.max(...[...list.matchAll(/E(\d+)\b/g)].map((m) => Number(m[1])))
	const md = read('README.md')
	assert.ok(md.includes(`C01–C${lastC}`), `README names C01–C${lastC}`)
	assert.ok(md.includes(`E01–E${lastE}`), `README names E01–E${lastE}`)
	assert.ok(!new RegExp(`C01–C(?!${lastC}\\b)\\d+`).test(md), 'README names no older contract range')
})

test('ENTWICKLUNG §5.4 matches the scene lab: gate and check counts, stage-2 checks, measure rows (SPEC-M1 §8.5 R13)', () => {
	const lab = read('dev/scene-lab/run.mjs')
	const gates = (lab.match(/\bstep\('gate',/g) || []).length
	const checks = (lab.match(/\bstep\('check',/g) || []).length
	const md = read('docs/ENTWICKLUNG.md')
	const sec = md.slice(md.indexOf('### 5.4 '), md.indexOf('## 6. '))
	assert.ok(sec.length > 0, '§5.4 found')
	const m = sec.match(/\*\*(\d+) Gates\*\* und \*\*(\d+) Prüfungen\*\* insgesamt \(die (\d+) Gates plus (\d+) Einzelprüfungen/)
	assert.ok(m, '§5.4 states the counts')
	assert.deepEqual(m.slice(1).map(Number), [gates, gates + checks, gates, checks], `run.mjs declares ${gates} gates and ${checks} checks`)
	assert.ok(sec.includes(`Grün heißt ${gates}/0 und ${gates + checks}/0`), 'green line with the same counts')
	// stage 2: G14 and the three new checks exist in the lab and in the doc
	assert.match(lab, /step\('gate', 'G14 LOD 2:/)
	for (const name of ['setMode settle during a real mouse drag', 'LOD 2 painting', 'LOD 2 interaction (E36 in the lab)']) {
		assert.ok(lab.includes(name), `lab check "${name}"`)
		assert.ok(sec.includes(`„${name}“`), `§5.4 names "${name}"`)
	}
	// measure rows and fields
	// [lab text, doc text]: the board-pan label is a template in run.mjs (scale and count filled in)
	for (const [inLab, inDoc] of [['Board-Zoom um 8 % (G14)', 'Board-Zoom um 8 % (G14)'], [' Verbinder im Bild, nicht gezeichnet)', '(LOD 2, 800 Verbinder im Bild, nicht gezeichnet)'], ['lod2First', 'lod2First']]) {
		assert.ok(lab.includes(inLab), `run.mjs has "${inLab}"`)
		assert.ok(sec.includes(inDoc), `§5.4 names "${inDoc}"`)
	}
	assert.ok(read('dev/scene-lab/panel.js').includes('Ganzes Board schwenken (auto)'), 'tablet panel row')
	assert.ok(sec.includes('„Ganzes Board schwenken (auto)“'), '§5.4 names the tablet panel row')
	const rows = Number(read('dev/scene-lab/ipad/check.mjs').match(/autoRows === (\d+)/)?.[1])
	assert.ok(rows > 0 && sec.includes(`erwartet nach der Automatik-Messung ${rows} Zeilen`), `§5.4 names the ${rows} automatic rows of ipad/check.mjs`)
})

test('ENTWICKLUNG §5.4 names the stage-3 lab gates G15/G16, the two stage-3 checks and the report names of names.js (SPEC-M1 §8.5, §9.0 R16; ask of [S] in stage 3)', () => {
	const lab = read('dev/scene-lab/run.mjs')
	const md = read('docs/ENTWICKLUNG.md')
	const sec = md.slice(md.indexOf('### 5.4 '), md.indexOf('## 6. '))
	for (const [gate, inDoc] of [["step('gate', 'G15 Folgen:", '**G15 Folgen:**'], ["step('gate', 'G16 Abzeichen:", '**G16 Abzeichen:**']]) {
		assert.ok(lab.includes(gate), `run.mjs declares ${gate}`)
		assert.ok(sec.includes(inDoc), `§5.4 names ${inDoc}`)
	}
	for (const [inLab, inDoc] of [
		["step('check', 'Folgen (2), (5), (1): a new followTo replaces the glide", '„Folgen (2), (5), (1)“'],
		["step('check', 'mode vote with real input (SPEC-M1 §6.3)", '„mode vote with real input“'],
	]) {
		assert.ok(lab.includes(inLab), `run.mjs has the check "${inLab}"`)
		assert.ok(sec.includes(inDoc), `§5.4 names ${inDoc}`)
	}
	// the names the lab writes itself (dev/scene-lab/names.js) as §5.4 states them
	const names = read('dev/scene-lab/names.js')
	assert.match(names, /gates-<variant>\[-<label>\]\.\{json,md\}/)
	assert.match(names, /measure-<browser>-<variant>\[-<set>\]\[-noshadow\]\[-<label>\]\.json/, 'with -noshadow since R20 (K8)')
	for (const s of ['out/gates-<cpu|gpu>[-<Kennzeichen>].{json,md}', 'Kopie out/gates.{json,md}',
		'out/measure-<chromium|webkit>-<cpu|gpu>[-<set>][-noshadow][-<Kennzeichen>].json und report-<…>.md', 'Kopie out/measure.json, out/report.md',
		'`KNORKE_LAB_LABEL` (`^[a-z0-9-]{1,24}$`, für `gates`/`measure`/`ipad`, nicht für `dist`)',
		'`out/ipad-check[-<Kennzeichen>].{json,md}`, `out/ipad-check.{json,md}` bleibt als Kopie des letzten Laufs']) {
		assert.ok(sec.includes(s), `§5.4 states "${s}"`)
	}
	assert.ok(read('dev/scene-lab/run.sh').includes('LABEL="${KNORKE_LAB_LABEL:-}"'), 'run.sh reads KNORKE_LAB_LABEL')
})

test('ENTWICKLUNG follows the R17 harness: bridge self-test outcomes are checks, not notes; trap 41 describes the R17 menuAction; bars "vote unten" in both widths (SPEC-M1 §8.4 R17 K6, K7)', () => {
	const md = read('docs/ENTWICKLUNG.md')
	const i = md.indexOf('`dev/e2e/run.sh --selftest` prüft jede Aktion ohne Browser')
	assert.ok(i >= 0, 'the bridge self-test paragraph exists')
	const para = md.slice(i, md.indexOf('\n', i))
	assert.doesNotMatch(para, /(steht|stehen) als Notiz/, 'no WP-B2/WP-B3 outcome "als Notiz" any more')
	assert.doesNotMatch(para, /wenn die API antwortet/, 'the live part is no longer optional')
	assert.match(para, /Neu-Beitritt muss 403 `link_expired` liefern \(\*\*\(R17, K6\)\*\* eine Prüfung/)
	assert.match(para, /Die Stimm-Op liefert `\["closed"\]`/)
	assert.match(para, /antwortet Route 22 nicht mit 200, ist der Selbsttest rot/)
	assert.match(para, /Als Notiz bleibt nur `pgss`/)
	for (const p of ['dev/e2e/lib/selftestLive.mjs', 'dev/e2e/selftestLive.test.mjs']) {
		assert.ok(para.includes(p) && fs.existsSync(path.join(ROOT, p)), `names ${p}, which exists`)
	}
	const t41 = md.slice(md.indexOf('\n41. '), md.indexOf('\n42. '))
	assert.ok(t41.length > 100, 'trap 41 found')
	assert.doesNotMatch(t41, /Esc nimmt es nie/, 'trap 41: the old "never Esc" rule is gone')
	for (const s of ['außerhalb** jedes Popovers', '`button[aria-haspopup][aria-expanded="true"]`: Esc', 'preventDefault', '„[C] menuAction <name>: …“', '`document.elementFromPoint`']) {
		assert.ok(t41.includes(s), `trap 41 names ${s}`)
	}
	const m = read('dev/e2e/lib/moderation.mjs')
	assert.match(m, /export const OPEN_TRIGGERS = 'button\[aria-haspopup\]\[aria-expanded="true"\]'/)
	assert.match(m, /el\.closest\('\.v-popper__popper, \[role=menu\]'\)/)
	const s3 = md.slice(md.indexOf('- SPEC-M1 Stufe 3 (`scenarios/stage3.mjs`'), md.indexOf('\n', md.indexOf('- SPEC-M1 Stufe 3 (`scenarios/stage3.mjs`')))
	assert.match(s3, /\*\*\(R17, K7\)\*\* in beiden Breiten `vote` unten/)
	assert.match(read('dev/e2e/lib/bars.mjs'), /^export const BOTTOM_SLACK = 1$/m)
})

// ── stage 4 (SPEC-M1 R19) ──────────────────────────────────────────────────

test('ENTWICKLUNG §10 is the production runbook of SPEC-M1 §10: P1–P14, P3 by occ config:system:get, P6 cron container, P9 from dev/release.sh, agents never act on prod', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) assert.match(p, new RegExp(`^\\| P${n} \\|`, 'm'), `row P${n}`)
	assert.ok(p.includes('docker exec -u www-data nextcloud-nextcloud-1 php occ config:system:get memcache.distributed'), 'P3: the effective value of the cache key (R22, OPS-4)')
	assert.ok(p.includes('docker exec -u www-data nextcloud-nextcloud-1 php occ config:system:get ratelimit.protection.enabled'), 'P3: the effective value of the limiter key')
	assert.doesNotMatch(p, /memcache\\\.distributed/, 'P3: the escaped grep form is gone')
	assert.doesNotMatch(p, /grep -E/, 'P3: no grep of config.php')
	assert.match(p, /nextcloud-nextcloud-cron-1/, 'P6: the full container name (T4-21)')
	assert.match(p, /maintenance_window_start/)
	assert.match(p, /dev\/release\.sh/)
	assert.match(p, /dev\/release\/out\/knorke-<version>\//, 'P9: the release directory is the source')
	assert.match(p, /sha256sum -c knorke-<version>\.tar\.gz\.sha256/)
	// factory job 118: the commands name the release of the current version, never a fixed one
	assert.doesNotMatch(p, /knorke-\d+\.\d+\.\d+/, 'no fixed release name such as knorke-0.2.0 in the runbook')
	assert.equal(p.split('\n').filter((l) => l.trim() === 'tmp="$(mktemp -d)" && tar -xzf dev/release/out/knorke-<version>.tar.gz -C "$tmp" &&').length, 2, 'P9 step 3 and the hotfix unpack knorke-<version>.tar.gz')
	// factory job 123: P9 step 1 points to the fertig line of dev/release.sh, which names version, archive and SHA-256
	assert.ok(p.includes('`… fertig: …/knorke-<version> (<n> Dateien), …/knorke-<version>.tar.gz, <SHA-256>`'), 'P9 step 1 names the fertig line of dev/release.sh')
	assert.match(read('dev/release.sh'), /^log "fertig: \$DEST \(\$FILES Dateien\), \$TGZ, \$\(cut -d' ' -f1 "\$TGZ\.sha256"\)"$/m, 'dev/release.sh logs that line')
	assert.match(p, /Agenten führen auf Prod nichts aus/)
	assert.match(p, /P3 \| .*\| Nutzer \(lesend\) \|/, 'P3: the owner is the user (ED-35)')
	assert.match(p, /summary-<Kennzeichen>\.md/, 'P2: the labelled summary of the accepted run')
	assert.match(p, /config:app:set knorke epoch/, 'restore on prod: the R19 runbook')
	const order = ['app:enable knorke', 'theming cachebuster', 'zwei Konten und einem Gast'].map((x) => p.indexOf(x))
	assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'P9 steps in order')
})

test('README states the context-menu limits, the 0.3.0 status sentence and the iPad limit of SPEC-M1 §7.7 word for word; iPad/Safari not measured on real hardware, R-B in a later version (§7.7 R22, R23, R42, R45; factory jobs 050, 072 and 078)', () => {
	const spec = read('docs/SPEC-M1.md')
	const md = read('README.md')
	const want = [
		'Right-click menu: Firefox always shows its own menu on Shift+right-click (the page never sees it); Mac keyboards have no context-menu key, Shift+F10 may need fn, and Ctrl+click works as a right click; a finger opens no menu, not even with a long press (in edit mode with the Select tool, a finger held still on empty canvas starts a selection frame instead; see "Selecting with a finger"); tablets view and vote.',
		'Paste here (right-click menu) reads the clipboard through the browser\'s clipboard API. It only appears over HTTPS (or on localhost), and the browser decides: Chrome and Edge ask once for permission, Firefox may show a small “Paste” button that has to be clicked, Safari may show a “Paste” bubble. If the browser refuses, Knorke says so and pastes nothing; Ctrl+V (⌘V on a Mac) always works and pastes at the mouse pointer.',
	]
	for (const w of want) {
		assert.ok(spec.includes(w), `SPEC-M1 §7.7 states: ${w.slice(0, 40)}…`)
		assert.ok(md.includes(w), `README states it word for word: ${w.slice(0, 40)}…`)
	}
	// R19 T4-12, since Revision 23 (R-B moved to M2): iPad and Safari not measured, R-A named;
	// since factory job 050 (store release 0.3.0) the measurement is planned for a later version;
	// since factory job 072 (SPEC-M1 R42) §7.7 quotes the whole limit and the status sentence word for word
	const ipad = '**iPad and Safari have not been measured on real hardware.**'
	assert.ok(spec.includes(ipad), 'SPEC-M1 §7.7 (R23) states the iPad limit')
	assert.ok(md.includes(`- ${ipad}`), 'README Known limits: iPad and Safari not measured')
	const limit = md.slice(md.indexOf(`- ${ipad}`)).split('\n- ')[0].replace(/\s+/g, ' ')
	for (const x of ['Android tablet', '59.7 fps', '361 ms', 'headless WebKit']) assert.ok(limit.includes(x), `iPad limit names ${x}`)
	assert.ok(limit.includes('A measurement on a real iPad is planned for a later version.'), 'iPad limit: the measurement comes with a later version')
	assert.doesNotMatch(limit, /follows with M2/, 'the iPad limit no longer promises M2')
	assert.doesNotMatch(md, /The iPad has not been measured on real hardware yet/, 'the R19 sentence is replaced')
	assert.doesNotMatch(md, /follows after stage 4 of M1, before the production release/, 'R-B is no longer before the production release')
	assert.doesNotMatch(md, /the right-click menu \(stage 4\)/, 'no longer under "Not yet"')
	const from = spec.indexOf('\n### 7.7 ')
	const to = spec.indexOf('\n## 8. ')
	assert.ok(from >= 0 && to > from, 'SPEC-M1 has §7.7 before §8')
	const s77 = spec.slice(from, to).replace(/\s+/g, ' ')
	const t = limit.slice(2).trim()
	assert.ok(s77.includes(`„${t}“`), 'SPEC-M1 §7.7 (R23, R42) quotes the whole README iPad limit word for word')
	assert.ok(md.replace(/\s+/g, ' ').includes(README_STATUS), 'README states the status sentence of 0.3.0')
	assert.ok(s77.includes(`„${README_STATUS}“`), 'SPEC-M1 §7.7 (R22, R42) quotes the README status sentence word for word')
	for (const x of ['Version 0.2.0 (milestone M1); the App Store release follows with M2.', 'The measurement on a real iPad follows with M2, before the App Store release.']) assert.ok(!s77.includes(x), `SPEC-M1 §7.7 no longer says: ${x}`)
})

test('ENTWICKLUNG names the stage-4 harness: bridge actions purge-tombstones and app-config, MAX_BOARDS_PER_RUN (48, 56 since factory job 032), flake gate, load-run and restore report names, R-B tools', () => {
	const dev = read('docs/ENTWICKLUNG.md')
	assert.match(dev, /^\| `purge-tombstones <b> <olderThanMs>` \|/m)
	assert.match(dev, /^\| `app-config <key> <value>` \|/m)
	assert.match(dev, /`MAX_BOARDS_PER_RUN` = \*\*56\*\*/)
	const world = read('dev/e2e/scenarios/world.mjs')
	assert.match(world, /^export const MAX_BOARDS_PER_RUN = 56$/m, 'the same number in the code')
	assert.match(dev, /--only E34,E35,E37,E38 --repeat 8/)
	assert.match(dev, /dev\/load\/out\/<ns>\/<szenario klein>-<variante>\[-<Kennzeichen>\]\.\{json,md\}/)
	assert.match(dev, /summary-<Kennzeichen>\.\{md,json\}/)
	assert.match(dev, /dev\/sim\/out\/<ns>\/restore-pgsql\[-<Kennzeichen>\]\.\{md,json\}/)
	for (const s of ['dev/ipad/relay.mjs', 'KD_IPAD_PROFILE=1', 'dev/ipad/moderate.mjs', 'dev/load/lib/pageload.mjs', '--page-requests']) assert.ok(dev.includes(s), s)
})

test('ENTWICKLUNG §10 describes occ knorke:compact as built: key order of Compactor.php, exit codes and messages of Compact.php, cleanup_cursor, 60 s (ask of [B], stage 4 phase 1)', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	const compactor = read('lib/Service/Compactor.php')
	const command = read('lib/Command/Compact.php')
	const limits = read('lib/Service/Limits.php')
	// the JSON line: the key order of the literal in compactBoard()
	const lit = compactor.match(/\$line = \[([^\]]+)\];/)
	assert.ok(lit, 'Compactor.php builds the line as one array literal')
	const keys = [...lit[1].matchAll(/'(\w+)' =>/g)].map((m) => m[1])
	assert.deepEqual(keys, ['board', 'blocks', 'tombstones', 'changes', 'minRevBefore', 'minRev'], 'the six keys of SPEC-M1 §4.13.7 (d)')
	assert.ok(p.includes('`{' + keys.map((k) => `"${k}":…`).join(',') + '}`'), '§10 shows the keys in the order Compactor.php writes them')
	assert.match(p, /`blocks` zählt \*\*nur\*\* die Grabstein-Blöcke/)
	assert.match(p, /`changes` die vom Deckel gelöschten Zeilen plus den 30-Tage-Schnitt dieses Boards/)
	// exit codes and the stderr message of an unknown board
	assert.match(command, /'Board ' \. \$board \. ' not found\.'\);\s*return 1;/, 'Compact.php: unknown board → exit 1')
	assert.equal((command.match(/return 2;/g) || []).length, 2, 'Compact.php: --board and --now malformed → exit 2')
	assert.match(p, /0 bearbeitet .*; 1 unbekanntes Board \(stderr `Board N not found\.`\); 2 ungültiger Wert für `--board` oder `--now`/)
	// the run without --board: instance-wide first, then the cursor ring within the budget
	assert.match(compactor, /public const CURSOR_KEY = 'cleanup_cursor';/)
	assert.match(compactor, /setValueInt\(Application::APP_ID, self::CURSOR_KEY, \$board, lazy: true\)/, 'cursor stored as a lazy int')
	assert.match(limits, /public const CLEANUP_BUDGET_MS = 60000;/)
	const run = compactor.slice(compactor.indexOf('public function run('), compactor.indexOf('public function board('))
	assert.ok(run.indexOf('pruneChanges(') < run.indexOf('$this->cursor()') && run.indexOf('pruneLinks(') < run.indexOf('$this->cursor()'), 'instance-wide pruning before the boards')
	for (const s of ['`cleanup_cursor` durch (lazy, Ganzzahl = ID des letzten vollständig bearbeiteten Boards; Ringfolge: erst die IDs darüber aufsteigend', 'hört nach 60 s auf', 'instanzweit `changes`-Zeilen und Links, die älter als 30 Tage sind',
		'`--board=N`:** nur Board N, alle Blöcke bis zum Ende, ohne Zeitbudget', 'nie für geschriebene Werte']) {
		assert.ok(p.includes(s), `§10 states: ${s}`)
	}
})

test('ENTWICKLUNG §5.4 names the stage-4 measure rows and run.sh measure --shadows on|off; the docs say note shadows are gradients, and src/scene sets no shadowBlur (ask of [S], stage 4 phase 1)', () => {
	const lab = read('dev/scene-lab/run.mjs')
	const md = read('docs/ENTWICKLUNG.md')
	const sec = md.slice(md.indexOf('### 5.4 '), md.indexOf('### 5.5 '))
	// [label in run.mjs, how §5.4 names the row]
	for (const [inLab, inDoc] of [
		["'Ein-Finger-Schwenk 100 % (CSS-Pfad, Modus view)'", '„Ein-Finger-Schwenk 100 % (CSS-Pfad, Modus view)“'],
		['`Folgen kurz (${fShort.glide.ms} ms, CSS-Pfad)`', '„Folgen kurz (… ms, CSS-Pfad)“'],
		['`Folgen lang (${fLong.glide.dx} px, ${fLong.glide.ms} ms)`', '„Folgen lang (… px, … ms)“'],
		["${totals ? 'Abzeichen mit Summen' : 'Abzeichen'} schwenken (Modus vote, ", '„Abzeichen schwenken (Modus vote, …)“'],
		["${totals ? 'Abzeichen mit Summen' : 'Abzeichen'} schwenken (Modus vote, ", '„Abzeichen mit Summen schwenken (…)“'],
	]) {
		assert.ok(lab.includes(inLab), `run.mjs has the row ${inLab}`)
		assert.ok(sec.includes(inDoc), `§5.4 names ${inDoc}`)
	}
	assert.match(lab, /--shadows on\|off/, 'run.mjs documents --shadows on|off')
	assert.match(lab, /const SHADOWS = String\(opt\('shadows', 'on'\)\)/, 'default on')
	assert.match(read('dev/scene-lab/run.sh'), /CMD=\(node run\.mjs --mode "\$MODE" "\$@"\)/, 'run.sh passes --shadows through to run.mjs')
	assert.ok(sec.includes('**`run.sh measure --shadows on|off`**') && sec.includes('dev/scene-lab/run.sh measure --shadows off'), '§5.4 names the option and its call')
	// note shadows: gradients of shade.js, no canvas shadowBlur in the scene
	assert.ok(fs.existsSync(path.join(ROOT, 'src/scene/nodes/shade.js')), 'src/scene/nodes/shade.js exists')
	for (const f of fs.readdirSync(path.join(ROOT, 'src/scene/nodes')).filter((n) => n.endsWith('.js'))) {
		const code = read(`src/scene/nodes/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
		assert.doesNotMatch(code, /shadowBlur/, `src/scene/nodes/${f} sets no shadowBlur`)
	}
	assert.ok(sec.includes('mit Verläufen (`src/scene/nodes/shade.js`) statt mit Canvas-`shadowBlur`'), '§5.4 states the gradients')
	assert.ok(read('docs/ARCHITEKTUR.md').includes('mit Verläufen (`src/scene/nodes/shade.js`'), 'ARCHITEKTUR states the gradients')
})

test('ENTWICKLUNG §5.5 (Laufbelege) quotes both check-fresh lines in the form build/check-fresh.mjs prints them, CSS covered from build 3 of stage 4 (ask of [C], R19 T4-26)', () => {
	const fresh = read('build/check-fresh.mjs')
	assert.ok(fresh.includes('`  ${checked} src/ entries in ${maps.length} maps, ${differ.length} differing, ${missing.length} missing, ${unverifiable.length} without sourcesContent`'), 'check-fresh: first line')
	assert.ok(fresh.includes('`  css: ${css.checked} src/styles entries, ${css.differ.length} differing, ${css.missing.length} missing`'), 'check-fresh: the indented CSS line')
	const md = read('docs/ENTWICKLUNG.md')
	const sec = md.slice(md.indexOf('### 5.5 '), md.indexOf('### 5.6 '))
	assert.ok(sec.includes('`  <n> src/ entries in 3 maps, <k> differing, <m> missing, <u> without sourcesContent`'), '§5.5 names the first line')
	assert.ok(sec.includes('`  css: <n> src/styles entries, <k> differing, <m> missing`'), '§5.5 names the CSS line')
	assert.match(sec, /zitiert werden \*\*beide\*\* Zeilen/)
	assert.match(sec, /erst ab dem Build 3 der Stufe 4/)
	const rel = md.slice(md.indexOf('### 5.8 '), md.indexOf('## 6. '))
	assert.ok(rel.includes('`  css: <n> src/styles entries, 0 differing, 0 missing`') && rel.includes('`js/knorke-style.fresh.json`'), '§5.8: the CSS line and the left-out companion')
})

test('R20 known fixes in the docs: PROTOKOLL compact exit 2/blocks/without --board (K4), ENTWICKLUNG §5.4 -noshadow as names.js builds it (K9), ARCHITEKTUR §5 grouping and locking in M2 (K11), the K1 oracle rule', async () => {
	// K4 (BD-04): PROTOKOLL §14 against Compact.php and Compactor.php
	const p = section('docs/PROTOKOLL.md', '## 14. Prod-Reife')
	const command = read('lib/Command/Compact.php')
	assert.equal((command.match(/return 2;/g) || []).length, 2, 'Compact.php: --board and --now malformed → exit 2')
	for (const s of ['Exit 1 unbekanntes Board (stderr `Board N not found.`)', 'Exit 2 ungültiger Wert für `--board` oder `--now`', '`blocks` zählt nur die Grabstein-Blöcke',
		'Ohne `--board` läuft `compact` wie der Job: zuerst instanzweit `changes` und Links, die älter als 30 Tage sind, dann die Boards nach `cleanup_cursor`']) {
		assert.ok(p.includes(s), `PROTOKOLL §14 states: ${s}`)
	}
	assert.doesNotMatch(p, /\(Exit 0; unbekanntes Board Exit 1\)/, 'the old short form is gone')
	// K9 (RSC-04 after K8): §5.4 of ENTWICKLUNG
	const md = read('docs/ENTWICKLUNG.md')
	const lab = md.slice(md.indexOf('### 5.4 '), md.indexOf('### 5.5 '))
	assert.doesNotMatch(lab, /Stand Stufe 2/, 'the measure scenarios are no longer "Stand Stufe 2"')
	assert.ok(lab.includes('**Szenarien von `measure`** (Stand Stufe 4'))
	const { reportFiles } = await import('../scene-lab/names.js')
	const off = reportFiles({ mode: 'measure', gpu: false, browser: 'webkit', shadows: 'off' })
	assert.equal(off.json, 'measure-webkit-cpu-noshadow.json', 'names.js: -noshadow after the set (K8)')
	assert.equal(reportFiles({ mode: 'measure', gpu: true, set: 'noconn', shadows: 'off', label: 'p2' }).md, 'report-chromium-gpu-noconn-noshadow-p2.md')
	assert.ok(lab.includes(`z. B. \`${off.json}\``), `§5.4 shows the example ${off.json} that names.js builds`)
	for (const s of ['Stamm `<browser>-<variant>[-<set>][-noshadow][-<Kennzeichen>]`', '`measure-<chromium|webkit>-<variant>[-<set>][-noshadow].json`',
		'dev/scene-lab/run.sh measure --shadows off  # Notiz-Schatten aus (A/B der Schattenkosten, Stufe 4) → out/measure-<…>-noshadow[-<Kennzeichen>].json']) {
		assert.ok(lab.includes(s), `§5.4 states: ${s}`)
	}
	// K11 (A2, A3): ARCHITEKTUR §5
	const arch = section('docs/ARCHITEKTUR.md', '## 5. Was später kommt')
	const m2 = arch.slice(arch.indexOf('- **M2**'), arch.indexOf('- **Später:**'))
	const later = arch.slice(arch.indexOf('- **Später:**'))
	assert.ok(m2.includes('**Gruppieren**') && m2.includes('**Eine Gruppe sperren** = `locked` an allen Mitgliedern in einer Mehrfach-Op'), 'grouping with group locking under M2')
	assert.doesNotMatch(later, /Gruppieren/, 'grouping no longer under "Später"')
	assert.ok(m2.includes('Sperren dürfen alle Rollen, die bearbeiten dürfen') && m2.includes('nur sie entsperrt') && m2.includes('Eigentümer und „Darf moderieren“ heben jede Sperre auf'), 'locking after A3')
	assert.doesNotMatch(m2, /nur Moderatoren sperren und entsperren/, 'the R2 rule is gone')
	// K1: ENTWICKLUNG §5.1 states the rule the oracle implements
	const sim = md.slice(md.indexOf('### 5.1 '), md.indexOf('### 5.2 '))
	assert.ok(sim.includes('`purgedBefore` und `folgenCode` in `lib/oracle.mjs`') && sim.includes('Ein Code, der „Folgen“ widerspricht'), '§5.1 states the K1 rule')
	assert.match(read('dev/sim/lib/oracle.mjs'), /^export function folgenCode\(op, isPurged, typeOf = \(\) => undefined\) \{$/m)
})

// ── review round P7-C (SPEC-M1 §33.1 n, k) ────────────────────────────────

/** The row of the checklist table that starts with `| <id> |`. */
const row = (p, id) => (p.split('\n').find((l) => l.startsWith(`| ${id} |`)) || '')

test('ENTWICKLUNG §10 has the rows P12 (client IP), P13 (AppSec) and P14 (legal links), all done by the user, with the probes from the phone over mobile data', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	for (const id of ['P12', 'P13', 'P14']) {
		assert.match(row(p, id), /\| Nutzer \|$/, `${id}: Wer = Nutzer`)
	}
	// P12: the steps and commands of the edge check
	for (const x of ['**P12 – Proxy-Kette und Client-IP**', 'security:bruteforce:attempts <HANDY-IP> knorke_link', 'security:bruteforce:reset <HANDY-IP>',
		"-H 'X-Forwarded-For: 203.0.113.9'", '<TOKEN1>', '<TOKEN2>', '**WLAN aus**', '**nie aus dem Heimnetz**', 'Fehlerbild → P9 stoppen']) {
		assert.ok(p.includes(x), `P12 names ${x}`)
	}
	// P13
	for (const x of ['**P13 – AppSec gegen die Knorke-Routen**', 'cscli metrics show appsec', 'cscli alerts list --since 30m', 'SELECT * FROM users WHERE 1=1',
		'${jndi:ldap://example.invalid/a}', 'class.module.classLoader.resources.', '**keine 403**', 'cscli decisions delete -i <HANDY-IP>']) {
		assert.ok(p.includes(x), `P13 names ${x}`)
	}
	// P14
	assert.ok(p.includes('config:app:set theming imprintUrl') && p.includes('privacyUrl'), 'P14: imprintUrl and privacyUrl')
	assert.match(row(p, 'P14'), /vor dem ersten Internet-Gast/)
	// facts: P9 is not blocked, the phone probe is still open
	assert.match(p, /\*\*die Probe vom Handy fehlt noch\*\*/)
	// login brake (U-LOGIN): runbook note only
	assert.match(p, /Login-Bremse am Edge/)
	assert.match(p, /Es gibt keine Edge-Änderung dafür/)
	// no internal address of the edge check in the repo (the forgery probe uses the RFC 5737 address)
	for (const f of ['docs/ENTWICKLUNG.md', 'README.md', 'CHANGELOG.md', 'docs/PROTOKOLL.md', 'docs/ARCHITEKTUR.md']) {
		const md = read(f).replace(/203\.0\.113\.\d+/g, '')
		assert.doesNotMatch(md, /\b(?:100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|172\.31)\.\d+/, `${f}: no address from the edge check`)
	}
})

test('ENTWICKLUNG §10 states the V3 rule, the cscli emergency fix and the edge ban scenario; V1 is live for /sync only and V3 stays (Rev. 23, R39)', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	for (const x of ['http-generic-403-bf', 'http-generic-401-bf', 'cscli decisions list -i <IP>', 'cscli decisions delete -i <IP>',
		'ssh edge \'docker exec crowdsec cscli decisions list -i <IP>\'', 'ssh edge \'docker exec crowdsec cscli decisions delete -i <IP>\'',
		'docker exec crowdsec cscli decisions delete -i <IP>', '**Regel (V3):**', '**mindestens 6 Gäste im selben Netz**', 'nach ≤ 60 s', '4 h', '6 `POST`-Antworten 403 bzw. 401',
		'verhindert den Bann aber nicht', '`X-Knorke-End-State: 1`', '403 `password_required`', 'Tabs mit altem Bündel', 'höchstens zwei je Tab']) {
		assert.ok(p.includes(x), `§10 states: ${x}`)
	}
	// R39 (factory job 028): revoking, renewing and expiry answer 200 now; only a new password still gets the re-join a 403
	assert.ok(!p.includes('Erneuern des Links oder ein neues Passwort wirken genauso'), '§10 no longer says renewing or a new password act like revoking')
	// factory job 084: tabs get the remaining 401/403, they do not send them
	assert.ok(!p.includes('Weiter 401 oder 403 senden'), '§10 no longer says tabs send 401 or 403')
	// Revision 23 (SPEC-M1 §34 D5, D8) and R39 (§50): V1 is live for /sync; the re-join POST …/join still answers one 403
	// password_required after a new password, so V3 stays; support finds the end states as 200 in the access log
	const stand = p.split('\n').find((l) => l.startsWith('- **Stand')) || ''
	assert.match(stand, /^- \*\*Stand \(Rev\. 23 und R39, SPEC-M1 §34 und §50\):\*\* Die Edge-Ausnahme für die 401\/403 der Sync-Routen \(V1\) ist seit 15\.10\.2026 ~06:40 am Edge des eigenen Setups live/, 'Stand: V1 is live')
	for (const x of ['local/knorke-whitelist', 'Die Regel V3 bleibt trotzdem:', '`POST …/pub/v1/<token>/join`', 'hergeleitet, nicht gemessen', '`/join` bleibt bewusst ohne Ausnahme',
		'im Zugriffsprotokoll', '`{"end": …}`', 'das Teilen per Link abgeschaltet hat', 'nach einem neuen Passwort gilt das nur für den Sync']) {
		assert.ok(stand.includes(x), `Stand names ${x}`)
	}
	assert.doesNotMatch(p, /\*\*nicht\*\* eingespielt/, 'the P7-C sentence "V1 not applied" is gone')
	assert.doesNotMatch(p, /bis V1 live ist|solange die Edge-Ausnahme V1 nicht eingespielt ist/, 'V3 is not limited to "until V1 is live"')
	assert.match(p, /Der Burst \(V2\) folgt der Messung in P13 Schritt 5/)
})

test('ENTWICKLUNG §10 (P7-D): placeholder <Edge-Peer-IP> of SPEC-M1 §33.1 n, neutral wording in the ban paragraph, E7 line as in SPEC-M1 §10 E7 (R23)', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	// VC-06: the edge check's NetBird address appears only as <Edge-Peer-IP> (P12 steps 4, 5 and the error pattern)
	assert.ok(!p.includes('<Edge-NetBird-IP>'), 'no <Edge-NetBird-IP> left')
	assert.ok(p.split('<Edge-Peer-IP>').length - 1 >= 4, '<Edge-Peer-IP> in P12 steps 4 (twice), 5 and the error pattern')
	const ban = p.split('\n').find((l) => l.startsWith('**Bann-Risiko durch Link-Änderungen')) || ''
	assert.ok(ban.includes('Widerrufen Moderierende einen Link während einer Sitzung'), 'ban paragraph: "Widerrufen Moderierende …"')
	assert.ok(ban.includes('der Bann trifft Moderierende und jeden anderen Nextcloud-Nutzer'), 'ban paragraph: "… trifft Moderierende …"')
	assert.doesNotMatch(ban, /\b(der|den|dem|des) Moderators?\b/, 'ban paragraph: no gendered noun')
	// E7 like SPEC-M1 §10 E7 (R23, user decisions of 15.10.2026): P4 in M2, P10 before P9 only as the one-time dump,
	// P12/P13 in P9 step 8, P14 before the first guest from the internet (no longer before P9)
	const e7 = p.slice(p.indexOf('E7 Freigabe-Zeitpunkt ('), p.indexOf('\n', p.indexOf('E7 Freigabe-Zeitpunkt (')))
	assert.ok(e7.startsWith('E7 Freigabe-Zeitpunkt (vor P9: P1–P3, P5–P8 und P11; P4 in M2;'), 'E7 line')
	for (const x of ['P10 vor P9 nur als einmaliger Dump in P9 Schritt 4', 'P12 und P13 in P9 Schritt 8', 'P14 vor dem ersten Internet-Gast']) assert.ok(e7.includes(x), `E7 names: ${x}`)
	const specE7 = read('docs/SPEC-M1.md').split('\n').find((l) => l.startsWith('| E7 | Freigabe-Zeitpunkt |')) || ''
	for (const x of ['**(R23)**', 'P4 in M2', 'P12 und P13 bei P9 Schritt 8', 'P14 vor dem ersten Gast aus dem Internet, nicht vor P9']) assert.ok(specE7.includes(x), `SPEC-M1 §10 E7 names: ${x}`)
	assert.ok(!p.includes('E7 Freigabe-Zeitpunkt (nach P1–P11, P14 und P7; P12 und P13 in P9 Schritt 8)'), 'the R22 E7 line (P4 and P14 before P9) is gone')
	assert.ok(!p.includes('E7 Freigabe-Zeitpunkt (nach P1–P11 und P7)'), 'the 4.4 E7 line is gone')
})

test('ENTWICKLUNG §10 names occ knorke:orphans with its five output lines, the byte keys, link_limit and public_url, and the PostgreSQL note', () => {
	const md = read('docs/ENTWICKLUNG.md')
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	for (const x of ['occ knorke:orphans --dry-run', 'occ knorke:orphans', 'Dry run: nothing was changed.']) assert.ok(p.includes(x), `§10 names ${x}`)
	const out = ['user-shares', 'group-shares', 'link-members', 'open-votes', 'owned-boards']
	assert.ok(p.includes(out.map((k) => `${k}: <n>`).join('\n')), 'the five lines in this order')
	for (const k of ['budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap', 'link_limit', 'public_url']) assert.ok(md.includes(k), `ENTWICKLUNG names ${k}`)
	assert.ok(md.includes('config:app:set knorke public_url --value='), 'the public_url command')
	const step5 = p.split('\n').find((l) => l.startsWith('5. Link-Adresse für Gäste')) || ''
	assert.ok(step5.includes('config:app:set knorke public_url --value=https://<öffentlicher Name>'), 'P9 step 5: public_url (U-LINKHOST)')
	// defaults as lib/Service/Limits.php names them (once [B] has landed)
	const limits = read('lib/Service/Limits.php')
	const consts = [...limits.matchAll(/const (KEY_\w+|DEFAULT_\w+) = ([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/'/g, '')])
	const want = { budget_bytes_board_day: '268435456', budget_bytes_user_day: '536870912', changes_bytes_cap: '67108864' }
	for (const [k, v] of Object.entries(want)) {
		assert.ok(consts.some(([, val]) => val === k), `Limits.php has the key ${k}`)
		assert.ok(consts.some(([n, val]) => n.startsWith('DEFAULT_') && val === v), `Limits.php has the default ${v} of ${k}`)
		assert.ok(p.includes(v), `§10 names the default ${v} of ${k}`)
	}
	assert.ok(consts.some(([n, val]) => n === 'DEFAULT_LINK_LIMIT' && val === '20'), 'link_limit default 20') && assert.ok(p.includes('| 20 |'), '§10 names the link_limit default 20')
	assert.match(p, /Autovacuum/)
	assert.match(p, /`VACUUM FULL` gibt Platz zurück, sperrt die Tabelle aber exklusiv und gehört nur in den Wartungsmodus/)
	assert.match(p, /\*\*Solange Knorke deaktiviert ist, werden keine Konten oder Gruppen gelöscht\*\*/)
	// the command exists in the code with these keys
	const cmd = read('lib/Command/Orphans.php')
	assert.match(cmd, /knorke:orphans/)
	assert.match(cmd, /dry-run/)
	assert.ok(read('appinfo/info.xml').includes('OCA\\Knorke\\Command\\Orphans'), 'info.xml registers the command')
})

test('ENTWICKLUNG §10 P9: archive order sha256sum -c, tar -xzf, rsync from "$tmp"/knorke/, chained with && (VC-07: the block works when pasted; factory job 123); wait before restart on 404; restore block with the container prefix; failure sentences (factory job 127)', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	const a = p.indexOf('sha256sum -c'), b = p.indexOf('tar -xzf'), c = p.indexOf('rsync')
	assert.ok(a > 0 && a < b && b < c, 'sha256sum -c before tar -xzf before rsync')
	const rs = p.split('\n').find((l) => l.trim().startsWith('rsync')) || ''
	const src = rs.trim().split(/\s+/).filter((x) => !x.startsWith('-')).slice(1)[0] || ''
	assert.ok(src.endsWith('/knorke/'), `the rsync source ends in /knorke/ (${src})`)
	// P7-D, VC-07: the source is the variable of the block, never the literal placeholder <tmp>
	assert.equal(src, '"$tmp"/knorke/', `the rsync source is "$tmp"/knorke/ (${src})`)
	const s3 = p.slice(p.indexOf('3. Aus dem **geprüften Archiv**'), p.indexOf('\n4. ', p.indexOf('3. Aus dem **geprüften Archiv**')))
	assert.ok(s3.includes('tmp="$(mktemp -d)"') && s3.includes('rm -rf "${tmp:?}"'), 'step 3 sets and removes $tmp')
	assert.ok(!s3.includes('<tmp>'), 'step 3 has no literal <tmp> left')
	// factory job 123: tar, rsync and chown hang together with &&; the rm stands alone, so it runs after a failed step too
	// factory job 129: --checksum like the hotfix; the archive gives every file one fixed mtime, so rsync's quick check would skip a changed file of the same size
	assert.deepEqual(fencedBlocks(s3)[0], [
		'tmp="$(mktemp -d)" && tar -xzf dev/release/out/knorke-<version>.tar.gz -C "$tmp" &&',
		'rsync -a --delete --checksum "$tmp"/knorke/ <prod>/nextcloud_html/custom_apps/knorke/ &&',
		'chown -R 33:33 <prod>/nextcloud_html/custom_apps/knorke',
		'rm -rf "${tmp:?}"',
	], 'P9 step 3: the chained copy block')
	const h4 = p.slice(p.indexOf('4. Entpacken, Eigentümer setzen, **Probelauf**'), p.indexOf('\n5. Cachebuster +1'))
	const [dry, list, real] = fencedBlocks(h4)
	assert.deepEqual(dry, [
		'tmp="$(mktemp -d)" && tar -xzf dev/release/out/knorke-<version>.tar.gz -C "$tmp" &&',
		'chown -R 33:33 "$tmp"/knorke &&',
		'rsync -a --delete --checksum --itemize-changes --dry-run "$tmp"/knorke/ <prod>/nextcloud_html/custom_apps/knorke/',
	], 'hotfix step 4: the chained dry run')
	assert.ok(list && list.length > 0 && list.every((l) => l.startsWith('>f')), 'hotfix step 4: the second block is the expected list of the dry run')
	assert.deepEqual(real, [
		'rsync -a --delete --checksum --itemize-changes "$tmp"/knorke/ <prod>/nextcloud_html/custom_apps/knorke/ &&',
		'chown -R 33:33 <prod>/nextcloud_html/custom_apps/knorke',
		'rm -rf "${tmp:?}"',
	], 'hotfix step 4: the chained real run')
	// factory job 127: the sentences that say what a failed step means stay word for word
	assert.ok(s3.includes('Die ersten drei Zeilen hängen mit `&&` aneinander: Scheitert ein Befehl, läuft keiner danach mehr, nur das `rm` in der letzten Zeile läuft immer und räumt `$tmp` auf.'), 'P9 step 3: what the chain means after a failed step')
	assert.ok(s3.split('\n').some((l) => l.trim() === '**Stopp-Regel:** Ohne Fehler gibt der Block nichts aus. Zeigt er eine Fehlermeldung, hier anhalten (nicht weiter mit Schritt 4) und den Orchestrator fragen.'), 'P9 step 3: the stop rule is a line of its own after the block')
	assert.ok(h4.includes('Der Block des Probelaufs läuft als Ganzes in einer Shell, der echte Lauf danach in derselben (er braucht dasselbe `$tmp`); die drei Zeilen des Probelaufs hängen mit `&&` aneinander, scheitert eine, läuft keine danach mehr:'), 'hotfix step 4: the intro says the chain is the dry-run block')
	assert.ok(h4.includes('Zeigt der Block eine Fehlermeldung, allein oder neben Listenzeilen (etwa von `tar`, `chown`, `rsync` oder der Shell), gilt der Probelauf nicht: ebenso nicht weiter, `rm -rf "${tmp:?}"` und den Orchestrator fragen.'), 'hotfix step 4: any error message in the dry run stops')
	assert.ok(h4.includes('`rsync` und `chown` hängen mit `&&` aneinander, das `rm` läuft immer; scheitert `rsync`, läuft das `chown` nicht mehr. Zeigt der Block eine Fehlermeldung, ob von `rsync` oder vom `chown` auf den Prod-Ordner, dann nicht weiter mit Schritt 5, sondern den Orchestrator fragen (Rückweg: Schritt 8).'), 'hotfix step 4: a failed rsync or chown in the real run stops')
	assert.match(p, /zuerst ≈ 5 s warten/)
	assert.match(p, /danach den Webserver-Container neu starten/)
	// restore block: the fenced block after "Nach einem DB-Restore auf Prod"
	const i = p.indexOf('**Nach einem DB-Restore auf Prod**')
	const open = p.indexOf('```\n', i), close = p.indexOf('\n```', open + 4)
	assert.ok(i > 0 && open > i && close > open, 'the restore block exists')
	const block = p.slice(open + 4, close).split('\n')
	const occLines = block.filter((l) => / occ /.test(l) && !l.startsWith('#'))
	assert.ok(occLines.length >= 3, 'maintenance on, epoch, maintenance off')
	for (const l of occLines) assert.ok(l.startsWith('docker exec -u www-data nextcloud-nextcloud-1 php occ'), `prefix: ${l}`)
	assert.ok(block.some((l) => l.startsWith('docker exec -i nextcloud-nextcloud-db-1 pg_restore --clean --if-exists --single-transaction')), 'pg_restore template')
	assert.ok(block.findIndex((l) => l.includes('maintenance:mode --on')) < block.findIndex((l) => l.includes('pg_restore')) && block.findIndex((l) => l.includes('pg_restore')) < block.findIndex((l) => l.includes('knorke epoch')), 'order: on, restore, epoch')
})

// factory job 123: run the copy blocks of P9 step 3 and hotfix step 4 in bash. rsync and chown are
// stubs that log their arguments (KD_RSYNC_RC / KD_CHOWN_RC set their exit code; a dry run always
// succeeds); mktemp, tar and rm are real, and everything happens in a throwaway folder. This runs
// text written for prod (security review, round 1): bash runs with a PATH of only mktemp, tar, gzip
// and rm, and a block line that names docker, nextcloud-nextcloud, occ or sudo fails the test
// before anything runs. Every message of F2–F7 carries bash's stderr (factory job 127), so a
// command the minimal PATH does not find shows at once.
test('ENTWICKLUNG §10 P9 step 3 and hotfix step 4 run in bash: after a failed tar, rsync or chown nothing is copied or chowned, the rm still removes $tmp (factory job 123)', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	const part = (from, to) => {
		const i = p.indexOf(from), j = p.indexOf(to, i)
		assert.ok(i >= 0 && j > i, `${from} … ${to}`)
		return p.slice(i, j)
	}
	const [p9] = fencedBlocks(part('3. Aus dem **geprüften Archiv**', '\n4. '))
	const [dry, , real] = fencedBlocks(part('4. Entpacken, Eigentümer setzen, **Probelauf**', '\n5. '))
	assert.ok(p9 && dry && real, 'the three copy blocks exist')
	assert.ok(![...p9, ...dry, ...real].some((l) => /\bdocker\b|nextcloud-nextcloud|\bocc\b|\bsudo\b/.test(l)), 'the copy blocks never name docker, nextcloud-nextcloud, occ or sudo, so this test can run them')
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdchain-')))
	try {
		// the only programs bash finds; any other command of a block (docker, occ, curl, the real rsync …) is not found
		const bin = path.join(root, 'bin')
		fs.mkdirSync(bin)
		for (const name of ['mktemp', 'tar', 'gzip', 'rm']) {
			const where = spawnSync('bash', ['-c', 'command -v "$1"', 'bash', name], { encoding: 'utf8' }).stdout.trim()
			assert.ok(where.startsWith('/'), `${name} is a program on this host (${where})`)
			fs.symlinkSync(where, path.join(bin, name))
		}
		const probe = spawnSync('bash', ['-c', 'PATH="$KD_BIN"; for c in docker rsync chown sudo curl; do command -v "$c"; done; true'], { encoding: 'utf8', env: { ...process.env, KD_BIN: bin } })
		assert.equal(probe.stdout, '', 'with PATH="$KD_BIN" bash finds no docker, rsync, chown, sudo or curl')
		const prod = path.join(root, 'prod')
		const app = `${prod}/nextcloud_html/custom_apps/knorke`
		// the release 9.9.9 exists (top folder knorke/ as dev/release.sh packs it), 0.0.0 does not
		fs.mkdirSync(path.join(root, 'dev', 'release', 'out'), { recursive: true })
		fs.mkdirSync(path.join(root, 'pkg', 'knorke', 'js'), { recursive: true })
		fs.writeFileSync(path.join(root, 'pkg', 'knorke', 'js', 'knorke-main.mjs'), '// probe\n')
		assert.equal(spawnSync('tar', ['-czf', 'dev/release/out/knorke-9.9.9.tar.gz', '-C', 'pkg', 'knorke'], { cwd: root }).status, 0, 'probe archive')
		const stubs = 'PATH="$KD_BIN"\n'
			+ 'rsync() { echo "rsync $*" >> "$KD_LOG"; case " $* " in *" --dry-run "*) return 0 ;; esac; return "$KD_RSYNC_RC"; }\n'
			+ 'chown() { echo "chown $*" >> "$KD_LOG"; return "$KD_CHOWN_RC"; }\n'
		let n = 0
		const run = (blocks, version, { rsync = 0, chown = 0 } = {}) => {
			const log = path.join(root, `log-${++n}`)
			fs.writeFileSync(log, '')
			// placeholders by split/join, never replace() with a replacement string (trap 9.22)
			const body = blocks.flat().join('\n').split('<prod>').join(prod).split('<version>').join(version)
			const r = spawnSync('bash', ['-c', stubs + body + '\nprintf "tmp=%s\\n" "$tmp"\n'], {
				cwd: root, encoding: 'utf8', timeout: 20000,
				env: { ...process.env, TMPDIR: root, KD_BIN: bin, KD_LOG: log, KD_RSYNC_RC: String(rsync), KD_CHOWN_RC: String(chown) },
			})
			const tmp = (/^tmp=(.*)$/m.exec(r.stdout) || [])[1] || ''
			assert.equal(path.dirname(tmp), root, `mktemp -d made $tmp in the throwaway folder (${tmp}; ${r.stderr})`)
			return { calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean), tmp, gone: !fs.existsSync(tmp), stderr: r.stderr }
		}
		const dryRsync = (t) => `rsync -a --delete --checksum --itemize-changes --dry-run ${t}/knorke/ ${app}/`
		const realRsync = (t) => `rsync -a --delete --checksum --itemize-changes ${t}/knorke/ ${app}/`
		// factory job 127: bash's stderr in every message of F2–F7, e.g. "command not found" under the minimal PATH
		const why = (r) => ` (stderr: ${r.stderr.trim() || 'none'})`
		// F1: P9 with a missing archive: tar fails, so neither rsync nor chown runs; the rm still runs
		let r = run([p9], '0.0.0')
		assert.deepEqual(r.calls, [], 'F1: after a failed tar no rsync and no chown')
		assert.ok(r.gone, 'F1: the rm removes $tmp')
		assert.ok(r.stderr.includes('knorke-0.0.0.tar.gz'), `F1: the error names the missing archive (${r.stderr})`)
		// F2: P9 without an error (counter-check: the stubs are really called)
		r = run([p9], '9.9.9')
		assert.deepEqual(r.calls, [`rsync -a --delete --checksum ${r.tmp}/knorke/ ${app}/`, `chown -R 33:33 ${app}`], 'F2: rsync, then chown' + why(r))
		assert.ok(r.gone, 'F2: the rm removes $tmp' + why(r))
		// F3: P9 with a failed rsync: no chown; the rm still runs
		r = run([p9], '9.9.9', { rsync: 23 })
		assert.deepEqual(r.calls, [`rsync -a --delete --checksum ${r.tmp}/knorke/ ${app}/`], 'F3: after a failed rsync no chown' + why(r))
		assert.ok(r.gone, 'F3: the rm removes $tmp' + why(r))
		// F4: hotfix dry run with a missing archive: nothing runs; $tmp stays (the stop rule says rm -rf "${tmp:?}" by hand)
		r = run([dry], '0.0.0')
		assert.deepEqual(r.calls, [], 'F4: after a failed tar no chown and no dry run' + why(r))
		assert.ok(!r.gone, 'F4: the dry-run block has no rm, $tmp stays' + why(r))
		// F5: hotfix dry run with a failed chown: no dry run
		r = run([dry], '9.9.9', { chown: 1 })
		assert.deepEqual(r.calls, [`chown -R 33:33 ${r.tmp}/knorke`], 'F5: after a failed chown no dry run' + why(r))
		assert.ok(!r.gone, 'F5: $tmp stays' + why(r))
		// F6: hotfix dry run and real run without an error (counter-check)
		r = run([dry, real], '9.9.9')
		assert.deepEqual(r.calls, [`chown -R 33:33 ${r.tmp}/knorke`, dryRsync(r.tmp), realRsync(r.tmp), `chown -R 33:33 ${app}`], 'F6: chown $tmp, dry run, real run, chown' + why(r))
		assert.ok(r.gone, 'F6: the rm removes $tmp' + why(r))
		// F7: hotfix real run with a failed rsync: no chown of the app folder; the rm still runs
		r = run([dry, real], '9.9.9', { rsync: 23 })
		assert.deepEqual(r.calls, [`chown -R 33:33 ${r.tmp}/knorke`, dryRsync(r.tmp), realRsync(r.tmp)], 'F7: after a failed real rsync no chown' + why(r))
		assert.ok(r.gone, 'F7: the rm removes $tmp' + why(r))
	} finally {
		if (root.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'kdchain-'))) fs.rmSync(root, { recursive: true, force: true })
	}
})

test('CHANGELOG has the section ## [0.2.0] – <date> (en dash) and the ## [Unreleased] head above it; README has the 0.3.0 status and no M0 sentences', () => {
	const cl = read('CHANGELOG.md')
	assert.match(cl, /^## \[0\.2\.0\] – \d{4}-\d{2}-\d{2}$/m)
	assert.match(cl, /^## \[Unreleased\]$/m, 'CHANGELOG has the ## [Unreleased] head')
	assert.ok(cl.indexOf('## [Unreleased]') < cl.indexOf('## [0.2.0]'), 'Unreleased stays above')
	const sec = cl.slice(cl.indexOf('## [0.2.0]'))
	for (const x of ['review round P7', 'occ knorke:orphans', 'public_url', 'budget_bytes_board_day', 'link_limit', 'stage 4', 'stage 0']) assert.ok(sec.includes(x), `0.2.0 mentions ${x}`)
	const md = read('README.md')
	assert.doesNotMatch(md, /M0 is not meant for production/)
	assert.doesNotMatch(md, /Development only \(M0/)
	assert.doesNotMatch(md, /^## Features \(M0\)/m)
	// the status of P7-06, since factory job 050 that of the store release 0.3.0
	const flat = md.replace(/\s+/g, ' ')
	assert.ok(flat.includes(README_STATUS), 'the status sentence of 0.3.0')
	assert.ok(flat.includes('Since version 0.3.0, Knorke is in the Nextcloud App Store: an administrator installs it on the Apps page of Nextcloud (search for "Knorke").'), 'the installation sentence of 0.3.0')
	for (const x of ['Version 0.2.0 (milestone M1)', 'Installed as a custom app', 'the App Store release follows with M2', 'Custom app, no App Store release yet']) assert.ok(!flat.includes(x), `README no longer says: ${x}`)
	assert.ok(md.includes('## Features (M1)'))
	// the ranges: the highest numbers of the code, 83 and 38 after P7-C, 39 since hotfix H1 (SPEC-M1 §35, R24), 40 since factory job 018 (E40, Esc), 85 and 41 since factory job 023 (C84, C85, E41, lock items), 86 and 42 since factory job 026 (C86, E42, group items), 87 since factory job 028 (C87, end states with 200), 45 since factory job 049 (E45, final status on opening); the generic range test above compares them with the code
	assert.ok(md.includes('C01–C87') && md.includes('E01–E45'), 'README names C01–C87 and E01–E45')
	const lastC = Math.max(...[...read('dev/sim/contract.mjs').matchAll(/\bC\(\s*'C(\d+)'/g)].map((m) => Number(m[1])))
	assert.ok(lastC >= 83, `contract.mjs has C83 (last: C${lastC})`)
})

test('README and CHANGELOG: what 0.3.0 leaves for later versions (factory job 050)', () => {
	const md = read('README.md').replace(/\s+/g, ' ')
	assert.ok(md.includes('Live totals for facilitators may come in a later version as an option announced per session.'), 'live totals: a later version')
	assert.ok(md.includes('"Only accounts may vote" is planned for a later version.'), '"Only accounts may vote": a later version')
	assert.doesNotMatch(md, /may come in M2/, 'no "may come in M2"')
	assert.doesNotMatch(md, /is planned for M2/, 'no "is planned for M2"')
	const cl = read('CHANGELOG.md')
	const from = cl.indexOf('## [Unreleased]')
	const to = cl.indexOf('## [0.2.0]')
	assert.ok(from >= 0 && to > from, 'CHANGELOG has [Unreleased] above [0.2.0]')
	assert.ok(cl.slice(from, to).replace(/\s+/g, ' ').includes('no longer names a version or milestone'), 'CHANGELOG [Unreleased] notes the app description without version')
})

test('README and ENTWICKLUNG name the flake gate of stage 4 and P7; README Known limits carry the seven frozen sentences (SPEC-M1 §33.1 n), the edge-ban limit as in §7.7 (R39)', () => {
	for (const f of ['README.md', 'docs/ENTWICKLUNG.md']) assert.ok(read(f).includes('--only E34,E35,E37,E38 --repeat 8'), `${f} names the flake gate`)
	const md = read('README.md')
	const limits = md.slice(md.indexOf('## Known limits'))
	const lead = [
		"**Guest limits count per network address.**",
		"**A web application firewall can block board content.**",
		"**Revoking or expiring a link during a session can get a shared network banned.**",
		"**Daily byte quotas.**",
		"**Deleting accounts or groups while Knorke is disabled.**",
		"**Votes from two tabs.**",
		"**Revoked rights do not remove votes.**",
	]
	for (const x of lead) assert.ok(limits.includes(`- ${x} `), `Known limits: ${x}`)
	// word for word: the sentences, after the lead-in, as frozen
	const body = {
		'**Guest limits count per network address.**': "Knorke's limits for guests (new guest identities per link, board loads and joins, wrong link passwords, unknown link addresses) count per IP address as Nextcloud sees it.",
		// R39 (SPEC-M1 §7.7, factory job 028): the end states answer 200 with X-Knorke-End-State: 1; the 401/403 that remain
		// (a new password on the join, older tabs, a proxy that drops the header, Nextcloud's 401) keep the rule
		'**Revoking or expiring a link during a session can get a shared network banned.**': 'Reverse proxies with fail2ban-like rules ban an address after a few 401 or 403 answers (for example CrowdSec\'s http-generic-403-bf and -401-bf scenarios), and such a ban can hit the whole network of a room for hours. When a link is revoked, renewed or given a password, or expires, while guests are on the board, every open guest tab learns it on its next sync and then joins again once by itself (`POST …/join`). The board sends the request header `X-Knorke-End-State: 1` with every sync and with this join, and the server then answers the end states `guest_token`, `not_logged_in`, `link_revoked`, `link_expired` and `links_disabled` (link sharing turned off by the administrator) with 200 and `{"end": …, "message": …}` instead of 401 or 403. Some answers are still 401 or 403: when a password is set or changed, the join of every open guest tab gets one 403 (`password_required`), so that guessing a password keeps counting; tabs that were opened before Knorke was updated to a version that sends the header get the old answers until they are reloaded, and so do requests through a proxy that drops the header; and when the session of a signed-in account ends, Nextcloud itself answers 401, at most twice per tab. The rule therefore stays: while a session with many guests on one network is running, do not revoke or renew a link, do not set a password on it and do not let it expire. If an address is banned anyway, remove the decision (with CrowdSec: `cscli decisions list -i <IP>`, then `cscli decisions delete -i <IP>`).',
		'**Daily byte quotas.**': 'A board accepts at most 256 MiB of sync requests with changes per day (UTC) and an account at most 512 MiB over all its boards; guests count towards the board only (app config `budget_bytes_board_day`, `budget_bytes_user_day`; 0 switches a quota off).',
		'**Deleting accounts or groups while Knorke is disabled.**': 'Run `occ knorke:orphans --dry-run` and then `occ knorke:orphans` after every `occ app:enable knorke` and after Nextcloud major upgrades',
		'**Revoked rights do not remove votes.**': 'Votes cast before a share or link is removed keep counting in the running vote.',
	}
	for (const [k, v] of Object.entries(body)) assert.ok(limits.split('\n').find((l) => l.startsWith(`- ${k}`))?.includes(v), `${k} keeps its frozen wording`)
	assert.ok(!limits.includes("or exempt Knorke's sync routes from such rules"), 'the R22 ending (an exemption as an alternative to the rule) is gone')
	assert.ok(!limits.includes('that answer is a 403 as well'), 'the R23 sentence (the re-join always answers 403) is gone')
	const banLine = limits.split('\n').find((l) => l.startsWith('- **Revoking or expiring a link during a session can get a shared network banned.** ')) || ''
	assert.ok(read('docs/SPEC-M1.md').includes(`„${banLine.slice(2)}“`), 'SPEC-M1 §7.7 (R39) states the whole README point word for word')
	// the administrators' example (SPEC-M1 §7.7 R23, D5; R39): the sync routes only, /join left out on purpose; which
	// requests still get 401/403, and where support finds the end state of a request the access log shows as 200;
	// factory job 116: the support hint names the code of the one 403
	const ex = limits.slice(limits.indexOf('- **Example exemption for administrators (CrowdSec).**')).split('\n- ')[0]
	assert.ok(ex.length > 100, 'README Known limits: example exemption for administrators')
	for (const x of ['name: local/knorke-whitelist', "evt.Meta.http_status in ['401', '403']", '/apps/knorke/(api|pub)/v1/boards/[0-9]+/sync', 'ignored by whitelist', 'it does not replace the rule above',
		'a proxy that drops the header', 'access log', '`{"end": …}`', 'network tab', 'the administrator turns off link sharing', 'the sync requests after a new password',
		'the one 403 (`password_required`) named above'])
		assert.ok(ex.replace(/\s+/g, ' ').includes(x), `example names ${x}`)
	assert.doesNotMatch(ex.slice(ex.indexOf('```yaml')), /join/, 'the whitelist leaves out /join')
	// no host name or address of this installation in the README (the private domain is known only by its digest, lib/privateValues.mjs)
	assert.doesNotMatch(md, /\.home\./)
	assert.deepEqual(scanText(md), [], 'README names no private host value')
})

test('docs describe the end states with HTTP 200 as built (SPEC-M1 R39, factory job 028)', () => {
	// header name and codes come from the server; the client sends the same header
	const php = read('lib/Controller/ApiResponses.php')
	const H = php.match(/public const END_STATE_HEADER = '([^']+)';/)?.[1]
	const list = php.match(/private const END_STATES = \[([^\]]*)\];/)?.[1]
	assert.ok(H && list, 'ApiResponses.php declares END_STATE_HEADER and END_STATES')
	const E = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
	assert.ok(E.length >= 5, `END_STATES parsed (${E.length} codes)`)
	assert.equal(read('src/sync/http.js').match(/^export const END_STATE_HEADER = '([^']+)'$/m)?.[1], H, 'src/sync/http.js has the END_STATE_HEADER of the server')
	const hv = `\`${H}: 1\``
	// PROTOKOLL: §1 header paragraph, the one 200 row of §2, `end` reserved in §5.2
	const proto = read('docs/PROTOKOLL.md')
	assert.ok((proto.split('\n').find((l) => l.startsWith('**Header.**')) || '').includes(hv), `PROTOKOLL **Header.** names ${hv}`)
	const rows2 = section('docs/PROTOKOLL.md', '## 2. Fehler').split('\n')
	const rows200 = rows2.filter((l) => l.startsWith('| 200 |'))
	assert.equal(rows200.length, 1, 'PROTOKOLL §2 has exactly one 200 row')
	for (const c of [...E, 'password_required']) assert.ok(rows200[0].includes(`\`${c}\``), `PROTOKOLL §2, 200 row names ${c}`)
	// factory job 084: each code follows a row that exists (no "row of the same code" for not_logged_in, link_expired)
	assert.ok(rows200[0].includes('wie die alte Antwort') && !rows200[0].includes('desselben Codes'), 'PROTOKOLL §2, 200 row says which old row each code follows')
	// factory job 104: the client column maps each code to its old row (the 403 row of four codes in „…“), and every
	// row it names exists in §2, so a change to one of those rows turns this red
	const client = rows200[0].split('|').at(-2) || ''
	const follows = [
		['`guest_token` wie die Zeile 401 `guest_token`', ['| 401 | `guest_token` |']],
		['`not_logged_in` wie die Zeile 401 „– (Nextcloud)“', ['| 401 | – (Nextcloud) |']],
		['`link_revoked` und `links_disabled` wie ihre 403-Zeilen', ['| 403 | `link_revoked` |', '| 403 | `links_disabled` |']],
		['`link_expired` wie die 403-Zeile „`sharing_disabled`, `password_required`, `password_wrong`, `link_expired`“', ['| 403 | `sharing_disabled`, `password_required`, `password_wrong`, `link_expired` |']],
	]
	for (const [m, rows] of follows) {
		assert.ok(client.includes(m), `PROTOKOLL §2, client column of the 200 row says: ${m}`)
		for (const r of rows) assert.ok(rows2.some((l) => l.startsWith(r)), `PROTOKOLL §2 has the row ${r} (named by: ${m})`)
	}
	// every code of END_STATES stands in backticks in the client column; its „wie die …“ is checked only by a pair
	// in `follows`, which a new code does not get by itself
	for (const c of E) assert.ok(client.includes(`\`${c}\``), `PROTOKOLL §2, client column of the 200 row names ${c}`)
	const s52 = section('docs/PROTOKOLL.md', '### 5.2')
	assert.ok(s52.includes('reserviert') && s52.includes('`end`'), 'PROTOKOLL §5.2 reserves `end`')
	// SPEC-M1: §4.2, §4.5 and §6.4 (each up to the next ### heading)
	const spec = read('docs/SPEC-M1.md')
	const sub = (h) => {
		const i = spec.indexOf(`\n${h}`)
		assert.ok(i >= 0, `SPEC-M1 has ${h.trim()}`)
		const j = spec.indexOf('\n### ', i + 1)
		return spec.slice(i, j < 0 ? spec.length : j)
	}
	for (const h of ['### 4.2 ', '### 4.5 ', '### 6.4 ']) {
		const s = sub(h)
		assert.ok(s.includes(hv), `SPEC-M1 ${h.trim()} names ${hv}`)
		assert.ok(s.includes('**(R39)**'), `SPEC-M1 ${h.trim()} carries **(R39)**`)
	}
	const s42 = sub('### 4.2 ')
	for (const c of E) assert.ok(s42.includes(`\`${c}\``), `SPEC-M1 §4.2 names ${c}`)
	assert.ok(sub('### 6.4 ').includes('`endStateOf'), 'SPEC-M1 §6.4 names endStateOf')
	const lines = spec.split('\n')
	const r23 = lines.find((l) => l.startsWith('| **(R23)** `/sync` meldet Zustände ohne 401/403')) || ''
	for (const x of ['**(R39) Umgesetzt**', 'Factory-Job 028', '259e6ba']) assert.ok(r23.includes(x), `SPEC-M1 §1.2 row (R23) names ${x}`)
	// §8.3: one C87 row between C83 and CINV; the contract has the case
	const c87 = lines.flatMap((l, k) => (l.startsWith('| **(R39)** C87 |') ? [k] : []))
	assert.equal(c87.length, 1, 'SPEC-M1 §8.3 has exactly one C87 row')
	const c83 = lines.findIndex((l) => l.startsWith('| **(R22)** C83 |'))
	const cinv = lines.findIndex((l) => l.startsWith('| CINV |'))
	assert.ok(c83 >= 0 && c83 < c87[0] && c87[0] < cinv, 'SPEC-M1 §8.3: C87 after C83 and before CINV')
	assert.ok(read('dev/sim/contract.mjs').includes("C('C87'"), 'dev/sim/contract.mjs has C87')
	assert.ok(lines.some((l) => l.startsWith('| **(R39)** SPEC-M0 §4.2')), 'SPEC-M1 §12.2 has the (R39) row')
	// a later revision (R40, factory job 063) moves the number on; §50 stays in the head line
	const head = lines.find((l) => l.startsWith('Stand ')) || ''
	const rev = Number(head.match(/\*\*Revision (\d+)\*\*/)?.[1])
	assert.ok(head.includes('§50: Endzustände mit HTTP 200') && rev >= 39, `SPEC-M1 head line: §50 and Revision ≥ 39 (${rev})`)
	assert.equal(lines.filter((l) => l === '## 50. Revision 39 – Endzustände mit HTTP 200').length, 1, 'SPEC-M1 has §50 once')
	// CHANGELOG [Unreleased]
	const cl = read('CHANGELOG.md')
	const from = cl.indexOf('## [Unreleased]')
	const to = cl.indexOf('## [0.2.0]')
	assert.ok(from >= 0 && to > from, 'CHANGELOG has [Unreleased] above [0.2.0]')
	assert.ok(cl.slice(from, to).includes(hv), `CHANGELOG [Unreleased] names ${hv}`)
	// factory job 084: with links_disabled the tab ends after the sync (finalOf403), no join follows
	const unrel = cl.slice(from, to).replace(/\s+/g, ' ')
	assert.ok(unrel.includes('ends there, without a join'), 'CHANGELOG [Unreleased]: link sharing turned off ends the tab after the sync')
	assert.ok(!unrel.includes('or link sharing is turned off, a guest tab gets 200'), 'CHANGELOG [Unreleased]: the old sentence (a join also for links_disabled) is gone')
})

test('docs describe the privacy notice as built (SPEC-M1 R40, factory job 032)', () => {
	const spec = read('docs/SPEC-M1.md')
	const lines = spec.split('\n')
	/** SPEC-M1 from the line `from` up to the line `to` (both headings without the newline). */
	const sub = (from, to) => {
		const i = spec.indexOf(`\n${from}`)
		assert.ok(i >= 0, `SPEC-M1 has ${from.trim()}`)
		const j = spec.indexOf(`\n${to}`, i + 1)
		assert.ok(j > i, `SPEC-M1 has ${to.trim()} after ${from.trim()}`)
		return spec.slice(i, j)
	}
	const notice = read('lib/Service/PrivacyNotice.php')
	const TEXT_MAX = Number(notice.match(/public const TEXT_MAX = (\d+);/)?.[1])
	const LANGUAGES_MAX = Number(notice.match(/public const LANGUAGES_MAX = (\d+);/)?.[1])
	assert.ok(TEXT_MAX > 0 && LANGUAGES_MAX > 0, `PrivacyNotice.php declares TEXT_MAX (${TEXT_MAX}) and LANGUAGES_MAX (${LANGUAGES_MAX})`)

	// 1. route 27: the last line of routes.php; one §4.1 row right after route 26; one body-key row (= the keys the controller reads)
	assert.ok(read('appinfo/routes.php').includes("['name' => 'settingsApi#update', 'url' => '/api/v1/settings/privacy', 'verb' => 'PUT'],"), 'appinfo/routes.php has route 27')
	const r27 = lines.flatMap((l, k) => (l.startsWith('| **(R40)** 27 | `settingsApi#update` | PUT | `/api/v1/settings/privacy` |') ? [k] : []))
	assert.equal(r27.length, 1, 'SPEC-M1 §4.1 has exactly one row for route 27')
	assert.ok(lines[r27[0] - 1].startsWith('| 26 | `moderationApi#endSummon` |'), 'the route-27 row comes right after route 26')
	for (const x of ['forbidden', 'CSRF', 'text_too_long', 'invalid_url', 'unknown_language', 'too_many_languages', `${TEXT_MAX} Codepunkte`, `${LANGUAGES_MAX} Sprachen`]) {
		assert.ok(lines[r27[0]].includes(x), `the route-27 row names ${x}`)
	}
	assert.equal(lines.filter((l) => l.startsWith('| **(R40)** settings (27) | `default`, `languages` |')).length, 1, 'one body-key row for route 27')
	assert.ok(read('lib/Controller/SettingsApiController.php').includes("JsonBody::read($this->request, ['default', 'languages'])"), 'the controller reads exactly these body keys')

	// 2. §4.11.3: the key list of PageController.php word for word
	const keys = read('lib/Controller/PageController.php').match(/public const INITIAL_STATE_KEYS = (\[[^\]]*\]);/)?.[1]
	assert.ok(keys, 'PageController.php declares INITIAL_STATE_KEYS')
	const s4113 = sub('#### 4.11.3 ', '#### 4.11.4 ')
	assert.ok(s4113.includes(`\`INITIAL_STATE_KEYS = ${keys};\``), `§4.11.3 states INITIAL_STATE_KEYS = ${keys}`)
	for (const x of ['**(R40)**', 'privacyAdmin', "'admin'"]) assert.ok(s4113.includes(x), `§4.11.3 names ${x}`)

	// 3. board.linkOpenSince: SPEC-M1 §4.4 and PROTOKOLL §4; the account snapshot sets it, the guest controller never
	const s44 = sub('### 4.4 ', '### 4.5 ')
	assert.ok(s44.includes('linkOpenSince') && s44.includes('**(R40)**'), '§4.4 names linkOpenSince with (R40)')
	const proto = section('docs/PROTOKOLL.md', '## 4. Snapshot')
	assert.ok(proto.includes('`board.linkOpenSince`') && proto.includes('**(R40)**'), 'PROTOKOLL §4 names `board.linkOpenSince` with (R40)')
	assert.ok(read('lib/Controller/SyncController.php').includes("$meta['linkOpenSince'] = "), 'route 12 sets linkOpenSince')
	assert.ok(!read('lib/Controller/PublicSyncController.php').includes('linkOpenSince'), 'routes 14 and 15 do not')

	// 4. §6.6: the components, the scrolling text and both storage keys (as src/util/storage.js builds them)
	const s66 = sub('### 6.6 ', '### 6.7 ')
	for (const x of ['**(R40)**', '30vh', '`PrivacyInfo.vue`', '`AdminSettings.vue`', 'link-badge', 'knorke.privacy.<boardId>', 'knorke.linkInfo.<boardId>.<pid>']) {
		assert.ok(s66.includes(x), `§6.6 names ${x}`)
	}
	const storage = read('src/util/storage.js')
	assert.ok(storage.includes("privacy: (boardId) => 'knorke.privacy.' + boardId,") && storage.includes("linkInfo: (boardId, pid) => 'knorke.linkInfo.' + boardId + '.' + pid,"), 'storage.js builds both keys')
	assert.match(read('src/styles/knorke.css'), /\.knorke-dialog__privacy-text \{\n\tmax-height: 30vh;/, 'only the notice text scrolls, at most 30vh')

	// 5. §6.8: the hooks, each set in one of the four components; every data-knorke attribute of the (R40) rows exists there
	const s68 = sub('### 6.8 ', '### 6.9 ')
	const code = ['src/admin/AdminSettings.vue', 'src/components/PrivacyInfo.vue', 'src/components/TopBar.vue', 'src/components/GuestNameDialog.vue'].map(read).join('\n')
	for (const h of ['privacy-notice', 'data-knorke-privacy-text', 'privacy-info', 'data-knorke-privacy-kind', 'data-knorke-privacy-link', 'link-badge', 'privacy-close', 'data-knorke-admin',
		'privacy-url', 'privacy-language', 'privacy-add-language', 'privacy-remove-language', 'privacy-save']) {
		assert.ok(s68.includes(h), `§6.8 names ${h}`)
		assert.ok(code.includes(h), `the code sets ${h}`)
	}
	const r40 = s68.split('\n').filter((l) => l.startsWith('| **(R40)**'))
	assert.equal(r40.length, 4, '§6.8 has four (R40) rows')
	for (const a of new Set(r40.join('\n').match(/data-knorke(?:-[a-z]+)*/g))) assert.ok(code.includes(a), `${a} (§6.8) is set in the code`)

	// 6. §6.11: one row per notice text, German word for word from l10n/de.json
	const de = JSON.parse(read('l10n/de.json')).translations
	const s611 = sub('### 6.11 ', '### 6.12 ').split('\n')
	for (const en of [
		'Everyone on this board sees your name, your cursor and everything you add or change. The board is stored on this Nextcloud server.',
		'Others on this board see neither your cursor nor how you vote. The board is stored on this Nextcloud server.',
		'Guests can join this board through a link without an account. They see the display names and cursors of everyone on the board and all of its content.',
		'Open by link', 'Privacy notice', 'Close privacy notice',
	]) {
		assert.ok(typeof de[en] === 'string' && de[en].length > 0, `l10n/de.json translates "${en.slice(0, 40)}"`)
		const rows = s611.filter((l) => l.includes(`\`${en}\``) && l.includes(`\`${de[en]}\``))
		assert.equal(rows.length, 1, `§6.11: exactly one row with "${en.slice(0, 40)}" and its German`)
	}

	// 7. board cap 56: ED-36 keeps its text and gets the addition; §8.4 (R14) names 56
	const ed36 = lines.filter((l) => l.startsWith('- ED-36: `MAX_BOARDS_PER_RUN` bleibt 48. – E09c und E38 bringen je ein Board dazu, der volle Lauf lag bei etwa 40.'))
	assert.equal(ed36.length, 1, 'ED-36 keeps its text')
	assert.ok(ed36[0].includes('**(R40)**') && ed36[0].includes('56'), 'ED-36: (R40) and 56')
	const r14 = lines.filter((l) => l.startsWith('**(R14) Board-Deckel je Lauf:**'))
	assert.equal(r14.length, 1, 'one paragraph "(R14) Board-Deckel je Lauf"')
	assert.ok(r14[0].includes('**(R40)**') && r14[0].includes('`MAX_BOARDS_PER_RUN` = 56'), '§8.4 (R14): (R40) and 56')

	// 8. revision: head line ≥ 40 with §51, §51 once at the end
	const head = lines.find((l) => l.startsWith('Stand ')) || ''
	const rev = Number(head.match(/\*\*Revision (\d+)\*\*/)?.[1])
	assert.ok(rev >= 40 && head.includes('§51: Datenschutzhinweis'), `SPEC-M1 head line: Revision ≥ 40 (${rev}) and §51`)
	const h51 = '## 51. Revision 40 – Datenschutzhinweis'
	assert.equal(lines.filter((l) => l === h51).length, 1, 'SPEC-M1 has §51 once')
	const i51 = spec.indexOf(`\n${h51}\n`)
	const j51 = spec.indexOf('\n## ', i51 + 1)
	const s51 = spec.slice(i51, j51 < 0 ? spec.length : j51)
	for (const x of ['Factory-Job 032', '2dfb856', '### 51.1 Geänderte Stellen']) assert.ok(s51.includes(x), `§51 names ${x}`)

	// 9. README: the paragraph under Installation, after "Link address for guests."
	const md = read('README.md')
	const inst = md.slice(md.indexOf('## Installation'), md.indexOf('## Building'))
	const paras = inst.split(/\n\s*\n/).filter((p) => p.startsWith('**Privacy notice for guests.**'))
	assert.equal(paras.length, 1, 'README Installation has one paragraph "Privacy notice for guests."')
	assert.ok(inst.indexOf('**Link address for guests.**') >= 0 && inst.indexOf('**Link address for guests.**') < inst.indexOf('**Privacy notice for guests.**'), 'it follows "Link address for guests."')
	const flat = paras[0].replace(/\s+/g, ' ')
	for (const x of ['Administration settings', '"Knorke"', '`privacyUrl`', '`de_DE`', `${TEXT_MAX} characters`, `${LANGUAGES_MAX} languages`]) assert.ok(flat.includes(x), `the paragraph names ${x}`)

	// 10. CHANGELOG: the entry under [Unreleased] → Added
	const cl = read('CHANGELOG.md')
	const un = cl.slice(cl.indexOf('## [Unreleased]'), cl.indexOf('## [0.2.0]'))
	const at = un.indexOf('\n- Privacy notice for guests and on boards open by link:')
	assert.ok(at >= 0, 'CHANGELOG [Unreleased] has the entry')
	assert.ok(un.indexOf('\n### Added\n') < at && at < un.indexOf('\n### Changed\n'), 'the entry is under Added')
	const rest = un.slice(at + 1)
	const ends = [rest.indexOf('\n- '), rest.indexOf('\n### ')].filter((i) => i >= 0)
	const entry = rest.slice(0, Math.min(rest.length, ...ends)).replace(/\s+/g, ' ')
	for (const x of ['`PUT /api/v1/settings/privacy`', '`board.linkOpenSince`', '"Open by link"', '"Per Link offen"', 'protocol stays at 2']) assert.ok(entry.includes(x), `the entry names ${x}`)
})

test('SPEC-M1 §6.11: the count line of the board menu (R25) states the "%n item(s) on this board" entry of l10n/de.json word for word', () => {
	const en = ['%n item on this board', '%n items on this board']
	const de = JSON.parse(read('l10n/de.json')).translations[`_${en[0]}_::_${en[1]}_`]
	assert.ok(Array.isArray(de) && de.length === 2 && de.every((x) => typeof x === 'string' && x.length > 0), 'l10n/de.json has the entry with two German forms')
	const spec = read('docs/SPEC-M1.md')
	const from = spec.indexOf('\n### 6.11 ')
	const to = spec.indexOf('\n### 6.12 ')
	assert.ok(from >= 0 && to > from, 'SPEC-M1 has §6.11 followed by §6.12')
	const rows = spec.slice(from, to).split('\n').filter((l) => l.includes(`\`${en[0]}\` / \`${en[1]}\``))
	assert.equal(rows.length, 1, 'exactly one §6.11 row names the two source strings')
	const cells = rows[0].split('|').slice(1, -1).map((c) => c.trim())
	assert.equal(cells.length, 2, 'the row has a source and a German column')
	assert.equal(cells[1], `\`${de[0]}\` / \`${de[1]}\``, 'the German column is the de.json entry word for word')
})

test('local values: the same three keys in dev/local.env.example, dev/lib.sh and ENTWICKLUNG §3.10; §3.10 names KD_LOCAL_ENV; §3.2 has no address default for KD_DNS (factory job 036, SPEC-M1 §12.1 R16)', () => {
	const KEYS = ['KD_DNS', 'KD_LAN_HOST', 'KD_PROD_STACK_DIR']
	const example = read('dev/local.env.example')
	assert.equal((example.match(/SPDX-FileCopyrightText/g) || []).length, 1, 'the template has one SPDX header')
	assert.ok(example.split('\n').every((l) => l === '' || l.startsWith('#')), 'every line of the template is a comment')
	assert.deepEqual([...example.matchAll(/^# (KD_[A-Z_]+)=\S*$/gm)].map((m) => m[1]).sort(), KEYS, 'keys of dev/local.env.example (lines "# KEY=value")')
	const lib = read('dev/lib.sh').match(/^KD_LOCAL_KEYS="([^"]*)"$/m)
	assert.ok(lib, 'dev/lib.sh has KD_LOCAL_KEYS')
	assert.deepEqual(lib[1].split(' ').sort(), KEYS, 'KD_LOCAL_KEYS of dev/lib.sh')
	const dev = read('docs/ENTWICKLUNG.md')
	assert.equal((dev.match(/^### 3\.10 Lokale Werte/gm) || []).length, 1, 'one heading "### 3.10 Lokale Werte"')
	const p310 = section('docs/ENTWICKLUNG.md', '### 3.10 Lokale Werte')
	assert.ok(p310.split('\n')[0].includes('dev/local.env'), 'the heading names dev/local.env')
	assert.ok(dev.indexOf('### 3.10 Lokale Werte') > dev.indexOf('### 3.9 ') && dev.indexOf('### 3.10 Lokale Werte') < dev.indexOf('\n## 4. '), '§3.10 is the last part of §3')
	assert.deepEqual([...p310.matchAll(/^\| `(KD_[A-Z_]+)` \|/gm)].map((m) => m[1]).sort(), KEYS, 'keys of the table in §3.10')
	assert.ok(p310.includes('KD_LOCAL_ENV'), '§3.10 names KD_LOCAL_ENV')
	assert.ok(p310.includes('dev/local.env.example'), '§3.10 names the template')
	assert.ok(p310.includes('nie gesourct'), '§3.10 says the file is never sourced')
	// factory job 060: the BOM, the regex spelling [.] and a neutral host name as the placeholder
	assert.ok(p310.includes('BOM'), '§3.10 says a BOM at the start of the file is ignored')
	assert.ok(p310.includes('[.]'), '§3.10 names [.] among the regex spellings of the dot')
	assert.ok(p310.includes('example.org'), '§3.10 names example.org as the placeholder for a host name')
	const p32 = dev.slice(dev.indexOf('### 3.2 '), dev.indexOf('### 3.3 '))
	const dns = p32.split('\n').filter((l) => l.startsWith('| `KD_DNS` |'))
	assert.equal(dns.length, 1, '§3.2 has one KD_DNS row')
	assert.equal(dns[0].split('|')[2].trim(), 'leer', 'KD_DNS defaults to empty')
	assert.doesNotMatch(dns[0], /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no IP address in the KD_DNS row')
	for (const k of ['KD_LAN_HOST', 'KD_PROD_STACK_DIR', 'KD_LOCAL_ENV']) {
		assert.equal(p32.split('\n').filter((l) => l.startsWith(`| \`${k}\` |`)).length, 1, `§3.2 has a row for ${k}`)
	}
})

// ── Revision 52: R-B is no step before the App Store release (SPEC-M1 §63) ──

test('R-B is no step before the App Store release; SPEC-M1 §8.8 (7) records the device check of 2026-10-22 (SPEC-M1 R52, factory job 133)', () => {
	const MUST = 'keine Voraussetzung für das App-Store-Release'
	const SPEC = 'docs/SPEC-M1.md'
	const DEV = 'docs/ENTWICKLUNG.md'
	const spec = read(SPEC)
	const dev = read(DEV)
	// about 40 places in two files: every red one is listed at once
	const red = []
	const check = (ok, what) => { if (!ok) red.push(what) }
	/** `text` up to the line that starts with `end`. */
	const upTo = (text, end) => {
		const j = text.indexOf(`\n${end}`)
		check(j >= 0, `"${end}" follows "${text.split('\n', 2).join('').slice(0, 30)}"`)
		return j < 0 ? text : text.slice(0, j)
	}
	/** The one line of `text` that starts with `start`; '' (and red) unless there is exactly one. */
	const only = (text, start, where) => {
		const hits = text.split('\n').filter((l) => l.startsWith(start))
		check(hits.length === 1, `${where}: exactly one line starts with ${start} (found ${hits.length})`)
		return hits.length === 1 ? hits[0] : ''
	}

	// 1. head line and §63
	const head = spec.split('\n').find((l) => l.startsWith('Stand ')) || ''
	const rev = Number(head.match(/\*\*Revision (\d+)\*\*/)?.[1])
	check(rev >= 52, `SPEC-M1 head line: Revision ≥ 52 (${rev})`)
	check(head.includes('§63: R-B nicht vor dem App-Store-Release'), 'SPEC-M1 head line names §63')
	only(spec, '## 63. Revision 52 – ', 'SPEC-M1')

	// 2. §8.8 states it, point 7 records the device check (by eye, no numbers)
	const s88 = upTo(section(SPEC, '\n### 8.8 '), '### 8.9 ')
	check(s88.includes(MUST), `SPEC-M1 §8.8: ${MUST}`)
	const p7 = only(s88, '7. **(R52) Sichtprobe vom 22.10.2026 (keine Messung R-B):**', 'SPEC-M1 §8.8')
	for (const x of ['3000 Notizen', '20 Frames', '`dev/ipad/relay.mjs`', 'Samsung Galaxy Tab S11 Ultra', 'S Pen', 'Mac mini M5 Pro', '„Alle zu mir“', 'keine fps-Werte', 'Safari auf iPadOS']) {
		check(p7.includes(x), `SPEC-M1 §8.8 (7) names ${x}`)
	}

	// 3. the places with the current plan carry (R52); 4. three of them in the words of MUST
	const s10 = section(SPEC, '\n## 10. ')
	const s121 = upTo(section(SPEC, '\n### 12.1 '), '### 12.2 ')
	const s343 = upTo(section(SPEC, '\n### 34.3 '), '### 34.4 ')
	const places = [
		...['| Pflicht vor Prod |', '| **(R23)** iPad-Endmessung R-B', '| iPad |', '- **Direkter Pfad**', '**(R2) Tablet-Feinheiten', '- **(R19)** Bis zur R-B-Runde', '| W4 |',
			'| USER-01:', '| USER-07:', '| USER-18:', '| D1 |', '- **§16, Zeile „Nutzer hat kein iPad'].map((s) => [spec, s, 'SPEC-M1']),
		...['- **(R9) WebKit beim Verlassen:**', '- **iPad/WebKit ungemessen:**', '- **(R2) Schmal-Layout:**'].map((s) => [s121, s, 'SPEC-M1 §12.1']),
		...['| P4 |', '| E4 |'].map((s) => [s10, s, 'SPEC-M1 §10']),
		...['| P4 |', '| E4 |', '| USER-01, USER-18 |', '| USER-07 |'].map((s) => [s343, s, 'SPEC-M1 §34.3']),
	]
	for (const [text, start, where] of places) check(only(text, start, where).includes('**(R52)**'), `${where} ${start} carries (R52)`)
	for (const [text, start, where] of [[spec, '| **(R23)** iPad-Endmessung R-B', 'SPEC-M1'], [s10, '| P4 |', 'SPEC-M1 §10'], [s10, '| E4 |', 'SPEC-M1 §10']]) {
		check(only(text, start, where).includes(MUST), `${where} ${start}: ${MUST}`)
	}

	// 5. ENTWICKLUNG describes today: R-B is no step before the App Store release
	for (const x of ['vor dem App-Store-Release', 'vor das App-Store-Release']) check(!dev.includes(x), `ENTWICKLUNG no longer says ${x}`)
	// 6. its R-B places no longer say M2; 7. some of them state it in the words of MUST
	const s57 = upTo(section(DEV, '\n### 5.7 '), '### 5.8 ')
	const p4 = only(dev, '| P4 |', 'ENTWICKLUNG')
	const e4 = dev.match(/E4 iPad R-B \(([^)]*)\)/)?.[1] ?? ''
	check(e4 !== '', 'ENTWICKLUNG §10 has the part "E4 iPad R-B (…)"')
	const noM2 = [[only(dev, '| `ipad` |', 'ENTWICKLUNG'), 'row `ipad`'], [only(dev, '| iPad R-B |', 'ENTWICKLUNG'), 'row iPad R-B'], [s57, '§5.7'], [p4, 'row P4'],
		[only(dev, '9. Wake-Lock-Sichtprüfung', 'ENTWICKLUNG'), 'P9 step 9'], [e4, 'E4']]
	for (const [text, where] of noM2) check(!/\bM2\b/.test(text), `ENTWICKLUNG ${where}: no M2`)
	for (const [text, where] of [[s57, '§5.7'], [p4, 'row P4'], [e4, 'E4']]) check(text.includes(MUST), `ENTWICKLUNG ${where}: ${MUST}`)
	check(s57.includes('geliehen'), 'ENTWICKLUNG §5.7: a borrowed iPad')
	check(s57.includes('SPEC-M1 §8.8 (7)'), 'ENTWICKLUNG §5.7 points to SPEC-M1 §8.8 (7)')

	assert.deepEqual(red, [], `${red.length} red checks`)
})
