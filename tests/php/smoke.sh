#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# curl probes of every route of SPEC-M0 §4.1 and SPEC-M1 §4.1 (all 26 real
# since stage 3) against the running dev stack of ONE
# namespace (default b): expected status and answer form, including the
# 411/413/400 of JsonBody, the app error form {error, message}, Nextcloud's
# own 401 {message}, linkState on /p/…, guests, revocation and gzip.
# Protocol 2 (SPEC-M1 §4.3–§4.5): every sync body carries proto 2 and the
# board epoch `ep` (taken from the first snapshot), every sync answer `now`,
# a cursor below meta_rev gets `board` (live title), the 409 body `proto`,
# the snapshot epoch/now/board.meta/board.links/me.mod/me.source.
# Stage 1 (SPEC-M1 §3.10, §4.7 rules 12–15, §4.8): shapes of every kind,
# text, connectors (ends checked under the lock, release of a removed
# target, an end at a tombstone), keep, and the initial state limits with
# maxItems/maxLabel. An unknown type is now 'pen' (shape is known).
# Stage 2 (SPEC-M1 §4.9–§4.11): shares (routes 19–21: owner, moderator only
# links, member 403, stranger 404; the PUT rules with at/max; the recipient
# search), roles in snapshot, sync (me {role, mod}) and board list (source,
# mod), both links (17/18) with password, calendar-day expiry, renewal,
# account and guest joins, linkInfo/expired on /p, and Nextcloud's sharing
# policy (shareapi_enabled, shareapi_enforce_links_password; both keys are
# deleted again, also in the EXIT trap). The ILimiter budgets of routes 20/21
# persist in Redis: the block starts and ends with ratelimit_reset (SCAN + DEL
# of Nextcloud's rate-limit keys in THIS namespace's Redis, SRV-07).
# Stage 3 (SPEC-M1 §4.12, §4.5/§4.6, §4.13.8 step 9): routes 22–26 (rights
# 403/404, codes, no-op answers with the same metaRev, the answer
# {board, now}), vote ops in /sync (set semantics, budget, closed, votes
# {sid, mine, left}, {} never []), voters/vt only for moderators with vt,
# votes in the snapshot, presence v, VoteCloseJob through occ and the close
# of a moderator poll (path b). vote_expire_now sets ends_at of the open
# session a moment into the past (like the bridge action vote-expire).
# Stage 4 (SPEC-M1 §4.1, §4.13.6, §4.13.7): the snapshot throttle of route 12
# (30 per 60 s per account → 429 slow_down, retryMs 2000, Retry-After 2), of
# the guest join (14) and the guest snapshot (15) with an old token; the write
# budget with app config budget_syncs = 2 (three requests with ops in one
# 10-s window → the third busy for every op, acks.rev null, retryMs from the
# answer's now; an empty poll stays free; the window keys carry a TTL ≤ 25 s;
# the key is deleted again, also in the EXIT trap); occ knorke:compact
# --board (--now 31 days ahead purges the tombstones; min_rev = X; a cursor
# below X resyncs, at X not; an unknown board → exit 1). The ILimiter state
# is reset before and after the block (ratelimit_reset).
#
#   KD_NS=b tests/php/smoke.sh
#
# Talks to http://127.0.0.1:$port with Host: localhost (env.json). A protected
# namespace (KD_PROTECT_NS, default try) is refused with exit 2 unless
# KD_FORCE=1 (dev/lib.sh, SPEC-M1 §8.1). Only the own namespace is touched:
# occ runs in knorke-dev-$KD_NS-nc to reset the brute-force counter of the dev network's gateway (the address the server
# sees) before and after the run, and to switch public_template for one probe.
# For one block (§5.4 "Redis weg") the distributed cache is switched off in
# that container: a late config/zz-knorke-smoke-nodist.config.php sets
# memcache.distributed = NullCache, so ICacheFactory::isAvailable() is false
# from the next request on (Nextcloud re-reads config/*.config.php on every
# request and invalidates their opcache entries). The file is removed right
# after the block and again in the EXIT trap.
# P7 (SPEC-M1 §33.1, Revision 22): the templates are no direct entry point
# (GET /custom_apps/knorke/templates/{guest,main,public}.php → 404 without
# "Fatal error" or a server path, P7-05); occ knorke:orphans with its five
# lines (P7-02); the link throttle knorke-link with app config link_limit = 2
# (the third writing call → 429 slow_down, retryMs 300000, Retry-After 300; a
# stranger stays 404, GET shares is never throttled, P7-03); the daily byte
# quota with budget_bytes_board_day = 1100 (the third request with ops on a
# new board → busy with the day's retryMs, P7-01); link URLs from
# public_url (P7-16). The three keys get their earlier state back — also in
# the EXIT trap.
# Round 2: the block "Link-Richtlinie" switches Nextcloud's link sharing off
# (core shareapi_allow_links = no) and deletes the board's a: key in the
# namespace's Redis (pattern */knorke/*/a:<board>: the epoch is part of the
# prefix, SPEC-M1 §5.1) so the fast path re-reads it; the block "Rechtliches"
# sets theming imprintUrl/privacyUrl. The EXIT trap deletes all three keys
# (dev stacks never set them otherwise).
# Theming-Icon (job 033): the page links apple-touch-icon and icon to
# /apps/theming/icon/knorke and /apps/theming/favicon/knorke, which answer
# anonymously 200 with a 512 × 512 PNG (not core's) and an ICO, rendered by
# Nextcloud's theming from img/app.svg; the block changes no setting.
# Job 131: the guest page /p/{token} (ok, public_template = base, invalid)
# links no web app manifest but keeps its apple-touch-icon; the account
# page / keeps <link rel="manifest"> on /apps/theming/manifest/knorke. The
# base probe waits out the app config cache (occ_config_wait), so it really
# gets the base layout.
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
PORT="$(jq -r .port "$ENV_JSON")"
PASS="$(jq -r .userPass "$ENV_JSON")"
GW="$(jq -r .gatewayIp "$ENV_JSON")"
NC="$(jq -r .containers.nc "$ENV_JSON")"
[[ "$NC" =~ ^knorke-dev-[a-z]{1,8}-nc$ ]] || { echo "env.json nennt keinen knorke-dev-*-nc ('$NC')" >&2; exit 2; }
REDIS="$(jq -r .containers.redis "$ENV_JSON")"
[[ "$REDIS" =~ ^knorke-dev-[a-z]{1,8}-redis$ ]] || { echo "env.json nennt keinen knorke-dev-*-redis ('$REDIS')" >&2; exit 2; }
BASE="http://127.0.0.1:$PORT/index.php"
APP="$BASE/apps/knorke"

