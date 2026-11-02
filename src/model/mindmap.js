/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Mind maps (factory job 195): the data form, the tree, the layout, the op
 * builders, the limits and the indented list in and out. Pure; the server's
 * mirror of checkMindmap is lib/Service/Mindmaps.php, and
 * tests/fixtures/mindmap-golden.json pins both sides.
 *
 * data of a mind map:
 *   nodes  {"b<z>": {"n<8>": {o, p?, c?, s?, f?, d?}}}, 1–MM_MAX_NODES nodes
 *   texts  {"b<z>": {"n<8>": "text"}}, optional; a text needs its node
 * A node key matches NODE_KEY_RE and is random; its pot ("bucket") is "b"
 * plus its second character (bucketOf), so no map holds more than the 100
 * keys of the wire rule. The text lives beside the node, not in it (like a
 * table's cells beside its rows): a node's creation and its first text are
 * two paths that never nest, so undo can take them back part by part.
 *   o  order among the siblings (z key: by o in byte order, then the key)
 *   p  the parent's key; exactly one node has none: the centre (root)
 *   c  colour #rrggbb (lower case): the branch colour, at the root its border
 *   s  shape (MM_SHAPES); without one the root is roundRect, any other line
 *   f  true: folded (its children are hidden); no effect at the root
 *   d  'l': a main branch on the left (only children of the root, layout both;
 *      org and tree, job 198, keep it stored and lay out like right)
 *   m  [u, v] (job 196): placed freely, never at the root; the centre of
 *      its box lies at the root's centre + (s·u, v), s its side (1 right,
 *      -1 left), so "Right only" mirrors it with its branch; |u| and |v|
 *      at most MM_PLACE_MAX
 * A text is cleaned like data.text and has 1–MM_TEXT_MAX code points; an
 * empty one is absent (the client sends null instead of "").
 *
 * Layout (mindmapLayout, all sizes in world units): text MM_FONT, the root
 * MM_ROOT_FONT bold, wrapped at MM_WRAP (root MM_ROOT_WRAP); padding per
 * kind (MM_PAD); children MM_GAP_X beside the outer edge of their parent;
 * sibling subtrees MM_GAP_Y apart, main branches MM_MAIN_GAP_Y; a node
 * centred on the block of its visible children; the right and the left main
 * branches each one block centred on the root, the left side mirrored. The
 * text size comes from a measure function (the scene measures with Konva;
 * estimateNodeSize is the deterministic stand-in for tests and a scene
 * without a renderer). The result is relative to the top-left corner of the
 * hull of every visible node and fold dot: the item's box.
 *
 * Op builders give {p, inv} (patch and inverse patch, path → value, plus
 * key for a new node) or {error: 'nodes'|'gone'|'root'|'same'|'bytes'};
 * deleteBranch, and (job 196) moveNode, placeNode and rearrange beyond
 * MM_PATCH_PATHS paths, give {patches, inverse}; withBox() adds x, y, parent, w and h of the changed mind map when its
 * hull or its root moved (the root keeps its place in the world).
 */
import { LINE_HEIGHT, MM_COLORS, MM_INK_BORDER, PALETTE, STRONG, TEXT_COLOR, nearestColor, shownColor } from './tokens.js'
import { applyPatch } from './paths.js'
import { cmpBytes, isValidKey, keyBetween } from './zorder.js'

/** Most nodes of a mind map, most code points of one node's text. */
export const MM_MAX_NODES = 500
export const MM_TEXT_MAX = 1000
/** Most keys of one map (the wire rule, PathOps::isWireValue). */
export const MM_BUCKET_MAX = 100
/** Most paths of one patch (Limits::MAX_PATCH_PATHS). */
export const MM_PATCH_PATHS = 50
/** The server's MAX_ITEM_BYTES (limits.maxItemBytes when the initial state has none). */
export const MM_MAX_BYTES = 65536
/** Text: size, the root's size (bold), wrap width, the root's wrap width (world units). */
export const MM_FONT = 16
export const MM_ROOT_FONT = 20
export const MM_WRAP = 240
export const MM_ROOT_WRAP = 280
/** Padding [x, y] of a node on a line, of a box, of the root. */
export const MM_PAD = Object.freeze({ line: Object.freeze([6, 4]), box: Object.freeze([12, 8]), root: Object.freeze([16, 12]) })
/** Least width of a node and of the root. */
export const MM_MIN_W = 40
export const MM_ROOT_MIN_W = 120
/** Gap between a parent's outer edge and its children; between sibling subtrees; between main branches. */
export const MM_GAP_X = 40
export const MM_GAP_Y = 10
export const MM_MAIN_GAP_Y = 20
/** Radius of a fold dot. */
export const MM_DOT_R = 7
/** Line width of a main branch, of a deeper one; the border of a box. */
export const MM_MAIN_W = 3
export const MM_BRANCH_W = 2
export const MM_BORDER_W = 2
/** Corner radius of roundRect. */
export const MM_RADIUS = 8
/** The forms of a node and the values of style.layout. */
export const MM_SHAPES = Object.freeze(['line', 'rect', 'roundRect', 'pill'])
export const MM_LAYOUTS = Object.freeze(['both', 'right', 'org', 'tree'])
/** Job 198, layout org: a card's wrap width, least width and colour band; the gap between sibling subtrees and between rows. */
export const MM_CARD_WRAP = 200
export const MM_CARD_MIN_W = 120
export const MM_CARD_BAND = 6
export const MM_ORG_GAP_X = 20
export const MM_ORG_GAP_Y = 40
/** Job 266 (design round 4, M3/O1): corner radius of the root without a stored shape; a card's role size. */
export const MM_ROOT_RADIUS = 16
export const MM_ROLE_FONT = 14
/** Job 266: width at the start and the end of a tapering branch to depth 1, 2 and 3 or deeper. */
export const MM_TAPER = Object.freeze([Object.freeze([6.4, 3.2]), Object.freeze([3.6, 1.6]), Object.freeze([1.8, 1.2])])
/** Job 266: the "+n" badge of a folded branch: height, its gap to the node (org: below the card), side padding, font size. */
export const MM_BADGE_H = 20
export const MM_BADGE_GAP = 8
export const MM_BADGE_ORG_GAP = 4
export const MM_BADGE_PAD = 7
export const MM_BADGE_FONT = 12
/** Job 266: a "+" that would cover a node's text steps this far, at most this often (clearPlus). */
export const MM_PLUS_STEP = 4
export const MM_PLUS_STEPS = 30
/** Job 266: corner radius of the bends of an org or tree line. */
export const MM_LINE_BEND = 10
/** Farthest a node placed freely lies from the root's centre, per axis (job 196). */
export const MM_PLACE_MAX = 20000

export const NODE_KEY_RE = /^n[0-9a-z]{8}$/
export const BUCKET_RE = /^b[0-9a-z]$/
const COLOR_RE = /^#[0-9a-f]{6}$/
const NODE_FIELDS = new Set(['o', 'p', 'c', 's', 'f', 'd', 'm'])
const DATA_KEYS = new Set(['nodes', 'texts'])
const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
// C0 controls except \t and \n (the cleaning of data.text, registry.js cleanText)
const CONTROL_RE = /[\x00-\x08\x0B-\x1F]/g

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * @param {string} key node key
 * @return {string} its pot "b<second character>"
 */
export function bucketOf(key) {
	return 'b' + String(key).charAt(1)
}

/**
 * @param {string} key node key
 * @return {string} the patch path of the node data.nodes.<pot>.<key>
 */
export function nodePath(key) {
	return 'data.nodes.' + bucketOf(key) + '.' + key
}

/**
 * @param {string} key node key
 * @return {string} the patch path of its text data.texts.<pot>.<key>
 */
export function textPath(key) {
	return 'data.texts.' + bucketOf(key) + '.' + key
}

/**
 * @param {unknown} path patch path
 * @return {string|null} the node key of a path data.texts.<pot>.<key>, else null
 */
export function nodeOfTextPath(path) {
	if (typeof path !== 'string' || !path.startsWith('data.texts.')) return null
	const parts = path.split('.')
	return parts.length === 4 && BUCKET_RE.test(parts[2]) && NODE_KEY_RE.test(parts[3]) && bucketOf(parts[3]) === parts[2] ? parts[3] : null
}

/**
 * The cleaning of data.text: "\r\n" → "\n", C0 controls except \t and \n
 * removed, well-formed UTF-16.
 *
 * @param {unknown} v value
 * @return {{s: string, n: number}|null} the cleaned text and its code points, null for no string or a lone surrogate
 */
function cleaned(v) {
	if (typeof v !== 'string') return null
	const s = v.replace(/\r\n/g, '\n').replace(CONTROL_RE, '')
	let n = 0
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		if (c >= 0xd800 && c <= 0xdbff) {
			const d = s.charCodeAt(i + 1)
			if (!(d >= 0xdc00 && d <= 0xdfff)) return null
			i++
		} else if (c >= 0xdc00 && c <= 0xdfff) {
			return null
		}
		n++
	}
	return { s, n }
}

/**
 * The verdict of the server (Mindmaps::check) on the data of a mind map:
 * the form above, no further keys at any level, every node in its pot,
 * exactly one root, every p an existing other key, every p chain ends at
 * the root (no cycle), every text 1–MM_TEXT_MAX code points on an existing
 * node.
 *
 * @param {unknown} data data of a mind map item
 * @return {boolean}
 */
