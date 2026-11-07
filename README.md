# Htz Phone — Android + iOS

One Expo / React Native codebase that produces both apps. Sets and verifies the
phone number on an Htzone account.

```
Set phone   → login (app API) → editUserInformation { phone } → re-read + diff
Verify      → two independent app-API sessions + web profile + stale-number hunt
```

## Screens

| tab | what it does |
|---|---|
| **Set phone** | email / password / new phone → writes the phone, then re-logs in and shows a before/after table with a field diff |
| **Verify** | read-only sweep; prints PASS / FAIL / INFO per surface |

## How it talks to the service

**App API** — `https://cms.htzone.co.il/api/android/1.6/`

```
loginUser            POST { email, password }   ← both SecureEncryption-encrypted
editUserInformation  POST { phone }             ← merges; only the phone moves
```

The credentials must be encrypted exactly like the native client does, or the
server answers `מייל לא תקין`. `src/core/crypto.ts` is a faithful port of
`il.co.inmanage.base.data.SecureEncryption`:

```
key    = PBKDF2WithHmacSHA256("1inmahtzonenage2", salt, 32767) -> 128 bit
enc    = 12-byte nonce || AES/GCM/NoPadding(plaintext)   (tag appended)
output = base64( 16-byte salt || nonce || ciphertext || tag )
```

Pure JS (`@noble/ciphers`, `@noble/hashes`) so Android, iOS and Node produce
identical bytes — no native module, works in Expo Go.

**Web** — `https://www.htzone.co.il` (used by Verify for a second opinion)

```
GET  /login                 → inline `var secure_login = "…"` (per page load)
POST /_ajax/ajax.index.php   file=user_service&action=login  (+ secure_login, remember=on)
GET  /support_page          → `telephone` = account phone, `phone` = contact phone
```

## Run it

```bash
npm install
npx expo start              # QR → Expo Go on the phone (fastest, both platforms)
```

Native builds:

```bash
npx expo run:android        # needs Android SDK + JDK
npx expo run:ios            # needs macOS + Xcode
```

Release builds with EAS:

```bash
npm i -g eas-cli && eas login
eas build -p android --profile preview      # .apk
eas build -p ios --profile preview          # .ipa (needs an Apple account)
```

## Headless check (no device)

The exact code the app runs, executed in Node — this is what was used to verify
the implementation:

```bash
npm run check -- --email you@example.com --password 'secret'
```

```
— crypto —
  [ok] len=    5  LJ6D9rhYK7fVJCwsonz8HNzS6CqQdXEgIsZsPc/EV3A9…
  [ok] len= 4096  PvCPvjZqwocu29FYB/lQCLBTt0VM1cEKEY1gWBTcpieq…

— app API —
  logged in: id=287282 "אלמו סולומון" phone=0555071161
  editUserInformation { phone: 0555071161 } -> status 1

  PASS app API · loginUser (session 1) · phone              0555071161
  PASS app API · user object contains 0544464632            false
  PASS app API · loginUser (session 2) · phone              0555071161
  PASS web · /support_page telephone                        0555071161
  PASS web · /support_page phone                            0555071161
  verdict: PHONE CONSISTENT
```

Cross-implementation check (the JS cipher against the Python port used during
the assessment):

```bash
npx tsx scripts/check.ts --emit "ts-side"      # → blob
python ../exploit/htz_crypto.py dec "<blob>"   # → ts-side
python ../exploit/htz_crypto.py enc "py-side"  # → blob
npx tsx scripts/check.ts --blob "<blob>"       # → py-side
```

## Project layout

```
phone-app/
├─ App.tsx                     tab shell
├─ src/core/crypto.ts          SecureEncryption port (PBKDF2 + AES-GCM)
├─ src/core/base64.ts          dependency-free base64 / utf8
├─ src/core/api.ts             app-API + web client, cookie handling, verify sweep
├─ src/screens/SetPhoneScreen.tsx
├─ src/screens/VerifyScreen.tsx
├─ src/ui/theme.ts
└─ scripts/check.ts            headless harness (same code paths)
```

## Getting an .ipa (iOS)

**An .ipa cannot be compiled on Windows** — it needs the iOS SDK and Xcode, both
macOS-only. `npx expo prebuild -p ios` refuses to even scaffold the project off
macOS. There is no cross-compiler; that is a platform fact, not a config issue.

Three working routes, in order of least effort:

### 1 · EAS Build (signed .ipa, no Mac, no local Xcode)

```bash
export EXPO_TOKEN=...                 # or: npx eas login
npm i -g eas-cli
eas init            # links the project to your Expo account (once)
eas build -p ios --profile preview    # builds on Apple hardware, returns a .ipa
```

`eas.json` is already configured (`preview`, `production`, `simulator` profiles).
A signed build for real devices needs an Apple ID / team in the EAS prompt; a
`simulator` build needs neither.

### 2 · GitHub Actions (unsigned .ipa, included)

`.github/workflows/ios-ipa.yml` archives and packages a real `.ipa` on a
`macos-14` runner with `CODE_SIGNING_ALLOWED=NO`:

```
Actions → iOS IPA (unsigned) → Run workflow → artifact htz-phone-unsigned-ipa
```

Unsigned — install via a signing service (Sideloadly, AltStore, Signulous) or
re-sign with your own certificate.

### 3 · A Mac with Xcode

```bash
npx expo prebuild -p ios
npx expo run:ios                      # debug on a simulator/device
npx expo build:ios                    # or Product → Archive in Xcode
```

**What is already proven here:** the iOS JS bundle compiles —
`npx expo export --platform ios` produced
`_expo/static/js/ios/index-*.hbc` (1.59 MB, 560 modules), the same Hermes output
the archive step consumes. Everything iOS-specific left is native packaging.

## Notes

- **Cookies:** RN handles them natively (OkHttp / NSURLSession). `HtzClient`
  also mirrors `Set-Cookie` manually, which is what makes the Node harness work
  and is harmless on device.
- **Nothing is persisted.** Email/password live in component state only; no
  AsyncStorage, no Keychain write. Close the app and they're gone.
- **Partial update, verified.** `editUserInformation` merges, so sending only
  `{ phone }` cannot blank other fields — the Set screen diffs every field and
  fails loudly if anything else moved.
- **iOS build requires macOS.** The JS is identical; only the toolchain differs.
- `tsconfig.core.json` exists because the core and harness are checked without
  pulling in React Native's type graph.
