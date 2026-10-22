#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Load run S1–SC of SPEC-M1 §8.7 against the dev stack of ONE namespace
# (default load). Runs dev/load/load.mjs on the host, pinned to
# KD_GEN_CPUSET, and protects the shared host while it runs.
#
# Usage: KD_NS=load dev/load/run.sh <S1|S4|S4e|S4d|S5|SF|SC> [load.mjs flags]
#        KD_NS=load dev/load/run.sh --check   (all preflights, no load)
# load.mjs flags: --seed N --secs N --warmup N --scale F --board N,N,N,N --steps N,N
# Reports: dev/load/out/$NS/<scenario>-<variant>[-<label>].{json,md}, the copy
# <scenario>-<variant>.{json,md} and summary.{md,json} (dev/load/lib/summary.mjs).
#
# Guards, in this order, each before anything is touched:
#   1. protected namespace (KD_PROTECT_NS, default try): exit 2 unless
#      KD_FORCE=1 – dev/lib.sh, before the first docker call (SPEC-M1 §8.1)
#   2. arguments and knobs: an unknown scenario, an invalid KD_RUN_LABEL,
#      KD_LOAD_ABORT, KD_LOAD_WATCH_SECS or KD_GEN_CPUSET → exit 2
#   3. ONE load run at a time on this host: exclusive, non-blocking flock on
#      $KD_LOCK_DIR/load.lock (default claude_projects/.knorke-dev/load.lock,
#      outside every repo copy, shared by $ROOT and $WORK) → busy: exit 2.
#      dev/load/variant.sh refuses while it is held. The stack lock
#      (stacks.lock) is NOT taken; the build lock of this copy is taken SHARED
#      for the whole run (like dev/e2e/run.sh): a build waits, so no js/ swap
#      and no cachebuster bump land in the middle of a measurement
#   4. stack: env.json, Nextcloud and the database run → else exit 2
#   5. host and prod at the start: the 1-min load is not above KD_LOAD_ABORT
#      and the prod containers are inspectable and healthy → else exit 2
# Abort rule (SPEC-M1 §8.1 R2), checked every KD_LOAD_WATCH_SECS while the
# generator runs: the 1-min load of the host (first field of
# KD_LOAD_AVG_FILE) above KD_LOAD_ABORT at 3 readings in a row, or a prod
# container (nextcloud-nextcloud-1, nextcloud-nextcloud-db-1,
# nextcloud-nextcloud-redis-1) with a RestartCount above its value at the
# start, a health state other than healthy (where a healthcheck exists) or
# no answer to `docker inspect` → the reason goes to dev/.state/$NS/load-abort.txt,
# the generator gets SIGTERM (SIGKILL 20 s later), it writes its report as
# "abgebrochen", and run.sh exits 3. Prod is only ever read, with docker inspect.
#
# S4e (SPEC-M1 §8.7, WP-D4 phase 1): before the generator, run.sh starts the
# load run's Traefik knorke-dev-<ns>-traefik (traefik:3.6.0, present locally –
# never pulled; refused with exit 2 when missing) on the namespace's front
# network – 0 more networks – with the two rateLimit middlewares of the
# production edge copied verbatim (global 200/s burst 400, login 2/s burst 10;
# dev/load/lib/edge.mjs models the same), routing to the namespace's
# Nextcloud; host port 127.0.0.1:18601 only in the namespace load. Its config
# lives in dev/.state/<ns>/traefik/, its address goes to env.json
# .load.traefik {container, ip, port, hostPort, image}, which the generator
# talks to; the container and .load.traefik go again when run.sh ends.
#
# Knobs: KD_RUN_LABEL (^[a-z0-9-]{1,24}$) · KD_LOAD_ABORT (20) ·
#        KD_GEN_CPUSET (env.json .load.genCpuset, else 4-7; empty = no pinning)
# Injection points for the self-tests (never set them for a real run):
#        KD_LOAD_AVG_FILE (/proc/loadavg) · KD_LOAD_WATCH_SECS (5, 0.1–60) ·
#        `docker` = the first docker on PATH (dev/selftest/lib/sandbox.mjs puts
#        a fake first) · dev/load/load.mjs is run from this copy
# Exit: 0 gate green / report complete, 1 gate red or harness error,
#       2 refused (nothing measured), 3 aborted by the abort rule, 130/143 interrupted.
set -euo pipefail

