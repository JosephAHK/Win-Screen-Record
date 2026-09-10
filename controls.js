const recordBtn    = document.getElementById('recordBtn');
const cancelBtn    = document.getElementById('cancelBtn');
const preRecordBtns = document.getElementById('preRecordBtns');
const stopBtn      = document.getElementById('stopBtn');
const timerEl      = document.getElementById('timer');
const readyLabel   = document.getElementById('readyLabel');
const recIndicator = document.getElementById('recIndicator');
const micBtn       = document.getElementById('micBtn');
const micOnSvg     = document.getElementById('micOn');
const micOffSvg    = document.getElementById('micOff');
const micSelect    = document.getElementById('micSelect');
const meterEl      = document.getElementById('meter');

let seconds = 0;
let muted = false;
let timerInterval = null;

// ---------------------------------------------------------------------------
// Segmented audio meter — 12 segments with fixed colors per position
// ---------------------------------------------------------------------------
const SEG_COUNT = 12;
const segments = [];
// Color for each segment: green for low, yellow for mid, red for high
const segColors = [];
for (let i = 0; i < SEG_COUNT; i++) {
  const seg = document.createElement('div');
  seg.className = 'meter-seg';
  meterEl.appendChild(seg);
  segments.push(seg);

  const ratio = i / (SEG_COUNT - 1);
  if (ratio < 0.55)      segColors.push('#34d399');
  else if (ratio < 0.75) segColors.push('#84cc16');
  else if (ratio < 0.85) segColors.push('#fbbf24');
  else if (ratio < 0.92) segColors.push('#fb923c');
  else                    segColors.push('#f43f5e');
}
const SEG_OFF = '#2a3344';

// ---------------------------------------------------------------------------
// Web Audio API mic meter + MediaRecorder capture
// Same getUserMedia stream drives the meter and the recorded audio track.
// FFmpeg DirectShow cannot share exclusive Elgato devices with Chromium.
// ---------------------------------------------------------------------------
let analyser = null;
let analyserData = null;
let displayLevel = 0;
let audioCtx = null;
let micStream = null;
let selectedDeviceId = '';
let mediaRecorder = null;
let audioChunks = [];
let audioMime = 'audio/webm;codecs=opus';
const MIC_PREF_KEY = 'wsr.micDeviceId';
let meterRunning = false;

function loadPreferredMicId() {
  try { return localStorage.getItem(MIC_PREF_KEY) || ''; } catch (_) { return ''; }
}

function savePreferredMicId(deviceId) {
  selectedDeviceId = deviceId || '';
  try {
    if (selectedDeviceId) localStorage.setItem(MIC_PREF_KEY, selectedDeviceId);
    else localStorage.removeItem(MIC_PREF_KEY);
  } catch (_) {}
}

function audioConstraints(deviceId) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio };
}

function stopMicTracks() {
  if (!micStream) return;
  for (const track of micStream.getTracks()) track.stop();
  micStream = null;
}

function attachAnalyser(stream) {
  if (audioCtx) {
    try { audioCtx.close(); } catch (_) {}
  }
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyserData = new Float32Array(analyser.fftSize);
  if (!meterRunning) {
    meterRunning = true;
    updateMeter();
  }
}

async function openMicStream(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia(audioConstraints(deviceId));
  } catch (_) {
    if (deviceId) {
      try { return await navigator.mediaDevices.getUserMedia(audioConstraints('')); } catch (__) {}
    }
    return null;
  }
}

function currentTrackDeviceId() {
  return micStream?.getAudioTracks?.()[0]?.getSettings?.().deviceId || '';
}

async function refreshMicList() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'audioinput');
  } catch (_) {
    return;
  }

  const activeId = currentTrackDeviceId() || selectedDeviceId;
  const previous = micSelect.value;
  micSelect.innerHTML = '';

  if (!devices.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No microphone found';
    micSelect.appendChild(empty);
    micSelect.disabled = true;
    return;
  }

  micSelect.disabled = !!mediaRecorder && mediaRecorder.state !== 'inactive';

  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || 'Microphone';
    micSelect.appendChild(option);
  }

  const match = devices.find((device) => device.deviceId === activeId)
    || devices.find((device) => device.deviceId === previous);
  micSelect.value = match ? match.deviceId : devices[0].deviceId;
}