TMP="$(mktemp -d)"
NODIST=/var/www/html/config/zz-knorke-smoke-nodist.config.php
cleanup() {
    docker exec -u www-data "$NC" rm -f "$NODIST" >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ security:bruteforce:reset "$GW" >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete knorke public_template >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete core shareapi_allow_links >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete core shareapi_enabled >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete core shareapi_enforce_links_password >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete theming imprintUrl >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete theming privacyUrl >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ user:setting alice core timezone --delete >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete knorke budget_syncs >/dev/null 2>&1 || true
    docker exec -u www-data "$NC" php occ config:app:delete knorke public_url >/dev/null 2>&1 || true
    [ -n "${P7_LINK_LIMIT:-}" ] && appcfg_restore link_limit "$P7_LINK_LIMIT"
    [ -n "${P7_BYTES_BOARD:-}" ] && appcfg_restore budget_bytes_board_day "$P7_BYTES_BOARD"
    rm -rf "${TMP:?}"
}
# appcfg_get KEY: the stored Knorke app config value, or <unset>.
appcfg_get() {
    local v
    if v="$(docker exec -u www-data "$NC" php occ config:app:get knorke "$1" 2>/dev/null)"; then printf '%s' "$v"; else printf '<unset>'; fi
}
# appcfg_restore KEY VALUE: back to VALUE (<unset> = delete).
appcfg_restore() {
    if [ "$2" = '<unset>' ]; then
        docker exec -u www-data "$NC" php occ config:app:delete knorke "$1" >/dev/null 2>&1 || true
    else
        docker exec -u www-data "$NC" php occ config:app:set knorke "$1" --value="$2" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
docker exec -u www-data "$NC" php occ security:bruteforce:reset "$GW" >/dev/null

OK=0
FAIL=0
CODE=""
BODY="$TMP/body"
HDRS="$TMP/headers"

pass() { OK=$((OK + 1)); printf '  ok    %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FEHLER %s\n' "$1"; printf '         Status %s, Body: %s\n' "$CODE" "$(head -c 400 "$BODY" | tr '\n' ' ')"; }

# check NAME STATUS [JQ-FILTER]: last answer has STATUS and (optionally) the jq filter is true.
check() {
    local name="$1" status="$2" filter="${3:-}"
    if [ "$CODE" != "$status" ]; then
        fail "$name (erwartet $status)"
        return
    fi
    if [ -n "$filter" ] && ! jq -e "$filter" "$BODY" >/dev/null 2>&1; then
        fail "$name (Form: $filter)"
        return
    fi
    pass "$name"
}

# appError CODE: the app's error form with exactly this code and a message.
appError() { printf '(keys == ["error","message"]) and .error == "%s" and (.message | type == "string" and length > 0)' "$1"; }

# Session of an account: cookies + requesttoken (basic auth on every request).
declare -A TOKEN
login() {
    local u="$1"
    TOKEN[$u]="$(curl -s -m 30 -c "$TMP/jar-$u" -b "$TMP/jar-$u" -u "$u:$PASS" -H 'Host: localhost' "$BASE/csrftoken" | jq -r .token)"
    [ -n "${TOKEN[$u]}" ] && [ "${TOKEN[$u]}" != null ] || { echo "Login $u fehlgeschlagen" >&2; exit 1; }
}

# as USER METHOD URL [BODY-FILE|-] [extra curl args…]
as() {
    local u="$1" method="$2" url="$3" body="${4:-}"
    shift 4 || shift $#
    local args=(-s -m 60 -o "$BODY" -D "$HDRS" -w '%{http_code}' -X "$method" -H 'Host: localhost' -H 'Accept: application/json')
    if [ "$u" != anon ]; then
        args+=(-c "$TMP/jar-$u" -b "$TMP/jar-$u" -u "$u:$PASS" -H "requesttoken: ${TOKEN[$u]}" -H 'X-Requested-With: XMLHttpRequest')
    fi
    if [ -n "$body" ]; then
        args+=(-H 'Content-Type: application/json' --data-binary "@$body")
    fi
    CODE="$(curl "${args[@]}" "$@" "$url")"
}

# json TEXT: writes TEXT to a body file and prints its path; @EP@ becomes the
# board epoch (EP, from the first snapshot; protocol 2 requires `ep`).
N=0
EP=""
json() {
    N=$((N + 1))
    printf '%s' "${1//@EP@/$EP}" >"$TMP/req-$N.json"
    printf '%s' "$TMP/req-$N.json"
}

# jq: the server time of protocol 2 (SPEC-M1 §4.5) — a plausible epoch ms value.
NOW='(.now | type == "number" and . > 1700000000000 and . == floor)'

# Guest request: X-Requested-With, optional guest token.
guest() {
    local method="$1" url="$2" body="${3:-}" tok="${4:-}"
    shift 4 || shift $#
    local args=(-s -m 60 -o "$BODY" -D "$HDRS" -w '%{http_code}' -X "$method" -H 'Host: localhost' -H 'Accept: application/json' -H 'X-Requested-With: XMLHttpRequest')
    [ -n "$tok" ] && args+=(-H "X-Knorke-Guest: $tok")
    [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$body")
    CODE="$(curl "${args[@]}" "$@" "$url")"
}

# state KEY: initial state value (decoded JSON) from the last HTML body.
state() {
    grep -o "id=\"initial-state-knorke-$1\" value=\"[^\"]*\"" "$BODY" | sed 's/.*value="\([^"]*\)"/\1/' | base64 -d 2>/dev/null
}
check_state() {
    local name="$1" key="$2" want="$3" got
    got="$(state "$key")"
    if [ "$got" = "$want" ]; then pass "$name"; else fail "$name ($key = '$got', erwartet '$want')"; fi
}
# check_state_jq NAME KEY JQ-FILTER: the decoded state value satisfies the filter.
check_state_jq() {
    local name="$1" key="$2" filter="$3" got
    got="$(state "$key")"
    if printf '%s' "$got" | jq -e "$filter" >/dev/null 2>&1; then pass "$name"; else fail "$name ($key = '$got', erwartet $filter)"; fi
}
check_all_keys() {
    local k missing=""
    for k in page boardId joinToken linkToken linkState debug protocol limits legal linkInfo; do
        grep -q "id=\"initial-state-knorke-$k\"" "$BODY" || missing="$missing $k"
    done
    if [ -z "$missing" ]; then pass "$1: alle 10 Initial-State-Schlüssel"; else fail "$1: fehlt$missing"; fi
}
# check_no_manifest NAME: the last HTML body links no web app manifest (job 131).
check_no_manifest() {
    if grep -qi 'rel="manifest"' "$BODY"; then fail "$1: Gastseite verlinkt ein Web-App-Manifest"; else pass "$1: Gastseite ohne Web-App-Manifest"; fi
}

# Distributed cache off/on in the namespace's own Nextcloud container (see header).
nodist_on() {
    docker exec -i -u www-data "$NC" sh -c "cat > '$NODIST'" <<'PHP'
<?php
// Written by knorke tests/php/smoke.sh for one block, removed again by it.
$CONFIG = ['memcache.distributed' => 'OC\Memcache\NullCache'];
PHP
}
nodist_off() { docker exec -u www-data "$NC" rm -f "$NODIST"; }

# occ_config_wait: Nextcloud 34 keeps app config in APCu for 3 s
# (AppConfig::LOCAL_CACHE_TTL), and occ clears only the CLI's copy — the web
# server sees a change made with occ after at most 3 s.
occ_config_wait() { sleep 4; }

# Nextcloud's ILimiter state (routes 20/21 budgets) in this namespace's Redis.
# Key names contain backslashes: read line by line, never through xargs.
ratelimit_reset() {
    docker exec "$REDIS" sh -c "redis-cli --scan --pattern '*RateLimiting*MemoryCacheBackend*' | while IFS= read -r k; do redis-cli DEL \"\$k\" >/dev/null; done"
}

# today_in ZONE: the calendar day of "now" in ZONE, computed by PHP in this
# namespace's container (the host may lack time zone data).
today_in() { docker exec "$NC" php -r 'echo (new DateTimeImmutable("now", new DateTimeZone($argv[1])))->format("Y-m-d");' "$1"; }

# Lets a link of THIS namespace expire a moment ago, through Nextcloud's own
# database connection inside its container (any KD_DB kind): expires_at =
# now − 1 ms. Generations are not touched (the token stays valid as such).
link_expire_now() {
    docker exec -u www-data -e KT_TOKEN="$1" "$NC" php -r '
        require "/var/www/html/lib/base.php";
        $n = \OCP\Server::get(\OCP\IDBConnection::class)->executeStatement(
            "UPDATE *PREFIX*knorke_links SET expires_at = ? WHERE token = ?",
            [(int)floor(microtime(true) * 1000) - 1, getenv("KT_TOKEN")]);
        exit($n === 1 ? 0 : 1);' >/dev/null
}

# vote-expire (SPEC-M1 §8.4, R16) in this namespace: ends_at of the open
# voting session of board $1 = now − 1 ms; meta, rev and meta_rev stay.
vote_expire_now() {
    docker exec -u www-data -e KT_BOARD="$1" "$NC" php -r '
        require "/var/www/html/lib/base.php";
        $n = \OCP\Server::get(\OCP\IDBConnection::class)->executeStatement(
            "UPDATE *PREFIX*knorke_vote_sessions SET ends_at = ? WHERE board_id = ? AND state = ?",
            [(int)floor(microtime(true) * 1000) - 1, (int)getenv("KT_BOARD"), "open"]);
        exit($n === 1 ? 0 : 1);' >/dev/null
}

# Deletes a:<board> in this namespace's Redis: the next request reads the
# board row (and Nextcloud's link policy) again instead of the cached gens.
gens_del() {
    docker exec "$REDIS" sh -c "redis-cli --scan --pattern '*/knorke/*/a:$1' | xargs -r redis-cli DEL >/dev/null"
}

# 4-byte UTF-8: stored as sent, except on MySQL/MariaDB with mysql.utf8mb4 =
# false (utf8mb3 tables), where the server stores U+FFFD (review NC-3).
DBTYPE="$(docker exec -u www-data "$NC" php occ config:system:get dbtype)"
UTF8MB4="$(docker exec -u www-data "$NC" php occ config:system:get mysql.utf8mb4 2>/dev/null || true)"
EMOJI_STORED='👍'
if [ "$DBTYPE" = mysql ] && [ "$UTF8MB4" != true ]; then EMOJI_STORED='\ufffd'; fi

ULID_A="01JSM0KE000000000000000001"
ULID_B="01JSM0KE000000000000000002"
UNKNOWN="Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9"

echo "Smoke gegen $BASE (KD_NS=$NS)"
login alice
login bob

echo "— Nextcloud vor der App"
as anon GET "$APP/api/v1/boards"
check "C01 GET boards ohne Login → 401 {message} von Nextcloud" 401 '(has("message")) and (has("error") | not)'
as anon POST "$APP/api/v1/boards/1/sync" "$(json '{"proto":2,"ep":"x","client":"c1","since":0}')"
check "C01 sync ohne Login → 401 {message}" 401 '(has("message")) and (has("error") | not)'

echo "— Seiten (1–3)"
as alice GET "$APP/"
check "1 GET / → 200" 200
check_all_keys "1"
check_state "1 page = user" page '"user"'
check_state "1 limits (SPEC-M1 §4.8: + maxItems, maxLabel)" limits '{"maxText":6000,"maxTitle":200,"maxOps":200,"nameMax":40,"maxItemBytes":65536,"maxItems":5000,"maxLabel":200}'
check_state "1 protocol = 2" protocol '2'
check_state "1 linkInfo = null" linkInfo 'null'
check_state "1 legal = null (angemeldet)" legal 'null'

echo "— Board-API (5–8)"
as alice POST "$APP/api/v1/boards" "$(json '{"title":"  Smoke  "}')"
check "6 POST boards → 201 {board}" 201 '.board.title == "Smoke" and .board.role == "owner" and .board.source == "own" and .board.mod == true and .board.viaLink == false and .board.owner.uid == "alice" and .board.owner.name == "Alice Adler" and (.board.id | type == "number") and (.board.updatedAt | type == "number") and .board.linksAllowed == true'
BID="$(jq -r .board.id "$BODY")"
as alice POST "$APP/api/v1/boards" "$(json '{"title":"Second"}')"
check "6 zweites Board" 201
BID2="$(jq -r .board.id "$BODY")"
as alice POST "$APP/api/v1/boards" "$(json '{"title":"Retro 👍"}')"
check "6 U7 Emoji-Titel → 201, gespeicherter Titel in der Antwort ($DBTYPE, utf8mb4=${UTF8MB4:-?})" 201 ".board.title == \"Retro $EMOJI_STORED\""
BIDE="$(jq -r .board.id "$BODY")"
as alice DELETE "$APP/api/v1/boards/$BIDE"
check "8 Emoji-Board löschen" 200
as alice POST "$APP/api/v1/boards" "$(json '{"title":"   "}')"
check "6 leerer Titel → 400 title_required" 400 "$(appError title_required)"
as alice POST "$APP/api/v1/boards" "$(json '{"title":"x","foo":1}')"
check "6 unbekannter Schlüssel → 400 bad_request" 400 "$(appError bad_request)"
as alice POST "$APP/api/v1/boards" "$(json '{"title":')"
check "6 kaputtes JSON → 400 bad_request" 400 "$(appError bad_request)"
as alice POST "$APP/api/v1/boards" "$(json '{"title":"chunked"}')" -H 'Transfer-Encoding: chunked'
check "6 ohne Content-Length (chunked) → 411 length_required" 411 "$(appError length_required)"
head -c 1100000 /dev/zero | tr '\0' 'x' | sed 's/^/{"title":"/; s/$/"}/' >"$TMP/big.json"
as alice POST "$APP/api/v1/boards" "$TMP/big.json"
check "6 Body > 1 MiB → 413 too_large" 413 "$(appError too_large)"
as alice POST "$APP/api/v1/boards?debug=1" "$(json '{"title":"q"}')"
check "6 Query-Parameter zählt als unbekannter Schlüssel → 400" 400 "$(appError bad_request)"

as alice GET "$APP/api/v1/boards"
check "5 GET boards → {boards} neueste zuerst" 200 "(.boards | map(.id) | .[0:2]) == [$BID2, $BID]"

as alice PATCH "$APP/api/v1/boards/$BID" "$(json '{"title":"Smoke 2"}')"
# SPEC-M1 §15 (R4): the answer adds meta/metaRev of the meta write to the board
# object (additive). The board is new (rev 0), so the new rev is 1; the snapshot
# below confirms rev 1 = metaRev 1 independently.
check "7 PATCH → {board} + meta {} und metaRev = neuer rev (1)" 200 '(.board | keys_unsorted) == ["id","title","role","updatedAt","owner","viaLink","linksAllowed","source","mod","meta","metaRev"] and .board.source == "own" and .board.mod == true and .board.title == "Smoke 2" and .board.role == "owner" and .board.linksAllowed == true and .board.meta == {} and .board.metaRev == 1'
as alice PATCH "$APP/api/v1/boards/$BID" "$(json "{\"title\":\"x\",\"id\":$BID2}")"
check "7 Body-id überdeckt die Route → 400" 400 "$(appError bad_request)"
as bob PATCH "$APP/api/v1/boards/$BID" "$(json '{"title":"x"}')"
check "7 Fremder → 404 not_found (kein Besitz-Orakel)" 404 "$(appError not_found)"

as alice GET "$APP/b/$BID"
check "2 GET /b/{id} → 200" 200
check_state "2 boardId" boardId "$BID"
check_all_keys "2"

echo "— Link (9, 10, 4, 3, 11)"
as alice POST "$APP/api/v1/boards/$BID/link" "$(json '{"rotate":false}')"
check "9 POST link → {link} (Link-Form §4.4)" 200 '(.link | keys_unsorted) == ["token","role","url","password","expiresAt","expiresOn"] and (.link.token | test("^[A-Za-z0-9]{24}$")) and .link.role == "edit" and (.link.url | test("/apps/knorke/p/[A-Za-z0-9]{24}$")) and .link.password == false and .link.expiresAt == null and .link.expiresOn == null'
LINK="$(jq -r .link.token "$BODY")"
as alice POST "$APP/api/v1/boards/$BID/link" "$(json '{}')"
check "9 vorhandener Link wird geliefert" 200 ".link.token == \"$LINK\""
as bob POST "$APP/api/v1/boards/$BID/link" "$(json '{}')"
check "9 Fremder → 404" 404 "$(appError not_found)"

as anon GET "$APP/p/$LINK"
check "4 /p/{token} Gast → 200" 200
check_all_keys "4"
check_state "4 page = public" page '"public"'
check_state "4 linkState = ok" linkState '"ok"'
check_state "4 boardId" boardId "$BID"
check_state "4 linkToken" linkToken "\"$LINK\""
check_state_jq "4 linkInfo {role, password} (SPEC-M1 §4.11.3)" linkInfo '. == {"role":"edit","password":false}'
check_no_manifest "4"
if grep -qE '<link rel="apple-touch-icon" href="[^"]+">' "$BODY"; then pass "4 Gastseite behält <link rel=\"apple-touch-icon\">"; else fail "4 Gastseite ohne <link rel=\"apple-touch-icon\">"; fi
as alice GET "$APP/p/$LINK"
if [ "$CODE" = 303 ] && grep -qi "^location: .*/apps/knorke/join/$LINK" "$HDRS"; then pass "4 /p/{token} angemeldet → 303 auf page#join"; else fail "4 /p/{token} angemeldet → 303 (Status $CODE)"; fi
docker exec -u www-data "$NC" php occ config:app:set knorke public_template --value=base >/dev/null
occ_config_wait
as anon GET "$APP/p/$LINK"
check "4 public_template = base → 200" 200
check_state "4 (base) linkState = ok" linkState '"ok"'
# The base layout has no <header id="header">: the probe really sees RENDER_AS_BASE.
if grep -q '<header id="header"' "$BODY"; then fail "4 (base) noch die öffentliche Vorlage (<header id=\"header\">)"; else pass "4 (base) Vorlage base (ohne <header id=\"header\">)"; fi
check_no_manifest "4 (base)"
docker exec -u www-data "$NC" php occ config:app:delete knorke public_template >/dev/null
as alice GET "$APP/join/$LINK"
check "3 GET /join/{token} → 200" 200
check_state "3 joinToken" joinToken "\"$LINK\""

as bob POST "$APP/api/v1/links/$LINK/join" "$(json '{}')"
check "11 bob tritt bei → {boardId}" 200 ".boardId == $BID"
as bob POST "$APP/api/v1/links/$LINK/join" "$(json '{"x":1}')"
check "11 Body-Schlüssel nicht erlaubt → 400" 400 "$(appError bad_request)"
as bob GET "$APP/api/v1/boards"
check "5 bob sieht das Board via Link (source link, kein mod)" 200 "(.boards | map(select(.id == $BID)) | .[0] | .viaLink == true and .role == \"edit\" and .source == \"link\" and .mod == false)"
as bob PATCH "$APP/api/v1/boards/$BID" "$(json '{"title":"x"}')"
check "7 Mitglied → 403 forbidden" 403 "$(appError forbidden)"
as bob DELETE "$APP/api/v1/boards/$BID"
check "8 Mitglied löscht → 403 forbidden" 403 "$(appError forbidden)"

echo "— Snapshot und Sync (12, 13)"
as alice GET "$APP/api/v1/boards/$BID/snapshot"
check "12 Snapshot v2 (Besitzer): proto, epoch, now, meta, links, mod, source" 200 "(keys == [\"board\",\"epoch\",\"items\",\"me\",\"minRev\",\"now\",\"proto\",\"rev\",\"schema\"]) and .proto == 2 and (.epoch | test(\"^[a-z0-9]{6,16}$\")) and $NOW and .rev == 1 and .minRev == 0 and .schema == 1 and .board.id == $BID and .board.title == \"Smoke 2\" and .board.role == \"owner\" and .board.metaRev == 1 and .board.meta == {} and .board.links.edit.token == \"$LINK\" and .board.links.edit.role == \"edit\" and .board.links.vote == null and (.board | has(\"link\") | not) and .board.links.edit.password == false and .board.links.edit.expiresOn == null and .board.linksAllowed == true and .board.linkPolicy == {\"passwordEnforced\":false,\"expireDefaultDays\":null,\"expireEnforced\":false,\"expireMaxDays\":null} and .me.role == \"owner\" and .me.guest == false and .me.mod == true and .me.source == \"own\" and (.me.pid | test(\"^[0-9a-f]{16}$\")) and .items == []"
EP="$(jq -r .epoch "$BODY")"
[[ "$EP" =~ ^[a-z0-9]{1,16}$ ]] || { echo "keine Epoche im Snapshot ('$EP')" >&2; exit 1; }
as bob GET "$APP/api/v1/boards/$BID/snapshot"
check "12 Snapshot (Link-Mitglied): keine links, mod false, source link" 200 '.board.role == "edit" and (.board | has("links") | not) and (.board | has("link") | not) and (.board | has("linksAllowed") | not) and .board.metaRev == 1 and .me.mod == false and .me.source == "link"'
as alice GET "$APP/api/v1/boards/999999999/snapshot"
check "12 unbekanntes Board → 404" 404 "$(appError not_found)"

SYNC="$APP/api/v1/boards/$BID/sync"
as alice POST "$SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":0,\"seq\":1,\"ops\":[{\"o\":\"put\",\"id\":\"$ULID_A\",\"t\":\"sticky\",\"p\":{\"x\":10.5,\"y\":20,\"w\":200,\"h\":200,\"r\":0,\"z\":\"i0\",\"parent\":null,\"data\":{\"text\":\"Hallo\"},\"style\":{\"fill\":\"#A8D8F8\"}}},{\"o\":\"put\",\"id\":\"$ULID_B\",\"t\":\"pen\",\"p\":{\"z\":\"i1\"}}],\"me\":{\"c\":[1,2],\"s\":[\"$ULID_A\"]},\"pres\":1}")"
check "13 Sync mit Ops → now, board (since < meta_rev), acks, items, presence {}" 200 "(keys_unsorted == [\"rev\",\"now\",\"board\",\"items\",\"acks\",\"presence\"]) and .rev == 2 and $NOW and .board == {\"title\":\"Smoke 2\",\"meta\":{},\"metaRev\":1} and .acks == {\"seq\":1,\"rev\":2,\"res\":[\"ok\",\"bad\"]} and (.items | length) == 1 and .items[0].style.fill == \"#a8d8f8\" and .items[0].x == 10.5 and .presence == {}"
SB="$(json '{"title":"Emoji-Sync"}')"
as alice POST "$APP/api/v1/boards" "$SB"
BIDS="$(jq -r .board.id "$BODY")"
as alice POST "$APP/api/v1/boards/$BIDS/sync" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeE\",\"since\":0,\"seq\":1,\"ops\":[{\"o\":\"put\",\"id\":\"$ULID_A\",\"t\":\"sticky\",\"p\":{\"z\":\"i0\",\"w\":200,\"h\":200,\"data\":{\"text\":\"great idea 👍\"}}},{\"o\":\"put\",\"id\":\"$ULID_B\",\"t\":\"sticky\",\"p\":{\"z\":\"i1\",\"w\":200,\"h\":200,\"data\":{\"text\":\"€ ü\"}}}],\"pres\":0}")"
check "13 U7 Emoji in data.text → 200, ganzer Batch ok, gespeicherter Text zurück" 200 "(has(\"board\") | not) and .acks.res == [\"ok\",\"ok\"] and (.items | map({(.id): .data.text}) | add) == {\"$ULID_A\":\"great idea $EMOJI_STORED\",\"$ULID_B\":\"€ ü\"}"
as alice DELETE "$APP/api/v1/boards/$BIDS"
check "8 Emoji-Sync-Board löschen" 200
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":2,"pres":1}')"
check "13 C19 leerer Sync → genau {rev, now, presence:{}}" 200 "(keys_unsorted == [\"rev\",\"now\",\"presence\"]) and del(.now) == {\"rev\":2,\"presence\":{}} and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":2,"pres":0}')"
check "13 leerer Sync pres=0 → genau {rev, now}" 200 "(keys_unsorted == [\"rev\",\"now\"]) and .rev == 2 and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":2}')"
check "13 leerer Sync ohne pres (= 1) → genau {rev, now, presence:{}}" 200 "del(.now) == {\"rev\":2,\"presence\":{}} and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":1,"pres":0}')"
check "13 Cursor zwischen meta_rev und rev → Seite ohne board" 200 "(has(\"board\") | not) and .rev == 2 and (.items | length) == 1 and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"zz9zz9zz","client":"cSmokeA","since":2,"pres":0}')"
check "13 fremde Epoche → genau {rev, now, resync:true} (§5.4)" 200 "del(.now) == {\"rev\":2,\"resync\":true} and $NOW"
as bob POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeB","since":2,"pres":1}')"
check "13 bob sieht alices Präsenz" 200 '(.presence | to_entries | length) == 1 and (.presence | to_entries[0].value | .n == "Alice Adler" and .g == 0 and .x == 1.0 and .h == 0)'
as alice POST "$SYNC" "$(json '{"proto":1,"client":"cSmokeA","since":1}')"
check "13 C04 proto 1 (M0-Tab ohne ep) → 409 protocol mit proto 2" 409 '(keys == ["error","message","proto"]) and .error == "protocol" and .proto == 2 and (.message | type == "string" and length > 0)'
as alice POST "$SYNC" "$(json '{"proto":3,"ep":"@EP@","client":"cSmokeA","since":1}')"
check "13 proto 3 → 409 protocol mit proto 2" 409 '.error == "protocol" and .proto == 2'
as alice POST "$SYNC" "$(json '{"proto":2,"client":"cSmokeA","since":1}')"
check "13 proto 2 ohne ep → 400 bad_request" 400 "$(appError bad_request)"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":2,"role":"admin"}')"
check "13 unbekannte role → 400 bad_request" 400 "$(appError bad_request)"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":2,"role":"owner","vt":0,"pres":0}')"
check "13 role = eigene Zugangsstufe und vt → ohne me, ohne votes (keine offene Sitzung)" 200 "(keys_unsorted == [\"rev\",\"now\"]) and .rev == 2"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":2,"role":"edit","pres":0}')"
check "13 role weicht ab → me {role: owner, mod: true} (Fastpath)" 200 "(keys_unsorted == [\"rev\",\"now\",\"me\"]) and .me == {\"role\":\"owner\",\"mod\":true}"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":1,"foo":1}')"
check "13 unbekannter Schlüssel → 400" 400 "$(appError bad_request)"
as alice POST "$SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":1,\"id\":$BID2}")"
check "13 Body-id ≠ Route → 400" 400 "$(appError bad_request)"
OPS201="$(printf '{"o":"remove","id":"%s"},' $(seq 1 201 | sed "s/.*/$ULID_A/") | sed 's/,$//')"
as alice POST "$SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":1,\"seq\":2,\"ops\":[$OPS201]}")"
check "13 201 Ops → 400 too_many_ops" 400 "$(appError too_many_ops)"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":1}')" -H 'Transfer-Encoding: chunked'
check "13 ohne Content-Length → 411" 411 "$(appError length_required)"
head -c 1100000 /dev/zero | tr '\0' 'x' | sed 's/^/{"proto":2,"ep":"@EP@","client":"c","since":0,"me":{"x":"/; s/$/"}}/' >"$TMP/bigsync.json"
as alice POST "$SYNC" "$TMP/bigsync.json"
check "13 Body > 1 MiB → 413" 413 "$(appError too_large)"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":0,"pres":0}')" -H 'Accept-Encoding: gzip'
if [ "$CODE" = 200 ] && grep -qi '^content-encoding: gzip' "$HDRS" && gzip -dc "$BODY" | jq -e '.items | length == 1' >/dev/null; then pass "13 C29 gzip über die Middleware"; else fail "13 C29 gzip (Status $CODE)"; fi
as alice POST "$APP/api/v1/boards/999999999/sync" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":0}')"
check "13 unbekanntes Board → 404" 404 "$(appError not_found)"

