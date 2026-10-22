/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Static check of the scene-lab container (SPEC-M1 §9.1 WP-S0, gate G17,
 * M0 rest OPS-3): dev/scene-lab/run.sh starts knorke-lab-* as a non-root
 * user, mounts dev/scene-lab read-only at /work with an empty tmpfs over
 * /work/out, gives it exactly one writable directory at /out
 * (KNORKE_LAB_OUT), serialises runs with flock on dev/.state/lab.lock and
 * adds the /dev/dri groups for the GPU run. run.mjs writes its reports to
 * KNORKE_LAB_OUT and carries the G17 gate. Comments are stripped first, so
 * the usage text cannot satisfy a check.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, stripComments } from './sourceScan.mjs'

const RUN_SH = join(ROOT, 'dev/scene-lab/run.sh')
const raw = readFileSync(RUN_SH, 'utf8')
/** run.sh without comment lines (the shebang included). */
const sh = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

/**
 * @param {string} src script without comments
 * @return {string} the `docker run` command with its continuation lines joined
 */
function dockerRun(src) {
	const lines = src.split('\n')
	const i = lines.findIndex((l) => /^\s*docker run\b/.test(l))
	if (i < 0) return ''
	const out = []
	for (let j = i; j < lines.length; j++) {
		out.push(lines[j].replace(/\\\s*$/, ''))
		if (!/\\\s*$/.test(lines[j])) break
	}
	return out.join(' ').replace(/\s+/g, ' ')
}

const run = dockerRun(sh)
const runMjs = stripComments(readFileSync(join(ROOT, 'dev/scene-lab/run.mjs'), 'utf8'))

describe('dev/scene-lab/run.sh: container bounds', () => {
	test('bash -n', () => {
		const r = spawnSync('bash', ['-n', RUN_SH], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stderr)
	})

	test('exactly one docker run, a throwaway knorke-lab-* container without network', () => {
		assert.equal((sh.match(/^\s*docker run\b/gm) ?? []).length, 1)
		assert.match(sh, /^NAME="knorke-lab-\$\$"$/m)
		assert.match(run, /--rm --name "\$NAME"/)
		assert.match(run, /--network none/)
		assert.doesNotMatch(run, /--network (?!none)|--net=|\s-p\s|--publish|--privileged|--pid[ =]host|--ipc[ =]host/)
		assert.match(sh, /^IMAGE="mcr\.microsoft\.com\/playwright:v1\.49\.1-jammy"$/m)
		assert.match(sh, /cleanup\(\) \{ docker rm -fv "\$NAME"/)
		// the one container command per mode, all behind the same bounds
		assert.match(run, /"\$IMAGE" "\$\{CMD\[@\]\}"/)
		assert.match(sh, /gates\) .*CMD=\(node run\.mjs --mode "\$MODE" "\$@"\) ;;/)
		assert.match(sh, /measure\) .*CMD=\(node run\.mjs --mode "\$MODE" "\$@"\) ;;/)
		assert.match(sh, /ipad\) .*CMD=\(node ipad\/check\.mjs --pkg \/out\/ipad-ra "\$@"\) ;;/)
		assert.match(sh, /^trap cleanup EXIT$/m)
	})

	test('--user: an unprivileged uid, never root, never the image user 1000 (a host account)', () => {
		assert.match(run, /--user "\$RUN_UID:\$RUN_UID"/)
		assert.doesNotMatch(run, /--user[ =]"?(root|0)\b|\s-u\s/)
		const m = sh.match(/^RUN_UID="\$\{KNORKE_LAB_UID:-(\d+)\}"$/m)
		assert.ok(m, 'RUN_UID default')
		assert.ok(Number(m[1]) > 1000, `default uid ${m[1]}`)
		assert.match(sh, /\[\[ "\$RUN_UID" =~ \^\[1-9\]\[0-9\]\{2,5\}\$ \]\] \|\| die/)
		assert.match(run, /--cap-drop ALL/)
		assert.match(run, /--security-opt no-new-privileges/)
	})

	test(':/work:ro, tmpfs destination=/work/out, the only writable mount $OUT:/out with KNORKE_LAB_OUT', () => {
		assert.match(run, /-v "\$HERE:\/work:ro"/)
		assert.match(run, /--mount "type=tmpfs,destination=\/work\/out"/)
		assert.match(run, /-v "\$OUT:\/out"/)
		assert.match(sh, /^OUT="\$HERE\/out"$/m)
		assert.match(run, /-e KNORKE_LAB_OUT=\/out/)
		assert.match(run, /-w \/work /)
		// every bind mount: either read-only below /work, or the output dir at /out
		const binds = [...run.matchAll(/-v "([^"]+)"/g)].map((m) => m[1])
		assert.deepEqual(binds, ['$HERE:/work:ro', '$OUT:/out'])
		assert.doesNotMatch(run, /--mount "type=bind/)
		// the container user owns the output dir, nothing else
		assert.match(sh, /^chown "\$RUN_UID:\$RUN_UID" "\$OUT"$/m)
		assert.match(sh, /\[ -L "\$OUT" \] && die/)
	})

	test('flock on dev/.state/lab.lock covers build and container', () => {
		assert.match(sh, /^LAB_LOCK="\$ROOT\/dev\/\.state\/lab\.lock"$/m)
		assert.match(sh, /^exec 8>>"\$LAB_LOCK"$/m)
		assert.match(sh, /flock -x -n 8/)
		assert.match(sh, /flock -x -w "\$LOCK_WAIT" 8 \|\| \{ .*exit 2; \}$/m)
		const lockAt = sh.indexOf('exec 8>>"$LAB_LOCK"')
		assert.ok(lockAt > 0 && lockAt < sh.indexOf('vite.js" build'), 'lock before the build')
		assert.ok(lockAt < sh.indexOf('docker run'), 'lock before the container')
	})

	test('KNORKE_GPU=1: /dev/dri plus --group-add of the device groups, never group 0', () => {
		const gpu = sh.slice(sh.indexOf('if [ "${KNORKE_GPU:-0}" = "1" ]'), sh.indexOf('cleanup() {'))
		assert.ok(gpu.length > 50, 'GPU branch found')
		assert.match(gpu, /GPU_OPTS=\(--device \/dev\/dri\)/)
		assert.match(gpu, /stat -c %g \/dev\/dri\/card\* \/dev\/dri\/renderD\*/)
		assert.match(gpu, /GPU_OPTS\+=\(--group-add "\$gid"\)/)
		assert.match(gpu, /if \[ "\$gid" = 0 \]; then[\s\S]*?continue/)
		assert.match(run, /\$\{GPU_OPTS\[@\]\+"\$\{GPU_OPTS\[@\]\}"\}/)
	})

	test('no protected namespace, no Nextcloud, no other stack touched', () => {
		assert.doesNotMatch(sh, /\btry\b|KD_FORCE|KD_NS|knorke-dev-|nextcloud-nextcloud/)
	})
})

