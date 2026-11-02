/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Locked items by marquee (factory job 190), on the fake DOM with the real
 * SceneManager, InputController, GestureController and SceneModel
 * (sceneHarness.mjs; the hold timer replaced by mock.timers):
 * - AK1 the Alt marquee (mouse and pen): over the locked L1, L2 and the
 *   free A it takes [L1, L2] and the earlier selection B goes; Shift+Alt
 *   adds L1, L2 to B; a locked frame only when wholly inside; a locked
 *   member brought by a free member of its group comes along; a marquee
 *   from L1 with Alt takes L1, L2; Alt pressed and released during a
 *   marquee switches at once (no further move); the keyup of Alt after an
 *   Alt marquee gets preventDefault (Windows); a held finger with Alt (a
 *   hardware keyboard) the same; without Alt as before
 * - AK2 the offer: a plain marquee over L1, L2, A selects [A] and offers
 *   {L1, L2} (onLockedOffer); Ctrl/⌘+A offers every locked item; so does
 *   the held finger's marquee; no offer after an Alt or Shift marquee, Esc,
 *   pointercancel and a second finger; the offer ends with a change of the
 *   selection (setSelection, Tab, a removal), the next click, a finger's
 *   tap, Esc and leaving mode edit, not with a finger's pan or a middle
 *   button pan; onSelectionBox reports the box of the offer without a
 *   selection and null as soon as it ends
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene } from './sceneHarness.mjs'

const L1 = '01JA00000000000000000000L1'
const L2 = '01JA00000000000000000000L2'
const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

/** L1 (100, 100) and L2 (400, 100) locked, A (700, 100) free, all 150 × 150; B (100, 500) free, outside the marquee. */
const board = () => [
	note(L1, { x: 100, y: 100, w: 150, h: 150, z: 'a1', lock: LOCK }),
	note(L2, { x: 400, y: 100, w: 150, h: 150, z: 'a2', lock: LOCK }),
	note(A, { x: 700, y: 100, w: 150, h: 150, z: 'a3' }),
	note(B, { x: 100, y: 500, w: 150, h: 150, z: 'a4' }),
]
/** The marquee over L1, L2 and A from empty canvas; ONLY: over L1 and L2 alone. */
const FROM = [50, 50]
const TO = [900, 300]
const ONLY = [600, 300]

let h = null
/** onLockedOffer reports and onSelectionBox values of the scene */
let offers = []
let boxes = []
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/**
 * Fake timers first (the hold timer is the GestureController's setTimeout), then the scene.
 *
 * @param {object[]} [items] WireItems
 */
function setup(items = board()) {
	mock.timers.enable({ apis: ['setTimeout'] })
	offers = []
	boxes = []
	h = setupScene(items, { on: { onLockedOffer: (ids) => offers.push(ids), onSelectionBox: (b) => boxes.push(b) } })
}

const sorted = (ids) => [...ids].sort()
const sel = () => sorted(h.scene.getSelection())
const offer = () => sorted(h.scene.getLockedOffer())

/**
 * A marquee of a mouse or pen from `from` to `to` (pointerdown, two moves, pointerup), every event with `props`.
 *
 * @param {number[]} from press point
 * @param {number[]} to release point
 * @param {object} [props] pointerType, pointerId, shiftKey, altKey …
 * @param {boolean} [release] send the pointerup
 */
