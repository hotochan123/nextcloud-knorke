/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 173 (AK1): src/model/table.js against
 * tests/fixtures/table-golden.json (the PHP TablesTest reads it as well):
 * the verdict on the data of a table, the order of columns and rows, the x of
 * the columns and w; the layout of a new table; the op builders and their
 * paths; the limits; the CSV export byte for byte.
 *
 * Factory job 174 (AK1): clipGrid (rows at CRLF, LF or CR, cells at tab,
 * quoted fields, short rows filled, a grid only with a tab or an HTML table,
 * the cleaning), neighbourCell in all four directions, and pasteCells (only
 * changed paths, new rows, cut, at most 50 paths per patch, checkTable after
 * every patch, the inverse back to the old data, held cells and bytes).
 *
 * Factory job 179 (AK4): csvSeparator by the language (";" with a decimal
 * comma), csvField quotes for the separator it is given, tableCsv with ";"
 * byte for byte against the new golden case, the old one unchanged.
 *
 * Factory job 185 (AK1): pasteCells adds columns at the right end (160
 * wide, ordered after the last one, free keys) up to 20, the column and row
 * paths before the first cell path, cut only beyond the 20th column or the
 * 50th row; a 21 × 51 grid in at most 50 paths per patch both ways, the
 * inverse back to the old data, w and h.
 *
 * Factory job 218 (AK4): splitGrid reads a quoted field whose lone " does
 * not end it literally; hasHtmlTable.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	CELL_RE, COL_KEY_RE, TABLE_COL_W, TABLE_MAX_COLS, TABLE_MAX_ROWS, TABLE_ROW_MIN, applyTablePatch, cellAtLayout, cellBox, cellOfPath, cellPath,
	checkTable, csvField, csvFileName, csvSeparator, deleteCol, deleteRow, estimateCellHeight, firstCell, insertCol, insertRow, newKey,
	newTableData, orderedCols, orderedRows, setCellText, setColWidth, stepCell, tableBytes, tableCsv, tableLayout, withSize,
	TABLE_CELL_MAX, TABLE_PATCH_PATHS, clipGrid, hasHtmlTable, neighbourCell, pasteCells, splitGrid,
} from '../../../src/model/table.js'
import { isPatchPath } from '../../../src/model/paths.js'
import { isValidKey, keysBetween } from '../../../src/model/zorder.js'

const golden = JSON.parse(readFileSync(new URL('../../fixtures/table-golden.json', import.meta.url), 'utf8'))

/** A deterministic random source. */
function seq(seed = 1) {
	let s = seed
	return () => {
		s = (s * 16807) % 2147483647
		return (s - 1) / 2147483646
	}
}

/** @return {object} a table item with the data of the first golden case (3 × 3) */
function table33(extra = {}) {
	return { id: '01JA0000000000000000000001', t: 'table', x: 0, y: 0, w: 480, h: 108, r: 0, data: structuredClone(golden.checks[0].data), style: {}, ...extra }
}

describe('table golden (AK1)', () => {
	test('every golden case gets the verdict of the fixture, the named cases included', () => {
		assert.ok(golden.checks.length >= 30)
		const wrong = golden.checks.filter((c) => checkTable(c.data) !== c.ok).map((c) => c.name)
		assert.deepEqual(wrong, [])
		const named = Object.fromEntries(golden.checks.map((c) => [c.name, c.ok]))
		for (const [name, ok] of Object.entries({
			'a new 3 × 3 table': true, '0 rows': false, '51 rows': false, '21 columns': false, 'width 39': false,
			'width 1001': false, 'column key C1234567a': false, 'orphan cell (no such column)': false,
			'1001 code points': false, 'extra key in data': false,
		})) {
			assert.equal(named[name], ok, name)
		}
	})

	test('order, x of the columns and w', () => {
		for (const o of golden.orders) {
			assert.equal(checkTable(o.data), true, o.name)
			assert.deepEqual(orderedCols(o.data).map((c) => c.key), o.cols, o.name)
			assert.deepEqual(orderedRows(o.data).map((r) => r.key), o.rows, o.name)
			const l = tableLayout({ data: o.data, style: {} })
			assert.deepEqual(l.cols.map((c) => c.x), o.x, o.name)
			assert.equal(l.w, o.w, o.name)
		}
	})

	test('the CSV of the example table, byte for byte: \'=1+1, -5 unchanged, quotes, CRLF, BOM', () => {
		const csv = tableCsv(golden.csv.item)
		assert.equal(csv, golden.csv.text)
		assert.deepEqual([...new TextEncoder().encode(csv)], [...new TextEncoder().encode(golden.csv.text)])
		assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM')
		assert.ok(csv.includes("'=1+1,-5,"), "'=1+1 and -5 unchanged")
		assert.ok(csv.endsWith('\r\n'))
	})
})

