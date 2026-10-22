# shellcheck shell=bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Shared helpers of the dev scripts (SPEC-M0 §8.1, SPEC-M1 §8.1). Sourced,
# never executed.
#
# Every dev script works on exactly ONE namespace KD_NS (^[a-z]{1,8}$, default
# main). All names derive from it, so a script can never reach a container of
# another namespace, a knorke-lab-* container (owned by the scene lab) or a
# production container (nextcloud-nextcloud-*):
#
#   network   knorke-dev-$NS-net      label knorke=dev-$NS (front: publishes NC)
#   network   knorke-dev-$NS-back     label knorke=dev-$NS, --internal (db, redis)
#   database  knorke-dev-$NS-db       label knorke=dev-$NS (none with KD_DB=sqlite)
#   redis     knorke-dev-$NS-redis    label knorke=dev-$NS, requirepass
#   nextcloud knorke-dev-$NS-nc       label knorke=dev-$NS + knorke.db=<kind>,
#                                     on both networks, 127.0.0.1:$PORT -> 80
#   state     dev/.state/$NS/         (env.json with passwords, mode 700; one
#                                     dev/.state per repo copy)
#
# Protected namespaces (SPEC-M1 §0, §8.1): KD_PROTECT_NS (default "try", the
# user's own test stack, which mounts the live repo) lists namespaces no agent
# may touch. Sourcing this file refuses them with exit 2 before the script's
# first docker call, unless KD_FORCE=1 (only the user sets that). The names
# shots, report, bridge and out are reserved (old report layout) and invalid.
#
# Default ports (default_port): main 18580, b 18581, c 18582, d 18583, br 18584,
# try 18590 (the user's), rm rs rx ry 18591–18594, dm dy dq dl 18595–18598,
# load 18599, nf 18600 (NC 35), ipad 18611. 18601 (Traefik of the load run),
# 18612 (tablet session server in R-A, app relay in R-B) and 18613 (session
# server in R-B) are no Nextcloud ports. Any other namespace needs KD_PORT.
# Scripts that talk to a running stack read the published port from the
# container itself, so a KD_PORT given to up.sh is honoured later.
#
# Stack cap (SPEC-M1 §0, §8.1): up.sh counts every network with a label key
# knorke* (dev stacks knorke=dev-<ns>, the spike's knorke-spike*) under the
# shared lock $KD_LOCK_DIR/stacks.lock and refuses a new stack when
# count + 2 > 2·KD_MAX_STACKS + 1 (5 stacks of 2 networks next to try's one).

KD_DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEV="$KD_DEV_DIR"
ROOT="$(cd "$DEV/.." && pwd -P)"
STATE_ROOT="$ROOT/dev/.state"
BUILD_LOCK="$STATE_ROOT/build.lock"
PLACEHOLDER_DIR="$DEV/selftest/placeholder"
# Production Nextcloud stack: never written, never mounted writable, never
# exec'd. Only KD_PROD_APPS=1 bind-mounts single app folders from it read-only.
# Its path is a host value: KD_PROD_STACK_DIR (environment or dev/local.env,
# read below; empty by default). Set once the local values are loaded.
PROD_STACK_DIR=""

