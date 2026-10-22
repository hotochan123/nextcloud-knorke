#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Starts the throwaway dev stack of ONE namespace (SPEC-M0 §8.1):
#   database (KD_DB: postgres:17-alpine with pg_stat_statements, mariadb:11.8,
#   mysql:8.4, or SQLite inside Nextcloud) + redis:7-alpine (requirepass) +
#   Nextcloud (${KD_NC_IMAGE:-nextcloud:34-apache}, mod_php like prod),
#   memcache.local APCu, memcache.distributed + locking Redis (set by the
#   image from REDIS_HOST/REDIS_HOST_PASSWORD). Accounts alice ("Alice
#   Adler"), bob ("Bob Berg") and the extra accounts of KD_EXTRA_USERS
#   (default carol, "Carol Clausen"); group knorke-e2e with bob and the extra
#   accounts (SPEC-M1 §8.1; shares to groups from stage 2 on).
#
# Networks (round 2 U1): database and Redis sit ONLY on knorke-dev-$NS-back,
# created with --internal (no route out, no NAT, Docker drops traffic routed
# in from outside the bridge). Nextcloud joins it and the front network
# knorke-dev-$NS-net, which publishes 127.0.0.1:$PORT and carries the E2E
# browser. Redis requires a generated password (env.json .redis.pass); its
# container has it as REDISCLI_AUTH, so `docker exec … redis-cli` just works.
#
# The app is bind-mounted READ-ONLY into custom_apps/knorke (NOT apps/: the
# entrypoint's rsync --delete would wipe it). Only Nextcloud publishes a port,
# and only on 127.0.0.1. Credentials and env.json go to dev/.state/$NS/
# (mode 700) and die with dev/down.sh. env.json is written last, so its
# existence means: the stack came up and the 401 probe was green.
#
# Refusals (exit 2, SPEC-M1 §0, §8.1), before anything is created:
#   - a protected namespace (KD_PROTECT_NS, default try) without KD_FORCE=1
#     (dev/lib.sh, while it is sourced)
#   - KD_PORT=18590 (the user's try stack) for every namespace except try, and
#     the non-Nextcloud ports 18601 (Traefik of the load run), 18612 (tablet
#     session server R-A, app relay R-B) and 18613 (session server R-B)
#   - the stack cap: under the exclusive lock $KD_LOCK_DIR/stacks.lock (default
#     claude_projects/.knorke-dev/, outside every repo copy) up.sh counts the
#     networks with a label key knorke* and creates its two networks only if
#     count + 2 <= 2·KD_MAX_STACKS + 1; Docker's "fully subnetted" becomes a
#     clear message (networks of other projects fill the pools, too)
#
# Usage:  KD_NS=d dev/up.sh                          (≈ 2–3 min)
# Knobs:  KD_NS (main) · KD_PORT (default per namespace, dev/lib.sh default_port:
#         main 18580, b 18581, c 18582, d 18583, br 18584, rm rs rx ry 18591–18594,
#         dm dy dq dl 18595–18598, load 18599, nf 18600, ipad 18611)
#         KD_MAX_STACKS (5) · KD_LOCK_DIR (claude_projects/.knorke-dev) ·
#         KD_LOCK_WAIT (120 s for the stack lock)
#         KD_NC_IMAGE (nextcloud:34-apache; NC 35: nextcloud:35.0.1-apache)
#         KD_DB (pgsql | mariadb | mysql | sqlite) · KD_DB_IMAGE (postgres:17-alpine,
#         mariadb:11.8, mysql:8.4) · KD_MYSQL_UTF8MB4=0 (mariadb/mysql only:
#         mysql.utf8mb4 = false before app:enable, so the knorke tables are
#         utf8mb3 and the connection charset is utf8 – a legacy install without
#         4-byte support, review finding NC-3)
#         KD_NC_CPUS (4; 0 = no cap) · KD_APP_DIR ($ROOT; relative paths are
#         relative to $ROOT, e.g. dev/selftest/placeholder)
#         KD_SKIP_BUILD_CHECK=1 (start without js/knorke-main.mjs)
#         KD_DNS (empty = Docker default; a host value from the environment or
#         dev/local.env, dev/lib.sh): --dns for the Nextcloud container. A LAN
#         Pi-hole can be slow from containers (NAT hairpin, ~4 s per lookup),
#         the router is not (ENTWICKLUNG trap 9.9).
#         KD_EXTRA_USERS ("carol"; blank-separated uids ^[a-z][a-z0-9]{1,15}$, empty =
#         none): more accounts with the same password, all in group knorke-e2e
#         KD_PROD_APPS=1: mount production's extra apps READ-ONLY and enable
#         them, like the poll spike (load runs, M1). KD_PROD_APP_LIST overrides
#         the list (paths below nextcloud_html/). Nothing of prod is started,
#         exec'd or written. Needs KD_PROD_STACK_DIR (environment or
#         dev/local.env, dev/lib.sh); without it exit 1 before any docker call.
# Load-run switches (SPEC-M1 §8.1 R2, §8.7; stage 4). Unset, none of them
# changes anything: a stack without them starts exactly as before (same
# containers, same occ steps, same env.json). With any of them env.json gets
# .load {profile, apacheStatus, statusUrl, users, group, pgCpus, genCpuset,
# prodApps, variant: "base"} (dev/load/variant.sh switches .load.variant).
#         KD_LOAD_PROFILE ("" | prod): prod = firstrunwizard stays on and
#         knorke_dev = false after the setup (the prod code path, no debug or
#         skip-bump hooks; SF switches knorke_dev on for its window only)
#         KD_APACHE_STATUS (0 | 1): 1 = mod_status on port 8081 inside the
#         container (dev/load/knorke-status.conf, read-only mount), NEVER
#         published – the collector reaches it through the container IP on the
#         front network (env.json .load.statusUrl)
#         KD_USERS (0–99, default 0): load accounts load01 … loadNN (display
#         name "Load NN", password = env.json .userPass, language en) in the
#         group workshop (display name "Workshop"), the editors of the load run
#         KD_PG_CPUS (cpuset list, --cpuset-cpus of the PostgreSQL container;
#         default 0-3 in the namespace load with KD_DB=pgsql, else unset = no
#         pinning; empty = no pinning). NC keeps KD_NC_CPUS.
#         KD_GEN_CPUSET (cpuset list; default 4-7 in the namespace load, else
#         unset): only validated (no overlap with KD_PG_CPUS) and recorded in
#         env.json .load.genCpuset – dev/load/run.sh pins the generator with it
# iPad switch (SPEC-M1 §8.8 (2), Revision 19 T4-13; the R-B session after
# stage 4). Unset (or 0), nothing changes.
#         KD_IPAD_PROFILE (0 | 1, only with KD_NS=ipad): knorke_dev = false
#         after the setup (no debug hooks, no bridge – like KD_LOAD_PROFILE=prod)
#         and trusted_domains also KD_LAN_HOST, this host's LAN address
#         (environment or dev/local.env, dev/lib.sh; without it exit 1 before
#         any docker call) that dev/ipad/relay.mjs forwards to 127.0.0.1:18611
#         during the session; env.json .ipad {profile, lanHost, relayPort}. The
#         account passwords are random per stack anyway (env.json .userPass)
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DB_KIND="${KD_DB:-pgsql}"
valid_db_kind "$DB_KIND" || die "KD_DB='$DB_KIND' ist ungültig (erlaubt: $DB_KINDS)"
UTF8MB4="${KD_MYSQL_UTF8MB4:-1}"
case "$UTF8MB4" in
    1) ;;
    0) case "$DB_KIND" in mariadb|mysql) ;; *) die "KD_MYSQL_UTF8MB4=0 gilt nur für KD_DB=mariadb|mysql (hier $DB_KIND)" ;; esac ;;
    *) die "KD_MYSQL_UTF8MB4='$UTF8MB4' ist ungültig (0 oder 1)" ;;