describe('table model', () => {
	test('a new table: 3 columns of 160, 3 empty rows, 480 × 108; random keys of the right form', () => {
		const data = newTableData(seq(7))
		assert.equal(checkTable(data), true)
		const cols = orderedCols(data)
		const rows = orderedRows(data)
		assert.equal(cols.length, 3)
		assert.equal(rows.length, 3)
		assert.ok(cols.every((c) => /^c[0-9a-z]{8}$/.test(c.key) && c.w === TABLE_COL_W && isValidKey(c.o)))
		assert.ok(rows.every((r) => /^r[0-9a-z]{8}$/.test(r.key) && isValidKey(r.o)))
		const l = tableLayout({ data, style: {} })
		assert.deepEqual([l.w, l.h, l.header], [480, 108, true])
		assert.deepEqual(l.rows.map((r) => r.h), [36, 36, 36])
		assert.notDeepEqual(newTableData(seq(8)), data, 'other keys with other random numbers')
	})

	test('row height: max(36, text height + 16) of its longest cell; the header bold; off: no header', () => {
		const it = table33()
		const [c1, c2] = orderedCols(it.data).map((c) => c.key)
		const [r1, r2] = orderedRows(it.data).map((r) => r.key)
		it.data.cells = { [c1]: { [r1]: 'Head', [r2]: 'x' }, [c2]: { [r2]: 'one\ntwo\nthree' } }
		const calls = []
		const measure = (text, width, bold) => {
			calls.push([text, width, bold])
			return text.split('\n').length * 19.2
		}
		const l = tableLayout(it, measure)
		assert.deepEqual(l.rows.map((r) => r.h), [36, 3 * 19.2 + 16, 36])
		assert.equal(l.h, 36 + 3 * 19.2 + 16 + 36)
		assert.deepEqual(calls.find((c) => c[0] === 'Head'), ['Head', 144, true], 'wrap width = column width − 16, bold header')
		assert.deepEqual(calls.find((c) => c[0] === 'x'), ['x', 144, false])
		calls.length = 0
		tableLayout({ ...it, style: { header: 'off' } }, measure)
		assert.equal(calls.find((c) => c[0] === 'Head')[2], false)
		assert.equal(estimateCellHeight('x', 144, false), 19.2)
		assert.ok(estimateCellHeight('x'.repeat(200), 144, false) > 19.2 * 5, 'long words wrap too')
		assert.equal(TABLE_ROW_MIN, 36)
	})

	test('cells: the path, the cell of a path, the cell under a point, its box, Tab order, the first cell', () => {
		const it = table33()
		const cols = orderedCols(it.data).map((c) => c.key)
		const rows = orderedRows(it.data).map((r) => r.key)
		const cell = cols[1] + '.' + rows[2]
		assert.match(cell, CELL_RE)
		assert.equal(cellPath(cell), `data.cells.${cols[1]}.${rows[2]}`)
		assert.ok(isPatchPath(cellPath(cell)))
		assert.equal(cellOfPath(cellPath(cell)), cell)
		assert.equal(cellOfPath('data.cells.' + cols[1]), null)
		const l = tableLayout(it)
		assert.equal(cellAtLayout(l, 170, 80), cell)
		assert.equal(cellAtLayout(l, -1, 10), null)
		assert.deepEqual(cellBox(l, cell), { x: 160, y: 72, w: 160, h: 36 })
		assert.equal(firstCell(it), cols[0] + '.' + rows[0])
		assert.equal(stepCell(it, cols[2] + '.' + rows[0], 1), cols[0] + '.' + rows[1], 'row by row')
		assert.equal(stepCell(it, cols[0] + '.' + rows[1], -1), cols[2] + '.' + rows[0])
		assert.equal(stepCell(it, cols[2] + '.' + rows[2], 1), null, 'after the last cell')
		assert.equal(stepCell(it, cols[0] + '.' + rows[0], -1), null, 'before the first cell')
	})

	test('op builders: the paths of the spec', () => {
		const it = table33()
		const cols = orderedCols(it.data).map((c) => c.key)
		const rows = orderedRows(it.data).map((r) => r.key)
		// insert a row below the first one: one path, ordered between row 1 and row 2
		const row = insertRow(it, { at: rows[0], where: 'below' }, seq(3))
		assert.deepEqual(Object.keys(row.p), ['data.rows.' + row.key])
		assert.deepEqual(row.inv, { ['data.rows.' + row.key]: null })
		const after = applyTablePatch(it, row.p)
		assert.deepEqual(orderedRows(after.data).map((r) => r.key), [rows[0], row.key, rows[1], rows[2]])
		assert.equal(orderedRows(applyTablePatch(it, insertRow(it, { at: rows[0], where: 'above' }, seq(4)).p).data)[0].key.length, 9)
		// a column to the left of the first one, 160 wide
		const col = insertCol(it, { at: cols[0], where: 'left' }, seq(5))
		assert.deepEqual(Object.keys(col.p), ['data.cols.' + col.key])
		assert.equal(col.p['data.cols.' + col.key].w, 160)
		assert.equal(orderedCols(applyTablePatch(it, col.p).data)[0].key, col.key)
		assert.equal(orderedCols(applyTablePatch(it, insertCol(it, {}, seq(6)).p).data)[3].w, 160, 'the "+" appends at the end')
		// delete a column: 2 paths; a row: its own path and one per column with a text there
		it.data.cells = { [cols[0]]: { [rows[1]]: 'a' }, [cols[2]]: { [rows[1]]: 'b', [rows[2]]: 'c' } }
		const dc = deleteCol(it, cols[2])
		assert.deepEqual(Object.keys(dc.p), ['data.cols.' + cols[2], 'data.cells.' + cols[2]])
		assert.deepEqual(dc.inv['data.cells.' + cols[2]], { [rows[1]]: 'b', [rows[2]]: 'c' }, 'undo brings the cells with their text')
		const dr = deleteRow(it, rows[1])
		assert.deepEqual(Object.keys(dr.p).sort(), ['data.cells.' + cols[0] + '.' + rows[1], 'data.cells.' + cols[2] + '.' + rows[1], 'data.rows.' + rows[1]].sort())
		assert.deepEqual(dr.inv['data.cells.' + cols[2] + '.' + rows[1]], 'b')
		assert.equal(checkTable(applyTablePatch(it, dr.p).data), true)
		assert.equal(checkTable(applyTablePatch(applyTablePatch(it, dr.p), dr.inv).data), true)
		assert.deepEqual(applyTablePatch(applyTablePatch(it, dr.p), dr.inv).data, it.data, 'undo restores the row')
		// a width: one path, whole units in 40–1000
		assert.deepEqual(setColWidth(it, cols[0], 250.4).p, { ['data.cols.' + cols[0] + '.w']: 250 })
		assert.deepEqual(setColWidth(it, cols[0], 10).p, { ['data.cols.' + cols[0] + '.w']: 40 })
		assert.deepEqual(setColWidth(it, cols[0], 5000).p, { ['data.cols.' + cols[0] + '.w']: 1000 })
		assert.deepEqual(setColWidth(it, cols[0], 160), { error: 'same' })
		// a text: one path, "" as null
		assert.deepEqual(setCellText(it, cols[0] + '.' + rows[0], 'Name'), { p: { [`data.cells.${cols[0]}.${rows[0]}`]: 'Name' }, inv: { [`data.cells.${cols[0]}.${rows[0]}`]: null } })
		assert.deepEqual(setCellText(it, cols[0] + '.' + rows[1], '').p, { [`data.cells.${cols[0]}.${rows[1]}`]: null })
		assert.deepEqual(setCellText(it, 'c99999999.' + rows[0], 'x'), { error: 'gone' })
	})

	test('a deleted row with 20 columns takes at most 21 paths; the last row and column stay', () => {
		const data = { cols: {}, rows: {}, cells: {} }
		const rand = seq(11)
		for (let i = 0; i < 20; i++) data.cols[newKey('c', data.cols, rand)] = { o: 'i' + '0123456789abcdefghij'[i], w: 40 }
		const r = newKey('r', {}, rand)
		data.rows[r] = { o: 'i0' }
		data.rows[newKey('r', data.rows, rand)] = { o: 'i1' }
		for (const c of Object.keys(data.cols)) data.cells[c] = { [r]: 'x' }
		const it = { t: 'table', w: 800, h: 72, data, style: {} }
		assert.equal(Object.keys(deleteRow(it, r).p).length, 21)
		const one = table33()
		const k = orderedRows(one.data)[0].key
		one.data.rows = { [k]: one.data.rows[k] }
		assert.deepEqual(deleteRow(one, k), { error: 'last' })
	})

	test('limits: 50 rows, 20 columns', () => {
		const it = table33()
		const rand = seq(13)
		for (let i = 3; i < TABLE_MAX_ROWS; i++) Object.assign(it, applyTablePatch(it, insertRow(it, {}, rand).p))
		assert.equal(orderedRows(it.data).length, 50)
		assert.deepEqual(insertRow(it, {}, rand), { error: 'rows' })
		for (let i = 3; i < TABLE_MAX_COLS; i++) Object.assign(it, applyTablePatch(it, insertCol(it, {}, rand).p))
		assert.equal(orderedCols(it.data).length, 20)
		assert.deepEqual(insertCol(it, {}, rand), { error: 'cols' })
		assert.equal(checkTable(it.data), true)
	})

	test('withSize writes w and h only where the measured size differs', () => {
		const it = table33()
		const cols = orderedCols(it.data).map((c) => c.key)
		const r = withSize(it, setColWidth(it, cols[0], 260))
		assert.deepEqual([r.p.w, r.inv.w, 'h' in r.p], [580, 480, false])
		const t = withSize(it, setCellText(it, cols[0] + '.' + orderedRows(it.data)[0].key, 'a\nb\nc'), (text) => text.split('\n').length * 19.2)
		assert.deepEqual([t.p.h, t.inv.h, 'w' in t.p], [Math.round((3 * 19.2 + 16 + 72) * 100) / 100, 108, false])
		const same = withSize(it, setCellText(it, cols[0] + '.' + orderedRows(it.data)[0].key, 'x'))
		assert.deepEqual(Object.keys(same.p).length, 1, 'one path when the size stays')
	})

	test('bytes as the server counts them (UTF-8 JSON of data and style)', () => {
		const it = table33({ style: { header: 'off' } })
		assert.equal(tableBytes(it), new TextEncoder().encode(JSON.stringify(it.data)).length + '{"header":"off"}'.length)
		it.data.cells = { [orderedCols(it.data)[0].key]: { [orderedRows(it.data)[0].key]: 'Ä' } }
		assert.equal(tableBytes(it), new TextEncoder().encode(JSON.stringify(it.data)).length + 16)
	})

	test('CSV fields and the file name', () => {
		assert.equal(csvField('=1+1'), "'=1+1")
		assert.equal(csvField('-5'), '-5')
		assert.equal(csvField('+3,5'), '"+3,5"', 'a number with a decimal comma stays, quoted for the comma')
		assert.equal(csvField('-x'), "'-x")
		assert.equal(csvField('@a'), "'@a")
		assert.equal(csvField('\tx'), "'\tx")
		// job 251 AK5: full-width formula signs and a leading line break
		assert.equal(csvField('＝1+1'), "'＝1+1")
		assert.equal(csvField('＋1'), "'＋1")
		assert.equal(csvField('－1'), "'－1")
		assert.equal(csvField('＠x'), "'＠x")
		assert.equal(csvField('\nx'), `"'\nx"`, 'defused and quoted for the LF')
		assert.equal(csvField('+3'), '+3', 'ASCII numbers stay numbers')
		assert.equal(csvField('=SUM(A1,A2)'), `"'=SUM(A1,A2)"`)
		assert.equal(csvField('a"b'), '"a""b"')
		assert.equal(csvField('a\rb'), '"a\rb"')
		assert.equal(csvField('plain'), 'plain')
		assert.equal(csvFileName('Workshop'), 'Workshop - Table.csv')
		assert.equal(csvFileName('a/b\\c:d*e?f"g<h>i|j\u0001'), 'a_b_c_d_e_f_g_h_i_j_ - Table.csv')
		assert.equal(csvFileName(''), 'Table.csv')
		const long = csvFileName('x'.repeat(300))
		assert.equal(Array.from(long).length, 100)
		assert.ok(long.endsWith(' - Table.csv'))
	})
})

