#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Removes the dev stack of ONE namespace (SPEC-M0 §8.1) – and only that:
#   - knorke-dev-$NS-{nc,redis,db} (no db with KD_DB=sqlite), then every container labelled
#     knorke=dev-$NS or named knorke-dev-$NS-* / knorke-e2e-$NS-*,
#     always with `docker rm -fv` (a plain rm -f leaves the anonymous volumes
#     of the images behind; they once filled docker.img)
#   - anonymous volumes those containers used, if any survived
#   - the networks knorke-dev-$NS-net and knorke-dev-$NS-back (and any network
#     labelled knorke=dev-$NS or named knorke-dev-$NS-*)
#   - dev/.state/$NS (credentials, env.json)
# Never knorke-lab-* (scene lab), never another namespace, never anything
# else. Foreign knorke-* containers are reported, not touched. A protected
# namespace (KD_PROTECT_NS, default try: the user's stack) is refused with
# exit 2 unless KD_FORCE=1 (dev/lib.sh, SPEC-M1 §8.1).
# Exit 1 if anything of this namespace is left over.
#
# Usage: KD_NS=d dev/down.sh
set -uo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Containers of this namespace: fixed names, label, name prefixes. Name
# filters of docker match substrings, so the prefix is checked again here.
own_containers() {
    {
        for c in "$NC" "$REDIS" "$DB"; do
            container_exists "$c" && printf '%s\n' "$c"
        done
        docker ps -a --filter "label=$LABEL" --format '{{.Names}}' 2>/dev/null
        docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E "^(${DEV_PREFIX}|${E2E_PREFIX})"
    } | awk 'NF && !seen[$0]++'
    return 0
}

own_networks() {
    {
        network_exists "$NET" && printf '%s\n' "$NET"
        docker network ls --filter "label=$LABEL" --format '{{.Name}}' 2>/dev/null
        docker network ls --format '{{.Name}}' 2>/dev/null | grep -E "^${DEV_PREFIX}"
    } | awk 'NF && !seen[$0]++'
    return 0
}

# Second guard before rm: own name prefix or own label, nothing else.
assert_own_or_labelled() {
    local lbl
    lbl="$(docker container inspect -f "{{index .Config.Labels \"$LABEL_KEY\"}}" "$1" 2>/dev/null || true)"
    case "$1" in
        "$DEV_PREFIX"*|"$E2E_PREFIX"*) return 0 ;;
    esac
    [ "$lbl" = "$LABEL_VAL" ] && return 0
    die "interner Schutz: '$1' gehört nicht zum Namensraum $NS"
}

FAILED=0
VOLS=()
CONTAINERS="$(own_containers)"
for c in $CONTAINERS; do
    assert_own_or_labelled "$c"
    # Remember volumes (anonymous ones carry no label) to verify them afterwards.
    while read -r v; do
        [ -n "$v" ] && VOLS+=("$v")
    done < <(docker container inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' "$c" 2>/dev/null || true)
    if docker rm -fv "$c" >/dev/null; then
        log "entfernt: $c (+ anonyme Volumes)"
    else
        warn "docker rm -fv $c schlug fehl"
        FAILED=1
    fi
done

for v in ${VOLS[@]+"${VOLS[@]}"}; do
    if docker volume inspect "$v" >/dev/null 2>&1; then
        if docker volume rm "$v" >/dev/null 2>&1; then
            log "entfernt: übrig gebliebenes Volume $v"
        else
            warn "Volume $v ließ sich nicht entfernen"
            FAILED=1
        fi
    fi
done

for n in $(own_networks); do
    if docker network rm "$n" >/dev/null; then
        log "entfernt: Netz $n"
    else
        warn "docker network rm $n schlug fehl (hängt noch ein fremder Container daran?)"
        FAILED=1
    fi
done

if [ -d "$STATE" ]; then
    rm -rf "${STATE:?}"
    log "entfernt: $STATE"
fi

# --- leftovers ---------------------------------------------------------------
LEFT_C="$(own_containers | tr '\n' ' ')"
LEFT_N="$(own_networks | tr '\n' ' ')"
LEFT_V="$(docker volume ls -q --filter "label=$LABEL" 2>/dev/null | tr '\n' ' ')"
for v in ${VOLS[@]+"${VOLS[@]}"}; do
    docker volume inspect "$v" >/dev/null 2>&1 && LEFT_V="$LEFT_V$v "
done
LEFT_S=""
[ -e "$STATE" ] && LEFT_S="$STATE"
OTHER="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep '^knorke-' | grep -vE "^(${DEV_PREFIX}|${E2E_PREFIX})" | tr '\n' ' ' || true)"
[ -n "${OTHER// /}" ] && log "Hinweis: fremde knorke-* Container, nicht angefasst: $OTHER"

if [ -n "${LEFT_C// /}${LEFT_N// /}${LEFT_V// /}$LEFT_S" ] || [ "$FAILED" = 1 ]; then
    printf '[down %s] FEHLER: übrig: Container [%s] Netze [%s] Volumes [%s] Zustand [%s]\n' \
        "$NS" "$LEFT_C" "$LEFT_N" "$LEFT_V" "$LEFT_S" >&2
    exit 1
fi
log "sauber: keine $DEV_PREFIX*/$E2E_PREFIX* Container, Netze, Volumes oder Zustand mehr"
exit 0
