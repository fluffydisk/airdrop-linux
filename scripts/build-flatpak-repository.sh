#!/usr/bin/env bash
# Append a signed Flatpak remote to the native Pages tree, using the same key.
set -euo pipefail
umask 022
input=$(realpath "${1:?Usage: build-flatpak-repository.sh INPUT PUBLIC}")
public=${2:?Usage: build-flatpak-repository.sh INPUT PUBLIC}
: "${SIGNING_KEY_FINGERPRINT:?Set the full signing fingerprint}"
: "${GNUPGHOME:?Use the unlocked protected keyring}"
[[ "$SIGNING_KEY_FINGERPRINT" =~ ^[A-Fa-f0-9]{40,64}$ ]]
test -d "$public"
test ! -e "$public/flatpak"
(cd "$input" && sha256sum --strict -c FLATPAK-SHA256SUMS)
repo="$public/flatpak"
shopt -s nullglob
bundles=("$input"/*.flatpak)
test "${#bundles[@]}" = 2
for bundle in "${bundles[@]}"; do
  flatpak build-import-bundle --no-update-summary --gpg-sign="$SIGNING_KEY_FINGERPRINT" --gpg-homedir="$GNUPGHOME" "$repo" "$bundle"
done
for arch in x86_64 aarch64; do
  ostree --repo="$repo" rev-parse "app/io.github.fluffydisk.airdrop-linux/$arch/stable"
done
flatpak build-update-repo --title='Airdrop Linux' --gpg-sign="$SIGNING_KEY_FINGERPRINT" --gpg-homedir="$GNUPGHOME" "$repo"
key=$(gpg --batch --export "$SIGNING_KEY_FINGERPRINT" | base64 -w0)
cat > "$public/airdrop-linux.flatpakrepo" <<EOF
[Flatpak Repo]
Title=Airdrop Linux
Url=https://fluffydisk.github.io/airdrop-linux/flatpak/
Homepage=https://github.com/fluffydisk/airdrop-linux
Description=Official upstream Airdrop Linux packages
GPGKey=$key
EOF
cat > "$public/airdrop-linux.flatpakref" <<EOF
[Flatpak Ref]
Title=Airdrop Linux
Name=io.github.fluffydisk.airdrop-linux
Branch=stable
Url=https://fluffydisk.github.io/airdrop-linux/flatpak/
IsRuntime=false
GPGKey=$key
RuntimeRepo=https://flathub.org/repo/flathub.flatpakrepo
SuggestRemoteName=airdrop-linux
EOF
printf '\nFlatpak: [Install Airdrop Linux](airdrop-linux.flatpakref) · [Add remote](airdrop-linux.flatpakrepo)\n' >> "$public/index.md"