echo "— Gäste (14–16)"
JOIN="$APP/pub/v1/$LINK/join"
CODE="$(curl -s -m 30 -o "$BODY" -w '%{http_code}' -X POST -H 'Host: localhost' -H 'Content-Type: application/json' --data-binary '{"client":"cG","name":"Gina"}' "$JOIN")"
check "14 C02 ohne X-Requested-With → 403 cross_site" 403 "$(appError cross_site)"
CODE="$(curl -s -m 30 -o "$BODY" -w '%{http_code}' -X POST -H 'Host: localhost' -H 'Sec-Fetch-Site: same-origin' -H 'Content-Type: application/json' --data-binary '{"client":"cG","name":"   "}' "$JOIN")"
check "14 Sec-Fetch-Site same-origin genügt; leerer Name → 400 name_required" 400 "$(appError name_required)"
guest POST "$JOIN" "$(json "{\"client\":\"cG\",\"name\":\"Gina\",\"token\":\"$UNKNOWN\"}")"
check "14 C38 anderer token im Body → 400" 400 "$(appError bad_request)"
guest POST "$JOIN" "$(json '{"client":"cG","name":"Gina","_route":"x"}')"
check "14 _route im Body → 400" 400 "$(appError bad_request)"
guest POST "$JOIN" "$(json '{"client":"cG","name":"  Gina  ","guest":null}')"
check "14 Beitritt → Snapshot v2 + guest" 200 ".proto == 2 and .epoch == \"$EP\" and $NOW and .board.id == $BID and .board.role == \"edit\" and .board.title == \"Smoke 2\" and .board.metaRev == 1 and .board.meta == {} and (.board | has(\"links\") | not) and (.board | has(\"link\") | not) and (.board | has(\"linksAllowed\") | not) and .me.name == \"Gina\" and .me.guest == true and .me.role == \"edit\" and .me.mod == false and .me.source == \"guest\" and (.guest.token | type == \"string\") and (.guest.exp | type == \"number\") and (.items | length) == 1 and .rev == 2"
GTOK="$(jq -r .guest.token "$BODY")"
GPID="$(jq -r .me.pid "$BODY")"
guest POST "$JOIN" "$(json "{\"client\":\"cG\",\"name\":\"Gina\",\"guest\":\"$GTOK\"}")"
check "14 Neu-Beitritt mit Token → gleiche pid" 200 ".me.pid == \"$GPID\""
guest POST "$APP/pub/v1/$UNKNOWN/join" "$(json '{"client":"cG","name":"Gina"}')"
check "14 nie ausgestellter Token → 404" 404 "$(appError not_found)"

guest GET "$APP/pub/v1/boards/$BID/snapshot" "" "$GTOK"
check "15 Gast-Snapshot" 200 ".me.pid == \"$GPID\" and .me.guest == true and .me.source == \"guest\" and .epoch == \"$EP\" and $NOW and (.board | has(\"links\") | not) and (.items | length) == 1"
guest GET "$APP/pub/v1/boards/$BID/snapshot" "" "x.y"
check "15 C03 gefälschtes Token → 401 guest_token" 401 "$(appError guest_token)"
guest GET "$APP/pub/v1/boards/$BID2/snapshot" "" "$GTOK"
check "15 C03b Token von A gegen B → 401 guest_token" 401 "$(appError guest_token)"

GSYNC="$APP/pub/v1/boards/$BID/sync"
guest POST "$GSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cG\",\"since\":2,\"seq\":1,\"ops\":[{\"o\":\"patch\",\"id\":\"$ULID_A\",\"p\":{\"data.text\":\"von Gina\"}}],\"me\":{\"c\":[5,6]},\"pres\":1}")" "$GTOK"
check "16 Gast-Sync mit Ops" 200 ".rev == 3 and $NOW and (has(\"board\") | not) and .acks.res == [\"ok\"] and .items[0].data.text == \"von Gina\""
guest POST "$APP/pub/v1/boards/$BID2/sync" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":0}')" "$GTOK"
check "16 C03b Sync gegen B → 401 guest_token" 401 "$(appError guest_token)"
CODE="$(curl -s -m 30 -o "$BODY" -w '%{http_code}' -X POST -H 'Host: localhost' -H "X-Knorke-Guest: $GTOK" -H 'Content-Type: application/json' --data-binary '{"proto":2,"ep":"@EP@","client":"cG","since":0}' "$GSYNC")"
check "16 Gast-Sync ohne X-Requested-With → 403 cross_site" 403 "$(appError cross_site)"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":3,"pres":1}')"
check "13 Gast in der Präsenz: g = 1, Name, keine uid" 200 "(.presence | to_entries | map(select(.value.g == 1)) | .[0].value | .n == \"Gina\" and .k == \"$GPID\")"

echo "— Ohne Redis (§5.1, §5.4, §10.2: SQL-Pfad, presence {} bei pres=1)"
# Gina's entry is fresh in Redis right before the switch: with the cache
# still in use, alice would see her. {} therefore proves both halves: the key
# is there, and nothing came from Redis.
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":3,"me":{"c":[7,8]},"pres":0}')" "$GTOK"
check "16 Gast frischt die Präsenz auf (Redis an)" 200 "del(.now) == {\"rev\":3} and $NOW"
nodist_on
MC_DIST="$(docker exec -u www-data "$NC" php occ config:system:get memcache.distributed 2>/dev/null || true)"
if [ "$MC_DIST" = 'OC\Memcache\NullCache' ]; then
    pass "Redis aus: memcache.distributed = NullCache"
else
    fail "Redis aus: memcache.distributed = '$MC_DIST', erwartet NullCache"
fi
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":3,"pres":1}')"
check "13 ohne Redis: leerer Sync → genau {rev, now, presence:{}} (Gina nicht aus Redis)" 200 "del(.now) == {\"rev\":3,\"presence\":{}} and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":3}')"
check "13 ohne Redis: ohne pres (= 1) → genau {rev, now, presence:{}}" 200 "del(.now) == {\"rev\":3,\"presence\":{}} and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":3,"pres":0}')"
check "13 ohne Redis: pres=0 → genau {rev, now}" 200 "del(.now) == {\"rev\":3} and $NOW"
as bob POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeB","since":3,"me":{"c":[3,4]},"pres":1}')"
check "13 ohne Redis: Link-Mitglied mit me → genau {rev, now, presence:{}}" 200 "del(.now) == {\"rev\":3,\"presence\":{}} and $NOW"
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":3,"pres":1}')" "$GTOK"
check "16 ohne Redis: Gast-Sync → genau {rev, now, presence:{}}" 200 "del(.now) == {\"rev\":3,\"presence\":{}} and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":0,"pres":0}')"
check "13 ohne Redis: board aus der DB (since < meta_rev)" 200 ".board.title == \"Smoke 2\" and .board.metaRev == 1 and .rev == 3"
as alice POST "$SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":3,\"seq\":3,\"ops\":[{\"o\":\"patch\",\"id\":\"$ULID_A\",\"p\":{\"data.text\":\"ohne Redis\"}}],\"me\":{\"e\":\"$ULID_A\"},\"pres\":1}")"
check "13 ohne Redis: Sync mit Ops → acks, items, presence {}" 200 ".rev == 4 and $NOW and .acks == {\"seq\":3,\"rev\":4,\"res\":[\"ok\"]} and (.items | length) == 1 and .items[0].data.text == \"ohne Redis\" and .presence == {} and (has(\"resync\") | not) and (has(\"board\") | not)"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":9,"pres":1}')"
check "13 ohne Redis: Cursor aus der Zukunft → genau {rev, now, presence:{}, resync}" 200 "del(.now) == {\"rev\":4,\"presence\":{},\"resync\":true} and $NOW"
nodist_off
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":4,"pres":0}')"
check "13 Redis wieder an: r: hinkt, DB heilt → genau {rev:4, now}" 200 "del(.now) == {\"rev\":4} and $NOW"
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":4,"me":{"c":[9,9]},"pres":0}')" "$GTOK"
check "16 Redis wieder an: Gast schreibt Präsenz" 200 "del(.now) == {\"rev\":4} and $NOW"
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":4,"pres":1}')"
check "13 Redis wieder an: Gina wieder in der Präsenz" 200 "(.presence | to_entries | map(select(.value.k == \"$GPID\")) | .[0].value | .x == 9.0 and .g == 1)"

echo "— Link-Richtlinie von Nextcloud (U11: shareapi_allow_links des Besitzers)"
docker exec -u www-data "$NC" php occ config:app:set core shareapi_allow_links --value=no >/dev/null
occ_config_wait
gens_del "$BID"
as alice POST "$APP/api/v1/boards/$BID/link" "$(json '{"rotate":false}')"
check "9 Links verboten → 403 links_disabled" 403 "$(appError links_disabled)"
as alice POST "$APP/api/v1/boards/$BID/link" "$(json '{"rotate":true}')"
check "9 Erneuern verboten → 403 links_disabled" 403 "$(appError links_disabled)"
as alice GET "$APP/api/v1/boards/$BID/snapshot"
check "12 Besitzer-Snapshot: linksAllowed false, Link bleibt sichtbar (board.links.edit)" 200 ".board.linksAllowed == false and .board.links.edit.token == \"$LINK\""
as alice GET "$APP/api/v1/boards"
check "5 Board-Liste: linksAllowed false" 200 "(.boards | map(select(.id == $BID)) | .[0].linksAllowed) == false"
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":4,"pres":0}')" "$GTOK"
check "16 Gast-Sync → 403 links_disabled" 403 "$(appError links_disabled)"
guest GET "$APP/pub/v1/boards/$BID/snapshot" "" "$GTOK"
check "15 Gast-Snapshot → 403 links_disabled" 403 "$(appError links_disabled)"
guest POST "$JOIN" "$(json "{\"client\":\"cG\",\"name\":\"Gina\",\"guest\":\"$GTOK\"}")"
check "14 Gast-Beitritt → 403 links_disabled" 403 "$(appError links_disabled)"
as bob GET "$APP/api/v1/boards/$BID/snapshot"
check "12 Link-Mitglied → 404 (wie Link aus)" 404 "$(appError not_found)"
as bob POST "$APP/api/v1/links/$LINK/join" "$(json '{}')"
check "11 angemeldeter Beitritt → 403 links_disabled" 403 "$(appError links_disabled)"
as bob GET "$APP/api/v1/boards"
check "5 bob sieht das Board nicht mehr" 200 "(.boards | map(select(.id == $BID)) | length) == 0"
as alice POST "$APP/api/v1/links/$LINK/join" "$(json '{}')"
check "11 Besitzer über den eigenen Link → sein Board" 200 ".boardId == $BID"
docker exec -u www-data "$NC" php occ config:app:delete core shareapi_allow_links >/dev/null
occ_config_wait
gens_del "$BID"
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":4,"pres":0}')" "$GTOK"
check "16 Links wieder erlaubt → altes Gast-Token gilt wieder" 200 "del(.now) == {\"rev\":4} and $NOW"
as bob GET "$APP/api/v1/boards/$BID/snapshot"
check "12 Link-Mitglied wieder drin" 200 '.board.role == "edit"'
as alice POST "$APP/api/v1/boards/$BID/link" "$(json '{}')"
check "9 derselbe Link (nichts widerrufen)" 200 ".link.token == \"$LINK\""

