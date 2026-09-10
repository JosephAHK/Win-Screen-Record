const { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const ffmpegPath = require('ffmpeg-static');

let overlayWindow = null;
let controlsWindow = null;
let borderWindow  = null;
let tray          = null;
let ffmpegVideo   = null;  // video-only ffmpeg process
let ffmpegAudio   = null;  // audio-only ffmpeg process (separate to avoid jitter)
let videoTmpFile  = null;
let audioTmpFile  = null;
let finalOutFile  = null;
let isRecording   = false;
let isPendingRecord = false;  // true after region selected, before record pressed
let pendingRegion = null;     // stored region awaiting record button (DIP coords)
let isMicMuted    = false;
let micDeviceName = null;
let useDshowAudio = false;
let rendererAudioFile = null;

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
// Convert overlay DIP region → physical pixels for ffmpeg gdigrab
// ---------------------------------------------------------------------------
function regionToPhysical(region) {
  const display = screen.getPrimaryDisplay();
  const physical = screen.dipToScreenRect(null, {
    x: display.bounds.x + region.x,
    y: display.bounds.y + region.y,
    width: region.width,
    height: region.height,
  });

  // libx264 / yuv420p require even dimensions
  const width  = physical.width  % 2 === 0 ? physical.width  : physical.width  - 1;
  const height = physical.height % 2 === 0 ? physical.height : physical.height - 1;

  return { x: physical.x, y: physical.y, width, height };
}

// ---------------------------------------------------------------------------
// Microphone device discovery — list DirectShow audio devices and pick the
// one that matches the Chromium/default mic (not just the first listed).
// ---------------------------------------------------------------------------
const VIRTUAL_MIC_RE = /stereo mix|what u hear|wave link|cable output|voicemeeter|vb-audio/i;

function listDshowAudioDevices() {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.stdout.on('data', (d) => { output += d.toString(); });

    proc.on('close', () => {
      const devices = [];
      for (const line of output.split('\n')) {
        if (!line.includes('(audio)')) continue;
        const match = line.match(/"([^"]+)"/);
        if (match) devices.push(match[1]);
      }
      resolve(devices);
    });
  });
}

function normalizeDeviceName(name) {
  return String(name || '').toLowerCase().replace(/[^\w]+/g, ' ').trim();
}

function pickMicDevice(devices, preferredLabel) {
  if (!devices.length) return null;

  const preferred = normalizeDeviceName(preferredLabel);
  if (preferred) {
    const exact = devices.find((name) => normalizeDeviceName(name) === preferred);
    if (exact) return exact;

    const overlapping = devices.find((name) => {
      const current = normalizeDeviceName(name);
      return current.includes(preferred) || preferred.includes(current);
    });
    if (overlapping) return overlapping;
  }

  return devices.find((name) => !VIRTUAL_MIC_RE.test(name)) || devices[0];
}

function findMicDevice(preferredLabel) {
  return listDshowAudioDevices().then((devices) => pickMicDevice(devices, preferredLabel));
}

function callControls(script) {
  if (!controlsWindow || controlsWindow.isDestroyed()) return Promise.resolve(null);
  return controlsWindow.webContents.executeJavaScript(script, true).catch(() => null);
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

  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

  overlayWindow = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.focus();
}

