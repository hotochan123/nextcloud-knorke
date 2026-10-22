#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 hotochan123
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Release directory for production (SPEC-M1 §10 P9, Revision 19 T4-08): the
# source of the user's copy to nextcloud_html/custom_apps/knorke. With --key
# and --cert also the signed build for the App Store (docs/ENTWICKLUNG.md §11).
#
#   dev/release.sh            → dev/release/out/knorke-<version>/
#                               dev/release/out/knorke-<version>.tar.gz (top folder knorke/)
#                               dev/release/out/knorke-<version>.tar.gz.sha256
#   dev/release.sh --key <private key> --cert <certificate>
#                             → the same unsigned release, then (step 5)
#                               dev/release/out/signed/knorke-<version>/ (with appinfo/signature.json)
#                               dev/release/out/signed/knorke-<version>.tar.gz
#                               dev/release/out/signed/knorke-<version>.tar.gz.sha256
#                               dev/release/out/signed/knorke-<version>.tar.gz.sig
#                               stdout: only the App Store signature (= the .sig file)
#
# 1. node build/check-fresh.mjs must report "0 differing" (and exit 0): js/
#    and css/ are built from exactly the sources on disk (SPEC-M1 §6.13,
#    R18/R19); its indented CSS line "  css: <n> src/styles entries, 0 differing,
#    0 missing" must be there (T4-26). A stale bundle never becomes a release.
# 2. The version comes from appinfo/info.xml (<version>, x.y.z).
# 3. Copied: exactly the runtime folders RUNTIME_DIRS and the root files
#    RUNTIME_FILES – never dev/, tests/, node_modules/, src/, build/, docs/,
#    tools/, no companion file of the checks (EXCLUDE: js/knorke-style.fresh.json,
#    T4-26) and no code signature (EXCLUDE: appinfo/signature.json; with it
#    Nextcloud checks the app's integrity from then on). dev/selftest/release.test.mjs
#    pins both lists.
# 4. The archive holds the folder knorke/ (the app id, as Nextcloud expects
#    it below custom_apps/), its entries sorted, owner 0, one fixed mtime, so
#    the same tree gives the same archive; the .sha256 file is in the format
#    of sha256sum (check with: cd dev/release/out && sha256sum -c knorke-<v>.tar.gz.sha256).
# 5. Only with --key and --cert (both, each once, the value after a blank;
#    any other form is usage). Checked before step 1, nothing written yet: key
#    and certificate are readable regular files and the key's real path
#    (symlinks resolved) is not below $ROOT (else exit 2); docker and openssl
#    exist (else exit 1). After step 4 the release directory is copied to
#    signed/, signed with occ integrity:sign-app in a throwaway SIGN_IMAGE
#    container (as root, no network, no installed Nextcloud; key and
#    certificate mounted read-only as single files, the repo not at all).
#    The host then checks that the signed tree is exactly the release plus
#    appinfo/signature.json (no other, changed, removed or linked file; the
#    differences go to stderr) and that it holds no PEM private key (the
#    release is scanned too, before any docker call), then occ
#    integrity:check-app verifies it (without the key; it refuses a
#    certificate Nextcloud did not issue). With umask 022, modes normalised, packed
#    as in step 4, and the archive signed with openssl dgst -sha512 on the
#    host (the App Store signature, base64). Any failure removes the container
#    and the four signed paths of this version; the unsigned release stays. A
#    key with a passphrase is not supported (sign-app cannot read it: exit 1).
#
# The key is never copied, written below dev/release/out, logged or printed.
# The signed build is for the App Store only: factory/deploy.sh and the manual
# ways (P9, hotfix) take the unsigned dev/release/out/knorke-<version>.tar.gz,
# and a run without arguments never touches dev/release/out/signed/.
#
# Nothing outside dev/release/out is written; an existing release directory
# of the same version is replaced. Needs node, tar, gzip, sha256sum; signing
# also docker, openssl and diff.
# Exit: 0 written; 1 check-fresh not green, a step failed, signing, check-app
# or openssl failed, or docker or openssl missing; 2 usage, also a key in the
# repository or a key or certificate that is missing or not readable.
set -euo pipefail

# release.sh works on no namespace: a KD_NS in the caller's environment must not
# pick one (nor trip the namespace guard of dev/lib.sh); like dev/build.sh.
unset KD_NS
# shellcheck source=dev/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