# in_prod_stack PATH: true if PATH lies in the production stack under ANY mount
# of it. On Unraid the same folder is also reachable through a second view
# (the user share; shfs: other device and inode, so pwd -P / readlink do not
# map it back); hence the match on the path tail, which holds even when
# PROD_STACK_DIR is empty. An empty PROD_STACK_DIR adds no pattern (never "/*",
# which would refuse every path).
in_prod_stack() {
    case "${1%/}/" in
        */docker/stacks/nextcloud/*) return 0 ;;
    esac
    if [ -n "$PROD_STACK_DIR" ]; then
        case "${1%/}/" in
            "$PROD_STACK_DIR"/*) return 0 ;;
        esac
    fi
    return 1
}
KD_TAG="${KD_TAG:-$(basename "$0" .sh)}"

NS="${KD_NS:-main}"

log() { printf '[%s %s %s] %s\n' "$KD_TAG" "$NS" "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '[%s %s] WARNUNG: %s\n' "$KD_TAG" "$NS" "$*" >&2; }
die() { printf '[%s %s] FEHLER: %s\n' "$KD_TAG" "$NS" "$*" >&2; exit 1; }
# refuse: exit 2 = refused on purpose (protected namespace, reserved port,
# stack cap, busy lock, exhausted address pools) – nothing was touched.
refuse() { printf '[%s %s] VERWEIGERT: %s\n' "$KD_TAG" "$NS" "$*" >&2; exit 2; }

[[ "$NS" =~ ^[a-z]{1,8}$ ]] || die "KD_NS='$NS' ist ungültig (erlaubt: ^[a-z]{1,8}\$)"

# Reserved names (SPEC-M1 §8.1): the folders of the pre-R5 report layout in
# dev/e2e/out and dev/sim/out. Same list as RESERVED_NS in
# dev/e2e/lib/bridge.mjs and dev/sim/lib/report.mjs (outDir()).
KD_RESERVED_NS="shots report bridge out"
case " $KD_RESERVED_NS " in
    *" $NS "*) die "KD_NS='$NS' ist reserviert (nicht erlaubt: $KD_RESERVED_NS)" ;;
esac

# --- protected namespaces (SPEC-M1 §0, §8.1) ----------------------------------
# "-" instead of ":-": an explicitly empty KD_PROTECT_NS protects nothing.
# Entries are separated by blanks or commas.
KD_PROTECT_NS="${KD_PROTECT_NS-try}"
[[ "$KD_PROTECT_NS" =~ ^[a-z,\ ]*$ ]] || die "KD_PROTECT_NS='$KD_PROTECT_NS' ist ungültig (Namensräume ^[a-z]{1,8}\$, durch Leerzeichen oder Komma getrennt)"
for _kd_p in ${KD_PROTECT_NS//,/ }; do
    [[ "$_kd_p" =~ ^[a-z]{1,8}$ ]] || die "KD_PROTECT_NS enthält '$_kd_p' (erlaubt: ^[a-z]{1,8}\$)"
done
unset _kd_p

# is_protected NS: NS is listed in KD_PROTECT_NS.
is_protected() {
    local p
    for p in ${KD_PROTECT_NS//,/ }; do
        [ "$p" = "$1" ] && return 0
    done
    return 1
}

# script_path: the running script relative to the repo root (for hints).
script_path() {
    local abs
    abs="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)/$(basename "$0")"
    printf '%s\n' "${abs#"$ROOT"/}"
}

# guard_ns: refuses a protected namespace unless KD_FORCE=1 (exit 2). Runs
# below, while the script sources this file – before any docker call.
guard_ns() {
    is_protected "$NS" || return 0
    if [ "${KD_FORCE:-}" = 1 ]; then
        warn "Namensraum '$NS' ist geschützt (KD_PROTECT_NS='$KD_PROTECT_NS') – KD_FORCE=1, weiter"
        return 0
    fi
    refuse "Namensraum '$NS' ist geschützt (KD_PROTECT_NS='$KD_PROTECT_NS'): er gehört dem Nutzer, kein Agent fährt ihn hoch oder herunter, startet ihn neu, erhöht dort den Cachebuster oder ruft dort occ auf (SPEC-M1 §0). Erlaubt sind nur docker ps/inspect. Nur der Nutzer selbst: KD_FORCE=1 KD_NS=$NS $(script_path) …"
}
guard_ns

# --- local values (docs/ENTWICKLUNG.md §3.10) ---------------------------------
# Host values that stay out of the public tree (the DNS server for containers,
# this host's LAN address, the path of the production stack) come from the
# environment, else from the untracked file dev/local.env (template:
# dev/local.env.example), else the neutral defaults hold (all empty). A set
# variable, also an empty one, wins over the file: KD_DNS= still means
# "Docker's default". The file is parsed, never sourced: KEY=VALUE lines with
# the keys of KD_LOCAL_KEYS only (no export, no blank before the =), blank and
# # lines skipped, the value taken literally up to the end of the line (outer
# blanks trimmed, no quotes, no $), every value checked. Any error is exit 1
# with <file>:<line>, before the script's first docker call. Which file:
#   KD_LOCAL_ENV set, not empty   exactly that one (relative to $ROOT); missing
#                                 or unreadable: exit 1
#   KD_LOCAL_ENV set, empty       none (repair or bypass a broken file)
#   KD_LOCAL_ENV unset            $ROOT/dev/local.env, else the one of the main
#                                 working tree (git --git-common-dir ending in
#                                 /.git), so a git worktree of this repo needs
#                                 none of its own; no git, no repo: none
KD_LOCAL_KEYS="KD_DNS KD_LAN_HOST KD_PROD_STACK_DIR"

# valid_ipv4 ADDR: four decimal parts 0–255 without leading zeros.
valid_ipv4() {
    local p
    [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
    for p in ${1//./ }; do
        [[ "$p" =~ ^(0|[1-9][0-9]*)$ ]] && [ "$p" -le 255 ] || return 1
    done
    return 0
}

# valid_lan_host ADDR: a private IPv4 host address – 10.0.0.0/8,
# 172.16.0.0/12 or 192.168.0.0/16, last part 1–254. The same rule as
# lanHostValid in dev/ipad/relay.mjs and allowedHost in
# dev/scene-lab/ipad/session.mjs (dev/selftest/ipad.test.mjs compares them).
valid_lan_host() {
    local a b c d
    valid_ipv4 "$1" || return 1
    IFS=. read -r a b c d <<<"$1"
    [ "$d" -ge 1 ] && [ "$d" -le 254 ] || return 1
    [ "$a" = 10 ] && return 0
    [ "$a" = 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ] && return 0
    [ "$a" = 192 ] && [ "$b" = 168 ] && return 0
    return 1
}

# valid_dns ADDR: empty, IPv4 or an IPv6 literal (hex digits, ':' and '.',
# at least one ':').
valid_dns() {
    [ -z "$1" ] && return 0
    valid_ipv4 "$1" && return 0
    [[ "$1" =~ ^[0-9A-Fa-f:.]+$ && "$1" == *:* ]]
}

# valid_prod_dir PATH: absolute, not /, no path part "..", only letters,
# digits and ._-+@/ (no blanks, quotes, $ or backticks).
valid_prod_dir() {
    [[ "$1" =~ ^/[A-Za-z0-9._@+/-]*$ ]] || return 1
    [[ "$1" =~ [^/] ]] || return 1
    case "/$1/" in */../*) return 1 ;; esac
    return 0
}

# kd_local_key KEY: KEY is one of KD_LOCAL_KEYS (exact match).
kd_local_key() {
    local k
    for k in $KD_LOCAL_KEYS; do
        [ "$k" = "$1" ] && return 0
    done
    return 1
}

# kd_check_local KEY VALUE SOURCE [HINT]: exit 1 unless VALUE is empty or
# valid for KEY; HINT ends the message (for a file: the way around it).
kd_check_local() {
    [ -n "$2" ] || return 0
    case "$1" in
        KD_DNS) valid_dns "$2" || die "$1='$2' ($3) ist ungültig (leer, IPv4 oder IPv6-Literal, ohne Anführungszeichen)${4:-}" ;;
        KD_LAN_HOST) valid_lan_host "$2" || die "$1='$2' ($3) ist ungültig (private IPv4-Hostadresse aus 10.0.0.0/8, 172.16.0.0/12 oder 192.168.0.0/16, letzte Stelle 1–254)${4:-}" ;;
        KD_PROD_STACK_DIR) valid_prod_dir "$2" || die "$1='$2' ($3) ist ungültig (absoluter Pfad, nicht /, ohne Pfadteil .., nur Buchstaben, Ziffern und ._-+@/)${4:-}" ;;
    esac
    return 0
}

# kd_find_local_env: sets KD_LOCAL_FILE to the file to read (empty: none).
kd_find_local_env() {
    local common
    KD_LOCAL_FILE=""
    if [ -n "${KD_LOCAL_ENV+x}" ]; then
        [ -n "$KD_LOCAL_ENV" ] || return 0
        KD_LOCAL_FILE="$KD_LOCAL_ENV"
        case "$KD_LOCAL_FILE" in
            /*) ;;
            *) KD_LOCAL_FILE="$ROOT/$KD_LOCAL_FILE" ;;
        esac
        if [ ! -f "$KD_LOCAL_FILE" ] || [ ! -r "$KD_LOCAL_FILE" ]; then
            die "KD_LOCAL_ENV='$KD_LOCAL_ENV': $KD_LOCAL_FILE fehlt oder ist keine lesbare Datei (KD_LOCAL_ENV= liest keine Datei)"
        fi
        return 0
    fi
    if [ -f "$ROOT/dev/local.env" ]; then
        KD_LOCAL_FILE="$ROOT/dev/local.env"
        return 0
    fi
    common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
    case "$common" in
        */.git)
            if [ -f "${common%/.git}/dev/local.env" ]; then
                KD_LOCAL_FILE="${common%/.git}/dev/local.env"
            fi
            ;;
    esac
    return 0
}

