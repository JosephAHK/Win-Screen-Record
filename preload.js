const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe IPC API to renderer processes
contextBridge.exposeInMainWorld('api', {
  // Overlay: send selected region to main process
  sendRegion: (region) => ipcRenderer.send('region-selected', region),

  // Overlay: user pressed Escape to cancel
  cancelSelection: () => ipcRenderer.send('selection-cancelled'),

  // Controls: stop the recording
  stopRecording: () => ipcRenderer.send('stop-recording'),
});
