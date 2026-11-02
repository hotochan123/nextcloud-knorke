/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Frame titles easy to find (job 143), on the fake DOM with the real
 * SceneManager, InputController, GestureController and TextEditor
 * (sceneHarness.mjs, renderer stubbed) and, for the node, with a fake
 * builder context like nodes.test.mjs:
 * - AK1 when the hint "Add title…" shows: stats().titleHint is the one
 *   selected, unlocked frame without a title (blanks count as none) in mode
 *   edit at LOD 0/1; null without a selection, with a note beside the
 *   frame, with a title, locked, in modes vote and view, at LOD 2, while its
 *   title editor is open and while it is dragged; back after each; a title
 *   that arrives by a model update removes it by the next frame. The
 *   renderer hears only of changes (setTitleHint).
 * - AK2 how it looks: the node of nodes/titleHint.js (job 243: a dashed
 *   tab with the text: its outline traced over the tab's top only, the
 *   text in the title size, regular weight, one line with an ellipsis,
 *   FRAME_TAB_PAD from the left, the tab frameTabWidth of the text wide, not
 *   listening) and its colour (lighter than FRAME_TITLE_COLOR, ≥ 4.5 : 1 on
 *   BOARD_BACKGROUND), the German text
 * - AK3 the second click with mouse and pen: the first click selects, the
 *   second on the title band opens the title editor (with and without a
 *   title); a drag, Shift, the border, a locked frame, modes vote and view
 *   and a click into a multi-selection open none; a double click on an
 *   unselected frame's band opens it once
 * - AK4 the finger: the second tap opens the editor and its touchend is
 *   cancelled; the selecting tap and a finger drag open none; a pen tap
 *   that opens it or creates a frame (AK5: the new title editor lies above
 *   the frame) cancels its touchend too, a mouse never
 * - review round 1 (UI): a new frame's title band comes into view below the
 *   top chrome before its editor opens (scene.revealTitle, the session's
 *   create flow mimicked with the real createItem): the editor rectangle
 *   lies in the view under `top`; the camera moves as little as needed
 *   (left edge, bottom edge), not at all for a band in place or a note
 * - job 158 (the second click opens the title only on its text; the stub
 *   measures GLYPH · FRAME_TITLE_SIZE = 11 world px per code point, job 243;
 *   the zone is the tab, text + 2 · 14): AK1
 *   "Ideen" (tab 83) with mouse and pen: x 160 opens, x 195 and x 450 keep
 *   [F] without an editor or intent, the first click only selects, a drag
 *   from x 450 moves; AK2 the least width of 44 screen px ("A", also at
 *   scale 0.5), a title wider than F, a frame narrower than 44 px on
 *   screen (the whole band); AK3 the hint (tw 120); AK4 LOD 2 (the painted
 *   title of paintStubCoarse, no zone without a title, the double click on
 *   the whole band); AK5 the finger (touchend cancelled only in the zone);
 *   AK6 the double click beside the text at LOD 0
 * - job 193 (AK4, AK5): a new note pad's title band (job 263: its binding on top), comes
 *   into view the same way (a note tool click with the type pad near the
 *   bottom edge opens the padTitle editor in view); revealTitle on a pad
 *   left of the view, on one in place; (review round 1) with bottom, the
 *   bars at the bottom: the band stays bottom + E above the bottom edge
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createItem } from '../../../src/board/actions.js'
import { itemFromPut } from '../../../src/model/paths.js'
import { TITLE_REVEAL_EDGE_PX } from '../../../src/scene/SceneManager.js'
import { buildTitleHint, placeTitleHint, titleHintBox } from '../../../src/scene/nodes/titleHint.js'
import {
	BOARD_BACKGROUND, FONT_FAMILY, FRAME_STROKE_WIDTH, FRAME_TAB_INSET, FRAME_TAB_PAD, FRAME_TITLE_BAND, FRAME_TITLE_COLOR, FRAME_TITLE_HINT_COLOR,
	FRAME_TITLE_HINT_DASH, FRAME_TITLE_SIZE,
} from '../../../src/model/tokens.js'
import { t } from '../../../src/util/l10n.js'
import { dispatch } from './fakeDom.mjs'
import { TITLE_CLICK_MIN_PX, TITLE_CLICK_PAD_PX } from '../../../src/scene/InputController.js'
import { callsOf, frameItem, note, paintStubCoarse, setStubLod, setupScene } from './sceneHarness.mjs'

const F = '01JA0000000000000000000009'
const N = '01JA0000000000000000000001'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

/**
 * F spans (100, 100)–(500, 400); its title band is y 60–100 (job 243) (camera at the
 * origin, scale 1). BAND lies on the left of the band, where the hint text
 * sits: a finger or pen near the top-middle resize handle grabs the handle.
 */
const untitled = (o = {}) => frameItem(F, { x: 100, y: 100, w: 400, h: 300, data: { title: '' }, ...o })
const BAND = [200, 75]
/** (job 158) on the text of a title like "Ideen" (x 100–170), where the second click opens it */
const TEXT = [150, 75]
const BORDER = [200, 103]

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

const hint = () => h.scene.stats().titleHint
const editing = () => h.scene.stats().editing
/** @return {Array<string|null>} the ids of onEditing so far */
const editingLog = () => h.log.filter((e) => e[0] === 'onEditing').map((e) => e[1])
/** @return {object|null} the open textarea */
const editorEl = () => {
	const ta = h.dom.doc.activeElement
	return ta && ta.tagName === 'TEXTAREA' ? ta : null
}

/** A press and release at one point (mouse unless props say otherwise), then a frame. */
function click(x, y, props = {}) {
	h.pointer('pointerdown', x, y, props)
	h.pointer('pointerup', x, y, props)
	h.frame()
}

/** Selects ids from the shell and lets one frame pass. */
function select(ids) {
	h.scene.setSelection(ids)
	h.frame()
}

