#!/usr/bin/env bash
# Build a signed Pages tree from already checksum-verified stable release assets.
set -euo pipefail
umask 022
input=${1:?Usage: build-repository.sh INPUT OUTPUT}
output=${2:?Usage: build-repository.sh INPUT OUTPUT}
: "${SIGNING_KEY_FINGERPRINT:?Set the full signing key fingerprint}"
[[ "$SIGNING_KEY_FINGERPRINT" =~ ^[A-Fa-f0-9]{40,64}$ ]] || { echo 'Invalid signing fingerprint' >&2; exit 1; }
[[ -d "$input" ]] || { printf 'Package input directory does not exist: %s\n' "$input" >&2; exit 1; }
input=$(realpath "$input")
[[ ! -e "$output" ]] || { echo 'Output must be a new directory' >&2; exit 1; }
shopt -s nullglob
packages=("$input"/*.deb)
rpms=("$input"/*.rpm)
printf 'Package input: %s; DEB=%s RPM=%s\n' "$input" "${#packages[@]}" "${#rpms[@]}"
(( ${#packages[@]} > 0 && ${#rpms[@]} > 0 )) || { echo 'Both DEB and RPM assets are required; refusing to create an empty repository' >&2; exit 1; }
mkdir -p "$output/apt/pool/main" "$output/rpm/x86_64" "$output/rpm/aarch64"
cp "${packages[@]}" "$output/apt/pool/main/"
for package in "${rpms[@]}"; do
  arch=$(rpm -qp --qf '%{ARCH}' "$package")
  [[ "$arch" == x86_64 || "$arch" == aarch64 ]] || exit 1
  cp "$package" "$output/rpm/$arch/"
  # A pre-unlocked GPG agent is required. Never disable or fake verification.
  rpmsign --define "_gpg_name $SIGNING_KEY_FINGERPRINT" --define "_gpg_path $GNUPGHOME" --addsign "$output/rpm/$arch/$(basename "$package")"
done
absolute_output=$(realpath "$output")
for arch in amd64 arm64; do
  dest="$output/apt/dists/stable/main/binary-$arch"
  mkdir -p "$dest"
  (cd "$output/apt" && apt-ftparchive --arch "$arch" packages pool/main) > "$dest/Packages"
  gzip -n -9 -c "$dest/Packages" > "$dest/Packages.gz"
done
(cd "$output/apt" && apt-ftparchive \
  -o APT::FTPArchive::Release::Origin='Airdrop Linux' \
  -o APT::FTPArchive::Release::Label='Airdrop Linux' \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures='amd64 arm64' \
  -o APT::FTPArchive::Release::Components=main release dists/stable) > "$output/apt/dists/stable/Release"
gpg --batch --yes --local-user "$SIGNING_KEY_FINGERPRINT" --clearsign -o "$output/apt/dists/stable/InRelease" "$output/apt/dists/stable/Release"
gpg --batch --yes --local-user "$SIGNING_KEY_FINGERPRINT" --armor --detach-sign -o "$output/apt/dists/stable/Release.gpg" "$output/apt/dists/stable/Release"
gpg --batch --export "$SIGNING_KEY_FINGERPRINT" > "$output/airdrop-linux.gpg"
gpg --batch --armor --export "$SIGNING_KEY_FINGERPRINT" > "$output/airdrop-linux.asc"
rpm_keyring=$(mktemp -d)
trap 'rm -rf "$rpm_keyring"' EXIT
rpmkeys --dbpath "$rpm_keyring" --import "$absolute_output/airdrop-linux.asc"
for package in "$output"/rpm/*/*.rpm; do
  rpmkeys --dbpath "$rpm_keyring" --checksig "$package"
done
for arch in x86_64 aarch64; do
  createrepo_c "$output/rpm/$arch"
  gpg --batch --yes --local-user "$SIGNING_KEY_FINGERPRINT" --armor --detach-sign "$output/rpm/$arch/repodata/repomd.xml"
  gpgv --keyring "$absolute_output/airdrop-linux.gpg" "$output/rpm/$arch/repodata/repomd.xml.asc" "$output/rpm/$arch/repodata/repomd.xml"
done
gpgv --keyring "$absolute_output/airdrop-linux.gpg" "$output/apt/dists/stable/InRelease"
cp docs/package-managers.md "$output/index.md"
touch "$output/.nojekyll"
