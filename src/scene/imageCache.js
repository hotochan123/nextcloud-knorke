/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The decoded pictures of own shapes (factory job 203), shared by every
 * scene of the page: one image per data URI, however many shapes show it.
 *
 * - pictureOf(item): the picture of a shape of kind image (its data.img
 *   joined and checked, model/shapeImage.js), cached per stored item object
 *   (the model replaces items on apply); null for anything else.
 * - imageFor(uri): the decoded image, or null while it loads or when it
 *   cannot be decoded; the first call starts loading. A finished load tells
 *   every listener of onImageReady (the scenes draw again).
 * - whenImagesReady(uris, ms): resolves once each picture has loaded or
 *   failed, at the latest after ms (the exports wait for their pictures).
 * At most IMAGE_CACHE_MAX pictures are kept, the least recently used one
 * goes first (it loads again when it is drawn again). Without a browser
 * Image (node tests) nothing loads, unless setImageFactory gave one.
 *
 * SECURITY (factory job 251): a picture, SVG too, is only ever drawn as an
 * image (img.src here, <img :src> in the panels, <image> in the SVG
 * export), where an SVG runs no script. The server checks SVG with a block
 * list only (lib/Service/ShapeImage.php), so never put a picture inline,
 * into an iframe/object/embed or a new window, or offer it as a file to
 * open: that needs an allow list first. tests/js/shell/svgOnlyAsImage.test.mjs
 * guards src/.
 */
import { isImageKind } from '../model/shapes.js'
import { joinImage } from '../model/shapeImage.js'

/** Pictures kept decoded. */
export const IMAGE_CACHE_MAX = 300

/** uri → {img, state: 'loading'|'ready'|'failed', waits: Function[]} in the order of use */
const cache = new Map()
const listeners = new Set()
/** stored item object → its picture (null: none) */
const pictures = new WeakMap()
let factory = () => (typeof Image === 'function' ? new Image() : null)

/**
 * @param {(() => object|null)|null} fn makes an image element (tests); null: the browser's Image
 */
export function setImageFactory(fn) {
	factory = typeof fn === 'function' ? fn : () => (typeof Image === 'function' ? new Image() : null)
	cache.clear()
}

/**
 * @param {object} item WireItem
 * @return {string|null} the picture of a shape of kind image, else null
 */
export function pictureOf(item) {
	if (!item || typeof item !== 'object') return null
	if (pictures.has(item)) return pictures.get(item)
	const uri = item.t === 'shape' && isImageKind(item.data?.kind) ? joinImage(item.data?.img) : null
	pictures.set(item, uri)
	return uri
}

/**
 * @param {string} uri picture
 * @param {object} e cache entry
 * @param {string} state its new state
 */
function settle(uri, e, state) {
	if (e.state !== 'loading') return
	e.state = state
	const waits = e.waits
	e.waits = []
	for (const w of waits) w()
	if (state === 'ready') {
		for (const fn of [...listeners]) {
			try {
				fn(uri)
			} catch (err) {
				// a listener never stops the others
			}
		}
	}
}

/**
 * @param {string} uri picture
 * @return {object|null} its cache entry, loading started; null without an image element
 */
function entry(uri) {
	let e = cache.get(uri)
	if (e) {
		cache.delete(uri)
		cache.set(uri, e)
		return e
	}
	const img = factory()
	if (!img) return null
	e = { img, state: 'loading', waits: [] }
	cache.set(uri, e)
	while (cache.size > IMAGE_CACHE_MAX) {
		const [old, oe] = cache.entries().next().value
		cache.delete(old)
		settle(old, oe, 'failed')
	}
	img.onload = () => settle(uri, e, img.naturalWidth > 0 || img.width > 0 ? 'ready' : 'failed')
	img.onerror = () => settle(uri, e, 'failed')
	img.src = uri
	if (img.complete && (img.naturalWidth > 0 || img.width > 0)) settle(uri, e, 'ready')
	return e
}

/**
 * @param {string|null} uri picture
 * @return {object|null} the decoded image, null while it loads or when it cannot be decoded
 */
export function imageFor(uri) {
	if (typeof uri !== 'string' || uri === '') return null
	const e = entry(uri)
	return e && e.state === 'ready' ? e.img : null
}

/**
 * @param {(uri: string) => void} fn called when a picture has loaded
 * @return {() => void} ends the subscription
 */
export function onImageReady(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

/**
 * @param {Iterable<string>} uris pictures
 * @param {number} ms longest wait
 * @return {Promise<void>} resolves when each has loaded or failed, or after ms
 */
export function whenImagesReady(uris, ms) {
	const open = []
	for (const uri of new Set(uris)) {
		const e = typeof uri === 'string' && uri !== '' ? entry(uri) : null
		if (e && e.state === 'loading') open.push(e)
	}
	if (open.length === 0) return Promise.resolve()
	return new Promise((resolve) => {
		let left = open.length
		const timer = setTimeout(resolve, ms)
		const one = () => {
			if (--left === 0) {
				clearTimeout(timer)
				resolve()
			}
		}
		for (const e of open) e.waits.push(one)
	})
}
