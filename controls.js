const stopBtn = document.getElementById('stopBtn');
const timerEl = document.getElementById('timer');

let seconds = 0;

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