describe('AK1 when the hint shows', () => {
	test('one selected, unlocked frame without a title in mode edit: titleHint is its id, also with a title of blanks', () => {
		for (const title of ['', '   ']) {
			h = setupScene([untitled({ data: { title } }), note(N, { x: 700, y: 100 })])
			assert.equal(hint(), null, 'nothing selected')
			select([F])
			assert.equal(hint(), F, JSON.stringify(title))
			assert.deepEqual(callsOf('setTitleHint').at(-1), [F], 'the renderer draws it')
			h.restore()
			h = null
		}
	})

	test('null without a selection, with a note beside the frame, with a title, on a locked frame', () => {
		h = setupScene([untitled(), note(N, { x: 700, y: 100 })])
		select([F, N])
		assert.equal(hint(), null, 'the frame with a note')
		select([N])
		assert.equal(hint(), null, 'a note')
		select([F])
		assert.equal(hint(), F)
		select([])
		assert.equal(hint(), null, 'no selection')
		assert.deepEqual(callsOf('setTitleHint'), [[F], [null]], 'the renderer hears only of changes')
		h.restore()
		h = setupScene([untitled({ data: { title: 'Ideen' } })])
		select([F])
		assert.equal(hint(), null, 'a frame with a title')
		h.restore()
		h = setupScene([untitled({ lock: LOCK })])
		select([F])
		assert.equal(hint(), null, 'a locked frame')
	})

	test('null in modes vote and view and at LOD 2; back in mode edit and at LOD 0', () => {
		h = setupScene([untitled()])
		select([F])
		assert.equal(hint(), F)
		for (const mode of ['vote', 'view']) {
			h.scene.setMode(mode)
			h.frame()
			assert.equal(hint(), null, mode)
			h.scene.setMode('edit')
			h.frame()
			assert.equal(hint(), F, 'edit again after ' + mode)
		}
		setStubLod(2)
		h.scene.setCamera({ x: 0, y: 0, scale: 0.08 })
		h.frame()
		assert.equal(hint(), null, 'LOD 2')
		setStubLod(0)
		h.scene.setCamera({ x: 0, y: 0, scale: 1 })
		h.frame()
		assert.equal(hint(), F, 'LOD 0 again')
	})

	test('null while the title editor of F is open; F again after it closed', () => {
		h = setupScene([untitled()])
		select([F])
		assert.equal(h.scene.openTextEditor(F), true)
		h.frame()
		assert.equal(hint(), null, 'editor open')
		h.key('Escape', { target: editorEl() })
		h.frame()
		assert.equal(editing(), null)
		assert.equal(hint(), F, 'editor closed')
	})

	test('null while F is dragged; F again after the release', () => {
		h = setupScene([untitled()])
		select([F])
		h.pointer('pointerdown', ...BAND)
		h.pointer('pointermove', 340, 120)
		h.frame()
		assert.equal(h.scene.stats().dragging, true)
		assert.equal(hint(), null, 'dragged')
		h.pointer('pointerup', 340, 120)
		h.frame()
		assert.equal(hint(), F, 'released')
		assert.equal(editing(), null, 'a drag opens no editor')
	})

	test('a title that arrives by a model update (sync) removes the hint by the next frame', () => {
		h = setupScene([untitled()])
		select([F])
		assert.equal(hint(), F)
		const summary = h.model.apply({ upserts: [{ ...structuredClone(h.model.get(F)), data: { title: 'Ideen' } }] })
		h.scene.update(summary)
		h.frame()
		assert.equal(hint(), null)
		assert.deepEqual(callsOf('setTitleHint').at(-1), [null])
	})
})

