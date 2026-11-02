/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 273 AK7, the pen in the shell: the tool bar has the pen (P)
 * after Text; its variants show the kind, then for the pen and the
 * highlighter the three widths and the colours of that kind (swatches with
 * their name), the eraser only the kind; the context bar of strokes offers
 * their kind's colours and widths as a line, never shape kinds or Arrange.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextSections } from '../../../src/components/contextbar.js'
import { TOOL_GROUPS } from '../../../src/components/toolbar.js'
import { PEN_COLORS, PEN_WIDTHS } from '../../../src/model/ink.js'
import { TYPES } from '../../../src/model/registry.js'
import { STRONG } from '../../../src/model/tokens.js'
import { useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ToolVariants = (await import('../../../src/components/ToolVariants.vue')).default
const render = async (props) => (await renderToString(createSSRApp(ToolVariants, props))).replace(/<!--[^>]*-->/g, '')

/** @return {Array<[string, string, string]>} [group, value, aria-pressed] of every tile */
const tiles = (html) => [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*data-knorke-tool-option="([^"]*)"[^>]*data-knorke-tool-group="([^"]*)"/g)].map((m) => [m[3], m[2], m[1]])

test('job 273 AK7: the pen stands after Text in the bar', () => {
	const g = TOOL_GROUPS[1]
	assert.equal(g.indexOf('pen'), g.indexOf('text') + 1)
})

test('job 273 AK7: pen variants – kind, the pen\'s three widths and its colours, the current ones pressed', async () => {
	const html = await render({ tool: 'pen', value: { penKind: 'pen', penColor: '#191b1d', penWidth: 4, markerColor: '#faea89', markerWidth: 20 } })
	assert.match(html, /data-knorke-tool-variants="pen"/)
	const t = tiles(html)
	assert.deepEqual(t.filter((x) => x[0] === 'penKind').map((x) => x[1]), ['pen', 'marker', 'eraser'])
	assert.deepEqual(t.filter((x) => x[0] === 'penWidth').map((x) => Number(x[1])), [...PEN_WIDTHS.pen])
	assert.deepEqual(t.filter((x) => x[0] === 'penColor').map((x) => x[1]), [...PEN_COLORS.pen])
	assert.deepEqual(t.filter((x) => x[2] === 'true').map((x) => x[1]), ['pen', '4', '#191b1d'])
	assert.match(html, /aria-label="Black"[^>]*title="Black"/, 'a swatch carries its name')
	assert.match(html, /knorke-toolpop__swatch" style="background:#c43e45;?"/)
})

test('job 273 AK7: the highlighter shows its own widths and colours; the eraser only the kind', async () => {
	const m = tiles(await render({ tool: 'pen', value: { penKind: 'marker', markerColor: '#faea89', markerWidth: 32 } }))
	assert.deepEqual(m.filter((x) => x[0] === 'markerWidth').map((x) => Number(x[1])), [...PEN_WIDTHS.marker])
	assert.deepEqual(m.filter((x) => x[0] === 'markerColor').map((x) => x[1]), [...PEN_COLORS.marker])
	assert.deepEqual(m.filter((x) => x[2] === 'true').map((x) => x[1]), ['marker', '32', '#faea89'])
	const e = tiles(await render({ tool: 'pen', value: { penKind: 'eraser' } }))
	assert.deepEqual(e.map((x) => x[0]), ['penKind', 'penKind', 'penKind'])
})

/** Selection v2 of the given types with their common typed fields. */
function sel(types, extra = {}) {
	let fields = null
	for (const t of new Set(types)) {
		const own = Object.keys(TYPES[t]?.fields ?? {})
		fields = fields === null ? own : fields.filter((p) => own.includes(p))
	}
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], box: { x: 0, y: 0, w: 1, h: 1, r: 0 }, ...extra }
}

test('job 273 AK7: the context bar of strokes – the kind\'s colours and widths as a line; no shape kinds, no Arrange', () => {
	const pen = contextSections(sel(['pen'], { kind: 'pen' }))
	assert.deepEqual([pen.stroke, pen.strokeWidths, pen.strokeWidth, pen.ink], [[...PEN_COLORS.pen], [...PEN_WIDTHS.pen], true, true])
	assert.deepEqual([pen.kind, pen.arrange, pen.fill, pen.dash], [null, false, null, null])
	const marker = contextSections(sel(['pen', 'pen'], { kind: 'marker' }))
	assert.deepEqual([marker.stroke, marker.strokeWidths], [[...PEN_COLORS.marker], [...PEN_WIDTHS.marker]])
	const both = contextSections(sel(['pen', 'pen'], { mixed: ['data.kind'] }))
	assert.deepEqual([both.stroke, both.strokeWidths], [[...STRONG], [...PEN_WIDTHS.pen, ...PEN_WIDTHS.marker]])
	const mix = contextSections(sel(['pen', 'shape'], { kind: 'rect' }))
	assert.equal(mix.kind, null, 'a shape with a stroke: no shape kinds')
	assert.equal(mix.ink, false)
})