describe('job 179: the CSV separator (AK4)', () => {
	test('csvSeparator: ";" for de, de_DE, fr and pt_BR; "," for en, en_GB, ja, an invalid and an unknown language', () => {
		for (const l of ['de', 'de_DE', 'fr', 'pt_BR']) assert.equal(csvSeparator(l), ';', l)
		for (const l of ['en', 'en_GB', 'ja', 'x!', '', null, undefined, 'xx']) assert.equal(csvSeparator(l), ',', String(l))
	})

	test('csvField with a separator: quoted for that separator only; formulas defused as before', () => {
		assert.equal(csvField('a;b', ';'), '"a;b"')
		assert.equal(csvField('a;b', ','), 'a;b')
		assert.equal(csvField('a;b'), 'a;b', 'the default is ","')
		assert.equal(csvField('a,b', ';'), 'a,b')
		assert.equal(csvField('3,5', ';'), '3,5', 'a decimal comma stays a number, unquoted')
		assert.equal(csvField('=1+1', ';'), "'=1+1")
		assert.equal(csvField('=SUM(A1;A2)', ';'), `"'=SUM(A1;A2)"`)
		assert.equal(csvField('a"b', ';'), '"a""b"')
		assert.equal(csvField('a\nb', ';'), '"a\nb"')
	})

	test('tableCsv(golden, ";") equals the new golden case byte for byte; the old case stays', () => {
		assert.equal(golden.csvSemicolon.sep, ';')
		const csv = tableCsv(golden.csv.item, ';')
		assert.deepEqual([...new TextEncoder().encode(csv)], [...new TextEncoder().encode(golden.csvSemicolon.text)])
		assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM')
		assert.ok(csv.includes("'=1+1;-5;"))
		assert.ok(csv.includes(';3,5;'), 'the decimal comma without quotes')
		assert.deepEqual([...new TextEncoder().encode(tableCsv(golden.csv.item, ','))], [...new TextEncoder().encode(golden.csv.text)], 'the old case')
		assert.equal(tableCsv(golden.csv.item), golden.csv.text, 'the default is ","')
	})
})

