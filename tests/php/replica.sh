#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Read replicas (SPEC-M0 §3.7, review finding NC-1) against the dev stack of
# ONE namespace (KD_DB=pgsql only):
#
#   KD_NS=br tests/php/replica.sh
#
# Sets up the worst replica there is: a FROZEN copy of the database. A second
# PostgreSQL container knorke-dev-$NS-replica (label knorke=dev-$NS, internal
# network of the stack, so dev/down.sh removes it too) is loaded once with
# pg_dump of the stack's database and never updated. A late config file
# config/zz-knorke-replica.config.php points Nextcloud's `dbreplica` at it.
# Nextcloud then sends every read outside a transaction to the copy, unless
# the same request wrote that table in the last 3 s — Knorke must still see
# every board, link, membership and item created after the dump:
#
#   0  sanity: Nextcloud really reads from the copy (its transaction counter
#      moves with each request)
#   1  board A, its link, a member and a guest exist BEFORE the dump; after
#      it alice writes an item → the member's and the guest's syncs (fast
#      path, rev from Redis) return it (was {"rev":1} without items: the
#      cursor moved past a change it never received)
#   2  board B created AFTER the dump → snapshot right away (was 404), link
#      (was 404), /p/{token} → linkState ok (was 'invalid' + a miss), guest
#      join and account join, member snapshot (were 404)
#   3  (SPEC-M1 §4.13.1) board A renamed AFTER the dump: the head (meta_rev,
#      ItemStore::readHead) and the meta row (BoardStore::meta) come from the
#      primary — the member's and the guest's next sync carry the new title
#
# Protocol 2 (SPEC-M1 §4.5): sync bodies carry the board epoch `ep` from the
# first snapshot.
#
# The EXIT trap removes the config file, the replica container (docker rm
# -fv) and the boards. Only this namespace is touched; a protected namespace
# (KD_PROTECT_NS, default try) is refused with exit 2 unless KD_FORCE=1
# (dev/lib.sh, SPEC-M1 §8.1).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
NS="${KD_NS:-b}"
[[ "$NS" =~ ^[a-z]{1,8}$ ]] || { echo "KD_NS='$NS' ist ungültig" >&2; exit 2; }
# Protected namespaces (SPEC-M1 §0, §8.1): dev/lib.sh refuses KD_PROTECT_NS
# (default try, the user's stack) with exit 2 unless KD_FORCE=1, before any
# docker call. Sourced in a subshell: only its verdict is needed here.
(KD_NS="$NS" && . "$ROOT/dev/lib.sh") || exit $?
ENV_JSON="$ROOT/dev/.state/$NS/env.json"
[ -f "$ENV_JSON" ] || { echo "$ENV_JSON fehlt – erst KD_NS=$NS dev/up.sh" >&2; exit 2; }
KIND="$(jq -r '.db.kind // "pgsql"' "$ENV_JSON")"
[ "$KIND" = pgsql ] || { echo "replica.sh braucht KD_DB=pgsql (hier $KIND)" >&2; exit 2; }
PORT="$(jq -r .port "$ENV_JSON")"
PASS="$(jq -r .userPass "$ENV_JSON")"
GW="$(jq -r .gatewayIp "$ENV_JSON")"
NC="$(jq -r .containers.nc "$ENV_JSON")"
DB="$(jq -r .containers.db "$ENV_JSON")"
BACK="$(jq -r '.networks.back // empty' "$ENV_JSON")"
DB_IMAGE="$(jq -r '.db.image // "postgres:17-alpine"' "$ENV_JSON")"
DB_PASS="$(jq -r '.db.pass // empty' "$ENV_JSON")"
[[ "$NC" =~ ^knorke-dev-[a-z]{1,8}-nc$ ]] && [[ "$DB" =~ ^knorke-dev-[a-z]{1,8}-db$ ]] || { echo "env.json nennt keine knorke-dev-*-Container" >&2; exit 2; }
[ -n "$BACK" ] && [ -n "$DB_PASS" ] || { echo "env.json ohne networks.back/db.pass (Stack vor Runde 2) – neu aufsetzen" >&2; exit 2; }
REPLICA="knorke-dev-$NS-replica"
LABEL="knorke=dev-$NS"
CONF=/var/www/html/config/zz-knorke-replica.config.php
BASE="http://127.0.0.1:$PORT/index.php"
APP="$BASE/apps/knorke"
docker container inspect "$REPLICA" >/dev/null 2>&1 && { echo "$REPLICA existiert schon" >&2; exit 2; }

