/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The colour block of the context bar (job 135, ColorPicker.vue), mounted
 * with Vue's own renderer on a small fake DOM (as ContextMenu.vue in
 * contextMenu.test.mjs): its template compiled at run time from the .vue
 * file, events handed to the bound listeners.
 * - AK5: Enter in the "#" field with a valid code emits style(path,
 *   #rrggbb, event) exactly once and keeps the focus (no focus call, the
 *   field shows the code in lower case); Enter with an invalid code emits
 *   nothing and sets aria-invalid="true" until the next input; input and
 *   blur set nothing; the system picker sets on change only, never on input
 * - the preview dot shows a valid typed colour, else none; the field
 *   follows the common colour; the row "On this board" emits like the grid
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LIGHT, STICKY_COLORS } from '../../../src/model/tokens.js'
import { LINE_COLORS } from '../../../src/components/contextbar.js'
import { useSfc } from './sfc.mjs'

useSfc()
const { createRenderer, h, markRaw, nextTick, ref } = await import('vue')
const ColorPicker = (await import('../../../src/components/ColorPicker.vue')).default

class FakeNode {

	/** @param {string} tag tag name ('#text', '#comment' for those) */
	constructor(tag) {
		this.tag = tag
		this.parentNode = null
		this.children = []
		this.attrs = {}
		this.on = {}
		this.text = ''
		this.value = ''
		// job 230: v-show (the hex row behind "Custom color…") sets style.display
		this.style = {}
	}

}

/**
 * @param {string} tag tag name
 * @return {FakeNode} a node that never turns into a reactive proxy
 */
const make = (tag) => markRaw(new FakeNode(tag))

/** Node operations of a Vue custom renderer over FakeNode. */
const nodeOps = {
	createElement: (tag) => make(tag),
	createText: (text) => Object.assign(make('#text'), { text }),
	createComment: (text) => Object.assign(make('#comment'), { text }),
	setText: (n, text) => { n.text = text },
	setElementText: (el, text) => {
		for (const c of el.children) {
			c.parentNode = null
		}
		el.children = []
		el.text = text
	},
	insert: (child, parent, anchor) => {
		if (child.parentNode) {
			nodeOps.remove(child)
		}
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
		if (/^on[A-Z]/.test(key)) {
			el.on[key] = next
		} else {
			el.attrs[key] = next
			if (key === 'value') {
				// a DOM property, as runtime-dom sets it
				el.value = next ?? ''
			}
		}
	},
}

/**
 * @param {object} [props] props of the picker (default: the note fill palette, no common colour)
 * @return {Promise<object>} {emitted, state (ref of the props), find(attr), findAll(attr), done()}
 */
async function mountPicker(props = {}) {
	const { compileScript, parse } = await import('vue/compiler-sfc')
	const file = new URL('../../../src/components/ColorPicker.vue', import.meta.url)
	const { descriptor } = parse(readFileSync(file, 'utf8'))
	// the client template, compiled at run time against the script's bindings ($setup.…), as the build does
	const { bindings } = compileScript(descriptor, { id: 'colorpicker', inlineTemplate: false })
	const Picker = { ...ColorPicker, template: descriptor.template.content, compilerOptions: { bindingMetadata: bindings, prefixIdentifiers: true } }
	const emitted = []
	const state = ref({ path: 'style.fill', palette: [...STICKY_COLORS], color: null, boardColors: [], label: 'Fill', ...props })
	const Root = { setup: () => () => h(Picker, { ...state.value, onStyle: (...a) => emitted.push(a) }) }
	const app = createRenderer(nodeOps).createApp(Root)
	const container = make('body')
	app.mount(container)
	await nextTick()
	const findAll = (attr, from = container, out = []) => {
		if (from.attrs && from.attrs[attr] !== undefined && from.attrs[attr] !== null) {
			out.push(from)
		}
		for (const c of from.children) {
			findAll(attr, c, out)
		}
		return out
	}
	return { emitted, state, findAll, find: (attr) => findAll(attr)[0] ?? null, done: () => app.unmount() }
}

/**
 * @param {FakeNode} el input
 * @param {string} text its new value (fires input)
 */
function type(el, text) {
	el.value = text
	el.on.onInput?.({ type: 'input', target: el })
}

/**
 * @param {FakeNode} el target
 * @param {string} key KeyboardEvent.key
 * @param {object} [extra] more event keys
 * @return {object} the event
 */
