/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 277: every AI marking of the bars in the one AI violet
 * (--k-ai = model/tokens.js AI_VIOLET, lighter in dark mode b), WCAG AA for
 * the small label "AI" on the bar and its hover; "Create with AI" shows the
 * sparkle with the label below it, "Summarise" and "Cluster by topic" only
 * violet icons.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AI_VIOLET } from '../../../src/model/tokens.js'

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')

/** @return {Array<{selector: string, body: string}>} flat rule list (nested @media bodies included) */
function rules() {
	const out = []
	const re = /([^{}]+)\{([^{}]*)\}/g
	let m
	while ((m = re.exec(css)) !== null) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
	return out
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a, b) {
	const lum = (h) => {
		const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
			.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
	return (x + 0.05) / (y + 0.05)
}

const varIn = (body, name) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(body)?.[1]

const rootAi = varIn(rules().find((r) => r.selector === ':root' && /--k-ai:/.test(r.body))?.body ?? '', '--k-ai')
const darkRule = rules().find((r) => r.selector.startsWith("[data-knorke-dark='b'] :is(") && /--k-ai:/.test(r.body))
const darkAi = varIn(darkRule?.body ?? '', '--k-ai')

test('AK1 --k-ai in :root is AI_VIOLET', () => {
	assert.equal(rootAi, AI_VIOLET)
})

test('AK2 the AI violet passes 4.5 : 1 on the bars and their hover, light and dark', () => {
	for (const bg of ['#ffffff', '#f5f5f5']) assert.ok(contrast(rootAi, bg) >= 4.5, `${rootAi} on ${bg}`)
	assert.ok(darkRule, 'a dark mode b rule sets --k-ai')
	assert.ok(darkRule.selector.includes('.knorke-toolbar') && darkRule.selector.includes('.knorke-contextbar'), 'on the tool bar and the context bar')
	// the dark rule's own surfaces and hover
	assert.equal(varIn(darkRule.body, '--k-surface'), '#2b2c30')
	assert.equal(varIn(darkRule.body, '--k-hover'), '#3a3b40')
	for (const bg of ['#2b2c30', '#3a3b40']) assert.ok(contrast(darkAi, bg) >= 4.5, `${darkAi} on ${bg}`)
})

test('AK3 "Create with AI" shows the sparkle and the aria-hidden label "AI", both violet', () => {
	const src = read('src/components/Toolbar.vue')
	const btn = /<NcButton[^>]*data-knorke-tool="ai"[\s\S]*?<\/NcButton>/.exec(src)?.[0] ?? ''
	assert.match(btn, /:aria-label="t\('knorke', 'Create with AI'\)"/)
	assert.match(btn, /<span class="knorke-toolbar__ai knorke-ai-mark">\s*<NcIconSvgWrapper :path="icons\.sparkle"/)
	assert.match(btn, /<span class="knorke-toolbar__ailabel" aria-hidden="true">\{\{ t\('knorke', 'AI'\) \}\}<\/span>/)
	const colour = rules().find((r) => r.selector.split(',').map((s) => s.trim()).includes('.knorke-toolbar__ai'))
	assert.match(colour?.body ?? '', /color:\s*var\(--k-ai\)/)
	assert.equal(JSON.parse(read('l10n/de.json')).translations.AI, 'KI')
})

test('AK4 "Summarise" and "Cluster by topic" carry the AI mark: violet icons, no label', () => {
	const src = read('src/components/ContextBar.vue')
	for (const a of ['ai-summarise', 'ai-cluster']) {
		const btn = new RegExp(`<NcButton v-else-if="item === '${a}'"[\\s\\S]*?</NcButton>`).exec(src)?.[0] ?? ''
		assert.match(btn, /class="knorke-ai-mark"/, a)
		assert.match(btn.replace(/<template #icon>[\s\S]*?<\/template>/, ''), /e\)">\s*<\/NcButton>$/, a + ' has no visible text')
	}
	const icon = rules().find((r) => r.selector.split(',').map((s) => s.trim()).includes('.knorke-ai-mark .icon-vue'))
	assert.match(icon?.body ?? '', /color:\s*var\(--k-ai\)/)
})

test('the tool bar button keeps its square box: sparkle (20 px) and label fit the icon box (32 px at 36 px)', () => {
	const label = rules().find((r) => r.selector === '.knorke-toolbar__ailabel')?.body ?? ''
	const lh = Number(/line-height:\s*(\d+)px/.exec(label)?.[1])
	const gap = Number(/gap:\s*(\d+)(?:px)?;/.exec(rules().find((r) => r.selector === '.knorke-toolbar__ai' && /flex-direction/.test(r.body))?.body ?? '')?.[1] ?? 0)
	const icon = Number(/:size="(\d+)"/.exec(/<NcIconSvgWrapper :path="icons\.sparkle"[^>]*>/.exec(/data-knorke-tool="ai"[\s\S]*?<\/NcButton>/.exec(read('src/components/Toolbar.vue'))[0])[0])?.[1] ?? 20)
	assert.ok(icon + gap + lh <= 36 - 4, `${icon} + ${gap} + ${lh}`)
	assert.match(label, /white-space:\s*nowrap/)
})