esac
case "$DB_KIND" in
    pgsql) DB_IMAGE="${KD_DB_IMAGE:-postgres:17-alpine}" ;;
    mariadb) DB_IMAGE="${KD_DB_IMAGE:-mariadb:11.8}" ;;
    mysql) DB_IMAGE="${KD_DB_IMAGE:-mysql:8.4}" ;;
    sqlite) [ -z "${KD_DB_IMAGE:-}" ] || die "KD_DB_IMAGE passt nicht zu KD_DB=sqlite (kein DB-Container)"; DB_IMAGE="" ;;
esac
PORT="${KD_PORT:-$(default_port "$NS")}"
[ -n "$PORT" ] || die "Namensraum '$NS' hat keinen Vorgabe-Port – KD_PORT setzen"
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "KD_PORT='$PORT' ist ungültig"
if [ "$PORT" = "$KD_TRY_PORT" ] && [ "$NS" != try ]; then
    refuse "KD_PORT=$PORT gehört dem Nutzer-Stack try – für '$NS' einen anderen Port wählen (Tabelle: dev/lib.sh default_port)"
fi
case " $KD_NON_NC_PORTS " in
    *" $PORT "*) refuse "KD_PORT=$PORT ist reserviert (18601 Traefik des Lastlaufs, 18612 Sitzungsserver R-A bzw. App-Relais R-B, 18613 Sitzungsserver R-B) – kein Nextcloud-Port" ;;
esac
[[ "$KD_MAX_STACKS" =~ ^[0-9]{1,2}$ ]] && [ "$KD_MAX_STACKS" -ge 1 ] || die "KD_MAX_STACKS='$KD_MAX_STACKS' ist ungültig (1–99)"
LOCK_WAIT="${KD_LOCK_WAIT:-120}"
[[ "$LOCK_WAIT" =~ ^[0-9]{1,4}$ ]] || die "KD_LOCK_WAIT='$LOCK_WAIT' ist ungültig (Sekunden)"
NC_IMAGE="${KD_NC_IMAGE:-nextcloud:34-apache}"
NC_CPUS="${KD_NC_CPUS:-4}"
[[ "$NC_CPUS" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "KD_NC_CPUS='$NC_CPUS' ist ungültig"
# KD_DNS: from dev/lib.sh (environment, dev/local.env); empty = Docker's default.
DNS="${KD_DNS:-}"
PROD_APPS="${KD_PROD_APPS:-0}"
if [ "$PROD_APPS" = "1" ] && [ -z "$PROD_STACK_DIR" ]; then
    die "KD_PROD_APPS=1 braucht KD_PROD_STACK_DIR (Pfad des Prod-Stacks; Umgebung oder dev/local.env, ENTWICKLUNG §3.10)"
fi
PROD_HTML="$PROD_STACK_DIR/nextcloud_html"
PROD_APP_LIST="${KD_PROD_APP_LIST:-custom_apps/spreed custom_apps/richdocuments custom_apps/user_oidc custom_apps/polls custom_apps/admincockpit custom_apps/folder_retention custom_apps/pulse custom_apps/secretvote}"
# Extra accounts (SPEC-M1 §8.1): "-" keeps an explicitly empty value (no extra account).
EXTRA_USERS="${KD_EXTRA_USERS-carol}"
for u in $EXTRA_USERS; do
    [[ "$u" =~ ^[a-z][a-z0-9]{1,15}$ ]] || die "KD_EXTRA_USERS: '$u' ist keine gültige uid (^[a-z][a-z0-9]{1,15}\$)"
    case "$u" in alice|bob|admin) die "KD_EXTRA_USERS: '$u' gibt es schon" ;; esac
done
E2E_GROUP="knorke-e2e"

# --- load-run switches (SPEC-M1 §8.1 R2, §8.7; stage 4), checked before anything else
LOAD_PROFILE="${KD_LOAD_PROFILE:-}"
case "$LOAD_PROFILE" in
    ""|prod) ;;
    *) die "KD_LOAD_PROFILE='$LOAD_PROFILE' ist ungültig (leer oder prod)" ;;
esac
APACHE_STATUS="${KD_APACHE_STATUS:-0}"
case "$APACHE_STATUS" in
    0|1) ;;
    *) die "KD_APACHE_STATUS='$APACHE_STATUS' ist ungültig (0 oder 1)" ;;