# kd_read_local_env FILE: parses FILE (see above) and fills every key that is
# not set in the environment. Never sources or evaluates anything. A UTF-8 BOM
# at the start of line 1 (some Windows editors write one) is dropped, as bytes,
# so the locale does not matter; one at the start of a later line stays an
# unknown key.
kd_read_local_env() {
    local file="$1" n=0 line key val seen=" " bom=$'\xef\xbb\xbf'
    [ -r "$file" ] || die "$file ist nicht lesbar (KD_LOCAL_ENV= liest keine Datei)"
    while IFS= read -r line || [ -n "$line" ]; do
        n=$((n + 1))
        [ "$n" -eq 1 ] && line="${line#"$bom"}"
        [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
        [[ "$line" == *=* ]] || die "$file:$n: Zeile ohne '=' (erwartet SCHLÜSSEL=WERT; KD_LOCAL_ENV= liest keine Datei)"
        key="${line%%=*}"
        kd_local_key "$key" || die "$file:$n: unbekannter Schlüssel '$key' (erlaubt: $KD_LOCAL_KEYS; ohne export, ohne Leerzeichen vor dem =; KD_LOCAL_ENV= liest keine Datei)"
        case "$seen" in
            *" $key "*) die "$file:$n: $key steht doppelt in der Datei (KD_LOCAL_ENV= liest keine Datei)" ;;
        esac
        seen="$seen$key "
        val="${line#*=}"
        val="${val#"${val%%[![:space:]]*}"}"
        val="${val%"${val##*[![:space:]]}"}"
        kd_check_local "$key" "$val" "$file:$n" "; KD_LOCAL_ENV= liest keine Datei"
        if [ -z "${!key+x}" ]; then
            printf -v "$key" '%s' "$val"
        fi
    done <"$file"
    return 0
}

kd_load_local_values() {
    local key
    for key in $KD_LOCAL_KEYS; do
        if [ -n "${!key+x}" ]; then
            kd_check_local "$key" "${!key}" "aus der Umgebung"
        fi
    done
    kd_find_local_env
    if [ -n "$KD_LOCAL_FILE" ]; then
        kd_read_local_env "$KD_LOCAL_FILE"
    fi
    PROD_STACK_DIR="${KD_PROD_STACK_DIR:-}"
    while [ "${PROD_STACK_DIR%/}" != "$PROD_STACK_DIR" ]; do
        PROD_STACK_DIR="${PROD_STACK_DIR%/}"
    done
    return 0
}
kd_load_local_values

NET="knorke-dev-$NS-net"
BACK="knorke-dev-$NS-back"
DB="knorke-dev-$NS-db"
REDIS="knorke-dev-$NS-redis"
NC="knorke-dev-$NS-nc"
LABEL_KEY="knorke"
LABEL_VAL="dev-$NS"
LABEL="$LABEL_KEY=$LABEL_VAL"
E2E_PREFIX="knorke-e2e-$NS-"
DEV_PREFIX="knorke-dev-$NS-"
STATE="$STATE_ROOT/$NS"
ENV_JSON="$STATE/env.json"
APP_ROUTE_PROBE="/index.php/apps/knorke/api/v1/boards"

# Default host port of a namespace (SPEC-M1 §8.1; empty for namespaces outside
# the table).
default_port() {
    case "$1" in
        main) echo 18580 ;;
        b) echo 18581 ;;
        c) echo 18582 ;;
        d) echo 18583 ;;
        br) echo 18584 ;;
        try) echo 18590 ;;
        rm) echo 18591 ;;
        rs) echo 18592 ;;
        rx) echo 18593 ;;
        ry) echo 18594 ;;
        dm) echo 18595 ;;
        dy) echo 18596 ;;
        dq) echo 18597 ;;
        dl) echo 18598 ;;
        load) echo 18599 ;;
        nf) echo 18600 ;;
        ipad) echo 18611 ;;
        *) echo "" ;;
    esac
}
# The user's try stack publishes 18590; up.sh refuses it for every other
# namespace. 18601 (Traefik of the load run S4e, namespace load), 18612 (the
# tablet session server dev/scene-lab/ipad/session.mjs in R-A, the app relay
# to the ipad stack in R-B) and 18613 (the session server in R-B) are host
# ports, but never a namespace's Nextcloud (SPEC-M1 §8.1, §8.8).
KD_TRY_PORT=18590
KD_NON_NC_PORTS="18601 18612 18613"

# --- stack cap (SPEC-M1 §0, §8.1) ---------------------------------------------
# At most KD_MAX_STACKS dev stacks next to try: each takes 2 networks, the
# host's address pools hold only a few more. The lock lives OUTSIDE every repo
# copy (default: next to them, claude_projects/.knorke-dev/), so $ROOT and
# $WORK count under the same lock.
KD_MAX_STACKS="${KD_MAX_STACKS:-5}"

# beside_root NAME: the path NAME in the folder that holds this repo copy (next
# to it, outside it), e.g. claude_projects/.knorke-dev. A copy directly under
# / (a bind mount like /src in a CI container) gives /NAME, never //NAME.
beside_root() {
    local parent
    parent="$(dirname "$ROOT")"
    printf '%s/%s\n' "${parent%/}" "$1"
}
KD_LOCK_DIR="${KD_LOCK_DIR:-$(beside_root .knorke-dev)}"

# knorke_networks: every network with a label key knorke* (knorke=dev-<ns>,
# knorke-spike*), one name per line. Exit ≠ 0 when docker cannot list them.
knorke_networks() {
    local out
    out="$(docker network ls --format '{{.Name}}|{{.Labels}}')" || return 1
    printf '%s\n' "$out" | awk '
        { i = index($0, "|"); if (i == 0) next
          name = substr($0, 1, i - 1); n = split(substr($0, i + 1), kv, ",")
          for (j = 1; j <= n; j++) { split(kv[j], p, "="); if (p[1] ~ /^knorke/) { print name; break } } }'
}

