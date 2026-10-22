#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Upgrade path older code → this code with real data (SPEC-M1 §3.8
# "Prüfpfad", stage 0, wave W2; since the M2 data foundation also 0.2.0 →
# 0.3.0): what the user does once with the try stack, played through in a
# throwaway namespace (default br, port 18584). The names M0 (older code)
# and M1 (this code) come from the first run, M0 0.1.0 → M1 0.2.0.
#
#   1. staging directory dev/.state/<ns>/app (rsync on the host), mounted
#      READ-ONLY as the app (KD_APP_DIR); the older code goes in first – by
#      default the frozen snapshot claude_projects/.knorke-m1-phase/0.0, the
#      copy of $ROOT taken when M1 started (M0 0.1.0; read only, never
#      written), or KD_UPGRADE_M0, e.g. the 0.2.0 state from git (git archive
#      of the merge base, inside the worktree). The older code has no js/, so
#      up.sh runs with KD_SKIP_BUILD_CHECK=1: its data is seeded through the
#      API. Not root-base: that snapshot follows every flow-back and holds
#      0.2.0 since the flow-back of stage 0 (12.10.2026), so it is no M0 any
#      more (ENTWICKLUNG trap 9.31)
#   2. dev/up.sh (KD_DB as chosen), then data through the API of the older
#      code in its protocol (1: M0 API without ep; 2: with the epoch): 2
#      boards, notes, a frame with children, a deleted note, an edit link, bob
#      as a link member, a guest with a token; protocol 2 adds a shape and a
#      connector (dev/selftest/lib/upgrade-data.mjs seed)
#   3. this code rsync'ed over the staging directory (default: this copy,
#      with the patterns of dev/m1-copy-exclude.txt, including the built js/)
#   4. the user's runbook (§3.8 step 2): appstoreenabled must be false, then
#      `occ upgrade`, dev/bust.sh, dev/restart.sh (APCu route cache: without the
#      restart routes 17–26 answer 404). `occ upgrade` is red when it fails,
#      when it prints a "Repair error" (it still exits 0 then) and when it
#      updates any app but knorke (dev/selftest/lib/upgrade-output.mjs)
#   5. checks: the seeded boards (upgrade-data.mjs verify: same items, titles,
#      guest token, member access, the migrations and the version of the
#      staging directory, with the M2 migration group/lock null everywhere),
#      tests/php/smoke.sh and the contract (dev/sim/run.sh contract: every
#      case of this copy)
#   6. dev/down.sh (unless --keep)
#
# Reports (run evidence, SPEC-M1 §9.0 R15 point 2, R16): every report of a run
# carries the database and an optional run label in its name, so two runs in
# the same namespace never overwrite each other –
#   dev/sim/out/<ns>/upgrade-<db>-{seed,verify,contract}[-<label>].{md,json}
# with <db> = the value of --db verbatim (pgsql, mariadb-utf8mb3, …) and
# <label> = KD_RUN_LABEL (^[a-z0-9-]{1,24}$, optional), e.g.
# upgrade-pgsql-contract-r1w2.md. The suites write them themselves
# (KD_REPORT_STEM, dev/sim/lib/report.mjs); dev/selftest/runEvidence.test.mjs
# pins it.
#
# Usage: dev/selftest/upgrade.sh [--db pgsql|mariadb-utf8mb3|mariadb|mysql|sqlite] [--keep] [--quick]
#        KD_NS (default br) · KD_RUN_LABEL (optional run label of the report names)
#        KD_UPGRADE_M0 (older code, default the snapshot 0.0)
#        KD_UPGRADE_M1 (newer code, default this copy) · KD_NC_IMAGE as for up.sh
#   --quick  only the seeded boards in step 5 (no smoke, no contract)
#   --keep   leave the stack running afterwards (KD_NS=<ns> dev/down.sh)
# Wave W2 runs it twice, one after the other: --db pgsql and --db mariadb-utf8mb3.
# Exit 0 = every step green, 1 = a step red (the summary names it), 2 = refused
# or the stack could not be prepared.
#
# A protected namespace (KD_PROTECT_NS, default try) is refused with exit 2
# unless KD_FORCE=1 (dev/lib.sh), before any docker call.
set -euo pipefail

export KD_NS="${KD_NS:-br}"
# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

DBSEL=pgsql
KEEP=0
QUICK=0
while [ $# -gt 0 ]; do
    case "$1" in
        --db) DBSEL="${2:-}"; shift 2 || die "--db braucht einen Wert" ;;
        --keep) KEEP=1; shift ;;
        --quick) QUICK=1; shift ;;
        -h|--help) sed -n '2,61p' "$0"; exit 0 ;;
        *) die "unbekanntes Argument '$1'" ;;
    esac
done
UTF8MB4=1
case "$DBSEL" in
    pgsql|mariadb|mysql|sqlite) DBKIND="$DBSEL" ;;
    mariadb-utf8mb3) DBKIND=mariadb; UTF8MB4=0 ;;
    mysql-utf8mb3) DBKIND=mysql; UTF8MB4=0 ;;
    *) die "--db '$DBSEL' ist ungültig (pgsql, mariadb, mysql, sqlite, mariadb-utf8mb3, mysql-utf8mb3)" ;;
