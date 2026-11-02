/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 142, AK4: TouchTip.vue, the one-time tip about selecting with
 * a finger. Rendered (SSR): the tip text, role status, the hooks
 * [data-knorke-tip="touch-select"] and [data-knorke-action="touch-tip-ok"] on
 * a native button of type button. Mounted with a small custom renderer: the
 * button's click (a tap, a click, Enter or Space on a native button) reports
 * close to the parent, once per activation; nothing else does.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp, createRenderer, h, markRaw, nextTick } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const TouchTip = (await import('../../../src/components/TouchTip.vue')).default

const FILE = new URL('../../../src/components/TouchTip.vue', import.meta.url)
const TEXT = 'Tip: hold a finger still, then drag, to select several items.'

/** A node of the custom renderer: tag, attributes, listeners, children, text. */
class Node {
	constructor(tag) {
		this.tag = tag
		this.attrs = {}
		this.on = {}
		this.children = []
		this.parentNode = null
		this.text = ''
	}

	/** @return {Node[]} this node and every node below it */
	all() {
		return [this, ...this.children.flatMap((c) => c.all())]
	}
}

const create = (tag) => markRaw(new Node(tag))
const nodeOps = {
	createElement: (tag) => create(tag),
	createText: (text) => Object.assign(create('#text'), { text }),
	createComment: (text) => Object.assign(create('#comment'), { text }),
	setText: (n, text) => { n.text = text },
	setElementText: (el, text) => {
		el.children = []
		el.text = text
	},
	insert: (child, parent, anchor) => {
		if (child.parentNode) nodeOps.remove(child)
		const k = anchor ? parent.children.indexOf(anchor) : -1
		parent.children.splice(k < 0 ? parent.children.length : k, 0, child)
		child.parentNode = parent
	},
	remove: (child) => {
		const p = child.parentNode
		if (p) {
			p.children.splice(p.children.indexOf(child), 1)
			child.parentNode = null
		}
	},
	parentNode: (n) => n.parentNode,
	nextSibling: (n) => {
		const p = n.parentNode
		return p ? (p.children[p.children.indexOf(n) + 1] ?? null) : null
	},
	patchProp: (el, key, prev, next) => {
		if (/^on[A-Z]/.test(key)) el.on[key] = next
		else el.attrs[key] = next
	},
}

/**
 * Mounts TouchTip with its client template (compiled at run time against the
 * script's bindings, as the build does) inside a parent that counts close.
 *
 * @return {Promise<{root: Node, closes: number[], unmount: Function}>} closes: one entry per close event
 */
async function mount() {
	const { compileScript, parse } = await import('vue/compiler-sfc')
	const { descriptor } = parse(readFileSync(FILE, 'utf8'))
	const { bindings } = compileScript(descriptor, { id: 'touchtip', inlineTemplate: false })
	const Tip = { ...TouchTip, template: descriptor.template.content, compilerOptions: { bindingMetadata: bindings, prefixIdentifiers: true } }
	const closes = []
	const app = createRenderer(nodeOps).createApp({ setup: () => () => h(Tip, { onClose: (...args) => closes.push(args.length) }) })
	const root = create('body')
	app.mount(root)
	await nextTick()
	return { root, closes, unmount: () => app.unmount() }
}

test('AK4: renders the tip text, role status, both hooks and a native button of type button labelled OK', async () => {
	const html = await renderToString(createSSRApp(TouchTip, {}))
	assert.match(html, /^<div class="knorke-touchtip" data-knorke-tip="touch-select" role="status">/)
	assert.match(html, new RegExp(`<p class="knorke-touchtip__text">\\s*${TEXT.replace(/[.,]/g, '\\$&')}\\s*</p>`))
	assert.match(html, /<button type="button" class="knorke-touchtip__ok" data-knorke-action="touch-tip-ok">\s*OK\s*<\/button>/)
	assert.doesNotMatch(html, /autofocus|tabindex/, 'it never takes the focus when it appears')
})

test('AK4: a click on OK reports close to the parent, once per activation; mounting alone reports nothing', async () => {
	const m = await mount()
	try {
		const nodes = m.root.all()
		const tip = nodes.find((n) => n.attrs['data-knorke-tip'] === 'touch-select')
		assert.ok(tip, 'the bubble is mounted')
		assert.equal(tip.attrs.role, 'status')
		const ok = nodes.find((n) => n.attrs['data-knorke-action'] === 'touch-tip-ok')
		assert.equal(ok.tag, 'button')
		assert.equal(ok.attrs.type, 'button')
		assert.deepEqual(m.closes, [], 'nothing before an activation')
		assert.deepEqual(Object.keys(tip.on), [], 'the bubble itself listens to nothing')
		assert.equal(typeof ok.on.onClick, 'function')
		ok.on.onClick({ type: 'click' })
		assert.equal(m.closes.length, 1, 'close reported')
		ok.on.onClick({ type: 'click' })
		assert.equal(m.closes.length, 2)
	} finally {
		m.unmount()
	}
})

test('AK4: setup alone: close() emits close', () => {
	const { bindings, emitted } = setupOf(TouchTip, {})
	bindings.close()
	assert.deepEqual(emitted, [['close']])
})