esac
STATUS_CONF="$DEV/load/knorke-status.conf"
[ "$APACHE_STATUS" = 0 ] || [ -f "$STATUS_CONF" ] || die "$STATUS_CONF fehlt (KD_APACHE_STATUS=1)"
LOAD_USERS="${KD_USERS:-0}"
[[ "$LOAD_USERS" =~ ^[0-9]{1,2}$ ]] || die "KD_USERS='$LOAD_USERS' ist ungültig (0–99 Lastkonten load01 … load99)"
LOAD_USERS=$((10#$LOAD_USERS))
LOAD_GROUP="workshop"
# CPU sets: the defaults of §8.1 (PG 0-3, generator 4-7) hold in the namespace
# load only; elsewhere unset means no pinning, so no wave stack gets pinned.
# An explicitly empty value turns pinning off.
if [ "$NS" = load ]; then
    PG_CPUS="${KD_PG_CPUS-0-3}"
    GEN_CPUSET="${KD_GEN_CPUSET-4-7}"
else
    PG_CPUS="${KD_PG_CPUS:-}"
    GEN_CPUSET="${KD_GEN_CPUSET:-}"
fi
valid_cpuset "$PG_CPUS" || die "KD_PG_CPUS='$PG_CPUS' ist ungültig (cpuset-Liste mit CPUs dieses Hosts, z. B. 0-3)"
valid_cpuset "$GEN_CPUSET" || die "KD_GEN_CPUSET='$GEN_CPUSET' ist ungültig (cpuset-Liste mit CPUs dieses Hosts, z. B. 4-7)"
if [ -n "$PG_CPUS" ] && [ "$DB_KIND" != pgsql ]; then
    [ -z "${KD_PG_CPUS:-}" ] || die "KD_PG_CPUS gilt nur für KD_DB=pgsql (hier $DB_KIND)"
    PG_CPUS=""
fi
if cpusets_overlap "$PG_CPUS" "$GEN_CPUSET"; then
    die "KD_PG_CPUS ($PG_CPUS) und KD_GEN_CPUSET ($GEN_CPUSET) überschneiden sich"
fi
LOAD_ACTIVE=0
if [ -n "$LOAD_PROFILE" ] || [ "$APACHE_STATUS" = 1 ] || [ "$LOAD_USERS" -gt 0 ] || [ -n "$PG_CPUS" ] || [ -n "$GEN_CPUSET" ]; then
    LOAD_ACTIVE=1
fi
# --- iPad switch (SPEC-M1 §8.8 (2) R19, T4-13), checked before anything else
IPAD_PROFILE="${KD_IPAD_PROFILE:-}"
case "$IPAD_PROFILE" in
    ""|0) IPAD_PROFILE="" ;;
    1) [ "$NS" = ipad ] || die "KD_IPAD_PROFILE=1 gilt nur für KD_NS=ipad (hier $NS)" ;;
    *) die "KD_IPAD_PROFILE='$IPAD_PROFILE' ist ungültig (leer, 0 oder 1)" ;;
esac
# This host's LAN address (KD_LAN_HOST from dev/lib.sh, already checked
# there: a private IPv4 host address).
IPAD_LAN="${KD_LAN_HOST:-}"
if [ "$IPAD_PROFILE" = 1 ] && [ -z "$IPAD_LAN" ]; then
    die "KD_IPAD_PROFILE=1 braucht KD_LAN_HOST (die LAN-Adresse dieses Hosts für das Relais; Umgebung oder dev/local.env, ENTWICKLUNG §3.10)"
fi
IPAD_RELAY_PORT=18612
IPAD_TRUSTED_INDEX=9
# display_name UID: the display name of an extra account (carol: "Carol Clausen", else the uid capitalised).
display_name() {
    case "$1" in
        carol) printf '%s\n' "Carol Clausen" ;;
        *) printf '%s\n' "$(printf '%s' "${1:0:1}" | tr '[:lower:]' '[:upper:]')${1:1}" ;;
    esac
}

# --- 1. refuse ----------------------------------------------------------------
APP_DIR_IN="${KD_APP_DIR:-$ROOT}"
case "$APP_DIR_IN" in
    /*) ;;
    *) APP_DIR_IN="$ROOT/$APP_DIR_IN" ;;
esac
in_prod_stack "$APP_DIR_IN" && die "KD_APP_DIR liegt im Prod-Stack ($APP_DIR_IN) – verweigert"
[ -d "$APP_DIR_IN" ] || die "KD_APP_DIR '$APP_DIR_IN' existiert nicht"
APP_DIR="$(cd "$APP_DIR_IN" && pwd -P)"
in_prod_stack "$APP_DIR" && die "KD_APP_DIR liegt im Prod-Stack ($APP_DIR) – verweigert"
grep -q '<id>knorke</id>' "$APP_DIR/appinfo/info.xml" 2>/dev/null || die "$APP_DIR/appinfo/info.xml fehlt oder hat nicht <id>knorke</id>"
IS_PLACEHOLDER=0
[ "$APP_DIR" = "$PLACEHOLDER_DIR" ] && IS_PLACEHOLDER=1
if [ "$IS_PLACEHOLDER" = 0 ] && [ "${KD_SKIP_BUILD_CHECK:-0}" != "1" ] && [ ! -f "$APP_DIR/js/knorke-main.mjs" ]; then
    die "$APP_DIR/js/knorke-main.mjs fehlt – erst dev/build.sh (oder KD_SKIP_BUILD_CHECK=1)"
fi
for n in "$NET" "$BACK"; do
    network_exists "$n" && die "Netz $n existiert schon – erst KD_NS=$NS dev/down.sh"
done
for c in "$DB" "$REDIS" "$NC"; do
    container_exists "$c" && die "Container $c existiert schon – erst KD_NS=$NS dev/down.sh"
done
LEFT="$(docker ps -aq --filter "label=$LABEL" 2>/dev/null || true)"
[ -z "$LEFT" ] && [ -z "$(docker network ls -q --filter "label=$LABEL" 2>/dev/null || true)" ] \
    || die "Reste mit Label $LABEL vorhanden – erst KD_NS=$NS dev/down.sh"

PROD_MOUNTS=()
PROD_IDS=()
if [ "$PROD_APPS" = "1" ]; then
    for src in $PROD_APP_LIST; do
        [[ "$src" =~ ^(custom_apps|apps)/[a-z0-9_]+$ ]] || die "KD_PROD_APP_LIST: '$src' ist kein App-Pfad"
        id="${src#*/}"
        [ "$id" = "knorke" ] && die "KD_PROD_APP_LIST darf knorke nicht enthalten"
        [ -f "$PROD_HTML/$src/appinfo/info.xml" ] || die "$PROD_HTML/$src fehlt"
        PROD_MOUNTS+=(-v "$PROD_HTML/$src:/var/www/html/custom_apps/$id:ro")
        # pulse/dev holds a screenshot credential file: hide it behind a tmpfs.
        if [ "$id" = "pulse" ] && [ -d "$PROD_HTML/$src/dev" ]; then
            PROD_MOUNTS+=(--mount "type=tmpfs,destination=/var/www/html/custom_apps/pulse/dev")
        fi
        PROD_IDS+=("$id")
    done
