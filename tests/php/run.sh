#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# PHP tests of Knorke (SPEC-M0 §9).
#
#   tests/php/run.sh unit [phpunit args…]
#       Throwaway container knorke-phpunit-<pid> (${KD_NC_IMAGE:-nextcloud:34-apache},
#       --network none, repo mounted read-only). No dev stack, no database:
#       the Nextcloud sources under /usr/src/nextcloud provide OCP.
#       NC 35: KD_NC_IMAGE=nextcloud:35.0.1-apache tests/php/run.sh unit
#       (no namespace, no protection needed: nothing of a stack is touched)
#
#   KD_NS=b tests/php/run.sh integration [phpunit args…]
#       Inside the running dev stack of namespace KD_NS (container name from
#       dev/.state/$KD_NS/env.json), as www-data, with the stack's real
#       database — any KD_DB kind: pgsql, mariadb, mysql, sqlite, also
#       mariadb/mysql with KD_MYSQL_UTF8MB4=0 — and Redis. The tests ask
#       Nextcloud for the kind (IDBConnection::getDatabaseProvider,
#       supports4ByteText) and adapt; a kind-specific part says so (skip
#       with a reason), none is skipped silently. The bootstrap refuses to
#       run without knorke_dev = true. A protected namespace (KD_PROTECT_NS,
#       default try: the user's stack) is refused with exit 2 unless
#       KD_FORCE=1 (dev/lib.sh, SPEC-M1 §8.1).
#
#   KD_NS=b tests/php/smoke.sh      curl probes of every route (any KD_DB)
#   KD_NS=br tests/php/replica.sh   read replica (dbreplica) probes (pgsql)
#
# PHPUnit comes as PHAR (tools/phpunit.phar, gitignored), downloaded once and
# checked against a pinned SHA-256.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
PHPUNIT_VERSION="11.5.57"
PHPUNIT_SHA256="c704fdd37c6c6ab7adb386f31b4e186cd51156801fa9028b5ea8099a2cd7f106"
PHAR="$ROOT/tools/phpunit.phar"

die() { printf '[php-tests] FEHLER: %s\n' "$*" >&2; exit 1; }

ensure_phar() {
    if [ -f "$PHAR" ] && [ "$(sha256sum "$PHAR" | cut -d' ' -f1)" = "$PHPUNIT_SHA256" ]; then
        return
    fi
    mkdir -p "$ROOT/tools"
    local tmp="$ROOT/tools/.phpunit.phar.part"
    printf '[php-tests] lade PHPUnit %s …\n' "$PHPUNIT_VERSION" >&2
    curl -fsSL -m 120 -o "$tmp" "https://phar.phpunit.de/phpunit-$PHPUNIT_VERSION.phar" || { rm -f "$tmp"; die "Download von PHPUnit fehlgeschlagen"; }
    if [ "$(sha256sum "$tmp" | cut -d' ' -f1)" != "$PHPUNIT_SHA256" ]; then
        rm -f "$tmp"
        die "PHPUnit-PHAR hat nicht die erwartete SHA-256"
    fi
    mv "$tmp" "$PHAR"
}

MODE="${1:-}"
[ $# -gt 0 ] && shift
case "$MODE" in
    unit)
        ensure_phar
        IMAGE="${KD_NC_IMAGE:-nextcloud:34-apache}"
        NAME="knorke-phpunit-$$"
        trap 'docker rm -fv "$NAME" >/dev/null 2>&1 || true' EXIT
        printf '[php-tests] unit auf %s\n' "$IMAGE" >&2
        docker run --rm --name "$NAME" --label knorke=phpunit --network none \
            -e NEXTCLOUD_ROOT=/usr/src/nextcloud \
            -v "$ROOT":/app:ro --entrypoint php "$IMAGE" \
            /app/tools/phpunit.phar -c /app/phpunit.xml "$@"
        ;;
    integration)
        NS="${KD_NS:-main}"
        [[ "$NS" =~ ^[a-z]{1,8}$ ]] || die "KD_NS='$NS' ist ungültig"
        # Protected namespaces (SPEC-M1 §0, §8.1): dev/lib.sh refuses KD_PROTECT_NS
        # (default try, the user's stack) with exit 2 unless KD_FORCE=1, before any
        # docker call. Sourced in a subshell: only its verdict is needed here.
        (KD_NS="$NS" && . "$ROOT/dev/lib.sh") || exit $?
        ensure_phar
        ENV_JSON="$ROOT/dev/.state/$NS/env.json"
        [ -f "$ENV_JSON" ] || die "$ENV_JSON fehlt – erst KD_NS=$NS dev/up.sh"
        NC="$(jq -r '.containers.nc' "$ENV_JSON")"
        [[ "$NC" =~ ^knorke-dev-[a-z]{1,8}-nc$ ]] || die "env.json nennt keinen knorke-dev-*-nc-Container ('$NC')"
        APP="/var/www/html/custom_apps/knorke"
        KIND="$(jq -r '.db.kind // "pgsql"' "$ENV_JSON")"
        UTF8MB4="$(jq -r 'if .db.utf8mb4 == false then " (utf8mb4 aus)" else "" end' "$ENV_JSON")"
        printf '[php-tests] integration in %s, Datenbank %s%s\n' "$NC" "$KIND" "$UTF8MB4" >&2
        docker exec -u www-data "$NC" php "$APP/tools/phpunit.phar" -c "$APP/phpunit.integration.xml" "$@"
        ;;
    *)
        die "Aufruf: tests/php/run.sh unit|integration [phpunit-Argumente]"
        ;;
esac
