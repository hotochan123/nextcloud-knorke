/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Gate G17 "Container-Grenzen" (SPEC-M1 §8.5, §9.1 WP-S0): the pure decision
 * of dev/scene-lab/bounds.js on inputs recorded in a knorke-lab-* container
 * (uid 47001, --group-add 18, dev/scene-lab read-only at /work, tmpfs over
 * /work/out, dev/scene-lab/out at /out), plus the M0 layout it replaces
 * (root container, /work writable, no /out) and every single violation.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateBounds, mountAt, parseMountinfo, parseStatusIds, unescapeMountPath } from '../../../dev/scene-lab/bounds.js'

// recorded 11.10.2026 in knorke-lab-* (Docker 27, zfs), container root line shortened
const MOUNTINFO = [
	'5996 5995 0:521 / / rw,relatime master:1 - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/A:/var/lib/docker/overlay2/l/B,upperdir=/var/lib/docker/overlay2/x/diff,workdir=/var/lib/docker/overlay2/x/work',
	'5997 5996 0:524 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
	'6007 5996 0:41 /docker/stacks/claude_projects/knorke-m1/dev/scene-lab /work ro,relatime - zfs app_storage/appdata rw,xattr,posixacl,casesensitive',
	'6008 5996 0:41 /docker/stacks/claude_projects/knorke-m1/dev/scene-lab/out /out rw,relatime - zfs app_storage/appdata rw,xattr,posixacl,casesensitive',
	'6009 6007 0:556 / /work/out rw,nosuid,nodev,noexec,relatime - tmpfs tmpfs rw,mode=777,inode64',
	'',
].join('\n')

// M0 run.sh: -v "$HERE:/work" in a root container, reports into /work/out
const MOUNTINFO_M0 = [
	'5996 5995 0:521 / / rw,relatime master:1 - overlay overlay rw',
	'6007 5996 0:41 /docker/stacks/claude_projects/knorke/dev/scene-lab /work rw,relatime - zfs app_storage/appdata rw,xattr,posixacl,casesensitive',
].join('\n')

const STATUS_47001 = 'Name:\tnode\nUmask:\t0022\nState:\tS (sleeping)\nUid:\t47001\t47001\t47001\t47001\nGid:\t47001\t47001\t47001\t47001\nFDSize:\t64\nGroups:\t18 47001 \n'

/** The hardened container (run.sh since WP-S0). */
const good = () => ({
	self: { uid: 47001, euid: 47001, gid: 47001, egid: 47001, groups: [18, 47001] },
	procs: [
		{ pid: 1, uids: [47001, 47001, 47001, 47001], gids: [47001, 47001, 47001, 47001] },
		{ pid: 7, uids: [47001, 47001, 47001, 47001], gids: [47001, 47001, 47001, 47001] },
		{ pid: 40, uids: [47001, 47001, 47001, 47001], gids: [47001, 47001, 47001, 47001] },
	],
	mountinfo: MOUNTINFO,
	work: '/work',
	workProbe: { wrote: false, code: 'EROFS' },
	workOutEntries: [],
	outDir: '/out',
	resultsDir: '/out',
	outProbe: { ok: true, code: null },
})

describe('mountinfo and status parsing', () => {
	test('mount points, per-mount options and fs type of the recorded lab container', () => {
		const m = parseMountinfo(MOUNTINFO)
		assert.equal(m.length, 5)
		assert.deepEqual(mountAt(m, '/work'), {
			mountPoint: '/work', options: ['ro', 'relatime'], fsType: 'zfs', source: 'app_storage/appdata',
			superOptions: ['rw', 'xattr', 'posixacl', 'casesensitive'],
		})
		assert.equal(mountAt(m, '/work/out').fsType, 'tmpfs')
		assert.deepEqual(mountAt(m, '/out').options, ['rw', 'relatime'])
		assert.equal(mountAt(m, '/nope'), null)
	})

	test('optional fields before the separator, escaped paths, the topmost mount wins', () => {
		const m = parseMountinfo([
			'10 1 0:1 / /a\\040b rw shared:7 master:3 - ext4 /dev/x rw',
			'11 1 0:2 / /c rw - ext4 /dev/y rw',
			'12 11 0:3 / /c ro - tmpfs tmpfs rw',
			'garbage line',
		].join('\n'))
		assert.equal(m.length, 3)
		assert.equal(m[0].mountPoint, '/a b')
		assert.equal(m[0].fsType, 'ext4')
		assert.equal(mountAt(m, '/c').fsType, 'tmpfs')
		assert.equal(unescapeMountPath('/x\\011y\\134z'), '/x\ty\\z')
		assert.deepEqual(parseMountinfo(''), [])
		assert.deepEqual(parseMountinfo(null), [])
	})

	test('Uid/Gid/Groups of /proc/<pid>/status', () => {
		assert.deepEqual(parseStatusIds(STATUS_47001), {
			uids: [47001, 47001, 47001, 47001], gids: [47001, 47001, 47001, 47001], groups: [18, 47001],
		})
		assert.equal(parseStatusIds('Name:\tx\n'), null)
		assert.equal(parseStatusIds(''), null)
	})
})

