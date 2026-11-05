#!/usr/bin/env bash
# Install (or remove) Cleanzy as a normal Ubuntu application. Everything lands
# under ~/.local, so no root is needed and nothing outside your account changes.
#
#   bash scripts/install.sh              install the packaged build from dist/ (preferred)
#   bash scripts/install.sh --dev        point the launcher at the source tree instead
#   bash scripts/install.sh --uninstall  remove it again
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
ICON_DIR="$DATA/icons/hicolor"
APPS_DIR="$DATA/applications"
LIB_DIR="$DATA/../lib/cleanzy"                 # ~/.local/lib/cleanzy
LIB_DIR="$(realpath -m "$LIB_DIR")"
DESKTOP="$APPS_DIR/cleanzy.desktop"

refresh() {
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS_DIR" 2>/dev/null || true
  command -v gtk-update-icon-cache  >/dev/null && gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DESKTOP" "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/cleanzy.desktop"; rm -rf "$LIB_DIR"   # autostart: the app's "Launch at login"
  for s in 16 24 32 48 64 128 256 512; do rm -f "$ICON_DIR/${s}x${s}/apps/cleanzy.png"; done
  refresh
  echo "Cleanzy removed."
  exit 0
fi

# Icons go into the theme by size, so GNOME picks the right one for the dock,
# the app grid and the window switcher instead of scaling one big PNG.
for s in 16 24 32 48 64 128 256 512; do
  src="$SRC/assets/icons/icon-$s.png"
  [[ -f "$src" ]] && install -Dm644 "$src" "$ICON_DIR/${s}x${s}/apps/cleanzy.png"
done

if [[ "${1:-}" == "--dev" ]]; then
  BIN="$SRC/node_modules/.bin/electron"
  [[ -x "$BIN" ]] || { echo "electron missing — run 'npm install' first." >&2; exit 1; }
  EXEC="env -u ELECTRON_RUN_AS_NODE $BIN $SRC --no-sandbox %U"
  WORKDIR="$SRC"
  echo "Installing launcher pointing at the source tree."
else
  BUILD="$SRC/dist/Cleanzy-linux-x64"
  [[ -x "$BUILD/Cleanzy" ]] || { echo "No packaged build — run 'npm run build' first." >&2; exit 1; }
  rm -rf "$LIB_DIR"
  install -d "$(dirname "$LIB_DIR")"
  cp -a "$BUILD" "$LIB_DIR"
  # chrome-sandbox needs to be setuid root, which we cannot do without a password,
  # so the launcher runs with --no-sandbox. The app only ever loads its own local page.
  # ELECTRON_RUN_AS_NODE may be exported in the session; if it is, the binary
  # starts as plain node and rejects Chromium flags. Always clear it.
  EXEC="env -u ELECTRON_RUN_AS_NODE $LIB_DIR/Cleanzy --no-sandbox %U"
  WORKDIR="$LIB_DIR"
  echo "Installed $(du -sh "$LIB_DIR" | cut -f1) to $LIB_DIR"
fi

install -d "$APPS_DIR"
cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Version=1.0
Name=Cleanzy
GenericName=Disk Usage Analyzer
Comment=See what is using your disk and free it without a reboot
Exec=$EXEC
Path=$WORKDIR
Icon=cleanzy
Terminal=false
Categories=System;
Keywords=disk;usage;space;storage;cleanup;analyzer;free;
StartupNotify=true
StartupWMClass=Cleanzy
DESK
chmod +x "$DESKTOP"

refresh
command -v desktop-file-validate >/dev/null && desktop-file-validate "$DESKTOP"
echo "Done. Search “Cleanzy” in Activities; right-click the dock icon to pin it."
