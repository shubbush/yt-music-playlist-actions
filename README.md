# YT Music Bulk Like/Dislike (Firefox Extension)

This extension automates **liking or disliking every song** in the currently opened YouTube Music playlist or album.

It is designed to handle very large lists (5000+ songs) by automatically scrolling the page to force YouTube Music to load all tracks before processing.

## Features

- Like all songs in current playlist/album
- Dislike all songs in current playlist/album
- Stop button to cancel a running job
- Progress updates in the popup
- Auto-scroll loading for huge lazy-loaded playlists

## Install in Firefox (temporary/developer install)

1. Open Firefox.
2. Go to `about:debugging`.
3. Click **This Firefox**.
4. Click **Load Temporary Add-on...**.
5. Select the `manifest.json` file from this folder.
6. Open `https://music.youtube.com/` and navigate to a playlist or album.
7. Click the extension icon and choose:
   - **Like all songs**, or
   - **Dislike all songs**.

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

## Limitations

- YouTube Music DOM can change over time, which may require selector updates.
- Some rows that are not playable songs may be skipped.
