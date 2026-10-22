#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Host bridge of the browser tests (SPEC-M0 §8.2). The Playwright container
# cannot reach the database or Redis of the stack; for the few steps that
# need them, run.mjs writes a request file <bridge dir>/<n>.req (JSON
# {"action": "...", "args": [...]}) and this loop answers with
# <bridge dir>/<n>.res (JSON {"ok": bool, "action", "result"|"error", "ms"}).
#
# Only this whitelist runs, only against this namespace's containers, every
# command capped at 30 s. A request carries up to four arguments (SPEC-M1
# §8.1: the reader takes args[0..3]); every action has a fixed argument list
# (arg_spec) and each argument is checked on its own – a board id against
# ^-?[0-9]{1,18}$ (negative only for the selftest fixtures, see
# selftest-fixtures.sh), a word against its fixed list. Missing or extra
# arguments are refused. Redis keys carry the board epoch (SPEC-M1 §5.1:
# <prefix>/knorke/<epoch>/<key>); the patterns below match every epoch.
#   pgss-reset             SELECT pg_stat_statements_reset()       (pgsql only)
#   pgss-count             calls of statements on oc_knorke_* (+ list) (pgsql only)
#   redis-del-rev <b>      SCAN */knorke/*/r:<b> + DEL
#   redis-get-rev <b>      value + TTL of */knorke/*/r:<b>
#   redis-del-access <b>   SCAN + DEL */knorke/*/a:<b> and */knorke/*/g:<b>:*
#   set-min-rev <b>        in ONE transaction: UPDATE … SET min_rev = rev + 1,
#                          rev = rev + 1 (one statement; this order is right on
#                          every database – MySQL/MariaDB assign left to right,
#                          PostgreSQL/SQLite from the old row), SELECT the row;
#                          then DEL */knorke/*/a:<b> and */knorke/*/r:<b>
#   bruteforce-reset       occ security:bruteforce:reset <gatewayIp>
#   ratelimit-reset        SCAN + DEL */OC*RateLimiting*MemoryCacheBackend* in
#                          this namespace's Redis: Nextcloud's ILimiter state
#                          (the dev stacks always run with memcache.distributed =
#                          Redis), e.g. the budgets of routes 20/21 (knorke-share,
#                          knorke-share-new, knorke-sharees) and knorke-linkjoin,
#                          which would otherwise outlive a run (SPEC-M1 §8.4 R13,
#                          SRV-07) – from P7-C also knorke-link of link_limit –
#                          and the daily byte counters */knorke/*/wd:* and
#                          */knorke/*/wu:* (SCAN + DEL, never KEYS; SPEC-M1
#                          §33.1 j, ED-24); answers the number of deleted keys
#   links-policy on|off    Nextcloud's link policy for everybody (round 2 U11):
#                          off = occ config:app:set core shareapi_allow_links
#                          --value=no, on = the key deleted (default yes)
#   legal-links set|clear  theming imprintUrl/privacyUrl = the fixed harness
#                          URLs https://example.org/knorke-harness/impressum
#                          and …/datenschutz (round 2 U9/U10); clear deletes both
# Stage 2 (SPEC-M1 §8.4, §7.4). Accounts and groups are the harness's own only
# (env.json .users / .groups, written by up.sh: alice, bob, KD_EXTRA_USERS;
# knorke-e2e); a word is compared whole, never as a substring:
#   share-policy <key> <value>
#                          Nextcloud's sharing policy: <key> one of
#                          KD_SHAREAPI_KEYS (dev/lib.sh, the keys of §7.4 incl.
#                          shareapi_enabled and shareapi_exclude_groups*), the
#                          value by the key's kind (shareapi_kind): bool keys
#                          yes|no, shareapi_expire_after_n_days a number
#                          1–9999, the four group lists one harness group (stored
#                          as the JSON list ["<gid>"]); every key also takes
#                          "default" = the key deleted (Nextcloud's default; the
#                          counterpart World.cleanup uses)
#   group-member add|remove <user> <group>
#                          occ group:adduser|removeuser (idempotent); answers
#                          the group's members afterwards
#   circles on|off         occ app:enable|disable circles
#   team-create <name>     a team (Circles) owned by alice (§4.10.2: the board
#                          owner must be a member to share with it) named
#                          knorke-e2e-<word> (KD_HARNESS_TEAM_PREFIX); a harness
#                          team of the same name is destroyed first, so a
#                          repeated scenario never sees two; answers its singleId
#   team-member <singleId> <user>
#                          occ circles:members:add --type user, only into a
#                          harness team (name checked first)
#   link-expire <b> edit|vote
#                          the board's non-revoked link of that role expires now
#                          (expires_at = now − 1 ms, as if its day had passed)
#                          and, in the same SQL transaction, the generation of
#                          that role goes up (link_gen for edit, vote_link_gen
#                          for vote; SPEC-M1 §8.4 R13, D-7): a real guest token
#                          never outlives its link (exp ≤ expires_at, §4.11.4),
#                          so an open guest tab must get 403 link_revoked, re-join
#                          and end in 403 link_expired; then DEL */knorke/*/a:<b>
#                          and g:<b>:* (one full rights check per client, link
#                          members get 404). Answers the link and the generation
#                          before/after; no such link = error, nothing changed
#   seed-board <b> <n>     n sticky notes (1–5000) through the sync API as the
#                          board's owner (a harness account), in batches of 200
#                          (Limits::MAX_OPS), laid out on a 60-column grid (E36)
# Stage 3 (SPEC-M1 §8.4 R16; the same as Stack.voteExpire in dev/sim/lib/env.mjs):
#   vote-expire <b>        in ONE SQL transaction ends_at = now − 1 ms of the
#                          board's open voting session; boards.meta (also
#                          meta.vote.endsAt), rev and meta_rev stay as they are –
#                          the state "expired, not closed yet" of §4.12.1; then
#                          DEL */knorke/*/vt:<b> (no moderator poll may skip the
#                          close on a matching vt:). Answers {sid, endsAt} plus
#                          rev/metaRev read in the same transaction and the
#                          deleted keys; no open session = error, nothing changed.
#                          No counterpart: the session is closed afterwards.
# Stage 4 (SPEC-M1 §8.4 R19, T4-07; the same as Stack.purgeTombstones in
# dev/sim/lib/env.mjs):
#   purge-tombstones <b> <olderThanMs>
#                          olderThanMs is an AGE (0–2592000000 ms). In ONE SQL
#                          transaction modified_at of every tombstone of the
#                          board with modified_at ≤ now − olderThanMs becomes
#                          now − tombstone_days·86400000 − 1 (the effective
#                          tombstone_days: app config knorke/tombstone_days,
#                          else 30), then occ knorke:compact --board=<b>
#                          WITHOUT --now (§4.13.7 (b)). Answers compact's JSON
#                          line of the board ({board, blocks, tombstones,
#                          changes, minRevBefore, minRev}) plus the board's rev
#                          (and the number of backdated rows). No such board =
#                          error, compact never runs. No counterpart.
#   app-config <key> <value>
#                          a Knorke app config key of HARNESS_APP_CONFIG
#                          (dev/lib.sh: budget_syncs budget_ops tombstone_days
#                          tombstone_cap changes_cap budget_bytes_board_day
#                          budget_bytes_user_day changes_bytes_cap link_limit)
#                          set to 1–1000000000 (0–1000000000 for the byte keys
#                          HARNESS_BYTE_KEYS, where 0 = off; ED-23), or
#                          "default" = the baseline of the namespace's profile
#                          (dev/lib.sh harness_baseline: the profile value of
#                          HARNESS_APP_PROFILE set, else the key deleted;
#                          SPEC-M1 §33.1 j); answers {key, value, stored} after
#                          APPCONFIG_SETTLE s. Counterpart: app-config <key>
#                          default (World.cleanup), normalise_ns puts every key
#                          back to its baseline.
# The config actions (links-policy, legal-links, share-policy, circles,
# app-config) answer only after APPCONFIG_SETTLE s: Nextcloud keeps app config 3 s in the web
# server's APCu, occ cannot clear that copy. What an interrupted run leaves
# behind (also group memberships and harness teams) goes with dev/lib.sh
# normalise_ns, which dev/e2e/run.sh runs before and after every run.
# On a stack other than KD_DB=pgsql the two pgss actions answer
# {"ok": false, "unsupported": true, …}.
#
# The bridge dir is writable by the container and therefore hostile (review
# finding OPS-3, round 2 U4). This loop, running as root on the host:
#   - takes only regular files named ^[1-9][0-9]{0,8}\.req$; a symlink or a
#     wrongly named file is unlinked (never followed), anything else ignored
#   - moves a request into the host-only control dir (mv -T --) before it
#     reads it, and checks it there again (the container may swap it)
#   - writes answers and stderr only in the control dir and renames the
#     answer into the bridge dir with mv -T -- (a planted symlink or file of
#     that name is replaced, never followed)
#   - stops when <control dir>/stop appears (not a file in the bridge dir)
# Control dir and bridge dir must be on the same file system (rename).
#
# Usage (run.sh starts it): KD_NS=d dev/e2e/hostbridge.sh <bridge dir> <control dir>
# Without <control dir> a private one is made under dev/.state/$NS/.
# Ends when <control dir>/stop appears or its parent process is gone.
set -uo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

