/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Entry point (SPEC-M0 §6.6): App (signed-in pages), PublicApp (guest page
 * of an edit link) or AdminSettings (M2: the admin section "Knorke" with the
 * privacy notice, page 'admin'), chosen by the initial state `page`. Every page carries
 * all initial-state keys (PageController::INITIAL_STATE_KEYS); the shell gets
 * them once through provide('knorke-state').
 *
 * t/n in templates are the wrappers of util/l10n.js (escape and sanitize
 * off; Vue interpolation escapes, there is no v-html anywhere).
 *
 * SPEC-M1 §4.3: an initial-state `protocol` other than the bundle's means
 * the bundle came from a stale cache (the page itself is fresh): one
 * cache-busting reload (same per-version marker as a 409, util/reload.js)
 * instead of mounting; when this version was tried already, the app mounts
 * and the first /sync shows the reload banner.
 */
import './styles/knorke.css'
import { createApp } from 'vue'
import App from './App.vue'
import PublicApp from './PublicApp.vue'
import AdminSettings from './admin/AdminSettings.vue'
import { PROTOCOL } from './sync/protocol.js'
import { n, t } from './util/l10n.js'
import { hardReload, startupReload, strippedUrl } from './util/reload.js'
import { readState } from './util/state.js'

const root = document.getElementById('knorke-root')
if (root) {
	// a cache-busting reload (U15) leaves its parameter in the address bar
	const clean = strippedUrl(window.location.href)
	if (clean !== null) {
		try {
			window.history.replaceState(window.history.state, '', clean)
		} catch (e) {
			// cosmetic only
		}
	}
	const state = readState()
	if (!startupReload({ pageProtocol: state.protocol, bundleProtocol: PROTOCOL, reload: () => hardReload(window) })) {
		const app = createApp(state.page === 'public' ? PublicApp : state.page === 'admin' ? AdminSettings : App)
		app.config.globalProperties.t = t
		app.config.globalProperties.n = n
		app.provide('knorke-state', state)
		app.mount(root)
	}
}
