#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# nextcloud.log of this namespace's Nextcloud, filtered to Knorke entries of
# level >= 2 (warning, error, fatal) by default (SPEC-M0 §8.1). Every line is
# one JSON object; the output shows time, level, app, request id and message,
# plus the exception class and its first frames when there is one. It execs
# into the container, so a protected namespace (KD_PROTECT_NS, default try) is
# refused with exit 2 unless KD_FORCE=1 (dev/lib.sh, SPEC-M1 §8.1).
#
# Usage: KD_NS=d dev/logs.sh [-n N] [-f] [--all] [--level L] [--raw]
#   -n N       last N log lines of the file are scanned (default 2000)
#   -f         follow (tail -F) instead of a one-off scan
#   --all      every app, not only knorke
#   --level L  minimum level 0..4 (default 2)
#   --raw      print the matching JSON lines unchanged
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LINES=2000
FOLLOW=0
ALL=0
LEVEL=2
RAW=0
while [ $# -gt 0 ]; do
    case "$1" in
        -n) LINES="${2:?-n braucht eine Zahl}"; shift 2 ;;
        -f) FOLLOW=1; shift ;;
        --all) ALL=1; shift ;;
        --level) LEVEL="${2:?--level braucht 0..4}"; shift 2 ;;
        --raw) RAW=1; shift ;;
        -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
        *) die "unbekannte Option '$1' (siehe --help)" ;;
    esac
done
[[ "$LINES" =~ ^[0-9]{1,7}$ ]] || die "-n '$LINES' ist keine Zahl"
[[ "$LEVEL" =~ ^[0-4]$ ]] || die "--level '$LEVEL' ist nicht 0..4"

require_running
LOG="$(occ config:system:get logfile 2>/dev/null || true)"
[ -n "$LOG" ] || LOG="$(occ config:system:get datadirectory 2>/dev/null || echo /var/www/html/data)/nextcloud.log"
[[ "$LOG" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "unerwarteter Logpfad '$LOG'"

# fromjson? skips lines that are not JSON (a partly written line while following).
FILTER='fromjson? | select((.level // 0) >= ($lvl | tonumber))'
if [ "$ALL" = 0 ]; then
    FILTER="$FILTER"' | select(((.app // "") == "knorke") or ((.message // "" | tostring) | test("knorke"; "i")) or ((.exception // "" | tostring) | test("OCA\\\\\\\\Knorke|/knorke/"; "i")))'
fi
if [ "$RAW" = 0 ]; then
    FILTER="$FILTER"' | "\(.time // "?") L\(.level // "?") [\(.app // "-")] \(.reqId // "-") \(.method // "") \(.url // "")\n    \(.message // "" | tostring | .[0:600])"
        + (if (.exception // null) != null then
             "\n    " + ((.exception | if type == "string" then (fromjson? // {Message: .}) else . end)
                       | "\(.Exception // "?"): \(.Message // "")"
                         + ((.Trace // [])[0:3] | map("\n      at \(.class // "")\(.type // "")\(.function // "") \(.file // "")#\(.line // "")") | join("")))
           else "" end)'
else
    FILTER="$FILTER"' | tojson'
fi

if [ "$FOLLOW" = 1 ]; then
    docker exec "$NC" sh -c "tail -n 0 -F $LOG 2>/dev/null" | jq -rR --unbuffered --arg lvl "$LEVEL" "$FILTER"
else
    docker exec "$NC" sh -c "[ -f $LOG ] && tail -n $LINES $LOG || true" | jq -rR --arg lvl "$LEVEL" "$FILTER"
fi
