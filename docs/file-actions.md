# File selection, trash deletion and drag moves

Published from source `25b7fa297901341e842863c082d72a60ae19969d` to the signed
stable x86_64 repository. [Publication 40748666878](https://github.com/fluffydisk/airdrop-linux/actions/runs/40748666878)
and its actual public HTTPS acceptance job completed successfully. No approval
remains pending for this build.

Select all selects the current folder or current Trash listing; Ctrl+A remains
available when the file manager has focus. Trash has Delete permanently for the
selected entries, with an explicit irreversible-deletion confirmation. Select
all then Delete permanently empties the visible trash. Restore remains available.

Drag a file onto another Airdrop folder or a breadcrumb to move it. Dropping in
its current folder is a no-op. Moves preserve file contents/inodes, reject links
and reject an existing destination name without overwriting either file.
Directories are drop targets; directory dragging is not supported. Destinations
outside the shared root and cross-filesystem moves are rejected.

Hold Alt while dragging to use Electron's native export to another application.
This exports a copy: Electron does not report a trustworthy destination/completed
move receipt, so source deletion would risk data loss. External file imports
remain copies; importing the same underlying file to its own folder is a no-op.
The Flatpak Documents portal and sandbox permissions remain unchanged.

Validation: 120/120 unit tests passed, including actual filesystem same-folder
no-op, inode-preserving move, destination collision, link escape, selective trash
deletion and self-import tests. Controlled DOM tests cover Select all, cancelled
and confirmed deletion, and folder drops. Native Electron integration passed;
tray testing was skipped without a StatusNotifier watcher. Its first run exposed
an existing asynchronous assertion that read the opener result before the IPC
completed; the assertion now waits for completion. Both outputs are preserved
under evidence/file-actions. No physical external-application drag/drop claim is
made. Final signed-build and publication evidence is recorded below.

The first package-validation run (40731893825) failed its two native jobs:
`scripts/test-native-drag.cjs` still used unmodified pointer input, whereas
external native exports now require Alt. Both original failure-log excerpts are
retained. The test now presses/releases Alt for the actual separate-process X11
receiver. Internal same-folder/folder movement is tested using Chromium pointer
input, with real filesystem/inode assertions. Both passed locally (native-drag.log).
Attempts to use xdotool for the internal HTML drop did not reliably produce a
drop event; those original failed outputs are preserved too. This is distinct
from the successful Chromium pointer-input test, not a physical desktop claim.
The initial application candidate passed clean signed build and all signing,
update and migration tests in run 40731893531. At that stage publication was pending
its existing reviewer gate and package CI had not yet completed.

Final HTTP regression: the initial deleteTrash returned undefined, so Express
sent an empty body and the web client could report a JSON parse error after
successful deletion. The real HTTP test reproduced this (trash-http-before-failure.log).
The operation now returns `{ok:true}`; the test consumes that JSON and verifies
Trash is empty. The final complete local suite passed 120/120 (unit-final.log).
The previously unapproved publication 40734002959 is superseded. The replacement
request retires only that exact run if it is still waiting and has its expected
source/workflow identity; started signing and unrelated runs are untouched.

## Final published evidence

The superseded unapproved request was cancelled. The corrected candidate
[40746981688](https://github.com/fluffydisk/airdrop-linux/actions/runs/40746981688)
passed all 18 signed acceptance checks. [Package validation 40746981983](https://github.com/fluffydisk/airdrop-linux/actions/runs/40746981983)
passed all 19 jobs, including native x86_64/ARM64 pointer-drag tests. The final
local unit suite passed 120/120; CI unit suites skip the dufs test before its
runtime is built, then exercise the actual runtime in packaged acceptance.

Public post-deployment logs are in `evidence/file-actions/public-40748666878/`:

| Verification | Result | Raw evidence |
| --- | --- | --- |
| Fresh HTTPS signed installation, previous public commit -> current standard update, original r2 migration | VERIFIED | `public-channel.log` |
| Same private files/node-state retention and one installation | VERIFIED with retention fixtures | `public-channel.log` |
| Packaged file/ZIP upload/download and isolation | VERIFIED | `public-backend.log` |
| X11, clipboard, LAN QR/pairing and transfer on one worker | VERIFIED | `public-desktop.log` |
| Headless native Wayland startup and update check | VERIFIED | `public-wayland.log` |
| Existing APT/RPM metadata/signatures and original release payloads | VERIFIED | `public-native.log` |
| Independent production key/receipt/OSTree signature check and unchanged bootstrap | VERIFIED | `verification.json`, `channel.json`, `channel.json.asc` |

The public app commit is `bc01a3007a9c3bad78e740514897fe6796dbf129b95e9bc1cf74e6c774af05cd`.
The downloaded public evidence ZIP was SHA-256 verified:
`aff001f8ef16f317c5cb8b1f0a9bbe07ff2cc59fe8e62d8688763bfc2f8d782f`.
Candidate-source checksums and signed tests are retained separately in
`evidence/file-actions/candidate-40746981688/`.

Use Settings > Check for updates > Update in an updater-enabled installation,
then Quit to finish update and reopen. Alternatively quit the app and run
`flatpak update --user io.github.fluffydisk.airdrop-linux//stable` for a user
installation. The portal install test, public standard update, virtual pointer
input and real physical desktop tests are distinct: no physical Omarchy/Wayland
drag or authenticated Tailscale account test is claimed.
