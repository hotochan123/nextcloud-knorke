/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 201 AK5 (part), deterministic in Node on the fake DOM with the
 * real SceneManager: a flowchart shape opens its editor by Enter and by a
 * double click. Job 204 AK3: a BPMN task does too.
 *
 * Factory job 211 AK3 (this file now): a symbol, a BPMN event and a gateway
 * open the editor of their label below the box (openTextEditor, Enter, a
 * double click, a double tap, a double click on the label itself); closing
 * it sends the text; a locked symbol and view-only open none (the rescue
 * editor still opens). AK4 (scene part): a click on the label selects the
 * symbol.
 *
 * Factory job 235 AK3, AK4 (scene part): an own shape (kind image) opens the
 * same label editor below it (openTextEditor, Enter, a double click, a double
 * tap; turned by 90° beside it), a click or a tap on its label selects it;
 * locked or view-only it opens none.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene, shapeItem } from './sceneHarness.mjs'
import { dispatch } from './fakeDom.mjs'
import { HANDLE_TOUCH_PX, SYMBOL_LABEL_FONT_SIZE, SYMBOL_LABEL_GAP, SYMBOL_LABEL_WRAP_W } from '../../../src/model/tokens.js'

const S = '01JA0000000000000000000001'
const D = '01JA0000000000000000000002'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

let h
afterEach(() => {
	h?.restore()
	h = null
})

const editorArea = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))

const symbol = (o = {}) => shapeItem(S, { x: 100, y: 100, w: 96, h: 96, data: { kind: 'iconPerson', text: '' }, style: { fill: '#1a1a1a', strokeWidth: 0 }, ...o })
const board = (o) => setupScene([symbol(o), shapeItem(D, { x: 400, y: 100, data: { kind: 'document', text: '' } })])

test('job 211 AK3: openTextEditor on a symbol opens the label editor below it, centred, wrapW wide; Escape sends the text', () => {
	h = board()
	assert.equal(h.scene.openTextEditor(S), true)
	h.frame()
	const ta = editorArea()
	assert.ok(ta)
	// the box (100, 100, 96 × 96): the label 160 wide centred on x 148, one line of 16 at y 196 + 6
	const x = 148 - SYMBOL_LABEL_WRAP_W / 2
	const y = 196 + SYMBOL_LABEL_GAP
	assert.match(ta.style.getPropertyValue('transform'), new RegExp(`translate\\(${x}px, ${y}px\\)`))
	assert.equal(ta.style.getPropertyValue('width'), SYMBOL_LABEL_WRAP_W + 'px')
	assert.equal(ta.style.getPropertyValue('font-size'), SYMBOL_LABEL_FONT_SIZE + 'px')
	assert.equal(ta.style.getPropertyValue('text-align'), 'center')
	ta.value = 'Kunde'
	dispatch(ta, 'input')
	h.key('Escape', { target: ta })
	h.frame()
	assert.equal(editorArea(), undefined)
	const last = h.intents('text').at(-1)
	assert.deepEqual([last.id, last.path, last.value, last.before, last.final], [S, 'data.text', 'Kunde', '', true])
})

test('job 211 AK3: Enter on the selected symbol, a double click on it and a double tap open the label editor', () => {
	h = board()
	h.scene.setSelection([S])
	h.focusCanvas()
	h.key('Enter')
	h.frame()
	assert.ok(editorArea(), 'Enter')
	h.restore()
	h = board()
	h.pointer('pointerdown', 148, 148)
	h.pointer('pointerup', 148, 148)
	h.pointer('dblclick', 148, 148)
	h.frame()
	assert.ok(editorArea(), 'double click')
	h.restore()
	h = board()
	for (let i = 0; i < 2; i++) {
		h.pointer('pointerdown', 148, 148, { pointerType: 'touch' })
		h.pointer('pointerup', 148, 148, { pointerType: 'touch' })
	}
	h.pointer('dblclick', 148, 148, { pointerType: 'touch' })
	h.frame()
	assert.ok(editorArea(), 'double tap')
	assert.ok(h.log.some((e) => e[0] === 'onEditing' && e[1] === S))
})