# --- CPU sets of the load run (SPEC-M1 §8.1 R2, §8.7; stage 4) -----------------
# valid_cpuset LIST: true for an empty LIST or a cpuset list like 0-3, 4,6 or
# 0-3,8 whose ranges ascend and whose CPUs this host has online (getconf);
# up.sh (KD_PG_CPUS, KD_GEN_CPUSET) and dev/load/run.sh (KD_GEN_CPUSET).
valid_cpuset() {
    local part a b max
    [ -n "$1" ] || return 0
    [[ "$1" =~ ^[0-9]{1,3}(-[0-9]{1,3})?(,[0-9]{1,3}(-[0-9]{1,3})?)*$ ]] || return 1
    max="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
    for part in ${1//,/ }; do
        a="${part%-*}"
        b="${part#*-}"
        [ "$((10#$a))" -le "$((10#$b))" ] || return 1
        if [ "$max" -gt 0 ] && [ "$((10#$b))" -ge "$max" ]; then return 1; fi
    done
    return 0
}

# cpuset_cpus LIST: the CPUs of a valid cpuset list, one per line.
cpuset_cpus() {
    local part a b i
    for part in ${1//,/ }; do
        a="$((10#${part%-*}))"
        b="$((10#${part#*-}))"
        for ((i = a; i <= b; i++)); do printf '%s\n' "$i"; done
    done
}

# cpusets_overlap A B: true if two cpuset lists share a CPU.
cpusets_overlap() {
    [ -n "$1" ] && [ -n "$2" ] || return 1
    [ -n "$(comm -12 <(cpuset_cpus "$1" | sort -u) <(cpuset_cpus "$2" | sort -u))" ]
}

# state_dir: creates dev/.state/$NS with mode 700 and prints it.
state_dir() {
    mkdir -p "$STATE_ROOT"
    mkdir -p "$STATE"
    chmod 700 "$STATE"
    printf '%s\n' "$STATE"
}

# rnd N: N random characters [A-Za-z0-9]. No SIGPIPE trap: tr dies of SIGPIPE
# once head has enough, which pipefail would turn into an error.
rnd() {
    local s
    s="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "$1" || true)"
    [ "${#s}" -eq "$1" ] || die "rnd: ${#s} statt $1 Zeichen"
    printf '%s' "$s"
}

# Guard for every destructive docker call: only names of this namespace.
assert_own() {
    case "$1" in
        "$DEV_PREFIX"*|"$E2E_PREFIX"*) ;;
        *) die "interner Schutz: '$1' gehört nicht zum Namensraum $NS" ;;
    esac
}

container_exists() { docker container inspect "$1" >/dev/null 2>&1; }
network_exists() { docker network inspect "$1" >/dev/null 2>&1; }
container_running() { [ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }

# occ ARGS…: occ inside this namespace's Nextcloud as www-data.
occ() { docker exec -u www-data "$NC" php occ "$@"; }

require_running() {
    container_running "$NC" || die "Stack '$NS' läuft nicht ($NC fehlt oder ist gestoppt) – erst KD_NS=$NS dev/up.sh"
}

# nc_port: host port published for the running Nextcloud of this namespace.
nc_port() {
    local p
    p="$(docker port "$NC" 80/tcp 2>/dev/null | sed -n 's/^127\.0\.0\.1:\([0-9]\{1,5\}\)$/\1/p' | head -n 1)"
    [ -n "$p" ] || die "$NC publiziert keinen Port auf 127.0.0.1"
    printf '%s\n' "$p"
}

# --- env.json readers with the fallbacks for a pre-R5 env.json ----------------
# (SPEC-M1 §3.8, §8.1) The user's try stack was started before SPEC-M0
# round 5: its env.json has exactly the keys admin, appDir, baseHost, baseNet,
# containers, gatewayIp, host, ncIp, network, ns, port, userPass, users,
# versions – no db, networks, redis – and one network. Missing keys fall back:
# db.kind = pgsql, networks = [network], Redis container = containers.redis.
# Container and network names still derive from KD_NS: env.json only confirms
# them and can never point a script at another namespace.
# Checked by dev/selftest/legacyEnv.test.mjs.

# env_get JQ: the value at the jq path in this namespace's env.json; empty when
# the file or the key is missing (or the file is no JSON).
env_get() {
    [ -f "$ENV_JSON" ] || return 0
    jq -r "($1) // empty" "$ENV_JSON" 2>/dev/null || true
}

# env_own NAME FALLBACK: NAME if it belongs to this namespace, else FALLBACK
# (with a warning when env.json named a foreign one).
env_own() {
    case "$1" in
        "") printf '%s\n' "$2" ;;
        "$DEV_PREFIX"*) printf '%s\n' "$1" ;;
        *)
            warn "env.json nennt '$1' – gehört nicht zum Namensraum $NS, nehme $2"
            printf '%s\n' "$2"
            ;;
    esac
}

# env_front_net: .networks.front, pre-R5 .network, else knorke-dev-$NS-net.
env_front_net() {
    local n
    n="$(env_get '.networks.front')"
    [ -n "$n" ] || n="$(env_get '.network')"
    env_own "$n" "$NET"
}

# env_back_net: .networks.back; empty for a pre-R5 stack (it has one network).
env_back_net() {
    local n
    n="$(env_get '.networks.back')"
    [ -n "$n" ] || return 0
    env_own "$n" "$BACK"
}

# env_redis_container: .redis.host, pre-R5 .containers.redis, else knorke-dev-$NS-redis.
env_redis_container() {
    local n
    n="$(env_get '.redis.host')"
    [ -n "$n" ] || n="$(env_get '.containers.redis')"
    env_own "$n" "$REDIS"
}

# nc_ip: address of the Nextcloud container on its front network.
nc_ip() {
    local net
    net="$(env_front_net)"
    docker container inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$NC"
}

# wait_nc PORT [SECONDS]: waits until status.php reports "installed":true.
wait_nc() {
    local port="$1" max="${2:-240}" i
    for ((i = 0; i < max; i++)); do
        if curl -sf -m 5 -H 'Host: localhost' "http://127.0.0.1:$port/status.php" 2>/dev/null | grep -q '"installed":true'; then
            return 0
        fi
        if ! container_running "$NC"; then
            docker logs --tail 40 "$NC" >&2 || true
            die "$NC läuft nicht mehr"
        fi
        sleep 1
    done
    docker logs --tail 40 "$NC" >&2 || true
    die "Nextcloud ($NC) meldet nach ${max}s nicht \"installed\":true"
}

