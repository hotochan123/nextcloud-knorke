/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * dev/release.sh (SPEC-M1 §10 P9, Revision 19 T4-08), without the real
 * bundle: the script runs from a throwaway repo tree under os.tmpdir() with a
 * fake build/check-fresh.mjs, runtime folders and everything a release must
 * NOT carry (dev/, tests/, node_modules/, src/, build/, docs/, tools/, the
 * check companion js/knorke-style.fresh.json, a stray appinfo/signature.json,
 * root build files, a symlink).
 * - the lists in the script are exactly those of §10 P9, EXCLUDE also drops
 *   appinfo/signature.json, the signing image is nextcloud:34-apache
 * - check-fresh not green (exit ≠ 0, or "n differing" with n > 0) → exit 1,
 *   nothing written; also when its CSS line (T4-26) is missing or reports a
 *   missing entry, even with exit 0 (ask of [C], stage 4 phase 1)
 * - green: dev/release/out/knorke-<version>/ holds exactly the runtime
 *   files, the archive the folder knorke/ with the same files, the .sha256
 *   matches, and a second run gives the same archive bytes; no docker call
 * Signing mode (factory job 047, docs/ENTWICKLUNG.md §5.8, §11): a fake docker
 * first on PATH logs every call and, for integrity:sign-app, writes
 * appinfo/signature.json into the host folder mounted at /app (exit codes and
 * leaving the file out come from the env); the key is a real RSA-2048 key
 * with a self-signed certificate CN=knorke in a temp folder outside the tree,
 * openssl is the real one.
 * - usage: every other form, a missing key or certificate, a key in the tree
 *   (also through a symlink outside) → exit 2, nothing written, no docker
 *   call, no line of the key on stderr
 * - --key/--cert: the unsigned release has the same bytes as without
 *   arguments; signed/knorke-<version>/ is the release plus
 *   appinfo/signature.json, its archive, .sha256 and .sig; stdout is the
 *   .sig, which openssl verifies with the certificate's public key
 * - exactly two docker runs (sign-app with key and certificate as read-only
 *   single files, then check-app without the key), no network, never the
 *   tree or the key's folder; the key's content is in no file of the tree
 * - sign-app or check-app failing, no signature.json, check-fresh red →
 *   exit 1, no signed path of the version, empty stdout, the unsigned
 *   release stays; a run without arguments leaves signed/ byte for byte
 * - the host checks the container's work: an extra, linked, changed or
 *   removed file (listed on stderr) or a private key in the signed tree →
 *   exit 1 before check-app; a private key in a runtime folder → exit 1
 *   before any docker call, named by its source path (signing mode only; a
 *   run without arguments stays as it was)
 * - the signed outputs are 0644/0755 also under umask 000, and a setgid bit
 *   the container set on a folder does not reach the archive
 * - factory job 065: the list of differences shows at most 20 lines, then
 *   "… (gekürzt)" only if there are more (FAKE_SIGN_EXTRA=files:<n> adds n
 *   files, 2n lines), then the FEHLER line, exit 1; an existing signed/ with
 *   mode 2777 stays so after a run without arguments and is 0755 after a
 *   signing run
 * P7-C (SPEC-M1 §33.1 k, ED-31), on the REAL tree (no build, no Docker; no
 * new abort in dev/release.sh): no runtime folder holds a file named
 * cron.php, public.php, remote.php or status.php (P7-05), and the real
 * appinfo/info.xml names no version or milestone in its two descriptions (en
 * and de; since factory job 050), never M0 or "not for production", and lists
 * OCA\Knorke\Command\Orphans in <commands> (P7-06, P7-02)
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = fs.readFileSync(path.join(REPO, 'dev', 'release.sh'), 'utf8')
const USAGE = 'usage: dev/release.sh [--key <privater Schlüssel> --cert <Zertifikat>]'

/** Runtime files of the fake tree (relative paths) – what a release must contain. */
const RUNTIME = [
	'appinfo/info.xml', 'appinfo/routes.php', 'lib/Service/A.php', 'templates/main.php', 'img/app.svg',
	'js/knorke-main.mjs', 'js/knorke-main.mjs.map', 'js/knorke-main.mjs.license', 'css/knorke-style.css',
	'l10n/de.json', 'l10n/de.js', 'LICENSE', 'README.md', 'CHANGELOG.md',
]
/** Files a release must never carry. */
const NEVER = [
	'js/knorke-style.fresh.json', 'appinfo/signature.json', 'src/main.js', 'tests/php/ATest.php', 'dev/up.sh', 'node_modules/x/index.js',
	'build/check-bundle.mjs', 'docs/ENTWICKLUNG.md', 'tools/phpunit.phar', 'composer.json', 'package.json',
	'package-lock.json', 'vite.config.js', 'phpunit.xml', '.htaccess', '.gitignore',
]
/** The files of the signed build: the runtime files plus the code signature. */
const SIGNED_FILES = [...RUNTIME, 'appinfo/signature.json'].sort()