export KD_NS="${KD_NS:-load}"
# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

LOAD="$DEV/load"
SCENARIOS="S1 S4 S4e S4d S5 SF SC"
PROD_CONTAINERS="nextcloud-nextcloud-1 nextcloud-nextcloud-db-1 nextcloud-nextcloud-redis-1"
LOAD_LOCK="$KD_LOCK_DIR/load.lock"
ABORT_FILE="$STATE/load-abort.txt"
GRACE_S=20
# S4e: the load run's Traefik (SPEC-M1 §8.1 port 18601, §8.7)
TRAEFIK="${DEV_PREFIX}traefik"
TRAEFIK_IMAGE="traefik:3.6.0"
TRAEFIK_HOST_PORT=18601
TRAEFIK_DIR="$STATE/traefik"

# --- 2. arguments and knobs ---------------------------------------------------
MODE="${1:-}"
[ $# -gt 0 ] && shift
case " $SCENARIOS --check " in
    *" $MODE "*) [ -n "$MODE" ] || refuse "usage: KD_NS=<ns> dev/load/run.sh <${SCENARIOS// /|}|--check> [load.mjs flags]" ;;
    *) refuse "usage: KD_NS=<ns> dev/load/run.sh <${SCENARIOS// /|}|--check> [load.mjs flags] (bekommen: '$MODE')" ;;
esac
[ "$MODE" = --check ] && [ $# -gt 0 ] && refuse "--check nimmt keine weiteren Argumente"
RUN_LABEL="${KD_RUN_LABEL:-}"
[ -z "$RUN_LABEL" ] || [[ "$RUN_LABEL" =~ ^[a-z0-9-]{1,24}$ ]] || refuse "KD_RUN_LABEL '$RUN_LABEL' ist ungültig (^[a-z0-9-]{1,24}\$)"
LOAD_ABORT="${KD_LOAD_ABORT:-20}"
[[ "$LOAD_ABORT" =~ ^[0-9]{1,3}(\.[0-9]{1,2})?$ ]] && awk -v a="$LOAD_ABORT" 'BEGIN { exit !(a > 0) }' \
    || refuse "KD_LOAD_ABORT '$LOAD_ABORT' ist ungültig (1-min-Last > 0, z. B. 20)"
WATCH_SECS="${KD_LOAD_WATCH_SECS:-5}"
[[ "$WATCH_SECS" =~ ^[0-9]{1,2}(\.[0-9])?$ ]] && awk -v a="$WATCH_SECS" 'BEGIN { exit !(a >= 0.1 && a <= 60) }' \
    || refuse "KD_LOAD_WATCH_SECS '$WATCH_SECS' ist ungültig (0.1–60)"
if [ -n "${KD_GEN_CPUSET+x}" ]; then
    valid_cpuset "$KD_GEN_CPUSET" || refuse "KD_GEN_CPUSET '$KD_GEN_CPUSET' ist ungültig (cpuset-Liste mit CPUs dieses Hosts, z. B. 4-7; leer = ohne Bindung)"
fi
LOAD_AVG_FILE="${KD_LOAD_AVG_FILE:-/proc/loadavg}"
[ "$LOAD_AVG_FILE" = /proc/loadavg ] || warn "KD_LOAD_AVG_FILE=$LOAD_AVG_FILE – nur für Selbsttests, die Abbruchregel liest dann nicht die Host-Last"

# load1: the 1-min load (first field of KD_LOAD_AVG_FILE); exit 1 if unreadable.
load1() {
    local one rest
    read -r one rest <"$LOAD_AVG_FILE" 2>/dev/null || return 1
    [[ "$one" =~ ^[0-9]+(\.[0-9]+)?$ ]] || return 1
    printf '%s\n' "$one"
}
# above A B: A > B (decimals).
above() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a + 0 > b + 0) }'; }

# prod_state NAME: "<RestartCount> <health|none>" via docker inspect (read-only); exit ≠ 0 if not inspectable.
prod_state() {
    docker inspect -f '{{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null
}

