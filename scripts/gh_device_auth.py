#!/usr/bin/env python3
"""
Authorize GitHub CLI with the `workflow` scope via the OAuth device flow,
then push the iOS workflow and trigger the macOS build.

Prints a one-time code, waits for approval, and continues automatically.
"""
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request

# GitHub CLI's public OAuth client id (same one `gh auth login` uses).
CLIENT_ID = "178c6fc778ccc68e1d6a"
SCOPES = "repo workflow read:org gist"
GH = r"C:\Program Files\GitHub CLI\gh.exe"
REPO = "surojcreator/htz-phone"


def post(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    start = post("https://github.com/login/device/code",
                 {"client_id": CLIENT_ID, "scope": SCOPES})
    code = start["user_code"]
    url = start.get("verification_uri", "https://github.com/login/device")
    interval = max(5, int(start.get("interval", 5)))
    expires = int(start.get("expires_in", 900))

    print("=" * 60)
    print(f"  CODE: {code}")
    print(f"  URL : {url}")
    print("=" * 60, flush=True)

    deadline = time.time() + min(expires, 280)
    token = None
    while time.time() < deadline:
        time.sleep(interval)
        try:
            res = post("https://github.com/login/oauth/access_token", {
                "client_id": CLIENT_ID,
                "device_code": start["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            })
        except Exception as e:
            print(f"  (poll error: {e})", flush=True)
            continue

        if res.get("access_token"):
            token = res["access_token"]
            break
        err = res.get("error", "")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval += 5
            continue
        print(f"  authorization failed: {err} {res.get('error_description','')}")
        return 1

    if not token:
        print("timed out waiting for approval")
        return 1

    print("  [ok] token received", flush=True)
    p = subprocess.run([GH, "auth", "login", "--with-token", "-h", "github.com"],
                       input=token, text=True, capture_output=True)
    print("  gh login:", (p.stdout or p.stderr).strip()[:160])

    st = subprocess.run([GH, "auth", "status"], capture_output=True, text=True)
    print("  ", [l.strip() for l in st.stderr.splitlines() if "Token scopes" in l])

    # --- push the workflow file -----------------------------------------
    print("  [..] pushing the workflow", flush=True)
    subprocess.run(["git", "add", "-f", ".github/workflows/ios-ipa.yml"], check=False)
    subprocess.run(["git", "-c", "user.email=dev@local", "-c", "user.name=htz",
                    "commit", "-m", "Add iOS IPA workflow"], capture_output=True, text=True)
    push = subprocess.run(["git", "push", "origin", "master"], capture_output=True, text=True)
    print("  push:", (push.stderr or push.stdout).strip().splitlines()[-1][:160] if (push.stderr or push.stdout).strip() else "ok")
    if push.returncode != 0:
        return 1

    # --- trigger the macOS build ----------------------------------------
    print("  [..] triggering the macOS build", flush=True)
    run = subprocess.run([GH, "workflow", "run", "ios-ipa.yml",
                          "--repo", REPO, "--ref", "master"],
                         capture_output=True, text=True)
    print("  trigger:", (run.stdout or run.stderr).strip()[:200])

    for _ in range(6):
        time.sleep(10)
        runs = subprocess.run([GH, "run", "list", "--repo", REPO, "--limit", "3",
                               "--json", "databaseId,status,conclusion,displayTitle,createdAt"],
                              capture_output=True, text=True)
        try:
            data = json.loads(runs.stdout or "[]")
        except Exception:
            data = []
        if data:
            r0 = data[0]
            print(f"  run {r0['databaseId']}: {r0['status']} {r0.get('conclusion') or ''}", flush=True)
            if r0["status"] in ("completed",):
                break
    print("  done — watch it with: gh run watch --repo " + REPO)
    return 0


if __name__ == "__main__":
    sys.exit(main())