export function checkMindmap(data) {
	if (!isMap(data)) return false
	for (const k of Object.keys(data)) {
		if (!DATA_KEYS.has(k)) return false
	}
	if (!isMap(data.nodes)) return false
	const nodes = new Map()
	for (const b of Object.keys(data.nodes)) {
		const pot = data.nodes[b]
		if (!BUCKET_RE.test(b) || !isMap(pot) || Object.keys(pot).length === 0 || Object.keys(pot).length > MM_BUCKET_MAX) return false
		for (const key of Object.keys(pot)) {
			const n = pot[key]
			if (!NODE_KEY_RE.test(key) || bucketOf(key) !== b || !isMap(n)) return false
			for (const f of Object.keys(n)) {
				if (!NODE_FIELDS.has(f)) return false
			}
			if (!isValidKey(n.o)) return false
			if (hasOwn(n, 'p') && (typeof n.p !== 'string' || !NODE_KEY_RE.test(n.p) || n.p === key)) return false
			if (hasOwn(n, 'c') && (typeof n.c !== 'string' || !COLOR_RE.test(n.c))) return false
			if (hasOwn(n, 's') && !MM_SHAPES.includes(n.s)) return false
			if (hasOwn(n, 'f') && n.f !== true) return false
			if (hasOwn(n, 'd') && n.d !== 'l') return false
			if (hasOwn(n, 'm') && (!hasOwn(n, 'p') || placeOf(n) === null)) return false
			nodes.set(key, n)
		}
	}
	if (nodes.size < 1 || nodes.size > MM_MAX_NODES) return false
	let roots = 0
	for (const n of nodes.values()) {
		if (!hasOwn(n, 'p')) roots++
		else if (!nodes.has(n.p)) return false
	}
	if (roots !== 1) return false
	// every chain reaches the root: walk up with a memo of the keys known to reach it
	const ok = new Set()
	for (const key of nodes.keys()) {
		const path = []
		let k = key
		while (!ok.has(k)) {
			const n = nodes.get(k)
			if (!hasOwn(n, 'p')) break
			path.push(k)
			if (path.length > nodes.size) return false
			k = n.p
		}
		for (const x of path) ok.add(x)
		ok.add(k)
	}
	if (!hasOwn(data, 'texts')) return true
	if (!isMap(data.texts)) return false
	for (const b of Object.keys(data.texts)) {
		const pot = data.texts[b]
		if (!BUCKET_RE.test(b) || !isMap(pot) || Object.keys(pot).length === 0) return false
		for (const key of Object.keys(pot)) {
			if (bucketOf(key) !== b || !nodes.has(key)) return false
			const t = cleaned(pot[key])
			if (t === null || t.n < 1 || t.n > MM_TEXT_MAX) return false
		}
	}
	return true
}

/**
 * @param {unknown} n node
 * @return {number[]|null} its free place [u, v] (job 196) when it has one of the form, else null
 */
export function placeOf(n) {
	const m = isMap(n) ? n.m : null
	if (!Array.isArray(m) || m.length !== 2) return null
	return m.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MM_PLACE_MAX) ? m : null
}

/**
 * @param {unknown} data data of a mind map
 * @return {Map<string, object>} key → node of every entry that has the form of a node (nothing else checked)
 */
export function nodesOf(data) {
	const out = new Map()
	const nodes = isMap(data) && isMap(data.nodes) ? data.nodes : {}
	for (const b of Object.keys(nodes)) {
		const pot = nodes[b]
		if (!BUCKET_RE.test(b) || !isMap(pot)) continue
		for (const key of Object.keys(pot)) {
			if (NODE_KEY_RE.test(key) && bucketOf(key) === b && isMap(pot[key]) && typeof pot[key].o === 'string') out.set(key, pot[key])
		}
	}
	return out
}

/**
 * @param {unknown} data data of a mind map
 * @param {string} key node key
 * @return {string} its text ('' when empty)
 */
export function nodeText(data, key) {
	const texts = isMap(data) && isMap(data.texts) ? data.texts : null
	const pot = texts && isMap(texts[bucketOf(key)]) ? texts[bucketOf(key)] : null
	const v = pot && hasOwn(pot, key) ? pot[key] : null
	return typeof v === 'string' ? v : ''
}

/**
 * @param {{o: string, key: string}} a sibling
 * @param {{o: string, key: string}} b sibling
 * @return {number} the order of siblings: o like z, then the key
 */
function byOrder(a, b) {
	return cmpBytes(a.o, b.o) || cmpBytes(a.key, b.key)
}

/**
 * The tree of a mind map as far as it holds: the root (the first node
 * without p in key order), every node reachable from it, children in order.
 * Nodes of a broken form (a second root, an orphan, a cycle) are left out.
 *
 * @param {object} item mind map item
 * @return {{root: (string|null), nodes: Map<string, {key: string, n: object, parent: (string|null), kids: string[], depth: number}>, layout: ('both'|'right'|'org'|'tree')}}
 */
export function mindTree(item) {
	const all = nodesOf(item?.data)
	const layout = MM_LAYOUTS.includes(item?.style?.layout) ? item.style.layout : 'both'
	const roots = [...all.keys()].filter((k) => typeof all.get(k).p !== 'string').sort(cmpBytes)
	const nodes = new Map()
	if (roots.length === 0) return { root: null, nodes, layout }
	const kidsOf = new Map()
	for (const [key, n] of all) {
		if (typeof n.p !== 'string' || n.p === key) continue
		if (!kidsOf.has(n.p)) kidsOf.set(n.p, [])
		kidsOf.get(n.p).push({ key, o: n.o })
	}
	const root = roots[0]
	const stack = [[root, null, 0]]
	while (stack.length > 0) {
		const [key, parent, depth] = stack.pop()
		if (nodes.has(key)) continue
		const kids = (kidsOf.get(key) ?? []).sort(byOrder).map((x) => x.key).filter((k) => !nodes.has(k))
		nodes.set(key, { key, n: all.get(key), parent, kids, depth })
		for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], key, depth + 1])
	}
	return { root, nodes, layout }
}

/**
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {string} key a child of the root
 * @return {1|-1} its side: -1 left (d 'l' with layout both), else 1
 */
function mainSide(tree, key) {
	return tree.layout === 'both' && tree.nodes.get(key)?.n.d === 'l' ? -1 : 1
}

/**
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {string} key node
 * @return {1|-1|0} the side of a node: 0 the root, else the side of its main branch
 */
export function sideOf(tree, key) {
	let e = tree.nodes.get(key)
	if (!e || e.parent === null) return 0
	while (e.parent !== tree.root) e = tree.nodes.get(e.parent)
	return mainSide(tree, e.key)
}

/**
 * The siblings a node stands among in the layout: the children of its
 * parent, for a main branch with layout both those of its side.
 *
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {string} key node
 * @return {string[]} in order (the node included); [] for the root
 */
export function rowOf(tree, key) {
	const e = tree.nodes.get(key)
	if (!e || e.parent === null) return []
	const kids = tree.nodes.get(e.parent).kids
	if (e.parent !== tree.root || tree.layout === 'right') return kids
	const side = mainSide(tree, key)
	return kids.filter((k) => mainSide(tree, k) === side)
}

/**
 * @param {boolean} root the root
 * @param {number} [depth] its depth (0 the root)
 * @param {string} [layout] the layout of its mind map
 * @return {string} the shape a node without s has (stored as none): roundRect at the root, (job 266, M3) pill for
 *   a main branch of the mind map layouts both and right, line elsewhere
 */
export function defaultShape(root, depth = root ? 0 : 2, layout = 'both') {
	return root ? 'roundRect' : depth === 1 && !isBoxLayout(layout) ? 'pill' : 'line'
}

/**
 * @param {object} n node
 * @param {boolean} root the root
 * @param {number} [depth] its depth
 * @param {string} [layout] the layout of its mind map
 * @return {string} its shape (MM_SHAPES): the stored one, else defaultShape
 */
export function shapeOfNode(n, root, depth, layout) {
	return MM_SHAPES.includes(n?.s) ? n.s : defaultShape(root, depth, layout)
}

/**
 * @param {string} layout a layout of MM_LAYOUTS
 * @return {boolean} (job 198) org or tree: boxes on right-angled lines, nothing placed freely
 */
export function isBoxLayout(layout) {
	return layout === 'org' || layout === 'tree'
}

/**
 * @param {object} n node
 * @param {boolean} root the root
 * @param {string} layout the layout of its mind map
 * @param {number} [depth] its depth (0 the root)
 * @return {string} the shape it is drawn with: shapeOfNode, but (job 198) in org and tree line is drawn as roundRect
 */
export function drawnShape(n, root, layout, depth = root ? 0 : 2) {
	const s = shapeOfNode(n, root, depth, layout)
	return s === 'line' && isBoxLayout(layout) ? 'roundRect' : s
}

/**
 * @param {string} text a node's text
 * @return {{name: string, role: string}} (job 198) an org chart card: the text up to the first line break, and the rest
 */
export function cardLines(text) {
	const s = String(text)
	const i = s.indexOf('\n')
	return i < 0 ? { name: s, role: '' } : { name: s.slice(0, i), role: s.slice(i + 1) }
}

/**
 * Deterministic size of a node's text (tests, a scene without a renderer):
 * greedy word wrap with glyphs of 0.55 (bold 0.6) × the font size, words
 * longer than a line broken, one line per paragraph at least.
 *
 * @param {string} text text
 * @param {number} maxW wrap width
 * @param {number} size font size
 * @param {boolean} bold bold
 * @return {{w: number, h: number}} width of the longest line (at most maxW) and lines × size × LINE_HEIGHT
 */
export function estimateNodeSize(text, maxW, size, bold) {
	const glyph = size * (bold ? 0.6 : 0.55)
	const per = Math.max(1, Math.floor(Math.max(1, maxW) / glyph))
	let lines = 0
	let widest = 0
	for (const para of String(text).split('\n')) {
		let cur = 0
		lines++
		for (const word of para.split(' ')) {
			let len = Array.from(word).length
			if (cur > 0 && cur + 1 + len > per) {
				widest = Math.max(widest, cur)
				lines++
				cur = 0
			} else if (cur > 0) {
				cur++
			}
			while (len > per) {
				widest = per
				lines++
				len -= per
			}
			cur += len
		}
		widest = Math.max(widest, cur)
	}
	return { w: Math.min(maxW, widest * glyph), h: lines * size * LINE_HEIGHT }
}

/**
 * The colour of each main branch without c: MM_COLORS by its place among
 * all children of the root (in order), cycling; (job 227) a stored c is
 * drawn through tokens.shownColor.
 *
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {string} key a node
 * @return {string} its branch colour (the root: its border colour)
 */
function colorOf(tree, key) {
	let e = tree.nodes.get(key)
	if (!e) return TEXT_COLOR
	if (e.parent === null) return typeof e.n.c === 'string' && COLOR_RE.test(e.n.c) ? shownColor(e.n.c) : TEXT_COLOR
	while (e.parent !== null) {
		if (typeof e.n.c === 'string' && COLOR_RE.test(e.n.c)) return shownColor(e.n.c)
		if (e.parent === tree.root) break
		e = tree.nodes.get(e.parent)
	}
	const i = tree.nodes.get(tree.root).kids.indexOf(e.key)
	return MM_COLORS[(i < 0 ? 0 : i) % MM_COLORS.length]
}

