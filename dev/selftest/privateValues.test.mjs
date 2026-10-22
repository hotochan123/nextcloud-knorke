/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * No private host values in the public tree (SPEC-M1 §12.1 R16,
 * docs/ENTWICKLUNG.md §3.10; lib/privateValues.mjs):
 * - this repository: every file git would publish (tracked, or untracked and
 *   not ignored), without factory/ and .claude/, has none of the three
 *   generic patterns and not the private domain (known only by its SHA-256),
 *   neither in its path nor in its content; README.md and dev/lib.sh are
 *   among the checked files, so an empty run never passes
 * - the scan on a throwaway git repository, with the generic patterns and a
 *   made-up domain private-host.example given by its digest: hits in tracked
 *   and in untracked files, in upper case, in a subdomain and in a file name
 *   are reported with file, line and pattern; ignored files, factory/,
 *   .claude/, deleted files, symlinks and neutral values are not; a folder
 *   without git fails loudly
 * - the dot as a regular expression writes it: the made-up domain with \.,
 *   \\. or \\\\. (one, two or four backslashes), [.] or [\.] for each dot,
 *   also as an upper-case subdomain, is one domain hit; a backslash without
 *   a dot, [,] or a longer last label is none
 * - the git variables of a calling hook (GIT_REDIRECT_VARS, one frozen list
 *   for every git call of the self-tests) do not redirect scannedFiles
 * Every example with a generic hit is put together at run time, so this file
 * itself stays clean.
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { GIT_REDIRECT_VARS, PRIVATE_DOMAIN_DIGESTS, PRIVATE_PATTERNS, labelRuns, scanText, scanTree, scannedFiles, sha256 } from './lib/privateValues.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const show = (hits) => hits.map((h) => `${h.file}:${h.line} (${h.pattern})`)
/** No git variables of a calling hook may redirect the throwaway repository. */
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !GIT_REDIRECT_VARS.includes(k)))

test('the public tree has none of the private values (LAN address, host paths, the private domain)', () => {
	const files = scannedFiles(REPO)
	for (const f of ['README.md', 'dev/lib.sh']) assert.ok(files.includes(f), `${f} is among the ${files.length} checked files`)
	assert.ok(!files.some((f) => f.startsWith('factory/') || f.startsWith('.claude/')), 'factory/ and .claude/ are not checked')
	const hits = scanTree(REPO)
	assert.deepEqual(show(hits), [], `private host values (move them to dev/local.env or use a placeholder, docs/ENTWICKLUNG.md §3.10):\n${show(hits).join('\n')}`)
})

// The matching examples, built at run time (none of the generic ones appears in this source).
const IP = ['192', '168', '178', '5'].join('.')
const MNT = ['', 'mnt', 'user', 'x'].join('/')
const APPDATA = ['APPDATA', 'DOCKER'].join('/')
// A made-up private domain for the scan, given to it only as its digest.
const DOMAIN = 'private-host.example'
const CHECKS = { patterns: PRIVATE_PATTERNS, digests: [sha256(DOMAIN)] }
const DOMAIN_HIT = `domain sha256:${sha256(DOMAIN).slice(0, 12)}`

function git(cwd, ...args) {
	const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv() })
	assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
	return r.stdout
}

