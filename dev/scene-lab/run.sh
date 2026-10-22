#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Scene lab (SPEC-M0 §9.4, SPEC-M1 §8.5, §9.1 WP-S0): builds dev/scene-lab/dist
# on the host with Vite from $ROOT/node_modules (read only), then runs run.mjs
# in a throwaway Playwright container knorke-lab-<pid> with --network none (no
# ports, no Nextcloud). Removed with docker rm -fv on every exit.
#
#   dev/scene-lab/run.sh            deterministic gates (exit 1 on failure), out/gates-<cpu|gpu>[-<label>].{json,md}
#   dev/scene-lab/run.sh measure    measurement report (Phase 2) incl. page memory and GPU evidence,
#                                   out/measure-<chromium|webkit>-<cpu|gpu>[-<set>][-noshadow][-<label>].json +
#                                   out/report-<same>.md; run.mjs args after the mode,
#                                   e.g. measure --viewport 1280x800 --dpr 2, or measure --set noconn
#                                   (the same board without its 800 connectors, A/B of the camera step),
#                                   or measure --shadows off (no note shadows, A/B; names get -noshadow)
#   dev/scene-lab/run.sh dist       only build dist/ (no container)
#   dev/scene-lab/run.sh ipad       build dist/ and pack out/ipad-ra/ (+ .tar.gz) for the tablet
#                                   session R-A (SPEC-M1 §8.8, §16: Android/Chrome, served from
#                                   the Tower): lab, spike bench, session server with start and
#                                   send page (ipad/session*.{mjs,html}), static server for a Mac
#                                   (ipad/serve.mjs, R-B), instruction sheet (ipad/ANLEITUNG-R-A.md);
#                                   then ipad/check.mjs drives the package and the session pages
#                                   in Chromium and WebKit in the same container
#                                   (out/ipad-check[-<label>].{json,md}, copy out/ipad-check.{json,md})
#
# Run evidence (SPEC-M1 §9.0 (R15)/(R16) "Laufbelege", dev/scene-lab/names.js):
# every gates/measure/ipad run writes its reports under its own name (variant
# cpu|gpu = KNORKE_GPU, browser, a set other than m1, -noshadow for
# --shadows off (K8), the optional KNORKE_LAB_LABEL); out/gates.{json,md},
# out/measure.json, out/report.md and out/ipad-check.{json,md} are copies
# of the last run.
#
# Container bounds (gate G17, M0 rest OPS-3; same pattern as dev/e2e/run.sh):
#   - runs as an unprivileged uid without a host account (KNORKE_LAB_UID,
#     default 47001; never 0), all capabilities dropped, no-new-privileges
#   - sees dev/scene-lab READ-ONLY at /work, with an empty tmpfs over /work/out
#   - writes only dev/scene-lab/out, mounted at /out (KNORKE_LAB_OUT=/out)
#   - KNORKE_GPU=1: /dev/dri plus --group-add of the device groups, so the
#     non-root user can open the render node
# One lab run per copy: an exclusive flock on dev/.state/lab.lock covers the
# build (Vite empties dist/) and the container; a second run waits up to
# KNORKE_LAB_LOCK_WAIT seconds (default 1800), then gives up with exit 2.
#
# Environment:
#   KNORKE_LAB_CPUSET     cores for the container (default 8-15)
#   KNORKE_LAB_MEMORY     memory limit (default 6g)
#   KNORKE_LAB_UID        uid/gid of the container (default 47001)
#   KNORKE_LAB_LOCK_WAIT  seconds to wait for the lab lock (default 1800)
#   KNORKE_GPU=1          pass /dev/dri into the container (Chromium on the host GPU)
#   KNORKE_LAB_BROWSER    measure only: chromium (default) or webkit (run.mjs --browser); the
#                         gates always run in Chromium, "ipad" checks Chromium and WebKit
#   KNORKE_LAB_WEBKIT_SKIA  measure with webkit only: cpu (default, Playwright's launcher forces
#                         CPU painting) or gpu (run.mjs --webkit-skia)
#   KNORKE_BENCH_HTML     spike bench for "ipad" (default ../knorke-spike/engine/dist/bench-standalone.html)
#   KNORKE_LAB_LABEL      gates/measure/ipad (not dist): run label ^[a-z0-9-]{1,24}$ appended to the
#                         report names (gates-cpu-r1static.md, ipad-check-r1static.md), passed to
#                         run.mjs or ipad/check.mjs as --label; an invalid one dies before the lock
#
# One-time setup (own node_modules, never $ROOT/node_modules):
#   (cd dev/scene-lab && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.49.1-jammy"
NAME="knorke-lab-$$"
OUT="$HERE/out"
LAB_LOCK="$ROOT/dev/.state/lab.lock"
RUN_UID="${KNORKE_LAB_UID:-47001}"
LOCK_WAIT="${KNORKE_LAB_LOCK_WAIT:-1800}"
CPUSET="${KNORKE_LAB_CPUSET:-8-15}"
BROWSER="${KNORKE_LAB_BROWSER:-chromium}"
WEBKIT_SKIA="${KNORKE_LAB_WEBKIT_SKIA:-cpu}"
MODE="${1:-gates}"
[ $# -gt 0 ] && shift

die() { echo "scene-lab: $*" >&2; exit 1; }

case "$MODE" in
	gates|measure|dist|ipad) ;;
	*) die "usage: $0 [gates|measure|dist|ipad] [run.mjs args]" ;;
