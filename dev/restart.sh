#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Restarts this namespace's Nextcloud container and checks the app route
# (SPEC-M0 §8.1). Needed after every NEW route: Nextcloud caches the route
# table in APCu, a new route answers 404 until the container restarts.
# 404 = cache (or app disabled), 401 = route exists.
#
# A protected namespace (KD_PROTECT_NS, default try) is refused with exit 2
# unless KD_FORCE=1 (dev/lib.sh). A pre-R5 env.json (try: one network in
# .network, no .networks) works through the fallbacks of dev/lib.sh
# (SPEC-M1 §3.8, §8.1).
#
# Usage: KD_NS=d dev/restart.sh
#        KD_FORCE=1 KD_NS=try dev/restart.sh   (the user, in $ROOT)
set -euo pipefail

# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_running
PORT="$(nc_port)"
log "docker restart $NC"
docker restart "$NC" >/dev/null
wait_nc "$PORT" 240
probe_401 "$PORT"

# Docker normally keeps the address across a restart; if not, env.json follows.
if [ -f "$ENV_JSON" ]; then
    IP="$(nc_ip)"
    OLD="$(env_get '.ncIp')"
    if [ -n "$IP" ] && [ "$IP" != "$OLD" ]; then
        (umask 077 && jq --arg ip "$IP" '.ncIp = $ip' "$ENV_JSON" >"$ENV_JSON.tmp" && mv "$ENV_JSON.tmp" "$ENV_JSON")
        log "Container-IP hat sich geändert: ${OLD:-?} → $IP (env.json nachgeführt, Netz $(env_front_net))"
    fi
fi