echo "— Live-Titel (SPEC-M1 §4.13.4, §4.13.8: board bei since < meta_rev)"
as alice PATCH "$APP/api/v1/boards/$BID" "$(json '{"title":"Live 👍"}')"
check "7 Umbenennen → {board} mit meta {} und metaRev = neuer rev (5, Sync darunter bestätigt)" 200 ".board.title == \"Live $EMOJI_STORED\" and .board.meta == {} and .board.metaRev == 5 and .board.id == $BID"
as bob POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeB","since":4,"pres":0}')"
check "13 Link-Mitglied bekommt den neuen Titel im nächsten Takt" 200 "(keys_unsorted == [\"rev\",\"now\",\"board\"]) and .rev == 5 and .board == {\"title\":\"Live $EMOJI_STORED\",\"meta\":{},\"metaRev\":5} and $NOW"
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":4,"pres":0}')" "$GTOK"
check "16 Gast bekommt den neuen Titel" 200 ".rev == 5 and .board.title == \"Live $EMOJI_STORED\" and .board.metaRev == 5"
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":5,"pres":0}')" "$GTOK"
check "16 Cursor = meta_rev → Fastpath ohne board" 200 "del(.now) == {\"rev\":5} and $NOW"
as alice GET "$APP/api/v1/boards/$BID/snapshot"
check "12 Snapshot mit neuem Titel und metaRev" 200 ".rev == 5 and .board.title == \"Live $EMOJI_STORED\" and .board.metaRev == 5"

echo "— Formen, Text, Verbinder, keep (SPEC-M1 Stufe 1: §3.10, §4.7 Regeln 12–15, 18, 19, §4.8)"
as alice POST "$APP/api/v1/boards" "$(json '{"title":"Stufe 1"}')"
check "6 Board für Stufe 1" 201
BID1="$(jq -r .board.id "$BODY")"
S1SYNC="$APP/api/v1/boards/$BID1/sync"
U1="01JSM1000000000000000000"
S1="${U1}01"; SH="${U1}02"; TX="${U1}08"; FR="${U1}09"; CH="${U1}10"; K1="${U1}11"; K2="${U1}17"
SHAPE_OPS=""
n=2
for kind in ellipse rect roundRect diamond triangle arrowRight; do
    SHAPE_OPS="$SHAPE_OPS{\"o\":\"put\",\"id\":\"${U1}0$n\",\"t\":\"shape\",\"p\":{\"x\":$((400 * (n - 1))),\"y\":0,\"w\":200,\"h\":120,\"z\":\"i1\",\"data\":{\"kind\":\"$kind\",\"text\":\"$kind\"},\"style\":{\"fill\":\"#FFFFFF\",\"fillOpacity\":40,\"dash\":\"dotted\",\"valign\":\"bottom\"}}},"
    n=$((n + 1))
done
as alice POST "$S1SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke1\",\"since\":0,\"seq\":1,\"pres\":0,\"ops\":[
{\"o\":\"put\",\"id\":\"$S1\",\"t\":\"sticky\",\"p\":{\"x\":0,\"y\":0,\"w\":200,\"h\":200,\"z\":\"i0\",\"data\":{\"text\":\"A\"}}},
$SHAPE_OPS
{\"o\":\"put\",\"id\":\"$TX\",\"t\":\"text\",\"p\":{\"x\":0,\"y\":300,\"w\":240,\"h\":31.2,\"z\":\"i2\",\"data\":{\"text\":\"T\"},\"style\":{\"fontSize\":24,\"color\":\"#1A1A1A\",\"align\":\"left\"}}},
{\"o\":\"put\",\"id\":\"$FR\",\"t\":\"frame\",\"p\":{\"x\":3000,\"y\":0,\"w\":800,\"h\":600,\"z\":\"hz\",\"data\":{\"title\":\"F\"}}},
{\"o\":\"put\",\"id\":\"$CH\",\"t\":\"sticky\",\"p\":{\"x\":10,\"y\":20,\"w\":200,\"h\":200,\"z\":\"i3\",\"parent\":\"$FR\"}},
{\"o\":\"put\",\"id\":\"$K1\",\"t\":\"connector\",\"p\":{\"z\":\"i4\",\"data\":{\"start\":{\"item\":\"$S1\",\"ax\":0.123456,\"ay\":1},\"end\":{\"item\":\"$SH\"},\"route\":\"elbow\"},\"style\":{\"endCap\":\"arrow\",\"strokeWidth\":2}}},
{\"o\":\"put\",\"id\":\"${U1}12\",\"t\":\"shape\",\"p\":{\"w\":200,\"h\":120,\"z\":\"i5\",\"data\":{\"kind\":\"star\"}}},
{\"o\":\"put\",\"id\":\"${U1}13\",\"t\":\"shape\",\"p\":{\"w\":200,\"h\":120,\"z\":\"i5\",\"style\":{\"fillOpacity\":101}}},
{\"o\":\"put\",\"id\":\"${U1}14\",\"t\":\"connector\",\"p\":{\"x\":5,\"z\":\"i5\",\"data\":{\"start\":{\"item\":\"$S1\"},\"end\":{\"item\":\"$SH\"}}}},
{\"o\":\"put\",\"id\":\"${U1}15\",\"t\":\"connector\",\"p\":{\"z\":\"i5\",\"data\":{\"start\":{\"item\":\"$S1\"}}}},
{\"o\":\"put\",\"id\":\"${U1}16\",\"t\":\"connector\",\"p\":{\"z\":\"i5\",\"data\":{\"start\":{\"item\":\"$S1\"},\"end\":{\"item\":\"$FR\"}}}},
{\"o\":\"put\",\"id\":\"$K2\",\"t\":\"connector\",\"p\":{\"z\":\"i5\",\"data\":{\"start\":{\"item\":\"$K2\"},\"end\":{\"x\":1,\"y\":2}}}},
{\"o\":\"put\",\"id\":\"${U1}18\",\"t\":\"pen\",\"p\":{\"w\":10,\"h\":10,\"z\":\"i5\"}}]}")"
check "13 C53/C55 sechs Formarten, Text, Rahmen, Verbinder ok; star, fillOpacity 101, x:5, ohne Ende, Ende am Frame, an sich selbst, pen → bad" 200 \
    ".rev == 1 and .acks.res == ([range(11)] | map(\"ok\")) + ([range(7)] | map(\"bad\")) and (.items | length) == 11"
check "13 Form normalisiert (Farbe klein), Verbinder ohne Lage, ax/ay mit q(v, 10000)" 200 \
    "(.items | map(select(.id == \"$SH\"))[0] | .t == \"shape\" and .data.kind == \"ellipse\" and .style.fill == \"#ffffff\" and .style.fillOpacity == 40) and (.items | map(select(.id == \"$K1\"))[0] | .t == \"connector\" and .x == 0 and .y == 0 and .w == 0 and .h == 0 and .r == 0 and .parent == null and .data.start == {\"item\":\"$S1\",\"ax\":0.1235,\"ay\":1} and .data.end == {\"item\":\"$SH\"}) and (.items | map(select(.id == \"$TX\"))[0] | .t == \"text\" and .h == 31.2 and .style.color == \"#1a1a1a\")"
as alice POST "$S1SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke1\",\"since\":1,\"seq\":2,\"pres\":0,\"ops\":[
{\"o\":\"patch\",\"id\":\"$K1\",\"p\":{\"data.start.item\":\"$TX\"}},
{\"o\":\"patch\",\"id\":\"$K1\",\"p\":{\"x\":0,\"y\":0,\"parent\":null}},
{\"o\":\"patch\",\"id\":\"$TX\",\"p\":{\"data.text\":\"T\\nT\",\"h\":62.4}},
{\"o\":\"patch\",\"id\":\"$SH\",\"p\":{\"style.dash\":\"wavy\"}},
{\"o\":\"patch\",\"id\":\"$K1\",\"p\":{\"data.label\":\"ja\",\"data.end\":{\"item\":\"$SH\",\"ax\":1,\"ay\":0.5}}}]}")"
check "13 C54/C55/C57 Unterpfad data.start.item → bad, Lage am Verbinder → bad, {data.text, h} ok, dash wavy → bad, Ende umhängen ok" 200 \
    ".rev == 2 and .acks.res == [\"bad\",\"bad\",\"ok\",\"bad\",\"ok\"] and (.items | map(select(.id == \"$TX\"))[0].h == 62.4) and (.items | map(select(.id == \"$K1\"))[0].data | .label == \"ja\" and .end == {\"item\":\"$SH\",\"ax\":1,\"ay\":0.5})"
as alice POST "$S1SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke1\",\"since\":2,\"seq\":3,\"pres\":0,\"ops\":[{\"o\":\"remove\",\"id\":\"$SH\"}]}")"
check "13 C56 Ziel entfernen → das Ende wird freier Punkt am Ankerpunkt (600, 60), gleicher rev" 200 \
    ".rev == 3 and .acks.res == [\"ok\"] and .removed == [\"$SH\"] and (.items | length) == 1 and .items[0].id == \"$K1\" and .items[0].data.end == {\"x\":600,\"y\":60} and .items[0].data.start.item == \"$S1\""
as alice POST "$S1SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke1\",\"since\":3,\"seq\":4,\"pres\":0,\"ops\":[{\"o\":\"put\",\"id\":\"${U1}19\",\"t\":\"connector\",\"p\":{\"z\":\"i6\",\"data\":{\"start\":{\"item\":\"$SH\",\"ax\":0,\"ay\":0},\"end\":{\"item\":\"$S1\"}}}}]}")"
check "13 C55 Ende an einem Grabstein → ok, freier Punkt (400, 0)" 200 \
    ".rev == 4 and .acks.res == [\"ok\"] and (.items[0].data | .start == {\"x\":400,\"y\":0} and .end == {\"item\":\"$S1\"})"
as alice POST "$S1SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke1\",\"since\":4,\"seq\":5,\"pres\":0,\"ops\":[{\"o\":\"patch\",\"id\":\"$FR\",\"keep\":true,\"p\":{\"x\":2900,\"y\":-50,\"parent\":null,\"w\":900,\"h\":650}}]}")"
check "13 C58 keep: Rahmen wächst nach oben links, das Kind bleibt stehen (x 110, y 70)" 200 \
    ".rev == 5 and .acks.res == [\"ok\"] and (.items | length) == 2 and (.items | map(select(.id == \"$CH\"))[0] | .x == 110 and .y == 70 and .parent == \"$FR\")"
as alice POST "$S1SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke1\",\"since\":5,\"seq\":6,\"pres\":0,\"ops\":[{\"o\":\"patch\",\"id\":\"$FR\",\"p\":{\"x\":3000,\"y\":0,\"parent\":null}},{\"o\":\"patch\",\"id\":\"$S1\",\"keep\":true,\"p\":{\"x\":5,\"y\":5,\"parent\":null}}]}")"
check "13 C58 ohne keep wandern die Kinder mit; keep auf einer Notiz wird ignoriert" 200 \
    ".rev == 6 and .acks.res == [\"ok\",\"ok\"] and (.items | map(.id) | sort) == ([\"$FR\",\"$S1\"] | sort)"
as alice GET "$APP/api/v1/boards/$BID1/snapshot"
check "12 Snapshot mit Formen, Text und Verbindern" 200 \
    ".rev == 6 and (.items | length) == 11 and (.items | map(.t) | unique) == [\"connector\",\"frame\",\"shape\",\"sticky\",\"text\"]"
as alice DELETE "$APP/api/v1/boards/$BID1"
check "8 Board für Stufe 1 löschen" 200

echo "— Freigaben, Rollen, Links je Rolle, Passwort und Ablauf (SPEC-M1 Stufe 2: §4.9–§4.11, Routen 17–21)"
# The ILimiter budgets of routes 20/21 live in this namespace's Redis across
# runs (SRV-07): start from zero, like the bridge action ratelimit-reset.
ratelimit_reset
login carol
as alice POST "$APP/api/v1/boards" "$(json '{"title":"Teilen"}')"
check "6 Board für Stufe 2" 201
BSH="$(jq -r .board.id "$BODY")"
SHARES="$APP/api/v1/boards/$BSH/shares"
NOLINKPOLICY='{"passwordEnforced":false,"expireDefaultDays":null,"expireEnforced":false,"expireMaxDays":null}'
# R14-04: linkPolicy.today = today in the OWNER's zone (stored zone, else
# default_timezone, else UTC). Expected day read before and after the request
# (a zone's midnight in between may give either).
docker exec -u www-data "$NC" php occ user:setting alice core timezone --delete >/dev/null 2>&1 || true
DEFZONE="$(docker exec -u www-data "$NC" php occ config:system:get default_timezone 2>/dev/null || true)"
DEFZONE="${DEFZONE:-UTC}"
T1="$(today_in "$DEFZONE")"
as alice GET "$SHARES"
T2="$(today_in "$DEFZONE")"
check "19 GET shares (Besitzer) → {shares, policy, links, linksAllowed, linkPolicy + today}" 200 "(keys_unsorted == [\"shares\",\"policy\",\"links\",\"linksAllowed\",\"linkPolicy\"]) and .shares == [] and .policy.sharing == true and .policy.groups == true and (.policy.teams | type == \"boolean\") and .policy.groupMembersOnly == false and .links == {\"edit\":null,\"vote\":null} and .linksAllowed == true and (.linkPolicy | del(.today)) == $NOLINKPOLICY and (.linkPolicy | keys_unsorted | last) == \"today\""
check "19 linkPolicy.today = heute in der Zone des Besitzers (ohne gespeicherte Zone: default_timezone $DEFZONE)" 200 "(.linkPolicy.today | test(\"^[0-9]{4}-[0-9]{2}-[0-9]{2}$\")) and (.linkPolicy.today == \"$T1\" or .linkPolicy.today == \"$T2\")"
docker exec -u www-data "$NC" php occ user:setting alice core timezone Pacific/Kiritimati >/dev/null
T1="$(today_in Pacific/Kiritimati)"
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"group","id":"knorke-e2e","role":"view"},{"kind":"user","id":"bob","role":"moderate"}]}')"
T2="$(today_in Pacific/Kiritimati)"
check "20 PUT shares → wie GET, Nutzer vor Gruppe" 200 '(keys_unsorted == ["shares","policy","links","linksAllowed","linkPolicy"]) and (.shares | map([.kind, .id, .role, .available])) == [["user","bob","moderate",true],["group","knorke-e2e","view",true]] and .shares[0].name == "Bob Berg"'
check "20 linkPolicy.today in der gespeicherten Zone des Besitzers (Pacific/Kiritimati, UTC+14)" 200 ".linkPolicy.today == \"$T1\" or .linkPolicy.today == \"$T2\""
docker exec -u www-data "$NC" php occ user:setting alice core timezone --delete >/dev/null
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"group","id":"knorke-e2e","role":"view"},{"kind":"user","id":"bob","role":"moderate"}]}')"
check "20 PUT idempotent" 200 '(.shares | length) == 2'
as bob GET "$APP/api/v1/boards/$BSH/snapshot"
check "12 Moderator (Freigabe moderate): role edit, mod, source share, links lesend ohne linksAllowed/linkPolicy" 200 '.board.role == "edit" and .me.role == "edit" and .me.mod == true and .me.source == "share" and .board.links == {"edit":null,"vote":null} and (.board | has("linksAllowed") | not) and (.board | has("linkPolicy") | not)'
as carol GET "$APP/api/v1/boards/$BSH/snapshot"
check "12 Gruppen-Freigabe view: role view, kein mod, keine links" 200 '.board.role == "view" and .me.mod == false and .me.source == "share" and (.board | has("links") | not)'
as alice GET "$APP/api/v1/boards/$BSH/snapshot"
check "12 Besitzer-Snapshot: linkPolicy (ohne today, R14-04), links.edit/vote" 200 ".board.linkPolicy == $NOLINKPOLICY and (.board.linkPolicy | has(\"today\") | not) and .board.links == {\"edit\":null,\"vote\":null} and .board.linksAllowed == true"
as bob GET "$SHARES"
check "19 Moderator → nur {links}" 200 '. == {"links":{"edit":null,"vote":null}}'
as carol GET "$SHARES"
check "19 Mitglied ohne Moderation → 403 forbidden" 403 "$(appError forbidden)"
as bob GET "$APP/api/v1/boards/$BID2/shares"
check "19 Fremder → 404 (kein Besitz-Orakel)" 404 "$(appError not_found)"
as bob PUT "$SHARES" "$(json '{"shares":[]}')"
check "20 Moderator → 403 forbidden" 403 "$(appError forbidden)"
as bob GET "$APP/api/v1/boards/$BSH/sharees?q=ca"
check "21 Moderator → 403 forbidden" 403 "$(appError forbidden)"
as bob POST "$APP/api/v1/boards/$BSH/votelink" "$(json '{}')"
check "17 Moderator legt keinen Link an → 403" 403 "$(appError forbidden)"
as bob GET "$APP/api/v1/boards"
check "5 Board-Liste (bob): role edit, source share, mod" 200 "(.boards | map(select(.id == $BSH)) | .[0] | .role == \"edit\" and .source == \"share\" and .mod == true and .viaLink == false)"
as carol GET "$APP/api/v1/boards"
check "5 Board-Liste (carol über die Gruppe): role view, source share" 200 "(.boards | map(select(.id == $BSH)) | .[0] | .role == \"view\" and .source == \"share\" and .mod == false)"
SHSYNC="$APP/api/v1/boards/$BSH/sync"
as bob POST "$SHSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeB","since":0,"role":"edit","pres":0}')"
check "13 Zugangsstufe weicht ab → me {role, mod}" 200 '.me == {"role":"edit","mod":true}'
as bob POST "$SHSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeB","since":0,"role":"moderate","pres":0}')"
check "13 Zugangsstufe gleich → kein me" 200 '(has("me") | not)'
as carol POST "$SHSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeC\",\"since\":0,\"seq\":1,\"role\":\"view\",\"pres\":0,\"ops\":[{\"o\":\"put\",\"id\":\"$ULID_A\",\"t\":\"sticky\",\"p\":{\"z\":\"i0\",\"w\":200,\"h\":200}}]}")"
check "13 Rolle view → Op denied" 200 '.acks.res == ["denied"] and (has("me") | not)'
# PUT rules (§4.10.2, R13 order).
NOPE21="$(for i in $(seq 0 20); do printf '{"kind":"user","id":"knorke-nope-%s","role":"edit"},' "$i"; done | sed 's/,$//')"
as alice PUT "$SHARES" "$(json "{\"shares\":[$NOPE21]}")"
check "20 21 neue Einträge → 400 too_many_new_shares {at: 20, max: 20}" 400 '.error == "too_many_new_shares" and .at == 20 and .max == 20'
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"user","id":"bob","role":"moderate"},{"kind":"user","id":"knorke-nope-x","role":"edit"}]}')"
check "20 unbekannter Empfänger → 400 recipient_not_found {at}" 400 '.error == "recipient_not_found" and .at == 1'
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"user","id":"alice","role":"edit"}]}')"
check "20 an sich selbst → 400 self_share" 400 '.error == "self_share" and .at == 0'
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"user","id":"bob","role":"owner"}]}')"
check "20 unbekannte Rolle → 400 bad_request {at}" 400 '.error == "bad_request" and .at == 0'
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"user","id":"carol","role":"edit"},{"kind":"user","id":"carol","role":"view"}]}')"
check "20 doppelt → 400 bad_request {at: 1}" 400 '.error == "bad_request" and .at == 1'
MANY="$(for i in $(seq 0 200); do printf '{"kind":"user","id":"u%s","role":"edit"},' "$i"; done | sed 's/,$//')"
as alice PUT "$SHARES" "$(json "{\"shares\":[$MANY]}")"
check "20 201 Einträge → 400 too_many_shares {max: 200}" 400 '.error == "too_many_shares" and .max == 200'
as alice PUT "$SHARES" "$(json '{"shares":"x"}')"
check "20 shares keine Liste → 400" 400 "$(appError bad_request)"
as alice GET "$SHARES"
check "20 nichts gespeichert bei einem Fehler" 200 '(.shares | map(.id)) == ["bob","knorke-e2e"]'
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"user","id":"bob","role":"edit"}]}')"
check "20 herabstufen und Gruppe entfernen" 200 '(.shares | map([.id, .role])) == [["bob","edit"]]'
as bob POST "$SHSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeB","since":0,"role":"moderate","pres":0}')"
check "13 Herabstufung wirkt im nächsten Takt → me {role: edit, mod: false}" 200 '.me == {"role":"edit","mod":false}'
as carol GET "$APP/api/v1/boards/$BSH/snapshot"
check "12 Gruppen-Freigabe entfernt → 404" 404 "$(appError not_found)"
# Recipient search (§4.10.3).
as alice GET "$APP/api/v1/boards/$BSH/sharees?q=car"
check "21 Suche findet carol (sub), ohne den Besitzer" 200 '(.sharees | map(select(.kind == "user" and .id == "carol")) | length) == 1 and (.sharees | map(select(.id == "alice")) | length) == 0 and (.sharees | map(select(.kind == "user")) | all(.sub | type == "string")) and (.more | type == "boolean")'
as alice GET "$APP/api/v1/boards/$BSH/sharees?q=knorke-e"
check "21 Suche findet die Gruppe, keine Circle-Objekte" 200 '(.sharees | map(select(.kind == "group" and .id == "knorke-e2e")) | length) == 1 and (tostring | contains("\"circle\"") | not)'
as alice GET "$APP/api/v1/boards/$BSH/sharees?q=bo&shareType=7"
check "21 fremder Query-Parameter (shareType) → 400" 400 "$(appError bad_request)"

