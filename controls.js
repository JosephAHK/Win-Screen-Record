const stopBtn   = document.getElementById('stopBtn');
const timerEl   = document.getElementById('timer');
const micBtn    = document.getElementById('micBtn');
const micOnSvg  = document.getElementById('micOn');
const micOffSvg = document.getElementById('micOff');
const meterFill = document.getElementById('meterFill');

let seconds = 0;
let muted = false;

// Update timer every second
const timerInterval = setInterval(() => {
  seconds++;
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
}, 1000);

stopBtn.addEventListener('click', () => {
  clearInterval(timerInterval);
  window.api.stopRecording();
});

// Mic mute/unmute toggle
micBtn.addEventListener('click', () => {
  window.api.toggleMic();
});

// React to muted state from main process
window.api.onMicMuted((isMuted) => {
  muted = isMuted;
  micOnSvg.style.display  = isMuted ? 'none' : '';
  micOffSvg.style.display = isMuted ? ''     : 'none';
  meterFill.classList.toggle('muted', isMuted);
  if (isMuted) meterFill.style.width = '0%';
});

// Smoothed audio level display
let displayLevel = 0;
window.api.onAudioLevel((level) => {
  if (muted) return;
  // Smooth the meter with a simple exponential moving average
  displayLevel = level > displayLevel
    ? level * 0.7 + displayLevel * 0.3   // fast attack
    : level * 0.2 + displayLevel * 0.8;  // slow decay
  meterFill.style.width = Math.round(displayLevel * 100) + '%';
});
