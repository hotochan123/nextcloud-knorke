/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 267 (AK1): "Summarise" and "Cluster by topic" in the context
 * bar, a group of their own after the collaboration group, only while
 * selection v2 ai offers them; ContextBar.vue renders and emits them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { barGroups, contextSections } from '../../../src/components/contextbar.js'

const sel = (ai, o = {}) => ({ count: 2, types: new Set(['sticky']), fields: [], unlocked: 2, commentable: false, taggable: 2, ai, ...o })

test('the AI group shows exactly what selection v2 ai offers', () => {
	assert.deepEqual(barGroups(sel({ summarise: true, cluster: true })).find((g) => g.includes('ai-summarise')), ['ai-summarise', 'ai-cluster'])
	assert.deepEqual(barGroups(sel({ summarise: true, cluster: false })).find((g) => g.includes('ai-summarise')), ['ai-summarise'])
	for (const ai of [{ summarise: false, cluster: false }, undefined, null]) {
		assert.ok(!barGroups(sel(ai)).flat().some((x) => x.startsWith('ai-')), JSON.stringify(ai))
	}
	const groups = barGroups(sel({ summarise: true, cluster: true }))
	assert.ok(groups.findIndex((g) => g.includes('tags')) < groups.findIndex((g) => g.includes('ai-summarise')), 'after the collaboration group')
	assert.deepEqual([contextSections(sel({ cluster: true })).aiSummarise, contextSections(sel({ cluster: true })).aiCluster], [false, true])
})

test('ContextBar.vue renders both buttons with their hooks and emits', () => {
	const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(src, /data-knorke-action="ai-summarise"\n\t+@click="\(e\) => \$emit\('ai-summarise', e\)"/)
	assert.match(src, /data-knorke-action="ai-cluster"\n\t+@click="\(e\) => \$emit\('ai-cluster', e\)"/)
	assert.match(src, /'ai-summarise', 'ai-cluster'[\],]/)
})