# probe_401 PORT: the app route must answer 401 to an anonymous request
# (route exists, app enabled). 404 = APCu route cache or app disabled.
probe_401() {
    local port="$1" code
    code="$(curl -s -o /dev/null -m 20 -w '%{http_code}' -H 'Host: localhost' "http://127.0.0.1:$port$APP_ROUTE_PROBE" || true)"
    case "$code" in
        401) log "401-Probe grün: GET $APP_ROUTE_PROBE → 401" ;;
        404) die "GET $APP_ROUTE_PROBE → 404 (Routencache oder App aus; KD_NS=$NS dev/restart.sh, dev/occ.sh app:list)" ;;
        *) die "GET $APP_ROUTE_PROBE → '$code' statt 401" ;;
    esac
}

# running_namespaces: namespaces whose Nextcloud container runs right now.
running_namespaces() {
    local labels v ns
    labels="$(docker ps --filter "label=$LABEL_KEY" --format "{{.Label \"$LABEL_KEY\"}}" 2>/dev/null | sort -u || true)"
    for v in $labels; do
        case "$v" in
            dev-*) ns="${v#dev-}" ;;
            *) continue ;;
        esac
        [[ "$ns" =~ ^[a-z]{1,8}$ ]] || continue
        if [ "$(docker container inspect -f '{{.State.Running}}' "knorke-dev-$ns-nc" 2>/dev/null)" = "true" ]; then
            printf '%s\n' "$ns"
        fi
    done
    return 0
}

# bust_plan: what dev/build.sh does with each running namespace (SPEC-M1 §8.1),
# one line each:
#   bust <ns>           its Nextcloud mounts THIS copy: env.json .appDir is
#                       $ROOT and so is the container's app mount (docker
#                       container inspect, read-only), and <ns> is not protected
#   skip <ns> <reason>  everything else: protected (KD_FORCE does not change
#                       that), no env.json in this copy (a stack of another
#                       copy), or another app directory
bust_plan() {
    local ns env app mnt
    for ns in $(running_namespaces); do
        if is_protected "$ns"; then
            printf 'skip %s geschützt (KD_PROTECT_NS)\n' "$ns"
            continue
        fi
        env="$STATE_ROOT/$ns/env.json"
        if [ ! -f "$env" ]; then
            printf 'skip %s kein dev/.state/%s/env.json in dieser Kopie (Stack einer anderen Kopie)\n' "$ns" "$ns"
            continue
        fi
        app="$(jq -r '.appDir // empty' "$env" 2>/dev/null || true)"
        if [ "$app" != "$ROOT" ]; then
            printf 'skip %s env.json .appDir ist %s, nicht %s\n' "$ns" "${app:-?}" "$ROOT"
            continue
        fi
        mnt="$(docker container inspect -f '{{range .Mounts}}{{if eq .Destination "/var/www/html/custom_apps/knorke"}}{{.Source}}{{end}}{{end}}' "knorke-dev-$ns-nc" 2>/dev/null || true)"
        if [ "$mnt" != "$ROOT" ]; then
            printf 'skip %s der Container mountet %s, nicht %s\n' "$ns" "${mnt:-?}" "$ROOT"
            continue
        fi
        printf 'bust %s\n' "$ns"
    done
    return 0
}

# --- database kind (KD_DB, round 2 U2) ----------------------------------------
# pgsql (default) | mariadb | mysql | sqlite. A running stack knows its kind:
# env.json .db.kind, else the label knorke.db of its Nextcloud container, else
# pgsql (stacks started before the DB matrix existed, like try: pre-R5 env.json).
DB_KINDS="pgsql mariadb mysql sqlite"

valid_db_kind() {
    case "$1" in
        pgsql|mariadb|mysql|sqlite) return 0 ;;
    esac
    return 1
}

db_kind() {
    local k
    k="$(env_get '.db.kind')"
    [ -n "$k" ] || k="$(docker container inspect -f '{{index .Config.Labels "knorke.db"}}' "$NC" 2>/dev/null || true)"
    [ -n "$k" ] && [ "$k" != "<no value>" ] || k=pgsql
    valid_db_kind "$k" || die "unbekannte DB-Art '$k' (env.json .db.kind)"
    printf '%s\n' "$k"
}

# require_pgsql WHAT: exit 2 with a clear message when this stack is not PostgreSQL
# (pg_stat_statements, psql). Exit 2 = "not applicable here", not a test failure.
require_pgsql() {
    local k
    k="$(db_kind)"
    if [ "$k" != pgsql ]; then
        printf '[%s %s] ÜBERSPRUNGEN: %s gibt es nur mit KD_DB=pgsql; dieser Stack hat %s (allgemein: KD_NS=%s dev/db.sh)\n' \
            "$KD_TAG" "$NS" "$1" "$k" "$NS" >&2
        exit 2
    fi
}

# PHP for SQL against an SQLite stack (no sqlite3 CLI in the Nextcloud image):
# reads SQL from stdin, statements separated by ";" at the end of a line, runs
# them with PDO on Nextcloud's database file as www-data, prints result rows
# tab-separated (NULL as empty, like psql -A). Exit 1 on the first error.
# shellcheck disable=SC2016
KD_SQLITE_PHP='
$CONFIG = [];
require "/var/www/html/config/config.php";
if (!in_array($CONFIG["dbtype"] ?? "", ["sqlite", "sqlite3"], true)) { fwrite(STDERR, "dbtype ist nicht sqlite\n"); exit(1); }
$file = rtrim($CONFIG["datadirectory"] ?? "/var/www/html/data", "/") . "/" . ($CONFIG["dbname"] ?? "owncloud") . ".db";
try {
    $pdo = new PDO("sqlite:" . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 30]);
    foreach (preg_split("/;[ \t]*(\r?\n|$)/", stream_get_contents(STDIN)) as $sql) {
        if (trim($sql) === "") { continue; }
        $st = $pdo->query($sql);
        if ($st->columnCount() === 0) { continue; }
        while (($row = $st->fetch(PDO::FETCH_NUM)) !== false) {
            echo implode("\t", array_map(static fn ($v) => $v === null ? "" : (string)$v, $row)), "\n";
        }
    }
} catch (Throwable $e) { fwrite(STDERR, $e->getMessage() . "\n"); exit(1); }
'