esac
# run-evidence names (header): upgrade-<db>-<part>[-<label>], checked before any docker call
RUN_LABEL="${KD_RUN_LABEL:-}"
if [ -n "$RUN_LABEL" ] && ! [[ "$RUN_LABEL" =~ ^[a-z0-9-]{1,24}$ ]]; then
    die "KD_RUN_LABEL '$RUN_LABEL' ist ungültig (^[a-z0-9-]{1,24}\$)"
fi
# report_stem PART: the file stem of one report of this run (seed, verify, contract)
report_stem() { printf 'upgrade-%s-%s%s' "$DBSEL" "$1" "${RUN_LABEL:+-$RUN_LABEL}"; }

M0_DIR="${KD_UPGRADE_M0:-$(beside_root .knorke-m1-phase/0.0)}"
M1_DIR="${KD_UPGRADE_M1:-$ROOT}"
for d in "$M0_DIR" "$M1_DIR"; do
    in_prod_stack "$d" && die "$d liegt im Prod-Stack – verweigert"
    [ -f "$d/appinfo/info.xml" ] || die "$d/appinfo/info.xml fehlt"
done
M0_VER="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$M0_DIR/appinfo/info.xml" | head -n 1)"
M1_VER="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$M1_DIR/appinfo/info.xml" | head -n 1)"
# the M0 code must be OLDER than the M1 code (sort -V), not merely different
OLDER="$(printf '%s\n%s\n' "$M0_VER" "$M1_VER" | sort -V | head -n 1)"
{ [ "$M0_VER" != "$M1_VER" ] && [ "$OLDER" = "$M0_VER" ]; } \
    || die "M0 ($M0_DIR, $M0_VER) ist nicht älter als M1 ($M1_DIR, $M1_VER) – kein Upgrade (KD_UPGRADE_M0 auf einen M0-Stand setzen; root-base folgt jedem Rückfluss)"
[ -f "$M1_DIR/js/knorke-main.mjs" ] || die "$M1_DIR/js/knorke-main.mjs fehlt – das M1-Bündel muss gebaut sein (dev/build.sh, Paket [C])"
[ -f "$ENV_JSON" ] && die "$ENV_JSON existiert – Stack '$NS' läuft schon (erst KD_NS=$NS dev/down.sh)"
container_exists "$NC" && die "Container $NC existiert schon – erst KD_NS=$NS dev/down.sh"
command -v rsync >/dev/null || die "rsync fehlt"

APP="$STATE/app"
SUMMARY=()
RED=0
step() { SUMMARY+=("$1 $2"); [ "$1" = ok ] || RED=1; log "[$1] $2"; }

cleanup() {
    local rc=$?
    if [ "$KEEP" = 0 ]; then
        KD_NS="$NS" "$DEV/down.sh" >/dev/null 2>&1 || warn "down.sh meldet Reste – KD_NS=$NS dev/down.sh"
    else
        log "--keep: Stack $NS läuft weiter (KD_NS=$NS dev/down.sh)"
    fi
    if [ "${#SUMMARY[@]}" -gt 0 ]; then
        printf '\n==== upgrade %s (%s, %s → %s) ====\n' "$NS" "$DBSEL" "$M0_VER" "$M1_VER" >&2
        printf '  %s\n' "${SUMMARY[@]}" >&2
    fi
    exit "$rc"
}
trap cleanup EXIT

# --- 1. staging directory with the M0 code -----------------------------------
umask 077
state_dir >/dev/null
mkdir -p "$APP"
chmod 755 "$APP"
log "M0-Stand $M0_VER aus $M0_DIR → $APP"
rsync -a --delete --exclude-from="$DEV/m1-flow-exclude.txt" "$M0_DIR/" "$APP/"
chmod 755 "$APP"
grep -q "<version>$M0_VER</version>" "$APP/appinfo/info.xml" || die "Staging hat nicht den M0-Stand"

# --- 2. up (M0) + seed ---------------------------------------------------------
UP_ENV=(KD_APP_DIR="$APP" KD_SKIP_BUILD_CHECK=1 KD_DB="$DBKIND")
[ "$UTF8MB4" = 0 ] && UP_ENV+=(KD_MYSQL_UTF8MB4=0)
log "up.sh ($DBSEL, M0)"
if ! env "${UP_ENV[@]}" "$DEV/up.sh"; then
    step rot "up.sh mit dem M0-Stand"
    exit 2
fi
NCV="$(jq -r '.versions.nextcloud' "$ENV_JSON")"
step ok "up.sh: NC $NCV, $(jq -r '.versions.db' "$ENV_JSON"), App $(occ config:app:get knorke installed_version 2>/dev/null || echo '?')"
if KD_REPORT_STEM="$(report_stem seed)" node "$DEV/selftest/lib/upgrade-data.mjs" seed; then
    step ok "Daten des älteren Stands $M0_VER gesät (dev/sim/out/$NS/$(report_stem seed).md)"
