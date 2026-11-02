/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A small XML reader for foreign files (factory job 205, .bpmn), pure and
 * without DOM, so node tests run the same code as the browser.
 *
 * readXml(text) gives the tree of elements {name, attrs, children, text}:
 * name and attribute names are local names (a prefix "bpmn:" is dropped,
 * xmlns declarations are left out), text is the element's own character
 * data (CDATA included) with the entities decoded. Only the five predefined
 * entities and character references are decoded (shapeImport.js decodeXml);
 * any other entity stays as it is written, a <!DOCTYPE …> with its internal
 * subset is skipped, comments and processing instructions too. So nothing
 * is fetched and nothing expands (no XXE, no "billion laughs"). The reader
 * keeps its own stack: no recursion, however deep the elements nest.
 * Attribute values are normalised as XML says (a literal tab or line break
 * is a space; &#10; stays a line break).
 *
 * null for text that is not well-formed enough to read: no root element, a
 * tag that does not close, an end tag that does not match, a second root.
 */
import { decodeXml } from '../board/shapeImport.js'

/**
 * @typedef {{name: string, attrs: Record<string, string>, children: XmlNode[], text: string}} XmlNode
 */

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/**
 * @param {string} name qualified name
 * @return {string} its local name
 */
function localName(name) {
	const i = name.indexOf(':')
	return i < 0 ? name : name.slice(i + 1)
}

/**
 * @param {string} s text
 * @param {number} from index of the '<' of a tag
 * @return {number} the index of the '>' that ends it outside quotes, -1 when none
 */
function tagEnd(s, from) {
	let quote = ''
	for (let i = from + 1; i < s.length; i++) {
		const c = s[i]
		if (quote !== '') {
			if (c === quote) quote = ''
		} else if (c === '"' || c === "'") {
			quote = c
		} else if (c === '>') {
			return i
		}
	}
	return -1
}

/**
 * @param {string} s text
 * @param {number} from index of the '<' of "<!DOCTYPE"
 * @return {number} the index of the '>' that ends it (quotes, comments and the internal subset [...] skipped), -1 when none
 */
function doctypeEnd(s, from) {
	let quote = ''
	let depth = 0
	for (let i = from + 2; i < s.length; i++) {
		const c = s[i]
		if (quote !== '') {
			if (c === quote) quote = ''
		} else if (c === '"' || c === "'") {
			quote = c
		} else if (c === '<' && s.startsWith('<!--', i)) {
			const e = s.indexOf('-->', i + 4)
			if (e < 0) return -1
			i = e + 2
		} else if (c === '[') {
			depth++
		} else if (c === ']') {
			depth = Math.max(0, depth - 1)
		} else if (c === '>' && depth === 0) {
			return i
		}
	}
	return -1
}

/**
 * @param {string} body the tag between its name and its end
 * @return {Record<string, string>} the attributes by local name (xmlns left out; the first of two equal names wins)
 */
function readAttrs(body) {
	const out = Object.create(null)
	ATTR_RE.lastIndex = 0
	let m
	while ((m = ATTR_RE.exec(body)) !== null) {
		const q = m[1]
		if (q === 'xmlns' || q.startsWith('xmlns:')) continue
		const name = localName(q)
		if (name in out) continue
		out[name] = decodeXml((m[2] ?? m[3]).replace(/[\t\n\r]/g, ' '))
	}
	return out
}

/**
 * Reads XML text (see the file comment).
 *
 * @param {unknown} text the file's text
 * @return {XmlNode|null} the root element, null when it cannot be read
 */
export function readXml(text) {
	if (typeof text !== 'string') return null
	const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
	const stack = []
	let root = null
	let i = 0
	const n = s.length
	while (i < n) {
		const lt = s.indexOf('<', i)
		const end = lt < 0 ? n : lt
		if (end > i) {
			if (stack.length > 0) {
				stack[stack.length - 1].text += decodeXml(s.slice(i, end))
			} else if (s.slice(i, end).trim() !== '') {
				// character data outside the root
				return null
			}
		}
		if (lt < 0) break
		if (s.startsWith('<!--', lt)) {
			const e = s.indexOf('-->', lt + 4)
			if (e < 0) return null
			i = e + 3
		} else if (s.startsWith('<![CDATA[', lt)) {
			const e = s.indexOf(']]>', lt + 9)
			if (e < 0 || stack.length === 0) return null
			stack[stack.length - 1].text += s.slice(lt + 9, e)
			i = e + 3
		} else if (s.startsWith('<?', lt)) {
			const e = s.indexOf('?>', lt + 2)
			if (e < 0) return null
			i = e + 2
		} else if (s.startsWith('<!', lt)) {
			const e = doctypeEnd(s, lt)
			if (e < 0) return null
			i = e + 1
		} else if (s[lt + 1] === '/') {
			const e = s.indexOf('>', lt + 2)
			if (e < 0 || stack.length === 0) return null
			const name = localName(s.slice(lt + 2, e).trim())
			const top = stack.pop()
			if (top.name !== name) return null
			i = e + 1
		} else {
			const e = tagEnd(s, lt)
			if (e < 0) return null
			const self = s[e - 1] === '/'
			const inner = s.slice(lt + 1, self ? e - 1 : e)
			const m = /^[^\s/>]+/.exec(inner)
			if (!m) return null
			const node = { name: localName(m[0]), attrs: readAttrs(inner.slice(m[0].length)), children: [], text: '' }
			if (stack.length > 0) {
				stack[stack.length - 1].children.push(node)
			} else if (root === null) {
				root = node
			} else {
				return null
			}
			if (!self) stack.push(node)
			i = e + 1
		}
	}
	return root !== null && stack.length === 0 ? root : null
}

/**
 * Every element of a tree, parents before their children, without recursion.
 *
 * @param {XmlNode} root root element
 * @param {(node: XmlNode, parent: (XmlNode|null)) => void} fn called per element
 */
export function walkXml(root, fn) {
	const todo = [[root, null]]
	while (todo.length > 0) {
		const [node, parent] = todo.pop()
		fn(node, parent)
		for (let k = node.children.length - 1; k >= 0; k--) todo.push([node.children[k], node])
	}
}

/**
 * @param {XmlNode|null|undefined} node element
 * @param {string} name local name
 * @return {XmlNode|null} its first child of that name
 */
export function childOf(node, name) {
	return node?.children.find((c) => c.name === name) ?? null
}

/**
 * @param {XmlNode|null|undefined} node element
 * @param {string} name local name
 * @return {XmlNode[]} its children of that name
 */
export function childrenOf(node, name) {
	return node ? node.children.filter((c) => c.name === name) : []
}