describe('AK2 how the hint looks', () => {
	class FakeNode {
		constructor(attrs) {
			this.attrs = { ...attrs }
			this.children = []
		}

		add(n) { this.children.push(n) }
		getAttr(k) { return this.attrs[k] }
		setAttrs(a) { Object.assign(this.attrs, a) }
	}
	const ctx = { Group: class extends FakeNode {}, Shape: class extends FakeNode {}, Text: class extends FakeNode {} }
	/** A context that records the path the outline traces and its strokeShape. */
	function recorder() {
		const ops = []
		const c = {}
		for (const k of ['beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'fill', 'fillShape', 'strokeShape']) c[k] = (...a) => ops.push([k, ...a])
		return { c, ops }
	}

	test('job 243 the node: a dashed tab on F\'s top left edge with "Add title…" (the title size, regular, one line cut with an ellipsis), not listening', () => {
		const abs = { x: 120, y: 340, w: 360, h: 200, r: 0 }
		const hint = buildTitleHint(ctx)
		assert.equal(hint.node.attrs.name, 'knorke-title-hint')
		assert.deepEqual(hint.node.children, [hint.outline, hint.text])
		assert.equal(placeTitleHint(hint, abs, 110), true)
		assert.equal(placeTitleHint(hint, abs, 110), false, 'in place: nothing changes')
		assert.deepEqual([hint.node.attrs.x, hint.node.attrs.y, hint.node.attrs.opacity], [120, 340, 1], 'on the frame\'s top left corner')
		assert.deepEqual(titleHintBox(abs, 110), { x: 120, y: 340, tabW: 110 + 2 * FRAME_TAB_PAD, textW: 110 })
		const a = hint.text.attrs
		assert.equal(a.text, t('knorke', 'Add title…'))
		assert.equal(a.text, 'Add title…')
		assert.deepEqual([a.x, a.y, a.width, a.height], [FRAME_TAB_PAD, -FRAME_TITLE_BAND, 110, FRAME_TITLE_BAND])
		assert.equal(a.fontSize, FRAME_TITLE_SIZE)
		assert.equal(a.fontStyle, 'normal', 'regular, not the title\'s semibold')
		assert.equal(a.fontFamily, FONT_FAMILY)
		assert.equal(a.fill, FRAME_TITLE_HINT_COLOR)
		assert.equal(a.verticalAlign, 'middle')
		assert.equal(a.wrap, 'none')
		assert.equal(a.ellipsis, true)
		for (const n of [hint.node, hint.outline, hint.text]) {
			assert.equal(n.attrs.listening, false)
			assert.equal(n.attrs.perfectDrawEnabled, false)
		}
		const o = hint.outline.attrs
		assert.deepEqual([o.stroke, o.strokeWidth, o.strokeScaleEnabled, o.dash, o.fill], [FRAME_TITLE_HINT_COLOR, FRAME_STROKE_WIDTH, false, [...FRAME_TITLE_HINT_DASH], undefined])
		assert.deepEqual([...FRAME_TITLE_HINT_DASH], [5, 4])
		const { c, ops } = recorder()
		o.sceneFunc(c, hint.outline)
		const tabW = 110 + 2 * FRAME_TAB_PAD
		assert.deepEqual(ops[1], ['moveTo', 0, 0], 'from the frame\'s top left corner')
		assert.deepEqual(ops.filter((x) => x[0] === 'lineTo').at(-1), ['lineTo', tabW, 0], 'down to the top edge at the tab\'s right')
		assert.ok(ops.filter((x) => x[0] === 'arc').length === 2, 'two rounded corners')
		assert.ok(!ops.some((x) => x[0] === 'closePath' || x[0] === 'fill' || x[0] === 'fillShape'), 'open, no fill')
		assert.deepEqual(ops.at(-1), ['strokeShape', hint.outline])
	})

	test('job 243 a long hint on a narrow frame: the tab ends FRAME_TAB_INSET left of the right edge, the text cut; hidden without a box', () => {
		const hint = buildTitleHint(ctx)
		placeTitleHint(hint, { x: 0, y: 0, w: 100, h: 80 }, 300)
		assert.equal(hint.box.tabW, 100 - FRAME_TAB_INSET)
		assert.equal(hint.text.attrs.width, 100 - FRAME_TAB_INSET - 2 * FRAME_TAB_PAD)
		placeTitleHint(hint, { x: 0, y: 0, w: 20, h: 80 }, 300)
		assert.equal(hint.box.tabW, 12, 'at least 12')
		assert.equal(hint.text.attrs.visible, false, 'no room for text')
		assert.equal(placeTitleHint(hint, null, 300), true)
		assert.equal(hint.node.attrs.opacity, 0)
	})

	test('FRAME_TITLE_HINT_COLOR is lighter than FRAME_TITLE_COLOR and has at least 4.5 : 1 on BOARD_BACKGROUND', () => {
		const lin = (v) => {
			const c = v / 255
			return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
		}
		const lum = (hex) => {
			const n = parseInt(hex.slice(1), 16)
			return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
		}
		const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
		assert.match(FRAME_TITLE_HINT_COLOR, /^#[0-9a-f]{6}$/)
		assert.ok(lum(FRAME_TITLE_HINT_COLOR) > lum(FRAME_TITLE_COLOR), 'lighter than the title')
		assert.ok(ratio(FRAME_TITLE_HINT_COLOR, BOARD_BACKGROUND) >= 4.5, String(ratio(FRAME_TITLE_HINT_COLOR, BOARD_BACKGROUND)))
	})

	test('the German text', () => {
		const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8'))
		assert.equal(de.translations['Add title…'], 'Titel hinzufügen …')
	})
})

describe('AK3 the second click (mouse and pen)', () => {
	for (const pointerType of ['mouse', 'pen']) {
		for (const title of ['', 'Ideen']) {
			test(`${pointerType}, title ${JSON.stringify(title)}: the first click selects only, the second on the band opens the title editor`, () => {
				h = setupScene([untitled({ data: { title } })])
				// (job 158) a title opens only on its text
				const at = title === '' ? BAND : TEXT
				// (job 252) an unselected frame without a title shows no tab: its border selects it
				click(...(title === '' ? BORDER : at), { pointerType })
				assert.deepEqual(h.scene.getSelection(), [F])
				assert.equal(editing(), null, 'the first click only selects')
				click(...at, { pointerType })
				assert.equal(editing(), F)
				assert.equal(editorEl()?.getAttribute('data-knorke-editor-kind'), 'title')
				assert.deepEqual(editingLog(), [F])
				assert.equal(hint(), null)
			})
		}
	}

	test('a drag from the band of the selected F moves it (move intent) and opens no editor', () => {
		h = setupScene([untitled()])
		select([F])
		h.pointer('pointerdown', ...BAND)
		h.pointer('pointermove', 360, 140)
		h.frame()
		h.pointer('pointerup', 360, 140)
		h.frame()
		assert.equal(editing(), null)
		assert.deepEqual(h.intents().map((i) => i.type), ['move'])
	})

	test('Shift, the border, a locked F and modes vote and view open no editor', () => {
		h = setupScene([untitled()])
		select([F])
		click(...BAND, { shiftKey: true })
		assert.equal(editing(), null, 'Shift')
		assert.deepEqual(h.scene.getSelection(), [], 'Shift toggled F out')
		select([F])
		click(...BORDER)
		assert.deepEqual(h.scene.getSelection(), [F], 'the border hits F')
		assert.equal(editing(), null, 'the border')
		for (const mode of ['vote', 'view']) {
			h.scene.setMode(mode)
			click(...BAND)
			assert.equal(editing(), null, mode)
			h.scene.setMode('edit')
		}
		assert.deepEqual(editingLog(), [])
		h.restore()
		// (job 252) a locked frame shows no hint: its title's tab
		h = setupScene([untitled({ lock: LOCK, data: { title: 'Ideen' } })])
		select([F])
		click(...TEXT)
		assert.deepEqual(h.scene.getSelection(), [F], 'a locked frame is selected')
		assert.equal(editing(), null, 'a locked frame')
	})

	test('a click into the multi-selection [F, N] narrows it to [F] and opens no editor', () => {
		// (job 252) no hint with two selected: the tab of F's title
		h = setupScene([untitled({ data: { title: 'Ideen' } }), note(N, { x: 700, y: 100 })])
		select([F, N])
		click(...TEXT)
		assert.deepEqual(h.scene.getSelection(), [F])
		assert.equal(editing(), null)
	})

	test('a double click on the band of the unselected F opens the editor; onEditing(F) comes exactly once', () => {
		h = setupScene([untitled({ data: { title: 'Ideen' } })])
		click(...TEXT)
		click(...TEXT)
		h.pointer('dblclick', ...TEXT)
		h.frame()
		assert.equal(editing(), F)
		assert.deepEqual(editingLog(), [F])
	})
})

describe('AK4 the finger', () => {
	const finger = { pointerType: 'touch', pointerId: 5 }
	/** The touchend the browser sends after the finger's pointerup (cancelable, like a real one). */
	const touchEnd = () => dispatch(h.container, 'touchend', { cancelable: true })

	/** One finger: down, moves (each followed by a frame), up. */
	function touch(path) {
		h.pointer('pointerdown', ...path[0], finger)
		for (const p of path.slice(1)) {
			h.pointer('pointermove', ...p, finger)
			h.frame()
		}
		h.pointer('pointerup', ...path.at(-1), finger)
		h.frame()
	}

	test('the tap that selects F opens nothing and keeps its touchend; the next tap on the band opens the editor and cancels its touchend', () => {
		h = setupScene([untitled()])
		// (job 252) the unselected F without a title shows no tab: a tap on its border selects it
		touch([BORDER])
		assert.deepEqual(h.scene.getSelection(), [F])
		assert.equal(editing(), null)
		assert.equal(touchEnd().defaultPrevented, false, 'the selecting tap keeps its click')
		touch([BAND])
		assert.equal(editing(), F)
		assert.equal(editorEl()?.getAttribute('data-knorke-editor-kind'), 'title')
		assert.equal(touchEnd().defaultPrevented, true, 'no compatibility click beside the new editor')
		assert.equal(touchEnd().defaultPrevented, false, 'only once')
	})

	test('a pen tap that opens the editor cancels its touchend too (a pen on a tablet sends touch events)', () => {
		h = setupScene([untitled()])
		select([F])
		click(...BAND, { pointerType: 'pen' })
		assert.equal(editing(), F)
		assert.equal(touchEnd().defaultPrevented, true)
	})

	test('a finger drag beyond the threshold from the band of the selected F moves it and opens no editor', () => {
		h = setupScene([untitled()])
		select([F])
		touch([BAND, [320, 100], [360, 140]])
		assert.equal(editing(), null)
		assert.deepEqual(h.intents().map((i) => i.type), ['move'])
		assert.equal(touchEnd().defaultPrevented, false)
	})

	test('AK5 with a pen: a frame tool tap creates the frame and cancels its touchend (the new title editor lies above the frame, not under the pen); a mouse does not', () => {
		h = setupScene([])
		h.scene.setTool('frame')
		click(500, 600, { pointerType: 'pen', pointerId: 3 })
		assert.deepEqual(h.intents(), [{ type: 'create', t: 'frame', at: { x: 500, y: 600 }, rect: null }])
		assert.equal(touchEnd().defaultPrevented, true, 'no compatibility mousedown on the canvas ends the new title editor')
		assert.equal(touchEnd().defaultPrevented, false, 'only once')
		h.scene.setTool('frame')
		click(500, 600)
		assert.equal(h.intents().length, 2)
		assert.equal(touchEnd().defaultPrevented, false, 'a mouse create sets nothing')
	})
})

describe('job 158: the second click opens the title only on its text', () => {
	/** y of every press on F's title band (60–100, job 243) */
	const Y = 75
	const finger = { pointerType: 'touch', pointerId: 5 }
	const titled = (title, o = {}) => untitled({ data: { title }, ...o })
	const touchEnd = () => dispatch(h.container, 'touchend', { cancelable: true })
	/** A finger's tap at one point: down, up, a frame. */
	function tap(x, y) {
		h.pointer('pointerdown', x, y, finger)
		h.pointer('pointerup', x, y, finger)
		h.frame()
	}
	/** A fresh scene with F alone, selected from the shell, at the camera scale s. */
	function selected(item, s = 1) {
		h?.restore()
		h = setupScene([item])
		if (s !== 1) {
			h.scene.setCamera({ x: 0, y: 0, scale: s })
			h.frame()
		}
		select([F])
	}
	/** @return {boolean} a second click at screen (x, y) on the selected F opened its title editor */
	function opensAt(x, y) {
		click(x, y)
		return editing() === F
	}

	test('the constants are screen px: TITLE_CLICK_PAD_PX 8, TITLE_CLICK_MIN_PX 44', () => {
		assert.equal(TITLE_CLICK_PAD_PX, 8)
		assert.equal(TITLE_CLICK_MIN_PX, 44)
	})

	for (const pointerType of ['mouse', 'pen']) {
		test(`AK1 ${pointerType}, "Ideen" (tab 83, job 243): the first click at x 160 selects only; (job 252) x 195 and x 450 beside the tab are canvas (selection [], no editor or intent); x 160 selects, then opens the title editor`, () => {
			h = setupScene([titled('Ideen')])
			click(160, Y, { pointerType })
			assert.deepEqual(h.scene.getSelection(), [F])
			assert.equal(editing(), null, 'the first click only selects')
			for (const x of [195, 450]) {
				click(x, Y, { pointerType })
				assert.deepEqual(h.scene.getSelection(), [], `x ${x}`)
				assert.equal(editing(), null, `x ${x}`)
				select([F])
			}
			assert.deepEqual(h.intents(), [], 'no intent beside the tab')
			assert.deepEqual(editingLog(), [])
			click(160, Y, { pointerType })
			assert.equal(editing(), F)
			assert.equal(editorEl()?.getAttribute('data-knorke-editor-kind'), 'title')
			assert.deepEqual(editingLog(), [F], 'onEditing exactly once')
		})
	}

	test('AK1 (job 252) a drag from x 450 beside the tab of the selected F moves nothing and opens no editor; from the tab it moves F', () => {
		selected(titled('Ideen'))
		h.pointer('pointerdown', 450, Y)
		h.pointer('pointermove', 480, 110)
		h.frame()
		h.pointer('pointerup', 480, 110)
		h.frame()
		assert.equal(editing(), null)
		assert.deepEqual(h.intents().filter((i) => i.type === 'move'), [], 'beside the tab: no move')
		selected(titled('Ideen'))
		h.pointer('pointerdown', ...TEXT)
		h.pointer('pointermove', 180, 110)
		h.frame()
		h.pointer('pointerup', 180, 110)
		h.frame()
		assert.equal(editing(), null)
		assert.deepEqual(h.intents().map((i) => i.type), ['move'])
	})

	test('AK2 "A" (tab 39, job 252: only the tab hits, plus 4 px): x 140 opens, x 150 is canvas; at scale 0.5 18 px right of F.x opens, 30 px is canvas', () => {
		selected(titled('A'))
		assert.equal(opensAt(150, Y), false, 'x 150')
		assert.deepEqual(h.scene.getSelection(), [], 'x 150 beside the tab')
		select([F])
		assert.equal(opensAt(140, Y), true, 'x 140')
		// scale 0.5: F.x lies at screen x 50, world y 75 at screen y 37.5; the tab is 19.5 px wide
		selected(titled('A'), 0.5)
		assert.equal(opensAt(80, 37.5), false, '30 px right of F.x')
		assert.deepEqual(h.scene.getSelection(), [])
		select([F])
		assert.equal(opensAt(68, 37.5), true, '18 px right of F.x')
	})

	test('AK2 a title wider than F (shortened with "…"): its tab ends 24 left of the right edge (job 243): x 480 opens, x 490 does not', () => {
		selected(titled('Retrospective sprint twelve and more'))
		assert.equal(opensAt(490, Y), false)
		assert.deepEqual(h.scene.getSelection(), [], '(job 252) beside the tab: canvas')
		select([F])
		assert.equal(opensAt(480, Y), true)
	})

	test('AK2 a frame 50 wide at scale 0.5 (25 px on screen): every point of its band that hits F opens', () => {
		const narrow = titled('Ideen', { w: 50 })
		const hits = []
		for (let x = 40; x <= 90; x++) {
			selected(narrow, 0.5)
			const open = opensAt(x, 37.5)
			if (h.scene.getSelection().length === 1) {
				assert.equal(open, true, `screen x ${x} hits F but opens no editor`)
				hits.push(x)
			} else {
				assert.equal(open, false)
			}
		}
		// (job 252) the tab: max(min(83, 50 − 24), 12) = 26 world = 13 px, plus 4 px on each side
		assert.ok(hits.length >= 13, `points that hit: ${hits}`)
		assert.ok(hits.includes(50) && hits.includes(63) && hits.at(-1) <= 67, `left edge, the tab's right edge and the tolerance, no more: ${hits}`)
	})

	test('AK3 the hint "Add title…" (tw 120): x 220 opens, x 260 does not; the same with a title of blanks', () => {
		for (const title of ['', '   ']) {
			selected(titled(title))
			assert.equal(hint(), F, 'the hint is drawn')
			assert.equal(opensAt(260, Y), false, `x 260, ${JSON.stringify(title)}`)
			assert.deepEqual(h.scene.getSelection(), [], '(job 252) beside the hint tab: canvas')
			select([F])
			assert.equal(opensAt(220, Y), true, `x 220, ${JSON.stringify(title)}`)
		}
	})

	describe('AK4 LOD 2', () => {
		/** scale 0.08: a frame 5000 wide is 400 px on screen, its title is painted */
		const S = 0.08
		/** G spans x 0–5000 from y 2000 (screen y 160); its band above the top edge, its painted title 15 px high */
		const G = (title) => frameItem(F, { x: 0, y: 2000, w: 5000, h: 3000, data: { title } })
		/** screen y 2.4 px above G's top edge: in the model's title band (40 world + 4 px tolerance) */
		const ABOVE = (2000 - 30) * S
		/** A fresh scene with G at LOD 2, painted (paintStubCoarse); its title rectangles. */
		function coarse(title) {
			h?.restore()
			h = setupScene([G(title)])
			setStubLod(2)
			h.scene.setCamera({ x: 0, y: 0, scale: S })
			h.frame()
			return paintStubCoarse(h.model, S)
		}

		test('a frame with a title: the second click on the painted title opens the editor; one above the top edge right of F.x + max(rect + 8/s, 44/s) does not', () => {
			const rects = coarse('Retrospective')
			assert.equal(rects.length, 1, 'the title is painted')
			const r = rects[0]
			const zone = Math.max(r.w + TITLE_CLICK_PAD_PX / S, TITLE_CLICK_MIN_PX / S)
			// on the painted title, above the model's band (only coarseTitleAt hits there)
			const onTitle = [(r.w / 2) * S, (r.y + r.h / 3) * S]
			click(...onTitle)
			assert.deepEqual(h.scene.getSelection(), [F], 'the first click on the painted title selects')
			assert.equal(editing(), null)
			const beside = [(zone + 200) * S, ABOVE]
			click(...beside)
			assert.deepEqual(h.scene.getSelection(), [F], 'the click beside the zone hits G')
			assert.equal(editing(), null, 'beside the zone: no editor')
			click(...onTitle)
			assert.equal(editing(), F, 'the second click on the painted title opens it')
			assert.deepEqual(editingLog(), [F])
		})

		test('a frame without a title: no second click opens an editor', () => {
			assert.deepEqual(coarse(''), [], 'no title painted')
			select([F])
			for (const x of [20, 60, 120]) {
				click(x, ABOVE)
				assert.deepEqual(h.scene.getSelection(), [F], `screen x ${x} hits G`)
				assert.equal(editing(), null, `screen x ${x}`)
			}
			assert.deepEqual(editingLog(), [])
		})

		for (const title of ['Retrospective', '']) {
			test(`a double click above the top edge beside the text zone opens the editor (title ${JSON.stringify(title)}); onEditing once`, () => {
				coarse(title)
				const at = [300, ABOVE]
				click(...at)
				click(...at)
				assert.equal(editing(), null, 'the two clicks beside the text open nothing')
				h.pointer('dblclick', ...at)
				h.frame()
				assert.equal(editing(), F)
				assert.deepEqual(editingLog(), [F])
			})
		}
	})

	describe('AK5 the finger', () => {
		test('a tap in the text zone of the selected F ("Ideen") opens the editor and cancels its touchend', () => {
			selected(titled('Ideen'))
			tap(...TEXT)
			assert.equal(editing(), F)
			assert.equal(touchEnd().defaultPrevented, true)
		})

		test('(job 252) a tap at x 450 beside the tab opens nothing, keeps its touchend and hits the canvas', () => {
			selected(titled('Ideen'))
			tap(450, Y)
			assert.equal(editing(), null)
			assert.equal(touchEnd().defaultPrevented, false)
			// a finger's tap on empty canvas changes no selection (locks.test.mjs)
			assert.deepEqual(h.scene.getSelection(), [F])
			assert.deepEqual(h.intents(), [])
		})

		test('"A": a tap 40 px right of F.x opens the editor', () => {
			selected(titled('A'))
			tap(140, Y)
			assert.equal(editing(), F)
			assert.equal(touchEnd().defaultPrevented, true)
		})
	})

	test('AK6 (job 252) a double click at x 450 beside the tab of F opens no editor at LOD 0, F selected before or not; one on the tab does', () => {
		for (const before of [false, true]) {
			h?.restore()
			h = setupScene([titled('Ideen')])
			if (before) select([F])
			click(450, Y)
			click(450, Y)
			h.pointer('dblclick', 450, Y)
			h.frame()
			assert.equal(editing(), null, `selected before: ${before}`)
			assert.deepEqual(h.scene.getSelection(), [], 'beside the tab: canvas')
			assert.deepEqual(editingLog(), [])
		}
		h.restore()
		h = setupScene([titled('Ideen')])
		h.pointer('dblclick', ...TEXT)
		h.frame()
		assert.equal(editing(), F, 'a double click on the tab of the unselected F')
		assert.deepEqual(editingLog(), [F])
	})
})

describe('job 252: only the tab grabs the frame', () => {
	/** y of every press above F's top edge (the tab, 60–100) */
	const Y = 75
	const titled = (title, o = {}) => untitled({ data: { title }, ...o })
	const finger = { pointerType: 'touch', pointerId: 5 }

	test('a mouse drag from beside the tab of the selected F draws a marquee: it selects N, F stays in place, no move', () => {
		h = setupScene([titled('Ideen'), note(N, { x: 700, y: 100 })])
		select([F])
		h.pointer('pointerdown', 450, Y)
		h.pointer('pointermove', 600, 50)
		h.frame()
		h.pointer('pointermove', 950, 50)
		h.frame()
		h.pointer('pointermove', 950, 350)
		h.frame()
		h.pointer('pointerup', 950, 350)
		h.frame()
		assert.ok(h.scene.getSelection().includes(N), `the marquee selects N: ${h.scene.getSelection()}`)
		assert.deepEqual(h.intents().filter((i) => i.type === 'move'), [], 'F does not move')
		assert.equal(h.model.abs(F).x, 100)
		assert.equal(editing(), null)
	})

	test('a finger 10 px right of the tab ("Ideen", tab to x 183) selects F (12 px tolerance), 30 px right does not', () => {
		h = setupScene([titled('Ideen')])
		h.pointer('pointerdown', 193, Y, finger)
		h.pointer('pointerup', 193, Y, finger)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [F], '10 px right of the tab')
		h.restore()
		h = setupScene([titled('Ideen')])
		h.pointer('pointerdown', 213, Y, finger)
		h.pointer('pointerup', 213, Y, finger)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [], '30 px right of the tab')
	})

	test('an unselected F without a title shows no tab: a click above its top edge hits nothing; selected, its hint tab hits', () => {
		h = setupScene([untitled()])
		click(...BAND)
		assert.deepEqual(h.scene.getSelection(), [], 'nothing above F')
		select([F])
		assert.equal(hint(), F)
		click(...BAND)
		assert.deepEqual(h.scene.getSelection(), [F], 'the hint tab hits F')
		assert.equal(editing(), F, 'and opens the title as the second click')
	})

	test('review round 1: a double click 6 px above the top edge beside the tab (the edge band) opens no editor, at scale 1 and 0.5; on the tab it does', () => {
		for (const s of [1, 0.5]) {
			h?.restore()
			h = setupScene([titled('Ideen')])
			if (s !== 1) {
				h.scene.setCamera({ x: 0, y: 0, scale: s })
				h.frame()
			}
			// world (450, 94): beside the tab (to x 183), within the edge band (8 + 4 px)
			const at = [450 * s, 94 * s]
			click(...at)
			assert.deepEqual(h.scene.getSelection(), [F], `scale ${s}: the edge band selects F`)
			click(...at)
			h.pointer('dblclick', ...at)
			h.frame()
			assert.equal(editing(), null, `scale ${s}: no title editor beside the tab`)
			assert.deepEqual(editingLog(), [])
			h.pointer('dblclick', 150 * s, 94 * s)
			h.frame()
			assert.equal(editing(), F, `scale ${s}: a double click on the tab opens it`)
		}
	})

	test('two frames 16 apart: a click beside the lower one\'s tab hits the upper one\'s bottom edge, not the lower frame', () => {
		const UP = '01JA000000000000000000000U'
		h = setupScene([frameItem(UP, { x: 100, y: -244, w: 400, h: 300, data: { title: 'Oben' } }), titled('Ideen')])
		// the upper frame's bottom edge lies at y 56; the lower one's tab spans y 60–100
		click(400, 58)
		assert.deepEqual(h.scene.getSelection(), [UP], 'the upper frame\'s edge band')
		click(400, Y)
		assert.deepEqual(h.scene.getSelection(), [], 'beside the lower tab: canvas')
		click(150, Y)
		assert.deepEqual(h.scene.getSelection(), [F], 'the lower tab')
	})
})

describe('review round 1: the title band of a new frame comes into view below the top chrome', () => {
	/** What the view reports as covered at the top (TopBar, banners, room for the context bar), container px. */
	const TOP = 100
	const NEW = '01JA00000000000000000000N1'
	const E = TITLE_REVEAL_EDGE_PX

	/**
	 * A scene whose create intents run like BoardSession.createNow: the real
	 * createItem puts the item into the model, it is selected, a frame's title
	 * band comes into view (revealTitle with TOP), then its editor opens.
	 *
	 * @param {object[]} [items] items at the start
	 */
	function sceneWithCreate(items = []) {
		h = setupScene(items, {
			on: {
				onIntent(i) {
					if (i.type !== 'create') return
					const r = createItem(h.model, i, () => NEW)
					h.scene.update(h.model.apply({ upserts: [itemFromPut(r.ops[0])] }))
					h.scene.setSelection(r.selectIds)
					if (i.t === 'frame' || i.t === 'pad') h.scene.revealTitle(NEW, TOP)
					if (r.edit) h.scene.openTextEditor(NEW)
				},
			},
		})
	}

	/** @return {{x:number, y:number, w:number, h:number}} the open editor's rectangle, container px */
	function editorRect() {
		const ta = editorEl()
		assert.ok(ta, 'the editor is open')
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(ta.style.getPropertyValue('transform'))
		return { x: Number(m[1]), y: Number(m[2]), w: parseFloat(ta.style.getPropertyValue('width')), h: parseFloat(ta.style.getPropertyValue('height')) }
	}

	const userCameras = () => h.log.filter((e) => e[0] === 'onUserCamera').length

	test('a frame tool click in the upper part of the view: the band would lie above it; the camera moves down just enough, the editor lies in view under TOP', () => {
		sceneWithCreate()
		h.scene.setTool('frame')
		// the 800 × 600 frame is centred on (500, 250): its band at y −90 … −50 (job 243: 40 high), above the view
		click(500, 250)
		h.frame()
		assert.equal(editing(), NEW)
		const r = editorRect()
		// (job 243) the editor sits on the tab: FRAME_TAB_PAD in, as wide as the widest tab's text
		assert.deepEqual(r, { x: 100 + FRAME_TAB_PAD, y: TOP, w: 800 - FRAME_TAB_INSET - 2 * FRAME_TAB_PAD, h: FRAME_TITLE_BAND }, 'the band right under TOP, x unchanged')
		assert.ok(r.y >= TOP && r.y + r.h <= 800 - E && r.x >= E, 'in view')
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: -(TOP + 50 + FRAME_TITLE_BAND), scale: 1 }, 'moved down by 186 px, zoom kept')
		assert.equal(userCameras(), 1, 'a user camera change (onUserCamera), like panIntoView')
	})

	test('at 50 %: the same rule in screen px', () => {
		sceneWithCreate()
		h.scene.setCamera({ x: 0, y: 0, scale: 0.5 })
		h.frame()
		h.scene.setTool('frame')
		// world (1000, 400): the frame at y 100 … 700, its band at world y 58 → screen 29 < TOP
		click(500, 200)
		h.frame()
		const r = editorRect()
		assert.ok(Math.abs(r.y - TOP) < 0.01, String(r.y))
		assert.ok(Math.abs(r.h - FRAME_TITLE_BAND / 2) < 0.01)
		assert.equal(h.scene.getCamera().scale, 0.5)
	})

	test('a click near the left edge: the band\'s left edge, where the title starts, comes into view; a band in place moves nothing', () => {
		sceneWithCreate()
		h.scene.setTool('frame')
		// centred on (100, 600): x −300 … 500, its band at y 260 … 300 (in view)
		click(100, 600)
		h.frame()
		const r = editorRect()
		assert.equal(r.x, E + FRAME_TAB_PAD, 'the left edge E px inside (job 243: the editor FRAME_TAB_PAD further in the tab)')
		assert.equal(r.y, 300 - FRAME_TITLE_BAND, 'no vertical move')
		assert.equal(userCameras(), 1)
		h.restore()
		sceneWithCreate()
		h.scene.setTool('frame')
		click(500, 600)
		h.frame()
		assert.deepEqual(editorRect(), { x: 100 + FRAME_TAB_PAD, y: 300 - FRAME_TITLE_BAND, w: 800 - FRAME_TAB_INSET - 2 * FRAME_TAB_PAD, h: FRAME_TITLE_BAND })
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'band in place: no camera move')
		assert.equal(userCameras(), 0)
	})

	test('revealTitle: a band below the view comes up to E px above the bottom edge; a note or an unknown id moves nothing', () => {
		h = setupScene([frameItem(F, { x: 100, y: 900, w: 400, h: 300 }), note(N, { x: 0, y: -900 })])
		assert.equal(h.scene.revealTitle(F, TOP), true)
		h.frame()
		const c = h.scene.getCamera()
		assert.equal((900 - c.y) * c.scale, 800 - E, 'the band\'s bottom E px above the bottom edge')
		assert.equal(h.scene.revealTitle(F, TOP), false, 'in place now')
		assert.equal(h.scene.revealTitle(N, TOP), false, 'a note has no title band')
		assert.equal(h.scene.revealTitle('01JA00000000000000000000XX', TOP), false)
		assert.deepEqual(h.scene.getCamera(), c)
	})

	/** (job 193) A note pad; job 263: its title band is the binding on top of the box, 36 high, as wide as the box. */
	const pad = (id, o = {}) => ({ id, t: 'pad', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a5', parent: null, data: { title: '' }, style: { fill: '#a8d8f8' }, ...o })

	test('job 193: a note tool click with the type pad near the bottom edge: the band would lie below the view; the camera moves up just enough, the padTitle editor lies in view', () => {
		sceneWithCreate()
		h.scene.setTool('sticky', { type: 'pad' })
		// the 200 × 200 pad is centred on (500, 860): box y 760 … 960, its binding y 760 … 796, under the edge (800 − E = 792)
		click(500, 860)
		h.frame()
		assert.equal(editing(), NEW)
		assert.equal(h.model.get(NEW).t, 'pad')
		assert.equal(editorEl()?.getAttribute('data-knorke-editor-kind'), 'padTitle')
		const r = editorRect()
		assert.deepEqual(r, { x: 412, y: 800 - E - 36, w: 176, h: 36 }, 'the binding\'s bottom E px above the bottom edge, x unchanged (the title 12 inside)')
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 796 - (800 - E), scale: 1 }, 'moved up by 4 px, zoom kept')
		assert.equal(userCameras(), 1, 'a user camera change (onUserCamera)')
		assert.equal(h.scene.stats().tool, 'select', 'the tool is back on select, the editor stays open')
		assert.deepEqual(h.scene.getToolOptions('sticky'), { type: 'sticky' }, 'the type is Note again')
	})

	test('job 193: revealTitle on a pad left of the view brings the band\'s left edge E px inside; a pad whose band is in view moves nothing', () => {
		const Q = '01JA00000000000000000000Q1'
		h = setupScene([pad(F, { x: -300, y: 100 }), pad(Q, { x: 400, y: 100 })])
		assert.equal(h.scene.revealTitle(Q, TOP), false, 'binding y 100 … 136, in view')
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		assert.equal(userCameras(), 0)
		assert.equal(h.scene.revealTitle(F, TOP), true)
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: -300 - E, y: 0, scale: 1 }, 'only x moves')
		assert.equal(h.scene.revealTitle(F, TOP), false, 'in place now')
	})

	test('job 193 review round 1: with bottom (the bars at the bottom) the band\'s bottom stays bottom + E px above the bottom edge; at 50 % too; bottom not finite or below 0 counts as 0; the top still wins', () => {
		const BOTTOM = 60
		// binding y 700 … 736: clear of E, under the bars (800 − 60 − E = 732)
		h = setupScene([pad(F, { x: 400, y: 700 })])
		assert.equal(h.scene.revealTitle(F, TOP), false, 'without bottom: in place')
		assert.equal(h.scene.revealTitle(F, TOP, BOTTOM), true)
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 736 - (800 - BOTTOM - E), scale: 1 }, 'up by 4 px, the binding\'s bottom at 732')
		assert.equal(h.scene.revealTitle(F, TOP, BOTTOM), false, 'in place now')
		h.restore()
		for (const bad of [NaN, -5, Infinity]) {
			h = setupScene([pad(F, { x: 400, y: 780 })])
			// binding y 780 … 816: below the view's edge
			assert.equal(h.scene.revealTitle(F, TOP, bad), true, String(bad))
			h.frame()
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 816 - (800 - E), scale: 1 }, String(bad))
			h.restore()
		}
		// 50 %: the same rule in screen px; binding y 780 … 816 at screen 390 … 408 lies in view
		h = setupScene([pad(F, { x: 400, y: 780 })])
		h.scene.setCamera({ x: 0, y: 0, scale: 0.5 })
		h.frame()
		assert.equal(h.scene.revealTitle(F, TOP, BOTTOM), false)
		// camera y −900: screen binding 840 … 858, below 800; it comes up to 800 − 60 − 8 = 732
		h.scene.setCamera({ x: 0, y: -900, scale: 0.5 })
		h.frame()
		assert.equal(h.scene.revealTitle(F, TOP, BOTTOM), true)
		h.frame()
		const c = h.scene.getCamera()
		assert.equal((816 - c.y) * c.scale, 800 - BOTTOM - E)
		assert.equal(c.scale, 0.5)
		h.restore()
		// a view too short for both: the top wins
		h = setupScene([pad(F, { x: 400, y: 600 })])
		assert.equal(h.scene.revealTitle(F, 700, 200), true)
		h.frame()
		assert.equal((600 - h.scene.getCamera().y), 700, 'the binding\'s top at TOP')
	})
})

