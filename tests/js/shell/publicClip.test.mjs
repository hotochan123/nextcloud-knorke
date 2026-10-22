/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §6.5.3: guests (also kiosk devices) drop the stored copy
 * (localStorage knorke.clip) when the page goes away.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CLIP_KEY } from '../../../src/board/clipboard.js'
import { keys } from '../../../src/util/storage.js'

test('PublicApp removes knorke.clip on pagehide (and unhooks itself)', () => {
	const src = readFileSync(new URL('../../../src/PublicApp.vue', import.meta.url), 'utf8')
	assert.equal(keys.clip(), 'knorke.clip')
	assert.equal(CLIP_KEY, keys.clip())
	assert.match(src, /removeItem\('local', keys\.clip\(\)\)/)
	assert.match(src, /addEventListener\('pagehide', dropClip\)/)
	assert.match(src, /removeEventListener\('pagehide', dropClip\)/)
})