test('job 211 AK4: a click on the label selects the symbol, a double click there opens its editor with the label', () => {
	h = board({ data: { kind: 'iconPerson', text: 'Kunde' } })
	const y = 196 + SYMBOL_LABEL_GAP + 9
	h.pointer('pointerdown', 148, y)
	h.pointer('pointerup', 148, y)
	h.frame()
	assert.deepEqual(h.scene.getSelection(), [S])
	h.pointer('pointerdown', 148, y)
	h.pointer('pointerup', 148, y)
	h.pointer('dblclick', 148, y)
	h.frame()
	assert.equal(editorArea()?.value, 'Kunde')
})

test('job 211 AK3: a locked symbol and view-only open no editor; the rescue editor still opens', () => {
	h = board({ lock: LOCK })
	assert.equal(h.scene.openTextEditor(S), false, 'locked')
	assert.equal(h.scene.openTextEditor(S, { text: 'x', notice: 'Your text could not be saved.' }), true, 'rescue')
	h.restore()
	h = board()
	h.scene.setViewOnly(true)
	assert.equal(h.scene.openTextEditor(S), false, 'view-only')
})

test('a flowchart shape opens its editor: by Enter and by a double click', () => {
	h = board()
	h.scene.setSelection([D])
	h.focusCanvas()
	h.key('Enter')
	h.frame()
	assert.ok(editorArea(), 'Enter')
	h.restore()
	h = board()
	h.pointer('pointerdown', 500, 160)
	h.pointer('pointerup', 500, 160)
	h.pointer('dblclick', 500, 160)
	h.frame()
	assert.ok(editorArea(), 'double click')
})

test('job 204 AK3 / job 211 AK3: a BPMN gateway and event open their label editor below them, a BPMN task its editor inside', () => {
	const G = '01JA0000000000000000000003'
	const E = '01JA0000000000000000000004'
	const T = '01JA0000000000000000000005'
	const items = [
		shapeItem(G, { x: 100, y: 100, w: 80, h: 80, data: { kind: 'bpmnExclusive', text: '' } }),
		shapeItem(E, { x: 300, y: 100, w: 64, h: 64, data: { kind: 'bpmnStart', text: '' } }),
		shapeItem(T, { x: 500, y: 100, w: 180, h: 120, data: { kind: 'bpmnUserTask', text: '' } }),
	]
	h = setupScene(items)
	h.pointer('pointerdown', 140, 140)
	h.pointer('pointerup', 140, 140)
	h.pointer('dblclick', 140, 140)
	h.frame()
	assert.match(editorArea().style.getPropertyValue('transform'), new RegExp(`translate\\(${140 - SYMBOL_LABEL_WRAP_W / 2}px, ${180 + SYMBOL_LABEL_GAP}px\\)`), 'below the gateway')
	h.restore()
	h = setupScene(items)
	assert.equal(h.scene.openTextEditor(E), true)
	h.frame()
	assert.match(editorArea().style.getPropertyValue('transform'), new RegExp(`, ${164 + SYMBOL_LABEL_GAP}px\\)`), 'below the event')
	h.restore()
	h = setupScene(items)
	assert.equal(h.scene.openTextEditor(T), true)
	h.frame()
	assert.match(editorArea().style.getPropertyValue('transform'), /translate\(527px, 100px\)/, 'the task: inside its box (its text box beside the badge)')
})

test('job 211 round 1: the selection box reaches below the label and, while its editor is open, below the typed lines (bars never cover it)', () => {
	const boxes = []
	h = setupScene([symbol({ data: { kind: 'iconPerson', text: 'Kunde' } })], { on: { onSelectionBox: (b) => boxes.push(b) } })
	h.scene.setSelection([S])
	h.frame()
	const label = boxes.at(-1)
	// one line of the stored label: 196 + 6 + 16 · 1.2
	assert.ok(label.box.y + label.box.h >= 196 + SYMBOL_LABEL_GAP + SYMBOL_LABEL_FONT_SIZE * 1.2 - 1, JSON.stringify(label.box))
	h.restore()
	boxes.length = 0
	h = setupScene([symbol()], { on: { onSelectionBox: (b) => boxes.push(b) } })
	h.scene.setSelection([S])
	assert.equal(h.scene.openTextEditor(S), true)
	h.frame()
	const ta = editorArea()
	ta.value = 'Kunde\nVertrieb'
	dispatch(ta, 'input')
	h.frame()
	const editing = boxes.at(-1)
	const bottom = 196 + SYMBOL_LABEL_GAP + 2 * SYMBOL_LABEL_FONT_SIZE * 1.2
	assert.ok(editing, 'a box while the editor is open')
	assert.ok(editing.box.y + editing.box.h >= bottom - 1, 'below both typed lines: ' + JSON.stringify(editing.box))
	assert.ok(editing.box.x <= 148 - SYMBOL_LABEL_WRAP_W / 2 + 1 && editing.box.x + editing.box.w >= 148 + SYMBOL_LABEL_WRAP_W / 2 - 1, 'as wide as the editor')
	assert.equal(h.model.get(S).data.text, '', 'the model does not know the typed text yet')
})