/**
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {string} key node
 * @return {number} how many nodes lie below it
 */
function descendants(tree, key) {
	let n = 0
	const stack = [...(tree.nodes.get(key)?.kids ?? [])]
	while (stack.length > 0) {
		const k = stack.pop()
		n++
		stack.push(...(tree.nodes.get(k)?.kids ?? []))
	}
	return n
}

/**
 * The layout of a mind map (see the file comment).
 *
 * @param {object} item mind map item (data, style)
 * @param {(text: string, maxW: number, size: number, bold: boolean) => {w: number, h: number}} [measure] text size
 * @param {{key: string, text: string}|null} [preview] the text of one node as the open editor shows it
 * @return {{root: (string|null), layout: string, w: number, h: number, nodes: object[], byKey: Map<string, object>}}
 *   nodes in the order of the outline (root, right block, left block, each subtree depth first), every
 *   visible node {key, parent, depth, side, x, y, w, h, shape, color, width, folded, kids, count, text, font, bold,
 *   padX, padY, attach: {x, y}, inner: ({x, y}|null), dot: ({x, y}|null), free} relative to the hull's corner
 *
 * Job 196: a visible node with m is free (free: true). It stands at its
 * place and takes no room in its parent's row; the nodes below it that are
 * not free form its group, laid out beside it as usual, its block of
 * children centred on it. Then every node Knorke lays out moves down out
 * of the way (pushDown): those of the free groups below every free node
 * and the root, then those of the root's group, per side, below every free
 * node and every node of a free group. The root and free nodes never move.
 * A node being dragged (mmGhost, previewMindmap) keeps the room it had in
 * its row, on its old side, and its branch is no obstacle: the rest stays
 * as it is drawn.
 *
 * Job 198: in org and tree (isBoxLayout) no node is free and every node is
 * a box (drawnShape); tree is the geometry of right. In org every node, the
 * root too, is a card (MM_FONT; its name, the first line of its text, bold
 * and its role, the rest, below it, after a band of MM_CARD_BAND; wrapped at
 * MM_CARD_WRAP, at least MM_CARD_MIN_W wide); the children of a node stand
 * side by side in order, their block centred below it, MM_ORG_GAP_X between
 * sibling subtrees; the cards of one depth share a row, each row
 * MM_ORG_GAP_Y below the lowest card of the row above. Org nodes also carry
 * name, role and nameH (else null).
 *
 * Job 266 (design round 4, M3 and O1): a main branch drawn as a pill is
 * main (bold, fill its light tone, no border); every node carries band
 * ('top' org, 'left' tree, else null) and border (null for a main pill).
 * Tree cards are cards like org's (the band widens them). A folded node
 * has badge {x, y, w, h}, the "+n" (beyond the outer edge, org: below the
 * card) and its dot is the badge's middle; the hull holds the badge.
 */
export function mindmapLayout(item, measure = estimateNodeSize, preview = null) {
	const tree = mindTree(item)
	const out = { root: tree.root, layout: tree.layout, w: 0, h: 0, nodes: [], byKey: new Map() }
	if (tree.root === null) return out
	const org = tree.layout === 'org'
	const boxes = isBoxLayout(tree.layout)
	const sizes = new Map()
	const visible = (key) => {
		const e = tree.nodes.get(key)
		return e.n.f === true && e.parent !== null ? [] : e.kids
	}
	const sizeOf = (key) => {
		let s = sizes.get(key)
		if (s) return s
		const e = tree.nodes.get(key)
		const root = e.parent === null
		const shape = drawnShape(e.n, root, tree.layout, e.depth)
		const text = preview && preview.key === key && typeof preview.text === 'string' ? preview.text : nodeText(item.data, key)
		if (boxes) {
			// job 198: a card, its name bold over its role; job 266 (O1): the role MM_ROLE_FONT, tree cards too, with
			// their band on the left (it widens the card, the text stays centred right of it)
			const { name, role } = cardLines(text)
			const [px, py] = MM_PAD.box
			const mn = name === '' ? null : measure(name, MM_CARD_WRAP, MM_FONT, true)
			const mr = role === '' ? null : measure(role, MM_CARD_WRAP, MM_ROLE_FONT, false)
			const nameH = Number.isFinite(mn?.h) && mn.h > 0 ? mn.h : MM_FONT * LINE_HEIGHT
			const roleH = role === '' ? 0 : Number.isFinite(mr?.h) && mr.h > 0 ? mr.h : MM_ROLE_FONT * LINE_HEIGHT
			const tw = Math.max(Number.isFinite(mn?.w) ? Math.max(0, mn.w) : 0, Number.isFinite(mr?.w) ? Math.max(0, mr.w) : 0)
			const bandW = org ? 0 : MM_CARD_BAND
			const w = Math.max(MM_CARD_MIN_W, tw + 2 * px) + bandW
			const h = (org ? MM_CARD_BAND : 0) + nameH + roleH + 2 * py
			s = {
				w: shape === 'pill' ? Math.max(w, h + 2 * px) : w, h, shape, text, font: MM_FONT, bold: false, padX: px, padY: py, name, role, nameH,
				band: org ? 'top' : 'left', main: false,
			}
			sizes.set(key, s)
			return s
		}
		// job 266 (M3): a main branch drawn as a pill is the main pill, bold
		const main = e.depth === 1 && shape === 'pill'
		const bold = root || main
		const font = root ? MM_ROOT_FONT : MM_FONT
		const [px, py] = root ? MM_PAD.root : shape === 'line' ? MM_PAD.line : MM_PAD.box
		const m = measure(text, root ? MM_ROOT_WRAP : MM_WRAP, font, bold)
		const tw = Number.isFinite(m?.w) ? Math.max(0, m.w) : 0
		const th = Number.isFinite(m?.h) && m.h > 0 ? m.h : font * LINE_HEIGHT
		const w = Math.max(root ? MM_ROOT_MIN_W : MM_MIN_W, tw + 2 * px)
		const h = th + 2 * py
		s = { w: shape === 'pill' ? Math.max(w, h + 2 * px) : w, h, shape, text, font, bold, padX: px, padY: py, band: null, main }
		sizes.set(key, s)
		return s
	}
	// job 196: a node with m (never the root) is free: it stands at its place and takes no room in its row; a node
	// being dragged (mmGhost) keeps the room it had in its row (room: it was not free), on its old side
	// job 198: in org and tree nothing is free (m stays stored for the mind map)
	const placeAt = (key) => (boxes || tree.nodes.get(key).parent === null ? null : placeOf(tree.nodes.get(key).n))
	const ghost = isMap(item.mmGhost) && tree.nodes.has(item.mmGhost.key) ? item.mmGhost : null
	const roomKey = ghost?.room === true ? ghost.key : null
	const takesRoom = (k) => placeAt(k) === null || k === roomKey
	const rowKids = (key) => visible(key).filter(takesRoom)
	const heights = new Map()
	const gapOf = (parent) => (parent === tree.root ? MM_MAIN_GAP_Y : MM_GAP_Y)
	const blockH = (keys, parent) => keys.reduce((sum, k) => sum + subH(k), 0) + gapOf(parent) * Math.max(0, keys.length - 1)
	const subH = (key) => {
		let h = heights.get(key)
		if (h !== undefined) return h
		const kids = rowKids(key)
		h = Math.max(sizeOf(key).h, kids.length > 0 ? blockH(kids, key) : 0)
		heights.set(key, h)
		return h
	}
	const placed = []
	// the nodes Knorke lays out, in outline order: those of the root per side, and per free node those below it
	const rootGroup = new Map([[1, []], [-1, []]])
	const freeGroups = []
	const attachOf = (node, side) => {
		const x = side > 0 ? node.x + node.w : node.x
		return { x, y: node.shape === 'line' && node.parent !== null ? node.y + node.h : node.y + node.h / 2 }
	}
	const makeNode = (key, parent, depth, side, x, y) => {
		const s = sizeOf(key)
		const e = tree.nodes.get(key)
		const node = {
			key, parent, depth, side, w: s.w, h: s.h, x, y,
			shape: s.shape, color: colorOf(tree, key), width: depth === 1 ? MM_MAIN_W : MM_BRANCH_W,
			folded: e.n.f === true && e.kids.length > 0, kids: e.kids.length, count: 0, text: s.text, font: s.font, bold: s.bold,
			padX: s.padX, padY: s.padY, attach: null, inner: null, dot: null, free: false,
			name: s.name ?? null, role: s.role ?? null, nameH: s.nameH ?? null, band: s.band, main: s.main, fill: null, badge: null, border: null,
		}
		// job 266: a main pill on its light tone without border, a card's border dark, any other box in its colour
		if (node.main) node.fill = lightOf(node.color)
		node.border = boxes ? MM_INK_BORDER : node.main ? null : node.color
		node.count = node.folded ? descendants(tree, key) : 0
		placed.push(node)
		return node
	}
	// the children of a node: a block centred on the band top … top + sh, a free one at its place
	const placeKids = (node, depth, side, top, sh, group) => {
		let y = top + (sh - blockH(rowKids(node.key), node.key)) / 2
		const childX = side > 0 ? node.x + node.w + MM_GAP_X : node.x - MM_GAP_X
		for (const k of visible(node.key)) {
			if (placeAt(k) !== null) {
				placeFree(k, node.key, depth + 1, side)
				if (k === roomKey) y += subH(k) + MM_GAP_Y
				continue
			}
			place(k, node.key, depth + 1, side, childX, y, group)
			y += subH(k) + MM_GAP_Y
		}
	}
	const place = (key, parent, depth, side, xInner, top, group) => {
		const s = sizeOf(key)
		const sh = subH(key)
		const node = makeNode(key, parent, depth, side, side > 0 ? xInner : xInner - s.w, top + (sh - s.h) / 2)
		group.push(node)
		placeKids(node, depth, side, top, sh, group)
	}
	const placeFree = (key, parent, depth, side) => {
		const s = sizeOf(key)
		const [u, v] = placeAt(key)
		const node = makeNode(key, parent, depth, side, side * u - s.w / 2, v - s.h / 2)
		node.free = true
		const group = []
		freeGroups.push({ top: key, members: group })
		const sh = subH(key)
		placeKids(node, depth, side, v - sh / 2, sh, group)
	}
	// the root, centred on (0, 0)
	const rs = sizeOf(tree.root)
	const rootNode = {
		key: tree.root, parent: null, depth: 0, side: 0, w: rs.w, h: rs.h, x: -rs.w / 2, y: -rs.h / 2, shape: rs.shape,
		color: colorOf(tree, tree.root), width: MM_BORDER_W, folded: false, kids: tree.nodes.get(tree.root).kids.length, count: 0,
		text: rs.text, font: rs.font, bold: rs.bold, padX: rs.padX, padY: rs.padY,
		attach: org ? { x: 0, y: rs.h / 2 } : { x: rs.w / 2, y: 0 }, inner: null, dot: null,
		free: false, name: rs.name ?? null, role: rs.role ?? null, nameH: rs.nameH ?? null, band: rs.band, main: false, fill: null,
		badge: null, border: boxes || !rootHasColor(tree) ? MM_INK_BORDER : colorOf(tree, tree.root),
	}
	placed.push(rootNode)
	const kids = tree.nodes.get(tree.root).kids
	if (org) placeOrg(tree, rootNode, visible, sizeOf, makeNode)
	// the row of a side: the main branches that take room there (a dragged one on its old side)
	const inRow = (k, side) => (k === roomKey ? (ghost.side < 0 ? -1 : 1) : placeAt(k) === null ? mainSide(tree, k) : 0) === side
	for (const side of org ? [] : [1, -1]) {
		let y = -blockH(kids.filter((k) => inRow(k, side)), tree.root) / 2
		for (const k of kids) {
			if (placeAt(k) !== null) {
				if (mainSide(tree, k) === side) placeFree(k, tree.root, 1, side)
				if (inRow(k, side)) y += subH(k) + MM_MAIN_GAP_Y
				continue
			}
			if (mainSide(tree, k) !== side) continue
			place(k, tree.root, 1, side, side > 0 ? rs.w / 2 + MM_GAP_X : -rs.w / 2 - MM_GAP_X, y, rootGroup.get(side))
			y += subH(k) + MM_MAIN_GAP_Y
		}
	}
	// job 196: what Knorke lays out moves down out of the way, first below the free nodes, then around the root;
	// the root and the free nodes never move. A node being dragged (mmGhost: its subtree) is no obstacle to the rest.
	if (freeGroups.length > 0) {
		const inGhost = (key) => ghost !== null && inSubtree(tree, ghost.key, key)
		const freeNodes = placed.filter((n) => n.free)
		for (const g of freeGroups) {
			const mine = inGhost(g.top)
			pushDown(g.members, [...freeNodes, rootNode].filter((o) => mine || !inGhost(o.key)))
		}
		const obstacles = [...freeNodes, ...freeGroups.flatMap((g) => g.members)].filter((o) => !inGhost(o.key))
		for (const list of rootGroup.values()) pushDown(list, obstacles)
	}
	for (const n of placed) {
		if (n.parent === null) continue
		if (org) {
			// job 198: from the middle of the bottom edge to the middle of the top edge, the dot below
			n.attach = { x: n.x + n.w / 2, y: n.y + n.h }
			n.inner = { x: n.x + n.w / 2, y: n.y }
			if (n.kids > 0) n.dot = { x: n.attach.x, y: n.attach.y + MM_DOT_R + 1 }
		} else {
			n.attach = attachOf(n, n.side)
			n.inner = { x: n.side > 0 ? n.x : n.x + n.w, y: n.shape === 'line' ? n.y + n.h : n.y + n.h / 2 }
			if (n.kids > 0) n.dot = { x: n.attach.x + n.side * (MM_DOT_R + 1), y: n.attach.y }
		}
		if (n.folded) {
			// job 266: the "+n" badge instead of the dot (org: centred below the card, else beyond the outer edge);
			// dot stays the middle of what a click hits
			const w = badgeWidth(n.count, measure)
			const x = org ? n.attach.x - w / 2 : n.side > 0 ? n.attach.x + MM_BADGE_GAP : n.attach.x - MM_BADGE_GAP - w
			const y = org ? n.attach.y + MM_BADGE_ORG_GAP : n.attach.y - MM_BADGE_H / 2
			n.badge = { x, y, w, h: MM_BADGE_H }
			n.dot = { x: x + w / 2, y: y + MM_BADGE_H / 2 }
		}
	}
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const n of placed) {
		minX = Math.min(minX, n.x)
		minY = Math.min(minY, n.y)
		maxX = Math.max(maxX, n.x + n.w)
		maxY = Math.max(maxY, n.y + n.h)
		if (n.badge) {
			minX = Math.min(minX, n.badge.x)
			maxX = Math.max(maxX, n.badge.x + n.badge.w)
			minY = Math.min(minY, n.badge.y)
			maxY = Math.max(maxY, n.badge.y + n.badge.h)
		} else if (n.dot) {
			minX = Math.min(minX, n.dot.x - MM_DOT_R)
			maxX = Math.max(maxX, n.dot.x + MM_DOT_R)
			minY = Math.min(minY, n.dot.y - MM_DOT_R)
			maxY = Math.max(maxY, n.dot.y + MM_DOT_R)
		}
	}
	for (const n of placed) {
		n.x -= minX
		n.y -= minY
		for (const p of [n.attach, n.inner, n.dot, n.badge]) {
			if (p) {
				p.x -= minX
				p.y -= minY
			}
		}
		out.byKey.set(n.key, n)
	}
	out.nodes = placed
	out.w = maxX - minX
	out.h = maxY - minY
	// a local preview keeps the root where the stored layout draws it (previewMindmap's anchor)
	const anchor = item.mmAnchor
	if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
		const dx = anchor.x - rootNode.x
		const dy = anchor.y - rootNode.y
		for (const n of placed) {
			n.x += dx
			n.y += dy
			for (const q of [n.attach, n.inner, n.dot, n.badge]) {
				if (q) {
					q.x += dx
					q.y += dy
				}
			}
		}
	}
	return out
}

