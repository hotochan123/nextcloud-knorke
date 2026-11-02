/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/reactions.js (factory job 172, AK1): the emoji check against
 * tests/fixtures/reactions-golden.json (the same cases as
 * tests/php/unit/ReactionsTest.php), native ↔ hex, summarize (count,
 * order, mine, names), rowPlan by the width formula for w = 200 and w = 20,
 * the op (reactionPatch, isReactionPatch) and copies without reactions.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	QUICK_REACTIONS, entriesOf, fromHex, hasReactions, isEmoji, isReactPath, isReactionPatch, moreWidth, pillWidth, reactKey,
	reactionOf, reactionPatch, rowPlan, summarize, toHex, withoutReactions,
} from '../../../src/model/reactions.js'
import { REACT_ADD, REACT_BAND, REACT_DIGIT, REACT_EMOJI, REACT_EMOJI_GAP, REACT_GAP, REACT_H, REACT_PAD, REACT_SPACING } from '../../../src/model/tokens.js'

const GOLDEN = JSON.parse(readFileSync(new URL('../../fixtures/reactions-golden.json', import.meta.url), 'utf8'))
const ME = 'a1b2c3d4e5f60718'
const note = (react) => ({ id: 'n', t: 'sticky', data: { text: 'x', ...(react ? { react } : {}) } })

test('AK1: the golden cases – the six of the quick row, rocket, a family, England, keycap 1, Germany are valid; "", 41, upper case, a leading zero, a surrogate, an override, CJK and 11 code points are not', () => {
	assert.ok(GOLDEN.emoji.length > 30)
	const verdict = new Map(GOLDEN.emoji.map((c) => [c.e, c.valid]))
	for (const e of [...QUICK_REACTIONS, '1f680', '1f468-200d-1f469-200d-1f467-200d-1f466', '1f3f4-e0067-e0062-e0065-e006e-e0067-e007f', '31-fe0f-20e3', '1f1e9-1f1ea']) {
		assert.equal(verdict.get(e), true, e)
	}
	for (const e of ['', '41', '1F44D', '01f44d', 'd83d', '202e', '4e00', '1f44d-1f44d-1f44d-1f44d-1f44d-1f44d-1f44d-1f44d-1f44d-1f44d-1f44d']) {
		assert.equal(verdict.get(e), false, e)
	}
	for (const c of GOLDEN.emoji) {
		assert.equal(isEmoji(c.e), c.valid, `${c.note} (${c.e})`)
		if (c.valid) {
			assert.equal(toHex(c.native), c.e, 'native → hex: ' + c.note)
			assert.equal(fromHex(c.e), c.native, 'hex → native: ' + c.note)
			assert.equal(toHex(fromHex(c.e)), c.e, 'lossless: ' + c.note)
		}
	}
	for (const v of [null, undefined, 1, 0x1f44d, true, ['1f44d'], {}]) {
		assert.equal(isEmoji(v), false, String(v))
	}
	assert.deepEqual([...QUICK_REACTIONS], ['1f44d', '2764-fe0f', '1f602', '1f389', '1f914', '1f440'], '👍 ❤️ 😂 🎉 🤔 👀')
	assert.equal(toHex(''), null)
	assert.equal(fromHex('zz'), '')
})

test('keys and paths: p + 16 hex; data.react and below; a reaction patch is the one path data.react.<key>', () => {
	assert.equal(reactKey(ME), 'p' + ME)
	for (const bad of ['', 'A1B2C3D4E5F60718', 'a1b2', null, 7]) {
		assert.equal(reactKey(bad), null, String(bad))
	}
	assert.equal(isReactPath('data.react'), true)
	assert.equal(isReactPath('data.react.pX.e'), true)
	assert.equal(isReactPath('data.reactions'), false)
	assert.equal(isReactPath('style.react'), false)
	assert.equal(isReactionPatch({ o: 'patch', id: 'n', p: { ['data.react.p' + ME]: null } }), true)
	assert.equal(isReactionPatch({ o: 'patch', id: 'n', p: { ['data.react.p' + ME]: { e: '1f44d', n: 'A' } } }), true)
	assert.equal(isReactionPatch({ o: 'patch', id: 'n', p: { ['data.react.p' + ME]: null, 'data.text': 'x' } }), false, 'beside another path')
	assert.equal(isReactionPatch({ o: 'patch', id: 'n', p: { 'data.react': {} } }), false)
	assert.equal(isReactionPatch({ o: 'patch', id: 'n', p: { ['data.react.p' + ME + '.e']: '1f44d' } }), false)
	assert.equal(isReactionPatch({ o: 'put', id: 'n', p: { ['data.react.p' + ME]: null } }), false)
})

