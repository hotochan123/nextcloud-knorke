/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 180 (AK1, AK7): the templates of board/templates.js.
 * - every set: exactly the frames of the spec (count, order, titles, sizes,
 *   80 units between them, the default fill), each with exactly one child
 *   note (question, colour, (40, 40), 200 × 200; job 227: text size M and a
 *   light tone of the one palette)
 * - every set passes validatePayload (ok, nothing skipped) unchanged
 * - the texts in German (l10n/de.json registered): names, sentences,
 *   titles and questions of the spec's table, plus the three texts of the
 *   dialog, the menu and the button
 * - the sketch: the frame rectangles to scale inside the box, one colour
 *   square per note
 * - pasted with actions.pasteItems: 2 × frames puts, the notes children of
 *   the new frames, the frames the only roots
 * - (job 188 AK7) every frame also holds one note pad at (260, 40), 200 × 200,
 *   in the colour of its guiding question, without a title; the sketch has
 *   one square per pad (pads)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register, unregister } from '@nextcloud/l10n'
import { pasteItems } from '../../../src/board/actions.js'
import { validatePayload } from '../../../src/board/clipboard.js'
import { TEMPLATE_GAP, TEMPLATE_KEYS, templateOf, templatePayload, templateSketch } from '../../../src/board/templates.js'
import { ULID_RE } from '../../../src/model/ids.js'
import { FRAME_FILL, LIGHT } from '../../../src/model/tokens.js'
import { FakeModel } from './fakes.mjs'

/** The spec's table (Verhalten 6 and 7): per template the frames [title, question, fill, x, y, w, h], in order. */
const SPEC = Object.freeze({
	retro: {
		name: 'Retrospective',
		text: 'Look back as a team: what should we start, stop and continue?',
		frames: [
			['Start doing', 'What should we start doing?', '#b3e8b3', 0, 0, 640, 880],
			['Stop doing', 'What should we stop doing?', '#ffaaa7', 720, 0, 640, 880],
			['Continue doing', 'What should we keep doing?', '#a2d9fe', 1440, 0, 640, 880],
		],
	},
	swot: {
		name: 'SWOT analysis',
		text: 'Strengths, weaknesses, opportunities and threats in four fields.',
		frames: [
			['Strengths', 'What do we do well?', '#b3e8b3', 0, 0, 800, 560],
			['Weaknesses', 'Where are we weak?', '#febf87', 880, 0, 800, 560],
			['Opportunities', 'What could help us?', '#a2d9fe', 0, 640, 800, 560],
			['Threats', 'What could get in our way?', '#ffaaa7', 880, 640, 800, 560],
		],
	},
	kanban: {
		name: 'Kanban',
		text: 'Move tasks from to do via doing to done.',
		frames: [
			['To do', 'What is waiting to be started?', '#faea89', 0, 0, 560, 1200],
			['Doing', 'What are we working on right now?', '#febf87', 640, 0, 560, 1200],
			['Done', 'What is finished?', '#b3e8b3', 1280, 0, 560, 1200],
		],
	},
	brainstorm: {
		name: 'Brainstorming',
		text: 'Collect ideas freely; side topics go to the parking lot.',
		frames: [
			['Ideas', 'Which ideas come to mind? One idea per note.', '#faea89', 0, 0, 1280, 880],
			['Parking lot', 'What is important but off topic right now?', '#e0e0dd', 1360, 0, 480, 480],
		],
	},
})