/**
 * Job 198: the layout org below the root (mindmapLayout): the cards of one
 * depth in a row, each row MM_ORG_GAP_Y below the lowest card above it; a
 * node centred above the block of its visible children, sibling subtrees
 * MM_ORG_GAP_X apart. Iterative (a chain of MM_MAX_NODES nodes).
 *
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {object} rootNode the root's layout node, centred on (0, 0)
 * @param {(key: string) => string[]} visible the visible children of a node
 * @param {(key: string) => {w: number, h: number}} sizeOf the size of a node
 * @param {Function} makeNode (key, parent, depth, side, x, y) → a new layout node (in outline order)
 */
function placeOrg(tree, rootNode, visible, sizeOf, makeNode) {
	// the visible nodes children first, the height of each row
	const order = []
	const rowH = []
	const stack = [[tree.root, 0]]
	while (stack.length > 0) {
		const [k, d] = stack.pop()
		order.push(k)
		rowH[d] = Math.max(rowH[d] ?? 0, sizeOf(k).h)
		for (const c of visible(k)) stack.push([c, d + 1])
	}
	const widths = new Map()
	const blockW = (keys) => keys.reduce((sum, k) => sum + widths.get(k), 0) + MM_ORG_GAP_X * Math.max(0, keys.length - 1)
	for (let i = order.length - 1; i >= 0; i--) {
		const k = order[i]
		widths.set(k, Math.max(sizeOf(k).w, blockW(visible(k))))
	}
	const tops = [rootNode.y]
	for (let d = 1; d < rowH.length; d++) tops[d] = tops[d - 1] + rowH[d - 1] + MM_ORG_GAP_Y
	// [key, parent, depth, left edge of its subtree], in outline order
	const todo = [[tree.root, null, 0, -widths.get(tree.root) / 2]]
	while (todo.length > 0) {
		const [k, parent, d, left] = todo.pop()
		const cx = left + widths.get(k) / 2
		if (parent !== null) makeNode(k, parent, d, 1, cx - sizeOf(k).w / 2, tops[d])
		const kids = visible(k)
		let x = cx - blockW(kids) / 2
		const next = []
		for (const c of kids) {
			next.push([c, k, d + 1, x])
			x += widths.get(c) + MM_ORG_GAP_X
		}
		for (let i = next.length - 1; i >= 0; i--) todo.push(next[i])
	}
}

/**
 * Job 196: moves the nodes Knorke lays out down until none overlaps an
 * obstacle grown by MM_GAP_Y on every side; a node that moves takes every
 * node after it in the list along (its subtree and the rows below it keep
 * their order and gaps).
 *
 * @param {object[]} list layout nodes of one group and side, in outline order
 * @param {object[]} obstacles layout nodes that stay where they are
 */
function pushDown(list, obstacles) {
	if (obstacles.length === 0) return
	const g = MM_GAP_Y
	let shift = 0
	for (const n of list) {
		n.y += shift
		for (let i = 0; i <= obstacles.length; i++) {
			const o = obstacles.find((b) => b !== n && n.x < b.x + b.w + g && n.x + n.w > b.x - g && n.y < b.y + b.h + g && n.y + n.h > b.y - g)
			if (!o) break
			const to = o.y + o.h + g
			shift += to - n.y
			n.y = to
		}
	}
}

/**
 * @param {string} color a branch colour (#rrggbb)
 * @return {string} (job 266, M3) its light tone: the light of the PALETTE entry with that strong tone, else of the
 *   nearest strong tone
 */
export function lightOf(color) {
	const c = String(color).toLowerCase()
	const e = PALETTE.find((p) => p.strong === c) ?? PALETTE[STRONG.indexOf(nearestColor(c, STRONG))]
	return e ? e.light : '#ffffff'
}

/**
 * @param {ReturnType<typeof mindTree>} tree tree
 * @return {boolean} the root has a colour of its own (c)
 */
function rootHasColor(tree) {
	const c = tree.nodes.get(tree.root)?.n.c
	return typeof c === 'string' && COLOR_RE.test(c)
}

/**
 * @param {number} count hidden nodes
 * @param {Function} [measure] text size (mindmapLayout's)
 * @return {number} (job 266) the width of the "+n" badge: its text bold MM_BADGE_FONT plus MM_BADGE_PAD on both
 *   sides, at least MM_BADGE_H
 */
