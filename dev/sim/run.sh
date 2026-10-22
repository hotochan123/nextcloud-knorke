#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# HTTP contract tests and convergence run against the dev stack of ONE
# namespace (SPEC-M0 §8.3). Node runs on the host and talks to the container
# IP with `Host: localhost`; psql/redis-cli/occ go through `docker exec` into
# this namespace's containers only.
#
# Usage: KD_NS=d dev/sim/run.sh contract [--only C05,C23] [--keep]
#        KD_NS=d dev/sim/run.sh converge [--secs 30] [--faults basic|full|none] [--seed N]
#        KD_NS=d dev/sim/run.sh all            (contract, then converge)
# Reports: dev/sim/out/$NS/{contract,converge}.{json,md}
# Exit: 0 green, 1 red, 2 harness/stack not ready, 130/143 interrupted.
#
# Both suites run on every KD_DB kind. The contract suite (round 2 U2/U7):
# its database side channel is portable SQL, and a case that cannot apply to
# the stack is reported as "übersprungen" with its reason (C24 needs
# pg_stat_statements, C37 4-byte UTF-8, C48 a database WITHOUT it:
# KD_DB=mariadb|mysql with KD_MYSQL_UTF8MB4=0). The convergence run (SPEC-M1
# §8.6) reads the change log through Nextcloud's own connection (PHP in the
# Nextcloud container) and compares on a database without 4-byte UTF-8 with
# U+FFFD; on SQLite its window defaults to 45 s.
#
# A protected namespace (KD_PROTECT_NS, default try: the user's stack) is
# refused with exit 2 unless KD_FORCE=1 – dev/lib.sh, before any docker call
# (SPEC-M1 §8.1): the run writes boards and changes the app config there.
#
# Before the run the namespace is normalised (dev/lib.sh normalise_ns): a
# knorke_dev_skip_bump or public_template left behind by an interrupted run is
# deleted (round 2 U5). node runs in the background so that SIGINT/SIGTERM
# reach it: converge.mjs then resets its fault injection before it exits.
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

SIM="$DEV/sim"
MODE="${1:-}"
[ $# -gt 0 ] && shift
case "$MODE" in
    contract|converge|all) ;;
    *) echo "usage: KD_NS=<ns> $0 contract|converge|all [args]" >&2; exit 2 ;;
esac

[ -f "$ENV_JSON" ] || { warn "$ENV_JSON fehlt – erst KD_NS=$NS dev/up.sh"; exit 2; }
require_running
db_container_running || { warn "Datenbank von '$NS' läuft nicht"; exit 2; }
# Nextcloud must be ready (status -e: exit ≠ 0 also in maintenance mode or with
# a pending upgrade); otherwise every case would only see 503.
if ! occ status -e >/dev/null 2>&1; then
    warn "occ status -e schlägt fehl (Wartung, Upgrade offen oder NC nicht bereit) – Abbruch"
    exit 2
fi
command -v node >/dev/null || { warn "node fehlt"; exit 2; }
normalise_ns

export KD_NS="$NS"
export KD_NORMALISED=1

# run_node SCRIPT ARGS…: node in the background, its exit code returned. An
# INT or TERM to this script is passed on as TERM (a background job of a
# non-interactive shell ignores SIGINT, so INT itself might not arrive); after
# that the script stops with 130/143 instead of starting the next part.
NODE_PID=""
GOT_SIG=""
forward() {
    GOT_SIG="$1"
    [ -n "$NODE_PID" ] && kill -s TERM "$NODE_PID" 2>/dev/null || true
}
trap 'forward 130' INT
trap 'forward 143' TERM
run_node() {
    local r=0
    node "$@" &
    NODE_PID=$!
    # wait returns early (>128) when a trapped signal arrives; wait again for node's own exit.
    while :; do
        wait "$NODE_PID" && r=0 || r=$?
        kill -0 "$NODE_PID" 2>/dev/null || break
    done
    NODE_PID=""
    if [ -n "$GOT_SIG" ]; then
        warn "unterbrochen (node endete mit $r)"
        exit "$GOT_SIG"
    fi
    return "$r"
}

rc=0
if [ "$MODE" = contract ] || [ "$MODE" = all ]; then
    log "contract.mjs gegen $NC"
    run_node "$SIM/contract.mjs" "$@" || rc=$?
fi
if [ "$MODE" = converge ] || [ "$MODE" = all ]; then
    log "converge.mjs gegen $NC"
    if [ "$MODE" = all ]; then
        run_node "$SIM/converge.mjs" || { r=$?; [ "$rc" -eq 0 ] && rc=$r; }
    else
        run_node "$SIM/converge.mjs" "$@" || rc=$?
    fi
fi
exit "$rc"