/** The German texts of the spec's table, English → German. */
const DE = Object.freeze({
	'Insert template…': 'Vorlage einfügen …',
	'Insert template': 'Vorlage einfügen',
	'Start with a template': 'Mit einer Vorlage beginnen',
	Retrospective: 'Retrospektive',
	'Look back as a team: what should we start, stop and continue?': 'Gemeinsam zurückblicken: Was sollten wir beginnen, lassen und beibehalten?',
	'Start doing': 'Beginnen',
	'Stop doing': 'Aufhören',
	'Continue doing': 'Weitermachen',
	'What should we start doing?': 'Was sollten wir neu beginnen?',
	'What should we stop doing?': 'Womit sollten wir aufhören?',
	'What should we keep doing?': 'Was sollten wir beibehalten?',
	'SWOT analysis': 'SWOT-Analyse',
	'Strengths, weaknesses, opportunities and threats in four fields.': 'Stärken, Schwächen, Chancen und Risiken in vier Feldern.',
	Strengths: 'Stärken',
	Weaknesses: 'Schwächen',
	Opportunities: 'Chancen',
	Threats: 'Risiken',
	'What do we do well?': 'Was können wir gut?',
	'Where are we weak?': 'Wo sind wir schwach?',
	'What could help us?': 'Was könnte uns helfen?',
	'What could get in our way?': 'Was könnte uns im Weg stehen?',
	Kanban: 'Kanban',
	'Move tasks from to do via doing to done.': 'Aufgaben von „Zu erledigen“ über „In Arbeit“ nach „Erledigt“ schieben.',
	'To do': 'Zu erledigen',
	Doing: 'In Arbeit',
	Done: 'Erledigt',
	'What is waiting to be started?': 'Was wartet darauf, begonnen zu werden?',
	'What are we working on right now?': 'Woran arbeiten wir gerade?',
	'What is finished?': 'Was ist fertig?',
	Brainstorming: 'Brainstorming',
	'Collect ideas freely; side topics go to the parking lot.': 'Ideen frei sammeln; Nebenthemen kommen auf den Parkplatz.',
	Ideas: 'Ideen',
	'Parking lot': 'Parkplatz',
	'Which ideas come to mind? One idea per note.': 'Welche Ideen fallen dir ein? Eine Idee pro Notiz.',
	'What is important but off topic right now?': 'Was ist wichtig, gehört aber gerade nicht zum Thema?',
})

test('AK1 the four templates in dialog order; an unknown key gives nothing', () => {
	assert.deepEqual(TEMPLATE_KEYS, ['retro', 'swot', 'kanban', 'brainstorm'])
	assert.equal(TEMPLATE_GAP, 80)
	for (const bad of ['', 'Retro', 'own', null, undefined, '__proto__']) {
		assert.equal(templateOf(bad), null, String(bad))
		assert.equal(templatePayload(bad), null, String(bad))
		assert.equal(templateSketch(bad), null, String(bad))
	}
})