// ---- job 174 (AK1): keyboard and spreadsheet paste ------------------------------

const C3 = ['c00000001', 'c00000002', 'c00000003']
const R3 = ['r00000001', 'r00000002', 'r00000003']
const at = (c, r) => C3[c] + '.' + R3[r]
const TBL = '<html><body><table><tr><td>Name</td></tr></table></body></html>'

/** Applies patches in their order; checks every state on the way. */
function applyAll(item, patches, label) {
	let it = item
	for (const p of patches) {
		assert.ok(Object.keys(p).length <= TABLE_PATCH_PATHS, `${label}: ${Object.keys(p).length} paths`)
		it = applyTablePatch(it, p)
		assert.equal(checkTable(it.data), true, label + ': checkTable after every patch')
	}
	return it
}

/** The text of cell (c, r) by position in the order. */
function textAt(it, c, r) {
	const col = orderedCols(it.data)[c]?.key
	const row = orderedRows(it.data)[r]?.key
	return it.data.cells?.[col]?.[row] ?? ''
}

describe('job 174 AK1: clipGrid', () => {
	test('rows at CRLF, LF or CR, cells at tab; one trailing line break dropped', () => {
		assert.deepEqual(clipGrid('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']])
		assert.deepEqual(clipGrid('a\tb\rc\td\r'), [['a', 'b'], ['c', 'd']], 'CR line ends')
		assert.deepEqual(clipGrid('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']], 'LF line ends')
		assert.deepEqual(clipGrid('a\tb\n\n'), [['a', 'b'], ['', '']], 'only one trailing break goes')
	})

	test('a quoted field: "" is ", LF and tab stay in the cell; without its end the field is literal', () => {
		assert.deepEqual(clipGrid('"say ""hi""\nnext"\t"a\tb"\r\nx\ty\r\n'), [['say "hi"\nnext', 'a\tb'], ['x', 'y']])
		assert.deepEqual(clipGrid('""\tz'), [['', 'z']], 'an empty quoted field')
		assert.deepEqual(clipGrid('"open\tb'), [['"open', 'b']], 'no closing quote: literal')
		assert.deepEqual(clipGrid('a "b" c\td'), [['a "b" c', 'd']], 'quotes inside an unquoted field stay')
	})

	test('job 218 AK4: a quoted field whose lone " does not end it is literal and never swallows the next cells', () => {
		assert.deepEqual(splitGrid('"Hallo" sagte sie\tX\n"b"\tY'), [['"Hallo" sagte sie', 'X'], ['b', 'Y']])
		assert.deepEqual(splitGrid('"5" Monitor\n"x"'), [['"5" Monitor'], ['x']])
		assert.deepEqual(splitGrid('"a""b"\tc'), [['a"b', 'c']], 'a doubled quote inside stays a quote')
		assert.deepEqual(clipGrid('"Hallo" sagte sie\tX\r\n"b"\tY\r\n'), [['"Hallo" sagte sie', 'X'], ['b', 'Y']], 'the paste into a cell, too')
	})

	test('job 218: hasHtmlTable finds the element table in text/html only', () => {
		assert.equal(hasHtmlTable('<meta charset="utf-8"><TABLE border=1><tr><td>x</td></tr></TABLE>'), true)
		assert.equal(hasHtmlTable('<table>'), true)
		assert.equal(hasHtmlTable('<tablet>'), false)
		assert.equal(hasHtmlTable('<p>no</p>'), false)
		assert.equal(hasHtmlTable(null), false)
	})

	test('short rows are filled with empty cells', () => {
		assert.deepEqual(clipGrid('a\tb\tc\r\nd\r\ne\tf'), [['a', 'b', 'c'], ['d', '', ''], ['e', 'f', '']])
	})

	test('no tab and no table: no grid; a table with one row is 1 × 1', () => {
		assert.equal(clipGrid('just text'), null)
		assert.equal(clipGrid('two\nlines', '<p>two</p><p>lines</p>'), null)
		assert.equal(clipGrid(42, null), null)
		assert.deepEqual(clipGrid('Name\r\n', TBL), [['Name']])
		assert.deepEqual(clipGrid('Name', '<TABLE border=1><tr><td>Name</td></tr></TABLE>'), [['Name']], 'any case')
		assert.equal(clipGrid('Name', '<tablet>'), null, 'only the element table')
	})

	test('cleaned like the editor: well-formed, controls out, white space only is empty, cut to 1000 code points', () => {
		const [[a, b, c]] = clipGrid('x\u0001y\uD800\t  \t' + '😀'.repeat(TABLE_CELL_MAX + 5))
		assert.equal(a, 'xy\uFFFD')
		assert.equal(b, '')
		assert.equal(Array.from(c).length, TABLE_CELL_MAX)
		assert.equal(c, '😀'.repeat(TABLE_CELL_MAX), 'never half an emoji')
		assert.deepEqual(clipGrid('"a\r\nb"\tc'), [['a\nb', 'c']], 'CRLF in a quoted field becomes LF')
	})

	test('at most one row and one column more than a table can take', () => {
		const text = Array.from({ length: 60 }, () => Array(25).fill('x').join('\t')).join('\n')
		const g = clipGrid(text)
		assert.equal(g.length, TABLE_MAX_ROWS + 1)
		assert.ok(g.every((r) => r.length === TABLE_MAX_COLS + 1))
	})
})