function key(el, key, extra = {}) {
	const e = { type: 'keydown', key, target: el, detail: 0, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...extra }
	el.on.onKeydown?.(e)
	return e
}

/**
 * @param {FakeNode} el target
 * @param {string} type event type (change, input, blur …)
 * @return {object} the event
 */
function fire(el, type) {
	const e = { type, target: el }
	el.on['on' + type[0].toUpperCase() + type.slice(1)]?.(e)
	return e
}

test('job 135 (AK5) mounted: Enter with 1F3A5F emits style(path, #1f3a5f, e) exactly once, keeps the focus and shows the code in lower case', async () => {
	const m = await mountPicker({ color: '#a8d8f8' })
	try {
		const hex = m.find('data-knorke-hex')
		assert.ok(hex, 'the hex field')
		assert.equal(hex.tag, 'input')
		assert.equal(hex.attrs['data-knorke-hex'], 'style.fill')
		assert.equal(hex.value, 'a8d8f8', 'the common colour without #')
		type(hex, '1F3A5F')
		await nextTick()
		assert.deepEqual(m.emitted, [], 'typing sets nothing')
		const e = key(hex, 'Enter')
		await nextTick()
		assert.equal(m.emitted.length, 1)
		assert.equal(m.emitted[0][0], 'style.fill')
		assert.equal(m.emitted[0][1], '#1f3a5f')
		assert.equal(m.emitted[0][2], e, 'the key event (the view keeps the focus for keys)')
		assert.equal(e.defaultPrevented, true)
		assert.equal(hex.value, '1f3a5f')
		assert.equal(hex.attrs['aria-invalid'] ?? null, null)
		// other keys and Enter while an IME composes set nothing
		key(hex, 'a')
		key(hex, 'Backspace')
		key(hex, 'Enter', { isComposing: true })
		fire(hex, 'blur')
		await nextTick()
		assert.equal(m.emitted.length, 1)
	} finally {
		m.done()
	}
})

test('job 135 (AK5) mounted: Enter with 12345g emits nothing and sets aria-invalid="true"; the next input lifts it; blur sets nothing', async () => {
	const m = await mountPicker({ color: '#a8d8f8' })
	try {
		const hex = m.find('data-knorke-hex')
		for (const bad of ['12345g', 'zz', '#f80', '']) {
			type(hex, bad)
			key(hex, 'Enter')
			await nextTick()
			assert.equal(hex.attrs['aria-invalid'], 'true', JSON.stringify(bad))
			type(hex, bad + '0')
			await nextTick()
			assert.equal(hex.attrs['aria-invalid'] ?? null, null, 'the next input removes it: ' + JSON.stringify(bad))
		}
		type(hex, 'ff8800')
		fire(hex, 'blur')
		await nextTick()
		assert.deepEqual(m.emitted, [], 'nothing without Enter')
	} finally {
		m.done()
	}
})

test('job 135 (AK5) mounted: the system picker emits nothing on input and exactly once on change; it starts on the common colour, else the first palette colour', async () => {
	const m = await mountPicker({ path: 'style.stroke', color: null })
	try {
		const sys = m.find('data-knorke-system-color')
		assert.equal(sys.tag, 'input')
		assert.equal(sys.attrs.type, 'color')
		assert.equal(sys.attrs['data-knorke-system-color'], 'style.stroke')
		assert.equal(sys.value, STICKY_COLORS[0], 'mixed: the first palette colour')
		sys.value = '#ff8800'
		fire(sys, 'input')
		fire(sys, 'input')
		await nextTick()
		assert.deepEqual(m.emitted, [], 'input sets nothing')
		const e = fire(sys, 'change')
		await nextTick()
		assert.deepEqual(m.emitted, [['style.stroke', '#ff8800', e]])
		m.state.value = { ...m.state.value, color: '#123456' }
		await nextTick()
		assert.equal(sys.value, '#123456', 'the common colour')
	} finally {
		m.done()
	}
})

