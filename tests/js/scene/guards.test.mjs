/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Structural guards of the scene (SPEC-M0 §6.3, WP-S "Fertig in Phase 1"):
 * - neither the model nor the scene imports Vue (no Konva object and no model
 *   ends up in reactivity)
 * - Konva only through deep imports: konva/lib/Core (Group, Shape) + Rect/Text/Line;
 *   the model never imports Konva
 * - (M1) every node shape (new ctx.Rect|Text|Shape|Line) is built with
 *   ...SHAPE_BASE; the renderer's ctx carries exactly Group, Rect, Text,
 *   Shape, Line; the activeGroup transform preview is one setAttrs
 * - no native hit detection (getIntersection, drawHit, listening true); every
 *   layer and the stage are created with listening: false
 * - culling never hides nodes: KonvaRenderer and culling.js call no .visible(
 *   (only the LOD code in nodes/* toggles text visibility)
 * - global Konva flags and ONE camera setAttrs (M2: shifted by the overscan
 *   l/t of the stage)
 * - (M2, job 034) the CSS gesture redraws by the coverage rule
 *   (needsGestureRedraw of the transform from the drawn camera), the host's
 *   style.overflow is written in mount and destroy only, the M0 constants of
 *   the old gesture rule are gone everywhere, CULL_MARGIN stays the line
 *   dev/e2e/moderation.test.mjs reads
 * - SPDX header in every file of the package
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT, stripComments, walk } from './sourceScan.mjs'

const read = (p) => readFileSync(p, 'utf8')
const rel = (p) => relative(ROOT, p)
const sceneFiles = walk(join(ROOT, 'src/scene'), /\.m?js$/)
const modelFiles = walk(join(ROOT, 'src/model'), /\.m?js$/)

describe('imports', () => {
	test('no Vue (or other reactivity) in model and scene', () => {
		for (const p of [...sceneFiles, ...modelFiles]) {
			assert.doesNotMatch(read(p), /from\s+'(vue|@vue\/[^']*|pinia|@nextcloud\/vue[^']*)'/, rel(p))
		}
	})

	test('Konva only via konva/lib/Core and the Rect/Text/Line shapes; not in the model', () => {
		for (const p of sceneFiles) {
			for (const m of read(p).matchAll(/from\s+'(konva[^']*)'/g)) {
				assert.match(m[1], /^konva\/lib\/(Core|shapes\/(Rect|Text|Line))$/, `${rel(p)}: ${m[1]}`)
			}
		}
		for (const p of modelFiles) {
			assert.doesNotMatch(read(p), /from\s+'konva/, rel(p))
		}
	})

	test('the model imports no scene module and nothing from the DOM shell', () => {
		for (const p of modelFiles) {
			assert.doesNotMatch(read(p), /from\s+'\.\.\/(scene|sync|board|util|components|views)\//, rel(p))
		}
	})
})

describe('Konva usage', () => {
	const renderer = read(join(ROOT, 'src/scene/KonvaRenderer.js'))
	const code = stripComments(renderer)

	test('no native hit detection anywhere in the scene', () => {
		for (const p of sceneFiles) {
			const c = stripComments(read(p))
			assert.doesNotMatch(c, /getIntersection|drawHit|listening\(\s*true\s*\)|listening:\s*true/, rel(p))
		}
	})

	test('stage and both layers are created with listening: false; exactly two layers', () => {
		const layers = [...code.matchAll(/new Konva\.Layer\(([^)]*)\)/g)]
		assert.equal(layers.length, 2, 'staticLayer + overlayLayer')
		for (const m of layers) assert.match(m[1], /listening:\s*false/)
		assert.match(code, /new Konva\.Stage\(\{[^}]*listening:\s*false/)
		for (const m of code.matchAll(/new Konva\.Group\(([^)]*)\)/g)) assert.match(m[1], /listening:\s*false/)
	})

	test('global flags before the stage exists', () => {
		const flags = code.indexOf('Konva.autoDrawEnabled = false')
		const ratio = code.indexOf('Konva.pixelRatio = Math.min(2,')
		const stage = code.indexOf('new Konva.Stage(')
		assert.ok(flags >= 0 && ratio >= 0 && stage > flags && stage > ratio)
	})

	test('camera: exactly one stage.setAttrs with scaleX/scaleY/x/y, shifted by the overscan l/t', () => {
		const calls = [...code.matchAll(/stage\.setAttrs\(\{([^}]*)\}\)/g)].filter((m) => /scaleX/.test(m[1]))
		assert.equal(calls.length, 1)
		assert.match(calls[0][1], /^\s*scaleX:\s*scale,\s*scaleY:\s*scale,\s*x:\s*-x \* scale \+ this\.#ov\.l,\s*y:\s*-y \* scale \+ this\.#ov\.t\s*$/)
		assert.doesNotMatch(code, /stage\.(scale|position)\(/)
	})

	test('CSS gesture (M2): gestureFrame redraws by needsGestureRedraw of the transform from the drawn camera', () => {
		const gf = code.slice(code.indexOf('gestureFrame(c1) {'), code.indexOf('endGesture(c1) {'))
		assert.ok(gf.length > 100, 'gestureFrame found')
		assert.match(gf, /if \(needsGestureRedraw\(cssTransformFor\(this\.#base, c1\), this\.#w, this\.#h, this\.#ov\)\) \{\s+this\.#applyCamera\(c1\.x, c1\.y, c1\.scale\)\s+this\.#drawNow\(\)\s+this\.#base = \{ \.\.\.c1 \}\s+this\.#setTransform\(null\)\s+return\s+\}/)
		assert.match(code, /import \{[^}]*\bneedsGestureRedraw\b[^}]*\} from '\.\/Camera\.js'/)
	})

	test('the host\'s style.overflow is written in mount and destroy only (M2: overflow clip)', () => {
		const mount = [code.indexOf('mount(width, height) {'), code.indexOf('resize(width, height) {')]
		const destroy = [code.indexOf('destroy() {'), code.indexOf('get contentEl() {')]
		assert.ok(mount[0] > 0 && mount[1] > mount[0] && destroy[0] > mount[1] && destroy[1] > destroy[0])
		const writes = [...code.matchAll(/\.overflow\s*=(?!=)/g)].map((m) => m.index)
		assert.equal(writes.length, 3, 'mount: hidden, clip; destroy: restore')
		for (const at of writes) {
			assert.ok((at > mount[0] && at < mount[1]) || (at > destroy[0] && at < destroy[1]), `write at ${at}`)
		}
		const m = code.slice(mount[0], mount[1])
		assert.match(m, /this\.#hostOverflow = style\.overflow\s+style\.overflow = 'hidden'\s+style\.overflow = 'clip'/)
		assert.match(code.slice(destroy[0], destroy[1]), /this\.#container\.style\.overflow = this\.#hostOverflow/)
	})

	test('the M0 gesture constants are gone from src, dev and tests; CULL_MARGIN stays', () => {
		const old = new RegExp(['GESTURE', 'T', 'FRAC'].join('_') + '|' + ['GESTURE', 'K', 'RANGE'].join('_'))
		const files = ['src', 'dev', 'tests'].flatMap((d) => walk(join(ROOT, d), /\.(m?js|vue|sh|json|md|html)$/))
		assert.ok(files.length > 100)
		for (const p of files) assert.doesNotMatch(read(p), old, rel(p))
		assert.match(renderer, /^export const CULL_MARGIN = 0\.1$/m)
	})

	test('culling detaches instead of hiding: no .visible( in the renderer or culling', () => {
		assert.doesNotMatch(code, /\.visible\(/)
		assert.doesNotMatch(stripComments(read(join(ROOT, 'src/scene/culling.js'))), /\.visible\(/)
		assert.match(code, /\.root\.remove\(\)/)
	})

	test('every shape is built without a hit graph (new ctx.Rect|Text|Shape|Line with ...SHAPE_BASE)', () => {
		let n = 0
		const kinds = new Set()
		for (const p of walk(join(ROOT, 'src/scene/nodes'), /\.js$/)) {
			const c = stripComments(read(p))
			assert.doesNotMatch(c, /new ctx\.(?!Rect\(|Text\(|Shape\(|Line\(|Group\()/, `${rel(p)}: only Group, Rect, Text, Shape, Line`)
			for (const m of c.matchAll(/new ctx\.(Rect|Text|Shape|Line)\(\{\s*\n?\s*([^\n]*)/g)) {
				assert.match(m[2], /\.\.\.SHAPE_BASE/, `${rel(p)}: ${m[0]}`)
				kinds.add(m[1])
				n++
			}
		}
		assert.ok(n >= 8, 'builders found')
		assert.ok(kinds.has('Shape') && kinds.has('Text') && kinds.has('Rect'), [...kinds].join())
		assert.match(read(join(ROOT, 'src/scene/nodes/common.js')), /SHAPE_BASE = Object\.freeze\(\{ listening: false, perfectDrawEnabled: false \}\)/)
	})

	test('the builder context is {Group, Rect, Text, Shape, Line, shadows}', () => {
		const m = code.match(/this\.#ctx = \{([^}]*)\}/)
		assert.ok(m, 'ctx assignment')
		const keys = m[1].split(',').map((x) => x.trim().split(':')[0].trim())
		assert.deepEqual(keys, ['Group', 'Rect', 'Text', 'Shape', 'Line', 'shadows'])
	})

	test('transform preview: the activeGroup gets exactly one setAttrs per call; no other node transform API', () => {
		const calls = [...code.matchAll(/this\.#active\.setAttrs\(/g)]
		assert.equal(calls.length, 1)
		assert.doesNotMatch(code, /\.(scaleX|scaleY|rotation|offsetX|offsetY)\(/)
	})

	test('LOD 2 (SPEC-M1 §6.3): entry = staticLayer.removeChildren() + the ONE coarse node; no node.cache(), no bitmaps anywhere', () => {
		const enter = code.slice(code.indexOf('#enterCoarse() {'), code.indexOf('#leaveCoarse() {'))
		assert.match(enter, /this\.#static\.removeChildren\(\)\s+this\.#attached\.clear\(\)\s+this\.#static\.add\(this\.#coarseNode\(\)\)/)
		assert.equal([...code.matchAll(/buildCoarse\(/g)].length, 1, 'one place builds the coarse node')
		// the culling keeps only the list of entries in view at LOD 2 (no node moves)
		const cull = code.slice(code.indexOf('#cull() {'), code.indexOf('#clearUi() {'))
		assert.match(cull, /if \(this\.#lod === 2\) \{\s+this\.#coarse\.hits = hits\s+return\s+\}/)
		for (const p of [...sceneFiles, ...modelFiles]) {
			assert.doesNotMatch(stripComments(read(p)), /\.cache\(|toImage|toCanvas|toDataURL|createImageBitmap|drawImage/, rel(p))
		}
		const coarse = stripComments(read(join(ROOT, 'src/scene/nodes/coarse.js')))
		assert.doesNotMatch(coarse, /new ctx\.(Rect|Text|Line)\(/, 'boxes are fillRect, titles fillText: no node per item')
		assert.equal([...coarse.matchAll(/new ctx\.Shape\(/g)].length, 1)
	})
})

describe('headers', () => {
	test('SPDX header in every source, test and lab file of WP-S', () => {
		const files = [
			...sceneFiles, ...modelFiles,
			...walk(join(ROOT, 'tests/js/model'), /\.mjs$/),
			...walk(join(ROOT, 'tests/js/scene'), /\.mjs$/),
			...walk(join(ROOT, 'dev/scene-lab'), /\.(m?js|sh|html)$/),
		]
		assert.ok(files.length > 30)
		for (const p of files) {
			const head = read(p).slice(0, 400)
			assert.match(head, /SPDX-FileCopyrightText: 2026 hotochan123/, rel(p))
			assert.match(head, /SPDX-License-Identifier: AGPL-3\.0-or-later/, rel(p))
		}
	})
})