test('job 211 round 2: the bottom "+" stands below the label; a double click on line 2 and a double tap at 200 % on line 1 open the event\'s editor, never a neighbour', () => {
	const E = '01JA0000000000000000000006'
	// a 36 × 36 start event (the BPMN size of imported files) with a label of two lines
	const ev = shapeItem(E, { x: 100, y: 100, w: 36, h: 36, data: { kind: 'bpmnStart', text: 'Bestellung eingegangen' } })
	const line = (i, top = 136 + SYMBOL_LABEL_GAP) => top + (i + 0.5) * SYMBOL_LABEL_FONT_SIZE * 1.2
	h = setupScene([ev])
	h.scene.setSelection([E])
	h.frame()
	const plusB = h.scene.handles().find((x) => x.name === 'plus-b')
	assert.ok(plusB, 'the "+" below')
	const labelBottom = 136 + SYMBOL_LABEL_GAP + 2 * SYMBOL_LABEL_FONT_SIZE * 1.2
	// (job 231) the point stands a finger's hit radius below the label, so no tap on the label reaches it
	assert.ok(plusB.y > labelBottom + HANDLE_TOUCH_PX, `below the label (${plusB.y} > ${labelBottom} + ${HANDLE_TOUCH_PX})`)
	// mouse, the event selected first, then a double click on the second line
	h.pointer('pointerdown', 118, line(1))
	h.pointer('pointerup', 118, line(1))
	h.pointer('dblclick', 118, line(1))
	h.frame()
	assert.equal(editorArea()?.value, 'Bestellung eingegangen', 'the editor of the event')
	assert.equal(h.intents('neighbour').length, 0, 'no neighbour')
	h.restore()
	// a finger at 200 % on the first line: the screen point of world (118, line 0)
	h = setupScene([ev])
	h.scene.setCamera({ x: 0, y: 0, scale: 2 })
	h.scene.setSelection([E])
	h.frame()
	const sx = 118 * 2
	const sy = line(0) * 2
	for (let i = 0; i < 2; i++) {
		h.pointer('pointerdown', sx, sy, { pointerType: 'touch' })
		h.pointer('pointerup', sx, sy, { pointerType: 'touch' })
	}
	h.pointer('dblclick', sx, sy, { pointerType: 'touch' })
	h.frame()
	assert.equal(editorArea()?.value, 'Bestellung eingegangen', 'the editor of the event (finger)')
	assert.equal(h.intents('neighbour').length, 0, 'no neighbour (finger)')
})

// ---------------------------------------------------------------- job 235 (own shapes)

const own = (o = {}) => shapeItem(S, { x: 100, y: 100, w: 96, h: 96, data: { kind: 'image', text: '' }, style: { strokeWidth: 0, fillOpacity: 0 }, ...o })
const ownBoard = (o) => setupScene([own(o), shapeItem(D, { x: 260, y: 100, w: 96, h: 96, data: { kind: 'iconPerson', text: '' }, style: { fill: '#1a1a1a', strokeWidth: 0 } })])
/** @return {number[]} the numbers of the editor's transform: x, y and the turn (0 without) */
const placeOf = (ta) => {
	const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)(?: rotate\(([-\d.e]+)deg\))?/.exec(ta.style.getPropertyValue('transform'))
	return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
}

