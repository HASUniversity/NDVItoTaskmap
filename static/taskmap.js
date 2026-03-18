/* ===================================================
   taskmap.js — Task map generation, class editor, grid angle

   Drives the variable-rate prescription layer:
     - Renders the editable dosage class table
     - Generates a Turf.js square grid clipped to selected parcels
     - Samples the mean VI value per grid cell
     - Classifies samples and applies colour + dosage properties
     - Computes the optimal driving direction from parcel geometry
     - Re-renders export statistics after every change
   =================================================== */

import { state, defaultClasses } from './state.js';
import { toast, escapeHtml } from './utils.js';
import { map, gridOverlay } from './map.js';
import { drawNDVIHistogram, ndviToRGB, autoClassifyFromData } from './ndvi.js';
import { activateStep } from './steps.js';

const { t, tf } = window;

// ==========================================
// DOM REFERENCES
// ==========================================
const gridSlider       = document.querySelector('#grid-size');
const gridValue        = document.querySelector('#grid-size-value');
const gridAngleSlider  = document.querySelector('#grid-angle');
const gridAngleValue   = document.querySelector('#grid-angle-value');
const autoAngleBtn     = document.querySelector('#auto-angle-btn');
const autoAngleHint    = document.querySelector('#auto-angle-hint');
const unitSelect       = document.querySelector('#unit-select');
const classesContainer = document.querySelector('#classes-container');
const addClassBtn      = document.querySelector('#add-class-btn');
const generateBtn      = document.querySelector('#generate-btn');

// ==========================================
// LIVE REGENERATION
// ==========================================
/**
 * Debounced helper that regenerates the task map and export stats
 * after any slider or class-editor change.  Skips if no parcels are
 * selected or the user has not yet reached the export step.
 */
let _liveTimer = null;
export function liveRegenerate() {
  if (!state.selectedParcels || state.selectedParcels.length === 0) return;
  if (state.currentStep < 4) return;
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(function () {
    try { generateTaskMap(); renderExportStats(); }
    catch (e) { console.warn('Live regenerate failed:', e); }
  }, 300);
}

// ==========================================
// SLIDER EVENT LISTENERS
// ==========================================
gridSlider.addEventListener('input', function () {
  state.gridSize = parseInt(gridSlider.value);
  gridValue.textContent = state.gridSize + ' m';
  liveRegenerate();
});

if (gridAngleSlider) {
  gridAngleSlider.addEventListener('input', function () {
    state.gridAngle = parseInt(gridAngleSlider.value);
    gridAngleValue.textContent = state.gridAngle + '°';
    liveRegenerate();
  });
}

const northSouthBtn = document.querySelector('#north-south-btn');
if (northSouthBtn) {
  northSouthBtn.addEventListener('click', function () {
    state.gridAngle = 0;
    if (gridAngleSlider) gridAngleSlider.value = 0;
    if (gridAngleValue) gridAngleValue.textContent = '0°';
    if (autoAngleHint) { autoAngleHint.textContent = t('autoAngleHintNS'); autoAngleHint.style.display = ''; }
    toast(t('toastNorthSouth'));
    liveRegenerate();
  });
}

if (autoAngleBtn) {
  autoAngleBtn.addEventListener('click', function () {
    if (!state.selectedParcels || state.selectedParcels.length === 0) {
      toast(t('toastSelectParcel'), true); return;
    }
    const angle = computeOptimalGridAngle(state.selectedParcels);
    state.gridAngle = angle;
    if (gridAngleSlider) gridAngleSlider.value = angle;
    if (gridAngleValue) gridAngleValue.textContent = angle + '°';
    if (autoAngleHint) { autoAngleHint.textContent = tf('autoAngleHintAngle', angle); autoAngleHint.style.display = ''; }
    toast(tf('toastAngleSet', angle));
    liveRegenerate();
  });
}

unitSelect.addEventListener('change', function () {
  state.unit = unitSelect.value;
  liveRegenerate();
});

// ==========================================
// CLASS EDITOR
// ==========================================
/**
 * Rebuilds the class editor table from `state.classes`, wiring up all
 * inline inputs (colour, name, range boundaries, dosage rate) and the
 * delete button.  Should be called after any state.classes mutation.
 */
