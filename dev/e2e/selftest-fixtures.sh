#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Fixtures for `dev/e2e/run.sh --selftest` (SPEC-M0 §8.2): two board rows
# with NEGATIVE ids (no real board has one) and Redis keys under a fake prefix
# with a fake epoch (kdselftest/knorke/kdself01/…, SPEC-M1 §5.1, which the
# epoch patterns of the bridge match),
# so every bridge action can be checked with known values, independent of
# the app's API. `down` removes exactly these rows and keys. Portable SQL
# through dev/lib.sh db_sql, so it works for every KD_DB.
#
#   F1 = -900000000000000001  r: = 5 (EX 30), a: = [1,1,0], g:F1:selftest;
#                             one CLOSED voting session (vote-expire must not touch it)
#   F2 = -900000000000000002  rev 7, min_rev 0, r: = 7, a: = [1,1,0];
#                             one OPEN voting session (ends_at far ahead), vt: = "<sid>:3"
# The session ids come from the table's own counter (no explicit id: the same
# auto-increment reason as below); vote-expire answers the sid it touched.
#
# Why negative (round 2): an explicit id above the counter raises the
# auto-increment counter of MySQL/MariaDB and SQLite (not a PostgreSQL
# sequence). With the old ids 9×10^17 every board created afterwards got an id
# beyond 2^53, which JavaScript cannot represent – its /sync went to another
# id and answered 404. A negative id never raises the counter.
#
# Usage (run.sh calls it): KD_NS=d dev/e2e/selftest-fixtures.sh up|down
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

F1=-900000000000000001
F2=-900000000000000002
P=kdselftest/knorke/kdself01

rcli() { docker exec "$REDIS" redis-cli "$@" >/dev/null; }

# has_boards: oc_knorke_boards exists (portable: a query that fails without it).
has_boards() { printf '%s\n' 'SELECT COUNT(*) FROM oc_knorke_boards WHERE 1 = 0;' | db_sql >/dev/null 2>&1; }
# has_sessions: oc_knorke_vote_sessions exists (the M1 migration of stage 0).
has_sessions() { printf '%s\n' 'SELECT COUNT(*) FROM oc_knorke_vote_sessions WHERE 1 = 0;' | db_sql >/dev/null 2>&1; }

down() {
    if has_boards; then
        printf '%s\n' "DELETE FROM oc_knorke_boards WHERE id IN ($F1, $F2);" | db_sql >/dev/null
    fi
    if has_sessions; then
        printf '%s\n' "DELETE FROM oc_knorke_vote_sessions WHERE board_id IN ($F1, $F2);" | db_sql >/dev/null
    fi
    rcli DEL "$P/r:$F1" "$P/a:$F1" "$P/g:$F1:selftest" "$P/r:$F2" "$P/a:$F2" "$P/vt:$F2"
}

case "${1:-}" in
    up)
        db_container_running && container_running "$REDIS" || die "Stack '$NS' läuft nicht"
        has_boards || die "oc_knorke_boards fehlt (Platzhalter-App?) – der Selbsttest braucht die echte App"
        down
        printf '%s\n' "INSERT INTO oc_knorke_boards (id, owner, title, rev, min_rev, created_at, updated_at) VALUES ($F1, 'kd-selftest', 'bridge selftest 1', 3, 0, 0, 0), ($F2, 'kd-selftest', 'bridge selftest 2', 7, 0, 0, 0);" | db_sql >/dev/null
        rcli SET "$P/r:$F1" 5 EX 30
        rcli SET "$P/a:$F1" '[1,1,0]' EX 120
        rcli SET "$P/g:$F1:selftest" '"1|edit"' EX 120
        rcli SET "$P/r:$F2" 7 EX 30
        rcli SET "$P/a:$F2" '[1,1,0]' EX 120
        # stage 3 (SPEC-M1 §8.4 R16, vote-expire): a closed session on F1, an open one on F2
        has_sessions || die "oc_knorke_vote_sessions fehlt (M1-Migration nicht gelaufen?)"
        printf '%s\n' "INSERT INTO oc_knorke_vote_sessions (board_id, state, config, seq, voters, started_by, started_at, ends_at, closed_at) VALUES ($F1, 'closed', '{\"per\":5,\"perItem\":1,\"scope\":null,\"types\":[\"sticky\"]}', 2, 1, 'kd-selftest', 1, 2, 2);" \
            "INSERT INTO oc_knorke_vote_sessions (board_id, state, config, seq, voters, started_by, started_at, ends_at) VALUES ($F2, 'open', '{\"per\":5,\"perItem\":1,\"scope\":null,\"types\":[\"sticky\"]}', 3, 0, 'kd-selftest', 1, 9999999999999);" | db_sql >/dev/null
        SID="$(printf '%s\n' "SELECT id FROM oc_knorke_vote_sessions WHERE board_id = $F2 AND state = 'open';" | db_sql | head -n 1)"
        [[ "$SID" =~ ^[0-9]+$ ]] || die "Fixture-Sitzung für $F2 nicht lesbar: $SID"
        rcli SET "$P/vt:$F2" "\"$SID:3\"" EX 120
        log "Selbsttest-Fixtures angelegt (Boards $F1, $F2)"
        ;;
    down)
        down
        log "Selbsttest-Fixtures entfernt"
        ;;
    *)
        echo "usage: KD_NS=<ns> $0 up|down" >&2
        exit 2
        ;;
esac