/** A throwaway repo tree with dev/release.sh and a fake check-fresh (output and exit code from the env). */
function fakeRepo(t) {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdrel-')))
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	const w = (rel, body) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
		fs.writeFileSync(path.join(root, rel), body)
	}
	for (const f of [...RUNTIME, ...NEVER]) w(f, `x ${f}\n`)
	w('appinfo/info.xml', '<?xml version="1.0"?>\n<info>\n    <id>knorke</id>\n    <version>1.2.3</version>\n</info>\n')
	w('build/check-fresh.mjs', 'process.stdout.write((process.env.FAKE_FRESH ?? "check-fresh OK\\n  9 src/ entries in 3 maps, 0 differing, 0 missing\\n  css: 1 src/styles entries, 0 differing, 0 missing") + "\\n"); process.exit(Number(process.env.FAKE_RC ?? 0))\n')
	fs.copyFileSync(path.join(REPO, 'dev', 'release.sh'), path.join(root, 'dev', 'release.sh'))
	fs.copyFileSync(path.join(REPO, 'dev', 'lib.sh'), path.join(root, 'dev', 'lib.sh'))
	// a symlink inside a runtime folder never reaches the release
	fs.symlinkSync('../src/main.js', path.join(root, 'lib', 'link.js'))
	return root
}

/** The fake docker: one tab-separated line per call; for integrity:sign-app it writes appinfo/signature.json (mode 0600) into the folder mounted at /app, and with FAKE_SIGN_EXTRA also an extra, linked, changed or removed file, n extra files lib/extra-<i>.php (files:<n>, two manifest lines each), a private key or a setgid folder. */
const FAKE_DOCKER = `#!/usr/bin/env bash
set -u
args=("$@")
{ printf '%s' "\${args[0]-}"; for a in "\${args[@]:1}"; do printf '\\t%s' "$a"; done; printf '\\n'; } >>"$FAKE_DOCKER_LOG"
[ "\${args[0]-}" = run ] || exit 0
app="" mode=""
for ((i = 0; i < \${#args[@]}; i++)); do
    case "\${args[i]}" in
        -v) v="\${args[i + 1]}"; case "$v" in *:/app) app="\${v%:/app}" ;; *:/app:ro) app="\${v%:/app:ro}" ;; esac ;;
        integrity:sign-app) mode=sign ;;
        integrity:check-app) mode=check ;;
    esac
done
case "$mode" in
    sign)
        echo "Nextcloud is not installed - only a limited number of commands are available" >&2
        if [ "\${FAKE_SIGN_NOFILE:-}" != 1 ]; then (umask 077 && printf '{"hashes":{},"signature":"fake"}\\n' >"$app/appinfo/signature.json"); fi
        case "\${FAKE_SIGN_EXTRA:-}" in
            file) printf 'x\\n' >"$app/lib/extra.php" ;;
            files:*) for ((k = 1; k <= \${FAKE_SIGN_EXTRA#files:}; k++)); do printf 'x\\n' >"$app/lib/extra-$k.php"; done ;;
            link) ln -s ../appinfo/info.xml "$app/lib/info.php" ;;
            change) printf 'y\\n' >>"$app/lib/Service/A.php" ;;
            remove) rm -f "$app/lib/Service/A.php" ;;
            setgid) chmod g+s "$app/lib" ;;
            key) printf -- '-----BEGIN PRIVATE KEY-----\\nMIIfake\\n-----END PRIVATE KEY-----\\n' >"$app/appinfo/signature.json" ;;
        esac
        echo 'Successfully signed "/app"'
        exit "\${FAKE_SIGN_RC:-0}"
        ;;
    check)
        if [ "\${FAKE_CHECK_RC:-0}" != 0 ]; then echo "Certificate is not valid."; exit "$FAKE_CHECK_RC"; fi
        ;;
esac
exit 0
`

/** A fake docker first on PATH, with its log outside the tree: env for run(), calls() = the logged calls (arrays of arguments). */
function fakeDocker(t) {
	const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdbin-')))
	t.after(() => fs.rmSync(bin, { recursive: true, force: true }))
	fs.writeFileSync(path.join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 })
	const log = path.join(bin, 'docker.log')
	return {
		env: { PATH: `${bin}:${process.env.PATH}`, FAKE_DOCKER_LOG: log },
		calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')) : []),
	}
}

/** A real RSA-2048 key with a self-signed certificate CN=knorke, in a temp folder outside every tree (shared by the file). */
const KEYS = {}
before(() => {
	KEYS.dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdkey-')))
	KEYS.key = path.join(KEYS.dir, 'knorke.key')
	KEYS.crt = path.join(KEYS.dir, 'knorke.crt')
	KEYS.pub = path.join(KEYS.dir, 'knorke.pub')
	const r = spawnSync('openssl', ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-keyout', KEYS.key, '-out', KEYS.crt, '-subj', '/CN=knorke', '-days', '2'], { encoding: 'utf8' })
	assert.equal(r.status, 0, `openssl req: ${r.stderr}`)
	const pub = spawnSync('openssl', ['x509', '-in', KEYS.crt, '-pubkey', '-noout'], { encoding: 'utf8' })
	assert.equal(pub.status, 0, pub.stderr)
	fs.writeFileSync(KEYS.pub, pub.stdout)
	// the base64 lines of the key (no BEGIN/END line): none may show up anywhere
	KEYS.lines = fs.readFileSync(KEYS.key, 'utf8').split('\n').filter((l) => l && !l.startsWith('-----'))
	assert.ok(KEYS.lines.length > 10, 'the key has its base64 lines')
})
after(() => { if (KEYS.dir) fs.rmSync(KEYS.dir, { recursive: true, force: true }) })

const run = (root, env = {}, args = []) => spawnSync('bash', [path.join(root, 'dev', 'release.sh'), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 })
const signArgs = () => ['--key', KEYS.key, '--cert', KEYS.crt]
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const noKeyLine = (text, what) => {
	for (const l of KEYS.lines) assert.ok(!text.includes(l), `${what} holds no line of the key`)
}

/** Every file below dir (relative, sorted). */
function files(dir, rel = '') {
	return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
		const p = path.join(rel, e.name)
		return e.isDirectory() ? files(dir, p) : [p]
	}).sort()
}

