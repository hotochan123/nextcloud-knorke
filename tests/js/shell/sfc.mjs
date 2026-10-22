/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Vue single-file components in Node, for behaviour tests of the shell
 * (SPEC-M1 stage 2, R14-04, R14-07, R14-12): no DOM, no bundler, no vite.
 *
 * useSfc() installs a synchronous module hook (node:module registerHooks)
 * for the calling test process:
 * - every *.vue file is compiled on import with vue/compiler-sfc: its
 *   script (setup) the way the dev build does it, so setup() returns ALL
 *   its bindings (functions, refs) to the test, plus its template as an
 *   SSR render function, so @vue/server-renderer can render it to HTML;
 * - every @nextcloud/vue component resolves to a stub that renders
 *   <div data-stub="<Name>" …attributes> with its default slot. Date
 *   attributes are written as their local calendar day (YYYY-MM-DD), so a
 *   date picker's min, max and model can be read from the HTML; listeners
 *   and object values are left out.
 *
 * node --test runs every test file in its own process, so the hook stays
 * inside the file that calls useSfc(). Nothing is written to disk.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const STUB_PREFIX = 'knorke-stub:'
const NC_COMPONENTS = '@nextcloud/vue/components/'
let installed = false

/**
 * @param {string} name component name (NcButton …)
 * @return {string} ES module source of its stub
 */
function stubSource(name) {
	return `import { h } from 'vue'
const pad = (n, w = 2) => String(n).padStart(w, '0')
const day = (d) => pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
export default {
	name: ${JSON.stringify(name)},
	inheritAttrs: false,
	render() {
		const attrs = { 'data-stub': ${JSON.stringify(name)} }
		for (const [k, v] of Object.entries(this.$attrs)) {
			if (/^on[A-Z]/.test(k) || typeof v === 'function') continue
			if (v instanceof Date) attrs[k] = isNaN(v) ? '' : day(v)
			else if (v === null || v === undefined || typeof v !== 'object') attrs[k] = v
		}
		return h('div', attrs, this.$slots.default ? this.$slots.default() : undefined)
	},
}
`
}

/**
 * @param {string} file absolute path of a .vue file
 * @return {string} ES module source: the component as default export, with
 *   setup() returning every binding and an SSR render function
 */
function compileSfc(file) {
	const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
	const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file })
	if (errors.length > 0) {
		throw errors[0]
	}
	const id = createHash('sha256').update(file).digest('hex').slice(0, 8)
	const script = compileScript(descriptor, { id, inlineTemplate: false, genDefaultAs: '__sfc__' })
	let source = script.content
	if (descriptor.template) {
		const tpl = compileTemplate({
			id,
			filename: file,
			source: descriptor.template.content,
			ssr: true,
			ssrCssVars: [],
			compilerOptions: { bindingMetadata: script.bindings },
		})
		if (tpl.errors.length > 0) {
			throw new Error(file + ': ' + tpl.errors.map(String).join('; '))
		}
		source += '\n' + tpl.code + '\n__sfc__.ssrRender = ssrRender\n'
	}
	return source + '\nexport default __sfc__\n'
}

/** Installs the hook (once per process). */
export function useSfc() {
	if (installed) {
		return
	}
	installed = true
	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (specifier.startsWith(NC_COMPONENTS)) {
				return { url: STUB_PREFIX + specifier.slice(NC_COMPONENTS.length), format: 'module', shortCircuit: true }
			}
			if (context.parentURL?.startsWith(STUB_PREFIX)) {
				// the stubs import vue like the test does
				return nextResolve(specifier, { ...context, parentURL: import.meta.url })
			}
			return nextResolve(specifier, context)
		},
		load(url, context, nextLoad) {
			if (url.startsWith(STUB_PREFIX)) {
				return { format: 'module', source: stubSource(url.slice(STUB_PREFIX.length)), shortCircuit: true }
			}
			if (url.startsWith('file:') && url.endsWith('.vue')) {
				return { format: 'module', source: compileSfc(fileURLToPath(url)), shortCircuit: true }
			}
			return nextLoad(url, context)
		},
	})
}

/**
 * Runs a component's setup() outside a component instance and returns its
 * bindings (refs stay refs). Lifecycle hooks are not run (Vue warns about
 * them without an instance; those warnings are swallowed here, every other
 * warning goes through), so a test calls e.g. `load()` itself.
 *
 * @param {object} component compiled component (default export of a .vue)
 * @param {object} props every prop, defaults included
 * @return {{bindings: object, emitted: Array<[string, any]>}}
 */
export function setupOf(component, props) {
	const emitted = []
	const warn = console.warn
	console.warn = (...a) => {
		if (!/is called when there is no active component instance/.test(String(a[0]))) {
			warn(...a)
		}
	}
	try {
		const bindings = component.setup(props, { emit: (name, ...args) => emitted.push([name, ...args]), expose() {}, attrs: {}, slots: {} })
		return { bindings, emitted }
	} finally {
		console.warn = warn
	}
}
