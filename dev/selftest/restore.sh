#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Restore probe of the epoch runbook (SPEC-M1 §5.4, §10 P5, Revision 19
# T4-08) against the running dev stack of ONE namespace, PostgreSQL only
# (phase 1: namespace d; phase 2: br in wave W2). The steps and the pass rule
# are in dev/selftest/lib/restore-probe.mjs:
#   board seeded → pg_dump → confirmed writes W of an open Sim client →
#   maintenance on → pg_restore → occ config:app:set knorke epoch → maintenance
#   off → the client resyncs exactly once, W is gone from snapshot and mirror,
#   the new epoch everywhere.
# The probe restores the WHOLE Nextcloud database of the namespace to the
# dump (like a real restore) – never run it next to other suites on the
# same namespace.
#
# Usage:  KD_NS=d dev/selftest/restore.sh [--keep]
# Knobs:  KD_RUN_LABEL (^[a-z0-9-]{1,24}$, optional)
# Report: dev/sim/out/$NS/restore-pgsql[-<label>].{md,json} (run evidence,
#         SPEC-M1 §9.0 point 2 R19)
# Exit:   0 green, 1 red, 2 refused (protected namespace, not pgsql, stack
#         not running, invalid label)
#
# A protected namespace (KD_PROTECT_NS, default try) is refused with exit 2
# unless KD_FORCE=1 (dev/lib.sh), before any docker call.
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

KEEP=()
while [ $# -gt 0 ]; do
    case "$1" in
        --keep) KEEP=(--keep); shift ;;
        -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
        *) refuse "unbekanntes Argument '$1' (usage: KD_NS=<ns> dev/selftest/restore.sh [--keep])" ;;
    esac
done
RUN_LABEL="${KD_RUN_LABEL:-}"
[ -z "$RUN_LABEL" ] || [[ "$RUN_LABEL" =~ ^[a-z0-9-]{1,24}$ ]] || refuse "KD_RUN_LABEL '$RUN_LABEL' ist ungültig (^[a-z0-9-]{1,24}\$)"
[ -f "$ENV_JSON" ] || refuse "$ENV_JSON fehlt – erst KD_NS=$NS dev/up.sh"
[ "$(db_kind)" = pgsql ] || refuse "die Restore-Probe braucht KD_DB=pgsql (pg_dump/pg_restore); Namensraum $NS hat $(db_kind)"
container_running "$NC" || refuse "Stack '$NS' läuft nicht ($NC)"
db_container_running || refuse "Datenbank von '$NS' läuft nicht"
command -v node >/dev/null || refuse "node fehlt"
STEM="restore-pgsql${RUN_LABEL:+-$RUN_LABEL}"
normalise_ns
log "Restore-Probe in $NS (Bericht dev/sim/out/$NS/$STEM.md)"
KD_NS="$NS" KD_REPORT_STEM="$STEM" node "$DEV/selftest/lib/restore-probe.mjs" ${KEEP[@]+"${KEEP[@]}"}
