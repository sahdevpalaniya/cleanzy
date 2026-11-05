#!/usr/bin/env bash
# Build a signed apt repository from dist/*.deb into website/public/apt/, so users can
#   curl -fsSL https://SITE/install.sh | sudo bash   (once)
#   sudo apt install cleanzy                          (and apt upgrade for new versions)
#
# The .deb files are too big for static hosting, so they are not copied: website/public/_redirects
# sends apt from /apt/pool/... to the GitHub Release. Upload the .deb files to release v$VERSION first.
#
#   CLEANZY_GPG_KEY=<key id> NEXT_PUBLIC_SITE_URL=https://your.domain bash scripts/make-apt-repo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${CLEANZY_GPG_KEY:?set CLEANZY_GPG_KEY to the gpg key id that signs the repo}"
SITE="${NEXT_PUBLIC_SITE_URL:-https://cleanzy.app}"; SITE="${SITE%/}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
GH="https://github.com/sahdevpalaniya/cleanzy/releases/download/v$VERSION"
PUB="$ROOT/website/public"
OUT="$PUB/apt"

shopt -s nullglob
debs=("$ROOT"/dist/cleanzy_"$VERSION"_*.deb)
(( ${#debs[@]} )) || { echo "no dist/cleanzy_${VERSION}_*.deb — run npm run deb first" >&2; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/pool/main"
cp "${debs[@]}" "$WORK/pool/main/"

rm -rf "$OUT"; mkdir -p "$OUT"
cd "$WORK"
for arch in amd64 arm64; do
  d="dists/stable/main/binary-$arch"; mkdir -p "$d"
  apt-ftparchive --arch "$arch" packages pool > "$d/Packages"
  gzip -9kn "$d/Packages"
done
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Cleanzy -o APT::FTPArchive::Release::Label=Cleanzy \
  -o APT::FTPArchive::Release::Suite=stable -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" -o APT::FTPArchive::Release::Components=main \
  release dists/stable > dists/stable/Release
gpg --batch --yes -u "$KEY" --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes -u "$KEY" -abs -o dists/stable/Release.gpg dists/stable/Release
cp -r dists "$OUT/"
gpg --export "$KEY" > "$OUT/cleanzy.gpg"      # public key only

# apt follows redirects, so the pool lives on GitHub Releases.
{ for f in "${debs[@]}"; do b="$(basename "$f")"; echo "/apt/pool/main/$b $GH/$b 302"; done; } > "$PUB/_redirects"

cat > "$PUB/install.sh" <<EOF
#!/bin/sh
# Adds the Cleanzy apt repository, then installs Cleanzy. Run: curl -fsSL $SITE/install.sh | sudo bash
set -e
[ "\$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
command -v curl >/dev/null || { apt-get update; apt-get install -y curl; }
install -d -m 0755 /usr/share/keyrings
curl -fsSL $SITE/apt/cleanzy.gpg -o /usr/share/keyrings/cleanzy.gpg
echo "deb [signed-by=/usr/share/keyrings/cleanzy.gpg] $SITE/apt stable main" > /etc/apt/sources.list.d/cleanzy.list
apt-get update
apt-get install -y cleanzy
EOF

echo "apt repo written to $OUT (+ _redirects, install.sh). Build and deploy the website to publish it."
