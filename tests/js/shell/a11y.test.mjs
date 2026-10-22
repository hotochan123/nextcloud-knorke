/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * U14 (NC-7): structure checks on the parsed templates (Vue's own parser):
 * board list rows stay list items with a real link and the actions as its
 * sibling; the owner's rename trigger in the top bar is a named button.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'

/**
 * @param {string} f repo path of a .vue file
 * @return {object} root AST of its <template>
 */
function template(f) {
	const src = readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
	const m = src.match(/<template>([\s\S]*)<\/template>\s*<script/)
	return parse(m[1])
}

/**
 * @param {object} node AST node
 * @param {(n: object) => boolean} pred predicate
 * @param {object[]} [out] results
 * @return {object[]} every element below node matching pred
 */
function findAll(node, pred, out = []) {
	for (const c of node.children ?? []) {
		if (c.type === 1 && pred(c)) {
			out.push(c)
		}
		findAll(c, pred, out)
	}
	return out
}

/**
 * @param {object} el element
 * @param {string} name attribute name (static) or v-bind argument
 * @return {object|undefined} the prop
 */
function prop(el, name) {
	return el.props.find((p) => (p.type === 6 && p.name === name) || (p.type === 7 && p.name === 'bind' && p.arg?.content === name))
}

test('U14 board list: each row is a plain list item; title and meta are a real link without aria-label; the actions are its sibling', () => {
	const ast = template('src/views/BoardList.vue')
	const rows = findAll(ast, (e) => e.tag === 'li')
	assert.equal(rows.length, 1)
	const li = rows[0]
	for (const bad of ['role', 'tabindex', 'aria-label']) {
		assert.equal(prop(li, bad), undefined, 'li without ' + bad)
	}
	assert.ok(prop(li, 'data-knorke-board'), 'E2E hook stays on the row')
	assert.ok(!li.props.some((p) => p.type === 7 && p.name === 'on'), 'the row itself has no handlers')
	const links = findAll(li, (e) => e.tag === 'a')
	assert.equal(links.length, 1)
	const a = links[0]
	assert.ok(prop(a, 'href'), 'a real href')
	assert.equal(prop(a, 'aria-label'), undefined, 'the link is named by its content (title, owner, time)')
	assert.equal(findAll(a, (e) => e.tag === 'NcActions').length, 0, 'no actions inside the link')
	assert.equal(findAll(a, (e) => e.tag === 'button' || /^NcAction/.test(e.tag)).length, 0, 'nothing interactive inside the link')
	assert.equal(findAll(li, (e) => e.tag === 'NcActions').length, 1, 'actions sit next to the link')
	assert.ok(findAll(a, (e) => (e.props.find((p) => p.name === 'class')?.value?.content ?? '').includes('knorke-list__meta')).length === 1, 'meta inside the link')
})

test('U14 top bar: the owner\'s rename trigger is a button named "Rename board: {title}" inside the heading; no focusable heading', () => {
	const ast = template('src/components/TopBar.vue')
	const headings = findAll(ast, (e) => e.tag === 'h2')
	assert.ok(headings.length >= 2)
	for (const h of headings) {
		assert.equal(prop(h, 'tabindex'), undefined, 'a heading is never focusable')
		assert.ok(!h.props.some((p) => p.type === 7 && p.name === 'on'), 'no click/keydown on a heading')
	}
	const buttons = headings.flatMap((h) => findAll(h, (e) => e.tag === 'button'))
	assert.equal(buttons.length, 1)
	const b = buttons[0]
	assert.equal(prop(b, 'type')?.value?.content, 'button')
	assert.match(prop(b, 'aria-label').exp.content, /t\('knorke', 'Rename board: \{title\}', \{ title \}\)/)
	assert.ok(b.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click'))
})

// ---- SPEC-M1 §6.8, §6.12 (stage 1, round 1a) ------------------------------------

/**
 * @param {object} el element
 * @param {string} name attribute (static or bound)
 * @return {boolean}
 */
function has(el, name) {
	return prop(el, name) !== undefined
}

test('M1 toolbar: every button is named; tools are toggle buttons (pressed) with [data-knorke-tool]; the shape kinds have a named menu', () => {
	const ast = template('src/components/Toolbar.vue')
	const buttons = findAll(ast, (e) => e.tag === 'NcButton')
	assert.ok(buttons.length >= 3)
	for (const b of buttons) {
		assert.ok(has(b, 'aria-label'), 'NcButton without aria-label')
		assert.ok(b.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click'), 'click carries the event')
	}
	const tools = buttons.filter((b) => has(b, 'data-knorke-tool'))
	assert.equal(tools.length, 1, 'one v-for button for all tools')
	assert.ok(has(tools[0], 'pressed'))
	const opts = template('src/components/ToolOptions.vue')
	const menu = findAll(opts, (e) => e.tag === 'NcActions')[0]
	assert.ok(has(menu, 'aria-label') && has(menu, 'data-knorke-tool-options'))
	const radios = findAll(opts, (e) => e.tag === 'NcActionRadio')
	assert.equal(radios.length, 1)
	assert.ok(has(radios[0], 'data-knorke-tool-option'))
})

test('M1 context bar: a named toolbar; every button named and stateful (aria-pressed), section toggles with aria-expanded/aria-controls; style hooks on every style button', () => {
	const ast = template('src/components/ContextBar.vue')
	const root = ast.children.find((c) => c.type === 1)
	assert.equal(prop(root, 'role').value.content, 'toolbar')
	assert.ok(has(root, 'aria-label'))
	for (const b of findAll(ast, (e) => e.tag === 'button')) {
		assert.equal(prop(b, 'type')?.value?.content, 'button')
		assert.ok(has(b, 'aria-pressed'), 'native style button without aria-pressed')
		assert.ok(has(b, 'aria-label') || b.children.some((c) => c.type === 5 || c.type === 2), 'native button without a name')
		assert.ok(has(b, 'data-knorke-style') && has(b, 'data-knorke-value'), 'style hook')
	}
	const nc = findAll(ast, (e) => e.tag === 'NcButton')
	for (const b of nc) {
		assert.ok(has(b, 'aria-label'), 'NcButton without aria-label')
	}
	const panelActions = ['arrange', 'align']
	const toggles = nc.filter((b) => has(b, 'data-knorke-section') || panelActions.includes(prop(b, 'data-knorke-action')?.value?.content))
	assert.deepEqual(toggles.map((b) => prop(b, 'data-knorke-section')?.value?.content ?? prop(b, 'data-knorke-action').value.content), ['fill', 'border', 'text', 'kind', 'route', 'caps', 'arrange', 'align'])
	for (const b of toggles) {
		assert.ok(has(b, 'aria-expanded') && has(b, 'aria-controls'))
	}
	for (const a of ['arrange', 'align', 'copy', 'cut', 'duplicate', 'connect', 'label']) {
		assert.equal(nc.filter((b) => prop(b, 'data-knorke-action')?.value?.content === a).length, 1, a)
	}
	assert.equal(nc.filter((b) => /paste/.test(prop(b, 'data-knorke-action')?.value?.content ?? '')).length, 0, 'no paste button')
	// round 1b (§6.8, §6.12): "Connect" only with selection v2 canConnect, emitting connect with the event
	const connect = nc.find((b) => prop(b, 'data-knorke-action')?.value?.content === 'connect')
	assert.match(connect.props.find((p) => p.type === 7 && p.name === 'if')?.exp?.content ?? '', /selection.canConnect/)
	assert.ok(connect.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click'))
	// every connector style button carries its hook (route, start/end tip)
	const styled = nc.filter((b) => has(b, 'data-knorke-style')).map((b) => prop(b, 'data-knorke-style'))
	const paths = styled.map((p) => p.value?.content ?? p.exp?.content)
	for (const p of ['data.route', 'end.path', 'style.dash', 'style.align', 'data.kind']) {
		assert.ok(paths.includes(p), 'style hook ' + p)
	}
	const panel = findAll(ast, (e) => has(e, 'data-knorke-panel'))[0]
	assert.ok(has(panel, 'role') && has(panel, 'aria-label') && has(panel, 'id'))
})

test('M2 align (AK9): one named toggle [data-knorke-action=align] (v-if sections.itemAlign, aria-expanded, aria-controls); its panel holds the six commands of ALIGN_EDGES as named NcButtons that emit align(edge, event); the board view wires @align', () => {
	const ast = template('src/components/ContextBar.vue')
	const nc = findAll(ast, (e) => e.tag === 'NcButton')
	const toggle = nc.filter((b) => prop(b, 'data-knorke-action')?.value?.content === 'align')
	assert.equal(toggle.length, 1)
	const tb = toggle[0]
	for (const a of ['aria-label', 'title', 'aria-expanded', 'aria-controls', 'pressed']) {
		assert.ok(has(tb, a), 'toggle without ' + a)
	}
	// 018 AK1: a name apart from the text alignment
	assert.equal(prop(tb, 'aria-label').exp.content, "t('knorke', 'Align items')")
	assert.equal(prop(tb, 'title').exp.content, "t('knorke', 'Align items')")
	assert.equal(prop(tb, 'aria-controls').exp.content, 'panelId')
	assert.equal(tb.props.find((p) => p.type === 7 && p.name === 'if')?.exp?.content, 'sections.itemAlign')
	assert.match(tb.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click')?.exp?.content ?? '', /toggle\('align'\)/)
	// the commands: one v-for NcButton per edge, in rows over ITEM_ALIGN_ROWS (= ALIGN_EDGES in two rows)
	const cmds = nc.filter((b) => has(b, 'data-knorke-align'))
	assert.equal(cmds.length, 1, 'one v-for button for every edge')
	const cb = cmds[0]
	assert.equal(cb.props.find((p) => p.type === 7 && p.name === 'for')?.exp?.content, 'edge in row')
	assert.equal(prop(cb, 'data-knorke-align').exp.content, 'edge')
	assert.equal(prop(cb, 'aria-label').exp.content, 'itemAlignLabel(edge)')
	assert.equal(prop(cb, 'title').exp.content, 'itemAlignLabel(edge)')
	assert.equal(prop(cb, 'variant').value.content, 'tertiary')
	assert.equal(prop(cb, 'pressed'), undefined, 'commands, not states')
	assert.match(cb.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click')?.exp?.content ?? '', /\$emit\('align', edge, e\)/)
	const rows = findAll(ast, (e) => findAll(e, (c) => c === cb).length > 0 && e.props.some((p) => p.type === 7 && p.name === 'for'))
	assert.equal(rows.length, 1)
	assert.equal(rows[0].props.find((p) => p.type === 7 && p.name === 'for').exp.content, '(row, i) in ITEM_ALIGN_ROWS')
	assert.equal(prop(rows[0], 'class').value.content, 'knorke-contextbar__row')
	const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(src, /import \{ ALIGN_EDGES, DISTRIBUTE_AXES \} from '\.\.\/board\/actions\.js'/)
	assert.match(src, /const ITEM_ALIGN_ROWS = Object\.freeze\(\[ALIGN_EDGES\.slice\(0, 3\), ALIGN_EDGES\.slice\(3\)\]\)/)
	assert.match(src, /defineEmits\(\[[^\]]*'align'/)
	// the board view runs the command (refocus after a pointer click)
	const view = template('src/views/BoardView.vue')
	const bar = findAll(view, (e) => e.tag === 'ContextBar')[0]
	const on = bar.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'align')
	assert.ok(on, 'ContextBar @align')
	assert.match(on.exp.content, /act\(e, \(s\) => s\.align\(edge\)\)/)
})

test('018 AK6: the panel element is the next element after the toggle [data-knorke-action=align] (the last panel toggle) and comes before "Copy"; the count stays the last child of the bar', () => {
	const ast = template('src/components/ContextBar.vue')
	const root = ast.children.find((c) => c.type === 1)
	const kids = root.children.filter((c) => c.type === 1)
	const action = (el) => prop(el, 'data-knorke-action')?.value?.content
	const align = kids.findIndex((c) => c.tag === 'NcButton' && action(c) === 'align')
	const copy = kids.findIndex((c) => c.tag === 'NcButton' && action(c) === 'copy')
	const panel = kids.findIndex((c) => has(c, 'data-knorke-panel'))
	assert.ok(align >= 0 && copy >= 0 && panel >= 0, 'toggle, panel and Copy are children of the bar root')
	assert.equal(panel, align + 1, 'the panel follows the toggle "Align items" directly')
	assert.equal(copy, panel + 1, 'and stands right before "Copy"')
	// every panel toggle comes before the panel (one Tab from "Align items" or "Arrange" leads into it)
	const toggles = kids.map((c, i) => [c, i]).filter(([c]) => has(c, 'aria-controls'))
	assert.equal(toggles.length, 8)
	assert.ok(toggles.every(([, i]) => i < panel))
	assert.equal(kids.findIndex((c) => c.tag === 'NcButton' && action(c) === 'arrange'), align - 1, '"Arrange" right before "Align items" (never shown together)')
	// the panel itself: unchanged attributes, the count is the last child
	assert.equal(prop(kids[panel], 'id').exp.content, 'panelId')
	assert.equal(prop(kids[panel], 'class').value.content, 'knorke-contextbar__panel')
	assert.equal(prop(kids[panel], 'role').value.content, 'group')
	assert.equal(prop(kids[panel], 'aria-label').exp.content, 'panelLabel')
	assert.equal(kids[panel].props.find((p) => p.type === 7 && p.name === 'if')?.exp?.content, 'panel')
	assert.equal(prop(kids.at(-1), 'class')?.value?.content, 'knorke-contextbar__count')
})

test('M2 distribute (AK9): one v-for NcButton [data-knorke-distribute] over DISTRIBUTE_AXES, named, a command (no pressed) emitting distribute(axis, event), in a row of its own (v-if sections.distribute) inside the align panel; no toggle of its own; the board view wires @distribute', () => {
	const ast = template('src/components/ContextBar.vue')
	const nc = findAll(ast, (e) => e.tag === 'NcButton')
	const cmds = nc.filter((b) => has(b, 'data-knorke-distribute'))
	assert.equal(cmds.length, 1, 'one v-for button for both axes')
	const cb = cmds[0]
	assert.equal(cb.props.find((p) => p.type === 7 && p.name === 'for')?.exp?.content, 'axis in DISTRIBUTE_AXES')
	assert.equal(prop(cb, 'data-knorke-distribute').exp.content, 'axis')
	assert.equal(prop(cb, 'aria-label').exp.content, 'distributeLabel(axis)')
	assert.equal(prop(cb, 'title').exp.content, 'distributeLabel(axis)')
	assert.equal(prop(cb, 'variant').value.content, 'tertiary')
	assert.equal(prop(cb, 'pressed'), undefined, 'commands, not states')
	assert.match(cb.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click')?.exp?.content ?? '', /\$emit\('distribute', axis, e\)/)
	// its row: a plain panel row, shown from three alignable items
	const row = findAll(ast, (e) => e.children?.includes(cb))[0]
	assert.equal(row.tag, 'div')
	assert.equal(prop(row, 'class').value.content, 'knorke-contextbar__row')
	assert.equal(row.props.find((p) => p.type === 7 && p.name === 'if')?.exp?.content, 'sections.distribute')
	// inside the branch of the align panel, after the align rows
	const branch = findAll(ast, (e) => e.props.some((p) => p.type === 7 && p.name === 'else-if' && p.exp?.content === "panel === 'align'"))
	assert.equal(branch.length, 1)
	assert.ok(branch[0].children.includes(row), 'a row of the align panel')
	assert.ok(branch[0].children.indexOf(row) > branch[0].children.findIndex((c) => c.type === 1 && findAll(c, (x) => has(x, 'data-knorke-align')).length > 0), 'after the align rows')
	// no toggle of its own: the panel toggles stay the same
	const toggles = nc.filter((b) => has(b, 'data-knorke-section') || ['arrange', 'align'].includes(prop(b, 'data-knorke-action')?.value?.content))
	assert.deepEqual(toggles.map((b) => prop(b, 'data-knorke-section')?.value?.content ?? prop(b, 'data-knorke-action').value.content), ['fill', 'border', 'text', 'kind', 'route', 'caps', 'arrange', 'align'])
	assert.ok(!nc.some((b) => /distribute/.test(prop(b, 'data-knorke-action')?.value?.content ?? '')))
	const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(src, /defineEmits\(\[[^\]]*'distribute'/)
	assert.match(src, /const DISTRIBUTE_ICONS = Object\.freeze\(\{ horizontal: icons\.distributeHorizontal, vertical: icons\.distributeVertical \}\)/)
	// the board view runs the command (refocus after a pointer click)
	const view = template('src/views/BoardView.vue')
	const bar = findAll(view, (e) => e.tag === 'ContextBar')[0]
	const on = bar.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'distribute')
	assert.ok(on, 'ContextBar @distribute')
	assert.match(on.exp.content, /act\(e, \(s\) => s\.distribute\(axis\)\)/)
})

test('M2 tidy up (AK8): one named NcButton [data-knorke-action=tidy], a command (no pressed, no v-for, no v-if) emitting tidy(event) with icons.tidyUp, in a row of its own (no v-if) inside the align panel after the distribute row; no toggle of its own; the board view wires @tidy', () => {
	const ast = template('src/components/ContextBar.vue')
	const nc = findAll(ast, (e) => e.tag === 'NcButton')
	const cmds = nc.filter((b) => prop(b, 'data-knorke-action')?.value?.content === 'tidy')
	assert.equal(cmds.length, 1)
	const cb = cmds[0]
	assert.equal(prop(cb, 'data-knorke-action').type, 6, 'a static hook')
	assert.match(prop(cb, 'aria-label').exp.content, /^t\('knorke', 'Tidy up'\)$/)
	assert.match(prop(cb, 'title').exp.content, /^t\('knorke', 'Tidy up'\)$/)
	assert.equal(prop(cb, 'variant').value.content, 'tertiary')
	assert.equal(prop(cb, 'pressed'), undefined, 'a command, not a state')
	for (const d of ['for', 'if', 'else-if', 'show']) {
		assert.equal(cb.props.find((p) => p.type === 7 && p.name === d), undefined, 'no v-' + d)
	}
	assert.match(cb.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click')?.exp?.content ?? '', /\$emit\('tidy', e\)/)
	const icon = findAll(cb, (e) => e.tag === 'NcIconSvgWrapper')
	assert.equal(icon.length, 1)
	assert.equal(prop(icon[0], 'path').exp.content, 'icons.tidyUp')
	// its row: a plain panel row, always there while the panel is open
	const row = findAll(ast, (e) => e.children?.includes(cb))[0]
	assert.equal(row.tag, 'div')
	assert.equal(prop(row, 'class').value.content, 'knorke-contextbar__row')
	assert.equal(row.props.find((p) => p.type === 7 && ['if', 'else-if', 'show', 'for'].includes(p.name)), undefined, 'no v-if')
	// inside the branch of the align panel, after the distribute row
	const branch = findAll(ast, (e) => e.props.some((p) => p.type === 7 && p.name === 'else-if' && p.exp?.content === "panel === 'align'"))
	assert.equal(branch.length, 1)
	const kids = branch[0].children.filter((c) => c.type === 1)
	assert.ok(kids.includes(row), 'a row of the align panel')
	const distributeRow = kids.findIndex((c) => findAll(c, (x) => has(x, 'data-knorke-distribute')).length > 0)
	assert.ok(distributeRow >= 0 && kids.indexOf(row) > distributeRow, 'after the distribute row')
	// no toggle of its own: the panel toggles stay the same
	const toggles = nc.filter((b) => has(b, 'data-knorke-section') || ['arrange', 'align'].includes(prop(b, 'data-knorke-action')?.value?.content))
	assert.deepEqual(toggles.map((b) => prop(b, 'data-knorke-section')?.value?.content ?? prop(b, 'data-knorke-action').value.content), ['fill', 'border', 'text', 'kind', 'route', 'caps', 'arrange', 'align'])
	const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(src, /defineEmits\(\[[^\]]*'tidy'/)
	// the board view runs the command (refocus after a pointer click)
	const view = template('src/views/BoardView.vue')
	const bar = findAll(view, (e) => e.tag === 'ContextBar')[0]
	const on = bar.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'tidy')
	assert.ok(on, 'ContextBar @tidy')
	assert.match(on.exp.content, /act\(e, \(s\) => s\.tidy\(\)\)/)
})

test('M1 arrange: five labelled number fields with their hooks, Enter applies, a submit button', () => {
	const ast = template('src/components/ArrangePopover.vue')
	const fields = findAll(ast, (e) => e.tag === 'NcTextField')
	assert.deepEqual(fields.map((f) => prop(f, 'data-knorke-field').value.content), ['arrange-x', 'arrange-y', 'arrange-w', 'arrange-h', 'arrange-r'])
	for (const f of fields) {
		assert.ok(has(f, 'label'))
		assert.equal(prop(f, 'type').value.content, 'number')
		assert.ok(f.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'keydown'), 'Enter applies')
	}
	assert.equal(findAll(ast, (e) => e.tag === 'NcButton' && prop(e, 'type')?.value?.content === 'submit').length, 1)
})

test('M1 board view: the canvas host is focusable and named; the paste catcher is hidden from assistive technology and out of the tab order', () => {
	const ast = template('src/views/BoardView.vue')
	const host = findAll(ast, (e) => (prop(e, 'class')?.value?.content ?? '') === 'knorke-canvas')[0]
	assert.equal(prop(host, 'tabindex').value.content, '0')
	assert.ok(has(host, 'aria-label'))
	const catcher = findAll(ast, (e) => e.tag === 'textarea' && has(e, 'data-knorke-paste-catcher'))
	assert.equal(catcher.length, 1)
	assert.equal(prop(catcher[0], 'aria-hidden').value.content, 'true')
	assert.equal(prop(catcher[0], 'tabindex').value.content, '-1')
})

test('M1 1b toolbar: every tool of TOOLS is offered (the connector tool is no longer hidden), each with an icon of its own; the board view wires connect and label', () => {
	const src = readFileSync(new URL('../../../src/components/Toolbar.vue', import.meta.url), 'utf8')
	assert.doesNotMatch(src, /HIDDEN_TOOLS|\.filter\(/, 'no tool is filtered out')
	const icons = src.match(/const ICONS = Object\.freeze\(\{([\s\S]*?)\}\)/)[1]
	for (const id of ['select', 'hand', 'sticky', 'shape', 'text', 'connector', 'frame']) {
		assert.match(icons, new RegExp(`\\b${id}: icons\\.`), id)
	}
	const view = template('src/views/BoardView.vue')
	const bar = findAll(view, (e) => e.tag === 'ContextBar')[0]
	assert.ok(bar.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'connect'))
	assert.ok(bar.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'label'))
})

// ---- SPEC-M1 §6.12 (stage 2: sharing) ------------------------------------------------

/**
 * @param {object} el element
 * @param {string} name attribute
 * @return {string|undefined} static value or bound expression
 */
function val(el, name) {
	const p = prop(el, name)
	return p ? (p.type === 6 ? p.value?.content : p.exp?.content) : undefined
}

test('M1 share dialog: a named tablist; tabs are role=tab with aria-selected; one tabpanel', () => {
	const ast = template('src/components/ShareDialog.vue')
	const list = findAll(ast, (e) => val(e, 'role') === 'tablist')
	assert.equal(list.length, 1)
	assert.ok(has(list[0], 'aria-label'))
	const tabs = findAll(list[0], (e) => val(e, 'role') === 'tab')
	assert.equal(tabs.length, 2)
	for (const tab of tabs) {
		assert.ok(has(tab, 'aria-selected'), 'aria-selected')
		assert.ok(has(tab, 'data-knorke-share-tab'))
	}
	assert.equal(findAll(ast, (e) => val(e, 'role') === 'tabpanel').length, 1)
})

test('M1 share people: icon-only buttons and the role pickers are named; rows are list items', () => {
	const ast = template('src/components/SharePeople.vue')
	const remove = findAll(ast, (e) => val(e, 'data-knorke-action') === 'share-remove')[0]
	assert.match(val(remove, 'aria-label'), /Remove \{name\}/)
	const picker = findAll(ast, (e) => val(e, 'data-knorke-field') === 'share-role')[0]
	assert.match(val(picker, 'aria-label-combobox'), /Role of \{name\}/)
	const search = findAll(ast, (e) => val(e, 'data-knorke-field') === 'sharee-search')[0]
	assert.ok(has(search, 'input-label'), 'the search field has a label')
	assert.equal(findAll(ast, (e) => e.tag === 'li').length, 1)
	for (const icon of findAll(ast, (e) => (val(e, 'class') ?? '') === 'knorke-people__icon')) {
		assert.equal(val(icon, 'aria-hidden'), 'true')
	}
})

test('M1 links: headings are plain (never focusable); QR, present and expand state are announced', () => {
	const ast = template('src/components/ShareLinks.vue')
	for (const h of findAll(ast, (e) => /^h[1-6]$/.test(e.tag))) {
		assert.equal(prop(h, 'tabindex'), undefined)
	}
	const qr = findAll(ast, (e) => val(e, 'data-knorke-action') === 'link-qr')[0]
	assert.ok(has(qr, 'aria-expanded'), 'the QR toggle says whether the code is shown')
	const url = findAll(ast, (e) => val(e, 'data-knorke-field') === 'link-url')[0]
	assert.ok(has(url, 'aria-label'))
	const code = template('src/components/QrCode.vue')
	const svg = findAll(code, (e) => e.tag === 'svg')[0]
	assert.equal(val(svg, 'role'), 'img')
	assert.ok(has(svg, 'aria-label'))
})

test('M1 password input (R18/R19 A-03): the show/hide button is an action button – its label says what a click does, no aria-pressed; the field keeps its label', () => {
	const ast = template('src/components/PasswordInput.vue')
	const toggle = findAll(ast, (e) => e.tag === 'NcButton')[0]
	assert.match(val(toggle, 'aria-label'), /Hide password.*Show password/)
	assert.equal(has(toggle, 'aria-pressed'), false, 'a changing action label never comes with aria-pressed (§6.12)')
	assert.equal(has(toggle, 'pressed'), false, 'nor with NcButton\'s pressed (it renders aria-pressed)')
	const field = findAll(ast, (e) => e.tag === 'NcTextField')[0]
	assert.ok(has(field, 'label'))
	assert.match(readFileSync(new URL('../../../src/components/LinkSettings.vue', import.meta.url), 'utf8'), /autocomplete="new-password"/, 'never the account password from the browser')
})

// ---- SPEC-M1 §6.12, §6.8 (stage 3: moderation) -----------------------------------------

/**
 * @param {object} ast template AST
 * @param {string} name attribute
 * @param {string} value value
 * @return {object[]} elements carrying that hook value (static)
 */
const hooked = (ast, name, value) => findAll(ast, (e) => val(e, name) === value)

/**
 * @param {object} el element
 * @return {boolean} named by aria-label, title or own text
 */
const named = (el) => has(el, 'aria-label') || (el.children ?? []).some((c) => c.type === 5 || (c.type === 2 && c.content.trim() !== '') || (c.type === 1 && named(c)))

test('M1 stage 3 presence bar: participants are buttons with aria-pressed and a name; "+{n}" opens the list (aria-expanded, aria-controls); the hint sits on the bar', () => {
	const ast = template('src/components/PresenceBar.vue')
	const root = ast.children.find((c) => c.type === 1)
	assert.equal(val(root, 'role'), 'group')
	assert.ok(has(root, 'aria-label') && has(root, 'aria-describedby') && has(root, 'title'))
	const parts = findAll(ast, (e) => has(e, 'data-knorke-participant'))
	assert.equal(parts.length, 2, 'bar and popover list')
	for (const b of parts) {
		assert.equal(b.tag, 'button')
		assert.equal(val(b, 'type'), 'button')
		assert.ok(has(b, 'aria-pressed'))
		assert.ok(named(b))
		// R18/R19 A-03 (T4-25): a toggle keeps one name; the action is only the hint
		assert.equal(val(b, 'aria-label'), 'nameOf(p)', 'name = label(p) (nameOf), never the changing titleOf(p)')
		assert.equal(val(b, 'title'), 'titleOf(p)', 'hint = titleOf(p) ("· Follow" / "· Stop following")')
	}
	const rowText = findAll(ast, (e) => (val(e, 'class') ?? '') === 'knorke-presence__name')[0]
	assert.ok(rowText.children.some((c) => c.type === 5 && c.content.content === 'nameOf(p)'), 'the popover row shows the name, not the action')
	const more = hooked(ast, 'data-knorke-action', 'participants')[0]
	assert.equal(more.tag, 'button')
	assert.ok(has(more, 'aria-expanded') && has(more, 'aria-controls') && has(more, 'aria-label'))
	assert.match(readFileSync(new URL('../../../src/components/PresenceBar.vue', import.meta.url), 'utf8'), /t\('knorke', 'People on tablets or voting don\\'t appear here\.'\)/)
})

test('M1 stage 3 vote bar: a named region at the bottom ([data-knorke-bar=vote]), every button named; the switch is an action button (R17 K5); "+5 min" only with endsAt (R16 SRV-07); a polite live region', () => {
	const ast = template('src/components/VoteBar.vue')
	const root = ast.children.find((c) => c.type === 1)
	assert.equal(val(root, 'role'), 'region')
	assert.ok(has(root, 'aria-label'))
	assert.equal(val(root, 'data-knorke-bar'), 'vote')
	assert.ok(has(root, 'data-knorke-vote-bar') && has(root, 'data-knorke-vote-state') && has(root, 'data-knorke-vote-left'))
	for (const b of findAll(ast, (e) => e.tag === 'NcButton' || e.tag === 'button')) {
		assert.ok(named(b), 'named button')
	}
	// R17 K5 (§6.8, §6.12): the state is conveyed one way only: the label names
	// the action ("Edit" in mode vote, "Vote" in mode edit), no aria-pressed
	const sw = hooked(ast, 'data-knorke-action', 'vote-mode')
	assert.equal(sw.length, 1)
	assert.equal(sw[0].tag, 'button')
	assert.equal(has(sw[0], 'aria-pressed'), false, 'no aria-pressed next to a flipping label')
	assert.equal(has(sw[0], 'aria-label'), false, 'named by its visible text')
	const label = sw[0].children.filter((c) => c.type === 5).map((c) => c.content.content).join(' ')
	assert.match(label, /votes\.mode === 'vote' \? t\('knorke', 'Edit'\) : t\('knorke', 'Vote'\)/, 'the action label: "Edit" in mode vote, "Vote" in mode edit')
	const extend = hooked(ast, 'data-knorke-action', 'vote-extend')[0]
	assert.match(val(extend, 'if') ?? extend.props.find((p) => p.name === 'if')?.exp?.content, /endsAt !== null/)
	assert.equal(hooked(ast, 'data-knorke-bar', 'list').length, 2, '"List" while open, "Results" after the close')
	for (const l of hooked(ast, 'data-knorke-bar', 'list')) {
		assert.equal(val(l, 'data-knorke-action'), 'vote-panel')
		assert.ok(has(l, 'aria-expanded'))
	}
	assert.equal(findAll(ast, (e) => val(e, 'aria-live') === 'polite').length, 1)
	assert.equal(hooked(ast, 'data-knorke-action', 'vote-end').length, 1)
	assert.match(readFileSync(new URL('../../../src/components/VoteBar.vue', import.meta.url), 'utf8'), /End voting now\? Votes can\\'t be changed afterwards\./, '"End voting" asks first')
})

test('M1 stage 3 vote panel and stepper: named dialog/group, ± buttons named (≥ 44 px classes), counts spoken with "Vote for …", close button named', () => {
	const ast = template('src/components/VotePanel.vue')
	const root = ast.children.find((c) => c.type === 1)
	assert.equal(val(root, 'role'), 'dialog')
	assert.ok(has(root, 'aria-label') && has(root, 'data-knorke-vote-panel'))
	for (const h of findAll(ast, (e) => /^h[1-6]$/.test(e.tag))) {
		assert.equal(prop(h, 'tabindex'), undefined)
	}
	for (const a of ['vote-add', 'vote-remove']) {
		const b = hooked(ast, 'data-knorke-action', a)[0]
		assert.ok(has(b, 'aria-label'))
		assert.equal(val(b, 'class'), 'knorke-votepanel__step')
	}
	assert.ok(has(hooked(ast, 'data-knorke-action', 'vote-panel-close')[0], 'aria-label'))
	for (const a of ['vote-copy', 'vote-show', 'vote-hide', 'vote-clear']) {
		assert.equal(hooked(ast, 'data-knorke-action', a).length, 1, a)
	}
	assert.equal(findAll(ast, (e) => has(e, 'data-knorke-vote-results')).length, 2, 'ranking or "No votes were cast."')
	const st = template('src/components/VoteStepper.vue')
	const sroot = st.children.find((c) => c.type === 1)
	assert.equal(val(sroot, 'role'), 'group')
	assert.ok(has(sroot, 'aria-label') && has(sroot, 'data-knorke-vote-stepper'))
	for (const b of findAll(st, (e) => e.tag === 'button')) {
		assert.equal(val(b, 'type'), 'button')
		assert.ok(has(b, 'aria-label'))
	}
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /button\.knorke-votepanel__step,\s*button\.knorke-votestepper__step \{[^}]*width: var\(--knorke-touch\) !important;[^}]*height: var\(--knorke-touch\) !important;/)
	assert.match(css, /--knorke-touch: 44px;/)
})

test('M1 stage 3 vote setup: every field labelled, the switch is input[type=checkbox] role=switch, area and types are fieldsets with legends, the counter is live', () => {
	const ast = template('src/components/VoteSetupDialog.vue')
	assert.equal(hooked(ast, 'data-knorke-dialog', 'vote-setup').length, 1)
	for (const name of ['vote-per', 'vote-minutes']) {
		const input = hooked(ast, 'data-knorke-field', name)[0]
		assert.equal(input.tag, 'input')
		assert.equal(val(input, 'type'), 'number')
	}
	const sw = hooked(ast, 'data-knorke-field', 'vote-per-item')[0]
	assert.equal(sw.tag, 'label')
	const box = findAll(sw, (e) => e.tag === 'input')[0]
	assert.equal(val(box, 'type'), 'checkbox')
	assert.equal(val(box, 'role'), 'switch')
	for (const name of ['vote-scope', 'vote-types']) {
		const fs = hooked(ast, 'data-knorke-field', name)[0]
		assert.equal(fs.tag, 'fieldset')
		assert.equal(findAll(fs, (e) => e.tag === 'legend').length, 1)
	}
	assert.deepEqual(findAll(ast, (e) => has(e, 'data-knorke-vote-scope-option')).map((e) => val(e, 'data-knorke-vote-scope-option')), ['board', 'frame'])
	assert.equal(findAll(ast, (e) => has(e, 'data-knorke-vote-type')).length, 1, 'one v-for label for sticky/shape/text')
	const src = readFileSync(new URL('../../../src/components/VoteSetupDialog.vue', import.meta.url), 'utf8')
	assert.match(src, /type: 'sticky'[\s\S]*type: 'shape'[\s\S]*type: 'text'/)
	for (const input of findAll(ast, (e) => e.tag === 'input')) {
		const inLabel = findAll(ast, (e) => e.tag === 'label' && findAll(e, (x) => x === input).length > 0).length > 0
		assert.ok(inLabel, 'every input sits in its label')
	}
	const count = findAll(ast, (e) => has(e, 'data-knorke-vote-votable'))[0]
	assert.equal(val(count, 'aria-live'), 'polite')
	const start = hooked(ast, 'data-knorke-action', 'vote-start')[0]
	assert.equal(val(start, 'disabled'), '!canStart')
	assert.match(src, /votableNow\.value > 0/, '"Start voting" is disabled at 0')
})

test('M1 stage 3 timer: the chip is role=timer (aria-atomic) with its own polite live region (milestones); a button for moderators; the dialog\'s hooks', () => {
	const ast = template('src/components/TimerChip.vue')
	const chip = findAll(ast, (e) => has(e, 'data-knorke-timer'))[0]
	assert.equal(val(chip, 'data-knorke-bar'), 'timer')
	assert.ok(has(chip, 'data-knorke-timer-state') && has(chip, 'data-knorke-timer-left'))
	const timer = findAll(ast, (e) => val(e, 'role') === 'timer')[0]
	assert.equal(val(timer, 'aria-atomic'), 'true')
	assert.equal(findAll(ast, (e) => val(e, 'aria-live') === 'polite').length, 1)
	const d = template('src/components/TimerDialog.vue')
	assert.equal(hooked(d, 'data-knorke-dialog', 'timer').length, 1)
	for (const a of ['timer-start', 'timer-pause', 'timer-resume', 'timer-add1', 'timer-add5', 'timer-stop']) {
		assert.equal(hooked(d, 'data-knorke-action', a).length, 1, a)
	}
	const minutes = hooked(d, 'data-knorke-field', 'timer-minutes')[0]
	assert.equal(minutes.tag, 'input')
	assert.equal(val(minutes, 'type'), 'number')
	for (const b of findAll(d, (e) => e.tag === 'button')) {
		assert.ok(has(b, 'aria-pressed'), 'preset buttons say which is chosen')
	}
})

test('M1 stage 3 follow and moderation: banners are status strips ([data-knorke-bar=banner]) with named buttons; the menu has its root hook, a named trigger and the entry hooks', () => {
	const fb = template('src/components/FollowBanner.vue')
	const froot = fb.children.find((c) => c.type === 1)
	assert.equal(val(froot, 'data-knorke-banner'), 'following')
	assert.equal(val(froot, 'data-knorke-bar'), 'banner')
	assert.equal(val(froot, 'role'), 'status')
	assert.equal(hooked(fb, 'data-knorke-action', 'follow-stop').length, 1)
	const fc = template('src/components/FollowChip.vue')
	const croot = fc.children.find((c) => c.type === 1)
	assert.ok(has(croot, 'data-knorke-follow-chip'))
	assert.equal(val(croot, 'data-knorke-bar'), 'banner')
	const btn = hooked(fc, 'data-knorke-action', 'follow-presenter')[0]
	assert.equal(btn.tag, 'button')
	assert.ok(named(btn))
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /button\.knorke-followchip,\s*button\.knorke-banner__dismiss \{\s*min-height: var\(--knorke-touch\) !important;/, 'the chip is a ≥ 44 px target')
	const mm = template('src/components/ModerationMenu.vue')
	const mroot = mm.children.find((c) => c.type === 1)
	assert.match(val(mroot, 'data-knorke-menu'), /'overflow' : 'moderation'/)
	const actions = findAll(mm, (e) => e.tag === 'NcActions')[0]
	assert.ok(has(actions, 'aria-label') && has(actions, 'force-menu'), 'always a menu trigger (aria-haspopup)')
	for (const a of ['share', 'vote-setup', 'timer-open', 'summon', 'summon-end']) {
		assert.equal(hooked(mm, 'data-knorke-action', a).length, 1, a)
	}
	const top = template('src/components/TopBar.vue')
	assert.equal(val(top.children.find((c) => c.type === 1), 'data-knorke-bar'), 'top')
	const zoom = template('src/components/ZoomControls.vue')
	const frames = hooked(zoom, 'data-knorke-action', 'frames')[0]
	assert.ok(has(frames, 'aria-label') && has(frames, 'aria-expanded') && has(frames, 'aria-controls'))
	const fl = template('src/components/FrameList.vue')
	assert.ok(findAll(fl, (e) => has(e, 'data-knorke-frame-list')).length === 1)
	const item = findAll(fl, (e) => has(e, 'data-knorke-frame'))[0]
	assert.equal(item.tag, 'button')
	assert.equal(val(item, 'type'), 'button')
})

test('M1 stage 3 board view: "Time\'s up" is a strip with a button (click closes it); the strips and the context bar share the top stack; the vote bar and panel are wired', () => {
	const ast = template('src/views/BoardView.vue')
	const tu = hooked(ast, 'data-knorke-banner', 'time_up')[0]
	assert.equal(val(tu, 'data-knorke-bar'), 'banner')
	assert.equal(val(tu, 'role'), 'status')
	assert.equal(findAll(tu, (e) => e.tag === 'button').length, 1)
	const stack = findAll(ast, (e) => val(e, 'class') === 'knorke-topstack')[0]
	assert.equal(findAll(stack, (e) => e.tag === 'ContextBar').length, 1)
	assert.equal(findAll(stack, (e) => e.tag === 'ConnectionBanner').length, 1)
	const banners = findAll(stack, (e) => val(e, 'class') === 'knorke-banners')[0]
	assert.equal(val(banners, 'aria-live'), 'polite')
	for (const tag of ['VoteBar', 'VotePanel', 'VoteStepper', 'VoteSetupDialog', 'TimerDialog', 'FollowBanner', 'FollowChip']) {
		assert.equal(findAll(ast, (e) => e.tag === tag).length, 1, tag)
	}
})

test('M1 stage 3 moderation menu: every entry closes the menu after the click (the entries change with the state)', () => {
	const mm = template('src/components/ModerationMenu.vue')
	const entries = findAll(mm, (e) => e.tag === 'NcActionButton')
	assert.equal(entries.length, 5)
	for (const e of entries) {
		assert.ok(has(e, 'close-after-click'), val(e, 'data-knorke-action'))
	}
})

test('M1 stage 3 dialogs with fields: Esc inside a field closes them (NcModal\'s Esc handler skips inputs)', () => {
	for (const f of ['src/components/VoteSetupDialog.vue', 'src/components/TimerDialog.vue']) {
		const ast = template(f)
		const body = findAll(ast, (e) => e.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'keydown' && p.modifiers?.some((m) => (m.content ?? m) === 'esc')))
		assert.equal(body.length, 1, f)
		const inputs = findAll(body[0], (e) => e.tag === 'input')
		assert.ok(inputs.length >= 1, f + ': the fields sit inside the Esc wrapper')
		assert.equal(findAll(ast, (e) => e.tag === 'input').length, inputs.length, f + ': every field')
	}
})

// ---- SPEC-M1 §6.12, §6.8 (stage 4: context menu, R19 T4-02) ------------------------------

test('M1 stage 4 context menu: role=menu root named by aria-label with its hooks; entries are type=button role=menuitem (M2 grid: menuitemcheckbox with aria-checked, the check column aria-hidden) with roving tabindex, aria-keyshortcuts and data-knorke-menu-item (never data-knorke-action); hints aria-hidden; the board view puts it next to the canvas', () => {
	const ast = template('src/components/ContextMenu.vue')
	const root = ast.children.find((c) => c.type === 1)
	assert.equal(val(root, 'role'), 'menu')
	assert.ok(has(root, 'aria-label'), 'the menu is named (Selection actions / Board actions)')
	assert.equal(val(root, 'data-knorke-menu'), 'context')
	assert.ok(has(root, 'data-knorke-menu-target') && has(root, 'data-knorke-menu-at'))
	assert.ok(root.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'keydown'), 'the APG keys are handled on the menu')
	assert.ok(root.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'contextmenu'), 'no browser menu over the open one')
	assert.equal(has(root, 'tabindex'), false, 'the root is no tab stop (roving tabindex on the entries)')
	const items = findAll(ast, (e) => e.tag === 'button')
	assert.equal(items.length, 1, 'one v-for entry')
	const b = items[0]
	assert.equal(val(b, 'type'), 'button')
	// M2 (R12): the role is bound, exactly menuitem or menuitemcheckbox (the grid entry), with a bound aria-checked
	const role = prop(b, 'role')
	assert.equal(role.type, 7, 'bound role')
	assert.deepEqual([...val(b, 'role').matchAll(/'([^']*)'/g)].map((m) => m[1]).sort(), ['menuitem', 'menuitemcheckbox'])
	assert.equal(prop(b, 'aria-checked')?.type, 7, 'bound aria-checked')
	const check = findAll(b, (e) => (val(e, 'class') ?? '') === 'knorke-contextmenu__check')
	assert.equal(check.length, 1, 'one check column')
	assert.equal(val(check[0], 'aria-hidden'), 'true', 'the check mark is not read (aria-checked says it)')
	assert.match(val(b, 'tabindex'), /active \? 0 : -1/)
	assert.ok(has(b, 'aria-keyshortcuts'))
	assert.ok(has(b, 'data-knorke-menu-item'))
	assert.equal(has(b, 'data-knorke-action'), false, 'delete and back are taken by BoardList and TopBar')
	assert.equal(has(b, 'aria-pressed'), false)
	assert.ok(named(b), 'the label is the content')
	const hint = findAll(b, (e) => (val(e, 'class') ?? '') === 'knorke-contextmenu__key')[0]
	assert.equal(val(hint, 'aria-hidden'), 'true', 'the visible hint is not read twice (aria-keyshortcuts says it)')
	// the count line of the board menu: no entry (role=menu owns menu items only), read through the root's aria-describedby
	const counts = findAll(ast, (e) => has(e, 'data-knorke-menu-count'))
	assert.equal(counts.length, 1)
	const count = counts[0]
	assert.notEqual(count.tag, 'button')
	assert.equal(val(count, 'aria-hidden'), 'true')
	assert.equal(has(count, 'tabindex'), false, 'never a tab stop')
	assert.equal(has(count, 'role'), false)
	assert.ok(!count.props.some((p) => p.type === 7 && p.name === 'on'), 'no handlers')
	assert.equal(val(count, 'id'), 'knorke-contextmenu-count')
	assert.match(val(root, 'aria-describedby'), /'knorke-contextmenu-count'/)
	assert.equal(root.children.filter((c) => c.type === 1).at(-1), count, 'after the entries')
	// board view: a sibling of .knorke-canvas inside .knorke-board, never in the scene container
	const view = template('src/views/BoardView.vue')
	const board = view.children.find((c) => c.type === 1)
	assert.equal(val(board, 'class'), 'knorke-board')
	const kids = board.children.filter((c) => c.type === 1)
	const canvas = kids.findIndex((c) => val(c, 'class') === 'knorke-canvas')
	assert.ok(canvas >= 0)
	assert.equal(kids[canvas].children.length, 0, 'nothing inside the scene container')
	const menu = kids.find((c) => c.tag === 'ContextMenu')
	assert.ok(menu, 'ContextMenu is a direct child of .knorke-board')
	assert.match(menu.props.find((p) => p.type === 7 && p.name === 'if').exp.content, /uiMode === 'edit'/, 'mode edit only')
	assert.ok(menu.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'action'))
	assert.ok(menu.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'close'))
})