# --- 3. one load run at a time ------------------------------------------------
mkdir -p "$KD_LOCK_DIR" || refuse "Sperrverzeichnis $KD_LOCK_DIR lässt sich nicht anlegen (KD_LOCK_DIR)"
exec 8>>"$LOAD_LOCK" || refuse "Sperrdatei $LOAD_LOCK lässt sich nicht öffnen"
flock -x -n 8 || refuse "ein anderer Lastlauf hält $LOAD_LOCK – immer nur einer auf diesem Host (SPEC-M1 §8.7, W3 allein)"

# --- 4. stack -----------------------------------------------------------------
[ -f "$ENV_JSON" ] || refuse "$ENV_JSON fehlt – erst KD_NS=$NS KD_LOAD_PROFILE=prod … dev/up.sh (SPEC-M1 §8.7)"
container_running "$NC" || refuse "Stack '$NS' läuft nicht ($NC)"
db_container_running || refuse "Datenbank von '$NS' läuft nicht"
GEN_CPUSET="${KD_GEN_CPUSET-$(env_get '.load.genCpuset')}"
[ -n "${KD_GEN_CPUSET+x}" ] || [ -n "$GEN_CPUSET" ] || GEN_CPUSET=4-7
valid_cpuset "$GEN_CPUSET" || refuse "env.json .load.genCpuset '$GEN_CPUSET' ist ungültig (cpuset-Liste mit CPUs dieses Hosts) – KD_GEN_CPUSET setzen"
if [ "$MODE" = S4e ]; then
    docker image inspect "$TRAEFIK_IMAGE" >/dev/null 2>&1 || refuse "$TRAEFIK_IMAGE liegt nicht lokal vor – S4e zieht kein Bild (SPEC-M1 §0)"
fi

# --- 5. host and prod at the start --------------------------------------------
ONE="$(load1)" || refuse "1-min-Last nicht lesbar ($LOAD_AVG_FILE)"
above "$ONE" "$LOAD_ABORT" && refuse "1-min-Last $ONE liegt schon über KD_LOAD_ABORT=$LOAD_ABORT – Host nicht ruhig, kein Lastlauf (SPEC-M1 §8.1)"
declare -A PROD_RC0=()
for c in $PROD_CONTAINERS; do
    st="$(prod_state "$c")" || refuse "Prod-Container $c antwortet nicht auf docker inspect – ohne ihn greift die Abbruchregel nicht"
    rc="${st%% *}"
    health="${st#* }"
    [[ "$rc" =~ ^[0-9]+$ ]] || refuse "Prod-Container $c: RestartCount '$rc' nicht lesbar"
    case "$health" in
        healthy|none) ;;
        *) refuse "Prod-Container $c ist '$health' – kein Lastlauf, solange Prod nicht gesund ist" ;;
    esac
    PROD_RC0[$c]="$rc"
done
log "Start: 1-min-Last $ONE (Abbruch über $LOAD_ABORT bei 3 Messungen in Folge), Prod: $(for c in $PROD_CONTAINERS; do printf '%s rc=%s ' "$c" "${PROD_RC0[$c]}"; done)"

# prod_problem: prints why a prod container breaks the abort rule; exit 1 if none does.
prod_problem() {
    local c st rc health
    for c in $PROD_CONTAINERS; do
        if ! st="$(prod_state "$c")"; then
            printf 'Prod-Container %s antwortet nicht auf docker inspect\n' "$c"
            return 0
        fi
        rc="${st%% *}"
        health="${st#* }"
        if ! [[ "$rc" =~ ^[0-9]+$ ]] || [ "$rc" -gt "${PROD_RC0[$c]}" ]; then
            printf 'Prod-Container %s: RestartCount %s → %s\n' "$c" "${PROD_RC0[$c]}" "$rc"
            return 0
        fi
        case "$health" in
            healthy|none) ;;
            *) printf 'Prod-Container %s ist %s\n' "$c" "$health"; return 0 ;;
        esac
    done
    return 1
}

if [ "$MODE" = --check ]; then
    log "bereit: Sperre $LOAD_LOCK, Stack $NS, Generator-cpuset ${GEN_CPUSET:-(keins)}, Prod gesund"
    exit 0
fi

# Shared build lock for the whole run (fd 9 stays open until this script exits).
mkdir -p "$STATE_ROOT"
exec 9>>"$BUILD_LOCK"
if ! flock -s -n 9; then
    log "warte auf die Build-Sperre (ein Build läuft)"
    flock -s 9