# Links per role (§4.11).
as alice POST "$APP/api/v1/boards/$BSH/votelink" "$(json '{}')"
check "17 POST votelink → Link-Form {token, role vote, url, password, expiresAt, expiresOn}" 200 '(.link | keys_unsorted) == ["token","role","url","password","expiresAt","expiresOn"] and .link.role == "vote" and .link.password == false and .link.expiresAt == null and .link.expiresOn == null and (.link.url | test("/apps/knorke/p/[A-Za-z0-9]{24}$"))'
VTOK="$(jq -r .link.token "$BODY")"
as alice POST "$APP/api/v1/boards/$BSH/link" "$(json '{}')"
check "9 Bearbeitungslink daneben" 200 ".link.role == \"edit\" and .link.token != \"$VTOK\""
ETOK="$(jq -r .link.token "$BODY")"
as alice POST "$APP/api/v1/boards/$BSH/votelink" "$(json '{"expiresAt":1760000000000}')"
check "17 expiresAt als ms-Zahl → 400 bad_request" 400 "$(appError bad_request)"
YESTERDAY="$(date -u -d '-1 day' +%F)"
DAY3="$(date -u -d '+3 days' +%F)"
as alice POST "$APP/api/v1/boards/$BSH/votelink" "$(json "{\"expiresAt\":\"$YESTERDAY\"}")"
check "17 Ablauf gestern → 400 expiry_past" 400 "$(appError expiry_past)"
as alice POST "$APP/api/v1/boards/$BSH/votelink" "$(json "{\"password\":\"Smoke-pw-1\",\"expiresAt\":\"$DAY3\"}")"
check "17 Passwort und Kalendertag → password true, expiresOn = Tag (Zone des Besitzers)" 200 ".link.token == \"$VTOK\" and .link.password == true and .link.expiresOn == \"$DAY3\" and (.link.expiresAt % 1000) == 999"
VEXP="$(jq -r .link.expiresAt "$BODY")"
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"user","id":"bob","role":"moderate"}]}')"
check "20 bob wieder Moderator (Hochstufen)" 200 '(.shares | map([.id, .role])) == [["bob","moderate"]]'
as bob GET "$SHARES"
check "19 Moderator sieht den Abstimm-Link lesend" 200 ".links.vote.token == \"$VTOK\" and .links.vote.password == true and .links.edit.token == \"$ETOK\""
as anon GET "$APP/p/$VTOK"
check_state "4 Abstimm-Link: linkState ok" linkState '"ok"'
check_state_jq "4 linkInfo {role vote, password true}" linkInfo '. == {"role":"vote","password":true}'
VJOIN="$APP/pub/v1/$VTOK/join"
guest POST "$VJOIN" "$(json '{"client":"cV","name":"Vera"}')"
check "14 Abstimm-Link ohne Passwort → 403 password_required" 403 "$(appError password_required)"
guest POST "$VJOIN" "$(json '{"client":"cV","name":"Vera","password":"falsch"}')"
check "14 falsches Passwort → 403 password_wrong" 403 "$(appError password_wrong)"
guest POST "$VJOIN" "$(json '{"client":"cV","name":"Vera","password":"Smoke-pw-1"}')"
check "14 richtiges Passwort → Snapshot, Rolle vote, Token endet mit dem Link" 200 ".me.role == \"vote\" and .me.guest == true and .me.mod == false and .board.role == \"vote\" and .guest.exp <= ($VEXP / 1000 | floor)"
VGTOK="$(jq -r .guest.token "$BODY")"
guest POST "$VJOIN" "$(json "{\"client\":\"cV\",\"name\":\"Vera\",\"guest\":\"$VGTOK\"}")"
check "14 gültiges altes Token → ohne Passwort" 200 '.me.role == "vote"'
guest POST "$APP/pub/v1/boards/$BSH/sync" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cV\",\"since\":0,\"seq\":1,\"pres\":0,\"ops\":[{\"o\":\"put\",\"id\":\"$ULID_B\",\"t\":\"sticky\",\"p\":{\"z\":\"i0\",\"w\":200,\"h\":200}}]}")" "$VGTOK"
check "16 Abstimm-Gast: Objekt-Op denied" 200 '.acks.res == ["denied"]'
as carol POST "$APP/api/v1/links/$VTOK/join" "$(json '{}')"
check "11 Konto über Abstimm-Link ohne Passwort → 403 password_required" 403 "$(appError password_required)"
as carol POST "$APP/api/v1/links/$VTOK/join" "$(json '{"password":"Smoke-pw-1"}')"
check "11 Konto mit Passwort → Mitglied" 200 ".boardId == $BSH"
as carol GET "$APP/api/v1/boards/$BSH/snapshot"
check "12 Konto über Abstimm-Link: role vote, source link" 200 '.board.role == "vote" and .me.source == "link" and .me.mod == false'
as carol POST "$APP/api/v1/links/$ETOK/join" "$(json '{}')"
check "11 Abstimm-Mitglied über den Bearbeitungslink → edit (R2)" 200 ".boardId == $BSH"
as carol GET "$APP/api/v1/boards/$BSH/snapshot"
check "12 Mitgliedschaft ersetzt: role edit" 200 '.board.role == "edit" and .me.source == "link"'
as alice POST "$APP/api/v1/boards/$BSH/votelink" "$(json '{"rotate":true}')"
check "17 Abstimm-Link erneuern → neuer Token, Passwort und Ablauf übernommen" 200 ".link.token != \"$VTOK\" and .link.password == true and .link.expiresOn == \"$DAY3\""
VTOK2="$(jq -r .link.token "$BODY")"
guest POST "$APP/pub/v1/boards/$BSH/sync" "$(json '{"proto":2,"ep":"@EP@","client":"cV","since":0,"pres":0}')" "$VGTOK"
check "16 Abstimm-Gast nach dem Erneuern → 403 link_revoked" 403 "$(appError link_revoked)"
as alice GET "$APP/api/v1/boards/$BSH/snapshot"
check "12 der Bearbeitungslink bleibt unberührt" 200 ".board.links.edit.token == \"$ETOK\" and .board.links.vote.token == \"$VTOK2\""
as alice DELETE "$APP/api/v1/boards/$BSH/votelink"
check "18 DELETE votelink → {link: null}" 200 '. == {"link":null}'
as anon GET "$APP/p/$VTOK2"
check_state "4 abgeschalteter Abstimm-Link → revoked" linkState '"revoked"'
# Nextcloud's sharing policy for links and shares (§4.11.2 step 2, §7.4).
docker exec -u www-data "$NC" php occ config:app:set core shareapi_enforce_links_password --value=yes >/dev/null
occ_config_wait
as alice POST "$APP/api/v1/boards/$BSH/votelink" "$(json '{}')"
check "17 Passwort erzwungen → 400 password_enforced" 400 "$(appError password_enforced)"
as alice GET "$SHARES"
check "19 linkPolicy.passwordEnforced" 200 '.linkPolicy.passwordEnforced == true'
as alice POST "$APP/api/v1/boards/$BSH/link" "$(json '{}')"
check "9 nicht rückwirkend: der alte Link kommt unverändert (SRV-12)" 200 ".link.token == \"$ETOK\" and .link.password == false"
docker exec -u www-data "$NC" php occ config:app:delete core shareapi_enforce_links_password >/dev/null
docker exec -u www-data "$NC" php occ config:app:set core shareapi_enabled --value=no >/dev/null
occ_config_wait
as alice POST "$APP/api/v1/boards/$BSH/votelink" "$(json '{}')"
check "17 Teilen gesperrt → Anlegen 403 sharing_disabled" 403 "$(appError sharing_disabled)"
as alice POST "$APP/api/v1/boards/$BSH/link" "$(json '{"password":"Smoke-pw-2"}')"
check "9 Teilen gesperrt → Verschärfen erlaubt" 200 ".link.token == \"$ETOK\" and .link.password == true"
as alice POST "$APP/api/v1/boards/$BSH/link" "$(json '{"password":null}')"
check "9 Teilen gesperrt → Lockern 403 sharing_disabled" 403 "$(appError sharing_disabled)"
as alice PUT "$SHARES" "$(json '{"shares":[{"kind":"user","id":"bob","role":"edit"},{"kind":"user","id":"carol","role":"view"}]}')"
check "20 Teilen gesperrt → neuer Eintrag 403 sharing_disabled {at}" 403 '.error == "sharing_disabled" and .at == 1'
as alice PUT "$SHARES" "$(json '{"shares":[]}')"
check "20 Teilen gesperrt → Entfernen erlaubt" 200 '.shares == [] and .policy.sharing == false'
as alice GET "$APP/api/v1/boards/$BSH/sharees?q=bo"
check "21 Teilen gesperrt → leere Suche" 200 '. == {"sharees":[],"more":false}'
docker exec -u www-data "$NC" php occ config:app:delete core shareapi_enabled >/dev/null
occ_config_wait
# An expired link (§4.11.1, §4.11.3, §4.11.4): known, no miss, no failure.
link_expire_now "$ETOK" && pass "Bearbeitungslink per SQL abgelaufen" || fail "Bearbeitungslink per SQL ablaufen lassen"
as anon GET "$APP/p/$ETOK"
check_state "4 abgelaufener Link → linkState expired" linkState '"expired"'
check_state "4 abgelaufener Link → linkInfo null" linkInfo 'null'
guest POST "$APP/pub/v1/$ETOK/join" "$(json '{"client":"cE","name":"Ella","password":"Smoke-pw-2"}')"
check "14 abgelaufener Link → 403 link_expired" 403 "$(appError link_expired)"
as carol POST "$APP/api/v1/links/$ETOK/join" "$(json '{"password":"Smoke-pw-2"}')"
check "11 Konto über abgelaufenen Link → 403 link_expired" 403 "$(appError link_expired)"
as alice GET "$SHARES"
check "19 Besitzer sieht den abgelaufenen Link mit Datum" 200 ".links.edit.token == \"$ETOK\" and (.links.edit.expiresOn | type == \"string\")"
as alice POST "$APP/api/v1/boards/$BSH/link" "$(json '{}')"
check "9 POST ohne rotate auf abgelaufenen Link → neuer Token, Passwort übernommen, kein Ablauf" 200 ".link.token != \"$ETOK\" and .link.password == true and .link.expiresAt == null"
as alice DELETE "$APP/api/v1/boards/$BSH"
check "8 Board für Stufe 2 löschen" 200
ratelimit_reset

