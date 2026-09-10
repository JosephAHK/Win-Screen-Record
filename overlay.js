const sel = document.getElementById('selection');
const hint = document.getElementById('hint');
const sizeLabel = document.getElementById('sizeLabel');
const ratioBar = document.getElementById('ratioBar');

let startX = 0, startY = 0;
let isDragging = false;
let aspectRatio = null; // null = free, otherwise width/height

const RATIOS = {
  free: null,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '1:1': 1,
  '21:9': 21 / 9,
};

ratioBar.addEventListener('mousedown', (e) => {
  // Don't start a selection when interacting with the toolbar
  e.stopPropagation();
});

ratioBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-ratio]');
  if (!btn) return;

  aspectRatio = RATIOS[btn.dataset.ratio];
  for (const b of ratioBar.querySelectorAll('button')) {
    b.classList.toggle('active', b === btn);
  }
});

function constrainRect(rawW, rawH) {
  let w = Math.abs(rawW);
  let h = Math.abs(rawH);

  if (aspectRatio && (w > 0 || h > 0)) {
    if (w === 0 && h === 0) {
      // nothing yet
    } else if (h === 0 || w / h > aspectRatio) {
      // Too wide (or no height yet) — height follows width
      h = w / aspectRatio;
    } else {
      // Too tall — width follows height
      w = h * aspectRatio;
    }
  }

  const x = rawW >= 0 ? startX : startX - w;
  const y = rawH >= 0 ? startY : startY - h;
  return { x, y, w, h };
}

function applySelection(x, y, w, h) {
  sel.style.display = 'block';
  sel.style.left = x + 'px';
  sel.style.top = y + 'px';
  sel.style.width = w + 'px';
  sel.style.height = h + 'px';
  sizeLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;
}

// Hide hint once user starts dragging
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // left button only
  if (e.target.closest('#ratioBar')) return;

  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;

  applySelection(startX, startY, 0, 0);
  hint.style.display = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;

  const { x, y, w, h } = constrainRect(e.clientX - startX, e.clientY - startY);
  applySelection(x, y, w, h);
});

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;

  const { x, y, w, h } = constrainRect(e.clientX - startX, e.clientY - startY);

  // Ignore tiny accidental clicks
  if (w < 10 || h < 10) {
    sel.style.display = 'none';
    hint.style.display = 'block';
    return;
  }

  // Coordinates are DIP (CSS pixels); main process converts to physical for ffmpeg
  window.api.sendRegion({ x, y, width: w, height: h });
});

// Cancel on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.api.cancelSelection();
  }
});
