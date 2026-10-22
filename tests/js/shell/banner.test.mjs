/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GONE_VIA_LINK, bannerFor } from '../../../src/components/banner.js'
import { FROZEN_STATUSES } from '../../../src/board/BoardSession.js'
import { FINAL_STATUSES, LINKS_DISABLED, LINK_EXPIRED, PASSWORD_REQUIRED, RATE_LIMITED } from '../../../src/sync/SyncClient.js'

const RATE_TEXT = 'Too many requests from your network. Please wait a few minutes, then reload the page.'

test('banner: one kind per status (test hook), the texts of the states', () => {
	assert.deepEqual(bannerFor('online'), { kind: null, text: '', action: null })
	assert.deepEqual(bannerFor('connecting'), { kind: null, text: '', action: null })
	assert.equal(bannerFor('gone').text, 'This board is no longer available.')
	assert.equal(bannerFor('revoked').text, 'This link was revoked.')
	assert.equal(bannerFor('logged_out').action, 'signin')
	assert.equal(bannerFor('reload').action, 'reload')
	assert.equal(bannerFor('offline').action, null)
})

test('banner: app 429 on /sync has its own hook rate_limited (R3, §6.8) with the rate-limit text', () => {
	assert.deepEqual(bannerFor('rate_limited'), { kind: 'rate_limited', text: RATE_TEXT, action: 'reload' })
	assert.doesNotMatch(bannerFor('rate_limited').text, /no longer available|revoked|deleted/)
})

test('banner: every final status of the sync loop has a banner; (U15) the frozen list is the final list, reload included', () => {
	for (const s of FINAL_STATUSES) {
		assert.equal(bannerFor(s).kind, s, 'data-knorke-banner=' + s)
	}
	assert.ok(FINAL_STATUSES.includes(RATE_LIMITED))
	assert.ok(FROZEN_STATUSES.includes('reload'), 'reload freezes the board (the loop has stopped for good)')
	assert.deepEqual([...FROZEN_STATUSES].sort(), [...FINAL_STATUSES].sort())
})

test('banner: the final statuses are the frozen list of SPEC-M1 §4.2 (link_expired, password_required included)', () => {
	assert.deepEqual([...FINAL_STATUSES], ['gone', 'revoked', 'logged_out', 'reload', 'rate_limited', 'links_disabled', 'link_expired', 'password_required'])
	assert.equal(LINK_EXPIRED, 'link_expired')
	assert.equal(PASSWORD_REQUIRED, 'password_required')
	for (const s of [LINK_EXPIRED, PASSWORD_REQUIRED]) {
		const b = bannerFor(s)
		assert.equal(b.kind, s, 'data-knorke-banner=' + s)
		assert.ok(b.text.length > 0, s + ' shows a text')
		assert.equal(b.action, null, s + ': no reload, no sign-in (a new attempt does not help)')
	}
})

test('banner (U12): links_disabled is a final status with its own hook and a final text, no action', () => {
	assert.ok(FINAL_STATUSES.includes(LINKS_DISABLED))
	assert.deepEqual(bannerFor(LINKS_DISABLED), {
		kind: 'links_disabled',
		text: 'Link sharing was turned off by the administrator. This board can no longer be opened through the link.',
		action: null,
	})
})

test('banner: a guest re-join answered by an app 429 keeps the revoked hook but names the rate limit', () => {
	const b = bannerFor('revoked', RATE_LIMITED)
	assert.deepEqual(b, { kind: 'revoked', text: RATE_TEXT, action: 'reload' })
	assert.equal(bannerFor('gone', RATE_LIMITED).text, 'This board is no longer available.', 'gone never carries the reason any more')
	assert.equal(bannerFor('logged_out', RATE_LIMITED).text, 'Your session has ended. Please sign in again.')
})

test('shell: BoardView and ConnectionBanner take the frozen states from FROZEN_STATUSES, no own copy', () => {
	for (const f of ['src/views/BoardView.vue', 'src/components/ConnectionBanner.vue']) {
		const src = readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
		assert.match(src, /import \{[^}]*\bFROZEN_STATUSES\b[^}]*\} from '\.\.\/board\/BoardSession\.js'/, f)
		assert.match(src, /const frozen = computed\(\(\) => FROZEN_STATUSES\.includes\(/, f)
		assert.doesNotMatch(src, /\[\s*'gone',\s*'revoked'/, f + ' has no hard-coded status list')
	}
})

test('M1 §6.11 (R3): link_expired and password_required show their own texts (the stage-0 interim texts are gone)', () => {
	assert.deepEqual(bannerFor('link_expired'), { kind: 'link_expired', text: 'This link has expired.', action: null })
	assert.deepEqual(bannerFor('password_required'), { kind: 'password_required', text: 'Enter the password for this board.', action: null })
})

test('M1 §4.2 (R2): gone of a link member keeps the hook gone and says to open the link again', () => {
	assert.equal(GONE_VIA_LINK, 'link')
	assert.deepEqual(bannerFor('gone', GONE_VIA_LINK), { kind: 'gone', text: 'Your access through the link ended. Open the link again.', action: null })
	assert.equal(bannerFor('gone', null).text, 'This board is no longer available.')
	assert.equal(bannerFor('revoked', GONE_VIA_LINK).text, 'This link was revoked.', 'only gone has the link variant')
})