echo "— Moderation (SPEC-M1 Stufe 3: §4.12, Routen 22–26, Stimmweg §4.5/§4.6, Präsenz v)"
# The budget knorke-moderate (120/600 s) lives in this namespace's Redis (TST-13).
ratelimit_reset
as alice POST "$APP/api/v1/boards" "$(json '{"title":"Moderation"}')"
check "6 Board für Stufe 3" 201
BMO="$(jq -r .board.id "$BODY")"
MSYNC="$APP/api/v1/boards/$BMO/sync"
VOTE="$APP/api/v1/boards/$BMO/vote"
TIMER="$APP/api/v1/boards/$BMO/timer"
SUMMON="$APP/api/v1/boards/$BMO/summon"
VA="01JSM0VE000000000000000001"
VB="01JSM0VE000000000000000002"
VC="01JSM0VE000000000000000003"
as alice POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":0,\"seq\":1,\"pres\":0,\"ops\":[{\"o\":\"put\",\"id\":\"$VA\",\"t\":\"sticky\",\"p\":{\"z\":\"i1\",\"w\":200,\"h\":200}},{\"o\":\"put\",\"id\":\"$VB\",\"t\":\"sticky\",\"p\":{\"x\":300,\"z\":\"i2\",\"w\":200,\"h\":200}},{\"o\":\"put\",\"id\":\"$VC\",\"t\":\"sticky\",\"p\":{\"x\":600,\"z\":\"i3\",\"w\":200,\"h\":200}}]}")"
check "13 drei Notizen" 200 '.acks.res == ["ok","ok","ok"]'
as alice PUT "$APP/api/v1/boards/$BMO/shares" "$(json '{"shares":[{"kind":"user","id":"bob","role":"moderate"},{"kind":"user","id":"carol","role":"edit"}]}')"
check "20 bob darf moderieren, carol bearbeiten" 200 '(.shares | length) == 2'
as alice GET "$APP/api/v1/boards/$BMO/snapshot"
APID="$(jq -r .me.pid "$BODY")"
for r in "POST $VOTE {\"per\":3}" "PATCH $VOTE {\"action\":\"end\"}" "PUT $TIMER {\"action\":\"stop\"}" "POST $SUMMON {\"client\":\"cSmokeC\"}" "DELETE $SUMMON"; do
    read -r m u b <<<"$r"
    as carol "$m" "$u" "${b:+$(json "$b")}"
    check "22–26 $m ${u##*/} als Bearbeiterin ohne Moderation → 403 forbidden" 403 "$(appError forbidden)"
    as bob "$m" "${u/\/$BMO\//\/$BID2\/}" "${b:+$(json "$b")}"
    check "22–26 $m ${u##*/} als Fremder → 404 (kein Besitz-Orakel)" 404 "$(appError not_found)"
done
as alice POST "$VOTE" "$(json '{"per":0}')"
check "22 per 0 → 400 vote_config" 400 "$(appError vote_config)"
as alice POST "$VOTE" "$(json '{"per":3,"perItem":2,"foo":1}')"
check "22 unbekannter Schlüssel → 400 bad_request" 400 "$(appError bad_request)"
as alice POST "$VOTE" "$(json '{"per":3,"perItem":2,"minutes":10}')"
check "22 Start → {board: {title, meta, metaRev}, now}, meta.vote offen" 200 '(keys_unsorted == ["board","now"]) and (.board | keys_unsorted) == ["title","meta","metaRev"] and .board.title == "Moderation" and (.board.meta.vote | keys_unsorted) == ["sid","state","cfg","startedAt","endsAt","by","show"] and .board.meta.vote.state == "open" and .board.meta.vote.cfg == {"per":3,"perItem":2,"scope":null,"types":["sticky"]} and .board.meta.vote.by == "Alice Adler" and .board.meta.vote.show == false and (.board.meta.vote.endsAt - .now | . > 590000 and . <= 600000)'
SID="$(jq -r .board.meta.vote.sid "$BODY")"
MREV="$(jq -r .board.metaRev "$BODY")"
as alice POST "$VOTE" "$(json '{"per":3}')"
check "22 zweiter Start → 409 vote_open" 409 "$(appError vote_open)"
as carol POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeC\",\"since\":$MREV,\"seq\":1,\"pres\":0,\"ops\":[{\"o\":\"vote\",\"s\":$SID,\"id\":\"$VA\",\"n\":2},{\"o\":\"vote\",\"s\":$SID,\"id\":\"$VB\",\"n\":1},{\"o\":\"vote\",\"s\":$SID,\"id\":\"$VC\",\"n\":1}]}")"
check "13 Stimm-Ops: Mengen-Semantik, Budget, kein rev, votes {sid, mine, left}" 200 ".rev == $MREV and .acks == {\"seq\":1,\"rev\":null,\"res\":[\"ok\",\"ok\",\"limit\"]} and .votes == {\"sid\":$SID,\"mine\":{\"$VA\":2,\"$VB\":1},\"left\":0}"
as carol POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeC\",\"since\":$MREV,\"seq\":2,\"pres\":0,\"ops\":[{\"o\":\"vote\",\"s\":$SID,\"id\":\"$VA\",\"n\":0},{\"o\":\"vote\",\"s\":$SID,\"id\":\"$VB\",\"n\":0}]}")"
check "13 n 0 → mine leer als {} (nie [])" 200 ".acks.res == [\"ok\",\"ok\"] and (.votes.mine | type) == \"object\" and .votes.mine == {} and .votes.left == 3"
as carol POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeC\",\"since\":$MREV,\"seq\":3,\"pres\":0,\"ops\":[{\"o\":\"vote\",\"s\":$SID,\"id\":\"$VA\",\"n\":1},{\"o\":\"vote\",\"s\":$((SID + 1000)),\"id\":\"$VB\",\"n\":1}]}")"
check "13 fremde Sitzung → closed, positionsgleich" 200 ".acks.res == [\"ok\",\"closed\"] and .votes == {\"sid\":$SID,\"mine\":{\"$VA\":1},\"left\":2}"
as alice POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":$MREV,\"vt\":0,\"pres\":0}")"
check "13 Moderatorin mit vt → nur {sid, voters, vt}, keine Verteilung" 200 ".votes == {\"sid\":$SID,\"voters\":1,\"vt\":3}"
as alice POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":$MREV,\"vt\":3,\"pres\":0}")"
check "13 vt = Stand → ohne votes (Schritt 9 (i))" 200 '(has("votes") | not) and (keys_unsorted == ["rev","now"])'
as bob POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeB\",\"since\":$MREV,\"vt\":0,\"pres\":0}")"
check "13 Freigabe moderate mit vt → voters" 200 ".votes.voters == 1 and .votes.sid == $SID"
as carol POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeC\",\"since\":$MREV,\"vt\":0,\"pres\":0}")"
check "13 Nicht-Moderatorin mit vt → nie voters" 200 '(has("votes") | not)'
as carol GET "$APP/api/v1/boards/$BMO/snapshot"
check "12 Snapshot bei offener Sitzung: votes {sid, mine, left} zwischen me und items" 200 "(keys_unsorted | index(\"votes\")) == ((keys_unsorted | index(\"me\")) + 1) and .votes == {\"sid\":$SID,\"mine\":{\"$VA\":1},\"left\":2}"
as alice PATCH "$VOTE" "$(json '{"action":"extend"}')"
check "23 extend ohne minutes → 400 vote_config" 400 "$(appError vote_config)"
as alice PATCH "$VOTE" "$(json '{"action":"jump"}')"
check "23 unbekannte Aktion → 400 bad_request" 400 "$(appError bad_request)"
as alice PATCH "$VOTE" "$(json '{"action":"extend","minutes":5}')"
check "23 extend 5 → endsAt + 5 min" 200 '(.board.meta.vote.endsAt - .now | . > 890000 and . <= 900000)'
as alice PATCH "$VOTE" "$(json '{"action":"show"}')"
check "23 show" 200 '.board.meta.vote.show == true'
SREV="$(jq -r .board.metaRev "$BODY")"
as alice PATCH "$VOTE" "$(json '{"action":"show"}')"
check "23 show ohne Wirkung → 200, gleicher metaRev (R16)" 200 ".board.metaRev == $SREV and .board.meta.vote.show == true"
as alice PATCH "$VOTE" "$(json '{"action":"clear"}')"
check "23 clear auf offener Sitzung → 409 vote_closed" 409 "$(appError vote_closed)"
as bob PATCH "$VOTE" "$(json '{"action":"end"}')"
check "23 end (Moderator) → Rangliste, voters, total, closedAt" 200 ".board.meta.vote.state == \"closed\" and .board.meta.vote.results == [[\"$VA\",1]] and .board.meta.vote.total == 1 and .board.meta.vote.voters == 1 and (.board.meta.vote.closedAt | type == \"number\")"
as alice PATCH "$VOTE" "$(json '{"action":"end"}')"
check "23 end auf geschlossener → 409 vote_closed" 409 "$(appError vote_closed)"
as carol POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeC\",\"since\":$MREV,\"seq\":4,\"pres\":0,\"ops\":[{\"o\":\"vote\",\"s\":$SID,\"id\":\"$VB\",\"n\":1}]}")"
check "13 Stimme nach dem Ende → closed, ohne votes, meta.vote geschlossen" 200 '.acks.res == ["closed"] and (has("votes") | not) and .board.meta.vote.state == "closed"'
as alice PATCH "$VOTE" "$(json '{"action":"clear"}')"
check "23 clear → meta.vote weg" 200 '(.board.meta | has("vote") | not)'
as alice PATCH "$VOTE" "$(json '{"action":"clear"}')"
check "23 clear ohne meta.vote → 409 vote_closed (R16)" 409 "$(appError vote_closed)"
as alice PUT "$TIMER" "$(json '{"action":"start","ms":0}')"
check "24 ms 0 → 400 bad_request" 400 "$(appError bad_request)"
as alice PUT "$TIMER" "$(json '{"action":"start","ms":6000000}')"
check "24 ms > 99:59 → 400 bad_request" 400 "$(appError bad_request)"
as alice PUT "$TIMER" "$(json '{"action":"jump","ms":1000}')"
check "24 unbekannte Aktion → 400 bad_request" 400 "$(appError bad_request)"
as alice PUT "$TIMER" "$(json '{"action":"pause"}')"
check "24 pause ohne Timer → 409 timer_state" 409 "$(appError timer_state)"
as alice PUT "$TIMER" "$(json '{"action":"start","ms":60000}')"
check "24 start 60 s → end − now ≈ 60 000 (±1 s)" 200 '.board.meta.timer.state == "running" and .board.meta.timer.dur == 60000 and .board.meta.timer.left == null and .board.meta.timer.by == "Alice Adler" and .board.meta.timer.seq == 1 and (.board.meta.timer.end - .now | . >= 59000 and . <= 60000)'
as alice PUT "$TIMER" "$(json '{"action":"pause"}')"
check "24 pause → paused, left" 200 '.board.meta.timer.state == "paused" and .board.meta.timer.end == null and (.board.meta.timer.left | . > 50000 and . <= 60000) and .board.meta.timer.seq == 2'
as bob PUT "$TIMER" "$(json '{"action":"resume"}')"
check "24 resume (Moderator)" 200 '.board.meta.timer.state == "running" and .board.meta.timer.seq == 3'
as alice PUT "$TIMER" "$(json '{"action":"add","ms":60000}')"
check "24 add 60 s → dur 120 000" 200 '.board.meta.timer.dur == 120000 and .board.meta.timer.seq == 4'
as alice PUT "$TIMER" "$(json '{"action":"stop"}')"
check "24 stop → kein Timer" 200 '(.board.meta | has("timer") | not)'
as alice PUT "$TIMER" "$(json '{"action":"stop"}')"
check "24 stop ohne Timer → 409 timer_state" 409 "$(appError timer_state)"
as alice POST "$SUMMON" "$(json '{}')"
check "25 ohne client → 400 bad_request" 400 "$(appError bad_request)"
as alice POST "$SUMMON" "$(json '{"client":"cSmokeA"}')"
check "25 Alle zu mir → {pid, client, name, seq, at}" 200 "(.board.meta.summon | keys_unsorted) == [\"pid\",\"client\",\"name\",\"seq\",\"at\"] and .board.meta.summon.pid == \"$APID\" and .board.meta.summon.client == \"cSmokeA\" and .board.meta.summon.name == \"Alice Adler\" and .board.meta.summon.seq == 1"
as bob POST "$SUMMON" "$(json '{"client":"cSmokeB"}')"
check "25 zweiter Moderator übernimmt → seq 2" 200 '.board.meta.summon.seq == 2 and .board.meta.summon.name == "Bob Berg" and .board.meta.summon.client == "cSmokeB"'
as alice DELETE "$SUMMON"
check "26 DELETE → summon weg" 200 '(.board.meta | has("summon") | not)'
DREV="$(jq -r .board.metaRev "$BODY")"
as alice DELETE "$SUMMON"
check "26 DELETE ohne summon → 200, gleicher metaRev (idempotent)" 200 ".board.metaRev == $DREV and .board.meta == {}"
as alice DELETE "$SUMMON" "$(json "{\"id\":$BID2}")"
check "26 Body-id überdeckt die Route → 400" 400 "$(appError bad_request)"
as alice POST "$MSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":0,"pres":0,"me":{"v":[-10,20.04,800,600]}}')"
as bob POST "$MSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeB","since":0,"pres":1}')"
check "13 Präsenz v gerundet ({v} allein: ohne Cursor)" 200 "(.presence | to_entries | map(select(.key | startswith(\"$APID:\"))) | .[0].value | .v == [-10,20,800,600] and .x == null)"
# Path (d) of the automatic close: VoteCloseJob via occ (C72 (3) form).
as alice POST "$VOTE" "$(json '{"minutes":1}')"
check "22 neue Sitzung (1 min)" 200 '.board.meta.vote.state == "open"'
SID2="$(jq -r .board.meta.vote.sid "$BODY")"
vote_expire_now "$BMO" && pass "Sitzung per SQL abgelaufen (vote-expire)" || fail "Sitzung ablaufen lassen"
JOBID="$(docker exec -u www-data "$NC" php occ background-job:list --class='OCA\Knorke\BackgroundJob\VoteCloseJob' --output=json | jq -r '.[0].id')"
docker exec -u www-data "$NC" php occ background-job:execute "$JOBID" --force-execute >/dev/null
as alice POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":$DREV,\"pres\":0}")"
check "VoteCloseJob schließt ohne Anfragen (occ background-job:execute)" 200 ".board.meta.vote.state == \"closed\" and .board.meta.vote.sid == $SID2"
# Path (b): a moderator poll with vt when vt: is gone.
as alice POST "$VOTE" "$(json '{"minutes":1}')"
SID3="$(jq -r .board.meta.vote.sid "$BODY")"
MREV3="$(jq -r .board.metaRev "$BODY")"
vote_expire_now "$BMO" && docker exec "$REDIS" sh -c "redis-cli --scan --pattern '*/knorke/*/vt:$BMO' | xargs -r redis-cli DEL >/dev/null"
as alice POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":$MREV3,\"vt\":0,\"pres\":0}")"
check "13 Moderator-Sync mit vt schließt eine abgelaufene Sitzung (ohne voters)" 200 '(has("votes") | not)'
as alice POST "$MSYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmokeA\",\"since\":$MREV3,\"pres\":0}")"
check "13 der folgende Sync trägt meta.vote geschlossen" 200 ".board.meta.vote.state == \"closed\" and .board.meta.vote.sid == $SID3"
as alice DELETE "$APP/api/v1/boards/$BMO"
check "8 Board für Stufe 3 löschen (Sitzungen und Stimmen mit)" 200
ratelimit_reset
as anon GET "$APP/api/v1/boards/$BID/shares"
check "19 ohne Login → 401 {message} von Nextcloud" 401 '(has("message")) and (has("error") | not)'
CODE="$(curl -s -m 30 -o "$BODY" -w '%{http_code}' -X POST -H 'Host: localhost' -c "$TMP/jar-alice" -b "$TMP/jar-alice" -u "alice:$PASS" -H 'Content-Type: application/json' --data-binary '{}' "$APP/api/v1/boards/$BID/votelink")"
check "17 ohne requesttoken → 412 (CSRF bleibt an)" 412

