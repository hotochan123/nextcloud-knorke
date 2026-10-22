#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Knorke keys in this namespace's Redis (SPEC-M0 §5.1, §8.1): every key
# matching */knorke/*, or only those of one board under any epoch (SPEC-M1
# §5.1: <prefix>/knorke/<epoch>/<key>; r:, a:, g:<board>:*, p:, vt:),
# each with its TTL in seconds (-1 = none, a leak for r:/p:) and, with -v,
# its value. Read-only. The Redis of a dev stack requires a password (round 2
# U1); its container carries it as REDISCLI_AUTH, which redis-cli reads. It
# still execs into the container, so a protected namespace (KD_PROTECT_NS,
# default try) is refused with exit 2 unless KD_FORCE=1 (dev/lib.sh, SPEC-M1
# §8.1). The container name falls back to env.json .containers.redis for a
# pre-R5 env.json.
#
# Usage: KD_NS=d dev/redis-keys.sh [-v] [board]
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

VALUES=0
BOARD=""
while [ $# -gt 0 ]; do
    case "$1" in
        -v) VALUES=1; shift ;;
        -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
        *) BOARD="$1"; shift ;;
    esac
done
[ -z "$BOARD" ] || [[ "$BOARD" =~ ^[0-9]{1,18}$ ]] || die "Board-ID '$BOARD' ist ungültig (^[0-9]{1,18}\$)"

REDIS_C="$(env_redis_container)"
container_running "$REDIS_C" || die "$REDIS_C läuft nicht – erst KD_NS=$NS dev/up.sh"
rc() { docker exec "$REDIS_C" redis-cli "$@"; }

if [ -n "$BOARD" ]; then
    PATTERNS=("*/knorke/*/r:$BOARD" "*/knorke/*/a:$BOARD" "*/knorke/*/g:$BOARD:*" "*/knorke/*/p:$BOARD" "*/knorke/*/vt:$BOARD")
else
    PATTERNS=("*/knorke/*")
fi

N=0
for pat in "${PATTERNS[@]}"; do
    while IFS= read -r key; do
        [ -n "$key" ] || continue
        N=$((N + 1))
        ttl="$(rc TTL "$key")"
        if [ "$VALUES" = 1 ]; then
            val="$(rc --no-raw GET "$key" | head -c 400)"
            printf '%-70s ttl=%-5s %s\n' "$key" "$ttl" "$val"
        else
            printf '%-70s ttl=%s\n' "$key" "$ttl"
        fi
    done < <(rc --scan --pattern "$pat" | sort)
done
log "$N Schlüssel"
