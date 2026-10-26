# Signed upstream Flatpak updates

This is an independent upstream GitHub Pages channel, not a Flathub submission.
The application ID remains `io.github.fluffydisk.airdrop-linux`, branch `stable`,
architecture **x86_64**. The initial repository revision is **1.5.0 revision 3**;
it retains the working r2 functionality and adds a distribution provenance file.
The existing v1.5.0 tag and standalone release assets are not replaced.

## Live channel and public addresses

The signed revision 3 channel is live. Actual public HTTPS installation, forward
update from signed r2, original-bundle migration, X11/Wayland application checks
and APT/RPM provenance passed in
[run 40419140503](https://github.com/fluffydisk/airdrop-linux/actions/runs/40419140503).
Production signing and Pages deployment retain the existing **package-publishing**
environment and its required human reviewer.

Addresses:

- Repository: https://fluffydisk.github.io/airdrop-linux/flatpak/
- Remote configuration: https://fluffydisk.github.io/airdrop-linux/airdrop-linux.flatpakrepo
- Application reference: https://fluffydisk.github.io/airdrop-linux/airdrop-linux.flatpakref
- Checksum-pinned installer: https://raw.githubusercontent.com/fluffydisk/airdrop-linux/bb5e6903562476702cbc4b8b70296a75643b6b2b/scripts/install-flatpak.py
- Signed channel receipt: https://fluffydisk.github.io/airdrop-linux/flatpak-channel.json
- Receipt signature: https://fluffydisk.github.io/airdrop-linux/flatpak-channel.json.asc

Pinned project signing fingerprint:
`6513D70958397F60D3787A0CB93F4FC1E97CF3AE`.
This is the existing authorized APT/RPM identity. No new production key is created.

The corrected bootstrap handles non-UTF8 GPG key-UID diagnostics without changing
signature validity. Its Pages copy is awaiting the existing required review in
[run 40419422199](https://github.com/fluffydisk/airdrop-linux/actions/runs/40419422199).
Use the immutable GitHub installer below until that copy is refreshed. The signed
repository itself is already working; this refresh preserves its application
commit and all user data.

## Fresh installation and r2 migration

Install the normal client prerequisites. On Omarchy/Arch:

```sh
sudo pacman -S --needed flatpak python gnupg ostree
```

Quit Airdrop completely. Download and checksum-check the fixed installer
(no `curl | sh` and no signature bypass):

```sh
curl --proto '=https' -fL https://raw.githubusercontent.com/fluffydisk/airdrop-linux/bb5e6903562476702cbc4b8b70296a75643b6b2b/scripts/install-flatpak.py -o install-flatpak.py
printf '%s  %s\n' 9a9791cc4d8e97d6a609839f875c023cecb8e82334cf8fd23de8c322dd7525d3 install-flatpak.py | sha256sum -c -
python3 install-flatpak.py --dry-run
```

For a fresh user installation:

```sh
python3 install-flatpak.py --user
flatpak run --user io.github.fluffydisk.airdrop-linux
```

For an existing r2 bundle installation, preserve its current scope automatically:

```sh
python3 install-flatpak.py
```

The installer reports whether it found `--user` or `--system`. It requires the
known actual r2 commit or an existing trusted channel origin, rejects newer
installed versions/revisions, verifies both public summary and commit signatures,
and compares the remote head to the signed channel receipt before installation.
An existing remote must have the exact expected URL, primary key set, and enabled
commit/summary verification. Conflicts are rejected; no remote URL/key is silently
replaced. An existing user/system duplicate or named system installation requires
manual review rather than guessing which copy to remove. System changes use
Flatpak's normal authorization; launch the application as your desktop user.

No `--delete-data`, data migration, filesystem override, or Tailscale re-login is
performed. The same ID retains the normal host data directory:

```text
~/.var/app/io.github.fluffydisk.airdrop-linux/data/airdrop/
  files/
  config/
  state/desktop/connections/tsnet/
```

Custom Flatpak overrides are not reset. The installer does not kill a running
application. A short wait accommodates already-exited CLI sandbox cleanup.

After the one-time migration, use standard Flatpak updates, including your GUI
software manager. No bundle download is needed:

```sh
flatpak update --user io.github.fluffydisk.airdrop-linux//stable
```

For an existing system installation use:

```sh
flatpak update --system io.github.fluffydisk.airdrop-linux//stable
```

The [standalone r2 bundle](https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/airdrop-linux-1.5.0-x86_64-reference-r2.flatpak)
and its checksum remain available for manual installation. After joining the
signed channel, use `flatpak update`; reinstalling an old standalone bundle is
not an update procedure.

## Maintainer pipeline

1. Update `packaging/flatpak-channel/channel.json` with an immutable application
   commit reachable from main and a new repository revision. Pushes affecting
   channel/build scripts also run validation. Manual dispatch can select a pinned
   source and revision, with publication optional.
2. `flatpak-update-repository.yml` regenerates verified npm/Go sources, performs a
   clean offline x86_64 build, and reuses the full reference validator. The signed
   repository tests install the actual r2 app, publish a newer payload, run real
   `flatpak update`, migrate the original r2 bundle, and check user/system scope,
   persistence and wrong-key signatures. Test keys are disposable and never
   published as production trust.
3. The workflow rehearses the existing APT/RPM signer and combined Pages tree
   with actual release packages. The final signed x86_64 repository is linted;
   the complete site must fit GitHub Pages' documented 1 GB limit.
4. Only a successful main-branch candidate run can enter the existing protected
   `package-publishing.yml` workflow. Its artifact checksum, run provenance,
   application marker and repository content are verified before signing. The
   protected production key is imported only after required reviewer approval.
   Missing protected key/fingerprint variables fail explicitly without printing
   secret material. Protected environment rules are not changed.
5. The existing publisher builds the native repositories and adds the signed
   Flatpak tree. Flatpak publication verifies native file hashes before/after its
   addition; native package URLs, versions, key identity and payloads remain
   independent. Native-only publications preserve a modern Flatpak channel rather
   than rebuilding it from an older release bundle.
6. A complete Pages artifact is deployed atomically through the existing single
   `package-repositories` concurrency group. Current/previous x86_64 payloads are
   retained for update/cache overlap; the first transition also retains the old
   x86_64 legacy head. Historical ARM Flatpak bundles remain release assets, but
   the modern repository does not advertise unverified ARM builds. ARM APT/RPM
   repositories are preserved.
7. The post-deployment public check downloads over HTTPS, verifies the production
   key, installs the app, prepares the signed previous revision in a disposable
   account, proves a normal forward `flatpak update`, migrates the actual r2
   bundle, exercises backend/LAN/QR/clipboard/X11/Wayland, and verifies the public
   APT/RPM signatures and original release payloads.

Only obsolete pre-channel publication requests for the same/older native version
are retired automatically; current protected review requests are not approved or
modified. If the signed live channel already contains the requested revision or
newer, no duplicate production approval is requested.

Do not reuse a revision for different application content. The publisher rejects
repeated/older version-revision pairs. The receipt records both application and
workflow source commits. The `.flatpakrepo` and `.flatpakref` embed only the public
key; production private material is removed from its temporary keyring on exit.

## Test scope and remaining limits

See [the evidence report](signed-flatpak-evidence.md). Retention tests use explicit
credential/state fixtures and exact file hashes; they are not authenticated
Tailscale account or physical phone/tablet tests. Real Tailscale browser-login
bootstrap and the existing LAN/QR/file/ZIP/clipboard checks run against the signed
installed package where the network permits. Interactive physical desktop portal
consent and authenticated two-device transfer remain separate user acceptance.
Electron remains the existing official binary; no Flathub-ready claim is made.

Official mechanisms:

- https://docs.flatpak.org/en/latest/hosting-a-repository.html
- https://docs.flatpak.org/en/latest/flatpak-command-reference.html
- https://docs.flatpak.org/en/latest/using-flatpak.html
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments
