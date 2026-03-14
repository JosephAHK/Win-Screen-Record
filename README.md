# Win Screen Record

A lightweight Windows screen recorder that lives in the system tray. Press a global hotkey to draw a selection rectangle, record at high quality, and stop with one click.

![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![ffmpeg](https://img.shields.io/badge/ffmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

---

## Features

- **System tray app** — runs silently in the background, zero taskbar clutter
- **Global hotkey** (`Ctrl+Shift+R`) — start a recording from anywhere, no window switching
- **Region selection** — drag a rectangle over any part of your screen
- **Visual border** — animated red outline shows exactly what's being captured (outside the recorded area, never in the video)
- **High quality MP4** — H.264 at CRF 15, 60 fps via bundled ffmpeg
- **Launch at startup** — toggle from the tray menu
- **No system sounds** — Windows ding sounds are suppressed during recording

## Requirements

- Windows 10 or later
- [Node.js](https://nodejs.org/) (v18+)

## Setup

```bash
git clone https://github.com/JosephAHK/Win-Screen-Record.git
cd Win-Screen-Record
npm install
npm start
```

The app will appear as a red dot in your system tray.

## Usage

| Action | How |
|---|---|
| Start recording | `Ctrl+Shift+R` or left-click the tray icon |
| Stop recording | `Ctrl+Shift+R` again, or click **Stop** in the floating panel |
| Output location | `Desktop/recording-<timestamp>.mp4` |
| Quit | Right-click tray icon → Quit |

## Tech Stack

| Technology | Purpose |
|---|---|
| [Electron](https://www.electronjs.org/) | App shell, tray, global hotkey, transparent windows |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | Bundled ffmpeg binary for screen capture & encoding |
| `gdigrab` | Windows GDI screen capture (built into ffmpeg) |
| `libx264` | H.264 video encoding |

## Configuration

Recording quality can be adjusted in `main.js`:

```js
'-crf',    '15',   // 0 = lossless, 51 = worst quality. Default: 15
'-preset', 'fast', // ultrafast → fast → medium → slow (CPU vs compression tradeoff)
'-framerate', '60' // frames per second
```
