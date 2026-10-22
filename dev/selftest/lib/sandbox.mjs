/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Sandbox for the harness self-tests that run the dev scripts without a
 * Docker daemon (SPEC-M1 §8.1: protected namespaces, stack cap, build.sh,
 * pre-R5 env.json).
 *
 * - The scripts run from a throwaway copy of every dev/**.sh (and dev/lib.sh)
 *   under os.tmpdir(): ROOT, dev/.state and the stack lock are the sandbox's,
 *   never those of a real repo copy. A real dev/.state/try (the user's stack
 *   state in $ROOT) is therefore out of reach, even for a broken guard.
 * - A fake `docker` and a fake `npm` come first on PATH. Both record every
 *   call (calls()/npmCalls()); docker answers from a rule table
 *   [exitCode, bash glob over "$*", stdout, stderr] (first match wins, no
 *   match = exit 97). Nothing ever reaches the daemon.
 * - Every KD_* variable of the calling environment is dropped, so a
 *   developer's exported KD_FORCE or KD_NS cannot change a result. Then
 *   KD_LOCAL_ENV='' keeps the host's dev/local.env (docs/ENTWICKLUNG.md
 *   §3.10) out of every self-test; a test overrides it in `extra`, and an
 *   `extra` value of undefined drops a variable (Node leaves it out).
 * - Node entry points (copyDev, node; SPEC-M1 §8.1 R20 K2) run from a copy
 *   as well, so their ROOT and dev/.state are the sandbox's too.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const US = '\x1f'

const FAKE_DOCKER = `#!/usr/bin/env bash
# Fake docker of the harness self-tests (dev/selftest/lib/sandbox.mjs): records
# the call, answers from the rule table, never talks to a daemon.
printf '%s\\n' "$*" >>"$KD_FAKE_DIR/docker.log"
while IFS=$'\\x1f' read -r code pat out err; do
    [ -n "$code" ] || continue
    # shellcheck disable=SC2053
    if [[ "$*" == $pat ]]; then
        [ -z "$out" ] || printf '%b' "$out"
        [ -z "$err" ] || printf '%b' "$err" >&2
        exit "$code"
    fi
done <"$KD_FAKE_DIR/docker.rules"
printf 'fake docker: keine Regel für: %s\\n' "$*" >&2
exit 97
`

const FAKE_NPM = `#!/usr/bin/env bash
# Fake npm of the harness self-tests: records the call, builds nothing.
printf '%s\\n' "$*" >>"$KD_FAKE_DIR/npm.log"
exit 0
`

/** Every *.sh below dir (relative paths), without node_modules, out, .state and the scene lab. */
function shellScripts(dir, rel = '') {
	return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
		const p = path.join(rel, e.name)
		if (e.isDirectory()) {
			return ['node_modules', 'out', '.state', 'scene-lab', 'placeholder'].includes(e.name) ? [] : shellScripts(dir, p)
		}
		return e.name.endsWith('.sh') ? [p] : []
	})
}

/** The dev scripts of the real repo (dev/**.sh without dev/lib.sh, relative to dev/). */
export function devScripts() {
	return shellScripts(path.join(REPO, 'dev')).filter((p) => p !== 'lib.sh').sort()
}

/** Escapes a string for printf %b in the fake (backslashes and the separator). */
function enc(s) {
	return String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(new RegExp(US, 'g'), '')
}

/** A process.env copy without any KD_* variable. */
function cleanEnv() {
	return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('KD_')))
}

export class Sandbox {
	constructor() {
		this.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kdsbx-')))
		this.dev = path.join(this.root, 'dev')
		this.fake = path.join(this.root, '.fake')
		this.lockDir = path.join(this.root, '.lock')
		for (const rel of devScripts()) {
			const dst = path.join(this.dev, rel)
			fs.mkdirSync(path.dirname(dst), { recursive: true })
			fs.copyFileSync(path.join(REPO, 'dev', rel), dst)
			fs.chmodSync(dst, 0o755)
		}
		fs.copyFileSync(path.join(REPO, 'dev', 'lib.sh'), path.join(this.dev, 'lib.sh'))
		fs.mkdirSync(this.fake, { recursive: true })
		fs.writeFileSync(path.join(this.fake, 'docker'), FAKE_DOCKER, { mode: 0o755 })
		fs.writeFileSync(path.join(this.fake, 'npm'), FAKE_NPM, { mode: 0o755 })
		this.rules([])
	}

