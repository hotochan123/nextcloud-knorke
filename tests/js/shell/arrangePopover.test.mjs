/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The "Arrange" panel (ArrangePopover.vue, job 146 AK5), mounted with Vue's
 * own renderer on a small fake DOM (as ColorPicker.vue in
 * colorPicker.test.mjs): its template compiled at run time from the .vue
 * file, NcTextField replaced by a plain input that emits update:modelValue
 * on input, events handed to the bound listeners.
 * - a new box sets every field; a field with input that is not applied yet
 *   keeps it (the same input node, its value), the others follow
 * - Apply (Enter) sends the typed values and ends every open input: the next
 *   box shows in every field, also the clamped value of a typed one
 * - mounting again shows the box
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { useSfc } from './sfc.mjs'

useSfc()
const { createRenderer, h, markRaw, nextTick, ref } = await import('vue')
const ArrangePopover = (await import('../../../src/components/ArrangePopover.vue')).default

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

/** NcTextField as a plain input: modelValue in, update:modelValue on input, every attribute and listener on the input. */
const FakeField = {
	name: 'NcTextField',
	inheritAttrs: false,
	props: { modelValue: { type: [String, Number], default: '' } },
	emits: ['update:modelValue'],
	setup(props, { attrs, emit }) {
		return () => h('input', { ...attrs, value: props.modelValue, onInput: (e) => emit('update:modelValue', e.target.value) })
	},
}

const BOX = { x: 10, y: 20, w: 200, h: 150, r: 0 }

/**
 * @param {object} [props] props of the panel
 * @return {Promise<object>} {emitted, state (ref of the props), field(name), done()}
 */