for (const key of TEMPLATE_KEYS) {
	test(`AK1 ${key}: exactly the frames of the spec (order, titles, sizes, gaps), each with one note (question, colour, (40, 40), 200 × 200); validatePayload ok, 0 skipped`, () => {
		const want = SPEC[key]
		const def = templateOf(key)
		assert.equal(def.name, want.name)
		assert.equal(def.text, want.text)
		const p = templatePayload(key)
		assert.equal(p.knorke, 1)
		assert.equal(p.board, null)
		const frames = p.items.filter((it) => it.t === 'frame')
		const notes = p.items.filter((it) => it.t === 'sticky')
		const pads = p.items.filter((it) => it.t === 'pad')
		assert.equal(p.items.length, 3 * want.frames.length, 'frames, notes and (job 188) pads only')
		assert.equal(frames.length, want.frames.length)
		assert.deepEqual(frames.map((f) => [f.data.title, f.x, f.y, f.w, f.h]), want.frames.map(([title, , , x, y, w, h]) => [title, x, y, w, h]))
		for (const f of frames) {
			assert.equal(f.parent, null, 'frames are the roots')
			assert.equal(f.r, 0)
			assert.deepEqual(f.style, { fill: FRAME_FILL }, 'the default fill (white)')
			assert.deepEqual(Object.keys(f.data), ['title'])
		}
		// 80 units between neighbours (horizontally and vertically), no overlap
		for (const a of frames) {
			for (const b of frames) {
				if (a === b) continue
				const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
				const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
				assert.ok(Math.max(gapX, gapY) >= TEMPLATE_GAP, `${a.data.title} / ${b.data.title} do not overlap and keep the gap`)
			}
		}
		want.frames.forEach(([title, question, fill], i) => {
			const kids = notes.filter((n) => n.parent === frames[i].id)
			assert.equal(kids.length, 1, title + ': exactly one note')
			const n = kids[0]
			assert.deepEqual([n.x, n.y, n.w, n.h, n.r], [40, 40, 200, 200, 0], title + ': place and size')
			assert.deepEqual(n.data, { text: question }, title + ': the question')
			assert.deepEqual(n.style, { fill, fontSize: 22 }, title + ': the colour, (job 227) text size M')
			assert.ok(LIGHT.includes(fill), 'job 227: a light tone of the one palette')
			// job 188 AK7: one pad beside the note, in the question's colour, without a title
			const pk = pads.filter((x) => x.parent === frames[i].id)
			assert.equal(pk.length, 1, title + ': exactly one pad')
			assert.deepEqual([pk[0].x, pk[0].y, pk[0].w, pk[0].h, pk[0].r], [260, 40, 200, 200, 0], title + ': the pad\'s place and size')
			assert.deepEqual(pk[0].data, { title: '' }, title + ': no title')
			assert.deepEqual(pk[0].style, { fill }, title + ': the colour of the guiding question')
		})
		// placeholder ids in ULID form, unique
		assert.ok(p.items.every((it) => ULID_RE.test(it.id)))
		assert.equal(new Set(p.items.map((it) => it.id)).size, p.items.length)
		const v = validatePayload(p)
		assert.equal(v.ok, true)
		assert.equal(v.skipped, 0)
		assert.deepEqual(v.payload.items, p.items, 'already in the checked form')
	})
}

test('AK1 the frames of each template: the first at (0, 0), side by side 80 apart (swot: a 2 × 2 grid, Strengths and Weaknesses on top; brainstorm: the parking lot top-aligned right of the ideas)', () => {
	const box = (key) => templatePayload(key).items.filter((it) => it.t === 'frame').map((f) => [f.x, f.y])
	assert.deepEqual(box('retro'), [[0, 0], [720, 0], [1440, 0]])
	assert.deepEqual(box('swot'), [[0, 0], [880, 0], [0, 640], [880, 640]])
	assert.deepEqual(box('kanban'), [[0, 0], [640, 0], [1280, 0]])
	assert.deepEqual(box('brainstorm'), [[0, 0], [1360, 0]])
})

test('AK7 the texts in German: every name, sentence, title and question of the spec\'s table, and the dialog\'s, menu\'s and button\'s texts', () => {
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	for (const [en, want] of Object.entries(DE)) {
		assert.equal(de[en], want, en)
	}
	register('knorke', de)
	try {
		for (const key of TEMPLATE_KEYS) {
			const def = templateOf(key)
			assert.equal(def.name, DE[SPEC[key].name])
			assert.equal(def.text, DE[SPEC[key].text])
			const items = templatePayload(key).items
			assert.deepEqual(items.filter((it) => it.t === 'frame').map((f) => f.data.title), SPEC[key].frames.map(([title]) => DE[title]))
			assert.deepEqual(items.filter((it) => it.t === 'sticky').map((n) => n.data.text), SPEC[key].frames.map(([, question]) => DE[question]))
			assert.equal(validatePayload(templatePayload(key)).skipped, 0, key + ' in German')
		}
	} finally {
		unregister('knorke')
	}
})

