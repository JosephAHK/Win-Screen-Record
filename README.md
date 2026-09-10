# Win Screen Record

**A tiny Windows screen recorder that stays out of the way — and out of your video.**

Draw a region, hit Record, get a crisp 60 fps MP4 on your Desktop. No editors, no accounts, no cloud. The app lives in the tray as a red dot until you need it.

[![Windows](https://img.shields.io/badge/Windows-10%2B-0078D6?logo=windows&logoColor=white)](https://github.com/JosephAHK/Win-Screen-Record)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-29-2B2E3A?logo=electron&logoColor=9FEAF9)](https://www.electronjs.org/)

---

## Why this instead of OBS or Game Bar?

| | Win Screen Record | Typical recorders |
|---|---|---|
| Always ready | Global hotkey from any app | Open a bulky studio first |
| Exact region | Drag to select, lock 16:9 / 9:16 / 1:1 and more | Full screen or a fiddly crop later |
| Clean footage | Capture border and control panel sit **outside** the region | Overlays and widgets baked into the file |
| Mic included | Live level meter + mute, muxed into the MP4 | Separate audio dance |
| Output | H.264 MP4 at CRF 15, 60 fps, on your Desktop | Export settings, containers, “where did it save?” |

Built for bug reports, product demos, tutorials, and “can you send a quick clip?” — not for streaming a 12-hour raid.

---

## Features

- **Tray-native** — no taskbar window. Left-click the red dot or press `Ctrl+Shift+R`.
- **Region selection** with aspect-ratio presets: free, 16:9, 9:16, 4:3, 1:1, 21:9.
- **Animated capture frame** drawn *outside* the pixels ffmpeg grabs, so it never appears in the video.
- **Floating meter panel** parked beside your selection so Record / Stop / mic levels stay off-camera.
- **Microphone** — auto-detected, live segmented meter, one-click mute.
- **High-quality MP4** — bundled ffmpeg, `gdigrab` + `libx264`, video and audio captured separately then muxed (less jitter).
- **Launch at Windows startup** — toggle from the tray menu.
- **Quiet UI** — Windows notification dings are silenced while the overlay is up.

Recordings land at:

`Desktop/recording-<timestamp>.mp4`

---

## Quick start

**Requirements:** Windows 10 or later, [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/JosephAHK/Win-Screen-Record.git
cd Win-Screen-Record
npm install
npm start
```

Look for the **red dot** in the system tray (click the `^` overflow if Windows hid it).

---

## How to record

1. Press **`Ctrl+Shift+R`** (or left-click the tray icon).
2. Optionally pick an aspect ratio on the overlay, then **drag** the region you want.
3. Check the mic meter. Mute if you do not want audio.
4. Click **Record**. Click **Stop** (or press `Ctrl+Shift+R` again) when you are done.

| Action | Shortcut / UI |
|---|---|
| Start selection | `Ctrl+Shift+R` or tray left-click |
| Cancel selection | `Esc` |
| Stop recording | `Ctrl+Shift+R` or **Stop** |
| Quit | Tray → **Quit** |

The control panel is movable. Drag it if you want it somewhere else — just keep it outside the red frame if you do not want it in the file.

---

## Privacy

Everything runs **locally**. Capture never leaves your PC. There is no account, analytics, or upload pipeline. Files are written to your Desktop and temp video/audio is cleaned up after muxing.

---

## Configuration

Quality knobs live in `main.js` (ffmpeg video process):

```js
'-framerate', '60',  // capture rate
'-crf', '15',        // 0 = lossless, 51 = smallest / worst. 15 is sharp.
'-preset', 'fast',   // ultrafast → slow  (CPU vs file size)
```

Hotkey: `Ctrl+Shift+R` (same combo starts and stops).

---

## Tech

| Piece | Role |
|---|---|
| [Electron](https://www.electronjs.org/) | Tray, global shortcut, transparent overlay + controls |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | Bundled ffmpeg — no system install |
| `gdigrab` | Region capture in physical pixels |
| `dshow` | Microphone |
| `libx264` + AAC | MP4 video and audio |

---

## Contributing

Issues and PRs are welcome — especially Windows-edge-case capture bugs, installer / packaged `.exe` builds, and UX polish.

```bash
npm start
```

Please do not commit `node_modules`, recordings (`.mp4`), or local shortcuts.

---

## License

[MIT](LICENSE) — use it, fork it, ship it with your team.
