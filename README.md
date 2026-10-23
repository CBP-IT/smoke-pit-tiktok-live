# Smoke Pit TikTok LIVE

A small Mac app that gets a panelist a **TikTok LIVE stream key for OBS**, using
Streamlabs' TikTok access, the same way the Streamlabs Desktop app does.

It's a Smoke Pit-branded rewrite of
[Loukious/StreamLabsTikTokStreamKeyGenerator](https://github.com/Loukious/StreamLabsTikTokStreamKeyGenerator),
and like the original it is licensed under the **GNU GPL v3** (see `LICENSE`).

> **Unofficial.** The app calls undocumented Streamlabs endpoints while identifying as
> Streamlabs Desktop. Neither TikTok nor Streamlabs supports this. It can stop
> working without notice, and TikTok or Streamlabs could restrict an account that uses
> it. The app makes every panelist acknowledge this on first launch.

## For panelists

You need a TikTok account with **LIVE access approved for Streamlabs**
([apply here](https://tiktok.com/falcon/live_g/live_access_pc_apply/result/index.html?id=GL6399433079641606942&lang=en-US)).

1. Download the `.dmg` from the latest release, open it, and drag the app to Applications.
2. Open the app and read and accept the notice.
3. Click **Sign in with TikTok**. Streamlabs' login page opens in your browser. Sign in
   with TikTok, then come back to the app. If you already use Streamlabs Desktop and
   are signed in there with TikTok, **Use my Streamlabs Desktop sign-in** skips the browser.
4. Check the title and pick a category, then click **Go LIVE**. The title fills in
   from the panelist portal with the show that's on now or next (within 24 hours).
   You can edit it, and **Use this title** puts the portal's title back.
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
| Desktop sign-in | Reads the `apiToken` Streamlabs Desktop stored in `~/Library/Application Support/slobs-client/Local Storage/leveldb/*.log`. |
| Show title | `GET https://thesmokepit.crayoneatermedia.com/api/live-title` (the portal; public, no sign-in) |
| Account | `GET /api/v5/slobs/tiktok/info` |
| Category search | `GET /api/v5/slobs/tiktok/info?category=…` (max 25 characters) |
| Go LIVE | `POST /api/v5/slobs/tiktok/stream/start` returns the RTMP server and key |
| End LIVE | `POST /api/v5/slobs/tiktok/stream/{id}/end` |

The Streamlabs token and the current stream key are stored encrypted with the macOS
Keychain (Electron `safeStorage`) in `~/Library/Application Support/Smoke Pit TikTok LIVE/settings.json`.
Nothing is sent anywhere except Streamlabs. The portal is only asked for the show
title, and the request carries nothing about the panelist.

Code layout:

- `src/main/streamlabs.ts`: the Streamlabs API client
- `src/main/auth.ts`: browser sign-in (PKCE + local callback) and Streamlabs Desktop token lookup
- `src/main/store.ts`: settings and encrypted secrets
- `src/main/portal.ts`: the show title from the panelist portal
- `src/main/controller.ts`: what each button does, independent of Electron
- `src/main/main.ts`: Electron window, IPC, quit-while-live warning
- `src/renderer/`: the window (HTML/CSS/TS, Smoke Pit portal colors)

## Development

```sh
npm install
npm start          # build and run
npm test           # unit tests (Streamlabs client, sign-in flow, storage, go-live logic)
npm run typecheck
npm run dist:unsigned   # on a Mac: unsigned DMG in release/
```

## Releasing a signed, notarized build

Releases build on GitHub Actions (`.github/workflows/release.yml`) on a macOS runner.
Add these repository secrets once (**Settings → Secrets and variables → Actions**):

| Secret | Where it comes from |
| --- | --- |
| `MAC_CERT_P12_BASE64` | A **Developer ID Application** certificate. Create it at developer.apple.com → Certificates (or Xcode → Settings → Accounts → Manage Certificates), export it from Keychain Access as a `.p12` with a password, then `base64 -i cert.p12 \| pbcopy`. |
| `MAC_CERT_PASSWORD` | The password you set when exporting the `.p12`. |
| `APPLE_ID` | The Apple ID email on the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com → Sign-In and Security → App-Specific Passwords. |
| `APPLE_TEAM_ID` | developer.apple.com → Account → Membership details. |

Then bump `version` in `package.json`, commit, and either push a matching tag
(`git tag v0.1.1 && git push origin v0.1.1`) or open **Actions → Release (macOS) →
Run workflow** on `main`, which creates the `v<version>` tag and release itself.

The workflow tests, builds a universal (Apple Silicon + Intel) DMG and zip, signs and
notarizes them, and attaches them to the GitHub release for that tag.

## License

GPL-3.0. If you give the app to anyone, you must also offer them its source code. The
simplest way is to link this repository.
