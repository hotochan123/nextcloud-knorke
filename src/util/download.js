/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A file download in the browser: a Blob behind an object URL and a hidden
 * <a download>, clicked once and removed. Factory job 173 brought it for
 * the CSV export of a table (downloadText); job 178 (save as image) hands a
 * PNG Blob to downloadBlob. The URL is revoked REVOKE_MS after the click:
 * Safari may still read it after the click has returned (a large image
 * takes a moment), and the object URL keeps the Blob alive only that long.
 * Nothing happens without a document (Node tests inject their own download).
 */

/** How long the object URL lives after the click (ms). */
export const REVOKE_MS = 40000

/**
 * @param {string} name file name
 * @param {Blob} blob file content
 * @param {Document|null} [doc] document (default: the global one)
 * @return {boolean} the download was started
 */
export function downloadBlob(name, blob, doc = globalThis.document ?? null) {
	if (!doc?.body || typeof doc.createElement !== 'function' || typeof URL?.createObjectURL !== 'function' || !blob) {
		return false
	}
	const url = URL.createObjectURL(blob)
	const a = doc.createElement('a')
	a.href = url
	a.download = name
	a.rel = 'noopener'
	a.style.display = 'none'
	doc.body.appendChild(a)
	try {
		a.click()
	} finally {
		a.remove()
		setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS)
	}
	return true
}

/**
 * @param {string} name file name
 * @param {string} text file content
 * @param {string} [type] MIME type
 * @param {Document|null} [doc] document (default: the global one)
 * @return {boolean} the download was started
 */
export function downloadText(name, text, type = 'text/csv;charset=utf-8', doc = globalThis.document ?? null) {
	if (typeof Blob !== 'function') {
		return false
	}
	return downloadBlob(name, new Blob([text], { type }), doc)
}