fi

# --- 1b. stack cap + networks, under the shared lock (SPEC-M1 §0, §8.1) -------
# Counting and creating happen under ONE exclusive lock outside every repo copy,
# so two up.sh (also one in $ROOT and one in $WORK) never both take the last
# slot. Every refusal here leaves nothing behind (no network, no state).
NET_LIMIT=$((2 * KD_MAX_STACKS + 1))
STACKS_LOCK="$KD_LOCK_DIR/stacks.lock"
mkdir -p "$KD_LOCK_DIR" || die "Sperrverzeichnis $KD_LOCK_DIR lässt sich nicht anlegen (KD_LOCK_DIR)"
exec 7>>"$STACKS_LOCK" || die "Sperrdatei $STACKS_LOCK lässt sich nicht öffnen"
if ! flock -x -n 7; then
    log "warte auf die Stack-Sperre $STACKS_LOCK (ein anderes up.sh zählt gerade Netze)"
    flock -x -w "$LOCK_WAIT" 7 || refuse "die Stack-Sperre $STACKS_LOCK ist nach ${LOCK_WAIT} s noch belegt – später erneut (KD_LOCK_WAIT)"
fi
KNORKE_NETS="$(knorke_networks)" || die "docker network ls schlug fehl – der Stack-Deckel ist nicht prüfbar"
NET_COUNT="$(printf '%s\n' "$KNORKE_NETS" | grep -c . || true)"
if [ $((NET_COUNT + 2)) -gt "$NET_LIMIT" ]; then
    refuse "Stack-Deckel: $NET_COUNT Knorke-Netze belegt, ein Stack braucht 2, erlaubt sind $NET_LIMIT (KD_MAX_STACKS=$KD_MAX_STACKS Stacks zu je 2 Netzen neben try). Erst einen eigenen Stack abbauen (KD_NS=<ns> dev/down.sh). Belegt: $(printf '%s\n' "$KNORKE_NETS" | tr '\n' ' ')"
fi

# create_networks: front + internal network; if the second fails, the first goes
# again. The error text of docker ends up in NET_ERR.
NET_ERR=""
create_networks() {
    assert_own "$NET"
    assert_own "$BACK"
    NET_ERR="$(docker network create --label "$LABEL" "$NET" 2>&1 >/dev/null)" || return 1
    if ! NET_ERR="$(docker network create --internal --label "$LABEL" "$BACK" 2>&1 >/dev/null)"; then
        docker network rm "$NET" >/dev/null 2>&1 || warn "$NET ließ sich nicht wieder entfernen – KD_NS=$NS dev/down.sh"
        return 1
    fi
}
log "Netze (vorn + intern): $NET_COUNT von $NET_LIMIT Knorke-Netzen belegt, +2"
if ! create_networks; then
    case "$NET_ERR" in
        *"fully subnetted"*|*"non-overlapping"*)
            refuse "Docker hat keine freien Adress-Pools mehr ($(printf '%s' "$NET_ERR" | head -n 1)). Knorke belegt $NET_COUNT von $NET_LIMIT Netzen (Deckel KD_MAX_STACKS=$KD_MAX_STACKS neben try); auch Netze anderer Projekte füllen die Pools ($(docker network ls -q 2>/dev/null | grep -c . || true) Netze insgesamt, docker network ls). Einen eigenen Stack abbauen (KD_NS=<ns> dev/down.sh); größere Pools sind eine Daemon-Einstellung des Nutzers."
            ;;
        *) die "docker network create schlug fehl: $NET_ERR" ;;
    esac
fi
exec 7>&-

on_exit() {
    local rc=$?
    if [ "$rc" -ne 0 ]; then
        printf '[up %s] abgebrochen (Exit %s). Reste ansehen: docker logs %s; aufräumen: KD_NS=%s dev/down.sh\n' \
            "$NS" "$rc" "$NC" "$NS" >&2
    fi
}
trap on_exit EXIT
[ "$(docker network inspect -f '{{.Internal}}' "$BACK")" = true ] || die "$BACK ist nicht --internal"

# --- 2. state -----------------------------------------------------------------
umask 077
state_dir >/dev/null
rm -f "${STATE:?}/env.json"

# --- 3. secrets ---------------------------------------------------------------
DB_PASS="$(rnd 24)"
ADMIN_PASS="$(rnd 24)"
USER_PASS="$(rnd 24)"
REDIS_PASS="$(rnd 32)"

# --- 4. containers ------------------------------------------------------------
DB_DESC="$DB_KIND"
[ -n "$DB_IMAGE" ] && DB_DESC="$DB_DESC ($DB_IMAGE)"
[ "$UTF8MB4" = 0 ] && DB_DESC="$DB_DESC, utf8mb4 aus"
log "Image $NC_IMAGE, App $APP_DIR$([ "$IS_PLACEHOLDER" = 1 ] && echo ' (Platzhalter)'), DB $DB_DESC, Port 127.0.0.1:$PORT, CPU-Deckel $NC_CPUS"
log "Datenbank, Redis mit Passwort"

