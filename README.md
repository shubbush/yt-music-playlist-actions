# YT Music Bulk Like/Unlike (Firefox Extension)

This extension automates **liking or removing likes for every song** in the currently opened YouTube Music playlist or album.

It is designed to handle very large lists (5000+ songs) by automatically scrolling the page to force YouTube Music to load all tracks before processing.

## Features

- Like all songs in current playlist/album (processed bottom-to-top to preserve liked-song order)
- Remove likes from all songs in current playlist/album (does **not** click dislike)
- Stop button to cancel a running job
- Progress updates in the popup
- Shows expected track count from playlist header before auto-scrolling starts
- Auto-scroll loading for huge lazy-loaded playlists using playlist header track count as a target
- Processes only the main playlist/album track list (ignores recommended side sections)
- Uses adaptive pacing/backoff between actions to reduce rapid request bursts

## Install in Firefox (temporary/developer install)

1. Open Firefox.
2. Go to `about:debugging`.
3. Click **This Firefox**.
4. Click **Load Temporary Add-on...**.
5. Select the `manifest.json` file from this folder.
6. Open `https://music.youtube.com/` and navigate to a playlist or album.
7. Click the extension icon and choose:
   - **Like all songs**, or
   - **Remove likes**.

> Note: Temporary add-ons are removed when Firefox closes. Reload it from `about:debugging` when needed.

## Usage tips

- Keep the YouTube Music tab open while the run is active.
- For huge playlists, initial loading can take several minutes.
- If you need to stop, click **Stop current run**.

## Project files

- `manifest.json` – Firefox extension manifest
- `popup.html` – extension popup UI
- `popup.js` – popup logic and messaging
- `content.js` – automation logic injected into YouTube Music pages
- `logo.svg` – extension logo (YT Music-inspired badge with a thumbs-up center)

## Limitations

- YouTube Music DOM can change over time, which may require selector updates.
- Some non-track rows inside the list can still be skipped automatically.
