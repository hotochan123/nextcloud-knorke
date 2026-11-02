/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Tablet package without the spike bench (factory job 280): run.sh ipad with
 * KNORKE_BENCH_HTML=none packs the lab, session server and sheet only, and
 * ipad/check.mjs skips its bench steps for such a package; any other value
 * still needs the file.
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = (p) => readFileSync(join(LAB, p), 'utf8').split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n')

test('run.sh ipad: KNORKE_BENCH_HTML=none skips the bench, any other value must exist', () => {
	const sh = code('run.sh')
	const ipad = sh.slice(sh.indexOf('if [ "$MODE" = ipad ]; then'))
	assert.match(ipad, /if \[ "\$BENCH" != none \]; then\n\t\t\[ -f "\$BENCH" \] \|\| die "spike bench missing/)
	assert.match(ipad, /mkdir -p "\$PKG\/lab"\n/)
	assert.match(ipad, /if \[ "\$BENCH" != none \]; then\n\t\tmkdir -p "\$PKG\/bench"\n\t\tcp "\$BENCH" "\$PKG\/bench\/bench-standalone.html"/)
})

test('ipad/check.mjs: the bench steps run only when the package has the bench', () => {
	const js = code('ipad/check.mjs')
	assert.match(js, /const HAS_BENCH = existsSync\(join\(PKG, 'bench', 'bench-standalone\.html'\)\)/)
	const skip = js.indexOf('if (!HAS_BENCH) stepOk(')
	const bench = js.indexOf("await page.goto(BASE + 'bench/bench-standalone.html'")
	const lab = js.indexOf("await page.goto(BASE + 'lab/?panel=1'")
	assert.ok(skip > 0 && skip < bench && bench < lab, 'the skip guards the bench page, the lab follows outside it')
	assert.match(js.slice(skip, bench), /\n\t\telse \{\n\t+$/)
})