# db_sql: runs the SQL on stdin in this namespace's database and prints the
# result rows tab-separated, without header (NULL: empty for pgsql/sqlite,
# "NULL" for mariadb/mysql). Exit ≠ 0 on an error. Passwords never appear on
# a command line: mariadb/mysql read them from their own container's env.
# mariadb/mysql talk utf8mb4 (--default-character-set=utf8mb4, P7-D VC-01):
# the mysql:8.4 client would otherwise fall back to latin1 and print 4-byte
# characters as "?" (same flag in dev/sim/lib/env.mjs Stack.sql, dev/db.sh).
db_sql() {
    case "$(db_kind)" in
        pgsql) docker exec -i "$DB" psql -U nextcloud -d nextcloud -X -q -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 ;;
        mariadb) docker exec -i "$DB" sh -c 'MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb --default-character-set=utf8mb4 -u "$MARIADB_USER" -N -B "$MARIADB_DATABASE"' ;;
        mysql) docker exec -i "$DB" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --default-character-set=utf8mb4 -u "$MYSQL_USER" -N -B "$MYSQL_DATABASE"' ;;
        sqlite) docker exec -i -u www-data "$NC" php -r "$KD_SQLITE_PHP" ;;
    esac
}

# db_container_running: the container that answers db_sql runs.
db_container_running() {
    if [ "$(db_kind)" = sqlite ]; then container_running "$NC"; else container_running "$DB"; fi
}

# --- dev hooks left behind (round 2 U5, SPEC-M1 §8.1) --------------------------
# Knorke app config keys the harness sets (bridge app-config, stage 4; P7-C:
# the two daily byte quotas, the byte cap of the change log and the link
# throttle, SPEC-M1 §33.1 j). The same list as HARNESS_APP_CONFIG in
# dev/sim/contract.mjs (SPEC-M1 §8.1; dev/selftest/normalise.test.mjs
# compares both). public_url is no number and not on it (§33.1 j, ED-25).
HARNESS_APP_CONFIG="budget_syncs budget_ops tombstone_days tombstone_cap changes_cap budget_bytes_board_day budget_bytes_user_day changes_bytes_cap link_limit"
# The byte keys of HARNESS_APP_CONFIG: only there 0 means "off", so only
# there the bridge action app-config takes 0 (SPEC-M1 §33.1 j, ED-23; for
# every other key the server reads 0 as its default, Limits::read).
HARNESS_BYTE_KEYS="budget_bytes_board_day budget_bytes_user_day changes_bytes_cap"
# Profile values of the dev profile (SPEC-M1 §33.1 j, ED-22): both byte
# quotas off and the link throttle high, so repeated runs as alice on the same
# UTC day and the link-heavy cases (E27–E30, C27, C42, C64–C66) never meet
# them. up.sh sets them right after create_limit; the prod profile
# (KD_LOAD_PROFILE=prod) and the iPad profile set nothing (the app's
# defaults). The same values as HARNESS_APP_PROFILE in dev/sim/contract.mjs
# and dev/e2e/lib/switches.mjs (dev/selftest/normalise.test.mjs and
# dev/e2e/switches.test.mjs compare them).
HARNESS_APP_PROFILE="budget_bytes_board_day=0 budget_bytes_user_day=0 link_limit=1000"

# harness_profile: the profile of this namespace from its env.json (SPEC-M1
# §33.1 j): prod when .load.profile is "prod", ipad when .ipad.profile is
# true, else dev (also without env.json). env.json gets no field of its own,
# so older stacks get their profile the same way.
harness_profile() {
    local p=""
    if [ -s "$ENV_JSON" ]; then
        p="$(jq -r 'if (.load.profile // null) == "prod" then "prod" elif (.ipad.profile // null) == true then "ipad" else "dev" end' "$ENV_JSON" 2>/dev/null || true)"
    fi
    case "$p" in
        prod|ipad) printf '%s\n' "$p" ;;
        *) echo dev ;;
    esac
}

# harness_baseline KEY [PROFILE]: the baseline ("Grundstand", SPEC-M1 §33.1 j)
# of a HARNESS_APP_CONFIG key – its value in HARNESS_APP_PROFILE in the dev
# profile, else empty (= not set). PROFILE defaults to harness_profile.
harness_baseline() {
    local kv profile="${2:-}"
    [ -n "$profile" ] || profile="$(harness_profile)"
    [ "$profile" = dev ] || return 0
    for kv in $HARNESS_APP_PROFILE; do
        if [ "${kv%%=*}" = "$1" ]; then
            printf '%s\n' "${kv#*=}"
            return 0
        fi
    done
    return 0
}
# Nextcloud's sharing policy of SPEC-M1 §7.4 (core shareapi_*), as
# key=default[|default…]: normalise_ns deletes every key (= default) and warns
# when another value stood. Nextcloud's typed (lexicon) booleans show as
# true/false (or 1/0) in occ config:list, so yes|true|1 and no|false|0 are
# all defaults (SPEC-M1 §24 R13: Nextcloud booleans are compared tolerantly).
# The same keys and defaults as SHAREAPI_DEFAULTS in dev/sim/contract.mjs.
KD_SHAREAPI_KEYS="shareapi_enabled=yes|true|1 shareapi_exclude_groups=no|false|0 shareapi_exclude_groups_list=[] \
shareapi_allow_group_sharing=yes|true|1 shareapi_only_share_with_group_members=no|false|0 \
shareapi_only_share_with_group_members_exclude_group_list=[] shareapi_allow_links=yes|true|1 \
shareapi_allow_links_exclude_groups=[] shareapi_enforce_links_password=no|false|0 \
shareapi_enforce_links_password_excluded_groups=[] shareapi_default_expire_date=no|false|0 \
shareapi_enforce_expire_date=no|false|0 shareapi_expire_after_n_days=7"

# Nextcloud system config (config.php) the harness sets: C63 sets
# sharing.minSearchStringLength (SPEC-M1 §8.1/§8.3 R13, SRV-14); normalise_ns
# deletes both keys when set. config.php has no APCu cache: no wait. The same
# list as HARNESS_SYSTEM_KEYS in dev/sim/contract.mjs.
KD_HARNESS_SYSTEM_KEYS="sharing.minSearchStringLength sharing.maxAutocompleteResults"