describe('job 174 AK1: neighbourCell', () => {
	test('all four directions from the middle; null at the edges and for a cell that is gone', () => {
		const it = table33()
		assert.equal(neighbourCell(it, at(1, 1), 'left'), at(0, 1))
		assert.equal(neighbourCell(it, at(1, 1), 'right'), at(2, 1))
		assert.equal(neighbourCell(it, at(1, 1), 'up'), at(1, 0))
		assert.equal(neighbourCell(it, at(1, 1), 'down'), at(1, 2))
		assert.equal(neighbourCell(it, at(0, 1), 'left'), null)
		assert.equal(neighbourCell(it, at(2, 1), 'right'), null)
		assert.equal(neighbourCell(it, at(1, 0), 'up'), null)
		assert.equal(neighbourCell(it, at(1, 2), 'down'), null)
		assert.equal(neighbourCell(it, 'c99999999.r00000001', 'left'), null)
		assert.equal(neighbourCell(it, at(1, 1), 'sideways'), null)
	})
})

describe('job 174 AK1: pasteCells', () => {
	test('2 × 2 into the middle of 3 × 3: only the changed paths, an empty grid cell empties its target', () => {
		const it = table33()
		it.data.cells = { [C3[1]]: { [R3[1]]: 'A' }, [C3[2]]: { [R3[2]]: 'old' } }
		const r = pasteCells(it, at(1, 1), [['A', 'B'], ['C', '']], { rand: seq(3) })
		assert.equal(r.cut, false)
		assert.equal(r.rows, 0)
		assert.equal(r.cols, 0)
		assert.deepEqual(r.patches, [{ [`data.cells.${C3[2]}.${R3[1]}`]: 'B', [`data.cells.${C3[1]}.${R3[2]}`]: 'C', [`data.cells.${C3[2]}.${R3[2]}`]: null }])
		assert.deepEqual(r.inverse, [{ [`data.cells.${C3[2]}.${R3[1]}`]: null, [`data.cells.${C3[1]}.${R3[2]}`]: null, [`data.cells.${C3[2]}.${R3[2]}`]: 'old' }])
		const after = applyAll(it, r.patches, '2 × 2')
		assert.deepEqual([textAt(after, 1, 1), textAt(after, 2, 1), textAt(after, 1, 2), textAt(after, 2, 2)], ['A', 'B', 'C', ''])
		assert.deepEqual(pasteCells(after, at(1, 1), [['A', 'B'], ['C', '']]), { patches: [], inverse: [], cut: false, rows: 0, cols: 0 }, 'the same again: nothing')
	})

	test('4 rows from row 2 of 3: 2 new rows at the end, first the rows, then the cells, h measured in the last patch', () => {
		const it = table33()
		const r = pasteCells(it, at(0, 1), [['1'], ['2'], ['3'], ['4']], { rand: seq(5) })
		assert.equal(r.rows, 2)
		assert.equal(r.cut, false)
		const keys = Object.keys(r.patches[0])
		assert.ok(keys[0].startsWith('data.rows.') && keys[1].startsWith('data.rows.'), 'the new rows first')
		assert.equal(r.patches.at(-1).h, 5 * TABLE_ROW_MIN)
		assert.equal('w' in r.patches.at(-1), false, 'w stays')
		const after = applyAll(it, r.patches, '4 rows')
		assert.equal(orderedRows(after.data).length, 5)
		assert.deepEqual([1, 2, 3, 4].map((i) => textAt(after, 0, i)), ['1', '2', '3', '4'])
		assert.deepEqual(applyAll(after, r.inverse, 'inverse').data, it.data, 'the inverse gives the old data')
	})

	test('a 51st row: cut, the rest goes in', () => {
		const it = table33()
		const rows49 = Array.from({ length: 49 }, (_, i) => ['r' + i])
		const fits = pasteCells(it, at(0, 0), rows49, { rand: seq(9) })
		assert.deepEqual([fits.cut, fits.rows], [false, 46], '49 rows from the first: 46 new, 49 in all')
		const tall = pasteCells(it, at(0, 2), rows49, { rand: seq(9) })
		assert.deepEqual([tall.cut, tall.rows], [true, 47], 'from the third row the 51st does not fit')
		const t = applyAll(it, tall.patches, 'tall')
		assert.equal(orderedRows(t.data).length, TABLE_MAX_ROWS)
		assert.equal(textAt(t, 0, 49), 'r47')
	})

	test('a full 20 × 50 paste: no patch above 50 paths, checkTable after every patch, w/h together in the last; the inverse gives the old data', () => {
		const cols = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['c' + String(i + 1).padStart(8, '0'), { o: 'i' + '0123456789abcdefghij'[i], w: 40 }]))
		const it = { ...table33(), w: 800, h: 108, data: { cols, rows: structuredClone(table33().data.rows), cells: { c00000001: { r00000002: 'keep me?' } } } }
		const grid = Array.from({ length: 50 }, (_, r) => Array.from({ length: 20 }, (_, c) => (c === 0 && r === 1 ? '' : `${r}/${c}`)))
		const r = pasteCells(it, 'c00000001.r00000001', grid, { rand: seq(11) })
		assert.equal(r.rows, 47)
		assert.equal(r.cut, false)
		assert.ok(r.patches.length >= 21, r.patches.length + ' patches')
		const sizes = r.patches.filter((p) => 'h' in p || 'w' in p)
		assert.equal(sizes.length, 1, 'w/h only in one patch')
		assert.equal(sizes[0], r.patches.at(-1), 'the last')
		const after = applyAll(it, r.patches, '20 × 50')
		assert.equal(textAt(after, 19, 49), '49/19')
		assert.equal(textAt(after, 0, 1), '', 'the empty grid cell emptied its target')
		assert.equal(after.h, Math.round(tableLayout(after).h * 100) / 100, 'h measured like withSize')
		const back = applyAll(after, r.inverse, 'inverse 20 × 50')
		assert.deepEqual(back.data, it.data)
		assert.deepEqual([back.w, back.h], [800, 108])
		assert.ok(r.inverse.every((p) => Object.keys(p).length <= TABLE_PATCH_PATHS))
		const cellsFirst = r.inverse.flatMap((p) => Object.keys(p)).filter((k) => k !== 'w' && k !== 'h')
		const firstRow = cellsFirst.findIndex((k) => k.startsWith('data.rows.'))
		assert.ok(firstRow > 0 && cellsFirst.slice(firstRow).every((k) => k.startsWith('data.rows.')), 'the inverse: the cells, then the rows')
	})

	test('a held cell whose text changes and too many bytes: an error without patches', () => {
		const it = table33()
		it.data.cells = { [C3[1]]: { [R3[1]]: 'same' } }
		const held = (c) => c === at(1, 1)
		assert.deepEqual(pasteCells(it, at(0, 0), [['a', 'b'], ['c', 'other']], { held }), { error: 'held' })
		assert.equal(pasteCells(it, at(0, 0), [['a', 'b'], ['c', 'same']], { held }).patches.length, 1, 'a held cell whose text stays is no hindrance')
		assert.deepEqual(pasteCells(it, at(0, 0), [['x'.repeat(200), 'y']], { maxBytes: tableBytes(it) + 100 }), { error: 'bytes' })
		assert.deepEqual(pasteCells(it, 'c99999999.r00000001', [['a', 'b']]), { error: 'gone' })
	})
})

