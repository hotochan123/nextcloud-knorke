#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Live check of the network and password layout of ONE running dev stack
# (round 2 U1, review finding OPS-5) and of its database kind (U2):
#   1. env.json names both networks, the DB kind and a Redis password
#   2. knorke-dev-$NS-back is --internal; the database and Redis are attached
#      to it and to nothing else; Nextcloud is attached to both networks
#   3. only Nextcloud publishes a port, and only on 127.0.0.1
#   4. a probe container on the FRONT network (where the E2E browser sits)
#      can neither resolve nor reach the database or Redis
#   5. a probe on the BACK network has no default route (no way out), and
#      Redis answers it NOAUTH without the password, PONG with it
#   6. Nextcloud has the Redis password, and the side channels work through
#      the containers' own credentials: redis-cli in the Redis container,
#      dev/db.sh (any kind), dev/psql.sh (pgsql) or its exit 2 (others)
#   7. mariadb/mysql: the knorke tables carry the charset KD_MYSQL_UTF8MB4
#      asked for (utf8mb4, or utf8mb3 for =0)
# The probes are throwaway containers knorke-e2e-$NS-probe<pid>-* (redis:7-alpine,
# docker rm -fv, so dev/down.sh would also find leftovers).
#
# Usage: KD_NS=d dev/selftest/isolation.sh      exit 0 = all checks green
set -uo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

[ -f "$ENV_JSON" ] || die "$ENV_JSON fehlt – erst KD_NS=$NS dev/up.sh"
require_running

OK=0
FAIL=0
pass() { OK=$((OK + 1)); printf '  ok     %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FEHLER %s\n' "$1"; }
check() { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi; }

PROBE="${E2E_PREFIX}probe$$"
cleanup() { docker rm -fv "$PROBE-front" "$PROBE-back" >/dev/null 2>&1 || true; }
trap cleanup EXIT

KIND="$(jq -r '.db.kind // empty' "$ENV_JSON")"
PLACEHOLDER=0
[ "$(jq -r '.appDir // empty' "$ENV_JSON")" = "$PLACEHOLDER_DIR" ] && PLACEHOLDER=1
TABLE_SQL="SELECT COUNT(*) FROM oc_knorke_boards"
[ "$PLACEHOLDER" = 1 ] && TABLE_SQL="SELECT COUNT(*) FROM oc_appconfig WHERE appid = 'knorke'"
BACK_J="$(jq -r '.networks.back // empty' "$ENV_JSON")"
RPASS="$(jq -r '.redis.pass // empty' "$ENV_JSON")"
echo "Isolation von Namensraum $NS (DB ${KIND:-?})"

echo "— 1. env.json"
check "env.json .db.kind ist eine bekannte Art" '[ -n "$KIND" ] && valid_db_kind "$KIND"'
check "env.json .networks = {front: $NET, back: $BACK}" '[ "$(jq -r .networks.front "$ENV_JSON")" = "$NET" ] && [ "$BACK_J" = "$BACK" ]'
check "env.json .redis.pass hat ≥ 24 Zeichen" '[ "${#RPASS}" -ge 24 ]'
check "env.json ist 600 in einem 700-Verzeichnis" '[ "$(stat -c %a "$ENV_JSON")" = 600 ] && [ "$(stat -c %a "$STATE")" = 700 ]'