esac
# the run label first: an invalid one dies before the lock, the build and any docker call
LABEL="${KNORKE_LAB_LABEL:-}"
if [ -n "$LABEL" ]; then
	[[ "$LABEL" =~ ^[a-z0-9-]{1,24}$ ]] || die "KNORKE_LAB_LABEL='$LABEL' is invalid (^[a-z0-9-]{1,24}\$)"
	# R18-C2 (SPEC-M1 §9.0 (R16) names, audit A-05 (a)): ipad takes the label as well
	# (out/ipad-check-<label>.{json,md}, names.js); only dist, which writes no report, refuses it
	{ [ "$MODE" = gates ] || [ "$MODE" = measure ] || [ "$MODE" = ipad ]; } || die "KNORKE_LAB_LABEL applies to gates, measure and ipad only"
	set -- "$@" --label "$LABEL"
fi
[[ "$RUN_UID" =~ ^[1-9][0-9]{2,5}$ ]] || die "KNORKE_LAB_UID='$RUN_UID' is invalid (not 0, 3–6 digits)"
[[ "$LOCK_WAIT" =~ ^[0-9]{1,5}$ ]] || die "KNORKE_LAB_LOCK_WAIT='$LOCK_WAIT' is invalid"
[[ "$CPUSET" =~ ^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$ ]] || die "KNORKE_LAB_CPUSET='$CPUSET' is invalid"
case "$BROWSER" in chromium|webkit) ;; *) die "KNORKE_LAB_BROWSER='$BROWSER' is invalid (chromium|webkit)" ;; esac
case "$WEBKIT_SKIA" in cpu|gpu) ;; *) die "KNORKE_LAB_WEBKIT_SKIA='$WEBKIT_SKIA' is invalid (cpu|gpu)" ;; esac
# the gates keep their one browser; "ipad" drives both engines itself
if [ "$MODE" != measure ] && { [ "$BROWSER" != chromium ] || [ "$WEBKIT_SKIA" != cpu ]; }; then
	die "KNORKE_LAB_BROWSER/KNORKE_LAB_WEBKIT_SKIA apply to \"measure\" only"
fi
[ "$BROWSER" = webkit ] || [ "$WEBKIT_SKIA" = cpu ] || die "KNORKE_LAB_WEBKIT_SKIA=gpu needs KNORKE_LAB_BROWSER=webkit"
[ -f "$ROOT/node_modules/vite/bin/vite.js" ] || die "vite missing in \$ROOT/node_modules (npm ci of WP-C)"
if [ "$MODE" != dist ]; then
	[ -f "$HERE/node_modules/playwright/package.json" ] || \
		die "playwright missing: (cd dev/scene-lab && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci)"
fi

# One lab run per copy (fd 8 stays open until this script exits).
mkdir -p "$ROOT/dev/.state"
exec 8>>"$LAB_LOCK"
if ! flock -x -n 8; then
	echo "scene-lab: another lab run holds $LAB_LOCK – waiting up to ${LOCK_WAIT}s"
	flock -x -w "$LOCK_WAIT" 8 || { echo "scene-lab: lab lock still held after ${LOCK_WAIT}s – giving up" >&2; exit 2; }
fi

GPU_OPTS=()
if [ "${KNORKE_GPU:-0}" = "1" ] && { [ "$MODE" = gates ] || [ "$MODE" = measure ]; }; then
	[ -e /dev/dri/renderD128 ] || die "KNORKE_GPU=1 but /dev/dri/renderD128 missing"
	GPU_OPTS=(--device /dev/dri)
	# the container user is not root: give it the groups of the device nodes
	for gid in $(stat -c %g /dev/dri/card* /dev/dri/renderD* 2>/dev/null | sort -un); do
		if [ "$gid" = 0 ]; then
			echo "scene-lab: /dev/dri node owned by group 0 – not added (the container stays without root groups)" >&2
			continue
		fi
		GPU_OPTS+=(--group-add "$gid")
	done
	set -- "$@" --gpu