export function renderClasses() {
  classesContainer.innerHTML =
    '<div class="class-labels">' +
    '<span></span><span>' + t('clsName') + '</span><span>' + t('clsFrom') + '</span><span>' + t('clsTo') + '</span><span>' + t('clsDose') + '</span><span></span>' +
    '</div>';

  state.classes.forEach(function (cls, i) {
    const row = document.createElement('div');
    row.className = 'class-row';
    row.innerHTML =
      '<input type="color" class="class-color" value="' + cls.color + '" data-i="' + i + '">' +
      '<input type="text" value="' + cls.name + '" data-i="' + i + '" data-field="name">' +
      '<input type="number" step="0.01" value="' + cls.min + '" data-i="' + i + '" data-field="min">' +
      '<input type="number" step="0.01" value="' + cls.max + '" data-i="' + i + '" data-field="max">' +
      '<input type="number" step="1" value="' + cls.rate + '" data-i="' + i + '" data-field="rate">' +
      '<button class="remove-class" data-i="' + i + '">×</button>';
    classesContainer.appendChild(row);
  });

  classesContainer.querySelectorAll('input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const i = parseInt(inp.dataset.i);
      const field = inp.dataset.field;
      if (inp.type === 'color') state.classes[i].color = inp.value;
      else if (field === 'name') state.classes[i].name = inp.value;
      else if (field) state.classes[i][field] = parseFloat(inp.value);
      liveRegenerate();
    });
  });

  classesContainer.querySelectorAll('.remove-class').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.classes.splice(parseInt(btn.dataset.i), 1);
      renderClasses();
      liveRegenerate();
    });
  });

  setTimeout(drawNDVIHistogram, 0);
}

addClassBtn.addEventListener('click', function () {
  const last = state.classes[state.classes.length - 1];
  state.classes.push({ name: 'Klasse ' + (state.classes.length + 1), min: last ? last.max : 0, max: 1, rate: 50, color: '#9e9e9e' });
  renderClasses();
});

const autoClassifyBtn = document.querySelector('#auto-classify-btn');
if (autoClassifyBtn) autoClassifyBtn.addEventListener('click', autoClassifyFromData);

// Handle the auto-classify event dispatched by ndvi.js
window.addEventListener('ndvi:autoclassify', function () {
  renderClasses();
  liveRegenerate();
});

// ==========================================
// GENERATE TASK MAP
// ==========================================
generateBtn.addEventListener('click', function () {
  if (!state.selectedParcels || state.selectedParcels.length === 0) {
    toast(t('toastSelectParcels'), true); return;
  }
  const { showLoading, hideLoading } = window._appUtils;
  showLoading(t('loadingGenerate'));
  setTimeout(function () {
    try {
      generateTaskMap();
      hideLoading();
      toast(t('toastGenerated'));
      renderExportStats();
      activateStep(5);
    } catch (err) {
      hideLoading();
      console.error(err);
      toast(tf('toastGenerateError', err.message), true);
    }
  }, 50);
});

// ==========================================
// TASK MAP GENERATION
// ==========================================
/**
 * Generates the variable-rate prescription map as a GeoJSON
 * FeatureCollection stored in `state.taskMapFC` and rendered on the map.
 *
 * Algorithm:
 *   1. Create a Turf.js square grid at `state.gridSize` metres over the
 *      bounding box of all selected parcels.
 *   2. If a non-zero grid angle is set, rotate the grid and parcels by
 *      that angle around the centroid, clip, then rotate back.
 *   3. Each surviving grid cell is intersected with the parcel union.
 *   4. The mean VI value for a cell is sampled from the raster bands
 *      stored in `state.georaster`.
 *   5. Cells are classified against `state.classes` and given colour and
 *      dosage properties.
 */