TMP="$(mktemp -d)"
BOARDS=()
cleanup() {
    docker exec -u www-data "$NC" rm -f "$CONF" >/dev/null 2>&1 || true
    for b in ${BOARDS[@]+"${BOARDS[@]}"}; do
        curl -s -o /dev/null -m 30 -X DELETE -b "$TMP/jar-alice" -u "alice:$PASS" -H 'Host: localhost' \
            -H "requesttoken: ${TOKEN[alice]:-}" -H 'X-Requested-With: XMLHttpRequest' "$APP/api/v1/boards/$b" || true
    done
    docker rm -fv "$REPLICA" >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ security:bruteforce:reset "$GW" >/dev/null 2>&1 || true
    rm -rf "${TMP:?}"
}
trap cleanup EXIT

OK=0
FAIL=0
CODE=""
BODY="$TMP/body"
pass() { OK=$((OK + 1)); printf '  ok    %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FEHLER %s\n         Status %s, Body: %s\n' "$1" "$CODE" "$(head -c 300 "$BODY" | tr '\n' ' ')"; }
check() {
    local name="$1" status="$2" filter="${3:-}"
    if [ "$CODE" != "$status" ]; then fail "$name (erwartet $status)"; return; fi
    if [ -n "$filter" ] && ! jq -e "$filter" "$BODY" >/dev/null 2>&1; then fail "$name (Form: $filter)"; return; fi
    pass "$name"
}
declare -A TOKEN
login() {
    TOKEN[$1]="$(curl -s -m 30 -c "$TMP/jar-$1" -b "$TMP/jar-$1" -u "$1:$PASS" -H 'Host: localhost' "$BASE/csrftoken" | jq -r .token)"
    [ -n "${TOKEN[$1]}" ] && [ "${TOKEN[$1]}" != null ] || { echo "Login $1 fehlgeschlagen" >&2; exit 1; }
}
as() {
    local u="$1" method="$2" url="$3" body="${4:-}"
    local args=(-s -m 60 -o "$BODY" -w '%{http_code}' -X "$method" -H 'Host: localhost' -H 'Accept: application/json'
        -c "$TMP/jar-$u" -b "$TMP/jar-$u" -u "$u:$PASS" -H "requesttoken: ${TOKEN[$u]}" -H 'X-Requested-With: XMLHttpRequest')
    [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data-binary "$body")
    CODE="$(curl "${args[@]}" "$url")"
}
guest() {
    local method="$1" url="$2" body="${3:-}" tok="${4:-}"
    local args=(-s -m 60 -o "$BODY" -w '%{http_code}' -X "$method" -H 'Host: localhost' -H 'Accept: application/json' -H 'X-Requested-With: XMLHttpRequest')
    [ -n "$tok" ] && args+=(-H "X-Knorke-Guest: $tok")
    [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data-binary "$body")
    CODE="$(curl "${args[@]}" "$url")"
}
state() {
    grep -o "id=\"initial-state-knorke-$1\" value=\"[^\"]*\"" "$BODY" | sed 's/.*value="\([^"]*\)"/\1/' | base64 -d 2>/dev/null
}

echo "Replikat-Test gegen $BASE (KD_NS=$NS)"
docker exec -u www-data "$NC" php occ security:bruteforce:reset "$GW" >/dev/null
login alice
login bob

