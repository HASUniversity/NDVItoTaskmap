/* ===================================================
   steps.js — Step management (wizard progress)

   Controls which wizard step is "active", "completed",
   or "disabled" by toggling CSS classes on .step elements
   and the .step-progress bar.  Also handles navigation
   buttons (Next / Back) and advanced-options toggles.
   =================================================== */

import { state } from './state.js?v=1';
import { drawNDVIHistogram, addContourToOverlay } from './ndvi.js?v=1';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

import { isMobileUI, showLegendInPanel, ndviOverlay } from './map.js?v=1';

/**
 * Update the step progress indicator at the top of the sidebar
 * to reflect which step is active / completed / pending.
 * @param {number} n - Current active step number (1-based).
 */
function updateProgress(n) {
  $$('.step-progress-item').forEach(function (el) {
    const s = parseInt(el.dataset.progress);
    el.classList.remove('active', 'completed');
    if (s < n) el.classList.add('completed');
    else if (s === n) el.classList.add('active');
  });
}

/**
 * Marks step `n` as active and all previous steps as completed.
 * Steps beyond `n` are disabled.  Triggers the NDVI histogram draw
 * with a short delay when entering the histogram step (step 4).
 * @param {number} n - Step number to activate (1-based).
 */
export function activateStep(n) {
  state.currentStep = n;
  $$('.step').forEach(function (el) {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed', 'disabled');
    if (s < n) el.classList.add('completed');
    else if (s === n) el.classList.add('active');
    else el.classList.add('disabled');
  });
  updateProgress(n);
  if (n >= 3) showLegendInPanel();
  if (n === 4) setTimeout(drawNDVIHistogram, 400);
  if (n === 5) window.dispatchEvent(new CustomEvent('step:activated', { detail: { step: 5 } }));
  // Refresh contour when stepping through the wizard
  if (state.georaster) {
    try { addContourToOverlay(ndviOverlay); } catch (_) {}
  }
  // Scroll the new step into view on mobile
  if (isMobileUI()) {
    const stepEl = $('#step-' + n);
    if (stepEl) setTimeout(function () {
      stepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }
}

/**
 * Opens (expands) an already-reached step without advancing `currentStep`.
 * Allows users to revisit any step = currentStep by clicking its header.
 * On mobile the newly opened step is scrolled into view.
 * @param {number} n - Step number to open (1-based).
 */
export function openStep(n) {
  const stepEl = $('#step-' + n);
  if (!stepEl || stepEl.classList.contains('disabled')) return;
  $$('.step').forEach(function (el) {
    const s = parseInt(el.dataset.step);
    if (s !== n) {
      el.classList.remove('active');
      if (s > state.currentStep) el.classList.add('disabled');
      else el.classList.add('completed');
    }
  });
  stepEl.classList.remove('completed', 'disabled');
  stepEl.classList.add('active');
  updateProgress(state.currentStep);
  if (isMobileUI()) {
    setTimeout(function () {
      stepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }
  if (n >= 3) showLegendInPanel();
  if (n === 4) setTimeout(drawNDVIHistogram, 400);
}

// ==========================================
// NAVIGATION BUTTONS
// ==========================================

// Next buttons — advance to the next step
document.querySelectorAll('.btn-next').forEach(function (btn) {
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    const next = parseInt(btn.dataset.next);
    if (!isNaN(next)) activateStep(next);
  });
});

// Previous buttons — go back to previous step
document.querySelectorAll('.btn-prev').forEach(function (btn) {
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    const prev = parseInt(btn.dataset.prev);
    if (!isNaN(prev)) openStep(prev);
  });
});

// ==========================================
// STEP HEADER CLICK — quick jump back
// ==========================================
$$('.step-header').forEach(function (hdr) {
  hdr.addEventListener('click', function () {
    const n = parseInt(hdr.dataset.toggle);
    if (!isNaN(n) && n <= state.currentStep) openStep(n);
  });
});

// ==========================================
// ADVANCED OPTIONS TOGGLES
// ==========================================
function setupAdvancedToggle(btnId, contentId) {
  var btn = document.getElementById(btnId);
  var content = document.getElementById(contentId);
  if (!btn || !content) return;
  btn.addEventListener('click', function () {
    var isOpen = content.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    var label = btn.querySelector('[data-i18n]');
    if (label) {
      var key = isOpen ? 'advancedHide' : 'advancedShow';
      if (window.t) label.textContent = window.t(key);
    }
  });
}

setupAdvancedToggle('advanced-bands-toggle', 'advanced-bands-content');
setupAdvancedToggle('advanced-taskmap-toggle', 'advanced-taskmap-content');

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', function (e) {
  // Enter in a text/number field should not trigger navigation
  var tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    var nextBtn = document.querySelector('.step.active .btn-next');
    if (nextBtn) { e.preventDefault(); nextBtn.click(); }
  }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    var prevBtn = document.querySelector('.step.active .btn-prev');
    if (prevBtn) { e.preventDefault(); prevBtn.click(); }
  }
});