# db_ping: the real server answers over TCP (the init servers of the mariadb
# and mysql images listen on the socket only, so a socket ping is too early).
db_ping() {
    case "$DB_KIND" in
        pgsql) docker exec "$DB" pg_isready -h 127.0.0.1 -U nextcloud -d nextcloud ;;
        mariadb) docker exec "$DB" sh -c 'MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb -h 127.0.0.1 -u "$MARIADB_USER" -N -B -e "SELECT 1" "$MARIADB_DATABASE"' ;;
        mysql) docker exec "$DB" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -h 127.0.0.1 -u "$MYSQL_USER" -N -B -e "SELECT 1" "$MYSQL_DATABASE"' ;;
    esac
}

DB_LABELS=(--label "$LABEL")
PG_CPU_ARGS=()
[ -n "$PG_CPUS" ] && PG_CPU_ARGS=(--cpuset-cpus "$PG_CPUS")
case "$DB_KIND" in
    pgsql)
        POSTGRES_PASSWORD="$DB_PASS" docker run -d --name "$DB" --network "$BACK" "${DB_LABELS[@]}" ${PG_CPU_ARGS[@]+"${PG_CPU_ARGS[@]}"} \
            -e POSTGRES_DB=nextcloud -e POSTGRES_USER=nextcloud -e POSTGRES_PASSWORD \
            "$DB_IMAGE" \
            postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=top >/dev/null
        ;;
    mariadb)
        # READ-COMMITTED as the Nextcloud admin manual demands for MySQL/MariaDB.
        MARIADB_PASSWORD="$DB_PASS" docker run -d --name "$DB" --network "$BACK" "${DB_LABELS[@]}" \
            -e MARIADB_DATABASE=nextcloud -e MARIADB_USER=nextcloud -e MARIADB_PASSWORD -e MARIADB_RANDOM_ROOT_PASSWORD=1 \
            "$DB_IMAGE" --transaction-isolation=READ-COMMITTED >/dev/null
        ;;
    mysql)
        MYSQL_PASSWORD="$DB_PASS" docker run -d --name "$DB" --network "$BACK" "${DB_LABELS[@]}" \
            -e MYSQL_DATABASE=nextcloud -e MYSQL_USER=nextcloud -e MYSQL_PASSWORD -e MYSQL_RANDOM_ROOT_PASSWORD=yes \
            "$DB_IMAGE" --transaction-isolation=READ-COMMITTED >/dev/null
        ;;
    sqlite) ;;
esac
# The password reaches redis-server through the container env, never through
# docker's Cmd; redis-cli in the same container reads REDISCLI_AUTH by itself.
REDISCLI_AUTH="$REDIS_PASS" docker run -d --name "$REDIS" --network "$BACK" --label "$LABEL" -e REDISCLI_AUTH \
    redis:7-alpine sh -c 'exec docker-entrypoint.sh redis-server --requirepass "$REDISCLI_AUTH"' >/dev/null

if [ "$DB_KIND" != sqlite ]; then
    ok=0
    for _ in $(seq 1 120); do
        if db_ping >/dev/null 2>&1; then ok=1; break; fi
        container_running "$DB" || { docker logs --tail 30 "$DB" >&2 || true; die "$DB läuft nicht mehr"; }
        sleep 1
    done
    [ "$ok" = 1 ] || { docker logs --tail 30 "$DB" >&2 || true; die "Datenbank ($DB_KIND) kommt in 120 s nicht hoch"; }
fi

CPU_ARGS=()
[ "$NC_CPUS" != "0" ] && CPU_ARGS=(--cpus "$NC_CPUS")
DNS_ARGS=()
[ -n "$DNS" ] && DNS_ARGS=(--dns "$DNS")
# KD_APACHE_STATUS=1: mod_status on :8081 inside the container, never published (no -p for it)
STATUS_ARGS=()
[ "$APACHE_STATUS" = 1 ] && STATUS_ARGS=(-v "$STATUS_CONF:/etc/apache2/conf-enabled/knorke-status.conf:ro")

case "$DB_KIND" in
    pgsql) DB_ENV=(-e POSTGRES_HOST="$DB" -e POSTGRES_DB=nextcloud -e POSTGRES_USER=nextcloud -e POSTGRES_PASSWORD) ;;
    mariadb|mysql) DB_ENV=(-e MYSQL_HOST="$DB" -e MYSQL_DATABASE=nextcloud -e MYSQL_USER=nextcloud -e MYSQL_PASSWORD) ;;
    sqlite) DB_ENV=(-e SQLITE_DATABASE=nextcloud) ;;
esac

log "Nextcloud – die Installation läuft im Entrypoint"
# created on the front network, joined to the internal one, then started: the
# entrypoint installs right away and needs the database from the first second.
POSTGRES_PASSWORD="$DB_PASS" MYSQL_PASSWORD="$DB_PASS" NEXTCLOUD_ADMIN_PASSWORD="$ADMIN_PASS" REDIS_HOST_PASSWORD="$REDIS_PASS" \
docker create --name "$NC" --network "$NET" --label "$LABEL" --label "knorke.db=$DB_KIND" \
    ${CPU_ARGS[@]+"${CPU_ARGS[@]}"} ${DNS_ARGS[@]+"${DNS_ARGS[@]}"} \
    -p "127.0.0.1:$PORT:80" \
    "${DB_ENV[@]}" \
    -e REDIS_HOST="$REDIS" -e REDIS_HOST_PORT=6379 -e REDIS_HOST_PASSWORD \
    -e NEXTCLOUD_ADMIN_USER=admin -e NEXTCLOUD_ADMIN_PASSWORD \
    -e NEXTCLOUD_TRUSTED_DOMAINS="localhost $NC" \
    -e PHP_MEMORY_LIMIT=1024M \
    -v "$APP_DIR:/var/www/html/custom_apps/knorke:ro" \
    -v "$ROOT/dev/php/zz-knorke-dev.ini:/usr/local/etc/php/conf.d/zz-knorke-dev.ini:ro" \
    ${PROD_MOUNTS[@]+"${PROD_MOUNTS[@]}"} \
    ${STATUS_ARGS[@]+"${STATUS_ARGS[@]}"} \
    "$NC_IMAGE" >/dev/null
docker network connect "$BACK" "$NC"
docker start "$NC" >/dev/null

wait_nc "$PORT" 240
log "installiert: $(curl -s -m 5 -H 'Host: localhost' "http://127.0.0.1:$PORT/status.php")"

