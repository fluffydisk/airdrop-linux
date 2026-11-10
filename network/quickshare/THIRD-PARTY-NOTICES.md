# Third-party source notices

The Google-authored protocol schemas (`device_to_device_messages.proto`,
`offline_wire_formats.proto`, `securegcm.proto`, `securemessage.proto`,
`ukey.proto`) preserve their Apache-2.0 notices. See `licenses/Apache-2.0.txt`.

`vendor/rqs_lib/src/proto_src/wire_format.proto` instead retains Copyright 2020
The Chromium Authors and its BSD-style notice. The BSD redistribution conditions
are provided in `licenses/Chromium-BSD.txt`, copied without alteration from
Chromium tag 86.0.4240.75 (2020), `LICENSE`:
https://github.com/chromium/chromium/blob/86.0.4240.75/LICENSE
SHA-256: `845022e0c1db1abb41a6ba4cd3c4b674ec290f3359d9d3c78ae558d4c0ed9308`.
The schema identifies its original Google CL as 317565061; the precise internal
CL-to-public-source mapping remains a provenance review item before binaries
are distributed. Both Chromium attribution and the full conditions must appear
in binary notices. None of these schemas is relicensed solely as GPL.

The core's upstream source and GPL license are recorded in `README.md`,
`upstream-files.sha256`, `LICENSE` and `vendor/rqs_lib/LICENSE`. Rust dependencies
are pinned in `Cargo.lock`; their source licenses/notices must accompany any
future native binary edition's source/SBOM delivery. This file does not claim
that the unshipped native edition has completed its dependency license audit.