echo "— 2. Netze"
nets() { docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$1" 2>/dev/null | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ $//'; }
check "$BACK ist --internal" '[ "$(docker network inspect -f "{{.Internal}}" "$BACK")" = true ]'
check "$NET ist nicht intern (veröffentlicht den Port)" '[ "$(docker network inspect -f "{{.Internal}}" "$NET")" = false ]'
check "Redis nur im internen Netz" '[ "$(nets "$REDIS")" = "$BACK" ]'
if [ "$KIND" = sqlite ]; then
    check "SQLite: kein Datenbank-Container" '! container_exists "$DB"'
else
    check "Datenbank nur im internen Netz" '[ "$(nets "$DB")" = "$BACK" ]'
fi
check "Nextcloud in beiden Netzen" '[ "$(nets "$NC")" = "$(printf "%s\n" "$BACK" "$NET" | sort | tr "\n" " " | sed "s/ $//")" ]'

echo "— 3. Ports"
pubs() { docker container inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$1" 2>/dev/null | sed 's/ $//'; }
check "Nextcloud veröffentlicht nur 127.0.0.1:<port>" '[[ "$(pubs "$NC")" =~ ^127\.0\.0\.1:[0-9]+$ ]]'
check "Redis veröffentlicht nichts" '[ -z "$(pubs "$REDIS")" ]'
[ "$KIND" = sqlite ] || check "Datenbank veröffentlicht nichts" '[ -z "$(pubs "$DB")" ]'

echo "— 4. Sonde im vorderen Netz (wie der E2E-Browser)"
DBPORT=5432
case "$KIND" in mariadb|mysql) DBPORT=3306 ;; esac
FRONT_OUT="$(docker run --rm --name "$PROBE-front" --label "$LABEL" --network "$NET" redis:7-alpine sh -c "
    if nslookup $REDIS >/dev/null 2>&1 || getent hosts $REDIS >/dev/null 2>&1; then echo redis-resolves; fi
    timeout 5 redis-cli -h $REDIS PING 2>&1 | grep -q -E 'PONG|NOAUTH' && echo redis-reachable
    if [ '$KIND' != sqlite ]; then nc -z -w 3 $DB $DBPORT 2>/dev/null && echo db-reachable; fi
    echo done" 2>&1)"
check "Sonde lief" 'printf "%s" "$FRONT_OUT" | grep -q done'
check "Redis-Name im vorderen Netz nicht auflösbar" '! printf "%s" "$FRONT_OUT" | grep -q redis-resolves'
check "Redis aus dem vorderen Netz nicht erreichbar" '! printf "%s" "$FRONT_OUT" | grep -q redis-reachable'
[ "$KIND" = sqlite ] || check "Datenbank aus dem vorderen Netz nicht erreichbar" '! printf "%s" "$FRONT_OUT" | grep -q db-reachable'

echo "— 5. Sonde im internen Netz"
BACK_OUT="$(REDISCLI_PW="$RPASS" docker run --rm --name "$PROBE-back" --label "$LABEL" --network "$BACK" -e REDISCLI_PW redis:7-alpine sh -c "
    ip route | grep -q '^default' && echo has-default-route
    echo noauth=\$(redis-cli -h $REDIS PING 2>&1 | tr -d '\r')
    echo auth=\$(REDISCLI_AUTH=\"\$REDISCLI_PW\" redis-cli -h $REDIS PING 2>&1 | tr -d '\r')
    echo done" 2>&1)"
check "Sonde lief" 'printf "%s" "$BACK_OUT" | grep -q done'
check "internes Netz ohne Default-Route (kein Weg nach draußen)" '! printf "%s" "$BACK_OUT" | grep -q has-default-route'
check "Redis ohne Passwort → NOAUTH" 'printf "%s" "$BACK_OUT" | grep -q "^noauth=NOAUTH"'
check "Redis mit Passwort → PONG" 'printf "%s" "$BACK_OUT" | grep -qx "auth=PONG"'

echo "— 6. Passwörter und Seitenkanäle"
check "Nextcloud kennt das Redis-Passwort" '[ "$(occ config:system:get redis password)" = "$RPASS" ]'
check "memcache.distributed ist Redis" 'occ config:system:get memcache.distributed | grep -q Redis'
check "redis-cli im Redis-Container authentifiziert sich selbst (REDISCLI_AUTH)" '[ "$(docker exec "$REDIS" redis-cli PING)" = PONG ]'
check "dev/db.sh --kind = $KIND" '[ "$(KD_NS="$NS" "$DEV/db.sh" --kind)" = "$KIND" ]'
check "dev/db.sh -c: $TABLE_SQL" '[[ "$(KD_NS="$NS" "$DEV/db.sh" -c "$TABLE_SQL")" =~ ^[0-9]+$ ]]'
if [ "$KIND" = pgsql ]; then
    check "dev/psql.sh läuft" '[ "$(KD_NS="$NS" "$DEV/psql.sh" -Atc "SELECT 42")" = 42 ]'
else
    check "dev/psql.sh verweigert mit Exit 2 und Hinweis auf dev/db.sh" 'out="$(KD_NS="$NS" "$DEV/psql.sh" -Atc "SELECT 1" 2>&1 </dev/null)"; [ $? = 2 ] && printf "%s" "$out" | grep -q "dev/db.sh"'
fi

case "$PLACEHOLDER:$KIND" in
    0:mariadb|0:mysql)
        echo "— 7. Zeichensatz"
        WANT=utf8mb4
        [ "$(jq -r '.db.utf8mb4' "$ENV_JSON")" = false ] && WANT=utf8mb3
        COLL="$(KD_NS="$NS" "$DEV/db.sh" -c "SELECT table_collation FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'oc_knorke_items'" 2>/dev/null || true)"
        CS="${COLL%%_*}"
        [ "$CS" = utf8 ] && CS=utf8mb3
        check "oc_knorke_items: $WANT ($COLL)" '[ "$CS" = "$WANT" ]'
        if [ "$WANT" = utf8mb3 ]; then
            check "Nextcloud: mysql.utf8mb4 = false" '[ "$(occ config:system:get mysql.utf8mb4)" = false ]'
        fi
        ;;
esac

printf '==== Isolation %s: %s ok / %s fehlgeschlagen ====\n' "$NS" "$OK" "$FAIL"
[ "$FAIL" -eq 0 ]
