#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# psql in this namespace's Postgres (SPEC-M0 §8.1), database and user
# nextcloud. Interactive with a TTY when called from a terminal; extra
# arguments go to psql. Only for KD_DB=pgsql: on another database it stops
# with exit 2 and points to dev/db.sh (any database). A protected namespace
# (KD_PROTECT_NS, default try) is refused with exit 2 unless KD_FORCE=1
# (dev/lib.sh, SPEC-M1 §8.1). E.g.
#   KD_NS=d dev/psql.sh
#   KD_NS=d dev/psql.sh -Atc 'SELECT id, rev, min_rev FROM oc_knorke_boards ORDER BY id'
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_pgsql psql.sh
container_running "$DB" || die "$DB läuft nicht – erst KD_NS=$NS dev/up.sh"
TTY=(-i)
[ -t 0 ] && [ -t 1 ] && TTY=(-it)
exec docker exec "${TTY[@]}" "$DB" psql -U nextcloud nextcloud "$@"