# --- 5. occ -------------------------------------------------------------------
log "Konfiguration: kein Internet, kein App-Store, Cron, keine Skeleton-Dateien, knorke_dev"
occ config:system:set has_internet_connection --value=false --type=boolean >/dev/null
occ config:system:set appstoreenabled --value=false --type=boolean >/dev/null
occ background:cron >/dev/null
occ config:system:set skeletondirectory --value='' >/dev/null
occ config:system:set templatedirectory --value='' >/dev/null
occ config:system:set knorke_dev --value=true --type=boolean >/dev/null
if [ "$LOAD_PROFILE" = prod ]; then
    log "firstrunwizard bleibt an (KD_LOAD_PROFILE=prod, SPEC-M1 §8.7)"
else
    occ app:disable firstrunwizard >/dev/null 2>&1 || warn "app:disable firstrunwizard schlug fehl (App fehlt?)"
fi
if [ "$UTF8MB4" = 0 ]; then
    # Before the app's migration: its tables get utf8mb3, and every connection
    # from now on uses charset utf8 (IDBConnection::supports4ByteText() = false).
    log "mysql.utf8mb4 = false (Altinstallation ohne 4-Byte-UTF-8)"
    occ config:system:set mysql.utf8mb4 --value=false --type=boolean >/dev/null
    # The installer detected 4-byte support: every core table is utf8mb4, and
    # the admin's example contact already has a birthday event titled "🎂 …".
    # A real legacy install has utf8mb3 core tables and no 4-byte text. Left
    # mixed, every later `occ upgrade` / `occ maintenance:repair` fails in the
    # core step "Repair MySQL collation" (SQLSTATE 1366 on
    # oc_calendarobjects_props, the step stops half-way) and in steps that
    # compare utf8mb4 columns with the utf8 connection (1253) – seen in wave W2
    # (dev/selftest/upgrade.sh --db mariadb-utf8mb3). So: rewrite the birthday
    # calendars in their 3-byte form (no emoji without utf8mb4), then let
    # Nextcloud's own repair convert the core tables.
    log "Kern-Tabellen auf utf8mb3 (dav:sync-birthday-calendar, maintenance:repair)"
    occ dav:sync-birthday-calendar >/dev/null 2>&1 || die "occ dav:sync-birthday-calendar schlug fehl"
    if ! REPAIR_OUT="$(occ maintenance:repair 2>&1)"; then
        printf '%s\n' "$REPAIR_OUT" | tail -n 20 >&2
        die "occ maintenance:repair schlug fehl"
    fi
    if grep -q 'ERROR:' <<<"$REPAIR_OUT"; then
        grep 'ERROR:' <<<"$REPAIR_OUT" >&2
        die "occ maintenance:repair meldet Fehler – die Altinstallation ohne 4-Byte-UTF-8 ist nicht sauber"
    fi
fi

log "occ app:enable knorke"
if ! ENABLE_OUT="$(occ app:enable knorke 2>&1)"; then
    printf '%s\n' "$ENABLE_OUT" >&2
    docker exec "$NC" sh -c 'tail -n 5 /var/www/html/data/nextcloud.log 2>/dev/null' >&2 || true
    die "occ app:enable knorke schlug fehl"
fi
printf '%s\n' "$ENABLE_OUT" | sed 's/^/    /' >&2
occ config:app:set knorke create_limit --value=1000 >/dev/null
# Profile values (SPEC-M1 §33.1 j, ED-22): the dev profile turns both daily
# byte quotas off and the link throttle up (HARNESS_APP_PROFILE, dev/lib.sh);
# the prod profile (KD_LOAD_PROFILE=prod) and the iPad profile set nothing and
# keep the app's defaults. normalise_ns derives the same profile from env.json
# (harness_profile) and keeps these values (harness_baseline).
if [ "$LOAD_PROFILE" != prod ] && [ "$IPAD_PROFILE" != 1 ]; then
    log "Dev-Profil: knorke $HARNESS_APP_PROFILE (SPEC-M1 §33.1 j)"
    for kv in $HARNESS_APP_PROFILE; do
        occ config:app:set knorke "${kv%%=*}" --value="${kv#*=}" >/dev/null || die "occ config:app:set knorke ${kv%%=*} schlug fehl"
    done
else
    log "Profil ${LOAD_PROFILE:-ipad}: keine Profilwerte, es gelten die Vorgaben der App (SPEC-M1 §33.1 j)"
fi

if [ "${#PROD_IDS[@]}" -gt 0 ]; then
    log "Prod-App-Satz aktivieren (read-only gemountet): ${PROD_IDS[*]}"
    for id in "${PROD_IDS[@]}"; do
        occ app:enable "$id" >/dev/null || die "occ app:enable $id schlug fehl"
    done
    # Prod logs in through user_oidc with one provider. A dummy provider gives
    # the app the same provider row; nothing ever contacts it.
    if printf '%s\n' "${PROD_IDS[@]}" | grep -qx user_oidc; then
        occ user_oidc:provider Authentik --clientid=knorke-dev --clientsecret=knorke-dev \
            --discoveryuri=http://127.0.0.1:9/application/o/nextcloud/.well-known/openid-configuration >/dev/null \
            || die "user_oidc-Provider anlegen schlug fehl"
    fi
fi

# --- 6. postgres extension, table charset, memcache ---------------------------
if [ "$DB_KIND" = pgsql ]; then
    docker exec "$DB" psql -U nextcloud -d nextcloud -qc 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements' >/dev/null
fi
TABLE_CHARSET=""
if [ "$IS_PLACEHOLDER" = 0 ] && { [ "$DB_KIND" = mariadb ] || [ "$DB_KIND" = mysql ]; }; then
    TABLE_COLLATION="$(printf '%s\n' "SELECT table_collation FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'oc_knorke_items';" | db_sql)" \
        || die "Zeichensatz von oc_knorke_items nicht lesbar"
    TABLE_CHARSET="${TABLE_COLLATION%%_*}"
    [ "$TABLE_CHARSET" = utf8 ] && TABLE_CHARSET=utf8mb3
    want=utf8mb4
    [ "$UTF8MB4" = 0 ] && want=utf8mb3
    [ "$TABLE_CHARSET" = "$want" ] || die "oc_knorke_items hat Zeichensatz '$TABLE_CHARSET', erwartet $want"
    log "oc_knorke_items: Zeichensatz $TABLE_CHARSET ($TABLE_COLLATION)"