function drag(from, to, props = {}, release = true) {
	h.pointer('pointerdown', ...from, props)
	h.pointer('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, props)
	h.pointer('pointermove', ...to, props)
	if (release) h.pointer('pointerup', ...to, props)
	h.frame()
}

const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })
const fdown = (x, y, id = 5, props = {}) => h.pointer('pointerdown', x, y, { ...finger(id), ...props })
const fmove = (x, y, id = 5, props = {}) => {
	h.pointer('pointermove', x, y, { ...finger(id), ...props })
	h.frame()
}
const fup = (x, y, id = 5, props = {}) => {
	h.pointer('pointerup', x, y, { ...finger(id), ...props })
	h.frame()
}
/** A held finger's marquee from `from` to `to` (held LONG_PRESS_MS, then three moves); released unless told. */
function holdDrag(from, to, props = {}, release = true) {
	fdown(...from, 5, props)
	mock.timers.tick(LONG_PRESS_MS)
	fmove(from[0] + 30, from[1] + 30, 5, props)
	fmove((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 5, props)
	fmove(...to, 5, props)
	if (release) fup(...to, 5, props)
}

/** keydown or keyup of Alt on the canvas (bubbles to the window). */
const altKey = (type) => dispatch(h.container, type, { key: 'Alt', code: 'AltLeft', altKey: type === 'keydown', repeat: false, isComposing: false })

describe('job 190 AK1: the Alt marquee takes only the locked items (mouse and pen)', () => {
	for (const [name, input] of [['mouse', { pointerType: 'mouse', pointerId: 1 }], ['pen', { pointerType: 'pen', pointerId: 9 }]]) {
		test(`${name}: over L1, L2 and A with Alt → [L1, L2], the earlier selection B goes; live during the moves`, () => {
			setup()
			h.scene.setSelection([B])
			h.pointer('pointerdown', ...FROM, { ...input, altKey: true })
			h.pointer('pointermove', ...TO, { ...input, altKey: true })
			assert.deepEqual(sel(), sorted([L1, L2]), 'live: the locked ones only')
			h.pointer('pointerup', ...TO, { ...input, altKey: true })
			assert.deepEqual(sel(), sorted([L1, L2]))
			assert.ok(!h.scene.getSelection().includes(B), 'B went')
			assert.deepEqual(h.intents(), [])
		})

		test(`${name}: Shift+Alt adds L1 and L2 to B`, () => {
			setup()
			h.scene.setSelection([B])
			drag(FROM, TO, { ...input, shiftKey: true, altKey: true })
			assert.deepEqual(h.scene.getSelection()[0], B, 'B kept first')
			assert.deepEqual(sel(), sorted([B, L1, L2]))
		})

		test(`${name}: a locked frame only when wholly inside`, () => {
			const F = '01JA00000000000000000000F1'
			setup([frameItem(F, { x: 100, y: 100, w: 300, h: 200, lock: LOCK }), note(A, { x: 600, y: 100, w: 150, h: 150, z: 'a3' })])
			drag(FROM, [250, 250], { ...input, altKey: true })
			assert.deepEqual(sel(), [], 'partly covered: not taken')
			drag(FROM, [450, 350], { ...input, altKey: true })
			assert.deepEqual(sel(), [F], 'wholly inside: taken')
		})

		test(`${name}: a free member of a group hit by the marquee brings its locked member; without Alt it stays out`, () => {
			const G = '01JG0000000000000000000001'
			const M = '01JA00000000000000000000M1'
			const K = '01JA00000000000000000000K1'
			setup([
				note(M, { x: 100, y: 100, w: 150, h: 150, z: 'a1', group: G }),
				note(K, { x: 600, y: 500, w: 150, h: 150, z: 'a2', group: G, lock: LOCK }),
			])
			drag(FROM, [300, 300], { ...input, altKey: true })
			assert.deepEqual(sel(), [K], 'with Alt: the locked member of the hit group')
			drag(FROM, [300, 300], input)
			assert.deepEqual(sel(), [M], 'without Alt: the free member only, as before')
		})

		test(`${name}: a marquee from L1 with Alt takes L1 and L2 (B goes)`, () => {
			setup()
			h.scene.setSelection([B])
			drag([175, 175], ONLY, { ...input, altKey: true })
			assert.deepEqual(sel(), sorted([L1, L2]))
			assert.deepEqual(callsOf('beginDrag'), [], 'no drag')
		})

		test(`${name}: Alt pressed and released during the marquee switches at once, without a move; the keyups get preventDefault`, () => {
			setup()
			drag(FROM, TO, input, false)
			assert.deepEqual(sel(), [A], 'without Alt: the free one')
			const down = altKey('keydown')
			assert.deepEqual(sel(), sorted([L1, L2]), 'Alt pressed: the locked ones at once')
			assert.equal(down.defaultPrevented, false)
			const up = altKey('keyup')
			assert.deepEqual(sel(), [A], 'Alt released: the free one again')
			assert.equal(up.defaultPrevented, true, 'the keyup after Alt in a marquee (Windows: no menu)')
			h.pointer('pointerup', ...TO, input)
			assert.deepEqual(sel(), [A])
			// released with Alt held: its keyup comes after the release and is prevented too, once
			drag(FROM, TO, { ...input, altKey: true })
			assert.deepEqual(sel(), sorted([L1, L2]))
			assert.equal(altKey('keyup').defaultPrevented, true, 'the keyup that ends the Alt marquee')
			assert.equal(altKey('keyup').defaultPrevented, false, 'a later keyup of Alt is the browser\'s')
		})

		test(`${name}: without Alt as before: [A]`, () => {
			setup()
			h.scene.setSelection([B])
			drag(FROM, TO, input)
			assert.deepEqual(sel(), [A])
			assert.equal(altKey('keyup').defaultPrevented, false, 'no Alt marquee, no preventDefault')
		})
	}

	test('a held finger with Alt (a hardware keyboard) takes [L1, L2] the same way', () => {
		setup()
		h.scene.setSelection([B])
		holdDrag(FROM, TO, { altKey: true })
		assert.deepEqual(sel(), sorted([L1, L2]))
		assert.deepEqual(offer(), [], 'no offer after an Alt marquee')
	})
})

describe('job 190 AK2: the offer of the scene', () => {
	test('a plain marquee over L1, L2, A: selection [A], offer {L1, L2} (onLockedOffer once, at the release)', () => {
		setup()
		drag(FROM, TO, {}, false)
		assert.deepEqual(offers, [], 'nothing during the marquee')
		h.pointer('pointerup', ...TO)
		assert.deepEqual(sel(), [A])
		assert.deepEqual(offer(), sorted([L1, L2]))
		assert.deepEqual(offers.map(sorted), [sorted([L1, L2])])
		// a pen's marquee the same way
		h.scene.setSelection([])
		drag(FROM, TO, { pointerType: 'pen', pointerId: 9 })
		assert.deepEqual(offer(), sorted([L1, L2]))
	})

	test('Ctrl/⌘+A: every free item selected, every locked item offered', () => {
		setup([...board(), note('01JA00000000000000000000L3', { x: 2000, y: 2000, lock: LOCK, z: 'a5' })])
		h.key('a', { ctrlKey: true })
		assert.deepEqual(sel(), sorted([A, B]))
		assert.deepEqual(offer(), sorted([L1, L2, '01JA00000000000000000000L3']))
		h.scene.setSelection([])
		h.key('a', { metaKey: true })
		assert.deepEqual(offer(), sorted([L1, L2, '01JA00000000000000000000L3']), '⌘+A')
	})

	test('the held finger\'s marquee (real GestureController) offers {L1, L2} too', () => {
		setup()
		holdDrag(FROM, TO)
		assert.deepEqual(sel(), [A])
		assert.deepEqual(offer(), sorted([L1, L2]))
	})

	test('no offer after an Alt marquee, a Shift marquee, Esc, pointercancel and a second finger', () => {
		setup()
		drag(FROM, TO, { altKey: true })
		assert.deepEqual(offer(), [], 'Alt')
		h.scene.setSelection([B])
		drag(FROM, TO, { shiftKey: true })
		assert.deepEqual(sel(), sorted([A, B]))
		assert.deepEqual(offer(), [], 'Shift')
		h.scene.setSelection([])
		drag(FROM, TO, {}, false)
		h.key('Escape')
		h.pointer('pointerup', ...TO)
		assert.deepEqual(offer(), [], 'Esc')
		drag(FROM, TO, {}, false)
		h.pointer('pointercancel', ...TO)
		h.pointer('pointerup', ...TO)
		assert.deepEqual(offer(), [], 'pointercancel')
		holdDrag(FROM, TO, {}, false)
		assert.deepEqual(sel(), [A], 'the finger\'s marquee runs')
		fdown(500, 700, 6)
		fup(...TO, 5)
		fup(500, 700, 6)
		assert.deepEqual(offer(), [], 'a second finger')
		assert.deepEqual(offers, [], 'never offered')
	})

	test('the offer ends with a change of the selection: setSelection, Tab, the removal of a selected item', () => {
		setup()
		drag(FROM, TO)
		h.scene.setSelection([B])
		assert.deepEqual(offer(), [], 'setSelection')
		h.scene.setSelection([])
		drag(FROM, TO)
		h.focusCanvas()
		h.key('Tab')
		assert.notDeepEqual(sel(), [A])
		assert.deepEqual(offer(), [], 'Tab')
		h.scene.setSelection([])
		drag(FROM, TO)
		assert.deepEqual(offer(), sorted([L1, L2]))
		h.scene.update(h.model.apply({ removes: [A] }))
		assert.deepEqual(sel(), [])
		assert.deepEqual(offer(), [], 'A removed by someone else')
	})

	test('the offer ends with the next click (also when it changes no selection), a finger\'s tap and Esc; reported with onLockedOffer([])', () => {
		setup()
		drag(FROM, ONLY)
		assert.deepEqual(sel(), [], 'only locked items: an empty selection')
		assert.deepEqual(offer(), sorted([L1, L2]))
		h.pointer('pointerdown', 950, 750)
		assert.deepEqual(offer(), [], 'the press of the next click')
		h.pointer('pointerup', 950, 750)
		assert.deepEqual(offers.at(-1), [])
		drag(FROM, ONLY)
		assert.deepEqual(offer(), sorted([L1, L2]))
		fdown(950, 750)
		assert.deepEqual(offer(), sorted([L1, L2]), 'a finger down is no tap yet')
		fup(950, 750)
		assert.deepEqual(offer(), [], 'a finger\'s tap on empty canvas')
		drag(FROM, ONLY)
		h.key('Escape')
		assert.deepEqual(offer(), [], 'Esc')
		assert.deepEqual(offers.at(-1), [])
	})

	test('a finger\'s pan and a middle-button pan keep the offer; leaving mode edit ends it', () => {
		setup()
		drag(FROM, ONLY)
		const cam = h.scene.getCamera()
		fdown(950, 750)
		fmove(900, 700)
		fmove(850, 650)
		fup(850, 650)
		assert.notDeepEqual(h.scene.getCamera(), cam, 'the finger panned')
		assert.deepEqual(offer(), sorted([L1, L2]), 'the pan keeps it')
		h.pointer('pointerdown', 950, 750, { button: 1, buttons: 4 })
		h.pointer('pointermove', 900, 700, { button: 1, buttons: 4 })
		h.pointer('pointerup', 900, 700, { button: 1 })
		h.frame()
		assert.deepEqual(offer(), sorted([L1, L2]), 'the middle button keeps it')
		const n = offers.length
		h.scene.setMode('vote')
		assert.deepEqual(offer(), [], 'mode vote')
		assert.deepEqual(offers.slice(n), [[]], 'reported')
		h.scene.setMode('edit')
		h.key('a', { ctrlKey: true })
		h.scene.setMode('view')
		assert.deepEqual(offer(), [], 'mode view')
		assert.deepEqual(h.scene.setLockedOffer([L1]), false, 'not outside mode edit')
		assert.deepEqual(offer(), [])
	})

	test('onSelectionBox: without a selection the box of the offer (keep = box), null as soon as it ends', () => {
		setup()
		drag(FROM, ONLY)
		h.frame()
		const b = boxes.at(-1)
		assert.ok(b !== null && b !== undefined, 'a box for the offer')
		assert.deepEqual(b.keep, b.box, 'no handles')
		h.key('Escape')
		h.frame()
		assert.equal(boxes.at(-1), null, 'the offer ended: null')
		h.scene.setSelection([L1, L2])
		h.frame()
		assert.deepEqual(boxes.at(-1).box, b.box, 'the box of L1 and L2 as if they were selected')
		// a removed offered item leaves the box
		h.scene.setSelection([])
		h.frame()
		drag(FROM, ONLY)
		h.scene.update(h.model.apply({ removes: [L2] }))
		h.frame()
		const one = boxes.at(-1)
		assert.ok(one !== null && one.box.w < b.box.w, 'only L1 left')
		h.scene.update(h.model.apply({ upserts: [{ ...structuredClone(h.model.get(L1)), lock: null }] }))
		h.frame()
		assert.equal(boxes.at(-1), null, 'L1 unlocked: nothing offered is left, null')
	})

	test('setLockedOffer (the session\'s "Select all") sets the offer without onLockedOffer; null ends it', () => {
		setup()
		assert.equal(h.scene.setLockedOffer([L1, L2]), true)
		assert.deepEqual(offer(), sorted([L1, L2]))
		assert.equal(h.scene.setLockedOffer([L1, L2]), false, 'the same again: no change')
		assert.deepEqual(offers, [], 'no echo')
		assert.equal(h.scene.setLockedOffer(null), true)
		assert.deepEqual(offer(), [])
		assert.equal(h.scene.setLockedOffer([]), false)
	})
})
