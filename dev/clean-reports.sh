#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Removes old reports of dev/e2e and dev/sim (SPEC-M1 §8.1). Two kinds:
#
#   --legacy  the report layout from before SPEC-M0 round 5: everything
#             directly in dev/e2e/out/ and dev/sim/out/ that is no namespace
#             directory – report.{md,json}, shots/, bridge/,
#             contract.{md,json}, converge.{md,json}, the reserved names
#             shots, report, bridge, out (dev/lib.sh KD_RESERVED_NS)
#   --stale   the output directories dev/e2e/out/<ns>/ and dev/sim/out/<ns>/ of
#             namespaces whose Nextcloud does not run right now and that are
#             not protected (KD_PROTECT_NS, default try). That includes the
#             folder dev/e2e/out/dl that a run before round 2 U4 left behind as
#             uid 1000 (the image's pwuser, a real account on this host).
#
# Without --legacy/--stale both kinds are meant. The DEFAULT is a dry run
# (--dry-run): it only lists what would go. --apply deletes. Nothing outside
# dev/e2e/out and dev/sim/out of THIS copy is ever touched; a symlink is
# removed itself, never followed; a protected or running namespace is never
# touched. dev/scene-lab/out belongs to the scene lab and is not looked at.
#
# The script works across namespaces (like dev/build.sh): KD_NS is ignored. It
# only reads Docker (docker ps / container inspect via dev/lib.sh
# running_namespaces) and only for --stale.
#
# Usage: dev/clean-reports.sh [--legacy] [--stale] [--dry-run | --apply]
# Exit:  0 done (or nothing to do), 1 error, 2 refused (an out dir is a symlink)
set -euo pipefail

# Works across namespaces: a KD_NS in the caller's environment must not pick a
# namespace (nor trip the namespace guard of dev/lib.sh).
unset KD_NS
# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS="*"   # only the log prefix uses NS from here on

LEGACY=0
STALE=0
APPLY=0
for a in "$@"; do
    case "$a" in
        --legacy) LEGACY=1 ;;
        --stale) STALE=1 ;;
        --dry-run) APPLY=0 ;;
        --apply) APPLY=1 ;;
        -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
        *) die "unbekanntes Argument '$a' (dev/clean-reports.sh [--legacy] [--stale] [--dry-run | --apply])" ;;
    esac
done
if [ "$LEGACY" = 0 ] && [ "$STALE" = 0 ]; then
    LEGACY=1
    STALE=1
fi

OUT_DIRS=("$DEV/e2e/out" "$DEV/sim/out")

# is_ns_dir NAME: a directory name that can be a namespace (not reserved).
is_ns_name() {
    [[ "$1" =~ ^[a-z]{1,8}$ ]] || return 1
    case " $KD_RESERVED_NS " in *" $1 "*) return 1 ;; esac
    return 0
}

RUNNING=" "
if [ "$STALE" = 1 ]; then
    command -v docker >/dev/null || die "docker fehlt – --stale braucht docker ps (nur lesend)"
    RUNNING=" $(running_namespaces | tr '\n' ' ')"
fi

N=0
# drop PATH REASON: deletes (or lists) one entry below an out dir.
drop() {
    local p="$1" why="$2" parent
    parent="$(dirname "$p")"
    case " ${OUT_DIRS[*]} " in
        *" $parent "*) ;;
        *) die "interner Schutz: $p liegt nicht direkt in dev/e2e/out oder dev/sim/out" ;;
    esac
    N=$((N + 1))
    if [ "$APPLY" = 0 ]; then
        printf 'würde löschen: %s (%s)\n' "${p#"$ROOT"/}" "$why"
        return 0
    fi
    if [ -L "$p" ] || [ ! -d "$p" ]; then
        rm -f -- "$p"
    else
        rm -rf -- "${parent:?}/$(basename "$p")"
    fi
    printf 'gelöscht: %s (%s)\n' "${p#"$ROOT"/}" "$why"
}

for out in "${OUT_DIRS[@]}"; do
    [ -e "$out" ] || [ -L "$out" ] || continue
    [ -L "$out" ] && refuse "${out#"$ROOT"/} ist ein Symlink – nicht angefasst"
    [ -d "$out" ] || die "${out#"$ROOT"/} ist kein Verzeichnis"
    while IFS= read -r -d '' p; do
        name="$(basename "$p")"
        if [ -L "$p" ]; then
            [ "$LEGACY" = 1 ] && drop "$p" "Symlink, kein Namensraum-Verzeichnis"
            continue
        fi
        if [ -d "$p" ] && is_ns_name "$name"; then
            [ "$STALE" = 1 ] || continue
            if is_protected "$name"; then
                log "behalten: ${p#"$ROOT"/} (Namensraum $name ist geschützt)"
            elif [[ "$RUNNING" == *" $name "* ]]; then
                log "behalten: ${p#"$ROOT"/} (Namensraum $name läuft)"
            else
                owner="$(stat -c %u "$p" 2>/dev/null || echo '?')"
                drop "$p" "Namensraum $name läuft nicht$([ "$owner" = 0 ] || printf ', Besitzer uid %s' "$owner")"
            fi
            continue
        fi
        [ "$LEGACY" = 1 ] && drop "$p" "Bericht von vor Runde 5 (kein Namensraum-Verzeichnis)"
    done < <(find "$out" -mindepth 1 -maxdepth 1 -print0 | sort -z)
done

if [ "$APPLY" = 0 ]; then
    log "Trockenlauf: $N Einträge würden gelöscht ($([ "$LEGACY" = 1 ] && printf -- '--legacy ')$([ "$STALE" = 1 ] && printf -- '--stale')); löschen mit --apply"
else
    log "$N Einträge gelöscht"
fi