async function useMicDevice(deviceId, persist = true) {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

  const stream = await openMicStream(deviceId);
  if (!stream) {
    stopMicTracks();
    analyser = null;
    await refreshMicList();
    return;
  }

  stopMicTracks();
  micStream = stream;
  attachAnalyser(stream);

  const actualId = currentTrackDeviceId() || deviceId || '';
  if (persist) savePreferredMicId(actualId);
  else selectedDeviceId = actualId;
  await refreshMicList();
}

async function initAudioMeter() {
  selectedDeviceId = loadPreferredMicId();
  await useMicDevice(selectedDeviceId, false);
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      refreshMicList();
    });
  }
}

function pickRecorderMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function beginMicCapture() {
  if (muted || !micStream) return false;
  if (mediaRecorder) return mediaRecorder.state !== 'inactive';
  if (typeof MediaRecorder === 'undefined') return false;

  const mime = pickRecorderMime();
  if (!mime) return false;

  audioChunks = [];
  audioMime = mime;
  try {
    mediaRecorder = new MediaRecorder(micStream, {
      mimeType: mime,
      audioBitsPerSecond: 192000,
    });
  } catch (_) {
    mediaRecorder = null;
    return false;
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) audioChunks.push(event.data);
  };
  mediaRecorder.start(250);
  return true;
}

function flushMicRecording() {
  return new Promise((resolve) => {
    const finish = async () => {
      if (!audioChunks.length) {
        mediaRecorder = null;
        resolve(null);
        return;
      }
      const blob = new Blob(audioChunks, { type: audioMime });
      audioChunks = [];
      const buffer = await blob.arrayBuffer();
      mediaRecorder = null;
      if (!buffer.byteLength) {
        resolve(null);
        return;
      }
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      }
      resolve({ mime: audioMime, base64: btoa(binary) });
    };

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      finish();
      return;
    }

    mediaRecorder.onstop = () => { finish(); };
    try { mediaRecorder.stop(); } catch (_) { finish(); }
  });
}

function getMicLabel() {
  const track = micStream?.getAudioTracks?.()[0];
  return track?.label || '';
}

function releaseMic() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaRecorder = null;
  audioChunks = [];
  stopMicTracks();
  analyser = null;
  if (audioCtx) {
    try { audioCtx.close(); } catch (_) {}
    audioCtx = null;
  }
}

window.__beginMicCapture = beginMicCapture;
window.__flushMicRecording = flushMicRecording;
window.__getMicLabel = getMicLabel;
window.__releaseMic = releaseMic;

function updateMeter() {
  requestAnimationFrame(updateMeter);
  if (!analyser || muted) return;

  analyser.getFloatTimeDomainData(analyserData);

  let sumSq = 0;
  for (let i = 0; i < analyserData.length; i++) {
    sumSq += analyserData[i] * analyserData[i];
  }
  const rms = Math.sqrt(sumSq / analyserData.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;
  const level = Math.max(0, Math.min(1, (db + 60) / 55));

  // Smooth: fast attack, slow decay
  displayLevel = level > displayLevel
    ? level * 0.7 + displayLevel * 0.3
    : level * 0.15 + displayLevel * 0.85;

  // Light up segments up to the current level
  const litCount = Math.round(displayLevel * SEG_COUNT);
  for (let i = 0; i < SEG_COUNT; i++) {
    segments[i].style.background = i < litCount ? segColors[i] : SEG_OFF;
  }
}

initAudioMeter();

// ---------------------------------------------------------------------------
// Controls logic
// ---------------------------------------------------------------------------
recordBtn.addEventListener('click', () => {
  beginMicCapture();
  window.api.startRecording();
});

cancelBtn.addEventListener('click', () => {
  window.api.cancelPrerecord();
});

window.api.onRecordingStarted(() => {
  readyLabel.style.display     = 'none';
  recIndicator.style.display   = 'flex';
  timerEl.style.display        = 'block';
  preRecordBtns.style.display  = 'none';
  stopBtn.style.display        = 'inline-block';
  micSelect.disabled           = true;

  timerInterval = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
});

stopBtn.addEventListener('click', () => {
  if (timerInterval) clearInterval(timerInterval);
  window.api.stopRecording();
});

micBtn.addEventListener('click', () => {
  window.api.toggleMic();
});

micSelect.addEventListener('change', () => {
  useMicDevice(micSelect.value, true);
});

window.api.onMicMuted((isMuted) => {
  muted = isMuted;
  micOnSvg.style.display  = isMuted ? 'none' : '';
  micOffSvg.style.display = isMuted ? ''     : 'none';
  if (isMuted) {
    displayLevel = 0;
    for (let i = 0; i < SEG_COUNT; i++) {
      segments[i].style.background = SEG_OFF;
    }
  }
});
