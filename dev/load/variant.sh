#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Measurement variants of the load run (SPEC-M1 §8.7): switches the RUNNING
# dev stack of ONE namespace (default load) and records the variant in
# env.json .load.variant; dev/load/load.mjs writes it into every report and
# report name (<scenario>-<variant>[-<label>]).
#
# Usage: KD_NS=load dev/load/variant.sh status | base | dbpersistent | app-off <app>
#   status         prints the active variant (read-only)
#   base           the prod defaults: dbpersistent deleted (off), PostgreSQL
#                  max_connections back to the image default (ALTER SYSTEM RESET,
#                  100 like prod), every app of the prod set enabled;
#                  restarts the database and Nextcloud
#   dbpersistent   S4d: dbpersistent = true and PostgreSQL max_connections = 200
#                  (ALTER SYSTEM SET, database restart), Nextcloud restart; only
#                  from base, only with KD_DB=pgsql
#   app-off <app>  E1 (e.g. admincockpit): one app of the prod set (env.json
#                  .load.prodApps, KD_PROD_APPS=1) disabled, Nextcloud restart
#                  (APCu); only from base
#
# Acts only on the containers of its own namespace: every docker call that
# changes something goes through assert_own (name knorke-dev-$NS-*) and a
# label check (knorke=dev-$NS); prod names cannot come out of KD_NS. A
# protected namespace (KD_PROTECT_NS, default try) is refused by dev/lib.sh
# with exit 2 before any docker call. While a load run holds
# $KD_LOCK_DIR/load.lock, variant.sh refuses (and holds it itself while it
# switches, so no run starts half-way).
# Exit: 0 done, 1 error, 2 refused (protected namespace, usage, not a load
# stack, app not in the prod set, wrong starting variant, load run active).
set -euo pipefail

export KD_NS="${KD_NS:-load}"
# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

USAGE="usage: KD_NS=<ns> dev/load/variant.sh status | base | dbpersistent | app-off <app>"
ACTION="${1:-}"
APP="${2:-}"
case "$ACTION" in
    status|base|dbpersistent) [ $# -eq 1 ] || refuse "$USAGE" ;;
    app-off)
        [ $# -eq 2 ] || refuse "$USAGE"
        [[ "$APP" =~ ^[a-z0-9_]{1,32}$ ]] || refuse "App-ID '$APP' ist ungültig (^[a-z0-9_]{1,32}\$)"
        ;;
    *) refuse "$USAGE" ;;
esac

[ -f "$ENV_JSON" ] || refuse "$ENV_JSON fehlt – erst KD_NS=$NS dev/up.sh"
current_variant() {
    local v
    v="$(env_get '.load.variant')"
    printf '%s\n' "${v:-base}"
}
if [ "$ACTION" = status ]; then
    current_variant
    exit 0
fi
[ "$(env_get '.load | type')" = object ] || refuse "Namensraum '$NS' ist kein Lastlauf-Stack (env.json .load fehlt) – dev/up.sh mit KD_LOAD_PROFILE=prod (SPEC-M1 §8.7)"

mkdir -p "$KD_LOCK_DIR" || refuse "Sperrverzeichnis $KD_LOCK_DIR lässt sich nicht anlegen (KD_LOCK_DIR)"
exec 8>>"$KD_LOCK_DIR/load.lock" || refuse "Sperrdatei $KD_LOCK_DIR/load.lock lässt sich nicht öffnen"
flock -x -n 8 || refuse "ein Lastlauf hält $KD_LOCK_DIR/load.lock – Variante erst nach dem Lauf wechseln"
container_running "$NC" || refuse "Stack '$NS' läuft nicht ($NC)"
CUR="$(current_variant)"

