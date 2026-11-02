/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The shell's part of the comments (factory job 189): CommentThread.vue sets
 * every part as text (AK6), with "(guest)", "(edited)", "Edit"/"Delete" by
 * the rules and the reply field only while one may reply; CommentsPanel.vue
 * (tabs with numbers, newest first, "New comment" only with the right to
 * write, "Show bubbles"); the TopBar's "Comments" for every role and in the
 * narrow layout; the context bar's "Comment" only with commentable; the
 * German texts; the transports' comment calls (headers, verbs, URLs).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { icons } from '../../../src/components/icons.js'
import { guestTransport, userTransport } from '../../../src/sync/transport.js'
import { useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const CommentThread = (await import('../../../src/components/CommentThread.vue')).default
const CommentsPanel = (await import('../../../src/components/CommentsPanel.vue')).default
const CommentBubbles = (await import('../../../src/components/CommentBubbles.vue')).default
const TopBar = (await import('../../../src/components/TopBar.vue')).default
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default
const { t, n } = await import('../../../src/util/l10n.js')

const render = (C, props) => {
	const app = createSSRApp(C, props)
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	return renderToString(app)
}
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

const comment = (id, extra = {}) => ({ id, name: 'Alice Adler', guest: false, pid: 'p1', mine: false, parts: ['Text ' + id], at: 1760000000000, edited: null, ...extra })
const thread = (id, comments, extra = {}) => ({ id, item: null, x: 0, y: 0, resolved: false, comments, ...extra })

test('AK6: CommentThread sets every part as text – markup stays characters, a mention is marked "@name"', async () => {
	const th = thread('5', [comment('5', { parts: ['<img src=x onerror=alert(1)> and ', { m: '<b>Bob</b>' }, '!'] })])
	const html = strip(await render(CommentThread, { thread: th }))
	assert.ok(!html.includes('<img'), 'no element from a part')
	assert.ok(!html.includes('<b>Bob'), 'no element from a mention')
	assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; and '), 'the text as characters')
	assert.match(html, /<span class="knorke-comment__mention" data-knorke-comment-mention>@&lt;b&gt;Bob&lt;\/b&gt;<\/span>!/)
	assert.match(html, /data-knorke-thread="5"/)
})

test('CommentThread: "(guest)", "(edited)", Edit only on own comments with the right to write, Delete for moderators on all; Resolve/Reopen; the reply field only while one may reply', async () => {
	const th = thread('5', [comment('5', { mine: true, edited: 1760000001000 }), comment('6', { guest: true, name: 'Gina' })])
	const writer = strip(await render(CommentThread, { thread: th, canWrite: true, canReply: true }))
	assert.match(writer, /Gina \(guest\)/)
	assert.equal((writer.match(/data-knorke-comment-edited/g) ?? []).length, 1)
	assert.equal((writer.match(/data-knorke-action="comment-edit"/g) ?? []).length, 1, 'Edit on the own comment only')
	assert.equal((writer.match(/data-knorke-action="comment-delete"/g) ?? []).length, 1, 'Delete on the own comment only')
	assert.match(writer, /data-knorke-action="comment-resolve"[^>]*>Resolve</)
	assert.match(writer, /data-knorke-comment-field="reply"/)
	assert.match(writer, /placeholder="Reply…"/)
	assert.match(writer, /maxlength="1000"/)
	const mod = strip(await render(CommentThread, { thread: th, canWrite: true, canReply: true, canModerate: true }))
	assert.equal((mod.match(/data-knorke-action="comment-delete"/g) ?? []).length, 2, 'a moderator deletes any')
	const reader = strip(await render(CommentThread, { thread: th, canWrite: false, canReply: false }))
	assert.doesNotMatch(reader, /data-knorke-action="comment-(edit|delete|resolve)"|data-knorke-comment-field/, 'view: reading only')
	const resolved = strip(await render(CommentThread, { thread: { ...th, resolved: true }, canWrite: true, canReply: false }))
	assert.match(resolved, />Reopen</)
	assert.doesNotMatch(resolved, /data-knorke-comment-field="reply"/, 'no reply into a resolved thread')
	const fresh = strip(await render(CommentThread, { thread: null, canWrite: true, canReply: true }))
	assert.match(fresh, /data-knorke-thread="new"/)
	assert.match(fresh, /data-knorke-comment-field="new"/)
	assert.match(fresh, /placeholder="Write a comment…"/)
})

test('CommentsPanel: tabs with numbers, entries newest first, "New comment" only with the right to write, "Show bubbles"', async () => {
	const threads = [
		thread('1', [comment('1', { at: 1000 }), comment('2', { at: 2000 })]),
		thread('3', [comment('3', { at: 3000 })]),
		thread('4', [comment('4', { at: 4000 })], { resolved: true }),
	]
	const html = strip(await render(CommentsPanel, { threads, loaded: true, canWrite: true, bubbles: true }))
	assert.match(html, /data-knorke-comments-tab="open"[^>]*>Open \(2\)/)
	assert.match(html, /data-knorke-comments-tab="resolved"[^>]*>Resolved \(1\)/)
	const order = [...html.matchAll(/data-knorke-comment-entry="(\d+)"/g)].map((m) => m[1])
	assert.deepEqual(order, ['3', '1'], 'open, newest activity first')
	assert.match(html, /1 reply/)
	assert.match(html, /data-knorke-action="comment-new"/)
	assert.match(html, /data-knorke-comments-bubbles[^>]*checked|checked[^>]*data-knorke-comments-bubbles/)
	const reader = strip(await render(CommentsPanel, { threads, loaded: true, canWrite: false, bubbles: false }))
	assert.doesNotMatch(reader, /comment-new/, 'view or frozen: no "New comment"')
	assert.doesNotMatch(reader, /data-knorke-comments-bubbles[^>]*checked/)
	const res = strip(await render(CommentsPanel, { threads, loaded: true, initialTab: 'resolved' }))
	assert.deepEqual([...res.matchAll(/data-knorke-comment-entry="(\d+)"/g)].map((m) => m[1]), ['4'])
})

test('CommentBubbles: one button per place with its number, centred on the place', async () => {
	const html = strip(await render(CommentBubbles, { places: () => [{ id: '5', n: 2, x: 100, y: 50 }, { id: '6', n: 1, x: 10.4, y: 20.6 }], active: '6' }))
	assert.match(html, /data-knorke-bubble="5"[^>]*aria-label="2 comments"/)
	assert.match(html, /style="left:86px;top:36px;"[^>]*data-knorke-bubble="5"|data-knorke-bubble="5"[^>]*style="left:86px;top:36px;"/)
	assert.match(html, /knorke-bubble--active[^>]*data-knorke-bubble="6"|data-knorke-bubble="6"[^>]*knorke-bubble--active/)
})

test('TopBar: "Comments" (speech bubble) once ready, for every role and in the narrow layout, aria-pressed with the panel', async () => {
	for (const props of [{ ready: true }, { ready: true, isGuest: true }, { ready: true, narrow: true }, { ready: true, isOwner: true, commentsOpen: true }]) {
		const html = strip(await render(TopBar, props))
		assert.match(html, /data-knorke-action="comments"/, JSON.stringify(props))
		assert.ok(html.includes(icons.comment), 'the speech bubble icon')
		assert.match(html, new RegExp(`aria-pressed="${props.commentsOpen ? 'true' : 'false'}"[^>]*data-knorke-action="comments"|data-knorke-action="comments"[^>]*aria-pressed="${props.commentsOpen ? 'true' : 'false'}"`))
	}
	assert.doesNotMatch(strip(await render(TopBar, { ready: false })), /data-knorke-action="comments"/, 'not before the board is ready')
})

test('ContextBar: "Comment" only with selection v2 commentable', async () => {
	const sel = (extra) => ({ ids: ['a'], count: 1, types: new Set(['sticky']), fields: [], mixed: [], canConnect: false, box: null, ...extra })
	assert.match(strip(await render(ContextBar, { selection: sel({ commentable: true }) })), /data-knorke-action="comment"/)
	assert.doesNotMatch(strip(await render(ContextBar, { selection: sel({ commentable: false }) })), /data-knorke-action="comment"/)
})

test('the transports: accounts with the CSRF token and XHR, guests with the guest token and XHR (refuseCrossSite); query ids and q', async () => {
	const calls = []
	const request = async (method, url, o = {}) => {
		calls.push({ method, url, body: o.body, headers: o.headers })
		return { threads: [] }
	}
	const ut = userTransport(7, { request, urlOf: (p) => p, getToken: () => 'csrf' })
	await ut.comments.list()
	await ut.comments.create({ text: 'x', x: 1, y: 2, item: null })
	await ut.comments.update({ comment: '5', text: 'y' })
	await ut.comments.remove('5')
	await ut.comments.mentions('Bob B')
	assert.deepEqual(calls.map((c) => [c.method, c.url]), [
		['GET', '/api/v1/boards/7/comments'], ['POST', '/api/v1/boards/7/comments'], ['PATCH', '/api/v1/boards/7/comments'],
		['DELETE', '/api/v1/boards/7/comments?comment=5'], ['GET', '/api/v1/boards/7/mentions?q=Bob%20B'],
	])
	assert.ok(calls.every((c) => c.headers.requesttoken === 'csrf' && c.headers['X-Requested-With'] === 'XMLHttpRequest'))
	assert.deepEqual(calls[1].body, { text: 'x', x: 1, y: 2, item: null })
	calls.length = 0
	const gt = guestTransport({ boardId: 7, linkToken: 'Ab3dEf6hIj9kLm2nOp5qRs8t', getGuest: () => ({ token: 'g.t' }), setGuest: () => {}, clearGuest: () => {}, request, urlOf: (p) => p })
	await gt.comments.list()
	await gt.comments.create({ text: 'x', thread: '5' })
	await gt.comments.update({ comment: '5', resolved: true })
	await gt.comments.remove(5)
	assert.deepEqual(calls.map((c) => [c.method, c.url]), [
		['GET', '/pub/v1/boards/7/comments'], ['POST', '/pub/v1/boards/7/comments'], ['PATCH', '/pub/v1/boards/7/comments'], ['DELETE', '/pub/v1/boards/7/comments?comment=5'],
	])
	assert.ok(calls.every((c) => c.headers['X-Knorke-Guest'] === 'g.t' && c.headers['X-Requested-With'] === 'XMLHttpRequest'))
	assert.equal(gt.comments.mentions, null)
})