export function badgeWidth(count, measure = estimateNodeSize) {
	const m = measure('+' + count, 1000, MM_BADGE_FONT, true)
	const tw = Number.isFinite(m?.w) ? Math.max(0, m.w) : 0
	return Math.max(MM_BADGE_H, tw + 2 * MM_BADGE_PAD)
}

/**
 * @param {object} n a layout node
 * @return {{x: number, y: number, w: number, h: number}} (job 266) the room of its text: its box without its padding
 *   (a card: without its band)
 */
export function textRect(n) {
	const top = n.band === 'top' ? MM_CARD_BAND : 0
	const left = n.band === 'left' ? MM_CARD_BAND : 0
	return { x: n.x + left + n.padX, y: n.y + top + n.padY, w: Math.max(0, n.w - left - 2 * n.padX), h: Math.max(0, n.h - top - 2 * n.padY) }
}

/**
 * Job 266: moves a "+" button off the text of every node and off every
 * badge of a layout: while a circle of radius r at (x, y) touches one, it
 * steps MM_PLUS_STEP along (dx, dy), at most MM_PLUS_STEPS times.
 *
 * @param {ReturnType<typeof mindmapLayout>} layout layout
 * @param {number} x centre, relative to the layout's corner
 * @param {number} y centre
 * @param {number} dx direction (a unit step)
 * @param {number} dy direction
 * @param {number} r radius (world units)
 * @return {{x: number, y: number}} the free place (or the last one tried)
 */
export function clearPlus(layout, x, y, dx, dy, r) {
	const rects = []
	for (const n of layout.nodes) {
		if (n.text !== '') rects.push(textRect(n))
		if (n.badge) rects.push(n.badge)
	}
	const hits = (px, py) => rects.some((b) => {
		const cx = Math.max(b.x, Math.min(px, b.x + b.w))
		const cy = Math.max(b.y, Math.min(py, b.y + b.h))
		return Math.hypot(px - cx, py - cy) < r
	})
	let i = 0
	while (i < MM_PLUS_STEPS && hits(x, y)) {
		x += dx * MM_PLUS_STEP
		y += dy * MM_PLUS_STEP
		i++
	}
	return { x, y }
}

/**
 * @param {object} root the root node of a layout
 * @param {1|-1} s side
 * @return {{x: number, y: number}} where the branches of that side start at the root (the middle of its edge)
 */
export function rootAttach(root, s) {
	return { x: s > 0 ? root.x + root.w : root.x, y: root.y + root.h / 2 }
}

/**
 * The node (or its fold dot) under a point of the layout.
 *
 * @param {ReturnType<typeof mindmapLayout>} layout layout
 * @param {number} lx x relative to the item's corner
 * @param {number} ly y
 * @param {number} [tol] tolerance (world units)
 * @return {{key: string, part: ('node'|'dot')}|null} the topmost hit (a box itself, then dots, then boxes with
 *   the tolerance), null outside
 */
export function nodeAtLayout(layout, lx, ly, tol = 0) {
	if (!layout || !Number.isFinite(lx) || !Number.isFinite(ly)) return null
	// job 198 round 6: a point in a node's box is that node, also where the tolerance of a dot reaches into it
	// (a finger; in org the dot sits 1 below the card)
	for (let i = layout.nodes.length - 1; i >= 0; i--) {
		const n = layout.nodes[i]
		if (lx >= n.x && lx <= n.x + n.w && ly >= n.y && ly <= n.y + n.h) return { key: n.key, part: 'node' }
	}
	for (let i = layout.nodes.length - 1; i >= 0; i--) {
		const d = layout.nodes[i].dot
		const b = layout.nodes[i].badge
		// job 266: the "+n" badge of a folded branch, its rectangle plus the tolerance
		if (b ? lx >= b.x - tol && lx <= b.x + b.w + tol && ly >= b.y - tol && ly <= b.y + b.h + tol : d && Math.hypot(lx - d.x, ly - d.y) <= MM_DOT_R + tol) {
			return { key: layout.nodes[i].key, part: 'dot' }
		}
	}
	for (let i = layout.nodes.length - 1; i >= 0; i--) {
		const n = layout.nodes[i]
		if (lx >= n.x - tol && lx <= n.x + n.w + tol && ly >= n.y - tol && ly <= n.y + n.h + tol) return { key: n.key, part: 'node' }
	}
	return null
}

/**
 * A random node key that is not taken, in a pot with room (< MM_BUCKET_MAX).
 *
 * @param {object} data data of the mind map
 * @param {() => number} [rand] random numbers in [0, 1)
 * @param {Set<string>} [extra] keys taken besides those of data
 * @return {string}
 */
export function newNodeKey(data, rand = Math.random, extra = new Set()) {
	const nodes = nodesOf(data)
	const pots = new Map()
	for (const k of [...nodes.keys(), ...extra]) pots.set(bucketOf(k), (pots.get(bucketOf(k)) ?? 0) + 1)
	const free = (k) => !nodes.has(k) && !extra.has(k) && (pots.get(bucketOf(k)) ?? 0) < MM_BUCKET_MAX
	let k = 'n'
	for (let attempt = 0; attempt < 32; attempt++) {
		k = 'n'
		for (let i = 0; i < 8; i++) {
			const r = Number(rand())
			k += KEY_ALPHABET[Math.floor((Number.isFinite(r) ? Math.abs(r) % 1 : 0) * KEY_ALPHABET.length)]
		}
		if (free(k)) return k
	}
	// a random source that repeats itself (tests): every pot in turn, counting up in it
	for (let i = 0; ; i++) {
		const c = 'n' + KEY_ALPHABET[i % 36] + Math.floor(i / 36).toString(36).padStart(7, '0')
		if (free(c)) return c
	}
}

/**
 * @param {() => number} [rand] random numbers
 * @return {{nodes: object}} the data of a new mind map: the empty root
 */
export function newMindmapData(rand = Math.random) {
	const key = newNodeKey({}, rand)
	return { nodes: { [bucketOf(key)]: { [key]: { o: keyBetween(null, null) } } } }
}

/**
 * @param {object} item mind map item
 * @return {number} its stored size as the server counts it (strlen(data) + strlen(style), UTF-8 JSON)
 */
export function mindmapBytes(item) {
	const enc = new TextEncoder()
	return enc.encode(JSON.stringify(item?.data ?? {})).length + enc.encode(JSON.stringify(item?.style ?? {})).length
}

/**
 * @param {object} item mind map item
 * @param {object} p patch
 * @return {object} a changed copy (paths.js setPath semantics)
 */
export function applyMindmapPatch(item, p) {
	return applyPatch(structuredClone(item), structuredClone(p))
}

/**
 * The colour of a new main branch: the first of MM_COLORS no main branch
 * has; all taken: the one by count.
 *
 * @param {ReturnType<typeof mindTree>} tree tree
 * @return {string}
 */
function newMainColor(tree) {
	const kids = tree.nodes.get(tree.root).kids
	const used = new Set(kids.map((k) => tree.nodes.get(k).n.c).filter((c) => typeof c === 'string').map(shownColor))
	return MM_COLORS.find((c) => !used.has(c)) ?? MM_COLORS[kids.length % MM_COLORS.length]
}

/**
 * @param {ReturnType<typeof mindTree>} tree tree
 * @return {'l'|null} the side of a new main branch with layout both: the one with fewer main branches (a tie: right)
 */
function balancedSide(tree) {
	if (tree.layout !== 'both') return null
	let left = 0
	let right = 0
	for (const k of tree.nodes.get(tree.root).kids) {
		if (mainSide(tree, k) < 0) left++
		else right++
	}
	return left < right ? 'l' : null
}

/**
 * A new last child of a node (its parent unfolds in the same patch). A
 * child of the root gets a colour (newMainColor) and a side: side, or the
 * balanced one.
 *
 * @param {object} item mind map item
 * @param {string} parent parent key
 * @param {{side?: ('l'|'r'|null)}} [o] side of a new main branch (the "+" of the root)
 * @param {() => number} [rand] random numbers
 * @return {{p: object, inv: object, key: string}|{error: string}} error 'nodes' (MM_MAX_NODES) or 'gone'
 */
export function addChild(item, parent, { side = null } = {}, rand = Math.random) {
	const tree = mindTree(item)
	const e = tree.nodes.get(parent)
	if (!e) return { error: 'gone' }
	if (nodesOf(item.data).size >= MM_MAX_NODES) return { error: 'nodes' }
	const key = newNodeKey(item.data, rand)
	const last = e.kids.length > 0 ? tree.nodes.get(e.kids[e.kids.length - 1]).n.o : null
	const node = { o: keyBetween(last, null), p: parent }
	if (parent === tree.root) {
		node.c = newMainColor(tree)
		const d = side === 'l' ? 'l' : side === 'r' ? null : balancedSide(tree)
		if (d === 'l' && tree.layout === 'both') node.d = 'l'
	}
	const p = { [nodePath(key)]: node }
	const inv = { [nodePath(key)]: null }
	if (e.n.f === true) {
		p[nodePath(parent) + '.f'] = null
		inv[nodePath(parent) + '.f'] = true
	}
	return { p, inv, key }
}

/**
 * A new sibling right after a node (in its row), on its side.
 *
 * @param {object} item mind map item
 * @param {string} key node key
 * @param {() => number} [rand] random numbers
 * @return {{p: object, inv: object, key: string}|{error: string}} error 'root', 'gone' or 'nodes'
 */
export function addSibling(item, key, rand = Math.random) {
	const tree = mindTree(item)
	const e = tree.nodes.get(key)
	if (!e) return { error: 'gone' }
	if (e.parent === null) return { error: 'root' }
	if (nodesOf(item.data).size >= MM_MAX_NODES) return { error: 'nodes' }
	const row = rowOf(tree, key)
	const i = row.indexOf(key)
	const next = i >= 0 && i + 1 < row.length ? tree.nodes.get(row[i + 1]).n.o : null
	const fresh = newNodeKey(item.data, rand)
	const node = { o: keyBetween(e.n.o, next), p: e.parent }
	if (e.parent === tree.root) {
		node.c = newMainColor(tree)
		if (e.n.d === 'l' && tree.layout === 'both') node.d = 'l'
	}
	return { p: { [nodePath(fresh)]: node }, inv: { [nodePath(fresh)]: null }, key: fresh }
}