export function generateTaskMap() {
  const parcels  = state.selectedParcels;
  const gr       = state.georaster;
  const gridSize = state.gridSize;
  const angle    = state.gridAngle || 0;

  const allFC = { type: 'FeatureCollection', features: parcels };
  const center = turf.centroid(allFC).geometry.coordinates;

  let workParcels = parcels;
  let workFC = allFC;
  if (angle !== 0) {
    workParcels = parcels.map(f => rotateFeature(f, center, -angle));
    workFC = { type: 'FeatureCollection', features: workParcels };
  }

  const bbox = turf.bbox(workFC);
  const grid = turf.squareGrid(bbox, gridSize / 1000, { units: 'kilometers' });
  const features = [];
  const epsg = state.geotiffEPSG;

  grid.features.forEach(function (cell) {
    for (let p = 0; p < workParcels.length; p++) {
      let clipped;
      try { clipped = turf.intersect(cell, workParcels[p]); } catch (e) { continue; }
      if (!clipped) continue;
      const geoCell = angle !== 0 ? rotateFeature(clipped, center, angle) : clipped;
      const meanNDVI = sampleNDVI(geoCell, gr, epsg);
      if (isNaN(meanNDVI)) continue;
      const cls = classifyNDVI(meanNDVI);
      geoCell.properties = {
        ndvi: Math.round(meanNDVI * 1000) / 1000,
        klasse: cls.name,
        dosering: cls.rate,
        eenheid: state.unit,
        kleur: cls.color,
      };
      features.push(geoCell);
    }
  });

  state.taskMapFC = { type: 'FeatureCollection', features };

  gridOverlay.clearLayers();
  state.gridLayer = L.geoJSON(state.taskMapFC, {
    style: f => ({ fillColor: f.properties.kleur, fillOpacity: 0.7, color: '#ffffff', weight: 1, opacity: 0.8 }),
    onEachFeature: function (f, layer) {
      layer.bindPopup(
        '<b>' + f.properties.klasse + '</b><br>' +
        'NDVI: ' + f.properties.ndvi + '<br>' +
        'Dosering: ' + f.properties.dosering + ' ' + f.properties.eenheid
      );
    }
  }).addTo(gridOverlay);

  if (!map.hasLayer(gridOverlay)) map.addLayer(gridOverlay);
  const taakkaartCb = document.querySelector('.ulc-panel input[data-layer="taakkaart"]');
  if (taakkaartCb) taakkaartCb.checked = true;
}

// ==========================================
// NDVI SAMPLING + CLASSIFICATION
// ==========================================
/**
 * Samples the mean VI value for a single grid cell polygon by reading
 * pixel values from `state.georaster` within the cell bounds.
 * Uses a sub-sampled grid (max 50×50 samples) for performance.
 *
 * Handles pre-calculated NDVI, RGB-proxy, and multi-band spectral
 * TIFs for all supported VI formulae (NDVI, GNDVI, NDRE, SAVI, OSAVI).
 *
 * @param {object} polygon - Turf.js GeoJSON Feature (Polygon).
 * @param {object} gr      - Georaster-like object from state.georaster.
 * @param {string|null} epsg - Proj4 CRS key of the raster, or null for WGS84.
 * @returns {number} Mean VI value, or NaN if no valid pixels were found.
 */