test('AK1 the sketch: the frames to scale inside the box (pad 4), centred; one colour square per note at its place', () => {
	for (const key of TEMPLATE_KEYS) {
		const sk = templateSketch(key)
		const frames = templatePayload(key).items.filter((it) => it.t === 'frame')
		assert.equal(sk.w, 120)
		assert.equal(sk.h, 80)
		assert.equal(sk.frames.length, frames.length)
		assert.equal(sk.notes.length, frames.length)
		assert.equal(sk.pads.length, frames.length, 'job 188: one square per pad')
		const s = sk.frames[0].w / frames[0].w
		frames.forEach((f, i) => {
			const r = sk.frames[i]
			assert.ok(Math.abs(r.w - f.w * s) < 0.02 && Math.abs(r.h - f.h * s) < 0.02, key + ': to scale')
			assert.ok(Math.abs((r.x - sk.frames[0].x) - (f.x - frames[0].x) * s) < 0.02, key + ': x to scale')
			assert.ok(Math.abs((r.y - sk.frames[0].y) - (f.y - frames[0].y) * s) < 0.02, key + ': y to scale')
			assert.ok(r.x >= 3.99 && r.y >= 3.99 && r.x + r.w <= 116.01 && r.y + r.h <= 76.01, key + ': inside the box')
			const n = sk.notes[i]
			assert.ok(Math.abs(n.x - (r.x + 40 * s)) < 0.02 && Math.abs(n.y - (r.y + 40 * s)) < 0.02 && Math.abs(n.size - 200 * s) < 0.02, key + ': the note square')
			assert.equal(n.fill, SPEC[key].frames[i][2])
			const pd = sk.pads[i]
			assert.ok(Math.abs(pd.x - (r.x + 260 * s)) < 0.02 && Math.abs(pd.y - (r.y + 40 * s)) < 0.02 && Math.abs(pd.size - 200 * s) < 0.02, key + ': the pad square')
			assert.equal(pd.fill, SPEC[key].frames[i][2])
		})
		const minX = Math.min(...sk.frames.map((r) => r.x))
		const maxX = Math.max(...sk.frames.map((r) => r.x + r.w))
		const minY = Math.min(...sk.frames.map((r) => r.y))
		const maxY = Math.max(...sk.frames.map((r) => r.y + r.h))
		assert.ok(Math.abs(minX - (120 - maxX)) < 0.02 && Math.abs(minY - (80 - maxY)) < 0.02, key + ': centred')
		assert.ok(Math.abs(minX - 4) < 0.02 || Math.abs(minY - 4) < 0.02, key + ': fills the box on one axis')
	}
	assert.deepEqual(templateSketch('kanban', { w: 60, h: 40, pad: 2 }).frames[0], { x: 2.4, y: 2, w: 16.8, h: 36 }, 'another box')
})

test('AK1 pasted with actions.pasteItems: one put per item, the notes children of the new frames, the frames the only roots, centred at `at`', () => {
	const model = new FakeModel([])
	let n = 0
	const r = pasteItems(model, templatePayload('swot'), { at: { x: 1000, y: 500 }, limits: null, board: 7 }, () => '01JB' + String(++n).padStart(22, '0'))
	assert.equal(r.full, false)
	assert.equal(r.ops.length, 12, 'job 188: 4 frames, 4 notes, 4 pads')
	assert.ok(r.ops.every((op) => op.o === 'put'))
	const frames = r.ops.filter((op) => op.t === 'frame')
	assert.deepEqual(r.selectIds, frames.map((op) => op.id))
	for (const op of r.ops.filter((x) => x.t === 'sticky')) {
		assert.ok(frames.some((f) => f.id === op.p.parent), 'child of a new frame')
		assert.deepEqual([op.p.x, op.p.y], [40, 40])
	}
	for (const op of r.ops.filter((x) => x.t === 'pad')) {
		assert.ok(frames.some((f) => f.id === op.p.parent), 'job 188: a pad is a child of a new frame')
		assert.deepEqual([op.p.x, op.p.y], [260, 40])
	}
	const x0 = Math.min(...frames.map((f) => f.p.x))
	const x1 = Math.max(...frames.map((f) => f.p.x + f.p.w))
	const y0 = Math.min(...frames.map((f) => f.p.y))
	const y1 = Math.max(...frames.map((f) => f.p.y + f.p.h))
	assert.deepEqual([(x0 + x1) / 2, (y0 + y1) / 2], [1000, 500])
})