/** The file entries of a .tar.gz (sorted). */
const tarList = (tgz) => spawnSync('tar', ['tzf', tgz], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l && !l.endsWith('/')).sort()

test('the lists of dev/release.sh are those of SPEC-M1 §10 P9 (R19): runtime folders, root files, the check companion and the code signature excluded; the signing image is fixed (AK1)', () => {
	assert.match(SCRIPT, /^RUNTIME_DIRS="appinfo lib templates img js css l10n"$/m)
	assert.match(SCRIPT, /^RUNTIME_FILES="LICENSE README\.md CHANGELOG\.md"$/m)
	assert.match(SCRIPT, /^EXCLUDE="js\/knorke-style\.fresh\.json appinfo\/signature\.json"$/m)
	assert.match(SCRIPT, /^SIGN_IMAGE="nextcloud:34-apache"$/m, 'the image of the signing container, no override')
	assert.equal((SCRIPT.match(/^SIGN_IMAGE=/gm) || []).length, 1, 'SIGN_IMAGE is set once')
	assert.match(SCRIPT, /^OUT="\$DEV\/release\/out"$/m)
	assert.ok(NEVER.includes('appinfo/signature.json'), 'the throwaway tree carries a signature.json the release must drop')
	const fresh = SCRIPT.indexOf('node build/check-fresh.mjs')
	assert.ok(fresh > 0 && fresh < SCRIPT.indexOf('cp -R --'), 'check-fresh before anything is copied')
	assert.ok(fresh < SCRIPT.indexOf('docker run'), 'check-fresh before any docker call')
	assert.match(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8'), /^\/dev\/release\/out\/$/m, 'the output is ignored by git')
	assert.match(fs.readFileSync(path.join(REPO, 'dev', 'm1-flow-exclude.txt'), 'utf8'), /^dev\/\*\/out$/m, 'and never flows back to $ROOT')
})

test('check-fresh not green → exit 1, nothing written', (t) => {
	for (const env of [{ FAKE_RC: '1' }, { FAKE_FRESH: 'check-fresh FAILED\n  9 src/ entries in 3 maps, 2 differing, 0 missing' }, { FAKE_FRESH: '  css: 1 src/styles entries, 1 differing, 0 missing\n  9 src/ entries, 0 differing' }]) {
		const root = fakeRepo(t)
		const r = run(root, env)
		assert.equal(r.status, 1, `${JSON.stringify(env)}: ${r.stderr}`)
		assert.ok(!fs.existsSync(path.join(root, 'dev', 'release', 'out', 'knorke-1.2.3')), 'no release directory')
	}
})

test('check-fresh without a green CSS line → exit 1, nothing written (R19 T4-26; a CSS-only change would go unseen)', (t) => {
	assert.match(SCRIPT, /grep -Eq '\^  css: \[0-9\]\+ src\/styles entries, 0 differing, 0 missing\$'/, 'release.sh requires the green CSS line')
	for (const env of [
		{ FAKE_FRESH: 'check-fresh OK\n  9 src/ entries in 3 maps, 0 differing, 0 missing, 0 without sourcesContent' },
		{ FAKE_FRESH: 'check-fresh OK\n  9 src/ entries in 3 maps, 0 differing, 0 missing, 0 without sourcesContent\n  css: 1 src/styles entries, 0 differing, 1 missing' },
		{ FAKE_FRESH: 'check-fresh OK\n  9 src/ entries in 3 maps, 0 differing, 0 missing\ncss: 1 src/styles entries, 0 differing, 0 missing' },
	]) {
		const root = fakeRepo(t)
		const r = run(root, env)
		assert.equal(r.status, 1, `${JSON.stringify(env)}: ${r.stderr}`)
		assert.match(r.stderr, /CSS-Zeile/)
		assert.ok(!fs.existsSync(path.join(root, 'dev', 'release', 'out', 'knorke-1.2.3')), 'no release directory')
	}
	// the real check-fresh output form (first line unchanged, the indented CSS line, a note line) passes
	const root = fakeRepo(t)
	const ok = run(root, { FAKE_FRESH: 'check-fresh OK\n  118 src/ entries in 3 maps, 0 differing, 0 missing, 0 without sourcesContent\n  css: 1 src/styles entries, 0 differing, 0 missing\n  note: in no map (no code of their own or not imported): src/scene/index.js' })
	assert.equal(ok.status, 0, ok.stderr)
})

test('green: exactly the runtime files (no signature.json), the archive with the folder knorke/, a matching .sha256, the same bytes twice, no docker call (AK1, AK3)', (t) => {
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	const r = run(root, dk.env)
	assert.equal(r.status, 0, r.stderr)
	const out = path.join(root, 'dev', 'release', 'out')
	const dest = path.join(out, 'knorke-1.2.3')
	assert.equal(r.stdout, `${dest}\n`, 'stdout is the path of the release directory, nothing else')
	assert.deepEqual(files(dest), [...RUNTIME].sort(), 'exactly the runtime files (no companion, no signature, no symlink)')
	for (const f of NEVER) assert.ok(!fs.existsSync(path.join(dest, f)), `${f} not in the release`)
	const tgz = path.join(out, 'knorke-1.2.3.tar.gz')
	const list = tarList(tgz)
	assert.deepEqual(list, RUNTIME.map((f) => `knorke/${f}`).sort(), 'archive: the folder knorke/ with the same files')
	assert.ok(!list.includes('knorke/appinfo/signature.json'), 'no signature.json in the archive')
	const sum = sha(tgz)
	assert.equal(fs.readFileSync(`${tgz}.sha256`, 'utf8'), `${sum}  knorke-1.2.3.tar.gz\n`, 'sha256sum format')
	const again = run(root, dk.env)
	assert.equal(again.status, 0, again.stderr)
	assert.equal(sha(tgz), sum, 'reproducible archive')
	assert.ok(!fs.existsSync(path.join(out, 'signed')), 'a run without arguments never creates signed/')
	assert.deepEqual(dk.calls(), [], 'no docker call without --key/--cert')
})

test('usage: every other form, a missing key or certificate, a key in the tree (also through a symlink) → exit 2 before anything is written or docker runs (AK2)', (t) => {
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	const K = KEYS.key
	const C = KEYS.crt
	// a key inside the tree, and a symlink outside the tree that points to it
	const inside = path.join(root, 'secret', 'knorke.key')
	fs.mkdirSync(path.dirname(inside))
	fs.copyFileSync(K, inside)
	const away = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdlnk-')))
	t.after(() => fs.rmSync(away, { recursive: true, force: true }))
	const link = path.join(away, 'knorke.key')
	fs.symlinkSync(inside, link)
	const missing = path.join(away, 'none.key')
	const forms = [['x'], ['--key'], ['--key', K], ['--cert', C], ['--key', K, '--cert', C, 'x'], ['--key', K, '--key', K, '--cert', C], [`--key=${K}`, `--cert=${C}`],
		['--cert', C, '--key'], ['--key', '', '--cert', C], ['--key', '--cert', '--cert', C], ['--cert', C, '--cert', C, '--key', K]]
	const unusable = [['--key', missing, '--cert', C], ['--key', K, '--cert', missing], ['--key', KEYS.dir, '--cert', C]]
	const inRepo = [['--key', inside, '--cert', C], ['--cert', C, '--key', link]]
	for (const [args, re] of [...forms.map((a) => [a, null]), ...unusable.map((a) => [a, /fehlt, ist keine reguläre Datei oder nicht lesbar/]), ...inRepo.map((a) => [a, /Schlüssel liegt im Repository/])]) {
		const r = run(root, dk.env, args)
		assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stderr}`)
		if (re) assert.match(r.stderr, re, JSON.stringify(args))
		else assert.equal(r.stderr, `${USAGE}\n`, `${JSON.stringify(args)}: only the usage line`)
		assert.equal(r.stdout, '', 'stdout stays empty')
		assert.ok(!fs.existsSync(path.join(root, 'dev', 'release', 'out')), `${JSON.stringify(args)}: no dev/release/out/`)
		assert.deepEqual(dk.calls(), [], `${JSON.stringify(args)}: no docker call`)
		noKeyLine(r.stderr, `stderr of ${JSON.stringify(args)}`)
	}
	// the key order is free: --cert before --key passes the checks
	const ok = run(root, dk.env, ['--cert', C, '--key', K])
	assert.equal(ok.status, 0, ok.stderr)
})

/** A signing run on a fresh tree: its paths, the result and the logged docker calls. */
function signRun(t, env = {}) {
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	const out = path.join(root, 'dev', 'release', 'out')
	const signed = path.join(out, 'signed')
	return { root, dk, out, signed, r: run(root, { ...dk.env, ...env }, signArgs()) }
}

test('signing run: the unsigned release has the same bytes as a run without arguments and no signature.json (AK3)', (t) => {
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	const tgz = path.join(root, 'dev', 'release', 'out', 'knorke-1.2.3.tar.gz')
	const plain = run(root, dk.env)
	assert.equal(plain.status, 0, plain.stderr)
	const plainSum = sha(tgz)
	const r = run(root, dk.env, signArgs())
	assert.equal(r.status, 0, r.stderr)
	assert.equal(sha(tgz), plainSum, 'same SHA-256 of dev/release/out/knorke-1.2.3.tar.gz')
	assert.equal(fs.readFileSync(`${tgz}.sha256`, 'utf8'), `${plainSum}  knorke-1.2.3.tar.gz\n`)
	assert.ok(!fs.existsSync(path.join(root, 'dev', 'release', 'out', 'knorke-1.2.3', 'appinfo', 'signature.json')), 'no signature.json in the unsigned release')
	assert.deepEqual(files(path.join(root, 'dev', 'release', 'out', 'knorke-1.2.3')), [...RUNTIME].sort())
})

test('signing run: signed/knorke-1.2.3/ with signature.json, its archive, .sha256 and .sig; stdout is the store signature openssl verifies (AK4)', (t) => {
	const { signed, r } = signRun(t)
	assert.equal(r.status, 0, r.stderr)
	const dir = path.join(signed, 'knorke-1.2.3')
	assert.deepEqual(files(dir), SIGNED_FILES, 'the runtime files plus appinfo/signature.json')
	assert.equal(fs.statSync(path.join(dir, 'appinfo', 'signature.json')).mode & 0o777, 0o644, 'modes normalised (the container wrote 0600)')
	const tgz = path.join(signed, 'knorke-1.2.3.tar.gz')
	assert.deepEqual(tarList(tgz), SIGNED_FILES.map((f) => `knorke/${f}`).sort(), 'archive: knorke/ with the same files')
	assert.equal(fs.readFileSync(`${tgz}.sha256`, 'utf8'), `${sha(tgz)}  knorke-1.2.3.tar.gz\n`, 'sha256sum format, matching')
	assert.ok(r.stdout.trim().length > 0, 'stdout is not empty')
	assert.equal(r.stdout, fs.readFileSync(`${tgz}.sig`, 'utf8'), 'stdout is exactly the .sig file')
	assert.match(r.stdout, /^[A-Za-z0-9+/=\n]+$/, 'base64 only')
	const sigBin = path.join(KEYS.dir, `sig-${process.pid}.bin`)
	t.after(() => fs.rmSync(sigBin, { force: true }))
	fs.writeFileSync(sigBin, Buffer.from(r.stdout.replace(/\n/g, ''), 'base64'))
	const v = spawnSync('openssl', ['dgst', '-sha512', '-verify', KEYS.pub, '-signature', sigBin, tgz], { encoding: 'utf8' })
	assert.equal(v.stdout.trim(), 'Verified OK', v.stderr)
	assert.match(r.stderr, /signiert: .*signed\/knorke-1\.2\.3 \(15 Dateien\).*nur für den App Store/, 'the log line on stderr')
})

test('signing run: exactly two docker runs, sign-app with key and certificate as read-only single files, then check-app without the key; no network; never the tree or the key folder; the key in no file (AK5)', (t) => {
	const { root, dk, signed, r } = signRun(t)
	assert.equal(r.status, 0, r.stderr)
	const calls = dk.calls()
	const runs = calls.filter((c) => c[0] === 'run')
	assert.equal(runs.length, 2, `two docker runs: ${JSON.stringify(calls)}`)
	assert.ok(calls.every((c) => c[0] === 'run' || (c[0] === 'rm' && c[1] === '-fv' && /^knorke-sign-\d+$/.test(c[2]))), 'besides the runs only the cleanup docker rm -fv knorke-sign-<pid>')
	const [sign, check] = runs
	assert.ok(sign.includes('integrity:sign-app') && !sign.includes('integrity:check-app'), 'first sign-app')
	assert.ok(check.includes('integrity:check-app') && !check.includes('integrity:sign-app'), 'then check-app')
	const mounts = (c) => c.flatMap((a, i) => (a === '-v' ? [c[i + 1]] : []))
	const dir = path.join(signed, 'knorke-1.2.3')
	for (const c of runs) {
		assert.ok(c.includes('--rm'), '--rm')
		assert.equal(c[c.indexOf('--network') + 1], 'none', '--network none')
		assert.ok(c.includes('nextcloud:34-apache'), 'the image')
		assert.equal(c[c.indexOf('--label') + 1], 'knorke=sign', 'label knorke=sign')
		assert.match(c[c.indexOf('--name') + 1], /^knorke-sign-\d+$/, 'name knorke-sign-<pid>')
		assert.equal(c[c.indexOf('--entrypoint') + 1], 'php')
		assert.ok(c.indexOf('nextcloud:34-apache') < c.indexOf('/usr/src/nextcloud/occ'), 'occ of the image')
		for (const m of mounts(c)) {
			const src = m.split(':')[0]
			assert.ok(src !== root && !root.startsWith(`${src}/`), `${m}: not the tree`)
			assert.notEqual(src, KEYS.dir, `${m}: not the folder of the key`)
		}
	}
	assert.deepEqual(mounts(sign).sort(), [`${dir}:/app`, `${KEYS.key}:/sign/knorke.key:ro`, `${KEYS.crt}:/sign/knorke.crt:ro`].sort(), 'sign-app: the signed folder, key and certificate read-only')
	assert.deepEqual(sign.slice(sign.indexOf('integrity:sign-app') + 1), ['--path=/app', '--privateKey=/sign/knorke.key', '--certificate=/sign/knorke.crt'])
	assert.deepEqual(mounts(check), [`${dir}:/app:ro`], 'check-app: only the signed folder, read-only, no key')
	assert.deepEqual(check.slice(check.indexOf('integrity:check-app') + 1), ['--path=/app', 'knorke'])
	// the key's content is in no file of the tree (archives unpacked), nor on stdout or stderr
	for (const f of files(root)) {
		let body = fs.readFileSync(path.join(root, f))
		if (f.endsWith('.tar.gz')) body = zlib.gunzipSync(body)
		noKeyLine(body.toString('latin1'), f)
	}
	noKeyLine(r.stdout + r.stderr, 'the output')
})

test('signing failures: sign-app exit 1, no signature.json, check-app exit 1, check-fresh red → exit 1, no signed path of the version, empty stdout (AK6)', (t) => {
	for (const [label, env] of [['a', { FAKE_SIGN_RC: '1' }], ['b', { FAKE_SIGN_NOFILE: '1' }], ['c', { FAKE_CHECK_RC: '1' }], ['d', { FAKE_RC: '1' }]]) {
		const { dk, out, signed, r } = signRun(t, env)
		assert.equal(r.status, 1, `(${label}): ${r.stderr}`)
		assert.equal(r.stdout, '', `(${label}): stdout stays empty`)
		const left = fs.existsSync(signed) ? fs.readdirSync(signed).filter((n) => n.startsWith('knorke-1.2.3')) : []
		assert.deepEqual(left, [], `(${label}): no dev/release/out/signed/knorke-1.2.3*`)
		const calls = dk.calls()
		if (label === 'd') {
			assert.deepEqual(calls, [], '(d): check-fresh red, docker is not called')
			assert.ok(!fs.existsSync(path.join(out, 'knorke-1.2.3')), '(d): nothing written')
			continue
		}
		for (const p of ['knorke-1.2.3', 'knorke-1.2.3.tar.gz', 'knorke-1.2.3.tar.gz.sha256']) assert.ok(fs.existsSync(path.join(out, p)), `(${label}): the unsigned ${p} stays`)
		assert.ok(calls.some((c) => c[0] === 'rm' && c[1] === '-fv' && /^knorke-sign-\d+$/.test(c[2])), `(${label}): the trap removes the container`)
		const checked = calls.some((c) => c.includes('integrity:check-app'))
		assert.equal(checked, label === 'c', `(${label}): check-app ${label === 'c' ? 'runs' : 'is not called'}`)
		if (label === 'c') assert.match(r.stderr, /Certificate is not valid\./, '(c): the output of check-app goes to stderr')
	}
})

test('the host checks the signed tree: an extra, linked, changed or removed file or a private key from the container → exit 1 before check-app, no signed path; a private key in a runtime folder → exit 1 before docker (rounds 1 and 2, security and UX review)', (t) => {
	const shown = {
		file: [/^> f \.\/lib\/extra\.php$/m],
		link: [/^> x \.\/lib\/info\.php$/m],
		change: [/^< [0-9a-f]{64}  \.\/lib\/Service\/A\.php$/m, /^> [0-9a-f]{64}  \.\/lib\/Service\/A\.php$/m],
		remove: [/^< f \.\/lib\/Service\/A\.php$/m],
	}
	for (const extra of ['file', 'link', 'change', 'remove', 'key']) {
		const { dk, out, signed, r } = signRun(t, { FAKE_SIGN_EXTRA: extra })
		assert.equal(r.status, 1, `${extra}: ${r.stderr}`)
		assert.equal(r.stdout, '', `${extra}: stdout stays empty`)
		if (extra === 'key') assert.match(r.stderr, /dev\/release\/out\/signed\/knorke-1\.2\.3\/appinfo\/signature\.json enthält einen privaten Schlüssel – kein signierter Bau/)
		else {
			assert.match(r.stderr, /der signierte Baum weicht vom Release ab \(außer appinfo\/signature\.json eine Datei geändert, hinzugefügt oder entfernt\)/, extra)
			for (const re of shown[extra]) assert.match(r.stderr, re, `${extra}: the differing manifest line is shown`)
		}
		assert.deepEqual(fs.readdirSync(signed).filter((n) => n.startsWith('knorke-1.2.3')), [], `${extra}: no signed path of the version`)
		assert.ok(!dk.calls().some((c) => c.includes('integrity:check-app')), `${extra}: check-app is not called`)
		assert.ok(fs.existsSync(path.join(out, 'knorke-1.2.3.tar.gz')), `${extra}: the unsigned release stays`)
	}
	// a second copy of a key in a runtime folder: refused before the key is mounted anywhere
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	fs.copyFileSync(KEYS.key, path.join(root, 'lib', 'knorke.pem'))
	const r = run(root, dk.env, signArgs())
	assert.equal(r.status, 1, r.stderr)
	assert.match(r.stderr, /FEHLER: lib\/knorke\.pem enthält einen privaten Schlüssel – aus dem Quellbaum entfernen\. Das unsignierte Release dev\/release\/out\/knorke-1\.2\.3\/ enthält ihn auch: nicht einspielen\. War er schon auf try oder Prod, gilt er als offengelegt/, 'the source path and what it means for the unsigned release')
	assert.deepEqual(dk.calls(), [], 'no docker call')
	assert.ok(!fs.existsSync(path.join(root, 'dev', 'release', 'out', 'signed', 'knorke-1.2.3')), 'no signed build')
	noKeyLine(r.stderr, 'stderr')
	// the run without arguments is unchanged by the spec (the scan belongs to the signing mode)
	assert.equal(run(root, dk.env).status, 0)
	// a scan that cannot read everything (grep exit 2) stops the run, it never counts as clean
	const clean = fakeRepo(t)
	const dk2 = fakeDocker(t)
	const realGrep = spawnSync('bash', ['-c', 'command -v grep'], { encoding: 'utf8' }).stdout.trim()
	const bin = dk2.env.PATH.split(':')[0]
	fs.writeFileSync(path.join(bin, 'grep'), `#!/usr/bin/env bash\nif [ "$1" = -rlE ]; then echo "grep: unreadable" >&2; exit 2; fi\nexec ${realGrep} "$@"\n`, { mode: 0o755 })
	const g = run(clean, dk2.env, signArgs())
	assert.equal(g.status, 1, g.stderr)
	assert.match(g.stderr, /die Suche nach privaten Schlüsseln in .*knorke-1\.2\.3 ist gescheitert \(grep endete mit 2\)/)
	assert.deepEqual(dk2.calls(), [], 'no docker call')
})

test('the signed outputs are 0644 and 0755 also under umask 000, and a setgid bit the container set on a folder is gone (round 2, security review)', (t) => {
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	const r = spawnSync('bash', ['-c', 'umask 000 && exec bash "$0" "$@"', path.join(root, 'dev', 'release.sh'), ...signArgs()], { encoding: 'utf8', env: { ...process.env, ...dk.env, FAKE_SIGN_EXTRA: 'setgid' }, timeout: 60000 })
	assert.equal(r.status, 0, r.stderr)
	const signed = path.join(root, 'dev', 'release', 'out', 'signed')
	const mode = (rel) => fs.statSync(path.join(signed, rel)).mode & 0o7777
	assert.equal(mode('.'), 0o755, 'signed/')
	for (const f of ['knorke-1.2.3.tar.gz', 'knorke-1.2.3.tar.gz.sha256', 'knorke-1.2.3.tar.gz.sig']) assert.equal(mode(f), 0o644, f)
	assert.equal(mode('knorke-1.2.3/lib'), 0o755, 'the setgid bit of lib/ is cleared')
	const long = spawnSync('tar', ['tvzf', path.join(signed, 'knorke-1.2.3.tar.gz')], { encoding: 'utf8' }).stdout.split('\n')
	assert.match(long.find((l) => / knorke\/lib\/$/.test(l)) ?? '', /^drwxr-xr-x /, 'the archive carries lib/ as 0755')
})

test('the list of differences: at most 20 lines, then „… (gekürzt)“ only when there are more, then the FEHLER line, exit 1 (factory job 065, AK8)', (t) => {
	const heading = 'Abweichungen (< Release, > signierter Baum):'
	for (const [n, cut] of [[10, false], [11, true]]) {
		const label = `${n} extra files (${2 * n} lines)`
		const { dk, out, signed, r } = signRun(t, { FAKE_SIGN_EXTRA: `files:${n}` })
		assert.equal(r.status, 1, `${label}: ${r.stderr}`)
		assert.equal(r.stdout, '', `${label}: stdout stays empty`)
		const lines = r.stderr.split('\n')
		const shown = lines.filter((l) => /^[<>] /.test(l))
		assert.equal(shown.length, 20, `${label}: exactly 20 lines of the list`)
		for (const l of shown) assert.match(l, /^> (f \.\/lib\/extra-\d+\.php|[0-9a-f]{64} {2}\.\/lib\/extra-\d+\.php)$/, `${label}: kind or SHA-256 and path only`)
		const h = lines.indexOf(heading)
		assert.ok(h >= 0, `${label}: the heading`)
		assert.deepEqual(lines.slice(h + 1, h + 21), shown, `${label}: the 20 lines right after the heading`)
		const fehler = /FEHLER: der signierte Baum weicht vom Release ab \(außer appinfo\/signature\.json eine Datei geändert, hinzugefügt oder entfernt\)$/
		if (cut) {
			assert.equal(lines[h + 21], '… (gekürzt)', `${label}: the list says it is cut`)
			assert.match(lines[h + 22], fehler, `${label}: then the FEHLER line`)
		} else {
			assert.ok(!r.stderr.includes('(gekürzt)'), `${label}: a complete list is not marked as cut`)
			assert.match(lines[h + 21], fehler, `${label}: then the FEHLER line`)
		}
		assert.deepEqual(fs.readdirSync(signed).filter((x) => x.startsWith('knorke-1.2.3')), [], `${label}: no signed path of the version`)
		assert.ok(!dk.calls().some((c) => c.includes('integrity:check-app')), `${label}: check-app is not called`)
		assert.ok(fs.existsSync(path.join(out, 'knorke-1.2.3.tar.gz')), `${label}: the unsigned release stays`)
	}
})

test('an existing signed/ with mode 2777: a run without arguments leaves it, a signing run sets it to 0755 (factory job 065, AK9; code review 047 round 3)', (t) => {
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	const signed = path.join(root, 'dev', 'release', 'out', 'signed')
	fs.mkdirSync(signed, { recursive: true })
	fs.chmodSync(signed, 0o2777)
	const mode = () => fs.statSync(signed).mode & 0o7777
	assert.equal(mode(), 0o2777, 'precondition: signed/ is 2777')
	const plain = run(root, dk.env)
	assert.equal(plain.status, 0, plain.stderr)
	assert.equal(mode(), 0o2777, 'a run without arguments never touches signed/')
	const r = run(root, dk.env, signArgs())
	assert.equal(r.status, 0, r.stderr)
	assert.equal(mode(), 0o755, 'the signing run sets signed/ to 0755 (setgid and the write bits for others gone)')
	assert.equal(fs.statSync(path.join(signed, 'knorke-1.2.3')).mode & 0o7777, 0o755, 'the signed folder inherits no setgid bit')
})

test('a failing signing run removes an older signed build of the same version; a run without arguments leaves signed/ byte for byte (AK6, AK7)', (t) => {
	const root = fakeRepo(t)
	const dk = fakeDocker(t)
	const signed = path.join(root, 'dev', 'release', 'out', 'signed')
	const good = run(root, dk.env, signArgs())
	assert.equal(good.status, 0, good.stderr)
	const hashes = () => Object.fromEntries(files(signed).map((f) => [f, sha(path.join(signed, f))]))
	const kept = hashes()
	assert.deepEqual(Object.keys(kept).sort(), [...SIGNED_FILES.map((f) => `knorke-1.2.3/${f}`), 'knorke-1.2.3.tar.gz', 'knorke-1.2.3.tar.gz.sha256', 'knorke-1.2.3.tar.gz.sig'].sort())
	const plain = run(root, dk.env)
	assert.equal(plain.status, 0, plain.stderr)
	assert.deepEqual(hashes(), kept, 'every file below signed/ unchanged by a run without arguments')
	const bad = run(root, { ...dk.env, FAKE_CHECK_RC: '1' }, signArgs())
	assert.equal(bad.status, 1, bad.stderr)
	assert.deepEqual(fs.readdirSync(signed).filter((n) => n.startsWith('knorke-1.2.3')), [], 'the failed run leaves no signed path of the version')
})

// ── P7-C (SPEC-M1 §33.1 k, ED-31): the real tree, no build, no Docker ─────────

/** Every file below a folder of the real repo (relative to the repo, sorted); [] when the folder is missing. */
function realFiles(rel) {
	const abs = path.join(REPO, rel)
	if (!fs.existsSync(abs)) return []
	return files(abs).map((f) => path.join(rel, f))
}

test('P7-05: no runtime folder of the real tree holds a file named cron.php, public.php, remote.php or status.php (Nextcloud\'s .htaccess does not rewrite them, so such a file runs on its own)', () => {
	const dirs = SCRIPT.match(/^RUNTIME_DIRS="([^"]*)"$/m)[1].split(/\s+/)
	assert.deepEqual(dirs, ['appinfo', 'lib', 'templates', 'img', 'js', 'css', 'l10n'], 'the runtime folders dev/release.sh copies')
	const all = dirs.flatMap(realFiles)
	assert.ok(all.some((f) => f.startsWith('appinfo/')) && all.some((f) => f.startsWith('templates/')), 'the real tree was read')
	const bad = all.filter((f) => ['cron.php', 'public.php', 'remote.php', 'status.php'].includes(path.basename(f)))
	assert.deepEqual(bad, [], 'files named like the exempt entry points of Nextcloud')
})

