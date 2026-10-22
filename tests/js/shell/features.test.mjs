/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Stage-2 freeze (SPEC-M1 §9.3 row 2.2): the build-time switch FEATURES
 * (§6.6; stage 3 sets voting to true, §9.4 WP-C3) and the one new npm dependency of M1, qrcode-generator 1.5.2 (§0,
 * §9.0), pinned exactly in package.json and package-lock.json.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as features from '../../../src/util/features.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readJson = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'))

const QR = 'qrcode-generator'
const QR_VERSION = '1.5.2'
// Same tarball as Pulse (apps/pulse/package-lock.json)
const QR_INTEGRITY = 'sha512-pItrW0Z9HnDBnFmgiNrY1uxRdri32Uh9EjNYLPVC2zZ3ZRIIEqBoDgm4DkvDwNNDHTK7FNkmr8zAa77BYc9xNw=='

test('FEATURES: the only export, a frozen object with exactly { voting: true } from stage 3 on (§6.6, §9.4 WP-C3)', () => {
	assert.deepEqual(Object.keys(features), ['FEATURES'])
	const { FEATURES } = features
	assert.equal(Object.isFrozen(FEATURES), true)
	assert.equal(Object.getPrototypeOf(FEATURES), Object.prototype)
	assert.deepEqual(Reflect.ownKeys(FEATURES), ['voting'])
	assert.equal(FEATURES.voting, true)
	// ES modules run in strict mode: writing to a frozen object throws
	assert.throws(() => { FEATURES.voting = false }, TypeError)
	assert.throws(() => { FEATURES.other = 1 }, TypeError)
	assert.equal(FEATURES.voting, true)
})

test('package.json pins qrcode-generator exactly at 1.5.2 as a runtime dependency (§0, §9.0)', () => {
	const pkg = readJson('package.json')
	assert.equal(pkg.dependencies[QR], QR_VERSION, 'exact version, no range')
	assert.equal(pkg.devDependencies?.[QR], undefined)
})

test('package-lock.json: qrcode-generator 1.5.2 from the npm registry with its integrity, MIT, no install scripts', () => {
	const lock = readJson('package-lock.json')
	assert.equal(lock.packages[''].dependencies[QR], QR_VERSION)
	const entry = lock.packages['node_modules/' + QR]
	assert.ok(entry, 'lock entry node_modules/' + QR)
	assert.equal(entry.version, QR_VERSION)
	assert.equal(entry.resolved, `https://registry.npmjs.org/${QR}/-/${QR}-${QR_VERSION}.tgz`)
	assert.equal(entry.integrity, QR_INTEGRITY)
	assert.equal(entry.license, 'MIT')
	assert.equal(entry.hasInstallScript, undefined)
	assert.equal(entry.dependencies, undefined)
	assert.equal(entry.dev, undefined, 'runtime dependency, not dev')
	// Only the top-level copy: nothing else pulls in another version
	const copies = Object.keys(lock.packages).filter((k) => k === 'node_modules/' + QR || k.endsWith('/node_modules/' + QR))
	assert.deepEqual(copies, ['node_modules/' + QR])
})