describe('job 185 AK1: pasteCells adds columns', () => {
	/** A table of n columns of 160 (keys c00000001 …) and the 3 rows of table33. */
	const wideTable = (n) => {
		const cols = Object.fromEntries(Array.from({ length: n }, (_, i) => ['c' + String(i + 1).padStart(8, '0'), { o: keysBetween(null, null, n)[i], w: TABLE_COL_W }]))
		return { ...table33(), w: n * TABLE_COL_W, data: { ...table33().data, cols } }
	}
	const cellPaths = (patches) => patches.flatMap((p) => Object.keys(p)).filter((k) => k.startsWith('data.cells.'))

	test('[a, b, c, d] from the second column of 3 × 3: 2 new columns of 160 at the right end, after the last one in grid order; 4 cell paths', () => {
		const it = table33()
		const r = pasteCells(it, at(1, 0), [['a', 'b', 'c', 'd']], { rand: seq(3) })
		assert.deepEqual([r.cols, r.rows, r.cut], [2, 0, false])
		assert.equal(cellPaths(r.patches).length, 4)
		const fresh = Object.entries(r.patches[0]).filter(([k]) => k.startsWith('data.cols.'))
		assert.equal(fresh.length, 2)
		assert.deepEqual(fresh.map(([, v]) => v), keysBetween('i2', null, 2).map((o) => ({ o, w: TABLE_COL_W })), 'keysBetween(last.o, null, 2), width 160')
		assert.ok(fresh.every(([k]) => COL_KEY_RE.test(k.slice('data.cols.'.length)) && !C3.includes(k.slice('data.cols.'.length))), 'new free keys')
		const after = applyAll(it, r.patches, 'a b c d')
		const cols = orderedCols(after.data)
		assert.deepEqual(cols.slice(0, 3).map((x) => x.key), C3, 'the old columns keep their place')
		assert.deepEqual(cols.slice(3).map((x) => 'data.cols.' + x.key), fresh.map(([k]) => k), 'the new ones at the right end in grid order')
		assert.deepEqual([1, 2, 3, 4].map((c) => textAt(after, c, 0)), ['a', 'b', 'c', 'd'])
		assert.equal(after.w, 5 * TABLE_COL_W, 'w measured: 800')
		assert.deepEqual(applyAll(after, r.inverse, 'inverse a b c d').data, it.data, 'the inverse removes the columns again')
	})

	test('4 × 4 from the bottom right cell of 3 × 3: 3 new columns and rows; every column and row path before the first cell path', () => {
		const it = table33()
		const grid = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => `${r}${c}`))
		const r = pasteCells(it, at(2, 2), grid, { rand: seq(5) })
		assert.deepEqual([r.cols, r.rows, r.cut], [3, 3, false])
		const keys = r.patches.flatMap((p) => Object.keys(p)).filter((k) => k !== 'w' && k !== 'h')
		const firstCell = keys.findIndex((k) => k.startsWith('data.cells.'))
		assert.equal(firstCell, 6)
		assert.ok(keys.slice(0, 3).every((k) => k.startsWith('data.cols.')) && keys.slice(3, 6).every((k) => k.startsWith('data.rows.')), 'first the columns, then the rows')
		assert.ok(keys.slice(firstCell).every((k) => k.startsWith('data.cells.')), 'then only cells')
		const after = applyAll(it, r.patches, '4 × 4')
		assert.deepEqual([orderedCols(after.data).length, orderedRows(after.data).length], [6, 6])
		assert.deepEqual([textAt(after, 2, 2), textAt(after, 5, 2), textAt(after, 2, 5), textAt(after, 5, 5)], ['00', '03', '30', '33'])
	})

	test('the 20th column is the limit: 18 wide from the third column fits; 21 wide is cut; a table of 20 columns gets none', () => {
		const it = table33()
		const row = (n) => [Array.from({ length: n }, (_, i) => 'v' + i)]
		const fits = pasteCells(it, at(2, 0), row(18), { rand: seq(7) })
		assert.deepEqual([fits.cols, fits.cut], [17, false])
		assert.equal(orderedCols(applyAll(it, fits.patches, '18 wide').data).length, TABLE_MAX_COLS)
		const wide = pasteCells(it, at(0, 0), row(21), { rand: seq(7) })
		assert.deepEqual([wide.cols, wide.cut], [17, true])
		const w = applyAll(it, wide.patches, '21 wide')
		assert.deepEqual([textAt(w, 0, 0), textAt(w, 19, 0)], ['v0', 'v19'], 'the rest goes in')
		const full = wideTable(TABLE_MAX_COLS)
		const none = pasteCells(full, 'c00000001.' + R3[0], row(21), { rand: seq(7) })
		assert.deepEqual([none.cols, none.cut], [0, true])
		assert.equal(Object.keys(none.patches.reduce((m, p) => ({ ...m, ...p }), {})).filter((k) => k.startsWith('data.cols.')).length, 0, 'no column path')
	})

	test('21 × 51 of "x" at the top left of 3 × 3: 17 columns, 47 rows, 1000 cell paths, w 3200 in the last patch; at most 50 paths, checkTable on every step both ways; the inverse gives the old data, w and h', () => {
		const it = table33()
		const grid = Array.from({ length: 51 }, () => Array(21).fill('x'))
		const r = pasteCells(it, at(0, 0), grid, { rand: seq(13) })
		assert.deepEqual([r.cols, r.rows, r.cut], [17, 47, true])
		assert.equal(cellPaths(r.patches).length, 1000)
		assert.equal(r.patches.at(-1).w, 3200)
		assert.equal(r.patches.at(-1).h, 50 * TABLE_ROW_MIN)
		assert.equal(r.patches.filter((p) => 'w' in p || 'h' in p).length, 1, 'w/h only in the last patch')
		assert.ok(r.patches.every((p) => Object.keys(p).length <= TABLE_PATCH_PATHS))
		assert.ok(r.inverse.every((p) => Object.keys(p).length <= TABLE_PATCH_PATHS))
		const after = applyAll(it, r.patches, '21 × 51')
		assert.deepEqual([orderedCols(after.data).length, orderedRows(after.data).length, after.w], [20, 50, 3200])
		assert.deepEqual([r.inverse.at(-1).w, r.inverse.at(-1).h], [480, 108], 'the old w/h in the last inverse patch')
		const back = applyAll(after, r.inverse, 'inverse 21 × 51')
		assert.deepEqual(back.data, it.data)
		assert.deepEqual([back.w, back.h], [480, 108])
	})
})