OUT="$DEV/release/out"
APP_ID=knorke
RUNTIME_DIRS="appinfo lib templates img js css l10n"
RUNTIME_FILES="LICENSE README.md CHANGELOG.md"
# companion files of the checks and the code signature inside the runtime folders: never shipped
EXCLUDE="js/knorke-style.fresh.json appinfo/signature.json"
# one mtime for every archive entry (reproducible archive)
MTIME="2026-01-01 00:00:00 UTC"
# image of the throwaway signing container (step 5); fixed, no override
SIGN_IMAGE="nextcloud:34-apache"

USAGE="usage: dev/release.sh [--key <privater Schlüssel> --cert <Zertifikat>]"
usage() { printf '%s\n' "$USAGE" >&2; exit 2; }
# bad MSG: exit 2 before anything is written (a key or certificate that cannot be used)
bad() { printf '[%s %s] FEHLER: %s\n' "$KD_TAG" "$NS" "$*" >&2; exit 2; }

KEY=""
CERT=""
while [ $# -gt 0 ]; do
    case "$1" in
        --key | --cert)
            [ $# -ge 2 ] || usage
            case "$2" in "" | -*) usage ;; esac
            if [ "$1" = --key ]; then
                [ -z "$KEY" ] || usage
                KEY="$2"
            else
                [ -z "$CERT" ] || usage
                CERT="$2"
            fi
            shift 2
            ;;
        *) usage ;;
    esac
done
SIGN=0
if [ -n "$KEY" ] || [ -n "$CERT" ]; then
    [ -n "$KEY" ] && [ -n "$CERT" ] || usage
    SIGN=1
fi

for t in node tar gzip sha256sum; do
    command -v "$t" >/dev/null || die "$t fehlt"
