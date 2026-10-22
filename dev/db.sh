#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# SQL shell for this namespace's database, whatever KD_DB the stack was
# started with (round 2 U2): psql (pgsql), mariadb (mariadb), mysql (mysql),
# each as user nextcloud in database nextcloud. Passwords stay inside the
# containers (they come from the database container's own env).
#
#   KD_NS=d dev/db.sh                         interactive client (not sqlite)
#   KD_NS=d dev/db.sh -c 'SELECT id, rev FROM oc_knorke_boards'
#   echo 'SELECT 1;' | KD_NS=d dev/db.sh      SQL from stdin
#   KD_NS=d dev/db.sh --kind                  prints pgsql|mariadb|mysql|sqlite
#
# -c and stdin print rows tab-separated without header (dev/lib.sh db_sql;
# NULL is empty for pgsql/sqlite and "NULL" for mariadb/mysql). SQLite has no
# CLI in the Nextcloud image: there it runs PHP's PDO as www-data inside the
# Nextcloud container, statements separated by ";" at the end of a line.
# Table names carry the prefix oc_ on every kind. A protected namespace
# (KD_PROTECT_NS, default try) is refused with exit 2 unless KD_FORCE=1
# (dev/lib.sh, SPEC-M1 §8.1).
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KIND="$(db_kind)"
case "${1:-}" in
    --kind) printf '%s\n' "$KIND"; exit 0 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
esac
db_container_running || die "Stack '$NS' läuft nicht – erst KD_NS=$NS dev/up.sh"

if [ "${1:-}" = "-c" ]; then
    [ $# -eq 2 ] || die "Aufruf: dev/db.sh -c '<SQL>'"
    sql="$2"
    case "$sql" in *\;) ;; *) sql="$sql;" ;; esac
    printf '%s\n' "$sql" | db_sql
    exit $?
fi
[ $# -eq 0 ] || die "unbekannte Argumente: $* (siehe --help)"

if [ ! -t 0 ]; then
    db_sql
    exit $?
fi
TTY=(-i)
[ -t 1 ] && TTY=(-it)
case "$KIND" in
    pgsql) exec docker exec "${TTY[@]}" "$DB" psql -U nextcloud nextcloud ;;
    mariadb) exec docker exec "${TTY[@]}" "$DB" sh -c 'MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb --default-character-set=utf8mb4 -u "$MARIADB_USER" "$MARIADB_DATABASE"' ;;
    mysql) exec docker exec "${TTY[@]}" "$DB" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --default-character-set=utf8mb4 -u "$MYSQL_USER" "$MYSQL_DATABASE"' ;;
    sqlite) die "SQLite hat im Nextcloud-Image keinen interaktiven Client – SQL mit -c '…' oder über stdin geben" ;;
esac
