#!/usr/bin/env python3
"""Offline consistency checks for upstream Flatpak inputs, not Flathub approval.

Requires PyYAML (also used by prepare-flatpak-release.sh). The official builder
and linter remain required; this catches stale/missing inputs before SDK setup.
"""
import argparse
import base64
import configparser
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

import yaml


def check(root, application_source=None):
    packaging = root / "packaging"
    app_id = "io.github.fluffydisk.airdrop-linux"
    manifest = yaml.safe_load((packaging / f"{app_id}.yml").read_text())
    errors, sources, visited = [], [], set()

    def require(condition, message):
        if not condition:
            errors.append(message)

    def local_file(name, parent):
        file = (parent / name).resolve()
        require(file.is_relative_to(packaging.resolve()), f"Source escapes packaging/: {name}")
        require(file.is_file(), f"Missing local source: {file}")
        return file

    def walk(items, parent):
        for source in items:
            if isinstance(source, str):
                file = local_file(source, parent)
                require(file not in visited, f"Repeated or recursive source include: {file}")
                if file in visited or not file.is_file():
                    continue
                visited.add(file)
                walk(yaml.safe_load(file.read_text()), file.parent)
                continue
            sources.append(source)
            kind = source.get("type")
            require(kind in {"archive", "file", "patch", "inline", "script", "shell", "git"},
                    f"Unsupported or machine-local source type: {kind}")
            if "path" in source:
                local_file(source["path"], parent)
            if "url" in source:
                require(source["url"].startswith("https://"), f"Non-HTTPS source: {source['url']}")
                if kind == "git":
                    require(bool(re.fullmatch(r"[0-9a-f]{40}", source.get("commit", ""))),
                            f"Git source needs an immutable commit: {source['url']}")
                else:
                    require(any(re.fullmatch(r"[0-9a-f]{%d}" % length, source.get(key, ""))
                                for key, length in [("sha256", 64), ("sha512", 128)]),
                            f"Missing strong checksum: {source['url']}")

    require(manifest["app-id"] == app_id, "Manifest application ID mismatch")
    require(manifest["runtime-version"] == manifest["base-version"], "Runtime/BaseApp branch mismatch")
    require("--share=network" not in manifest.get("build-options", {}).get("build-args", []),
            "Network-enabled top-level build options")
    allowed = {"--share=ipc", "--share=network", "--socket=wayland", "--socket=fallback-x11",
               "--device=dri", "--talk-name=org.kde.StatusNotifierWatcher", "--env=GTK_USE_PORTAL=1"}
    require(set(manifest["finish-args"]) <= allowed, "Sandbox permission expansion requires review")
    for module in manifest["modules"]:
        require("--share=network" not in module.get("build-options", {}).get("build-args", []),
                f"Network-enabled build module: {module['name']}")
        walk(module.get("sources", []), packaging)

    # A changed lockfile must not silently leave the generated offline cache stale.
    hashes = {s[key] for s in sources for key in ["sha256", "sha512"] if key in s}
    # The manifest builds a published archive, which may differ from this
    # checkout. Release preparation supplies that verified archive explicitly.
    locks = [packaging / "flatpak/build-tools/package-lock.json"]
    if application_source:
        locks += [application_source / "package-lock.json", application_source / "desktop/package-lock.json"]
    for name in locks:
        lock = json.loads(name.read_text())
        for package, value in lock["packages"].items():
            if not package or value.get("dev"):
                continue
            integrity = value.get("integrity", "")
            algorithm, _, encoded = integrity.partition("-")
            require(algorithm in {"sha256", "sha512"}, f"Unsupported npm integrity: {name}: {package}")
            if algorithm in {"sha256", "sha512"}:
                require(base64.b64decode(encoded, validate=True).hex() in hashes,
                        f"Regenerate npm sources: {name}: {package}")

    provenance = json.loads((packaging / "flatpak/source-provenance.json").read_text())
    application = next(m for m in manifest["modules"] if m["name"] == "airdrop-linux")
    archive = application["sources"][0]
    require(archive["url"].endswith("/" + provenance["applicationCommit"]), "Application commit differs from provenance")
    require(archive["sha256"] == provenance["applicationArchiveSha256"], "Application hash differs from provenance")
    electron = [s for s in sources if s.get("dest") == "electron-runtime"]
    require(sorted(s.get("only-arches") for s in electron) == [["aarch64"], ["x86_64"]],
            "Electron requires separate x86_64 and aarch64 inputs")
    for source in electron:
        require(f"/v{provenance['electron']}/" in source["url"], "Electron version differs from provenance")

    metadata = ET.parse(packaging / f"{app_id}.metainfo.xml").getroot()
    require(metadata.findtext("id") == app_id, "AppStream ID mismatch")
    require(metadata.findtext("launchable") == f"{app_id}.desktop", "AppStream desktop ID mismatch")
    require(any(r.get("version") == provenance["tag"].removeprefix("v") for r in metadata.findall("releases/release")),
            "Packaged release missing from AppStream")
    desktop = configparser.ConfigParser(interpolation=None)
    desktop.read(packaging / f"{app_id}.desktop")
    for key in ["Icon", "StartupWMClass"]:
        require(desktop["Desktop Entry"][key] == app_id, f"Desktop {key} mismatch")
    require(desktop["Desktop Entry"]["Exec"] == manifest["command"], "Desktop launcher mismatch")
    if errors:
        raise ValueError("\n".join(errors))
    print(f"Flatpak inputs consistent: {len(sources)} sources, both architectures, {len(locks)} npm locks and metadata")
    print("This does not certify a build, runtime behavior or Flathub acceptance.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-source", type=Path,
                        help="Also check application npm locks from this extracted pinned release")
    args = parser.parse_args()
    try:
        check(Path(__file__).resolve().parents[1], args.application_source)
    except (ValueError, KeyError, OSError, TypeError, yaml.YAMLError, ET.ParseError) as error:
        sys.exit(str(error))