fi
normalise_ns
command -v node >/dev/null || refuse "node fehlt"

# --- S4e: Traefik in front of Nextcloud ------------------------------------------
# traefik_config: the static and the dynamic file (the production edge's two
# rateLimit middlewares verbatim, backend = this namespace's Nextcloud).
traefik_config() {
    mkdir -p "$TRAEFIK_DIR"
    cat >"$TRAEFIK_DIR/traefik.yml" <<EOF
# Generated by dev/load/run.sh (S4e, SPEC-M1 §8.7) – the load run's Traefik.
entryPoints:
  web:
    address: ':80'
providers:
  file:
    filename: /etc/traefik/dynamic.yml
log:
  level: WARN
global:
  checkNewVersion: false
  sendAnonymousUsage: false
EOF
    cat >"$TRAEFIK_DIR/dynamic.yml" <<EOF
# Generated by dev/load/run.sh (S4e): the two rate limits of the production
# edge (_edge-vps/edge/data/traefik/dynamic_conf/http.routers.nextcloud.yml,
# values and router split as in dev/load/lib/edge.mjs), backend $NC.
http:
  routers:
    nextcloud:
      rule: "PathPrefix(\`/\`)"
      entryPoints: [web]
      service: nextcloud
      middlewares: [ratelimit-global]
    nextcloud-login:
      rule: "PathPrefix(\`/login\`) || PathPrefix(\`/index.php/login\`)"
      priority: 100
      entryPoints: [web]
      service: nextcloud
      middlewares: [ratelimit-login]
  middlewares:
    ratelimit-global:
      rateLimit:
        average: 200
        period: 1s
        burst: 400
    ratelimit-login:
      rateLimit:
        average: 2
        period: 1s
        burst: 10
  services:
    nextcloud:
      loadBalancer:
        servers:
          - url: "http://$NC:80"
EOF
}

# env_load_traefik JSON|null: sets or deletes env.json .load.traefik (mode 600 kept).
env_load_traefik() {
    local tmp="$ENV_JSON.tmp.$$"
    jq --argjson t "$1" 'if $t == null then (if .load then .load |= del(.traefik) else . end) else .load.traefik = $t end' "$ENV_JSON" >"$tmp" \
        && chmod 600 "$tmp" && mv -f -- "$tmp" "$ENV_JSON"
}

TRAEFIK_UP=0
start_traefik() {
    local ip code="" i hp=null
    local -a pub=()
    assert_own "$TRAEFIK"
    docker rm -fv "$TRAEFIK" >/dev/null 2>&1 || true
    traefik_config
    if [ "$NS" = load ]; then
        pub=(-p "127.0.0.1:$TRAEFIK_HOST_PORT:80")
        hp="$TRAEFIK_HOST_PORT"
    fi
    docker run -d --name "$TRAEFIK" --network "$NET" --label "$LABEL" --cpus 2 \
        ${pub[@]+"${pub[@]}"} -v "$TRAEFIK_DIR:/etc/traefik:ro" "$TRAEFIK_IMAGE" >/dev/null || die "Traefik ($TRAEFIK) startet nicht"
    TRAEFIK_UP=1
    ip="$(docker container inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$TRAEFIK" 2>/dev/null || true)"
    [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "Traefik ($TRAEFIK) hat keine Adresse im Netz $NET"
    for ((i = 0; i < 60; i++)); do
        code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' -H 'Host: localhost' "http://$ip/status.php" || true)"
        [ "$code" = 200 ] && break
        sleep 0.5
    done
    [ "$code" = 200 ] || die "Traefik ($TRAEFIK) leitet nicht an $NC weiter (status.php → $code)"
    env_load_traefik "$(jq -cn --arg c "$TRAEFIK" --arg ip "$ip" --arg img "$TRAEFIK_IMAGE" --argjson hp "$hp" \
        '{container: $c, ip: $ip, port: 80, hostPort: $hp, image: $img}')" || die "env.json .load.traefik nicht schreibbar"
    log "S4e: $TRAEFIK ($TRAEFIK_IMAGE) auf $ip:80 → $NC (Edge-Grenzen 200/s, Burst 400)"
}
stop_traefik() {
    [ "$TRAEFIK_UP" = 1 ] || return 0
    docker rm -fv "$TRAEFIK" >/dev/null 2>&1 || warn "docker rm -fv $TRAEFIK schlug fehl"
    env_load_traefik null || warn "env.json .load.traefik ließ sich nicht entfernen"
    TRAEFIK_UP=0
}