/**
 * The keys of a subtree, children before their parent (post-order).
 *
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {string} key top of the subtree
 * @return {string[]}
 */
function postOrder(tree, key) {
	const out = []
	const walk = (k) => {
		for (const c of tree.nodes.get(k)?.kids ?? []) walk(c)
		out.push(k)
	}
	walk(key)
	return out
}

/**
 * Cuts [path, value] entries into patches of at most MM_PATCH_PATHS paths in
 * their order; the entries of tail all go into the last one.
 *
 * @param {Array<[string, unknown]>} list entries in order
 * @param {Array<[string, unknown]>} tail entries of the last patch
 * @return {object[]} patches
 */
export function toPatches(list, tail = []) {
	const out = []
	for (let i = 0; i < list.length; i += MM_PATCH_PATHS) out.push(list.slice(i, i + MM_PATCH_PATHS))
	if (tail.length > 0) {
		if (out.length === 0) out.push([])
		const last = out[out.length - 1]
		if (last.length + tail.length > MM_PATCH_PATHS) out.push(last.splice(MM_PATCH_PATHS - tail.length))
		out[out.length - 1].push(...tail)
	}
	return out.map((x) => Object.fromEntries(x))
}

/**
 * Deletes a node with its subtree: per node (children first) its text and
 * its node path, in patches of at most MM_PATCH_PATHS paths; every state
 * between them is a valid mind map. The inverse patches bring them back
 * parents first (each node, then its text).
 *
 * @param {object} item mind map item
 * @param {string} key node key
 * @return {{patches: object[], inverse: object[], keys: string[]}|{error: string}} error 'root' or 'gone'
 */
export function deleteBranch(item, key) {
	const tree = mindTree(item)
	const e = tree.nodes.get(key)
	if (!e) return { error: 'gone' }
	if (e.parent === null) return { error: 'root' }
	const keys = postOrder(tree, key)
	const p = []
	for (const k of keys) {
		if (nodeText(item.data, k) !== '') p.push([textPath(k), null])
		p.push([nodePath(k), null])
	}
	const inv = []
	for (const k of [...keys].reverse()) {
		inv.push([nodePath(k), structuredClone(tree.nodes.get(k).n)])
		const text = nodeText(item.data, k)
		if (text !== '') inv.push([textPath(k), text])
	}
	return { patches: toPatches(p), inverse: toPatches(inv), keys }
}

/**
 * The text of a node: one path; "" is sent as null.
 *
 * @param {object} item mind map item
 * @param {string} key node key
 * @param {string} text new text
 * @param {string} [before] text before (the undo value; default: the stored one)
 * @return {{p: object, inv: object}|{error: string}} error 'gone' when the node is missing
 */
export function setNodeText(item, key, text, before = undefined) {
	if (!nodesOf(item?.data).has(key)) return { error: 'gone' }
	const old = before === undefined ? nodeText(item.data, key) : before
	const path = textPath(key)
	return { p: { [path]: text === '' ? null : text }, inv: { [path]: old === '' || old === null ? null : old } }
}

/**
 * Colour (c) or shape (s) of a node; null removes it.
 *
 * @param {object} item mind map item
 * @param {string} key node key
 * @param {'c'|'s'} field field
 * @param {string|null} value new value
 * @return {{p: object, inv: object}|{error: string}} error 'gone' or 'same'
 */
export function setNodeField(item, key, field, value) {
	const n = nodesOf(item?.data).get(key)
	if (!n || (field !== 'c' && field !== 's')) return { error: 'gone' }
	const v = value === undefined ? null : value
	const before = hasOwn(n, field) ? n[field] : null
	if (before === v) return { error: 'same' }
	const path = nodePath(key) + '.' + field
	return { p: { [path]: v }, inv: { [path]: before } }
}

/**
 * Folds or unfolds a node with children (never the root).
 *
 * @param {object} item mind map item
 * @param {string} key node key
 * @return {{p: object, inv: object, folded: boolean}|{error: string}} error 'gone', 'root' or 'same' (no children)
 */
export function toggleFold(item, key) {
	const tree = mindTree(item)
	const e = tree.nodes.get(key)
	if (!e) return { error: 'gone' }
	if (e.parent === null) return { error: 'root' }
	if (e.kids.length === 0) return { error: 'same' }
	const path = nodePath(key) + '.f'
	const folded = e.n.f === true
	return { p: { [path]: folded ? null : true }, inv: { [path]: folded ? true : null }, folded: !folded }
}

/**
 * @param {ReturnType<typeof mindTree>} tree tree
 * @param {string} top top of a subtree
 * @param {string} key a node
 * @return {boolean} key lies in the subtree of top (top included)
 */
function inSubtree(tree, top, key) {
	let e = tree.nodes.get(key)
	while (e) {
		if (e.key === top) return true
		e = e.parent === null ? null : tree.nodes.get(e.parent)
	}
	return false
}

/**
 * Hangs a node (with its subtree) somewhere else: as the last child of a
 * node, or before or after one of its siblings (never beside the root). A
 * node that becomes a main branch takes the side of the target (child of
 * the root: side), any other loses d. A folded parent unfolds.
 *
 * @param {object} item mind map item
 * @param {string} key the node that moves (never the root)
 * @param {{key: string, where: ('child'|'before'|'after'), side?: ('l'|'r'|null)}} target where it goes
 * @return {{p: object, inv: object}|{error: string}} error 'root', 'gone' (a key missing or the target in the
 *   own subtree) or 'same' (no change)
 */
export function moveNode(item, key, target, measure = estimateNodeSize) {
	const tree = mindTree(item)
	const e = tree.nodes.get(key)
	const t = tree.nodes.get(target?.key)
	if (!e || !t) return { error: 'gone' }
	if (e.parent === null) return { error: 'root' }
	if (inSubtree(tree, key, t.key)) return { error: 'gone' }
	const where = target.where === 'before' || target.where === 'after' ? target.where : 'child'
	if (where !== 'child' && t.parent === null) return { error: 'root' }
	const parent = where === 'child' ? t.key : t.parent
	let o
	let d = null
	if (where === 'child') {
		const kids = tree.nodes.get(parent).kids.filter((k) => k !== key)
		o = keyBetween(kids.length > 0 ? tree.nodes.get(kids[kids.length - 1]).n.o : null, null)
		if (parent === tree.root && tree.layout === 'both') {
			d = target.side === 'l' ? 'l' : target.side === 'r' ? null : (sideOf(tree, key) < 0 && e.parent === tree.root ? 'l' : null)
		}
	} else {
		const row = rowOf(tree, t.key).filter((k) => k !== key)
		const i = row.indexOf(t.key)
		const lo = where === 'before' ? row[i - 1] ?? null : t.key
		const hi = where === 'before' ? t.key : row[i + 1] ?? null
		o = keyBetween(lo === null ? null : tree.nodes.get(lo).n.o, hi === null ? null : tree.nodes.get(hi).n.o)
		if (parent === tree.root && t.n.d === 'l' && tree.layout === 'both') d = 'l'
	}
	const base = nodePath(key)
	const p = {}
	const inv = {}
	const set = (path, v, old) => {
		if (v === old) return
		p[path] = v
		inv[path] = old
	}
	const oldD = hasOwn(e.n, 'd') ? e.n.d : null
	const oldM = hasOwn(e.n, 'm') ? e.n.m : null
	if (e.parent === parent && oldD === d && oldM === null) {
		// the same row: only a new place counts
		const row = rowOf(tree, key)
		const i = row.indexOf(key)
		const rest = row.filter((k) => k !== key)
		const at = where === 'child' ? rest.length : where === 'before' ? rest.indexOf(t.key) : rest.indexOf(t.key) + 1
		if (at === i) return { error: 'same' }
	}
	set(base + '.p', parent, e.parent)
	set(base + '.o', o, e.n.o)
	set(base + '.d', d, oldD)
	// job 196: it goes back into the layout; the free nodes below it travel along
	set(base + '.m', null, oldM)
	const pn = tree.nodes.get(parent).n
	if (pn.f === true && parent !== tree.root) {
		p[nodePath(parent) + '.f'] = null
		inv[nodePath(parent) + '.f'] = true
	}
	if (Object.keys(p).length === 0) return { error: 'same' }
	const list = Object.entries(p)
	const back = Object.entries(inv)
	// job 198: in org and tree their m (a place in the mind map) stays as it is
	const free = isBoxLayout(tree.layout) ? [] : postOrder(tree, key).filter((k) => k !== key && placeOf(tree.nodes.get(k).n) !== null)
	if (free.length > 0) {
		const moved = applyMindmapPatch(item, p)
		const before = mindmapLayout(item, measure)
		const after = mindmapLayout(moved, measure)
		const nb = before.byKey.get(key)
		const na = after.byKey.get(key)
		if (nb && na) {
			const rel = (l, n) => {
				const r = l.byKey.get(l.root)
				return { x: n.x + n.w / 2 - r.x - r.w / 2, y: n.y + n.h / 2 - r.y - r.h / 2 }
			}
			const a = rel(after, na)
			const b = rel(before, nb)
			shiftPlaces(tree, free, sideOf(tree, key), sideOf(mindTree(moved), key), a.x - b.x, a.y - b.y, list, back)
		}
	}
	return packed(list, back)
}

/** @param {number} v value @return {number} on the 1/100 grid, at most MM_PLACE_MAX from 0 */
function gridPlace(v) {
	return Math.round(Math.max(-MM_PLACE_MAX, Math.min(MM_PLACE_MAX, v)) * 100) / 100 || 0
}

/**
 * Job 196: the free nodes of a branch move by (dx, dy) and change from side s0 to side s1 (their m is mirrored
 * by the side); adds their m paths and the stored values to list and back.
 *
 * @param {ReturnType<typeof mindTree>} tree tree before
 * @param {string[]} keys free nodes of the branch
 * @param {1|-1} s0 their side before
 * @param {1|-1} s1 their side after
 * @param {number} dx shift relative to the root
 * @param {number} dy shift
 * @param {Array<[string, unknown]>} list patch entries
 * @param {Array<[string, unknown]>} back inverse entries
 */