echo "— Rechtliches auf der Gastseite (U10: theming imprintUrl/privacyUrl)"
as anon GET "$APP/p/$LINK"
check_state_jq "4 legal leer, wenn nicht gesetzt" legal '. == {"imprintUrl":"","privacyUrl":""}'
docker exec -u www-data "$NC" php occ config:app:set theming imprintUrl --value=https://example.org/impressum >/dev/null
docker exec -u www-data "$NC" php occ config:app:set theming privacyUrl --value='javascript:alert(1)' >/dev/null
occ_config_wait
as anon GET "$APP/p/$LINK"
check_state_jq "4 legal: https bleibt, javascript: wird ''" legal '. == {"imprintUrl":"https://example.org/impressum","privacyUrl":""}'
as anon GET "$APP/p/$UNKNOWN"
check_state_jq "4 legal auch bei ungültigem Link" legal '. == {"imprintUrl":"https://example.org/impressum","privacyUrl":""}'
docker exec -u www-data "$NC" php occ config:app:delete theming imprintUrl >/dev/null
docker exec -u www-data "$NC" php occ config:app:delete theming privacyUrl >/dev/null

echo "— Widerruf (9 rotate, 10, 4 revoked, 8)"
as alice POST "$APP/api/v1/boards/$BID/link" "$(json '{"rotate":true}')"
check "9 erneuern → neuer Link" 200 ".link.token != \"$LINK\""
LINK2="$(jq -r .link.token "$BODY")"
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":2}')" "$GTOK"
check "16 altes Gast-Token → 403 link_revoked" 403 "$(appError link_revoked)"
as bob GET "$APP/api/v1/boards/$BID/snapshot"
check "12 Link-Mitglied nach Erneuern → 404" 404 "$(appError not_found)"
as anon GET "$APP/p/$LINK"
check "4 alter Link → 200" 200
check_state "4 alter Link: linkState = revoked" linkState '"revoked"'
check_state "4 alter Link: boardId = null" boardId 'null'
guest POST "$APP/pub/v1/$LINK/join" "$(json '{"client":"cG","name":"Gina"}')"
check "14 Beitritt mit altem Link → 403 link_revoked" 403 "$(appError link_revoked)"
as bob POST "$APP/api/v1/links/$LINK/join" "$(json '{}')"
check "11 angemeldet mit altem Link → 403 link_revoked" 403 "$(appError link_revoked)"
guest POST "$APP/pub/v1/$LINK2/join" "$(json "{\"client\":\"cG\",\"name\":\"Gina\",\"guest\":\"$GTOK\"}")"
check "14 Neu-Beitritt mit neuem Link behält die pid" 200 ".me.pid == \"$GPID\""
GTOK2="$(jq -r .guest.token "$BODY")"
as alice DELETE "$APP/api/v1/boards/$BID/link"
check "10 DELETE link → {link:null}" 200 '. == {"link":null}'
guest POST "$GSYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cG","since":2}')" "$GTOK2"
check "16 Link aus → 403 link_revoked" 403 "$(appError link_revoked)"
as anon GET "$APP/p/$UNKNOWN"
check "4 nie ausgestellter Token → 200" 200
check_state "4 linkState = invalid" linkState '"invalid"'
check_no_manifest "4 (invalid)"
as bob POST "$APP/api/v1/links/$UNKNOWN/join" "$(json '{}')"
check "11 nie ausgestellter Token → 404" 404 "$(appError not_found)"

as bob DELETE "$APP/api/v1/boards/$BID"
check "8 Fremder löscht → 404" 404 "$(appError not_found)"
as alice DELETE "$APP/api/v1/boards/$BID" "$(json "{\"id\":$BID2}")"
check "8 Body-id bei DELETE überdeckt die Route nicht → 400" 400 "$(appError bad_request)"
as alice GET "$APP/api/v1/boards/$BID2/snapshot" "$(json "{\"id\":$BID}")"
check "12 Body-id beim Snapshot → 400" 400 "$(appError bad_request)"
as alice DELETE "$APP/api/v1/boards/$BID"
check "8 DELETE → {deleted:true}" 200 '. == {"deleted":true}'
as alice POST "$SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmokeA","since":2}')"
check "13 C30 Sync nach dem Löschen → 404 (Fastpath a: gelöscht)" 404 "$(appError not_found)"
as anon GET "$APP/p/$LINK2"
check_state "4 C30 Link des gelöschten Boards → revoked" linkState '"revoked"'
as alice DELETE "$APP/api/v1/boards/$BID2"
check "8 zweites Board löschen" 200

echo "— Stufe 4: Snapshot-Drossel, Schreibbudget, occ knorke:compact (SPEC-M1 §4.1, §4.13.6, §4.13.7)"
ratelimit_reset
as alice POST "$APP/api/v1/boards" "$(json '{"title":"Smoke Stufe 4"}')"
check "6 Board für Stufe 4" 201
B4="$(jq -r .board.id "$BODY")"
S4SYNC="$APP/api/v1/boards/$B4/sync"
N4=0
for _ in $(seq 1 30); do
    as alice GET "$APP/api/v1/boards/$B4/snapshot"
    [ "$CODE" = 200 ] && N4=$((N4 + 1))
done
if [ "$N4" = 30 ]; then pass "12 C77 30 Snapshots in 60 s → 200"; else fail "12 C77 30 Snapshots in 60 s → 200 (nur $N4)"; fi
as alice GET "$APP/api/v1/boards/$B4/snapshot"
check "12 C77 der 31. Snapshot → 429 slow_down {retryMs: 2000}" 429 '.error == "slow_down" and .retryMs == 2000 and (.message | type == "string")'
if grep -qi '^retry-after: 2' "$HDRS"; then pass "12 C77 Retry-After: 2"; else fail "12 C77 Retry-After: 2 fehlt"; fi
ratelimit_reset
as alice POST "$APP/api/v1/boards/$B4/link" "$(json '{}')"
check "9 Link für Stufe 4" 200
L4="$(jq -r .link.token "$BODY")"
guest POST "$APP/pub/v1/$L4/join" "$(json '{"client":"cG4","name":"Gina"}')"
check "14 neuer Gast" 200
G4TOK="$(jq -r .guest.token "$BODY")"
G4PID="$(jq -r .me.pid "$BODY")"
N4=0
for _ in $(seq 1 30); do
    guest POST "$APP/pub/v1/$L4/join" "$(json "{\"client\":\"cG4\",\"name\":\"Gina\",\"guest\":\"$G4TOK\"}")"
    [ "$CODE" = 200 ] && [ "$(jq -r .me.pid "$BODY")" = "$G4PID" ] && N4=$((N4 + 1))
done
if [ "$N4" = 30 ]; then pass "14 C77 30 Wiederbeitritte mit altem Token → 200, gleiche pid"; else fail "14 C77 30 Wiederbeitritte → 200 (nur $N4)"; fi
guest POST "$APP/pub/v1/$L4/join" "$(json "{\"client\":\"cG4\",\"name\":\"Gina\",\"guest\":\"$G4TOK\"}")"
check "14 C77 der 31. Wiederbeitritt → 429 slow_down (nicht rate_limited)" 429 '.error == "slow_down" and .retryMs == 2000'
guest GET "$APP/pub/v1/boards/$B4/snapshot" "" "$G4TOK"
check "15 Gast-Snapshot derselben gid im selben Fenster → 429 slow_down" 429 '.error == "slow_down" and .retryMs == 2000'
ratelimit_reset
guest GET "$APP/pub/v1/boards/$B4/snapshot" "" "$G4TOK"
check "15 nach dem Zurücksetzen → 200" 200 '.proto == 2'

docker exec -u www-data "$NC" php occ config:app:set knorke budget_syncs --value=2 >/dev/null
occ_config_wait
# Three requests with ops in ONE 10-s window: start early in a window (the
# host and the container share one clock), retry once in the next window.
busy_round() {
    local ms
    ms=$(( $(date +%s%3N) % 10000 ))
    if [ "$ms" -gt 6000 ]; then sleep "$(awk "BEGIN { print (10050 - $ms) / 1000 }")"; fi
    W4=()
    local i
    for i in 1 2 3; do
        as alice POST "$S4SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke4\",\"since\":0,\"seq\":$((SEQ4 + i)),\"ops\":[{\"o\":\"put\",\"id\":\"01JSM4KE00000000000000$((1000 + SEQ4 + i))\",\"t\":\"sticky\",\"p\":{\"z\":\"i0\",\"w\":200,\"h\":200,\"data\":{\"text\":\"b$i\"}}},{\"o\":\"put\",\"id\":\"01JSM4KE00000000000000$((2000 + SEQ4 + i))\",\"t\":\"sticky\",\"p\":{\"z\":\"i1\",\"w\":200,\"h\":200}}],\"pres\":1}")"
        cp "$BODY" "$TMP/b4-$i.json"
        OKP4=$((OKP4 + $(jq '[.acks.res[]? | select(. == "ok")] | length' "$BODY")))
        W4+=("$(jq -r '(.now / 10000 | floor)' "$BODY")")
    done
    SEQ4=$((SEQ4 + 3))
    [ "${W4[0]}" = "${W4[2]}" ]
}
SEQ4=0
OKP4=0
busy_round || busy_round || true
cp "$TMP/b4-1.json" "$BODY"; CODE=200
check "13 C76 erste Anfrage mit Ops → ok" 200 '.acks.res == ["ok","ok"] and (.acks.rev | type == "number")'
cp "$TMP/b4-3.json" "$BODY"; CODE=200
check "13 C76 die dritte Anfrage (budget_syncs 2) → busy für jede Op, nichts angewendet, retryMs aus now" 200 \
    '.acks.res == ["busy","busy"] and .acks.rev == null and .acks.retryMs == (((.now / 10000 | floor) + 1) * 10000 - .now + 100) and (keys | index("acks") != null) and has("presence")'
as alice POST "$S4SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmoke4","since":0,"pres":0}')"
check "13 C76 leerer Poll → normale Antwort (kein busy; genau die angewendeten Notizen: $OKP4)" 200 "(has(\"acks\") | not) and (.items | length) == $OKP4"
TTL4="$(docker exec "$REDIS" sh -c "redis-cli --scan --pattern '*/knorke/*/w:$B4:*' | head -n 1 | xargs -r -I{} redis-cli TTL '{}'")"
if [[ "$TTL4" =~ ^[0-9]+$ ]] && [ "$TTL4" -ge 1 ] && [ "$TTL4" -le 25 ]; then pass "C76 w:<b>:<pid>:<win> mit TTL ≤ 25 s ($TTL4)"; else fail "C76 w:-Schlüssel ohne passende TTL ('$TTL4')"; fi
docker exec -u www-data "$NC" php occ config:app:delete knorke budget_syncs >/dev/null
occ_config_wait

# Tombstones and occ knorke:compact (--now 31 days ahead: the tombstones are "old").
as alice POST "$S4SYNC" "$(json '{"proto":2,"ep":"@EP@","client":"cSmoke4","since":0,"pres":0}')"
R4="$(jq -r .rev "$BODY")"
IDS4="$(jq -c '[.items[].id]' "$BODY")"
as alice POST "$S4SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke4\",\"since\":$R4,\"seq\":20,\"ops\":$(jq -c '[.[] | {o: "remove", id: .}]' <<<"$IDS4"),\"pres\":0}")"
check "13 alle Notizen löschen (Grabsteine)" 200 ".acks.res == ([range($OKP4)] | map(\"ok\")) and $OKP4 >= 4"
X4="$(jq -r .acks.rev "$BODY")"
FUT4=$(( $(date +%s%3N) + 31 * 86400000 ))
CL4="$(docker exec -u www-data "$NC" php occ knorke:compact --board="$B4" --now="$FUT4" | grep '^{' | tail -n 1)"
if [ "$(jq -c '[keys_unsorted, .board, .blocks, .tombstones, .minRevBefore, .minRev]' <<<"$CL4" 2>/dev/null)" = "[[\"board\",\"blocks\",\"tombstones\",\"changes\",\"minRevBefore\",\"minRev\"],$B4,1,$OKP4,0,$X4]" ]; then
    pass "C78 occ knorke:compact --board → eine JSON-Zeile, $OKP4 Grabsteine, min_rev = X ($X4)"
