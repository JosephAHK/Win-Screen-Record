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
  if (ratio < 0.55)      segColors.push('#4caf50'); // green
  else if (ratio < 0.75) segColors.push('#8bc34a'); // light green
  else if (ratio < 0.85) segColors.push('#ffeb3b'); // yellow
  else if (ratio < 0.92) segColors.push('#ff9800'); // orange
  else                    segColors.push('#f44336'); // red
}
const SEG_OFF = '#2a2a2a';

// ---------------------------------------------------------------------------
// Web Audio API mic meter — runs entirely in the renderer for real-time updates
// ---------------------------------------------------------------------------
let analyser = null;
let analyserData = null;
let displayLevel = 0;

async function initAudioMeter() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserData = new Float32Array(analyser.fftSize);
    updateMeter();
  } catch (_) {
    // No mic available — meter stays dark
  }
}

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
