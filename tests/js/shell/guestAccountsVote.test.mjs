/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Job 184: while a vote for signed-in accounts only runs, the guest name
 * dialog of a link without a password says so and offers "Sign in"
 * (AK2: GuestNameDialog rendered in Node through ./sfc.mjs and read as
 * template AST; AK3: PublicApp's prop from linkInfo and its sign-in, with
 * the initial state provided like main.js does).
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()

// @nextcloud/router builds URLs from the web root (empty, as in the other shell tests)
globalThis.window ??= { _oc_webroot: '' }

const { createApp, createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const { t, n } = await import('../../../src/util/l10n.js')
const { signInUrl } = await import('../../../src/util/routes.js')
const { HttpError } = await import('../../../src/sync/http.js')
const GuestNameDialog = (await import('../../../src/components/GuestNameDialog.vue')).default
const PublicApp = (await import('../../../src/PublicApp.vue')).default

const SENTENCE = 'Only signed-in accounts can vote right now.'
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx'
const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

/** Every prop of GuestNameDialog with its default (setupOf takes them as given). */
const DIALOG_PROPS = Object.freeze({
	initialName: '', maxLength: 40, busy: false, error: '', legal: null, needsPassword: false,
	passwordError: '', passwordCode: '', linkRole: 'edit', privacy: null, accountsOnlyVote: false,
})

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

/**
 * @param {object} el element
 * @param {string} event event name
 * @return {string|null} the handler expression of @event
 */
function on(el, event) {
	return el.props.find((x) => x.type === 7 && x.name === 'on' && x.arg?.content === event)?.exp?.content ?? null
}

/**
 * @param {object} linkInfo initial state linkInfo
 * @return {object} the initial state of the guest page (name phase)
 */
function pageState(linkInfo) {
	return { page: 'public', boardId: 7, linkToken: TOKEN, linkState: 'ok', linkInfo, limits: {}, legal: null, privacy: null }
}

/**
 * PublicApp's setup bindings with the initial state provided (inject needs
 * an app context; lifecycle hooks are not run).
 *
 * @param {object} state initial state
 * @return {object} bindings
 */
function publicApp(state) {
	const app = createApp({})
	app.provide('knorke-state', state)
	return app.runWithContext(() => setupOf(PublicApp, {})).bindings
}

const location = globalThis.window.location
afterEach(() => {
	globalThis.window.location = location
})

// ---- AK2: GuestNameDialog ------------------------------------------------

test('job 184 AK2 GuestNameDialog: with accountsOnlyVote the block with the sentence and "Sign in" (edit and voting link) between the intro and the privacy notice', async () => {
	for (const linkRole of ['edit', 'vote']) {
		const html = await render(GuestNameDialog, { linkRole, accountsOnlyVote: true })
		const block = html.match(/<div class="knorke-dialog__accounts" data-knorke="accounts-vote">([\s\S]*?)<\/div><div[^>]*data-knorke="privacy-notice"/)
		assert.ok(block, `${linkRole}: the block, right before the privacy notice`)
		assert.ok(html.indexOf('knorke-dialog__message') < html.indexOf('data-knorke="accounts-vote"'), `${linkRole}: under the intro`)
		assert.match(block[1], new RegExp(`<p[^>]*>\\s*${SENTENCE.replace(/\./g, '\\.')}\\s*</p>`), `${linkRole}: the sentence`)
		const btn = block[1].match(/<div data-stub="NcButton"[^>]*>([\s\S]*?)<\/div>/)
		assert.ok(btn, `${linkRole}: the button in the block`)
		assert.match(btn[0], /data-knorke-action="guest-signin"/)
		assert.match(btn[0], /type="button"/, 'never a submit button')
		assert.match(btn[0], /variant="secondary"/)
		assert.doesNotMatch(btn[0], /\bdisabled\b/, 'enabled while not busy')
		assert.equal(btn[1].trim(), 'Sign in')
		assert.equal((html.match(/data-knorke-action="guest-signin"/g) || []).length, 1)
	}
	const busy = await render(GuestNameDialog, { accountsOnlyVote: true, busy: true })
	assert.match(busy.match(/<div data-stub="NcButton"[^>]*data-knorke-action="guest-signin"[^>]*>/)[0], /\bdisabled\b/, 'disabled while busy')
})

test('job 184 AK2 GuestNameDialog: the voting link keeps "Your votes are anonymous."; without the prop neither block nor button', async () => {
	const vote = await render(GuestNameDialog, { linkRole: 'vote', accountsOnlyVote: true })
	assert.ok(vote.includes('Your votes are anonymous.'), 'the intro stays')
	assert.ok(vote.includes(SENTENCE))
	for (const props of [{ linkRole: 'vote' }, { linkRole: 'edit' }, { linkRole: 'vote', accountsOnlyVote: false }]) {
		const html = await render(GuestNameDialog, props)
		assert.doesNotMatch(html, /accounts-vote|guest-signin|knorke-dialog__accounts/, JSON.stringify(props))
		assert.ok(!html.includes(SENTENCE), JSON.stringify(props))
	}
	const before = await render(GuestNameDialog, { linkRole: 'vote' })
	assert.equal(await render(GuestNameDialog, { linkRole: 'vote', accountsOnlyVote: false }), before, 'without the prop the dialog is unchanged')
})

test('job 184 AK2 GuestNameDialog: "Join" stays the primary submit button, "Sign in" is a secondary type button that emits signin, never join', () => {
	const ast = template('src/components/GuestNameDialog.vue')
	const join = findAll(ast, (e) => attr(e, 'data-knorke-action') === 'guest-join')
	assert.equal(join.length, 1)
	assert.deepEqual([attr(join[0], 'type'), attr(join[0], 'variant')], ['submit', 'primary'])
	const signin = findAll(ast, (e) => attr(e, 'data-knorke-action') === 'guest-signin')
	assert.equal(signin.length, 1)
	assert.equal(signin[0].tag, 'NcButton')
	assert.deepEqual([attr(signin[0], 'type'), attr(signin[0], 'variant'), attr(signin[0], 'disabled')], ['button', 'secondary', 'busy'])
	assert.equal(on(signin[0], 'click'), 'signIn')
	const block = findAll(ast, (e) => attr(e, 'data-knorke') === 'accounts-vote')
	assert.equal(block.length, 1)
	assert.equal(block[0].props.find((x) => x.type === 7 && x.name === 'if')?.exp?.content, 'accountsOnlyVote')
	assert.ok(findAll(block[0], (e) => attr(e, 'data-knorke-action') === 'guest-signin').length === 1, 'the button sits in the block')

	let s = setupOf(GuestNameDialog, { ...DIALOG_PROPS, accountsOnlyVote: true, initialName: 'Gina' })
	s.bindings.signIn()
	assert.deepEqual(s.emitted, [['signin']], 'Sign in: signin only')
	s.bindings.submit()
	assert.deepEqual(s.emitted, [['signin'], ['join', 'Gina', null]], 'the form submit (Enter, Join) still joins as a guest')
	s = setupOf(GuestNameDialog, { ...DIALOG_PROPS, accountsOnlyVote: true, busy: true })
	s.bindings.signIn()
	assert.deepEqual(s.emitted, [], 'nothing while busy')
})

// ---- AK3: PublicApp ------------------------------------------------------

test('job 184 AK3 PublicApp: the hint only for linkInfo.accountsOnlyVote === true without a password field', async () => {
	const yes = { role: 'vote', password: false, accountsOnlyVote: true }
	assert.equal(publicApp(pageState(yes)).accountsOnlyVote.value, true)
	assert.equal(publicApp(pageState({ ...yes, role: 'edit' })).accountsOnlyVote.value, true)
	for (const [what, info] of [
		["'true'", { ...yes, accountsOnlyVote: 'true' }],
		['1', { ...yes, accountsOnlyVote: 1 }],
		['missing', { role: 'vote', password: false }],
		['false', { ...yes, accountsOnlyVote: false }],
		['no linkInfo', null],
		['needsPassword (a link with a password)', { ...yes, password: true }],
	]) {
		assert.equal(publicApp(pageState(info)).accountsOnlyVote.value, false, what)
	}
	// the prop reaches the dialog of the name phase
	const html = await render(PublicApp, {}, { 'knorke-state': pageState(yes) })
	assert.match(html, /data-knorke-dialog="guest-name"/)
	assert.match(html, /data-knorke="accounts-vote"/)
	assert.ok(html.includes(SENTENCE))
	for (const info of [{ role: 'vote', password: false }, { ...yes, password: true }]) {
		const off = await render(PublicApp, {}, { 'knorke-state': pageState(info) })
		assert.match(off, /data-knorke-dialog="guest-name"/)
		assert.doesNotMatch(off, /accounts-vote|guest-signin/, JSON.stringify(info))
	}
	const ast = template('src/PublicApp.vue')
	const dialog = findAll(ast, (e) => e.tag === 'GuestNameDialog')[0]
	assert.equal(attr(dialog, 'accounts-only-vote'), 'accountsOnlyVote')
	assert.equal(on(dialog, 'signin'), 'onSignIn')
})

test('job 184 AK3 PublicApp: once the server asks for the password (password_required) the hint goes', () => {
	const state = pageState({ role: 'edit', password: false, accountsOnlyVote: true })
	let b = publicApp(state)
	assert.equal(b.accountsOnlyVote.value, true)
	b.onPasswordRequired()
	assert.equal(b.needsPassword.value, true)
	assert.equal(b.accountsOnlyVote.value, false, 'the board view handed over with password_required')
	b = publicApp(state)
	b.onOpenFailed(new HttpError(403, 'password_required', 'Password required.'))
	assert.equal(b.phase.value, 'name')
	assert.equal(b.accountsOnlyVote.value, false, 'the join answered password_required')
})

test('job 184 AK3 PublicApp: signin goes to location.assign(signInUrl(linkToken)) in the same tab', () => {
	const calls = []
	globalThis.window.location = { assign: (u) => calls.push(['assign', u]), replace: (u) => calls.push(['replace', u]) }
	const b = publicApp(pageState({ role: 'vote', password: false, accountsOnlyVote: true }))
	b.onSignIn()
	assert.deepEqual(calls, [['assign', signInUrl(TOKEN)]])
	assert.ok(decodeURIComponent(calls[0][1].split('redirect_url=')[1]).endsWith('/apps/knorke/p/' + TOKEN), 'back to the link')
})