test('scanTree on a throwaway repo: tracked, untracked and file-name hits with file, line and pattern; not ignored files, factory/, .claude/, deleted files, symlinks or neutral values', (t) => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdpriv-')))
	t.after(() => {
		if (root.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'kdpriv-'))) fs.rmSync(root, { recursive: true, force: true })
	})
	git(root, 'init', '-q')
	const put = (rel, text) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
		fs.writeFileSync(path.join(root, rel), text)
	}
	// (a) tracked, one check each, also in upper case and as a subdomain
	put('a/ip.txt', `first line\nDNS ${IP} here\n`)
	put('a/mnt.sh', `cd ${MNT}/stacks\n`)
	put('a/appdata.md', `one\ntwo\npath ${APPDATA}/stacks\n`)
	put('a/host.mjs', `// https://nextcloud.lan.${DOMAIN}/index.php\n`)
	put('a/HOST.txt', `\n\n\n\nmail ADMIN@${DOMAIN.toUpperCase()}\n`)
	// neutral values: no hit
	put('a/neutral.txt', [
		'lan 192.168.1.20', 'path /srv/docker/stacks', 'bare /mnt', 'name appdata-docker',
		`x${DOMAIN}`, DOMAIN.replace('.', '-'), `${DOMAIN}s`, 'host.example', DOMAIN.split('.')[0], '',
	].join('\n'))
	// tracked, then deleted in the working tree: skipped
	put('a/gone.txt', `${IP}\n`)
	// a tracked symlink to a file with a hit: its content is not read
	fs.symlinkSync('ip.txt', path.join(root, 'a/link.txt'))
	// (d) factory/ and .claude/: not part of the public repository
	put('factory/x', `${IP}\n`)
	put('.claude/x', `${DOMAIN}\n`)
	// (e) hits in file names (line 0): the domain inside a longer token counts, it is readable there
	put(`e/${DOMAIN}.txt`, 'nothing in here\n')
	put(`e/${DOMAIN}.org-other`, 'nothing in here\n')
	// (c) ignored by .gitignore
	put('.gitignore', 'ignored.txt\n')
	put('ignored.txt', `${MNT} ${DOMAIN}\n`)
	git(root, 'add', '--', 'a', 'factory', '.claude', 'e', '.gitignore')
	fs.rmSync(path.join(root, 'a/gone.txt'))
	// (b) untracked, not ignored
	put('b.txt', `${APPDATA.toLowerCase()}\n`)

	const files = scannedFiles(root)
	assert.ok(files.includes('b.txt') && files.includes('a/ip.txt'), files.join(' '))
	assert.ok(!files.includes('ignored.txt') && !files.includes('factory/x') && !files.includes('.claude/x'), files.join(' '))
	const [ip, mnt, appdata] = PRIVATE_PATTERNS.map((re) => re.source)
	const got = scanTree(root, CHECKS).map((h) => `${h.file}:${h.line} ${h.pattern}`).sort()
	assert.deepEqual(got, [
		`a/HOST.txt:5 ${DOMAIN_HIT}`,
		`a/appdata.md:3 ${appdata}`,
		`a/host.mjs:1 ${DOMAIN_HIT}`,
		`a/ip.txt:2 ${ip}`,
		`a/mnt.sh:1 ${mnt}`,
		`b.txt:1 ${appdata}`,
		`e/${DOMAIN}.org-other:0 ${DOMAIN_HIT}`,
		`e/${DOMAIN}.txt:0 ${DOMAIN_HIT}`,
	].sort())
	// every hit has the three fields
	for (const h of scanTree(root, CHECKS)) assert.deepEqual(Object.keys(h).sort(), ['file', 'line', 'pattern'])
	// with this host's checks the made-up domain is no hit
	assert.ok(!scanTree(root).some((h) => h.pattern.startsWith('domain')), 'the default digests do not know the made-up domain')
})