test('job 135 mounted: the preview dot shows a valid typed colour, else only its edge; the field follows the common colour and clears the mark', async () => {
	const m = await mountPicker({ color: '#a8d8f8' })
	try {
		const hex = m.find('data-knorke-hex')
		const dot = m.find('data-knorke-hex-preview')
		assert.equal(dot.attrs['data-knorke-hex-preview'], '#a8d8f8')
		assert.deepEqual(dot.attrs.style, { backgroundColor: '#a8d8f8' })
		type(hex, ' #1F3A5F ')
		await nextTick()
		assert.equal(dot.attrs['data-knorke-hex-preview'], '#1f3a5f')
		assert.deepEqual(dot.attrs.style, { backgroundColor: '#1f3a5f' })
		type(hex, '1F3A5')
		await nextTick()
		assert.equal(dot.attrs['data-knorke-hex-preview'], '')
		assert.equal(dot.attrs.style ?? null, null, 'no colour: only the edge')
		key(hex, 'Enter')
		await nextTick()
		assert.equal(hex.attrs['aria-invalid'], 'true')
		m.state.value = { ...m.state.value, color: '#123456' }
		await nextTick()
		assert.equal(hex.value, '123456', 'follows the common colour')
		assert.equal(hex.attrs['aria-invalid'] ?? null, null)
		m.state.value = { ...m.state.value, color: null }
		await nextTick()
		assert.equal(hex.value, '', 'differing colours: empty')
	} finally {
		m.done()
	}
})

test('job 135 mounted: the grid and the row "On this board" emit style(path, colour, e); the row only with board colours', async () => {
	const m = await mountPicker({ path: 'style.textColor', color: '#1f3a5f' })
	try {
		assert.equal(m.find('data-knorke-board-colors'), null, 'no board colours: no row')
		m.state.value = { ...m.state.value, boardColors: ['#1f3a5f', '#123456'] }
		await nextTick()
		const row = m.find('data-knorke-board-colors')
		assert.ok(row)
		assert.equal(row.attrs.role, 'group')
		assert.equal(row.attrs['aria-label'], 'On this board')
		const swatches = m.findAll('data-knorke-value', row)
		assert.deepEqual(swatches.map((s) => [s.attrs['data-knorke-style'], s.attrs['data-knorke-value'], s.attrs['aria-pressed']]), [
			['style.textColor', '#1f3a5f', 'true'],
			['style.textColor', '#123456', 'false'],
		])
		const e = { type: 'click', detail: 1 }
		swatches[1].on.onClick(e)
		const grid = m.findAll('data-knorke-value').filter((s) => !swatches.includes(s))
		assert.equal(grid.length, STICKY_COLORS.length)
		grid[2].on.onClick(e)
		await nextTick()
		assert.deepEqual(m.emitted, [['style.textColor', '#123456', e], ['style.textColor', STICKY_COLORS[2], e]])
	} finally {
		m.done()
	}
})

test('job 227 AK4 mounted: every swatch of the one palette names its colour as title and aria-label ("Default" for the line default); a colour of the selection marks its swatch; "On this board" keeps the hex', async () => {
	const m = await mountPicker({ palette: [...LIGHT], color: '#a2d9fe', boardColors: ['#123456'] })
	try {
		const row = m.find('data-knorke-board-colors')
		const board = m.findAll('data-knorke-value', row)
		const grid = m.findAll('data-knorke-value').filter((s) => !board.includes(s))
		const names = ['Light blue', 'Turquoise', 'Sage', 'Yellow', 'Orange', 'Coral', 'Pink', 'Purple', 'Indigo', 'Sand', 'White', 'Gray', 'Black']
		assert.deepEqual(grid.map((s) => s.attrs.title), names)
		assert.deepEqual(grid.map((s) => s.attrs['aria-label']), names)
		assert.deepEqual(grid.map((s) => s.attrs['aria-pressed']), names.map((n) => (n === 'Light blue' ? 'true' : 'false')))
		assert.equal(board[0].attrs['aria-label'], 'Color #123456')
		m.state.value = { ...m.state.value, path: 'style.stroke', palette: [...LINE_COLORS], color: '#3d4044' }
		await nextTick()
		const line = m.findAll('data-knorke-value').filter((s) => s.attrs['data-knorke-style'] === 'style.stroke' && !m.findAll('data-knorke-value', m.find('data-knorke-board-colors')).includes(s))
		assert.equal(line[0].attrs.title, 'Default')
		assert.equal(line[0].attrs['aria-pressed'], 'true')
		assert.deepEqual(line.slice(1).map((s) => s.attrs.title), names.filter((n) => n !== 'White'))
	} finally {
		m.done()
	}
})