fi
if [ "$UTF8MB4" = 0 ]; then
    # every table of the instance, not only Knorke's (legacy install, see above)
    MIXED="$(printf '%s\n' "SELECT CONCAT(table_name, ':', table_collation) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_collation NOT LIKE 'utf8mb3%' ORDER BY table_name;" | db_sql)" \
        || die "Zeichensätze der Tabellen nicht lesbar"
    [ -z "$MIXED" ] || die "Tabellen ohne utf8mb3 trotz KD_MYSQL_UTF8MB4=0: $(printf '%s' "$MIXED" | tr '\n' ' ')"
    log "alle Tabellen utf8mb3 (Altinstallation)"
fi
MC_DIST="$(occ config:system:get memcache.distributed 2>/dev/null || true)"
case "$MC_DIST" in
    *Redis*) log "memcache.distributed = $MC_DIST" ;;
    *) die "memcache.distributed ist nicht Redis ('$MC_DIST')" ;;
esac
[ -n "$(occ config:system:get redis password 2>/dev/null || true)" ] || die "Nextcloud kennt das Redis-Passwort nicht (redis.password leer)"

# --- 7. accounts --------------------------------------------------------------
add_user() {
    local uid="$1" name="$2"
    OC_PASS="$USER_PASS" docker exec -u www-data -e OC_PASS "$NC" \
        php occ user:add --password-from-env --display-name="$name" "$uid" >/dev/null \
        || die "user:add $uid schlug fehl"
    occ user:setting "$uid" core lang en >/dev/null
}
log "Konten alice (Alice Adler), bob (Bob Berg)${EXTRA_USERS:+, $EXTRA_USERS}, Sprache en; Gruppe $E2E_GROUP"
add_user alice "Alice Adler"
add_user bob "Bob Berg"
USERS_JSON='{"alice":"Alice Adler","bob":"Bob Berg"}'
for u in $EXTRA_USERS; do
    add_user "$u" "$(display_name "$u")"
    USERS_JSON="$(jq -c --arg u "$u" --arg n "$(display_name "$u")" '. + {($u): $n}' <<<"$USERS_JSON")"
done
occ group:add "$E2E_GROUP" >/dev/null || die "group:add $E2E_GROUP schlug fehl"
for u in bob $EXTRA_USERS; do
    occ group:adduser "$E2E_GROUP" "$u" >/dev/null || die "group:adduser $E2E_GROUP $u schlug fehl"
done
# First login once now (home folder, auth tokens), so no first-run work falls
# into a later test.
for u in alice bob $EXTRA_USERS; do
    curl -s -o /dev/null -m 60 -H 'Host: localhost' -u "$u:$USER_PASS" "http://127.0.0.1:$PORT/index.php/csrftoken" || true
done
# KD_USERS: the load accounts load01 … loadNN in the group workshop (SPEC-M1 §8.7)
LOAD_UIDS=()
if [ "$LOAD_USERS" -gt 0 ]; then
    for ((i = 1; i <= LOAD_USERS; i++)); do LOAD_UIDS+=("$(printf 'load%02d' "$i")"); done
    log "Lastkonten ${LOAD_UIDS[0]} … ${LOAD_UIDS[-1]} ($LOAD_USERS), Gruppe $LOAD_GROUP"
    occ group:add --display-name=Workshop "$LOAD_GROUP" >/dev/null || die "group:add $LOAD_GROUP schlug fehl"
    for u in "${LOAD_UIDS[@]}"; do
        add_user "$u" "Load ${u#load}"
        occ group:adduser "$LOAD_GROUP" "$u" >/dev/null || die "group:adduser $LOAD_GROUP $u schlug fehl"
        curl -s -o /dev/null -m 60 -H 'Host: localhost' -u "$u:$USER_PASS" "http://127.0.0.1:$PORT/index.php/csrftoken" || true
    done
fi
if [ "$LOAD_PROFILE" = prod ]; then
    log "KD_LOAD_PROFILE=prod: knorke_dev = false (Prod-Codepfad ohne Debug- und Skip-Bump-Haken)"
    occ config:system:set knorke_dev --value=false --type=boolean >/dev/null
fi
if [ "$IPAD_PROFILE" = 1 ]; then
    log "KD_IPAD_PROFILE=1: knorke_dev = false, trusted_domains + $IPAD_LAN (Relais dev/ipad/relay.mjs $IPAD_LAN:$IPAD_RELAY_PORT → 127.0.0.1:$PORT, SPEC-M1 §8.8)"
    occ config:system:set knorke_dev --value=false --type=boolean >/dev/null
    occ config:system:set trusted_domains "$IPAD_TRUSTED_INDEX" --value="$IPAD_LAN" >/dev/null
fi

# --- 8. cachebuster -----------------------------------------------------------
occ config:app:set theming cachebuster --value="$(date +%s)" >/dev/null

# --- 9./10. restart (APCu route cache) + 401 probe ---------------------------
log "Neustart (APCu-Routencache)"
docker restart "$NC" >/dev/null
wait_nc "$PORT" 240
probe_401 "$PORT"

# --- 11. env.json -------------------------------------------------------------
NC_IP="$(nc_ip)"
GATEWAY_IP="$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' "$NET" | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -n 1 || true)"
[ -n "$NC_IP" ] || die "keine IP für $NC im Netz $NET"
[ -n "$GATEWAY_IP" ] || die "kein IPv4-Gateway für $NET"
NCV="$(occ status --output=json | jq -r '.versionstring')"
PHPV="$(docker exec "$NC" php -r 'echo PHP_VERSION;')"
case "$DB_KIND" in
    pgsql) DBV="$(docker exec "$DB" psql -U nextcloud -d nextcloud -Atc 'SHOW server_version')" ;;
    mariadb|mysql) DBV="$(printf '%s\n' 'SELECT VERSION();' | db_sql)" ;;
    sqlite) DBV="$(printf '%s\n' 'SELECT sqlite_version();' | db_sql)" ;;
