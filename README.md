# Stalow Music — source

Private home for the source of Stalow Music.

| Folder | What it is |
|---|---|
| `android/` | The Android app (package `com.stalow.music`). Based on Zemer by ZemerTeam and Metrolist, GPL-3.0 (see `android/LICENSE`). `android/cipher/` is ZemerTeam's zemer-cipher library, which the app needs to build. |
| `windows/` | Stalow Music for Windows (Electron). |

The built apps and their update files are published from the website repository
(`Stalow-IT/stalow`, folder `downloads/`), which the apps check for updates.

## Android

Needs JDK 21 and the Android SDK (`ANDROID_HOME`).

- Tests: `./gradlew :app:testDebugUnitTest`
- Release + update files: put the signing key at `android/app/stalow-release.jks` and its passwords in
  `android/app/keystore.properties` (both are deliberately **not** in this repository), then run
  `scripts/publish-update.sh "what changed"`. It writes `release/stalow-music.apk` and `release/stalow-music.json`;
  upload both to `downloads/` on the website.
- Screenshots of the design: `./gradlew :app:testDebugUnitTest --tests '*StalowDesignScreenshotTest*' -PstalowScreenshots=/some/folder`

Every update must be signed with the same key, or phones will refuse to install it.

## Windows

Needs Node.js. `npm install`, then `npm test`; `npm run release -- "what changed"` builds the installer and
the update parts in `release/desktop/`, which go to `downloads/desktop/` on the website.