async function mountPanel(props = {}) {
	const { compileScript, parse } = await import('vue/compiler-sfc')
	const file = new URL('../../../src/components/ArrangePopover.vue', import.meta.url)
	const { descriptor } = parse(readFileSync(file, 'utf8'))
	// the client template, compiled at run time against the script's bindings ($setup.…), as the build does
	const { bindings } = compileScript(descriptor, { id: 'arrange', inlineTemplate: false })
	const Panel = {
		...ArrangePopover,
		template: descriptor.template.content,
		compilerOptions: { bindingMetadata: bindings, prefixIdentifiers: true },
		setup: (p, ctx) => ({ ...ArrangePopover.setup(p, ctx), NcTextField: FakeField }),
	}
	const emitted = []
	const state = ref({ box: { ...BOX }, rotatable: true, types: ['sticky'], ...props })
	const Root = { setup: () => () => h(Panel, { ...state.value, onApply: (b) => emitted.push(b) }) }
	const app = createRenderer(nodeOps).createApp(Root)
	const container = make('body')
	app.mount(container)
	await nextTick()
	const findAll = (from = container, out = []) => {
		if (from.tag === 'input') {
			out.push(from)
		}
		for (const c of from.children) {
			findAll(c, out)
		}
		return out
	}
	const field = (name) => findAll().find((el) => el.attrs['data-knorke-field'] === 'arrange-' + name) ?? null
	return { emitted, state, field, done: () => app.unmount() }
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
 * @return {object} the event
 */
function key(el, key) {
	const e = { type: 'keydown', key, target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() {} }
	el.on.onKeydown?.(e)
	return e
}

/** @param {object} m mounted panel @return {string[]} the five field values x, y, w, h, r */
const values = (m) => ['x', 'y', 'w', 'h', 'r'].map((n) => m.field(n).value)

test('job 146 (AK5): a new box sets every field (two decimals)', async () => {
	const m = await mountPanel()
	try {
		assert.deepEqual(values(m), ['10', '20', '200', '150', '0'])
		m.state.value = { ...m.state.value, box: { x: 30.456, y: -40, w: 210, h: 160, r: 15 } }
		await nextTick()
		assert.deepEqual(values(m), ['30.46', '-40', '210', '160', '15'])
		assert.deepEqual(m.emitted, [], 'a box applies nothing')
	} finally {
		m.done()
	}
})

test('job 146 (AK5): typed X stays while a new box arrives, Y follows; Y typed and Enter sends both; the next box shows in every field; mounting again shows the box', async () => {
	const m = await mountPanel()
	try {
		const x = m.field('x')
		type(x, '500')
		await nextTick()
		m.state.value = { ...m.state.value, box: { ...BOX, y: 99 } }
		await nextTick()
		assert.equal(m.field('x'), x, 'the same input: never mounted again')
		assert.equal(x.value, '500', 'the open input stays')
		assert.equal(m.field('y').value, '99', 'Y follows the box')
		// X, Tab, Y, Enter: X stays open while the focus has moved on
		type(m.field('y'), '-70')
		const e = key(m.field('y'), 'Enter')
		await nextTick()
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(m.emitted, [{ x: 500, y: -70, w: 200, h: 150, r: 0 }])
		// after Apply no field is open: the next box shows in every field
		m.state.value = { ...m.state.value, box: { x: 480, y: -70, w: 200, h: 150, r: 0 } }
		await nextTick()
		assert.deepEqual(values(m), ['480', '-70', '200', '150', '0'])
		// beyond the limit: the session reports the clamped box, the field shows it
		type(m.field('x'), '20000000')
		key(m.field('x'), 'Enter')
		await nextTick()
		assert.equal(m.emitted.at(-1).x, 2e7)
		m.state.value = { ...m.state.value, box: { x: 1e7, y: -70, w: 200, h: 150, r: 0 } }
		await nextTick()
		assert.equal(m.field('x').value, '10000000')
		// the same values again (nothing was sent): a new report still resets a typed field after Apply
		type(m.field('x'), '20000000')
		// input and keydown are two events: the typed value has been rendered in between
		await nextTick()
		assert.equal(m.field('x').value, '20000000')
		key(m.field('x'), 'Enter')
		m.state.value = { ...m.state.value, box: { x: 1e7, y: -70, w: 200, h: 150, r: 0 } }
		await nextTick()
		assert.equal(m.field('x').value, '10000000')
	} finally {
		m.done()
	}
	const again = await mountPanel({ box: { x: 1e7, y: -70, w: 200, h: 150, r: 0 } })
	try {
		assert.deepEqual(values(again), ['10000000', '-70', '200', '150', '0'])
	} finally {
		again.done()
	}
})

test('job 146: the Apply button sends like Enter and ends the open inputs; disabled fields send nothing', async () => {
	const m = await mountPanel({ rotatable: false, types: ['text'] })
	try {
		type(m.field('x'), '5')
		type(m.field('h'), '999')
		type(m.field('r'), '45')
		await nextTick()
		// the form's submit (the Apply button)
		const form = (function find(n) {
			return n.tag === 'form' ? n : n.children.map(find).find(Boolean) ?? null
		})(m.field('x').parentNode)
		form.on.onSubmit({ type: 'submit', preventDefault() {}, stopPropagation() {} })
		await nextTick()
		assert.deepEqual(m.emitted, [{ x: 5, y: 20, w: 200, h: undefined, r: undefined }], 'a text item: height measured, no angle')
		m.state.value = { ...m.state.value, box: { ...BOX } }
		await nextTick()
		assert.deepEqual(values(m), ['10', '20', '200', '150', '0'], 'every field shows the box again')
	} finally {
		m.done()
	}
})

/**
 * @param {FakeNode} el the checkbox
 * @param {boolean} on its new state (fires change)
 */
function tickBox(el, on) {
	el.checked = on
	el.on.onChange?.({ type: 'change', target: el })
}

test('job 240 (AK5): only a shape has the tick "1:1" between height and angle; notes, frames and texts have none', async () => {
	for (const types of [['sticky'], ['frame'], ['text']]) {
		const m = await mountPanel({ types })
		try {
			assert.equal(m.field('square'), null, types[0])
		} finally {
			m.done()
		}
	}
	const m = await mountPanel({ types: ['shape'], square: false })
	try {
		const sq = m.field('square')
		assert.ok(sq, 'a shape has it')
		assert.equal(sq.attrs.type, 'checkbox')
		assert.equal(sq.attrs.checked, false)
		assert.match(sq.attrs['aria-label'], /1:1/, 'the visible "1:1" is part of its name')
		const order = (function walk(n, out = []) {
			if (n.tag === 'input') out.push(n.attrs['data-knorke-field'])
			for (const c of n.children) walk(c, out)
			return out
		})(sq.parentNode.parentNode)
		assert.deepEqual(order, ['arrange-x', 'arrange-y', 'arrange-w', 'arrange-h', 'arrange-square', 'arrange-r'])
		assert.equal(m.field('h').attrs.disabled, false, 'unticked: the height is free')
	} finally {
		m.done()
	}
})

test('job 240 (AK5): ticked, the height is locked and shows the width, also while it is typed; Apply sends h = w', async () => {
	const m = await mountPanel({ types: ['shape'], square: true, box: { x: 10, y: 20, w: 150, h: 150, r: 0 } })
	try {
		assert.equal(m.field('square').attrs.checked, true)
		assert.equal(m.field('h').attrs.disabled, true)
		type(m.field('w'), '300')
		await nextTick()
		assert.equal(m.field('h').value, '300', 'the height follows the typed width')
		key(m.field('w'), 'Enter')
		await nextTick()
		assert.deepEqual(m.emitted, [{ x: 10, y: 20, w: 300, h: 300, r: 0 }], 'no square key: the tick stays')
	} finally {
		m.done()
	}
})

test('job 240 (AK5): a click on the tick applies at once with its new state and the fields; the tick shows the reported state', async () => {
	const m = await mountPanel({ types: ['shape'], square: false, box: { x: 10, y: 20, w: 200, h: 120, r: 0 } })
	try {
		type(m.field('w'), '150')
		await nextTick()
		const sq = m.field('square')
		tickBox(sq, true)
		await nextTick()
		assert.deepEqual(m.emitted, [{ x: 10, y: 20, w: 150, h: 150, r: 0, square: true }], 'ticking: the height follows the width')
		assert.equal(sq.checked, false, 'until the session reports it, the tick shows the old state')
		m.state.value = { ...m.state.value, square: true, box: { x: 10, y: 20, w: 150, h: 150, r: 0 } }
		await nextTick()
		assert.equal(sq.attrs.checked, true)
		assert.equal(m.field('w').value, '150')
		tickBox(sq, false)
		await nextTick()
		assert.deepEqual(m.emitted.at(-1), { x: 10, y: 20, w: 150, h: 150, r: 0, square: false }, 'unticking keeps the size')
	} finally {
		m.done()
	}
})
