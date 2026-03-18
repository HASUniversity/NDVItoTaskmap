/* ===================================================
   utils.js — General utility functions

   Pure helpers with no side-effects on import.
   All functions are exported individually so tree-shaking
   (if a bundler is ever added) can eliminate unused ones.
   =================================================== */

const { t, tf } = window;

/**
 * Escapes HTML special characters to prevent XSS when inserting
 * external data (BRP crop names, TIFF band names, user input) into innerHTML.
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapes XML/SVG special characters.
 * Used when building ISOXML strings that embed user-supplied names.
 * @param {*} s
 * @returns {string}
 */
export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ==========================================
// LOADING OVERLAY & TOAST
// ==========================================
const loadingOverlay = document.querySelector('#loading-overlay');
const loadingText    = document.querySelector('#loading-text');
const toastEl        = document.querySelector('#toast');
let toastTimer = null;

/**
 * Shows the full-screen loading overlay with an optional status message.
 * @param {string} [text] - Localised message shown below the spinner.
 */
export function showLoading(text) {
  loadingText.textContent = text || t('loading');
  loadingOverlay.classList.remove('hidden');
}

/** Hides the full-screen loading overlay. */
export function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

/**
 * Briefly shows a toast notification at the bottom of the screen.
 * @param {string}  msg      - Message to display.
 * @param {boolean} [isError] - If true, the toast is styled as an error.
 */
export function toast(msg, isError) {
  toastEl.textContent = msg;
  toastEl.className = 'toast visible' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast hidden'; }, 4000);
}

/**
 * Returns a debounced version of `fn` that only fires after `ms` ms
 * of inactivity.  Used to throttle map-move BRP requests and slider events.
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function}
 */
export function debounce(fn, ms) {
  let timer;
  return function () {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// ==========================================
// COORDINATE UTILITIES
// ==========================================

/**
 * Ensures a proj4 definition exists for the given numeric EPSG code.
 * Registers UTM WGS84 zones (326xx / 327xx) and RD New (28992) automatically.
 * @param {number|null} code - EPSG authority code (e.g. 32631).
 * @returns {string|null} The "EPSG:XXXX" key, or null if unknown.
 */
export function ensureEPSG(code) {
  if (!code) return null;
  const key = 'EPSG:' + code;
  try { if (proj4.defs(key)) return key; } catch (e) {}
  if (code >= 32601 && code <= 32660) {
    const zone = code - 32600;
    proj4.defs(key, '+proj=utm +zone=' + zone + ' +datum=WGS84 +units=m +no_defs');
    return key;
  }
  if (code >= 32701 && code <= 32760) {
    const zone = code - 32700;
    proj4.defs(key, '+proj=utm +zone=' + zone + ' +south +datum=WGS84 +units=m +no_defs');
    return key;
  }
  if (code === 28992) return 'EPSG:28992';
  console.warn('Onbekende EPSG: ' + code + ', behandeld als WGS84');
  return null;
}

/**
 * Recursively transforms a coordinate array tree (as used in GeoJSON geometry)
 * from one proj4-registered CRS to another.
 * @param {Array}  coords  - Coordinate or nested coordinate array.
 * @param {string} from    - Source proj4 key (e.g. "EPSG:28992").
 * @param {string} to      - Target proj4 key (e.g. "EPSG:4326").
 * @returns {Array}
 */
export function convertCoords(coords, from, to) {
  if (typeof coords[0] === 'number') {
    const c = proj4(from, to, [coords[0], coords[1]]);
    return coords.length > 2 ? [c[0], c[1], coords[2]] : c;
  }
  return coords.map(function (c) { return convertCoords(c, from, to); });
}

/**
 * Returns a deep-copied GeoJSON FeatureCollection with all coordinates
 * reprojected from `from` to `to`.
 * @param {object} gj   - GeoJSON FeatureCollection.
 * @param {string} from - Source proj4 key.
 * @param {string} to   - Target proj4 key.
 * @returns {object}
 */
export function convertGeoJSON(gj, from, to) {
  const copy = JSON.parse(JSON.stringify(gj));
  (copy.features || []).forEach(function (f) {
    f.geometry.coordinates = convertCoords(f.geometry.coordinates, from, to);
  });
  return copy;
}
