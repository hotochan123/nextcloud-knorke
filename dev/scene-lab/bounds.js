/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Gate G17 "Container-Grenzen" (SPEC-M1 §8.5, §9.1 WP-S0): the lab container
 * runs without root, sees dev/scene-lab read-only at /work, has an empty
 * tmpfs over /work/out and can write only its output directory /out
 * (KNORKE_LAB_OUT). Pure helpers without Playwright and without fs: run.mjs
 * collects the raw inputs inside the container (/proc/self/mountinfo, the
 * Uid/Gid lines of every process, two write probes) and evaluateBounds()
 * decides. Unit tested in tests/js/scene/labBounds.test.mjs.
 */

/**
 * Undoes the octal escapes of mountinfo paths (space → \040, tab, newline, backslash).
 *
 * @param {string} s escaped path
 * @return {string} path
 */
export function unescapeMountPath(s) {
	return s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
}

/**
 * /proc/<pid>/mountinfo → list of mounts in file order (later lines are
 * mounted on top of earlier ones at the same point).
 *
 * Line: id parent major:minor root mountPoint mountOptions [optional…] - fsType source superOptions
 *
 * @param {string} text mountinfo
 * @return {Array<{mountPoint: string, options: string[], fsType: string, source: string, superOptions: string[]}>}
 */
export function parseMountinfo(text) {
	const out = []
	for (const line of String(text ?? '').split('\n')) {
		const f = line.trim().split(' ')
		if (f.length < 10) continue
		const sep = f.indexOf('-', 6)
		if (sep < 0 || sep + 3 > f.length) continue
		out.push({
			mountPoint: unescapeMountPath(f[4]),
			options: f[5].split(','),
			fsType: f[sep + 1],
			source: unescapeMountPath(f[sep + 2]),
			superOptions: (f[sep + 3] ?? '').split(','),
		})
	}
	return out
}

/**
 * @param {Array<{mountPoint: string}>} mounts parseMountinfo()
 * @param {string} path absolute mount point
 * @return {object|null} the topmost mount exactly at path
 */
export function mountAt(mounts, path) {
	let hit = null
	for (const m of mounts) {
		if (m.mountPoint === path) hit = m
	}
	return hit
}

/**
 * Uid/Gid lines of /proc/<pid>/status: real, effective, saved, filesystem.
 *
 * @param {string} text status
 * @return {{uids: number[], gids: number[], groups: number[]}|null}
 */
export function parseStatusIds(text) {
	const line = (key) => {
		const m = String(text ?? '').match(new RegExp(`^${key}:\\s*([^\\n]*)$`, 'm'))
		return m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number) : null
	}
	const uids = line('Uid')
	const gids = line('Gid')
	if (!uids || !gids || uids.length < 4 || gids.length < 4) return null
	return { uids, gids, groups: line('Groups') ?? [] }
}

/** Below the container root but not the given directory itself or anything under it. */
const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith('/') ? dir : dir + '/')

/**
 * Decides G17 from the collected inputs.
 *
 * @param {object} input inputs collected by run.mjs
 * @param {{uid: number, euid: number, gid: number, egid: number, groups: number[]}} input.self ids of the runner (process.get*id)
 * @param {Array<{pid: number, uids: number[], gids: number[]}>} input.procs every process of the container (/proc/<pid>/status)
 * @param {string} input.mountinfo /proc/self/mountinfo
 * @param {string} input.work the lab directory inside the container (/work)
 * @param {{wrote: boolean, code: string|null}} input.workProbe attempt to create a file directly in work
 * @param {string[]|null} input.workOutEntries readdir(work + '/out'), null when unreadable
 * @param {string|undefined} input.outDir KNORKE_LAB_OUT
 * @param {string} input.resultsDir directory run.mjs writes its reports to
 * @param {{ok: boolean, code: string|null}} input.outProbe create + read back + unlink a file in outDir
 * @return {{ok: boolean, checks: {notRoot: boolean, workReadOnly: boolean, workOutEmptyTmpfs: boolean, outWritable: boolean}, detail: object}}
 */
export function evaluateBounds(input) {
	const { self, procs = [], work, workProbe, workOutEntries, outDir, resultsDir, outProbe } = input
	const mounts = parseMountinfo(input.mountinfo)
	const workMount = mountAt(mounts, work)
	const workOut = work + '/out'
	const workOutMount = mountAt(mounts, workOut)
	const outMount = typeof outDir === 'string' && outDir.startsWith('/') ? mountAt(mounts, outDir) : null

	const rootProcs = procs.filter((p) => p.uids.some((v) => v === 0) || p.gids.some((v) => v === 0)).map((p) => p.pid)
	const notRoot = !!self && self.uid !== 0 && self.euid !== 0 && self.gid !== 0 && self.egid !== 0 &&
		!(self.groups ?? []).includes(0) && procs.length > 0 && rootProcs.length === 0

	const workReadOnly = !!workMount && workMount.options.includes('ro') &&
		!!workProbe && workProbe.wrote === false && workProbe.code === 'EROFS'

	const workOutEmptyTmpfs = !!workOutMount && workOutMount.fsType === 'tmpfs' &&
		Array.isArray(workOutEntries) && workOutEntries.length === 0

	const outWritable = typeof outDir === 'string' && outDir.startsWith('/') && !inside(outDir, work) &&
		resultsDir === outDir && !!outMount && outMount.options.includes('rw') && !!outProbe && outProbe.ok === true

	const checks = { notRoot, workReadOnly, workOutEmptyTmpfs, outWritable }
	return {
		ok: notRoot && workReadOnly && workOutEmptyTmpfs && outWritable,
		checks,
		detail: {
			uid: self?.uid ?? null,
			gid: self?.gid ?? null,
			groups: self?.groups ?? [],
			processes: procs.length,
			rootProcesses: rootProcs,
			work: workMount ? { fsType: workMount.fsType, options: workMount.options } : null,
			workProbe: workProbe ?? null,
			workOut: workOutMount ? { fsType: workOutMount.fsType, entries: workOutEntries?.length ?? null } : null,
			out: outMount ? { path: outDir, fsType: outMount.fsType, options: outMount.options } : { path: outDir ?? null },
			outProbe: outProbe ?? null,
			resultsDir,
		},
	}
}