test('P7-06/P7-02: the real appinfo/info.xml names no version or milestone in its descriptions (en and de), never M0 or "not for production", and lists OCA\\Knorke\\Command\\Orphans in <commands>', () => {
	const xml = fs.readFileSync(path.join(REPO, 'appinfo', 'info.xml'), 'utf8')
	assert.doesNotMatch(xml, /\bM0\b/, 'no M0')
	assert.doesNotMatch(xml, /not for production/i, 'no "not for production"')
	// Factory job 050: the Apps page shows <version> next to the description,
	// so a version or milestone in the text only goes stale with the next bump.
	const descriptions = [...xml.matchAll(/<description(?: lang="de")?><!\[CDATA\[([\s\S]*?)\]\]><\/description>/g)]
	assert.equal(descriptions.length, 2, 'two descriptions (en and de) in CDATA')
	for (const m of descriptions) {
		const lang = m[0].startsWith('<description lang="de">') ? 'de' : 'en'
		for (const stale of [/\b\d+\.\d+\.\d+\b/, /\bM\d\b/, /milestone|Meilenstein/i, /custom app|Custom-App/i, /follows with|folgt mit/i]) {
			assert.doesNotMatch(m[1], stale, `description (${lang})`)
		}
	}
	const cmds = xml.match(/<commands>([\s\S]*?)<\/commands>/)?.[1] ?? ''
	assert.match(cmds, /<command>\s*OCA\\Knorke\\Command\\Orphans\s*<\/command>/, 'occ knorke:orphans is registered')
	assert.match(xml, /<version>0\.3\.0<\/version>/, 'version 0.3.0 since the M2 data foundation (its migration needs the jump)')
})
