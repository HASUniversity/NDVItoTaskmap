/* ===================================================
   app.js — ES Module entrypoint
   Imports all modules; modules self-register their
   DOM event listeners on load.
   =================================================== */

import { state, defaultClasses } from './state.js';
import { showLoading, hideLoading } from './utils.js';
import { map, isMobileUI, syncLayerControlLayout, syncMobilePaneToggle } from './map.js';
import { activateStep } from './steps.js';
import { renderClasses, renderExportStats } from './taskmap.js';

// Side-effect imports — each module registers its own listeners
import './geotiff-loader.js';
import './brp.js';
import './export.js';

// ==========================================
// EXPOSE HELPERS FOR SUB-MODULES
// ==========================================
window._appUtils = { showLoading, hideLoading };

// ==========================================
// INIT
// ==========================================
state.classes = defaultClasses();
renderClasses();
activateStep(1);

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