describe('dev/scene-lab/run.mjs: output and gate G17', () => {
	test('reports go to KNORKE_LAB_OUT', () => {
		assert.match(runMjs, /const OUT = process\.env\.KNORKE_LAB_OUT \|\| join\(HERE, 'out'\)/)
		const body = runMjs.slice(0, runMjs.indexOf('function collectBounds()')) + runMjs.slice(runMjs.indexOf('async function gates()'))
		const writes = [...body.matchAll(/writeFileSync\(([^,)]+(?:\)|,[^,)]*\))?)/g)].map((m) => m[1])
		// (R16) every report through writeReport: its own name (names.js) and the copy of the last run
		assert.deepEqual(writes, ['join(OUT, name)'])
		assert.match(body, /for \(const name of \[FILES\[kind\], FILES\.copies\[kind\]\]\) writeFileSync\(join\(OUT, name\), content\)/)
		assert.equal([...body.matchAll(/writeReport\('(json|md)', /g)].length, 4, 'gates.json, gates.md, measure.json, report.md')
	})

	test('G17 is the first gate and is decided by bounds.js from data collected in the container', () => {
		const gates = runMjs.slice(runMjs.indexOf('async function gates()'))
		const first = gates.match(/step\('(gate|check)', '([^']+)'/)
		assert.equal(first[1], 'gate')
		assert.match(first[2], /^G17 Container-Grenzen/)
		const collect = runMjs.slice(runMjs.indexOf('function collectBounds()'), runMjs.indexOf('async function gates()'))
		for (const re of [/\/proc\/self\/mountinfo/, /\/proc\/\$\{pid\}\/status/, /process\.getuid\(\)/, /process\.getgroups\(\)/,
			/process\.env\.KNORKE_LAB_OUT/, /readdirSync\(join\(HERE, 'out'\)\)/, /return evaluateBounds\(/]) {
			assert.match(collect, re)
		}
	})
})
