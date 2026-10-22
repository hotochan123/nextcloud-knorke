/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Plain Vite build of the scene lab (SPEC-M0 §9.4): no Nextcloud config, Vite
 * and all packages from $ROOT/node_modules (read only; the cache lives in
 * dev/scene-lab/node_modules/.vite-lab). src/util/l10n.js is replaced by an
 * identity stub (allowed by §6.9). Output: dev/scene-lab/dist/.
 *
 *   node ../../node_modules/vite/bin/vite.js build --config vite.lab.config.js
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const L10N = resolve(ROOT, 'src/util/l10n.js')
const STUB = resolve(HERE, 'l10n-stub.js')

export default {
	root: HERE,
	base: './',
	publicDir: false,
	envDir: HERE,
	cacheDir: resolve(HERE, 'node_modules/.vite-lab'),
	logLevel: 'warn',
	plugins: [{
		name: 'knorke-lab-l10n-stub',
		enforce: 'pre',
		resolveId(source, importer) {
			if (!importer || !source.endsWith('l10n.js')) return null
			return resolve(dirname(importer), source) === L10N ? STUB : null
		},
	}],
	build: {
		outDir: resolve(HERE, 'dist'),
		emptyOutDir: true,
		target: 'es2022',
		minify: false,
		sourcemap: false,
		modulePreload: false,
		reportCompressedSize: false,
		chunkSizeWarningLimit: 4000,
	},
}
