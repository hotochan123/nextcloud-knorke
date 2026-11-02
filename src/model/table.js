/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Tables (factory job 173): the data form, its order, the layout, the op
 * builders, the limits and the CSV export. Pure; the server's mirror of
 * checkTable and the order is lib/Service/Tables.php, and
 * tests/fixtures/table-golden.json pins both sides.
 *
 * data of a table:
 *   cols   {"c<8>": {o: z key, w: 40–1000}}, 1–20 entries
 *   rows   {"r<8>": {o: z key}}, 1–50 entries
 *   cells  {"<col>": {"<row>": "text"}}, text 1–1000 code points after the
 *          cleaning of data.text; an empty cell is absent (the client sends
 *          null instead of ""), a cell needs its column and its row
 * The keys match COL_KEY_RE / ROW_KEY_RE and are random. Columns and rows are
 * ordered by o like z (byte order), then by their key. Through the order by
 * columns a column is deleted with 2 paths, a row with at most 21.
 *
 * Layout: font TABLE_FONT_SIZE, padding TABLE_PAD, a row is
 * max(TABLE_ROW_MIN, text height + 2 · TABLE_PAD) high (its longest cell),
 * w is the sum of the widths; the header (style.header 'on', the default)
 * is always the first row and bold. The text height comes from a measure
 * function (the scene measures with Konva; estimateCellHeight is the
 * deterministic stand-in for tests and for a scene without a renderer).
 *
 * Op builders give {p, inv} (patch and inverse patch, path → value) or
 * {error: 'rows'|'cols'|'bytes'|'gone'}; withSize() adds w and h of the
 * changed table when its measured size differs from the stored one.
 *
 * Job 174: neighbourCell (the arrow keys at the edge of a cell's text),
 * clipGrid (cells from a spreadsheet: text/plain split at line breaks and
 * tabs, quoted fields, a grid only with a tab or an HTML table) and
 * pasteCells (a grid from the open cell on: the patches, at most
 * TABLE_PATCH_PATHS paths each, every state between them a valid table;
 * job 185: new columns at the right end like new rows at the end).
 *
 * Job 218: hasHtmlTable (also the board's paste of cells as notes,
 * board/actions.js noteTexts), and splitGrid reads a quoted field whose lone
 * " does not end it literally.
 *
 * Job 220: splitGrid takes the separator (a CSV file's ";" or ","), and
 * gridRows gives its rows one by one (board/actions.js noteTexts stops early).
 *
 * Job 179: the CSV separator follows the language (csvSeparator); csvField
 * and tableCsv take it, "," by default. The board's CSV
 * (board/exportCsv.js) uses the same fields.
 */
import { shownText } from './richText.js'
import { LINE_HEIGHT } from './tokens.js'
import { cmpBytes, isValidKey, keyBetween, keysBetween } from './zorder.js'

/** Most rows and columns of a table. */
export const TABLE_MAX_ROWS = 50
export const TABLE_MAX_COLS = 20
/** Width bounds of a column and the width of a new one (world units). */
export const TABLE_COL_MIN = 40
export const TABLE_COL_MAX = 1000
export const TABLE_COL_W = 160
/** Text of a cell: font size, padding on every side, least row height (world units). */
export const TABLE_FONT_SIZE = 16
export const TABLE_PAD = 8
export const TABLE_ROW_MIN = 36
/** Most code points of one cell. */
export const TABLE_CELL_MAX = 1000
/** A new table: 3 × 3. */
export const TABLE_NEW_COLS = 3
export const TABLE_NEW_ROWS = 3
/** The server's MAX_ITEM_BYTES (limits.maxItemBytes when the initial state has none). */
export const TABLE_MAX_BYTES = 65536
/** (job 174) Most paths of one patch (Limits::MAX_PATCH_PATHS, sync/Replica.js MAX_PATCH_PATHS). */
export const TABLE_PATCH_PATHS = 50

export const COL_KEY_RE = /^c[0-9a-z]{8}$/
export const ROW_KEY_RE = /^r[0-9a-z]{8}$/
/** A cell as presence and the editor name it: "<col>.<row>". */
export const CELL_RE = /^(c[0-9a-z]{8})\.(r[0-9a-z]{8})$/

const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
// C0 controls except \t and \n (the cleaning of data.text, registry.js cleanText)
const CONTROL_RE = /[\x00-\x08\x0B-\x1F]/g
const DATA_KEYS = new Set(['cols', 'rows', 'cells'])

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * @param {string} col column key
 * @param {string} row row key
 * @return {string} the cell "<col>.<row>"
 */
export function cellKey(col, row) {
	return col + '.' + row
}

/**
 * @param {unknown} cell "<col>.<row>"
 * @return {{col: string, row: string}|null} its parts, null for any other value
 */
export function parseCell(cell) {
	const m = typeof cell === 'string' ? CELL_RE.exec(cell) : null
	return m ? { col: m[1], row: m[2] } : null
}

/**
 * @param {string} cell "<col>.<row>"
 * @return {string} its patch path data.cells.<col>.<row>
 */
export function cellPath(cell) {
	const c = parseCell(cell)
	return c ? 'data.cells.' + c.col + '.' + c.row : ''
}

/**
 * @param {unknown} path patch path
 * @return {string|null} the cell of a path data.cells.<col>.<row>, else null
 */
export function cellOfPath(path) {
	if (typeof path !== 'string' || !path.startsWith('data.cells.')) return null
	const parts = path.slice('data.cells.'.length).split('.')
	if (parts.length !== 2) return null
	const cell = parts[0] + '.' + parts[1]
	return parseCell(cell) ? cell : null
}

/**
 * The cleaning of data.text (registry.js cleanText): "\r\n" → "\n", C0
 * controls except \t and \n removed, well-formed UTF-16.
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
 * The verdict of the server (Tables::check) on the data of a table: the form
 * above, no further keys at any level, every cell in an existing column and
 * row, every text 1–TABLE_CELL_MAX code points after cleaning.
 *
 * @param {unknown} data data of a table item
 * @return {boolean}
 */
export function checkTable(data) {
	if (!isMap(data)) return false
	for (const k of Object.keys(data)) {
		if (!DATA_KEYS.has(k)) return false
	}
	const cols = data.cols
	const rows = data.rows
	if (!isMap(cols) || !isMap(rows)) return false
	const ck = Object.keys(cols)
	const rk = Object.keys(rows)
	if (ck.length < 1 || ck.length > TABLE_MAX_COLS || rk.length < 1 || rk.length > TABLE_MAX_ROWS) return false
	for (const k of ck) {
		const c = cols[k]
		if (!COL_KEY_RE.test(k) || !isMap(c) || !isValidKey(c.o) || typeof c.w !== 'number' || !Number.isFinite(c.w)
			|| c.w < TABLE_COL_MIN || c.w > TABLE_COL_MAX || Object.keys(c).some((x) => x !== 'o' && x !== 'w')) {
			return false
		}
	}
	for (const k of rk) {
		const r = rows[k]
		if (!ROW_KEY_RE.test(k) || !isMap(r) || !isValidKey(r.o) || Object.keys(r).some((x) => x !== 'o')) return false
	}
	if (!hasOwn(data, 'cells')) return true
	const cells = data.cells
	if (!isMap(cells)) return false
	for (const c of Object.keys(cells)) {
		const col = cells[c]
		if (!hasOwn(cols, c) || !isMap(col) || Object.keys(col).length === 0) return false
		for (const r of Object.keys(col)) {
			const t = cleaned(col[r])
			if (!hasOwn(rows, r) || t === null || t.n < 1 || t.n > TABLE_CELL_MAX) return false
		}
	}
	return true
}

/**
 * @param {{o: string}} a entry with its key k
 * @param {{o: string}} b entry with its key k
 * @return {number} the order of columns and rows: o like z, then the key
 */
function byOrder(a, b) {
	return cmpBytes(a.o, b.o) || cmpBytes(a.key, b.key)
}

/**
 * @param {number} w stored width
 * @return {number} the width drawn (TABLE_COL_MIN–TABLE_COL_MAX; anything else TABLE_COL_W)
 */
function colWidth(w) {
	return typeof w === 'number' && Number.isFinite(w) ? Math.min(TABLE_COL_MAX, Math.max(TABLE_COL_MIN, w)) : TABLE_COL_W
}

/**
 * @param {unknown} data data of a table
 * @return {Array<{key: string, o: string, w: number}>} the columns in order (entries that break the form are left out)
 */
export function orderedCols(data) {
	const cols = isMap(data) && isMap(data.cols) ? data.cols : {}
	const out = []
	for (const key of Object.keys(cols)) {
		const c = cols[key]
		if (COL_KEY_RE.test(key) && isMap(c) && typeof c.o === 'string') out.push({ key, o: c.o, w: colWidth(c.w) })
	}
	return out.sort(byOrder)
}

/**
 * @param {unknown} data data of a table
 * @return {Array<{key: string, o: string}>} the rows in order (entries that break the form are left out)
 */
export function orderedRows(data) {
	const rows = isMap(data) && isMap(data.rows) ? data.rows : {}
	const out = []
	for (const key of Object.keys(rows)) {
		const r = rows[key]
		if (ROW_KEY_RE.test(key) && isMap(r) && typeof r.o === 'string') out.push({ key, o: r.o })
	}
	return out.sort(byOrder)
}

/**
 * @param {unknown} data data of a table
 * @param {string} col column key
 * @param {string} row row key
 * @return {string} the text of a cell ('' when empty)
 */
export function cellText(data, col, row) {
	const cells = isMap(data) && isMap(data.cells) ? data.cells : null
	const c = cells && hasOwn(cells, col) && isMap(cells[col]) ? cells[col] : null
	const v = c && hasOwn(c, row) ? c[row] : null
	return typeof v === 'string' ? v : ''
}

/**
 * @param {object} item table item
 * @return {boolean} the header row is shown (style.header is not 'off')
 */
export function hasHeader(item) {
	return item?.style?.header !== 'off'
}

/**
 * @param {object} item table item
 * @return {boolean} (job 265) the header column is shown (style.headerCol 'on')
 */
export function hasHeaderCol(item) {
	return item?.style?.headerCol === 'on'
}

/**
 * @param {object|null} layout tableLayout
 * @param {string} cell "<col>.<row>"
 * @return {boolean} (job 265) the cell is in the header row or the header column (bold, on the header fill)
 */
export function isHeadCell(layout, cell) {
	const c = parseCell(cell)
	return !!layout && c !== null && ((layout.header && layout.rows[0]?.key === c.row) || (layout.headerCol === true && layout.cols[0]?.key === c.col))
}

/**
 * Deterministic text height of a cell (tests, a scene without a renderer):
 * greedy word wrap with glyphs of 0.55 (bold 0.6) × the font size, words
 * longer than a line broken, one line per paragraph at least.
 *
 * @param {string} text cell text
 * @param {number} width wrap width (column width − 2 · TABLE_PAD)
 * @param {boolean} bold header row
 * @return {number} lines × TABLE_FONT_SIZE × LINE_HEIGHT
 */
export function estimateCellHeight(text, width, bold) {
	const glyph = TABLE_FONT_SIZE * (bold ? 0.6 : 0.55)
	const per = Math.max(1, Math.floor(Math.max(1, width) / glyph))
	let lines = 0
	// job 279: Markdown marks take no room
	for (const para of shownText(String(text)).split('\n')) {
		let cur = 0
		lines++
		for (const word of para.split(' ')) {
			let len = Array.from(word).length
			if (cur > 0 && cur + 1 + len > per) {
				lines++
				cur = 0
			} else if (cur > 0) {
				cur++
			}
			while (len > per) {
				lines++
				len -= per
			}
			cur += len
		}
	}
	return lines * TABLE_FONT_SIZE * LINE_HEIGHT
}

/**
 * The layout of a table: its columns with x and w, its rows with y and h
 * (each as high as its longest cell, at least TABLE_ROW_MIN), the size and
 * whether the first row is the header.
 *
 * @param {object} item table item (data, style)
 * @param {(text: string, width: number, bold: boolean) => number} [measure] text height of a cell
 * @return {{cols: Array<{key: string, x: number, w: number}>, rows: Array<{key: string, y: number, h: number}>,
 *   w: number, h: number, header: boolean, headerCol: boolean}} (job 265: headerCol, the first column is bold)
 */
export function tableLayout(item, measure = estimateCellHeight) {
	const data = item?.data
	const header = hasHeader(item)
	const headerCol = hasHeaderCol(item)
	let x = 0
	const cols = orderedCols(data).map((c) => {
		const out = { key: c.key, x, w: c.w }
		x += c.w
		return out
	})
	let y = 0
	const rows = orderedRows(data).map((r, i) => {
		let h = TABLE_ROW_MIN
		cols.forEach((c, j) => {
			const text = cellText(data, c.key, r.key)
			if (text === '') return
			const th = measure(text, c.w - 2 * TABLE_PAD, (header && i === 0) || (headerCol && j === 0))
			if (Number.isFinite(th)) h = Math.max(h, th + 2 * TABLE_PAD)
		})
		const out = { key: r.key, y, h }
		y += h
		return out
	})
	return { cols, rows, w: x, h: y, header, headerCol }
}

/**
 * @param {ReturnType<typeof tableLayout>} layout layout
 * @param {number} lx x in the table (0 = its left edge)
 * @param {number} ly y in the table
 * @return {string|null} the cell there, null outside every cell
 */
export function cellAtLayout(layout, lx, ly) {
	if (!layout || layout.cols.length === 0 || layout.rows.length === 0 || lx < 0 || ly < 0) return null
	const col = layout.cols.find((c) => lx >= c.x && lx < c.x + c.w) ?? (lx <= layout.w ? layout.cols[layout.cols.length - 1] : null)
	const row = layout.rows.find((r) => ly >= r.y && ly < r.y + r.h) ?? (ly <= layout.h ? layout.rows[layout.rows.length - 1] : null)
	return col && row ? cellKey(col.key, row.key) : null
}

/**
 * @param {ReturnType<typeof tableLayout>} layout layout
 * @param {string} cell "<col>.<row>"
 * @return {{x: number, y: number, w: number, h: number}|null} the cell's box in the table, null when it is not there
 */
export function cellBox(layout, cell) {
	const c = parseCell(cell)
	if (!c || !layout) return null
	const col = layout.cols.find((x) => x.key === c.col)
	const row = layout.rows.find((x) => x.key === c.row)
	return col && row ? { x: col.x, y: row.y, w: col.w, h: row.h } : null
}

/**
 * Tab and Shift+Tab: the cells row by row.
 *
 * @param {object} item table item
 * @param {string} cell current cell
 * @param {1|-1} dir 1 = next, −1 = previous
 * @return {string|null} the next (previous) cell, null after the last (before the first)
 */
export function stepCell(item, cell, dir) {
	const c = parseCell(cell)
	if (!c) return null
	const cols = orderedCols(item?.data).map((x) => x.key)
	const rows = orderedRows(item?.data).map((x) => x.key)
	const ci = cols.indexOf(c.col)
	const ri = rows.indexOf(c.row)
	if (ci < 0 || ri < 0) return null
	const i = ri * cols.length + ci + dir
	if (i < 0 || i >= cols.length * rows.length) return null
	return cellKey(cols[i % cols.length], rows[Math.floor(i / cols.length)])
}

/**
 * (Job 174) The arrow keys at the edge of a cell's text: the cell beside it
 * in the same row (left, right) or column (up, down), in the order.
 *
 * @param {object} item table item
 * @param {string} cell current cell
 * @param {'left'|'right'|'up'|'down'} dir direction
 * @return {string|null} the neighbouring cell, null at the table's edge (or for a cell that is gone)
 */
export function neighbourCell(item, cell, dir) {
	const c = parseCell(cell)
	if (!c) return null
	const cols = orderedCols(item?.data).map((x) => x.key)
	const rows = orderedRows(item?.data).map((x) => x.key)
	const ci = cols.indexOf(c.col)
	const ri = rows.indexOf(c.row)
	if (ci < 0 || ri < 0) return null
	const dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
	const dr = dir === 'up' ? -1 : dir === 'down' ? 1 : 0
	if (dc === 0 && dr === 0) return null
	const col = cols[ci + dc]
	const row = rows[ri + dr]
	return col !== undefined && row !== undefined ? cellKey(col, row) : null
}

/**
 * @param {object} item table item
 * @return {string|null} the cell at the top left (null without columns or rows)
 */
export function firstCell(item) {
	const cols = orderedCols(item?.data)
	const rows = orderedRows(item?.data)
	return cols.length > 0 && rows.length > 0 ? cellKey(cols[0].key, rows[0].key) : null
}

/**
 * @param {object} item table item
 * @param {string} cell "<col>.<row>"
 * @return {boolean} the column and the row of the cell exist
 */
export function hasCell(item, cell) {
	const c = parseCell(cell)
	const data = item?.data
	return !!c && isMap(data) && isMap(data.cols) && isMap(data.rows) && hasOwn(data.cols, c.col) && hasOwn(data.rows, c.row)
}

/**
 * A random column or row key that the table does not have yet.
 *
 * @param {'c'|'r'} prefix c (column) or r (row)
 * @param {Set<string>|object} taken keys in use (a Set or the cols/rows map)
 * @param {() => number} [rand] random numbers in [0, 1)
 * @return {string}
 */
export function newKey(prefix, taken, rand = Math.random) {
	const has = (k) => (taken instanceof Set ? taken.has(k) : isMap(taken) && hasOwn(taken, k))
	let k = prefix
	for (let attempt = 0; attempt < 16; attempt++) {
		k = prefix
		for (let i = 0; i < 8; i++) {
			const r = Number(rand())
			k += KEY_ALPHABET[Math.floor((Number.isFinite(r) ? Math.abs(r) % 1 : 0) * KEY_ALPHABET.length)]
		}
		if (!has(k)) return k
	}
	// a random source that repeats itself (tests): count up from the last key
	for (let n = 1; ; n++) {
		const tail = (parseInt(k.slice(1), 36) + n).toString(36).slice(-8).padStart(8, '0')
		if (!has(prefix + tail)) return prefix + tail
	}
}

/**
 * The data of a new table: TABLE_NEW_COLS columns of TABLE_COL_W, TABLE_NEW_ROWS empty rows.
 *
 * @param {() => number} [rand] random numbers
 * @return {{cols: object, rows: object}}
 */
export function newTableData(rand = Math.random) {
	const cols = {}
	const rows = {}
	keysBetween(null, null, TABLE_NEW_COLS).forEach((o) => {
		cols[newKey('c', cols, rand)] = { o, w: TABLE_COL_W }
	})
	keysBetween(null, null, TABLE_NEW_ROWS).forEach((o) => {
		rows[newKey('r', rows, rand)] = { o }
	})
	return { cols, rows }
}

/**
 * @param {Array<{key: string, o: string}>} list ordered columns or rows
 * @param {string|null} at key next to which the new one goes (null: at the end)
 * @param {'before'|'after'} side before or after `at`
 * @return {string} its o (keyBetween of its neighbours)
 */
function orderAt(list, at, side) {
	const i = at === null ? -1 : list.findIndex((x) => x.key === at)
	if (i < 0) return keyBetween(list.length > 0 ? list[list.length - 1].o : null, null)
	const lo = side === 'before' ? list[i - 1] ?? null : list[i]
	const hi = side === 'before' ? list[i] : list[i + 1] ?? null
	return keyBetween(lo ? lo.o : null, hi ? hi.o : null)
}

/**
 * A new empty row above or below a row, or at the end.
 *
 * @param {object} item table item
 * @param {{at?: (string|null), where?: ('above'|'below')}} [o] the row of the menu (null: at the end)
 * @param {() => number} [rand] random numbers
 * @return {{p: object, inv: object, key: string}|{error: string}}
 */
export function insertRow(item, { at = null, where = 'below' } = {}, rand = Math.random) {
	const rows = orderedRows(item?.data)
	if (rows.length >= TABLE_MAX_ROWS) return { error: 'rows' }
	const key = newKey('r', item?.data?.rows ?? {}, rand)
	const o = orderAt(rows, at, where === 'above' ? 'before' : 'after')
	return { p: { ['data.rows.' + key]: { o } }, inv: { ['data.rows.' + key]: null }, key }
}

/**
 * A new empty column (TABLE_COL_W) left or right of a column, or at the end.
 *
 * @param {object} item table item
 * @param {{at?: (string|null), where?: ('left'|'right')}} [o] the column of the menu (null: at the end)
 * @param {() => number} [rand] random numbers
 * @return {{p: object, inv: object, key: string}|{error: string}}
 */
export function insertCol(item, { at = null, where = 'right' } = {}, rand = Math.random) {
	const cols = orderedCols(item?.data)
	if (cols.length >= TABLE_MAX_COLS) return { error: 'cols' }
	const key = newKey('c', item?.data?.cols ?? {}, rand)
	const o = orderAt(cols, at, where === 'left' ? 'before' : 'after')
	return { p: { ['data.cols.' + key]: { o, w: TABLE_COL_W } }, inv: { ['data.cols.' + key]: null }, key }
}

/**
 * Deletes a row with its cells: data.rows.<row> and data.cells.<col>.<row>
 * of every column with a text there (at most 21 paths).
 *
 * @param {object} item table item
 * @param {string} row row key
 * @return {{p: object, inv: object}|{error: string}} error 'gone' (no such row) or 'last' (the only row)
 */
export function deleteRow(item, row) {
	const data = item?.data
	if (!isMap(data?.rows) || !hasOwn(data.rows, row)) return { error: 'gone' }
	if (Object.keys(data.rows).length <= 1) return { error: 'last' }
	const p = { ['data.rows.' + row]: null }
	const inv = { ['data.rows.' + row]: structuredClone(data.rows[row]) }
	for (const c of orderedCols(data)) {
		const text = cellText(data, c.key, row)
		if (text !== '') {
			p['data.cells.' + c.key + '.' + row] = null
			inv['data.cells.' + c.key + '.' + row] = text
		}
	}
	return { p, inv }
}

/**
 * Deletes a column with its cells: data.cols.<col> and data.cells.<col> (2 paths).
 *
 * @param {object} item table item
 * @param {string} col column key
 * @return {{p: object, inv: object}|{error: string}} error 'gone' (no such column) or 'last' (the only column)
 */
export function deleteCol(item, col) {
	const data = item?.data
	if (!isMap(data?.cols) || !hasOwn(data.cols, col)) return { error: 'gone' }
	if (Object.keys(data.cols).length <= 1) return { error: 'last' }
	const p = { ['data.cols.' + col]: null, ['data.cells.' + col]: null }
	const cells = isMap(data.cells) && isMap(data.cells[col]) ? structuredClone(data.cells[col]) : null
	const inv = { ['data.cols.' + col]: structuredClone(data.cols[col]), ['data.cells.' + col]: cells }
	return { p, inv }
}

/**
 * The width of a column (rounded to whole units, TABLE_COL_MIN–TABLE_COL_MAX).
 *
 * @param {object} item table item
 * @param {string} col column key
 * @param {number} w new width
 * @return {{p: object, inv: object}|{error: string}} error 'gone' (no such column) or 'same'
 */
export function setColWidth(item, col, w) {
	const data = item?.data
	if (!isMap(data?.cols) || !hasOwn(data.cols, col) || !Number.isFinite(w)) return { error: 'gone' }
	const v = Math.round(Math.min(TABLE_COL_MAX, Math.max(TABLE_COL_MIN, w)))
	const before = data.cols[col].w
	if (before === v) return { error: 'same' }
	return { p: { ['data.cols.' + col + '.w']: v }, inv: { ['data.cols.' + col + '.w']: before ?? null } }
}

/**
 * The text of a cell: one path data.cells.<col>.<row>; "" is sent as null.
 *
 * @param {object} item table item
 * @param {string} cell "<col>.<row>"
 * @param {string} text new text
 * @param {string} [before] text before (the undo value; default: the stored one)
 * @return {{p: object, inv: object}|{error: string}} error 'gone' when the column or the row is missing
 */
export function setCellText(item, cell, text, before = undefined) {
	if (!hasCell(item, cell)) return { error: 'gone' }
	const path = cellPath(cell)
	const c = parseCell(cell)
	const old = before === undefined ? cellText(item.data, c.col, c.row) : before
	return { p: { [path]: text === '' ? null : text }, inv: { [path]: old === '' || old === null ? null : old } }
}

/**
 * Applies a patch to a copy of a table (paths below data and style, w, h).
 *
 * @param {object} item table item
 * @param {object} p patch
 * @return {object} the changed copy
 */
export function applyTablePatch(item, p) {
	const out = structuredClone(item)
	for (const path of Object.keys(p)) {
		const keys = path.split('.')
		if (keys.length === 1) {
			out[path] = p[path]
			continue
		}
		let node = out
		const stack = []
		for (let i = 0; i < keys.length - 1; i++) {
			if (!isMap(node[keys[i]])) {
				if (p[path] === null) {
					node = null
					break
				}
				node[keys[i]] = {}
			}
			stack.push([node, keys[i]])
			node = node[keys[i]]
		}
		if (node === null) continue
		const leaf = keys[keys.length - 1]
		const v = p[path]
		if (v === null || (isMap(v) && Object.keys(v).length === 0)) {
			delete node[leaf]
			for (let i = stack.length - 1; i >= 1; i--) {
				const [parent, k] = stack[i]
				if (Object.keys(parent[k]).length > 0) break
				delete parent[k]
			}
		} else {
			node[leaf] = structuredClone(v)
		}
	}
	return out
}

/**
 * Adds w and h of the changed table to a patch (and their stored values to
 * the inverse) where its measured size differs from the stored one.
 *
 * @param {object} item table item before the change
 * @param {{p: object, inv: object}} r patch and inverse
 * @param {(text: string, width: number, bold: boolean) => number} [measure] text height of a cell
 * @return {{p: object, inv: object}} the same objects, completed
 */
export function withSize(item, r, measure = estimateCellHeight) {
	const after = applyTablePatch(item, r.p)
	const l = tableLayout(after, measure)
	const w = Math.round(l.w * 100) / 100
	const h = Math.round(l.h * 100) / 100
	if (w !== item.w && w >= 20) {
		r.p.w = w
		r.inv.w = item.w
	}
	if (h !== item.h && h >= 20) {
		r.p.h = h
		r.inv.h = item.h
	}
	return r
}

/** (job 174) An HTML table in the clipboard's text/html (only searched for, never parsed or shown). */
const HTML_TABLE_RE = /<table[\s>/]/i

/**
 * (Job 218) The clipboard comes from a spreadsheet: its text/html holds a
 * table element (Excel, LibreOffice Calc and Google Sheets give one, also
 * for a single column).
 *
 * @param {unknown} html text/html
 * @return {boolean}
 */
export function hasHtmlTable(html) {
	return typeof html === 'string' && HTML_TABLE_RE.test(html)
}

// a surrogate pair, or a lone surrogate (util/unicode.js wellFormed; the model imports nothing from util)
const PAIR_OR_LONE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g

/**
 * (Job 174) One text of a pasted grid, cleaned like the editor's text:
 * well-formed, CRLF → LF, C0 controls except tab and LF removed, then cut to
 * TABLE_CELL_MAX code points (as maxlength does); only white space is empty.
 *
 * @param {string} s raw field
 * @return {string}
 */
function cleanPasted(s) {
	const c = s.replace(PAIR_OR_LONE, (m) => (m.length === 2 ? m : '\uFFFD')).replace(/\r\n/g, '\n').replace(CONTROL_RE, '')
	if (c.trim() === '') return ''
	const cps = Array.from(c)
	return cps.length > TABLE_CELL_MAX ? cps.slice(0, TABLE_CELL_MAX).join('') : c
}

/**
 * (Job 174) Splits spreadsheet text into rows (at CRLF, LF or CR) and cells
 * (at tab). A field that starts with " is quoted: it ends at a " followed
 * by a tab, a line break or the end of the text; inside it "" is ", and tabs
 * and line breaks belong to the text. A quoted field without that end counts
 * literally, and so (job 218) does one whose first lone " is followed by
 * anything else (`"Hi" she said` never swallows the next cells). (Job 220)
 * sep replaces the tab (a CSV file's ';' or ',').
 *
 * @param {string} text text/plain without its trailing line break
 * @param {string} [sep] the cell separator, one character
 * @return {string[][]} the raw fields, row by row
 */
export function splitGrid(text, sep = '\t') {
	return [...gridRows(text, sep)]
}

/**
 * (Job 220) splitGrid row by row, so a reader can stop early (a CSV file of
 * 16 MiB costs only its first rows).
 *
 * @param {string} text text/plain without its trailing line break
 * @param {string} [sep] the cell separator, one character
 * @yield {string[]} the raw fields of each row
 */
export function* gridRows(text, sep = '\t') {
	const s = String(text)
	const n = s.length
	const ends = (c) => c === sep || c === '\n' || c === '\r'
	let row = []
	let i = 0
	for (;;) {
		let value = null
		if (s[i] === '"') {
			let out = ''
			let j = i + 1
			while (j < n) {
				if (s[j] === '"') {
					if (s[j + 1] === '"') {
						out += '"'
						j += 2
						continue
					}
					// job 218: a lone " that does not end the field: the field is not quoted
					if (j + 1 < n && !ends(s[j + 1])) j = n
					break
				}
				out += s[j]
				j++
			}
			if (j < n) {
				value = out
				i = j + 1
			}
		}
		if (value === null) {
			// unquoted (or a quoted field without its end: literally)
			let j = i
			while (j < n && !ends(s[j])) j++
			value = s.slice(i, j)
			i = j
		}
		row.push(value)
		if (i >= n) {
			yield row
			return
		}
		if (s[i] === sep) {
			i++
			continue
		}
		// a line break: CRLF, LF or CR
		i += s[i] === '\r' && s[i + 1] === '\n' ? 2 : 1
		yield row
		row = []
	}
}

/**
 * (Job 174) The grid of a paste into a cell, or null when the clipboard
 * holds none: a grid needs a tab in the text or an HTML table (Excel,
 * LibreOffice Calc and Google Sheets give one). The text loses one trailing
 * line break (CRLF, LF or CR); short rows are filled with empty cells; every
 * text is cleaned (cleanPasted). A table never takes more than
 * TABLE_MAX_ROWS × TABLE_MAX_COLS cells: the grid keeps at most one row and
 * one column more, enough to tell that a paste is cut.
 *
 * @param {unknown} text text/plain
 * @param {unknown} [html] text/html (only searched for a table element)
 * @return {string[][]|null} rows of cell texts ('' = empty), all of one length
 */
export function clipGrid(text, html = '') {
	const t = (typeof text === 'string' ? text : '').replace(/(?:\r\n|\n|\r)$/, '')
	if (!t.includes('\t') && !hasHtmlTable(html)) return null
	const raw = splitGrid(t).slice(0, TABLE_MAX_ROWS + 1).map((r) => r.slice(0, TABLE_MAX_COLS + 1))
	const width = raw.reduce((m, r) => Math.max(m, r.length), 1)
	return raw.map((r) => Array.from({ length: width }, (_, k) => cleanPasted(r[k] ?? '')))
}

/**
 * Cuts [path, value] entries into patches of at most TABLE_PATCH_PATHS paths
 * in their order; the entries of tail (w, h) all go into the last one.
 *
 * @param {Array<[string, unknown]>} list entries in order
 * @param {Array<[string, unknown]>} tail entries of the last patch
 * @return {object[]} patches
 */
function toPatches(list, tail) {
	const out = []
	for (let i = 0; i < list.length; i += TABLE_PATCH_PATHS) out.push(list.slice(i, i + TABLE_PATCH_PATHS))
	if (tail.length > 0) {
		if (out.length === 0) out.push([])
		const last = out[out.length - 1]
		if (last.length + tail.length > TABLE_PATCH_PATHS) out.push(last.splice(TABLE_PATCH_PATHS - tail.length))
		out[out.length - 1].push(...tail)
	}
	return out.map((x) => Object.fromEntries(x))
}

/**
 * (Job 174) A grid pasted into a cell: the cell is the top-left corner; the
 * grid fills the existing columns to the right and then (job 185) new
 * columns at the right end, up to TABLE_MAX_COLS, and the existing rows down
 * and then new rows at the end, up to TABLE_MAX_ROWS. What reaches beyond
 * the 20th column or the 50th row is left out (cut). A new column is one of
 * the "+" (TABLE_COL_W, ordered after the last one). An empty grid cell
 * empties its target; a cell whose text stays, and an empty grid cell in a
 * new column or row, gets no path.
 *
 * The patches: first the new columns (data.cols.<c>), then the new rows
 * (data.rows.<r>), then the cells (data.cells.<c>.<r>, empty as null), at
 * most TABLE_PATCH_PATHS paths each, w and h (measured like withSize, where
 * they differ) in the last one; every state between them passes checkTable.
 * The inverse patches bring the old state back in their order: first the
 * cells, then the removal of the new rows and columns, the old w and h in
 * the last one.
 *
 * @param {object} item table item
 * @param {string} cell the open cell
 * @param {string[][]} grid clipGrid
 * @param {{rand?: () => number, measure?: Function, maxBytes?: number, held?: (cell: string) => boolean}} [o]
 *   random numbers for the column and row keys, the text height of a cell, limits.maxItemBytes, a cell someone
 *   else holds
 * @return {{patches: object[], inverse: object[], cut: boolean, rows: number, cols: number}|{error: string}} rows,
 *   cols: how many are new; error 'gone' (no such cell or no grid), 'held' (someone else holds a cell whose text
 *   changes) or 'bytes' (a state above maxBytes)
 */
export function pasteCells(item, cell, grid, { rand = Math.random, measure = estimateCellHeight, maxBytes = TABLE_MAX_BYTES, held = () => false } = {}) {
	const c = parseCell(cell)
	if (!c || !hasCell(item, cell) || !Array.isArray(grid) || grid.length === 0) return { error: 'gone' }
	const data = item.data
	const cols = orderedCols(data)
	const rows = orderedRows(data)
	const ci = cols.findIndex((x) => x.key === c.col)
	const ri = rows.findIndex((x) => x.key === c.row)
	if (ci < 0 || ri < 0) return { error: 'gone' }
	const textAt = (r, k) => (Array.isArray(r) && typeof r[k] === 'string' ? r[k] : '')
	const width = grid.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 1)
	// job 185: new columns at the right end like new rows at the end, each up to its limit
	const extend = (list, map, prefix, need, max) => {
		const want = Math.max(0, need - list.length)
		const taken = new Set(Object.keys(map))
		const fresh = keysBetween(list.length > 0 ? list[list.length - 1].o : null, null, Math.min(want, max - list.length)).map((o) => {
			const key = newKey(prefix, taken, rand)
			taken.add(key)
			return { key, o }
		})
		return { fresh, cut: want > fresh.length }
	}
	const newCols = extend(cols, data.cols, 'c', ci + width, TABLE_MAX_COLS)
	const newRows = extend(rows, data.rows, 'r', ri + grid.length, TABLE_MAX_ROWS)
	const isNew = new Set([...newCols.fresh, ...newRows.fresh].map((x) => x.key))
	const colTargets = [...cols.slice(ci), ...newCols.fresh].slice(0, width)
	const targets = [...rows.slice(ri), ...newRows.fresh].slice(0, grid.length)
	const structP = [
		...newCols.fresh.map((x) => ['data.cols.' + x.key, { o: x.o, w: TABLE_COL_W }]),
		...newRows.fresh.map((x) => ['data.rows.' + x.key, { o: x.o }]),
	]
	const structInv = structP.map(([path]) => [path, null])
	const cellsP = []
	const cellsInv = []
	for (let gi = 0; gi < targets.length; gi++) {
		const row = targets[gi].key
		for (let gj = 0; gj < colTargets.length; gj++) {
			const col = colTargets[gj].key
			const text = textAt(grid[gi], gj)
			const old = isNew.has(row) || isNew.has(col) ? '' : cellText(data, col, row)
			if (text === old) continue
			if (held(cellKey(col, row))) return { error: 'held' }
			const path = 'data.cells.' + col + '.' + row
			cellsP.push([path, text === '' ? null : text])
			cellsInv.push([path, old === '' ? null : old])
		}
	}
	const all = [...structP, ...cellsP]
	const cut = newCols.cut || newRows.cut
	if (all.length === 0) return { patches: [], inverse: [], cut, rows: 0, cols: 0 }
	const size = withSize(item, { p: Object.fromEntries(all), inv: {} }, measure)
	const tail = ['w', 'h'].filter((k) => hasOwn(size.p, k))
	const patches = toPatches(all, tail.map((k) => [k, size.p[k]]))
	const inverse = toPatches([...cellsInv, ...structInv], tail.map((k) => [k, size.inv[k]]))
	let state = item
	for (const p of patches) {
		state = applyTablePatch(state, p)
		if (tableBytes(state) > maxBytes) return { error: 'bytes' }
	}
	return { patches, inverse, cut, rows: newRows.fresh.length, cols: newCols.fresh.length }
}

/**
 * The stored size of a table as the server counts it (strlen(data) + strlen(style), UTF-8 JSON).
 *
 * @param {object} item table item
 * @return {number} bytes
 */
export function tableBytes(item) {
	const enc = new TextEncoder()
	return enc.encode(JSON.stringify(item?.data ?? {})).length + enc.encode(JSON.stringify(item?.style ?? {})).length
}

/**
 * A CSV field that starts with one of these and is no number gets a leading
 * apostrophe; job 251: also LF and the full-width ＝ ＋ － ＠ (U+FF1D,
 * U+FF0B, U+FF0D, U+FF20) that a spreadsheet might read as a formula.
 */
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/
const NUMBER_RE = /^[+-]?\d+([.,]\d+)?$/

/**
 * The CSV separator of a language (job 179): ";" when Intl.NumberFormat
 * writes a decimal comma for it (de, fr, pt-BR, …), else ","; "_" counts as
 * "-" (Nextcloud's de_DE). A language that is no valid tag, or one Intl does
 * not know (it would fall back to the browser's own), gives ",".
 *
 * @param {unknown} lang language (util/l10n.js language)
 * @return {';'|','}
 */
export function csvSeparator(lang) {
	try {
		const tag = String(lang ?? '').replace(/_/g, '-')
		if (Intl.NumberFormat.supportedLocalesOf([tag]).length === 0) return ','
		const decimal = new Intl.NumberFormat(tag).formatToParts(1.5).find((p) => p.type === 'decimal')
		return decimal?.value === ',' ? ';' : ','
	} catch (e) {
		return ','
	}
}

/**
 * One CSV field: formulas defused with a leading apostrophe, quoted when it
 * holds ", the separator, CR or LF ("" inside).
 *
 * @param {string} text cell text
 * @param {string} [sep] separator (csvSeparator)
 * @return {string}
 */
export function csvField(text, sep = ',') {
	let s = String(text)
	if (FORMULA_START.test(s) && !NUMBER_RE.test(s)) s = "'" + s
	return /["\r\n]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * The CSV export of a table: UTF-8 with BOM, the separator, CRLF after every
 * row, the rows and columns in order (the header row as the first line).
 *
 * @param {object} item table item
 * @param {string} [sep] separator (csvSeparator)
 * @return {string}
 */
export function tableCsv(item, sep = ',') {
	const data = item?.data
	const cols = orderedCols(data)
	const lines = orderedRows(data).map((r) => cols.map((c) => csvField(cellText(data, c.key, r.key), sep)).join(sep) + '\r\n')
	return '﻿' + lines.join('')
}

/** Most characters of the file name of an export. */
export const CSV_NAME_MAX = 100

/**
 * The file name of an export: "<board title> - Table.csv", \ / : * ? " < > |
 * and control characters as "_", at most CSV_NAME_MAX characters (the title
 * is cut); without a title "Table.csv".
 *
 * @param {unknown} title board title
 * @return {string}
 */
export function csvFileName(title) {
	const suffix = ' - Table.csv'
	// eslint-disable-next-line no-control-regex
	const clean = String(title ?? '').replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, '_').trim()
	if (clean === '') return 'Table.csv'
	const room = CSV_NAME_MAX - suffix.length
	const cut = Array.from(clean).slice(0, room).join('')
	return cut + suffix
}

/**
 * A table as a local preview shows it (the scene: a column border being
 * dragged, the text of the open cell editor): the item with that width or
 * that cell text; the item itself without a preview.
 *
 * @param {object} item table item
 * @param {{col?: string, w?: number, cell?: string, text?: string}|null} p preview
 * @return {object} the item to draw and lay out
 */
export function previewTable(item, p) {
	if (!p || !item || !isMap(item.data)) return item
	const data = { ...item.data }
	if (typeof p.col === 'string' && Number.isFinite(p.w) && isMap(data.cols) && isMap(data.cols[p.col])) {
		data.cols = { ...data.cols, [p.col]: { ...data.cols[p.col], w: p.w } }
	}
	const c = parseCell(p.cell)
	if (c && typeof p.text === 'string') {
		const cells = isMap(data.cells) ? { ...data.cells } : {}
		const col = isMap(cells[c.col]) ? { ...cells[c.col] } : {}
		if (p.text === '') delete col[c.row]
		else col[c.row] = p.text
		cells[c.col] = col
		data.cells = cells
	}
	return { ...item, data }
}
