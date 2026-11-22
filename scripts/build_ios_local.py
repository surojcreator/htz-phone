"""
Build the iOS app locally, no CI and no Mac.

The native shell never changes between JS-only releases, so the IPA is produced
by taking the newest good IPA as a base, swapping in the freshly exported Hermes
bundle and stamping the new version into Info.plist.

Usage:
    python build_ios_local.py [--base path.ipa] [--bundle x.hbc] [--out out.ipa]

Defaults resolve to the newest matching file, and the version comes from
app.json, so a normal release is just:
    npx expo export --platform ios --output-dir dist-ios
    python build_ios_local.py
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import plistlib
import sys
import zipfile

HERMES_MAGIC = bytes.fromhex("c61fbc03")
BUNDLE_IN_APP = "Payload/HtzPhone.app/main.jsbundle"
PLIST_IN_APP = "Payload/HtzPhone.app/Info.plist"


def newest(pattern: str) -> str | None:
    files = glob.glob(pattern, recursive=True)
    return max(files, key=os.path.getmtime) if files else None


def app_version() -> tuple[str, str]:
    with open("app.json", encoding="utf-8") as f:
        cfg = json.load(f)["expo"]
    return str(cfg.get("version", "0.0.0")), str(cfg.get("ios", {}).get("buildNumber", "1"))


def stamp_plist(data: bytes, version: str, build: str) -> bytes:
    info = plistlib.loads(data)
    info["CFBundleShortVersionString"] = version
    info["CFBundleVersion"] = build
    return plistlib.dumps(info, fmt=plistlib.FMT_BINARY)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=None, help="IPA to repack (default: newest in dist-ios-ipa)")
    ap.add_argument("--bundle", default=None, help="Hermes bundle (default: newest .hbc in dist-ios)")
    ap.add_argument("--out", default=None, help="output IPA (default: dist/HtzPhone-<version>.ipa)")
    args = ap.parse_args()

    version, build = app_version()

    base = args.base or newest("dist-ios-ipa/*.ipa")
    bundle = args.bundle or newest("dist-ios/_expo/static/js/ios/*.hbc")
    out = args.out or f"dist/HtzPhone-{version}.ipa"

    if not base:
        print("no base IPA found in dist-ios-ipa/", file=sys.stderr)
        return 2
    if not bundle:
        print("no exported bundle found — run: npx expo export --platform ios --output-dir dist-ios", file=sys.stderr)
        return 2

    js = open(bundle, "rb").read()
    if js[:4] != HERMES_MAGIC:
        print(f"{bundle} is not Hermes bytecode (magic {js[:4].hex()})", file=sys.stderr)
        return 3

    print(f"base   {base} ({os.path.getsize(base)} bytes)")
    print(f"bundle {bundle} ({len(js)} bytes)")
    print(f"stamp  version {version} ({build})")

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)

    replaced_bundle = 0
    replaced_plist = 0
    with zipfile.ZipFile(base) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            body = src.read(info.filename)
            if info.filename == BUNDLE_IN_APP:
                body = js
                replaced_bundle += 1
            elif info.filename == PLIST_IN_APP:
                body = stamp_plist(body, version, build)
                replaced_plist += 1
            dst.writestr(info, body)

    if not replaced_bundle:
        os.remove(out)
        print(f"{BUNDLE_IN_APP} not found in the base IPA", file=sys.stderr)
        return 4
    if not replaced_plist:
        print("warning: Info.plist not found — version not stamped", file=sys.stderr)

    digest = hashlib.sha256(open(out, "rb").read()).hexdigest()
    print(f"\nwrote  {out} ({os.path.getsize(out)} bytes)")
    print(f"sha256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