function shiftPlaces(tree, keys, s0, s1, dx, dy, list, back) {
	for (const k of keys) {
		const n = tree.nodes.get(k).n
		const [u, v] = placeOf(n)
		const m = [gridPlace(s1 * (s0 * u + dx)), gridPlace(v + dy)]
		if (m[0] === u && m[1] === v) continue
		list.push([nodePath(k) + '.m', m])
		back.push([nodePath(k) + '.m', structuredClone(n.m)])
	}
}

/**
 * @param {Array<[string, unknown]>} list patch entries in order
 * @param {Array<[string, unknown]>} back inverse entries
 * @return {{p: object, inv: object}|{patches: object[], inverse: object[]}} one patch, or patches of at most
 *   MM_PATCH_PATHS paths (toPatches) when more
 */
function packed(list, back) {
	if (list.length <= MM_PATCH_PATHS) return { p: Object.fromEntries(list), inv: Object.fromEntries(back) }
	return { patches: toPatches(list), inverse: toPatches(back) }
}

/**
 * Job 196: places a node freely (dropped on empty space), its box centred on
 * a point. A main branch whose centre lands on the other side of the root's
 * centre (layout both) changes side, so its branches grow away from the
 * root; every free node below it moves the same way.
 *
 * @param {object} item mind map item
 * @param {string} key the node (never the root)
 * @param {{x: number, y: number}} at the new centre of its box, relative to the corner of mindmapLayout(item, measure)
 * @param {Function} [measure] text size (mindmapLayout)
 * @param {object|null} [stored] mindmapLayout(item, measure) when the caller has it (the scene's, per pointer move)
 * @return {{p: object, inv: object}|{patches: object[], inverse: object[]}|{error: string}} error 'root', 'gone'
 *   (also a hidden node) or 'same' (also: job 198, nothing is placed freely in org and tree)
 */
export function placeNode(item, key, at, measure = estimateNodeSize, stored = null) {
	const tree = mindTree(item)
	const e = tree.nodes.get(key)
	if (!e) return { error: 'gone' }
	if (e.parent === null) return { error: 'root' }
	if (isBoxLayout(tree.layout)) return { error: 'same' }
	const layout = stored ?? mindmapLayout(item, measure)
	const n = layout.byKey.get(key)
	if (!n || !Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return { error: 'gone' }
	const r = layout.byKey.get(tree.root)
	const cx = r.x + r.w / 2
	const cy = r.y + r.h / 2
	const s0 = sideOf(tree, key)
	let s1 = s0
	const oldD = hasOwn(e.n, 'd') ? e.n.d : null
	let d = oldD
	if (e.parent === tree.root && tree.layout === 'both' && at.x !== cx) {
		s1 = at.x < cx ? -1 : 1
		d = s1 < 0 ? 'l' : null
	}
	const list = []
	const back = []
	const m = [gridPlace(s1 * (at.x - cx)), gridPlace(at.y - cy)]
	const old = placeOf(e.n)
	if (!old || old[0] !== m[0] || old[1] !== m[1]) {
		list.push([nodePath(key) + '.m', m])
		back.push([nodePath(key) + '.m', hasOwn(e.n, 'm') ? structuredClone(e.n.m) : null])
	}
	if (d !== oldD) {
		list.push([nodePath(key) + '.d', d])
		back.push([nodePath(key) + '.d', oldD])
	}
	const free = postOrder(tree, key).filter((k) => k !== key && placeOf(tree.nodes.get(k).n) !== null)
	shiftPlaces(tree, free, s0, s1, s1 * m[0] + cx - (n.x + n.w / 2), m[1] + cy - (n.y + n.h / 2), list, back)
	return list.length > 0 ? packed(list, back) : { error: 'same' }
}

/**
 * Job 196: "Rearrange": a node and its whole branch go back into the
 * automatic layout (m removed); at the root the whole mind map.
 *
 * @param {object} item mind map item
 * @param {string} key node key
 * @return {{p: object, inv: object}|{patches: object[], inverse: object[]}|{error: string}} error 'gone' or
 *   'same' (nothing placed freely there)
 */
export function rearrange(item, key) {
	const tree = mindTree(item)
	if (!tree.nodes.has(key)) return { error: 'gone' }
	const list = []
	const back = []
	for (const k of postOrder(tree, key)) {
		const n = tree.nodes.get(k).n
		if (!hasOwn(n, 'm')) continue
		list.push([nodePath(k) + '.m', null])
		back.push([nodePath(k) + '.m', structuredClone(n.m)])
	}
	return list.length > 0 ? packed(list, back) : { error: 'same' }
}

/**
 * @param {object} item mind map item
 * @param {string} key node key
 * @return {boolean} the node or a node of its branch is placed freely ("Rearrange" acts there); (job 198) never in org
 *   and tree, where nothing is free
 */
export function hasPlaced(item, key) {
	const tree = mindTree(item)
	return !isBoxLayout(tree.layout) && tree.nodes.has(key) && postOrder(tree, key).some((k) => hasOwn(tree.nodes.get(k).n, 'm'))
}

/**
 * Adds x, y, parent, w and h of the changed mind map to a patch (and their
 * stored values to the inverse) where they differ by more than 0.01: the
 * hull of the new layout, placed so that the root stays where it is drawn
 * now. Values on the 1/100 grid.
 *
 * @param {object} item mind map item before the change
 * @param {{p: object, inv: object}} r patch and inverse
 * @param {Function} [measure] text size (mindmapLayout)
 * @return {{p: object, inv: object}} the same objects, completed
 */
export function withBox(item, r, measure = estimateNodeSize) {
	const before = mindmapLayout(item, measure)
	const after = mindmapLayout(applyMindmapPatch(item, r.p), measure)
	if (before.root === null || after.root === null) return r
	const rb = before.byKey.get(before.root)
	const ra = after.byKey.get(after.root)
	const grid = (v) => Math.round(v * 100) / 100
	const x = grid((item.x ?? 0) + rb.x - ra.x)
	const y = grid((item.y ?? 0) + rb.y - ra.y)
	if (Math.abs(x - (item.x ?? 0)) > 0.01 || Math.abs(y - (item.y ?? 0)) > 0.01) {
		r.p.x = x
		r.p.y = y
		r.p.parent = item.parent ?? null
		r.inv.x = item.x ?? 0
		r.inv.y = item.y ?? 0
		r.inv.parent = item.parent ?? null
	}
	const w = grid(Math.min(100000, Math.max(20, after.w)))
	const h = grid(Math.min(100000, Math.max(20, after.h)))
	if (Math.abs(w - (item.w ?? 0)) > 0.01) {
		r.p.w = w
		r.inv.w = item.w ?? 0
	}
	if (Math.abs(h - (item.h ?? 0)) > 0.01) {
		r.p.h = h
		r.inv.h = item.h ?? 0
	}
	return r
}

/**
 * The keyboard way through the tree: out (the first visible child; at the
 * root the first of side), in (the parent), up and down (the previous and
 * next node of its row). Job 198, org: down is out, up is in, left and right
 * the previous and next node of its row.
 *
 * @param {object} item mind map item
 * @param {string} key focused node
 * @param {'left'|'right'|'up'|'down'} dir arrow
 * @return {string|null} the node to focus, null when there is none
 */
export function stepFocus(item, key, dir) {
	const tree = mindTree(item)
	const e = tree.nodes.get(key)
	if (!e) return null
	const side = sideOf(tree, key)
	const visibleKids = e.n.f === true && e.parent !== null ? [] : e.kids
	if (tree.layout === 'org') {
		if (dir === 'down') return visibleKids[0] ?? null
		if (e.parent === null) return null
		if (dir === 'up') return e.parent
		const row = rowOf(tree, key)
		const i = row.indexOf(key) + (dir === 'left' ? -1 : 1)
		return i >= 0 && i < row.length ? row[i] : null
	}
	if (e.parent === null) {
		if (dir !== 'left' && dir !== 'right') return null
		const want = dir === 'right' ? 1 : -1
		return visibleKids.find((k) => mainSide(tree, k) === want) ?? null
	}
	if (dir === 'up' || dir === 'down') {
		const row = rowOf(tree, key)
		const i = row.indexOf(key) + (dir === 'up' ? -1 : 1)
		return i >= 0 && i < row.length ? row[i] : null
	}
	const out = (dir === 'right') === (side > 0)
	return out ? (visibleKids[0] ?? null) : e.parent
}

/**
 * @param {object} item mind map item
 * @param {string} key a node about to be deleted
 * @return {string|null} the focus afterwards: the previous node of its row, else the next, else its parent
 */
export function focusAfterDelete(item, key) {
	const tree = mindTree(item)
	const e = tree.nodes.get(key)
	if (!e || e.parent === null) return null
	const row = rowOf(tree, key)
	const i = row.indexOf(key)
	return row[i - 1] ?? row[i + 1] ?? e.parent
}

/**
 * @param {object} item mind map item
 * @param {string} key a node
 * @return {string|null} the nearest node at or above it that the layout shows (null: gone)
 */
export function visibleAncestor(item, key) {
	const tree = mindTree(item)
	let e = tree.nodes.get(key)
	if (!e) return null
	let shown = key
	while (e.parent !== null) {
		const p = tree.nodes.get(e.parent)
		if (p.n.f === true && p.parent !== null) shown = p.key
		e = p
	}
	return shown
}

/**
 * Where a dragged node would go when dropped at a point of the layout: the
 * node under it, the dragged subtree passed over (job 196: drawn under the
 * pointer while it is dragged); its top or bottom quarter (job 198, org:
 * its left or right quarter) means before or after it (never beside the
 * root), the rest a new child. Nothing there: null (job 196: the node is
 * placed freely; job 198: in org and tree nothing changes).
 *
 * @param {object} item mind map item
 * @param {ReturnType<typeof mindmapLayout>} layout layout
 * @param {string} key the dragged node
 * @param {number} lx point relative to the item's corner
 * @param {number} ly point
 * @param {number} [tol] tolerance
 * @return {{key: string, where: ('child'|'before'|'after'), side: ('l'|'r'|null)}|null}
 */
export function dropTarget(item, layout, key, lx, ly, tol = 0) {
	if (!layout || !Number.isFinite(lx) || !Number.isFinite(ly)) return null
	const tree = mindTree(item)
	const others = layout.nodes.filter((x) => !inSubtree(tree, key, x.key))
	const hit = nodeAtLayout({ nodes: others }, lx, ly, tol)
	if (!hit) return null
	const n = layout.byKey.get(hit.key)
	if (n.parent === null) {
		const side = tree.layout === 'both' && lx < n.x + n.w / 2 ? 'l' : 'r'
		return { key: hit.key, where: 'child', side }
	}
	const where = tree.layout === 'org'
		? (lx < n.x + n.w / 4 ? 'before' : lx > n.x + (3 * n.w) / 4 ? 'after' : 'child')
		: (ly < n.y + n.h / 4 ? 'before' : ly > n.y + (3 * n.h) / 4 ? 'after' : 'child')
	return { key: hit.key, where, side: null }
}

/**
 * A mind map as a local preview shows it: the text of the open editor, or
 * (job 196) a patch with the node being dragged (ghost). With an anchor
 * (the root's corner in the stored layout) its layout keeps the root there
 * (properties mmAnchor and mmGhost that are not enumerable: never on the
 * wire).
 *
 * @param {object} item mind map item
 * @param {{key?: string, text?: string, patch?: object, ghost?: string, anchor?: ({x: number, y: number}|null)}|null} p
 *   preview
 * @return {object} the item to draw (a copy with that text; the item itself without a preview)
 */
export function previewMindmap(item, p) {
	if (p && item && isMap(p.patch)) {
		// job 196: a node being dragged, drawn as if dropped (placeNode's patch); its subtree (ghost) is no obstacle,
		// and its old room stays empty
		const out = applyMindmapPatch(item, p.patch)
		if (p.anchor && Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y)) {
			Object.defineProperty(out, 'mmAnchor', { value: { x: p.anchor.x, y: p.anchor.y }, enumerable: false })
		}
		const tree = mindTree(item)
		const e = typeof p.ghost === 'string' ? tree.nodes.get(p.ghost) : null
		if (e) {
			// it keeps the room it had in its row and on its side: the rest of the map stays as it is drawn
			const ghost = { key: p.ghost, room: placeOf(e.n) === null, side: sideOf(tree, p.ghost) }
			Object.defineProperty(out, 'mmGhost', { value: ghost, enumerable: false })
		}
		return out
	}
	if (!p || !item || typeof p.key !== 'string' || typeof p.text !== 'string' || !nodesOf(item.data).has(p.key)) return item
	const out = { ...item, data: { ...item.data } }
	if (p.anchor && Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y)) {
		Object.defineProperty(out, 'mmAnchor', { value: { x: p.anchor.x, y: p.anchor.y }, enumerable: false })
	}
	const texts = isMap(item.data.texts) ? { ...item.data.texts } : {}
	const b = bucketOf(p.key)
	const pot = isMap(texts[b]) ? { ...texts[b] } : {}
	if (p.text === '') delete pot[p.key]
	else pot[p.key] = p.text
	if (Object.keys(pot).length > 0) texts[b] = pot
	else delete texts[b]
	if (Object.keys(texts).length > 0) out.data.texts = texts
	else delete out.data.texts
	return out
}

