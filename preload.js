const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe IPC API to renderer processes
contextBridge.exposeInMainWorld('api', {
  // Overlay: send selected region to main process
  sendRegion: (region) => ipcRenderer.send('region-selected', region),

  // Overlay: user pressed Escape to cancel
  cancelSelection: () => ipcRenderer.send('selection-cancelled'),

  // Controls: stop the recording
  stopRecording: () => ipcRenderer.send('stop-recording'),

  // Controls: start recording (from pre-record state)
  startRecording: () => ipcRenderer.send('start-recording'),

  // Controls: cancel pre-record and go back to idle
  cancelPrerecord: () => ipcRenderer.send('cancel-prerecord'),

  // Controls: toggle microphone mute/unmute
  toggleMic: () => ipcRenderer.send('toggle-mic'),

  // Controls: listen for mic muted state changes
  onMicMuted: (cb) => ipcRenderer.on('mic-muted', (_e, muted) => cb(muted)),

  // Controls: listen for recording-started (transition from pre-record to recording)
  onRecordingStarted: (cb) => ipcRenderer.on('recording-started', () => cb()),
});
