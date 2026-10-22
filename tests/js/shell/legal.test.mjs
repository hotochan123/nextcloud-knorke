/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { httpUrl, legalLinks } from '../../../src/components/legal.js'

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

test('U9 legalLinks: only configured http(s) URLs, imprint first; empty or missing state → nothing', () => {
	assert.deepEqual(legalLinks({ imprintUrl: 'https://example.org/impressum', privacyUrl: 'https://example.org/datenschutz' }), [
		{ key: 'imprint', label: 'Legal notice', href: 'https://example.org/impressum' },
		{ key: 'privacy', label: 'Privacy policy', href: 'https://example.org/datenschutz' },
	])
	assert.deepEqual(legalLinks({ imprintUrl: '', privacyUrl: 'http://x.test/p' }).map((l) => l.key), ['privacy'])
	assert.deepEqual(legalLinks({ imprintUrl: '', privacyUrl: '' }), [])
	assert.deepEqual(legalLinks(null), [])
	assert.deepEqual(legalLinks(undefined), [])
})

test('U9 httpUrl: javascript:, data:, relative, spaces and control characters never reach an href', () => {
	for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '/relative', 'example.org', 'https://exa mple.org', 'https://example.org/\u0000', 'ftp://example.org', 42, null, 'http://']) {
		assert.equal(httpUrl(bad), '', String(bad))
	}
	assert.equal(httpUrl(' https://example.org/a?b=1#c '), 'https://example.org/a?b=1#c')
})

test('U9 guest page: the Nextcloud footer stays hidden (F7); the legal links are in the name dialog, the guest top bar menu and the empty states', () => {
	const css = read('src/styles/knorke.css')
	assert.match(css, /body#body-public \.guest-box \{\s*display: none;/)
	const dialog = read('src/components/GuestNameDialog.vue')
	assert.match(dialog, /<LegalLinks [^>]*:legal="legal"/)
	const pub = read('src/PublicApp.vue')
	assert.match(pub, /:legal="legal"[\s\S]*@join="onName"/, 'name dialog gets the links')
	assert.match(pub, /<LegalLinks class="knorke-public__legal" :legal="legal" \/>/, 'empty states')
	assert.match(pub, /mode="guest"[\s\S]*:legal="legal"/, 'board view (top bar)')
	const bar = read('src/components/TopBar.vue')
	assert.match(bar, /<NcActions v-if="isGuest && legalItems\.length > 0"/)
	assert.match(bar, /<NcActionLink v-for="l in legalItems"[\s\S]*target="_blank"/)
	const links = read('src/components/LegalLinks.vue')
	assert.match(links, /target="_blank"\s+rel="noopener noreferrer"/)
	assert.doesNotMatch(links, /v-html/)
})
