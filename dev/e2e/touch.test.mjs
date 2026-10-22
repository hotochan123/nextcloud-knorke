/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the hotfix-H1 case (SPEC-M1 §35, Revision 24), no browser,
 * no stack:
 * - scenarios/index.mjs: E39 once, directly after E38, before E09 (own
 *   board, no instance setting); its flake gate --only E39 --repeat 8 named
 * - E39: phone 393 × 873, DPR 2.75, touch (isMobile, hasTouch) with the
 *   forced fine pointer; the phone gets pointer input only by touch
 *   (locator.tap, CDP Input.dispatchTouchEvent), never page.mouse or click;
 *   every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10); the double tap (5b) and the default fill
 *   check are there, E39_DEFAULT_FILL = DEFAULT_STICKY_FILL of tokens.js
 * - E39 step (7) (R38, SPEC-M1 §6.3 hold, then drag): there, it holds the
 *   finger ≥ 600 ms (E39_HOLD_MS) before it checks the ring (the hook
 *   [data-knorke-hold-ring], E39_RING_PX = HOLD_RING_PX) and the vibration
 *   counter window.__vib (E39_VIBRATE_MS = LONG_PRESS_VIBRATE_MS); the
 *   counter-check without the hold and the reduced-motion part are there,
 *   and the media emulation is reset in a finally
 * - lib/harness.mjs newActor: the options deviceScaleFactor and fine;
 *   finePointerInit answers (any-pointer: fine) with true and hands every
 *   other query to the browser's matchMedia
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/touch.mjs')

// harness.mjs reads env.json on import: a throwaway one
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-touch-'))
fs.writeFileSync(path.join(TMP, 'env.json'), JSON.stringify({ baseNet: 'http://kd.invalid', userPass: 'x', ns: 'd' }))
process.env.KD_ENV_JSON = path.join(TMP, 'env.json')
process.env.KD_E2E_OUT = TMP
const { finePointerInit } = await import('./lib/harness.mjs')
const touch = await import('./scenarios/touch.mjs')
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('index: E39 once, directly after E38, before E09; flake gate --only E39 --repeat 8', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E39').length, 1)
	assert.equal(list.indexOf('E39'), list.indexOf('E38') + 1, 'directly after E38')
	assert.ok(list.indexOf('E39') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E39 \} from '\.\/touch\.mjs'$/m)
	assert.ok(idx.includes('its flake gate is --only E39 --repeat 8.'), 'flake gate named')
})