describe('G17 decision', () => {
	test('the hardened container passes all four checks', () => {
		const r = evaluateBounds(good())
		assert.equal(r.ok, true)
		assert.deepEqual(r.checks, { notRoot: true, workReadOnly: true, workOutEmptyTmpfs: true, outWritable: true })
		assert.deepEqual(r.detail.rootProcesses, [])
		assert.equal(r.detail.work.options.includes('ro'), true)
		assert.equal(r.detail.workOut.fsType, 'tmpfs')
	})

	test('the M0 layout (root, /work writable, reports in /work/out) fails every check', () => {
		const r = evaluateBounds({
			self: { uid: 0, euid: 0, gid: 0, egid: 0, groups: [0] },
			procs: [{ pid: 1, uids: [0, 0, 0, 0], gids: [0, 0, 0, 0] }],
			mountinfo: MOUNTINFO_M0,
			work: '/work',
			workProbe: { wrote: true, code: null },
			workOutEntries: ['gates.json', 'gates.md'],
			outDir: undefined,
			resultsDir: '/work/out',
			outProbe: { ok: false, code: 'KNORKE_LAB_OUT unset' },
		})
		assert.equal(r.ok, false)
		assert.deepEqual(r.checks, { notRoot: false, workReadOnly: false, workOutEmptyTmpfs: false, outWritable: false })
	})

	const fails = (name, mutate, check) => test(name, () => {
		const input = good()
		mutate(input)
		const r = evaluateBounds(input)
		assert.equal(r.ok, false)
		assert.equal(r.checks[check], false, check)
		for (const [k, v] of Object.entries(r.checks)) if (k !== check) assert.equal(v, true, k)
	})

	fails('runner uid 0', (i) => { i.self.uid = 0 }, 'notRoot')
	fails('runner effective gid 0', (i) => { i.self.egid = 0 }, 'notRoot')
	fails('root among the supplementary groups (e.g. --group-add 0)', (i) => { i.self.groups = [0, 47001] }, 'notRoot')
	fails('one Chromium process with saved uid 0', (i) => { i.procs[2].uids = [47001, 47001, 0, 47001] }, 'notRoot')
	fails('no process list (procfs unreadable)', (i) => { i.procs = [] }, 'notRoot')
	fails('/work mounted rw although the write failed for another reason', (i) => {
		i.mountinfo = i.mountinfo.replace('/work ro,relatime', '/work rw,relatime')
		i.workProbe = { wrote: false, code: 'EACCES' }
	}, 'workReadOnly')
	fails('/work marked ro but the probe file got written', (i) => { i.workProbe = { wrote: true, code: null } }, 'workReadOnly')
	fails('no mount at /work', (i) => { i.mountinfo = i.mountinfo.replace(' /work ro', ' /elsewhere ro') }, 'workReadOnly')
	fails('/work/out is a bind mount instead of tmpfs', (i) => { i.mountinfo = i.mountinfo.replace('- tmpfs tmpfs', '- zfs app_storage/appdata') }, 'workOutEmptyTmpfs')
	fails('/work/out is not empty', (i) => { i.workOutEntries = ['gates.json'] }, 'workOutEmptyTmpfs')
	fails('/work/out unreadable', (i) => { i.workOutEntries = null }, 'workOutEmptyTmpfs')
	fails('KNORKE_LAB_OUT unset', (i) => { i.outDir = undefined }, 'outWritable')
	fails('KNORKE_LAB_OUT points into /work', (i) => { i.outDir = '/work/out'; i.resultsDir = '/work/out' }, 'outWritable')
	fails('reports go elsewhere than KNORKE_LAB_OUT', (i) => { i.resultsDir = '/work/out' }, 'outWritable')
	fails('/out mounted read-only', (i) => { i.mountinfo = i.mountinfo.replace('/out rw,relatime', '/out ro,relatime') }, 'outWritable')
	fails('no own mount at /out (container layer)', (i) => { i.mountinfo = i.mountinfo.replace(' /out rw', ' /other rw') }, 'outWritable')
	fails('write probe in /out failed', (i) => { i.outProbe = { ok: false, code: 'EACCES' } }, 'outWritable')
})