fi
if [ "$MODE" = measure ]; then
	set -- "$@" --browser "$BROWSER"
	if [ "$BROWSER" = webkit ]; then set -- "$@" --webkit-skia "$WEBKIT_SKIA"; fi
fi

cleanup() { docker rm -fv "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "==> build (host): dev/scene-lab/dist"
(cd "$HERE" && node "$ROOT/node_modules/vite/bin/vite.js" build --config "$HERE/vite.lab.config.js") 8>&-
[ -f "$HERE/dist/index.html" ] || die "build produced no dist/index.html"

# Output dir: the only place the container may write (owned by its uid).
mkdir -p "$OUT"
[ -L "$OUT" ] && die "$OUT is a symlink"

if [ "$MODE" = dist ]; then
	echo "==> dist ready: $HERE/dist"
	exit 0
fi

if [ "$MODE" = ipad ]; then
	BENCH="${KNORKE_BENCH_HTML:-$ROOT/../knorke-spike/engine/dist/bench-standalone.html}"
	[ -f "$BENCH" ] || die "spike bench missing: $BENCH (KNORKE_BENCH_HTML)"
	BENCH="$(readlink -f "$BENCH")"
	PKG="$OUT/ipad-ra"
	rm -rf -- "${PKG:?}" "${OUT:?}/ipad-ra.tar.gz"
	mkdir -p "$PKG/lab" "$PKG/bench"
	cp -R "$HERE/dist/." "$PKG/lab/"
	cp "$BENCH" "$PKG/bench/bench-standalone.html"
	cp "$HERE/ipad/serve.mjs" "$HERE/ipad/index.html" "$HERE/ipad/ANLEITUNG-R-A.md" "$PKG/"
	# session server for the Tower (node out/ipad-ra/session.mjs <lan-ip> <port>) and its pages
	cp "$HERE/ipad/session.mjs" "$HERE/ipad/session-start.html" "$HERE/ipad/session-send.html" "$PKG/"
	{
		echo "Knorke Tablet-Messung R-A (SPEC-M1 §8.8, §16) – Paket von dev/scene-lab/run.sh ipad"
		echo "gebaut: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
		echo "konva: $(node -p "require('$ROOT/node_modules/konva/package.json').version")"
		echo "bench: $BENCH"
		echo
		(cd "$PKG" && find . -type f ! -name MANIFEST.txt -print0 | sort -z | xargs -0 sha256sum)
	} >"$PKG/MANIFEST.txt"
	tar -czf "$OUT/ipad-ra.tar.gz" -C "$OUT" ipad-ra
	echo "==> package: $PKG ($(du -sh --apparent-size "$PKG" | cut -f1)), archive $OUT/ipad-ra.tar.gz"
	echo "    on the Tower: node $PKG/session.mjs <lan-address> 18612   (see ANLEITUNG-R-A.md)"
fi

chown "$RUN_UID:$RUN_UID" "$OUT"
chmod 755 "$OUT"
# the files this mode writes; an older copy (root-owned from before the
# hardening) would make the container's write fail
case "$MODE" in
	gates) rm -f -- "$OUT/gates.json" "$OUT/gates.md"; CMD=(node run.mjs --mode "$MODE" "$@") ;;
	measure) rm -f -- "$OUT/measure.json" "$OUT/report.md"; CMD=(node run.mjs --mode "$MODE" "$@") ;;
	ipad) rm -f -- "$OUT/ipad-check.json" "$OUT/ipad-check.md"; CMD=(node ipad/check.mjs --pkg /out/ipad-ra "$@") ;;
esac

echo "==> container $NAME (--network none, uid $RUN_UID, cpuset $CPUSET, /work read-only, out → /out)"
set +e
docker run --rm --name "$NAME" --label knorke=lab --init --network none \
	--user "$RUN_UID:$RUN_UID" --cap-drop ALL --security-opt no-new-privileges \
	--cpuset-cpus "$CPUSET" --memory "${KNORKE_LAB_MEMORY:-6g}" --shm-size 1g \
	${GPU_OPTS[@]+"${GPU_OPTS[@]}"} \
	-v "$HERE:/work:ro" --mount "type=tmpfs,destination=/work/out" -v "$OUT:/out" \
	-e KNORKE_LAB_OUT=/out -e HOME=/tmp -w /work \
	"$IMAGE" "${CMD[@]}" 8>&-
RC=$?
set -e
exit "$RC"
