const { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');

const ffmpegPath = require('ffmpeg-static');

let overlayWindow = null;
let controlsWindow = null;
let borderWindow  = null;
let tray          = null;
let ffmpegProcess = null;
let isRecording   = false;
let isPendingRecord = false;  // true after region selected, before record pressed
let pendingRegion = null;     // stored region awaiting record button
let isMicMuted    = false;
let micDeviceName = null;

// Hotkey to start a new selection (Ctrl+Shift+R)
const HOTKEY = 'Ctrl+Shift+R';

// ---------------------------------------------------------------------------
// Windows sound scheme — temporarily silence dings while windows open/close
// ---------------------------------------------------------------------------
let originalSoundScheme = null;

function disableWindowsSounds() {
  try {
    originalSoundScheme = execFileSync('reg', [
      'query', 'HKCU\\AppEvents\\Schemes', '/ve'
    ], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
      .toString().match(/REG_SZ\s+(.+)/)?.[1]?.trim() ?? '.Default';

    execFileSync('reg', [
      'add', 'HKCU\\AppEvents\\Schemes', '/ve', '/t', 'REG_SZ', '/d', '', '/f'
    ], { stdio: 'ignore', timeout: 2000 });
  } catch (_) {}
}

function restoreWindowsSounds() {
  if (originalSoundScheme === null) return;
  try {
    execFileSync('reg', [
      'add', 'HKCU\\AppEvents\\Schemes', '/ve', '/t', 'REG_SZ',
      '/d', originalSoundScheme, '/f'
    ], { stdio: 'ignore', timeout: 2000 });
    originalSoundScheme = null;
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Microphone device discovery — find the first available mic via ffmpeg/dshow
// ---------------------------------------------------------------------------
function findMicDevice() {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.stdout.on('data', (d) => { output += d.toString(); });

    proc.on('close', () => {
      // Match lines like: "Microphone (Device Name)" (audio)
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('(audio)')) {
          const match = line.match(/"([^"]+)"/);
          if (match) { resolve(match[1]); return; }
        }
      }
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
// Tray icon — generated at runtime as a 16x16 red circle (no asset file)
// ---------------------------------------------------------------------------
function makeTrayIcon() {
  // Draw a 16x16 RGBA image: red filled circle on transparent background
  const size = 16;
  const data = Buffer.alloc(size * size * 4, 0); // all transparent
  const cx = 7.5, cy = 7.5, r = 6.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * size + x) * 4;
        data[i]     = 229; // R
        data[i + 1] = 57;  // G
        data[i + 2] = 53;  // B
        data[i + 3] = 255; // A
      }
    }
  }

  return nativeImage.createFromBuffer(data, { width: size, height: size });
}

// ---------------------------------------------------------------------------
// Tray setup
// ---------------------------------------------------------------------------
function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip(`Screen Recorder  (${HOTKEY} to record)`);

  const launchAtStartup = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: `Start Recording  (${HOTKEY})`, click: startSelection },
    { type: 'separator' },
    {
      label: 'Launch at Windows startup',
      type: 'checkbox',
      checked: launchAtStartup,
      click: (item) => {
        const electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
        app.setLoginItemSettings({ openAtLogin: item.checked, path: electronExe, args: [__dirname] });
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { cleanup(); app.quit(); } },
  ]);

  tray.setContextMenu(menu);

  // Left-click also triggers selection when not recording
  tray.on('click', () => { if (!isRecording) startSelection(); });
}

