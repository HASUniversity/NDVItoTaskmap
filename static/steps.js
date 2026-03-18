/* ===================================================
   steps.js — Step management (wizard progress)

   Controls which wizard step is "active", "completed",
   or "disabled" by toggling CSS classes on .step elements.
   Also registers click listeners on .step-header so users
   can jump back to earlier completed steps.
   =================================================== */

import { state } from './state.js';
import { drawNDVIHistogram } from './ndvi.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

import { isMobileUI } from './map.js';

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
  if (n === 4) setTimeout(drawNDVIHistogram, 400);
}

/**
 * Opens (expands) an already-reached step without advancing `currentStep`.
 * Allows users to revisit any step ≤ currentStep by clicking its header.
 * On mobile the newly opened step is scrolled into view.
 * @param {number} n - Step number to open (1-based).
 */
export function openStep(n) {
  const stepEl = $('#step-' + n);
  if (!stepEl || stepEl.classList.contains('disabled')) return;
  $$('.step').forEach(function (el) {
    if (parseInt(el.dataset.step) !== n) {
      el.classList.remove('active');
      if (parseInt(el.dataset.step) < state.currentStep) el.classList.add('completed');
      else el.classList.add('disabled');
    }
  });
  stepEl.classList.remove('completed', 'disabled');
  stepEl.classList.add('active');
  if (isMobileUI()) {
    setTimeout(() => stepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  }
  if (n === 4) setTimeout(drawNDVIHistogram, 400);
}

// Register header click listeners so users can jump back to
// any previously completed step by clicking its title bar.
$$('.step-header').forEach(function (hdr) {
  hdr.addEventListener('click', function () {
    const n = parseInt(hdr.dataset.toggle);
    if (n <= state.currentStep) openStep(n);
  });
});
