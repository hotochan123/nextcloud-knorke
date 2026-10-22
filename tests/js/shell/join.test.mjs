/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accountJoinState, editLinkOf, guestJoinOutcome, isLinksDisabled, shareView, withEditLink } from '../../../src/components/join.js'
import { HttpError } from '../../../src/sync/http.js'
import { guestTransport } from '../../../src/sync/transport.js'

const err = (status, code, fromApp = true) => new HttpError(status, code, '', null, fromApp)

test('U12 guest join: 403 links_disabled → its own final phase; revoked, 404, 400 as before', () => {
	assert.deepEqual(guestJoinOutcome(err(403, 'links_disabled')), { phase: 'disabled', error: '' })
	assert.deepEqual(guestJoinOutcome(err(403, 'link_revoked')), { phase: 'revoked', error: '' })
	assert.deepEqual(guestJoinOutcome(err(404, 'not_found')), { phase: 'name', error: '' })
	assert.deepEqual(guestJoinOutcome(err(400, 'name_required')), { phase: 'name', error: 'Please enter a name.' })
	assert.equal(guestJoinOutcome(err(403, 'forbidden')), null, 'other errors stay with the board view')
	assert.equal(guestJoinOutcome(new Error('x')), null)
	assert.equal(isLinksDisabled(err(403, 'links_disabled')), true)
	assert.equal(isLinksDisabled(err(403, 'links_disabled', false)), true, 'decided on status and code')
	assert.equal(isLinksDisabled(err(404, 'links_disabled')), false)
})

test('U20 guest join: an app 429 suggests asking for a new link (the guest budget is per link); a proxy 429 is no join verdict', () => {
	const o = guestJoinOutcome(err(429, 'rate_limited'))
	assert.equal(o.phase, 'name')
	assert.equal(o.error, 'Too many people joined from here in a short time. Please wait a moment, or ask the person who shared the board for a new link.')
	assert.equal(guestJoinOutcome(err(429, 'http_429', false)), null)
})

test('U12 account join: links_disabled → disabled; revoked, invalid, limited, error', () => {
	assert.equal(accountJoinState(err(403, 'links_disabled')), 'disabled')
	assert.equal(accountJoinState(err(403, 'link_revoked')), 'revoked')
	assert.equal(accountJoinState(err(404, 'not_found')), 'invalid')
	assert.equal(accountJoinState(err(429, 'rate_limited')), 'limited')
	assert.equal(accountJoinState(err(500, 'internal')), 'error')
	assert.equal(accountJoinState(new Error('x')), 'error')
})

test('U12 share view: linksAllowed false → disabled (also with a kept link); missing = allowed (old servers); SPEC-M1 §4.4 reads board.links.edit', () => {
	const on = { edit: { url: 'u' }, vote: null }
	assert.equal(shareView({ links: { edit: null, vote: null }, linksAllowed: false }), 'disabled')
	assert.equal(shareView({ links: on, linksAllowed: false }), 'disabled')
	assert.equal(shareView({ links: on, linksAllowed: true }), 'on')
	assert.equal(shareView({ links: on }), 'on')
	assert.equal(shareView({ links: { edit: null, vote: null } }), 'off')
	assert.equal(shareView({ links: { edit: null, vote: { url: 'v' } } }), 'off', 'only the edit link counts here')
	assert.equal(shareView(null), 'off')
	assert.equal(shareView({ link: { url: 'u' } }), 'off', 'the M0 key board.link is gone (SPEC-M1 §4.4)')
})

test('U12 shell: PublicApp, App and the share dialog take their decisions from join.js and expose the links_disabled hook', () => {
	const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
	const pub = read('src/PublicApp.vue')
	assert.match(pub, /guestJoinOutcome\(e\)/)
	assert.match(pub, /phase === 'disabled'[\s\S]*data-knorke-banner="links_disabled"|data-knorke-banner="links_disabled"[\s\S]*phase === 'disabled'/)
	const app = read('src/App.vue')
	assert.match(app, /accountJoinState\(e\)/)
	assert.match(app, /joinState === 'disabled'/)
	assert.match(app, /data-knorke-banner="links_disabled"/)
	// stage 2: the links tab of the share dialog holds the disabled view (U12)
	const share = read('src/components/ShareLinks.vue')
	assert.match(share, /view === 'disabled'/)
	assert.match(share, /data-knorke-banner="links_disabled"/)
	assert.match(share, /Link sharing is disabled by your administrator\./)
	assert.match(read('src/components/ShareDialog.vue'), /isLinksDisabled\(e\)/, 'a 403 links_disabled switches the dialog to the disabled view')
	const view = read('src/views/BoardView.vue')
	assert.match(view, /isLinksDisabled\(e\)/)
})