// ---------------------------------------------------------------------------
// Overlay window — fullscreen transparent selection UI
// ---------------------------------------------------------------------------
function startSelection() {
  if (isRecording || isPendingRecord || overlayWindow) return;

  disableWindowsSounds();

  const { width, height } = screen.getPrimaryDisplay().bounds;

  overlayWindow = new BrowserWindow({
    x: 0, y: 0, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.focus();
}

// ---------------------------------------------------------------------------
// Border window — click-through animated red frame OUTSIDE the recording region
// The window is offset outward by borderSize so the border pixels are never
// inside the captured area and won't appear in the recording.
// ---------------------------------------------------------------------------
function createBorderWindow(region) {
  const borderSize = 3; // px — drawn as an inset border inside this window
  const offset = borderSize; // expand window outward by exactly the border thickness

  borderWindow = new BrowserWindow({
    x: region.x - offset,
    y: region.y - offset,
    width:  region.width  + offset * 2,
    height: region.height + offset * 2,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    webPreferences: { contextIsolation: true },
  });

  borderWindow.setIgnoreMouseEvents(true);

  // The border is drawn as an inset on the expanded window, so it sits
  // exactly at the edge of the recorded region without overlapping it.
  const html = `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;background:transparent;overflow:hidden}
    .border{position:absolute;inset:0;border:${borderSize}px solid #e53935;border-radius:2px;animation:blink 1.8s ease-in-out infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.45}}
  </style></head><body><div class="border"></div></body></html>`;

  borderWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ---------------------------------------------------------------------------
// Controls window — floating stop panel
// ---------------------------------------------------------------------------
function createControls() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const panelWidth = 140, panelHeight = 190;

  controlsWindow = new BrowserWindow({
    x: width - panelWidth - 8,
    y: Math.floor(height / 2) - Math.floor(panelHeight / 2),
    width: panelWidth, height: panelHeight,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlsWindow.loadFile('controls.html');
}

// ---------------------------------------------------------------------------
// ffmpeg recording
// ---------------------------------------------------------------------------
function startRecording(region) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = path.join(os.homedir(), 'Desktop', `recording-${timestamp}.mp4`);

  // libx264 requires even dimensions
  const w = region.width  % 2 === 0 ? region.width  : region.width  - 1;
  const h = region.height % 2 === 0 ? region.height : region.height - 1;

  const args = [
    '-f', 'gdigrab',
    '-framerate', '60',
    '-offset_x', String(region.x),
    '-offset_y', String(region.y),
    '-video_size', `${w}x${h}`,
    '-i', 'desktop',
  ];

  // Add mic audio input if available and not muted
  if (micDeviceName && !isMicMuted) {
    args.push('-f', 'dshow', '-i', `audio=${micDeviceName}`);
  }

  args.push(
    '-vcodec', 'libx264',
    '-crf', '15',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
  );

  if (micDeviceName && !isMicMuted) {
    args.push('-acodec', 'aac', '-b:a', '192k');
  }

  args.push('-movflags', '+faststart', outputFile);

  ffmpegProcess = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'ignore'] });
  ffmpegProcess.on('close', () => { ffmpegProcess = null; });
  isRecording = true;
}

function stopRecording() {
  if (ffmpegProcess) {
    try {
      ffmpegProcess.stdin.write('q');
      ffmpegProcess.stdin.end();
    } catch (_) {
      ffmpegProcess.kill('SIGTERM');
    }
    ffmpegProcess = null;
  }
  isRecording = false;
  isPendingRecord = false;
  pendingRegion = null;
  isMicMuted = false;
}

// ---------------------------------------------------------------------------
// Cleanup recording UI (called after stop — app stays alive in tray)
// ---------------------------------------------------------------------------
function cleanupRecordingUI() {
  if (borderWindow)   { borderWindow.close();   borderWindow   = null; }
  if (controlsWindow) { controlsWindow.close(); controlsWindow = null; }
  restoreWindowsSounds();
}

// Full cleanup on app quit
function cleanup() {
  stopRecording();
  cleanupRecordingUI();
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null; }
  globalShortcut.unregisterAll();
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

// User finished drawing the selection rectangle — enter pre-record state
ipcMain.on('region-selected', async (event, region) => {
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null; }

  // Discover mic before showing controls so the meter can start immediately
  if (micDeviceName === null) {
    micDeviceName = await findMicDevice() || false;
  }

  pendingRegion = region;
  isPendingRecord = true;

  createBorderWindow(region);
  createControls();
});

// User clicked Record in the controls panel
ipcMain.on('start-recording', async () => {
  if (!pendingRegion || isRecording) return;
  const region = pendingRegion;
  pendingRegion = null;
  isPendingRecord = false;

  await startRecording(region);

  // Notify controls to switch to recording UI
  if (controlsWindow) {
    controlsWindow.webContents.send('recording-started');
  }
});

// User pressed Escape on the overlay
ipcMain.on('selection-cancelled', () => {
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null; }
  restoreWindowsSounds();
});

// Cancel button clicked in pre-record state
ipcMain.on('cancel-prerecord', () => {
  isPendingRecord = false;
  pendingRegion = null;
  isMicMuted = false;
  cleanupRecordingUI();
});

// Stop button clicked in controls panel
ipcMain.on('stop-recording', () => {
  stopRecording();
  cleanupRecordingUI();
  // App stays running — ready for next recording via hotkey or tray
});

// Mic mute/unmute toggle from controls panel
ipcMain.on('toggle-mic', () => {
  isMicMuted = !isMicMuted;
  if (controlsWindow) {
    controlsWindow.webContents.send('mic-muted', isMicMuted);
  }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Hide from taskbar/dock — lives only in the tray
  app.setAppUserModelId('WinScreenRecord');

  // Register to launch automatically with Windows (writes to HKCU Run key)
  // Use the bundled electron.exe directly so it works without a terminal
  const electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
  app.setLoginItemSettings({
    openAtLogin: true,
    path: electronExe,
    args: [__dirname],
  });

  createTray();

  // Register global hotkey
  globalShortcut.register(HOTKEY, () => {
    if (isRecording || isPendingRecord) {
      stopRecording();
      cleanupRecordingUI();
    } else {
      startSelection();
    }
  });
});

// Keep app alive when all windows are closed (tray app behaviour)
app.on('window-all-closed', () => { /* do nothing — stay in tray */ });

app.on('before-quit', () => {
  cleanup();
});
