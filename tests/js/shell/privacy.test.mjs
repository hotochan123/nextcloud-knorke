/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * M2 privacy notice (spec AK10 and the client parts of AK11–AK15): the pure
 * helpers of components/privacy.js (linkOpen, accountInfoDue/
 * markAccountSeen, guestInfoDue/markGuestSeen, noticeText/noticeUrl, a
 * throwing storage), the storage keys, and the structure of the name dialog,
 * the info card, the badge, the board view and the admin form – rendered in
 * Node through ./sfc.mjs (@nextcloud/vue as stubs) or read as template AST.
 */
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const privacy = await import('../../../src/components/privacy.js')
const storage = await import('../../../src/util/storage.js')
const boards = await import('../../../src/api/boards.js')
const { HttpError } = await import('../../../src/sync/http.js')
const { t, n } = await import('../../../src/util/l10n.js')
const GuestNameDialog = (await import('../../../src/components/GuestNameDialog.vue')).default
const PrivacyInfo = (await import('../../../src/components/PrivacyInfo.vue')).default
const AdminSettings = (await import('../../../src/admin/AdminSettings.vue')).default

const { accountInfoDue, builtInText, explainText, guestInfoDue, linkOpen, markAccountSeen, markGuestSeen, noticeText, noticeUrl } = privacy
const NOW = 1760000000000
const BUILT_IN = 'Everyone on this board sees your name, your cursor and everything you add or change. The board is stored on this Nextcloud server.'
const BUILT_IN_VOTE = 'Others on this board see neither your cursor nor how you vote. The board is stored on this Nextcloud server.'
const EXPLAIN = 'Guests can join this board through a link without an account. They see the display names and cursors of everyone on the board and all of its content.'

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

/** A storage facade over two Maps (local, session), with the call log. */
function fakeStorage() {
	const data = { local: new Map(), session: new Map() }
	const log = []
	return {
		data,
		log,
		getItem(kind, key) {
			log.push(['get', kind, key])
			return data[kind].has(key) ? data[kind].get(key) : null
		},
		setItem(kind, key, value) {
			log.push(['set', kind, key, value])
			data[kind].set(key, value)
			return true
		},
	}
}

/** A storage facade whose every call throws (private window, quota). */
const throwing = {
	getItem() { throw new Error('SecurityError') },
	setItem() { throw new Error('QuotaExceededError') },
}

/**
 * @param {object} component compiled component
 * @param {object} props props
 * @param {object} [provide] provided values
 * @return {Promise<string>} SSR HTML
 */
function render(component, props, provide = {}) {
	const app = createSSRApp(component, props)
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	for (const [k, v] of Object.entries(provide)) {
		app.provide(k, v)
	}
	return renderToString(app)
}

/**
 * @param {string} f repo path of a .vue file
 * @return {object} root AST of its <template>
 */
function template(f) {
	const m = read(f).match(/<template>([\s\S]*)<\/template>\s*<script/)
	return parse(m[1])
}

/**
 * @param {object} node AST node
 * @param {(n: object) => boolean} pred predicate
 * @param {object[]} [out] results
 * @return {object[]} every element below node matching pred
 */
function findAll(node, pred, out = []) {
	for (const c of node.children ?? []) {
		if (c.type === 1 && pred(c)) {
			out.push(c)
		}
		findAll(c, pred, out)
	}
	return out
}

/**
 * @param {object} el element
 * @param {string} name static attribute or v-bind argument
 * @return {string|null} its value or expression
 */
function attr(el, name) {
	const p = el.props.find((x) => (x.type === 6 && x.name === name) || (x.type === 7 && x.name === 'bind' && x.arg?.content === name))
	if (!p) {
		return null
	}
	return p.type === 6 ? (p.value?.content ?? '') : p.exp?.content ?? ''
}

// ---- linkOpen -------------------------------------------------------------

test('AK10 linkOpen: the links object (owner, moderators) decides when present; else linkOpenSince', () => {
	const link = (expiresAt) => ({ token: 'x', role: 'edit', url: 'u', password: false, expiresAt, expiresOn: null })
	assert.equal(linkOpen({ links: { edit: link(null), vote: null } }, NOW), true, 'active edit link without expiry')
	assert.equal(linkOpen({ links: { edit: null, vote: link(NOW + 1) } }, NOW), true, 'voting link expiring later')
	assert.equal(linkOpen({ links: { edit: link(NOW - 1), vote: null } }, NOW), false, 'expired link')
	assert.equal(linkOpen({ links: { edit: link(NOW), vote: null } }, NOW), false, 'expiring exactly now is expired')
	assert.equal(linkOpen({ links: { edit: link(NOW - 1), vote: link(null) } }, NOW), true, 'one of two is enough')
	assert.equal(linkOpen({ links: { edit: null, vote: null }, linkOpenSince: 5 }, NOW), false, 'no link in the live object wins over a stale snapshot value')
	assert.equal(linkOpen({ linkOpenSince: 1234 }, NOW), true, 'members: linkOpenSince is a number')
	assert.equal(linkOpen({ linkOpenSince: null }, NOW), false)
	assert.equal(linkOpen({}, NOW), false, 'an old server without the field: like null')
	assert.equal(linkOpen({ linkOpenSince: Number.NaN }, NOW), false)
	assert.equal(linkOpen({ linkOpenSince: '1234' }, NOW), false, 'only a number')
	assert.equal(linkOpen(null, NOW), false)
})

// ---- account info ---------------------------------------------------------

test('AK10 accountInfoDue/markAccountSeen: never the owner, never without a number; the key holds the pid; due until the stored value reaches linkOpenSince', () => {
	const s = fakeStorage()
	const me = { pid: 'u:bob', role: 'edit' }
	const board = { id: 7, linkOpenSince: 2000 }
	assert.equal(accountInfoDue({ board, me, isOwner: true }, s), false, 'the owner never')
	assert.equal(accountInfoDue({ board, me: null, isOwner: false }, s), false, 'me unknown')
	assert.equal(accountInfoDue({ board: { id: 7, linkOpenSince: null }, me, isOwner: false }, s), false, 'no link')
	assert.equal(accountInfoDue({ board: { id: 7 }, me, isOwner: false }, s), false, 'no field')
	assert.equal(accountInfoDue({ board, me, isOwner: false }, s), true, 'no mark: due')
	assert.deepEqual(s.log.at(-1), ['get', 'local', 'knorke.linkInfo.7.u:bob'], 'localStorage, key with board and pid')
	assert.equal(markAccountSeen({ board, me }, s), true)
	assert.equal(s.data.local.get('knorke.linkInfo.7.u:bob'), '2000', 'String(linkOpenSince)')
	assert.equal(accountInfoDue({ board, me, isOwner: false }, s), false, 'same value: not due')
	assert.equal(accountInfoDue({ board: { id: 7, linkOpenSince: 1500 }, me, isOwner: false }, s), false, 'smaller value (a link switched off): not due')
	assert.equal(accountInfoDue({ board: { id: 7, linkOpenSince: 2001 }, me, isOwner: false }, s), true, 'larger value (renewed, on again): due')
	assert.equal(accountInfoDue({ board, me: { pid: 'u:carol' }, isOwner: false }, s), true, 'another account on the same device')
	assert.equal(accountInfoDue({ board: { id: 8, linkOpenSince: 2000 }, me, isOwner: false }, s), true, 'another board')
	s.data.local.set('knorke.linkInfo.7.u:bob', 'abc')
	assert.equal(accountInfoDue({ board, me, isOwner: false }, s), true, 'not a number: due')
	s.data.local.set('knorke.linkInfo.7.u:bob', '')
	assert.equal(accountInfoDue({ board, me, isOwner: false }, s), true, 'empty: due')
	assert.equal(markAccountSeen({ board: { id: 7, linkOpenSince: null }, me }, s), false, 'nothing to mark without a number')
})

