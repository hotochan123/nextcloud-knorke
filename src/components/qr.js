/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * QR code of a link as SVG path data (SPEC-M1 §6.6 QrCode, R2):
 * qrcode-generator 1.5.2 (MIT, Kazuhiko Arase) with error correction M and
 * automatic version. No SVG string from the library and no innerHTML: the
 * modules become ONE path of unit squares (dark runs of a row merged), which
 * QrCode.vue binds as an attribute. The value is the link URL; nothing here
 * ends up as markup.
 *
 * (R14-11) Byte mode carries the UTF-8 bytes of the text. The library's
 * default qrcode.stringToBytes cuts every UTF-16 unit to its low byte (a host
 * or webroot with "ü" would scan as another URL), and its UTF-8 variant
 * would have to be installed globally. Instead the text is encoded here
 * (utf8Binary: one char per UTF-8 byte, all below 256), which the default
 * passes through unchanged; the global stays as it is.
 */
import qrcode from 'qrcode-generator'

/** Quiet zone in modules (the QR standard asks for 4). */
export const QR_MARGIN = 4

/**
 * The UTF-8 bytes of a text as a "binary string" (one char per byte,
 * char codes 0–255), the input for qrcode-generator's byte mode with its
 * default stringToBytes. Lone surrogates become U+FFFD (TextEncoder).
 *
 * @param {string} text text
 * @return {string} binary string of its UTF-8 bytes
 */
export function utf8Binary(text) {
	const bytes = new TextEncoder().encode(text)
	let out = ''
	for (const b of bytes) {
		out += String.fromCharCode(b)
	}
	return out
}

/**
 * @param {string} value text to encode (the link URL)
 * @param {{margin?: number, ecl?: 'L'|'M'|'Q'|'H'}} [o] quiet zone and error correction
 * @return {{size: number, modules: number, d: string}} viewBox size (modules + 2 × margin),
 *   module count and the path of the dark modules ('' for an empty value)
 */
export function qrPath(value, { margin = QR_MARGIN, ecl = 'M' } = {}) {
	const text = typeof value === 'string' ? value : ''
	if (text === '') {
		return { size: 0, modules: 0, d: '' }
	}
	const qr = qrcode(0, ecl)
	qr.addData(utf8Binary(text), 'Byte')
	qr.make()
	const count = qr.getModuleCount()
	const parts = []
	for (let r = 0; r < count; r++) {
		let c = 0
		while (c < count) {
			if (!qr.isDark(r, c)) {
				c++
				continue
			}
			const start = c
			while (c < count && qr.isDark(r, c)) {
				c++
			}
			parts.push(`M${start + margin} ${r + margin}h${c - start}v1h${start - c}z`)
		}
	}
	return { size: count + 2 * margin, modules: count, d: parts.join('') }
}