# --- the run ------------------------------------------------------------------
rm -f -- "$ABORT_FILE"
GEN_PID=""
WATCH_PID=""
GOT_SIG=""
cleanup() {
    local rc=$?
    [ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2>/dev/null
    [ -n "$GEN_PID" ] && kill -TERM "$GEN_PID" 2>/dev/null
    # SF switches knorke_dev on for its window; the prod profile wants it off again in every case
    if [ "$(env_get '.load.profile')" = prod ] && container_running "$NC"; then
        occ config:system:set knorke_dev --value=false --type=boolean >/dev/null 2>&1 || warn "knorke_dev ließ sich nicht zurücksetzen"
    fi
    stop_traefik
    exit "$rc"
}
trap cleanup EXIT
forward() {
    GOT_SIG="$1"
    [ -n "$GEN_PID" ] && kill -TERM "$GEN_PID" 2>/dev/null
    return 0
}
trap 'forward 130' INT
trap 'forward 143' TERM

# watchdog PID: the abort rule; writes the reason and stops the generator.
watchdog() {
    local pid="$1" over=0 one why i
    while kill -0 "$pid" 2>/dev/null; do
        sleep "$WATCH_SECS"
        kill -0 "$pid" 2>/dev/null || return 0
        why=""
        if ! one="$(load1)"; then
            why="1-min-Last nicht lesbar ($LOAD_AVG_FILE)"
        elif above "$one" "$LOAD_ABORT"; then
            over=$((over + 1))
            warn "1-min-Last $one über $LOAD_ABORT ($over von 3 in Folge)"
            if [ "$over" -ge 3 ]; then why="1-min-Last des Hosts über $LOAD_ABORT bei 3 Messungen in Folge (zuletzt $one)"; fi
        else
            over=0
        fi
        if [ -z "$why" ]; then why="$(prod_problem)" || why=""; fi
        if [ -n "$why" ]; then
            printf '%s\n' "$why" >"$ABORT_FILE"
            warn "ABBRUCHREGEL: $why – Generator wird beendet"
            kill -TERM "$pid" 2>/dev/null || return 0
            for ((i = 0; i < GRACE_S * 5; i++)); do
                kill -0 "$pid" 2>/dev/null || return 0
                sleep 0.2
            done
            kill -KILL "$pid" 2>/dev/null
            return 0
        fi
    done
    return 0
}

[ "$MODE" = S4e ] && start_traefik
GEN=(node "$LOAD/load.mjs" --scenario "$MODE" --abort-file "$ABORT_FILE" "$@")
[ -n "$GEN_CPUSET" ] && GEN=(taskset -c "$GEN_CPUSET" "${GEN[@]}")
[ -n "$GEN_CPUSET" ] || warn "KD_GEN_CPUSET leer – der Generator läuft ohne CPU-Bindung"
log "Generator: ${GEN[*]}${RUN_LABEL:+ (Kennzeichen $RUN_LABEL)}"
KD_NS="$NS" KD_RUN_LABEL="$RUN_LABEL" "${GEN[@]}" 8>&- 9>&- &
GEN_PID=$!
watchdog "$GEN_PID" 8>&- 9>&- &
WATCH_PID=$!
RC=0
# wait returns early (>128) when a trapped signal arrives; wait again for the generator's own exit.
while :; do
    wait "$GEN_PID" && RC=0 || RC=$?
    kill -0 "$GEN_PID" 2>/dev/null || break
done
GEN_PID=""
kill "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true
WATCH_PID=""
if [ -s "$ABORT_FILE" ]; then
    warn "abgebrochen nach der Abbruchregel: $(cat "$ABORT_FILE") (Generator endete mit $RC)"
    exit 3
fi
if [ -n "$GOT_SIG" ]; then
    warn "unterbrochen (Generator endete mit $RC)"
    exit "$GOT_SIG"
fi
exit "$RC"
