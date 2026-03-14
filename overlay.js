const sel = document.getElementById('selection');
const hint = document.getElementById('hint');

let startX = 0, startY = 0;
let isDragging = false;

// Hide hint once user starts dragging
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // left button only
  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;

  sel.style.display = 'block';
  sel.style.left = startX + 'px';
  sel.style.top = startY + 'px';
  sel.style.width = '0px';
  sel.style.height = '0px';

  hint.style.display = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;

  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);

  sel.style.left = x + 'px';
  sel.style.top = y + 'px';
  sel.style.width = w + 'px';
  sel.style.height = h + 'px';
});

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;

  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);

  // Ignore tiny accidental clicks
  if (w < 10 || h < 10) {
    sel.style.display = 'none';
    hint.style.display = 'block';
    return;
  }

  // Send region to main process (coordinates are in CSS pixels = screen pixels on 100% DPI)
  window.api.sendRegion({ x, y, width: w, height: h });
});

// Cancel on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.api.cancelSelection();
  }
});