function sampleNDVI(polygon, gr, epsg) {
  const cellBbox = turf.bbox(polygon);
  let xmin, ymin, xmax, ymax;
  if (epsg && epsg !== 'EPSG:4326') {
    try {
      const sw = proj4('EPSG:4326', epsg, [cellBbox[0], cellBbox[1]]);
      const ne = proj4('EPSG:4326', epsg, [cellBbox[2], cellBbox[3]]);
      xmin = sw[0]; ymin = sw[1]; xmax = ne[0]; ymax = ne[1];
    } catch (e) { xmin = cellBbox[0]; ymin = cellBbox[1]; xmax = cellBbox[2]; ymax = cellBbox[3]; }
  } else { xmin = cellBbox[0]; ymin = cellBbox[1]; xmax = cellBbox[2]; ymax = cellBbox[3]; }

  const col0 = Math.max(0, Math.floor((xmin - gr.xmin) / gr.pixelWidth));
  const col1 = Math.min(gr.width - 1, Math.ceil((xmax - gr.xmin) / gr.pixelWidth));
  const row0 = Math.max(0, Math.floor((gr.ymax - ymax) / Math.abs(gr.pixelHeight)));
  const row1 = Math.min(gr.height - 1, Math.ceil((gr.ymax - ymin) / Math.abs(gr.pixelHeight)));
  if (col0 > col1 || row0 > row1) return NaN;

  let sum = 0, count = 0;
  const noData = gr.noDataValue;
  const isFloat = state.bandMetas && state.bandMetas.length > 0 && state.bandMetas[0].sampleFormat === 3;
  const noDataEps = (isFloat && noData !== null) ? 1e-6 : 0;
  function nd(v) {
    if (v === undefined || v === null || isNaN(v)) return true;
    if (noData === null) return false;
    return noDataEps > 0 ? Math.abs(v - noData) < noDataEps : v === noData;
  }

  const stepR = Math.max(1, Math.floor((row1 - row0) / 50));
  const stepC = Math.max(1, Math.floor((col1 - col0) / 50));
  const sampleAlphaBand = gr.numberOfRasters >= 4 ? gr.numberOfRasters - 1 : -1;

  for (let r = row0; r <= row1; r += stepR) {
    for (let c = col0; c <= col1; c += stepC) {
      if (sampleAlphaBand >= 0 && gr.values[sampleAlphaBand][r] && gr.values[sampleAlphaBand][r][c] === 0) continue;
      let ndvi;
      if (state.isPreCalc) {
        const pv = gr.values[0][r] ? gr.values[0][r][c] : undefined;
        if (nd(pv)) continue;
        ndvi = pv;
      } else if (state.isRGBProxy) {
        const rrv = gr.values[state.bandRed][r] ? gr.values[state.bandRed][r][c] : undefined;
        const ggv = gr.values[state.bandNIR][r] ? gr.values[state.bandNIR][r][c] : undefined;
        if (rrv === undefined || ggv === undefined || (rrv + ggv) === 0) continue;
        ndvi = (ggv - rrv) / (ggv + rrv);
      } else {
        const vi = state.selectedVI || 'NDVI';
        const nirV = gr.values[state.bandNIR][r] ? gr.values[state.bandNIR][r][c] : undefined;
        const otherBand = vi === 'GNDVI' ? state.bandGreen : vi === 'NDRE' ? state.bandRedEdge : state.bandRed;
        const otherV = gr.values[otherBand][r] ? gr.values[otherBand][r][c] : undefined;
        if (nd(nirV) || nd(otherV)) continue;
        const ss = nirV + otherV;
        if (ss === 0) continue;
        if (vi === 'SAVI') ndvi = 1.5 * (nirV - otherV) / (nirV + otherV + 0.5);
        else if (vi === 'OSAVI') ndvi = (nirV - otherV) / (nirV + otherV + 0.16);
        else ndvi = (nirV - otherV) / ss;
        if (ndvi < -1 || ndvi > 1) continue;
      }
      if (!nd(ndvi)) { sum += ndvi; count++; }
    }
  }
  return count > 0 ? sum / count : NaN;
}

/**
 * Returns the first class whose [min, max) range contains `ndvi`.
 * Falls back to the last class for values at or above the maximum boundary.
 * @param {number} ndvi
 * @returns {{ name: string, min: number, max: number, rate: number, color: string }}
 */
function classifyNDVI(ndvi) {
  for (let i = 0; i < state.classes.length; i++) {
    const c = state.classes[i];
    if (ndvi >= c.min && ndvi < c.max) return c;
  }
  return state.classes[state.classes.length - 1];
}

// ==========================================
// EXPORT STATS
// ==========================================
/**
 * Renders a compact area-per-class and total-product summary into the
 * `#export-stats` container.  Called after task-map generation and on
 * language change so numbers and labels stay up to date.
 */