// ---- the indented list in and out -----------------------------------

/** Bullet characters of a list line. */
const BULLETS = '-*+•◦▪‣–—·○■□'
/** One line of an indented list: indent, an optional marker with white space after it, the text. */
const LINE_RE = new RegExp('^([ \\t]*)(?:([' + BULLETS.replace('-', '\\-') + '])[ \\t]+|(\\d{1,3}[.)])[ \\t]+|([A-Za-z][.)])[ \\t]+|(o)\\t[ \\t]*)?(.*)$')
// a surrogate pair, or a lone surrogate
const PAIR_OR_LONE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g

/**
 * @param {string} s text
 * @return {string} well-formed, C0 controls (but tab) removed, at most MM_TEXT_MAX code points, trimmed
 */
function cleanLine(s) {
	const w = s.replace(PAIR_OR_LONE, (m) => (m.length === 2 ? m : '�')).replace(/[\x00-\x08\x0B-\x1F]/g, '')
	return Array.from(w).slice(0, MM_TEXT_MAX).join('').trim()
}

/**
 * Reads plain text as an indented list (job 195): every non-empty line is
 * an indent (spaces, a tab counts 4), optionally a bullet (BULLETS, "1."
 * "1)" "a." "a)", "o" only before a tab) with white space after it, and a
 * text without a tab. With at least two lines and two depths it is a tree:
 * a deeper line hangs below the line before it (an indent stack). When every
 * line has the same indent but a bullet, and two kinds of bullet appear
 * (Word's plain text), the first appearance of each kind gives its depth.
 * The only shallowest line, when it is the first, is the root; otherwise the
 * root is empty and the shallowest lines are its main branches.
 *
 * @param {unknown} text plain text
 * @return {{root: string, lines: Array<{depth: number, text: string}>}|null} depth ≥ 1 below the root, in order; null: no list
 */
export function parseOutline(text) {
	if (typeof text !== 'string') return null
	const rows = []
	for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
		if (raw.trim() === '') continue
		const m = LINE_RE.exec(raw)
		if (!m) return null
		const body = m[6]
		if (body.includes('\t')) return null
		let col = 0
		for (const ch of m[1]) col += ch === '\t' ? 4 : 1
		const marker = m[2] ?? (m[3] ? '1' : m[4] ? 'a' : m[5] ? 'o' : null)
		const t = cleanLine(body)
		if (t === '') continue
		rows.push({ col, marker, text: t })
	}
	if (rows.length < 2) return null
	const flat = rows.every((r) => r.col === rows[0].col)
	if (flat) {
		const kinds = []
		if (!rows.every((r) => r.marker !== null)) return null
		for (const r of rows) if (!kinds.includes(r.marker)) kinds.push(r.marker)
		if (kinds.length < 2) return null
		for (const r of rows) r.col = kinds.indexOf(r.marker)
	}
	const stack = []
	const depths = rows.map((r) => {
		while (stack.length > 0 && stack[stack.length - 1] >= r.col) stack.pop()
		stack.push(r.col)
		return stack.length - 1
	})
	if (Math.max(...depths) < 1) return null
	const tops = depths.filter((d) => d === 0).length
	if (tops === 1 && depths[0] === 0) {
		return { root: rows[0].text, lines: rows.slice(1).map((r, i) => ({ depth: depths[i + 1], text: r.text })) }
	}
	return { root: '', lines: rows.map((r, i) => ({ depth: depths[i] + 1, text: r.text })) }
}

/**
 * The data of a mind map from an indented list (parseOutline): the main
 * branches alternate between the sides (the one with fewer, a tie right)
 * with MM_COLORS in turn; the order follows the list. What goes beyond
 * maxNodes nodes or maxBytes bytes is left out, from the end of the list.
 *
 * @param {{root: string, lines: Array<{depth: number, text: string}>}} outline parseOutline
 * @param {{rand?: () => number, maxNodes?: number, maxBytes?: number}} [o] random numbers, limits
 * @return {{data: object, cut: number}} cut: how many lines were left out
 */
export function mindmapFromOutline(outline, { rand = Math.random, maxNodes = MM_MAX_NODES, maxBytes = MM_MAX_BYTES } = {}) {
	const nodes = {}
	const texts = {}
	const taken = new Set()
	const add = (node, text) => {
		const key = newNodeKey({}, rand, taken)
		taken.add(key)
		const b = bucketOf(key)
		nodes[b] = nodes[b] ?? {}
		nodes[b][key] = node
		if (text !== '') {
			texts[b] = texts[b] ?? {}
			texts[b][key] = text
		}
		return key
	}
	const root = add({ o: keyBetween(null, null) }, outline.root)
	const lines = outline.lines
	const enc = new TextEncoder()
	const exact = () => mindmapBytes({ data: Object.keys(texts).length > 0 ? { nodes, texts } : { nodes } })
	// a running estimate; near the limit the exact size decides
	let guess = exact()
	const stack = [root]
	const lastO = new Map()
	let fit = 0
	let left = 0
	let right = 0
	let mains = 0
	for (let i = 0; i < lines.length; i++) {
		if (taken.size >= maxNodes) break
		const depth = Math.max(1, Math.min(lines[i].depth, stack.length))
		stack.length = depth
		const parent = stack[depth - 1]
		const o = keyBetween(lastO.get(parent) ?? null, null)
		const node = { o, p: parent }
		if (parent === root) {
			node.c = MM_COLORS[mains % MM_COLORS.length]
			if (left < right) node.d = 'l'
		}
		guess += enc.encode(JSON.stringify(node) + lines[i].text).length + 48
		const key = add(node, lines[i].text)
		if (guess > maxBytes - 4096 && exact() > maxBytes) {
			const b = bucketOf(key)
			delete nodes[b][key]
			if (Object.keys(nodes[b]).length === 0) delete nodes[b]
			if (texts[b]) {
				delete texts[b][key]
				if (Object.keys(texts[b]).length === 0) delete texts[b]
			}
			break
		}
		lastO.set(parent, o)
		if (parent === root) {
			mains++
			if (node.d === 'l') left++
			else right++
		}
		stack.push(key)
		fit = i + 1
	}
	const data = Object.keys(texts).length > 0 ? { nodes, texts } : { nodes }
	return { data, cut: lines.length - fit }
}

/**
 * "Copy as text": a node and its subtree (folded ones too) as an indented
 * list, one tab more per level, the node itself without one; the children
 * of the root right side first, then left (layout both), each in order;
 * line breaks in a text become spaces.
 *
 * @param {object} item mind map item
 * @param {string|null} [key] the top node (default: the root)
 * @return {string} the lines joined with "\n" ('' for a missing node)
 */
export function outlineText(item, key = null) {
	const tree = mindTree(item)
	const top = key ?? tree.root
	if (top === null || !tree.nodes.has(top)) return ''
	const lines = []
	const walk = (k, depth) => {
		lines.push('\t'.repeat(depth) + nodeText(item.data, k).replace(/\r?\n/g, ' '))
		let kids = tree.nodes.get(k).kids
		if (k === tree.root && tree.layout === 'both') kids = [...kids.filter((c) => mainSide(tree, c) > 0), ...kids.filter((c) => mainSide(tree, c) < 0)]
		for (const c of kids) walk(c, depth + 1)
	}
	walk(top, 0)
	return lines.join('\n')
}
