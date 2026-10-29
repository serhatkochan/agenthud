const desktop = document.querySelector('#desktop');
const island = document.querySelector('#island');
const handle = document.querySelector('#drag-handle');
const toggle = document.querySelector('#view-toggle');
const details = document.querySelector('#quota-details');
const summary = document.querySelector('#quota-summary');
const closePreview = document.querySelector('#preview-close');
const reopenPreview = document.querySelector('#preview-reopen');
const previewStatus = document.querySelector('#preview-status');
const previewHint = document.querySelector('#preview-hint');
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
  if (island.hidden) return;
  const baseX = (desktop.clientWidth - island.offsetWidth) / 2;
  const baseY = Number.parseFloat(getComputedStyle(island).top);
  const margin = 10;
  position = {
    x: Math.max(margin - baseX, Math.min(desktop.clientWidth - island.offsetWidth - margin - baseX, x)),
    y: Math.max(48 - baseY, Math.min(desktop.clientHeight - island.offsetHeight - 55 - baseY, y)),
  };
  island.style.translate = `${position.x}px ${position.y}px`;
  updateHint();
}

function updateHint() {
  previewHint.textContent = island.dataset.view === 'compact' && summary.scrollWidth > summary.clientWidth
    ? 'Özeti yana kaydır; + ile bütün limitleri aç.'
    : 'Kontroller için imleci adanın üzerine getir.';
}

function setExpanded(expanded) {
  const previousWidth = island.offsetWidth;
  island.dataset.view = expanded ? 'expanded' : 'compact';
  details.hidden = !expanded;
  summary.hidden = expanded;
  toggle.textContent = expanded ? '−' : '+';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? 'Yatay özete küçült' : 'Bütün limitleri aç');
  previewStatus.textContent = `${expanded ? 'Tüm limitler' : 'Yatay özet'} · örnek veriler`;
  moveIsland(position.x + (previousWidth - island.offsetWidth) / 2, position.y);
}

toggle.addEventListener('click', () => setExpanded(island.dataset.view !== 'expanded'));
closePreview.addEventListener('click', () => {
  island.hidden = true;
  reopenPreview.hidden = false;
  previewHint.textContent = 'Önizleme kapatıldı.';
  previewStatus.textContent = 'Kapalı · örnek veriler';
  reopenPreview.focus();
});
reopenPreview.addEventListener('click', () => {
  island.hidden = false;
  reopenPreview.hidden = true;
  setExpanded(false);
  moveIsland(0, 0);
  toggle.focus();
});

island.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    setExpanded(true);
  } else if (event.target === handle && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    setExpanded(island.dataset.view !== 'expanded');
  }
});

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

const resize = new ResizeObserver(() => moveIsland(position.x, position.y));
resize.observe(desktop);
resize.observe(island);
