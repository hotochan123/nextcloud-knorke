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
	assert.match(css, /\.knorke-dialog__privacy-text:focus-visible \{\s*outline: 2px solid var\(--knorke-primary\);/)
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
	for (const d of ['width: 420px;', 'max-width: 100%;', 'max-height: 40vh;', 'color: var(--knorke-text);', 'background: var(--knorke-surface);', 'border: 1px solid var(--knorke-border);', 'pointer-events: auto;']) {
		assert.ok(card.includes(d), d)
	}
	assert.match(css, /\.knorke-board--narrow \.knorke-privacy-info \{\s*width: 100%;/)
	assert.match(css, /\.knorke-privacy-info__body \{[^}]*overflow-y: auto;/)
	const close = css.match(/button\.knorke-privacy-info__close \{([^}]*)\}/)[1]
	for (const d of ['background: transparent !important;', 'border: 0 !important;', 'box-shadow: none !important;', 'border-radius: 50% !important;', 'width: var(--knorke-clickable) !important;', 'margin-inline-end: -6px !important;']) {
		assert.ok(close.includes(d), d)
	}
	assert.match(css, /@media \(pointer: coarse\) \{\s*button\.knorke-privacy-info__close \{\s*width: var\(--knorke-touch\) !important;\s*height: var\(--knorke-touch\) !important;/)
})

// ---- badge and board view (AK14) -----------------------------------------

test('AK14 badge: a native button behind the title with its hook, title = explanation, aria-expanded/aria-controls; narrow = icon with aria-label', () => {
	const ast = template('src/components/TopBar.vue')
	const header = ast.children.find((c) => c.type === 1)
	const kids = header.children.filter((c) => c.type === 1)
	const badgeAt = kids.findIndex((c) => attr(c, 'data-knorke-action') === 'link-badge')
	assert.ok(badgeAt > 0, 'badge in the top bar')
	const badge = kids[badgeAt]
	assert.equal(badge.tag, 'button')
	assert.equal(attr(badge, 'type'), 'button')
	assert.ok(kids.slice(0, badgeAt).some((c) => c.tag === 'h2'), 'behind the title')
	assert.equal(badge.props.find((p) => p.name === 'if')?.exp?.content, 'linkBadge')
	assert.equal(attr(badge, 'title'), 'linkExplain')
	assert.equal(attr(badge, 'aria-label'), "narrow ? t('knorke', 'Open by link') : null")
	assert.equal(attr(badge, 'aria-expanded'), "linkInfoOpen ? 'true' : 'false'")
	assert.equal(attr(badge, 'aria-controls'), 'linkInfoId')
	const text = findAll(badge, (e) => e.tag === 'span')[0]
	assert.equal(text.props.find((p) => p.name === 'if')?.exp?.content, '!narrow', 'the text only in the wide layout')
	assert.equal(findAll(badge, (e) => e.tag === 'NcIconSvgWrapper' && attr(e, 'path') === 'icons.link').length, 1)
	const src = read('src/components/TopBar.vue')
	assert.match(src, /const linkExplain = explainText\(\)/)
	const css = read('src/styles/knorke.css')
	assert.match(css, /button\.knorke-topbar__linkbadge \{[^}]*min-width: var\(--knorke-clickable\) !important;[^}]*min-height: var\(--knorke-clickable\) !important;/)
	assert.match(css, /button\.knorke-topbar__linkbadge::before \{\s*content: '';\s*position: absolute;\s*inset: calc\(\(var\(--knorke-clickable\) - var\(--knorke-touch\)\) \/ 2 - 1px\) -1px;/, '44 px hit area with a coarse pointer, the 1 px border counted (UI round 1)')
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

test('AK15 admin form: root hook, default text and URL with placeholders and hints, one fieldset per language, native select without used languages, Save', async () => {
	const html = await render(AdminSettings, {}, { 'knorke-state': { page: 'admin', privacyAdmin: ADMIN } })
	assert.match(html, /^<div class="section knorke-admin" data-knorke-admin="privacy">/)
	assert.match(html, /<h2>Privacy notice<\/h2>/)
	assert.match(html, /<textarea id="knorke-privacy-default-text" rows="5" maxlength="2000" placeholder="Everyone on this board sees/)
	assert.match(html, /Empty: Knorke&#39;s built-in text\./)
	assert.match(html, /<input id="knorke-privacy-default-url"[^>]* type="url" placeholder="https:\/\/example\.org\/theming"/)
	assert.match(html, /Empty: the privacy policy URL from the Theming settings\./)
	assert.match(html, /<fieldset class="knorke-admin__block knorke-admin__lang" data-knorke-lang="de"><legend>Deutsch \(de\)<\/legend>/)
	assert.match(html, /Empty: the default is used\./)
	assert.match(html, /Remove Deutsch/)
	const select = html.match(/<select[^>]*data-knorke-field="privacy-language"[^>]*>([\s\S]*?)<\/select>/)
	assert.ok(select, 'a native select')
	assert.doesNotMatch(select[1], /value="de"/, 'a used language is not offered')
	assert.match(select[1], /value="en"[^>]*>\s*English \(US\) \(en\)/)
	assert.match(html, /<div data-stub="NcButton" disabled data-knorke-action="privacy-add-language">/, 'Add disabled without a choice')
	assert.match(html, /data-knorke-action="privacy-save"/)
	assert.match(html, /role="status" data-knorke-admin-status/)
	assert.doesNotMatch(read('src/admin/AdminSettings.vue'), /v-html/)
	assert.match(read('src/main.js'), /state\.page === 'admin' \? AdminSettings : App/)
})

test('AK15 admin form: Save sends the whole form, takes the normalised answer and says "Saved."; add and remove languages', async () => {
	const { bindings: b } = setupOf(AdminSettings, { state: { page: 'admin', privacyAdmin: ADMIN } })
	assert.deepEqual(b.entries.value.map((e) => e.code), ['de'])
	assert.deepEqual(b.free.value.map((l) => l.code), ['en', 'fr'])
	b.pick.value = 'fr'
	b.add()
	assert.deepEqual(b.entries.value.map((e) => e.code), ['de', 'fr'])
	assert.equal(b.pick.value, '')
	b.entries.value[1].text = 'Bonjour'
	b.defaults.text = 'Neu\nT0'
	answers = [{ privacy: { default: { text: 'Neu\nT0', url: '' }, languages: { de: { text: 'Tde', url: 'https://example.org/ude' }, fr: { text: 'Bonjour', url: '' } } } }]
	await b.save()
	assert.equal(calls.length, 1)
	assert.deepEqual([calls[0].method, calls[0].url], ['PUT', '/index.php/apps/knorke/api/v1/settings/privacy'])
	assert.deepEqual(calls[0].body, { default: { text: 'Neu\nT0', url: '' }, languages: { de: { text: 'Tde', url: 'https://example.org/ude' }, fr: { text: 'Bonjour', url: '' } } })
	assert.equal(b.status.value, 'Saved.')
	assert.equal(b.error.value, null)
	b.remove('fr')
	assert.deepEqual(b.entries.value.map((e) => e.code), ['de'])
	assert.equal(b.busy.value, false)
})

test('AK15 admin form: a 400 stands at the field of `at` (aria-invalid, aria-describedby); other errors give the general alert', async () => {
	const { bindings: b } = setupOf(AdminSettings, { state: { page: 'admin', privacyAdmin: ADMIN } })
	const bad = (code, body) => new HttpError(400, code, 'x', null, true, { error: code, ...body })
	answers = [bad('invalid_url', { at: 'de' })]
	await b.save()
	assert.deepEqual(b.error.value, { at: 'de', field: 'url', code: 'invalid_url', text: 'Enter an address starting with http:// or https://.' })
	assert.equal(b.invalid('de', 'url'), 'true')
	assert.equal(b.invalid('de', 'text'), null)
	assert.equal(b.describedBy('de', 'url'), 'knorke-privacy-de-url-hint knorke-privacy-de-error')
	assert.equal(b.status.value, '')
	b.entries.value[0].url = 'https://example.org/' + 'x'.repeat(2048)
	answers = [bad('invalid_url', { at: 'de' })]
	await b.save()
	assert.deepEqual([b.error.value.field, b.error.value.text], ['url', 'At most 2048 characters.'], 'code review 4: a too long address says so')
	answers = [bad('text_too_long', { at: 'default', max: 2000 })]
	await b.save()
	assert.deepEqual([b.error.value.at, b.error.value.field, b.error.value.text], ['default', 'text', 'At most 2000 characters.'])
	answers = [bad('too_many_languages', { max: 20 })]
	await b.save()
	assert.deepEqual([b.error.value.at, b.error.value.field, b.error.value.text], ['language', 'pick', 'At most 20 languages.'])
	answers = [bad('unknown_language', { at: 'de' })]
	await b.save()
	assert.deepEqual([b.error.value.at, b.error.value.text], ['de', 'This language is not available on this Nextcloud.'])
	answers = [new HttpError(500, 'internal', 'x', null, true)]
	await b.save()
	assert.equal(b.error.value, null)
	assert.equal(b.failure.value, 'The settings could not be saved.')
	answers = [bad('invalid_url', { at: 'xx' })]
	await b.save()
	assert.equal(b.failure.value, 'The settings could not be saved.', 'an `at` that is not on the form: the general message')
})

test('AK15 admin form: Add language is refused at languagesMax entries and for a language already on the form', () => {
	const many = {}
	for (let i = 0; i < 20; i++) {
		many['l' + i] = { text: 'x', url: '' }
	}
	const languages = [...Object.keys(many).map((code) => ({ code, name: code })), { code: 'zz', name: 'Zed' }]
	const { bindings: b } = setupOf(AdminSettings, { state: { privacyAdmin: { ...ADMIN, languages, settings: { default: { text: '', url: '' }, languages: many } } } })
	assert.equal(b.entries.value.length, 20)
	b.pick.value = 'zz'
	b.add()
	assert.equal(b.entries.value.length, 20, 'at 20 entries nothing is added')
	assert.match(read('src/admin/AdminSettings.vue'), /:disabled="pick === '' \|\| entries\.length >= languagesMax"/)
})

test('round 1 (UI 1, UX 5): the admin paragraphs beat Nextcloud\'s `.section p`; "Saved." goes with the next change', () => {
	const css = read('src/styles/knorke.css')
	for (const [cls, decl] of [['intro', 'color: var(--knorke-text-muted);'], ['hint', 'color: var(--knorke-text-muted);'], ['error', 'color: var(--knorke-error-text);'], ['status', 'margin: 0;']]) {
		const m = css.match(new RegExp(`\\.knorke-admin p\\.knorke-admin__${cls} \\{([^}]*)\\}`))
		assert.ok(m, `.knorke-admin p.knorke-admin__${cls} (specificity 0,2,1 > .section p 0,1,1)`)
		assert.ok(m[1].includes(decl), `${cls}: ${decl}`)
		assert.match(m[1], /margin:/, `${cls}: its own margin`)
	}
	assert.match(css.match(/\.knorke-admin p\.knorke-admin__error \{([^}]*)\}/)[1], /background: var\(--knorke-error\);/, 'error text and background as a pair')
	assert.doesNotMatch(css, /^\.knorke-admin__(intro|hint|error|status) \{/m, 'no one-class rule Nextcloud would beat')
	const src = read('src/admin/AdminSettings.vue')
	assert.match(src, /@input="status = ''"/, 'typing clears "Saved."')
	const { bindings: b } = setupOf(AdminSettings, { state: { page: 'admin', privacyAdmin: ADMIN } })
	b.status.value = 'Saved.'
	b.pick.value = 'fr'
	b.add()
	assert.equal(b.status.value, '', 'adding a language clears "Saved."')
	b.status.value = 'Saved.'
	b.remove('fr')
	assert.equal(b.status.value, '', 'removing one too')
})
