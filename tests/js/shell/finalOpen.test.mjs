/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 049 (board page after a final status on opening): the pure
 * helpers finalOpenView (components/banner.js) and listSourceOf
 * (components/share.js), the board view's spinner and its empty state
 * [data-knorke-empty=board-final] (template AST, Vue's own parser), the catch
 * of onMounted (script AST of compileScript) and the prop knownSource from
 * App.vue (never from PublicApp.vue).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { compileScript, parse as parseSfc } from 'vue/compiler-sfc'
import { GONE_VIA_LINK, bannerFor, finalOpenView } from '../../../src/components/banner.js'
import { listSourceOf } from '../../../src/components/share.js'
import { FROZEN_STATUSES } from '../../../src/board/BoardSession.js'

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
const LINK_TEXT = 'Your access through the link ended. Open the link again.'

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
 * @param {string} name attribute (static) or v-bind argument
 * @return {string|null} its value or expression, null when missing
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
 * @param {string} name directive (if, on, slot …)
 * @param {string} [arg] its argument
 * @return {object|undefined} the directive
 */
function dir(el, name, arg) {
	return el.props.find((p) => p.type === 7 && p.name === name && (arg === undefined || p.arg?.content === arg))
}

/**
 * @param {object} el element
 * @return {string} its text and interpolations, trimmed
 */
function textOf(el) {
	return (el.children ?? []).map((c) => (c.type === 2 ? c.content : c.type === 5 ? c.content.content : '')).join('').trim()
}

// ---- AK1 finalOpenView -------------------------------------------------------

test('AK1 finalOpenView: gone of an account whose list said link → reason link, back', () => {
	assert.deepEqual(finalOpenView('gone', { mode: 'user', source: 'link' }), { reason: 'link', back: true })
	assert.equal(GONE_VIA_LINK, 'link')
	assert.equal(bannerFor('gone', finalOpenView('gone', { mode: 'user', source: 'link' }).reason).text, LINK_TEXT)
	assert.equal(bannerFor('gone', finalOpenView('gone', { mode: 'user', source: 'link' }).reason).kind, 'gone', 'the hook stays gone')
})

test('AK1 finalOpenView: gone with source own, share or unknown → the general text, back', () => {
	for (const source of ['own', 'share', null, undefined]) {
		assert.deepEqual(finalOpenView('gone', { mode: 'user', source }), { reason: null, back: true }, String(source))
	}
	assert.deepEqual(finalOpenView('gone'), { reason: null, back: true }, 'defaults: mode user, source null')
	assert.deepEqual(finalOpenView('gone', {}), { reason: null, back: true })
	assert.equal(bannerFor('gone', finalOpenView('gone', { mode: 'user', source: 'own' }).reason).text, 'This board is no longer available.')
})

test('AK1 finalOpenView: guests never get the link reason nor the button', () => {
	assert.deepEqual(finalOpenView('gone', { mode: 'guest', source: 'link' }), { reason: null, back: false })
	assert.deepEqual(finalOpenView('gone', { mode: 'guest' }), { reason: null, back: false })
})

test('AK1 finalOpenView: every other frozen status has no reason; back only for accounts', () => {
	const others = FROZEN_STATUSES.filter((s) => s !== 'gone')
	assert.ok(others.length >= 7, 'revoked, logged_out, rate_limited, reload, links_disabled, link_expired, password_required')
	for (const s of others) {
		for (const mode of ['user', 'guest']) {
			for (const source of ['link', 'own', 'share', null]) {
				assert.deepEqual(finalOpenView(s, { mode, source }), { reason: null, back: mode === 'user' }, `${s} ${mode} ${source}`)
			}
		}
	}
})

test('AK1 finalOpenView is pure: the same answer twice, the options object untouched', () => {
	const o = Object.freeze({ mode: 'user', source: 'link' })
	assert.deepEqual(finalOpenView('gone', o), finalOpenView('gone', o))
	const src = read('src/components/banner.js')
	const body = src.slice(src.indexOf('export function finalOpenView'), src.indexOf('const ROLE_BANNERS'))
	assert.doesNotMatch(body, /storage|document|window|localStorage|sessionStorage/)
})

// ---- AK2 listSourceOf ----------------------------------------------------------

test('AK2 listSourceOf: the origin of the row with that id (source, M0 viaLink, owner)', () => {
	assert.equal(listSourceOf([{ id: 3, source: 'link' }], 3), 'link')
	assert.equal(listSourceOf([{ id: 3, viaLink: true }], 3), 'link', 'M0 row')
	assert.equal(listSourceOf([{ id: 3, role: 'owner' }], 3), 'own', 'owner row without source')
	assert.equal(listSourceOf([{ id: 3, source: 'share', role: 'edit' }], 3), 'share')
	assert.equal(listSourceOf([{ id: 1, source: 'own' }, { id: 3, source: 'link' }, { id: 7, source: 'share' }], 3), 'link', 'the row of that id')
})

test('AK2 listSourceOf: null without a row (never sourceOf(undefined) = share)', () => {
	assert.equal(listSourceOf([{ id: 3, source: 'link' }], 4), null, 'unknown id')
	assert.equal(listSourceOf([{ id: 3, source: 'link' }], '3'), null, 'the route id is a number')
	assert.equal(listSourceOf([], 3), null)
	assert.equal(listSourceOf(null, 3), null)
	assert.equal(listSourceOf(undefined, 3), null)
	assert.equal(listSourceOf({ 3: { id: 3, source: 'link' } }, 3), null, 'not an array')
	assert.equal(listSourceOf([null, undefined, { id: 3, viaLink: true }], 3), 'link', 'holes in the list are skipped')
	assert.equal(listSourceOf([{ id: 3, source: 'link' }], null), null)
})

// ---- AK3 template of BoardView.vue --------------------------------------------

test('AK3 board view: the spinner waits for neither an open error nor a final status', () => {
	const ast = template('src/views/BoardView.vue')
	const spin = findAll(ast, (e) => attr(e, 'class') === 'knorke-board__loading')
	assert.equal(spin.length, 1)
	assert.equal(dir(spin[0], 'if')?.exp?.content, '!ready && !openError && !openFinal')
})

test('AK3 board view: one empty state board-final with the heading, no description, the class of the error state', () => {
	const ast = template('src/views/BoardView.vue')
	const empty = findAll(ast, (e) => e.tag === 'NcEmptyContent' && attr(e, 'data-knorke-empty') === 'board-final')
	assert.equal(empty.length, 1)
	const el = empty[0]
	assert.equal(dir(el, 'if')?.exp?.content, 'openFinal')
	assert.equal(attr(el, 'class'), 'knorke-board__error')
	assert.equal(attr(el, 'name'), "t('knorke', 'Could not open the board')")
	assert.equal(attr(el, 'description'), null, 'the reason stands in the status banner only')
	assert.doesNotMatch(el.loc.source, /boardTitle|board\.title|\btitle\b/, 'no board title (SPEC-M1: never in an error message)')
	// right after the openError state, a sibling of the banners (no own live region)
	const root = ast.children.find((c) => c.type === 1)
	const kids = root.children.filter((c) => c.type === 1)
	const at = kids.indexOf(el)
	assert.ok(at > 0 && kids[at - 1].tag === 'NcEmptyContent' && dir(kids[at - 1], 'if')?.exp?.content === 'openError', 'directly after the openError empty state')
	assert.equal(attr(el, 'aria-live'), null)
})

test('AK3 board view: exactly one primary button "Back to all boards" for accounts, emitting back', () => {
	const ast = template('src/views/BoardView.vue')
	const el = findAll(ast, (e) => e.tag === 'NcEmptyContent' && attr(e, 'data-knorke-empty') === 'board-final')[0]
	const buttons = findAll(el, (e) => e.tag === 'NcButton')
	assert.equal(buttons.length, 1)
	const b = buttons[0]
	assert.equal(attr(b, 'data-knorke-action'), 'back-to-list')
	assert.equal(attr(b, 'variant'), 'primary')
	assert.equal(textOf(b), "t('knorke', 'Back to all boards')")
	assert.match(dir(b, 'on', 'click')?.exp?.content ?? '', /\$emit\('back'\)/)
	const slot = findAll(el, (e) => e.tag === 'template' && !!dir(e, 'slot', 'action'))
	assert.equal(slot.length, 1, 'in the #action slot')
	assert.ok(findAll(slot[0], (e) => e === b).length === 1, 'the button sits in that slot')
	const cond = [dir(b, 'if')?.exp?.content, dir(slot[0], 'if')?.exp?.content].filter(Boolean)
	assert.deepEqual(cond, ['openFinal.back'], 'rendered only with openFinal.back (on the button or the slot)')
})

test('AK3 board view: the openError empty state is unchanged ("Try again" reloads)', () => {
	const ast = template('src/views/BoardView.vue')
	const err = findAll(ast, (e) => e.tag === 'NcEmptyContent' && dir(e, 'if')?.exp?.content === 'openError')
	assert.equal(err.length, 1)
	assert.equal(attr(err[0], 'class'), 'knorke-board__error')
	assert.equal(attr(err[0], 'name'), "t('knorke', 'Could not open the board')")
	assert.equal(attr(err[0], 'description'), 'openError')
	assert.equal(attr(err[0], 'data-knorke-empty'), null)
	const b = findAll(err[0], (e) => e.tag === 'NcButton')
	assert.equal(b.length, 1)
	assert.equal(textOf(b[0]), "t('knorke', 'Try again')")
	assert.equal(dir(b[0], 'on', 'click')?.exp?.content, 'reload')
	assert.equal(attr(b[0], 'variant'), 'primary')
})

// ---- AK4 script of BoardView.vue, App.vue, PublicApp.vue -----------------------

/** @return {object} babel AST of BoardView.vue's <script setup> */
function boardViewScript() {
	const { descriptor } = parseSfc(read('src/views/BoardView.vue'), { filename: 'BoardView.vue' })
	return compileScript(descriptor, { id: 'finalopen', inlineTemplate: false }).scriptSetupAst
}

/**
 * @param {object} node babel node
 * @param {(n: object) => boolean} pred predicate
 * @param {object[]} [out] results
 * @return {object[]} every node below node matching pred
 */
function walk(node, pred, out = []) {
	if (!node || typeof node !== 'object') {
		return out
	}
	if (Array.isArray(node)) {
		for (const x of node) {
			walk(x, pred, out)
		}
		return out
	}
	if (typeof node.type === 'string' && pred(node)) {
		out.push(node)
	}
	for (const [k, v] of Object.entries(node)) {
		if (k !== 'loc' && k !== 'leadingComments' && k !== 'trailingComments' && v && typeof v === 'object') {
			walk(v, pred, out)
		}
	}
	return out
}

/** @return {string} `a.b` of a member expression (`status.value`) */
const memberName = (n) => (n?.type === 'MemberExpression' && n.object.type === 'Identifier' ? `${n.object.name}.${n.property.name}` : null)

test('AK4 board view: the prop knownSource and finalOpenView from components/banner.js', () => {
	const src = read('src/views/BoardView.vue')
	assert.match(src, /\n\tknownSource: \{ type: String, default: null \},\n/)
	assert.match(src, /^import \{[^}]*\bfinalOpenView\b[^}]*\} from '\.\.\/components\/banner\.js'$/m)
	assert.match(src, /const openFinal = ref\(null\)/)
})

