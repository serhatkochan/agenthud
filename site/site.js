const desktop = document.querySelector('#desktop');
const island = document.querySelector('#island');
const handle = document.querySelector('#drag-handle');
const wallpaperChoices = document.querySelectorAll('[data-wallpaper-choice]');

for (const choice of wallpaperChoices) {
  choice.addEventListener('click', () => {
    desktop.dataset.wallpaper = choice.dataset.wallpaperChoice;
    for (const button of wallpaperChoices) {
      button.setAttribute('aria-pressed', String(button === choice));
    }
  });
}

let position = { x: 0, y: 0 };
let drag = null;

function moveIsland(x, y) {
  const baseX = (desktop.clientWidth - island.offsetWidth) / 2;
  const baseY = Number.parseFloat(getComputedStyle(island).top);
  const margin = 10;
  position = {
    x: Math.max(margin - baseX, Math.min(desktop.clientWidth - island.offsetWidth - margin - baseX, x)),
    y: Math.max(48 - baseY, Math.min(desktop.clientHeight - island.offsetHeight - 55 - baseY, y)),
  };
  island.style.translate = `${position.x}px ${position.y}px`;
}

handle.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...position } };
  handle.setPointerCapture(event.pointerId);
});

handle.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  moveIsland(drag.origin.x + event.clientX - drag.x, drag.origin.y + event.clientY - drag.y);
});

handle.addEventListener('lostpointercapture', () => { drag = null; });
handle.addEventListener('pointerup', event => {
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
});
handle.addEventListener('pointercancel', () => { drag = null; });

handle.addEventListener('keydown', event => {
  const steps = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
  if (!steps[event.key]) return;
  event.preventDefault();
  const [x, y] = steps[event.key];
  moveIsland(position.x + x, position.y + y);
});

new ResizeObserver(() => moveIsland(position.x, position.y)).observe(desktop);
