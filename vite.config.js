/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { createAppConfig } from '@nextcloud/vite-config'
import { join, resolve } from 'node:path'
import { styleFreshness } from './build/style-fresh.mjs'

export default createAppConfig({ main: resolve(join('src', 'main.js')) }, {
	// Without it the name comes from appinfo/info.xml or npm_package_name;
	// a build without info.xml would otherwise risk "undefined-main.mjs".
	appName: 'knorke',
	nodePolyfills: false,
	config: {
		// SPEC-M1 §9.5 WP-C4 (b): the hash of every src/styles/*.css, taken in the
		// plugin's transform hook from the text vite translates, goes to
		// js/knorke-style.fresh.json for build/check-fresh.mjs (CSS has no map).
		// The plugin returns no code: js/ and css/ stay as they are.
		plugins: [styleFreshness()],
		resolve: { dedupe: ['vue'] },
		build: {
			// Exactly one CSS file: css/knorke-style.css
			cssCodeSplit: false,
			chunkSizeWarningLimit: 1500,
			rollupOptions: {
				output: {
					manualChunks: (id) => {
						if (/[\\/]node_modules[\\/](konva|rbush|quickselect|fractional-indexing)[\\/]/.test(id)) return 'canvas'
						// Also catches lazy imports inside @nextcloud/vue, so no lazy chunks appear.
						if (/[\\/]node_modules[\\/]/.test(id)) return 'vendor'
					},
				},
			},
		},
	},
})
