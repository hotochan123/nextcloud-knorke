/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Static self-test of .github/workflows/ci.yml (SPEC-M1 §8.9), without a YAML
 * library: CI runs only once the user pushes the repository, until then this
 * test guards the workflow file.
 *
 * - SPDX header
 * - permissions: contents: read on workflow level, nothing writes; the only
 *   triggers are push and pull_request (never pull_request_target: the
 *   repository becomes public)
 * - every `uses:` pinned to a 40-character commit SHA
 * - the PHPUnit PHAR: same version and SHA-256 as tests/php/run.sh,
 *   --fail-on-skipped, NEXTCLOUD_ROOT, php -l over lib tests appinfo templates
 * - the matrix: stable34 × PHP 8.2 and 8.5, stable35 × PHP 8.3 and 8.5, and
 *   it covers the Nextcloud and PHP range of appinfo/info.xml
 * - the frontend job: Node 22.18.0, npm ci, (R16) `npm audit --omit=dev
 *   --audit-level=low` right after npm ci (SPEC-M1 §8.9 names the same
 *   command; WP-D3, point 2a of §27), every `npm run <x>` / `npm test`
 *   is a script of package.json, in the order l10n:check → build → test, the
 *   harness self-tests with the four quoted globs of SPEC-M1 §8.9 (R6: plus
 *   the scene lab's dev/scene-lab/test/) after a check of jq and flock,
 *   node --check and bash -n, xmllint against the App Store schema
 * - every glob of the self-test command finds test files (a renamed folder
 *   would otherwise drop its tests from CI unnoticed), and SPEC-M1 §8.9 and
 *   docs/ENTWICKLUNG.md name the same command
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// KD_CI_YML=<path> runs the same checks against another copy (mutation runs)
const CI = process.env.KD_CI_YML ? path.resolve(process.env.KD_CI_YML) : path.join(ROOT, '.github/workflows/ci.yml')
const yml = fs.readFileSync(CI, 'utf8')
const lines = yml.split('\n')
// The audit step of SPEC-M1 §8.9 (R16): runtime dependencies only, every severity.
const AUDIT = 'npm audit --omit=dev --audit-level=low'
// The harness self-tests of SPEC-M1 §8.9 (R6: with the scene lab's own tests).
const SELFTESTS = "node --test 'dev/sim/*.test.mjs' 'dev/e2e/*.test.mjs' 'dev/selftest/*.test.mjs' 'dev/scene-lab/test/*.test.mjs'"

/** Lines of the top-level block `key:` (up to the next unindented key). */
function topBlock(key) {
	const i = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `))
	assert.ok(i >= 0, `top-level key ${key}`)
	const out = [lines[i]]
	for (let j = i + 1; j < lines.length; j++) {
		if (/^[^\s#]/.test(lines[j])) break
		out.push(lines[j])
	}
	return out
}

/** Text of one job (from `  <name>:` under jobs to the next job). */
function job(name) {
	const jobs = topBlock('jobs')
	const i = jobs.findIndex((l) => l === `  ${name}:`)
	assert.ok(i >= 0, `job ${name}`)
	const out = []
	for (let j = i; j < jobs.length; j++) {
		if (j > i && /^ {2}[a-z]/.test(jobs[j])) break
		out.push(jobs[j])
	}
	return out.join('\n')
}

/** `run:` commands of a job in order (single line and block form), without comments. */
function runs(text) {
	const out = []
	const ls = text.split('\n')
	for (let i = 0; i < ls.length; i++) {
		const m = /^(\s*)(?:- )?run: (.*)$/.exec(ls[i])
		if (!m) continue
		if (m[2] !== '|') { out.push(m[2].trim()); continue }
		const ind = ls[i + 1]?.match(/^\s*/)[0].length ?? 0
		const block = []
		for (let j = i + 1; j < ls.length && (ls[j].trim() === '' || ls[j].match(/^\s*/)[0].length >= ind); j++) block.push(ls[j].trim())
		out.push(block.join('\n').trim())
	}
	return out
}

test('SPDX header', () => {
	assert.equal(lines[0], '# SPDX-FileCopyrightText: 2026 hotochan123')
	assert.equal(lines[1], '# SPDX-License-Identifier: AGPL-3.0-or-later')
})

test('permissions: contents read on workflow level, nothing writes', () => {
	const perm = topBlock('permissions').filter((l) => l.trim() && !l.trim().startsWith('#'))
	assert.deepEqual(perm, ['permissions:', '  contents: read'])
	assert.ok(yml.indexOf('\npermissions:') < yml.indexOf('\njobs:'), 'before the jobs')
	assert.doesNotMatch(yml.replace(/#.*$/gm, ''), /:[ \t]*write\b/, 'no write permission anywhere')
	assert.doesNotMatch(yml.replace(/#.*$/gm, ''), /^[ \t]+permissions:/m, 'no job widens the permissions')
	assert.doesNotMatch(yml.replace(/#.*$/gm, ''), /\$\{\{\s*secrets\./, 'no secret is used')
})

test('triggers: only push and pull_request, never pull_request_target', () => {
	const on = topBlock('on').filter((l) => l.trim() && !l.trim().startsWith('#'))
	const keys = on.slice(1).filter((l) => /^ {2}[a-z_]+:/.test(l)).map((l) => l.trim().replace(/:.*$/, ''))
	assert.deepEqual(keys.sort(), ['pull_request', 'push'])
	assert.doesNotMatch(yml.replace(/#.*$/gm, ''), /pull_request_target|workflow_run|issue_comment/)
})

test('every action is pinned to a 40-character commit SHA', () => {
	const uses = lines.filter((l) => /^\s*(- )?uses:/.test(l))
	assert.ok(uses.length >= 5, `uses lines found (${uses.length})`)
	for (const l of uses) assert.match(l, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}( # v?\d[\w.]*)?$/, l.trim())
})

test('the PHPUnit PHAR equals tests/php/run.sh (version, SHA-256), --fail-on-skipped, NEXTCLOUD_ROOT, php -l', () => {
	const run = fs.readFileSync(path.join(ROOT, 'tests/php/run.sh'), 'utf8')
	const ver = run.match(/^PHPUNIT_VERSION="([^"]+)"$/m)[1]
	const sha = run.match(/^PHPUNIT_SHA256="([0-9a-f]{64})"$/m)[1]
	const php = job('php')
	assert.equal(php.match(/^\s+PHPUNIT_VERSION: (\S+)$/m)?.[1], ver)
	assert.equal(php.match(/^\s+PHPUNIT_SHA256: ([0-9a-f]{64})$/m)?.[1], sha)
	const cmds = runs(php)
	assert.ok(cmds.some((c) => c.includes('https://phar.phpunit.de/phpunit-${PHPUNIT_VERSION}.phar') && /sha256sum -c -/.test(c)), 'download checked with sha256sum -c')
	assert.ok(cmds.some((c) => /^php \/tmp\/phpunit\.phar -c phpunit\.xml --fail-on-skipped$/.test(c)), 'phpunit with --fail-on-skipped')
	assert.match(php, /^\s+NEXTCLOUD_ROOT: \$\{\{ github\.workspace \}\}\/server$/m)
	assert.ok(cmds.some((c) => /^find lib tests appinfo templates -name '\*\.php' -print0 \| xargs -0 -n1 php -l/.test(c)), 'php -l over lib tests appinfo templates')
	assert.match(php, /path: server\/apps\/knorke$/m, 'the app lives under server/apps/knorke')
	assert.match(php, /repository: nextcloud\/server[\s\S]*submodules: true/, 'server checkout with submodules')
})

test('matrix: stable34 × PHP 8.2/8.5, stable35 × PHP 8.3/8.5, covering info.xml', () => {
	const php = job('php')
	const pairs = [...php.matchAll(/- server: (stable\d+)\n\s+php: '([\d.]+)'/g)].map((m) => `${m[1]}/${m[2]}`)
	assert.deepEqual(pairs.sort(), ['stable34/8.2', 'stable34/8.5', 'stable35/8.3', 'stable35/8.5'])
	const info = fs.readFileSync(path.join(ROOT, 'appinfo/info.xml'), 'utf8')
	const nc = info.match(/<nextcloud min-version="(\d+)" max-version="(\d+)"\/>/)
	const pv = info.match(/<php min-version="([\d.]+)" max-version="([\d.]+)"\/>/)
	for (let v = Number(nc[1]); v <= Number(nc[2]); v++) assert.ok(pairs.some((p) => p.startsWith(`stable${v}/`)), `Nextcloud ${v} (info.xml) in the matrix`)
	assert.ok(pairs.some((p) => p.endsWith(`/${pv[1]}`)) && pairs.some((p) => p.endsWith(`/${pv[2]}`)), `PHP ${pv[1]} and ${pv[2]} (info.xml) in the matrix`)
})

test('frontend job: Node 22.18.0, npm commands equal package.json scripts, harness self-tests, syntax, xmllint', () => {
	const fe = job('frontend')
	assert.match(fe, /node-version: 22\.18\.0$/m)
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
	const cmds = runs(fe)
	const npm = cmds.filter((c) => /^npm /.test(c))
	for (const c of npm) {
		if (c === AUDIT) continue
		const m = /^npm (?:run ([\w:-]+)|(test)|(ci))$/.exec(c)
		assert.ok(m, `plain npm command: ${c}`)
		const script = m[1] || m[2]
		if (script) assert.ok(script in pkg.scripts, `${c} is a script of package.json`)
	}
	assert.deepEqual(npm, ['npm ci', AUDIT, 'npm run l10n:check', 'npm run build', 'npm test'], 'order: ci → audit (R16) → l10n:check → build (with check-bundle) → test')
	assert.match(pkg.scripts.build, /build\/check-bundle\.mjs/, 'npm run build includes the bundle check')
	const selftests = cmds.indexOf(SELFTESTS)
	assert.ok(selftests >= 0, 'harness self-tests with the four quoted globs of SPEC-M1 §8.9')
	const tools = cmds.findIndex((c) => /\bjq --version\b/.test(c) && /\bflock --version\b/.test(c))
	assert.ok(tools >= 0 && tools < selftests, 'jq and flock (needed by the self-tests, no Docker daemon needed) are checked before them')
	const syntax = cmds.find((c) => c.includes('node --check'))
	assert.ok(syntax && /find dev build tests/.test(syntax) && /'\*\.mjs'/.test(syntax) && /'\*\.js'/.test(syntax), 'node --check over .mjs/.js in dev, build, tests')
	assert.ok(syntax && /-name '\*\.sh'[\s\S]*bash -n/.test(syntax), 'bash -n over every .sh')
	const xml = cmds.find((c) => c.includes('xmllint'))
	assert.ok(xml && /https:\/\/apps\.nextcloud\.com\/schema\/apps\/info\.xsd/.test(xml) && /xmllint --noout --schema \S+ appinfo\/info\.xml/.test(xml) && /libxml2-utils/.test(xml), 'info.xml against info.xsd with xmllint (apt)')
	assert.match(fe, /runs-on: ubuntu-latest/)
})

test('every glob of the harness self-tests finds test files; SPEC-M1 §8.9 and ENTWICKLUNG name the same command', () => {
	const globs = [...SELFTESTS.matchAll(/'([^']+)'/g)].map((m) => m[1])
	assert.deepEqual(globs, ['dev/sim/*.test.mjs', 'dev/e2e/*.test.mjs', 'dev/selftest/*.test.mjs', 'dev/scene-lab/test/*.test.mjs'])
	for (const g of globs) {
		// only the form <folder>/*.test.mjs (node --test expands it itself)
		const m = /^([\w/-]+)\/\*\.test\.mjs$/.exec(g)
		assert.ok(m, `simple glob: ${g}`)
		const dir = path.join(ROOT, m[1])
		const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')) : []
		assert.ok(files.length > 0, `${g} finds test files`)
	}
	assert.ok(fs.readFileSync(path.join(ROOT, 'docs/SPEC-M1.md'), 'utf8').includes('`' + SELFTESTS), 'SPEC-M1 §8.9 names the command')
	const dev = fs.readFileSync(path.join(ROOT, 'docs/ENTWICKLUNG.md'), 'utf8')
	assert.ok(dev.includes('`' + SELFTESTS + '`'), 'docs/ENTWICKLUNG.md §5 names the command')
})