	/** Replaces the docker rule table: [[exitCode, glob, stdout?, stderr?], …]. Clears the call logs. */
	rules(list) {
		const lines = list.map(([code, glob, out = '', err = '']) => [String(code), glob, enc(out), enc(err)].join(US))
		fs.writeFileSync(path.join(this.fake, 'docker.rules'), lines.join('\n') + '\n')
		fs.rmSync(path.join(this.fake, 'docker.log'), { force: true })
		fs.rmSync(path.join(this.fake, 'npm.log'), { force: true })
		return this
	}

	/** Lines of the fake docker's call log ("$*" of every call). */
	calls() {
		const f = path.join(this.fake, 'docker.log')
		return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
	}

	npmCalls() {
		const f = path.join(this.fake, 'npm.log')
		return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
	}

	/** Writes dev/.state/<ns>/env.json of the sandbox (mode 700/600 like up.sh). */
	writeEnv(ns, env) {
		const dir = path.join(this.dev, '.state', ns)
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
		fs.writeFileSync(path.join(dir, 'env.json'), JSON.stringify(env, null, 2), { mode: 0o600 })
		return path.join(dir, 'env.json')
	}

	env(extra = {}) {
		return {
			...cleanEnv(),
			PATH: `${this.fake}:${process.env.PATH}`,
			KD_FAKE_DIR: this.fake,
			KD_LOCK_DIR: this.lockDir,
			KD_LOCAL_ENV: '',
			...extra,
		}
	}

	/** Runs dev/<script> of the sandbox with bash, synchronously. */
	run(script, args = [], extra = {}, { timeout = 30000 } = {}) {
		return spawnSync('bash', [path.join(this.dev, script), ...args], { env: this.env(extra), encoding: 'utf8', timeout })
	}

	/** Same, asynchronously (for tests that serve HTTP from this process meanwhile). */
	runAsync(script, args = [], extra = {}, { timeout = 30000 } = {}) {
		return new Promise((resolve) => {
			const p = spawn('bash', [path.join(this.dev, script), ...args], { env: this.env(extra) })
			let stdout = ''
			let stderr = ''
			const timer = setTimeout(() => p.kill('SIGKILL'), timeout)
			p.stdout.on('data', (c) => { stdout += c })
			p.stderr.on('data', (c) => { stderr += c })
			p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
		})
	}

	/**
	 * Copies files or directories below dev/ of the real repo into the
	 * sandbox (node entry points and their libraries, e.g. 'sim/lib'), so a
	 * module run with node() resolves ROOT – and dev/.state – to the sandbox.
	 */
	copyDev(...rels) {
		for (const rel of rels) {
			const dst = path.join(this.dev, rel)
			fs.mkdirSync(path.dirname(dst), { recursive: true })
			fs.cpSync(path.join(REPO, 'dev', rel), dst, { recursive: true })
		}
		return this
	}

	/** Runs `node dev/<script>` of the sandbox (copied with copyDev) synchronously, the fake docker first on PATH. */
	node(script, args = [], extra = {}, { timeout = 30000 } = {}) {
		return spawnSync(process.execPath, [path.join(this.dev, script), ...args], { env: this.env(extra), encoding: 'utf8', timeout })
	}

	/** Runs a bash snippet with the sandbox's dev/lib.sh sourced ("$ROOT", functions …). */
	lib(snippet, extra = {}) {
		return spawnSync('bash', ['-c', `. "${this.dev}/lib.sh"\n${snippet}`], { env: this.env(extra), encoding: 'utf8', timeout: 30000 })
	}

	cleanup() {
		if (this.root.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'kdsbx-'))) {
			fs.rmSync(this.root, { recursive: true, force: true })
		}
	}
}
