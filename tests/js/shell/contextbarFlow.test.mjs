/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The BPMN flows in the shell (factory job 204, AK4/AK5): the row "BPMN"
 * of the panel "Tips" (rendered with @vue/server-renderer) above the tip
 * rows, connectors only, with "Sequence flow" and "Message flow", named and
 * pressed for the look of the selection; the seven tips with the two new
 * icons; the view sends flow to session.setFlow.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { icons } from '../../../src/components/icons.js'
import { TYPES } from '../../../src/model/registry.js'
import { panelOf } from './contextbarHtml.mjs'
import { useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default

const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

/**
 * @param {string[]} types selected types
 * @param {object} [extra] selection keys
 * @return {object} selection v2 like BoardSession.selectionInfo
 */
function sel(types, extra = {}) {
	let fields = null
	for (const t of new Set(types)) {
		const own = Object.keys(TYPES[t]?.fields ?? {})
		fields = fields === null ? own : fields.filter((p) => own.includes(p))
	}
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], canConnect: false, box: null, ...extra }
}

/** ContextBar whose panel is "Tips" from the start. */
const WithCapsPanel = {
	...ContextBar,
	setup(props, ctx) {
		const b = ContextBar.setup(props, ctx)
		b.toggle('caps')
		return b
	},
}

/** @return {Promise<string>} the open panel "Tips" */
async function capsPanel(selection) {
	return panelOf(strip(await renderToString(createSSRApp(WithCapsPanel, { selection }))))
}

test('job 204: the row "BPMN" stands above the tip rows; both buttons named, the message flow pressed for its look', async () => {
	const panel = await capsPanel(sel(['connector', 'connector'], { dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' }))
	const row = panel.indexOf('data-knorke-section="flow"')
	assert.ok(row > 0 && row < panel.indexOf('data-knorke-style="style.startCap"'), 'above the tips')
	const tag = (flow) => panel.match(new RegExp(`<div[^>]*data-knorke-action="flow-${flow}"[^>]*>`))?.[0] ?? ''
	assert.match(tag('sequence'), /aria-label="Sequence flow"/)
	assert.match(tag('message'), /aria-label="Message flow"/)
	assert.match(tag('message'), /pressed="true"/)
	assert.doesNotMatch(tag('sequence'), /pressed="true"/)
	assert.match(panel, /Sequence flow[\s\S]*Message flow/, 'visible text')
	const seq = await capsPanel(sel(['connector'], { dash: 'solid', startCap: 'none', endCap: 'triangle' }))
	assert.match(seq.match(/<div[^>]*data-knorke-action="flow-sequence"[^>]*>/)[0], /pressed="true"/)
})

test('job 204: the seven tips with their icons; the view sends flow and the pool entry on', async () => {
	const panel = await capsPanel(sel(['connector']))
	for (const cap of ['circleOpen', 'triangleOpen']) {
		assert.match(panel, new RegExp(`data-knorke-style="style.endCap"[^>]*data-knorke-value="${cap}"|data-knorke-value="${cap}"[^>]*data-knorke-style="style.endCap"`), cap)
	}
	assert.ok(panel.includes(icons.capCircleOpen) && panel.includes(icons.capTriangleOpen))
	assert.match(panel, /aria-label="Open circle"/)
	assert.match(panel, /aria-label="Open triangle"/)
	const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(view, /@flow="\(f, e\) => act\(e, \(s\) => s\.setFlow\(f\)\)"/)
	assert.match(view, /if \(kind === POOL_KIND\) s\.placeLanes\(screen\)/, 'the pool entry of the shapes panel')
	assert.match(view, /setToolOptions\('frame', \{ frameKind: 'lanes' \}\)/)
})