test('R16: npm audit of the runtime dependencies right after npm ci, as SPEC-M1 §8.9 names it', () => {
	const fe = job('frontend')
	const cmds = runs(fe)
	const ci = cmds.indexOf('npm ci')
	assert.ok(ci >= 0, 'npm ci')
	assert.equal(cmds[ci + 1], AUDIT, 'the very next command is the audit')
	assert.equal(cmds.filter((c) => /^npm audit\b/.test(c)).length, 1, 'exactly one audit step')
	assert.doesNotMatch(fe.replace(/#.*$/gm, ''), /continue-on-error/, 'a finding fails the job')
	// SPEC-M1 §8.9: the frontend job line names the step in this order
	const spec = fs.readFileSync(path.join(ROOT, 'docs/SPEC-M1.md'), 'utf8')
	const s89 = spec.slice(spec.indexOf('### 8.9 CI'), spec.indexOf('### 8.10'))
	assert.ok(s89.length > 100, 'SPEC-M1 §8.9 found')
	const line = s89.split('\n').find((l) => l.startsWith('- **Job `frontend`**'))
	assert.ok(line, 'SPEC-M1 §8.9 has the frontend job line')
	const at = (x) => line.indexOf(x)
	assert.ok(at('`npm ci`') > 0 && at('`' + AUDIT + '`') > at('`npm ci`') && at('`npm run l10n:check`') > at('`' + AUDIT + '`'), 'SPEC-M1 §8.9: npm ci → audit → l10n:check')
})
