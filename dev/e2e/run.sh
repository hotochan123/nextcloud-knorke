#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Browser acceptance E01–E12 (SPEC-M0 §8.2, plus E04b, E09b, E13–E17) against
# the dev stack of ONE namespace. Playwright 1.49.1 runs in a throwaway
# container (mcr.microsoft.com/playwright:v1.49.1-jammy) on the namespace's
# front network and talks to http://knorke-dev-$NS-nc (a trusted domain, NOT
# a secure context). Steps that need the database or Redis go through the host
# bridge (hostbridge.sh, a fixed whitelist), started here in the background.
#
# Isolation (round 2 U3/U4):
#   - everything of a run lives in dev/e2e/out/$NS/ (bridge/, report.{md,json},
#     shots/), so runs in different namespaces never share a request queue;
#     an exclusive lock on dev/.state/$NS/e2e.lock refuses a second run in the
#     same namespace (exit 2)
#   - the container runs as an unprivileged uid without a host account
#     (KD_E2E_UID, default 47001; the image's pwuser is uid 1000, which on this
#     host is a real account), sees dev/e2e READ-ONLY at /work
#     (with an empty tmpfs over /work/out) and can write only dev/e2e/out/$NS
#     at /out; it gets a copy of env.json without the database and Redis
#     passwords (it cannot reach either: they sit on the internal network)
#   - the bridge's own files and its stop file live in a host-only control dir
#     dev/.state/$NS/e2e-ctl.*
# A protected namespace (KD_PROTECT_NS, default try: the user's stack) is
# refused with exit 2 unless KD_FORCE=1 – dev/lib.sh, before any docker call
# (SPEC-M1 §8.1): the bridge actions change Nextcloud's core configuration.
# Before the run the namespace is normalised (dev/lib.sh normalise_ns): a
# knorke_dev_skip_bump or public_template left by an interrupted run is deleted,
# the sharing policy, group memberships and Circles go back to their defaults,
# harness teams are destroyed. When the run ends (also red, interrupted or with
# a killed container) run.sh normalises once more: harness teams have no
# counterpart in World.cleanup (SPEC-M1 §8.4, lib/switches.mjs).
#
# For the whole run this script also holds a SHARED lock on
# dev/.state/build.lock: a frontend build (dev/build.sh, exclusive) waits until
# the run is over, so js/ cannot be emptied under a running browser.
#
# Usage: KD_NS=d dev/e2e/run.sh [--only E01,E03] [--repeat N] [--list]
#        KD_NS=d dev/e2e/run.sh --selftest     (host bridge, every action, no browser)
# Flake gate (each repetition in a fresh world, report "green/runs" per case;
# a red E04b keeps its /sync trace as a section of out/$NS/report.md):
#        KD_NS=d dev/e2e/run.sh --only E03,E04,E04b --repeat 8
# Knobs: KD_E2E_CPUSET (8-15) · KD_E2E_IMAGE · KD_E2E_UID (47001) · KD_DNS (empty =
# Docker default; environment or dev/local.env, read by dev/lib.sh)
# Report: dev/e2e/out/$NS/report.{md,json}; exit 1 if anything failed, 2 if the
# stack or the namespace is not ready (or another run holds it).
#
# Needs dev/e2e/node_modules (playwright 1.49.1, same as the image):
#   cd dev/e2e && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

E2E="$DEV/e2e"
IMAGE="${KD_E2E_IMAGE:-mcr.microsoft.com/playwright:v1.49.1-jammy}"
CPUSET="${KD_E2E_CPUSET:-8-15}"
DNS="${KD_DNS:-}"
NAME="${E2E_PREFIX}$$"
OUT="$E2E/out/$NS"
BRIDGE_DIR="$OUT/bridge"
E2E_LOCK="$STATE/e2e.lock"
# uid/gid of the container; owns $OUT so the container can write it. Not root,
# and by default no account on the host (getent passwd 47001 is empty here).
RUN_UID="${KD_E2E_UID:-47001}"

[ -f "$ENV_JSON" ] || { warn "$ENV_JSON fehlt – erst KD_NS=$NS dev/up.sh"; exit 2; }
# One run per namespace (fd 8 stays open until this script exits).
exec 8>>"$E2E_LOCK"
if ! flock -x -n 8; then
    warn "in Namensraum $NS läuft schon ein E2E-Lauf ($E2E_LOCK) – Abbruch"
    exit 2