test('job 235 AK3: openTextEditor on an own shape opens the label editor below it, centred; Escape sends the text once (one undo step in the session)', () => {
	h = ownBoard()
	assert.equal(h.scene.openTextEditor(S), true)
	h.frame()
	const ta = editorArea()
	assert.ok(ta)
	const [x, y] = placeOf(ta)
	assert.ok(y >= 196, 'the top of the editor is at or below the bottom of the shape')
	assert.equal(x + SYMBOL_LABEL_WRAP_W / 2, 148, 'centred under the shape')
	assert.equal(ta.style.getPropertyValue('font-size'), SYMBOL_LABEL_FONT_SIZE + 'px')
	assert.equal(ta.style.getPropertyValue('text-align'), 'center')
	ta.value = 'Server'
	dispatch(ta, 'input')
	h.key('Escape', { target: ta })
	h.frame()
	assert.equal(editorArea(), undefined)
	const finals = h.intents('text').filter((i) => i.final)
	assert.equal(finals.length, 1)
	assert.deepEqual([finals[0].id, finals[0].path, finals[0].value, finals[0].before], [S, 'data.text', 'Server', ''])
})

test('job 235 AK3: Enter on the selected own shape, a double click and a double tap on it open the label editor; a tap on its label selects it, not the neighbour', () => {
	h = ownBoard()
	h.scene.setSelection([S])
	h.focusCanvas()
	h.key('Enter')
	h.frame()
	assert.ok(editorArea(), 'Enter')
	h.restore()
	h = ownBoard()
	h.pointer('pointerdown', 148, 148)
	h.pointer('pointerup', 148, 148)
	h.pointer('dblclick', 148, 148)
	h.frame()
	assert.ok(editorArea(), 'double click')
	assert.ok(placeOf(editorArea())[1] >= 196)
	h.restore()
	h = ownBoard()
	for (let i = 0; i < 2; i++) {
		h.pointer('pointerdown', 148, 148, { pointerType: 'touch' })
		h.pointer('pointerup', 148, 148, { pointerType: 'touch' })
	}
	h.pointer('dblclick', 148, 148, { pointerType: 'touch' })
	h.frame()
	assert.ok(editorArea(), 'double tap')
	h.restore()
	// a finger on the label (one line below the box) picks the own shape, not the symbol beside it
	h = ownBoard({ data: { kind: 'image', text: 'Server und Datenbank' } })
	const y = 196 + SYMBOL_LABEL_GAP + 9
	h.pointer('pointerdown', 148, y, { pointerType: 'touch' })
	h.pointer('pointerup', 148, y, { pointerType: 'touch' })
	h.frame()
	assert.deepEqual(h.scene.getSelection(), [S])
	h.pointer('pointerdown', 148, y)
	h.pointer('pointerup', 148, y)
	h.pointer('dblclick', 148, y)
	h.frame()
	assert.equal(editorArea()?.value, 'Server und Datenbank', 'a double click on the label opens its editor')
})

test('job 235 risk: turned by 90°, the label editor stands left of the own shape, turned with it', () => {
	h = ownBoard({ r: 90 })
	assert.equal(h.scene.openTextEditor(S), true)
	h.frame()
	const [x, y, r] = placeOf(editorArea())
	// centre of the label 6 + 9.6 below the box's bottom edge, turned about (148, 148): (148 − 63.6, 148)
	const cx = 148 - (48 + SYMBOL_LABEL_GAP + SYMBOL_LABEL_FONT_SIZE * 1.2 / 2)
	assert.equal(r, 90)
	assert.ok(Math.abs(x + SYMBOL_LABEL_WRAP_W / 2 - cx) < 1e-6, `x ${x}`)
	assert.ok(Math.abs(y + SYMBOL_LABEL_FONT_SIZE * 1.2 / 2 - 148) < 1e-6, `y ${y}`)
})

test('job 235 AK3: a locked own shape and view-only open no editor', () => {
	h = ownBoard({ lock: LOCK })
	assert.equal(h.scene.openTextEditor(S), false, 'locked')
	h.pointer('pointerdown', 148, 148)
	h.pointer('pointerup', 148, 148)
	h.pointer('dblclick', 148, 148)
	h.frame()
	assert.equal(editorArea(), undefined, 'double click on a locked one')
	h.restore()
	h = ownBoard()
	h.scene.setViewOnly(true)
	assert.equal(h.scene.openTextEditor(S), false, 'view-only')
})