else
    fail "C78 occ knorke:compact --board → '$CL4' (erwartet board $B4, blocks 1, tombstones $OKP4, minRev $X4)"
fi
as alice POST "$S4SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke4\",\"since\":$R4,\"pres\":0}")"
check "13 C78 Cursor unter X → resync" 200 '.resync == true and (has("removed") | not)'
as alice POST "$S4SYNC" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke4\",\"since\":$X4,\"pres\":0}")"
check "13 C78 Cursor = X → kein resync" 200 '(has("resync") | not)'
as alice GET "$APP/api/v1/boards/$B4/snapshot"
check "12 C78 Snapshot: minRev = X, die Notizen fehlen" 200 ".minRev == $X4 and (.items | length) == 0"
if docker exec -u www-data "$NC" php occ knorke:compact --board=999999999 >/dev/null 2>&1; then CODE=0; else CODE=$?; fi
check "occ knorke:compact mit unbekanntem Board → Exit 1" 1
as alice DELETE "$APP/api/v1/boards/$B4"
check "8 Board für Stufe 4 löschen" 200
ratelimit_reset

echo "— P7: Vorlagen, occ knorke:orphans, link_limit, Byte-Tagesquote, public_url (SPEC-M1 §33.1)"
for t in guest main public; do
    CODE="$(curl -s -m 30 -o "$BODY" -w '%{http_code}' -H 'Host: localhost' "http://127.0.0.1:$PORT/custom_apps/knorke/templates/$t.php")"
    if [ "$CODE" = 404 ] && ! grep -q 'Fatal error' "$BODY" && ! grep -Eq '/var/www/|\.php:[0-9]|on line [0-9]' "$BODY"; then
        pass "P7-05 GET /custom_apps/knorke/templates/$t.php → 404 ohne Fatal error und ohne Serverpfad"
    else
        fail "P7-05 GET /custom_apps/knorke/templates/$t.php → 404 ohne Fatal error (bekommen $CODE)"
    fi
done
if OUT7="$(docker exec -u www-data "$NC" php occ knorke:orphans --dry-run 2>/dev/null)"; then CODE=0; else CODE=$?; fi
printf '%s\n' "$OUT7" >"$BODY"
if [ "$CODE" = 0 ] && [ "$(wc -l <"$BODY")" = 6 ] && [ "$(sed -n 's/^\([a-z-]*\): [0-9][0-9]*$/\1/p' "$BODY" | tr '\n' ' ')" = "user-shares group-shares link-members open-votes owned-boards " ] \
    && [ "$(sed -n 6p "$BODY")" = 'Dry run: nothing was changed.' ]; then
    pass "P7-02 occ knorke:orphans --dry-run → Exit 0, fünf Zeilen <art>: <n> und die dry-run-Zeile"
else
    fail "P7-02 occ knorke:orphans --dry-run (Exit $CODE)"
fi
if docker exec -u www-data "$NC" php occ list knorke 2>/dev/null | grep -q 'knorke:orphans'; then pass "P7-02 knorke:orphans in <commands>"; else fail "P7-02 knorke:orphans fehlt in occ list"; fi

ratelimit_reset
as alice POST "$APP/api/v1/boards" "$(json '{"title":"Smoke P7"}')"
check "6 Board für P7" 201
B7="$(jq -r .board.id "$BODY")"
P7_LINK_LIMIT="$(appcfg_get link_limit)"
docker exec -u www-data "$NC" php occ config:app:set knorke link_limit --value=2 >/dev/null
occ_config_wait
ratelimit_reset
for _ in 1 2 3; do
    as bob POST "$APP/api/v1/boards/$B7/link" "$(json '{}')"
    [ "$CODE" = 404 ] || break
done
check "9 P7-03 Fremder auf alices Board → 404 (zählt nicht, nie 429)" 404
as alice POST "$APP/api/v1/boards/$B7/link" "$(json '{}')"
check "9 P7-03 erster schreibender Link-Aufruf (link_limit 2)" 200 '.link.role == "edit"'
as alice DELETE "$APP/api/v1/boards/$B7/votelink"
check "18 P7-03 zweiter (DELETE ohne Link zählt)" 200 '.link == null'
as alice POST "$APP/api/v1/boards/$B7/votelink" "$(json '{}')"
check "17 P7-03 dritter → 429 slow_down {retryMs: 300000}" 429 '.error == "slow_down" and .retryMs == 300000 and (keys == ["error","message","retryMs"])'
if grep -qi '^retry-after: 300' "$HDRS"; then pass "17 P7-03 Retry-After: 300"; else fail "17 P7-03 Retry-After: 300 fehlt"; fi
as alice GET "$APP/api/v1/boards/$B7/shares"
check "19 P7-03 GET shares bleibt ungedrosselt" 200 '.links.vote == null and (.links.edit.url | type == "string")'
URL7="$(jq -r .links.edit.url "$BODY")"
appcfg_restore link_limit "$P7_LINK_LIMIT"
P7_LINK_LIMIT=""
ratelimit_reset

docker exec -u www-data "$NC" php occ config:app:set knorke public_url --value=https://knorke-harness.example.org/ >/dev/null
occ_config_wait
# The expected url is compared in the shell: a failure message never shows the link token.
as alice GET "$APP/api/v1/boards/$B7/shares"
if [ "$CODE" = 200 ] && [ "$(jq -r .links.edit.url "$BODY")" = "https://knorke-harness.example.org/${URL7#*://*/}" ]; then
    pass "19 P7-16 public_url: links.edit.url = Ursprung + Pfad, ohne den Host der Anfrage"
else
    fail "19 P7-16 public_url: links.edit.url = Ursprung + Pfad (Status $CODE)"
fi
as alice GET "$APP/api/v1/boards/$B7/snapshot"
check "12 P7-16 board.links im Snapshot ebenso" 200 '.board.links.edit.url | startswith("https://knorke-harness.example.org/")'
docker exec -u www-data "$NC" php occ config:app:set knorke public_url --value=knorke-harness.example.org >/dev/null
occ_config_wait
as alice GET "$APP/api/v1/boards/$B7/shares"
if [ "$CODE" = 200 ] && [ "$(jq -r .links.edit.url "$BODY")" = "$URL7" ]; then
    pass "19 P7-16 ungültiger public_url → Host der Anfrage"
else
    fail "19 P7-16 ungültiger public_url → Host der Anfrage (Status $CODE)"
fi
docker exec -u www-data "$NC" php occ config:app:delete knorke public_url >/dev/null
occ_config_wait

P7_BYTES_BOARD="$(appcfg_get budget_bytes_board_day)"
docker exec -u www-data "$NC" php occ config:app:set knorke budget_bytes_board_day --value=1100 >/dev/null
occ_config_wait
as alice GET "$APP/api/v1/boards/$B7/snapshot"
check "12 P7-01 Snapshot für die Byte-Quote" 200
for i in 1 2 3; do
    as alice POST "$APP/api/v1/boards/$B7/sync" "$(json "{\"proto\":2,\"ep\":\"@EP@\",\"client\":\"cSmoke7\",\"since\":0,\"seq\":$i,\"ops\":[{\"o\":\"put\",\"id\":\"01JSM7KE00000000000000000$i\",\"t\":\"sticky\",\"p\":{\"z\":\"i$i\",\"w\":200,\"h\":200,\"data\":{\"text\":\"$(printf 'q%.0s' $(seq 1 300))\"}}}],\"pres\":0}")"
    cp "$BODY" "$TMP/b7-$i.json"
done
cp "$TMP/b7-2.json" "$BODY"; CODE=200
check "13 P7-01 zwei Anfragen à ≈ 490 Byte → ok" 200 '.acks.res == ["ok"]'
cp "$TMP/b7-3.json" "$BODY"; CODE=200
check "13 P7-01 die dritte (> 1100 Byte am Tag) → busy, acks.rev null, retryMs des Tages" 200 \
    '.acks.res == ["busy"] and .acks.rev == null and .acks.retryMs == (([((.now / 86400000 | floor) + 1) * 86400000 - .now, 60000] | min) + 100)'
as alice POST "$APP/api/v1/boards/$B7/sync" "$(json '{"proto":2,"ep":"@EP@","client":"cSmoke7","since":0,"pres":0}')"
check "13 P7-01 leerer Poll → normale Antwort, zwei Notizen" 200 '(has("acks") | not) and (.items | length) == 2'
TTL7="$(docker exec "$REDIS" sh -c "redis-cli --scan --pattern '*/knorke/*/wd:$B7:*' | head -n 1 | xargs -r -I{} redis-cli TTL '{}'")"
if [[ "$TTL7" =~ ^[0-9]+$ ]] && [ "$TTL7" -gt 86000 ] && [ "$TTL7" -le 90000 ]; then pass "P7-01 wd:<b>:<tag> mit TTL ≤ 25 h ($TTL7)"; else fail "P7-01 wd:-Schlüssel ohne passende TTL ('$TTL7')"; fi
appcfg_restore budget_bytes_board_day "$P7_BYTES_BOARD"
P7_BYTES_BOARD=""
occ_config_wait
as alice DELETE "$APP/api/v1/boards/$B7"
check "8 Board für P7 löschen" 200
ratelimit_reset

echo "— Theming-Icon (App-Icon im Theming)"
as alice GET "$APP/"
check "T1 GET / → 200" 200
# link_href REL: href of the first <link rel="REL" href="…"> of the last HTML body.
link_href() { { grep -o "<link rel=\"$1\" href=\"[^\"]*\"" "$BODY" || true; } | head -n 1 | sed 's/.*href="\([^"]*\)"/\1/'; }
# fail_bin NAME: like fail, for image answers: status, content type and size, never the body (NUL bytes).
fail_bin() { local ct n=0; FAIL=$((FAIL + 1)); printf '  FEHLER %s\n' "$1"; ct="$({ grep -i '^content-type:' "$HDRS" 2>/dev/null || true; } | tail -n 1 | tr -d '\r' | sed 's/^[^:]*:[[:space:]]*//')"; if [ -f "$BODY" ]; then n="$(wc -c < "$BODY" | tr -d ' ')"; fi; printf '         Status %s, Content-Type: %s, %s Byte\n' "$CODE" "${ct:--}" "$n"; }
TI_TOUCH="$(link_href apple-touch-icon)"
TI_FAV="$(link_href icon)"
TI_TOUCH_RE='^(/[^?]*)?/apps/theming/icon/knorke(\?v=[^&]*)?$'
TI_FAV_RE='^(/[^?]*)?/apps/theming/favicon/knorke(\?v=[^&]*)?$'
if [[ "$TI_TOUCH" =~ $TI_TOUCH_RE ]]; then pass "T1 <link rel=\"apple-touch-icon\"> → $TI_TOUCH"; else fail "T1 <link rel=\"apple-touch-icon\"> nicht auf /apps/theming/icon/knorke ('$TI_TOUCH')"; TI_TOUCH=""; fi
if [[ "$TI_FAV" =~ $TI_FAV_RE ]]; then pass "T1 <link rel=\"icon\"> → $TI_FAV"; else fail "T1 <link rel=\"icon\"> nicht auf /apps/theming/favicon/knorke ('$TI_FAV')"; TI_FAV=""; fi
# Job 131: only the guest page drops the manifest; the account page keeps it.
TI_MAN="$(link_href manifest)"
TI_MAN_RE='^(/[^?]*)?/apps/theming/manifest/knorke(\?v=[^&]*)?$'
if [[ "$TI_MAN" =~ $TI_MAN_RE ]]; then pass "T1 <link rel=\"manifest\"> (Konto-Seite) → $TI_MAN"; else fail "T1 <link rel=\"manifest\"> nicht auf /apps/theming/manifest/knorke ('$TI_MAN')"; fi
TI_PNG="$TMP/touch-knorke.png"
if [ -n "$TI_TOUCH" ]; then
    as anon GET "http://127.0.0.1:$PORT$TI_TOUCH"
    if [ "$CODE" = 200 ]; then pass "T2 anonym GET Touch-Icon → 200"; else fail_bin "T2 anonym GET Touch-Icon → 200 (erwartet 200)"; fi
    if grep -qiE $'^content-type: image/png\r?$' "$HDRS"; then pass "T2 Content-Type: image/png"; else fail_bin "T2 Content-Type: image/png fehlt"; fi
    if [ "$(head -c 8 "$BODY" | od -An -tx1 | tr -d ' \n')" = 89504e470d0a1a0a ]; then pass "T2 PNG-Signatur"; else fail_bin "T2 keine PNG-Signatur"; fi
    TI_SIZE="$(od -An -tu1 -j16 -N8 "$BODY" | tr -s ' \n' ' ' | sed 's/^ //; s/ $//')"
    if [ "$TI_SIZE" = '0 0 2 0 0 0 2 0' ]; then pass "T2 512 × 512 (IHDR)"; else fail_bin "T2 nicht 512 × 512 (IHDR '$TI_SIZE')"; fi
    [ "$CODE" != 200 ] || cp "$BODY" "$TI_PNG"
else
    fail_bin "T2 Touch-Icon nicht abgefragt: kein href aus T1"
fi
as anon GET "$BASE/apps/theming/icon/core"
if [ "$CODE" = 200 ]; then pass "T3 anonym GET /apps/theming/icon/core → 200"; else fail_bin "T3 anonym GET /apps/theming/icon/core → 200 (erwartet 200)"; fi
if [ -s "$TI_PNG" ] && ! cmp -s "$BODY" "$TI_PNG"; then pass "T3 Touch-Icon von knorke ≠ das von core"; else fail_bin "T3 Touch-Icon von knorke gleicht dem von core (oder fehlt)"; fi
if [ -n "$TI_FAV" ]; then
    as anon GET "http://127.0.0.1:$PORT$TI_FAV"
    if [ "$CODE" = 200 ]; then pass "T4 anonym GET Favicon → 200"; else fail_bin "T4 anonym GET Favicon → 200 (erwartet 200)"; fi
    if grep -qiE $'^content-type: image/x-icon\r?$' "$HDRS"; then pass "T4 Content-Type: image/x-icon"; else fail_bin "T4 Content-Type: image/x-icon fehlt"; fi
    if [ "$(head -c 4 "$BODY" | od -An -tx1 | tr -d ' \n')" = 00000100 ]; then pass "T4 ICO-Kopf 00 00 01 00"; else fail_bin "T4 kein ICO-Kopf"; fi
else
    fail_bin "T4 Favicon nicht abgefragt: kein href aus T1"
fi

printf '\n%s ok / %s fehlgeschlagen\n' "$OK" "$FAIL"
[ "$FAIL" -eq 0 ]
