#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# occ in this namespace's Nextcloud, as www-data (SPEC-M0 §8.1).
# A TTY is only allocated when both stdin and stdout are terminals, so the
# output stays clean when a script captures it.
#
# A protected namespace (KD_PROTECT_NS, default try) is refused with exit 2
# unless KD_FORCE=1 (dev/lib.sh). Works with a pre-R5 env.json, too (try): it
# needs nothing from env.json but the namespace (SPEC-M1 §3.8).
#
# Usage: KD_NS=d dev/occ.sh app:list
#        KD_FORCE=1 KD_NS=try dev/occ.sh upgrade   (the user, in $ROOT)
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_running
TTY=(-i)
[ -t 0 ] && [ -t 1 ] && TTY=(-it)
exec docker exec "${TTY[@]}" -u www-data "$NC" php occ "$@"
