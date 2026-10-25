# Flatpak r2 device-sharing validation

Implementation and publication evidence is being collected by the r2 workflow.
This document will be updated with the successful run and published checksum.
No authenticated tailnet or physical two-device success is claimed.

Local regression baseline: 100/100 Node tests passed, no skips, with real dufs
available and umask 022. The first run under inherited umask 077 failed the
pre-existing portable-updater executable-mode assertion; its log is retained.
An intermediate run without dufs skipped that existing integration test. Both
were rerun with the documented dependencies/environment, without weakening tests.

The first actual tsnet control-plane attempts in the managed cloud environment
did not produce an authentication URL within the test timeout. No sharing URL or
QR was advertised. The failed attempts are preserved under
`.test-artifacts/device-connect/`; authenticated tailnet transfer is not inferred
from controlled UI state tests.

See [device-sharing architecture and commands](device-sharing.md).