test('AK1: summarize – count, order (count descending, then e), mine and the names (localeCompare), whatever the key order', () => {
	const react = {
		pbbbbbbbbbbbbbbbb: { e: '2764-fe0f', n: 'Bob' },
		[`p${ME}`]: { e: '1f44d', n: 'Vic' },
		pcccccccccccccccc: { e: '1f44d', n: 'Carol' },
		pdddddddddddddddd: { e: '1f602', n: 'dora' },
		peeeeeeeeeeeeeeee: { e: '1f44d', n: 'Ann' },
		pffffffffffffffff: { e: '1f389', n: 'Fritz' },
		x1: { e: '1f44d', n: 'not a key' },
		p0000000000000000: { e: 'nope', n: 'bad e' },
		p0000000000000001: { e: '1f44d' },
	}
	const s = summarize(note(react), ME)
	assert.deepEqual(s.map((g) => [g.e, g.n, g.mine]), [['1f44d', 3, true], ['1f389', 1, false], ['1f602', 1, false], ['2764-fe0f', 1, false]])
	assert.deepEqual(s[0].names, [{ name: 'Ann', mine: false }, { name: 'Carol', mine: false }, { name: 'Vic', mine: true }])
	const reversed = Object.fromEntries(Object.entries(react).reverse())
	assert.deepEqual(summarize(note(reversed), ME), s, 'the key order does not matter')
	assert.deepEqual(summarize(note(react), null).map((g) => g.mine), [false, false, false, false], 'no pid: nothing is mine')
	assert.deepEqual(summarize(note(null), ME), [])
	assert.deepEqual(summarize({ t: 'sticky', data: { react: 'x' } }, ME), [])
	assert.equal(entriesOf(note(react)).length, 6, 'only valid entries count')
	assert.equal(hasReactions(note(react)), true)
	assert.equal(hasReactions(note(null)), false)
	assert.equal(reactionOf(note(react), ME), '1f44d')
	assert.equal(reactionOf(note(react), 'b'.repeat(16)), '2764-fe0f')
	assert.equal(reactionOf(note(null), ME), null)
})

test('AK1: rowPlan – pill 6 + 16 + 4 + 7 · digits + 6, "+n" 6 + 7 · characters + 6, the button 24, 4 apart; as many pills as fit in w = 200 and w = 20', () => {
	assert.equal(REACT_PAD + REACT_EMOJI + REACT_EMOJI_GAP + REACT_DIGIT + REACT_PAD, 39)
	assert.deepEqual([REACT_GAP, REACT_H, REACT_BAND, REACT_SPACING, REACT_ADD], [8, 24, 32, 4, 24])
	assert.equal(pillWidth(1), 39)
	assert.equal(pillWidth(12), 46)
	assert.equal(pillWidth(100), 53)
	assert.equal(moreWidth(2), 26)
	assert.equal(moreWidth(12), 33)
	const g = (e, n, mine = false) => ({ e, n, mine })
	const five = [g('a9', 12, true), g('ae', 3), g('1f44d', 2), g('1f602', 1), g('1f389', 1)]
	// w = 200: three pills (46, 39, 39), "+2" (26) and the button (24), four gaps: 190 ≤ 200; four pills and "+1": 233
	let r = rowPlan(five, 200, { add: true })
	assert.deepEqual(r.pills.map((p) => [p.e, p.n, p.mine, p.x, p.w]), [['a9', 12, true, 0, 46], ['ae', 3, false, 50, 39], ['1f44d', 2, false, 93, 39]])
	assert.deepEqual(r.more, { n: 2, x: 136, w: 26 })
	assert.deepEqual(r.add, { x: 166, w: 24 })
	assert.equal(r.width, 190)
	// without the button: four pills and "+1" make 205 > 200, so three pills and "+2" again
	r = rowPlan(five, 200, { add: false })
	assert.deepEqual(r.pills.map((p) => p.e), ['a9', 'ae', '1f44d'])
	assert.deepEqual(r.more, { n: 2, x: 136, w: 26 })
	assert.equal(r.add, null)
	// everything fits: no "+n"
	r = rowPlan(five.slice(0, 2), 200, { add: true })
	assert.deepEqual(r.pills.map((p) => [p.x, p.w]), [[0, 46], [50, 39]])
	assert.equal(r.more, null)
	assert.deepEqual(r.add, { x: 93, w: 24 })
	// w = 20 (the smallest note): no pill fits; "+5" and the button anyway ("at least none")
	r = rowPlan(five, 20, { add: true })
	assert.deepEqual(r.pills, [])
	assert.deepEqual(r.more, { n: 5, x: 0, w: 26 })
	assert.deepEqual(r.add, { x: 30, w: 24 })
	r = rowPlan(five, 20, { add: false })
	assert.deepEqual([r.pills, r.more, r.add], [[], { n: 5, x: 0, w: 26 }, null])
	// no reaction: only the button, at the bottom left
	r = rowPlan([], 200, { add: true })
	assert.deepEqual([r.pills, r.more, r.add, r.width], [[], null, { x: 0, w: 24 }, 24])
	assert.deepEqual(rowPlan([], 200), { pills: [], more: null, add: null, width: 0 })
})

test('the op: set, the same again → null (take back), another → replace; n is the given name', () => {
	const path = 'data.react.p' + ME
	assert.deepEqual(reactionPatch(note(null), ME, '1f44d', 'Vic'), { path, value: { e: '1f44d', n: 'Vic' } })
	const mine = note({ [`p${ME}`]: { e: '1f44d', n: 'Vic' } })
	assert.deepEqual(reactionPatch(mine, ME, '1f44d', 'Vic'), { path, value: null })
	assert.deepEqual(reactionPatch(mine, ME, '2764-fe0f', 'Vic'), { path, value: { e: '2764-fe0f', n: 'Vic' } })
	assert.deepEqual(reactionPatch(note(null), ME, '1f44d', undefined), { path, value: { e: '1f44d', n: '' } })
	assert.equal(reactionPatch(note(null), 'nope', '1f44d', 'Vic'), null)
	assert.equal(reactionPatch(note(null), ME, '1F44D', 'Vic'), null)
})

test('copies start without reactions: withoutReactions drops data.react only (a copy when there is something to drop)', () => {
	const data = { text: 'x', react: { a: 1 } }
	const out = withoutReactions(data)
	assert.deepEqual(out, { text: 'x' })
	assert.deepEqual(data, { text: 'x', react: { a: 1 } }, 'the input stays')
	const plain = { text: 'y' }
	assert.equal(withoutReactions(plain), plain)
	assert.deepEqual(withoutReactions(null), {})
})