// ---------------------------------------------------------------------------
// Border window — click-through animated red frame OUTSIDE the recording region
// The window is offset outward by borderSize so the border pixels are never
// inside the captured area and won't appear in the recording.
// ---------------------------------------------------------------------------
function createBorderWindow(region) {
  if (borderWindow) {
    borderWindow.close();
    borderWindow = null;
  }

  const borderSize = 3; // px — solid strips outside the recorded region
  const offset = borderSize;
  const display = screen.getPrimaryDisplay();

  // Region is relative to the primary display overlay (DIP)
  const winX = Math.round(display.bounds.x + region.x - offset);
  const winY = Math.round(display.bounds.y + region.y - offset);
  const winW = Math.round(region.width  + offset * 2);
  const winH = Math.round(region.height + offset * 2);

  borderWindow = new BrowserWindow({
    x: winX,
    y: winY,
    width:  winW,
    height: winH,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    show: false,
    webPreferences: { contextIsolation: true },
  });

  borderWindow.setIgnoreMouseEvents(true);

  // Solid edge strips (not CSS border) — more reliable on transparent Electron windows.
  // Strips sit in the outer offset ring so they never enter the captured area.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;background:transparent;overflow:hidden}
    .e{position:absolute;background:#f43f5e;animation:blink 1.8s ease-in-out infinite}
    .t,.b{left:0;right:0;height:${borderSize}px}
    .t{top:0}.b{bottom:0}
    .l,.r{top:0;bottom:0;width:${borderSize}px}
    .l{left:0}.r{right:0}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.45}}
  </style></head><body>
    <div class="e t"></div><div class="e r"></div><div class="e b"></div><div class="e l"></div>
  </body></html>`;

  borderWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  borderWindow.once('ready-to-show', () => {
    if (!borderWindow) return;
    borderWindow.showInactive();
    borderWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  borderWindow.on('closed', () => { borderWindow = null; });
}

// ---------------------------------------------------------------------------
// Controls window — floating stop panel, parked outside the capture region
// ---------------------------------------------------------------------------
function rectsOverlap(a, b, pad = 0) {
  return !(
    a.x + a.width  + pad <= b.x ||
    b.x + b.width  + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

function overlapArea(a, b) {
  const w = Math.max(0, Math.min(a.x + a.width,  b.x + b.width)  - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
}

function placeControlsPanel(region, panelWidth, panelHeight) {
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const margin = 16;
  const gap = 12;

  const capture = {
    x: display.bounds.x + region.x,
    y: display.bounds.y + region.y,
    width: region.width,
    height: region.height,
  };

  const clamp = (x, y) => ({
    x: Math.round(Math.min(Math.max(x, work.x + margin), work.x + work.width  - panelWidth  - margin)),
    y: Math.round(Math.min(Math.max(y, work.y + margin), work.y + work.height - panelHeight - margin)),
  });

  const inWorkArea = (pos) =>
    pos.x >= work.x &&
    pos.y >= work.y &&
    pos.x + panelWidth  <= work.x + work.width &&
    pos.y + panelHeight <= work.y + work.height;

  const avoidsCapture = (pos) =>
    inWorkArea(pos) && !rectsOverlap(
      { x: pos.x, y: pos.y, width: panelWidth, height: panelHeight },
      capture,
      gap
    );

  const midX = capture.x + capture.width  / 2 - panelWidth  / 2;
  const midY = capture.y + capture.height / 2 - panelHeight / 2;
  const rightX  = work.x + work.width  - panelWidth  - margin;
  const leftX   = work.x + margin;
  const topY    = work.y + margin;
  const bottomY = work.y + work.height - panelHeight - margin;

  const rawCandidates = [
    { x: capture.x + capture.width + gap,  y: midY },
    { x: capture.x - panelWidth - gap,     y: midY },
    { x: midX, y: capture.y + capture.height + gap },
    { x: midX, y: capture.y - panelHeight - gap },
    { x: capture.x + capture.width + gap,  y: capture.y },
    { x: capture.x - panelWidth - gap,     y: capture.y },
    { x: capture.x + capture.width + gap,  y: capture.y + capture.height - panelHeight },
    { x: capture.x - panelWidth - gap,     y: capture.y + capture.height - panelHeight },
    { x: rightX, y: midY },
    { x: leftX,  y: midY },
    { x: midX,   y: topY },
    { x: midX,   y: bottomY },
    { x: rightX, y: topY },
    { x: leftX,  y: topY },
    { x: rightX, y: bottomY },
    { x: leftX,  y: bottomY },
  ];

  for (const raw of rawCandidates) {
    const pos = clamp(raw.x, raw.y);
    if (avoidsCapture(pos)) return pos;
  }

  // Full-screen (or near) selection: pick the work-area spot with the least overlap
  let best = clamp(rightX, midY);
  let bestOverlap = Infinity;
  for (const raw of rawCandidates) {
    const pos = clamp(raw.x, raw.y);
    const area = overlapArea(
      { x: pos.x, y: pos.y, width: panelWidth, height: panelHeight },
      capture
    );
    if (area < bestOverlap) {
      bestOverlap = area;
      best = pos;
    }
  }
  return best;
}

function createControls(region) {
  const panelWidth = 248, panelHeight = 292;
  const { x, y } = placeControlsPanel(region, panelWidth, panelHeight);

  controlsWindow = new BrowserWindow({
    x, y,
    width: panelWidth, height: panelHeight,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlsWindow.loadFile('controls.html');
  controlsWindow.setAlwaysOnTop(true, 'screen-saver');
}

// ---------------------------------------------------------------------------
// ffmpeg recording — video and audio run as separate processes to avoid jitter,
// then get muxed into the final MP4 on stop.
// ---------------------------------------------------------------------------
function startRecording(region) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tmpDir = os.tmpdir();
  videoTmpFile = path.join(tmpDir, `rec-video-${timestamp}.mp4`);
  audioTmpFile = path.join(tmpDir, `rec-audio-${timestamp}.m4a`);
  finalOutFile = path.join(os.homedir(), 'Desktop', `recording-${timestamp}.mp4`);

  // Overlay/UI use DIP; ffmpeg gdigrab needs physical screen pixels
  const capture = regionToPhysical(region);

  // Video-only process
  ffmpegVideo = spawn(ffmpegPath, [
    '-f', 'gdigrab',
    '-framerate', '60',
    '-offset_x', String(capture.x),
    '-offset_y', String(capture.y),
    '-video_size', `${capture.width}x${capture.height}`,
    '-i', 'desktop',
    '-vcodec', 'libx264',
    '-crf', '15',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    videoTmpFile,
  ], { stdio: ['pipe', 'ignore', 'ignore'] });
  ffmpegVideo.on('close', () => { ffmpegVideo = null; });

  // DirectShow fallback only when Chromium is not already capturing the mic.
  // Elgato devices typically allow one client; the meter/MediaRecorder path
  // is preferred because it uses the same stream the user can already hear.
  if (micDeviceName && !isMicMuted && useDshowAudio) {
    ffmpegAudio = spawn(ffmpegPath, [
      '-f', 'dshow',
      '-i', `audio=${micDeviceName}`,
      '-acodec', 'aac',
      '-b:a', '192k',
      audioTmpFile,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    ffmpegAudio.on('close', () => { ffmpegAudio = null; });
  }

  isRecording = true;

  // Keep the capture frame above other windows while recording
  if (borderWindow && !borderWindow.isDestroyed()) {
    borderWindow.setAlwaysOnTop(true, 'screen-saver');
    borderWindow.showInactive();
  }
}

// Gracefully stop an ffmpeg process and wait for it to exit
function stopFfmpeg(proc) {
  return new Promise((resolve) => {
    if (!proc) { resolve(); return; }
    proc.on('close', resolve);
    try { proc.stdin.write('q'); proc.stdin.end(); } catch (_) {
      try { proc.kill('SIGTERM'); } catch (__) {}
    }
  });
}

function audioFileLooksValid(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 256;
  } catch (_) {
    return false;
  }
}

function muxVideoAndAudio(videoPath, audioPath, outPath, copyAudio) {
  return new Promise((resolve, reject) => {
    const args = copyAudio
      ? ['-i', videoPath, '-i', audioPath, '-c', 'copy', '-movflags', '+faststart', outPath]
      : [
          '-i', videoPath, '-i', audioPath,
          '-map', '0:v:0', '-map', '1:a:0',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
          '-movflags', '+faststart',
          outPath,
        ];
    const mux = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    mux.on('close', (code) => { code === 0 ? resolve() : reject(); });
  });
}

async function stopRecording() {
  const rendererAudio = await callControls('window.__flushMicRecording()');
  const hadDshowAudio = !!ffmpegAudio;

  await Promise.all([stopFfmpeg(ffmpegVideo), stopFfmpeg(ffmpegAudio)]);
  ffmpegVideo = null;
  ffmpegAudio = null;

  if (rendererAudio?.base64) {
    const ext = String(rendererAudio.mime || '').includes('ogg') ? 'ogg' : 'webm';
    rendererAudioFile = path.join(os.tmpdir(), `rec-mic-${Date.now()}.${ext}`);
    fs.writeFileSync(rendererAudioFile, Buffer.from(rendererAudio.base64, 'base64'));
  }

  const audioSource = audioFileLooksValid(rendererAudioFile)
    ? { path: rendererAudioFile, copy: false }
    : (hadDshowAudio && audioFileLooksValid(audioTmpFile)
      ? { path: audioTmpFile, copy: true }
      : null);

  if (audioSource && videoTmpFile && finalOutFile) {
    try {
      await muxVideoAndAudio(videoTmpFile, audioSource.path, finalOutFile, audioSource.copy);
      try { fs.unlinkSync(videoTmpFile); } catch (_) {}
    } catch (_) {
      try { fs.renameSync(videoTmpFile, finalOutFile); } catch (__) {}
    }
  } else if (videoTmpFile && finalOutFile) {
    try { fs.renameSync(videoTmpFile, finalOutFile); } catch (_) {}
  }

  try { if (audioTmpFile) fs.unlinkSync(audioTmpFile); } catch (_) {}
  try { if (rendererAudioFile) fs.unlinkSync(rendererAudioFile); } catch (_) {}

  videoTmpFile = null;
  audioTmpFile = null;
  rendererAudioFile = null;
  finalOutFile = null;
  useDshowAudio = false;
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
async function cleanup() {
  await stopRecording();
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

  if (micDeviceName === null) {
    micDeviceName = await findMicDevice() || false;
  }

  pendingRegion = {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
  };
  isPendingRecord = true;

  createBorderWindow(pendingRegion);
  createControls(pendingRegion);
});

// User clicked Record in the controls panel
ipcMain.on('start-recording', async () => {
  if (!pendingRegion || isRecording) return;
  const region = pendingRegion;
  pendingRegion = null;
  isPendingRecord = false;

  let capturingInRenderer = false;
  if (!isMicMuted) {
    capturingInRenderer = !!(await callControls('window.__beginMicCapture()'));
  }

  if (capturingInRenderer) {
    useDshowAudio = false;
  } else if (!isMicMuted) {
    const label = await callControls('window.__getMicLabel()');
    await callControls('window.__releaseMic()');
    micDeviceName = await findMicDevice(label || undefined) || micDeviceName || false;
    useDshowAudio = !!micDeviceName;
  } else {
    useDshowAudio = false;
  }

  startRecording(region);

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
ipcMain.on('stop-recording', async () => {
  await stopRecording();
  cleanupRecordingUI();
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
  globalShortcut.register(HOTKEY, async () => {
    if (isRecording || isPendingRecord) {
      await stopRecording();
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
