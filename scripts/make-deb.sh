#!/usr/bin/env bash
# Build a .deb your colleagues can install with:  sudo apt install ./cleanzy_<ver>_amd64.deb
# Requires the packaged build first:  npm run build
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$(node -p "require('$SRC/package.json').version")"
ARCH="${1:-x64}"   # electron arch: x64 | arm64
DEBARCH="$([[ "$ARCH" == arm64 ]] && echo arm64 || echo amd64)"
BUILD="$SRC/dist/Cleanzy-linux-$ARCH"
STAGE="$SRC/dist/deb-$ARCH"
DEB="$SRC/dist/cleanzy_${VER}_${DEBARCH}.deb"

[[ -x "$BUILD/Cleanzy" ]] || { echo "No packaged build — run 'npm run build' first." >&2; exit 1; }

rm -rf "$STAGE"; mkdir -p "$STAGE"/{DEBIAN,opt,usr/bin,usr/share/applications}
cp -a "$BUILD" "$STAGE/opt/cleanzy"
# electron-packager can leave the output dir 0700; inside a system package every
# user has to be able to read and execute it.
chmod -R u=rwX,go=rX "$STAGE/opt/cleanzy"

for s in 16 24 32 48 64 128 256 512; do
  [[ -f "$SRC/assets/icons/icon-$s.png" ]] &&
    install -Dm644 "$SRC/assets/icons/icon-$s.png" "$STAGE/usr/share/icons/hicolor/${s}x${s}/apps/cleanzy.png"
done

# ELECTRON_RUN_AS_NODE is exported in some shells; left set, the binary starts as
# plain node and refuses to run the app.
cat > "$STAGE/usr/bin/cleanzy" <<'WRAP'
#!/bin/sh
exec env -u ELECTRON_RUN_AS_NODE /opt/cleanzy/Cleanzy "$@"
WRAP
chmod 755 "$STAGE/usr/bin/cleanzy"

cat > "$STAGE/usr/share/applications/cleanzy.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Version=1.0
Name=Cleanzy
GenericName=Disk Usage Analyzer
Comment=See what is using your disk and free it without a reboot
Exec=cleanzy %U
Icon=cleanzy
Terminal=false
Categories=System;
Keywords=disk;usage;space;storage;cleanup;analyzer;free;
StartupNotify=true
StartupWMClass=Cleanzy
DESK

# Like Chrome: installing the .deb also adds the Cleanzy apt repo, so `apt upgrade` updates it.
# Needs the public key of the repo signing key (see make-apt-repo.sh); skipped when unset.
if [[ -n "${CLEANZY_GPG_KEY:-}" ]]; then
  REPO="${CLEANZY_REPO_URL:-https://cleanzy.app/apt}"
  mkdir -p "$STAGE/usr/share/keyrings" "$STAGE/etc/apt/sources.list.d"
  gpg --export "$CLEANZY_GPG_KEY" > "$STAGE/usr/share/keyrings/cleanzy.gpg"
  [[ -s "$STAGE/usr/share/keyrings/cleanzy.gpg" ]] || { echo "gpg key $CLEANZY_GPG_KEY not found" >&2; exit 1; }
  echo "deb [signed-by=/usr/share/keyrings/cleanzy.gpg] $REPO stable main" > "$STAGE/etc/apt/sources.list.d/cleanzy.list"
  echo /etc/apt/sources.list.d/cleanzy.list > "$STAGE/DEBIAN/conffiles"
  chmod 644 "$STAGE/usr/share/keyrings/cleanzy.gpg" "$STAGE/etc/apt/sources.list.d/cleanzy.list"
else
  echo "CLEANZY_GPG_KEY unset: .deb will not add the apt repo (no auto-updates)." >&2
fi

cat > "$STAGE/DEBIAN/control" <<CTRL
Package: cleanzy
Version: $VER
Section: utils
Priority: optional
Architecture: $DEBARCH
Replaces: cleaner
Conflicts: cleaner
Homepage: https://cleanzy.app
Maintainer: Sahdev Palaniya <sahdevpalaniya98@gmail.com>
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2 | libasound2t64, libx11-6, libxss1 | libxss1t64, coreutils
Recommends: lsof, gvfs, libglib2.0-bin
Installed-Size: $(du -sk "$STAGE" | cut -f1)
Description: Disk usage analyzer that frees space without a reboot
 Cleanzy maps every folder by the disk space it really occupies, shown as a
 folder list or a rings chart, and finds the files a running program still
 holds open after you deleted them - the reason free space does not go up
 until you reboot. It releases those blocks through /proc without restarting
 or closing anything, and can remove installed apt packages and snaps,
 including the superseded snap revisions that quietly sit on disk.
CTRL

# Installed as root, so the sandbox helper can be set up the way Chromium wants.
cat > "$STAGE/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
if [ -f /opt/cleanzy/chrome-sandbox ]; then
  chown root:root /opt/cleanzy/chrome-sandbox
  chmod 4755 /opt/cleanzy/chrome-sandbox
fi
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache  >/dev/null && gtk-update-icon-cache -q -f -t /usr/share/icons/hicolor || true
exit 0
POST

cat > "$STAGE/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache  >/dev/null && gtk-update-icon-cache -q -f -t /usr/share/icons/hicolor || true
exit 0
POSTRM
chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/postrm"

fakeroot dpkg-deb --build --root-owner-group "$STAGE" "$DEB" >/dev/null
rm -rf "$STAGE"
echo "Built $DEB  ($(du -h "$DEB" | cut -f1))"
echo "Colleagues install it with:  sudo apt install ./$(basename "$DEB")"
