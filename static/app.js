/* ===================================================
   app.js — ES Module entrypoint
   Imports all modules; modules self-register their
   DOM event listeners on load.
   =================================================== */

import { state, defaultClasses } from './state.js?v=1';
import { showLoading, hideLoading } from './utils.js?v=1';
import { map, isMobileUI, syncLayerControlLayout, syncMobilePaneToggle, updateLayerVisibility } from './map.js?v=1';
import { activateStep } from './steps.js?v=1';
import { renderClasses, renderExportStats } from './taskmap.js?v=1';

// Side-effect imports — each module registers its own listeners
import './geotiff-loader.js?v=1';
import './brp.js?v=1';
import './export.js?v=1';

// ==========================================
// INIT
// ==========================================
state.classes = defaultClasses();
renderClasses();
activateStep(1);
updateLayerVisibility();

// Initialiseer de eenheid-hint tekst bij het laden
const unitSelectInit = document.querySelector('#unit-select');
if (unitSelectInit) {
  unitSelectInit.dispatchEvent(new Event('change'));
}

// Prevent slider interactions from bubbling to map drag handlers
[
  document.querySelector('#resolution-slider'),
  document.querySelector('#grid-size'),
  document.querySelector('#grid-angle'),
].forEach(function (slider) {
  if (!slider) return;
  ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(function (eventName) {
    slider.addEventListener(eventName, function (e) { e.stopPropagation(); });
  });
});

// Initialiseer laagcontrol en mobiele paneel status
syncLayerControlLayout();
syncMobilePaneToggle();

// Mobile sidebar toggle
(function () {
  const { t } = window;
  var sidebar = document.querySelector('.sidebar');
  var btn = document.getElementById('mobile-toggle');
  var lbl = document.getElementById('mobile-toggle-label');
  if (!btn || !sidebar) return;
  var open = true;
  function update() {
    if (open) {
      sidebar.classList.remove('collapsed');
      btn.classList.add('panel-open');
      lbl.textContent = t('mobileHide');
    } else {
      sidebar.classList.add('collapsed');
      btn.classList.remove('panel-open');
      lbl.textContent = t('mobilePanel');
    }
  }
  btn.addEventListener('click', function () {
    open = !open;
    update();
    setTimeout(function () { map.invalidateSize(); }, 360);
  });
  var hdr = sidebar.querySelector('.sidebar-header');
  if (hdr) {
    hdr.addEventListener('click', function () {
      if (isMobileUI()) { open = !open; update(); setTimeout(function () { map.invalidateSize(); }, 360); }
    });
  }
  update();
})();

// Re-render translated strings on language switch
window.addEventListener('langchange', function () {
  renderClasses();
  renderExportStats();
});

window.addEventListener('resize', syncLayerControlLayout);
window.addEventListener('resize', syncMobilePaneToggle);
