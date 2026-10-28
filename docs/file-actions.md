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
