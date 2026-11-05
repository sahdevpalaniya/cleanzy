#!/usr/bin/env bash
# Build a drag-to-Applications .dmg from a packaged Mac build, on Linux, without root:
#   scripts/make-dmg.sh x64|arm64      (needs dist/Cleanzy-darwin-<arch>/Cleanzy.app)
# First run sets up the tools in ~/.cache/cleanzy-dmg-tools: mkfs.hfsplus (Ubuntu's hfsprogs,
# unpacked, not installed) and Mozilla's libdmg-hfsplus (the tool Firefox's Mac builds use).
# The image is unsigned: macOS still asks before the first launch.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${1:-arm64}"
VER="$(node -p "require('$SRC/package.json').version")"
APP="$SRC/dist/Cleanzy-darwin-$ARCH/Cleanzy.app"
OUT="$SRC/dist/Cleanzy-$VER-mac-$ARCH.dmg"
TOOLS="${DMG_TOOLS:-$HOME/.cache/cleanzy-dmg-tools}"
LIBDMG_COMMIT=e18579b391950589b9ed16ee630c54ce4319bb29   # pinned, reviewed 2026-10-24
MKFS="$TOOLS/hfs/sbin/mkfs.hfsplus" HFS="$TOOLS/build/hfs/hfsplus" DMG="$TOOLS/build/dmg/dmg"

[[ -d "$APP" ]] || { echo "No $APP — run 'scripts/build.sh mac' first." >&2; exit 1; }

if [[ ! -x "$MKFS" || ! -x "$HFS" || ! -x "$DMG" ]]; then
  echo "Setting up dmg tools in $TOOLS (one time)…"
  mkdir -p "$TOOLS"
  ( cd "$TOOLS"
    [[ -x "$MKFS" ]] || { apt-get download hfsprogs >/dev/null && dpkg-deb -x hfsprogs_*.deb hfs; }
    if [[ ! -d src ]]; then
      git init -q src && git -C src fetch -q --depth 1 https://github.com/mozilla/libdmg-hfsplus "$LIBDMG_COMMIT" && git -C src checkout -q FETCH_HEAD
    fi
    CMAKE="$(command -v cmake || true)"
    if [[ -z "$CMAKE" ]]; then python3 -m venv venv && venv/bin/pip -q install "cmake<4" && CMAKE="$TOOLS/venv/bin/cmake"; fi
    "$CMAKE" -S src -B build -DCMAKE_BUILD_TYPE=Release >/dev/null
    make -C build -j"$(nproc)" dmg-bin hfsplus >/dev/null )
fi

WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
mkdir "$WORK/stage"
cp -a "$APP" "$WORK/stage/"
ln -s /Applications "$WORK/stage/Applications"   # the drag target people expect in the window

# HFS+ needs some headroom over the raw size for its catalog and journal
MB=$(( $(du -sm "$WORK/stage" | cut -f1) * 11 / 10 + 20 ))
dd if=/dev/zero of="$WORK/hfs.img" bs=1M count="$MB" status=none
"$MKFS" -v Cleanzy "$WORK/hfs.img" >/dev/null
# clone_link keeps the framework symlinks Electron's .app relies on
( cd "$WORK/stage" && "$HFS" -s clone_link "$WORK/hfs.img" addall . >/dev/null )
"$HFS" "$WORK/hfs.img" ls /Cleanzy.app/Contents/MacOS | grep -q '^100755 .* Cleanzy$' \
  || { echo "dmg check failed: Cleanzy.app/Contents/MacOS/Cleanzy missing or not executable" >&2; exit 1; }
rm -f "$OUT"
"$DMG" build "$WORK/hfs.img" "$OUT" >/dev/null
echo "Built $OUT  ($(du -h "$OUT" | cut -f1))"
