/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 251 AK4: pictures (data.img, shape libraries, also SVG) are
 * only ever drawn as images (Image.src, <img :src>, <image> in the SVG
 * export), never opened as documents. The server's SVG check
 * (lib/Service/ShapeImage.php) is a block list that is only safe under
 * that rule, so this guard fails as soon as src/ gains a sink that renders
 * markup or opens a document: <iframe>, <object>, <embed>, srcdoc, v-html,
 * innerHTML, outerHTML, insertAdjacentHTML, document.write, window.open;
 * DOMParser only in board/clipboard.js (text/html, an inert document) and
 * URL.createObjectURL only in util/download.js.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../../../', import.meta.url).pathname
const SRC = join(ROOT, 'src')

/** Code without comments (block, line, HTML); a // inside a URL (after ":") stays. */
function code(text) {
	return text
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
}

const SINKS = [
	[/<iframe\b/i, '<iframe>'],
	[/<object\b/i, '<object>'],
	[/<embed\b/i, '<embed>'],
	[/\bsrcdoc\b/i, 'srcdoc'],
	[/\bv-html\b/, 'v-html'],
	[/\binnerHTML\b/, 'innerHTML'],
	[/\bouterHTML\b/, 'outerHTML'],
	[/\binsertAdjacentHTML\b/, 'insertAdjacentHTML'],
	[/\bdocument\s*\.\s*write(ln)?\b/, 'document.write'],
	[/\bwindow\s*\.\s*open\s*\(/, 'window.open'],
]

/**
 * @param {string} path path below src/
 * @param {string} text source
 * @return {string[]} the forbidden sinks found
 */
function sinksOf(path, text) {
	const c = code(text)
	const out = SINKS.filter(([re]) => re.test(c)).map(([, name]) => name)
	if (/\bDOMParser\b/.test(c) && (path !== 'board/clipboard.js' || /parseFromString\([^)]*['"](?!text\/html['"])[^'"]*['"]\s*\)/.test(c))) out.push('DOMParser')
	if (/\bcreateObjectURL\b/.test(c) && path !== 'util/download.js') out.push('createObjectURL')
	return out
}

function files(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name)
		return e.isDirectory() ? files(p) : /\.(js|mjs|vue)$/.test(e.name) ? [p] : []
	})
}

test('AK4 no source in src/ renders markup or opens a document (pictures stay images)', () => {
	const all = files(SRC)
	assert.ok(all.length > 100, 'the sources were found')
	const found = all.map((p) => [relative(SRC, p), sinksOf(relative(SRC, p), readFileSync(p, 'utf8'))]).filter(([, s]) => s.length > 0)
	assert.deepEqual(found, [])
})

test('AK4 the guard catches each sink (counter-check), comments and URLs do not count', () => {
	assert.deepEqual(sinksOf('x.js', 'el.innerHTML = svg'), ['innerHTML'])
	assert.deepEqual(sinksOf('x.vue', '<template><iframe :src="uri" /></template>'), ['<iframe>'])
	assert.deepEqual(sinksOf('x.vue', '<div v-html="t" />'), ['v-html'])
	assert.deepEqual(sinksOf('x.js', 'window.open(uri)'), ['window.open'])
	assert.deepEqual(sinksOf('x.js', 'new DOMParser().parseFromString(s, "text/html")'), ['DOMParser'], 'only clipboard.js')
	assert.deepEqual(sinksOf('board/clipboard.js', "new DOMParser().parseFromString(s, 'image/svg+xml')"), ['DOMParser'], 'never as SVG')
	assert.deepEqual(sinksOf('board/clipboard.js', "new DOMParser().parseFromString(html, 'text/html')"), [])
	assert.deepEqual(sinksOf('x.js', 'URL.createObjectURL(b)'), ['createObjectURL'])
	assert.deepEqual(sinksOf('util/download.js', 'URL.createObjectURL(b)'), [])
	assert.deepEqual(sinksOf('x.js', '/* innerHTML */ // window.open(\nconst u = "https://x/y"'), [])
	assert.deepEqual(sinksOf('x.vue', '<!-- <iframe> --><img :src="uri">'), [])
})

test('AK4 the picture cache draws a URI only through Image.src', () => {
	const c = code(readFileSync(join(SRC, 'scene/imageCache.js'), 'utf8'))
	assert.match(c, /img\.src = uri/)
})
