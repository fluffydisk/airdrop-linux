# Desktop workspace integration

This update keeps the application ID, shared file tree, clipboard format and
private tsnet identity directory unchanged. It adds:

- **Shared folder** opens the current shared folder in the system file manager.
  Flatpak passes a read-only directory FD to OpenURI.OpenFile, which supports
  directories; it does not invoke the host shell or request home access.
- Files in the shared explorer can be dragged out, including a selection of up
  to 100 regular files. Flatpak exports the validated, inherited file descriptors
  through the Documents portal, then gives the resulting document paths to
  Electron's native drag API. Exports are transient. Original files stay intact.
  Directories, traversal and symbolic links are rejected. The destination app
  determines whether dropping a file inserts it, attaches it or copies it.
- Transfer presents Choose, Drop and Ctrl+V together, with an explicit paste
  button. Native file-URI clipboard formats copy accessible files; FileTransfer portal keys retrieve sandbox grants without host filesystem access; text and
  images create shared files. Electron 44 raw OS clipboard targets are supported as well. Plain text that happens to contain a file URI is
  never treated as permission to read it. Inaccessible sandbox clipboard files
  direct the user to Choose files. Cut clipboard entries never delete originals.
- Flatpak first-run setup requires a ready app-managed Tailscale HTTPS connection before
  Continue is enabled. Escape, errors, a saved external address and LAN readiness
  cannot complete it. Quit remains available. Completed setup is persisted only
  after the helper has verified the TLS certificate and authenticated health
  route. Existing node identity is retained. After setup, LAN/local modes remain
  available. This intentionally changes the previous optional Flatpak first-run flow. Native
  distributions without an embedded helper retain local operation; they cannot
  be blocked behind an unavailable embedded connection. A regression covers this.
- Settings shows the same live pairing address as Connect device and its QR.
  Stopped or failed connections clear both. External workspace settings remain
  under Advanced and do not overwrite the active device link.
- Seven persistent file orders: name both directions, date both directions,
  size both directions, and type; folders remain first. Modification dates are
  shown. Appearance supports system/light/dark, four accents, spacing, reduced
  animation, startup view and ZIP default. Reset never clears files or identity.

## Reproducible checks

```sh
umask 022
npm ci --ignore-scripts
npm test
npm run test:browser
npm run prepare-desktop
# Requires installed Electron, a display/Xvfb and normal Chromium sandbox support.
xvfb-run -a dbus-run-session -- npm run test:desktop
# Also requires xdotool and a Chromium installation (CHROMIUM_PATH optional).
xvfb-run -a -s '-screen 0 1800x1000x24' dbus-run-session -- node scripts/test-native-drag.cjs
cc -Wall -Wextra -Werror packaging/flatpak/open-directory-portal.c \
  -o /tmp/airdrop-file-portal $(pkg-config --cflags --libs gio-unix-2.0)
dbus-run-session -- /usr/bin/python3 scripts/test-file-portal.py /tmp/airdrop-file-portal
```

Cloud used the already verified Electron runtime through an external launcher,
with Chromium's sandbox enabled, and private extracted GIO development tools.
The controlled portal fixture uses real D-Bus and FD transport; it does not
claim to open a physical file manager. The Electron suite replaces shell.openPath
and startDrag to check IPC dispatch and validated paths. Local-operation suites
explicitly close the first-run modal as a **test-only DOM action**; they do not
claim to authenticate a real Tailscale account. No production bypass was added.

Evidence in `evidence/workspace-improvements/`:

| Check | Result | Evidence |
| --- | --- | --- |
| Unit/regression tests | 112 passed, no failures/skips | unit-tests.log |
| Browser file/ZIP/clipboard integration | passed | browser.log |
| Electron integration, sandbox, persistence, real file-URI clipboard paste button and Ctrl+V | passed; tray test skipped because no StatusNotifier host | electron.log |
| Compiled portal helper, FileTransfer clipboard retrieval, directory FD, request identity, denial, inherited original file after replacement, transient export lifetime | passed with controlled service | file-portal.log |
| Real pointer drag to a separate Chromium process on X11 | passed, exact Unicode filename/bytes and source retained | native-drag.log |
| Physical Omarchy default file manager and Wayland drag to external app | not tested in this worker | requires target desktop |
| Authenticated two-device Tailscale HTTPS transfer | not tested without account/device access | no reviewer or device acceptance claim |
| Updated clean Flatpak build and signed distribution | tracked by the pinned channel candidate workflow | record run before claiming publication |

The original failing logs are retained: restrictive inherited umask caused an
existing updater mode assertion; the standard 0022 test environment passes.
An initial new folder test double stopped tracking later open-file calls and
was corrected. Real Electron testing then caught in-memory clipboard images
being treated as disk files; the renderer now falls back to native image
clipboard decoding when webUtils reports no file path. The full suite passed
following that product fix.

The first Ubuntu Actions native-drag test failed on both CPUs because the
**separate Playwright Chromium receiver** had no AppArmor user-namespace rule
(run 40702946779). Airdrop's installed sandbox and its desktop tests had passed.
The CI fixture now loads an exact-executable rule with the existing profile
generator and removes it on exit. It does not disable Chromium sandboxing or
change a system-wide restriction. The raw failure excerpts remain in evidence.
The generic local Flatpak test recipe also compiles the new portal helper, so
its CI payload includes the same integration as the stable source-built recipe.

Candidate run 40704351299 passed the clean build, lint, installation/startup,
actual signed r2 update/migration, signature rejection and backend checks, then
failed the final desktop smoke when the document portal could not mount
`update-runtime.../doc` (permission denied). The test reused the runtime across
system-scope operations and new D-Bus sessions. Each functional session now uses
a fresh 0700 directory owned by the test user, created before D-Bus activation.
No sandbox or FUSE verification is bypassed. Full desktop failure:
`failures/signed-desktop-shared-runtime.log`; original artifact 12822799654 SHA256
`f60de28cb0d69e8a4696a8e00d5ee61bc1641c055c7522582b11390f9a25197f`.
