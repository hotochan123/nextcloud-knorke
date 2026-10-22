/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Harness accounts and the harness group (SPEC-M1 §8.1 "Weitere Konten", §15
 * R4): up.sh creates alice, bob and the accounts of KD_EXTRA_USERS (default
 * carol, "Carol Clausen") with one password, and the group knorke-e2e with bob
 * and the extra accounts; env.json carries .users (uid → display name) and
 * .groups (gid → members). The stage-2 bridge (group-member, team-member,
 * share-policy lists) and normalise_ns read exactly these two keys.
 * No stack: up.sh is read as text, its env.json expression runs through jq,
 * and a bad KD_EXTRA_USERS is refused in a sandbox (lib/sandbox.mjs, fake
 * docker) before any docker call.
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './lib/sandbox.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const UP = fs.readFileSync(path.join(ROOT, 'dev/up.sh'), 'utf8')

test('up.sh: carol by default, group knorke-e2e = bob + the extra accounts, everybody with core lang en', () => {
	assert.match(UP, /^EXTRA_USERS="\$\{KD_EXTRA_USERS-carol\}"$/m, 'KD_EXTRA_USERS defaults to carol ("-": an empty value means none)')
	assert.match(UP, /^E2E_GROUP="knorke-e2e"$/m)
	assert.match(UP, /carol\) printf '%s\\n' "Carol Clausen" ;;/)
	assert.match(UP, /^add_user alice "Alice Adler"$/m)
	assert.match(UP, /^add_user bob "Bob Berg"$/m)
	assert.match(UP, /^for u in \$EXTRA_USERS; do\n {4}add_user "\$u" "\$\(display_name "\$u"\)"/m)
	assert.match(UP, /^occ group:add "\$E2E_GROUP"/m)
	assert.match(UP, /^for u in bob \$EXTRA_USERS; do\n {4}occ group:adduser "\$E2E_GROUP" "\$u"/m)
	assert.match(UP, /occ user:setting "\$uid" core lang en/)
	// display_name of an extra account: carol fixed, others capitalised
	const fn = UP.slice(UP.indexOf('display_name() {'), UP.indexOf('\n}\n', UP.indexOf('display_name() {')) + 3)
	const r = spawnSync('bash', ['-c', `${fn}\ndisplay_name carol; display_name dave`], { encoding: 'utf8' })
	assert.equal(r.stdout, 'Carol Clausen\nDave\n')
})

test('env.json: .users with every account, .groups = {knorke-e2e: every account but alice}', () => {
	assert.match(UP, /--argjson users "\$USERS_JSON" --arg group "\$E2E_GROUP"/)
	const m = UP.match(/users: \$users, (groups: \{\(\$group\): \(\[\$users \| keys\[\] \| select\(\. != "alice"\)\]\)\})/)
	assert.ok(m, 'env.json expression with users and groups')
	const users = { alice: 'Alice Adler', bob: 'Bob Berg', carol: 'Carol Clausen' }
	const r = spawnSync('jq', ['-cn', '--argjson', 'users', JSON.stringify(users), '--arg', 'group', 'knorke-e2e', `{users: $users, ${m[1]}}`], { encoding: 'utf8' })
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(JSON.parse(r.stdout), { users, groups: { 'knorke-e2e': ['bob', 'carol'] } })
	// the group in Nextcloud and in env.json come from the same list: bob + EXTRA_USERS = every account but alice
	assert.match(UP, /USERS_JSON='\{"alice":"Alice Adler","bob":"Bob Berg"\}'/)
})

test('up.sh refuses a bad KD_EXTRA_USERS before any docker call', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	for (const [value, re] of [['Carol', /'Carol' ist keine gültige uid/], ['bob', /'bob' gibt es schon/], ['admin', /'admin' gibt es schon/], ['x', /'x' ist keine gültige uid/]]) {
		sb.rules([])
		const r = sb.run('up.sh', [], { KD_NS: 'dzacct', KD_PORT: '18609', KD_EXTRA_USERS: value })
		assert.equal(r.status, 1, `${value}: ${r.stderr}`)
		assert.match(r.stderr, re)
		assert.deepEqual(sb.calls(), [], `${value}: no docker call`)
	}
})