export function renderExportStats() {
  if (!state.taskMapFC) return;
  const features = state.taskMapFC.features;
  let totalArea = 0;
  const classCounts = {};
  let totalProduct = 0;
  const unitShort = state.unit.split('/')[0];

  features.forEach(function (f) {
    const a = turf.area(f);
    totalArea += a;
    const k = f.properties.klasse;
    if (!classCounts[k]) classCounts[k] = { count: 0, area: 0, color: f.properties.kleur, rate: f.properties.dosering };
    classCounts[k].count++;
    classCounts[k].area += a;
  });

  let html =
    '<div class="stat-row"><span class="stat-label">' + t('statCells') + '</span><span class="stat-value">' + features.length + '</span></div>' +
    '<div class="stat-row"><span class="stat-label">' + t('statArea') + '</span><span class="stat-value">' + (totalArea / 10000).toFixed(2) + ' ha</span></div>' +
    '<hr style="margin:8px 0;border:none;border-top:1px solid var(--border)">';

  Object.keys(classCounts).forEach(function (k) {
    const c = classCounts[k];
    const clsProd = (c.area / 10000) * c.rate;
    totalProduct += clsProd;
    html +=
      '<div class="stat-class">' +
      '<span class="stat-class-color" style="background:' + escapeHtml(c.color) + '"></span>' +
      '<span style="flex:1">' + escapeHtml(k) + '</span>' +
      '<span>' + (c.area / 10000).toFixed(1) + ' ha</span>' +
      '<span style="margin-left:6px;font-weight:600">' + Math.round(clsProd) + ' ' + escapeHtml(unitShort) + '</span>' +
      '</div>';
  });

  html += '<hr style="margin:8px 0;border:none;border-top:1px solid var(--border)">' +
    '<div class="stat-row"><span class="stat-label">' + t('statProduct') + '</span>' +
    '<span class="stat-value">' + Math.round(totalProduct) + ' ' + escapeHtml(unitShort) + '</span></div>';

  document.querySelector('#export-stats').innerHTML = html;
}

// ==========================================
// GRID ANGLE HELPERS
// ==========================================
/**
 * Computes the optimal driving-direction angle (in degrees, −90–+90)
 * from the selected parcel geometries by finding the longest outer-ring
 * edge across all parcels.
 * @param {object[]} parcels - Array of GeoJSON Feature objects.
 * @returns {number} Angle in degrees (0 = north-south rows).
 */
export function computeOptimalGridAngle(parcels) {
  let bestAngle = 0, bestLen = -1;
  try {
    parcels.forEach(function (parcel) {
      const geom = parcel.geometry;
      if (!geom) return;
      const rings = geom.type === 'Polygon'
        ? geom.coordinates
        : geom.coordinates.reduce((a, p) => a.concat(p), []);
      const outer = rings[0];
      if (!outer || outer.length < 2) return;
      const avgLat = outer.reduce((s, c) => s + c[1], 0) / outer.length;
      const cosLat = Math.cos(avgLat * Math.PI / 180);
      for (let i = 0; i < outer.length - 1; i++) {
        const dx = (outer[i + 1][0] - outer[i][0]) * cosLat;
        const dy = outer[i + 1][1] - outer[i][1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > bestLen) {
          bestLen = len;
          let deg = Math.atan2(dx, dy) * 180 / Math.PI;
          while (deg > 90) deg -= 180;
          while (deg < -90) deg += 180;
          bestAngle = Math.round(deg);
        }
      }
    });
  } catch (e) { console.warn('computeOptimalGridAngle failed:', e); }
  return -bestAngle;
}

function rotateCoord(coord, pivot, angleDeg) {
  const cos = Math.cos(angleDeg * Math.PI / 180);
  const sin = Math.sin(angleDeg * Math.PI / 180);
  const cosLat = Math.cos(pivot[1] * Math.PI / 180);
  const dx = (coord[0] - pivot[0]) * cosLat;
  const dy = coord[1] - pivot[1];
  return [pivot[0] + (dx * cos - dy * sin) / cosLat, pivot[1] + (dx * sin + dy * cos)];
}

function rotateGeometry(geom, pivot, angleDeg) {
  function rotCoords(coords) {
    if (typeof coords[0] === 'number') return rotateCoord(coords, pivot, angleDeg);
    return coords.map(rotCoords);
  }
  return { type: geom.type, coordinates: rotCoords(geom.coordinates) };
}

function rotateFeature(feat, pivot, angleDeg) {
  return { type: 'Feature', geometry: rotateGeometry(feat.geometry, pivot, angleDeg), properties: feat.properties };
}