test('AK4 board view: the catch of onMounted sets status, statusReason (finalOpenView) and openFinal after statusOf', () => {
	const ast = boardViewScript()
	const mounted = walk(ast, (n) => n.type === 'CallExpression' && n.callee.name === 'onMounted')
	assert.equal(mounted.length, 1)
	const tries = walk(mounted[0], (n) => n.type === 'TryStatement')
	assert.equal(tries.length, 1)
	const body = tries[0].handler.body.body
	const at = body.findIndex((s) => s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'st'
		&& s.declarations[0].init?.callee?.name === 'statusOf')
	assert.ok(at >= 0, 'const st = statusOf(e)')
	const branch = body[at + 1]
	assert.equal(branch.type, 'IfStatement')
	assert.equal(branch.test.name, 'st')
	const [decl, ...rest] = branch.consequent.body
	assert.equal(decl.type, 'VariableDeclaration')
	const call = decl.declarations[0].init
	assert.equal(call.callee.name, 'finalOpenView')
	assert.equal(call.arguments[0].name, 'st')
	const opts = Object.fromEntries(call.arguments[1].properties.map((p) => [p.key.name, memberName(p.value)]))
	assert.deepEqual(opts, { mode: 'props.mode', source: 'props.knownSource' })
	const v = decl.declarations[0].id.name
	const assigns = rest.map((s) => [memberName(s.expression.left), s.expression.right])
	assert.deepEqual(assigns.map((a) => a[0]), ['status.value', 'statusReason.value', 'openFinal.value'])
	assert.equal(assigns[0][1].name, 'st')
	assert.equal(memberName(assigns[1][1]), `${v}.reason`)
	assert.equal(assigns[2][1].type, 'ObjectExpression')
	assert.deepEqual(assigns[2][1].properties.map((p) => [p.key.name, memberName(p.value)]), [['back', `${v}.back`]])
	// the openError branches stay: app 429, status 0, anything else; open-failed after them
	assert.ok(branch.alternate, 'the openError branches follow')
	const errAssigns = walk(branch.alternate, (n) => n.type === 'AssignmentExpression').map((n) => memberName(n.left))
	assert.deepEqual([...new Set(errAssigns)], ['openError.value'])
	const emitAfter = body.slice(at + 2).find((s) => s.expression?.callee?.name === 'emit')
	assert.equal(emitAfter?.expression.arguments[0].value, 'open-failed')
})