else
    step rot "Daten des älteren Stands $M0_VER säen"
    exit 2
fi

# --- 3. M1 code over the staging directory --------------------------------------
log "M1-Stand $M1_VER aus $M1_DIR → $APP (mit js/)"
rsync -a --delete --exclude-from="$DEV/m1-copy-exclude.txt" "$M1_DIR/" "$APP/"
chmod 755 "$APP"
grep -q "<version>$M1_VER</version>" "$APP/appinfo/info.xml" || die "Staging hat nicht den M1-Stand"
NEEDS="$(occ status --output=json 2>/dev/null | sed -n 's/^[^{]*//p' | jq -r '.needsDbUpgrade')"
if [ "$NEEDS" = true ]; then step ok "occ status: needsDbUpgrade = true (Versionssprung $M0_VER → $M1_VER erkannt)"; else step rot "occ status: needsDbUpgrade = $NEEDS statt true"; fi

# --- 4. the user's runbook (§3.8 step 2) ------------------------------------------
STORE="$(occ config:system:get appstoreenabled 2>/dev/null || true)"
if [ "$STORE" = false ]; then
    step ok "appstoreenabled = false (occ upgrade zieht keine Store-Updates)"
else
    step rot "appstoreenabled = '$STORE' statt false – Abbruch vor occ upgrade"
    exit 1
fi
if UPG="$(occ upgrade 2>&1)"; then
    printf '%s\n' "$UPG" | sed 's/^/    /' >&2
    REPAIR_ERR="$(node "$DEV/selftest/lib/upgrade-output.mjs" repair-errors <<<"$UPG")" || die "upgrade-output.mjs schlug fehl"
    if [ -z "$REPAIR_ERR" ]; then
        step ok "occ upgrade (ohne Reparaturfehler)"
    else
        step rot "occ upgrade meldet Reparaturfehler: $(printf '%s' "$REPAIR_ERR" | tr '\n' ' ' | cut -c1-400)"
    fi
else
    printf '%s\n' "$UPG" | sed 's/^/    /' >&2
    step rot "occ upgrade"
    exit 1
fi
if ! printf '%s\n' "$UPG" | grep -qi 'knorke'; then
    warn "occ upgrade nennt knorke nicht"
fi
UPDATED="$(node "$DEV/selftest/lib/upgrade-output.mjs" other-apps <<<"$UPG")" || die "upgrade-output.mjs schlug fehl"
if [ -z "$UPDATED" ]; then step ok "occ upgrade hat keine andere App aktualisiert"; else step rot "occ upgrade hat weitere Apps angefasst: $UPDATED"; fi
if "$DEV/bust.sh" >/dev/null; then step ok "bust.sh"; else step rot "bust.sh"; fi
if "$DEV/restart.sh"; then step ok "restart.sh (401-Probe)"; else step rot "restart.sh"; exit 1; fi
NEEDS="$(occ status --output=json 2>/dev/null | sed -n 's/^[^{]*//p' | jq -r '.needsDbUpgrade')"
if [ "$NEEDS" = false ]; then step ok "occ status: needsDbUpgrade = false"; else step rot "occ status: needsDbUpgrade = $NEEDS"; fi
# a stub route of stage 0 answers (no 404 of the route cache)
STUB="$(curl -s -o /dev/null -m 20 -w '%{http_code}' -H 'Host: localhost' "http://127.0.0.1:$(nc_port)/index.php/apps/knorke/api/v1/boards/1/shares" || true)"
if [ "$STUB" = 401 ]; then step ok "neue Route 19 (shares) anonym → 401 (Route existiert)"; else step rot "neue Route 19 (shares) anonym → $STUB statt 401"; fi

# --- 5. checks -------------------------------------------------------------------
if KD_REPORT_STEM="$(report_stem verify)" node "$DEV/selftest/lib/upgrade-data.mjs" verify; then
    step ok "gesäte Boards nach dem Upgrade (dev/sim/out/$NS/$(report_stem verify).md)"
else
    step rot "gesäte Boards nach dem Upgrade (dev/sim/out/$NS/$(report_stem verify).md)"
fi
if [ "$QUICK" = 0 ]; then
    if KD_NS="$NS" "$ROOT/tests/php/smoke.sh"; then step ok "tests/php/smoke.sh"; else step rot "tests/php/smoke.sh (Exit $?)"; fi
    if KD_NS="$NS" KD_REPORT_STEM="$(report_stem contract)" "$DEV/sim/run.sh" contract; then step ok "Vertrag (dev/sim/out/$NS/$(report_stem contract).md)"; else step rot "Vertrag (dev/sim/out/$NS/$(report_stem contract).md)"; fi
else
    step ok "--quick: Smoke und Vertrag ausgelassen"
fi
[ "$RED" = 0 ] || exit 1
exit 0
