# One-time Snap Store authentication on Arch / Omarchy

Snap building and strict installation tests run in GitHub Actions. Your workstation
does not need Ubuntu, snapd or Snapcraft installed. Use the existing Docker engine
with Canonical's official Snapcraft container for the one interactive login.

The official `8_core24` image was pulled and verified as Snapcraft **8.11.1**.
Its export-login help and unprivileged execution were tested with the read-only,
capability-free configuration below. Actual account login must be completed by the
account owner; no account password or exported credential belongs in chat or logs.

The requested credential is limited to:

- Snap: **airdrop-linux**, already registered by the maintainer.
- Channels: **latest/candidate and latest/stable**, without beta/edge or other tracks.
- ACLs: **package_access, package_push, package_release**: read access, upload
  revisions and release/promote revisions. No account editing, name registration,
  collaborator management, metrics or package metadata editing is requested.
- Expiry: **90 days**. Renew the GitHub secret when it expires.

## Generate the credential

Run this from an ordinary terminal on Omarchy. Docker must be running. The
directory is private; on a desktop session `XDG_RUNTIME_DIR` normally stores it
in memory. Only this new directory is mounted into the container.

```sh
umask 077
snap_auth_dir=$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/airdrop-snap-auth.XXXXXX")
snap_auth_expiry=$(date -u -d '+90 days' '+%Y-%m-%dT%H:%M:%S')
docker run --rm -it --log-driver=none \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,mode=1777 \
  --cap-drop=ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e USER=snap-auth \
  --mount "type=bind,src=$snap_auth_dir,dst=/credentials" \
  --entrypoint /bin/snapcraft \
  ghcr.io/canonical/snapcraft@sha256:0443273552768a3230c2ede3aa47e567da0242bfbb0a7bb1283093208c404a0c \
  export-login --snaps airdrop-linux --channels latest/candidate,latest/stable \
  --acls package_access,package_push,package_release \
  --expires "$snap_auth_expiry" /credentials/store.credentials
```

Enter your Ubuntu One / Snap Store login and, if requested, two-factor code only
at this local interactive prompt. Password entry is hidden. Do not run with shell
tracing or use `-` as the export filename: that prints the credential. A successful
command writes the credential file without displaying it. The container is removed
when it exits; its downloaded image remains an optional Docker cache entry.

## Save directly into GitHub

With GitHub CLI authenticated as a repository administrator on your workstation:

```sh
gh secret set SNAPCRAFT_STORE_CREDENTIALS \
  --repo fluffydisk/airdrop-linux --env snap-publishing \
  < "$snap_auth_dir/store.credentials"
```

This sends the file through standard input without putting the credential into
command arguments, shell history or the clipboard. If needed, authenticate GitHub
CLI through its normal browser login first. Alternatively, use the repository's
[environment settings](https://github.com/fluffydisk/airdrop-linux/settings/environments),
choose `snap-publishing` and add an environment secret with the exact name above.
Keep the value out of chat. Remove the temporary file after GitHub confirms success:

```sh
rm -- "$snap_auth_dir/store.credentials"
rmdir -- "$snap_auth_dir"
unset snap_auth_dir snap_auth_expiry
```

Tell the cloud chat that the secret is ready. The next steps are the `snap-access`
check, upload of tested artifacts to candidate, Store review and installation from
that channel. Stable promotion follows successful Store installation and any
required browser-sandbox interface review. AUR registration is independent.

## Evidence and upstream references

- [Exact v1.5.0 amd64/ARM64 Snap builds and strict install/desktop tests](https://github.com/fluffydisk/airdrop-linux/actions/runs/39811197914), completed without store uploads.
- [Canonical's official container images and usage](https://github.com/canonical/snapcraft-rocks).
- [Snapcraft export-login options](https://documentation.ubuntu.com/snapcraft/stable/reference/commands/export-login/).
- [Store macaroon permission definitions](https://dashboard.snapcraft.io/docs/reference/v1/macaroon.html#reference).
