/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL } from '../../../src/sync/protocol.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('PROTOCOL equals Application::PROTOCOL (read as text, fixed format §4.1); protocol 2 (SPEC-M1 §4.3)', () => {
	const php = readFileSync(join(ROOT, 'lib', 'AppInfo', 'Application.php'), 'utf8')
	const m = php.match(/^\s*public const PROTOCOL = (\d+);\s*$/m)
	assert.ok(m, 'public const PROTOCOL = <n>; in Application.php')
	assert.equal(PROTOCOL, Number(m[1]))
	assert.equal(PROTOCOL, 2)
})