done
if [ "$SIGN" = 1 ]; then
    # only paths are named, never the content of the key
    [ -f "$KEY" ] && [ -r "$KEY" ] || bad "Schlüssel $KEY fehlt, ist keine reguläre Datei oder nicht lesbar"
    [ -f "$CERT" ] && [ -r "$CERT" ] || bad "Zertifikat $CERT fehlt, ist keine reguläre Datei oder nicht lesbar"
    KEY_REAL="$(realpath -e -- "$KEY")" || bad "Schlüssel $KEY: echter Pfad nicht lesbar"
    CERT_REAL="$(realpath -e -- "$CERT")" || bad "Zertifikat $CERT: echter Pfad nicht lesbar"
    case "$KEY_REAL" in
        "$ROOT"/*) refuse "Schlüssel liegt im Repository ($ROOT): der private Schlüssel gehört in einen dauerhaften Ordner außerhalb jedes Repositorys, z. B. ~/.nextcloud/certificates/, wenn das Home-Verzeichnis einen Neustart übersteht (docs/ENTWICKLUNG.md §11)" ;;
    esac
    for t in docker openssl; do
        command -v "$t" >/dev/null || die "$t fehlt (für --key/--cert)"
    done
fi

# pack DIR: DIR/$NAME → DIR/$NAME.tar.gz (top folder knorke/, sorted, owner 0,
# one mtime) and DIR/$NAME.tar.gz.sha256 in the format of sha256sum
pack() {
    tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="$MTIME" \
        --transform "s,^$NAME,$APP_ID," -C "$1" -cf - "$NAME" | gzip -n -9 >"$1/$NAME.tar.gz"
    (cd "$1" && sha256sum "$NAME.tar.gz" >"$NAME.tar.gz.sha256")
}

# tree_manifest DIR: every entry below DIR except appinfo/signature.json – its kind
# (d folder, f file, x anything else such as a symlink), then the SHA-256 of every file
tree_manifest() {
    (
        cd "$1" || exit 1
        find . -mindepth 1 ! -path ./appinfo/signature.json \
            \( -type d -printf 'd %p\n' -o -type f -printf 'f %p\n' -o -printf 'x %p\n' \) | LC_ALL=C sort
        find . -type f ! -path ./appinfo/signature.json -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
    )
}

# no_private_key DIR SHOWN HINT: exit 1 if a file below DIR holds a PEM private key, named as
# SHOWN<path below DIR> and followed by HINT (never its content); also exit 1 if the search
# itself fails (grep 2, e.g. an unreadable file), so nothing goes unscanned
no_private_key() {
    local hits rc=0
    hits="$(grep -rlE -- '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----' "$1")" || rc=$?
    [ "$rc" -le 1 ] || die "die Suche nach privaten Schlüsseln in $1 ist gescheitert (grep endete mit $rc)"
    if [ -n "$hits" ]; then
        hits="${hits%%$'\n'*}"
        die "$2${hits#"$1"/} enthält einen privaten Schlüssel – $3"
    fi
}

# --- 1. the bundle is fresh ---------------------------------------------------
FRESH="$(cd "$ROOT" && node build/check-fresh.mjs 2>&1)" && rc=0 || rc=$?
printf '%s\n' "$FRESH" >&2
[ "$rc" -eq 0 ] || die "build/check-fresh.mjs endete mit $rc – erst dev/build.sh, dann erneut"
printf '%s\n' "$FRESH" | grep -Eq '(^|[^0-9])0 differing' || die "check-fresh meldet nicht „0 differing“"
if printf '%s\n' "$FRESH" | grep -Eq '[1-9][0-9]* differing'; then
    die "check-fresh meldet abweichende Quellen"
fi
# the CSS line of check-fresh (R19 T4-26, since build 3 of stage 4): present and green; a
# check-fresh without it does not cover a CSS-only change
printf '%s\n' "$FRESH" | grep -Eq '^  css: [0-9]+ src/styles entries, 0 differing, 0 missing$' \
    || die "check-fresh meldet keine grüne CSS-Zeile („  css: <n> src/styles entries, 0 differing, 0 missing“)"

# --- 2. version -----------------------------------------------------------------
VERSION="$(sed -n 's:^ *<version>\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)</version> *$:\1:p' "$ROOT/appinfo/info.xml" | head -n 1)"
[ -n "$VERSION" ] || die "appinfo/info.xml: <version> fehlt"
NAME="$APP_ID-$VERSION"
DEST="$OUT/$NAME"
TGZ="$OUT/$NAME.tar.gz"

# --- 3. copy --------------------------------------------------------------------
for d in $RUNTIME_DIRS; do
    [ -d "$ROOT/$d" ] && [ ! -L "$ROOT/$d" ] || die "Laufzeit-Verzeichnis $d fehlt"
done
for f in $RUNTIME_FILES; do
    [ -f "$ROOT/$f" ] && [ ! -L "$ROOT/$f" ] || die "Laufzeit-Datei $f fehlt"
done
mkdir -p "$OUT"
rm -rf -- "${DEST:?}" "${TGZ:?}" "${TGZ:?}.sha256"
mkdir -p "$DEST"
for d in $RUNTIME_DIRS; do
    cp -R -- "$ROOT/$d" "$DEST/$d"
done
for f in $RUNTIME_FILES; do
    cp -- "$ROOT/$f" "$DEST/$f"
done
for x in $EXCLUDE; do
    rm -f -- "${DEST:?}/$x"
done
# no symlinks, nothing executable that a web server could run
find "$DEST" -type l -exec rm -f -- {} +
find "$DEST" -type f -exec chmod 0644 {} +
find "$DEST" -type d -exec chmod 0755 {} +

# --- 4. archive -----------------------------------------------------------------
pack "$OUT"
FILES="$(find "$DEST" -type f | wc -l)"
log "fertig: $DEST ($FILES Dateien), $TGZ, $(cut -d' ' -f1 "$TGZ.sha256")"
if [ "$SIGN" = 0 ]; then
    printf '%s\n' "$DEST"
    exit 0
fi

# --- 5. signed build for the App Store (only with --key and --cert) ------------
# a key that lies in a runtime folder after all (a second copy, a hard link) never goes public;
# the path below the release is the path in the source tree
no_private_key "$DEST" "" "aus dem Quellbaum entfernen. Das unsignierte Release dev/release/out/$NAME/ enthält ihn auch: nicht einspielen. War er schon auf try oder Prod, gilt er als offengelegt (docs/ENTWICKLUNG.md §11)"
# the signed outputs are public, but nobody else may change them before openssl signs:
# umask 022 covers every new path, the chmod after mkdir an existing signed/;
# dev/release/out/ keeps its mode (whoever may write there can still swap signed/)
umask 022
SOUT="$OUT/signed"
SDEST="$SOUT/$NAME"
STGZ="$SOUT/$NAME.tar.gz"
SIGN_CTR="knorke-sign-$$"
SIGNED=0
# on every exit: the container goes (like tests/php/run.sh); unless the signed build is
# complete, also the four signed paths of this version. The unsigned release stays.
sign_cleanup() {
    docker rm -fv "$SIGN_CTR" >/dev/null 2>&1 || true
    if [ "$SIGNED" != 1 ]; then
        rm -rf -- "${SDEST:?}" "${STGZ:?}" "${STGZ:?}.sha256" "${STGZ:?}.sig" || true
    fi
}
trap 'rc=$?; sign_cleanup; exit "$rc"' EXIT
trap 'exit 1' INT TERM HUP

# mkdir -p leaves an existing signed/ as it was, so chmod; 00755 as below also clears a setgid bit
mkdir -p "$SOUT"
chmod 00755 "$SOUT"
rm -rf -- "${SDEST:?}" "${STGZ:?}" "${STGZ:?}.sha256" "${STGZ:?}.sig"
cp -R -- "$DEST" "$SDEST"

# sign: without an installed Nextcloud occ offers only a few commands, integrity:* among
# them ("Nextcloud is not installed - only a limited number of commands are available" on
# stderr is expected); key and certificate as read-only single files, never their folder
docker run --rm --name "$SIGN_CTR" --label knorke=sign --network none \
    -v "$SDEST":/app -v "$KEY_REAL":/sign/knorke.key:ro -v "$CERT_REAL":/sign/knorke.crt:ro \
    --entrypoint php "$SIGN_IMAGE" /usr/src/nextcloud/occ integrity:sign-app \
    --path=/app --privateKey=/sign/knorke.key --certificate=/sign/knorke.crt >&2 \
    || die "occ integrity:sign-app ist gescheitert (Ursache oben; z. B. Docker oder Image nicht erreichbar, Schlüssel mit Passphrase)"
SIGJSON="$SDEST/appinfo/signature.json"
[ -f "$SIGJSON" ] && [ ! -L "$SIGJSON" ] && [ -s "$SIGJSON" ] \
    || die "occ integrity:sign-app hat keine appinfo/signature.json geschrieben"
# the container could write /app: the host checks it added exactly appinfo/signature.json
# and no PEM private key, before check-app (which runs in the same image)
M_REL="$(tree_manifest "$DEST")"
M_SIG="$(tree_manifest "$SDEST")"
if [ "$M_REL" != "$M_SIG" ]; then
    # the trap removes the signed folder: show what differs (kind, SHA-256 and path only), at
    # most 20 lines, then "… (gekürzt)" if there are more; no pipe into head, so no SIGPIPE
    # under pipefail. Without diff the list stays empty; the FEHLER line follows either way
    printf 'Abweichungen (< Release, > signierter Baum):\n' >&2
    DIFF_TEXT="$(diff <(printf '%s\n' "$M_REL") <(printf '%s\n' "$M_SIG") | grep '^[<>]')" || true
    if [ -n "$DIFF_TEXT" ]; then
        mapfile -t DIFF_LINES <<<"$DIFF_TEXT"
        printf '%s\n' "${DIFF_LINES[@]:0:20}" >&2
        [ "${#DIFF_LINES[@]}" -le 20 ] || printf '… (gekürzt)\n' >&2
    fi
    die "der signierte Baum weicht vom Release ab (außer appinfo/signature.json eine Datei geändert, hinzugefügt oder entfernt)"
fi
no_private_key "$SDEST" "dev/release/out/signed/$NAME/" "kein signierter Bau (docs/ENTWICKLUNG.md §11)"

# check, without the key: chain to Nextcloud's root CA, CN = app id, the signature, every
# hash, no extra or missing file ("Certificate is not valid." for a certificate Nextcloud
# did not issue: no signed build without the issued certificate)
docker run --rm --name "$SIGN_CTR" --label knorke=sign --network none -v "$SDEST":/app:ro \
    --entrypoint php "$SIGN_IMAGE" /usr/src/nextcloud/occ integrity:check-app --path=/app "$APP_ID" >&2 \
    || die "occ integrity:check-app meldet Fehler (oben) – kein signierter Bau"

# modes as in step 3 (signature.json belongs to the container's root: only what differs);
# 00755, because GNU chmod 0755 keeps a setgid bit on a folder
find "$SDEST" -type f ! -perm 0644 -exec chmod 0644 {} +
find "$SDEST" -type d ! -perm 0755 -exec chmod 00755 {} +
pack "$SOUT"

# the App Store signature of the archive, on the host as in the store's documentation
SIG="$(openssl dgst -sha512 -sign "$KEY_REAL" "$STGZ" | openssl base64)" \
    || die "openssl dgst -sha512 -sign ist gescheitert"
[ -n "$SIG" ] || die "openssl lieferte keine Signatur"
printf '%s\n' "$SIG" >"$STGZ.sig"
SFILES="$(find "$SDEST" -type f | wc -l)"
log "signiert: $SDEST ($SFILES Dateien), $STGZ, $(cut -d' ' -f1 "$STGZ.sha256") – nur für den App Store (docs/ENTWICKLUNG.md §11), nie nach try, Prod oder custom_apps/"
SIGNED=1
cat -- "$STGZ.sig"