fi
container_running "$NC" || { warn "Stack '$NS' läuft nicht ($NC) – erst KD_NS=$NS dev/up.sh"; exit 2; }
network_exists "$NET" || { warn "Netz $NET fehlt"; exit 2; }
[ -f "$E2E/node_modules/playwright/package.json" ] || die "dev/e2e/node_modules fehlt – cd dev/e2e && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci"
PWV="$(jq -r .version "$E2E/node_modules/playwright/package.json")"
[ "$PWV" = "1.49.1" ] || die "dev/e2e hat playwright $PWV, das Image erwartet 1.49.1"
[[ "$CPUSET" =~ ^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$ ]] || die "KD_E2E_CPUSET='$CPUSET' ist ungültig"
[[ "$RUN_UID" =~ ^[1-9][0-9]{2,5}$ ]] || die "KD_E2E_UID='$RUN_UID' ist ungültig (keine 0, 3–6 Ziffern)"

# Shared build lock for the whole run (fd 9 stays open until this script exits).
mkdir -p "$STATE_ROOT"
exec 9>>"$BUILD_LOCK"
if ! flock -s -n 9; then
    log "warte auf die Build-Sperre (ein Build läuft)"
    flock -s 9
fi

normalise_ns

# Output dir of this namespace; the previous run's bridge, shots and report go.
mkdir -p "$E2E/out"
[ -L "$E2E/out" ] && die "$E2E/out ist ein Symlink"
[ -L "$OUT" ] && rm -f -- "$OUT"
mkdir -p "$OUT"
rm -rf -- "${OUT:?}/bridge" "${OUT:?}/shots"
[ "${1:-}" = "--selftest" ] || rm -f -- "$OUT/report.md" "$OUT/report.json"
mkdir -p "$BRIDGE_DIR"
chown "$RUN_UID:$RUN_UID" "$OUT" "$BRIDGE_DIR"
chmod 755 "$OUT" "$BRIDGE_DIR"

# Host-only control dir: bridge work files, stop file, the container's env.json.
CTL="$(mktemp -d "$STATE/e2e-ctl.XXXXXX")"
jq 'del(.db.pass, .redis.pass)' "$ENV_JSON" >"$CTL/env.json"
chmod 644 "$CTL/env.json"

BRIDGE_PID=""
cleanup() {
    local rc=$?
    docker rm -fv "$NAME" >/dev/null 2>&1 || true
    if [ -n "$BRIDGE_PID" ]; then
        touch "$CTL/stop" 2>/dev/null || true
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            kill -0 "$BRIDGE_PID" 2>/dev/null || break
            sleep 0.2
        done
        kill "$BRIDGE_PID" 2>/dev/null || true
        wait "$BRIDGE_PID" 2>/dev/null || true
    fi
    if [ -n "${SELFTEST_FIXTURES:-}" ]; then
        KD_NS="$NS" "$E2E/selftest-fixtures.sh" down >/dev/null 2>&1 || true
    fi
    # back to the defaults (a subshell: die in normalise_ns must not end this trap)
    if container_running "$NC"; then
        ( normalise_ns ) || warn "normalise_ns nach dem Lauf schlug fehl – der nächste Lauf normalisiert erneut"
    fi
    rm -rf -- "${CTL:?}"
    exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

KD_NS="$NS" "$E2E/hostbridge.sh" "$BRIDGE_DIR" "$CTL" 8>&- 9>&- &
BRIDGE_PID=$!

if [ "${1:-}" = "--selftest" ]; then
    SELFTEST_FIXTURES=1
    KD_NS="$NS" "$E2E/selftest-fixtures.sh" up 8>&- 9>&- || die "Selbsttest-Fixtures ließen sich nicht anlegen"
fi

DNS_ARGS=()
[ -n "$DNS" ] && DNS_ARGS=(--dns "$DNS")
log "Container $NAME ($IMAGE, cpuset $CPUSET, uid $RUN_UID) gegen $NC, Ausgabe $OUT"
set +e
docker run --rm --name "$NAME" --label "$LABEL" --init --network "$NET" ${DNS_ARGS[@]+"${DNS_ARGS[@]}"} \
    --user "$RUN_UID:$RUN_UID" --shm-size 1g --cpuset-cpus "$CPUSET" \
    -v "$E2E:/work:ro" --mount "type=tmpfs,destination=/work/out" -v "$OUT:/out" \
    -v "$CTL/env.json:/state/env.json:ro" -w /work \
    -e KD_NS="$NS" -e KD_E2E_OUT=/out -e HOME=/tmp \
    "$IMAGE" node run.mjs "$@" 8>&- 9>&-
RC=$?
set -e
[ -f "$OUT/report.md" ] && [ "${1:-}" != "--selftest" ] && log "Bericht: $OUT/report.md"
exit "$RC"
