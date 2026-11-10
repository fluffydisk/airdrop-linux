# Native BLE bootstrap validation record

This record separates automated software evidence from stock-device evidence.
No Galaxy S24+ connection or transfer has been observed for this implementation.
See [implementation and limits](quickshare-ble-implementation.md) and the
[owner procedure](quickshare-s24-test.md).

Cloud validation uses Rust 1.99.1, Node 26.12.0, the pinned Electron dependency,
private disposable data and Chromium sandboxing. No Bluetooth adapter is present.

| Command / check | Result |
| --- | --- |
| `npm test` | 236 passed, zero skipped. Includes selector readiness/deduplication, IPC routing, consent/publication/cancellation, diagnostic allowlists and feature gates. |
| `cargo test --workspace --locked` in `network/quickshare` | 33 passed. |
| `cargo test --workspace --locked --features airdrop-quickshare/ble-native,airdrop-quickshare/ble-fastinit` | 49 passed. Includes independent wire fixtures, fragment ordering/limits/timeouts, malformed inputs, bare/framed commands, final-frame drain, cancellation before session subscription, GATT-only readiness, partial dual-advertiser fallback, unsupported controllers and unavailable-BlueZ restart. |
| `cargo fmt --all --check`; `cargo clippy --workspace --locked --features airdrop-quickshare/ble-native,airdrop-quickshare/ble-fastinit` | Pass. Existing warnings in the vendored inactive upgrade/core code remain; no new wrapper warnings. |
| `python3 tests/quickshare-ble-oracle.py` | Independent Python full/header/Bloom/Weave fixtures agree. This is a wire oracle, not a radio/Android result. |
| `AIRDROP_TEST_QUICKSHARE_HELPER=... /usr/bin/python3 tests/quickshare-independent.py` | Six independent Python/OpenSSL cases pass: commitment, MAC, replay, decline, empty and binary/Unicode receive/hash checks. Direct LAN transport. |
| `AIRDROP_TEST_QUICKSHARE_HELPER=... node --test tests/quickshare-native.cjs` | Default helper lifecycle passes without BlueZ. |
| Same command with `tests/quickshare-ble-native.cjs`, using a `--ble-native` artifact | Three repeated native-feature starts/stops, read-only preflight, visibility and LAN fallback pass; missing runtime opt-in is rejected. |
| `xvfb-run -a dbus-run-session -- node --test tests/quickshare-lab-native.cjs` and `tests/quickshare-lab-desktop.cjs` | Default lab lifecycle and sandboxed UI pass. |
| Same lab commands with `AIRDROP_TEST_QUICKSHARE_BLE_NATIVE=1` | BLE-enabled prepare/start/report/stop/restart and sandboxed UI pass; unrelated process survives; old synthetic observations do not carry over. No successful controller is mocked. |
| `xvfb-run -a dbus-run-session -- node --test tests/desktop.cjs tests/nearby-desktop.cjs` | Two desktop/real transfer checks pass; tray test explicitly skips without a StatusNotifier watcher. |
| `tests/quickshare-protocol.cjs` independent network namespaces | Requires root/disposable-VM namespace privileges unavailable to this cloud user; retained in x64/ARM64 GitHub CI with no weakened assertion. |
| Source/licensing/gates | New Google schema matches the inspected source byte-for-byte; Apache/GPL notices retained. Upstream experimental hotspot/upgrade feature stays disabled; stable packaging exclusions remain tested. |

The PR's **Experimental Quick Share foundation** workflow runs default and optional
Rust features, the independent protocol checks, both native process contracts,
network-namespace transfers and both lab modes on x64 and ARM64. Consult the
PR's checks for committed-head CI results, separately from this local record.

Unverified physical behavior includes advertising emission, controller feature
fallback, address rotation, actual concurrent scanning/advertising, GATT CCCD /
indication timing, LE CoC acceptance, adapter removal/recovery and every stock
S24+ authentication/transfer outcome. Registering GATT or advertising cannot pass
those acceptance gates. Authenticated LAN upgrade/direct wireless remain absent.