DIR="${1:?Bridge-Verzeichnis fehlt}"
CTL="${2:-}"
[ -d "$DIR" ] && [ ! -L "$DIR" ] || die "$DIR fehlt oder ist ein Symlink"
[ -f "$ENV_JSON" ] || die "$ENV_JSON fehlt"
GW="$(jq -r '.gatewayIp // empty' "$ENV_JSON")"
[[ "$GW" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "env.json: gatewayIp fehlt"
OWN_CTL=0
if [ -z "$CTL" ]; then
    CTL="$(mktemp -d "$STATE/bridge-ctl.XXXXXX")" || die "kein Kontrollverzeichnis"
    OWN_CTL=1
fi
[ -d "$CTL" ] && [ ! -L "$CTL" ] || die "Kontrollverzeichnis $CTL fehlt oder ist ein Symlink"
DIR="$(cd "$DIR" && pwd -P)"
CTL="$(cd "$CTL" && pwd -P)"
case "$CTL/" in "$DIR"/*) die "Kontrollverzeichnis $CTL liegt im Bridge-Verzeichnis" ;; esac
[ "$(stat -c %d "$DIR")" = "$(stat -c %d "$CTL")" ] || die "Bridge- und Kontrollverzeichnis liegen auf verschiedenen Dateisystemen (mv wäre kein rename)"
KIND="$(db_kind)"
PARENT="$PPID"
T=30
MAX_REQ_BYTES=4096
APPCONFIG_SETTLE=4
LEGAL_IMPRINT="https://example.org/knorke-harness/impressum"
LEGAL_PRIVACY="https://example.org/knorke-harness/datenschutz"
# Stage 2: the harness accounts and groups (whole words, blank-separated), the
# share-policy keys, the team owner and the seeding limits.
HUSERS="$(harness_users | tr '\n' ' ')"
HGROUPS="$(harness_groups | tr '\n' ' ')"
POLICY_KEYS=""
for _kv in $(printf '%s\n' "$KD_SHAREAPI_KEYS" | tr ' ' '\n' | sed -n 's/^\(shareapi_[a-z_]*\)=.*/\1/p'); do
    POLICY_KEYS="$POLICY_KEYS$_kv "
done
unset _kv
# Nextcloud ILimiter state in Redis (ratelimit-reset; the same pattern as
# dev/sim/lib/env.mjs RATELIMIT_PATTERN)
RATELIMIT_PATTERN="*/OC*RateLimiting*MemoryCacheBackend*"
# the daily byte counters of P7-01 (ratelimit-reset; the same patterns as
# dev/sim/lib/env.mjs BYTE_COUNTER_PATTERNS, SPEC-M1 §33.1 b/j)
WD_PATTERN="*/knorke/*/wd:*"
WU_PATTERN="*/knorke/*/wu:*"
TEAM_OWNER=alice
SEED_MAX=5000
SEED_BATCH=200
# stage 4 (purge-tombstones, app-config; SPEC-M1 §8.4 R19)
PURGE_AGE_MAX=2592000000
APP_VALUE_MAX=1000000000
COMPACT_T=120
TOMBSTONE_DAYS_DEFAULT=30
[ "$OWN_CTL" = 1 ] && trap 'rm -rf -- "${CTL:?}"' EXIT

psql_at() { timeout "$T" docker exec -i "$DB" psql -U nextcloud -d nextcloud -X -q -A -t -v ON_ERROR_STOP=1; }
sql_at() { timeout "$T" bash -c '. "$1"; db_sql' _ "$DEV/lib.sh"; }
rcli() { timeout "$T" docker exec "$REDIS" redis-cli "$@"; }
occ_at() { timeout "$T" docker exec -u www-data "$NC" php occ "$@"; }
# app_value APP KEY: the stored value, or JSON null when the key is not set.
app_value() {
    local v
    v="$(occ_at config:app:get "$1" "$2" 2>/dev/null)" || { echo null; return 0; }
    jq -cn --arg v "$v" '$v'
}
scan() { rcli --scan --pattern "$1" | sort; }
# occ_json ARGS…: occ output from the first line that opens a JSON value (some
# occ commands print notices before it); exit ≠ 0 when occ fails.
occ_json() {
    local out
    out="$(occ_at "$@")" || return 1
    printf '%s\n' "$out" | sed -n '/^[[{]/,$p'
}
# group_members GID: JSON list of the group's members (occ group:list).
group_members() {
    occ_json group:list --output=json | jq -c --arg g "$1" '.[$g] // null'
}
# circles_enabled: true/false from occ app:list.
circles_enabled() {
    occ_json app:list --output=json | jq -c '(.enabled // {}) | has("circles")'
}
# harness_team_ids NAME: singleIds of the teams named NAME (one per line).
harness_team_ids() {
    occ_json circles:manage:list --output=json | jq -r --arg n "$1" '.[] | select(.name == $n) | .id | select(test("^[A-Za-z0-9]{31}$"))'
}
# team_members SINGLEID: JSON list of the team's user members [{user, level, status}].
team_members() {
    occ_json circles:members:list "$1" --output=json \
        | jq -c '[.[] | select(.userType == 1) | {user: .userId, level: .level, status: .status}]'
}

# api_as USER METHOD PATH OUT [BODYFILE]: Knorke API on this namespace's
# Nextcloud (127.0.0.1:<published port>, Host localhost) as a harness account,
# Basic auth + OCS-APIRequest like dev/e2e/lib/harness.mjs api(). The password
# (env.json .userPass) reaches curl through a config on stdin, never on a
# command line. Writes the body to OUT, prints the HTTP status.
api_as() {
    local user="$1" method="$2" p="$3" out="$4" data="${5:-}" pass port
    local -a body=()
    pass="$(jq -r '.userPass // empty' "$ENV_JSON")"
    [[ "$pass" =~ ^[A-Za-z0-9]{8,64}$ ]] || { echo "env.json: userPass fehlt" >&2; return 1; }
    port="$(nc_port)" || return 1
    [ -n "$data" ] && body=(-H 'Content-Type: application/json' --data-binary "@$data")
    printf 'user = "%s:%s"\n' "$user" "$pass" | timeout "$T" curl -sS -m "$T" -K - -X "$method" -o "$out" -w '%{http_code}' \
        -H 'Host: localhost' -H 'OCS-APIRequest: true' -H 'Accept: application/json' ${body[@]+"${body[@]}"} \
        "http://127.0.0.1:$port/index.php/apps/knorke$p"
}

SEED_FILES=(seed.snap seed.res seed.body)
# seed_board B N: N sticky notes into board B through POST …/sync as its owner,
# SEED_BATCH ops per request (each a new seq; a "busy" answer is retried
# after retryMs with the same seq, SPEC-M1 §4.6). Prints the result JSON.
seed_board() {
    local b="$1" n="$2" owner snap res body code ep since seq=0 done=0 cnt client pfx batches=0 tries t0 retry bad items
    t0=$(date +%s%3N)
    owner="$(printf '%s\n' "SELECT owner FROM oc_knorke_boards WHERE id = $b;" | sql_at | head -n 1)" || return 1
    [ -n "$owner" ] || { echo "Board $b gibt es nicht" >&2; return 1; }
    in_words "$owner" "$HUSERS" || { echo "Besitzer von Board $b ist kein Harness-Konto: $owner" >&2; return 1; }
    # work files in the host-only control dir; handle() removes them (SEED_FILES)
    snap="$CTL/seed.snap"
    res="$CTL/seed.res"
    body="$CTL/seed.body"
    code="$(api_as "$owner" GET "/api/v1/boards/$b/snapshot" "$snap")" || return 1
    [ "$code" = 200 ] || { echo "Snapshot von Board $b → $code $(head -c 200 "$snap")" >&2; return 1; }
    ep="$(jq -r '.epoch // empty' "$snap")"
    since="$(jq -r '.rev // empty' "$snap")"
    [[ "$ep" =~ ^[a-z0-9]{1,16}$ ]] && [[ "$since" =~ ^[0-9]+$ ]] || { echo "Snapshot ohne epoch/rev" >&2; return 1; }
    client="cSeed$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 8 || true)"
    # 13 characters of ULID (Crockford base32) + the note's index as 13 digits = 26
    pfx="01KSEED$(LC_ALL=C tr -dc '0-9A-HJKMNP-TV-Z' </dev/urandom 2>/dev/null | head -c 6 || true)"
    [ "${#client}" = 13 ] && [ "${#pfx}" = 13 ] || { echo "kein Zufall für client/ULID" >&2; return 1; }
    while [ "$done" -lt "$n" ]; do
        cnt=$((n - done))
        [ "$cnt" -gt "$SEED_BATCH" ] && cnt="$SEED_BATCH"
        seq=$((seq + 1))
        jq -nc --argjson from "$done" --argjson cnt "$cnt" --arg pfx "$pfx" --arg client "$client" --arg ep "$ep" \
            --argjson since "$since" --argjson seq "$seq" '
            def b36: "0123456789abcdefghijklmnopqrstuvwxyz" as $d
                | [((. / 1296) | floor) % 36, ((. / 36) | floor) % 36, . % 36] | map($d[.:. + 1]) | join("");
            {proto: 2, client: $client, ep: $ep, since: $since, seq: $seq, pres: 0,
             ops: [range($from; $from + $cnt) | {o: "put", id: ($pfx + (("0000000000000" + tostring) | .[-13:])), t: "sticky",
                   p: {x: ((. % 60) * 240), y: (((. / 60) | floor) * 240), w: 200, h: 200, r: 0, z: ("k" + b36),
                       parent: null, data: {text: ("Seed " + ((. + 1) | tostring))}, style: {fill: "#fff2a8"}}}]}' >"$body" || return 1
        tries=0
        while :; do
            code="$(api_as "$owner" POST "/api/v1/boards/$b/sync" "$res" "$body")" || return 1
            [ "$code" = 200 ] || { echo "sync Batch $seq → $code $(head -c 200 "$res")" >&2; return 1; }
            retry="$(jq -r 'if ((.acks.res // []) | index("busy")) != null then (.acks.retryMs // 2000) else empty end' "$res")"
            [ -z "$retry" ] && break
            tries=$((tries + 1))
            [ "$tries" -le 5 ] || { echo "sync Batch $seq: busy nach 5 Versuchen" >&2; return 1; }
            sleep "$(awk -v m="$retry" 'BEGIN { printf "%.3f", (m > 10000 ? 10000 : m) / 1000 }')"
        done
        bad="$(jq -r --argjson cnt "$cnt" 'if ((.acks.res // []) | length) != $cnt then "acks: \((.acks.res // []) | length) statt \($cnt)" else ((.acks.res | map(select(. != "ok")) | unique | join(",")) | select(length > 0) | "Ergebnisse: " + .) // empty end' "$res")"
        [ -z "$bad" ] || { echo "sync Batch $seq: $bad" >&2; return 1; }
        since="$(jq -r '.acks.rev // .rev' "$res")"
        [[ "$since" =~ ^[0-9]+$ ]] || { echo "sync Batch $seq ohne rev" >&2; return 1; }
        done=$((done + cnt))
        batches=$((batches + 1))
    done
    items="$(printf '%s\n' "SELECT COUNT(*) FROM oc_knorke_items WHERE board_id = $b AND deleted = 0;" | sql_at | head -n 1)" || return 1
    jq -cn --argjson b "$b" --arg owner "$owner" --argjson n "$done" --argjson batches "$batches" --argjson rev "$since" \
        --argjson items "${items:-null}" --argjson ms "$(($(date +%s%3N) - t0))" \
        '{board: $b, owner: $owner, created: $n, batches: $batches, rev: $rev, items: $items, ms: $ms}'
}

# in_words WORD "LIST": WORD is one whole word of the blank-separated LIST.
in_words() {
    local w
    for w in $2; do
        [ "$1" = "$w" ] && return 0
    done
    return 1
}

# del_keys PATTERN…: DEL every key matching; prints a JSON array of the keys.
# Exit 1 when a SCAN or a DEL fails (pipefail: redis-cli's status, not sort's).
del_keys() {
    local keys=() k p list
    for p in "$@"; do
        # a failing SCAN (Redis down, container missing) is an error, never "0 keys"
        list="$(scan "$p")" || return 1
        while IFS= read -r k; do
            [ -n "$k" ] && keys+=("$k")
        done <<<"$list"
    done
    for k in ${keys[@]+"${keys[@]}"}; do
        rcli DEL "$k" >/dev/null || return 1
    done
    printf '%s\n' ${keys[@]+"${keys[@]}"} | jq -R . | jq -sc 'map(select(length > 0))'
}

# handle ACTION ARG1 [ARG2 ARG3 ARG4]: prints the result JSON on stdout; exit
# 1 = error, 3 = not on this database (message on stderr), 2 = not on the list.
# The arguments are already checked against arg_spec.
handle() {
    local action="$1" b="${2:-}" c="${3:-}" d="${4:-}" out key val ttl row id rc now f gen
    case "$action" in
        pgss-reset|pgss-count)
            if [ "$KIND" != pgsql ]; then
                echo "pg_stat_statements gibt es nur mit KD_DB=pgsql (dieser Stack: $KIND)" >&2
                return 3
            fi
            if [ "$action" = pgss-reset ]; then
                printf '%s\n' 'SELECT pg_stat_statements_reset();' | psql_at >/dev/null || return 1
                echo '{}'
            else
                printf '%s\n' "SELECT json_build_object('total', coalesce(sum(calls), 0), 'statements', coalesce(json_agg(json_build_object('calls', calls, 'query', left(query, 200)) ORDER BY calls DESC), '[]'::json)) FROM pg_stat_statements WHERE query ILIKE '%oc_knorke_%';" | psql_at
            fi
            ;;
        redis-del-rev)
            out="$(del_keys "*/knorke/*/r:$b")" || return 1
            jq -cn --argjson keys "$out" '{deleted: ($keys | length), keys: $keys}'
            ;;
        redis-get-rev)
            key="$(scan "*/knorke/*/r:$b" | head -n 1)"
            if [ -z "$key" ]; then
                echo '{"key":null,"value":null,"ttl":null}'
                return 0
            fi
            val="$(rcli GET "$key")" || return 1
            ttl="$(rcli TTL "$key")" || return 1
            jq -cn --arg key "$key" --arg val "$val" --argjson ttl "$ttl" \
                '{key: $key, value: ($val | tonumber? // $val), ttl: $ttl}'
            ;;
        redis-del-access)
            out="$(del_keys "*/knorke/*/a:$b" "*/knorke/*/g:$b:*")" || return 1
            jq -cn --argjson keys "$out" '{deleted: ($keys | length), keys: $keys}'
            ;;
        set-min-rev)
            row="$(printf '%s\n' "BEGIN;" \
                "UPDATE oc_knorke_boards SET min_rev = rev + 1, rev = rev + 1 WHERE id = $b;" \
                "SELECT rev, min_rev FROM oc_knorke_boards WHERE id = $b;" \
                "COMMIT;" | sql_at)" || return 1
            row="$(printf '%s' "$row" | awk -F '\t' 'NF == 2 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ { printf "{\"rev\":%s,\"min_rev\":%s}", $1, $2; exit }')"
            [ -n "$row" ] || row=null
            out="$(del_keys "*/knorke/*/a:$b" "*/knorke/*/r:$b")" || return 1
            jq -cn --argjson row "$row" --argjson keys "$out" '{row: $row, deleted: ($keys | length), keys: $keys}'
            ;;
        bruteforce-reset)
            timeout "$T" docker exec -u www-data "$NC" php occ security:bruteforce:reset "$GW" >/dev/null || return 1
            jq -cn --arg ip "$GW" '{ip: $ip}'
            ;;
        ratelimit-reset)
            # Nextcloud's ILimiter keys: <global prefix>/OC\Security\RateLimiting\Backend\MemoryCacheBackend<sha512>,
            # then the byte counters wd:/wu: of every epoch (P7-C, SPEC-M1 §33.1 j)
            out="$(del_keys "$RATELIMIT_PATTERN" "$WD_PATTERN" "$WU_PATTERN")" || return 1
            jq -cn --argjson keys "$out" '{deleted: ($keys | length)}'
            ;;
        links-policy)
            if [ "$b" = off ]; then
                occ_at config:app:set core shareapi_allow_links --value=no >/dev/null || return 1
            else
                occ_at config:app:delete core shareapi_allow_links >/dev/null || return 1
            fi
            sleep "$APPCONFIG_SETTLE"
            jq -cn --arg p "$b" --argjson v "$(app_value core shareapi_allow_links)" '{policy: $p, shareapi_allow_links: $v}'
            ;;
        legal-links)
            if [ "$b" = set ]; then
                occ_at config:app:set theming imprintUrl --value="$LEGAL_IMPRINT" >/dev/null || return 1
                occ_at config:app:set theming privacyUrl --value="$LEGAL_PRIVACY" >/dev/null || return 1
            else
                occ_at config:app:delete theming imprintUrl >/dev/null || return 1
                occ_at config:app:delete theming privacyUrl >/dev/null || return 1
            fi
            sleep "$APPCONFIG_SETTLE"
            jq -cn --argjson i "$(app_value theming imprintUrl)" --argjson p "$(app_value theming privacyUrl)" '{imprintUrl: $i, privacyUrl: $p}'
            ;;
        share-policy)
            # b = key, c = value; the pair is checked in check_args (policy_pair_ok)
            if [ "$c" = default ]; then
                occ_at config:app:delete core "$b" >/dev/null || return 1
            elif [ "$(shareapi_kind "$b")" = list ]; then
                occ_at config:app:set core "$b" --value="$(jq -cn --arg g "$c" '[$g]')" >/dev/null || return 1
            else
                occ_at config:app:set core "$b" --value="$c" >/dev/null || return 1
            fi
            sleep "$APPCONFIG_SETTLE"
            jq -cn --arg k "$b" --arg v "$c" --argjson s "$(app_value core "$b")" '{key: $k, value: $v, stored: $s}'
            ;;
        group-member)
            # b = add|remove, c = user, d = group
            if [ "$b" = add ]; then
                occ_at group:adduser "$d" "$c" >/dev/null || return 1
            else
                occ_at group:removeuser "$d" "$c" >/dev/null || return 1
            fi
            out="$(group_members "$d")" || return 1
            jq -cn --arg op "$b" --arg u "$c" --arg g "$d" --argjson m "${out:-null}" '{op: $op, user: $u, group: $g, members: $m}'
            ;;
        circles)
            if [ "$b" = off ]; then
                occ_at app:disable circles >/dev/null || return 1
            else
                occ_at app:enable circles >/dev/null || return 1
            fi
            sleep "$APPCONFIG_SETTLE"
            out="$(circles_enabled)" || return 1
            jq -cn --arg p "$b" --argjson e "${out:-null}" '{circles: $p, enabled: $e}'
            ;;
        team-create)
            # b = name (knorke-e2e-<word>); a harness team of that name goes first
            local -a gone=()
            for id in $(harness_team_ids "$b"); do
                occ_at circles:manage:destroy "$id" >/dev/null || return 1
                gone+=("$id")
            done
            # --type user: the default owner type of the command is "single" (a singleId, not a uid)
            out="$(occ_json circles:manage:create --type user --output=json "$TEAM_OWNER" "$b")" || return 1
            id="$(printf '%s' "$out" | jq -r '.id // empty' 2>/dev/null)"
            [[ "$id" =~ ^[A-Za-z0-9]{31}$ ]] || { echo "circles:manage:create lieferte keine singleId: $(printf '%s' "$out" | head -c 200)" >&2; return 1; }
            jq -cn --arg id "$id" --arg n "$b" --arg o "$TEAM_OWNER" --argjson r "$(printf '%s\n' ${gone[@]+"${gone[@]}"} | jq -R . | jq -sc 'map(select(length > 0))')" \
                '{singleId: $id, name: $n, owner: $o, replaced: $r}'
            ;;
        team-member)
            # b = singleId, c = user; only into a harness team
            out="$(occ_json circles:manage:details "$b")" || return 1
            key="$(printf '%s' "$out" | jq -r '.name // empty' 2>/dev/null)"
            case "$key" in
                "$KD_HARNESS_TEAM_PREFIX"?*) ;;
                *) echo "Team $b ist kein Harness-Team (Name '${key}')" >&2; return 1 ;;
            esac
            occ_at circles:members:add "$b" "$c" --type user >/dev/null || return 1
            out="$(team_members "$b")" || return 1
            jq -cn --arg id "$b" --arg n "$key" --arg u "$c" --argjson m "${out:-null}" '{singleId: $id, name: $n, user: $u, members: $m}'
            ;;
        link-expire)
            # b = board, c = edit|vote (whitelisted words: safe in SQL). One
            # transaction: the link expires and the generation of its role goes
            # up, but only when such a link exists (EXISTS, portable: the
            # subquery reads another table than the one it updates).
            now=$(date +%s%3N)
            if [ "$c" = vote ]; then key=vote_link_gen; else key=link_gen; fi
            row="$(printf '%s\n' "BEGIN;" \
                "SELECT 'gen0', $key FROM oc_knorke_boards WHERE id = $b;" \
                "UPDATE oc_knorke_boards SET $key = $key + 1 WHERE id = $b AND EXISTS (SELECT 1 FROM oc_knorke_links WHERE board_id = $b AND role = '$c' AND revoked_at IS NULL);" \
                "UPDATE oc_knorke_links SET expires_at = $((now - 1)) WHERE board_id = $b AND role = '$c' AND revoked_at IS NULL;" \
                "SELECT 'link', id, expires_at FROM oc_knorke_links WHERE board_id = $b AND role = '$c' AND revoked_at IS NULL ORDER BY id DESC;" \
                "SELECT 'gen1', $key FROM oc_knorke_boards WHERE id = $b;" \
                "COMMIT;" | sql_at)" || return 1
            gen="$(printf '%s' "$row" | awk -F '\t' '$1 == "gen0" && $2 ~ /^[0-9]+$/ { b = $2 } $1 == "gen1" && $2 ~ /^[0-9]+$/ { a = $2 } END { if (b != "" && a != "") printf "{\"before\":%s,\"after\":%s}", b, a }')"
            row="$(printf '%s' "$row" | awk -F '\t' '$1 == "link" && NF == 3 && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ { printf "{\"id\":%s,\"expiresAt\":%s}", $2, $3; exit }')"
            [ -n "$row" ] || { echo "Board $b hat keinen nicht widerrufenen Link der Rolle $c" >&2; return 1; }
            [ -n "$gen" ] || { echo "Board $b: Generation $key nicht lesbar" >&2; return 1; }
            out="$(del_keys "*/knorke/*/a:$b" "*/knorke/*/g:$b:*")" || return 1
            jq -cn --arg r "$c" --arg k "$key" --argjson row "$row" --argjson gen "$gen" --argjson now "$now" --argjson keys "$out" \
                '{link: ($row + {role: $r}), gen: ({column: $k} + $gen), now: $now, deleted: ($keys | length), keys: $keys}'
            ;;
        vote-expire)
            # b = board. One transaction: the open session of the board expires
            # now (ends_at only; the session row stays open, boards untouched),
            # and the same transaction reads the session back and the board's
            # rev/meta_rev (the proof that neither moved).
            now=$(date +%s%3N)
            row="$(printf '%s\n' "BEGIN;" \
                "UPDATE oc_knorke_vote_sessions SET ends_at = $((now - 1)) WHERE board_id = $b AND state = 'open';" \
                "SELECT 'vs', id, ends_at FROM oc_knorke_vote_sessions WHERE board_id = $b AND state = 'open' ORDER BY id DESC;" \
                "SELECT 'bd', rev, meta_rev FROM oc_knorke_boards WHERE id = $b;" \
                "COMMIT;" | sql_at)" || return 1
            gen="$(printf '%s' "$row" | awk -F '\t' '$1 == "bd" && NF == 3 && $2 ~ /^-?[0-9]+$/ && $3 ~ /^-?[0-9]+$/ { printf "{\"rev\":%s,\"metaRev\":%s}", $2, $3; exit }')"
            row="$(printf '%s' "$row" | awk -F '\t' '$1 == "vs" && NF == 3 && $2 ~ /^[0-9]+$/ && $3 ~ /^-?[0-9]+$/ { printf "{\"sid\":%s,\"endsAt\":%s}", $2, $3; exit }')"
            [ -n "$row" ] || { echo "Board $b hat keine offene Abstimmung – nichts geändert" >&2; return 1; }
            [ -n "$gen" ] || gen='{"rev":null,"metaRev":null}'
            out="$(del_keys "*/knorke/*/vt:$b")" || return 1
            jq -cn --argjson row "$row" --argjson gen "$gen" --argjson now "$now" --argjson keys "$out" \
                '$row + $gen + {now: $now, deleted: ($keys | length), keys: $keys}'
            ;;
        purge-tombstones)
            # b = board, c = age in ms (checked: 0–PURGE_AGE_MAX). The effective
            # retention first (app config, else 30 days), then ONE transaction
            # that backdates the board's old enough tombstones beyond it and
            # reads the board row back; compact only when the board exists.
            local days back n cline
            days="$(occ_at config:app:get knorke tombstone_days 2>/dev/null)" || days=""
            [[ "$days" =~ ^[1-9][0-9]{0,8}$ ]] || days="$TOMBSTONE_DAYS_DEFAULT"
            now=$(date +%s%3N)
            back=$((now - days * 86400000 - 1))
            row="$(printf '%s\n' "BEGIN;" \
                "UPDATE oc_knorke_items SET modified_at = $back WHERE board_id = $b AND deleted = 1 AND modified_at <= $((now - c));" \
                "SELECT 'n', count(*) FROM oc_knorke_items WHERE board_id = $b AND deleted = 1 AND modified_at = $back;" \
                "SELECT 'bd', rev, min_rev FROM oc_knorke_boards WHERE id = $b;" \
                "COMMIT;" | sql_at)" || return 1
            n="$(printf '%s' "$row" | awk -F '\t' '$1 == "n" && $2 ~ /^[0-9]+$/ { print $2; exit }')"
            printf '%s' "$row" | awk -F '\t' '$1 == "bd" { f = 1 } END { exit !f }' || { echo "Board $b gibt es nicht – nichts geändert" >&2; return 1; }
            out="$(timeout "$COMPACT_T" docker exec -u www-data "$NC" php occ knorke:compact --board="$b")" || { printf '%s\n' "$out" | head -c 300 >&2; return 1; }
            # one JSON line per processed board on stdout (§4.13.7 (d)); notices before it are skipped
            cline="$(printf '%s\n' "$out" | grep '^{' | jq -c --argjson b "$b" 'select(type == "object" and .board == $b)' 2>/dev/null | tail -n 1)"
            [ -n "$cline" ] || { echo "occ knorke:compact --board=$b lieferte keine JSON-Zeile für Board $b: $(printf '%s' "$out" | head -c 200)" >&2; return 1; }
            row="$(printf '%s\n' "SELECT 'rev', rev FROM oc_knorke_boards WHERE id = $b;" | sql_at)" || return 1
            row="$(printf '%s' "$row" | awk -F '\t' '$1 == "rev" && $2 ~ /^[0-9]+$/ { print $2; exit }')"
            [ -n "$row" ] || { echo "Board $b: rev nicht lesbar" >&2; return 1; }
            jq -cn --argjson line "$cline" --argjson rev "$row" --argjson n "${n:-0}" --argjson age "$c" --argjson days "$days" --argjson now "$now" \
                '$line + {rev: $rev, backdated: $n, olderThanMs: $age, tombstoneDays: $days, now: $now}'
            ;;
        app-config)
            # b = key of HARNESS_APP_CONFIG, c = 0–APP_VALUE_MAX | default (checked; 0 only for
            # HARNESS_BYTE_KEYS, app_pair_ok); default = the baseline of the profile (SPEC-M1 §33.1 j)
            if [ "$c" = default ]; then
                val="$(harness_baseline "$b")"
                if [ -n "$val" ]; then
                    occ_at config:app:set knorke "$b" --value="$val" >/dev/null || return 1
                else
                    occ_at config:app:delete knorke "$b" >/dev/null || return 1
                fi
            else
                occ_at config:app:set knorke "$b" --value="$c" >/dev/null || return 1
            fi
            sleep "$APPCONFIG_SETTLE"
            jq -cn --arg k "$b" --arg v "$c" --argjson s "$(app_value knorke "$b")" '{key: $k, value: $v, stored: $s}'
            ;;
        seed-board)
            # b = board, c = number of notes
            seed_board "$b" "$c"
            rc=$?
            for f in "${SEED_FILES[@]}"; do rm -f -- "${CTL:?}/$f"; done
            return "$rc"
            ;;
        *)
            echo "Aktion '$action' steht nicht auf der Liste" >&2
            return 2
            ;;
    esac
}

# arg_spec ACTION: the argument kinds of an action on the list, blank-separated
# (empty = no argument); exit 1 for an action that is not on the list.
#   board        ^-?[0-9]{1,18}$
#   w:<a>|<b>…   exactly one of the words
#   user         one harness account (env.json .users), whole word
#   group        one harness group (env.json .groups), whole word
#   team-name    knorke-e2e-[a-z0-9]{1,16} (KD_HARNESS_TEAM_PREFIX)
#   single-id    a Circles singleId, [A-Za-z0-9]{31}
#   count        1–SEED_MAX, no leading zero
#   policy-key   one key of KD_SHAREAPI_KEYS (dev/lib.sh), whole word
#   policy-value yes | no | default | 1–9999 | one harness group; whether it
#                fits the key's kind is checked as a pair (policy_pair_ok)
#   age          0–PURGE_AGE_MAX (ms), no leading zero (purge-tombstones)
#   app-key      one key of HARNESS_APP_CONFIG (dev/lib.sh), whole word
#   app-value    0–APP_VALUE_MAX, no leading zero, or default; 0 only for a
#                key of HARNESS_BYTE_KEYS, checked as a pair (app_pair_ok)
# Later stages add their actions here (SPEC-M1 §8.4); every argument gets a kind.
arg_spec() {
    case "$1" in
        pgss-reset|pgss-count|bruteforce-reset|ratelimit-reset) echo "" ;;
        redis-del-rev|redis-get-rev|redis-del-access|set-min-rev) echo "board" ;;
        links-policy) echo "w:on|off" ;;
        legal-links) echo "w:set|clear" ;;
        share-policy) echo "policy-key policy-value" ;;
        group-member) echo "w:add|remove user group" ;;
        circles) echo "w:on|off" ;;
        team-create) echo "team-name" ;;
        team-member) echo "single-id user" ;;
        link-expire) echo "board w:edit|vote" ;;
        seed-board) echo "board count" ;;
        vote-expire) echo "board" ;;
        purge-tombstones) echo "board age" ;;
        app-config) echo "app-key app-value" ;;
        *) return 1 ;;
    esac
}

# arg_ok KIND VALUE: VALUE fits KIND; prints the reason on failure.
arg_ok() {
    case "$1" in
        board)
            [[ "$2" =~ ^-?[0-9]{1,18}$ ]] && return 0
            echo "Board-ID ungültig: $2"
            return 1
            ;;
        w:*)
            # one exact word of the list (never a substring: "set|clear" is no word)
            local w
            local -a words
            IFS='|' read -r -a words <<<"${1#w:}"
            for w in "${words[@]}"; do
                [ "$2" = "$w" ] && return 0
            done
            echo "Argument ungültig: $2"
            return 1
            ;;
        user)
            [[ "$2" =~ ^[a-z][a-z0-9]{1,15}$ ]] && in_words "$2" "$HUSERS" && return 0
            echo "Konto ungültig (kein Harness-Konto): $2"
            return 1
            ;;
        group)
            [[ "$2" =~ ^[a-z][a-z0-9-]{0,31}$ ]] && in_words "$2" "$HGROUPS" && return 0
            echo "Gruppe ungültig (keine Harness-Gruppe): $2"
            return 1
            ;;
        team-name)
            [[ "$2" =~ ^${KD_HARNESS_TEAM_PREFIX}[a-z0-9]{1,16}$ ]] && return 0
            echo "Team-Name ungültig (${KD_HARNESS_TEAM_PREFIX}[a-z0-9]{1,16}): $2"
            return 1
            ;;
        single-id)
            [[ "$2" =~ ^[A-Za-z0-9]{31}$ ]] && return 0
            echo "singleId ungültig: $2"
            return 1
            ;;
        count)
            [[ "$2" =~ ^[1-9][0-9]{0,3}$ ]] && [ "$2" -le "$SEED_MAX" ] && return 0
            echo "Anzahl ungültig (1–$SEED_MAX): $2"
            return 1
            ;;
        policy-key)
            [[ "$2" =~ ^shareapi_[a-z_]{1,64}$ ]] && in_words "$2" "$POLICY_KEYS" && return 0
            echo "Richtlinien-Schlüssel ungültig: $2"
            return 1
            ;;
        age)
            [[ "$2" =~ ^(0|[1-9][0-9]{0,9})$ ]] && [ "$2" -le "$PURGE_AGE_MAX" ] && return 0
            echo "Alter ungültig (0–$PURGE_AGE_MAX ms): $2"
            return 1
            ;;
        app-key)
            [[ "$2" =~ ^[a-z_]{1,32}$ ]] && in_words "$2" "$HARNESS_APP_CONFIG" && return 0
            echo "App-Config-Schlüssel ungültig (nur $HARNESS_APP_CONFIG): $2"
            return 1
            ;;
        app-value)
            [ "$2" = default ] && return 0
            [[ "$2" =~ ^(0|[1-9][0-9]{0,9})$ ]] && [ "$2" -le "$APP_VALUE_MAX" ] && return 0
            echo "App-Config-Wert ungültig (0–$APP_VALUE_MAX oder default): $2"
            return 1
            ;;
        policy-value)
            case "$2" in
                yes|no|default) return 0 ;;
            esac
            [[ "$2" =~ ^[1-9][0-9]{0,3}$ ]] && return 0
            [[ "$2" =~ ^[a-z][a-z0-9-]{0,31}$ ]] && in_words "$2" "$HGROUPS" && return 0
            echo "Richtlinien-Wert ungültig: $2"
            return 1
            ;;
    esac
    echo "unbekannte Argumentart $1"
    return 1
}

# policy_pair_ok KEY VALUE: VALUE fits the kind of KEY (dev/lib.sh
# shareapi_kind): bool yes|no, number 1–9999, list one harness group; every
# key takes "default". Prints the reason on failure.
policy_pair_ok() {
    local kind
    kind="$(shareapi_kind "$1")" || { echo "Richtlinien-Schlüssel ungültig: $1"; return 1; }
    [ "$2" = default ] && return 0
    case "$kind" in
        bool) case "$2" in yes|no) return 0 ;; esac ;;
        number) [[ "$2" =~ ^[1-9][0-9]{0,3}$ ]] && return 0 ;;
        list) [[ "$2" =~ ^[a-z][a-z0-9-]{0,31}$ ]] && in_words "$2" "$HGROUPS" && return 0 ;;
    esac
    echo "Wert $2 passt nicht zu $1 ($kind)"
    return 1
}

# app_pair_ok KEY VALUE: 0 only for a byte key (HARNESS_BYTE_KEYS, where 0
# turns a quota or cap off; SPEC-M1 §33.1 j, ED-23) – for every other key the
# server reads 0 as its default (Limits::read), a silent mistake. Prints the
# reason on failure.
app_pair_ok() {
    [ "$2" = 0 ] || return 0
    in_words "$1" "$HARNESS_BYTE_KEYS" && return 0
    echo "App-Config-Wert 0 gilt nur für die Byte-Schlüssel ($HARNESS_BYTE_KEYS), nicht für $1"
    return 1
}

# check_args ACTION ARG…: every argument of the request against arg_spec, the
# count exactly; prints the reason on failure.
check_args() {
    local action="$1" spec kind i=0 why
    shift
    local -a given=("$@") kinds=()
    spec="$(arg_spec "$action")" || { echo "Aktion '$action' steht nicht auf der Liste"; return 1; }
    read -r -a kinds <<<"$spec"
    if [ "${#given[@]}" -ne "${#kinds[@]}" ]; then
        echo "${#given[@]} Argumente statt ${#kinds[@]} für $action"
        return 1
    fi
    for kind in ${kinds[@]+"${kinds[@]}"}; do
        why="$(arg_ok "$kind" "${given[$i]}")" || { echo "$why"; return 1; }
        i=$((i + 1))
    done
    # arguments that only make sense together
    if [ "$action" = share-policy ]; then
        why="$(policy_pair_ok "${given[0]}" "${given[1]}")" || { echo "$why"; return 1; }
    fi
    if [ "$action" = app-config ]; then
        why="$(app_pair_ok "${given[0]}" "${given[1]}")" || { echo "$why"; return 1; }
    fi
    return 0
}

# answer N JSON: written in the control dir, renamed into the bridge dir.
answer() {
    local n="$1" json="$2" tmp="$CTL/$1.res"
    rm -f -- "$tmp"
    printf '%s\n' "$json" >"$tmp" || return 1
    if ! mv -T -- "$tmp" "$DIR/$n.res" 2>/dev/null; then
        log "Brücke: Antwort $n nicht zustellbar ($DIR/$n.res ist ein Verzeichnis?) – verworfen"
        rm -f -- "$tmp"
    fi
}

declare -A WARNED=()
warn_once() {
    [ -n "${WARNED[$1]:-}" ] && return 0
    WARNED[$1]=1
    log "Brücke: $2"
}

log "Brücke bereit in $DIR (Kontrolle $CTL, DB $KIND)"
shopt -s nullglob
while :; do
    [ -e "$CTL/stop" ] && break
    kill -0 "$PARENT" 2>/dev/null || break
    worked=0
    for req in "$DIR"/*.req; do
        name="${req##*/}"
        if [ -L "$req" ]; then
            rm -f -- "$req"
            warn_once "$name" "$name ist ein Symlink – entfernt, nicht gelesen"
            continue
        fi
        if [ ! -f "$req" ]; then
            warn_once "$name" "$name ist keine Datei – übergangen"
            continue
        fi
        if ! [[ "$name" =~ ^[1-9][0-9]{0,8}\.req$ ]]; then
            rm -f -- "$req"
            warn_once "$name" "$name hat keinen gültigen Namen – entfernt"
            continue
        fi
        n="${name%.req}"
        work="$CTL/$n.work"
        rm -rf -- "${CTL:?}/$n.work"
        mv -T -- "$req" "$work" 2>/dev/null || continue
        worked=1
        if [ -L "$work" ] || [ ! -f "$work" ]; then
            rm -rf -- "${CTL:?}/$n.work"
            log "Brücke: Anfrage $n wurde während der Übernahme ausgetauscht – verworfen"
            continue
        fi
        t0=$(date +%s%3N)
        if [ "$(stat -c %s "$work")" -gt "$MAX_REQ_BYTES" ]; then
            answer "$n" "$(jq -cn '{ok: false, action: "", error: "Anfrage zu groß"}')"
            rm -f -- "$work"
            continue
        fi
        action="$(jq -r '.action // empty' "$work" 2>/dev/null || true)"
        # args[0..3]: strings or numbers only, at most four, each one line
        nargs="$(jq -r 'if (.args // []) | type != "array" then "x" elif ((.args // []) | length) > 4 then "x" elif ((.args // []) | all(type == "string" or type == "number")) | not then "x" else ((.args // []) | length) end' "$work" 2>/dev/null || echo x)"
        args=()
        if [[ "$nargs" =~ ^[0-4]$ ]]; then
            for ((i = 0; i < nargs; i++)); do
                args+=("$(jq -r --argjson i "$i" '.args[$i] | tostring' "$work" 2>/dev/null || true)")
            done
        fi
        rm -f -- "$work"
        if ! [[ "$action" =~ ^[a-z-]{1,32}$ ]]; then
            answer "$n" "$(jq -cn --arg a "$action" '{ok: false, action: $a, error: "ungültige Aktion"}')"
            continue
        fi
        if ! [[ "$nargs" =~ ^[0-4]$ ]]; then
            answer "$n" "$(jq -cn --arg a "$action" '{ok: false, action: $a, error: "args: höchstens vier Zeichenketten oder Zahlen"}')"
            continue
        fi
        if ! why="$(check_args "$action" ${args[@]+"${args[@]}"})"; then
            answer "$n" "$(jq -cn --arg a "$action" --arg e "$why" '{ok: false, action: $a, error: $e}')"
            continue
        fi
        errf="$CTL/$n.err"
        rm -f -- "$errf"
        res="$(handle "$action" ${args[@]+"${args[@]}"} 2>"$errf")"
        rc=$?
        ms=$(( $(date +%s%3N) - t0 ))
        if [ "$rc" = 0 ] && jq -e . >/dev/null 2>&1 <<<"$res"; then
            answer "$n" "$(jq -cn --arg a "$action" --argjson r "$res" --argjson ms "$ms" '{ok: true, action: $a, result: $r, ms: $ms}')"
        else
            answer "$n" "$(jq -cn --arg a "$action" --arg e "$(head -c 400 "$errf" 2>/dev/null) $(printf '%s' "${res:-}" | head -c 200)" \
                --argjson ms "$ms" --argjson u "$([ "$rc" = 3 ] && echo true || echo false)" \
                '{ok: false, action: $a, error: $e, ms: $ms} + (if $u then {unsupported: true} else {} end)')"
        fi
        log "Brücke: $action ${args[*]:-} (${ms} ms)"
        rm -f -- "$errf"
    done
    [ "$worked" = 0 ] && sleep 0.1
done
log "Brücke beendet"
