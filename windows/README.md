# Stalow Music for Windows

The Windows version of Stalow Music. It uses the **same approved-artist list** (`data/artists.json`, identical
to the Android app's `app/src/main/resources/stalow/artists.json`) and the **same rules**: only songs, albums
and artists by approved artists are shown or played; other people's playlists show only approved songs.

- Search, artist pages, albums and radio come straight from YouTube Music (`src/ytm.js`), filtered by
  `src/catalog.js`.
- Playback uses YouTube Music's own web player in a hidden window (`src/player.js`). Adverts are blocked, and
  any that slip through are muted and skipped. YouTube's own "up next" is stopped, so the app decides what
  plays next. Signing in to your own Google account (Settings) is optional.
- Updates install automatically from `https://stalow.netlify.app/downloads/desktop/` (see `src/updater.js`).

## Building the installer

Needs Node.js 22 (and Wine when building on Linux):

    npm install
    npm test
    npm run dist:win        # makes dist/Stalow-Music-Setup-<version>.exe and dist/latest.yml

## Publishing an update

1. Raise `"version"` in `package.json` (for example 1.0.5 -> 1.0.6).
2. `npm run release -- "What changed"` (builds the installer, then makes `release/desktop/`).
3. Upload everything in `release/desktop/` (the `StalowMusic-<version>.partN` files and
   `stalow-music-desktop.json`) to the website's `downloads/desktop/` folder.
   Installed copies download the parts in the background, check them, and offer "Restart to update".
   (The installer is split because the website cannot hold one file over 100 MB.)

## Changing the artist list

Edit the list in the Android project, raise its `"version"`, then copy the same file to `data/artists.json`.
Both apps then use exactly the same list.

GPL-3.0 (see LICENSE). Based on Zemer by ZemerTeam and Metrolist.
