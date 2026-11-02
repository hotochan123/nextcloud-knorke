/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Drift checks between the docs and the code they describe – no stack needed.
 * Each check compares a doc with something real (code, scripts, l10n/de.json)
 * or runs a block of a doc; sentences of the docs are not pinned for their
 * own sake (product owner, 2026-10-23).
 *
 * - THIRD-PARTY.md: every icon key in src/components/icons.js is listed
 *   exactly once – either with its Phosphor icon (@phosphor-icons/core 2.1.1,
 *   the name ICON_SOURCE gives) or as "own drawing"; nothing else is listed;
 *   the symbol table names the Phosphor icon each symbol shape draws (factory
 *   job 244, before Material Design Icons). With KD_PHOSPHOR_DIR=<the assets
 *   folder of @phosphor-icons/core 2.1.1, regular/ and duotone/> the path data
 *   of src/model/phosphor.js is also compared with the original SVG files
 *   (optional: the package is not a dependency).
 * - Runbook "nach DB-Restore" (ENTWICKLUNG §8, PROTOKOLL §12): the TTLs it
 *   names match lib/Service/FastCache.php.
 * - SPEC-M1 §5.1: every argument of createDistributed( in lib/ matches the
 *   regular expression ^'knorke/' \. \$epoch \. '/'$ that SPEC-M1 states. A
 *   call in another form is red for [B] (SPEC-M1 §9.6).
 * - Every Markdown document has exactly one SPDX header and one H1: a
 *   scripted edit with String.prototype.replace and "$`" in the replacement
 *   once copied docs/ENTWICKLUNG.md into itself twice (round 2, trap 9.22).
 * - ENTWICKLUNG §5.4 (scene lab): the gate and check counts that
 *   dev/scene-lab/run.mjs declares, gates, checks and measure rows that exist
 *   in the lab, the automatic rows of ipad/check.mjs, KNORKE_LAB_LABEL as
 *   run.sh reads it, --shadows on|off, the -noshadow report name as
 *   dev/scene-lab/names.js builds it; src/scene/nodes sets no shadowBlur.
 * - ENTWICKLUNG §5.5 and §5.8: the check-fresh lines in the form
 *   build/check-fresh.mjs prints them; §5.1 names folgenCode of
 *   dev/sim/lib/oracle.mjs; MAX_BOARDS_PER_RUN as dev/e2e/scenarios/world.mjs
 *   sets it.
 * - ENTWICKLUNG §10: the fertig line of dev/release.sh; occ knorke:compact
 *   (the key order of Compactor.php, the stderr message of Compact.php,
 *   cleanup_cursor, 60 s); occ knorke:orphans (its output lines as
 *   lib/Service/OrphanReconciler.php and lib/Command/Orphans.php print them,
 *   the keys and defaults of lib/Service/Limits.php). The copy blocks of P9
 *   step 3 and hotfix step 4 run in bash with rsync and chown as stubs: a
 *   failed tar, rsync or chown stops every step after it and the rm still
 *   removes $tmp (factory jobs 123, 127). Every rsync of P9 step 3 and hotfix
 *   steps 4 and 8 has the options of copy_app in factory/deploy.sh, never -a
 *   or -t; with the real rsync (skipped without it) the lines of the doc give
 *   a changed file a new time and keep MTIME of dev/release.sh on an
 *   unchanged one, and the dry run prints the four H1 lines (factory job 166).
 * - End states with HTTP 200 (SPEC-M1 R39, factory job 028): the header name
 *   and the end-state codes in PROTOKOLL, SPEC-M1 and the CHANGELOG are the
 *   ones of lib/Controller/ApiResponses.php and src/sync/http.js; SPEC-M1
 *   §8.3 has one row for C87 of dev/sim/contract.mjs.
 * - Privacy notice (SPEC-M1 R40, factory job 032): route 27, its body keys,
 *   INITIAL_STATE_KEYS, board.linkOpenSince, the storage keys, the hooks and
 *   the limits of PrivacyNotice.php as the code has them; SPEC-M1 §6.11
 *   against l10n/de.json.
 * - Local values (factory job 036, SPEC-M1 §12.1 R16): the keys of
 *   dev/local.env.example, KD_LOCAL_KEYS of dev/lib.sh and the tables of
 *   ENTWICKLUNG §3.10 and §3.2 are the same three; the KD_DNS row of §3.2
 *   has no IP address.
 * - No private values: no doc names an address of the edge check, the README
 *   and the docs it links name no private host value (dev/selftest/lib/privateValues.mjs).
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
 * The rows of the THIRD-PARTY.md table under the header line `head`.
 *
 * @param {string} head the header line of the table
 * @return {Array<[string, string]>} [first cell, second cell] without the backticks
 */
function thirdPartyRows(head) {
	const md = read('THIRD-PARTY.md')
	const i = md.indexOf(head + '\n|---|---|\n')
	assert.ok(i >= 0, `THIRD-PARTY.md: table "${head}" exists`)
	const body = md.slice(i).split('\n').slice(2)
	return body.slice(0, body.findIndex((l) => !l.startsWith('|'))).map((l) => l.split('|').slice(1, 3).map((c) => c.trim().replace(/^`|`$/g, '')))
}

test('THIRD-PARTY.md names every icon of src/components/icons.js once: its Phosphor icon or own drawing; the symbols by their Phosphor icon', async () => {
	const { ICON_SOURCE } = await import(path.join(ROOT, 'src/components/icons.js'))
	const { PHOSPHOR, PHOSPHOR_DUO, PHOSPHOR_SCALE } = await import(path.join(ROOT, 'src/model/phosphor.js'))
	const { SHAPES } = await import(path.join(ROOT, 'src/model/shapes.js'))
	const { scalePath } = await import(path.join(ROOT, 'src/model/svgPath.js'))
	const phosphor = thirdPartyRows('| Key in `icons.js` | Phosphor icon |')
	const own = thirdPartyRows('| Key in `icons.js` | Origin |')
	assert.ok(phosphor.length >= 10, `Phosphor table parsed (${phosphor.length} rows)`)
	assert.deepEqual(own.filter(([, o]) => o !== 'own drawing'), [], 'every row of the second table is an own drawing')
	const keys = [...phosphor, ...own].map(([k]) => k)
	assert.equal(new Set(keys).size, keys.length, 'no key listed twice')
	assert.deepEqual(keys.sort(), Object.keys(ICON_SOURCE).sort(), 'THIRD-PARTY.md tables (Phosphor + own drawings) = icons.js keys')
	for (const [k, name] of phosphor) assert.equal(ICON_SOURCE[k], `phosphor:${name}`, k)
	for (const [k] of own) assert.equal(ICON_SOURCE[k], 'picture', k)
	const symbols = thirdPartyRows('| Shape kind | Phosphor icon |')
	assert.deepEqual(symbols.map(([, n]) => n).sort(), Object.keys(PHOSPHOR_DUO).sort(), 'the symbol table names the Duotone layers')
	for (const [kind, name] of symbols) {
		assert.equal(SHAPES[kind]?.icon, scalePath(PHOSPHOR[name], PHOSPHOR_SCALE), `${kind} = ${name}`)
		assert.equal(SHAPES[kind].duo, scalePath(PHOSPHOR_DUO[name], PHOSPHOR_SCALE), `${kind} duo = ${name}`)
	}
	assert.match(read('THIRD-PARTY.md'), /\[Phosphor Icons\]\([^)]+\) \(`@phosphor-icons\/core` 2\.1\.1\)/)
	assert.match(read('src/model/phosphor.js'), /@phosphor-icons\/core 2\.1\.1/)
})

