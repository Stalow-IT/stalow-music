# Stalow Music

A kosher YouTube Music client for Android, with a built-in list of approved artists.

Stalow Music is a modified version of **Zemer** by ZemerTeam (https://github.com/ZemerTeam/zemer-app),
which is itself based on **Metrolist** (https://github.com/MetrolistGroup/Metrolist). All three are free
software under the GNU General Public License v3.0 (see `LICENSE`). The original authors keep their
copyright; the changes for Stalow Music are listed below.

## What is different from Zemer

- **Own app id** (`com.stalow.music`): installs next to Zemer and can never be updated by a Zemer release.
- **Built-in artist list** (`app/src/main/resources/stalow/artists.json`): the approved artists ship
  inside the app. Nothing is downloaded from Zemer's content server.
- **No Zemer servers at all**: search, artist pages, albums, playlists and radio come straight from
  YouTube Music and are filtered on the phone. Usage statistics, crash uploads, update checks, settings
  sync, content reports, donations, the relay stream, music statuses, the releases feed, Zemer lyrics
  and the shared "anonymous" login are removed or switched off. As a safety net, any request to a
  `zemer.io` address is blocked on the device (`net/ZemerHosts.kt`, `net/ZemerHeaders.kt`).
- **Sign-in** is with your own Google account only.
- Features that existed only on Zemer's servers (podcast catalog, genres, radio stations, curated
  playlists, the Videos/Podcasts home tabs) are hidden.

## Changing the artist list

1. Edit `app/src/main/resources/stalow/artists.json`. Each artist needs a YouTube Music channel id
   (`"id": "UC…"`) and a `"name"`. Optional: `"thumbnail"`, `"isFemale"`, `"isKidZone"`, `"isKids"`.
2. Raise `"version"` by 1, so phones that already have the app re-import the list.
3. Build and release a new version of the app.

## Publishing an update (no reinstalling)

The app checks `https://stalow.netlify.app/downloads/stalow-music.json` when it starts (and from
Settings > Updater). When that file names a higher version, the app offers the update and installs it with
one tap. The download is checked against the file's size and SHA-256, and Android only accepts an APK
signed with your release key.

1. In `app/build.gradle.kts`, raise `versionCode` by 1 and set the new `versionName`.
2. Run `scripts/publish-update.sh "What changed"` (needs `app/keystore.properties`).
3. Upload `release/stalow-music.apk` and `release/stalow-music.json` to the website's `downloads/` folder.

To use a different address, build with `-PupdateFeedUrl=https://.../stalow-music.json`.

## Building

- JDK 21 and the Android SDK (platform 36). Put `sdk.dir=/path/to/android-sdk` in `local.properties`.
- The `cipher/` folder must contain https://github.com/ZemerTeam/zemer-cipher (GPL-3.0).
- Debug: `./gradlew :app:assembleDebug`
- Release: create `app/keystore.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`
  (never commit it or the key file), then `./gradlew :app:assembleRelease`.

## Licence

GNU General Public License v3.0. If you give the app to other people, you must also make this source code
available to them under the same licence.