# own_labelled NAME: NAME belongs to this namespace by name (assert_own) AND by label.
own_labelled() {
    assert_own "$1"
    [ "$(docker container inspect -f "{{index .Config.Labels \"$LABEL_KEY\"}}" "$1" 2>/dev/null)" = "$LABEL_VAL" ] \
        || die "interner Schutz: $1 trägt nicht das Label $LABEL"
}

# set_env FILTER [jq args…]: rewrites env.json (mode 600) with a jq filter.
set_env() {
    local filter="$1"
    shift
    jq "$@" "$filter" "$ENV_JSON" >"$ENV_JSON.tmp" || die "env.json ließ sich nicht schreiben"
    mv "$ENV_JSON.tmp" "$ENV_JSON"
    chmod 600 "$ENV_JSON"
}

restart_nc() {
    local port ip status=null
    own_labelled "$NC"
    port="$(nc_port)"
    log "Neustart $NC"
    docker restart "$NC" >/dev/null
    wait_nc "$port" 240
    probe_401 "$port"
    # the container IP can change on a restart; load.mjs talks to it directly
    ip="$(nc_ip)"
    [ -n "$ip" ] || die "keine IP für $NC"
    [ "$(env_get '.load.apacheStatus')" = true ] && status="\"http://$ip:8081/server-status?auto\""
    set_env '.ncIp = $ip | .load.statusUrl = ($status | fromjson)' --arg ip "$ip" --arg status "$status"
}

restart_db() {
    local ok=0
    own_labelled "$DB"
    log "Neustart $DB"
    docker restart "$DB" >/dev/null
    for _ in $(seq 1 60); do
        if docker exec "$DB" pg_isready -h 127.0.0.1 -U nextcloud -d nextcloud >/dev/null 2>&1; then ok=1; break; fi
        sleep 1
    done
    [ "$ok" = 1 ] || die "$DB kommt nach dem Neustart nicht hoch"
}

pg_max() {
    docker exec "$DB" psql -U nextcloud -d nextcloud -Atc 'SHOW max_connections'
}

case "$ACTION" in
    base)
        log "Variante base (vorher $CUR)"
        occ config:system:delete dbpersistent >/dev/null
        if [ "$(db_kind)" = pgsql ]; then
            own_labelled "$DB"
            docker exec "$DB" psql -U nextcloud -d nextcloud -qc 'ALTER SYSTEM RESET max_connections' >/dev/null
            restart_db
        fi
        for id in $(env_get '.load.prodApps // [] | .[]'); do
            [[ "$id" =~ ^[a-z0-9_]{1,32}$ ]] || continue
            occ app:enable "$id" >/dev/null || die "occ app:enable $id schlug fehl"
        done
        restart_nc
        [ "$(db_kind)" != pgsql ] || log "PostgreSQL max_connections = $(pg_max)"
        set_env '.load.variant = "base"'
        ;;
    dbpersistent)
        [ "$CUR" = base ] || refuse "aktive Variante ist $CUR – erst KD_NS=$NS dev/load/variant.sh base"
        [ "$(db_kind)" = pgsql ] || refuse "dbpersistent (S4d) gibt es nur mit KD_DB=pgsql"
        log "Variante dbpersistent: dbpersistent = true, PostgreSQL max_connections = 200 (S4d)"
        occ config:system:set dbpersistent --value=true --type=boolean >/dev/null
        own_labelled "$DB"
        docker exec "$DB" psql -U nextcloud -d nextcloud -qc 'ALTER SYSTEM SET max_connections = 200' >/dev/null
        restart_db
        restart_nc
        got="$(pg_max)"
        [ "$got" = 200 ] || die "max_connections ist $got statt 200"
        set_env '.load.variant = "dbpersistent"'
        ;;
    app-off)
        [ "$CUR" = base ] || refuse "aktive Variante ist $CUR – erst KD_NS=$NS dev/load/variant.sh base"
        env_get '.load.prodApps // [] | .[]' | grep -qx "$APP" \
            || refuse "'$APP' gehört nicht zum Prod-App-Satz dieses Stacks (env.json .load.prodApps: $(env_get '.load.prodApps // [] | join(" ")'))"
        log "Variante app-off-$APP"
        occ app:disable "$APP" >/dev/null || die "occ app:disable $APP schlug fehl"
        restart_nc
        set_env '.load.variant = $v' --arg v "app-off-$APP"
        ;;
esac
log "aktive Variante: $(current_variant)"
