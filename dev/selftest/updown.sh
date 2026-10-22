#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Matrix self-test of dev/up.sh and dev/down.sh (SPEC-M0 §10, WP-D Phase 1;
# database matrix round 2 U2): for every combination of Nextcloud image × app
# (placeholder, real app) × database in ONE namespace: up.sh (incl. app:enable
# and the 401 probe) → env.json complete → dev/selftest/isolation.sh (networks,
# Redis password, side channels, charset) → optionally tests/php/smoke.sh →
# down.sh → nothing of the namespace left (docker ps -a / network ls /
# volume ls / dev/.state/$NS). Containers of other namespaces must still be
# there afterwards (their owners may start or stop their own stacks
# meanwhile; a container that vanished is reported, never touched).
#
# Usage: KD_NS=d dev/selftest/updown.sh [image …]
#        (default images: nextcloud:34-apache nextcloud:35.0.1-apache)
# Knobs: KD_UPDOWN_DBS   databases, default "pgsql"; all of them:
#                        "pgsql mariadb mysql sqlite mariadb-utf8mb3"
#                        (<kind>-utf8mb3 = KD_DB=<kind> KD_MYSQL_UTF8MB4=0)
#        KD_UPDOWN_APPS  both (default) | real | placeholder
#        KD_UPDOWN_SMOKE 1 = tests/php/smoke.sh after up (real app only)
#        KD_PORT         as for up.sh (namespaces outside main/b/c/d need it)
# Refuses to start when the namespace already has a stack.
set -uo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

IMAGES=("$@")
[ "${#IMAGES[@]}" -gt 0 ] || IMAGES=(nextcloud:34-apache nextcloud:35.0.1-apache)
case "${KD_UPDOWN_APPS:-both}" in
    both) APPS=("dev/selftest/placeholder" "$ROOT") ;;
    real) APPS=("$ROOT") ;;
    placeholder) APPS=("dev/selftest/placeholder") ;;
    *) die "KD_UPDOWN_APPS='${KD_UPDOWN_APPS}' ist ungültig (both|real|placeholder)" ;;
esac
read -r -a DBS <<<"${KD_UPDOWN_DBS:-pgsql}"
for db in "${DBS[@]}"; do
    valid_db_kind "${db%-utf8mb3}" || die "KD_UPDOWN_DBS: '$db' ist unbekannt"
done
SMOKE="${KD_UPDOWN_SMOKE:-0}"

if container_exists "$NC" || container_exists "$DB" || network_exists "$NET"; then
    die "Namensraum $NS hat schon einen Stack – erst KD_NS=$NS dev/down.sh"
fi

others() {
    docker ps -a --format '{{.ID}} {{.Names}}' | awk '$2 ~ /^knorke-/' | grep -vE " (${DEV_PREFIX}|${E2E_PREFIX})" | sort || true
}

leftovers() {
    {
        docker ps -a --format '{{.Names}}' | grep -E "^(${DEV_PREFIX}|${E2E_PREFIX})" | sed 's/^/Container /'
        docker ps -a --filter "label=$LABEL" --format '{{.Names}}' | sed 's/^/Container(Label) /'
        docker network ls --format '{{.Name}}' | grep -E "^${DEV_PREFIX}" | sed 's/^/Netz /'
        docker network ls --filter "label=$LABEL" --format '{{.Name}}' | sed 's/^/Netz(Label) /'
        docker volume ls -q --filter "label=$LABEL" | sed 's/^/Volume(Label) /'
        [ -e "$STATE" ] && echo "Zustand $STATE"
    } | sort -u
    return 0
}

PASS=0
FAIL=0
LINES=()
VOL0="$(docker volume ls -q | sort)"
for img in "${IMAGES[@]}"; do
  for db in "${DBS[@]}"; do
    kind="${db%-utf8mb3}"
    utf8mb4=1
    [ "$db" != "$kind" ] && utf8mb4=0
    for app in "${APPS[@]}"; do
        label="$img + $db + $( [ "$app" = "$ROOT" ] && echo 'echte App' || echo 'Platzhalter' )"
        log "=== $label"
        before="$(others)"
        t0=$(date +%s)
        ok=1
        smoke=""
        if ! KD_NS="$NS" KD_NC_IMAGE="$img" KD_APP_DIR="$app" KD_DB="$kind" KD_MYSQL_UTF8MB4="$utf8mb4" "$DEV/up.sh"; then
            ok=0
            warn "up.sh scheiterte ($label)"
        elif ! jq -e --arg img "$img" --arg kind "$kind" '.versions.image == $img and .db.kind == $kind and (.gatewayIp | test("^[0-9.]+$")) and (.containers.nc | startswith("knorke-dev-")) and (.redis.pass | length) >= 24' "$ENV_JSON" >/dev/null; then
            ok=0
            warn "env.json unvollständig ($label)"
        elif ! KD_NS="$NS" "$DEV/selftest/isolation.sh"; then
            ok=0
            warn "Isolation/Seitenkanäle rot ($label)"
        elif [ "$SMOKE" = 1 ] && [ "$app" = "$ROOT" ]; then
            if KD_NS="$NS" "$ROOT/tests/php/smoke.sh" >"$STATE/smoke.log" 2>&1; then
                smoke=", Smoke $(tail -n 1 "$STATE/smoke.log")"
            else
                ok=0
                tail -n 30 "$STATE/smoke.log" >&2
                smoke=", Smoke ROT"
                warn "Smoke rot ($label)"
            fi
        fi
        enabled="$(KD_NS="$NS" "$DEV/occ.sh" app:list --output=json 2>/dev/null | jq -r '.enabled.knorke // "aus"' || echo '?')"
        ncv="$(jq -r '.versions.nextcloud // "?"' "$ENV_JSON" 2>/dev/null || echo '?')"
        KD_NS="$NS" "$DEV/down.sh" || { ok=0; warn "down.sh meldet Reste ($label)"; }
        left="$(leftovers)"
        if [ -n "$left" ]; then
            ok=0
            warn "übrig nach down.sh: $(printf '%s' "$left" | tr '\n' ';')"
        fi
        after="$(others)"
        gone="$(comm -23 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | grep -v '^$' || true)"
        [ -n "$gone" ] && warn "fremde knorke-* Container verschwunden (Eigentümer?): $gone"
        dt=$(( $(date +%s) - t0 ))
        if [ "$ok" = 1 ]; then
            PASS=$((PASS + 1))
            LINES+=("ok    $label: NC $ncv, knorke $enabled${smoke}, up+down ${dt}s, keine Reste")
        else
            FAIL=$((FAIL + 1))
            LINES+=("FEHLER $label (NC $ncv, knorke $enabled${smoke}, ${dt}s)")
        fi
    done
  done
done
VOL1="$(docker volume ls -q | sort)"
NEWVOL="$(comm -13 <(printf '%s\n' "$VOL0") <(printf '%s\n' "$VOL1") | grep -v '^$' || true)"

printf '\n'
for l in "${LINES[@]}"; do printf '%s\n' "$l"; done
if [ -n "$NEWVOL" ]; then
    printf 'Hinweis: neue Volumes seit dem Start (evtl. von anderen Paketen): %s\n' "$(printf '%s ' $NEWVOL)"
fi
printf '==== up/down-Matrix %s: %s ok / %s fehlgeschlagen ====\n' "$NS" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