// ---- guest info -----------------------------------------------------------

test('AK10 guestInfoDue/markGuestSeen: sessionStorage knorke.privacy.<boardId> = "1"', () => {
	const s = fakeStorage()
	assert.equal(guestInfoDue(s, 7), true)
	assert.deepEqual(s.log.at(-1), ['get', 'session', 'knorke.privacy.7'])
	assert.equal(markGuestSeen(s, 7), true)
	assert.deepEqual(s.log.at(-1), ['set', 'session', 'knorke.privacy.7', '1'])
	assert.equal(guestInfoDue(s, 7), false, 'same tab session: not again')
	assert.equal(guestInfoDue(s, 8), true, 'another board')
})

test('AK10 the real storage facade: sessionStorage per tab; without sessionStorage the card is due every time', () => {
	const session = new Map()
	globalThis.sessionStorage = { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) }
	try {
		const s = storage.webStorage()
		assert.equal(guestInfoDue(s, 3), true)
		markGuestSeen(s, 3)
		assert.equal(session.get('knorke.privacy.3'), '1')
		assert.equal(guestInfoDue(s, 3), false)
		globalThis.sessionStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
		assert.equal(guestInfoDue(storage.webStorage(), 3), true, 'unusable sessionStorage: due')
		assert.equal(markGuestSeen(storage.webStorage(), 3), false)
	} finally {
		delete globalThis.sessionStorage
	}
})

test('AK10 a throwing storage facade never throws', () => {
	const board = { id: 7, linkOpenSince: 2000 }
	const me = { pid: 'u:bob' }
	assert.doesNotThrow(() => guestInfoDue(throwing, 7))
	assert.equal(guestInfoDue(throwing, 7), true)
	assert.equal(markGuestSeen(throwing, 7), false)
	assert.equal(accountInfoDue({ board, me, isOwner: false }, throwing), true)
	assert.equal(markAccountSeen({ board, me }, throwing), false)
})

test('storage keys: privacy (session) and linkInfo (local), both in the key list of util/storage.js', () => {
	assert.equal(storage.keys.privacy(12), 'knorke.privacy.12')
	assert.equal(storage.keys.linkInfo(12, 'u:alice'), 'knorke.linkInfo.12.u:alice')
	const src = read('src/util/storage.js')
	assert.match(src, /\* {3}sessionStorage knorke\.privacy\.<boardId>/)
	assert.match(src, /\* {3}localStorage {3}knorke\.linkInfo\.<boardId>\.<pid>/)
})

// ---- texts ----------------------------------------------------------------

test('AK10 noticeText: an empty or missing text is the built-in text; noticeUrl only http(s)', () => {
	assert.equal(builtInText(), BUILT_IN)
	assert.equal(explainText(), EXPLAIN)
	for (const p of [null, undefined, {}, { text: null }, { text: '' }, { text: '  \n ' }, { text: 5 }, 'text']) {
		assert.equal(noticeText(p), BUILT_IN, JSON.stringify(p))
	}
	assert.equal(noticeText({ text: 'Zeile 1\nZeile 2' }), 'Zeile 1\nZeile 2')
	assert.equal(builtInText({ vote: true }), BUILT_IN_VOTE)
	assert.equal(noticeText(null, { vote: true }), BUILT_IN_VOTE, 'voting role: its own built-in text')
	assert.equal(noticeText({ text: '' }, { vote: false }), BUILT_IN)
	assert.equal(noticeText({ text: 'Admin' }, { vote: true }), 'Admin', 'an admin text stays for every role')
	assert.doesNotMatch(BUILT_IN_VOTE, /your name|everything you add/, 'nothing about name or additions for voting devices')
	assert.equal(noticeUrl({ url: 'https://example.org/p' }), 'https://example.org/p')
	for (const url of ['javascript:alert(1)', '//example.org/x', '/x', '', null, 'data:text/html,x']) {
		assert.equal(noticeUrl({ url }), '', String(url))
	}
	assert.equal(noticeUrl(null), '')
})

test('no text speaks of consent, accepting or agreeing', () => {
	const de = JSON.parse(read('l10n/de.json')).translations
	const ours = [BUILT_IN, BUILT_IN_VOTE, EXPLAIN, 'Open by link', 'Privacy notice', 'Close privacy notice']
	for (const k of ours) {
		assert.ok(k in de, k)
		assert.doesNotMatch(k + ' ' + de[k], /consent|accept|agree|Zustimm|Einwillig|Akzept|einverstanden/i, k)
	}
	assert.equal(de['Open by link'], 'Per Link offen')
	assert.equal(de['Privacy notice'], 'Datenschutzhinweis')
})

// ---- name dialog (AK11) ---------------------------------------------------