# shareapi_kind KEY: the value kind of a key of KD_SHAREAPI_KEYS, read off its
# default – bool (yes|true / no|false), list ([], a JSON list of group ids) or
# number (7); exit 1 for a key that is not on the list. The bridge action
# share-policy (dev/e2e/hostbridge.sh, SPEC-M1 §8.4) takes exactly these keys.
shareapi_kind() {
    local entry
    local -a all
    # no word splitting with globbing: the defaults contain "[]"
    read -r -a all <<<"$KD_SHAREAPI_KEYS"
    for entry in "${all[@]}"; do
        [ "${entry%%=*}" = "$1" ] || continue
        case "${entry#*=}" in
            "[]") echo list ;;
            yes\|*|no\|*) echo bool ;;
            *) echo number ;;
        esac
        return 0
    done
    return 1
}

# Teams the harness creates (bridge team-create, SPEC-M1 §8.4) are named
# <prefix><word>; normalise_ns destroys every team with this prefix and no other.
KD_HARNESS_TEAM_PREFIX="knorke-e2e-"

# app_config_values APP: "key<TAB>value" lines of one app's config (one occ call).
app_config_values() {
    occ config:list "$1" 2>/dev/null | jq -r --arg a "$1" '(.apps[$a] // {}) | to_entries[] | "\(.key)\t\(.value | tostring)"' 2>/dev/null || true
}

# config_of LINES KEY: the value of KEY in app_config_values output (empty when unset).
config_of() {
    printf '%s\n' "$1" | awk -F '\t' -v k="$2" '$1 == k { sub(/^[^\t]*\t/, ""); print; exit }'
}

# normalise_ns: deletes what an interrupted run can leave behind in this
# namespace – the fault injection knorke_dev_skip_bump (converge), the system
# keys sharing.minSearchStringLength and sharing.maxAutocompleteResults
# (KD_HARNESS_SYSTEM_KEYS: C63, stage 2), the app
# config public_template (E12, smoke), public_url (C83; dev stacks never
# set it, SPEC-M1 §33.1 j) and privacy_notice (M2 privacy notice: E43/E44
# through route 27; C47 needs it unset), Nextcloud's sharing policy of SPEC-M1
# §7.4 (KD_SHAREAPI_KEYS: C45, C46, E16, smoke, the share-policy bridge of
# stage 2), the harness's Knorke app config (HARNESS_APP_CONFIG, bridge
# app-config of stage 4: every key back to its baseline – the profile value
# of HARNESS_APP_PROFILE in the dev profile, set when missing or different,
# else deleted; P7-C, SPEC-M1 §33.1 j), theming imprintUrl/privacyUrl when they carry the
# harness marker "knorke-harness" (C47, E15; URLs the instance itself has
# stay) – switches Circles back on (bridge circles off, stage 2), puts the
# membership of the harness groups back (normalise_groups: bridge group-member,
# stage 2) and destroys the harness teams (normalise_teams: bridge
# team-create, stage 2). It says so when something was set. Runs that start
# from a known state (dev/sim/run.sh, dev/e2e/run.sh) call it first;
# dev/e2e/run.sh calls it again when the run ends. App config is cached up to
# 3 s in the web server's APCu (C41), so after a real change the function
# waits 4 s (group memberships and teams are not app config: no wait).
normalise_ns() {
    local v key entry def settle=0 core knorke theming apps profile want
    local -a shareapi
    # no word splitting with globbing: the defaults contain "[]"
    read -r -a shareapi <<<"$KD_SHAREAPI_KEYS"
    v="$(occ config:system:get knorke_dev_skip_bump 2>/dev/null || true)"
    if [ -n "$v" ]; then
        case "$v" in
            0|0.0) ;;
            *) warn "knorke_dev_skip_bump = $v lag noch (abgebrochener converge-Lauf?) – gelöscht" ;;
        esac
        occ config:system:delete knorke_dev_skip_bump >/dev/null || die "occ config:system:delete knorke_dev_skip_bump schlug fehl"
    fi
    for key in $KD_HARNESS_SYSTEM_KEYS; do
        v="$(occ config:system:get "$key" 2>/dev/null || true)"
        [ -n "$v" ] || continue
        occ config:system:delete "$key" >/dev/null || die "occ config:system:delete $key schlug fehl"
        warn "System-Schlüssel $key = $v lag noch (abgebrochener C63-Lauf?) – gelöscht (Vorgabe)"
    done
    knorke="$(app_config_values knorke)"
    v="$(config_of "$knorke" public_template)"
    if [ -n "$v" ]; then
        occ config:app:delete knorke public_template >/dev/null || die "occ config:app:delete knorke public_template schlug fehl"
        if [ "$v" != public ]; then
            warn "public_template = $v lag noch (abgebrochener E12- oder Smoke-Lauf?) – gelöscht"
            settle=1
        fi
    fi
    # public_url (C83 sets it briefly; dev stacks never set it, SPEC-M1 §33.1 j): any value goes
    v="$(config_of "$knorke" public_url)"
    if [ -n "$v" ]; then
        occ config:app:delete knorke public_url >/dev/null || die "occ config:app:delete knorke public_url schlug fehl"
        warn "public_url = $v lag noch (abgebrochener C83-Lauf? Dev-Stacks setzen es nie) – gelöscht"
        settle=1
    fi
    # privacy_notice (M2 privacy notice: E43/E44 set it through route 27, C47 needs it unset): any value goes
    v="$(config_of "$knorke" privacy_notice)"
    if [ -n "$v" ]; then
        occ config:app:delete knorke privacy_notice >/dev/null || die "occ config:app:delete knorke privacy_notice schlug fehl"
        warn "privacy_notice lag noch (abgebrochener E43-/E44-Lauf?) – gelöscht"
        settle=1
    fi
    # every key to its baseline: the profile value (dev profile), else not set (SPEC-M1 §33.1 j)
    profile="$(harness_profile)"
    for key in $HARNESS_APP_CONFIG; do
        v="$(config_of "$knorke" "$key")"
        want="$(harness_baseline "$key" "$profile")"
        if [ -n "$want" ]; then
            [ "$v" = "$want" ] && continue
            occ config:app:set knorke "$key" --value="$want" >/dev/null || die "occ config:app:set knorke $key schlug fehl"
            warn "knorke $key = ${v:-(nicht gesetzt)} statt Profilwert $want (Profil $profile; abgebrochener Lauf mit app-config oder Stack von vor P7-C?) – auf $want gesetzt"
            settle=1
            continue
        fi
        [ -n "$v" ] || continue
        occ config:app:delete knorke "$key" >/dev/null || die "occ config:app:delete knorke $key schlug fehl"
        warn "knorke $key = $v lag noch (abgebrochener Lauf mit app-config?) – gelöscht (Vorgabe, Profil $profile)"
        settle=1
    done
    core="$(app_config_values core)"
    for entry in "${shareapi[@]}"; do
        key="${entry%%=*}"
        def="${entry#*=}"
        v="$(config_of "$core" "$key")"
        [ -n "$v" ] || continue
        occ config:app:delete core "$key" >/dev/null || die "occ config:app:delete core $key schlug fehl"
        case "|$def|" in
            *"|$v|"*) ;;
            *)
                warn "core $key = $v lag noch (abgebrochener Richtlinien-Lauf: C45/C46/C60/E16/E30/Smoke?) – gelöscht (Vorgabe $def)"
                settle=1
                ;;
        esac
    done
    theming="$(app_config_values theming)"
    for key in imprintUrl privacyUrl; do
        v="$(config_of "$theming" "$key")"
        case "$v" in
            *knorke-harness*)
                occ config:app:delete theming "$key" >/dev/null || die "occ config:app:delete theming $key schlug fehl"
                warn "theming $key aus einem Testlauf lag noch (abgebrochener C47-/E15-Lauf?) – gelöscht"
                settle=1
                ;;
        esac
    done
    apps="$(occ app:list --output=json 2>/dev/null || true)"
    # jq 1.6 answers -e on EMPTY input with exit 0: every test on occ output checks for output first
    if [ -n "$apps" ] && printf '%s' "$apps" | jq -e '(.disabled // {}) | has("circles")' >/dev/null 2>&1; then
        occ app:enable circles >/dev/null || die "occ app:enable circles schlug fehl"
        warn "App circles war aus (abgebrochener Lauf mit circles off?) – wieder an"
        settle=1
    fi
    normalise_groups
    # an image without Circles has no team to remove (and no circles:* command)
    if [ -n "$apps" ] && printf '%s' "$apps" | jq -e '((.enabled // {}) | has("circles")) or ((.disabled // {}) | has("circles"))' >/dev/null 2>&1; then
        normalise_teams
    fi
    if [ "$settle" = 1 ]; then
        log "4 s für den APCu-Cache der App-Konfiguration"
        sleep 4
    fi
    return 0
}