echo "— vor dem Dump: Board A mit Link, Mitglied und Gast"
as alice POST "$APP/api/v1/boards" '{"title":"Replikat A"}'
check "Board A → 201" 201
A="$(jq -r .board.id "$BODY")"
BOARDS+=("$A")
as alice POST "$APP/api/v1/boards/$A/link" '{"rotate":false}'
check "Link A" 200
LINK_A="$(jq -r .link.token "$BODY")"
as bob POST "$APP/api/v1/links/$LINK_A/join" '{}'
check "bob tritt A bei" 200 ".boardId == $A"
as bob GET "$APP/api/v1/boards/$A/snapshot"
check "bob öffnet A (Grant und Gens im Cache)" 200 '.rev == 0 and .proto == 2'
EP="$(jq -r .epoch "$BODY")"
[[ "$EP" =~ ^[a-z0-9]{1,16}$ ]] || { echo "keine Epoche im Snapshot ('$EP')" >&2; exit 1; }
guest POST "$APP/pub/v1/$LINK_A/join" '{"client":"cG","name":"Gina"}'
check "Gast tritt A bei" 200 ".board.id == $A"
GTOK_A="$(jq -r .guest.token "$BODY")"

echo "— eingefrorene Kopie der Datenbank als dbreplica"
POSTGRES_PASSWORD="$DB_PASS" docker run -d --name "$REPLICA" --network "$BACK" --label "$LABEL" \
    -e POSTGRES_DB=nextcloud -e POSTGRES_USER=nextcloud -e POSTGRES_PASSWORD "$DB_IMAGE" >/dev/null
for _ in $(seq 1 60); do
    docker exec "$REPLICA" pg_isready -h 127.0.0.1 -U nextcloud -d nextcloud >/dev/null 2>&1 && break
    sleep 1
done
docker exec "$REPLICA" pg_isready -h 127.0.0.1 -U nextcloud -d nextcloud >/dev/null || { echo "$REPLICA kommt nicht hoch" >&2; exit 1; }
docker exec "$DB" pg_dump -U nextcloud -d nextcloud --no-owner --no-privileges \
    | docker exec -i "$REPLICA" psql -q -U nextcloud -d nextcloud >"$TMP/restore.log" 2>&1 || true
rsql() { docker exec "$REPLICA" psql -U nextcloud -d nextcloud -Atc "$1"; }
REPL_BOARDS="$(rsql 'SELECT count(*) FROM oc_knorke_boards')"
docker exec -i -u www-data "$NC" sh -c "umask 027; cat > '$CONF'" <<PHP
<?php
// Written by knorke tests/php/replica.sh for one run, removed again by it.
\$CONFIG = ['dbreplica' => [['host' => '$REPLICA', 'user' => 'nextcloud', 'password' => '$DB_PASS', 'dbname' => 'nextcloud']]];
PHP
if [ "$(docker exec -u www-data "$NC" php occ config:system:get dbreplica 0 host)" = "$REPLICA" ]; then
    pass "dbreplica → $REPLICA (eingefroren mit $REPL_BOARDS Boards)"
else
    CODE=-; fail "dbreplica nicht gesetzt"
fi

echo "— 0 Nextcloud liest wirklich vom Replikat"
X0="$(rsql "SELECT xact_commit FROM pg_stat_database WHERE datname = 'nextcloud'")"
as bob GET "$APP/api/v1/boards"
X1="$(rsql "SELECT xact_commit FROM pg_stat_database WHERE datname = 'nextcloud'")"
# One transaction is the counter query itself.
if [ "$((X1 - X0))" -gt 1 ]; then pass "eine Anfrage: $((X1 - X0 - 1)) Lese-Transaktionen auf dem Replikat"; else CODE=-; fail "Replikat unbenutzt ($X0 → $X1)"; fi

echo "— 1 schreiben nach dem Dump, reine Leser holen ab (Board A)"
as alice POST "$APP/api/v1/boards/$A/sync" "{\"proto\":2,\"ep\":\"$EP\",\"client\":\"cAli\",\"since\":0,\"seq\":1,\"ops\":[{\"o\":\"put\",\"id\":\"01JRE0000000000000000000A1\",\"t\":\"sticky\",\"p\":{\"x\":1,\"y\":2,\"w\":200,\"h\":200,\"z\":\"i0\",\"parent\":null,\"data\":{\"text\":\"nach dem Dump\"}}}],\"pres\":0}"
check "alice schreibt → rev 1" 200 '.acks.res == ["ok"] and .rev == 1'
as bob POST "$APP/api/v1/boards/$A/sync" "{\"proto\":2,\"ep\":\"$EP\",\"client\":\"cBob\",\"since\":0,\"pres\":0}"
check "bob (Fastpath, rev aus Redis) bekommt das Objekt (vorher {\"rev\":1} ohne items)" 200 '.rev == 1 and (.items | length) == 1 and .items[0].data.text == "nach dem Dump"'
guest POST "$APP/pub/v1/boards/$A/sync" "{\"proto\":2,\"ep\":\"$EP\",\"client\":\"cG\",\"since\":0,\"pres\":0}" "$GTOK_A"
check "Gast (Fastpath) bekommt das Objekt" 200 '.rev == 1 and (.items | length) == 1'

