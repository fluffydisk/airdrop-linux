# Snap Store listing package

Use `packaging/snap/store-listing.json` for the final English title, categories,
summary, description and verified project links. Primary category: Productivity;
secondary: Utilities, for the file manager and clipboard tools. License: MIT.
No donation, social, promotional or email address is invented.

The publication credential deliberately has only `package_access`, `package_push`
and `package_release`; it has no `package_update` permission. Do not broaden it
just to edit this listing. The minimal dashboard procedure is:

1. Open <https://snapcraft.io/airdrop-linux/listing> while signed in as the publisher.
2. Paste `listing.json` fields and `description.txt`; select Productivity and
   Utilities, retain MIT, and use the project Issues URL as the contact link.
3. Upload `icon.png` and `01-transfer.png`, `02-files.png`, `03-clipboard.png`.
4. Preview, then Save. Video, donations and the optional featured banner may stay
   empty. Confirm the public page after the first stable release.

## Real screenshots and image requirements

The `snap-listing` mode of **Prepare and submit store packages** downloads the
existing validated amd64 v1.5.0 Snap from producer run `39819533208`. It verifies
its SHA3-384 against the authenticated Store revision inventory, installs that
exact strict local artifact and launches the actual Electron application with
Chromium sandboxing and its real bundled backend. The native chooser's selection
is automated with demonstration files; uploads, file browsing and clipboard
sharing use the unchanged running application. No mock UI, fabricated device
connection or substituted backend is used.

`capture-evidence.json` records version, producer, architecture, digest and method.
These screenshots are local strict-install evidence; they do not claim that an
unreleased Store package has passed Store installation tests.

Canonical's current publisher UI accepts PNG/JPEG/SVG icons between 40 and 512
pixels square, up to 256,000 bytes. The reused app icon is a 512x512 PNG.
Screenshots accept GIF/JPEG/PNG, 480x480 through 3840x2160, aspect ratio between
1:2 and 2:1, maximum 2 MB. Captures are PNG at 1440x900 and checked below 2 MB.
The app's own icon is reused; no generated artwork or featured banner is needed.

Requirements were checked against Canonical's publisher implementation:

- <https://github.com/canonical/snapcraft.io/blob/main/static/js/publisher/pages/Listing/ListingDetails/ListingDetails.tsx>
- <https://github.com/canonical/snapcraft.io/blob/main/static/js/publisher/pages/Listing/ListingDetails/Screenshots.tsx>

The workflow attaches a uniquely named listing ZIP to the existing v1.5.0 GitHub
release. It never replaces an existing release asset. Uploading listing content
does not resolve the separate Store browser-sandbox review or publish a channel.
