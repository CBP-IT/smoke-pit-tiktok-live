# Crayon Eater Media LIVE

A small Mac and Windows app that gets a **TikTok LIVE stream key for OBS**, using
Streamlabs' TikTok access, the same way the Streamlabs Desktop app does.

It's a Crayon Eater Media-branded rewrite of
[Loukious/StreamLabsTikTokStreamKeyGenerator](https://github.com/Loukious/StreamLabsTikTokStreamKeyGenerator),
and like the original it is licensed under the **GNU GPL v3** (see `LICENSE`).

> **Unofficial.** The app calls undocumented Streamlabs endpoints while identifying as
> Streamlabs Desktop. Neither TikTok nor Streamlabs supports this. It can stop
> working without notice, and TikTok or Streamlabs could restrict an account that uses
> it. The app makes everyone acknowledge this on first launch.

## Using it

You need a TikTok account with **LIVE access approved for Streamlabs**
([apply here](https://tiktok.com/falcon/live_g/live_access_pc_apply/result/index.html?id=GL6399433079641606942&lang=en-US)).

1. Install it from the [latest release](../../releases/latest):
   - **Mac:** download the `-mac.dmg`, open it, and drag the app to Applications.
   - **Windows:** download the `-win.exe` and run it. The installer isn't signed yet, so
     Windows may show **"Windows protected your PC"**: click **More info → Run anyway**.
     It installs for your user only (no admin needed) and adds a Start menu shortcut.
2. Open the app and read and accept the notice.
3. Click **Sign in with TikTok**. Streamlabs' login page opens in your browser. Sign in
   with TikTok, then come back to the app. If you already use Streamlabs Desktop and
   are signed in there with TikTok, **Use my Streamlabs Desktop sign-in** skips the browser.
4. Check the title and pick a category, then click **Go LIVE**. When a Smoke Pit show is
   on now or within the next 24 hours, the title fills in from the Smoke Pit panelist
   portal; otherwise it's your last title. You can edit it, and **Use this title** puts
   the portal's title back.
5. In OBS: **Settings → Stream → Service: Custom…**. Paste the **Server** and
   **Stream key** from the app, then click **Start Streaming**.
6. When the show is over, stop streaming in OBS, then click **End LIVE** in the app.

Quitting the app doesn't end the TikTok stream. If you quit while live, reopen the app
and click End LIVE. If you already ended it from TikTok and End LIVE keeps failing, click
**Clear it here**.

## How it works

| Step | Request |
| --- | --- |
| Sign in | Opens `streamlabs.com/slobs/login` with a PKCE challenge. Streamlabs redirects to a one-shot server on `127.0.0.1`, and the code is exchanged at `/api/v5/slobs/auth/data` for a token. |
| Desktop sign-in | Reads the `apiToken` Streamlabs Desktop stored in its `slobs-client/Local Storage/leveldb/*.log` (under `~/Library/Application Support` on Mac, `%APPDATA%` on Windows). |
| Show title | `GET https://thesmokepit.crayoneatermedia.com/api/live-title` (the Smoke Pit portal; public, no sign-in) |
| Account | `GET /api/v5/slobs/tiktok/info` |
| Category search | `GET /api/v5/slobs/tiktok/info?category=…` (max 25 characters) |
| Go LIVE | `POST /api/v5/slobs/tiktok/stream/start` returns the RTMP server and key |
| End LIVE | `POST /api/v5/slobs/tiktok/stream/{id}/end` |

The Streamlabs token and the current stream key are stored encrypted (Electron
`safeStorage`: the macOS Keychain, or Windows DPAPI) in the app's data folder, in
`settings.json`. Nothing is sent anywhere except Streamlabs. The portal is only asked
for the show title, and the request carries nothing about the user.

Code layout:

- `src/main/streamlabs.ts`: the Streamlabs API client
- `src/main/auth.ts`: browser sign-in (PKCE + local callback) and Streamlabs Desktop token lookup
- `src/main/store.ts`: settings and encrypted secrets
- `src/main/portal.ts`: the show title from the Smoke Pit portal
- `src/main/controller.ts`: what each button does, independent of Electron
- `src/main/main.ts`: Electron window, IPC, quit-while-live warning
- `src/renderer/`: the window (HTML/CSS/TS in the crayoneatermedia.com palette; Oswald
  is bundled under the SIL Open Font License, see `src/renderer/fonts/OFL.txt`)

## Development

```sh
npm install
npm start          # build and run
npm test           # unit tests (Streamlabs client, sign-in flow, storage, go-live logic)
npm run typecheck
npm run dist:unsigned   # on a Mac: unsigned DMG in release/
npm run dist:win        # on Windows: installer in release/
```

## Releasing

Releases build on GitHub Actions (`.github/workflows/release.yml`): a signed and
notarized universal (Apple Silicon + Intel) DMG on a macOS runner, and an unsigned
Windows installer on a Windows runner, both attached to one GitHub release.

Bump `version` in `package.json`, merge to `main`, then open **Actions → Release →
Run workflow** on `main`. That creates the `v<version>` tag and release itself. Pushing
a matching tag (`git tag v0.2.0 && git push origin v0.2.0`) works too.

### Mac signing secrets

Add these once under **Settings → Secrets and variables → Actions**:

| Secret | Where it comes from |
| --- | --- |
| `MAC_CERT_P12_BASE64` | A **Developer ID Application** certificate made at developer.apple.com → Certificates from a request file (Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority → Saved to disk). Export it from Keychain Access → My Certificates as a `.p12` with a password, then `base64 -i cert.p12 \| pbcopy`. Don't use one Xcode creates: its private key stays with Apple and can't be exported. |
| `MAC_CERT_PASSWORD` | The password you set when exporting the `.p12`. |
| `APPLE_ID` | The Apple ID email on the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com → Sign-In and Security → App-Specific Passwords. |
| `APPLE_TEAM_ID` | developer.apple.com → Account → Membership details. |

The current certificate expires **February 1, 2027**. Before then, make a new one the
same way (choose **G2 Sub-CA**) and replace the two `MAC_CERT_*` secrets.

### Windows signing

Not set up yet, which is why Windows shows the SmartScreen warning. Signing needs a
code-signing certificate (for example Azure Trusted Signing, or an OV certificate from a
certificate authority); the Windows job in `release.yml` is where it would plug in.

## License

GPL-3.0. If you give the app to anyone, you must also offer them its source code. The
simplest way is to link this repository.
