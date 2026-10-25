# SHERZ apps (Windows · macOS · Android · iOS)

One web app, four shells. `apps/www` is a copy of `../public` (made by `npm run sync`), so every screen, the language system,
streaming chat, voice and the Work Space thread are exactly what the website runs.

| Target | Shell | Output |
|---|---|---|
| Windows, macOS (Linux) | Electron (`desktop/`) | `.exe` installer, `.dmg` |
| Android, iOS | Capacitor (`mobile/`) | `.apk`, Xcode project → `.ipa` |

## Without installing anything — GitHub builds them
Push the project to GitHub → **Actions → Build apps → Run workflow**. Download `.exe`, `.dmg`, `.apk` from the run's *Artifacts*.
Set the backend with the repository variable `SHERZ_API_URL` (default `https://sherz-ai.onrender.com`).

## On your own computer
```
cd apps
npm run doctor            # what this computer can build
npm run setup             # installs desktop + mobile tools
npm run desktop:dev       # opens the desktop app (uses ../public)
npm run desktop:build     # → desktop/dist/*.exe (on Windows) / *.dmg (on a Mac)
npm run mobile:init       # once: creates android/ (and ios/ on a Mac), patches permissions, icons
npm run android:open      # Android Studio  →  Build ▸ Build APK
npm run android:apk       # command-line APK (needs JDK 17 + Android SDK)
npm run ios:open          # Xcode (Mac only)
```
Point at another backend: `SHERZ_API_URL=https://my-backend npm run sync` (or `node scripts/sync-web.mjs --api https://my-backend`).
Every web change needs a new `npm run sync` (the `*:build` / `*:open` scripts do it for you).

## Your own icon
Put your logo at `public/sherz-icon.svg` (or any `.png`), then:
```
cd apps
npm run icons                       # uses ../public/sherz-icon.svg
npm run icons -- C:\path\logo.png   # or any other picture
```
It writes `desktop/build/icon.png` (window, taskbar, installer), the tray icons and the Android/iOS icon + splash sources. The icon must be a **PNG, 256×256 or larger**
(an `.svg` or a file without an extension is not accepted by Electron — that is why `copy public\sherz-icon …` failed: the file there is `sherz-icon.svg`, and the target folder is `apps\desktop\build`, not `apps\build`).
`electron-builder.yml` already points at `build/icon.png`; nothing else to configure.

## If the window is black or something does not work
```
npm run desktop:debug          # opens the developer tools and prints every problem in the terminal
npm run desktop:local:debug    # same, but talks to a backend running on this computer (http://localhost:3000)
```
What the lines mean:
* `request failed: net::ERR_FAILED  https://…/api/…` — the **backend refused the app** (CORS). Deploy the new `server.js` line that trusts `app://sherz`
  (or add `app://sherz,https://localhost,capacitor://localhost` to `CORS_ORIGIN`), or use `desktop:local`.
* `missing file in the app bundle: /xyz` — the page asked for a file that is not in `public/`. Harmless unless it is a script or stylesheet.
* `page error: …` — a script of the page failed; send that line.
After changing anything in `public/`, `npm run desktop:dev` copies it again by itself.

## Server changes the apps need (already in this patch)
* CORS trusts the app origins `app://sherz`, `https://localhost`, `capacitor://localhost` (`lib/nativeAuth.js`, one line in `server.js`).
* Google refuses sign-in inside embedded webviews, so the apps open the system browser on `/api/auth/google?native=1`.
  The callback ends on a small page that opens `sherz://auth?token=…`; the app stores the token like the website does.
  Nothing to change in Google Cloud Console (the redirect URI stays the same).

## What the desktop app adds
Tray / menu-bar icon (close keeps SHERZ running), global hotkey **Ctrl/⌘ + Shift + Space** (show/hide + focus the chat box),
system notifications for proactive messages, downloads straight into the Downloads folder, one instance only, optional start with the computer,
auto-update once `publish:` is set in `desktop/electron-builder.yml`. Settings file: `settings.json` in the app's data folder (hotkey can be changed there).

## Not done yet (be aware)
* **Push notifications when the app is closed** (FCM for Android, APNs for iOS): the phone side is written and switched off (`SHERZ_PUSH=1`);
  it needs a Firebase project, an Apple key, and a server route `/api/push/register` + sender. Until then notifications work while the app is open or recently in the background.
* **Signing**: Windows/macOS installers are unsigned (Windows SmartScreen / macOS Gatekeeper will warn). A signed macOS build needs an Apple Developer account
  (99 USD/year) plus `CSC_LINK`/`CSC_KEY_PASSWORD`/notarization secrets; a signed Windows build needs a code-signing certificate.
* **iOS `.ipa`** needs an Apple Developer account and a Mac (or the GitHub macOS runner with your certificate). The workflow only proves it compiles for the simulator.
* **Play Store / App Store**: Apple rejects apps that are only a website in a frame. The native notifications, share sheet, offline handling and sign-in help, but expect to add more native value before submitting.
* The Android / iOS builds were generated and patched here, but not compiled (no Android SDK / Xcode in this environment). The desktop app was run and tested.
