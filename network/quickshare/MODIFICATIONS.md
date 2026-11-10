# Protocol core provenance and modifications

Original source: ignotusbucius/open-quickshare commit
`fb9c8f9502e5313e3d788aa3498659773ef12d28`, core only. Original input hashes are
preserved in `upstream-files.sha256`; those hashes deliberately do not describe
our modified files. The upstream Tauri/AGPL application is excluded.

The upstream GPLv3-or-later grant remains in the original license. This
distribution selects GPLv3 for its covered modifications; selecting that version
does not remove the upstream recipients' original rights. Existing MIT and
Apache/BSD component grants remain in effect.

Files modified by Airdrop Linux, recorded 2026-11-10:

| File under vendor/rqs_lib | Changes |
| --- | --- |
| Cargo.toml | Locked Git dependencies; disabled default wireless features; release profile moved to workspace root |
| src/lib.rs | Local receive directory; headless modules and feature guard |
| src/manager.rs | Bounded incoming sessions/timeouts; correct outgoing UUID on failure |
| src/utils.rs | Anonymous advertisements, validated P-256 coordinates, persistent frame prefix, version/name/TLV bounds |
| src/hdl/mdns_discovery.rs | On-link address filtering, bounded probes, closed-channel exit |
| src/hdl/inbound.rs | Consent, safe names/private staging, file completion bounds, shared setup-payload limits, cancellation-safe prefix |
| src/hdl/outbound.rs | Safe source reads, empty/truncated source handling, shared payload bounds, truthful LAN roles, finalization errors and unconfirmed sender outcome |
| src/hdl/mod.rs | Local payload assembler and explicit sent-but-unconfirmed state |
| src/receive_safety.rs | Added filename, count and size limits |
| src/secure_payload.rs | Added MAC-before-parse, CBC/padding checks and vectors |
| src/bytes_payload.rs | Added symmetric bounded setup reassembly and regression tests |

Wrapper `src/main.rs` and the tests are local additions. File headers identify
modifications; this index supplies their scope. Future changes must update this
record rather than replacing original attribution or original-input hashes.

Binary publication is still blocked. Complete corresponding source, enabled
dependency license/SBOM review, final-package source/binary provenance,
installation-information assessment and required specialist review remain gates.
IPC separation is not a copyleft exemption. See THIRD-PARTY-NOTICES.md for the
Chromium schema's distinct BSD terms and remaining historical mapping question.