test('M1 §4.2 join outcomes: link_expired → expired; password_required/_wrong → name phase with the password field and the hint at it (guest, stage 2)', () => {
	assert.deepEqual(guestJoinOutcome(err(403, 'link_expired')), { phase: 'expired', error: '' })
	assert.deepEqual(guestJoinOutcome(err(403, 'password_required')), { phase: 'name', error: '', needsPassword: true, passwordError: 'Enter the password for this board.', passwordCode: 'password_required' })
	assert.deepEqual(guestJoinOutcome(err(403, 'password_wrong')), { phase: 'name', error: '', needsPassword: true, passwordError: 'Wrong password.', passwordCode: 'password_wrong' })
	assert.equal(accountJoinState(err(403, 'link_expired')), 'expired')
})

test('M1 §4.4 editLinkOf/withEditLink: the edit link lives in board.links.edit; changing it keeps links.vote', () => {
	const L = { token: 'Ab3dEf6hIj9kLm2nOp5qRs8t', role: 'edit', url: 'u' }
	const V = { token: 'Zb3dEf6hIj9kLm2nOp5qRs8t', role: 'vote', url: 'v' }
	assert.equal(editLinkOf({ links: { edit: L, vote: null } }), L)
	assert.equal(editLinkOf({ links: { edit: null, vote: V } }), null)
	assert.equal(editLinkOf({ link: L }), null, 'never the M0 key')
	assert.equal(editLinkOf(null), null)
	assert.deepEqual(withEditLink({ links: { edit: null, vote: V } }, L), { links: { edit: L, vote: V } })
	assert.deepEqual(withEditLink({ links: { edit: L, vote: V } }, null), { links: { edit: null, vote: V } })
	assert.deepEqual(withEditLink({}, L), { links: { edit: L, vote: null } })
})

test('M1 §4.4 (R2) no reader of the M0 key board.link is left in the shell', () => {
	const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
	for (const p of ['src/views/BoardView.vue', 'src/components/join.js', 'src/components/ShareDialog.vue', 'src/board/BoardSession.js']) {
		const code = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
		assert.doesNotMatch(code, /board(\.value)?\??\.link\b(?!s)/, p)
		assert.doesNotMatch(code, /\bboard && board\.link\b/, p)
	}
	const view = read('src/views/BoardView.vue')
	// stage 2: the share dialog gets the whole board.links (edit and vote)
	assert.match(view, /:links="board\.links \|\| null"/)
	assert.match(view, /board\.value = x\.board \? \{ \.\.\.\(board\.value \?\? \{\}\), \.\.\.x\.board \} : board\.value/, 'onBoard merges (F3)')
	assert.match(view, /session\.value\.applyBoardUpdate\(b\)/, 'the own rename takes the meta path')
})

