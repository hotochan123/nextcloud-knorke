#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Theming cachebuster +1 in this namespace's Nextcloud (SPEC-M0 §7.3, §8.1).
# Script URLs carry ?v=<serverHash>-<cachebuster>, WITHOUT the app version,
# and are served as immutable: after every frontend build the browser only
# fetches the new bundle once the cachebuster moves. dev/build.sh calls this
# for every running namespace that mounts its copy (SPEC-M1 §8.1).
#
# A protected namespace (KD_PROTECT_NS, default try) is refused with exit 2
# unless KD_FORCE=1 (dev/lib.sh). Works with a pre-R5 env.json, too (try): it
# needs nothing from env.json but the namespace (SPEC-M1 §3.8).
#
# Usage: KD_NS=d dev/bust.sh      (prints the new value)
#        KD_FORCE=1 KD_NS=try dev/bust.sh   (the user, in $ROOT, after a build)
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_running
CUR="$(occ config:app:get theming cachebuster 2>/dev/null || true)"
CUR="${CUR//[^0-9]/}"
[ -n "$CUR" ] || CUR=0
NEW=$((CUR + 1))
occ config:app:set theming cachebuster --value="$NEW" >/dev/null
log "theming cachebuster $CUR → $NEW"
printf '%s\n' "$NEW"