test('Phosphor path data equals @phosphor-icons/core 2.1.1 (only with KD_PHOSPHOR_DIR)', { skip: !process.env.KD_PHOSPHOR_DIR && 'KD_PHOSPHOR_DIR not set' }, async () => {
	const { PHOSPHOR, PHOSPHOR_DUO } = await import(path.join(ROOT, 'src/model/phosphor.js'))
	const paths = (f) => [...fs.readFileSync(path.join(process.env.KD_PHOSPHOR_DIR, f), 'utf8').matchAll(/<path([^>]*)\/>/g)].map((m) => ({ d: / d="([^"]*)"/.exec(m[1])[1], light: / opacity="0\.2"/.test(m[1]) }))
	for (const [name, d] of Object.entries(PHOSPHOR)) {
		assert.deepEqual(paths(`regular/${name}.svg`).map((p) => p.d), [d], `regular ${name}`)
	}
	for (const [name, d] of Object.entries(PHOSPHOR_DUO)) {
		assert.deepEqual(paths(`duotone/${name}-duotone.svg`).filter((p) => p.light).map((p) => p.d), [d], `duotone ${name}`)
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

// steps of ENTWICKLUNG §10 that copy a release into the prod app folder: [start, end after it]
const P9_STEP3 = ['3. Aus dem **geprüften Archiv**', '\n4. ']
const HOTFIX_STEP4 = ['4. Entpacken, Eigentümer setzen, **Probelauf**', '\n5. ']
const HOTFIX_STEP8 = ['8. **Rückweg:**', '\n\n']

/** The part of ENTWICKLUNG §10 from `from` to the next `to` after it. */
function prodPart(from, to) {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	const i = p.indexOf(from), j = p.indexOf(to, i)
	assert.ok(i >= 0 && j > i, `${from} … ${to}`)
	return p.slice(i, j)
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

const MD_DOCS = ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'THIRD-PARTY.md', 'docs/FEATURES.md', 'docs/ADMIN.md', 'docs/ARCHITEKTUR.md', 'docs/ENTWICKLUNG.md', 'docs/PROTOKOLL.md']

test('every Markdown document has exactly one SPDX header and one H1 (no self-copy)', () => {
	for (const f of MD_DOCS) {
		const md = read(f)
		assert.equal((md.match(/SPDX-FileCopyrightText/g) || []).length, 1, `${f}: one SPDX header`)
		// H1 outside fenced code blocks
		const h1 = md.replace(/^```[\s\S]*?^```/gm, '').match(/^# /gm) || []
		assert.equal(h1.length, 1, `${f}: one H1`)
	}
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

test('ENTWICKLUNG §5.4 names the stage-3 lab gates G15/G16, the two stage-3 checks and KNORKE_LAB_LABEL, which run.sh reads (SPEC-M1 §8.5, §9.0 R16; ask of [S] in stage 3)', () => {
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
	assert.ok(sec.includes('`KNORKE_LAB_LABEL`'), '§5.4 names KNORKE_LAB_LABEL')
	assert.ok(read('dev/scene-lab/run.sh').includes('LABEL="${KNORKE_LAB_LABEL:-}"'), 'run.sh reads KNORKE_LAB_LABEL')
})

// ── stage 4 (SPEC-M1 R19) ──────────────────────────────────────────────────

test('ENTWICKLUNG §10 P9 step 1 names the fertig line as dev/release.sh logs it (factory job 123)', () => {
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	// the fertig line names version, archive and SHA-256
	assert.ok(p.includes('`… fertig: …/knorke-<version> (<n> Dateien), …/knorke-<version>.tar.gz, <SHA-256>`'), 'P9 step 1 names the fertig line of dev/release.sh')
	assert.match(read('dev/release.sh'), /^log "fertig: \$DEST \(\$FILES Dateien\), \$TGZ, \$\(cut -d' ' -f1 "\$TGZ\.sha256"\)"$/m, 'dev/release.sh logs that line')
})

test('ENTWICKLUNG names MAX_BOARDS_PER_RUN as dev/e2e/scenarios/world.mjs sets it', () => {
	const n = read('dev/e2e/scenarios/world.mjs').match(/^export const MAX_BOARDS_PER_RUN = (\d+)$/m)?.[1]
	assert.ok(n, 'world.mjs sets MAX_BOARDS_PER_RUN')
	assert.ok(read('docs/ENTWICKLUNG.md').includes(`\`MAX_BOARDS_PER_RUN\` = **${n}**`), `ENTWICKLUNG names \`MAX_BOARDS_PER_RUN\` = **${n}**`)
})

test('ENTWICKLUNG §10 describes occ knorke:compact as built: key order of Compactor.php, the stderr message of Compact.php, cleanup_cursor, 60 s (ask of [B], stage 4 phase 1)', () => {
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
	// exit codes and the stderr message of an unknown board
	assert.match(command, /'Board ' \. \$board \. ' not found\.'\);\s*return 1;/, 'Compact.php: unknown board → exit 1')
	assert.equal((command.match(/return 2;/g) || []).length, 2, 'Compact.php: --board and --now malformed → exit 2')
	assert.ok(p.includes('`Board N not found.`'), '§10 names the stderr message of Compact.php')
	// the run without --board: instance-wide first, then the cursor ring within the budget
	assert.match(compactor, /public const CURSOR_KEY = 'cleanup_cursor';/)
	assert.match(compactor, /setValueInt\(Application::APP_ID, self::CURSOR_KEY, \$board, lazy: true\)/, 'cursor stored as a lazy int')
	assert.match(limits, /public const CLEANUP_BUDGET_MS = 60000;/)
	const run = compactor.slice(compactor.indexOf('public function run('), compactor.indexOf('public function board('))
	assert.ok(run.indexOf('pruneChanges(') < run.indexOf('$this->cursor()') && run.indexOf('pruneLinks(') < run.indexOf('$this->cursor()'), 'instance-wide pruning before the boards')
	assert.ok(p.includes('`cleanup_cursor`'), '§10 names cleanup_cursor')
	assert.ok(p.includes('60 s'), '§10 names the budget of 60 s')
})

test('ENTWICKLUNG §5.4 names the stage-4 measure rows and run.sh measure --shadows on|off; the docs name src/scene/nodes/shade.js, and src/scene sets no shadowBlur (ask of [S], stage 4 phase 1)', () => {
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
	assert.ok(sec.includes('run.sh measure --shadows on|off') && sec.includes('dev/scene-lab/run.sh measure --shadows off'), '§5.4 names the option and its call')
	// note shadows: gradients of shade.js, no canvas shadowBlur in the scene
	assert.ok(fs.existsSync(path.join(ROOT, 'src/scene/nodes/shade.js')), 'src/scene/nodes/shade.js exists')
	for (const f of fs.readdirSync(path.join(ROOT, 'src/scene/nodes')).filter((n) => n.endsWith('.js'))) {
		const code = read(`src/scene/nodes/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
		assert.doesNotMatch(code, /shadowBlur/, `src/scene/nodes/${f} sets no shadowBlur`)
	}
	assert.ok(sec.includes('`src/scene/nodes/shade.js`'), '§5.4 names shade.js')
	assert.ok(read('docs/ARCHITEKTUR.md').includes('`src/scene/nodes/shade.js`'), 'ARCHITEKTUR names shade.js')
})

test('ENTWICKLUNG §5.5 (Laufbelege) and §5.8 quote the check-fresh lines in the form build/check-fresh.mjs prints them (ask of [C], R19 T4-26)', () => {
	const fresh = read('build/check-fresh.mjs')
	assert.ok(fresh.includes('`  ${checked} src/ entries in ${maps.length} maps, ${differ.length} differing, ${missing.length} missing, ${unverifiable.length} without sourcesContent`'), 'check-fresh: first line')
	assert.ok(fresh.includes('`  css: ${css.checked} src/styles entries, ${css.differ.length} differing, ${css.missing.length} missing`'), 'check-fresh: the indented CSS line')
	const md = read('docs/ENTWICKLUNG.md')
	const sec = md.slice(md.indexOf('### 5.5 '), md.indexOf('### 5.6 '))
	assert.ok(sec.includes('`  <n> src/ entries in 3 maps, <k> differing, <m> missing, <u> without sourcesContent`'), '§5.5 names the first line')
	assert.ok(sec.includes('`  css: <n> src/styles entries, <k> differing, <m> missing`'), '§5.5 names the CSS line')
	const rel = md.slice(md.indexOf('### 5.8 '), md.indexOf('## 6. '))
	assert.ok(rel.includes('`  css: <n> src/styles entries, 0 differing, 0 missing`'), '§5.8: the CSS line')
})

test('R20 known fixes in the docs: ENTWICKLUNG §5.4 -noshadow as names.js builds it (K9), §5.1 names folgenCode of the oracle (K1)', async () => {
	// K9 (RSC-04 after K8): §5.4 of ENTWICKLUNG
	const md = read('docs/ENTWICKLUNG.md')
	const lab = md.slice(md.indexOf('### 5.4 '), md.indexOf('### 5.5 '))
	const { reportFiles } = await import('../scene-lab/names.js')
	const off = reportFiles({ mode: 'measure', gpu: false, browser: 'webkit', shadows: 'off' })
	assert.equal(off.json, 'measure-webkit-cpu-noshadow.json', 'names.js: -noshadow after the set (K8)')
	assert.equal(reportFiles({ mode: 'measure', gpu: true, set: 'noconn', shadows: 'off', label: 'p2' }).md, 'report-chromium-gpu-noconn-noshadow-p2.md')
	assert.ok(lab.includes(`\`${off.json}\``), `§5.4 shows the example ${off.json} that names.js builds`)
	// K1: ENTWICKLUNG §5.1 names the function of the oracle rule
	const sim = md.slice(md.indexOf('### 5.1 '), md.indexOf('### 5.2 '))
	assert.ok(sim.includes('`folgenCode`'), '§5.1 names folgenCode')
	assert.match(read('dev/sim/lib/oracle.mjs'), /^export function folgenCode\(op, isPurged, typeOf = \(\) => undefined\) \{$/m)
})

// ── review round P7-C (SPEC-M1 §33.1 n, k) ────────────────────────────────

test('no doc names an address of the edge check (the forgery probe uses the RFC 5737 address)', () => {
	for (const f of ['docs/ENTWICKLUNG.md', 'README.md', 'CHANGELOG.md', 'docs/PROTOKOLL.md', 'docs/ARCHITEKTUR.md', 'docs/FEATURES.md', 'docs/ADMIN.md', 'SECURITY.md']) {
		const md = read(f).replace(/203\.0\.113\.\d+/g, '')
		assert.doesNotMatch(md, /\b(?:100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|172\.31)\.\d+/, `${f}: no address from the edge check`)
	}
})

test('ENTWICKLUNG §10 names occ knorke:orphans with its output lines as the code prints them and the byte keys with the defaults of Limits.php', () => {
	const md = read('docs/ENTWICKLUNG.md')
	const p = section('docs/ENTWICKLUNG.md', '## 10. Prod-Runbook')
	const cmd = read('lib/Command/Orphans.php')
	for (const x of ['occ knorke:orphans --dry-run', 'occ knorke:orphans']) assert.ok(p.includes(x), `§10 names ${x}`)
	// the output: one line "<kind>: <n>" per OrphanReconciler::KINDS, in that order; --dry-run adds one line
	const kinds = [...(read('lib/Service/OrphanReconciler.php').match(/public const KINDS = \[([^\]]*)\];/)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
	assert.ok(kinds.length > 0, 'OrphanReconciler.php declares KINDS')
	assert.ok(p.includes(kinds.map((k) => `${k}: <n>`).join('\n')), `§10 shows the lines ${kinds.join(', ')} in this order`)
	const dry = cmd.match(/->writeln\('(Dry run: [^']*)'\);/)?.[1]
	assert.ok(dry && p.includes(dry), `§10 names the dry-run line of Orphans.php (${dry})`)
	// defaults as lib/Service/Limits.php names them (once [B] has landed)
	const limits = read('lib/Service/Limits.php')
	const consts = [...limits.matchAll(/const (KEY_\w+|DEFAULT_\w+) = ([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/'/g, '')])
	const want = { budget_bytes_board_day: '268435456', budget_bytes_user_day: '536870912', changes_bytes_cap: '67108864' }
	for (const [k, v] of Object.entries(want)) {
		assert.ok(consts.some(([, val]) => val === k), `Limits.php has the key ${k}`)
		assert.ok(md.includes(k), `ENTWICKLUNG names ${k}`)
		assert.ok(consts.some(([n, val]) => n.startsWith('DEFAULT_') && val === v), `Limits.php has the default ${v} of ${k}`)
		assert.ok(p.includes(v), `§10 names the default ${v} of ${k}`)
	}
	assert.ok(consts.some(([n, val]) => n === 'DEFAULT_LINK_LIMIT' && val === '20'), 'link_limit default 20') && assert.ok(p.includes('| 20 |'), '§10 names the link_limit default 20')
	// the command exists in the code with these keys
	assert.match(cmd, /knorke:orphans/)
	assert.match(cmd, /dry-run/)
	assert.ok(read('appinfo/info.xml').includes('OCA\\Knorke\\Command\\Orphans'), 'info.xml registers the command')
})

// factory job 123: run the copy blocks of P9 step 3 and hotfix step 4 in bash. rsync and chown are
// stubs that log their arguments (KD_RSYNC_RC / KD_CHOWN_RC set their exit code; a dry run always
// succeeds); mktemp, tar and rm are real, and everything happens in a throwaway folder. This runs
// text written for prod (security review, round 1): bash runs with a PATH of only mktemp, tar, gzip
// and rm, and a block line that names docker, nextcloud-nextcloud, occ or sudo fails the test
// before anything runs. Every message of F2–F7 carries bash's stderr (factory job 127), so a
// command the minimal PATH does not find shows at once.
test('ENTWICKLUNG §10 P9 step 3 and hotfix step 4 run in bash: after a failed tar, rsync or chown nothing is copied or chowned, the rm still removes $tmp (factory job 123)', () => {
	const [p9] = fencedBlocks(prodPart(...P9_STEP3))
	const [dry, , real] = fencedBlocks(prodPart(...HOTFIX_STEP4))
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
		const dryRsync = (t) => `rsync -rlpgoD --delete --checksum --itemize-changes --dry-run ${t}/knorke/ ${app}/`
		const realRsync = (t) => `rsync -rlpgoD --delete --checksum --itemize-changes ${t}/knorke/ ${app}/`
		// factory job 127: bash's stderr in every message of F2–F7, e.g. "command not found" under the minimal PATH
		const why = (r) => ` (stderr: ${r.stderr.trim() || 'none'})`
		// F1: P9 with a missing archive: tar fails, so neither rsync nor chown runs; the rm still runs
		let r = run([p9], '0.0.0')
		assert.deepEqual(r.calls, [], 'F1: after a failed tar no rsync and no chown')
		assert.ok(r.gone, 'F1: the rm removes $tmp')
		assert.ok(r.stderr.includes('knorke-0.0.0.tar.gz'), `F1: the error names the missing archive (${r.stderr})`)
		// F2: P9 without an error (counter-check: the stubs are really called)
		r = run([p9], '9.9.9')
		assert.deepEqual(r.calls, [`rsync -rlpgoD --delete --checksum ${r.tmp}/knorke/ ${app}/`, `chown -R 33:33 ${app}`], 'F2: rsync, then chown' + why(r))
		assert.ok(r.gone, 'F2: the rm removes $tmp' + why(r))
		// F3: P9 with a failed rsync: no chown; the rm still runs
		r = run([p9], '9.9.9', { rsync: 23 })
		assert.deepEqual(r.calls, [`rsync -rlpgoD --delete --checksum ${r.tmp}/knorke/ ${app}/`], 'F3: after a failed rsync no chown' + why(r))
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

/** The rsync options of copy_app in factory/deploy.sh, the copy every deploy and rollback makes. */
function copyAppOptions() {
	const m = /^copy_app\(\) \{ rsync ((?:-\S+ )+)"\$1" "\$APP_DIR\/" && /m.exec(read('factory/deploy.sh'))
	assert.ok(m, 'factory/deploy.sh: copy_app is one rsync call into "$APP_DIR/"')
	return m[1].trim().split(/\s+/)
}

/** The rsync lines of the copy steps of ENTWICKLUNG §10: code blocks of P9 step 3 and hotfix step 4, inline code of hotfix step 8. */
function manualRsyncCalls() {
	const lines = ([from, to]) => fencedBlocks(prodPart(from, to)).flat().filter((l) => /^rsync\s/.test(l))
	return {
		'P9 step 3': lines(P9_STEP3),
		'hotfix step 4': lines(HOTFIX_STEP4),
		'hotfix step 8': [...prodPart(...HOTFIX_STEP8).matchAll(/`(rsync\s[^`]*)`/g)].map((m) => m[1]),
	}
}

// -t (also inside -a) keeps the archive's fixed mtime, which hides a change from opcache and APCu (traps 9.3, 9.4)
const keepsTimes = (o) => o === '--times' || o === '--archive' || /^-[^-]*[at]/.test(o)

// factory job 166: a copy by hand works like factory/deploy.sh; the public repository has no factory/
const HAS_DEPLOY = fs.existsSync(path.join(ROOT, 'factory/deploy.sh'))
test('ENTWICKLUNG §10 copies a release by hand with the rsync options of copy_app in factory/deploy.sh (P9 step 3, hotfix steps 4 and 8), never with -a, -t or --times (factory job 166)', { skip: !HAS_DEPLOY && 'factory/deploy.sh is not in the public tree' }, () => {
	const opts = copyAppOptions()
	assert.ok(!opts.some(keepsTimes), `copy_app copies without -a, -t or --times (${opts.join(' ')})`)
	const calls = manualRsyncCalls()
	assert.deepEqual(Object.values(calls).map((l) => l.length), [1, 2, 1], 'one rsync in P9 step 3, the dry run and the real run in hotfix step 4, one in hotfix step 8')
	for (const [where, list] of Object.entries(calls)) {
		for (const call of list) {
			const own = call.split(/\s+/).slice(1).filter((w) => w.startsWith('-'))
			assert.ok(!own.some(keepsTimes), `${where}: no -a, -t or --times in "${call}"`)
			const rest = own.filter((o) => o !== '--itemize-changes' && o !== '--dry-run')
			assert.deepEqual([...rest].sort(), [...opts].sort(), `${where}: "${call}" has the options of copy_app (${opts.join(' ')}), plus at most --itemize-changes and --dry-run`)
		}
	}
})

const HAS_RSYNC = spawnSync('rsync', ['--version']).status === 0

// factory job 166: the rsync lines of the doc with the real rsync, in a throwaway folder only. Each line
// must be rsync, its options, "$tmp"/knorke/ and the app folder below <prod>, so nothing else can run;
// bash finds only rsync, and <prod> is replaced before anything runs.
test('the rsync lines of ENTWICKLUNG §10 with the real rsync: a changed file gets a new time, an unchanged one keeps MTIME of dev/release.sh, the dry run and the real run of hotfix step 4 print the four H1 lines (factory job 166)', { skip: !HAS_RSYNC && 'rsync not found on this host' }, () => {
	const m = /^MTIME="([^"]+)"$/m.exec(read('dev/release.sh'))
	assert.ok(m, 'dev/release.sh sets MTIME')
	const mtime = Date.parse(m[1])
	assert.ok(Number.isFinite(mtime), `MTIME "${m[1]}" is a date`)
	const [p9Block] = fencedBlocks(prodPart(...P9_STEP3))
	const [dryBlock, h1Block, realBlock] = fencedBlocks(prodPart(...HOTFIX_STEP4))
	const only = (block) => {
		const l = block.filter((x) => /^rsync\s/.test(x))
		assert.equal(l.length, 1, 'one rsync line in the block')
		const cmd = l[0].replace(/\s*&&$/, '')
		assert.match(cmd, /^rsync(?: -[-\w]+)+ "\$tmp"\/knorke\/ <prod>\/nextcloud_html\/custom_apps\/knorke\/$/, 'only rsync, its options, "$tmp"/knorke/ and the app folder')
		return cmd
	}
	const p9 = only(p9Block), dry = only(dryBlock), real = only(realBlock)
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdrsync-')))
	try {
		assert.ok(!/\s/.test(root), `the throwaway folder has no blank (${root})`)
		const bin = path.join(root, 'bin')
		fs.mkdirSync(bin)
		const where = spawnSync('bash', ['-c', 'command -v rsync'], { encoding: 'utf8' }).stdout.trim()
		assert.ok(where.startsWith('/'), `rsync is a program on this host (${where})`)
		fs.symlinkSync(where, path.join(bin, 'rsync'))
		// every file and folder below dir gets MTIME, as tar gives it when it unpacks a release archive
		const stamp = (dir) => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				if (e.isDirectory()) stamp(path.join(dir, e.name))
				else fs.utimesSync(path.join(dir, e.name), mtime / 1000, mtime / 1000)
			}
			fs.utimesSync(dir, mtime / 1000, mtime / 1000)
		}
		const put = (base, files) => {
			for (const [rel, body] of Object.entries(files)) {
				fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true })
				fs.writeFileSync(path.join(base, rel), body)
			}
			stamp(base)
		}
		// a fresh case: $tmp/knorke/ is the unpacked release, <prod>/…/knorke/ the app folder, both with MTIME
		let n = 0
		const setup = (release, installed) => {
			const c = path.join(root, `case-${++n}`)
			const tmp = path.join(c, 'tmp'), prod = path.join(c, 'prod')
			const app = path.join(prod, 'nextcloud_html', 'custom_apps', 'knorke')
			put(path.join(tmp, 'knorke'), release)
			put(app, installed)
			return { tmp, prod, app }
		}
		const run = (cmd, { tmp, prod }) => {
			// placeholders by split/join, never replace() with a replacement string (trap 9.22)
			const r = spawnSync('bash', ['-c', 'PATH="$KD_BIN"\n' + cmd.split('<prod>').join(prod)], {
				encoding: 'utf8', timeout: 20000, env: { KD_BIN: bin, tmp, LC_ALL: 'C' },
			})
			assert.equal(r.status, 0, `${cmd}: exit 0 (stderr: ${r.stderr})`)
			return r.stdout.split('\n').filter(Boolean)
		}
		const time = (c, rel) => fs.statSync(path.join(c.app, rel)).mtimeMs
		const text = (c, rel) => fs.readFileSync(path.join(c.app, rel), 'utf8')

		// a) P9 step 3: info.xml and a PHP file change at the same size, one file stays, one is new, one goes
		const PHP = 'lib/Controller/PageController.php'
		const installed = { 'appinfo/info.xml': '<version>0.3.0</version>\n', [PHP]: '<?php return 1;\n', 'js/same.mjs': 'same\n', 'js/gone.mjs': 'only installed\n' }
		const release = { 'appinfo/info.xml': '<version>0.3.1</version>\n', [PHP]: '<?php return 2;\n', 'js/same.mjs': 'same\n', 'js/new.mjs': 'new\n' }
		const changed = ['appinfo/info.xml', PHP]
		for (const rel of changed) assert.equal(release[rel].length, installed[rel].length, `${rel}: same size, only the content differs`)
		let c = setup(release, installed)
		const start = Date.now()
		run(p9, c)
		for (const rel of changed) {
			assert.equal(text(c, rel), release[rel], `P9 step 3: ${rel} has the new content`)
			assert.ok(time(c, rel) !== mtime && time(c, rel) >= start - 2000, `P9 step 3: ${rel} has the time of the copy (${new Date(time(c, rel)).toISOString()}), not MTIME`)
		}
		assert.equal(time(c, 'js/same.mjs'), mtime, 'P9 step 3: the unchanged file keeps MTIME')
		assert.equal(text(c, 'js/new.mjs'), release['js/new.mjs'], 'P9 step 3: the new file is there')
		assert.ok(!fs.existsSync(path.join(c.app, 'js/gone.mjs')), 'P9 step 3: the file only in the app folder is gone')
		// counter-check: rsync -a (with -t) copies the new content but leaves the old MTIME, so opcache and APCu miss it
		c = setup(release, installed)
		run('rsync -a --delete --checksum "$tmp"/knorke/ <prod>/nextcloud_html/custom_apps/knorke/', c)
		for (const rel of changed) {
			assert.equal(text(c, rel), release[rel], `rsync -a: ${rel} has the new content`)
			assert.equal(time(c, rel), mtime, `rsync -a: ${rel} keeps MTIME`)
		}

		// b) hotfix step 4: from the four H1 lines of the doc, a size change exactly where the line has "s"
		assert.equal(h1Block.length, 4, 'four H1 lines')
		const before = {}, after = {}
		for (const line of h1Block) {
			const [, flags, rel] = /^(>fc\S{8}) (\S+)$/.exec(line) || []
			assert.ok(flags, `"${line}" is a changed file`)
			before[rel] = `old ${rel}\n`
			after[rel] = flags[3] === 's' ? `new and longer ${rel}\n` : `new ${rel}\n`
		}
		c = setup(after, before)
		assert.deepEqual(run(dry, c), h1Block, 'the dry run of hotfix step 4 prints exactly the four H1 lines')
		for (const rel of Object.keys(before)) assert.equal(text(c, rel), before[rel], `the dry run leaves ${rel} as it is`)
		assert.deepEqual(run(real, c), h1Block, 'the real run of hotfix step 4 prints the same four lines')
		for (const rel of Object.keys(after)) assert.equal(text(c, rel), after[rel], `the real run copies ${rel}`)
	} finally {
		if (root.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'kdrsync-'))) fs.rmSync(root, { recursive: true, force: true })
	}
})

test('the README and the docs it links name no private host value (lib/privateValues.mjs)', () => {
	for (const f of ['README.md', 'docs/FEATURES.md', 'docs/ADMIN.md', 'THIRD-PARTY.md', 'SECURITY.md']) {
		const md = read(f)
		// no host name or address of this installation (the private domain is known only by its digest, lib/privateValues.mjs)
		assert.doesNotMatch(md, /\.home\./, f)
		assert.deepEqual(scanText(md), [], `${f} names no private host value`)
	}
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
	// PROTOKOLL: §1 header paragraph, the one 200 row of §2
	const proto = read('docs/PROTOKOLL.md')
	assert.ok((proto.split('\n').find((l) => l.startsWith('**Header.**')) || '').includes(hv), `PROTOKOLL **Header.** names ${hv}`)
	const rows2 = section('docs/PROTOKOLL.md', '## 2. Fehler').split('\n')
	const rows200 = rows2.filter((l) => l.startsWith('| 200 |'))
	assert.equal(rows200.length, 1, 'PROTOKOLL §2 has exactly one 200 row')
	for (const c of E) assert.ok(rows200[0].includes(`\`${c}\``), `PROTOKOLL §2, 200 row names ${c}`)
	// every code of END_STATES stands in backticks in the client column
	const client = rows200[0].split('|').at(-2) || ''
	for (const c of E) assert.ok(client.includes(`\`${c}\``), `PROTOKOLL §2, client column of the 200 row names ${c}`)
	// SPEC-M1: §4.2, §4.5 and §6.4 (each up to the next ### heading)
	const spec = read('docs/SPEC-M1.md')
	const sub = (h) => {
		const i = spec.indexOf(`\n${h}`)
		assert.ok(i >= 0, `SPEC-M1 has ${h.trim()}`)
		const j = spec.indexOf('\n### ', i + 1)
		return spec.slice(i, j < 0 ? spec.length : j)
	}
	for (const h of ['### 4.2 ', '### 4.5 ', '### 6.4 ']) assert.ok(sub(h).includes(hv), `SPEC-M1 ${h.trim()} names ${hv}`)
	const s42 = sub('### 4.2 ')
	for (const c of E) assert.ok(s42.includes(`\`${c}\``), `SPEC-M1 §4.2 names ${c}`)
	// §8.3: one C87 row; the contract has the case
	const lines = spec.split('\n')
	assert.equal(lines.filter((l) => l.startsWith('| **(R39)** C87 |')).length, 1, 'SPEC-M1 §8.3 has exactly one C87 row')
	assert.ok(read('dev/sim/contract.mjs').includes("C('C87'"), 'dev/sim/contract.mjs has C87')
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

	// 1. route 27: the last line of routes.php; one §4.1 row with the limits of PrivacyNotice.php; one body-key row (= the keys the controller reads)
	assert.ok(read('appinfo/routes.php').includes("['name' => 'settingsApi#update', 'url' => '/api/v1/settings/privacy', 'verb' => 'PUT'],"), 'appinfo/routes.php has route 27')
	const r27 = lines.flatMap((l, k) => (l.startsWith('| **(R40)** 27 | `settingsApi#update` | PUT | `/api/v1/settings/privacy` |') ? [k] : []))
	assert.equal(r27.length, 1, 'SPEC-M1 §4.1 has exactly one row for route 27')
	for (const x of [`${TEXT_MAX} Codepunkte`, `${LANGUAGES_MAX} Sprachen`]) assert.ok(lines[r27[0]].includes(x), `the route-27 row names ${x}`)
	assert.equal(lines.filter((l) => l.startsWith('| **(R40)** settings (27) | `default`, `languages` |')).length, 1, 'one body-key row for route 27')
	assert.ok(read('lib/Controller/SettingsApiController.php').includes("JsonBody::read($this->request, ['default', 'languages'])"), 'the controller reads exactly these body keys')

	// 2. §4.11.3: the key list of PageController.php word for word
	const keys = read('lib/Controller/PageController.php').match(/public const INITIAL_STATE_KEYS = (\[[^\]]*\]);/)?.[1]
	assert.ok(keys, 'PageController.php declares INITIAL_STATE_KEYS')
	const s4113 = sub('#### 4.11.3 ', '#### 4.11.4 ')
	assert.ok(s4113.includes(`\`INITIAL_STATE_KEYS = ${keys};\``), `§4.11.3 states INITIAL_STATE_KEYS = ${keys}`)

	// 3. board.linkOpenSince: SPEC-M1 §4.4 and PROTOKOLL §4; the account snapshot sets it, the guest controller never
	assert.ok(sub('### 4.4 ', '### 4.5 ').includes('linkOpenSince'), '§4.4 names linkOpenSince')
	assert.ok(section('docs/PROTOKOLL.md', '## 4. Snapshot').includes('`board.linkOpenSince`'), 'PROTOKOLL §4 names `board.linkOpenSince`')
	assert.ok(read('lib/Controller/SyncController.php').includes("$meta['linkOpenSince'] = "), 'route 12 sets linkOpenSince')
	assert.ok(!read('lib/Controller/PublicSyncController.php').includes('linkOpenSince'), 'routes 14 and 15 do not')

	// 4. §6.6: the components, the scrolling text and both storage keys (as src/util/storage.js builds them)
	const s66 = sub('### 6.6 ', '### 6.7 ')
	for (const x of ['30vh', '`PrivacyInfo.vue`', '`AdminSettings.vue`', 'link-badge', 'knorke.privacy.<boardId>', 'knorke.linkInfo.<boardId>.<pid>']) {
		assert.ok(s66.includes(x), `§6.6 names ${x}`)
	}
	const storage = read('src/util/storage.js')
	assert.ok(storage.includes("privacy: (boardId) => 'knorke.privacy.' + boardId,") && storage.includes("linkInfo: (boardId, pid) => 'knorke.linkInfo.' + boardId + '.' + pid,"), 'storage.js builds both keys')
	assert.match(read('src/styles/knorke.css'), /\.knorke-dialog__privacy-text \{\n\tmax-height: 30vh;/, 'only the notice text scrolls, at most 30vh')

	// 5. §6.8: the hooks, each set in one of the four components; every data-knorke attribute of the (R40) rows exists there
	const s68 = sub('### 6.8 ', '### 6.9 ')
	// job 281: the notice fields moved to NoticeFields.vue
	const code = ['src/admin/AdminSettings.vue', 'src/admin/NoticeFields.vue', 'src/components/PrivacyInfo.vue', 'src/components/TopBar.vue', 'src/components/GuestNameDialog.vue'].map(read).join('\n')
	for (const h of ['privacy-notice', 'data-knorke-privacy-text', 'privacy-info', 'data-knorke-privacy-kind', 'data-knorke-privacy-link', 'link-badge', 'privacy-close', 'data-knorke-admin',
		'privacy-url', 'privacy-language', 'privacy-add-language', 'privacy-remove-language', 'privacy-save']) {
		assert.ok(s68.includes(h), `§6.8 names ${h}`)
		// job 281 (design A3): one save bar (admin-save) replaced privacy-save; §6.8 is frozen as the state of 0.3.0
		if (h !== 'privacy-save') assert.ok(code.includes(h), `the code sets ${h}`)
	}
	const r40 = s68.split('\n').filter((l) => l.startsWith('| **(R40)**'))
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

	// 7. docs/ADMIN.md: the paragraph under Settings names the limits of PrivacyNotice.php
	const settings = section('docs/ADMIN.md', '## Settings')
	const paras = settings.split(/\n\s*\n/).filter((p) => p.startsWith('**Privacy notice for guests.**'))
	assert.equal(paras.length, 1, 'docs/ADMIN.md Settings has one paragraph "Privacy notice for guests."')
	const flat = paras[0].replace(/\s+/g, ' ')
	for (const x of [`${TEXT_MAX} characters`, `${LANGUAGES_MAX} languages`]) assert.ok(flat.includes(x), `the paragraph names ${x}`)
})

test('local values: the same three keys in dev/local.env.example, dev/lib.sh and the tables of ENTWICKLUNG §3.10 and §3.2; the KD_DNS row of §3.2 has no IP address (factory job 036, SPEC-M1 §12.1 R16)', () => {
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
	assert.deepEqual([...p310.matchAll(/^\| `(KD_[A-Z_]+)` \|/gm)].map((m) => m[1]).sort(), KEYS, 'keys of the table in §3.10')
	assert.ok(p310.includes('dev/local.env.example'), '§3.10 names the template')
	const p32 = dev.slice(dev.indexOf('### 3.2 '), dev.indexOf('### 3.3 '))
	for (const k of KEYS) assert.equal(p32.split('\n').filter((l) => l.startsWith(`| \`${k}\` |`)).length, 1, `§3.2 has one row for ${k}`)
	const dns = p32.split('\n').find((l) => l.startsWith('| `KD_DNS` |')) || ''
	assert.doesNotMatch(dns, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no IP address in the KD_DNS row')
})
