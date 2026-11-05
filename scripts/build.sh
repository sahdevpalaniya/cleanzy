#!/usr/bin/env bash
# Package Cleanzy for one or more platforms into dist/.
#
#   ./scripts/build.sh              current OS
#   ./scripts/build.sh all          linux + mac (x64, arm64) + windows
#   ./scripts/build.sh linux|mac|win
#
# Without wine a cross-built Windows .exe gets Electron's default icon.
# Mac builds are unsigned: install-app.sh clears the
# quarantine flag so Gatekeeper lets them open.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -d node_modules/@electron/packager ]] || npm install

case "$(uname -s)" in Darwin) HOST=mac;; MINGW*|MSYS*|CYGWIN*) HOST=win;; *) HOST=linux;; esac
TARGET="${1:-$HOST}"
VER="$(node -p "require('./package.json').version")"
IGNORE='^/(dist|website|scripts|tests|\.git)(/|$)'

pack() { # platform arch [icon]
  local icon=()
  [[ -n "${3:-}" && -f "$3" ]] && icon=(--icon="$3")
  npx electron-packager . Cleanzy --platform="$1" --arch="$2" --out=dist --overwrite --prune=true \
    --app-version="$VER" --ignore="$IGNORE" "${icon[@]}"
}

ARCHES="${ARCHES:-x64 arm64}"
cd_zip() { (cd "$1" && rm -f "$2" && zip -qry "$2" "$3"); }   # -y keeps the symlinks inside a .app

for t in $([[ "$TARGET" == all ]] && echo linux mac win || echo "$TARGET"); do
  for a in $ARCHES; do
    case "$t" in
      linux) pack linux "$a" assets/icons/icon.png
             tar -czf "dist/Cleanzy-$VER-linux-$a.tar.gz" -C dist --transform "s,^Cleanzy-linux-$a,Cleanzy," "Cleanzy-linux-$a"
             command -v fakeroot >/dev/null && bash scripts/make-deb.sh "$a" || echo "skip .deb (needs fakeroot + dpkg-deb)";;
      mac)   pack darwin "$a" assets/icons/icon.icns
             cd_zip "dist/Cleanzy-darwin-$a" "../Cleanzy-$VER-mac-$a.zip" Cleanzy.app
             bash scripts/make-dmg.sh "$a" || echo "skip .dmg (see scripts/make-dmg.sh)";;
      win)   if [[ "$HOST" == win ]] || command -v wine >/dev/null; then pack win32 "$a" assets/icons/icon.ico
             else # no wine: skip rcedit (icon/version stamping) — the .exe runs the same
               npx electron-packager . Cleanzy --platform=win32 --arch="$a" --out=dist --overwrite --prune=true --ignore="$IGNORE"
             fi
             # the zip holds one folder named Cleanzy, as the install steps describe
             rm -rf dist/zip-win && mkdir -p dist/zip-win && cp -al "dist/Cleanzy-win32-$a" dist/zip-win/Cleanzy
             cd_zip dist/zip-win "../Cleanzy-$VER-win-$a.zip" Cleanzy && rm -rf dist/zip-win;;
      *) echo "unknown target: $t (use linux, mac, win or all)" >&2; exit 1;;
    esac
  done
done
ls -1sh dist/*.dmg dist/*.zip dist/*.deb dist/*.tar.gz 2>/dev/null
