# iOS / iPadOS Share Sheet templates

These are reproducible action recipes, not signed `.shortcut` files. Device validation is pending: no physical iPhone/iPad was available during implementation. Action labels may differ by iOS version and language. The companion [action template](ios-shortcuts-template.json) documents the same inputs and sequence; importing that JSON into Shortcuts is not supported.

Prerequisites: Tailscale connected on both devices, Airdrop installed on Linux, and the HTTPS PWA reachable at `https://<hostname>.<tailnet>.ts.net/ui/`. You do not need to enable web notifications to use a Shortcut.

Apple documents [running shortcuts from another app](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-another-app-apd163eb9f95/ios) and [Share Sheet input types](https://support.apple.com/en-gb/guide/shortcuts/apd7644168e1/ios).

## Template 1: Send files to Airdrop

1. Create a Shortcut named **Send files to Airdrop**. In Details, enable **Show in Share Sheet**. Configure inputs to **Files** and **Images**. Do not enable Safari Web Pages or arbitrary text for this shortcut.
2. Add a **Text** action containing your server origin, for example `https://desktop.example-tailnet.ts.net`, without `/ui/` or a trailing slash. Rename its output variable **Airdrop Server**. For one-time configuration, add an import/setup question to this Text action asking “What is your Airdrop HTTPS server address?”. If setup questions are unavailable on your version, edit this one Text value before first use.
3. Add **If Shortcut Input has any value**. Otherwise use **Select File** with multiple selection enabled and set a variable **Files to Send**. In the first branch, set **Files to Send** to **Shortcut Input**.
4. Add **Repeat with Each** item in **Files to Send**.
5. Inside the loop, use **Get Details of Files → Name** for **Repeat Item**, preserving its extension. If the input is a photo converted to an image, use **Convert Image → JPEG**, then **Set Name** to a unique name such as `photo-<current date YYYYMMdd-HHmmss>-<Repeat Index>.jpg`; use this converted file as the upload body. Ordinary files retain their original bytes and names.
6. Apply **URL Encode** to the file's name only. Build a **Text** URL: `Airdrop Server` + `/push/files/` + `Encoded Name`. Keep the slash separators literal; do not encode the whole URL.
7. Add **Get Contents of URL**, choose **PUT**, and choose a **File** request body containing the file from step 5. Use the URL from step 6. This endpoint expects raw file bytes, not a Form or JSON body.
8. Read the resulting JSON dictionary. If it contains **error**, show that value with **Show Alert** and **Stop This Shortcut**. Otherwise collect its **name** in a variable **Uploaded Names**; the server may return `file (1).pdf` on conflicts.
9. After the loop, combine **Uploaded Names** with newlines and show a notification or result: “Sent to Airdrop” plus those names.

Network failures may stop **Get Contents of URL** before later actions execute. Reconnect Tailscale, check the server URL, and rerun using the original files. Previously uploaded files remain available; a retry receives a new numbered name instead of replacing them. If a file name starts with `.` or contains a path separator, rename it before sharing.

For a single ZIP from iOS, use Shortcuts' **Make Archive** action on **Files to Send**, set a `.zip` name, and send that one file through steps 5–8. This optional native iOS recipe is independent of the PWA/CLI/GUI 100 MiB ZIP creation limit.

## Template 2: Send text or a URL to the shared clipboard

1. Create **Send text to Airdrop**. Enable **Show in Share Sheet**, accepting **Text** and **URLs**. URLs are stored as text; the shortcut does not fetch the linked page.
2. Add the same **Airdrop Server** Text action and setup question as above.
3. If **Shortcut Input** is empty, use **Get Clipboard**. Otherwise use the shared input. Apply **Get Text from Input** and combine multiple items with newlines.
4. Add **Set Name** with `.clipboard.txt` to that text, creating a text file for the request body.
5. Build the URL `Airdrop Server` + `/.clipboard.txt`.
6. Add **Get Contents of URL → PUT → Request Body: File**, using the named text file. On success, show “Clipboard sent to Airdrop”. HTTP/network failure stops the shortcut; reconnect and retry. Sending an empty string intentionally clears the shared clipboard.

On Linux, run `copy-clipboard` to bring this text into the system clipboard. PWA users can use **Copy**.

## Physical-device acceptance checklist

- Files app: one PDF, multiple files, Unicode and comma-containing names, and a name already present on the server.
- Photos app: one and multiple photos, verifying extension and JPEG contents.
- Safari: a URL reaches the shared clipboard as text; selected text does too.
- Tailscale disconnected: the shortcut reports/stops on failure and never claims success.
- Confirm uploaded bytes on Linux and the returned numbered names.

Until this checklist is run, this template is documented and API-tested, but not validated on an Apple device.