esac
PGV=""
[ "$DB_KIND" = pgsql ] && PGV="$DBV"
RV="$(docker exec "$REDIS" redis-server --version | sed -n 's/.*v=\([^ ]*\).*/\1/p')"
STATUS_URL=""
if [ "$APACHE_STATUS" = 1 ]; then
    STATUS_URL="http://$NC_IP:8081/server-status?auto"
    STATUS_OUT="$(curl -sf -m 5 "$STATUS_URL" || true)"
    grep -q '^BusyWorkers' <<<"$STATUS_OUT" || die "mod_status antwortet nicht auf $STATUS_URL (KD_APACHE_STATUS=1)"
    log "mod_status: $STATUS_URL (nur im vorderen Netz, nicht publiziert)"
fi
LOAD_JSON=null
if [ "$LOAD_ACTIVE" = 1 ]; then
    LOAD_JSON="$(jq -n --arg profile "$LOAD_PROFILE" --arg status "$STATUS_URL" --arg pg "$PG_CPUS" --arg gen "$GEN_CPUSET" --arg group "$LOAD_GROUP" \
        --argjson users "$(printf '%s\n' ${LOAD_UIDS[@]+"${LOAD_UIDS[@]}"} | jq -R . | jq -s -c 'map(select(. != ""))')" \
        --argjson apps "$(printf '%s\n' ${PROD_IDS[@]+"${PROD_IDS[@]}"} | jq -R . | jq -s -c 'map(select(. != ""))')" \
        '{profile: (if $profile == "" then null else $profile end), apacheStatus: ($status != ""),
          statusUrl: (if $status == "" then null else $status end), users: $users,
          group: (if ($users | length) > 0 then $group else null end),
          pgCpus: (if $pg == "" then null else $pg end), genCpuset: (if $gen == "" then null else $gen end),
          prodApps: $apps, variant: "base"}')"
fi

DB_NAME_J="$DB"
[ "$DB_KIND" = sqlite ] && DB_NAME_J=""
KD_J_ADMIN="$ADMIN_PASS" KD_J_USER="$USER_PASS" KD_J_DB="$DB_PASS" KD_J_REDIS="$REDIS_PASS" jq -n \
    --arg ns "$NS" --arg ncIp "$NC_IP" --arg gw "$GATEWAY_IP" --argjson port "$PORT" \
    --arg appDir "$APP_DIR" --arg nc "$NC" --arg db "$DB_NAME_J" --arg redis "$REDIS" --arg net "$NET" --arg back "$BACK" \
    --arg ncv "$NCV" --arg phpv "$PHPV" --arg pgv "$PGV" --arg rv "$RV" --arg image "$NC_IMAGE" \
    --arg kind "$DB_KIND" --arg dbImage "$DB_IMAGE" --arg dbv "$DBV" --arg utf8mb4 "$UTF8MB4" --arg charset "$TABLE_CHARSET" \
    --argjson users "$USERS_JSON" --arg group "$E2E_GROUP" --argjson load "$LOAD_JSON" \
    --arg ipad "$IPAD_PROFILE" --arg ipadLan "$IPAD_LAN" --argjson ipadRelay "$IPAD_RELAY_PORT" \
    '{ns: $ns, ncIp: $ncIp, gatewayIp: $gw, port: $port, host: "localhost",
      baseHost: ("http://127.0.0.1:" + ($port | tostring)), baseNet: ("http://" + $nc), appDir: $appDir,
      containers: {nc: $nc, db: (if $db == "" then null else $db end), redis: $redis}, network: $net,
      networks: {front: $net, back: $back},
      db: {kind: $kind, image: (if $dbImage == "" then null else $dbImage end),
           host: (if $db == "" then null else $db end),
           port: ({pgsql: 5432, mariadb: 3306, mysql: 3306}[$kind]),
           name: "nextcloud", user: (if $kind == "sqlite" then null else "nextcloud" end),
           pass: (if $kind == "sqlite" then null else env.KD_J_DB end),
           ncDbtype: ({pgsql: "pgsql", mariadb: "mysql", mysql: "mysql", sqlite: "sqlite3"}[$kind]),
           utf8mb4: (if $kind == "mariadb" or $kind == "mysql" then $utf8mb4 == "1" else null end),
           tableCharset: (if $charset == "" then null else $charset end),
           pgss: ($kind == "pgsql"), version: $dbv},
      redis: {host: $redis, port: 6379, pass: env.KD_J_REDIS},
      admin: {user: "admin", pass: env.KD_J_ADMIN}, userPass: env.KD_J_USER,
      users: $users, groups: {($group): ([$users | keys[] | select(. != "alice")])},
      versions: {nextcloud: $ncv, php: $phpv, postgres: (if $pgv == "" then null else $pgv end), db: ($kind + " " + $dbv), redis: $rv, image: $image}}
     + (if $load == null then {} else {load: $load} end)
     + (if $ipad == "1" then {ipad: {profile: true, lanHost: $ipadLan, relayPort: $ipadRelay}} else {} end)' \
    >"$STATE/env.json.tmp"
mv "$STATE/env.json.tmp" "$ENV_JSON"
chmod 600 "$ENV_JSON"

# --- 12. summary --------------------------------------------------------------
log "fertig: NC $NCV / PHP $PHPV / DB $DB_KIND $DBV / Redis $RV, App $(occ app:list --output=json | jq -r '.enabled.knorke // "AUS"') aus $APP_DIR"
log "Zustand: $ENV_JSON (Container-IP $NC_IP, Gateway $GATEWAY_IP)"
if [ "$LOAD_ACTIVE" = 1 ]; then
    log "Lastlauf: Profil ${LOAD_PROFILE:-–}, mod_status ${STATUS_URL:-aus}, Lastkonten $LOAD_USERS, PG-cpuset ${PG_CPUS:-–}, Generator-cpuset ${GEN_CPUSET:-–} (dev/load/run.sh)"
fi
log "Browser vom Arbeitsplatz: ssh -L $PORT:127.0.0.1:$PORT root@$(hostname), dann http://localhost:$PORT/ (Konten alice/bob, Passwort in env.json .userPass)"
