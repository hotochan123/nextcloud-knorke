/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * stats().overscan of the scene (M2, SPEC-M1 §6.3 "Überstand", job 034 AK7):
 * the scene hands on the renderer's {l, r, t, b, stageW, stageH} (a copy) while
 * mounted; null before mount, after destroy and when the renderer reports
 * none. The renderer is the recording stub of sceneHarness.mjs.
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setStubOverscan, setupScene, stubRenderer } from './sceneHarness.mjs'
import { installDom } from './fakeDom.mjs'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

const OV = Object.freeze({ l: 384, r: 384, t: 424, b: 424, stageW: 2688, stageH: 1848 })

describe('stats().overscan', () => {
	let h = null
	afterEach(() => {
		h?.restore()
		h = null
	})

	test('null before mount, the renderer\'s value while mounted, null after destroy', () => {
		stubRenderer()
		const dom = installDom()
		try {
			const container = dom.doc.createElement('div')
			container.clientWidth = 1000
			container.clientHeight = 800
			dom.doc.body.appendChild(container)
			const scene = new SceneManager(container, new SceneModel(), {})
			assert.equal(scene.stats().overscan, null, 'before mount')
			setStubOverscan(OV)
			scene.mount()
			dom.frame()
			const got = scene.stats().overscan
			assert.deepEqual(got, OV)
			assert.notEqual(got, OV, 'a copy')
			scene.destroy()
			assert.equal(scene.stats().overscan, null, 'after destroy')
		} finally {
			setStubOverscan(undefined)
			dom.restore()
		}
	})

	test('a renderer without an overscan in its stats gives null', () => {
		h = setupScene([])
		assert.equal(h.scene.stats().overscan, null)
		setStubOverscan({ l: 0, r: 0, t: 0, b: 0, stageW: 1000, stageH: 800 })
		assert.deepEqual(h.scene.stats().overscan, { l: 0, r: 0, t: 0, b: 0, stageW: 1000, stageH: 800 })
		setStubOverscan(null)
		assert.equal(h.scene.stats().overscan, null)
	})
})
