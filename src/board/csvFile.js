/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * CSV files as notes (factory job 220), pure, the lazy part csv
 * (util/parts.js): BoardSession.insertCsvFile reads the bytes of a picked
 * .csv, .tsv or .txt file with readCsvFile and pastes the text with
 * actions.notesFromText and the separator found, like cells from a
 * spreadsheet (job 218).
 *
 * readCsvFile(bytes), the file's extension does not count:
 * 1. null, no bytes → invalid
 * 2. a ZIP (50 4B 03 04: .xlsx, .ods) or an OLE file (D0 CF 11 E0 A1 B1 1A
 *    E1: old .xls) → spreadsheet
 * 3. a BOM gives the encoding (UTF-8, UTF-16LE, UTF-16BE) and goes; else
 *    strict UTF-8, and when that fails windows-1252 (Excel's "CSV" on
 *    Windows)
 * 4. a text with U+0000 (a picture, a PDF, UTF-16 without BOM) → invalid
 * 5. else ok with the text and detectSeparator(text)
 *
 * detectSeparator(text) scans at most the first SNIFF_RECORDS records that
 * are not empty or SNIFF_CHARS characters (the record running then counts
 * too) and counts per record the tabs, ';' and ',' outside quotes (a " at
 * the start of a field opens them, "" is one character, any other lone "
 * closes them). A candidate occurs in the first record at least once. None:
 * the tab (one column, every line one note). Else the candidate that occurs
 * as often as in the first record in the most records wins; a tie goes to
 * more occurrences in the first record, then to the order tab, ';', ','.
 */

/** Separators a CSV file may use, in the order of a tie. */
export const CSV_SEPARATORS = Object.freeze(['\t', ';', ','])
/** Records detectSeparator looks at. */
export const SNIFF_RECORDS = 20
/** Characters detectSeparator looks at. */
export const SNIFF_CHARS = 65536

// windows-1252 at 0x80–0x9F (WHATWG Encoding); elsewhere it is Latin-1. Node's TextDecoder gives Latin-1 there
const CP1252 = [
	0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
	0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
]
const ZIP = [0x50, 0x4b, 0x03, 0x04]
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/**
 * @param {Uint8Array} b bytes
 * @param {number[]} head expected first bytes
 * @return {boolean}
 */
function startsWith(b, head) {
	return b.length >= head.length && head.every((x, i) => b[i] === x)
}

/**
 * @param {Uint8Array} b bytes without a known signature
 * @return {string} the text (a BOM decides the encoding and goes)
 */
function decode(b) {
	if (startsWith(b, [0xff, 0xfe])) {
		return new TextDecoder('utf-16le').decode(b)
	}
	if (startsWith(b, [0xfe, 0xff])) {
		return new TextDecoder('utf-16be').decode(b)
	}
	try {
		// a UTF-8 BOM goes here too (ignoreBOM false)
		return new TextDecoder('utf-8', { fatal: true }).decode(b)
	} catch {
		const u = new Uint16Array(b.length)
		for (let i = 0; i < b.length; i++) {
			u[i] = b[i] >= 0x80 && b[i] < 0xa0 ? CP1252[b[i] - 0x80] : b[i]
		}
		// the platform's byte order is little endian (x86, ARM)
		return new TextDecoder('utf-16le').decode(u)
	}
}

/**
 * Reads the bytes of a picked file (see the file comment).
 *
 * @param {Uint8Array|ArrayBuffer|null} bytes the file; null: over CSV_FILE_MAX_BYTES, not read
 * @return {{ok: true, text: string, sep: string}|{ok: false, error: ('invalid'|'spreadsheet')}}
 */
export function readCsvFile(bytes) {
	const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
	if (!(b instanceof Uint8Array)) {
		return { ok: false, error: 'invalid' }
	}
	if (startsWith(b, ZIP) || startsWith(b, OLE)) {
		return { ok: false, error: 'spreadsheet' }
	}
	const text = decode(b)
	if (text.includes('\0')) {
		return { ok: false, error: 'invalid' }
	}
	return { ok: true, text, sep: detectSeparator(text) }
}

/**
 * The separator of a CSV text (see the file comment).
 *
 * @param {string} text the file's text
 * @return {string} '\t', ';' or ','
 */
export function detectSeparator(text) {
	const s = String(text)
	const n = Math.min(s.length, SNIFF_CHARS)
	const records = []
	let counts = [0, 0, 0]
	let empty = true
	let quoted = false
	let start = true
	const end = () => {
		if (!empty) {
			records.push(counts)
		}
		counts = [0, 0, 0]
		empty = true
		start = true
	}
	for (let i = 0; i < n && records.length < SNIFF_RECORDS; i++) {
		const c = s[i]
		if (quoted) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					i++
				} else {
					quoted = false
				}
			}
			continue
		}
		if (c === '\n' || c === '\r') {
			if (c === '\r' && s[i + 1] === '\n') {
				i++
			}
			end()
			continue
		}
		empty = false
		const k = CSV_SEPARATORS.indexOf(c)
		if (k >= 0) {
			counts[k]++
			start = true
			continue
		}
		if (c === '"' && start) {
			quoted = true
		}
		start = false
	}
	if (records.length < SNIFF_RECORDS) {
		end()
	}
	const first = records[0]
	let best = -1
	let bestScore = -1
	for (let k = 0; first && k < CSV_SEPARATORS.length; k++) {
		if (first[k] === 0) {
			continue
		}
		const score = records.filter((r) => r[k] === first[k]).length
		if (score > bestScore || (score === bestScore && first[k] > first[best])) {
			best = k
			bestScore = score
		}
	}
	return best < 0 ? '\t' : CSV_SEPARATORS[best]
}
