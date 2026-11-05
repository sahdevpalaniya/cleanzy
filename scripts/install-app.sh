#!/usr/bin/env bash
# Install Cleanzy from dist/ on Linux, macOS or Windows (Git Bash / MSYS2).
# No admin rights needed: everything goes into your user account.
#
#   ./scripts/install-app.sh               install (builds first if dist/ has nothing for this OS)
#   ./scripts/install-app.sh --dev         Linux only: launcher points at the source tree
#   ./scripts/install-app.sh --uninstall   remove it
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-}"

case "$(uname -s)" in
  Linux)
    [[ "$ACTION" == "" && ! -x "$SRC/dist/Cleanzy-linux-x64/Cleanzy" ]] && "$SRC/scripts/build.sh" linux
    exec bash "$SRC/scripts/install.sh" "$@" ;;

  Darwin)
    DEST="$HOME/Applications/Cleanzy.app"
    if [[ "$ACTION" == "--uninstall" ]]; then rm -rf "$DEST"; echo "Cleanzy removed."; exit 0; fi
    ARCH="$([[ "$(uname -m)" == arm64 ]] && echo arm64 || echo x64)"
    APP="$SRC/dist/Cleanzy-darwin-$ARCH/Cleanzy.app"
    [[ -d "$APP" ]] || "$SRC/scripts/build.sh" mac
    mkdir -p "$HOME/Applications"; rm -rf "$DEST"
    cp -R "$APP" "$DEST"
    # unsigned build: without this Gatekeeper says the app "is damaged"
    xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
    echo "Installed to $DEST — open it from Launchpad or Spotlight."
    echo "Tip: grant Full Disk Access (System Settings → Privacy) so it can measure ~/Library." ;;

  MINGW*|MSYS*|CYGWIN*)
    LOCAL="$(cygpath -u "${LOCALAPPDATA:?LOCALAPPDATA not set}")"
    DEST="$LOCAL/Programs/Cleanzy"
    MENU="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/Cleanzy.lnk"
    DESK="$(cygpath -u "$USERPROFILE")/Desktop/Cleanzy.lnk"
    if [[ "$ACTION" == "--uninstall" ]]; then
      rm -rf "$DEST" "$MENU" "$DESK"; echo "Cleanzy removed."; exit 0; fi
    [[ -x "$SRC/dist/Cleanzy-win32-x64/Cleanzy.exe" ]] || "$SRC/scripts/build.sh" win
    rm -rf "$DEST"; mkdir -p "$(dirname "$DEST")"
    cp -R "$SRC/dist/Cleanzy-win32-x64" "$DEST"
    # Start Menu + Desktop shortcuts through Windows' own COM shell object
    for lnk in "$MENU" "$DESK"; do
      powershell.exe -NoProfile -Command "\$s=(New-Object -ComObject WScript.Shell).CreateShortcut('$(cygpath -w "$lnk")');\
\$s.TargetPath='$(cygpath -w "$DEST/Cleanzy.exe")';\$s.WorkingDirectory='$(cygpath -w "$DEST")';\$s.Save()"
    done
    echo "Installed to $(cygpath -w "$DEST") — find Cleanzy in the Start menu." ;;

  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
