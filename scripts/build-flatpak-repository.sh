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
ostree --repo="$repo" init --mode=archive-z2
shopt -s nullglob
bundles=("$input"/*.flatpak)
(( ${#bundles[@]} >= 1 && ${#bundles[@]} <= 2 ))
for bundle in "${bundles[@]}"; do
  flatpak build-import-bundle --no-update-summary --gpg-sign="$SIGNING_KEY_FINGERPRINT" --gpg-homedir="$GNUPGHOME" "$repo" "$bundle"
done
refs=$(ostree --repo="$repo" refs)
printf '%s\n' "$refs" | grep -Fx app/io.github.fluffydisk.airdrop-linux/x86_64/stable
if printf '%s\n' "$refs" | grep -vE '^app/io\.github\.fluffydisk\.airdrop-linux/(x86_64|aarch64)/stable$'; then
  echo 'Unexpected bundle application/ref' >&2
  exit 1
fi
# Publish standard deltas so static hosting serves a few transfer parts instead
# of thousands of individual npm/Electron objects per installation.
flatpak build-update-repo --generate-static-deltas --static-delta-jobs=2 --title='Airdrop Linux' --gpg-sign="$SIGNING_KEY_FINGERPRINT" --gpg-homedir="$GNUPGHOME" "$repo"
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
