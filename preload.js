const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe IPC API to renderer processes
contextBridge.exposeInMainWorld('api', {
  // Overlay: send selected region to main process
  sendRegion: (region) => ipcRenderer.send('region-selected', region),

  // Overlay: user pressed Escape to cancel
  cancelSelection: () => ipcRenderer.send('selection-cancelled'),

  // Controls: stop the recording
  stopRecording: () => ipcRenderer.send('stop-recording'),

  // Controls: toggle microphone mute/unmute
  toggleMic: () => ipcRenderer.send('toggle-mic'),

  // Controls: listen for audio level updates from main process
  onAudioLevel: (cb) => ipcRenderer.on('audio-level', (_e, level) => cb(level)),

  // Controls: listen for mic muted state changes
  onMicMuted: (cb) => ipcRenderer.on('mic-muted', (_e, muted) => cb(muted)),
});
