#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The only way to build the frontend once dev/build.sh exists (SPEC-M0 §0,
# §8.1; SPEC-M1 §8.1): `npm run build` (vite + build/check-bundle.mjs) under an
# EXCLUSIVE lock on dev/.state/build.lock, then the theming cachebuster +1 in
# every running namespace whose Nextcloud mounts THIS copy (otherwise cached
# entry points ask for deleted chunks) – and only there:
#   - env.json .appDir of the namespace (dev/.state/<ns>/ of this copy) is
#     $ROOT, and so is the container's app mount (docker container inspect)
#   - the namespace is not protected (KD_PROTECT_NS, default try). KD_FORCE
#     does not change that: try is busted by the user,
#     KD_FORCE=1 KD_NS=try dev/bust.sh
# Every other running namespace is reported, never touched (dev/lib.sh
# bust_plan). Before M1 this script busted EVERY running namespace, including
# the user's try stack, which mounts the live repo (SPEC-M1 §12.4 F8).
#
# Why the lock: EmptyJSDir empties js/ during the build. Runs that need the
# built frontend (dev/e2e/run.sh, clicking through) hold a SHARED lock on the
# same file (`flock -s`) for their whole run; a build waits for them, and they
# wait for a running build.
#
# Usage: dev/build.sh            build + bust (KD_NS is irrelevant)
#        dev/build.sh --plan     only show which namespaces a build would bust
set -euo pipefail

# build.sh works across namespaces: a KD_NS in the caller's environment must not
# pick a namespace (nor trip the namespace guard of dev/lib.sh).
unset KD_NS
# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PLAN_ONLY=0
case "${1:-}" in
    "") ;;
    --plan) PLAN_ONLY=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "unbekanntes Argument '$1' (dev/build.sh [--plan])" ;;
esac
[ $# -le 1 ] || die "zu viele Argumente (dev/build.sh [--plan])"

NS="*"   # only the log prefix uses NS from here on

# print_plan PLAN: the plan in readable lines on stderr.
print_plan() {
    local verb ns reason
    while read -r verb ns reason; do
        [ -n "$verb" ] || continue
        case "$verb" in
            bust) log "Cachebuster +1: $ns" ;;
            skip) log "ausgelassen: $ns – $reason" ;;
        esac
    done <<<"$1"
}

if [ "$PLAN_ONLY" = 1 ]; then
    PLAN="$(bust_plan)"
    [ -n "$PLAN" ] || log "kein laufender Namensraum"
    print_plan "$PLAN"
    printf '%s\n' "$PLAN" | grep -v '^$' || true
    exit 0
fi

mkdir -p "$STATE_ROOT"
exec 9>>"$BUILD_LOCK"
if ! flock -x -n 9; then
    log "warte auf die Build-Sperre $BUILD_LOCK (E2E-Lauf oder anderer Build aktiv)"
    flock -x 9
fi

log "npm run build in $ROOT"
# fd 9 closed for the build: no helper process may keep the lock alive.
(cd "$ROOT" && npm run build) 9>&-
[ -f "$ROOT/js/knorke-main.mjs" ] || die "Build ohne js/knorke-main.mjs"

PLAN="$(bust_plan)"
BUSTED=()
MISSED=()
SKIPPED=()
while read -r verb ns reason; do
    [ -n "$verb" ] || continue
    case "$verb" in
        bust)
            # KD_FORCE never reaches bust.sh: its own guard checks once more.
            if env -u KD_FORCE KD_NS="$ns" "$DEV/bust.sh" 9>&-; then
                BUSTED+=("$ns")
            else
                MISSED+=("$ns")
            fi
            ;;
        skip)
            SKIPPED+=("$ns")
            log "ausgelassen: $ns – $reason"
            ;;
    esac
done <<<"$PLAN"
log "Build fertig; Cachebuster erhöht in: ${BUSTED[*]:-(kein laufender Namensraum dieser Kopie)}"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
    log "nicht angefasst: ${SKIPPED[*]} (andere Kopie, geschützt oder andere App-Quelle; einen geschützten bustet nur sein Besitzer: KD_FORCE=1 KD_NS=<ns> dev/bust.sh)"
fi
if [ "${#MISSED[@]}" -gt 0 ]; then
    warn "Cachebuster NICHT erhöht in: ${MISSED[*]} (Stack nicht bereit?) – dort KD_NS=<ns> dev/bust.sh nachholen"
fi