test('AK11 name dialog: the notice block with text and legal links stands before the name field; no checkbox; text as text', async () => {
	const legal = { imprintUrl: 'https://example.org/impressum', privacyUrl: 'https://example.org/ude' }
	const html = await render(GuestNameDialog, { legal, privacy: { text: 'T0 line 1\nline 2 <script>x</script>', url: 'https://example.org/ude' } })
	const block = html.indexOf('data-knorke="privacy-notice"')
	const field = html.indexOf('data-knorke-field="guest-name"')
	assert.ok(block > 0 && field > 0 && block < field, 'notice before the name field')
	assert.ok(html.indexOf('knorke-dialog__message') < block, 'after the intro')
	assert.ok(html.indexOf('data-knorke-privacy-text') > block)
	assert.match(html, /T0 line 1\nline 2 &lt;script&gt;x&lt;\/script&gt;/, 'line break kept, markup escaped')
	assert.equal((html.match(/data-knorke="legal"/g) || []).length, 1, 'exactly one pair of legal links')
	const legalAt = html.indexOf('data-knorke="legal"')
	assert.ok(legalAt > block && legalAt < field, 'the legal links inside the block, under the text')
	assert.match(html, /data-knorke-legal="privacy"[^>]*>Privacy policy|href="https:\/\/example\.org\/ude"/)
	assert.doesNotMatch(html, /type="checkbox"/, 'no checkbox')
	assert.doesNotMatch(html, /tabindex="0"/, 'a short text does not scroll: not in the tab order (measured on mount)')
	const empty = await render(GuestNameDialog, { legal: null, privacy: null })
	assert.match(empty, new RegExp(BUILT_IN.replace(/[.]/g, '\\.')), 'built-in text without an admin text')
	const src = read('src/components/GuestNameDialog.vue')
	assert.match(src, /onMounted\(async \(\) => \{\s*await nextTick\(\)\s*focusName\(\)/, 'the name field keeps the first focus (the links come before it in the tab order)')
	assert.match(src, /:tabindex="noticeScrolls \? 0 : null"\s*:role="noticeScrolls \? 'region' : null"\s*:aria-label="noticeScrolls \? t\('knorke', 'Privacy notice'\) : null"/)
	const css = read('src/styles/knorke.css')
	assert.match(css, /\.knorke-dialog__privacy-text \{\s*max-height: 30vh;\s*margin: 0;\s*overflow-y: auto;/, 'only the text scrolls')
	assert.doesNotMatch(css.match(/\.knorke-dialog__privacy \{([^}]*)\}/)[1], /max-height|overflow/, 'the block itself does not scroll')
	assert.match(css, /\.knorke-dialog__privacy-text:focus-visible \{\s*outline: 2px solid transparent;\s*box-shadow: var\(--k-focus-ring\);/, 'job 226: the focus ring in the text colour')
	assert.match(read('src/styles/knorke.css'), /\.knorke-dialog__privacy-text \{[^}]*white-space: pre-line;[^}]*overflow-wrap: anywhere;/)
})

test('round 1 (UX 1, 2): only the notice text scrolls, the legal links stay outside it; the voting link gets its own built-in text', async () => {
	const ast = template('src/components/GuestNameDialog.vue')
	const block = findAll(ast, (e) => attr(e, 'data-knorke') === 'privacy-notice')[0]
	const kids = block.children.filter((c) => c.type === 1)
	assert.deepEqual(kids.map((c) => c.tag), ['p', 'LegalLinks'], 'the text, then the legal links, side by side in the block')
	const text = kids[0]
	assert.ok(text.props.some((p) => p.type === 6 && p.name === 'data-knorke-privacy-text'))
	assert.equal(attr(text, 'tabindex'), 'noticeScrolls ? 0 : null', 'the scrolling text carries tabindex/role/aria-label')
	assert.equal(attr(text, 'role'), "noticeScrolls ? 'region' : null")
	assert.equal(attr(block, 'tabindex'), null, 'the block itself is never in the tab order')
	assert.equal(findAll(text, (e) => e.tag === 'LegalLinks').length, 0)
	const nameField = findAll(ast, (e) => attr(e, 'data-knorke-field') === 'guest-name')[0]
	assert.equal(attr(nameField, 'aria-describedby'), attr(text, 'id'), 'UX 4: the name field is described by the notice text')
	assert.equal(attr(text, 'id'), 'knorke-guest-privacy-text')
	const legal = { imprintUrl: '', privacyUrl: 'https://example.org/p' }
	const vote = await render(GuestNameDialog, { legal, privacy: { text: null, url: '' }, linkRole: 'vote' })
	assert.ok(vote.includes('Your votes are anonymous.'))
	assert.ok(vote.includes(BUILT_IN_VOTE), 'voting link: the built-in text of the voting role')
	assert.ok(!vote.includes(BUILT_IN), 'not the edit wording')
	const edit = await render(GuestNameDialog, { legal, privacy: null, linkRole: 'edit' })
	assert.ok(edit.includes(BUILT_IN) && !edit.includes(BUILT_IN_VOTE))
	const admin = await render(GuestNameDialog, { legal, privacy: { text: 'Admin-Text', url: '' }, linkRole: 'vote' })
	assert.ok(admin.includes('Admin-Text') && !admin.includes(BUILT_IN_VOTE), 'an admin text stays on the voting link')
	const card = await render(PrivacyInfo, { id: 'v', kind: 'guest', privacy: null, vote: true })
	assert.ok(card.includes(BUILT_IN_VOTE) && !card.includes(BUILT_IN), 'the card of a voting guest')
})

// ---- info card (AK12, AK14) ----------------------------------------------

test('AK12/AK14 info card: section with hooks, heading, text, link in a new tab (no legal hook), named close button; account adds the explanation', async () => {
	const p = { text: 'Hinweis <b>fett</b>', url: 'https://example.org/datenschutz' }
	const guest = await render(PrivacyInfo, { id: 'knorke-privacy-info-7', kind: 'guest', privacy: p })
	assert.match(guest, /^<section id="knorke-privacy-info-7" class="knorke-privacy-info" data-knorke="privacy-info" data-knorke-privacy-kind="guest" aria-labelledby="knorke-privacy-info-7-title"/)
	assert.match(guest, /<h2 id="knorke-privacy-info-7-title"[^>]*>\s*Privacy notice\s*<\/h2>/)
	assert.match(guest, /data-knorke-privacy-text[^>]*>\s*Hinweis &lt;b&gt;fett&lt;\/b&gt;\s*</)
	assert.match(guest, /<a class="knorke-privacy-info__link" href="https:\/\/example\.org\/datenschutz" target="_blank" rel="noopener noreferrer" data-knorke-privacy-link>Privacy policy<\/a>/)
	assert.doesNotMatch(guest, /data-knorke-legal/, 'E15 counts the legal hooks')
	assert.doesNotMatch(guest, /knorke-banner|data-knorke-bar/, 'no banner strip')
	assert.match(guest, /<button type="button" class="knorke-privacy-info__close" aria-label="Close privacy notice" title="Close privacy notice" data-knorke-action="privacy-close">/)
	assert.doesNotMatch(guest, /knorke-privacy-info__explain/)
	const account = await render(PrivacyInfo, { id: 'c', kind: 'account', privacy: { text: null, url: 'javascript:alert(1)' } })
	assert.match(account, /data-knorke-privacy-kind="account"/)
	assert.ok(account.indexOf(EXPLAIN) > 0 && account.indexOf(EXPLAIN) < account.indexOf(BUILT_IN), 'the explanation first, then the built-in text')
	assert.doesNotMatch(account, /data-knorke-privacy-link/, 'no link without an http(s) URL')
	const src = read('src/components/PrivacyInfo.vue')
	assert.match(src, /@keydown\.esc\.stop\.prevent="close"/, 'Esc handled in the card, not passed on')
	assert.match(src, /:tabindex="scrolls \? 0 : null"/, 'the text part is focusable only when it scrolls')
	assert.doesNotMatch(src, /v-html/)
})

test('AK14 info card: the close event says whether the focus was inside; focusClose is exposed', () => {
	const { bindings, emitted } = setupOf(PrivacyInfo, { id: 'x', kind: 'account', privacy: null })
	bindings.close()
	assert.deepEqual(emitted, [['close', { focusInside: false }]])
	assert.equal(typeof bindings.focusClose, 'function')
})

test('AK14 card CSS: at most 420 px (narrow: full width), 40vh, role tokens, native-button resets, touch size', () => {
	const css = read('src/styles/knorke.css')
	const card = css.match(/\.knorke-privacy-info \{([^}]*)\}/)[1]
	for (const d of ['width: 420px;', 'max-width: 100%;', 'max-height: 40vh;', 'color: var(--knorke-text);', 'background: var(--knorke-surface);', 'pointer-events: auto;']) {
		assert.ok(card.includes(d), d)
	}
	assert.match(css, /\.knorke-board--narrow \.knorke-privacy-info \{\s*width: 100%;/)
	assert.match(css, /\.knorke-privacy-info__body \{[^}]*overflow-y: auto;/)
	const close = css.match(/button\.knorke-privacy-info__close \{([^}]*)\}/)[1]
	for (const d of ['background: transparent !important;', 'border: 0 !important;', 'box-shadow: none !important;', 'border-radius: 50% !important;', 'width: var(--knorke-clickable) !important;', 'margin-inline-end: -8px !important;']) {
		assert.ok(close.includes(d), d)
	}
	assert.match(css, /@media \(pointer: coarse\) \{\s*button\.knorke-privacy-info__close \{\s*width: var\(--knorke-touch\) !important;\s*height: var\(--knorke-touch\) !important;/)
})

// ---- badge and board view (AK14) -----------------------------------------

test('AK14 badge: a native button behind the title with its hook, title = explanation, aria-expanded/aria-controls; job 228: the chip of the left island (middle width: icon with aria-label), narrow title and subline as one button (the owner: the link icon)', () => {
	const ast = template('src/components/TopBar.vue')
	const left = findAll(ast, (e) => attr(e, 'data-knorke-island') === 'left')[0]
	assert.ok(left, 'the left island')
	const badges = findAll(left, (e) => attr(e, 'data-knorke-action') === 'link-badge')
	assert.equal(badges.length, 3, 'narrow: the title block and the owner\'s icon; wide: the chip')
	for (const badge of badges) {
		assert.equal(badge.tag, 'button')
		assert.equal(attr(badge, 'type'), 'button')
		assert.equal(attr(badge, 'title'), 'linkExplain')
		assert.equal(attr(badge, 'aria-expanded'), "linkInfoOpen ? 'true' : 'false'")
		assert.equal(attr(badge, 'aria-controls'), 'linkInfoId')
		assert.equal(badge.props.find((p) => p.name === 'ref')?.value?.content, 'badge', 'focusBadge() finds it')
	}
	const [sub, chip, ownerIcon] = badges
	assert.equal(sub.props.find((p) => p.name === 'else-if')?.exp?.content, 'narrow && linkChip', 'everyone but the owner (v-else-if after isOwner)')
	const head = findAll(left, (e) => attr(e, 'class') === 'knorke-topbar__head')[0]
	assert.ok(findAll(head, (e) => e === sub).length === 1, 'the title block itself')
	assert.deepEqual(findAll(sub, (e) => e.tag === 'span').map((e) => attr(e, 'class')), ['knorke-topbar__title-text', 'knorke-topbar__subline'])
	assert.equal(ownerIcon.props.find((p) => p.name === 'if')?.exp?.content, 'isOwner && linkChip')
	assert.equal(attr(ownerIcon, 'aria-label'), "t('knorke', 'Open by link')")
	assert.equal(chip.props.find((p) => p.name === 'if')?.exp?.content, 'linkChip')
	assert.equal(attr(chip, 'aria-label'), "mid ? t('knorke', 'Open by link') : null")
	const text = findAll(chip, (e) => e.tag === 'span')[0]
	assert.equal(text.props.find((p) => p.name === 'if')?.exp?.content, '!mid', 'the text only above the middle width')
	assert.equal(findAll(chip, (e) => e.tag === 'NcIconSvgWrapper' && attr(e, 'path') === 'icons.link').length, 1)
	assert.match(read('src/components/TopBar.vue'), /const linkChip = computed\(\(\) => props\.linkBadge \|\| props\.isGuest\)/, 'job 228: guests have the chip too')
	const src = read('src/components/TopBar.vue')
	assert.match(src, /const linkExplain = explainText\(\)/)
	const css = read('src/styles/knorke.css')
	assert.match(css, /button\.knorke-topbar__linkbadge \{[^}]*min-width: var\(--knorke-btn\) !important;[^}]*min-height: var\(--knorke-btn\) !important;/, 'job 226: as large as the bar\'s buttons (36 px, 44 px with a coarse pointer)')
	assert.match(css, /@media \(pointer: coarse\) \{\s*:root \{\s*--knorke-bar-h: var\(--k-bar-h-touch\);\s*--knorke-btn: var\(--k-btn-touch\);/, '44 px hit area with a coarse pointer (job 226: the bar\'s buttons are 44 px there)')
})

test('AK14 board view: the card is the last child of the polite banner region; the badge only for accounts; the guest card from PublicApp', () => {
	const ast = template('src/views/BoardView.vue')
	const banners = findAll(ast, (e) => attr(e, 'class') === 'knorke-banners')[0]
	assert.equal(attr(banners, 'aria-live'), 'polite')
	const last = banners.children.filter((c) => c.type === 1).at(-1)
	assert.equal(last.tag, 'PrivacyInfo')
	assert.equal(attr(last, 'id'), 'privacyCardId')
	assert.equal(attr(last, 'kind'), 'privacyCard.kind')
	assert.equal(attr(last, 'vote'), "me !== null && me.role === 'vote'", 'the voting role gets its built-in text')
	const top = findAll(ast, (e) => e.tag === 'TopBar')[0]
	assert.equal(attr(top, 'link-badge'), 'linkBadge')
	assert.equal(attr(top, 'link-info-id'), 'privacyCardId')
	const src = read('src/views/BoardView.vue')
	assert.match(src, /const linkBadge = computed\(\(\) => props\.mode === 'user' && linkOpen\(board\.value, serverNow\(\)\)\)/)
	assert.match(src, /markAccountSeen\(o, privacyStorage\)\s*if \(privacyCard\.value === null\) \{\s*privacyCard\.value = \{ kind: 'account', viaBadge: false \}/, 'remembered when shown, no focus move')
	assert.match(src, /r && props\.mode === 'guest' && props\.guestPrivacyInfo && !guestCardShown/)
	assert.doesNotMatch(read('src/components/bars.js'), /privacy/, 'no banner strip')
})

test('AK12 PublicApp: the name phase marks the tab session; a returning guest without the mark gets it and the card', () => {
	const src = read('src/PublicApp.vue')
	assert.match(src, /if \(boardId !== null && phase\.value === 'board' && guestInfoDue\(privacyStorage, boardId\)\) \{\s*markGuestSeen\(privacyStorage, boardId\)\s*guestPrivacyInfo\.value = true/)
	assert.match(src, /watch\(phase, \(p\) => \{\s*if \(p === 'name' && boardId !== null\) \{\s*markGuestSeen\(privacyStorage, boardId\)/)
	assert.match(src, /:guest-privacy-info="guestPrivacyInfo"/)
	assert.match(src, /:privacy="privacy"\s*@join="onName"/)
	assert.match(read('src/App.vue'), /mode="user"[\s\S]*:privacy="state\.privacy \|\| null"/)
})

// ---- admin page (AK15) ----------------------------------------------------

const ADMIN = Object.freeze({
	settings: { default: { text: 'T0', url: '' }, languages: { de: { text: 'Tde', url: 'https://example.org/ude' } } },
	languages: [{ code: 'de', name: 'Deutsch' }, { code: 'en', name: 'English (US)' }, { code: 'fr', name: 'Français' }],
	themingUrl: 'https://example.org/theming',
	textMax: 2000,
	languagesMax: 20,
})

let calls
let answers

beforeEach(() => {
	calls = []
	answers = []
	globalThis._nc_auth_requestToken = 'tok1'
	boards.deps.urlOf = (p) => '/index.php/apps/knorke' + p
	boards.deps.csrfUrl = () => '/index.php/csrftoken'
	boards.deps.request = async (method, url, opts) => {
		calls.push({ method, url, body: opts.body })
		const a = answers.shift()
		if (a instanceof Error) {
			throw a
		}
		return a
	}
})

afterEach(() => {
	delete globalThis._nc_auth_requestToken
})

// ---- admin page (AK15; factory job 281, design A3: AK1–AK9) --------------------

const AdminSection = (await import('../../../src/admin/AdminSection.vue')).default
const NoticeFields = (await import('../../../src/admin/NoticeFields.vue')).default
const page = await import('../../../src/admin/adminPage.js')
const notice = await import('../../../src/admin/noticeForm.js')

const AI = Object.freeze({
	enabled: true,
	dailyLimit: 30,
	limitMax: 1000,
	provider: true,
	notice: { settings: { default: { text: '', url: '' }, languages: {} }, languages: ADMIN.languages, themingUrl: '', textMax: 2000, languagesMax: 20 },
})
const STATE = Object.freeze({ page: 'admin', privacyAdmin: { ...ADMIN, ai: AI } })
const tick = () => new Promise((r) => setTimeout(r, 0))
/** @return {object} the page's bindings */
const pageOf = (state = STATE) => setupOf(AdminSettings, { state }).bindings

/**
 * The page with its state changed before the render (lists loaded, sections open).
 *
 * @param {Function} change (bindings) => void
 * @return {Promise<string>} SSR HTML
 */
function renderPage(change) {
	return render({
		...AdminSettings,
		setup(props, ctx) {
			const b = AdminSettings.setup(props, ctx)
			change(b)
			return b
		},
	}, { state: STATE })
}

test('job 281 AK1 page: root, the four sections in order with a head button each (aria-expanded, aria-controls), bodies hidden, no notice, no pill, no bar', async () => {
	const html = await render(AdminSettings, {}, { 'knorke-state': STATE })
	assert.match(html, /^<div class="section knorke-admin knorke-admin-page" data-knorke-admin-page>/)
	assert.doesNotMatch(html, /data-knorke-admin-notice/, 'no suggestions: no notice')
	assert.doesNotMatch(html, /data-knorke-admin-count/, 'no pill')
	assert.doesNotMatch(html, /data-knorke-admin-savebar/, 'nothing changed: no bar')
	assert.deepEqual([...html.matchAll(/data-knorke-admin-section="([a-z]+)" data-knorke-open="false"/g)].map((m) => m[1]), page.SECTIONS)
	for (const k of page.SECTIONS) {
		assert.match(html, new RegExp(`<h2 class="knorke-admin-section__heading"><button type="button" class="knorke-admin-section__head" aria-expanded="false" aria-controls="knorke-admin-${k}-body" data-knorke-admin-toggle="${k}">`))
		assert.match(html, new RegExp(`<div id="knorke-admin-${k}-body" class="knorke-admin-section__body" style="display:none;">`), `${k}: closed body stays in the DOM`)
	}
	// the hooks of the forms stay (SPEC-M1 §6.8 R40), the three Save buttons are gone
	for (const h of ['data-knorke-admin="privacy"', 'data-knorke-admin="ai"', 'data-knorke-admin="templates"', 'data-knorke-admin="shapelibs"',
		'data-knorke-field="privacy-text" data-knorke-lang="default"', 'data-knorke-field="privacy-url"', 'data-knorke-field="privacy-language"', 'data-knorke-action="privacy-add-language"',
		'data-knorke-action="privacy-remove-language"', 'data-knorke-field="ai-enabled"', 'data-knorke-field="ai-limit"', 'data-knorke-field="ai-text"', 'role="status" data-knorke-admin-status']) {
		assert.ok(html.includes(h), h)
	}
	assert.match(html, /<fieldset class="knorke-admin__block knorke-admin__lang" data-knorke-lang="de"><legend>Deutsch \(de\)<\/legend>/)
	assert.match(html, /<input id="knorke-privacy-default-url"[^>]* type="url" placeholder="https:\/\/example\.org\/theming"/)
	const select = html.match(/<select[^>]*data-knorke-field="privacy-language"[^>]*>([\s\S]*?)<\/select>/)
	assert.doesNotMatch(select[1], /value="de"/, 'a used language is not offered')
	assert.match(html, /<div data-stub="NcButton" disabled data-knorke-action="privacy-add-language">/, 'Add disabled without a choice')
	assert.doesNotMatch(html, /privacy-save|ai-save|ai-switch-save/)
	for (const f of ['AdminSettings.vue', 'AdminSection.vue', 'NoticeFields.vue', 'TemplateAdmin.vue', 'ShapeLibAdmin.vue']) {
		assert.doesNotMatch(read('src/admin/' + f), /v-html/, f)
	}
	// job 217: the admin page mounts the lazy part admin once loaded; the other pages never load it
	assert.match(read('src/main.js'), /if \(state\.page === 'admin'\) \{\s+loadPart\('admin'\)\.then\(\(m\) => m && mount\(m\.default\)\)\s+\} else \{\s+mount\(state\.page === 'public' \? PublicApp : App\)/)
	assert.doesNotMatch(read('src/main.js'), /import AdminSettings/)
})

test('job 281 AK1 page: the notice counts both lists (plural), the pills stand at their sections only while suggestions are open', async () => {
	const html = await renderPage((b) => {
		b.lists.templates = { state: 'ready', suggestions: 2, adopted: 3 }
		b.lists.shapelibs = { state: 'ready', suggestions: 1, adopted: 0 }
	})
	assert.match(html, /<p class="knorke-admin__notice" data-knorke-admin-notice><div data-stub="NcIconSvgWrapper"[^>]*><\/div><span>3 suggestions are waiting for you<\/span><\/p>/)
	assert.match(html, /<span class="knorke-admin-section__count" data-knorke-admin-count="templates">2<\/span>/)
	assert.match(html, /<span class="knorke-admin-section__count" data-knorke-admin-count="shapelibs">1<\/span>/)
	const one = await renderPage((b) => {
		b.lists.templates = { state: 'ready', suggestions: 0, adopted: 3 }
		b.lists.shapelibs = { state: 'ready', suggestions: 1, adopted: 0 }
	})
	assert.match(one, /<span>1 suggestion is waiting for you<\/span>/)
	assert.doesNotMatch(one, /data-knorke-admin-count="templates"/)
	assert.equal(n('knorke', '%n suggestion is waiting for you', '%n suggestions are waiting for you', 2), '2 suggestions are waiting for you')
})

test('job 281 AK2 opening on load: the first list with suggestions, every list that failed; never closes an open section; once', async () => {
	const ready = (s) => ({ state: 'ready', suggestions: s, adopted: 0 })
	assert.equal(page.initialOpen({ templates: { state: 'loading' }, shapelibs: ready(1) }), null, 'waits for both lists')
	assert.deepEqual(page.initialOpen({ templates: ready(0), shapelibs: ready(2) }), ['shapelibs'])
	assert.deepEqual(page.initialOpen({ templates: ready(1), shapelibs: ready(2) }), ['templates'])
	assert.deepEqual(page.initialOpen({ templates: ready(0), shapelibs: ready(0) }), [])
	assert.deepEqual(page.initialOpen({ templates: { state: 'error', suggestions: 0 }, shapelibs: ready(0) }), ['templates'])
	assert.deepEqual(page.initialOpen({ templates: { state: 'error', suggestions: 0 }, shapelibs: ready(1) }), ['templates', 'shapelibs'])

	const b = pageOf()
	b.toggle('privacy')
	b.lists.templates = ready(0)
	await tick()
	assert.deepEqual({ ...b.open }, { templates: false, shapelibs: false, ai: false, privacy: true }, 'nothing while a list loads')
	b.lists.shapelibs = ready(3)
	await tick()
	assert.deepEqual({ ...b.open }, { templates: false, shapelibs: true, ai: false, privacy: true }, 'shape libraries open, the privacy section the admin opened stays')
	b.toggle('shapelibs')
	b.lists.shapelibs = { state: 'loading', suggestions: 3, adopted: 0 }
	await tick()
	b.lists.shapelibs = ready(2)
	await tick()
	assert.equal(b.open.shapelibs, false, 'a later load (after Adopt) opens nothing')
})

test('job 281 AK3 lines under the titles: the state while closed, the explaining sentence while open', async () => {
	assert.equal(page.listSummary({ state: 'loading' }, 'X'), 'Loading …')
	assert.equal(page.listSummary({ state: 'error' }, 'The templates could not be loaded.'), 'The templates could not be loaded.')
	assert.equal(page.listSummary({ state: 'ready', suggestions: 0, adopted: 0 }, 'X'), 'No open suggestions · none adopted yet')
	assert.equal(page.listSummary({ state: 'ready', suggestions: 1, adopted: 3 }, 'X'), '1 open suggestion · 3 adopted')
	assert.equal(page.aiSummary({ provider: false, enabled: true, limit: 30, ownNotice: false }), 'No AI provider set up · Allowed · 30 tasks per account and day · Notice: built-in text')
	assert.equal(page.aiSummary({ provider: true, enabled: false, limit: 1, ownNotice: true }), 'Not allowed · 1 task per account and day · Notice: own text')
	assert.equal(page.privacySummary({ ownText: false, languages: 0, url: '', themingUrl: '' }), 'Built-in text · No address')
	assert.equal(page.privacySummary({ ownText: true, languages: 2, url: ' ', themingUrl: 'https://t' }), 'Own text, 2 languages · Address from the Theming settings')
	assert.equal(page.privacySummary({ ownText: false, languages: 1, url: 'https://x', themingUrl: 'https://t' }), 'Built-in text, 1 language · Own address')
	assert.equal(page.ownText({ text: ' ' }, [{ text: '' }, { text: 'x' }]), true)
	assert.equal(page.ownText({ text: '' }, []), false)

	const b = pageOf({ page: 'admin', privacyAdmin: { ...ADMIN, ai: { ...AI, provider: false, enabled: false } } })
	assert.equal(b.aiLine.value, 'No AI provider set up · Not allowed · 30 tasks per account and day · Notice: built-in text')
	assert.equal(b.privacyLine.value, 'Own text, 1 language · Address from the Theming settings')
	b.privacyForm.defaults.url = 'https://example.org/own'
	assert.equal(b.privacyLine.value, 'Own text, 1 language · Own address', 'the line follows the form')
	const html = await renderPage((p) => {
		p.open.ai = true
		p.lists.templates = { state: 'ready', suggestions: 0, adopted: 0 }
	})
	assert.match(html, /data-knorke-admin-summary="ai">Signed-in people with the right to edit can summarise notes/)
	assert.match(html, /aria-expanded="true" aria-controls="knorke-admin-ai-body"/)
	assert.match(html, /data-knorke-admin-summary="templates">No open suggestions · none adopted yet</)
	assert.match(html, /data-knorke-admin-summary="privacy">Own text, 1 language · Address from the Theming settings</)
})

test('job 281 AK4 save bar: only while something changed (a field, a language, the AI switch); Discard puts everything back', async () => {
	const b = pageOf()
	assert.equal(b.dirty.value, false)
	b.privacyForm.defaults.text = 'Neu'
	assert.equal(b.dirty.value, true)
	assert.equal(b.barLine.value, 'Unsaved changes')
	const html = await renderPage((p) => { p.privacyForm.defaults.text = 'Neu' })
	assert.match(html, /<div class="knorke-admin__savebar" data-knorke-admin-savebar><p class="knorke-admin__savebar-text" data-knorke-admin-savebar-text>(?:<!---->)?\s*Unsaved changes\s*<\/p>/)
	assert.match(html, /data-stub="NcButton" variant="tertiary" data-knorke-action="admin-discard">Discard</)
	assert.match(html, /data-stub="NcButton" variant="primary" data-knorke-action="admin-save">Save</)
	b.discard()
	assert.equal(b.privacyForm.defaults.text, 'T0')
	assert.equal(b.dirty.value, false)
	b.privacyForm.pick.value = 'fr'
	b.privacyForm.add()
	assert.deepEqual(b.privacyForm.entries.value.map((e) => e.code), ['de', 'fr'])
	assert.equal(b.dirty.value, true, 'a new language')
	b.discard()
	assert.deepEqual(b.privacyForm.entries.value.map((e) => e.code), ['de'])
	b.aiEnabled.value = false
	assert.equal(b.dirty.value, true, 'the AI switch')
	b.aiEnabled.value = true
	assert.equal(b.dirty.value, false, 'back to the saved value: no bar')
	b.aiLimit.value = 12
	b.aiForm.defaults.url = 'https://ai.example'
	b.discard()
	assert.deepEqual([b.aiLimit.value, b.aiForm.defaults.url, b.dirty.value], [30, '', false])
})

test('job 281 AK5 the browser checks addresses and the daily limit: error at the field, count in the bar, Save blocked', async () => {
	assert.equal(notice.urlProblem(''), null)
	assert.equal(notice.urlProblem('  https://example.org/p  '), null)
	assert.equal(notice.urlProblem('HTTP://example.org'), null)
	for (const bad of ['javascript:alert(1)', 'example.org', 'https://', 'ftp://example.org', 'https://exa mple.org', 'https://a\u0007b']) {
		assert.equal(notice.urlProblem(bad), 'invalid_url', bad)
	}
	assert.equal(notice.urlProblem('https://example.org/' + 'x'.repeat(2048)), 'too_long')

	const b = pageOf()
	b.privacyForm.entries.value[0].url = 'javascript:alert(1)'
	assert.deepEqual(b.privacyForm.errors.value, [{ at: 'de', field: 'url', code: 'invalid_url', text: 'Enter an address starting with http:// or https://.' }])
	assert.equal(b.barLine.value, '1 error in Privacy notice')
	b.aiLimit.value = 1001
	assert.equal(b.barLine.value, '1 error in AI · 1 error in Privacy notice')
	assert.equal(b.limitError.value.text, 'Enter a whole number from 0 to 1000.')
	b.aiLimit.value = ''
	assert.ok(b.limitError.value, 'an empty limit is an error too')
	b.aiForm.defaults.url = 'nope'
	assert.equal(b.barLine.value, '2 errors in AI · 1 error in Privacy notice')
	await b.save()
	assert.equal(calls.length, 0, 'Save is blocked')
	const html = await renderPage((p) => { p.privacyForm.defaults.url = 'nope' })
	assert.match(html, /data-knorke-admin-savebar-text><div data-stub="NcIconSvgWrapper"[^>]*><\/div> 1 error in Privacy notice/)
	assert.match(html, /<div data-stub="NcButton" variant="primary" disabled data-knorke-action="admin-save">/)
	assert.match(html, /<input id="knorke-privacy-default-url"[^>]*aria-invalid="true" aria-describedby="knorke-privacy-default-url-hint knorke-privacy-default-error"/)
	assert.match(html, /<p id="knorke-privacy-default-error" class="knorke-admin__error" data-knorke-error="invalid_url">/)
	b.aiLimit.value = 30
	b.aiForm.defaults.url = ''
	b.privacyForm.entries.value[0].url = 'https://example.org/ok'
	assert.equal(b.errorCount.value, 0)
	assert.equal(b.barLine.value, 'Unsaved changes')
})

test('job 281 AK6 one Save: route 58 for the AI part, then route 27; a 400 stops at its field; other errors the alert; done: "Saved."', async () => {
	const AI_URL = '/index.php/apps/knorke/api/v1/settings/ai'
	const PRIVACY_URL = '/index.php/apps/knorke/api/v1/settings/privacy'
	const aiAnswer = (o = {}) => ({ ai: { ...AI, ...o, notice: { ...AI.notice, settings: o.settings ?? AI.notice.settings } } })

	// only AI
	let b = pageOf()
	b.aiLimit.value = 12
	answers = [aiAnswer({ dailyLimit: 12 })]
	await b.save()
	assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PUT', AI_URL]])
	assert.deepEqual(calls[0].body, { enabled: true, dailyLimit: 12, notice: { default: { text: '', url: '' }, languages: {} } })
	assert.deepEqual([b.dirty.value, b.status.value], [false, 'Saved.'])
	b.aiEnabled.value = false
	assert.equal(b.status.value, 'Saved.', 'the watcher clears it on the next tick')
	await tick()
	assert.equal(b.status.value, '', '"Saved." goes with the next change')

	// only privacy
	calls = []
	b = pageOf()
	b.privacyForm.defaults.text = 'Neu\nT0'
	answers = [{ privacy: { default: { text: 'Neu\nT0', url: '' }, languages: { de: { text: 'Tde', url: 'https://example.org/ude' } } } }]
	await b.save()
	assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PUT', PRIVACY_URL]])
	assert.deepEqual(calls[0].body, { default: { text: 'Neu\nT0', url: '' }, languages: { de: { text: 'Tde', url: 'https://example.org/ude' } } })
	assert.equal(b.dirty.value, false)

	// both: 58 then 27
	calls = []
	b = pageOf()
	b.aiEnabled.value = false
	b.privacyForm.defaults.text = 'X'
	answers = [aiAnswer({ enabled: false }), { privacy: { default: { text: 'X', url: '' }, languages: { de: { text: 'Tde', url: 'https://example.org/ude' } } } }]
	await b.save()
	assert.deepEqual(calls.map((c) => c.url), [AI_URL, PRIVACY_URL])
	assert.deepEqual([b.dirty.value, b.aiEnabled.value, b.status.value], [false, false, 'Saved.'])

	// a 400 of route 58: route 27 not sent, the AI section opens, the error stands at its field
	calls = []
	b = pageOf()
	b.aiForm.defaults.text = 'x'
	b.privacyForm.defaults.text = 'Y'
	answers = [new HttpError(400, 'text_too_long', 'x', null, true, { error: 'text_too_long', at: 'default', max: 2000 })]
	await b.save()
	assert.deepEqual(calls.map((c) => c.url), [AI_URL])
	assert.equal(b.open.ai, true)
	assert.deepEqual(b.aiForm.errors.value, [{ at: 'default', field: 'text', code: 'text_too_long', text: 'At most 2000 characters.' }])
	assert.equal(b.barLine.value, '1 error in AI')
	assert.equal(b.status.value, '')
	b.aiForm.serverError.value = null // what the next input in the section does

	// any other error: the alert, nothing saved
	calls = []
	answers = [new HttpError(500, 'internal', 'x', null, true)]
	await b.save()
	assert.equal(b.failure.value, 'The settings could not be saved.')
	assert.equal(b.dirty.value, true)
	assert.match(read('src/admin/AdminSettings.vue'), /<p v-if="failure" class="knorke-admin__error" role="alert" data-knorke-error="save">/)
})

test('job 281 risk: route 58 saved, route 27 refused: the AI part counts as saved and is not sent again', async () => {
	const b = pageOf()
	b.aiLimit.value = 5
	b.privacyForm.defaults.url = 'https://example.org/p'
	answers = [{ ai: { ...AI, dailyLimit: 5 } }, new HttpError(400, 'invalid_url', 'x', null, true, { error: 'invalid_url', at: 'default' })]
	await b.save()
	assert.equal(calls.length, 2)
	assert.equal(b.aiDirty.value, false, 'AI saved')
	assert.equal(b.open.privacy, true, 'the privacy section opens at its error')
	assert.equal(b.barLine.value, '1 error in Privacy notice')
	b.privacyForm.serverError.value = null
	calls = []
	answers = [{ privacy: { default: { text: 'T0', url: 'https://example.org/p' }, languages: { de: { text: 'Tde', url: 'https://example.org/ude' } } } }]
	await b.save()
	assert.deepEqual(calls.map((c) => c.url), ['/index.php/apps/knorke/api/v1/settings/privacy'], 'only route 27')
	assert.equal(b.status.value, 'Saved.')
})

test('job 281 notice form: the codes of a 400 at their fields (AK15), languages added and removed, at most languagesMax', () => {
	const form = notice.createNoticeForm(ADMIN, 'privacy')
	const bad = (code, body) => new HttpError(400, code, 'x', null, true, { error: code, ...body })
	assert.deepEqual(form.takeError(bad('invalid_url', { at: 'de' })), { at: 'de', field: 'url', code: 'invalid_url', text: 'Enter an address starting with http:// or https://.' })
	form.entries.value[0].url = 'https://example.org/' + 'x'.repeat(2048)
	assert.equal(form.takeError(bad('invalid_url', { at: 'de' })).text, 'At most 2048 characters.')
	assert.equal(form.errors.value.length, 1, 'the browser and the server name the same field: one error')
	form.entries.value[0].url = ''
	assert.deepEqual(form.takeError(bad('text_too_long', { at: 'default', max: 2000 })), { at: 'default', field: 'text', code: 'text_too_long', text: 'At most 2000 characters.' })
	assert.deepEqual(form.takeError(bad('too_many_languages', { max: 20 })), { at: 'language', field: 'pick', code: 'too_many_languages', text: 'At most 20 languages.' })
	assert.equal(form.takeError(bad('unknown_language', { at: 'de' })).text, 'This language is not available on this Nextcloud.')
	assert.equal(form.takeError(bad('invalid_url', { at: 'xx' })), null, 'an `at` that is not on the form')
	assert.equal(form.takeError(new HttpError(500, 'internal', 'x', null, true)), null)
	assert.deepEqual(form.free.value.map((l) => l.code), ['en', 'fr'])
	form.pick.value = 'fr'
	assert.equal(form.add(), true)
	assert.equal(form.pick.value, '')
	form.remove('fr')
	assert.deepEqual(form.entries.value.map((e) => e.code), ['de'])

	const many = {}
	for (let i = 0; i < 20; i++) {
		many['l' + i] = { text: 'x', url: '' }
	}
	const full = notice.createNoticeForm({ ...ADMIN, languages: [...Object.keys(many).map((code) => ({ code, name: code })), { code: 'zz', name: 'Zed' }], settings: { default: { text: '', url: '' }, languages: many } }, 'privacy')
	full.pick.value = 'zz'
	assert.equal(full.add(), false)
	assert.equal(full.entries.value.length, 20, 'at 20 entries nothing is added')
	assert.match(read('src/admin/NoticeFields.vue'), /:disabled="pick === '' \|\| entries\.length >= form\.languagesMax"/)
})

test('job 281 notice fields: aria-invalid and aria-describedby name the shown error; the AI form has its own ids and hooks', () => {
	const form = notice.createNoticeForm(ADMIN, 'privacy')
	const { bindings: f } = setupOf(NoticeFields, { form })
	form.defaults.url = 'x'
	assert.equal(f.invalid('default', 'url'), 'true')
	assert.equal(f.invalid('default', 'text'), null)
	assert.equal(f.describedBy('default', 'url'), 'knorke-privacy-default-url-hint knorke-privacy-default-error')
	assert.equal(f.describedBy('de', 'url'), 'knorke-privacy-de-url-hint')
	const ai = setupOf(NoticeFields, { form: notice.createNoticeForm(AI.notice, 'ai') }).bindings
	assert.equal(ai.fieldId('default', 'text'), 'knorke-ai-default-text')
	assert.equal(ai.urlLabel, 'Link')
})

test('job 281 AK8 a text field grows with its text; a hidden one keeps its height', () => {
	const el = { style: { height: '40px' }, scrollHeight: 180, offsetHeight: 64, clientHeight: 60, getClientRects: () => [1] }
	assert.equal(notice.fitHeight(el), true)
	assert.equal(el.style.height, '184px', 'content plus the borders')
	const hidden = { style: { height: '40px' }, scrollHeight: 0, offsetHeight: 0, clientHeight: 0, getClientRects: () => [] }
	assert.equal(notice.fitHeight(hidden), false)
	assert.equal(hidden.style.height, '40px')
	assert.equal(notice.fitHeight(null), false)
	const src = read('src/admin/NoticeFields.vue')
	assert.equal((src.match(/@input="fitHeight\(\$event\.target\)"/g) ?? []).length, 2, 'both text fields fit on input')
	assert.match(src, /onMounted\(fitAll\)/)
	assert.match(read('src/admin/AdminSettings.vue'), /function toggle\(key\) \{\s+open\[key\] = !open\[key\]\s+if \(open\[key\]\) \{\s+for \(const f of noticeFields\(\)\) \{\s+f\.fitAll\?\.\(\)/, 'opening a section fits its fields')
})

test('job 281 risk: closing a section keeps its input (v-show); the head is a native button over the whole row', async () => {
	assert.match(read('src/admin/AdminSection.vue'), /<div v-show="open" :id="bodyId" class="knorke-admin-section__body">/)
	const html = await render(AdminSection, { id: 'ai', title: 'AI', summary: 'S', icon: 'M0 0', count: 0, open: true })
	assert.match(html, /aria-expanded="true"/)
	assert.match(html, /<div id="knorke-admin-ai-body" class="knorke-admin-section__body" style="">/)
	const b = setupOf(AdminSection, { id: 'ai', title: 'AI', icon: 'M0 0', open: false })
	b.bindings.emit('toggle')
	assert.deepEqual(b.emitted, [['toggle']])
	const p = pageOf()
	p.privacyForm.defaults.text = 'unsaved'
	p.toggle('privacy')
	p.toggle('privacy')
	assert.equal(p.privacyForm.defaults.text, 'unsaved')
	assert.equal(p.dirty.value, true, 'the bar stays')
})

test('job 281 AK9 CSS: one column of at most 760 px, heads of 64 px, tiles 40 × 40, the pill, buttons 36/44 px, Nextcloud colours only', () => {
	const css = read('src/styles/knorke.css')
	const rule = (sel) => {
		const m = css.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'm'))
		assert.ok(m, sel)
		return m[1]
	}
	assert.match(rule('.knorke-admin-page'), /max-width: 760px;/)
	assert.match(rule('.knorke-admin-page'), /--default-clickable-area: 36px;/)
	assert.match(css, /@media \(max-width: 600px\), \(pointer: coarse\) \{\s+\.knorke-admin-page \{\s+--default-clickable-area: 44px;/)
	assert.match(css, /@media \(max-width: 600px\) \{\s+\.knorke-admin-page\.section \{\s+padding-inline: 16px;/)
	assert.match(rule('.knorke-admin button.knorke-admin-section__head'), /min-height: 64px !important;/)
	assert.match(rule('.knorke-admin button.knorke-admin-section__head'), /width: 100% !important;/)
	const tile = rule('.knorke-admin-section__tile')
	assert.ok(tile.includes('width: 40px;') && tile.includes('height: 40px;') && tile.includes('border-radius: 10px;') && tile.includes('background: var(--color-primary-element-light);'))
	const pill = rule('.knorke-admin-section__count')
	assert.ok(pill.includes('height: 20px;') && pill.includes('min-width: 22px;') && pill.includes('background: var(--color-primary-element);') && pill.includes('font-size: 12px;'))
	assert.match(rule('.knorke-admin-section__title'), /font-size: 17px;/)
	assert.match(rule('.knorke-admin-section__summary'), /color: var\(--color-text-maxcontrast\);/)
	assert.match(rule('.knorke-admin p.knorke-admin__notice'), /border-inline-start: 4px solid var\(--color-info\);/)
	assert.match(rule('.knorke-admin__savebar'), /position: sticky;\s+bottom: 0;/)
	assert.match(rule('.knorke-admin__field textarea'), /border: 2px solid var\(--color-border-maxcontrast\) !important;\s+border-radius: 8px !important;/)
	assert.match(rule('.knorke-admin p.knorke-admin__error'), /color: var\(--color-error-text\);/)
	// paragraphs keep their look against Nextcloud's `.section p` (two classes and the tag)
	for (const cls of ['hint', 'error', 'status', 'notice', 'savebar-text']) {
		assert.ok(css.includes(`.knorke-admin p.knorke-admin__${cls} {`), cls)
	}
	// every colour of the new rules is a variable
	const start = css.indexOf('/* ---- job 281 (design A3)')
	const block = css.slice(start, css.indexOf('/* job 182: the section "Templates"', start))
	assert.ok(start > 0 && block.length > 500)
	assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, 'no colour literals')
})

test('job 281 round 1 (UI 1): while the save bar shows, the scrolling element keeps a bottom scroll padding of its height', () => {
	const scroller = { style: {}, parentElement: null }
	const mid = { parentElement: scroller }
	const root = { parentElement: mid }
	const styles = new Map([[mid, { overflowY: 'visible' }], [scroller, { overflowY: 'auto' }]])
	assert.equal(page.scrollParent(root, (e) => styles.get(e)), scroller, 'the nearest ancestor that scrolls (#app-content-vue)')
	page.padForBar(scroller, { offsetHeight: 61 })
	assert.equal(scroller.style.scrollPaddingBottom, '77px')
	page.padForBar(scroller, null)
	assert.equal(scroller.style.scrollPaddingBottom, '', 'the bar went: the padding too')
	page.padForBar(null, { offsetHeight: 61 })
	const src = read('src/admin/AdminSettings.vue')
	assert.match(src, /<div v-if="dirty" ref="barEl" class="knorke-admin__savebar"/)
	assert.match(src, /watch\(barEl, \(bar\) => padForBar\(scrollParent\(pageEl\.value\), bar\), \{ flush: 'post' \}\)/)
	assert.match(src, /onBeforeUnmount\(\(\) => padForBar\(scrollParent\(pageEl\.value\), null\)\)/)
})
