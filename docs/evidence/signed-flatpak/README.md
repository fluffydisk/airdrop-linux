# Signed Flatpak validation evidence

Downloaded from the successful run:
https://github.com/fluffydisk/airdrop-linux/actions/runs/40245958434

Workflow source: `7615fea6f53ee9ae5a784e1759d1f562120bf1f8`.
Application source: `91363da43c2cd28173201f397c5b9f1ea8cde132`.

`validated/` retains the reference-validator output, including the separate
Flathub limitations and the one skipped host-dufs unit case. `local-unit-tests.log`
is the Cloud run with the real dufs prerequisite: 104 passed, zero skips.
`signed-tests/` and `signed-tests.log` contain the actual cryptographic/update and
application tests; all keys in the fixture descriptors are disposable public
test keys, **never production trust**. No private signing keys or login URLs are
included. `prepared/` records the immutable build inputs. `ci-summary.log` retains
the real complete-Pages size and test results from the Actions job log.

`previous-failures.log` preserves the original failed CI assertions; later success
does not erase those attempts. The full original runs remain linked there.
Trailing whitespace and extra blank lines at EOF are normalized in text logs;
messages and failures are retained. `SHA256SUMS` covers all evidence files except itself.

Production signing/deployment is waiting for the pre-existing required reviewer:
https://github.com/fluffydisk/airdrop-linux/actions/runs/40246905953

These are disposable-key results, not evidence that the new public channel has
already been published. See [the status matrix](../../signed-flatpak-evidence.md).