describe('job 243 AK7: the title editor sits on the tab', () => {
	/** @return {{x:number, y:number, w:number, h:number, color:string, size:number}} the open editor, container px */
	function editorBox() {
		const ta = editorEl()
		assert.ok(ta, 'the editor is open')
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(ta.style.getPropertyValue('transform'))
		return {
			x: Number(m[1]), y: Number(m[2]), w: parseFloat(ta.style.getPropertyValue('width')), h: parseFloat(ta.style.getPropertyValue('height')),
			color: ta.style.getPropertyValue('color'), size: parseFloat(ta.style.getPropertyValue('font-size')),
		}
	}

	for (const [fill, color] of [['#ffffff', FRAME_TITLE_COLOR], ['#191b1d', '#ffffff'], ['#404040', '#ffffff'], ['#faea89', FRAME_TITLE_COLOR]]) {
		test(`a frame filled ${fill}: x = edge + 14, y = −40, w − 24 − 28 wide, 22 px, the tab's text colour ${color}`, () => {
			h = setupScene([untitled({ data: { title: 'Ideen' }, style: { fill } })])
			h.scene.openTextEditor(F)
			h.frame()
			assert.equal(editing(), F)
			assert.deepEqual(editorBox(), { x: 100 + FRAME_TAB_PAD, y: 100 - FRAME_TITLE_BAND, w: 400 - FRAME_TAB_INSET - 2 * FRAME_TAB_PAD, h: FRAME_TITLE_BAND, color, size: FRAME_TITLE_SIZE })
		})
	}

	test('at 50 %: the same rule in screen px', () => {
		h = setupScene([untitled({ data: { title: 'Ideen' } })])
		h.scene.setCamera({ x: 0, y: 0, scale: 0.5 })
		h.frame()
		h.scene.openTextEditor(F)
		h.frame()
		const b = editorBox()
		assert.deepEqual([b.x, b.y, b.w, b.h, b.size], [(100 + FRAME_TAB_PAD) / 2, (100 - FRAME_TITLE_BAND) / 2, (400 - FRAME_TAB_INSET - 2 * FRAME_TAB_PAD) / 2, FRAME_TITLE_BAND / 2, FRAME_TITLE_SIZE / 2])
	})
})