# harness_users / harness_groups: the harness accounts (env.json .users keys)
# and groups (.groups keys) of this namespace, one per line; empty without
# env.json. up.sh writes both (alice, bob, KD_EXTRA_USERS; knorke-e2e).
harness_users() {
    [ -f "$ENV_JSON" ] || return 0
    jq -r '(.users // {}) | keys[] | select(test("^[a-z][a-z0-9]{1,15}$"))' "$ENV_JSON" 2>/dev/null || true
}
harness_groups() {
    [ -f "$ENV_JSON" ] || return 0
    jq -r '(.groups // {}) | keys[] | select(test("^[a-z][a-z0-9-]{0,31}$"))' "$ENV_JSON" 2>/dev/null || true
}

# normalise_groups: every harness group of env.json .groups exists and holds
# exactly its listed harness accounts again (bridge group-member, SPEC-M1
# §8.1/§8.4). Only harness accounts are added or removed; other members of the
# group stay. Says so for every change.
normalise_groups() {
    local cur g u want have groups users
    groups="$(harness_groups)"
    [ -n "$groups" ] || return 0
    users="$(harness_users)"
    cur="$(occ group:list --output=json 2>/dev/null || true)"
    if [ -z "$cur" ] || ! printf '%s' "$cur" | jq -e 'type == "object"' >/dev/null 2>&1; then
        warn "occ group:list --output=json lieferte kein JSON – Harness-Gruppen nicht geprüft"
        return 0
    fi
    for g in $groups; do
        if ! printf '%s' "$cur" | jq -e --arg g "$g" 'has($g)' >/dev/null; then
            occ group:add "$g" >/dev/null || die "occ group:add $g schlug fehl"
            warn "Gruppe $g fehlte – wieder angelegt"
        fi
        for u in $users; do
            want="$(jq -r --arg g "$g" --arg u "$u" '((.groups[$g] // []) | index($u)) != null' "$ENV_JSON")"
            have="$(printf '%s' "$cur" | jq -r --arg g "$g" --arg u "$u" '((.[$g] // []) | index($u)) != null')"
            if [ "$want" = true ] && [ "$have" != true ]; then
                occ group:adduser "$g" "$u" >/dev/null || die "occ group:adduser $g $u schlug fehl"
                warn "$u fehlte in Gruppe $g (abgebrochener Lauf mit group-member?) – wieder Mitglied"
            elif [ "$want" != true ] && [ "$have" = true ]; then
                occ group:removeuser "$g" "$u" >/dev/null || die "occ group:removeuser $g $u schlug fehl"
                warn "$u war in Gruppe $g (abgebrochener Lauf mit group-member?) – entfernt"
            fi
        done
    done
    return 0
}

# normalise_teams: destroys every team named $KD_HARNESS_TEAM_PREFIX… (bridge
# team-create, SPEC-M1 §8.1/§8.4). Needs Circles on (normalise_ns switches it
# on first). Teams of any other name stay.
normalise_teams() {
    local list id
    list="$(occ circles:manage:list --output=json 2>/dev/null || true)"
    if [ -z "$list" ] || ! printf '%s' "$list" | jq -e 'type == "array"' >/dev/null 2>&1; then
        warn "occ circles:manage:list --output=json lieferte keine Liste – Harness-Teams nicht geprüft"
        return 0
    fi
    for id in $(printf '%s' "$list" | jq -r --arg p "$KD_HARNESS_TEAM_PREFIX" '.[] | select(((.name // "") | startswith($p)) and ((.id // "") | test("^[A-Za-z0-9]{31}$"))) | .id'); do
        occ circles:manage:destroy "$id" >/dev/null || die "occ circles:manage:destroy $id schlug fehl"
        warn "Team $id ($(printf '%s' "$list" | jq -r --arg i "$id" '.[] | select(.id == $i) | .name')) aus einem Testlauf lag noch – gelöscht"
    done
    return 0
}