test('AK4 board view: openFinal is set exactly once (never in ui.onStatus)', () => {
	const src = read('src/views/BoardView.vue')
	assert.equal(src.split('openFinal.value =').length - 1, 1)
	const ast = boardViewScript()
	const onStatus = walk(ast, (n) => n.type === 'ObjectProperty' && n.key.name === 'onStatus')
	assert.equal(onStatus.length, 1)
	assert.equal(walk(onStatus[0], (n) => n.type === 'Identifier' && n.name === 'openFinal').length, 0)
})

test('AK4 App.vue passes :known-source from the board list; PublicApp.vue does not', () => {
	const app = template('src/App.vue')
	const views = findAll(app, (e) => e.tag === 'BoardView')
	assert.equal(views.length, 1)
	assert.equal(attr(views[0], 'known-source'), 'listSourceOf(boards, route.id)')
	assert.match(read('src/App.vue'), /^import \{[^}]*\blistSourceOf\b[^}]*\} from '\.\/components\/share\.js'$/m)
	const pub = template('src/PublicApp.vue')
	const pv = findAll(pub, (e) => e.tag === 'BoardView')
	assert.equal(pv.length, 1)
	assert.equal(attr(pv[0], 'known-source'), null)
	assert.equal(attr(pv[0], 'knownSource'), null)
})