test('M1 §6.4 (R2) password_required hand-over: BoardView rescues unsent texts first, then PublicApp shows the name phase with the stored name and the hint', () => {
	const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
	const view = read('src/views/BoardView.vue')
	assert.match(view, /defineEmits\(\[[^\]]*'password-required'[^\]]*\]\)/)
	assert.match(view, /if \(x === 'password_required' && props\.mode === 'guest'\) \{\s*queueMicrotask\(handOver\)/)
	assert.match(view, /for \(const x of session\.value\?\.unsentTexts\(\) \?\? \[\]\) \{\s*rescues\.value = addRescue\(rescues\.value, x\)/)
	assert.match(view, /if \(rescues\.value\.length === 0\) \{\s*emit\('password-required', handoverInfo\)/, 'nothing to rescue: hand over at once')
	assert.match(view, /function closeRescues\(\) \{\s*rescues\.value = \[\]\s*if \(handoverPending\) \{\s*emit\('password-required', handoverInfo\)/, 'otherwise when the copy dialog closes')
	// R13: after the password lock-out the hand-over carries its text
	assert.match(view, /const err = statusReason\.value === PASSWORD_LOCK \? session\.value\?\.sync\?\.finalError : null\s*handoverInfo = err \? \{ lockText: lockoutText\(err\) \} : \{\}/)
	const pub = read('src/PublicApp.vue')
	assert.match(pub, /@password-required="onPasswordRequired"/)
	// stage 2: the name phase with the password field and the hint at it
	assert.match(pub, /function onPasswordRequired\(info = \{\}\) \{[\s\S]*?lastName\.value = g\.name[\s\S]*?toName\(\{ error: '', needsPassword: true, passwordError: t\('knorke', 'Enter the password for this board\.'\), passwordCode: 'password_required' \}\)/)
	assert.match(pub, /function toName\(o\) \{[\s\S]*?phase\.value = 'name'/)
	assert.match(pub, /state\.linkState === 'expired'\) \{\s*return 'expired'/)
})

test('M1 stage 2 (R13, CLI-08): the password lock-out on a guest join → name phase with the lock-out text at the password field; never a silent retry', () => {
	const lock = new HttpError(429, 'slow_down', '', 120, true, { error: 'slow_down', retryMs: 540000, reason: 'password' })
	assert.deepEqual(guestJoinOutcome(lock), { phase: 'name', error: '', needsPassword: true, passwordError: 'Too many wrong passwords. Try again in 9 minutes.', passwordCode: 'slow_down' })
	const plain = new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 2000 })
	// any other slow_down is repeated by the session (withProxyRetry) and never reaches the page
	assert.notEqual(guestJoinOutcome(plain)?.needsPassword, true, 'not the password phase')
})

test('M1 stage 2: a signed-in user on a link with password → the account password dialog (state password)', () => {
	assert.equal(accountJoinState(err(403, 'password_required')), 'password')
	assert.equal(accountJoinState(err(403, 'password_wrong')), 'password')
	assert.equal(accountJoinState(new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 60000, reason: 'password' })), 'password')
	assert.equal(accountJoinState(new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 2000 })), 'limited', 'another throttle stays "limited"')
	const app = readFileSync(new URL('../../../src/App.vue', import.meta.url), 'utf8')
	assert.match(app, /<LinkPasswordDialog v-if="route\.name === 'join' && joinState === 'password' && passwordOpen"/)
	assert.match(app, /@submit="\(pw\) => join\(route\.token, pw\)"/)
	assert.match(app, /boardsApi\.joinLink\(token, password\)/)
})

test('M1 stage 2: PublicApp passes the guest password once (BoardView → session.open) and forgets it after the join', () => {
	const pub = readFileSync(new URL('../../../src/PublicApp.vue', import.meta.url), 'utf8')
	assert.match(pub, /:guest-password="guestPassword"/)
	assert.match(pub, /const needsPassword = ref\(linkInfo\?\.password === true\)/, 'linkInfo.password shows the field from the start')
	assert.match(pub, /function onOpened\(\) \{\s*guestPassword\.value = null/)
	assert.doesNotMatch(pub, /setJson\([^)]*password|setItem\([^)]*password/i, 'never stored')
	const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(view, /await s\.open\(props\.guestName, props\.guestPassword\)/)
})

test('R23 (job 028) guest page: the error guestTransport().join() throws for a 200 end answer gives the same phase as the old 403', async () => {
	const TOKEN = 'Ab3dEf6hIj9kLm2nOp5qRs8t'
	const messages = { link_revoked: 'This link has been revoked.', link_expired: 'This link has expired.', links_disabled: 'Link sharing is disabled by the administrator.' }
	/**
	 * @param {object|Error} answer what the server answers the join
	 * @return {Promise<unknown>} the error of the join
	 */
	const joinError = async (answer) => {
		const tr = guestTransport({
			boardId: null,
			linkToken: TOKEN,
			client: 'cAbc123456',
			getGuest: () => null,
			setGuest: () => { throw new Error('setGuest must not run') },
			clearGuest: () => { throw new Error('clearGuest must not run') },
			request: async () => {
				if (answer instanceof Error) {
					throw answer
				}
				return answer
			},
			urlOf: (p) => p,
		})
		return tr.join('Gina').then(() => null, (e) => e)
	}
	for (const [code, phase] of [['link_revoked', 'revoked'], ['link_expired', 'expired'], ['links_disabled', 'disabled']]) {
		const fromEnd = await joinError({ end: code, message: messages[code] })
		const from403 = await joinError(new HttpError(403, code, messages[code], null, true, { error: code, message: messages[code] }))
		assert.ok(fromEnd instanceof HttpError && fromEnd.status === 403 && fromEnd.code === code, code + ': the old 403')
		assert.deepEqual(guestJoinOutcome(fromEnd), { phase, error: '' }, code + ' (200 end answer)')
		assert.deepEqual(guestJoinOutcome(fromEnd), guestJoinOutcome(from403), code + ': the same as the 403')
	}
})
