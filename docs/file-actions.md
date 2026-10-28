# File selection, trash deletion and drag moves

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
made. Signed clean-build and publication results must be recorded when available.

The first package-validation run (40731893825) failed its two native jobs:
`scripts/test-native-drag.cjs` still used unmodified pointer input, whereas
external native exports now require Alt. Both original failure-log excerpts are
retained. The test now presses/releases Alt for the actual separate-process X11
receiver. Internal same-folder/folder movement is tested using Chromium pointer
input, with real filesystem/inode assertions. Both passed locally (native-drag.log).
Attempts to use xdotool for the internal HTML drop did not reliably produce a
drop event; those original failed outputs are preserved too. This is distinct
from the successful Chromium pointer-input test, not a physical desktop claim.
The unchanged application candidate passed clean signed build and all signing,
update and migration tests in run 40731893531. Production publication remains
pending its existing reviewer gate; package CI must also pass before approval.