test('E39: phone 393 × 873, DPR 2.75, touch with the forced fine pointer, guest over the edit link', () => {
	assert.equal(touch.E39.id, 'E39')
	assert.deepEqual({ ...touch.E39_VIEWPORT }, { width: 393, height: 873 })
	assert.equal(touch.E39_DPR, 2.75)
	assert.match(src, /world\.actor\('handy', \{ touch: true, viewport: E39_VIEWPORT, deviceScaleFactor: E39_DPR, fine: true \}\)/)
	assert.match(src, /\$\{APP\}\/p\/\$\{token\}/, 'joins over the public link page')
	assert.match(src, /'\[D\] Handy meldet Touch und \(any-pointer: fine\)'/)
	assert.match(src, /'\[C\] Modus edit/)
	assert.match(src, /'\[S\] ein Tipp mit dem Notiz-Werkzeug legt genau eine Notiz an'/)
	assert.match(src, /'\[C\] alice \(Desktop\) sieht die neue Notiz mit dem Text'/)
	// review B3: double tap (the select tap keeps its click) and the default fill (no ghost click on a swatch)
	assert.match(src, /'\[S\] Doppeltipp auf A öffnet den Editor/)
	assert.match(src, /'\[S\] die neue Notiz behält die Vorgabefarbe/)
	const tokens = fs.readFileSync(path.join(DIR, '..', '..', 'src', 'model', 'tokens.js'), 'utf8')
	assert.equal(touch.E39_DEFAULT_FILL, tokens.match(/^export const DEFAULT_STICKY_FILL = '(#[0-9a-f]{6})'$/m)?.[1], 'E39_DEFAULT_FILL = DEFAULT_STICKY_FILL')
})

test('E39: the phone gets pointer input only by touch (locator.tap, CDP touch events), never mouse or click', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /\.mouse\./, 'no page.mouse')
	assert.doesNotMatch(code, /\.click\(|\.dblclick\(/, 'no click()')
	assert.doesNotMatch(code, /\baction\(/, 'no harness action() (it clicks)')
	assert.doesNotMatch(code, /\btool\(p/, 'no harness tool() (it clicks)')
	assert.match(code, /\.tap\(\)/)
	assert.match(code, /Input\.dispatchTouchEvent', \{ type: 'touchStart'/)
	assert.match(code, /Input\.dispatchTouchEvent', \{ type: 'touchMove'/)
	assert.match(code, /Input\.dispatchTouchEvent', \{ type: 'touchEnd'/)
})

test('E39 step (7) (R38): hold ≥ 600 ms, then the ring and the vibration counter are checked; counter-check and reduced motion', () => {
	const tokens = fs.readFileSync(path.join(DIR, '..', '..', 'src', 'model', 'tokens.js'), 'utf8')
	const num = (name) => Number(tokens.match(new RegExp(`^export const ${name} = (\\d+)$`, 'm'))?.[1])
	assert.equal(touch.E39_RING_PX, num('HOLD_RING_PX'), 'E39_RING_PX = HOLD_RING_PX')
	assert.equal(touch.E39_VIBRATE_MS, num('LONG_PRESS_VIBRATE_MS'), 'E39_VIBRATE_MS = LONG_PRESS_VIBRATE_MS')
	const gesture = fs.readFileSync(path.join(DIR, '..', '..', 'src', 'scene', 'GestureController.js'), 'utf8')
	const longPress = Number(gesture.match(/^export const LONG_PRESS_MS = (\d+)$/m)?.[1])
	assert.ok(touch.E39_HOLD_MS >= 600 && touch.E39_HOLD_MS > longPress, `holds ${touch.E39_HOLD_MS} ms (≥ 600, > LONG_PRESS_MS ${longPress})`)
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.match(code, /t\.step\('\(7\) /, 'step (7)')
	assert.match(code, /await holdMarquee\(t, p, cdp, board\)/, 'step (7) runs after (6)')
	// the vibration counter is installed before the hold and checked after it
	const install = code.indexOf('navigator.vibrate = (pattern) =>')
	const hold = code.indexOf('await sleep(E39_HOLD_MS)')
	assert.ok(install > 0 && hold > install, 'navigator.vibrate is replaced before the hold')
	assert.match(code, /window\.__vib\.push\(pattern\)/)
	assert.match(code, /type: 'touchStart', touchPoints: \[\{ x: P\.x, y: P\.y \}\] \}\)\n\tawait sleep\(E39_HOLD_MS\)/, 'touchStart, then the hold')
	const after = code.slice(hold)
	assert.ok(after.indexOf('ringAt(r1, P)') > 0, 'the ring is checked after the hold')
	assert.ok(after.indexOf('JSON.stringify([E39_VIBRATE_MS])') > 0, 'the vibration counter is checked after the hold')
	assert.match(code, /const RING = '\[data-knorke-hold-ring\]'/)
	assert.match(src, /'\[S\] der Finger-Rahmen wählt genau X und Y aus'/)
	assert.match(src, /'\[S\] die Kamera bleibt beim Rahmen stehen'/)
	assert.match(src, /'\[S\] während und nach dem Schwenk gibt es keinen Ring'/)
	assert.match(src, /'\[S\] der Schwenk vibriert nicht'/)
	assert.match(src, /'\[S\] mit reduzierter Bewegung ohne Einblendung \(animation-name none\)'/)
	assert.match(code, /emulateMedia\(\{ reducedMotion: 'reduce' \}\)\n\ttry \{/)
	assert.match(code, /\} finally \{\n\t\tawait p\.emulateMedia\(\{ reducedMotion: null \}\)/, 'the emulation is reset in a finally')
})

test('E39: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 20, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
})

test('newActor: deviceScaleFactor and fine; finePointerInit forces only (any-pointer: fine)', () => {
	const h = read('lib/harness.mjs')
	assert.match(h, /deviceScaleFactor = null, fine = false \} = \{\}\) \{/)
	assert.match(h, /if \(deviceScaleFactor !== null\) opts\.deviceScaleFactor = deviceScaleFactor/)
	assert.match(h, /if \(fine\) await ctx\.addInitScript\(finePointerInit\)/)
	const saved = globalThis.window
	try {
		const asked = []
		globalThis.window = { matchMedia: (q) => { asked.push(q); return { matches: false, media: q } } }
		finePointerInit()
		assert.equal(window.matchMedia('(any-pointer: fine)').matches, true)
		assert.equal(window.matchMedia('( any-pointer : fine )').matches, true)
		assert.equal(window.matchMedia('(any-pointer: coarse)').matches, false)
		assert.equal(window.matchMedia('(pointer: fine)').matches, false, 'the primary pointer stays the browser\'s')
		assert.deepEqual(asked, ['(any-pointer: coarse)', '(pointer: fine)'], 'other queries go to the browser')
	} finally {
		globalThis.window = saved
	}
})
