/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Select n locked items" in the context bar (factory job 190, AK5),
 * rendered with @vue/server-renderer: with selection v2 lockedOffer > 0 the
 * text button [data-knorke-action=select-locked] (lock icon, "Select 3
 * locked items", German "3 gesperrte Objekte auswählen", singular for 1)
 * stands right before the count; its click emits select-locked(event).
 * With count 0 the bar shows only this button (no Copy, no count); without
 * lockedOffer there is no button. On phones and coarse pointers it is
 * finger-sized (knorke.css). The board view shows the bar for count > 0 or
 * lockedOffer > 0 and runs session.selectLockedOffer through lockAct.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register, unregister } from '@nextcloud/l10n'
import { parse } from '@vue/compiler-dom'
import { icons } from '../../../src/components/icons.js'
import { TYPES } from '../../../src/model/registry.js'
import { useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default

const render = (C, props) => renderToString(createSSRApp(C, props))
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')
const DE = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

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

/** @return {string} the select-locked button (the NcButton stub: its icon, then its text) with its content, '' without */
const offerButton = (html) => html.match(/<div[^>]*data-knorke-action="select-locked"[^>]*>(?:<div[^>]*><\/div>)?[^<]*<\/div>/)?.[0] ?? ''
/** @return {string} the visible text of an element (tags dropped, blanks collapsed) */
const textOf = (el) => el.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * @param {string} file .vue file
 * @return {object} the root of its template AST
 */
function template(file) {
	return parse(read(file).match(/<template>([\s\S]*)<\/template>\s*<script/)[1])
}

/**
 * @param {object} node AST node
 * @param {(e: object) => boolean} pred test
 * @return {object[]} every element below node that passes
 */
function findAll(node, pred) {
	const out = []
	for (const c of node.children ?? []) {
		if (c.type === 1) {
			if (pred(c)) out.push(c)
			out.push(...findAll(c, pred))
		}
	}
	return out
}

/** @return {object|undefined} the static attribute or bound prop `name` of an element */
const prop = (el, name) => el.props.find((p) => (p.type === 6 && p.name === name) || (p.type === 7 && p.arg?.content === name))
/** @return {string|undefined} the expression of directive `name` (if, on:click …) */
const directive = (el, name, arg) => el.props.find((p) => p.type === 7 && p.name === name && (arg === undefined || p.arg?.content === arg))?.exp?.content

test('job 190 AK5, job 230: lockedOffer 3 → [data-knorke-action=select-locked] "Select 3 locked items" with the lock icon, right before "…"; finger-sized class', async () => {
	const html = strip(await render(ContextBar, { selection: sel(['sticky'], { lockedOffer: 3 }) }))
	const btn = offerButton(html)
	assert.ok(btn, 'the button is there')
	assert.equal((html.match(/data-knorke-action="select-locked"/g) ?? []).length, 1)
	assert.equal(textOf(btn), 'Select 3 locked items')
	assert.ok(btn.includes(`path="${icons.lock}"`), 'icons.lock')
	assert.match(btn, /class="knorke-contextbar__offer"/)
	assert.match(btn, /aria-label="Select 3 locked items"/)
	const more = html.indexOf('<div class="knorke-contextbar__more"')
	assert.ok(more > 0, '"…" is there')
	assert.equal(html.indexOf(btn) + btn.length, html.lastIndexOf('<div class="knorke-contextbar__sep"', more), 'the button stands right before the separator of "…"')
	assert.match(html, /data-knorke-action="copy"/, 'with a selection: Copy in "…"')
	// one: the singular
	const one = textOf(offerButton(strip(await render(ContextBar, { selection: sel(['sticky'], { lockedOffer: 1 }) }))))
	assert.equal(one, 'Select 1 locked item')
})

test('job 190 AK5: count 0 with lockedOffer 2 → only this button (no Copy, no count, no other action); without lockedOffer (missing, 0, not a number) no button', async () => {
	const html = strip(await render(ContextBar, { selection: sel([], { lockedOffer: 2 }) }))
	assert.equal(textOf(offerButton(html)), 'Select 2 locked items')
	assert.doesNotMatch(html, /data-knorke-action="copy"/, 'no Copy')
	assert.doesNotMatch(html, /knorke-contextbar__count|selected/, 'no count')
	assert.deepEqual([...html.matchAll(/data-knorke-action="([a-z-]+)"/g)].map((m) => m[1]), ['select-locked'], 'the only action')
	assert.deepEqual([...html.matchAll(/data-knorke-section="([a-z-]+)"/g)], [], 'no section')
	for (const extra of [{}, { lockedOffer: 0 }, { lockedOffer: '3' }, { lockedOffer: null }]) {
		const plain = strip(await render(ContextBar, { selection: sel(['sticky', 'shape'], extra) }))
		assert.doesNotMatch(plain, /select-locked/, JSON.stringify(extra))
		assert.match(plain, /^<div[^>]*><span class="knorke-contextbar__count">2 selected<\/span>/, JSON.stringify(extra))
	}
})

test('job 190 AK5: German "3 gesperrte Objekte auswählen", singular "1 gesperrtes Objekt auswählen"', async () => {
	register('knorke', DE)
	try {
		assert.equal(textOf(offerButton(strip(await render(ContextBar, { selection: sel([], { lockedOffer: 3 }) })))), '3 gesperrte Objekte auswählen')
		assert.equal(textOf(offerButton(strip(await render(ContextBar, { selection: sel([], { lockedOffer: 1 }) })))), '1 gesperrtes Objekt auswählen')
	} finally {
		unregister('knorke')
	}
})

test('job 190 AK5: the click emits select-locked(event); ContextBar declares the event', () => {
	const ast = template('src/components/ContextBar.vue')
	const btns = findAll(ast, (e) => e.tag === 'NcButton' && prop(e, 'data-knorke-action')?.value?.content === 'select-locked')
	assert.equal(btns.length, 1)
	assert.equal(directive(btns[0], 'else-if'), "item === 'offer'", 'job 230: one element of contextbar.js barGroups')
	const emitted = []
	const handler = new Function('$emit', `return ${directive(btns[0], 'on', 'click')}`)((...a) => emitted.push(a))
	const ev = { type: 'click', detail: 1 }
	handler(ev)
	assert.deepEqual(emitted, [['select-locked', ev]])
	assert.match(read('src/components/ContextBar.vue'), /defineEmits\(\[[^\]]*'select-locked'/)
})

test('job 190 AK5: on phones and coarse pointers the button is at least 44 × 44 px (knorke.css)', () => {
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	const blocks = [...css.matchAll(/@media \(max-width: 600px\), \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map((m) => m[1])
	const rule = blocks.map((b) => b.match(/\.button-vue\.knorke-contextbar__offer\s*\{([^}]*)\}/)?.[1]).find(Boolean) ?? ''
	assert.match(rule, /min-width: var\(--knorke-touch\) !important/)
	assert.match(rule, /min-height: var\(--knorke-touch\) !important/)
	assert.match(css, /--knorke-touch: 44px;/)
})

test('job 190 AK5: the board view shows the bar for count > 0 or lockedOffer > 0 (mode edit, ready, not frozen) and runs selectLockedOffer through lockAct', () => {
	const view = template('src/views/BoardView.vue')
	const bar = findAll(view, (e) => e.tag === 'ContextBar')[0]
	const shown = new Function('ready', 'uiMode', 'frozen', 'selection', `return ${directive(bar, 'if')}`)
	assert.equal(shown(true, 'edit', false, { count: 2 }), true)
	assert.equal(shown(true, 'edit', false, { count: 0, lockedOffer: 2 }), true, 'only an offer')
	assert.equal(shown(true, 'edit', false, { count: 0, lockedOffer: 0 }), false)
	assert.equal(shown(true, 'edit', false, { count: 0 }), false, 'selection v2 without the key')
	assert.equal(shown(true, 'vote', false, { count: 0, lockedOffer: 2 }), false)
	assert.equal(shown(true, 'edit', true, { count: 0, lockedOffer: 2 }), false, 'frozen')
	assert.equal(shown(false, 'edit', false, { count: 0, lockedOffer: 2 }), false)
	assert.equal(directive(bar, 'on', 'select-locked'), '() => lockAct((s) => s.selectLockedOffer())')
	const calls = []
	const session = { value: { selectLockedOffer: () => calls.push('select'), focusCanvas: () => calls.push('focus') } }
	const src = read('src/views/BoardView.vue')
	const lockAct = new Function('session', `${src.match(/function lockAct\(fn\) \{[\s\S]*?\n\}/)[0]}\nreturn lockAct`)(session)
	new Function('lockAct', `return ${directive(bar, 'on', 'select-locked')}`)(lockAct)()
	assert.deepEqual(calls, ['select', 'focus'], 'selected, then the canvas has the focus (like Lock)')
})
