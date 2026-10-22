/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Helper for the context-bar tests that read the SSR render of ContextBar.vue
 * (contextbarAlign, contextbarDistribute, contextbarTidy): the open panel
 * element alone. The panel stands between the panel toggles and "Copy"
 * (SPEC-M1 §6.6), so a slice "from the panel to the end" would also see the
 * bar buttons after it.
 */
import assert from 'node:assert/strict'

/**
 * @param {string} html rendered bar
 * @return {string} the open panel element alone (from its start tag to its own closing tag)
 */
export function panelOf(html) {
	const start = html.indexOf('<div id="knorke-contextbar-panel"')
	assert.ok(start >= 0, 'an open panel')
	const tags = /<(\/?)div\b[^>]*>/g
	tags.lastIndex = start
	let depth = 0
	for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
		depth += m[1] === '/' ? -1 : 1
		if (depth === 0) return html.slice(start, tags.lastIndex)
	}
	throw new Error('the panel is not closed')
}