test('the checks: three case-insensitive patterns without a hit in their own source, the domain only as a SHA-256; scannedFiles fails loudly outside a git repository', (t) => {
	assert.equal(PRIVATE_PATTERNS.length, 3)
	for (const re of PRIVATE_PATTERNS) {
		assert.ok(re.flags.includes('i'), `${re} ignores case`)
		for (const other of PRIVATE_PATTERNS) assert.equal(other.test(re.source), false, `${other} does not match the source of ${re}`)
	}
	assert.ok(PRIVATE_DOMAIN_DIGESTS.length >= 1 && PRIVATE_DOMAIN_DIGESTS.every((d) => /^[0-9a-f]{64}$/.test(d)), 'SHA-256 digests in hex')
	assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 of "abc"')
	assert.deepEqual([...labelRuns('Mail A@B.c.D-e, x')].sort(), ['b.c', 'b.c.d-e', 'c.d-e'], 'runs of two and more labels, lower case')
	assert.deepEqual(scanText(`cloud.${DOMAIN.toUpperCase()}`, CHECKS), [DOMAIN_HIT], 'any subdomain, any case')
	assert.deepEqual(scanText(`${DOMAIN}`, { patterns: [], digests: [] }), [], 'no checks, no hit')
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdpriv-nogit-')))
	t.after(() => {
		if (dir.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'kdpriv-nogit-'))) fs.rmSync(dir, { recursive: true, force: true })
	})
	const env = process.env.GIT_CEILING_DIRECTORIES
	process.env.GIT_CEILING_DIRECTORIES = path.dirname(dir)
	try {
		assert.throws(() => scanTree(dir), /git ls-files .* ist gescheitert/)
	} finally {
		if (env === undefined) delete process.env.GIT_CEILING_DIRECTORIES
		else process.env.GIT_CEILING_DIRECTORIES = env
	}
})

test('the dot as a regular expression writes it: \\., \\\\. (any number of backslashes), [.] and [\\.] count as a dot; a backslash without a dot, [,] and a longer last label do not', () => {
	// every example is built from the made-up domain at run time
	const spelled = (dot) => DOMAIN.replaceAll('.', dot)
	for (const [what, text] of [
		['one backslash', spelled('\\.')],
		['two backslashes (a JS or JSON string)', spelled('\\\\.')],
		['four backslashes', spelled('\\\\\\\\.')],
		['[.]', spelled('[.]')],
		['[\\.]', spelled('[\\.]')],
		['an upper-case subdomain, double-escaped', `cloud\\\\.${spelled('\\\\.')}`.toUpperCase()],
	]) {
		assert.ok(labelRuns(text).has(DOMAIN), `${what}: ${text}`)
		assert.deepEqual(scanText(text, CHECKS), [DOMAIN_HIT], `${what}: ${text}`)
	}
	for (const [what, text] of [
		['a backslash without a dot', spelled('\\')],
		['[,]', spelled('[,]')],
		['[.] and a longer last label', `${spelled('[.]')}s`],
	]) {
		assert.ok(!labelRuns(text).has(DOMAIN), `${what}: ${text}`)
		assert.deepEqual(scanText(text, CHECKS), [], `${what}: ${text}`)
	}
	assert.ok(labelRuns('a\\\\.b').has('a.b'), 'two backslashes before the dot')
})

test('GIT_REDIRECT_VARS: one frozen list of the git variables a calling hook sets; scannedFiles is not redirected by them', (t) => {
	assert.ok(Object.isFrozen(GIT_REDIRECT_VARS), 'frozen')
	// the names built at run time: only lib/privateValues.mjs spells them out below dev/
	const names = ['DIR', 'WORK_TREE', 'INDEX_FILE', 'COMMON_DIR'].map((s) => `GIT_${s}`)
	assert.deepEqual([...GIT_REDIRECT_VARS], names)
	const [gitDir, , indexFile] = names
	// paths of no repository in a fresh folder of this test: git would fail if it followed them
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdpriv-gitvars-')))
	t.after(() => {
		if (dir.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'kdpriv-gitvars-'))) fs.rmSync(dir, { recursive: true, force: true })
	})
	const saved = Object.fromEntries([gitDir, indexFile].map((k) => [k, process.env[k]]))
	process.env[gitDir] = path.join(dir, 'no-git-dir')
	process.env[indexFile] = path.join(dir, 'no-index')
	try {
		assert.ok(scannedFiles(REPO).includes('README.md'), 'README.md is still listed')
	} finally {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
		}
	}
})
