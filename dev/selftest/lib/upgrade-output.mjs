/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Verdicts on the output of `occ upgrade` (dev/selftest/upgrade.sh, step 4;
 * tested by dev/selftest/upgradeOutput.test.mjs). Each verdict returns the
 * offending lines; none = clean.
 *
 *   otherApps     lines that update an app other than knorke
 *                 ("Updating <spreed> ...", "Updated <spreed> to …"); the core
 *                 schema line "Updating database schema" and app-store checks
 *                 do not count
 *   repairErrors  "Repair error: …" lines: a repair step failed, yet
 *                 `occ upgrade` still says "Update successful" and exits 0
 *                 (wave W2, r1-w2: core "Repair MySQL collation" on a mixed
 *                 utf8mb4/utf8mb3 instance went unnoticed)
 *
 * CLI (stdin = the output, stdout = the offending lines, exit 0; 2 = usage):
 *   node dev/selftest/lib/upgrade-output.mjs other-apps|repair-errors
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const lines = (text) => String(text ?? '').split(/\r?\n/).filter((l) => l.trim() !== '')

/** Lines of `occ upgrade` that update an app other than knorke. */
export function otherApps(text) {
	return lines(text).filter((l) => /updat(ed|ing) .*(app|<)/i.test(l) && !/knorke|database|checking/i.test(l))
}

/** "Repair error: …" lines of `occ upgrade` (a failed repair step). */
export function repairErrors(text) {
	return lines(text).filter((l) => /^\s*Repair error\b/.test(l))
}

const VERDICTS = { 'other-apps': otherApps, 'repair-errors': repairErrors }

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
	const fn = VERDICTS[process.argv[2]]
	if (!fn || process.argv.length !== 3) {
		process.stderr.write(`usage: node ${process.argv[1]} ${Object.keys(VERDICTS).join('|')} < occ-upgrade-output\n`)
		process.exit(2)
	}
	const out = fn(fs.readFileSync(0, 'utf8'))
	if (out.length) process.stdout.write(out.join('\n') + '\n')
}