echo "— 2 Board B nach dem Dump: anlegen und sofort öffnen"
as alice POST "$APP/api/v1/boards" '{"title":"Replikat B"}'
check "Board B → 201" 201
B="$(jq -r .board.id "$BODY")"
BOARDS+=("$B")
as alice GET "$APP/api/v1/boards/$B/snapshot"
check "Snapshot sofort nach dem Anlegen (vorher 404)" 200 ".board.id == $B and .rev == 0"
as alice GET "$APP/api/v1/boards"
check "Board-Liste enthält B" 200 "(.boards | map(.id) | index($B)) != null"
as alice POST "$APP/api/v1/boards/$B/link" '{"rotate":false}'
check "Link sofort (vorher 404)" 200 '.link.token | test("^[A-Za-z0-9]{24}$")'
LINK="$(jq -r .link.token "$BODY")"
CODE="$(curl -s -m 30 -o "$BODY" -w '%{http_code}' -H 'Host: localhost' "$APP/p/$LINK")"
if [ "$CODE" = 200 ] && [ "$(state linkState)" = '"ok"' ]; then pass "/p/{token} → linkState ok (vorher invalid + Fehlversuch)"; else fail "/p/{token} linkState '$(state linkState)'"; fi
guest POST "$APP/pub/v1/$LINK/join" '{"client":"cG","name":"Gina"}'
check "Gast-Beitritt (vorher 404)" 200 ".board.id == $B"
as bob POST "$APP/api/v1/links/$LINK/join" '{}'
check "angemeldeter Beitritt (vorher 404)" 200 ".boardId == $B"
as bob GET "$APP/api/v1/boards/$B/snapshot"
check "Mitglied öffnet sofort (vorher 404)" 200 '.board.role == "edit" and .rev == 0'
echo "— 3 Umbenennen nach dem Dump: Kopf und Meta vom Primärserver (SPEC-M1 §4.13.1)"
as alice PATCH "$APP/api/v1/boards/$A" '{"title":"Replikat A2"}'
check "alice benennt A um → rev 2 = meta_rev" 200 '.board.title == "Replikat A2"'
as bob POST "$APP/api/v1/boards/$A/sync" "{\"proto\":2,\"ep\":\"$EP\",\"client\":\"cBob\",\"since\":1,\"pres\":0}"
check "bob bekommt den neuen Titel (Replikat hätte meta_rev 0)" 200 '.rev == 2 and .board.title == "Replikat A2" and .board.metaRev == 2'
guest POST "$APP/pub/v1/boards/$A/sync" "{\"proto\":2,\"ep\":\"$EP\",\"client\":\"cG\",\"since\":1,\"pres\":0}" "$GTOK_A"
check "Gast bekommt den neuen Titel" 200 '.rev == 2 and .board.title == "Replikat A2"'
as bob GET "$APP/api/v1/boards/$A/snapshot"
check "Mitglieds-Snapshot: Titel und metaRev vom Primärserver" 200 '.rev == 2 and .board.title == "Replikat A2" and .board.metaRev == 2'

REPL_NOW="$(rsql 'SELECT count(*) FROM oc_knorke_boards')"
if [ "$REPL_NOW" = "$REPL_BOARDS" ]; then pass "das Replikat blieb eingefroren ($REPL_NOW Boards)"; else CODE=-; fail "Replikat hat jetzt $REPL_NOW statt $REPL_BOARDS Boards"; fi

printf '\n%s ok / %s fehlgeschlagen\n' "$OK" "$FAIL"
[ "$FAIL" -eq 0 ]
