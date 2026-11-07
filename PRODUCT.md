# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

Electron desktop application for Linux; this scope excludes the separate mobile PWA.

## Users
Linux users sharing files and clipboard text with their other devices or a temporary guest. Audience inferred from the existing application and release brief.

## Product Purpose
Make local file sharing, device connection, and safe application updates understandable and reliable.

## Capabilities and Constraints
Preserve Transfer, Files, Clipboard, Settings, pairing, connection diagnostics and existing user data. Keep the existing HTML, CSS, JavaScript and sandboxed Electron IPC. Respect package-manager ownership, signed Flatpak repositories, update integrity checks, and active transfers. No new framework or paid services.

## Brand Commitments
Keep the Airdrop name, paper-plane identity, and familiar blue action color. Professional desktop software with light and dark themes, clear typography, keyboard access, and restrained motion. These requirements come from the user's release brief.

## Evidence on Hand
Existing desktop implementation, Node and Electron regression tests, packaging definitions and release workflows. Public baseline v1.6.8. Actual upgrade and distribution validation are release gates, not assumed capabilities.

## Product Principles
- State what is happening and how to recover.
- Preserve data and ongoing operations.
- Distinguish update discovery, download, installation and restart.
- Keep frequent tasks visible and advanced configuration secondary.

## Accessibility & Inclusion
Keyboard operation, visible focus, contrast in both themes, reduced motion and layouts down to the supported minimum window size.
